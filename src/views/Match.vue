<script setup>
import { computed, ref, watch } from 'vue'
import {
  fetchAthlete, fetchLive, fetchOdds, fetchPrediction, fetchRankings, fetchTournaments, findLive, findOdds, withLive, currentBooks,
  fmtDay, fmtTime, roundText, statusText, TOURS,
} from '../api'
import { usePolling } from '../usePolling'
import CompareRow from '../components/CompareRow.vue'
import MatchRow from '../components/MatchRow.vue'

// modal: rendered inside MatchModal — no back link, and path matches open in place via 'select'.
const props = defineProps({ tour: String, id: String, modal: Boolean })
const emit = defineEmits(['select'])

const tournaments = ref([])
const ranks = ref({})

fetchRankings(props.tour)
  .then((list) => (ranks.value = Object.fromEntries(list.map((r) => [r.id, r]))))
  .catch(() => {})

const match = computed(() => {
  for (const t of tournaments.value) {
    const m = t.matches.find((x) => x.id === props.id)
    if (m) return m
  }
  return null
})

const { loading, error, updatedAt } = usePolling(
  async () => {
    tournaments.value = await fetchTournaments(props.tour)
    if (match.value?.state === 'in') {
      if (odds.value) loadOdds()
      fetchLive(props.tour)
        .then((list) => (live.value = findLive(list, match.value.players)))
        .catch(() => {})
    }
  },
  () => (match.value?.state === 'in' ? 15000 : 60000),
)

// While live, set scores come from api-tennis (ESPN lags); see withLive.
const shown = computed(() => match.value && withLive(match.value, live.value))
const players = computed(() => shown.value?.players ?? [])

const odds = ref(null)
const oddsError = ref(null)
const athletes = ref({})
const ai = ref(null)
const aiLoading = ref(false)
const aiError = ref(null)

// Point score, server and match stats from api-tennis while the match is live.
const live = ref(null)

const STATS = [
  { key: 'Aces', label: 'Ace' },
  { key: 'Double Faults', label: 'Давхар алдаа', lowerBetter: true },
  { key: '1st serve percentage', label: '1-р серв орсон %' },
  { key: '1st serve points won', label: '1-р сервээр хожсон оноо %' },
  { key: '2nd serve points won', label: '2-р сервээр хожсон оноо %' },
  { key: 'Break Points Converted', label: 'Брейк пойнт ашигласан %' },
  { key: 'Break Points Saved', label: 'Брейк пойнт хамгаалсан %' },
  { key: 'Winners', label: 'Winner цохилт' },
  { key: 'Unforced errors', label: 'Албадлагагүй алдаа', lowerBetter: true },
  { key: 'Total Points Won', label: 'Нийт хожсон оноо %' },
]
const liveStats = computed(() => {
  const [a, b] = live.value?.stats ?? []
  if (!a || !b) return []
  return STATS.filter((s) => a[s.key] != null || b[s.key] != null).map((s) => ({ ...s, a: a[s.key], b: b[s.key] }))
})

const loadOdds = () =>
  fetchOdds(props.tour)
    .then((events) => (odds.value = findOdds(events, players.value) ?? []))
    .catch((e) => (oddsError.value = e.message))

// Load odds and player profiles once, when the match first resolves; live odds also refresh on each poll.
watch(
  () => match.value?.id,
  (id) => {
    if (!id) return
    loadOdds()
    for (const p of players.value) {
      if (!p.doubles) fetchAthlete(props.tour, p.id).then((a) => a && (athletes.value = { ...athletes.value, [p.id]: a }))
    }
  },
)

// Bookmaker consensus: each book's implied probability with its margin removed, averaged.
const market = computed(() => {
  const books = currentBooks(odds.value)
  if (!books.length) return null
  const fair = books.map((x) => 1 / x.a / (1 / x.a + 1 / x.b))
  const pa = fair.reduce((s, v) => s + v, 0) / fair.length
  return {
    pa,
    live: books[0].phase === 'live',
    bestA: Math.max(...books.map((x) => x.a)),
    bestB: Math.max(...books.map((x) => x.b)),
  }
})

// Table sections: in-play prices first, then pre-match (often only api-tennis has those for a live match).
const oddsGroups = computed(() =>
  [
    { key: 'live', label: 'LIVE', rows: odds.value?.filter((b) => b.phase === 'live') ?? [] },
    { key: 'pre', label: 'Тоглолтын өмнөх', rows: odds.value?.filter((b) => b.phase !== 'live') ?? [] },
  ].filter((g) => g.rows.length),
)
const setCount = computed(() => Math.max(0, ...players.value.map((p) => p.sets.length)))

// All matches this player has in the same tournament and draw.
const pathOf = (pid) =>
  tournaments.value
    .find((t) => t.id === match.value?.eventId)
    ?.matches.filter((m) => m.grouping === match.value.grouping && m.players.some((p) => p.id === pid))
    .sort((a, b) => new Date(a.date) - new Date(b.date)) ?? []

// Matches/sets/games won and lost in this tournament, counting finished matches only.
function tournamentStats(pid) {
  const s = { mw: 0, ml: 0, sw: 0, sl: 0, gw: 0, gl: 0, tbw: 0, tbl: 0 }
  for (const m of pathOf(pid)) {
    if (m.state !== 'post') continue
    const me = m.players.find((p) => p.id === pid)
    const opp = m.players.find((p) => p.id !== pid)
    if (!opp) continue
    me.winner ? s.mw++ : s.ml++
    me.sets.forEach((set, i) => {
      const o = opp.sets[i]?.v ?? 0
      s.gw += set.v
      s.gl += o
      if (set.won) s.sw++
      else if (opp.sets[i]?.won) s.sl++
      if (set.tb != null) set.won ? s.tbw++ : s.tbl++
    })
  }
  return s
}

const cmp = computed(() => {
  const [a, b] = players.value
  if (!a || !b) return null
  const ra = ranks.value[a.id]
  const rb = ranks.value[b.id]
  const ta = tournamentStats(a.id)
  const tb = tournamentStats(b.id)
  const pct = (w, l) => (w + l ? Math.round((w / (w + l)) * 100) : null)
  // Bradley–Terry on ranking points: P(A wins) = ptsA / (ptsA + ptsB). Fair odds = 1 / P (no bookmaker margin).
  const pa = ra?.points && rb?.points ? ra.points / (ra.points + rb.points) : null
  const toOdds = (p) => (p ? (1 / p).toFixed(2) : null)
  const pa_ = athletes.value[a.id]
  const pb_ = athletes.value[b.id]
  const year = new Date().getFullYear()
  return {
    profile: [
      { label: 'Өндөр (см)', a: cm(pa_?.height), b: cm(pb_?.height) },
      { label: 'Тоглодог гар', a: pa_?.hand, b: pb_?.hand },
      { label: 'Мэргэжлийн жил', a: pa_?.debut && year - pa_.debut, b: pb_?.debut && year - pb_.debut },
    ].filter((r) => r.a != null || r.b != null),
    odds: pa == null ? [] : [
      { label: 'Ялах магадлал %', a: Math.round(pa * 100), b: Math.round((1 - pa) * 100) },
      { label: 'Тооцоот коэффициент', a: toOdds(pa), b: toOdds(1 - pa), lowerBetter: true },
    ],
    ranking: [
      { label: 'Дэлхийн рейтинг', a: ra?.rank, b: rb?.rank, lowerBetter: true },
      { label: 'Рейтингийн оноо', a: ra?.points, b: rb?.points },
      { label: 'Өмнөх долоо хоногийн байр', a: ra?.previous, b: rb?.previous, lowerBetter: true },
      { label: 'Нас', a: ra?.age, b: rb?.age },
    ].filter((r) => r.a != null || r.b != null),
    tourney: [
      { label: 'Хожсон тоглолт', a: ta.mw, b: tb.mw },
      { label: 'Хожсон сет', a: ta.sw, b: tb.sw },
      { label: 'Алдсан сет', a: ta.sl, b: tb.sl, lowerBetter: true },
      { label: 'Хожсон гейм', a: ta.gw, b: tb.gw },
      { label: 'Сет хожлын %', a: pct(ta.sw, ta.sl), b: pct(tb.sw, tb.sl) },
      { label: 'Гейм хожлын %', a: pct(ta.gw, ta.gl), b: pct(tb.gw, tb.gl) },
      { label: 'Тайбрейк хожсон', a: ta.tbw, b: tb.tbw },
      { label: 'Тайбрейк алдсан', a: ta.tbl, b: tb.tbl, lowerBetter: true },
    ],
  }
})

// ESPN gives heights like 6' 3".
function cm(h) {
  const m = h?.match(/(\d+)'\s*(\d+)?/)
  return m ? Math.round((+m[1] * 12 + +(m[2] ?? 0)) * 2.54) : null
}

async function runPrediction() {
  const m = match.value
  aiLoading.value = true
  aiError.value = null
  try {
    ai.value = await fetchPrediction({
      matchId: m.id,
      state: m.state,
      tournament: m.eventName,
      draw: m.grouping,
      round: m.round,
      score: m.players.map((p) => p.sets.map((x) => x.v)),
      players: m.players.map((p) => ({
        name: p.name,
        country: p.country,
        seed: p.seed,
        ranking: ranks.value[p.id] && { rank: ranks.value[p.id].rank, points: ranks.value[p.id].points },
        profile: athletes.value[p.id],
        tournamentStats: tournamentStats(p.id),
      })),
      bookmakerConsensusProbA: market.value && Math.round(market.value.pa * 100),
    })
  } catch (e) {
    aiError.value = e.message
  } finally {
    aiLoading.value = false
  }
}

const tourName = computed(() => TOURS.find((t) => t.key === props.tour)?.name)
</script>

<template>
  <section>
    <router-link v-if="!modal" :to="`/t/${tour}`" class="back">‹ {{ tourName }} тэмцээнүүд</router-link>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="loading" class="skeleton big"></div>
    <p v-else-if="!match" class="empty">Тоглолт олдсонгүй (тэмцээн дууссан байж магадгүй).</p>

    <template v-else>
      <div class="match-meta">
        <b>{{ match.eventName }}</b> · {{ match.grouping }} · {{ roundText(match.round) }}
        <template v-if="match.court"> · 🏟 {{ match.court }}</template>
      </div>

      <div class="scorebox" :class="match.state">
        <div class="sb-status">
          <span v-if="match.state === 'in'" class="live-badge">LIVE</span>
          <template v-if="match.state === 'pre'">{{ fmtDay(match.date) }} · {{ fmtTime(match.date) }}</template>
          <template v-else>{{ statusText(shown) }}</template>
        </div>
        <table class="set-table">
          <thead>
            <tr>
              <th class="left">Тоглогч</th>
              <th v-if="live" class="game-col">Гейм</th>
              <th v-for="i in setCount" :key="i">{{ i }}-р сет</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, idx) in players" :key="p.id" :class="[{ winner: p.winner }, idx ? 'p-b' : 'p-a']">
              <td class="left player-cell">
                <i class="side-dot"></i>
                <span class="flags"><img v-for="f in p.flags" :key="f" :src="f" alt="" /></span>
                <span>
                  <span class="pname">{{ p.name }}<i v-if="match.state === 'in' && (live?.serve != null ? live.serve === idx : p.serving)" class="sb-serve" title="Серв хийж байна">🎾</i></span>
                  <small class="muted">
                    {{ p.country }}<template v-if="ranks[p.id]"> · #{{ ranks[p.id].rank }}</template>
                  </small>
                </span>
              </td>
              <td v-if="live" class="set-cell game-cell">{{ live.game[idx] }}</td>
              <td v-for="i in setCount" :key="i" class="set-cell" :class="{ won: p.sets[i - 1]?.won }">
                {{ p.sets[i - 1]?.v ?? '' }}<sup v-if="p.sets[i - 1]?.tb != null">{{ p.sets[i - 1].tb }}</sup>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="match.note && !shown.liveStatus" class="sb-note">{{ match.note }}</p>
      </div>
      <div class="updated center" v-if="updatedAt">
        <span class="pulse" :class="{ on: match.state === 'in' }"></span>
        Шинэчлэгдсэн {{ updatedAt.toLocaleTimeString('mn-MN', { hour12: false }) }}
      </div>

      <div v-if="cmp" class="panel">
        <div class="legend">
          <span><i class="home"></i>{{ players[0].short }}</span>
          <span><i class="away"></i>{{ players[1].short }}</span>
        </div>
        <template v-if="liveStats.length">
          <h3>Тоглолтын статистик <span class="live-badge">LIVE</span></h3>
          <CompareRow v-for="r in liveStats" :key="r.key" v-bind="r" />
        </template>
        <h3 :class="{ mt: liveStats.length }">Букмекерын коэффициент</h3>
        <CompareRow
          v-if="live?.winOdds"
          label="LIVE коэффициент (ялагч)"
          :a="live.winOdds[0].toFixed(2)"
          :b="live.winOdds[1].toFixed(2)"
          lower-better
        />
        <p v-if="oddsError" class="muted odds-note">{{ oddsError }}</p>
        <p v-else-if="!odds" class="muted odds-note">Ачаалж байна…</p>
        <p v-else-if="!odds.length && !live?.winOdds" class="muted odds-note">Энэ тоглолтод коэффициент олдсонгүй.</p>
        <template v-else-if="odds.length">
          <CompareRow :label="market.live ? 'Зах зээлийн магадлал % (LIVE)' : 'Зах зээлийн магадлал %'" :a="Math.round(market.pa * 100)" :b="Math.round((1 - market.pa) * 100)" />
          <CompareRow label="Хамгийн өндөр коэффициент" :a="market.bestA.toFixed(2)" :b="market.bestB.toFixed(2)" lower-better />
          <table class="odds-table">
            <tbody v-for="g in oddsGroups" :key="g.key">
              <tr v-if="oddsGroups.length > 1" class="odds-group"><td colspan="3">{{ g.label }}</td></tr>
              <tr v-for="x in g.rows" :key="x.source + x.title">
                <td class="left">{{ x.title }} <small class="odds-src">{{ x.source }}</small></td>
                <td :class="{ best: g.key === (market.live ? 'live' : 'pre') && x.a === market.bestA }">{{ x.a.toFixed(2) }}</td>
                <td :class="{ best: g.key === (market.live ? 'live' : 'pre') && x.b === market.bestB }">{{ x.b.toFixed(2) }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <h3 class="mt">AI ялах магадлал</h3>
        <template v-if="ai">
          <CompareRow label="AI таамаг %" :a="ai.probA" :b="100 - ai.probA" />
          <p class="ai-summary">{{ ai.summary }}</p>
          <ul class="ai-factors"><li v-for="f in ai.factors" :key="f">{{ f }}</li></ul>
          <p class="muted odds-note">
            Итгэл: {{ { low: 'бага', medium: 'дунд', high: 'өндөр' }[ai.confidence] }} · {{ ai.model }}
          </p>
        </template>
        <p v-if="aiError" class="error">{{ aiError }}</p>
        <button class="btn-ghost ai-btn" :disabled="aiLoading" @click="runPrediction">
          {{ aiLoading ? 'Шинжилж байна…' : ai ? 'Дахин таамаглах' : 'AI таамаг гаргах' }}
        </button>

        <template v-if="cmp.odds.length">
          <h3 class="mt">Рейтингийн загвар</h3>
          <CompareRow v-for="r in cmp.odds" :key="r.label" v-bind="r" />
          <p class="muted odds-note">Рейтингийн онооноос тооцсон таамаг — букмекерын коэффициент биш.</p>
        </template>
        <template v-if="cmp.ranking.length">
          <h3 class="mt">Рейтинг харьцуулалт</h3>
          <CompareRow v-for="r in cmp.ranking" :key="r.label" v-bind="r" />
        </template>
        <template v-if="cmp.profile.length">
          <h3 class="mt">Тоглогчийн мэдээлэл</h3>
          <CompareRow v-for="r in cmp.profile" :key="r.label" v-bind="r" />
        </template>
        <h3 class="mt">Энэ тэмцээн дэх үзүүлэлт</h3>
        <CompareRow v-for="r in cmp.tourney" :key="r.label" v-bind="r" />
      </div>

      <div class="form-grid">
        <div v-for="p in players" :key="p.id" class="panel">
          <h3>{{ p.short }} — тэмцээн дэх замнал</h3>
          <div class="match-list">
            <MatchRow v-for="m in pathOf(p.id)" :key="m.id" :match="m" :tour="tour" :ranks="ranks"
              :on-select="modal ? (x) => emit('select', x) : null" />
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
