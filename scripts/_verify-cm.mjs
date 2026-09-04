// 验证真 coalmine 瓦片管线:连通率+标记密度+多深度截图
import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
await page.goto('http://localhost:5179/pixel-demo.html')
await page.waitForFunction(() => window.__pixel && window.__pixel.grid, { timeout: 15000 })
await page.waitForTimeout(800)
for (let i = 0; i < 4; i++) {
  const r = await page.evaluate(() => {
    window.__pixel.regen()
    const P = window.__pixel
    return { ...P.hbInfo(), mobPts: P.mobSpawnPts.length }
  })
  console.log(`regen#${i}: conn=${(r.conn * 100).toFixed(1)}% att=${r.attempts} hb=${r.hb} 罐=${r.vessels} 灯=${r.lamps} 怪锚=${r.mobPts}`)
}
const spots = [[320, 170, 'surface'], [180, 230, 'ug-top'], [430, 320, 'ug-mid'], [300, 420, 'ug-deep']]
for (const [x, y, name] of spots) {
  await page.evaluate(([px, py]) => {
    const P = window.__pixel
    P.player.x = px; P.player.y = py; P.player.vx = 0; P.player.vy = 0
  }, [x, y])
  await page.waitForTimeout(700)
  await page.screenshot({ path: `scripts/out/cm-${name}.png` })
}
console.log('done')
await browser.close()
