/**
 * 运行模式：生产默认关闭本地测试数据。
 * 本地开发在 .env 中设置 VITE_USE_MOCK_DATA=true 并复制 mock 夹具文件即可预览。
 */
export function isMockDataEnabled() {
  return String(import.meta.env.VITE_USE_MOCK_DATA || '').toLowerCase() === 'true'
}

export function isProductionDataMode() {
  return !isMockDataEnabled()
}
