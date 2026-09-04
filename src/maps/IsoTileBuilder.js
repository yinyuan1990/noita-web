import * as PIXI from 'pixi.js'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config.js'

/**
 * 2.5D 等距瓦片战场（45° 菱形 / 2:1 diamond）
 *
 * 格点 (i,j) → 屏幕：
 *   x = ox + (i - j) * (TW/2)
 *   y = oy + (i + j) * (TH/2)
 */

export const ISO = {
  TW: 128,
  TH: 64,
}

let _sheet = null

function buildIsoTileset(renderer) {
  if (_sheet) return _sheet
  const TW = ISO.TW
  const TH = ISO.TH
  const cols = 4
  const rows = 2
  const root = new PIXI.Container()

  const defs = [
    { id: 1, name: 'floor_a', draw: (g) => drawDiamondFloor(g, TW, TH, 0x3a342e, 0x4a4238) },
    { id: 2, name: 'floor_b', draw: (g) => drawDiamondFloor(g, TW, TH, 0x342e2a, 0x443c34) },
    { id: 3, name: 'floor_c', draw: (g) => drawDiamondFloor(g, TW, TH, 0x403830, 0x504840) },
    { id: 4, name: 'floor_lit', draw: (g) => drawDiamondFloor(g, TW, TH, 0x4a4038, 0x6a5a48, true) },
    { id: 5, name: 'edge', draw: (g) => drawDiamondEdge(g, TW, TH) },
    { id: 6, name: 'rock', draw: (g) => drawDiamondRock(g, TW, TH) },
    { id: 7, name: 'crystal', draw: (g) => drawDiamondCrystal(g, TW, TH) },
    { id: 8, name: 'moss', draw: (g) => drawDiamondFloor(g, TW, TH, 0x2e3a2e, 0x3a4a34) },
  ]

  for (const d of defs) {
    const g = new PIXI.Graphics()
    d.draw(g)
    g.x = ((d.id - 1) % cols) * TW
    g.y = Math.floor((d.id - 1) / cols) * TH
    root.addChild(g)
  }

  const rt = PIXI.RenderTexture.create({ width: cols * TW, height: rows * TH })
  renderer.render(root, rt, true)
  root.destroy({ children: true })

  const textures = {}
  for (const d of defs) {
    const ix = (d.id - 1) % cols
    const iy = Math.floor((d.id - 1) / cols)
    textures[d.id] = new PIXI.Texture(rt.baseTexture, new PIXI.Rectangle(ix * TW, iy * TH, TW, TH))
  }
  _sheet = { textures, rt, TW, TH }
  return _sheet
}

function diamondPath(g, tw, th) {
  const cx = tw / 2
  const cy = th / 2
  g.moveTo(cx, 0)
  g.lineTo(tw, cy)
  g.lineTo(cx, th)
  g.lineTo(0, cy)
  g.closePath()
}

function drawDiamondFloor(g, tw, th, fill, edge, lit = false) {
  g.beginFill(fill, 1)
  diamondPath(g, tw, th)
  g.endFill()
  // 顶边亮、底边暗 → 体积感
  g.lineStyle(1.5, lit ? 0xc4a878 : edge, lit ? 0.55 : 0.35)
  g.moveTo(tw / 2, 0)
  g.lineTo(tw, th / 2)
  g.lineStyle(1.5, 0x1a1410, 0.45)
  g.moveTo(tw, th / 2)
  g.lineTo(tw / 2, th)
  g.lineTo(0, th / 2)
  if (lit) {
    g.beginFill(0xd4b888, 0.12)
    g.moveTo(tw / 2, th * 0.2)
    g.lineTo(tw * 0.7, th / 2)
    g.lineTo(tw / 2, th * 0.8)
    g.lineTo(tw * 0.3, th / 2)
    g.closePath()
    g.endFill()
  }
}

function drawDiamondEdge(g, tw, th) {
  g.beginFill(0x1e1814, 1)
  diamondPath(g, tw, th)
  g.endFill()
  g.lineStyle(2, 0x5a4a38, 0.5)
  diamondPath(g, tw, th)
}

function drawDiamondRock(g, tw, th) {
  drawDiamondFloor(g, tw, th, 0x2a2622, 0x3a342e)
  g.beginFill(0x4a4238, 0.85)
  g.drawEllipse(tw / 2, th * 0.35, tw * 0.18, th * 0.22)
  g.endFill()
  g.beginFill(0x1a1410, 0.5)
  g.drawEllipse(tw / 2, th * 0.55, tw * 0.2, th * 0.12)
  g.endFill()
}

function drawDiamondCrystal(g, tw, th) {
  drawDiamondFloor(g, tw, th, 0x2a2838, 0x3a3850)
  g.beginFill(0x6a80c0, 0.55)
  g.moveTo(tw / 2, th * 0.15)
  g.lineTo(tw * 0.62, th * 0.45)
  g.lineTo(tw / 2, th * 0.7)
  g.lineTo(tw * 0.38, th * 0.45)
  g.closePath()
  g.endFill()
}

export function isoToScreen(i, j, ox, oy, tw = ISO.TW, th = ISO.TH) {
  return {
    x: ox + (i - j) * (tw / 2),
    y: oy + (i + j) * (th / 2),
  }
}

export function screenToIso(x, y, ox, oy, tw = ISO.TW, th = ISO.TH) {
  const dx = x - ox
  const dy = y - oy
  const i = dy / th + dx / tw
  const j = dy / th - dx / tw
  return { i, j }
}

/**
 * 绘制等距菱形地面战场
 * @returns {{ stageWidth, groundY, ox, oy, gridW, gridH, TW, TH }}
 */
export function paintIsoArena(renderer, layers, opts = {}) {
  const sheet = buildIsoTileset(renderer)
  const { TW, TH, textures } = sheet
  const seed = opts.seed != null ? opts.seed : 5
  const gridW = opts.gridW != null ? opts.gridW : 12
  const gridH = opts.gridH != null ? opts.gridH : 12

  // 原点：让菱形战场落在画面中下部
  const ox = DESIGN_WIDTH * 0.5
  const oy = DESIGN_HEIGHT * 0.28

  // —— 远景：洞窟立壁（非等距，当背景）——
  const far = new PIXI.Graphics()
  far.beginFill(0x0a0e16)
  far.drawRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)
  far.endFill()
  for (let i = 0; i < 10; i++) {
    far.beginFill(0x141c28, 0.1 + i * 0.03)
    far.drawEllipse(DESIGN_WIDTH * 0.5, DESIGN_HEIGHT * 0.16, DESIGN_WIDTH * (0.75 - i * 0.04), 90 - i * 6)
    far.endFill()
  }
  for (let i = 0; i < 8; i++) {
    const x = 40 + i * 240 + (hash(i, seed) % 30)
    far.beginFill(0x10161e, 0.65)
    far.drawRect(x, 40, 28 + (hash(i, seed + 1) % 18), 160 + (hash(i, seed + 2) % 80))
    far.endFill()
  }
  layers.far.addChild(far)

  // —— 中景：按 i+j 从远到近铺菱形瓦 ——
  const floor = new PIXI.Container()
  const cells = []
  for (let j = 0; j < gridH; j++) {
    for (let i = 0; i < gridW; i++) {
      cells.push({ i, j, z: i + j })
    }
  }
  cells.sort((a, b) => a.z - b.z)

  const midI = (gridW - 1) / 2
  const midJ = (gridH - 1) / 2
  const floorTiles = []

  for (const c of cells) {
    const { i, j } = c
    const pos = isoToScreen(i - midI, j - midJ, ox, oy, TW, TH)
    // 椭圆战场：边缘用 edge/rock
    const di = (i - midI) / (gridW * 0.55)
    const dj = (j - midJ) / (gridH * 0.55)
    const r2 = di * di + dj * dj
    if (r2 > 1.05) continue

    let tid = 1 + (hash(i * 31 + j, seed) % 3)
    if (r2 > 0.82) tid = 5
    else if (hash(i + j * 7, seed + 3) % 17 === 0) tid = 6
    else if (hash(i * 3 + j, seed + 5) % 23 === 0) tid = 7
    else if (hash(i + j, seed + 8) % 11 === 0) tid = 8
    // 敌方区（远，z 小）与我方区（近，z 大）略提亮站位
    const zN = c.z / (gridW + gridH)
    if (zN < 0.35 && r2 < 0.5 && hash(i, seed + 11) % 3 === 0) tid = 4
    if (zN > 0.65 && r2 < 0.45 && hash(j, seed + 12) % 3 === 0) tid = 4

    const spr = new PIXI.Sprite(textures[tid])
    spr.anchor.set(0.5, 0.5)
    spr.x = pos.x
    spr.y = pos.y
    floor.addChild(spr)
    // 逻辑坐标（相对战场中心）——供视角旋转 demo 每帧重算屏幕位置
    floorTiles.push({ spr, li: i - midI, lj: j - midJ })
  }
  layers.mid.addChild(floor)

  if (!opts.noRings) {
    // 站位提示环（等距椭圆）
    const rings = new PIXI.Graphics()
    rings.lineStyle(2, 0x8a6048, 0.2)
    rings.drawEllipse(ox, oy + TH * 2.2, TW * 2.2, TH * 1.4)
    rings.lineStyle(2, 0x48608a, 0.22)
    rings.drawEllipse(ox, oy + TH * 5.5, TW * 2.6, TH * 1.6)
    layers.mid.addChild(rings)
  }

  // —— 近景暗角 ——
  const near = new PIXI.Graphics()
  near.beginFill(0x050608, 0.5)
  near.drawRect(0, 0, DESIGN_WIDTH * 0.05, DESIGN_HEIGHT)
  near.drawRect(DESIGN_WIDTH * 0.95, 0, DESIGN_WIDTH * 0.05, DESIGN_HEIGHT)
  near.endFill()
  near.beginFill(0x050608, 0.4)
  near.drawRect(0, DESIGN_HEIGHT * 0.9, DESIGN_WIDTH, DESIGN_HEIGHT * 0.1)
  near.endFill()
  layers.near.addChild(near)

  return {
    stageWidth: DESIGN_WIDTH,
    groundY: oy + TH * 5.5,
    ox,
    oy,
    gridW,
    gridH,
    TW,
    TH,
    floorTiles,
    mode: 'iso25',
  }
}

function hash(x, seed) {
  let n = (x * 374761393 + seed * 668265263) | 0
  n = (n ^ (n >>> 13)) | 0
  return Math.abs(n)
}
