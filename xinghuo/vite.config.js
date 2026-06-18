import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // 将/api开头的请求代理到后端服务器
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('element-plus')) return 'element-plus'
          if (id.includes('vue-router')) return 'vue-router'
          if (id.includes('pinia')) return 'pinia'
          if (id.includes('/vue/') || id.includes('/@vue/')) return 'vue-core'
        }
      }
    },
    // 启用CSS代码分割
    cssCodeSplit: true,
    // 弱网环境：略提高压缩门槛，减小首屏 JS 体积
    chunkSizeWarningLimit: 600,
    // 生成sourcemap用于调试
    sourcemap: false
  }
})
