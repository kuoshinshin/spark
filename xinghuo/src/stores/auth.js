import { defineStore } from 'pinia'
import { clearCache } from '../services/api'
import { normalizeAvatar } from '../utils/avatar'

const LS_TOKEN = 'token'
const LS_LOGGED = 'isLoggedIn'
const LS_USER = 'userData'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null,
    userData: null
  }),

  getters: {
    isLoggedIn: (state) => Boolean(state.token),
    isAdmin: (state) => ['admin', 'superadmin'].includes(state.userData?.role)
  },

  actions: {
    hydrateFromStorage () {
      const token = localStorage.getItem(LS_TOKEN)
      const logged = localStorage.getItem(LS_LOGGED)
      const raw = localStorage.getItem(LS_USER)
      if (!token || logged !== 'true' || !raw) {
        this.token = null
        this.userData = null
        return
      }
      try {
        const user = JSON.parse(raw)
        this.token = token
        this.userData = {
          username: user.username,
          avatar: normalizeAvatar(user.avatar),
          role: user.role || 'user',
          id: user.id
        }
        if (!this.userData.role) this.userData.role = 'user'
      } catch {
        this.clearSessionStorageOnly()
        this.token = null
        this.userData = null
      }
    },

    clearSessionStorageOnly () {
      localStorage.removeItem(LS_LOGGED)
      localStorage.removeItem(LS_USER)
      localStorage.removeItem(LS_TOKEN)
    },

    login (payload) {
      const { token, ...user } = payload
      if (!token) return
      this.token = token
      this.userData = {
        username: user.username,
        avatar: normalizeAvatar(user.avatar),
        role: user.role || 'user',
        id: user.id
      }
      localStorage.setItem(LS_TOKEN, token)
      localStorage.setItem(LS_LOGGED, 'true')
      localStorage.setItem(LS_USER, JSON.stringify(this.userData))
    },

    logout () {
      this.clearSessionStorageOnly()
      this.token = null
      this.userData = null
      clearCache()
    }
  }
})
