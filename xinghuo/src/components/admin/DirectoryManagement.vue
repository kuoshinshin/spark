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

const activeTab = ref('match')
const tabLabels = {
  match: '比赛管理',
  carousel: '轮播管理',
  chat: '圈子管理',
  user: '个人管理',
  invite: '邀请码',
}
const activeModuleLabel = computed(() => tabLabels[activeTab.value] || '')
const loading = ref(false)

const matches = ref([])
const carousels = ref([])
const chats = ref([])
const users = ref([])
const inviteCodes = ref([])

const dialogType = ref('')
const dialogVisible = ref(false)
const liveDialogVisible = ref(false)
const liveMatch = ref(null)
const liveRounds = ref([])
const liveLeaderboard = ref([])
const selectedRoundId = ref(null)
const snapshotTeams = ref([])
const roundForm = reactive({
  roundNo: 1,
  mapName: '',
})
const resultRows = ref([])

const matchForm = reactive({
  id: null,
  title: '',
  description: '',
  start_time: '',
  end_time: '',
  registration_open_at: '',
  registration_close_at: '',
  roster_frozen_at: '',
  location: '',
  status: 'upcoming',
})

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

const resetMatchForm = () => {
  Object.assign(matchForm, {
    id: null, title: '', description: '', start_time: '', end_time: '', registration_open_at: '', registration_close_at: '', roster_frozen_at: '', location: '', status: 'upcoming',
  })
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
  if (type === 'match') resetMatchForm()
  if (type === 'carousel') resetCarouselForm()
  if (type === 'user') resetUserForm()
  if (type === 'invite') resetInviteForm()
  dialogVisible.value = true
}

const openEditDialog = (type, row) => {
  dialogType.value = type
  if (type === 'match') {
    Object.assign(matchForm, {
      ...row,
      start_time: toDatetimePickerValue(row.start_time),
      end_time: toDatetimePickerValue(row.end_time),
      registration_open_at: toDatetimePickerValue(row.registration_open_at),
      registration_close_at: toDatetimePickerValue(row.registration_close_at),
      roster_frozen_at: toDatetimePickerValue(row.roster_frozen_at),
      status: row.status || 'upcoming',
    })
  }
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

/** 将接口返回的时间转为 el-date-picker value-format 所需字符串 */
const toDatetimePickerValue = (val) => {
  if (!val) return ''
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return typeof val === 'string' ? val.slice(0, 19) : ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}:${s}`
}

const matchStatusLabel = (v) => {
  const map = { upcoming: '未开始', ongoing: '进行中', completed: '已结束' }
  return map[v] || v || '-'
}

const matchPhaseLabel = (v) => {
  const map = {
    draft: '草稿',
    registration: '报名中',
    frozen: '名单冻结',
    live: '赛中',
    completed: '已完成',
    archived: '已归档',
  }
  return map[v] || v || '-'
}

const carouselTypeLabel = (v) => {
  const map = { text: '文本', promotion: '推广', event: '活动' }
  return map[v] || v || '-'
}

const userRoleLabel = (v) => {
  const map = { user: '普通用户', admin: '管理员', superadmin: '系统管理员' }
  return map[v] || v || '-'
}

const loadMatches = async () => {
  matches.value = await adminApi.match.getAll()
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
    await Promise.all([loadMatches(), loadCarousels(), loadChats(), loadUsers(), loadInviteCodes()])
  } catch (e) {
    ElMessage.error(e?.message || '后台数据加载失败')
  } finally {
    loading.value = false
  }
}

const loadActiveTabData = async (tab) => {
  if (!isAdmin.value) return
  if (tab === 'match') return loadMatches()
  if (tab === 'carousel') return loadCarousels()
  if (tab === 'chat') return loadChats()
  if (tab === 'user') return loadUsers()
  if (tab === 'invite') return loadInviteCodes()
}

const submitDialog = async () => {
  try {
    loading.value = true
    if (dialogType.value === 'match') {
      const payload = {
        title: matchForm.title,
        description: matchForm.description,
        start_time: matchForm.start_time,
        end_time: matchForm.end_time,
        registration_open_at: matchForm.registration_open_at || null,
        registration_close_at: matchForm.registration_close_at || null,
        roster_frozen_at: matchForm.roster_frozen_at || null,
        location: matchForm.location,
        status: matchForm.status,
      }
      if (matchForm.id) await adminApi.match.update(matchForm.id, payload)
      else await adminApi.match.create(payload)
      await loadMatches()
    }

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

const removeMatch = async (id) => {
  try {
    await adminApi.match.delete(id)
    await loadMatches()
    ElMessage.success('比赛已删除')
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

const setActiveRegistrationMatch = async (row) => {
  try {
    loading.value = true
    await adminApi.match.setActiveRegistration(row.id)
    await loadMatches()
    ElMessage.success('已设为当前报名赛事')
  } catch (e) {
    ElMessage.error(e?.message || '设置失败')
  } finally {
    loading.value = false
  }
}

const closeRegistrationMatch = async (row) => {
  try {
    loading.value = true
    await adminApi.match.closeRegistration(row.id)
    await loadMatches()
    ElMessage.success('报名已关闭')
  } catch (e) {
    ElMessage.error(e?.message || '关闭失败')
  } finally {
    loading.value = false
  }
}

const freezeMatchRoster = async (row) => {
  try {
    loading.value = true
    await adminApi.match.freezeRoster(row.id)
    await loadMatches()
    ElMessage.success('名单已冻结')
  } catch (e) {
    ElMessage.error(e?.message || '冻结失败')
  } finally {
    loading.value = false
  }
}

const startMatch = async (row) => {
  try {
    loading.value = true
    await adminApi.match.start(row.id)
    await loadMatches()
    ElMessage.success('比赛已开赛')
  } catch (e) {
    ElMessage.error(e?.message || '开赛失败')
  } finally {
    loading.value = false
  }
}

const completeMatch = async (row) => {
  try {
    loading.value = true
    await adminApi.match.complete(row.id)
    await loadMatches()
    ElMessage.success('比赛已完成')
  } catch (e) {
    ElMessage.error(e?.message || '完成比赛失败')
  } finally {
    loading.value = false
  }
}

const loadLiveData = async () => {
  if (!liveMatch.value?.id) return
  const [roundResp, boardResp] = await Promise.all([
    adminApi.match.getRounds(liveMatch.value.id),
    adminApi.match.getLeaderboard(liveMatch.value.id),
  ])
  liveRounds.value = roundResp?.rounds || []
  liveLeaderboard.value = boardResp?.teams || []
  if (!snapshotTeams.value.length) {
    // 积分榜为空时仍需要录入队伍；从当前报名大厅结构中取冻结后的队伍列表兜底。
    snapshotTeams.value = (matches.value || []).length ? [] : []
  }
  if (!selectedRoundId.value && liveRounds.value.length) {
    selectedRoundId.value = liveRounds.value[0].id
  }
}

const openLiveDialog = async (row) => {
  liveMatch.value = row
  liveDialogVisible.value = true
  selectedRoundId.value = null
  resultRows.value = []
  snapshotTeams.value = []
  roundForm.roundNo = 1
  roundForm.mapName = ''
  try {
    loading.value = true
    await loadLiveData()
  } catch (e) {
    ElMessage.error(e?.message || '加载赛中数据失败')
  } finally {
    loading.value = false
  }
}

const createRound = async () => {
  if (!liveMatch.value?.id) return
  try {
    loading.value = true
    await adminApi.match.createRound(liveMatch.value.id, {
      roundNo: roundForm.roundNo,
      mapName: roundForm.mapName,
    })
    await loadLiveData()
    ElMessage.success('局次已创建')
  } catch (e) {
    ElMessage.error(e?.message || '创建局次失败')
  } finally {
    loading.value = false
  }
}

const startSelectedRound = async () => {
  if (!liveMatch.value?.id || !selectedRoundId.value) return
  try {
    loading.value = true
    await adminApi.match.startRound(liveMatch.value.id, selectedRoundId.value)
    await loadLiveData()
    ElMessage.success('局次已开始')
  } catch (e) {
    ElMessage.error(e?.message || '开始局次失败')
  } finally {
    loading.value = false
  }
}

const initResultRows = () => {
  const teams = liveLeaderboard.value.length ? liveLeaderboard.value : snapshotTeams.value
  resultRows.value = teams.map((team, idx) => ({
    matchTeamId: team.matchTeamId,
    teamName: team.teamName,
    placement: idx + 1,
    kills: 0,
    penaltyPoints: 0,
    remark: '',
  }))
}

const saveRoundResults = async () => {
  if (!liveMatch.value?.id || !selectedRoundId.value) return
  if (!resultRows.value.length) {
    ElMessage.warning('请先初始化成绩行')
    return
  }
  try {
    loading.value = true
    await adminApi.match.saveRoundResults(liveMatch.value.id, selectedRoundId.value, resultRows.value)
    await loadLiveData()
    ElMessage.success('成绩已保存')
  } catch (e) {
    ElMessage.error(e?.message || '保存成绩失败')
  } finally {
    loading.value = false
  }
}

const completeSelectedRound = async () => {
  if (!liveMatch.value?.id || !selectedRoundId.value) return
  try {
    loading.value = true
    await adminApi.match.completeRound(liveMatch.value.id, selectedRoundId.value)
    await loadLiveData()
    ElMessage.success('局次已锁定')
  } catch (e) {
    ElMessage.error(e?.message || '锁定局次失败')
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
          <p class="admin-page-desc">与全站风格一致的管理中心，维护比赛、轮播、圈子、用户与邀请码。</p>
        </header>

        <div class="admin-panel">
          <el-tabs v-model="activeTab" class="admin-tabs">
            <el-tab-pane label="比赛管理" name="match" />
            <el-tab-pane label="轮播管理" name="carousel" />
            <el-tab-pane label="圈子管理" name="chat" />
            <el-tab-pane label="个人管理" name="user" />
            <el-tab-pane label="邀请码" name="invite" />
          </el-tabs>

          <div class="admin-panel-body" v-loading="loading">
            <div class="toolbar">
              <span class="toolbar-label">{{ activeModuleLabel }}</span>
              <el-button
                v-if="activeTab === 'match' || activeTab === 'carousel' || activeTab === 'user' || activeTab === 'invite'"
                type="primary"
                @click="openCreateDialog(activeTab)"
              >
                <el-icon><Plus /></el-icon>
                新增
              </el-button>
            </div>

            <el-table v-if="activeTab === 'match'" :data="matches" border class="admin-table">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="title" label="标题" />
          <el-table-column prop="location" label="地点" />
          <el-table-column prop="status" label="状态" width="120">
            <template #default="scope">{{ matchStatusLabel(scope.row.status) }}</template>
          </el-table-column>
          <el-table-column prop="phase" label="阶段" width="120">
            <template #default="scope">{{ matchPhaseLabel(scope.row.phase) }}</template>
          </el-table-column>
          <el-table-column label="当前报名" width="110">
            <template #default="scope">
              <el-tag :type="Number(scope.row.is_active_registration) === 1 ? 'success' : 'info'">
                {{ Number(scope.row.is_active_registration) === 1 ? '当前' : '否' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="开始时间" width="180">
            <template #default="scope">{{ formatDate(scope.row.start_time) }}</template>
          </el-table-column>
          <el-table-column label="结束时间" width="180">
            <template #default="scope">{{ formatDate(scope.row.end_time) }}</template>
          </el-table-column>
          <el-table-column label="报名开始" width="180">
            <template #default="scope">{{ formatDate(scope.row.registration_open_at) || '-' }}</template>
          </el-table-column>
          <el-table-column label="报名截止" width="180">
            <template #default="scope">{{ formatDate(scope.row.registration_close_at) || '-' }}</template>
          </el-table-column>
          <el-table-column label="名单冻结" width="180">
            <template #default="scope">{{ formatDate(scope.row.roster_frozen_at) || '-' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="560" fixed="right" class-name="operation-column">
            <template #default="scope">
              <div class="table-actions">
                <el-button type="primary" size="small" @click="openEditDialog('match', scope.row)"><el-icon><Edit /></el-icon></el-button>
                <el-button
                  size="small"
                  type="success"
                  plain
                  :disabled="Number(scope.row.is_active_registration) === 1"
                  @click="setActiveRegistrationMatch(scope.row)"
                >
                  设为当前
                </el-button>
                <el-button
                  size="small"
                  type="warning"
                  plain
                  :disabled="Number(scope.row.is_active_registration) !== 1"
                  @click="closeRegistrationMatch(scope.row)"
                >
                  关闭报名
                </el-button>
                <el-button
                  size="small"
                  type="info"
                  plain
                  :disabled="Boolean(scope.row.roster_frozen_at)"
                  @click="freezeMatchRoster(scope.row)"
                >
                  冻结名单
                </el-button>
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :disabled="scope.row.phase !== 'frozen'"
                  @click="startMatch(scope.row)"
                >
                  开赛
                </el-button>
                <el-button
                  size="small"
                  type="primary"
                  plain
                  :disabled="!['live', 'completed'].includes(scope.row.phase)"
                  @click="openLiveDialog(scope.row)"
                >
                  赛中管理
                </el-button>
                <el-button
                  size="small"
                  type="success"
                  plain
                  :disabled="scope.row.phase !== 'live'"
                  @click="completeMatch(scope.row)"
                >
                  完成比赛
                </el-button>
                <el-button type="danger" size="small" @click="removeMatch(scope.row.id)"><el-icon><Delete /></el-icon></el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>

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
          :title="dialogType === 'match' ? '比赛' : dialogType === 'carousel' ? '轮播' : dialogType === 'invite' ? '邀请码' : '用户'"
          width="560px"
          align-center
        >
        <div v-if="dialogType === 'match'" class="form-grid">
          <el-input v-model="matchForm.title" placeholder="标题" />
          <el-input v-model="matchForm.location" placeholder="地点" />
          <el-select v-model="matchForm.status" placeholder="比赛状态" style="width: 100%">
            <el-option label="未开始" value="upcoming" />
            <el-option label="进行中" value="ongoing" />
            <el-option label="已结束" value="completed" />
          </el-select>
          <el-date-picker
            v-model="matchForm.start_time"
            type="datetime"
            placeholder="开始时间"
            value-format="YYYY-MM-DD HH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            style="width: 100%"
          />
          <el-date-picker
            v-model="matchForm.end_time"
            type="datetime"
            placeholder="结束时间"
            value-format="YYYY-MM-DD HH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            style="width: 100%"
          />
          <el-date-picker
            v-model="matchForm.registration_open_at"
            type="datetime"
            placeholder="报名开始时间（可选）"
            value-format="YYYY-MM-DD HH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            style="width: 100%"
          />
          <el-date-picker
            v-model="matchForm.registration_close_at"
            type="datetime"
            placeholder="报名截止时间（可选）"
            value-format="YYYY-MM-DD HH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            style="width: 100%"
          />
          <el-date-picker
            v-model="matchForm.roster_frozen_at"
            type="datetime"
            placeholder="名单冻结时间（可选）"
            value-format="YYYY-MM-DD HH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            style="width: 100%"
          />
          <el-input v-model="matchForm.description" type="textarea" :rows="4" placeholder="描述" />
        </div>

        <div v-else-if="dialogType === 'carousel'" class="form-grid">
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

        <el-dialog
          v-model="liveDialogVisible"
          class="admin-dialog"
          :title="`赛中管理 - ${liveMatch?.title || ''}`"
          width="980px"
          align-center
        >
          <div class="live-panel">
            <div class="live-section">
              <h3>局次管理</h3>
              <div class="round-create-row">
                <el-input-number v-model="roundForm.roundNo" :min="1" placeholder="局次" />
                <el-input v-model="roundForm.mapName" placeholder="地图名称（如 Erangel）" />
                <el-button type="primary" @click="createRound">创建局次</el-button>
              </div>
              <el-table :data="liveRounds" border size="small">
                <el-table-column prop="round_no" label="局次" width="80" />
                <el-table-column prop="map_name" label="地图" />
                <el-table-column prop="status" label="状态" width="100" />
                <el-table-column label="操作" width="220">
                  <template #default="scope">
                    <el-button size="small" @click="selectedRoundId = scope.row.id">选择</el-button>
                    <el-button size="small" type="primary" plain :disabled="scope.row.status !== 'pending'" @click="startSelectedRound">开始</el-button>
                    <el-button size="small" type="success" plain :disabled="scope.row.status === 'completed'" @click="completeSelectedRound">锁定</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <div class="live-section">
              <h3>成绩录入</h3>
              <div class="round-create-row">
                <el-select v-model="selectedRoundId" placeholder="选择局次" style="width: 180px">
                  <el-option
                    v-for="round in liveRounds"
                    :key="round.id"
                    :label="`第 ${round.round_no} 局 - ${round.status}`"
                    :value="round.id"
                  />
                </el-select>
                <el-button @click="initResultRows">初始化成绩行</el-button>
                <el-button type="primary" @click="saveRoundResults">保存成绩</el-button>
              </div>
              <el-table :data="resultRows" border size="small">
                <el-table-column prop="teamName" label="队伍" min-width="160" />
                <el-table-column label="排名" width="120">
                  <template #default="scope">
                    <el-input-number v-model="scope.row.placement" :min="1" :max="16" size="small" />
                  </template>
                </el-table-column>
                <el-table-column label="淘汰" width="120">
                  <template #default="scope">
                    <el-input-number v-model="scope.row.kills" :min="0" size="small" />
                  </template>
                </el-table-column>
                <el-table-column label="扣分" width="120">
                  <template #default="scope">
                    <el-input-number v-model="scope.row.penaltyPoints" :min="0" size="small" />
                  </template>
                </el-table-column>
                <el-table-column label="备注" min-width="160">
                  <template #default="scope">
                    <el-input v-model="scope.row.remark" size="small" />
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <div class="live-section">
              <h3>积分榜</h3>
              <el-table :data="liveLeaderboard" border size="small">
                <el-table-column prop="rank" label="排名" width="80" />
                <el-table-column prop="teamName" label="队伍" />
                <el-table-column prop="totalPoints" label="总分" width="90" />
                <el-table-column prop="kills" label="总淘汰" width="90" />
                <el-table-column prop="placementPoints" label="排名分" width="90" />
                <el-table-column prop="killPoints" label="淘汰分" width="90" />
                <el-table-column prop="penaltyPoints" label="扣分" width="80" />
              </el-table>
            </div>
          </div>
          <template #footer>
            <el-button @click="liveDialogVisible = false">关闭</el-button>
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

