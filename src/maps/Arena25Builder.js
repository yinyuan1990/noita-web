import * as PIXI from 'pixi.js'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config.js'

/**
 * 回合制 2.5D 战场瓦片（单屏、不横滚）
 * 远墙 → 透视地面格子 → 近景暗角
 */
export function paintArena25(renderer, layers, opts = {}) {
  const seed = opts.seed != null ? opts.seed : 3
  const w = DESIGN_WIDTH
  const h = DESIGN_HEIGHT

  layers.far.removeChildren?.()
  // far/mid/near 已是空容器时由调用方 clear

  // 远景：穹顶 + 石壁
  const farG = new PIXI.Graphics()
  farG.beginFill(0x0c1018)
  farG.drawRect(0, 0, w, h)
  farG.endFill()
  // 穹顶渐变带
  for (let i = 0; i < 8; i++) {
    farG.beginFill(0x1a2438, 0.08 + i * 0.02)
    farG.drawEllipse(w * 0.5, h * 0.18, w * (0.7 - i * 0.05), h * (0.22 - i * 0.015))
    farG.endFill()
  }
  // 远壁剪影柱
  for (let i = 0; i < 7; i++) {
    const x = 80 + i * 280 + (hash(i, seed) % 40)
    const ph = 180 + (hash(i, seed + 1) % 120)
    farG.beginFill(0x121820, 0.55)
    farG.drawRect(x, h * 0.22 - ph * 0.3, 36 + (hash(i, seed + 2) % 20), ph)
    farG.endFill()
  }
  layers.far.addChild(farG)

  // 中景：透视地面（梯形网格）
  const midG = new PIXI.Graphics()
  const horizon = h * 0.38
  const nearY = h * 0.92
  // 地面填充
  midG.beginFill(0x2a2430)
  midG.moveTo(0, horizon)
  midG.lineTo(w, horizon)
  midG.lineTo(w, nearY + 40)
  midG.lineTo(0, nearY + 40)
  midG.closePath()
  midG.endFill()

  // 透视纵线
  const cols = 9
  for (let i = 0; i <= cols; i++) {
    const t = i / cols
    const topX = w * 0.18 + t * w * 0.64
    const botX = w * -0.05 + t * w * 1.1
    midG.lineStyle(1, 0x6a5a48, 0.22)
    midG.moveTo(topX, horizon)
    midG.lineTo(botX, nearY)
  }
  // 透视横线（疏远密近）
  const rows = 8
  for (let i = 0; i <= rows; i++) {
    const u = i / rows
    // ease：远处挤在一起
    const e = u * u
    const y = horizon + (nearY - horizon) * e
    const inset = (1 - e) * w * 0.16
    midG.lineStyle(1, 0x7a6a52, 0.18 + e * 0.12)
    midG.moveTo(inset, y)
    midG.lineTo(w - inset, y)
  }

  // 站位光斑（敌方远 / 我方近）
  paintSlotGlow(midG, w * 0.5, h * 0.5, w * 0.42, 36, 0x6a3038, 0.12)
  paintSlotGlow(midG, w * 0.5, h * 0.8, w * 0.5, 48, 0x3a4a6a, 0.14)

  // 石笋点缀两侧
  for (let i = 0; i < 5; i++) {
    const side = i % 2 === 0 ? 0.08 : 0.92
    const y = h * (0.45 + (hash(i, seed + 9) % 40) / 100)
    const hh = 40 + (hash(i, seed + 3) % 50)
    midG.beginFill(0x3a323c, 0.7)
    midG.drawEllipse(w * side, y, 18, hh)
    midG.endFill()
  }
  layers.mid.addChild(midG)

  // 近景暗角
  const nearG = new PIXI.Graphics()
  nearG.beginFill(0x050608, 0.55)
  nearG.drawRect(0, 0, w * 0.06, h)
  nearG.drawRect(w * 0.94, 0, w * 0.06, h)
  nearG.endFill()
  nearG.beginFill(0x050608, 0.35)
  nearG.drawRect(0, h * 0.88, w, h * 0.12)
  nearG.endFill()
  layers.near.addChild(nearG)

  // 轻雾
  const fog = new PIXI.Graphics()
  fog.beginFill(0x1a2030, 0.15)
  fog.drawRect(0, horizon - 20, w, 80)
  fog.endFill()
  layers.far.addChild(fog)

  void renderer

  return {
    stageWidth: w,
    groundY: h * 0.82,
    horizonY: horizon,
    nearY,
    mode: 'arena25',
  }
}

function paintSlotGlow(g, cx, cy, rw, rh, color, alpha) {
  g.beginFill(color, alpha)
  g.drawEllipse(cx, cy, rw, rh)
  g.endFill()
}

function hash(x, seed) {
  let n = (x * 374761393 + seed * 668265263) | 0
  n = (n ^ (n >>> 13)) | 0
  return Math.abs(n)
}
