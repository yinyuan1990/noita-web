// 机体五段进化验证：node scripts/air-evolve.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5177/air-combat.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2600)

const setSum = async (sum) => {
  await page.evaluate((s) => {
    const lv = window.__air.weaponLv
    // 均摊到五把武器（上限 10）
    let left = s
    for (let i = 0; i < 5; i++) {
      lv[i] = Math.max(1, Math.min(10, Math.round(s / 5)))
      left -= lv[i]
    }
    lv[0] = Math.min(10, lv[0] + left)
    window.__air.checkEvolve()
  }, sum)
}

// Mk-II：翼尖吊舱
await setSum(12)
await page.waitForTimeout(400)
await page.screenshot({ path: 'scripts/out/evolve-1-mk2.png' })

// Mk-III：浮游炮×1 + 寒钢涂装，旁边放靶子看补射
await setSum(22)
await page.evaluate(() => {
  const p = window.__air.player
  for (let i = 0; i < 3; i++) window.__air.spawnEnemy('fighter', p.x + 520, p.y - 200 + i * 200)
})
await page.waitForTimeout(900)
await page.screenshot({ path: 'scripts/out/evolve-2-mk3-options.png' })

// Mk-IV：换机体 + 金色流光 + 浮游炮×2
await setSum(32)
await page.waitForTimeout(500)
await page.screenshot({ path: 'scripts/out/evolve-3-mk4.png' })

// Mk-V：彩虹航迹（飞一段直线看拖尾）
await setSum(42)
await page.keyboard.down('d')
await page.waitForTimeout(900)
await page.screenshot({ path: 'scripts/out/evolve-4-mk5-rainbow.png' })
await page.keyboard.up('d')

// Lv10 过热特写：主武器满级持续开火
await page.evaluate(() => {
  window.__air.weaponLv[0] = 10
  window.__air.checkEvolve()
})
await page.keyboard.press('1')
await page.keyboard.down(' ')
await page.waitForTimeout(700)
await page.screenshot({ path: 'scripts/out/evolve-5-overheat.png' })
await page.keyboard.up(' ')

const stat = await page.evaluate(() => ({
  evo: window.__air.player.evo,
  maxHp: window.__air.player.maxHp,
  hud: document.getElementById('weapon').textContent,
  fps: document.getElementById('fps').textContent,
}))
console.log(`evo=${stat.evo} maxHp=${stat.maxHp} | hud="${stat.hud}" | ${stat.fps}`)
console.log('errors:', errors.length ? errors.join('\n') : 'none')
await browser.close()
