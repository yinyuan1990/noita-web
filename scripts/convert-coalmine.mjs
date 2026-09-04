// ── 真 coalmine.png(Noita 原版解包 data.wak,无损)→ 我们的 HB 资产 ──
// 源: noita-ref/coalmine-real.png(348×448 stbhw corner 模板,s=13;头字节藏在首行末 9 字节 ^ (i*55))
//   corner 配置 num_color=[1,2,1,2] vary=3×3 → H 26×13 ×72 块 / V 13×26 ×72 块,内容在栅格 (+1,+1)
//   旧版曾用 wiki 的 2× JPEG 转存图按 28×14 切:每块混入 1px 注记渗色 + 压缩噪声,靠众数滤波硬修——已废弃
// 语义映射(全部对照原版数据实证,见 pixel-guide.md 坑#22):
//   材质 wang_color(materials.xml,按 RGB 精确匹配):
//     #505052 coal→M_COAL  #2f554c water→M_WATER  #3b3b3c oil→M_OIL
//     #413f24/#413f3a wood_static→M_WOOD(坑道木梁,曾误判成煤/油)
//     #404041 steel/#103344 湿岩/#00f344 放射岩/#353923 rock_static→M_STONE
//     #524f2d sand_static/#36311e soil→白槽(土主体+程序石斑;原版是灰度值落材质带)
//     #00ff33 放射绿液→M_WATER(TODO 毒液材质)
//   特殊:#c0ffee=秘室槽(GEN-RULES §六:原版生成后每个连通区 50/50 掷成空气或墙,主路上强制开)→ 类 7 保留给游戏掷骰
//        #8aff80=OpenAlt → 空气;#323232=房间描摹可过不算路径 → 空气;灰阶按亮度 ≥96 归墙、<96 归空气
//   spawn 标记(1px 精确色,全局表 wang_scripts.csv + coalmine.lua 注册):
//     怪:ff0000 小怪 / 800000 大怪 / ff8000,c84040,804040 精英 / 0000ff 蝇巢 / b40000 真菌 / f12ab5 烧烤盒
//     罐:c88d1a,c88000,c80040 道具 / 50a000,bca0f0 药水 / 50a0f0 法杖 / 33934c 商品 / 50fafa 陷阱杖 / c35700 油罐 / 4e175e / 00ff00 物品
//     灯:ffff00 吊灯 / 96c850 幽灵灯;火把:60a064 蜡烛 / 23b9c3 祭坛火把 / 55af4b 祭坛
//     金:55ff8c 宝箱 / 78ffff 生命提升 / ebcd01 金 / f7bb43;藤:80ff5a → 苔藓垂条
//     忽略(布景锚/噪声):ff0aff,ff0080 等 → 空气
// 输出:类域 EPX×2 再最近邻×3 = 6×,26×13→156×78,HB_S=78;144 块全保留(corner 模式要求约束组合完整)
//   尺度依据 GEN-RULES §二:原版 1 wang px = 10 世界 px(玩家 ~15 px 高);我们玩家 9 px 高 → 10×9/15 = 6
//   附 tileset-hb-meta.json:每块真角色约束 a..f(stbhw 枚举序推得,拼接零失配)
import { chromium } from 'playwright'
import fs from 'fs'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const dataUrl = 'data:image/png;base64,' + fs.readFileSync('noita-ref/coalmine-real.png').toString('base64')

const result = await page.evaluate(async (src) => {
  const img = new Image()
  await new Promise((res) => { img.onload = res; img.src = src })
  const cv = document.createElement('canvas')
  cv.width = img.width; cv.height = img.height
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data
  const px = (x, y) => { const i = (y * img.width + x) * 4; return (d[i] << 16 | d[i + 1] << 8 | d[i + 2]) >>> 0 }

  // ── stbhw 头解码(C 里是 unsigned char 异或,JS 必须 &255)──
  const rgbRow0 = []
  for (let x = 0; x < img.width; x++) { const i = x * 4; rgbRow0.push(d[i], d[i + 1], d[i + 2]) }
  const header = []
  for (let i = 0; i < 9; i++) header.push((rgbRow0[img.width * 3 - 1 - i] ^ (i * 55)) & 255)
  if (header[7] !== 0xc0) throw new Error('不是 corner 模板: ' + header.join(','))
  const s = header[6], nc = [header[0], header[1], header[2], header[3]], vx = header[4], vy = header[5]

  // ── 像素分类 ──
  const MAT = {
    0x505052: 3,                                                    // coal
    0x2f554c: 4, 0x00ff33: 4,                                       // water / 放射绿液
    0x3b3b3c: 5,                                                    // oil
    0x413f24: 6, 0x413f3a: 6,                                       // wood_static (横/竖)
    0x404041: 2, 0x103344: 2, 0x00f344: 2, 0x353923: 2,             // steel/湿岩/放射岩/rock_static
    0x524f2d: 1, 0x36311e: 1,                                       // sand_static / soil
    0xc0ffee: 7,                                                    // 秘室槽(游戏内掷骰开/封)
    0x8aff80: 0, 0x323232: 0,                                       // OpenAlt / 房间灰
  }
  const MARKS = {
    0x60a064: 'torch', 0x23b9c3: 'torch', 0x55af4b: 'torch',
    0xff0000: 'mob', 0x800000: 'mob', 0xff8000: 'mob', 0xc84040: 'mob', 0x804040: 'mob',
    0x0000ff: 'mob', 0xb40000: 'mob', 0xf12ab5: 'mob',
    0xc88d1a: 'vessel', 0xc88000: 'vessel', 0xc80040: 'vessel', 0x50a000: 'vessel', 0xbca0f0: 'vessel',
    0x50a0f0: 'vessel', 0x33934c: 'vessel', 0x50fafa: 'vessel', 0xc35700: 'vessel', 0x4e175e: 'vessel', 0x00ff00: 'vessel',
    0xffff00: 'lamp', 0x96c850: 'lamp',
    0x55ff8c: 'gold', 0x78ffff: 'gold', 0xebcd01: 'gold', 0xf7bb43: 'gold',
    0x80ff5a: 'vine',
  }
  const IGNORE = new Set([0xff0aff, 0xff0080, 0x969678, 0x967878, 0x967896, 0x55af8c, 0x005cfd, 0x00b5fc,
    0x93ca00, 0xb97300, 0x00ff5a, 0xffd171, 0xffd181, 0xffff81, 0xc7eb28, 0xe8ff80, 0x2768de, 0x2768df,
    0x6b4f9b, 0xd7b3e8])
  const unknown = {}
  const classify = (c) => {
    if (MAT[c] !== undefined) return MAT[c]
    const r = c >> 16, g = (c >> 8) & 255, b = c & 255
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    if (mx - mn < 24) return mx >= 96 ? 1 : 0 // 灰阶:原版灰度落材质带,我们归并为 墙/空气 两类
    unknown[c.toString(16).padStart(6, '0')] = (unknown[c.toString(16).padStart(6, '0')] || 0) + 1
    return 0
  }

  // ── 切一块砖:精确内容区,无滤波无聚类 ──
  const cutTile = (x0, y0, w, h) => {
    const raw = new Uint8Array(w * h)
    const marks = [] // {x,y,kind} 1px 精确
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = px(x0 + x, y0 + y)
      const mk = MARKS[c]
      if (mk) { marks.push({ x, y, kind: mk }); raw[y * w + x] = 0; continue }
      if (IGNORE.has(c)) { raw[y * w + x] = 0; continue }
      raw[y * w + x] = classify(c)
    }
    return { raw, marks, w, h }
  }

  // ── scale2x(EPX) 类域放大 ──
  const epx = (a, w, h) => {
    const W2 = w * 2, H2 = h * 2
    const b2 = new Uint8Array(W2 * H2)
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
  // 最近邻整数放大(原版就是整格复制,不平滑;我们只保留一遍 EPX 磨掉 45° 锯齿)
  const nn = (a, w, h, k) => {
    const W2 = w * k
    const b2 = new Uint8Array(w * k * h * k)
    for (let y = 0; y < h * k; y++) for (let x = 0; x < W2; x++) b2[y * W2 + x] = a[((y / k) | 0) * w + ((x / k) | 0)]
    return b2
  }
  const finalize = (t) => {
    const a2 = epx(t.raw, t.w, t.h)
    const a6 = nn(a2, t.w * 2, t.h * 2, 3)
    return { a: Array.from(a6), marks: t.marks.map((m) => ({ x: m.x * 6, y: m.y * 6, kind: m.kind })), abcdef: t.abcdef }
  }

  // ── corner 模板枚举(严格照 stbhw__process_template / noita-worldgen tilebin_build)──
  // H:外层 k<nc2, j<nc1, i<nc0, q<vy;内层 v<vx, c<nc3, b<nc2, a<nc1;d=i e=j f=k
  const hT = [], vT = []
  let ypos = 2
  for (let k = 0; k < nc[2]; k++) for (let j = 0; j < nc[1]; j++) for (let i = 0; i < nc[0]; i++) for (let q = 0; q < vy; q++) {
    let xpos = 0
    for (let v = 0; v < vx; v++) for (let c = 0; c < nc[3]; c++) for (let b = 0; b < nc[2]; b++) for (let a = 0; a < nc[1]; a++) {
      const t = cutTile(xpos + 1, ypos + 1, 2 * s, s)
      t.abcdef = [a, b, c, i, j, k]
      hT.push(finalize(t))
      xpos += 2 * s + 3
    }
    ypos += s + 3
  }
  ypos += 2
  // V:外层 k<nc3, j<nc0, i<nc1, q<vx;内层 v<vy, c<nc2, b<nc3, a<nc0;d=i e=j f=k
  for (let k = 0; k < nc[3]; k++) for (let j = 0; j < nc[0]; j++) for (let i = 0; i < nc[1]; i++) for (let q = 0; q < vx; q++) {
    let xpos = 0
    for (let v = 0; v < vy; v++) for (let c = 0; c < nc[2]; c++) for (let b = 0; b < nc[3]; b++) for (let a = 0; a < nc[0]; a++) {
      const t = cutTile(xpos + 1, ypos + 1, s, 2 * s)
      t.abcdef = [a, b, c, i, j, k]
      vT.push(finalize(t))
      xpos += s + 3
    }
    ypos += 2 * s + 3
  }
  return { s, nc, vx, vy, hT, vT, unknown }
}, dataUrl)

const S2 = result.s * 6 // 13 → 78 = 新 HB_S
console.log(`corner 模板: s=${result.s} nc=[${result.nc}] vary=${result.vx}x${result.vy}`)
console.log(`H 砖 ${result.hT.length} 块(${S2 * 2}×${S2}), V 砖 ${result.vT.length} 块(${S2}×${S2 * 2}), HB_S=${S2}`)
const unk = Object.entries(result.unknown || {})
if (unk.length) console.log('未识别色(已归空气):', unk.map(([c, n]) => `${c}×${n}`).join(' '))
const markStat = {}
for (const t of [...result.hT, ...result.vT]) for (const m of t.marks) markStat[m.kind] = (markStat[m.kind] || 0) + 1
console.log('标记统计:', JSON.stringify(markStat))

// ── 画条带:分类 → 我们的 PNG_MAT 色板 ──
const paintStrip = async (tiles, tw, th) => await page.evaluate(({ tiles, tw, th }) => {
  const COL = { 0: '#000000', 1: '#705034', 2: '#8a9a90', 3: '#34343a', 4: '#3a6fd8', 5: '#6b5a20', 6: '#7a5230', 7: '#c0ffee' }
  const MARK = { torch: '#ff00ff', mob: '#ff0080', vessel: '#00ff80', lamp: '#00ffff' }
  const cv = document.createElement('canvas')
  cv.width = tw * tiles.length; cv.height = th
  const ctx = cv.getContext('2d')
  // 白槽=土主体+低频石斑(coalmine.xml 的 soil/sand/rock 材质带,简化为 sin 场)
  const stoneAt = (gx, gy) => {
    const n = Math.sin(gx * 0.11 + Math.sin(gy * 0.07) * 2.3) + Math.sin(gy * 0.13 + gx * 0.05)
    return n > 0.9
  }
  for (let t = 0; t < tiles.length; t++) {
    const { a, marks } = tiles[t]
    const ox = t * tw
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      let c = a[y * tw + x]
      if (c === 1 && stoneAt(ox + x, y + t * 37)) c = 2
      ctx.fillStyle = COL[c]
      ctx.fillRect(ox + x, y, 1, 1)
    }
    for (const m of marks) {
      const mx = ox + Math.min(tw - 3, m.x), my = Math.min(th - 7, m.y) // 必须加 ox:漏了会把全部标记堆进第 0 块砖
      if (m.kind === 'gold') { // 金簇(宝箱/生命提升锚):3×3 金
        ctx.fillStyle = '#ffd054'
        ctx.fillRect(mx, my, 3, 3)
      } else if (m.kind === 'vine') { // 垂藤(coalmine.lua spawn_vines):苔藓垂条 2×6
        ctx.fillStyle = '#588c30'
        ctx.fillRect(mx, my, 2, 6)
      } else {
        ctx.fillStyle = MARK[m.kind]
        ctx.fillRect(mx, my, 1, 1)
      }
    }
  }
  return cv.toDataURL('image/png')
}, { tiles, tw, th })

const hPng = await paintStrip(result.hT, S2 * 2, S2)
const vPng = await paintStrip(result.vT, S2, S2 * 2)
const dir = 'public/res/pixel-tiles'
fs.writeFileSync(`${dir}/tileset-hb-h.png`, Buffer.from(hPng.split(',')[1], 'base64'))
fs.writeFileSync(`${dir}/tileset-hb-v.png`, Buffer.from(vPng.split(',')[1], 'base64'))
// 真角色约束元数据:pixelDemo 读到它就走 corner 模式拼接(零失配);删掉则回退边色推导
fs.writeFileSync(`${dir}/tileset-hb-meta.json`, JSON.stringify({
  mode: 'corner', s: S2, numColor: result.nc,
  h: result.hT.map((t) => t.abcdef), v: result.vT.map((t) => t.abcdef),
}))
console.log(`已输出: tileset-hb-h/v.png + tileset-hb-meta.json(corner 真约束)`)
await browser.close()
