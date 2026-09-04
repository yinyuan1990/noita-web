// 临时:验证 corner 模式拼接 + 新砖进游戏效果
import { chromium } from 'playwright'
import fs from 'fs'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } })
page.on('console', (m) => { if (m.type() === 'error') console.log('[页面错误]', m.text()) })
page.on('pageerror', (e) => console.log('[异常]', e.message))
await page.goto('http://localhost:5177/pixel-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const info = await page.evaluate(() => {
  const P = window.__pixel
  return P ? { hb: P.hbInfo() } : null
})
console.log('hbInfo:', JSON.stringify(info))

// 传送到不同深度截图
const spots = [[320, 100, 'surface'], [200, 190, 'mine-top'], [420, 280, 'mine-mid'], [320, 400, 'deep']]
fs.mkdirSync('scripts/out', { recursive: true })
for (const [x, y, name] of spots) {
  await page.evaluate(([tx, ty]) => {
    const P = window.__pixel
    const G = P.grid, M = P.M, W = P.SW
    // 找附近的空腔安置玩家
    let best = null
    for (let r = 0; r < 60 && !best; r += 4) {
      for (let oy = -r; oy <= r && !best; oy += 2) for (let ox = -r; ox <= r && !best; ox += 2) {
        const px2 = tx + ox, py = ty + oy
        if (px2 < 8 || px2 > W - 8 || py < 8) continue
        let ok = true
        for (let dy = -5; dy <= 4 && ok; dy++) for (let dx = -3; dx <= 3 && ok; dx++) {
          const m = G[(py + dy) * W + px2 + dx]
          if (m !== M.M_EMPTY) ok = false
        }
        if (ok) best = [px2, py]
      }
    }
    if (best) { P.player.x = best[0]; P.player.y = best[1]; P.player.vx = 0; P.player.vy = 0 }
  }, [x, y])
  await page.waitForTimeout(900)
  await page.screenshot({ path: `scripts/out/corner-${name}.png` })
  console.log('shot', name)
}
await browser.close()
