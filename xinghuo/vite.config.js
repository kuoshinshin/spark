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
        // 代码分割配置
        manualChunks: {
          // 将第三方库分离到单独的代码块
          'vendor': ['vue', 'element-plus'],
          'chat': ['./src/components/chat/Chat.vue'],
          'profile': ['./src/components/profile/Profile.vue']
        }
      }
    },
    // 启用CSS代码分割
    cssCodeSplit: true,
    // 生成sourcemap用于调试
    sourcemap: false
  }
})
