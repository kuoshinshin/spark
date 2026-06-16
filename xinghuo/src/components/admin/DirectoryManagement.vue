<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, Edit, Plus } from '@element-plus/icons-vue'
import { adminApi, authApi } from '../../services/api'
import {
  createDefaultPlacementRows,
  DEFAULT_BASIC_INFO_CONTENT,
  DEFAULT_PLACEMENT_POINTS,
  placementMapToRows,
  placementRowsToMap,
} from '../../utils/eventScoring'

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

const activeTab = ref('event')
const tabLabels = {
  event: '杯赛管理',
  carousel: '轮播管理',
  chat: '圈子管理',
  user: '个人管理',
  invite: '邀请码',
}
const activeModuleLabel = computed(() => tabLabels[activeTab.value] || '')
const loading = ref(false)

const carousels = ref([])
const events = ref([])
const chats = ref([])
const users = ref([])
const inviteCodes = ref([])

const dialogType = ref('')
const dialogVisible = ref(false)

const eventForm = reactive({
  id: null,
  title: '',
  status: 'draft',
  registration_open_at: '',
  registration_close_at: '',
  require_pubg_binding: true,
})

const basicInfoForm = reactive({
  content: DEFAULT_BASIC_INFO_CONTENT,
  pointsPerKill: 1,
  placementRows: createDefaultPlacementRows(),
})

const basicInfoEditable = computed(() => ['draft', 'registration'].includes(eventForm.status))

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

const resetBasicInfoForm = () => {
  Object.assign(basicInfoForm, {
    content: DEFAULT_BASIC_INFO_CONTENT,
    pointsPerKill: 1,
    placementRows: createDefaultPlacementRows(),
  })
}

const applyBasicInfoToForm = (basicInfo) => {
  if (!basicInfo) {
    resetBasicInfoForm()
    return
  }
  Object.assign(basicInfoForm, {
    content: basicInfo.content || DEFAULT_BASIC_INFO_CONTENT,
    pointsPerKill: Number(basicInfo.pointsPerKill ?? 1),
    placementRows: placementMapToRows(basicInfo.placementPoints),
  })
}

const restoreDefaultBasicInfo = () => {
  Object.assign(basicInfoForm, {
    content: DEFAULT_BASIC_INFO_CONTENT,
    pointsPerKill: 1,
    placementRows: createDefaultPlacementRows(),
  })
}

const buildBasicInfoPayload = () => ({
  content: basicInfoForm.content,
  pointsPerKill: Number(basicInfoForm.pointsPerKill) || 0,
  placementPoints: placementRowsToMap(basicInfoForm.placementRows),
})

const resetEventForm = () => {
  Object.assign(eventForm, {
    id: null,
    title: '',
    status: 'draft',
    registration_open_at: '',
    registration_close_at: '',
    require_pubg_binding: true,
  })
  resetBasicInfoForm()
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
  if (type === 'event') resetEventForm()
  if (type === 'carousel') resetCarouselForm()
  if (type === 'user') resetUserForm()
  if (type === 'invite') resetInviteForm()
  dialogVisible.value = true
}

const openEditDialog = async (type, row) => {
  dialogType.value = type
  if (type === 'event') {
    Object.assign(eventForm, {
      id: row.id,
      title: row.title,
      status: row.status,
      registration_open_at: row.registrationOpenAt || row.registration_open_at || '',
      registration_close_at: row.registrationCloseAt || row.registration_close_at || '',
      require_pubg_binding: row.requirePubgBinding ?? row.require_pubg_binding ?? true,
    })
    if (row.basicInfo) {
      applyBasicInfoToForm(row.basicInfo)
    } else if (row.id) {
      try {
        const data = await adminApi.events.getBasicInfo(row.id)
        applyBasicInfoToForm(data.basicInfo)
      } catch {
        resetBasicInfoForm()
      }
    } else {
      resetBasicInfoForm()
    }
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

const carouselTypeLabel = (v) => {
  const map = { text: '文本', promotion: '推广', event: '活动' }
  return map[v] || v || '-'
}

const userRoleLabel = (v) => {
  const map = { user: '普通用户', admin: '管理员', superadmin: '系统管理员' }
  return map[v] || v || '-'
}

const eventStatusLabel = (v) => {
  const map = {
    draft: '筹备中',
    registration: '报名中',
    locked: '名单已锁定',
    scoring: '录入成绩',
    finished: '已结束',
  }
  return map[v] || v || '-'
}

const loadEvents = async () => {
  events.value = await adminApi.events.getAll()
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
    await Promise.all([loadEvents(), loadCarousels(), loadChats(), loadUsers(), loadInviteCodes()])
  } catch (e) {
    ElMessage.error(e?.message || '后台数据加载失败')
  } finally {
    loading.value = false
  }
}

const loadActiveTabData = async (tab) => {
  if (!isAdmin.value) return
  if (tab === 'event') return loadEvents()
  if (tab === 'carousel') return loadCarousels()
  if (tab === 'chat') return loadChats()
  if (tab === 'user') return loadUsers()
  if (tab === 'invite') return loadInviteCodes()
}

const submitDialog = async () => {
  try {
    loading.value = true
    if (dialogType.value === 'event') {
      const payload = {
        title: eventForm.title,
        registration_open_at: eventForm.registration_open_at || null,
        registration_close_at: eventForm.registration_close_at || null,
        require_pubg_binding: eventForm.require_pubg_binding,
      }
      let eventId = eventForm.id
      if (eventId) {
        await adminApi.events.update(eventId, payload)
      } else {
        const created = await adminApi.events.create(payload)
        eventId = created?.event?.id
      }
      if (eventId && basicInfoEditable.value) {
        await adminApi.events.updateBasicInfo(eventId, buildBasicInfoPayload())
      }
      await loadEvents()
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

const publishEvent = async (row) => {
  try {
    loading.value = true
    await adminApi.events.publish(row.id)
    await loadEvents()
    ElMessage.success('杯赛已发布')
  } catch (e) {
    ElMessage.error(e?.message || '发布失败')
  } finally {
    loading.value = false
  }
}

const lockEvent = async (row) => {
  try {
    loading.value = true
    await adminApi.events.lock(row.id)
    await loadEvents()
    ElMessage.success('名单已锁定')
  } catch (e) {
    ElMessage.error(e?.message || '锁定失败')
  } finally {
    loading.value = false
  }
}

const scoringVisible = ref(false)
const scoringLoading = ref(false)
const scoringEvent = ref(null)
const scoringRounds = ref([])
const scoringTeams = ref([])
const scoringRoster = ref([])
const selectedRoundId = ref(null)
const scoreRows = ref([])
const newRoundMap = ref('')

const pointsPerKill = computed(() => Number(scoringEvent.value?.basicInfo?.pointsPerKill ?? 1))

const placementPointsMap = computed(() => (
  scoringEvent.value?.basicInfo?.placementPoints || DEFAULT_PLACEMENT_POINTS
))

const rosterMembersForTeam = (teamId) => (
  scoringRoster.value.find((team) => team.id === teamId)?.members || []
)

const previewTeamPoints = (row) => {
  const placement = Number(row.placement)
  if (!Number.isInteger(placement) || placement < 1) return null
  const placementPoints = placementPointsMap.value[placement] ?? 0
  const kills = row.members?.length
    ? row.members.reduce((sum, member) => sum + (Number(member.kills) || 0), 0)
    : Number(row.kills) || 0
  const killPoints = kills * pointsPerKill.value
  return {
    placementPoints,
    killPoints,
    totalPoints: placementPoints + killPoints,
    kills,
  }
}

const syncTeamKills = (row) => {
  const preview = previewTeamPoints(row)
  if (!preview) return
  row.kills = preview.kills
}

const buildScoreRows = (results = []) => {
  const resultMap = new Map(results.map((r) => [r.teamId, r]))
  return scoringTeams.value.map((team) => {
    const existing = resultMap.get(team.id)
    const rosterMembers = rosterMembersForTeam(team.id)
    const memberMap = new Map((existing?.members || []).map((member) => [member.slotIndex, member.kills]))
    const members = rosterMembers.map((member) => ({
      slotIndex: member.slotIndex,
      displayName: member.displayName,
      role: member.role,
      kills: memberMap.get(member.slotIndex) ?? 0,
    }))
    const row = {
      eventTeamId: team.id,
      teamNumber: team.teamNumber,
      teamName: team.teamName,
      placement: existing?.placement ?? '',
      kills: existing?.kills ?? 0,
      members,
    }
    if (members.length) syncTeamKills(row)
    return row
  })
}

const loadScoringData = async () => {
  if (!scoringEvent.value?.id) return
  scoringLoading.value = true
  try {
    const data = await adminApi.events.getRounds(scoringEvent.value.id)
    scoringRounds.value = data.rounds || []
    scoringTeams.value = data.teams || []
    scoringRoster.value = data.roster || []
    if (scoringEvent.value) {
      scoringEvent.value = {
        ...scoringEvent.value,
        status: data.event?.status || scoringEvent.value.status,
        basicInfo: data.event?.basicInfo || scoringEvent.value.basicInfo,
      }
    }
  } catch (e) {
    ElMessage.error(e?.message || '加载局次失败')
  } finally {
    scoringLoading.value = false
  }
}

const openScoringDialog = async (row) => {
  scoringEvent.value = { ...row }
  selectedRoundId.value = null
  scoreRows.value = []
  newRoundMap.value = ''
  scoringVisible.value = true
  await loadScoringData()
}

const startScoring = async (row) => {
  try {
    loading.value = true
    await adminApi.events.startScoring(row.id)
    await loadEvents()
    ElMessage.success('已进入录分阶段')
  } catch (e) {
    ElMessage.error(e?.message || '开始录分失败')
  } finally {
    loading.value = false
  }
}

const finishEvent = async (row) => {
  if (!row?.id) {
    ElMessage.warning('杯赛信息无效')
    return
  }
  try {
    await ElMessageBox.confirm('确定结束杯赛？结束后榜单将定格。', '结束杯赛', {
      type: 'warning',
      confirmButtonText: '结束',
      cancelButtonText: '取消',
      zIndex: 12000,
      appendTo: document.body,
    })
  } catch {
    return
  }
  try {
    loading.value = true
    await adminApi.events.finish(row.id)
    await loadEvents()
    if (scoringVisible.value && scoringEvent.value?.id === row.id) {
      scoringVisible.value = false
    }
    ElMessage.success('杯赛已结束')
  } catch (e) {
    ElMessage.error(e?.message || '结束杯赛失败')
  } finally {
    loading.value = false
  }
}

const addRound = async () => {
  if (!scoringEvent.value?.id) return
  try {
    scoringLoading.value = true
    await adminApi.events.createRound(scoringEvent.value.id, {
      map_name: newRoundMap.value || null,
    })
    newRoundMap.value = ''
    await loadScoringData()
    await loadEvents()
    ElMessage.success('局次已创建')
  } catch (e) {
    ElMessage.error(e?.message || '创建局次失败')
  } finally {
    scoringLoading.value = false
  }
}

const selectRound = async (round) => {
  selectedRoundId.value = round.id
  scoringLoading.value = true
  try {
    const data = await adminApi.events.getRoundResults(scoringEvent.value.id, round.id)
    scoreRows.value = buildScoreRows(data.results || [])
  } catch (e) {
    scoreRows.value = buildScoreRows()
    ElMessage.error(e?.message || '加载成绩失败')
  } finally {
    scoringLoading.value = false
  }
}

const saveRoundScores = async () => {
  if (!selectedRoundId.value) return
  const results = scoreRows.value.map((row) => {
    const members = (row.members || []).map((member) => ({
      slotIndex: member.slotIndex,
      kills: Number(member.kills) || 0,
    }))
    const kills = members.length
      ? members.reduce((sum, member) => sum + member.kills, 0)
      : Number(row.kills) || 0
    return {
      eventTeamId: row.eventTeamId,
      placement: Number(row.placement),
      kills,
      members,
    }
  })
  try {
    scoringLoading.value = true
    await adminApi.events.saveRoundResults(scoringEvent.value.id, selectedRoundId.value, results)
    ElMessage.success('成绩已保存')
    await loadScoringData()
    await loadEvents()
  } catch (e) {
    ElMessage.error(e?.message || '保存成绩失败')
  } finally {
    scoringLoading.value = false
  }
}

const completeRound = async (round) => {
  try {
    scoringLoading.value = true
    await adminApi.events.completeRound(scoringEvent.value.id, round.id)
    await loadScoringData()
    ElMessage.success(`第 ${round.roundNo} 局已完成`)
  } catch (e) {
    ElMessage.error(e?.message || '完成局次失败')
  } finally {
    scoringLoading.value = false
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
          <p class="admin-page-desc">与全站风格一致的管理中心，维护杯赛、轮播、圈子、用户与邀请码。</p>
        </header>

        <div class="admin-panel">
          <el-tabs v-model="activeTab" class="admin-tabs">
            <el-tab-pane label="杯赛管理" name="event" />
            <el-tab-pane label="轮播管理" name="carousel" />
            <el-tab-pane label="圈子管理" name="chat" />
            <el-tab-pane label="个人管理" name="user" />
            <el-tab-pane label="邀请码" name="invite" />
          </el-tabs>

          <div class="admin-panel-body" v-loading="loading">
            <div class="toolbar">
              <span class="toolbar-label">{{ activeModuleLabel }}</span>
              <el-button
                v-if="activeTab === 'event' || activeTab === 'carousel' || activeTab === 'user' || activeTab === 'invite'"
                type="primary"
                @click="openCreateDialog(activeTab)"
              >
                <el-icon><Plus /></el-icon>
                新增
              </el-button>
            </div>

            <el-table v-if="activeTab === 'event'" :data="events" border class="admin-table">
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="title" label="杯赛名称" min-width="160" />
          <el-table-column label="状态" width="120">
            <template #default="scope">{{ eventStatusLabel(scope.row.status) }}</template>
          </el-table-column>
          <el-table-column label="报名开始" width="170">
            <template #default="scope">{{ formatDate(scope.row.registration_open_at || scope.row.registrationOpenAt) }}</template>
          </el-table-column>
          <el-table-column label="报名截止" width="170">
            <template #default="scope">{{ formatDate(scope.row.registration_close_at || scope.row.registrationCloseAt) }}</template>
          </el-table-column>
          <el-table-column label="需绑定PUBG" width="110">
            <template #default="scope">
              {{ (scope.row.require_pubg_binding ?? scope.row.requirePubgBinding) ? '是' : '否' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="360" fixed="right">
            <template #default="scope">
              <el-button
                v-if="scope.row.status === 'draft' || scope.row.status === 'registration'"
                type="primary"
                size="small"
                @click="openEditDialog('event', scope.row)"
              >
                <el-icon><Edit /></el-icon>
              </el-button>
              <el-button
                v-if="scope.row.status === 'draft'"
                type="success"
                size="small"
                @click="publishEvent(scope.row)"
              >
                发布
              </el-button>
              <el-button
                v-if="scope.row.status === 'registration'"
                type="warning"
                size="small"
                @click="lockEvent(scope.row)"
              >
                锁名单
              </el-button>
              <el-button
                v-if="scope.row.status === 'locked'"
                type="primary"
                size="small"
                @click="startScoring(scope.row)"
              >
                开始录分
              </el-button>
              <el-button
                v-if="scope.row.status === 'locked' || scope.row.status === 'scoring'"
                type="success"
                size="small"
                @click="openScoringDialog(scope.row)"
              >
                录分
              </el-button>
              <el-button
                v-if="scope.row.status === 'scoring'"
                type="danger"
                size="small"
                @click.stop="finishEvent(scope.row)"
              >
                结束
              </el-button>
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
          class="admin-dialog event-dialog"
          :title="dialogType === 'event' ? '杯赛' : dialogType === 'carousel' ? '轮播' : dialogType === 'invite' ? '邀请码' : '用户'"
          :width="dialogType === 'event' ? 'min(760px, 96vw)' : '560px'"
          align-center
        >
        <div v-if="dialogType === 'event'" class="form-grid event-form-grid">
          <el-input v-model="eventForm.title" placeholder="杯赛名称" :disabled="!basicInfoEditable" />
          <el-input
            v-model="eventForm.registration_open_at"
            placeholder="报名开始（ISO 或 YYYY-MM-DD HH:mm:ss，可留空）"
            :disabled="!basicInfoEditable"
          />
          <el-input
            v-model="eventForm.registration_close_at"
            placeholder="报名截止（可留空）"
            :disabled="!basicInfoEditable"
          />
          <el-switch
            v-model="eventForm.require_pubg_binding"
            active-text="需绑定 PUBG"
            inactive-text="无需绑定"
            :disabled="!basicInfoEditable"
          />

          <div class="basic-info-panel">
            <div class="basic-info-head">
              <span class="section-label">基础信息（含 PGS 赛事规则）</span>
              <el-button
                v-if="basicInfoEditable"
                size="small"
                plain
                @click="restoreDefaultBasicInfo"
              >
                恢复 PGS 默认
              </el-button>
            </div>
            <p v-if="!basicInfoEditable" class="basic-info-lock-hint">名单已锁定，基础信息不可修改</p>
            <el-input
              v-model="basicInfoForm.content"
              type="textarea"
              :rows="8"
              placeholder="赛事说明、赛制、报名规则等"
              :disabled="!basicInfoEditable"
            />

            <div class="placement-editor">
              <div class="placement-editor-head">
                <span>PGS 排名分（1–16 名）</span>
                <span class="placement-kill-label">每击杀得分</span>
                <el-input-number
                  v-model="basicInfoForm.pointsPerKill"
                  class="placement-kill-input"
                  :min="0"
                  :max="100"
                  controls-position="right"
                  :disabled="!basicInfoEditable"
                />
              </div>
              <div class="placement-grid">
                <div
                  v-for="row in basicInfoForm.placementRows"
                  :key="row.rank"
                  class="placement-grid-item"
                >
                  <span class="placement-rank">#{{ row.rank }}</span>
                  <el-input-number
                    v-model="row.points"
                    :min="0"
                    :max="100"
                    controls-position="right"
                    :disabled="!basicInfoEditable"
                  />
                </div>
              </div>
            </div>
          </div>
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

        <div v-else-if="dialogType === 'user'" class="form-grid">
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
          v-model="scoringVisible"
          class="admin-dialog scoring-dialog"
          :title="scoringEvent ? `录分 · ${scoringEvent.title}` : '录分'"
          width="min(1200px, 96vw)"
          align-center
          destroy-on-close
        >
          <div v-loading="scoringLoading" class="scoring-body">
            <div class="scoring-toolbar">
              <el-input v-model="newRoundMap" class="map-input" placeholder="地图名（可选）" />
              <el-button type="primary" @click="addRound">新建局次</el-button>
              <el-button
                v-if="scoringEvent?.status === 'scoring'"
                type="danger"
                plain
                class="finish-btn"
                @click="finishEvent(scoringEvent)"
              >
                结束杯赛
              </el-button>
            </div>

            <div class="scoring-layout">
              <div class="round-list">
                <p class="section-label">局次列表</p>
                <el-empty v-if="!scoringRounds.length" description="请先新建局次" :image-size="60" />
                <button
                  v-for="round in scoringRounds"
                  :key="round.id"
                  type="button"
                  class="round-item"
                  :class="{ active: selectedRoundId === round.id }"
                  @click="selectRound(round)"
                >
                  <span>第 {{ round.roundNo }} 局</span>
                  <span v-if="round.mapName" class="round-map-name">· {{ round.mapName }}</span>
                  <el-tag size="small" :type="round.status === 'completed' ? 'success' : 'info'">
                    {{ round.status === 'completed' ? '已完成' : '待录入' }}
                  </el-tag>
                </button>
              </div>

              <div class="score-panel">
                <template v-if="selectedRoundId">
                  <p class="section-label">录入 16 队名次；展开行可录成员击杀（队伍击杀自动汇总）</p>
                  <div class="score-table-wrap">
                    <el-table :data="scoreRows" border size="small" class="score-table">
                      <el-table-column type="expand" width="42">
                        <template #default="scope">
                          <div class="member-score-panel">
                            <p v-if="!scope.row.members.length" class="member-score-empty">该队暂无占槽成员</p>
                            <div
                              v-for="member in scope.row.members"
                              :key="member.slotIndex"
                              class="member-score-row"
                            >
                              <span class="member-score-name">
                                {{ member.displayName }}
                                <em v-if="member.role === 'captain'">队长</em>
                              </span>
                              <el-input-number
                                v-model="member.kills"
                                :min="0"
                                controls-position="right"
                                @change="syncTeamKills(scope.row)"
                              />
                            </div>
                          </div>
                        </template>
                      </el-table-column>
                      <el-table-column prop="teamNumber" label="#" width="56" align="center" />
                      <el-table-column prop="teamName" label="队伍" min-width="120" show-overflow-tooltip />
                      <el-table-column label="名次" width="120" align="center">
                        <template #default="scope">
                          <el-input-number
                            v-model="scope.row.placement"
                            class="score-input"
                            :min="1"
                            :max="16"
                            controls-position="right"
                          />
                        </template>
                      </el-table-column>
                      <el-table-column label="排名分" width="78" align="center">
                        <template #default="scope">
                          {{ previewTeamPoints(scope.row)?.placementPoints ?? '—' }}
                        </template>
                      </el-table-column>
                      <el-table-column label="击杀" width="78" align="center">
                        <template #default="scope">
                          <span v-if="scope.row.members.length">{{ previewTeamPoints(scope.row)?.kills ?? 0 }}</span>
                          <el-input-number
                            v-else
                            v-model="scope.row.kills"
                            class="score-input"
                            :min="0"
                            controls-position="right"
                          />
                        </template>
                      </el-table-column>
                      <el-table-column label="总分" width="78" align="center">
                        <template #default="scope">
                          {{ previewTeamPoints(scope.row)?.totalPoints ?? '—' }}
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                  <div class="score-actions">
                    <el-button type="primary" @click="saveRoundScores">保存成绩</el-button>
                    <el-button
                      v-for="round in scoringRounds.filter((r) => r.id === selectedRoundId)"
                      :key="round.id"
                      type="success"
                      plain
                      :disabled="round.status === 'completed'"
                      @click="completeRound(round)"
                    >
                      完成本局
                    </el-button>
                  </div>
                </template>
                <el-empty v-else description="请选择左侧局次" />
              </div>
            </div>
          </div>
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

.event-form-grid {
  gap: 12px;
}

.basic-info-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-top: 0.25rem;
  border-top: 1px solid #e5e5ea;
}

.basic-info-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.basic-info-lock-hint {
  margin: 0;
  font-size: 0.82rem;
  color: #e68619;
}

.placement-editor {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.placement-editor-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.85rem;
  color: #424245;
}

.placement-kill-label {
  margin-left: auto;
}

.placement-kill-input {
  width: 120px;
}

.placement-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
}

.placement-grid-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.placement-rank {
  width: 2rem;
  flex-shrink: 0;
  font-size: 0.8rem;
  color: #86868b;
  text-align: right;
}

.placement-grid-item :deep(.el-input-number) {
  width: 100%;
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

.scoring-toolbar {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
  align-items: center;
  flex-wrap: wrap;
}

.map-input {
  width: min(240px, 100%);
}

.finish-btn {
  margin-left: auto;
}

.scoring-dialog :deep(.el-dialog__body) {
  padding-top: 12px;
  max-height: calc(100vh - 140px);
  overflow: auto;
}

.scoring-layout {
  display: grid;
  grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.section-label {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  color: #86868b;
}

.round-list {
  border: 1px solid #e5e5ea;
  border-radius: 8px;
  padding: 0.75rem;
  max-height: calc(100vh - 240px);
  overflow-y: auto;
}

.round-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  padding: 0.5rem 0.6rem;
  margin-bottom: 0.35rem;
  border: 1px solid transparent;
  border-radius: 6px;
  background: #fafafa;
  color: #1d1d1f;
  text-align: left;
  cursor: pointer;
}

.round-map-name {
  color: #6e6e73;
  font-size: 0.85rem;
}

.round-item.active {
  border-color: #0071e3;
  background: #f0f7ff;
}

.score-panel {
  border: 1px solid #e5e5ea;
  border-radius: 8px;
  padding: 0.75rem;
  min-width: 0;
}

.score-table-wrap {
  width: 100%;
  overflow-x: auto;
}

.score-table {
  width: 100%;
}

.score-table :deep(.el-input-number) {
  width: 120px;
}

.score-table :deep(.el-input-number .el-input__wrapper) {
  padding-left: 8px;
  padding-right: 32px;
}

.score-table-wrap {
  overflow: auto;
}

.member-score-panel {
  padding: 0.35rem 0.5rem 0.5rem;
}

.member-score-empty {
  margin: 0;
  font-size: 0.8rem;
  color: #86868b;
}

.member-score-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0;
}

.member-score-name {
  font-size: 0.82rem;
  color: #1d1d1f;
}

.member-score-name em {
  margin-left: 0.35rem;
  font-style: normal;
  font-size: 0.72rem;
  color: #0071e3;
}

.score-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}

:global(.dark-mode) .scoring-dialog .round-item {
  background: #2c2c2e;
  border-color: #48484a;
  color: #f5f5f7;
}

:global(.dark-mode) .scoring-dialog .round-map-name {
  color: #a1a1a6;
}

:global(.dark-mode) .scoring-dialog .round-item.active {
  background: #1a3a5c;
  border-color: #409eff;
}

:global(.dark-mode) .scoring-dialog .round-list,
:global(.dark-mode) .scoring-dialog .score-panel {
  border-color: #48484a;
}

:global(.dark-mode) .scoring-dialog .section-label {
  color: #a1a1a6;
}

@media (max-width: 768px) {
  .scoring-layout {
    grid-template-columns: 1fr;
  }

  .round-list {
    max-height: 200px;
  }
}
</style>

<style>
.el-dialog.scoring-dialog {
  width: min(1200px, 96vw) !important;
  margin: 4vh auto !important;
  display: flex;
  flex-direction: column;
  max-height: 92vh;
}

.el-dialog.scoring-dialog .el-dialog__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>

<style>
.el-dialog.scoring-dialog {
  width: min(1200px, 96vw) !important;
  margin: 4vh auto !important;
  display: flex;
  flex-direction: column;
  max-height: 92vh;
}

.el-dialog.scoring-dialog .el-dialog__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>

