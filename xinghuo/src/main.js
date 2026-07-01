/* 旧版纯 hash 链接迁移到 Vue Router（hash 模式） */
;(function migrateLegacyHash () {
  const { pathname, search, hash } = window.location
  if (hash === '#login' || hash === '#register') {
    window.location.replace(`${pathname}${search}#/${hash.slice(1)}`)
    return
  }
  if (hash.startsWith('#post-')) {
    const id = hash.slice('#post-'.length)
    window.location.replace(`${pathname}${search}#/chat?postId=${encodeURIComponent(id)}`)
    return
  }
  if (hash.startsWith('#profile-')) {
    const id = hash.slice('#profile-'.length)
    window.location.replace(`${pathname}${search}#/profile?userId=${encodeURIComponent(id)}`)
  }
})()

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { useUiStore } from './stores/ui'
import { setUnauthorizedHandler } from './services/sessionBridge'
import { DEFAULT_AVATAR, handleAvatarImgError } from './utils/avatar'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

setUnauthorizedHandler(() => {
  const auth = useAuthStore()
  auth.logout()
  const current = router.currentRoute.value
  if (current.name !== 'login' && current.name !== 'register') {
    router.replace({ name: 'login', query: { redirect: current.fullPath } }).catch(() => {})
  }
})

app.use(ElementPlus)

app.mount('#app')

/** Chromium 可安装应用：需 manifest +（生产环境）含 fetch 的 Service Worker；beforeinstallprompt 在 Pinia 就绪后统一处理 */
let deferredPrompt = null

function registerPwaFeatures () {
  const ui = useUiStore()

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    ui.setCanInstallPWA(true)
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    ui.setCanInstallPWA(false)
    ui.setInstallingPWA(false)
  })

  window.installApp = async () => {
    if (!deferredPrompt) return
    ui.setInstallingPWA(true)
    try {
      await deferredPrompt.prompt()
      await deferredPrompt.userChoice
    } catch (err) {
      console.warn('PWA 安装提示异常:', err)
    } finally {
      deferredPrompt = null
      ui.setInstallingPWA(false)
      if (!window.matchMedia('(display-mode: standalone)').matches) {
        ui.setCanInstallPWA(false)
      }
    }
  }

  const base = import.meta.env.BASE_URL || '/'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const swUrl = `${normalizedBase}sw.js`

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(swUrl, { scope: normalizedBase }).catch((err) => {
        console.warn('Service Worker 注册失败（将影响「安装为应用」）:', err)
      })
    })
  }
}

registerPwaFeatures()

if (import.meta.env.PROD) {
  window.addEventListener('error', (e) => {
    const target = e.target
    if (target?.tagName !== 'IMG') return
    const src = String(target.src || '')
    if (!src.includes('/uploads/') || src.includes('default-avatar')) return
    handleAvatarImgError({ target })
  }, true)
}

