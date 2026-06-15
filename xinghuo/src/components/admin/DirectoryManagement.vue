<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, Edit, Plus } from '@element-plus/icons-vue'
import { adminApi, authApi } from '../../services/api'

const getRole = () => {
  try {
    const user = JSON.parse(localStorage.getItem('userData') || '{}')
    return user?.role || 'user'
  } catch {
    return 'user'
  }
}

const role = ref(getRole())
const isAdmin = computed(() => ['admin', 'superadmin'].includes(role.value))
const canDeleteUser = computed(() => role.value === 'superadmin')

const activeTab = ref('carousel')
const tabLabels = {
  carousel: '轮播管理',
  chat: '圈子管理',
  user: '个人管理',
  invite: '邀请码',
}
const activeModuleLabel = computed(() => tabLabels[activeTab.value] || '')
const loading = ref(false)

const carousels = ref([])
const chats = ref([])
const users = ref([])
const inviteCodes = ref([])

const dialogType = ref('')
const dialogVisible = ref(false)

const carouselForm = reactive({
  id: null,
  title: '',
  subtitle: '',
  content: '',
  type: 'text',
  buttons: '',
})

const userForm = reactive({
  id: null,
  account: '',
  username: '',
  real_name: '',
  phone: '',
  address: '',
  password: '',
  inviteCode: '',
  role: 'user',
  avatar: '',
})

const inviteForm = reactive({
  id: null,
  code: '',
  remark: '',
  max_uses: '',
  is_active: true,
})

const pickFirstUsableInviteCode = () => {
  const list = inviteCodes.value.filter(
    (i) => i.is_active && (i.max_uses == null || Number(i.used_count) < Number(i.max_uses))
  )
  return list.length ? list[0].code : ''
}

const resetCarouselForm = () => {
  Object.assign(carouselForm, {
    id: null, title: '', subtitle: '', content: '', type: 'text', buttons: '',
  })
}

const resetUserForm = () => {
  Object.assign(userForm, {
    id: null,
    account: '',
    username: '',
    real_name: '',
    phone: '',
    address: '',
    password: '',
    inviteCode: pickFirstUsableInviteCode(),
    role: 'user',
    avatar: '',
  })
}

const resetInviteForm = () => {
  Object.assign(inviteForm, {
    id: null,
    code: '',
    remark: '',
    max_uses: '',
    is_active: true,
  })
}

const openCreateDialog = (type) => {
  dialogType.value = type
  if (type === 'carousel') resetCarouselForm()
  if (type === 'user') resetUserForm()
  if (type === 'invite') resetInviteForm()
  dialogVisible.value = true
}

const openEditDialog = (type, row) => {
  dialogType.value = type
  if (type === 'carousel') Object.assign(carouselForm, row)
  if (type === 'user') Object.assign(userForm, { ...row, password: '' })
  if (type === 'invite') {
    Object.assign(inviteForm, {
      id: row.id,
      code: row.code,
      remark: row.remark || '',
      max_uses: row.max_uses != null ? String(row.max_uses) : '',
      is_active: !!row.is_active,
    })
  }
  dialogVisible.value = true
}

const formatDate = (value) => {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('zh-CN')
}

const carouselTypeLabel = (v) => {
  const map = { text: '文本', promotion: '推广', event: '活动' }
  return map[v] || v || '-'
}

const userRoleLabel = (v) => {
  const map = { user: '普通用户', admin: '管理员', superadmin: '系统管理员' }
  return map[v] || v || '-'
}

const loadCarousels = async () => {
  carousels.value = await adminApi.carousel.getAll()
}

const loadChats = async () => {
  chats.value = await adminApi.chat.getAll()
}

const loadUsers = async () => {
  users.value = await adminApi.user.getAllUsers()
}

const loadInviteCodes = async () => {
  inviteCodes.value = await adminApi.inviteCodes.list()
}

const loadAll = async () => {
  if (!isAdmin.value) return
  loading.value = true
  try {
    await Promise.all([loadCarousels(), loadChats(), loadUsers(), loadInviteCodes()])
  } catch (e) {
    ElMessage.error(e?.message || '后台数据加载失败')
  } finally {
    loading.value = false
  }
}

const loadActiveTabData = async (tab) => {
  if (!isAdmin.value) return
  if (tab === 'carousel') return loadCarousels()
  if (tab === 'chat') return loadChats()
  if (tab === 'user') return loadUsers()
  if (tab === 'invite') return loadInviteCodes()
}

const submitDialog = async () => {
  try {
    loading.value = true
    if (dialogType.value === 'carousel') {
      const payload = {
        title: carouselForm.title,
        subtitle: carouselForm.subtitle,
        content: carouselForm.content,
        type: carouselForm.type,
        buttons: carouselForm.buttons,
      }
      if (carouselForm.id) await adminApi.carousel.update(carouselForm.id, payload)
      else await adminApi.carousel.create(payload)
      await loadCarousels()
    }

    if (dialogType.value === 'user') {
      if (userForm.id) {
        await adminApi.user.updateUser(userForm.id, {
          account: userForm.account,
          username: userForm.username,
          real_name: userForm.real_name,
          phone: userForm.phone,
          address: userForm.address,
          role: userForm.role,
          avatar: userForm.avatar,
        })
      } else {
        if (!userForm.inviteCode) {
          ElMessage.warning('请选择有效邀请码')
          loading.value = false
          return
        }
        const resp = await authApi.register({
          account: userForm.account,
          username: userForm.username,
          password: userForm.password,
          inviteCode: userForm.inviteCode,
        })
        if (resp?.userId && userForm.role !== 'user') {
          await adminApi.user.updateUser(resp.userId, { role: userForm.role })
        }
      }
      await loadUsers()
      await loadInviteCodes()
    }

    if (dialogType.value === 'invite') {
      const payload = {
        code: inviteForm.code,
        remark: inviteForm.remark || null,
        max_uses: inviteForm.max_uses === '' || inviteForm.max_uses === undefined || inviteForm.max_uses === null
          ? null
          : Number(inviteForm.max_uses),
        is_active: !!inviteForm.is_active,
      }
      if (!payload.code || !String(payload.code).trim()) {
        ElMessage.warning('请填写邀请码')
        loading.value = false
        return
      }
      if (payload.max_uses != null && (Number.isNaN(payload.max_uses) || payload.max_uses < 1)) {
        ElMessage.warning('最大次数须为正整数，或留空表示不限制')
        loading.value = false
        return
      }
      if (inviteForm.id) await adminApi.inviteCodes.update(inviteForm.id, payload)
      else await adminApi.inviteCodes.create(payload)
      await loadInviteCodes()
    }

    dialogVisible.value = false
    ElMessage.success('保存成功')
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    loading.value = false
  }
}

const removeCarousel = async (id) => {
  try {
    await adminApi.carousel.delete(id)
    await loadCarousels()
    ElMessage.success('轮播已删除')
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

const removeChat = async (id) => {
  try {
    await adminApi.chat.delete(id)
    await loadChats()
    ElMessage.success('圈子帖子已删除')
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

const removeUser = async (id) => {
  if (!canDeleteUser.value) {
    ElMessage.warning('仅 superadmin 可删除用户')
    return
  }
  try {
    await adminApi.user.deleteUser(id)
    await loadUsers()
    ElMessage.success('用户已删除')
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

const removeInvite = async (id) => {
  try {
    await adminApi.inviteCodes.delete(id)
    await loadInviteCodes()
    ElMessage.success('邀请码已删除')
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

onMounted(loadAll)

watch(activeTab, async (tab) => {
  try {
    await loadActiveTabData(tab)
  } catch (e) {
    ElMessage.error(e?.message || '切换标签后加载数据失败')
  }
})
</script>

<template>
  <div class="directory-management">
    <div class="container admin-wrap">
      <div v-if="!isAdmin" class="permission-card">
        <div class="admin-panel permission-inner">
          <h2 class="admin-page-title">后台</h2>
          <p class="admin-page-desc">仅管理员可访问此页面。</p>
        </div>
      </div>

      <template v-else>
        <header class="admin-page-header">
          <h1 class="admin-page-title">后台管理</h1>
          <p class="admin-page-desc">与全站风格一致的管理中心，维护轮播、圈子、用户与邀请码。</p>
        </header>

        <div class="admin-panel">
          <el-tabs v-model="activeTab" class="admin-tabs">
            <el-tab-pane label="轮播管理" name="carousel" />
            <el-tab-pane label="圈子管理" name="chat" />
            <el-tab-pane label="个人管理" name="user" />
            <el-tab-pane label="邀请码" name="invite" />
          </el-tabs>

          <div class="admin-panel-body" v-loading="loading">
            <div class="toolbar">
              <span class="toolbar-label">{{ activeModuleLabel }}</span>
              <el-button
                v-if="activeTab === 'carousel' || activeTab === 'user' || activeTab === 'invite'"
                type="primary"
                @click="openCreateDialog(activeTab)"
              >
                <el-icon><Plus /></el-icon>
                新增
              </el-button>
            </div>

            <el-table v-if="activeTab === 'carousel'" :data="carousels" border class="admin-table">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="title" label="标题" />
          <el-table-column prop="subtitle" label="副标题" />
          <el-table-column prop="type" label="类型" width="120">
            <template #default="scope">{{ carouselTypeLabel(scope.row.type) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="180">
            <template #default="scope">
              <el-button type="primary" size="small" @click="openEditDialog('carousel', scope.row)"><el-icon><Edit /></el-icon></el-button>
              <el-button type="danger" size="small" @click="removeCarousel(scope.row.id)"><el-icon><Delete /></el-icon></el-button>
            </template>
          </el-table-column>
        </el-table>

            <el-table v-if="activeTab === 'chat'" :data="chats" border class="admin-table">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="username" label="用户" width="120" />
          <el-table-column prop="content" label="内容" />
          <el-table-column prop="likes" label="点赞" width="90" />
          <el-table-column label="时间" width="180">
            <template #default="scope">{{ formatDate(scope.row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="scope">
              <el-button type="danger" size="small" @click="removeChat(scope.row.id)"><el-icon><Delete /></el-icon></el-button>
            </template>
          </el-table-column>
        </el-table>

            <el-table v-if="activeTab === 'user'" :data="users" border class="admin-table">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="account" label="账号" width="140" />
          <el-table-column prop="username" label="用户名" width="140" />
          <el-table-column prop="real_name" label="姓名" width="120" />
          <el-table-column prop="phone" label="电话" width="130" />
          <el-table-column prop="address" label="地址" min-width="180" />
          <el-table-column prop="role" label="角色" width="120">
            <template #default="scope">{{ userRoleLabel(scope.row.role) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="180">
            <template #default="scope">
              <el-button type="primary" size="small" @click="openEditDialog('user', scope.row)"><el-icon><Edit /></el-icon></el-button>
              <el-button type="danger" size="small" @click="removeUser(scope.row.id)"><el-icon><Delete /></el-icon></el-button>
            </template>
          </el-table-column>
        </el-table>

            <el-table v-if="activeTab === 'invite'" :data="inviteCodes" border class="admin-table">
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="code" label="邀请码" width="160" />
          <el-table-column prop="remark" label="备注" min-width="120" />
          <el-table-column label="次数" width="140">
            <template #default="scope">
              {{ scope.row.used_count }} /
              {{ scope.row.max_uses == null ? '∞' : scope.row.max_uses }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="scope">
              {{ scope.row.is_active ? '启用' : '停用' }}
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="scope">{{ formatDate(scope.row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="160">
            <template #default="scope">
              <el-button type="primary" size="small" @click="openEditDialog('invite', scope.row)"><el-icon><Edit /></el-icon></el-button>
              <el-button type="danger" size="small" @click="removeInvite(scope.row.id)"><el-icon><Delete /></el-icon></el-button>
            </template>
          </el-table-column>
            </el-table>
          </div>
        </div>

        <el-dialog
          v-model="dialogVisible"
          class="admin-dialog"
          :title="dialogType === 'carousel' ? '轮播' : dialogType === 'invite' ? '邀请码' : '用户'"
          width="560px"
          align-center
        >
        <div v-if="dialogType === 'carousel'" class="form-grid">
          <el-input v-model="carouselForm.title" placeholder="标题" />
          <el-input v-model="carouselForm.subtitle" placeholder="副标题" />
          <el-select v-model="carouselForm.type" placeholder="轮播类型" style="width: 100%">
            <el-option label="文本" value="text" />
            <el-option label="推广" value="promotion" />
            <el-option label="活动" value="event" />
          </el-select>
          <el-input v-model="carouselForm.buttons" placeholder="按钮 JSON 字符串" />
          <el-input v-model="carouselForm.content" type="textarea" :rows="4" placeholder="内容" />
        </div>

        <div v-else-if="dialogType === 'invite'" class="form-grid">
          <el-input v-model="inviteForm.code" placeholder="邀请码（唯一）" />
          <el-input v-model="inviteForm.remark" placeholder="备注（可选）" />
          <el-input v-model="inviteForm.max_uses" placeholder="最大使用次数（留空 = 不限制）" />
          <el-switch v-model="inviteForm.is_active" active-text="启用" inactive-text="停用" />
        </div>

        <div v-else class="form-grid">
          <el-input v-model="userForm.account" :disabled="!!userForm.id" placeholder="账号" />
          <el-input v-model="userForm.username" placeholder="用户名" />
          <el-input v-model="userForm.real_name" placeholder="真实姓名（可选）" />
          <el-input v-model="userForm.phone" placeholder="电话（可选）" />
          <el-input v-model="userForm.address" placeholder="地址（可选）" />
          <el-input v-model="userForm.avatar" placeholder="头像URL（可选）" />
          <el-select v-model="userForm.role" placeholder="角色" style="width: 100%">
            <el-option label="普通用户" value="user" />
            <el-option label="管理员" value="admin" />
            <el-option label="系统管理员" value="superadmin" />
          </el-select>
          <el-input v-if="!userForm.id" v-model="userForm.password" placeholder="密码" type="password" show-password />
          <el-select
            v-if="!userForm.id"
            v-model="userForm.inviteCode"
            placeholder="选择邀请码（须启用且未达上限）"
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="ic in inviteCodes"
              :key="ic.id"
              :label="`${ic.code}（已用 ${ic.used_count}${ic.max_uses != null ? '/' + ic.max_uses : ''}）`"
              :value="ic.code"
              :disabled="!ic.is_active || (ic.max_uses != null && Number(ic.used_count) >= Number(ic.max_uses))"
            />
          </el-select>
        </div>

        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitDialog">保存</el-button>
        </template>
        </el-dialog>
      </template>
    </div>
  </div>
</template>

<style scoped>
.directory-management {
  min-height: 100vh;
  padding-top: 0;
  padding-bottom: 3rem;
  background: transparent;
}

.directory-management .container {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
}

.admin-page-header {
  margin-bottom: 1.5rem;
}

.admin-page-title {
  margin: 0 0 0.4rem;
  font-size: 1.75rem;
  font-weight: 600;
  color: #1d1d1f;
  letter-spacing: -0.02em;
}

.admin-page-desc {
  margin: 0;
  font-size: 0.9rem;
  color: #86868b;
  line-height: 1.5;
  max-width: 36rem;
}

.admin-panel {
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.permission-card {
  padding-top: 2rem;
  max-width: 560px;
  margin: 0 auto;
}

.permission-inner {
  padding: 2.25rem 1.75rem;
  text-align: center;
}

.permission-inner .admin-page-title {
  font-size: 1.35rem;
}

.admin-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 0.25rem 0 1rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: #f9f9f9;
}

.admin-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.admin-tabs :deep(.el-tabs__item) {
  font-weight: 500;
  font-size: 0.9375rem;
  color: #86868b;
  padding: 0 1.125rem;
}

.admin-tabs :deep(.el-tabs__item:hover) {
  color: #1d1d1f;
}

.admin-tabs :deep(.el-tabs__item.is-active) {
  color: #1d1d1f;
}

.admin-tabs :deep(.el-tabs__active-bar) {
  height: 2px;
  background-color: #1d1d1f;
  border-radius: 0;
}

.admin-panel-body {
  padding: 1.125rem 1.25rem 1.5rem;
  min-height: 12rem;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.toolbar-label {
  font-size: 0.9375rem;
  font-weight: 600;
  color: #1d1d1f;
}

.form-grid {
  display: grid;
  gap: 10px;
}

.admin-table :deep(.el-table__header th.el-table__cell) {
  background: #f9f9f9 !important;
  color: #1d1d1f;
  font-weight: 600;
}

.admin-table :deep(.el-table) {
  --el-table-border-color: rgba(0, 0, 0, 0.08);
}

.table-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.table-actions :deep(.el-button) {
  margin-left: 0;
}

.admin-dialog :deep(.el-dialog) {
  border-radius: 12px;
}

@media (max-width: 768px) {
  .directory-management {
    padding-top: 0;
  }

  .admin-page-title {
    font-size: 1.45rem;
  }
}
</style>

