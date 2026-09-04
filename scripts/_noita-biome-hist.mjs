// 临时探针:在 noita-map.html 里生成指定 chunk(世界坐标左上),打印材质直方图,与 noita-ref/save-truth 对照
// 用法:node scripts/_noita-biome-hist.mjs 512,1536 -1536,1536
import { chromium } from 'playwright'
import fs from 'fs'
const coords = process.argv.slice(2).length ? process.argv.slice(2) : ['512,1536', '-1536,1536']
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto('http://localhost:5177/noita-map.html')
await page.waitForFunction(() => document.getElementById('hud')?.textContent.includes('seed'), null, { timeout: 20000 })
const tn = JSON.parse(fs.readFileSync('noita-ref/save-truth/materials.json', 'utf8'))
const tname = (id) => (Array.isArray(tn) ? tn[id] : tn[id] || tn[String(id)])
for (const c of coords) {
  const [wx, wy] = c.split(',').map(Number)
  const res = await page.evaluate(async ([wx, wy]) => {
    const w = window.__nm.world
    const cx = Math.floor(wx / 512) + 35, cy = Math.floor(wy / 512) + 14
    await w.prepareChunk(cx, cy)
    const ch = w.getChunk(cx, cy)
    const h = new Map()
    for (const v of ch.mat) h.set(v, (h.get(v) || 0) + 1)
    return { biome: ch.biome, scenes: ch.scenes.map((s) => s.name), spawns: ch.spawns.map((s) => s.entity), hist: [...h.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [w.mats.name(k), v]) }
  }, [wx, wy])
  console.log(`\n== chunk (${wx},${wy}) ${res.biome}  scenes: ${res.scenes.join(' ')}`)
  console.log('spawns:', Object.entries(res.spawns.reduce((a, e) => ((a[e] = (a[e] || 0) + 1), a), {})).map(([k, v]) => `${k}×${v}`).join(' '))
  console.log('gen  :', res.hist.map(([k, v]) => `${k}:${v}`).join(' '))
  const f = `noita-ref/save-truth/chunk_${wx}_${wy}.mat.bin`
  if (fs.existsSync(f)) {
    const b = fs.readFileSync(f); const m = new Uint16Array(b.buffer, b.byteOffset, b.length / 2)
    const h = new Map(); for (const v of m) h.set(v, (h.get(v) || 0) + 1)
    console.log('truth:', [...h.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${tname(k)}:${v}`).join(' '))
  }
}
await browser.close()
