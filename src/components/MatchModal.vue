<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import Match from '../views/Match.vue'

defineProps({ tour: String, id: String })
const emit = defineEmits(['close', 'select'])

const onKey = (e) => e.key === 'Escape' && emit('close')
onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-bar">
          <a :href="`#/m/${tour}/${id}`" class="modal-full">Бүтэн хуудсаар нээх ↗</a>
          <button class="modal-close" aria-label="Хаах" @click="emit('close')">✕</button>
        </div>
        <Match :key="id" :tour="tour" :id="id" modal @select="(m) => emit('select', m)" />
      </div>
    </div>
  </Teleport>
</template>
