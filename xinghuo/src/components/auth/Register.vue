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
    // 调用后端注册API
    await authApi.register({
      account: account.value,
      username: username.value,
      realName: realName.value,
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

// 切换到登录页面
const switchToLogin = () => {
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="register-container">
    <div class="register-wrapper">
      <!-- 系统标题部分 -->
      <div class="system-title-section">
        <div class="system-title">
          <h1>PUBG Spark Squad</h1>
          <p class="system-subtitle">星火計劃交流平台</p>
        </div>
      </div>
      
      <!-- 分隔线 -->
      <div class="divider"></div>
      
      <!-- 注册表单部分 -->
      <div class="register-form-section">
        <h2>注册</h2>
        <p class="register-subtitle">请输入您的信息创建账号（无需填写邮箱，系统会自动生成占位邮箱）</p>
        
        <el-form @submit.prevent="handleRegister" label-position="right" label-width="88px" class="register-form-inline">
          <el-form-item label="昵称" required>
            <el-input 
              v-model="username" 
              placeholder="请输入昵称"
            />
          </el-form-item>
          <el-form-item label="账号" required>
            <el-input 
              v-model="account" 
              placeholder="请输入账号"
            />
          </el-form-item>
          <el-form-item label="姓名">
            <el-input 
              v-model="realName" 
              placeholder="真实姓名"
            />
          </el-form-item>
          <el-form-item label="电话">
            <el-input 
              v-model="phone" 
              placeholder="仅用于发放奖励"
            />
          </el-form-item>
          <el-form-item label="地址">
            <el-input 
              v-model="address" 
              placeholder="仅用于发放奖励"
            />
          </el-form-item>
          <el-form-item label="密码" required>
            <el-input 
              type="password" 
              v-model="password" 
              placeholder="请输入密码"
              show-password
            />
          </el-form-item>
          <el-form-item label="确认密码" required>
            <el-input 
              type="password" 
              v-model="confirmPassword" 
              placeholder="请再次输入密码"
              show-password
            />
          </el-form-item>
          <el-form-item label="邀请码" required>
            <el-input 
              v-model="inviteCode" 
              placeholder="请输入邀请码"
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
              style="width: 100%"
            >
              {{ isLoading ? '注册中...' : '注册' }}
            </el-button>
          </el-form-item>
        </el-form>
        <div class="form-footer">
          <p>已有账号？<a href="#/login" @click.prevent="switchToLogin">立即登录</a></p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.register-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: 2rem;
  padding-top: calc(2rem + var(--safe-area-inset-top));
  padding-bottom: calc(2rem + var(--safe-area-inset-bottom));
  padding-left: calc(2rem + var(--safe-area-inset-left));
  padding-right: calc(2rem + var(--safe-area-inset-right));
  background: linear-gradient(135deg, #f5f5f7 0%, #ffffff 100%);
}

.register-wrapper {
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

/* 注册表单部分 */
.register-form-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 3rem;
  overflow-y: auto;
}

.register-form-section h2 {
  margin-bottom: 2rem;
  font-size: 2rem;
  font-weight: 600;
  color: #1d1d1f;
  letter-spacing: -0.02em;
}

.register-subtitle {
  margin-bottom: 2.5rem;
  font-size: 0.9rem;
  color: #86868b;
  line-height: 1.5;
}

.register-form-inline :deep(.el-form-item) {
  margin-bottom: 0.75rem;
}

.register-form-inline :deep(.el-form-item__content) {
  margin-left: 0 !important;
}

.form-footer {
  margin-top: 2rem;
  font-size: 0.875rem;
  color: #86868b;
  text-align: center;
}

.form-footer a {
  color: #0071e3;
  font-weight: 500;
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

/* 响应式设计 */
@media (max-width: 768px) {
  .register-container {
    padding: 1.5rem;
  }
  
  .register-wrapper {
    flex-direction: column;
    min-height: auto;
  }
  
  .system-title-section {
    padding: 3rem 2rem;
  }
  
  .register-form-section {
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
  
  .register-form-section h2 {
    font-size: 1.75rem;
  }
}

@media (max-width: 480px) {
  .system-title-section {
    padding: 2.5rem 1.5rem;
  }
  
  .register-form-section {
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