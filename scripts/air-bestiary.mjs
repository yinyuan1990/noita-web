// 八新敌种行为验证：node scripts/air-bestiary.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2600)

// 1. 布雷艇 + 火炮平台：雷区与落点预警
await page.evaluate(() => {
  const p = window.__air.player
  window.__air.spawnEnemy('miner', p.x + 700, p.y - 100)
  window.__air.spawnEnemy('artillery', p.x - 750, p.y + 150)
})
await page.waitForTimeout(4500)
await page.screenshot({ path: 'scripts/out/beast-1-miner-artillery.png' })

// 2. 狙击手：红色瞄准线
await page.evaluate(() => {
  const p = window.__air.player
  window.__air.spawnEnemy('sniper', p.x + 880, p.y)
})
await page.waitForTimeout(2300)
await page.screenshot({ path: 'scripts/out/beast-2-sniper-aim.png' })

// 3. 护盾兵 + 医疗僚：给受伤战斗机罩盾续血
await page.evaluate(() => {
  const p = window.__air.player
  const f = window.__air.spawnEnemy('fighter', p.x + 500, p.y - 300)
  f.hp = 1 // 伤员
  window.__air.spawnEnemy('mender', p.x + 620, p.y - 340)
  window.__air.spawnEnemy('shielder', p.x + 560, p.y - 240)
})
await page.waitForTimeout(2600)
await page.screenshot({ path: 'scripts/out/beast-3-support.png' })

// 4. 母舰放蜂 + 幽灵伏击 + 拦截小队编队（测试机开无双避免坠机截到 game over）
await page.evaluate(() => {
  const p = window.__air.player
  p.maxHp = 99999
  p.hp = 99999
  window.__air.spawnFormation('carrier', p.x, p.y - 900)
  window.__air.spawnFormation('ambush', p.x + 600, p.y + 600)
})
await page.waitForTimeout(6500)
await page.screenshot({ path: 'scripts/out/beast-4-carrier-phantom.png' })

const stat = await page.evaluate(() => {
  const types = {}
  for (const e of window.__air.enemies) types[e.type] = (types[e.type] || 0) + 1
  return { types, fps: document.getElementById('fps').textContent }
})
console.log('enemy census:', JSON.stringify(stat.types), '|', stat.fps)
console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
