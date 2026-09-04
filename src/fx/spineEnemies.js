import * as PIXImod from 'pixi.js'

/**
 * Spine 敌机加载器（pixi-spine 2.1.12，配 PIXI v5）
 *
 * pixi-spine 2.x 依赖一个「全局且可写」的 PIXI，并会往 PIXI.spine 挂类。
 * ESM 的 `import * as PIXI` 是只读命名空间，所以这里用浅拷贝副本挂到 window，
 * 再动态 import pixi-spine（静态 import 会被提升，早于赋值执行）。
 * 副本与主程序共享同一份 pixi.js 模块实例（vite 只加载一次），类引用一致，
 * 故 Spine（PIXI.Container 子类）可直接 addChild 到主程序的任何容器。
 */
const PIXI = { ...PIXImod }
let SpineCtor = null
let _ready = null

export function initSpine() {
  if (!_ready) {
    _ready = (async () => {
      window.PIXI = PIXI
      await import('pixi-spine')
      SpineCtor = PIXI.spine.Spine
    })()
  }
  return _ready
}

const _data = new Map()

/** 预加载一批敌机的 spineData（/res/enemies-spine/<name>/<name>.json） */
export async function loadSpineEnemies(names) {
  await initSpine()
  const todo = names.filter((n) => !_data.has(n))
  if (!todo.length) return _data
  const loader = new PIXI.Loader()
  const B = import.meta.env.BASE_URL || '/' // 子路径部署：加 Vite base 前缀
  for (const n of todo) loader.add(n, `${B}res/enemies-spine/${n}/${n}.json`)
  await new Promise((resolve) => {
    loader.load((_l, resources) => {
      for (const n of todo) {
        const d = resources[n]?.spineData
        if (d) _data.set(n, d)
      }
      resolve()
    })
  })
  return _data
}

export function hasSpine(name) {
  return _data.has(name)
}

/**
 * 加载二进制骨骼（.skel，Spine 3.8）——juese 角色库用
 * @param {string} name 角色名（目录名 = 文件名）
 * @param {string} base 资源目录（如 /res/boss-spine）
 */
export async function loadSpineBinary(name, base) {
  await initSpine()
  if (_data.has(name)) return true
  const core = PIXI.spine.core
  const [atlasText, skelBuf] = await Promise.all([
    fetch(`${base}/${name}/${name}.atlas`).then((r) => r.text()),
    fetch(`${base}/${name}/${name}.skel`).then((r) => r.arrayBuffer()),
  ])
  const atlas = await new Promise((resolve) => {
    new core.TextureAtlas(atlasText, (line, cb) => {
      const bt = PIXI.BaseTexture.from(`${base}/${name}/${line}`)
      if (bt.valid) cb(bt)
      else bt.once('loaded', () => cb(bt))
    }, resolve)
  })
  const parser = new core.SkeletonBinary(new core.AtlasAttachmentLoader(atlas))
  const data = parser.readSkeletonData(new Uint8Array(skelBuf))
  _data.set(name, data)
  return true
}

/** 收集 Spine 实例当前渲染中的部件贴图（做碎裂效果用） */
export function collectSpineTextures(sp, max = 14) {
  const out = []
  const walk = (node) => {
    if (out.length >= max) return
    if (node.texture && node.texture.valid && node.texture !== PIXI.Texture.EMPTY) out.push(node.texture)
    if (node.children) for (const c of node.children) walk(c)
  }
  if (sp && sp.children) for (const c of sp.children) walk(c)
  return out
}

/**
 * 创建一个 Spine 敌机实例
 * @param {string} name 敌机名
 * @param {number} targetPx 目标显示高度（像素），内部按包围盒归一化缩放
 * @returns {object|null} Spine 实例（PIXI.Container 子类），失败返回 null
 */
const _boundsH = new Map() // 每种骨骼的包围盒高度缓存（getLocalBounds 较慢，只算一次）
export function makeSpineEnemy(name, targetPx = 90) {
  const data = _data.get(name)
  if (!data || !SpineCtor) return null
  const sp = new SpineCtor(data)
  const anims = sp.spineData.animations.map((a) => a.name)
  // 待机动画：优先 idle（大小写不敏感，兼容 C1863 的 Idle/Idle2），其次常见命名，否则取第一个循环播放
  const idle = anims.find((n) => /^(idle2?|daiji|stand|animation)$/i.test(n)) || anims[0]
  if (idle) sp.state.setAnimation(0, idle, true)
  sp.__anims = anims
  // 按包围盒归一化到目标像素高度
  let h = _boundsH.get(name)
  if (h === undefined) {
    h = sp.getLocalBounds().height || 100
    _boundsH.set(name, h)
  }
  const s = targetPx / h
  sp.scale.set(s)
  sp.__baseScale = s
  return sp
}

/** 受击时在 track 1 叠加播放一次 hit 动画（若有） */
export function spinePlayHit(sp) {
  if (!sp || !sp.state || !sp.__anims) return
  if (sp.__anims.includes('hit')) {
    const entry = sp.state.setAnimation(1, 'hit', false)
    if (entry) entry.mixDuration = 0.05
  }
}
