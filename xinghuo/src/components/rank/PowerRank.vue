<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { userApi } from '../../services/api'
import { useAuthStore } from '../../stores/auth'
import { avatarDisplayUrl, handleAvatarImgError } from '../../utils/avatar'
import { sparkLevelFromScore } from '../../utils/sparkLevel'

const router = useRouter()
const auth = useAuthStore()

const loading = ref(false)
const leaderboard = ref([])
const myRank = ref(null)
const total = ref(0)

const fetchLeaderboard = async () => {
  loading.value = true
  try {
    const data = await userApi.getPowerLeaderboard({ limit: 100 })
    leaderboard.value = data.leaderboard || []
    myRank.value = data.myRank || null
    total.value = Number(data.total || 0)
  } catch (error) {
    ElMessage.error(error?.message || '加载排行榜失败')
  } finally {
    loading.value = false
  }
}

const rankBadgeClass = (rank) => {
  if (rank === 1) return 'rank-gold'
  if (rank === 2) return 'rank-silver'
  if (rank === 3) return 'rank-bronze'
  return ''
}

const displayLevel = (row) => row.level || sparkLevelFromScore(row.score)

const isMine = (row) => row.userId && auth.userData?.id === row.userId

const topThree = computed(() => leaderboard.value.filter((row) => row.rank <= 3))

const restRows = computed(() => leaderboard.value.filter((row) => row.rank > 3))

const goProfile = (userId) => {
  if (!userId) return
  router.push({ name: 'profile', query: { userId: String(userId) } })
}

onMounted(fetchLeaderboard)
</script>

<template>
  <div class="power-rank-page" v-loading="loading">
    <div class="container power-rank-layout">
      <header class="power-rank-hero">
        <span class="section-kicker">SPARK POWER</span>
        <h1>星火战力排行榜</h1>
        <p class="hero-desc">
          基于当前赛季四排排位战力（v2）排序；绑定 PUBG 并在个人页同步战力后即可上榜。
        </p>
        <p v-if="total > 0" class="hero-meta">共 {{ total }} 位选手有有效战力数据</p>
      </header>

      <section v-if="myRank" class="my-rank-card">
        <div class="my-rank-label">我的排名</div>
        <div class="my-rank-body">
          <span class="my-rank-num">#{{ myRank.rank }}</span>
          <div class="my-rank-info">
            <strong>{{ myRank.realName }}</strong>
            <span>{{ displayLevel(myRank) }} · 战力 {{ myRank.score }}</span>
          </div>
          <el-button type="primary" plain size="small" @click="router.push({ name: 'profile' })">
            查看我的战力
          </el-button>
        </div>
      </section>

      <el-empty v-if="!loading && !leaderboard.length" description="暂无战力数据，请先绑定 PUBG 并刷新战力" />

      <section v-if="topThree.length" class="podium-section">
        <div
          v-for="row in topThree"
          :key="row.userId"
          class="podium-card"
          :class="[rankBadgeClass(row.rank), { 'is-mine': isMine(row) }]"
          @click="goProfile(row.userId)"
        >
          <span class="podium-rank">#{{ row.rank }}</span>
          <el-avatar
            :size="row.rank === 1 ? 72 : 60"
            :src="avatarDisplayUrl(row.avatar)"
            class="podium-avatar"
            @error="handleAvatarImgError"
          />
          <strong class="podium-name">{{ row.realName }}</strong>
          <span class="podium-level">{{ displayLevel(row) }}</span>
          <span class="podium-score">{{ row.score }}</span>
          <span class="podium-sub">KD {{ row.kd }} · 伤害 {{ row.avgDamage }}</span>
        </div>
      </section>

      <section v-if="restRows.length" class="table-section">
        <table class="power-rank-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>选手</th>
              <th>游戏 ID</th>
              <th>评级</th>
              <th>战力值</th>
              <th>KD</th>
              <th>场均伤害</th>
              <th>四排场次</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in restRows"
              :key="row.userId"
              class="power-rank-row"
              :class="{ 'is-mine': isMine(row) }"
              @click="goProfile(row.userId)"
            >
              <td class="td-rank">
                <span class="rank-num" :class="rankBadgeClass(row.rank)">{{ row.rank }}</span>
              </td>
              <td class="td-player">
                <el-avatar
                  :size="36"
                  :src="avatarDisplayUrl(row.avatar)"
                  @error="handleAvatarImgError"
                />
                <span class="player-name">{{ row.realName }}</span>
                <span v-if="row.sampleLimited" class="sample-tag">样本偏少</span>
              </td>
              <td>{{ row.pubgPlayerName || '—' }}</td>
              <td><span class="level-pill">{{ displayLevel(row) }}</span></td>
              <td class="td-score">{{ row.score }}</td>
              <td>{{ row.kd }}</td>
              <td>{{ row.avgDamage }}</td>
              <td>{{ row.matchesAnalyzed }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>

<style scoped>
.power-rank-page {
  min-height: calc(100vh - var(--navbar-height, 64px));
  padding: 1.5rem 0 3rem;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
}

.power-rank-layout {
  max-width: 1080px;
}

.power-rank-hero {
  margin-bottom: 1.5rem;
}

.section-kicker {
  display: inline-block;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  color: #6b7280;
  font-weight: 700;
}

.power-rank-hero h1 {
  margin: 0.35rem 0 0.5rem;
  font-size: clamp(1.6rem, 3vw, 2rem);
  color: #111827;
}

.hero-desc,
.hero-meta {
  margin: 0;
  color: #6b7280;
  font-size: 0.92rem;
  line-height: 1.6;
}

.hero-meta {
  margin-top: 0.35rem;
  color: #9ca3af;
  font-size: 0.82rem;
}

.my-rank-card {
  margin-bottom: 1.25rem;
  padding: 1rem 1.25rem;
  border-radius: 14px;
  background: linear-gradient(135deg, #1f2937, #374151);
  color: #fff;
}

.my-rank-label {
  font-size: 0.75rem;
  opacity: 0.8;
  letter-spacing: 0.08em;
}

.my-rank-body {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.my-rank-num {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1;
}

.my-rank-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
  min-width: 140px;
}

.my-rank-info span {
  font-size: 0.85rem;
  opacity: 0.85;
}

.podium-section {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.podium-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 1.25rem 1rem;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.podium-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.1);
}

.podium-card.is-mine {
  border-color: #3b82f6;
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.25);
}

.podium-card.rank-gold { order: 2; }
.podium-card.rank-silver { order: 1; }
.podium-card.rank-bronze { order: 3; }

.podium-rank {
  font-size: 0.8rem;
  font-weight: 700;
  color: #9ca3af;
}

.podium-name {
  font-size: 1rem;
  color: #111827;
}

.podium-level {
  font-size: 0.82rem;
  color: #6b7280;
}

.podium-score {
  font-size: 1.75rem;
  font-weight: 800;
  color: #111827;
  line-height: 1.1;
}

.podium-sub {
  font-size: 0.78rem;
  color: #9ca3af;
}

.table-section {
  overflow-x: auto;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.power-rank-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 760px;
}

.power-rank-table th,
.power-rank-table td {
  padding: 0.85rem 1rem;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.9rem;
}

.power-rank-table thead th {
  background: #f8fafc;
  color: #6b7280;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.power-rank-row {
  cursor: pointer;
  transition: background 0.12s ease;
}

.power-rank-row:hover {
  background: #f8fafc;
}

.power-rank-row.is-mine {
  background: rgba(59, 130, 246, 0.06);
}

.td-rank .rank-num {
  display: inline-flex;
  min-width: 2rem;
  justify-content: center;
  font-weight: 700;
  color: #374151;
}

.rank-num.rank-gold { color: #b45309; }
.rank-num.rank-silver { color: #6b7280; }
.rank-num.rank-bronze { color: #92400e; }

.td-player {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.player-name {
  font-weight: 600;
  color: #111827;
}

.sample-tag {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: #fff7ed;
  color: #c2410c;
}

.level-pill {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.78rem;
  font-weight: 700;
}

.td-score {
  font-weight: 800;
  color: #111827;
}

@media (max-width: 768px) {
  .podium-section {
    grid-template-columns: 1fr;
  }

  .podium-card.rank-gold,
  .podium-card.rank-silver,
  .podium-card.rank-bronze {
    order: unset;
  }
}
</style>
