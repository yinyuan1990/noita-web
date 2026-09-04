// ── 坐标系(GEN-RULES.md §一、§二)──
// 群系图 70×48,1 像素 = 1 chunk = 512 世界像素;chunk(35,14) 左上 = 世界 (0,0)。
// wang 层:1 wang 像素 = 10 世界像素;一个 chunk = 51 wang 像素,每 5 个 chunk 补 1 像素凑 512。
// 区域 wang 缓冲的世界起点 correctedX/Y 不是 minChunk*512,而是"整 5 组 ×2560 + 组内 ×510",
// 这是游戏 floor(x/10) 查表带来的 2 像素错位——不照抄这条,布景全会偏。

export const CHUNK = 512
export const TILE = 10
export const BIOME_MAP_W = 70
export const BIOME_MAP_H = 48
export const WORLD_CENTER_CHUNK_X = 35
export const WORLD_CENTER_CHUNK_Y = 14
// 标记像素 → 世界坐标的固定偏移(telescope constants.TILE_OFFSET_X/Y,实测拟合值)
export const TILE_OFFSET_X = 5
export const TILE_OFFSET_Y = -13
// 世界像素 → wang 像素:引擎按 floor((x + 5)/10) 取(半格取整),不是 floor(x/10)。
// 用 seed 1674172626 存档真值 ±30px 搜索得到 (+5,+5),一致率 82% → 91%。
export const WANG_SAMPLE_OFFSET = 5

/** chunk 绝对像素 → 该层 wang 像素坐标 */
export const absToWangX = (layer, ax) => Math.floor((ax + WANG_SAMPLE_OFFSET - layer.originX) / TILE)
export const absToWangY = (layer, ay) => Math.floor((ay + WANG_SAMPLE_OFFSET - layer.originY) / TILE)

/** 区域 wang 缓冲尺寸(calc_map_dimensions) */
export function mapDimensions(bbox) {
  const [minX, minY, maxX, maxY] = bbox
  const td = (n) => Math.trunc(n / TILE)
  return {
    width: td((maxX + 1) * CHUNK) - td(minX * CHUNK),
    height: td((maxY + 1) * CHUNK) - td(minY * CHUNK),
  }
}

/** 区域 wang 缓冲 (0,0) 对应的世界坐标(chunk 绝对坐标系,原点在群系图 (0,0)) */
export function correctedOrigin(minChunkX, minChunkY) {
  const d5x = Math.floor(minChunkX / 5), d5y = Math.floor(minChunkY / 5)
  return {
    x: d5x * 5 * CHUNK + (minChunkX % 5) * 51 * TILE,
    y: d5y * 5 * CHUNK + (minChunkY % 5) * 51 * TILE,
  }
}

/** chunk 绝对坐标 → 世界坐标(玩家看到的坐标系) */
export const chunkAbsToWorldX = (ax) => ax - WORLD_CENTER_CHUNK_X * CHUNK
export const chunkAbsToWorldY = (ay) => ay - WORLD_CENTER_CHUNK_Y * CHUNK
export const worldToChunkAbsX = (wx) => wx + WORLD_CENTER_CHUNK_X * CHUNK
export const worldToChunkAbsY = (wy) => wy + WORLD_CENTER_CHUNK_Y * CHUNK

/**
 * wang 标记像素 (tileX, tileY)(tileY 已去掉 4 行 padding)→ 世界坐标(telescope utils.tileToWorldCoordinates)。
 * 这是布景锚点 / spawn 函数拿到的 (x, y)。
 */
export function tileToWorld(chunkBaseX, chunkBaseY, tileX, tileY) {
  const small = 51
  const dx = chunkBaseX - WORLD_CENTER_CHUNK_X
  const dy = chunkBaseY - WORLD_CENTER_CHUNK_Y
  const d5x = 5 * CHUNK * Math.floor(dx / 5)
  const m5x = ((dx % 5) + 5) % 5
  const baseX = d5x + m5x * small * TILE
  const wx = -TILE + baseX + tileX * TILE + TILE_OFFSET_X
  const d5y = 5 * CHUNK * Math.floor(dy / 5)
  const m5y = ((dy % 5) + 5) % 5
  let baseY = d5y + m5y * small * TILE
  if (m5y > 0) baseY += TILE
  const wy = -TILE + baseY + tileY * TILE + TILE_OFFSET_Y + TILE
  return { x: wx, y: wy }
}
