// Dev goes through the Vite proxy; production calls ESPN directly (it sends CORS headers).
const BASE = import.meta.env.DEV ? '/espn' : 'https://site.api.espn.com/apis/site/v2/sports'

// Challenger and WTA 125 come from api-tennis via /api/challenger (ESPN doesn't cover them);
// their players are ranked on the main ATP/WTA lists.
export const TOURS = [
  { key: 'atp', name: 'ATP', desc: 'Эрэгтэй' },
  { key: 'wta', name: 'WTA', desc: 'Эмэгтэй' },
  { key: 'atpc', name: 'Challenger', desc: 'Эрэгтэй', challenger: true, rankings: 'atp' },
  { key: 'wtac', name: 'WTA 125', desc: 'Эмэгтэй', challenger: true, rankings: 'wta' },
]
const tourOf = (key) => TOURS.find((t) => t.key === key)
export const rankingTour = (key) => tourOf(key)?.rankings ?? key

async function get(path) {
  const res = await fetch(`${BASE}/tennis/${path}`)
  if (!res.ok) throw new Error(`API алдаа: ${res.status}`)
  return res.json()
}

// Without a date ESPN returns every match of the current week's tournaments.
export async function fetchTournaments(tour) {
  if (tourOf(tour)?.challenger) return getLocal(`/api/challenger?tour=${tour}`)
  const data = await get(`${tour}/scoreboard`)
  return (data.events ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    venue: e.venue?.displayName ?? e.groupings?.[0]?.competitions?.[0]?.venue?.fullName,
    major: e.major,
    state: e.status?.type?.state,
    matches: (e.groupings ?? []).flatMap((g) =>
      g.competitions.map((c) => normalizeMatch(c, e, g.grouping.displayName)),
    ),
  }))
}

function normalizeMatch(c, event, grouping) {
  const players = [...c.competitors]
    .sort((a, b) => a.order - b.order)
    .map((p) => {
      const people = p.athlete ? [p.athlete] : p.roster?.athletes ?? []
      return {
        id: p.id,
        doubles: p.type === 'team',
        name: p.athlete?.displayName ?? p.roster?.displayName ?? 'TBD',
        short: p.athlete?.shortName ?? p.roster?.shortDisplayName ?? 'TBD',
        flags: people.map((a) => a.flag?.href).filter(Boolean),
        country: people.map((a) => a.flag?.alt).filter(Boolean).join(' / '),
        seed: p.seed ?? p.curatedRank?.current,
        winner: p.winner,
        serving: p.possession,
        sets: (p.linescores ?? []).map((s) => ({ v: s.value, tb: s.tiebreak, won: s.winner })),
      }
    })
  const st = c.status.type
  return {
    id: c.id,
    eventId: event.id,
    eventName: event.name,
    grouping,
    round: c.round?.displayName ?? '',
    date: c.date,
    court: c.venue?.court,
    state: st.state, // 'pre' | 'in' | 'post'
    period: c.status.period,
    // ESPN reports 5 periods for every ATP match; only Grand Slams actually play best of 5.
    bestOf: event.major ? c.format?.regulation?.periods ?? 3 : 3,
    statusName: st.name,
    detail: st.shortDetail || st.detail,
    note: c.notes?.[0]?.text,
    players,
  }
}

const rankingsCache = {}
// Rankings change weekly, so fetch once per session per tour.
export function fetchRankings(key) {
  const tour = rankingTour(key)
  rankingsCache[tour] ??= get(`${tour}/rankings`)
    .then((d) =>
      (d.rankings?.[0]?.ranks ?? []).map((r) => ({
        rank: r.current,
        previous: r.previous,
        points: r.points,
        trend: r.trend,
        id: r.athlete.id,
        name: r.athlete.displayName,
        flag: r.athlete.flag,
        country: r.athlete.flagAltText,
        age: r.athlete.age,
        headshot: r.athlete.headshot,
      })),
    )
    .catch((e) => {
      delete rankingsCache[tour]
      throw e
    })
  return rankingsCache[tour]
}

export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString('mn-MN', { hour: '2-digit', minute: '2-digit', hour12: false })

export const fmtDay = (iso) =>
  new Date(iso).toLocaleDateString('mn-MN', { month: '2-digit', day: '2-digit', weekday: 'short' })

const STATUS_MN = {
  STATUS_FINAL: 'Дууссан',
  STATUS_RETIRED: 'Бууж өгсөн',
  STATUS_WALKOVER: 'Walkover',
  STATUS_POSTPONED: 'Хойшилсон',
  STATUS_CANCELED: 'Цуцалсан',
  STATUS_SUSPENDED: 'Түр зогссон',
}
export const statusText = (m) =>
  m.liveStatus ? liveStatusText(m.liveStatus) : STATUS_MN[m.statusName] ?? m.detail

const ROUND_MN = {
  Final: 'Финал',
  Semifinal: 'Хагас финал',
  Quarterfinal: 'Шөвгийн 8',
  'Round 1': '1-р тойрог',
  'Round 2': '2-р тойрог',
  'Round 3': '3-р тойрог',
  'Round 4': '4-р тойрог',
  'Qualifying 1st Round': 'Сонгон шалгаруулалт 1',
  'Qualifying 2nd Round': 'Сонгон шалгаруулалт 2',
  'Qualifying Final': 'Сонгон шалгаруулалтын финал',
  // api-tennis (Challenger) round names
  '1/32-finals': '1/32 финал',
  '1/16-finals': '1/16 финал',
  '1/8-finals': '1/8 финал',
  'Quarter-finals': 'Шөвгийн 8',
  'Semi-finals': 'Хагас финал',
}
export const roundText = (r) =>
  ROUND_MN[r] ?? (r.startsWith('Qualifying ') ? `Сонгон шалгаруулалт · ${roundText(r.slice(11))}` : r)

async function getLocal(path, init) {
  let res
  try {
    res = await fetch(path, init)
  } catch {
    throw new Error('Сервер холбогдсонгүй')
  }
  const data = await res.json().catch(() => ({}))
  // Static hosting has no /api backend; the HTML fallback fails to parse as JSON.
  if (!res.ok || data.error) throw new Error(data.error ?? 'Энэ функц зөвхөн `npm run dev` / `preview` дээр ажиллана')
  return data
}

// Short client cache so list, modal and polling share one request; the server decides real freshness.
const oddsCache = {}
export function fetchOdds(tour) {
  const hit = oddsCache[tour]
  if (hit && Date.now() - hit.at < 60000) return hit.p
  const p = getLocal(`/api/odds?tour=${tour}`).catch((e) => {
    delete oddsCache[tour]
    throw e
  })
  oddsCache[tour] = { at: Date.now(), p }
  return p
}

const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().split(/\s+/).pop()

// Other APIs spell names differently ("A. Eala" vs "Alexandra Eala"), so match on accent-free surnames.
// Returns { e, swapped } where swapped means the event lists the ESPN players in reverse order.
function matchPair(events, players, names) {
  const [a, b] = players.map((p) => norm(p.name))
  for (const e of events) {
    const [h, w] = names(e).map(norm)
    if (h === a && w === b) return { e, swapped: false }
    if (h === b && w === a) return { e, swapped: true }
  }
  return null
}

// The rows to price a match from: in-play ones when any exist, otherwise pre-match.
export const currentBooks = (books) => {
  const live = books?.filter((b) => b.phase === 'live') ?? []
  return live.length ? live : books ?? []
}

// Bookmakers with `a`/`b` prices aligned to the ESPN player order.
export function findOdds(events, players) {
  const m = matchPair(events, players, (e) => [e.home, e.away])
  if (!m) return null
  return m.e.bookmakers.map((x) => ({ ...x, a: m.swapped ? x.away : x.home, b: m.swapped ? x.home : x.away }))
}

const liveCache = {}
export function fetchLive(tour) {
  const hit = liveCache[tour]
  if (hit && Date.now() - hit.at < 5000) return hit.p
  const p = getLocal(`/api/live?tour=${tour}`).catch((e) => {
    delete liveCache[tour]
    throw e
  })
  liveCache[tour] = { at: Date.now(), p }
  return p
}

// Live point score aligned to the ESPN player order: { game: [a, b], serve: 0|1|null, stats: [a, b] }.
export function findLive(events, players) {
  const m = events && matchPair(events, players, (e) => [e.first, e.second])
  if (!m) return null
  const flip = (pair) => (m.swapped ? [pair[1], pair[0]] : pair)
  const serve = m.e.serve == null ? null : m.swapped ? 1 - m.e.serve : m.e.serve
  return {
    game: flip(m.e.game), serve, stats: flip(m.e.stats), sets: flip(m.e.sets), period: m.e.period, status: m.e.status,
    // In-play match-winner price (api-tennis), [a, b]; null while unavailable or suspended.
    winOdds: m.e.winOdds && !m.e.winOdds.suspended ? flip([m.e.winOdds.home, m.e.winOdds.away]) : null,
  }
}

// ESPN's set scores lag behind; while api-tennis has the match, use its sets and current set instead.
export function withLive(match, live) {
  if (!live) return match
  return {
    ...match,
    period: live.period ?? match.period,
    liveStatus: live.status,
    players: live.sets?.[0]?.length ? match.players.map((p, i) => ({ ...p, sets: live.sets[i] })) : match.players,
  }
}

// api-tennis event_status: "Set 2", "Retired", "Finished", ...
const LIVE_STATUS_MN = {
  Finished: 'Дууссан',
  Retired: 'Бууж өгсөн',
  Walk_over: 'Walkover',
  Suspended: 'Түр зогссон',
  Interrupted: 'Түр зогссон',
  Postponed: 'Хойшилсон',
  Cancelled: 'Цуцалсан',
}
const liveStatusText = (s) => {
  const set = s.match(/^Set (\d)/)
  return set ? `${set[1]}-р сет` : LIVE_STATUS_MN[s] ?? s
}

export const fetchPrediction = (ctx) =>
  getLocal('/api/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ctx),
  })

const athleteCache = {}
export function fetchAthlete(tour, id) {
  // api-tennis (Challenger) players have no ESPN profile.
  if (id.startsWith('at-')) return Promise.resolve(null)
  athleteCache[id] ??= fetch(`https://site.web.api.espn.com/apis/common/v3/sports/tennis/${tour}/athletes/${id}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then(({ athlete: a }) => ({
      age: a.age,
      hand: { RIGHT: 'Баруун', LEFT: 'Зүүн' }[a.hand?.type] ?? a.hand?.displayValue,
      height: a.displayHeight,
      debut: a.debutYear,
    }))
    .catch(() => {
      delete athleteCache[id]
      return null
    })
  return athleteCache[id]
}
