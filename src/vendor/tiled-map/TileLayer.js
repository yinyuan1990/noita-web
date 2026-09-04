import * as PIXI from 'pixi.js'
import Tile from './Tile.js'

/** From tiled-to-pixi (MIT) */
export default class TileLayer extends PIXI.Container {
  constructor(layer, tileSets) {
    super()
    this.setLayerProperties(layer)
    this.alpha = parseFloat(layer.opacity)
    this.setLayerTiles(layer, tileSets)
  }

  setLayerProperties(layer) {
    for (const property in layer) {
      if (Object.prototype.hasOwnProperty.call(layer, property)) {
        this[property] = layer[property]
      }
    }
  }

  setLayerTiles(layer, tileSets) {
    this.tiles = []
    for (let y = 0; y < layer.map.height; y++) {
      for (let x = 0; x < layer.map.width; x++) {
        const i = x + y * layer.map.width
        if (this.tileExists(layer, i)) {
          const tile = this.createTile(layer, tileSets, { i, x, y })
          this.tiles.push(tile)
          this.addChild(tile)
        }
      }
    }
  }

  createTile(layer, tileSets, tileData) {
    const { i, x, y } = tileData
    const tileSet = findTileSet(layer.tiles[i].gid, tileSets)
    const tile = new Tile(
      layer.tiles[i],
      tileSet,
      layer.horizontalFlips[i],
      layer.verticalFlips[i],
      layer.diagonalFlips[i],
    )
    tile.x = x * layer.map.tileWidth
    tile.y = y * layer.map.tileHeight + (layer.map.tileHeight - tile.textures[0].height)
    if (tile.textures.length > 1) {
      tile.animationSpeed = 1000 / 60 / tile.animations[0].duration
      tile.gotoAndPlay(0)
    }
    return tile
  }

  tileExists(layer, i) {
    return layer.tiles[i] && layer.tiles[i].gid && layer.tiles[i].gid !== 0
  }
}

function findTileSet(gid, tileSets) {
  let tileSet
  for (let i = tileSets.length - 1; i >= 0; i--) {
    tileSet = tileSets[i]
    if (tileSet.firstGid <= gid) break
  }
  return tileSet
}
