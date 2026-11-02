<script setup>
import { computed } from 'vue'

// lowerBetter: e.g. ranking, where #3 beats #40.
const props = defineProps({ label: String, a: [Number, String], b: [Number, String], lowerBetter: Boolean })

const na = computed(() => parseFloat(props.a))
const nb = computed(() => parseFloat(props.b))
const valid = computed(() => !isNaN(na.value) && !isNaN(nb.value))

const share = computed(() => {
  if (!valid.value) return 50
  let [x, y] = [na.value, nb.value]
  if (props.lowerBetter) [x, y] = [y, x]
  return x + y === 0 ? 50 : (x / (x + y)) * 100
})
const lead = computed(() => {
  if (!valid.value || na.value === nb.value) return 0
  return (na.value > nb.value) !== props.lowerBetter ? 1 : -1
})
</script>

<template>
  <div class="stat-row">
    <div class="stat-vals">
      <span :class="{ lead: lead > 0 }">{{ a ?? '—' }}</span>
      <span class="stat-label">{{ label }}</span>
      <span :class="{ lead: lead < 0 }">{{ b ?? '—' }}</span>
    </div>
    <div class="stat-bar">
      <div class="home" :style="{ width: share + '%' }"></div>
      <div class="away" :style="{ width: 100 - share + '%' }"></div>
    </div>
  </div>
</template>
