<script setup>
import { computed, onMounted, ref } from 'vue'
import { fetchRankings, rankingTour, TOURS } from '../api'

const props = defineProps({ tour: String })

const list = ref([])
const loading = ref(true)
const error = ref(null)
const q = ref('')

onMounted(async () => {
  try {
    list.value = await fetchRankings(props.tour)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

const shown = computed(() => {
  const s = q.value.trim().toLowerCase()
  return s ? list.value.filter((r) => `${r.name} ${r.country}`.toLowerCase().includes(s)) : list.value
})
const move = (r) => (r.previous && r.previous !== r.rank ? r.previous - r.rank : 0)
const tourName = computed(() => TOURS.find((t) => t.key === rankingTour(props.tour))?.name)
</script>

<template>
  <section>
    <div class="page-head">
      <h1>{{ tourName }} рейтинг</h1>
      <input v-model="q" class="search" placeholder="Тоглогч, улс хайх…" />
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="loading" class="skeleton big"></div>
    <div v-else class="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th></th>
            <th class="left">Тоглогч</th>
            <th>Нас</th>
            <th>Оноо</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id">
            <td><b>{{ r.rank }}</b></td>
            <td class="trend" :class="{ up: move(r) > 0, down: move(r) < 0 }">
              {{ move(r) > 0 ? `▲${move(r)}` : move(r) < 0 ? `▼${-move(r)}` : '–' }}
            </td>
            <td class="left">
              <span class="player-cell">
                <img :src="r.flag" alt="" class="flag" />
                {{ r.name }} <small class="muted">{{ r.country }}</small>
              </span>
            </td>
            <td>{{ r.age }}</td>
            <td><b>{{ r.points.toLocaleString() }}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
