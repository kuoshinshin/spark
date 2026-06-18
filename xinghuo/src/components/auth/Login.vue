<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi } from '../../services/api'
import { useAuthStore } from '../../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const account = ref('')
const password = ref('')
const isLoading = ref(false)
const errorMessage = ref('')

const handleLogin = async () => {
  errorMessage.value = ''
  isLoading.value = true
  
  try {
    const response = await authApi.login({
      account: account.value,
      password: password.value
    })

    if (!response?.token || !response?.user) {
      throw new Error('登录返回数据不完整')
    }

    auth.login({
      ...response.user,
      token: response.token
    })
    isLoading.value = false

    const rawRedirect = route.query.redirect
    let target = null
    if (typeof rawRedirect === 'string' && rawRedirect.trim()) {
      try {
        const path = decodeURIComponent(rawRedirect.trim())
        if (path.startsWith('/') && !path.startsWith('//')) target = path
      } catch { /* ignore */ }
    }
    if (target) await router.replace(target)
    else await router.replace({ name: 'home' })
  } catch (error) {
    isLoading.value = false
    errorMessage.value = error.message || '登录失败，请联系管理员'
    console.error('登录失败:', error)
  }
}

const switchToRegister = () => {
  router.push({ name: 'register' })
}
</script>

<template>
  <div class="login-container">
    <div class="login-wrapper">
      <div class="system-title-section">
        <div class="system-title">
          <h1>PUBG Spark Squad</h1>
          <p class="system-subtitle">星火計劃交流平台</p>
        </div>
      </div>

      <div class="divider" />

      <div class="login-form-section">
        <h2>登录</h2>
        <p class="login-subtitle">请输入您的账号和密码登录</p>

        <el-form @submit.prevent="handleLogin" label-position="top" class="auth-form">
          <el-form-item label="账号" required>
            <el-input
              v-model="account"
              placeholder="请输入账号"
              autocomplete="off"
              size="large"
            />
          </el-form-item>

          <el-form-item label="密码" required>
            <el-input
              v-model="password"
              type="password"
              placeholder="请输入密码"
              show-password
              autocomplete="current-password"
              size="large"
            />
          </el-form-item>

          <div v-if="errorMessage" class="error-message">
            {{ errorMessage }}
          </div>

          <el-form-item class="auth-submit-item">
            <el-button
              type="primary"
              native-type="submit"
              :loading="isLoading"
              :disabled="isLoading"
              class="auth-primary-btn"
              size="large"
            >
              {{ isLoading ? '登录中...' : '登录' }}
            </el-button>
          </el-form-item>

          <div class="auth-switch">
            <span>没有账号？</span>
            <el-button link type="primary" class="auth-switch-btn" @click="switchToRegister">
              立即注册
            </el-button>
          </div>
        </el-form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 2rem;
  padding-top: calc(1.5rem + var(--safe-area-inset-top));
  padding-bottom: calc(1.5rem + var(--safe-area-inset-bottom));
  padding-left: calc(1rem + var(--safe-area-inset-left));
  padding-right: calc(1rem + var(--safe-area-inset-right));
  background-color: #fafafa;
  box-sizing: border-box;
}

.login-wrapper {
  display: flex;
  width: 100%;
  max-width: 1000px;
  min-height: 500px;
  background-color: #ffffff;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.system-title-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 3rem;
  background-color: #f9f9f9;
  text-align: center;
}

.system-title h1 {
  font-size: 2.5rem;
  font-weight: 700;
  color: #1d1d1f;
  margin-bottom: 0.5rem;
  letter-spacing: -0.02em;
}

.system-subtitle {
  font-size: 1rem;
  color: #86868b;
  font-weight: 400;
  letter-spacing: 0.01em;
}

.divider {
  width: 1px;
  background-image: repeating-linear-gradient(
    to bottom,
    #e0e0e0,
    #e0e0e0 10px,
    transparent 10px,
    transparent 15px
  );
}

.login-form-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 3rem;
  min-width: 0;
}

.login-form-section h2 {
  margin-bottom: 0.75rem;
  font-size: 1.75rem;
  font-weight: 600;
  color: #1d1d1f;
  letter-spacing: -0.01em;
}

.login-subtitle {
  margin-bottom: 1.5rem;
  font-size: 0.9rem;
  color: #86868b;
  line-height: 1.5;
}

.auth-form :deep(.el-form-item) {
  margin-bottom: 1rem;
}

.auth-form :deep(.el-form-item__label) {
  font-weight: 500;
  color: #1d1d1f;
  padding-bottom: 0.35rem;
}

.auth-primary-btn {
  width: 100%;
}

.auth-submit-item {
  margin-bottom: 0.5rem;
}

.auth-switch {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.75rem 0 0.25rem;
  font-size: 0.9rem;
  color: #86868b;
}

.auth-switch-btn {
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.5rem 0.75rem;
}

.error-message {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  background-color: #fef2f2;
  color: #dc2626;
  border-radius: 12px;
  font-size: 0.875rem;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .login-container {
    align-items: flex-start;
    padding: 0.75rem;
    padding-top: calc(0.75rem + var(--safe-area-inset-top));
    padding-bottom: calc(0.75rem + var(--safe-area-inset-bottom));
  }

  .login-wrapper {
    flex-direction: column;
    min-height: auto;
    border-radius: 12px;
  }

  .system-title-section {
    padding: 1.25rem 1rem;
  }

  .login-form-section {
    padding: 1.25rem 1rem 1.5rem;
    justify-content: flex-start;
  }

  .divider {
    width: 100%;
    height: 1px;
    background-image: repeating-linear-gradient(
      to right,
      #e0e0e0,
      #e0e0e0 10px,
      transparent 10px,
      transparent 15px
    );
  }

  .system-title h1 {
    font-size: 1.35rem;
    margin-bottom: 0.25rem;
  }

  .system-subtitle {
    font-size: 0.8rem;
  }

  .login-form-section h2 {
    font-size: 1.35rem;
    margin-bottom: 0.35rem;
  }

  .login-subtitle {
    margin-bottom: 1rem;
    font-size: 0.85rem;
  }

  .auth-switch {
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
  }
}

@media (max-width: 480px) {
  .login-form-section {
    padding: 1rem 0.875rem 1.25rem;
  }

  .system-title-section {
    padding: 1rem 0.875rem;
  }
}
</style>
