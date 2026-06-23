let beanTimelineFixture = null
let beanTimelineFixtureLoaded = false

const fixtureLoaders = import.meta.glob('./*.fixture.js')

export async function loadBeanTimelineFixture() {
  if (import.meta.env.VITE_USE_MOCK_DATA !== 'true') return null
  if (beanTimelineFixtureLoaded) return beanTimelineFixture
  beanTimelineFixtureLoaded = true
  try {
    const load = fixtureLoaders['./beanTimeline.fixture.js']
    if (!load) {
      beanTimelineFixture = null
      return null
    }
    const mod = await load()
    beanTimelineFixture = mod.default || null
  } catch {
    beanTimelineFixture = null
  }
  return beanTimelineFixture
}

export function getBeanTimelineFixtureSync() {
  return beanTimelineFixture
}
