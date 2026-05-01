<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { userApi } from '../../services/api'
import { DEFAULT_AVATAR, normalizeAvatar } from '../../utils/avatar'

// 用户数据
const userData = ref(null)

// 加载状态
const isLoading = ref(true)
const errorMessage = ref('')

const isEditing = ref(false)
const editedUserData = ref(null)
const pubgBindingForm = ref({
  playerName: '',
  platform: 'steam'
})
const pubgStats = ref(null)
const pubgPower = ref(null)
const pubgPowerLoading = ref(false)
const pubgLoading = ref(false)
const isRefreshingStats = ref(false)
const isRebinding = ref(false)
const pubgMatches = ref([])
const pubgMatchesTotal = ref(0)
const matchesLoading = ref(false)
const matchDetailLoading = ref(false)
const matchDetailMap = ref({})
const expandedRowLoadingMap = ref({})
const expandedMatchRowKeys = ref([])
const seasonOptions = ref([])
const seasonFilterNote = ref('')
const matchQuery = ref({
  page: 1,
  pageSize: 10,
  mode: '',
  season: ''
})
const animatedStats = ref({
  roundsPlayed: 0,
  wins: 0,
  kills: 0,
  kdRatio: 0,
  winRate: 0
})
const overviewType = ref('normal')
const getOverviewByType = (stats, type) => {
  if (!stats) return null
  const empty = { roundsPlayed: 0, wins: 0, kills: 0, kdRatio: 0, winRate: 0 }
  if (type === 'ranked') return stats.rankedOverview || empty
  if (type === 'normal') return stats.normalOverview || stats || empty
  return stats || empty
}
const currentOverviewStats = computed(() => getOverviewByType(pubgStats.value, overviewType.value))
const pubgPowerTone = computed(() => {
  const score = Number(pubgPower.value?.score || 0)
  if (score >= 900) return 'legend'
  if (score >= 780) return 'high'
  if (score >= 650) return 'mid'
  if (score >= 520) return 'base'
  return 'low'
})
const pubgVisual = computed(() => {
  const stats = currentOverviewStats.value
  if (!stats) return null
  const roundsPlayed = Number(stats.roundsPlayed || 0)
  const wins = Number(stats.wins || 0)
  const kills = Number(stats.kills || 0)
  const kdRatio = Number(stats.kdRatio || 0)
  const winRate = Number(stats.winRate || 0)

  const winsPercent = roundsPlayed > 0 ? Math.min(100, Number(((wins / roundsPlayed) * 100).toFixed(2))) : 0
  const killsPerMatch = roundsPlayed > 0 ? Number((kills / roundsPlayed).toFixed(2)) : 0
  const killsPerMatchPercent = Math.min(100, Number((killsPerMatch * 10).toFixed(2)))
  const kdPercent = Math.min(100, Number((kdRatio * 20).toFixed(2)))

  return {
    roundsPlayed,
    wins,
    kills,
    kdRatio,
    winRate,
    winsPercent,
    killsPerMatch,
    killsPerMatchPercent,
    kdPercent
  }
})
const pubgDisplay = computed(() => {
  const target = pubgVisual.value
  if (!target) return null
  const roundsPlayed = Math.round(animatedStats.value.roundsPlayed || 0)
  const wins = Math.round(animatedStats.value.wins || 0)
  const kills = Math.round(animatedStats.value.kills || 0)
  const kdRatio = Number((animatedStats.value.kdRatio || 0).toFixed(2))
  const winRate = Number((animatedStats.value.winRate || 0).toFixed(2))
  const winsPercent = roundsPlayed > 0 ? Math.min(100, Number(((wins / roundsPlayed) * 100).toFixed(2))) : 0
  const killsPerMatch = roundsPlayed > 0 ? Number((kills / roundsPlayed).toFixed(2)) : 0
  const killsPerMatchPercent = Math.min(100, Number((killsPerMatch * 10).toFixed(2)))
  const kdPercent = Math.min(100, Number((kdRatio * 20).toFixed(2)))

  return {
    roundsPlayed,
    wins,
    kills,
    kdRatio,
    winRate,
    winsPercent,
    killsPerMatch,
    killsPerMatchPercent,
    kdPercent
  }
})
const isPubgBound = computed(() => Boolean(userData.value?.pubgBinding?.playerId))
const mapNameDict = {
  Baltic_Main: '艾伦格',
  Desert_Main: '米拉玛',
  Savage_Main: '萨诺',
  DihorOtok_Main: '维寒迪',
  Summerland_Main: '卡拉金',
  Chimera_Main: '帕拉莫',
  Tiger_Main: '泰戈',
  Kiki_Main: '帝斯顿',
  Neon_Main: '荣都'
}

const modeDict = {
  solo: '单排',
  duo: '双排',
  squad: '四排',
  'solo-fpp': '单排(FPP)',
  'duo-fpp': '双排(FPP)',
  'squad-fpp': '四排(FPP)'
}

const formatMapName = (mapName) => mapNameDict[mapName] || mapName || '-'
const formatModeName = (mode) => modeDict[String(mode || '').toLowerCase()] || mode || '-'
const formatMatchType = (row) => {
  if (!row) return '-'
  if (row.isCustomMatch || String(row.matchType || '').toLowerCase() === 'custom') return '自定义'

  const type = String(row.matchType || '').toLowerCase()
  if (['competitive', 'ranked'].includes(type)) return '竞技'
  if (['official', 'normal', 'matchmaking', 'public'].includes(type)) return '匹配'

  return row.matchType || '匹配'
}
const formatDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

const formatSeasonLabel = (seasonId, isCurrentSeason = false) => {
  const text = String(seasonId || '').trim()
  if (!text) return ''

  if (text === 'lifetime') {
    return isCurrentSeason ? '生涯总计（当前）' : '生涯总计'
  }

  const raw = text.includes('.') ? text.slice(text.lastIndexOf('.') + 1) : text
  const platformPrefixMap = {
    pc: 'PC',
    playstation: 'PS',
    xbox: 'Xbox',
    console: '主机'
  }

  let base = ''
  const platformSeasonMatch = raw.match(/^(pc|playstation|xbox|console)-(.+)$/i)
  if (platformSeasonMatch) {
    const platformKey = platformSeasonMatch[1].toLowerCase()
    const seasonPart = platformSeasonMatch[2]
    const platformLabel = platformPrefixMap[platformKey] || platformSeasonMatch[1]
    const yearSeasonMatch = seasonPart.match(/^(\d{4})-(\d+)$/)
    const pureNumberMatch = seasonPart.match(/^(\d+)$/)

    if (yearSeasonMatch) {
      base = `${platformLabel} ${yearSeasonMatch[1]}年第${Number(yearSeasonMatch[2])}赛季`
    } else if (pureNumberMatch) {
      base = `${platformLabel} 第${Number(pureNumberMatch[1])}赛季`
    } else {
      base = `${platformLabel} ${seasonPart}`
    }
  } else {
    const pureNumberMatch = raw.match(/^(\d+)$/)
    base = pureNumberMatch ? `第${Number(pureNumberMatch[1])}赛季` : raw
  }

  return isCurrentSeason ? `${base}（当前）` : base
}

const animatePubgNumbers = (targetStats) => {
  if (!targetStats) {
    animatedStats.value = { roundsPlayed: 0, wins: 0, kills: 0, kdRatio: 0, winRate: 0 }
    return
  }
  const start = { ...animatedStats.value }
  const end = {
    roundsPlayed: Number(targetStats.roundsPlayed || 0),
    wins: Number(targetStats.wins || 0),
    kills: Number(targetStats.kills || 0),
    kdRatio: Number(targetStats.kdRatio || 0),
    winRate: Number(targetStats.winRate || 0)
  }
  const duration = 900
  const startTime = performance.now()

  const step = (now) => {
    const progress = Math.min((now - startTime) / duration, 1)
    const ease = 1 - Math.pow(1 - progress, 3)
    animatedStats.value = {
      roundsPlayed: start.roundsPlayed + (end.roundsPlayed - start.roundsPlayed) * ease,
      wins: start.wins + (end.wins - start.wins) * ease,
      kills: start.kills + (end.kills - start.kills) * ease,
      kdRatio: start.kdRatio + (end.kdRatio - start.kdRatio) * ease,
      winRate: start.winRate + (end.winRate - start.winRate) * ease
    }
    if (progress < 1) {
      requestAnimationFrame(step)
    }
  }
  requestAnimationFrame(step)
}

// 获取用户信息
const fetchUserData = async () => {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [data, statsData] = await Promise.all([
      userApi.getCurrentUser(),
      userApi.getStats().catch(() => null)
    ])
    
    // 确保 data 是一个对象
    if (typeof data === 'object' && data !== null) {
      // 设置用户数据
      userData.value = {
        ...data,
        avatar: normalizeAvatar(data.avatar),
        pubgBinding: data.pubgBinding || {
          playerName: '',
          platform: '',
          playerId: '',
          boundAt: null
        }
      }
      pubgBindingForm.value = {
        playerName: userData.value.pubgBinding.playerName || '',
        platform: userData.value.pubgBinding.platform || 'steam'
      }
      pubgStats.value = statsData?.pubgStats || null
      animatePubgNumbers(pubgVisual.value)
      editedUserData.value = { ...userData.value }

      // 首屏优先渲染：慢接口改为后台加载，避免页面长时间卡在 loading
      if (userData.value.pubgBinding?.playerId) {
        Promise.allSettled([
          fetchPubgPower(),
          fetchPubgSeasons(),
          fetchPubgMatches()
        ])
      }
    } else {
      errorMessage.value = '获取用户信息失败: 响应格式错误'
      // 设置默认数据
      setDefaultUserData()
    }
  } catch (error) {
    errorMessage.value = error.message || '获取用户信息失败'
    console.error('获取用户信息失败:', error)
    // 设置默认数据
    setDefaultUserData()
  } finally {
    isLoading.value = false
  }
}

// 设置默认用户数据
const setDefaultUserData = () => {
  userData.value = {
    id: '1',
    username: '默认用户',
    real_name: '',
    phone: '',
    address: '',
    avatar: DEFAULT_AVATAR
  }
  editedUserData.value = { ...userData.value }
}

// 保存用户资料
const handleSave = async () => {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const response = await userApi.updateProfile(editedUserData.value)
    // 后端返回的是 { message: '更新成功', user: userInfo } 格式
    if (response.user) {
      userData.value = {
        ...userData.value,
        ...response.user,
        avatar: normalizeAvatar(response.user.avatar),
        gameStats: userData.value.gameStats
      }
    }
    isEditing.value = false
    ElMessage.success('个人资料更新成功！')
  } catch (error) {
    errorMessage.value = error.message || '更新个人资料失败'
    console.error('更新个人资料失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 取消编辑
const handleCancel = () => {
  editedUserData.value = { ...userData.value }
  isEditing.value = false
}

const handleBindPubg = async () => {
  pubgLoading.value = true
  try {
    const response = await userApi.bindPubgAccount(pubgBindingForm.value)
    userData.value.pubgBinding = {
      ...userData.value.pubgBinding,
      ...response.pubgBinding
    }
    const statsData = await userApi.getStats()
    pubgStats.value = statsData?.pubgStats || null
    animatePubgNumbers(pubgVisual.value)
    await fetchPubgPower()
    await fetchPubgSeasons()
    await fetchPubgMatches()
    isRebinding.value = false
    ElMessage.success('PUBG 账号绑定成功')
  } catch (error) {
    ElMessage.error(error.message || '绑定 PUBG 账号失败')
  } finally {
    pubgLoading.value = false
  }
}

const handleUnbindPubg = async () => {
  pubgLoading.value = true
  try {
    const response = await userApi.unbindPubgAccount()
    userData.value.pubgBinding = response.pubgBinding
    pubgStats.value = null
    pubgPower.value = null
    animatePubgNumbers(null)
    pubgMatches.value = []
    pubgMatchesTotal.value = 0
    seasonOptions.value = []
    seasonFilterNote.value = ''
    pubgBindingForm.value = {
      playerName: '',
      platform: 'steam'
    }
    isRebinding.value = false
    ElMessage.success('PUBG 账号已解绑')
  } catch (error) {
    ElMessage.error(error.message || '解绑 PUBG 账号失败')
  } finally {
    pubgLoading.value = false
  }
}

const startRebind = () => {
  pubgBindingForm.value = {
    playerName: userData.value?.pubgBinding?.playerName || '',
    platform: userData.value?.pubgBinding?.platform || 'steam'
  }
  isRebinding.value = true
}

const handleRefreshPubgStats = async () => {
  isRefreshingStats.value = true
  try {
    await fetchPubgOverview()
    await fetchPubgPower()
    await fetchPubgSeasons()
    await fetchPubgMatches()
    ElMessage.success('战绩同步完成')
  } catch (error) {
    ElMessage.error(error.message || '同步战绩失败')
  } finally {
    isRefreshingStats.value = false
  }
}

const fetchPubgOverview = async () => {
  if (!isPubgBound.value) {
    pubgStats.value = null
    animatePubgNumbers(null)
    return
  }
  const overview = await userApi.getPubgOverview()
  pubgStats.value = overview || null
  animatePubgNumbers(pubgVisual.value)
}
const fetchPubgPower = async () => {
  if (!isPubgBound.value) {
    pubgPower.value = null
    return
  }
  pubgPowerLoading.value = true
  try {
    const data = await userApi.getPubgPower()
    pubgPower.value = data || null
  } finally {
    pubgPowerLoading.value = false
  }
}
const handleOverviewTypeChange = (type) => {
  overviewType.value = type
  animatePubgNumbers(pubgVisual.value)
}

const fetchPubgMatches = async () => {
  if (!isPubgBound.value) {
    pubgMatches.value = []
    pubgMatchesTotal.value = 0
    return
  }
  matchesLoading.value = true
  try {
    const data = await userApi.getPubgMatches(matchQuery.value)
    pubgMatches.value = data?.list || []
    pubgMatchesTotal.value = Number(data?.total || 0)
    seasonFilterNote.value = data?.seasonFilterNote || ''
  } finally {
    matchesLoading.value = false
  }
}

const fetchPubgSeasons = async () => {
  if (!isPubgBound.value) {
    seasonOptions.value = []
    return
  }
  const data = await userApi.getPubgSeasons()
  const raw = (data?.seasons || []).map((item) => ({
    value: item.id,
    label: formatSeasonLabel(item.id, item.isCurrentSeason)
  }))

  const labelCount = raw.reduce((acc, cur) => {
    acc[cur.label] = (acc[cur.label] || 0) + 1
    return acc
  }, {})

  seasonOptions.value = raw.map((item) => {
    if (labelCount[item.label] <= 1) return item
    return {
      ...item,
      label: `${item.label}（${item.value}）`
    }
  })
}

const applyMatchFilter = async () => {
  matchQuery.value.page = 1
  matchQuery.value.season = ''
  await fetchPubgMatches()
}

const handleMatchPageChange = async (page) => {
  matchQuery.value.page = page
  await fetchPubgMatches()
}

const handleViewMatchDetail = async (row) => {
  if (!row?.matchId) return
  if (matchDetailMap.value[row.matchId]) return
  expandedRowLoadingMap.value = {
    ...expandedRowLoadingMap.value,
    [row.matchId]: true
  }
  matchDetailLoading.value = true
  try {
    const detail = await userApi.getPubgMatchDetail(row.matchId)
    matchDetailMap.value = {
      ...matchDetailMap.value,
      [row.matchId]: detail
    }
  } catch (error) {
    ElMessage.error(error.message || '获取比赛详情失败')
  } finally {
    expandedRowLoadingMap.value = {
      ...expandedRowLoadingMap.value,
      [row.matchId]: false
    }
    matchDetailLoading.value = false
  }
}

const handleExpandChange = async (row, expandedRows) => {
  const isExpanded = expandedRows.some((item) => item.matchId === row.matchId)
  expandedMatchRowKeys.value = isExpanded ? [row.matchId] : []
  if (!isExpanded) return
  await handleViewMatchDetail(row)
}

const avatarUploadRef = ref(null)

const processAvatarFile = async (file) => {
  if (!file) return
  try {
    const reader = new FileReader()
    reader.onload = (e) => {
      userData.value.avatar = e.target.result
      editedUserData.value.avatar = e.target.result
    }
    reader.readAsDataURL(file)
    ElMessage.success('头像更新成功')
  } catch (error) {
    console.error('上传头像失败:', error)
    ElMessage.error('上传头像失败，请重试')
  }
}

const onAvatarFileChange = (uploadFile) => {
  const raw = uploadFile?.raw
  if (raw) processAvatarFile(raw)
  avatarUploadRef.value?.clearFiles()
}
// 生命周期钩子
onMounted(async () => {
  await fetchUserData()
})
</script>

<template>
  <div class="profile-container">
    <div class="container">
      <!-- 加载状态 -->
      <div v-if="isLoading" class="profile-layout skeleton-layout">
        <div class="left-sidebar">
          <el-card shadow="hover" class="profile-info-card skeleton-card">
            <div class="profile-skeleton-info">
              <el-skeleton animated>
                <template #template>
                  <div class="skeleton-avatar-wrap">
                    <el-skeleton-item variant="circle" class="skeleton-avatar" />
                  </div>
                  <el-skeleton-item variant="h3" class="skeleton-line skeleton-line-title" />
                  <el-skeleton-item variant="text" class="skeleton-line" />
                  <el-skeleton-item variant="text" class="skeleton-line" />
                  <el-skeleton-item variant="text" class="skeleton-line skeleton-line-short" />
                  <el-skeleton-item variant="button" class="skeleton-btn" />
                </template>
              </el-skeleton>
            </div>
          </el-card>

          <el-card shadow="hover" class="module-card skeleton-card">
            <el-skeleton animated>
              <template #template>
                <el-skeleton-item variant="h3" class="skeleton-section-title" />
                <el-skeleton-item variant="text" class="skeleton-line" />
              </template>
            </el-skeleton>
          </el-card>
        </div>

        <div class="right-content">
          <el-card shadow="hover" class="hero-stat-card skeleton-card">
            <el-skeleton animated>
              <template #template>
                <el-skeleton-item variant="h3" class="skeleton-hero-title" />
                <el-skeleton-item variant="text" class="skeleton-line skeleton-line-long" />
                <div class="skeleton-kpi-grid">
                  <el-skeleton-item v-for="item in 6" :key="item" variant="rect" class="skeleton-kpi-card" />
                </div>
                <el-skeleton-item variant="h3" class="skeleton-section-title" />
                <el-skeleton-item variant="rect" class="skeleton-table" />
              </template>
            </el-skeleton>
          </el-card>
        </div>
      </div>
      
      <!-- 错误提示 -->
      <div v-else-if="errorMessage" class="error-container">
        <el-alert
          :title="errorMessage"
          type="error"
          show-icon
          :closable="false"
        />
      </div>
      
      <!-- 左右布局内容 -->
      <div v-else-if="userData" class="profile-layout">
        <!-- 左侧栏 - 个人信息 -->
        <div class="left-sidebar">
          <!-- 个人信息区域 -->
          <div class="profile-section profile-info-section">
            <el-card shadow="hover" class="profile-info-card">
              <div class="profile-info">
                <el-upload
                  ref="avatarUploadRef"
                  class="avatar-upload-trigger"
                  :show-file-list="false"
                  :auto-upload="false"
                  accept="image/*"
                  :limit="1"
                  :on-change="onAvatarFileChange"
                >
                  <template #trigger>
                    <div class="avatar">
                      <el-avatar :src="userData.avatar" size="large"></el-avatar>
                      <div class="avatar-edit">
                        <span>更换头像</span>
                      </div>
                    </div>
                  </template>
                </el-upload>
                
                <div class="user-details" v-if="!isEditing">
                  <h2>{{ userData.username }}</h2>
                  <p class="user-real-name" v-if="userData.real_name">姓名: {{ userData.real_name }}</p>
                  <p class="user-account">账号: {{ userData.account }}</p>
                  <p class="user-phone" v-if="userData.phone">电话: {{ userData.phone }}</p>
                  <p class="user-address" v-if="userData.address">地址: {{ userData.address }}</p>
                  <div class="user-actions">
                    <el-button type="primary" @click="isEditing = true">编辑资料</el-button>
                  </div>
                </div>
                
                <div class="user-edit" v-else>
                  <el-form @submit.prevent="handleSave" label-position="top">
                    <el-form-item label="账号">
                      <el-input v-model="editedUserData.account" disabled />
                    </el-form-item>
                    <el-form-item label="昵称" required>
                      <el-input v-model="editedUserData.username" required />
                    </el-form-item>
                    <el-form-item label="姓名">
                      <el-input v-model="editedUserData.real_name" placeholder="真实姓名" />
                    </el-form-item>
                    <el-form-item label="电话">
                      <el-input v-model="editedUserData.phone" placeholder="仅用于发放奖励" />
                    </el-form-item>
                    <el-form-item label="地址">
                      <el-input v-model="editedUserData.address" placeholder="仅用于发放奖励" />
                    </el-form-item>
                    <el-form-item>
                      <el-button @click="handleCancel" type="default">取消</el-button>
                      <el-button type="primary" native-type="submit">保存</el-button>
                    </el-form-item>
                  </el-form>
                </div>
              </div>
            </el-card>
          </div>

        </div>

        <div class="right-content">
          <el-card shadow="hover" class="hero-stat-card">
            <div class="hero-bg-glow"></div>
            <div class="hero-header">
              <div>
                <h2 class="hero-title">PUBG 战绩总览</h2>
                <p class="hero-subtitle">更直观地追踪你的赛季表现</p>
              </div>
              <div class="hero-badge" v-if="isPubgBound">
                {{ userData.pubgBinding.playerName }} · {{ userData.pubgBinding.platform.toUpperCase() }}
              </div>
            </div>

            <div v-if="!isPubgBound" class="hero-bind-panel">
              <p class="hero-empty-text">当前未绑定游戏数据，绑定后可在此查看实时战绩看板。</p>
              <el-form class="hero-bind-form" label-position="top" @submit.prevent="handleBindPubg">
                <el-form-item label="平台">
                  <el-select v-model="pubgBindingForm.platform" style="width: 100%">
                    <el-option label="Steam" value="steam" />
                    <el-option label="Kakao" value="kakao" />
                    <el-option label="Xbox" value="xbox" />
                    <el-option label="PlayStation" value="psn" />
                  </el-select>
                </el-form-item>
                <el-form-item label="玩家昵称">
                  <el-input v-model="pubgBindingForm.playerName" placeholder="请输入游戏内昵称" />
                </el-form-item>
                <el-button type="primary" :loading="pubgLoading" @click="handleBindPubg">绑定并同步战绩</el-button>
              </el-form>
            </div>

            <div v-else class="hero-content hero-content-a">
              <section class="panel-section card-like-panel">
                <div class="panel-title">账号绑定区</div>
                <div class="panel-bind-info">
                  <div class="bind-meta">
                    <p>已绑定账号：{{ userData.pubgBinding.playerName }}</p>
                    <p>平台：{{ userData.pubgBinding.platform.toUpperCase() }}</p>
                  </div>
                  <div class="hero-actions">
                    <el-button plain :loading="isRefreshingStats" @click="handleRefreshPubgStats">同步战绩</el-button>
                    <el-button type="warning" plain @click="startRebind">换绑</el-button>
                    <el-button type="danger" plain :loading="pubgLoading" @click="handleUnbindPubg">解绑</el-button>
                  </div>
                </div>
                <div v-if="isRebinding" class="hero-rebind">
                  <el-form label-position="top" @submit.prevent="handleBindPubg">
                    <el-form-item label="新平台">
                      <el-select v-model="pubgBindingForm.platform" style="width: 100%">
                        <el-option label="Steam" value="steam" />
                        <el-option label="Kakao" value="kakao" />
                        <el-option label="Xbox" value="xbox" />
                        <el-option label="PlayStation" value="psn" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="新玩家昵称">
                      <el-input v-model="pubgBindingForm.playerName" placeholder="请输入新的游戏内昵称" />
                    </el-form-item>
                    <div class="hero-actions">
                      <el-button type="warning" :loading="pubgLoading" @click="handleBindPubg">确认换绑</el-button>
                      <el-button @click="isRebinding = false">取消</el-button>
                    </div>
                  </el-form>
                </div>
              </section>

              <section class="panel-section card-like-panel">
                <div class="panel-title">星火战力值</div>
                <div class="power-card" :class="`power-${pubgPowerTone}`" v-loading="pubgPowerLoading">
                  <div class="power-main">
                    <div>
                      <div class="power-subtitle">最近 {{ pubgPower?.requestedMatches || 200 }} 场竞技模式综合评分</div>
                    </div>
                    <div class="power-score">{{ pubgPower?.score ?? '--' }}</div>
                  </div>
                  <div class="power-meta" v-if="pubgPower">
                    <span>评级：{{ pubgPower.level || '暂无评级' }}</span>
                    <span>KD：{{ pubgPower.kd }}</span>
                    <span>场均伤害：{{ pubgPower.avgDamage }}</span>
                    <span>平均排名：{{ pubgPower.avgRank }}</span>
                    <span>样本：{{ pubgPower.matchesAnalyzed }} 场</span>
                  </div>
                  <div class="power-formula-hint" v-if="pubgPower">
                    <div class="power-formula-title">计算说明</div>
                    <div class="power-formula-line">战力值 = round((KD因子 × 0.45 + 伤害因子 × 0.30 + 排名因子 × 0.25) × 1000)</div>
                    <ul class="power-formula-list">
                      <li>KD因子 = min(KD, 5) / 5</li>
                      <li>伤害因子 = min(场均伤害, 600) / 600</li>
                      <li>排名因子 = clamp((101 - 平均排名) / 100, 0, 1)</li>
                    </ul>
                    <div class="power-level-map">
                      <span>评级区间：</span>
                      <span>魔王S(≥920)</span>
                      <span>S(≥780)</span>
                      <span>A(≥620)</span>
                      <span>B(≥520)</span>
                      <span>C(≥430)</span>
                      <span>D(≥350)</span>
                      <span>E(&lt;350)</span>
                    </div>
                  </div>
                </div>
              </section>

              <section class="panel-section card-like-panel">
                <div class="panel-title">统计总览区</div>
                <div class="overview-toggle">
                  <el-button :type="overviewType === 'normal' ? 'primary' : 'default'" plain @click="handleOverviewTypeChange('normal')">
                    匹配总览
                  </el-button>
                  <el-button :type="overviewType === 'ranked' ? 'primary' : 'default'" plain @click="handleOverviewTypeChange('ranked')">
                    竞技总览
                  </el-button>
                </div>
                <div class="panel-hint">KD 计算规则：KD = 总击杀 / 总失败场次（losses）。当 losses 为 0 时，按总击杀显示。</div>
                <div v-if="pubgDisplay" class="kpi-row">
                  <div class="kpi-card"><div class="kpi-label">总场次</div><div class="kpi-value">{{ pubgDisplay.roundsPlayed }}</div></div>
                  <div class="kpi-card"><div class="kpi-label">胜场</div><div class="kpi-value">{{ pubgDisplay.wins }}</div></div>
                  <div class="kpi-card"><div class="kpi-label">吃鸡率</div><div class="kpi-value">{{ pubgDisplay.winRate }}%</div></div>
                  <div class="kpi-card"><div class="kpi-label">总击杀</div><div class="kpi-value">{{ pubgDisplay.kills }}</div></div>
                  <div class="kpi-card"><div class="kpi-label">KD</div><div class="kpi-value">{{ pubgDisplay.kdRatio }}</div></div>
                  <div class="kpi-card"><div class="kpi-label">场均击杀</div><div class="kpi-value">{{ pubgDisplay.killsPerMatch }}</div></div>
                </div>
                <div v-else class="hero-empty">暂无统计数据，点击“同步战绩”获取最新数据。</div>
              </section>

              <section class="panel-section card-like-panel">
                <div class="panel-title">游戏对局详情</div>
                <div class="hero-filters">
                  <el-select v-model="matchQuery.mode" clearable placeholder="模式" style="width: 130px">
                    <el-option label="Solo" value="solo" />
                    <el-option label="Duo" value="duo" />
                    <el-option label="Squad" value="squad" />
                    <el-option label="自定义" value="custom" />
                  </el-select>
                  <el-select v-model="matchQuery.season" clearable disabled placeholder="赛季筛选暂不可用" style="width: 280px">
                    <el-option
                      v-for="item in seasonOptions"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </el-select>
                  <el-button type="primary" @click="applyMatchFilter">应用筛选</el-button>
                </div>
                <div v-if="seasonFilterNote" class="panel-hint">{{ seasonFilterNote }}</div>

              <el-table
                :data="pubgMatches"
                v-loading="matchesLoading"
                stripe
                class="match-table"
                row-key="matchId"
                :expand-row-keys="expandedMatchRowKeys"
                @expand-change="handleExpandChange"
              >
                <el-table-column type="expand">
                  <template #default="{ row }">
                    <div class="row-expand-panel" v-loading="expandedRowLoadingMap[row.matchId]">
                      <template v-if="matchDetailMap[row.matchId]">
                        <div class="team-members" v-if="Array.isArray(matchDetailMap[row.matchId].teamMembers) && matchDetailMap[row.matchId].teamMembers.length">
                          <el-table :data="matchDetailMap[row.matchId].teamMembers" size="small" class="team-table">
                            <el-table-column label="成员" min-width="160">
                              <template #default="{ row: member }">
                                <span :class="{ 'self-tag': member.isSelf }">{{ member.name }}{{ member.isSelf ? '（我）' : '' }}</span>
                              </template>
                            </el-table-column>
                            <el-table-column prop="kills" label="击杀" width="80" />
                            <el-table-column prop="assists" label="助攻" width="80" />
                            <el-table-column prop="damageDealt" label="伤害" width="100" />
                            <el-table-column prop="rank" label="排名" width="80" />
                          </el-table>
                        </div>
                      </template>
                      <template v-else>
                        <p class="detail-placeholder">正在加载比赛详情...</p>
                      </template>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="比赛时间" min-width="180">
                  <template #default="{ row }">
                    {{ formatDateTime(row.createdAt) }}
                  </template>
                </el-table-column>
                <el-table-column label="模式" width="110">
                  <template #default="{ row }">
                    {{ formatModeName(row.gameMode) }}
                  </template>
                </el-table-column>
                <el-table-column label="类型" width="100">
                  <template #default="{ row }">
                    {{ formatMatchType(row) }}
                  </template>
                </el-table-column>
                <el-table-column label="地图" min-width="120">
                  <template #default="{ row }">
                    {{ formatMapName(row.mapName) }}
                  </template>
                </el-table-column>
                <el-table-column prop="rank" label="排名" width="80" />
                <el-table-column prop="kills" label="击杀" width="80" />
                <el-table-column prop="damageDealt" label="伤害" width="110" />
              </el-table>

              <div class="table-footer">
                <el-pagination
                  background
                  layout="prev, pager, next, total"
                  :current-page="matchQuery.page"
                  :page-size="matchQuery.pageSize"
                  :total="pubgMatchesTotal"
                  @current-change="handleMatchPageChange"
                />
              </div>
              </section>
            </div>
          </el-card>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 苹果风格极简设计 */
.profile-container {
  padding: 0 0 3rem;
  min-height: 100vh;
  background-color: transparent;
  position: relative;
}

.profile-container h2 {
  text-align: center;
  margin-bottom: 2.5rem;
  font-size: 2rem;
  font-weight: 600;
  color: #1d1d1f;
  letter-spacing: -0.01em;
}

/* 左右布局 */
.profile-layout {
  display: flex;
  gap: 2rem;
  align-items: flex-start;
}

/* 左侧栏 */
.left-sidebar {
  width: 350px;
  flex-shrink: 0;
}

.right-content {
  flex: 1;
  min-width: 0;
}

.profile-section {
  margin-bottom: 2rem;
  padding: 0;
  background-color: transparent;
  border-radius: 0;
}

.profile-section h3 {
  margin-bottom: 1.25rem;
  font-size: 1.25rem;
  font-weight: 500;
  color: #1d1d1f;
  letter-spacing: 0.01em;
}

.profile-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 1.5rem;
  background-color: #ffffff;
  border-radius: 12px;
}



.avatar {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.3s ease;
  border-radius: 50%;
  border: 2px solid #f0f0f0;
}

.avatar:hover {
  transform: scale(1.03);
  border-color: #0071e3;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-edit {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.5);
  color: #ffffff;
  padding: 0.5rem 1rem;
  text-align: center;
  font-size: 0.75rem;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.3s ease;
  white-space: nowrap;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 50%;
}

.avatar:hover .avatar-edit {
  opacity: 1;
}

.user-details {
  text-align: center;
  width: 100%;
}

.user-details h2 {
  margin: 0 0 0.25rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #1d1d1f;
  letter-spacing: -0.01em;
}

.user-account {
  margin: 0 0 0.25rem 0;
  font-size: 0.875rem;
  color: #86868b;
  letter-spacing: 0.01em;
}

.user-real-name,
.user-phone,
.user-address {
  margin: 0 0 0.25rem 0;
  font-size: 0.875rem;
  color: #86868b;
  letter-spacing: 0.01em;
}

.user-actions {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  align-items: center;
}

.user-edit {
  width: 100%;
  max-width: 300px;
  text-align: center;
}

/* 响应式布局 */
@media (max-width: 768px) {
  .profile-layout {
    flex-direction: column;
  }
  
  .left-sidebar {
    width: 100%;
  }
  
  .profile-info {
    flex-direction: column;
    text-align: center;
    gap: 1rem;
    padding: 1.25rem;
  }
  
  .avatar {
    width: 70px;
    height: 70px;
  }
  
  .avatar-edit {
    bottom: -20px;
  }
  
  .avatar:hover .avatar-edit {
    bottom: -25px;
  }
  
  .user-details h2 {
    font-size: 1.125rem;
  }
  
  .user-actions {
    justify-content: center;
  }
}

/* 深色模式优化 */
.dark-mode .profile-info {
  background-color: #1a1a1a;
}



.dark-mode .avatar {
  border-color: rgba(255, 255, 255, 0.1);
}

.dark-mode .avatar:hover {
  border-color: #0071e3;
}

.dark-mode .user-details h2 {
  color: #ffffff;
}

.dark-mode .user-account {
  color: #e0e0e0;
}

.dark-mode .user-real-name,
.dark-mode .user-phone,
.dark-mode .user-address {
  color: #e0e0e0;
}


/* 个人信息区域 */
.profile-info-section {
  margin-bottom: 3rem;
}

/* 模块卡片样式 */
.module-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #f0f0f0;
}

.card-header h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 500;
  color: #1d1d1f;
  letter-spacing: 0.01em;
}

/* 深色模式卡片样式 */
.dark-mode .card-header {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

.dark-mode .card-header h3 {
  color: #ffffff;
}

.pubg-binding-panel {
  padding: 1rem;
}

.pubg-status,
.pubg-stats {
  margin-top: 0.75rem;
  font-size: 0.875rem;
  color: #606266;
}

.pubg-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.pubg-metric {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 0.5rem;
  text-align: center;
}

.metric-label {
  display: block;
  color: #909399;
  font-size: 0.75rem;
}

.metric-value {
  display: block;
  color: #303133;
  font-size: 1rem;
  font-weight: 600;
}

.pubg-ring-wrap {
  margin: 0.75rem 0;
  display: flex;
  justify-content: center;
}

.ring-text {
  text-align: center;
}

.ring-value {
  font-size: 1rem;
  font-weight: 700;
  color: #303133;
}

.ring-label {
  font-size: 0.75rem;
  color: #909399;
}

.pubg-bars {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.bar-title {
  font-size: 0.8125rem;
  color: #606266;
  margin-bottom: 0.25rem;
}

.bar-caption {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: #909399;
}

.pubg-stats-empty {
  margin-top: 0.75rem;
  font-size: 0.8125rem;
  color: #909399;
}

.avatar-upload-trigger {
  display: inline-block;
}

.avatar-upload-trigger :deep(.el-upload) {
  display: block;
}

/* 深色模式 - 苹果风格 */
.dark-mode .profile-container {
  background-color: #121212;
  color: #ffffff;
}

.dark-mode .profile-container h2 {
  color: #ffffff;
}

.dark-mode .profile-section {
  background-color: transparent;
}

.dark-mode .profile-section h3 {
  color: #ffffff;
}

.dark-mode .profile-info {
  background-color: #1a1a1a;
}

.dark-mode .profile-info:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.dark-mode .user-details h2 {
  color: #ffffff;
}


.dark-mode .el-card {
  background-color: #1a1a1a;
  border: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.dark-mode .el-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}


.dark-mode .reply-card {
  background-color: #1a1a1a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.dark-mode .reply-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.dark-mode .user-name {
  color: #ffffff;
}

.dark-mode .reply-time {
  color: #e0e0e0;
}

.dark-mode .post-preview {
  color: #e0e0e0;
}

.dark-mode .reply-text {
  color: #ffffff;
}

.dark-mode .empty-state {
  background-color: #1a1a1a;
  color: #e0e0e0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.dark-mode .el-empty {
  --el-empty-color: #e0e0e0;
}

.dark-mode .el-input__wrapper {
  background-color: #1a1a1a;
  border-color: rgba(255, 255, 255, 0.1);
}

.dark-mode .el-input__inner {
  color: #ffffff;
}

.dark-mode .el-button {
  background-color: #0071e3;
  color: #ffffff;
}

.dark-mode .el-button:hover {
  background-color: #0077ed;
}

.dark-mode .el-button--default {
  background-color: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.dark-mode .el-button--default:hover {
  background-color: rgba(255, 255, 255, 0.15);
  color: #ffffff;
}

/* 响应式设计 - 苹果风格 */
@media (max-width: 768px) {
  .profile-container {
    padding: 0 0 2rem;
  }
  
  .profile-container h2 {
    font-size: 1.75rem;
  }
  
  .profile-info {
    flex-direction: column;
    text-align: center;
    gap: 1.5rem;
    padding: 1.75rem;
  }
  
  .avatar {
    width: 90px;
    height: 90px;
  }
  
  .user-details h2 {
    font-size: 1.375rem;
  }
  
  .reply-card {
    padding: 1.25rem;
  }
  
  .post-stats {
    gap: 1rem;
  }
  
  .el-button--small {
    padding: 0.4375rem 0.875rem;
    font-size: 0.75rem;
  }
  
}

@media (max-width: 480px) {
  .profile-container {
    padding: 0 0 1.5rem;
  }
  
  .profile-container h2 {
    font-size: 1.5rem;
  }
  
  .profile-info {
    padding: 1.5rem;
  }
  
  .avatar {
    width: 80px;
    height: 80px;
  }
  
  .user-details h2 {
    font-size: 1.25rem;
  }
  
  .reply-card {
    padding: 1.125rem;
  }
}

.hero-stat-card {
  position: relative;
  overflow: hidden;
  border-radius: 16px;
}

.hero-bg-glow {
  position: absolute;
  right: -60px;
  top: -60px;
  width: 220px;
  height: 220px;
  background: radial-gradient(circle, rgba(64, 158, 255, 0.26), transparent 65%);
  pointer-events: none;
}

.hero-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.hero-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: #1f2d3d;
}

.hero-subtitle {
  margin: 0.25rem 0 0;
  color: #909399;
  font-size: 0.875rem;
}

.hero-bind-panel {
  background: #f7f9fc;
  border-radius: 14px;
  padding: 1rem;
}

.hero-bind-form {
  max-width: 420px;
}

.hero-empty-text {
  margin: 0 0 1rem 0;
  color: #606266;
}

.hero-badge {
  background: linear-gradient(135deg, #409eff, #6d5dfc);
  color: #fff;
  border-radius: 999px;
  padding: 0.4rem 0.85rem;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.hero-content {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 1rem;
  align-items: start;
}

.hero-content-a {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  align-items: stretch;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  width: 100%;
  box-sizing: border-box;
}

.panel-title {
  font-size: 1rem;
  font-weight: 700;
  color: #1f2d3d;
}

.panel-hint {
  margin-top: -0.2rem;
  font-size: 0.78rem;
  color: #8a97ab;
}

.overview-toggle {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.power-card {
  border-radius: 12px;
  padding: 0.85rem 1rem;
  border: 1px solid #e6ecf7;
  background: linear-gradient(120deg, #f8fbff, #eef5ff);
}

.power-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.power-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #1f2d3d;
}

.power-subtitle {
  margin-top: 0.2rem;
  font-size: 0.75rem;
  color: #8a97ab;
}

.power-score {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: 700;
  line-height: 1;
  min-height: 2.5rem;
}

.power-meta {
  margin-top: 0.5rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.78rem;
  color: #607086;
}

.power-formula-hint {
  margin-top: 0.6rem;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px dashed #d8e1f2;
  font-size: 0.75rem;
  line-height: 1.5;
  color: #5f6c80;
}

.power-formula-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: #334155;
}

.power-formula-line {
  margin-top: 0.3rem;
  color: #3f4d63;
}

.power-formula-list {
  margin: 0.35rem 0 0;
  padding-left: 1rem;
  color: #4c5b72;
}

.power-formula-list li + li {
  margin-top: 0.15rem;
}

.power-level-map {
  margin-top: 0.35rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  color: #53627a;
}

.power-legend .power-score {
  color: #7a4b00;
}

.power-high .power-score {
  color: #2458ff;
}

.power-mid .power-score {
  color: #6b4ee6;
}

.power-base .power-score {
  color: #2e7d32;
}

.power-low .power-score {
  color: #6b7280;
}

.panel-bind-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.bind-meta p {
  margin: 0.1rem 0;
  color: #606266;
  font-size: 0.875rem;
}

.hero-left {
  background: #f7f9fc;
  border-radius: 14px;
  padding: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-right {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.hero-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.hero-filters {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}

.hero-rebind {
  margin-bottom: 0.25rem;
  background: #fff;
  border-radius: 10px;
  padding: 0.8rem;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.8rem;
}

.kpi-card {
  background: linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
  border-radius: 12px;
  padding: 0.85rem 1rem;
  border: 1px solid #e4ecf7;
}

.kpi-label {
  color: #909399;
  font-size: 0.8125rem;
}

.kpi-value {
  margin-top: 0.2rem;
  color: #303133;
  font-size: 1.4rem;
  font-weight: 700;
}

.match-table {
  width: 100%;
}

.match-table :deep(.el-table__expanded-cell) {
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  transition: padding 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

.match-table :deep(.el-table__expanded-cell .cell) {
  padding: 0 !important;
}

.table-footer {
  display: flex;
  justify-content: flex-end;
}

.match-detail {
  font-size: 0.9rem;
  line-height: 1.8;
}

.row-expand-panel {
  background: #f7f9fc;
  border-radius: 10px;
  padding: 0.8rem 1rem;
  animation: expand-panel-in 320ms cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: top center;
  transition: opacity 280ms ease, transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform, opacity;
}

.detail-placeholder {
  margin: 0;
  font-size: 0.875rem;
  color: #909399;
}

.team-members {
  margin-top: 0.65rem;
}

.team-title {
  font-size: 0.82rem;
  color: #606266;
  margin-bottom: 0.35rem;
}

.team-table {
  background: #fff;
  border-radius: 8px;
}

@keyframes expand-panel-in {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.self-tag {
  font-weight: 600;
  color: #1f78ff;
}

.match-table :deep(.el-table__expand-icon:hover) {
  background-color: transparent !important;
}

.match-table :deep(.el-table__expand-icon:focus) {
  background-color: transparent !important;
  box-shadow: none !important;
}

.hero-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.big-metric-card {
  border-radius: 14px;
  padding: 0.9rem 1rem;
  color: #fff;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.12);
}

.big-metric-label {
  font-size: 0.8125rem;
  opacity: 0.92;
}

.big-metric-value {
  margin-top: 0.25rem;
  font-size: 1.55rem;
  font-weight: 700;
}

.gradient-blue {
  background: linear-gradient(135deg, #36a2ff, #1f78ff);
}

.gradient-orange {
  background: linear-gradient(135deg, #ffb347, #ff8f1f);
}

.gradient-green {
  background: linear-gradient(135deg, #40d39a, #1eb980);
}

.gradient-purple {
  background: linear-gradient(135deg, #8a7dff, #6d5dfc);
}

.card-like-panel {
  background: #f7f9fc;
  border-radius: 14px;
  padding: 0.9rem;
}

.skeleton-layout {
  width: 100%;
}

.skeleton-card {
  border-radius: 14px;
}

.profile-skeleton-info {
  padding: 0.5rem 0.2rem;
}

.skeleton-avatar-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 0.9rem;
}

.skeleton-avatar {
  width: 80px;
  height: 80px;
}

.skeleton-line {
  width: 100%;
  margin-bottom: 0.65rem;
}

.skeleton-line-title {
  width: 60%;
  margin: 0 auto 0.8rem;
}

.skeleton-line-short {
  width: 72%;
}

.skeleton-line-long {
  width: 45%;
  margin-bottom: 1rem;
}

.skeleton-btn {
  width: 120px;
  margin-top: 0.6rem;
}

.skeleton-hero-title {
  width: 240px;
  margin-bottom: 0.8rem;
}

.skeleton-section-title {
  width: 140px;
  margin-bottom: 0.8rem;
}

.skeleton-kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.8rem;
  margin: 0.8rem 0 1.2rem;
}

.skeleton-kpi-card {
  width: 100%;
  height: 88px;
  border-radius: 12px;
}

.skeleton-table {
  width: 100%;
  height: 260px;
  border-radius: 12px;
}

.hero-empty {
  border-radius: 12px;
  padding: 0.9rem;
  background: #fff;
  color: #909399;
}

.ring-text-large .ring-value {
  font-size: 1.2rem;
}

@media (max-width: 1024px) {
  .hero-content {
    grid-template-columns: 1fr;
  }

  .kpi-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .hero-left {
    min-height: 260px;
  }

  .hero-grid {
    grid-template-columns: 1fr;
  }

  .kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

</style>