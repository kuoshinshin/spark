<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi } from '../../services/api'

const router = useRouter()

const account = ref('')
const username = ref('')
const realName = ref('')
const phone = ref('')
const address = ref('')
const password = ref('')
const confirmPassword = ref('')
const inviteCode = ref('')
const isLoading = ref(false)
const errorMessage = ref('')

const handleRegister = async () => {
  errorMessage.value = ''

  if (!account.value) {
    errorMessage.value = '请输入账号！'
    return
  }

  if (!username.value || !username.value.trim()) {
    errorMessage.value = '请输入昵称！'
    return
  }

  if (!realName.value || !realName.value.trim()) {
    errorMessage.value = '请输入真实姓名！'
    return
  }

  if (!inviteCode.value) {
    errorMessage.value = '请输入邀请码！'
    return
  }

  if (password.value !== confirmPassword.value) {
    errorMessage.value = '两次输入的密码不一致！'
    return
  }

  isLoading.value = true

  try {
    await authApi.register({
      account: account.value,
      username: username.value,
      realName: realName.value.trim(),
      phone: phone.value,
      address: address.value,
      password: password.value,
      inviteCode: inviteCode.value
    })
    isLoading.value = false

    ElMessage.success('注册成功！请登录')
    await router.push({ name: 'login' })
  } catch (error) {
    isLoading.value = false
    errorMessage.value = error.message || '注册失败，请联系管理员'
    console.error('注册失败:', error)
  }
}

const switchToLogin = () => {
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="register-container">
    <div class="register-wrapper">
      <div class="system-title-section">
        <div class="system-title">
          <h1>PUBG Spark Squad</h1>
          <p class="system-subtitle">星火計劃交流平台</p>
        </div>
      </div>

      <div class="divider" />

      <div class="register-form-section">
        <h2>注册</h2>
        <p class="register-subtitle">请输入您的信息创建账号（无需填写邮箱，系统会自动生成占位邮箱）</p>

        <el-form @submit.prevent="handleRegister" label-position="top" class="auth-form">
          <el-form-item label="昵称" required>
            <el-input v-model="username" placeholder="请输入昵称" size="large" />
          </el-form-item>
          <el-form-item label="账号" required>
            <el-input v-model="account" placeholder="请输入账号" size="large" />
          </el-form-item>
          <el-form-item label="真实姓名" required>
            <el-input v-model="realName" placeholder="请输入真实姓名" size="large" />
          </el-form-item>
          <el-form-item label="电话">
            <el-input v-model="phone" placeholder="仅用于发放奖励（选填）" size="large" />
          </el-form-item>
          <el-form-item label="地址">
            <el-input v-model="address" placeholder="仅用于发放奖励（选填）" size="large" />
          </el-form-item>
          <el-form-item label="密码" required>
            <el-input
              type="password"
              v-model="password"
              placeholder="请输入密码"
              show-password
              size="large"
            />
          </el-form-item>
          <el-form-item label="确认密码" required>
            <el-input
              type="password"
              v-model="confirmPassword"
              placeholder="请再次输入密码"
              show-password
              size="large"
            />
          </el-form-item>
          <el-form-item label="邀请码" required>
            <el-input v-model="inviteCode" placeholder="请输入邀请码" size="large" />
          </el-form-item>

          <div v-if="errorMessage" class="error-message">
            {{ errorMessage }}
          </div>

          <el-form-item class="auth-submit-item">
            <el-button
              type="primary"
              native-type="submit"
              :loading="isLoading"
              class="auth-primary-btn"
              size="large"
            >
              {{ isLoading ? '注册中...' : '注册' }}
            </el-button>
          </el-form-item>

          <div class="auth-switch">
            <span>已有账号？</span>
            <el-button link type="primary" class="auth-switch-btn" @click="switchToLogin">
              立即登录
            </el-button>
          </div>
        </el-form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.register-container {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 2rem;
  padding-top: calc(1.5rem + var(--safe-area-inset-top));
  padding-bottom: calc(1.5rem + var(--safe-area-inset-bottom));
  padding-left: calc(1rem + var(--safe-area-inset-left));
  padding-right: calc(1rem + var(--safe-area-inset-right));
  background: linear-gradient(135deg, #f5f5f7 0%, #ffffff 100%);
  box-sizing: border-box;
}

.register-wrapper {
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

.register-form-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  padding: 3rem;
  min-width: 0;
}

.register-form-section h2 {
  margin-bottom: 0.5rem;
  font-size: 1.75rem;
  font-weight: 600;
  color: #1d1d1f;
  letter-spacing: -0.02em;
}

.register-subtitle {
  margin-bottom: 1.25rem;
  font-size: 0.9rem;
  color: #86868b;
  line-height: 1.5;
}

.auth-form :deep(.el-form-item) {
  margin-bottom: 0.85rem;
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
  .register-container {
    padding: 0.75rem;
    padding-top: calc(0.75rem + var(--safe-area-inset-top));
    padding-bottom: calc(0.75rem + var(--safe-area-inset-bottom));
  }

  .register-wrapper {
    flex-direction: column;
    min-height: auto;
    border-radius: 12px;
  }

  .system-title-section {
    padding: 1.25rem 1rem;
  }

  .register-form-section {
    padding: 1.25rem 1rem 1.5rem;
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

  .register-form-section h2 {
    font-size: 1.35rem;
  }

  .register-subtitle {
    margin-bottom: 1rem;
    font-size: 0.85rem;
  }

  .auth-form :deep(.el-form-item) {
    margin-bottom: 0.75rem;
  }

  .auth-switch {
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
  }
}

@media (max-width: 480px) {
  .register-form-section {
    padding: 1rem 0.875rem 1.25rem;
  }

  .system-title-section {
    padding: 1rem 0.875rem;
  }
}
</style>
