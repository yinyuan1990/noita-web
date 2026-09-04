// 核弹 + 分类音效验证：node scripts/air-nuke.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2600)

// 1. 九个合成音效可访问
const sfxStatus = await page.evaluate(async () => {
  const names = ['vulcan', 'fire', 'cluster', 'tesla', 'aurora', 'flak', 'ground', 'nuke', 'bossdie']
  const out = {}
  for (const n of names) {
    const r = await fetch(`/res/sfx/gen/boom_${n}.wav`, { method: 'HEAD' })
    out[n] = r.ok ? r.headers.get('content-length') : `HTTP ${r.status}`
  }
  return out
})
console.log('sfx:', JSON.stringify(sfxStatus))

// 2. 铺一屏敌机 + 环形弹幕，攒足清算目标
await page.evaluate(() => {
  const p = window.__air.player
  window.__air.spawnFormation('ring', p.x, p.y - 600)
  window.__air.spawnFormation('wall', p.x + 700, p.y)
  for (let i = 0; i < 4; i++) window.__air.spawnEnemy('fighter', p.x - 500 + i * 260, p.y + 420)
})
await page.waitForTimeout(2500)
const before = await page.evaluate(() => ({
  enemies: window.__air.enemies.length,
  nukeHud: document.getElementById('nuke').textContent,
}))

// 3. B 键核弹：预警 → 起爆 → 蘑菇云
await page.keyboard.press('b')
await page.waitForTimeout(350)
await page.screenshot({ path: 'scripts/out/nuke-1-warning.png' })
await page.waitForTimeout(450) // t≈0.8s，刚起爆
await page.screenshot({ path: 'scripts/out/nuke-2-blast.png' })
await page.waitForTimeout(900) // t≈1.7s，蘑菇云成型
await page.screenshot({ path: 'scripts/out/nuke-3-mushroom.png' })
await page.waitForTimeout(1400)
await page.screenshot({ path: 'scripts/out/nuke-4-aftermath.png' })

const after = await page.evaluate(() => ({
  enemies: window.__air.enemies.length,
  nukeHud: document.getElementById('nuke').textContent,
  score: document.getElementById('score').textContent,
  fps: document.getElementById('fps').textContent,
}))
console.log(`enemies ${before.enemies} -> ${after.enemies} | nuke "${before.nukeHud}" -> "${after.nukeHud}" | score=${after.score} | ${after.fps}`)

// 4. 打空库存：再按一次消耗掉最后一枚，第三次应无效
await page.keyboard.press('b')
await page.waitForTimeout(3200)
await page.keyboard.press('b')
await page.waitForTimeout(600)
const empty = await page.evaluate(() => document.getElementById('nuke').textContent)
console.log(`after draining: "${empty}" (expect ×0)`)

console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
