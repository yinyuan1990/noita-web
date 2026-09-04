// 十景 tileset 验证：node scripts/air-scenes.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2600)

const n = await page.evaluate(() => window.__air.SCENES.length)
for (let i = 0; i < n; i++) {
  const name = await page.evaluate((idx) => {
    window.__air.setScene(idx)
    return window.__air.SCENES[idx].name
  }, i)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `scripts/out/scene-${i}-${name}.png` })
  const stat = await page.evaluate(() => ({
    chunks: window.__air.chunks.size,
    fps: document.getElementById('fps')?.textContent,
  }))
  console.log(`scene ${i} ${name}: chunks=${stat.chunks} ${stat.fps}`)
}

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
