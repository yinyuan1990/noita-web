# AI 对接文档 · 星空空战（air-combat）

> 本文档面向 AI 助手 / 新开发者，用于快速接手本项目继续开发。
> 改动代码前先读本文对应章节，改完后如引入新系统请同步更新本文。

## 1. 项目概览

- **游戏**：无限地图星际空战（雷霆战机 + 肉鸽敌潮混合玩法），**竖版、主打手机**，纯前端，无后端。
- **技术栈**：PIXI.js v5.3 + Vite + 原生 ES Modules；Spine 骨骼（pixi-spine 2.1.12，Spine 3.8）；DragonBones/CocoStudio 骨骼（自研 canvas 渲染器 `skeleton_player.js`，玩家机与僚机用）。
- **入口**：`web/air-combat.html` → `web/src/demo/airCombat.js`（约 5500 行的单文件主逻辑，`main()` 内含全部逻辑）。
- **运行**：`cd web && npm run dev`，访问 `http://localhost:5177/air-combat.html`（端口被占时 Vite 自动 +1）。
- **竖版设计分辨率**：`W=1080 H=1920`（9:16），CSS 信箱化居中；手机端 `resolution` 上限降到 1x、桌面 2x。**调试浮层**：URL 加 `?debug=1` 显示 FPS/draws/精灵数/画布尺寸/敌机数等（见 §9）。
- **线上部署**：已发布到 `https://update.cocoaihj.com/updatesoft/fj/`（见 §10）。
- **另有**：`forest-demo.html`（森林行走 Demo，龟波气功特效的出处）、`cocos-fx-demo.html`（粒子预览）、`骨骼动画.html`（战机/僚机骨骼预览，风暴雷神/L_15 的出处）、`elem-demo.html`（元素反应实验场：Noita 式组合反应手感验证沙盒，`src/demo/elemDemo.js` 自包含无资源依赖；3 个装配槽自由拼装「弹道(速射/追踪/抛雾/光束)×元素(冰/火/油/电)」16 种技能，15 种连锁反应(元素两两全配对+环境+重击+闭环产物:燃烧残骸/冰晶弹片/机油泄漏)+爆炸冲击波击退+玩家同规则受伤坠机+发现横幅+效果图鉴 21 条；验证通过的反应待移植进主游戏）、`pixel-demo.html`（低配 Noita 验证:`src/demo/pixelDemo.js` 纯 Canvas2D 零依赖,360×200 网格真·落沙模拟,12 种材质/可破坏地形/爆炸碎屑回沉积/WASD 飞行射击/流血漏油敌人,火药矿脉链爆、熔岩遇水凝石等反应全绑状态不写 case;渲染带 2D 光照(两遍扫描传播、岩石挡光、洞穴环境光随深度变暗、火/熔岩/子弹/飞船为光源)+ bloom 辉光层(发光体单独一张 canvas,blur 两档 lighter 叠回)+ 装饰火花粒子;技能=弹道(单发/三连扇/弹跳/分裂/钻头/喷射)×载荷材质(动能/火/水/油/熔岩/火药)36 种组合,载荷即向世界注入真材质;敌战机用 Kenney 像素机贴图(精灵层叠在模拟世界上,Noita 三明治结构);玩家=程序绘制像素小巫师:重力+行走(1px 自动上台阶)+喷气背包(燃料条,落地回充)+魔杖朝准星发射+着火状态(跳水可灭),与世界同一套材质规则;世界 480×400 纵深探索(取景窗 240×135,镜头跟随,vIdx 世界坐标→视口映射),生物群系按 x 分带(冰川/森林/油田)+按深度分层(浅层群系风味/中层油+火药/深层岩浆窟/底部熔岩海),碗形水盆可游泳(水中 W 划水不耗燃料、缓沉、氧气条耗尽溺水、入水水花/水下气泡),右上小地图(1/4 采样低频刷新+取景框+玩家点),光照含对角传播(光斑圆)+液体吸光(水下视野短)+深层环境光近黑,巫师提灯是深潜生命线;地下地图=瓦片模板拼接(简化 Herringbone Wang:8 种手写 ASCII 模板+固定竖井列+CA平滑+群系×深度调色,连通性≥85%);染色 Stains(湿/油/血,敌我同规则)+液体导电(电载荷电死一池)+金块经济(击杀掉金粉自动吸取)。**该原型的总体规划见 `docs/noita-plan.md`(模块对标 Noita/里程碑/移动端方案),持续更新**）。

## 2. 目录结构

```
web/
├── air-combat.html            # 游戏页（竖版 HUD / 触屏控件 / 加载界面 / 结算，见 §8）
├── vite.config.js             # 构建入口(只打 air-combat) + base=/updatesoft/fj/ + 复制 index.html
├── src/demo/airCombat.js      # ★ 主逻辑（本文第 3 节详解）
├── src/demo/skeleton_player.js# DragonBones/CocoStudio 骨骼渲染器（玩家机风暴雷神 + 僚机 L_15）
├── src/demo/skeleton_models.json # 两个骨骼模型数据（内嵌解密图集）；运行时用 public 里的副本
├── src/fx/spineEnemies.js     # Spine 加载模块（敌机 JSON 骨骼 + Boss 二进制骨骼）
├── src/fx/cocosParticles.js   # Cocos plist 粒子移植（爆炸效果库）
├── docs/                      # 本文档 + cocos-particles-2d.md（粒子对接）
├── scripts/_deploy.py         # 生产部署脚本（paramiko SFTP，密码走环境变量，见 §10）
├── scripts/                   # Playwright 验证脚本（约定见第 6 节）
└── public/res/                # 全部静态资源（构建时整包拷进 dist/，路径即 URL，见 §7）
    └── skeleton_models.json   # 骨骼模型运行时副本（fetch 加载）
```

## 3. airCombat.js 核心系统索引

按文件内出现顺序。改哪个系统就搜对应标识符。

### 3.1 常量与资源加载
- `ASSET(p)`：**资源基址包装**——所有运行时 `/res/...` 路径都要过它，自动加 `import.meta.env.BASE_URL` 前缀以支持子路径部署（dev='/'，构建='/updatesoft/fj/'）。新增运行时加载资源务必用 `ASSET()` 或 `loadBase()`（内部已包）。
- `IS_MOBILE`/`IS_TOUCH`：设备判定，驱动分辨率/粒子/Spine 降配。`PFX`（环境粒子密度系数）、`ZOOM_N`/`ZOOM_B`（相机常态/加速缩放，手机拉近 2 倍看清机体）、`FX_BUDGET`/`DEBRIS_CAP`/`SPINE_CAP`（性能封顶，见 §9）。
- `_loadUI`：加载进度界面驱动（`loadBase` 每完成一项 `tick()`，`main()` 末尾 `done()` 淡出）。资源在进战场前全部 `await` 预载。
- `WEAPONS`：五武器定义（机炮/导弹/集束/电浆/极光），`VULCAN_TABLE` 机炮 10 级弹幕表。
- **音效 = Web Audio**（`ensureAudioCtx`/`loadSfxBuf`/`preloadAllSfx`/`playSfx`）：`SFX` 表→`AudioContext` 解码缓冲，`BufferSource` 播放。**不要退回 `new Audio()`**——iOS 上多个媒体元素会抢占并掐断 bgm。`.ogg` iOS 不支持已转 `.mp3`。BGM 仍是单个 `Audio` 元素（`playMusic`/`playBattleMusic`，Boss 战切 `Boss_Room`）；`unlockAudio`/`visibilitychange` 负责首次手势解锁与切回前台恢复。
- `BULLET_FX`：飞行弹特效序列帧（fire/thunder/poison/arrow，素材朝左，绘制时 `rotation = 角度 + π`）。
- `SPACE_FULL`：512 无缝星云整图（一个区块正好铺一张）；`PLANET_TEX`/`SUN_TEX`：行星/恒星装饰。
- `SPINE_ENEMIES`：13 种敌机骨骼；`BOSS_SPINE`：5 个 juese Boss 角色（加载后离屏预热消首帧卡顿）。
- **玩家机/僚机骨骼**（`HERO`/`WING` + `bakeSkeleton`）：见 §3.4.1。

### 3.2 地图（星空 tile 分块）
- `SCENES`：现只有「浩瀚星空」一景（`tiles.space: true`）；旧 LPC 地面 10 景在注释里可切回。
- `genChunk(ci, cj)`：区块生成——星空景单精灵铺整图 + 亮星（闪烁动画）+ 3.5% 黑洞 / 5% 恒星 / 22% 行星；防空炮位约 8% 区块。
- `spaceAnims`/`addSpaceAnim`：区块持有的循环动画（随 `dropChunk` 清理）；`spawnMeteor`/`updateSpaceFx`：流星。

### 3.3 武器与极光气功波
- `fireWeapon` → `fireKind(kind, lv, sub)`：kind 0-4；`sub=true` 是组合火力的副武器齐射（Lv2+ 武器自动伴随主武器开火）。
- **极光（kind 4）主武器 = 龟派气功光束**（移植自 forestDemo 按 F 的气功波）：
  - 状态机 `auroraBeam`：`fire`（束头 3400px/s 推进）→ `hold`（**常驻**，选着极光武器就一直喷，切走武器/死亡才 `fade` 收束）。
  - `drawKiBeam`：FighterZ 风格绘制——枪口能量球 + 四层翻滚束身 + 分形电弧 + 放射能量刺，全部画进 `kiBeamG`（ADD 混合 Graphics，每帧重画）。
  - `updateAuroraBeam`：走廊命中检测（束身半宽内沿轴最近目标）、0.07s 伤害 tick、束头贴目标、头部飞溅。
  - 注意：`beamG` 是狙击瞄准线层（别名冲突已踩过坑），气功波用 `kiBeamG`。
- 自动开火：主循环里无条件 `fireWeapon()`，不需要按住空格（`firing` 变量保留未用）。

### 3.4 玩家
- `player` 对象：`hp/maxHp/atk/def` 来自局外养成（见 §3.9）；`shieldHp` 防护罩（容量=`maxHp×0.4`，开局送一层，拾取「盾」补满，`damagePlayer` 先扣罩再扣血）。入伤按旧「HP=100」绝对值折成当前最大生命百分比，再吃防御减伤。
- 核弹：`tryNuke`（B 键）无数量限制，`nukeActive` 约 3s 冷却节流；HUD 显示 `☢ ×∞`。
- 氮气冲刺：`tryNitro(dx,dy)`（键盘双击方向 / 触屏「冲刺」按钮），瞬时高速 + 相机拉远。
- 进化：`checkEvolve` 机体五段变身（Mk-I ~ Mk-V），影响 `scaleMul`/副武器 cd。**HERO.on 时**进化不再替换机身贴图（骨骼帧每帧覆盖），相关 `player.spr.texture/tint/scale.y` 替换均以 `if (!HERO.on)` 守卫，`glowSpr` 改跟随当前骨骼帧。Mk-IV 的 HP 加成写入 `player.evoHpBonus`（随养成生命缩放）。

### 3.4.1 玩家机 = 风暴雷神（DragonBones）+ 僚机 = L_15（CocoStudio）
- 数据：`public/res/skeleton_models.json`（`fengbaoleishen` DB / `guazai_L15` CS，含内嵌解密图集）；渲染器 `skeleton_player.js` 的 `SkeletonPlayer`。
- **预烘焙**（关键，为手机性能）：`bakeSkeleton(sp, animName, cell)` 在加载时把动画逐帧 `render()` 到离屏 canvas → 一组 `PIXI.Texture`。**运行时只切帧、零逐帧骨骼渲染**（切勿改回每帧 `render()`+`texture.update()`，Canvas2D 逐三角形在手机上很贵）。
- `HERO`：`{ on, fps, putong[], baozou[], disp }`。动画规则——**火力未满级=putong 常态，火力全开(全武器 MAX)=BaoZou 爆走**。在飞行更新块里按 `weaponLv.every(l=>l>=MAX_LV)` 选帧数组，`heroT` 计时切帧，写 `player.spr.texture`/`player.shadow.texture`，缩放用 `HERO.disp*scaleMul`。
- `WING`：`{ on, fps, normal[], baozou[], disp }`。用于两处：①常驻僚机 `wingSprs`（左右各一，跟随机身，坠机时销毁）；②**进化浮游炮 `options` 的机身**（`addOption` 里 `isWing` 分支，取代旧 `shipTex[3]` 老机型；更新循环里按 `o.animT` 切帧）。
- 换其它战机/僚机：编辑 `skeleton_models.json`（用 `gen_bundle.cjs` 重新生成，模型名见 `member.tbl`/`guazai.tbl`），或换 `bakeSkeleton` 的模型 key。方向约定：模型**朝上**（机头向上），与 `rotation=face+π/2` 一致。

### 3.5 敌人
- `E_CONF`：21 种敌机（14 原有 + 7 个 C1863 妖魔：wolf/foxfire/imp/kappa/serpent/jiangshi/wsnake；hp 字段仅作档位参考，真实血量见 §3.9）。
- 编队新增 C1863 妖魔阵：wolfpack（狼群延迟梯次）/foxes/shrine/serpents（双蟒弧线合围）。
- **关卡敌阵主题 `LEVEL_THEMES`**（模块级）：10 关一循环，每关一套编队池 + 敌潮敌种，`nextWave`/`updateHorde` 按 `(level-1)%10` 取——保证一关一套面貌、全部编队与妖魔敌种轮流登场。手机 `SPINE_CAP` 提到 10；敌机整体视觉 `ENEMY_VIEW_MUL=2.5` 放大（只放大贴图/骨骼，不动镜头）。
- **关卡花名册 `LEVEL_PACKS` + 按关加载**（模块级）：每关一套 `skin`（把 drone/scout/fighter/wingman/interceptor/gunship 6 个通用原型换成本关 C1863 模型）+ 专属 `boss`。开局只加载 `BASE_ENEMY_MODELS`（13 C1920 原型 + 7 妖魔）+ 第 1 关花名册；打完 Boss 走 `advanceLevel`→`loadChapterAssets(lv)`：弹出 `#chapter` 加载浮层、`loadSpineEnemies` 增量加载下一关 6 皮肤 + Boss、`warmSpine` 预热、切 `curSkin`、恢复出怪。`spawnEnemy` 用 `curSkin[type] || conf.spine` 换皮，`spawnBoss` 用 `LEVEL_PACKS[(lv-1)%10].boss`。10 关铺开约 70 个 C1863 模型。`loadingChapter` 期间暂停 `nextWave`/`updateHorde`。
- C1863 boss 模型是 JSON（走 `loadSpineEnemies`），juese 的 `.skel` 二进制 boss 现已停用（`loadSpineBinary` 保留未调用）。
- **Boss 子弹多样化 `BOSS_BULLET`**（模块级，按 defId）：每关 Boss 一套 `{ tint, fan, ring, aim }`（弹色 + 扇/环/瞄准各用哪种序列帧），`spawnBoss` 挂到 `boss.bul`，`fireFan`/`fireRing`/`bAim` 读它。关键：`epShot` 原先用序列帧时**丢弃了 tint**，已修（`if (opt.tint != null) spr.tint = opt.tint`），否则弹色永远固定。
- `FORMATIONS`/`spawnFormation`：16 种编队；`nextWave`：每波编队数指数增长 `2^((wave+2)/3)-1`，上限 `5+level/2` 支，同屏敌机上限 `55+level*6`（封顶 115），逐支 0.3s 错帧生成（防 Spine 同帧实例化卡顿）。
- `updateHorde`：**肉鸽敌潮**——每 `4.4-0.28*level` 秒从随机方向涌来 5~18 只蜂群（drone/scout 为主），Boss 战期间频率减半。
- 敌弹 `epShot(x, y, ang, spd, opt)`：`opt.fx` 指定特效（fire=直射 / thunder=扇面 / poison=环爆 / arrow=狙击）。

### 3.6 Boss
- `BOSS_DEFS`：14 套 Boss（1~10 关线性 + 11~14 号 C1863 妖能方案：螺旋/扇形/环形/瞄准的进阶组合，第 10 关起按 `bossSeq` 轮换）；外观 `BOSS_SPINE`=5 juese（.skel）+10 C1863 妖魔（JSON）共 15 角色，按出场序号 `bossSeq` 轮换（`BOSS_SPINE_NAME` 显示名），失败回退静态涂装机。
- C1863 骨骼是 Spine 4.x atlas（页头含 `pma:` 行），pixi-spine 2.x 读不了，导入时须删掉 atlas 里的 `pma:` 行（加载器 `makeSpineEnemy` 的待机匹配已放宽为大小写不敏感 `Idle/Idle2`）。
- 血量：`enemyHpOf('boss') × (0.55+武器总等级×0.075+进化×0.3) × (def.hp/130)`——按 TTK 对齐养成 DPS，满改打 Boss 约 20~40 秒。血条为多层变色条（见 §3.9）。
- Spine Boss 不随航向旋转（保持直立 + 水平翻转朝玩家），残骸用 alpha 不用 tint。

### 3.7 碎裂系统（全体机体）
- `shatterObject(spr, x, y, opt)`：击毁时整机碎裂——Spine 机用 `collectSpineTextures` 拆成真实部件贴图，静态机 `sliceTexture` 切 3×3。
- `hitChips(o, hx, hy)`：受击崩落 1~2 小碎片（140ms 节流）。挂在 `damageEnemy`/`damagePlayer`/`bossDamage`/部件摧毁/Boss 终爆/玩家坠机。
- `debris` 数组上限 110，`updateDebris` 每帧推进。

### 3.8 爆炸/粒子
- `spawnExplosion(kind, x, y, scale)`：爆炸总入口；Cocos plist 粒子层见 `docs/cocos-particles-2d.md`。
- 已知取舍:`bigBang` 的 flatGlow 横贯光带比例别扭，核弹/集束一律用 `nukeBlast`。

### 3.9 养成与战斗数值
- 数据：`web/src/demo/player_data.json`（`memberlevel.tbl` 1~500 级曲线，`gen_player_data.cjs` 重导）。局外存档 `localStorage['air-hangar-v1'] = { level }`。
- 映射：`maxHp = 表生命 × (100/15)`（Lv1=100）；出伤 `scaledDmg(base) = base × (当前攻击/3)`；防御 `2000/(2000+def)` 减伤。
- 敌人血量 `enemyHpOf(tier)`：`12×攻击倍率 × 0.7s × 档位倍率 × (1+0.12×(关卡-1))`。档位：`drone` 秒死 0.02 / 小怪 1 / 队长 2 / 精英 7 / Boss 30。单次伤害上限见 `TIER_CAP`（超级 BOSS 50%）。
- 升级：**免费一键升级**（无金币/材料），按 `U`/`L` 或触屏「机体升级」升一级，数值直接对表。品质/星级暂未做（见 `飞机升级系统对接文档.md`）。
- Boss 血条 = **多层变色条**（`boss.bars` 条，每条 ≈ 基准 DPS×5s，打空一条露出下一层颜色，`BOSS_BAR_COLORS` 8 色循环，`#bosslayer` 显示 ×N）。
- 调试：`__air.hangar` / `__air.setHangarLevel(n)` / `__air.tryHangarLevelUp()`。

## 4. spineEnemies.js API

```js
initSpine()                        // window.PIXI 垫片 + 动态 import pixi-spine
loadSpineEnemies(names)            // 批量加载 JSON 骨骼（/res/enemies-spine/<n>/<n>.json）
loadSpineBinary(name, base)        // 二进制 .skel 骨骼（Boss 用，/res/boss-spine）
makeSpineEnemy(name, targetPx)     // 实例化并按包围盒归一化高度（包围盒有缓存）
spinePlayHit(sp)                   // 受击动画（track1 叠放）
collectSpineTextures(sp, max)      // 收集当前渲染部件贴图（碎裂效果用）
```

## 5. 调试接口 window.__air

```js
{ app, spawnExplosion, spawnEnemy, spawnFormation, spawnPickup, weaponLv, player,
  enemies, cam, tryNuke, checkEvolve, setScene, SCENES, chunks, touchMove, tryNitro,
  spawnBoss, getBoss(), getLevel(), bossDamage, advanceLevel, getAudio(),
  hangar, tryHangarLevelUp, setHangarLevel(n) }
```
- `touchMove {x,y}`：当前摇杆输入向量（调试触屏用）。`getAudio()`：`{state,bufs,failed,bgm}` 音频状态。
- 常用操作：`spawnBoss(3)` 召 Boss、按 `p`/点「火力全开」一键满改、`advanceLevel()` 跳关、按 `5` 切极光光束、按 `b` 核弹、按 `U` 机体升级、`setHangarLevel(20)` 跳养成等级。

## 6. 验证约定（Playwright）

- 无头截图验证：`chromium.launch({ channel: 'msedge', headless: true })`，访问 dev 服务器。
- 临时脚本放 `scripts/_xxx.mjs`，输出图片到 `scripts/out/`，**验证完删除脚本**（保留 out 图片）。
- 性能测量注意：无头软渲染会出现游戏代码之外的伪影长帧（tick 时间 0-2ms 但帧间隔大），以 p95/p99 为准。
- 长期保留的回归脚本：`scripts/air-nuke.mjs`、`scripts/forest-ki.mjs` 等（无下划线前缀）。

## 7. 素材来源与许可

| 资源 | 路径 | 来源/许可 |
|---|---|---|
| 星空地表 | `/res/tiles/space/` | Screaming Brain Studios Seamless Space Backgrounds（CC0） |
| 行星/恒星 | `/res/tiles/space/planets/` | 同作者 2D Planet Pack 2（CC0），`.tmp-space/` 有 400+ 备选 |
| 飞机/子弹 | `/res/shmup/` | Kenney Pixel Shmup（CC0） |
| 爆炸序列帧 | `/res/shmup/explosions/` | elnineo（CC0） |
| 粒子贴图 | `/res/particles/` | Kenney Particle Pack（CC0） |
| 敌机骨骼 | `/res/enemies-spine/` | 用户素材 C1920（Spine 3.8 JSON） |
| Boss 骨骼 | `/res/boss-spine/` | 用户素材 `E:\soft\xiaoshuodongtai\juese`（258 角色，Spine 3.8 .skel 二进制） |
| 弹道特效帧 | `/res/bullets-fx/` | 用户素材 B044（5 帧序列，朝左） |
| 战斗音效 | `/res/sfx/apk/` | 用户 资源.apk 提取（assets/audio，未加密 MP3） |
| BGM | `/res/music/` | 同上（battle_bk0-2 + Boss_Room） |
| 旧地面图集（停用） | `/res/tiles/lpc_*` | LPC bluecarrot16（CC-BY-SA） |

注意：资源.apk 图片曾用 "GaMe" 头加密（TEA），现已全部解密提取完毕，后续基本用不到，细节见 `飞机升级系统对接文档.md`；音频未加密。
玩家机/僚机骨骼：风暴雷神 `fengbaoleishen`、挂载 `guazai_L15`，来自 `骨骼动画.html`/`skeleton_models.json`（原厂素材，公开发布需替换授权素材）。

## 8. 页面结构 / HUD / 触屏控件（air-combat.html）

- **竖版布局**：`#host` 用 `min(100vw, 100vh*9/16)` 信箱化；`#status` 顶部紧凑条（血条/分/关/核弹/连击/武器，id 被 `updateHud` 引用）；`#bossbar` Boss 血条；`#fps` 右下。
- **触屏 `#touch` + `setupTouch()`（airCombat.js 输入区）**：
  - 左半屏**浮动摇杆**（`#joy`/`#joy-knob`），输出到 `touchMove{x,y}`，喂进飞行输入 `ix/iy`。
  - 右侧按钮：`#btn-max`(火力全开=`maxAllWeapons`) / `#btn-weapon`(换弹) / `#btn-boost`(冲刺=`tryNitro`) / `#btn-nuke`(核弹)。左侧 `#btn-up`(机体升级=`tryHangarLevelUp`，桌面按 `U`/`L`)。`#btn-restart` 结算重开。
  - **iOS 卡死已修**：move/up/cancel 监听挂 `window`（不是图层）、去掉不稳的 `setPointerCapture`、**新触摸永远可接管**（漏发释放也自愈）、`touchend/touchcancel` 兜底复位。改触屏逻辑务必保持这几点。
- 开火全自动（无按钮）；键鼠/滚轮在桌面仍可用。

## 9. 移动端性能与调试浮层

真机瓶颈排序（实测 iPhone）：**渲染分辨率填充率 > Spine 骨骼数 > 粒子/碎片数**；批处理正常（draws 只有一两百，不是瓶颈）。已做的降配：

| 手段 | 变量/位置 | 值 |
|---|---|---|
| 渲染分辨率上限 | `PIXI.Application({resolution})` | 手机 1x / 桌面 2x |
| 同屏 Spine 敌机封顶 | `SPINE_CAP`（`spawnEnemy` 超额回退静态贴图） | 手机 6 |
| 活跃粒子封顶 | `FX_BUDGET`（`spawnParticle` 超额丢弃） | 手机 120 |
| 碎片封顶 | `DEBRIS_CAP`（`spawnShard`） | 手机 40 |
| 环境粒子密度 | `PFX`（`updateAmbient`） | 手机 0.5 |
| 相机视野 | `ZOOM_N`/`ZOOM_B` | 手机拉近(1.32/1.16)，机体放大 2 倍 |

**调试浮层**：URL 加 `?debug=1`，`DEBUG` 分支在 FPS 块里刷新 `FPS / DPR·res / canvas·css / host·win / zoom·draws / objs·plane / fx·chunks / enemies(spine)·bullets`。`draws` 由 hook `gl.drawElements/drawArrays` 统计。真机排查让用户截这个图。

## 10. 部署

- **构建**：`cd web && npm run build` → `dist/`（`vite.config.js` 只打 `air-combat.html`，`base=/updatesoft/fj/`，closeBundle 复制一份 `index.html`）。`public/res/` 整包拷入，约 40MB。
- **上线**：`web/scripts/_deploy.py`（paramiko）——`tar` 打包 `dist` → SFTP 上传到 `/opt/yql/www/soft/fj` → 远端解包覆盖。密码走环境变量：
  ```powershell
  cd web; tar -czf dist.tar.gz -C dist .   # _deploy.py 会用这个包
  $env:DEPLOY_PW='<密码>'; python scripts/_deploy.py
  ```
  （脚本内不含明文密码。服务器 `root@8.162.5.160`，目标目录 `/opt/yql/www/soft/fj`。）
- **线上地址**：`https://update.cocoaihj.com/updatesoft/fj/`。改部署路径要同步改 `vite.config.js` 的 `DEPLOY_BASE`（务必以 `/` 开头结尾）并重新构建。
- **第二个部署目标：Noita 地图模块查看器**（`src/noita-map/`，文档 `src/noita-map/README.md`）——独立目录，不碰空战：
  ```powershell
  cd web; npm run build:noita                       # BUILD_TARGET=noita → dist-noita/（base /updatesoft/noita/，只带 res/noita 11MB，含 Worker chunk）
  tar -czf dist-noita.tar.gz -C dist-noita .
  $env:DEPLOY_PW='<密码>'; python scripts/_deploy.py noita   # → /opt/yql/www/soft/noita
  ```
  线上：`https://update.cocoaihj.com/updatesoft/noita/`（`?bench=20` 自动跑分）、可玩原型 `noita-play.html`。构建 target 是 es2022（查看器用顶层 await），iOS 15+ / Chrome 89+。
- **操作日志接收器**（排查手机上“走不动”等手感问题）：`scripts/noita-log-server.py` 跑在服务器 `/opt/yql/noita-log/server.py`（systemd `noita-log`，端口 8787），
  nginx 容器 `ai-device-nginx` 的 `update.cocoaihj.com` / 10004 两个 server 块加了 `location /updatesoft/noita-log/ → 172.18.0.1:8787`
  （配置在宿主机 `/opt/yql/docker/nginx/conf.d/default.conf`，有 `.bak-noita-log` 备份）。部署/更新：`python scripts/_deploy_logsrv.py`。
  前端 `src/noita-map/OpLog.js` 记输入变化 / 每秒位置 / 跳落 / **卡住（含周围材质 ASCII 图，立刻上传）** / 报错，20s 一批，切后台 beacon。
  **看日志**：`node scripts/noita-logs.mjs` 列会话，`node scripts/noita-logs.mjs <文件>` 看卡住/上报事件。远端执行命令：`python scripts/_ssh.py -f scripts/_remote.txt`。
- nginx 只需静态服务该目录，**勿加 SPA 回退**（会把 .js/.mp3 404 回退成 HTML）。首屏约 40MB，加载界面已顶住白屏。

## 11. 常用调参速查

| 想调什么 | 位置 |
|---|---|
| 敌潮频率/规模 | `updateHorde` 里 `hordeT` 公式与 `n` |
| 每波编队数/敌机上限 | `nextWave` 里 `cap`/`maxEnemies` |
| 敌机血量成长 | `enemyHpOf`：`TTK_MOB` / `TIER_RATIO` / 关卡 `0.12` |
| Boss 血量曲线 | `spawnBoss` 里 `weaponMul` × `enemyHpOf('boss')` |
| 机体养成曲线 | `player_data.json`；映射 `HP_SCALE` / `atkMul` / `defMitigate` |
| 光束伤害/宽度/射程 | `fireKind` kind4 的 `power`/`maxLen`；`updateAuroraBeam` 的 `dmg`/tick 0.07s |
| 防护罩容量/掉率 | `shieldMax()`（maxHp×0.4）；`maybeDrop` 里 `r < 0.32` |
| 行星/黑洞出现率 | `genChunk` 星空装饰段 roll 阈值（0.035/0.085/0.3） |
| 流星密度 | `updateSpaceFx` 里 `meteorT` 重置值 |
| 玩家机大小 | `HERO.disp`（bake 块里 `230/HCELL`） |
| 僚机大小/位置 | `WING.disp`（`124/WCELL`）；`wingSprs` 更新里 `back`/`side`；浮游炮 `addOption` 里 `WING.disp*0.82` |
| 手机同屏骨骼上限 | `SPINE_CAP` |
| 手机粒子/碎片上限 | `FX_BUDGET` / `DEBRIS_CAP` |
| 手机视野/画质 | `ZOOM_N`·`ZOOM_B`；`resolution` 上限 |
