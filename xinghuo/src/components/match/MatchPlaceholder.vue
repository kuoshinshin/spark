<script setup>
</script>

<template>
  <div class="match-placeholder">
    <div class="container">
      <el-card shadow="hover" class="placeholder-card">
        <h2>比赛模块</h2>
        <p class="lead">正在重新设计中，敬请期待。</p>
        <p class="hint">报名、组队、积分榜等功能将随新版本上线。</p>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.match-placeholder {
  padding: 2rem 0 4rem;
}

.container {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 1rem;
}

.placeholder-card {
  text-align: center;
  padding: 3rem 2rem;
  border-radius: 12px;
}

.placeholder-card h2 {
  margin: 0 0 1rem;
  font-size: 1.5rem;
  color: #1d1d1f;
}

.lead {
  margin: 0 0 0.75rem;
  font-size: 1.05rem;
  color: #424245;
}

.hint {
  margin: 0;
  font-size: 0.95rem;
  color: #86868b;
}
</style>
