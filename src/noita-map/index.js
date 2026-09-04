// ── noita-map:Noita 地图模块(原版算法复刻,可整体移植)──
// 分层:
//   core/    纯算法,零 DOM:PRNG、人字砖、修补/校验、坐标、群系、布景、材质带 → World.js 出 512×512 材质区块
//   assets.js  资源加载(浏览器实现;换 decodePng 即可跑在 Cocos / 小游戏)
//   render/  Canvas2D 区块渲染(可替换为引擎自己的渲染)
export { NollaPrng } from './core/NollaPrng.js'
export { WangTileset, generateWang } from './core/stbhw.js'
export * as coords from './core/coords.js'
export { BIOMES, biomeNameOf, findBiomeRegions } from './core/biomes.js'
export { generateRegionLayer, wangAt } from './core/wangLayer.js'
export { collectScenes, BIOME_SCENES, BIOME_SPAWN_FUNCS } from './core/scenes.js'
export { MaterialTable, loadMaterialTable } from './core/materials.js'
export { NoitaAssets, decodePngBrowser } from './assets.js'
export { NoitaWorld } from './World.js'
export { ChunkPainter } from './render/ChunkPainter.js'
export { WorldClient } from './worker/WorldClient.js'
export { ChunkStreamer } from './worker/ChunkStreamer.js'
export { ChunkStore } from './store/ChunkStore.js'
export { CellSim } from './sim/CellSim.js'
