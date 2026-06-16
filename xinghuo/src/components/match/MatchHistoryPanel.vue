<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { eventApi } from '../../services/api'
import { useAuthStore } from '../../stores/auth'

const props = defineProps({
  eventId: {
    type: Number,
    required: true,
  },
})

const auth = useAuthStore()
const detailLoading = ref(false)
const archive = ref(null)
const detailTab = ref('standings')
const expandedTeamId = ref(null)
const detailLoadingTeamId = ref(null)
const teamDetailCache = ref({})

const formatDate = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const loadArchive = async (eventId) => {
  if (!eventId) return
  detailLoading.value = true
  detailTab.value = 'standings'
  expandedTeamId.value = null
  teamDetailCache.value = {}
  try {
    archive.value = await eventApi.getHistoryArchive(eventId)
  } catch (e) {
    archive.value = null
    ElMessage.error(e.message || '加载赛季详情失败')
  } finally {
    detailLoading.value = false
  }
}

watch(
  () => props.eventId,
  (eventId) => {
    loadArchive(eventId)
  },
  { immediate: true }
)

const isTeamExpanded = (teamId) => expandedTeamId.value === teamId

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

const toggleTeamDetail = async (row) => {
  if (expandedTeamId.value === row.teamId) {
    expandedTeamId.value = null
    return
  }
  expandedTeamId.value = row.teamId
  if (teamDetailCache.value[row.teamId]) return
  detailLoadingTeamId.value = row.teamId
  try {
    const data = await eventApi.getHistoryTeamRoundDetails(props.eventId, row.teamId)
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

const isMyKillRow = (row) => row.userId && auth.userData?.id === row.userId

const rankBadgeClass = (rank) => {
  if (rank === 1) return 'rank-gold'
  if (rank === 2) return 'rank-silver'
  if (rank === 3) return 'rank-bronze'
  return ''
}
</script>

<template>
  <div class="history-detail" v-loading="detailLoading">
    <template v-if="archive">
      <header class="history-detail-head">
        <div>
          <h2>{{ archive.event?.title }}</h2>
          <p class="history-subtitle">结束于 {{ formatDate(archive.event?.finishedAt) }}</p>
        </div>
        <div class="history-summary-pills">
          <span v-if="archive.summary?.championTeamName" class="summary-pill">
            冠军 #{{ String(archive.summary.championTeamNumber).padStart(2, '0') }}
            {{ archive.summary.championTeamName }}
          </span>
          <span v-if="archive.summary?.topKillerName" class="summary-pill">
            击杀王 {{ archive.summary.topKillerName }} · {{ archive.summary.topKillerKills }}杀
          </span>
          <span class="summary-pill">{{ archive.summary?.totalRounds ?? 0 }} 局</span>
        </div>
      </header>

      <el-tabs v-model="detailTab" class="history-tabs">
        <el-tab-pane label="积分榜" name="standings">
          <div class="standings-board">
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
                  <th>排名</th>
                  <th>队伍名称</th>
                  <th>总排名分</th>
                  <th>总击杀分</th>
                  <th>总分</th>
                  <th class="th-brief">简略详情</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="row in archive.standings || []" :key="row.teamId">
                  <tr
                    class="standings-main-row"
                    :class="{
                      expanded: isTeamExpanded(row.teamId),
                      [rankBadgeClass(row.rank)]: true,
                    }"
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
                    <td class="td-rank"><span class="rank-num">{{ row.rank }}</span></td>
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
                  <tr v-if="isTeamExpanded(row.teamId)" class="standings-detail-row">
                    <td colspan="7" class="td-detail">
                      <div class="standings-expand-panel" v-loading="detailLoadingTeamId === row.teamId">
                        <table v-if="teamDetailRounds(row.teamId).length" class="detail-table">
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
                              <td>第{{ round.roundNo }}局</td>
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
                                <span
                                  v-if="teamDetailTotal(row.teamId).hasMemberDetails"
                                  class="member-brief-list"
                                >
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
                        <el-empty v-else description="暂无局次成绩" :image-size="48" />
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </el-tab-pane>

        <el-tab-pane label="击杀榜" name="kill-leaderboard">
          <div class="standings-board">
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
                  v-for="row in archive.leaderboard || []"
                  :key="`${row.teamId}-${row.userId || row.rank}`"
                  class="kill-leaderboard-row"
                  :class="{ 'is-mine': isMyKillRow(row), [rankBadgeClass(row.rank)]: true }"
                >
                  <td class="td-rank"><span class="rank-num">{{ row.rank }}</span></td>
                  <td class="td-kill-team">
                    <div class="kill-team-cell">
                      <span class="team-no">#{{ String(row.teamNumber).padStart(2, '0') }}</span>
                      <span class="team-name">{{ row.teamName }}</span>
                    </div>
                  </td>
                  <td>{{ row.realName }}</td>
                  <td>{{ row.gameId || '—' }}</td>
                  <td class="td-kill-total">{{ row.totalKills }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </el-tab-pane>
      </el-tabs>
    </template>

    <el-empty v-else-if="!detailLoading" description="未能加载该届杯赛数据" />
  </div>
</template>

<style scoped>
.history-detail {
  min-height: 320px;
}

.history-subtitle {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  color: #86868b;
}

.history-detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.history-detail-head h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.history-summary-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.summary-pill {
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  background: #f5f5f7;
  font-size: 0.78rem;
  color: #424245;
}

.standings-board {
  border: 1px solid #e5e5ea;
  border-radius: 12px;
  overflow-x: auto;
  overflow-y: visible;
  background: #fff;
  padding: 0 2px;
}

.standings-table,
.kill-leaderboard-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.standings-table { min-width: 640px; }
.kill-leaderboard-table { min-width: 560px; }

.col-expand { width: 3.5rem; }
.col-rank, .col-kill-rank { width: 3.5rem; }
.col-team-name { width: 11rem; }
.col-num { width: 5.5rem; }
.col-kill-team { width: 28%; }
.col-kill-name { width: 18%; }
.col-kill-game-id { width: 28%; }
.col-kill-total { width: 6.5rem; }
.col-detail-round { width: 5rem; }
.col-detail-place { width: 3.25rem; }
.col-detail-points { width: 3.75rem; }
.col-detail-kills { width: 3.25rem; }
.col-detail-total { width: 3.75rem; }
.col-detail-members { width: 42%; }

.standings-table th,
.standings-table td,
.kill-leaderboard-table th,
.kill-leaderboard-table td {
  padding: 0.7rem 0.85rem;
  vertical-align: middle;
  border-bottom: 1px solid #f0f0f2;
  text-align: center;
  font-size: 0.85rem;
}

.standings-table thead th,
.kill-leaderboard-table thead th {
  background: #f5f5f7;
  font-size: 0.75rem;
  font-weight: 600;
  color: #86868b;
}

.standings-table thead th.th-brief,
.td-brief,
.td-kill-team {
  text-align: left;
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

.standings-main-row.expanded .td-expand {
  background: #f8f8fa;
}

.team-name-cell,
.kill-team-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.td-kill-team .kill-team-cell {
  justify-content: flex-start;
}

.team-no {
  font-size: 0.8rem;
  font-weight: 700;
  color: #0071e3;
}

.team-name {
  font-weight: 600;
  color: #1d1d1f;
}

.td-num, .td-total, .td-kill-total {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rank-num { font-weight: 700; }
.rank-gold .rank-num { color: #9a6b00; }
.rank-silver .rank-num { color: #5c6670; }
.rank-bronze .rank-num { color: #8a4d2a; }

.round-brief {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.85rem;
  margin: 0;
}

.round-brief-item {
  font-size: 0.75rem;
  color: #86868b;
}

.standings-detail-row .td-detail {
  padding: 0;
  background: #f8f8fa;
}

.standings-expand-panel {
  padding: 0.75rem 0.85rem;
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  background: #fff;
  border: 1px solid #e5e5ea;
  border-radius: 8px;
}

.detail-table th,
.detail-table td {
  padding: 0.5rem 0.65rem;
  font-size: 0.8rem;
  text-align: center;
  border-bottom: 1px solid #f0f0f2;
}

.detail-table th.th-members,
.detail-table td.td-members {
  text-align: left;
}

.detail-table thead th {
  background: #fafafa;
  color: #86868b;
  font-weight: 600;
}

.detail-table tfoot .detail-total-row td {
  background: #f5f5f7;
  font-weight: 700;
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

.kill-leaderboard-row.is-mine {
  background: rgba(0, 113, 227, 0.05);
}

.muted {
  color: #86868b;
}
</style>
