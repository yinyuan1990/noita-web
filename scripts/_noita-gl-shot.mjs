// 探针:WebGL 世界合成(默认)vs 2D 老路径(?gl=0)截图对比 —— 同 seed 出生点站着,Math.random 钉 0.5(抖动 / 火闪固定)、暂停后各截一张逐像素比;
// 再用 GL 路径对地开火 2 秒截一张(精灵 / 粒子 / 加色层肉眼看)。用法:node scripts/_noita-gl-shot.mjs [url]
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const base = process.argv[2] || 'http://localhost:5177/noita-play.html?log=0&new=1'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: process.env.ORIGIN_IP ? [`--host-resolver-rules=MAP update.cocoaihj.com ${process.env.ORIGIN_IP}`] : [] })
const shots = {}
const open = async (gl) => {
  const page = await browser.newPage({ viewport: { width: 854, height: 390 } })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  page.on('console', (m) => { if ((m.type() === 'warning' || m.type() === 'error') && !/404/.test(m.text())) console.log('CONSOLE', m.text()) })
  await page.goto(base + '&gl=' + gl, { timeout: 120000, waitUntil: 'commit' })
  await page.waitForFunction(() => window.__np && window.__np.player.onGround && window.__np.physics, null, { timeout: 150000 })
  await page.waitForFunction(() => window.__np.simBound(), null, { timeout: 150000 }) // 视口一圈区块齐了(线上区块来得慢,没齐时模拟 / 开火都不跑)
  return page
}
const grab = async (page, name) => {
  await page.evaluate(() => { for (const el of document.querySelectorAll('body > :not(canvas)')) el.style.visibility = 'hidden' })
  const buf = await page.screenshot({ type: 'png' })
  writeFileSync(`${process.env.TEMP}/${name}.png`, buf)
  return page.evaluate(async (u) => {
    const im = new Image(); im.src = u; await im.decode()
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0)
    return Array.from(x.getImageData(0, 0, c.width, c.height).data)
  }, 'data:image/png;base64,' + buf.toString('base64'))
}
for (const gl of ['1', '0']) {
  const page = await open(gl)
  await page.waitForTimeout(800)
  await page.evaluate(() => { window.__np.setPaused(true); Math.random = () => 0.5 })
  await page.waitForTimeout(300)
  shots[gl] = await grab(page, 'gl-' + gl)
  await page.close()
}
const A = shots['1'], B = shots['0']
let diff = 0, big = 0, n = A.length / 4
for (let i = 0; i < A.length; i += 4) {
  const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]))
  if (d > 8) diff++
  if (d > 40) big++
}
console.log(`出生点 GL vs 2D 像素差 >8: ${diff} (${(diff / n * 100).toFixed(2)}%)  >40: ${big} (${(big / n * 100).toFixed(2)}%)  图 %TEMP%/gl-1.png gl-0.png gl-diff.png(红 GL 亮 / 蓝 2D 亮)`)
{
  const pg = await browser.newPage()
  const du = await pg.evaluate(([A, B, W]) => {
    const H = A.length / 4 / W, c = document.createElement('canvas'); c.width = W; c.height = H
    const x = c.getContext('2d'), im = x.createImageData(W, H)
    for (let i = 0; i < A.length; i += 4) {
      const la = A[i] + A[i + 1] + A[i + 2], lb = B[i] + B[i + 1] + B[i + 2], d = la - lb
      im.data[i] = d > 24 ? Math.min(255, 100 + d) : 0; im.data[i + 2] = d < -24 ? Math.min(255, 100 - d) : 0; im.data[i + 1] = Math.abs(d) > 24 ? 0 : 30; im.data[i + 3] = 255
    }
    x.putImageData(im, 0, 0); return c.toDataURL('image/png')
  }, [A, B, 854])
  writeFileSync(`${process.env.TEMP}/gl-diff.png`, Buffer.from(du.split(',')[1], 'base64'))
  await pg.close()
}
// GL 路径开火截图
const page = await open('1')
await page.evaluate(() => { const np = window.__np, w = np.player.wands[0]; w.cards = ['BURST_3', 'LASER', 'LARPA_UPWARDS', 'LARPA_CHAOS_2', 'LASER', 'METEOR']; w.deck = [...w.cards]; w.uses = {}; w.mana = w.manaMax = 1e6; w.cd = 0; w.reloadT = 0; np.setWand(0) })
await page.mouse.move(600, 200); await page.mouse.down(); await page.waitForTimeout(1500)
await page.evaluate(() => { for (const el of document.querySelectorAll('body > :not(canvas)')) el.style.visibility = 'hidden' })
await page.screenshot({ path: `${process.env.TEMP}/gl-fire.png` })
await page.mouse.up()
console.log(`开火截图 %TEMP%/gl-fire.png  精灵 ${await page.evaluate(() => window.__np.projectiles.drawn)} sfx ${await page.evaluate(() => window.__np.projectiles.sfx.length)}`)
await browser.close()
