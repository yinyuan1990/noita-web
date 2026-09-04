import * as PIXI from 'pixi.js'

/** From tiled-to-pixi (MIT) */
export default class TileSet {
  constructor(route, tileSet) {
    this.setTileSetProperties(tileSet)
    const src = tileSet.image && tileSet.image.source
    const url = joinUrl(route, src)
    this.baseTexture = PIXI.Texture.from(url)
    this.setTileTextures()
  }

  setTileSetProperties(tileSet) {
    for (const property in tileSet) {
      if (Object.prototype.hasOwnProperty.call(tileSet, property)) {
        this[property] = tileSet[property]
      }
    }
  }

  setTileTextures() {
    this.textures = []
    const margin = this.margin || 0
    const spacing = this.spacing || 0
    const imgH = (this.image && this.image.height) || this.baseTexture.height
    const imgW = (this.image && this.image.width) || this.baseTexture.width
    for (let y = margin; y < imgH; y += this.tileHeight + spacing) {
      for (let x = margin; x < imgW; x += this.tileWidth + spacing) {
        const tileRectangle = new PIXI.Rectangle(x, y, this.tileWidth, this.tileHeight)
        this.textures.push(new PIXI.Texture(this.baseTexture.baseTexture || this.baseTexture, tileRectangle))
      }
    }
  }
}

function joinUrl(route, src) {
  if (!src) return route
  if (/^https?:\/\//.test(src) || src.startsWith('/')) return src
  const base = route.endsWith('/') ? route : route + '/'
  // resolve ../
  const parts = (base + src).split('/')
  const out = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.' && p !== '') out.push(p)
    else if (p === '' && out.length === 0) out.push('')
  }
  // keep leading /
  if (String(src).startsWith('/') || String(route).startsWith('/')) {
    return '/' + out.filter(Boolean).join('/')
  }
  return out.join('/')
}
