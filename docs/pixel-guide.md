# 像素巫师(pixel-demo)· AI 接力文档

> 面向下一个 AI 会话 / 新开发者。改动前读对应章节,改完更新本文与 `noita-plan.md` 的「现状」。
> 项目目标:把 Noita(材质模拟×涌现反应×构筑×探索)复刻到手机。总体规划见 `docs/noita-plan.md`。

## 0. 先读这一段:地图到底有没有人工

**「没有人工干预那就牛逼了」——这句话是错的,也是我们反复翻车的根。**

Noita 地下地图**不是**每局算法现画洞穴。牛逼的不是「零人工」,而是**人工只发生一次**:

| 谁干 | 干什么 | 何时 |
|---|---|---|
| 艺术家(Nolla) | 手绘一整套 wang 砖:`coalmine.png` 里 H 砖 56×28 ×72 + V 砖 28×56 ×72。形状、煤脉、水池、spawn 彩点全是画的 | 做游戏时画一次 |
| 引擎 | Herringbone 边色约束拼装 + `color_material` 灰阶换本群系材质 + lua 概率表决定「这个点出不出怪/罐」 | **每局零画家** |
| 设计师 | `biome_map.png` 手绘大区拓扑;Pixel Scenes 手绘 setpiece 盖章 | 做游戏时画一次 |

对照参考:`E:\soft\xiaoshuodongtai\5\f01148.jpg`(矿坑实机)。那些「看起来随机、其实像关卡」的走廊/悬台/水洼,全是砖里画好的;浮空不掉是因为**静态地形默认稳定,崩塌必须由破坏触发**。

我们之前失败的路径=「每局用噪声/醉汉走/CA 现雕形状」。那条路永远到不了商业观感,因为**形状层本身没有作者**。正确做法=套它的构建流程:

1. **拿它的手绘砖**(真 `coalmine.png`,不是简化版 `inside.png`)
2. **按它的语义映射进我们的材质表**(白→土+石斑、深灰→煤、浅灰→石、成片青→水、彩点→P2 标记)
3. **算法只拼、不改形状**(禁 CA 平滑/禁板层再雕/禁出生沉降)
4. **内容层另走 pass**(P1 分区脉络 / P2 标记掷骰 / P3 布景 / P4 修饰符)

「需要手动的部分」=那 144 块砖。已经从 wiki 原图转进 `tileset-hb-h/v.png`,转换器是 `scripts/convert-coalmine.mjs`。下一任不要再发明一套随机雕洞。

## 1. 运行与文件

- **运行**:`cd web && npm run dev` → `http://localhost:5177/pixel-demo.html`(端口被占会 +1,以终端为准)
- **文件**:`web/pixel-demo.html`(面板/样式)+ `web/src/demo/pixelDemo.js`(全部逻辑,单文件,纯 Canvas2D 零依赖)
- **资产**:`web/public/res/pixel-tiles/` 下 `tileset.png`(阶段B网格瓦片,回退用)+ `tileset-hb-h.png`/`tileset-hb-v.png`(**真 coalmine.png 转换版**,主路径,见 §3.1)
- **源图**:`web/noita-ref/coalmine-real.png`(**data.wak 无损原件**,348×448 stbhw corner 模板,s=13)+ `web/noita-ref/unpacked/`(解包产物,见 §3.1)。旧 wiki `coalmine.png`(708×904,JPEG 噪声)只留作对照,转换器已不用
- **工具**:`scripts/convert-coalmine.mjs`(无损模板→HB 砖)+ `scripts/unpack-wak.mjs`(读 `data.wak` 目录/抽出)+ `scripts/gen-pixel-tiles.mjs`(程序瓦片,仅回退)
- **对照帧**:`E:\soft\xiaoshuodongtai\5\`(5.mp4 拆帧)。地表 f00015–f00052 / 洞内 f00306–f00375 / 爆炸 f01038–f01053 / **矿坑构图 f01148**
- **调试**:`window.__pixel`:`grid/SW/SH/player/mobs/explode(x,y,r)/spawnMob(kind,x,y)/regen/electrify(x,y)/elec/paintAt(x,y,mat,r)/setWand/WANDS/SPELLS/fireWeapon/castBlockAt/probe()(发光体快照)/getShake/M(材质常量表)/hbInfo()(连通率/重掷次数/HB砖数/陶罐吊灯落地数)/wangMarks/mobSpawnPts(P2 标记与刷怪点)`

## 2. 系统索引(按 pixelDemo.js 内出现顺序,搜标识符)

| 系统 | 标识符 | 要点 |
|---|---|---|
| 模拟网格 | `SW=640 SH=520`,`grid/aux/moved/shade` | aux=火/气寿命;moved=帧奇偶防重复更新;shade=随机相位(熔岩泡点/背景墙)+弹坑焦痕(>26 才生效) |
| 材质纹理 | `MATTEX`(16×64×64 平铺贴图),render 里 `(m<<12)\|((wy&63)<<6)\|(wx&63)` 采样 | **Noita 真方案**(materials.xml 每材质带 texture_file 按世界坐标平铺;原版 randomize_colors 从不启用——逐像素随机噪点恰是它明确不用的):程序生成配方=可平铺 value noise+确定性哈希颗粒,石=斑块+裂缝脉络/沙=波纹+深浅颗粒/土=团块+石子/木=年轮纹/金=闪点+暗缝/冰=斜纹+晶面/液体=极低幅低频(液体是"面"不是"粒")。改配方搜 `buildMatTex` 区块 |
| 边缘换色 | render 世界扫描内 `upO/dnO/sdO` | Noita pixel_top/bottom/side 移植:固体贴空气→顶边受光高光/底边阴影/侧边微亮,团块自带立体描边;**加法项必须乘 k(光照系数)**——暗处固定亮边会把洞壁锯齿点亮成"狗啃";边缘 lum 提亮以乘法为主(×1.34+3),常数加法 +14 曾让全图轮廓在纯黑里若隐若现=满屏碎线 |
| 去齿遍 | regen CA 平滑后的第三遍(搜 `去齿遍`) | 多数表决拔 1px 孤齿:8 邻域实心数 ≤3 的石头是齿不是墙 → 挖掉;配合 CA 两遍,洞壁轮廓成连续曲线(狗啃感三来源:孤齿+暗处亮边+裂缝纹过粗,都已修) |
| 取景窗 | `VW=320 VH=180`,`cam`,`vIdx(wx,wy)` | 世界大于屏幕,镜头跟随;**一切渲染写入必须过 vIdx**。分辨率对标 Noita(它一屏约 427×240):同屏世界像素越多画面越"细腻逼真",这是粒度感的根,不是滤镜能补的 |
| 激活窗口 | `simWindow()`,`SIM_PAD=48` | Noita 区块休眠低配版:stepSim/computeLight 只扫视口±48px,屏外世界冻结。世界扩大后全图扫描会掉到 38fps,限窗后极端负载(整片油海着火+爆炸+连发)61fps。边距 48 > 光照最大传播距离 36 |
| 材质 | `M_EMPTY..M_COAL`(17 种,总数=`NMAT`) | 新材质:M_COAL 之后加常量+改 `NMAT`(所有按材质下标的表都用它)+`IS_SOLID/IS_LIQUID/IS_GAS/DENSITY/DISPERSE`+`COL`+MATTEX 配方+minimap 色+igniteAt 反应+`__pixel.M` 导出(坑#12)。**煤(M_COAL)≠火药(M_POWDER)**:煤缓燃不爆(igniteAt 0.05/帧,阴燃前锋≈3px/s),火药进爆炸队列——coalmine 煤脉曾映射成火药,任何流窜火星(炎热修饰符自燃油/熔岩海)都连环爆图("地图自己爆了"事故 2026-09)。火药只留给桶/陶罐 |
| 落沙核心 | `stepSim()` | 下→上扫粉末/液体(密度交换/横向流平),上→下扫火/气(气体在液体里冒泡);`expQueue` 火药链爆逐帧扩散 |
| 电场 | `elec`,`CONDUCTIVE`,`electrify(x,y)` | 洪泛带电 50 帧;油不导电;带电液自发光+频闪+爬弧 |
| 闪电 | `bolts`,`spawnBolt()` | 中点位移折线+分叉,光栅化进像素缓冲;电的一切"形态"靠它 |
| 爆炸 | `explode(x,y,r)` | 实心→飞屑(落地回沉积)、弹坑熏黑(shade+45)、冲击玩家/敌人;爆心先 `splashLiquid`(水下爆炸=喷泉)。**三阶段时序(5.mp4 boom 段逐帧标定)**:①起爆光球(flash r=r*2.6 cap42+light 大盘照亮地形,b0032"金黄淹没")②火星喷泉 ≤110 颗+火球团 ≤10 个(addSpark big 参数=大光团,浮力上滚,b0036)③坑缘挂火(贴坑壁空气格放长命明火 aux70~140,b0090"断口挂火苗");烟量 r*2.8 寿命 80+90 |
| 液体飞溅 | `splashLiquid(x,y,r,power,frac)` | **Noita GDC 原方案**:把网格液体像素拽出来扔进 parts 弹道粒子,落地重新沉积——水花是真的水,溅出的油能被点燃。挂在:玩家/怪物入水(按落速)、动能弹穿液(入水口+水阻)、子弹命中液面、爆炸。配套:updateParts 里**上升中(vy<0)的粒子可穿过液体**,否则池内掀起的像素一格就沉积,水花只剩边缘几粒 |
| 玩家 | `player`,`updatePlayer` | 重力/行走(1px 上台阶)/喷气(fuel)/游泳(air 氧气)/染色 stains/吸金;`hurtPlayer(d,force)` force=无视无敌帧(溺水/电击) |
| 染色 | `stWet/stOil/stBlood`,`igniteShip` | 湿=防燃电更疼;油=打滑烧 2.2×;血=防燃暴击 1.35×;水洗油;敌人同款(`mb.wet/oiled`) |
| 技能(M2) | `SPELLS/WANDS`,`buildBlock/castBlockAt/fireWeapon/payloadImpact` | Noita 卡组求值模型,见 §2.1;载荷哲学不变=命中注入真材质,反应由模拟层涌现 |
| 命中三件套 | payloadImpact kinetic 分支 | **Noita 模型:每颗弹命中=微型爆炸**「坑(small r2/大 r4)+真材质色碎屑沿反射向喷回(parts.col 覆盖显示色)+白热火花锥」;非 small 附带冲击波溅伤+击退;直击怪=击退按弹速给足+白闪+按伤害喷尸液。**爆裂弹头 `expl` 修正卡**(Noita Explosive Projectile 同构):命中附带 explode(m.explR+=6,可叠,叠二 r12 质变,cap 22) |
| 敌人 | `mobs`,`spawnMob/updateMobs/processMobDeaths` | fighter(Kenney 精灵,流油,坠毁殉爆)/blood/oil/caster(施法怪:悬浮保持射程→往玩家头顶倒油 46 帧→火弹点脚下,`mb.pour`+`ebullets.fire`);**死亡处理有防重入锁 deathsBusy,勿改回递归** |
| 一局目标 | `quest`,regen 末尾放置,拾取/交付在 updatePlayer 尾部 | M1 循环:深渊底石壳密室取星之核(seek→carry)→回地表祭坛(won);死亡倒计时后 `regen()` 整局重开(金块清零);R=新一局;信标/横幅/小地图标记在 render 尾部 |
| 结构物 | regen 内搜 `结构物`(桥/井架/支撑架/`barrel`) | **Noita 原则:每件结构要"有理由存在",道具=装真材质的容器**。桥只跨真沟壑(扫 hs 找两侧沿口等高的下凹,桥面与沿口齐平);井架立在入口竖井正上方+双火把=全图路标;坑道支撑架找"净高7~13px 顶地都实"的真坑道;油桶/火药桶=木壳5×6装真油/火药(打破漏油/火燎殉爆全靠模拟涌现,深层火药桶概率高)。**禁止无条件随机摆结构** |
| 金块经济 | `M_GOLD`,killEnemy 掉金,吸金在 updatePlayer | 金=真实粉末,会被炸飞/掉岩浆湮灭;矿脉浅层稀深层肥 |
| 崩塌 | `checkCollapse/markCollapse/landChunk/updateChunks`,`chunks` | **Noita 真语义:静态地形默认稳定,浮空是合法状态,崩塌必须由破坏"触发"**。手绘瓦片里的悬空平台/悬梁是作者画的关卡设计——出生 instant 沉降与 150 帧周期巡检会把它们全砸下来堵死走廊("太密集"元凶),都已移除(instant 只剩程序生成回退路径用)。破坏源(爆炸/动能/钻头)`markCollapse` 标脏→6 帧内结算,**窗口=脏区±88 与 simWindow 取交**(只崩被破坏波及的结构,屏内无关浮台靠"窗口边界固体=锚"的保守语义豁免);支撑洪泛→悬空 CHUNKABLE(石/冰/土/木/苔)连通块抠成下落实体;落地写回+压伤+排开液体+标脏链式复检。巨块保险丝 30000 格 |
| 宏观分区(P1) | `ZONE_MAP/zoneGrid/zoneAt`,regen 内`P1 宏观分区落地`,`sancts` | **Noita biome_map 思路:区域拓扑手绘,算法只填内部**。**手绘砖在时不要换群系皮**:原版 coalmine.xml 的材质是砖内 wang_color + MaterialComponent(深层稀金),冰/油是 snowcave 等别的群系。HB 路径只在深矿/宝库稀有金脉;程序回退才走冰窟/油田/火药脉 blob。圣所×2=层间回血室 |
| 群系修饰符(P4) | `WORLD_MODS/worldMod`,regen 开头掷骰,挂钩:igniteAt(潮湿×0.35)/stepSim 开头(炎热油面采样自燃)/render amb×0.5 两处(黑暗) | **Noita biome modifier:按局随机改全局规则,开局横幅明示**。34% 无/22% 潮湿/22% 炎热/22% 黑暗;调试 `getMod()/setMod(id)`。加新修饰=WORLD_MODS 加一行+找挂钩点 |
| 布景池(P3) | `sceneTiles/loadScenes/stampScenes`,资产 `tileset-scenes.png`(6景×2变体 48×36) | **Noita Pixel Scenes 思路:手绘 setpiece 盖章,color_material 随机化**。祭坛/实验室/藏骨室/油库/苔园/营地;#ff8000=槽色,盖章时整景统一掷骰换真材质(油/水/火药/金/血);布景内标记走 P2 管线(敌锚=守卫/吊灯/陶罐);放置条件=宿主腔开放率≥45%+石基下方过半固体(防崩塌拆家)+间距96px;白=保留原地形 ⇒ 布景是"腔内家具"不是"硬贴的邮票"。每图 3~4 景,`hbInfo().scenes/scenesAt` |
| 标记像素(P2) | `wangMarks/mobSpawnPts`,`placeVessel/placeLamp`,regen 内`P2 微观标记像素落地`,updateMobs 内懒生成 | **位置是砖里画的,出什么运行时掷**。对齐 `coalmine.lua`:小怪主路 `spawn_percent=2.1*depth+0.2`(浅层 80% 空标,深层才密)+表内空槽;陶罐≈g_props 87%;吊灯≈g_lamp 64%。陶罐=木壳 5×5 装随机材质;吊灯=石链+链末灯火。**所有火把就位后必须跑明火总检**(坑#8/#18) |
| 地图生成 | `regen()` | 见 §0+§3.1。地表=大起伏噪声+坡度钳制+滑动平均;地下=**真 coalmine 手绘砖** Herringbone 拼装(`hbGenerate`)+主矿井直通矿底+`ugConnectivity`。手绘砖阈值 **50%**(封闭藏宝腔是设计,不是失败);程序回退仍 80%。**禁 CA / 禁板层再雕 / 禁出生沉降**。竖井是关卡结构不是救援补丁 |
| 画面分层 | `bgGrid/BG_PAL`(背景墙)`M_MOSS`(植被)`torches`(光锚)`motes`(浮尘) | 4.mp4 逐帧分析的产物;背景墙按群系调色、受光照但压暗;**bgid=4=背景木架剪影**(5.mp4 地洞段:洞腔背景每 30px 竖梁+24px 横梁分舱错相,纵深第二层,贴地形边 2px 不画防糊边) |
| 洞穴黑暗氛围 | amb 公式+玩家 splatLight 光环+upO 草皮+背景墙衰减 | **f306-f375 / f186-f305 标定:大面积纯黑,画面由光源驱动——"暗处不该亮"要逐项抓**:①浮尘必须乘所在格光照(冰川雪点不受光=黑洞窟满屏"星星")②液面高光/波光加法项乘 k(黑暗水池不该自己亮成一排点)③边缘 lum 乘法为主(见"边缘换色"行)。地下 amb=max(10, 235-深度*4.2);玩家光环 splatLight(r34,amp190)。**草皮=Noita `grows_grass`:只土/苔顶面长草,石/煤顶面不长**(全材质描绿边=满图碎绿线,f01148 对照) |
| 视差远山 | `genRidges/ridgeF/M/C`(2048 长分形脊线,每局重掷)+render 按列采样 rF/rM/rC | **f15/f26/f31 商业配方四件套**:①山形=ridged noise(多倍频 value noise 过 `amp-|n|` 折叠,峰尖谷缓——|sin| 圆弧山一眼假)②三层空气透视(远 146,92,68 亮≈天色/中 106,62,52/近 60,38,40 暗),视差 0.13/0.3/0.52③**近山脊线烙针叶林剪影**(不规则间隔小三角,轮廓才有内容)④**太阳光晕**(屏幕系锚点 VW*0.24,r=90 平方衰减暖光,罩天空、半罩远山=逆光透光)。山色画到 surfY=永远接地;**草皮发丝**:地表线上 1~2px 草茎(确定性 hash 不闪烁,森林绿/油田枯黄/冰川不长) |
| 地表大起伏 | regen 内 o1/o1b/o2/o3 四层噪声+1.25 次幂增陡+**全局归一** | f26/f31/f36 标定:Noita 地表落差近半屏,**且起伏尺度=一屏一个**(主山体波长必须 > 视口宽 VW,否则一屏挤几个山头像波浪线)。o1(420,36)主山体+o1b(170,14)山肩+o2(80,4)坡地,**不要高频细节噪声**(o3 那种 22px 波长的"质感"=表面毛刺);非线性 pow 让山更高谷更深;**生成后把本局高度带线性拉满 50~124**(噪声随机会让某些局整体贴底,落差缩水一半——归一保证每局都有高山深谷,实测稳定 76px=视口 42%);**归一后必须坡度钳制**(双向松弛,相邻列高差 ≤3px):拉伸会放大坡度出现玩家爬不上的立壁,地表必须双向可通行(行走测试:按住 d+跳 10s 能横穿全图);**钳制后再 3 遍 5 点加权滑动平均**——归一/钳制/幂增陡都会留 1~3px 小台阶,Noita 的丝滑弧线靠平滑逼出来(毛刺率 ≤30/636 列) |
| 地表风景物 | `midGrid/MID_PAL` 中景装饰层;regen 内松树/大蘑菇生成(treeXs 控间距) | **Noita 地表基本没有小木桩**——只有少量大尺度风景物,且树是"中景":写 midGrid 不写 grid,**不碰撞不挡弹,渲染在空气格=永远在地形与玩家身后**。松树 ≤7 棵:20~32px,2px 干+锥形苔冠(每 4px 枝盘外扩),树距 ≥26;大蘑菇 2~3 朵。regen 记得 midGrid.fill(0)。旧版 26 棵 7px 实体"棒棒糖"是反面教材(挡路+像篱笆) |
| 光照 | `computeLight()`,`light` | 两遍扫描传播(含对角);岩石挡光/液体吸光;环境光随深度变暗;巫师提灯光盘 |
| 渲染 | `render()` | 世界扫描→浮尘→碎屑→子弹(拖尾)→敌弹→火花→闪光→闪电→怪→巫师→精灵层→放大+辉光 bloom→HUD→小地图 |
| 元素质感 | 世界扫描内的分支(搜 `火舌`/`波光`/`白热泡点`) | 纯渲染层不改模拟:火=稀疏颗粒+表面**火舌**向上舔1-3px+上升余烬;熔岩表面=白热泡点游走+迸渣;液面=高光条+**流动波光**(亮斑沿面漂移,水的波光进辉光层);水体=越深越暗(探上方6格)+**半透明混背景墙 34%**(Noita water α≈0.63) |
| 配色标定 | `COL` 表注释 | **对标 Noita materials.xml 实值**(数值可对标,贴图 PNG 是 Nolla 版权资产不能搬):rock #313b36 深橄榄灰/soil #36311e/water #376259 暗青绿/sand #b89e57 金橄榄/gold #ffd054,按我们光照提亮~1.3×。铁律:**世界底色要暗要灰,亮的只有光源和金子** |
| 粒子细腻度 | render 尾部`化妆粒子层`、`splashLiquid` 微雾 | **Noita 双粒子架构移植**:①材质粒子(parts,写回网格)保持世界分辨率;②装饰火花(sparks)= **化妆粒子层**——放大后按**屏幕分辨率**画(浮点坐标+alpha+lighter 加法混合),一颗火星=半个世界像素的亮核+淡光晕,配**速度拖影**(头亮尾暗细线)+**生命周期色带**(白热→本色→暖色收暗红/冷色等比暗)+**乱流**。碎屑高速补尾像素;飞溅=液滴+微雾双层;爆炸带余烬雨;气体按寿命**稀疏抖动**溶解(烟不再是实心黑块)。上限 sparks 800/parts 2600,实测 61fps |
| 辉光 | `ebuf/emis` | 发光体单独一张 canvas,blur 两档 lighter 叠回;**震屏偏移必须是 SCALE 整倍数且衰减硬归零**(否则重影) |

### 2.1 M2 法杖卡组系统(2026-08 落地,Noita 求值模型移植)

依据 Noita wiki《Expert Guide: Draw》/《Advanced Guide To Wand Mechanics》:

- **法杖 = 卡组**:`WANDS[i].slots` 是卡序列,运行时 `deck/discard` 两堆;抽空整轮 → `reloadWand`(洗牌杖乱序)+ 装填计时 `recT`。三参数:施法延迟 `cdT` 按施法块结算(块内卡 cd 求和)、装填只在抽空后结算(与 cd 并行取大)、法力 `mana` 即时扣按秒回(负费卡可倒赚,见"聚能")
- **卡三类**(`SPELLS[id].t`):`proj` 投射卡不续抽(带 `trigger` 的额外抽出一个挂载块);`mod` 修正卡续抽 1 张,修正写进块共享 `mods`(一张强化吃全块投射物,Noita 语义);`multi` 多重卡续抽 N 张(`fan3` 带扇形 spread)
- **求值**:`fireWeapon` → `buildBlock`(递归抽卡,没蓝的卡直接跳过进弃牌)→ `castBlockAt` 全部投射物带累计修正一齐射出。**触发弹命中 → `triggerCast` 施放挂载块,挂载块 cd 被完全无视**(Noita rapid 构筑核心,故意保留)
- **投射卡字段**:`pay` 载荷分支(payloadImpact)/`grav` 抛物线/`wobble` 火花弹游走/`trail` 飞行滴火星/`drill` 钻磨;修正提供 弹跳/裂解/追踪/拖油/拖水/加速/强化/急速(-cd)/聚能(-蓝耗)
- **改卡/改杖**:加卡=SPELLS 加一行;预设杖=WANDS 数组;HUD 自动显示法力条+卡组进度点,面板自动列卡组
- **VFX 配套**:子弹动态光 `splatLight`(render 里 computeLight 后把每颗弹当移动光源 splat 进 `light`,洞窟被弹道照亮——华丽感大头);枪口锥形火花+闪光+微震;命中载荷色闪光+烟团

## 3. 地图资产管线(阶段B,商业化分水岭)

**核心思想:地图质量取决于"画得多好"而非"代码多巧"。**

- 瓦片集:`public/res/pixel-tiles/tileset.png`,10 块 48×40 横排,顺序对应 `PNG_MANIFEST`(名称/权重/minRow 深层限定)
- **颜色→材质映射**(`PNG_MAT`,必须精确匹配):

| 颜色 | 含义 |
|---|---|
| `#ffffff` 白 | 保留墙(不动) |
| `#000000` 黑 | 空气(挖空) |
| `#3a6fd8` | 水 |
| `#6b5a20` | 油 |
| `#ff5a10` | 熔岩 |
| `#c9a86a` | 沙 |
| `#34343a` | 煤脉(M_COAL,缓燃不爆;火药 M_POWDER 只装在桶/陶罐里,不准嵌墙) |
| `#ffd054` | 金矿 |
| `#7a5230` | 木 |
| `#94cae8` | 冰 |
| `#588c30` | 苔藓 |
| `#705034` | 泥土 |
| `#ff00ff` 洋红 | 火把标记(挖空+长明火) |
| `#ff0080` | P2 敌人锚点(80% 转懒生成刷怪点) |
| `#00ff80` | P2 陶罐(木壳装随机材质) |
| `#00ffff` | P2 吊灯(石链垂顶+灯火) |
| `#8a9a90` | 石(布景基座/台阶用,主动写入) |
| `#a41014` | 血(布景血渍) |
| `#ff8000` | P3 color_material 槽(布景实例化整景掷骰) |

- **硬约定**(违反破坏连通性):每块第 16~27 行必须可通行(空气或液体);竖井块(第 4 块)16~31 列垂直贯通
- 加载:`loadTileset()` 启动时异步加载,失败自动回退内置 ASCII 模板(demo 永远可跑);盖章流程:形状层挖空 → CA 平滑 ×2 → 填充层(空腔类填空气/矿脉类只换石头,深层水自动变熔岩)→ 火把标记入 `torches`
- **怎么灌资产(三种方式)**:
  1. **程序生成**:改 `scripts/gen-pixel-tiles.mjs` 重新生成(基础形状)
  2. **手绘**:Aseprite 直接改 tileset.png,严格用上表 hex 调色板,存 PNG 即生效
  3. **AI 生成(推荐,已验证)**:AI 画图 → `node scripts/import-tile.mjs <图片> <槽位0-9>` 自动量化+校验:
     - 导入器做三件事:最近邻缩到 48×40 → 每像素映射到调色板最近色(透明→保留墙)→ 16~27 行通行带校验(不通的列自动在 20~23 行凿开)
     - **AI 提示词模板**(实测有效):`Flat 2D pixel-art game level stencil, side-view cross-section of a <主题> chamber. STRICT limited palette, flat colors, no gradients/outlines/lighting: solid rock walls = pure white #ffffff filling all edges; open cave air = pure black #000000 forming one large cavity touching BOTH left and right edges at vertical middle height; <特色元素> = <调色板色>; ... Blocky chunky pixels, low resolution 48x40 tile map look, aliased hard edges, no anti-aliasing, no text.` 关键三点:白=墙、黑=腔、**腔必须触到左右两边中部**(通行带)
     - 案例:水晶洞瓦片(冰晶+金脉+水池)由 AI 生成导入槽位 2,量化后 202 冰/41 水/27 金,通行带零修复
- 加全新瓦片:tileset.png 右侧加一块 + `PNG_MANIFEST` 加一行(权重/minRow)
- 验证:改完跑连通性检查(BFS from 玩家,地下开放格可达率应 ≥80%,脚本模式见 §5)

### 3.1 阶段C:Herringbone Wang 砖(地下主路径=真 coalmine 手绘砖)

移植 [stbhw](https://github.com/nothings/stb/blob/master/stb_herringbone_wang_tile.h) **corner** 模式(不是旧 wiki 边色网格)。

- **解包**:游戏本体 `silu/XD220/Noita.v20250125-P2P/data/data.wak`(42MB,14745 文件,无压缩)。`node scripts/unpack-wak.mjs <wak> list` / `extract <out> <substr>`。官方也可用 `tools_modding/data_wak_unpack.bat`(= `noita.exe -wizard_unpak`)
- **现行转换器**:`scripts/convert-coalmine.mjs` ← `noita-ref/coalmine-real.png`(= wak 里 `data/wang_tiles/coalmine.png`,29390 字节)
  - 头藏在首行末 9 字节 XOR:s=13, num_color=[1,2,1,2], vary=3×3 → **H 26×13 ×72 + V 13×26 ×72**
  - 类域 EPX×2 再最近邻×3 = **6×**:26×13→156×78,`HB_S=78`,`UG_ROWS=6`(6×78=468px),世界 960×680。尺度依据见坑#26 / `noita-ref/GEN-RULES.md §二`
  - 语义映射以 `materials.xml` 的 `wang_color` 为准(RGB 精确,见转换器头注释):煤 `#505052`→M_COAL,**不是** gunpowder `#232324`;土 `#36311e`;水 `#2f554c`;木梁 `#413f24`
  - spawn 色对 `wang_scripts.csv` + `coalmine.lua` 的 `RegisterSpawnFunction`(1px 精确,无需聚类)
- **原作煤坑怎么拼内容**(学思路,别发明雕洞):
  1. **形状**=wang 砖。引擎只 herringbone 拼,连通不够就重掷整张 wang 图(`#c0ffee` OpenAlt 只用于可通行检查)
  2. **材质带**=砖内画的 wang_color + `coalmine.xml` 的 `MaterialComponent`(polka 煤、深层稀金)。**不是**再 blob 一层冰窟/油田
  3. **家具**=`coalmine.lua` 里 `g_pixel_scene_01/02`(煤坑/神龛/实验室/油罐)盖在标记色上,另有 visual.png 装饰层。解包在 `noita-ref/unpacked/biome_impl/coalmine/`
  4. **刷怪**=标记密,表带空槽,主路再按深度滤(`2.1*depth+0.2`)。浅层空才像关卡
  5. **草**=`grows_grass` 只挂 soil / sand_static 顶
- **旧 wiki 路径不要用**:708×904 JPEG 转存,要众数滤波+水连通阈值+标记聚类。`convert-noita-tiles.mjs` + `inside.png` 更是简化黑板
- **边色**:corner 模式走 `tileset-hb-meta.json` 真约束;无 meta 才 `hbDeriveEdges` 采样 `HB_S*0.36~0.63`
- **保真铁律**(违反=毁掉作者设计):
  1. `hbTiles` 存在 → CA 遍数=0,板层洞窟雕刻整段跳过,P1 不换群系皮
  2. 出生不做 `checkCollapse(..., instant)`(浮空平台是关卡,不是 bug)
  3. 手绘砖的水**不要**深层自动变熔岩
  4. 熔岩海从 `UG_Y0+UG_ROWS*HB_S+6` 才开始,先铺 6px 石壳隔离带
  5. P1 脉络 `blob(..., replaceOnly)` 基底跟主体走:`hbTiles ? M_DIRT : M_STONE`
- **连通(原作规则,GEN-RULES §四~六)**:入口=顶部清 7×11 模板格(42×66px)开口接地表,**不凿穿全深的井**;`ugFindPath` 顶→底 BFS(开放=空气/气体/秘室槽,液体算墙),走不通换种子整张重掷(≤30);之后 `resolveCoffee` 把 `#c0ffee` 秘室槽按连通区掷骰(路上的开、其余 50/50)。手绘砖零 despeckle。程序回退仍是旧的 80% 可达+主矿井
- 回退链:HB 缺失 → 阶段B 网格 → ASCII。demo 永远可跑

## 4. 已踩的坑(必读)

1. **连锁反应循环判空**:任何遍历 enemies/clouds/mobs 的循环体内若可能触发连锁死亡,取元素后必须 `if (!e) continue`
2. **死亡处理防重入**:`processMobDeaths` 的 `deathsBusy` 锁 + while 重扫,殉爆链会递归回自己
3. **像素对齐**:一切画面偏移(震屏/镜头)必须是世界像素整数倍;震屏衰减要硬归零,否则永久亚像素抖动=重影
4. **发光体位置可信度 > 亮度**:火花必须贴源头走紧抛物线(上升偏置≤10%、重力 170),飘太高会被看成"第二个光源"
5. **气体困在液体里会永久卡死成脏点** → 已加冒泡交换,别删
6. **暖色光雾系数要低**(现 0.05/0.028/0.008,见坑#29),大光源会把空气染成酱色
7. **验证时机**:改完代码立刻跑 Playwright 可能撞上 Vite HMR 重载,结果不可信;等 2-3 秒或重跑一次
8. **火把离可燃物 ≥3px**,火苗会上窜 1-2px
9. **ImageData 尺寸必须与所属画布一致**:辉光层 `eimg` 曾误建成世界尺寸(SW×SH)而画布是取景窗(VW×VH),putImageData 按 480/行解读 240/行的数据 → 全部发光体(子弹/火/熔岩)在半高处拖出无伤害"影子"。同理 `img/buf32` 也别动尺寸
10. **TypedArray 浮点下标写入被静默丢弃**:`blob()` 曾直接用 `cy-r` 当循环变量,圆心/半径带小数时整个 blob 一格不写且无任何报错——钻磨弹从未真正凿过洞、大洞窟/竖井雕刻全部空转。现 blob 内部已 floor/ceil 循环区间(圆心保留浮点参与距离判定);新写网格循环一律 `|0`
11. **程序挖的通道必须收尾**:`despeckle(x0,y0,x1,y1)` 去 1px 毛齿(只动石/土/冰,不碰木结构/桶壳);"沿 y 逐行随机晃"的竖井会凿出锯齿壁,改用正弦摆动。挖掘类弹药口径 ≥ 玩家碰撞体高度(9px)+2,否则钻进去必卡
12. **调试导出 `M` 表要与材质常量同步**:曾缺 M_ICE/M_DIRT 等,Playwright 脚本拿 undefined 比对,测试全假阴性(冰冻弹被误判失效)
13. **洞窟必须"种"在已有开放格上向外轰开**(regen 内 `findOpen`):随机位置的洞是莫名其妙的孤立气泡,种在网络上的洞是既有洞窟的自然放大。现规格:大殿堂×2(椭圆 90~150×28~42)+漫步溶洞×6(洞高16~30)
14. **玩家碰撞体是沉积禁区**(updateParts 落地分支+landChunk 写回):怪物贴脸死掉时金粉/碎屑会落进玩家身体把人"浇铸"钉住——金粉贴脸直接进钱袋,其它碎屑推到身侧继续飞
15. **崩塌判定"锚"是保守语义,且崩塌必须由破坏触发**:检测窗口边界上的固体一律视为连着大地 ⇒ 窗口要比目标结构大(曾用±40 判不出跨度>80 的浮岩,现=脏区±88);**但窗口也不能是全屏、更不能周期巡检**——Noita 语义是浮空合法、破坏才触发,无差别扫描会把手绘瓦片的悬空平台设计全砸掉("太密集"事故,2026-09)。`simWindow()` 返回顺序是 `[x0,x1,y0,y1]` 不是 `[x0,y0,x1,y1]`,解构错了窗口秒变空区域且无报错。1px 接触即算支撑,巨块保险丝 30000 格
16. **wangMarks 必须在每次生成尝试(attempt)开头清空**(与 torches 同处):标记随砖收集,连通性 reroll 不清就跨尝试累积成双倍道具;标记像素在 parseTileStrip 里挖空自身 1px,但周围仍可能是墙 ⇒ 落地函数(placeVessel)必须自带横移/抬高找位重试,直接原点硬放成功率只有 25%
17. **HB_S 不是常数是参数**:换瓦片尺寸时三处会静默坏:①`hbDeriveEdges` 硬编码采样区间越界→全部边判闭;②`hbGenerate` 的 ROWS/COLS 余量按旧尺寸算→越界;③`UG_ROWS*TILE_H` 与 `UG_ROWS*HB_S` 混用→地下底界算飞。现行 `HB_S=78`(6×,见坑#26)/`UG_ROWS=6`,新代码「地下区底部」一律写 `UG_Y0+UG_ROWS*HB_S`
18. **煤脉+明火=出生火海**:真 coalmine 自带煤(`wang_color #505052`→M_COAL,`autoignition_temperature=94`,缓燃)。任何火把±3px 有煤/木/油都会点着。曾误映射成 gunpowder(`#232324`,autoignition=1)→连环爆。`torches.push` 散落在 regen 后半段,安全检查必须放在**全部火把就位之后**
19. **wiki 的 coalmine.png 是压缩过的**:708×904 不是 `data.wak` 原件。现行源是 wak 无损 348×448 corner 模板,1px 标记不用聚类。精确 wang_color 对解包 `materials.xml`,不要用 wiki Material Colors.png
20. **连通率不是越高越好**:手绘砖故意有封闭腔。阈值 80%+救援竖井会把作者设计凿穿,地图重新变"乱挖的洞"。50%+主矿井才是 Noita 口径
21. **煤≠火药,"地图自己爆了"事故(2026-09)**:见上。煤=M_COAL 缓燃不爆;火药只装在桶/陶罐。黑暗渲染加亮项必须过光照系数
22. **手绘砖上不要叠错群系皮**:`ZONE_MAP` 的冰窟/油田 blob 是程序回退用的。HB 路径再盖冰/油=矿坑里长冰川,对照 `5\f00186-f305` 一眼假。原作换群系=换 `wang_tiles/*.png`+对应 `biome/*.xml`+`scripts/biomes/*.lua`(下一张是 `excavationsite.png`)
23. **pixel scene 材质图是"约定色"不是普通调色板**(map-lab 实证):`#ffffff`=保留原地形(不是墙!)、`#000000`=挖空、其余为真 wang_color(含布景专用:`613e02/644600/613e00/413f41` 木族、`786c42/6f5439` 神龛砖、`1d1010` 陨石、`145014` 荧光岩、`ff6000` 岩浆、`33b828` 苔藓、`45ff45/80ff80` 史莱姆、`f0bbee` 油罐内容物、`f7bb43` 金材质)。把白当墙填 → 整图糊满灰板
24. **布景锚必须互斥放置**:模板 144 块砖里有 11 个 `ff0aff/ff0080` 锚点像素 → 每 4160 块砖出 ~300 锚,而布景图 130×260 远大于砖。lua 的 `Random(1,100)>50` 只决定选哪个池、**不决定放不放**;密度靠引擎级"布景不重叠"控制。等效实现:贪心占格,撞已放矩形(±16px)跳过,300 锚 → ~24 布景
25. **矿山模板真实占比是 52% 洞 / 27.5% 白填充 / 20.5% 手摆材质**(只算砖内容区;整图统计会把砖缝边距的白算进去得出 70% 墙的错觉)。原版观感"厚实"不是墙多,是**洞腔背后渲染了暗棕背景墙层**——空气画成纯黑,一样的地图立刻显得又碎又空
26. **模板 s=13 是存储尺度不是世界尺度,原作是 10×不是 4×**:`noita-worldgen` 源码 `TILE_PX = 10`、`SMALL_CHUNK_SIZE = 512/10 = 51`(逐字节对齐游戏),煤矿砖实际 260×130 世界像素,最窄通道 2 格=20px≈1.3 玩家身高,**1 格缝(10px)也能钻**。我之前从截图目测的"4×=52"是错的——那尺度下 1 格=4px<玩家宽,所有 1 格缝变死路、2 格通道刚一人高,整图自然"挤、乱"。尺度换算公式:`世界格 = 10 × 我们玩家身高 / 原版玩家身高(≈15)`,我们 9px → 6× → HB_S=78。布景(130×260)和 MaterialComponent 都是世界像素,不跟砖一起放大
27. **材质观感=真纹理不是纯色**:materials.xml 每种固体有 `texture_file`(`materials_gfx/*.png`,32×32/48×45 无缝 tile,世界坐标取模采样);湿岩与岩石**同图异色**(rock.png 压暗偏灰绿);液体无纹理,按 materials.xml 半透明色(water `A0376259` α=0.63)压在背景上;洞腔背景=`weather_gfx/background_coalmine.png`(512×256)压暗 ~0.42。纯色+噪点抖动怎么调都是"假的"
28. **原作地图规则全集在 `noita-ref/GEN-RULES.md`**(源:`noita-ref/worldgen-src/` 的 noita-worldgen 0.6.0 + noita-telescope):世界 70×48 chunk×512px;同色 4 连通块=一个区域整体生成;wang 顶部 +4 行 padding;生成后按序做 房间封锁(锚色描矩形)→ 主群系入口(顶部清 7×11 格)→ 煤矿外框叠加层(左右各 50 格实心、顶部两个漏斗口)→ 顶到底 BFS,不通重掷 ≤99 → 恢复房间 → 路径上的 c0ffee 开、其余 50/50 → 随机换色。**没有任何平滑/去毛刺/可达占比**。转换器还修了一个老 bug:`paintStrip` 标记点漏加 `ox`,全部标记堆进第 0 块砖(表现为每局 vessels 忽 31 忽 0)
29. **"差距太大"最后一层不在生成、在渲染:墙洞反读 + 光太小**(对照 `5\f00240/f00275/f00500`,2026-09)。①旧背景墙按地表分带画斜冰纹/机械板缝/木架格子,且暗处有 0.12 亮度保底 → 环境光压黑后**背景比地形亮**,洞读成砖墙、墙读成黑洞。原作 `background_coalmine.png` 实测基色 ≈(22,24,28) 冷灰、全图对比 ±6、隐约洞形木架;现 `BGTEX` 程序纹理对标,**无保底**,乘光照(没光=纯黑)。②玩家光曾是 34px 线性小圈 + 传播光(D=7 → 32px),原作是半径 ≈200 世界px、二次衰减、**不被地形遮挡**的软光盘(隔墙邻洞也亮),按身高换算 120px(`splatLight(..., 120, 235, soft)`),火把 50px。③空气暖雾 0.12/0.055 在大光盘下把整面背景熏成酱棕,降到 0.05/0.028/0.008。④颗粒 hash 单次 imul 雪崩不足,砂粒排成斜线(放大一眼"耙痕"),改两轮 xorshift-乘。⑤草=土面顶上 1~2px 黄绿 M_MOSS 丛(62%),火把 ±5px 不长/铲掉。分区亮度查表曾还用 `/40` 老格子,应用 `ZW/ZH`

## 5. 验证约定

- 临时脚本 `web/scripts/_xxx.mjs`(Playwright,`channel:'msedge', headless:true`),输出截图到 `scripts/out/`,**验证完删除脚本保留图**
- 常用套路:`page.evaluate(() => window.__pixel...)` 摆场景 → 截图 → 读图确认;连通性=BFS;效果类问题用 `probe()` 逐帧抓发光体
- 长期工具不带下划线(如 `gen-pixel-tiles.mjs`)

## 6. 当前状态与下一步

**地图构建流程(2026-09,对齐解包原作 + GEN-RULES)**:`data.wak` → `wang_tiles/coalmine.png` → `convert-coalmine.mjs`(6×)→ HB_S=78 / UG_ROWS=6 / 144 块 / 世界 960×680。形状层不再程序雕、不 despeckle。选砖均匀随机。入口=顶部 7×11 格开口。连通=顶→底 BFS 不通重掷。秘室=c0ffee 掷骰。HB 上禁 P1 换群系皮。P2 刷怪按 `coalmine.lua` 深度曲线。崩塌=破坏触发。草=只土面。煤=M_COAL。**未移植**:煤矿外框叠加层(左右 500px 厚墙)、锚色房间封锁(现在布景还是随机撒)。

**已解包可继续吃的资产**(在 `web/noita-ref/unpacked/`):`biome_impl/coalmine/` 下煤坑/神龛/实验室/油罐 pixel scene(材质图+visual 装饰层);`scripts/biomes/coalmine.lua` 全套概率表;下一群系砖 `excavationsite.png` / `snowcave.png`。

**地图实验室 `map-lab.html`**(`src/demo/mapLab.js`,与游戏 demo 零耦合):三套系统对照——煤矿 wang 砖 / 圣山 512×282 三层整图 / 世界图 70×48。清单:`noita-ref/MAP-INVENTORY.md`。wak 已解:wang 砖 31 张、biome xml 173、biome lua 155、biome_impl 2232(含圣山 31+煤矿 75+洞穴 1014)、植被 229、材质纹理 300+。

**原版地图是三套系统,不是一套算法**:
- **世界图** `biome_map.png`:70×48 色像素,一格一种群系。换层=换颜色。
- **Wang 砖**:煤矿/雪窟/金库…可通行洞穴。形状全手绘。
- **圣山**(你第一张截图):`wang_template_file=""` + 一句 `LoadPixelScene(altar, visual, background)`。雕像/符文/几何砖纹全是 512×282 手绘,不是砖拼出来的。之前只做煤矿砖,对着圣山截图比,差距必然大。

**地表算法**(不是贴图):`hills.xml` 高度场=`SIN_CAPPED_SIMPLEX`(波长≈778px,振幅约半屏)+ `BitmapCaves` 洞选。洞选=先掷开口数 7~12,从地面破开朝下打蠕虫,再掷分叉 2~7。实验室「地表+洞选」零原作图可开关验证。公式:`noita-ref/SURFACE-ALGO.md`。移植到 `pixelDemo`=在现有 `surfY[x]` 上按这套计数打蠕虫接到 `UG_Y0`,不要搬 PNG。

**建议接力顺序**:
1. **圣山整图进游戏 demo**(三层 PNG,对照第一张截图)。不写砖算法。
2. 煤矿 P3 吃齐 visual/background;植被改 `vegetation/*.png` 实体,不要绿竖线
3. 世界图驱动垂直栈,煤矿下接 `excavationsite.png`,层间插圣山三格
4. **P6 内容 pass** / **M2 法杖** / **移动端(M3)**

**不要做**:再写一套噪声/CA/醉汉走来「让洞穴更好看」。形状上限在砖上。要更好看=盖 pixel scene,或解包下一张群系砖。
