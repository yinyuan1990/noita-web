// 临时排查:开火点上方的"第二发射点"(验证完删除)
import { chromium } from 'playwright'
import fs from 'fs'

const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://localhost:5177/pixel-demo.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(2200)
// 清怪 + 关自动出怪,排除敌机干扰;水平向右开火
await page.evaluate(() => {
  const P = window.__pixel
  P.mobs.length = 0
  document.getElementById('autospawn').checked = false
  P.setCast(0)
  P.setPay(0)
})
const canvas = await page.$('#stage canvas')
const box = await canvas.boundingBox()
// 玩家屏幕位置
const pp = await page.evaluate(() => {
  const P = window.__pixel
  return { x: P.player.x, y: P.player.y }
})
// 瞄右侧水平方向,连发
await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.55)
await page.mouse.down()
await page.waitForTimeout(350)
// 裁剪玩家周围区域放大截图
const scale = await page.evaluate(() => (document.querySelector('#stage canvas').width / 240))
const cam = await page.evaluate(() => {
  const P = window.__pixel
  return { x: P.player.x, y: P.player.y }
})
const camv = await page.evaluate(() => ({ cx: (window.__pixel.player.x), cy: (window.__pixel.player.y) }))
await page.screenshot({
  path: OUT + 'mz-01.png',
  clip: { x: box.x + box.width * 0.28, y: box.y + box.height * 0.25, width: box.width * 0.5, height: box.height * 0.55 },
})
await page.waitForTimeout(200)
await page.screenshot({
  path: OUT + 'mz-02.png',
  clip: { x: box.x + box.width * 0.28, y: box.y + box.height * 0.25, width: box.width * 0.5, height: box.height * 0.55 },
})
await page.mouse.up()
console.log('player at', JSON.stringify(pp), 'errors:', errors.length ? errors.join('\n') : '(none)')
await browser.close()
