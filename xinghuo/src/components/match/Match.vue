<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { eventApi } from '../../services/api'
import { avatarDisplayUrl } from '../../utils/avatar'

const loading = ref(true)
const standingsLoading = ref(false)
const actionLoading = ref(false)
const activeTab = ref('overview')
const event = ref(null)
const teams = ref([])
const mySlot = ref(null)
const standings = ref([])
const rounds = ref([])

const canJoin = computed(() => event.value?.status === 'registration')
const isLocked = computed(() => ['locked', 'scoring', 'finished'].includes(event.value?.status))
const showStandings = computed(() => ['scoring', 'finished'].includes(event.value?.status))
const hasStandingsData = computed(() => standings.value.some((row) => row.totalPoints > 0))

const showPubgId = computed(() => Boolean(event.value?.requirePubgBinding))

const slotMemberName = (slot) => slot.realName || slot.displayName || '—'

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

onMounted(fetchLobby)

watch(activeTab, (tab) => {
  if (tab === 'standings' && showStandings.value && !standings.value.length) {
    fetchStandings()
  }
})
</script>

<template>
  <div class="match-page" v-loading="loading">
    <div class="container">
      <template v-if="event">
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
            <el-card shadow="never" class="info-card">
              <p v-if="event.description" class="desc">{{ event.description }}</p>
              <p v-else class="desc muted">暂无赛事说明</p>
              <ul class="meta-list">
                <li>队伍：16 队 × 四排（每队 5 槽：1 队长 + 4 队员）</li>
                <li v-if="event.registrationOpenAt">报名开始：{{ new Date(event.registrationOpenAt).toLocaleString('zh-CN') }}</li>
                <li v-if="event.registrationCloseAt">报名截止：{{ new Date(event.registrationCloseAt).toLocaleString('zh-CN') }}</li>
                <li v-if="mySlot">我的队伍：{{ mySlot.teamName }}（#{{ mySlot.teamNumber }}）</li>
              </ul>
            </el-card>
          </el-tab-pane>

          <el-tab-pane label="报名" name="lobby">
            <p v-if="!canJoin && !isLocked" class="tab-hint">当前未开放报名</p>
            <p v-else-if="isLocked" class="tab-hint">名单已锁定，仅可查看</p>
            <p v-else class="tab-hint">
              点击空槽位选队；每人仅能占一个位置
              <span v-if="showPubgId"> · 展示真实姓名、游戏 ID 与星火值</span>
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
                  <span class="team-count">{{ team.memberCount }}/5</span>
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
              <p class="tab-hint">按总积分排序；同分比较总击杀</p>
              <div v-loading="standingsLoading">
                <el-empty v-if="!hasStandingsData" description="暂无成绩，等待管理员录入" />
                <el-table v-else :data="standings" border class="standings-table">
                  <el-table-column prop="rank" label="排名" width="70" />
                  <el-table-column label="队伍" min-width="140">
                    <template #default="scope">
                      #{{ scope.row.teamNumber }} {{ scope.row.teamName }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="totalPoints" label="总积分" width="90" sortable />
                  <el-table-column prop="totalKills" label="总击杀" width="90" sortable />
                  <el-table-column label="各局明细" min-width="200">
                    <template #default="scope">
                      <span v-if="!scope.row.rounds?.length" class="muted">—</span>
                      <span v-else class="round-tags">
                        <el-tag
                          v-for="r in scope.row.rounds"
                          :key="r.roundId"
                          size="small"
                          type="info"
                          class="round-tag"
                        >
                          第{{ r.roundNo }}局: {{ r.totalPoints }}分 (#{{ r.placement }})
                        </el-tag>
                      </span>
                    </template>
                  </el-table-column>
                </el-table>
                <div v-if="rounds.length" class="rounds-summary">
                  <h3>局次</h3>
                  <ul>
                    <li v-for="r in rounds" :key="r.id">
                      第 {{ r.roundNo }} 局
                      <span v-if="r.mapName">· {{ r.mapName }}</span>
                      · {{ r.status === 'completed' ? '已完成' : '待录入' }}
                    </li>
                  </ul>
                </div>
              </div>
            </template>
          </el-tab-pane>
        </el-tabs>
      </template>

      <el-empty v-else description="暂无杯赛，请等待管理员发布" />
    </div>
  </div>
</template>

<style scoped>
.match-page {
  padding: 1rem 0 2rem;
  min-height: 60vh;
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

.info-card {
  border-radius: 12px;
}

.desc {
  margin: 0 0 1rem;
  line-height: 1.6;
  white-space: pre-wrap;
}

.meta-list {
  margin: 0;
  padding-left: 1.2rem;
  color: #424245;
  line-height: 1.8;
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

.team-count {
  margin-left: auto;
  font-size: 0.72rem;
  color: #86868b;
  font-weight: 500;
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

.standings-table {
  margin-bottom: 1.5rem;
}

.round-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.round-tag {
  margin: 0;
}

.rounds-summary h3 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  color: #1d1d1f;
}

.rounds-summary ul {
  margin: 0;
  padding-left: 1.2rem;
  color: #424245;
  line-height: 1.8;
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

:global(.dark-mode) .match-page .member-spark {
  color: #ff9f0a;
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
