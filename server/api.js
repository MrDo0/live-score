// Server-side /api/* endpoints, served by the Vite dev/preview server and by the Netlify function
// (netlify/functions/api.mjs). API keys stay here and never reach the browser.
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'

const ODDS_BASE = 'https://api.the-odds-api.com/v4'
const TENNIS_BASE = 'https://api.api-tennis.com/tennis/'
const LIVE_TTL = 10 * 1000 // Point scores move fast; 10s keeps the 15s client poll fresh without hammering the API.
// The free tier is 500 credits/month (1 credit per tournament per refresh), so cache:
// 10 min normally, 3 min while a match is in play. ODDS_LIVE_TTL_SEC overrides the live value.
const ODDS_TTL = 10 * 60 * 1000
const CHALLENGER_TTL = 30 * 1000 // Fixtures carry the set scores, so keep them close to the client's 15s live poll.

// api-tennis event_type_type prefix per tour key; Challenger/WTA 125 only exist there, not on ESPN.
const TOUR_TYPES = { atp: 'Atp', wta: 'Wta', atpc: 'Challenger Men', wtac: 'Challenger Women' }
const tourParam = (url) => (TOUR_TYPES[url.searchParams.get('tour')] ? url.searchParams.get('tour') : 'atp')

export function apiPlugin(env) {
  const middleware = createMiddleware(env)
  return {
    name: 'live-score-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

function createMiddleware(env) {
  const handle = createHandler(env)
  return async (req, res, next) => {
    const out = await handle(req.method, new URL(req.url, 'http://localhost'), () => readJson(req))
    if (!out) return next()
    send(res, ...out)
  }
}

// Routes one request; resolves to [status, data], or null when the path isn't an API route.
// readBody() returns the parsed JSON body (only called for POST).
export function createHandler(env) {
  const oddsCache = {}
  const predictionCache = new Map()
  let claude = null

  const liveTtl = (+env.ODDS_LIVE_TTL_SEC || 180) * 1000
  let liveCache = null
  let tennisOddsCache = null
  let liveOddsCache = null
  let challengerCache = null

  const tennisGet = (method, params = '') =>
    fetch(`${TENNIS_BASE}?method=${method}&APIkey=${encodeURIComponent(env.API_TENNIS_KEY)}${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(httpError(502, `api-tennis алдаа: ${r.status}`))))
      .then((d) => {
        if (d.success !== 1) throw httpError(502, d.error ?? 'api-tennis алдаа')
        return d.result ?? []
      })

  // Pre-match match-winner odds per bookmaker for today..+2 days. Fixtures give the names; both are ~1.5MB, so cache 10 min.
  async function getTennisOdds(tour) {
    if (!tennisOddsCache || Date.now() - tennisOddsCache.at > ODDS_TTL) {
      const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
      const range = `&date_start=${day(-1)}&date_stop=${day(2)}`
      const p = Promise.all([tennisGet('get_fixtures', range), tennisGet('get_odds', range)]).then(([fixtures, odds]) =>
        fixtures
          .filter((e) => odds[e.event_key]?.['Home/Away'] && e.event_status !== 'Finished')
          .map((e) => {
            const { Home = {}, Away = {} } = odds[e.event_key]['Home/Away']
            return {
              type: e.event_type_type,
              home: e.event_first_player,
              away: e.event_second_player,
              commence: `${e.event_date}T${e.event_time}`,
              live: e.event_live === '1',
              bookmakers: Object.keys(Home)
                .filter((b) => Away[b])
                .map((b) => ({ title: BOOK_NAMES[b] ?? b, home: +Home[b], away: +Away[b] })),
            }
          }),
      )
      tennisOddsCache = { at: Date.now(), p }
      p.catch(() => (tennisOddsCache = null))
    }
    const type = `${TOUR_TYPES[tour]} Singles`
    return (await tennisOddsCache.p).filter((e) => e.type === type && e.bookmakers.length)
  }

  // In-play "To Win" prices keyed by event_key; one call covers every live match.
  function getLiveOdds() {
    if (!liveOddsCache || Date.now() - liveOddsCache.at > 15000) {
      const p = tennisGet('get_live_odds').then((res) => {
        const out = {}
        for (const [key, e] of Object.entries(res)) {
          const win = (e.live_odds ?? []).filter((o) => o.odd_name === 'To Win')
          const home = win.find((o) => o.type === 'Home')
          const away = win.find((o) => o.type === 'Away')
          if (home && away) out[key] = { home: +home.value, away: +away.value, suspended: home.suspended === 'Yes' }
        }
        return out
      })
      liveOddsCache = { at: Date.now(), p }
      p.catch(() => (liveOddsCache = null))
    }
    return liveOddsCache.p
  }

  // api-tennis.com live scores: current game points, server and match stats (ESPN has none of these).
  async function getLive(tour) {
    if (!env.API_TENNIS_KEY) throw httpError(503, 'API_TENNIS_KEY тохируулаагүй байна (.env файл).')
    if (!liveCache || Date.now() - liveCache.at > LIVE_TTL) {
      const p = tennisGet('get_livescore')
      liveCache = { at: Date.now(), p }
      p.catch(() => (liveCache = null))
    }
    const liveOdds = await getLiveOdds().catch(() => ({}))
    const type = `${TOUR_TYPES[tour]} Singles`
    return (await liveCache.p)
      .filter((e) => e.event_type_type === type)
      .map((e) => {
        const stats = (e.statistics ?? []).filter((x) => x.stat_period === 'match')
        const statsOf = (key) => Object.fromEntries(stats.filter((x) => x.player_key === key).map((x) => [x.stat_name, x.stat_value]))
        // Set scores come as "6" or "7.7" (games.tiebreak points). A new set may not be listed yet.
        const period = +(e.event_status.match(/Set (\d)/)?.[1] ?? 0) || null
        const rows = [...(e.scores ?? [])].sort((x, y) => x.score_set - y.score_set)
        while (period && rows.length < period) rows.push({ score_first: '0', score_second: '0' })
        const parse = (v) => {
          const [g, tb] = String(v).split('.')
          return { v: +g, tb: tb != null ? +tb : null }
        }
        const sets = rows.map((r) => [parse(r.score_first), parse(r.score_second)])
        sets.forEach(([a, b], i) => {
          // Sets before the current one are finished; mark the winner like ESPN does.
          if (period && i < period - 1 && a.v !== b.v) [a.won, b.won] = [a.v > b.v, b.v > a.v]
        })
        return {
          period,
          sets: [sets.map((x) => x[0]), sets.map((x) => x[1])],
          winOdds: liveOdds[e.event_key] ?? null,
          first: e.event_first_player,
          second: e.event_second_player,
          game: (e.event_game_result ?? '').split(' - '),
          serve: e.event_serve === 'First Player' ? 0 : e.event_serve === 'Second Player' ? 1 : null,
          status: e.event_status,
          stats: [statsOf(e.first_player_key), statsOf(e.second_player_key)],
        }
      })
  }

  // Challenger (atpc) / WTA 125 (wtac) tournaments in the same shape as the client's ESPN fetchTournaments().
  // Yesterday..tomorrow in UTC so "today" in any browser time zone is covered; the client filters to today.
  async function getChallenger(tour) {
    if (!env.API_TENNIS_KEY) throw httpError(503, 'API_TENNIS_KEY тохируулаагүй байна (.env файл).')
    if (!challengerCache || Date.now() - challengerCache.at > CHALLENGER_TTL) {
      const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
      const p = tennisGet('get_fixtures', `&date_start=${day(-1)}&date_stop=${day(1)}&timezone=UTC`).then((list) =>
        list.filter((e) => e.event_type_type.startsWith('Challenger')),
      )
      challengerCache = { at: Date.now(), p }
      p.catch(() => (challengerCache = null))
    }
    const prefix = `${TOUR_TYPES[tour]} `
    const byTournament = new Map()
    for (const e of await challengerCache.p) {
      if (!e.event_type_type.startsWith(prefix)) continue
      // Singles and doubles of one tournament have different keys, so group by name.
      const id = `at-${e.tournament_name}`
      if (!byTournament.has(id)) {
        byTournament.set(id, {
          id,
          name: e.tournament_name,
          venue: tour === 'wtac' ? 'WTA 125' : 'ATP Challenger',
          matches: [],
        })
      }
      byTournament.get(id).matches.push(challengerMatch(e, id))
    }
    return [...byTournament.values()]
  }

  // Odds API first (more bookmakers); api-tennis fills in tournaments it doesn't cover (e.g. WTA 250).
  async function getOdds(tour) {
    if (!env.ODDS_API_KEY && !env.API_TENNIS_KEY) throw httpError(503, 'ODDS_API_KEY / API_TENNIS_KEY тохируулаагүй байна (.env файл).')
    const [main, extra] = await Promise.all([
      // The Odds API has no Challenger markets.
      env.ODDS_API_KEY && (tour === 'atp' || tour === 'wta') ? getOddsApi(tour).catch(() => []) : [],
      env.API_TENNIS_KEY ? getTennisOdds(tour).catch(() => []) : [],
    ])
    // Same match in both: add api-tennis bookmakers the Odds API list doesn't already have.
    const byPair = new Map(main.map((e) => [pairKey(e.home, e.away), e]))
    // phase: Odds API prices are in-play once the match started; api-tennis get_odds are always pre-match.
    const out = main.map((e) => ({
      ...e,
      bookmakers: e.bookmakers.map((b) => ({ ...b, source: 'The Odds API', phase: e.live ? 'live' : 'pre' })),
    }))
    const outByPair = new Map(out.map((e) => [pairKey(e.home, e.away), e]))
    for (const x of extra) {
      const books = x.bookmakers.map((b) => ({ ...b, source: 'api-tennis', phase: 'pre' }))
      const target = outByPair.get(pairKey(x.home, x.away))
      if (!byPair.has(pairKey(x.home, x.away))) {
        out.push({ ...x, bookmakers: books })
        continue
      }
      const swapped = surname(x.home) !== surname(target.home)
      const have = new Set(target.bookmakers.map((b) => b.phase + bookKey(b.title)))
      for (const b of books) {
        if (have.has(b.phase + bookKey(b.title))) continue
        target.bookmakers.push(swapped ? { ...b, home: b.away, away: b.home } : b)
      }
    }
    return out
  }

  async function getOddsApi(tour) {
    const hit = oddsCache[tour]
    if (hit && Date.now() - hit.at < hit.ttl) return hit.data

    const key = encodeURIComponent(env.ODDS_API_KEY)
    // The sports list is free; tennis keys are per tournament, e.g. tennis_atp_paris_masters.
    const sports = await getJson(`${ODDS_BASE}/sports?apiKey=${key}`)
    const keys = sports.filter((s) => s.active && s.key.startsWith(`tennis_${tour}_`)).map((s) => s.key)
    const lists = await Promise.all(
      keys.map((k) =>
        getJson(`${ODDS_BASE}/sports/${k}/odds?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`),
      ),
    )
    const data = lists.flat().map((e) => ({
      live: new Date(e.commence_time) <= Date.now(),
      home: e.home_team,
      away: e.away_team,
      commence: e.commence_time,
      bookmakers: e.bookmakers
        .map((b) => {
          const prices = Object.fromEntries(
            (b.markets.find((m) => m.key === 'h2h')?.outcomes ?? []).map((o) => [o.name, o.price]),
          )
          return { title: b.title, home: prices[e.home_team], away: prices[e.away_team], updated: b.last_update }
        })
        .filter((b) => b.home && b.away),
    }))
    const inPlay = data.some((e) => new Date(e.commence) <= Date.now())
    oddsCache[tour] = { at: Date.now(), ttl: inPlay ? liveTtl : ODDS_TTL, data }
    return data
  }

  const Prediction = z.object({
    probA: z.number().describe('Probability (0-100) that player A wins the match'),
    confidence: z.enum(['low', 'medium', 'high']),
    factors: z.array(z.string()).describe('3-5 short key factors, in Mongolian'),
    summary: z.string().describe('2-3 sentence explanation, in Mongolian'),
  })

  async function predict(ctx) {
    if (!env.ANTHROPIC_API_KEY) throw httpError(503, 'ANTHROPIC_API_KEY тохируулаагүй байна (.env файл).')
    claude ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    // One prediction per match per score state, so polling or re-clicking doesn't re-bill.
    const cacheKey = `${ctx.matchId}:${ctx.state}:${JSON.stringify(ctx.score)}`
    if (predictionCache.has(cacheKey)) return predictionCache.get(cacheKey)

    const response = await claude.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(Prediction) },
      system:
        'You are a tennis analyst. Estimate the match win probability for player A from the data given. ' +
        'Weigh ranking, form in this tournament, the live score if the match is in progress, and the bookmaker ' +
        'consensus if provided. Be calibrated: do not overstate confidence. Write factors and summary in Mongolian.',
      messages: [{ role: 'user', content: JSON.stringify(ctx, null, 2) }],
    })
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      throw httpError(502, 'AI таамаг гаргаж чадсангүй.')
    }
    const out = { ...response.parsed_output, model: response.model }
    out.probA = Math.min(100, Math.max(0, Math.round(out.probA)))
    predictionCache.set(cacheKey, out)
    return out
  }

  return async (method, url, readBody) => {
    try {
      if (method === 'GET' && url.pathname === '/api/odds') return [200, await getOdds(tourParam(url))]
      if (method === 'GET' && url.pathname === '/api/live') return [200, await getLive(tourParam(url))]
      if (method === 'GET' && url.pathname === '/api/challenger') {
        return [200, await getChallenger(url.searchParams.get('tour') === 'wtac' ? 'wtac' : 'atpc')]
      }
      if (method === 'POST' && url.pathname === '/api/predict') return [200, await predict(await readBody())]
    } catch (e) {
      const status = e.status ?? 500
      const message = e instanceof Anthropic.AuthenticationError
        ? 'Claude API түлхүүр буруу эсвэл тохируулаагүй (ANTHROPIC_API_KEY).'
        : e instanceof Anthropic.RateLimitError
          ? 'Claude API хязгаарт хүрлээ, түр хүлээгээд дахин оролдоно уу.'
          : e.message
      return [status, { error: message }]
    }
    return null
  }
}

const FINISHED = {
  Finished: 'STATUS_FINAL',
  Retired: 'STATUS_RETIRED',
  'Walk Over': 'STATUS_WALKOVER',
  Cancelled: 'STATUS_CANCELED',
  Postponed: 'STATUS_POSTPONED',
}

// One api-tennis fixture as the client's normalized ESPN match. Player ids are prefixed so they never
// collide with ESPN athlete ids (rankings, athlete profiles).
function challengerMatch(e, eventId) {
  const doubles = e.event_type_type.endsWith('Doubles')
  // Scheduled matches carry status "" or "1"; only these mean the match has started.
  const started = e.event_live === '1' || /^Set \d/.test(e.event_status) || /Interrupted|Suspended/.test(e.event_status)
  const state = FINISHED[e.event_status] ? 'post' : started ? 'in' : 'pre'
  const period = +(e.event_status.match(/Set (\d)/)?.[1] ?? 0) || null
  // Set scores come as "6" or "7.7" (games.tiebreak points); a fixture not yet started still lists 0-0.
  const rows = state === 'pre' ? [] : [...(e.scores ?? [])].sort((x, y) => x.score_set - y.score_set)
  const parse = (v) => {
    const [g, tb] = String(v).split('.')
    return { v: +g, tb: tb != null && tb !== '0' ? +tb : null }
  }
  const sets = rows.map((r) => {
    const a = parse(r.score_first)
    const b = parse(r.score_second)
    // Every set is decided once the match is over; while live only the ones before the current set are.
    if ((state === 'post' || +r.score_set < period) && a.v !== b.v) [a.won, b.won] = [a.v > b.v, b.v > a.v]
    return [a, b]
  })
  const player = (idx) => {
    const name = idx ? e.event_second_player : e.event_first_player
    return {
      id: `at-${idx ? e.second_player_key : e.first_player_key}`,
      doubles,
      name,
      short: name,
      flags: [],
      country: '',
      winner: e.event_winner === (idx ? 'Second Player' : 'First Player'),
      serving: e.event_serve === (idx ? 'Second Player' : 'First Player'),
      sets: sets.map((s) => s[idx]),
    }
  }
  const round = (e.tournament_round ?? '').split(' - ').pop()
  return {
    id: String(e.event_key),
    eventId,
    eventName: e.tournament_name,
    grouping: doubles ? 'Doubles' : 'Singles',
    round: e.event_qualification === 'True' ? `Qualifying ${round}`.trim() : round,
    date: `${e.event_date}T${e.event_time}:00Z`,
    state,
    period: period ?? sets.length,
    bestOf: 3,
    statusName: FINISHED[e.event_status],
    detail: state === 'pre' ? '' : e.event_status,
    players: [player(0), player(1)],
  }
}

const BOOK_NAMES = { Pncl: 'Pinnacle', Sbo: 'SBOBET', WilliamHill: 'William Hill', Marathon: 'Marathon Bet' }

// "A. Eala" / "Alexandra Eala" -> "eala": compare players across APIs by accent-free surname.
const surname = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().split(/\s+/).pop()
const bookKey = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
const pairKey = (a, b) => [surname(a), surname(b)].sort().join('|')

async function getJson(url) {
  const res = await fetch(url)
  if (res.status === 401) throw httpError(503, 'ODDS_API_KEY буруу байна.')
  if (res.status === 429) throw httpError(429, 'The Odds API хязгаар хэтэрлээ.')
  if (!res.ok) throw httpError(502, `Odds API алдаа: ${res.status}`)
  return res.json()
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(httpError(400, 'Буруу хүсэлт'))
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}
