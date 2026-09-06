// Box2D(planck)封装的 node 单元测试:合成地形上 marching squares / 简化 / 落地 / 睡眠 / 脚下挖空唤醒 / 跨块接缝滑行。node scripts/_noita-box2d-unit.mjs
import { Physics, marchingSquares, simplify, pixelPolygons, contourPolygons, dropCollinear, PPM } from '../src/noita-map/Physics.js'

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
// 地形多边形(带洞):20×20 实心块中间挖一个 6×6 的洞 + 一颗 2×2 的气泡 → 洞要留着(洞心的点不在任何多边形里),实心处的点要在某个多边形里
{
  const S = 22, g = new Uint8Array(S * S)
  for (let j = 1; j <= 20; j++) for (let i = 1; i <= 20; i++) g[j * S + i] = 1
  for (let j = 8; j < 14; j++) for (let i = 8; i < 14; i++) g[j * S + i] = 0
  g[4 * S + 16] = 0; g[4 * S + 17] = 0; g[5 * S + 16] = 0; g[5 * S + 17] = 0
  const polys = contourPolygons(marchingSquares(g, S, S, -1, -1), 0.3, false)
  const inAny = (x, y) => polys.some((p) => { let inside = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside } return inside })
  console.log('terrain w/ holes: polys', polys.length, 'maxVerts', Math.max(...polys.map((p) => p.length)), 'holeCenterSolid', inAny(10, 10), 'bubbleSolid', inAny(16, 4), 'solidAt(3,3)', inAny(3, 3), 'solidAt(17,17)', inAny(17, 17))
  const filled = contourPolygons(marchingSquares(g, S, S, -1, -1), 0.3, true)
  console.log('  fillHoles:', filled.length, 'polys, holeCenterSolid', filled.some((p) => { let inside = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > 10) !== (b[1] > 10) && 10 < ((b[0] - a[0]) * (10 - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside } return inside }))
}
// 像素 → 凸多边形:方块 / 桌子(凹)/ 2 像素 / 带洞的环
{
  const mk = (w, h, f) => { const m = new Uint8Array(w * h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) m[j * w + i] = f(i, j) ? 1 : 0; return m }
  const cases = {
    box10: [10, 10, () => true],
    table: [16, 10, (i, j) => j < 3 || (j >= 3 && (i < 3 || i >= 13))],
    dot2: [2, 1, () => true],
    ring: [12, 12, (i, j) => { const d = Math.hypot(i - 5.5, j - 5.5); return d < 6 && d > 3 }],
    L: [8, 8, (i, j) => i < 3 || j >= 5],
  }
  for (const [name, [w, h, f]] of Object.entries(cases)) {
    const mask = mk(w, h, f)
    const polys = pixelPolygons(mask, w, h)
    const area = polys.reduce((s, p) => s + Math.abs(p.reduce((a, q, k) => { const r = p[(k + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1] }, 0) / 2), 0)
    const px = mask.reduce((s, v) => s + v, 0)
    const maxV = Math.max(0, ...polys.map((p) => p.length))
    // 也真的建一个 body 看 planck 接受不接受
    const rb = { mask, w0: w, h0: h, x: 50, y: 20, rot: 0, vx: 0, vy: 0, w: 0, mat: 1, density: 6, alive: px, edge: [] }
    const ph0 = new Physics(sim, { gravity: 350 })
    ph0.attach(rb)
    console.log(name.padEnd(6), 'polys', polys.length, 'maxVerts', maxV, 'area', area.toFixed(1), '/ px', px, 'mass', rb.pb.getMass().toFixed(2))
  }
  // planck Polygon._set 死循环回归:线上抓到的 3 像素尸块凸块,(-0.5,-2.5)(1,-1)(2,0) 共线、(1,-1) 是中间点 → 原样给 planck 转 3s 抛 RangeError: Invalid array length;
  // dropCollinear 要剔掉中间点。这里不直接喂 planck(会挂),只检查输出里没有共线三元组
  const bad = [[1, -1], [2, 0], [2, 1], [-0.5, -2.5]]
  const h = dropCollinear(bad)
  const collinear = (p) => { for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length]; if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) <= 1e-3) return true } return false }
  console.log('dropCollinear(bad)', JSON.stringify(h), 'collinear', collinear(bad), '→', collinear(h), h.length === 3 && !collinear(h) ? 'OK' : 'FAIL')
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
