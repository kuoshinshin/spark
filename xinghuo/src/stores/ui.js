import { defineStore } from 'pinia'

const LS_DARK = 'darkMode'

export const useUiStore = defineStore('ui', {
  state: () => ({
    canInstallPWA: false,
    isInstallingPWA: false
  }),

  actions: {
    applyDarkClass (enabled) {
      if (enabled) {
        document.documentElement.classList.add('dark-mode')
      } else {
        document.documentElement.classList.remove('dark-mode')
      }
    },

    initDarkModeFromStorage () {
      const saved = localStorage.getItem(LS_DARK)
      if (saved === null) return
      const enabled = saved === 'true'
      this.applyDarkClass(enabled)
    },

    setCanInstallPWA (v) {
      this.canInstallPWA = Boolean(v)
    },

    setInstallingPWA (v) {
      this.isInstallingPWA = Boolean(v)
    }
  }
})
