// ── 资源加载(浏览器实现;手机/Cocos 把 decodePng 换成自家解码即可,核心只吃 {width,height,data(RGBA)})──
// 目录约定(public/res/noita/,由 scripts/noita-prepare-assets.mjs 生成):
//   atlas/biome_map.png       群系图 70×48
//   wang/<biome>.png          wang 模板;wang/extra_layers/coalmine.png 煤矿外框叠加层
//   materials.json            材质表
//   scenes/<dir>/<name>.png   布景材质层;<name>_visual.png 手绘层;<name>_background.png 背景层
//   tex/<texture>.png         材质贴图;bg/background_<biome>.png 群系背景

import { WangTileset } from './core/stbhw.js'
import { loadMaterialTable } from './core/materials.js'
import { rgbaToRGB32 } from './core/biomes.js'
import { BIOME_MAP_W, BIOME_MAP_H } from './core/coords.js'
import { decodePng } from './core/png.js'

/**
 * 精确解码:fetch 字节 → 自带 PNG 解码器(不走 <img>,避免色彩管理/预乘改动 wang 色)。
 * 同时挂一个 image(仅供 drawImage 画手绘层,色值不精确也无妨)。
 */
export async function decodePngBrowser(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  const buf = await r.arrayBuffer()
  const png = await decodePng(buf)
  let image = null
  if (typeof createImageBitmap !== 'undefined') {
    // 用解码后的精确像素建位图,不再经过浏览器的 PNG 色彩管理
    image = await createImageBitmap(new ImageData(new Uint8ClampedArray(png.data.buffer), png.width, png.height))
    PIXELS.set(image, { data: png.data, width: png.width, height: png.height }) // 软光栅(render/SoftCanvas)按位图对象找回裸像素
  }
  return { width: png.width, height: png.height, data: png.data, image }
}

/** 位图 / 画布 → 裸 RGBA(非预乘)像素:decodePngBrowser 出来的 ImageBitmap 自动登记;自己画的 canvas 用 tagPixels(canvas, imageData) 登记 */
export const PIXELS = new WeakMap()
export function tagPixels(img, imageData) { PIXELS.set(img, { data: imageData.data, width: imageData.width, height: imageData.height }) }

export class NoitaAssets {
  constructor({ base = '/res/noita', decodePng = decodePngBrowser } = {}) {
    this.base = base
    this.decodePng = decodePng
    this.tilesets = new Map()
    this.scenes = new Map()
    this.textures = new Map()
    this.pending = new Map()
  }

  async init() {
    const [bm, mats, overlay, biomes] = await Promise.all([
      this.decodePng(`${this.base}/atlas/biome_map.png`),
      loadMaterialTable(`${this.base}/materials.json`),
      this.decodePng(`${this.base}/wang/extra_layers/coalmine.png`).catch(() => null),
      fetch(`${this.base}/biomes.json`).then((r) => r.json()).catch(() => ({})),
    ])
    if (bm.width !== BIOME_MAP_W || bm.height !== BIOME_MAP_H) throw new Error(`biome_map 应为 ${BIOME_MAP_W}×${BIOME_MAP_H}`)
    this.biomeMap = { w: bm.width, h: bm.height, pixels: rgbaToRGB32(bm.data, bm.width * bm.height) }
    this.materials = mats
    this.overlay = overlay
    this.biomes = biomes // biome/<名>.xml 抽出的 VegetationComponent 等
    return this
  }

  /** 植被贴图(vegetation/*.png),按名缓存 */
  async loadVeg(name) {
    const key = 'veg/' + name
    if (this.textures.has(key)) return this.textures.get(key)
    return this._once(key, async () => {
      const t = await this.decodePng(`${this.base}/veg/${name}`).catch(() => null)
      this.textures.set(key, t)
      return t
    })
  }
  veg(name) { return this.textures.get('veg/' + name) || null }

  /** 某群系植被会用到的全部贴图名(展开 $[a-b] 模板) */
  vegImagesOf(biome) {
    const out = []
    for (const v of this.biomes[biome]?.veg || []) {
      if (!v.img) continue
      if (v.img.range) for (let i = v.img.range[0]; i <= v.img.range[1]; i++) out.push(v.img.template.replace(/\$\[\d+-\d+\]/, String(i)))
      else out.push(v.img.image)
    }
    return out
  }

  _once(key, fn) {
    if (this.pending.has(key)) return this.pending.get(key)
    const p = fn().finally(() => this.pending.delete(key))
    this.pending.set(key, p)
    return p
  }

  /** wang 模板 → 砖库(缓存) */
  async loadTileset(wangFile) {
    if (this.tilesets.has(wangFile)) return this.tilesets.get(wangFile)
    return this._once('ts:' + wangFile, async () => {
      const img = await this.decodePng(`${this.base}/wang/${wangFile}`)
      const rgb = new Uint8Array(img.width * img.height * 3)
      for (let i = 0; i < img.width * img.height; i++) {
        rgb[i * 3] = img.data[i * 4]; rgb[i * 3 + 1] = img.data[i * 4 + 1]; rgb[i * 3 + 2] = img.data[i * 4 + 2]
      }
      // static_tile 群系(天空神殿 / 瞭望塔):*_fg.png 不是砖库,本身就是那片区域的 wang 层(1px = 10 世界像素),原样交给 generateStaticTileLayer;
      // 同名 *_bg.png 是 static_tile_bg_mask(白 = 这格后面有群系背景墙,黑 = 露天空)
      let ts
      if (wangFile.startsWith('static_tile/')) {
        const bgMask = await this.decodePng(`${this.base}/scenes/${wangFile.replace(/_fg\.png$/, '_bg.png')}`).catch(() => null)
        ts = { staticTile: true, rgb, width: img.width, height: img.height, bgMask }
      } else ts = WangTileset.fromRGB(rgb, img.width, img.height)
      this.tilesets.set(wangFile, ts)
      return ts
    })
  }
  tileset(wangFile) { return this.tilesets.get(wangFile) || null }

  /**
   * 布景三层(材质必有;visual/background 可无)。
   * @param {string} [visualName] 手绘层文件名(不含 .png),缺省 `<name>_visual`;圣山顶几个变体共用 altar_top_visual
   * @param {string} [bgName] 背景层文件名,缺省 `<name>_background`(machine_7 借 machine_5 的)
   * @param {string} [matName] 材质图文件名,缺省 `<name>`(雪城堡 paneling_wall 配不同背景时 name 只是缓存键)
   */
  async loadScene(dir, name, visualName, bgName, matName) {
    const key = dir + '/' + name
    if (this.scenes.has(key)) return this.scenes.get(key)
    return this._once('sc:' + key, async () => {
      const url = `${this.base}/scenes/${dir}/${matName || name}`
      const [mat, visual, bg] = await Promise.all([
        this.decodePng(`${url}.png`).catch(() => null),
        visualName === '' ? null : this.decodePng(`${this.base}/scenes/${dir}/${visualName || name + '_visual'}.png`).catch(() => null),
        bgName === '' ? null : this.decodePng(`${this.base}/scenes/${dir}/${bgName || name + '_background'}.png`).catch(() => null),
      ])
      const sc = mat ? { w: mat.width, h: mat.height, mat, visual, bg } : null
      this.scenes.set(key, sc)
      return sc
    })
  }
  scene(dir, name) { return this.scenes.get(dir + '/' + name) || null }

  async loadTexture(name) {
    if (this.textures.has(name)) return this.textures.get(name)
    return this._once('tx:' + name, async () => {
      const t = await this.decodePng(`${this.base}/tex/${name}`).catch(() => null)
      this.textures.set(name, t)
      return t
    })
  }
  texture(name) { return this.textures.get(name) || null }

  async loadBackground(file) {
    return this._once('bg:' + file, async () => {
      const key = 'bg/' + file
      if (this.textures.has(key)) return this.textures.get(key)
      const t = await this.decodePng(`${this.base}/bg/${file}`).catch(() => null)
      this.textures.set(key, t)
      return t
    })
  }
  background(file) { return this.textures.get('bg/' + file) || null }
}
