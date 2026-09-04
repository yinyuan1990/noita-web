import * as PIXI from 'pixi.js'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config.js'

/**
 * 程序建造洞窟瓦片地图 —— 强调层次
 *
 * 远：穹顶渐变 + 远壁剪影 + 淡钟乳
 * 中后：岩壁拱门 / 火把光斑
 * 中：地面、石柱、石笋、水晶、女神剪影
 * 近：大块前景遮挡（压暗框住舞台）
 */
export const TILE = 64

const IDS = {
  EMPTY: 0,
  ROCK: 1,
  GROUND: 2,
  WALL_A: 3,
  WALL_B: 4,
  STALAC: 5,
  STALAG: 6,
  PILLAR: 7,
  CRYSTAL: 8,
  MOSS: 9,
  TORCH: 10,
  NEAR_L: 11,
  NEAR_R: 12,
  NEAR_LOW: 13,
  RUNESTONE: 14,
}

let _sheet = null
const SHEET_VER = 2

/** 烘焙瓦片表 */
export function buildCaveTileset(renderer) {
  if (_sheet && _sheet.ver === SHEET_VER) return _sheet
  const ts = TILE
  const cols = 5
  const rows = 3
  const base = new PIXI.Container()

  const defs = [
    { id: IDS.ROCK, draw: drawRock },
    { id: IDS.GROUND, draw: drawGround },
    { id: IDS.WALL_A, draw: (g, t) => drawWall(g, t, 0) },
    { id: IDS.WALL_B, draw: (g, t) => drawWall(g, t, 1) },
    { id: IDS.STALAC, draw: drawStalac },
    { id: IDS.STALAG, draw: drawStalag },
    { id: IDS.PILLAR, draw: drawPillar },
    { id: IDS.CRYSTAL, draw: drawCrystal },
    { id: IDS.MOSS, draw: drawMoss },
    { id: IDS.TORCH, draw: drawTorch },
    { id: IDS.NEAR_L, draw: (g, t) => drawNear(g, t, 'L') },
    { id: IDS.NEAR_R, draw: (g, t) => drawNear(g, t, 'R') },
    { id: IDS.NEAR_LOW, draw: (g, t) => drawNear(g, t, 'LOW') },
    { id: IDS.RUNESTONE, draw: drawRunestone },
  ]

  for (const d of defs) {
    const g = new PIXI.Graphics()
    d.draw(g, ts)
    g.x = ((d.id - 1) % cols) * ts
    g.y = Math.floor((d.id - 1) / cols) * ts
    base.addChild(g)
  }

  const rt = PIXI.RenderTexture.create({ width: cols * ts, height: rows * ts })
  renderer.render(base, rt, true)
  base.destroy({ children: true })

  const textures = {}
  for (const d of defs) {
    const ix = (d.id - 1) % cols
    const iy = Math.floor((d.id - 1) / cols)
    textures[d.id] = new PIXI.Texture(rt.baseTexture, new PIXI.Rectangle(ix * ts, iy * ts, ts, ts))
  }
  _sheet = { textures, renderTexture: rt, tileSize: ts, ver: SHEET_VER }
  return _sheet
}

/**
 * @returns {{ stageWidth, groundY, cols, rows, tileSize }}
 */
export function paintCaveTileMap(renderer, layers, opts = {}) {
  const sheet = buildCaveTileset(renderer)
  const ts = sheet.tileSize
  const screens = opts.screens != null ? opts.screens : 3
  const cols = Math.ceil((DESIGN_WIDTH * screens) / ts)
  const rows = Math.ceil(DESIGN_HEIGHT / ts)
  const groundRow = opts.groundRow != null ? opts.groundRow : rows - 4
  const seed = opts.seed != null ? opts.seed : 7
  const stageW = cols * ts

  // —— 0. 远景氛围（非瓦片：渐变穹顶 + 远山剪影）——
  paintAtmosphere(layers.far, stageW, groundRow * ts, seed)

  // —— 1. 远景瓦片（冷色、更淡）——
  const far = genFar(cols, rows, groundRow, seed)
  blit(layers.far, far, sheet, { alpha: 0.5, tint: 0x6a7a9a, yScale: 1 })

  // —— 2. 中后：岩壁拱廊光带 ——
  paintMidBack(layers.mid, stageW, groundRow * ts, seed)

  // —— 3. 中景主舞台 ——
  const mid = genMid(cols, rows, groundRow, seed)
  blit(layers.mid, mid, sheet, { alpha: 1 })

  // —— 4. 中景大件（女神剪影、成组石柱）——
  paintMidProps(layers.mid, stageW, groundRow * ts, seed)

  // —— 5. 近景遮挡 ——
  const near = genNear(cols, rows, groundRow, seed)
  blit(layers.near, near, sheet, { alpha: 0.95, tint: 0x1a1520 })
  paintNearFrames(layers.near, stageW, groundRow * ts)

  // —— 6. 层次雾（夹在视觉中间）——
  paintDepthFog(layers.far, stageW, groundRow * ts, 0.12)
  paintDepthFog(layers.mid, stageW, groundRow * ts - 40, 0.08)

  return {
    stageWidth: stageW,
    groundY: groundRow * ts,
    cols,
    rows,
    tileSize: ts,
  }
}

function blit(container, grid, sheet, opts = {}) {
  const ts = sheet.tileSize
  const alpha = opts.alpha != null ? opts.alpha : 1
  const tint = opts.tint
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const id = grid[y][x]
      if (!id || !sheet.textures[id]) continue
      const spr = new PIXI.Sprite(sheet.textures[id])
      spr.x = x * ts
      spr.y = y * ts
      spr.alpha = alpha
      if (tint != null) spr.tint = tint
      container.addChild(spr)
    }
  }
}

/* ========== 氛围 / 大件（层次关键） ========== */

function paintAtmosphere(layer, stageW, groundY, seed) {
  const g = new PIXI.Graphics()
  // 穹顶：上深下略亮
  g.beginFill(0x07060c)
  g.drawRect(0, 0, stageW, groundY * 0.55)
  g.endFill()
  g.beginFill(0x12101c)
  g.drawRect(0, groundY * 0.45, stageW, groundY * 0.35)
  g.endFill()
  g.beginFill(0x1a1528, 0.7)
  g.drawRect(0, groundY * 0.7, stageW, groundY * 0.35)
  g.endFill()

  // 远处岩壁起伏剪影（更小、更淡 = 更远）
  g.beginFill(0x14101e, 0.85)
  for (let i = 0; i < Math.ceil(stageW / 280); i++) {
    const bx = i * 280 + (hash(i, seed) % 40)
    const h = 120 + (hash(i, seed + 2) % 160)
    g.drawEllipse(bx + 80, groundY - h * 0.3, 100 + (hash(i, seed + 4) % 60), h)
  }
  g.endFill()

  // 远景雾带
  g.beginFill(0x3a4868, 0.15)
  g.drawEllipse(stageW * 0.35, groundY * 0.62, stageW * 0.4, 50)
  g.drawEllipse(stageW * 0.75, groundY * 0.58, stageW * 0.3, 40)
  g.endFill()

  layer.addChild(g)
}

function paintMidBack(layer, stageW, groundY, seed) {
  const g = new PIXI.Graphics()
  // 中后岩壁：比远景更实、略暖
  g.beginFill(0x1c1628, 0.55)
  g.drawRect(0, 80, stageW, groundY - 120)
  g.endFill()

  // 拱廊节奏（制造纵深通道感）
  for (let i = 0; i < Math.ceil(stageW / 420); i++) {
    const ax = 120 + i * 420 + (hash(i, seed + 8) % 60)
    g.beginFill(0x0a0810, 0.45)
    g.drawEllipse(ax, groundY * 0.55, 70, groundY * 0.38)
    g.endFill()
    // 拱边亮边
    g.lineStyle(3, 0x4a3860, 0.25)
    g.drawEllipse(ax, groundY * 0.55, 72, groundY * 0.39)
    g.lineStyle(0)
    // 火把光斑
    g.beginFill(0xc07040, 0.12)
    g.drawCircle(ax - 55, groundY * 0.42, 36)
    g.drawCircle(ax + 55, groundY * 0.42, 36)
    g.endFill()
  }
  layer.addChild(g)
}

function paintMidProps(layer, stageW, groundY, seed) {
  const g = new PIXI.Graphics()

  // 菲穆莉卡女神巨像剪影（右侧纵深）
  const gx = Math.min(stageW * 0.72, stageW - 200)
  g.beginFill(0x100818, 0.7)
  g.drawEllipse(gx, groundY * 0.38, 55, 130)
  g.drawRect(gx - 18, groundY * 0.38, 36, groundY * 0.52)
  // 肩
  g.drawEllipse(gx - 50, groundY * 0.48, 40, 24)
  g.drawEllipse(gx + 50, groundY * 0.48, 40, 24)
  g.endFill()
  // 神像微光
  g.beginFill(0x6a4080, 0.15)
  g.drawCircle(gx, groundY * 0.32, 70)
  g.endFill()

  // 成组石柱（中景体积）
  for (let i = 0; i < Math.ceil(stageW / 500); i++) {
    const px = 200 + i * 500 + (hash(i, seed + 15) % 80)
    if (Math.abs(px - gx) < 160) continue
    const ph = 160 + (hash(i, seed + 16) % 120)
    g.beginFill(0x1a1428, 0.85)
    g.drawRoundedRect(px - 22, groundY - ph, 44, ph, 6)
    g.endFill()
    g.beginFill(0x3a3050, 0.35)
    g.drawRect(px - 10, groundY - ph + 10, 10, ph - 20)
    g.endFill()
    // 柱顶
    g.beginFill(0x221a32)
    g.drawRoundedRect(px - 30, groundY - ph - 12, 60, 18, 4)
    g.endFill()
  }

  // 地面亮带（格斗台可读性）
  g.beginFill(0x5a4080, 0.22)
  g.drawRect(0, groundY - 6, stageW, 14)
  g.endFill()
  g.beginFill(0x2a2038, 0.5)
  g.drawRect(0, groundY + 8, stageW, 28)
  g.endFill()

  layer.addChild(g)
}

function paintNearFrames(layer, stageW, groundY) {
  const g = new PIXI.Graphics()
  // 左右大前景（框住画面，近 = 大、暗、糊）
  g.beginFill(0x05040a, 0.92)
  g.drawPolygon([0, 0, 160, 0, 90, DESIGN_HEIGHT, 0, DESIGN_HEIGHT])
  g.drawPolygon([stageW, 0, stageW - 160, 0, stageW - 90, DESIGN_HEIGHT, stageW, DESIGN_HEIGHT])
  g.endFill()
  // 底边近景乱石
  g.beginFill(0x08060e, 0.88)
  for (let x = 0; x < stageW; x += 140) {
    g.drawPolygon([
      x,
      DESIGN_HEIGHT,
      x + 40,
      DESIGN_HEIGHT - 70 - (x % 50),
      x + 100,
      DESIGN_HEIGHT - 40,
      x + 140,
      DESIGN_HEIGHT,
    ])
  }
  g.endFill()
  // 顶边垂吊
  g.beginFill(0x0a0810, 0.75)
  for (let x = 80; x < stageW; x += 220) {
    g.drawPolygon([x, 0, x + 50, 0, x + 30, 90 + (x % 40), x + 18, 90 + (x % 40)])
  }
  g.endFill()
  void groundY
  layer.addChild(g)
}

function paintDepthFog(layer, stageW, y, alpha) {
  const g = new PIXI.Graphics()
  g.beginFill(0x2a3850, alpha)
  g.drawEllipse(stageW * 0.5, y, stageW * 0.55, 55)
  g.endFill()
  layer.addChild(g)
}

/* ========== 网格生成 ========== */

function genFar(cols, rows, groundRow, seed) {
  const g = empty(cols, rows)
  for (let y = 1; y < groundRow - 3; y++) {
    for (let x = 0; x < cols; x++) {
      g[y][x] = hash(x + y * 3, seed) % 2 === 0 ? IDS.WALL_A : IDS.WALL_B
    }
  }
  for (let x = 0; x < cols; x++) {
    if (hash(x, seed) % 4 === 0) g[2][x] = IDS.STALAC
    if (hash(x, seed + 3) % 9 === 0) g[groundRow - 4][x] = IDS.CRYSTAL
  }
  return g
}

function genMid(cols, rows, groundRow, seed) {
  const g = empty(cols, rows)
  // 顶壁厚实
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < cols; x++) g[y][x] = IDS.ROCK
  }
  for (let x = 0; x < cols; x++) {
    const h = hash(x, seed + 1)
    if (h % 2 === 0) g[2][x] = IDS.STALAC
    if (h % 5 === 0) g[3][x] = IDS.STALAC
    if (h % 6 === 0) g[2][x] = IDS.MOSS
  }
  // 地面 + 地下岩
  for (let x = 0; x < cols; x++) {
    g[groundRow][x] = IDS.GROUND
    for (let y = groundRow + 1; y < rows; y++) g[y][x] = IDS.ROCK
  }
  // 石笋 / 柱 / 符文石 / 火把
  for (let x = 3; x < cols - 3; x++) {
    const h = hash(x, seed + 9)
    if (h % 7 === 0) {
      g[groundRow - 1][x] = IDS.STALAG
      if (h % 3 === 0) g[groundRow - 2][x] = IDS.PILLAR
      if (h % 5 === 0 && groundRow - 3 > 4) g[groundRow - 3][x] = IDS.PILLAR
    }
    if (h % 13 === 0) g[groundRow - 1][x] = IDS.RUNESTONE
    if (h % 11 === 0) g[groundRow - 1][x] = IDS.CRYSTAL
    if (h % 10 === 0) g[groundRow - 2][x] = IDS.TORCH
    if (h % 8 === 0) g[groundRow - 1][x] = IDS.MOSS
  }
  return g
}

function genNear(cols, rows, groundRow, seed) {
  const g = empty(cols, rows)
  for (let x = 0; x < cols; x++) {
    const h = hash(x, seed + 21)
    if (h % 5 === 0) g[rows - 1][x] = IDS.NEAR_LOW
    if (h % 6 === 0 && x + 1 < cols) g[rows - 1][x + 1] = IDS.NEAR_LOW
    if (h % 9 === 0) g[groundRow + 1][x] = x % 2 === 0 ? IDS.NEAR_L : IDS.NEAR_R
  }
  // 左右近景柱密一点
  for (let y = groundRow - 2; y < rows; y++) {
    g[y][0] = IDS.NEAR_L
    g[y][1] = IDS.NEAR_L
    g[y][cols - 1] = IDS.NEAR_R
    g[y][cols - 2] = IDS.NEAR_R
  }
  return g
}

function empty(cols, rows) {
  return Array.from({ length: rows }, () => Array(cols).fill(IDS.EMPTY))
}

function hash(x, seed) {
  let n = (x * 374761393 + seed * 668265263) | 0
  n = (n ^ (n >>> 13)) * 1274126177
  return (n ^ (n >>> 16)) >>> 0
}

/* ========== 单格绘制 ========== */

function drawRock(g, ts) {
  g.beginFill(0x16121f)
  g.drawRect(0, 0, ts, ts)
  g.endFill()
  g.beginFill(0x2a2438)
  g.drawPolygon([2, 10, 22, 2, 50, 6, 62, 18, 58, 58, 10, 62, 2, 40])
  g.endFill()
  g.beginFill(0x3e3658, 0.45)
  g.drawCircle(18, 22, 7)
  g.drawCircle(44, 40, 5)
  g.endFill()
}

function drawGround(g, ts) {
  g.beginFill(0x0e0c14)
  g.drawRect(0, 0, ts, ts)
  g.endFill()
  g.beginFill(0x5a3c78)
  g.drawRect(0, 0, ts, 8)
  g.endFill()
  g.beginFill(0x3a2860, 0.7)
  g.drawRect(0, 8, ts, 6)
  g.endFill()
  g.beginFill(0x221a30)
  g.drawRect(0, 14, ts, ts - 14)
  g.endFill()
  g.lineStyle(1, 0x8a70b0, 0.35)
  g.moveTo(0, 3)
  g.lineTo(ts, 3)
  g.lineStyle(0)
  // 碎石
  g.beginFill(0x4a3a60, 0.5)
  g.drawCircle(12, 28, 3)
  g.drawCircle(40, 36, 2)
  g.endFill()
}

function drawWall(g, ts, variant) {
  const base = variant ? 0x14101c : 0x100e18
  g.beginFill(base)
  g.drawRect(0, 0, ts, ts)
  g.endFill()
  g.beginFill(0x1e1830, 0.7)
  g.drawRect(0, 0, ts, ts)
  g.endFill()
  g.beginFill(0x2a2038, 0.2)
  g.drawEllipse(ts / 2 + (variant ? 6 : -4), ts / 2, 20, 16)
  g.endFill()
  if (variant) {
    g.lineStyle(1, 0x3a3050, 0.3)
    g.moveTo(8, 0)
    g.lineTo(8, ts)
    g.lineStyle(0)
  }
}

function drawStalac(g, ts) {
  g.beginFill(0x241e35)
  g.drawPolygon([12, 0, 52, 0, 40, 60, 28, 60])
  g.endFill()
  g.beginFill(0x4a4068, 0.45)
  g.drawPolygon([22, 0, 42, 0, 36, 44])
  g.endFill()
  g.beginFill(0x6a80c0, 0.25)
  g.drawCircle(34, 50, 3)
  g.endFill()
}

function drawStalag(g, ts) {
  g.beginFill(0x241e35)
  g.drawPolygon([18, ts, 48, ts, 44, 14, 30, 8])
  g.endFill()
  g.beginFill(0x4a4068, 0.4)
  g.drawPolygon([26, ts, 42, ts, 38, 24])
  g.endFill()
}

function drawPillar(g, ts) {
  g.beginFill(0x1a1428)
  g.drawRoundedRect(16, 0, 32, ts, 4)
  g.endFill()
  g.beginFill(0x3a3055, 0.45)
  g.drawRect(20, 4, 8, ts - 8)
  g.endFill()
  g.beginFill(0x2a2038)
  g.drawRect(14, 0, 36, 8)
  g.drawRect(14, ts - 8, 36, 8)
  g.endFill()
}

function drawCrystal(g, ts) {
  g.beginFill(0x3a68a0, 0.9)
  g.drawPolygon([32, 4, 52, 36, 32, 58, 12, 36])
  g.endFill()
  g.beginFill(0x90d0f0, 0.55)
  g.drawPolygon([32, 12, 44, 34, 32, 50])
  g.endFill()
  g.beginFill(0xe0f0ff, 0.35)
  g.drawCircle(30, 28, 3)
  g.endFill()
}

function drawMoss(g, ts) {
  g.beginFill(0x1a3020, 0.0)
  g.drawRect(0, 0, ts, ts)
  g.endFill()
  g.beginFill(0x2a5038, 0.7)
  g.drawEllipse(20, 40, 16, 10)
  g.drawEllipse(44, 48, 12, 8)
  g.endFill()
  g.beginFill(0x3a7050, 0.4)
  g.drawCircle(24, 36, 4)
  g.drawCircle(40, 44, 3)
  g.endFill()
}

function drawTorch(g, ts) {
  g.beginFill(0x2a1c14)
  g.drawRect(28, 28, 8, 36)
  g.endFill()
  g.beginFill(0xe08040, 0.85)
  g.drawCircle(32, 22, 10)
  g.endFill()
  g.beginFill(0xf0c060, 0.7)
  g.drawCircle(32, 18, 5)
  g.endFill()
  g.beginFill(0xffe0a0, 0.25)
  g.drawCircle(32, 20, 18)
  g.endFill()
}

function drawRunestone(g, ts) {
  g.beginFill(0x1a1828)
  g.drawRoundedRect(14, 8, 36, 56, 4)
  g.endFill()
  g.beginFill(0x50a0e0, 0.7)
  g.drawRect(28, 18, 6, 28)
  g.drawRect(22, 28, 20, 5)
  g.endFill()
  g.beginFill(0x80d0ff, 0.2)
  g.drawCircle(32, 32, 16)
  g.endFill()
}

function drawNear(g, ts, side) {
  g.beginFill(0x05040a, 0.92)
  if (side === 'L') {
    g.drawPolygon([0, 0, 50, 8, 40, ts, 0, ts])
  } else if (side === 'R') {
    g.drawPolygon([ts, 0, 14, 8, 24, ts, ts, ts])
  } else {
    g.drawPolygon([0, ts, 16, 28, 40, 36, 64, 24, 64, ts])
  }
  g.endFill()
  g.beginFill(0x15101c, 0.5)
  if (side === 'LOW') g.drawPolygon([8, ts, 28, 40, 48, ts])
  g.endFill()
}
