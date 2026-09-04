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
