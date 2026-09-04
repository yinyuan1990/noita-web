// 视角旋转验证：node scripts/rain-rotate.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[error] ${m.text()}`)
})

await page.goto('http://localhost:5177/rain-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
await page.screenshot({ path: 'scripts/out/rot-0.png' })

for (const [deg, zoom] of [
  [45, 1],
  [90, 1],
  [135, 0.8],
]) {
  await page.evaluate(
    ({ deg, zoom }) => window.__rainDemo.setCamera((deg * Math.PI) / 180, zoom),
    { deg, zoom }
  )
  await page.waitForTimeout(600)
  await page.screenshot({ path: `scripts/out/rot-${deg}.png` })
}

// 主角在旋转后的视角下仍能判定水面
const onWater = await page.evaluate(() => {
  const d = window.__rainDemo
  return d.weather.isOnPuddle(d.hero.x, d.hero.y)
})
console.log('hero on water(@135°):', onWater)
console.log('console issues:', errors.length ? errors.join('\n') : 'none')
await browser.close()
