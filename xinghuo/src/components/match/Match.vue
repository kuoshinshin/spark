<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { matchApi, userApi } from '../../services/api'
import { useAuthStore } from '../../stores/auth'

const auth = useAuthStore()
const loading = ref(false)
const actionLoading = ref(false)
const leaveLoading = ref(false)
const powerRefreshLoading = ref(false)
const seasonTitle = ref('当前赛季火热报名中')
const registrationOpen = ref(false)
const currentMatch = ref(null)
const teams = ref([])
const rounds = ref([])
const leaderboard = ref([])
const roundsCompletedCount = ref(0)
const lastSyncedAt = ref('')
const eligibility = ref({
  canRegister: false,
  missing: [],
  userProfile: {
    playerName: '',
    powerScore: null,
  },
})

const myUserId = computed(() => Number(auth.userData?.id || 0))

/** 与后端一致：user_id 非空且 trim 后非空才算占坑（避免 '' 误判） */
const slotHasMember = (slot) => {
  if (!slot || slot.playerIndex == null) return false
  const u = slot.userId
  if (u == null) return false
  const s = String(u).trim()
  return s !== '' && s !== '0'
}

const slotLabelMap = {
  0: '队长',
  1: '队员1',
  2: '队员2',
  3: '队员3',
  4: '替补1',
}

const canKick = (team, slot) => {
  return Number(team.captainUserId || 0) === myUserId.value && slot.playerIndex !== 0 && slotHasMember(slot)
}

const isMyCaptainTeam = (team) => Number(team.captainUserId || 0) === myUserId.value
const isMySlot = (slot) => Number(slot.userId || 0) === myUserId.value
const getMySlotInTeam = (team) => (team?.slots || []).find((slot) => Number(slot.userId || 0) === myUserId.value) || null
const isSoloCaptainInTeam = (team) => {
  const mySlot = getMySlotInTeam(team)
  if (!mySlot || mySlot.playerIndex !== 0) return false
  return !(team?.slots || []).some((s) => s.playerIndex > 0 && s.playerIndex <= 4 && slotHasMember(s))
}

const getTeamHeadcount = (team) => {
  const regular = (team?.slots || []).filter((slot) => slot.playerIndex <= 3 && slotHasMember(slot)).length
  const substitute = (team?.slots || []).filter((slot) => slot.playerIndex >= 4 && slotHasMember(slot)).length
  return {
    regular,
    substitute,
    full: regular === 4 && substitute === 1,
  }
}

const myMembership = computed(() => teams.value.map((team) => ({
  team,
  slot: getMySlotInTeam(team),
})).find((entry) => entry.slot) || null)

/** 队长且 1–4 号位无其他成员时可解散退出 */
const isSoloCaptain = computed(() => {
  const m = myMembership.value
  if (!m || m.slot.playerIndex !== 0) return false
  return !(m.team?.slots || []).some((s) => s.playerIndex > 0 && s.playerIndex <= 4 && slotHasMember(s))
})

const canTransferCaptain = (team) => {
  if (!isMyCaptainTeam(team)) return false
  return (team?.slots || []).some((slot) => slot.playerIndex > 0 && slot.playerIndex <= 4 && slotHasMember(slot))
}

const getTeamTotalPower = (team) => {
  return (team?.slots || []).reduce((sum, slot) => {
    const v = Number(slot?.powerScore)
    return sum + (Number.isFinite(v) ? v : 0)
  }, 0)
}

const formatRoundStatus = (status) => {
  const s = String(status || '').toLowerCase()
  if (s === 'pending') return '待开始'
  if (s === 'live') return '进行中'
  if (s === 'completed') return '已锁定'
  if (s === 'void') return '已作废'
  return status || '—'
}

const leaderboardRowClassName = ({ row }) => {
  const tid = myMembership.value?.team?.id
  if (!tid || row?.matchTeamId == null) return ''
  return Number(row.matchTeamId) === Number(tid) ? 'is-my-team-row' : ''
}

const missingText = computed(() => {
  const missingSet = new Set(eligibility.value?.missing || [])
  const labels = []
  if (missingSet.has('pubgBinding')) labels.push('绑定游戏角色')
  if (missingSet.has('realName')) labels.push('姓名')
  if (missingSet.has('phone')) labels.push('电话')
  if (missingSet.has('address')) labels.push('地址')
  return labels.join('、')
})

const registrationStatusLabel = computed(() => (registrationOpen.value ? '报名进行中' : '只读模式'))
const matchStatus = ref('upcoming')
const currentPhase = computed(() => currentMatch.value?.phase || (registrationOpen.value ? 'registration' : 'draft'))
const phaseChipLabel = computed(() => {
  const p = currentPhase.value
  if (p === 'registration' && registrationOpen.value) return '报名进行中'
  if (p === 'registration' && !registrationOpen.value) return '报名未开放'
  if (p === 'frozen') return '名单已冻结'
  if (p === 'live') return '比赛进行中'
  if (p === 'completed') return '赛事已结束'
  if (p === 'archived') return '已归档'
  return registrationStatusLabel.value
})
const isRegistrationView = computed(() => currentPhase.value === 'registration' || registrationOpen.value)
const isFrozenView = computed(() => currentPhase.value === 'frozen')
const isLiveView = computed(() => currentPhase.value === 'live')
const isCompletedView = computed(() => currentPhase.value === 'completed')

const showTeamsGrid = computed(() => isRegistrationView.value || isFrozenView.value)

const stageIndex = computed(() => {
  if (['live', 'completed'].includes(currentPhase.value) || matchStatus.value === 'ongoing' || matchStatus.value === 'completed') return 2
  if (['frozen'].includes(currentPhase.value) || !registrationOpen.value) return 1
  return 0
})

let pollTimer = null
let registrationEventSource = null

const formatNow = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

const applyLobbyPayload = (lobby) => {
  seasonTitle.value = lobby?.seasonTitle || '当前赛季火热报名中'
  registrationOpen.value = Boolean(lobby?.registrationOpen)
  currentMatch.value = lobby?.currentMatch || null
  matchStatus.value = String(lobby?.currentMatch?.status || 'upcoming')
  teams.value = Array.isArray(lobby?.teams) ? lobby.teams : []
  lastSyncedAt.value = formatNow()
}

const loadLiveSnapshots = async () => {
  if (!currentMatch.value?.id || !['live', 'completed'].includes(currentPhase.value)) {
    rounds.value = []
    leaderboard.value = []
    roundsCompletedCount.value = 0
    return
  }
  const [roundResp, boardResp] = await Promise.all([
    matchApi.getRounds(currentMatch.value.id),
    matchApi.getLeaderboard(currentMatch.value.id),
  ])
  rounds.value = roundResp?.rounds || []
  leaderboard.value = boardResp?.teams || []
  roundsCompletedCount.value = Number(boardResp?.roundsCompleted ?? 0)
}

/** 战力走用户接口异步拉取，避免首屏与轮询被外部 API 拖慢 */
const refreshPowerScore = async (force = false) => {
  if (!eligibility.value?.canRegister) return
  if (eligibility.value?.missing?.includes?.('pubgBinding')) return
  if (powerRefreshLoading.value) return
  powerRefreshLoading.value = true
  try {
    const power = await userApi.getPubgPower(force)
    eligibility.value = {
      ...eligibility.value,
      userProfile: {
        ...eligibility.value.userProfile,
        powerScore: power?.score ?? null,
        powerTier: power?.tier ?? '',
      },
    }
    if (force) {
      ElMessage.success('战力已刷新')
    }
  } catch (error) {
    if (force) {
      ElMessage.error(error?.message || '刷新战力失败')
    }
  } finally {
    powerRefreshLoading.value = false
  }
}

const loadLobby = async ({ silent = false, teamsOnly = false } = {}) => {
  if (!silent) loading.value = true
  try {
    if (teamsOnly) {
      const lobby = await matchApi.getRegistrationLobby()
      applyLobbyPayload(lobby)
      await loadLiveSnapshots()
    } else {
      const [lobby, check] = await Promise.all([
        matchApi.getRegistrationLobby(),
        matchApi.getRegistrationEligibility(),
      ])
      applyLobbyPayload(lobby)
      eligibility.value = check || eligibility.value
      await loadLiveSnapshots()
      void refreshPowerScore()
    }
  } catch (error) {
    if (!silent) ElMessage.error(error.message || '加载报名大厅失败')
  } finally {
    if (!silent) loading.value = false
  }
}

const refreshTeamCard = async (teamId) => {
  if (!teamId) return
  const payload = await matchApi.getRegistrationTeam(teamId)
  const nextTeam = payload?.team
  if (!nextTeam) return
  const idx = teams.value.findIndex((item) => Number(item.id) === Number(teamId))
  if (idx >= 0) {
    teams.value.splice(idx, 1, nextTeam)
  } else {
    teams.value.push(nextTeam)
    teams.value.sort((a, b) => Number(a.teamNumber) - Number(b.teamNumber))
  }
  lastSyncedAt.value = formatNow()
}

const patchTeamFromResponse = (response) => {
  if (!response?.team?.id) return false
  const idx = teams.value.findIndex((item) => Number(item.id) === Number(response.team.id))
  if (idx >= 0) {
    teams.value.splice(idx, 1, response.team)
  } else {
    teams.value.push(response.team)
    teams.value.sort((a, b) => Number(a.teamNumber) - Number(b.teamNumber))
  }
  lastSyncedAt.value = formatNow()
  return true
}

const ensureCanRegister = () => {
  if (!registrationOpen.value) {
    ElMessage.warning('当前不在报名阶段')
    return false
  }
  if (!eligibility.value?.canRegister) {
    ElMessage.warning(`请先完善：${missingText.value || '个人资料'}`)
    return false
  }
  return true
}

const onTakeCaptain = async (team) => {
  if (!ensureCanRegister()) return
  actionLoading.value = true
  try {
    const response = await matchApi.claimCaptainSlot(team.id)
    ElMessage.success('已成为队长')
    if (!patchTeamFromResponse(response)) await loadLobby()
  } catch (error) {
    ElMessage.error(error.message || '操作失败')
  } finally {
    actionLoading.value = false
  }
}

const onJoinSlot = async (team, slot) => {
  if (!ensureCanRegister()) return
  actionLoading.value = true
  try {
    const response = await matchApi.joinRegistrationSlot(team.id, slot.playerIndex)
    ElMessage.success('加入成功，已带入你的游戏昵称和星火战力信息')
    if (!patchTeamFromResponse(response)) await loadLobby()
  } catch (error) {
    ElMessage.error(error.message || '加入失败')
  } finally {
    actionLoading.value = false
  }
}

const onKickSlot = async (team, slot) => {
  actionLoading.value = true
  try {
    const response = await matchApi.kickRegistrationMember(team.id, slot.playerIndex)
    ElMessage.success('已移除队员')
    if (!patchTeamFromResponse(response)) await loadLobby()
  } catch (error) {
    ElMessage.error(error.message || '移除失败')
  } finally {
    actionLoading.value = false
  }
}

const onEditTeamName = async (team) => {
  try {
    const { value } = await ElMessageBox.prompt('请输入新的队伍名称', '编辑队名', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValue: team.teamName || '',
      inputValidator: (val) => (String(val || '').trim() ? true : '队名不能为空'),
    })
    actionLoading.value = true
    const response = await matchApi.updateRegistrationTeamName(team.id, String(value || '').trim())
    ElMessage.success('队名更新成功')
    if (!patchTeamFromResponse(response)) await loadLobby()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error.message || '更新队名失败')
  } finally {
    actionLoading.value = false
  }
}

const onTransferCaptain = async (team) => {
  if (!registrationOpen.value) {
    ElMessage.warning('报名已截止，当前仅可查看')
    return
  }
  const options = (team?.slots || []).filter((slot) => slot.playerIndex > 0 && slotHasMember(slot))
  if (!options.length) {
    ElMessage.warning('暂无可转让对象，请先有队员加入')
    return
  }
  const tip = options.map((slot) => `${slot.playerIndex}: ${slot.name || '未命名'}`).join('\n')
  try {
    const { value } = await ElMessageBox.prompt(`输入目标位置编号（1-4）：\n${tip}`, '转让队长', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValidator: (val) => {
        const idx = Number(val)
        return options.some((slot) => slot.playerIndex === idx) ? true : '请输入有效的目标位置编号'
      },
    })
    actionLoading.value = true
    const response = await matchApi.transferRegistrationCaptain(team.id, Number(value))
    ElMessage.success('队长已转让')
    if (!patchTeamFromResponse(response)) await loadLobby()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error.message || '转让失败')
  } finally {
    actionLoading.value = false
  }
}

const onLeaveTeam = async (team) => {
  if (!registrationOpen.value) {
    ElMessage.warning('报名已截止，当前仅可查看')
    return
  }
  const mySlot = getMySlotInTeam(team)
  if (!mySlot) {
    ElMessage.warning('你当前不在任何队伍中')
    return
  }
  const isCaptain = mySlot.playerIndex === 0
  const soloCaptain = isSoloCaptainInTeam(team)
  if (isCaptain && !soloCaptain) {
    ElMessage.warning('你是队长且队内有其他成员，请先转让队长后再退出')
    return
  }
  if (soloCaptain) {
    try {
      await ElMessageBox.confirm(
        '当前队伍只有你一人，退出后将解散队伍（该队恢复为无人认领状态）。是否继续？',
        '解散并退出',
        { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消', lockScroll: false }
      )
    } catch {
      return
    }
  }
  actionLoading.value = true
  leaveLoading.value = true
  try {
    const response = await matchApi.leaveRegistrationTeam()
    ElMessage.success(soloCaptain ? '已解散并退出' : '已退出队伍')
    if (!patchTeamFromResponse(response)) await loadLobby()
  } catch (error) {
    ElMessage.error(error.message || '退出失败')
  } finally {
    leaveLoading.value = false
    actionLoading.value = false
  }
}

const startPolling = () => {
  if (pollTimer) clearInterval(pollTimer)
  // 已有 SSE 推送时，轮询只做兜底：只拉队伍列表、拉长间隔
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !actionLoading.value) {
      loadLobby({ silent: true, teamsOnly: true })
    }
  }, 12000)
}

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

const startRegistrationStream = () => {
  if (registrationEventSource) return
  const token = localStorage.getItem('token')
  if (!token) return
  const base = (() => {
    const u = import.meta.env.VITE_API_BASE_URL
    if (u) return String(u).replace(/\/$/, '')
    if (import.meta.env.DEV) return 'http://127.0.0.1:3000/api'
    return '/api'
  })()
  const streamUrl = `${base}/match/registration/stream?token=${encodeURIComponent(token)}`
  registrationEventSource = new EventSource(streamUrl)

  registrationEventSource.addEventListener('registration:update', async (event) => {
    if (actionLoading.value) return
    try {
      const payload = JSON.parse(event.data || '{}')
      const changedTeamId = Number(payload?.teamId || 0)
      if (changedTeamId > 0) {
        await refreshTeamCard(changedTeamId)
      } else {
        await loadLobby({ silent: true, teamsOnly: true })
      }
    } catch {
      await loadLobby({ silent: true, teamsOnly: true })
    }
  })

  registrationEventSource.onerror = () => {
    // 浏览器会自动重连；这里只做兜底，避免对象失效后不再监听
    if (registrationEventSource?.readyState === EventSource.CLOSED) {
      registrationEventSource = null
      setTimeout(() => startRegistrationStream(), 1500)
    }
  }
}

const stopRegistrationStream = () => {
  if (registrationEventSource) {
    registrationEventSource.close()
    registrationEventSource = null
  }
}

const onVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    loadLobby({ silent: true, teamsOnly: false })
  }
}

onMounted(async () => {
  await loadLobby()
  startPolling()
  startRegistrationStream()
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  stopPolling()
  stopRegistrationStream()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div class="match-page" v-loading="loading">
    <div class="container">
      <div class="header card">
        <div class="header-decor" aria-hidden="true"></div>
        <div class="header-top">
          <div>
            <h1 class="title">{{ seasonTitle }}</h1>
            <p class="sub-title">同一时间仅开放一个赛事，报名地图共 16 支队伍，每队 4 位正式队员 + 1 位替补。</p>
          </div>
          <div class="status-chip" :class="{ readonly: !registrationOpen && isRegistrationView }">
            <span class="dot"></span>
            {{ phaseChipLabel }}
          </div>
        </div>

        <div class="stage-track">
          <div class="stage-item" :class="{ active: stageIndex >= 0 }">
            <span class="stage-dot">1</span>
            <span class="stage-text">报名</span>
          </div>
          <div class="stage-line" :class="{ active: stageIndex >= 1 }"></div>
          <div class="stage-item" :class="{ active: stageIndex >= 1 }">
            <span class="stage-dot">2</span>
            <span class="stage-text">名单冻结</span>
          </div>
          <div class="stage-line" :class="{ active: stageIndex >= 2 }"></div>
          <div class="stage-item" :class="{ active: stageIndex >= 2 }">
            <span class="stage-dot">3</span>
            <span class="stage-text">正赛</span>
          </div>
        </div>

        <div class="header-meta-grid">
          <div class="meta-item">
            <span class="meta-label">当前角色</span>
            <span class="meta-value">{{ eligibility?.userProfile?.playerName || '未绑定角色' }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">星火战力</span>
            <span class="meta-value">{{ eligibility?.userProfile?.powerScore ?? '--' }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">同步机制</span>
            <span class="meta-value">SSE 推送 + 12 秒轮询兜底</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">最近同步</span>
            <span class="meta-value">{{ lastSyncedAt || '--:--:--' }}</span>
          </div>
        </div>

        <div class="header-actions">
          <el-button
            v-if="eligibility?.canRegister && !eligibility?.missing?.includes?.('pubgBinding')"
            class="action-btn"
            size="small"
            plain
            type="primary"
            :loading="powerRefreshLoading"
            @click="refreshPowerScore(true)"
          >
            <span class="btn-icon">↻</span>
            手动刷新战力
          </el-button>
        </div>

        <p v-if="isRegistrationView && !registrationOpen" class="warn">报名已截止（只读模式）：当前仅支持查看队伍编排，不可加入/编辑。</p>
        <p v-else-if="isRegistrationView && registrationOpen && !eligibility?.canRegister" class="warn">报名前需完善：{{ missingText || '个人资料' }}</p>
      </div>

      <div v-if="isFrozenView" class="phase-panel">
        <h2>名单已冻结</h2>
        <p>参赛名单已锁定，等待管理员开赛。以下为当前冻结后的队伍编排。</p>
      </div>

      <div v-if="isLiveView || isCompletedView" class="live-overview">
        <div class="phase-panel">
          <h2>{{ isCompletedView ? '最终积分榜' : '实时积分榜' }}</h2>
          <p>
            {{ isCompletedView ? '赛事已完成，以下为最终排名。' : '比赛进行中，积分榜仅统计已锁定局次。' }}
            <span v-if="roundsCompletedCount > 0" class="rounds-done">已锁定 {{ roundsCompletedCount }} 局</span>
          </p>
        </div>
        <el-table
          :data="leaderboard"
          border
          class="leaderboard-table"
          :row-class-name="leaderboardRowClassName"
        >
          <el-table-column prop="rank" label="排名" width="80" />
          <el-table-column prop="teamName" label="队伍" />
          <el-table-column prop="totalPoints" label="总分" width="90" />
          <el-table-column prop="kills" label="淘汰" width="90" />
          <el-table-column prop="placementPoints" label="排名分" width="90" />
          <el-table-column prop="killPoints" label="淘汰分" width="90" />
          <el-table-column prop="penaltyPoints" label="扣分" width="80" />
        </el-table>
        <div class="round-list">
          <h3>局次</h3>
          <div v-if="!rounds.length" class="empty-note">暂无局次</div>
          <div v-else class="round-chip-list">
            <span v-for="round in rounds" :key="round.id" class="round-chip" :class="'status-' + (round.status || '')">
              第 {{ round.round_no }} 局 · {{ round.map_name || '未指定地图' }} · {{ formatRoundStatus(round.status) }}
            </span>
          </div>
        </div>
      </div>

      <el-empty v-if="showTeamsGrid && !teams.length" description="当前暂无队伍数据" />
      <div v-else-if="isRegistrationView || isFrozenView" class="team-grid">
        <div
          v-for="team in teams"
          :key="team.id"
          class="team-card"
          :class="{
            readonlyCard: !registrationOpen,
            fullCard: getTeamHeadcount(team).full,
            myTeamCard: Number(team.captainUserId || 0) === myUserId
          }"
        >
          <div class="team-head">
            <div>
              <div class="team-title">#{{ team.teamNumber }} {{ team.teamName }}</div>
              <div class="team-stats">
                <span v-if="getTeamHeadcount(team).full" class="full-tag">满员</span>
              </div>
              <div class="team-power">队伍总星火值：{{ getTeamTotalPower(team) || 0 }}</div>
            </div>
            <div class="team-admin-actions">
              <el-tooltip v-if="isMyCaptainTeam(team)" content="编辑队名" placement="top">
                <el-button
                  class="mini-icon-btn"
                  size="small"
                  text
                  type="primary"
                  :disabled="!registrationOpen"
                  aria-label="编辑队名"
                  @click="onEditTeamName(team)"
                >
                  <span class="mini-icon" aria-hidden="true">✎</span>
                </el-button>
              </el-tooltip>
              <el-tooltip v-if="isMyCaptainTeam(team)" content="转让队长" placement="top">
                <el-button
                  class="mini-icon-btn transfer-btn"
                  size="small"
                  text
                  type="warning"
                  :disabled="!registrationOpen || !canTransferCaptain(team)"
                  aria-label="转让队长"
                  @click="onTransferCaptain(team)"
                >
                  <span class="mini-icon" aria-hidden="true">⇄</span>
                </el-button>
              </el-tooltip>
            </div>
          </div>
          <div class="slots">
            <div v-for="slot in team.slots" :key="`${team.id}-${slot.playerIndex}`" class="slot-row">
              <div class="slot-meta">
                <span class="slot-label">{{ slotLabelMap[slot.playerIndex] || `位置${slot.playerIndex}` }}</span>
                <span class="slot-name">
                  {{ slotHasMember(slot) ? (slot.name || '—') : '空位' }}
                  <span v-if="isMySlot(slot)" class="me-tag">我</span>
                </span>
                <span v-if="slotHasMember(slot)" class="slot-extra">
                  姓名：{{ slot.realName || '未填写' }} ｜星火：{{ slot.powerScore ?? '--' }}
                </span>
              </div>
              <div class="slot-actions">
                <el-button
                  v-if="!slotHasMember(slot) && slot.playerIndex === 0"
                  class="slot-captain-btn"
                  type="primary"
                  size="small"
                  :disabled="!registrationOpen"
                  @click="onTakeCaptain(team)"
                >
                  成为队长
                </el-button>
                <el-button
                  v-else-if="!slotHasMember(slot) && slot.playerIndex > 0"
                  class="slot-join-btn"
                  size="small"
                  :disabled="!registrationOpen"
                  @click="onJoinSlot(team, slot)"
                >
                  加入队伍
                </el-button>
                <div
                  v-else-if="canKick(team, slot) || isMySlot(slot)"
                  class="slot-actions-inner"
                >
                  <el-tooltip v-if="canKick(team, slot)" content="踢除队员" placement="top">
                    <el-button
                      class="mini-icon-btn"
                      type="danger"
                      size="small"
                      text
                      :disabled="!registrationOpen"
                      aria-label="踢除队员"
                      @click="onKickSlot(team, slot)"
                    >
                      <span class="mini-icon" aria-hidden="true">✕</span>
                    </el-button>
                  </el-tooltip>
                  <el-tooltip
                    v-if="isMySlot(slot)"
                    :content="isMyCaptainTeam(team) && isSoloCaptainInTeam(team) ? '解散并退出' : '主动退出'"
                    placement="top"
                  >
                    <el-button
                      class="mini-icon-btn leave-btn"
                      size="small"
                      text
                      type="danger"
                      :loading="leaveLoading"
                      :disabled="leaveLoading || !registrationOpen || (isMyCaptainTeam(team) && !isSoloCaptainInTeam(team))"
                      :aria-label="isMyCaptainTeam(team) && isSoloCaptainInTeam(team) ? '解散并退出' : '主动退出'"
                      @click="onLeaveTeam(team)"
                    >
                      <span class="mini-icon" aria-hidden="true">⎋</span>
                    </el-button>
                  </el-tooltip>
                </div>
                <span v-else class="readonly">--</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.match-page {
  min-height: calc(100vh - 160px);
  padding: 0 0 2rem;
  background: transparent;
}

.match-page > .container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 0.75rem;
  box-sizing: border-box;
}

.card {
  border: 1px solid #e6eaf2;
  border-radius: 16px;
  background: linear-gradient(145deg, #ffffff 0%, #fbfcff 100%);
  box-shadow: 0 10px 28px rgba(31, 45, 61, 0.06);
  padding: 1.1rem 1.2rem;
  margin-bottom: 1.1rem;
}

.header {
  position: relative;
  overflow: hidden;
}

.header-decor {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 8% 10%, rgba(37, 99, 235, 0.08), transparent 35%),
    radial-gradient(circle at 92% 8%, rgba(16, 185, 129, 0.08), transparent 32%),
    linear-gradient(to right, rgba(37, 99, 235, 0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(37, 99, 235, 0.04) 1px, transparent 1px);
  background-size: auto, auto, 24px 24px, 24px 24px;
}

.title {
  margin: 0;
  color: #1d1d1f;
  letter-spacing: -0.01em;
  position: relative;
  z-index: 1;
}

.sub-title {
  margin: 0.45rem 0 0;
  color: #778397;
  font-size: 0.9rem;
  position: relative;
  z-index: 1;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.8rem;
  position: relative;
  z-index: 1;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 999px;
  border: 1px solid #b7e4c7;
  background: #ecfdf3;
  color: #15803d;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.3rem 0.6rem;
}

.status-chip .dot {
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 50%;
  background: currentColor;
}

.status-chip.readonly {
  border-color: #fde68a;
  background: #fffbeb;
  color: #a16207;
}

.stage-track {
  margin-top: 0.8rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  position: relative;
  z-index: 1;
}

.stage-item {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: #94a3b8;
}

.stage-dot {
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  border: 1px solid #cfd8e6;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.68rem;
  font-weight: 700;
  background: #fff;
}

.stage-text {
  font-size: 0.75rem;
  font-weight: 600;
}

.stage-line {
  flex: 1;
  min-width: 1.1rem;
  height: 2px;
  background: #dbe4f2;
  border-radius: 999px;
}

.stage-item.active {
  color: #2563eb;
}

.stage-item.active .stage-dot {
  border-color: #2563eb;
  color: #2563eb;
}

.stage-line.active {
  background: #7aa8ff;
}

.header-meta-grid {
  margin-top: 0.85rem;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  position: relative;
  z-index: 1;
}

.meta-item {
  border: 1px solid #edf1f7;
  background: #ffffff;
  border-radius: 10px;
  padding: 0.5rem 0.55rem;
}

.meta-label {
  display: block;
  font-size: 0.72rem;
  color: #8a94a6;
}

.meta-value {
  display: block;
  margin-top: 0.18rem;
  font-size: 0.84rem;
  color: #243043;
  font-weight: 600;
}

.header-actions {
  margin-top: 0.65rem;
  display: flex;
  justify-content: flex-end;
  position: relative;
  z-index: 1;
}

.action-btn {
  min-height: 28px;
  border-radius: 8px;
  font-weight: 500;
}

.btn-icon {
  margin-right: 0.2rem;
  font-size: 0.8rem;
  line-height: 1;
}

.warn {
  margin: 0.65rem 0 0;
  color: #d97706;
  position: relative;
  z-index: 1;
}

.my-team-row {
  margin-top: 0.65rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  position: relative;
  z-index: 1;
}

.phase-panel {
  border: 1px solid #e6eaf2;
  border-radius: 14px;
  background: #ffffff;
  padding: 1rem;
  margin-bottom: 1rem;
  box-shadow: 0 6px 18px rgba(20, 35, 52, 0.04);
}

.phase-panel h2 {
  margin: 0;
  font-size: 1.1rem;
  color: #1f2d3d;
}

.phase-panel p {
  margin: 0.35rem 0 0;
  color: #7e8ba2;
  font-size: 0.88rem;
}

.rounds-done {
  margin-left: 0.45rem;
  color: #3d7eff;
  font-weight: 600;
}

.live-overview {
  display: grid;
  gap: 1rem;
}

.leaderboard-table {
  border-radius: 12px;
  overflow: hidden;
}

.leaderboard-table :deep(.el-table__body tr.is-my-team-row > td) {
  background: rgba(66, 132, 245, 0.08) !important;
}

.round-list {
  border: 1px solid #e6eaf2;
  border-radius: 14px;
  background: #fff;
  padding: 1rem;
}

.round-list h3 {
  margin: 0 0 0.7rem;
  font-size: 1rem;
  color: #1f2d3d;
}

.round-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.round-chip {
  border: 1px solid #dbe4f2;
  border-radius: 999px;
  padding: 0.25rem 0.55rem;
  font-size: 0.78rem;
  color: #536176;
  background: #f8fafc;
}

.round-chip.status-live {
  border-color: #f0c678;
  background: #fff8eb;
  color: #a26a00;
}

.round-chip.status-completed {
  border-color: #b3e0b3;
  background: #f0faf0;
  color: #2d6a2d;
}

.round-chip.status-void {
  border-color: #e0e0e0;
  background: #f5f5f5;
  color: #909399;
}

.empty-note {
  color: #9aa6b8;
  font-size: 0.86rem;
}

.team-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.85rem;
}

.team-card {
  border: 1px solid #e6ebf5;
  border-radius: 14px;
  padding: 0.8rem;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  box-shadow: 0 6px 18px rgba(20, 35, 52, 0.04);
}

.myTeamCard {
  border-color: #b7d2ff;
  box-shadow: 0 8px 22px rgba(66, 132, 245, 0.14);
}

.fullCard {
  border-color: #bfe5d0;
}

.team-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  gap: 0.5rem;
}

.team-title {
  font-size: 0.92rem;
  font-weight: 600;
  color: #1f2d3d;
  line-height: 1.2;
}

.team-stats {
  margin-top: 0.2rem;
  font-size: 0.77rem;
  color: #75839a;
}

.team-power {
  margin-top: 0.24rem;
  font-size: 0.76rem;
  color: #1f4ea3;
  font-weight: 600;
}

.full-tag {
  margin-left: 0.4rem;
  color: #15803d;
  background: #ecfdf3;
  border: 1px solid #b7e4c7;
  border-radius: 999px;
  padding: 0.08rem 0.38rem;
  font-size: 0.68rem;
  font-weight: 600;
}

.team-admin-actions {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.28rem;
}

.mini-icon-btn {
  min-width: 28px;
  width: 28px;
  height: 28px;
  padding: 0 !important;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mini-icon {
  font-size: 0.92rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mini-icon-btn :deep(.el-button__content) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  line-height: 1;
}

.transfer-btn {
  background: linear-gradient(180deg, #fffdf7 0%, #fff8e8 100%) !important;
  border: 1px solid #ead59a !important;
  color: #8d690d !important;
  box-shadow: 0 1px 2px rgba(141, 105, 13, 0.08);
}

.transfer-btn:hover:not(.is-disabled),
.transfer-btn:focus-visible:not(.is-disabled) {
  background: linear-gradient(180deg, #fff9eb 0%, #fff2d6 100%) !important;
  border-color: #ddc37e !important;
  color: #785708 !important;
  box-shadow: 0 2px 6px rgba(141, 105, 13, 0.14);
}

.leave-btn {
  background: linear-gradient(180deg, #fffafb 0%, #fff0f2 100%) !important;
  border: 1px solid #e8c2c7 !important;
  color: #b03a48 !important;
  box-shadow: 0 1px 2px rgba(176, 58, 72, 0.08);
}

.leave-btn:hover:not(.is-disabled),
.leave-btn:focus-visible:not(.is-disabled) {
  background: linear-gradient(180deg, #fff3f5 0%, #ffe5e9 100%) !important;
  border-color: #dca0a8 !important;
  color: #912e3b !important;
  box-shadow: 0 2px 6px rgba(176, 58, 72, 0.14);
}

.slot-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.28rem;
  flex-shrink: 0;
}

.slot-actions-inner {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.28rem;
  flex-wrap: wrap;
}

.slot-captain-btn,
.slot-join-btn {
  min-height: 28px;
  padding: 0 0.65rem;
  border-radius: 8px;
  font-size: 0.78rem;
  font-weight: 500;
}

.readonlyCard {
  opacity: 0.84;
  position: relative;
}

.readonlyCard::after {
  content: '只读';
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 0.7rem;
  color: #a16207;
  background: #fef3c7;
  border: 1px solid #fde68a;
  border-radius: 999px;
  padding: 0.1rem 0.4rem;
}

.slots {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.slot-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid #edf2f8;
  border-radius: 10px;
  padding: 0.48rem 0.52rem;
  min-height: 46px;
  background: #ffffff;
}

.slot-row:hover {
  border-color: #d9e4f3;
}

.slot-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.slot-label {
  font-size: 0.75rem;
  color: #8f9ab0;
}

.slot-name {
  font-size: 0.84rem;
  color: #243043;
  font-weight: 500;
}

.slot-extra {
  margin-top: 0.08rem;
  font-size: 0.72rem;
  color: #7e8ba2;
}

.me-tag {
  margin-left: 0.3rem;
  display: inline-block;
  background: #e0ecff;
  color: #2d5bd1;
  border-radius: 10px;
  font-size: 0.7rem;
  line-height: 1;
  padding: 0.15rem 0.35rem;
}

.readonly {
  color: #b0b8c4;
  font-size: 0.8rem;
}

@media (max-width: 900px) {
  .match-page > .container {
    padding: 0 0.5rem;
  }

  .header-meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .team-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .header-top {
    flex-direction: column;
    align-items: flex-start;
  }

  .stage-track {
    gap: 0.25rem;
  }

  .stage-text {
    font-size: 0.72rem;
  }

  .header-meta-grid {
    grid-template-columns: 1fr;
  }

  .header-actions {
    justify-content: flex-start;
  }

  .team-grid {
    grid-template-columns: 1fr;
  }
}
</style>
