import { onMounted, onBeforeUnmount, ref } from 'vue'

// Calls `load` immediately, then again after `interval()` ms. The interval is
// re-evaluated each tick so it can speed up while a game is live.
export function usePolling(load, interval) {
  const loading = ref(true)
  const error = ref(null)
  const updatedAt = ref(null)
  let timer = null
  let stopped = false

  async function tick() {
    try {
      await load()
      error.value = null
      updatedAt.value = new Date()
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
      if (!stopped) timer = setTimeout(tick, interval())
    }
  }

  function refresh() {
    clearTimeout(timer)
    tick()
  }

  // Pause while the tab is hidden, refresh immediately when it comes back.
  function onVisibility() {
    if (document.hidden) clearTimeout(timer)
    else refresh()
  }

  onMounted(() => {
    tick()
    document.addEventListener('visibilitychange', onVisibility)
  })
  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { loading, error, updatedAt, refresh }
}
