// 后处理效果 + 2 段跳冒烟测试：node scripts/forest-fx.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/forest-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// 2 段跳：起跳 → 空中再跳 → 等落地（落地触发冲击波）
const jumpInfo = await page.evaluate(async () => {
  const d = window.__forestDemo
  if (!d) return null
  d.jump()
  const a1 = d.getAir()
  await new Promise((r) => setTimeout(r, 300))
  d.jump()
  const a2 = d.getAir()
  return { firstJumps: a1 && a1.jumps, secondJumps: a2 && a2.jumps }
})
console.log('jump:', JSON.stringify(jumpInfo))
await page.waitForTimeout(400)
const shockNow = await page.evaluate(() => window.__forestDemo.getFxNow())
console.log('after-land fx:', JSON.stringify(shockNow))
await page.screenshot({ path: 'scripts/out/fx-0-shock.png' })

// 依次开启四个效果截图
const names = { 1: 'gameboy', 2: 'swirl', 3: 'jelly', 4: 'psy' }
for (const key of ['1', '2', '3', '4']) {
  await page.keyboard.press(key)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `scripts/out/fx-${key}-${names[key]}.png` })
  await page.keyboard.press(key) // 关掉再试下一个
  await page.waitForTimeout(600)
}
const fxNow = await page.evaluate(() => window.__forestDemo.getFxNow())
console.log('final fx (should be ~0):', JSON.stringify(fxNow))

console.log('console issues:', errors.length ? errors.join('\n') : 'none')
await browser.close()
