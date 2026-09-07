// ── 群系注册表:群系图像素色 → 群系名 / wang 模板 / 类型(GEN-RULES.md §一,_biomes_all.xml)──
// 色值来自 biome/_biomes_all.xml(telescope generator_config 同源)。
// kind: 'wang' 有砖 | 'scene' 整图布景(圣山/山体) | 'surface' 地表噪声 | 'solid' 实心 | 'air' 空 | 'lava'

// biome xml Topology noise_biome_edges="1" 的群系(全部解包 xml 里只有这些显式写 1):相邻两个都在表里时,地形填充一侧会越过群系格边"漫"进砖群系(World._bleedSurfaceEdges)
export const NOISE_EDGE_BIOMES = new Set(['coalmine', 'excavationsite', 'winter_caves', 'clouds', 'mountain_right_stub', 'temple_altar_right_snowcastle', 'solid_wall_tower_1', 'solid_wall_tower_2'])

export const BIOMES = {
  // 主垂直栈
  coalmine: { color: 0xd57917, kind: 'wang', wang: 'coalmine.png', bg: 'background_coalmine.png', name: '煤矿' },
  coalmine_alt: { color: 0xd56517, kind: 'wang', wang: 'coalmine_alt.png', bg: 'background_coalmine_alt.png', name: '塌矿' },
  excavationsite: { color: 0x124445, kind: 'wang', wang: 'excavationsite.png', bg: 'background_excavationsite.png', name: '挖掘场' },
  snowcave: { color: 0x1775d5, kind: 'wang', wang: 'snowcave.png', bg: 'background_snowcave.png', name: '雪窟' },
  snowcastle: { color: 0x0046ff, kind: 'wang', wang: 'snowcastle.png', bg: 'background_snowcastle.png', name: '雪城堡' },
  rainforest: { color: 0x808000, kind: 'wang', wang: 'rainforest.png', bg: 'background_rainforest.png', name: '丛林' },
  rainforest_open: { color: 0xa08400, kind: 'wang', wang: 'rainforest_open.png', bg: 'background_rainforest.png', name: '丛林(开)' },
  rainforest_dark: { color: 0x375c00, kind: 'wang', wang: 'rainforest_dark.png', bg: 'background_rainforest_dark.png', name: '蛛巢' },
  vault: { color: 0x008000, kind: 'wang', wang: 'vault.png', bg: 'background_vault.png', name: '金库' },
  vault_frozen: { color: 0x0080a8, kind: 'wang', wang: 'vault_frozen.png', bg: 'background_vault_frozen.png', name: '冰封金库' },
  crypt: { color: 0x786c42, kind: 'wang', wang: 'crypt.png', bg: 'background_crypt.png', name: '艺术神殿' },
  fungicave: { color: 0xe861f0, kind: 'wang', wang: 'fungicave.png', bg: 'background_fungicave.png', name: '真菌洞' },
  fungiforest: { color: 0xa861ff, kind: 'wang', wang: 'fungiforest.png', bg: 'background_fungiforest.png', name: '菌林' },
  wizardcave: { color: 0x726186, kind: 'wang', wang: 'wizardcave.png', bg: 'background_wizardcave.png', name: '巫师洞' },
  liquidcave: { color: 0x89a04b, kind: 'wang', wang: 'liquidcave.png', bg: 'background_liquidcave.png', name: '古代实验室', randomColors: { 0x01cfee: [0xf86868, 0x7fceea, 0xa3569f, 0xc23055, 0x0bffe5] } },
  robobase: { color: 0x4e5267, kind: 'wang', wang: 'robobase.png', bg: 'background_robobase.png', name: '发电厂' },
  meat: { color: 0x572828, kind: 'wang', wang: 'meat.png', bg: 'background_meat.png', name: '肉界' },
  wandcave: { color: 0x006c42, kind: 'wang', wang: 'wand.png', bg: 'background_wandcave.png', name: '魔法神殿' },
  pyramid: { color: 0x967f11, kind: 'wang', wang: 'pyramid.png', bg: 'background_pyramid.png', name: '金字塔' },
  sandcave: { color: 0xe1cd32, kind: 'wang', wang: 'sandcave.png', bg: 'background_sandcave.png', name: '沙洞' },
  the_end: { color: 0x3c0f0a, kind: 'wang', wang: 'the_end.png', bg: 'background_the_end.png', name: '地狱' },
  the_sky: { color: 0xd3e6f0, kind: 'wang', wang: 'the_sky.png', bg: 'background_the_sky.png', name: '天空' },
  clouds: { color: 0x36d5c9, kind: 'wang', wang: 'clouds.png', bg: null, name: '云' },
  winter_caves: { color: 0x77a5bd, kind: 'wang', wang: 'snowchasm.png', bg: 'background_winter_caves.png', name: '雪裂谷' },
  // 塔(复用主线模板)
  solid_wall_tower_1: { color: 0x3d3e37, kind: 'wang', wang: 'coalmine.png', bg: 'background_coalmine.png', name: '塔·煤矿' },
  solid_wall_tower_2: { color: 0x3d3e38, kind: 'wang', wang: 'excavationsite.png', bg: 'background_excavationsite.png', name: '塔·挖掘场' },
  solid_wall_tower_3: { color: 0x3d3e39, kind: 'wang', wang: 'snowcave.png', bg: 'background_snowcave.png', name: '塔·雪窟' },
  solid_wall_tower_4: { color: 0x3d3e3a, kind: 'wang', wang: 'snowcastle.png', bg: 'background_snowcastle.png', name: '塔·雪城堡' },
  solid_wall_tower_5: { color: 0x3d3e3b, kind: 'wang', wang: 'fungicave.png', bg: 'background_fungicave.png', name: '塔·真菌' },
  solid_wall_tower_6: { color: 0x3d3e3c, kind: 'wang', wang: 'rainforest.png', bg: 'background_rainforest.png', name: '塔·丛林' },
  solid_wall_tower_7: { color: 0x3d3e3d, kind: 'wang', wang: 'vault.png', bg: 'background_vault.png', name: '塔·金库' },
  solid_wall_tower_8: { color: 0x3d3e3e, kind: 'wang', wang: 'crypt.png', bg: 'background_crypt.png', name: '塔·神殿' },
  solid_wall_tower_9: { color: 0x3d3e3f, kind: 'wang', wang: 'the_end.png', bg: 'background_the_end.png', name: '塔·地狱' },
  // 整图布景 / 特殊
  temple_altar: { color: 0x93cb4c, kind: 'scene', name: '圣山' },
  temple_altar_left: { color: 0x93cb4d, kind: 'scene', name: '圣山·左' },
  temple_altar_right: { color: 0x93cb4e, kind: 'scene', name: '圣山·右' },
  temple_wall: { color: 0x6dcb28, kind: 'scene', name: '圣山底' },
  temple_wall_ending: { color: 0x5a9628, kind: 'scene', name: '圣山底·末' },
  solid_wall_temple: { color: 0xb8a928, kind: 'solid', name: '圣山实心' },
  // 金字塔外壳(pyramid_*.lua init 放整图:entrance / hallway / left / right / top + 底座 left_bottom / right_bottom),内部 pyramid 是 wang 砖
  pyramid_entrance: { color: 0x967f5f, kind: 'scene', bg: 'background_pyramid.png', name: '金字塔·入口' },
  pyramid_hallway: { color: 0x167f5f, kind: 'scene', bg: 'background_pyramid.png', name: '金字塔·走廊' },
  pyramid_left: { color: 0x968f5f, kind: 'scene', bg: 'background_pyramid.png', name: '金字塔·左' },
  pyramid_right: { color: 0x968f96, kind: 'scene', bg: 'background_pyramid.png', name: '金字塔·右' },
  pyramid_top: { color: 0xc88f5f, kind: 'scene', bg: 'background_pyramid.png', name: '金字塔·顶' },
  // 山体:xml 是 SIN_CAPPED_SIMPLEX 地形填充(coarse_map_force_terrain=1)+ init() 盖整图,所以按 surface 打底
  mountain_left_stub: { color: 0x608080, kind: 'surface', name: '山·左桩' },
  mountain_left_entrance: { color: 0x208080, kind: 'surface', name: '山·左入口' },
  mountain_hall: { color: 0x204060, kind: 'surface', name: '山·大厅' },
  mountain_right: { color: 0x408080, kind: 'surface', name: '山·右' },
  mountain_right_stub: { color: 0xe08080, kind: 'surface', name: '山·右桩' },
  mountain_top: { color: 0xc08080, kind: 'surface', name: '山·顶' },
  mountain_floating_island: { color: 0xc08082, kind: 'air', name: '浮岛' },
  mountain_tree: { color: 0x14e1d7, kind: 'surface', name: '巨树' },
  mountain_lake: { color: 0xf7cf8d, kind: 'surface', name: '池' },
  // 地表 / 天空 / 液海
  hills: { color: 0x36d517, kind: 'surface', name: '丘陵' },
  hills2: { color: 0x33e311, kind: 'surface', name: '丘陵2' },
  desert: { color: 0xcc9944, kind: 'surface', name: '沙漠' },
  winter: { color: 0xd6d8e3, kind: 'surface', name: '雪原' },
  lake: { color: 0x1133f1, kind: 'water', name: '湖' },
  lake_statue: { color: 0x11a3fc, kind: 'water', name: '湖心岛' },
  lake_deep: { color: 0x1158f1, kind: 'water', name: '深湖' },
  water: { color: 0x0000ff, kind: 'water', name: '水' },
  lava: { color: 0xff6a02, kind: 'lava', name: '岩浆湖' },
  lava_90percent: { color: 0xffa717, kind: 'lava', name: '岩浆海' },
  lavalake: { color: 0x3d5a3d, kind: 'lava', name: '岩浆湖' },
  empty: { color: 0x48e311, kind: 'air', name: '空' },
  gold: { color: 0xffff00, kind: 'gold', name: '黄金' },
  solid_wall: { color: 0x3d3d3d, kind: 'solid', name: '极密岩' },
  solid_wall_tower: { color: 0x3f3d3e, kind: 'solid', name: '咒岩' },
  solid_wall_hidden_cavern: { color: 0x42244d, kind: 'solid', name: '隐洞' },
  boss_arena: { color: 0x14eed7, kind: 'air', name: '实验室(终)' },
  boss_arena_top: { color: 0x0da899, kind: 'air', name: '实验室顶' },
  // roadblock.xml:_EMPTY_ wang + coarse_map_not_terrain,roadblock.png 全透明只有一个生成点(10 只 acidshooter 的天空陷阱)→ 空气。
  // 之前没登记 → 走默认 solid,丘陵左上方(cx33,cy11)天上悬着一块 512 的岩石正方形
  roadblock: { color: 0xf0d517, kind: 'air', name: '路障(空)' },
  // 沙漠地表的静态图块 scale:地表群系打底,整图另由 init 放
  scale: { color: 0xeba500, kind: 'surface', name: '天平' },

  // ── 2026-09-07 全境补齐(之前没登记的 55 个色都走默认 solid = 一块 512 的岩石)──
  // sky_light_injector.xml:_EMPTY_ + coarse_map_inject_light,天上散着 29 格 —— 纯空气(之前是悬在天上的岩石方块)
  sky_light_injector: { color: 0xfe0000, kind: 'air', name: '天光注入点' },
  // 塔顶两侧的 hills 色(3d3e40,_biomes_all 里指到 hills.xml):y≈4096 的地下,地表算法给的就是实心 → 直接实心
  hills_tower: { color: 0x3d3e40, kind: 'solid', name: '塔顶丘陵' },
  // 单 chunk 的 init() 整图房间(biome xml 是 _EMPTY_ wang / 无 type,形状全由 LoadPixelScene 给,底是空气);STATIC_SCENE_INIT 放图,STATIC_ROOM_MARKS 扫标记放实体
  orbroom_02: { color: 0xffd102, kind: 'scene', bg: 'background_crypt.png', name: '宝珠室 02' },
  orbroom_04: { color: 0xffd104, kind: 'scene', bg: 'background_cave_09.png', name: '宝珠室 04' },
  orbroom_05: { color: 0xffd105, kind: 'scene', bg: 'background_wandcave.png', name: '宝珠室 05' },
  orbroom_06: { color: 0xffd106, kind: 'scene', bg: 'background_cave_07.png', name: '宝珠室 06' },
  orbroom_07: { color: 0xffd107, kind: 'scene', bg: 'background_cave_04_alt.png', name: '宝珠室 07' },
  orbroom_08: { color: 0xffd108, kind: 'scene', bg: 'background_the_end.png', name: '宝珠室 08' },
  orbroom_09: { color: 0xffd109, kind: 'scene', bg: 'background_cave_04_alt.png', name: '宝珠室 09' },
  orbroom_10: { color: 0xffd110, kind: 'scene', bg: 'background_crypt.png', name: '宝珠室 10' },
  essenceroom: { color: 0x157cb0, kind: 'scene', bg: 'background_crypt.png', name: '精华室·激光' },
  essenceroom_hell: { color: 0x157cb5, kind: 'scene', bg: 'background_crypt.png', name: '精华室·水' },
  essenceroom_alc: { color: 0x157cb6, kind: 'scene', bg: 'background_crypt.png', name: '精华室·酒' },
  essenceroom_air: { color: 0x157cb8, kind: 'scene', bg: 'background_crypt.png', name: '精华室·气' },
  mystery_teleport: { color: 0x157cb7, kind: 'scene', bg: 'background_crypt.png', name: '神秘传送室' },
  rock_room: { color: 0x326655, kind: 'scene', bg: 'background_rainforest_dark.png', name: '石室' },
  gun_room: { color: 0x39a760, kind: 'scene', bg: 'background_crypt.png', name: '枪室' },
  moon_room: { color: 0x567cb0, kind: 'scene', bg: 'background_rainforest_dark.png', name: '月室' },
  song_room: { color: 0x9d99d1, kind: 'scene', bg: 'background_crypt.png', name: '歌室' },
  ocarina: { color: 0x57cace, kind: 'scene', bg: 'background_crypt.png', name: '陶笛室' },
  alchemist_secret: { color: 0x57dace, kind: 'scene', bg: 'background_crypt.png', name: '炼金密室' },
  secret_lab: { color: 0xbaa345, kind: 'scene', bg: 'background_snowcave.png', name: '秘密实验室(Ylialkemisti)' },
  mestari_secret: { color: 0x1f3b62, kind: 'scene', bg: 'background_wizardcave.png', name: '大师密室(Mestarien mestari)' },
  ghost_secret: { color: 0x1f3b64, kind: 'scene', bg: 'background_cave_04_alt.png', name: '幽灵密室(Unohdettu)' },
  meatroom: { color: 0x796620, kind: 'scene', bg: 'background_the_end.png', name: '肉室(Kolmisilmän silmä)' },
  roboroom: { color: 0x9d893d, kind: 'scene', bg: 'background_robobase.png', name: '机器人室(Mestarien mestari)' },
  // 没有 type / wang 模板的(默认过程地形):整块先按该群系 xml 的材质表填实(robot_egg = lava、友人洞 / 传送室 = coal+rock_hard、密室 = 雪岩 / 煤金),init() 整图里 000042 挖出房间、黑 = 不改
  robot_egg: { color: 0x9e4302, kind: 'solid', fill: 'bands', bg: 'background_cave_01.png', name: '机器蛋室' },
  funroom: { color: 0x0a95a4, kind: 'scene', bg: 'background_crypt.png', name: '游乐室' },
  null_room: { color: 0xe17e32, kind: 'scene', bg: 'background_crypt.png', name: '虚无室' },
  teleroom: { color: 0x5f8fab, kind: 'solid', fill: 'bands', bg: 'background_cave_02.png', name: '传送室' },
  friend_1: { color: 0x6db55a, kind: 'solid', fill: 'bands', bg: 'background_cave_02.png', name: '友人洞 1' },
  friend_2: { color: 0x6db55b, kind: 'solid', fill: 'bands', bg: 'background_cave_02.png', name: '友人洞 2' },
  friend_3: { color: 0x6db55c, kind: 'solid', fill: 'bands', bg: 'background_cave_02.png', name: '友人洞 3' },
  friend_4: { color: 0x6db55d, kind: 'solid', fill: 'bands', bg: 'background_cave_02.png', name: '友人洞 4' },
  friend_5: { color: 0x6db55e, kind: 'solid', fill: 'bands', bg: 'background_cave_02.png', name: '友人洞 5' },
  friend_6: { color: 0x6db55f, kind: 'solid', fill: 'bands', bg: 'background_cave_02.png', name: '友人洞 6' },
  snowcave_secret_chamber: { color: 0x18a0d6, kind: 'solid', fill: 'bands', bg: 'background_snowcave.png', name: '雪窟密室' },
  snowcastle_hourglass_chamber: { color: 0x18d6d6, kind: 'solid', fill: 'bands', bg: 'background_cave_04_alt3.png', name: '沙漏室' },
  excavationsite_cube_chamber: { color: 0x24888a, kind: 'solid', fill: 'bands', bg: 'background_cave_04_alt3.png', name: '立方体室' },
  snowcastle_cavern: { color: 0x775ddb, kind: 'solid', fill: 'bands', bg: 'background_cave_02.png', name: '雪城堡侧洞' },
  wizardcave_entrance: { color: 0x804169, kind: 'scene', bg: 'background_crypt.png', name: '巫师洞入口(门怪)' },
  bridge: { color: 0xad8111, kind: 'scene', bg: 'background_snowcave.png', name: '吊桥' },
  // 圣山右室·雪城堡变体(altar_right_snowcastle.png,标记同 temple_altar_right)
  temple_altar_right_snowcastle: { color: 0x93cb5a, kind: 'scene', name: '圣山·右(雪城堡)' },
  // 全靠 spliced 整图给形状的(gourd_room.png 1536² / watercave.png 512×1139 已在 SPLICED_SCENES):底空气,标记在 spliced 图里(roomMarks 按像素所在群系查表)
  gourd_room: { color: 0x2e99d1, kind: 'air', bg: 'background_crypt.png', name: '葫芦室' },
  // type=BIOME_WANG_TILE + wang_template_file="" 的(coarse_map_force_terrain 只管粗图,不填地):底是空气,init() 整图 / spliced 图里 黑 = 空、白 = 材质带、000042 = 空
  watercave: { color: 0x3046c1, kind: 'scene', bg: 'background_cave_04_alt.png', name: '水洞' },
  snowcave_tunnel: { color: 0x7be311, kind: 'scene', bg: 'background_snowcave.png', name: '雪窟隧道' },
  lavalake_pit: { color: 0x3d5a4f, kind: 'scene', bg: 'background_cave_04_alt.png', name: '岩浆湖竖井' },
  lavalake_racing: { color: 0x4118d6, kind: 'scene', bg: 'background_cave_04_alt.png', name: '岩浆赛道' },
  dragoncave: { color: 0x364d24, kind: 'scene', bg: 'background_cave_02.png', name: '龙穴(Suomuhauki)' },
  boss_victoryroom: { color: 0x50eed7, kind: 'scene', bg: 'background_cave_02.png', name: '胜利室' },
  solid_wall_tower_10: { color: 0x3d3e41, kind: 'scene', bg: 'background_crypt.png', name: '塔顶(精华室)' },
  // 天空神殿 ×4 + 沙漠瞭望塔(biome_impl/static_tile/biome_*.xml static_tile="1"):wang 模板 *_fg.png 就是那片区域的 wang 层(不拼砖,1px = 10 世界像素,黑 = 空 / 白 = 材质带 / 彩色 = temples_common.lua 标记)
  biome_boss_sky: { color: 0xff00fc, kind: 'wang', wang: 'static_tile/boss_fg.png', staticTile: true, bg: 'background_crypt.png', name: '天空神殿·Boss(Kolmisilmän sydän)' },
  biome_barren: { color: 0xff00fb, kind: 'wang', wang: 'static_tile/barren_fg.png', staticTile: true, bg: 'background_wandcave.png', name: '天空神殿·荒芜' },
  biome_darkness: { color: 0xff00fd, kind: 'wang', wang: 'static_tile/darkness_fg.png', staticTile: true, bg: 'background_crypt.png', name: '天空神殿·黑暗' },
  biome_potion_mimics: { color: 0xff00fe, kind: 'wang', wang: 'static_tile/potion_mimics_fg.png', staticTile: true, bg: 'background_wandcave.png', name: '天空神殿·药水拟态' },
  watchtower: { color: 0xb70000, kind: 'wang', wang: 'static_tile/watchtower_fg.png', staticTile: true, bg: null, name: '瞭望塔' },
}

export const BIOME_BY_COLOR = new Map(Object.entries(BIOMES).map(([n, b]) => [b.color, n]))

export const biomeNameOf = (color) => BIOME_BY_COLOR.get(color & 0xffffff) || null

/**
 * 在群系图上找同色 4 连通块(region.rs find_regions / telescope findBiomeRegions)。
 * 完全被已有区域包围盒包含的小块并入已有区域(唯一例外:1×1 菌林斜纹格)。
 * @param {Uint32Array} pixels  0xRRGGBB,长 w*h
 */
export function findBiomeRegions(pixels, w, h, targetColor) {
  const visited = new Uint8Array(w * h)
  const regions = [], bboxes = []
  const qx = new Int32Array(w * h), qy = new Int32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (visited[idx] || pixels[idx] !== targetColor) continue
      const pts = []
      let qh = 0, qt = 0
      qx[qt] = x; qy[qt] = y; qt++
      visited[idx] = 1
      let minX = w, maxX = 0, minY = h, maxY = 0
      while (qh < qt) {
        const cx = qx[qh], cy = qy[qh]; qh++
        pts.push([cx, cy])
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy
        for (let k = 0; k < 4; k++) {
          const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0)
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          const ni = ny * w + nx
          if (visited[ni] || pixels[ni] !== targetColor) continue
          visited[ni] = 1
          qx[qt] = nx; qy[qt] = ny; qt++
        }
      }
      let valid = true
      for (let i = 0; i < regions.length; i++) {
        const [a, b, c, d] = bboxes[i]
        if (minX >= a && maxX <= c && minY >= b && maxY <= d) { regions[i].push(...pts); valid = false }
      }
      if (valid) { regions.push(pts); bboxes.push([minX, minY, maxX, maxY]) }
    }
  }
  return { regions, bboxes }
}

/** RGBA ImageData → Uint32 RGB 像素数组 */
export function rgbaToRGB32(data, n) {
  const out = new Uint32Array(n)
  for (let i = 0; i < n; i++) out[i] = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]
  return out
}
