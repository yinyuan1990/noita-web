// 雷霆战机式编队 + 弹幕验证：node scripts/air-thunder.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })

async function scene(name, fn) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2600)
  await fn(page)
  const stat = await page.evaluate(() => ({
    enemies: window.__air.enemies.length,
    fps: document.getElementById('fps').textContent,
  }))
  console.log(`[${name}] enemies=${stat.enemies} fps=${stat.fps} errors=${errors.length ? errors.join(' | ') : 'none'}`)
  await page.close()
}

// 1. 蛇形长龙：蛇头 + 7 架无人机首尾相咬
await scene('snake', async (page) => {
  await page.evaluate(() => {
    const p = window.__air.player
    window.__air.spawnFormation('snake', p.x + 1250, p.y - 300)
  })
  await page.waitForTimeout(2600)
  await page.screenshot({ path: 'scripts/out/thunder-1-snake.png' })
})

// 2. 包围圈：8 架无人机公转收缩
await scene('ring', async (page) => {
  await page.evaluate(() => {
    const p = window.__air.player
    window.__air.spawnFormation('ring', p.x, p.y)
  })
  await page.waitForTimeout(2800)
  await page.screenshot({ path: 'scripts/out/thunder-2-ring.png' })
})

// 3. 炮舰：强制触发螺旋弹幕 + 双重环爆
await scene('gunship', async (page) => {
  await page.evaluate(() => {
    const p = window.__air.player
    window.__air.spawnFormation('gunship', p.x + 620, p.y)
  })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const g = window.__air.enemies.find((e) => e.type === 'gunship')
    if (g) g.spiralT = 1.5
  })
  await page.waitForTimeout(900)
  await page.screenshot({ path: 'scripts/out/thunder-3-spiral.png' })
  const nb1 = await page.evaluate(() => {
    const g = window.__air.enemies.find((e) => e.type === 'gunship')
    if (g) {
      g.spiralT = 0
      g.phaseT = 0
    }
    return 0
  })
  void nb1
  await page.waitForTimeout(1300)
  await page.screenshot({ path: 'scripts/out/thunder-4-ringburst.png' })
})

// 4. 钳形夹击 + 横扫弹墙 + 战斗机扇面弹
await scene('pincer+wall', async (page) => {
  await page.evaluate(() => {
    const p = window.__air.player
    window.__air.spawnFormation('pincer', p.x + 1000, p.y)
    window.__air.spawnFormation('wall', p.x, p.y - 1200)
  })
  await page.waitForTimeout(2600)
  await page.screenshot({ path: 'scripts/out/thunder-5-pincer-wall.png' })
  await page.waitForTimeout(2600)
  await page.screenshot({ path: 'scripts/out/thunder-6-melee.png' })
})

await browser.close()
console.log('done')
