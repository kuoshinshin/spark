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
const powerSeasonId = ref('')
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
const powerSeasonOptions = computed(() =>
  (seasonOptions.value || []).filter((item) => !String(item.value || '').includes('lifetime'))
)
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
  seasonOptions.value = []
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
          fetchPubgSeasons(),
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
      fetchPubgSeasons(),
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
    powerSeasonId.value = ''
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
    const data = await userApi.getPubgPower(false, powerSeasonId.value)
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
const handlePowerSeasonChange = async (seasonId) => {
  powerSeasonId.value = seasonId || ''
  if (!isOwnProfile.value) return
  pubgPowerLoading.value = true
  try {
    pubgPower.value = await userApi.getPubgPower(false, powerSeasonId.value)
  } catch (e) {
    ElMessage.error(e.message || '加载赛季战力失败')
  } finally {
    pubgPowerLoading.value = false
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

const fetchPubgSeasons = async () => {
  if (!isOwnProfile.value || !isPubgBound.value) {
    if (!isOwnProfile.value) return
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

  const current = (data?.seasons || []).find((s) => s.isCurrentSeason)
  if (current?.id && !powerSeasonId.value) powerSeasonId.value = current.id
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
                <div class="profile-avatar-kicker">{{ isOwnProfile ? 'MY PAGE' : 'PLAYER' }}</div>
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
              <div v-if="isOwnProfile && powerSeasonOptions.length" class="power-season-row">
                <span class="power-season-label">赛季</span>
                <el-select
                  :model-value="powerSeasonId"
                  placeholder="当前赛季"
                  class="power-season-select"
                  @change="handlePowerSeasonChange"
                >
                  <el-option v-for="opt in powerSeasonOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
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
              <h3 class="pubg-card-title">战队</h3>
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

.profile-info-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(64, 158, 255, 0.12);
  background:
    radial-gradient(circle at 18% 0%, rgba(64, 158, 255, 0.12), transparent 34%),
    linear-gradient(135deg, #ffffff 0%, #f8fbff 100%);
}

.profile-info-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 82% 18%, rgba(109, 93, 252, 0.09), transparent 32%),
    linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(64, 158, 255, 0.05));
  pointer-events: none;
}

.profile-info-card :deep(.el-card__body),
.cup-history-card :deep(.el-card__body),
.pubg-card :deep(.el-card__body) {
  padding: 1.25rem;
}

.profile-info-card :deep(.el-card__body) {
  position: relative;
  z-index: 1;
  padding: 1.35rem;
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
  border-right: 1px solid rgba(64, 158, 255, 0.12);
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

.profile-avatar-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
}

.profile-avatar-hint {
  margin: 0;
  font-size: 0.76rem;
  color: #7c8aa0;
  line-height: 1.4;
  text-align: center;
}

.avatar {
  position: relative;
  width: 116px;
  height: 116px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.92);
  background: linear-gradient(135deg, #eef5ff, #ffffff);
  box-shadow: 0 12px 28px rgba(31, 78, 160, 0.14);
  overflow: hidden;
}

.avatar:hover {
  transform: scale(1.03);
  border-color: #0071e3;
  box-shadow: 0 16px 34px rgba(31, 78, 160, 0.22);
}

.avatar :deep(.profile-avatar-img) {
  width: 100% !important;
  height: 100% !important;
}

.avatar :deep(img) {
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

.user-meta-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin: 0.2rem 0 0;
}

.user-meta-list p {
  margin: 0;
  padding: 0.32rem 0.58rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(210, 220, 235, 0.85);
  color: #607086;
  font-size: 0.8rem;
  line-height: 1.3;
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

.avatar-crop-dialog :deep(.el-dialog) {
  border-radius: 18px;
  overflow: hidden;
}

.avatar-crop-dialog :deep(.el-dialog__body) {
  padding-top: 0.5rem;
}

.avatar-cropper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.95rem;
}

.avatar-crop-stage {
  position: relative;
  width: 260px;
  height: 260px;
  border-radius: 18px;
  overflow: hidden;
  background:
    linear-gradient(45deg, #eef2f7 25%, transparent 25%),
    linear-gradient(-45deg, #eef2f7 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #eef2f7 75%),
    linear-gradient(-45deg, transparent 75%, #eef2f7 75%);
  background-color: #f8fafc;
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.25);
  touch-action: none;
  user-select: none;
  cursor: grab;
}

.avatar-crop-stage:active {
  cursor: grabbing;
}

.avatar-crop-image {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  object-fit: fill;
  user-select: none;
  pointer-events: none;
  transform-origin: center center;
}

.avatar-crop-mask {
  position: absolute;
  inset: 0;
  border-radius: 18px;
  pointer-events: none;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.92);
}

.avatar-crop-mask::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 260px;
  height: 260px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  box-shadow:
    0 0 0 999px rgba(15, 23, 42, 0.48),
    0 0 0 2px #ffffff,
    0 8px 24px rgba(0, 0, 0, 0.18);
}

.avatar-crop-mask::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 260px;
  height: 260px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background:
    linear-gradient(to right, transparent 32.8%, rgba(255, 255, 255, 0.28) 33%, rgba(255, 255, 255, 0.28) 33.6%, transparent 33.8%, transparent 66.2%, rgba(255, 255, 255, 0.28) 66.4%, rgba(255, 255, 255, 0.28) 67%, transparent 67.2%),
    linear-gradient(to bottom, transparent 32.8%, rgba(255, 255, 255, 0.28) 33%, rgba(255, 255, 255, 0.28) 33.6%, transparent 33.8%, transparent 66.2%, rgba(255, 255, 255, 0.28) 66.4%, rgba(255, 255, 255, 0.28) 67%, transparent 67.2%);
}

.avatar-crop-toolbar {
  width: 100%;
  max-width: 320px;
}

.avatar-crop-toolbar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.25rem;
  font-size: 0.82rem;
  color: #607086;
}

.avatar-crop-toolbar-head strong {
  color: #1f2d3d;
  font-size: 0.78rem;
}

.avatar-crop-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  max-width: 320px;
  color: #8a97ab;
  font-size: 0.76rem;
  line-height: 1.45;
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

  .user-meta-list {
    justify-content: center;
  }

  .user-actions {
    justify-content: center;
  }

  .user-edit {
    text-align: left;
  }

  .avatar {
    width: 104px;
    height: 104px;
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

  .avatar-crop-dialog :deep(.el-dialog) {
    width: calc(100vw - 24px) !important;
    max-width: 420px;
  }

  .avatar-crop-stage {
    width: min(260px, calc(100vw - 72px));
    height: min(260px, calc(100vw - 72px));
  }

  .avatar-crop-mask::before,
  .avatar-crop-mask::after {
    width: min(260px, calc(100vw - 72px));
    height: min(260px, calc(100vw - 72px));
  }

  .avatar-crop-actions {
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    text-align: center;
  }
}

/* 深色模式优化 */
.dark-mode .avatar {
  border-color: rgba(255, 255, 255, 0.1);
}

.dark-mode .avatar:hover {
  border-color: #0071e3;
}

.dark-mode .profile-info-card {
  border-color: rgba(64, 158, 255, 0.18);
  background:
    radial-gradient(circle at 18% 0%, rgba(64, 158, 255, 0.16), transparent 34%),
    linear-gradient(135deg, #1a1a1a 0%, #151923 100%);
}

.dark-mode .profile-avatar-hint {
  color: #a8b3c5;
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

.dark-mode .user-meta-list p {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
  color: #d3d9e6;
}

.dark-mode .avatar-crop-dialog :deep(.el-dialog) {
  background: #1a1a1a;
}

.dark-mode .avatar-crop-stage {
  background-color: #111827;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}

.dark-mode .avatar-crop-toolbar-head {
  color: #a8b3c5;
}

.dark-mode .avatar-crop-toolbar-head strong {
  color: #ffffff;
}

.dark-mode .avatar-crop-actions {
  color: #a8b3c5;
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
    width: 96px;
    height: 96px;
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
  grid-template-columns: repeat(auto-fit, minmax(4.8rem, 1fr));
  gap: 0.55rem;
  margin-top: 0.85rem;
}

.power-season-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin: 0 0 0.85rem;
}

.power-season-label {
  flex-shrink: 0;
  font-size: 0.78rem;
  color: #8a7c6c;
  font-weight: 600;
}

.power-season-select {
  flex: 1;
  min-width: 0;
}

.power-rank-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
  margin-top: 0.85rem;
}

.power-rank-meta-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.65rem 0.75rem;
  border-radius: 12px;
  border: 1px solid rgba(111, 96, 78, 0.1);
  background: rgba(255, 255, 255, 0.7);
}

.power-rank-meta-item span {
  font-size: 0.7rem;
  color: #9a8c7d;
}

.power-rank-meta-item strong {
  font-size: 0.95rem;
  color: #2f3b35;
  font-weight: 700;
}

.mode-breakdown {
  margin-top: 1rem;
}

.mode-breakdown-title {
  margin: 0 0 0.65rem;
  font-size: 0.92rem;
  font-weight: 700;
  color: #2d2924;
}

.mode-breakdown-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
}

.mode-breakdown-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 0.85rem;
  border-radius: 14px;
  border: 1px solid rgba(111, 96, 78, 0.1);
  background: rgba(255, 255, 255, 0.7);
}

.mode-breakdown-card strong {
  font-size: 0.88rem;
  color: #2f3b35;
  margin-bottom: 0.15rem;
}

.mode-breakdown-card span {
  font-size: 0.75rem;
  color: #8a7c6c;
  line-height: 1.35;
}

.pubg-card-clan .clan-name {
  margin: 0.15rem 0 0.35rem;
  font-size: 1.2rem;
  font-weight: 800;
  color: #2f3b35;
}

.pubg-card-clan .clan-tag {
  margin: 0 0 0.35rem;
  font-size: 0.9rem;
  font-weight: 700;
  color: #5c6b5a;
}

.pubg-card-clan .clan-meta,
.pubg-card-clan .clan-empty,
.mastery-empty {
  margin: 0;
  font-size: 0.82rem;
  color: #8a7c6c;
}

.survival-mastery {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 1rem;
  margin-bottom: 0.85rem;
  padding: 0.7rem 0.85rem;
  border-radius: 12px;
  border: 1px solid rgba(111, 96, 78, 0.1);
  background: #f8f3ea;
  font-size: 0.88rem;
  color: #2f3b35;
  font-weight: 600;
}

.weapon-mastery-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.55rem;
}

.weapon-mastery-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.7rem 0.8rem;
  border-radius: 12px;
  border: 1px solid rgba(111, 96, 78, 0.1);
  background: rgba(255, 255, 255, 0.7);
}

.weapon-mastery-item strong {
  font-size: 0.88rem;
  color: #2f3b35;
}

.weapon-mastery-item span {
  font-size: 0.74rem;
  color: #8a7c6c;
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

.power-sample-hint {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: #b45309;
  line-height: 1.45;
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

/* Modern Japanese minimal redesign */
.profile-container {
  padding: 1.25rem 0 3.5rem;
  background:
    radial-gradient(circle at 8% 4%, rgba(232, 166, 160, 0.16), transparent 28%),
    radial-gradient(circle at 92% 12%, rgba(174, 190, 153, 0.18), transparent 30%),
    linear-gradient(180deg, #fbfaf7 0%, #f6f1e9 100%);
}

.profile-container > .container {
  padding: 0 1rem;
}

.profile-layout {
  max-width: 1080px;
  gap: 1.15rem;
}

.profile-info-card,
.cup-history-card,
.pubg-card {
  border: 1px solid rgba(111, 96, 78, 0.12) !important;
  border-radius: 22px;
  background: rgba(255, 253, 248, 0.86);
  box-shadow: 0 18px 44px rgba(77, 62, 45, 0.08);
  backdrop-filter: blur(14px);
  overflow: hidden;
}

.profile-info-card:hover,
.cup-history-card:hover,
.pubg-card:hover {
  box-shadow: 0 22px 54px rgba(77, 62, 45, 0.11);
}

.profile-info-card {
  background:
    radial-gradient(circle at 88% 12%, rgba(232, 166, 160, 0.18), transparent 28%),
    linear-gradient(135deg, rgba(255, 253, 248, 0.96), rgba(250, 245, 237, 0.92));
}

.profile-info-card::before {
  background:
    linear-gradient(90deg, rgba(152, 134, 105, 0.12) 0 1px, transparent 1px),
    linear-gradient(180deg, rgba(152, 134, 105, 0.08) 0 1px, transparent 1px);
  background-size: 28px 28px;
  opacity: 0.5;
}

.profile-info-card :deep(.el-card__body) {
  padding: 1.5rem;
}

.profile-info {
  display: grid;
  grid-template-columns: minmax(220px, 0.78fr) minmax(0, 1.22fr);
  gap: 1.25rem;
  min-height: 0;
  align-items: stretch;
}

.profile-info-avatar,
.profile-info-content {
  flex: none;
  max-width: none;
}

.profile-info-avatar {
  padding: 1.4rem 1rem;
  border-right: 1px solid rgba(111, 96, 78, 0.12);
  background: rgba(255, 255, 255, 0.46);
  border-radius: 18px 0 0 18px;
}

.profile-info-content {
  padding: 1.2rem 1.1rem;
}

.profile-avatar-kicker,
.profile-kicker,
.section-kicker {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: #9a8060;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  line-height: 1.2;
}

.profile-avatar-kicker::before,
.profile-kicker::before,
.section-kicker::before {
  content: '';
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: #d9877d;
}

.avatar {
  width: 132px;
  height: 132px;
  border: 5px solid rgba(255, 255, 255, 0.96);
  background: linear-gradient(145deg, #f4efe6, #fffdf8);
  box-shadow:
    0 18px 34px rgba(97, 73, 45, 0.16),
    0 0 0 1px rgba(111, 96, 78, 0.08);
}

.avatar-edit {
  background: rgba(63, 50, 37, 0.58);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.profile-avatar-hint {
  color: #958675;
  font-size: 0.78rem;
}

.user-details h2 {
  margin: 0.35rem 0 0.75rem;
  text-align: left;
  color: #2d2924;
  font-size: clamp(1.55rem, 3vw, 2.25rem);
  font-weight: 800;
  letter-spacing: -0.035em;
}

.user-meta-list {
  gap: 0.55rem;
}

.user-meta-list p {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
  padding: 0.5rem 0.68rem;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.68);
  border: 1px solid rgba(111, 96, 78, 0.1);
  color: #3f382f;
  box-shadow: 0 8px 20px rgba(77, 62, 45, 0.04);
}

.meta-label {
  color: #9a8c7d;
  font-size: 0.72rem;
  font-weight: 700;
}

.user-meta-list strong {
  color: #3a332b;
  font-size: 0.85rem;
  font-weight: 700;
}

.user-actions {
  margin-top: 1rem;
}

.user-actions :deep(.el-button--primary),
.hero-bind-form :deep(.el-button--primary),
.match-filters :deep(.el-button--primary) {
  border-color: transparent;
  background: #2f3b35;
  box-shadow: 0 10px 22px rgba(47, 59, 53, 0.16);
}

.user-actions :deep(.el-button--primary:hover),
.hero-bind-form :deep(.el-button--primary:hover),
.match-filters :deep(.el-button--primary:hover) {
  background: #24302a;
}

.pubg-content {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.15rem;
}

.pubg-card-bind,
.pubg-card-power {
  min-height: 100%;
}

.pubg-card-stats,
.pubg-card-matches,
.pubg-card-mastery {
  grid-column: 1 / -1;
}

.pubg-card-title,
.cup-history-title {
  margin: 0.25rem 0 0.85rem;
  color: #2d2924;
  font-size: 1.12rem;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.pubg-card-desc,
.power-subtitle,
.stats-kd-hint,
.cup-history-subtitle {
  color: #8a7c6c !important;
}

.panel-bind-info {
  align-items: stretch;
}

.bind-meta {
  flex: 1;
  min-width: 0;
  padding: 0.85rem;
  border-radius: 16px;
  background: #f8f3ea;
  border: 1px solid rgba(111, 96, 78, 0.1);
}

.bind-meta p {
  color: #4b4036;
  font-weight: 700;
}

.hero-actions-compact {
  align-content: start;
}

.power-hero {
  padding: 1.15rem;
  border: 1px solid rgba(111, 96, 78, 0.12);
  background:
    radial-gradient(circle at 14% 16%, rgba(217, 135, 125, 0.18), transparent 34%),
    linear-gradient(135deg, #fbf7ef 0%, #eef3ea 100%);
}

.power-score-num {
  color: #2f3b35;
  font-size: 2.75rem;
}

.power-score-label,
.power-hero-level-label {
  color: #897d6f;
}

.power-hero-level {
  border-color: rgba(111, 96, 78, 0.16);
  background: rgba(255, 255, 255, 0.72);
}

.power-metrics {
  gap: 0.65rem;
}

.power-metric-item,
.stats-kpi-item,
.cup-summary-item {
  border: 1px solid rgba(111, 96, 78, 0.1);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 10px 22px rgba(77, 62, 45, 0.04);
}

.power-metric-value,
.stats-kpi-value,
.cup-summary-value {
  color: #2f3b35;
}

.stats-card-head {
  align-items: flex-start;
}

.stats-type-toggle {
  background: #f2eadf;
  border: 1px solid rgba(111, 96, 78, 0.08);
}

.stats-type-toggle :deep(.el-button--primary),
.stats-type-toggle :deep(.el-button--primary.is-plain) {
  color: #2f3b35 !important;
  box-shadow: 0 8px 18px rgba(77, 62, 45, 0.08);
}

.stats-kpi-grid {
  gap: 0.8rem;
}

.stats-kpi-item {
  min-height: 5rem;
  align-items: flex-start;
  padding: 0.85rem 0.95rem;
  text-align: left;
}

.stats-kpi-label {
  color: #9a8c7d;
  font-weight: 700;
}

.stats-kpi-value {
  margin-top: 0.35rem;
  font-size: 1.45rem;
  letter-spacing: -0.02em;
}

.match-filters {
  padding: 0.75rem;
  border-radius: 16px;
  background: #f8f3ea;
}

.match-item {
  border-color: rgba(111, 96, 78, 0.11);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.74);
  box-shadow: 0 10px 22px rgba(77, 62, 45, 0.04);
}

.match-item-main {
  padding: 0.9rem 1rem;
}

.match-item-rank {
  background: #f2eadf;
  color: #6f604e;
}

.match-item-rank.top3 {
  background: linear-gradient(135deg, #f6d58d, #d9877d);
  color: #37261d;
}

.match-item-map,
.match-member-col.stat {
  color: #2d2924;
}

.match-tag,
.match-metric {
  border-color: rgba(111, 96, 78, 0.1);
  background: #fbf8f1;
}

.match-item-detail {
  border-top-color: rgba(111, 96, 78, 0.1);
  background: #fffdf8;
}

.cup-history-card :deep(.el-card__body) {
  padding: 1.35rem;
}

.cup-summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.8rem;
}

.cup-summary-item {
  padding: 0.85rem 0.9rem;
  text-align: left;
}

.cup-summary-value {
  font-size: 1.45rem;
}

.cup-summary-label {
  color: #9a8c7d;
  font-weight: 700;
}

.cup-table-scroll :deep(.el-table) {
  border-radius: 16px;
  overflow: hidden;
  --el-table-header-bg-color: #f8f3ea;
  --el-table-tr-bg-color: rgba(255, 255, 255, 0.66);
  --el-table-border-color: rgba(111, 96, 78, 0.08);
}

@media (max-width: 900px) {
  .profile-layout {
    max-width: 680px;
  }

  .profile-info,
  .pubg-content {
    grid-template-columns: 1fr;
  }

  .profile-info-avatar {
    border-right: none;
    border-bottom: 1px solid rgba(111, 96, 78, 0.12);
    border-radius: 18px 18px 0 0;
  }
}

@media (max-width: 768px) {
  .profile-container {
    padding-top: 0.75rem;
  }

  .profile-container > .container {
    padding: 0 0.65rem;
  }

  .profile-info-card :deep(.el-card__body),
  .cup-history-card :deep(.el-card__body),
  .pubg-card :deep(.el-card__body) {
    padding: 1rem;
  }

  .profile-info {
    display: grid;
    gap: 0;
  }

  .profile-info-avatar {
    padding: 1.15rem 0.5rem;
  }

  .profile-info-content {
    padding: 1rem 0.25rem 0.25rem;
  }

  .user-details h2 {
    text-align: center;
    font-size: 1.55rem;
  }

  .user-meta-list p {
    justify-content: center;
    width: 100%;
  }

  .avatar {
    width: 112px;
    height: 112px;
  }

  .cup-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stats-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stats-kpi-item {
    min-height: 4.4rem;
    padding: 0.75rem;
  }

  .stats-kpi-value,
  .cup-summary-value {
    font-size: 1.25rem;
  }
}

.dark-mode .profile-container {
  background:
    radial-gradient(circle at 8% 4%, rgba(217, 135, 125, 0.14), transparent 28%),
    radial-gradient(circle at 92% 12%, rgba(174, 190, 153, 0.12), transparent 30%),
    linear-gradient(180deg, #12110f 0%, #181612 100%);
}

.dark-mode .profile-info-card,
.dark-mode .cup-history-card,
.dark-mode .pubg-card {
  border-color: rgba(255, 255, 255, 0.08) !important;
  background: rgba(29, 27, 23, 0.9);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
}

.dark-mode .profile-info-card {
  background:
    radial-gradient(circle at 88% 12%, rgba(217, 135, 125, 0.14), transparent 28%),
    linear-gradient(135deg, rgba(29, 27, 23, 0.96), rgba(23, 25, 22, 0.92));
}

.dark-mode .profile-info-avatar,
.dark-mode .bind-meta,
.dark-mode .match-filters {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.08);
}

.dark-mode .user-details h2,
.dark-mode .pubg-card-title,
.dark-mode .cup-history-title,
.dark-mode .match-item-map,
.dark-mode .stats-kpi-value,
.dark-mode .cup-summary-value,
.dark-mode .power-metric-value {
  color: #f7f1e8;
}

.dark-mode .user-meta-list p,
.dark-mode .power-metric-item,
.dark-mode .stats-kpi-item,
.dark-mode .cup-summary-item,
.dark-mode .match-item {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}

.dark-mode .user-meta-list strong,
.dark-mode .bind-meta p {
  color: #f0e7dc;
}

.dark-mode .power-hero {
  background:
    radial-gradient(circle at 14% 16%, rgba(217, 135, 125, 0.16), transparent 34%),
    linear-gradient(135deg, rgba(40, 36, 31, 0.95), rgba(28, 34, 29, 0.95));
}

.dark-mode .match-tag,
.dark-mode .match-metric,
.dark-mode .match-item-detail {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}

/* Card content refinement */
.profile-info-card :deep(.el-card__body),
.pubg-card :deep(.el-card__body),
.cup-history-card :deep(.el-card__body) {
  color: #3f382f;
}

.card-title-row,
.match-card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.card-title-row .pubg-card-title,
.card-title-row .cup-history-title,
.match-card-top .pubg-card-title {
  margin-bottom: 0.25rem;
}

.card-subcopy {
  margin: 0;
  color: #8a7c6c;
  font-size: 0.8rem;
  line-height: 1.55;
}

.status-pill,
.platform-pill,
.match-count-pill {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid rgba(111, 96, 78, 0.12);
  background: rgba(255, 255, 255, 0.66);
  color: #6f604e;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.status-pill {
  min-height: 1.8rem;
  padding: 0.28rem 0.68rem;
}

.status-pill-success {
  border-color: rgba(82, 133, 92, 0.18);
  background: rgba(236, 246, 230, 0.76);
  color: #3d6f42;
}

.platform-pill {
  min-height: 1.65rem;
  padding: 0.2rem 0.55rem;
  background: #2f3b35;
  color: #fffdf8;
}

.bind-meta-featured {
  position: relative;
  padding: 1rem;
  overflow: hidden;
}

.bind-meta-featured::after {
  content: '';
  position: absolute;
  right: -26px;
  top: -26px;
  width: 86px;
  height: 86px;
  border-radius: 50%;
  background: rgba(217, 135, 125, 0.14);
}

.bind-meta-label {
  display: block;
  color: #9a8c7d;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.bind-player-name {
  position: relative;
  z-index: 1;
  display: block;
  margin-top: 0.35rem;
  color: #2d2924;
  font-size: 1.35rem;
  font-weight: 850;
  line-height: 1.2;
  word-break: break-word;
}

.bind-platform-line {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  margin-top: 0.8rem;
}

.bind-sync-note {
  color: #8a7c6c;
  font-size: 0.78rem;
  font-weight: 700;
}

.hero-actions-compact .el-button {
  border-radius: 999px !important;
  font-weight: 700;
}

.power-hero {
  position: relative;
  overflow: hidden;
}

.power-hero::after {
  content: '';
  position: absolute;
  right: 1rem;
  bottom: -1.8rem;
  width: 8rem;
  height: 8rem;
  border: 1px solid rgba(111, 96, 78, 0.08);
  border-radius: 50%;
  pointer-events: none;
}

.power-hero-score,
.power-hero-level {
  position: relative;
  z-index: 1;
}

.power-metric-item {
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.power-metric-item:hover,
.stats-kpi-item:hover,
.cup-summary-item:hover {
  transform: translateY(-2px);
  border-color: rgba(217, 135, 125, 0.24);
  box-shadow: 0 14px 26px rgba(77, 62, 45, 0.08);
}

.stats-kpi-item {
  position: relative;
  overflow: hidden;
}

.stats-kpi-item::before {
  content: '';
  position: absolute;
  left: 0.9rem;
  top: 0.8rem;
  width: 0.28rem;
  height: 1.15rem;
  border-radius: 999px;
  background: #d9877d;
}

.stats-kpi-label,
.stats-kpi-value,
.stats-kpi-foot {
  position: relative;
  z-index: 1;
}

.stats-kpi-label {
  padding-left: 0.55rem;
}

.stats-kpi-foot {
  margin-top: 0.25rem;
  color: #a1978c;
  font-size: 0.7rem;
  font-weight: 700;
}

.match-card-top {
  align-items: center;
}

.match-count-pill {
  flex-direction: column;
  min-width: 4.8rem;
  min-height: 3.2rem;
  padding: 0.45rem 0.7rem;
  background: #f8f3ea;
  line-height: 1.1;
}

.match-count-pill strong {
  color: #2f3b35;
  font-size: 1.15rem;
}

.match-count-pill span {
  margin-top: 0.15rem;
  color: #9a8c7d;
  font-size: 0.68rem;
}

.match-filters {
  align-items: center;
  border: 1px solid rgba(111, 96, 78, 0.08);
}

.match-filters :deep(.el-input__wrapper),
.match-filters :deep(.el-select__wrapper) {
  border-radius: 999px !important;
  box-shadow: 0 0 0 1px rgba(111, 96, 78, 0.1) inset !important;
  background: rgba(255, 255, 255, 0.78);
}

.match-item {
  cursor: pointer;
}

.match-item:hover {
  border-color: rgba(217, 135, 125, 0.24);
  box-shadow: 0 16px 30px rgba(77, 62, 45, 0.08);
}

.match-item-main:focus-visible {
  outline: 2px solid rgba(217, 135, 125, 0.45);
  outline-offset: -3px;
}

.match-item-row-sub {
  align-items: center;
}

.match-member-head {
  color: #9a8c7d;
}

.match-member-row {
  color: #5f554a;
}

.cup-title-row {
  align-items: center;
}

.cup-summary-item {
  position: relative;
  overflow: hidden;
}

.cup-summary-item::after {
  content: '';
  position: absolute;
  right: -18px;
  bottom: -18px;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: rgba(174, 190, 153, 0.16);
}

.cup-summary-value,
.cup-summary-label {
  position: relative;
  z-index: 1;
}

.cup-table-scroll {
  border: 1px solid rgba(111, 96, 78, 0.08);
  border-radius: 16px;
  overflow: hidden;
}

.cup-table-scroll :deep(.el-table th.el-table__cell) {
  color: #6f604e;
  font-weight: 800;
}

.cup-table-scroll :deep(.el-table td.el-table__cell) {
  color: #4b4036;
}

@media (max-width: 768px) {
  .card-title-row,
  .match-card-top {
    flex-direction: column;
    align-items: stretch;
    gap: 0.65rem;
  }

  .status-pill,
  .match-count-pill {
    align-self: flex-start;
  }

  .match-count-pill {
    flex-direction: row;
    justify-content: flex-start;
    gap: 0.35rem;
    min-width: 0;
    min-height: 0;
  }

  .bind-player-name {
    font-size: 1.2rem;
  }

  .stats-kpi-label {
    padding-left: 0.5rem;
  }
}

.dark-mode .card-subcopy,
.dark-mode .bind-sync-note,
.dark-mode .stats-kpi-foot,
.dark-mode .match-count-pill span {
  color: #b8aa98;
}

.dark-mode .status-pill,
.dark-mode .match-count-pill {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.07);
  color: #e7dccd;
}

.dark-mode .status-pill-success {
  border-color: rgba(141, 190, 132, 0.2);
  background: rgba(91, 129, 76, 0.2);
  color: #b9e2ad;
}

.dark-mode .bind-player-name,
.dark-mode .match-count-pill strong {
  color: #f7f1e8;
}

.dark-mode .match-filters :deep(.el-input__wrapper),
.dark-mode .match-filters :deep(.el-select__wrapper) {
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset !important;
}

.dark-mode .cup-table-scroll {
  border-color: rgba(255, 255, 255, 0.08);
}

/* Spark power rank redesign */
.pubg-card-power {
  position: relative;
}

.pubg-card-power :deep(.el-card__body) {
  position: relative;
}

.pubg-card-power .power-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(150px, 0.85fr);
  align-items: stretch;
  gap: 0.9rem;
  padding: 0.9rem;
  min-height: 9.5rem;
}

.pubg-card-power .power-hero-score {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.15rem;
  padding: 0.85rem 0.95rem;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.52);
  border: 1px solid rgba(111, 96, 78, 0.08);
}

.pubg-card-power .power-score-label {
  order: 0;
  color: #8a7c6c;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.pubg-card-power .power-score-num {
  order: 1;
  font-size: clamp(2.8rem, 7vw, 4.2rem);
  font-weight: 900;
  letter-spacing: -0.06em;
  line-height: 0.95;
}

.pubg-card-power .power-score-caption {
  order: 2;
  margin-top: 0.2rem;
  color: #a1978c;
  font-size: 0.76rem;
  font-weight: 700;
}

.pubg-card-power .power-hero-level {
  isolation: isolate;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 8rem;
  padding: 1rem;
  border-radius: 22px;
  overflow: hidden;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.52),
    0 18px 32px rgba(77, 62, 45, 0.11);
  transition: transform 0.22s ease, box-shadow 0.22s ease;
}

.pubg-card-power .power-hero-level:hover {
  transform: translateY(-2px);
}

.power-level-orbit {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}

.power-level-orbit::before,
.power-level-orbit::after {
  content: '';
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
}

.power-level-orbit::before {
  width: 8rem;
  height: 8rem;
  right: -3.2rem;
  top: -3.2rem;
  border: 1px solid rgba(255, 255, 255, 0.32);
}

.power-level-orbit::after {
  width: 3.8rem;
  height: 3.8rem;
  left: -1.2rem;
  bottom: -1.2rem;
  background: rgba(255, 255, 255, 0.18);
}

.pubg-card-power .power-hero-level-label {
  color: currentColor;
  opacity: 0.78;
  font-size: 0.7rem;
  font-weight: 900;
  letter-spacing: 0.16em;
}

.pubg-card-power .power-hero-level-value {
  margin-top: 0.28rem;
  color: currentColor;
  font-size: clamp(2.05rem, 5vw, 3.2rem);
  font-weight: 950;
  line-height: 0.95;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
}

.power-hero-level-desc {
  margin-top: 0.48rem;
  color: currentColor;
  opacity: 0.82;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.power-rank-empty {
  color: #7b8493;
  border-color: #e3e8ef;
  background: linear-gradient(145deg, #f8fafc, #edf2f7);
}

.power-rank-e {
  color: #596273;
  border-color: #d8dee8;
  background: linear-gradient(145deg, #f7f8fa 0%, #e8edf3 100%);
}

.power-rank-d {
  color: #53636e;
  border-color: #cad7df;
  background: linear-gradient(145deg, #eef5f7 0%, #dce9ed 100%);
}

.power-rank-c {
  color: #205c5b;
  border-color: #9ed6cf;
  background:
    radial-gradient(circle at 22% 18%, rgba(255, 255, 255, 0.75), transparent 28%),
    linear-gradient(145deg, #e8faf5 0%, #bfe7df 52%, #9ed9cf 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    0 16px 30px rgba(46, 125, 119, 0.16);
}

.power-rank-b {
  color: #1f5c3b;
  border-color: #9bcf8b;
  background:
    radial-gradient(circle at 20% 18%, rgba(255, 255, 255, 0.78), transparent 28%),
    linear-gradient(145deg, #f1fae8 0%, #cfe7ae 48%, #a9d281 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    0 18px 34px rgba(74, 132, 71, 0.18);
}

.power-rank-a {
  color: #51328f;
  border-color: #bca8f5;
  background:
    radial-gradient(circle at 20% 16%, rgba(255, 255, 255, 0.82), transparent 27%),
    linear-gradient(145deg, #fbf4ff 0%, #ddd0ff 45%, #bba5f0 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.76),
    0 20px 38px rgba(106, 78, 180, 0.22);
}

.power-rank-s {
  color: #174690;
  border-color: #86b9ff;
  background:
    radial-gradient(circle at 18% 16%, rgba(255, 255, 255, 0.88), transparent 26%),
    linear-gradient(145deg, #f2f8ff 0%, #bcd9ff 42%, #73a7ff 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.82),
    0 22px 42px rgba(47, 103, 196, 0.28),
    0 0 32px rgba(115, 167, 255, 0.18);
}

.power-rank-demon-s {
  color: #4b2500;
  border-color: #f0c15a;
  background:
    radial-gradient(circle at 18% 14%, rgba(255, 255, 255, 0.9), transparent 24%),
    radial-gradient(circle at 78% 28%, rgba(255, 238, 153, 0.72), transparent 28%),
    linear-gradient(145deg, #fff7d8 0%, #f6ce63 42%, #c8891e 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.88),
    0 26px 48px rgba(175, 115, 18, 0.34),
    0 0 42px rgba(246, 206, 99, 0.28);
}

.power-rank-s .power-level-orbit::before,
.power-rank-demon-s .power-level-orbit::before {
  border-style: dashed;
  animation: power-orbit-spin 16s linear infinite;
}

.power-rank-demon-s .power-hero-level-value {
  text-shadow:
    0 1px 0 rgba(255, 255, 255, 0.72),
    0 8px 18px rgba(104, 58, 0, 0.22);
}

@keyframes power-orbit-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .pubg-card-power .power-hero {
    grid-template-columns: 1fr;
    min-height: 0;
    padding: 0.8rem;
  }

  .pubg-card-power .power-hero-score {
    align-items: center;
    text-align: center;
  }

  .pubg-card-power .power-hero-level {
    min-height: 7.2rem;
  }

  .mode-breakdown-grid {
    grid-template-columns: 1fr;
  }

  .power-rank-meta {
    grid-template-columns: 1fr;
  }
}

.dark-mode .pubg-card-power .power-hero-score {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}

.dark-mode .power-rank-c {
  color: #b7fff4;
  background: linear-gradient(145deg, #123936 0%, #175a52 55%, #1b7468 100%);
}

.dark-mode .power-rank-b {
  color: #d7ffc8;
  background: linear-gradient(145deg, #1d3925 0%, #336d38 55%, #57944b 100%);
}

.dark-mode .power-rank-a {
  color: #eadfff;
  background: linear-gradient(145deg, #2b2046 0%, #584198 55%, #7f66c9 100%);
}

.dark-mode .power-rank-s {
  color: #e1efff;
  background: linear-gradient(145deg, #142a4a 0%, #235aa0 50%, #4b8be8 100%);
}

.dark-mode .power-rank-demon-s {
  color: #fff4c7;
  background:
    radial-gradient(circle at 78% 28%, rgba(255, 238, 153, 0.28), transparent 28%),
    linear-gradient(145deg, #4a2a05 0%, #9b6414 48%, #e2b649 100%);
}

.power-formula-dialog :deep(.el-dialog) {
  border-radius: 22px;
  overflow: hidden;
  background:
    radial-gradient(circle at 88% 8%, rgba(232, 166, 160, 0.13), transparent 28%),
    linear-gradient(135deg, #fffdf8 0%, #f8f3ea 100%);
}

.power-formula-dialog :deep(.el-dialog__header) {
  padding: 1.25rem 1.35rem 0.5rem;
}

.power-formula-dialog :deep(.el-dialog__title) {
  color: #2d2924;
  font-weight: 850;
  letter-spacing: -0.02em;
}

.power-formula-dialog :deep(.el-dialog__body) {
  padding: 0.75rem 1.35rem 1.1rem;
}

.power-formula-dialog :deep(.el-dialog__footer) {
  padding: 0 1.35rem 1.25rem;
}

.power-formula-modal {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.power-formula-section {
  padding: 1rem;
  border: 1px solid rgba(111, 96, 78, 0.1);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.58);
}

.power-formula-section h4 {
  margin: 0.3rem 0 0.7rem;
  color: #2d2924;
  font-size: 1rem;
  font-weight: 850;
}

.power-formula-equation {
  margin: 0;
  padding: 0.8rem 0.9rem;
  border-radius: 14px;
  background: #2f3b35;
  color: #fffdf8;
  font-size: 0.86rem;
  line-height: 1.6;
  font-weight: 700;
}

.power-factor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.7rem;
  margin-top: 0.8rem;
}

.power-factor-item {
  padding: 0.75rem;
  border: 1px solid rgba(111, 96, 78, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.68);
}

.power-factor-item span {
  display: block;
  color: #9a8c7d;
  font-size: 0.72rem;
  font-weight: 850;
}

.power-factor-item strong {
  display: block;
  margin-top: 0.3rem;
  color: #3f382f;
  font-size: 0.78rem;
  line-height: 1.45;
}

.power-factor-note {
  display: block;
  margin-top: 0.35rem;
  color: #b0a494;
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.4;
}

.power-rank-preview-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.65rem;
}

.power-rank-preview-card {
  min-width: 0 !important;
  min-height: 7.2rem !important;
  padding: 0.75rem 0.45rem !important;
  border-radius: 18px !important;
  text-align: center;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.52),
    0 12px 24px rgba(77, 62, 45, 0.1) !important;
}

.power-rank-preview-card .power-hero-level-label {
  font-size: 0.62rem;
  letter-spacing: 0.06em;
}

.power-rank-preview-card .power-hero-level-value {
  font-size: 1.55rem;
}

.power-rank-preview-card.power-rank-demon-s .power-hero-level-value {
  font-size: 1.25rem;
}

.power-rank-preview-card .power-hero-level-desc {
  margin-top: 0.35rem;
  font-size: 0.66rem;
  letter-spacing: 0.04em;
}

@media (max-width: 768px) {
  .power-formula-dialog :deep(.el-dialog) {
    width: calc(100vw - 24px) !important;
  }

  .power-factor-grid {
    grid-template-columns: 1fr;
  }

  .power-rank-preview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .power-rank-preview-card:last-child {
    grid-column: 1 / -1;
  }
}

.dark-mode .power-formula-dialog :deep(.el-dialog) {
  background:
    radial-gradient(circle at 88% 8%, rgba(217, 135, 125, 0.14), transparent 28%),
    linear-gradient(135deg, rgba(29, 27, 23, 0.98), rgba(23, 25, 22, 0.98));
}

.dark-mode .power-formula-dialog :deep(.el-dialog__title),
.dark-mode .power-formula-section h4,
.dark-mode .power-factor-item strong {
  color: #f7f1e8;
}

.dark-mode .power-formula-section,
.dark-mode .power-factor-item {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.06);
}

.dark-mode .power-formula-equation {
  background: rgba(255, 255, 255, 0.08);
  color: #f7f1e8;
}

/* Competitive-rank emblem polish */
.pubg-card-power .power-hero-level,
.power-rank-preview-card {
  border: none !important;
  border-radius: 24px !important;
  background-color: #111827;
}

.pubg-card-power .power-hero-level::before,
.power-rank-preview-card::before {
  content: '';
  position: absolute;
  inset: 0.72rem 0.88rem 1.82rem;
  z-index: -1;
  clip-path: polygon(50% 0%, 88% 13%, 100% 48%, 78% 82%, 50% 100%, 22% 82%, 0% 48%, 12% 13%);
  border-radius: 18px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.86), rgba(255, 255, 255, 0.08) 40%, rgba(0, 0, 0, 0.22)),
    var(--rank-metal, linear-gradient(145deg, #cbd5e1, #64748b));
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.75),
    inset 0 -10px 18px rgba(0, 0, 0, 0.18),
    0 14px 24px rgba(0, 0, 0, 0.18);
}

.pubg-card-power .power-hero-level::after,
.power-rank-preview-card::after {
  content: '';
  position: absolute;
  inset: 1.18rem 1.34rem 2.24rem;
  z-index: -1;
  clip-path: polygon(50% 0%, 84% 15%, 96% 49%, 74% 78%, 50% 93%, 26% 78%, 4% 49%, 16% 15%);
  background:
    radial-gradient(circle at 50% 26%, rgba(255, 255, 255, 0.55), transparent 28%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.18), rgba(0, 0, 0, 0.2)),
    var(--rank-core, linear-gradient(145deg, #e2e8f0, #64748b));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 -8px 14px rgba(0, 0, 0, 0.18);
}

.pubg-card-power .power-hero-level-label,
.pubg-card-power .power-hero-level-value,
.pubg-card-power .power-hero-level-desc,
.power-rank-preview-card .power-hero-level-label,
.power-rank-preview-card .power-hero-level-value,
.power-rank-preview-card .power-hero-level-desc {
  z-index: 2;
}

.pubg-card-power .power-hero-level-label,
.power-rank-preview-card .power-hero-level-label {
  margin-top: 0.3rem;
  padding: 0.18rem 0.48rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.18);
  color: rgba(255, 255, 255, 0.88);
  text-shadow: none;
}

.pubg-card-power .power-hero-level-value,
.power-rank-preview-card .power-hero-level-value {
  color: #fff;
  font-family: Georgia, 'Times New Roman', serif;
  letter-spacing: -0.04em;
  text-shadow:
    0 2px 0 rgba(0, 0, 0, 0.22),
    0 8px 18px rgba(0, 0, 0, 0.2);
}

.pubg-card-power .power-hero-level-desc,
.power-rank-preview-card .power-hero-level-desc {
  padding: 0.22rem 0.62rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  color: var(--rank-text, #334155);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
}

.power-rank-empty,
.power-rank-e {
  --rank-metal: linear-gradient(145deg, #d7dde7 0%, #94a3b8 48%, #64748b 100%);
  --rank-core: linear-gradient(145deg, #f8fafc 0%, #cbd5e1 48%, #94a3b8 100%);
  --rank-text: #526071;
  background:
    radial-gradient(circle at 50% 24%, rgba(255, 255, 255, 0.42), transparent 28%),
    linear-gradient(180deg, #f8fafc 0%, #dce3ec 100%) !important;
  box-shadow: 0 16px 30px rgba(71, 85, 105, 0.18) !important;
}

.power-rank-d {
  --rank-metal: linear-gradient(145deg, #dce7ec 0%, #9fb4bf 48%, #647985 100%);
  --rank-core: linear-gradient(145deg, #f2fbfc 0%, #c7dce2 48%, #91aab5 100%);
  --rank-text: #4d6570;
  background:
    radial-gradient(circle at 50% 24%, rgba(255, 255, 255, 0.42), transparent 28%),
    linear-gradient(180deg, #edf7f9 0%, #d4e2e7 100%) !important;
  box-shadow: 0 16px 30px rgba(77, 101, 112, 0.18) !important;
}

.power-rank-c {
  --rank-metal: linear-gradient(145deg, #d9fff7 0%, #5fc7b9 45%, #17796e 100%);
  --rank-core: linear-gradient(145deg, #f4fffc 0%, #94e1d7 42%, #28a092 100%);
  --rank-text: #176f66;
  background:
    radial-gradient(circle at 50% 24%, rgba(217, 255, 247, 0.64), transparent 30%),
    linear-gradient(180deg, #e9fbf6 0%, #bfe9df 100%) !important;
  box-shadow:
    0 18px 34px rgba(28, 135, 124, 0.22),
    0 0 26px rgba(95, 199, 185, 0.14) !important;
}

.power-rank-b {
  --rank-metal: linear-gradient(145deg, #ecffd8 0%, #95cd54 45%, #3e7f2e 100%);
  --rank-core: linear-gradient(145deg, #fbfff2 0%, #c8e98b 42%, #66ad48 100%);
  --rank-text: #3d782f;
  background:
    radial-gradient(circle at 50% 24%, rgba(236, 255, 216, 0.66), transparent 30%),
    linear-gradient(180deg, #f2fae8 0%, #d6edbd 100%) !important;
  box-shadow:
    0 18px 36px rgba(81, 135, 50, 0.22),
    0 0 28px rgba(149, 205, 84, 0.16) !important;
}

.power-rank-a {
  --rank-metal: linear-gradient(145deg, #fff0ff 0%, #b39cff 42%, #6040b2 100%);
  --rank-core: linear-gradient(145deg, #fff8ff 0%, #d8c8ff 40%, #8868df 100%);
  --rank-text: #5b3aa0;
  background:
    radial-gradient(circle at 50% 22%, rgba(255, 240, 255, 0.72), transparent 30%),
    linear-gradient(180deg, #fbf4ff 0%, #e4d8ff 100%) !important;
  box-shadow:
    0 20px 40px rgba(103, 72, 174, 0.26),
    0 0 34px rgba(179, 156, 255, 0.2) !important;
}

.power-rank-s {
  --rank-metal: linear-gradient(145deg, #f0fbff 0%, #7ec6ff 36%, #2f6fe8 72%, #163f9e 100%);
  --rank-core: linear-gradient(145deg, #ffffff 0%, #b9e4ff 36%, #5f9df5 100%);
  --rank-text: #2356b8;
  background:
    radial-gradient(circle at 50% 20%, rgba(240, 251, 255, 0.78), transparent 30%),
    linear-gradient(180deg, #f1f8ff 0%, #cde6ff 100%) !important;
  box-shadow:
    0 22px 44px rgba(47, 111, 232, 0.3),
    0 0 42px rgba(126, 198, 255, 0.28) !important;
}

.power-rank-demon-s {
  --rank-metal: linear-gradient(145deg, #fff8d5 0%, #ffd66b 30%, #d49324 62%, #7d3c00 100%);
  --rank-core: linear-gradient(145deg, #fffdf0 0%, #ffe58b 34%, #e3a82e 100%);
  --rank-text: #7a4200;
  background:
    radial-gradient(circle at 50% 18%, rgba(255, 248, 213, 0.88), transparent 28%),
    radial-gradient(circle at 70% 26%, rgba(255, 226, 120, 0.5), transparent 24%),
    linear-gradient(180deg, #fff3c5 0%, #e8b64c 100%) !important;
  box-shadow:
    0 26px 52px rgba(176, 105, 15, 0.38),
    0 0 52px rgba(255, 214, 107, 0.36) !important;
}

.power-rank-demon-s .power-level-orbit::before {
  border-color: rgba(255, 255, 255, 0.55);
  box-shadow: 0 0 24px rgba(255, 214, 107, 0.38);
}

.power-rank-s .power-level-orbit::before {
  border-color: rgba(255, 255, 255, 0.48);
  box-shadow: 0 0 22px rgba(126, 198, 255, 0.3);
}

.power-rank-preview-card {
  min-height: 7.8rem !important;
}

.power-rank-preview-card::before {
  inset: 0.58rem 0.6rem 1.7rem;
}

.power-rank-preview-card::after {
  inset: 0.95rem 0.98rem 2.06rem;
}

.power-rank-preview-card .power-hero-level-desc {
  padding: 0.16rem 0.45rem;
}

/* CS2/Premier inspired rank plates: compact, readable, no forced single row */
.power-rank-empty,
.power-rank-e {
  --rank-accent: #9aa4b2;
  --rank-accent-2: #c6ccd5;
  --rank-glow: rgba(154, 164, 178, 0.22);
  --rank-bg: #202633;
}

.power-rank-d {
  --rank-accent: #63bdd1;
  --rank-accent-2: #bcecf5;
  --rank-glow: rgba(99, 189, 209, 0.24);
  --rank-bg: #162f3b;
}

.power-rank-c {
  --rank-accent: #4b8dff;
  --rank-accent-2: #a9cbff;
  --rank-glow: rgba(75, 141, 255, 0.28);
  --rank-bg: #14284c;
}

.power-rank-b {
  --rank-accent: #8f6bff;
  --rank-accent-2: #d3c4ff;
  --rank-glow: rgba(143, 107, 255, 0.3);
  --rank-bg: #281d4f;
}

.power-rank-a {
  --rank-accent: #d553a5;
  --rank-accent-2: #ffc0e4;
  --rank-glow: rgba(213, 83, 165, 0.32);
  --rank-bg: #401935;
}

.power-rank-s {
  --rank-accent: #e24d4d;
  --rank-accent-2: #ffc0b8;
  --rank-glow: rgba(226, 77, 77, 0.34);
  --rank-bg: #451c1f;
}

.power-rank-demon-s {
  --rank-accent: #f0b742;
  --rank-accent-2: #ffe39a;
  --rank-glow: rgba(240, 183, 66, 0.42);
  --rank-bg: #442b07;
}

.pubg-card-power .power-hero {
  grid-template-columns: minmax(0, 1fr) 176px !important;
  align-items: center !important;
  min-height: 0 !important;
  padding: 0.85rem !important;
  border-radius: 22px;
}

.pubg-card-power .power-hero-score {
  min-height: 8.25rem;
}

.pubg-card-power .power-hero-level {
  position: relative;
  isolation: isolate;
  display: grid !important;
  grid-template-rows: auto 1fr auto;
  align-items: center;
  justify-items: center;
  width: 176px;
  min-width: 176px !important;
  min-height: 8.25rem !important;
  padding: 0.8rem 0.7rem !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 16px !important;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.11), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--rank-bg) 86%, #ffffff 14%) 0%, var(--rank-bg) 100%) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.32),
    0 16px 34px var(--rank-glow) !important;
  overflow: hidden;
  transform: none !important;
}

.pubg-card-power .power-hero-level::before,
.pubg-card-power .power-hero-level::after,
.power-rank-preview-card::before,
.power-rank-preview-card::after {
  clip-path: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}

.pubg-card-power .power-hero-level::before,
.power-rank-preview-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  z-index: -1;
  height: 0.36rem;
  background: linear-gradient(90deg, var(--rank-accent), var(--rank-accent-2), var(--rank-accent));
}

.pubg-card-power .power-hero-level::after,
.power-rank-preview-card::after {
  content: '';
  position: absolute;
  z-index: -1;
  right: -2.6rem;
  top: 0.7rem;
  width: 7.6rem;
  height: 7.6rem;
  background:
    linear-gradient(135deg, transparent 0 44%, rgba(255, 255, 255, 0.11) 45% 54%, transparent 55%),
    radial-gradient(circle, var(--rank-glow), transparent 66%);
  transform: rotate(18deg);
}

.pubg-card-power .power-level-orbit,
.power-rank-preview-card .power-level-orbit {
  display: none !important;
}

.pubg-card-power .power-hero-level-label,
.power-rank-preview-card .power-hero-level-label {
  justify-self: stretch;
  margin: 0 !important;
  padding: 0.24rem 0.42rem !important;
  border-radius: 999px !important;
  background: rgba(0, 0, 0, 0.2) !important;
  color: rgba(255, 255, 255, 0.72) !important;
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  font-size: 0.62rem !important;
  font-weight: 800 !important;
  line-height: 1.1;
  text-align: center;
  letter-spacing: 0.08em !important;
}

.pubg-card-power .power-hero-level-value,
.power-rank-preview-card .power-hero-level-value {
  margin: 0.25rem 0 !important;
  color: #fff !important;
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  font-size: clamp(2.1rem, 4vw, 2.8rem) !important;
  font-weight: 950 !important;
  letter-spacing: -0.07em !important;
  line-height: 0.95 !important;
  text-shadow:
    0 1px 0 rgba(255, 255, 255, 0.16),
    0 8px 18px rgba(0, 0, 0, 0.34) !important;
}

.pubg-card-power .power-rank-demon-s .power-hero-level-value,
.power-rank-preview-card.power-rank-demon-s .power-hero-level-value {
  font-size: clamp(1.45rem, 3vw, 1.9rem) !important;
  letter-spacing: -0.08em !important;
}

.pubg-card-power .power-hero-level-desc,
.power-rank-preview-card .power-hero-level-desc {
  margin: 0 !important;
  padding: 0.28rem 0.62rem !important;
  border: 1px solid color-mix(in srgb, var(--rank-accent) 62%, transparent);
  border-radius: 999px !important;
  background: rgba(0, 0, 0, 0.22) !important;
  color: color-mix(in srgb, var(--rank-accent-2) 82%, #ffffff 18%) !important;
  box-shadow: none !important;
  font-size: 0.7rem !important;
  font-weight: 850 !important;
  letter-spacing: 0.06em !important;
  white-space: nowrap;
}

.power-rank-preview-grid {
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)) !important;
  align-items: stretch;
  gap: 0.75rem !important;
}

.power-rank-preview-card {
  position: relative;
  isolation: isolate;
  display: grid !important;
  grid-template-rows: auto 1fr auto;
  align-items: center;
  justify-items: center;
  min-width: 0 !important;
  min-height: 7.4rem !important;
  padding: 0.72rem 0.62rem !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 16px !important;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.11), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--rank-bg) 86%, #ffffff 14%) 0%, var(--rank-bg) 100%) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.32),
    0 12px 26px var(--rank-glow) !important;
  overflow: hidden;
}

.power-rank-preview-card .power-hero-level-value {
  font-size: 2rem !important;
}

.power-rank-preview-card.power-rank-demon-s .power-hero-level-value {
  font-size: 1.35rem !important;
}

@media (max-width: 768px) {
  .pubg-card-power .power-hero {
    grid-template-columns: 1fr !important;
  }

  .pubg-card-power .power-hero-score,
  .pubg-card-power .power-hero-level {
    width: 100%;
    min-width: 0 !important;
  }

  .power-rank-preview-grid {
    grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)) !important;
  }
}

/* Apple minimal sharp redesign (straight edges) */
.profile-container {
  padding: 1rem 0 2.5rem;
  background: #f5f5f7 !important;
}

.profile-container > .container {
  padding: 0 1rem;
}

.profile-layout {
  max-width: 1100px;
  gap: 0.9rem;
}

.profile-info-card,
.cup-history-card,
.pubg-card {
  border-radius: 0 !important;
  border: 1px solid #e5e5ea !important;
  background: #ffffff !important;
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.03) !important;
}

.profile-info-card::before,
.profile-info-card::after,
.pubg-card::before,
.pubg-card::after,
.cup-history-card::before,
.cup-history-card::after {
  display: none !important;
}

.profile-info-card :deep(.el-card__body),
.pubg-card :deep(.el-card__body),
.cup-history-card :deep(.el-card__body) {
  padding: 1rem !important;
}

.section-kicker,
.profile-kicker,
.profile-avatar-kicker {
  color: #8e8e93 !important;
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  font-weight: 700;
}

.section-kicker::before,
.profile-kicker::before,
.profile-avatar-kicker::before {
  display: none !important;
}

.profile-info {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  align-items: stretch;
  gap: 1rem;
}

.profile-info-avatar {
  border-right: 1px solid #f0f0f5 !important;
  border-bottom: none !important;
  border-radius: 0 !important;
  padding: 1rem 0.8rem;
  background: #fbfbfd;
}

.avatar {
  width: 120px !important;
  height: 120px !important;
  border-radius: 50% !important;
  border: 1px solid #e5e5ea !important;
  box-shadow: none !important;
  background: transparent !important;
}

.avatar-edit {
  border-radius: 50% !important;
  background: rgba(0, 0, 0, 0.52) !important;
}

.profile-avatar-hint {
  color: #8e8e93;
  font-size: 0.74rem;
}

.profile-info-content {
  padding: 0.5rem 0.4rem 0.5rem 0;
}

.user-details h2 {
  margin: 0.2rem 0 0.65rem;
  color: #1d1d1f;
  font-size: clamp(1.3rem, 2.3vw, 1.8rem);
  font-weight: 700;
  letter-spacing: -0.01em;
  text-align: left;
}

.user-meta-list {
  gap: 0.45rem;
}

.user-meta-list p {
  border-radius: 0 !important;
  border: 1px solid #ececf1 !important;
  background: #fafafd !important;
  color: #3a3a3c !important;
  padding: 0.35rem 0.5rem;
  box-shadow: none !important;
}

.meta-label {
  color: #8e8e93;
  font-weight: 600;
}

.user-meta-list strong {
  color: #1d1d1f;
  font-weight: 600;
}

.user-actions .el-button,
.hero-actions .el-button,
.hero-actions-compact .el-button {
  border-radius: 0 !important;
  font-weight: 600;
}

.user-actions .el-button--primary,
.hero-bind-form .el-button--primary,
.match-filters .el-button--primary {
  background: #1d1d1f !important;
  border-color: #1d1d1f !important;
  box-shadow: none !important;
}

.pubg-content {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.pubg-card-stats,
.pubg-card-matches,
.pubg-card-mastery {
  grid-column: 1 / -1;
}

.card-title-row,
.match-card-top,
.stats-card-head {
  margin-bottom: 0.65rem;
}

.pubg-card-title,
.cup-history-title {
  margin: 0.2rem 0 0.35rem;
  color: #1d1d1f;
  font-size: 1.02rem;
  font-weight: 700;
}

.card-subcopy,
.pubg-card-desc,
.power-subtitle,
.stats-kd-hint,
.match-filter-hint,
.cup-history-subtitle {
  color: #8e8e93 !important;
  font-size: 0.78rem;
  margin: 0 !important;
  line-height: 1.45;
}

.card-heading-stack {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.card-heading-stack .pubg-card-title,
.card-heading-stack .cup-history-title {
  margin: 0 !important;
}

.status-pill,
.platform-pill,
.match-count-pill {
  border-radius: 0 !important;
  border: 1px solid #dcdde3 !important;
  background: #f4f4f8 !important;
  color: #3a3a3c !important;
  box-shadow: none !important;
}

.status-pill-success {
  background: #edf7ee !important;
  border-color: #cde7cf !important;
  color: #2f6f34 !important;
}

.bind-meta,
.bind-meta-featured,
.hero-rebind,
.match-filters,
.power-metric-item,
.stats-kpi-item,
.cup-summary-item,
.match-item,
.match-item-detail,
.stats-empty,
.match-list-empty,
.power-formula-section,
.power-factor-item {
  border-radius: 0 !important;
  box-shadow: none !important;
}

.bind-meta,
.bind-meta-featured {
  border: 1px solid #ececf1;
  background: #fafafd !important;
}

.bind-meta-featured::after,
.power-hero::after,
.stats-kpi-item::before,
.cup-summary-item::after {
  display: none !important;
}

.bind-player-name {
  color: #1d1d1f;
  font-size: 1.2rem;
}

.bind-sync-note {
  color: #8e8e93;
}

.pubg-card-power .power-hero {
  grid-template-columns: minmax(0, 1fr) 170px !important;
  padding: 0.8rem !important;
  border-radius: 0 !important;
  border: 1px solid #ececf1;
  background: #fafafd !important;
}

.pubg-card-power .power-hero-score {
  border-radius: 0 !important;
  border: 1px solid #ececf1 !important;
  background: #ffffff !important;
  min-height: 8rem;
}

.pubg-card-power .power-score-label {
  color: #8e8e93 !important;
}

.pubg-card-power .power-score-num {
  color: #1d1d1f !important;
}

.pubg-card-power .power-score-caption {
  color: #8e8e93;
}

.pubg-card-power .power-hero-level {
  border-radius: 0 !important;
}

.power-metrics {
  gap: 0.5rem;
}

.power-metric-item {
  border: 1px solid #ececf1 !important;
  background: #fafafd !important;
}

.power-metric-label {
  color: #8e8e93 !important;
}

.power-metric-value {
  color: #1d1d1f !important;
}

.stats-type-toggle {
  border-radius: 0 !important;
  border: 1px solid #ececf1;
  background: #f6f6f9 !important;
}

.stats-type-toggle :deep(.el-button) {
  border-radius: 0 !important;
}

.stats-type-toggle :deep(.el-button--primary),
.stats-type-toggle :deep(.el-button--primary.is-plain) {
  background: #ffffff !important;
  box-shadow: none !important;
}

.stats-kpi-grid {
  gap: 0.5rem;
}

.stats-kpi-item {
  border: 1px solid #ececf1 !important;
  background: #fafafd !important;
  min-height: 4.5rem;
  padding: 0.7rem 0.75rem;
}

.stats-kpi-label {
  color: #8e8e93 !important;
  padding-left: 0 !important;
}

.stats-kpi-value {
  color: #1d1d1f !important;
  font-size: 1.35rem;
}

.stats-kpi-foot {
  color: #8e8e93 !important;
}

.match-filters {
  border: 1px solid #ececf1 !important;
  background: #fafafd !important;
  padding: 0.6rem;
}

.match-filters :deep(.el-input__wrapper),
.match-filters :deep(.el-select__wrapper) {
  border-radius: 0 !important;
  background: #fff !important;
  box-shadow: 0 0 0 1px #e5e5ea inset !important;
}

.match-item {
  border: 1px solid #ececf1 !important;
  background: #fff !important;
}

.match-item-main {
  padding: 0.75rem 0.8rem;
}

.match-item-rank {
  border-radius: 0 !important;
  background: #f2f2f7 !important;
  color: #3a3a3c !important;
}

.match-item-rank.top3 {
  background: #1d1d1f !important;
  color: #fff !important;
}

.match-item-map,
.match-member-col.stat {
  color: #1d1d1f !important;
}

.match-tag,
.match-metric {
  border-radius: 0 !important;
  border: 1px solid #ececf1 !important;
  background: #fafafd !important;
  color: #3a3a3c !important;
}

.match-item-detail {
  border-top: 1px solid #ececf1 !important;
  background: #fafafd !important;
}

.cup-summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
}

.cup-summary-item {
  border: 1px solid #ececf1 !important;
  background: #fafafd !important;
  padding: 0.7rem;
}

.cup-summary-value {
  color: #1d1d1f !important;
}

.cup-summary-label {
  color: #8e8e93 !important;
}

.cup-table-scroll {
  border-radius: 0 !important;
  border: 1px solid #ececf1;
}

.cup-table-scroll :deep(.el-table) {
  border-radius: 0 !important;
}

.cup-table-scroll :deep(.el-table th.el-table__cell) {
  background: #f7f7fa !important;
  color: #6b6b73 !important;
}

.cup-table-scroll :deep(.el-table td.el-table__cell) {
  color: #3a3a3c !important;
}

.power-formula-dialog :deep(.el-dialog),
.avatar-crop-dialog :deep(.el-dialog) {
  border-radius: 0 !important;
}

.power-formula-section {
  border: 1px solid #ececf1 !important;
  background: #fafafd !important;
}

.power-formula-equation {
  border-radius: 0 !important;
  background: #1d1d1f !important;
}

.power-rank-preview-grid {
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)) !important;
}

.power-rank-preview-card {
  border-radius: 0 !important;
}

@media (max-width: 900px) {
  .profile-info,
  .pubg-content {
    grid-template-columns: 1fr;
  }

  .profile-info-avatar {
    border-right: none !important;
    border-bottom: 1px solid #f0f0f5 !important;
  }

  .pubg-card-power .power-hero {
    grid-template-columns: 1fr !important;
  }

  .pubg-card-power .power-hero-level {
    width: 100% !important;
    min-width: 0 !important;
  }

  .cup-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .profile-container > .container {
    padding: 0 0.65rem;
  }

  .profile-info-card :deep(.el-card__body),
  .pubg-card :deep(.el-card__body),
  .cup-history-card :deep(.el-card__body) {
    padding: 0.8rem !important;
  }

  .avatar {
    width: 104px !important;
    height: 104px !important;
  }

  .card-title-row,
  .match-card-top {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .stats-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.dark-mode .profile-container {
  background: #0f0f10 !important;
}

.dark-mode .profile-info-card,
.dark-mode .pubg-card,
.dark-mode .cup-history-card {
  background: #1a1a1c !important;
  border-color: #2a2a2e !important;
}

.dark-mode .profile-info-avatar,
.dark-mode .bind-meta,
.dark-mode .bind-meta-featured,
.dark-mode .match-filters,
.dark-mode .power-metric-item,
.dark-mode .stats-kpi-item,
.dark-mode .cup-summary-item,
.dark-mode .match-item,
.dark-mode .match-item-detail,
.dark-mode .power-formula-section,
.dark-mode .power-factor-item {
  background: #202024 !important;
  border-color: #2f2f35 !important;
}

.dark-mode .pubg-card-title,
.dark-mode .cup-history-title,
.dark-mode .user-details h2,
.dark-mode .power-score-num,
.dark-mode .stats-kpi-value,
.dark-mode .cup-summary-value,
.dark-mode .match-item-map {
  color: #f5f5f7 !important;
}

.dark-mode .section-kicker,
.dark-mode .profile-kicker,
.dark-mode .profile-avatar-kicker,
.dark-mode .card-subcopy,
.dark-mode .pubg-card-desc,
.dark-mode .power-subtitle,
.dark-mode .stats-kd-hint,
.dark-mode .match-filter-hint,
.dark-mode .cup-history-subtitle,
.dark-mode .stats-kpi-label,
.dark-mode .stats-kpi-foot,
.dark-mode .meta-label,
.dark-mode .profile-avatar-hint {
  color: #9a9aa1 !important;
}

.dark-mode .status-pill,
.dark-mode .platform-pill,
.dark-mode .match-count-pill,
.dark-mode .user-meta-list p,
.dark-mode .match-tag,
.dark-mode .match-metric {
  background: #232328 !important;
  border-color: #303038 !important;
  color: #d7d7dc !important;
}

/* Bind card compact layout refinement */
.pubg-card-bind .panel-bind-info.panel-bind-info-compact {
  display: flex !important;
  flex-direction: column !important;
  align-items: stretch !important;
  gap: 0.65rem !important;
}

.pubg-card-bind .panel-bind-info.panel-bind-info-compact .bind-meta.bind-meta-featured {
  width: 100%;
  padding: 0.8rem 0.85rem !important;
  border: 1px solid #e5e5ea !important;
  background: #fafafd !important;
  min-height: 6.6rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.pubg-card-bind .panel-bind-info.panel-bind-info-compact .bind-meta-featured::after {
  display: none !important;
}

.pubg-card-bind .bind-meta-label {
  font-size: 0.69rem;
  letter-spacing: 0.07em;
}

.pubg-card-bind .bind-player-name {
  margin-top: 0.25rem;
  font-size: 1.1rem;
  line-height: 1.2;
  word-break: break-word;
}

.pubg-card-bind .bind-platform-line {
  margin-top: 0.55rem;
  gap: 0.45rem;
}

.pubg-card-bind .bind-action-row {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  gap: 0.45rem !important;
  width: 100%;
  margin-top: auto;
}

.pubg-card-bind .bind-action-row .el-button {
  margin: 0 !important;
  width: 100%;
  min-width: 0;
  padding: 0.5rem 0.35rem !important;
  font-size: 0.78rem;
}

.pubg-card-bind .hero-rebind {
  margin-top: 0.2rem;
  border: 1px solid #e5e5ea !important;
  background: #fafafd !important;
  padding: 0.75rem !important;
}

@media (max-width: 768px) {
  .pubg-card-bind .bind-action-row {
    grid-template-columns: 1fr !important;
  }

  .pubg-card-bind .bind-action-row .el-button {
    padding: 0.55rem 0.45rem !important;
  }
}

.dark-mode .pubg-card-bind .panel-bind-info.panel-bind-info-compact .bind-meta.bind-meta-featured,
.dark-mode .pubg-card-bind .hero-rebind {
  border-color: #2f2f35 !important;
  background: #202024 !important;
}

/* PUBG official fields oriented match card */
.pubg-card-matches .match-item-rank {
  width: 3.1rem;
  height: 3.1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
}

.pubg-card-matches .match-rank-num {
  line-height: 1;
  font-size: 0.86rem;
  font-weight: 800;
}

.pubg-card-matches .match-rank-label {
  font-size: 0.54rem;
  font-weight: 700;
  color: inherit;
  opacity: 0.78;
  letter-spacing: 0.04em;
}

.pubg-card-matches .match-item-row-sub {
  margin-top: 0.28rem;
}

.pubg-card-matches .match-item-row-meta {
  margin-top: 0.32rem;
  justify-content: flex-start;
  gap: 0.42rem;
  flex-wrap: wrap;
}

.pubg-card-matches .match-item-meta {
  display: inline-flex;
  align-items: center;
  padding: 0.12rem 0.42rem;
  border: 1px solid #ececf1;
  background: #fafafd;
  color: #6b6b73;
  font-size: 0.66rem;
  font-weight: 600;
  line-height: 1.3;
}

.pubg-card-matches .match-item-metrics {
  gap: 0.3rem;
}

.pubg-card-matches .match-metric {
  min-width: 3.35rem;
  justify-content: center;
}

.pubg-card-matches .match-metric em {
  margin-right: 0.2rem;
  font-size: 0.6rem;
  font-weight: 700;
}

@media (max-width: 480px) {
  .pubg-card-matches .match-item-row-meta {
    margin-top: 0.26rem;
    gap: 0.28rem;
  }

  .pubg-card-matches .match-item-meta {
    font-size: 0.62rem;
    padding: 0.1rem 0.35rem;
  }

  .pubg-card-matches .match-item-metrics {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}

.dark-mode .pubg-card-matches .match-item-meta {
  border-color: #303038;
  background: #232328;
  color: #b9b9bf;
}

/* Rank style redesign v3: cleaner tier plate */
.pubg-card-power .power-hero {
  grid-template-columns: minmax(0, 1fr) 182px !important;
  align-items: center !important;
}

.pubg-card-power .power-level-orbit {
  display: none !important;
}

.pubg-card-power .power-hero-level,
.power-rank-preview-card {
  position: relative;
  isolation: isolate;
  display: grid !important;
  grid-template-rows: auto 1fr auto;
  align-items: center;
  justify-items: center;
  overflow: hidden;
  border-radius: 0 !important;
  border: 1px solid color-mix(in srgb, var(--rank-accent-v3) 38%, #000 62%) !important;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--rank-base-v3) 90%, #fff 10%) 0%, var(--rank-base-v3) 100%) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    0 8px 18px color-mix(in srgb, var(--rank-accent-v3) 26%, transparent) !important;
}

.pubg-card-power .power-hero-level {
  width: 182px;
  min-width: 182px !important;
  min-height: 8rem !important;
  padding: 0.75rem 0.7rem !important;
}

.power-rank-preview-card {
  min-height: 7.2rem !important;
  padding: 0.66rem 0.58rem !important;
}

.pubg-card-power .power-hero-level::before,
.power-rank-preview-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 0.28rem;
  background: linear-gradient(90deg, var(--rank-accent-v3), var(--rank-soft-v3), var(--rank-accent-v3));
}

.pubg-card-power .power-hero-level::after,
.power-rank-preview-card::after {
  content: '';
  position: absolute;
  inset: auto -2.4rem -2.2rem auto;
  width: 6.2rem;
  height: 6.2rem;
  background: radial-gradient(circle, color-mix(in srgb, var(--rank-accent-v3) 28%, transparent), transparent 68%);
  border-radius: 50%;
}

.pubg-card-power .power-hero-level-label,
.power-rank-preview-card .power-hero-level-label {
  justify-self: stretch;
  margin: 0;
  padding: 0.18rem 0.42rem;
  border-radius: 0 !important;
  background: rgba(0, 0, 0, 0.2) !important;
  color: rgba(255, 255, 255, 0.75) !important;
  font-size: 0.62rem !important;
  letter-spacing: 0.08em !important;
  text-align: center;
}

.pubg-card-power .power-hero-level-value,
.power-rank-preview-card .power-hero-level-value {
  margin: 0.18rem 0 !important;
  color: #fff !important;
  font-size: clamp(2.1rem, 4vw, 2.7rem) !important;
  font-weight: 900 !important;
  letter-spacing: -0.06em !important;
  line-height: 0.95 !important;
  text-shadow: 0 8px 16px rgba(0, 0, 0, 0.32) !important;
}

.pubg-card-power .power-rank-demon-s .power-hero-level-value,
.power-rank-preview-card.power-rank-demon-s .power-hero-level-value {
  font-size: clamp(1.48rem, 3vw, 1.9rem) !important;
}

.pubg-card-power .power-hero-level-desc,
.power-rank-preview-card .power-hero-level-desc {
  margin: 0 !important;
  padding: 0.2rem 0.48rem !important;
  border-radius: 0 !important;
  border: 1px solid color-mix(in srgb, var(--rank-soft-v3) 45%, transparent) !important;
  background: rgba(0, 0, 0, 0.24) !important;
  color: color-mix(in srgb, var(--rank-soft-v3) 80%, #fff 20%) !important;
  font-size: 0.66rem !important;
  font-weight: 800 !important;
  letter-spacing: 0.05em !important;
  white-space: nowrap;
}

.pubg-card-power .power-rank-empty,
.pubg-card-power .power-rank-e,
.power-rank-preview-card.power-rank-empty,
.power-rank-preview-card.power-rank-e {
  --rank-base-v3: #24262b;
  --rank-accent-v3: #7f8590;
  --rank-soft-v3: #b0b5bf;
}

.pubg-card-power .power-rank-d,
.power-rank-preview-card.power-rank-d {
  --rank-base-v3: #20242b;
  --rank-accent-v3: #8f96a3;
  --rank-soft-v3: #bec4cf;
}

.pubg-card-power .power-rank-c,
.power-rank-preview-card.power-rank-c {
  --rank-base-v3: #1d222a;
  --rank-accent-v3: #9ea6b5;
  --rank-soft-v3: #c8ced8;
}

.pubg-card-power .power-rank-b,
.power-rank-preview-card.power-rank-b {
  --rank-base-v3: #1a2028;
  --rank-accent-v3: #afb8c8;
  --rank-soft-v3: #d2d8e2;
}

.pubg-card-power .power-rank-a,
.power-rank-preview-card.power-rank-a {
  --rank-base-v3: #171d25;
  --rank-accent-v3: #c0cad9;
  --rank-soft-v3: #dce2eb;
}

.pubg-card-power .power-rank-s,
.power-rank-preview-card.power-rank-s {
  --rank-base-v3: #141b22;
  --rank-accent-v3: #d3dce8;
  --rank-soft-v3: #edf1f6;
}

.pubg-card-power .power-rank-demon-s,
.power-rank-preview-card.power-rank-demon-s {
  --rank-base-v3: #10171e;
  --rank-accent-v3: #e9eef5;
  --rank-soft-v3: #ffffff;
}

.power-rank-preview-grid {
  grid-template-columns: repeat(auto-fit, minmax(126px, 1fr)) !important;
}

@media (max-width: 768px) {
  .pubg-card-power .power-hero {
    grid-template-columns: 1fr !important;
  }

  .pubg-card-power .power-hero-level {
    width: 100%;
    min-width: 0 !important;
  }
}

</style>