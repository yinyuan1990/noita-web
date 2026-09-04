/**
 * Cocos2d 粒子 plist 解析（框架无关，2D Pixi 版与 3D three.js 版共用）
 * - loadCocosConfig(url) → { config, textureUrl }
 *   textureUrl 为 blob URL：优先同目录 png，其次 plist 内嵌 gzip 贴图，都没有为 null
 */

const _cache = new Map()

function parsePlistXML(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  const dict = doc.querySelector('plist > dict')
  const out = {}
  if (!dict) return out
  let key = null
  for (const node of dict.children) {
    if (node.tagName === 'key') {
      key = node.textContent
    } else if (key) {
      out[key] =
        node.tagName === 'real' || node.tagName === 'integer'
          ? parseFloat(node.textContent)
          : node.textContent
      key = null
    }
  }
  return out
}

/** cocos plist 原始键 → 发射器配置 */
export function normalizeConfig(raw) {
  const num = (k, d = 0) => (typeof raw[k] === 'number' && !Number.isNaN(raw[k]) ? raw[k] : d)
  const startSize = num('startParticleSize', 20)
  let endSize = num('finishParticleSize', startSize)
  if (endSize < 0) endSize = startSize // kCCParticleStartSizeEqualToEndSize
  return {
    maxParticles: num('maxParticles', 50),
    duration: num('duration', 1),
    lifespan: Math.max(0.05, num('particleLifespan', 1)),
    lifespanVar: num('particleLifespanVariance'),
    angle: num('angle'),
    angleVar: num('angleVariance'),
    startSize,
    startSizeVar: num('startParticleSizeVariance'),
    endSize,
    endSizeVar: num('finishParticleSizeVariance'),
    startColor: [num('startColorRed', 1), num('startColorGreen', 1), num('startColorBlue', 1), num('startColorAlpha', 1)],
    startColorVar: [num('startColorVarianceRed'), num('startColorVarianceGreen'), num('startColorVarianceBlue'), num('startColorVarianceAlpha')],
    endColor: [num('finishColorRed', 1), num('finishColorGreen', 1), num('finishColorBlue', 1), num('finishColorAlpha', 0)],
    endColorVar: [num('finishColorVarianceRed'), num('finishColorVarianceGreen'), num('finishColorVarianceBlue'), num('finishColorVarianceAlpha')],
    rotationStart: num('rotationStart'),
    rotationStartVar: num('rotationStartVariance'),
    rotationEnd: num('rotationEnd'),
    rotationEndVar: num('rotationEndVariance'),
    posVarX: num('sourcePositionVariancex'),
    posVarY: num('sourcePositionVariancey'),
    emitterMode: num('emitterType') === 1 ? 'radius' : 'gravity',
    // gravity mode
    speed: num('speed'),
    speedVar: num('speedVariance'),
    gravityX: num('gravityx'),
    gravityY: num('gravityy'),
    radialAccel: num('radialAcceleration'),
    radialAccelVar: num('radialAccelVariance'),
    tangentialAccel: num('tangentialAcceleration'),
    tangentialAccelVar: num('tangentialAccelVariance'),
    // radius mode
    startRadius: num('maxRadius'),
    startRadiusVar: num('maxRadiusVariance'),
    endRadius: num('minRadius'),
    endRadiusVar: num('minRadiusVariance'),
    rotatePerSecond: num('rotatePerSecond'),
    rotatePerSecondVar: num('rotatePerSecondVariance'),
    additive: num('blendFuncDestination', 1) === 1,
    textureFileName: raw.textureFileName || null,
    textureImageData: raw.textureImageData || null,
  }
}

/** plist 内嵌 textureImageData（base64 + gzip/zlib 的 PNG）→ blob URL */
async function decodeEmbeddedTexture(b64) {
  try {
    const bin = atob(b64.replace(/\s/g, ''))
    let bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const fmt = bytes[0] === 0x1f && bytes[1] === 0x8b ? 'gzip' : bytes[0] === 0x78 ? 'deflate' : null
    if (fmt) {
      if (typeof DecompressionStream === 'undefined') return null
      const ds = new DecompressionStream(fmt)
      const stream = new Blob([bytes]).stream().pipeThrough(ds)
      bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    }
    // 不是 PNG 就别塞给浏览器解码（会触发 image error），直接走兜底贴图
    if (!(bytes[0] === 0x89 && bytes[1] === 0x50)) return null
    return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
  } catch {
    return null
  }
}

/** 同目录贴图文件 → blob URL（404 时返回 null，避免各渲染框架自己处理加载失败） */
async function fetchTextureUrl(url) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return URL.createObjectURL(await r.blob())
  } catch {
    return null
  }
}

/**
 * 加载一份 cocos 粒子 plist
 * @returns {Promise<{config: object, textureUrl: string|null}>}
 */
export function loadCocosConfig(url) {
  if (_cache.has(url)) return _cache.get(url)
  const p = (async () => {
    const text = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`plist ${r.status} ${url}`)
      return r.text()
    })
    const config = normalizeConfig(parsePlistXML(text))
    let textureUrl = null
    if (config.textureFileName) {
      const dir = url.slice(0, url.lastIndexOf('/') + 1)
      textureUrl = await fetchTextureUrl(dir + config.textureFileName)
    }
    if (!textureUrl && config.textureImageData) {
      textureUrl = await decodeEmbeddedTexture(config.textureImageData)
    }
    return { config, textureUrl }
  })()
  _cache.set(url, p)
  return p
}
