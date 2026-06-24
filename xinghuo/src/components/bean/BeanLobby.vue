<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { beanApi } from '../../services/api'
import { avatarDisplayUrl, handleAvatarImgError } from '../../utils/avatar'
import { useAuthStore } from '../../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const loading = ref(false)
const tables = ref([])
const FIXED_TABLE_COUNT = 12

const myUserId = computed(() => Number(auth.userData?.id || 0))
const formatTableName = (no) => `豆子桌-${String(no).padStart(2, '0')}`

const tableSlots = computed(() => {
  const byName = new Map((tables.value || []).map((table) => [table.tableName, table]))
  return Array.from({ length: FIXED_TABLE_COUNT }, (_, idx) => {
    const slotNo = idx + 1
    const tableName = formatTableName(slotNo)
    const real = byName.get(tableName)
    if (real) {
      return {
        ...real,
        slotNo,
        isTemplate: false,
      }
    }
    return {
      id: null,
      slotNo,
      tableName,
      ownerUserId: null,
      ownerName: '',
      status: 'empty',
      softLocked: false,
      currentSessionId: null,
      players: [],
      isTemplate: true,
    }
  })
})

const waitingCount = computed(() => tableSlots.value.filter((t) => t.status === 'waiting').length)
const playingCount = computed(() => tableSlots.value.filter((t) => t.status === 'playing').length)
const settlingCount = computed(() => tableSlots.value.filter((t) => t.status === 'settling').length)
const emptyCount = computed(() => tableSlots.value.filter((t) => t.status === 'empty').length)

const loadTables = async () => {
  loading.value = true
  try {
    const data = await beanApi.listTables()
    tables.value = data.tables || []
  } catch (error) {
    ElMessage.error(error.message || '加载豆子局大厅失败')
  } finally {
    loading.value = false
  }
}

const buildDetailQuery = (table) => {
  const me = (table?.players || []).find((p) => Number(p.userId) === myUserId.value)
  return {
    myPubgPlayerId: me?.pubgPlayerId || '',
    myPubgPlayerName: me?.pubgPlayerName || '',
    myPubgPlatform: me?.pubgPlatform || '',
  }
}

const resolveRealTable = async (table) => {
  if (table?.id) return table
  await loadTables()
  return tables.value.find((item) => item.tableName === table?.tableName) || null
}

const join = async (table, seatNo) => {
  const realTable = await resolveRealTable(table)
  if (!realTable?.id) {
    ElMessage.warning('后端还未返回该固定桌，请刷新或确认后端已重启')
    return
  }
  try {
    await beanApi.joinTable(realTable.id, { seatNo })
    ElMessage.success('加入成功')
    await loadTables()
    const latest = tables.value.find((item) => Number(item.id) === Number(realTable.id))
    await router.push({ name: 'beanTableDetail', params: { tableId: realTable.id }, query: buildDetailQuery(latest || realTable) })
  } catch (error) {
    ElMessage.error(error.message || '加入失败')
  }
}

const leave = async (table) => {
  if (!table?.id) return
  try {
    await beanApi.leaveTable(table.id)
    ElMessage.success('已离桌')
    await loadTables()
  } catch (error) {
    ElMessage.error(error.message || '离桌失败')
  }
}

const openDetail = (table) => {
  return resolveRealTable(table).then((realTable) => {
    if (!realTable?.id) {
      ElMessage.warning('后端还未返回该固定桌，请刷新或确认后端已重启')
      return
    }
    const latest = tables.value.find((item) => Number(item.id) === Number(realTable.id))
    return router.push({ name: 'beanTableDetail', params: { tableId: realTable.id }, query: buildDetailQuery(latest || realTable) })
  })
}

const statusTagType = (status) => {
  if (status === 'waiting') return 'info'
  if (status === 'playing') return 'warning'
  if (status === 'settling') return 'primary'
  if (status === 'empty') return ''
  return 'success'
}

const statusLabel = (status) => {
  if (status === 'waiting') return '待开局'
  if (status === 'playing') return '对局中'
  if (status === 'settling') return '结算中'
  if (status === 'settled') return '已结算'
  if (status === 'preview') return '待确认'
  if (status === 'failed') return '失败'
  if (status === 'empty') return '空模板'
  return status || '未知'
}

const mySeatInTable = (table) => (table.players || []).find((p) => Number(p.userId) === myUserId.value)
const seatPlayer = (table, seatNo) => (table.players || []).find((p) => Number(p.seatNo) === Number(seatNo))
const displayName = (player) => player?.realName || player?.username || '玩家'
const displayScore = (table, player) => {
  if (!player) return 0
  if (table.status === 'waiting' || table.status === 'empty') return 0
  return Number(player.currentScore || 0)
}
const seatPositionClass = (seatNo) => {
  if (seatNo === 1) return 'seat-top'
  if (seatNo === 2) return 'seat-right'
  if (seatNo === 3) return 'seat-bottom'
  return 'seat-left'
}
const handleSeatClick = async (table, seatNo) => {
  const realTable = await resolveRealTable(table)
  if (!realTable?.id) {
    ElMessage.warning('后端还未返回该固定桌，请刷新或确认后端已重启')
    return
  }
  const player = seatPlayer(realTable, seatNo)
  if (player) {
    if (Number(player.userId) === myUserId.value && realTable.status === 'waiting') {
      await leave(realTable)
      return
    }
    openDetail(realTable)
    return
  }
  if (realTable.status !== 'waiting') {
    ElMessage.warning('该桌当前不可入座')
    return
  }
  if (mySeatInTable(realTable)) {
    ElMessage.warning('你已在该桌，请先离桌后再换位')
    return
  }
  await join(realTable, seatNo)
}

onMounted(async () => {
  await loadTables()
})
</script>

<template>
  <div class="bean-lobby-page">
    <div class="lobby-topbar">
      <div class="topbar-left">
        <h2>豆子局 · 大厅</h2>
        <p class="subtitle">固定 12 张桌位模板（每行 3 张），点击桌位进入对局详情</p>
      </div>
      <div class="topbar-right">
        <div class="pill active-pill">固定桌 12/12</div>
        <div class="pill">空模板 {{ emptyCount }}</div>
        <div class="pill">待开 {{ waitingCount }}</div>
        <div class="pill">进行中 {{ playingCount }}</div>
        <div class="pill">结算中 {{ settlingCount }}</div>
        <el-button size="small" :loading="loading" @click="loadTables">刷新</el-button>
      </div>
    </div>

    <section class="table-grid-wrap">
      <el-skeleton :loading="loading" animated>
        <template #template>
          <el-skeleton-item variant="rect" style="height: 84px; margin-bottom: 10px" />
        </template>
        <template #default>
          <div class="table-grid">
            <div
              v-for="table in tableSlots"
              :key="table.slotNo"
              class="table-card"
              :class="{ 'template-card': table.isTemplate }"
            >
              <div class="table-title-row">
                <strong>{{ table.tableName }}</strong>
                <el-tag size="small" :type="statusTagType(table.status)">{{ statusLabel(table.status) }}</el-tag>
              </div>

              <div class="qq-desk">
                <div class="desk-center" @click="openDetail(table)">
                  <div class="desk-name">红包局桌面</div>
                  <div class="desk-sub">桌主：{{ table.players.length ? (table.ownerName || '-') : '-' }}</div>
                  <div class="desk-sub">会话：{{ table.currentSessionId || '-' }}</div>
                </div>

                <div
                  v-for="seatNo in [1, 2, 3, 4]"
                  :key="seatNo"
                  class="seat-node"
                  :class="[seatPositionClass(seatNo), { occupied: !!seatPlayer(table, seatNo) }]"
                  @click="handleSeatClick(table, seatNo)"
                >
                  <template v-if="seatPlayer(table, seatNo)">
                    <el-avatar
                      :size="40"
                      :src="avatarDisplayUrl(seatPlayer(table, seatNo)?.avatar)"
                      @error="handleAvatarImgError"
                    >
                      {{ (displayName(seatPlayer(table, seatNo)).slice(0, 1) || '玩') }}
                    </el-avatar>
                    <div class="seat-name">{{ displayName(seatPlayer(table, seatNo)) }}</div>
                    <div class="seat-score">当前积分：{{ displayScore(table, seatPlayer(table, seatNo)) }}</div>
                  </template>
                  <template v-else>
                    <div class="empty-seat-mark">+ 加入</div>
                  </template>
                </div>
              </div>

              <div class="table-foot">
                <span>人数 {{ table.players.length }}/4</span>
                <span>我的游戏ID：{{ mySeatInTable(table)?.pubgPlayerName || '-' }}</span>
              </div>
            </div>
          </div>
        </template>
      </el-skeleton>
    </section>
  </div>
</template>

<style scoped>
.bean-lobby-page {
  padding: 0 1rem 1.5rem;
  background: linear-gradient(180deg, #eef4ff 0%, #f7f9ff 100%);
}

.lobby-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  background: linear-gradient(120deg, #2f5fe6 0%, #5f7dff 50%, #7b67ff 100%);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 14px;
  padding: 0.85rem 1rem;
  margin-bottom: 1rem;
  box-shadow: 0 12px 24px rgba(56, 86, 201, 0.18);
}

.topbar-left h2 {
  margin: 0;
  font-size: 1.24rem;
  color: #fff;
}

.subtitle {
  margin: 0.2rem 0 0;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.82rem;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.pill {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 999px;
  font-size: 0.76rem;
  padding: 0.2rem 0.62rem;
}

.active-pill {
  background: rgba(255, 255, 255, 0.24);
  font-weight: 600;
}

.table-grid-wrap {
  background: #ffffff;
  border: 1px solid #dbe5ff;
  border-radius: 14px;
  padding: 0.9rem;
  box-shadow: 0 8px 18px rgba(55, 82, 187, 0.08);
}

.table-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(280px, 1fr));
  gap: 1rem;
}

.table-card {
  border: 1px solid #dbe4ff;
  border-radius: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #f8faff 100%);
  padding: 0.78rem;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  min-height: 360px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow: hidden;
}

.table-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 20px rgba(52, 80, 183, 0.12);
}

.template-card {
  border-style: dashed;
  background: linear-gradient(180deg, #f8faff 0%, #f3f7ff 100%);
}

.table-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.18rem;
}

.qq-desk {
  width: min(100%, 292px);
  aspect-ratio: 1 / 1;
  align-self: center;
  border-radius: 12px;
  background: radial-gradient(circle at 50% 45%, #eaf2ff 0%, #f8fbff 65%);
  border: 1px solid #d8e4ff;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  grid-template-areas:
    ". top ."
    "left center right"
    ". bottom .";
  gap: 8px;
  padding: 10px;
  overflow: hidden;
}

.desk-center {
  grid-area: center;
  width: 100%;
  height: 100%;
  border-radius: 14px;
  background: linear-gradient(135deg, #5f7dff 0%, #5968f1 100%);
  color: #fff;
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 8px 14px rgba(68, 88, 199, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.22) inset;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  align-self: stretch;
  justify-self: stretch;
}

.desk-center:hover {
  transform: scale(1.02);
  box-shadow: 0 12px 20px rgba(68, 88, 199, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.25) inset;
}

.desk-name {
  font-size: 0.83rem;
  font-weight: 700;
}

.desk-sub {
  font-size: 0.7rem;
  opacity: 0.95;
  margin-top: 2px;
}

.seat-node {
  width: 100%;
  min-width: 0;
  min-height: 0;
  border-radius: 12px;
  border: 1px dashed #9db0df;
  background: #f7faff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 4px;
  box-sizing: border-box;
}

.seat-node:hover {
  border-color: #6d8dff;
  background: #eef4ff;
}

.seat-node.occupied {
  border-style: solid;
  border-color: #6d8dff;
  background: #eef4ff;
  box-shadow: 0 0 0 1px rgba(109, 141, 255, 0.25), 0 8px 14px rgba(90, 111, 210, 0.18);
  animation: seatPulse 2.6s ease-in-out infinite;
}

.seat-top {
  grid-area: top;
}

.seat-right {
  grid-area: right;
}

.seat-bottom {
  grid-area: bottom;
}

.seat-left {
  grid-area: left;
}

.seat-name {
  max-width: 92px;
  font-size: 0.76rem;
  color: #1f2937;
  line-height: 1.1;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.seat-score {
  font-size: 0.7rem;
  color: #4b5563;
}

.empty-seat-mark {
  font-size: 0.78rem;
  color: #51629c;
  font-weight: 600;
}

.table-foot {
  margin-top: 0.2rem;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-size: 0.78rem;
  color: #55627c;
}

@keyframes seatPulse {
  0%, 100% {
    box-shadow: 0 0 0 1px rgba(109, 141, 255, 0.25), 0 8px 14px rgba(90, 111, 210, 0.18);
  }
  50% {
    box-shadow: 0 0 0 2px rgba(109, 141, 255, 0.34), 0 10px 18px rgba(90, 111, 210, 0.26);
  }
}

.empty-box {
  border: 1px dashed #d1d5db;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
  color: #6b7280;
}

@media (max-width: 980px) {
  .table-grid {
    grid-template-columns: repeat(2, minmax(270px, 1fr));
  }

  .qq-desk {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .lobby-topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .topbar-right {
    width: 100%;
  }

  .table-grid {
    grid-template-columns: 1fr;
  }

  .table-card {
    min-height: 340px;
  }

  .qq-desk {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: repeat(3, minmax(0, 1fr));
    gap: 6px;
    padding: 8px;
  }
}
</style>
