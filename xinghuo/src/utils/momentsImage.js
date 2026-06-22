/**
 * 微信朋友圈单图展示尺寸算法（Web 端近似实现）
 * 根据原图宽高比动态计算展示框，避免拉伸与过度裁剪。
 */
export function calcMomentsImageSize(naturalWidth, naturalHeight, options = {}) {
  const maxW = options.maxWidth ?? 270
  const maxH = options.maxHeight ?? 360
  const min = options.minSize ?? 80

  const w = Number(naturalWidth) || maxW
  const h = Number(naturalHeight) || maxW
  if (!w || !h) return { width: maxW, height: maxW }

  const ratio = w / h
  let width
  let height

  if (ratio < 1) {
    // 竖图：限制高度
    height = Math.min(h, maxH)
    width = height * ratio
    if (width < min) {
      width = min
      height = width / ratio
    }
  } else if (ratio > 2.5) {
    // 超长横图
    width = maxW
    height = Math.max(min, width / ratio)
  } else {
    // 横图 / 方图
    width = Math.min(w, maxW)
    height = width / ratio
    if (height > maxH) {
      height = maxH
      width = height * ratio
    }
  }

  return {
    width: Math.round(Math.max(min, width)),
    height: Math.round(Math.max(min, height)),
  }
}

export function getMomentsImageLimits() {
  if (typeof window === 'undefined') {
    return { maxWidth: 270, maxHeight: 360, minSize: 80 }
  }
  const viewportMax = Math.max(200, window.innerWidth - 96)
  if (window.innerWidth >= 768) {
    return { maxWidth: Math.min(300, viewportMax), maxHeight: 400, minSize: 80 }
  }
  return { maxWidth: Math.min(270, viewportMax), maxHeight: 360, minSize: 80 }
}

export function getMomentsImageStyle(size) {
  if (!size) {
    return { width: '200px', height: '200px' }
  }
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
  }
}
