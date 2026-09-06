# noita-map · Noita 地图模块(原版算法复刻,可整体移植)

目标:把 Noita 的地图生成从 `pixelDemo.js` 那种"低配仿制"里拆出来,做成**和原版逐像素一致**、
零 DOM 依赖、按 512×512 区块流式生成的独立模块,能直接搬到手机(Cocos / 小游戏 / WebView)。

查看器:`http://localhost:5177/noita-map.html`(默认种子 = 存档真值种子,可逐像素对照)。可玩原型:`noita-play.html`。

> **接手 / 续做**:进度、下一步(第 6 步开头的"下一个要做的"清单)、跑/测/部署流程、代码地图都在 `docs/noita-entities-plan.md` 的"接手指南"一节;
> 本文档是各子系统的实现细节表。原版数据 `noita-ref/unpacked/`,存档真值 `noita-ref/save-truth/`。

## 分层

```
src/noita-map/
  core/                 纯算法,只依赖 TypedArray,可跑在 Worker / 手机 JS 引擎
    NollaPrng.js        原版随机数(MINSTD + SetRandomSeed(x,y) 位置派生)——所有随机的根
    png.js              精确 PNG 解码器(不走 <img>,避免浏览器色彩管理改掉 wang 色)
    stbhw.js            人字形 wang 砖(stbhw_generate_image corner 模式,逐行对应)
    biomeHacks.js       房间封锁 / 主群系入口 / 煤矿外框叠加层 / 顶→底 BFS / 清主路 / 秘室掷骰 / 随机色
    wangLayer.js        一个群系区域 → wang RGB 层(播种→拼砖→修补→≤99 次重掷→收尾→1024 平铺→遮罩)
    coords.js           群系图 / chunk / wang / 世界 四套坐标互转(含 51+1 补像素、半格取整)
    biomes.js           群系注册表(_biomes_all.xml 色 → 名/砖/类型)+ 同色 4 连通区域
    scenes.js           wang 标记色 → spawn 函数 → LoadRandomPixelScene(ProceduralRandom 精确)
    staticScenes.js     整图布景群系的 init()(山体 10 张、圣山三层图)
    materials.js        materials.xml → 材质表(wang 色 → id、渲染色、贴图、种类)
    bands.js            白/灰 wang 像素 → 材质带(MaterialComponent 近似)
    noise.js            值噪声 / fbm(近似部分用)
  World.js              seed → 区域 → 层(懒)→ 布景 → 512×512 材质区块(懒 + LRU)   ← 对外 API
  assets.js             资源加载(浏览器实现;换 decodePng / fetch 即可跑在别的运行时)
  render/ChunkPainter.js Canvas2D 区块渲染(材质贴图按世界坐标取模 + 群系背景 + 布景手绘层 + 边缘明暗)
```

资源在 `public/res/noita/`,由 `node scripts/noita-prepare-assets.mjs` 从 `noita-ref/unpacked/`(data.wak 解包)生成:
`materials.json`、`wang/*.png`、`wang/extra_layers/coalmine.png`、`atlas/biome_map.png`、`scenes/<biome>/*.png`、`tex/*.png`、`bg/*.png`。

## 用法

```js
import { NoitaAssets, NoitaWorld, ChunkPainter } from './src/noita-map/index.js'

const assets = await new NoitaAssets({ base: '/res/noita' }).init()
const world = new NoitaWorld(assets, 1674172626)
await world.prepareChunk(36, 15)          // 保证砖库/布景 PNG 已加载,生成所属 wang 层(chunk 绝对坐标,世界 (0,0) 在 (35,14) 左上)
const chunk = world.getChunk(36, 15)      // 同步:{ mat: Uint16Array(512*512), scenes: [...], biome, layer }
// chunk.mat[y*512+x] 是材质 id(assets.materials.name(id) / kind / color / texture)

const painter = new ChunkPainter(assets)
await painter.prepare(chunk)
painter.paint(chunk, canvas512)
```

物理 / 落沙 / 光照都只依赖 `chunk.mat`,和渲染解耦。

## 验证(seed 1674172626,`noita-ref/save-truth/` 是真游戏存档解出来的 24 个区块)

| 项 | 结果 |
|---|---|
| 煤矿 wang 层 vs telescope 参考实现 | 布景清单逐个一致(名字、坐标、f0bbee 材质) |
| wang 层 实/空 vs 存档 | 单层 91.4%(剩余 = 边缘扰动 + 玩家挖掘 + 落沙) |
| 随机布景 10 张 vs 存档 `.world_pixel_scenes` | 10/10 坐标一致到像素;补齐了 telescope 漏掉的 2 张(见下) |
| 整图布景(山体 10 张 + 圣山 altar_top×5 / altar / altar_right / solid) | 位置全部一致,`altar_top_blood` 变体的 Random(1,50) 也对 |
| 区块耗时(桌面) | 生成 ~30ms + 渲染 ~10ms / 区块 |

跑对照:`node scripts/_noita-map-shot.mjs diff 500,600,1`(差异图,红=我们实/真值空,蓝=反)、
`node scripts/_noita-map-offset.mjs`(偏移搜索 + 白块材质分布)。

### 移植过程里推翻的几条"常识"

1. **PNG 必须自己解**:`<img>`+canvas 会把叠加层的 `#000042`(强制开)读成别的色,煤矿入口井被封死 → 每次都 99 次重掷。
   telescope 也是因此自带 UPNG。`GEN-RULES.md §4.3` 里"顶部两行封死"是被这个坑误导的,实际顶部有一条 `#000042` 漏斗入口(x 143~157)。
2. **世界像素 → wang 像素是半格取整**:`floor((x+5)/10)` 不是 `floor(x/10)`,真值搜索 ±30px 得到 (+5,+5),一致率 82% → 91%。
3. **布景群系检查只看左上角**:telescope 的"四角同群系"会漏掉 `oiltank_2@1425,467`(右上角在 mountain_right_stub)和
   `coalpit03@-265,857`(下半截伸进圣山),存档里两张都放了。
4. **山体不是"整图布景"**:`mountain_*.xml` 是 SIN_CAPPED_SIMPLEX 地形填充 + init() 盖图,圣山才是纯布景(底为空气)。

## 精确 vs 近似

精确(和游戏逐位一致):PRNG、wang 拼砖、重掷校验、秘室、随机布景选择与坐标、f0bbee 材质掷骰、整图布景位置、
wang 色 → 材质、布景材质层盖章。

- **wang 群系的材质带与砖边**(09-05 反 exe 后精确,`core/noitaNoise.js` + `bands.js` + `World._fillFromWang`):
  每格 → `wangJitter`(0x908cb0:simplex / 梯度 / 值噪声,置换表抠自 exe)→ wang 灰度位图 smoothstep 双线性得 c(0.5 = 边界)→ `materialValue`(0x908e70:c + simplex(20px,15.5px 值噪声扭曲)×5.08×((c−0.5)/2)²)
  → `BiomeMaterials::GetMaterial`(0x8f5030:按 material_index 升序,limit_y / [min,max) / add_perlin 叠 simplexD / 稀有过 polka(0x8fbe60)与 simplexD 门)。
  真值对照:煤矿 sand 连续段 8.9/6.4 vs 真值 8.6/6.3、rock_wet 10.4/7.9 vs 10.1/7.9;挖掘场 coal_static 26.5% vs 26.4%、rock_static_grey 段长 18.3/12.5 vs 18.7/12.6;
  逐像素材质一致率 煤矿 71~77% → 85~92%、挖掘场 74~79% → 96.7%。之前那套"同参数近似"斑块大 3 倍、沙 / 湿岩比例反了。统计脚本 `_noita-band-stats.mjs`。

近似(形状对、不逐位):
- **地表 / 山体材质带**(hills / mountain_* 这类 type-0 过程群系,`SURFACE_BANDS`):xml 参数照抄,原版是 0x90a860 的随机浮点位图 + mGradient 高度场 + 逐像素抖动混合(真值里 sand / rock_static 是 1~2px 的细麻点渐变,我们是大斑块),没反完。
  山体按真值 chunk(512,−512) 校到 rock_static 103k / rock_hard 73k(真值 102k / 73k);stub 两头 sand 带拉深到 1.12。
- **草**(soil/sand 顶面 83%):引擎的 rand_seed 不可复现,按真值目测。
- **地表高度场**(`World._surfaceHeight`):原作 SIN_CAPPED_SIMPLEX 不可复现,用存档真值剖面(x∈[−1024,0]∪[1536,2048])拟合
  平滑值噪声(`scripts/_fit-surface.mjs`:格距 330px、峰 −121 / 谷 +114、rms 16px,实心一致 98%+),默认种子用拟合参数,其他种子同分布。
  **两条硬约束**:① 没有碎尖——之前 4 倍频 4 层 fbm 出来的三角尖是错的,原作一座山一个谷;② **全域最陡 ≤0.85(40°)**——soil/grass 是落沙,
  45° 以上会被元胞自动机塌成 45° 三角堆(用户截图里的"金字塔"就是这么来的),真值最陡 ≈0.9,拟合时按此约束搜。
  材质带按群系(`SURFACE_BANDS`,照各 biome xml MaterialComponent):hills/mountain_tree soil→sand_static→rock_static(0.9~0.95 互嵌,交界贴煤层);
  winter snow_static→snowrock_static(起伏 ×0.7);desert sand_surface→sandstone_surface→sand_static_bright→sand_static→rock_static(×0.43);
  群系交界处起伏倍率按 chunk 中心 smoothstep 过渡。
- **地表洞**(`World._carveSurfaceCaves`,hills.xml BitmapCaves surface_cave):按 1536px 一段掷 0~2 张嘴(原作 7~12 张撒在整片丘陵),
  嘴在地表+1,朝下蠕虫(圆盘 r 10~17 × rand(0.65,1.15),转向 ±0.55、0.12 回正,分 2~7 叉,子洞 0.45/0.72 折),到煤矿边界停;
  山体两侧 x∈(−1100,2100) 不开口(真值该段无洞)。位置 NollaPrng(seed, 段号) 确定。
- **挖掘场 / 雪窟材质带**(第 6 步):xml 里 `material_index` 不同的材质各走一路噪声(`bands.js` 带上 `noise: 2` 走第二路),稀有材质带 `vMin/vMax`(xml material_min/max:只在基带噪声落在该区间才有机会)。
  挖掘场 coal_static / rock_static_grey 阈值与 gold 密度按真值 chunk(512,1536)(−1536,1536) 校准(coal_static 57~63%);雪窟没有真值,按 xml 区间 + 兜底 snowrock。
- **背景贴图**(`LoadBackgroundSprite`,挖掘场的塔 / 横梁 / 机械):布景条目 `bgSprite:true, z`,`World.stamp` 不进材质,`ChunkPainter` 在群系背景墙之后按 z 倒序画、再画布景 `_background`。
  PixelSprite props(煤矿木架 / 丛林树 / 金库机器,`scenes.js PIXEL_SPRITES`)也走这条:生成点 → 减 anchor → bgSprite(z 30);原作这些是可打可烧的像素,这里只画。
- `SPLICED_SCENES` 还收了 `_pixel_scenes.xml` 的 `<BackgroundImages>`(hidden/ 提示文字条、liquidcave 顶盖,`bgSprite`)和 `<mBufferedPixelScenes>` 的 skip_biome_checks 整图(圣山胶囊 / 熔炉 / 眼斑 / 塔起点)。
- **群系边缘噪声**(`noise_biome_edges`,`World._bleedSurfaceEdges`):两边都在 `NOISE_EDGE_BIOMES` 的 surface↔wang 交界(右桩↔煤矿),地形一侧按值噪声漫进砖群系 0~26px(真值 chunk(1536,512) 顶目测)。
- 未做:藤/蘑菇等植被实体、
  主线以外群系(liquidcave / wizardcave / robobase / meat / wandcave / pyramid / sandcave / the_end …)的 spawn 表与布景池(结构已留好,按各 biome lua 填表即可,流程见 `docs/noita-entities-plan.md` 第 6 步)。
  已填(全部):coalmine / coalmine_alt / excavationsite / fungicave / snowcave / snowcastle / rainforest / vault / crypt / liquidcave / wandcave / pyramid(外壳 pyramid_* 是 scene 群系,`STATIC_SCENE_INIT`)/
  sandcave / meat / robobase / the_end / wizardcave。布景条目可带 `dir`(pyramid / the_end 借 crypt 图、sandcave 借 snowcastle 图);`SPAWN_FUNCS` 第 6 项 `jitter` = lua 里 SetRandomSeed 后 Random(−j,j) 挪位(meat spawn_mouth)。
- 布景条目可带 `visual` / `bgName` / `matName`(手绘层 / 背景层 / 材质图与 name 不同名时;雪城堡 paneling_wall 配 7 张背景就是靶这个),`''` 表示明确没有该层。
  lua 里定义成空函数的默认色(fungicave 的 spawn_lamp 等)记在 `EMPTY_FUNCS`,只算标记不出东西。光源按群系查 `LAMP` 表(g_lamp 的空/灯权重、偏移、kind:lantern / tubelamp / torchstand / torch;`lamp2` 是 spawn_lamp2 的另一张表)。
                     `animals/<子目录>/<名>`(rainforest / vault / crypt 的强化版、lukki/ 蜘蛛)实体键带目录前缀(`entKey()`,prepare 脚本同规则),和普通版不混。lifetime=0 的 `*_static` 气(acid_gas_static)在 CellSim 里不飘不散。

## 性能:怎么测"手机上卡不卡"

"卡"拆成两个可量化的东西:**主线程帧时间**(掉帧)和 **区块到达延迟**(相机移过去看到黑洞)。
模块里已经内置了测法:

1. **Worker 生成**(`worker/mapWorker.js` + `worker/WorldClient.js`):生成 + 渲染全在 Worker,主线程只 `drawImage(ImageBitmap)`。
   这是不卡的根本手段——查看器里"Worker 生成"勾选即开,默认开。
2. **跑分按钮**:相机沿煤矿自动蛇形巡航(不停进入新区块 = 最坏情况),记录每帧间隔、每区块到达延迟、"黑洞帧"占比,
   结果显示在面板并挂到 `window.__nm.bench`,"复制跑分 JSON" 可直接贴给别人。判据:帧 p95 ≤ 33ms、无 >100ms 长帧、黑洞帧 <3% → 流畅。
3. **桌面模拟手机**:`node scripts/noita-map-bench.mjs [CPU倍率] [秒] [1|0|both]`,用 Chromium CPU 降频 + 390×844@3x 手机视口。
   ×4 ≈ 中端安卓,×6 ≈ 低端/老机。
4. **真机**:`npx vite --host`,手机同一 WiFi 打开 `http://<本机IP>:5177/noita-map.html`,点"跑分"。
   iOS 用 Safari 连 Mac 的 Web Inspector、安卓用 `chrome://inspect` 可以看 Performance 面板;没有电脑时看面板里的结论即可。
   加 URL 参数自动跑:`?bench=20&worker=1`。

CPU×4/×6 模拟结果(15s 巡航):

| 模式 | 帧 p95 / max | >100ms 长帧 | 黑洞帧 | 区块到达 p50 / p95 | 结论 |
|---|---|---|---|---|---|
| 主线程生成 ×4 | 17 / 316 ms | 8 | 0.5% | 98 / 1880 ms | 卡 |
| Worker + 预取 ×4 | 16.8 / 17.9 ms | 0 | 0% | 26 / 715 ms | 流畅 |
| Worker + 预取 ×6 | 16.8 / 33 ms | 0 | 0% | 22 / 208 ms | 流畅 |

区块到达 p95 里的几百毫秒是**第一次进入某群系**的一次性成本(砖库解码 + wang 层 + 布景 PNG 预载,`first_chunk_ms`);
稳态每块 worker 内生成 3~13ms、渲染 5ms。换成下面的 `ChunkStreamer` 后到达 p95 降到 53ms(×4)/ 63ms(×6)。

**iPhone 真机**(iOS 18,4 核,390×433 视口,20s 巡航,线上 `https://update.cocoaihj.com/updatesoft/noita/`):
60fps,帧 p50/p95 17ms、max 32ms、零 >100ms 长帧;区块到达 p50 31 / p95 53ms,Worker 内生成 ~15ms + 渲染 3~9ms;黑洞帧 2.9%(折返点)。
第一次真机跑出现过 LRU 抖动(20s 请求 1499 次、卸载 1406 次,桌面/无头 WebKit 都复现不出),已用"本帧需要的区块不卸 + 需要集超 cache 先砍预取"两层堵死,复测 59 次请求、0 卸载。

## 横版可玩原型 `noita-play.html`(`src/demo/noitaPlay.js`)

小巫师在这张原版精度的地图里走 / 飞 / 打洞 / 倒材质。横屏(竖屏出遮罩),一屏 427 世界像素宽(= Noita),
玩家碰撞盒 7×15,出生点 (227,-85) 山洞大厅。桌面 A/D W/空格 鼠标;手机左半摇杆(上推=跳/悬浮,和原版手柄一样不单设飞行键)右半瞄准摇杆开火,只留"换法杖"按钮。
线上:`https://update.cocoaihj.com/updatesoft/noita/noita-play.html`。
**自由模式**(默认开,`?free=0` 回经典规则):随处改法杖、背包里有整个可用法术库(165 张)、不扣法力 / 有限次数不减、每根杖至少 8 格、`spawn_requires_flag` 的法术也进池 —— 玩家要的是玩材质效果;手机隐藏调试栏与"上报日志"。

### 画面细节(为什么原版看着"细")——已补上的四层

| 层 | 来源 | 实现 |
|---|---|---|
| 材质描边 | `materials.xml <EdgeGraphics color percent>`(煤矿湿岩/砂岩是 `#233112` 深绿苔边) | `ChunkPainter`:与空气交界 1~2px 按 percent 概率换描边色,哈希决定,重画一致 |
| 植被贴图 | `biome/<名>.xml <VegetationComponent>`(丘陵云杉 tree_spruce_1~4 / 阔叶 tree_leaf / 灌木 bush_growth / 草丛 grass_patch / 垂藤 vine_growth / 气根 aerial_root / 蘑菇)→ `biomes.json` | 落点由 `World._vegAnchors` 算成 `chunk.decor`(kind `veg`),painter 只贴:按 `tree_width` 分格、`tree_probability` 掷,地面株放在 `material_on_top_of` 表面,`is_ceiling_plant` 挂洞顶;`tree_extra_y` 往地里压(云杉 14 / 阔叶 25,树根埋进土);.xml Sprite 取最后一帧。**跨 chunk**:本 chunk 还会算下一 chunk 顶部 140 行内地表长出来的株(下一块已生成用其材质,纯丘陵按解析地表 `_surfaceMatAt`),树在 chunk 缝上不再被切半;下一块后生成且有伸上来的(`spillUp`)→ streamer 补重画上一块。**`is_visual=0` 的(树 / 大小蘑菇 / 仙人掌)照原版 PixelSprite:实心像素在生成时烙进材质格(`tree_material` wood_loose / fungus_loose / cactus,`World._stampVeg`),子弹打得中、火烧得着、爆炸炸掉一块少一块;painter 只画材质还在的像素;落点只算一次(重画 / 存档都带 veg 落点回 Worker);主线程 `Vegetation.js` 做 SimplePhysics —— 脚下全空整株按 400 px/s² 竖直掉、落地烙回去。`is_visual=1`(灌木 / 草 / 藤)纯贴图不动 |
| 全局固定布景 `SPLICED_SCENES` | `biome/_pixel_scenes.xml <PixelSceneFiles>` → `biome_impl/spliced/*.xml`(skip_biome_checks);原作用 `_<名>.bat` 把整图切成 .plz 小块,xml 里是小块坐标,我们用整图 + .bat 原点 | 最左边的**巨树** `tree.png` 1024×2048 @ (−2048,−1324)(带 `_visual`/`_background`,wood_tree 材质、内有水潭),水洞 (−2048,0)、熔岩湖 (2048,0)、mountain_lake (2560,0)、沙漠骷髅 (7100,−100)、boss_arena、月亮…共 12 张;`staticScenesNear` 按包围盒并入,与 init 布景同一套盖章/背景/手绘层 |
| 光源 | wang 标记 `spawn_lamp`(g_lamp 0.7/1.1 出小灯笼)/ `spawn_candles` / `spawn_altar_torch`,位置 + ProceduralRandom 掷骰 | `collectLights` → 每 chunk 带 `lights`;带 `ent` 的(矿里的 `physics/lantern_small` 等)由 `Entities.spawnChunk` 按标记点放成真刚体(PhysicsJoint2 attach_to_nearby_surface 钉在最近的墙上,能打下来 / 碎 / 漏油起火,自带火苗帧与光);蜡烛 / 火把 / 圣山灯仍由 `noita-play` 画小图 + 光 |
| 光照 | `shaders/post_final.frag`:`lights = tex_lights×0.8 → ^1.5 → +glow → 加天光 → ^(1/2.2) → ×雾 + 探索过的暖灰(0.35×1.4×(0.6,0.5,0.45))`,只乘前景;光罩 `data/temp/light_mask_inv_pow22_smoothed_center.png`(64×64,峰 143/255),LightSystem 把它拉到 **宽 = radius**(真半径是一半);雾 FogOfWarRadius 256 / 32px 格;天光 RENDER_SKYLIGHT_* 从地表一行行渗 | `render/Lighting.js`:1/4 分辩率光图,所有 LightComponent 按 xml 半径 / 颜色(缺省 255,178,118)+ glow 格叠加 → `compose()` 逐像素套 shader 公式(雾 / 天光按 32px 格小数组双线性,0.5ms)→ multiply 到前景(天空 destination-over 垫在透明处不吃光);雾随存档 |
| 地表视差天空 `Sky.js` | `data/weather_gfx/parallax_*.png`(全是白蒙版)+ `parallax_colors.bmp`(美术色板:x = 一天 512 步,每 20 行一带:天空 / 地平线光带细线 / 云#1 #2 / 山#1 highlight+back / 山#2 / 风暴云 / 星 alpha);`magic_numbers` `DRAW_PARALLAX_BACKGROUND_BEFORE_DEPTH=512`、`DESIGN_DAY_CYCLE_SPEED=0.0015`;`shaders/sky_gradient.frag`(顶部 ×(0.5,0.55,0.7) 往下渐亮) | `noita-prepare-assets` 把色板压成 `sky/parallax_colors.png`(512×11,一行一带);运行时按时刻取列、`destination-in` 给蒙版上色(双色山拆两张 alpha 蒙版),相机深度 <512 才画;层位按原版开局截图标定(远山脊在出生地面上 ~40px 横贯左半屏);开局黄昏(0.31),一天 667s,`?tod=0..1` `?day=秒` 可调;整体校色 (0.8,0.86,1.0) 对齐截图 |
| 近景散件 `chunk.decor` | 静态布景图里的标记色 = lua `RegisterSpawnFunction`:`mountain_left_entrance` 的 `spawn_grass`(0xc4187c → `props/mountain_left_entrance_grass.xml` PixelSprite,anchor 198,40)、`spawn_vines`/`_b`(g_vines 按权重掷 15/17/8/6 节或空);`mountain_hall.lua init()` 里 9 条 `load_verlet_rope_*` 藤蔓坐标 | `staticScenes.js STATIC_DECOR_MARKS / STATIC_VINES / VINE_POOL` → `World._collectDecor`(扫一次缓存在布景对象上,只留碰到本 chunk 的)→ `ChunkPainter._paintDecor`:草丛整图直接贴;藤蔓按 verlet 静止形(单挂点垂下 / 双挂点抛物线,节距 4)沿路径贴 `vine_a.png` 4×3 帧并旋转。只画不进材质。未注册的标记(left_stub 里那粒 spawn_trees)照原版忽略 |
| 边缘印章 | `materials.xml <Edge><Images>`:`edge_rock_1~6.png` / `edge_sand_1~6.png`(20×16 斑块,透明底,允许随机旋转) | 沿材质/空气交界按 percent 密度、90° 随机旋转盖章,只盖同一材质——石头边上的浅色碎石斑、砂岩边的亮斑就是它;hor/ver 条纹图(木板/神殿砖线)待按边法向铺 |
| 背景分层 | 群系背景墙 + 布景 `_background.png`(圣山雕像柱廊、山洞大厅 hall_background、油罐后墙) | 位图改为三层合成:背景墙(平铺压暗)→ 布景背景 → 材质层(空气透明);山洞大厅内部不再透出天空 |
| 入水 | `player_base.xml`:`LiquidDisplacerComponent`(身体是液体的实体,重叠的液体被挤出)、`SpriteStainsComponent`(身上沾液体色、慢慢滴掉)、`GameEffect WET` 600 帧、`sound_underwater` 循环;`particles/gas_bubble`(向上加速 −200、最快 90);`post_final.frag ENABLE_REFRACTION`(液体像素采样偏 ±1px 晃) | `CellSim.setObstacle` 玩家碰撞盒对液体/沙是墙;每帧 `displaceLiquid` 把走进盒里的液体挪到盒外最近空格(先两侧后上方)→ 水面凹陷、涟漪;入水/蹿出一刻按速度把水面附近液体格掀成飞溅碎屑(画得比水体亮 +70,落回世界)+ `water` 声;头没进液体:嘴边冒气泡、master 低通到 420Hz + 水下噪声循环;WET 10s:精灵按液体色 source-atop 染一层(0.08+0.3·剩余)、身上不断滴粒子(只是粒子,不成像素,免得脚下全变泥);液体像素按行/列 sin/cos ±1px 晃动;弹丸扎进液体(不论穿不穿)也溅几粒 |

### 实体层 `Entities.js`(第 1 步:敌人 / 动物)—— 详见 `docs/noita-entities-plan.md`

- `scripts/noita-prepare-entities.mjs`:`entities/{animals,props}/*.xml` 递归合并 `<Base file>`(Base 块内覆盖、块外追加、子实体剔除)→ `entities.json`(41 条)+ `ent/` 贴图 193 张:
  Sprite xml 全部 RectAnimation、Hitbox、CharacterData/Platforming、DamageModel(hp/血/布娃娃/材质伤害表)、AnimalAI、GenomeData、PhysicsImageShape/Body、ExplodeOnDamage+config_explosion、MaterialInventory、Light、Worm/CellEater。
- **生成点**(`scenes.js collectSpawns`):wang 标记色 → `spawn_small_enemies / big / unique_enemy*/ fungi / props*`(每群系一张 `SPAWN_FUNCS` 表:表名 + lua 里的 dx/dy + rand_x/rand_y,
  coalmine 的小怪大怪走 `spawn_with_limited_random` rand 0、其他群系 `spawn()` 缺省 rand 4)→ lua 的 `g_*` 权重表(`_dump-spawn-tables.mjs` 真 lua 表解析抽出照抄,
  行尾 `extra {g:组, ng:NG+等级, xmas:圣诞限定}`)→ 逐行复刻 `director_helpers.lua`:`init_total_prob` / `random_from_table` 跳过 NG+ 不够与 spawn_check 的行(连 total 都不算),
  `entity_load_camera_bound`((x+5,y+5) 掷 min~max 只,第 i 只 ±rand;`entities` 组:第 j 项各掷数量、位置 (X+PR(X+j,Y+i), …));`spawnGate` 放各 lua 的门控
  (挖掘场按群系内纵向位置 `BiomeMapGetVerticalPositionInsideBiome`、雪窟 `safe()` 入口井不出怪、雪窟 spawn_props 10% 换雪人)。挂在 `chunk.spawns`,主线程首次拿到该 chunk 实例化一次。种子确定。
- **钉墙刚体**:`PhysicsJointComponent nail_to_wall`(挖掘场轮子)→ `RigidBody.nailed`:不受重力/碰撞/推动,按 `mMotorSpeed` 匀速转,永不入睡。
- **链 / 钉**(`RigidBody.ropes`):`chain_to_ceiling.lua` 的挂点往上找顶拴链、钉在边上的吊桶绕钉摆;位置式绳约束 + 沿绳冲量(含转动惯量),超 break_distance 或锚点被挖断链掉下;链只画不碰撞。多体机械 / 家具关节 / 门仍没做。
- **行走**:CharacterPlatforming 同玩家(pixel_gravity 600、run_velocity、accel_x、climb_over_y、buoyancy),1px 子步、碰撞盒四边逐像素判定(`_blocked`);
  跨障碍靠 PathFindingComponent:`can_jump` + `initial_jump_max_distance_x/y`(base_humanoid 100/60)限定跳边范围,`_jumpTo` 按 pixel_gravity 反算抛物线(横向 ≤140px/s),`frames_to_get_stuck` 到就重算路。
  卡进实心(落沙埴住 / 塌方)只在 ±3px 内就近挪出,挪不出 = 被埋住原地不动(`_unstick`),不再"往上顶 16px 穿墙冒出来"。
- **怪的生命周期**:怪 / 虫随区块走——区块被 LRU 卸载 `ChunkStreamer.onEvict → Entities.unloadChunk` 收掉,回来按生成表重刷(`liveChunks`);道具 / 物品 / 圣山货只放一次(`spawnedChunks`,睡着的刚体已在 chunk.mat 里)。
- **AI**(AnimalAI 简化):sense_creatures + detection_range 发现玩家 → 追;attack_melee_max_distance 内播 `attack`,action_frame 那帧结算 damage_min~max + impulse,frames_between 冷却;helpless 阵营见人跑;没人时站/逛(不走悬崖)。
- **伤害**:弹丸子步进 `hooks.hitTest`(Hitbox)→ ProjectileComponent.damage(`damage_scaled_by_speed` 按速度缩,击退 = `knockback_force` × 弹速);爆炸 config_explosion.damage **满额无衰减**,但 hitbox 要能被爆炸射线够到(墙挡住没伤害;规则反自 exe,见 docs/noita-entities-plan.md 2.4);`materials_that_damage` 每帧;受击喷 `blood_spray_material`、死亡洒 `blood_material`(真材质,会流/会反应)。玩家 hp 改用 Noita 单位(max_hp 4 = 100),`materials_that_damage` 表生效,0.5s 无敌帧,死了回出生点。
- **像素刚体 `RigidBody.js`(第 2 步:物理道具)**:PhysicsImageShape 一张图 = 形状 + 材质,每像素是世界里一格该材质。
  醒着:自己积分(重力 350、box 摩擦/恢复系数、边缘像素撞地形 → 接触质心→中心为法线,沿主轴半像素推出,冲量 + 库仑摩擦 + 扭矩;
  整面贴地当"面接触"不产生扭矩,只有角/边挨着才翻;慢速接触不弹),画在世界之上,对玩家/弹丸/怪按像素判定,玩家能推(推睡着的会把它推醒)。
  睡着(慢 + 有支撑 0.5s):像素按整数位置写进 `chunk.mat`(材质 = shape.material,`cell_type=solid` 类现在在 CellSim 里是静态),
  之后元胞自动机接管——木箱会烧、被挖掉的像素就是刚体缺损;每 0.4s `audit()` 清点缺损与支撑,支撑没了就醒。
  浮力照原版(反 exe physicsbody_system):原点下方 8px 那格是液体(非沙)→ 力 = −0.7 × 质量 × (速度 + 重力),即有效重力剩 30% + 0.7/s 速度衰减 —— 原版没有东西会浮,木箱 / 尸体都慢慢沉底(终端 31px/s)。伤害:弹丸命中 / 爆炸 → DamageModel hp;`ExplodeOnDamageComponent`:
  hp≤0 或缺损 ≥ `physics_body_destruction_required`(炸药箱 4%)按概率炸,`config_explosion` 交 `ProjectileSystem.explode`(同一套坑/火/摇镜/伤害,会连锁);
  `MaterialInventoryComponent`:桶被打到从伤口漏,毁了 300 油全洒(真液体);碎块按图色飞出(box2d 材质是尘)。矿灯带光。
  `cell_type=solid` 改为静态是顺手修的 bug:之前煤矿木支架、睡着的箱子都会当落沙塌掉。
- **第 3 步:尸体 / 掉金 / 沾污 / 火**:死亡走 `DamageModelSystem::KillMe` 的 RAGDOLL_FX 分支(反 exe,细节见 docs/noita-entities-plan.md 2.4 第 19 条):NORMAL / BLOOD_SPRAY = `ragdoll_filenames_file` 每张整帧 png 裁成一块像素刚体(材质 `ragdoll_material`=meat),
  **两张图重叠的像素 = 一个 pin 关节**(`Ragdoll.js`:僵尸 12 块 11 关节一具骨架,顺序冲量 + 转角刚度,整组一起睡 / 醒,拉开太远或锚点像素被打掉才断),整具带着 自身速度×3 + 受击冲量 倒下;
  BLOOD_EXPLOSION(霰弹 / 锯片 / 火箭卡)不建关节散开 + 每块喷 `blood_spray_material`;FROZEN(冻住时死)/ 没有 ragdoll 文件 = 整张精灵帧变一块刚体(ice_glass_b2 / ragdoll_material);DISINTEGRATED(幽灵 / 幻影 / 雕像 `ragdoll_fx_forced`,或化尘弹)= 每像素一粒尘无尸;
  火烧死每 5 像素点一格火把尸体烧成灰;弹丸 / 爆炸致死 20% 变 BLOOD_SPRAY。睡够 8s 撤掉刚体只留肉像素(原作尸体最终也是一堆 meat);`drop_money.lua` 逐行:money = 10×max(1,⌊max_hp⌋),先掷 5 个 10 面值再 1000/200/50/10,
  金块是 `gold_box2d` 小刚体(`goldnugget_6/9/12/20px.png`),`LifetimeComponent` 900 帧消失,`auto_pickup` 碰到就进钱包。
  沾污按液体材质 tag(status_list.lua):`[water]` WET(灭火)· `[burnable]` 液体 OILED(碰火即燃)· `[blood]` BLOODY · `[slime]` SLIMY(走速 ×0.6)· `[radioactive]` 掉血;
  踩水洼也沾。着火(`fire_probability_of_ignition`):烧 4s,每 0.5s 扣 `fire_damage_amount` 0.2,身上往外冒火格(会点燃旁边的油/木,人就是行走的火源),进水灭;
  怪同一套 + `burn` 动画;弱僵尸 hp 0.2 碰火半秒就烧死,和原版一样。
- 喝药水:F / "喝一口",一口 250 单位,材质 `statusEffects` → `EFFECT_DEFS`(时长照 effect_*.xml frames),倍率走 `effectMul`(移动 / 悬浮 / 出入伤害 / 方向),隐身让怪的 sense 失效。
- 憋气 / 摔落 / 死亡:`air_in_lungs_max` 7s 后 `air_lack_of_damage` 0.6/s(noitaPlay,HUD 入水才出气条);道具 `falling_damages`(只有四色瓶子)落差 70~250px 给 0.1~1.2 伤(`Entities._updateBodies`);死了停世界出 `#death` 画面(死因 / 深度 / 金 / 击杀),回出生点或重开。
- **第 4 步:远程攻击 + 虫**:`attack_ranged_entity_file`(矿工 `projectiles/tnt.xml` 抛物刚体 r20 爆炸、霰弹手 `buckshot` 3~4 发、火法 `fireball`、史莱姆射手
  `radioactive_blob`、酸射手 `acidshot`)抽成 `projectiles.json` 的 `e_*`(和 deck/ 同名的不是一回事);AI 在 `attack_ranged_min/max_distance` 内、有视线
  (眼睛到目标每 4px 采样)、冷却到 → 播 `attack_ranged`,`action_frame` 那帧按 `count_min~max` 开火,`predict` 提前量,抛物弹抬角;
  弹有 `owner`:敌人的弹只打玩家(player_base Hitbox)和刚体。**虫**(`WormComponent`+`WormAIComponent`+`CellEater`):头带节链在地里游,
  每帧把头周围 `radius=6` 的格吃成空气(虫洞),`hunt_box_radius` 256 内追(speed_hunt 4px/帧、转向 0.06rad/帧)否则 128 盒里漫游,
  钻出地面靶重力抛物线再扎回去(出土摇镜),`target_kill_radius` 内一口;"在地里"看吃半径之外的探针(头周围会被自己吃空)。
- **第 5 步:真法杖 `Wands.js`**:`scripts/noita-prepare-wands.mjs` 把 `gun_actions.lua` 全表 482 条法术抽成 `wands.json`(id / `translations/common.csv` 中文名 /
  图标 / 类型 / mana / max_uses / 弹丸 / `c.fire_rate_wait` 与 `c.spread_degrees` 增量),加煤矿祭坛 17 根固定法杖(`items/wands/level_01/wand_0xx.xml` 的
  AbilityComponent + gun_config)和 `player.xml` 的两根初始法杖(Bolt staff:容量 3 / 延迟 10 / 充能 24 / 法力 100·30 / LIGHT_BULLET×2;Bomb wand 按
  `starting_bomb_wand.lua` 区间掷)。祭坛法杖的卡照 `level_1_wand.lua` 逐行(`SetRandomSeed(x,y)`,reload+fire_rate+spread 决定弹/炸/工具三张表)。
  施法 = gun.lua 逐条(`draw_shot / draw_action / draw_actions`):根 shot 抽 `actions_per_round` 张;每张卡法力不够 / 次数用完就弃掉换下一张;
  PROJECTILE / STATIC_PROJECTILE / MATERIAL 进当前 shot;MODIFIER 改 c(`speed_multiplier` 累乘、`damage_projectile_add` 累加、延迟 / 散射累加)再 `draw_actions(1, true)` 让右边那张吃到;
  DRAW_MANY `draw_actions(N, true)` 再抽 N 张进同一 shot(无尽 = 剩下全部),抽到牌库尾绕回一次并在这发之后充能;触发弹(hit_world / timer / death)先抽 1 张当载荷挂在弹上(可嵌套),
  弹死时 `ProjectileSystem._die` 在撞点沿原方向放出。shot 里全部弹同一帧发出;延迟 = 法杖 + Σ卡 fire_rate_wait;充能 = 法杖 reload_time + Σ卡;`shuffle_deck_when_empty` 洗牌;散射 = 法杖 + Σ卡。
  法杖是世界里的物品(祭坛 `wand_altar.png` 的 0x50a0f0 标记 → `spawn_wands` → `g_items` 掷 wand_001~017 / wand_level_01),碰到捡起,背包 4 根(自由模式 8),1~9 / q e / 按钮切换,手里换成对应 `items_gfx` 法杖图。
  场类(`base_field.xml`:LifetimeComponent 7200 + GameAreaEffectComponent r28 → 圈内怪 FROZEN / ELECTROCUTION 定住;EnergyShieldComponent → 弹开敌方弹;精灵 alpha 0.25 additive + blast_frozen 染色 + spawn→fireball 动画接续)。
  电(ElectricityComponent):雷霆之环 `electrocution_blast.lua` 每 10 帧射一道电,碰到导电材质(液体缺省导电、油 / 胶水 0、金属 1)就开一条 `zap` 电流 —— 每帧 speed 32 格顺惯性乱窜、走 energy 1000 格断,
  走过的格亮 0.15s(`elec` Map),碰到的怪 / 玩家 `hooks.shock` → 40 帧定身 + 0.4 电伤害(玩家无无敌帧,`player.stunT` 期间不能动 / 开火);`probability_to_heat` 把水烧成蒸汽。
  MagicConvertMaterialComponent 按原版从中心一圈圈往外扫(每帧 steps_per_frame 圈),loop=0 扫完即止 / loop=1 循环。弹丸 `AudioLoopComponent` → `d.loop` → `projectiles.loops`,noitaPlay 用合成噪声配音色(黑洞低鸣 / 场嗡鸣 / 电滋滋)。
  修饰卡:每张卡的 action 体抠成 `ops`(对 c.* 的 add/mul/set/append/clamp),施法时按 gun.lua 回放 —— c 每个 shot 一份,同一 shot 的弹共享最终 c;
  c 作用到弹上(速度 / 伤害 / 寿命 / 反弹 / 重力 / 击退 / 爆炸半径与伤害 / 友伤),`extra_entities` → `Wands.EXTRA_BEHAVIOR`(追踪 HomingComponent 反自 exe、穿透 / 穿墙 / 上下飞 / 波浪 / 乱抖 / 贴地 / 避墙 / 无限寿命 / 加减速 / 自瞄 / 区域伤害),
  `game_effect_entities` 命中给状态;`shot_effects.recoil_knockback` → 射手 v −= 瞄准方向 × recoil(后座力卡浮空);瞬移弹 TeleportProjectileComponent / 瞬移施法 teleport_cast.lua。110 张修饰可用。
  未做:`gun_procedural.lua` 完整随机法杖(wand_level_01 先借固定法杖数值)、阵型类 DRAW_MANY 的角度(按普通多重放)、bounce_* / larpa / orbit / 颜色类 extra_entities、暴击。`?debugwands=1` 仍是测试表。
- **物品**:药水(`potion.xml`:形状 `potion_normals.png` + 精灵 `potion.png` 按液体色染;内容照 `potion.lua` `SetRandomSeed(x,y)`:75% 魔法液体 / 25% 常规表;
  捡进 4 个物品格,选中后开火 = 扔(`max_throw_speed` 180),砸到东西碎,1000 单位液体洒出来(真材质);被打也碎)、宝箱(`chest_random.lua drop_random_reward` 主干:
  7% 小炸弹 · 33% 金 · 10% 药水 · 4% 法术刷新 · 19% 法杖 · 11% 心 · 3% 整箱变金 · 2% 再掷,碰到即开)、心(+25 最大生命并回 25)、法术刷新(全部法杖法力/牌库回满);
  生成:`g_props3` 的 potion、wang 标记 `spawn_heart`(r>0.7 心 / 0.3<r≤0.7 宝箱)与 `spawn_chest`。
  三种身体模型:`_walkStep`(CharacterPlatforming + 局部寻路:窄坑跳、卡住跳/放弃)、`_flyStep`(`can_fly`:无重力朝目标飞,射手悬在人斜上方)、
  `_crawlStep`(蜘蛛:surf 记实心在哪一侧,沿切向爬,小坎跨 / 下坡贴 / 拐角绕 / 撞墙转,精灵按面旋转)。`escape_if_damaged_probability` 受伤逃。
  第四种 `stationary`(shooterflower / 巢 / 卵:没有 CharacterPlatforming)不动只开火;PhysicsAI 飞行体(无人机 / 水晶)本体 `d.bodyImage` 先画再叠发光眼精灵。
  走路怪追人时人不在同一层或被挡 → `_findPath` 8px 粗网格 Dijkstra("能站" = 整个碰撞盒放得下且脚下有实心;平走 / 掉 ≤12 格 / 跳:直上 j 格再横移 i 格,范围由 initial_jump_max_distance 与抛物滞空决定,代价 3+i+j 能走不跳),每 0.4s 一次,照下一路点走 / 到起跳格中心抛物起跳。
  地雷 `mine_scavenger`(`d.mine` 圈 20px 触发 → 0.5s → `explosionOnDeath`,和炸药箱共用 `explodeConfig`);巢 `d.nest` 每 121 帧 75% 在玩家 200px 内吐一只(上限 15 / 10);
  神殿陷阱 `d.trap`(crypt_trap_check.lua:正面 170px 内每秒一发,朝向由精灵 _left/_right 定),石框 `SCENE_PROPS` 跟生成点盖进材质;
  幽灵 `d.ghost`(穿墙、`d.aura` 光环伤害、`d.invulnerable`),幽灵水晶碎了 500px 内幽灵散掉。
  lukki 蜘蛛 `d.limbs`(`_initLukki / _legsStep / _attackLeg / _drawLeg`):身体飞行模型 + 两段式 IK 腿踩 len 内的实心、攻击腿 aim→jab 0.5 伤、CellEater 被挡就吃、死了腿变肉块;
  `d.overlays` 叠层精灵(wiggle / emissive)、`d.areaDamage`(tiny 碰到掉血)、`d.eggs`(卵被打出小蜘蛛)。`damage_multipliers` 在 `hurt()` 按 src(projectile / explosion / fire)乘,所有怪生效。
  黏液怪(giantshooter "大蜘蛛" / slimeshooter / acidshooter / tentacler)`d.tentacles`(`_tentaclesStep / _drawTentacles`:verlet 触手,点 0 钉在挂点、v×0.8/帧、重力 400、链约束、进实心退回);
  `e.inventory`(MaterialInventory:弹丸命中按 `leak_on_damage_percent` 漏 6~14 格)、`d.splitBelow`(giantshooter_death.lua:hp 跌破 0.3 出 3 只 slimeshooter)、
  `d.explode`(ExplodeOnDamage 死亡爆炸:giantshooter r30 填酸、坦克 / 炮塔 / 无人机)、所有带 LightComponent 的怪在 `lights()` 发光(玩家一屏内)。
- **圣山守卫**(noitaPlay `guard`):`templeMarks` 发 `shop_area`(shop_hitbox)/ `areacheck`(temple_areacheck_horizontal 两行砖)→ 货出框 = 偷、砖行被挖 = 泄漏 → 惹怒众神 → 3s 后在特权祭坛出 Stevari(`necromancer_shop`,
  `d.attacks` = AIAttackComponent 多段按距离挑弹)。飞行体统一有 `_findFlyPath`(8px 格 BFS,整个碰撞盒不撞才算能飞)+ 贴斜坡滑;物品不挡怪。
- **Worker 全局** `WorldClient.setGlobals({shopCount})` → `world.globals`(GlobalsGetValue 的替身:TEMPLE_SHOP_ITEM_COUNT,EXTRA_SHOP_ITEM 特权 +1),`scanTempleMarks` 生成商店时读。
- **圣山**(第 6 步 ②):`core/templeMarks.js` 扫整图布景里的标记色(temple_altar.lua)→ 灯 / 商店 / 特权 / 回血 / 碎石;`Wands.getRandomAction`(引擎函数,照 noitool 反推)+
  `shopItem / shopWand`(generate_shop_item.lua 标价);法术卡是钉在货架上的物品(`Entities.spawnSpellItem`,`b.shop` 画标价),买进 `player.spells` 散卡背包;
  `Perks.js` 复刻 `perk_get_spawn_order / perk_spawn_many`,效果 27 个(`EFFECTS`)落到 noitaPlay 的 `flags` 上;法杖编辑 UI 只在圣山开(`noita-play.html #editor`)。细节见 plan 文档第 6 步 ②。

### 手感:玩家参数照抄 `data/entities/player_base.xml`

| 参数 | 值 | 效果 |
|---|---|---|
| `collision_aabb` | x −2..2,y −4.5..2.1(**4×6.6**) | 碰撞盒比 7×14 的精灵小得多——这是能钻窄缝的原因;之前用 7×15 所以"走不动" |
| `climb_over_y` | 4 | 撞墙自动上 ≤4px 台阶 |
| `pixel_gravity` / `velocity_max_x` / `accel_x` | 350 / 57 / 0.15 每帧 | 走路慢而稳,松手滑一小步 |
| `jump_velocity_y` / `jump_velocity_x` | −95 / 56 | 按一下 = 跳 |
| `fly_speed_max_up` / `fly_speed_change_spd` | 95 / 0.25 每帧 | 按住 = 悬浮,向上速度快速逼近 95 |
| `fly_time_max` / 回充 | 3s / 地面 6/s,空中悬空 38 帧后 0.4/s | 蓝条 3 秒,落地半秒回满 |

### 投射物 `ProjectileSystem.js`:定义全部来自 `data/entities/projectiles/deck/*.xml`

`scripts/noita-prepare-projectiles.mjs` 把 30 种投射物 xml 抽成 `projectiles.json`(贴图进 `proj/`,含枪口火焰变体、爆炸帧):
`VelocityComponent`(gravity_y / air_friction,负值 = 加速)→ `ProjectileComponent`(speed_min/max、lifetime±randomness、on_collision_die、
on_death/lifetime_explode、`config_explosion`)→ `SpriteComponent`(Sprite xml 帧动画、offset、additive)→ `ParticleEmitterComponent`×N
(拖尾:材质色化妆粒子 is_trail/trail_gap/寿命/速度/airflow;`create_real_particles` 的直接往世界写材质——火球拖火、冒烟)→ `LightComponent` 彩色光。

爆炸 `config_explosion` 的落地:`explosion_radius` 挖坑,**只挖 durability ≤ max_durability_to_destroy 的材质**(火花弹 8:挖不动石头,只崩煤/草;
挖掘弹 10:能挖石头挖不动钢 12 / 神殿砖 14),`material_sparks` 出真材质碎屑,`sparks` 出白热火花,`create_cell`(火球 → 坑里生火),
`explosion_sprite` 播帧,`camera_shake` 震屏,`light_*` 闪光。`MATERIAL_PARTICLE` 类(水/油/熔岩/火药)= 弹本身落地变材质。
碰撞行为(统计了全部 208 个 ProjectileComponent 的字段后补齐):`bounces_left` 反弹次数 + `bounce_energy` 能量保留(弹力球 10 次 ×0.9、
泡泡/喷吐 20 次 ×0.5)+ `bounce_always`(任何角度都弹)/ `bounce_at_any_angle`(锯刃按真实法线反射)—— 普通弹只在擦边(入射角余弦 <0.55)时弹,
正撞就死;法线由撞点 5×5 邻域实心分布估计;`bounce_fx_file` 的粒子喷发;`die_on_low_velocity(_limit)`;`die_on_liquid_collision`(火球入水灭);
`penetrate_world` / `collide_with_world=0`;`ground_penetration_coeff` + `ground_penetration_max_durability_to_destroy`(exe 0xd32970:每格 `E = coeff×mass×½|v|²`,`take = min(格 hp, E)`,`v ×= 1 − take/E`,
吃完格 hp 就挖掉继续钻,吃不完停在这格;光明穿凿一发钻 ~29px 岩石隧道,长枪扎 2~3 格;`terminal_velocity` 夹速在位置积分之后);`on_death_gfx_leave_sprite`(箭插在地里、锯片躺着,那格被挖掉才消失);
`velocity_sets_rotation=0` + `angular_velocity`(卵石自转不随速度转向)。
第二轮对齐(按 490 个 xml 的组件统计逐个补):
- `SpriteParticleEmitterComponent`(45 处):贴图粒子——火球的橙烟团、锯刃的火星、挖掘弹的尘,含 color/color_change(每秒变色/淡出)、随机位置/速度/旋转/角速度、重力、减速、缩放、additive
- `MagicConvertMaterialComponent`(26 处):半径内按 steps_per_frame 转换材质——冰球一路把水/血/酸/熔岩冻成对应冰(表在 `misc/material_converter_freeze.xml`,通过 `<Base file>` 继承解出来)并灭火;火球 ignite_materials 点燃可燃物;触水/触金/触油把任意材质变成那一种
- `CellEaterComponent`:大锯刃/小黑洞按概率啃掉半径内的格子
- `BlackHoleComponent`(巨大黑洞,引擎内置;逻辑反自 `noita_dev.exe` 的 `BlackHoleSystem::Update`,见 docs/noita-entities-plan.md):半径每 3 帧 +1 长到 64;
  每帧从中心射随机射线到 radius,第一条命中的格子吃掉,再沿垂直方向 ±1..8px 射 16 条 → 一帧最多啃 17 格(从内表面往外一层层啃);吃掉的格子变飞行像素(`bhParts`,原材质),
  初速切向 4×attractor、被吸引器(范围 3R)拉回来绕圈、到中心湮灭;±R 方框内活物 / 玩家 v += attractor × 1.5 × (径向+切向),刚体走 `black_hole_gravity.lua`;
  每帧掷一次 damage_probability,中了半径内 mortal 全扣 damage_amount 0.1。画面:暗紫黑圆盘 + 1px 细粉边 + 盘外洋红光晕 + 材质色碎屑漩涡 + 粉色流光(emitter attractor_force 32)
- 发射器补齐:`area_circle_radius`(圆内随机位置)、`velocity_always_away_from_center`、`draw_as_long`(拉成线的火星)、`delay_frames` / `emitter_lifetime_frames`、
  **`image_animation_file`**(火圈/水圈:按图片像素从中心一圈圈向外发射真材质,`circle_256.png` 预先按到中心距离分桶)
- 没有 ProjectileComponent 的"原地实体"(火圈/水圈只有 LifetimeComponent)不飞不撞,寿命取 LifetimeComponent
- `velocity_sets_scale(_coeff)`:弹体沿飞行方向按速度拉长;`emissive` 同 additive;`alpha`

法杖池:火花弹 / 魔法箭 / 重型箭 / 火球 / 火焰弹 / 挖掘弹 / 强力挖掘 / 酸液 / 水 / 油 / 熔岩 / 火药 / 弹力球 / 锯刃 / 箭 / 泡泡火花 / 弹跳能量球 / 喷吐弹 /
冰球 / 火圈 / 水圈 / 触水 / 触金 / 发光弹 / 能量球 / 长枪 / 大锯刃 / 崩塌大地(键 1~9 0 - =,Q/E 上下切,手机"换法杖")。
第三轮(逐法杖矩阵测试 `scripts/_noita-wands-matrix.mjs`:固定区域统计材质变化):
- 石渣规则改对:**静态材质(石/砂岩/木)被打碎只出尘,不沉积**;沙/土/煤/液体的碎屑才落地回去。之前石渣一半结成 rock_loose 糊在墙上是错的
- `cell_type=solid`(rock_loose / 木块 / 玻璃渣)在 Noita 是 box2d 碎块会掉,模拟里改按落沙处理
- `LooseGroundComponent`(崩塌大地):`load_this_entity` 里读出 probability / max_distance / min~max_radius,把范围内静态地面随机变松散块坠落
- 冰球爆炸 `create_cell=blood_cold`(冰冷液体)是原版就有的,不是 bug
- 材质喷射(水/油/熔岩/火药):`fire_rate_wait -= 15` → 按住每帧一滴的喷雾,弹是材质像素,`friction=3` 当阻力,会下坠,落点 `check_concrete`
- 音频:iOS 切后台回来 AudioContext 变 interrupted,现在任何手势 + visibilitychange/focus/pageshow + 每帧 `tick()` 都尝试 resume

刚体弹(`bomb.xml` = `base_projectile_physics.xml` + 自己的 `config_explosion`,`<Base file>` 属性合并):`PhysicsBodyComponent` 的弹当小刚体模拟——
重力 350、撞面弹 0.25、地面滚动摩擦、按 v/r 自转,引信 `lifetime=180` 帧到时爆炸:半径 60、`max_durability_to_destroy=11`(钢 12 炸不动)、
`create_cell_probability=40`(默认材质 fire → 坑里起火)、火花 12~15、`camera_shake=50`、爆炸帧 `explosion_128`。地表一颗炸出 120px 的坑。
法杖池加 炸弹 / 小炸弹(`fire_rate_wait +100` → 1.7s 一颗)。

还没做:HomingComponent 追踪(等敌人)、LuaComponent 脚本效果(传送/召唤/连锁)、
LaserEmitterComponent 光束渲染、LightningComponent 闪电弧、`hole_image` 自定义坑形、`ray_energy` 射线耗能。

### 玩家精灵 `PlayerSprite.js`:原版 `data/enemies_gfx/player.xml`

`scripts/noita-prepare-player.mjs` 抽出身体图 `player.png`(12×19,每行 8 帧,50+ 个动画:stand/walk/walk_backwards/run/jump_up/jump_fall/land/fly_idle/fly_move/swim_*/…)、
热点图 `player_hotspots.png`(每帧 `#800000` = 手臂根 right_arm_start)、手臂 `player_arm.png`(5×5,热点 hand)、一根法杖贴图。
规则照原版:**身体永远面朝瞄准方向**(不是移动方向,之前按移动方向翻身,一边走一边瞄就来回抽),倒着走播 `walk_backwards`;
手臂绕热点根旋转指向瞄准点(面朝左时上下翻转),法杖握在手热点上,弹从杖尖出;状态机:游泳 / 悬浮 / 跳起 / 下落 / 落地 / 走 / 站。

音效 `Sfx.js`:Web Audio,mp3 走 BufferSource(iOS 别用多个 `<audio>`),喷气/燃烧/洞穴环境音用噪声合成;素材 CC0。
操作日志 `OpLog.js`:见 `docs/ai-guide.md §10`,卡住会带周围材质 ASCII 图立刻上传,`node scripts/noita-logs.mjs` 看。

## 材质模拟 `sim/CellSim.js` —— 规则全部来自 materials.xml,对标 Noita

`scripts/noita-prepare-assets.mjs` 现在把 materials.xml 的模拟属性全抽进 `materials.json`
(cell_type / liquid_static / liquid_sand / density / liquid_gravity / liquid_viscosity / burnable / autoignition_temperature /
temperature_of_fire / fire_hp / generates_smoke / requires_oxygen / lifetime / gfx_glow / gas_* / 冻结·融化目标 …,按 `_parent` 继承),
并把 328 条 `<Reaction>` 抽成 `reactions.json`([tag] 输入、`[tag]_molten` 输出模板都保留)。

`CellSim` 直接在 ChunkStreamer 的 `chunk.mat` 上原地跑(**激活窗口 = 视口 + 512px 一圈**,最多 4×4 chunk,坐标→chunk 纯算术无查表;
Noita 模拟的是玩家周围一整片加载区而不只是屏幕,屏幕外的爆炸 / 崩塌 / 流水 / 怪物照常进行 —— 之前只模拟视口 +24px,手机上子弹飞出屏幕炸出来的地形要走过去才开始动;
窗口只要求视口那一圈的 chunk 就位,外圈没到的当 −1;`ChunkStreamer.update(view, dt, simRect)` 会把模拟圈的 chunk 也纳入需要集,睡眠机制让代价只跟"在动的块"有关):

| 材质分类(由 xml 推出) | 规则 | 用到的字段 |
|---|---|---|
| static / solid | 不动;burnable 的可被点燃 | burnable, fire_hp, generates_smoke |
| sand(liquid_sand) | 下落 / 斜落,可沉入更轻的液体 | liquid_gravity, density |
| liquid | 下落 / 斜落 / 横向摊开;密度大的沉下去 | density, liquid_gravity, liquid_viscosity |
| gas | 上浮 + 随机横移,按寿命消散 | lifetime, density |
| fire | 有寿命、四邻无空气即熄(requires_oxygen);点燃 autoignition ≤ 自身 temperature_of_fire 的邻居 | temperature_of_fire, requires_oxygen |
| 反应 | 相邻两格按 probability%/帧 变成输出(熔岩+水=岩+蒸汽、酸腐蚀 [corrodible]、[meltable]→[meltable]_molten …) | reactions.json 展开成 10872 条 (a,b) 规则 |

每格 1 字节 aux:火/气 = 剩余寿命;可燃材质 = 燃烧进度(按 6000/fire_hp 每帧推进,oil 500 烧得久,gunpowder 瞬燃)。
**睡眠**:chunk 切 32×32 块(`e.act` TTL),写格子 / 交换 / 障碍盒移动标脏(贴边连邻块),只步进脏块,3 帧没动就睡;新 chunk 静止,原作同款。模拟从 1.5~4.5ms 降到 0.1~0.9ms。
位图只画静态材质(`ChunkPainter.skipDynamic`),液体/沙/气/火每帧由主线程按当前状态叠上去(液体用 xml 的 alpha 半透);
静态材质变了(挖/烧穿)的 chunk 节流 150ms 后让 Worker 重画。实测:油池点燃 → 烧 → 出烟 → 倒水灭火出蒸汽,模拟 ~2ms/帧。

还没对上的:Noita 的 `liquid_*` 精确流速常数、box2d 刚体(solid_*)、电只有雷霆之环这一路(闪电 / 雷球 / 电荷修饰还没接 zap)、染色(liquid_stains)、
冻结/融化(cold_freezes_to / warmth_melts_to 已在表里,尚未接温度)、爆炸(reaction.explosion_size)、三元反应与 req_lifetime。

## 无缝大地图(Chunk Streaming)—— Noita 的做法,`worker/ChunkStreamer.js` + `store/ChunkStore.js`

中途不出加载页靠的是四件事,都做在 `ChunkStreamer` 里(主线程侧,无 DOM,每帧调一次 `update(视口)`):

| | 做法 | 参数 |
|---|---|---|
| 按需生成 | 只请求可见区块,缺的按优先级排队(可见 > 前方 > 其他,近的先) | — |
| **方向预取** | 从视口中心位移算速度,朝移动方向多取 `ahead` 格、背后 `behind` 格、侧面 `side` 格 | `ahead=2 behind=0 side=1` |
| **帧预算** | 同时在 Worker 里的请求 ≤ `maxInFlight`;每帧最多接收 `maxAcceptPerFrame` 个结果(位图上传分帧) | `2 / 2` |
| **LRU + 落盘** | 常驻 ≤ `cache` 块,最久没看的先卸;**被改过(dirty)的卸载前写 IndexedDB**,下次进来先查存档,命中就用存的材质代替生成 | `cache=48`(≈ 70MB) |

没改过的区块不存——算法是确定性的,回来重新生成一模一样;这正是 Noita 只写 `world_X_Y.png_petri` 给改动过的区块的原因。
`ChunkStore` 用 RLE 压材质(512KB → 几十 KB),接口只有 `get/put/delete/clear`,Cocos / 小游戏换成文件系统实现即可。

改材质走 `streamer.paintCircle(wx, wy, r, matId)`(查看器里右键挖洞),它标 dirty 并让 Worker 重画;切后台 / 关页时 `flush()`。
验证:`node scripts/_noita-map-persist.mjs` —— 挖洞 → 飞远 200+ 块被卸载 → 落盘 1 块 → 飞回 → 存档命中,洞还在。

## 搬到手机

- `core/` 与 `World.js` 只用 TypedArray / Map / Math,无 DOM;`assets.js` 里只有 `fetch` + `createImageBitmap` 是平台相关,
  换成引擎的文件读取即可,`decodePng` 已是纯 JS。
- 区块生成可整体丢进 Worker(输入 seed + chunk 坐标,输出 Uint16Array),主线程只做渲染。
- 一个煤矿区域的 wang 层 256×107×3 字节;区块 512×512×2 字节 = 512KB,LRU 默认 64 块(32MB),可按机型调。
- 渲染层 `ChunkPainter` 是 Canvas2D 参考实现;引擎里用材质 id → 调色板/贴图的着色器替换即可。
