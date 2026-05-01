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
      <!-- 系统标题部分 -->
      <div class="system-title-section">
        <div class="system-title">
          <h1>PUBG Spark Squad</h1>
          <p class="system-subtitle">星火計劃交流平台</p>
        </div>
      </div>
      
      <!-- 分隔线 -->
      <div class="divider"></div>
      
      <!-- 登录表单部分 -->
      <div class="login-form-section">
        <h2>登录</h2>
        <p class="login-subtitle">请输入您的账号和密码登录</p>
        
        <el-form @submit.prevent="handleLogin" label-position="top">
          <el-form-item label="账号" required>
            <el-input 
              v-model="account" 
              placeholder="请输入账号"
              autocomplete="off"
            />
          </el-form-item>
          
          <el-form-item label="密码" required>
            <el-input 
              v-model="password" 
              type="password" 
              placeholder="请输入密码"
              show-password
              autocomplete="current-password"
            />
          </el-form-item>
          
          <el-form-item>
            <div v-if="errorMessage" class="error-message">
              {{ errorMessage }}
            </div>
          </el-form-item>
          
          <el-form-item>
            <el-button 
              type="primary" 
              native-type="submit" 
              :loading="isLoading" 
              :disabled="isLoading"
              style="width: 100%"
            >
              {{ isLoading ? '登录中...' : '登录' }}
            </el-button>
          </el-form-item>
        </el-form>
        
        <div class="form-footer">
          <p>没有账号？<a href="#/register" @click.prevent="switchToRegister">立即注册</a></p>
        </div>
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
  padding: 2rem;
  padding-top: calc(2rem + var(--safe-area-inset-top));
  padding-bottom: calc(2rem + var(--safe-area-inset-bottom));
  padding-left: calc(2rem + var(--safe-area-inset-left));
  padding-right: calc(2rem + var(--safe-area-inset-right));
  background-color: #fafafa;
}

.login-wrapper {
  display: flex;
  width: 100%;
  max-width: 1000px;
  min-height: 500px;
  max-height: 90vh;
  background-color: #ffffff;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

/* 系统标题部分 */
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

/* 分隔线 */
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

/* 登录表单部分 */
.login-form-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 3rem;
}

.login-form-section h2 {
  margin-bottom: 0.75rem;
  font-size: 1.75rem;
  font-weight: 600;
  color: #1d1d1f;
  letter-spacing: -0.01em;
}

.login-subtitle {
  margin-bottom: 2.5rem;
  font-size: 0.9rem;
  color: #86868b;
  line-height: 1.5;
}

.error-message {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background-color: #fef2f2;
  color: #dc2626;
  border-radius: 12px;
  font-size: 0.875rem;
  text-align: left;
  line-height: 1.5;
}

.form-footer {
  margin-top: 3rem;
  font-size: 0.875rem;
  color: #86868b;
  line-height: 1.5;
  text-align: center;
}

.form-footer a {
  color: #1d1d1f;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.2s ease;
}

.form-footer a:hover {
  color: #000000;
  text-decoration: underline;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .login-container {
    padding: 1.5rem;
  }
  
  .login-wrapper {
    flex-direction: column;
    min-height: auto;
  }
  
  .system-title-section {
    padding: 3rem 2rem;
  }
  
  .login-form-section {
    padding: 3rem 2rem;
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
    font-size: 2rem;
  }
  
  .login-form-section h2 {
    font-size: 1.5rem;
  }
}

@media (max-width: 480px) {
  .system-title-section {
    padding: 2.5rem 1.5rem;
  }
  
  .login-form-section {
    padding: 2.5rem 1.5rem;
  }
  
  .system-title h1 {
    font-size: 1.75rem;
  }
  
  .system-subtitle {
    font-size: 0.875rem;
  }
}
</style>