# Cocos 2D 粒子特效模块 · 对接文档

从 Cocos2d（cocos2d-iphone）项目移植的 plist 驱动粒子系统，基于 **PixiJS** 渲染。
复刻了原版 `CCParticleEffectGenerator.m` 的全部组合特效，以及各 `CCParticleXxx.m` 子类里的自定义大小/速度/透明度曲线。

- 演示页：`/cocos-fx-demo.html`（点击画面任意处释放，支持自动轮播）
- 3D 版（three.js + three.quarks）：`/cocos-fx-3d-demo.html`，对接方式见 `src/fx/cocosParticles3d.js`

## 文件结构

| 文件 | 说明 |
| --- | --- |
| `src/fx/cocosParticles.js` | 2D 模块本体（发射器、曲线、组合特效、播放入口） |
| `src/fx/cocosPlist.js` | plist 解析 + 贴图解码（框架无关，2D/3D 共用） |
| `public/res/cocos-particles/` | 粒子资源，按 `flare / glow / dust / smoke` 分目录存放 `.plist`（部分带同名 `.png`） |

## 快速开始

```js
import { playCocosEffect } from '@/fx/cocosParticles.js'

// 在任意 PIXI.Container 上播放一个爆炸，自动加载资源、放完自动清理
await playCocosEffect(stage, 'bigBang', { x: 400, y: 300 })
```

就这一个调用即可完成 90% 的对接需求。首次播放某特效会 fetch 对应 plist（有缓存，之后零开销）。

## 环境要求

- **pixi.js v5~v7**（模块使用 `PIXI.Ticker.shared`、`BLEND_MODES.ADD`、`baseTexture` API，本项目为 v5.3；pixi v8 需改造）
- 资源目录必须可通过 `/res/cocos-particles/...` 访问（模块内 `BASE` 常量，迁移项目时改它）
- 贴图三级回退，任何一级失败都不会报错：同目录 `.png` → plist 内嵌 gzip 贴图（需浏览器支持 `DecompressionStream`）→ 程序生成的柔光圆斑

## API

### `playCocosEffect(parent, name, opts?)` — 推荐入口

播放一个组合特效，全部粒子放完后 resolve 并自动销毁。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `parent` | `PIXI.Container` | 挂载点，特效坐标相对它 |
| `name` | `string` | `COCOS_EFFECTS` 键名，见下方特效清单 |
| `opts.x / opts.y` | `number` | 释放位置，默认 0 |
| `opts.scale` | `number` | 整体缩放，默认 1 |

返回 `Promise<PIXI.Container | null>`（未知特效名返回 null 并 console.warn，不抛错）。
不需要等待时直接调用即可，无需 `await`。

### `listCocosEffects()` / `COCOS_EFFECTS`

`listCocosEffects()` 返回全部特效名数组，可用来做调试面板。
`COCOS_EFFECTS` 是特效注册表，往里加键即可扩展新特效（见「自定义」）。

### `loadCocosParticle(url)` — 手动加载

```js
const { config, texture } = await loadCocosParticle('/res/cocos-particles/flare/sparkFlare.plist')
```

解析 plist 并加载贴图，返回归一化配置 + `PIXI.Texture`。结果按 url 缓存。

### `new CocosEmitter(config, texture, opts?)` — 单发射器

需要精细控制（跟随角色、手动启停、改参数）时使用：

```js
import { loadCocosParticle, CocosEmitter, COCOS_MODIFIERS } from '@/fx/cocosParticles.js'

const { config, texture } = await loadCocosParticle('/res/cocos-particles/flare/sparkFlare.plist')
const em = new CocosEmitter(config, texture, {
  modifier: COCOS_MODIFIERS.sparkFlare,   // 可选，.m 曲线
  overrides: { maxParticles: 8, startSize: 40 }, // 可选，覆盖 plist 字段
  autoRemove: true,                        // 默认 true：duration 结束且粒子放完后自毁
  onComplete: () => {},                    // 播完回调
})
em.position.set(x, y)
parent.addChild(em)
// em.stop()     提前停止发射（已有粒子放完后仍走 autoRemove 流程）
// em.destroy()  立即销毁
```

`CocosEmitter` 继承 `PIXI.Container`，自动挂到 `PIXI.Ticker.shared` 上驱动，**不需要**外部调用 update。

### `COCOS_MODIFIERS`

`.m` 文件自定义曲线的移植，键名与发射器对应（`implodingFlare`、`candleFlare`、`growingFlare`、`sparkFlare`、`starGlow`、`flatGlow`、`implodingGlow`、`blastWave` 等）。每项可含：

| 字段 | 签名 | 作用 |
| --- | --- | --- |
| `size` | `(p, t) => px` | 覆盖粒子尺寸插值，`t` 为 0~1 生命进度，`p.orgSize` 是出生尺寸 |
| `speed` | `(p, t) => px/s` | 覆盖速度（gravity 模式下沿出生方向），`p.orgSpeed` 是出生速度 |
| `alpha` | `(p, t) => 0~1` | 覆盖透明度插值 |
| `scale` | `(p, t) => ({ w, h })` | 宽高独立缩放曲线（如 flatGlow 光带） |
| `scaleWH` | `{ wStart, wEnd, hStart, hEnd, *Var }` | 线性宽高缩放（如 chaoticFlare） |

## 特效清单

单发射器：

| 名称 | 效果 |
| --- | --- |
| `flare` | 持续燃烧火光 |
| `chaoticFlare` | 乱窜火苗 |
| `candleFlare` | 烛焰爆闪（速度先急减再缓慢） |
| `growingFlare` | 收缩聚能光球 |
| `sparkFlare` | 光痕闪光（随机角度绽放） |
| `blastWave` | 扩散冲击波环 |
| `dustRise` | 扬尘上升 |

组合特效（对应原版 `CCParticleEffectGenerator`）：

| 名称 | 效果 | 典型用途 |
| --- | --- | --- |
| `burstFlare` | 内爆聚能 + 爆发 | 技能蓄力爆发 |
| `groundExplode` | 双色尘团 + 尘爆 + 扬尘 | 落地爆炸 |
| `armExplode` | 卡通烟团 + 膨胀闪光 | 命中爆炸 |
| `cartoonExplode` | 烛焰爆闪 + 橙色烟团 | 合金弹头式小爆炸 |
| `areaBang` | 冲击波 + 聚能球 + 光痕 | 范围打击 |
| `bigBang` | 环形辉光 + 星光爆闪 + 横贯光带 + 爆缩 | 大招/核爆级 |
| `canBlast` | 5 组随机光环 + 光痕条 + 双冲击波 | 华丽的多层爆炸 |
| `nukeBlast` | areaBang 变体：光痕按各自飞行方向放射（`alignToDir`） | 核爆中心光效 |

另：发射器支持 `overrides: { alignToDir: true }`（对应 cocos `rotationIsDir`）——粒子贴图长轴朝向自身飞行方向，仅 gravity 模式生效，长条光痕类贴图适用。

## 自定义

**调参**：任何一层都可通过 `overrides` 覆盖 plist 字段。常用字段（完整清单见 `cocosPlist.js` 的 `normalizeConfig`）：

```
maxParticles  duration(-1 为常驻)  lifespan/lifespanVar  emissionRate
startSize/endSize(+Var)   startColor/endColor(+Var, [r,g,b,a] 0~1)
angle/angleVar  speed/speedVar  gravityX/gravityY  posVarX/posVarY
rotationStart/rotationEnd(+Var)
emitterMode('gravity'|'radius')  startRadius/endRadius(+Var)  rotatePerSecond
additive(混合模式，plist 自带)
```

**新增组合特效**：在 `COCOS_EFFECTS` 里加一个键，返回层数组：

```js
COCOS_EFFECTS.myBoom = () => [
  { src: 'blastWave', mod: 'blastWave', overrides: { startSize: 300 } },
  { src: 'sparkFlare', mod: 'sparkFlare', node: { rotation: Math.PI / 4, scale: 1.5 } },
]
```

每层字段：`src`（`SRC` 表里的 plist 键名）、`mod`（`COCOS_MODIFIERS` 键名，可选）、`overrides`（可选）、`node`（该层节点变换 `{ x, y, scale, scaleX, scaleY, rotation }`，可选）。

**新增粒子资源**：把 `.plist`（和可选同名 `.png`）放进 `public/res/cocos-particles/` 子目录，在 `SRC` 表登记一行即可。

## 注意事项

- **坐标系**：cocos y 轴朝上、pixi y 轴朝下，模块内部已做转换（角度取负），plist 参数无需修改。
- **单位**：粒子尺寸/速度均为像素，和 cocos 原值一致；整体缩放用 `opts.scale` 或层的 `node.scale`。
- **生命周期**：`playCocosEffect` 和 `autoRemove` 模式下无需手动清理；长驻发射器（`duration: -1`）需自行 `stop()` 或 `destroy()`。
- **性能**：粒子按发射器内部对象池复用；同一特效反复播放时 plist/贴图全部走缓存。`canBlast` 一次会创建 15 个发射器，高频场景建议换用较轻的 `cartoonExplode`。
- **驱动**：依赖 `PIXI.Ticker.shared`。若项目暂停了共享 ticker，粒子也会暂停。
