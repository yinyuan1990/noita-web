// 临时探针:�?telescope 生成 seed 世界,导出煤矿 wang �?+ 布景清单(用完�?
import { chromium } from 'playwright'
import fs from 'fs'
const SEED = parseInt(process.argv[2] || '123456789')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (/pw keys|scene x range|Loaded|Generated|Error|error/.test(m.text())) console.log('CONSOLE', m.text()) })
await page.goto('http://localhost:5177/tele/')
await page.waitForFunction(() => document.getElementById('gen-btn') && !document.getElementById('gen-btn').disabled, null, { timeout: 120000 })
await page.evaluate(async () => { window.__app = (await import('/tele/js/app.js')).app })
await page.waitForFunction(() => window.__app.baseBiomeMapNG0 && window.__app.baseBiomeMapNG0.data, null, { timeout: 120000, polling: 500 })
await page.waitForTimeout(1500)
await page.fill('#seed', String(SEED))
await page.evaluate(() => { document.getElementById('seed').dispatchEvent(new Event('change')) })
await page.evaluate(() => { window.__app.skipCosmeticScenes = false; const el = document.getElementById('skip-cosmetic'); if (el) el.checked = false })
await page.evaluate(() => window.__app.generate(true, true))
const dbg = setInterval(async () => {
  try {
    const s = await page.evaluate(() => { const a = window.__app; return { btn: document.getElementById('gen-btn').innerText, dis: document.getElementById('gen-btn').disabled, seed: a.seed, layers: a.tileLayers ? a.tileLayers.length : -1, pw: Object.keys(a.pixelScenesByPW), pois: Object.keys(a.poisByPW) } })
    console.log('DBG', JSON.stringify(s))
  } catch {}
}, 8000)
// 注意 waitForFunction 不能�?async 函数(返回�?Promise 恒为�?
await page.waitForFunction(() => {
  const app = window.__app
  return app.tileLayers && app.tileLayers.length > 0 && app.pixelScenesByPW['0,0'] && !document.getElementById('gen-btn').disabled
}, null, { timeout: 180000, polling: 500 })
clearInterval(dbg)
const out = await page.evaluate(async () => {
  const { app } = await import('/tele/js/app.js')
  const layers = app.tileLayers.map((l) => ({ biome: l.biomeName, x: l.correctedX, y: l.correctedY, w: l.w, h: l.h, mapW: l.width, mapH: l.mapH, chunk: l.chunkBasePos, hasPath: !!(l.path && l.path.length) }))
  const scenes = app.pixelScenesByPW['0,0'] || Object.values(app.pixelScenesByPW).find((v) => v) || []
  console.log('pw keys', Object.keys(app.pixelScenesByPW))
  const coal = app.tileLayers.find((l) => l.biomeName === 'coalmine')
  let coalPng = null
  if (coal) {
    const cv = document.createElement('canvas'); cv.width = coal.width; cv.height = coal.mapH
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(coal.width, coal.mapH)
    for (let y = 0; y < coal.mapH; y++) for (let x = 0; x < coal.width; x++) {
      const s = ((y + 4) * coal.width + x) * 3, d = (y * coal.width + x) * 4
      img.data[d] = coal.buffer[s]; img.data[d + 1] = coal.buffer[s + 1]; img.data[d + 2] = coal.buffer[s + 2]; img.data[d + 3] = 255
    }
    ctx.putImageData(img, 0, 0); coalPng = cv.toDataURL('image/png')
    // 原始 RGB wang 缓冲(含顶�?4 行留�?�?base64,�?Node 侧逐像素对�?
    let bin = ''; const u8 = coal.buffer; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
    coal.rawB64 = btoa(bin)
  }
  // 布景坐标是游戏世界坐�?原点=区块(35,14)左上),层坐标是区块绝对坐标 �?换算
  const OX = 35 * 512, OY = 14 * 512
  const coalScenes = coal ? scenes.filter((s) => s.x >= coal.correctedX - OX && s.x < coal.correctedX - OX + coal.w && s.y >= coal.correctedY - OY && s.y < coal.correctedY - OY + coal.h).map((s) => ({ name: s.name, key: s.key, x: s.x, y: s.y, w: s.width, h: s.height, mat: s.material, variant: s.variantKey })) : []
  const xs = scenes.map((s) => s.x), ys = scenes.map((s) => s.y)
  console.log('scene x range', Math.min(...xs), Math.max(...xs), 'y range', Math.min(...ys), Math.max(...ys))
  return { seed: app.seed, nLayers: layers.length, layers, nScenes: scenes.length, allScenes: scenes.map((s) => ({ name: s.name, key: s.key, x: s.x, y: s.y, w: s.width, h: s.height, mat: s.material, variant: s.variantKey })), coal: coal ? { x: coal.correctedX, y: coal.correctedY, w: coal.w, h: coal.h, mapW: coal.width, mapH: coal.mapH, path: coal.path, rawB64: coal.rawB64 } : null, coalScenes, coalPng }
})
console.log('seed', out.seed, 'layers', out.nLayers, 'scenes(PW0)', out.nScenes)
console.log('coalmine layer', JSON.stringify(out.coal))
console.log('coalmine scenes', out.coalScenes.length)
for (const s of out.coalScenes.slice(0, 40)) console.log('  ', s.name, s.x, s.y, s.w + 'x' + s.h, s.mat || '', s.variant)
console.log('layers:', out.layers.map((l) => `${l.biome}@${l.x},${l.y} ${l.w}x${l.h}`).join(' | '))
if (out.coalPng) fs.writeFileSync('C:/Users/admin/AppData/Local/Temp/tele-coalmine-wang.png', Buffer.from(out.coalPng.split(',')[1], 'base64'))
fs.writeFileSync('C:/Users/admin/AppData/Local/Temp/tele-dump.json', JSON.stringify({ ...out, coalPng: undefined }, null, 1))
// 视图截图:把相机对准煤�?
await page.evaluate(async () => {
  const { app } = await import('/tele/js/app.js')
  const coal = app.tileLayers.find((l) => l.biomeName === 'coalmine')
  if (coal) { app.cam.x = coal.correctedX + coal.w / 2; app.cam.y = coal.correctedY + coal.h / 2; app.cam.z = 0.6 }
  if (typeof app.render === 'function') app.render(); else if (typeof app.draw === 'function') app.draw()
})
await page.waitForTimeout(1500)
await page.screenshot({ path: 'C:/Users/admin/AppData/Local/Temp/tele-view.png' })
await browser.close()
