// ── Noita 地图实验室:原版 coalmine 管线单独复现(与游戏 demo 零耦合)──
// 资产全部来自 data.wak 解包原件(public/res/noita/),按原版四层管线拼:
//   ① stbhw corner 人字砖(coalmine.png 模板,原生 s=13,零缩放零滤波)
//   ② 材质带(coalmine.xml MaterialComponent:土/沙/湿岩噪声带 + 煤透镜 + 深层金)
//   ③ pixel scene 盖章(biome_impl/coalmine/*.png 材质层 + *_visual.png 手绘美术层)
//   ④ spawn 标记(wang_scripts.csv 色表,只可视化不生成实体)
// 每层可开关——拆开看"原版为什么好"分别好在哪层。

const TPL_URL = '/res/noita/coalmine.png'
const SCENE_DIR = '/res/noita/scenes/'
const SCALE = 4         // 实验室显示用缩放。注意:原版真实尺度是 10×(TILE_PX=10,见 noita-ref/GEN-RULES.md §二),游戏 demo 按玩家身高换算用 6×(HB_S=78)
const W = 1664, H = 832 // 实验场世界尺寸(52px 格 32×16)

// ── 实验室材质表(≈materials.xml 的 wang_color→材质,渲染色取原作截图近似)──
const AIR = 0, SLOT = 1, ROCK = 2, COAL = 3, WATER = 4, OIL = 5, WOOD = 6,
  STEEL = 7, WET = 8, SOIL = 9, SAND = 10, GOLD = 11, GRASS = 12, ACID = 13,
  BRICK = 14, METEOR = 15, GLOW = 16, LAVA = 17, MOSS = 18
const COLOR = [
  [30, 23, 16],    // AIR 洞腔(渲染成暗棕背景墙——原版洞腔背后是背景层不是纯黑,观感厚实的关键)
  [122, 122, 122], // SLOT 白槽(材质带关闭时的原始灰,开了会被 ② 换掉)
  [46, 56, 49],    // ROCK rock_static
  [23, 23, 26],    // COAL 煤
  [47, 85, 76],    // WATER
  [22, 20, 15],    // OIL
  [74, 59, 30],    // WOOD 坑道木梁
  [71, 71, 77],    // STEEL
  [44, 54, 46],    // WET rock_static_wet
  [66, 56, 34],    // SOIL 土
  [94, 87, 52],    // SAND sand_static
  [242, 193, 78],  // GOLD
  [88, 122, 46],   // GRASS
  [63, 174, 90],   // ACID 放射绿液/史莱姆
  [92, 82, 54],    // BRICK templebrick_static(神龛砖)
  [29, 16, 16],    // METEOR meteorite_static
  [26, 66, 30],    // GLOW rock_static_glow(史莱姆坑荧光岩)
  [206, 74, 12],   // LAVA
  [45, 110, 40],   // MOSS
]
// wang_color(materials.xml 实证)→ 实验室材质
const MAT = {
  0x505052: COAL, 0x505051: COAL, 0x2f554c: WATER, 0x00ff33: ACID, 0x3b3b3c: OIL,
  0x413f24: WOOD, 0x413f3a: WOOD, 0x404041: STEEL, 0x103344: WET,
  0x00f344: ROCK, 0x353923: ROCK, 0x524f2d: SAND, 0x36311e: SOIL,
  0xc0ffee: AIR, 0x8aff80: AIR, 0x323232: AIR, 0x000000: AIR,
  // 布景材质图专用色(materials.xml 反查:木族/神龛砖/陨石/荧光岩/岩浆/苔藓/史莱姆;f0bbee=油罐内容物)
  0x613e02: WOOD, 0x644600: WOOD, 0x613e00: WOOD, 0x413f41: WOOD,
  0x786c42: BRICK, 0x6f5439: BRICK, 0x1d1010: METEOR, 0x145014: GLOW,
  0xff6000: LAVA, 0x33b828: MOSS, 0x45ff45: ACID, 0x80ff80: ACID, 0xf0bbee: OIL,
}
// spawn 标记色(wang_scripts.csv)→ 种类;scene1/2 是布景锚(coalmine.lua g_pixel_scene_01/02)
const MARKS = {
  0x60a064: 'torch', 0x23b9c3: 'torch', 0x55af4b: 'torch',
  0xff0000: 'mob', 0x800000: 'mob', 0xff8000: 'mob', 0xc84040: 'mob', 0x804040: 'mob',
  0x0000ff: 'mob', 0xb40000: 'mob', 0xf12ab5: 'mob',
  0xc88d1a: 'vessel', 0xc88000: 'vessel', 0xc80040: 'vessel', 0x50a000: 'vessel', 0xbca0f0: 'vessel',
  0x50a0f0: 'vessel', 0x33934c: 'vessel', 0x50fafa: 'vessel', 0xc35700: 'vessel', 0x4e175e: 'vessel', 0x00ff00: 'vessel',
  0xffff00: 'lamp', 0x96c850: 'lamp',
  0x55ff8c: 'gold', 0x78ffff: 'gold', 0xebcd01: 'gold', 0xf7bb43: 'gold',
  0x80ff5a: 'vine',
  0xff0aff: 'scene1', 0xff0080: 'scene2',
}
const MARK_COLOR = {
  mob: '#ff3050', vessel: '#ffa030', lamp: '#ffe040', torch: '#ff70ff',
  gold: '#7fffd4', vine: '#60c060', scene1: '#ff0aff', scene2: '#ff5aa0',
}
const MARK_DESC = {
  mob: '怪物(小/大/精英/蝇巢)', vessel: '罐子/药水/道具', lamp: '吊灯', torch: '火把/蜡烛',
  gold: '金簇/宝箱锚', vine: '垂藤', scene1: '布景锚1(油罐/煤坑)', scene2: '布景锚2(神龛/实验室)',
}
// coalmine.lua 的两套布景池(权重略化为等概,scene1 先掷 50% 油罐——照 lua load_pixel_scene)
const SCENE1_OIL = ['oiltank_1', 'oiltank_2', 'oiltank_3']
const SCENE1_PIT = ['coalpit01', 'coalpit02', 'coalpit03', 'coalpit04', 'coalpit05', 'carthill', 'swarm']
const SCENE2 = ['shrine01', 'shrine02', 'slimepit', 'laboratory']

// ── 确定性随机(mulberry32):每阶段独立流,开关某层不重排其他层 ──
function rngOf(seed, stage) {
  let a = (seed * 2654435761 ^ stage * 0x9e3779b9) >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// 值噪声(材质带用,波长 1/freq 像素)
function makeNoise(seed) {
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 1013904223) >>> 0
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  return (x, y, freq) => {
    const fx = x * freq, fy = y * freq
    const x0 = Math.floor(fx), y0 = Math.floor(fy)
    const tx = fx - x0, ty = fy - y0
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
    const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d2 = hash(x0 + 1, y0 + 1)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d2) * sx * sy
  }
}

async function loadImageData(url) {
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
  const cv = document.createElement('canvas')
  cv.width = img.width; cv.height = img.height
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  return { data: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height, img }
}

// ── ① 模板解析:stbhw corner 头 + 枚举序切砖(与 convert-coalmine.mjs 同源,原生尺寸)──
function parseTemplate(td) {
  const { data: d, w: iw } = td
  const px = (x, y) => { const i = (y * iw + x) * 4; return (d[i] << 16 | d[i + 1] << 8 | d[i + 2]) >>> 0 }
  // 头字节藏在首行末 9 字节(按 RGB 3字节/像素展开)^ (i*55)
  const rgbRow0 = []
  for (let x = 0; x < iw; x++) { const i = x * 4; rgbRow0.push(d[i], d[i + 1], d[i + 2]) }
  const header = []
  for (let i = 0; i < 9; i++) header.push((rgbRow0[iw * 3 - 1 - i] ^ (i * 55)) & 255)
  if (header[7] !== 0xc0) throw new Error('不是 corner 模板: ' + header.join(','))
  const s = header[6], nc = [header[0], header[1], header[2], header[3]], vx = header[4], vy = header[5]

  const classify = (c) => {
    if (MAT[c] !== undefined) return MAT[c]
    const r = c >> 16, g = (c >> 8) & 255, b = c & 255
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    if (mx - mn < 24) return mx >= 96 ? SLOT : AIR
    return AIR // 未知彩色(其他群系的注记)归空气
  }
  const cutTile = (x0, y0, w, h) => {
    const a = new Uint8Array(w * h)
    const marks = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = px(x0 + x, y0 + y)
      const mk = MARKS[c]
      if (mk) { marks.push({ x, y, kind: mk }); a[y * w + x] = AIR; continue }
      a[y * w + x] = classify(c)
    }
    return { a, w, h, marks }
  }
  // scale2x(EPX) 类域放大:平滑斜边,不糊类别(与 convert-coalmine.mjs 同款)
  const epx = (a, w, h) => {
    const W2 = w * 2, b2 = new Uint8Array(W2 * h * 2)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const P = a[y * w + x]
      const A = y > 0 ? a[(y - 1) * w + x] : P
      const B = x < w - 1 ? a[y * w + x + 1] : P
      const C = x > 0 ? a[y * w + x - 1] : P
      const D = y < h - 1 ? a[(y + 1) * w + x] : P
      let p1 = P, p2 = P, p3 = P, p4 = P
      if (C === A && C !== D && A !== B) p1 = A
      if (A === B && A !== C && B !== D) p2 = B
      if (D === C && D !== B && C !== A) p3 = C
      if (B === D && B !== A && D !== C) p4 = D
      const o = (y * 2) * W2 + x * 2
      b2[o] = p1; b2[o + 1] = p2; b2[o + W2] = p3; b2[o + W2 + 1] = p4
    }
    return b2
  }
  const upscale = (t) => {
    let a = t.a, w = t.w, h = t.h
    for (let k = 1; k < SCALE; k *= 2) { a = epx(a, w, h); w *= 2; h *= 2 }
    return { a, w, h, marks: t.marks.map((m) => ({ x: m.x * SCALE, y: m.y * SCALE, kind: m.kind })), corner: t.corner }
  }
  // corner 模板枚举(严格照 stbhw__process_template)
  const hT = [], vT = []
  let ypos = 2
  for (let k = 0; k < nc[2]; k++) for (let j = 0; j < nc[1]; j++) for (let i = 0; i < nc[0]; i++) for (let q = 0; q < vy; q++) {
    let xpos = 0
    for (let v = 0; v < vx; v++) for (let c = 0; c < nc[3]; c++) for (let b = 0; b < nc[2]; b++) for (let a = 0; a < nc[1]; a++) {
      const t = cutTile(xpos + 1, ypos + 1, 2 * s, s)
      t.corner = [a, b, c, i, j, k]
      hT.push(upscale(t))
      xpos += 2 * s + 3
    }
    ypos += s + 3
  }
  ypos += 2
  for (let k = 0; k < nc[3]; k++) for (let j = 0; j < nc[0]; j++) for (let i = 0; i < nc[1]; i++) for (let q = 0; q < vx; q++) {
    let xpos = 0
    for (let v = 0; v < vy; v++) for (let c = 0; c < nc[2]; c++) for (let b = 0; b < nc[3]; b++) for (let a = 0; a < nc[0]; a++) {
      const t = cutTile(xpos + 1, ypos + 1, s, 2 * s)
      t.corner = [a, b, c, i, j, k]
      vT.push(upscale(t))
      xpos += s + 3
    }
    ypos += 2 * s + 3
  }
  return { s, nc, hT, vT }
}

// ── ① 生成:stbhw corner 拼接(顶点色网格 + 3×2 重复消除 + 六顶点精确匹配)──
// 标记概率门控:原版 wang_scripts 的 spawn 函数内部掷概率(概率表大半是"空",照密度近似)
const MARK_GATE = { mob: 0.12, vessel: 0.09, lamp: 0.04, torch: 0.15, gold: 0.3, vine: 0.5 }
function generateLayout(tpl, seed) {
  const rng = rngOf(seed, 1)
  const rngM = rngOf(seed, 4)
  const { nc } = tpl
  const s = tpl.s * SCALE
  const world = new Uint8Array(W * H).fill(SLOT)
  const marks = []
  const ROWS = ((H / s) | 0) + 8, COLS = ((W / s) | 0) + 10
  const ccol = []
  for (let r = 0; r < ROWS; r++) ccol.push(new Int8Array(COLS))
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) ccol[j][i] = (rng() * nc[(i - j + 1) & 3]) | 0
  const match = (i, j) => ccol[j][i] === ccol[j + 1][i + 1]
  for (let j = 0; j < ROWS - 3; j++) for (let i = 0; i < COLS - 3; i++) {
    if (match(i, j) && match(i, j + 1) && match(i, j + 2) && match(i + 1, j) && match(i + 1, j + 1) && match(i + 1, j + 2)) {
      const p = ((i + 1) - (j + 1) + 1) & 3
      if (nc[p] > 1) ccol[j + 1][i + 1] = (ccol[j + 1][i + 1] + 1 + ((rng() * (nc[p] - 1)) | 0)) % nc[p]
    }
    if (match(i, j) && match(i + 1, j) && match(i + 2, j) && match(i, j + 1) && match(i + 1, j + 1) && match(i + 2, j + 1)) {
      const p = ((i + 2) - (j + 1) + 1) & 3
      if (nc[p] > 1) ccol[j + 1][i + 2] = (ccol[j + 1][i + 2] + 1 + ((rng() * (nc[p] - 1)) | 0)) % nc[p]
    }
  }
  const pick = (list, a, b, c, d2, e, f) => {
    const cand = []
    for (const t of list) {
      const k = t.corner
      if (k[0] === a && k[1] === b && k[2] === c && k[3] === d2 && k[4] === e && k[5] === f) cand.push(t)
    }
    return cand.length ? cand[(rng() * cand.length) | 0] : null
  }
  const stamp = (t, xpos, ypos) => {
    for (let y = 0; y < t.h; y++) {
      const wy = ypos + y
      if (wy < 0 || wy >= H) continue
      for (let x = 0; x < t.w; x++) {
        const wx = xpos + x
        if (wx < 0 || wx >= W) continue
        world[wy * W + wx] = t.a[y * t.w + x]
      }
    }
    for (const m of t.marks) {
      const wx = xpos + m.x, wy = ypos + m.y
      if (wx < 0 || wx >= W || wy < 0 || wy >= H) continue
      const gate = MARK_GATE[m.kind]
      if (gate !== undefined && rngM() > gate) continue
      marks.push({ x: wx, y: wy, kind: m.kind })
    }
  }
  let nTiles = 0
  for (let j = -1; j * s < H; j++) {
    const ypos = j * s
    const phase = j & 3
    for (let i = phase === 0 ? 0 : phase - 4; ; i += 4) {
      const xpos = i * s
      if (xpos >= W) break
      if (xpos + s * 2 >= 0 && ypos >= 0) {
        const t = pick(tpl.hT, ccol[j + 2][i + 2], ccol[j + 2][i + 3], ccol[j + 2][i + 4],
          ccol[j + 3][i + 2], ccol[j + 3][i + 3], ccol[j + 3][i + 4])
        if (t) { stamp(t, xpos, ypos); nTiles++ }
      }
      const xv = xpos + s * 3
      if (xv < W && xv + s >= 0) {
        const t = pick(tpl.vT, ccol[j + 2][i + 5], ccol[j + 3][i + 5], ccol[j + 4][i + 5],
          ccol[j + 2][i + 6], ccol[j + 3][i + 6], ccol[j + 4][i + 6])
        if (t) { stamp(t, xv, ypos); nTiles++ }
      }
    }
  }
  return { world, marks, nTiles }
}

// ── ② 材质带(coalmine.xml MaterialComponent 的近似移植)──
// 白槽(SLOT)→ 噪声带分土/沙/湿岩;再叠煤透镜(polka,扁平横透镜)与小型煤斑(perlin);深层金簇
const FILLER = new Uint8Array(16)
FILLER[SLOT] = FILLER[SOIL] = FILLER[SAND] = FILLER[WET] = 1
function applyBands(world, seed, opts) {
  const noise = makeNoise(seed ^ 0x5eed)
  if (opts.bands) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (world[y * W + x] !== SLOT) continue
      const v = 0.45 + 0.62 * noise(x, y, 1 / 180)
      world[y * W + x] = (v < 0.58 && y < H * 0.5) ? SOIL : v > 0.97 ? WET : SAND
    }
  }
  if (opts.coal) {
    const rng = rngOf(seed, 2)
    // 扁平煤透镜:照 coalmine.xml coal polka(rare_scale_x≈0.01 → 横向宽胞),原作矿层横纹即出自这里
    for (let cy = 0; cy < H; cy += 44) for (let cx = 0; cx < W; cx += 96) {
      if (rng() > 0.12) continue
      const mx = cx + rng() * 96, my = cy + rng() * 44
      const rx = 14 + rng() * 24, ry = 3.5 + rng() * 6
      for (let y = Math.max(0, my - ry) | 0; y < Math.min(H, my + ry); y++)
        for (let x = Math.max(0, mx - rx) | 0; x < Math.min(W, mx + rx); x++) {
          const dx = (x - mx) / rx, dy = (y - my) / ry
          if (dx * dx + dy * dy <= 1 && FILLER[world[y * W + x]]) world[y * W + x] = COAL
        }
    }
    // 小型煤斑(coalmine.xml coal perlin 分量)
    for (let cy = 0; cy < H; cy += 48) for (let cx = 0; cx < W; cx += 48) {
      if (rng() > 0.22) continue
      const mx = cx + rng() * 48, my = cy + rng() * 48, r = 2 + rng() * 6
      for (let y = Math.max(0, my - r) | 0; y < Math.min(H, my + r); y++)
        for (let x = Math.max(0, mx - r) | 0; x < Math.min(W, mx + r); x++) {
          const dx = x - mx, dy = y - my
          if (dx * dx + dy * dy <= r * r && FILLER[world[y * W + x]]) world[y * W + x] = COAL
        }
    }
    // 深层金簇(coalmine.xml gold:限 y>750/1024 深度)
    for (let cy = (H * 0.72) | 0; cy < H; cy += 56) for (let cx = 0; cx < W; cx += 88) {
      if (rng() > 0.13) continue
      const mx = cx + rng() * 88, my = cy + rng() * 56
      const n = 3 + (rng() * 5) | 0
      for (let k = 0; k < n; k++) {
        const gx = (mx + (rng() - 0.5) * 10) | 0, gy = (my + (rng() - 0.5) * 8) | 0
        if (gx >= 0 && gx < W && gy >= 0 && gy < H && FILLER[world[gy * W + gx]]) world[gy * W + gx] = GOLD
      }
    }
  }
}

// ── ③ pixel scene 盖章:材质层写入 world,美术层(_visual)记下来渲染时叠 ──
function applyScenes(world, marks, scenes, seed, out) {
  const rng = rngOf(seed, 3)
  const placed = []
  // 布景材质图约定色(实证采样):ffffff=保留原地形,000000=挖空,f7bb43=金材质(非标记)
  const classify = (c, alpha) => {
    if (alpha < 128 || c === 0xffffff) return -1
    if (c === 0xf7bb43) return GOLD
    if (MAT[c] !== undefined) return MAT[c]
    const mk = MARKS[c]
    if (mk && mk !== 'scene1' && mk !== 'scene2') return -2 // 布景内的 spawn 标记
    return -1 // 未知色一律保留(布景图不含灰阶填充)
  }
  // 原版布景互不重叠(引擎级机制的等效):贪心占格,撞上已放矩形就跳过
  const rects = []
  const overlaps = (x, y, w, h) => {
    for (const r of rects) if (x < r.x + r.w + 16 && x + w + 16 > r.x && y < r.y + r.h + 16 && y + h + 16 > r.y) return true
    return false
  }
  for (const m of marks) {
    if (m.kind !== 'scene1' && m.kind !== 'scene2') continue
    let pool
    if (m.kind === 'scene1') pool = rng() < 0.5 ? SCENE1_OIL : SCENE1_PIT
    else pool = SCENE2
    const name = pool[(rng() * pool.length) | 0]
    const sc = scenes[name]
    if (!sc) continue
    const ox = m.x, oy = m.y // 原版 LoadPixelScene 以标记点为左上角
    if (overlaps(ox, oy, sc.w, sc.h)) continue
    rects.push({ x: ox, y: oy, w: sc.w, h: sc.h })
    for (let y = 0; y < sc.h; y++) {
      const wy = oy + y
      if (wy < 0 || wy >= H) continue
      for (let x = 0; x < sc.w; x++) {
        const wx = ox + x
        if (wx < 0 || wx >= W) continue
        const i = (y * sc.w + x) * 4
        const c = (sc.data[i] << 16 | sc.data[i + 1] << 8 | sc.data[i + 2]) >>> 0
        const cls = classify(c, sc.data[i + 3])
        if (cls === -1) continue
        if (cls === -2) { out.sceneMarks.push({ x: wx, y: wy, kind: MARKS[c] }); world[wy * W + wx] = AIR; continue }
        world[wy * W + wx] = cls
      }
    }
    placed.push({ name, x: ox, y: oy, w: sc.w, h: sc.h, visual: scenes[name + '_visual'] || null })
  }
  return placed
}

// ── ④ 草皮/垂藤(coalmine.xml VegetationComponent 的近似)──
function applyGrass(world, marks) {
  // 草长成斑块而非满铺(原版 VegetationComponent 有密度参数):按 x 哈希开关,连续 8~20px 一段
  for (let x = 0; x < W; x++) {
    const h = (x * 2654435761 >>> 0) % 100
    for (let y = 1; y < H; y++) {
      const m = world[y * W + x]
      if ((m === SOIL || m === SAND) && world[(y - 1) * W + x] === AIR) {
        if (((x >> 4) * 40503 >>> 0) % 100 < 55 || h < 25) world[(y - 1) * W + x] = GRASS
      }
    }
  }
  for (const m of marks) {
    if (m.kind !== 'vine') continue
    const len = 8 + ((m.x * 7 + m.y * 13) % 18)
    for (let k = 0; k < len; k++) {
      const wy = m.y + k
      if (wy >= H || world[wy * W + m.x] !== AIR) break
      world[wy * W + m.x] = MOSS
    }
  }
}

// ── 渲染:真材质纹理采样(materials_gfx 原件)+ 背景墙 + 边缘 rim + 美术层 + 标记 ──
// TEXTURES[材质] = {data,w,h}(main() 里加载);液体无纹理,按 materials.xml 半透明色压在背景上
let TEXTURES = {}
const LIQUID_BLEND = {
  [WATER]: [0x37, 0x62, 0x59, 0.63], // A0376259
  [OIL]: [0x3d, 0x37, 0x28, 0.9],    // e63D3728
  [ACID]: [0x4a, 0xc4, 0x4a, 0.7],
  [LAVA]: [0xff, 0x66, 0x10, 0.95],
}
function composite(world, placed, allMarks, opts, cvOut) {
  const img = new ImageData(W, H)
  const d = img.data
  const bg = TEXTURES.bg
  const sample = (t, x, y) => {
    const i = ((y % t.h) * t.w + (x % t.w)) * 4
    return [t.data[i], t.data[i + 1], t.data[i + 2]]
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = world[y * W + x]
    let r, g, b
    // 背景墙:真 background_coalmine.png 压暗(原版洞腔背后就是这张,亮度靠光照,这里全图恒定 0.42)
    const bgc = bg ? sample(bg, x, y) : COLOR[AIR]
    if (m === AIR) { r = bgc[0] * 0.42; g = bgc[1] * 0.42; b = bgc[2] * 0.42 }
    else if (LIQUID_BLEND[m]) {
      const [lr, lg, lb, la] = LIQUID_BLEND[m]
      r = bgc[0] * 0.42 * (1 - la) + lr * la
      g = bgc[1] * 0.42 * (1 - la) + lg * la
      b = bgc[2] * 0.42 * (1 - la) + lb * la
    } else if (TEXTURES[m]) {
      ;[r, g, b] = sample(TEXTURES[m], x, y)
      if (m === WET) { r *= 0.62; g *= 0.74; b *= 0.72 } // 湿岩=rock.png 压暗偏灰绿(原版同图异色)
    } else {
      ;[r, g, b] = COLOR[m]
      let hsh = (x * 374761393 + y * 668265263) >>> 0
      hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177) >>> 0
      const j = 0.86 + ((hsh >>> 16) % 100) / 100 * 0.28
      r *= j; g *= j; b *= j
    }
    if (m !== AIR && !LIQUID_BLEND[m] && opts.edges && m !== GRASS) {
      // 边缘 rim(原版 EdgeGraphics+受光边):顶边最亮、侧边次之、底边压暗
      const up = y > 0 ? world[(y - 1) * W + x] : m
      const dn = y < H - 1 ? world[(y + 1) * W + x] : m
      const lf = x > 0 ? world[y * W + x - 1] : m
      const rt = x < W - 1 ? world[y * W + x + 1] : m
      if (up === AIR || up === GRASS) { r = r * 1.5 + 16; g = g * 1.5 + 16; b = b * 1.4 + 10 }
      else if (lf === AIR || rt === AIR) { r = r * 1.28 + 8; g = g * 1.28 + 8; b = b * 1.22 + 5 }
      else if (dn === AIR) { r *= 0.62; g *= 0.62; b *= 0.62 }
    }
    const o = (y * W + x) * 4
    d[o] = Math.min(255, r); d[o + 1] = Math.min(255, g); d[o + 2] = Math.min(255, b); d[o + 3] = 255
  }
  cvOut.width = W; cvOut.height = H
  const ctx = cvOut.getContext('2d')
  ctx.putImageData(img, 0, 0)
  if (opts.visual) {
    for (const p of placed) if (p.visual) ctx.drawImage(p.visual.img, p.x, p.y)
  }
  if (opts.light) {
    // 光照氛围(原版观感的最后一块):环境光压暗全图,灯/火把/岩浆做局部暖光,乘法叠加
    const lc = document.createElement('canvas')
    lc.width = W; lc.height = H
    const g = lc.getContext('2d')
    g.fillStyle = 'rgb(88,92,104)'
    g.fillRect(0, 0, W, H)
    g.globalCompositeOperation = 'lighter'
    const glow = (x, y, rad, rgb, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, rad)
      gr.addColorStop(0, `rgba(${rgb},${a})`)
      gr.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = gr
      g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill()
    }
    for (const m of allMarks) {
      if (m.kind === 'lamp') glow(m.x, m.y, 170, '255,214,140', 1)
      else if (m.kind === 'torch') glow(m.x, m.y, 110, '255,190,110', 0.9)
    }
    for (let y = 0; y < H; y += 12) for (let x = 0; x < W; x += 12) { // 岩浆/荧光岩自发光(粗采样)
      const m = world[y * W + x]
      if (m === LAVA) glow(x, y, 70, '255,130,40', 0.5)
      else if (m === GLOW) glow(x, y, 40, '90,220,90', 0.3)
    }
    ctx.globalCompositeOperation = 'multiply'
    ctx.drawImage(lc, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
  }
  if (opts.marks) {
    for (const m of allMarks) {
      ctx.fillStyle = MARK_COLOR[m.kind] || '#fff'
      ctx.fillRect(m.x - 1, m.y - 1, 3, 3)
    }
  }
}

// ── 圣山三层对照:LoadPixelScene(altar, altar_visual, bg) 原样叠,材质层用 templebrick 纹理替换 wang 色 ──
const TEMPLE_MAT = {
  0x786c42: 'templebrick', 0x6f5439: 'templebrick',
  0x413f24: 'wood', 0x2f554c: 'water', 0x000000: null,
}
// ── 地表+洞选(纯算法,参数照 hills.xml,零原作贴图)──
// 高度场: SIN_CAPPED_SIMPLEX(x * 0.00128571) → 映射 [-292, +234] 像素,再缩到画布
// 洞选 BitmapCaves(512×256 掩膜上的计数,这里直接在世界像素上做同构):
//   blob 20~55 个椭圆  /  worm 50~100 条(各 0~2 子)  /  地表洞 7~12 个(各 2~7 子,必开口)
//   mountain 0~15 个高斯鼓包  /  beginning_down 一条开局竖井
const HW = 1024, HH = 512
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1013904223) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function valueNoise(x, y, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
  const a = hash2(x0, y0, s), b = hash2(x0 + 1, y0, s), c = hash2(x0, y0 + 1, s), d2 = hash2(x0 + 1, y0 + 1, s)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d2) * sx * sy
}
function fbm(x, y, s, octaves) {
  let v = 0, a = 0.5, f = 1, n = 0
  for (let i = 0; i < octaves; i++) { v += a * valueNoise(x * f, y * f, s + i * 19); n += a; a *= 0.5; f *= 2 }
  return v / n
}
// SIN_CAPPED_SIMPLEX:噪声过 sin,两端被压住,中间坡更陡——hills.xml noise_type 的同构
function sinCapped(x, y, s) { return Math.sin((fbm(x, y, s, 4) * 2 - 1) * Math.PI * 0.5) }

function generateHills(seed, hops) {
  const rng = rngOf(seed, 1)
  const world = new Uint8Array(HW * HH)
  const surf = new Int16Array(HW)
  // ① 高度场。原作:mGradientNoiseScale=0.00128571 → 波长≈778px;amp 映射 Low=-292 High=234
  // 画布高 512,把振幅缩到 ~90px,基线 y=140,这样天上+地下都看得见
  const SCALE = 0.00128571 * 778 / 778 // 保持原波长
  for (let x = 0; x < HW; x++) {
    const n = sinCapped(x * 0.00128571, 0.37, seed) // [-1,1]
    const offset = -292.571 + (234.057 + 292.571) * (n * 0.5 + 0.5)
    surf[x] = Math.max(48, Math.min(260, (140 + offset * (90 / 263)) | 0))
  }
  // mountain 鼓包:0~15 个,size 1~10 → 加到高度上(原作 mountain_count / mountain_size)
  const nMount = hops.mountains ? ((rng() * 16) | 0) : 0
  for (let i = 0; i < nMount; i++) {
    const mx = rng() * HW, sz = 1 + rng() * 9
    const rw = 18 + sz * 10, rh = 6 + sz * 3.2
    for (let x = Math.max(0, mx - rw * 2) | 0; x < Math.min(HW, mx + rw * 2); x++) {
      const t = (x - mx) / rw
      surf[x] = Math.max(36, surf[x] - (Math.exp(-t * t) * rh) | 0)
    }
  }
  // 填实心:草皮下 8px 土,再往下石(hills.xml MaterialComponent:soil 浅层 / sand+rock 深层)
  for (let x = 0; x < HW; x++) {
    const h = surf[x]
    for (let y = h; y < HH; y++) {
      const d = y - h
      world[y * HW + x] = d === 0 ? GRASS : d < 8 + ((x * 13 + seed) % 4) ? SOIL : d < 40 ? SAND : ROCK
    }
  }
  const carve = (cx, cy, rx, ry) => {
    const x0 = Math.max(0, (cx - rx) | 0), x1 = Math.min(HW - 1, (cx + rx) | 0)
    const y0 = Math.max(0, (cy - ry) | 0), y1 = Math.min(HH - 1, (cy + ry) | 0)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1 && world[y * HW + x]) world[y * HW + x] = AIR
    }
  }
  const worm = (x, y, heading, steps, rad, childBudget, downBias) => {
    for (let i = 0; i < steps; i++) {
      const r = rad * (0.65 + rng() * 0.5)
      carve(x, y, r, r * (0.7 + rng() * 0.5))
      heading += (rng() - 0.5) * 0.85
      if (downBias) heading = heading * 0.7 + (Math.PI / 2) * 0.3 // 地表洞偏向朝下
      x += Math.cos(heading) * r * 0.7
      y += Math.sin(heading) * r * 0.7
      if (x < 4 || x >= HW - 4 || y < 4 || y >= HH - 4) break
    }
    if (childBudget <= 0) return
    const n = childBudget
    for (let c = 0; c < n; c++) {
      worm(x, y, heading + (rng() - 0.5) * 1.4, (steps * 0.45) | 0, rad * 0.72, 0, downBias)
    }
  }
  let nBlob = 0, nWorm = 0, nSurf = 0
  // ② blob:地下孤立椭圆气泡(blob_caves_count 20~55, radius 1~10, strength 当半径倍率)
  if (hops.blobs) {
    nBlob = 20 + ((rng() * 36) | 0)
    for (let i = 0; i < nBlob; i++) {
      const x = 20 + rng() * (HW - 40)
      const y = Math.max(surf[x | 0] + 18, 80 + rng() * (HH - 100))
      const r = (1 + rng() * 9) * (1.5 + rng() * 1.5)
      carve(x, y, r, r * (0.45 + rng() * 0.4))
    }
  }
  // ③ 地下蠕虫洞:50~100 条,各 0~2 子(cave_count / cave_childs)
  if (hops.worms) {
    nWorm = 50 + ((rng() * 51) | 0)
    for (let i = 0; i < nWorm; i++) {
      const x = 16 + rng() * (HW - 32)
      const y = Math.max(surf[x | 0] + 24, 100 + rng() * (HH - 120))
      const kids = (rng() * 3) | 0
      worm(x, y, rng() * 6.28, 18 + ((rng() * 40) | 0), 2.2 + rng() * 3.5, kids, false)
    }
  }
  // ④ 洞选=地表洞:7~12 个,从地面开口往下打,各 2~7 子(surface_caves_count / surface_cave_childs)
  if (hops.surfaceCaves) {
    nSurf = 7 + ((rng() * 6) | 0)
    for (let i = 0; i < nSurf; i++) {
      const x = 30 + rng() * (HW - 60)
      const y = surf[x | 0] + 1
      const kids = 2 + ((rng() * 6) | 0)
      worm(x, y, Math.PI / 2 + (rng() - 0.5) * 0.7, 28 + ((rng() * 50) | 0), 3.2 + rng() * 4, kids, true)
    }
  }
  // ⑤ 开局竖井(do_beginning_down=1):固定从画面中段地面打一口下去
  if (hops.shaft) {
    const sx = (HW * 0.42) | 0
    worm(sx, surf[sx] + 1, Math.PI / 2, 70, 4.2, 2, true)
  }
  return { world, surf, nBlob, nWorm, nSurf, nMount }
}
function paintHills(gen, cvOut) {
  const img = new ImageData(HW, HH)
  const d = img.data
  const sky = [18, 28, 42], dirt = [86, 72, 42], sand = [110, 98, 58], rock = [58, 62, 56], grass = [62, 110, 40]
  for (let y = 0; y < HH; y++) for (let x = 0; x < HW; x++) {
    const m = gen.world[y * HW + x]
    let r, g, b
    if (m === AIR) {
      const k = Math.max(0, 1 - y / 220)
      r = sky[0] * (0.35 + k * 0.65); g = sky[1] * (0.35 + k * 0.65); b = sky[2] * (0.45 + k * 0.55)
    } else if (m === GRASS) { r = grass[0]; g = grass[1]; b = grass[2] }
    else if (m === SOIL) { r = dirt[0]; g = dirt[1]; b = dirt[2] }
    else if (m === SAND) { r = sand[0]; g = sand[1]; b = sand[2] }
    else { r = rock[0]; g = rock[1]; b = rock[2] }
    if (m !== AIR) {
      const up = y > 0 ? gen.world[(y - 1) * HW + x] : m
      if (up === AIR) { r = r * 1.45 + 12; g = g * 1.45 + 12; b = b * 1.35 + 8 }
      let hsh = (x * 374761393 + y * 668265263) >>> 0
      hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177) >>> 0
      const j = 0.88 + ((hsh >>> 16) % 80) / 100 * 0.22
      r *= j; g *= j; b *= j
    }
    const o = (y * HW + x) * 4
    d[o] = Math.min(255, r); d[o + 1] = Math.min(255, g); d[o + 2] = Math.min(255, b); d[o + 3] = 255
  }
  cvOut.width = HW; cvOut.height = HH
  cvOut.getContext('2d').putImageData(img, 0, 0)
}

function paintTemple(part, layers, tex, cvOut) {
  const mat = layers[part].mat, vis = layers[part].vis, bg = layers[part].bg
  const tw = mat.w, th = mat.h
  const img = new ImageData(tw, th)
  const d = img.data
  const sample = (t, x, y) => {
    const i = ((y % t.h) * t.w + (x % t.w)) * 4
    return [t.data[i], t.data[i + 1], t.data[i + 2], t.data[i + 3]]
  }
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = (y * tw + x) * 4
    let r = 8, g = 8, b = 10
    if (bg) { const s = sample(bg, x, y); if (s[3] > 16) { r = s[0] * 0.55; g = s[1] * 0.55; b = s[2] * 0.55 } }
    const c = (mat.data[i] << 16 | mat.data[i + 1] << 8 | mat.data[i + 2]) >>> 0
    const a = mat.data[i + 3]
    if (a > 128 && c !== 0xffffff) {
      const name = TEMPLE_MAT[c]
      if (name === null) { /* 挖空,留背景 */ }
      else if (name === 'water') { r = r * 0.35 + 0x37 * 0.65; g = g * 0.35 + 0x62 * 0.65; b = b * 0.35 + 0x80 * 0.75 }
      else if (tex[name]) {
        const s = sample(tex[name], x, y)
        r = s[0]; g = s[1]; b = s[2]
      } else if (c !== 0x000000) { r = mat.data[i]; g = mat.data[i + 1]; b = mat.data[i + 2] }
    }
    if (vis) {
      const s = sample(vis, x, y)
      if (s[3] > 40) { // visual 手绘雕刻/符文盖在材质上
        const k = s[3] / 255
        r = r * (1 - k) + s[0] * k
        g = g * (1 - k) + s[1] * k
        b = b * (1 - k) + s[2] * k
      }
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255
  }
  cvOut.width = tw; cvOut.height = th
  cvOut.getContext('2d').putImageData(img, 0, 0)
}

// ── 主流程 + UI ──
async function main() {
  const tplData = await loadImageData(TPL_URL)
  const tpl = parseTemplate(tplData)
  if (tpl.s !== 13) console.warn('模板 s=' + tpl.s)
  const sceneNames = [...SCENE1_OIL, ...SCENE1_PIT, ...SCENE2]
  const scenes = {}
  await Promise.all(sceneNames.flatMap((n) => [n, n + '_visual'].map(async (f) => {
    try { scenes[f] = await loadImageData(SCENE_DIR + f + '.png') } catch { /* 缺文件跳过 */ }
  })))
  // 真材质纹理(materials.xml texture_file → data.wak 原件)
  const TEX_FILES = [
    [SOIL, 'soil'], [SAND, 'earth'], [ROCK, 'rock'], [WET, 'rock'], [COAL, 'coal'],
    [WOOD, 'wood'], [STEEL, 'steel'], [BRICK, 'templebrick'], [METEOR, 'meteor'],
    [GLOW, 'glowrock'], [MOSS, 'moss'], [GRASS, 'grass'], [GOLD, 'gold'], ['bg', 'background_coalmine'],
  ]
  await Promise.all(TEX_FILES.map(async ([key, f]) => {
    try { TEXTURES[key] = await loadImageData('/res/noita/tex/' + f + '.png') } catch { /* 缺图回退纯色 */ }
  }))
  const templeTex = {}
  await Promise.all(['templebrick', 'templebrick_golden', 'wood'].map(async (f) => {
    try { templeTex[f] = await loadImageData('/res/noita/tex/' + f + '.png') } catch { /* */ }
  }))
  const templeParts = {}
  await Promise.all(['altar', 'altar_left', 'altar_right'].map(async (p) => {
    const [mat, vis, bg] = await Promise.all([
      loadImageData('/res/noita/temple/' + p + '.png'),
      loadImageData('/res/noita/temple/' + p + '_visual.png'),
      loadImageData('/res/noita/temple/' + p + '_background.png'),
    ])
    templeParts[p] = { mat, vis, bg }
  }))
  let atlasImg = null
  try { atlasImg = await loadImageData('/res/noita/atlas/biome_map.png') } catch { /* */ }

  const opts = { bands: true, coal: true, scenes: true, visual: true, grass: true, edges: true, light: false, marks: false }
  const hops = { mountains: true, blobs: true, worms: true, surfaceCaves: true, shaft: true }
  let seed = (Math.random() * 1e9) | 0
  let mode = 'hills' // hills | mine | temple | atlas
  let templePart = 'altar'
  const buf = document.createElement('canvas')
  const view = document.getElementById('view')
  const stage = document.getElementById('stage')
  let zoom = 1.6, panX = 20, panY = 20
  let drawW = W, drawH = H

  const rebuild = () => {
    if (mode === 'hills') {
      const t0 = performance.now()
      const gen = generateHills(seed, hops)
      paintHills(gen, buf)
      drawW = HW; drawH = HH
      document.getElementById('seedStat').textContent = `种子 ${seed}`
      document.getElementById('stat').innerHTML =
        `高度场 SIN_CAPPED_SIMPLEX 波长≈778px<br>` +
        `山包 ${gen.nMount}　气泡 ${gen.nBlob}<br>` +
        `蠕虫洞 ${gen.nWorm}　地表洞 ${gen.nSurf}(洞选)<br>` +
        `生成 ${(performance.now() - t0) | 0}ms<br>` +
        `公式见面板下「洞选规则」`
      draw(); return
    }
    if (mode === 'temple') {
      paintTemple(templePart, templeParts, templeTex, buf)
      drawW = buf.width; drawH = buf.height
      document.getElementById('seedStat').textContent = '圣山 ' + templePart + ' 512×282 三层原件'
      document.getElementById('stat').innerHTML =
        '不是砖拼。temple_altar.lua 一句 LoadPixelScene。<br>' +
        '下层 altar_background=雕像/柱廊<br>中层 altar.png=砖/水碰撞<br>上层 altar_visual=雕刻符文青苔<br>' +
        '左/右厅各一套同尺寸。世界图 #93cb4c/4d/4e 三格横拼。'
      draw(); return
    }
    if (mode === 'atlas') {
      buf.width = atlasImg.w; buf.height = atlasImg.h
      const ctx = buf.getContext('2d')
      ctx.putImageData(new ImageData(new Uint8ClampedArray(atlasImg.data), atlasImg.w, atlasImg.h), 0, 0)
      drawW = atlasImg.w; drawH = atlasImg.h
      document.getElementById('seedStat').textContent = '世界图 70×48'
      document.getElementById('stat').innerHTML =
        'biome_map.png 每像素一种群系。<br>' +
        '橙 #d57917=煤矿　绿 #93cb4c=圣山<br>' +
        '青 #124445=挖掘场　蓝 #1775d5=雪窟<br>' +
        '完整色表见 noita-ref/MAP-INVENTORY.md'
      draw(); return
    }
    drawW = W; drawH = H
    const t0 = performance.now()
    const { world, marks, nTiles } = generateLayout(tpl, seed)
    applyBands(world, seed, opts)
    const out = { sceneMarks: [] }
    const placed = opts.scenes ? applyScenes(world, marks, scenes, seed, out) : []
    if (opts.grass) applyGrass(world, marks)
    const allMarks = marks.filter((m) => m.kind !== 'scene1' && m.kind !== 'scene2' || !opts.scenes)
      .concat(opts.scenes ? out.sceneMarks : [])
    composite(world, placed, allMarks, opts, buf)
    const byKind = {}
    for (const m of marks) byKind[m.kind] = (byKind[m.kind] || 0) + 1
    document.getElementById('seedStat').textContent = `种子 ${seed}`
    document.getElementById('stat').innerHTML =
      `砖 ${nTiles} 块(H${tpl.hT.length}+V${tpl.vT.length} 池)<br>布景 ${placed.length} 处:` +
      `${placed.map((p) => p.name).join(', ') || '无'}<br>` +
      Object.entries(byKind).map(([k, n]) => `${MARK_DESC[k] || k}×${n}`).join('<br>') +
      `<br>生成 ${(performance.now() - t0) | 0}ms`
    draw()
  }
  const draw = () => {
    view.width = stage.clientWidth
    view.height = stage.clientHeight
    const ctx = view.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#04050a'
    ctx.fillRect(0, 0, view.width, view.height)
    ctx.drawImage(buf, panX, panY, drawW * zoom, drawH * zoom)
  }

  // UI:分层开关
  const togglesEl = document.getElementById('toggles')
  const HILL_TOGGLES = [
    ['mountains', '山包 mountain 0~15'],
    ['blobs', '气泡 blob 20~55'],
    ['worms', '蠕虫洞 50~100'],
    ['surfaceCaves', '洞选 地表开口 7~12'],
    ['shaft', '开局竖井 beginning_down'],
  ]
  for (const [key, label] of HILL_TOGGLES) {
    const el = document.createElement('label')
    el.className = 'row'
    const cb = document.createElement('input')
    cb.type = 'checkbox'; cb.checked = hops[key]
    cb.onchange = () => { hops[key] = cb.checked; if (mode === 'hills') rebuild() }
    el.appendChild(cb); el.appendChild(document.createTextNode(label))
    togglesEl.appendChild(el)
  }
  const TOGGLES = [
    ['bands', '② 材质带(土/沙/湿岩)'],
    ['coal', '② 煤透镜+深层金'],
    ['scenes', '③ 布景材质层'],
    ['visual', '③ 布景手绘美术层'],
    ['grass', '④ 草皮/垂藤'],
    ['edges', '渲染:边缘描边'],
    ['light', '渲染:光照氛围(灯/岩浆)'],
    ['marks', '④ spawn 标记点'],
  ]
  for (const [key, label] of TOGGLES) {
    const el = document.createElement('label')
    el.className = 'row'
    const cb = document.createElement('input')
    cb.type = 'checkbox'; cb.checked = opts[key]
    cb.onchange = () => { opts[key] = cb.checked; rebuild() }
    el.appendChild(cb); el.appendChild(document.createTextNode(label))
    togglesEl.appendChild(el)
  }
  document.getElementById('legend').innerHTML =
    '<div>地表 y(x)=140+sin(fbm(x·0.00128))·90</div>' +
    '<div>洞选:先掷个数,再从地面开口,朝下蠕虫,再掷子洞数分叉</div>' +
    Object.entries(MARK_COLOR)
    .map(([k, c]) => `<div><i style="background:${c}"></i>${MARK_DESC[k]}</div>`).join('')
  const setMode = (m) => {
    mode = m
    if (m === 'temple') { zoom = 2.4; panX = 40; panY = 40 }
    else if (m === 'atlas') { zoom = 12; panX = 80; panY = 40 }
    else if (m === 'hills') { zoom = 1.2; panX = 10; panY = 10 }
    else { zoom = 1.6; panX = 20; panY = 20 }
    rebuild()
  }
  document.getElementById('modeHills').onclick = () => setMode('hills')
  document.getElementById('modeMine').onclick = () => setMode('mine')
  document.getElementById('modeTemple').onclick = () => setMode('temple')
  document.getElementById('modeAtlas').onclick = () => setMode('atlas')
  document.getElementById('regen').onclick = () => {
    if (mode === 'temple') {
      templePart = templePart === 'altar' ? 'altar_left' : templePart === 'altar_left' ? 'altar_right' : 'altar'
      rebuild(); return
    }
    seed = (Math.random() * 1e9) | 0; rebuild()
  }
  document.getElementById('zin').onclick = () => { zoom = Math.min(8, zoom * 1.4); draw() }
  document.getElementById('zout').onclick = () => { zoom = Math.max(0.4, zoom / 1.4); draw() }
  window.addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') { seed = (Math.random() * 1e9) | 0; rebuild() } })
  stage.addEventListener('wheel', (e) => {
    e.preventDefault()
    const k = e.deltaY < 0 ? 1.25 : 0.8
    const nz = Math.min(8, Math.max(0.4, zoom * k))
    panX = e.offsetX - (e.offsetX - panX) * (nz / zoom)
    panY = e.offsetY - (e.offsetY - panY) * (nz / zoom)
    zoom = nz; draw()
  }, { passive: false })
  let dragging = null
  stage.addEventListener('mousedown', (e) => { dragging = { x: e.clientX - panX, y: e.clientY - panY }; stage.classList.add('drag') })
  window.addEventListener('mousemove', (e) => { if (dragging) { panX = e.clientX - dragging.x; panY = e.clientY - dragging.y; draw() } })
  window.addEventListener('mouseup', () => { dragging = null; stage.classList.remove('drag') })
  window.addEventListener('resize', draw)

  rebuild()
  window.__mapLab = {
    get seed() { return seed }, opts, rebuild, tpl,
    stats() {
      const { world } = generateLayout(tpl, seed)
      let air0 = 0
      for (let i = 0; i < world.length; i++) if (world[i] === AIR) air0++
      applyBands(world, seed, opts)
      const out = { sceneMarks: [] }
      const { marks } = generateLayout(tpl, seed)
      if (opts.scenes) applyScenes(world, marks, scenes, seed, out)
      let air1 = 0
      for (let i = 0; i < world.length; i++) if (world[i] === AIR) air1++
      return { air0: air0 / world.length, air1: air1 / world.length }
    },
  }
}
main().catch((e) => { document.getElementById('stat').textContent = '加载失败: ' + e.message; console.error(e) })
