// Cocos 粒子爆炸对接验证：node scripts/air-cocosfx.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'warning' && m.text().includes('cocosFx')) errors.push(`[warn] ${m.text()}`)
})

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(3200) // 等预热完成

const shots = [
  ['fire', 1, 'cocos-1-fire'],
  ['flak', 1, 'cocos-2-flak'],
  ['tesla', 1.2, 'cocos-3-tesla'],
  ['aurora', 1.2, 'cocos-4-aurora'],
  ['cluster', 1, 'cocos-5-cluster'],
  ['cluster', 1.3, 'cocos-6-bigbang'],
  ['groundBoom', 1.2, 'cocos-7-ground'],
]
for (const [kind, mul, file] of shots) {
  await page.evaluate(([k, m]) => {
    const p = window.__air.player
    window.__air.spawnExplosion(k, p.x + 260, p.y - 40, m)
  }, [kind, mul])
  await page.waitForTimeout(260)
  await page.screenshot({ path: `scripts/out/${file}.png` })
  await page.waitForTimeout(1100)
}

// 高频压力：连打 20 发导弹爆 + 10 发 flak，看节流与帧率
await page.evaluate(() => {
  const p = window.__air.player
  for (let i = 0; i < 20; i++) window.__air.spawnExplosion('fire', p.x + Math.random() * 500 - 250, p.y + Math.random() * 300 - 150, 1)
  for (let i = 0; i < 10; i++) window.__air.spawnExplosion('flak', p.x + Math.random() * 500 - 250, p.y + Math.random() * 300 - 150, 1)
})
await page.waitForTimeout(400)
await page.screenshot({ path: 'scripts/out/cocos-8-stress.png' })
await page.waitForTimeout(600)
const fps = await page.evaluate(() => document.getElementById('fps').textContent)
console.log('fps after stress:', fps)
console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
