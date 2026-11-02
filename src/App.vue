<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { fetchTournaments, TOURS } from './api'
import { usePolling } from './usePolling'

const route = useRoute()
const tour = computed(() => route.params.tour ?? 'atp')
const onRankings = computed(() => route.path.startsWith('/r/'))

// Red dot on a tour chip while any of its matches is live.
const liveTours = ref({})
usePolling(
  async () => {
    const res = await Promise.allSettled(TOURS.map((t) => fetchTournaments(t.key)))
    liveTours.value = Object.fromEntries(
      TOURS.map((t, i) => [t.key, res[i].value?.some((e) => e.matches.some((m) => m.state === 'in')) ?? false]),
    )
  },
  () => 60000,
)
</script>

<template>
  <header class="topbar">
    <router-link to="/" class="brand"><span class="dot"></span> 🎾 Tennis Live</router-link>
    <nav class="leagues">
      <router-link
        v-for="t in TOURS"
        :key="t.key"
        :to="onRankings ? `/r/${t.key}` : `/t/${t.key}`"
        class="league-chip"
        :class="{ active: tour === t.key }"
      >
        <span v-if="liveTours[t.key]" class="chip-live" title="LIVE тоглолт байна"></span>
        {{ t.name }} <small>{{ t.desc }}</small>
      </router-link>
      <span class="nav-sep"></span>
      <router-link :to="`/t/${tour}`" class="nav-link" :class="{ active: !onRankings }">Тоглолтууд</router-link>
      <router-link :to="`/r/${tour}`" class="nav-link" :class="{ active: onRankings }">Рейтинг</router-link>
    </nav>
  </header>
  <main class="container">
    <router-view :key="$route.fullPath" />
  </main>
  <footer class="footer">Мэдээллийн эх сурвалж: ESPN · LIVE үед 15 сек тутам автоматаар шинэчлэгдэнэ</footer>
</template>
