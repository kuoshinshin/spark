/**
 * 避免 api 层与 router/store 形成循环依赖：401 时通过桥接回调交给应用层处理。
 */
let onUnauthorized = () => {}

export function setUnauthorizedHandler (fn) {
  onUnauthorized = typeof fn === 'function' ? fn : () => {}
}

export function triggerUnauthorized () {
  try {
    onUnauthorized()
  } catch (e) {
    console.error('onUnauthorized failed:', e)
  }
}
