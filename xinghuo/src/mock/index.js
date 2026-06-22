let beanTimelineFixture = null
let beanTimelineFixtureLoaded = false

export async function loadBeanTimelineFixture() {
  if (import.meta.env.VITE_USE_MOCK_DATA !== 'true') return null
  if (beanTimelineFixtureLoaded) return beanTimelineFixture
  beanTimelineFixtureLoaded = true
  try {
    const mod = await import('./beanTimeline.fixture.js')
    beanTimelineFixture = mod.default || null
  } catch {
    beanTimelineFixture = null
  }
  return beanTimelineFixture
}

export function getBeanTimelineFixtureSync() {
  return beanTimelineFixture
}
