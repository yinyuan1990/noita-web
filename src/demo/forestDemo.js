/**
 * 森林俯视 Demo · 真实像素美术 + 雨天积水/倒影/折射
 *
 * 与 rainWeatherDemo.js 同一套教程管线，换成真实贴图：
 * 1. 雨滴粒子 + 落地飞溅子发射
 * 2. 造波噪声 step 裁切积水形状（随 wetness 下雨渐涨、停雨渐干）+ 边缘扫波
 * 3. 波纹粒子渲进全屏 RT：红=波强(可见涟漪)，绿蓝=扰动向量
 * 4. 角色可趟水：踩水波纹 + 溅水粒子 + 湿脚步音
 * 5. 真贴图树 / 骨骼动画主角 scale.y 翻负渲进倒影 RT + 天空倒影
 * 6. 绿蓝通道扰动倒影 UV
 * 7. 屏幕纹理同款 UV 采样 → 水下地面折射扭曲
 * 8. 反射透明度随造波值衰减
 *
 * 水塘贴图的 alpha 渲进 pondRT，与噪声积水在着色器里 max() 合并，
 * 同一个水面管线同时覆盖"固定水塘"和"雨天积水"。
 */
import * as PIXI from 'pixi.js'
import { DESIGN_WIDTH, DESIGN_HEIGHT, CAST, RES, ANIM_ALIASES, humanHeightPx } from '../config.js'
import { loadPixiSpine, getSpineClass, pickAnim } from '../utils/loadPixiSpine.js'
import { measureSpineNativeHeight, unitScaleFromNative } from '../utils/spineSize.js'
import { SEFFECT_INDEX } from '../data/seffectIndex.js'
import { SANIM_INDEX } from '../data/sanimIndex.js'

const W = DESIGN_WIDTH
const H = DESIGN_HEIGHT
const SCALE = 3
const TILE = 32 * SCALE

/** 素材图集里的裁切矩形（原生像素，未乘 SCALE） */
const RECTS = {
  grass: new PIXI.Rectangle(0, 0, 32, 32),
  treeRound: new PIXI.Rectangle(0, 256, 64, 64),
  pine: new PIXI.Rectangle(0, 192, 64, 64),
  // 两个完整的圆水塘（带完整岸线；避开上方木栈道像素行）
  pond: new PIXI.Rectangle(128, 226, 192, 92),
  // 带花草地变体
  grassF1: new PIXI.Rectangle(32, 0, 32, 32),
  grassF2: new PIXI.Rectangle(96, 32, 32, 32),
  grassF3: new PIXI.Rectangle(64, 64, 32, 32),
  // 地表植被（平贴地面；裁掉行底的黑色分隔线）
  plantTuft: new PIXI.Rectangle(0, 97, 32, 26),
  plantFern: new PIXI.Rectangle(32, 97, 32, 26),
  plantLeaf: new PIXI.Rectangle(64, 97, 32, 26),
  plantRed: new PIXI.Rectangle(160, 97, 32, 26),
  tuftGreen: new PIXI.Rectangle(416, 64, 32, 32),
  stonesSmall: new PIXI.Rectangle(384, 32, 32, 32),
  // 立牌道具
  stump: new PIXI.Rectangle(192, 96, 32, 32),
  logMoss: new PIXI.Rectangle(224, 96, 64, 32),
  boulder: new PIXI.Rectangle(352, 32, 32, 32),
  mushroom: new PIXI.Rectangle(416, 0, 32, 32),
  redFlower: new PIXI.Rectangle(416, 32, 32, 32),
  hut: new PIXI.Rectangle(448, 64, 64, 64),
  pineSmall: new PIXI.Rectangle(320, 32, 32, 64),
  logPile: new PIXI.Rectangle(352, 64, 64, 32),
  cauldron: new PIXI.Rectangle(64, 159, 32, 32),
  butterfly: new PIXI.Rectangle(384, 192, 32, 32),
}

// ─────────────────────────────────────────────
// 水面着色器（教程 2/6/7/8 步）
// ─────────────────────────────────────────────
const WATER_FRAG = `
precision highp float;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform vec4 inputClamp;

uniform sampler2D uNoise;    // 造波噪声：r=形状 fbm，g/b=辅助噪声
uniform sampler2D uRipple;   // 波纹 RT：r=波强，gb=扰动向量
uniform sampler2D uReflect;  // 倒影 RT（真贴图翻转 + 天空）
uniform sampler2D uPond;     // 水塘水面 mask（抠色后的贴图）
uniform float uTime;
uniform vec2  uScreen;
uniform float uCut;          // step 阈值（随 wetness 变化）
uniform vec2  uFocus;        // 摄像机焦点
uniform vec2  uRot;          // (cos, sin)
uniform float uZoom;
uniform vec4  uPondRect;     // 水塘世界矩形 (x, y, w, h)
uniform float uLevel;        // 河流水位 0..1（教程：调整 step 值 = 调整水位）
uniform float uNight;        // 夜晚程度 0..1：夜里水面以反射夜空为主
uniform vec2  uCam;          // 摄像机世界坐标（跟随人物）
uniform float uSnow;         // 积雪量 0..1：噪声阈值裁出雪斑→连片→全覆盖
uniform sampler2D uTrample;  // 踩踏 RT：r=踩掉的雪（脚印）

// 河流深度场：程序化生成，等价于教程手绘的"层层水位线"深度图
// 返回 0(岸上)..1(河心最深)；岸线用正弦叠加做随机化；每 2400px 重复一条（无限地图）
float riverDepth(vec2 world) {
  float wx = mod(world.x, 2400.0);
  float bankW = sin(world.y * 0.013 + 5.0) * 18.0 + sin(world.y * 0.007 + 1.3) * 22.0;
  float rcx = 190.0 + 70.0 * sin(world.y * 0.006 + 2.0) + bankW;
  return clamp(1.0 - abs(wx - rcx) / 115.0, 0.0, 1.0);
}

void main(void) {
  vec2 px  = vTextureCoord * inputSize.xy + outputFrame.xy;
  vec2 suv = px / uScreen;
  vec4 base = texture2D(uSampler, vTextureCoord);

  // 屏幕 → 世界坐标（反缩放 + 反旋转 + 相机偏移）——水面黏在地面上跟着转/跟着走
  vec2 dpx = (px - uFocus) / uZoom;
  vec2 world = uCam + vec2(dpx.x * uRot.x + dpx.y * uRot.y, -dpx.x * uRot.y + dpx.y * uRot.x);

  // —— 河床与岩壁（无水时也可见的干涸河道）——
  float rdepth = riverDepth(world);
  vec3 sceneCol = base.rgb;
  float bed = smoothstep(0.02, 0.14, rdepth);
  sceneCol = mix(sceneCol, sceneCol * vec3(0.80, 0.70, 0.55) + vec3(0.045, 0.032, 0.02), bed * 0.8);
  // 河床分层纹理（模拟教程里手绘的岩壁层次）
  float strata = 0.5 + 0.5 * sin(rdepth * 36.0 + world.y * 0.012);
  sceneCol *= 1.0 - bed * strata * 0.05;
  // 岸壁描边
  float bank = smoothstep(0.005, 0.03, rdepth) * (1.0 - smoothstep(0.05, 0.10, rdepth));
  sceneCol = mix(sceneCol, sceneCol * 0.5, bank);

  // —— 积雪：噪声做覆盖图，uSnow 抬高阈值——先积成斑块再连成片 ——
  if (uSnow > 0.002) {
    float sn = texture2D(uNoise, world * 0.0011 + vec2(0.31, 0.77)).r;
    float sn2 = texture2D(uNoise, world * 0.006 + vec2(0.13, 0.49)).g;
    float cover = smoothstep(1.08 - uSnow * 1.3, 1.3 - uSnow * 1.3, sn + sn2 * 0.3);
    // 脚印：踩踏 RT 削减雪覆盖，露出下面的地面
    float tr = texture2D(uTrample, suv).r;
    cover *= 1.0 - tr * 0.94;
    vec3 snowCol = vec3(0.84, 0.88, 0.96) - sn2 * 0.10;
    // 雪面星星点点的反光
    float g = fract(sin(dot(floor(world / 6.0), vec2(127.1, 311.7))) * 43758.5453);
    float glint = step(0.985, g) * (0.5 + 0.5 * sin(uTime * 3.0 + g * 40.0));
    snowCol += vec3(0.3) * glint;
    // 脚印边缘的压实雪微微发暗
    snowCol *= 1.0 - tr * 0.2;
    sceneCol = mix(sceneCol, snowCol, cover);
  }

  // 造波纹理 + step 裁切积水形状（世界空间，轻微横向拉长）
  vec2 nuv = vec2(world.x, world.y * 1.6) / uScreen.x * 1.3;
  float n = texture2D(uNoise, nuv).r;
  float pud   = smoothstep(uCut, uCut + 0.015, n);
  float inner = smoothstep(uCut + 0.05, uCut + 0.09, n);
  float edge  = pud * (1.0 - inner);

  // 水塘：世界坐标采样抠色 mask
  vec2 puv = (world - uPondRect.xy) / uPondRect.zw;
  float inRect = step(0.0, puv.x) * step(puv.x, 1.0) * step(0.0, puv.y) * step(puv.y, 1.0);
  float pondM = texture2D(uPond, clamp(puv, 0.0, 1.0)).a * inRect;

  // —— 河流：水位 step 裁切（教程核心：只调 step 阈值就能动态涨落）——
  float th = 1.0 - uLevel;
  // 造波让水位线上下浮动（教程：根据造波让水面高光线上下运动）
  float wob = (texture2D(uNoise, vec2(world.x * 0.004 + uTime * 0.06, world.y * 0.004 - uTime * 0.02)).b - 0.5) * 0.05;
  float thw = th + wob;
  float riverW = smoothstep(thw, thw + 0.03, rdepth);
  float rd01 = clamp((rdepth - thw) / max(1.0 - thw, 0.001), 0.0, 1.0);
  // 水浅透明度高、水深透明度低（教程第"透明"步）
  float riverA = riverW * (0.52 + 0.44 * smoothstep(0.0, 0.45, rd01));
  // 水位线高光带（贴着当前水面边缘，随造波起伏）
  float shoreline = smoothstep(thw - 0.012, thw + 0.004, rdepth) * (1.0 - smoothstep(thw + 0.02, thw + 0.05, rdepth));

  float waterM = max(max(pud, pondM * 0.95), riverA);
  if (waterM < 0.004) { gl_FragColor = vec4(sceneCol, base.a); return; }

  // 波纹 RT：红=波强，绿蓝=扰动
  vec4 rip = texture2D(uRipple, suv);
  vec2 disp = (rip.gb - vec2(0.5)) * 2.0;
  float wave = clamp(rip.r, 0.0, 1.0);

  // 水面常驻微扰（噪声随时间滚动）
  vec2 nd = texture2D(uNoise, nuv * 3.0 + vec2(uTime * 0.02, uTime * 0.012)).gb - vec2(0.5);

  // 倒影：扰动 UV 采样
  vec2 ruv = suv + disp * 0.016 + nd * 0.008;
  vec3 refl = texture2D(uReflect, clamp(ruv, vec2(0.002), vec2(0.998))).rgb;

  // 折射：扭曲原始图像 UV；水越深扭曲越强（教程"根据水深控制扭曲程度"）
  vec2 rpx = px + disp * 20.0 + nd * (7.0 + 16.0 * rd01);
  vec2 fuv = (rpx - outputFrame.xy) * inputSize.zw;
  vec3 refr = texture2D(uSampler, clamp(fuv, inputClamp.xy, inputClamp.zw)).rgb;
  // 折射到的河床也要带河床色
  refr = mix(refr, refr * vec3(0.66, 0.58, 0.48), bed * 0.9);

  // 水体 = 折射地面加深 + 冷色调（夜晚折射更暗）
  vec3 water = refr * mix(0.50, 0.34, uNight) + vec3(0.010, 0.030, 0.046);

  // 反射透明度随造波值衰减；夜晚反射权重大幅提高（水中看夜空）
  float reflA = clamp(mix(0.45, 0.78, uNight) - wave * 0.40, 0.06, 0.85);
  water = mix(water, refl, reflA);

  // 焦散：两层反向流动的噪声取差，水下区域叠加，水量越多越明显
  vec2 cuv = world * 0.016;
  float ca = texture2D(uNoise, cuv + vec2(uTime * 0.031, uTime * 0.022)).g;
  float cb = texture2D(uNoise, cuv * 1.27 - vec2(uTime * 0.024, uTime * 0.035)).b;
  float caust = pow(clamp(1.0 - abs(ca - cb) * 2.4, 0.0, 1.0), 3.0);
  water += vec3(0.30, 0.45, 0.50) * caust * (0.10 + 0.28 * rd01 + 0.12 * pondM);

  // 波纹白沫：红通道直接可见
  water += vec3(0.72, 0.84, 0.92) * wave * 0.40;

  // 积水边缘：内切一层 + 移动扫波高光（水塘/河流自带岸线，只作用于噪声积水）
  float sweep = texture2D(uNoise, nuv * 2.2 + vec2(uTime * 0.04, -uTime * 0.02)).b;
  water += vec3(0.55, 0.70, 0.78) * edge * (0.20 + 0.60 * sweep * sweep);

  // 河流水位线高光
  water += vec3(0.90, 1.0, 1.0) * shoreline * 0.55;

  gl_FragColor = vec4(mix(sceneCol, water, min(waterM, 1.0) * 0.95), base.a);
}
`

// ─────────────────────────────────────────────
// 夜空着色器（渲进倒影 RT，被水面采样）
// 星星：世界切格 + 每格哈希 + step 筛选 + 格内坐标缩小 + 漂移/闪烁
// 极光：动态噪波定"天边线"，向下 remap 渐变分层上色（倒影 → 天边在下方）
// 云层：造波噪声，叠在星空与极光之间
// ─────────────────────────────────────────────
const NIGHT_SKY_FRAG = `
precision highp float;

varying vec2 vTextureCoord;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform sampler2D uNoise;
uniform float uTime;
uniform vec2  uScreen;
uniform float uCloudAmt;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main(void) {
  vec2 px = vTextureCoord * inputSize.xy + outputFrame.xy;
  vec2 uv = px / uScreen;

  // 夜空底色（上深下浅：倒影里下方是天边）
  vec3 col = mix(vec3(0.030, 0.045, 0.085), vec3(0.075, 0.105, 0.160), uv.y);

  // —— 星星层 ——
  vec2 g = px / 26.0 + vec2(uTime * 0.5, uTime * 0.08); // 整体向一个方向漂移
  vec2 id = floor(g);                                    // 世界切格
  vec2 f = fract(g) - 0.5;                               // 格内坐标
  float h = hash21(id);                                  // 每格哈希
  float has = step(0.80, h);                             // step 筛选哪些格子有星
  vec2 sp = (vec2(hash21(id + 13.7), hash21(id + 41.3)) - 0.5) * 0.6;
  float d = length(f - sp);
  float size = 0.05 + 0.10 * hash21(id + 3.1);           // 缩小到舒服的大小
  float tw = 0.55 + 0.45 * sin(uTime * (1.5 + 4.0 * hash21(id + 7.7)) + h * 40.0); // 闪烁
  col += vec3(0.85, 0.92, 1.0) * has * smoothstep(size, 0.0, d) * tw;

  // —— 云层（星空之上、极光之下）——
  float c1 = texture2D(uNoise, vec2(uv.x * 1.3 + uTime * 0.008, uv.y * 2.6)).r;
  float c2 = texture2D(uNoise, vec2(uv.x * 3.0 - uTime * 0.005, uv.y * 4.8 + 0.4)).g;
  float cloud = smoothstep(0.55, 0.80, c1 * 0.62 + c2 * 0.38) * uCloudAmt;
  col = mix(col, vec3(0.11, 0.14, 0.20), cloud);

  // —— 极光 ——
  float w1 = texture2D(uNoise, vec2(uv.x * 0.9 + uTime * 0.012, uTime * 0.006)).g;
  float w2 = texture2D(uNoise, vec2(uv.x * 2.4 - uTime * 0.017, 0.3 + uTime * 0.004)).b;
  float y0 = 0.55 + (w1 - 0.5) * 0.24;                  // 波动的天边线
  float below = uv.y - y0;
  float aur = smoothstep(0.0, 0.05, below) * (1.0 - smoothstep(0.04, 0.40, below * (0.8 + w2 * 0.8)));
  vec3 acol = mix(vec3(0.05, 0.85, 0.50), vec3(0.15, 0.35, 0.90), clamp(below * 2.8, 0.0, 1.0));
  acol = mix(acol, vec3(0.60, 0.25, 0.85), w2 * 0.45);  // 分层叠色
  col += acol * aur * (0.45 + 0.55 * w2);

  gl_FragColor = vec4(col, 1.0);
}
`

// ─────────────────────────────────────────────
// 全屏后处理：好玩效果合集（数字键开关，可叠加）
// 和水面滤镜同一个道理：不动任何瓦片和贴图，
// 只在最终采样阶段扭曲 UV（形变类）/ 重映射颜色（滤色类）
// ─────────────────────────────────────────────
const POST_FRAG = `
precision highp float;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform vec4 inputClamp;

uniform float uTime;
uniform vec2  uScreen;
uniform float uGB;     // 复古掌机：马赛克像素化 + 4 级 GameBoy 绿
uniform float uSwirl;  // 漩涡：绕屏幕中心扭转，越近转得越狠
uniform float uJelly;  // 果冻：正弦波晃动整个画面
uniform float uPsy;    // 迷幻：色相沿对角线随时间旋转
uniform vec3  uShock;  // 落地冲击波：xy=波心(屏幕px) z=当前半径
uniform float uShockAmp;

vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float cs = cos(a);
  return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}

void main(void) {
  vec2 px = vTextureCoord * inputSize.xy + outputFrame.xy;

  // 果冻：两个方向的正弦波错相叠加，画面像果冻一样duang
  if (uJelly > 0.001) {
    px.x += sin(px.y * 0.020 + uTime * 3.3) * 13.0 * uJelly;
    px.y += sin(px.x * 0.016 + uTime * 2.7) * 9.0 * uJelly;
  }

  // 漩涡：转角随离中心距离指数衰减，整块地皮被搅进去还缓缓打转
  if (uSwirl > 0.001) {
    vec2 c = uScreen * 0.5;
    vec2 d = px - c;
    float r = length(d);
    float ang = uSwirl * (2.4 * exp(-r / 380.0) + 0.15 * sin(uTime * 0.8));
    float s = sin(ang);
    float co = cos(ang);
    px = c + vec2(d.x * co - d.y * s, d.x * s + d.y * co);
  }

  // 落地冲击波：高斯环形波前，把波前处的像素向外推
  float band = 0.0;
  if (uShockAmp > 0.001) {
    vec2 d = px - uShock.xy;
    float r = max(length(d), 0.001);
    float w = (r - uShock.z) / 46.0;
    band = exp(-w * w) * uShockAmp;
    px += (d / r) * band * 34.0;
  }

  // 复古掌机（形变部分）：采样点吸附到大颗粒网格
  if (uGB > 0.001) {
    float cell = 2.0 + 4.0 * uGB;
    px = (floor(px / cell) + 0.5) * cell;
  }

  vec2 uv = (px - outputFrame.xy) * inputSize.zw;
  vec3 col = texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw)).rgb;

  // 复古掌机（滤色部分）：亮度量化成 4 级，映射到 GameBoy 调色板
  if (uGB > 0.001) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    // 先提亮压 gamma，夜晚场景也能拉开 4 级层次
    lum = clamp(pow(lum * 2.4, 0.55), 0.0, 1.0);
    lum = floor(lum * 3.999) / 3.0;
    vec3 gb = mix(vec3(0.055, 0.145, 0.055), vec3(0.68, 0.78, 0.16), lum);
    col = mix(col, gb, uGB);
  }

  // 迷幻：色相旋转 + 轻微呼吸亮度
  if (uPsy > 0.001) {
    float a = uTime * 1.6 + (px.x + px.y) * 0.0045;
    col = mix(col, hueShift(col, a), uPsy * 0.9);
    col *= 1.0 + 0.10 * uPsy * sin(uTime * 5.0 + px.y * 0.01);
  }

  // 冲击波波前泛白
  col += vec3(0.9, 0.95, 1.0) * band * 0.35;

  gl_FragColor = vec4(col, 1.0);
}
`

async function main() {
  const host = document.getElementById('host')
  PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST

  const app = new PIXI.Application({
    width: W,
    height: H,
    backgroundColor: 0x1c3a1e,
    antialias: false,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  })
  host.appendChild(app.view)
  app.view.style.width = '100%'
  app.view.style.height = '100%'
  app.view.style.imageRendering = 'pixelated'

  const base = PIXI.BaseTexture.from('/res/tiles/lpc_forest/forest_tiles.png', {
    scaleMode: PIXI.SCALE_MODES.NEAREST,
  })
  await new Promise((resolve) => {
    if (base.valid) return resolve()
    base.once('loaded', resolve)
    base.once('error', resolve)
  })

  const tex = {}
  for (const k of Object.keys(RECTS)) tex[k] = new PIXI.Texture(base, RECTS[k])

  const world = new PIXI.Container()
  app.stage.addChild(world)
  // 全屏大招演出层：屏幕空间，盖在世界之上，不吃相机和后期滤镜
  const ultLayer = new PIXI.Container()
  app.stage.addChild(ultLayer)

  const ground = new PIXI.Container()
  const wetOverlay = new PIXI.Graphics()
  const objLayer = new PIXI.Container()
  const rainLayer = new PIXI.Container()
  const nightOverlay = new PIXI.Graphics() // 夜晚色调（压暗整个场景）
  const boltLayer = new PIXI.Container() // 闪电电弧
  const flash = new PIXI.Graphics() // 全屏闪光
  world.addChild(ground, wetOverlay, objLayer, rainLayer, nightOverlay, boltLayer, flash)

  const NIGHT_ALPHA = 0.68
  nightOverlay.beginFill(0x04081a, 1)
  nightOverlay.drawRect(0, 0, W, H)
  nightOverlay.endFill()
  nightOverlay.alpha = 0
  let nightOn = false // 默认白天，按 N 切夜晚

  flash.beginFill(0xe8f0ff, 1)
  flash.drawRect(0, 0, W, H)
  flash.endFill()
  flash.alpha = 0

  wetOverlay.beginFill(0x0a1420, 1)
  wetOverlay.drawRect(0, 0, W, H)
  wetOverlay.endFill()
  wetOverlay.alpha = 0

  // —— 伪 3D 摄像机（俯视版）——
  // 相机中心 (cx,cy) 跟随人物；地面整体绕相机旋转，
  // 树/角色/火焰是"立牌"(billboard)，贴图不转，只按变换后的落脚点重排位置
  const FX = W / 2
  const FY = H / 2
  const cam = { rot: 0, zoom: 1, cos: 1, sin: 0, cx: FX, cy: FY }
  /** 世界 → 屏幕（相机偏移 + 旋转 + 缩放） */
  function w2s(x, y) {
    const dx = x - cam.cx
    const dy = y - cam.cy
    return {
      x: FX + (dx * cam.cos - dy * cam.sin) * cam.zoom,
      y: FY + (dx * cam.sin + dy * cam.cos) * cam.zoom,
    }
  }
  /** 屏幕 → 世界 */
  function s2w(x, y) {
    const dx = (x - FX) / cam.zoom
    const dy = (y - FY) / cam.zoom
    return {
      x: cam.cx + dx * cam.cos + dy * cam.sin,
      y: cam.cy - dx * cam.sin + dy * cam.cos,
    }
  }
  // 地面容器变换（pivot=相机世界坐标，由 ticker 每帧同步）
  ground.pivot.set(cam.cx, cam.cy)
  ground.position.set(FX, FY)

  const flowerTex = [tex.grassF1, tex.grassF2, tex.grassF3]

  // —— 水塘 ——
  const pond = new PIXI.Sprite(tex.pond)
  pond.width = tex.pond.width * SCALE
  pond.height = tex.pond.height * SCALE
  pond.x = W * 0.56 - 96
  pond.y = H * 0.28 + 6
  ground.addChild(pond)

  // LPC 水塘贴图是不透明的（带草地背景），按颜色抠出"蓝色占优"的水面像素做 mask，
  // 着色器里直接用世界坐标采样这张 mask —— 摄像机怎么转水面都黏在地上
  const pondMask = makePondWaterMask(base, RECTS.pond)
  /** 世界坐标 → 水塘水面像素判定 */
  function pondWaterAt(x, y) {
    const u = (x - pond.x) / pond.width
    const v = (y - pond.y) / pond.height
    if (u < 0 || u > 1 || v < 0 || v > 1) return false
    return pondMask.at(u, v)
  }

  // —— 立牌道具配置：r=碰撞半径(0 可穿行)；sway=随风摇摆 ——
  const PROP_CONF = {
    treeRound: { r: 19, sway: true },
    pine: { r: 15, sway: true },
    pineSmall: { r: 12, sway: true },
    stump: { r: 16 },
    boulder: { r: 22 },
    logMoss: { r: 28 },
    mushroom: { r: 0 },
    redFlower: { r: 0 },
    hut: { r: 56 },
    cauldron: { r: 15 },
    logPile: { r: 28 },
  }

  // 倒影场景：程序化夜空打底（稍后创建）+ 真贴图翻转（离屏渲进 reflectRT）
  const reflectLayer = new PIXI.Container()
  const reflectRT = PIXI.RenderTexture.create({
    width: W,
    height: H,
    scaleMode: PIXI.SCALE_MODES.LINEAR,
  })

  // 立牌道具全局表（分块系统动态增删；碰撞/摇摆/重投影都走这张表）
  const allProps = []

  // —— 角色：真实骨骼动画(乐琳) ——
  const hero = await createHeroSpine(W * 0.5, H * 0.5)
  objLayer.addChild(hero.view)
  // 倒影：独立第二个 Spine 实例，动画同步，scale.y 翻负；
  // 外面包一层容器承接摄像机缩放，避免动 spine 自身 scale
  const heroReflWrap = new PIXI.Container()
  if (hero.reflSpine) {
    heroReflWrap.addChild(hero.reflSpine)
    reflectLayer.addChild(heroReflWrap)
  }

  // ── 主角切换 + 技能预览面板（底部 DOM） ─────────────────
  // 全库扫过：这些角色 idle/run/death/skill 全套齐；★ = 3 个以上技能
  const HERO_ROSTER = [
    ['dongwushuang', '乐琳（当前）'],
    ['yangdingtian', 'yangdingtian ★5s大招'],
    ['zuoci', 'zuoci ★'],
    ['zuoci_zuoqi', 'zuoci·坐骑 ★'],
    ['qingweidaozhang', 'qingweidaozhang ★'],
    ['qingweidaozhang_heihua', 'qingweidaozhang·黑化 ★'],
    ['miaofeng', 'miaofeng ★'],
    ['beimihu', 'beimihu ★'],
    ['borewang', 'borewang ★'],
    ['dongfangjiaozhu', 'dongfangjiaozhu ★'],
    ['duanzhennan', 'duanzhennan ★'],
    ['lifeiyu', 'lifeiyu ★'],
    ['linghulaozu', 'linghulaozu ★'],
    ['luxueyao', 'luxueyao ★'],
    ['tongbo', 'tongbo ★'],
    ['wangjuechu', 'wangjuechu ★'],
    ['xiaoyaojianxia', 'xiaoyaojianxia ★'],
    ['yaomingyue', 'yaomingyue ★'],
    ['cangsong', 'cangsong'],
    ['damo', 'damo'],
    ['duanyu', 'duanyu'],
    ['fengqingyang', 'fengqingyang'],
    ['gongbenwuzang', 'gongbenwuzang'],
    ['hechong', 'hechong'],
    ['huangyaoshi', 'huangyaoshi'],
    ['huawuxin', 'huawuxin'],
    ['hubadao', 'hubadao'],
    ['huixin', 'huixin'],
    ['jinmaoshiwang', 'jinmaoshiwang'],
    ['jiuzhixing', 'jiuzhixing'],
    ['kangfuren', 'kangfuren'],
    ['linchaoying', 'linchaoying'],
    ['linyueru', 'linyueru'],
    ['malingyao', 'malingyao'],
    ['miaoxinlan', 'miaoxinlan'],
    ['miejueshitai', 'miejueshitai'],
    ['qiaofeng', 'qiaofeng'],
    ['renyinger', 'renyinger'],
    ['saodiseng', 'saodiseng'],
    ['shenguidamen', 'shenguidamen'],
    ['songqingshu', 'songqingshu'],
    ['tianlingling', 'tianlingling'],
    ['tongzhan', 'tongzhan'],
    ['wangchengfeng', 'wangchengfeng'],
    ['wangyanran', 'wangyanran'],
    ['xianglizhi', 'xianglizhi'],
    ['xiangwentian', 'xiangwentian'],
    ['xiaomianfo', 'xiaomianfo'],
    ['xingxiulaozu', 'xingxiulaozu'],
    ['xiongziyi', 'xiongziyi'],
    ['xiuer', 'xiuer'],
    ['yaolianxing', 'yaolianxing'],
    ['yinjianxue', 'yinjianxue'],
    ['yuebuqun', 'yuebuqun'],
    ['zhaixingzi', 'zhaixingzi'],
    ['zhangdaoling_zuoqi', 'zhangdaoling·坐骑'],
    ['zhangsanfeng', 'zhangsanfeng'],
    ['zhouzhiruo', 'zhouzhiruo'],
    ['zhuangmengdie', 'zhuangmengdie'],
    ['zhuangmengdie_zuoqi', 'zhuangmengdie·坐骑'],
  ]
  // ── 技能特效（jineng/seffect）：角色动作只有身体，特效要配套播 ──
  const seffectCache = new Map()
  const fxSpines = [] // { spine, holder?, age, life }，主 ticker 里推动画
  function loadFxJson(url, cacheKey) {
    if (seffectCache.has(cacheKey)) return Promise.resolve(seffectCache.get(cacheKey))
    return new Promise((resolve) => {
      const key = `${cacheKey}_${Date.now()}`
      const loader = new PIXI.Loader()
      loader.add(key, url)
      loader.onError.add(() => resolve(null))
      loader.load((_, res) => {
        const data = res[key]?.spineData || null
        if (data) seffectCache.set(cacheKey, data)
        resolve(data)
      })
    })
  }
  function loadSeffect(id) {
    return loadFxJson(`${RES.jineng}/seffect/${id}/${id}.json`, `seffect_${id}`)
  }
  /** 在主角面前放一个技能特效（跟随朝向翻转） */
  async function playSeffectAtHero(id) {
    const Spine2 = getSpineClass()
    const data = await loadSeffect(id)
    if (!data || !Spine2) return false
    const fx = new Spine2(data)
    fx.autoUpdate = false
    const lp = w2s(hero.x, hero.y)
    const fwd = hero.face === 'left' ? -1 : 1
    fx.x = lp.x + fwd * 80 * cam.zoom
    fx.y = lp.y - 40 * cam.zoom
    fx.scale.set(fwd * 0.5 * cam.zoom, 0.5 * cam.zoom)
    rainLayer.addChild(fx)
    const anim =
      pickAnim(fx, ['animation_0', 'animation', 'idle', 'skill', 'effect']) ||
      (fx.spineData.animations[0] && fx.spineData.animations[0].name)
    let life = 1.2
    if (anim && fx.state) {
      fx.state.setAnimation(0, anim, false)
      const a = fx.spineData.animations.find((x) => x.name === anim)
      if (a) life = a.duration + 0.25
    }
    fxSpines.push({ spine: fx, age: 0, life })
    return true
  }

  /** 全屏大招演出（sanim）：黑幕压场 + 居中自适应缩放，播完自动清 */
  async function playSanim(id) {
    const Spine2 = getSpineClass()
    const data = await loadFxJson(`${RES.jineng}/sanim/${id}/${id}.json`, `sanim_${id}`)
    if (!data || !Spine2) return false
    const holder = new PIXI.Container()
    const dim = new PIXI.Graphics()
    dim.beginFill(0x000000, 0.55)
    dim.drawRect(0, 0, W, H)
    dim.endFill()
    holder.addChild(dim)
    const fx = new Spine2(data)
    fx.autoUpdate = false
    holder.addChild(fx)
    const anim =
      pickAnim(fx, ['animation_0', 'animation', 'idle', 'skill', 'effect']) ||
      (fx.spineData.animations[0] && fx.spineData.animations[0].name)
    let life = 2
    if (anim && fx.state) {
      fx.state.setAnimation(0, anim, false)
      const a = fx.spineData.animations.find((x) => x.name === anim)
      if (a) life = a.duration + 0.3
    }
    // 按设置姿态的包围盒自适应：居中、最多占屏 90%
    fx.update(0)
    const bd = fx.getLocalBounds()
    let sc = 1
    if (bd.width > 4 && bd.height > 4) {
      sc = Math.min((W * 0.9) / bd.width, (H * 0.9) / bd.height)
      sc = Math.max(0.4, Math.min(2.2, sc))
    }
    fx.scale.set(sc)
    fx.x = W / 2 - (bd.x + bd.width / 2) * sc
    fx.y = H / 2 - (bd.y + bd.height / 2) * sc
    ultLayer.addChild(holder)
    fxSpines.push({ spine: fx, holder, age: 0, life })
    return true
  }

  setupHeroPanel()
  function setupHeroPanel() {
    const host = document.getElementById('host') || document.body
    const panel = document.createElement('div')
    panel.style.cssText =
      'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:5;' +
      'display:flex;flex-direction:column;gap:6px;align-items:center;max-width:94%;' +
      'background:rgba(10,14,20,.82);border:1px solid rgba(120,140,160,.4);border-radius:8px;' +
      'padding:8px 10px;font-size:12px;color:#8a9aab;'
    const row1 = document.createElement('div')
    row1.style.cssText = 'display:flex;gap:8px;align-items:center;'
    const label = document.createElement('span')
    label.textContent = '主角'
    const sel = document.createElement('select')
    sel.style.cssText =
      'background:#141a22;color:#e8eef4;border:1px solid rgba(120,140,160,.4);' +
      'border-radius:5px;padding:2px 6px;font-size:12px;max-width:280px;'
    for (const [folder, name] of HERO_ROSTER) {
      const opt = document.createElement('option')
      opt.value = folder
      opt.textContent = name
      sel.appendChild(opt)
    }
    const status = document.createElement('span')
    row1.appendChild(label)
    row1.appendChild(sel)
    row1.appendChild(status)
    // 第二行：技能特效选择（点技能按钮时和动作一起放）
    const row2 = document.createElement('div')
    row2.style.cssText = 'display:flex;gap:6px;align-items:center;'
    const fxLabel = document.createElement('span')
    fxLabel.textContent = '特效'
    const fxSel = document.createElement('select')
    fxSel.style.cssText = sel.style.cssText
    const noneOpt = document.createElement('option')
    noneOpt.value = ''
    noneOpt.textContent = '无特效'
    fxSel.appendChild(noneOpt)
    SEFFECT_INDEX.forEach((id, i) => {
      const opt = document.createElement('option')
      opt.value = id
      opt.textContent = `#${i} ${id.replace('seffect_', '')}`
      fxSel.appendChild(opt)
    })
    const mkBtn = (txt) => {
      const b = document.createElement('button')
      b.textContent = txt
      b.style.cssText =
        'background:#1b2430;color:#e8eef4;border:1px solid rgba(120,140,160,.4);' +
        'border-radius:5px;padding:2px 8px;font-size:12px;cursor:pointer;'
      return b
    }
    const fxPrev = mkBtn('◀')
    const fxNext = mkBtn('▶')
    const fxPlay = mkBtn('单放特效')
    const stepFx = (d) => {
      const n = fxSel.options.length
      fxSel.selectedIndex = (fxSel.selectedIndex + d + n) % n
      if (fxSel.value) playSeffectAtHero(fxSel.value)
    }
    fxPrev.onclick = () => stepFx(-1)
    fxNext.onclick = () => stepFx(1)
    fxPlay.onclick = () => fxSel.value && playSeffectAtHero(fxSel.value)
    fxSel.onchange = () => {
      if (fxSel.value) playSeffectAtHero(fxSel.value)
      fxSel.blur()
    }
    row2.appendChild(fxLabel)
    row2.appendChild(fxSel)
    row2.appendChild(fxPrev)
    row2.appendChild(fxNext)
    row2.appendChild(fxPlay)

    // 第三行：全屏大招演出（sanim）
    const row3 = document.createElement('div')
    row3.style.cssText = 'display:flex;gap:6px;align-items:center;'
    const ultLabel = document.createElement('span')
    ultLabel.textContent = '全屏大招'
    const ultSel = document.createElement('select')
    ultSel.style.cssText = sel.style.cssText
    SANIM_INDEX.forEach((id, i) => {
      const opt = document.createElement('option')
      opt.value = id
      opt.textContent = `#${i} ${id.replace('sanim_', '')}`
      ultSel.appendChild(opt)
    })
    const ultPrev = mkBtn('◀')
    const ultNext = mkBtn('▶')
    const ultPlay = mkBtn('放大招')
    const stepUlt = (d) => {
      const n = ultSel.options.length
      ultSel.selectedIndex = (ultSel.selectedIndex + d + n) % n
      playSanim(ultSel.value)
    }
    ultPrev.onclick = () => stepUlt(-1)
    ultNext.onclick = () => stepUlt(1)
    ultPlay.onclick = () => playSanim(ultSel.value)
    ultSel.onchange = () => {
      playSanim(ultSel.value)
      ultSel.blur()
    }
    row3.appendChild(ultLabel)
    row3.appendChild(ultSel)
    row3.appendChild(ultPrev)
    row3.appendChild(ultNext)
    row3.appendChild(ultPlay)

    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;'
    panel.appendChild(row1)
    panel.appendChild(row2)
    panel.appendChild(row3)
    panel.appendChild(btnRow)
    host.appendChild(panel)

    function rebuildButtons() {
      btnRow.innerHTML = ''
      for (const a of hero.listAnims()) {
        const btn = document.createElement('button')
        btn.textContent = `${a.name} ${a.duration.toFixed(1)}s`
        btn.style.cssText =
          'background:#1b2430;color:#9ed48a;border:1px solid rgba(120,140,160,.4);' +
          'border-radius:5px;padding:3px 8px;font-size:12px;cursor:pointer;'
        btn.onclick = () => {
          hero.preview(a.name)
          // 选了特效就配套放：动作+特效一起看整体效果
          if (fxSel.value) playSeffectAtHero(fxSel.value)
        }
        btnRow.appendChild(btn)
      }
    }
    rebuildButtons()

    sel.onchange = async () => {
      sel.disabled = true
      status.textContent = '加载中…'
      const ok = await hero.setCharacter(sel.value)
      if (ok && hero.reflSpine && !hero.reflSpine.parent) heroReflWrap.addChild(hero.reflSpine)
      status.textContent = ok ? '' : '加载失败'
      rebuildButtons()
      sel.disabled = false
      sel.blur() // 焦点还给画布，WASD 不被下拉框吃掉
    }
  }

  // —— 波纹系统：全屏 RT，红=波强，绿蓝=扰动向量 ——
  const rippleRT = PIXI.RenderTexture.create({
    width: W,
    height: H,
    scaleMode: PIXI.SCALE_MODES.LINEAR,
  })
  const rippleScene = new PIXI.Container()
  const rippleClear = new PIXI.Graphics()
  // 中性底：r=0 无波，gb=0.5 无扰动
  rippleClear.beginFill(0x008080)
  rippleClear.drawRect(0, 0, W, H)
  rippleClear.endFill()
  const rippleTex = makeRippleTexture(128)
  const ripples = []

  function spawnRipple(x, y, power = 0.5) {
    const spr = new PIXI.Sprite(rippleTex)
    spr.anchor.set(0.5)
    spr.x = x
    spr.y = y
    spr.scale.set(0.1, 0.07)
    rippleScene.addChild(spr)
    ripples.push({
      spr,
      r0: 5,
      rGrow: 28 + power * 55,
      life: 0.6 + power * 0.5,
      age: 0,
      power: 0.5 + power * 0.5,
    })
  }

  // —— 踩踏 RT：脚印以世界坐标存储，每帧投影渲染（跟随相机/旋转/缩放）——
  const trampleRT = PIXI.RenderTexture.create({
    width: W,
    height: H,
    scaleMode: PIXI.SCALE_MODES.LINEAR,
  })
  const trampleScene = new PIXI.Container()
  const trampleClear = new PIXI.Graphics()
  trampleClear.beginFill(0x000000)
  trampleClear.drawRect(0, 0, W, H)
  trampleClear.endFill()
  const footprints = []

  // —— 造波噪声 + 水面 Filter ——
  const noise = makeWaveNoise(256)
  let wetness = 0 // 默认晴天开场，开雨后地面渐湿

  // —— 夜空（星星/云/极光），垫在倒影场景最底层 ——
  const nightSkyFilter = new PIXI.Filter(undefined, NIGHT_SKY_FRAG, {
    uNoise: noise.texture,
    uTime: 0,
    uScreen: [W, H],
    uCloudAmt: 0.85,
  })
  let cloudAmt = 0.85
  {
    const sky = new PIXI.Sprite(PIXI.Texture.WHITE)
    sky.width = W
    sky.height = H
    sky.filterArea = new PIXI.Rectangle(0, 0, W, H)
    sky.filters = [nightSkyFilter]
    reflectLayer.addChildAt(sky, 0)
  }
  const cutFor = (w) => 0.8 - w * 0.18

  // —— 河流水位（教程：动态调 step 阈值 = 动态水位）——
  let levelBase = 0.55
  let tideAmp = 0.2 // 潮汐自动涨落幅度
  let level = levelBase
  /** 与 shader riverDepth 同款：程序化深度场（每 2400px 重复一条河） */
  function riverDepthAt(x, y) {
    const wx = ((x % 2400) + 2400) % 2400
    const bankW = Math.sin(y * 0.013 + 5) * 18 + Math.sin(y * 0.007 + 1.3) * 22
    const rcx = 190 + 70 * Math.sin(y * 0.006 + 2) + bankW
    return clamp(1 - Math.abs(wx - rcx) / 115, 0, 1)
  }

  // ─────────────────────────────────────────
  // 无限地图：按 768px 分块随机生成（走到哪生成到哪，走远即卸载）
  // ─────────────────────────────────────────
  const CHUNK = TILE * 8
  const chunks = new Map()
  const campfires = [] // 营地篝火（发光点）
  const decalTex = [
    tex.plantTuft,
    tex.plantTuft,
    tex.plantFern,
    tex.plantLeaf,
    tex.plantRed,
    tex.tuftGreen,
    tex.stonesSmall,
  ]
  const PROP_TABLE = [
    'treeRound', 'treeRound', 'treeRound',
    'pine', 'pine', 'pine',
    'pineSmall', 'stump', 'boulder', 'logMoss',
    'mushroom', 'redFlower', 'redFlower',
  ]

  function inPond(x, y, pad) {
    return (
      x > pond.x - pad && x < pond.x + pond.width + pad && y > pond.y - pad && y < pond.y + pond.height + pad
    )
  }

  function addProp(chunk, t, x, y) {
    const conf = PROP_CONF[t]
    const spr = new PIXI.Sprite(tex[t])
    spr.anchor.set(0.5, 1)
    spr.scale.set(SCALE)
    spr.x = x
    spr.y = y
    objLayer.addChild(spr)
    // 倒影：同一张贴图 scale.y 翻负，锚点仍在脚底
    const refl = new PIXI.Sprite(tex[t])
    refl.anchor.set(0.5, 1)
    refl.scale.set(SCALE, -SCALE)
    refl.alpha = 0.75
    reflectLayer.addChild(refl)
    const p = {
      view: spr,
      refl,
      x,
      y,
      trunkR: conf.r,
      phase: Math.random() * Math.PI * 2,
      speed: 0.8 + Math.random() * 0.5,
      amp: conf.sway ? 0.03 + Math.random() * 0.02 : 0,
    }
    allProps.push(p)
    chunk.props.push(p)
    return p
  }

  function genChunk(ci, cj) {
    const key = ci + ',' + cj
    if (chunks.has(key)) return
    const chunk = { groundC: new PIXI.Container(), props: [], fires: [] }
    const rng = mulberry32(((Math.imul(ci, 668265263) ^ Math.imul(cj, 374761393)) >>> 0) || 7)
    const x0 = ci * CHUNK
    const y0 = cj * CHUNK

    // 草地 + 花草变体（哈希用全局瓦片坐标，跨块无缝一致）
    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 8; tx++) {
        const gx = ci * 8 + tx
        const gy = cj * 8 + ty
        const h = (Math.imul(gx, 374761393) ^ Math.imul(gy, 668265263)) >>> 0
        const t = h % 100 < 18 ? flowerTex[h % 3] : tex.grass
        const spr = new PIXI.Sprite(t)
        spr.x = gx * TILE
        spr.y = gy * TILE
        spr.width = TILE
        spr.height = TILE
        chunk.groundC.addChild(spr)
      }
    }
    // 地表植被
    const nDecal = 2 + ((rng() * 4) | 0)
    for (let i = 0; i < nDecal; i++) {
      const x = x0 + rng() * CHUNK
      const y = y0 + rng() * CHUNK
      if (riverDepthAt(x, y) > 0.02 || inPond(x, y, 40)) continue
      const spr = new PIXI.Sprite(decalTex[(rng() * decalTex.length) | 0])
      spr.anchor.set(0.5)
      spr.scale.set(SCALE)
      spr.x = x
      spr.y = y
      chunk.groundC.addChild(spr)
    }
    ground.addChild(chunk.groundC)

    const clear = (x, y, pad) =>
      riverDepthAt(x, y) < 0.02 && !inPond(x, y, pad) && Math.hypot(x - hero.x, y - hero.y) > 140

    // 稀有营地：茅屋 + 柴堆 + 篝火锅（夜里发光）
    if (rng() < 0.06) {
      const hx = x0 + CHUNK * (0.3 + rng() * 0.4)
      const hy = y0 + CHUNK * (0.3 + rng() * 0.3)
      if (clear(hx, hy, 80) && clear(hx + 60, hy + 200, 40)) {
        addProp(chunk, 'hut', hx, hy)
        addProp(chunk, 'logPile', hx + 40, hy + 120)
        addProp(chunk, 'cauldron', hx + 20, hy + 230)
        const glow = new PIXI.Sprite(glowTex)
        glow.anchor.set(0.5)
        glow.blendMode = PIXI.BLEND_MODES.ADD
        objLayer.addChild(glow)
        const glowR = new PIXI.Sprite(glowTex)
        glowR.anchor.set(0.5)
        glowR.blendMode = PIXI.BLEND_MODES.ADD
        reflectLayer.addChild(glowR)
        const fire = { x: hx + 20, y: hy + 230, glow, glowR, ph: rng() * 10 }
        campfires.push(fire)
        chunk.fires.push(fire)
      }
    }
    // 普通立牌：树为主，杂物点缀
    const nProp = 2 + ((rng() * 3) | 0)
    for (let i = 0; i < nProp; i++) {
      const t = PROP_TABLE[(rng() * PROP_TABLE.length) | 0]
      const x = x0 + 60 + rng() * (CHUNK - 120)
      const y = y0 + 60 + rng() * (CHUNK - 120)
      if (!clear(x, y, 50)) continue
      addProp(chunk, t, x, y)
    }
    chunks.set(key, chunk)
  }

  function dropChunk(key) {
    const c = chunks.get(key)
    if (!c) return
    ground.removeChild(c.groundC)
    c.groundC.destroy({ children: true })
    for (const p of c.props) {
      objLayer.removeChild(p.view)
      p.view.destroy()
      reflectLayer.removeChild(p.refl)
      p.refl.destroy()
      const i = allProps.indexOf(p)
      if (i >= 0) allProps.splice(i, 1)
    }
    for (const f of c.fires) {
      objLayer.removeChild(f.glow)
      f.glow.destroy()
      reflectLayer.removeChild(f.glowR)
      f.glowR.destroy()
      const i = campfires.indexOf(f)
      if (i >= 0) campfires.splice(i, 1)
    }
    chunks.delete(key)
  }

  function updateChunks() {
    // 可视半径（含缩放），外加一块余量；卸载半径再放宽一块防抖
    const R = Math.hypot(W, H) * 0.5 / cam.zoom + CHUNK * 0.6
    const i0 = Math.floor((cam.cx - R) / CHUNK)
    const i1 = Math.floor((cam.cx + R) / CHUNK)
    const j0 = Math.floor((cam.cy - R) / CHUNK)
    const j1 = Math.floor((cam.cy + R) / CHUNK)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) genChunk(i, j)
    for (const key of chunks.keys()) {
      const [i, j] = key.split(',').map(Number)
      const cx = (i + 0.5) * CHUNK
      const cy = (j + 0.5) * CHUNK
      if (Math.abs(cx - cam.cx) > R + CHUNK * 1.5 || Math.abs(cy - cam.cy) > R + CHUNK * 1.5) {
        dropChunk(key)
      }
    }
  }

  // —— 蝴蝶：围绕锚点八字飞舞，扇翅用 scale.y 模拟；离远了换个锚点跟过来 ——
  const butterflies = [
    { ax: 620, ay: 690 },
    { ax: 1240, ay: 880 },
    { ax: 1600, ay: 500 },
    { ax: 830, ay: 300 },
    { ax: 1420, ay: 250 },
  ].map((b, i) => {
    const spr = new PIXI.Sprite(tex.butterfly)
    spr.anchor.set(0.5)
    rainLayer.addChild(spr)
    return { spr, ...b, ph: i * 2.1, sp: 0.55 + (i % 3) * 0.2 }
  })
  const waterFilter = new PIXI.Filter(undefined, WATER_FRAG, {
    uNoise: noise.texture,
    uRipple: rippleRT,
    uReflect: reflectRT,
    uPond: pondMask.texture,
    uTime: 0,
    uScreen: [W, H],
    uCut: cutFor(wetness),
    uFocus: [FX, FY],
    uRot: [1, 0],
    uZoom: 1,
    uPondRect: [pond.x, pond.y, pond.width, pond.height],
    uLevel: level,
    uNight: 1,
    uCam: [FX, FY],
    uSnow: 0,
    uTrample: trampleRT,
  })
  waterFilter.resolution = app.renderer.resolution
  ground.filterArea = new PIXI.Rectangle(0, 0, W, H)
  ground.filters = [waterFilter]

  // —— 全屏后处理：好玩效果（数字键 1-4 开关，落地自动冲击波）——
  const postFilter = new PIXI.Filter(undefined, POST_FRAG, {
    uTime: 0,
    uScreen: [W, H],
    uGB: 0,
    uSwirl: 0,
    uJelly: 0,
    uPsy: 0,
    uShock: [0, 0, 0],
    uShockAmp: 0,
  })
  postFilter.resolution = app.renderer.resolution
  world.filterArea = new PIXI.Rectangle(0, 0, W, H)
  // fx = 开关目标值，fxNow = 当前值（每帧缓动，效果淡入淡出）
  const fx = { gb: 0, swirl: 0, jelly: 0, psy: 0 }
  const fxNow = { gb: 0, swirl: 0, jelly: 0, psy: 0 }
  const shock = { x: 0, y: 0, r: 0, amp: 0 }

  /** 与 shader 同款采样：草地积水判定 */
  function puddleValueAt(x, y) {
    const nu = (x / W) * 1.3
    const nv = ((y * 1.6) / W) * 1.3
    return noise.sampleR(nu, nv)
  }
  function isOnWater(x, y) {
    return (
      pondWaterAt(x, y) ||
      riverDepthAt(x, y) > 1 - level + 0.03 ||
      puddleValueAt(x, y) > cutFor(wetness) + 0.02
    )
  }

  /** 该处雪覆盖度（近似 shader 公式，sn2 取中值） */
  function snowCoverAt(x, y) {
    if (snowAmt <= 0.02) return 0
    const sn = noise.sampleR(x * 0.0011 + 0.31, y * 0.0011 + 0.77) + 0.15
    const lo = 1.08 - snowAmt * 1.3
    const hi = 1.3 - snowAmt * 1.3
    return clamp((sn - lo) / (hi - lo), 0, 1)
  }

  /** 踩一个脚印（世界坐标 + 行走方向，椭圆沿行进方向） */
  function spawnFootprint(x, y, ang) {
    const spr = new PIXI.Sprite(fireTex)
    spr.anchor.set(0.5)
    trampleScene.addChild(spr)
    footprints.push({ spr, x, y, ang, age: 0 })
    if (footprints.length > 600) {
      const old = footprints.shift()
      trampleScene.removeChild(old.spr)
      old.spr.destroy()
    }
  }

  // —— 雨滴 / 飞溅 / 雪花 ——
  const dropTex = makeDropTexture()
  const splashTex = makeSplashTexture()
  const drops = []
  const splashes = []
  const flakes = []
  let rainOn = false // 默认晴天，按 R 开雨
  let snowOn = false
  let snowAmt = 0
  const audio = new RainAudio()
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true })

  const keys = new Set()
  const target = { x: hero.x, y: hero.y, active: false }
  // 双击方向键 → 冲刺（松开所有方向键后恢复）
  const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])
  let sprinting = false
  const lastTap = {}
  // 空格 2 段跳：air = { z(离地高), vz, jumps }；空中可再跳一次
  let air = null
  let zoomBase = 1
  const JUMP_VZ = 560
  const JUMP_GRAVITY = 1700

  // F 蓄力气功波：按住蓄力（人物站定、光球变大），松开轰出光束
  let kiCharge = null // { t, view, core, glow, sndStop }
  // 龟派气功光束：fire(高速延伸) → hold(持续输出) → fade(收束)
  const kiBeams = [] // { ox, oy, dx, dy, len, maxLen, phase, t, width, power, ... }
  // 爆点弹坑（世界坐标贴地，随镜头重投影，几十秒后淡出）
  const craters = []
  // 放波运镜（C 开关）：蓄力推近 + 光束头特写
  let kiCamOn = true

  function doJump() {
    if (kiCharge || kiBeams.length) return // 蓄力/放波时不能跳
    if (air) {
      if (air.jumps >= 2) return
      // 二段跳：重置竖直速度，身体处冒一圈小气尘
      air.jumps = 2
      air.vz = JUMP_VZ
      audio.playJump(true)
      const lp = w2s(hero.x, hero.y)
      const bodyY = lp.y - air.z * cam.zoom
      for (let i = 0; i < 3; i++) {
        spawnSmoke(lp.x + (Math.random() - 0.5) * 22, bodyY + 6, 0.22, 0xdce6ee)
      }
    } else {
      air = { z: 0, vz: JUMP_VZ, jumps: 1 }
      hero.playAnim('jump', true)
      audio.playJump(false)
    }
  }
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase()
    if (MOVE_KEYS.has(k) && !e.repeat) {
      const now = performance.now()
      if (now - (lastTap[k] || -1e9) < 320) sprinting = true
      lastTap[k] = now
    }
    keys.add(k)
    if (e.key.toLowerCase() === 'r') {
      rainOn = !rainOn
      if (rainOn) {
        snowOn = false // 雨雪互斥
        audio.startRainLoop()
      } else audio.stopRainLoop()
    }
    if (e.key.toLowerCase() === 'x') {
      snowOn = !snowOn
      if (snowOn && rainOn) {
        rainOn = false
        audio.stopRainLoop()
      }
    }
    if (e.key.toLowerCase() === 'l') {
      strikeLightning(W * (0.12 + Math.random() * 0.76), H * (0.25 + Math.random() * 0.6))
    }
    if (e.key === '[') levelBase = clamp(levelBase - 0.08, 0.1, 0.95)
    if (e.key === ']') levelBase = clamp(levelBase + 0.08, 0.1, 0.95)
    if (e.key.toLowerCase() === 'n') nightOn = !nightOn
    // 好玩效果开关（可叠加）
    if (e.key === '1') fx.gb = fx.gb ? 0 : 1
    if (e.key === '2') fx.swirl = fx.swirl ? 0 : 1
    if (e.key === '3') fx.jelly = fx.jelly ? 0 : 1
    if (e.key === '4') fx.psy = fx.psy ? 0 : 1
    if (k === 'f' && !e.repeat) startKiCharge()
    if (k === 'c') kiCamOn = !kiCamOn
    if (e.key === ' ' && !e.repeat) {
      e.preventDefault()
      doJump()
    }
  })
  window.addEventListener('keyup', (e) => {
    keys.delete(e.key.toLowerCase())
    if (e.key.toLowerCase() === 'f') releaseKi()
    let anyMove = false
    for (const k of MOVE_KEYS) if (keys.has(k)) anyMove = true
    if (!anyMove) sprinting = false
  })
  app.view.addEventListener('pointerdown', (ev) => {
    const rect = app.view.getBoundingClientRect()
    // 点击目标转成世界坐标存，旋转中目标不漂移
    const p = s2w(((ev.clientX - rect.left) / rect.width) * W, ((ev.clientY - rect.top) / rect.height) * H)
    target.x = p.x
    target.y = p.y
    target.active = true
  })
  // 滚轮：绕焦点缩放
  app.view.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault()
      zoomBase = clamp(zoomBase * (ev.deltaY > 0 ? 0.92 : 1.08), 0.55, 1.8)
    },
    { passive: false }
  )
  if (rainOn) audio.startRainLoop()

  function spawnDrop() {
    const x = Math.random() * W
    const y = -20
    const spr = new PIXI.Sprite(dropTex)
    spr.anchor.set(0.5, 1)
    spr.scale.set(0.8 + Math.random() * 0.4)
    spr.alpha = 0.4 + Math.random() * 0.3
    spr.x = x
    spr.y = y
    rainLayer.addChild(spr)
    drops.push({ spr, x, y, vy: 900 + Math.random() * 300, groundY: H * (0.1 + Math.random() * 0.85) })
  }
  function spawnFlake() {
    const spr = new PIXI.Sprite(fireTex) // 软圆渐变粒子，白色即雪花
    spr.anchor.set(0.5)
    spr.tint = 0xf0f6ff
    const sc = 0.1 + Math.random() * 0.14
    spr.scale.set(sc)
    spr.alpha = 0.5 + Math.random() * 0.4
    spr.x = Math.random() * W
    spr.y = -12
    rainLayer.addChild(spr)
    flakes.push({
      spr,
      x: spr.x,
      y: -12,
      vy: 65 + Math.random() * 70,
      seed: Math.random() * 10,
      groundY: H * (0.08 + Math.random() * 0.88),
      rest: 0,
    })
  }

  function spawnSplash(x, y, count = 2) {
    const n = count + ((Math.random() * 2) | 0)
    for (let i = 0; i < n; i++) {
      const spr = new PIXI.Sprite(splashTex)
      spr.anchor.set(0.5)
      spr.x = x
      spr.y = y
      spr.scale.set(0.5 + Math.random() * 0.3)
      rainLayer.addChild(spr)
      const a = -Math.PI * 0.5 + (Math.random() - 0.5) * 1.4
      const spd = 40 + Math.random() * 80
      splashes.push({ spr, x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, age: 0, life: 0.22 })
    }
  }

  // —— 闪电：劈到地面 → 起火 → 雨里慢慢熄灭 ——
  const fireTex = makeFireParticleTexture()
  const glowTex = makeGlowTexture()
  const bolts = []
  const fires = []
  const fireParts = []
  let flashT = 0
  let nextStrike = 4 + Math.random() * 6

  function strikeLightning(gx, gy) {
    // 电弧：主干从天顶折线劈下 + 2~3 条分叉
    const g = new PIXI.Graphics()
    const pts = []
    const topX = gx + (Math.random() - 0.5) * 260
    const segs = Math.max(6, Math.ceil(gy / 70))
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const amp = 90 * (1 - t * 0.8)
      pts.push({
        x: lerp(topX, gx, t) + (i === 0 || i === segs ? 0 : (Math.random() - 0.5) * amp),
        y: t * gy,
      })
    }
    const drawPath = (path, wCore) => {
      g.lineStyle(wCore * 4.5, 0x7090ff, 0.25)
      polyline(g, path)
      g.lineStyle(wCore * 2, 0xaaccff, 0.55)
      polyline(g, path)
      g.lineStyle(wCore, 0xffffff, 1)
      polyline(g, path)
    }
    drawPath(pts, 4)
    const branchN = 2 + ((Math.random() * 2) | 0)
    for (let b = 0; b < branchN; b++) {
      const start = pts[1 + ((Math.random() * (segs - 3)) | 0)]
      const dir = Math.random() < 0.5 ? -1 : 1
      const bp = [{ x: start.x, y: start.y }]
      let bx = start.x
      let by = start.y
      for (let i = 0; i < 3; i++) {
        bx += dir * (20 + Math.random() * 45)
        by += 25 + Math.random() * 40
        bp.push({ x: bx, y: by })
      }
      drawPath(bp, 1.5)
    }
    // 落点亮斑
    g.beginFill(0xffffff, 0.9)
    g.drawEllipse(gx, gy, 14, 6)
    g.endFill()
    boltLayer.addChild(g)
    bolts.push({ g, age: 0, life: 0.26, seed: Math.random() * 10 })

    flashT = 0.34
    audio.playThunder(0.06 + Math.random() * 0.2)

    // 落点判定/火焰位置用世界坐标（gx,gy 是屏幕坐标）
    const wp = s2w(gx, gy)
    if (isOnWater(wp.x, wp.y)) {
      // 劈进水里：大波纹 + 水汽，不起火
      spawnRipple(gx, gy, 1.6)
      spawnRipple(gx, gy, 1.0)
      spawnSplash(gx, gy, 8)
      for (let i = 0; i < 6; i++) spawnSmoke(gx + (Math.random() - 0.5) * 30, gy, 0.5, 0xc8d4dc)
    } else {
      igniteFire(wp.x, wp.y)
    }
  }

  function igniteFire(x, y) {
    const c = new PIXI.Container()
    c.x = x
    c.y = y
    const scorch = new PIXI.Graphics()
    scorch.beginFill(0x120a05, 0.6)
    scorch.drawEllipse(0, 0, 36, 13)
    scorch.endFill()
    const glow = new PIXI.Sprite(glowTex)
    glow.anchor.set(0.5)
    glow.blendMode = PIXI.BLEND_MODES.ADD
    glow.y = -8
    c.addChild(scorch, glow)
    objLayer.addChild(c)
    // 火光倒影：一个加色光斑丢进倒影场景，水面会映出橙色光晕
    const rGlow = new PIXI.Sprite(glowTex)
    rGlow.anchor.set(0.5)
    rGlow.blendMode = PIXI.BLEND_MODES.ADD
    rGlow.x = x
    rGlow.y = y
    reflectLayer.addChild(rGlow)
    fires.push({
      c,
      scorch,
      glow,
      rGlow,
      x,
      y,
      age: 0,
      dur: 6 + Math.random() * 3, // 雨里烧不了太久
      seed: Math.random() * 10,
      acc: 0,
      smokeAcc: 0,
      done: false,
    })
    // 起火瞬间迸一圈火星
    for (let i = 0; i < 10; i++) spawnEmber(c, (Math.random() - 0.5) * 24, -4, 1)
  }

  // ─────────────────────────────────────────────
  // F 蓄力气功波（龙珠式）：蓄力光球 → 发射能量弹 → 命中爆炸+冲击波+起火
  // ─────────────────────────────────────────────
  /** 能量粒子：加色发光，用于尾迹/爆炸迸发 */
  function spawnKi(x, y, vx, vy, sc, tint, life = 0.4) {
    const spr = new PIXI.Sprite(fireTex)
    spr.anchor.set(0.5)
    spr.blendMode = PIXI.BLEND_MODES.ADD
    spr.tint = tint
    spr.scale.set(sc)
    spr.x = x
    spr.y = y
    boltLayer.addChild(spr)
    fireParts.push({ spr, kind: 'ki', vx, vy, age: 0, life, sc0: sc, a0: 1 })
  }

  /** 双层发光球：外圈色晕 + 白热内核（fireTex 是白色渐变，染色不发闷） */
  function makeKiOrb(glowTint) {
    const view = new PIXI.Container()
    const glow = new PIXI.Sprite(fireTex)
    glow.anchor.set(0.5)
    glow.blendMode = PIXI.BLEND_MODES.ADD
    glow.tint = glowTint
    const core = new PIXI.Sprite(fireTex)
    core.anchor.set(0.5)
    core.blendMode = PIXI.BLEND_MODES.ADD
    core.tint = 0xeaf6ff
    view.addChild(glow, core)
    return { view, core, glow }
  }

  function startKiCharge() {
    if (kiCharge || air || kiBeams.length) return
    const orb = makeKiOrb(0x5fb0ff)
    boltLayer.addChild(orb.view)
    kiCharge = { t: 0, ...orb, sndStop: audio.playKiCharge() }
  }

  function releaseKi() {
    if (!kiCharge) return
    const power = clamp(kiCharge.t / 1.2, 0.15, 1) // 蓄 1.2s 满
    if (kiCharge.sndStop) kiCharge.sndStop()
    boltLayer.removeChild(kiCharge.view)
    kiCharge.view.destroy({ children: true })
    kiCharge = null

    // 发射方向：按住的方向键优先，否则人物朝向（屏幕方向 → 世界方向）
    let sx = 0
    let sy = 0
    if (keys.has('w') || keys.has('arrowup')) sy -= 1
    if (keys.has('s') || keys.has('arrowdown')) sy += 1
    if (keys.has('a') || keys.has('arrowleft')) sx -= 1
    if (keys.has('d') || keys.has('arrowright')) sx += 1
    if (!sx && !sy) sx = hero.face === 'left' ? -1 : 1
    const len = Math.hypot(sx, sy) || 1
    sx /= len
    sy /= len
    const wx = sx * cam.cos + sy * cam.sin
    const wy = -sx * cam.sin + sy * cam.cos

    // 光束容器：Graphics 画束身 + 枪口/头部光球
    const view = new PIXI.Container()
    const g = new PIXI.Graphics()
    g.blendMode = PIXI.BLEND_MODES.ADD
    const muzzle = new PIXI.Sprite(fireTex)
    muzzle.anchor.set(0.5)
    muzzle.blendMode = PIXI.BLEND_MODES.ADD
    muzzle.tint = 0x4f9fff
    const headGlow = new PIXI.Sprite(fireTex)
    headGlow.anchor.set(0.5)
    headGlow.blendMode = PIXI.BLEND_MODES.ADD
    headGlow.tint = 0x5fb4ff
    const headCore = new PIXI.Sprite(fireTex)
    headCore.anchor.set(0.5)
    headCore.blendMode = PIXI.BLEND_MODES.ADD
    headCore.tint = 0xffffff
    view.addChild(g, muzzle, headGlow, headCore)
    boltLayer.addChild(view)
    kiBeams.push({
      ox: hero.x + wx * 24,
      oy: hero.y + wy * 24,
      dx: wx,
      dy: wy,
      len: 12,
      maxLen: 620 + power * 900,
      phase: 'fire',
      t: 0,
      width: 0,
      hit: false,
      acc: 0,
      power,
      ph1: Math.random() * 10, // 束身波动相位（每发不同，避免两发波形一样）
      ph2: Math.random() * 10,
      view,
      g,
      muzzle,
      headGlow,
      headCore,
      sndStop: audio.playKiBeam(power),
    })
    hero.playAnim('attack', false)
    audio.playKiFire(power)
    // 出手后坐力尘土
    const lp = w2s(hero.x, hero.y)
    for (let i = 0; i < 3; i++) {
      spawnSmoke(lp.x - sx * 14 + (Math.random() - 0.5) * 16, lp.y + 4, 0.25, 0x9a9284)
    }
  }

  /** 爆点弹坑：焦土 + 深坑 + 放射裂纹 + 坑缘碎石，一次画好贴在地上 */
  /** 不规则闭合多边形顶点：半径带平滑随机扰动，避免规则圆 */
  function blobPts(cx, cy, r, rough, n = 20) {
    const raw = []
    for (let i = 0; i < n; i++) raw.push(1 + (Math.random() - 0.5) * 2 * rough)
    const pts = []
    for (let i = 0; i < n; i++) {
      // 相邻顶点加权平均，扰动柔和不带尖刺
      const s = (raw[(i + n - 1) % n] + raw[i] * 2 + raw[(i + 1) % n]) / 4
      const a = (i / n) * Math.PI * 2
      pts.push(cx + Math.cos(a) * r * s, cy + Math.sin(a) * r * s)
    }
    return pts
  }

  /** 一条折线裂缝：从 (px,py) 沿 ang 延伸，宽度渐细，尾部可分叉 */
  function drawCrack(g, px, py, ang, len, w0, depth) {
    let a = ang
    let w = w0
    let x = px
    let y = py
    const segs = 4 + ((Math.random() * 4) | 0)
    for (let s = 0; s < segs; s++) {
      a += (Math.random() - 0.5) * 1.1
      const step = (len / segs) * (0.6 + Math.random() * 0.8)
      const nx = x + Math.cos(a) * step
      const ny = y + Math.sin(a) * step
      const pxp = -Math.sin(a) * w
      const pyp = Math.cos(a) * w
      g.beginFill(0x0c0906, 0.75 * (1 - (s / segs) * 0.45))
      g.drawPolygon([x - pxp, y - pyp, x + pxp, y + pyp, nx, ny])
      g.endFill()
      // 中段随机岔出一条更细的支裂缝
      if (depth > 0 && s >= 1 && Math.random() < 0.4) {
        drawCrack(g, x, y, a + (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.8), len * 0.45, w * 0.55, depth - 1)
      }
      x = nx
      y = ny
      w *= 0.62
    }
  }

  function spawnCrater(wx, wy, power) {
    const g = new PIXI.Graphics()
    const R0 = 42 + power * 72
    // 焦土：几团不规则深色斑块叠加，外缘参差
    for (const [r, a, rough] of [
      [R0 * 1.9, 0.16, 0.45],
      [R0 * 1.45, 0.26, 0.35],
      [R0 * 1.02, 0.42, 0.3],
    ]) {
      g.beginFill(0x14100c, a)
      g.drawPolygon(blobPts((Math.random() - 0.5) * R0 * 0.2, (Math.random() - 0.5) * R0 * 0.2, r, rough))
      g.endFill()
    }
    // 翻出的土：不是完整圆环，而是坑缘一坨一坨的土块
    const nclump = 7 + ((Math.random() * 4) | 0)
    for (let i = 0; i < nclump; i++) {
      const a = (i / nclump) * Math.PI * 2 + Math.random() * 0.6
      const rr = R0 * (0.62 + Math.random() * 0.22)
      const cs = R0 * (0.16 + Math.random() * 0.2)
      g.beginFill(0x7a5f40, 0.55 + Math.random() * 0.3)
      g.drawPolygon(blobPts(Math.cos(a) * rr, Math.sin(a) * rr, cs, 0.5, 10))
      g.endFill()
    }
    // 坑底：不规则深坑，再叠一块偏心的更深区域
    g.beginFill(0x0a0705, 0.9)
    g.drawPolygon(blobPts(0, -R0 * 0.04, R0 * 0.55, 0.28))
    g.endFill()
    g.beginFill(0x030202, 0.85)
    g.drawPolygon(blobPts(R0 * (Math.random() - 0.5) * 0.3, -R0 * 0.08, R0 * 0.32, 0.4, 14))
    g.endFill()
    // 放射裂纹：细长折线 + 随机分叉，长短角度都不均匀
    const nc = 5 + ((Math.random() * 4) | 0)
    for (let i = 0; i < nc; i++) {
      const a2 = (i / nc) * Math.PI * 2 + (Math.random() - 0.5) * 1.2
      const start = R0 * (0.4 + Math.random() * 0.25)
      drawCrack(
        g,
        Math.cos(a2) * start,
        Math.sin(a2) * start,
        a2,
        R0 * (0.7 + Math.random() * 1.1),
        R0 * (0.045 + Math.random() * 0.035),
        2,
      )
    }
    // 坑缘散落的碎石：大小疏密不一，带小阴影
    const nr = 10 + ((Math.random() * 8) | 0)
    for (let i = 0; i < nr; i++) {
      const a3 = Math.random() * Math.PI * 2
      const rr = R0 * (0.75 + Math.random() * 1.1)
      const sx = Math.cos(a3) * rr
      const sy = Math.sin(a3) * rr
      const sr = R0 * (0.03 + Math.random() * 0.06)
      g.beginFill(0x0c0906, 0.4)
      g.drawEllipse(sx + sr * 0.4, sy + sr * 0.4, sr * 1.1, sr * 0.8)
      g.endFill()
      g.beginFill(Math.random() < 0.5 ? 0x5a462e : 0x4a3a26, 0.85)
      g.drawPolygon(blobPts(sx, sy, sr, 0.5, 7))
      g.endFill()
    }
    objLayer.addChild(g)
    craters.push({ g, x: wx, y: wy, age: 0, dur: 26 })
  }

  /** 岩块碎片：被炸上天再砸下来的深色土石 */
  function spawnRock(x, y, power) {
    const spr = new PIXI.Sprite(fireTex)
    spr.anchor.set(0.5)
    spr.tint = 0x241c12
    spr.alpha = 0.95
    const sc = 0.12 + Math.random() * 0.16
    spr.scale.set(sc)
    spr.x = x
    spr.y = y - 10
    rainLayer.addChild(spr)
    const a = Math.random() * Math.PI * 2
    const spd = (120 + Math.random() * 260) * (0.6 + power * 0.6)
    fireParts.push({
      spr,
      kind: 'rock',
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd * 0.55 - (160 + Math.random() * 240),
      age: 0,
      life: 0.55 + Math.random() * 0.4,
      sc0: sc,
      a0: 0.95,
    })
  }

  function explodeKi(b) {
    const lp = w2s(b.x, b.y)
    // 屏幕冲击波 + 短闪光 + 雷鸣（威力越大越近越响）
    shock.x = lp.x
    shock.y = lp.y
    shock.r = 12
    shock.amp = 0.6 + b.power * 0.7
    flashT = Math.max(flashT, 0.1 + b.power * 0.14)
    audio.playThunder(clamp(0.3 - b.power * 0.25, 0.03, 0.3))
    // 爆心迸发：白热/青蓝/橙焰三色能量粒子
    const n = Math.round(12 + b.power * 16)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const spd = (70 + Math.random() * 260) * (0.5 + b.power * 0.8)
      const tint = [0xffffff, 0x9fd4ff, 0xffb060][(Math.random() * 3) | 0]
      spawnKi(
        lp.x,
        lp.y - 18,
        Math.cos(a) * spd,
        Math.sin(a) * spd * 0.6, // 俯角：纵向压扁成椭圆
        0.2 + Math.random() * 0.3 * (0.6 + b.power),
        tint,
        0.35 + Math.random() * 0.4
      )
    }
    for (let i = 0; i < 5; i++) {
      spawnSmoke(lp.x + (Math.random() - 0.5) * 50, lp.y + (Math.random() - 0.5) * 18, 0.32, 0x6a6258)
    }
    // 落点：水面炸出大水花，陆地砸出碎裂弹坑
    if (isOnWater(b.x, b.y)) {
      spawnRipple(lp.x, lp.y, 1.6)
      spawnRipple(lp.x, lp.y, 1.0)
      spawnSplash(lp.x, lp.y, 12)
      for (let i = 0; i < 5; i++) spawnSmoke(lp.x + (Math.random() - 0.5) * 30, lp.y, 0.45, 0xc8d4dc)
    } else {
      // 地表碎裂大坑 + 燃烧
      spawnCrater(b.x, b.y, b.power)
      igniteFire(b.x, b.y)
      // 尘土蘑菇云：爆心腾起的大团烟尘
      const nd = Math.round(10 + b.power * 12)
      for (let i = 0; i < nd; i++) {
        spawnSmoke(lp.x + (Math.random() - 0.5) * 44, lp.y - Math.random() * 12, 0.55, 0x9a8870)
      }
      // 贴地尘环：一圈灰尘向外横扫（俯角压扁成椭圆）
      const ring = Math.round(12 + b.power * 10)
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2 + Math.random() * 0.4
        const spd = (140 + Math.random() * 120) * (0.7 + b.power * 0.5)
        const spr = new PIXI.Sprite(fireTex)
        spr.anchor.set(0.5)
        spr.tint = 0x9a8a72
        spr.alpha = 0.6
        const sc = 0.55 + Math.random() * 0.45
        spr.scale.set(sc)
        spr.x = lp.x + Math.cos(a) * 14
        spr.y = lp.y + Math.sin(a) * 8
        rainLayer.addChild(spr)
        fireParts.push({
          spr,
          kind: 'dust',
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd * 0.55,
          age: 0,
          life: 0.7 + Math.random() * 0.4,
          sc0: sc,
          a0: 0.5,
        })
      }
      // 岩块碎片：抛上天再砸回来
      const nrk = Math.round(8 + b.power * 10)
      for (let i = 0; i < nrk; i++) spawnRock(lp.x, lp.y, b.power)
    }
  }

  /** 画龟派气功（参考 FighterZ）：巨大枪口能量球 + 锥形三层光束 + 电弧 + 放射能量刺 */
  function drawKiBeam(b, x0, y0, x1, y1) {
    const g = b.g
    g.clear()
    const dx = x1 - x0
    const dy = y1 - y0
    const L = Math.hypot(dx, dy)
    if (L < 6 || b.width <= 0.01) return
    const ux = dx / L
    const uy = dy / L
    const nx = -uy
    const ny = ux
    const R = (30 + 42 * b.power) * b.width * cam.zoom // 枪口能量球半径（满蓄比人还大）
    const wBeam = R * 0.62 // 束身基准半宽

    // 闪烁帧：电弧/能量刺每 ~55ms 重新生成形状，帧间保持稳定（免得高频闪成噪点）
    const fl = (time * 18) | 0
    if (b.flick !== fl) {
      b.flick = fl
      // 球上的放射长芒：细长、带折弯、长短不一（速度线）
      b.spikes = []
      const ns = 6 + ((Math.random() * 4) | 0)
      for (let i = 0; i < ns; i++) {
        b.spikes.push({
          ang: Math.random() * Math.PI * 2,
          len: R * (0.7 + Math.random() * 2.0),
          w: R * (0.04 + Math.random() * 0.08),
          bend: (Math.random() - 0.5) * R * 0.5,
          a: 0.3 + Math.random() * 0.35,
        })
      }
      // 束身外冒的斜芒
      b.beamSpikes = []
      const nb = 3 + ((Math.random() * 3) | 0)
      for (let i = 0; i < nb; i++) {
        b.beamSpikes.push({
          t: 0.12 + Math.random() * 0.68, // 避开头部收口段
          side: Math.random() < 0.5 ? -1 : 1,
          len: wBeam * (0.7 + Math.random() * 1.6),
          w: wBeam * (0.1 + Math.random() * 0.12),
          skew: (Math.random() - 0.5) * 1.6,
          bend: (Math.random() - 0.5) * wBeam * 0.7,
          a: 0.25 + Math.random() * 0.3,
        })
      }
      // 电弧：中点位移法生成分形闪电（细分 5 次 → 33 个点），带 1~2 条分叉
      b.arcs = []
      const na = 2 + ((Math.random() * 2) | 0)
      for (let a = 0; a < na; a++) {
        let pts = [0, (Math.random() - 0.5) * 0.8, 0]
        let amp = 1
        for (let it = 0; it < 4; it++) {
          const next = [pts[0]]
          for (let i = 1; i < pts.length; i++) {
            next.push((pts[i - 1] + pts[i]) / 2 + (Math.random() - 0.5) * amp, pts[i])
          }
          pts = next
          amp *= 0.55
        }
        // 分叉：从主弧中段某点向外甩一条渐远的短支
        const branches = []
        const nbr = Math.random() < 0.65 ? 1 : 2
        for (let bi = 0; bi < nbr; bi++) {
          const i0 = 6 + ((Math.random() * (pts.length - 14)) | 0)
          const segsB = 5 + ((Math.random() * 4) | 0)
          const sign = Math.random() < 0.5 ? -1 : 1
          const bpts = []
          for (let s = 1; s <= segsB; s++) {
            bpts.push({
              dt: (s / segsB) * (0.05 + Math.random() * 0.09),
              off: pts[i0] + sign * s * (0.35 + Math.random() * 0.45) + (Math.random() - 0.5) * 0.5,
            })
          }
          branches.push({ i0, bpts })
        }
        b.arcs.push({ pts, branches, seed: Math.random() * 10 })
      }
    }

    // —— 束身：四层填充多边形，出球后向头部渐扩（锥形）——
    // 每层边缘完全独立：各自的频率/相位/流速/波幅（波幅是绝对量，不随层宽缩放），
    // 层与层的轮廓互不平行，白芯翻滚最剧烈——等离子体的质感
    const layers = [
      { k: 2.0, color: 0x1a50d8, alpha: 0.3 * b.width, amp: 0.5, fq: 1.0, sp: 1.0, ph: 0 },
      { k: 1.55, color: 0x2f7ff0, alpha: 0.4 * b.width, amp: 0.42, fq: 1.31, sp: 1.35, ph: 2.1 },
      { k: 1.15, color: 0x5fb8ff, alpha: 0.55 * b.width, amp: 0.34, fq: 1.73, sp: 0.8, ph: 4.4 },
      { k: 0.7, color: 0xffffff, alpha: 0.95, amp: 0.3, fq: 2.23, sp: 1.6, ph: 1.2 },
    ]
    const segs = Math.max(12, Math.ceil(L / 16))
    for (const ly of layers) {
      const top = []
      const bot = []
      for (let s = 0; s <= segs; s++) {
        const t = s / segs
        const prof = 0.5 + 0.8 * t
        // 头部收口：末端 14% 沿圆弧塌缩到 0，束身汇进爆心光球（消掉平头矩形）
        const tCap = Math.max(0, (t - 0.86) / 0.14)
        const cap = Math.sqrt(Math.max(0, 1 - tCap * tCap))
        const wobT =
          ly.amp *
          (0.55 * Math.sin(t * L * 0.019 * ly.fq - time * 13 * ly.sp + b.ph1 + ly.ph) +
            0.3 * Math.sin(t * L * 0.0413 * ly.fq + time * 21 * ly.sp + b.ph2 + ly.ph * 1.7) +
            0.15 * Math.sin(t * L * 0.0877 * ly.fq - time * 31 * ly.sp + ly.ph * 2.3))
        const wobB =
          ly.amp *
          (0.55 * Math.sin(t * L * 0.019 * ly.fq - time * 12 * ly.sp + b.ph2 + ly.ph * 2.9) +
            0.3 * Math.sin(t * L * 0.0413 * ly.fq + time * 19 * ly.sp + b.ph1 + ly.ph * 0.6) +
            0.15 * Math.sin(t * L * 0.0877 * ly.fq - time * 29 * ly.sp + ly.ph * 1.4))
        const bx = x0 + ux * L * t
        const by = y0 + uy * L * t
        const hwT = Math.max(wBeam * 0.02, wBeam * (ly.k + wobT) * prof * cap)
        const hwB = Math.max(wBeam * 0.02, wBeam * (ly.k + wobB) * prof * cap)
        top.push(bx + nx * hwT, by + ny * hwT)
        bot.push(bx - nx * hwB, by - ny * hwB)
      }
      for (let i = bot.length - 2; i >= 0; i -= 2) top.push(bot[i], bot[i + 1])
      g.beginFill(ly.color, ly.alpha)
      g.drawPolygon(top)
      g.endFill()
    }

    // —— 束身外冒的斜芒：细长四边形，中段折弯，不再是规则三角 ——
    for (const s of b.beamSpikes) {
      const prof = 0.5 + 0.8 * s.t
      const bx = x0 + ux * L * s.t
      const by = y0 + uy * L * s.t
      const base = wBeam * 1.5 * prof
      const dirx = nx * s.side
      const diry = ny * s.side
      const L2 = base + s.len * prof
      const midx = bx + dirx * (base + s.len * prof * 0.5) + ux * (s.skew * s.len * 0.4 + s.bend)
      const midy = by + diry * (base + s.len * prof * 0.5) + uy * (s.skew * s.len * 0.4 + s.bend)
      const tipx = bx + dirx * L2 + ux * s.skew * s.len
      const tipy = by + diry * L2 + uy * s.skew * s.len
      g.beginFill(0x9fd8ff, s.a * b.width)
      g.drawPolygon([bx - ux * s.w, by - uy * s.w, bx + ux * s.w, by + uy * s.w, midx, midy, tipx, tipy])
      g.endFill()
    }

    // —— 电弧：分形闪电，两遍描（宽青色辉光垫底 + 细白芯）——
    for (const arc of b.arcs) {
      const pts = arc.pts
      const n2 = pts.length - 1
      const flick = 0.5 + 0.5 * Math.sin(time * 47 + arc.seed)
      const arcX = (t, v) => x0 + ux * L * t + nx * v * wBeam * 1.35 * (0.5 + 0.8 * t)
      const arcY = (t, v) => y0 + uy * L * t + ny * v * wBeam * 1.35 * (0.5 + 0.8 * t)
      const passes = [
        { w: 5 * cam.zoom * b.width, color: 0x66c8ff, alpha: 0.22 + 0.14 * flick },
        { w: 1.6 * cam.zoom, color: 0xffffff, alpha: 0.45 + 0.45 * flick },
      ]
      for (const ps of passes) {
        g.lineStyle(ps.w, ps.color, ps.alpha)
        g.moveTo(arcX(0, pts[0]), arcY(0, pts[0]))
        for (let s = 1; s <= n2; s++) g.lineTo(arcX(s / n2, pts[s]), arcY(s / n2, pts[s]))
        for (const br of arc.branches) {
          const t0 = br.i0 / n2
          g.moveTo(arcX(t0, pts[br.i0]), arcY(t0, pts[br.i0]))
          for (const bp of br.bpts) g.lineTo(arcX(t0 + bp.dt, bp.off), arcY(t0 + bp.dt, bp.off))
        }
      }
    }
    g.lineStyle(0)

    // —— 枪口能量球：放射长芒 + 三层实心圆（画在束身之上）——
    for (const s of b.spikes) {
      const ca = Math.cos(s.ang)
      const sa = Math.sin(s.ang)
      const r0 = R * 0.5
      const midx = x0 + ca * (r0 + s.len * 0.5) - sa * s.bend
      const midy = y0 + sa * (r0 + s.len * 0.5) + ca * s.bend
      g.beginFill(0xbfe4ff, s.a * b.width)
      g.drawPolygon([
        x0 + ca * r0 - sa * s.w,
        y0 + sa * r0 + ca * s.w,
        x0 + ca * r0 + sa * s.w,
        y0 + sa * r0 - ca * s.w,
        midx,
        midy,
        x0 + ca * (r0 + s.len),
        y0 + sa * (r0 + s.len),
      ])
      g.endFill()
    }
    const bp = 1 + 0.07 * Math.sin(time * 26)
    g.beginFill(0x2a66e8, 0.4 * b.width)
    g.drawCircle(x0, y0, R * 1.45 * bp)
    g.endFill()
    g.beginFill(0x66baff, 0.65 * b.width)
    g.drawCircle(x0, y0, R * bp)
    g.endFill()
    g.beginFill(0xffffff, 0.97)
    g.drawCircle(x0, y0, R * 0.62 * bp)
    g.endFill()
  }

  function spawnFlame(c, intensity) {
    const spr = new PIXI.Sprite(fireTex)
    spr.anchor.set(0.5, 0.7)
    spr.blendMode = PIXI.BLEND_MODES.ADD
    spr.tint = [0xffe090, 0xffb050, 0xff7030, 0xff5028][(Math.random() * 4) | 0]
    const sc = (0.5 + Math.random() * 0.5) * (0.5 + intensity * 0.6)
    spr.scale.set(sc)
    spr.x = (Math.random() - 0.5) * 22 * intensity
    spr.y = -2
    c.addChild(spr)
    fireParts.push({
      spr,
      kind: 'flame',
      vx: (Math.random() - 0.5) * 18,
      vy: -55 - Math.random() * 70,
      age: 0,
      life: 0.4 + Math.random() * 0.3,
      sc0: sc,
    })
  }

  function spawnEmber(c, ox, oy, intensity) {
    const spr = new PIXI.Sprite(fireTex)
    spr.anchor.set(0.5)
    spr.blendMode = PIXI.BLEND_MODES.ADD
    spr.tint = 0xffd890
    spr.scale.set(0.1 + Math.random() * 0.1)
    spr.x = ox
    spr.y = oy
    c.addChild(spr)
    fireParts.push({
      spr,
      kind: 'ember',
      vx: (Math.random() - 0.5) * 90 * intensity,
      vy: -60 - Math.random() * 120 * intensity,
      age: 0,
      life: 0.5 + Math.random() * 0.5,
      sc0: spr.scale.x,
    })
  }

  function spawnSmoke(x, y, alpha = 0.25, tint = 0x585c62, blend = null) {
    const spr = new PIXI.Sprite(fireTex)
    spr.anchor.set(0.5)
    spr.tint = tint
    spr.alpha = alpha
    if (blend != null) spr.blendMode = blend
    const sc = 0.5 + Math.random() * 0.4
    spr.scale.set(sc)
    spr.x = x
    spr.y = y - 6
    rainLayer.addChild(spr)
    fireParts.push({
      spr,
      kind: 'smoke',
      vx: (Math.random() - 0.5) * 14,
      vy: -26 - Math.random() * 22,
      age: 0,
      life: 1.1 + Math.random() * 0.7,
      sc0: sc,
      a0: alpha,
    })
  }

  // —— FPS 显示（右上角，0.25s 刷新）——
  const fpsEl = document.getElementById('fps')
  let fpsAcc = 0

  // 初始生成人物周围的地图分块
  updateChunks()

  let footDist = 0
  let footSide = 1
  let lastHX = hero.x
  let lastHY = hero.y
  let time = 0
  let lastOnWater = false
  let footAcc = 0
  let rainAcc = 0
  app.ticker.add(() => {
    const dt = Math.min(0.05, app.ticker.deltaMS / 1000)
    time += dt
    waterFilter.uniforms.uTime = time

    // 河流水位：潮汐自动涨落 + [ ] 手动调节
    level = clamp(levelBase + tideAmp * Math.sin(time * 0.45), 0.05, 0.98)
    waterFilter.uniforms.uLevel = level

    // 夜空动画 + 夜晚色调渐变；下雨时云多、停雨云散星星极光更清楚
    nightSkyFilter.uniforms.uTime = time
    cloudAmt += ((rainOn || snowOn ? 0.85 : 0.35) - cloudAmt) * dt * 0.6
    nightSkyFilter.uniforms.uCloudAmt = cloudAmt
    nightOverlay.alpha += ((nightOn ? NIGHT_ALPHA : 0) - nightOverlay.alpha) * dt * 2
    const nightAmt = nightOverlay.alpha / NIGHT_ALPHA
    waterFilter.uniforms.uNight = nightAmt

    // 篝火光晕（夜里更亮）+ 蝴蝶飞舞（离远了换锚点跟过来）
    for (const f of campfires) {
      const p = w2s(f.x, f.y - 20)
      const flick = 0.85 + 0.1 * Math.sin(time * 9.3 + f.ph) + 0.05 * Math.sin(time * 23 + f.ph)
      f.glow.x = p.x
      f.glow.y = p.y
      f.glow.alpha = (0.22 + 0.55 * nightAmt) * flick
      f.glow.scale.set((0.55 + 0.15 * nightAmt) * cam.zoom * flick)
      f.glowR.x = p.x
      f.glowR.y = p.y
      f.glowR.alpha = (0.15 + 0.4 * nightAmt) * flick
      f.glowR.scale.set(0.7 * cam.zoom * flick)
    }
    for (const b of butterflies) {
      if (Math.hypot(b.ax - hero.x, b.ay - hero.y) > 1500) {
        b.ax = hero.x + (Math.random() - 0.5) * 1400
        b.ay = hero.y + (Math.random() - 0.5) * 900
      }
      const wx = b.ax + Math.sin(time * b.sp + b.ph) * 64 + Math.sin(time * 0.37 + b.ph * 2) * 30
      const wy = b.ay + Math.cos(time * b.sp * 0.8 + b.ph) * 42
      const p = w2s(wx, wy)
      const dirRight = Math.cos(time * b.sp + b.ph) > 0
      b.spr.x = p.x
      b.spr.y = p.y + Math.sin(time * 5 + b.ph) * 4
      b.spr.scale.x = (dirRight ? 1 : -1) * 1.7 * cam.zoom
      b.spr.scale.y = 1.7 * cam.zoom * (0.65 + 0.35 * Math.abs(Math.sin(time * 12 + b.ph)))
      b.spr.alpha = 0.9 - nightAmt * 0.25
    }

    if (fpsEl) {
      fpsAcc += dt
      if (fpsAcc >= 0.25) {
        fpsAcc = 0
        fpsEl.textContent = `${Math.round(app.ticker.FPS)} FPS · 水位 ${Math.round(level * 100)}%${snowAmt > 0.01 ? ` · 积雪 ${Math.round(snowAmt * 100)}%` : ''}${sprinting ? ' · 冲刺' : ''}`
      }
    }

    // —— 伪 3D 摄像机：跟随人物 + Q/E 旋转 ——
    if (keys.has('q')) cam.rot += dt * 1.1
    if (keys.has('e')) cam.rot -= dt * 1.1
    cam.cos = Math.cos(cam.rot)
    cam.sin = Math.sin(cam.rot)
    // 镜头目标：默认跟人物；开启运镜时，放波怼向光束头特写
    let camTX = hero.x
    let camTY = hero.y
    let zoomT = zoomBase
    let followK = 3.5
    if (kiCamOn) {
      if (kiCharge) {
        // 蓄力：轻微推近人物，做特写前的预备
        zoomT = zoomBase * 1.12
        followK = 4.5
      } else if (kiBeams.length) {
        // 放波：镜头甩向光束头（爆心），拉近特写
        const b = kiBeams[0]
        const hx = b.ox + b.dx * b.len
        const hy = b.oy + b.dy * b.len
        camTX = hero.x + (hx - hero.x) * 0.8
        camTY = hero.y + (hy - hero.y) * 0.8
        zoomT = zoomBase * (1.3 + b.power * 0.25)
        followK = 6.5
      }
    }
    cam.zoom += (zoomT - cam.zoom) * Math.min(1, dt * 4.5)
    // 平滑跟随
    const follow = Math.min(1, dt * followK)
    cam.cx += (camTX - cam.cx) * follow
    cam.cy += (camTY - cam.cy) * follow
    ground.pivot.set(cam.cx, cam.cy)
    ground.rotation = cam.rot
    ground.scale.set(cam.zoom)
    waterFilter.uniforms.uRot = [cam.cos, cam.sin]
    waterFilter.uniforms.uZoom = cam.zoom
    waterFilter.uniforms.uCam = [cam.cx, cam.cy]

    // —— 后处理效果：目标值缓动 + 冲击波扩散 ——
    fxNow.gb += (fx.gb - fxNow.gb) * Math.min(1, dt * 5)
    fxNow.swirl += (fx.swirl - fxNow.swirl) * Math.min(1, dt * 3)
    fxNow.jelly += (fx.jelly - fxNow.jelly) * Math.min(1, dt * 4)
    fxNow.psy += (fx.psy - fxNow.psy) * Math.min(1, dt * 4)
    if (shock.amp > 0) {
      shock.r += 1000 * dt
      shock.amp *= 1 - dt * 2.2
      if (shock.amp <= 0.02) shock.amp = 0
    }
    {
      const u = postFilter.uniforms
      u.uTime = time
      u.uGB = fxNow.gb
      u.uSwirl = fxNow.swirl
      u.uJelly = fxNow.jelly
      u.uPsy = fxNow.psy
      u.uShock = [shock.x, shock.y, shock.r]
      u.uShockAmp = shock.amp
    }
    // 全关时摘掉滤镜，省一次全屏 pass
    const fxActive = fxNow.gb + fxNow.swirl + fxNow.jelly + fxNow.psy > 0.004 || shock.amp > 0
    if (fxActive !== !!world.filters) world.filters = fxActive ? [postFilter] : null

    // 随人物移动增删地图分块
    updateChunks()

    // 摇摆（倒影同步）+ 立牌按世界坐标重算屏幕位置（billboard）
    for (const t of allProps) {
      const sk = t.amp ? Math.sin(time * t.speed + t.phase) * t.amp : 0
      t.view.skew.x = sk
      t.refl.skew.x = sk
      const pos = w2s(t.x, t.y)
      t.view.x = pos.x
      t.view.y = pos.y
      t.view.scale.set(SCALE * cam.zoom)
      t.refl.x = pos.x
      t.refl.y = pos.y
      t.refl.scale.set(SCALE * cam.zoom, -SCALE * cam.zoom)
    }

    // 移动 + 碰撞（只挡树干；水塘可趟水）；双击方向键 = 冲刺；空格 = 2 段跳
    let vx = 0
    let vy = 0
    if (keys.has('w') || keys.has('arrowup')) vy -= 1
    if (keys.has('s') || keys.has('arrowdown')) vy += 1
    if (keys.has('a') || keys.has('arrowleft')) vx -= 1
    if (keys.has('d') || keys.has('arrowright')) vx += 1
    // 蓄力/放波中：站定不动（龙珠式），方向键只用来瞄准
    if (kiCharge || kiBeams.length) {
      vx = 0
      vy = 0
      target.active = false
    }
    let moving = false
    const onWaterNow = isOnWater(hero.x, hero.y + 6)

    if (air) {
      // —— 跳跃：只管竖直方向，水平仍走正常移动逻辑 ——
      air.z += air.vz * dt
      air.vz -= JUMP_GRAVITY * dt

      // 落地：小落尘/水花 + 冲击波（二段跳落地更猛）
      if (air.z <= 0 && air.vz < 0) {
        const wasDouble = air.jumps >= 2
        air = null
        audio.playThud()
        const lp = w2s(hero.x, hero.y)
        shock.x = lp.x
        shock.y = lp.y
        shock.r = 12
        shock.amp = wasDouble ? 1 : 0.5
        if (isOnWater(hero.x, hero.y)) {
          spawnRipple(lp.x, lp.y, 0.9)
          spawnSplash(lp.x, lp.y, 5)
          audio.playWetStep()
        } else {
          const snowy = snowCoverAt(hero.x, hero.y) > 0.3
          for (let i = 0; i < 3; i++) {
            spawnSmoke(
              lp.x + (Math.random() - 0.5) * 26,
              lp.y + (Math.random() - 0.5) * 10,
              0.24,
              snowy ? 0xe6eef6 : 0x8a7a64
            )
          }
          if (snowy) spawnFootprint(hero.x, hero.y, 0)
        }
      }
    }

    {
      let nx = hero.x
      let ny = hero.y
      // 跳起时趟水不减速
      const spd = onWaterNow && !air ? (sprinting ? 320 : 200) : sprinting ? 460 : 260
      if (vx || vy) {
        // 键盘输入是屏幕方向 → 反旋转成世界方向（角色位置存世界坐标）
        const len = Math.hypot(vx, vy) || 1
        const sdx = (vx / len) * spd * dt
        const sdy = (vy / len) * spd * dt
        nx += (sdx * cam.cos + sdy * cam.sin) / cam.zoom
        ny += (-sdx * cam.sin + sdy * cam.cos) / cam.zoom
        target.active = false
      } else if (target.active) {
        const dx = target.x - hero.x
        const dy = target.y - hero.y
        const d = Math.hypot(dx, dy)
        if (d < 6) target.active = false
        else {
          nx += (dx / d) * spd * dt
          ny += (dy / d) * spd * dt
        }
      }
      moving = !!(vx || vy || target.active)

      // 朝向：键盘方向优先，否则看点击目标的屏幕方向
      let dirX = vx
      if (!dirX && target.active) {
        const wdx = target.x - hero.x
        const wdy = target.y - hero.y
        dirX = wdx * cam.cos - wdy * cam.sin
      }
      if (dirX > 0.5) hero.setFace('right')
      else if (dirX < -0.5) hero.setFace('left')
      if (air) hero.playAnim('jump', true)
      else if (kiCharge || kiBeams.length) hero.playAnim('attack', true)
      else hero.playAnim(moving ? 'walk' : 'idle', true)
      // 冲刺时动画加速
      if (hero.spine && hero.spine.state) hero.spine.state.timeScale = sprinting ? 1.7 : 1
      if (hero.reflSpine && hero.reflSpine.state) hero.reflSpine.state.timeScale = sprinting ? 1.7 : 1

      if (!blocked(nx, ny, allProps)) {
        hero.x = nx
        hero.y = ny
      } else if (!blocked(nx, hero.y, allProps)) {
        hero.x = nx
      } else if (!blocked(hero.x, ny, allProps)) {
        hero.y = ny
      }

      // 踩雪脚印：按走过的距离左右脚交替落印（空中不落印）
      const stepDx = hero.x - lastHX
      const stepDy = hero.y - lastHY
      if (!air && (stepDx || stepDy)) {
        footDist += Math.hypot(stepDx, stepDy)
        if (footDist > 26) {
          footDist = 0
          footSide = -footSide
          const ang = Math.atan2(stepDy, stepDx)
          const px = hero.x + Math.cos(ang + Math.PI / 2) * 7 * footSide
          const py = hero.y + 4 + Math.sin(ang + Math.PI / 2) * 7 * footSide
          if (!isOnWater(px, py) && snowCoverAt(px, py) > 0.2) spawnFootprint(px, py, ang)
        }
      }
    }
    lastHX = hero.x
    lastHY = hero.y

    // —— 气功波：蓄力球脉动 + 能量弹飞行/命中 ——
    if (kiCharge) {
      kiCharge.t = Math.min(kiCharge.t + dt, 1.2)
      const hp = w2s(hero.x, hero.y)
      const fdir = hero.face === 'left' ? -1 : 1
      kiCharge.view.x = hp.x + fdir * 30 * cam.zoom
      kiCharge.view.y = hp.y - 34 * cam.zoom
      // 越蓄越大 + 高频脉动，快满时抖得更凶
      const k = (0.3 + kiCharge.t * 0.9) * cam.zoom
      const pulse = 1 + (0.06 + 0.08 * kiCharge.t) * Math.sin(time * 17)
      kiCharge.core.scale.set(0.42 * k * pulse)
      kiCharge.glow.scale.set(9.2 * k * pulse)
      kiCharge.glow.alpha = 0.8
      // 周围能量被吸进光球
      if (Math.random() < dt * 28) {
        const a = Math.random() * Math.PI * 2
        const r = 42 + Math.random() * 34
        const px2 = Math.cos(a) * r
        const py2 = Math.sin(a) * r
        const spr = new PIXI.Sprite(fireTex)
        spr.anchor.set(0.5)
        spr.blendMode = PIXI.BLEND_MODES.ADD
        spr.tint = 0x9fd0ff
        spr.scale.set(0.12)
        spr.x = px2
        spr.y = py2
        kiCharge.view.addChild(spr)
        fireParts.push({ spr, kind: 'ki', vx: -px2 * 3.4, vy: -py2 * 3.4, age: 0, life: 0.3, sc0: 0.12, a0: 1 })
      }
    }
    for (let i = kiBeams.length - 1; i >= 0; i--) {
      const b = kiBeams[i]
      b.t += dt
      if (b.phase !== 'fade') b.width = Math.min(1, b.width + dt * 9)

      if (b.phase === 'fire') {
        // 光束头高速推进，逐段检测树干碰撞
        let newLen = Math.min(b.maxLen, b.len + 3400 * dt)
        for (let l = b.len + 18; l <= newLen; l += 18) {
          if (blocked(b.ox + b.dx * l, b.oy + b.dy * l, allProps)) {
            newLen = l
            b.hit = true
            break
          }
        }
        b.len = newLen
        if (b.hit || b.len >= b.maxLen) {
          b.phase = 'hold'
          b.t = 0
          b.holdT = 0.35 + b.power * 0.6
          explodeKi({ x: b.ox + b.dx * b.len, y: b.oy + b.dy * b.len, power: b.power })
        }
      } else if (b.phase === 'hold') {
        // 持续输出：镜头震颤（下一帧被跟随插值拉回，形成抖动）
        cam.cx += (Math.random() - 0.5) * 7 * b.power
        cam.cy += (Math.random() - 0.5) * 5 * b.power
        if (b.t >= b.holdT) {
          b.phase = 'fade'
          b.t = 0
          if (b.sndStop) b.sndStop()
          b.sndStop = null
        }
      } else {
        // 收束：束宽压到 0 后清理
        b.width = Math.max(0, 1 - b.t / 0.22)
        if (b.t >= 0.22) {
          if (b.sndStop) b.sndStop()
          boltLayer.removeChild(b.view)
          b.view.destroy({ children: true })
          kiBeams.splice(i, 1)
          continue
        }
      }

      // —— 画束（齐胸高度）：起点在手，头点在世界坐标爆心 ——
      const o = w2s(b.ox, b.oy)
      const h2 = w2s(b.ox + b.dx * b.len, b.oy + b.dy * b.len)
      const oy2 = o.y - 30 * cam.zoom
      const hy2 = h2.y - 30 * cam.zoom
      drawKiBeam(b, o.x, oy2, h2.x, hy2)
      // 软光晕尺寸跟随能量球半径（fireTex 32px 基底）
      const R2 = (30 + 42 * b.power) * b.width * cam.zoom
      const pulse = 1 + 0.1 * Math.sin(time * 24)
      b.muzzle.x = o.x
      b.muzzle.y = oy2
      b.muzzle.scale.set((R2 / 6) * pulse)
      b.headGlow.x = h2.x
      b.headGlow.y = hy2
      b.headGlow.scale.set((R2 / 4.2) * (1 + 0.16 * Math.sin(time * 29)))
      b.headCore.x = h2.x
      b.headCore.y = hy2
      b.headCore.scale.set((R2 / 11) * pulse)

      // 头部能量飞溅：hold 阶段最猛
      if (b.phase !== 'fade') {
        b.acc += dt * (b.phase === 'hold' ? 50 : 20)
        while (b.acc >= 1) {
          b.acc -= 1
          const a = Math.random() * Math.PI * 2
          const spd = 90 + Math.random() * 220
          spawnKi(
            h2.x,
            hy2,
            Math.cos(a) * spd,
            Math.sin(a) * spd * 0.6,
            (0.16 + Math.random() * 0.2) * (0.6 + b.power),
            Math.random() < 0.35 ? 0xffffff : 0x8fd0ff,
            0.25 + Math.random() * 0.3
          )
        }
      }
    }

    const lift = air ? air.z : 0
    hero.setLift(lift)
    const heroPos = w2s(hero.x, hero.y)
    hero.view.x = heroPos.x
    hero.view.y = heroPos.y
    hero.view.scale.set(cam.zoom)
    if (hero.spine) hero.spine.update(dt)
    // 技能特效/大招演出：推动画，到寿命移除（大招最后 0.3 秒整体淡出）
    for (let i = fxSpines.length - 1; i >= 0; i--) {
      const f = fxSpines[i]
      f.age += dt
      const node = f.holder || f.spine
      if (f.age >= f.life) {
        if (node.parent) node.parent.removeChild(node)
        try {
          node.destroy({ children: true })
        } catch (e) {
          void e
        }
        fxSpines.splice(i, 1)
        continue
      }
      if (f.holder) node.alpha = Math.min(1, (f.life - f.age) / 0.3)
      f.spine.update(dt)
    }
    if (hero.reflSpine) {
      heroReflWrap.x = heroPos.x
      heroReflWrap.y = heroPos.y
      heroReflWrap.scale.set(cam.zoom)
      hero.reflSpine.y = lift // 镜像：人升高，倒影下移
      hero.reflSpine.update(dt)
    }

    objLayer.children.sort((a, b) => a.y - b.y)

    // 积雪量：下雪渐积（约 25s 盖满），停雪慢慢融化
    snowAmt = clamp(snowAmt + (snowOn ? dt / 25 : -dt / 40), 0, 1)
    waterFilter.uniforms.uSnow = snowAmt

    // 雪花：慢速飘落 + 横向摆动，落地融进积雪
    if (snowOn) {
      rainAcc += dt * 55
      while (rainAcc >= 1) {
        rainAcc -= 1
        spawnFlake()
      }
    }
    for (let i = flakes.length - 1; i >= 0; i--) {
      const f = flakes[i]
      if (f.rest > 0) {
        f.rest -= dt
        f.spr.alpha *= 1 - dt * 2.5
        if (f.rest <= 0) {
          rainLayer.removeChild(f.spr)
          f.spr.destroy()
          flakes.splice(i, 1)
        }
        continue
      }
      f.y += f.vy * dt
      f.x += Math.sin(time * 1.8 + f.seed) * 36 * dt
      f.spr.x = f.x
      f.spr.y = f.y
      if (f.y >= f.groundY) f.rest = 0.7
    }

    // 雨滴
    if (rainOn) {
      rainAcc += dt * 110
      while (rainAcc >= 1) {
        rainAcc -= 1
        spawnDrop()
      }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]
      d.y += d.vy * dt
      d.spr.y = d.y
      if (d.y >= d.groundY) {
        const wp = s2w(d.x, d.groundY)
        const onWater = isOnWater(wp.x, wp.y)
        spawnSplash(d.x, d.groundY, onWater ? 3 : 2)
        if (onWater) spawnRipple(d.x, d.groundY, 0.3 + Math.random() * 0.3)
        rainLayer.removeChild(d.spr)
        d.spr.destroy()
        drops.splice(i, 1)
      }
    }
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i]
      s.age += dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vy += 360 * dt
      const t2 = s.age / s.life
      s.spr.x = s.x
      s.spr.y = s.y
      s.spr.alpha = 1 - t2
      if (t2 >= 1) {
        rainLayer.removeChild(s.spr)
        s.spr.destroy()
        splashes.splice(i, 1)
      }
    }

    // 角色踩水：波纹 + 溅水粒子 + 湿脚音（判定用世界坐标，粒子画在屏幕坐标）
    // 跳在空中不踩水
    const onWater = !air && isOnWater(hero.x, hero.y + 6)
    if (onWater && moving) {
      footAcc += dt
      if (footAcc > 0.13) {
        footAcc = 0
        const fs = w2s(hero.x, hero.y + 6)
        spawnRipple(fs.x, fs.y, 0.85)
        spawnSplash(fs.x + (Math.random() - 0.5) * 16, fs.y, 2)
      }
      if (Math.random() < dt * 4) audio.playWetStep()
    }
    if (onWater && !lastOnWater) audio.playWetStep()
    lastOnWater = onWater

    // 闪电：自动雷击 + 电弧闪烁 + 全屏闪光
    if (rainOn) {
      nextStrike -= dt
      if (nextStrike <= 0) {
        nextStrike = 6 + Math.random() * 9
        strikeLightning(W * (0.12 + Math.random() * 0.76), H * (0.25 + Math.random() * 0.6))
      }
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i]
      b.age += dt
      const u = b.age / b.life
      if (u >= 1) {
        boltLayer.removeChild(b.g)
        b.g.destroy()
        bolts.splice(i, 1)
        continue
      }
      // 二次回击式闪烁
      b.g.alpha = (1 - u) * (0.55 + 0.45 * Math.abs(Math.sin((b.age + b.seed) * 60)))
    }
    if (flashT > 0) {
      flashT -= dt
      const u = Math.max(0, flashT / 0.34)
      flash.alpha = u * u * (0.28 + 0.1 * Math.sin(time * 90))
    } else {
      flash.alpha = 0
    }

    // 火焰：强度先起后衰（雨里慢慢熄灭），扑灭后焦痕再淡出
    for (let i = fires.length - 1; i >= 0; i--) {
      const f = fires[i]
      f.age += dt
      const ramp = Math.min(1, f.age / 0.35)
      const decay = 1 - smooth(clamp((f.age / f.dur - 0.45) / 0.55, 0, 1))
      const I = ramp * decay
      if (I > 0.02) {
        f.acc += dt * (6 + 22 * I)
        while (f.acc >= 1) {
          f.acc -= 1
          spawnFlame(f.c, I)
        }
        if (Math.random() < dt * 6 * I) spawnEmber(f.c, (Math.random() - 0.5) * 16, -8, I)
      }
      // 烟：火势中后段变浓，熄灭时冒最后几股
      f.smokeAcc += dt * (2 + 6 * (1 - I) * (I > 0.02 ? 1 : 0))
      while (f.smokeAcc >= 1) {
        f.smokeAcc -= 1
        if (f.age < f.dur + 0.8) {
          const fsm = w2s(f.x, f.y)
          spawnSmoke(fsm.x + (Math.random() - 0.5) * 20, fsm.y, 0.2 + 0.15 * (1 - I))
        }
      }
      // 火焰是立牌：世界坐标 → 屏幕位置，随摄像机旋转缩放
      const fp = w2s(f.x, f.y)
      f.c.x = fp.x
      f.c.y = fp.y
      f.c.scale.set(cam.zoom)
      f.rGlow.x = fp.x
      f.rGlow.y = fp.y
      const flick = 0.8 + 0.14 * Math.sin(time * 23 + f.seed) + 0.06 * Math.sin(time * 47 + f.seed * 3)
      f.glow.alpha = I * 0.55 * flick
      f.glow.scale.set((0.7 + 0.6 * I) * flick)
      f.rGlow.alpha = I * 0.4 * flick
      f.rGlow.scale.set((0.8 + 0.7 * I) * flick * cam.zoom)
      // 熄灭后：焦痕慢慢淡出，粒子走完才清理
      if (f.age > f.dur) {
        f.scorch.alpha = Math.max(0, 1 - (f.age - f.dur) / 14)
        const hasParts = fireParts.some((p) => p.spr.parent === f.c)
        if (f.scorch.alpha <= 0 && !hasParts) {
          objLayer.removeChild(f.c)
          f.c.destroy({ children: true })
          reflectLayer.removeChild(f.rGlow)
          f.rGlow.destroy()
          fires.splice(i, 1)
        }
      }
    }

    // 火焰/火星/烟粒子
    for (let i = fireParts.length - 1; i >= 0; i--) {
      const p = fireParts[i]
      p.age += dt
      const u = p.age / p.life
      if (u >= 1 || !p.spr.parent || p.spr._destroyed) {
        // 宿主容器 destroy({children:true}) 可能已连带销毁精灵，避免二次 destroy
        if (!p.spr._destroyed) {
          if (p.spr.parent) p.spr.parent.removeChild(p.spr)
          p.spr.destroy()
        }
        fireParts.splice(i, 1)
        continue
      }
      p.spr.x += p.vx * dt
      p.spr.y += p.vy * dt
      if (p.kind === 'flame') {
        p.vy -= 30 * dt // 热气加速上升
        p.spr.scale.set(p.sc0 * (1 - u * 0.75))
        p.spr.alpha = 1 - u * u
      } else if (p.kind === 'ember') {
        p.vy += 60 * dt
        p.vx *= 1 - dt * 1.5
        p.spr.alpha = 1 - u
      } else if (p.kind === 'ki') {
        // 能量粒子：缓慢收缩，线性淡出
        p.spr.scale.set(p.sc0 * (1 - u * 0.55))
        p.spr.alpha = p.a0 * (1 - u)
      } else if (p.kind === 'rock') {
        // 岩块：重力砸回地面，落地前不透明
        p.vy += 980 * dt
        p.vx *= 1 - dt * 0.8
        p.spr.alpha = u > 0.75 ? p.a0 * (1 - u) * 4 : p.a0
      } else if (p.kind === 'dust') {
        // 贴地尘环：横扫减速、膨胀、淡出
        p.vx *= 1 - dt * 2.4
        p.vy *= 1 - dt * 2.4
        p.spr.scale.set(p.sc0 * (1 + u * 2.2))
        p.spr.alpha = p.a0 * (1 - u)
      } else {
        // smoke：变大变淡，被风微吹
        p.vx += dt * 6
        p.spr.scale.set(p.sc0 * (1 + u * 1.6))
        p.spr.alpha = p.a0 * (1 - u)
      }
    }

    // 弹坑：世界坐标重投影（俯角压扁），最后 5 秒淡出
    for (let i = craters.length - 1; i >= 0; i--) {
      const c = craters[i]
      c.age += dt
      if (c.age >= c.dur) {
        objLayer.removeChild(c.g)
        c.g.destroy()
        craters.splice(i, 1)
        continue
      }
      const p = w2s(c.x, c.y)
      c.g.x = p.x
      c.g.y = p.y
      c.g.scale.set(cam.zoom, cam.zoom * 0.55)
      c.g.alpha = Math.min(1, (c.dur - c.age) / 5)
    }

    // 脚印：老化（下雪时被新雪盖回）+ 投影渲进踩踏 RT
    for (let i = footprints.length - 1; i >= 0; i--) {
      const f = footprints[i]
      f.age += dt
      const life = snowOn ? 25 : 90
      const u = f.age / life
      if (u >= 1 || snowAmt <= 0.02) {
        trampleScene.removeChild(f.spr)
        f.spr.destroy()
        footprints.splice(i, 1)
        continue
      }
      const p = w2s(f.x, f.y)
      f.spr.x = p.x
      f.spr.y = p.y
      const s = (16 / 32) * cam.zoom
      f.spr.scale.set(s, s * 0.7)
      f.spr.rotation = f.ang + cam.rot
      f.spr.alpha = Math.min(1, (1 - u) * 2.5)
    }
    app.renderer.render(trampleClear, trampleRT, true)
    app.renderer.render(trampleScene, trampleRT, false)

    // 波纹粒子 → rippleRT
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]
      r.age += dt
      const u = r.age / r.life
      if (u >= 1) {
        rippleScene.removeChild(r.spr)
        r.spr.destroy()
        ripples.splice(i, 1)
        continue
      }
      const ease = 1 - (1 - u) * (1 - u)
      const rad = r.r0 + ease * r.rGrow
      r.spr.scale.set(rad / 40, (rad / 40) * 0.7)
      r.spr.alpha = Math.pow(1 - u, 1.3) * r.power
    }
    app.renderer.render(rippleClear, rippleRT, true)
    app.renderer.render(rippleScene, rippleRT, false)

    // 倒影 RT：真贴图翻转 + 骨骼倒影 + 天空
    app.renderer.render(reflectLayer, reflectRT, true)

    // 湿润：下雨渐深积水渐涨，停雨渐干
    wetness = clamp(wetness + (rainOn ? dt * 0.05 : -dt * 0.04), 0, 1)
    wetOverlay.alpha = wetness * 0.22
    waterFilter.uniforms.uCut = cutFor(wetness)
  })

  // 供自动化测试
  window.__forestDemo = {
    hero,
    setHero: (f) => hero.setCharacter(f),
    previewAnim: (n) => hero.preview(n),
    listHeroAnims: () => hero.listAnims(),
    playFx: (id) => playSeffectAtHero(id),
    playUlt: (id) => playSanim(id),
    target,
    isOnWater,
    puddleValueAt,
    getWetness: () => wetness,
    strikeLightning,
    cam,
    setCamera(rot, zoom) {
      cam.rot = rot
      if (zoom != null) cam.zoom = zoom
      cam.cos = Math.cos(cam.rot)
      cam.sin = Math.sin(cam.rot)
    },
    riverDepthAt,
    getLevel: () => level,
    setLevel(v) {
      levelBase = v
      tideAmp = 0 // 测试时锁定水位
    },
    getChunkCount: () => chunks.size,
    getPropCount: () => allProps.length,
    isSprinting: () => sprinting,
    isAirborne: () => !!air,
    getAir: () => (air ? { z: air.z, vz: air.vz, jumps: air.jumps } : null),
    jump: doJump,
    fx,
    getFxNow: () => ({ ...fxNow, shockAmp: shock.amp }),
    ki: {
      start: startKiCharge,
      release: releaseKi,
      isCharging: () => !!kiCharge,
      setCharge(t) {
        if (kiCharge) kiCharge.t = t
      },
      count: () => kiBeams.length,
      setCam(v) {
        kiCamOn = !!v
      },
      isCamOn: () => kiCamOn,
    },
    setSnow(v) {
      snowOn = v > 0
      snowAmt = v
      if (snowOn) rainOn = false
    },
  }
}

function blocked(x, y, trees) {
  for (const t of trees) {
    const dx = x - t.x
    const dy = y - t.y
    if (dx * dx + dy * dy < t.trunkR * t.trunkR) return true
  }
  return false
}

/**
 * 主角骨骼动画（乐琳，juese/dongwushuang）
 *
 * 倒影：独立第二个 Spine 实例（同一份 spineData），动画同步播放，
 * scale.y 取负——与树倒影同一原理，"贴图克隆"换成"骨骼实例克隆"。
 */
async function createHeroSpine(x, y) {
  await loadPixiSpine().catch(() => null)
  const Spine = getSpineClass()
  const cast = CAST.lelin
  const base = `${RES.juese}/${cast.folder}/${cast.folder}`
  const spineData = await loadSpineData(base)
  const targetH = humanHeightPx()
  const nativeLeft = cast.nativeFace !== 'right'

  const view = new PIXI.Container()
  view.x = x
  view.y = y

  const shadow = new PIXI.Graphics()
  shadow.beginFill(0x000000, 0.32)
  shadow.drawEllipse(0, 3, 22, 8)
  shadow.endFill()
  view.addChild(shadow)

  let spine = null
  let reflSpine = null
  let fallbackG = null
  let unitScale = targetH / 400

  if (spineData && Spine) {
    spine = new Spine(spineData)
    spine.autoUpdate = false
    const nativeH = measureSpineNativeHeight(spine, targetH)
    unitScale = unitScaleFromNative(nativeH, targetH, cast.nativeH)
    view.addChild(spine)

    reflSpine = new Spine(spineData)
    reflSpine.autoUpdate = false
    reflSpine.alpha = 0.55
  } else {
    console.warn('[forestDemo] lelin spine 加载失败，占位方块顶替')
    fallbackG = new PIXI.Graphics()
    fallbackG.beginFill(0xd8863c)
    fallbackG.drawRoundedRect(-12, -46, 24, 40, 6)
    fallbackG.endFill()
    fallbackG.beginFill(0xf2dcb8)
    fallbackG.drawCircle(0, -54, 12)
    fallbackG.endFill()
    view.addChild(fallbackG)
  }

  let face = 'right'
  let curSize = cast.size != null ? cast.size : 1
  function applyFacing() {
    const wantLeft = face === 'left'
    const sign = wantLeft === nativeLeft ? 1 : -1
    const s = unitScale * curSize
    if (spine) {
      spine.scale.x = sign * s
      spine.scale.y = s
    }
    if (reflSpine) {
      reflSpine.scale.x = sign * s
      reflSpine.scale.y = -s
    }
  }
  applyFacing()

  let currentAnim = null
  let previewUntil = 0 // 技能预览播放期间，移动动画不许抢台
  function playAnim(alias, loop = true) {
    if (!spine || !spine.state) return
    if (performance.now() < previewUntil) return
    const name = pickAnim(spine, ANIM_ALIASES[alias] || [alias])
    if (!name || name === currentAnim) return
    currentAnim = name
    try {
      spine.state.setAnimation(0, name, loop)
      if (reflSpine && reflSpine.state) reflSpine.state.setAnimation(0, name, loop)
    } catch (e) {
      void e
    }
  }
  playAnim('idle', true)

  /** 按原始动画名播一遍（技能预览用），播完自动接回待机 */
  function preview(name) {
    if (!spine || !spine.state || !spine.spineData) return
    const anim = spine.spineData.animations.find((a) => a.name === name)
    if (!anim) return
    currentAnim = name
    previewUntil = performance.now() + anim.duration * 1000 + 80
    try {
      spine.state.setAnimation(0, name, false)
      if (reflSpine && reflSpine.state) reflSpine.state.setAnimation(0, name, false)
      const idleName = pickAnim(spine, ANIM_ALIASES.idle)
      if (idleName) {
        spine.state.addAnimation(0, idleName, true, 0)
        if (reflSpine && reflSpine.state) reflSpine.state.addAnimation(0, idleName, true, 0)
      }
    } catch (e) {
      void e
    }
  }

  /** 运行时换角色骨骼：卸旧 Spine、装新的、按身高重新定标 */
  async function setCharacter(folder) {
    const Spine2 = getSpineClass()
    const data = await loadSpineData(`${RES.juese}/${folder}/${folder}`)
    if (!data || !Spine2) return false
    if (spine) {
      view.removeChild(spine)
      spine.destroy()
    }
    if (reflSpine) {
      if (reflSpine.parent) reflSpine.parent.removeChild(reflSpine)
      reflSpine.destroy()
    }
    if (fallbackG) {
      view.removeChild(fallbackG)
      fallbackG.destroy()
      fallbackG = null
    }
    spine = new Spine2(data)
    spine.autoUpdate = false
    view.addChild(spine)
    reflSpine = new Spine2(data)
    reflSpine.autoUpdate = false
    reflSpine.alpha = 0.55
    const nativeH = measureSpineNativeHeight(spine, targetH)
    unitScale = unitScaleFromNative(nativeH, targetH, null)
    curSize = 1
    applyFacing()
    currentAnim = null
    previewUntil = 0
    playAnim('idle', true)
    return true
  }

  return {
    view,
    x,
    y,
    get spine() {
      return spine
    },
    get reflSpine() {
      return reflSpine
    },
    get face() {
      return face
    },
    setFace(f) {
      if (f !== face) {
        face = f
        applyFacing()
      }
    },
    playAnim,
    preview,
    setCharacter,
    listAnims() {
      if (!spine || !spine.spineData) return []
      return spine.spineData.animations.map((a) => ({ name: a.name, duration: a.duration }))
    },
    /** 跳跃离地高度：身体上移，影子留在地面缩小变淡 */
    setLift(z) {
      const body = spine || fallbackG
      if (body) body.y = -z
      const k = 1 / (1 + z * 0.0035)
      shadow.scale.set(k)
      shadow.alpha = 0.32 * k
    },
  }
}

function loadSpineData(baseWithoutExt) {
  const skel = `${baseWithoutExt}.skel`
  const json = `${baseWithoutExt}.json`
  const key = `spine_forest_demo_${Date.now()}`
  const tryLoad = (url) =>
    new Promise((resolve) => {
      const loader = new PIXI.Loader()
      loader.add(key, url).load((_, resources) => {
        const r = resources[key]
        resolve((r && r.spineData) || null)
      })
      loader.onError.add(() => resolve(null))
    })
  return tryLoad(skel).then(async (data) => data || (await tryLoad(json)))
}

// ─────────────────────────────────────────────
// 纹理生成
// ─────────────────────────────────────────────
/**
 * 造波噪声：R = 平铺 fbm（积水形状），G/B = 独立噪声（扰动/扫波）
 * CPU 保留 R 通道数据，保证 isOnWater 与 shader 判定一致
 */
function makeWaveNoise(size) {
  const rand = mulberry32(4021)
  const octaves = [
    { freq: 4, amp: 1.0 },
    { freq: 8, amp: 0.5 },
    { freq: 16, amp: 0.25 },
    { freq: 32, amp: 0.125 },
  ]
  const grids = octaves.map((o) => {
    const g = new Float32Array(o.freq * o.freq)
    for (let i = 0; i < g.length; i++) g[i] = rand()
    return g
  })
  const sampleOct = (u, v, oct, grid) => {
    const f = oct.freq
    const x = (((u % 1) + 1) % 1) * f
    const y = (((v % 1) + 1) % 1) * f
    const x0 = Math.floor(x) % f
    const y0 = Math.floor(y) % f
    const x1 = (x0 + 1) % f
    const y1 = (y0 + 1) % f
    const fx = smooth(x - Math.floor(x))
    const fy = smooth(y - Math.floor(y))
    const a = grid[y0 * f + x0]
    const b = grid[y0 * f + x1]
    const c = grid[y1 * f + x0]
    const d = grid[y1 * f + x1]
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy)
  }
  const fbm = (u, v) => {
    let s = 0
    let norm = 0
    for (let i = 0; i < octaves.length; i++) {
      s += sampleOct(u, v, octaves[i], grids[i]) * octaves[i].amp
      norm += octaves[i].amp
    }
    return s / norm
  }

  const dataR = new Float32Array(size * size)
  let mn = 1
  let mx = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = fbm(x / size, y / size)
      dataR[y * size + x] = v
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
  }
  const inv = 1 / (mx - mn)
  for (let i = 0; i < dataR.length; i++) dataR[i] = (dataR[i] - mn) * inv

  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      img.data[i] = dataR[y * size + x] * 255
      img.data[i + 1] = fbm((x / size + 0.37) % 1, (y / size + 0.71) % 1) * 255
      img.data[i + 2] = fbm((x / size + 0.64) % 1, (y / size + 0.18) % 1) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const texture = PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.LINEAR })
  texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT
  texture.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF

  const sampleR = (u, v) => {
    const x = (((u % 1) + 1) % 1) * size - 0.5
    const y = (((v % 1) + 1) % 1) * size - 0.5
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const xi0 = ((x0 % size) + size) % size
    const yi0 = ((y0 % size) + size) % size
    const xi1 = (xi0 + 1) % size
    const yi1 = (yi0 + 1) % size
    const a = dataR[yi0 * size + xi0]
    const b = dataR[yi0 * size + xi1]
    const cc = dataR[yi1 * size + xi0]
    const d = dataR[yi1 * size + xi1]
    return lerp(lerp(a, b, fx), lerp(cc, d, fx), fy)
  }
  return { texture, sampleR }
}

/**
 * 从不透明的 LPC 水塘贴图里按颜色抠出水面像素：
 * 蓝 > 红 且蓝不明显弱于绿（排除棕色岸和绿色草地）
 * 返回 mask 纹理（白=水）+ CPU 判定函数
 */
function makePondWaterMask(baseTexture, rect) {
  const w = rect.width
  const h = rect.height
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  const src = baseTexture.resource && baseTexture.resource.source
  const flags = new Uint8Array(w * h)
  if (src) {
    ctx.drawImage(src, -rect.x, -rect.y)
    const img = ctx.getImageData(0, 0, w, h)
    const out = ctx.createImageData(w, h)
    for (let i = 0; i < w * h; i++) {
      const r = img.data[i * 4]
      const g = img.data[i * 4 + 1]
      const b = img.data[i * 4 + 2]
      const a = img.data[i * 4 + 3]
      const isWater = a > 100 && b > r + 10 && b > g - 8
      flags[i] = isWater ? 1 : 0
      out.data[i * 4] = 255
      out.data[i * 4 + 1] = 255
      out.data[i * 4 + 2] = 255
      out.data[i * 4 + 3] = isWater ? 255 : 0
    }
    ctx.putImageData(out, 0, 0)
  }
  const texture = PIXI.Texture.from(c)
  return {
    texture,
    at(u, v) {
      const x = clamp(Math.floor(u * w), 0, w - 1)
      const y = clamp(Math.floor(v * h), 0, h - 1)
      return flags[y * w + x] === 1
    },
  }
}

/**
 * 波纹环纹理：r=1（波强/白沫），gb=径向方向编码（0.5 中性），alpha=环形轮廓
 * 对应教程"红色水波纹 + 绿蓝通道水波纹"合成一张
 */
function makeRippleTexture(size) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const cx = size / 2
  const R0 = size * 0.32
  const sigma = size * 0.05
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cx
      const d = Math.hypot(dx, dy) || 1
      const p = Math.exp(-((d - R0) * (d - R0)) / (sigma * sigma))
      const i = (y * size + x) * 4
      img.data[i] = 255
      img.data[i + 1] = 128 + (dx / d) * 120
      img.data[i + 2] = 128 + (dy / d) * 120
      img.data[i + 3] = Math.min(255, p * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.LINEAR })
  tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF
  return tex
}

/** 软圆形渐变粒子：火焰/火星/烟通用（靠 tint/blend 区分） */
function makeFireParticleTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 16)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 32, 32)
  return PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.LINEAR })
}

/** 火光光晕（大半径橙色径向渐变，加色混合） */
function makeGlowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(128, 128, 4, 128, 128, 128)
  g.addColorStop(0, 'rgba(255,190,110,0.85)')
  g.addColorStop(0.35, 'rgba(255,130,50,0.38)')
  g.addColorStop(1, 'rgba(255,90,30,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  return PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.LINEAR })
}

function makeDropTexture() {
  const c = document.createElement('canvas')
  c.width = 6
  c.height = 20
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, 20)
  g.addColorStop(0, 'rgba(200,230,255,0)')
  g.addColorStop(0.4, 'rgba(200,230,255,0.75)')
  g.addColorStop(1, 'rgba(200,230,255,0.2)')
  ctx.fillStyle = g
  ctx.fillRect(1, 0, 4, 20)
  return PIXI.Texture.from(c)
}

function makeSplashTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 12
  const ctx = c.getContext('2d')
  ctx.fillStyle = 'rgba(220,240,255,0.9)'
  ctx.beginPath()
  ctx.arc(6, 6, 4, 0, Math.PI * 2)
  ctx.fill()
  return PIXI.Texture.from(c)
}

// ─────────────────────────────────────────────
// 音频
// ─────────────────────────────────────────────
class RainAudio {
  constructor() {
    this.ctx = null
    this._nodes = null
  }
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!this.ctx) this.ctx = new AC()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }
  startRainLoop() {
    this.unlock()
    if (!this.ctx || this._nodes) return
    const ctx = this.ctx
    const sr = ctx.sampleRate
    const n = sr * 2
    const buf = ctx.createBuffer(1, n, sr)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 4200
    bp.Q.value = 0.6
    const g = ctx.createGain()
    g.gain.value = 0.12
    src.connect(bp)
    bp.connect(g)
    g.connect(ctx.destination)
    src.start()
    this._nodes = { src, g }
  }
  stopRainLoop() {
    if (!this._nodes) return
    try {
      this._nodes.src.stop()
    } catch (e) {
      void e
    }
    this._nodes = null
  }
  /** 雷声：先脆响后低频轰隆，delay 模拟距离 */
  playThunder(delay = 0.15) {
    this.unlock()
    if (!this.ctx) return
    const ctx = this.ctx
    const t0 = ctx.currentTime + delay
    const sr = ctx.sampleRate

    // 开裂脆响
    const n1 = Math.floor(sr * 0.09)
    const b1 = ctx.createBuffer(1, n1, sr)
    const d1 = b1.getChannelData(0)
    for (let i = 0; i < n1; i++) {
      const e = 1 - i / n1
      d1[i] = (Math.random() * 2 - 1) * e * e * e
    }
    const s1 = ctx.createBufferSource()
    s1.buffer = b1
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2400
    bp.Q.value = 0.8
    const g1 = ctx.createGain()
    g1.gain.value = 0.22
    s1.connect(bp)
    bp.connect(g1)
    g1.connect(ctx.destination)
    s1.start(t0)

    // 低频轰隆（慢起、长衰减、带滚动感）
    const dur = 2.6
    const n2 = Math.floor(sr * dur)
    const b2 = ctx.createBuffer(1, n2, sr)
    const d2 = b2.getChannelData(0)
    for (let i = 0; i < n2; i++) {
      const t = i / sr
      const attack = Math.min(1, t / 0.06)
      const env = attack * Math.exp(-t * 1.5) * (0.72 + 0.28 * Math.sin(t * 9 + Math.sin(t * 3.7) * 2))
      d2[i] = (Math.random() * 2 - 1) * env
    }
    const s2 = ctx.createBufferSource()
    s2.buffer = b2
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 170
    const g2 = ctx.createGain()
    g2.gain.value = 0.6
    s2.connect(lp)
    lp.connect(g2)
    g2.connect(ctx.destination)
    s2.start(t0 + 0.04)
  }

  /** 起跳：短促轻快的"哔"，二段跳音调略高 */
  playJump(second = false) {
    this.unlock()
    if (!this.ctx) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    const f0 = second ? 420 : 300
    osc.frequency.setValueAtTime(f0, t0)
    osc.frequency.exponentialRampToValueAtTime(f0 * 1.5, t0 + 0.08)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.14, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15)
    osc.connect(g)
    g.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + 0.17)
  }

  /** 气功波蓄力：低鸣上扫的嗡嗡声，返回停止函数（松开时调用） */
  playKiCharge() {
    this.unlock()
    if (!this.ctx) return null
    const ctx = this.ctx
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(65, t0)
    osc.frequency.linearRampToValueAtTime(230, t0 + 1.4)
    // 轻微颤音：能量不稳定的感觉
    const vib = ctx.createOscillator()
    vib.frequency.value = 9
    const vibG = ctx.createGain()
    vibG.gain.value = 6
    vib.connect(vibG)
    vibG.connect(osc.frequency)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(420, t0)
    lp.frequency.linearRampToValueAtTime(1600, t0 + 1.4)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.11, t0 + 0.22)
    osc.connect(lp)
    lp.connect(g)
    g.connect(ctx.destination)
    osc.start(t0)
    vib.start(t0)
    return () => {
      const t = ctx.currentTime
      g.gain.cancelScheduledValues(t)
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
      osc.stop(t + 0.1)
      vib.stop(t + 0.1)
    }
  }

  /** 光束持续声：噪声咆哮 + 低频锯齿嗡鸣，返回停止函数 */
  playKiBeam(power = 1) {
    this.unlock()
    if (!this.ctx) return null
    const ctx = this.ctx
    const t0 = ctx.currentTime
    const sr = ctx.sampleRate
    const n = sr * 1
    const buf = ctx.createBuffer(1, n, sr)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 900 + power * 500
    bp.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.09 + 0.08 * power, t0 + 0.05)
    src.connect(bp)
    bp.connect(g)
    g.connect(ctx.destination)
    src.start(t0)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = 82
    const lp2 = ctx.createBiquadFilter()
    lp2.type = 'lowpass'
    lp2.frequency.value = 260
    const g2 = ctx.createGain()
    g2.gain.setValueAtTime(0.0001, t0)
    g2.gain.exponentialRampToValueAtTime(0.07 + 0.05 * power, t0 + 0.05)
    osc.connect(lp2)
    lp2.connect(g2)
    g2.connect(ctx.destination)
    osc.start(t0)
    return () => {
      const t = ctx.currentTime
      for (const gg of [g, g2]) {
        gg.gain.cancelScheduledValues(t)
        gg.gain.setValueAtTime(Math.max(gg.gain.value, 0.0001), t)
        gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
      }
      src.stop(t + 0.15)
      osc.stop(t + 0.15)
    }
  }

  /** 气功波发射：噪声"嗖" + 能量音骤降 */
  playKiFire(power = 1) {
    this.unlock()
    if (!this.ctx) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    const sr = ctx.sampleRate
    const n = Math.floor(sr * 0.35)
    const buf = ctx.createBuffer(1, n, sr)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) {
      const e = 1 - i / n
      data[i] = (Math.random() * 2 - 1) * e
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(2600, t0)
    bp.frequency.exponentialRampToValueAtTime(480, t0 + 0.3)
    bp.Q.value = 1.1
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.15 + 0.13 * power, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35)
    src.connect(bp)
    bp.connect(g)
    g.connect(ctx.destination)
    src.start(t0)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(540, t0)
    osc.frequency.exponentialRampToValueAtTime(130, t0 + 0.28)
    const g2 = ctx.createGain()
    g2.gain.setValueAtTime(0.11, t0)
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3)
    osc.connect(g2)
    g2.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + 0.32)
  }

  /** 落地闷响 */
  playThud() {
    this.unlock()
    if (!this.ctx) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    const sr = ctx.sampleRate
    const n = Math.floor(sr * 0.14)
    const buf = ctx.createBuffer(1, n, sr)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) {
      const e = 1 - i / n
      data[i] = (Math.random() * 2 - 1) * e * e * e
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 240
    const g = ctx.createGain()
    g.gain.value = 0.5
    src.connect(lp)
    lp.connect(g)
    g.connect(ctx.destination)
    src.start(t0)
  }

  playWetStep() {
    this.unlock()
    if (!this.ctx) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    const sr = ctx.sampleRate
    const n = Math.floor(sr * 0.1)
    const buf = ctx.createBuffer(1, n, sr)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) {
      const e = 1 - i / n
      data[i] = (Math.random() * 2 - 1) * e * e
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'lowpass'
    bp.frequency.value = 900
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.2, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1)
    src.connect(bp)
    bp.connect(g)
    g.connect(ctx.destination)
    src.start(t0)
  }
}

// ─────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v))
}
function polyline(g, pts) {
  g.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y)
}
function lerp(a, b, t) {
  return a + (b - a) * t
}
function smooth(t) {
  return t * t * (3 - 2 * t)
}
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

main().catch((err) => {
  console.error(err)
  const hud = document.getElementById('hud')
  if (hud) hud.innerHTML = `<b style="color:#e07070">Demo 启动失败</b><br/>${err?.message || err}`
})
