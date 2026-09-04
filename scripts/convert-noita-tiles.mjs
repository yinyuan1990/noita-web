// ── Noita 手绘 wang 瓦片 → 我们的 HB 资产转换器 ──
// 输入: noita-ref/inside.png(NoitaWangTiler 内嵌的 coalmine 简化版,stbhw corner 模板,短边 22)
// 布局: H 砖 44×22 @ (1+i*47, 3+j*25) 5×5;V 砖 22×44 @ (1+i*25, 130+j*47) 9×5(部分空)
// 输出: public/res/pixel-tiles/tileset-hb-h.png(44N×22 横条带) / tileset-hb-v.png(22N×44)
// 重着色: 黑→空气 白→石(混土壤斑块+金矿点) 橙→岩浆 灰→土;空腔里程序撒 P2 标记(火把/罐/怪锚/吊灯)
import { chromium } from 'playwright'
import fs from 'fs'

const S = 22
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const dataUrl = 'data:image/png;base64,' + fs.readFileSync('noita-ref/inside.png').toString('base64')

const result = await page.evaluate(async ({ src, S }) => {
  const img = new Image()
  await new Promise((res) => { img.onload = res; img.src = src })
  const cv = document.createElement('canvas')
  cv.width = img.width; cv.height = img.height
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data
  // 分类:0=空 1=石 2=浆 3=土(中灰)
  const cls = (x, y) => {
    const i = (y * img.width + x) * 4
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]]
    if (r < 20 && g < 20 && b < 20) return 0
    if (r > 200 && g > 60 && g < 140 && b < 40) return 2
    if (r > 190 && g > 190 && b > 190) return 1
    if (r > 60 && r < 190 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30) return 3
    return 1 // 角标杂色落进内容区时当石头
  }
  const cutTile = (x0, y0, w, h) => {
    const a = new Uint8Array(w * h)
    let air = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = cls(x0 + x, y0 + y)
      a[y * w + x] = c
      if (c === 0) air++
    }
    // 橙色连通块分级:小块(<18px)→金矿(4),大片才保留岩浆——全转浆的话满屏火灾
    const seen = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      if (a[i] !== 2 || seen[i]) continue
      const q = [i]; seen[i] = 1
      const comp = []
      while (q.length) {
        const j = q.pop()
        comp.push(j)
        const jx = j % w, jy = (j / w) | 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = jx + dx, ny = jy + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const k = ny * w + nx
          if (a[k] === 2 && !seen[k]) { seen[k] = 1; q.push(k) }
        }
      }
      if (comp.length < 18) for (const j of comp) a[j] = 4
    }
    // scale2x(EPX):分类域上放大 2 倍——通道从 5~8px 提到 10~16px(人物 9px,Noita 口径=1~3 人高)
    // 斜线自动补 45° 角,不会出 2×2 马赛克台阶
    const W2 = w * 2, H2 = h * 2
    const b = new Uint8Array(W2 * H2)
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
      b[o] = p1; b[o + 1] = p2; b[o + W2] = p3; b[o + W2 + 1] = p4
    }
    return { a: b, air: air / (w * h) }
  }
  const hT = [], vT = []
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
    const t = cutTile(1 + i * 47, 3 + j * 25, S * 2, S)
    if (t.air > 0.02 && t.air < 0.98) hT.push(t.a)
  }
  for (let j = 0; j < 5; j++) for (let i = 0; i < 9; i++) {
    const x0 = 1 + i * 25, y0 = 130 + j * 47
    if (x0 + S > img.width || y0 + S * 2 > img.height) continue
    const t = cutTile(x0, y0, S, S * 2)
    if (t.air > 0.02 && t.air < 0.98) vT.push(t.a)
  }
  return { hT: hT.map((a) => Array.from(a)), vT: vT.map((a) => Array.from(a)) }
}, { src: dataUrl, S })

console.log(`H 砖 ${result.hT.length} 块, V 砖 ${result.vT.length} 块`)

// ── 重着色+撒标记,画到条带 canvas 输出 PNG ──
const COL = { air: '#000000', stone: '#8a9a90', lava: '#ff5a10', dirt: '#705034', gold: '#ffd054' }
const MARK = { torch: '#ff00ff', mob: '#ff0080', vessel: '#00ff80', lamp: '#00ffff' }

const paint = await page.evaluate(async ({ tiles, tw, th, COL, MARK }) => {
  const n = tiles.length
  const cv = document.createElement('canvas')
  cv.width = tw * n; cv.height = th
  const ctx = cv.getContext('2d')
  const rnd = (a, b) => a + Math.random() * (b - a)
  for (let t = 0; t < n; t++) {
    const a = tiles[t]
    const ox = t * tw
    // 土壤斑块 2~3 个椭圆(把纯石头砖变成 Noita 煤矿的石土混合)
    const blobs = []
    for (let k = 0; k < 2 + (Math.random() * 2 | 0); k++) {
      blobs.push([rnd(6, tw - 6), rnd(4, th - 4), rnd(6, 15), rnd(5, 10)])
    }
    // 金矿点 1~2 簇
    const golds = []
    for (let k = 0; k < 1 + (Math.random() * 2 | 0); k++) {
      golds.push([rnd(3, tw - 3), rnd(3, th - 3), rnd(1.8, 3.2)])
    }
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const c = a[y * tw + x]
      let col = COL.air
      if (c === 1) {
        col = COL.stone
        for (const [bx, by, brx, bry] of blobs) {
          if (((x - bx) / brx) ** 2 + ((y - by) / bry) ** 2 < 1) { col = COL.dirt; break }
        }
        for (const [gx, gy, gr] of golds) {
          if ((x - gx) ** 2 + (y - gy) ** 2 < gr * gr) { col = COL.gold; break }
        }
      } else if (c === 2) col = COL.lava
      else if (c === 3) col = COL.dirt
      ctx.fillStyle = col
      ctx.fillRect(ox + x, y, 1, 1)
    }
    // P2 标记撒点(Noita wang_scripts 思路):贴地空气=火把/罐/怪锚,贴顶空气=吊灯
    const floorSpots = [], ceilSpots = []
    for (let y = 2; y < th - 2; y++) for (let x = 3; x < tw - 3; x++) {
      if (a[y * tw + x] !== 0) continue
      if (a[(y + 1) * tw + x] === 1 && a[(y - 1) * tw + x] === 0) floorSpots.push([x, y])
      if (a[(y - 1) * tw + x] === 1 && a[(y + 1) * tw + x] === 0) ceilSpots.push([x, y])
    }
    const pick = (arr) => arr[(Math.random() * arr.length) | 0]
    const put = (p, col) => { ctx.fillStyle = col; ctx.fillRect(ox + p[0], p[1], 1, 1) }
    if (floorSpots.length > 4) {
      if (Math.random() < 0.30) put(pick(floorSpots), MARK.torch)
      if (Math.random() < 0.28) put(pick(floorSpots), MARK.mob)
      if (Math.random() < 0.16) put(pick(floorSpots), MARK.vessel)
    }
    if (ceilSpots.length > 4 && Math.random() < 0.18) put(pick(ceilSpots), MARK.lamp)
  }
  return cv.toDataURL('image/png')
}, { tiles: result.hT, tw: S * 4, th: S * 2, COL, MARK }) // scale2x 后 H 砖 88×44

const paintV = await page.evaluate(async ({ tiles, tw, th, COL, MARK }) => {
  const n = tiles.length
  const cv = document.createElement('canvas')
  cv.width = tw * n; cv.height = th
  const ctx = cv.getContext('2d')
  const rnd = (a, b) => a + Math.random() * (b - a)
  for (let t = 0; t < n; t++) {
    const a = tiles[t]
    const ox = t * tw
    const blobs = []
    for (let k = 0; k < 2 + (Math.random() * 2 | 0); k++) {
      blobs.push([rnd(4, tw - 4), rnd(6, th - 6), rnd(5, 10), rnd(6, 15)])
    }
    const golds = []
    for (let k = 0; k < 1 + (Math.random() * 2 | 0); k++) {
      golds.push([rnd(3, tw - 3), rnd(3, th - 3), rnd(1.8, 3.2)])
    }
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const c = a[y * tw + x]
      let col = COL.air
      if (c === 1) {
        col = COL.stone
        for (const [bx, by, brx, bry] of blobs) {
          if (((x - bx) / brx) ** 2 + ((y - by) / bry) ** 2 < 1) { col = COL.dirt; break }
        }
        for (const [gx, gy, gr] of golds) {
          if ((x - gx) ** 2 + (y - gy) ** 2 < gr * gr) { col = COL.gold; break }
        }
      } else if (c === 2) col = COL.lava
      else if (c === 3) col = COL.dirt
      ctx.fillStyle = col
      ctx.fillRect(ox + x, y, 1, 1)
    }
    const floorSpots = [], ceilSpots = []
    for (let y = 2; y < th - 2; y++) for (let x = 3; x < tw - 3; x++) {
      if (a[y * tw + x] !== 0) continue
      if (a[(y + 1) * tw + x] === 1 && a[(y - 1) * tw + x] === 0) floorSpots.push([x, y])
      if (a[(y - 1) * tw + x] === 1 && a[(y + 1) * tw + x] === 0) ceilSpots.push([x, y])
    }
    const pick = (arr) => arr[(Math.random() * arr.length) | 0]
    const put = (p, col) => { ctx.fillStyle = col; ctx.fillRect(ox + p[0], p[1], 1, 1) }
    if (floorSpots.length > 4) {
      if (Math.random() < 0.30) put(pick(floorSpots), MARK.torch)
      if (Math.random() < 0.28) put(pick(floorSpots), MARK.mob)
      if (Math.random() < 0.16) put(pick(floorSpots), MARK.vessel)
    }
    if (ceilSpots.length > 4 && Math.random() < 0.18) put(pick(ceilSpots), MARK.lamp)
  }
  return cv.toDataURL('image/png')
}, { tiles: result.vT, tw: S * 2, th: S * 4, COL, MARK }) // scale2x 后 V 砖 44×88

// 备份旧资产再覆盖
const dir = 'public/res/pixel-tiles'
for (const f of ['tileset-hb-h.png', 'tileset-hb-v.png']) {
  const p = `${dir}/${f}`
  if (fs.existsSync(p) && !fs.existsSync(p + '.bak')) fs.copyFileSync(p, p + '.bak')
}
fs.writeFileSync(`${dir}/tileset-hb-h.png`, Buffer.from(paint.split(',')[1], 'base64'))
fs.writeFileSync(`${dir}/tileset-hb-v.png`, Buffer.from(paintV.split(',')[1], 'base64'))
console.log(`已输出: H 条带 ${result.hT.length} 块 / V 条带 ${result.vT.length} 块(scale2x 后短边 ${S * 2})`)
await browser.close()
