// 临时探针:群系边缘噪声(noise_biome_edges)—— 生成 chunk(1536,512)(煤矿,上邻右桩)顶部 40 行,与真值并排看山桩材质漫进煤矿的形状
// 用法:node scripts/_noita-edge-shot.mjs [wx,wy]
import { chromium } from 'playwright'
import fs from 'fs'
const [wx, wy] = (process.argv[2] || '1536,512').split(',').map(Number)
const tn = JSON.parse(fs.readFileSync('noita-ref/save-truth/materials.json', 'utf8'))
const cls = (n) => (n === 'air' ? '.' : /rock_static_wet|sandstone/.test(n) ? 'C' : /^rock_static$|^soil$|^rock_hard$/.test(n) ? 'M' : /^sand_static$/.test(n) ? 's' : /coal/.test(n) ? 'c' : n === 'grass' ? 'g' : '?')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto('http://localhost:5177/noita-map.html')
await page.waitForFunction(() => document.getElementById('hud')?.textContent.includes('seed'), null, { timeout: 20000 })
const gen = await page.evaluate(async ([wx, wy]) => {
  const w = window.__nm.world
  const cx = Math.floor(wx / 512) + 35, cy = Math.floor(wy / 512) + 14
  await w.prepareChunk(cx, cy)
  const ch = w.getChunk(cx, cy)
  const names = []
  for (let j = 0; j < 40; j++) { const row = []; for (let i = 0; i < 512; i++) row.push(w.mats.name(ch.mat[j * 512 + i])); names.push(row) }
  return names
}, [wx, wy])
const f = `noita-ref/save-truth/chunk_${wx}_${wy}.mat.bin`
const tb = fs.existsSync(f) ? fs.readFileSync(f) : null
const T = tb ? new Uint16Array(tb.buffer, tb.byteOffset, tb.length / 2) : null
let mAll = 0, mTruth = 0
for (let j = 0; j < 40; j += 2) {
  let a = '', b = ''
  for (let i = 0; i < 512; i += 3) { a += cls(gen[j][i]); if (T) b += cls(tn[T[j * 512 + i]]) }
  for (let i = 0; i < 512; i++) { if (/^rock_static$|^soil$|^rock_hard$/.test(gen[j][i])) mAll++; if (T && /^rock_static$|^soil$|^rock_hard$/.test(tn[T[j * 512 + i]])) mTruth++ }
  console.log(String(wy + j).padStart(5), 'gen  ', a.slice(0, 170))
  if (T) console.log('     ', 'truth', b.slice(0, 170))
}
console.log(`山桩材质(rock_static/soil/rock_hard)在这 20 行里:gen ${mAll} / truth ${mTruth}`)
await browser.close()
