// 踩水涟漪特写验证
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto('http://localhost:5177/rain-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const info = await page.evaluate(() => {
  const d = window.__rainDemo
  d.hero.x = 1044
  d.hero.y = 314
  return { onWater: d.weather.isOnPuddle(1044, 314), v: d.weather.puddleValueAt(1044, 314) }
})
console.log('center check:', JSON.stringify(info))

// 在水坑里来回踱步
for (let i = 0; i < 6; i++) {
  await page.evaluate((i) => {
    const d = window.__rainDemo
    d.target.x = 1044 + (i % 2 === 0 ? 70 : -70)
    d.target.y = 314 + (i % 2 === 0 ? 15 : -15)
    d.target.active = true
  }, i)
  await page.waitForTimeout(420)
}
await page.screenshot({ path: 'scripts/out/foot-trail.png', clip: { x: 380, y: 40, width: 760, height: 420 } })
console.log('done')
await browser.close()
