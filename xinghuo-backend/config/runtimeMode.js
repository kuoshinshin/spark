/**
 * 后端运行模式：生产默认关闭 mock 数据与 mock 路由。
 * 本地在 .env 中设置 MOCK_DATA_ENABLED=true 启用。
 */
function isMockDataEnabled() {
  return String(process.env.MOCK_DATA_ENABLED || '').toLowerCase() === 'true'
}

function isProductionDataMode() {
  return !isMockDataEnabled()
}

module.exports = {
  isMockDataEnabled,
  isProductionDataMode,
}
