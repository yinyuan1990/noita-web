// ── 材质带:wang 白/灰(实心)像素 → 具体材质(biome/<名>.xml <Materials> MaterialComponent)──
// 原作在 C++ 里按噪声值落在 [material_min, material_max] 选材质,is_rare 的用 polka/perlin 撒"透镜"。
// 这里是同一套参数的近似实现(噪声函数不逐位一致,但 xml 里的区间/深度限制/概率/尺度全部照抄):
//   基带:v = 0.72 + 0.32·fbm(x,y 大尺度) + 深度项;哪段区间含 v 取谁(限 limit_y 的按世界 y 过滤)
//   稀有:perlin/polka 噪声 > (1 − probability) 时覆盖为该材质(rare_scale 控制斑块尺寸)
// 数值来自 coalmine.xml;其他群系先用统一回退(rock_static),后续按各 xml 填表。

import { fbm, valueNoise } from './noise.js'

// 顺序即 xml 顺序:后面的稀有材质会盖前面的
const BIOME_BANDS = {
  coalmine: {
    base: [
      { mat: 'soil', min: 0.45, max: 0.53, yMax: 424.229 },
      { mat: 'sand_static', min: 0.53, max: 0.95 },
      { mat: 'rock_static_wet', min: 0.9, max: 3.5 },
    ],
    rare: [
      { mat: 'coal', prob: 0.160871, sx: 0.0100004, sy: 0.00357165, perlin: false },
      { mat: 'coal', prob: 0.157143, sx: 0.0214286, sy: 0.0214286, perlin: true },
      { mat: 'copper', prob: 0.357143 * 0.35, sx: 0.007514286, sy: 0.007514286, perlin: true, yMin: 750 },
      { mat: 'gold', prob: 0.357143 * 0.12, sx: 0.027514286, sy: 0.057514286, perlin: true, yMin: 750 },
    ],
  },
  coalmine_alt: 'coalmine',
  // liquidcave.xml(古代实验室):soil 0.45~0.53 → sand_static 0.53~0.95 → rock_static 0.9~3.5;coal 两条 + copper / gold(v 1.05~1.25,y≥750)稀有,和煤矿同一套只是岩不湿
  liquidcave: {
    base: [
      { mat: 'soil', min: 0.45, max: 0.53, yMax: 424.229 },
      { mat: 'sand_static', min: 0.53, max: 0.95 },
      { mat: 'rock_static', min: 0.9, max: 3.5 },
    ],
    rare: [
      { mat: 'coal', prob: 0.160871, sx: 0.0100004, sy: 0.00357165, perlin: false, vMin: 0.51, vMax: 0.55 },
      { mat: 'coal', prob: 0.157143, sx: 0.0214286, sy: 0.0214286, perlin: true, vMin: 1.1, vMax: 1.2 },
      { mat: 'copper', prob: 0.357143 * 0.35, sx: 0.007514286, sy: 0.007514286, perlin: true, yMin: 750, vMin: 1.05, vMax: 1.25 },
      { mat: 'gold', prob: 0.357143 * 0.12, sx: 0.027514286, sy: 0.057514286, perlin: true, yMin: 750, vMin: 1.05, vMax: 1.2 },
    ],
  },
  // wandcave.xml(魔法神殿):templeslab_crumbling_static 全域打底,templeslab_static 夹在 v 1.0~1.5;diamond 0.757(v 1.1~1.2)/ radioactive_liquid 0.3(v 1.0~1.3)稀有
  wandcave: {
    base: [
      { mat: 'templeslab_static', min: 1.0, max: 1.5 },
      { mat: 'templeslab_crumbling_static', min: -9, max: 9 },
    ],
    rare: [
      { mat: 'diamond', prob: 0.757143 * 0.5, sx: 0.0214286, sy: 0.0214286, perlin: false, vMin: 1.1, vMax: 1.2 },
      { mat: 'radioactive_liquid', prob: 0.3 * 0.5, sx: 0.01, sy: 0.04, perlin: false, vMin: 1.0, vMax: 1.3 },
    ],
  },
  // pyramid.xml:同 crypt 一套(templebrickdark_static 0.8~3.6 为主 + rock_hard 0.6~1.0 夹层 + diamond 稀有),外加 sand_static 0.45~0.55 限 y<424(金字塔在地表附近,顶部能取到)
  pyramid: {
    base: [
      { mat: 'sand_static', min: 0.45, max: 0.55, yMax: 424.229 },
      { mat: 'templebrickdark_static', min: 0.8, max: 3.6, noise: 2 },
      { mat: 'rock_hard', min: 0.6, max: 1.0 },
      { mat: 'templebrickdark_static', min: -9, max: 9 },
    ],
    rare: [
      { mat: 'diamond', prob: 0.757143 * 0.5, sx: 0.0214286, sy: 0.0214286, perlin: false, vMin: 1.1, vMax: 1.2 },
    ],
  },
  // sandcave.xml(沙洞):soil(y<424)→ sandstone 0.53~1.45 → sand_static_red 1.0~1.7;稀有 rock_hard 0.8(v 0.53~1.05 大块)、silver 细线 + 矿脉、water 透镜(v 1.1~1.2)、
  // sand(会流的散沙,prob 0.8 v 0.9~3.5 —— 原作沙洞到处是流沙,这里压到 0.3 免得整片塌)
  sandcave: {
    base: [
      { mat: 'soil', min: 0.45, max: 0.53, yMax: 424.229 },
      { mat: 'sandstone', min: 0.53, max: 1.45 },
      { mat: 'sand_static_red', min: 1.0, max: 3.5 },
      { mat: 'sandstone', min: -9, max: 9 },
    ],
    rare: [
      { mat: 'rock_hard', prob: 0.8 * 0.5, sx: 0.02, sy: 0.02, perlin: false, vMin: 0.53, vMax: 1.05 },
      { mat: 'silver', prob: 0.960871 * 0.5, sx: 0.0100004, sy: 0.00357165, perlin: false, vMin: 0.4437, vMax: 0.46 },
      { mat: 'silver', prob: 0.317143 * 0.35, sx: 0.00761346874, sy: 0.00761346874, perlin: true, yMin: 750, vMin: 1.05, vMax: 1.25 },
      { mat: 'water', prob: 0.557143 * 0.5, sx: 0.0214286, sy: 0.0214286, perlin: false, vMin: 1.1, vMax: 1.2 },
      { mat: 'sand', prob: 0.3, sx: 0.05, sy: 0.05, perlin: false, vMin: 0.9, vMax: 3.5 },
    ],
  },
  // meat.xml(肉界):全是 meat_static(0.57~0.66 + 0.65~3.5 两条),gold 稀有 0.357(v 1.1~1.2)
  meat: {
    base: [{ mat: 'meat_static', min: -9, max: 9 }],
    rare: [{ mat: 'gold', prob: 0.357143 * 0.5, sx: 0.0214286, sy: 0.0214286, perlin: false, vMin: 1.1, vMax: 1.2 }],
  },
  // robobase.xml(发电站):rock_static_grey 0.53~0.95 → rock_static 0.9~3.5(soil 限 y<424 取不到);gold 细金线 + radioactive_liquid 0.357(v 1.1~1.2)
  robobase: {
    base: [
      { mat: 'rock_static_grey', min: 0.45, max: 0.95 },
      { mat: 'rock_static', min: 0.9, max: 3.5 },
    ],
    rare: [
      { mat: 'gold', prob: 0.960871 * 0.5, sx: 0.0100004, sy: 0.00357165, perlin: false, vMin: 0.4437, vMax: 0.46 },
      { mat: 'radioactive_liquid', prob: 0.357143 * 0.5, sx: 0.0214286, sy: 0.0214286, perlin: false, vMin: 1.1, vMax: 1.2 },
    ],
  },
  // the_end.xml(地狱):skullrock 0.53~1.55 → the_end 0.8~3.5;coal 两条 + lava 稀有 0.357(v 1.05~1.2:岩里的熔岩泡)
  the_end: {
    base: [
      { mat: 'skullrock', min: 0.45, max: 1.55 },
      { mat: 'the_end', min: -9, max: 9 },
    ],
    rare: [
      { mat: 'coal', prob: 0.160871, sx: 0.0100004, sy: 0.00357165, perlin: false, vMin: 0.51, vMax: 0.55 },
      { mat: 'coal', prob: 0.157143 * 0.45, sx: 0.0214286, sy: 0.0214286, perlin: true, vMin: 1.1, vMax: 1.2 },
      { mat: 'lava', prob: 0.357143 * 0.3, sx: 0.027514286, sy: 0.057514286, perlin: true, vMin: 1.05, vMax: 1.2 },
    ],
  },
  // wizardcave.xml(巫师洞):soil 0.45~0.53 → rock_static_purple 0.53~2.0;coal 两条 + copper / gold 稀有(同煤矿一套)
  wizardcave: {
    base: [
      { mat: 'soil', min: 0.45, max: 0.53, yMax: 424.229 },
      { mat: 'rock_static_purple', min: -9, max: 9 },
    ],
    rare: [
      { mat: 'coal', prob: 0.160871, sx: 0.0100004, sy: 0.00357165, perlin: false, vMin: 0.51, vMax: 0.55 },
      { mat: 'coal', prob: 0.157143 * 0.45, sx: 0.0214286, sy: 0.0214286, perlin: true, vMin: 1.1, vMax: 1.2 },
      { mat: 'copper', prob: 0.357143 * 0.35, sx: 0.007514286, sy: 0.007514286, perlin: true, yMin: 750, vMin: 1.05, vMax: 1.25 },
      { mat: 'gold', prob: 0.357143 * 0.12, sx: 0.027514286, sy: 0.057514286, perlin: true, yMin: 750, vMin: 1.05, vMax: 1.2 },
    ],
  },
  // 山体整图布景里的白像素:mountain_hall / left_entrance / right / top .xml 是 soil → rock_hard → rock_static(+ coal / copper / gold 稀有);两头的 stub 是 sand_static
  // 真值 chunk(512,−512)(hall.png 的白像素):rock_static 102k / rock_hard 73k、coal 只 56 格 → rock_hard 带压到 0.8、煤的两条稀有带都不出
  mountain_hall: {
    base: [
      { mat: 'soil', min: 0.45, max: 0.53, yMax: 424.229 },
      { mat: 'rock_hard', min: 0.53, max: 0.88 },
      { mat: 'rock_static', min: 0.88, max: 3.5 },
    ],
    rare: [
      { mat: 'copper', prob: 0.357143 * 0.35, sx: 0.007514286, sy: 0.007514286, perlin: true, yMin: 750 },
      { mat: 'gold', prob: 0.357143 * 0.12, sx: 0.027514286, sy: 0.057514286, perlin: true, yMin: 750 },
    ],
  },
  mountain_left_entrance: 'mountain_hall', mountain_right: 'mountain_hall', mountain_top: 'mountain_hall',
  mountain_left_stub: {
    base: [
      { mat: 'soil', min: 0.45, max: 0.53, yMax: 424.229 },
      { mat: 'sand_static', min: 0.53, max: 0.95 },
      { mat: 'rock_static', min: 0.9, max: 3.5 },
    ],
    rare: [
      { mat: 'coal', prob: 0.160871, sx: 0.0100004, sy: 0.00357165, perlin: false },
      { mat: 'coal', prob: 0.157143, sx: 0.0214286, sy: 0.0214286, perlin: true },
    ],
  },
  mountain_right_stub: 'mountain_left_stub',
  // excavationsite.xml:rock_static_grey 0.53~1.55(material_index 10)、coal_static 0.8~3.5(material_index 9,另一路噪声 + add_perlin);
  // diamond 0.45~0.53 限 y<424 在挖掘场深度永远取不到。两路噪声独立,coal_static 先判(noise 2);阈值按真值校准:
  // seed 1674172626 chunk(512,1536)/(−1536,1536) 实心里 coal_static 57% / 63%、rock_static_grey 43% / 37% → 阈值 0.84 ≈ 62%。
  // 稀有:coal 两条同 coalmine(真值里的 coal 几乎全来自布景,稀有带贡献很小);gold 按真值 379 / 806 格校准(y≥750,挖掘场全域);
  // diamond 0.357 限 y 750~2048 但真值两块都是 0 → 给极低概率
  excavationsite: {
    base: [
      { mat: 'coal_static', min: 0.84, max: 3.5, noise: 2 },
      { mat: 'rock_static_grey', min: 0.53, max: 1.55 },
    ],
    rare: [
      { mat: 'coal', prob: 0.160871, sx: 0.0100004, sy: 0.00357165, perlin: false, vMin: 0.51, vMax: 0.55 },
      { mat: 'coal', prob: 0.157143 * 0.45, sx: 0.0214286, sy: 0.0214286, perlin: true, vMin: 1.1, vMax: 1.2 },
      { mat: 'gold', prob: 0.357143 * 1.3, sx: 0.027514286, sy: 0.057514286, perlin: true, yMin: 750, vMin: 1.05, vMax: 1.2 },
      { mat: 'diamond', prob: 0.357143 * 0.2, sx: 0.007514286, sy: 0.007514286, perlin: true, yMin: 750, yMax: 2048, vMin: 1.05, vMax: 1.25 },
    ],
  },
  // snowcave.xml:snowrock_static 0.9~3.6 与 snow_sticky 0.1~0.58 走 material_index 9 一路噪声,snow_static 0.53~1.05 走 index 10 另一路;
  // ice_static 稀有(index 5,prob 0.1,polka 半径 0.8~1.8 = 大块冰);gold 0~0 是金脉修饰符占位,平时不出
  snowcave: {
    base: [
      { mat: 'snowrock_static', min: 0.9, max: 3.6 },
      { mat: 'snow_sticky', min: 0.1, max: 0.58 },
      { mat: 'snow_static', min: 0.53, max: 1.05, noise: 2 },
      { mat: 'snowrock_static', min: -9, max: 9 }, // 两路都没落到的兜底(≈ 57% 雪岩 / 42% 雪)
    ],
    rare: [
      { mat: 'ice_static', prob: 0.07, sx: 0.05 * 0.16, sy: 0.05 * 0.16, perlin: true },
    ],
  },
  snowcastle: 'snowcave', // snowcastle.xml 同一组材质(snow_sticky 区间 0.1~0.9 略宽),砖本身大多是钢/砖,白块很少
  // fungicave.xml:fungisoil 0.57~0.66 → sand_static 0.66~0.95 → rock_static 0.9~3.5;gold 两条稀有(0.96 概率的细金线 v 0.4437~0.46 + 0.357 的 v 1.1~1.2)
  fungicave: {
    base: [
      { mat: 'fungisoil', min: 0.45, max: 0.66 },
      { mat: 'sand_static', min: 0.66, max: 0.95 },
      { mat: 'rock_static', min: 0.9, max: 3.5 },
    ],
    rare: [
      { mat: 'gold', prob: 0.960871 * 0.5, sx: 0.0100004, sy: 0.00357165, perlin: false, vMin: 0.4437, vMax: 0.46 },
      { mat: 'gold', prob: 0.357143 * 0.5, sx: 0.0214286, sy: 0.0214286, perlin: false, vMin: 1.1, vMax: 1.2 },
    ],
  },
  // rainforest.xml:soil_lush 0.7~0.86 → sand_static_rainforest 0.86~1.65(index 10);gold 细金线 + **water 稀有透镜**(index 8,0.157,v 0.65~1.2:土里的积水洼)
  rainforest: {
    base: [
      { mat: 'soil_lush', min: 0.45, max: 0.86 },
      { mat: 'sand_static_rainforest', min: 0.86, max: 3.5 },
    ],
    rare: [
      { mat: 'gold', prob: 0.960871 * 0.5, sx: 0.0100004, sy: 0.00357165, perlin: false, vMin: 0.4437, vMax: 0.46 },
      { mat: 'water', prob: 0.157143, sx: 0.0214286, sy: 0.0214286, perlin: false, vMin: 0.65, vMax: 1.2 },
    ],
  },
  // vault.xml:rock_vault 0.53~0.95 → rock_static 0.9~3.5(soil 限 y<424 取不到);gold 细金线 + radioactive_liquid 稀有(v 1.1~1.2:岩里的放射液泡)
  vault: {
    base: [
      { mat: 'rock_vault', min: 0.45, max: 0.95 },
      { mat: 'rock_static', min: 0.9, max: 3.5 },
    ],
    rare: [
      { mat: 'gold', prob: 0.960871 * 0.5, sx: 0.0100004, sy: 0.00357165, perlin: false, vMin: 0.4437, vMax: 0.46 },
      { mat: 'radioactive_liquid', prob: 0.357143 * 0.5, sx: 0.0214286, sy: 0.0214286, perlin: false, vMin: 1.1, vMax: 1.2 },
    ],
  },
  // crypt.xml:templebrickdark_static 0.8~3.6(index 11,另一路噪声)为主,rock_hard 0.6~1.0(index 10)夹层;diamond 稀有 0.757(v 1.1~1.2);gold 0~0 不出
  crypt: {
    base: [
      { mat: 'templebrickdark_static', min: 0.8, max: 3.6, noise: 2 },
      { mat: 'rock_hard', min: 0.6, max: 1.0 },
      { mat: 'templebrickdark_static', min: -9, max: 9 },
    ],
    rare: [
      { mat: 'diamond', prob: 0.757143 * 0.5, sx: 0.0214286, sy: 0.0214286, perlin: false, vMin: 1.1, vMax: 1.2 },
    ],
  },
}

export class BandResolver {
  constructor(mats) {
    this.mats = mats
    this.cache = new Map()
    this.fallback = mats.id('rock_static')
  }

  /** 群系配置 → 材质 id 化 */
  config(biome) {
    let c = this.cache.get(biome)
    if (c !== undefined) return c
    let def = BIOME_BANDS[biome]
    if (typeof def === 'string') def = BIOME_BANDS[def]
    if (!def) c = null
    else {
      c = {
        base: def.base.map((b) => ({ ...b, id: this.mats.id(b.mat) })),
        rare: def.rare.map((r, i) => ({ ...r, id: this.mats.id(r.mat), seed: 101 + i * 31 })),
      }
    }
    this.cache.set(biome, c)
    return c
  }

  /**
   * @param {string} biome
   * @param {number} wx 世界 x   @param {number} wy 世界 y(玩家坐标系,决定 limit_y)
   */
  pick(biome, wx, wy) {
    const c = this.config(biome)
    if (!c) return this.fallback
    // 基带:大尺度斑块。真值统计(seed 1674172626 煤矿白块):rock_static_wet 44942 ≈ sand_static 42522,soil 极少,
    // 所以噪声中位数正好压在 sand/rock 的 0.9 分界上,soil(<0.53 且 y<424)只占顶部一小撮
    const v = 0.9 + 0.45 * (fbm(wx / 44, wy / 36, 7, 3) * 2 - 1)
    // 第二路噪声(xml 里 material_index 不同的材质各走各的噪声),同分布、不同种子与尺度
    let v2 = null
    let id = -1
    for (const b of c.base) {
      if (b.yMax !== undefined && wy > b.yMax) continue
      if (b.yMin !== undefined && wy < b.yMin) continue
      let bv = v
      if (b.noise === 2) { if (v2 === null) v2 = 0.9 + 0.45 * (fbm(wx / 52, wy / 40, 23, 3) * 2 - 1); bv = v2 }
      if (bv >= b.min && bv < b.max) { id = b.id; break }
    }
    if (id < 0) id = c.base[c.base.length - 1].id
    // 稀有透镜(vMin/vMax:xml 的 material_min/max —— 稀有材质只在基带噪声落在该区间时才有机会出现)
    for (const r of c.rare) {
      if (r.yMin !== undefined && wy < r.yMin) continue
      if (r.yMax !== undefined && wy > r.yMax) continue
      if (r.vMin !== undefined && (v < r.vMin || v >= r.vMax)) continue
      const n = r.perlin
        ? fbm(wx * r.sx * 4, wy * r.sy * 4, r.seed, 2)
        : valueNoise(wx * r.sx * 6, wy * r.sy * 6, r.seed)
      if (n > 1 - r.prob * 0.55) id = r.id
    }
    return id
  }
}
