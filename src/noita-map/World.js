// ── NoitaWorld:seed → 群系区域 → wang 层(懒) → 布景清单 → 512×512 材质区块(懒 + LRU)──
// 这是"地图模块"的对外 API:
//   const world = new NoitaWorld(assets, seed)
//   await world.prepareChunk(cx, cy)      // 保证该区块所需的砖库/布景 PNG 已加载,并生成所属 wang 层
//   const chunk = world.getChunk(cx, cy)  // 同步:{ mat: Uint16Array(512*512), scenes: [...] }
// 坐标:cx, cy 为 chunk 绝对坐标(群系图像素;世界 (0,0) 在 chunk (35,14) 左上)。
// 材质 id 见 assets.materials;渲染/物理都只依赖这个数组,因此可整体搬到手机。

import { CHUNK, TILE, WANG_SAMPLE_OFFSET, BIOME_MAP_W, BIOME_MAP_H, WORLD_CENTER_CHUNK_X, WORLD_CENTER_CHUNK_Y, absToWangX, absToWangY } from './core/coords.js'
import { wangJitter, simplex2 } from './core/noitaNoise.js'
import { BIOMES, NOISE_EDGE_BIOMES, biomeNameOf, findBiomeRegions } from './core/biomes.js'
import { generateRegionLayer, wangAt } from './core/wangLayer.js'
import { collectScenes, collectLights, collectSpawns, collectVines, rollSpawn, ALL_MARK_COLORS, BIOME_SCENES, BIOME_FIXED_SCENES, PIXEL_SPRITES, SCENE_PROPS, sceneDir } from './core/scenes.js'
import { BandResolver } from './core/bands.js'
import { valueNoise } from './core/noise.js'
import { NollaPrng } from './core/NollaPrng.js'
import { staticScenesFor, STATIC_SCENE_INIT, STATIC_DECOR_MARKS, STATIC_VINES, VINE_POOL, splicedScenesIn } from './core/staticScenes.js'
import { scanTempleMarks, TEMPLE_MARK_BIOMES, TEMPLE_MARK_COLORS } from './core/templeMarks.js'

// 整图布景最多向右/下伸出 2 个 chunk(hall_bottom_2 x+552、altar_right_extra y+542)
const STATIC_REACH = 2
// 砖边扰动幅度(px)与波长(px):按 seed 1674172626 真值目测,边缘起伏约 ±4~5px、波长 ~24px
const EDGE_WARP = 4.5
const EDGE_WARP_SCALE = 24
// 植被贴图最高(tree_leaf 137px):下一 chunk 顶部这么多行内的地表,植被会伸进本 chunk
const VEG_REACH = 140
// 地表丘陵噪声参数,按种子用存档真值剖面拟合(scripts/_fit-surface.mjs):s 噪声种子,L 格距 px,phi 相位,高度 = C + A·(n−0.5)·2
// 拟合带坡度约束:全域(±18000px)最陡 0.85(40°)。真值最陡 ≈0.9;soil/grass 是落沙,45° 以上会被元胞自动机塌成三角堆——
// 之前 A=203 的拟合就是这么出的"金字塔尖"。
const SURFACE_FIT = { 1674172626: { s: 6175, L: 330, phi: 0.575, A: 146.1, C: -6.5 } }
// 地表群系的材质带(biome xml MaterialComponent,v = 深度值,每单位 ≈650px)与起伏倍率(mGradientHigh/LowNoise 之比)
//   hills/mountain_tree:soil → sand_static → rock_static(0.9~0.95 互嵌);soil/sand 交界贴煤层
//   winter(雪原):snow_static → snowrock_static;mGradientType=1 起伏略缓
//   desert(沙漠):sand_surface → sandstone_surface → sand_static_bright → sand_static → rock_static;±100 起伏
const SURFACE_BANDS = {
  hills: { amp: 1, bands: [['soil', 0.53], ['sand_static', 0.95]], deep: 'rock_static', mixFrom: 0.9, coal: true },
  winter: { amp: 0.7, bands: [['snow_static', 0.95]], deep: 'snowrock_static', mixFrom: 0.9 },
  desert: { amp: 0.43, bands: [['sand_surface', 0.48], ['sandstone_surface', 0.6], ['sand_static_bright', 0.73], ['sand_static', 0.95]], deep: 'rock_static', mixFrom: 0.9 },
}
SURFACE_BANDS.hills2 = SURFACE_BANDS.mountain_tree = SURFACE_BANDS.hills
SURFACE_BANDS.scale = SURFACE_BANDS.watchtower = SURFACE_BANDS.desert // 沙漠里的静态图块群系,地表按沙漠打底
// mountain_hall / left_entrance / right / top .xml:soil → rock_hard 0.53~0.95 → rock_static(真值 chunk(0,−512):rock_static 29568 / rock_hard 20765,没有 sand_static);
// left_stub / right_stub 是 sand_static 带,同 hills
// 山体内部按真值校准(chunk(512,−512) hall:rock_static 102k / rock_hard 73k,coal 只有 56 格):rock_hard 带压到 0.75、不撒煤;
// stub(chunk(−512,0):sand 163k / rock 70k)的沙比丘陵深得多 —— 我们的 v 是按"离地表深度"算的,山高所以要把沙带拉长到 1.35
// 09-05 改成概率混合(_surfacePixel 注释):山体 rock_hard 里 rock_static 随 v 爬升(真值 hall rock_static 39% / rock_hard 28%,段长 13 / 10 的细混合);
// 山桩 sand 里 rock_static 48px 起 12% → 360px 70%(真值 chunk(1536,0) 剖面)
// 山体(整图外的填充部分)真值 hall 里 rock_static 103k / rock_hard 73k(58%),山顶在 y≈−600:P(y) = 0.35 + y/900 → y −300 时 0.02,y 0 时 0.35,y 300 时 0.68
SURFACE_BANDS.mountain = { amp: 1, bands: [['soil', 0.53], ['rock_hard', 9]], deep: 'rock_static', mixFrom: 0.7, coal: false, ramp: { base: 0.35, per: 900, min: 0.02, max: 0.7 } }
SURFACE_BANDS.mountain_hall = SURFACE_BANDS.mountain_left_entrance = SURFACE_BANDS.mountain_right = SURFACE_BANDS.mountain_top = SURFACE_BANDS.mountain
// 山桩真值按 32px 行的 rock/(rock+sand):左桩 y<160 0% → 192 8% → 256 19% → 320 42% → 384 67% → 448 83%;右桩早 ~80px 起、封顶 65~75% → 取 P(y) = (y − 140)/330,封顶 0.8
SURFACE_BANDS.mountain_left_stub = SURFACE_BANDS.mountain_right_stub = { amp: 1, bands: [['soil', 0.53], ['sand_static', 9]], deep: 'rock_static', mixFrom: 1.05, coal: true, ramp: { base: -140 / 330, per: 330, min: 0, max: 0.8 } }

export class NoitaWorld {
  /**
   * @param {import('./assets.js').NoitaAssets} assets  已 init()
   * @param {number} seed
   * @param {{ngPlus?:number, chunkCache?:number}} [opt]
   */
  constructor(assets, seed, opt = {}) {
    this.assets = assets
    this.mats = assets.materials
    this.seed = seed >>> 0
    this.ng = opt.ngPlus || 0
    this.bands = new BandResolver(this.mats, assets.biomes)
    this.cacheLimit = opt.chunkCache || 64
    this.chunks = new Map()        // "cx,cy" → {mat, scenes, t}
    this.layers = new Map()        // regionKey → layer(含 scenes)
    this.regionOfChunk = new Map() // "cx,cy" → regionKey
    this.regionDefs = new Map()    // regionKey → {biome, points, bbox}
    this.staticScenes = new Map()  // "cx,cy" → 该 chunk init() 放出的整图布景
    this.globals = { shopCount: 5 } // GlobalsGetValue 那类运行时全局(TEMPLE_SHOP_ITEM_COUNT;EXTRA_SHOP_ITEM 特权改它),主线程经 WorldClient.setGlobals 同步
    this._tick = 0
    this._indexRegions()
    this.M_AIR = 0
    this.M_ROCK = this.mats.id('rock_static')
    this.M_WATER = this.mats.id('water')
    this.M_LAVA = this.mats.id('lava')
    this.M_GOLD = this.mats.id('gold')
    this.M_SOIL = this.mats.id('soil')
    this.M_SAND = this.mats.id('sand_static')
    this.M_GRASS = this.mats.id('grass')
    this.M_COAL = this.mats.id('coal')
    // 地表丘陵噪声参数:默认种子用真值拟合值(scripts/_fit-surface.mjs),其他种子按种子派生同分布参数
    // 其他种子 A 取小些(3A/L ≤ 1.1),保证任意格点差也不会陡过 45°
    this.surfaceFit = SURFACE_FIT[this.seed] || { s: (this.seed % 9973) + 1, L: 330, phi: (this.seed % 1000) / 1000, A: 120, C: -6 }
    this.caveSegs = new Map() // 地表洞(BitmapCaves surface_cave)按 1536px 段缓存:segIdx → [{x,y,r}]
  }

  // ── 群系图 ──
  biomeAtChunk(cx, cy) {
    const bm = this.assets.biomeMap
    const x = ((cx % BIOME_MAP_W) + BIOME_MAP_W) % BIOME_MAP_W
    const y = cy < 0 ? 0 : cy >= BIOME_MAP_H ? BIOME_MAP_H - 1 : cy
    return biomeNameOf(bm.pixels[y * BIOME_MAP_W + x])
  }
  /** 世界坐标(玩家坐标系)→ 群系名 */
  biomeAtWorld(wx, wy) {
    return this.biomeAtChunk(Math.floor(wx / CHUNK) + WORLD_CENTER_CHUNK_X, Math.floor(wy / CHUNK) + WORLD_CENTER_CHUNK_Y)
  }

  _indexRegions() {
    const bm = this.assets.biomeMap
    for (const [name, def] of Object.entries(BIOMES)) {
      if (def.kind !== 'wang') continue
      const { regions, bboxes } = findBiomeRegions(bm.pixels, bm.w, bm.h, def.color)
      regions.forEach((pts, i) => {
        const key = `${name}#${i}`
        this.regionDefs.set(key, { biome: name, points: pts, bbox: bboxes[i] })
        for (const [x, y] of pts) this.regionOfChunk.set(x + ',' + y, key)
      })
    }
  }

  regionKeyOf(cx, cy) {
    const x = ((cx % BIOME_MAP_W) + BIOME_MAP_W) % BIOME_MAP_W
    return this.regionOfChunk.get(x + ',' + cy) || null
  }

  /** 生成(或取缓存)包含该 chunk 的 wang 层;需要砖库已加载 */
  layerOf(cx, cy) {
    const key = this.regionKeyOf(cx, cy)
    if (!key) return null
    if (this.layers.has(key)) return this.layers.get(key)
    const def = this.regionDefs.get(key)
    const b = BIOMES[def.biome]
    const ts = this.assets.tileset(b.wang)
    if (!ts) return null
    const t0 = performance.now()
    const layer = generateRegionLayer({
      biome: def.biome, points: def.points, bbox: def.bbox, tileset: ts, wangFile: b.wang,
      overlay: this.assets.overlay, seed: this.seed, ngPlus: this.ng, randomColors: b.randomColors || null,
    })
    if (!layer) return null
    layer.scenes = collectScenes(layer, {
      seed: this.seed, ng: this.ng,
      biomeAtWorld: (x, y) => this.biomeAtWorld(x, y),
      sceneSize: (dir, name) => { const s = this.assets.scene(dir, name); return s ? { w: s.w, h: s.h } : null },
    })
    layer.lights = collectLights(layer, { seed: this.seed, ng: this.ng })
    layer.spawns = collectSpawns(layer, { seed: this.seed, ng: this.ng, biomeAtWorld: (x, y) => this.biomeAtWorld(x, y) })
    layer.vines = collectVines(layer, { seed: this.seed, ng: this.ng, biomeAtWorld: (x, y) => this.biomeAtWorld(x, y) })
    layer.genMs = performance.now() - t0
    this.layers.set(key, layer)
    return layer
  }

  /** 某 chunk 的整图布景(init 放置,缓存) */
  staticScenesOf(cx, cy) {
    const key = cx + ',' + cy
    let s = this.staticScenes.get(key)
    if (s) return s
    const biome = this.biomeAtChunk(cx, cy)
    s = STATIC_SCENE_INIT[biome]
      ? staticScenesFor(biome, this.seed, (cx - WORLD_CENTER_CHUNK_X) * CHUNK, (cy - WORLD_CENTER_CHUNK_Y) * CHUNK)
      : []
    for (const sc of s) sc.owner = key
    this.staticScenes.set(key, s)
    return s
  }

  /**
   * 圣山整图布景里的标记像素(temple_altar.lua):图到了才能扫,扫一次缓存在布景对象上;
   * 产出的附加布景(商店第二排)追加进所属 chunk 的整图布景表,之后 _buildChunk 一起盖章。
   */
  async _scanStaticMarks(near) {
    const jobs = []
    for (const sc of near) {
      if (sc.marks || !TEMPLE_MARK_BIOMES.has(sc.biome)) continue
      const s = this.assets.scene(sc.dir, sc.name)
      if (!s?.mat) continue
      sc.marks = scanTempleMarks(s.mat, sc, this.seed + this.ng, this.globals)
      const list = this.staticScenes.get(sc.owner)
      for (const ex of sc.marks.extra) {
        const e = { ...ex, biome: sc.biome, material: null, colorMaterial: null, func: 'mark', owner: sc.owner, marks: { spawns: [], lights: [], extra: [] } }
        if (list) list.push(e)
        jobs.push(this.assets.loadScene(e.dir, e.name))
      }
    }
    await Promise.all(jobs)
  }

  /** 可能盖到该 chunk 的整图布景(来自邻近 chunk 的 init) */
  staticScenesNear(cx, cy) {
    const out = []
    for (let dy = -STATIC_REACH; dy <= STATIC_REACH; dy++)
      for (let dx = -STATIC_REACH; dx <= STATIC_REACH; dx++) out.push(...this.staticScenesOf(cx + dx, cy + dy))
    // 全局固定布景(巨树 / 熔岩湖 / 水洞…):不属于任何 chunk 的 init,按包围盒挑
    const wx0 = (cx - WORLD_CENTER_CHUNK_X) * CHUNK, wy0 = (cy - WORLD_CENTER_CHUNK_Y) * CHUNK
    out.push(...splicedScenesIn(wx0, wy0, wx0 + CHUNK, wy0 + CHUNK))
    return out
  }

  /** 异步:把该 chunk 需要的砖库 + 布景 PNG 全加载好,并生成层 */
  async prepareChunk(cx, cy) {
    const near = this.staticScenesNear(cx, cy)
    const jobs = near.map((s) => this.assets.loadScene(s.dir, s.name, s.visual))
    // 布景标记色会贴的散件图(草丛整图等)
    for (const s of near) for (const d of Object.values(STATIC_DECOR_MARKS[s.biome] || {})) if (d.kind === 'sprite') jobs.push(this.assets.loadScene(d.dir, d.name))
    // 植被贴图(本 chunk 与下一 chunk 的群系;落点要知道图的尺寸)
    if (this.assets.vegImagesOf) for (const b of [this.biomeAtChunk(cx, cy), this.biomeAtChunk(cx, cy + 1)]) for (const v of this.assets.vegImagesOf(b)) jobs.push(this.assets.loadVeg(v))
    const key = this.regionKeyOf(cx, cy)
    let layer = null
    if (key) {
      const def = this.regionDefs.get(key)
      const b = BIOMES[def.biome]
      await this.assets.loadTileset(b.wang)
      // 布景尺寸参与群系检查,所以先把这个群系可能用到的布景都加载(一次性,之后缓存)
      await this._preloadBiomeScenes(def.biome)
      layer = this.layerOf(cx, cy)
      if (layer) jobs.push(...layer.scenes.map((s) => this.assets.loadScene(s.dir, s.name, s.visual, s.bgName, s.matName)))
    }
    await Promise.all(jobs)
    await this._scanStaticMarks(near)
    return layer
  }

  async _preloadBiomeScenes(biome) {
    const pools = BIOME_SCENES[biome]
    const names = new Map([['general/wand_altar', {}], ['general/potion_altar', {}], ['general/altar', {}], ['general/snowperson', {}], ['general/wand_altar_vault', {}], ['general/potion_altar_vault', {}]])
    if (pools) for (const list of Object.values(pools)) for (const s of list) if (s.name) names.set((s.dir || sceneDir(biome, s.name)) + '/' + s.name, s)
    for (const n of BIOME_FIXED_SCENES[biome] || []) names.set(biome + '/' + n, {})
    for (const ps of Object.values(PIXEL_SPRITES)) names.set('props/' + ps.img, { visual: '' })
    await Promise.all([...names].map(([k, s]) => { const [d, n] = k.split('/'); return this.assets.loadScene(d, n, s.visual, s.bgName, s.matName) }))
  }

  // ── 区块材质 ──
  getChunk(cx, cy) {
    const key = cx + ',' + cy
    let c = this.chunks.get(key)
    if (c) { c.t = ++this._tick; return c }
    c = this._buildChunk(cx, cy)
    c.t = ++this._tick
    this.chunks.set(key, c)
    if (this.chunks.size > this.cacheLimit) {
      let oldK = null, oldT = Infinity
      for (const [k, v] of this.chunks) if (v.t < oldT) { oldT = v.t; oldK = k }
      this.chunks.delete(oldK)
    }
    return c
  }

  _buildChunk(cx, cy) {
    const N = CHUNK * CHUNK
    const mat = new Uint16Array(N)
    const biome = this.biomeAtChunk(cx, cy)
    const def = BIOMES[biome] || null
    const kind = def ? def.kind : 'solid'
    const ax0 = cx * CHUNK, ay0 = cy * CHUNK               // chunk 绝对像素
    const wx0 = ax0 - WORLD_CENTER_CHUNK_X * CHUNK, wy0 = ay0 - WORLD_CENTER_CHUNK_Y * CHUNK // 世界坐标
    const out = { cx, cy, biome, kind, mat, scenes: [], layer: null }

    if (kind === 'wang') {
      const layer = this.layerOf(cx, cy)
      out.layer = layer
      if (layer) this._fillFromWang(mat, layer, ax0, ay0, wx0, wy0, biome)
      else mat.fill(this.M_ROCK)
      if (NOISE_EDGE_BIOMES.has(biome)) this._bleedSurfaceEdges(mat, cx, cy, wx0, wy0)
    } else if (kind === 'surface') {
      this._fillSurface(mat, wx0, wy0, biome)
    } else if (kind === 'air') {
      // 空
    } else if (kind === 'water') {
      mat.fill(this.M_WATER)
    } else if (kind === 'lava') {
      mat.fill(this.M_LAVA)
    } else if (kind === 'gold') {
      mat.fill(this.M_GOLD)
    } else if (kind === 'scene') {
      // 整图布景群系:底是空气,形状全由 init() 放的大图给(下面盖章)
    } else {
      mat.fill(this.M_ROCK)
    }

    // 布景盖章:先整图布景(init),再 wang 层 spawn 出来的随机布景;任何来源都可能跨到本 chunk
    const stamp = (sc) => {
      const s = this.assets.scene(sc.dir, sc.name)
      if (!s) return
      const sx = sc.x + WORLD_CENTER_CHUNK_X * CHUNK, sy = sc.y + WORLD_CENTER_CHUNK_Y * CHUNK
      if (sx >= ax0 + CHUNK || sy >= ay0 + CHUNK || sx + s.w <= ax0 || sy + s.h <= ay0) return
      // LoadBackgroundSprite 只画在背景层,不进材质
      if (!sc.bgSprite) this._stampScene(mat, s, sc, sx - ax0, sy - ay0, wx0, wy0, biome)
      out.scenes.push({ ...sc, ax: sx, ay: sy, w: s.w, h: s.h })
    }
    for (const sc of this.staticScenesNear(cx, cy)) stamp(sc)
    for (const layer of this.layers.values()) for (const sc of layer.scenes) stamp(sc)
    // 实体自带的 PixelSceneComponent(神殿陷阱的石框):跟着生成点盖章
    for (const layer of this.layers.values()) for (const s of layer.spawns || []) {
      const sp = SCENE_PROPS[s.entity]
      if (sp) stamp({ dir: sp.dir, name: sp.name, biome: layer.biome, x: s.x + sp.ox, y: s.y + sp.oy, material: null, colorMaterial: null, func: 'entity_scene' })
    }
    if (kind === 'wang' || kind === 'surface') this._growGrass(mat, wx0, wy0)
    this.attachDecor(out)
    // 本 chunk(含 64px 边距)内的光源标记
    out.lights = []
    // 实体生成点(敌人 / 物理道具):落在本 chunk 内的,主线程首次拿到该 chunk 时实例化一次
    out.spawns = []
    for (const layer of this.layers.values()) for (const s of layer.spawns || []) {
      if (s.x >= wx0 && s.x < wx0 + CHUNK && s.y >= wy0 && s.y < wy0 + CHUNK) out.spawns.push(s)
    }
    // PixelSprite props(煤矿木架 / 丛林树 / 金库机器):不是实体,当背景贴图钉在 (x - anchor) 处;图可能伸进邻 chunk,所以邻近 chunk 的生成点也要看
    for (const layer of this.layers.values()) for (const s of layer.spawns || []) {
      const ps = PIXEL_SPRITES[s.entity]
      if (!ps) continue
      const img = this.assets.scene('props', ps.img)
      if (!img) continue
      const sx = s.x - ps.ax, sy = s.y - ps.ay
      if (sx >= wx0 + CHUNK || sy >= wy0 + CHUNK || sx + img.w <= wx0 || sy + img.h <= wy0) continue
      out.scenes.push({ dir: 'props', name: ps.img, biome: layer.biome, x: sx, y: sy, ax: sx + WORLD_CENTER_CHUNK_X * CHUNK, ay: sy + WORLD_CENTER_CHUNK_Y * CHUNK, w: img.w, h: img.h, bgSprite: true, z: 30, func: 'pixelsprite', material: null, colorMaterial: null })
    }
    out.spawns = out.spawns.filter((s) => !PIXEL_SPRITES[s.entity] && s.entity !== 'physics_hanging_wire') // 吊线走 _wireDecor
    // 布景图里的标记像素:法杖祭坛 wand_altar.png 的 0x50a0f0 @(10,3) → spawn_wands → spawn(g_items, x-5, y, 0, 0)
    for (const sc of out.scenes) {
      if (sc.dir !== 'general' || sc.name !== 'wand_altar') continue
      const mx = sc.x + 10, my = sc.y + 3
      for (const s of rollSpawn(biome, 'g_items', mx - 5, my, this.seed + this.ng)) {
        if (s.x >= wx0 && s.x < wx0 + CHUNK && s.y >= wy0 && s.y < wy0 + CHUNK) out.spawns.push({ ...s, entity: s.entity.split('/').pop() })
      }
    }
    for (const layer of this.layers.values()) for (const l of layer.lights) {
      if (l.x >= wx0 - 64 && l.x < wx0 + CHUNK + 64 && l.y >= wy0 - 64 && l.y < wy0 + CHUNK + 64) out.lights.push(l)
    }
    // 圣山整图布景的标记(灯 / 商店 / 特权 / 传送门 / 碎石)
    for (const sc of this.staticScenesNear(cx, cy)) {
      if (!sc.marks) continue
      for (const s of sc.marks.spawns) if (s.x >= wx0 && s.x < wx0 + CHUNK && s.y >= wy0 && s.y < wy0 + CHUNK) out.spawns.push(s)
      for (const l of sc.marks.lights) if (l.x >= wx0 - 64 && l.x < wx0 + CHUNK + 64 && l.y >= wy0 - 64 && l.y < wy0 + CHUNK + 64) out.lights.push(l)
    }
    return out
  }

  /**
   * VegetationComponent is_grass(coalmine.xml:material_on_top_of soil/sand_static,tree_probability 0.83):
   * 土/沙的上表面长一层 grass 像素。原作按 rand_seed 撒,这里按位置哈希取同概率。
   */
  _growGrass(mat, wx0, wy0) {
    const M_GRASS = this.M_GRASS, S = this.M_SOIL, SA = this.M_SAND
    for (let j = 1; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const idx = j * CHUNK + i
        const m = mat[idx]
        if ((m !== S && m !== SA) || mat[idx - CHUNK] !== 0) continue
        if (valueNoise((wx0 + i) / 3.1, (wy0 + j) / 3.1, 8376) < 0.83) mat[idx - CHUNK] = M_GRASS
      }
    }
  }

  /**
   * 给 chunk 挂上全部"只画不进材质"的散件:布景标记色散件 + 藤蔓 + 植被贴图;并标 spillUp(有植被伸到上一 chunk)。
   * 材质被改过(挖掘)后重画时也要重新算(树站的地面可能没了)。
   */
  attachDecor(chunk, { veg = null, stamp = true } = {}) {
    const { cx, cy, mat } = chunk
    chunk.decor = this._collectDecor(cx, cy, cx * CHUNK, cy * CHUNK)
    this._wireDecor(cx, cy, mat, chunk.decor)
    // 植被落点只在第一次生成时算(veg = 主线程 / 存档带回来的落点:重画 / 读档都用它,别按被挖过的地面重算 —— 树不能"瞬移"到新地面上,
    // 原作 is_visual=0 的树 / 蘑菇是 PixelSprite 实体,掉不掉由 SimplePhysicsComponent 决定,主线程 Vegetation.js 管)
    if (veg) { for (const d of veg) chunk.decor.push(d); chunk.spillUp = veg.some((d) => d.y < cy * CHUNK) }
    else {
      const before = chunk.decor.length
      chunk.spillUp = this._vegDecor(cx, cy, mat, chunk.decor)
      // is_visual=0 的植被(tree_material=wood_loose / fungus_loose / cactus):把贴图的实心像素烙进材质格 —— 子弹打得中、火烧得着、爆炸炸得掉
      if (stamp) for (let k = before; k < chunk.decor.length; k++) { const d = chunk.decor[k]; if (d.solid) this._stampVeg(chunk, d) }
    }
    return chunk
  }

  /** 把一棵 is_visual=0 植被的不透明像素写进本 chunk 的材质(只写空气格;PixelSprite clean_overlapping_pixels=0) */
  _stampVeg(chunk, d) {
    const img = this.assets.veg(d.name)
    if (!img?.data) return
    const ax0 = chunk.cx * CHUNK, ay0 = chunk.cy * CHUNK, W = img.width, mat = chunk.mat
    for (let py = 0; py < d.fh; py++) {
      const wy = d.y + py; if (wy < ay0 || wy >= ay0 + CHUNK) continue
      for (let px = 0; px < d.fw; px++) {
        const wx = d.x + px; if (wx < ax0 || wx >= ax0 + CHUNK) continue
        if (img.data[((py * W) + d.sx + px) * 4 + 3] < 128) continue
        const li = (wy - ay0) * CHUNK + (wx - ax0)
        if (mat[li] === 0) mat[li] = d.mat
      }
    }
  }

  /**
   * 植被贴图(biome xml VegetationComponent):原作是实体,这里按世界坐标哈希定位、烙进位图。
   * 表面在本 chunk 的 + 表面在下一 chunk 顶部 VEG_REACH 行内的(贴图伸进本 chunk,不然树在 chunk 缝上被切成两半;
   * 下一 chunk 没生成时,纯丘陵按解析地表算,其他群系等它生成后由 streamer 触发本 chunk 重画)。
   * @returns {boolean} 本 chunk 的植被有伸到上一 chunk 的
   */
  _vegDecor(cx, cy, mat, out) {
    const ay0 = cy * CHUNK
    let spillUp = false
    for (const d of this._vegAnchors(cx, cy, (i, j) => mat[j * CHUNK + i], CHUNK)) { out.push(d); if (d.y < ay0) spillUp = true }
    const below = this.chunks.get(cx + ',' + (cy + 1))
    let get = null
    if (below) get = (i, j) => below.mat[j * CHUNK + i]
    else {
      const bb = this.biomeAtChunk(cx, cy + 1)
      if (BIOMES[bb]?.kind === 'surface') {
        const wx0 = (cx - WORLD_CENTER_CHUNK_X) * CHUNK, wy0 = (cy + 1 - WORLD_CENTER_CHUNK_Y) * CHUNK
        get = (i, j) => this._surfaceMatAt(wx0 + i, wy0 + j, bb)
      }
    }
    if (get) for (const d of this._vegAnchors(cx, cy + 1, get, VEG_REACH)) if (d.y < ay0 + CHUNK) out.push(d)
    return spillUp
  }

  /**
   * 某 chunk 的植被落点(只扫前 jMax 行)。规则同原 ChunkPainter:按 tree_width 分格、每格一个哈希抖动的候选 x、
   * tree_probability 掷;地面株放在 material_on_top_of 的上表面(实心上面是空),is_ceiling_plant 挂洞顶;
   * .xml Sprite 取最后一帧(长成态);tree_extra_y 往地里压。
   * @returns {Array<{kind:'veg',name:string,sx:number,fw:number,fh:number,x:number,y:number}>} 绝对像素(图左上)
   */
  _vegAnchors(cx, cy, get, jMax) {
    const out = []
    const list = this.assets.biomes?.[this.biomeAtChunk(cx, cy)]?.veg
    if (!list || !list.length) return out
    const kind = this.mats.kind, byName = this.mats.byName
    const ax0 = cx * CHUNK, ay0 = cy * CHUNK
    const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 1274126177) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h >>> 8) % 100000) / 100000 }
    const solid = (m) => { const k = kind[m]; return k === 'static' || k === 'solid' || k === 'sand' }
    for (const v of list) {
      if (!v.img) continue
      const onTop = v.onTopOf ? byName.get(v.onTopOf) : -1
      const step = Math.max(4, Math.round(v.width))
      const seed = (v.seed * 1000) | 0
      for (let gx = Math.floor(ax0 / step) * step; gx < ax0 + CHUNK; gx += step) {
        const x = gx + Math.floor(hash(gx, 1, seed) * step)
        if (x < ax0 || x >= ax0 + CHUNK) continue
        if (hash(x, 2, seed) >= v.prob) continue
        const i = x - ax0
        for (let j = 1; j < jMax; j++) {
          const m = get(i, j), mu = get(i, j - 1)
          let anchorY = -1, ceiling = false
          if (!v.isCeiling && solid(m) && mu === 0 && (onTop < 0 || m === onTop)) anchorY = j
          else if (v.isCeiling && solid(mu) && m === 0) { anchorY = j; ceiling = true }
          if (anchorY < 0) continue
          const name = v.img.range ? v.img.template.replace(/\$\[\d+-\d+\]/, String(v.img.range[0] + Math.floor(hash(x, anchorY, seed + 3) * (v.img.range[1] - v.img.range[0] + 1)))) : v.img.image
          const img = this.assets.veg(name)
          if (!img) continue
          const fw = v.img.fw || img.width, fh = v.img.fh || img.height
          const sx = (v.img.frames > 1 ? v.img.frames - 1 : 0) * fw
          const dx = i - (v.img.fw ? v.img.offX : Math.floor(fw / 2))
          const dy = ceiling ? anchorY : anchorY - fh + (v.img.fw ? fh - v.img.offY : 0) + v.extraY
          // is_visual=0(树 / 蘑菇 / 仙人掌):原作是 PixelSprite 实体,像素烙进材质格(tree_material),带 SimplePhysics 会整体下落
          const matId = !v.isVisual && v.material ? byName.get(v.material) : undefined
          out.push({ kind: 'veg', name, sx, fw, fh, x: ax0 + dx, y: ay0 + dy, ...(matId ? { solid: true, mat: matId, id: `${name}@${ax0 + dx},${ay0 + dy}` } : {}) })
          j += fh
        }
      }
    }
    return out
  }

  /**
   * 近景散件(只画不进材质):① 静态布景图里的标记色(spawn_grass 草丛整图 / spawn_vines 藤蔓)
   * ② init() 显式挂的藤蔓。返回世界坐标的列表,只留包围盒碰到本 chunk 的;ChunkPainter 烙进位图。
   * @returns {Array<{kind:'sprite',dir:string,name:string,x:number,y:number,w:number,h:number}|{kind:'vine',pts:number[],x0:number,y0:number,x1:number,y1:number}>}
   */
  _collectDecor(cx, cy, ax0, ay0) {
    const out = []
    const hits = (x0, y0, x1, y1) => x1 > ax0 && x0 < ax0 + CHUNK && y1 > ay0 && y0 < ay0 + CHUNK
    const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 1274126177) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h >>> 8) % 100000) / 100000 }
    const pushVine = (x1, y1, x2, y2, pts, seed) => {
      if (!pts) return
      const v = this._vinePath(x1, y1, x2, y2, pts, seed)
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
      for (let i = 0; i < v.length; i += 2) { bx0 = Math.min(bx0, v[i]); bx1 = Math.max(bx1, v[i]); by0 = Math.min(by0, v[i + 1]); by1 = Math.max(by1, v[i + 1]) }
      if (hits(bx0 - 3, by0 - 3, bx1 + 3, by1 + 3)) out.push({ kind: 'vine', pts: v, x0: bx0, y0: by0, x1: bx1, y1: by1 })
    }
    for (const sc of this.staticScenesNear(cx, cy)) {
      const marks = STATIC_DECOR_MARKS[sc.biome]
      if (!marks) continue
      const s = this.assets.scene(sc.dir, sc.name)
      if (!s) continue
      if (!s.marks) { // 扫一次缓存在布景对象上
        s.marks = []
        const d = s.mat.data
        for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
          const o = (y * s.w + x) * 4
          if (!d[o + 3]) continue
          const c = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2]
          if (marks[c]) s.marks.push({ c, x, y })
        }
      }
      const sx = sc.x + WORLD_CENTER_CHUNK_X * CHUNK, sy = sc.y + WORLD_CENTER_CHUNK_Y * CHUNK
      for (const mk of s.marks) {
        const def = marks[mk.c], ax = sx + mk.x, ay = sy + mk.y
        if (def.kind === 'sprite') {
          const img = this.assets.scene(def.dir, def.name)
          if (!img) continue
          const x = ax - def.ax, y = ay - def.ay
          if (hits(x, y, x + img.w, y + img.h)) out.push({ kind: 'sprite', dir: def.dir, name: def.name, x, y, w: img.w, h: img.h })
        } else if (def.kind === 'vine') {
          // g_vines 按权重掷(spawn() 用 ProceduralRandom;这里位置哈希取同分布)
          let r = hash(ax, ay, 91) * VINE_POOL.reduce((a, p) => a + p[0], 0), pts = 0
          for (const [w, n] of VINE_POOL) { if (r < w) { pts = n; break } r -= w }
          pushVine(ax, ay, null, null, pts, ax * 7 + ay)
        }
      }
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const list = STATIC_VINES[this.biomeAtChunk(cx + dx, cy + dy)]
      if (!list) continue
      const ox = (cx + dx) * CHUNK, oy = (cy + dy) * CHUNK
      for (const v of list) pushVine(ox + v.x1, oy + v.y1, v.x2 != null ? ox + v.x2 : null, v.y2 != null ? oy + v.y2 : null, v.pts, v.x1 * 13 + v.y1)
    }
    // ③ wang 标记 spawn_vines(g_vines 掷出来的 verlet 藤,挂点在标记 +10;只看本 chunk 附近 80px 内的)
    for (const layer of this.layers.values()) for (const v of layer.vines || []) {
      const ax = v.x + WORLD_CENTER_CHUNK_X * CHUNK, ay = v.y + WORLD_CENTER_CHUNK_Y * CHUNK
      if (ax < ax0 - 80 || ax > ax0 + CHUNK + 80 || ay < ay0 - 80 || ay > ay0 + CHUNK + 20) continue
      pushVine(ax, ay, null, null, v.pts, ax * 7 + ay)
    }
    return out
  }

  /**
   * 吊线(robobase g_vines → props/physics_hanging_wire,hanging_wire_spawner.lua):在生成点那一行左右各 60px 内找墙(RaytracePlatforms),跨度 <30 不放;
   * 每 30px 一个锚点,锚点上方 15px 内要有顶;相邻锚点之间拉一根下垂的 metal_wire(节 10px)。只用本 chunk 的材质找锚,画成暗灰细线(只画不进材质)。
   */
  _wireDecor(cx, cy, mat, out) {
    const wx0 = (cx - WORLD_CENTER_CHUNK_X) * CHUNK, wy0 = (cy - WORLD_CENTER_CHUNK_Y) * CHUNK
    const solid = (x, y) => { const i = x - wx0, j = y - wy0; if (i < 0 || j < 0 || i >= CHUNK || j >= CHUNK) return true; const m = mat[j * CHUNK + i]; return m > 0 && (this.mats.kind[m] === 'static' || this.mats.kind[m] === 'solid') }
    for (const layer of this.layers.values()) for (const s of layer.spawns || []) {
      if (s.entity !== 'physics_hanging_wire' || s.x < wx0 || s.x >= wx0 + CHUNK || s.y < wy0 || s.y >= wy0 + CHUNK) continue
      const px = Math.floor(s.x), py = Math.floor(s.y)
      let xMax = px, xMin = px
      while (xMax < px + 60 && !solid(xMax + 1, py)) xMax++
      while (xMin > px - 60 && !solid(xMin - 1, py)) xMin--
      if (xMax - xMin < 30) continue
      const ceiling = (x) => { for (let k = 1; k <= 15; k++) if (solid(x, py - k)) return py - k + 1; return null }
      const anchors = []
      for (let x = xMin; x <= xMax; x += 30) { const cy2 = ceiling(x); if (cy2 !== null) anchors.push([x, cy2]) }
      if (anchors.length && Math.abs(xMax - anchors[anchors.length - 1][0]) > 5) { const cy2 = ceiling(xMax); if (cy2 !== null) anchors.push([xMax, cy2]) }
      for (let k = 0; k + 1 < anchors.length; k++) {
        const [x1, y1] = anchors[k], [x2, y2] = anchors[k + 1]
        const n = Math.max(2, Math.round((x2 - x1) / 10) + 1), pts = []
        for (let i = 0; i < n; i++) { const t = i / (n - 1); pts.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + 4 * (2 + (x2 - x1) * 0.12) * t * (1 - t)) }
        out.push({ kind: 'wire', pts, x0: x1, y0: Math.min(y1, y2), x1: x2, y1: Math.max(y1, y2) + 8 })
      }
    }
  }

  /**
   * verlet 藤蔓静止形状(节距 resting_distance=4):单挂点 = 垂下来略带弯;双挂点 = 两点间下垂的抛物线。
   * @returns {number[]} [x,y,x,y,...] 绝对像素
   */
  _vinePath(x1, y1, x2, y2, pts, seed) {
    const out = []
    const sway = Math.sin(seed) * 0.6
    if (x2 == null) {
      for (let i = 0; i < pts; i++) {
        const t = i / Math.max(1, pts - 1)
        out.push(x1 + sway * i + Math.sin(i * 0.7 + seed) * 0.8, y1 + i * 3.9 - t * t * 2)
      }
      return out
    }
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy), L = (pts - 1) * 4
    const sag = Math.sqrt(Math.max(0, (L / 2) ** 2 - (d / 2) ** 2)) * 0.9
    for (let i = 0; i < pts; i++) {
      const t = i / Math.max(1, pts - 1)
      out.push(x1 + dx * t, y1 + dy * t + 4 * sag * t * (1 - t))
    }
    return out
  }

  /**
   * wang 群系填格(反 exe GetCellMaterial 0x908f40 的 type-2 路径 + WorldGen):每个世界格
   *   ① 抖动 0.5 倍(0x908cb0)→ 最近的 wang 像素是材质色(砖 / 木 / 钢…)→ 直接该材质
   *   ② 抖动 1.0 倍 → 灰度位图 smoothstep 双线性采样得 c(白 1 / 黑 0 / 标记色 0 / 材质色 1);c < 0.5 → 空气
   *      c ≥ 0.5:该处 wang 像素是材质色 → 该材质;否则 bands.pick(biome, x, y, c)(c 决定边界 ~5px 的 sand 圈)
   * 抖动噪声(simplex + 梯度 + 值噪声,置换表抠自 exe)幅度只有 ±1~5px,砖边的"有机感"主要来自 c 的 smoothstep 过渡与材质带。
   */
  _fillFromWang(mat, layer, ax0, ay0, wx0, wy0, biome) {
    const mats = this.mats
    const bands = this.bands
    const M_ROCK = this.M_ROCK
    const gray = (c) => {
      if (c <= 0) return 0
      if (c === 0xffffff) return 1
      if (mats.fromWang(c) >= 0) return 1
      const r = c >> 16, g = (c >> 8) & 255, b = c & 255
      if (r === g && g === b) return r / 255
      return 0 // spawn 标记 / 未知色
    }
    // 灰度按 wang 像素缓存(mapW × mapH 的 Float32),带 4 行 padding 的 buffer 直接索引
    if (!layer.grayCache) {
      const W = layer.mapW, H = layer.mapH, G = new Float32Array(W * H)
      for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) G[ty * W + tx] = gray(wangAt(layer, tx, ty))
      layer.grayCache = G
    }
    const G = layer.grayCache, W = layer.mapW, H = layer.mapH
    const gAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= W || ty >= H ? 0 : G[ty * W + tx])
    const oxw = (ax0 + WANG_SAMPLE_OFFSET - layer.originX) / TILE, oyw = (ay0 + WANG_SAMPLE_OFFSET - layer.originY) / TILE // 本 chunk 左上格的 wang 坐标(格中心 = 整数 + 0.5 处)
    for (let j = 0; j < CHUNK; j++) {
      const wy = wy0 + j
      let row = j * CHUNK
      for (let i = 0; i < CHUNK; i++, row++) {
        const wx = wx0 + i
        const [j1x, j1y] = wangJitter(wx, wy, 1)
        const [b0x, b0y] = wangJitter(wx, wy, 0)
        const dx = j1x - b0x, dy = j1y - b0y // 抖动(wang px);0.5 倍 = 一半
        // ① 材质色:0.5 倍抖动最近像素
        const c1 = wangAt(layer, Math.floor(oxw + i / TILE + dx * 0.5), Math.floor(oyw + j / TILE + dy * 0.5))
        const m1 = c1 > 0 ? mats.fromWang(c1) : -1
        if (m1 >= 0) { mat[row] = m1; continue }
        // ② 灰度 smoothstep 双线性(格中心在 整数+0.5,先减 0.5 再取整)
        const sx = oxw + i / TILE + dx - 0.5, sy = oyw + j / TILE + dy - 0.5
        const fx0 = Math.floor(sx), fy0 = Math.floor(sy)
        let tx = sx - fx0, ty = sy - fy0
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty)
        const g00 = gAt(fx0, fy0), g10 = gAt(fx0 + 1, fy0), g01 = gAt(fx0, fy0 + 1), g11 = gAt(fx0 + 1, fy0 + 1)
        const c = (g00 + (g10 - g00) * tx) * (1 - ty) + (g01 + (g11 - g01) * tx) * ty
        if (c < 0.5) continue
        const c2 = wangAt(layer, Math.floor(oxw + i / TILE + dx), Math.floor(oyw + j / TILE + dy))
        const m2 = c2 > 0 ? mats.fromWang(c2) : -1
        if (m2 >= 0) { mat[row] = m2; continue }
        if (c2 > 0 && !(c2 === 0xffffff || (((c2 >> 16) === ((c2 >> 8) & 255)) && (((c2 >> 8) & 255) === (c2 & 255)))) && !ALL_MARK_COLORS.has(c2)) { mat[row] = M_ROCK; continue } // 未知彩色:兜底石头
        mat[row] = bands.pick(biome, wx, wy, c)
      }
    }
  }

  /**
   * noise_biome_edges(coalmine.xml / mountain_right_stub.xml 等 =1):真值里相邻的地形填充群系会越过群系图的格边"漫"进砖群系——
   * chunk(1536,512) 顶:右桩的 rock_static/soil 一直漫到 y≈538(0~26px,沿 x 按 ~50px 尺度起伏,约三成的边不漫);chunk(0,0) 左沿也有 0~33px 的同款。
   * 两边都在 NOISE_EDGE_BIOMES 里才漫(左桩 / 山厅没写这个标志,真值 y=0 那条边就是直的);漫进来的像素取邻居的地表材质(_surfaceMatAt),邻居那里是空气就不动。
   * 幅度 / 尺度按真值目测,不逐位一致。
   */
  _bleedSurfaceEdges(mat, cx, cy, wx0, wy0) {
    const SIDES = [[0, -1], [-1, 0], [1, 0]]
    for (const [sdx, sdy] of SIDES) {
      const nb = this.biomeAtChunk(cx + sdx, cy + sdy)
      if (BIOMES[nb]?.kind !== 'surface' || !NOISE_EDGE_BIOMES.has(nb)) continue
      const alongX = sdy !== 0
      const edgeSeed = alongX ? (cy * 2 + sdy) * 7919 : (cx * 2 + sdx) * 6007
      for (let t = 0; t < CHUNK; t++) {
        const along = alongX ? wx0 + t : wy0 + t
        const n = valueNoise(along / 52, 0.5, 4711 + edgeSeed)
        const d = Math.round(Math.max(0, (n - 0.5) / 0.5) * 26 + (valueNoise(along / 6, 0.5, 4712 + edgeSeed) - 0.5) * 4)
        for (let k = 0; k < d; k++) {
          const i = alongX ? t : sdx < 0 ? k : CHUNK - 1 - k
          const j = alongX ? k : t
          const m = this._surfaceMatAt(wx0 + i, wy0 + j, nb)
          if (m > 0) mat[j * CHUNK + i] = m
        }
      }
    }
  }

  _stampScene(mat, s, sc, ox, oy, wx0, wy0, chunkBiome = null) {
    const d = s.mat.data, W = s.w, H = s.h
    const mats = this.mats
    const cm = sc.colorMaterial
    // 图里的白 / 亮灰 = "这里填群系材质":材质按**这一格所在 chunk 的群系**取(真值 chunk(0,0):山体大图伸进煤矿的那一角是煤矿的 sand/rock_wet,不是山的 rock_hard),
    // 该群系没有 MaterialComponent 表(纯布景群系)才退回布景自己的群系 / 煤矿
    const bandBiome = chunkBiome && this.bands.xml(chunkBiome) ? chunkBiome : sc.biome && (this.bands.xml(sc.biome) || this.bands.config(sc.biome)) ? sc.biome : 'coalmine'
    const x0 = Math.max(0, -ox), y0 = Math.max(0, -oy)
    const x1 = Math.min(W, CHUNK - ox), y1 = Math.min(H, CHUNK - oy)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 4
        if (d[o + 3] === 0) continue
        const c = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2]
        if (c === 0) continue // 黑 = 不改
        let m
        if (cm && cm[c] !== undefined) m = mats.id(cm[c])
        else if (c === 0x000042) m = 0
        else {
          m = mats.fromWang(c)
          if (m < 0) {
            const r = c >> 16, g = (c >> 8) & 255, b = c & 255
            // 白/亮灰 = 群系材质带(和 wang 白一样);暗灰 = 空;标记色 = 空;其他未知色跳过
            if (r === g && g === b) m = r < 0x80 ? 0 : this.bands.pick(bandBiome, wx0 + ox + x, wy0 + oy + y)
            else if (ALL_MARK_COLORS.has(c) || TEMPLE_MARK_COLORS.has(c)) m = 0
            else continue
          }
        }
        mat[(oy + y) * CHUNK + ox + x] = m
      }
    }
  }

  /**
   * 地表丘陵(hills.xml Topology SIN_CAPPED_SIMPLEX + Materials 带,见 SURFACE-ALGO.md)。原作 simplex 不可逐位复现,
   * 按存档真值剖面(seed 1674172626,x∈[-1024,0]∪[1536,2048])拟合:一座山一个谷、格距 ~290px、峰 −125 谷 +50 左右,
   * 剖面平滑无碎尖(之前 4 倍频 4 层 fbm 出来的是三角尖,原作没有)。默认种子用拟合参数(rms 15px),其他种子同形不同位。
   * 材质带(hills.xml MaterialComponent,v = 深度值):soil [0.45,0.53) → sand_static [0.53,0.95) → rock_static ≥0.9,
   * 真值里 soil 厚 60~100、sand_static 厚 ~250、0.9~0.95 交叠段是 sand/rock 互嵌条带 → v 每单位 ≈650px,加小尺度抖动。
   */
  _fillSurface(mat, wx0, wy0, biome) {
    const B = this._surfaceBands(biome)
    for (let i = 0; i < CHUNK; i++) {
      const wx = wx0 + i
      const surf = this._surfaceHeight(wx)
      for (let j = 0; j < CHUNK; j++) {
        const wy = wy0 + j
        if (wy < surf) continue
        mat[j * CHUNK + i] = this._surfacePixel(wx, wy, surf, B)
      }
    }
    this._carveSurfaceCaves(mat, wx0, wy0)
  }

  /** 群系材质带(id 化,缓存);不认识的地表群系按 hills */
  _surfaceBands(biome) {
    let B = this._bandCache?.get(biome)
    if (B) return B
    const def = SURFACE_BANDS[biome] || SURFACE_BANDS.hills
    B = { amp: def.amp, bands: def.bands.map(([n, hi]) => [this.mats.id(n), hi]), deep: this.mats.id(def.deep), mixFrom: def.mixFrom, coal: !!def.coal, ramp: def.ramp || null }
    ;(this._bandCache ||= new Map()).set(biome, B)
    return B
  }

  /** 地表起伏倍率:群系按 chunk 定,相邻 chunk 中心之间 smoothstep 过渡,交界处不出台阶 */
  _surfaceAmp(wx) {
    const ampOf = (cx) => (SURFACE_BANDS[this.biomeAtChunk(cx, WORLD_CENTER_CHUNK_Y - 1)] || SURFACE_BANDS.hills).amp
    const u = (wx - CHUNK / 2) / CHUNK
    const c0 = Math.floor(u), t = u - c0
    const st = t * t * (3 - 2 * t)
    return ampOf(c0 + WORLD_CENTER_CHUNK_X) * (1 - st) + ampOf(c0 + 1 + WORLD_CENTER_CHUNK_X) * st
  }

  /**
   * 地表洞(hills.xml BitmapCaves surface_cave,见 SURFACE-ALGO.md §2):"先掷开几张嘴,再往下打蠕虫"。
   * 原作 7~12 张嘴撒在整片丘陵(上万像素)上,这里按 1536px 一段掷 0~2 张(期望 ≈1,真值 x∈[−1024,0] 一段里没有,吻合)。
   * 每张嘴:y = 地表+1 必破地面,朝下 ±0.35 起步,每步 carve 圆盘 r·rand(0.65,1.15)、转向 ±0.4 并 0.3 回正朝下,
   * 走 0.7r;分 2~7 叉,子洞步数/半径打 0.45/0.72 折,不再分叉。打到煤矿边界(y≈512)停。
   */
  _carveSurfaceCaves(mat, wx0, wy0) {
    const SEG = 1536
    const s0 = Math.floor((wx0 - 400) / SEG), s1 = Math.floor((wx0 + CHUNK + 400) / SEG)
    for (let si = s0; si <= s1; si++) {
      let disks = this.caveSegs.get(si)
      if (!disks) { disks = this._surfaceCaveDisks(si, SEG); this.caveSegs.set(si, disks) }
      for (const d of disks) {
        if (d.x + d.r < wx0 || d.x - d.r >= wx0 + CHUNK || d.y + d.r < wy0 || d.y - d.r >= wy0 + CHUNK) continue
        const x0 = Math.max(0, Math.floor(d.x - d.r - wx0)), x1 = Math.min(CHUNK - 1, Math.ceil(d.x + d.r - wx0))
        const y0 = Math.max(0, Math.floor(d.y - d.r - wy0)), y1 = Math.min(CHUNK - 1, Math.ceil(d.y + d.r - wy0))
        const r2 = d.r * d.r
        for (let j = y0; j <= y1; j++) {
          const dy = wy0 + j - d.y
          for (let i = x0; i <= x1; i++) { const dx = wx0 + i - d.x; if (dx * dx + dy * dy <= r2) mat[j * CHUNK + i] = 0 }
        }
      }
    }
  }

  /** 一段里的全部洞盘(确定性:种子 + 段号) */
  _surfaceCaveDisks(si, SEG) {
    const prng = new NollaPrng(0)
    prng.SetRandomSeed(this.seed ^ 0x5a17, si * 1536, 777)
    const rnd = (a, b) => a + prng.Next() * (b - a)
    const out = []
    const roll = prng.Next()
    const n = roll < 0.3 ? 0 : roll < 0.85 ? 1 : 2
    const worm = (x, y, heading, steps, r, kids) => {
      for (let k = 0; k < steps; k++) {
        if (y > 500) break
        out.push({ x, y, r: r * rnd(0.65, 1.15) })
        heading += rnd(-0.55, 0.55)
        heading = heading + (Math.PI / 2 - heading) * 0.12
        x += Math.cos(heading) * r * 0.7
        y += Math.sin(heading) * r * 0.7
        if (kids > 0 && k > 3 && prng.Next() < kids / steps) { kids--; worm(x, y, heading + rnd(-1.2, 1.2), Math.floor(steps * 0.45), r * 0.72, 0) }
      }
    }
    for (let i = 0; i < n; i++) {
      const x = si * SEG + rnd(120, SEG - 120)
      // 山体两侧不开口:出生山占着 0~1536,真值 x∈[−1024,0] 的丘陵也没有洞
      if (x > -1100 && x < 2100) continue
      const y = this._surfaceHeight(x) + 1
      worm(x, y, Math.PI / 2 + rnd(-0.35, 0.35), Math.floor(rnd(28, 60)), rnd(10, 17), Math.floor(rnd(2, 8)))
    }
    return out
  }

  /** 地表高度(世界 y,向下为正) */
  _surfaceHeight(wx) {
    const F = this.surfaceFit
    const n = 0.85 * valueNoise(wx / F.L + F.phi, 0.37, F.s) + 0.15 * valueNoise(wx / (F.L / 2) + F.phi * 1.7 + 3.3, 0.37, F.s + 17)
    return F.C + F.A * this._surfaceAmp(wx) * (n - 0.5) * 2
  }

  /**
   * 地表以下某像素的材质(wy ≥ surf)。原版 type-0 过程群系(0x90a860:随机浮点位图 + mGradient + 逐像素混合)没反完,
   * 按真值剖面(chunk(1536,0) 山桩,每 24px 一档)校成"概率混合":soil 0~24px 94% → 24~48 50% → 48~72 19% → 72~96 4%;
   * rock_static 48px 起 12% → 100px 20% → 150 31% → 200~280 48% → 320 63% → 360+ 70%,颗粒 = 9px simplex 斑块 + 2px 细麻点(真值 rock 段长 12~20 / sand 6~8)。
   * 之前是硬阈值(soil<52px、sand<325px 再突变成 rock),真值里 300px 以内根本没有"整片沙",是沙里越来越密的石头麻点。
   */
  _surfacePixel(wx, wy, surf, B) {
    const d = wy - surf
    const v = 0.45 + d / 650 + 0.05 * (valueNoise(wx / 18, wy / 14, 5) * 2 - 1)
    // 混合噪声 ∈ [0,1]:中尺度斑块(14px simplex)+ 细颗粒(2px 值噪声);真值山桩 sand 段长 19~24 / rock 11~21
    const mixN = (ox) => Math.min(1, Math.max(0, 0.5 + 0.42 * simplex2((wx + ox) / 20, wy / 20) + 0.16 * (valueNoise(wx / 2.3 + ox, wy / 2.3, 6) - 0.5)))
    let m = B.deep
    for (const [id, hi] of B.bands) if (v < hi) { m = id; break }
    const first = B.bands[0][0]
    if (first === this.M_SOIL && B.bands.length > 1) {
      // soil → 第二带:80px 的概率过渡(真值 24~48px 处一半一半)
      const pSoil = Math.min(1, Math.max(0, (90 - d) / 80))
      if (d < 90) m = mixN(0) < pSoil ? this.M_SOIL : B.bands[1][0]
    }
    if (B.ramp) {
      // 深层材质的概率按**世界 y**(不是离地表深度:真值左桩上半区一片沙、越往下石头麻点越密,和局部地表无关)线性爬升:
      // 山桩 P(y) = 0.06 + y/520,封顶 0.72(真值 y 48 → 12%,150 → 31%,200~280 → 48%,360+ → 70%,再深仍有 25% 沙),其余留给最后一带
      const p = Math.min(B.ramp.max, Math.max(B.ramp.min ?? 0, B.ramp.base + wy / B.ramp.per))
      if (m !== this.M_SOIL) m = mixN(1000) < p ? B.deep : B.bands[B.bands.length - 1][0]
    } else {
      // 最后一带与深层的交叠段(0.9~0.95):按噪声互嵌成条带
      const lastHi = B.bands[B.bands.length - 1][1]
      if (v >= B.mixFrom && v < lastHi && valueNoise(wx / 9, wy / 9, 6) < (v - B.mixFrom) / (lastHi - B.mixFrom)) m = B.deep
    }
    // coal(is_rare polka,v 0.51~0.55,prob 0.16,scale 0.01×0.0036):贴着 soil/sand 交界的扁煤层
    if (B.coal && v >= 0.51 && v < 0.55 && this.M_COAL >= 0 && valueNoise(wx * 0.06, wy * 0.0216, 101) > 1 - 0.16 * 0.55) m = this.M_COAL
    return m
  }

  /**
   * 不生成整块也能知道的地表像素(纯地表 chunk):含 _growGrass 的那层草。
   * 给植被散件看"下一个 chunk 顶部"用——树/蘑菇挂在下面 chunk 的地表上、贴图伸进本 chunk 时不会被切掉。
   */
  _surfaceMatAt(wx, wy, biome) {
    const surf = this._surfaceHeight(wx)
    const top = Math.ceil(surf) // 第一行实心
    const B = this._surfaceBands(biome)
    if (wy < top) {
      if (wy === top - 1 && !this._inSurfaceCave(wx, top)) {
        const below = this._surfacePixel(wx, top, surf, B)
        if ((below === this.M_SOIL || below === this.M_SAND) && valueNoise(wx / 3.1, top / 3.1, 8376) < 0.83) return this.M_GRASS
      }
      return 0
    }
    if (this._inSurfaceCave(wx, wy)) return 0
    return this._surfacePixel(wx, wy, surf, B)
  }

  _inSurfaceCave(wx, wy) {
    const SEG = 1536
    for (let si = Math.floor((wx - 400) / SEG); si <= Math.floor((wx + 400) / SEG); si++) {
      let disks = this.caveSegs.get(si)
      if (!disks) { disks = this._surfaceCaveDisks(si, SEG); this.caveSegs.set(si, disks) }
      for (const d of disks) { const dx = wx - d.x, dy = wy - d.y; if (dx * dx + dy * dy <= d.r * d.r) return true }
    }
    return false
  }
}
