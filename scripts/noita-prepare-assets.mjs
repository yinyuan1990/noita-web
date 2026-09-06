// ── 为 src/noita-map 准备运行时资源(从 data.wak 解包件 noita-ref/unpacked 抽取)──
// 1. materials.xml → public/res/noita/materials.json
//    [{id,name,parent,cellType,wang,color,texture,density,liquidSand,tags}]  id 顺序 = xml 出现顺序(air 恒为 0)
//    wang_color / Graphics.color / texture_file 按 _parent 继承(游戏同样这么做)
// 2. 材质贴图 materials_gfx/*.png → public/res/noita/tex/
// 3. 布景 biome_impl/<biome>/*.png → public/res/noita/scenes/<biome>/;根目录通用布景 → scenes/general/
// 4. 群系背景 weather_gfx/background_*.png → public/res/noita/bg/
// 用法:node scripts/noita-prepare-assets.mjs
import fs from 'fs'
import path from 'path'

const UNPACKED = 'noita-ref/unpacked'
const OUT = 'public/res/noita'
const SCENE_BIOMES = ['coalmine', 'excavationsite', 'snowcave', 'snowcastle', 'temple', 'mountain', 'vault', 'crypt', 'fungicave', 'rainforest', 'pyramid', 'wandcave', 'liquidcave', 'caves', 'overworld', 'pillars', 'spliced', 'hidden', 'wizardcave', 'the_end']

// ── 1. materials.xml ──
const xml = fs.readFileSync(`${UNPACKED}/materials.xml`, 'utf8')
const cells = []
// CellData 与 CellDataChild(子材质,继承 _parent)按出现顺序编号 —— 与游戏内材质 id 顺序一致
const re = /<(CellData|CellDataChild)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g
const attrsOf = (s) => {
  const o = {}
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]
  return o
}
let m
while ((m = re.exec(xml))) {
  const head = m[2] ?? ''
  const body = m[4] ?? ''
  const a = attrsOf(head)
  if (!a.name) continue
  const gfx = /<Graphics\b([^>]*)>/.exec(body)
  const g = gfx ? attrsOf(gfx[1]) : {}
  // 边缘描边:<Edge><EdgeGraphics color= percent= type=>(取第一条)—— 煤矿湿岩的深绿苔边就是它
  const eg = /<EdgeGraphics\b([^>]*)>/.exec(body)
  const e = eg ? attrsOf(eg[1]) : {}
  // 边缘印章图列表(<Edge><Images><Image filename>),黑 = 透明,沿材质/空气交界随机旋转盖章 —— 煤矿石头上的苔藓斑就是它
  const edgeBlock = /<Edge>([\s\S]*?)<\/Edge>/.exec(body)
  const eimgs = edgeBlock ? [...edgeBlock[1].matchAll(/<Image\b([^>]*)\/?>/g)].map((im) => attrsOf(im[1])).filter((x) => x.filename).map((x) => ({ f: path.basename(x.filename), rot: x.allow_random_rotation === '1', hor: x.do_only_horizontal_stripe === '1', ver: x.do_only_vertical_stripe === '1' })) : []
  // <ExplosionConfig>:solid_on_collision_explode / solid_on_break_explode 时按它炸(concrete_collapsed 崩塌块、玻璃)
  const xc = /<ExplosionConfig\b([^>]*)>/.exec(body)
  const x = xc ? attrsOf(xc[1]) : {}
  cells.push({ name: a.name, parent: a._parent || null, a, g, e, eimgs, x })
}
const byName = new Map(cells.map((c) => [c.name, c]))
const inherit = (c, pick, depth = 0) => {
  const v = pick(c)
  if (v !== undefined && v !== '') return v
  if (c.parent && byName.has(c.parent) && depth < 8) return inherit(byName.get(c.parent), pick, depth + 1)
  return undefined
}
// 模拟用属性(全部按 _parent 继承;数值字段缺省见 Noita 引擎默认)
const NUM_FIELDS = {
  density: 0, liquid_gravity: 1, liquid_viscosity: 0, liquid_damping: 0, liquid_flow_speed: 0, liquid_sticks_to_ceiling: 0,
  burnable: 0, on_fire: 0, fire_hp: 0, autoignition_temperature: 0, temperature_of_fire: 0, generates_smoke: 0, generates_flames: 0,
  requires_oxygen: 1, hp: 0, durability: 0, gfx_glow: 0, lifetime: 0, electrical_conductivity: 0, slippery: 0,
  gas_speed: 0, gas_upwards_speed: 0, gas_horizontal_speed: 0, gas_downwards_speed: 0,
  solid_friction: 0, solid_restitution: 0, solid_gravity_scale: 1, solid_break_on_explosion_rate: 0,
  always_ignites_damagemodel: 0, liquid_slime: 0, liquid_solid: 0, liquid_stains: 0,
  // 沾污(SpriteStains):status_threshold = 精灵被染占比不到这个数状态不生效(油 / 毒液 0.2);shaken_drop = 晃掉速度倍率(瞬移液 5);ignited_drop = 碰火时掉的倍率(水 10)
  liquid_sprite_stains_status_threshold: 0, liquid_sprite_stain_shaken_drop_chance: 1, liquid_sprite_stain_ignited_drop_chance: 0,
  // wiki(Making a custom material):platform_type 0 = fall through / 1 = can stand on;solid_static_type 0 = 会掉、角色能穿、弹丸不能;1 = 静态全挡;2~5 = 静态、角色能穿、弹丸不能
  // 树 / 蘑菇的 wood_loose / fungus_loose 都是 solid_static_type=0 platform_type=0 → 人和怪穿树走,子弹打得中
  platform_type: 1, solid_static_type: 0,
}
const STR_FIELDS = ['cold_freezes_to_material', 'warmth_melts_to_material', 'solid_break_to_type', 'solid_on_collision_material', 'status_effects', 'stains', 'liquid_stains_custom_color']
const materials = cells.map((c, id) => {
  const wang = inherit(c, (x) => x.a.wang_color)
  const color = inherit(c, (x) => x.g.color) || wang
  const tex = inherit(c, (x) => x.g.texture_file)
  const cellType = inherit(c, (x) => x.a.cell_type) || 'solid'
  const liquidSand = inherit(c, (x) => x.a.liquid_sand) === '1'
  const liquidStatic = inherit(c, (x) => x.a.liquid_static) === '1'
  // Noita 把所有"可被消耗的固体"都写成 cell_type=liquid,再用 liquid_static / liquid_sand 区分:静态岩 / 落沙 / 真液体
  const kind = c.name === 'air' ? 'air' : cellType === 'liquid' ? (liquidStatic ? 'static' : liquidSand ? 'sand' : 'liquid') : cellType
  const m = {
    id,
    name: c.name,
    parent: c.parent,
    kind,
    cellType,
    wang: wang ? wang.toLowerCase() : null,
    color: color ? color.toLowerCase() : null,
    texture: tex ? path.basename(tex) : null,
    // Graphics normal_mapped=1(gem_box2d 系:金块 / 宝石 / 药瓶玻璃):刚体的 png 不是颜色是法线图(红绿黄 = 朝向),显示色 = 材质 color 按法线打光
    normalMapped: inherit(c, (x) => x.g.normal_mapped) === '1',
    wangNoise: +(inherit(c, (x) => x.a.wang_noise_percent) ?? 0),
    tags: inherit(c, (x) => x.a.tags) || '',
  }
  const ec = inherit(c, (x) => x.e.color)
  if (ec) {
    m.edgeColor = ec.toLowerCase(); m.edgePercent = +(inherit(c, (x) => x.e.percent) ?? 1); m.edgeType = inherit(c, (x) => x.e.type) || 'EVERYWHERE'
    const imgs = inherit(c, (x) => (x.eimgs.length ? x.eimgs : undefined))
    if (imgs) m.edgeImages = imgs
  }
  for (const [k, def] of Object.entries(NUM_FIELDS)) {
    const v = inherit(c, (x) => x.a[k])
    const camel = k.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())
    m[camel] = v === undefined ? def : +v
  }
  // 导电:materials.xml 里只有金属显式写 1、油 / 胶水显式写 0 —— 真液体(水 / 血 / 岩浆 …)缺省就是导电的(不然油写 0 没意义),粉末 / 静态不导电
  if (inherit(c, (x) => x.a.electrical_conductivity) === undefined) m.electricalConductivity = kind === 'liquid' ? 1 : 0
  for (const k of STR_FIELDS) {
    const v = inherit(c, (x) => x.a[k])
    if (v) m[k.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())] = v
  }
  // 材质 solid_on_collision_explode(反 exe box2d_collisions.cpp 0x731e20,刚体每次接触都判):
  //   r = sqrt(0.5 × |v|(m/s) × 质量(kg) × cell_explosion_power),r = min(r, radius_max);r < radius_min 时按 cell_explosion_probability 抬到 radius_min,仍 < radius_min 不炸;
  //   |v| < cell_explosion_velocity_min(px/s → ÷6)不炸;炸在接触点。ConfigExplosion 默认(ctor 0x4c0f2b):power 1、radius_min 5、radius_max 150、velocity_min 0、probability 0
  if (inherit(c, (x) => x.a.solid_on_collision_explode) === '1') {
    const X = (k, d) => { const v = inherit(c, (q) => q.x[k]); return v === undefined ? d : +v }
    const XS = (k) => inherit(c, (q) => q.x[k])
    m.collisionExplode = {
      power: X('cell_explosion_power', 1), rMin: X('cell_explosion_radius_min', 5), rMax: X('cell_explosion_radius_max', 150), vMin: X('cell_explosion_velocity_min', 0), prob: X('cell_explosion_probability', 0),
      // 下面这块和 noita-prepare-projectiles 的 config_explosion 同形(ProjectileSystem.explode 直接吃)
      ex: {
        damage: X('damage', 0), shake: X('camera_shake', 0), hole: XS('hole_enabled') !== '0',
        power: [X('physics_explosion_power.min', 0), X('physics_explosion_power.max', 0.2)], knockback: X('knockback_force', 1),
        destroyLiquid: XS('hole_destroy_liquid') === '1', holeLiquid: XS('hole_destroy_liquid') === '1', rayEnergy: X('ray_energy', 0), maxDurability: X('max_durability_to_destroy', 0),
        sparks: XS('sparks_enabled') === '1' ? [X('sparks_count_min', 0), X('sparks_count_max', 0)] : null,
        matSparks: XS('material_sparks_enabled') === '1' ? [X('material_sparks_count_min', 0), X('material_sparks_count_max', 0)] : null,
        light: XS('light_enabled') === '1' ? { fade: X('light_fade_time', 0.1), r: X('light_r', 255), g: X('light_g', 255), b: X('light_b', 255), radius: X('light_radius_coeff', 1) } : null,
        createCell: X('create_cell_probability', 0) ? { p: X('create_cell_probability', 0), mat: XS('create_cell_material') || 'fire' } : null,
        sparkMaterial: XS('spark_material') || null, stains: X('stains_radius', 0),
      },
    }
  }
  return m
})
if (materials[0].name !== 'air') throw new Error('materials.xml 首个 CellData 应为 air')
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(`${OUT}/materials.json`, JSON.stringify(materials))
console.log(`materials.json: ${materials.length} 种材质`)

// ── 1b. 反应表 <Reaction>:输入可以是材质名或 [tag],输出材质名;probability 是每帧每格的百分比机会 ──
const reactions = []
for (const m of xml.matchAll(/<Reaction\b([^>]*?)(\/>|>[\s\S]*?<\/Reaction>)/g)) {
  const a = attrsOf(m[1])
  if (!a.input_cell1 || !a.input_cell2) continue
  reactions.push({
    p: +(a.probability ?? 100),
    in1: a.input_cell1, in2: a.input_cell2, in3: a.input_cell3 || null,
    out1: a.output_cell1 ?? a.input_cell1, out2: a.output_cell2 ?? a.input_cell2, out3: a.output_cell3 || null,
    fast: a.fast_reaction === '1', reqLifetime: +(a.req_lifetime ?? 0),
    convertAll: a.convert_all === '1', direction: a.direction || null,
    blob: +(a.blob_radius ?? 0), lonely: a.destroy_horizontally_lonely_pixels === '1',
    explosion: +(a.explosion_size ?? 0) || 0, entity: a.entity || null, audio: a.audio_fx_volume ? 1 : 0,
  })
}
fs.writeFileSync(`${OUT}/reactions.json`, JSON.stringify(reactions))
console.log(`reactions.json: ${reactions.length} 条反应`)

// ── 2. 材质贴图 ──
fs.mkdirSync(`${OUT}/tex`, { recursive: true })
let nTex = 0
for (const t of new Set(materials.map((x) => x.texture).filter(Boolean))) {
  const src = `${UNPACKED}/materials_gfx/${t}`
  if (fs.existsSync(src)) { fs.copyFileSync(src, `${OUT}/tex/${t}`); nTex++ }
}
console.log(`tex: ${nTex} 张`)
fs.mkdirSync(`${OUT}/tex/edge`, { recursive: true })
let nEdge = 0
for (const f of fs.readdirSync(`${UNPACKED}/materials_gfx/edge_files`)) if (f.endsWith('.png')) { fs.copyFileSync(`${UNPACKED}/materials_gfx/edge_files/${f}`, `${OUT}/tex/edge/${f}`); nEdge++ }
console.log(`edge: ${nEdge} 张`)

// ── 3. 布景 ──
const copyDir = (src, dst) => {
  if (!fs.existsSync(src)) return 0
  fs.mkdirSync(dst, { recursive: true })
  let n = 0
  for (const f of fs.readdirSync(src)) {
    const p = path.join(src, f)
    if (fs.statSync(p).isFile() && f.endsWith('.png')) { fs.copyFileSync(p, path.join(dst, f)); n++ }
  }
  return n
}
for (const b of SCENE_BIOMES) {
  const n = copyDir(`${UNPACKED}/biome_impl/${b}`, `${OUT}/scenes/${b}`)
  if (n) console.log(`scenes/${b}: ${n}`)
}
console.log(`scenes/general: ${copyDir(`${UNPACKED}/biome_impl`, `${OUT}/scenes/general`)}`)
// spliced/skull_in_desert 是唯一不走 _*.bat 切片、直接放子目录整图的(_pixel_scenes.xml → skull_in_desert/1.png @ 7100,-100)
for (const [src, dst] of [['skull_in_desert/1.png', 'skull_in_desert.png'], ['skull_in_desert/1_visual.png', 'skull_in_desert_visual.png']]) {
  if (fs.existsSync(`${UNPACKED}/biome_impl/spliced/${src}`)) fs.copyFileSync(`${UNPACKED}/biome_impl/spliced/${src}`, `${OUT}/scenes/spliced/${dst}`)
}

// ── 4. 背景 + wang 叠加层 + 群系图 ──
fs.mkdirSync(`${OUT}/bg`, { recursive: true })
let nBg = 0
for (const f of fs.readdirSync(`${UNPACKED}/weather_gfx`)) {
  if (/^background_.*\.png$/.test(f)) { fs.copyFileSync(`${UNPACKED}/weather_gfx/${f}`, `${OUT}/bg/${f}`); nBg++ }
}
console.log(`bg: ${nBg}`)
fs.mkdirSync(`${OUT}/wang/extra_layers`, { recursive: true })
fs.copyFileSync(`${UNPACKED}/wang_tiles/extra_layers/coalmine.png`, `${OUT}/wang/extra_layers/coalmine.png`)
for (const f of fs.readdirSync(`${UNPACKED}/wang_tiles`)) {
  if (f.endsWith('.png')) fs.copyFileSync(`${UNPACKED}/wang_tiles/${f}`, `${OUT}/wang/${f}`)
}
fs.mkdirSync(`${OUT}/atlas`, { recursive: true })
fs.copyFileSync(`${UNPACKED}/biome_impl/biome_map.png`, `${OUT}/atlas/biome_map.png`)

// ── 5. 植被:biome/<名>.xml 的 VegetationComponent → biomes.json;贴图 vegetation/*.png → veg/ ──
// tree_image_file 可能是 .png(整张)或 .xml(Sprite,含 offset 与帧尺寸,取第 1 帧);$[a-b] 是随机编号模板
fs.mkdirSync(`${OUT}/veg`, { recursive: true })
let nVeg = 0
for (const f of fs.readdirSync(`${UNPACKED}/vegetation`)) if (f.endsWith('.png')) { fs.copyFileSync(`${UNPACKED}/vegetation/${f}`, `${OUT}/veg/${f}`); nVeg++ }
const spriteInfo = (xmlPath) => {
  const p = `${UNPACKED}/${xmlPath.replace(/^data\//, '')}`
  if (!fs.existsSync(p)) return null
  const s = fs.readFileSync(p, 'utf8')
  const sp = attrsOf((/<Sprite\b([^>]*)>/.exec(s) || ['', ''])[1])
  const ra = attrsOf((/<RectAnimation\b([^>]*)>/.exec(s) || ['', ''])[1])
  return { image: path.basename(sp.filename || ''), offX: +(sp.offset_x || 0), offY: +(sp.offset_y || 0), fw: +(ra.frame_width || 0), fh: +(ra.frame_height || 0), frames: +(ra.frame_count || 1) }
}
const biomesOut = {}
for (const f of fs.readdirSync(`${UNPACKED}/biome`)) {
  if (!f.endsWith('.xml')) continue
  const s = fs.readFileSync(`${UNPACKED}/biome/${f}`, 'utf8')
  const veg = []
  for (const m of s.matchAll(/<VegetationComponent\b([^>]*)>/g)) {
    const a = attrsOf(m[1])
    if (a._enabled === '0') continue
    const file = a.tree_image_file || ''
    let img = null
    if (file) {
      // $[3-6] → 模板 + 范围;.xml → 读 Sprite
      const rg = /\$\[(\d+)-(\d+)\]/.exec(file)
      const range = rg ? [+rg[1], +rg[2]] : null
      const sample = file.replace(/\$\[(\d+)-(\d+)\]/, (_, a1) => a1)
      if (sample.endsWith('.xml')) {
        const si = spriteInfo(sample)
        if (si) img = { ...si, template: path.basename(file).replace(/\.xml$/, '.png'), range }
      } else img = { image: path.basename(sample), template: path.basename(file), range, offX: 0, offY: 0, fw: 0, fh: 0, frames: 1 }
    }
    veg.push({
      img, material: a.tree_material || null, onTopOf: a.material_on_top_of || null,
      prob: +(a.tree_probability || 0), rLow: +(a.tree_radius_low || 0), rHigh: +(a.tree_radius_high || 0), width: +(a.tree_width || 0),
      extraY: +(a.tree_extra_y || 0), isGrass: a.is_grass === '1', isCeiling: a.is_ceiling_plant === '1', isVisual: a.is_visual === '1',
      color: a.visual_color || null, seed: +(a.rand_seed || 0),
    })
  }
  const top = attrsOf((/<Topology\b([^>]*)>/.exec(s) || ['', ''])[1])
  // <Materials> 的 MaterialComponent 全字段(反 exe BiomeMaterials::GetMaterial 0x8f5030 要用:区间 / limit_y / is_rare 的 polka & perlin 门),按 xml 顺序
  const mats = []
  for (const m of s.matchAll(/<MaterialComponent\b([^>]*)>/g)) {
    const a = attrsOf(m[1])
    if (a._enabled === '0' || !a.material_name) continue
    mats.push({
      mat: a.material_name, index: +(a.material_index ?? 0), min: +(a.material_min ?? 0), max: +(a.material_max ?? 0),
      limitY: a.limit_y === '1', yMin: +(a.limit_min_y ?? -1e9), yMax: +(a.limit_max_y ?? 1e9),
      rare: a.is_rare === '1', prob: +(a.rare_polka_probability ?? 0), sx: +(a.rare_scale_x ?? 0), sy: +(a.rare_scale_y ?? 0),
      perlin: a.rare_use_perlin === '1', polka: a.rare_use_polka === '1', reqMin: +(a.rare_required_min ?? 0), reqMax: +(a.rare_required_max ?? 10),
      radLow: +(a.rare_polka_radius_low ?? 0), radHigh: +(a.rare_polka_radius_high ?? 0), boxed: a.rare_polka_is_boxed === '1',
      addPerlin: a.add_perlin === '1', apx: +(a.add_perlin_scale_x ?? 0), apy: +(a.add_perlin_scale_y ?? 0),
    })
  }
  biomesOut[f.replace(/\.xml$/, '')] = { veg, bg: top.background_image ? path.basename(top.background_image) : null, mats }
}
fs.writeFileSync(`${OUT}/biomes.json`, JSON.stringify(biomesOut))
console.log(`veg: ${nVeg} 张贴图;biomes.json ${Object.keys(biomesOut).length} 个群系`)

// ── 6. 地表视差天空:weather_gfx/parallax_*.png(白色蒙版,运行时着色)+ parallax_colors.bmp(昼夜调色带)→ sky/ ──
// parallax_colors.bmp 是美术用的 512×220 色板:x = 一天的时刻(512 步),每 20 行一条色带(带标签文字):
//   0 Background(天空)  20 Background(地平线光带,细线)  40 Clouds#1  60 Clouds#2  80 Mountain#1 highlight
//   100 Mountain#1 back  120 Mountain#2  140/160/180 Storm clouds #1~3  199 Stars alpha
// 这里把每条带取一行有效颜色,压成 512×10 的 parallax_colors.png(第 y 行 = 第 y 条带),运行时按时刻取列。
fs.mkdirSync(`${OUT}/sky`, { recursive: true })
for (const f of fs.readdirSync(`${UNPACKED}/weather_gfx`)) if (/^parallax_.*\.png$/.test(f)) fs.copyFileSync(`${UNPACKED}/weather_gfx/${f}`, `${OUT}/sky/${f}`)
// verlet 藤蔓的节精灵(4×3 × 8 帧)→ veg/,ChunkPainter 沿藤蔓路径贴
for (const f of ['vine_a.png', 'vine_b.png']) fs.copyFileSync(`${UNPACKED}/entities/verlet_chains/vines/vine_parts/${f}`, `${OUT}/veg/${f}`)
{
  const bmp = fs.readFileSync(`${UNPACKED}/weather_gfx/parallax_colors.bmp`)
  const off = bmp.readUInt32LE(10), W = bmp.readInt32LE(18), H = Math.abs(bmp.readInt32LE(22)), bpp = bmp.readUInt16LE(28)
  const rowBytes = Math.ceil((W * bpp) / 8 / 4) * 4
  const px = (x, y) => { const i = off + (H - 1 - y) * rowBytes + x * (bpp / 8); return [bmp[i + 2], bmp[i + 1], bmp[i]] }
  // 每条带的采样行(避开标签文字):色块本体在 band*20 + 0..8;地平线光带是第 20 行的一条细线(没有线的列 = 白 → 沿 x 取最近有色列)
  const BANDS = [4, 20, 44, 63, 83, 104, 123, 144, 163, 183]
  const rows = BANDS.map((y) => {
    const line = []
    for (let x = 0; x < W; x++) line.push(px(x, y))
    if (y === 20) { // 细线:白色(无线)处向左/右借最近颜色
      const ok = (c) => !(c[0] === 255 && c[1] === 255 && c[2] === 255)
      for (let x = 0; x < W; x++) if (!ok(line[x])) { let l = x - 1; while (l >= 0 && !ok(line[l])) l--; let r = x + 1; while (r < W && !ok(line[r])) r++; line[x] = l >= 0 && (r >= W || x - l <= r - x) ? line[l] : r < W ? line[r] : line[x] }
    }
    return line
  })
  // 星星 alpha:黑 0 / 白 1(有效数据在第 199 行,夜间 x≈256~370 为 1,两侧渐变)
  rows.push(Array.from({ length: W }, (_, x) => { const c = px(x, 199); return [c[0], c[0], c[0]] }))
  const zlib = await import('node:zlib')
  const raw = Buffer.alloc((W * 3 + 1) * rows.length)
  rows.forEach((line, y) => { raw[y * (W * 3 + 1)] = 0; line.forEach((c, x) => { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2] }) })
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(rows.length, 4); ihdr[8] = 8; ihdr[9] = 2
  fs.writeFileSync(`${OUT}/sky/parallax_colors.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
  console.log(`sky: parallax 蒙版 + 调色带 ${W}×${rows.length}`)
}
console.log('done')
