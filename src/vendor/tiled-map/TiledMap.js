import * as PIXI from 'pixi.js'
import tmx from 'tmx-parser'
import TileSet from './TileSet.js'
import TileLayer from './TileLayer.js'
import CollisionLayer from './CollisionLayer.js'

/** dirname for browser URLs (replaces node:path) */
function urlDirname(url) {
  const clean = String(url).split('?')[0]
  const i = clean.lastIndexOf('/')
  return i >= 0 ? clean.slice(0, i) : '.'
}

/**
 * From open-source tiled-to-pixi (MIT) — Reynau/tiled-to-pixi
 * ESM port for Vite + Pixi 5.
 */
export default class TiledMap extends PIXI.Container {
  static middleware(resource, next) {
    if (resource.extension !== 'tmx') return next()
    const xmlString = resource.xhr && resource.xhr.responseText
    if (!xmlString) return next(new Error('tmx missing responseText'))
    tmx.parse(xmlString, resource.url, (error, map) => {
      if (error) return next(error)
      resource.data = map
      next()
    })
  }

  constructor(resourceId) {
    super()
    this.layers = {}
    const resource = PIXI.Loader.shared.resources[resourceId]
    if (!resource || !resource.data) throw new Error(`TiledMap resource missing: ${resourceId}`)
    const route = urlDirname(resource.url)
    this.setDataProperties(resource.data)
    this.setDataTileSets(resource.data, route)
    this.setDataLayers(resource.data)
  }

  setDataProperties(data) {
    for (const property in data) {
      if (Object.prototype.hasOwnProperty.call(data, property)) {
        this[property] = data[property]
      }
    }
  }

  setDataTileSets(data, route) {
    this.tileSets = []
    ;(data.tileSets || []).forEach((tileSetData) => {
      this.tileSets.push(new TileSet(route, tileSetData))
    })
  }

  setDataLayers(data) {
    ;(data.layers || []).forEach((layerData) => {
      if (layerData.type === 'tile') {
        this.setTileLayer(layerData)
        return
      }
      this.layers[layerData.name] = layerData
    })
  }

  setTileLayer(layerData) {
    if (layerData.name === 'Collisions') {
      this.layers.CollisionLayer = new CollisionLayer(layerData)
      return
    }
    const tileLayer = new TileLayer(layerData, this.tileSets)
    this.layers[layerData.name] = tileLayer
    this.addChild(tileLayer)
  }
}
