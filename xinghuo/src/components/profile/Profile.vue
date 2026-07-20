<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { userApi } from '../../services/api'
import { DEFAULT_AVATAR, normalizeAvatar, avatarDisplayUrl, handleAvatarImgError, clearFailedAvatar } from '../../utils/avatar'
import { POWER_SCORE_V2 } from '../../utils/sparkLevel'
import { useAuthStore } from '../../stores/auth'

const route = useRoute()
const auth = useAuthStore()

// 用户数据
const userData = ref(null)

// 加载状态
const isLoading = ref(true)
const errorMessage = ref('')

const viewingUserId = computed(() => {
  const raw = route.query.userId
  if (raw == null || raw === '') return null
  const id = Number(raw)
  return Number.isFinite(id) && id > 0 ? id : null
})

const isOwnProfile = computed(() => {
  if (viewingUserId.value == null) return true
  return Number(auth.userData?.id) === viewingUserId.value
})

const isEditing = ref(false)
const editedUserData = ref(null)
const pubgBindingForm = ref({
  playerName: '',
  platform: 'steam'
})
const pubgStats = ref(null)
const pubgPower = ref(null)
const pubgPowerLoading = ref(false)
const pubgMastery = ref(null)
const pubgClan = ref(null)
const masteryLoading = ref(false)
const clanLoading = ref(false)
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
const powerFormulaDialogVisible = ref(false)
const powerRankPreviewList = [
  { key: 'e', level: 'E', desc: '新火初燃', range: '< 280' },
  { key: 'd', level: 'D', desc: '基础磨炼', range: '280 - 349' },
  { key: 'c', level: 'C', desc: '潜力成长', range: '350 - 429' },
  { key: 'b', level: 'B', desc: '进阶战士', range: '430 - 519' },
  { key: 'a', level: 'A', desc: '稳定强者', range: '520 - 619' },
  { key: 's', level: 'S', desc: '顶尖高手', range: '620 - 719' },
  { key: 'demon-s', level: '魔王S', desc: '魔王降临', range: '>= 720' }
]
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
  if (score >= 700) return 'legend'
  if (score >= 620) return 'high'
  if (score >= 520) return 'mid'
  if (score >= 430) return 'base'
  return 'low'
})
const pubgPowerSampleHint = computed(() => {
  if (!pubgPower.value?.sampleLimited) return ''
  const rounds = Number(pubgPower.value?.matchesAnalyzed || 0)
  return `四排样本偏少（${rounds}/${POWER_SCORE_V2.CONFIDENCE_ROUNDS} 场），战力已向基准值回归`
})
const pubgPowerLevelKey = computed(() => {
  const level = String(pubgPower.value?.level || '').trim().toUpperCase()
  if (level.includes('魔王')) return 'demon-s'
  if (level === 'S') return 's'
  if (level === 'A') return 'a'
  if (level === 'B') return 'b'
  if (level === 'C') return 'c'
  if (level === 'D') return 'd'
  if (level === 'E') return 'e'
  return 'empty'
})
const pubgPowerLevelText = computed(() => {
  const map = {
    'demon-s': '魔王降临',
    s: '顶尖高手',
    a: '稳定强者',
    b: '进阶战士',
    c: '潜力成长',
    d: '基础磨炼',
    e: '新火初燃',
    empty: '暂无评级'
  }
  return map[pubgPowerLevelKey.value] || map.empty
})
const pubgPowerSeasonLabel = computed(() => {
  const id = String(pubgPower.value?.seasonId || '')
  if (!id) return ''
  const tail = id.split('.').pop()
  return tail || id
})
const rankedDetailsView = computed(() =>
  pubgPower.value?.rankedDetails
  || pubgStats.value?.rankedDetails
  || null
)
const currentModeBreakdown = computed(() => {
  const key = overviewType.value === 'ranked' ? 'ranked' : 'normal'
  return pubgStats.value?.modeBreakdown?.[key] || null
})
const formatPct = (v) => {
  if (v == null || Number.isNaN(Number(v))) return '--'
  const n = Number(v)
  // top10Ratio/winRatio from API may be 0-1 or already percent
  const pct = n <= 1 ? n * 100 : n
  return `${pct.toFixed(1)}%`
}
const formatTierLabel = (tier) => {
  if (!tier) return '暂无段位'
  if (typeof tier === 'string') return tier
  return tier.label || [tier.tier, tier.subTier].filter(Boolean).join(' ') || '暂无段位'
}
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

const formatSeconds = (value) => {
  const sec = Math.max(0, Math.floor(Number(value) || 0))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
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
  if (!isOwnProfile.value) return
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

const applyOwnUserPayload = (data, statsData) => {
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
}

const applyPublicUserPayload = (payload) => {
  const data = payload?.user || {}
  userData.value = {
    id: data.id,
    username: data.username,
    avatar: normalizeAvatar(data.avatar),
    role: data.role,
    real_name: data.real_name || '',
    created_at: data.created_at,
    pubgBinding: payload?.pubgBinding || {
      playerName: '',
      platform: '',
      playerId: '',
      boundAt: null
    }
  }
  pubgStats.value = payload?.pubgStats || null
  pubgPower.value = payload?.pubgPower || null
  pubgMastery.value = payload?.pubgMastery || null
  pubgClan.value = payload?.pubgClan || null
  cupHistory.value = payload?.cupHistory || {
    summary: { seasonsPlayed: 0, championships: 0, bestRank: null, totalKills: 0 },
    seasons: [],
  }
  pubgMatches.value = []
  pubgMatchesTotal.value = 0
  animatePubgNumbers(pubgVisual.value)
  editedUserData.value = null
  isEditing.value = false
}

// 获取用户信息
const fetchUserData = async () => {
  isLoading.value = true
  errorMessage.value = ''
  try {
    if (!isOwnProfile.value) {
      const payload = await userApi.getPublicProfile(viewingUserId.value)
      applyPublicUserPayload(payload)
      return
    }

    const [data, statsData] = await Promise.all([
      userApi.getCurrentUser(),
      userApi.getStats().catch(() => null)
    ])
    
    // 确保 data 是一个对象
    if (typeof data === 'object' && data !== null) {
      applyOwnUserPayload(data, statsData)

      // 首屏优先渲染：慢接口改为后台加载，避免页面长时间卡在 loading
      if (userData.value.pubgBinding?.playerId) {
        Promise.allSettled([
          fetchPubgPower(),
          fetchPubgMatches(),
          fetchPubgMastery(),
          fetchPubgClan()
        ])
      } else {
        pubgPower.value = null
        pubgMastery.value = null
        pubgClan.value = null
        pubgMatches.value = []
        pubgMatchesTotal.value = 0
      }
    } else {
      errorMessage.value = '获取用户信息失败: 响应格式错误'
      // 设置默认数据
      setDefaultUserData()
    }
  } catch (error) {
    errorMessage.value = error.message || '获取用户信息失败'
    if (String(error.message || '').includes('接口不存在')) {
      errorMessage.value = '选手主页接口未就绪，请确认服务器已部署最新后端并重启 PM2'
    }
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
      fetchPubgMatches(),
      fetchPubgMastery(),
      fetchPubgClan()
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
    pubgMastery.value = null
    pubgClan.value = null
    animatePubgNumbers(null)
    pubgMatches.value = []
    pubgMatchesTotal.value = 0
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
    await fetchPubgMatches()
    await fetchPubgMastery()
    await fetchPubgClan()
    ElMessage.success('战绩同步完成')
  } catch (error) {
    ElMessage.error(error.message || '同步战绩失败')
  } finally {
    isRefreshingStats.value = false
  }
}

const fetchPubgOverview = async () => {
  if (!isOwnProfile.value || !isPubgBound.value) {
    if (!isOwnProfile.value) return
    pubgStats.value = null
    animatePubgNumbers(null)
    return
  }
  const overview = await userApi.getPubgOverview()
  pubgStats.value = overview || null
  animatePubgNumbers(pubgVisual.value)
}
const fetchPubgPower = async () => {
  if (!isOwnProfile.value || !isPubgBound.value) {
    if (!isOwnProfile.value) return
    pubgPower.value = null
    return
  }
  pubgPowerLoading.value = true
  try {
    const data = await userApi.getPubgPower(false)
    pubgPower.value = data || null
  } finally {
    pubgPowerLoading.value = false
  }
}
const fetchPubgMastery = async () => {
  if (!isPubgBound.value) {
    pubgMastery.value = null
    return
  }
  masteryLoading.value = true
  try {
    pubgMastery.value = await userApi.getPubgMastery()
  } catch (e) {
    console.warn(e)
    pubgMastery.value = null
  } finally {
    masteryLoading.value = false
  }
}
const fetchPubgClan = async () => {
  if (!isPubgBound.value) {
    pubgClan.value = null
    return
  }
  clanLoading.value = true
  try {
    const data = await userApi.getPubgClan()
    pubgClan.value = data?.clan || null
  } catch (e) {
    pubgClan.value = null
  } finally {
    clanLoading.value = false
  }
}
const handleOverviewTypeChange = (type) => {
  overviewType.value = type
  animatePubgNumbers(pubgVisual.value)
}

const fetchPubgMatches = async () => {
  if (!isOwnProfile.value || !isPubgBound.value) {
    if (!isOwnProfile.value) return
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
const avatarCropDialogVisible = ref(false)
const avatarCropImageUrl = ref('')
const avatarCropFileName = ref('avatar')
const avatarCropScale = ref(1)
const avatarCropOffset = ref({ x: 0, y: 0 })
const avatarCropImageMeta = ref({ width: 0, height: 0 })
const avatarCropDragging = ref({
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  baseX: 0,
  baseY: 0
})
const AVATAR_CROP_SIZE = 260
const AVATAR_OUTPUT_SIZE = 512

const avatarCropMetrics = computed(() => {
  const { width, height } = avatarCropImageMeta.value
  if (!width || !height) {
    return {
      scale: 1,
      drawWidth: AVATAR_CROP_SIZE,
      drawHeight: AVATAR_CROP_SIZE,
      maxX: 0,
      maxY: 0
    }
  }

  const scale = (AVATAR_CROP_SIZE / Math.min(width, height)) * avatarCropScale.value
  const drawWidth = width * scale
  const drawHeight = height * scale

  return {
    scale,
    drawWidth,
    drawHeight,
    maxX: Math.max(0, (drawWidth - AVATAR_CROP_SIZE) / 2),
    maxY: Math.max(0, (drawHeight - AVATAR_CROP_SIZE) / 2)
  }
})

const avatarCropImageStyle = computed(() => {
  const metrics = avatarCropMetrics.value
  const { x, y } = avatarCropOffset.value
  return {
    width: `${metrics.drawWidth}px`,
    height: `${metrics.drawHeight}px`,
    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`
  }
})
const avatarCropZoomLabel = computed(() => `${Math.round(avatarCropScale.value * 100)}%`)

const clampAvatarCropOffset = (x, y) => {
  const { maxX, maxY } = avatarCropMetrics.value
  return {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y))
  }
}

const resetAvatarCropper = () => {
  if (avatarCropImageUrl.value) {
    URL.revokeObjectURL(avatarCropImageUrl.value)
  }
  avatarCropImageUrl.value = ''
  avatarCropFileName.value = 'avatar'
  avatarCropScale.value = 1
  avatarCropOffset.value = { x: 0, y: 0 }
  avatarCropImageMeta.value = { width: 0, height: 0 }
  avatarCropDragging.value = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0
  }
}

const loadImage = (src) => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('图片读取失败，请重新选择'))
  image.src = src
})

const openAvatarCropper = async (file) => {
  if (!file) return
  if (!file.type?.startsWith('image/')) {
    ElMessage.warning('请选择图片文件')
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    ElMessage.warning('图片不能超过 8MB')
    return
  }

  resetAvatarCropper()
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    avatarCropImageUrl.value = objectUrl
    avatarCropFileName.value = file.name?.replace(/\.[^.]+$/, '') || 'avatar'
    avatarCropImageMeta.value = {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height
    }
    avatarCropScale.value = 1
    avatarCropOffset.value = { x: 0, y: 0 }
    avatarCropDialogVisible.value = true
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    ElMessage.error(error.message || '图片读取失败，请重新选择')
  }
}

const handleAvatarCropScaleChange = () => {
  avatarCropOffset.value = clampAvatarCropOffset(
    avatarCropOffset.value.x,
    avatarCropOffset.value.y
  )
}

const resetAvatarCropView = () => {
  avatarCropScale.value = 1
  avatarCropOffset.value = { x: 0, y: 0 }
}

const handleAvatarCropWheel = (event) => {
  if (!avatarCropImageUrl.value) return
  const nextScale = Number((avatarCropScale.value + (event.deltaY > 0 ? -0.08 : 0.08)).toFixed(2))
  avatarCropScale.value = Math.min(3, Math.max(1, nextScale))
  handleAvatarCropScaleChange()
}

const startAvatarCropDrag = (event) => {
  if (!avatarCropImageUrl.value) return
  event.preventDefault()
  event.currentTarget?.setPointerCapture?.(event.pointerId)
  avatarCropDragging.value = {
    active: true,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX: avatarCropOffset.value.x,
    baseY: avatarCropOffset.value.y
  }
}

const moveAvatarCropDrag = (event) => {
  const dragging = avatarCropDragging.value
  if (!dragging.active || dragging.pointerId !== event.pointerId) return
  const next = clampAvatarCropOffset(
    dragging.baseX + event.clientX - dragging.startX,
    dragging.baseY + event.clientY - dragging.startY
  )
  avatarCropOffset.value = next
}

const endAvatarCropDrag = (event) => {
  const dragging = avatarCropDragging.value
  if (!dragging.active || dragging.pointerId !== event.pointerId) return
  event.currentTarget?.releasePointerCapture?.(event.pointerId)
  avatarCropDragging.value = {
    ...dragging,
    active: false,
    pointerId: null
  }
}

const confirmAvatarCrop = async () => {
  if (!avatarCropImageUrl.value || avatarUploading.value) return

  try {
    const image = await loadImage(avatarCropImageUrl.value)
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_OUTPUT_SIZE
    canvas.height = AVATAR_OUTPUT_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器不支持头像裁剪')

    const metrics = avatarCropMetrics.value
    const { x, y } = avatarCropOffset.value
    const left = (AVATAR_CROP_SIZE - metrics.drawWidth) / 2 + x
    const top = (AVATAR_CROP_SIZE - metrics.drawHeight) / 2 + y
    const sourceX = Math.max(0, -left / metrics.scale)
    const sourceY = Math.max(0, -top / metrics.scale)
    const sourceSize = AVATAR_CROP_SIZE / metrics.scale

    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      AVATAR_OUTPUT_SIZE,
      AVATAR_OUTPUT_SIZE
    )

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    })
    if (!blob) throw new Error('头像裁剪失败，请重试')

    const croppedFile = new File([blob], `${avatarCropFileName.value}-cropped.jpg`, {
      type: 'image/jpeg'
    })
    await uploadAvatarFile(croppedFile)
    avatarCropDialogVisible.value = false
  } catch (error) {
    console.error('裁剪头像失败:', error)
    ElMessage.error(error.message || '裁剪头像失败，请重试')
  }
}

const uploadAvatarFile = async (file) => {
  if (!file) return
  avatarUploading.value = true
  try {
    const response = await userApi.uploadAvatar(file)
    if (response.user) {
      const next = normalizeAvatar(response.user.avatar)
      clearFailedAvatar(next)
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
  if (raw) openAvatarCropper(raw)
  avatarUploadRef.value?.clearFiles()
}
// 生命周期钩子
onMounted(async () => {
  await fetchUserData()
  fetchCupHistory()
})

watch(
  () => route.query.userId,
  async () => {
    await fetchUserData()
    fetchCupHistory()
  }
)

onBeforeUnmount(() => {
  resetAvatarCropper()
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
                <div class="profile-avatar-panel">
                <el-upload
                  v-if="isOwnProfile"
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
                      <el-avatar :key="userData.avatar" class="profile-avatar-img" :src="avatarDisplayUrl(userData.avatar)" @error="handleAvatarImgError"></el-avatar>
                      <div class="avatar-edit">
                        <span>{{ avatarUploading ? '上传中…' : '裁剪头像' }}</span>
                      </div>
                    </div>
                  </template>
                </el-upload>
                <div v-else class="avatar">
                  <el-avatar :key="userData.avatar" class="profile-avatar-img" :src="avatarDisplayUrl(userData.avatar)" @error="handleAvatarImgError"></el-avatar>
                </div>
                <p v-if="isOwnProfile" class="profile-avatar-hint">点击头像上传，支持拖拽裁剪</p>
                </div>
                </div>

                <div class="profile-info-content">
                <div class="user-details" v-if="!isEditing">
                  <span class="profile-kicker">{{ isOwnProfile ? '个人资料' : '选手资料' }}</span>
                  <h2>{{ userData.username }}</h2>
                  <div class="user-meta-list">
                    <p class="user-account" v-if="isOwnProfile && userData.account"><span class="meta-label">账号</span><strong>{{ userData.account }}</strong></p>
                    <p class="user-real-name" v-if="userData.real_name"><span class="meta-label">姓名</span><strong>{{ userData.real_name }}</strong></p>
                    <p class="user-phone" v-if="isOwnProfile && userData.phone"><span class="meta-label">电话</span><strong>{{ userData.phone }}</strong></p>
                    <p class="user-address" v-if="isOwnProfile && userData.address"><span class="meta-label">地址</span><strong>{{ userData.address }}</strong></p>
                  </div>
                  <div class="user-actions" v-if="isOwnProfile">
                    <el-button type="primary" @click="isEditing = true">编辑资料</el-button>
                  </div>
                </div>
                
                <div class="user-edit" v-else-if="isOwnProfile">
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

          <el-dialog
            v-model="avatarCropDialogVisible"
            title="裁剪头像"
            class="avatar-crop-dialog"
            width="420px"
            :close-on-click-modal="!avatarUploading"
            :close-on-press-escape="!avatarUploading"
            :show-close="!avatarUploading"
            @closed="resetAvatarCropper"
          >
            <div class="avatar-cropper">
              <div
                class="avatar-crop-stage"
                @pointerdown="startAvatarCropDrag"
                @pointermove="moveAvatarCropDrag"
                @pointerup="endAvatarCropDrag"
                @pointercancel="endAvatarCropDrag"
                @wheel.prevent="handleAvatarCropWheel"
              >
                <img
                  v-if="avatarCropImageUrl"
                  class="avatar-crop-image"
                  :src="avatarCropImageUrl"
                  :style="avatarCropImageStyle"
                  draggable="false"
                  alt="待裁剪头像"
                />
                <div class="avatar-crop-mask"></div>
              </div>
              <div class="avatar-crop-toolbar">
                <div class="avatar-crop-toolbar-head">
                  <span>缩放</span>
                  <strong>{{ avatarCropZoomLabel }}</strong>
                </div>
                <el-slider
                  v-model="avatarCropScale"
                  :min="1"
                  :max="3"
                  :step="0.01"
                  :show-tooltip="false"
                  @input="handleAvatarCropScaleChange"
                />
              </div>
              <div class="avatar-crop-actions">
                <el-button size="small" text :disabled="avatarUploading" @click="resetAvatarCropView">重置位置</el-button>
                <span>拖动图片调整位置，圆形区域即最终头像范围。</span>
              </div>
            </div>
            <template #footer>
              <el-button :disabled="avatarUploading" @click="avatarCropDialogVisible = false">取消</el-button>
              <el-button type="primary" :loading="avatarUploading" @click="confirmAvatarCrop">
                保存头像
              </el-button>
            </template>
          </el-dialog>

        <div class="pubg-content">
          <el-card v-if="!isPubgBound && isOwnProfile" shadow="hover" class="pubg-card pubg-card-bind">
            <span class="section-kicker">PUBG ACCOUNT</span>
            <div class="card-heading-stack">
              <h3 class="pubg-card-title">账号绑定</h3>
              <p class="pubg-card-desc">绑定游戏账号后可查看战力值、统计总览与对局记录。</p>
            </div>
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

          <el-card v-else-if="!isPubgBound" shadow="hover" class="pubg-card pubg-card-bind">
            <span class="section-kicker">PUBG ACCOUNT</span>
            <div class="card-heading-stack">
              <h3 class="pubg-card-title">账号绑定</h3>
              <p class="pubg-card-desc">该选手尚未绑定 PUBG 账号。</p>
            </div>
          </el-card>

          <template v-else>
            <el-card shadow="hover" class="pubg-card pubg-card-bind">
              <span class="section-kicker">PUBG ACCOUNT</span>
              <div class="card-title-row">
                <div class="card-heading-stack">
                  <h3 class="pubg-card-title">账号绑定</h3>
                  <p class="card-subcopy">{{ isOwnProfile ? '同步 PUBG 数据后，战力、统计和对局记录会自动展示。' : '展示该选手已绑定的 PUBG 身份与战力数据。' }}</p>
                </div>
                <span class="status-pill status-pill-success">已绑定</span>
              </div>
              <div class="panel-bind-info panel-bind-info-compact">
                <div class="bind-meta bind-meta-featured">
                  <span class="bind-meta-label">当前游戏身份</span>
                  <strong class="bind-player-name">{{ userData.pubgBinding.playerName }}</strong>
                  <div class="bind-platform-line">
                    <span class="platform-pill">{{ (userData.pubgBinding.platform || '').toUpperCase() }}</span>
                    <span v-if="isOwnProfile" class="bind-sync-note">可同步最新战绩</span>
                  </div>
                </div>
                <div v-if="isOwnProfile" class="bind-action-row hero-actions hero-actions-compact">
                  <el-button plain :loading="isRefreshingStats" @click="handleRefreshPubgStats">同步战绩</el-button>
                  <el-button type="warning" plain @click="startRebind">换绑</el-button>
                  <el-button type="danger" plain :loading="pubgLoading" @click="handleUnbindPubg">解绑</el-button>
                </div>
              </div>
              <div v-if="isOwnProfile && isRebinding" class="hero-rebind">
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
              <span class="section-kicker">SPARK POWER</span>
              <div class="card-title-row">
                <div class="card-heading-stack">
                  <h3 class="pubg-card-title">星火战力值</h3>
                  <p class="power-subtitle">
                    当前赛季四排排位评分（v2）
                    <span v-if="pubgPowerSeasonLabel">（{{ pubgPowerSeasonLabel }}）</span>
                  </p>
                </div>
                <span class="status-pill">Ranked</span>
              </div>
              <div class="power-hero" :class="`power-tone-${pubgPowerTone}`" v-loading="pubgPowerLoading">
                <div class="power-hero-score">
                  <span class="power-score-label">战力值</span>
                  <span class="power-score-num">{{ pubgPower?.score ?? '--' }}</span>
                  <span class="power-score-caption">综合评分</span>
                </div>
                <div
                  class="power-hero-level"
                  :class="`power-rank-${pubgPowerLevelKey}`"
                >
                  <span class="power-level-orbit"></span>
                  <span class="power-hero-level-label">评级</span>
                  <strong class="power-hero-level-value">{{ pubgPower?.level || '暂无' }}</strong>
                  <span class="power-hero-level-desc">{{ pubgPowerLevelText }}</span>
                </div>
              </div>
              <div v-if="rankedDetailsView || pubgPower?.currentTier" class="power-rank-meta">
                <div class="power-rank-meta-item">
                  <span>当前段位</span>
                  <strong>{{ formatTierLabel(pubgPower?.currentTier || rankedDetailsView?.currentTier) }}</strong>
                </div>
                <div class="power-rank-meta-item">
                  <span>当前 RP</span>
                  <strong>{{ pubgPower?.currentRankPoint ?? rankedDetailsView?.currentRankPoint ?? '--' }}</strong>
                </div>
                <div class="power-rank-meta-item">
                  <span>最高段位</span>
                  <strong>{{ formatTierLabel(pubgPower?.bestTier || rankedDetailsView?.bestTier) }}</strong>
                </div>
                <div class="power-rank-meta-item">
                  <span>最高 RP</span>
                  <strong>{{ pubgPower?.bestRankPoint ?? rankedDetailsView?.bestRankPoint ?? '--' }}</strong>
                </div>
              </div>
              <p v-if="pubgPowerSampleHint" class="power-sample-hint">{{ pubgPowerSampleHint }}</p>
              <div class="power-metrics" v-if="pubgPower">
                <div class="power-metric-item"><span class="power-metric-label">KD</span><span class="power-metric-value">{{ pubgPower.kd }}</span></div>
                <div class="power-metric-item"><span class="power-metric-label">场均伤害</span><span class="power-metric-value">{{ pubgPower.avgDamage }}</span></div>
                <div class="power-metric-item"><span class="power-metric-label">四排场次</span><span class="power-metric-value">{{ pubgPower.matchesAnalyzed }}</span></div>
                <div class="power-metric-item"><span class="power-metric-label">样本置信</span><span class="power-metric-value">{{ pubgPower.confidence != null ? Math.round(pubgPower.confidence * 100) + '%' : '--' }}</span></div>
                <div class="power-metric-item"><span class="power-metric-label">官方 KDA</span><span class="power-metric-value">{{ pubgPower?.kda ?? rankedDetailsView?.kda ?? '--' }}</span></div>
                <div class="power-metric-item"><span class="power-metric-label">Top10</span><span class="power-metric-value">{{ formatPct(pubgPower?.top10Ratio ?? rankedDetailsView?.top10Ratio) }}</span></div>
                <div class="power-metric-item"><span class="power-metric-label">胜率</span><span class="power-metric-value">{{ formatPct(pubgPower?.winRatio ?? rankedDetailsView?.winRatio) }}</span></div>
              </div>
              <button
                v-if="pubgPower"
                type="button"
                class="power-formula-toggle"
                @click="powerFormulaDialogVisible = true"
              >
                查看计算说明
              </button>
            </el-card>

            <el-card shadow="hover" class="pubg-card pubg-card-clan" v-loading="clanLoading">
              <span class="section-kicker">CLAN</span>
              <div class="card-title-row">
                <div class="card-heading-stack">
                  <h3 class="pubg-card-title">战队</h3>
                  <p class="card-subcopy">PUBG 官方战队信息</p>
                </div>
              </div>
              <template v-if="pubgClan">
                <p class="clan-name">{{ pubgClan.clanName || pubgClan.name || '未命名战队' }}</p>
                <p class="clan-tag" v-if="pubgClan.clanTag || pubgClan.tag">[{{ pubgClan.clanTag || pubgClan.tag }}]</p>
                <p class="clan-meta" v-if="pubgClan.memberCount != null">成员 {{ pubgClan.memberCount }}</p>
              </template>
              <p v-else class="clan-empty">暂未加入战队</p>
            </el-card>

            <el-dialog
              v-model="powerFormulaDialogVisible"
              title="星火战力值计算说明"
              class="power-formula-dialog"
              width="720px"
            >
              <div class="power-formula-modal">
                <section class="power-formula-section">
                  <span class="section-kicker">FORMULA</span>
                  <h4>计算方式</h4>
                  <p class="power-formula-equation">基础分 = (KD因子 × 0.70 + 伤害因子 × 0.30) × 1000</p>
                  <p class="power-formula-equation">战力值 = round(基础分 × 置信度 + 350 × (1 - 置信度))</p>
                  <p class="power-formula-hint">数据来源：PUBG 官方当前赛季四排排位（squad / squad-fpp），不含单排、双排。置信度 = min(1, √(四排场次 / 25))。</p>
                  <div class="power-factor-grid">
                    <div class="power-factor-item">
                      <span>KD 因子（70%）</span>
                      <strong>min(四排 KD, 4) / 4</strong>
                      <span class="power-factor-note">KD = 击杀 / 死亡</span>
                    </div>
                    <div class="power-factor-item">
                      <span>伤害因子（30%）</span>
                      <strong>min(场均伤害, 450) / 450</strong>
                      <span class="power-factor-note">场均伤害 = 四排累计伤害 / 四排场次</span>
                    </div>
                  </div>
                </section>

                <section class="power-formula-section">
                  <span class="section-kicker">RANK PREVIEW</span>
                  <h4>评级图标预览</h4>
                  <div class="power-rank-preview-grid">
                    <div
                      v-for="rank in powerRankPreviewList"
                      :key="rank.key"
                      class="power-rank-preview-card"
                      :class="`power-rank-${rank.key}`"
                    >
                      <span class="power-level-orbit"></span>
                      <span class="power-hero-level-label">{{ rank.range }}</span>
                      <strong class="power-hero-level-value">{{ rank.level }}</strong>
                      <span class="power-hero-level-desc">{{ rank.desc }}</span>
                    </div>
                  </div>
                </section>
              </div>
              <template #footer>
                <el-button type="primary" @click="powerFormulaDialogVisible = false">知道了</el-button>
              </template>
            </el-dialog>

            <el-card shadow="hover" class="pubg-card pubg-card-stats">
              <div class="stats-card-head">
                <div class="card-heading-stack">
                  <span class="section-kicker">OVERVIEW</span>
                  <h3 class="pubg-card-title">统计总览</h3>
                </div>
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
                  <div class="stats-kpi-foot">样本规模</div>
                </div>
                <div class="stats-kpi-item">
                  <div class="stats-kpi-label">胜场</div>
                  <div class="stats-kpi-value">{{ pubgDisplay.wins }}</div>
                  <div class="stats-kpi-foot">吃鸡次数</div>
                </div>
                <div class="stats-kpi-item">
                  <div class="stats-kpi-label">吃鸡率</div>
                  <div class="stats-kpi-value">{{ pubgDisplay.winRate }}%</div>
                  <div class="stats-kpi-foot">胜率表现</div>
                </div>
                <div class="stats-kpi-item">
                  <div class="stats-kpi-label">总击杀</div>
                  <div class="stats-kpi-value">{{ pubgDisplay.kills }}</div>
                  <div class="stats-kpi-foot">进攻贡献</div>
                </div>
                <div class="stats-kpi-item">
                  <div class="stats-kpi-label">KD</div>
                  <div class="stats-kpi-value">{{ pubgDisplay.kdRatio }}</div>
                  <div class="stats-kpi-foot">稳定性</div>
                </div>
                <div class="stats-kpi-item">
                  <div class="stats-kpi-label">场均击杀</div>
                  <div class="stats-kpi-value">{{ pubgDisplay.killsPerMatch }}</div>
                  <div class="stats-kpi-foot">每局火力</div>
                </div>
              </div>
              <div v-if="currentModeBreakdown" class="mode-breakdown">
                <h4 class="mode-breakdown-title">模式拆分</h4>
                <div class="mode-breakdown-grid">
                  <div
                    v-for="mode in [
                      { key: 'solo', label: '单排' },
                      { key: 'duo', label: '双排' },
                      { key: 'squad', label: '四排' },
                    ]"
                    :key="mode.key"
                    class="mode-breakdown-card"
                  >
                    <strong>{{ mode.label }}</strong>
                    <span>场次 {{ currentModeBreakdown[mode.key]?.roundsPlayed ?? 0 }}</span>
                    <span>KD {{ currentModeBreakdown[mode.key]?.kd ?? currentModeBreakdown[mode.key]?.kdRatio ?? '--' }}</span>
                    <span>胜率 {{ currentModeBreakdown[mode.key]?.winRate != null ? currentModeBreakdown[mode.key].winRate + '%' : (formatPct(currentModeBreakdown[mode.key]?.winRatio)) }}</span>
                  </div>
                </div>
              </div>
              <div v-if="!pubgDisplay" class="stats-empty">{{ isOwnProfile ? '暂无统计数据，点击「同步战绩」获取最新数据' : '暂无统计数据' }}</div>
            </el-card>

            <el-card shadow="hover" class="pubg-card pubg-card-mastery" v-loading="masteryLoading">
              <span class="section-kicker">MASTERY</span>
              <div class="card-title-row">
                <h3 class="pubg-card-title">精通</h3>
              </div>
              <div v-if="pubgMastery?.survival" class="survival-mastery">
                <span>生存精通 Lv.{{ pubgMastery.survival.level ?? '--' }}</span>
                <span v-if="pubgMastery.survival.tier">{{ typeof pubgMastery.survival.tier === 'object' ? formatTierLabel(pubgMastery.survival.tier) : pubgMastery.survival.tier }}</span>
              </div>
              <div v-if="pubgMastery?.weapon?.weapons?.length" class="weapon-mastery-list">
                <div v-for="w in pubgMastery.weapon.weapons" :key="w.id" class="weapon-mastery-item">
                  <strong>{{ w.name }}</strong>
                  <span>Lv.{{ w.level }}</span>
                  <span>击杀 {{ w.kills }}</span>
                </div>
              </div>
              <p
                v-if="!masteryLoading && !pubgMastery?.survival && !pubgMastery?.weapon?.weapons?.length"
                class="mastery-empty"
              >暂无精通数据</p>
            </el-card>

            <el-card v-if="isOwnProfile" shadow="hover" class="pubg-card pubg-card-matches">
              <div class="match-card-top">
                <div class="card-heading-stack">
                  <span class="section-kicker">MATCH LOG</span>
                  <h3 class="pubg-card-title">游戏对局</h3>
                  <p class="card-subcopy">基于 PUBG 官方字段：Win Place、K/A、Damage、Time Survived。</p>
                </div>
                <div class="match-count-pill">
                  <strong>{{ pubgMatchesTotal }}</strong>
                  <span>场记录</span>
                </div>
              </div>
              <div class="match-filters">
                <el-select
                  v-model="matchQuery.mode"
                  clearable
                  placeholder="全部模式"
                  class="match-filter-select"
                >
                  <el-option label="单排" value="solo" />
                  <el-option label="双排" value="duo" />
                  <el-option label="四排" value="squad" />
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
                    <div class="match-item-rank" :class="{ top3: row.rank <= 3 }">
                      <span class="match-rank-num">#{{ row.rank }}</span>
                      <span class="match-rank-label">Win Place</span>
                    </div>
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
                          <span class="match-metric"><em>A</em>{{ row.assists ?? 0 }}</span>
                          <span class="match-metric"><em>DMG</em>{{ formatDamage(row.damageDealt) }}</span>
                        </span>
                      </div>
                      <div class="match-item-row match-item-row-meta">
                        <span class="match-item-meta">生存 {{ formatSeconds(row.timeSurvived) }}</span>
                        <span class="match-item-meta">对局时长 {{ formatSeconds(row.duration) }}</span>
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
            <span class="section-kicker">CUP HISTORY</span>
            <div class="card-title-row cup-title-row">
              <div class="card-heading-stack">
                <h3 class="cup-history-title">杯赛战绩</h3>
                <p class="cup-history-subtitle">已结束杯赛中的参赛记录</p>
              </div>
              <span class="status-pill">Archive</span>
            </div>

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
/* Profile — single coherent design (Steam/Riot-lite personal center) */
.profile-container {
  --pc-bg: #eef1f4;
  --pc-surface: #ffffff;
  --pc-surface-2: #f7f8fa;
  --pc-border: #e2e6eb;
  --pc-text: #15181e;
  --pc-muted: #6b7280;
  --pc-accent: #2563eb;
  --pc-accent-soft: #eff4ff;
  --pc-radius: 14px;
  --pc-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.04);
  --pc-gap: 1rem;

  min-height: 100vh;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 0 2.5rem;
  background:
    radial-gradient(ellipse 80% 50% at 10% -10%, rgba(37, 99, 235, 0.08), transparent 55%),
    radial-gradient(ellipse 60% 40% at 100% 0%, rgba(15, 23, 42, 0.05), transparent 50%),
    var(--pc-bg);
}

.profile-container > .container {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 1rem;
}

.profile-layout {
  display: flex;
  flex-direction: column;
  gap: var(--pc-gap);
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  min-width: 0;
}

/* —— Cards —— */
.profile-info-card,
.cup-history-card,
.pubg-card,
.module-card {
  width: 100%;
  min-width: 0;
  border-radius: var(--pc-radius) !important;
  border: 1px solid var(--pc-border) !important;
  background: var(--pc-surface) !important;
  box-shadow: var(--pc-shadow) !important;
  overflow: hidden;
}

.profile-info-card::before,
.profile-info-card::after,
.cup-history-card::before,
.cup-history-card::after,
.pubg-card::before,
.pubg-card::after {
  display: none !important;
}

.profile-info-card :deep(.el-card__body),
.cup-history-card :deep(.el-card__body),
.pubg-card :deep(.el-card__body) {
  padding: 1.15rem 1.25rem !important;
}

/* —— Identity header —— */
.profile-info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1.25rem;
  align-items: center;
}

.profile-info-avatar {
  border: none !important;
  background: transparent !important;
  padding: 0 !important;
}

.profile-avatar-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
}

.profile-avatar-kicker,
.section-kicker,
.profile-kicker {
  display: inline-block;
  margin: 0 0 0.35rem;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--pc-muted);
}

.section-kicker::before,
.profile-kicker::before,
.profile-avatar-kicker::before {
  display: none !important;
}

.avatar-upload-trigger {
  line-height: 0;
}

.avatar {
  position: relative;
  width: 112px;
  height: 112px;
  border-radius: 50%;
  overflow: hidden;
  border: 3px solid #fff;
  box-shadow: 0 0 0 1px var(--pc-border), 0 8px 20px rgba(15, 23, 42, 0.1);
  background: var(--pc-surface-2);
  cursor: pointer;
}

.profile-avatar-img {
  width: 100% !important;
  height: 100% !important;
}

.avatar-edit {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.55);
  color: #fff;
  font-size: 0.78rem;
  font-weight: 600;
  opacity: 0;
  transition: opacity 0.18s ease;
}

.avatar:hover .avatar-edit {
  opacity: 1;
}

.profile-avatar-hint {
  margin: 0;
  font-size: 0.72rem;
  color: var(--pc-muted);
  text-align: center;
  max-width: 8rem;
  line-height: 1.35;
}

.profile-info-content {
  min-width: 0;
}

.user-details h2 {
  margin: 0.1rem 0 0.75rem;
  font-size: clamp(1.45rem, 2.4vw, 1.85rem);
  font-weight: 750;
  letter-spacing: -0.02em;
  color: var(--pc-text);
  text-align: left;
  line-height: 1.2;
}

.user-meta-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0 0 0.9rem;
}

.user-meta-list p {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.28rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--pc-border);
  background: var(--pc-surface-2);
  font-size: 0.8rem;
  color: var(--pc-text);
}

.meta-label {
  color: var(--pc-muted);
  font-weight: 600;
}

.user-meta-list strong {
  font-weight: 650;
}

.user-actions {
  display: flex;
  gap: 0.5rem;
}

.user-edit {
  max-width: 420px;
}

.user-actions .el-button--primary,
.hero-bind-form .el-button--primary,
.match-filters .el-button--primary {
  --el-button-bg-color: #15181e;
  --el-button-border-color: #15181e;
  --el-button-hover-bg-color: #2a2f38;
  --el-button-hover-border-color: #2a2f38;
}

/* —— PUBG grid —— */
.pubg-content {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  grid-template-areas:
    "bind bind"
    "power clan"
    "stats stats"
    "mastery mastery"
    "matches matches";
  gap: var(--pc-gap);
  align-items: stretch;
}

.pubg-card-bind { grid-area: bind; }
.pubg-card-power { grid-area: power; }
.pubg-card-clan { grid-area: clan; }
.pubg-card-stats { grid-area: stats; }
.pubg-card-mastery { grid-area: mastery; }
.pubg-card-matches { grid-area: matches; }

.card-title-row,
.match-card-top,
.stats-card-head,
.cup-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.card-heading-stack {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.pubg-card-title,
.cup-history-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--pc-text);
  letter-spacing: -0.01em;
}

.card-subcopy,
.pubg-card-desc,
.power-subtitle,
.stats-kd-hint,
.match-filter-hint,
.cup-history-subtitle {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--pc-muted);
}

.status-pill,
.platform-pill,
.match-count-pill {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.28rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--pc-border);
  background: var(--pc-surface-2);
  color: var(--pc-text);
  font-size: 0.72rem;
  font-weight: 650;
}

.status-pill-success {
  border-color: #bbf7d0;
  background: #f0fdf4;
  color: #15803d;
}

.match-count-pill {
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.15;
  padding: 0.4rem 0.65rem;
}

.match-count-pill strong {
  font-size: 1.1rem;
  font-weight: 750;
}

/* —— Bind —— */
.panel-bind-info-compact {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.bind-meta-featured {
  padding: 0.9rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--pc-border);
  background: linear-gradient(135deg, var(--pc-accent-soft), var(--pc-surface-2));
}

.bind-meta-featured::after {
  display: none !important;
}

.bind-meta-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pc-muted);
}

.bind-player-name {
  display: block;
  margin-top: 0.25rem;
  font-size: 1.25rem;
  font-weight: 750;
  color: var(--pc-text);
  word-break: break-word;
}

.bind-platform-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.55rem;
}

.bind-sync-note {
  font-size: 0.75rem;
  color: var(--pc-muted);
}

.hero-actions-compact {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.hero-rebind {
  margin-top: 0.85rem;
  padding-top: 0.85rem;
  border-top: 1px dashed var(--pc-border);
}

/* —— Power —— */
.power-hero {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 1rem;
  align-items: center;
  padding: 1rem 1.1rem;
  margin-bottom: 0.75rem;
  border-radius: 12px;
  border: 1px solid var(--pc-border);
  background: var(--pc-surface-2);
}

.power-hero-score {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.power-score-label,
.power-score-caption {
  font-size: 0.72rem;
  font-weight: 650;
  color: var(--pc-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.power-score-num {
  font-size: clamp(2.4rem, 4vw, 3.1rem);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--pc-text);
  font-variant-numeric: tabular-nums;
}

.power-tone-legend .power-score-num { color: #b45309; }
.power-tone-high .power-score-num { color: #1d4ed8; }
.power-tone-mid .power-score-num { color: #5b21b6; }
.power-tone-base .power-score-num { color: #047857; }
.power-tone-low .power-score-num { color: #4b5563; }

.power-hero-level {
  position: relative;
  min-width: 7.2rem;
  padding: 0.7rem 0.85rem;
  border-radius: 12px;
  border: 1px solid var(--pc-border);
  background: #fff;
  text-align: center;
  overflow: hidden;
}

.power-level-orbit {
  display: none;
}

.power-hero-level-label {
  display: block;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--pc-muted);
  letter-spacing: 0.06em;
}

.power-hero-level-value {
  display: block;
  margin: 0.15rem 0;
  font-size: 1.45rem;
  font-weight: 800;
  color: var(--pc-text);
  line-height: 1.1;
}

.power-hero-level-desc {
  display: block;
  font-size: 0.72rem;
  color: var(--pc-muted);
}

.power-rank-e { background: #f8fafc; }
.power-rank-d { background: #f1f5f9; }
.power-rank-c { background: #ecfdf5; border-color: #a7f3d0; }
.power-rank-b { background: #eff6ff; border-color: #bfdbfe; }
.power-rank-a { background: #eef2ff; border-color: #c7d2fe; }
.power-rank-s { background: #fff7ed; border-color: #fed7aa; }
.power-rank-demon-s {
  background: linear-gradient(160deg, #111827, #1f2937);
  border-color: #374151;
  color: #f9fafb;
}
.power-rank-demon-s .power-hero-level-label,
.power-rank-demon-s .power-hero-level-desc { color: #9ca3af; }
.power-rank-demon-s .power-hero-level-value { color: #fbbf24; }

.power-rank-meta,
.power-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.65rem;
}

.power-rank-meta-item,
.power-metric-item {
  padding: 0.55rem 0.6rem;
  border-radius: 10px;
  border: 1px solid var(--pc-border);
  background: var(--pc-surface);
}

.power-rank-meta-item span,
.power-metric-label {
  display: block;
  font-size: 0.68rem;
  font-weight: 650;
  color: var(--pc-muted);
  margin-bottom: 0.15rem;
}

.power-rank-meta-item strong,
.power-metric-value {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--pc-text);
  font-variant-numeric: tabular-nums;
}

.power-sample-hint {
  margin: 0.55rem 0 0;
  font-size: 0.78rem;
  color: #b45309;
}

.power-formula-toggle {
  margin-top: 0.75rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--pc-accent);
  font-size: 0.82rem;
  font-weight: 650;
  cursor: pointer;
}

.power-formula-toggle:hover {
  text-decoration: underline;
}

/* —— Clan —— */
.pubg-card-clan {
  display: flex;
  flex-direction: column;
}

.clan-name {
  margin: 0.4rem 0 0.2rem;
  font-size: 1.35rem;
  font-weight: 750;
  color: var(--pc-text);
}

.clan-tag {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--pc-muted);
}

.clan-meta {
  margin-top: 0.75rem;
  font-size: 0.82rem;
  color: var(--pc-muted);
}

.clan-empty {
  margin: 0.5rem 0 0;
  padding: 1.5rem 0.75rem;
  text-align: center;
  border-radius: 12px;
  border: 1px dashed var(--pc-border);
  background: var(--pc-surface-2);
  color: var(--pc-muted);
  font-size: 0.88rem;
}

/* —— Stats —— */
.stats-type-toggle {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.stats-kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.55rem;
  margin-top: 0.75rem;
}

.stats-kpi-item {
  padding: 0.7rem 0.55rem;
  border-radius: 12px;
  border: 1px solid var(--pc-border);
  background: var(--pc-surface-2);
  text-align: center;
}

.stats-kpi-label,
.stats-kpi-foot {
  font-size: 0.68rem;
  color: var(--pc-muted);
  font-weight: 650;
}

.stats-kpi-value {
  margin: 0.25rem 0;
  font-size: 1.2rem;
  font-weight: 750;
  color: var(--pc-text);
  font-variant-numeric: tabular-nums;
}

.mode-breakdown {
  margin-top: 0.9rem;
}

.mode-breakdown-title {
  margin: 0 0 0.5rem;
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--pc-text);
}

.mode-breakdown-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.mode-breakdown-card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.65rem 0.7rem;
  border-radius: 10px;
  border: 1px solid var(--pc-border);
  background: #fff;
  font-size: 0.78rem;
  color: var(--pc-muted);
}

.mode-breakdown-card strong {
  color: var(--pc-text);
  font-size: 0.88rem;
}

.stats-empty,
.mastery-empty,
.match-list-empty,
.cup-history-empty,
.detail-placeholder {
  margin: 0.5rem 0 0;
  padding: 1.25rem;
  text-align: center;
  color: var(--pc-muted);
  font-size: 0.88rem;
  border-radius: 12px;
  background: var(--pc-surface-2);
  border: 1px dashed var(--pc-border);
}

/* —— Mastery —— */
.survival-mastery {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin-bottom: 0.75rem;
  padding: 0.7rem 0.85rem;
  border-radius: 10px;
  border: 1px solid var(--pc-border);
  background: var(--pc-surface-2);
  font-size: 0.88rem;
  font-weight: 650;
  color: var(--pc-text);
}

.weapon-mastery-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 0.5rem;
}

.weapon-mastery-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.65rem 0.7rem;
  border-radius: 10px;
  border: 1px solid var(--pc-border);
  background: #fff;
  font-size: 0.78rem;
  color: var(--pc-muted);
}

.weapon-mastery-item strong {
  color: var(--pc-text);
  font-size: 0.88rem;
}

/* —— Matches —— */
.match-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding: 0.65rem;
  border-radius: 12px;
  background: var(--pc-surface-2);
  border: 1px solid var(--pc-border);
}

.match-filter-select {
  min-width: 140px;
}

.match-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.match-item {
  border-radius: 12px;
  border: 1px solid var(--pc-border);
  background: #fff;
  overflow: hidden;
}

.match-item-main {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.75rem 0.85rem;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.match-item-rank {
  width: 3.4rem;
  height: 3.4rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--pc-surface-2);
  border: 1px solid var(--pc-border);
}

.match-item-rank.top3 {
  background: #fff7ed;
  border-color: #fed7aa;
}

.match-rank-num {
  font-size: 1rem;
  font-weight: 800;
  color: var(--pc-text);
  line-height: 1;
}

.match-rank-label {
  margin-top: 0.15rem;
  font-size: 0.58rem;
  font-weight: 700;
  color: var(--pc-muted);
  letter-spacing: 0.02em;
}

.match-item-body {
  min-width: 0;
}

.match-item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.match-item-row + .match-item-row {
  margin-top: 0.25rem;
}

.match-item-map {
  font-weight: 700;
  color: var(--pc-text);
  font-size: 0.92rem;
}

.match-item-time,
.match-item-meta {
  font-size: 0.75rem;
  color: var(--pc-muted);
}

.match-item-tags,
.match-item-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.match-tag,
.match-metric {
  padding: 0.15rem 0.4rem;
  border-radius: 6px;
  background: var(--pc-surface-2);
  border: 1px solid var(--pc-border);
  font-size: 0.72rem;
  color: var(--pc-text);
  font-weight: 650;
}

.match-metric em {
  font-style: normal;
  color: var(--pc-muted);
  margin-right: 0.15rem;
}

.match-item-chevron {
  width: 0.45rem;
  height: 0.45rem;
  border-right: 2px solid #9ca3af;
  border-bottom: 2px solid #9ca3af;
  transform: rotate(45deg);
  transition: transform 0.15s ease;
}

.match-item.expanded .match-item-chevron {
  transform: rotate(-135deg);
}

.match-item-detail {
  padding: 0 0.85rem 0.85rem;
  border-top: 1px solid var(--pc-border);
}

.match-detail-title {
  padding: 0.65rem 0 0.4rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--pc-muted);
}

.match-member-table {
  border-radius: 10px;
  border: 1px solid var(--pc-border);
  overflow: hidden;
}

.match-member-head,
.match-member-row {
  display: grid;
  grid-template-columns: 1.4fr 0.5fr 0.5fr 0.8fr;
  gap: 0.35rem;
  padding: 0.45rem 0.6rem;
  font-size: 0.78rem;
}

.match-member-head {
  background: var(--pc-surface-2);
  color: var(--pc-muted);
  font-weight: 700;
}

.match-member-row {
  border-top: 1px solid var(--pc-border);
  color: var(--pc-text);
}

.self-tag {
  font-weight: 700;
  color: var(--pc-accent);
}

.match-pagination {
  display: flex;
  justify-content: center;
  margin-top: 0.85rem;
}

/* —— Cup —— */
.cup-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.85rem;
}

.cup-summary-item {
  padding: 0.75rem 0.5rem;
  border-radius: 12px;
  border: 1px solid var(--pc-border);
  background: var(--pc-surface-2);
  text-align: center;
}

.cup-summary-value {
  display: block;
  font-size: 1.25rem;
  font-weight: 750;
  color: var(--pc-text);
}

.cup-summary-label {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.72rem;
  color: var(--pc-muted);
  font-weight: 650;
}

.cup-table-scroll {
  border-radius: 12px;
  border: 1px solid var(--pc-border);
  overflow: auto;
}

.cup-champion {
  color: #b45309;
  font-weight: 750;
}

/* —— Dialogs —— */
.avatar-crop-dialog :deep(.el-dialog),
.power-formula-dialog :deep(.el-dialog) {
  border-radius: 14px !important;
}

.avatar-cropper {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.avatar-crop-stage {
  position: relative;
  width: 100%;
  height: 280px;
  overflow: hidden;
  border-radius: 12px;
  background: #111827;
  touch-action: none;
  cursor: grab;
}

.avatar-crop-image {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-origin: center center;
  user-select: none;
  pointer-events: none;
}

.avatar-crop-mask {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, transparent 90px, rgba(0, 0, 0, 0.55) 92px);
  pointer-events: none;
}

.avatar-crop-toolbar-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.82rem;
  color: var(--pc-muted);
}

.avatar-crop-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--pc-muted);
}

.power-formula-modal {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.power-formula-section {
  padding: 0.9rem;
  border-radius: 12px;
  border: 1px solid var(--pc-border);
  background: var(--pc-surface-2);
}

.power-formula-section h4 {
  margin: 0.2rem 0 0.55rem;
  font-size: 0.95rem;
  color: var(--pc-text);
}

.power-formula-equation {
  margin: 0 0 0.45rem;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  background: #15181e;
  color: #f3f4f6;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.78rem;
  line-height: 1.45;
}

.power-formula-hint,
.power-factor-note {
  font-size: 0.78rem;
  color: var(--pc-muted);
}

.power-factor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-top: 0.65rem;
}

.power-factor-item {
  padding: 0.65rem;
  border-radius: 10px;
  border: 1px solid var(--pc-border);
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--pc-muted);
}

.power-factor-item strong {
  color: var(--pc-text);
  font-size: 0.85rem;
}

.power-rank-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 0.5rem;
}

.power-rank-preview-card {
  position: relative;
  padding: 0.7rem 0.5rem;
  border-radius: 12px;
  border: 1px solid var(--pc-border);
  text-align: center;
  background: #fff;
}

/* —— Skeleton —— */
.skeleton-avatar {
  width: 112px !important;
  height: 112px !important;
}

.skeleton-line {
  margin-bottom: 0.5rem;
}

.skeleton-line-title {
  width: 40% !important;
  height: 1.4rem !important;
}

.skeleton-kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.skeleton-kpi-card {
  height: 4rem !important;
  border-radius: 10px;
}

.skeleton-table {
  height: 8rem !important;
  border-radius: 10px;
}

.error-container {
  max-width: 1080px;
  margin: 1rem auto;
}

/* —— Responsive —— */
@media (max-width: 960px) {
  .pubg-content {
    grid-template-columns: 1fr;
    grid-template-areas:
      "bind"
      "power"
      "clan"
      "stats"
      "mastery"
      "matches";
  }

  .stats-kpi-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .power-rank-meta,
  .power-metrics,
  .cup-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mode-breakdown-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .profile-container > .container {
    padding: 0 0.7rem;
  }

  .profile-info {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }

  .user-details h2,
  .user-meta-list,
  .user-actions {
    justify-content: center;
    text-align: center;
  }

  .user-meta-list {
    justify-content: center;
  }

  .user-actions {
    justify-content: center;
  }

  .power-hero {
    grid-template-columns: 1fr;
    text-align: center;
  }

  .power-hero-score {
    align-items: center;
  }

  .power-hero-level {
    width: 100%;
  }

  .stats-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .card-title-row,
  .match-card-top,
  .stats-card-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .match-item-main {
    grid-template-columns: auto 1fr;
  }

  .match-item-chevron {
    display: none;
  }

  .hero-actions-compact {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .hero-actions-compact .el-button {
    width: 100%;
    margin: 0 !important;
    padding-left: 0.35rem;
    padding-right: 0.35rem;
  }

  .power-factor-grid {
    grid-template-columns: 1fr;
  }
}

@media (hover: none) {
  .avatar-edit {
    opacity: 1;
    background: rgba(15, 23, 42, 0.35);
  }
}

/* —— Dark mode —— */
:global(.dark-mode) .profile-container,
.dark-mode .profile-container {
  --pc-bg: #0b0d10;
  --pc-surface: #15181e;
  --pc-surface-2: #1b1f27;
  --pc-border: #2a303b;
  --pc-text: #f3f4f6;
  --pc-muted: #9ca3af;
  --pc-accent: #60a5fa;
  --pc-accent-soft: #172554;
  --pc-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 10px 28px rgba(0, 0, 0, 0.28);
  background:
    radial-gradient(ellipse 70% 45% at 8% -8%, rgba(37, 99, 235, 0.16), transparent 55%),
    var(--pc-bg);
}

:global(.dark-mode) .avatar,
.dark-mode .avatar {
  border-color: #1f2937;
}

:global(.dark-mode) .bind-meta-featured,
.dark-mode .bind-meta-featured,
:global(.dark-mode) .power-hero,
.dark-mode .power-hero,
:global(.dark-mode) .power-hero-level,
.dark-mode .power-hero-level,
:global(.dark-mode) .match-item,
.dark-mode .match-item,
:global(.dark-mode) .weapon-mastery-item,
.dark-mode .weapon-mastery-item,
:global(.dark-mode) .mode-breakdown-card,
.dark-mode .mode-breakdown-card,
:global(.dark-mode) .power-factor-item,
.dark-mode .power-factor-item,
:global(.dark-mode) .power-rank-preview-card,
.dark-mode .power-rank-preview-card {
  background: var(--pc-surface-2);
}

:global(.dark-mode) .power-formula-equation,
.dark-mode .power-formula-equation {
  background: #030712;
}

:global(.dark-mode) .status-pill-success,
.dark-mode .status-pill-success {
  background: #052e16;
  border-color: #166534;
  color: #86efac;
}

</style>


/* —— 个人页布局优化：信息层级与桌面网格 —— */
.profile-layout {
  max-width: 1120px !important;
  gap: 1rem !important;
}

.pubg-content {
  display: grid !important;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr) !important;
  grid-template-areas:
    "bind bind"
    "power clan"
    "stats stats"
    "mastery mastery"
    "matches matches" !important;
  gap: 0.9rem !important;
  align-items: stretch;
}

.pubg-card-bind { grid-area: bind; }
.pubg-card-power { grid-area: power; }
.pubg-card-clan { grid-area: clan; }
.pubg-card-stats { grid-area: stats; }
.pubg-card-mastery { grid-area: mastery; }
.pubg-card-matches { grid-area: matches; }

.profile-info {
  grid-template-columns: 200px minmax(0, 1fr) !important;
  gap: 1.1rem !important;
}

.profile-info-avatar {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.user-meta-list {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0.4rem !important;
}

.user-meta-list p {
  margin: 0 !important;
  flex: 0 1 auto;
}

.pubg-card-power,
.pubg-card-clan {
  height: 100%;
}

.pubg-card-clan .clan-name {
  margin: 0.35rem 0 0.25rem;
  font-size: 1.25rem;
  font-weight: 700;
  color: #1d1d1f;
  line-height: 1.25;
}

.pubg-card-clan .clan-tag {
  margin: 0;
  font-size: 0.9rem;
  color: #6b6b73;
  font-weight: 600;
}

.pubg-card-clan .clan-meta,
.pubg-card-clan .clan-empty {
  margin-top: 0.75rem;
  color: #8e8e93;
  font-size: 0.82rem;
}

.pubg-card-clan .clan-empty {
  padding: 1.2rem 0.2rem;
  text-align: center;
  border: 1px dashed #e5e5ea;
  background: #fafafd;
}

.power-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
}

.power-rank-meta {
  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
}

.weapon-mastery-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.55rem;
}

.survival-mastery {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin-bottom: 0.75rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid #ececf1;
  background: #fafafd;
}

@media (max-width: 960px) {
  .pubg-content {
    grid-template-columns: 1fr !important;
    grid-template-areas:
      "bind"
      "power"
      "clan"
      "stats"
      "mastery"
      "matches" !important;
  }

  .power-metrics,
  .power-rank-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  .profile-info {
    grid-template-columns: 1fr !important;
  }
}

@media (max-width: 768px) {
  .profile-layout {
    gap: 0.75rem !important;
  }

  .user-details {
    text-align: left !important;
  }

  .user-meta-list,
  .user-actions {
    justify-content: flex-start !important;
  }
}
