<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useUiStore } from '../stores/ui'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const ui = useUiStore()
const appRef = ref(null)
const navbarRef = ref(null)

let navbarResizeObserver = null

const syncNavbarHeight = () => {
  if (!appRef.value || !navbarRef.value) return
  const navbarHeight = navbarRef.value.offsetHeight || 0
  appRef.value.style.setProperty('--navbar-height', `${navbarHeight}px`)
  /* 侧栏 sticky 等：用实测高度 + 余量，避免与 fixed 顶栏叠层（calc 在部分布局下会偏小） */
  const stickyGap = 16
  appRef.value.style.setProperty('--layout-sticky-top', `${Math.ceil(navbarHeight + stickyGap)}px`)
}

const activeMenu = computed(() => route.path)
const appToneClass = computed(() => ({
  'app-profile-tone': route.name === 'profile'
}))

const isAdmin = computed(() => auth.isAdmin)

const onMenuSelect = (index) => {
  if (index === 'logout') {
    auth.logout()
    router.push({ name: 'login' })
    return
  }
  if (index === 'install') return
  router.push(index)
}

const handleInstallPWA = async () => {
  if (typeof window.installApp === 'function') {
    await window.installApp()
  }
}

onMounted(() => {
  ui.initDarkModeFromStorage()
  nextTick(syncNavbarHeight)
  window.addEventListener('resize', syncNavbarHeight)
  if (window.ResizeObserver && navbarRef.value) {
    navbarResizeObserver = new window.ResizeObserver(syncNavbarHeight)
    navbarResizeObserver.observe(navbarRef.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncNavbarHeight)
  if (navbarResizeObserver) {
    navbarResizeObserver.disconnect()
    navbarResizeObserver = null
  }
})

watch(
  () => auth.isAdmin,
  (ok) => {
    if (!ok && route.name === 'directory') {
      router.replace({ name: 'home' })
    }
  }
)

watch(
  () => route.fullPath,
  () => {
    nextTick(syncNavbarHeight)
  }
)
</script>

<template>
  <div ref="appRef" class="app" :class="appToneClass">
    <header ref="navbarRef" class="navbar">
      <div class="container">
        <div class="navbar-content">
          <div class="logo">
            <img src="/logo.png" alt="PUBG Spark Squad Logo" class="logo-image" />
            <h1>PUBG Spark Squad</h1>
          </div>
          <el-menu
            :default-active="activeMenu"
            class="el-menu-demo"
            mode="horizontal"
            :router="false"
            @select="onMenuSelect"
          >
            <el-menu-item index="/">首页</el-menu-item>
            <el-menu-item index="/chat">圈子</el-menu-item>
            <el-menu-item index="/match">比赛</el-menu-item>
            <el-menu-item index="/bean-lobby">豆子局</el-menu-item>
            <el-menu-item index="/profile">个人</el-menu-item>
            <el-menu-item v-if="isAdmin" index="/directory">后台</el-menu-item>
            <el-menu-item v-if="ui.canInstallPWA" index="install">
              <template #title>
                <el-button type="primary" @click.stop="handleInstallPWA" :loading="ui.isInstallingPWA">
                  {{ ui.isInstallingPWA ? '安装中...' : '安装APP' }}
                </el-button>
              </template>
            </el-menu-item>
            <el-menu-item index="logout">
              <template #title>
                <div class="logout-title">退出登录</div>
              </template>
            </el-menu-item>
          </el-menu>
        </div>
      </div>
    </header>

    <main class="page-content">
      <div class="page-body">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </div>
    </main>

    <footer class="footer">
      <div class="container">
        <div class="footer-content">
          <div class="footer-links">
            <a href="#">关于我们</a>
            <a href="#">隐私政策</a>
            <a href="#">使用条款</a>
          </div>
          <div class="footer-copyright">
            <p>&copy; 2024 PUBG Spark Squad. 保留所有权利。</p>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  --navbar-height: 60px;
  /* 子页面 position:sticky 的 top，与 JS 写入的 --layout-sticky-top 对齐 */
  --layout-sticky-top: calc(var(--navbar-height, 60px) + 16px);
  /* 各业务页与顶栏之间的统一留白（由各页去掉自身重复 padding） */
  --page-body-pt: 1.25rem;
  --page-body-pb: 2rem;
}

.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background-color: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  z-index: 1000;
  padding-top: var(--safe-area-inset-top);
  min-height: 60px;
}

.navbar-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.logo-image {
  width: auto;
  height: 40px;
  max-width: 44px;
  border-radius: 8px;
  object-fit: contain;
  object-position: center top;
}

.logo h1 {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0;
}

.page-content {
  flex: 1;
  padding-top: var(--navbar-height);
  background: #f5f5f7;
}

.page-body {
  width: 100%;
  box-sizing: border-box;
  padding: var(--page-body-pt) 0 var(--page-body-pb);
}

.container {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
}

.logout-title {
  width: 100%;
  text-align: center;
}

.footer {
  background-color: #f5f5f7;
  padding: 4rem 0 2rem;
  margin-top: auto;
}

.footer-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.footer-links {
  display: flex;
  justify-content: center;
  gap: 2rem;
  flex-wrap: wrap;
}

.footer-links a {
  font-size: 0.875rem;
  color: #86868b;
}

.footer-links a:hover {
  color: #1d1d1f;
}

.footer-copyright {
  text-align: center;
  font-size: 0.75rem;
  color: #86868b;
}

.app-profile-tone {
  --page-body-pt: 0;
  --page-body-pb: 0;
}

.app-profile-tone .navbar {
  background: rgba(255, 255, 255, 0.86);
  border-bottom: 1px solid #e5e5ea;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.04);
}

.app-profile-tone .page-content {
  background: #f5f5f7;
}

.app-profile-tone .page-body {
  padding-top: 0;
}

.app-profile-tone .footer {
  margin-top: 0;
  background: #f5f5f7;
}

.app-profile-tone .logo h1,
.app-profile-tone :deep(.el-menu-item) {
  color: #1d1d1f !important;
}

.app-profile-tone :deep(.el-menu-item:hover),
.app-profile-tone :deep(.el-menu-item.is-active) {
  color: #000000 !important;
}

@media (max-width: 768px) {
  .app {
    --page-body-pt: 1rem;
  }

  .navbar-content {
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
  }

  .footer-links {
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }
}
</style>
