<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { eventApi } from '../../services/api'
import { useAuthStore } from '../../stores/auth'
import { avatarDisplayUrl, handleAvatarImgError } from '../../utils/avatar'
import { sparkLevelFromScore } from '../../utils/sparkLevel'
import MatchHistoryPanel from './MatchHistoryPanel.vue'

const auth = useAuthStore()
const activeView = ref('current')
const historyExpanded = ref(false)
const historyItems = ref([])
const historyLoading = ref(false)
const selectedHistoryId = ref(null)
const loading = ref(true)
const standingsLoading = ref(false)
const killLeaderboardLoading = ref(false)
const actionLoading = ref(false)
const activeTab = ref('overview')
const event = ref(null)
const teams = ref([])
const mySlot = ref(null)
const standings = ref([])
const killLeaderboard = ref([])
const rounds = ref([])

const canJoin = computed(() => event.value?.status === 'registration')
const isLocked = computed(() => ['locked', 'scoring', 'finished'].includes(event.value?.status))
const showStandings = computed(() => ['scoring', 'finished'].includes(event.value?.status))
const hasStandingsData = computed(() => standings.value.some((row) => row.totalPoints > 0))
const hasKillLeaderboardData = computed(() => killLeaderboard.value.length > 0)

const showPubgId = computed(() => Boolean(event.value?.requirePubgBinding))

const slotMemberName = (slot) => slot.realName || slot.displayName || '—'

const teamSparkStats = (team) => {
  const occupied = (team.slots || []).filter((slot) => slot.occupied)
  if (!occupied.length) return { total: 0, average: 0 }
  const total = occupied.reduce((sum, slot) => {
    const score = Number(slot.sparkScore)
    return sum + (Number.isFinite(score) ? score : 0)
  }, 0)
  return { total, average: Math.round(total / occupied.length) }
}

const teamSparkLabel = (team) => {
  const { total, average } = teamSparkStats(team)
  return `${total}/${average}`
}

const formatShortDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

const fetchHistoryList = async () => {
  historyLoading.value = true
  try {
    const data = await eventApi.getHistoryList()
    historyItems.value = data.items || []
  } catch (e) {
    ElMessage.error(e.message || '加载历史赛季失败')
  } finally {
    historyLoading.value = false
  }
}

const selectCurrentSeason = () => {
  activeView.value = 'current'
  selectedHistoryId.value = null
}

const toggleHistoryBranch = async () => {
  historyExpanded.value = !historyExpanded.value
  if (historyExpanded.value && !historyItems.value.length && !historyLoading.value) {
    await fetchHistoryList()
  }
}

const selectHistorySeason = (item) => {
  activeView.value = 'history'
  selectedHistoryId.value = item.id
  historyExpanded.value = true
}

const formatEventDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const overviewContentSections = computed(() => {
  const content = event.value?.basicInfo?.content?.trim()
  if (!content) return []
  const sections = []
  let current = null
  content.split('\n').forEach((line) => {
    const matched = line.match(/^【(.+?)】(.*)$/)
    if (matched) {
      if (current) sections.push(current)
      current = { title: matched[1], body: matched[2].trim() }
      return
    }
    if (!line.trim()) return
    if (current) {
      current.body = current.body ? `${current.body}\n${line.trim()}` : line.trim()
    } else {
      sections.push({ title: '', body: line.trim() })
    }
  })
  if (current) sections.push(current)
  return sections.filter((section) => section.title || section.body)
})

const overviewQuickStats = computed(() => {
  const basicInfo = event.value?.basicInfo
  return [
    { label: '赛制', value: '16 队 × 四排' },
    { label: '每队', value: '5 人' },
    { label: '击杀分', value: `每杀 ${basicInfo?.pointsPerKill ?? 1} 分` },
    {
      label: '报名要求',
      value: event.value?.requirePubgBinding ? '需绑定 PUBG' : '无额外要求',
    },
  ]
})

const expandedTeamId = ref(null)
const detailLoadingTeamId = ref(null)
const teamDetailCache = ref({})

const toggleTeamDetail = async (row) => {
  if (expandedTeamId.value === row.teamId) {
    expandedTeamId.value = null
    return
  }
  expandedTeamId.value = row.teamId
  if (teamDetailCache.value[row.teamId]) return
  detailLoadingTeamId.value = row.teamId
  try {
    const data = await eventApi.getTeamRoundDetails(row.teamId)
    teamDetailCache.value = {
      ...teamDetailCache.value,
      [row.teamId]: data.rounds || [],
    }
  } catch (e) {
    expandedTeamId.value = null
    ElMessage.error(e.message || '加载详情失败')
  } finally {
    detailLoadingTeamId.value = null
  }
}

const teamDetailRounds = (teamId) => teamDetailCache.value[teamId] || []

const summarizeTeamDetailRounds = (rounds) => {
  if (!rounds?.length) return null
  const memberTotals = new Map()
  const totals = rounds.reduce(
    (acc, round) => {
      acc.placementPoints += Number(round.placementPoints) || 0
      acc.kills += Number(round.kills) || 0
      acc.totalPoints += Number(round.totalPoints) || 0
      if (round.members?.length) {
        acc.hasMemberDetails = true
        round.members.forEach((member) => {
          const slotIndex = Number(member.slotIndex ?? member.slot_index ?? 0)
          const existing = memberTotals.get(slotIndex)
          memberTotals.set(slotIndex, {
            slotIndex,
            displayName: member.displayName || existing?.displayName || `成员${slotIndex + 1}`,
            kills: (existing?.kills || 0) + (Number(member.kills) || 0),
          })
        })
      }
      return acc
    },
    { placementPoints: 0, kills: 0, totalPoints: 0, hasMemberDetails: false, members: [] }
  )
  totals.members = [...memberTotals.values()].sort((a, b) => a.slotIndex - b.slotIndex)
  return totals
}

const teamDetailTotal = (teamId) => summarizeTeamDetailRounds(teamDetailRounds(teamId))

const isTeamExpanded = (teamId) => expandedTeamId.value === teamId

const rankBadgeClass = (rank) => {
  if (rank === 1) return 'rank-gold'
  if (rank === 2) return 'rank-silver'
  if (rank === 3) return 'rank-bronze'
  return ''
}

const isMyStandingsRow = (row) => mySlot.value && row.teamId === mySlot.value.teamId

const isMyKillRow = (row) => row.userId && auth.userData?.id === row.userId

const matchConfirmOptions = {
  lockScroll: false,
  appendTo: document.body,
  zIndex: 12000,
}

const pickDefaultTab = (status) => {
  if (['scoring', 'finished'].includes(status)) return 'standings'
  if (status === 'registration') return 'lobby'
  return 'overview'
}

const fetchLobby = async () => {
  loading.value = true
  try {
    const data = await eventApi.getLobby()
    event.value = data.event
    teams.value = data.teams || []
    mySlot.value = data.mySlot || null
    if (!activeTab.value || activeTab.value === 'overview') {
      activeTab.value = pickDefaultTab(data.event?.status)
    }
    if (showStandings.value) {
      await fetchStandings(false)
    }
  } catch (e) {
    ElMessage.error(e.message || '加载杯赛失败')
  } finally {
    loading.value = false
  }
}

const fetchStandings = async (withLoading = true) => {
  if (withLoading) standingsLoading.value = true
  try {
    const data = await eventApi.getStandings()
    event.value = data.event || event.value
    standings.value = data.standings || []
    rounds.value = data.rounds || []
  } catch (e) {
    ElMessage.error(e.message || '加载积分榜失败')
  } finally {
    standingsLoading.value = false
  }
}

const fetchKillLeaderboard = async (withLoading = true) => {
  if (withLoading) killLeaderboardLoading.value = true
  try {
    const data = await eventApi.getMemberKillLeaderboard()
    event.value = data.event || event.value
    killLeaderboard.value = data.leaderboard || []
  } catch (e) {
    ElMessage.error(e.message || '加载击杀榜失败')
  } finally {
    killLeaderboardLoading.value = false
  }
}

const handleJoin = async (team, slot) => {
  if (!canJoin.value || slot.occupied) return
  if (mySlot.value) {
    ElMessage.warning('请先离队再选择其他位置')
    return
  }
  try {
    await ElMessageBox.confirm(
      `加入 ${team.teamName}？`,
      '确认占坑',
      {
        type: 'info',
        confirmButtonText: '加入',
        cancelButtonText: '取消',
        ...matchConfirmOptions,
      }
    )
  } catch {
    return
  }
  actionLoading.value = true
  try {
    const res = await eventApi.joinSlot(team.id, slot.slotIndex)
    mySlot.value = res.mySlot || null
    ElMessage.success('加入成功')
    await fetchLobby()
  } catch (e) {
    ElMessage.error(e.message || '加入失败')
  } finally {
    actionLoading.value = false
  }
}

const handleLeave = async () => {
  if (!mySlot.value) return
  try {
    await ElMessageBox.confirm('确定离开当前队伍？', '离队', {
      type: 'warning',
      confirmButtonText: '离队',
      cancelButtonText: '取消',
      ...matchConfirmOptions,
    })
  } catch {
    return
  }
  actionLoading.value = true
  try {
    await eventApi.leave()
    mySlot.value = null
    ElMessage.success('已离队')
    await fetchLobby()
  } catch (e) {
    ElMessage.error(e.message || '离队失败')
  } finally {
    actionLoading.value = false
  }
}

onMounted(async () => {
  await fetchLobby()
  fetchHistoryList()
})

watch(activeTab, (tab) => {
  if (tab === 'standings' && showStandings.value && !standings.value.length) {
    fetchStandings()
  }
  if (tab === 'kill-leaderboard' && showStandings.value && !killLeaderboard.value.length) {
    fetchKillLeaderboard()
  }
})
</script>

<template>
  <div class="match-page" v-loading="loading">
    <div class="container match-layout">
      <aside class="match-side-tree">
        <nav class="season-tree">
          <button
            type="button"
            class="tree-node tree-node-root"
            :class="{ active: activeView === 'current' }"
            @click="selectCurrentSeason"
          >
            <span class="tree-node-label">当前赛季</span>
            <span v-if="event" class="tree-node-meta">{{ event.title }}</span>
            <span v-else class="tree-node-meta muted">暂无进行中</span>
          </button>

          <div class="tree-branch">
            <button
              type="button"
              class="tree-node tree-node-parent"
              :class="{ expanded: historyExpanded }"
              @click="toggleHistoryBranch"
            >
              <span class="tree-chevron" :class="{ open: historyExpanded }" />
              <span class="tree-node-label">历史赛季</span>
              <span v-if="historyItems.length" class="tree-node-count">{{ historyItems.length }}</span>
            </button>

            <div v-show="historyExpanded" class="tree-children">
              <p v-if="historyLoading" class="tree-status">加载中…</p>
              <p v-else-if="!historyItems.length" class="tree-status">暂无历史杯赛</p>
              <button
                v-for="item in historyItems"
                :key="item.id"
                type="button"
                class="tree-node tree-node-child"
                :class="{ active: activeView === 'history' && selectedHistoryId === item.id }"
                @click="selectHistorySeason(item)"
              >
                <span class="tree-node-label">{{ item.title }}</span>
                <span class="tree-node-meta">{{ formatShortDate(item.finishedAt) }}</span>
              </button>
            </div>
          </div>
        </nav>
      </aside>

      <main class="match-main">
        <MatchHistoryPanel
          v-if="activeView === 'history' && selectedHistoryId"
          :event-id="selectedHistoryId"
        />

        <div v-else-if="activeView === 'history'" class="history-placeholder">
          <el-empty description="请从左侧历史赛季中选择一届杯赛" />
        </div>

        <template v-else-if="event">
        <header class="match-header">
          <div>
            <h1>{{ event.title }}</h1>
            <p class="status-tag">
              <el-tag :type="event.status === 'registration' ? 'success' : 'info'">
                {{ event.statusLabel }}
              </el-tag>
              <span v-if="event.requirePubgBinding" class="hint">需已绑定 PUBG</span>
            </p>
          </div>
          <el-button
            v-if="canJoin && mySlot"
            type="warning"
            plain
            :loading="actionLoading"
            @click="handleLeave"
          >
            离队
          </el-button>
        </header>

        <el-tabs v-model="activeTab" class="match-tabs">
          <el-tab-pane label="概览" name="overview">
            <div class="overview-panel">
              <div v-if="mySlot" class="overview-mine">
                <span class="overview-mine-label">我的队伍</span>
                <span class="overview-mine-value">#{{ mySlot.teamNumber }} {{ mySlot.teamName }}</span>
              </div>

              <div class="overview-quick-stats">
                <div v-for="item in overviewQuickStats" :key="item.label" class="overview-stat-card">
                  <span class="overview-stat-label">{{ item.label }}</span>
                  <span class="overview-stat-value">{{ item.value }}</span>
                </div>
              </div>

              <div class="overview-grid">
                <section class="overview-card overview-main">
                  <div class="overview-card-head">
                    <h2>基础信息</h2>
                    <span class="overview-card-sub">赛事说明与规则</span>
                  </div>

                  <div v-if="overviewContentSections.length" class="overview-sections">
                    <article
                      v-for="(section, index) in overviewContentSections"
                      :key="`${section.title}-${index}`"
                      class="overview-section"
                    >
                      <h3 v-if="section.title" class="overview-section-title">{{ section.title }}</h3>
                      <p class="overview-section-body">{{ section.body }}</p>
                    </article>
                  </div>
                  <p v-else class="overview-empty">暂无基础信息</p>

                  <div
                    v-if="event.registrationOpenAt || event.registrationCloseAt"
                    class="overview-schedule"
                  >
                    <div v-if="event.registrationOpenAt" class="schedule-item">
                      <span class="schedule-label">报名开始</span>
                      <span class="schedule-value">{{ formatEventDate(event.registrationOpenAt) }}</span>
                    </div>
                    <div v-if="event.registrationCloseAt" class="schedule-item">
                      <span class="schedule-label">报名截止</span>
                      <span class="schedule-value">{{ formatEventDate(event.registrationCloseAt) }}</span>
                    </div>
                  </div>
                </section>

                <section class="overview-card overview-scoring">
                  <div class="overview-card-head">
                    <h2>PGS 计分</h2>
                    <span class="overview-card-sub">排名分 + 击杀分</span>
                  </div>

                  <div class="scoring-formula">
                    <span>单局总分</span>
                    <span class="scoring-formula-eq">=</span>
                    <span>排名分</span>
                    <span class="scoring-formula-plus">+</span>
                    <span>击杀分</span>
                  </div>

                  <div v-if="event.basicInfo?.placementTable?.length" class="placement-ladder">
                    <div
                      v-for="row in event.basicInfo.placementTable"
                      :key="row.rankLabel"
                      class="placement-ladder-row"
                    >
                      <span class="placement-ladder-rank">{{ row.rankLabel }}</span>
                      <span class="placement-ladder-bar">
                        <i :style="{ width: `${Math.max(12, (row.points / 10) * 100)}%` }" />
                      </span>
                      <span class="placement-ladder-points">{{ row.points }}</span>
                    </div>
                  </div>

                  <div class="scoring-foot">
                    <span>击杀分</span>
                    <strong>每击杀 {{ event.basicInfo?.pointsPerKill ?? 1 }} 分</strong>
                  </div>
                  <p class="scoring-note">同分比较总击杀；排名分在录入队伍名次时自动计算</p>
                </section>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="报名" name="lobby">
            <p v-if="!canJoin && !isLocked" class="tab-hint">当前未开放报名</p>
            <p v-else-if="isLocked" class="tab-hint">名单已锁定，仅可查看</p>
            <p v-else class="tab-hint">
              点击空槽位选队；每人仅能占一个位置
              <span v-if="showPubgId"> · 展示真实姓名、游戏 ID、星火值与等级</span>
              <span v-else> · 展示真实姓名</span>
            </p>

            <div class="team-grid lobby-grid">
              <el-card
                v-for="team in teams"
                :key="team.id"
                shadow="never"
                class="team-card"
                :class="{ 'is-mine': mySlot && mySlot.teamId === team.id }"
              >
                <div class="team-card-head">
                  <span class="team-no">#{{ team.teamNumber }}</span>
                  <span class="team-name">{{ team.teamName }}</span>
                  <span class="team-spark-stats" title="队伍总星火值 / 平均星火值">{{ teamSparkLabel(team) }}</span>
                </div>
                <div class="slot-list">
                  <button
                    v-for="slot in team.slots"
                    :key="slot.id"
                    type="button"
                    class="slot-item"
                    :class="{
                      occupied: slot.occupied,
                      empty: !slot.occupied,
                      clickable: canJoin && !slot.occupied && !mySlot,
                      mine: mySlot && mySlot.teamId === team.id && mySlot.slotIndex === slot.slotIndex
                    }"
                    :disabled="!canJoin || slot.occupied || !!mySlot || actionLoading"
                    @click="handleJoin(team, slot)"
                  >
                    <template v-if="slot.occupied">
                      <el-avatar
                        :src="avatarDisplayUrl(slot.avatar)"
                        :size="22"
                        class="slot-avatar"
                      />
                      <span class="slot-line">
                        <span class="member-name">{{ slotMemberName(slot) }}</span>
                        <template v-if="showPubgId && slot.pubgPlayerName">
                          <span class="member-sep">#</span>
                          <span class="member-game-id">{{ slot.pubgPlayerName }}</span>
                          <template v-if="slot.sparkScore != null && slot.sparkScore !== ''">
                            <span class="member-sep">#</span>
                            <span class="member-spark" :title="'星火值'">{{ slot.sparkScore }}</span>
                            <span class="member-sep">#</span>
                            <span class="member-level" :title="'等级'">{{ sparkLevelFromScore(slot.sparkScore) }}</span>
                          </template>
                        </template>
                      </span>
                    </template>
                    <template v-else>
                      <span class="slot-plus">+</span>
                      <span class="slot-line muted">空位</span>
                    </template>
                  </button>
                </div>
              </el-card>
            </div>
          </el-tab-pane>

          <el-tab-pane label="榜单" name="standings" :disabled="!showStandings">
            <p v-if="!showStandings" class="tab-hint">名单锁定后，管理员开始录分即可查看榜单</p>
            <template v-else>
              <div class="standings-panel" v-loading="standingsLoading">
                <div class="standings-toolbar">
                  <div>
                    <h2 class="standings-title">积分榜</h2>
                    <p class="standings-subtitle">按总积分排序，同分比较总击杀</p>
                  </div>
                  <div v-if="rounds.length" class="standings-round-pills">
                    <span
                      v-for="round in rounds"
                      :key="round.id"
                      class="round-pill"
                      :class="{ done: round.status === 'completed' }"
                    >
                      第{{ round.roundNo }}局
                      <em v-if="round.mapName">{{ round.mapName }}</em>
                    </span>
                  </div>
                </div>

                <el-empty v-if="!hasStandingsData" description="暂无成绩，等待管理员录入" />

                <div v-else class="standings-board">
                  <table class="standings-table">
                    <colgroup>
                      <col class="col-expand" />
                      <col class="col-rank" />
                      <col class="col-team-name" />
                      <col class="col-num" />
                      <col class="col-num" />
                      <col class="col-num" />
                      <col class="col-brief" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th class="th-expand" />
                        <th class="th-rank">排名</th>
                        <th class="th-team-name">队伍名称</th>
                        <th class="th-num">总排名分</th>
                        <th class="th-num">总击杀分</th>
                        <th class="th-num th-total">总分</th>
                        <th class="th-brief">简略详情</th>
                      </tr>
                    </thead>
                    <tbody>
                      <template v-for="row in standings" :key="row.teamId">
                        <tr
                          class="standings-main-row"
                          :class="{
                            expanded: isTeamExpanded(row.teamId),
                            'is-mine': isMyStandingsRow(row),
                            [rankBadgeClass(row.rank)]: true,
                          }"
                          :title="isMyStandingsRow(row) ? '我的队伍' : undefined"
                        >
                          <td class="td-expand">
                            <button
                              type="button"
                              class="expand-btn"
                              :class="{ open: isTeamExpanded(row.teamId) }"
                              :aria-expanded="isTeamExpanded(row.teamId)"
                              :title="isTeamExpanded(row.teamId) ? '收起详情' : '展开详情'"
                              @click="toggleTeamDetail(row)"
                            >
                              <span class="expand-icon" />
                            </button>
                          </td>
                          <td class="td-rank">
                            <span class="rank-num">{{ row.rank }}</span>
                          </td>
                          <td class="td-team-name">
                            <div class="team-name-cell">
                              <span class="team-no">#{{ String(row.teamNumber).padStart(2, '0') }}</span>
                              <span class="team-name">{{ row.teamName }}</span>
                            </div>
                          </td>
                          <td class="td-num">{{ row.totalPlacementPoints ?? 0 }}</td>
                          <td class="td-num">{{ row.totalKillPoints ?? 0 }}</td>
                          <td class="td-num td-total">{{ row.totalPoints ?? 0 }}</td>
                          <td class="td-brief">
                            <p v-if="row.rounds?.length" class="round-brief">
                              <span
                                v-for="roundItem in row.rounds"
                                :key="roundItem.roundId"
                                class="round-brief-item"
                              >
                                第{{ roundItem.roundNo }}局 #{{ roundItem.placement }}
                                · {{ roundItem.placementPoints }}分 · {{ roundItem.kills }}杀
                              </span>
                            </p>
                            <span v-else class="muted">—</span>
                          </td>
                        </tr>
                        <tr
                          v-if="isTeamExpanded(row.teamId)"
                          class="standings-detail-row"
                          :class="{ 'is-mine': isMyStandingsRow(row) }"
                        >
                          <td colspan="7" class="td-detail">
                            <div
                              class="standings-expand-panel"
                              v-loading="detailLoadingTeamId === row.teamId"
                            >
                              <el-empty
                                v-if="!teamDetailRounds(row.teamId).length && detailLoadingTeamId !== row.teamId"
                                description="暂无局次成绩"
                                :image-size="48"
                              />
                              <table v-else class="detail-table">
                                <colgroup>
                                  <col class="col-detail-round" />
                                  <col class="col-detail-place" />
                                  <col class="col-detail-points" />
                                  <col class="col-detail-kills" />
                                  <col class="col-detail-total" />
                                  <col class="col-detail-members" />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th>局次</th>
                                    <th>名次</th>
                                    <th>排名分</th>
                                    <th>击杀</th>
                                    <th>总分</th>
                                    <th class="th-members">成员击杀</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr v-for="round in teamDetailRounds(row.teamId)" :key="round.roundId">
                                    <td>
                                      第{{ round.roundNo }}局
                                      <span v-if="round.mapName" class="detail-map">{{ round.mapName }}</span>
                                    </td>
                                    <td>#{{ round.placement ?? '—' }}</td>
                                    <td>{{ round.placementPoints ?? '—' }}</td>
                                    <td>{{ round.kills ?? '—' }}</td>
                                    <td>{{ round.totalPoints ?? '—' }}</td>
                                    <td class="td-members">
                                      <span v-if="!round.members?.length" class="muted">—</span>
                                      <span v-else class="member-brief-list">
                                        <span
                                          v-for="member in round.members"
                                          :key="`${round.roundId}-${member.slotIndex}`"
                                          class="member-brief"
                                        >
                                          {{ member.displayName }} {{ member.kills }}杀
                                        </span>
                                      </span>
                                    </td>
                                  </tr>
                                </tbody>
                                <tfoot v-if="teamDetailTotal(row.teamId)">
                                  <tr class="detail-total-row">
                                    <td>总计</td>
                                    <td>—</td>
                                    <td>{{ teamDetailTotal(row.teamId).placementPoints }}</td>
                                    <td>{{ teamDetailTotal(row.teamId).kills }}</td>
                                    <td>{{ teamDetailTotal(row.teamId).totalPoints }}</td>
                                    <td class="td-members">
                                      <span v-if="teamDetailTotal(row.teamId).hasMemberDetails" class="member-brief-list">
                                        <span
                                          v-for="member in teamDetailTotal(row.teamId).members"
                                          :key="`total-${member.slotIndex}`"
                                          class="member-brief"
                                        >
                                          {{ member.displayName }} {{ member.kills }}杀
                                        </span>
                                      </span>
                                      <span v-else class="muted">—</span>
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                </div>
              </div>
            </template>
          </el-tab-pane>

          <el-tab-pane label="击杀榜" name="kill-leaderboard" :disabled="!showStandings">
            <p v-if="!showStandings" class="tab-hint">名单锁定后，管理员开始录分即可查看击杀榜</p>
            <template v-else>
              <div class="standings-panel" v-loading="killLeaderboardLoading">
                <div class="standings-toolbar">
                  <div>
                    <h2 class="standings-title">个人击杀榜</h2>
                    <p class="standings-subtitle">统计各成员在已完成局次中的击杀总数</p>
                  </div>
                </div>

                <el-empty v-if="!hasKillLeaderboardData" description="暂无成员击杀数据" />

                <div v-else class="standings-board">
                  <table class="kill-leaderboard-table">
                    <colgroup>
                      <col class="col-kill-rank" />
                      <col class="col-kill-team" />
                      <col class="col-kill-name" />
                      <col class="col-kill-game-id" />
                      <col class="col-kill-total" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>排名</th>
                        <th>所属队伍</th>
                        <th>姓名</th>
                        <th>游戏 ID</th>
                        <th>总击杀数</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="row in killLeaderboard"
                        :key="`${row.teamId}-${row.userId || row.rank}`"
                        class="kill-leaderboard-row"
                        :class="{
                          'is-mine': isMyKillRow(row),
                          [rankBadgeClass(row.rank)]: true,
                        }"
                      >
                        <td class="td-rank">
                          <span class="rank-num">{{ row.rank }}</span>
                        </td>
                        <td class="td-kill-team">
                          <div class="kill-team-cell">
                            <span class="team-no">#{{ String(row.teamNumber).padStart(2, '0') }}</span>
                            <span class="team-name">{{ row.teamName }}</span>
                          </div>
                        </td>
                        <td class="td-kill-name">{{ row.realName }}</td>
                        <td class="td-kill-game-id">{{ row.gameId || '—' }}</td>
                        <td class="td-kill-total">{{ row.totalKills }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </template>
          </el-tab-pane>
        </el-tabs>
        </template>

        <el-empty v-else description="暂无进行中的杯赛" />
      </main>
    </div>
  </div>
</template>

<style scoped>
.match-page {
  padding: 1rem 0 2rem;
  min-height: 60vh;
}

.match-layout {
  display: flex;
  gap: 1.25rem;
  align-items: flex-start;
}

.match-side-tree {
  flex: 0 0 220px;
  position: sticky;
  top: var(--layout-sticky-top, calc(var(--navbar-height, 60px) + 16px));
  align-self: flex-start;
  z-index: 20;
  max-height: calc(100vh - var(--layout-sticky-top, 76px) - 1rem);
  overflow-y: auto;
}

.season-tree {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.65rem;
  border: 1px solid #e5e5ea;
  border-radius: 12px;
  background: #fff;
}

.tree-node {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.55rem 0.65rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.tree-node-root,
.tree-node-child {
  padding-left: 0.65rem;
}

.tree-node-parent {
  flex-direction: row;
  align-items: center;
  gap: 0.45rem;
}

.tree-node:hover {
  background: #f5f5f7;
}

.tree-node.active {
  background: rgba(0, 113, 227, 0.08);
}

.tree-node-label {
  font-size: 0.88rem;
  font-weight: 600;
  color: #1d1d1f;
  line-height: 1.35;
}

.tree-node.active .tree-node-label {
  color: #0071e3;
}

.tree-node-meta {
  font-size: 0.72rem;
  color: #86868b;
  line-height: 1.3;
}

.tree-node-count {
  margin-left: auto;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: #e8e8ed;
  font-size: 0.68rem;
  font-weight: 700;
  color: #636366;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tree-chevron {
  width: 0.45rem;
  height: 0.45rem;
  border-right: 2px solid #86868b;
  border-bottom: 2px solid #86868b;
  transform: rotate(-45deg);
  transition: transform 0.15s;
  flex-shrink: 0;
}

.tree-chevron.open {
  transform: rotate(45deg);
}

.tree-children {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-left: 0.85rem;
  padding-left: 0.65rem;
  border-left: 1px solid #e5e5ea;
}

.tree-node-child {
  padding-left: 0.5rem;
}

.tree-status {
  margin: 0.25rem 0 0.35rem 0.5rem;
  font-size: 0.75rem;
  color: #86868b;
}

.history-placeholder {
  min-height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.match-main {
  flex: 1;
  min-width: 0;
}

.container {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 0.75rem;
}

.match-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.match-header h1 {
  margin: 0 0 0.35rem;
  font-size: 1.35rem;
  color: #1d1d1f;
}

.status-tag {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0;
}

.hint, .muted {
  color: #86868b;
  font-size: 0.9rem;
}

.overview-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.overview-mine {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(0, 113, 227, 0.1), rgba(0, 113, 227, 0.04));
  border: 1px solid rgba(0, 113, 227, 0.18);
}

.overview-mine-label {
  font-size: 0.82rem;
  color: #0071e3;
  font-weight: 600;
}

.overview-mine-value {
  font-size: 0.95rem;
  font-weight: 600;
  color: #1d1d1f;
}

.overview-quick-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.65rem;
}

.overview-stat-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 0.85rem;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e5ea;
}

.overview-stat-label {
  font-size: 0.72rem;
  color: #86868b;
}

.overview-stat-value {
  font-size: 0.88rem;
  font-weight: 600;
  color: #1d1d1f;
}

.overview-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.overview-card {
  border-radius: 14px;
  border: 1px solid #e5e5ea;
  background: #fff;
  padding: 1rem 1.05rem 1.05rem;
}

.overview-card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.9rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #f0f0f2;
}

.overview-card-head h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: #1d1d1f;
}

.overview-card-sub {
  font-size: 0.75rem;
  color: #86868b;
}

.overview-sections {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.overview-section-title {
  margin: 0 0 0.35rem;
  font-size: 0.84rem;
  font-weight: 700;
  color: #0071e3;
}

.overview-section-body {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.65;
  color: #424245;
  white-space: pre-wrap;
}

.overview-empty {
  margin: 0;
  color: #86868b;
  font-size: 0.86rem;
}

.overview-schedule {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 1rem;
  padding-top: 0.9rem;
  border-top: 1px dashed #e5e5ea;
}

.schedule-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 140px;
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  background: #f5f5f7;
}

.schedule-label {
  font-size: 0.72rem;
  color: #86868b;
}

.schedule-value {
  font-size: 0.84rem;
  font-weight: 600;
  color: #1d1d1f;
}

.scoring-formula {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.85rem;
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  background: #f5f5f7;
  font-size: 0.8rem;
  color: #424245;
}

.scoring-formula-eq,
.scoring-formula-plus {
  color: #86868b;
  font-weight: 700;
}

.placement-ladder {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.placement-ladder-row {
  display: grid;
  grid-template-columns: 5.5rem 1fr 2rem;
  align-items: center;
  gap: 0.55rem;
}

.placement-ladder-rank {
  font-size: 0.76rem;
  color: #424245;
}

.placement-ladder-bar {
  position: relative;
  height: 8px;
  border-radius: 999px;
  background: #ececf0;
  overflow: hidden;
}

.placement-ladder-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #0071e3, #5ac8fa);
}

.placement-ladder-points {
  font-size: 0.8rem;
  font-weight: 700;
  color: #0071e3;
  text-align: right;
}

.scoring-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.9rem;
  padding-top: 0.85rem;
  border-top: 1px solid #f0f0f2;
  font-size: 0.82rem;
  color: #424245;
}

.scoring-foot strong {
  color: #e68619;
  font-size: 0.9rem;
}

.scoring-note {
  margin: 0.65rem 0 0;
  font-size: 0.72rem;
  line-height: 1.5;
  color: #86868b;
}

.detail-round-card {
  padding: 0.75rem 0.8rem;
  border-radius: 10px;
  border: 1px solid #e5e5ea;
  background: #fff;
}

.detail-round-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.45rem;
}

.detail-round-map {
  margin-left: 0.25rem;
  color: #86868b;
  font-weight: 400;
}

.detail-round-summary {
  margin: 0 0 0.65rem;
  font-size: 0.8rem;
  color: #424245;
}

.detail-member-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.detail-member-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  background: #fff;
}

.detail-member-name {
  font-size: 0.82rem;
  color: #1d1d1f;
}

.detail-member-name em {
  margin-left: 0.35rem;
  font-style: normal;
  font-size: 0.72rem;
  color: #0071e3;
}

.detail-member-kills {
  font-size: 0.82rem;
  font-weight: 700;
  color: #e68619;
}

.detail-member-empty {
  margin: 0;
  font-size: 0.78rem;
}

.tab-hint {
  margin: 0 0 0.6rem;
  color: #86868b;
  font-size: 0.8rem;
}

.lobby-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
}

.team-grid {
  display: grid;
  gap: 0.5rem;
}

.team-card {
  border-radius: 8px;
}

.team-card :deep(.el-card__body) {
  padding: 0.45rem 0.5rem 0.5rem;
}

.team-card.is-mine {
  border-color: #0071e3;
  box-shadow: 0 0 0 1px rgba(0, 113, 227, 0.25);
}

.team-card-head {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.35rem;
  font-weight: 600;
  font-size: 0.78rem;
  color: #1d1d1f;
}

.team-name {
  color: #1d1d1f;
}

.team-no {
  color: #0071e3;
}

.team-spark-stats {
  margin-left: auto;
  font-size: 0.72rem;
  color: #e68619;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.slot-list {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}

.slot-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.3rem 0.45rem;
  border: 1px solid #e5e5ea;
  border-radius: 6px;
  background: #fafafa;
  color: #1d1d1f;
  text-align: left;
  cursor: default;
  min-height: 2rem;
}

.slot-item.empty.clickable {
  cursor: pointer;
  background: #fff;
}

.slot-item.empty.clickable:hover {
  border-color: #0071e3;
  background: #f0f7ff;
}

.slot-item.mine {
  border-color: #0071e3;
  background: #f0f7ff;
}

.slot-item:disabled {
  opacity: 0.85;
}

.slot-plus {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #e8e8ed;
  color: #86868b;
  font-size: 0.9rem;
}

.slot-avatar {
  flex-shrink: 0;
}

.slot-line {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
  flex: 1;
  font-size: 0.72rem;
  line-height: 1.2;
  color: #1d1d1f;
}

.member-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
}

.member-sep {
  flex-shrink: 0;
  color: #86868b;
  font-weight: 600;
}

.member-game-id {
  color: #424245;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
}

.member-spark {
  color: #e68619;
  font-weight: 600;
  flex-shrink: 0;
}

.member-level {
  color: #5856d6;
  font-weight: 600;
  flex-shrink: 0;
}

.standings-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.standings-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.standings-title {
  margin: 0 0 0.2rem;
  font-size: 1rem;
  font-weight: 700;
  color: #1d1d1f;
}

.standings-subtitle {
  margin: 0;
  font-size: 0.78rem;
  color: #86868b;
}

.standings-round-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: flex-end;
}

.round-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.28rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  color: #86868b;
  background: #f5f5f7;
  border: 1px solid #e5e5ea;
}

.round-pill.done {
  color: #0071e3;
  background: rgba(0, 113, 227, 0.08);
  border-color: rgba(0, 113, 227, 0.18);
}

.round-pill em {
  font-style: normal;
  color: #86868b;
}

.standings-board {
  border: 1px solid #e5e5ea;
  border-radius: 12px;
  overflow-x: auto;
  overflow-y: visible;
  background: #fff;
  padding: 0 2px;
}

.kill-leaderboard-table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  table-layout: fixed;
}

.col-kill-rank { width: 3.5rem; }
.col-kill-team { width: 28%; }
.col-kill-name { width: 18%; }
.col-kill-game-id { width: 28%; }
.col-kill-total { width: 6.5rem; }

.kill-leaderboard-table th,
.kill-leaderboard-table td {
  padding: 0.7rem 0.85rem;
  vertical-align: middle;
  border-bottom: 1px solid #f0f0f2;
  text-align: center;
}

.kill-leaderboard-table thead th {
  background: #f5f5f7;
  font-size: 0.75rem;
  font-weight: 600;
  color: #86868b;
  white-space: nowrap;
}

.kill-leaderboard-table thead th:nth-child(2),
.kill-leaderboard-table .td-kill-team {
  text-align: left;
}

.kill-leaderboard-table tbody tr:last-child td {
  border-bottom: none;
}

.kill-leaderboard-row:hover {
  background: #fafafa;
}

.kill-leaderboard-row.is-mine {
  background: rgba(0, 113, 227, 0.05);
}

.kill-leaderboard-row.is-mine:hover {
  background: rgba(0, 113, 227, 0.08);
}

.td-kill-team {
  text-align: left;
}

.kill-team-cell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.td-kill-name,
.td-kill-game-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.td-kill-total {
  font-size: 0.92rem;
  font-weight: 700;
  color: #1d1d1f;
  font-variant-numeric: tabular-nums;
}

.standings-table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  table-layout: fixed;
}

.col-expand { width: 3.5rem; }
.col-rank { width: 3.5rem; }
.col-team-name { width: 11rem; }
.col-num { width: 5.5rem; }

.standings-table th,
.standings-table td {
  padding: 0.7rem 0.85rem;
  vertical-align: middle;
  border-bottom: 1px solid #f0f0f2;
}

.standings-table thead th {
  background: #f5f5f7;
  font-size: 0.75rem;
  font-weight: 600;
  color: #86868b;
  text-align: center;
  white-space: nowrap;
}

.standings-table thead th.th-brief {
  text-align: left;
}

.standings-table tbody tr:last-child .standings-main-row td,
.standings-table tbody tr.standings-detail-row:last-child td {
  border-bottom: none;
}

.th-rank,
.td-rank {
  width: 56px;
  text-align: center;
}

.th-num,
.td-num {
  width: 88px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.th-total,
.td-total {
  font-weight: 700;
  color: #1d1d1f;
}

.th-expand,
.td-expand {
  width: 3.5rem;
  min-width: 3.5rem;
  padding-left: 0.45rem;
  padding-right: 0.45rem;
  text-align: center;
  overflow: visible;
  position: sticky;
  left: 0;
  z-index: 2;
  background: #fff;
}

.standings-table thead th.th-expand {
  background: #f5f5f7;
  z-index: 3;
}

.standings-main-row:hover .td-expand {
  background: #fafafa;
}

.standings-main-row.is-mine .td-expand {
  background: rgba(0, 113, 227, 0.05);
}

.standings-main-row.is-mine:hover .td-expand {
  background: rgba(0, 113, 227, 0.08);
}

.standings-main-row.expanded .td-expand,
.standings-main-row.is-mine.expanded .td-expand {
  background: #f8f8fa;
}

.th-team-name,
.td-team-name {
  text-align: center;
  overflow: hidden;
}

.th-brief,
.td-brief {
  width: auto;
  text-align: left;
}

.team-name-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  max-width: 100%;
}

.team-name-cell .team-name {
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.35;
}

.standings-main-row:hover {
  background: #fafafa;
}

.standings-main-row.is-mine {
  background: rgba(0, 113, 227, 0.05);
}

.standings-main-row.is-mine:hover {
  background: rgba(0, 113, 227, 0.08);
}

.standings-main-row.is-mine.expanded {
  background: rgba(0, 113, 227, 0.07);
}

.standings-main-row.expanded {
  background: #f8f8fa;
}

.rank-num {
  display: inline-block;
  font-size: 0.9rem;
  font-weight: 700;
  color: #424245;
}

.standings-main-row.rank-gold .rank-num { color: #9a6b00; }
.standings-main-row.rank-silver .rank-num { color: #5c6670; }
.standings-main-row.rank-bronze .rank-num { color: #8a4d2a; }

.team-cell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.team-no {
  font-size: 0.8rem;
  font-weight: 700;
  color: #0071e3;
  white-space: nowrap;
}

.team-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: #1d1d1f;
  line-height: 1.4;
}

.round-brief {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.85rem;
  margin: 0.35rem 0 0;
  padding: 0;
}

.round-brief-item {
  font-size: 0.75rem;
  color: #86868b;
  line-height: 1.4;
}

.td-num {
  font-size: 0.92rem;
  font-weight: 700;
  color: #1d1d1f;
}

.standings-detail-row .td-detail {
  padding: 0;
  background: #f8f8fa;
}

.standings-detail-row.is-mine .td-detail {
  background: rgba(0, 113, 227, 0.04);
}

.standings-expand-panel {
  padding: 0.75rem 0.85rem 0.85rem;
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  background: #fff;
  border: 1px solid #e5e5ea;
  border-radius: 8px;
  overflow: hidden;
}

.col-detail-round { width: 5rem; }
.col-detail-place { width: 3.25rem; }
.col-detail-points { width: 3.75rem; }
.col-detail-kills { width: 3.25rem; }
.col-detail-total { width: 3.75rem; }
.col-detail-members { width: 42%; }

.detail-table th,
.detail-table td {
  padding: 0.5rem 0.65rem;
  font-size: 0.8rem;
  text-align: center;
  border-bottom: 1px solid #f0f0f2;
  vertical-align: middle;
}

.detail-table th.th-members,
.detail-table td.td-members {
  text-align: left;
  vertical-align: top;
  min-width: 10rem;
}

.detail-table thead th {
  background: #fafafa;
  color: #86868b;
  font-weight: 600;
  white-space: nowrap;
}

.detail-table tbody tr:last-child td {
  border-bottom: 1px solid #f0f0f2;
}

.detail-table tfoot .detail-total-row td {
  background: #f5f5f7;
  border-bottom: none;
  font-weight: 700;
  color: #1d1d1f;
}

.detail-table tfoot .detail-total-row td.td-members {
  font-weight: 600;
}

.detail-map {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.72rem;
  color: #86868b;
}

.member-brief-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
}

.member-brief {
  font-size: 0.78rem;
  color: #424245;
}

:deep(.expand-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  border: 1px solid #e5e5ea;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}

:deep(.expand-btn:hover) {
  border-color: #0071e3;
  background: rgba(0, 113, 227, 0.06);
}

:deep(.expand-btn.open) {
  background: rgba(0, 113, 227, 0.1);
  border-color: rgba(0, 113, 227, 0.35);
}

:deep(.expand-icon) {
  display: block;
  width: 0.4rem;
  height: 0.4rem;
  border-right: 2px solid #0071e3;
  border-bottom: 2px solid #0071e3;
  transform: rotate(45deg) translateY(-1px);
  transition: transform 0.15s ease;
}

:deep(.expand-btn.open .expand-icon) {
  transform: rotate(-135deg) translateY(1px);
}

:global(.dark-mode) .match-page .season-tree {
  background: #1c1c1e;
  border-color: #48484a;
}

:global(.dark-mode) .match-page .tree-node:hover {
  background: #2c2c2e;
}

:global(.dark-mode) .match-page .tree-node.active {
  background: rgba(64, 158, 255, 0.12);
}

:global(.dark-mode) .match-page .tree-node-label {
  color: #f5f5f7;
}

:global(.dark-mode) .match-page .tree-node.active .tree-node-label {
  color: #409eff;
}

:global(.dark-mode) .match-page .tree-children {
  border-color: #48484a;
}

:global(.dark-mode) .match-page .kill-leaderboard-table thead th {
  background: #2c2c2e;
  color: #a1a1a6;
}

:global(.dark-mode) .match-page .kill-leaderboard-table th,
:global(.dark-mode) .match-page .kill-leaderboard-table td {
  border-color: #3a3a3c;
}

:global(.dark-mode) .match-page .kill-leaderboard-row:hover {
  background: #242426;
}

:global(.dark-mode) .match-page .kill-leaderboard-row.is-mine {
  background: rgba(64, 158, 255, 0.1);
}

:global(.dark-mode) .match-page .kill-leaderboard-row.is-mine:hover {
  background: rgba(64, 158, 255, 0.14);
}

:global(.dark-mode) .match-page .td-kill-total {
  color: #f5f5f7;
}

:global(.dark-mode) .match-page .standings-board,
:global(.dark-mode) .match-page .overview-stat-card,
:global(.dark-mode) .match-page .overview-card,
:global(.dark-mode) .match-page .detail-member-row {
  background: #1c1c1e;
  border-color: #48484a;
}

:global(.dark-mode) .match-page .standings-table thead th {
  background: #2c2c2e;
  color: #a1a1a6;
}

:global(.dark-mode) .match-page .standings-table th,
:global(.dark-mode) .match-page .standings-table td {
  border-color: #3a3a3c;
}

:global(.dark-mode) .match-page .standings-main-row.is-mine .td-expand {
  background: rgba(64, 158, 255, 0.1);
}

:global(.dark-mode) .match-page .standings-main-row.is-mine:hover .td-expand,
:global(.dark-mode) .match-page .standings-main-row.is-mine.expanded .td-expand {
  background: rgba(64, 158, 255, 0.14);
}

:global(.dark-mode) .match-page .standings-main-row:hover .td-expand,
:global(.dark-mode) .match-page .standings-main-row.expanded .td-expand {
  background: #242426;
}

:global(.dark-mode) .match-page .td-expand,
:global(.dark-mode) .match-page .th-expand {
  background: #1c1c1e;
}

:global(.dark-mode) .match-page .standings-table thead th.th-expand {
  background: #2c2c2e;
}

:global(.dark-mode) .match-page .standings-main-row:hover,
:global(.dark-mode) .match-page .standings-main-row.expanded {
  background: #242426;
}

:global(.dark-mode) .match-page .standings-main-row.is-mine {
  background: rgba(64, 158, 255, 0.1);
}

:global(.dark-mode) .match-page .standings-main-row.is-mine:hover,
:global(.dark-mode) .match-page .standings-main-row.is-mine.expanded {
  background: rgba(64, 158, 255, 0.14);
}

:global(.dark-mode) .match-page .standings-detail-row .td-detail {
  background: #242426;
}

:global(.dark-mode) .match-page .standings-detail-row.is-mine .td-detail {
  background: rgba(64, 158, 255, 0.08);
}

:global(.dark-mode) .match-page .detail-table {
  background: #1c1c1e;
  border-color: #48484a;
}

:global(.dark-mode) .match-page .detail-table thead th {
  background: #2c2c2e;
  color: #a1a1a6;
}

:global(.dark-mode) .match-page .detail-table td {
  border-color: #3a3a3c;
  color: #d1d1d6;
}

:global(.dark-mode) .match-page .detail-table tfoot .detail-total-row td {
  background: #2c2c2e;
  color: #f5f5f7;
}

:global(.dark-mode) .match-page .team-name,
:global(.dark-mode) .match-page .td-num {
  color: #f5f5f7;
}

:global(.dark-mode) .match-page .round-brief-item,
:global(.dark-mode) .match-page .member-brief {
  color: #a1a1a6;
}

:global(.dark-mode) .match-page :deep(.expand-btn) {
  background: #2c2c2e;
  border-color: #48484a;
}

:global(.dark-mode) .match-page :deep(.expand-btn:hover) {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.12);
}

:global(.dark-mode) .match-page :deep(.expand-btn.open) {
  background: rgba(64, 158, 255, 0.18);
  border-color: rgba(64, 158, 255, 0.45);
}

:global(.dark-mode) .match-page .standings-title {
  color: #f5f5f7;
}

:global(.dark-mode) .match-page .round-pill {
  background: #2c2c2e;
  border-color: #48484a;
  color: #a1a1a6;
}

:global(.dark-mode) .match-page .overview-mine {
  background: linear-gradient(135deg, rgba(64, 158, 255, 0.18), rgba(64, 158, 255, 0.06));
  border-color: rgba(64, 158, 255, 0.28);
}

:global(.dark-mode) .match-page .overview-mine-value,
:global(.dark-mode) .match-page .overview-stat-value,
:global(.dark-mode) .match-page .overview-card-head h2,
:global(.dark-mode) .match-page .schedule-value,
:global(.dark-mode) .match-page .detail-member-name {
  color: #f5f5f7;
}

:global(.dark-mode) .match-page .overview-section-body,
:global(.dark-mode) .match-page .scoring-formula,
:global(.dark-mode) .match-page .placement-ladder-rank,
:global(.dark-mode) .match-page .scoring-foot,
:global(.dark-mode) .match-page .detail-round-summary {
  color: #d1d1d6;
}

:global(.dark-mode) .match-page .schedule-item,
:global(.dark-mode) .match-page .scoring-formula {
  background: #2c2c2e;
}

:global(.dark-mode) .match-page .placement-ladder-bar {
  background: #3a3a3c;
}

:global(.dark-mode) .match-page .scoring-foot strong,
:global(.dark-mode) .match-page .detail-member-kills {
  color: #ff9f0a;
}

:global(.dark-mode) .match-page .team-name,
:global(.dark-mode) .match-page .team-card-head {
  color: #f5f5f7;
}

:global(.dark-mode) .match-page .slot-item {
  background: #2c2c2e;
  border-color: #48484a;
  color: #f5f5f7;
}

:global(.dark-mode) .match-page .slot-item.empty.clickable {
  background: #1c1c1e;
}

:global(.dark-mode) .match-page .slot-item.empty.clickable:hover,
:global(.dark-mode) .match-page .slot-item.mine {
  background: #1a3a5c;
  border-color: #409eff;
}

:global(.dark-mode) .match-page .slot-line {
  color: #f5f5f7;
}

:global(.dark-mode) .match-page .member-spark,
:global(.dark-mode) .match-page .team-spark-stats {
  color: #ff9f0a;
}

:global(.dark-mode) .match-page .member-level {
  color: #bf5af2;
}

:global(.dark-mode) .match-page .member-game-id {
  color: #d1d1d6;
}

:global(.dark-mode) .match-page .member-sep {
  color: #a1a1a6;
}

:global(.dark-mode) .match-page .hint,
:global(.dark-mode) .match-page .muted {
  color: #a1a1a6;
}

@media (max-width: 900px) {
  .match-layout {
    flex-direction: column;
  }

  .match-side-tree {
    flex: none;
    width: 100%;
    position: static;
  }

  .tree-children {
    margin-left: 0.35rem;
  }

  .overview-quick-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .overview-grid {
    grid-template-columns: 1fr;
  }

  .standings-table th,
  .standings-table td {
    padding: 0.6rem 0.65rem;
  }

  .th-num,
  .td-num {
    width: 72px;
  }
}

@media (max-width: 1200px) {
  .lobby-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .lobby-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .lobby-grid {
    grid-template-columns: 1fr;
  }
}
</style>
