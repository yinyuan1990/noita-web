/**
 * 像素材质实验场 · 低配 Noita 验证 demo
 *
 * 核心 = Purho 在 GDC 讲的那条"95% 的技术":
 *   沙子:下方空则落下,否则看左下/右下 → 液体再多查左右 → 气体上下颠倒
 * 在 360×200 的低分辨率网格上跑真·落沙模拟(整数放大到全屏,像素风即美术风),
 * 10 种材质 + 可破坏地形 + 爆炸碎屑物理 + WASD 飞行射击。
 * 自包含:纯 Canvas2D,零依赖,不加载任何资源。
 *
 * 材质反应(全部绑定在"状态"上,不写来源 case):
 *   火×油/木/火药=燃烧/殉爆  火×水=蒸汽  熔岩×水=凝固成石  蒸汽冷凝回水
 *   油浮于水(密度交换)  敌人流血/漏油,尸液是真实液体参与模拟
 */

// ── 模拟网格:世界比屏幕大且深(Noita 式向下探索),镜头跟随玩家 ──
// 分辨率对标 Noita:它一屏约 427×240 世界像素(每世界像素≈3 屏幕像素),粒度细是"逼真"的根基。
// 我们从 240×135@5x 提到 320×180@3x:同屏世界像素多 78%,角色/火/水相对屏幕全部变细。
//
// ── 世界骨架 = 群系图(Noita biome_map.png 的规则,GEN-RULES §一):1 格 = 1 chunk,世界尺寸由图算出 ──
// 原作 chunk = 512 世界 px;我们 1 wang px = 6 px(原作 10),同比例 chunk = 512×0.6 ≈ 312(= 4×HB_S,砖行整除)。
// 下表是 biome_map.png 第 12~16 行、第 32~39 列的逐格转写(scripts/_biome-map-dump 实测;_biomes_all.xml 色表):
//   g 丘陵 hills(噪声地表,无砖)      ^ mountain_top(山顶雪峰整图)
//   < mountain_left_entrance(出生洞) H mountain_hall(山体大厅,实心+整图)  > mountain_right(右坡整图)
//   [ ] mountain_left/right_stub(矿区两肩)   Q coalmine(wang 砖)  W coalmine_alt(砖变体)  b solid_wall(实心)
//   | temple_wall   L / T / R = temple_altar_left / temple_altar / temple_altar_right(圣山三格,整图 pixel scene)
// 原作世界原点 (0,0) = 图上 (35,14) 的左上角:图 y=14 就是煤矿第一行,地表在它上面(原作 y<0)。
const CH = 312
const WORLD_MAP = [
  'gggg^ggg', // 图 y=12
  'ggg<H>gg', // 图 y=13   ← 出生在 < 格(原作出生点 (227,-85))
  'gg[QQQ]g', // 图 y=14   ← 原作世界 y=0,煤矿顶
  'WWQQQQQb', // 图 y=15
  '|LTR|||b', // 图 y=16   ← 圣山(7 格宽)
]
const MAP_COLS = WORLD_MAP[0].length, MAP_ROWS = WORLD_MAP.length
const MAP_CX0 = 32, MAP_CY0 = 12 // 表左上角在 biome_map 上的格坐标
const K = CH / 512 // 原作世界 px → 我们的 px
const nx2w = (x) => (x + (35 - MAP_CX0) * 512) * K // 原作世界坐标 → 我们的世界坐标
const ny2w = (y) => (y + (14 - MAP_CY0) * 512) * K
const cellAt = (x, y) => {
  const c = (x / CH) | 0, r = (y / CH) | 0
  return c < 0 || r < 0 || c >= MAP_COLS || r >= MAP_ROWS ? 'b' : WORLD_MAP[r][c]
}
const isMineCell = (x, y) => { const ch = cellAt(x, y); return ch === 'Q' || ch === 'W' }
const SW = MAP_COLS * CH // 2496
const SH = MAP_ROWS * CH // 1560
const N = SW * SH
const VW = 320 // 取景窗(视口)尺寸,只渲染这一块
const VH = 180
const cam = { x: 0, y: 0 }
let camIX = 0
let camIY = 0
const grid = new Uint8Array(N)   // 材质 id
const aux = new Uint8Array(N)    // 火/气体寿命
const moved = new Uint8Array(N)  // 本帧已更新标记(奇偶)
const shade = new Uint8Array(N)  // 随机相位(熔岩泡点/背景墙抖动用)+ 弹坑焦痕(>26);材质本体质感走 MATTEX 平铺纹理
for (let i = 0; i < N; i++) shade[i] = (Math.random() * 26) | 0

const M_EMPTY = 0, M_STONE = 1, M_SAND = 2, M_WATER = 3, M_OIL = 4, M_FIRE = 5,
  M_SMOKE = 6, M_STEAM = 7, M_WOOD = 8, M_LAVA = 9, M_BLOOD = 10, M_POWDER = 11, M_ICE = 12, M_GOLD = 13, M_MOSS = 14, M_DIRT = 15,
  M_COAL = 16, // 煤(Noita coal):可燃缓燃、不爆炸。coalmine 煤脉必须是它——曾映射成 M_POWDER(火药),
              // 任何火源(炎热修饰符自燃油/熔岩海/火把检漏)碰到煤脉就连环爆,把手绘地形炸成碎渣("地图自己爆了")
  M_BRICK = 17 // 圣山砖(Noita templebrick_static):不可炸、不塌方——圣山是"安全区",结构必须永远完整
const NMAT = 18 // 材质总数:所有按材质下标的表一律用它,加新材质只改这里

// ── Noita 式画面分层(视频逐帧分析结论) ──
// 背景墙:不参与模拟的暗色装饰层(0=无 1=墙基色 2=纹理 3=群系点缀 4=背景木架剪影)
const bgGrid = new Uint8Array(SW * SH)
// 中景装饰层:树/蘑菇画在玩家身后,不碰撞不挡弹(Noita 的地表树=风景不是障碍物)
// 0=无 1=松叶 2=木干 3=蘑菇
const midGrid = new Uint8Array(SW * SH)
const MID_PAL = [[52, 96, 40], [82, 56, 28], [118, 80, 46]]
// ── 远景脊线(f15/f26/f31 标定的商业配方):三层分形脊线山 + 近山针叶林剪影 ──
// |sin| 圆弧山一眼假;真山形 = ridged noise(多倍频 value noise 过 |·| 折叠,峰尖谷缓)
const RIDGE_N = 2048
const RIDGE_M = RIDGE_N - 1
const ridgeF = new Float32Array(RIDGE_N) // 远:最亮最矮(空气透视强)
const ridgeM = new Float32Array(RIDGE_N) // 中
const ridgeC = new Float32Array(RIDGE_N) // 近:最暗,脊线上烙针叶林剪影
function genRidges() {
  const layer = (wl, amp) => {
    const n = Math.ceil(RIDGE_N / wl) + 2
    const vs = []
    for (let i = 0; i < n; i++) vs.push((Math.random() * 2 - 1) * amp)
    return (x) => {
      const f = x / wl, i0 = f | 0
      const s = (1 - Math.cos((f - i0) * Math.PI)) / 2
      return vs[i0] * (1 - s) + vs[i0 + 1] * s
    }
  }
  const mk = (arr, base, amp) => {
    const l1 = layer(230, amp), l2 = layer(80, amp * 0.5), l3 = layer(26, amp * 0.16)
    for (let x = 0; x < RIDGE_N; x++) {
      // ridged:振幅减 |噪声|,零交叉翻折成尖峰——商业地形的标准脊线
      arr[x] = base - Math.max(0, amp - Math.abs(l1(x) + l2(x))) - l3(x)
    }
  }
  mk(ridgeF, 70, 26)
  mk(ridgeM, 84, 30)
  mk(ridgeC, 98, 32)
  // 近山脊线烙树剪影(远景针叶林=Noita 地表轮廓的灵魂):不规则间隔的小三角
  const bare = ridgeC.slice()
  let tx = 6 + Math.random() * 12
  while (tx < RIDGE_N - 8) {
    const th = 5 + Math.random() * 7
    const tw = Math.max(2, th * 0.42)
    for (let dx = -tw; dx <= tw; dx++) {
      const xi = (tx + dx) | 0
      if (xi < 0 || xi >= RIDGE_N) continue
      const t = 1 - Math.abs(dx) / tw
      const yTop = bare[xi] - t * th
      if (yTop < ridgeC[xi]) ridgeC[xi] = yTop
    }
    tx += 7 + Math.random() * 22
  }
}
genRidges()
const biomeArr = new Uint8Array(SW) // 0=冰川 1=森林 2=油田(渲染背景墙调色用)
const torches = [] // 火把光锚 {x,y}:每屏必有光,黑暗才有层次
const motes = []   // 环境浮尘(雪/孢子/煤灰)

// 液体导电场:电击注入后沿水/血洪泛,格子带电若干帧(Noita:电死一整池)
const elec = new Uint8Array(SW * SH)
const CONDUCTIVE = new Uint8Array(NMAT)
CONDUCTIVE[M_WATER] = CONDUCTIVE[M_BLOOD] = 1 // 油不导电(Noita 同款)

const IS_LIQUID = new Uint8Array(NMAT)
IS_LIQUID[M_WATER] = IS_LIQUID[M_OIL] = IS_LIQUID[M_LAVA] = IS_LIQUID[M_BLOOD] = 1
const IS_GAS = new Uint8Array(NMAT)
IS_GAS[M_SMOKE] = IS_GAS[M_STEAM] = 1
const IS_SOLID = new Uint8Array(NMAT) // 挡子弹/挡飞船
IS_SOLID[M_STONE] = IS_SOLID[M_WOOD] = IS_SOLID[M_SAND] = IS_SOLID[M_POWDER] = IS_SOLID[M_ICE] = IS_SOLID[M_DIRT] = IS_SOLID[M_COAL] = IS_SOLID[M_BRICK] = 1
const DENSITY = new Uint8Array(NMAT)
DENSITY[M_OIL] = 1
DENSITY[M_WATER] = DENSITY[M_BLOOD] = 2
DENSITY[M_LAVA] = 3
const DISPERSE = new Uint8Array(NMAT)
DISPERSE[M_WATER] = 4
DISPERSE[M_BLOOD] = 3
DISPERSE[M_OIL] = 3
DISPERSE[M_LAVA] = 1

const idx = (x, y) => y * SW + x
const inB = (x, y) => x >= 0 && x < SW && y >= 0 && y < SH

// ── 光照(华美的第一来源):火/熔岩/子弹/玩家发光,岩石挡光,洞穴越深越黑 ──
const light = new Uint8Array(N)     // 本帧光照强度
const surfY = new Int16Array(SW)    // 地表高度(算环境光)
const sparks = []                   // 装饰性火花(不参与模拟,纯好看) {x,y,vx,vy,life,max,c}
const flashes = []                  // 爆炸闪光 {x,y,r,life}
function addSpark(x, y, vx, vy, life, c, big = 0) {
  if (sparks.length > 800) return
  sparks.push({ x, y, vx, vy, life, max: life, c, big }) // big>0 = 火球团(大光团慢速上滚,爆炸核心的"肉")
}
function sparkBurst(x, y, n, speed, c) {
  // 上升偏置要小:火星飘过头顶悬停会像"第二个光源"(重影感)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const sp = speed * (0.4 + Math.random())
    addSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp - speed * 0.1, 0.2 + Math.random() * 0.3, c)
  }
}
/** 锥形火花:沿指定方向喷(枪口用——全向+上飘的 sparkBurst 会飘过头顶,像第二个发射点) */
function sparkCone(x, y, ang, n, speed, c) {
  for (let i = 0; i < n; i++) {
    const a = ang + (Math.random() - 0.5) * 0.5
    const sp = speed * (0.5 + Math.random())
    addSpark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.12 + Math.random() * 0.18, c)
  }
}
// ── 像素闪电:中点位移折线 + 随机分叉,烙进像素缓冲(电的"形态") ──
const bolts = [] // {pts:[[x,y]..], life, max}
const elecSurf = [] // 本帧带电液面采样点(供水面爬弧)
function spawnBolt(x0, y0, x1, y1, jag = 3) {
  if (bolts.length > 24) return
  const pts = [[x0, y0]]
  const segs = Math.max(3, (Math.hypot(x1 - x0, y1 - y0) / 5) | 0)
  const dx = x1 - x0, dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  for (let i = 1; i < segs; i++) {
    const t = i / segs
    const off = (Math.random() - 0.5) * jag * 2
    pts.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off])
  }
  pts.push([x1, y1])
  bolts.push({ pts, life: 3 + ((Math.random() * 3) | 0), max: 6 })
  // 分叉:随机从中段岔出一条短支
  if (jag > 1.5 && Math.random() < 0.6) {
    const k = 1 + ((Math.random() * (pts.length - 2)) | 0)
    const [bx, by] = pts[k]
    const ba = Math.atan2(dy, dx) + (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.8)
    const bl = 4 + Math.random() * 8
    spawnBolt(bx, by, bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl, jag * 0.5)
  }
}

// ── 画布:模拟画到 offscreen,再整数放大 ─────────────────
const stageEl = document.getElementById('stage')
const off = document.createElement('canvas')
off.width = VW
off.height = VH
const octx = off.getContext('2d')
const img = octx.createImageData(VW, VH)
const buf32 = new Uint32Array(img.data.buffer)
// 辉光层:只画发光体,模糊后叠加到主画面(bloom)
const emis = document.createElement('canvas')
emis.width = VW
emis.height = VH
const ectx = emis.getContext('2d')
// 注意:必须与 emis 画布同为取景窗尺寸!曾误写成 SW×SH(世界尺寸),putImageData 按 480/行
// 解读 240/行的数据 → 辉光整体错位到半高处,发光体(子弹/火/熔岩)全都拖出一个无伤害"影子"
const eimg = ectx.createImageData(VW, VH)
const ebuf = new Uint32Array(eimg.data.buffer)
// 小地图:整个世界 1/MMS 采样,低频刷新(世界 2496×1560 → 208×130)
const MMS = 12
const MMW = SW / MMS
const MMH = SH / MMS
const mini = document.createElement('canvas')
mini.width = MMW
mini.height = MMH
const mctx = mini.getContext('2d')
const mimg = mctx.createImageData(MMW, MMH)
const mbuf = new Uint32Array(mimg.data.buffer)
function updateMinimap() {
  for (let y = 0; y < MMH; y++) {
    for (let x = 0; x < MMW; x++) {
      const m = grid[idx(x * 4 + 1, y * 4 + 1)]
      let c
      if (m === M_EMPTY || IS_GAS[m]) c = rgb(11, 13, 22)
      else if (m === M_LAVA || m === M_FIRE) c = rgb(214, 84, 22)
      else if (m === M_WATER) c = rgb(52, 100, 190)
      else if (m === M_OIL) c = rgb(92, 74, 30)
      else if (m === M_ICE) c = rgb(138, 188, 220)
      else if (m === M_WOOD) c = rgb(112, 78, 46)
      else if (m === M_GOLD) c = rgb(235, 192, 70)
      else if (m === M_MOSS) c = rgb(66, 96, 42)
      else if (m === M_DIRT) c = rgb(96, 70, 46)
      else if (m === M_COAL || m === M_POWDER) c = rgb(44, 44, 50)
      else c = rgb(82, 86, 96)
      mbuf[y * MMW + x] = c
    }
  }
  mctx.putImageData(mimg, 0, 0)
}
const view = document.createElement('canvas')
stageEl.appendChild(view)
const vctx = view.getContext('2d')
// 精灵层素材(Kenney Pixel Shmup,CC0,项目内已有):玩家机 + 两款敌战机
const SHIP_IMG = {}
for (const [key, file] of [['f1', 'ship_0003'], ['f2', 'ship_0005']]) {
  const im = new Image()
  im.src = `${import.meta.env.BASE_URL}res/shmup/ships/${file}.png`
  im.onload = () => { SHIP_IMG[key] = im }
}
let SCALE = 4
function fitView() {
  SCALE = Math.max(3, Math.min(Math.floor((stageEl.clientWidth - 8) / VW), Math.floor((stageEl.clientHeight - 8) / VH)))
  view.width = VW * SCALE
  view.height = VH * SCALE
  vctx.imageSmoothingEnabled = false
}
fitView()
window.addEventListener('resize', fitView)

// ── 实体 ───────────────────────────────────────────
const parts = []   // 飞溅材质碎屑 {x,y,vx,vy,m}(落地重新沉积回网格)
const bullets = [] // {x,y,vx,vy,kind,life}
const mobs = []    // {kind,x,y,vx,vy,hp,burn}
const expQueue = []
let frame = 0
let shakeT = 0
let boomFlash = 0 // 大爆炸全屏白闪(1~2 帧过曝,爆炸的"重量感")
const player = {
  x: 50, y: 30, vx: 0, vy: 0, hp: 100, iframe: 0, dead: 0, fireCd: 0, hurtT: 0,
  fuel: 100, onGround: false, walkT: 0, burnT: 0, thrusting: false,
  air: 100, wasLiq: false, // 氧气(潜水消耗) / 上一帧是否在液体里(入水水花)
  stWet: 0, stOil: 0, stBlood: 0, // 染色 Stains:湿(防燃/电更疼)油(打滑/烧更久)血(防燃/暴击)
  gold: 0,
}
/** M1 一局目标:地表出发 → 深渊底密室取「星之核」→ 带回地表祭坛 = 通关;死亡即整局重开 */
const quest = { state: 'seek', coreX: 0, coreY: 0, altarX: 0, altarY: 0, t: 0 } // state: seek→carry→won
const mouse = { x: 180, y: 100, sx: 400, sy: 260, l: false, r: false }
const keys = new Set()

// ── 地图生成 ────────────────────────────────────────
function blob(cx, cy, r, m, replaceOnly = -1) {
  // 循环变量必须是整数:浮点下标写 Uint8Array 会被静默丢弃(圆心/半径带小数时整个 blob 一格都不写,
  // 曾让钻磨弹/大洞窟/竖井全部空转)。圆心保留浮点参与距离判定,亚像素中心照样有效
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r)
  const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inB(x, y)) continue
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue
      const i = idx(x, y)
      if (replaceOnly >= 0 && grid[i] !== replaceOnly) continue
      grid[i] = m
    }
  }
}
/**
 * 地下瓦片模板库(简化版 Noita 地图生成)
 * Noita 官方用 Herringbone Wang Tiles(stb_herringbone_wang_tile.h):手工模板 + 边缘约束拼接 + 连通性校验。
 * 本简化版保留其精髓:①手写模板(有设计感的房间/走廊/竖井) ②横向通道带保证行内连通
 * ③固定竖井列贯穿保证层间连通 ④CA 平滑消格子感 ⑤材质按群系×深度调色。
 * 每模板 12×10 字符,1 字符 = 4×4 像素 → 48×40 瓦片;`#`墙 `.`空 `~`液池 `*`矿脉 `%`散沙 `=`平台
 * 所有模板第 4-6 行保持可通行(空/液体),整行天然连通。
 */
const TILE_W = 48
const TILE_H = 40
const T_CORRIDOR = [
  '############',
  '##*####*####',
  '#####*######',
  '############',
  '............',
  '............',
  '############',
  '###*########',
  '######*#####',
  '############',
]
const T_CAVERN = [
  '############',
  '###......###',
  '##........##',
  '#..........#',
  '............',
  '............',
  '#..........#',
  '##........##',
  '###......###',
  '############',
]
const T_LAKE = [
  '############',
  '############',
  '............',
  '............',
  '............',
  '#~~~~~~~~~~#',
  '#~~~~~~~~~~#',
  '##~~~~~~~~##',
  '###~~~~~~###',
  '############',
]
const T_SHAFT = [
  '####....####',
  '####....####',
  '####....####',
  '####....####',
  '............',
  '............',
  '####....####',
  '####....####',
  '####....####',
  '####....####',
]
const T_PILLARS = [
  '############',
  '#..........#',
  '#..##..##..#',
  '#..##..##..#',
  '............',
  '............',
  '#..##..##..#',
  '#..##..##..#',
  '#..........#',
  '############',
]
const T_VEINS = [
  '############',
  '#***####***#',
  '##**#**#**##',
  '#####**#####',
  '............',
  '............',
  '##**####**##',
  '#**##**##**#',
  '#####**#####',
  '############',
]
const T_PLATFORMS = [
  '############',
  '#..........#',
  '#===....===#',
  '#..........#',
  '............',
  '............',
  '#...====...#',
  '#..........#',
  '#===....===#',
  '############',
]
const T_SANDPIT = [
  '############',
  '###%%%%%####',
  '##%%%%%%%###',
  '#..%%%%%...#',
  '............',
  '............',
  '#....%%%...#',
  '##..%%%%%..#',
  '###%%%%%%###',
  '############',
]
// 模板与权重(竖井列强制用 T_SHAFT,不参与随机)
const TEMPLATE_POOL = [
  [T_CORRIDOR, 2], [T_CAVERN, 2], [T_LAKE, 1.2], [T_PILLARS, 1.5],
  [T_VEINS, 1.6], [T_PLATFORMS, 1.5], [T_SANDPIT, 1],
]
function pickTemplate() {
  let total = 0
  for (const [, w] of TEMPLATE_POOL) total += w
  let r = Math.random() * total
  for (const [t, w] of TEMPLATE_POOL) {
    r -= w
    if (r <= 0) return t
  }
  return T_CAVERN
}

/**
 * ── 阶段B:PNG 瓦片资产管线 ──
 * 地图块来自 public/res/pixel-tiles/tileset.png(10 块 48×40 横排),
 * 用 Aseprite/AI 画图工具直接重画即可换地图,颜色→材质映射见下表(严格匹配):
 * 白=保留墙 黑=空气 #3a6fd8=水 #6b5a20=油 #ff5a10=熔岩 #c9a86a=沙
 * #34343a=煤(缓燃不爆;火药只装在桶里) #ffd054=金 #7a5230=木 #94cae8=冰 #588c30=苔 #705034=土
 * 标记像素(P2,Noita wang_scripts):#ff00ff=火把 #ff0080=敌锚 #00ff80=陶罐 #00ffff=吊灯
 * 生成器:scripts/gen-pixel-tiles.mjs;约定:16~27 行必须可通行,竖井块 16~31 列贯通。
 * PNG 加载失败时回退上面的 ASCII 模板,demo 永远可跑。
 */
const PNG_MAT = {
  0x000000: -1, // 空气(挖空)
  0xff00ff: -2, // 火把标记
  0xff0080: -3, // 敌人锚点(P2:位置作者画,出不出/出什么运行时按分区概率定)
  0x00ff80: -4, // 陶罐(随机材质填充,Noita color_material)
  0x00ffff: -5, // 吊灯(顶链+灯火)
  0xff8000: -6, // P3 color_material 槽(布景实例化时整景统一掷骰换真材质)
  0xc0ffee: -7, // 秘室槽(GEN-RULES §六):生成后逐连通区掷骰——主路上=开,其余 50/50 开/封
  0x3a6fd8: M_WATER, 0x6b5a20: M_OIL, 0xff5a10: M_LAVA, 0xc9a86a: M_SAND,
  0x34343a: M_COAL, 0xffd054: M_GOLD, 0x7a5230: M_WOOD, 0x94cae8: M_ICE,
  0x588c30: M_MOSS, 0x705034: M_DIRT, 0x8a9a90: M_STONE, 0xa41014: M_BLOOD,
}
// P2 微观标记(Noita wang_scripts.csv 思路):瓦片入世时收集标记,regen 末统一落地
const wangMarks = []   // {x,y,t}(世界坐标)
const mobSpawnPts = [] // 敌人锚点 {x,y,done}:入镜才生成(Noita 懒生成,防全图怪齐聚)
// 占据空腔的填充材质(先挖空后填);其余(煤/金/冰/土)是墙内矿脉
const FILL_IN_AIR = new Set([M_WATER, M_OIL, M_LAVA, M_SAND, M_WOOD, M_MOSS])
// 与 tileset.png 顺序一一对应;w=权重(0=仅竖井列强制用),minRow=只出现在深层
const PNG_MANIFEST = [
  { name: 'corridor', w: 2 }, { name: 'cavern', w: 2 }, { name: 'lake', w: 1.2 }, { name: 'shaft', w: 0 },
  { name: 'pillars', w: 1.5 }, { name: 'veins', w: 1.6 }, { name: 'platforms', w: 1.5 }, { name: 'sandpit', w: 1 },
  { name: 'ruins', w: 0.9 }, { name: 'lavaden', w: 0.9, minRow: 3 },
]
const PNG_SHAFT = 3
let pngTiles = null // [{shape:Uint8Array(48*40) 1=挖空, fills:[[x,y,mat]..], marks:[[x,y]..]}]
async function loadPngPixels(name) {
  const img = new Image()
  img.src = `${import.meta.env.BASE_URL}res/pixel-tiles/${name}`
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const cx = c.getContext('2d')
  cx.drawImage(img, 0, 0)
  return { data: cx.getImageData(0, 0, img.width, img.height).data, w: img.width }
}
/** 把横排条带按颜色→材质映射切成瓦片(tw×th,任意块数) */
function parseTileStrip(data, imgW, tw, th) {
  const count = (imgW / tw) | 0
  const tiles = []
  for (let t = 0; t < count; t++) {
    const shape = new Uint8Array(tw * th)
    const fills = []
    const marks = []
    const coffee = []
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const o = (y * imgW + t * tw + x) * 4
        const m = PNG_MAT[(data[o] << 16) | (data[o + 1] << 8) | data[o + 2]]
        if (m === undefined) continue // 白/未知色 = 保留墙
        if (m === -1) shape[y * tw + x] = 1
        else if (m === -7) coffee.push([x, y]) // 秘室槽:先当墙,寻路后再掷骰
        else if (m === -6) fills.push([x, y, -6]) // color_material 槽(只在布景里出现)
        else if (m < -1) { shape[y * tw + x] = 1; marks.push([x, y, m]) } // 标记像素:挖空+记类型
        else {
          fills.push([x, y, m])
          if (FILL_IN_AIR.has(m)) shape[y * tw + x] = 1
        }
      }
    }
    tiles.push({ shape, fills, marks, coffee })
  }
  return tiles
}
async function loadTileset() {
  try {
    const { data, w } = await loadPngPixels('tileset.png')
    pngTiles = parseTileStrip(data, w, TILE_W, TILE_H)
  } catch {
    pngTiles = null // 回退 ASCII 模板
  }
}
// ── P3 中观布景池(Noita Pixel Scenes):手绘感 setpiece 按稀有度盖章,color_material 随机化 ──
const SCENE_W = 48, SCENE_H = 36
let sceneTiles = null // 12 块 = 6 景 × 2 变体,结构同 parseTileStrip
async function loadScenes() {
  try {
    const { data, w } = await loadPngPixels('tileset-scenes.png')
    sceneTiles = parseTileStrip(data, w, SCENE_W, SCENE_H)
  } catch {
    sceneTiles = null // 无布景照样开局
  }
}
/** 布景盖章:白=不动 黑=修腔 材质=写入 SLOT=整景统一材质 标记=入 P2 管线 */
function stampScenes() {
  lastRegen.scenes = 0
  if (!sceneTiles || !sceneTiles.length) return
  const ugBot = UG_Y0 + UG_ROWS * HB_S
  const placed = []
  const want = 3 + ((Math.random() * 2) | 0)
  const CMAT = [[M_OIL, 30], [M_WATER, 22], [M_COAL, 18], [M_GOLD, 15], [M_BLOOD, 15]] // 整景槽不掷火药:一景火药=一颗全景炸弹,任何流窜火星都会把布景连人带房掀掉
  for (let tries = 0; tries < 600 && placed.length < want; tries++) {
    const t = sceneTiles[(Math.random() * sceneTiles.length) | 0]
    const x0 = 16 + ((Math.random() * (SW - SCENE_W - 32)) | 0)
    const y0 = UG_Y0 + 20 + ((Math.random() * (ugBot - UG_Y0 - SCENE_H - 44)) | 0)
    if (placed.some((p) => Math.abs(p[0] - x0) < 96 && Math.abs(p[1] - y0) < 64)) continue // 布景间距
    // 宿主腔检测:中带开放率 ≥45%(布景是"腔内家具",不能硬砸进实心岩)
    let open = 0, tot = 0
    for (let y = y0 + 8; y < y0 + 28; y += 2) for (let x = x0 + 6; x < x0 + 42; x += 2) {
      tot++
      if (grid[idx(x, y)] === M_EMPTY) open++
    }
    if (open / tot < 0.45) continue
    // 底部支撑:布景石基下方过半列是固体,否则整景悬空会被崩塌系统拆家
    let sup = 0
    for (let x = x0 + 8; x < x0 + 40; x++) if (IS_SOLID[grid[idx(x, y0 + SCENE_H)]]) sup++
    if (sup < 17) continue
    let r = Math.random() * 100, fillMat = M_OIL // color_material:整景一次掷骰
    for (const [m, w] of CMAT) { r -= w; if (r <= 0) { fillMat = m; break } }
    for (let y = 0; y < SCENE_H; y++) for (let x = 0; x < SCENE_W; x++) {
      if (t.shape[y * SCENE_W + x]) grid[idx(x0 + x, y0 + y)] = M_EMPTY
    }
    for (const [fx, fy, fm] of t.fills) grid[idx(x0 + fx, y0 + fy)] = fm === -6 ? fillMat : fm
    for (const [mx, my, mt] of t.marks) {
      if (mt === -2) torches.push({ x: x0 + mx, y: y0 + my })
      else wangMarks.push({ x: x0 + mx, y: y0 + my, t: mt })
    }
    placed.push([x0, y0])
  }
  lastRegen.scenes = placed.length
  lastRegen.scenesAt = placed
}

/**
 * ── 阶段C:真 Herringbone Wang(移植 stb_herringbone_wang_tile.h) ──
 * H 砖 104×52 / V 砖 52×104 人字形错缝拼接,彻底消除方格网格感。
 * 资产:tileset-hb-h.png / tileset-hb-v.png(convert-coalmine.mjs 从原版无损模板转换,72+72 块)。
 * 两套拼接模式:
 *  a) corner 模式(优先):tileset-hb-meta.json 携带每块砖的真角色约束 a..f(stbhw corner
 *     模板枚举序推得,Noita 原版即此模式)。预填顶点色网格→精确匹配→接缝零失配。
 *  b) 边色推导(回退):无 meta 时从砖边界像素推导六边开口(中段采样,≥半数可通行=1);
 *     权重 = 1.25^开口数(偏向连通)。AI 重画的无 meta 瓦片仍零配置生效。
 * 含熔岩的砖自动限深层(row≥3)。加载失败回退阶段B网格拼接 → 再回退 ASCII,demo 永远可跑。
 */
// 短边长(stbhw short_side_len)。GEN-RULES §二:原版 1 wang px = 10 世界 px(TILE_PX=10,玩家 ~15 px 高),
// 模板 s=13 → 130 px 砖,最窄通道 2 格=20 px≈1.3 人高,1 格缝也能钻。我们玩家 9 px 高 → 10×9/15=6× → 78。
// (旧 4×=52 时 1 格=4 px<玩家宽,所有 1 格缝是死路、2 格通道刚一人高——"挤、乱"的根源)
const HB_S = 78
const UG_Y0 = 128    // 地下区顶(地表最低 ~124)
const UG_ROWS = 6    // 地下 6 层 × 78px = 468,到 y=596,再往下是熔岩海
const UG_H = UG_ROWS * HB_S
const WANG = 6       // 1 个模板像素 = 6 世界像素(入口矩形/秘室等按模板格换算用)

// ── P1 宏观分区(Noita biome_map.png 思路:区域拓扑是"手绘"的,算法只填充区域内部) ──
// 16 列 × 9 行,格子尺寸随世界自适应(ZW×ZH)。纵向进度:浅矿→深矿→宝库→熔岩海;横向支线:冰窟(西,接冰川地表)/油田(东,接油田地表)。
// I=冰窟 M=矿脉 O=油田 D=深矿 V=黄金宝库 L=熔岩海
const ZONE_MAP = [
  'IIIIMMMMMMMMOOOO',
  'IIIIMMMMMMMMOOOO',
  'IIMMMMMMMMMMMMOO',
  'MMMMMMDDDDMMMMMM',
  'MMDDDDDDDDDDDDMM',
  'DDDDDDDDDDDDDDDD',
  'DDDDVVVVVVVVDDDD',
  'DDVVVVVVVVVVVVDD',
  'LLLLLLLLLLLLLLLL',
]
const ZONE_ID = { I: 1, M: 2, O: 3, D: 4, V: 5, L: 6 }
const ZONE_NAMES = ['地表', '冰窟', '矿脉', '油田', '深矿', '黄金宝库', '熔岩海', '圣所']
const ZONE_DIM = [1, 1, 1, 1, 0.72, 0.88, 1, 1.06] // 分区环境光系数(深矿黑,宝库微暗,圣所亮)
const ZONE_MOBS = [ // 分区怪表(Noita 每群系有自己的敌人生态)
  ['fighter', 'oil', 'blood', 'blood', 'caster'],       // 地表
  ['caster', 'blood', 'blood', 'fighter'],              // 冰窟
  ['blood', 'blood', 'fighter', 'oil'],                 // 矿脉
  ['oil', 'oil', 'caster', 'blood'],                    // 油田
  ['fighter', 'fighter', 'caster', 'blood'],            // 深矿
  ['fighter', 'caster', 'fighter'],                     // 黄金宝库
  ['oil', 'caster'],                                    // 熔岩海
]
const zoneGrid = new Uint8Array(16 * 9)
for (let r = 0; r < 9; r++) for (let c = 0; c < 16; c++) zoneGrid[r * 16 + c] = ZONE_ID[ZONE_MAP[r][c]]
const ZW = SW / 16, ZH = UG_H / 9 // 分区格尺寸(60×52)
const sancts = [] // 圣所休息室 {x0,y0,x1,y1}(层间回血点,Noita 圣山节奏)
function zoneAt(x, y) {
  if (y < UG_Y0) return 0
  for (const s of sancts) if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) return 7
  return zoneGrid[Math.min(8, ((y - UG_Y0) / ZH) | 0) * 16 + Math.max(0, Math.min(15, (x / ZW) | 0))]
}
let zoneCur = -1, zoneBannerT = 0, zoneBannerName = ''
// ── P4 群系修饰符(Noita biome modifier:按局随机附加全局规则,开局横幅告知) ──
const WORLD_MODS = [
  { id: 'none', w: 34 },
  { id: 'humid', name: '潮湿', desc: '火焰难以蔓延', w: 22 },
  { id: 'hot', name: '炎热', desc: '油会自燃', w: 22 },
  { id: 'dark', name: '黑暗', desc: '洞窟深不见底', w: 22 },
]
let worldMod = 'none'
let hbTiles = null   // { h:[tile], v:[tile] },tile additionally: edges[6] / w / minRow / corner[6]
let hbMeta = null    // corner 模式元数据 { s, numColor:[4], h/v: [[a..f]] };null=回退边色推导
/** 从砖边界像素推导 stbhw 六边色,槽位顺序与 hbGenerate 的约束槽严格对应:
 *  H 砖: a上左 b上右 c左 d右 e下左 f下右;V 砖: a上 b左上 c右上 d左下 e右下 f下 */
function hbDeriveEdges(t, isV) {
  const tw = isV ? HB_S : HB_S * 2
  const th = isV ? HB_S * 2 : HB_S
  // 采样段中部(按 HB_S 比例,勿硬编码——HB_S 从 40 换 22 时硬编码采样越界踩过坑)
  const sLo = Math.floor(HB_S * 0.36), sHi = Math.floor(HB_S * 0.63)
  const sNeed = ((sHi - sLo + 1) / 2) | 0
  const openH = (x0, y) => {
    let n = 0
    for (let x = x0 + sLo; x <= x0 + sHi; x++) if (t.shape[y * tw + x]) n++
    return n >= sNeed ? 1 : 0
  }
  const openV = (x, y0) => {
    let n = 0
    for (let y = y0 + sLo; y <= y0 + sHi; y++) if (t.shape[y * tw + x]) n++
    return n >= sNeed ? 1 : 0
  }
  t.edges = isV
    ? [openH(0, 0), openV(0, 0), openV(tw - 1, 0), openV(0, HB_S), openV(tw - 1, HB_S), openH(0, th - 1)]
    : [openH(0, 0), openH(HB_S, 0), openV(0, 0), openV(tw - 1, 0), openH(0, th - 1), openH(HB_S, th - 1)]
  let nOpen = 0
  for (const e of t.edges) nOpen += e
  t.w = Math.pow(1.25, nOpen)
  if (t.fills.some(([, , m]) => m === M_LAVA)) t.minRow = (UG_ROWS * 0.33) | 0 // 岩浆砖只出深层
}
async function loadHBTileset() {
  try {
    const [h, v] = await Promise.all([loadPngPixels('tileset-hb-h.png'), loadPngPixels('tileset-hb-v.png')])
    const hT = parseTileStrip(h.data, h.w, HB_S * 2, HB_S)
    const vT = parseTileStrip(v.data, v.w, HB_S, HB_S * 2)
    for (const t of hT) hbDeriveEdges(t, false)
    for (const t of vT) hbDeriveEdges(t, true)
    hbTiles = hT.length && vT.length ? { h: hT, v: vT } : null
    hbMeta = null
    try { // corner 真约束元数据(可选):有它拼接零失配,没它回退边色推导
      const meta = await (await fetch(`${import.meta.env.BASE_URL}res/pixel-tiles/tileset-hb-meta.json`)).json()
      if (meta.mode === 'corner' && meta.h?.length === hT.length && meta.v?.length === vT.length) {
        hT.forEach((t, i) => { t.corner = meta.h[i] })
        vT.forEach((t, i) => { t.corner = meta.v[i] })
        hbMeta = meta
      }
    } catch { hbMeta = null }
  } catch {
    hbTiles = null // 回退阶段B网格拼接
  }
}
/** stbhw__choose_tile 移植:满足已定边色约束的砖里按权重随机;无解时取失配最少的(flood-fill 兜底) */
function hbChoose(list, slots, row) {
  let bestMiss = 7
  let total = 0
  const cand = []
  for (const t of list) {
    if (t.minRow !== undefined && row < t.minRow) continue
    let miss = 0
    for (let k = 0; k < 6; k++) {
      const c = slots[k][0][slots[k][1]][slots[k][2]]
      if (c >= 0 && c !== t.edges[k]) miss++
    }
    if (miss > bestMiss) continue
    if (miss < bestMiss) { bestMiss = miss; cand.length = 0; total = 0 }
    cand.push(t)
    total += t.w
  }
  let r = Math.random() * total
  let pick = cand[cand.length - 1]
  for (const t of cand) { r -= t.w; if (r <= 0) { pick = t; break } }
  for (let k = 0; k < 6; k++) slots[k][0][slots[k][1]][slots[k][2]] = pick.edges[k]
  return pick
}
/** 把一块砖盖进地下区(相对坐标,越界裁剪——stbhw 同款,砖悬出边界属正常) */
function hbStampTile(t, xpos, ypos, isV, pngFills) {
  const tw = isV ? HB_S : HB_S * 2
  const th = isV ? HB_S * 2 : HB_S
  const yMax = UG_ROWS * HB_S
  for (let y = 0; y < th; y++) {
    const wy = ypos + y
    if (wy < 0 || wy >= yMax) continue
    for (let x = 0; x < tw; x++) {
      const wx = xpos + x
      if (wx < 1 || wx >= SW - 1) continue
      if (t.shape[y * tw + x]) grid[idx(wx, UG_Y0 + wy)] = M_EMPTY
    }
  }
  for (const [fx, fy, fm] of t.fills) {
    const wx = xpos + fx
    const wy = ypos + fy
    if (wx < 1 || wx >= SW - 1 || wy < 0 || wy >= yMax) continue
    pngFills.push([wx, UG_Y0 + wy, fm, (wy / HB_S) | 0])
  }
  for (const [mx, my, mt] of t.marks) {
    const wx = xpos + mx
    const wy = ypos + my
    if (wx < 2 || wx >= SW - 2 || wy < 2 || wy >= yMax - 2) continue
    if (mt === -2 || mt === undefined) torches.push({ x: wx, y: UG_Y0 + wy })
    else wangMarks.push({ x: wx, y: UG_Y0 + wy, t: mt })
  }
  for (const [cx, cy] of t.coffee) {
    const wx = xpos + cx
    const wy = ypos + cy
    if (wx < 1 || wx >= SW - 1 || wy < 0 || wy >= yMax) continue
    coffeeMask[idx(wx, UG_Y0 + wy)] = 1 // 像素本身保持 fillGround 的墙,等 resolveCoffee
  }
}
const coffeeMask = new Uint8Array(N) // 1=秘室槽像素(GEN-RULES §六 c0ffee)
/** GEN-RULES §五:顶→底 BFS 寻路。起点=入口开口底部,终点=地下区最后一行任意开放格。
 *  开放=空气/气体/秘室槽(原版 OpenAlt 可走);液体和一切固体算墙(原版只有黑与 c0ffee 可走)。
 *  返回路径像素索引数组(用于 clearPath 开通路上的秘室),不通返回 null。 */
function ugFindPath(startXs) {
  const y0 = UG_Y0
  const y1 = UG_Y0 + UG_H - 1
  const open = (i) => coffeeMask[i] || grid[i] === M_EMPTY || IS_GAS[grid[i]]
  const parent = new Int32Array(N).fill(-1)
  const q = []
  for (const sx of startXs) {
    for (let y = y0; y < y0 + HB_S; y++) { // 入口下方第一个开放格作起点
      const i = idx(sx, y)
      if (open(i)) { if (parent[i] === -1) { parent[i] = i; q.push(i) } break }
    }
  }
  let head = 0
  while (head < q.length) {
    const i = q[head++]
    const y = (i / SW) | 0, x = i - y * SW
    if (y === y1) { // 回溯路径
      const path = []
      for (let k = i; ; k = parent[k]) { path.push(k); if (parent[k] === k) break }
      return path
    }
    const nb = [i + SW, i - 1, i + 1, i - SW]
    for (let d = 0; d < 4; d++) {
      const j = nb[d]
      const ny = (j / SW) | 0
      if (ny < y0 || ny > y1) continue
      if (d === 1 && x <= 1) continue
      if (d === 2 && x >= SW - 2) continue
      if (parent[j] !== -1 || !open(j)) continue
      parent[j] = i
      q.push(j)
    }
  }
  return null
}
/** GEN-RULES §六:秘室槽落地。路径踩到的连通区→开;其余每区 50/50 开或封(封=砖体材质土) */
function resolveCoffee(path) {
  const onPath = new Uint8Array(N)
  if (path) for (const i of path) if (coffeeMask[i]) onPath[i] = 1
  const seen = new Uint8Array(N)
  const y0 = UG_Y0, y1 = UG_Y0 + UG_H
  let nOpen = 0, nShut = 0
  for (let y = y0; y < y1; y++) for (let x = 1; x < SW - 1; x++) {
    const s = idx(x, y)
    if (!coffeeMask[s] || seen[s]) continue
    const region = [s]
    seen[s] = 1
    let hit = 0
    for (let h = 0; h < region.length; h++) {
      const i = region[h]
      if (onPath[i]) hit = 1
      for (const j of [i + SW, i - 1, i + 1, i - SW]) {
        if (j < 0 || j >= N || seen[j] || !coffeeMask[j]) continue
        seen[j] = 1
        region.push(j)
      }
    }
    const openIt = hit || Math.random() < 0.5
    if (openIt) nOpen++; else nShut++
    for (const i of region) grid[i] = openIt ? M_EMPTY : M_DIRT
  }
  return { nOpen, nShut }
}
/** stbhw_generate_image corner 模式移植(Noita 原版拼接方式):
 *  顶点色网格 c_color[j][i](角类型 p=(i-j+1)&3,各类型色数 numColor[p]),先随机预填全部顶点,
 *  再做 3×2 重复消除,最后每块砖按 6 个顶点色精确匹配砖池——模板枚举保证每种组合必有变体,接缝零失配 */
function hbGenerateCorner(pngFills) {
  const s = HB_S
  const hPx = UG_ROWS * s
  const ROWS = UG_ROWS + 8, COLS = ((SW / s) | 0) + 10
  const cc = hbMeta.numColor
  const ccol = []
  for (let r = 0; r < ROWS; r++) ccol.push(new Int8Array(COLS))
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) ccol[j][i] = (Math.random() * cc[(i - j + 1) & 3]) | 0
  // 重复消除(stbhw 同款):相邻 3×2 顶点对角全等 → 换中心顶点色,避免肉眼可见的平铺感
  const match = (i, j) => ccol[j][i] === ccol[j + 1][i + 1]
  for (let j = 0; j < ROWS - 3; j++) for (let i = 0; i < COLS - 3; i++) {
    if (match(i, j) && match(i, j + 1) && match(i, j + 2) && match(i + 1, j) && match(i + 1, j + 1) && match(i + 1, j + 2)) {
      const p = ((i + 1) - (j + 1) + 1) & 3
      if (cc[p] > 1) ccol[j + 1][i + 1] = (ccol[j + 1][i + 1] + 1 + ((Math.random() * (cc[p] - 1)) | 0)) % cc[p]
    }
    if (match(i, j) && match(i + 1, j) && match(i + 2, j) && match(i, j + 1) && match(i + 1, j + 1) && match(i + 2, j + 1)) {
      const p = ((i + 2) - (j + 1) + 1) & 3
      if (cc[p] > 1) ccol[j + 1][i + 2] = (ccol[j + 1][i + 2] + 1 + ((Math.random() * (cc[p] - 1)) | 0)) % cc[p]
    }
  }
  const pick = (list, a, b, c, d2, e, f, row, relaxRow) => {
    const cand = []
    for (const t of list) {
      const k = t.corner
      if (k[0] !== a || k[1] !== b || k[2] !== c || k[3] !== d2 || k[4] !== e || k[5] !== f) continue
      if (!relaxRow && t.minRow !== undefined && row < t.minRow) continue
      cand.push(t)
    }
    if (!cand.length) return relaxRow ? null : pick(list, a, b, c, d2, e, f, row, true) // 限深滤空则放开
    return cand[(Math.random() * cand.length) | 0] // GEN-RULES §三:变体间均匀随机,不按开口数加权
  }
  for (let j = -1; j * s < hPx; j++) {
    const ypos = j * s
    const phase = j & 3
    for (let i = phase === 0 ? 0 : phase - 4; ; i += 4) {
      const xpos = i * s
      if (xpos >= SW) break
      if (xpos + s * 2 >= 0 && ypos >= 0) { // 横砖:上排 3 顶点 (j+2, i+2..4) + 下排 3 顶点 (j+3, i+2..4)
        const t = pick(hbTiles.h, ccol[j + 2][i + 2], ccol[j + 2][i + 3], ccol[j + 2][i + 4],
          ccol[j + 3][i + 2], ccol[j + 3][i + 3], ccol[j + 3][i + 4], Math.max(0, j), false)
        if (t) hbStampTile(t, xpos, ypos, false, pngFills)
      }
      const xv = xpos + s * 3 // 竖砖:左列 3 顶点 (j+2..4, i+5) + 右列 3 顶点 (j+2..4, i+6)
      if (xv < SW && xv + s >= 0) {
        const t = pick(hbTiles.v, ccol[j + 2][i + 5], ccol[j + 3][i + 5], ccol[j + 4][i + 5],
          ccol[j + 2][i + 6], ccol[j + 3][i + 6], ccol[j + 4][i + 6], Math.max(0, j), false)
        if (t) hbStampTile(t, xv, ypos, true, pngFills)
      }
    }
  }
}
/** stbhw_generate_image 边缘色模式移植(无 corner meta 时的回退):h_color/v_color 两张边色表 + 人字形相位排布。
 *  相位规律:第 j 行的 H 砖左端在 i ≡ j (mod 4) 的格列,V 砖顶端在 i+3 列跨 j~j+1 两行。 */
function hbGenerate(pngFills) {
  if (hbMeta) return hbGenerateCorner(pngFills)
  const s = HB_S
  const hPx = UG_ROWS * s
  const ROWS = UG_ROWS + 8, COLS = ((SW / HB_S) | 0) + 10 // 含 stbhw 的索引偏移余量(必须随 HB_S/UG_ROWS 动态算)
  const hcol = [], vcol = []
  for (let r = 0; r < ROWS; r++) {
    hcol.push(new Int8Array(COLS).fill(-1))
    vcol.push(new Int8Array(COLS).fill(-1))
  }
  for (let j = -1; j * s < hPx; j++) {
    const ypos = j * s
    const phase = j & 3
    for (let i = phase === 0 ? 0 : phase - 4; ; i += 4) {
      const xpos = i * s
      if (xpos >= SW) break
      if (xpos + s * 2 >= 0 && ypos >= 0) { // 横砖(占 (i,j)(i+1,j) 两格)
        const t = hbChoose(hbTiles.h, [
          [hcol, j + 2, i + 2], [hcol, j + 2, i + 3],
          [vcol, j + 2, i + 2], [vcol, j + 2, i + 4],
          [hcol, j + 3, i + 2], [hcol, j + 3, i + 3],
        ], Math.max(0, j))
        hbStampTile(t, xpos, ypos, false, pngFills)
      }
      const xv = xpos + s * 3 // 竖砖(占 (i+3,j)(i+3,j+1) 两格)
      if (xv < SW) {
        const t = hbChoose(hbTiles.v, [
          [hcol, j + 2, i + 5],
          [vcol, j + 2, i + 5], [vcol, j + 2, i + 6],
          [vcol, j + 3, i + 5], [vcol, j + 3, i + 6],
          [hcol, j + 4, i + 5],
        ], Math.max(0, j))
        hbStampTile(t, xv, ypos, true, pngFills)
      }
    }
  }
}
// 洞壁去毛刺:拔掉 1px 孤齿(锯齿感元凶)。只动自然地形材质——木结构/油桶的 1px 壳不能碰
const NATURAL = new Uint8Array(NMAT)
NATURAL[M_STONE] = NATURAL[M_DIRT] = NATURAL[M_ICE] = 1
function despeckle(x0, y0, x1, y1, passes = 2) {
  for (let p = 0; p < passes; p++) {
    for (let y = Math.max(1, y0 | 0); y <= Math.min(SH - 2, y1 | 0); y++) {
      for (let x = Math.max(1, x0 | 0); x <= Math.min(SW - 2, x1 | 0); x++) {
        const i = idx(x, y)
        if (!NATURAL[grid[i]]) continue
        let solid = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          if (IS_SOLID[grid[idx(x + dx, y + dy)]]) solid++
        }
        if (solid <= 3) grid[i] = M_EMPTY
      }
    }
  }
}
/** 地下区 flood-fill 连通性:从入口竖井 BFS,可达开放格占比(Noita 同款校验,不达标 reroll) */
function ugConnectivity(startXs) {
  const y0 = UG_Y0
  const y1 = UG_Y0 + UG_ROWS * HB_S
  let open = 0
  for (let y = y0; y < y1; y++) for (let x = 1; x < SW - 1; x++) if (!IS_SOLID[grid[idx(x, y)]]) open++
  if (!open) return 0
  const seen = new Uint8Array(N)
  const q = []
  for (const sx of startXs) {
    for (let y = y0; y < y0 + 40; y++) { // 井底往下找第一个开放格作起点
      const i = idx(sx, y)
      if (!IS_SOLID[grid[i]]) { if (!seen[i]) { seen[i] = 1; q.push(sx, y) } break }
    }
  }
  let reach = 0
  let head = 0
  while (head < q.length) {
    const x = q[head++], y = q[head++]
    reach++
    if (x > 1 && !seen[idx(x - 1, y)] && !IS_SOLID[grid[idx(x - 1, y)]]) { seen[idx(x - 1, y)] = 1; q.push(x - 1, y) }
    if (x < SW - 2 && !seen[idx(x + 1, y)] && !IS_SOLID[grid[idx(x + 1, y)]]) { seen[idx(x + 1, y)] = 1; q.push(x + 1, y) }
    if (y > y0 && !seen[idx(x, y - 1)] && !IS_SOLID[grid[idx(x, y - 1)]]) { seen[idx(x, y - 1)] = 1; q.push(x, y - 1) }
    if (y < y1 - 1 && !seen[idx(x, y + 1)] && !IS_SOLID[grid[idx(x, y + 1)]]) { seen[idx(x, y + 1)] = 1; q.push(x, y + 1) }
  }
  return reach / open
}
let lastRegen = { conn: 0, attempts: 0, hb: false } // 调试:__pixel.hbInfo()
function pickPngTile(row) {
  let total = 0
  for (const mf of PNG_MANIFEST) total += mf.minRow !== undefined && row < mf.minRow ? 0 : mf.w
  let r = Math.random() * total
  for (let i = 0; i < PNG_MANIFEST.length; i++) {
    const mf = PNG_MANIFEST[i]
    const w = mf.minRow !== undefined && row < mf.minRow ? 0 : mf.w
    r -= w
    if (r <= 0 && w > 0) return i
  }
  return 1
}

/** P2 标记道具:陶罐——木壳 5×5,内装随机材质(Noita color_material:同一位置每局装的都不同) */
function placeVessel(x0, y) {
  // 标记点常贴墙/悬在坑上,横向试几个落点(0 ±2 ±4 ±6)
  let x = -1, fy = 0
  outer: for (const dx of [0, -2, 2, -4, 4, -6, 6, -8, 8]) {
    const tx = x0 + dx
    let ty = y - 5 // 起点抬高:标记常卡在腔缘 1px 气穴,从上方重新落
    while (ty < y && inB(tx, ty) && IS_SOLID[grid[idx(tx, ty)]]) ty++ // 起点陷墙先下探到空气
    for (let k = 0; k < 18 && inB(tx, ty + 1) && !IS_SOLID[grid[idx(tx, ty + 1)]]; k++) ty++ // 落到地板
    if (!inB(tx, ty + 1) || !IS_SOLID[grid[idx(tx, ty + 1)]]) continue
    for (let yy = ty - 4; yy <= ty; yy++) for (let xx = tx - 2; xx <= tx + 2; xx++) {
      if (!inB(xx, yy) || IS_SOLID[grid[idx(xx, yy)]]) continue outer // 空间不够换落点
    }
    x = tx; fy = ty
    break
  }
  if (x < 0) return false
  const r = Math.random()
  const fill = r < 0.28 ? M_WATER : r < 0.55 ? M_OIL : r < 0.7 ? M_BLOOD : r < 0.85 ? M_POWDER : M_GOLD
  for (const dx of [-1, 0, 1]) { grid[idx(x + dx, fy - 4)] = M_WOOD; grid[idx(x + dx, fy)] = M_WOOD }
  for (let dy = -3; dy <= -1; dy++) {
    grid[idx(x - 2, fy + dy)] = M_WOOD
    grid[idx(x + 2, fy + dy)] = M_WOOD
    for (const dx of [-1, 0, 1]) grid[idx(x + dx, fy + dy)] = fill
  }
  return true
}
/** P2 标记道具:吊灯——石链垂顶+灯火(链是 1px 可塌方链,打断整灯坠落) */
function placeLamp(x, y) {
  let cy2 = y
  let ok = false
  for (let k = 0; k < 16; k++) {
    if (!inB(x, cy2 - 1)) break
    if (IS_SOLID[grid[idx(x, cy2 - 1)]]) { ok = true; break }
    cy2--
  }
  if (!ok) { torches.push({ x, y }); return } // 找不到顶:退化为普通火把
  const len = 2 + ((Math.random() * 3) | 0)
  for (let k = 0; k < len; k++) grid[idx(x, cy2 + k)] = M_STONE // 石链(不可燃,火苗烧不断)
  torches.push({ x, y: cy2 + len + 1 }) // 灯火吊在链末
}

/** 生物群系(Noita 式地图多样性):冰川带 / 森林带 / 油田带 + 全域底部熔岩深渊 */
function regen() {
  grid.fill(M_EMPTY)
  aux.fill(0)
  midGrid.fill(0)
  genRidges() // 远景山形每局重掷
  parts.length = 0
  bullets.length = 0
  ebullets.length = 0
  mobs.length = 0
  chunks.length = 0
  collapseDirty = null
  // P4 群系修饰符:每局掷骰,有修饰就开局横幅告知(规则改变必须明说,Noita 同款)
  {
    let tot = 0
    for (const m2 of WORLD_MODS) tot += m2.w
    let r2 = Math.random() * tot
    worldMod = 'none'
    for (const m2 of WORLD_MODS) {
      r2 -= m2.w
      if (r2 <= 0) {
        worldMod = m2.id
        if (m2.name) { zoneBannerT = 2.8; zoneBannerName = `${m2.name} · ${m2.desc}` }
        break
      }
    }
    zoneCur = -1
  }
  // 平滑一维噪声(余弦插值);一切"沿 x 变化的随机"都必须过它——
  // 逐列独立随机会生成交错栅栏齿(Noita 的随机全是空间连续的:噪声曲线/手绘形状)
  const oct = (wl, amp) => {
    const nPts = Math.ceil(SW / wl) + 2
    const vals = []
    for (let i = 0; i < nPts; i++) vals.push((Math.random() * 2 - 1) * amp)
    return (x) => {
      const f = x / wl
      const i0 = f | 0
      const s = (1 - Math.cos((f - i0) * Math.PI)) / 2
      return vals[i0] * (1 - s) + vals[i0 + 1] * s
    }
  }
  // 按 x 分带,边界=连续摆动曲线(旧版逐列 ±0.05 抖动 → 边界 60px 内冰/土列交错成栅栏)
  const bn = oct(52, 0.035)
  const biome = []
  const tArr = new Float32Array(SW)
  for (let x = 0; x < SW; x++) {
    const t = x / SW + bn(x)
    tArr[x] = t
    biome.push(t < 0.33 ? 'ice' : t < 0.66 ? 'forest' : 'oil')
    biomeArr[x] = biome[x] === 'ice' ? 0 : biome[x] === 'forest' ? 1 : 2
  }
  torches.length = 0
  motes.length = 0
  // 5.mp4 f26/f31/f36 标定:Noita 地表是大幅山丘(可视区内落差近半屏)+陡坡深谷,不是平线
  // 起伏尺度=一屏一个:主山体波长(420)必须超过视口宽(VW=320),否则一屏挤好几个山头像波浪线
  const o1 = oct(420, 36)  // 大起伏:主山体(全图 640px 只装 1.5 个波=一山一谷)
  const o1b = oct(170, 14) // 次级山体:山肩/谷中丘(一屏最多半个)
  const o2 = oct(80, 4)    // 中起伏:坡地(高频细节噪声=表面毛刺,Noita 地表曲线是丝滑的,不要 o3)
  const ss = (v) => Math.max(0, Math.min(1, v))
  const hs = []
  for (let x = 0; x < SW; x++) {
    // 群系高度偏置在边界平滑过渡(冰川高原、油田洼地)
    const iceW = ss((SW * 0.33 - x) / 60)
    const oilW = ss((x - SW * 0.66) / 60)
    // 非线性增陡:大偏移按 1.25 次幂放大——山更高谷更深、坡中段变陡(f31 的大落差感)
    let hRaw = o1(x) + o1b(x) + o2(x)
    hRaw = Math.sign(hRaw) * Math.pow(Math.abs(hRaw) / 40, 1.25) * 40
    // 地表带用绝对高度(48~126):UG_Y0=128 起是地下区,SH 加深时地表不能跟着下移
    const h = Math.max(48, Math.min(126, 92 + hRaw - iceW * 12 + oilW * 9))
    hs.push(h | 0)
    surfY[x] = h | 0
  }
  // 全局归一:噪声随机会让某些局整体贴底/贴顶(落差缩水一半),把本局高度带线性拉满 50~124
  // ——保证每局都有 Noita 那种高山深谷(f31 半屏落差),形状不变只是等比拉伸
  {
    let hMin = 999, hMax = -999
    for (const h of hs) { if (h < hMin) hMin = h; if (h > hMax) hMax = h }
    if (hMax - hMin > 4) {
      for (let x = 0; x < SW; x++) {
        const h = (50 + ((hs[x] - hMin) / (hMax - hMin)) * 74) | 0
        hs[x] = h
        surfY[x] = h
      }
    }
    // 坡度钳制:落差可以大,但相邻列高差 ≤3px——归一拉伸会放大坡度,出现玩家爬不上的立壁
    // (地表必须双向可通行!)双向松弛把立壁削成可跳跃攀爬的陡坡,山形只是被磨圆山尖
    for (let pass = 0; pass < 2; pass++) {
      for (let x = 1; x < SW; x++) if (hs[x] < hs[x - 1] - 3) hs[x] = hs[x - 1] - 3
      for (let x = SW - 2; x >= 0; x--) if (hs[x] < hs[x + 1] - 3) hs[x] = hs[x + 1] - 3
    }
    // 表面平滑:3 遍 5 点加权滑动平均——归一/钳制/幂增陡留下的 1~3px 小台阶全部磨掉
    // (Noita 地表是手绘瓦片的丝滑弧线;程序生成必须靠平滑逼出同样质感)
    for (let it = 0; it < 3; it++) {
      const tmp = hs.slice()
      for (let x = 2; x < SW - 2; x++) {
        hs[x] = (tmp[x - 2] + tmp[x - 1] * 2 + tmp[x] * 3 + tmp[x + 1] * 2 + tmp[x + 2]) / 9
      }
    }
    for (let x = 0; x < SW; x++) { hs[x] = Math.round(hs[x]); surfY[x] = hs[x] }
  }
  // 地表分层:草皮(苔)→泥土层→基岩;冰川是冰盖(自然地貌 = 材质分层,不是单一石头)
  // 层厚=平滑噪声(旧版逐列哈希 % → 相邻列厚度独立跳变,层边界成"梳齿");
  // 群系权重渐变:冰盖/土层在边界 ~30px 内渐薄归零,不硬切(噪声函数建一次,重掷时可重复调用)
  const dn = oct(34, 2.5)
  const iN = oct(40, 4)
  const fillGround = () => {
    for (let x = 0; x < SW; x++) {
      const t = tArr[x]
      const wIce = ss((0.33 - t) * 22)
      const wOil = ss((t - 0.66) * 22)
      const dirtDepth = Math.round((7 + dn(x)) * Math.max(1 - wIce - wOil, wOil * 0.45))
      const iceCap = Math.round((17 + iN(x)) * wIce)
      for (let y = hs[x]; y < SH; y++) {
        const d = y - hs[x]
        grid[idx(x, y)] = d < iceCap ? M_ICE : d < iceCap + dirtDepth ? M_DIRT : M_STONE
      }
    }
  }
  // —— 地下:Herringbone Wang 拼接(阶段C);资产缺失时回退阶段B网格 → ASCII ——
  // GEN-RULES §五:拼完做"顶→底能否走通"的 BFS,走不通换种子整张重掷(原版上限 99,我们 30);
  // 不做"可达占比"这类软指标,也不凿救援井——封死的腔是砖作者画的,原版就不打通。
  const TCOLS = (SW / TILE_W) | 0 // 回退网格路径用
  const MAX_ATTEMPTS = hbTiles ? 30 : 5
  let shaftXs = []
  let ugPath = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    fillGround()
    torches.length = 0
    wangMarks.length = 0 // 标记像素随砖收集,reroll 必须清空重来
    coffeeMask.fill(0)
    // 两个入口落点(原版煤矿叠加层顶部正好是两个漏斗口;回退网格路径同时是全深竖井列)
    const shaftCols = []
    while (shaftCols.length < 2) {
      const c = 1 + ((Math.random() * (TCOLS - 2)) | 0)
      if (!shaftCols.includes(c) && Math.abs(c - (shaftCols[0] ?? -9)) >= 4) shaftCols.push(c)
    }
    shaftXs = shaftCols.map((c) => c * TILE_W + 24)
    const special = [] // ASCII 延后填充 {x0,y0,ch,biomeKey,row}
    const pngFills = [] // PNG 延后填充 [ax,ay,mat,row]
    if (hbTiles) {
      hbGenerate(pngFills)
    } else for (let tr = 0, trMax = ((UG_ROWS * HB_S) / TILE_H) | 0; tr < trMax; tr++) { // 回退网格按 40px 瓦片折算行数
      for (let tc = 0; tc < TCOLS; tc++) {
        const bx = tc * TILE_W
        const by = UG_Y0 + tr * TILE_H
        if (pngTiles) {
          // ── PNG 网格路径(阶段B资产管线):逐像素盖章 ──
          const tpl = pngTiles[shaftCols.includes(tc) ? PNG_SHAFT : pickPngTile(tr)] || pngTiles[0]
          for (let y = 0; y < TILE_H; y++) {
            for (let x = 0; x < TILE_W; x++) {
              if (tpl.shape[y * TILE_W + x]) grid[idx(bx + x, by + y)] = M_EMPTY
            }
          }
          for (const [fx, fy, fm] of tpl.fills) pngFills.push([bx + fx, by + fy, fm, tr])
          for (const [mx2, my2] of tpl.marks) torches.push({ x: bx + mx2, y: by + my2 })
          continue
        }
        // ── ASCII 回退路径 ──
        const tpl = shaftCols.includes(tc) ? T_SHAFT : pickTemplate()
        for (let ty = 0; ty < 10; ty++) {
          for (let tx = 0; tx < 12; tx++) {
            const ch = tpl[ty][tx]
            if (ch === '#') continue // 墙 = 保留预填的石头
            const x0 = bx + tx * 4
            const y0 = by + ty * 4
            if (ch === '.') {
              for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) grid[idx(x, y)] = M_EMPTY
            } else {
              // ~ * % = 先挖空,CA 平滑后再按群系×深度填充(避免被平滑吃掉)
              for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) grid[idx(x, y)] = ch === '*' ? M_STONE : M_EMPTY
              special.push({ x0, y0, ch, biomeKey: biome[Math.min(SW - 1, bx + 24)], row: tr })
            }
          }
        }
      }
    }
    // CA 平滑两遍:消瓦片格子感,洞壁长出有机形状(只动 石/空)
    // Noita 手绘瓦片(hbTiles)不平滑——形状是作者画的,CA 会磨掉走廊细节;只跑 despeckle 缝拼缝
    {
      const tmp = new Uint8Array(N)
      for (let pass = 0; pass < (hbTiles ? 0 : 2); pass++) {
        tmp.set(grid)
        for (let y = UG_Y0 + 1; y < UG_Y0 + UG_ROWS * HB_S - 1; y++) {
          for (let x = 1; x < SW - 1; x++) {
            const i = idx(x, y)
            const m = tmp[i]
            if (m !== M_EMPTY && m !== M_STONE) continue
            let solid = 0
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue
              const n = tmp[idx(x + dx, y + dy)]
              if (n !== M_EMPTY && !IS_GAS[n] && !IS_LIQUID[n]) solid++
            }
            if (m === M_EMPTY && solid >= 6) grid[i] = M_STONE
            else if (m === M_STONE && solid <= 2) grid[i] = M_EMPTY
          }
        }
      }
      // 去齿遍(仅程序砖):多数表决拔掉洞壁上的 1px 孤齿;手绘砖一个像素都不动(GEN-RULES:原版无平滑)
      if (!hbTiles) despeckle(1, UG_Y0 + 1, SW - 2, UG_Y0 + UG_ROWS * HB_S - 2, 1)
    }
    // 特殊字符按群系×深度调色填充
    for (const sp of special) {
      for (let y = sp.y0; y < sp.y0 + 4; y++) {
        for (let x = sp.x0; x < sp.x0 + 4; x++) {
          const i = idx(x, y)
          if (sp.ch === '~') {
            // 液池:浅层随群系,深层变熔岩
            if (grid[i] !== M_EMPTY) continue
            grid[i] = sp.row >= 4 ? M_LAVA : sp.biomeKey === 'oil' ? M_OIL : M_WATER
          } else if (sp.ch === '*') {
            // 矿脉:冰川浅层=冰晶,浅层=沙,中层=煤,深层=煤+岩浆点(煤缓燃不爆,火药只装在桶里)
            if (grid[i] !== M_STONE) continue
            if (sp.row < 2) grid[i] = sp.biomeKey === 'ice' ? M_ICE : Math.random() < 0.15 ? M_GOLD : M_SAND
            else if (sp.row < 4) grid[i] = Math.random() < 0.75 ? M_COAL : M_SAND
            else grid[i] = Math.random() < 0.08 ? M_LAVA : Math.random() < 0.1 ? M_GOLD : M_COAL // 深层金矿更肥:风险换收益
          } else if (sp.ch === '%') {
            if (grid[i] === M_EMPTY) grid[i] = M_SAND
          } else if (sp.ch === '=') {
            // 平台:上 2px 木板
            if (y < sp.y0 + 2 && grid[i] === M_EMPTY) grid[i] = M_WOOD
          }
        }
      }
    }
    // PNG 瓦片延后填充(CA 平滑后:空腔类填进空气,矿脉类只换石头)
    for (const [ax, ay, m0, trow] of pngFills) {
      const i = idx(ax, ay)
      let m = m0
      // 深层水变熔岩只给程序砖:手绘砖的水是作者摆的(coalmine 无熔岩),变浆会点着旁边煤脉
      if (m === M_WATER && trow >= 4 && !hbTiles) m = M_LAVA
      if (FILL_IN_AIR.has(m0)) {
        if (grid[i] === M_EMPTY) grid[i] = m
      } else if (grid[i] === M_STONE) grid[i] = m
      // 金簇标记画在空腔(Noita 金块堆在地上):落进空气,金粉自然坠地堆成小金堆
      else if (m0 === M_GOLD && grid[i] === M_EMPTY) grid[i] = M_GOLD
    }
    // ── 板层洞窟雕刻:仅程序生成回退路径用。HB 走 Noita 手绘瓦片,结构是作者设计的,再雕就毁了 ──
    if (!hbTiles) {
      const ugBot = UG_Y0 + UG_ROWS * HB_S
      const nG = 5
      const galY = []
      const wob = oct(90, 6)
      for (let g = 0; g < nG; g++) {
        // 长廊不满宽(70~90%),端头随机——"没打通"的尽头是挖掘的邀请
        const yBase = UG_Y0 + 30 + ((ugBot - UG_Y0 - 58) / nG) * g + Math.random() * 10
        galY.push(yBase)
        const gx0 = 6 + ((Math.random() * SW * 0.13) | 0)
        const gx1 = SW - 6 - ((Math.random() * SW * 0.13) | 0)
        const hh = 7.5 + Math.random() * 3 // 半高→总高 15~21px(战斗舞台口径)
        for (let x = gx0; x <= gx1; x++) {
          const yc = yBase + wob(x + g * 517)
          const h2 = hh * (0.72 + 0.28 * Math.sin(x * 0.045 + g * 2.1)) // 呼吸起伏:忽宽忽窄
          for (let y = Math.floor(yc - h2); y <= Math.ceil(yc + h2); y++) {
            if (y > UG_Y0 + 4 && y < ugBot - 4) grid[idx(x, y)] = M_EMPTY
          }
        }
        // 悬挑平台 2~3 段:石/木各半,把长廊空腔隔出上下层次(f350 的多层板)
        for (let p = 0, np = 2 + ((Math.random() * 2) | 0); p < np; p++) {
          const px = (gx0 + 24 + Math.random() * (gx1 - gx0 - 60)) | 0
          const pw = (16 + Math.random() * 20) | 0
          const py = (yBase + (Math.random() < 0.5 ? -3 : 4)) | 0
          const pm = Math.random() < 0.5 ? M_STONE : M_WOOD
          for (let x = px; x < px + pw && x < SW - 6; x++) {
            for (let dy = 0; dy < 2; dy++) {
              const i2 = idx(x, py + dy)
              if (grid[i2] === M_EMPTY) grid[i2] = pm
            }
          }
        }
      }
      // 竖向断口:层间错位连接(每层间 2~3 个,与上一组错开——直上直下就没有探索)
      let lastXs = []
      for (let g = 0; g < nG - 1; g++) {
        const xs = []
        for (let c = 0, n = 2 + ((Math.random() * 2) | 0); c < n; c++) {
          let bx = 0
          for (let t = 0; t < 24; t++) {
            bx = 40 + Math.random() * (SW - 80)
            if (!xs.some((v) => Math.abs(v - bx) < 70) && !lastXs.some((v) => Math.abs(v - bx) < 44)) break
          }
          xs.push(bx)
          const ph = Math.random() * 6.28
          for (let y = galY[g] | 0; y <= ((galY[g + 1] + 8) | 0); y++) {
            blob(bx + Math.sin(ph + y * 0.07) * 3, y, 5.5, M_EMPTY)
          }
        }
        lastXs = xs
      }
      // 大殿堂 ×1:种在中层长廊上放大成 boss 房(宽 100~150 高 30~42)
      {
        const g = 1 + ((Math.random() * (nG - 2)) | 0)
        const hw = 50 + Math.random() * 25
        const sx = Math.max(hw + 16, Math.min(SW - hw - 16, 60 + Math.random() * (SW - 120)))
        const sy = galY[g]
        for (let k = 0; k < 30; k++) {
          const t2 = (k / 29) * 2 - 1
          blob(sx + t2 * hw * 0.85, sy + (Math.random() - 0.5) * 8,
            (15 + Math.random() * 5) * Math.sqrt(1 - t2 * t2 * 0.72), M_EMPTY)
        }
      }
    }
    if (hbTiles) {
      // GEN-RULES §四.2 入口:原版在区域顶部清一块 7×11 模板格(70×110 世界 px)的开口,
      // 不是凿穿全深的井——矿井内部的纵向连通全靠砖自己 + §五寻路重掷
      const ew = 7 * WANG
      for (const sx of shaftXs) {
        const x0 = Math.max(1, Math.min(SW - 1 - ew, sx - (ew >> 1)))
        for (let x = x0; x < x0 + ew; x++) {
          for (let y = surfY[x] - 2; y < UG_Y0 + 7 * WANG; y++) if (inB(x, y)) grid[idx(x, y)] = M_EMPTY
        }
      }
      // 原版对 wang 输出不做任何平滑/去毛刺——1 px 细节全是作者画的
      ugPath = ugFindPath(shaftXs)
      lastRegen = { conn: ugPath ? 1 : 0, attempts: attempt + 1, hb: true, shafts: shaftXs.slice() }
      if (ugPath) break
      if (attempt === MAX_ATTEMPTS - 1) lastRegen.rescued = true
      continue
    }
    // ── 程序回退路径:主矿井贯穿 + 去毛刺 + 沉降 + 可达占比 ──
    for (const x of shaftXs) {
      const ph = Math.random() * 6.28
      for (let y = surfY[Math.min(SW - 1, x)] - 2; y < UG_Y0 + UG_ROWS * HB_S - 8; y++) {
        blob(x + Math.sin(ph + y * 0.07) * 3, y, 3.5, M_EMPTY)
      }
    }
    despeckle(1, 44, SW - 2, UG_Y0 + UG_ROWS * HB_S - 2, 2)
    checkCollapse(1, 44, SW - 2, UG_Y0 + UG_ROWS * HB_S - 2, true)
    const conn = ugConnectivity(shaftXs)
    lastRegen = { conn, attempts: attempt + 1, hb: false, shafts: shaftXs.slice() }
    if (conn >= 0.8) break
    if (attempt === MAX_ATTEMPTS - 1) lastRegen.rescued = true
  }
  // GEN-RULES §六:秘室槽掷骰(路上的开,其余 50/50)——必须在寻路之后、布景之前
  if (hbTiles) lastRegen.coffee = resolveCoffee(ugPath)
  // ── P3 中观布景池盖章(须在 P2 落地之前:布景里的标记走同一条 spawn 管线) ──
  stampScenes()
  // ── P2 微观标记像素落地(照 data/scripts/biomes/coalmine.lua + wang_scripts.csv) ──
  // 位置是砖里 1px 彩点;出不出=概率表(表里第一项经常是空实体)+主路上按深度再滤一层。
  // 原版 spawn_small_enemies(is_open_path): spawn_percent = 2.1*biomeDepth + 0.2,
  //   r > spawn_percent 则直接 return——浅层主路 80% 空标,深层才接近表内密度。
  //   这是矿坑「看起来空、其实像关卡」的根,不是把标记再压一个全局 0.3。
  {
    mobSpawnPts.length = 0
    lastRegen.vessels = 0
    lastRegen.lamps = 0
    const biomeH = UG_ROWS * HB_S
    const biomeDepth01 = (y) => Math.max(0, Math.min(1, (y - UG_Y0) / biomeH))
    for (const mk of wangMarks) {
      if (mk.t === -3) {
        const d = biomeDepth01(mk.y)
        const spawnPercent = 2.1 * d + 0.2 // coalmine.lua
        if (Math.random() > spawnPercent) continue
        if (Math.random() < 0.087) continue // g_small_enemies 空槽 0.1/1.15
        mobSpawnPts.push({ x: mk.x, y: mk.y, done: false })
      }
      else if (mk.t === -4) { if (Math.random() < 0.875 && placeVessel(mk.x, mk.y)) lastRegen.vessels++ } // g_props 空槽 0.2/1.6
      else if (mk.t === -5) { if (Math.random() < 0.636) { placeLamp(mk.x, mk.y); lastRegen.lamps++ } } // g_lamp 0.7/1.1
    }
  }
  // ── P1 宏观分区落地:按 ZONE_MAP 给每个 40×40 区块注入分区特色(材质脉络,blob replaceOnly=有机斑块) ──
  {
    // 脉络基底:手绘瓦片主体是土(coalmine 白槽→M_DIRT),程序回退主体是石——注入目标要跟着走
    const VB = hbTiles ? M_DIRT : M_STONE
    for (let r = 0; r < 9; r++) for (let c = 0; c < 16; c++) {
      const z = zoneGrid[r * 16 + c]
      const x0 = c * ZW, y0 = UG_Y0 + r * ZH
      const rx = () => x0 + 5 + Math.random() * (ZW - 10)
      const ry = () => y0 + 5 + Math.random() * (ZH - 10)
      if (hbTiles) {
        // 真 coalmine 砖已经画好土/煤/水/木梁。MaterialComponent 只在深层稀有金(gold limit_min_y=750),
        // 冰窟/油田是别的群系(snowcave/…)的事——blob 换皮会把矿坑画成错群系,观感=乱。
        if (z === 5 && Math.random() < 0.35) blob(rx(), ry(), 2 + Math.random() * 2, M_GOLD, VB)
        else if (z === 4 && Math.random() < 0.12) blob(rx(), ry(), 1.6, M_GOLD, VB)
      } else if (z === 1) { // 冰窟:石→冰斑块(冰可被冰冻弹扩建/熔岩融化)
        for (let k = 0; k < 4; k++) blob(rx(), ry(), 4 + Math.random() * 5, M_ICE, VB)
        if (Math.random() < 0.5) blob(rx(), ry(), 3 + Math.random() * 3, M_ICE, M_DIRT)
      } else if (z === 3) { // 油田:岩内油囊(挖开漏油)+油砂
        for (let k = 0; k < 2; k++) if (Math.random() < 0.8) blob(rx(), ry(), 2.5 + Math.random() * 2.5, M_OIL, VB)
        if (Math.random() < 0.4) blob(rx(), ry(), 3, M_SAND, VB)
      } else if (z === 4) { // 深矿:煤脉+金脉(仅程序回退:手绘砖自带煤)
        if (Math.random() < 0.3) blob(rx(), ry(), 2 + Math.random() * 2, M_COAL, VB)
        if (Math.random() < 0.3) blob(rx(), ry(), 2 + Math.random() * 1.5, M_GOLD, VB)
      } else if (z === 5) { // 黄金宝库:密集金脉(挖开流金沙)
        for (let k = 0; k < 3; k++) if (Math.random() < 0.8) blob(rx(), ry(), 2 + Math.random() * 2.5, M_GOLD, VB)
        if (Math.random() < 0.25) blob(rx(), ry(), 2.5, M_COAL, VB)
      } else if (z === 2) { // 矿脉:稀金脉
        if (Math.random() < 0.15) blob(rx(), ry(), 2, M_GOLD, VB)
      }
    }
    // 熔岩海:瓦片区之下才开始(旧 9行×40px 口径的 seaTop=460 会灌进瓦片区底部,
    // 熔岩贴上 coalmine 煤脉=出生即火海)。先铺 6px 石壳隔离带再灌浆
    const ugBot = UG_Y0 + UG_ROWS * HB_S
    for (let y = ugBot; y < ugBot + 6; y++) for (let x = 1; x < SW - 1; x++) {
      const i = idx(x, y)
      if (grid[i] === M_EMPTY || grid[i] === M_POWDER || grid[i] === M_COAL) grid[i] = M_STONE
    }
    // 瓦片区底到世界底全是熔岩海(石壳之下不再留整片死岩):岸线用低频波,中间更深
    const seaTop = ugBot + 6
    const shore = oct(120, 6)
    for (let x = 1; x < SW - 1; x++) {
      const top = Math.max(seaTop + 3, (seaTop + 10 + shore(x) - Math.sin((x / SW) * Math.PI) * 8) | 0) // 不越过石壳贴到煤脉
      for (let y = seaTop; y < SH - 2; y++) {
        const i = idx(x, y)
        if (y >= top) grid[i] = M_LAVA
        else if (grid[i] === M_EMPTY) grid[i] = M_LAVA
      }
    }
    // 圣所×2:层间休息室(Noita 圣山节奏)——石壳+木地板+火把,站内回血
    sancts.length = 0
    for (const sx of shaftXs.slice(0, 2)) {
      const cx2 = Math.max(30, Math.min(SW - 30, sx + ((Math.random() * 60) | 0) - 30))
      const cy2 = UG_Y0 + ((UG_H * 0.55) | 0)
      for (let dy = -9; dy <= 9; dy++) for (let dx = -16; dx <= 16; dx++) grid[idx(cx2 + dx, cy2 + dy)] = M_STONE // 壳
      for (let dy = -6; dy <= 5; dy++) for (let dx = -13; dx <= 13; dx++) grid[idx(cx2 + dx, cy2 + dy)] = M_EMPTY // 腔
      for (let dx = -13; dx <= 13; dx++) grid[idx(cx2 + dx, cy2 + 6)] = M_WOOD // 木地板
      for (let dy = -2; dy <= 5; dy++) { grid[idx(cx2 - 14, cy2 + dy)] = M_EMPTY; grid[idx(cx2 + 14, cy2 + dy)] = M_EMPTY } // 两侧门洞
      torches.push({ x: cx2 - 10, y: cy2 - 3 }, { x: cx2 + 10, y: cy2 - 3 })
      sancts.push({ x0: cx2 - 14, y0: cy2 - 7, x1: cx2 + 14, y1: cy2 + 7 })
    }
  }
  // 森林带:高大松树(f36 标定:Noita 地表只有少量大尺度风景物,不是满地小木桩)
  // 树是"中景"(midGrid):画在玩家身后、不碰撞不挡弹——风景不是障碍物
  const mid = (x, y, v) => { if (inB(x, y) && grid[idx(x, y)] === M_EMPTY) midGrid[idx(x, y)] = v }
  const treeXs = []
  for (let s = 0; s < 40 && treeXs.length < 7; s++) {
    const x = 14 + ((Math.random() * (SW - 28)) | 0)
    if (biome[x] !== 'forest') continue
    if (treeXs.some((tx) => Math.abs(tx - x) < 26)) continue
    treeXs.push(x)
    const y0 = hs[x]
    const th = 20 + ((Math.random() * 12) | 0)
    const crownH = (th * 0.72) | 0
    const half = 5 + Math.random() * 3
    for (let ly = 0; ly < crownH; ly++) {
      const yy = y0 - th + ly
      // 锥形收窄 + 每 4px 一个枝盘(盘底外扩,针叶树的层次锯齿)
      let w = 1 + (ly / crownH) * half
      if (ly % 4 === 3) w += 1.6
      for (let dx = -w; dx <= w; dx++) mid((x + dx) | 0, yy, 1)
    }
    for (let y = y0 - th + crownH; y < y0; y++) for (let dx = 0; dx < 2; dx++) mid(x + dx, y, 2)
  }
  // 大蘑菇(f36 前景那几朵):细茎+宽扁帽,森林/油田带零星 2~3 朵(同为中景)
  for (let s = 0, placed = 0; s < 30 && placed < 3; s++) {
    const x = 14 + ((Math.random() * (SW - 28)) | 0)
    if (biome[x] === 'ice') continue
    if (treeXs.some((tx) => Math.abs(tx - x) < 14)) continue
    const y0 = hs[x]
    const cap = 4 + Math.random() * 3
    const stemH = (cap * 1.4) | 0
    for (let y = y0 - stemH; y < y0; y++) for (let dx = 0; dx < 2; dx++) mid(x + dx, y, 2)
    for (let dy = -cap; dy <= 0; dy++) for (let dx = -cap; dx <= cap; dx++) {
      if (dx * dx + dy * dy * 2.6 > cap * cap) continue
      mid(x + dx, y0 - stemH + dy - 1, 3)
    }
    placed++
  }
  // 游泳水域:冰川带地表湖(碗形水盆,深到能潜水憋气);地下水域由 T_LAKE 瓦片提供
  for (let s = 0; s < 2; s++) {
    const x = (SW * (0.08 + Math.random() * 0.2)) | 0
    const yc = hs[x] + 5
    const r = 10 + Math.random() * 6
    for (let yy = (yc - r) | 0; yy <= yc + r; yy++) {
      for (let xx = (x - r * 1.6) | 0; xx <= x + r * 1.6; xx++) {
        if (!inB(xx, yy)) continue
        const dx = (xx - x) / (r * 1.6), dy = (yy - yc) / r
        if (dx * dx + dy * dy > 1) continue
        grid[idx(xx, yy)] = yy > yc - r * 0.25 ? M_WATER : M_EMPTY
      }
    }
    // 岸线修整:碗直接扣在分层地面上会露出参差的层断面,沿一圈固体统一换成冰壳
    // (Noita 的湖岸是手绘瓦片里画好的;程序湖就得程序收边)
    for (let yy = (yc - r - 3) | 0; yy <= yc + r + 3; yy++) {
      for (let xx = (x - r * 1.6 - 3) | 0; xx <= x + r * 1.6 + 3; xx++) {
        if (!inB(xx, yy)) continue
        const dx = (xx - x) / (r * 1.6), dy = (yy - yc) / r
        const dd = dx * dx + dy * dy
        if (dd <= 1 || dd > 1.55) continue
        const i = idx(xx, yy)
        if (IS_SOLID[grid[i]]) grid[i] = M_ICE
      }
    }
  }
  // ── 结构物(Noita 原则:每一件都要"有理由存在",材质本身=可交互道具) ──
  // 桥跨真沟壑/井架标记矿井口/支撑架撑真坑道——功能产生美感;
  // 油桶火药桶=武器与地图的化学反应点:木壳装真材质,打破漏油、点燃殉爆,全靠模拟层涌现
  const wood = (x, y) => { if (inB(x, y) && grid[idx(x, y)] === M_EMPTY) grid[idx(x, y)] = M_WOOD }
  // ① 木桥:扫描地表找"下凹沟壑"(两侧沿口等高、中间下陷≥9px),桥面与沿口齐平=真能走
  {
    let built = 0
    for (let a = 24; a < SW - 90 && built < 3; a += 2) {
      const rim = hs[a]
      let b = -1, deep = 0
      for (let x = a + 3; x < a + 66 && x < SW - 24; x++) {
        const d = hs[x] - rim
        if (d > deep) deep = d
        if (x - a >= 14 && Math.abs(hs[x] - rim) <= 2 && deep >= 9) { b = x; break }
        if (hs[x] < rim - 4) break // 对面更高:是坡不是沟
      }
      if (b < 0) continue
      const y0 = rim - 1
      for (let x = a - 1; x <= b + 1; x++) { wood(x, y0); wood(x, y0 + 1) }
      // 桥墩打进沟底(悬空段每 ~1/3 一根,限深 28px)
      const step = Math.max(9, ((b - a) / 3) | 0)
      for (let px = a + step; px <= b - 4; px += step) {
        for (let y = y0 + 2; y < Math.min(SH - 4, y0 + 30); y++) {
          if (IS_SOLID[grid[idx(px, y)]]) break
          wood(px, y)
        }
      }
      if (Math.random() < 0.8) torches.push({ x: a + 3 + ((Math.random() * (b - a - 6)) | 0), y: y0 - 3 })
      built++
      a = b + 40
    }
  }
  // ② 矿井井架:立在入口竖井正上方,火把常亮 → 全图可见的"从这往下挖"路标(结构=导航)
  for (const sx of shaftXs) {
    const gx = Math.max(8, Math.min(SW - 8, sx))
    const gy = hs[gx]
    for (const dx of [-5, 5]) for (let y = gy - 13; y < gy; y++) wood(gx + dx, y)
    for (let x = gx - 6; x <= gx + 6; x++) wood(x, gy - 13) // 顶梁
    for (let x = gx - 1; x <= gx + 1; x++) wood(x, gy - 14) // 滑轮台
    torches.push({ x: gx - 9, y: gy - 2 }, { x: gx + 9, y: gy - 2 }) // 井口双火把(离木腿 4px,烧不到)
  }
  // ③ 坑道支撑架:找"顶地都实、净高 7~13px"的真坑道,两柱一梁(可燃!火攻烧塌一段坑道)
  {
    let sup = 0, tr = 0
    const ugBot = UG_Y0 + UG_ROWS * HB_S
    while (sup < 9 && tr++ < 600) {
      const x = 16 + ((Math.random() * (SW - 32)) | 0)
      const yq = UG_Y0 + 8 + ((Math.random() * (ugBot - UG_Y0 - 16)) | 0)
      if (grid[idx(x, yq)] !== M_EMPTY) continue
      let fy = yq
      while (fy < ugBot - 2 && !IS_SOLID[grid[idx(x, fy + 1)]]) fy++
      if (!IS_SOLID[grid[idx(x, fy + 1)]]) continue
      let cy = yq
      while (cy > UG_Y0 + 2 && !IS_SOLID[grid[idx(x, cy - 1)]]) cy--
      const h = fy - cy
      if (h < 7 || h > 13) continue
      if (!IS_SOLID[grid[idx(x - 3, fy + 1)]] || !IS_SOLID[grid[idx(x + 3, fy + 1)]]) continue // 柱脚要有地板
      for (let y = cy; y <= fy; y++) { wood(x - 3, y); wood(x + 3, y) }
      for (let dx = -2; dx <= 2; dx++) wood(x + dx, cy)
      sup++
    }
  }
  // ④ 油桶/火药桶:木壳 5×6 装真材质(浅层多油桶,深层多火药桶——风险随深度)
  const barrel = (bx, fy, fill) => {
    for (let y = fy - 5; y <= fy; y++) for (let x = bx - 2; x <= bx + 2; x++) {
      if (!inB(x, y) || grid[idx(x, y)] !== M_EMPTY) continue
      const shell = y === fy - 5 || y === fy || x === bx - 2 || x === bx + 2
      grid[idx(x, y)] = shell ? M_WOOD : fill
    }
  }
  {
    let bar = 0, tr = 0
    const ugBot = UG_Y0 + UG_ROWS * HB_S
    while (bar < 12 && tr++ < 600) {
      const x = 14 + ((Math.random() * (SW - 28)) | 0)
      const yq = UG_Y0 + 8 + ((Math.random() * (ugBot - UG_Y0 - 16)) | 0)
      if (grid[idx(x, yq)] !== M_EMPTY) continue
      let fy = yq
      while (fy < ugBot - 2 && !IS_SOLID[grid[idx(x, fy + 1)]]) fy++
      if (!IS_SOLID[grid[idx(x, fy + 1)]] || !IS_SOLID[grid[idx(x - 2, fy + 1)]] || !IS_SOLID[grid[idx(x + 2, fy + 1)]]) continue
      if (grid[idx(x, fy - 6)] !== M_EMPTY || grid[idx(x, fy - 7)] !== M_EMPTY) continue // 上方净空
      const row = ((fy - UG_Y0) / HB_S) | 0
      barrel(x, fy, Math.random() < (row >= 3 ? 0.7 : 0.3) ? M_POWDER : M_OIL)
      bar++
    }
    // 地表营地桶:每个井架旁一只油桶(佐证"这里有人采过矿",也是火攻素材)
    for (const sx of shaftXs) {
      const bx2 = Math.max(10, Math.min(SW - 10, sx + (Math.random() < 0.5 ? -13 : 13)))
      barrel(bx2, hs[bx2] - 1, M_OIL)
    }
  }
  // 底部熔岩海(全域,越靠中间越深,是深潜的终点)
  for (let x = 8; x < SW - 8; x++) {
    const depth = 10 + Math.sin((x / SW) * Math.PI) * 16
    for (let y = SH - 3 - depth | 0; y < SH - 3; y++) {
      if (Math.random() < 0.94) grid[idx(x, y)] = M_LAVA
    }
  }
  // 边界基岩
  for (let x = 0; x < SW; x++) { grid[idx(x, SH - 1)] = M_STONE; grid[idx(x, SH - 2)] = M_STONE }
  for (let y = 0; y < SH; y++) { grid[idx(0, y)] = M_STONE; grid[idx(SW - 1, y)] = M_STONE }
  // ── M1 一局目标:深渊底的星之核密室 + 地表祭坛 ──
  {
    // 星之核密室:熔岩海正上方的石壳球室,顶部喉道接洞窟网(风险最深处 = 报酬所在)
    const cxq = (SW * (0.2 + Math.random() * 0.6)) | 0
    const cyq = UG_Y0 + UG_ROWS * HB_S - 22
    blob(cxq, cyq, 8, M_STONE)
    blob(cxq, cyq, 6, M_EMPTY)
    for (let y = cyq - 26; y < cyq - 4; y++) blob(cxq + ((Math.random() * 3) | 0) - 1, y, 2.5, M_EMPTY)
    torches.push({ x: cxq - 3, y: cyq + 2 }, { x: cxq + 3, y: cyq + 2 })
    quest.coreX = cxq
    quest.coreY = cyq + 2
    // 地表祭坛:台基+双柱+火把,离出生点一段路(回程也是玩法)
    const side = Math.random() < 0.5 ? -1 : 1
    const ax = Math.max(175, Math.min(SW - 25, (SW / 2 + side * (105 + Math.random() * 50)) | 0))
    const hy = hs[ax]
    for (let dy2 = 3; dy2 <= 10; dy2++) for (let dx2 = -5; dx2 <= 5; dx2++) grid[idx(ax + dx2, hy - dy2)] = M_EMPTY // 清场(树/藤)
    for (let dx2 = -5; dx2 <= 5; dx2++) for (let dy2 = 1; dy2 <= 2; dy2++) grid[idx(ax + dx2, hy - dy2)] = M_STONE // 台基
    grid[idx(ax, hy - 3)] = M_STONE // 中央祭台
    for (const s of [-4, 4]) for (let dy2 = 3; dy2 <= 5; dy2++) grid[idx(ax + s, hy - dy2)] = M_STONE // 双柱
    torches.push({ x: ax - 4, y: hy - 7 }, { x: ax + 4, y: hy - 7 })
    quest.altarX = ax
    quest.altarY = hy - 5
    quest.state = 'seek'
    quest.t = 0
  }
  // 明火安全总检(坑#8 升级版):coalmine 煤脉入世后,任何来源的火把/灯火(瓦片标记/吊灯/
  // 圣所/密室/祭坛)±3px 有可燃物(煤/木/油)都会出生即火海——必须在所有火把就位后统一复检
  for (let ti = torches.length - 1; ti >= 0; ti--) {
    const t = torches[ti]
    let unsafe = false
    out2: for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (!inB(t.x + dx, t.y + dy)) continue
      const m2 = grid[idx(t.x + dx, t.y + dy)]
      if (m2 === M_POWDER || m2 === M_COAL || m2 === M_WOOD || m2 === M_OIL) { unsafe = true; break out2 }
    }
    if (unsafe) torches.splice(ti, 1)
  }
  // ── Noita 式画面分层(视频分析结论落地) ──
  // ① 背景墙:地表线以下全部挂同一张暗岩壁贴图(BGTEX,渲染时按世界坐标平铺)。
  // 旧版按地表分带画斜冰纹/机械板缝/木架格子——地下现在整层都是煤矿瓦片,背景也该是同一面岩壁;
  // 而且格子纹在黑暗里读成"满屏砖墙",是画面脏的头号来源。
  for (let x = 0; x < SW; x++) {
    for (let y = 0; y < SH; y++) bgGrid[idx(x, y)] = y < surfY[x] + 2 ? 0 : 1
  }
  // ② 植被(Noita 规则:grows_grass 只挂 soil):地表草皮近乎连续;地下所有土面顶上长 1~2px 黄绿草丛
  // (5/f00240:每块平台上沿都有一层毛茸茸的草,是煤矿"活"起来的关键);洞顶稀疏垂藤
  for (let x = 1; x < SW - 1; x++) {
    for (let y = Math.max(2, surfY[x] - 2); y < SH - 20; y++) {
      const i = idx(x, y)
      if (grid[i] !== M_EMPTY) continue
      const below = grid[idx(x, y + 1)]
      const above = grid[idx(x, y - 1)]
      if (y <= surfY[x] + 1) {
        if (biomeArr[x] === 1 && (below === M_STONE || below === M_WOOD || below === M_DIRT) && Math.random() < 0.9) grid[i] = M_MOSS
        continue
      }
      if (below === M_DIRT) {
        const rr = Math.random()
        // 草会烧(坑#8 同源):火把 ±5px 内不长草,否则出生即把整条平台点了
        if (rr < 0.62 && !torches.some((t) => Math.abs(t.x - x) <= 5 && Math.abs(t.y - y) <= 5)) {
          grid[i] = M_MOSS
          if (rr < 0.16 && grid[idx(x, y - 1)] === M_EMPTY) grid[idx(x, y - 1)] = M_MOSS
        }
      } else if (above === M_STONE && Math.random() < 0.03) {
        const len = 3 + Math.random() * 7
        for (let k = 0; k < len && grid[idx(x, y + k)] === M_EMPTY; k++) grid[idx(x, y + k)] = M_MOSS
      }
    }
  }
  // ③ 洞穴火盆:随机洞穴地面上的长明火(每屏的"光锚",Noita 每屏必有光源)
  for (let t = 0; t < 14; t++) {
    const x = 20 + ((Math.random() * (SW - 40)) | 0)
    let y = (UG_Y0 + Math.random() * (UG_ROWS * HB_S - 30)) | 0
    for (let k = 0; k < 36 && inB(x, y + 1); k++, y++) {
      const fl = grid[idx(x, y + 1)]
      if (grid[idx(x, y)] === M_EMPTY && (fl === M_STONE || fl === M_DIRT)) {
        // 这批火盆在安全总检之后加,自己查一遍 ±3px 可燃物(煤脉紧贴土面很常见)
        let unsafe = false
        out3: for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const m2 = inB(x + dx, y - 1 + dy) ? grid[idx(x + dx, y - 1 + dy)] : M_EMPTY
          if (m2 === M_POWDER || m2 === M_COAL || m2 === M_WOOD || m2 === M_OIL) { unsafe = true; break out3 }
        }
        if (!unsafe) {
          // 火盆脚下的草铲掉(草会烧),留一圈裸土
          for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
            if (inB(x + dx, y + dy) && grid[idx(x + dx, y + dy)] === M_MOSS) grid[idx(x + dx, y + dy)] = M_EMPTY
          }
          torches.push({ x, y: y - 1 })
        }
        break
      }
    }
  }
  // ④ 环境浮尘:雪(冰川)/孢子(森林)/煤灰(油田)
  for (let k = 0; k < 46; k++) motes.push({ x: Math.random() * SW, y: Math.random() * SH, ph: Math.random() * 9 })
  // 预热:让液体先流平
  for (let s = 0; s < 100; s++) stepSim()
  player.x = SW / 2
  player.y = 20
  player.vx = player.vy = 0
  player.hp = 100
  player.fuel = 100
  player.air = 100
  player.burnT = 0
  player.dead = 0
  player.iframe = 90
  player.stWet = player.stOil = player.stBlood = 0
  player.gold = 0 // permadeath:金块是"这一局"的
  // 法杖满蓝重置、卡组重洗
  for (const w of WANDS) {
    w.mana = w.manaMax
    w.cdT = 0
    w.recT = 0
    reloadWand(w)
  }
  cam.x = Math.max(0, Math.min(SW - VW, player.x - VW / 2))
  cam.y = Math.max(0, Math.min(SH - VH, player.y - VH * 0.55))
}

// ── 落沙模拟核心 ─────────────────────────────────────
function trySwapLiquid(i, j) {
  // 密度交换:重液沉到轻液下面(油浮于水、熔岩沉底)
  const a = grid[i], b = grid[j]
  if (IS_LIQUID[b] && DENSITY[b] < DENSITY[a]) {
    grid[i] = b
    grid[j] = a
    return true
  }
  return false
}
function fall(i, j, flip) {
  grid[j] = grid[i]
  aux[j] = aux[i]
  grid[i] = M_EMPTY
  aux[i] = 0
  moved[j] = flip
}
function igniteAt(x, y, chanceMul = 1) {
  if (!inB(x, y)) return
  if (worldMod === 'humid') chanceMul *= 0.35 // P4 潮湿:全局难点燃
  const i = idx(x, y)
  const m = grid[i]
  if (m === M_OIL && Math.random() < 0.6 * chanceMul) { grid[i] = M_FIRE; aux[i] = 40 + Math.random() * 30 }
  else if (m === M_WOOD && Math.random() < 0.08 * chanceMul) { grid[i] = M_FIRE; aux[i] = 70 + Math.random() * 50 }
  else if (m === M_POWDER) { grid[i] = M_EMPTY; expQueue.push({ x, y, r: 5 }) }
  // 煤:难点燃、点着后长命缓燃(Noita coal 语义)。绝不进爆炸队列——煤脉遍布 coalmine 手绘砖,
  // 会爆的煤=任何流窜火星都能把整张地图炸成碎渣
  else if (m === M_COAL && Math.random() < 0.05 * chanceMul) { grid[i] = M_FIRE; aux[i] = 90 + Math.random() * 70 } // 火贴脸每帧都掷,0.05≈阴燃前锋 3px/s
  else if (m === M_ICE && Math.random() < 0.35 * chanceMul) grid[i] = M_WATER // 火烤冰川 → 融水
  else if (m === M_MOSS && Math.random() < 0.25 * chanceMul) { grid[i] = M_FIRE; aux[i] = 46 + Math.random() * 30 } // 苔藓垂藤会烧,森林火灾
}
// 激活窗口(Noita 区块休眠的低配版):只模拟/照亮视口周边,屏外世界冻结。
// 世界扩到 640×520 后全图扫描太贵;边距 48 保证屏缘外的下落/光照连续。
const SIM_PAD = 48
function simWindow() {
  const cx = cam.x | 0, cy = cam.y | 0
  return [
    Math.max(1, cx - SIM_PAD), Math.min(SW - 1, cx + VW + SIM_PAD),
    Math.max(0, cy - SIM_PAD), Math.min(SH - 1, cy + VH + SIM_PAD),
  ]
}
function stepSim() {
  frame++
  const flip = frame & 1
  const [wx0, wx1, wy0, wy1] = simWindow()
  // P4 炎热:油面低频自燃(采样制,油海是逐渐烧起来的,不是一瞬火海)
  if (worldMod === 'hot' && frame % 5 === 0) {
    for (let k = 0; k < 8; k++) {
      const x = wx0 + ((Math.random() * (wx1 - wx0)) | 0)
      const y = wy0 + ((Math.random() * (wy1 - wy0)) | 0)
      const i = idx(x, y)
      if (grid[i] === M_OIL && y > 1 && grid[idx(x, y - 1)] === M_EMPTY && Math.random() < 0.35) {
        grid[i] = M_FIRE
        aux[i] = 40 + Math.random() * 20
      }
    }
  }
  // ① 粉末与液体:从下往上扫(每帧最多落一格),x 方向按行交替防偏
  for (let y = Math.min(SH - 2, wy1 - 1); y >= wy0; y--) {
    const ltr = (y + frame) & 1
    for (let xx = wx0; xx < wx1; xx++) {
      const x = ltr ? xx : wx0 + wx1 - 1 - xx
      const i = idx(x, y)
      const m = grid[i]
      if (m === M_EMPTY || IS_GAS[m] || m === M_FIRE || m === M_STONE || m === M_WOOD) continue
      if (moved[i] === flip) continue
      const dn = idx(x, y + 1)
      if (m === M_SAND || m === M_POWDER || m === M_GOLD || m === M_COAL) {
        // —— 沙子公理 ——
        if (grid[dn] === M_EMPTY || IS_GAS[grid[dn]]) { fall(i, dn, flip); continue }
        if (IS_LIQUID[grid[dn]]) { const t = grid[i]; grid[i] = grid[dn]; grid[dn] = t; moved[dn] = flip; continue }
        const d = ltr ? 1 : -1
        if (grid[idx(x + d, y + 1)] === M_EMPTY) { fall(i, idx(x + d, y + 1), flip); continue }
        if (grid[idx(x - d, y + 1)] === M_EMPTY) { fall(i, idx(x - d, y + 1), flip); continue }
        continue
      }
      if (IS_LIQUID[m]) {
        if (m === M_LAVA) {
          // 熔岩:慢速 + 遇水凝固 + 点燃邻居
          if (frame & 1) {
            for (const [nx, ny] of [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]]) {
              const ni = idx(nx, ny)
              if (grid[ni] === M_WATER) { grid[ni] = M_STEAM; aux[ni] = 60; grid[i] = M_STONE; break }
              igniteAt(nx, ny, 0.5)
            }
            if (grid[i] !== M_LAVA) continue
          } else continue
        }
        if (m === M_WATER || m === M_BLOOD) {
          // 水浇灭正下方/两侧的火
          for (const ni of [dn, idx(x - 1, y), idx(x + 1, y)]) {
            if (grid[ni] === M_FIRE) { grid[ni] = M_STEAM; aux[ni] = 50 }
          }
        }
        if (grid[dn] === M_EMPTY || IS_GAS[grid[dn]]) { fall(i, dn, flip); continue }
        if (trySwapLiquid(i, dn)) { moved[dn] = flip; continue }
        const d = ltr ? 1 : -1
        if (grid[idx(x + d, y + 1)] === M_EMPTY) { fall(i, idx(x + d, y + 1), flip); continue }
        if (grid[idx(x - d, y + 1)] === M_EMPTY) { fall(i, idx(x - d, y + 1), flip); continue }
        // —— 液体在沙子公理最后多查左右:横向流平 ——
        const k = DISPERSE[m]
        for (let s = 1; s <= k; s++) {
          const j = idx(x + d * s, y)
          if (grid[j] !== M_EMPTY) break
          if (s === k || grid[idx(x + d * (s + 1), y)] !== M_EMPTY) { fall(i, j, flip); break }
        }
      }
    }
  }
  // ② 火与气体:从上往下扫(气体 = 沙子规则上下颠倒)
  for (let y = wy0; y < Math.min(SH - 1, wy1); y++) {
    for (let x = wx0; x < wx1; x++) {
      const i = idx(x, y)
      const m = grid[i]
      if (m === M_FIRE) {
        if (moved[i] === flip) continue
        // 点燃四邻,遇水熄灭
        for (const [nx, ny] of [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]]) {
          const ni = idx(nx, ny)
          if (grid[ni] === M_WATER) { grid[i] = M_EMPTY; grid[ni] = M_STEAM; aux[ni] = 55; break }
          igniteAt(nx, ny, 1)
        }
        if (grid[i] !== M_FIRE) continue
        if (aux[i] > 0) aux[i]--
        if (aux[i] === 0) { grid[i] = Math.random() < 0.5 ? M_SMOKE : M_EMPTY; aux[i] = 40; continue }
        // 火苗上窜 + 冒烟
        const up = idx(x, y - 1)
        if (Math.random() < 0.3 && grid[up] === M_EMPTY) { fall(i, up, flip); continue }
        if (Math.random() < 0.08 && grid[up] === M_EMPTY) { grid[up] = M_SMOKE; aux[up] = 30 + Math.random() * 30; moved[up] = flip }
      } else if (IS_GAS[m]) {
        if (moved[i] === flip) continue
        if (aux[i] > 0) aux[i]--
        if (aux[i] === 0) {
          grid[i] = m === M_STEAM && Math.random() < 0.14 ? M_WATER : M_EMPTY
          continue
        }
        const d = Math.random() < 0.5 ? 1 : -1
        const up = idx(x, y - 1)
        if (grid[up] === M_EMPTY && Math.random() < 0.85) { fall(i, up, flip); continue }
        // 困在液体里的气体冒泡上浮(否则烟被岩浆盖住会闷成永久脏点)
        if (IS_LIQUID[grid[up]] && Math.random() < 0.6) {
          const tm = grid[i], ta = aux[i]
          grid[i] = grid[up]
          aux[i] = aux[up]
          grid[up] = tm
          aux[up] = ta
          moved[up] = flip
          continue
        }
        if (grid[idx(x + d, y - 1)] === M_EMPTY) { fall(i, idx(x + d, y - 1), flip); continue }
        if (grid[idx(x + d, y)] === M_EMPTY && Math.random() < 0.5) { fall(i, idx(x + d, y), flip); continue }
      }
    }
  }
  // ③ 爆炸队列(火药链爆逐帧扩散,天然有传播时序)
  let budget = 10
  while (expQueue.length && budget-- > 0) {
    const e = expQueue.shift()
    explode(e.x, e.y, e.r, true)
  }
}

// ── 爆炸:实心变碎屑飞溅,边缘点火,冲击玩家/敌人 ─────────────
/**
 * 液体扰动飞溅(Noita GDC 原方案):把网格里的真液体像素"拽出来"扔进弹道粒子系统,
 * 落地由 updateParts 重新沉积回网格——水花是真的水,溅出去的油还能被点燃。
 * 玩家入水/子弹穿液/爆炸都走这里;这是"每个像素都被模拟"的可信感来源。
 */
function splashLiquid(x, y, r, power, frac = 0.5) {
  if (parts.length > 2400) return
  const x0 = (x - r) | 0, x1 = (x + r) | 0, y0 = (y - r) | 0, y1 = (y + r) | 0
  let lastM = 0, n = 0
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    if (!inB(xx, yy)) continue
    if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue
    const i = idx(xx, yy)
    const m = grid[i]
    if (IS_LIQUID[m] !== 1 || Math.random() > frac) continue
    grid[i] = M_EMPTY
    lastM = m
    n++
    // 从扰动中心向外抛,主体向上(水柱/水冠的形态)
    const dxn = (xx - x) / (r || 1)
    parts.push({
      x: xx, y: yy,
      vx: dxn * power * (0.4 + Math.random() * 0.6) + (Math.random() - 0.5) * power * 0.35,
      vy: -power * (0.45 + Math.random() * 0.65),
      m,
    })
    if (parts.length > 2400) break
  }
  // 微雾:大颗液滴之外再喷一层短命细雾(液体色高光火花),飞溅层次立刻细起来
  if (n > 0) {
    const c = COL[lastM]
    const mist = [Math.min(255, (c & 255) + 70), Math.min(255, ((c >> 8) & 255) + 70), Math.min(255, ((c >> 16) & 255) + 70)]
    const cnt = Math.min(8, 2 + (n >> 1))
    for (let k = 0; k < cnt; k++) {
      addSpark(x + (Math.random() - 0.5) * r, y - 1, (Math.random() - 0.5) * power * 1.1, -power * (0.5 + Math.random() * 0.7), 0.14 + Math.random() * 0.18, mist)
    }
  }
}
function explode(cx, cy, r, fromChain = false) {
  // 爆心周边液体先被冲击掀起(水下爆炸=喷泉,Noita 名场面)
  splashLiquid(cx, cy, r + 3, 60 + r * 7, 0.45)
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!inB(x, y)) continue
      const d2 = (x - cx) ** 2 + (y - cy) ** 2
      if (d2 > r * r) continue
      const i = idx(x, y)
      const m = grid[i]
      if (m === M_EMPTY) continue
      if (m === M_POWDER) { grid[i] = M_EMPTY; expQueue.push({ x, y, r: 5 }); continue }
      if (x === 0 || x === SW - 1 || y >= SH - 2) continue // 基岩不炸
      const d = Math.sqrt(d2)
      const keepStone = m === M_STONE && d > r * 0.72
      if (keepStone) {
        if (Math.random() < 0.25) grid[i] = M_EMPTY
        else shade[i] = Math.min(110, shade[i] + 45) // 弹坑边缘永久熏黑(焦痕)
        continue
      }
      grid[i] = M_EMPTY
      // 实心材质 → 飞溅碎屑(落地重新沉积,Noita 的碎石弧线)
      if (parts.length < 2600 && Math.random() < 0.75) {
        const a = Math.atan2(y - cy, x - cx) + (Math.random() - 0.5) * 0.6
        const sp = (1 - d / r) * (60 + Math.random() * 90)
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, m: m === M_STONE ? M_SAND : m === M_ICE ? M_WATER : m })
      }
    }
  }
  // 坑沿去毛刺:1px 孤齿会挂住玩家(碰撞体 4×9)——挖掘手感的关键,炸出来的坑必须"顺滑可通行"
  {
    const rr = r + 2
    for (let y = Math.max(1, cy - rr); y <= Math.min(SH - 2, cy + rr); y++) {
      for (let x = Math.max(1, cx - rr); x <= Math.min(SW - 2, cx + rr); x++) {
        const i = idx(x, y)
        if (!IS_SOLID[grid[i]]) continue
        let solid = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          if (IS_SOLID[grid[idx(x + dx, y + dy)]]) solid++
        }
        if (solid <= 2) grid[i] = M_EMPTY
      }
    }
  }
  // ── 5.mp4 逐帧标定的爆炸三阶段(b0032 起爆光球→b0036 火星喷泉+火球团→b0090 坑缘余燃) ──
  // 阶段②a 火星喷泉:上百颗金黄火星放射喷出(Noita 起爆后 0.1~0.5s 的主体就是这个)
  for (let k = 0; k < Math.min(110, r * 8); k++) {
    const a = Math.random() * Math.PI * 2
    const sp = 50 + Math.random() * 140
    addSpark(cx, cy, Math.cos(a) * sp, Math.sin(a) * sp - 55, 0.45 + Math.random() * 0.75, [255, 200, 90])
  }
  // 阶段②b 火球团:4~10 个橙红大光团从爆心涌出上滚(b0036~b0045 中央那坨"滚烫的肉")
  for (let k = 0; k < Math.min(10, 3 + r * 0.5); k++) {
    addSpark(
      cx + (Math.random() - 0.5) * r * 0.8, cy + (Math.random() - 0.5) * r * 0.5,
      (Math.random() - 0.5) * 46, -18 - Math.random() * 44,
      0.45 + Math.random() * 0.5, [255, 130, 45], 2.2 + Math.random() * 2,
    )
  }
  // 外圈点火
  for (let k = 0; k < r * 7; k++) {
    const a = Math.random() * Math.PI * 2
    const rr = r + Math.random() * 3
    igniteAt((cx + Math.cos(a) * rr) | 0, (cy + Math.sin(a) * rr) | 0, 1.4)
  }
  // 阶段③ 坑缘挂火:贴着坑壁的空气格放长命明火(b0090:火星散尽后断口挂满火苗持续烧)
  for (let k = 0; k < r * 5; k++) {
    const a = Math.random() * Math.PI * 2
    const rr = r * (0.55 + Math.random() * 0.45)
    const fx2 = (cx + Math.cos(a) * rr) | 0, fy2 = (cy + Math.sin(a) * rr) | 0
    if (!inB(fx2, fy2) || grid[idx(fx2, fy2)] !== M_EMPTY) continue
    let touch = false
    for (const [ddx, ddy] of [[0, 1], [0, -1], [-1, 0], [1, 0]]) {
      if (inB(fx2 + ddx, fy2 + ddy) && IS_SOLID[grid[idx(fx2 + ddx, fy2 + ddy)]]) { touch = true; break }
    }
    if (touch && Math.random() < 0.5) { grid[idx(fx2, fy2)] = M_FIRE; aux[idx(fx2, fy2)] = 70 + Math.random() * 70 }
  }
  // 中心火球
  blob(cx, cy, Math.max(2, r * 0.3), M_FIRE)
  for (let y = cy - r * 0.3; y <= cy + r * 0.3; y++) for (let x = cx - r * 0.3; x <= cx + r * 0.3; x++) {
    if (inB(x | 0, y | 0)) { const i = idx(x | 0, y | 0); if (grid[i] === M_FIRE) aux[i] = 10 + Math.random() * 14 }
  }
  // 冲击玩家与敌人
  const pd = Math.hypot(player.x - cx, player.y - cy)
  if (pd < r * 2.2 && player.dead <= 0) {
    hurtPlayer(Math.max(2, (1 - pd / (r * 2.2)) * 30))
    player.vx += ((player.x - cx) / (pd || 1)) * 90
    player.vy += ((player.y - cy) / (pd || 1)) * 90 - 30
  }
  for (const mb of mobs) {
    const md = Math.hypot(mb.x - cx, mb.y - cy)
    if (md < r * 2) {
      mb.hp -= (1 - md / (r * 2)) * 26
      mb.vx += ((mb.x - cx) / (md || 1)) * 70
      mb.vy += ((mb.y - cy) / (md || 1)) * 70
      spillMob(mb, 4)
    }
  }
  shakeT = Math.max(shakeT, Math.min(10, r * 0.7))
  // 阶段① 起爆光球(b0032):爆心为中心的巨大光盘淹没半屏、把周围地形照成金黄——纯光 1~3 帧
  flashes.push({ x: cx, y: cy, r: Math.min(42, Math.max(9, r * 2.6)), life: 0.2, max: 0.2 })
  sparkBurst(cx, cy, Math.min(60, r * 5), 130, [255, 185, 90])
  if (r >= 7) boomFlash = Math.max(boomFlash, Math.min(0.62, 0.26 + r * 0.03)) // 全屏白闪按半径给量
  // 烟团:爆心上半随机冒灰白烟(爆完烟还在飘,Noita 的余韵)
  for (let k = 0; k < r * 2.8; k++) {
    const a = Math.random() * Math.PI
    const rr2 = Math.random() * r * 0.9
    const sx2 = (cx + Math.cos(a) * rr2) | 0
    const sy2 = (cy - Math.abs(Math.sin(a)) * rr2) | 0
    if (inB(sx2, sy2) && grid[idx(sx2, sy2)] === M_EMPTY) {
      grid[idx(sx2, sy2)] = M_SMOKE
      aux[idx(sx2, sy2)] = 80 + Math.random() * 90
    }
  }
  markCollapse(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2) // 炸完查崩塌:被切断支撑的岩块要塌
  if (!fromChain) processMobDeaths()
}

// ── 玩家 ───────────────────────────────────────────
/** 点燃玩家:湿/血染色防点燃(消耗染色),油染色烧得久一倍 */
function igniteShip(dur) {
  if (player.stWet > 0 || player.stBlood > 0) {
    player.stWet = Math.max(0, player.stWet - 1.2)
    player.stBlood = Math.max(0, player.stBlood - 1.2)
    return
  }
  if (player.stOil > 0) dur *= 2.2
  player.burnT = Math.max(player.burnT, dur)
}
function hurtPlayer(d, force = false) {
  if (player.dead > 0) return
  if (!force && player.iframe > 0) return
  player.hp -= d
  if (!force) player.iframe = 18
  player.hurtT = 8
  if (player.hp <= 0) {
    player.dead = 100
    explode(player.x | 0, player.y | 0, 8)
  }
}
function solidAt(x, y) {
  if (!inB(x | 0, y | 0)) return true
  return IS_SOLID[grid[idx(x | 0, y | 0)]] === 1
}
/** 身体碰撞采样:半宽 1.5,头 y-4,脚 y+4(小巫师约 4×9 像素) */
function bodyBlocked(cx, cy) {
  for (const oy of [-4, -1, 2, 4]) {
    if (solidAt(cx - 1.4, cy + oy) || solidAt(cx + 1.4, cy + oy)) return true
  }
  return false
}
function updatePlayer(dt) {
  if (player.dead > 0) {
    player.dead--
    if (player.dead <= 0) regen() // M1 permadeath:死亡 = 世界与经济整局重开
    return
  }
  // Noita 式身体:重力 + 行走 + 喷气悬浮(燃料管理) + 游泳(氧气管理)
  const ci = idx(player.x | 0, player.y | 0)
  const here = grid[ci]
  const inLiq = IS_LIQUID[here] === 1
  player.onGround = solidAt(player.x - 1, player.y + 5.2) || solidAt(player.x + 1, player.y + 5.2)
  // 重力(液体里有浮力)
  player.vy += (inLiq ? 40 : 240) * dt
  // 液体里:W = 划水(不耗燃料);空中:W = 喷气背包(烧燃料,落地回充)
  const wantUp = keys.has('w') || keys.has(' ')
  player.thrusting = false
  if (inLiq && wantUp) {
    player.vy -= 380 * dt
  } else if (!inLiq && wantUp && player.fuel > 0) {
    player.thrusting = true
    player.vy -= 540 * dt
    player.fuel = Math.max(0, player.fuel - 42 * dt)
    if (Math.random() < 0.7) addSpark(player.x + (Math.random() - 0.5) * 2, player.y + 5, (Math.random() - 0.5) * 20, 50 + Math.random() * 40, 0.3, [255, 170, 80])
  }
  if (!player.thrusting) player.fuel = Math.min(100, player.fuel + (player.onGround ? 65 : 10) * dt)
  // 氧气:头没进液体就开始憋气,耗尽持续溺水伤害;冒气泡
  const headLiq = IS_LIQUID[grid[idx(player.x | 0, (player.y - 3) | 0)]] === 1
  if (headLiq) {
    player.air = Math.max(0, player.air - 13 * dt)
    if (Math.random() < 0.14) addSpark(player.x + (Math.random() - 0.5) * 3, player.y - 4, (Math.random() - 0.5) * 8, -28, 0.7, [170, 215, 255])
    if (player.air <= 0 && frame % 34 === 0) hurtPlayer(5, true) // 溺水无视无敌帧
  } else {
    player.air = Math.min(100, player.air + 55 * dt)
  }
  // 入水/出水水花:掀起真液体像素(splashLiquid)+ 少量高光火花点缀
  if (inLiq !== player.wasLiq && Math.abs(player.vy) > 34) {
    const pw = Math.min(150, 40 + Math.abs(player.vy) * 0.55)
    splashLiquid(player.x, player.y + (inLiq ? 1 : 4), 4.5, pw, 0.65)
    for (let k = 0; k < 6; k++) addSpark(player.x + (Math.random() - 0.5) * 7, player.y + 2, (Math.random() - 0.5) * 70, -45 - Math.random() * 55, 0.35, [170, 205, 255])
  }
  // 贴水面快速游动:身后拖涌浪(只在头顶是空气=接近液面时)
  if (inLiq && Math.abs(player.vx) > 35 && grid[idx(player.x | 0, (player.y - 4) | 0)] === M_EMPTY && Math.random() < 0.3) {
    splashLiquid(player.x - Math.sign(player.vx) * 2, player.y - 1, 1.6, 34, 0.35)
  }
  player.wasLiq = inLiq
  // 行走/空中转向
  const dir = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0)
  const target = dir * (player.onGround ? 62 : 55)
  // 油染色打滑:地面抓地力骤降,刹不住车(Noita 的 Oiled)
  const traction = player.stOil > 0 ? 0.55 : player.onGround ? 0.0004 : 0.02
  player.vx += (target - player.vx) * (1 - Math.pow(traction, dt))
  if (dir !== 0 && player.onGround) player.walkT += dt
  // 液体阻力 + 灭火(Noita 细节:火需要空气——潜进任何液体都灭火,油也行,只要没露头)
  if (inLiq) {
    player.vx *= Math.pow(0.1, dt)
    player.vy *= Math.pow(0.08, dt)
    if (here !== M_LAVA && player.burnT > 0) {
      player.burnT = 0
      for (let k = 0; k < 4; k++) {
        const si = idx((player.x + (Math.random() - 0.5) * 4) | 0, (player.y - 5) | 0)
        if (si >= 0 && si < N && grid[si] === M_EMPTY) { grid[si] = M_STEAM; aux[si] = 40 }
      }
    }
    // 染色 Stains:泡什么沾什么;水会洗掉油
    if (here === M_WATER) { player.stWet = 10; player.stOil = 0 }
    else if (here === M_OIL) player.stOil = 12
    else if (here === M_BLOOD) player.stBlood = 12
  }
  player.stWet = Math.max(0, player.stWet - dt)
  player.stOil = Math.max(0, player.stOil - dt)
  player.stBlood = Math.max(0, player.stBlood - dt)
  // 染色滴落视觉
  if (player.stOil > 0 && Math.random() < 0.06) addSpark(player.x + (Math.random() - 0.5) * 3, player.y + 4, 0, 30, 0.4, [90, 74, 30])
  else if (player.stWet > 0 && Math.random() < 0.06) addSpark(player.x + (Math.random() - 0.5) * 3, player.y + 4, 0, 30, 0.4, [120, 170, 230])
  // 吸金:身边的金粉自动收进钱袋
  if (frame % 2 === 0) {
    for (let gy = -6; gy <= 6; gy++) {
      for (let gx = -6; gx <= 6; gx++) {
        const i = idx((player.x + gx) | 0, (player.y + gy) | 0)
        if (i >= 0 && i < N && grid[i] === M_GOLD) {
          grid[i] = M_EMPTY
          player.gold++
          if (Math.random() < 0.25) addSpark(player.x + gx, player.y + gy, -gx * 6, -gy * 6 - 20, 0.3, [255, 220, 110])
        }
      }
    }
  }
  player.vy = Math.max(-140, Math.min(175, player.vy))
  // 子步进移动:水平带 1px 自动上台阶,垂直落地/顶头
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(player.vx), Math.abs(player.vy)) * dt))
  for (let s = 0; s < steps; s++) {
    const nx = player.x + (player.vx * dt) / steps
    if (!bodyBlocked(nx, player.y)) player.x = nx
    else if (player.onGround && !bodyBlocked(nx, player.y - 1)) { player.x = nx; player.y -= 1 } // 上台阶
    else player.vx = 0
    const ny = player.y + (player.vy * dt) / steps
    if (!bodyBlocked(player.x, ny)) player.y = ny
    else {
      if (player.vy > 60) shakeT = Math.max(shakeT, 1.5)
      player.vy = 0
    }
  }
  player.x = Math.max(4, Math.min(SW - 4, player.x))
  player.y = Math.max(6, Math.min(SH - 6, player.y))
  if (player.iframe > 0) player.iframe--
  if (player.hurtT > 0) player.hurtT--
  // 环境伤害:火/熔岩(与敌人同一套规则);着火后持续燃烧
  if (here === M_FIRE) { igniteShip(1.4); if (frame % 12 === 0) hurtPlayer(3) }
  if (here === M_LAVA && frame % 6 === 0) { igniteShip(2); hurtPlayer(9) }
  // 带电液体电击:湿身伤害更高(Noita:Wet 状态下电击无减免)
  if (elec[ci] > 0 && frame % 14 === 0) hurtPlayer(player.stWet > 0 ? 9 : 6, true)
  if (player.burnT > 0) {
    player.burnT -= dt
    if (Math.random() < 0.5) addSpark(player.x + (Math.random() - 0.5) * 4, player.y - 2, (Math.random() - 0.5) * 20, -24, 0.3, [255, 140, 40])
    if (frame % 20 === 0) hurtPlayer(2)
  }
  // 开火(从魔杖尖发射)
  // 法杖走表:全部法杖回蓝 + 施法延迟/装填倒计时(两者并行,均归零才能施法)
  for (const w of WANDS) {
    w.mana = Math.min(w.manaMax, w.mana + w.manaRegen * dt)
    if (w.cdT > 0) w.cdT--
    if (w.recT > 0) w.recT--
  }
  const wd = WANDS[player.wand]
  if (mouse.l && wd.cdT <= 0 && wd.recT <= 0) fireWeapon()
  // ── P1 分区:进区横幅(Noita "Entered X")+ 圣所回血 ──
  const zNow = zoneAt(player.x | 0, player.y | 0)
  if (zNow !== zoneCur) {
    zoneCur = zNow
    if (zNow > 0) { zoneBannerT = 2.8; zoneBannerName = ZONE_NAMES[zNow] }
  }
  zoneBannerT = Math.max(0, zoneBannerT - dt)
  if (zNow === 7 && player.hp < 100) { // 圣所:站内缓慢回血(圣山快感)
    player.hp = Math.min(100, player.hp + 7 * dt)
    if (Math.random() < 0.12) addSpark(player.x + (Math.random() - 0.5) * 10, player.y + (Math.random() - 0.5) * 8, 0, -16, 0.5, [180, 240, 190])
  }
  // ── M1 一局目标:碰到星之核拾取 → 碰到祭坛交付通关 ──
  quest.t++
  if (quest.state === 'seek') {
    if ((player.x - quest.coreX) ** 2 + (player.y - quest.coreY) ** 2 < 36) {
      quest.state = 'carry'
      boomFlash = Math.max(boomFlash, 0.5)
      sparkBurst(quest.coreX, quest.coreY, 26, 90, [150, 235, 255])
      shakeT = Math.max(shakeT, 6)
    }
  } else if (quest.state === 'carry') {
    if ((player.x - quest.altarX) ** 2 + (player.y - quest.altarY) ** 2 < 64) {
      quest.state = 'won'
      quest.t = 0
      boomFlash = Math.max(boomFlash, 0.8)
      sparkBurst(quest.altarX, quest.altarY - 2, 40, 110, [255, 220, 120])
      shakeT = Math.max(shakeT, 8)
    }
  }
}

/**
 * ── M2 法杖系统:Noita 卡组求值模型移植(wiki: Expert Guide: Draw / Advanced Wand Mechanics) ──
 * 法杖 = 卡组(Deck→抽卡→Discard,抽空整轮装填,洗牌杖装填时乱序)。
 * 施法 = 抽卡组装「施法块 Casting Block」:
 *   投射卡不抽卡;修正卡续抽 1 张;多重卡续抽 N 张;没蓝的卡直接跳过进弃牌(Noita 同款);
 *   块内所有投射物共享全部累计修正,一齐射出(Noita:一张 Damage Plus 强化整块)。
 * 三参数:施法延迟按块结算(块内求和)/装填只在整轮抽空后结算/法力即时扣、按秒回。
 * 触发卡命中时施放挂载块,挂载块的施法延迟被完全无视——Noita rapid 构筑的核心漏洞,原样保留。
 * 载荷哲学不变:命中 = 注入真材质,火烧油/水浇岩浆全部由模拟层涌现。
 */
const SPELLS = {
  // 投射卡(pay=载荷分支;sp=速度;grav=抛物线;trail=飞行拖尾;wobble=游走;trigger=命中施放下一块)
  spark:  { t: 'proj', name: '火花弹', col: [255, 220, 120], mana: 2, cd: 5, sp: 260, life: 75, pay: 'kinetic', dmg: 6, small: true, wobble: true },
  bolt:   { t: 'proj', name: '魔法箭', col: [255, 240, 190], mana: 7, cd: 12, sp: 310, life: 90, pay: 'kinetic', dmg: 14 },
  fire:   { t: 'proj', name: '火球', col: [255, 110, 40], mana: 12, cd: 14, sp: 200, life: 105, pay: 'fire', dmg: 7, grav: 90, trail: 'fire' },
  water:  { t: 'proj', name: '水球', col: [120, 190, 255], mana: 7, cd: 10, sp: 225, life: 100, pay: 'water', dmg: 4, grav: 60 },
  oil:    { t: 'proj', name: '油弹', col: [190, 150, 60], mana: 6, cd: 10, sp: 225, life: 100, pay: 'oil', dmg: 4, grav: 60 },
  lava:   { t: 'proj', name: '熔岩球', col: [255, 120, 30], mana: 18, cd: 20, sp: 190, life: 110, pay: 'lava', dmg: 9, grav: 80, trail: 'lava' },
  boom:   { t: 'proj', name: '爆裂弹', col: [255, 170, 80], mana: 26, cd: 26, rec: 22, sp: 215, life: 115, pay: 'boom', dmg: 6, grav: 160 },
  zap:    { t: 'proj', name: '电击弹', col: [160, 215, 255], mana: 14, cd: 12, sp: 330, life: 80, pay: 'zap', dmg: 6 },
  // 挖掘破坏力铁律:通道口径必须 ≥ 玩家碰撞体高度(9px)+2,否则钻进去必卡
  drill:  { t: 'proj', name: '钻磨弹', col: [255, 210, 130], mana: 12, cd: 24, sp: 150, life: 160, pay: 'kinetic', dmg: 8, drill: 30, drillR: 5.5 },
  sparkT: { t: 'proj', name: '触发弹', col: [190, 235, 255], mana: 7, cd: 8, sp: 290, life: 85, pay: 'kinetic', dmg: 5, trigger: true },
  bomb:   { t: 'proj', name: '矿工炸弹', col: [255, 200, 90], mana: 42, cd: 44, rec: 34, sp: 150, life: 150, pay: 'bigboom', dmg: 12, grav: 240 },
  voidO:  { t: 'proj', name: '虚空球', col: [200, 140, 255], mana: 30, cd: 32, sp: 85, life: 220, pay: 'kinetic', dmg: 6, drill: 60, drillR: 5.5 },
  freeze: { t: 'proj', name: '冰冻弹', col: [170, 230, 255], mana: 16, cd: 16, sp: 260, life: 95, pay: 'freeze', dmg: 8 },
  saw:    { t: 'proj', name: '锯刃', col: [225, 225, 235], mana: 20, cd: 20, sp: 210, life: 170, pay: 'kinetic', dmg: 20, grav: 70, drill: 12, drillR: 2, bounces: 4 },
  // 修正卡(mod(m) 改写施法块的共享修正)
  speed:  { t: 'mod', name: '加速', col: [200, 230, 255], mana: 2, mod: (m) => { m.spMul *= 1.55; m.dmgMul *= 1.15 } },
  expl:   { t: 'mod', name: '爆裂弹头', col: [255, 150, 80], mana: 15, mod: (m) => { m.explR += 6 } }, // Noita EP:命中附带真爆炸,叠两张 r12 质变
  homing: { t: 'mod', name: '追踪', col: [255, 170, 220], mana: 9, mod: (m) => { m.homing = true } },
  bounce: { t: 'mod', name: '弹跳', col: [180, 255, 180], mana: 4, mod: (m) => { m.bounces += 3 } },
  split:  { t: 'mod', name: '裂解', col: [255, 210, 120], mana: 8, cd: 5, mod: (m) => { m.split = true } },
  power:  { t: 'mod', name: '强化', col: [255, 140, 140], mana: 6, cd: 7, mod: (m) => { m.dmgMul *= 1.6 } },
  trailO: { t: 'mod', name: '拖油', col: [190, 150, 60], mana: 5, mod: (m) => { m.trailMat = M_OIL } },
  trailW: { t: 'mod', name: '拖水', col: [120, 190, 255], mana: 5, mod: (m) => { m.trailMat = M_WATER } },
  mana:   { t: 'mod', name: '聚能', col: [130, 255, 210], mana: -24, cd: 10, mod: () => {} }, // 负费卡:倒赚法力(Noita Add Mana)
  haste:  { t: 'mod', name: '急速', col: [255, 255, 160], mana: 3, cd: -7, mod: () => {} },
  // 多重卡(draw=续抽张数;spread=扇形分布)
  multi2: { t: 'multi', name: '双重', col: [220, 220, 255], mana: 1, draw: 2 },
  multi3: { t: 'multi', name: '三重', col: [220, 220, 255], mana: 2, draw: 3 },
  fan3:   { t: 'multi', name: '三叉', col: [255, 220, 180], mana: 3, draw: 3, spread: 0.2 },
}
/** 预设法杖(1-4 切换)。M2 后续:掉落法杖/卡、槽位编辑 */
const WANDS = [
  {
    name: '学徒连发', castDelay: 4, recharge: 24, manaMax: 110, manaRegen: 50, shuffle: false,
    slots: ['speed', 'spark', 'spark', 'spark', 'bolt'],
  },
  {
    name: '三叉元素', castDelay: 10, recharge: 48, manaMax: 170, manaRegen: 40, shuffle: false,
    slots: ['fan3', 'fire', 'water', 'oil', 'haste', 'zap'],
  },
  {
    name: '矿工重装', castDelay: 18, recharge: 70, manaMax: 230, manaRegen: 34, shuffle: false,
    slots: ['sparkT', 'multi2', 'bomb', 'expl', 'drill', 'voidO'], // 触发弹挂炸弹=遥控爆破;爆裂弹头给钻磨加爆
  },
  {
    name: '混沌洗牌', castDelay: 7, recharge: 42, manaMax: 150, manaRegen: 42, shuffle: true,
    slots: ['bounce', 'fire', 'multi2', 'zap', 'spark', 'homing', 'expl', 'trailO'],
  },
  {
    name: '寒霜锯匠', castDelay: 12, recharge: 52, manaMax: 165, manaRegen: 45, shuffle: false,
    slots: ['freeze', 'multi2', 'saw', 'saw', 'haste', 'freeze'], // 冻湖造路+双锯刃弹跳绞杀
  },
]
function reloadWand(w) {
  w.deck = w.slots.map((_, i) => i)
  if (w.shuffle) {
    for (let i = w.deck.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0
      const t = w.deck[i]
      w.deck[i] = w.deck[j]
      w.deck[j] = t
    }
  }
  w.discard = []
}
for (const w of WANDS) {
  w.mana = w.manaMax
  w.cdT = 0
  w.recT = 0
  w.tipCol = SPELLS[w.slots.find((id) => SPELLS[id].t === 'proj')]?.col || [255, 220, 120]
  reloadWand(w)
}
/** 组装施法块:ctx 全程累计施法延迟/装填(触发挂载块 ignoreCd,Noita 语义) */
function buildBlock(w, ctx, depth, ignoreCd) {
  const block = { projs: [], spread: 0, mods: { spMul: 1, dmgMul: 1, bounces: 0, split: false, homing: false, trailMat: 0, explR: 0 } }
  drawInto(w, ctx, block, 1, depth, ignoreCd)
  return block
}
function drawInto(w, ctx, block, nDraws, depth, ignoreCd) {
  for (let k = 0; k < nDraws; k++) {
    // 抽一张付得起的卡;没蓝的直接跳过进弃牌(Noita:no mana → skip & discard)
    let sp = null
    while (w.deck.length) {
      const slot = w.deck.shift()
      w.discard.push(slot)
      const def = SPELLS[w.slots[slot]]
      if (w.mana < def.mana) continue
      sp = def
      break
    }
    if (!sp) return
    w.mana = Math.min(w.manaMax, w.mana - sp.mana)
    if (!ignoreCd) ctx.cd += sp.cd || 0
    ctx.rec += sp.rec || 0
    if (sp.t === 'multi') {
      if (sp.spread) block.spread += sp.spread
      drawInto(w, ctx, block, sp.draw, depth, ignoreCd)
    } else if (sp.t === 'mod') {
      sp.mod(block.mods)
      drawInto(w, ctx, block, 1, depth, ignoreCd) // 修正卡续抽 1 张
    } else {
      const proj = { def: sp, payload: null }
      if (sp.trigger && depth < 3) proj.payload = buildBlock(w, ctx, depth + 1, true) // 触发块无视施法延迟
      block.projs.push(proj)
    }
  }
}
/** 施法块射出(玩家施法与触发弹二次施放共用) */
function castBlockAt(block, x, y, a, ivx = 0, ivy = 0) {
  const m = block.mods
  const n = block.projs.length
  for (let i = 0; i < n; i++) {
    const p = block.projs[i]
    const d = p.def
    const off = n > 1 ? (i - (n - 1) / 2) * (block.spread || 0.09) : 0
    const ang = a + off + (Math.random() - 0.5) * 0.03
    const sp2 = d.sp * m.spMul
    bullets.push({
      x, y, vx: Math.cos(ang) * sp2 + ivx, vy: Math.sin(ang) * sp2 + ivy,
      pay: d.pay, col: d.col, dmg: (d.dmg || 5) * m.dmgMul, small: !!d.small, life: d.life,
      grav: d.grav || 0, drill: d.drill || 0, drillR: d.drillR || 2, wobble: d.wobble ? Math.random() * 9 : -1,
      bounces: m.bounces + (d.bounces || 0), split: m.split, homing: m.homing, trailMat: m.trailMat, trail: d.trail || null,
      explR: m.explR, payload: p.payload,
    })
  }
}
/** 电击注入:沿导电液体(水/血)洪泛带电——电死一整池(Noita 名场面) */
function electrify(x, y) {
  const q = [[x, y]]
  const samples = []
  let n = 0
  while (q.length && n < 2600) {
    const [cx, cy] = q.pop()
    if (!inB(cx, cy)) continue
    const i = idx(cx, cy)
    if (!CONDUCTIVE[grid[i]] || elec[i] > 0) continue
    elec[i] = 50
    n++
    if (n % 60 === 1 && samples.length < 6) samples.push([cx, cy])
    q.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
  }
  if (n > 0) {
    sparkBurst(x, y, 6, 55, [170, 220, 255])
    // 注电瞬间:主闪电劈向池内多点(电的"形态")
    for (const [sx, sy] of samples) spawnBolt(x, y, sx, sy, 3)
  }
  return n
}
player.wand = 0
function fireWeapon() {
  const w = WANDS[player.wand]
  const ctx = { cd: 0, rec: 0 }
  const block = buildBlock(w, ctx, 0, false)
  const a = Math.atan2(mouse.y - (player.y - 1), mouse.x - player.x) // 与魔杖渲染同一角度基准(手在 y-1)
  const mx = player.x + Math.cos(a) * 5
  const my = player.y - 1 + Math.sin(a) * 5
  if (block.projs.length) {
    w.tipCol = block.projs[0].def.col
    castBlockAt(block, mx, my, a, player.vx * 0.3, player.vy * 0.3)
    // 枪口 juice:锥形火花 + 闪光 + 微震(华丽感从出膛开始)
    sparkCone(mx, my, a, 6, 90, block.projs[0].def.col)
    flashes.push({ x: mx, y: my, r: 3, life: 0.07, max: 0.07 })
    shakeT = Math.max(shakeT, 0.6)
  }
  // 施法延迟按块结算;整轮抽空 → 装填(与延迟并行,取大者生效)
  w.cdT = Math.max(2, w.castDelay + ctx.cd)
  if (!w.deck.length) {
    reloadWand(w)
    w.recT = Math.max(0, w.recharge + ctx.rec)
  }
}
/** 载荷生效:往世界里注入材质(之后发生什么,模拟层说了算) */
function payloadImpact(b, bx, by, small) {
  const p = { id: b.pay, col: b.col }
  // 爆裂弹头修正(Noita Explosive Projectile 移植):任何弹命中附带真爆炸,可叠加
  // (Noita 的中期质变就是这张卡:半径过阈值伤害跳变——我们 r 越大 explode 冲击/坑越夸张,同构)
  if (b.explR > 0) explode(bx, by, Math.min(22, b.explR))
  sparkBurst(bx, by, small ? 7 : 14, 70, p.col)
  // 命中 juice:载荷色闪光(带地形照亮)+ 一撮烟(水系除外)——每一发都要"打在世界上"
  flashes.push({ x: bx, y: by, r: small ? 2.6 : 4.2, life: 0.07, max: 0.07 })
  if (p.id !== 'water' && p.id !== 'zap') {
    for (let k = 0; k < (small ? 1 : 2); k++) {
      const sx = bx + ((Math.random() * 5 - 2.5) | 0), sy = by - 1 - ((Math.random() * 3) | 0)
      if (inB(sx, sy) && grid[idx(sx, sy)] === M_EMPTY) { grid[idx(sx, sy)] = M_SMOKE; aux[idx(sx, sy)] = 20 + Math.random() * 20 }
    }
  }
  if (p.id === 'kinetic') {
    // Noita 模型:每颗弹命中=微型爆炸三件套「坑+材质色碎屑+闪光」,再加冲击波溅伤
    const r = small ? 2 : 4
    const back = Math.atan2(-b.vy, -b.vx)
    for (let y = by - r - 1; y <= by + r + 1; y++) for (let x = bx - r - 1; x <= bx + r + 1; x++) {
      if (!inB(x, y)) continue
      const d2 = (x - bx) ** 2 + (y - by) ** 2
      const i = idx(x, y)
      const m2 = grid[i]
      if (d2 <= r * r) {
        if (!IS_SOLID[m2]) continue
        if (x === 0 || x === SW - 1 || y >= SH - 2) continue // 基岩
        grid[i] = M_EMPTY
        // 碎屑带真材质颜色(石头喷灰渣/泥土喷棕渣),沿反射向喷回
        if (parts.length < 2600 && Math.random() < 0.55) {
          const a2 = back + (Math.random() - 0.5) * 1.4
          const spd = 50 + Math.random() * 110
          parts.push({
            x, y, vx: Math.cos(a2) * spd, vy: Math.sin(a2) * spd - 25,
            m: m2 === M_STONE || m2 === M_ICE ? M_SAND : m2, col: COL[m2],
          })
        }
      } else if (IS_SOLID[m2] && Math.random() < 0.6) shade[i] = Math.min(110, shade[i] + 26) // 坑沿熏黑
    }
    sparkCone(bx, by, back, small ? 4 : 8, 120, [255, 232, 175]) // 反射向白热火花锥
    shakeT = Math.max(shakeT, small ? 0.5 : 1.2)
    if (!small) { // 冲击波:近旁怪吃溅伤+击退——命中要"顶"
      for (const mb of mobs) {
        const md = Math.hypot(mb.x - bx, mb.y - by)
        if (md < r * 3.2) {
          mb.hp -= b.dmg * 0.35
          mb.vx += ((mb.x - bx) / (md || 1)) * 55
          mb.vy -= 22
          spillMob(mb, 2)
        }
      }
    }
    markCollapse(bx - r - 2, by - r - 2, bx + r + 2, by + r + 2)
  } else if (p.id === 'fire') {
    blob(bx, by, small ? 1 : 2, M_EMPTY)
    fireBlob(bx, by, small ? 2 : 3)
    for (let k = 0; k < (small ? 3 : 8); k++) igniteAt(bx + (Math.random() * 7 - 3.5) | 0, by + (Math.random() * 7 - 3.5) | 0, 1)
  } else if (p.id === 'water') {
    blob(bx, by, small ? 2 : 4, M_WATER, M_EMPTY)
    blob(bx, by, small ? 2 : 3, M_WATER, M_FIRE)
    for (let k = 0; k < (small ? 3 : 10) && parts.length < 2600; k++) {
      const a2 = Math.random() * Math.PI * 2
      parts.push({ x: bx, y: by, vx: Math.cos(a2) * 50, vy: Math.sin(a2) * 50 - 20, m: M_WATER })
    }
  } else if (p.id === 'oil') {
    blob(bx, by, small ? 2 : 4, M_OIL, M_EMPTY)
    for (let k = 0; k < (small ? 2 : 8) && parts.length < 2600; k++) {
      const a2 = Math.random() * Math.PI * 2
      parts.push({ x: bx, y: by, vx: Math.cos(a2) * 45, vy: Math.sin(a2) * 45 - 20, m: M_OIL })
    }
  } else if (p.id === 'lava') {
    blob(bx, by, small ? 1 : 2, M_LAVA, M_EMPTY)
    blob(bx, by, small ? 1 : 2, M_LAVA, M_SAND)
  } else if (p.id === 'boom') {
    explode(bx, by, small ? 7 : 13)
  } else if (p.id === 'bigboom') {
    explode(bx, by, small ? 10 : 18) // 矿工炸弹:坑径 36px,人(9px)进出绰绰有余——挖掘主力
  } else if (p.id === 'freeze') {
    // 冰冻:液体冻成可站立地形(水→冰/熔岩→石/火扑灭)——用地图造平台的构筑卡
    const fr = small ? 4 : 7
    for (let y = by - fr; y <= by + fr; y++) for (let x = bx - fr; x <= bx + fr; x++) {
      if (!inB(x, y) || (x - bx) ** 2 + (y - by) ** 2 > fr * fr) continue
      const i = idx(x, y)
      const m = grid[i]
      if (m === M_WATER || m === M_BLOOD) grid[i] = M_ICE
      else if (m === M_LAVA) grid[i] = M_STONE
      else if (m === M_FIRE) { grid[i] = M_STEAM; aux[i] = 30 }
    }
    sparkBurst(bx, by, 9, 60, [190, 240, 255])
    flashes.push({ x: bx, y: by, r: 2.4, life: 0.08, max: 0.08 })
  } else if (p.id === 'zap') {
    const n = electrify(bx, by)
    if (n === 0) sparkBurst(bx, by, 5, 70, [170, 220, 255]) // 没碰到导电液体:就地放电花
    flashes.push({ x: bx, y: by, r: 2, life: 0.08, max: 0.08 })
  }
}
function fireBlob(x, y, r) {
  blob(x, y, r, M_FIRE, M_EMPTY)
  for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
    if (inB(xx, yy) && grid[idx(xx, yy)] === M_FIRE && aux[idx(xx, yy)] === 0) aux[idx(xx, yy)] = 30 + Math.random() * 30
  }
}
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]
    b.life--
    if (b.grav) b.vy += b.grav * dt // 抛物线弹(火球/水球/爆裂弹…)
    // 火花弹游走:垂直于弹道的正弦摆动(Noita spark bolt 的轨迹味)
    if (b.wobble >= 0) {
      b.wobble += dt * 24
      const L = Math.hypot(b.vx, b.vy) || 1
      const k = Math.cos(b.wobble) * 46 * dt
      b.x += (-b.vy / L) * k
      b.y += (b.vx / L) * k
    }
    // 追踪修正:朝最近敌人拐弯(限转速,轨迹自然弯曲)
    if (b.homing && mobs.length) {
      let best = null, bd = 80 * 80
      for (const mb of mobs) {
        const dd = (mb.x - b.x) ** 2 + (mb.y - b.y) ** 2
        if (dd < bd) { bd = dd; best = mb }
      }
      if (best) {
        const cur = Math.atan2(b.vy, b.vx)
        const want = Math.atan2(best.y - b.y, best.x - b.x)
        let da = want - cur
        while (da > Math.PI) da -= Math.PI * 2
        while (da < -Math.PI) da += Math.PI * 2
        const turn = Math.max(-5.5 * dt, Math.min(5.5 * dt, da))
        const L = Math.hypot(b.vx, b.vy)
        b.vx = Math.cos(cur + turn) * L
        b.vy = Math.sin(cur + turn) * L
      }
    }
    // 拖尾:火球滴火星/熔岩滴光点;拖油/拖水修正滴真材质(落地沉积→可点燃/灭火)
    if (b.trail && Math.random() < 0.6) {
      addSpark(b.x, b.y, (Math.random() - 0.5) * 14, 8 + Math.random() * 14, 0.22 + Math.random() * 0.15, b.trail === 'fire' ? [255, 150, 50] : [255, 110, 30])
    }
    if (b.trail === 'fire' && Math.random() < 0.1) {
      const ti = idx(b.x | 0, b.y | 0)
      if (inB(b.x | 0, b.y | 0) && grid[ti] === M_EMPTY) { grid[ti] = M_FIRE; aux[ti] = 6 + Math.random() * 8 }
    }
    if (b.trailMat && Math.random() < 0.4 && parts.length < 2600) {
      parts.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 10, vy: 8, m: b.trailMat })
    }
    const steps = Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) * dt)
    let hit = false
    for (let s = 0; s < steps && !hit; s++) {
      const px = b.x | 0, py = b.y | 0
      b.x += (b.vx * dt) / steps
      b.y += (b.vy * dt) / steps
      const bx = b.x | 0, by = b.y | 0
      if (!inB(bx, by)) { hit = true; break }
      const m = grid[idx(bx, by)]
      const solid = IS_SOLID[m] === 1
      const liquid = IS_LIQUID[m] === 1
      if (solid || liquid) {
        // 钻头:凿穿固体继续飞(预算耗尽才结算载荷)——钻磨:火花+岩屑+震屏+磨头闪光
        if (b.drill > 0 && solid) {
          blob(bx, by, b.drillR, M_EMPTY)
          // 钻道随钻随去毛刺(每 4 步一次):钻出来的通道必须顺滑可通行,毛齿会卡住 4×9 的玩家
          if ((b.drill & 3) === 0) { despeckle(bx - 9, by - 9, bx + 9, by + 9, 1); markCollapse(bx - 8, by - 8, bx + 8, by + 8) }
          b.drill--
          sparkBurst(bx, by, 2, 65, b.col)
          if (Math.random() < 0.6 && parts.length < 2600) {
            parts.push({ x: bx, y: by, vx: -b.vx * 0.15 + (Math.random() - 0.5) * 60, vy: -50 - Math.random() * 40, m: M_SAND })
          }
          shakeT = Math.max(shakeT, 1.3)
          if (Math.random() < 0.35) flashes.push({ x: bx, y: by, r: 1.6, life: 0.06, max: 0.06 })
          continue
        }
        if (b.drill > 0 && liquid) continue // 钻头穿液体
        if (b.pay === 'kinetic' && liquid && b.grav === 0) {
          // 动能弹穿液体:入水掀水花(真液体像素),水中有阻力,偶尔拖出细碎水沫
          if (inB(px, py) && grid[idx(px, py)] === M_EMPTY) splashLiquid(bx, by - 1, 3, 70, 0.55)
          else if (Math.random() < 0.12) splashLiquid(bx, by, 1.5, 40, 0.35)
          b.vx *= 0.975
          b.vy *= 0.975
          continue
        }
        // 弹跳:撞固体反弹(按进入轴翻转速度)
        if (b.bounces > 0 && solid) {
          if (px !== bx && IS_SOLID[grid[idx(bx, py)]]) { b.vx *= -0.85; b.x = px }
          else { b.vy *= -0.85; b.y = py }
          b.bounces--
          sparkBurst(px, py, 2, 40, b.col)
          continue
        }
        // 裂解修正:命中点先结算小载荷,再崩出 4 发同载荷小弹
        if (b.split) {
          payloadImpact(b, bx, by, true)
          const back = Math.atan2(-b.vy, -b.vx)
          for (let k = 0; k < 4; k++) {
            const a2 = back + (k - 1.5) * 0.55
            bullets.push({
              x: px, y: py, vx: Math.cos(a2) * 130, vy: Math.sin(a2) * 130,
              pay: b.pay, col: b.col, dmg: b.dmg * 0.5, small: true, life: 50,
              grav: 0, drill: 0, wobble: -1, bounces: 0, split: false, homing: false, trailMat: 0, trail: null, payload: null,
            })
          }
          if (b.payload) triggerCast(b, px, py)
          hit = true
          break
        }
        if (liquid) splashLiquid(bx, by, 2.6, 62, 0.5) // 命中液面:先掀起液体再结算载荷
        payloadImpact(b, bx, by, b.small)
        if (b.payload) triggerCast(b, bx, by)
        hit = true
        break
      }
      // 命中敌人
      for (const mb of mobs) {
        if ((mb.x - b.x) ** 2 + (mb.y - b.y) ** 2 < (mb.r + 1) ** 2) {
          // 血染色 = 暴击加成(Noita 的 Bloody);电载荷直击 = 眩晕
          const crit = player.stBlood > 0 ? 1.35 : 1
          mb.hp -= b.dmg * crit
          if (b.pay === 'zap') mb.stun = Math.max(mb.stun, 45)
          // 击退按弹速给足(打中要"顶"到怪),命中点白闪+按伤害喷尸液
          mb.vx += b.vx * (b.small ? 0.06 : 0.16)
          mb.vy += b.vy * (b.small ? 0.06 : 0.16) - 14
          flashes.push({ x: b.x, y: b.y, r: 2, life: 0.06, max: 0.06 })
          spillMob(mb, 3 + Math.min(6, b.dmg * 0.3))
          payloadImpact(b, b.x | 0, b.y | 0, b.small)
          if (b.payload) triggerCast(b, b.x | 0, b.y | 0)
          hit = true
          break
        }
      }
    }
    if (hit || b.life <= 0) {
      if (!hit && b.pay === 'boom' && !b.small) explode(b.x | 0, b.y | 0, 13)
      bullets.splice(i, 1)
    }
  }
}
/** 触发弹命中:从落点沿原方向施放挂载块(无视施法延迟,Noita 语义) */
function triggerCast(b, bx, by) {
  const a = Math.atan2(b.vy, b.vx)
  castBlockAt(b.payload, bx - Math.cos(a) * 2, by - Math.sin(a) * 2, a)
  flashes.push({ x: bx, y: by, r: 2.5, life: 0.08, max: 0.08 })
  sparkBurst(bx, by, 4, 60, [190, 235, 255])
  b.payload = null
}
// 敌战机的子弹
const ebullets = []
function updateEBullets(dt) {
  for (let i = ebullets.length - 1; i >= 0; i--) {
    const b = ebullets[i]
    b.life--
    b.x += b.vx * dt
    b.y += b.vy * dt
    const bx = b.x | 0, by = b.y | 0
    let die = b.life <= 0 || !inB(bx, by)
    if (!die && (IS_SOLID[grid[idx(bx, by)]] || IS_LIQUID[grid[idx(bx, by)]])) {
      if (b.fire) {
        // 施法怪火弹:落点引燃(油池/木头交给 igniteAt 涌现),补一格明火保证起燃
        for (let oy = -2; oy <= 2; oy++) for (let ox2 = -2; ox2 <= 2; ox2++) igniteAt(bx + ox2, by + oy, 3)
        if (inB(bx, by - 1) && grid[idx(bx, by - 1)] === M_EMPTY) { grid[idx(bx, by - 1)] = M_FIRE; aux[idx(bx, by - 1)] = 30 }
      }
      sparkBurst(bx, by, 2, 30, b.fire ? [255, 170, 60] : [255, 90, 90])
      die = true
    }
    if (!die && player.dead <= 0 && (player.x - b.x) ** 2 + (player.y - b.y) ** 2 < 12) {
      if (b.fire) { igniteShip(1.5); hurtPlayer(6) } else hurtPlayer(7)
      die = true
    }
    if (die) ebullets.splice(i, 1)
  }
}

// ── 敌人:血肉怪流血 / 油囊怪漏油(尸液进模拟) ───────────────
function spawnMob(kind, x, y) {
  mobs.push({
    kind, x: x ?? 20 + Math.random() * (SW - 40), y: y ?? 12,
    vx: 0, vy: 0, hp: kind === 'oil' ? 26 : kind === 'fighter' ? 16 : kind === 'caster' ? 15 : 20,
    r: kind === 'blood' || kind === 'caster' ? 4 : 5, burn: 0, ph: Math.random() * 9,
    skin: Math.random() < 0.5 ? 'f1' : 'f2', fireT: 60 + Math.random() * 60,
    wet: 0, oiled: 0, stun: 0, // 染色与感电眩晕(与玩家同一套规则)
    pour: 0, // 施法怪:倒油剩余帧(倒完接火弹)
  })
}
function spillMob(mb, n) {
  if (mb.kind === 'fighter') {
    // Noita 细节:机器人的"血"是机油(战机残骸可被点燃)
    sparkBurst(mb.x, mb.y, 2, 50, [255, 200, 120])
    for (let k = 0; k < n && parts.length < 2600; k++) {
      const a = Math.random() * Math.PI * 2
      parts.push({ x: mb.x, y: mb.y, vx: Math.cos(a) * 36 + mb.vx, vy: Math.sin(a) * 36 - 18, m: M_OIL })
    }
    return
  }
  const m = mb.kind === 'oil' ? M_OIL : M_BLOOD
  for (let k = 0; k < n && parts.length < 2600; k++) {
    const a = Math.random() * Math.PI * 2
    parts.push({ x: mb.x, y: mb.y, vx: Math.cos(a) * 40 + mb.vx, vy: Math.sin(a) * 40 - 20, m })
  }
}
let deathsBusy = false
function processMobDeaths() {
  // 防重入:战机殉爆(explode)会再次调用本函数,嵌套时直接返回,由外层 while 重扫处理链式死亡
  if (deathsBusy) return
  deathsBusy = true
  let again = true
  while (again) {
    again = false
    for (let i = mobs.length - 1; i >= 0; i--) {
      const mb = mobs[i]
      if (!mb || mb.hp > 0) continue
      mobs.splice(i, 1) // 先移除再殉爆,避免死亡循环
      if (mb.kind === 'fighter') {
        explode(mb.x | 0, mb.y | 0, 6) // 战机坠毁自带殉爆(可能炸死更多敌人 → 重扫)
        again = true
      } else {
        spillMob(mb, mb.kind === 'oil' ? 26 : 20)
        if (mb.burn > 0 && mb.kind === 'oil') expQueue.push({ x: mb.x | 0, y: mb.y | 0, r: 7 }) // 着火的油囊殉爆
      }
      // 金块经济:击杀掉金粉(真实粉末材质——会堆积,会被炸飞,掉进岩浆就没了)
      for (let k = 0, kn = 4 + Math.random() * 4; k < kn && parts.length < 2600; k++) {
        const a = Math.random() * Math.PI * 2
        parts.push({ x: mb.x, y: mb.y, vx: Math.cos(a) * 55, vy: Math.sin(a) * 55 - 40, m: M_GOLD })
      }
    }
  }
  deathsBusy = false
}
function updateMobs(dt) {
  for (const mb of mobs) {
    mb.ph += dt
    // 感电眩晕:抽搐,无法机动
    if (mb.stun > 0) {
      mb.stun--
      if (Math.random() < 0.3) addSpark(mb.x + (Math.random() - 0.5) * 8, mb.y + (Math.random() - 0.5) * 8, 0, 0, 0.1, [190, 230, 255])
    } else if (mb.kind === 'fighter' && player.dead <= 0) {
      // 敌战机:绕着玩家保持射距,定时开火
      const dx = player.x - mb.x, dy = player.y - mb.y
      const d = Math.hypot(dx, dy) || 1
      const want = 58
      const k = (d - want) / want
      mb.vx += ((dx / d) * k * 60 + Math.cos(mb.ph * 1.8) * 24) * dt
      mb.vy += ((dy / d) * k * 60 + Math.sin(mb.ph * 2.4) * 24) * dt
      mb.fireT -= 1
      if (mb.fireT <= 0 && d < 130) {
        mb.fireT = 90 + Math.random() * 50
        const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.12
        ebullets.push({ x: mb.x + Math.cos(a) * 5, y: mb.y + Math.sin(a) * 5, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, life: 140 })
        sparkBurst(mb.x + Math.cos(a) * 5, mb.y + Math.sin(a) * 5, 2, 30, [255, 90, 90])
      }
    } else if (mb.kind === 'caster' && player.dead <= 0) {
      // 施法怪(M1 生态位:会用元素):悬浮保持射程,先往玩家头顶倒油,再补火弹点燃——火海由模拟层涌现
      const dx = player.x - mb.x, dy = player.y - mb.y
      const d = Math.hypot(dx, dy) || 1
      const want = 66
      const k = (d - want) / want
      mb.vx += ((dx / d) * k * 46 + Math.cos(mb.ph * 1.3) * 18) * dt
      mb.vy += ((dy / d) * k * 46 + Math.sin(mb.ph * 1.7) * 14 - 8) * dt
      if (d < 150 && mb.pour <= 0) mb.fireT--
      if (mb.fireT <= 0) {
        mb.pour = 46
        mb.fireT = 320 + Math.random() * 130
      }
      if (mb.pour > 0) {
        mb.pour--
        if (parts.length < 2600) {
          for (let k2 = 0; k2 < 2; k2++) {
            parts.push({ x: player.x + (Math.random() - 0.5) * 9, y: player.y - 26 - Math.random() * 6, vx: (Math.random() - 0.5) * 14, vy: 30, m: M_OIL })
          }
        }
        if ((mb.pour & 7) === 0) sparkBurst(mb.x, mb.y - 4, 2, 26, [200, 150, 255])
        if (mb.pour === 0) {
          // 倒完油 → 火弹瞄脚下(点燃刚积起来的油池)
          const a = Math.atan2(player.y + 4 - mb.y, player.x - mb.x)
          ebullets.push({ x: mb.x + Math.cos(a) * 5, y: mb.y + Math.sin(a) * 5, vx: Math.cos(a) * 95, vy: Math.sin(a) * 95, life: 160, fire: true })
          sparkBurst(mb.x + Math.cos(a) * 5, mb.y + Math.sin(a) * 5, 3, 34, [255, 165, 45])
        }
      }
    } else if (player.dead <= 0) {
      // 血肉怪/油囊怪:朝玩家缓慢逼近 + 悬浮摆动
      const dx = player.x - mb.x, dy = player.y - mb.y
      const d = Math.hypot(dx, dy) || 1
      mb.vx += (dx / d) * 30 * dt
      mb.vy += ((dy / d) * 30 + Math.sin(mb.ph * 2.2) * 22) * dt
    }
    mb.vx *= Math.pow(0.05, dt)
    mb.vy *= Math.pow(0.05, dt)
    const nx = mb.x + mb.vx * dt
    const ny = mb.y + mb.vy * dt
    if (!solidAt(nx, mb.y)) mb.x = nx
    else mb.vx *= -0.4
    if (!solidAt(mb.x, ny)) mb.y = ny
    else mb.vy *= -0.4
    mb.x = Math.max(3, Math.min(SW - 3, mb.x))
    mb.y = Math.max(3, Math.min(SH - 3, mb.y))
    // 环境:染色/点燃/灭火/感电(与玩家同一套规则)
    const ci = idx(mb.x | 0, mb.y | 0)
    const here = grid[ci]
    // 怪物砸进液体也掀真水花(与玩家同规则)
    const mbLiq = IS_LIQUID[here] === 1
    if (mbLiq && !mb.wasLiq && Math.abs(mb.vy) > 50) splashLiquid(mb.x, mb.y + 1, 3, Math.min(100, 30 + Math.abs(mb.vy) * 0.45), 0.5)
    mb.wasLiq = mbLiq
    if (here === M_WATER) { mb.wet = 8; mb.oiled = 0 }
    else if (here === M_OIL) mb.oiled = 10
    mb.wet = Math.max(0, mb.wet - dt)
    mb.oiled = Math.max(0, mb.oiled - dt)
    if (here === M_FIRE || here === M_LAVA) {
      if (mb.wet > 0 && here === M_FIRE) mb.wet = Math.max(0, mb.wet - 0.3) // 湿身防点燃(消耗)
      else { mb.burn = mb.oiled > 0 ? 200 : 90; mb.hp -= here === M_LAVA ? 1 : 0.35 } // 沾油烧更久
    } else if (IS_LIQUID[here] && mb.burn > 0) mb.burn = 0
    if (elec[ci] > 0) {
      mb.stun = Math.max(mb.stun, 24)
      mb.hp -= mb.wet > 0 ? 0.5 : 0.3 // 带电液体持续电击,湿身更疼
      // 电流爬过身体的小弧光
      if (Math.random() < 0.2) spawnBolt(mb.x - mb.r, mb.y + (Math.random() - 0.5) * mb.r * 2, mb.x + mb.r, mb.y + (Math.random() - 0.5) * mb.r * 2, 1.8)
      if (mb.hp <= 0) continue // 死亡交给 processMobDeaths
    }
    if (mb.burn > 0) {
      mb.burn--
      mb.hp -= 0.06
      if (frame % 5 === 0 && inB(mb.x | 0, (mb.y - mb.r) | 0)) {
        const fi = idx(mb.x | 0, (mb.y - mb.r) | 0)
        if (grid[fi] === M_EMPTY) { grid[fi] = M_FIRE; aux[fi] = 16 }
      }
    }
    // 撞玩家
    if (player.dead <= 0 && (mb.x - player.x) ** 2 + (mb.y - player.y) ** 2 < (mb.r + 3) ** 2) hurtPlayer(10)
  }
  processMobDeaths()
  // P2 敌人锚点:入镜才生成(Noita 懒生成)——位置由瓦片标记像素给出,出什么按分区怪表
  if (frame % 30 === 0 && mobs.length < 10) {
    const mx0 = cam.x - 24, mx1 = cam.x + VW + 24, my0 = cam.y - 24, my1 = cam.y + VH + 24
    for (const sp of mobSpawnPts) {
      if (sp.done || sp.x < mx0 || sp.x > mx1 || sp.y < my0 || sp.y > my1) continue
      if ((sp.x - player.x) ** 2 + (sp.y - player.y) ** 2 < 45 * 45) continue // 太近不刷,防脸刷
      sp.done = true // 只掷一次骰子,过了这村没这店
      if (grid[idx(sp.x, sp.y)] !== M_EMPTY) continue // 锚点被塌方/流沙埋掉:作废
      const z = zoneAt(sp.x, sp.y)
      if (z === 7) continue // 圣所不刷
      const tbl = ZONE_MOBS[Math.min(6, z)]
      spawnMob(tbl[(Math.random() * tbl.length) | 0], sp.x, sp.y)
      if (mobs.length >= 10) break
    }
  }
  // 兜底滴灌:锚点耗尽后的低频镜头边缘刷(频率减半,主力已是锚点)
  if (autoEl.checked && mobs.length < 5 && frame % 450 === 0) {
    const sx2 = cam.x + 10 + Math.random() * (VW - 20)
    const sy2 = Math.max(6, cam.y + 6)
    const z = zoneAt(player.x, player.y)
    if (z !== 7) {
      const tbl = ZONE_MOBS[Math.min(6, z)]
      spawnMob(tbl[(Math.random() * tbl.length) | 0], sx2, sy2)
    }
  }
}

// ── 碎屑粒子:飞行→落地沉积回网格 ─────────────────────────
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    p.vy += 190 * dt
    const nx = p.x + p.vx * dt
    const ny = p.y + p.vy * dt
    const gx = nx | 0, gy = ny | 0
    if (!inB(gx, gy)) { parts.splice(i, 1); continue }
    const m = grid[idx(gx, gy)]
    // 上升中的粒子可穿过液体:被扰动掀起的水从水体内部钻出来才成水花(否则在池子里一格就沉积)
    if (m === M_EMPTY || IS_GAS[m] || m === M_FIRE || (p.vy < 0 && IS_LIQUID[m])) {
      p.x = nx
      p.y = ny
    } else {
      // 落地:在当前位置沉积
      const cx = p.x | 0, cy = p.y | 0
      // 玩家身上是沉积禁区:怪物贴脸死掉时金粉/碎屑落进碰撞体(4×9)会把人"浇铸"钉住
      if (player.dead <= 0 && Math.abs(cx - player.x) < 4.5 && Math.abs(cy - player.y) < 7) {
        if (p.m === M_GOLD) { player.gold++; parts.splice(i, 1); continue } // 贴脸金粉直接进钱袋
        const dir = cx >= player.x ? 1 : -1
        p.x = player.x + dir * 6 // 其它碎屑推到身侧继续飞
        p.vx += dir * 40
        continue
      }
      if (inB(cx, cy) && (grid[idx(cx, cy)] === M_EMPTY || IS_GAS[grid[idx(cx, cy)]])) grid[idx(cx, cy)] = p.m
      parts.splice(i, 1)
    }
  }
}

// ── 崩塌:失去支撑的地形整块坠落(Noita 招牌机制) ────────────
// 静态地图"没有逻辑"的病根就在这:炸断支撑后悬空的岩块必须塌。
// 方案:支撑洪泛(区域边界固体=锚,向内传播"被支撑")→ 传不到的连通块抠成下落实体,
// 落地写回网格、压伤怪物、排开液体,并把上方标脏触发链式崩塌。
const chunks = [] // 下落岩块 {cells:[{dx,dy,m}], bottom, x, y, w, h, vy, fy}
const CHUNKABLE = new Uint8Array(NMAT) // 能成块坠落的静态固体(沙/粉/煤/金自己会流,不算)
CHUNKABLE[M_STONE] = CHUNKABLE[M_ICE] = CHUNKABLE[M_DIRT] = CHUNKABLE[M_WOOD] = CHUNKABLE[M_MOSS] = 1
const SUPPORTIVE = new Uint8Array(NMAT) // 能传递支撑的材质(沙堆也托得住石头)
for (let i2 = 0; i2 < NMAT; i2++) SUPPORTIVE[i2] = IS_SOLID[i2]
SUPPORTIVE[M_MOSS] = SUPPORTIVE[M_GOLD] = 1
const cmark = new Int32Array(N) // 洪泛标记(代数戳,免清零)
let cgen = 0
let collapseDirty = null // 破坏发生过的脏区,每 6 帧结算一次(免得每颗子弹都全量洪泛)

function markCollapse(x0, y0, x1, y1) {
  if (!collapseDirty) collapseDirty = { x0, y0, x1, y1 }
  else {
    collapseDirty.x0 = Math.min(collapseDirty.x0, x0)
    collapseDirty.y0 = Math.min(collapseDirty.y0, y0)
    collapseDirty.x1 = Math.max(collapseDirty.x1, x1)
    collapseDirty.y1 = Math.max(collapseDirty.y1, y1)
  }
}

/** 支撑洪泛 + 悬空块收集。区域边界上的固体视为锚(连到区域外=默认连着大地,保守正确) */
function checkCollapse(x0, y0, x1, y1, instant = false) {
  x0 = Math.max(1, x0 | 0); y0 = Math.max(1, y0 | 0)
  x1 = Math.min(SW - 2, x1 | 0); y1 = Math.min(SH - 2, y1 | 0)
  if (x1 - x0 < 3 || y1 - y0 < 3) return
  const A = ++cgen // 锚戳
  const stack = []
  for (let x = x0; x <= x1; x++) {
    for (const y of [y0, y1]) { const i = idx(x, y); if (SUPPORTIVE[grid[i]]) { cmark[i] = A; stack.push(i) } }
  }
  for (let y = y0; y <= y1; y++) {
    for (const x of [x0, x1]) { const i = idx(x, y); if (SUPPORTIVE[grid[i]] && cmark[i] !== A) { cmark[i] = A; stack.push(i) } }
  }
  while (stack.length) {
    const i = stack.pop()
    const x = i % SW, y = (i / SW) | 0
    if (x > x0) { const j = i - 1; if (cmark[j] !== A && SUPPORTIVE[grid[j]]) { cmark[j] = A; stack.push(j) } }
    if (x < x1) { const j = i + 1; if (cmark[j] !== A && SUPPORTIVE[grid[j]]) { cmark[j] = A; stack.push(j) } }
    if (y > y0) { const j = i - SW; if (cmark[j] !== A && SUPPORTIVE[grid[j]]) { cmark[j] = A; stack.push(j) } }
    if (y < y1) { const j = i + SW; if (cmark[j] !== A && SUPPORTIVE[grid[j]]) { cmark[j] = A; stack.push(j) } }
  }
  // 锚传不到的 CHUNKABLE 连通块 = 悬空 → 抠成实体
  const C = ++cgen
  for (let sy = y0 + 1; sy < y1; sy++) for (let sx = x0 + 1; sx < x1; sx++) {
    const si = idx(sx, sy)
    if (!CHUNKABLE[grid[si]] || cmark[si] >= A) continue
    const q = [si]
    cmark[si] = C
    const cs = []
    let mnX = sx, mxX = sx, mnY = sy, mxY = sy
    while (q.length) {
      const i = q.pop()
      cs.push(i)
      const cx2 = i % SW, cy2 = (i / SW) | 0
      if (cx2 < mnX) mnX = cx2; if (cx2 > mxX) mxX = cx2
      if (cy2 < mnY) mnY = cy2; if (cy2 > mxY) mxY = cy2
      if (cx2 > x0 + 1) { const j = i - 1; if (cmark[j] < A && CHUNKABLE[grid[j]]) { cmark[j] = C; q.push(j) } }
      if (cx2 < x1 - 1) { const j = i + 1; if (cmark[j] < A && CHUNKABLE[grid[j]]) { cmark[j] = C; q.push(j) } }
      if (cy2 > y0 + 1) { const j = i - SW; if (cmark[j] < A && CHUNKABLE[grid[j]]) { cmark[j] = C; q.push(j) } }
      if (cy2 < y1 - 1) { const j = i + SW; if (cmark[j] < A && CHUNKABLE[grid[j]]) { cmark[j] = C; q.push(j) } }
    }
    if (cs.length < 6) { // 太小不成块:直接变碎屑
      for (const i of cs) {
        if (parts.length < 2600) parts.push({ x: i % SW, y: (i / SW) | 0, vx: (Math.random() - 0.5) * 30, vy: -10, m: grid[i] })
        grid[i] = M_EMPTY
      }
      continue
    }
    if (cs.length > 30000) continue // 巨块保险丝(下落实体逐像素步进只查底部轮廓,3 万格也吃得消;再大=世界级岩体,不该塌)
    const w2 = mxX - mnX + 1, h2 = mxY - mnY + 1
    const mask = new Uint8Array(w2 * h2)
    const cellArr = []
    for (const i of cs) {
      const dx = (i % SW) - mnX, dy = ((i / SW) | 0) - mnY
      cellArr.push({ dx, dy, m: grid[i] })
      mask[dy * w2 + dx] = 1
      grid[i] = M_EMPTY
    }
    // 底部轮廓 = 下方不是本块自身的格子(处理凹形块,别悬空穿模)
    const bottom = []
    for (const cell of cellArr) {
      if (cell.dy === h2 - 1 || !mask[(cell.dy + 1) * w2 + cell.dx]) bottom.push({ dx: cell.dx, dy: cell.dy })
    }
    const ch = { cells: cellArr, bottom, x: mnX, y: mnY, w: w2, h: h2, vy: 0, fy: mnY, hitP: false, hitM: new Set() }
    if (instant) { // 生成期:直接沉到底,出生地图不允许有悬空浮岛
      let guard = 500
      while (guard--) {
        let blocked = false
        for (const b of ch.bottom) {
          const ty = ch.y + b.dy + 1
          const m2 = ty >= SH - 2 ? M_STONE : grid[idx(ch.x + b.dx, ty)]
          if (m2 !== M_EMPTY && !IS_GAS[m2] && m2 !== M_FIRE) { blocked = true; break }
        }
        if (blocked) break
        ch.y++
      }
      landChunk(ch, true)
    } else {
      chunks.push(ch)
      markCollapse(mnX - 4, mnY - 4, mxX + 4, mxY + 4) // 抠走后上方可能又悬空,链式复检
    }
  }
}

/** 落地:写回网格(玩家碰撞体禁区/排开液体/挤占变碎屑),带震屏扬尘 */
function landChunk(c, quiet = false) {
  for (const cell of c.cells) {
    const tx = c.x + cell.dx, ty = c.y + cell.dy
    if (!inB(tx, ty)) continue
    if (!quiet && player.dead <= 0 && Math.abs(tx - player.x) < 4.5 && Math.abs(ty - player.y) < 7) {
      if (parts.length < 2600) parts.push({ x: tx, y: ty - 1, vx: (tx >= player.x ? 1 : -1) * 70, vy: -60, m: cell.m })
      continue
    }
    const ti = idx(tx, ty)
    const gm = grid[ti]
    if (gm === M_EMPTY || IS_GAS[gm] || gm === M_FIRE) grid[ti] = cell.m
    else if (IS_LIQUID[gm]) { // 排开液体再占位(液体变水花碎屑,落回来重新沉积)
      if (parts.length < 2600) parts.push({ x: tx, y: ty - 2, vx: (Math.random() - 0.5) * 60, vy: -70 - Math.random() * 50, m: gm })
      grid[ti] = cell.m
    } else if (parts.length < 2600 && Math.random() < 0.6) {
      parts.push({ x: tx, y: ty - 1, vx: (Math.random() - 0.5) * 50, vy: -50, m: cell.m })
    }
  }
  if (!quiet) {
    shakeT = Math.max(shakeT, Math.min(7, 1 + c.cells.length * 0.02 + c.vy * 0.015))
    for (const b of c.bottom) {
      if (Math.random() < 0.35) addSpark(c.x + b.dx, c.y + b.dy + 1, (Math.random() - 0.5) * 60, -20 - Math.random() * 40, 0.35, [150, 140, 125])
    }
    despeckle(c.x - 2, c.y - 2, c.x + c.w + 2, c.y + c.h + 2, 1)
    markCollapse(c.x - 4, c.y - 4, c.x + c.w + 4, c.y + c.h + 4)
  }
}

function updateChunks(dt) {
  for (let ci = chunks.length - 1; ci >= 0; ci--) {
    const c = chunks[ci]
    c.vy = Math.min(230, c.vy + 300 * dt)
    c.fy += c.vy * dt
    let steps = Math.min(6, (c.fy - c.y) | 0)
    let landed = false
    while (steps-- > 0 && !landed) {
      let inLiq = false
      for (const b of c.bottom) {
        const tx = c.x + b.dx, ty = c.y + b.dy + 1
        const m2 = ty >= SH - 2 ? M_STONE : grid[idx(tx, ty)]
        if (IS_LIQUID[m2]) inLiq = true
        else if (m2 !== M_EMPTY && !IS_GAS[m2] && m2 !== M_FIRE) { landed = true; break }
      }
      if (landed) break
      c.y++
      if (inLiq) { // 穿液:减速下沉,排开的液体从块顶喷出(大石入水的浪)
        c.vy = Math.min(c.vy, 36)
        for (const b of c.bottom) {
          const ti = idx(c.x + b.dx, c.y + b.dy)
          if (IS_LIQUID[grid[ti]]) {
            if (parts.length < 2600 && Math.random() < 0.6) parts.push({ x: c.x + b.dx, y: c.y - 2, vx: (Math.random() - 0.5) * 80, vy: -60 - Math.random() * 60, m: grid[ti] })
            grid[ti] = M_EMPTY
          }
        }
      }
      // 砸中玩家/怪:一次性砸伤+弹开(体积和落速越大越疼)
      const imp = Math.min(32, c.cells.length * 0.05 + c.vy * 0.07)
      if (!c.hitP && player.dead <= 0 && player.x > c.x - 3 && player.x < c.x + c.w + 3 && player.y > c.y - 2 && player.y < c.y + c.h + 6) {
        c.hitP = true
        hurtPlayer(imp * 0.8)
        player.vx += (player.x < c.x + c.w / 2 ? -1 : 1) * 70
        player.vy += 40
      }
      for (const mb of mobs) {
        if (!c.hitM.has(mb) && mb.x > c.x - 3 && mb.x < c.x + c.w + 3 && mb.y > c.y - 2 && mb.y < c.y + c.h + 6) {
          c.hitM.add(mb)
          mb.hp -= imp
          mb.vx += (mb.x < c.x + c.w / 2 ? -1 : 1) * 60
          mb.vy += 40
          spillMob(mb, 3)
        }
      }
    }
    if (landed) { landChunk(c); chunks.splice(ci, 1) }
    else if (c.y > SH) chunks.splice(ci, 1)
  }
  // 结算:只在破坏后 6 帧内查一次(Noita 口径:静态地形默认稳定,浮空是合法状态,
  // 崩塌必须由破坏"触发"——旧版每 150 帧无差别巡检会把手绘瓦片里的悬空平台全扫掉)。
  // 窗口=脏区 ±88(比平台/悬梁尺度大保证判得出,比全屏小保证屏内无关的浮空设计不被牵连;
  // 保守语义下窗口边界固体=锚,所以远处浮台与窗口边界相交时自动豁免)
  if (collapseDirty && frame % 6 === 0) {
    const cd = collapseDirty
    collapseDirty = null
    const [wx0, wx1, wy0, wy1] = simWindow()
    checkCollapse(Math.max(wx0, cd.x0 - 88), Math.max(wy0, cd.y0 - 88), Math.min(wx1, cd.x1 + 88), Math.min(wy1, cd.y1 + 88))
  }
}

// ── 渲染 ───────────────────────────────────────────
// 材质基色(MATTEX 纹理的锚点色;粒子/小地图等单点取色也用它)
const COL = new Uint32Array(NMAT)
function rgb(r, g, b) { return 0xff000000 | (b << 16) | (g << 8) | r }
// 配色标定自 Noita materials.xml 实值(wang/graphics color,社区材质库 noita-explorer 提供)。
// 贴图 PNG 是 Nolla 版权资产不能搬;配色数值不受版权保护,可对标。核心结论:Noita 的
// 世界底色又暗又灰(rock #313b36 深橄榄灰/soil #36311e/water #376259 暗青绿),亮的只有
// 光源和金子——之前"塑料感"一半是调色太亮太粉。实值按我们的光照模型提亮 ~1.3×
COL[M_STONE] = rgb(60, 70, 62)     // rock_static #313b36:深灰带橄榄绿底;原作岩石比土还暗,提太亮会浮成"青灰砖"
COL[M_SAND] = rgb(190, 160, 86)    // sand #b89e57:金橄榄
COL[M_WATER] = rgb(48, 96, 90)     // water #376259:暗青绿(Noita 水根本不是亮蓝)
COL[M_OIL] = rgb(44, 36, 18)       // 油:近黑深褐
COL[M_WOOD] = rgb(100, 72, 42)
COL[M_SMOKE] = rgb(70, 70, 80)
COL[M_STEAM] = rgb(160, 180, 200)
COL[M_BLOOD] = rgb(164, 16, 20)    // 更纯的猩红
COL[M_POWDER] = rgb(46, 46, 50)
COL[M_COAL] = rgb(40, 40, 44)      // 煤:比火药更黑(coalmine 煤脉本体,Noita coal #202020 系)
COL[M_ICE] = rgb(158, 208, 234)
COL[M_GOLD] = rgb(255, 208, 84)    // #ffd054:与 Noita 一致,唯一的"贵气"高亮
COL[M_MOSS] = rgb(98, 132, 44)     // 煤矿草丛偏黄绿(5/f00240 平台上沿那层毛草),暗绿在暗光里读成黑
COL[M_DIRT] = rgb(86, 70, 42)      // soil #36311e:深橄榄棕

// ── 材质纹理(Noita 真方案):每种材质一张 64×64 平铺贴图,按世界坐标采样 ──
// materials.xml 每种材质带 texture_file(data/materials_gfx/*.png),引擎按坐标平铺;
// 原版 randomize_colors 从不启用——逐像素随机噪点(我们旧的 shade 抖动)恰是 Noita 明确不用的。
// 连贯纹理让一坨沙读成"沙丘"而不是"黄色雪花屏"。这里用程序纹理替代手绘,配方各材质一套。
const TEXW = 64, TEXSZ = TEXW * TEXW
const MATTEX = new Uint32Array(NMAT * TEXSZ)
{
  /** 可平铺 value noise(格点周期回绕,双线性+smoothstep) */
  const makeNoise = (seed, cells) => {
    const g = cells
    const vals = new Float32Array(g * g)
    let s = seed >>> 0
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < g * g; i++) vals[i] = rnd()
    const step = TEXW / g
    return (x, y) => {
      const fx = x / step, fy = y / step
      const x0 = fx | 0, y0 = fy | 0
      const tx = fx - x0, ty = fy - y0
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
      const xa = x0 % g, ya = y0 % g, xb = (x0 + 1) % g, yb = (y0 + 1) % g
      const v00 = vals[ya * g + xa], v10 = vals[ya * g + xb]
      const v01 = vals[yb * g + xa], v11 = vals[yb * g + xb]
      return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy
    }
  }
  /** 逐纹素确定性哈希(0..1),做稀疏颗粒/亮斑 */
  // 两轮 xorshift-乘法雪崩:旧版单次 imul 混合不够,颗粒会排成一条条斜线(放大后土面像被耙过)
  const hash = (x, y, k) => {
    let h = (x * 374761393 + y * 668265263 + (k + 1) * 2246822519) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h = Math.imul(h ^ (h >>> 16), 2246822519)
    h ^= h >>> 15
    return (h >>> 0) / 4294967296
  }
  const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0)
  /** 以 COL[m] 为锚,fn(x,y)->[dr,dg,db] 或完整 [r,g,b,1] */
  const build = (m, fn) => {
    const c = COL[m], br = c & 255, bg = (c >> 8) & 255, bb = (c >> 16) & 255
    const o = m * TEXSZ
    for (let y = 0; y < TEXW; y++) for (let x = 0; x < TEXW; x++) {
      const d = fn(x, y)
      MATTEX[o + y * TEXW + x] = d.length === 4
        ? rgb(clamp8(d[0]), clamp8(d[1]), clamp8(d[2]))
        : rgb(clamp8(br + d[0]), clamp8(bg + d[1]), clamp8(bb + d[2]))
    }
  }
  // 默认:全部先铺平色(气体/火/熔岩走各自渲染分支,平色即可)
  for (let m = 0; m < NMAT; m++) {
    const o = m * TEXSZ
    MATTEX.fill(COL[m], o, o + TEXSZ)
  }
  // 石:低频明暗斑块 + 暗色裂缝脉络 + 稀有浅色矿斑
  const sn1 = makeNoise(11, 8), sn2 = makeNoise(23, 16), sn3 = makeNoise(37, 8)
  build(M_STONE, (x, y) => {
    const n = sn1(x, y) * 0.7 + sn2(x, y) * 0.3
    let d = (n - 0.5) * 34
    const cr = sn3(x, y)
    if (cr > 0.488 && cr < 0.512) d -= 26 // 裂缝:噪声等值线,天然连成脉络(带宽/深度都要克制,暗处过粗的圈读成啃痕)
    if (hash(x, y, 1) < 0.012) d += 34
    return [d, d, d + 3]
  })
  // 沙:中频波纹 + 深色颗粒 + 亮沙粒(Noita 沙丘的"颗粒感"来自离散色阶而非渐变)
  const an1 = makeNoise(51, 16), an2 = makeNoise(67, 4)
  build(M_SAND, (x, y) => {
    let d = (an1(x, y) - 0.5) * 30 + (an2(x, y) - 0.5) * 22
    const h1 = hash(x, y, 2)
    if (h1 < 0.1) d -= 48        // 深色颗粒
    else if (h1 > 0.945) d += 30 // 反光亮粒
    return [d, d * 0.92, d * 0.7]
  })
  // 泥土:团块 + 土疙瘩 + 小石子
  const dn1 = makeNoise(81, 8)
  // (Noita soil 贴图观感:暗棕底上撒的是"亮"砂粒,不是黑点——黑点多了像煤渣)
  build(M_DIRT, (x, y) => {
    let d = (dn1(x, y) - 0.5) * 30
    const h1 = hash(x, y, 3)
    if (h1 < 0.05) d -= 24
    else if (h1 < 0.17) d += 22
    else if (h1 > 0.992) return [122 + d, 118 + d, 112 + d, 1] // 灰白小石子
    return [d, d * 0.9, d * 0.75]
  })
  // 木:横向年轮纹(相位被噪声扰动,不是死板条纹)
  const wn1 = makeNoise(97, 8)
  build(M_WOOD, (x, y) => {
    const w = Math.sin((y + wn1(x, y) * 5.5) * 1.05)
    const d = w * 20 - 5 + (hash(x, y, 4) < 0.05 ? -18 : 0)
    return [d, d * 0.85, d * 0.7]
  })
  // 金:亮斑闪点 + 暗缝(金块的"贵"来自高对比小面)
  const gn1 = makeNoise(113, 8)
  build(M_GOLD, (x, y) => {
    const h1 = hash(x, y, 5)
    if (h1 < 0.045) return [255, 246, 190, 1]
    let d = (gn1(x, y) - 0.5) * 26
    if (h1 > 0.92) d -= 62
    return [d * 0.4, d, d * 1.2]
  })
  // 冰:斜向冰纹 + 稀有亮晶面
  const in1 = makeNoise(131, 8)
  build(M_ICE, (x, y) => {
    let d = (in1(x, y) - 0.5) * 20
    if ((x + y + in1(x, y) * 9) % 16 < 2.6) d += 20
    if (hash(x, y, 6) < 0.018) d += 46
    return [d, d, d * 0.6]
  })
  // 火药:深灰基底 + 浅灰颗粒 + 硫磺点
  build(M_POWDER, (x, y) => {
    const h1 = hash(x, y, 7)
    if (h1 < 0.07) return [88, 88, 94, 1]
    if (h1 > 0.988) return [128, 116, 62, 1]
    const d = (hash(x, y, 8) - 0.5) * 14
    return [d, d, d]
  })
  // 煤:近黑基底 + 稀有反光晶面(煤块的"亮"来自解理面,不是颗粒)
  build(M_COAL, (x, y) => {
    const h1 = hash(x, y, 21)
    if (h1 < 0.04) return [92, 92, 102, 1]
    const d = (hash(x, y, 22) - 0.5) * 12
    return [d, d, d + 2]
  })
  // 苔藓:双绿点簇
  const mn1 = makeNoise(149, 16)
  build(M_MOSS, (x, y) => {
    let d = (mn1(x, y) - 0.5) * 26
    const h1 = hash(x, y, 9)
    if (h1 < 0.22) d -= 22
    else if (h1 > 0.93) d += 26
    return [d * 0.6, d, d * 0.4]
  })
  // 液体:极低幅低频起伏(避免死平,但绝不能有颗粒噪点——液体是"面"不是"粒")
  for (const [m, seed] of [[M_WATER, 163], [M_OIL, 179], [M_BLOOD, 193]]) {
    const ln = makeNoise(seed, 4)
    build(m, (x, y) => {
      const d = (ln(x, y) - 0.5) * 14
      return [d, d, d]
    })
  }
}
// ── 地下背景墙(对标 weather_gfx/background_coalmine.png 的观感,不搬资产):一张极暗的冷灰岩壁 ──
// 实测原图:基色 ≈(22,24,28),全图对比只有 ±6,隐约画着洞顶钟乳/岩坎和木架轮廓。要点是"暗且冷",
// 让被光照亮的暖棕地形从它前面跳出来。旧版分带砖缝格 + 0.12 亮度保底会让背景比黑掉的地形还亮(墙洞反读)。
const BGW = 256, BGH = 128
const BGTEX = new Uint32Array(BGW * BGH)
{
  const wrapNoise = (seed, cx, cy) => {
    const vals = new Float32Array(cx * cy)
    let s = seed >>> 0
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < cx * cy; i++) vals[i] = rnd()
    return (x, y) => {
      const fx = (x / BGW) * cx, fy = (y / BGH) * cy
      const x0 = fx | 0, y0 = fy | 0
      const tx = fx - x0, ty = fy - y0
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
      const xa = x0 % cx, ya = y0 % cy, xb = (x0 + 1) % cx, yb = (y0 + 1) % cy
      const v00 = vals[ya * cx + xa], v10 = vals[ya * cx + xb], v01 = vals[yb * cx + xa], v11 = vals[yb * cx + xb]
      return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy
    }
  }
  const big = wrapNoise(7, 4, 2), mid2 = wrapNoise(19, 12, 6), fine = wrapNoise(31, 32, 16), tongue = wrapNoise(43, 20, 1)
  for (let y = 0; y < BGH; y++) for (let x = 0; x < BGW; x++) {
    // 大团块=远处岩坎剪影,中频=岩面起伏,细噪=颗粒;总幅度压在 ±7 以内
    let d = (big(x, y) - 0.5) * 9 + (mid2(x, y) - 0.5) * 5 + (fine(x, y) - 0.5) * 3
    // 洞顶钟乳感:上沿一条起伏的暗檩(高度沿 x 连续变化,边缘 5px 渐出——硬边等宽的柱子读成栅栏)
    const th = 6 + tongue(x, 0) * 34
    if (y < th) d -= 3.5 * Math.min(1, (th - y) / 5)
    // 背景木架:每 ~96px 一根很淡的竖梁 + 一道横梁(原图就有,但几乎看不见——对比 3 以内)
    const gx = (x + 37) % 96, gy = (y + 11) % 64
    if (gx < 2 || gy < 2) d += 3
    const v = 22 + d
    BGTEX[y * BGW + x] = rgb(Math.max(8, v) | 0, Math.max(9, v + 2) | 0, Math.max(11, v + 6) | 0)
  }
}
/** 光照:发光材质做种子,两遍扫描传播,岩石内衰减加倍(挡光) */
function computeLight() {
  light.fill(0)
  // 光照同样只算激活窗口:边距 48 > 最大传播距离(255/7≈36),屏缘光照无缝
  const [wx0, wx1, wy0, wy1] = simWindow()
  for (let y = wy0; y <= wy1; y++) {
    for (let x = wx0; x < wx1; x++) {
      const i = y * SW + x
      const m = grid[i]
      if (m === M_FIRE) {
        light[i] = 235
        if (Math.random() < 0.004) addSpark(x, y, (Math.random() - 0.5) * 30, -18 - Math.random() * 16, 0.4, [255, 190, 90])
      } else if (m === M_LAVA) {
        light[i] = 215 // 热辐射:熔岩上方空气烘出橙色光柱
        if (Math.random() < 0.0012) addSpark(x, y - 1, (Math.random() - 0.5) * 24, -22 - Math.random() * 20, 0.45, [255, 140, 50])
      } else if (elec[i] > 0 && CONDUCTIVE[m]) {
        light[i] = Math.max(light[i], 135) // 带电水池自发光
      }
    }
  }
  for (const f of flashes) {
    // 闪光照亮地形(b0032 标定:起爆瞬间周围地形被照成金黄)——半径按闪光实际大小,中心全亮边缘衰减
    const fr = Math.max(3, f.r * (0.5 + 0.5 * (f.life / f.max)))
    const fr2 = fr * fr
    for (let y = (f.y - fr) | 0; y <= f.y + fr; y++) for (let x = (f.x - fr) | 0; x <= f.x + fr; x++) {
      if (!inB(x, y)) continue
      const d2 = (x - f.x) ** 2 + (y - f.y) ** 2
      if (d2 > fr2) continue
      const lv = 255 * (1 - Math.sqrt(d2 / fr2) * 0.55)
      const i = idx(x, y)
      if (light[i] < lv) light[i] = lv
    }
  }
  for (const b of bullets) {
    const i = idx(b.x | 0, b.y | 0)
    if (i >= 0 && i < N) light[i] = Math.max(light[i], 200)
  }
  for (const s of sparks) {
    const i = idx(s.x | 0, s.y | 0)
    if (i >= 0 && i < N) light[i] = Math.max(light[i], 150)
  }
  if (player.dead <= 0) {
    // 巫师提灯:小光盘种子(比单像素点光照得远得多)
    const px = player.x | 0, py = player.y | 0
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 5) continue
      if (inB(px + dx, py + dy)) {
        const i = idx(px + dx, py + dy)
        light[i] = Math.max(light[i], 225)
      }
    }
  }
  // 两遍扫描传播(含对角,光斑更圆);固体挡光,液体吸光(水下视野短)
  for (let y = wy0; y <= wy1; y++) {
    for (let x = wx0; x < wx1; x++) {
      const i = idx(x, y)
      const m = grid[i]
      const D = IS_SOLID[m] ? 24 : IS_LIQUID[m] ? 14 : 7
      const Dd = D * 1.42
      let v = light[i]
      if (x > 0 && light[i - 1] - D > v) v = light[i - 1] - D
      if (y > 0) {
        if (light[i - SW] - D > v) v = light[i - SW] - D
        if (x > 0 && light[i - SW - 1] - Dd > v) v = light[i - SW - 1] - Dd
        if (x < SW - 1 && light[i - SW + 1] - Dd > v) v = light[i - SW + 1] - Dd
      }
      light[i] = v
    }
  }
  for (let y = wy1; y >= wy0; y--) {
    for (let x = wx1 - 1; x >= wx0; x--) {
      const i = idx(x, y)
      const m = grid[i]
      const D = IS_SOLID[m] ? 24 : IS_LIQUID[m] ? 14 : 7
      const Dd = D * 1.42
      let v = light[i]
      if (x < SW - 1 && light[i + 1] - D > v) v = light[i + 1] - D
      if (y < SH - 1) {
        if (light[i + SW] - D > v) v = light[i + SW] - D
        if (x < SW - 1 && light[i + SW + 1] - Dd > v) v = light[i + SW + 1] - Dd
        if (x > 0 && light[i + SW - 1] - Dd > v) v = light[i + SW - 1] - Dd
      }
      light[i] = v
    }
  }
}
/** 世界坐标 → 取景窗缓冲索引(不在视口内返回 -1) */
function vIdx(wx, wy) {
  const x = (wx | 0) - camIX
  const y = (wy | 0) - camIY
  if (x < 0 || x >= VW || y < 0 || y >= VH) return -1
  return y * VW + x
}
function render() {
  camIX = cam.x | 0
  camIY = cam.y | 0
  computeLight()
  // 发射物动态光:子弹/敌弹作为移动光源照亮洞窟(Noita 手感的大头——光跟着弹走)
  // soft=true:二次衰减 amp·(1-t²),中心一大片近全亮再滑落(Noita 灯光贴图的观感);false:线性小光点
  const splatLight = (wx, wy, r, amp, soft = false) => {
    if (wx < camIX - r || wx > camIX + VW + r || wy < camIY - r || wy > camIY + VH + r) return
    const x0 = Math.max(1, (wx - r) | 0), x1 = Math.min(SW - 2, (wx + r) | 0)
    const y0 = Math.max(1, (wy - r) | 0), y1 = Math.min(SH - 2, (wy + r) | 0)
    const r2 = r * r
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dd = (x - wx) ** 2 + (y - wy) ** 2
      if (dd > r2) continue
      const v = soft ? (amp * (1 - dd / r2)) | 0 : (amp * (1 - Math.sqrt(dd) / r)) | 0
      const i2 = y * SW + x
      if (light[i2] < v) light[i2] = v
    }
  }
  for (const b of bullets) splatLight(b.x, b.y, b.small ? 6 : 9, b.pay === 'kinetic' ? 110 : 150)
  for (const b of ebullets) splatLight(b.x, b.y, 6, 100)
  // 玩家光环(Noita halo):原作玩家灯是一张大而软的径向光贴图,半径 ≈200 世界px、不被地形遮挡
  // (5/f00240:半屏宽的柔光盘,隔着墙的邻洞也被照到)。按身高换算(×0.6)≈120px,二次衰减。
  // 之前只给 34px 线性小圈 + 传播光 32px:屏幕上就一小团亮,其余全黑,"探索感"根本出不来。
  if (player.dead <= 0) splatLight(player.x, player.y - 2, 120, 235, true)
  // 火把/火盆:同样是大暖光(原作 torch 光半径 ≈80px),传播模型算出的 33px 只够照亮火本身
  for (const t of torches) splatLight(t.x, t.y - 1, 50, 200, true)
  ebuf.fill(0)
  elecSurf.length = 0
  // 视差远山:三层分形脊线按列采样(远 0.13/中 0.3/近 0.52,镜头动 1px 各层慢速跟移)
  const sunSX = VW * 0.24 // 太阳光晕锚点(屏幕系,无限远视差≈0)
  const rF = new Float32Array(VW), rM = new Float32Array(VW), rC = new Float32Array(VW)
  for (let x = 0; x < VW; x++) {
    rF[x] = ridgeF[(x + ((camIX * 0.13) | 0)) & RIDGE_M]
    rM[x] = ridgeM[(x + ((camIX * 0.3) | 0)) & RIDGE_M]
    rC[x] = ridgeC[(x + ((camIX * 0.52) | 0)) & RIDGE_M]
  }
  // 世界层(只渲染取景窗):环境光(洞穴越深越黑) × 动态光,发光材质全亮并进辉光层
  for (let y = 0; y < VH; y++) {
    const wy = y + camIY
    for (let x = 0; x < VW; x++) {
      const wx = x + camIX
      const gi = idx(wx, wy)
      const vi = y * VW + x
      let m = grid[gi]
      // 气体稀疏抖动:寿命越短像素越稀(按概率当空气渲染出背景)——烟雾"变透明"地消散,不再是实心黑块
      if (IS_GAS[m] && Math.random() > 0.3 + Math.min(1, aux[gi] / 30) * 0.7) m = M_EMPTY
      // 环境亮度:地表以上全亮,往下递减到黑;分区再调(深矿黑得压抑,圣所亮堂)
      let amb = wy <= surfY[wx] ? 235 : Math.max(10, 235 - (wy - surfY[wx]) * 4.2)
      if (wy >= UG_Y0) {
        const zd = ZONE_DIM[zoneGrid[Math.min(8, ((wy - UG_Y0) / ZH) | 0) * 16 + Math.min(15, (wx / ZW) | 0)]]
        if (zd !== 1) amb *= zd
      }
      if (worldMod === 'dark' && wy > surfY[wx]) amb *= 0.5 // P4 黑暗:地下环境光减半
      let lum = light[gi] > amb ? light[gi] : amb
      // 边缘检测(Noita pixel_top/bottom/side 换色的判定):固体贴空气的方向决定描边方式
      let upO = false, dnO = false, sdO = false
      if (IS_SOLID[m]) {
        const up = grid[gi - SW], dn = gi + SW < N ? grid[gi + SW] : M_STONE
        upO = up === M_EMPTY || IS_GAS[up]
        dnO = dn === M_EMPTY || IS_GAS[dn]
        sdO = grid[gi - 1] === M_EMPTY || grid[gi + 1] === M_EMPTY
        // 洞壁可读性:贴空气的边微提亮——必须以乘法为主(f306-f375 标定:未照亮处纯黑,
        // +14 常数加法会让全图轮廓在黑暗里若隐若现,读成"满屏碎线")
        if (upO || sdO) lum = Math.min(255, lum * 1.34 + 3)
        else if (dnO) lum = Math.min(255, lum * 1.12 + 1)
      }
      if (m === M_FIRE) {
        // Noita 式火焰:稀疏颗粒结构(部分像素露黑隙/压暗)+ 大亮度方差,火有"呼吸感"
        const rr = Math.random()
        if (rr < 0.2) {
          buf32[vi] = rgb(64, 20, 6) // 黑隙:近黑暗红,不进辉光
          continue
        }
        const fa = aux[gi]
        let c
        if (rr > 0.88) c = rgb(255, 250, 214) // 白热闪点(任何阶段都可能爆一下)
        else if (fa > 34) c = rgb(255, 226, 150)
        else if (fa > 15) c = rr < 0.5 ? rgb(255, 148, 40) : rgb(255, 106, 24)
        else c = rr < 0.5 ? rgb(216, 62, 14) : rgb(168, 38, 8)
        buf32[vi] = c
        ebuf[vi] = c
        // 火舌:表面火焰向上舔 1-3px(纯渲染层,行序自上而下所以上一行已画完,直接覆写)
        if (grid[gi - SW] === M_EMPTY && rr < 0.62 && vi - VW >= 0) {
          const tc = rr < 0.2 ? rgb(255, 240, 176) : rgb(255, 132, 30)
          buf32[vi - VW] = tc
          ebuf[vi - VW] = tc
          if (rr < 0.22 && vi - VW * 2 >= 0 && grid[gi - SW * 2] === M_EMPTY) {
            buf32[vi - VW * 2] = rgb(235, 90, 18)
            ebuf[vi - VW * 2] = rgb(200, 66, 12)
            if (rr < 0.06 && vi - VW * 3 >= 0 && grid[gi - SW * 3] === M_EMPTY) {
              buf32[vi - VW * 3] = rgb(190, 58, 10)
              ebuf[vi - VW * 3] = rgb(150, 44, 8)
            }
          }
        }
        // 余烬:迸出上升火星(重力会把它拉成小弧线)
        if (Math.random() < 0.012) addSpark(wx, wy, (Math.random() - 0.5) * 16, -32 - Math.random() * 24, 0.5 + Math.random() * 0.35, [255, 170, 60])
        continue
      }
      if (m === M_LAVA) {
        // 表面亮壳:接触空气的熔岩更亮(辐射面);白热泡点沿表面游走 = 沸腾感
        const surf = wy > 0 && (grid[gi - SW] === M_EMPTY || IS_GAS[grid[gi - SW]])
        let c
        if (surf) {
          c = (wx * 5 + frame + shade[gi] * 7) % 60 < 9 ? rgb(255, 246, 178) : rgb(255, 186, 66)
          // 熔岩气泡:啵啵迸出亮渣
          if (Math.random() < 0.008) addSpark(wx, wy - 1, (Math.random() - 0.5) * 12, -24 - Math.random() * 20, 0.4, [255, 205, 95])
        } else {
          c = (frame + shade[gi]) % 40 < 20 ? rgb(240, 80, 16) : rgb(200, 52, 8)
        }
        buf32[vi] = c
        ebuf[vi] = c
        continue
      }
      if (m === M_EMPTY) {
        // 空气:背景墙(暗色装饰层) > 天空渐变;再叠轻微暖色光雾
        const bgid = bgGrid[gi]
        let r, g, b
        const k = lum / 235
        if (bgid > 0) {
          // 背景墙:极暗冷灰岩壁贴图 × 光照。没有亮度保底——原作里没被照到的洞就是纯黑,
          // 背景只在光里隐约浮现,且永远比同一处被照亮的地形暗一个量级(墙在前、背景在后才读得出纵深)
          const c = BGTEX[((wy & 127) << 8) | (wx & 255)]
          const kb = k * 1.15 + 0.02
          r = (c & 255) * kb
          g = ((c >> 8) & 255) * kb
          b = ((c >> 16) & 255) * kb
        } else if (wy < surfY[wx]) {
          // 天空(f15 逆光黄昏的商业配方):落日渐变+太阳光晕+三层脊线山(空气透视:远亮近暗)
          if (wy >= rC[x]) { r = 60; g = 38; b = 40 }        // 近山(带针叶林剪影)
          else if (wy >= rM[x]) { r = 106; g = 62; b = 52 }  // 中山
          else if (wy >= rF[x]) { r = 146; g = 92; b = 68 }  // 远山(接近天色)
          else {
            const tt = Math.min(1, wy / 96)
            r = 100 + 116 * tt
            g = 58 + 78 * tt
            b = 44 + 30 * tt
          }
          // 太阳光晕:地平线附近的暖光团,罩住天空、半罩远山(逆光透光感)
          const dxs = x - sunSX, dys = wy - 72
          const sd2 = dxs * dxs + dys * dys
          if (sd2 < 8100) {
            const glow = (1 - Math.sqrt(sd2) / 90) ** 2 * (wy >= rF[x] ? 0.42 : 1)
            r += 132 * glow
            g += 76 * glow
            b += 24 * glow
          }
        } else {
          r = (10 + wy * 0.06) * (0.35 + k * 0.65)
          g = 12 * (0.35 + k * 0.65)
          b = (22 + (SH - wy) * 0.1) * (0.35 + k * 0.65)
        }
        // 中景装饰(树/蘑菇):覆盖天空/背景,但只画在空气格=永远在地形与玩家身后
        const mg = midGrid[gi]
        if (mg > 0) {
          const p = MID_PAL[mg - 1]
          const dith = ((wx * 7 + wy * 13) % 5) * 3 - 6 // 微纹理:纯色块会像贴纸
          const mk = 0.55 + k * 0.45
          r = (p[0] + dith) * mk
          g = (p[1] + dith) * mk
          b = (p[2] + dith) * mk
        }
        // 草皮发丝(f36 近景质感):地表线上长 1~2px 草茎,确定性 hash=不闪烁;冰川雪面不长
        if (wy >= surfY[wx] - 2 && wy < surfY[wx] && biomeArr[wx] !== 0) {
          const hsh = ((wx * 2654435761) >>> 16) % 100
          const gh = hsh < 38 ? 1 : hsh < 60 ? 2 : 0
          if (gh > 0 && wy >= surfY[wx] - gh) {
            const oil2 = biomeArr[wx] === 2
            const gk = 0.5 + k * 0.5
            r = (oil2 ? 118 : 56) * gk + (hsh % 7) * 2
            g = (oil2 ? 92 : 98) * gk
            b = (oil2 ? 40 : 34) * gk
          }
        }
        // 暖色光雾:只留一点点——原作被照亮的背景仍是冷灰偏暗(≈35,32,30),之前 0.12 把整面背景熏成棕色
        const gl = light[gi]
        if (gl > 0) { r += gl * 0.05; g += gl * 0.028; b += gl * 0.008 }
        buf32[vi] = rgb(Math.min(255, r) | 0, Math.min(255, g) | 0, Math.min(255, b) | 0)
        continue
      }
      // 带电液体:高频频闪(整体同步的 strobe 比逐像素随机更像电)+ 收集表面点供爬弧
      if (elec[gi] > 0 && IS_LIQUID[m]) {
        if (elecSurf.length < 10 && wy > 0 && grid[gi - SW] === M_EMPTY && Math.random() < 0.03) elecSurf.push([wx, wy])
        const strobe = ((frame >> 1) + ((gi / 37) | 0)) % 6 < 2
        if (strobe && Math.random() < 0.4) {
          const c = rgb(190, 230, 255)
          buf32[vi] = c
          ebuf[vi] = c
          continue
        }
      }
      // 材质纹理采样(按世界坐标平铺,Noita materials_gfx 同款);shade 只留弹坑焦痕(>26 才算)
      const c = MATTEX[(m << 12) | ((wy & 63) << 6) | (wx & 63)]
      const s = shade[gi] > 26 ? shade[gi] : 0
      const k = lum / 255
      let r = ((c & 255) - s) * k, g = (((c >> 8) & 255) - s) * k, b = (((c >> 16) & 255) - s) * k
      // 边缘换色(Noita pixel_top/pixel_bottom/pixel_side):顶边受光高光,底边阴影,侧边微亮
      // 加法项必须乘 k(光照系数)——暗处固定亮边会把洞壁每颗锯齿都点亮成"狗啃"
    if (upO) {
      if (wy > surfY[wx] + 3 && (m === M_DIRT || m === M_MOSS)) {
        // 草皮:只有土面长草(Noita 真规则:grows_grass 标签只挂 soil)——石/煤顶面不长,
        // 全材质描绿边是"满图碎绿线"的元凶(f01148 标定:草只在大平台土面上)
        r = r * 0.35 + 74 * k; g = g * 0.35 + 96 * k; b = b * 0.35 + 30 * k
      } else { r = r * 1.22 + 22 * k; g = g * 1.22 + 20 * k; b = b * 1.16 + 14 * k }
    } else if (dnO) { r *= 0.58; g *= 0.58; b *= 0.62 }
      else if (sdO) { r = r * 1.08 + 7 * k; g = g * 1.08 + 7 * k; b = b * 1.05 + 5 * k }
      // 水半透明(Noita water alpha≈0.63):透出背景墙,水体才是"水"不是蓝色果冻
      if (m === M_WATER) {
        const bgid = bgGrid[gi]
        let br2, bg2, bb2
        if (bgid > 0) { const c2 = BGTEX[((wy & 127) << 8) | (wx & 255)]; br2 = c2 & 255; bg2 = (c2 >> 8) & 255; bb2 = (c2 >> 16) & 255 }
        else { br2 = 10 + wy * 0.06; bg2 = 12; bb2 = 22 + (SH - wy) * 0.1 }
        r = r * 0.66 + br2 * k * 0.34
        g = g * 0.66 + bg2 * k * 0.34
        b = b * 0.66 + bb2 * k * 0.34
      }
      // 液体表面高光(镜面反光条)+ 流动波光;液体越深越暗(体积感);气体随寿命淡出
      if (IS_LIQUID[m] && wy > 0 && (grid[gi - SW] === M_EMPTY || IS_GAS[grid[gi - SW]])) {
        // 高光/波光加法项必须乘 k:黑暗洞窟里的水池不该自己发亮成一排亮点(反光=反"光",没光没反光)
        r = Math.min(255, r * 1.5 + 20 * k)
        g = Math.min(255, g * 1.45 + 18 * k)
        b = Math.min(255, b * 1.3 + 14 * k)
        // 波光:2-3px 亮条沿水面漂移(wx*3 → 连续短条而非孤点,读起来像反光在流动)
        if ((wx * 3 + wy * 5 + (frame >> 1)) % 41 < 5) {
          r = Math.min(255, r + 105 * k)
          g = Math.min(255, g + 105 * k)
          b = Math.min(255, b + 85 * k)
          if (m === M_WATER && k > 0.25) ebuf[vi] = rgb(85 * k, 115 * k, 135 * k) // 水面波光进辉光层,微微glisten
        }
      } else if (IS_LIQUID[m]) {
        // 深度渐暗:往上找最近空气,越深越暗(最多探6格,给水体"厚度")
        let dep = 0
        while (dep < 6 && IS_LIQUID[grid[gi - SW * (dep + 1)]] === 1) dep++
        const dk = 1 - dep * 0.05
        r *= dk
        g *= dk
        b *= dk
      } else if (IS_GAS[m]) {
        const k2 = Math.min(1, aux[gi] / 28 + 0.2)
        r *= k2
        g *= k2
        b *= k2
      }
      buf32[vi] = rgb(r < 0 ? 0 : r > 255 ? 255 : r | 0, g < 0 ? 0 : g > 255 ? 255 : g | 0, b < 0 ? 0 : b > 255 ? 255 : b | 0)
    }
  }
  // 带电水面爬弧:每帧随机在液面两点间劈一道小闪电
  if (elecSurf.length >= 2 && Math.random() < 0.55) {
    const a = elecSurf[(Math.random() * elecSurf.length) | 0]
    const b = elecSurf[(Math.random() * elecSurf.length) | 0]
    if (a !== b) spawnBolt(a[0], a[1] - 1, b[0], b[1] - 1, 2.2)
  }
  // 闪电光栅化(主画面亮白芯 + 辉光层蓝)
  {
    const core = rgb(240, 248, 255)
    const glow = rgb(140, 200, 255)
    for (const bo of bolts) {
      if ((frame & 1) && bo.life < 3) continue // 尾声频闪
      for (let s = 0; s < bo.pts.length - 1; s++) {
        const [ax, ay] = bo.pts[s]
        const [bx, by] = bo.pts[s + 1]
        const steps = Math.max(1, Math.max(Math.abs(bx - ax), Math.abs(by - ay)) | 0)
        for (let k = 0; k <= steps; k++) {
          const vi = vIdx(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps)
          if (vi >= 0) {
            buf32[vi] = core
            ebuf[vi] = glow
          }
        }
      }
    }
  }
  // 环境浮尘(只画在空气里,暗色不进辉光;必须乘光照——雪点不受光=黑洞窟里满屏"星星",
  // f306-f375 标定:未照亮处纯黑,浮尘只在光锥里可见)
  for (const mt of motes) {
    const mx = mt.x | 0, my = mt.y | 0
    const gi2 = idx(mx, my)
    if (gi2 < 0 || gi2 >= N || grid[gi2] !== M_EMPTY) continue
    const vi = vIdx(mt.x, mt.y)
    if (vi < 0) continue
    const b = biomeArr[Math.max(0, Math.min(SW - 1, mx))]
    let amb2 = my <= surfY[mx] ? 235 : Math.max(10, 235 - (my - surfY[mx]) * 4.2)
    if (worldMod === 'dark' && my > surfY[mx]) amb2 *= 0.5
    const k2 = Math.max(light[gi2], amb2) / 255
    if (k2 < 0.1) continue // 全黑处直接不画
    const cr = b === 0 ? 168 : b === 1 ? 76 : 66
    const cg = b === 0 ? 182 : b === 1 ? 102 : 50
    const cb = b === 0 ? 200 : b === 1 ? 54 : 32
    buf32[vi] = rgb((cr * k2) | 0, (cg * k2) | 0, (cb * k2) | 0)
  }
  // 碎屑(快速飞行的补一枚半暗尾像素:视觉连贯,不再是跳动的孤点;col=真材质色覆盖)
  for (const p of parts) {
    const c = p.col || COL[p.m] || rgb(200, 200, 200)
    const vi = vIdx(p.x, p.y)
    if (vi >= 0) buf32[vi] = c
    if (Math.abs(p.vx) + Math.abs(p.vy) > 60) {
      const vi2 = vIdx(p.x - p.vx * 0.013, p.y - p.vy * 0.013)
      if (vi2 >= 0 && vi2 !== vi) buf32[vi2] = rgb((c & 255) * 0.45 | 0, ((c >> 8) & 255) * 0.45 | 0, ((c >> 16) & 255) * 0.45 | 0)
    }
  }
  // 崩塌岩块:MATTEX 采样+光照,和静止地形无缝(它就是刚被抠下来的地形)
  for (const c of chunks) {
    for (const cell of c.cells) {
      const wx = c.x + cell.dx, wy = c.y + cell.dy
      if (wy >= SH) continue
      const vi = vIdx(wx, wy)
      if (vi < 0) continue
      const gi = idx(wx, wy)
      let amb = wy <= surfY[wx] ? 235 : Math.max(10, 235 - (wy - surfY[wx]) * 4.2)
      if (worldMod === 'dark' && wy > surfY[wx]) amb *= 0.5
      const lum = light[gi] > amb ? light[gi] : amb
      const k2 = lum / 255
      const tc = MATTEX[(cell.m << 12) | ((wy & 63) << 6) | (wx & 63)]
      buf32[vi] = rgb(((tc & 255) * k2) | 0, (((tc >> 8) & 255) * k2) | 0, (((tc >> 16) & 255) * k2) | 0)
    }
  }
  // 子弹:亮头 + 两节拖尾(拖尾进辉光层,飞行轨迹清晰可见)
  for (const b of bullets) {
    const w = b.col
    const sp = Math.hypot(b.vx, b.vy) || 1
    const isZap = b.pay === 'zap'
    for (let t = 0; t < 3; t++) {
      let bxp = b.x - (b.vx / sp) * t * 1.4
      let byp = b.y - (b.vy / sp) * t * 1.4
      // 电弹:拖尾横向抖动,飞行轨迹本身就是锯齿电弧
      if (isZap && t > 0) {
        const j = ((Math.random() * 3) | 0) - 1
        bxp += -(b.vy / sp) * j
        byp += (b.vx / sp) * j
      }
      const vi = vIdx(bxp, byp)
      if (vi < 0) continue
      const k = 1 - t * 0.3
      const c = rgb(w[0] * k | 0, w[1] * k | 0, w[2] * k | 0)
      buf32[vi] = c
      ebuf[vi] = c
    }
    // 弹头星芒:白核 + 四臂载荷色(Noita 的法术弹是小星星,不是圆点)
    if (!b.small) {
      const hv = vIdx(b.x, b.y)
      if (hv >= 0) {
        buf32[hv] = rgb(255, 252, 240)
        ebuf[hv] = rgb(255, 252, 240)
      }
      const armC = rgb(w[0], w[1], w[2])
      for (const [adx, ady] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const av = vIdx(b.x + adx, b.y + ady)
        if (av >= 0) {
          buf32[av] = armC
          ebuf[av] = armC
        }
      }
    }
    // 钻头弹:垂直于弹道加两侧像素(钻头有宽度)
    if (b.beh === 'drill') {
      const c = rgb(w[0], w[1], w[2])
      for (const s2 of [-1, 1]) {
        const vi = vIdx(b.x - (b.vy / sp) * s2, b.y + (b.vx / sp) * s2)
        if (vi >= 0) {
          buf32[vi] = c
          ebuf[vi] = c
        }
      }
    }
  }
  // 敌弹(红色;施法怪火弹橙色,发光)
  for (const b of ebullets) {
    const vi = vIdx(b.x, b.y)
    if (vi >= 0) {
      const c = b.fire ? rgb(255, 165, 45) : rgb(255, 80, 80)
      buf32[vi] = c
      ebuf[vi] = c
    }
  }
  // ── M1:星之核(脉动星芒)/ 随身星 + 祭坛信标 ──
  if (quest.state === 'seek') {
    const pulse = 0.6 + 0.4 * Math.sin(frame * 0.13)
    const cyq = quest.coreY + Math.sin(frame * 0.05) * 1.2
    const cc = rgb((160 + 90 * pulse) | 0, 235, 255)
    for (const [ox2, oy2] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const vi = vIdx(quest.coreX + ox2, cyq + oy2)
      if (vi >= 0) { buf32[vi] = cc; ebuf[vi] = cc }
    }
  } else {
    if (quest.state === 'carry' && player.dead <= 0) {
      // 头顶随身星 + 偶发星尘
      const cc = rgb(170, 240, 255)
      for (const [ox2, oy2] of [[0, 0], [1, 0], [-1, 0], [0, -1]]) {
        const vi = vIdx(Math.round(player.x) + ox2, Math.round(player.y) - 8 + oy2)
        if (vi >= 0) { buf32[vi] = cc; ebuf[vi] = cc }
      }
      if (Math.random() < 0.2) addSpark(player.x, player.y - 8, (Math.random() - 0.5) * 12, -6, 0.4, [150, 230, 255])
    }
    // 祭坛信标光柱(carry/won 常亮,回家的路标)
    const beam = quest.state === 'won' ? rgb(255, 232, 160) : rgb(255, 215, 120)
    for (let y = quest.altarY - 46; y < quest.altarY + 2; y += 2) {
      const vi = vIdx(quest.altarX, y + (frame % 2))
      if (vi >= 0) ebuf[vi] = beam
    }
    if (quest.state === 'won') {
      // 归位的星之核在祭台上脉动
      const pulse = 0.5 + 0.5 * Math.sin(frame * 0.1)
      const cc = rgb(255, (210 + 45 * pulse) | 0, (130 + 90 * pulse) | 0)
      for (const [ox2, oy2] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const vi = vIdx(quest.altarX + ox2, quest.altarY - 2 + oy2)
        if (vi >= 0) { buf32[vi] = cc; ebuf[vi] = cc }
      }
    }
  }
  // (装饰火花已迁移到"化妆粒子层":放大之后按屏幕分辨率画,见 render 尾部——Noita 的 cosmetic 粒子架构)
  // 爆炸闪光盘(辉光层专用,叠出白热闪)
  for (const f of flashes) {
    const rr = f.r * (f.life / f.max)
    for (let y = (f.y - rr) | 0; y <= f.y + rr; y++) {
      for (let x = (f.x - rr) | 0; x <= f.x + rr; x++) {
        if ((x - f.x) ** 2 + (y - f.y) ** 2 > rr * rr) continue
        const vi = vIdx(x, y)
        if (vi >= 0) ebuf[vi] = rgb(255, 210, 140)
      }
    }
  }
  // 敌人(像素圆 + 眼点;战机走精灵层)
  for (const mb of mobs) {
    if (mb.kind === 'fighter') {
      if (mb.burn > 0) {
        const vi = vIdx(mb.x + (Math.random() - 0.5) * 6, mb.y - 4)
        if (vi >= 0) buf32[vi] = rgb(255, 140, 30)
      }
      continue
    }
    // 感电频闪:整只怪打白光(电击的视觉冲击)
    const zapped = mb.stun > 0 && (frame & 2)
    if (mb.kind === 'caster') {
      // 施法怪:深红小巫师(与玩家同构,一眼认出"这是个施法者")
      const put = (x, y, c) => { const vi = vIdx(x, y); if (vi >= 0) buf32[vi] = c }
      const mx = Math.round(mb.x), my = Math.round(mb.y)
      const hat = zapped ? rgb(225, 240, 255) : rgb(150, 45, 80)
      const robe = zapped ? rgb(200, 225, 250) : rgb(96, 30, 56)
      const robeD = zapped ? rgb(170, 200, 240) : rgb(66, 20, 40)
      put(mx, my - 4, hat)
      for (let dx = -1; dx <= 1; dx++) put(mx + dx, my - 3, hat)
      put(mx, my - 2, rgb(232, 196, 160))
      for (let yy = -1; yy <= 2; yy++) { put(mx - 1, my + yy, robeD); put(mx, my + yy, robe); put(mx + 1, my + yy, robe) }
      if (mb.pour > 0) { // 施法期:杖尖紫光(倒油预警)
        const tvi = vIdx(mx + Math.sign(player.x - mb.x) * 3, my - 1)
        if (tvi >= 0) { buf32[tvi] = rgb(210, 150, 255); ebuf[tvi] = rgb(190, 120, 255) }
      }
      if (mb.burn > 0) {
        const vi = vIdx(mx + (Math.random() - 0.5) * 4, my - 5)
        if (vi >= 0) buf32[vi] = rgb(255, 140, 30)
      }
      continue
    }
    const col = zapped ? rgb(225, 240, 255) : mb.kind === 'oil' ? rgb(130, 100, 40) : rgb(190, 60, 70)
    const rim = zapped ? rgb(170, 210, 250) : mb.kind === 'oil' ? rgb(80, 62, 24) : rgb(120, 32, 40)
    for (let dy = -mb.r; dy <= mb.r; dy++) for (let dx = -mb.r; dx <= mb.r; dx++) {
      const dd = dx * dx + dy * dy
      if (dd > mb.r * mb.r) continue
      const vi = vIdx(mb.x + dx, mb.y + dy)
      if (vi < 0) continue
      buf32[vi] = dd > (mb.r - 1.2) ** 2 ? rim : col
    }
    const evi = vIdx(mb.x + Math.sign(player.x - mb.x) * 1.5, mb.y)
    if (evi >= 0) buf32[evi] = rgb(240, 240, 240)
    if (mb.burn > 0) {
      const vi = vIdx(mb.x + (Math.random() - 0.5) * mb.r * 2, mb.y - mb.r - Math.random() * 2)
      if (vi >= 0) buf32[vi] = rgb(255, 140, 30)
    }
  }
  // 玩家:像素小巫师(尖帽+袍子+魔杖——Noita 的巫师本来也就十几个像素)
  if (player.dead <= 0 && !(player.iframe > 0 && (frame >> 2) & 1)) {
    const px = Math.round(player.x), py = Math.round(player.y)
    const put = (x, y, c) => { const vi = vIdx(x, y); if (vi >= 0) buf32[vi] = c }
    const hurt = player.hurtT > 0
    const robe = hurt ? rgb(255, 110, 100) : rgb(52, 86, 158)
    const robeD = hurt ? rgb(200, 80, 70) : rgb(36, 60, 116)
    const skin = rgb(235, 195, 155)
    const hat = hurt ? rgb(255, 130, 110) : rgb(88, 60, 150)
    const face = mouse.x < player.x ? -1 : 1
    // 尖帽(帽尖顺脸歪一格)
    put(px + face, py - 5, hat)
    for (let dx = -1; dx <= 1; dx++) put(px + dx, py - 4, hat)
    for (let dx = -2; dx <= 2; dx++) put(px + dx, py - 3, hat)
    // 脸
    put(px, py - 2, skin)
    put(px + face, py - 2, skin)
    // 袍身
    for (let yy = -1; yy <= 2; yy++) {
      put(px - 1, py + yy, robeD)
      put(px, py + yy, robe)
      put(px + 1, py + yy, robe)
    }
    // 腿:走路两帧交替
    const step = player.onGround && Math.abs(player.vx) > 8 ? ((player.walkT * 10) | 0) & 1 : 0
    put(px - 1 + step, py + 3, robeD)
    put(px + 1 - step, py + 3, robeD)
    put(px - 1 + step, py + 4, robeD)
    put(px + 1 - step, py + 4, robeD)
    // 魔杖指向准星,杖尖随载荷发光
    const aimA = Math.atan2(mouse.y - (player.y - 1), mouse.x - player.x)
    for (let k = 2; k <= 4; k++) put(px + Math.round(Math.cos(aimA) * k), py - 1 + Math.round(Math.sin(aimA) * k), rgb(150, 110, 60))
    const wp = WANDS[player.wand].tipCol
    const tipC = rgb(wp[0], wp[1], wp[2])
    const tx = px + Math.round(Math.cos(aimA) * 5), ty = py - 1 + Math.round(Math.sin(aimA) * 5)
    put(tx, ty, tipC)
    const tvi = vIdx(tx, ty)
    if (tvi >= 0) ebuf[tvi] = tipC
    // 喷气火焰
    if (player.thrusting) {
      const fc = rgb(255, (160 + Math.random() * 60) | 0, 60)
      const fx = px + (Math.random() < 0.6 ? 0 : Math.random() < 0.5 ? -1 : 1)
      put(fx, py + 5, fc)
      const fvi = vIdx(fx, py + 5)
      if (fvi >= 0) ebuf[fvi] = fc
    }
  }
  octx.putImageData(img, 0, 0)
  // 精灵层:Kenney 像素战机(手绘精灵叠在模拟世界上——Noita 的角色层做法)
  octx.imageSmoothingEnabled = false
  for (const mb of mobs) {
    if (mb.kind !== 'fighter') continue
    const im = SHIP_IMG[mb.skin]
    if (!im) continue
    octx.save()
    octx.translate(mb.x - camIX, mb.y - camIY)
    octx.rotate(Math.atan2(player.y - mb.y, player.x - mb.x) + Math.PI / 2)
    octx.drawImage(im, -5, -5, 10, 10)
    octx.restore()
  }
  // 整数放大 + 震屏
  // 震屏对齐到"世界像素"整数格(小数偏移会让基础层与辉光层错半像素 = 重影),低于阈值硬归零(否则永远残留亚像素抖动)
  const ox = shakeT > 0 ? Math.round(((Math.random() - 0.5) * shakeT) / SCALE) * SCALE : 0
  const oy = shakeT > 0 ? Math.round(((Math.random() - 0.5) * shakeT) / SCALE) * SCALE : 0
  vctx.fillStyle = '#04050a'
  vctx.fillRect(0, 0, view.width, view.height)
  vctx.drawImage(off, ox, oy, view.width, view.height)
  // 辉光 bloom:发光层模糊两档,additive 叠回(像素华美的核心开关)
  ectx.putImageData(eimg, 0, 0)
  vctx.save()
  vctx.globalCompositeOperation = 'lighter'
  vctx.filter = `blur(${Math.max(3, SCALE * 1.5)}px)`
  vctx.globalAlpha = 0.7
  vctx.drawImage(emis, ox, oy, view.width, view.height)
  vctx.filter = `blur(${Math.max(1, SCALE * 0.5)}px)`
  vctx.globalAlpha = 0.5
  vctx.drawImage(emis, ox, oy, view.width, view.height)
  vctx.restore()
  // ── 化妆粒子层(Noita SpriteParticle 架构):屏幕分辨率 + 浮点坐标 + alpha + 加法混合 ──
  // 火花不再写进 240 宽的世界缓冲(那样一颗=5x5 大色块),而是在放大后的画布上直接画:
  // 一颗火星 = 2-3 屏幕像素的亮核 + 淡光晕,亚像素移动丝滑,alpha 随寿命淡出。
  if (sparks.length) {
    vctx.save()
    vctx.globalCompositeOperation = 'lighter'
    const core = SCALE * 0.55
    for (const s of sparks) {
      const sx = (s.x - camIX) * SCALE + ox
      const sy = (s.y - camIY) * SCALE + oy
      if (sx < -12 || sy < -12 || sx > view.width + 12 || sy > view.height + 12) continue
      const t = s.life / s.max
      // 色带:出生瞬间白热,前 28% 落回本色;暖色向暗红收敛(绿蓝加速熄灭),冷色等比变暗
      let r0 = s.c[0], g0 = s.c[1], b0 = s.c[2]
      if (t > 0.72) {
        const w = (t - 0.72) / 0.28
        r0 += (255 - r0) * w
        g0 += (255 - g0) * w
        b0 += (255 - b0) * w
      } else {
        const k2 = t / 0.72
        if (r0 > b0) {
          r0 *= 0.32 + 0.68 * k2
          g0 *= 0.1 + 0.9 * k2 * k2
          b0 *= k2 * k2 * 0.8
        } else {
          const kk = 0.25 + 0.75 * k2
          r0 *= kk
          g0 *= kk
          b0 *= kk
        }
      }
      vctx.fillStyle = `rgb(${r0 | 0},${g0 | 0},${b0 | 0})`
      const a = Math.min(1, t * 1.8)
      if (s.big > 0) {
        // 火球团(5.mp4 b0036 标定):爆心涌出的大光团,双层方晕近似圆球,消亡前膨胀
        const bs = core * s.big * (1.25 - t * 0.25)
        vctx.globalAlpha = a * 0.2
        vctx.fillRect(sx - bs * 1.5, sy - bs * 1.5, bs * 3, bs * 3)
        vctx.globalAlpha = a * 0.5
        vctx.fillRect(sx - bs * 0.9, sy - bs * 0.9, bs * 1.8, bs * 1.8)
        vctx.globalAlpha = a * 0.85
        vctx.fillRect(sx - bs * 0.45, sy - bs * 0.45, bs * 0.9, bs * 0.9)
        continue
      }
      // 光晕(大而淡,替代原来的 ebuf 辉光)
      vctx.globalAlpha = a * 0.15
      vctx.fillRect(sx - core * 1.7, sy - core * 1.7, core * 4, core * 4)
      // 亮核 + 速度拖影(快的拉成头亮尾暗的细线)
      const spd = Math.abs(s.vx) + Math.abs(s.vy)
      const nSeg = spd > 130 ? 3 : spd > 45 ? 2 : 1
      for (let seg = 0; seg < nSeg; seg++) {
        vctx.globalAlpha = a * (seg === 0 ? 0.95 : seg === 1 ? 0.42 : 0.18)
        vctx.fillRect(sx - s.vx * 0.013 * seg * SCALE - core / 2, sy - s.vy * 0.013 * seg * SCALE - core / 2, core, core)
      }
    }
    vctx.restore()
  }
  // 全屏白闪(大爆炸过曝帧)
  if (boomFlash > 0) {
    vctx.fillStyle = `rgba(255,246,228,${Math.min(0.85, boomFlash)})`
    vctx.fillRect(0, 0, view.width, view.height)
  }
  shakeT *= 0.86
  if (shakeT < 0.5) shakeT = 0
  // HUD
  const wnd = WANDS[player.wand]
  vctx.fillStyle = 'rgba(10,14,20,0.7)'
  vctx.fillRect(8, 8, 190, 62)
  vctx.fillStyle = '#1a2430'
  vctx.fillRect(14, 14, 120, 7)
  vctx.fillStyle = player.hp > 40 ? '#7ec86a' : player.hp > 20 ? '#e0b040' : '#e05540'
  vctx.fillRect(14, 14, Math.max(0, player.hp / 100) * 120, 7)
  // 喷气燃料条
  vctx.fillStyle = '#1a2430'
  vctx.fillRect(14, 23, 120, 4)
  vctx.fillStyle = '#5a9fd8'
  vctx.fillRect(14, 23, Math.max(0, player.fuel / 100) * 120, 4)
  // 氧气条(只在憋气时显示)
  if (player.air < 100) {
    vctx.fillStyle = '#1a2430'
    vctx.fillRect(14, 29, 120, 4)
    vctx.fillStyle = player.air > 30 ? '#66d8e8' : '#e05540'
    vctx.fillRect(14, 29, Math.max(0, player.air / 100) * 120, 4)
  }
  // 法力条(青绿,Noita 三参数之一:法力即时扣、按秒回)
  vctx.fillStyle = '#1a2430'
  vctx.fillRect(14, 35, 120, 4)
  vctx.fillStyle = '#4fd8b8'
  vctx.fillRect(14, 35, Math.max(0, wnd.mana / wnd.manaMax) * 120, 4)
  vctx.fillStyle = '#c5d6e4'
  vctx.font = '13px Georgia, serif'
  vctx.fillText(player.dead > 0 ? '阵亡' : `HP ${Math.max(0, player.hp | 0)}`, 140, 22)
  const tc2 = wnd.tipCol
  vctx.fillStyle = `rgb(${tc2[0]},${tc2[1]},${tc2[2]})`
  vctx.fillText(`${wnd.name}${wnd.shuffle ? ' ⇄' : ''}${wnd.recT > 0 ? ' · 装填中' : ''}`, 14, 46)
  // 卡组进度点:亮 = 还在牌库,暗 = 已进弃牌堆(一眼读出这轮还剩几张)
  for (let i2 = 0; i2 < wnd.slots.length; i2++) {
    const sc = SPELLS[wnd.slots[i2]].col
    vctx.globalAlpha = wnd.deck.includes(i2) ? 1 : 0.22
    vctx.fillStyle = `rgb(${sc[0]},${sc[1]},${sc[2]})`
    vctx.fillRect(140 + i2 * 7, 39, 5, 5)
  }
  vctx.globalAlpha = 1
  // 金币 + 染色状态
  vctx.fillStyle = '#ffd054'
  vctx.fillText(`¤ ${player.gold}`, 14, 62)
  let stx = 70
  if (player.stWet > 0) { vctx.fillStyle = '#7ab8e8'; vctx.fillText('湿', stx, 62); stx += 20 }
  if (player.stOil > 0) { vctx.fillStyle = '#c9a86a'; vctx.fillText('油', stx, 62); stx += 20 }
  if (player.stBlood > 0) { vctx.fillStyle = '#e06060'; vctx.fillText('血', stx, 62); stx += 20 }
  // 小地图(右上):地形轮廓 + 取景框 + 玩家点
  const mmx = view.width - MMW - 10
  const mmy = 28
  vctx.globalAlpha = 0.85
  vctx.drawImage(mini, mmx, mmy)
  vctx.globalAlpha = 1
  vctx.strokeStyle = 'rgba(150,170,190,0.6)'
  vctx.strokeRect(mmx - 0.5, mmy - 0.5, MMW + 1, MMH + 1)
  vctx.strokeStyle = 'rgba(255,255,255,0.45)'
  vctx.strokeRect(mmx + camIX / 4, mmy + camIY / 4, VW / 4, VH / 4)
  vctx.fillStyle = '#8dd8cf'
  vctx.fillRect(mmx + player.x / 4 - 1, mmy + player.y / 4 - 1, 3, 3)
  // 任务标记:星之核(青,闪烁)/ 祭坛(金)
  if (quest.state === 'seek') {
    if (frame & 8) {
      vctx.fillStyle = '#9feaff'
      vctx.fillRect(mmx + quest.coreX / 4 - 1, mmy + quest.coreY / 4 - 1, 3, 3)
    }
  } else {
    vctx.fillStyle = '#ffd054'
    vctx.fillRect(mmx + quest.altarX / 4 - 1, mmy + quest.altarY / 4 - 1, 3, 3)
  }
  // 准星
  vctx.strokeStyle = 'rgba(255,255,255,0.7)'
  vctx.lineWidth = 1
  vctx.strokeRect((mouse.x - camIX) * SCALE - 4, (mouse.y - camIY) * SCALE - 4, 8, 8)
  // ── M1:目标提示(顶部)+ 通关/死亡横幅 ──
  vctx.textAlign = 'center'
  vctx.font = '12px Georgia, serif'
  // 进区横幅(淡入淡出)
  if (zoneBannerT > 0) {
    const a = Math.min(1, (2.8 - zoneBannerT) * 3) * Math.min(1, zoneBannerT * 1.6)
    vctx.font = '15px Georgia, serif'
    vctx.fillStyle = `rgba(228,218,178,${(a * 0.92).toFixed(2)})`
    vctx.fillText(`—— ${zoneBannerName} ——`, view.width / 2, 46)
    vctx.font = '12px Georgia, serif'
  }
  if (quest.state === 'seek') {
    const ar = `${quest.coreY > player.y + 12 ? ' ↓' : ''}${quest.coreX > player.x + 24 ? ' →' : quest.coreX < player.x - 24 ? ' ←' : ''}`
    vctx.fillStyle = 'rgba(150,230,255,0.85)'
    vctx.fillText(`✦ 深渊尽头的星之核${ar}`, view.width / 2, 20)
  } else if (quest.state === 'carry') {
    const ar = `${quest.altarY < player.y - 12 ? ' ↑' : ''}${quest.altarX > player.x + 24 ? ' →' : quest.altarX < player.x - 24 ? ' ←' : ''}`
    vctx.fillStyle = 'rgba(255,215,130,0.9)'
    vctx.fillText(`★ 带星之核回地表祭坛${ar}`, view.width / 2, 20)
  }
  if (quest.state === 'won') {
    const a2 = Math.min(1, quest.t / 30)
    vctx.fillStyle = `rgba(8,10,16,${0.55 * a2})`
    vctx.fillRect(0, view.height * 0.3, view.width, 100)
    vctx.fillStyle = '#ffe9a8'
    vctx.font = '26px Georgia, serif'
    vctx.fillText('★ 星之核已归位 · 通关 ★', view.width / 2, view.height * 0.3 + 42)
    vctx.fillStyle = '#c5d6e4'
    vctx.font = '13px Georgia, serif'
    vctx.fillText(`本局金块 ¤ ${player.gold} · 按 R 开启新一局`, view.width / 2, view.height * 0.3 + 68)
  }
  if (player.dead > 0) {
    vctx.fillStyle = 'rgba(20,6,8,0.5)'
    vctx.fillRect(0, 0, view.width, view.height)
    vctx.fillStyle = '#e08080'
    vctx.font = '24px Georgia, serif'
    vctx.fillText('陨落于深渊…', view.width / 2, view.height / 2 - 8)
    vctx.fillStyle = '#c5d6e4'
    vctx.font = '12px Georgia, serif'
    vctx.fillText('新的世界正在生成(permadeath)', view.width / 2, view.height / 2 + 14)
  }
  vctx.textAlign = 'left'
}

// ── 输入 ───────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase())
  const n = Number(e.key)
  if (n >= 1 && n <= WANDS.length) setWand(n - 1)
  if (e.key.toLowerCase() === 'q') setWand((player.wand + WANDS.length - 1) % WANDS.length)
  if (e.key.toLowerCase() === 'e') setWand((player.wand + 1) % WANDS.length)
  if (e.key.toLowerCase() === 'r') regen() // 新一局(通关后/随时重开)
})
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))
view.addEventListener('pointermove', (e) => {
  const r = view.getBoundingClientRect()
  mouse.sx = e.clientX - r.left
  mouse.sy = e.clientY - r.top
})
view.addEventListener('pointerdown', (e) => {
  if (e.button === 0) mouse.l = true
  if (e.button === 2) mouse.r = true
})
window.addEventListener('pointerup', (e) => {
  if (e.button === 0) mouse.l = false
  if (e.button === 2) mouse.r = false
})
view.addEventListener('contextmenu', (e) => e.preventDefault())

// ── 面板 ───────────────────────────────────────────
const wandsEl = document.getElementById('wands')
const deckEl = document.getElementById('deckview')
const wandBtns = []
const SPELL_TYPE_TAG = { proj: '', mod: '修', multi: '重' }
function setWand(i) {
  player.wand = i
  wandBtns.forEach((b, k) => b.classList.toggle('active', k === i))
  // 卡组明细:一行一张卡(色块 + 名 + 类型 + 蓝耗),读得出"修正吃右边一张"的顺序感
  const w = WANDS[i]
  deckEl.innerHTML = w.slots.map((id) => {
    const s = SPELLS[id]
    const tag = SPELL_TYPE_TAG[s.t] ? `<span style="opacity:.6">[${SPELL_TYPE_TAG[s.t]}]</span>` : ''
    return `<span class="sw" style="background:rgb(${s.col[0]},${s.col[1]},${s.col[2]})"></span>${s.name}${tag} <span style="opacity:.5">${s.mana}蓝</span>`
  }).join('<br>')
}
WANDS.forEach((w, i) => {
  const btn = document.createElement('button')
  btn.textContent = `${i + 1} · ${w.name}${w.shuffle ? ' ⇄乱序' : ''}`
  btn.onclick = () => setWand(i)
  wandsEl.appendChild(btn)
  wandBtns.push(btn)
})
setWand(0)

const BRUSHES = [
  ['沙', M_SAND, '#c9a86a'], ['水', M_WATER, '#3a6fd8'], ['油', M_OIL, '#6b5a20'], ['木', M_WOOD, '#7a5230'],
  ['石', M_STONE, '#60646e'], ['熔岩', M_LAVA, '#f05010'], ['火药', M_POWDER, '#44444c'], ['火', M_FIRE, '#ff5030'],
  ['冰', M_ICE, '#94cae8'], ['橡皮', M_EMPTY, '#223'],
]
let brush = M_SAND
const brushesEl = document.getElementById('brushes')
const brushBtns = []
BRUSHES.forEach(([name, m, col]) => {
  const btn = document.createElement('button')
  btn.innerHTML = `<span class="sw" style="background:${col}"></span>${name}`
  btn.onclick = () => {
    brush = m
    brushBtns.forEach((b) => b.classList.toggle('active', b === btn))
  }
  brushesEl.appendChild(btn)
  brushBtns.push(btn)
})
brushBtns[0].classList.add('active')
const bsizeEl = document.getElementById('bsize')
function paint() {
  const r = Number(bsizeEl.value)
  const bx = mouse.x | 0, by = mouse.y | 0
  if (brush === M_FIRE) {
    blob(bx, by, r, M_FIRE, M_EMPTY)
    for (let y = by - r; y <= by + r; y++) for (let x = bx - r; x <= bx + r; x++) {
      if (inB(x, y) && grid[idx(x, y)] === M_FIRE && aux[idx(x, y)] === 0) aux[idx(x, y)] = 40 + Math.random() * 40
    }
  } else if (brush === M_EMPTY) {
    blob(bx, by, r, M_EMPTY)
  } else {
    blob(bx, by, r, brush, M_EMPTY)
  }
}

const mobsEl = document.getElementById('mobs')
for (const [label, kind] of [['投放 · 敌战机(开火)', 'fighter'], ['投放 · 血肉怪(流血)', 'blood'], ['投放 · 油囊怪(漏油)', 'oil'], ['投放 · 施法怪(油+火)', 'caster']]) {
  const btn = document.createElement('button')
  btn.textContent = label
  btn.onclick = () => spawnMob(kind, cam.x + 20 + Math.random() * (VW - 40), Math.max(6, cam.y + 6))
  mobsEl.appendChild(btn)
}
const autoEl = document.getElementById('autospawn')
document.getElementById('regen').onclick = regen

// ── 启动:先加载 PNG 瓦片集(失败自动回退 ASCII 模板),再生成世界 ──
let lastT = performance.now()
let fpsN = 0, fpsT = 0, fps = 60
function loop(t) {
  const dt = Math.min(0.04, (t - lastT) / 1000)
  lastT = t
  fpsN++
  fpsT += dt
  if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0 }
  // 镜头跟随玩家(取景窗夹在世界内);准星世界坐标随镜头实时换算
  cam.x += (player.x - VW / 2 - cam.x) * (1 - Math.pow(0.001, dt))
  cam.y += (player.y - VH * 0.55 - cam.y) * (1 - Math.pow(0.001, dt))
  cam.x = Math.max(0, Math.min(SW - VW, cam.x))
  cam.y = Math.max(0, Math.min(SH - VH, cam.y))
  mouse.x = mouse.sx / SCALE + cam.x
  mouse.y = mouse.sy / SCALE + cam.y
  if (mouse.r) paint()
  stepSim()
  // 火把长明(光锚;悬空一格,不点燃承载物)
  if (frame % 3 === 0) {
    for (const t of torches) {
      const i = idx(t.x, t.y)
      if (grid[i] === M_EMPTY || grid[i] === M_SMOKE) {
        grid[i] = M_FIRE
        aux[i] = 14 + Math.random() * 8
      }
    }
  }
  // 环境浮尘漂移(出视口就回收进视口)
  for (const mt of motes) {
    mt.ph += dt
    const b = biomeArr[Math.max(0, Math.min(SW - 1, mt.x | 0))]
    if (b === 0) { mt.y += 9 * dt; mt.x += Math.sin(mt.ph * 1.3) * 6 * dt }
    else if (b === 1) { mt.y += Math.sin(mt.ph * 0.9) * 4 * dt; mt.x += 3 * dt }
    else { mt.y -= 5 * dt; mt.x += Math.sin(mt.ph * 1.1) * 4 * dt }
    if (mt.x < cam.x - 8 || mt.x > cam.x + VW + 8 || mt.y < cam.y - 8 || mt.y > cam.y + VH + 8) {
      mt.x = cam.x + Math.random() * VW
      mt.y = cam.y + Math.random() * VH
    }
  }
  // 液体电场衰减
  for (let i = 0; i < N; i++) if (elec[i] > 0) elec[i]--
  if (frame % 18 === 0) updateMinimap()
  updatePlayer(dt)
  updateBullets(dt)
  updateEBullets(dt)
  updateMobs(dt)
  updateParts(dt)
  updateChunks(dt)
  // 装饰火花 / 爆炸闪光
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]
    s.life -= dt
    // 火球团浮力抵消重力(热气团上滚,b0036~b0045);普通火星正常下坠
    s.vy += (s.big > 0 ? -30 : 170) * dt
    s.vx *= Math.pow(0.3, dt)
    // 乱流:微小随机加速度,火星飘动不走直线(Noita 火星的"活"感)
    s.vx += (Math.random() - 0.5) * 70 * dt
    s.vy += (Math.random() - 0.5) * 46 * dt
    s.x += s.vx * dt
    s.y += s.vy * dt
    if (s.life <= 0 || !inB(s.x | 0, s.y | 0)) sparks.splice(i, 1)
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    flashes[i].life -= dt
    if (flashes[i].life <= 0) flashes.splice(i, 1)
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    if (--bolts[i].life <= 0) bolts.splice(i, 1)
  }
  boomFlash = Math.max(0, boomFlash - dt * 2.4)
  render()
  vctx.fillStyle = 'rgba(197,214,228,0.5)'
  vctx.font = '11px Georgia, serif'
  vctx.fillText(`${fps}fps  ${parts.length}屑`, view.width - 78, 16)
  requestAnimationFrame(loop)
}
Promise.all([loadTileset(), loadHBTileset(), loadScenes()]).then(() => {
  regen()
  spawnMob('blood', SW * 0.6, 16)
  spawnMob('oil', SW * 0.75, 20)
  lastT = performance.now()
  requestAnimationFrame(loop)
})

// 调试钩子
window.__pixel = {
  grid, midGrid, SW, SH, explode, spawnMob, regen, player, mobs, parts, bullets, ebullets,
  chunks, checkCollapse, markCollapse, zoneAt, sancts, wangMarks, mobSpawnPts,
  getMod: () => worldMod, setMod: (m) => { worldMod = m },
  setWand, WANDS, SPELLS, fireWeapon, castBlockAt, electrify, elec, getShake: () => shakeT,
  probe: () => ({
    flashes: flashes.map((f) => [f.x | 0, f.y | 0, +f.r.toFixed(1)]),
    sparks: sparks.map((s) => [s.x | 0, s.y | 0]),
    bolts: bolts.map((bo) => bo.pts[0].map((v) => v | 0)),
    bullets: bullets.map((b) => [b.x | 0, b.y | 0, b.pay]),
  }),
  paintAt: (x, y, m, r) => blob(x, y, r, m),
  hbInfo: () => ({ ...lastRegen, corner: !!hbMeta, hTiles: hbTiles ? hbTiles.h.length : 0, vTiles: hbTiles ? hbTiles.v.length : 0,
    coffeePx: hbTiles ? hbTiles.h.reduce((s, t) => s + t.coffee.length, 0) + hbTiles.v.reduce((s, t) => s + t.coffee.length, 0) : 0 }),
  quest,
  M: { M_EMPTY, M_STONE, M_SAND, M_WATER, M_OIL, M_FIRE, M_SMOKE, M_STEAM, M_WOOD, M_LAVA, M_BLOOD, M_POWDER, M_ICE, M_GOLD, M_MOSS, M_DIRT, M_COAL },
}
