/**
 * 像素巫师 · 地图瓦片生成器(长期工具,勿删)
 *
 * 生成三份资产到 public/res/pixel-tiles/:
 * 1. tileset.png:10 块 48×40 横排(阶段B网格拼接的回退资产)
 * 2. tileset-hb-h.png:128 块 80×40 横砖(阶段C Herringbone Wang,64 边色组合 × 2 变体)
 * 3. tileset-hb-v.png:128 块 40×80 竖砖(同上)
 * 生成后可用 Aseprite / AI 图片工具直接重画,只要遵守调色板
 * (见 docs/pixel-guide.md 颜色→材质表)即可,代码零改动。
 *
 * 网格瓦片约定(违反会破坏地图连通性):
 * - 每块 48×40;第 16~27 行必须可通行(黑=空气 或 液体色),保证行内连通
 * - 竖井瓦片(第 4 块)第 16~31 列必须垂直贯通
 * - 洋红 #ff00ff = 火把标记(该格挖空并放长明火)
 *
 * Herringbone 砖约定(边色由运行时从像素自动推导,无需清单):
 * - 每条边中段采样 10px(横边 x 15~24 / 竖边 y 15~24,均相对边段起点),
 *   ≥5px 可通行(黑/液体色)即视为"开口边",否则"闭合边"
 * - 开口边必须保留 8×6 的保底通道核(见 coreRect),且与砖中心连通
 * - 含熔岩像素的砖会被运行时自动限制到深层(row≥3)
 * - 枚举全部 64 种开闭组合是"约束匹配永远有解"的前提,重画时保持逐块对应
 *
 * 用法:node scripts/gen-pixel-tiles.mjs(与 dev server 无关,Playwright 离屏画)
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, '..', 'public', 'res', 'pixel-tiles')
fs.mkdirSync(OUT_DIR, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const dataUrl = await page.evaluate(() => {
  const TW = 48, TH = 40, N = 10
  const cv = document.createElement('canvas')
  cv.width = TW * N
  cv.height = TH
  const g = cv.getContext('2d')
  // 调色板(与 pixelDemo.js 的 PNG_MAT 严格一致)
  const KEEP = '#ffffff', AIR = '#000000', WATER = '#3a6fd8', OIL = '#6b5a20', LAVA = '#ff5a10',
    SAND = '#c9a86a', POWDER = '#34343a', GOLD = '#ffd054', WOOD = '#7a5230',
    MOSS = '#588c30', TORCH = '#ff00ff'
  const R = (a, b) => a + Math.random() * (b - a)
  let ox = 0 // 当前瓦片原点
  const px = (x, y, c) => { g.fillStyle = c; g.fillRect(ox + x | 0, y | 0, 1, 1) }
  const rect = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(ox + x, y, w, h) }
  /** 有机边缘的横带:每列上下边缘 ±jit 抖动 */
  const band = (y0, y1, c, jit = 2) => {
    let t = 0, b = 0
    for (let x = 0; x < TW; x++) {
      if (Math.random() < 0.4) t = Math.max(-jit, Math.min(jit, t + (Math.random() < 0.5 ? -1 : 1)))
      if (Math.random() < 0.4) b = Math.max(-jit, Math.min(jit, b + (Math.random() < 0.5 ? -1 : 1)))
      for (let y = y0 + t; y <= y1 + b; y++) px(x, y, c)
    }
  }
  /** 有机团块(椭圆+边缘噪声) */
  const blob = (cx, cy, rx, ry, c) => {
    for (let y = cy - ry - 2; y <= cy + ry + 2; y++) {
      for (let x = cx - rx - 2; x <= cx + rx + 2; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
        if (d < 1 || (d < 1.35 && Math.random() < 0.4)) px(x, y, c)
      }
    }
  }
  /** 矿脉随机游走 */
  const vein = (x, y, len, c, thick = 1) => {
    let a = Math.random() * Math.PI
    for (let k = 0; k < len; k++) {
      for (let t = 0; t < thick; t++) px(x + R(-1, 1), y + t, c)
      a += R(-0.5, 0.5)
      x += Math.cos(a) * 1.6
      y += Math.sin(a) * 0.9
      if (x < 2 || x > TW - 2 || y < 2 || y > TH - 2) break
    }
  }
  const base = () => rect(0, 0, TW, TH, KEEP)
  const corridorBand = () => band(16, 27, AIR, 2)

  // 1 走廊:通道 + 顶壁矿斑 + 偶发火把
  base(); corridorBand()
  vein(R(4, 14), R(4, 10), 10, POWDER, 2); vein(R(28, 40), R(30, 36), 10, POWDER, 2)
  if (Math.random() < 0.8) px(R(8, 40), 15, TORCH)
  ox += 48

  // 2 岩窟:大空腔
  base(); corridorBand(); blob(24, 20, 19, 14, AIR)
  vein(R(4, 10), R(3, 8), 8, GOLD, 1)
  ox += 48

  // 3 湖室:上通道 + 下水池
  base(); band(10, 18, AIR, 2)
  blob(24, 26, 20, 11, AIR); blob(24, 30, 18, 8, WATER)
  ox += 48

  // 4 竖井:十字贯通
  base(); corridorBand()
  for (let y = 0; y < TH; y++) { let j = (Math.random() * 3) | 0; for (let x = 16 - j; x < 32 + j; x++) px(x, y, AIR) }
  ox += 48

  // 5 柱厅:大厅 + 两根石柱 + 柱顶火把
  base(); band(6, 34, AIR, 2)
  rect(11, 8, 5, 26, KEEP); rect(31, 8, 5, 26, KEEP)
  px(13, 7, TORCH); px(33, 7, TORCH)
  ox += 48

  // 6 矿脉房:火药+金矿密布
  base(); corridorBand()
  for (let k = 0; k < 5; k++) vein(R(4, 44), Math.random() < 0.5 ? R(3, 12) : R(30, 37), 12, POWDER, 2)
  for (let k = 0; k < 3; k++) vein(R(6, 42), Math.random() < 0.5 ? R(4, 11) : R(31, 36), 7, GOLD, 1)
  ox += 48

  // 7 平台厅:大厅 + 木平台 + 苔 + 火把
  base(); band(4, 36, AIR, 2)
  rect(4, 12, 14, 2, WOOD); rect(28, 12, 16, 2, WOOD); rect(14, 24, 20, 2, WOOD)
  for (let x = 4; x < 18; x++) if (Math.random() < 0.6) px(x, 11, MOSS)
  for (let x = 28; x < 44; x++) if (Math.random() < 0.6) px(x, 11, MOSS)
  px(20, 22, TORCH)
  ox += 48

  // 8 沙窟:空腔 + 沙堆
  base(); corridorBand(); blob(24, 12, 16, 9, AIR); blob(24, 14, 13, 6, SAND)
  ox += 48

  // 9 遗迹:木梁大厅 + 金堆 + 双火把(手工设计感 setpiece)
  base(); band(6, 34, AIR, 3)
  rect(8, 6, 2, 28, WOOD); rect(38, 6, 2, 28, WOOD); rect(8, 6, 32, 2, WOOD)
  blob(24, 32, 6, 3, GOLD)
  px(12, 12, TORCH); px(36, 12, TORCH)
  for (let x = 10; x < 38; x++) if (Math.random() < 0.4) px(x, 5, MOSS)
  ox += 48

  // 10 熔岩窟(深层专用):窄道 + 底部岩浆腔 + 油囊
  base(); band(16, 24, AIR, 1)
  blob(24, 32, 18, 7, AIR); blob(24, 34, 16, 5, LAVA)
  blob(10, 8, 6, 4, OIL)
  vein(34, 6, 9, POWDER, 2)
  ox += 48

  return cv.toDataURL('image/png')
})
const buf = Buffer.from(dataUrl.split(',')[1], 'base64')
fs.writeFileSync(path.join(OUT_DIR, 'tileset.png'), buf)
console.log('written:', path.join(OUT_DIR, 'tileset.png'), buf.length, 'bytes')

// ── 阶段C:Herringbone Wang 砖条带(H 80×40 / V 40×80,64 边色组合 × 2 变体) ──
const hb = await page.evaluate(() => {
  const KEEP = '#ffffff', AIR = '#000000', WATER = '#3a6fd8', OIL = '#6b5a20', LAVA = '#ff5a10',
    SAND = '#c9a86a', POWDER = '#34343a', GOLD = '#ffd054', WOOD = '#7a5230', ICE = '#94cae8',
    MOSS = '#588c30', TORCH = '#ff00ff',
    // P2 标记像素(Noita wang_scripts:位置画进砖,运行时按概率决定出什么)
    MOB = '#ff0080', VESSEL = '#00ff80', LAMP = '#00ffff'
  const R = (a, b) => a + Math.random() * (b - a)
  const genStrip = (isV) => {
    const s = 40, TW = isV ? s : s * 2, TH = isV ? s * 2 : s
    const VAR = 2
    const cv = document.createElement('canvas')
    cv.width = TW * 64 * VAR
    cv.height = TH
    const g = cv.getContext('2d')
    let ox = 0
    const px = (x, y, c) => { g.fillStyle = c; g.fillRect(ox + (x | 0), y | 0, 1, 1) }
    const rect = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(ox + x, y, w, h) }
    const blob = (cx, cy, rx, ry, c) => {
      for (let y = Math.max(0, cy - ry - 2) | 0; y <= Math.min(TH - 1, cy + ry + 2); y++) {
        for (let x = Math.max(0, cx - rx - 2) | 0; x <= Math.min(TW - 1, cx + rx + 2); x++) {
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
          if (d < 1 || (d < 1.35 && Math.random() < 0.4)) px(x, y, c)
        }
      }
    }
    const vein = (x, y, len, c, thick = 1) => {
      let a = Math.random() * Math.PI
      for (let k = 0; k < len; k++) {
        for (let t = 0; t < thick; t++) px(x + R(-1, 1), y + t, c)
        a += R(-0.5, 0.5)
        x += Math.cos(a) * 1.6
        y += Math.sin(a) * 0.9
        if (x < 2 || x > TW - 2 || y < 2 || y > TH - 2) break
      }
    }
    // 挖通道:边中点 → 砖中心,摆动折线 + 圆刷(核心宽度 ≥9px,CA 平滑吃不掉)
    const carve = (x0, y0, x1, y1) => {
      const dx = x1 - x0, dy = y1 - y0
      const L = Math.max(1, Math.hypot(dx, dy))
      const nx = -dy / L, ny = dx / L
      let wob = 0
      for (let k = 0; k <= L; k++) {
        const t = k / L
        wob = Math.max(-3, Math.min(3, wob + R(-0.8, 0.8)))
        blob(x0 + dx * t + nx * wob, y0 + dy * t + ny * wob, R(4.5, 6), R(4.5, 6), AIR)
      }
    }
    // 六条边:[中点x, 中点y, 内法线dx, 内法线dy],顺序对应运行时 a~f 槽位
    const EDGES = isV
      ? [[20, 0, 0, 1], [0, 20, 1, 0], [39, 20, -1, 0], [0, 60, 1, 0], [39, 60, -1, 0], [20, 79, 0, -1]]
      : [[20, 0, 0, 1], [60, 0, 0, 1], [0, 20, 1, 0], [79, 20, -1, 0], [20, 39, 0, -1], [60, 39, 0, -1]]
    // 开口边保底通道核:8×6 矩形贴边,采样带(中段 10px)必然 ≥8px 可通行
    const coreRect = (mx, my, dx, dy) => {
      if (dy === 1) rect(mx - 4, 0, 8, 6, AIR)
      else if (dy === -1) rect(mx - 4, TH - 6, 8, 6, AIR)
      else if (dx === 1) rect(0, my - 4, 6, 8, AIR)
      else rect(TW - 6, my - 4, 6, 8, AIR)
    }
    const cx = TW / 2, cy = TH / 2
    const THEMES = [
      ['corridor', 2], ['cavern', 2.2], ['lake', 1.1], ['veins', 1.7], ['gold', 0.7],
      ['plat', 1.2], ['sand', 1], ['ice', 0.9], ['oil', 0.8], ['lava', 0.7], ['moss', 1],
    ]
    const pickTheme = (noLava) => {
      const pool = noLava ? THEMES.filter(([n]) => n !== 'lava') : THEMES
      let tot = 0
      for (const [, w] of pool) tot += w
      let r = Math.random() * tot
      for (const [n, w] of pool) { r -= w; if (r <= 0) return n }
      return 'cavern'
    }
    for (let combo = 0; combo < 64; combo++) {
      for (let v = 0; v < VAR; v++) {
        ox = (combo * VAR + v) * TW
        rect(0, 0, TW, TH, KEEP)
        // 变体 1 禁用熔岩主题:保证浅层(row<3)对全部 64 组合仍有可选砖
        const theme = pickTheme(v === 1)
        const open = []
        for (let k = 0; k < 6; k++) if ((combo >> k) & 1) open.push(EDGES[k])
        // ① 墙体矿饰(先画,通道随后从中挖过)
        if (theme === 'veins') {
          for (let k = 0; k < 4; k++) vein(R(4, TW - 4), R(4, TH - 4), 10, POWDER, 2)
          vein(R(4, TW - 4), R(4, TH - 4), 6, GOLD, 1)
        } else if (theme === 'ice') {
          for (let k = 0; k < 3; k++) blob(R(7, TW - 7), R(7, TH - 7), R(2, 4), R(2, 4), ICE)
        } else if (theme === 'gold') {
          blob(R(9, TW - 9), R(9, TH - 9), R(2.5, 4), R(2, 3), GOLD)
        } else if (theme === 'lava') {
          vein(R(4, TW - 4), R(4, TH - 4), 8, POWDER, 2)
        }
        // ② 空腔(走廊主题只留通道;贴边余量 ≥7px,不污染闭合边的采样带)
        const hasCav = open.length > 0 && theme !== 'corridor'
        if (hasCav) blob(cx, cy, isV ? R(6.5, 9.5) : R(11, 16), isV ? R(11, 16) : R(6.5, 9.5), AIR)
        // ③ 平台(先于通道:纵向通道会把挡路的板挖出缺口)
        if (theme === 'plat' && hasCav) {
          rect(cx - 13, (cy + (isV ? 8 : 5)) | 0, 10, 2, WOOD)
          rect(cx + 3, (cy - (isV ? 6 : 3)) | 0, 10, 2, WOOD)
        }
        // ④ 通道:开口边 → 中心,互相保证连通
        if (open.length) {
          blob(cx, cy, 6, 6, AIR)
          for (const [mx, my, dx, dy] of open) {
            carve(mx, my, cx, cy)
            coreRect(mx, my, dx, dy)
          }
        }
        // ⑤ 腔内容物(液体最后画,不被通道挖掉;位置偏下且离边 ≥7px)
        if (hasCav) {
          const py = cy + (isV ? 10 : 6), prx = isV ? 7 : 11
          if (theme === 'lake') blob(cx, py, prx, R(3.5, 5), WATER)
          else if (theme === 'oil') blob(cx, py, prx - 2, R(3, 4.5), OIL)
          else if (theme === 'lava') blob(cx, py, prx - 1, R(3, 4.5), LAVA)
          else if (theme === 'sand') blob(cx, py - 2, isV ? 5 : 8, 3.5, SAND)
          else if (theme === 'moss') {
            for (let k = 0; k < 12; k++) px(cx + R(-(isV ? 6 : 11), isV ? 6 : 11), py + R(-2, 2), MOSS)
          }
        }
        // ⑥ 火把(中心挖空盘半径 6,火把落在必然是空气的位置)
        if (open.length && Math.random() < 0.38) px(cx + R(-4, 4), cy - 3, TORCH)
        // ⑦ P2 标记像素:敌锚/陶罐/吊灯——位置作者定(腔中/腔底/腔顶),内容运行时掷骰
        if (hasCav) {
          if (Math.random() < 0.72) px(cx + R(-6, 6), cy + R(-3, 1), MOB)
          if (!isV && Math.random() < 0.35) px(cx + R(8, 13) * (Math.random() < 0.5 ? 1 : -1), cy + R(-2, 2), MOB)
          if (Math.random() < 0.4) px(cx + R(-5, 5), cy - (isV ? 9 : 6), LAMP)
          // 液体主题腔底是液面,罐子不往液里放
          if (!['lake', 'oil', 'lava'].includes(theme) && Math.random() < 0.45) {
            px(cx + R(-6, 6), cy + (isV ? 8 : 5), VESSEL)
          }
        } else if (open.length && Math.random() < 0.4) {
          px(cx + R(-6, 6), cy, MOB) // 走廊主题:通道里也埋敌锚
        }
      }
    }
    return cv.toDataURL('image/png')
  }
  return { h: genStrip(false), v: genStrip(true) }
})
for (const [name, url] of [['tileset-hb-h.png', hb.h], ['tileset-hb-v.png', hb.v]]) {
  const b = Buffer.from(url.split(',')[1], 'base64')
  fs.writeFileSync(path.join(OUT_DIR, name), b)
  console.log('written:', path.join(OUT_DIR, name), b.length, 'bytes')
}

// ── P3 中观布景池(Noita Pixel Scenes):6 景 × 2 变体,48×36 横排 ──
// 布景=腔内家具:白=保留原地形,黑=修整腔形,#ff8000=color_material 槽(整景运行时统一掷骰换真材质)
const sc = await page.evaluate(() => {
  const KEEP = '#ffffff', AIR = '#000000', WATER = '#3a6fd8', OIL = '#6b5a20',
    POWDER = '#34343a', GOLD = '#ffd054', WOOD = '#7a5230', MOSS = '#588c30',
    STONE = '#8a9a90', BLOOD = '#a41014', SLOT = '#ff8000',
    TORCH = '#ff00ff', MOB = '#ff0080', VESSEL = '#00ff80', LAMP = '#00ffff'
  const TW = 48, TH = 36, VAR = 2
  const cv = document.createElement('canvas')
  cv.width = TW * 6 * VAR
  cv.height = TH
  const g = cv.getContext('2d')
  const R = (a, b) => a + Math.random() * (b - a)
  let ox = 0
  const px = (x, y, c) => { g.fillStyle = c; g.fillRect(ox + (x | 0), y | 0, 1, 1) }
  const rect = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(ox + x, y, w, h) }
  const blob = (cx, cy, rx, ry, c) => {
    for (let y = Math.max(0, cy - ry - 2) | 0; y <= Math.min(TH - 1, cy + ry + 2); y++) {
      for (let x = Math.max(0, cx - rx - 2) | 0; x <= Math.min(TW - 1, cx + rx + 2); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
        if (d < 1 || (d < 1.35 && Math.random() < 0.4)) px(x, y, c)
      }
    }
  }
  // 宿主腔修整:大空腔+平底+石基(布景自带地板=崩塌系统眼里的合法支撑)
  const cave = () => {
    rect(0, 0, TW, TH, KEEP)
    blob(24, 15, 21, 13, AIR)
    rect(2, 26, 44, 7, AIR)
    rect(0, 33, TW, 3, STONE)
  }
  const SCENES = [
    () => { // 祭坛:石阶金字塔+金顶+双火把+守卫——远期法杖台的位置
      cave()
      rect(14, 29, 20, 4, STONE); rect(19, 26, 10, 3, STONE)
      blob(24, 24.5, 3.5, 1.6, GOLD)
      px(12, 27, TORCH); px(35, 27, TORCH)
      px(24, 16, MOB)
    },
    () => { // 实验室:木架两层+架上试剂罐(SLOT)+吊灯——打漏架上的罐全靠模拟
      cave()
      rect(8, 13, 2, 20, WOOD); rect(38, 13, 2, 20, WOOD)
      rect(8, 20, 32, 2, WOOD); rect(8, 13, 32, 2, WOOD)
      for (let k = 0; k < 3; k++) {
        const bx = 13 + k * 9
        rect(bx, 15, 4, 5, WOOD); rect(bx + 1, 16, 2, 3, SLOT)
      }
      px(24, 9, LAMP)
      px(24, 30, MOB)
      if (Math.random() < 0.6) px(30, 30, VESSEL)
    },
    () => { // 藏骨室:灰堆+血渍+中央赏金+双守卫,无灯(黑暗高危高赏)
      cave()
      blob(11, 31, 6, 2.5, POWDER); blob(36, 31, 7, 2.5, POWDER)
      blob(24, 31, 4, 2, GOLD)
      for (let k = 0; k < 9; k++) px(R(6, 42), R(28, 32), BLOOD)
      px(13, 26, MOB); px(35, 26, MOB)
    },
    () => { // 油库:棚架+大桶×3(SLOT)——殉爆连锁的火药库,火把故意挂高远离桶
      cave()
      rect(4, 11, 2, 22, WOOD); rect(42, 11, 2, 22, WOOD); rect(4, 11, 40, 2, WOOD)
      for (let k = 0; k < 3; k++) {
        const bx = 10 + k * 12
        rect(bx, 25, 7, 8, WOOD); rect(bx + 1, 26, 5, 6, SLOT)
      }
      px(24, 17, MOB)
      px(6, 8, TORCH)
    },
    () => { // 苔园:苔毯+浅水洼+垂藤+双吊灯(安全治愈景,火攻可燃)
      cave()
      for (let x = 3; x < 45; x++) { px(x, 32, MOSS); if (Math.random() < 0.5) px(x, 31, MOSS) }
      blob(24, 31.5, 6, 2, WATER)
      rect(12, 5, 1, R(7, 11), MOSS); rect(34, 4, 1, R(8, 12), MOSS)
      px(18, 8, LAMP); px(30, 8, LAMP)
      px(38, 30, VESSEL)
    },
    () => { // 矿工营地:L 形木棚+篝火+金箱+一名看守
      cave()
      rect(8, 15, 2, 18, WOOD); rect(8, 15, 26, 2, WOOD)
      rect(13, 28, 5, 5, WOOD); rect(14, 29, 3, 3, GOLD)
      px(22, 27, TORCH)
      px(37, 24, MOB)
      if (Math.random() < 0.6) px(28, 30, VESSEL)
    },
  ]
  for (let s = 0; s < SCENES.length; s++) {
    for (let v = 0; v < VAR; v++) {
      ox = (s * VAR + v) * TW
      SCENES[s]()
    }
  }
  return cv.toDataURL('image/png')
})
{
  const b = Buffer.from(sc.split(',')[1], 'base64')
  fs.writeFileSync(path.join(OUT_DIR, 'tileset-scenes.png'), b)
  console.log('written:', path.join(OUT_DIR, 'tileset-scenes.png'), b.length, 'bytes')
}
await browser.close()
