<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { userApi } from '../../services/api'
import { DEFAULT_AVATAR, normalizeAvatar, avatarDisplayUrl } from '../../utils/avatar'
import { useAuthStore } from '../../stores/auth'

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
const cupHistory = ref(null)
const cupHistoryLoading = ref(false)
const expandedMobileMatchId = ref(null)
const showPowerFormula = ref(false)
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

const formatMatchDateShort = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

const formatDamage = (value) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return '--'
  return num.toFixed(1)
}

const toggleMobileMatch = async (row) => {
  if (!row?.matchId) return
  if (expandedMobileMatchId.value === row.matchId) {
    expandedMobileMatchId.value = null
    return
  }
  expandedMobileMatchId.value = row.matchId
  await handleViewMatchDetail(row)
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

const formatCupDate = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

const fetchCupHistory = async () => {
  cupHistoryLoading.value = true
  try {
    cupHistory.value = await userApi.getCupHistory()
  } catch (error) {
    console.warn('获取杯赛战绩失败:', error)
    cupHistory.value = {
      summary: { seasonsPlayed: 0, championships: 0, bestRank: null, totalKills: 0 },
      seasons: [],
    }
  } finally {
    cupHistoryLoading.value = false
  }
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
      editedUserData.value = { ...userData.value }
      const auth = useAuthStore()
      auth.syncAvatarFromServer(userData.value.avatar)
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
    const statsData = await userApi.getStats().catch((err) => {
      console.warn('绑定后拉取统计失败:', err)
      return null
    })
    pubgStats.value = statsData?.pubgStats || null
    animatePubgNumbers(pubgVisual.value)
    await Promise.allSettled([
      fetchPubgPower(),
      fetchPubgSeasons(),
      fetchPubgMatches()
    ])
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
const avatarUploading = ref(false)

const uploadAvatarFile = async (file) => {
  if (!file) return
  avatarUploading.value = true
  try {
    const response = await userApi.uploadAvatar(file)
    if (response.user) {
      const next = normalizeAvatar(response.user.avatar)
      userData.value = {
        ...userData.value,
        ...response.user,
        avatar: next,
        gameStats: userData.value.gameStats
      }
      editedUserData.value = { ...userData.value }
      const auth = useAuthStore()
      auth.syncAvatarFromServer(next)
    }
    ElMessage.success(response.message || '头像已保存')
  } catch (error) {
    console.error('上传头像失败:', error)
    ElMessage.error(error.message || '上传头像失败，请重试')
  } finally {
    avatarUploading.value = false
  }
}

const onAvatarFileChange = (uploadFile) => {
  const raw = uploadFile?.raw
  if (raw) uploadAvatarFile(raw)
  avatarUploadRef.value?.clearFiles()
}
// 生命周期钩子
onMounted(async () => {
  await fetchUserData()
  fetchCupHistory()
})
</script>

<template>
  <div class="profile-container">
    <div class="container">
      <!-- 加载状态 -->
      <div v-if="isLoading" class="profile-layout skeleton-layout">
          <el-card shadow="hover" class="profile-info-card skeleton-card profile-info-section">
            <div class="profile-info profile-info-skeleton">
              <div class="profile-info-avatar">
                <el-skeleton animated>
                  <template #template>
                    <el-skeleton-item variant="circle" class="skeleton-avatar" />
                  </template>
                </el-skeleton>
              </div>
              <div class="profile-info-content">
                <el-skeleton animated>
                  <template #template>
                    <el-skeleton-item variant="h3" class="skeleton-line skeleton-line-title skeleton-line-left" />
                    <el-skeleton-item variant="text" class="skeleton-line skeleton-line-left" />
                    <el-skeleton-item variant="text" class="skeleton-line skeleton-line-left" />
                    <el-skeleton-item variant="text" class="skeleton-line skeleton-line-short skeleton-line-left" />
                    <el-skeleton-item variant="button" class="skeleton-btn skeleton-btn-left" />
                  </template>
                </el-skeleton>
              </div>
            </div>
          </el-card>

          <div class="pubg-content">
          <el-card shadow="hover" class="pubg-card skeleton-card">
            <el-skeleton animated>
              <template #template>
                <el-skeleton-item variant="h3" class="skeleton-hero-title" />
                <el-skeleton-item variant="text" class="skeleton-line skeleton-line-long" />
                <div class="skeleton-kpi-grid">
                  <el-skeleton-item v-for="item in 6" :key="item" variant="rect" class="skeleton-kpi-card" />
                </div>
              </template>
            </el-skeleton>
          </el-card>
          <el-card shadow="hover" class="pubg-card skeleton-card">
            <el-skeleton animated>
              <template #template>
                <el-skeleton-item variant="h3" class="skeleton-section-title" />
                <el-skeleton-item variant="rect" class="skeleton-table" />
              </template>
            </el-skeleton>
          </el-card>
          </div>

          <el-card shadow="hover" class="module-card skeleton-card cup-history-section">
            <el-skeleton animated>
              <template #template>
                <el-skeleton-item variant="h3" class="skeleton-section-title" />
                <el-skeleton-item variant="text" class="skeleton-line" />
              </template>
            </el-skeleton>
          </el-card>
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
          <el-card shadow="hover" class="profile-info-card profile-info-section">
              <div class="profile-info">
                <div class="profile-info-avatar">
                <el-upload
                  ref="avatarUploadRef"
                  class="avatar-upload-trigger"
                  :show-file-list="false"
                  :auto-upload="false"
                  accept="image/*"
                  :limit="1"
                  :disabled="avatarUploading"
                  :on-change="onAvatarFileChange"
                >
                  <template #trigger>
                    <div class="avatar">
                      <el-avatar :src="avatarDisplayUrl(userData.avatar)" size="large"></el-avatar>
                      <div class="avatar-edit">
                        <span>{{ avatarUploading ? '上传中…' : '更换头像' }}</span>
                      </div>
                    </div>
                  </template>
                </el-upload>
                </div>

                <div class="profile-info-content">
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
              </div>
          </el-card>

          <div class="pubg-content">
          <el-card v-if="!isPubgBound" shadow="hover" class="pubg-card pubg-card-bind">
            <h3 class="pubg-card-title">账号绑定</h3>
            <p class="pubg-card-desc">绑定游戏账号后可查看战力值、统计总览与对局记录。</p>
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
          </el-card>

          <template v-else>
            <el-card shadow="hover" class="pubg-card pubg-card-bind">
              <h3 class="pubg-card-title">账号绑定</h3>
              <div class="panel-bind-info">
                <div class="bind-meta">
                  <p>已绑定账号：{{ userData.pubgBinding.playerName }}</p>
                  <p>平台：{{ userData.pubgBinding.platform.toUpperCase() }}</p>
                </div>
                <div class="hero-actions hero-actions-compact">
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
            </el-card>

            <el-card shadow="hover" class="pubg-card pubg-card-power">
              <h3 class="pubg-card-title">星火战力值</h3>
              <p class="power-subtitle">最近 {{ pubgPower?.requestedMatches || 200 }} 场竞技模式综合评分</p>
              <div class="power-hero" :class="`power-tone-${pubgPowerTone}`" v-loading="pubgPowerLoading">
                <div class="power-hero-score">
                  <span class="power-score-num">{{ pubgPower?.score ?? '--' }}</span>
                  <span class="power-score-label">战力值</span>
                </div>
                <div
                  class="power-hero-level"
                  :class="pubgPower?.level ? `power-level-${pubgPowerTone}` : 'power-level-empty'"
                >
                  <span class="power-hero-level-label">评级</span>
                  <strong class="power-hero-level-value">{{ pubgPower?.level || '暂无' }}</strong>
                </div>
              </div>
              <div class="power-metrics" v-if="pubgPower">
                <div class="power-metric-item"><span class="power-metric-label">KD</span><span class="power-metric-value">{{ pubgPower.kd }}</span></div>
                <div class="power-metric-item"><span class="power-metric-label">场均伤害</span><span class="power-metric-value">{{ pubgPower.avgDamage }}</span></div>
                <div class="power-metric-item"><span class="power-metric-label">平均排名</span><span class="power-metric-value">{{ pubgPower.avgRank }}</span></div>
                <div class="power-metric-item"><span class="power-metric-label">样本场次</span><span class="power-metric-value">{{ pubgPower.matchesAnalyzed }}</span></div>
              </div>
              <button
                v-if="pubgPower"
                type="button"
                class="power-formula-toggle"
                @click="showPowerFormula = !showPowerFormula"
              >
                {{ showPowerFormula ? '收起计算说明' : '查看计算说明' }}
              </button>
              <div class="power-formula-hint" v-if="pubgPower && showPowerFormula">
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
            </el-card>

            <el-card shadow="hover" class="pubg-card pubg-card-stats">
              <div class="stats-card-head">
                <h3 class="pubg-card-title">统计总览</h3>
                <div class="overview-toggle stats-type-toggle">
                  <el-button :type="overviewType === 'normal' ? 'primary' : 'default'" plain @click="handleOverviewTypeChange('normal')">
                    匹配总览
                  </el-button>
                  <el-button :type="overviewType === 'ranked' ? 'primary' : 'default'" plain @click="handleOverviewTypeChange('ranked')">
                    竞技总览
                  </el-button>
                </div>
              </div>
              <p class="stats-kd-hint">KD = 总击杀 / 总失败场次；失败为 0 时按总击杀计</p>
              <div v-if="pubgDisplay" class="stats-kpi-grid">
                <div class="stats-kpi-item">
                  <div class="stats-kpi-label">总场次</div>
                  <div class="stats-kpi-value">{{ pubgDisplay.roundsPlayed }}</div>
                </div>
                <div class="stats-kpi-item">
                  <div class="stats-kpi-label">胜场</div>
                  <div class="stats-kpi-value">{{ pubgDisplay.wins }}</div>
                </div>
                <div class="stats-kpi-item">
                  <div class="stats-kpi-label">吃鸡率</div>
                  <div class="stats-kpi-value">{{ pubgDisplay.winRate }}%</div>
                </div>
                <div class="stats-kpi-item">
                  <div class="stats-kpi-label">总击杀</div>
                  <div class="stats-kpi-value">{{ pubgDisplay.kills }}</div>
                </div>
                <div class="stats-kpi-item">
                  <div class="stats-kpi-label">KD</div>
                  <div class="stats-kpi-value">{{ pubgDisplay.kdRatio }}</div>
                </div>
                <div class="stats-kpi-item">
                  <div class="stats-kpi-label">场均击杀</div>
                  <div class="stats-kpi-value">{{ pubgDisplay.killsPerMatch }}</div>
                </div>
              </div>
              <div v-else class="stats-empty">暂无统计数据，点击「同步战绩」获取最新数据</div>
            </el-card>

            <el-card shadow="hover" class="pubg-card pubg-card-matches">
              <h3 class="pubg-card-title">游戏对局</h3>
              <div class="match-filters">
                <el-select
                  v-model="matchQuery.mode"
                  clearable
                  placeholder="全部模式"
                  class="match-filter-select"
                >
                  <el-option label="Solo" value="solo" />
                  <el-option label="Duo" value="duo" />
                  <el-option label="Squad" value="squad" />
                  <el-option label="自定义" value="custom" />
                </el-select>
                <el-button type="primary" plain :loading="matchesLoading" @click="applyMatchFilter">查询</el-button>
              </div>
              <p v-if="seasonFilterNote" class="match-filter-hint">{{ seasonFilterNote }}</p>

              <div class="match-list" v-loading="matchesLoading">
                <article
                  v-for="row in pubgMatches"
                  :key="row.matchId"
                  class="match-item"
                  :class="{ expanded: expandedMobileMatchId === row.matchId }"
                >
                  <button type="button" class="match-item-main" @click="toggleMobileMatch(row)">
                    <div class="match-item-rank" :class="{ top3: row.rank <= 3 }">#{{ row.rank }}</div>
                    <div class="match-item-body">
                      <div class="match-item-row">
                        <span class="match-item-map">{{ formatMapName(row.mapName) }}</span>
                        <span class="match-item-time">{{ formatMatchDateShort(row.createdAt) }}</span>
                      </div>
                      <div class="match-item-row match-item-row-sub">
                        <span class="match-item-tags">
                          <span class="match-tag">{{ formatModeName(row.gameMode) }}</span>
                          <span class="match-tag">{{ formatMatchType(row) }}</span>
                        </span>
                        <span class="match-item-metrics">
                          <span class="match-metric"><em>K</em>{{ row.kills }}</span>
                          <span class="match-metric"><em>伤</em>{{ formatDamage(row.damageDealt) }}</span>
                        </span>
                      </div>
                    </div>
                    <span class="match-item-chevron" aria-hidden="true"></span>
                  </button>
                  <div
                    v-if="expandedMobileMatchId === row.matchId"
                    class="match-item-detail"
                    v-loading="expandedRowLoadingMap[row.matchId]"
                  >
                    <div class="match-detail-title">队友数据</div>
                    <template v-if="matchDetailMap[row.matchId]?.teamMembers?.length">
                      <div class="match-member-table">
                        <div class="match-member-head">
                          <span class="match-member-col name">成员</span>
                          <span class="match-member-col stat">K</span>
                          <span class="match-member-col stat">A</span>
                          <span class="match-member-col stat damage">伤害</span>
                        </div>
                        <div
                          v-for="member in matchDetailMap[row.matchId].teamMembers"
                          :key="member.name"
                          class="match-member-row"
                        >
                          <span class="match-member-col name" :class="{ 'self-tag': member.isSelf }">
                            {{ member.name }}{{ member.isSelf ? '（我）' : '' }}
                          </span>
                          <span class="match-member-col stat">{{ member.kills ?? 0 }}</span>
                          <span class="match-member-col stat">{{ member.assists ?? 0 }}</span>
                          <span class="match-member-col stat damage">{{ formatDamage(member.damageDealt) }}</span>
                        </div>
                      </div>
                    </template>
                    <p v-else-if="!expandedRowLoadingMap[row.matchId]" class="detail-placeholder">暂无队友数据</p>
                  </div>
                </article>
                <p v-if="!matchesLoading && !pubgMatches.length" class="match-list-empty">暂无对局记录</p>
              </div>

              <div v-if="pubgMatchesTotal > matchQuery.pageSize" class="match-pagination">
                <el-pagination
                  background
                  layout="prev, pager, next"
                  :current-page="matchQuery.page"
                  :page-size="matchQuery.pageSize"
                  :total="pubgMatchesTotal"
                  @current-change="handleMatchPageChange"
                />
              </div>
            </el-card>
          </template>
        </div>

        <el-card shadow="hover" class="cup-history-card cup-history-section" v-loading="cupHistoryLoading">
            <h3 class="cup-history-title">我的杯赛战绩</h3>
            <p class="cup-history-subtitle">已结束杯赛中的参赛记录</p>

            <template v-if="cupHistory?.summary?.seasonsPlayed">
              <div class="cup-summary-grid">
                <div class="cup-summary-item">
                  <span class="cup-summary-value">{{ cupHistory.summary.seasonsPlayed }}</span>
                  <span class="cup-summary-label">参赛届数</span>
                </div>
                <div class="cup-summary-item">
                  <span class="cup-summary-value">{{ cupHistory.summary.championships }}</span>
                  <span class="cup-summary-label">夺冠次数</span>
                </div>
                <div class="cup-summary-item">
                  <span class="cup-summary-value">
                    {{ cupHistory.summary.bestRank ? `#${cupHistory.summary.bestRank}` : '—' }}
                  </span>
                  <span class="cup-summary-label">最佳名次</span>
                </div>
                <div class="cup-summary-item">
                  <span class="cup-summary-value">{{ cupHistory.summary.totalKills }}</span>
                  <span class="cup-summary-label">累计击杀</span>
                </div>
              </div>

              <div class="profile-table-scroll cup-table-scroll">
                <el-table
                  :data="cupHistory.seasons"
                  size="small"
                  class="cup-season-table"
                  empty-text="暂无记录"
                >
                  <el-table-column label="杯赛" min-width="100" prop="title" show-overflow-tooltip />
                  <el-table-column label="结束" width="80">
                    <template #default="{ row }">{{ formatCupDate(row.finishedAt) }}</template>
                  </el-table-column>
                  <el-table-column label="队伍" min-width="88">
                    <template #default="{ row }">
                      #{{ String(row.teamNumber).padStart(2, '0') }} {{ row.teamName }}
                    </template>
                  </el-table-column>
                  <el-table-column label="名次" width="56" align="center">
                    <template #default="{ row }">
                      <span :class="{ 'cup-champion': row.isChampion }">
                        {{ row.teamRank ? `#${row.teamRank}` : '—' }}
                      </span>
                    </template>
                  </el-table-column>
                  <el-table-column label="击杀" width="52" align="center" prop="totalKills" />
                </el-table>
              </div>
            </template>

            <p v-else class="cup-history-empty">暂无已结束的杯赛参赛记录</p>
        </el-card>
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
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.profile-container > .container {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.profile-container h2 {
  text-align: center;
  margin-bottom: 2.5rem;
  font-size: 2rem;
  font-weight: 600;
  color: #1d1d1f;
  letter-spacing: -0.01em;
}

/* 页面布局：单列卡片流 */
.profile-layout {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  min-width: 0;
}

.profile-info-section,
.cup-history-section,
.pubg-content {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.profile-section {
  margin-bottom: 0;
  padding: 0;
  background-color: transparent;
  border-radius: 0;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.profile-info-card,
.cup-history-card,
.pubg-card {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border-radius: 14px;
}

.profile-info-card :deep(.el-card__body),
.cup-history-card :deep(.el-card__body),
.pubg-card :deep(.el-card__body) {
  padding: 1.25rem;
}

.pubg-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.pubg-card-title {
  margin: 0 0 0.85rem;
  font-size: 1.05rem;
  font-weight: 700;
  color: #1f2d3d;
}

.pubg-card-desc {
  margin: -0.35rem 0 1rem;
  font-size: 0.85rem;
  color: #909399;
  line-height: 1.5;
}

.stats-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.65rem;
}

.stats-card-head .pubg-card-title {
  margin-bottom: 0;
  flex-shrink: 0;
}

.stats-type-toggle {
  flex: 1 1 auto;
  max-width: 280px;
  padding: 0.25rem;
  border-radius: 10px;
  background: #f0f4fa;
  gap: 0.25rem;
  margin-bottom: 0;
}

.stats-type-toggle :deep(.el-button) {
  flex: 1 1 0;
  min-width: 0;
  margin: 0;
  border: none !important;
  background: transparent;
  padding: 0.45rem 0.5rem;
  font-size: 0.8rem;
  height: auto;
}

.stats-type-toggle :deep(.el-button--primary),
.stats-type-toggle :deep(.el-button--primary.is-plain) {
  background: #fff !important;
  color: #2458ff !important;
  --el-button-text-color: #2458ff;
  --el-button-bg-color: #fff;
  --el-button-border-color: transparent;
  --el-button-hover-text-color: #2458ff;
  --el-button-hover-bg-color: #fff;
  --el-button-hover-border-color: transparent;
  --el-button-active-text-color: #1d4ed8;
  --el-button-active-bg-color: #fff;
  --el-button-active-border-color: transparent;
  box-shadow: 0 1px 4px rgba(36, 88, 255, 0.12);
}

.stats-type-toggle :deep(.el-button--default),
.stats-type-toggle :deep(.el-button--default.is-plain) {
  color: #607086 !important;
  --el-button-text-color: #607086;
  --el-button-bg-color: transparent;
  --el-button-border-color: transparent;
  --el-button-hover-text-color: #2458ff;
  --el-button-hover-bg-color: transparent;
  --el-button-hover-border-color: transparent;
}

.stats-kd-hint {
  margin: 0 0 0.85rem;
  font-size: 0.75rem;
  line-height: 1.45;
  color: #8a97ab;
}

.stats-kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
}

.stats-kpi-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 4.25rem;
  padding: 0.7rem 0.45rem;
  border-radius: 10px;
  background: #f7f9fc;
  border: 1px solid #e8edf5;
  text-align: center;
}

.stats-kpi-label {
  font-size: 0.72rem;
  color: #909399;
  line-height: 1.3;
}

.stats-kpi-value {
  margin-top: 0.2rem;
  font-size: 1.2rem;
  font-weight: 700;
  color: #303133;
  line-height: 1.2;
  word-break: break-all;
}

.stats-empty {
  margin: 0;
  padding: 1.25rem 0.75rem;
  text-align: center;
  font-size: 0.85rem;
  color: #909399;
  background: #f7f9fc;
  border-radius: 10px;
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
  flex-direction: row;
  align-items: center;
  gap: 0;
  width: 100%;
  min-height: 7.5rem;
  box-sizing: border-box;
}

.profile-info-avatar,
.profile-info-content {
  flex: 0 0 50%;
  max-width: 50%;
  min-width: 0;
  box-sizing: border-box;
}

.profile-info-avatar {
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: stretch;
  padding: 0.75rem 1rem;
  border-right: 1px solid #f0f2f5;
}

.profile-info-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-self: stretch;
  padding: 0.75rem 1rem 0.75rem 1.25rem;
}

.profile-info-content .user-details,
.profile-info-content .user-edit {
  width: 100%;
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
  text-align: left;
  width: 100%;
}

.user-details h2 {
  margin: 0 0 0.5rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #1d1d1f;
  letter-spacing: -0.01em;
  line-height: 1.3;
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
  justify-content: flex-start;
  gap: 0.75rem;
  align-items: center;
  margin-top: 0.5rem;
}

.user-edit {
  width: 100%;
  max-width: none;
  text-align: left;
}

/* 响应式布局 */
@media (max-width: 768px) {
  .profile-layout {
    gap: 0.75rem;
  }

  .cup-history-section {
    overflow: hidden;
  }

  .cup-history-card {
    overflow: hidden;
  }

  .cup-history-card :deep(.el-card__body) {
    overflow: hidden;
  }

  .profile-info-card :deep(.el-card__body),
  .cup-history-card :deep(.el-card__body),
  .pubg-card :deep(.el-card__body) {
    padding: 1rem;
  }

  .profile-info {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
    min-height: 0;
  }

  .profile-info-avatar,
  .profile-info-content {
    flex: none;
    width: 100%;
    max-width: 100%;
  }

  .profile-info-avatar {
    padding: 0.25rem 0 0;
    border-right: none;
    border-bottom: 1px solid #f0f2f5;
    padding-bottom: 1rem;
  }

  .profile-info-content {
    padding: 0;
  }

  .user-details {
    text-align: center;
  }

  .user-actions {
    justify-content: center;
  }

  .user-edit {
    text-align: left;
  }

  .avatar {
    width: 72px;
    height: 72px;
  }

  .user-details h2 {
    font-size: 1.125rem;
  }

  .user-edit {
    max-width: none;
    width: 100%;
  }

  .stats-card-head {
    flex-direction: column;
    align-items: stretch;
  }

  .stats-type-toggle {
    max-width: none;
    width: 100%;
  }

  .stats-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
  }

  .stats-kpi-item {
    min-height: 3.75rem;
    padding: 0.6rem 0.4rem;
  }

  .stats-kpi-value {
    font-size: 1.05rem;
  }

  .pubg-mobile-only {
    display: block !important;
  }

  .pubg-desktop-only {
    display: none !important;
  }

  .pubg-content {
    gap: 0.75rem;
  }

  .pubg-card-power .power-hero {
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.75rem;
    padding: 0.9rem 0.75rem;
  }

  .pubg-card-power .power-hero-score {
    justify-content: center;
  }

  .pubg-card-power .power-score-num {
    font-size: 2.1rem;
  }

  .pubg-card-power .power-hero-level {
    min-width: 6.5rem;
    padding: 0.5rem 1rem;
  }

  .pubg-card-power .power-hero-level-value {
    font-size: 1.25rem;
  }

  .pubg-card-power .power-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .hero-actions-compact {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.4rem;
    width: 100%;
  }

  .hero-actions-compact .el-button {
    margin: 0;
    padding-left: 0.35rem;
    padding-right: 0.35rem;
    font-size: 0.75rem;
  }
}

/* 深色模式优化 */
.dark-mode .avatar {
  border-color: rgba(255, 255, 255, 0.1);
}

.dark-mode .avatar:hover {
  border-color: #0071e3;
}

.dark-mode .profile-info-avatar {
  border-right-color: rgba(255, 255, 255, 0.08);
}

@media (max-width: 768px) {
  .dark-mode .profile-info-avatar {
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
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
.cup-history-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: #1d1d1f;
}

.cup-history-subtitle {
  margin: 0.35rem 0 1rem;
  font-size: 0.82rem;
  color: #86868b;
}

.cup-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  margin-bottom: 1rem;
}

.cup-summary-item {
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  background: #f5f5f7;
  text-align: center;
}

.cup-summary-value {
  display: block;
  font-size: 1.15rem;
  font-weight: 700;
  color: #1d1d1f;
  line-height: 1.2;
}

.cup-summary-label {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.72rem;
  color: #86868b;
}

.cup-season-table {
  width: 100%;
}

.profile-table-scroll {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.cup-table-scroll :deep(.el-table) {
  width: 100%;
  min-width: 320px;
}

.cup-table-scroll :deep(.el-table__body-wrapper) {
  overflow-x: auto;
}

.match-table-scroll :deep(.el-table) {
  min-width: 640px;
}

.filter-select-mode {
  width: 130px;
}

.filter-select-season {
  width: 280px;
}

.hero-filters .filter-select {
  flex-shrink: 0;
}

.cup-champion {
  color: #9a6b00;
  font-weight: 700;
}

.cup-history-empty {
  margin: 0;
  font-size: 0.85rem;
  color: #86868b;
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
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
}

.avatar-upload-trigger :deep(.el-upload__input) {
  display: none;
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

  .hero-bind-form {
    max-width: none;
  }

  .panel-bind-info {
    flex-direction: column;
    align-items: stretch;
  }

  .hero-actions {
    width: 100%;
  }

  .hero-actions .el-button {
    flex: 1 1 auto;
    min-width: 0;
  }

  .hero-filters {
    flex-direction: column;
    align-items: stretch;
  }

  .hero-filters .filter-select,
  .hero-filters .el-button {
    width: 100%;
  }

  .match-filters {
    flex-direction: column;
    align-items: stretch;
  }

  .match-filters .el-button {
    width: 100%;
  }

  .overview-toggle {
    flex-wrap: nowrap;
    width: 100%;
  }

  .overview-toggle:not(.stats-type-toggle) .el-button {
    flex: 1 1 0;
    min-width: 0;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
    white-space: nowrap;
  }
}

@media (max-width: 480px) {
  .profile-container {
    padding: 0 0 1.5rem;
  }

  .profile-layout {
    gap: 0.75rem;
  }

  .avatar {
    width: 64px;
    height: 64px;
  }

  .user-details h2 {
    font-size: 1.1rem;
  }

  .cup-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .cup-summary-value {
    font-size: 1rem;
  }

  .hero-actions .el-button {
    flex: 1 1 100%;
  }

  .user-actions .el-button {
    width: 100%;
  }

  .hero-actions-compact {
    grid-template-columns: 1fr;
  }

  .match-item-row-sub {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
  }
}

/* 触屏设备：头像编辑提示常显 */
@media (hover: none) {
  .avatar-edit {
    opacity: 1;
    background: rgba(0, 0, 0, 0.45);
    font-size: 0.7rem;
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

.pubg-mobile-only {
  display: none !important;
}

.pubg-desktop-only {
  display: block;
}

.pubg-card-power .power-subtitle {
  margin: -0.35rem 0 0.75rem;
  font-size: 0.8rem;
  color: #8a97ab;
  line-height: 1.45;
}

.power-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border-radius: 12px;
  background: linear-gradient(120deg, #f8fbff, #eef5ff);
  border: 1px solid #e6ecf7;
}

.power-hero-score {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  min-width: 0;
}

.power-score-num {
  font-size: 2.35rem;
  font-weight: 800;
  line-height: 1;
  color: #1f2d3d;
}

.power-score-label {
  font-size: 0.82rem;
  color: #8a97ab;
  white-space: nowrap;
}

.power-hero-level {
  flex-shrink: 0;
  min-width: 5.5rem;
  padding: 0.55rem 0.85rem;
  border-radius: 10px;
  text-align: center;
  border: 2px solid #d8e1f2;
  background: #fff;
}

.power-hero-level-label {
  display: block;
  font-size: 0.68rem;
  color: #8a97ab;
  line-height: 1.2;
}

.power-hero-level-value {
  display: block;
  margin-top: 0.15rem;
  font-size: 1.35rem;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: 0.02em;
}

.power-tone-legend .power-score-num { color: #9a6b00; }
.power-tone-high .power-score-num { color: #2458ff; }
.power-tone-mid .power-score-num { color: #6b4ee6; }
.power-tone-base .power-score-num { color: #2e7d32; }
.power-tone-low .power-score-num { color: #6b7280; }

.power-level-legend {
  border-color: #e6b422;
  background: linear-gradient(145deg, #fff9e8 0%, #ffe7a3 100%);
}
.power-level-legend .power-hero-level-label { color: #9a6b00; }
.power-level-legend .power-hero-level-value { color: #8a5a00; }

.power-level-high {
  border-color: #6d9cff;
  background: linear-gradient(145deg, #f0f6ff 0%, #d6e6ff 100%);
}
.power-level-high .power-hero-level-label { color: #3b6fd9; }
.power-level-high .power-hero-level-value { color: #1d4ed8; }

.power-level-mid {
  border-color: #a894f0;
  background: linear-gradient(145deg, #f6f2ff 0%, #e5dbff 100%);
}
.power-level-mid .power-hero-level-label { color: #6b4ee6; }
.power-level-mid .power-hero-level-value { color: #5b3fd4; }

.power-level-base {
  border-color: #7bc995;
  background: linear-gradient(145deg, #f0faf3 0%, #d7f0df 100%);
}
.power-level-base .power-hero-level-label { color: #2e7d32; }
.power-level-base .power-hero-level-value { color: #1b6b32; }

.power-level-low {
  border-color: #c5ccd8;
  background: linear-gradient(145deg, #f8fafc 0%, #eef2f7 100%);
}
.power-level-low .power-hero-level-label { color: #6b7280; }
.power-level-low .power-hero-level-value { color: #4b5563; }

.power-level-empty {
  border-color: #e4e7ed;
  background: #f5f7fa;
}
.power-level-empty .power-hero-level-value {
  font-size: 1rem;
  font-weight: 600;
  color: #909399;
}

.power-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.55rem;
  margin-top: 0.85rem;
}

.power-metric-item {
  padding: 0.55rem 0.45rem;
  border-radius: 8px;
  background: #f7f9fc;
  border: 1px solid #e8edf5;
  text-align: center;
}

.power-metric-label {
  display: block;
  font-size: 0.68rem;
  color: #909399;
  line-height: 1.3;
}

.power-metric-value {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.92rem;
  font-weight: 700;
  color: #303133;
  line-height: 1.2;
}

.power-formula-toggle {
  display: block;
  width: 100%;
  margin-top: 0.75rem;
  padding: 0.45rem 0;
  border: none;
  background: none;
  color: #409eff;
  font-size: 0.8rem;
  text-align: center;
  cursor: pointer;
}

.match-filters {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.85rem;
}

.match-filter-select {
  flex: 1;
  min-width: 0;
}

.match-filter-hint {
  margin: -0.45rem 0 0.75rem;
  font-size: 0.75rem;
  color: #8a97ab;
  line-height: 1.45;
}

.match-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.match-item {
  border-radius: 12px;
  border: 1px solid #e8edf5;
  background: #fafbfd;
  overflow: hidden;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.match-item.expanded {
  border-color: #b3d4ff;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.1);
}

.match-item-main {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  padding: 0.75rem 0.85rem;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.match-item-rank {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 10px;
  background: #eef2f8;
  color: #5f6c80;
  font-size: 0.8rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.match-item-rank.top3 {
  background: linear-gradient(135deg, #ffe08a 0%, #f5a623 100%);
  color: #5a3e00;
}

.match-item-body {
  flex: 1;
  min-width: 0;
}

.match-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.match-item-row-sub {
  margin-top: 0.35rem;
}

.match-item-map {
  font-size: 0.92rem;
  font-weight: 700;
  color: #1f2d3d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-item-time {
  flex-shrink: 0;
  font-size: 0.72rem;
  color: #909399;
}

.match-item-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  min-width: 0;
}

.match-tag {
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  background: #fff;
  border: 1px solid #e4eaf3;
  font-size: 0.68rem;
  color: #607086;
  line-height: 1.3;
}

.match-item-metrics {
  display: flex;
  flex-shrink: 0;
  gap: 0.45rem;
}

.match-metric {
  padding: 0.18rem 0.45rem;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #e4eaf3;
  font-size: 0.78rem;
  font-weight: 700;
  color: #303133;
  line-height: 1.2;
}

.match-metric em {
  margin-right: 0.15rem;
  font-style: normal;
  font-size: 0.65rem;
  font-weight: 600;
  color: #909399;
}

.match-item-chevron {
  flex-shrink: 0;
  width: 0.45rem;
  height: 0.45rem;
  border-right: 2px solid #b8c2d1;
  border-bottom: 2px solid #b8c2d1;
  transform: rotate(45deg);
  transition: transform 0.2s ease, border-color 0.2s ease;
  margin-right: 0.15rem;
}

.match-item.expanded .match-item-chevron {
  transform: rotate(-135deg);
  border-color: #409eff;
  margin-top: 0.2rem;
}

.match-item-detail {
  border-top: 1px solid #eef2f8;
  padding: 0.65rem 0.85rem 0.75rem;
  background: #fff;
}

.match-detail-title {
  margin-bottom: 0.45rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: #909399;
}

.match-member-table {
  width: 100%;
}

.match-member-head,
.match-member-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2rem 2rem 3.25rem;
  align-items: center;
  column-gap: 0.5rem;
}

.match-member-head {
  padding: 0.15rem 0 0.45rem;
  border-bottom: 1px solid #eef2f8;
  font-size: 0.68rem;
  font-weight: 600;
  color: #909399;
}

.match-member-row {
  padding: 0.42rem 0;
  font-size: 0.78rem;
  color: #606266;
}

.match-member-row + .match-member-row {
  border-top: 1px dashed #eef2f8;
}

.match-member-col.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-member-col.stat {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: #303133;
}

.match-member-head .match-member-col.stat {
  font-weight: 600;
  color: #909399;
}

.match-member-col.damage {
  min-width: 3.25rem;
}

.match-list-empty {
  margin: 0;
  padding: 1.5rem 0.75rem;
  text-align: center;
  font-size: 0.85rem;
  color: #909399;
  background: #f7f9fc;
  border-radius: 10px;
}

.match-pagination {
  display: flex;
  justify-content: center;
  margin-top: 0.85rem;
}

.match-pagination :deep(.el-pagination) {
  flex-wrap: wrap;
  justify-content: center;
  row-gap: 0.5rem;
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
  flex-wrap: nowrap;
}

.overview-toggle .el-button {
  flex: 1 1 0;
  min-width: 0;
  margin: 0;
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

.skeleton-line-left {
  margin-left: 0;
  margin-right: 0;
}

.skeleton-line-title.skeleton-line-left {
  margin: 0 0 0.8rem;
}

.skeleton-btn-left {
  margin: 0.6rem 0 0;
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

</style>