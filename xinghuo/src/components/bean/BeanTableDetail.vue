<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { beanApi } from '../../services/api'
import { useAuthStore } from '../../stores/auth'
import { isMockDataEnabled } from '../../config/runtimeMode'
import { loadBeanTimelineFixture } from '../../mock'
import { mapTimelineRounds } from '../../mock/mapTimelineRounds'

const POLL_INTERVAL_MS = 10 * 60 * 1000

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const tableId = computed(() => Number(route.params.tableId))
const myUserId = computed(() => Number(auth.userData?.id || 0))

const loading = ref(false)
const sessionLoading = ref(false)
const syncing = ref(false)
const confirming = ref(false)
const manualEditVisible = ref(false)
const manualRows = ref([])
const manualRoundId = ref(null)
const guideOpen = ref(true)
let pollTimer = null

const table = ref(null)
const session = ref(null)
const timelineMock = ref(null)

const safePlayers = computed(() => table.value?.players || [])
const isOwner = computed(() => Number(table.value?.ownerUserId || 0) === myUserId.value)
const mySeat = computed(() => safePlayers.value.find((p) => Number(p.userId) === myUserId.value))
const mockDataEnabled = computed(() => isMockDataEnabled())
const showingMockTimeline = computed(() => (
  mockDataEnabled.value
  && !(session.value?.rounds || []).length
  && (timelineMock.value?.rounds || []).length > 0
))
const myGameId = computed(() => route.query.myPubgPlayerId || mySeat.value?.pubgPlayerId || '-')
const myGameName = computed(() => route.query.myPubgPlayerName || mySeat.value?.pubgPlayerName || '-')
const myGamePlatform = computed(() => route.query.myPubgPlatform || mySeat.value?.pubgPlatform || '-')

const hasUnboundPlayer = computed(() => safePlayers.value.some((p) => !p.pubgPlayerId || !p.pubgPlatform))
const playerCount = computed(() => safePlayers.value.length)
const roundCount = computed(() => {
  const real = Number(session.value?.roundCount || session.value?.rounds?.length || 0)
  if (real > 0) return real
  if (showingMockTimeline.value) return timelineMock.value.rounds.length
  return 0
})
const hasSession = computed(() => Boolean(session.value?.id))
const sessionSettled = computed(() => session.value?.status === 'settled')

const canStart = computed(() => (
  isOwner.value
  && table.value?.status === 'waiting'
  && playerCount.value === 4
  && !hasUnboundPlayer.value
))

const buttonStates = computed(() => ({
  join: {
    disabled: Boolean(mySeat.value) || table.value?.status !== 'waiting' || playerCount.value >= 4,
    reason: mySeat.value
      ? '已在桌内'
      : table.value?.status !== 'waiting'
        ? '当前不可加入'
        : playerCount.value >= 4
          ? '当前人数已满'
          : '',
  },
  leave: {
    disabled: !mySeat.value || table.value?.status !== 'waiting',
    reason: !mySeat.value
      ? '你未入座'
      : table.value?.status !== 'waiting'
        ? '对局进行中不可离桌'
        : '',
  },
  start: {
    disabled: !canStart.value,
    reason: !isOwner.value
      ? '仅桌主可操作'
      : table.value?.status !== 'waiting'
        ? '当前不可开局'
        : playerCount.value < 4
          ? `当前 ${playerCount.value}/4 人，无法开启比赛`
          : hasUnboundPlayer.value
            ? '有成员未绑定 PUBG 账号'
            : '',
  },
  transfer: {
    disabled: !isOwner.value,
    reason: '仅桌主可操作',
  },
  substitute: {
    disabled: !isOwner.value || table.value?.status !== 'playing' || !table.value?.softLocked,
    reason: !isOwner.value
      ? '仅桌主可操作'
      : table.value?.status !== 'playing' || !table.value?.softLocked
        ? '对局进行中且锁桌后才可替补'
        : '',
  },
  sync: {
    disabled: !hasSession.value || sessionSettled.value,
    reason: !hasSession.value ? '需先开局' : sessionSettled.value ? '会话已结束' : '',
  },
  manual: {
    disabled: !hasSession.value || roundCount.value < 1 || sessionSettled.value,
    reason: !hasSession.value
      ? '需先开局'
      : roundCount.value < 1
        ? '暂无可修正的对局'
        : sessionSettled.value
          ? '会话已结束'
          : '',
  },
  confirm: {
    disabled: !isOwner.value || !hasSession.value || roundCount.value < 1 || sessionSettled.value
      || !['preview', 'matched', 'started'].includes(session.value?.status),
    reason: !isOwner.value
      ? '仅桌主可操作'
      : roundCount.value < 1
        ? '至少完成一局结算后可确认'
        : sessionSettled.value
          ? '会话已结束'
          : !hasSession.value
            ? '需先开局'
            : '',
  },
}))

const statusTagType = (status) => {
  if (status === 'waiting') return 'info'
  if (status === 'playing') return 'warning'
  if (status === 'settling') return 'primary'
  return 'success'
}

const statusLabel = (status) => {
  if (status === 'waiting') return '待开局'
  if (status === 'playing') return '对局中'
  if (status === 'settling') return '结算中'
  if (status === 'settled') return '已结算'
  if (status === 'started') return '已开局'
  if (status === 'preview') return '待确认'
  if (status === 'matched') return '已匹配'
  if (status === 'failed') return '失败'
  return status || '未知'
}

const actionLabel = (action) => {
  const map = {
    auto_preview_ready: '自动预结算',
    manual_preview_ready: '手工预结算',
    round_auto_settled: '自动同步对局',
    settle_confirmed: '确认结算',
    settle_reopened: '重新开局',
    substitute: '替补调整',
    owner_transfer: '桌主移交',
    session_started: '开局',
    confirm: '确认结算',
  }
  return map[action] || action
}

const formatTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' })
}

const nextPollHint = computed(() => {
  if (!session.value?.lastPolledAt) return '即将自动同步'
  const next = new Date(session.value.lastPolledAt).getTime() + POLL_INTERVAL_MS
  return formatTime(next)
})

const loadTable = async () => {
  const data = await beanApi.getTable(tableId.value)
  table.value = data.table || null
}

const loadSession = async () => {
  if (!table.value?.currentSessionId) {
    session.value = null
    return
  }
  sessionLoading.value = true
  try {
    const data = await beanApi.getSession(table.value.currentSessionId)
    session.value = data.session || null
  } finally {
    sessionLoading.value = false
  }
}

const loadAll = async () => {
  loading.value = true
  try {
    await loadTable()
    await loadSession()
  } catch (error) {
    ElMessage.error(error.message || '加载桌子详情失败')
  } finally {
    loading.value = false
  }
}

const startGame = async () => {
  if (!table.value) return
  if (!canStart.value) {
    ElMessage.warning(buttonStates.value.start.reason || `当前 ${playerCount.value}/4 人，无法开启比赛`)
    return
  }
  try {
    await beanApi.startSession(table.value.id)
    ElMessage.success('已开局，系统将每 10 分钟自动同步四排战绩')
    await loadAll()
    startPollTimer()
    await syncMatches({ silent: true })
  } catch (error) {
    ElMessage.error(error.message || '开局失败')
  }
}

const join = async () => {
  if (buttonStates.value.join.disabled) return
  try {
    await beanApi.joinTable(tableId.value)
    ElMessage.success('加入成功')
    await loadAll()
  } catch (error) {
    ElMessage.error(error.message || '加入失败')
  }
}

const leave = async () => {
  if (buttonStates.value.leave.disabled) return
  try {
    await beanApi.leaveTable(tableId.value)
    ElMessage.success('已离桌')
    await loadAll()
  } catch (error) {
    ElMessage.error(error.message || '离桌失败')
  }
}

const syncMatches = async ({ silent = false } = {}) => {
  if (!session.value?.id || buttonStates.value.sync.disabled) return
  syncing.value = true
  try {
    const data = await beanApi.pollSession(session.value.id)
    session.value = data.session || session.value
    if (!silent) {
      if (data.newRounds > 0) {
        ElMessage.success(data.message || `已同步 ${data.newRounds} 局新对局`)
      } else {
        ElMessage.info(data.message || '暂无新的四排共同对局')
      }
    }
    await loadTable()
  } catch (error) {
    if (!silent) {
      ElMessage.warning(error.message || '同步暂不可用，请稍后重试')
    }
  } finally {
    syncing.value = false
  }
}

const confirmSettlement = async () => {
  if (!session.value || buttonStates.value.confirm.disabled) return
  confirming.value = true
  try {
    await beanApi.confirm(session.value.id)
    ElMessage.success('已确认结算')
    stopPollTimer()
    await loadAll()
  } catch (error) {
    ElMessage.error(error.message || '确认失败')
  } finally {
    confirming.value = false
  }
}

const transferOwner = async () => {
  if (!table.value || buttonStates.value.transfer.disabled) return
  try {
    const { value } = await ElMessageBox.prompt('请输入目标桌主用户 ID（必须在当前桌内）', '移交桌主', {
      confirmButtonText: '移交',
      cancelButtonText: '取消',
      inputPattern: /^[1-9]\d*$/,
      inputErrorMessage: '请输入有效用户 ID',
    })
    await beanApi.transferOwner(table.value.id, Number(value))
    ElMessage.success('桌主移交成功')
    await loadAll()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '桌主移交失败')
    }
  }
}

const openManualEdit = () => {
  if (buttonStates.value.manual.disabled) return
  const rounds = session.value?.rounds || []
  const latest = rounds[rounds.length - 1]
  if (!latest) return
  manualRoundId.value = latest.id
  const nameById = new Map((session.value?.players || []).map((p) => [Number(p.userId), p.displayName]))
  manualRows.value = (latest.players || []).map((p) => ({
    userId: p.userId,
    displayName: nameById.get(Number(p.userId)) || `玩家${p.userId}`,
    damage: Number(p.damage || 0),
    kills: Number(p.kills || 0),
    winPlace: Number(p.winPlace || 0),
  }))
  manualEditVisible.value = true
}

const submitManualEdit = async () => {
  if (!session.value || !manualRoundId.value) return
  try {
    await beanApi.updateManualPlayers(session.value.id, manualRows.value, manualRoundId.value)
    manualEditVisible.value = false
    ElMessage.success('手工修正已更新并重算累计')
    await loadAll()
  } catch (error) {
    ElMessage.error(error.message || '手工修正失败')
  }
}

const openSubstitutePrompt = async () => {
  if (!table.value || buttonStates.value.substitute.disabled) return
  try {
    const seatPrompt = await ElMessageBox.prompt('替补座位号（1-4）', '替补操作', {
      confirmButtonText: '下一步',
      cancelButtonText: '取消',
      inputPattern: /^[1-4]$/,
      inputErrorMessage: '请输入 1-4',
    })
    const userPrompt = await ElMessageBox.prompt('替补用户 ID', '替补操作', {
      confirmButtonText: '执行替补',
      cancelButtonText: '取消',
      inputPattern: /^[1-9]\d*$/,
      inputErrorMessage: '请输入有效用户 ID',
    })
    await beanApi.substitute(table.value.id, {
      seatNo: Number(seatPrompt.value),
      newUserId: Number(userPrompt.value),
    })
    ElMessage.success('替补成功')
    await loadAll()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '替补失败')
    }
  }
}

const scoreRows = computed(() => {
  const source = session.value?.players?.length ? session.value.players : safePlayers.value
  return [...source]
    .map((p) => ({
      userId: p.userId,
      seatNo: p.seatNo,
      displayName: p.displayName || p.realName || p.username || `玩家${p.seatNo}`,
      pubgPlayerName: p.pubgPlayerName || '-',
      kills: Number(p.kills || 0),
      damage: Number(p.damage || 0),
      netBeans: Number(p.netBeans || 0),
      lastTail: p.tail ?? '-',
      avatar: p.avatar || '',
    }))
    .sort((a, b) => Number(b.netBeans || 0) - Number(a.netBeans || 0))
})

const timelineRounds = computed(() => {
  const realRounds = session.value?.rounds || []
  if (realRounds.length) {
    return mapTimelineRounds(realRounds, session.value?.players || [])
  }
  if (showingMockTimeline.value) {
    return mapTimelineRounds(timelineMock.value.rounds, timelineMock.value.players)
  }
  return []
})

const timelineStartedAt = computed(() => {
  if (session.value?.startedAt) return session.value.startedAt
  if (showingMockTimeline.value) return timelineMock.value?.startedAt
  return null
})

const rollRows = computed(() => {
  const logs = session.value?.logs || []
  return logs
    .filter((log) => log.action.includes('roll') || log.detail?.rollPoints)
    .flatMap((log) => {
      if (Array.isArray(log.detail?.rollPoints)) {
        return log.detail.rollPoints.map((item) => ({
          roundNo: item.roundNo || '-',
          player: item.player || '-',
          point: item.point ?? '-',
          result: item.result || '-',
        }))
      }
      return [{
        roundNo: '-',
        player: log.operatorName || '-',
        point: '-',
        result: actionLabel(log.action),
      }]
    })
})

const logRows = computed(() => session.value?.logs || [])

const totalKills = computed(() => scoreRows.value.reduce((sum, row) => sum + Number(row.kills || 0), 0))
const totalBeans = computed(() => scoreRows.value.reduce((sum, row) => sum + Number(row.netBeans || 0), 0))

const beanClass = (value) => {
  const n = Number(value || 0)
  if (n > 0) return 'bean-positive'
  if (n < 0) return 'bean-negative'
  return 'bean-zero'
}

const currentStep = computed(() => {
  if (!table.value) return 0
  if (table.value.status === 'waiting') return playerCount.value < 4 ? 1 : 2
  if (table.value.status === 'playing' && roundCount.value < 1) return 3
  if (roundCount.value > 0 && !sessionSettled.value) return 4
  if (sessionSettled.value) return 5
  return 3
})

const startPollTimer = () => {
  stopPollTimer()
  if (!session.value?.id || sessionSettled.value) return
  pollTimer = setInterval(() => {
    syncMatches({ silent: true })
  }, POLL_INTERVAL_MS)
}

const stopPollTimer = () => {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

onMounted(async () => {
  if (isMockDataEnabled()) {
    timelineMock.value = await loadBeanTimelineFixture()
  }
  await loadAll()
  if (session.value?.id && !sessionSettled.value) {
    await syncMatches({ silent: true })
    startPollTimer()
  }
})

onUnmounted(() => {
  stopPollTimer()
})
</script>

<template>
  <div class="bean-detail-page">
    <div class="detail-head">
      <div class="head-main">
        <el-button link type="primary" @click="router.push({ name: 'beanLobby' })">← 返回大厅</el-button>
        <div class="head-title-row">
          <h2>{{ table?.tableName || `豆子桌 #${tableId}` }}</h2>
          <el-tag v-if="table" :type="statusTagType(table.status)">{{ statusLabel(table.status) }}</el-tag>
        </div>
        <p class="subtitle">
          桌主：{{ table?.ownerName || '暂无' }} · 人数 {{ safePlayers.length }}/4
          <span v-if="table?.currentSessionId"> · 会话 #{{ table.currentSessionId }}</span>
        </p>
      </div>
      <div class="head-actions">
        <el-button :loading="loading || sessionLoading" @click="loadAll">刷新</el-button>
      </div>
    </div>

    <el-skeleton :loading="loading" animated>
      <template #template>
        <el-skeleton-item variant="rect" style="height: 120px; margin-bottom: 12px" />
      </template>
      <template #default>
        <div v-if="!table" class="empty-box">桌子不存在或已关闭</div>
        <template v-else>
          <section class="guide-panel">
            <div class="guide-head" @click="guideOpen = !guideOpen">
              <strong>使用教程 · 怎么开始游戏</strong>
              <span class="guide-toggle">{{ guideOpen ? '收起' : '展开' }}</span>
            </div>
            <div v-show="guideOpen" class="guide-body">
              <div class="guide-steps">
                <div class="guide-step" :class="{ active: currentStep >= 1, done: currentStep > 1 }">
                  <span class="step-no">1</span>
                  <div>
                    <strong>入座</strong>
                    <p>回到大厅，点击空座位加入本桌。第一个入座的人自动成为桌主。</p>
                  </div>
                </div>
                <div class="guide-step" :class="{ active: currentStep >= 2, done: currentStep > 2 }">
                  <span class="step-no">2</span>
                  <div>
                    <strong>满员开局</strong>
                    <p>4 人到齐后桌主点「桌主开局」。未满 4 人时按钮可见但不可点。</p>
                  </div>
                </div>
                <div class="guide-step" :class="{ active: currentStep >= 3, done: currentStep > 3 }">
                  <span class="step-no">3</span>
                  <div>
                    <strong>打四排</strong>
                    <p>大家一起去 PUBG 打四排（竞技四排或匹配四排均可）。</p>
                  </div>
                </div>
                <div class="guide-step" :class="{ active: currentStep >= 4, done: currentStep > 4 }">
                  <span class="step-no">4</span>
                  <div>
                    <strong>自动同步</strong>
                    <p>系统每 10 分钟自动同步战绩，也可点「立即同步」。时间线会累计展示各局。</p>
                  </div>
                </div>
                <div class="guide-step" :class="{ active: currentStep >= 5 }">
                  <span class="step-no">5</span>
                  <div>
                    <strong>确认结算</strong>
                    <p>全部打完后桌主点「确认结算」结束本场。有异常可用「手工修正」。</p>
                  </div>
                </div>
              </div>
              <div class="guide-rules">
                <strong>规则速记</strong>
                <ul>
                  <li>分组看伤害尾数（0 当 10），每局动态分组，不固定队伍。</li>
                  <li>豆子 = 两队击杀差；吃鸡队豆子 ×2。</li>
                  <li>3/4 人尾数相同需 roll 点，记录会显示在下方。</li>
                </ul>
              </div>
            </div>
          </section>

          <div class="kpi-grid">
            <div class="kpi-card">
              <div class="kpi-label">我的游戏 ID</div>
              <div class="kpi-value kpi-value-sm">{{ myGameId }}</div>
              <div class="kpi-sub">{{ myGameName }} · {{ myGamePlatform }}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">总击杀</div>
              <div class="kpi-value">{{ totalKills }}</div>
              <div class="kpi-sub">当前会话累计</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">总豆子净值</div>
              <div class="kpi-value" :class="beanClass(totalBeans)">{{ totalBeans > 0 ? `+${totalBeans}` : totalBeans }}</div>
              <div class="kpi-sub">零和局，理论接近 0</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">同步状态</div>
              <div class="kpi-value kpi-value-sm">{{ roundCount }} 局</div>
              <div class="kpi-sub">
                <template v-if="session?.lastPolledAt">
                  上次 {{ formatTime(session.lastPolledAt) }} · 下次约 {{ nextPollHint }}
                </template>
                <template v-else>尚未同步</template>
              </div>
            </div>
          </div>

          <div class="action-bar">
            <div class="action-group">
              <span class="action-label">入座</span>
              <el-tooltip :content="buttonStates.join.reason" :disabled="!buttonStates.join.disabled">
                <el-button size="small" type="primary" :disabled="buttonStates.join.disabled" @click="join">加入桌子</el-button>
              </el-tooltip>
              <el-tooltip :content="buttonStates.leave.reason" :disabled="!buttonStates.leave.disabled">
                <el-button size="small" type="danger" plain :disabled="buttonStates.leave.disabled" @click="leave">离开桌子</el-button>
              </el-tooltip>
              <el-tooltip :content="buttonStates.start.reason" :disabled="!buttonStates.start.disabled">
                <el-button size="small" type="primary" :disabled="buttonStates.start.disabled" @click="startGame">桌主开局</el-button>
              </el-tooltip>
            </div>
            <div class="action-group">
              <span class="action-label">桌主</span>
              <el-tooltip :content="buttonStates.transfer.reason" :disabled="!buttonStates.transfer.disabled">
                <el-button size="small" :disabled="buttonStates.transfer.disabled" @click="transferOwner">移交桌主</el-button>
              </el-tooltip>
              <el-tooltip :content="buttonStates.substitute.reason" :disabled="!buttonStates.substitute.disabled">
                <el-button size="small" :disabled="buttonStates.substitute.disabled" @click="openSubstitutePrompt">替补</el-button>
              </el-tooltip>
            </div>
            <div class="action-group">
              <span class="action-label">结算</span>
              <el-tooltip :content="buttonStates.sync.reason" :disabled="!buttonStates.sync.disabled">
                <el-button size="small" :loading="syncing" :disabled="buttonStates.sync.disabled" @click="syncMatches()">立即同步</el-button>
              </el-tooltip>
              <el-tooltip :content="buttonStates.manual.reason" :disabled="!buttonStates.manual.disabled">
                <el-button size="small" :disabled="buttonStates.manual.disabled" @click="openManualEdit">手工修正</el-button>
              </el-tooltip>
              <el-tooltip :content="buttonStates.confirm.reason" :disabled="!buttonStates.confirm.disabled">
                <el-button
                  size="small"
                  type="success"
                  :disabled="buttonStates.confirm.disabled"
                  :loading="confirming"
                  @click="confirmSettlement"
                >
                  确认结算
                </el-button>
              </el-tooltip>
            </div>
          </div>

          <section class="section-card">
            <div class="section-title">成员计分板</div>
            <div v-if="!scoreRows.length" class="empty-box small">暂无成员数据，请先在大厅入座</div>
            <div v-else class="scoreboard-grid">
              <div v-for="row in scoreRows" :key="row.userId || row.seatNo" class="score-card">
                <div class="score-top">
                  <el-avatar :size="44" :src="row.avatar">{{ row.displayName.slice(0, 1) }}</el-avatar>
                  <div class="score-meta">
                    <strong>{{ row.displayName }}</strong>
                    <span>座位 {{ row.seatNo }} · {{ row.pubgPlayerName }}</span>
                  </div>
                </div>
                <div class="score-stats">
                  <div class="stat-item">
                    <span class="stat-label">累计豆子</span>
                    <span class="stat-value" :class="beanClass(row.netBeans)">{{ row.netBeans > 0 ? `+${row.netBeans}` : row.netBeans }}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">累计击杀</span>
                    <span class="stat-value">{{ row.kills }}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">累计伤害</span>
                    <span class="stat-value">{{ row.damage }}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">最近尾数</span>
                    <span class="stat-value tail-value">{{ row.lastTail }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="section-card">
            <div class="timeline-head">
              <div class="section-title">对局时间线</div>
              <div class="timeline-head-right">
                <el-tag v-if="showingMockTimeline" size="small" type="warning">测试数据预览</el-tag>
                <span v-if="roundCount" class="timeline-meta">共 {{ roundCount }} 局 · 累计豆子已更新</span>
              </div>
            </div>
            <div v-if="timelineRounds.length" class="timeline">
              <div v-for="(round, index) in timelineRounds" :key="round.id" class="timeline-item">
                <div class="timeline-axis">
                  <span class="timeline-dot" :class="{ latest: index === 0 }" />
                  <span v-if="index < timelineRounds.length - 1" class="timeline-line" />
                </div>
                <div class="timeline-content">
                  <div class="timeline-item-head">
                    <strong>第 {{ round.roundNo }} 局</strong>
                    <span class="timeline-time">{{ formatTime(round.matchCreatedAt) }}</span>
                    <el-tag size="small" type="info">{{ round.matchTypeLabel }}</el-tag>
                  </div>
                  <p class="timeline-row">地图：{{ round.mapName }} · Match #{{ round.matchId }}</p>
                  <p class="timeline-row">尾数：{{ round.tails }}</p>
                  <p class="timeline-row">分组：{{ round.grouping }}</p>
                  <div v-if="round.playerStats?.length" class="round-stats-grid">
                    <div
                      v-for="stat in round.playerStats"
                      :key="`${round.id}-stat-${stat.userId}`"
                      class="round-stat-chip"
                    >
                      <strong>{{ stat.name }}</strong>
                      <span>伤害 {{ stat.damage }} · 击杀 {{ stat.kills }} · 尾数 {{ stat.tail }}</span>
                    </div>
                  </div>
                  <div v-if="round.needsRandom && round.rollPoints?.length" class="round-roll-box">
                    <div class="roll-label">同分 Roll 点</div>
                    <div class="roll-items">
                      <span
                        v-for="(roll, rollIdx) in round.rollPoints"
                        :key="`${round.id}-roll-${rollIdx}`"
                        class="roll-chip"
                      >
                        {{ roll.player }}：{{ roll.point }} 点（{{ roll.result }}）
                      </span>
                    </div>
                  </div>
                  <p class="timeline-row">
                    击杀：{{ round.killsA }} : {{ round.killsB }}
                    → <span class="bean-delta">{{ round.beanDelta }}</span>
                    <span class="timeline-note">（{{ round.note }}）</span>
                  </p>
                  <div class="round-beans">
                    <span
                      v-for="item in round.beanItems"
                      :key="`${round.id}-${item.name}`"
                      class="round-bean-chip"
                      :class="beanClass(item.netBeans)"
                    >
                      {{ item.name }} {{ item.netBeans > 0 ? `+${item.netBeans}` : item.netBeans }}
                    </span>
                  </div>
                </div>
              </div>
              <div v-if="timelineStartedAt" class="timeline-anchor">
                会话开局 {{ formatTime(timelineStartedAt) }}
              </div>
            </div>
            <div v-else class="empty-box small">
              暂无对局记录。开局后系统每 10 分钟自动同步四排战绩，也可点击「立即同步」。
            </div>
          </section>

          <section class="section-card">
            <div class="section-title">同分 Roll 点记录</div>
            <el-table v-if="rollRows.length" :data="rollRows" border size="small" class="data-table">
              <el-table-column prop="roundNo" label="局数" width="72" />
              <el-table-column prop="player" label="成员" min-width="120" />
              <el-table-column prop="point" label="点数" width="80" />
              <el-table-column prop="result" label="结果" min-width="140" />
            </el-table>
            <div v-else class="empty-box small">当前暂无 roll 点记录</div>
          </section>

          <section class="section-card">
            <div class="section-title">结算操作记录</div>
            <el-table v-if="logRows.length" :data="logRows" border size="small" class="data-table">
              <el-table-column prop="id" label="ID" width="72" />
              <el-table-column prop="action" label="动作" width="130">
                <template #default="{ row }">{{ actionLabel(row.action) }}</template>
              </el-table-column>
              <el-table-column prop="operatorName" label="操作人" width="120" />
              <el-table-column prop="createdAt" label="时间" min-width="160" />
            </el-table>
            <div v-else class="empty-box small">暂无操作记录</div>
          </section>
        </template>
      </template>
    </el-skeleton>

    <el-dialog v-model="manualEditVisible" title="手工修正后重算（当前最新一局）" width="760px">
      <el-table :data="manualRows" border size="small">
        <el-table-column prop="displayName" label="成员" />
        <el-table-column label="伤害">
          <template #default="{ row }">
            <el-input-number v-model="row.damage" :min="0" :step="1" />
          </template>
        </el-table-column>
        <el-table-column label="击杀">
          <template #default="{ row }">
            <el-input-number v-model="row.kills" :min="0" :step="1" />
          </template>
        </el-table-column>
        <el-table-column label="名次">
          <template #default="{ row }">
            <el-input-number v-model="row.winPlace" :min="1" :max="100" :step="1" />
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="manualEditVisible = false">取消</el-button>
        <el-button type="primary" @click="submitManualEdit">保存并重算</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.bean-detail-page {
  padding: 0 1rem 1.5rem;
  background: linear-gradient(180deg, #eef4ff 0%, #f7f9ff 100%);
  min-height: 100%;
}

.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  background: linear-gradient(120deg, #2f5fe6 0%, #5f7dff 55%, #7b67ff 100%);
  border-radius: 14px;
  padding: 0.85rem 1rem;
  margin-bottom: 1rem;
  color: #fff;
  box-shadow: 0 10px 22px rgba(56, 86, 201, 0.2);
}

.head-main h2 { margin: 0.2rem 0 0; font-size: 1.25rem; color: #fff; }
.head-title-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.subtitle { margin: 0.25rem 0 0; color: rgba(255, 255, 255, 0.9); font-size: 0.84rem; }
.head-actions { display: flex; align-items: center; gap: 0.6rem; }

.guide-panel {
  background: #fff;
  border: 1px solid #dbe5ff;
  border-radius: 12px;
  margin-bottom: 0.9rem;
  overflow: hidden;
}

.guide-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.7rem 0.9rem;
  background: #f7faff;
  cursor: pointer;
  user-select: none;
}

.guide-toggle { color: #5b6b8f; font-size: 0.82rem; }
.guide-body { padding: 0.75rem 0.9rem 0.9rem; }

.guide-steps {
  display: grid;
  grid-template-columns: repeat(5, minmax(140px, 1fr));
  gap: 0.6rem;
  margin-bottom: 0.75rem;
}

.guide-step {
  border: 1px solid #e2e8f7;
  border-radius: 10px;
  padding: 0.55rem 0.6rem;
  display: flex;
  gap: 0.45rem;
  background: #fafbff;
  opacity: 0.65;
}

.guide-step.active { opacity: 1; border-color: #93a9f5; background: #f3f7ff; }
.guide-step.done { opacity: 0.85; }

.step-no {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #5f7dff;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.guide-step strong { font-size: 0.84rem; color: #1e293b; display: block; margin-bottom: 0.15rem; }
.guide-step p { margin: 0; font-size: 0.76rem; color: #64748b; line-height: 1.35; }

.guide-rules {
  border-top: 1px dashed #e2e8f7;
  padding-top: 0.65rem;
  font-size: 0.82rem;
  color: #475569;
}

.guide-rules ul { margin: 0.35rem 0 0; padding-left: 1.1rem; }
.guide-rules li { margin: 0.2rem 0; }

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(160px, 1fr));
  gap: 0.7rem;
  margin-bottom: 0.8rem;
}

.kpi-card {
  border: 1px solid #dce4f5;
  border-radius: 12px;
  background: #fff;
  padding: 0.7rem 0.8rem;
}

.kpi-label { color: #64748b; font-size: 0.78rem; }
.kpi-value { margin-top: 0.15rem; font-size: 1.15rem; font-weight: 700; color: #0f172a; }
.kpi-value-sm { font-size: 0.95rem; word-break: break-all; }
.kpi-sub { margin-top: 0.1rem; color: #94a3b8; font-size: 0.76rem; }

.action-bar {
  background: #fff;
  border: 1px solid #e8ebf3;
  border-radius: 12px;
  padding: 0.75rem 0.9rem;
  margin-bottom: 0.9rem;
  display: flex;
  gap: 1.2rem;
  flex-wrap: wrap;
  align-items: flex-start;
}

.action-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.action-label {
  font-size: 0.76rem;
  color: #64748b;
  background: #f1f5f9;
  padding: 0.15rem 0.45rem;
  border-radius: 6px;
  margin-right: 0.2rem;
}

.section-card {
  background: #fff;
  border: 1px solid #e8ebf3;
  border-radius: 12px;
  padding: 0.85rem 0.9rem;
  margin-bottom: 0.85rem;
}

.section-title { font-size: 0.95rem; font-weight: 700; color: #1e293b; margin-bottom: 0.5rem; }
.timeline-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.65rem; gap: 0.5rem; flex-wrap: wrap; }
.timeline-head .section-title { margin-bottom: 0; }
.timeline-head-right { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.timeline-meta { font-size: 0.78rem; color: #64748b; }

.scoreboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(260px, 1fr));
  gap: 0.7rem;
}

.score-card {
  border: 1px solid #e2e8f7;
  border-radius: 12px;
  padding: 0.7rem;
  background: linear-gradient(180deg, #fafbff 0%, #fff 100%);
}

.score-top { display: flex; align-items: center; gap: 0.65rem; margin-bottom: 0.65rem; }
.score-meta { min-width: 0; }
.score-meta strong { display: block; font-size: 0.92rem; color: #1e293b; }
.score-meta span { font-size: 0.76rem; color: #64748b; }

.score-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.45rem;
}

.stat-item {
  background: #f8fafc;
  border-radius: 8px;
  padding: 0.4rem 0.5rem;
}

.stat-label { display: block; font-size: 0.72rem; color: #94a3b8; }
.stat-value { display: block; font-size: 1rem; font-weight: 700; color: #0f172a; margin-top: 0.1rem; }
.tail-value { color: #5f7dff; }

.timeline { position: relative; }
.timeline-item { display: flex; gap: 0.75rem; margin-bottom: 0.85rem; }
.timeline-axis { width: 18px; display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
.timeline-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #cbd5e1;
  border: 2px solid #fff;
  box-shadow: 0 0 0 2px #cbd5e1;
}
.timeline-dot.latest { background: #5f7dff; box-shadow: 0 0 0 2px #5f7dff; }
.timeline-line { flex: 1; width: 2px; background: #e2e8f0; margin-top: 4px; min-height: 40px; }
.timeline-content {
  flex: 1;
  border: 1px solid #e2e8f7;
  border-radius: 12px;
  padding: 0.65rem 0.75rem;
  background: #fafbff;
}
.timeline-item-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.35rem; }
.timeline-item-head strong { color: #1e293b; font-size: 0.9rem; }
.timeline-time { font-size: 0.76rem; color: #64748b; }
.timeline-row { margin: 0.2rem 0; font-size: 0.8rem; color: #475569; line-height: 1.4; }
.timeline-note { color: #94a3b8; font-size: 0.76rem; }
.round-beans { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; }
.round-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(140px, 1fr));
  gap: 0.45rem;
  margin: 0.45rem 0;
}
.round-stat-chip {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.4rem 0.55rem;
  font-size: 0.76rem;
  line-height: 1.35;
}
.round-stat-chip strong {
  display: block;
  color: #1e293b;
  margin-bottom: 0.1rem;
  font-size: 0.8rem;
}
.round-stat-chip span { color: #64748b; }
.round-roll-box {
  margin: 0.35rem 0 0.5rem;
  padding: 0.5rem 0.6rem;
  border-radius: 8px;
  background: #fff7ed;
  border: 1px dashed #fdba74;
}
.roll-label {
  font-size: 0.76rem;
  font-weight: 700;
  color: #c2410c;
  margin-bottom: 0.35rem;
}
.roll-items { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.roll-chip {
  font-size: 0.75rem;
  color: #9a3412;
  background: #fff;
  border: 1px solid #fed7aa;
  border-radius: 999px;
  padding: 0.12rem 0.5rem;
}
.round-bean-chip {
  font-size: 0.76rem;
  font-weight: 600;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
}
.timeline-anchor {
  margin-left: 1.6rem;
  padding: 0.45rem 0;
  font-size: 0.78rem;
  color: #94a3b8;
  border-top: 1px dashed #e2e8f0;
}

.bean-positive { color: #16a34a !important; }
.bean-negative { color: #dc2626 !important; }
.bean-zero { color: #64748b !important; }
.bean-delta { font-weight: 600; color: #2563eb; }

.data-table { width: 100%; }

.empty-box {
  border: 1px dashed #d1d5db;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
  color: #6b7280;
}

.empty-box.small { margin-top: 0.3rem; padding: 0.65rem; font-size: 0.84rem; }

@media (max-width: 1100px) {
  .guide-steps { grid-template-columns: repeat(3, minmax(140px, 1fr)); }
}

@media (max-width: 900px) {
  .kpi-grid { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .scoreboard-grid { grid-template-columns: 1fr; }
  .guide-steps { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
}

@media (max-width: 640px) {
  .detail-head { flex-direction: column; }
  .kpi-grid { grid-template-columns: 1fr; }
  .guide-steps { grid-template-columns: 1fr; }
  .round-stats-grid { grid-template-columns: 1fr; }
}
</style>
