<script setup>
import { computed } from 'vue'
import { currentBooks, findLive, findOdds, fmtTime, roundText, statusText, withLive } from '../api'

// oddsEvents: optional list from fetchOdds(); shows each player's best bookmaker price.
// onSelect: when given, a plain click opens the match through it (e.g. a modal) instead of navigating.
// liveEvents: optional list from fetchLive(); adds the current game score and server.
const props = defineProps({
  match: Object, tour: String, ranks: Object, oddsEvents: Array, liveEvents: Array, onSelect: Function,
})

function onClick(e) {
  // Let ctrl/cmd/middle-click open the full page in a new tab.
  if (!props.onSelect || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  props.onSelect(props.match)
}

const live = computed(() => props.match.state === 'in')
const point = computed(() => (live.value ? findLive(props.liveEvents, props.match.players) : null))
// The match as displayed: ESPN data with api-tennis set scores swapped in while live.
const m = computed(() => withLive(props.match, point.value))
const serving = (p, idx) => (point.value?.serve != null ? point.value.serve === idx : p.serving)

// Finished matches show only the sets played; otherwise pad to best-of with dots for unplayed sets.
const setCount = computed(() => {
  const played = Math.max(...m.value.players.map((p) => p.sets.length), 0)
  return m.value.state === 'post' ? played : Math.max(played, m.value.bestOf)
})

const best = computed(() => {
  if (props.match.state === 'post') return null
  // In-play price updates every ~15s, so it beats the bookmaker snapshot while live.
  if (point.value?.winOdds) return point.value.winOdds
  if (!props.oddsEvents) return null
  const books = currentBooks(findOdds(props.oddsEvents, props.match.players))
  if (!books?.length) return null
  return [Math.max(...books.map((x) => x.a)), Math.max(...books.map((x) => x.b))]
})

const footer = computed(() => {
  const x = m.value
  if (x.state === 'in') return x.liveStatus ? statusText(x) : `${x.period}-р сет`
  if (x.state === 'pre') return `Эхлэх: ${fmtTime(x.date)}`
  return statusText(x)
})
</script>

<template>
  <a :href="`#/m/${tour}/${match.id}`" class="match-card" :class="match.state" @click="onClick">
    <div class="mc-head">
      <span class="mc-event">{{ match.eventName }}</span>
      <span class="mc-round">{{ roundText(match.round) }} • {{ match.grouping }}</span>
    </div>

    <div v-for="(p, idx) in m.players" :key="p.id" class="mc-team" :class="{ winner: p.winner, lost: match.state === 'post' && !p.winner }">
      <span class="flags"><img v-for="f in p.flags" :key="f" :src="f" alt="" loading="lazy" /></span>
      <span class="name" :title="ranks?.[p.id] ? `Дэлхийн #${ranks[p.id].rank}` : null">
        {{ p.short }}<small v-if="p.seed" class="seed">({{ p.seed }})</small>
      </span>
      <span class="serve"><i v-if="live && serving(p, idx)" title="Серв хийж байна">🎾</i></span>
      <span v-if="best" class="mc-odds" :class="{ fav: best[idx] < best[1 - idx] }">{{ best[idx].toFixed(2) }}</span>
      <span v-if="point" class="game-pt">{{ point.game[idx] }}</span>
      <span class="sets">
        <span
          v-for="i in setCount"
          :key="i"
          class="set"
          :class="{ won: p.sets[i - 1]?.won, cur: live && i === m.period }"
        >
          <template v-if="p.sets[i - 1]">
            {{ p.sets[i - 1].v }}<sup v-if="p.sets[i - 1].tb != null">{{ p.sets[i - 1].tb }}</sup>
          </template>
          <template v-else>•</template>
        </span>
      </span>
    </div>

    <div class="mc-foot">
      <span v-if="live" class="live-dot"></span>
      {{ footer }}
    </div>
  </a>
</template>
