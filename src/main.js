import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Tournaments from './views/Tournaments.vue'
import Match from './views/Match.vue'
import Rankings from './views/Rankings.vue'
import './style.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/t/atp' },
    { path: '/t/:tour', component: Tournaments, props: true },
    { path: '/m/:tour/:id', component: Match, props: true },
    { path: '/r/:tour', component: Rankings, props: true },
  ],
})

createApp(App).use(router).mount('#app')
