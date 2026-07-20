import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import MainLayout from '../layouts/MainLayout.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../components/auth/Login.vue'),
      meta: { guest: true }
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('../components/auth/Register.vue'),
      meta: { guest: true }
    },
    {
      path: '/',
      component: MainLayout,
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'home',
          component: () => import('../views/HomeView.vue')
        },
        {
          path: 'chat',
          name: 'chat',
          component: () => import('../components/chat/Chat.vue')
        },
        {
          path: 'match',
          name: 'match',
          component: () => import('../components/match/Match.vue')
        },
        {
          path: 'power-rank',
          name: 'powerRank',
          component: () => import('../components/rank/PowerRank.vue')
        },
        {
          path: 'profile',
          name: 'profile',
          component: () => import('../components/profile/Profile.vue')
        },
        {
          path: 'directory',
          name: 'directory',
          component: () => import('../components/admin/DirectoryManagement.vue'),
          meta: { roles: ['admin', 'superadmin'] }
        }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: { name: 'home' }
    }
  ]
})

router.beforeEach((to, from, next) => {
  const auth = useAuthStore()
  auth.hydrateFromStorage()

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return next({
      name: 'login',
      query: { redirect: to.fullPath }
    })
  }

  if (to.meta.guest && auth.isLoggedIn) {
    return next({ name: 'home' })
  }

  const roles = to.matched.find((r) => r.meta.roles)?.meta.roles
  if (roles?.length) {
    const role = auth.userData?.role
    if (!role || !roles.includes(role)) {
      return next({ name: 'home' })
    }
  }

  next()
})

export default router
