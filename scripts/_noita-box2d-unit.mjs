// Box2D(planck)封装的 node 单元测试:合成地形上 marching squares / 简化 / 落地 / 睡眠 / 脚下挖空唤醒 / 跨块接缝滑行。node scripts/_noita-box2d-unit.mjs
import { Physics, marchingSquares, simplify, PPM } from '../src/noita-map/Physics.js'

// 合成 CellSim:一块 200×120 的世界,y ≥ 80 是地面,x 40..120 处 1:2 斜坡,x 150..170 y 60..64 一块悬空平台,地里 x 60..70 y 95..100 一个洞
const W = 200, H = 120
const mat = new Uint8Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let s = y >= 80
  if (x >= 40 && x < 120 && y >= 80 - (x - 40) / 2) s = true
  if (x >= 150 && x < 170 && y >= 60 && y < 64) s = true
  if (x >= 60 && x < 70 && y >= 95 && y < 100) s = false
  mat[y * W + x] = s ? 1 : 0
}
const tver = new Map()
const sim = {
  kind: new Uint8Array([0, 1]),
  get(x, y) { return x < 0 || y < 0 || x >= W || y >= H ? -1 : mat[y * W + x] },
  solidB(x, y) { const m = this.get(x, y); return m < 0 ? true : m === 1 },
  tver(x, y) { return x < 0 || y < 0 || x >= W || y >= H ? -1 : (tver.get(`${x >> 5},${y >> 5}`) || 0) },
}
// marching squares 单元测试:一个 3×3 实心块
{
  const S = 5, g = new Uint8Array(S * S)
  for (let j = 1; j <= 3; j++) for (let i = 1; i <= 3; i++) g[j * S + i] = 1
  const lines = marchingSquares(g, S, S, 0, 0)
  console.log('3x3 block → lines', lines.length, 'pts', lines[0].length, 'closed', JSON.stringify(lines[0][0]) === JSON.stringify(lines[0][lines[0].length - 1]))
  console.log('  simplified', JSON.stringify(simplify(lines[0], 0.6)))
}
const ph = new Physics(sim, { gravity: 350 })
// 丢箱子:平地 / 斜坡 / 平台 / 洞上方
ph.addTestBox(20, 40, 8, 8)
ph.addTestBox(80, 20, 8, 8)
ph.addTestBox(160, 20, 8, 8)
ph.addTestCircle(65, 40, 4)
ph.addTestBox(100, 10, 12, 6, { angle: 0.4 })
const t0 = performance.now()
for (let i = 0; i < 240; i++) ph.step(1 / 60)
console.log('240 steps', (performance.now() - t0).toFixed(1), 'ms; tiles', ph.stats.tiles, 'built', ph.stats.built)
let verts = 0; for (const t of ph.tiles.values()) verts += t.verts
console.log('chain verts total', verts)
for (const s of ph.testState()) console.log(JSON.stringify(s))
// 期望:箱1 y≈80-4=76 平地;箱2 在斜坡上滑到坡底或停住;箱3 停在平台 y≈56;圆 y≈76;斜箱翻正
// 再跑 6s 看平台上的箱子(跨块接缝)能不能睡
for (let i = 0; i < 360; i++) ph.step(1 / 60)
console.log('box3 @10s', JSON.stringify(ph.testState()[2]))
// 地形改变:把箱1脚下挖空 → tver +1 → 下一步重建 → 箱子掉下去
for (let y = 80; y < 90; y++) for (let x = 10; x < 30; x++) mat[y * W + x] = 0
tver.set('0,2', 1)
for (let i = 0; i < 60; i++) ph.step(1 / 60)
console.log('after dig box1', JSON.stringify(ph.testState()[0]), 'built', ph.stats.built)
// 接缝鬼碰撞:平地(x<40 是平的,x=32 处有块接缝)上一个箱子以 −120px/s 横穿,看会不会被卡 / 弹起
const slider = ph.addTestBox(38, 75.9, 8, 8, { friction: 0 })
slider.setLinearVelocity({ x: -120 / PPM, y: 0 })
let maxVy = 0, minY = 999
for (let i = 0; i < 60; i++) { ph.step(1 / 60); const v = slider.getLinearVelocity(), p = slider.getPosition(); maxVy = Math.max(maxVy, Math.abs(v.y * PPM)); minY = Math.min(minY, p.y * PPM) }
const sp = slider.getPosition()
console.log('slider after 1s x', (sp.x * PPM).toFixed(1), 'y', (sp.y * PPM).toFixed(2), 'max|vy|', maxVy.toFixed(1), 'minY', minY.toFixed(2))
