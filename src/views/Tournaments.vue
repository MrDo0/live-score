<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fetchLive, fetchOdds, fetchRankings, fetchTournaments, fmtDay, roundText } from '../api'
import { usePolling } from '../usePolling'
import MatchRow from '../components/MatchRow.vue'
import MatchModal from '../components/MatchModal.vue'

const props = defineProps({ tour: String })

const tournaments = ref([])
const ranks = ref({})
// 'all' shows every tournament's matches together.
const ALL = 'all'
const selected = ref(ALL)
const grouping = ref(null)
const filter = ref('all')
const round = ref('')

fetchRankings(props.tour)
  .then((list) => (ranks.value = Object.fromEntries(list.map((r) => [r.id, r]))))
  .catch(() => {}) // ranks are a nice-to-have on this page

// Odds are optional: without the backend or a key the list just shows no prices.
// Reloaded on every poll so live prices move; fetchOdds/server caching keep the quota cost low.
const oddsEvents = ref(null)
const loadOdds = () =>
  fetchOdds(props.tour)
    .then((list) => (oddsEvents.value = list))
    .catch(() => {})

const openMatch = ref(null)

// Point-level live scores (api-tennis); optional like odds.
const liveEvents = ref(null)
const loadLive = () =>
  fetchLive(props.tour)
    .then((list) => (liveEvents.value = list))
    .catch(() => {})

// Tournament tabs scroll horizontally: mouse wheel, arrow buttons, or touch swipe.
const tabsEl = ref(null)
const canLeft = ref(false)
const canRight = ref(false)
function updateArrows() {
  const el = tabsEl.value
  if (!el) return
  canLeft.value = el.scrollLeft > 2
  canRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
}
function onTabsWheel(e) {
  const el = tabsEl.value
  if (!el || el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
  e.preventDefault()
  el.scrollLeft += e.deltaY
}
const scrollTabs = (dir) => tabsEl.value?.scrollBy({ left: dir * tabsEl.value.clientWidth * 0.8, behavior: 'smooth' })
watch(tabsEl, () => nextTick(updateArrows))
onMounted(() => window.addEventListener('resize', updateArrows))
onBeforeUnmount(() => window.removeEventListener('resize', updateArrows))

const hasLive = computed(() => tournaments.value.some((t) => t.matches.some((m) => m.state === 'in')))

// Today's matches, plus any still live from last night.
const isToday = (m) => m.state === 'in' || new Date(m.date).toDateString() === new Date().toDateString()
// Only tournaments with a match today get a tab.
const playsToday = (t) => t.matches.some(isToday)
const todays = computed(() => tournaments.value.filter(playsToday))
watch(todays, () => nextTick(updateArrows))

const { loading, error, updatedAt, refresh } = usePolling(
  async () => {
    tournaments.value = await fetchTournaments(props.tour)
    loadOdds()
    if (hasLive.value) loadLive()
  },
  () => (hasLive.value ? 15000 : 60000),
)

// Default to the first tournament that has something live.
watch(todays, (list) => {
  if (selected.value !== ALL && !list.find((t) => t.id === selected.value)) selected.value = ALL
})

const matches = computed(() =>
  selected.value === ALL
    ? todays.value.flatMap((t) => t.matches)
    : todays.value.find((t) => t.id === selected.value)?.matches ?? [],
)
const groupings = computed(() => [...new Set(matches.value.filter(isToday).map((m) => m.grouping))])
watch(groupings, (g) => {
  if (!g.includes(grouping.value)) grouping.value = g[0]
})

const pool = computed(() => matches.value.filter((m) => m.grouping === grouping.value && isToday(m)))
const rounds = computed(() => [...new Set(pool.value.map((m) => m.round))])
const counts = computed(() => ({
  all: pool.value.length,
  in: pool.value.filter((m) => m.state === 'in').length,
  pre: pool.value.filter((m) => m.state === 'pre').length,
  post: pool.value.filter((m) => m.state === 'post').length,
}))

const FILTERS = [
  { key: 'all', label: 'Бүгд' },
  { key: 'in', label: 'LIVE' },
  { key: 'pre', label: 'Удахгүй' },
  { key: 'post', label: 'Дууссан' },
]

// Live first, then upcoming by start time, then finished newest first; grouped by day.
const days = computed(() => {
  const order = { in: 0, pre: 1, post: 2 }
  const list = pool.value
    .filter((m) => filter.value === 'all' || m.state === filter.value)
    .filter((m) => !round.value || m.round === round.value)
    .sort((a, b) => {
      if (a.state !== b.state) return order[a.state] - order[b.state]
      const d = new Date(a.date) - new Date(b.date)
      return a.state === 'post' ? -d : d
    })
  const groups = []
  for (const m of list) {
    const label = m.state === 'in' ? 'Одоо явагдаж байна' : fmtDay(m.date)
    let g = groups.at(-1)
    if (!g || g.label !== label) groups.push((g = { label, matches: [] }))
    g.matches.push(m)
  }
  return groups
})
</script>

<template>
  <section>
    <div class="page-head">
      <h1>Энэ долоо хоногийн тэмцээнүүд</h1>
      <div class="updated" v-if="updatedAt">
        <span class="pulse" :class="{ on: hasLive }"></span>
        Шинэчлэгдсэн {{ updatedAt.toLocaleTimeString('mn-MN', { hour12: false }) }}
        <button class="btn-ghost" @click="refresh">↻</button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="loading" class="skeleton-list">
      <div v-for="i in 5" :key="i" class="skeleton"></div>
    </div>
    <p v-else-if="!todays.length" class="empty">Өнөөдөр тоглолттой тэмцээн алга.</p>

    <template v-else>
      <div class="tabs-scroller" :class="{ 'can-left': canLeft, 'can-right': canRight }">
      <button v-if="canLeft" class="tabs-arrow left" aria-label="Өмнөх" @click="scrollTabs(-1)">‹</button>
      <div ref="tabsEl" class="tourney-tabs" @wheel="onTabsWheel" @scroll="updateArrows">
        <button :class="{ active: selected === ALL }" @click="(selected = ALL), (round = '')">
          <span v-if="hasLive" class="pulse on"></span>
          <b>Бүгд</b>
          <small>{{ todays.length }} тэмцээн</small>
        </button>
        <button
          v-for="t in todays"
          :key="t.id"
          :class="{ active: t.id === selected }"
          @click="(selected = t.id), (round = '')"
        >
          <span v-if="t.matches.some((m) => m.state === 'in')" class="pulse on"></span>
          <b>{{ t.name }}</b>
          <small>{{ t.venue }}</small>
        </button>
      </div>
      <button v-if="canRight" class="tabs-arrow right" aria-label="Дараах" @click="scrollTabs(1)">›</button>
      </div>

      <div class="toolbar">
        <div class="days">
          <button v-for="g in groupings" :key="g" :class="{ active: grouping === g }" @click="(grouping = g), (round = '')">
            {{ g.includes('Doubles') ? 'Хос' : 'Ганцаарчилсан' }}
          </button>
          <span class="nav-sep"></span>
          <button v-for="f in FILTERS" :key="f.key" :class="{ active: filter === f.key, live: f.key === 'in' && counts.in }" @click="filter = f.key">
            {{ f.label }} <small>{{ counts[f.key] }}</small>
          </button>
        </div>
        <select v-model="round" class="select">
          <option value="">Бүх тойрог</option>
          <option v-for="r in rounds" :key="r" :value="r">{{ roundText(r) }}</option>
        </select>
      </div>

      <p v-if="!days.length" class="empty">
        {{ filter === 'in' ? 'Одоогоор шууд явагдаж буй тоглолт алга.' : 'Тоглолт олдсонгүй.' }}
      </p>
      <div v-for="d in days" :key="d.label" class="day-group">
        <h4 class="day-label">{{ d.label }}</h4>
        <div class="match-list">
          <MatchRow v-for="m in d.matches" :key="m.id" :match="m" :tour="tour" :ranks="ranks" :odds-events="oddsEvents" :live-events="liveEvents"
            :on-select="(x) => (openMatch = x.id)" />
        </div>
      </div>
    </template>
    <MatchModal v-if="openMatch" :tour="tour" :id="openMatch" @select="(x) => (openMatch = x.id)" @close="openMatch = null" />
  </section>
</template>
