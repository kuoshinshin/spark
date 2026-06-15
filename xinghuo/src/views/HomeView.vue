<script setup>
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

const router = useRouter()

const handleSlideButtonClick = (action) => {
  const messages = {
    join: '欢迎加入 PUBG Spark Squad！',
    learn: '了解更多关于 PUBG Spark Squad 的信息',
    schedule: '查看比赛赛程',
    register: '报名参加比赛',
    details: '查看活动详情',
    attend: '报名参加线下聚会',
  }
  const text = messages[action]
  if (text) ElMessage.info(text)
}
</script>

<template>
  <div>
    <section class="hero-carousel">
      <div class="container">
        <el-carousel :interval="5000" type="default" height="600px">
          <el-carousel-item>
            <div class="carousel-slide">
              <h3>欢迎加入 PUBG Spark Squad</h3>
              <p>与队友一起征战沙场，共创辉煌</p>
              <el-button type="primary" @click="handleSlideButtonClick('join')">立即加入</el-button>
            </div>
          </el-carousel-item>
          <el-carousel-item>
            <div class="carousel-slide">
              <h3>了解更多关于我们</h3>
              <p>探索团队文化，了解我们的使命</p>
              <el-button type="primary" @click="handleSlideButtonClick('learn')">了解详情</el-button>
            </div>
          </el-carousel-item>
          <el-carousel-item>
            <div class="carousel-slide">
              <h3>队内赛事（筹备中）</h3>
              <p>比赛模块正在重新设计</p>
              <el-button type="primary" @click="router.push('/match')">了解更多</el-button>
            </div>
          </el-carousel-item>
          <el-carousel-item>
            <div class="carousel-slide">
              <h3>参与我们的活动</h3>
              <p>报名参加线下聚会和线上活动</p>
              <el-button type="primary" @click="handleSlideButtonClick('attend')">立即报名</el-button>
            </div>
          </el-carousel-item>
        </el-carousel>
      </div>
    </section>

    <section class="features">
      <div class="container">
        <h2>我们的功能</h2>
        <div class="features-grid">
          <el-card class="feature-card" shadow="hover">
            <template #header>
              <div class="card-header">
                <h3>实时交流</h3>
              </div>
            </template>
            <p>与队友实时聊天，讨论战术，分享游戏体验</p>
            <el-button type="primary" @click="router.push('/chat')">开始聊天</el-button>
          </el-card>

          <el-card class="feature-card" shadow="hover">
            <template #header>
              <div class="card-header">
                <h3>比赛</h3>
              </div>
            </template>
            <p>队内赛事模块筹备中，新版本上线后将支持报名与积分榜</p>
            <el-button type="primary" @click="router.push('/match')">进入比赛</el-button>
          </el-card>

          <el-card class="feature-card" shadow="hover">
            <template #header>
              <div class="card-header">
                <h3>个人中心</h3>
              </div>
            </template>
            <p>管理你的个人资料，查看游戏统计，设置偏好</p>
            <el-button type="primary" @click="router.push('/profile')">进入中心</el-button>
          </el-card>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero-carousel {
  min-height: 80vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0 0 2rem;
}

.carousel-slide {
  text-align: center;
  padding: 4rem 2rem;
  color: #1d1d1f;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  width: 100%;
  background-color: #f5f5f7;
  border-radius: 8px;
}

.hero-carousel .container {
  flex: 1;
  width: 100%;
}

.features {
  padding: 3rem 0 4rem;
}

.features h2 {
  text-align: center;
  margin-bottom: 4rem;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 3rem;
}

.feature-card {
  text-align: center;
  padding: 3rem 2rem;
  background-color: #f5f5f7;
  border-radius: 12px;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
}

.feature-card h3 {
  margin-bottom: 1rem;
}

.feature-card p {
  margin-bottom: 2rem;
}

.container {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
}

@media (max-width: 768px) {
  .features {
    padding: 2.5rem 0 3rem;
  }

  .features-grid {
    gap: 2rem;
  }
}
</style>
