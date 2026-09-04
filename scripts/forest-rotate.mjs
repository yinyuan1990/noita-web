// 森林旋转验证：node scripts/forest-rotate.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[error] ${m.text()}`)
})

await page.goto('http://localhost:5177/forest-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page.screenshot({ path: 'scripts/out/frot-0.png' })

for (const [deg, zoom] of [
  [40, 1],
  [90, 1],
  [180, 0.75],
]) {
  await page.evaluate(
    ({ deg, zoom }) => window.__forestDemo.setCamera((deg * Math.PI) / 180, zoom),
    { deg, zoom }
  )
  await page.waitForTimeout(600)
  await page.screenshot({ path: `scripts/out/frot-${deg}.png` })
}

// 旋转视角下踩水判定仍然工作（世界坐标不受摄像机影响）
const onWater = await page.evaluate(() => {
  const d = window.__forestDemo
  d.hero.x = 1380
  d.hero.y = 424
  return d.isOnWater(1380, 430)
})
await page.waitForTimeout(400)
await page.screenshot({ path: 'scripts/out/frot-hero.png' })
console.log('hero on water(@180°):', onWater)
console.log('console issues:', errors.length ? errors.join('\n') : 'none')
await browser.close()
