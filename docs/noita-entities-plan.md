# Noita 实体层调研与实现计划:敌人 · 物理道具 · 物品 · 与环境的融合

> 先把原版"有什么效果"从数据里盘清楚,再动代码。数据来源全部是 `data.wak` 解包件(`noita-ref/unpacked/`),
> 调研脚本 `scripts/_survey-entities.mjs`(随时可重跑)。地图模块本身见 `src/noita-map/README.md`。

---

## 0. 现状与目标

已有:地图(wang 砖 / 布景 / 地表 / 视差天空 / 植被散件)、材质模拟(469 材质 + 328 反应)、玩家(player_base 手感、精灵、入水)、
弹丸系统(51 种,爆炸 / 材质转换 / 反弹 …)、音效、日志。

**没有的:世界里除了玩家没有任何"活的东西"**——没有敌人、没有物理箱子/油桶/矿车、没有金块/药水/法杖可捡、
没有伤害/血/尸体。地表那条虫(`animals/worm.xml`,煤矿 `g_big_enemies` 0.01 掷出,会从地里钻出来)也属于这一块,**还没做**。

目标:按下面盘出来的清单,把"世界层"补上;然后回到地图铺剩下的群系。

---

## 1. 原版有什么(数据盘点)

### 1.1 出生区会碰到的生成表(scripts/biomes/*.lua 的 `g_*` 权重表)

| 群系 | 表 | 内容 |
|---|---|---|
| mountain_hall(出生大厅) | `g_small_enemies_helpless` | 羊 0.4×1~2 · 鹿 0.2×1~2 · 驼鹿 0.2 · 鸭 0.4×1~5(全是 `helpless` 阵营,不攻击) |
| | `g_cartlike`(标记 `spawn_crate` FF5A00) | 炸药箱 · 放射桶 0.1 · 油桶 0.3 · 矿车 0.25 · 木车 0.25 · 滑板 0.005 |
| | `spawn_waterspout` FF2D00 | `props/dripping_water.xml` 滴水 |
| mountain_left_entrance | `g_props` | 石头 physics_stone_01~04(物理石块) |
| hills(丘陵) | `g_small_enemies` | 僵尸 0.3 · 矿工 0.05 · 老鼠 0.025(大半掷空) |
| | `g_unique_enemy` | 史莱姆射手 0.5×1~3 · 酸射手 0.3 · 巨射手 0.1 |
| | `g_stash` / `g_candles` / `g_lamp` / `g_pumpkins` | 心 0.6 · 蜡烛 · 矿灯 · 南瓜 |
| coalmine(煤矿) | `g_small_enemies` | zombie_weak 0.5×1~2 · slimeshooter_weak 0.1 · longleg 0.2×1~3 · miner_weak 0.25×1~2 · shotgunner_weak 0.1 |
| | `g_big_enemies` | firemage_weak 0.2 · **worm 0.01** · longleg 0.2×5~10 · miner_santa · acidshooter_weak · giantshooter_weak · fireskull · shaman · drone_shield |
| | `g_props` / `g_props2` / `g_props3` | 炸药箱 0.5 · 矿车 · 木车 · 放射桶 · 油桶 / 酿造台 / 药水 + 四色瓶子 |
| | `g_items` | wand_001~017 + wand_level_01 |
| | `g_lamp` | lantern_small 0.7(已做成光源) |
| | 标记色(未做的) | `spawn_nest`(蝇巢)· `spawn_fungi`(蘑菇怪)· `spawn_chest` 宝箱 · `spawn_shopitem` · `spawn_trapwand` · `spawn_bbqbox` · 摆锤谜题 · 油罐谜题 |

`spawn()` 的掷法(director_helpers.lua):`ProceduralRandomf(x, y, 0, total_prob)` 落在哪一项就出哪一项,`min~max` 个,
和布景/灯用的同一套 PRNG——所以**敌人/道具位置是种子确定的**,和我们已有的 `collectLights` 同构。

### 1.2 敌人(entities/animals,316 个 xml)

组件用量前列:DamageModel 251 · Sprite 203 · GenomeData(阵营)173 · Hitbox 161 · **AnimalAI 157** · PathFinding 156 ·
CharacterData 150 · **CharacterPlatforming 133**(和玩家同一个行走模型)· ItemChest 112(死亡掉落)· LuaComponent 74 ·
PhysicsAI 22(飞行/悬浮怪)· **Worm 系**(WormComponent + WormAIComponent + CellEater)。

| 敌人 | hp | 血 | 布娃娃材质 | 行为 | 备注 |
|---|---|---|---|---|---|
| sheep / deer / elk / duck | 0.1 / 0.8 / 1 / 0.1 | — | — | helpless,乱走 | 出生大厅的气氛动物 |
| zombie(_weak) | 0.5 | blood_fading | meat | 近战 0.2~0.4 | base_enemy_basic → base_humanoid |
| miner(_weak) | 1.0 | blood | meat | 近战 0.4~0.7 + 远程扔 `projectiles/tnt.xml` | 煤矿主力 |
| shotgunner | 1 | blood | meat | 远程霰弹 | |
| slimeshooter | 0.75 | radioactive_liquid | meat_slime_green | 远程 | 阵营 slimes |
| firemage | 5 | lava | lavarock_static | 远程火球 | 死了流熔岩 |
| longleg | 0.11 | — | — | 爬墙蜘蛛 | 成群 5~10 |
| fungus | 2.6 | blood_fungi | fungus_loose_trippy | 站桩喷 | |
| **worm** | 20 | blood_worm | meat_worm | `WormComponent` part_distance 10 · hitbox 5 · `CellEaterComponent` radius 6(**啃地**)· WormAI speed 2/hunt 4 · hunt_box 256 · 尾巴 gravity 30 | 从地里钻出来吃人;出生点附近常见 |

死亡:`DamageModelComponent` → `blood_material` 溅到地上(真材质像素,会和水/油反应)、`ragdoll_filenames_file`(`ragdolls/<名>/*.png` 142 套:
头/躯干/四肢各一张,`ragdoll_material` 通常 `meat`)变成一堆 box2d 肉块摔在地上、`ItemChestComponent` / `drop_money.lua` 掉**金块**
(`items/pickup/goldnugget.xml`:PhysicsBody + 图形状 + 发光粒子,捡了加钱)。

AI 参数(base_humanoid AnimalAIComponent):`sense_creatures` 视距、`attack_melee_max_distance`、`attack_ranged_min/max_distance`、
`attack_ranged_predict`、`dodge_projectiles`、`path_distance_to_target_node_to_turn_around`… 行走复用 CharacterPlatforming(重力/跳/爬台阶同玩家)。

### 1.3 物理道具(entities/props,257 个)

组件:**PhysicsImageShapeComponent 178**(一张 png = 形状 + 材质,像素归属材质、可被挖/烧/融)· DamageModel 82 · PhysicsBody2 75 ·
**ExplodeOnDamage 58** · **MaterialInventory 43**(桶/瓶子装液体)· Light 37 · PhysicsJoint 43(吊链/摆锤)· Torch 16 · PixelSprite 28。

| 道具 | 形状图 | 材质 | hp | 特性 |
|---|---|---|---|---|
| physics_box_explosive(炸药箱) | tnt.png | wood_prop | 1.0 | 死亡必炸:radius 40 · damage 2.5 · 摇镜 40 · `physics_explosion_power 1.5~2.2` 把周围物理体抛飞 · 沾污半径 15 · `main_gunpowder_medium` 粒子;**被打碎 4% 就炸**(physics_body_destruction_required 0.04) |
| physics_barrel_oil | barrel_unstable.png | metal_rust_barrel | 0.2 | 装 oil×300;`leak_on_damage_percent 0.5` 打漏就流;blood_material=oil(打它出油) |
| physics_barrel_radioactive | barrel_radioactive.png | metal_rust_barrel | 0.2 | 同上,装 radioactive_liquid |
| minecart / physics_cart / skateboard | minecart.png / cart_top.png | metal_rust / wood_prop | — | 带轮子的 box2d(PhysicsJoint),能推着走 |
| physics_stone_01~04 | stone_0x.png | rock_box2d | — | 纯物理石块(出生左坡) |
| lantern_small | lantern_small.png | glass_box2d | 0.15 | 有光,打碎灭 |
| physics_crate | crate.png | wood_prop | 2 | 木箱,可烧 |
| physics_propane_tank / seamine | | steel / metal_rust | 2 / 0.3 | 炸 |
| suspended_container 等吊挂物 | | metal_prop | — | 链 + 关节,挖掘场 |

**这些都是"像素刚体"**:形状图里每个像素就是世界里一个材质格(材质 `*_box2d` / `wood_prop` / `metal_rust_barrel`),
刚体整体做 box2d 运动,像素随刚体走;被挖掉像素会改形状,木的会烧,油桶被打穿会流油,爆炸给冲量。

### 1.4 物品(entities/items,236 个)

pickup 79(金块 / 药水 / 心 / 法术刷新 / 蛋 / 石板…)· wands 31(level_01 18 + good 6 + …)· books 32 · orbs 15。
`potion.xml`:PhysicsBody + MaterialInventory(装 1000 单位液体)+ **PhysicsThrowable**(能扔)+ ExplodeOnDamage(摔碎洒一地)+ MaterialSucker(能吸液体)。
`wand_level_01`:Sprite + Item + SimplePhysics(掉在地上)+ Ability(法杖数值)+ ManaReloader。

### 1.5 状态效果(status_list.lua,50 项)

和环境直接相关的:**WET**(已做)· **OILED**(沾油 → 遇火即燃)· **BLOODY** · **SLIMY**(变慢)· **RADIOACTIVE**(持续掉血)· **ON_FIRE** ·
FROZEN · POISONED · ALCOHOLIC(醉,操控漂)· JARATE · HYDRATED …
机制统一:`SpriteStainsComponent` 记身上沾了什么材质的多少像素 → 按材质 tag(`[oil]`/`[blood]`/`[slime]`…)给状态;沾的会慢慢滴掉。

### 1.6 与环境的融合(数据里能直接看到的规则)

1. **材质伤害**:`DamageModelComponent.materials_that_damage` + `materials_how_much_damage`。玩家:acid 0.005/帧 · lava 0.003 · blood_cold 0.0009 · poison 0.001 · radioactive_gas 0.001 · rock_static_radioactive 0.001 · **magic_gas_hp_regeneration −0.005(回血)** · cursed_liquid 0.004 · poo_gas 0.00001。
2. **火**:`fire_probability_of_ignition`(玩家 1,虫 0.5)、`fire_damage_amount 0.2`;身上沾油(OILED)必着;湿(WET)灭火;着火的实体本身是火源,会点燃周围可燃材质。
3. **水下**:`air_needed=1` `air_in_lungs_max=7`(7 秒憋气后掉血)。
4. **摔落**:`falling_damages`(玩家 0,道具 70~250px 高度 0.1~1.2)。
5. **液体置换 / 浮力**:实体对液体是实体(已做玩家);物理刚体按材质密度浮沉(木箱漂、石头沉)。
6. **血与尸体**:死亡 → `blood_material` 像素喷在地上 + 布娃娃肉块(`meat` 材质,会腐/会烧)+ 掉金块。血/油/黏液落地都是真材质,会和火、水反应。
7. **爆炸对刚体**:`physics_explosion_power` 冲量 + `physics_throw_enabled`;`shake_vegetation` 摇树;`stains_enabled` 把周围染黑。
8. **敌人对地形**:CharacterPlatforming 爬台阶、被沙埋、掉进液体游泳/淹死(air_needed);虫 `CellEater` 啃穿一切非 box2d 材质;矿工扔 TNT 炸地。
9. **沾污**:走过血/油/水 → 状态 + 精灵染色 + 滴落(WET 已做,同一套扩到 OILED/BLOODY/SLIMY)。

---

## 2. 实现计划(按"先能看见 → 再能交互 → 再有威胁"排序)

每步都复用现有底座:`CellSim`(材质)、`ProjectileSystem`(爆炸/材质转换/碎屑)、`collectLights` 那套种子确定的 spawn 掷骰、
`PlayerSprite` 的 xml 精灵播放器、`Sfx`、`decor` 管线。**不自创规则,参数全部从 xml 读**(准备脚本抽成 json,像 projectiles.json 一样)。

### 第 1 步 · 实体骨架 + 煤矿里的敌人 ✅ 已做

> 修正:出生大厅的羊/鹿/鸭表在现行 `mountain_hall.lua` 里 `spawn_small_enemies` 是空函数(只有 `trailer/` 版才放),
> 原版出生点没有动物;`hall.png` 里也没有 `spawn_crate` 标记。所以第 1 步的"活物"改为煤矿(y≥512)的真实生成:僵尸 / 矿工 / 霰弹手 / 史莱姆射手 / 长腿蜘蛛 / 火法。

- `scripts/noita-prepare-entities.mjs` → `entities.json`(20 种敌人 + 21 种道具)+ `ent/` 193 张;`<Base file>` 递归合并。
- `scenes.js collectSpawns`:标记色 → `g_*` 表 → 逐行复刻 `director_helpers.lua` 的 `spawn()`,种子确定;`chunk.spawns` 传主线程,首次就位实例化。
- `Entities.js`:CharacterPlatforming 行走 + AnimalAI 简化(发现/追/近战/逃/闲逛)+ DamageModel(弹丸/爆炸/材质伤害、血喷、死亡洒血)。
- 玩家 hp 改 Noita 单位(4=100),敌人近战 / 爆炸 / 材质伤害都会掉血;死了回出生点。
- 实测 seed 1674172626 煤矿前两排 chunk 生成 97 只,怪会追人、打人、被打死。
- 还差(放到后面步骤):PathFinding(现在遇墙只会跳)、远程攻击(矿工扔 TNT、霰弹)、longleg 爬墙、firemage 火球、布娃娃/掉金块、精灵 SpriteStains。

### 第 2 步 · 像素刚体 ✅ 已做(`RigidBody.js`,细节见 README)

- 形状图 → 像素 + 质心 + 惯量;醒着自己积分 + 边缘像素撞地形(冲量/摩擦/扭矩,面接触不翻),睡着写进 `chunk.mat` 由 CA 接管(会烧、可挖 = 缺损),支撑没了再醒。
- 浮力按密度;`ExplodeOnDamage`(hp / 缺损比例)→ `ProjectileSystem.explode` 连锁;`MaterialInventory` 打漏 / 毁了全洒;矿灯带光;玩家能推、能站、被挤会让开;怪也把醒着的刚体当地形。
- 实测:炸药箱落地入睡 → 打三发油桶漏出 260 格油 → 炸药箱被连锁炸出 r40 的坑,人在旁边掉 1.5~2.5 血。
- 还差:矿车/木车的轮子关节(现在是一整块)、刚体互撞(两个都醒着时会叠)、着火的箱子醒来后继续烧(现在只有睡着时烧)。

### 第 3 步 · 伤害 / 血 / 尸体 / 掉落 ✅ 已做

- 布娃娃 = 每张 png 一块 meat 像素刚体,睡 8s 后化为肉像素;`drop_money.lua` 逐行复刻的金块(gold_box2d 小刚体,15s 消失,碰到自动捡,HUD 记金);
- 沾污按材质 tag → WET / OILED / BLOODY / SLIMY / RADIOACTIVE;着火(玩家 + 怪):烧 4s、0.5s 一跳伤害、身上冒火格点燃周围、进水灭;怪有 `burn` 动画。
- ✅ 补上:水下憋气(`air_in_lungs_max` 7s,头没在液体里 7 秒后按 `air_lack_of_damage` 0.6/s 掉血,出水 3 倍速回气,HUD 入水才出气条;BREATH_UNDERWATER 免)、
  道具摔落伤害(`falling_damages` 只有四色瓶子是 1:落差 70~250px 线性 0.1~1.2 伤,瓶子 0.1 血摔一下就碎)、死亡画面(`#death`:死因 / 深度 / 金 / 击杀 / 特权,
  "回出生点"保留身上东西、"重开一局"刷新;死了世界停住)。实测:放进水坑 7s 后气条见底,再 0.8s 淹死,死亡画面弹出,回出生点满血。还差:金块闪光粒子。

### 第 4 步 · 敌人 AI ✅ 远程 + 虫已做

- 远程:矿工 TNT / 霰弹手 / 火法 / 史莱姆射手 / 酸射手,参数全部来自 AnimalAI(距离、间隔、发数、预判、视线);敌弹只打玩家和刚体。
- **虫**:节链 + CellEater 打洞 + WormAI 猎杀/漫游 + 出土抛物线 + 一口;实测从地里钻出来朝人扑,血条 500,掉 200 金。
- 补齐:**飞行**(`can_fly`:蝙蝠 / 火骷髅 / 无人机 / 史莱姆射手,无重力朝目标飞,远程的悬在人斜上方)、**爬墙**(longleg:贴地/墙/顶四面爬,
  小坎直接跨、下坡贴着走、真拐角绕过去、撞墙转上去,精灵按面旋转)、走路怪的**局部寻路**(≤24px 窄坑跳过去、追 1s 没挪窝就跳、2.5s 放弃)、
  `escape_if_damaged_probability` 受伤逃跑。实测蜘蛛从地面爬上 50px 石墙翻到顶上咬人。
- 还差:`dodge_projectiles`、死亡后被吃(zombie `needs_food`)、drone 的 `shieldshot` 弹。PathFinding 网格已在第 6 步之后补上(`_findPath`)。

### 第 5 步 · 物品与法杖 ✅ 法杖已做

- `wands.json`:gun_actions.lua 482 条法术(中文名/图标/mana/uses/弹丸/延迟散射增量)+ 祭坛 17 根固定法杖 + 初始 Bolt staff / Bomb wand;
  祭坛法杖的卡照 `level_1_wand.lua` 掷;施法照 gun.lua(牌库/抽牌/法力/充能/洗牌/max_uses);法杖是世界物品,碰到捡,背包 4 根。
- 补齐:药水(potion.lua 内容 / 捡 / 扔 / 碎 / 洒)、宝箱(chest_random.lua 掉落主干)、心、法术刷新、DRAW_MANY、修饰卡速度增量。
- 还差(全部依赖第 6 步的圣山/商店,放到那时一起做):法杖编辑(圣山法杖台)、法术卡物品(商店卡 / 宝箱卡)、喝药水(材质→状态效果)、
  `gun_procedural.lua` 完整随机法杖(wand_level_02+ 才会明显不同)、触发弹、超级宝箱 / 拟态箱。

### 第 6 步 · 回到地图 ✅ ①②④ 已做,③ 只剩边缘噪声

**下一个要做的**(按价值排):
- ~~PixelSprite 像素贴图 props~~ ✅ 已做成背景贴图(`scenes.js PIXEL_SPRITES`:煤矿木架 6 种 / 丛林树 6 种 / 金库机器 6 种,anchor 对齐实体位置,`World._buildChunk` 把这些生成点换成
  `bgSprite` 布景,图在 `scenes/props/` 由 prepare-entities 拷;煤矿 `load_structures / large / i_structures`(spawn(g, x, y−30, 0, 0))、丛林 `spawn_tree`、金库 `spawn_machines` 的表与函数补上;
  金库 apparatus 两个是真刚体,加进 PROPS)。**近似点**:原作这些像素是可打可烧的世界格(create_box2d_bodies),这里只画不进材质。
- ~~链关节多体~~ ✅ 吊挂类做了(已上线):`RigidBody.ropes` = 不可伸长的绳/钉约束(`chain_to_ceiling.lua`:每个 VariableStorage `chain_N_x/y` 挂点往上找 200px 内的顶,
  够 16px 就拴链;`PhysicsJointComponent nail_to_wall` 钉在图心 = 只转(轮子),钉在边上 = 绕钉摆(吊桶)),位置式约束 + 沿绳冲量含转动惯量、多绳迭代两遍;
  拉回距离超过 break_distance 断链;锚点被挖 / 炸掉也断;挂着的可以入睡(当有支撑)。挖掘场 suspended_container / tank_radioactive / tank_acid / seamine / physics_bucket 加回 PROPS。
  实测:双链罐子 4s 内入睡、v=0 rot=0;挖掉两个锚点 → 两链 X → 罐子掉下 130px。原作是一节 16px 的 box2d 链体串起来,这里链只画不碰撞。
  (后来接了 Box2D,家具 / 物理蘑菇的多体关节、多体机械 excavationsite_machine_3b/3c 都做了,见 2.4 第 29 条;门仍跳过。)
- ~~PhysicsAI 飞行体与 buildings~~ ✅ 大半做了(已上线):PhysicsAI 无人机 / 医疗无人机 / 水晶 / 拟态箱 走已有的飞行模型(`can_fly`),本体是 PhysicsImageShape 的图
  (`d.bodyImage` 先画本体再叠发光眼精灵;没精灵的用本体图拼单帧精灵);shooterflower 这类只有 AnimalAI 没 CharacterPlatforming 的做成 `stationary`(不动只开火);
  buildings:flynest / firebugnest / spidernest / lukki_eggs 当带动画的站桩生物(有血、打碎),physics_cocoon 是钉着的刚体(打了炸)。
  金库一屏 vault_drone_physics 17 只全部实例化,`skipped` 清零。
  ~~地雷~~ ✅:表里的 `projectiles/mine` 落地就是 `mine_scavenger`(prepare 脚本多一类 `projectiles`):hp 0.5 的站桩生物,`CollisionTriggerComponent` 圈 20px 内有人 / 活物 →
  播 detonate 0.5s(timer_for_destruction 30 帧)→ `ExplosionComponent ON_DEATH` 的 config_explosion(r30 伤 4 起火 80%)走和炸药箱同一条 `explodeConfig`。
  实测走过去:亮 0.5s → 炸 → 100→30 HP、脚下炸出坑、人着火;丛林一屏 7 颗。
  ~~巢吐虫~~ ✅(`d.nest`,照 flynest / firebugnest / spidernest .lua:每 121 帧掷,75% 且玩家 200px 内且总数 <15(火虫巢 10),苍蝇巢出 fly、火虫巢 80/20 出 firebug/bigfirebug、蛛巢出 longleg;
  实测巢边站 9s 出 3 只苍蝇追人)。
  ~~陷阱~~ ✅:神殿 8 种 buildings/*trap_left/right(`crypt_trap_check.lua` 逐行:每 60 帧看人在不在正面 170px、竖向 ydist(箭 18 / 火·吐 40 / 雷 25)内 → 朝人射一发,
  箭 300~400 + 上抬 50 / 火 320 / 雷 50 / 吐 360;弹 arrow / fire_trap / thunder_trap / spit_trap 进 ENEMY 表);陷阱自带的 `PixelSceneComponent` 石框 trap_frame_left/right 是真材质,
  `scenes.js SCENE_PROPS` 跟着生成点盖进 chunk.mat。石棺 / 背景雕像(PixelSprite)并进 PIXEL_SPRITES。实测朝右箭陷阱:人站右边 80px 每秒中一箭掉 12 HP;神殿一屏 `skipped` 只剩 ghost / ghost_crystal。
  ~~ghost_crystal~~ ✅:幽灵(`GhostComponent` hunt 412 / speed 20 → 穿墙飘的飞行体,`DamageNearbyEntities` 16px 内每 3s 一次诅咒伤害,damage_multipliers 全 0 → `invulnerable`
  打不死),幽灵水晶是 hp 20 的站桩 building,碎了 500px 内的幽灵一起散。神殿一屏 `skipped` 清零。`dodge_projectiles` 在解包的实体 xml 里一处都没用到,划掉。
  ~~lukki 蜘蛛~~ ✅(`animals/lukki/lukki` Hämähäkki · `lukki_longleg` Lukki · `lukki_tiny` 小蜘蛛,键 `lukki_lukki*`):原作是 PhysicsBody 圆(r 8/7/4)+ `PhysicsAIComponent`(force_coeff 10/7 推向目标)+
  `LimbBossComponent state=1`(FollowPlayer,引擎内置)+ 7 条 `IKLimbComponent length=40/80/14` 子实体腿 + 1 条 `IKLimbAttackerComponent radius` 攻击腿;prepare 脚本从原文另抽子实体 `<Base file=…limb…>`
  → `d.limbs[{len, attacker, walker, a/b/knee 图}]`、`d.physShape`、`d.overlays`(wiggle 4 帧 + emissive 眼)、`d.areaDamage`(tiny 盒 16×16 每 10 帧 0.1)。
  实现:身体走飞行模型(PathFinding can_fly,wiki"完全无视重力"),速度 force_coeff×4.5,到攻击腿 radius×0.55 就停;腿两段式 IK(每段 len/2 = limb 图宽),脚沿本位角 ±0.45/±0.9 射线找
  len 内第一格实心踩住,身体走远 / 踩的格没了 / 拖在身后到极限就换脚,够不着就悬着晃;攻击腿 idle → 人进 radius 抬腿 aim 0.45s → jab 0.15s → 0.5 伤(wiki Melee 12.5)+ 击退 → 1.4s 冷却,隐身也打;
  `CellEaterComponent radius 13/5` 被挡时把前方圆内的格吃掉再过去(原作一直吃身边 radius,这里只在被挡时吃);`damage_multipliers`(projectile 0.2 / explosion 0.8 / fire 1.2)接进 `hurt()` 对所有怪生效;
  死亡 `ragdollify_child_entity_sprites` → 16 段腿图各变一块 meat_slime_green 肉刚体 + 掉金;`lukki_eggs.lua damage_received` 伤 >0.1 且致死或 10% → 出 lukki_tiny。LightComponent r32 暖橘光只给 lukki 画。
  实测(`_noita-lukki-shot.mjs lukki|longleg|tiny|eggs|jungle`):lukki 从 100px 外爬过来 2.4s,腿踩在石柱上,刺 4 下 HP 100→50;20 发 0.5 弹伤只掉 2 血(×0.2);爆炸打死后 16 块肉 + 6 金;
  丛林一屏 `skipped` 只剩 physics_fungus(链式多体),lukki 2 + longleg 2 + 卵 4 都实例化,两只 lukki 在洞里聚成一团、腿扒着洞顶,60fps。
- ~~偷东西 / steve / 圣山门 / 压力板~~ ✅(已上线):
  - **门 / 压力板不存在**:`spawn_motordoor`(0xFAABBA → physics_templedoor2 齿轮+齿条双体)/ `spawn_pressureplate`(0xFAABBB)在 temple_altar.lua 注册了,但全部 2276 张布景图里一处都没有这两个色(legacy),不做。
  - **惹怒众神**(`temple_shared.lua temple_spawn_guardian` / `temple_check_for_leaks.lua` / `generate_shop_item.lua ItemCost stealable=1`),全在 `noitaPlay.js guard`:
    ① `shop_hitbox`(±495 × −112..145,挂 spawn_all_shopitems 点;`templeMarks` 发 `shop_area`)——标价货(`b.shop.area`)出了框 = 偷 → 变免费(`b.shop=null`)+ 惹怒;
    ② `spawn_areachecks`(0x03DEAD,altar / altar_left / altar_right 各一个)→ 两个 `temple_areacheck_horizontal`((x+180, y−101) / (x+180, y+140)),`MaterialAreaChecker` aabb x −124..300、y 0..1 全是 templebrick(_noedge)_static,
    每 0.5s 查,不是了 → 惹怒。**第一次看全先对基线**:altar_right 的底行本来就有 44 格 0x000042 标记像素(我们当空气),那行作废不算;
    ③ 惹怒:`TEMPLE_SPAWN_GUARDIAN` 没设 → 在最近的 `guardian_spawn_pos`(特权祭坛 x+30, y−30)放 `spawn_necromancer_shop`(紫色漩涡 180 帧后出 Stevari),设标记;之后每座新圣山 `spawn_all_perks` 直接放守卫;
    提示"$logdesc_temple_spawn_guardian" + 摇镜;`PEACE_WITH_GODS` 特权 → 只提示不出(`flags.peaceWithGods`);`necromancer_shop_death.lua` STEVARI_DEATHS 记数(≥3 原作换 necromancer_super,没做)。
  - **Stevari**(`animals/necromancer_shop`:hp 24 飞行,两段 `AIAttackComponent` 远 41~300 orb_pink_big_explosive / 近 0~40 orb_pink → prepare 抽成 `d.attacks`,Entities 开火前按距离挑一段;
    damage_multipliers explosion 0.2 / fire 0.1;ItemChest level 1 掉金;布娃娃 10 张)。顺手给全部飞行体加 **飞行寻路** `_findFlyPath`(8px 格 BFS,"能飞的格" = 整个碰撞盒放这格不撞,用真正的 `_blocked`;
    追人看不见人 / 撞了墙才算,每 0.4s 一次)+ 贴斜坡上下滑 ≤4px;物品(货架卡 / 法杖 / 金块)不再挡怪(`_solidC` 跳过 isItem)——之前 Stevari 会被 45° 斜顶卡死、被货架卡挡住找不到路。
  - 实测(`_noita-steve-shot.mjs`):第一座圣山 6 行检查区 5 行 850 格全砖、altar_right 底行 762 砖 + 88 空作废;把一张 BURST_2 卡挪到框外 40px → 0.5s 内"你惹怒了众神!" → 3s 紫漩涡 → Stevari 在祭坛出现 →
    12s 穿过商店与祭坛间的 45° 斜道到人面前 → orb_pink_big_explosive 六发 HP 100→0 死亡画面;挖掉顶上那行 96 格砖 → 同样惹怒。
  ~~EXTRA_SHOP_ITEM~~ ✅(`GlobalsSetValue TEMPLE_SHOP_ITEM_COUNT = min(n+1, 10)`:`Perks.EFFECTS` 写 `flags.shopCount` → `client.setGlobals` → Worker `world.globals` →
  `scanTempleMarks` 的 count / 间距 132/count / sale=Random(1,count);已扫过的圣山不变(和原作"已生成的区块不变"一致);实测 setGlobals(7) 后第二座圣山 7 根法杖,间距 18.86)。~~特权重掷~~ ✅(`perk_reroll_perks` 逐行:机器 400 金每用翻倍,把世界里摆着的特权全换,
  新的从牌堆**末尾往前**发 TEMPLE_REROLL_PERK_INDEX;实测 1000 金 → 600,EXTRA_HP/INVISIBILITY/RISKY_CRITICAL → RADAR_ENEMY/SHIELD/LOWER_SPREAD,再碰提示要 800)。~~喝药水~~ ✅(已上线):选中药水按 F / 手机"喝一口"按钮,一口 250 单位,
  液体的 `status_effects`(materials.json `statusEffects`)→ 状态,时长照 `effect_*.xml` 的 frames(`EFFECT_DEFS`:回血 6s / 疾跑 ×2 10s / 快浮 ×1.5 10s / 无敌 120s / 隐身 120s(怪看不见)/
  狂暴 ×2 伤 12s / 混乱左右反 / 醉了方向打漂 20s / 虚弱受伤 ×2 / 中毒 / 传送病随机传 / 回法力 / 夜视 / 沾污类);酸 / 熔岩 / 毒喝下去按材质伤害表掉血;变形 / 幻觉记名不做。
  实测:回血药 1.2s 内 50→63 HP,叠三种药 HUD 同时倒计时。
- ~~第 3 步剩余:水下憋气、摔落伤害、死亡画面~~ ✅。第 4 步:~~PathFinding 网格~~ ✅(`Entities._findPath`:8px 粗网格 BFS,"能站的格"= 本格与上格空、下格实心;
  边 = 平走 / 跳 ≤3 格高 / 掉 ≤10 格 / 跨 2 格坑;±24×±16 格、最多 600 节点;追人时人不在同一层或被挡就每 0.4s 算一次,照下一路点走 / 跳。
  实测两级 16px 台阶:僵尸 8s 从 (213,−63) 走到 (329,−81) 爬上两级)。`dodge_projectiles` 解包 xml 里没有任何实体设置,不做。
- ~~群系边缘噪声 `noise_biome_edges`~~ ✅(见 ③);主线以外的群系同一套四件事:
  - ~~liquidcave 古代实验室~~ ✅(已上线,煤矿左边 x −4608..−3072 / y 0..1024):4 个新色(`load_background_panel_big` 同一张材质图配 8 张背景 / `spawn_lasergun` / `spawn_vines` / `spawn_statues`),
    spawn_items / props3 / pixel_scene2 / unique / ghostlamp / candles 空函数(`EMPTY_FUNCS`),`load_pixel_scene` 在 (x−5, y−3) 放 container_01(f0bbee 掷 8 种液体);
    表:炼金术士 / 巫师(NG+ 行按规则不算)、床 / 木箱 / 旗(banner 没形状图,跳过)/ 12 座 rock_box2d 石像;g_lamp 吊灯 physics_lantern(钉在钉子上)→ `LAMP.liquidcave`;
    材质带 soil → sand_static → rock_static + coal / copper / gold 稀有;实体 +3(failed_alchemist / enlightened_alchemist / wizard_returner 普通版)+ 建筑 lasergun(`d.lasergun`:lasergun.lua 每 10 帧计一次、
    计到 11 朝下射 laser_lasergun,弹 +1)+ statue_trap_left/right(只当雕像摆着,statue_trap.lua 人到 32px 变活雕像没做)。
    实测 (−3800,500) 一屏:172 只全部实例化 `skipped {}`,chunk(−3584,512) 材质 air 146k / sand 40k / rock 34k / templebrick_static_ruined 24k / 三种 magic_liquid 15k(玻璃罐里的随机色液体);
    站激光炮下 4s 被射 HP 100→50。
  - ~~wandcave 魔法神殿~~ ✅(已上线;群系图里色 006c42 是散在几处的填充段,如 x −4096..−2560 / y 3584..4096,`_biome-map-dump` 的字母有重号,按色找):4 个新色(`spawn_cloud_trap` 只有粒子发射器,不做;
    三池地面碎石 `load_floor_rubble(_l/_r)` 偏移 (−10,−15) / (−18,−17)),`spawn_items` 两次 PR(<0.47 空、<0.725 空)→ wand_altar,props2/3 / pixel_scene* / unique / ghostlamp / candles / potions / wands 空函数;
    g_lamp = chain_torch_ghostly 必出 → `LAMP.wandcave` kind torch;材质带 templeslab_crumbling_static 打底 + templeslab_static 1.0~1.5 + diamond / radioactive_liquid 稀有;
    实体 +5:**法杖幽灵 wand_ghost**(wand_ghost.lua:本体没精灵,出生捡一根 wand_level_03 → `hooks.ghostWand` 造法杖、`e.held` 只画那根杖并朝人转,AI 照 orb_pink 开火,死了 `hooks.dropWand` 掉在地上)、
    statue_physics(PhysicsAI 石像)、phantom_a/b、necromancer。实测 (−3300,3840) 一屏 120 只 `skipped {}`,chunk(−3584,3584) templeslab 54k+42k / 放射液 7.9k / diamond 75;幽灵拿 "Slim Rapid bolt wand" 追人 3 发 HP 100→40,打死掉杖。
  - ~~pyramid 金字塔~~ ✅(已上线,x 8704..11264 / y −1024..512):外壳 5 个群系(pyramid_entrance / hallway / left / right / top,之前 BIOMES 里根本没登记 → 当实心岩)补成 kind scene +
    `STATIC_SCENE_INIT`(各 lua init:整图 + 底座 left_bottom @y+512 / right_bottom @x+451,y+512);内部 pyramid 是 wang 砖:色表同 crypt(+ `spawn_reward_wands` 三种法杖、`spawn_boss_limbs_trigger` 不做),
    布景池全借 `biome_impl/crypt` 的图(条目带 `dir: 'crypt'`),`load_pixel_scene2/4` 偏移 (+6,0) / (−5,0);g_lamp 蓝火炬座 0.7 + 头骨 0.3、lamp2 蓝吊链火把必出;
    材质带同 crypt + sand_static 限 y<424;实体 +6(skullrat / skullfly / wizard_weaken / ethereal_being / berserkspirit / weakspirit;弹 +1 orb_weaken),props/statue 只有 Sprite → `PIXEL_SPRITES.statue` 背景贴图。
    实测 (9900,−200) 一屏 156 只,`skipped` 只剩 ethereal_being(没有 CharacterData);chunk(9728,0) templebrickdark 69k / templebrick 45k / rock_hard 11k / diamond 265;地图截图外壳三角 + 内部熔岩室齐。
  - ~~sandcave 沙洞~~ ✅(x 8192..15872 / y 512..8192):2 个新色(`spawn_lamp2` 管灯必出 / `spawn_props4` 床 + 木箱);布景池全借 snowcastle 的 shaft / bridge / cargobay / bar / bedroom(`dir:'snowcastle'`);
    `spawn_items` PR<0.94 祭坛;表:拾荒者小队(组行带 min/max)/ 坦克 / 巫师 / 水雷 0.5 / 瓶子;材质带 soil → sandstone → sand_static_red + rock_hard 大块 / silver / water 透镜 / 散沙(prob 压到 0.3);实体 +1 flamer。
    实测一屏 241 只 `skipped {}`,chunk(9728,2048) sandstone 111k / water 21k / rock_hard 11k / sand 4.3k;灯多(管灯必出 + 灯笼 0.7)所以画面偏亮。
  - ~~meat 肉界~~ ✅(x 6144..15872 / y 5632..16384):5 个新色(头骨 / 肉囊 `spawn_cyst` PR≥0.3 / 肉藤 / `spawn_mouth` SetRandomSeed 后 Random(−10,10) 两次挪位 → SPAWN_FUNCS 第 6 项 `jitter` /
    吊笼 `spawn_hanging_prop`);`spawn_items` <0.3 祭坛(x−15)、0.3~0.55 utility_box 没做;材质带全 meat_static + gold;实体 +6(地狱版矿工 / 霰弹手 / 狙击手、肉蛆(虫)、血晶、死灵机器人)+ 建筑 wallmouth / walleye / hpcrystal,
    meat_cyst(5 帧精灵 + hp 1 血 pus)当能打破的站桩物;弹 +4。实测一屏 149 只 `skipped {}`,chunk(6656,6144) meat_static 122k / pus 28k / blood 6k(布景里的)/ gold 247。
  - ~~robobase 发电站~~ ✅(最底层 y 7680..17408):7 个新色(金库那套:警示条 bgSprite 借 vault 图 / 炮塔 / 吊挂 / 路障;`spawn_lasergate_ver` 激光门没做);lua 里 g_pixel_scene_01/02 根本没定义 → 空;
    `spawn_items` <0.93 金库式祭坛、`spawn_potion_altar` >0.65;材质带 rock_static_grey → rock_static + gold / 放射液;实体 +9(basebot 四种 / roboguard_big / necrobot_super / robobase/ 强化版三种)弹 +7;
    physics_hanging_wire 是 verlet 吊线没形状图 → skipped。实测一屏 229 只,chunk(13312,8192) steel_grey_static 53k / rock_static_grey 44k / rock_static 34k。
  - ~~the_end 地狱~~ ✅(x −5120..4096 / y 14848..17408):默认色为主(shopitem / specialshop 只在天空段 y∈(−3000,1000)、spawn_moon 只在 y≤0,地面段都不到);小怪大怪按 y>−7000 走地面表;
    `spawn_items` >0.38 祭坛;g_props / pixel_scene_02 全空;材质带 skullrock → the_end + coal / lava 泡;实体 +4(the_end/ 强化版 gazer / spitmonster / bloodcrystal / worm_end)弹 +2。
    实测一屏 243 只 `skipped {}`,chunk(0,14848) skullrock 130k / endslime 11k / lava 3.4k。
  - ~~wizardcave 巫师洞~~ ✅(散段,如 x −6144..−4608 / y 5632..6656):色表同 crypt 21 个,但 load_pixel_scene* / beam / cavein / statues / background_scene 在 lua 里**全是空函数**,只剩 `load_small_background_scene`
    的三张帷幔 drape 背景贴图(`scenes/wizardcave`,prepare-assets 加了 wizardcave / the_end 目录);大怪表是十种巫师的成对组行(代码里循环生成);材质带 soil → rock_static_purple + 煤矿那套稀有;
    实体 +2(wizard_homing / barfer)弹 +1。实测一屏 170 只 `skipped {}`,chunk(−5632,5632) rock_static_purple 61k / wizardstone 41k / lava 4k。
  - **全部群系的四件事到此齐了**。
  - ~~wang 标记的藤蔓 g_vines~~ ✅(`scenes.js collectVines` → `layer.vines` → `World._collectDecor` ③):spawn_vines 0x80ff5a → spawn(g_vines, x+5, y+5),表 [verlet_vine 0.4 → 15 节 / long 0.3 → 17 / 空 1.5 / short 0.5 → 8 / shorter 0.5 → 6]
    用 ProceduralRandom 掷,挂点 = 标记 +10,画法同山洞的 verlet 藤(只画不进材质);coalmine / coalmine_alt / excavationsite / snowcave / snowcastle / rainforest / vault / crypt / liquidcave / meat(meatvine 同权重)/ wizardcave。
    实测煤矿一层 19 根,chunk(36,15) 落 2 根,地图截图洞顶垂下绿藤。
  - ~~零碎欠账~~ ✅ 全部收掉(已上线,探针 `_noita-misc-shot.mjs`):
    · **utility_box**(meat spawn_items 0.3~0.55 → `collectSpawns` 直接发实体;`Entities.openUtilityBox` 照 utility_box.lua drop_random_reward:≤2 小炸弹 / ≤5 法术刷新 / ≤11 杂项(先给药水)/ ≤97 抽 2~6 张 UTILITY·MODIFIER 卡
      (`hooks.utilityCard` 在 wands.json 里挑没上锁的)/ ≤99 再掷两次 / 100 三次);散卡是世界物品(`b.spell`,碰到进 `player.spells`)—— 顺手修了偷来的商店卡 `b.shop=null` 后捡起会走金块分支的 bug
    · **lasergate_down**(robobase `spawn_lasergate_ver` (x+5, y+3)):`d.lasergate` = LaserEmitter(朝下 160px / damage 0.2 / 半径 1.5),lasergate_ver.lua 的 cos(frame·0.03 + x·0.05) < 0 亮灭,光束到第一格实心,
      人碰到掉血,粉红光束 + 火花;实测亮 / 灭交替,站光束下 HP 100→85
    · **statue_trap** 活化:statue_trap.lua 每 40 帧,人到 32px → 换成会飞的 animals/statue(键 `statue_animal`,和 props/statue 分开)+ 尘土;实测 1.2s 内变活雕像扑上来
    · **cloud_trap**(wandcave):第一个 ParticleEmitter create_real_particles → `d.cloudTrap` 每 3 帧往 r14 圆内写一格 cloud_radioactive 真气体;实测 3s 攒 17 格云
    · **ethereal_being**:有 CharacterPlatforming 没 CharacterData → 通用规则借 Hitbox 当碰撞盒(DamageNearby 光环走已有 `d.aura`)
    · **banner**:7 帧飘动精灵 → 打不坏的站桩物(盒子 1px 不挡子弹);**necromancer_super**:STEVARI_DEATHS ≥3 后守卫换它(两段 AIAttack orb_pink_big_super / orb_pink_super)
    · **physics_hanging_wire**(robobase g_vines):hanging_wire_spawner.lua 逐行 —— 生成行左右各 60px 找墙、跨度 <30 不放、每 30px 一个锚(上方 15px 内有顶)、锚间下垂 metal_wire → `World._wireDecor` 用本 chunk 材质找锚,
      ChunkPainter 画暗灰细线(`decor.kind 'wire'`),不再进 skipped

按顺序做,每一小步都能单独上线验收:

1. **煤矿→挖掘场→雪窟的完整下行路** ✅ 挖掘场 / 雪窟已做(已上线):
   - 每个群系四件事:① `scripts/_dump-spawn-tables.mjs <biome>` 抽 g_* 表贴进 `scenes.js SPAWN_TABLES`;② 该 lua 的 `RegisterSpawnFunction` 色表贴进 `BIOME_SPAWN_FUNCS`,
     `load_pixel_scene*` 的布景池贴进 `BIOME_SCENES`(布景 png 已全部在 `public/res/noita/scenes/<biome>/`);③ `scripts/_dump-biome-mats.mjs <biome>` 抽 MaterialComponent 贴进 `bands.js BIOME_BANDS`;
     ④ 该群系会出的敌人/道具名加进 `noita-prepare-entities.mjs` 的 ANIMALS/PROPS 重跑(远程弹加进 `noita-prepare-projectiles.mjs` 的 ENEMY)。
     看图:`_noita-map-shot.mjs gen "x,y,zoom"`(`$env:NOBOX=1` 去掉布景框)、`_noita-biome-hist.mjs x,y`(材质直方图 vs 真值)、`_noita-biome-play-shot.mjs x,y tag [url]`(可玩页传送 + 生成统计 + 截图,传线上 url 即冒烟)。
   - 这一轮顺手修的表精度问题(影响煤矿):`_dump-spawn-tables.mjs` 重写成真正的 lua 表解析——之前正则把 `--[[ ]]` 注释掉的行(coalmine g_props3 四色瓶子)也抽了进来、
     漏掉 `entities = {…}` 组行(g_big_enemies 矿工×2+霰弹手)、没剔 `spawn_check`(miner_santa 圣诞限定)与 `ngpluslevel`(drone_shield NG+2 等)行——
     这些行在 `init_total_prob` 里根本不计入 total,所以掷骰结果整体都偏了。现在 T() 行带 `extra {g, ng, xmas}`,`rollTable` 按 NG+ 等级过滤,组行走 `loadCameraBound` 的 load groups 分支。
   - 挖掘场:`spawn_small/big_enemies` 的 `BiomeMapGetVerticalPositionInsideBiome` 门控(用群系图包围盒算纵向 0~1)、`spawn_items` 变体(第二掷 <0.725 空 → 祭坛 x-10,y-17)、
     `spawn_wheel*` 钉墙轮子(`PhysicsJointComponent nail_to_wall` → RigidBody `nailed`,只按 mMotorSpeed 转)、`spawn_rock`(rand 4)、`spawn_nest`(+4,+8)、
     **背景贴图**(`LoadBackgroundSprite`:塔 = generate_tower 底座/中段/顶按 PR 掷、四种横梁、mechanism_background 池)→ 布景条目 `bgSprite:true` 不进材质,painter 在背景墙之后按 z 倒序画。
     材质带 `rock_static_grey` / `coal_static` 两路噪声(xml material_index 10 / 9),按真值 chunk(512,1536)(−1536,1536) 校准:coal_static 57~63%、gold 379/806 格;
     真值里的 coal 几乎全来自布景。吊桶 / 吊罐 / 多体机械要链关节,实例化时跳过(stats.skipped 里能看到)。
   - 雪窟:`safe()`(x 125~249,y 3070~3187 入口井不出怪)、`spawn_items` <0.45 祭坛、`spawn_props` 10% 换雪人布景、`spawn_lamp` (x+5,y+10)、`init()` 8 只雕像手(`STATIC_SCENE_INIT.snowcave`)、
     `load_puzzle_capsule_b` (x-50,y-230)、酸罐左右(general/acidtank)。材质带 snowrock / snow_static / snow_sticky 两路噪声 + ice_static 稀有;`wand_level_02 / _better / unshuffle_0x` 先借固定法杖数值。
     未做:`spawn_vines` 的 verlet 绳、`spawn_fish` 只是生成了 fish_large 还没有游泳 AI、雪窟 `symbolroom` prob 0。
   - 雪城堡 snowcastle ✅(已上线):33 个标记色;`safe()`(入口 + y>6100 传送门附近不出);`load_paneling` = 同一张材质图 `paneling_wall` 配 7 张背景 `paneling_XX`
     (布景条目 `matName` 指材质图、`name` 只是缓存键;`assets.loadScene(dir, name, visual, bgName, matName)`);8 种倒角 / 柱填充固定图、pod 大小舱三池(同一材质图配不同背景)、
     `spawn_items` >0.2 金库式祭坛 `wand_altar_vault`(x−5,y−9)、`spawn_potion_altar` >0.65 `potion_altar_vault`;g_lamp 是 [空 1, 管灯 1] → `collectLights` 改成每群系一张
     `LAMP` 表(空/总权重、偏移、kind;coalmine_alt 的表是灯在前也顺手对上),新光源 kind `tubelamp`(冷白 200,230,255 r150,noitaPlay 画两根吊线 + 横管);
     家具 furniture_* 是多体 + 关节,先只取第一块形状图当整块;实体 +7(拾荒者医疗兵 / 集束弹兵 / 激光无人机 / 炮台左右 / 厨子矿工),弹 +5。材质带同雪窟。
   - 真菌洞 fungicave ✅(已上线):lua 里 spawn_lamp / load_pixel_scene* / props2/3 / unique / candles 全是**空函数** → `EMPTY_FUNCS` 表让这些默认色只算标记不出东西;
     只有 spawn_robots / spawn_nest / spawn_physics_fungus 三个新色 + 小怪大怪(rand 4)+ `spawn_items` >0.06 祭坛、`spawn_potion_altar` 必出;材质带 fungisoil / sand_static / rock_static
     + 两条 gold 稀有(v 0.4437~0.46 的细金线);`acid_gas_static` 等 lifetime=0 的静态气 CellSim 不飘不散(原来会当普通气升走);实体 +13(蚂蚁 / 史莱姆团 / 触手怪 / 隐身兵 / 大僵尸 / 蛆 / 机器人卫兵 …),弹 +8。
     物理蘑菇 physics_fungus* 是链式多体,跳过。init() 的传送门坑(summon_portal_util)没做。
   - 丛林 rainforest ✅(已上线):8 个新色;`spawn_unique_enemy` 在 (x, y+12);12 张植物墙 = 同一材质图 `plantlife` 配 12 张背景;两种灯(`g_lamp` 火炬座 0.3/0.6/地雷 0.1 → 新 kind `torchstand`,
     `g_lamp2` 管灯 x−8,y−4)→ `LAMP` 表支持 `lamp2` 与 `lampMax`;材质带 soil_lush / sand_static_rainforest + **water 稀有透镜**(土里的积水洼,是 xml 里就有的);
     `animals/rainforest/*` 是丛林强化版(键 `rainforest_xxx`,`entKey()` / prepare 脚本同一规则)。lukki 蜘蛛(PhysicsAI 多腿)、shooterflower(无 CharacterPlatforming)、地雷 `projectiles/mine`、
     `g_trees`(PixelSprite 像素贴图)、藤 / 根、dragonspot 都还没做。
   - 金库 vault ✅(已上线):29 个新色;9 种管道池、猫道(SetRandomSeed(x,y) 后 Random(y,y+1) 抬一像素)、柱 / 柱基背景池、warning strip 背景、污渍(同一材质图 `stain` 配 3 张手绘)、
     实验室三张带 `color_material`(f0bbee / a4dbd5 两色同掷 → 放射液 / 酸 / 酒)、`spawn_laser_trap` 只放 hole;`safe()` 入口;g_lamp 里 0.32 的滴水/滴油先不做;材质带 rock_vault / rock_static +
     radioactive_liquid 稀有(岩里的放射液泡);实体 +32(`vault_*` 强化版)。vault_machine / apparatus 是 PixelSprite,drone_physics 系 PhysicsAI,跳过。
   - 艺术神殿 crypt ✅(已上线):21 个新色;`load_pixel_scene4` 在 lua 里定义了两次(后者生效,不带 −5);梁 / 塌方 / 壁龛 / 石板背景池;`spawn_doors` 原版就注释掉了(EMPTY_FUNCS);
     材质带 templebrickdark_static(index 11 另一路)为主 + rock_hard 夹层 + diamond 稀有;g_lamp = 火炬座 0.6 + 三种头骨 0.3;实体 +27(`crypt_*` 强化版 + wraith / scorpion / mimic …)。
     顺手修:prepare 脚本挑精灵时先排 emissive 再退回——幽灵 / 骷髅虫本体就是 emissive,之前被整只丢掉。陷阱 buildings/*trap、ghost_crystal、crystal_physics(PhysicsAI)没做。
   - **主线全部群系(煤矿→挖掘场→雪窟→雪城堡→丛林→金库→神殿 + 真菌洞)的 spawn 表 / 布景池 / 材质带 / 实体都齐了**。共性欠账集中在三类:
     ① PixelSprite 像素贴图 props(煤矿木架 coalmine_structure、丛林树、金库机器、雪窟石堆):形状图 + `create_box2d_bodies` → 应当像布景一样盖进 `chunk.mat`(材质由像素色/或 `material` 属性定);
     ② 链关节多体(吊桶 / 吊罐 / 家具 / 物理蘑菇 / 门);③ PhysicsAI 飞行体(无人机 / 蜘蛛 / 水晶 / 拟态箱)与 buildings(陷阱 / 巢 / 幽灵水晶)。
   - 下一个:第 6 步 ②(圣山 temple_altar:商店 / 特权 / 法杖编辑 / 传送门)。
2. **圣山(temple_altar)** ✅ 商店 / 特权 / 法杖编辑已做(已上线):
   - 圣山不是 wang 砖,`altar.png` / `altar_top.png` 里的标记色由 `temple_altar.lua` 处理 → `core/templeMarks.js scanTempleMarks`(布景图到了才能扫,
     `World._scanStaticMarks` 在 prepareChunk 末尾扫一次缓存在布景对象上;产出的附加布景 `shop_second_row` 追加进所属 chunk 的整图布景表一起盖章;
     `_buildChunk` 把 `sc.marks.spawns / lights` 并进 chunk)。灯 `spawn_lamp`(g_lamp 空/灯各 1,rand_y 10|15)、`spawn_hp`(回满血 + 法术刷新)、`spawn_rubble`、
     `spawn_all_perks`、`spawn_perk_reroll`;`altar_top` 的 0xbf26a6 是 **`teleport_liquid_powered` —— 圣山的正规入口**(见 2.5 之后第 8 条;早先误记成"回程秘道,不做")。
   - **商店**(`spawn_all_shopitems` → `generate_shop_item.lua` 逐行):SetRandomSeed(x,y);5 件宽 132;sale=Random(1,5);Random(0,100)≤50 两排法术卡(第二排 y−30 + 货架布景)否则一排法杖。
     `GetRandomAction(x, y, level, 0)` 是引擎函数,照 noitool 的反推(`noita-ref/noitool/*.ts`,已下载留档):Σ该层 spawn_probability × ProceduralRandom(seed, f32(x), f32(y)),
     带 `spawn_requires_flag` 的默认没解锁不进池(wands.json 新增 `flag` / `desc`);标价 max(⌊(price·0.3 + 70·level²)/10⌋·10, 10),打折半价;层数按 y/512 的表(第一座圣山 level 0)。
     法杖 `generate_shop_wand`:Random(0,100)≤50 `wand_level_0N` 否则 `wand_unshuffle_0N`,价 50 + b·210 + Random(−15,15)·10。
     法术卡是世界物品(`Entities.spawnSpellItem`,卡图当形状、钉在货架上不掉;`b.shop={cost,sale,spell}`,下方画标价 / SALE),碰到 = 钱够就买(`player.spells` 散卡背包),钱不够拿不走(偷东西先不给)。
   - **法杖编辑**(`noita-play.html #editor`):只在圣山(玩家所在 chunk 是 temple_altar*,或 EDIT_WANDS_EVERYWHERE)可开,按 I / "编辑法杖"按钮;
     点法杖里的卡取下回背包、点背包的卡装进选中法杖(容量 / 有限次数按张均分);改完 deck 重置。
   - **特权**(`Perks.js`,perks.json 由 `noita-prepare-perks.mjs` 抽 `perk_list.lua` 106 条,剥掉 `--[[ ]]` 里整条注掉的):`perk_get_spawn_order` 逐行
     (SetRandomSeed(1,2)、可叠的 Random(1,2)/Random(1,max_in_perk_pool) 张、洗牌、4 格内重复剔除、拿过的置空),`perk_spawn_many` 按 TEMPLE_NEXT_PERK_INDEX 顺着发 3 个宽 60,
     图标钉在祭坛上抬 8px;拿一个其余撤掉(TEMPLE_PERK_DESTROY_CHANCE 100)。**效果只实现了 27 个**能落到现有机制上的(`EFFECTS`:EXTRA_HP ×1.5 / VAMPIRISM ×0.75 / GLASS_CANNON 50 血 ×5 伤 /
     HEARTS_MORE_EXTRA_HP / FASTER_LEVITATION / MOVEMENT_FASTER / LOW·HIGH_GRAVITY / PROTECTION_FIRE·RADIOACTIVITY·EXPLOSION·MELEE / STAINLESS_ARMOUR / SHOP_IS_FREE / GOLD_IS_FOREVER /
     EXTRA_WAND_SLOT / EXTRA_POTION_SLOT / EDIT_WANDS_EVERYWHERE / EXTRA_PERK / NO_MORE_SHUFFLE / FASTER_WANDS / EXTRA_SLOTS / EXTRA_MANA / SAVING_GRACE / RESPAWN / EXTRA_MONEY),
     其余拿到手记名、HUD 标"尚无效果"。开关 / 倍率都在 noitaPlay 的 `flags`。
   - 实测 seed 1674172626 第一座圣山(y≈1400):法术卡两排 10 张(BURST_2 40 / SPITTER 30 / TORCH_ELECTRIC 20 SALE …),买两张金 2000→1930;特权 EXTRA_HP / INVISIBILITY / RISKY_CRITICAL,
     拿 EXTRA_HP → maxHp 4→6,其余两个消失;第二座圣山(y≈2938)的特权 ORBIT / FIRE_GAS / PROJECTILE_REPULSION(牌堆顺序接着发)。
  - 还差:法术卡在世界里被打掉、液体驱动传送器、Stevari 死 3 次后的 necromancer_super。
    (偷东西 / 挖穿圣山 → Stevari ✅、EXTRA_SHOP_ITEM ✅、perk_reroll ✅、喝药水 ✅ 见上;门 / 压力板原版布景里没有)
3. **地图细节** ✅ 两件做了(已上线),边缘噪声未做:
   - `_pixel_scenes.xml`:`<BackgroundImages>`(hidden/ 的 8 条提示文字条 + liquidcave 顶盖 5 张,`bgSprite:true` 只画背景)和 `<mBufferedPixelScenes>` 里 skip_biome_checks 的整图
     (圣山胶囊 ×3 / 雪城堡熔炉 / 眼斑 ×5 / 塔起点)都并进 `staticScenes.js SPLICED_SCENES`(条目可带 `dir`,默认 spliced);`noita-prepare-assets` 多拷 `biome_impl/hidden`。
   - mountain 系材质带:hall / left_entrance / right / top 是 soil → **rock_hard** → rock_static(之前借了 hills 的 sand_static);整图布景白像素走 `bands.js mountain_hall`
     (rock_hard 0.53~0.88,煤两条稀有带按真值去掉),地形填充走 `SURFACE_BANDS.mountain`;stub 两头仍是 sand 但沙带拉深到 1.12。
     按真值校准到几乎逐格:chunk(512,−512) rock_static 103498 vs 102320、rock_hard 73235 vs 73328;chunk(0,−512) 29733/20600 vs 29568/20765;stub 沙 166519 vs 162646。
   - ~~群系边缘噪声~~ ✅(已上线,`World._bleedSurfaceEdges`):真值考证——`noise_biome_edges="1"` 在解包 xml 里只有 coalmine / excavationsite / winter_caves / clouds / mountain_right_stub /
     temple_altar_right_snowcastle / solid_wall_tower 显式写 1(`core/biomes.js NOISE_EDGE_BIOMES`);真值 chunk(1536,512)(煤矿,上邻右桩)顶部:右桩的 rock_static/soil 越过 y=512 漫进煤矿 0~26px,
     沿 x 按 ~50px 尺度成块起伏、约一半的边不漫;chunk(0,0) 左沿有 0~33px 同款;而 y=0 山厅(没写标志)↔煤矿那条边是直的(y 0~12 的 rock_static_intro 是山体整图盖的)。
     实现:砖群系 chunk 填完 wang 后,上 / 左 / 右邻居是 surface 类且两边都在表里 → 沿边按值噪声(阈 0.5,最大 26px,±2 抖动)把邻居的 `_surfaceMatAt` 材质盖进来(邻居是空气就不动)。
     对照 20 行:山桩材质 gen 1600 / truth 843(多出来的是我们的右桩地形没有真值那些 y 500~512 的空洞,不是漫的形状)。
4. **CellSim 睡眠** ✅(已上线):chunk 内按 32×32 块记 `e.act[256]`(TTL 帧数),`set / _swap` 写格子时标所在块(贴块边的连邻块),`setObstacle` 把玩家盒外扩 8px 的块标醒,
   有寿命的气 / 火 / 正在烧的格子每帧自续;`step()` 只跑 TTL>0 的块(chunk 行 → 块行 → 块,整体仍自下而上、左右交替),块里没东西动 3 帧后睡。
   新生成的 chunk 是静止的(和原作一样),>45° 的落沙布景不再自己塌。实测:煤矿 / 地表 模拟 1.5~1.7ms → **0.0~0.1ms**(醒 2~5 块),丛林积水洼 4.5ms → 0.9ms;
   油桶打漏 257 格照流、入水 / 出水 / 气泡 / 火照常。副作用(也是原作行为):远处静止的液体 / 熔岩挨着水不再自发反应,碰一下才开始。面板多了"醒 N 块"。
5. **玩法闭环 UI**(2026-09-04,用户反馈"玩不明白"):
   - 出口:走到右边 `altar_right` 的竖井(布景 x+170~210)往下掉到下一层。(入口见第 8 条 —— 这里原来写的"0xbf26a6 是回程传送器不做"是错的。)
   - **目标指引**(`updateQuest / drawQuest`):不在圣山 → 群系图往下扫 temple_altar 行(玩家列 ±5),顶部写"下一座圣山 ↓ 距离",屏边画脉动箭头;在圣山 → 指向最近 `altar_right` 布景的 (x+195, y+h) 出口。
   - **新手引导**(`tut`,localStorage `noita_tut` 每条一次,`?tut=1` 重看):开局目标 / 首次捡金 / 捡杖 / 捡药 / 捡散卡 / 进圣山 / 别处开背包 / 燃料烧空,PC 与手机各一套文案。
   - **背包随时看**:I / Tab / 手机"背包"任何地方都开;圣山外 `editor.canEdit=false`(标题"背包"、卡片变灰、点卡提示"只能在圣山里改");世界暂停。
   - **踢**(`kick()`,右键 / X / 手机"踢",冷却 0.4s):面前 12px 内的怪掉 0.3 血(×damageMul)并击退 (140,−70);没怪就踢刚体(按质量给 160 的脚速)。
   - **暂停**(Esc / 手机"暂停"):停 sim.step / step / sky,`#pause` 里按平台列全部按键 + "怎么玩"一段。
   - **手游布局**(`noita-play.html`):底栏 `#slots`(每格一根杖 / 一瓶药,法力蓝线,点/数字键切换,PC 也用)+ 右下 `#acts`(大键"跳/飞"按住悬浮、踢、喝、背包;按键 stopPropagation 不会被当成瞄准摇杆);
     左半摇杆上推仍能跳。`_noita-ui-shot.mjs [pc|touch|all]`:PC 走完 引导→切格→背包只读→暂停冻结→踢箱(vx 0→163)→踢僵尸(0.5→−0.1)→圣山指引切出口(195,1566)→圣山编辑可改→下一座 754;
     触屏(Pixel 5 横屏)走 按住跳/飞 0.9s(y −79→−150,燃料 3→2.12,不触发瞄准)→踢(箱 vx 147)→背包→暂停→点格切杖。
6. **圣山崩塌 + 存档**(2026-09-04):
   - 崩塌照 `temple_altar_right.lua 0xa85454 spawn_control_workshop → workshop_exit.xml`(CollisionTrigger 52×52 只认玩家,altar_right 图里 (140,53))→ `workshop_exit.lua`:
     `workshop_collapse`(x−144, y+82):摇镜 → 魔法符号 → 40 帧 PhysicsRemoveJoints(±80 内钉着的商店卡 / 特权掉下来)→ 20 帧 `loose_chunks_workshop`(LooseGround r180,chunk_material **concrete_collapsed**[box2d]);
     `workshop_areadamage` ×2(x−143 / x−543,aabb −391..63 × −99..78,1240 帧,每 10 帧 0.01333 DAMAGE_CURSE = 2 HP/s)+ 红火星;杀这一层 areachecker;shop_hitbox 失效。
     实现 `startCollapse / looseChunk / updateCollapse`(noitaPlay)+ `Entities.spawnLooseChunk`(任意 mask → 像素刚体,像素色保留原砖花色,材质 concrete_collapsed,睡着写回世界):
     1.0s 起 2.5s 内掉 44 团(半径 9~19 的不规则团,只抠 `^temple` 的 static 砖;窗口外的格子直接写 chunk.mat 并排重画)。`collapse_big/*.png` 没解包,形状用角向噪声代替。
   - 探针 `_noita-collapse-shot.mjs [url]`:砖 20305→14435、44 块、睡着写回 3106→3475 格 concrete、诅咒区 3s 掉 0.245(≈2 HP/s ✓)、areachecks 全 done、shop.area 全空、60fps、不重复触发;
     存档:金 777 / 杖 / 散卡 / collapsed 刷新后一致(y 差 1px 是落地取整),地形 concrete 3825 格从 ChunkStore 回来,崩过的出口不再触发。
   - **存档**(`saveGame / loadGame`,localStorage `noita_save_<seed>`):人(坐标 / 血 / 金 / 击杀)、特权(id 顺序重放 EFFECTS + nextIndex / picked / reroll 指针)、法杖(`wands.make(key,x,y)` 再覆盖 卡 / 次数 / 数值)、
     药水、散卡、当前格、守卫(angered / deaths)、已崩圣山。每 5s 有变化就存,pagehide / hidden / 死亡 / 复活立刻存;死在那儿关页 → 下次回出生点满血;死亡画面"重开一局"清档;`?new=1` 忽略存档。
     地形改动本来就在 ChunkStore(IndexedDB,按种子)里;怪 / 未睡刚体不存(区块重进按生成表重刷,和原版存档卸载区块的行为一致)。
7. **趟沙 + 导航加强**(2026-09-04,用户手机实测"落沙埴住走不动 / 不知道往哪走"):
   - `wadeSand(cx, cy)`:目标碰撞盒里挡路的格子**全是** sand 类(不是石头 / 刚体、≤10 格)→ 逐格挪到头顶上方 16px 内最近的空格(没有就两侧 ±3~5),返回可通行。
     横向:爬台阶(≤6px)失败后,在 0..climb 的高度里找一个"只剩沙挡着"的位置趟过去,vx×0.7;纵向:头顶是沙且在往上 → 钻;原地被埴 → 先推沙再往上顶。
     实测 24px 高 30px 宽的沙丘(比跳得高):x 227→311 走穿,身后留下自然堆。
   - 导航:人头顶一枚脉动大箭头 + "圣山 1143"(距离),屏边小箭头照旧;顶部标签改成带底色的 pill,挪到 HUD 下方(top 40px),第二行给"怎么去"提示
     (地表:找洞 / 朝脚下开火打穿;圣山:走到竖井口跳下去,圣山会崩)。HUD 第二行去掉法杖容量 / 延迟 / 充能细节(背包里看),手机上不再和标签叠。
   - 用户截图里出生点右边的灰色"金字塔"不是沙堆:是原版视差背景(`Sky.js parallax_*`)里的山体剪影,材质采样那一片全是空气。
8. **圣山入口 = 漏斗底的传送门**(2026-09-04,用户"到了 86 米进不去"暴露出来):
   - 数据考证:圣山行 = `altar_top`(y−40 起 300px:上 114px 漏斗 000042 空气,下面全是 786c42 templebrick_static,只在 (250~274, 208~232) 有一小池 7fceea magic_liquid_teleportation)
     + `altar / altar_left / altar_right`(y+260 起 282px)。三张房间图顶部全是砖,`altar_left` 的入口洞顶部也封死 —— **整座圣山从上方是密封的**,没有可走的洞。
     真值 chunk(512..2048, 1024)也印证:屋顶 1024~1284 全砖只留漏斗。wiki(Holy Mountain):"At the top of each Holy Mountain, a row of portals ... lead to the main interior;
     beneath each portal is an eye-shaped brickwork structure with a pupil basin filled with Teleportatium that powers the portal"。
   - 实现照 `teleport_liquid_powered.xml`:每个 altar_top 的 0xbf26a6 (264,90) 放一个传送门(`temple.spawnPortal`,y−4);`TeleportComponent target_x_is_absolute_position=1 target(−677, +280)`
     → 落到 altar_left 入口洞 (−677, y+280);Hitbox ±15 与玩家 Hitbox(−3..3 × −12..4)相交即传;`MaterialAreaChecker (x±2, y+136..140)` 每秒查传送液,抽干 → 门灭(暗环,不再传)、提示;
     亮着时 LightComponent (64,100,255) r255+r64 + 紫色粒子环 r15(spark_purple)。传送门每列都有(temple_wall 列的也通,原版一样)。
   - 导航跟着改:不在圣山 → 指最近一列的传送门 (列左沿+264, 行顶+46),标签"圣山传送门 ↓ 还有 N",提示"到底是个漏斗,跳进漏斗底的紫色传送门";
     人在圣山行但 y < 行顶+260(在漏斗 / 屋顶里)仍算没进圣山(`inTemple` / `updateQuest` 都加了这条,之前一进漏斗就切成"出口 500",用户以为还有 500 米)。
   - 探针 `_noita-portal-shot.mjs [url]`:4 个传送门 (−1272/−760/−248/266, 1070) 全亮;从 (−248, 940) 掉进漏斗 → 落到 (−677, 1415) temple_altar_left;抽掉眼睛里的传送液 → on=false + 提示,人留在漏斗。
   - **事故记录**:这一步中途用 PowerShell `Get-Content -Raw | Set-Content` 改文案,把 `noitaPlay.js` 的 UTF-8 中文全部写坏(GBK 双重编码,不可逆)。从 Cursor 本地历史
     (`%APPDATA%\Cursor\User\History\-7c83036f`,14:12:43 版)恢复后逐条重放了之后的改动(趟沙台阶组合 / HUD 行 / 滚轮 / 空杖提示 / 刷新补满 / 传送门)。**以后改源码只用编辑工具,不用 shell 重写文件。**
9. **怪物生命周期 + 走路 AI 重做 + 自由模式**(2026-09-04 晚,用户反馈"传送后没有怪物 / 怪卡在某个节点 / 本来出不来的怪突然跳出来 / 手机版别那么复杂,技能全开无限,主要玩材质"):
   - **传送后没怪的根因**:`Entities.spawnedChunks` 只加不删,区块被 LRU 卸载(常驻 40)后回来仍算"已生成";同时 `list` 超 240 只就砍最老的 → 回到去过的区块永远空的。
     改成两套:`spawnedChunks`(道具 / 物品 / 圣山特殊物只放一次,睡着的刚体已写进 chunk.mat,重放会重复)+ `liveChunks`(怪 / 虫跟着区块走);`ChunkStreamer.onEvict` → `Entities.unloadChunk(entry)`
     收掉落在该块里的怪 / 虫,回来 `spawnChunk` 只重刷 creature 行(原版卸载区块也不存活物)。上限改 600、超了砍离玩家最远的。探针 `_noita-tp-spawn-shot.mjs`:出生 → 挖掘场 10 只 → 雪窟 16 只 → 回出生 → 回挖掘场 **10 只**(之前 0)。
   - **bug2 穿墙冒出来**:`_walkStep / _flyStep / _crawlStep` 末尾的"卡在实心里就每帧往上顶 ≤16px"是罪魁——被落沙埴住 / 堵在坑里的怪一帧穿过顶上的石头。
     改 `_unstick`:±3px 内就近挪出(先往上),挪不出 = 被埋住,速度清零原地不动;出生落点卡在墙里另走一次性的 `_settle`(≤24px 上找)。`_blocked` 改成扫碰撞盒四条边每 1px(之前只采左右两列、竖向每 2.2px 一点,1px 地板 / 竹竿会漏),子步 1px。
   - **bug1 卡在节点**:旧寻路 8px 格只采格心一个像素、跳边最多 3 格但 `jumpV −125` 只能跳 13px → 路说能上、身体上不去,原地蹦到放弃再来。
     现在:① `noita-prepare-entities` 多抽 `PathFindingComponent` 的 `jump_speed / initial_jump_lob / initial_jump_max_distance_x/y / frames_between_searches`(base_humanoid 100/60,miner·shotgunner 60/60);
     ② `_findPath` 改 Dijkstra 桶队列,"能站" = 整个碰撞盒放这格不撞(真 `_blocked`)且脚下有实心,边:平走 1 / 掉 ≤12 格 / 跳(直上 j 格再横移 i 格,i ≤ initial_jump_max_distance_x/8 且 ≤ 抛物滞空 × 140px/s,j ≤ _y/8,代价 3+i+j 所以能走不跳;
     只在这一侧走不通或人在上面时枚举),Uint8Array 网格缓存,≤600 节点,实测 0.6~0.9ms/次;③ 路点带 jump 标记 → 走到起跳格中心 `_jumpTo(tx, ty)` 按 pixel_gravity 反算抛物线(竖向刚好越过 +4px,横向按滞空时间,≤140),
     空中 `lobT` 不往 run_velocity 收、贴墙不清 vx(过了墙顶继续往前);落地没到路点 → 立刻重算(不走回起跳点再来一遍);④ `frames_to_get_stuck` 到 → 重算,连卡 3 次 → 歇 1.5s;找不到路又撞墙 → 歇 1s 不在墙根蹦;
     ⑤ 闲逛不走悬崖 / 追人跳窄坑的"前方有地"改看脚下 1~12 行(之前只看脚下 +12 那一行,站 1px 地板上会左右抽搐)。
     探针 `_noita-ai-stuck-shot.mjs`(出生地上方砌试验场):僵尸 1.3s 跳上 32px 台子追到人开打 / 整个埋进石头的僵尸 6s 不动 / 1px 地板上的僵尸不掉穿、到边缘折返。`_noita-climb-shot`(蜘蛛爬柱)/ `_noita-ai2-shot` / 挖掘场一屏 60fps 无回归。
   - **自由模式 FREE**(默认开,`?free=0` 关):`flags.editAnywhere`(随处改法杖)、`wands.infinite`(不扣法力、有限次数不减)、`wands.allUnlocked`(`spawn_requires_flag` 的法术也进商店 / 工具箱池)、每根杖容量至少 8;
     背包多了**法术库** `#edLib`(`wands.usableSpells()`:弹丸都在 projectiles.json 里的 + 有效果的修饰 + 多重施放,共 165 张按类型分组,点一张装进选中法杖,取下即丢)。手机隐藏 `#panel` 调试栏和"上报日志"。
     探针 `_noita-free-shot.mjs`:出生地开背包可编辑 / 165 张 / 装 MATERIAL_LAVA + FIREBALL 连开 3s 法力 100→100。
     用户追加("只有 4 格怎么扩 / 加了法术后每次点击是依次的 / 法杖全部开通"):自由模式 **8 根杖**(`flags.wandSlots`,EXTRA_WAND_SLOT 仍叠加)、**每杖 20 格**(`FREE_CAPACITY`,存档载入也抬到 20)、
     ~~点一下把杖里全部卡一起放出~~ —— **这是错的,已撤回**(用户:"他是一个法杖多个效果,是组合,比如多重是多个弹")。
   - **施法模型按 gun.lua 重写**(`Wands.cast`,逐条对着 `draw_shot / draw_action / draw_actions / add_projectile_trigger_* / _handle_reload`):根 shot 抽 `actions_per_round` 张(牌库抽空就停);
     每张卡:法力不够 / 次数用完 → 弃掉换下一张;PROJECTILE / STATIC / MATERIAL → 进当前 shot;**MODIFIER** 改 c(`speed_multiplier` 累乘 —— prepare 脚本新抽 `speedMul`(加速 ×2.5 / 重击 ×0.3)和 `damage_projectile_add`)再 `draw_actions(1, true)`;
     **DRAW_MANY** `draw_actions(N, true)` 再抽 N 张进同一 shot(无尽 = 剩下全部),抽到牌库尾**绕回**一次(弃牌回牌库 + 这发之后充能);**触发弹**(`add_projectile_trigger_hit_world / timer / death`)先抽 1 张当载荷挂在弹上(`payload`,可嵌套),
     `ProjectileSystem._die` 时在撞点(退 2px)沿原方向放出;shot 里全部弹同一帧发出;施法延迟 = 杖 + Σ卡、充能 = 杖 + Σ卡。infinite 只是不扣法力 / 次数不减 / 充能 0。
     探针:[二重, 火球, 岩浆, 火花弹] 第一下 火球+岩浆、第二下 火花弹、第三下绕回;[火花弹·触发, 炸弹] → light_bullet{bomb},弹死 → bomb 出现;[加速, 火花弹] speedMul 2.5。
   - **法杖面板 UI**(原版法杖提示框那几行):每根杖显示 洗牌 / 每次施放 / 施法延迟(帧 + 秒)/ 充能 / 法力上限 / 法力恢复 / 容量 / 散射,自由模式带 −/+ 可调(容量 ≤26,存档带走);
     卡框按 ACTION_TYPE 上色(弹丸红 / 场橙 / 材质蓝 / 修饰紫 / 多重绿),悬停看 名字·类型·法力·次数·延迟·散射·速度·触发说明·原文描述;法术库分组头带色块和一句规则,顶部一段"怎么组合"说明。
     用户追加("怎么把子弹放到第 4 个法杖,没法放"):根因是底栏 8 格但开局只有 2 根杖,空格不是杖、背包里也没这行 → 自由模式 `fillWands()` 用**空法杖**(`blankWand`:借 17 根固定杖之一的外形,清卡 / 不洗牌 / 20 格 / 延迟 5f)把背包补满到 `wandSlots` 根,
     新局和读老存档都补;捡杖时满了就顶掉一根还没装卡的空杖(`pickWand`)。编辑器:开背包默认选中**手里那根**(payload),只有选中的杖展开属性面板、其余压成一行(8 根不用翻几屏);
     `#tip` 被 `#editor`(z 20)盖住导致所有提示看不见 → 编辑器底部 sticky 行加 `#edMsg`(装进 / 取下 / 满了 / 先选杖 都在这儿说)。探针 `_noita-free-shot.mjs` 加真实点击:点第 4 行 → 点法术库第一张 → 空法杖 4 得到 BOMB → 底栏第 4 格开火出 bomb。
   - **黑洞修对**(用户:"巨大黑洞效果不对"):之前巨大黑洞只是一张 alpha 0.1 的贴图原地待 8s、死时 1px 洞,什么都不吞。原版 `black_hole_big.xml` 的本体是引擎内置 **BlackHoleComponent**(radius 1 / damage_probability 0.25 / particle_attractor_force 6)
     + `black_hole_big.lua`(每 3 帧 radius = min(64, radius+1))+ `black_hole_gravity.lua`(150px 内弹丸每帧 v += 196×(1−d/150) 朝中心,刚体 ×0.2)。prepare 脚本新抽 `d.blackHole {radius, damageProb, attractor, grow{every,max,step}}` 和 `d.gravityWell {dist, coeff, bodyMul}`(常量从 lua 正则抽)。
     ProjectileSystem:`p.bhR` 按 grow 长大 → `_eat` 半径内全吞([indestructible] 除外,debris 1%)→ `hooks.blackHole(x,y,r,prob)` 圈内怪 / 虫 / 刚体 / 玩家每帧按概率吃 `BLACK_HOLE_DMG`;`gravityWell` 拉其他弹(黑洞之间不互吸,tag black_hole)+ `hooks.pull` → `entities.pull`(活物 / 刚体,走路怪这帧 `e.pullT` 跳过 AI 限速)+ 玩家;
     渲染:黑洞本体 = 纯黑圆盘 + 粉色边光 + 往里飞的粉粒子,不画那张 sprite。**每次命中伤害 0.25 是倒推的**(xml 没有;wiki Omega Black Hole 210 curse/s ÷ 25 ÷ 60 ÷ 0.55 ≈ 0.25),玩家吃黑洞伤害不走 0.5s 无敌帧。小黑洞(`black_hole`,CellEater 12 / collide_with_world 0 / 速度 40)原来就能穿地吃洞,现在也带 gravityWell。
     探针 `_noita-blackhole-shot.mjs`:巨大黑洞 3.8s 后 r=64、60px 内 10506 格实心 → 0、圈内僵尸死掉、8.3s 消失;小黑洞朝下 1.5s 走 70px 挖出 60 格通道。
     用户追加("LooseGroundComponent 也要做,还有自己不能被吸进去"):(1)照 lua 改回**只吸刚体和弹丸**(`PhysicsApplyForceOnArea` + tag projectile),玩家 / 走路怪不吸 —— 第一版把玩家和怪也拉是我多做的;`e.pullT` 撤掉。
     (2)子实体 `LooseGroundComponent`(probability 0.2 / chunk_probability 0.03 / max_angle π,lua 每次 max_distance = radius + 20)→ `d.blackHole.loose`;每帧按概率在洞边缘外 20px 环里挑一点,把 6~16px(chunk 16~32px)的一圈静态地面变成同类松散材质(`_loosen`,从 explode 里抽出来复用),掉进洞里被吞;探针里洞外 64~84px 环 3940 格松散 / 1448 格静态。
   - **场类(原地 5)修对**:`base_field.xml` 的 `LifetimeComponent 7200` 被 ProjectileComponent 的 9999999 盖住 → prepare 取两者较小;`GameAreaEffectComponent`(radius 28 / frame_length)+ `damage_game_effect_entities`
     → `d.areaEffect` → `hooks.areaEffect`:圈内怪吃 FROZEN(120 帧)/ ELECTROCUTION(40 帧)定住(`e.stunT`,电击冒蓝火花);`EnergyShieldComponent radius 28` → `d.shield`:进圈的敌方弹按离心方向弹开。
     静止之环还带原有的 MagicConvert(r72 冻液体)。电击的伤害是引擎 ElectricityComponent 内置,没有数值可抽,先只做定身。
   - **雷霆之环 + 电(用户:"雷霆效果也有问题,5 张橙色的全部对一下")**:原版 `electrocution_field.xml` 除了 GameAreaEffect(圈内怪 40 帧定身,shooter 不算),还有 `electrocution_blast.lua` 每 10 帧在圈内 ±28 随机点朝随机方向
     `shoot_projectile misc/electricity.xml` —— 引擎内置 **ElectricityComponent**(component_documentation 默认 energy 1000 / speed 32 / probability_to_heat 0,这张卡 0.1):电流碰到**导电材质**就钻进去窜,碰到活物就电。
     实现:(1)`materials.xml` 里只有金属显式 `electrical_conductivity=1`、油 / 胶水显式 0 → 真液体缺省导电(prepare-assets 补默认;水 / 血 / 岩浆 / 酸 … 都导,粉末 / 静态不导);
     (2)`ProjectileSystem`:`d.electricity {every, spread, shotSpeed, energy, speed, heat}`;`_shootElectricity` 从随机点朝随机方向走一帧路程(5000/60 ≈ 83px,没碰撞),第一个导电格开一条 `zap`;`_stepZaps` 每帧走 speed 格(8 邻里挑导电格,偏向惯性方向 + 随机,没亮过的优先),走一格耗 1 energy,走出导电材质就断;
     走过的格进 `elec` Map 亮 0.15s(渲染:亮蓝白闪 + 电流头一团蓝光),`heat` 每帧按概率把头上那格烧成 warmth_melts_to(水 → 蒸汽);
     (3)`hooks.shock(cells)`:碰到亮格的怪 / 玩家 每 10 帧最多电一次 → `stunT` 40 帧 + `ELEC_DMG` 0.4(引擎常量,取 wiki Damage Types 页电伤害示例 `AreaDamageComponent damage_per_frame=0.4`;泡电水里 2.4/s,满血 1.7s 死,和原版"电水必死"的手感一致);玩家被电不吃 0.5s 无敌帧(wiki:湿身时电击没有无敌帧),`player.stunT` 期间不能动 / 不能开火。
     探针 `_noita-field-shot.mjs`:圈放在水池左上,圈外水里的僵尸被电死、玩家走进电水 1.5s 被电 5~6 次掉 2 血、定身 0.67s。
   - **其余 4 张橙色一起对了**:
     - 静止之环:`MagicConvertMaterialComponent` 之前是"每帧随机抽 steps×60 个点"—— r72 的圈 1.6 万格只抽 300 个,基本冻不住;改成照原版语义**从中心一圈圈往外扫**(每帧 steps_per_frame 圈,1 圈 = 1px 环),loop=0 扫到 radius 就完(触摸系 4 帧扫完 20~30px、静止之环 15 帧冻完 72px),loop=1 从头再来(冰球 / 火球一路飞一路转)。探针:1560 格水池 1s 全冻成 ice_static。
     - 遮蔽之环:EnergyShield 弹开敌方弹已有,探针敌方弹 vx 682 → −682。
     - 雨云:`cloud_position.lua`(出生时往上 RaytraceSurfaces 40px 挂到天花板下)→ `d.riseTo`;下真水 379 格/2.5s 已有。
     - 巨大黑洞:补声音(下条)。
     - 场类精灵:`SpriteComponent` 之前只读子文件,丢了 base_field 的 `alpha 0.25 + additive` → 改成 Base 打底;`blast_frozen.xml` 的 `color_r/g/b` 染色(淡蓝 / 青)+ `next_animation`(spawn 5 帧 → fireball 行脉动)进 `d.sprite.tint / .next`,运行时 `p.spr` 切动画;雷霆之环 image_file="" 不再在圈心画白点。
   - **黑洞第三次修(用户:"黑洞还是不对,看 E:\...\Noita.v20250125-P2P 怎么实现的,反一下")**:游戏目录 `tools_modding/component_documentation.txt` 有引擎组件文档 ——
     `BlackHoleComponent`:radius 16 / particle_attractor_force 2 / damage_probability 0.25 / **damage_amount 0.1**(之前 0.25 是倒推的,改成文档值);`ElectricityComponent` energy 1000 / speed 32;
     `LooseGroundComponent`:"shoots a ray in random direction"(`_loosen` 改成从中心绕上方向 ±max_angle 射线,碰到的第一块地面崩;圈里圈外都算);`MagicConvertMaterialComponent` 有 mRadius(证实是扫环)。
     再把 wiki 的演示 gif 抽帧看(`Spelldemo_giga_black_hole_1.gif`):巨大黑洞**不是一个黑盘子一口吞掉圈内**——画面是一圈很淡的紫环,圈里的地面被一块块崩成飞行像素,
     被 attractor(lua:= radius × 0.25)拉着绕中心打转、在中心湮灭;满屏粉色长条流光(emitter plasma_fading_pink draw_as_long attractor_force 32,lua 把出生范围改成 ±radius)朝洞心飞;
     玩家离 ~100px 也被吸进去、屏幕变红(wiki:"attracts enemies"/"trying to resist its pull"—— 之前按 "自己不能被吸进去" 把玩家 / 怪的吸力去掉是理解反了,现在恢复:BlackHoleComponent 吸活物,gravity lua 吸弹丸 / 刚体)。
     实现:`_bhCrumble` 每帧在圈内抽 (8 + R/4) 个小块(半径 1~2)从世界拿掉变 `bhParts`(材质原色 1px,重力 + attr px/s 每帧朝洞心 + 轻阻尼,到中心 3px 内消失,上限 4000);
     `hooks.blackHole(x,y,r,prob,dmg,attr,dt)` → `entities.blackHole` 伤害 + `entities.attract`(150px 内 v += attr × (1 − d/150),走路怪 `pullT` 这帧不按 AI 限速)+ 玩家(`player.pullT`:没按方向时不做"松手减速",按方向才是在抵抗)+ 飞着的 debris;
     渲染改成淡紫圆盘(lighter 0.16)+ 1px 亮边 + 材质色碎屑像素,黑盘子和自造的粉粒子删掉,fx 粒子支持 `attractor_force`。
     探针:r64 时 3.75s 圈内 10506 格剩 2170、飞行像素 3629 颗;5.9s 剩 789;僵尸 0.33s 死;玩家 90px 处每 100ms 被拉 2px(从静止起步)。
     用户追加("颜色不对,没原版华丽"):把 gif 帧放大 4 倍取色 —— 环是 2px 紫红(≈150,60,150),圈内一层暗紫雾,流光是 2px 粗 6~14px 长的亮粉紫条,整片被 LightComponent 的洋红光罩着、碎屑都泛粉。
     我们的光照图是 multiply(白天彩光没效果),所以黑洞的光直接在 ProjectileSystem.render 里用 lighter 叠:大范围洋红软光(r + 64)+ 中心亮核;圈内 rgba(40,0,55,0.5) 暗紫雾;环 2px rgba(235,110,240) + 5px 软边;
     带 attractor 的 fx 流光单独在最上层画两层线(2px 洋红 + 1px 亮粉芯,长度 3 + 速度/50 ≤ 14)。
     用户再纠("黑洞不是黑的么,怎么会粉红"):对着 wiki `Demo_Black_Hole_Sizes.png` 取色 —— 本体是**暗紫黑、接近不透明**的圆盘(白底上 rgb≈70,60,80 → 底色 (20,14,30) 约 78% 不透明)+ 1px 细粉边(≈225,140,235),
     洋红光只在盘外一圈淡淡的光晕。之前把圈内填洋红 + 中心亮核是过头了,改回:盘 rgba(20,14,30,0.78)、边 1px、盘外 lighter 光晕 0.16 → 0(r → r+64),粉色只在流光 / 细边 / 光晕。
   - **黑洞第四次:反 exe(用户:"不能破解 Noita.v20250125-P2P 看效果怎么写的么")**:机器上有 Python `capstone` + `pefile`,写了 `%TEMP%\_reva.py`:在 exe 里找字符串 → 找 .text 里引用它的 32 位地址 → 回溯 `55 8B EC` 函数头 → 反汇编,
     抽 call 目标 / 浮点常量(从 .rdata 解析)/ 立即数 / 字符串。`noita_dev.exe` 比正式版多留了断言文字(`BlackHoleSystem_Raytrace() hit an endless loop`、`mGrid->IsSafe(...)`),源码路径 `source/component_updators/blackhole_system.cpp`。
     反出来的 `BlackHoleSystem::Update`(0xb4fde0)每帧:
     (1)**吃格子靠射线**:最多试 100 次随机角,从中心射到 radius(Raytrace 0xb4f330),第一条打到格子的射线吃掉命中格;再以命中点为基准沿垂直方向(|dx|>|dy| 沿 y,否则沿 x)偏移 ±1..8 px 各射一条 → 一帧最多 17 格,一条"扇面"。所以是从内表面一层层啃(≈1000 格/s),不是一口吞,r64 的圈 8.3s 吃不完 —— 这就是 gif 里圈内还剩地面的原因。
     (2)**吃掉的格子 CreateParticle(原材质)**(0xb4f620):速度 = 径向方向旋转 π/2(常量 1.5708)× attractor × 4(常量 4.0),再叠 rand×20−10 随机 —— 切向甩出,被吸引器拉回来就绕圈,这就是漩涡;50% 的粒子多一个标记(0x41400000=12.0 的字段,没解出含义)。
     (3)**粒子吸引器**:注册 {x, y, radius × 3, attractor × −0.025}(范围 3R,负号 = 吸)。
     (4)**实体**:±radius 方框内(不是 150)的实体,VelocityComponent / CharacterData 的 mVelocity += attractor × 1.5 × (径向 + 径向旋转 π/2) —— 一半拉一半切,怪和玩家也绕着掉进去;Box2D 刚体范围 1.5R,力 ∝ (1 − d/1.5R) × attractor,外加 rand×30−15 的随机转矩。
     (5)**伤害**:每帧掷一次 `rand < damage_probability`,中了就 DamageEntitiesInRadius(radius, damage_amount, tag "mortal");伤害原点是中心附近 (rand×90+30)×0.5 px 处的随机点(只影响击退方向)。
     实现照改:`_bhCrumble` 改射线扇面,`_bhEatCell` 切向初速 4×attr,`bhParts` 吸引加速度取 12×attr px/s²(吸引器单位反不出来,按"切向 4×attr 时轨道半径约洞半径 1/3"定)+ 阻尼 0.988/帧,范围 3R;
     `entities.attract` / 玩家改成 ±R 方框 + attr×1.5×(径向+切向);伤害改每帧一次全局掷骰。探针:3.75s 圈内 10506 格剩 5831、5.9s 剩 3783(和原版"啃不完"一致),碎屑 2400~3600 颗绕中心成团。
   - **黑洞没声音(用户)**:原版是 FMOD 事件(`AudioComponent event_root` + `AudioLoopComponent`),没有音频文件可抽。prepare 抽 `AudioLoopComponent event_name` → `d.loop`(black_hole_big / black_hole / field / field_electric);
     运行时 `projectiles.loops` 记录本帧活着的循环名,noitaPlay `PROJ_LOOPS` 按名字配合成噪声音色(黑洞 70Hz 低鸣、场 520Hz 嗡鸣、雷霆之环 3.2kHz 滋滋、电流 zap 4.2kHz),音量随离玩家距离衰减;黑洞出生再来一声 rate 0.35 的低沉 explosion。
   - 冒烟方式变了:`8.162.5.160:80` 现在 301 到 https(它其实是阿里 ENS 边缘节点),要 `$env:ORIGIN_IP='8.162.5.160'; $env:IGNORE_CERT='1'` + **https://** URL;线上首屏资源到齐慢(27MB 冷缓存),探针要等区块就位再测。

---

## 2.4 反 noita_dev.exe 得到的引擎规则(用户:"把现有的子弹效果都反一下,要精确")

工具(都在 `%TEMP%`,丢了照这里重写,Python 需要 `capstone` + `pefile`):
- `_strings.py exe pattern`:扫字符串;`_reva.py exe pattern [n] [--asm]`:找引用某字符串的函数并反汇编,抽 call / 浮点常量 / 立即数 / 字符串;
- `_asmat.py exe va count [--skip-asserts]`:带注释反汇编(内存浮点常量、字符串标在行尾);`_funcs.py exe start end`:按 int3 切函数列摘要;
- `_vtable.py exe ClassName`:RTTI → vtable(ComponentUpdator 22 槽,但每组件 Update 是 std::function 里的 lambda,得从同编译单元相邻函数 / 断言字符串找);
- `_rdconst.py exe va…`:读常量。`noita_dev.exe` 比正式版多断言文字,源文件名 `source/component_updators/*_system.cpp`、`gameplay_utils/explosion_factory.cpp`。
- 字段文档:游戏目录 `tools_modding/component_documentation.txt`;ConfigExplosion 字段在 wiki `Documentation:_ConfigExplosion`。

结论(已照改,探针 `_noita-explosion-shot.mjs` / `_noita-blackhole-shot.mjs` / `_noita-field-shot.mjs`):

1. **ExplosionFactory::IMPL_DoExplosion**(0x685350,4680 条):
   - 先建 360 项随机表 `0.25(1+sin(i/90)) + rand×0.5`(大爆炸 r>60 时用来再抖一下边)。
   - **CastRays**:360 条射线(1°/条)从中心 1px 步走到 `explosion_radius`;每个实心 / 液体格 `take = min(energy, 材质 hp)`,`energy −= take`;撞上 `durability > max_durability_to_destroy` 的格立即停(该格不算);energy 归零停;返回到达距离²(+rand 0/1)。
     材质 hp:rock_static 100000 / rock_hard 200000 / soil 2000 / sand 800 / steel_static 130000 / templebrick 1000000;ray_energy:火球 5 万(挖不动岩石,只挖土)、光弹 40 万、炸弹 600 万、圣炸弹 640 万;文档默认 20000。
   - **格子循环**(±total_radius 方框,total = radius + stains_radius):dist² ≤ radius² 且 ≤ 自己角度射线到达距离² → 摧毁;空格按 `create_cell_probability`% 各自掷骰生成 `create_cell_material`;液体 `hole_destroy_liquid=0` 时**抛飞**(CreateParticle ±0.35 随机速度)不是留着;
     `destroy_non_platform_solid_enabled=0` 时平台不拆;material_sparks:格 hp ≥ material_sparks_min_hp 且 rand%100 < probability → count_min..max 颗真材质火花,速度 ∝ 偏移 × −4;染色 `normalized_distance_from_hole_edge = ((d² − r²)/(total² − r²))²`。
   - **DamageMortals**:方框 ±radius 里的实体,中心距离 ≤ radius,跳过 `dont_damage_this`;取 hitbox 四角 + 10px 网格采样点,任一点 `射线到达² ≥ 实体中心距离²` 才算打到(墙挡住没伤害);
     伤害 = `config.damage × hitbox damage_multiplier`,**没有距离衰减**;击退冲量 = 方向 × lerp(physics_explosion_power.min, .max, 1 − d/r) × knockback_force × 3600(我们 ×120 换成 px/s)。
2. **ProjectileSystem**(projectile_system.cpp):
   - 反弹(0xd31873):`bounces_left--`;反射 r = v − 2(v·n)n;`r̂·v̂ > 0.75`(= 1 − 2cos²θ,入射离表面 < 20.7°)才弹,否则要 `bounce_always`;速度 × `bounce_energy`(默认 0.5)。
   - 命中(0xd33c96):伤害 = `damage`(× 传入乘数);`damage_scaled_by_speed` → × min(1, 速度 / (damage_scale_max_speed || 初速));击退 = `knockback_force × 弹速 × 弹 mass / 目标 mass`(文档原话;光弹 kb 0 不推人、bullet 1.8、heavy 2.6、rocket 3);`penetrate_entities` 穿过实体每个只伤一次。
   - 撞世界会 spawn `misc/crack.xml`(裂纹电流,速度 rand×2 × v);打到刚体给它 dir × 5 的速度。
3. **VelocitySystem::Update**(0xd67458):`v += g·dt`;`v −= v·air_friction·dt`;液体里 `v −= v·liquid_drag·dt·液体格数`;`|v| ≤ terminal_velocity`;位置 += v·dt。
   **默认值(文档)gravity_y 400 / air_friction 0.55 / terminal 1000 / liquid_drag 1** —— xml 没写就是这些,之前 prepare 当 0:手雷 / 石子 / 地雷 / 长枪 / 钻头都该有 400 重力;没有 VelocityComponent 的实体(circle_* / touch_*)根本不动。
4. **BlackHoleSystem**:见上面 2.3 第四次修黑洞(射线扇面 17 格/帧、切向 4×attr 甩出、±R 方框吸力 attr×1.5 径向+切向、每帧一次掷骰伤害)。
5. **ElectricitySystem::Update**(0xbe4a00):每步最多 16 次:mAvgDir 两侧 ±135°(rand×3π/2 − 3π/4)随机角,步长 = 方向 × 2 取整(2px 一跳),目标格非空、导电、10 帧内没电过;16 次都不行才断。我们加了 1px 邻格兜底(浅水坑 2px 跳容易出水面),让电流留在坑里持续闪。
6. **CellEaterSystem**(0xb71230):±radius 方框,dist² ≤ r²,`rand % 101 < eat_probability`,吃掉的格出 `spark` 火花 —— 和我们的 `_eat` 一致。
7. **MagicConvertMaterialSystem**:`mRadius` 逐帧长(证实是从中心一圈圈往外扫),`min_radius < radius`,`stain_frozen` 用 stain_frozen.png。
8. **GameAreaEffectSystem**:`out_entities / out_hitboxes` 一一对应,半径内实体每 frame_length 帧加一次 game effect —— 和我们一致。
9. **修饰卡(用户:"还有这么多修饰效果到底怎么反应的,瞬移、激光、反作用力浮空")**:
   - 数据侧:`gun_actions.lua` 每张卡的 action 体就是对 `c.*`(ConfigGunActionInfo,默认值在 `gunaction_generated.lua`)和 `shot_effects.recoil_knockback` 的一串操作。
     prepare-wands 把它们抠成 `ops`(add / mul / set / append / cap / floor,if-clamp 也识别);`scripts/_dump-modifiers.mjs` 能列全表(491 张卡,179 张修饰;字段频次:fire_rate_wait 312、extra_entities 136、recoil 78、spread 71、speed 63…)。
   - `gun.lua` 语义(Wands.cast 照抄):`c` **每个 shot 一份**(`create_shot` → 默认值;根 shot 从法杖 gunaction_config 拷);同一 shot 里所有卡(弹丸卡自己也改 c:火球 +20 后座、火花弹 +5 暴击)的 ops 都进同一个 c,
     `register_action(c)` 一次 → shot 里所有弹共享最终 c;触发载荷是新 shot(新 c);`shot_effects` 整次施法共享。
   - 引擎侧:`extra_entities` 是挂在弹上的子实体,绝大多数是 lua(数值原样抄进 `Wands.EXTRA_BEHAVIOR`):piercing_shot(on_collision_die=0)/ clipping_shot(penetrate_world,墙里 ×0.1)/ fly_up|down(第 20 帧竖直 2|v|)/
     chaotic_arc(每 2 帧 ±0.4·max|v|)/ floating_arc(探 30px 悬 12px,vy 限 ±240 各一半)/ avoiding_arc(每 3 帧四向探 20px,(20²−d²)×0.3)/ lifetime_infinite / remove_bounce / nolla(1 帧)/ accelerating(air_friction −3)/ decelerating(+6)/ autoaim(200px 最近敌人 lerp 0.8 ±0.1rad)/ homing_cursor(朝法杖朝向转 20%)/
     explosion_tiny(聚爆卡:`c.explosion_radius −30` 之外还挂 `explosion_tiny.lua`,第 1 帧把 `config_explosion.explosion_radius` **直接设成 5** —— 火箭 15−30 = −15 不会出现;09-05 用户报"魔法飞弹 + 聚爆碰地卡死"就是负半径喂进 `createRadialGradient` 抛错停了整个循环,现按 lua 设 5,`explode()` / 光闪再兜底夹 ≥0)。
     **HomingComponent**(反 exe HomingSystem::Update 0xc4adc0):detect_distance(默认 150)内最近目标;accelerate 模式 `v = v × velocity_multiplier + dir × targeting_coeff × dt × (1 − d/detect)`(所以追踪弹会明显变慢);just_rotate 模式只按 max_turn_rate 每帧转向。
     homing 130/0.86、homing_short 480/0.83/60、homing_shooter 30/0.99/300(追射手)、anti_homing −130、homing_rotate 0.2rad、homing_accelerating 20/0.4/200 每帧 +2/+0.01。
     **SineWaveComponent** m 0.6 × sin(freq 1.0 × 帧)当方向摆;**AreaDamageComponent** r16 每帧 0.14。
   - **后座力**(反 exe GunSystem::ShootShot 0xc41ee0):`recoil_knockback > 0` 时,射手 CharacterData.mVelocity −= 瞄准方向单位向量 × recoil(px/s,直接加);RECOIL 卡 +200、激光 +20、火球 +20、轻击 −10。朝下打 = 每发向上 200 px/s → 一直浮空,就是视频里那个。
   - **瞬移**:TELEPORT_PROJECTILE = `teleport_projectile.xml` 带 TeleportProjectileComponent(引擎):弹死在哪射手传到哪(min_distance_from_wall 4,y 速度归零);
     TELEPORT_CAST 是工具卡:`add_projectile_trigger_death(teleport_cast.xml)`,teleport_cast.lua 出生就跳到 96px 内随机一个敌人身上,2 帧后死 → 载荷在敌人身上放出。
   - **激光** LASER = `laser.xml`:普通弹,speed 130~150 但 air_friction −9(每帧 ×1.15 加速,被 terminal_velocity 1000 截住)+ 0.22 伤害 + `effect_disintegrated` + 后座 20。数据驱动,VelocitySystem 那套改对后自然对了。
   - 其余 c 字段作用(引擎 GunSystem 按 RegisterGunAction 的 c 改弹):speed_multiplier 乘初速(lua 已 clamp 0~20)、lifetime_add 加帧、bounces 加次数、gravity 加到 gravity_y(GRAVITY +600)、knockback_force 加击退(KNOCKBACK +5)、
     explosion_radius / damage_explosion(_add) 加到 config_explosion(HIGH_EXPLOSIVE +64 / +3.2,没爆炸配置的弹加了半径也会炸)、friendly_fire、game_effect_entities 命中给状态(frozen / electricity / on_fire)。
     法术库现在放出 110 张修饰卡(`usableSpells` 只放我们实现了效果的 ops);卡片 tooltip 用 `editor.opsText` 把 ops 翻成人话。探针 `_noita-modifier-shot.mjs`。
10. **模拟窗口(用户:"手机上子弹飞出屏幕,爆炸的地形要走到那里才开始动,看起来像静止")**:根因是 CellSim 只绑视口 +24px、ChunkStreamer 只请求视口 +32px,
    屏幕外 `sim.get` 返回 −1、`sim.set` 失败,爆炸挖不动、崩下来的沙 / 液体不流,人走过去窗口盖到才开始动。Noita(GDC 2019 talk)模拟的是玩家周围一整片加载区(≈ 3×3 chunk),
    靠脏矩形 / 睡眠让代价只和"在动的格子"有关。改法:`simWindow()` = 视口 ± 512px(跨度 < 1536 保证落在 CellSim 4×4 表里,手机横屏 VH≈200 时是 4×3 chunk),
    `sim.bind(窗, inner=视口圈)` 只要求视口圈就位、外圈没到当 −1;`streamer.update(view, dt, simRect)` 把模拟圈纳入需要集(优先级在可见 / 前方之后,cache 48 够放);
    `entities.update(dt, simWindow())` 屏幕外的怪也走 AI。探针 `_noita-simwindow-shot.mjs`(844×390 横屏):屏幕外 500px 的沙柱 1s 落完、−450px 处炸弹当场挖 2530 格、+400px 的僵尸在走;
    快跑 1200px 可见空洞帧 0、常驻 40 块、模拟 0.2ms;`_noita-far-shot.mjs` 跳 6 个远点截图,地表 / 山厅 / 圣山 / 挖掘场都正常。
11. **地表植被(用户:"地表被炸了树 / 蘑菇跟着往下掉,合理?反一下 Noita 怎么做")**:biome xml 的 `VegetationComponent` 分两类(`scripts/_dump-veg.mjs` 列全表):
    - `is_visual="0"` + png(云杉 / 阔叶 / 大小蘑菇 / 仙人掌 / 沼泽树 / 枯草):对应 `entities/vegetation/*.xml` = **PixelSpriteComponent**(把图的实心像素烙进材质格,`material=tree_material`:wood_loose / fungus_loose / cactus,
      `diggable=1`、`kill_when_sprite_dies`)+ **SimplePhysicsComponent**(`can_go_up=0`:脚下没东西就整株往下掉,不会往上)+ VelocityComponent(默认重力 400)。所以原版树是能被子弹打中、火烧、爆炸炸掉一块的,
      脚下挖空会整株竖直落下 —— "跟着掉"是对的,但应该是按重力掉、像素级可破坏,而不是整张贴图瞬移到新地面上。
    - `is_visual="1"`(灌木 / 草丛 / 藤蔓 / 气根 / 红草;或无图的 grass / moss / snow 表层材质):纯贴图,不进格子、不掉。
    - 之前我们全是"decor 贴图 + 每次重画按当前地面重算落点"→ 炸了地面树就瞬移下去、还打不中。改法:
      Worker `World._vegAnchors` 给 is_visual=0 的落点标 `solid / mat / id`,`_stampVeg` 生成时把实心像素烙进 `chunk.mat`(只写空气格,PixelSprite clean_overlapping_pixels=0);
      落点只算一次:重画 / 读档时主线程把 `e.decor` 里的 veg 落点传回(`requestChunk({mat, veg})`,`ChunkStore` 存档带 veg),Worker 不再按被挖过的地面重算;
      `ChunkPainter._paintVegetation` 对实心植被逐像素画、只画材质格里还是 tree_material 的像素(被炸掉的部分就没了);
      主线程新增 `Vegetation.js`:每 10 帧看每列最低活像素正下方有没有静态格(同材质 = 旁边那棵树,不算撑),全空就 `_lift`(活像素从格子里抬出来存 mask + 小画布)按 400 px/s² 掉,
      1px 一步试落点,碰到静态格 `_land` 烙回去(沙 / 液体让位),decor 归属换到落点碰到的 chunk;一个活像素都没了就删实体。
      探针 `_noita-veg-shot.mjs`:云杉 2957 格进材质、火花弹撞树死、脚下挖空后 52px 落到坑底、1429 个自有像素落地后 1399(边缘落在静态格上的丢 2%)。
12. **用户三张截图的一批细节(09-05)**:
    - 天上悬一块 512 的岩石正方形(树左上方):biome_map (cx33,cy11) 是 `roadblock.xml`(色 f0d517),原版 = `_EMPTY_` wang + `coarse_map_not_terrain` + roadblock.png 全透明只有一个生成点(10 只 acidshooter 的天空陷阱)→ 空气。
      我们 BIOMES 没登记 → 走默认 solid 填岩石。补登记 roadblock(air)、scale / watchtower(沙漠地表静态图块,按 desert 打底)。
    - 站树顶往下陷:玩家碰撞盒只测左右两角,树尖 / 细枝正好落在两角之间就穿下去。`bodyBlocked` 顶 / 底两行整行采样,`onGround` 用 `groundUnder` 整行。
    - 激光 / 等离子渣留在地上不消失(图 2 绿点):laser 爆炸 `create_cell_material=plasma_fading_green`,材质 tag `[evaporable_fast]`,materials.xml 反应表 `[evaporable_fast] + air → air + air`(45%/帧)、`[evaporable] + air`(15%,血 / 泥浆)。
      我们 `_react` 里 `t <= 0 → continue` 把和空气的反应全跳了,而且液体停下块就睡、反应根本不跑。改:允许 t=0;`airRx[m]`(会和空气反应的材质)每帧 `_markOne` 不让睡。探针:120 格 1.5s 后 0。
      落着的渣能托住人也一并没了(plasma_fading_green liquid_sand=1 按沙处理,但几帧就蒸发)。
    - 湿身碰火"要有个过程":status_list.lua WET / BLOODY / SLIMY / RADIOACTIVE `protects_from_fire=true`(OILED 表里也写 true,但 wiki / 实测是"更易燃、烧更久",按 wiki);
      wiki:沾污 "is depleted by contact with Fire",1% 沾污就全额生效,晃动才掉(stain_shaken_drop_chance)。改 `player.wet` 语义 = 沾污量 0~10:泡液体 0.25s 沾满、只湿脚最多 4 成;
      站着 ~80s 干、跑着 ~10s;碰火时防火沾污每秒烤掉 4 成(冒蒸汽),烤光才点着;着火伤害改为 2% 最大血 / 秒(wiki,原来 0.2/0.5s 是 5 倍);OILED 烧 12s;泡任何液体立刻灭(含油,wiki)。
      头顶画 `ui_gfx/status_indicators/*.png`(解 data.wak 拷到 res/ui/status)+ 剩余量条。探针:满湿站火里 3.4s 才烤到 0.39,期间 0 伤害。
    - 死后"回出生点"上一局的坑 / 火 / 连锁还在跑:原版死亡 = 新一局,世界整个重生成,没有"接着上一局地形"。改:回出生点保留身上东西(法杖 / 特权 / 金),
      但清本种子的地形存档(IndexedDB)+ 圣山崩塌 / 守卫状态,整页重载 → 模拟 / 实体 / 弹丸从零起。
    - 心和金块"连成一起":`heart.xml` 是 SimplePhysics + SpriteComponent(`heart_extrahp.xml` 4 帧 20×20 一排),没形状图 → 我们把整张 4 帧的表当刚体,地上躺"四颗心一排";
      金块是 `gold_box2d` 材质的 Box2D 刚体,原版互相碰撞堆成小堆,我们刚体不互撞 → 一箱全叠一个点。改:`_spriteFrames` 切第一帧当形状、按帧播、不打滚(`fixedRot`);物品之间挤开(minGap 4.4px)。
      捡心:heart.lua `max_hp += 1×HEARTS_MORE_EXTRA_HP`(封 max_hp_cap)+ `heart_effect.xml`(spark_red 从中心往外描一颗心)→ 加了 `heartBurst` + 提示。
13. **分裂弹(SPITTER)对表**:`deck/spitter.xml` 全部字段和 projectiles.json 一致 —— 速度 400~600 / 重力 200 / 空气阻力 2.7 / 寿命 25±7 帧 / 伤害 0.3 / bounce_always 10 次 ×0.5 /
    死亡 r2 爆炸不挖洞(hole_enabled=0,只有 0~2 颗材质火花 + stains 3)/ 贴图 `projectiles_gfx/spitter.png` 7 帧 12×12 由亮到暗**缩成一点、播一遍不循环**(loop=0,0.35s ≈ 寿命)/
    additive+emissive / 粉色枪口 muzzle_small_pink 1~5 / LightComponent r60 (80,10,40) / 弹墙 bounce_effects/spitter.xml 7~15 粒 plasma_fading_pink。
    改了一处通用的:`velocity_sets_scale` 之前按 0.4 + 速度/450 拉长(分裂弹被拉成 1.5 倍的椭圆条),组件文档原话是 "sprite width is made equal to the distance traveled since last frame",
    且 rocket(85px/s)也开着这个而原版火箭没被压成点 → 只拉长不压扁:scaleX = max(1, 每帧位移 × coeff / 帧宽)。分裂弹 7~10px < 12px → 原大小;狙击弹 26px/4px → 6.5 倍长线。
    探针 `_noita-spitter-shot.mjs`:0.35s 死、7 帧播完、朝下打弹 1 次不挖洞。
14. **怪掉金 / HUD 状态区 / 头顶导航(09-05)**:
    - 怪死掉金:`drop_money.lua` money = 10 × max(1, floor(max_hp)),先最多 5 个 10 面值,再 1000/200/50/10 —— 我们一直是这么做的(slimeshooter_weak hp0.3 → 1 个 10);"看不出是什么"是因为缺了 goldnugget_*.xml 的
      `SpriteParticleEmitter shine_08`(每 50~250 帧在 ±3px 闪一颗 5×5 星),原版一眼认出金子靠这个闪。补了:金块闲置闪光 + 捡起时 `gold_pickup.lua` 的火花(gold_pickup(_large/_huge).xml:6 帧 shine_08 朝 ±50 飞出并减速 + 一颗 shine_06 大闪 0.56s)。
      `spawnItem('goldnugget_N')` 之前没带 gold 值,探针撒的金块捡不到钱,顺手修了。
    - 头顶导航箭头 + "传送门 1149" 文字去掉(原版头顶什么都没有);屏边小箭头和顶部横幅保留,距离数字进横幅。
    - 状态区按原版放 HUD 血条 / 悬浮条下面(release notes:"Fire status duration displayed in the status area" / "Stain status amount is displayed next to icon"):
      每行 12×12 图标 + 剩余量条 + 数字(着火 = 剩余秒,沾污 = %,药效 = 剩余秒),文字行里的 [湿] [着火] 撤掉。头顶只留图标(09-05 用户指出头顶图标下面还画着一条量条,原版没有 → 去掉,`drawStatusIcons` 只画图)。
    - 主角身上怎么体现:SpriteStainsComponent 染的是精灵像素本身,`fade_stains_towards_srite_top=1` 越靠头顶越淡 → 染色改成脚重头轻的渐变,量越大越深;着火照旧从身体往外冒火格 + 火星(fire_how_much_fire_generates=4/帧)。
15. **怪卡石头里 / 灯笼(09-05)**:
    - 怪卡在石头里:原版怪只在生成点的空气里出现,不存在长在岩石里的怪;我们地形和原版有出入 / 布景后盖 / 塌方,`_settle` 只往上找 24px、`_unstick` 只在 ±3px 找,找不到就原地冻住 —— 就是截图那只。
      改:生成时往上 24px 再一圈圈找 ≤32px,都实心就不出这只;活着时埋进石头 >1s 每秒往外找 ±12px,3s 还在石头里就撤掉(沙埋不算,只看中心格是 static)。
    - 灯笼(`props/physics_lantern(_small).xml`):glass_box2d 刚体 + `PhysicsJoint nail_to_wall`(大:pos_y=-2 钉在图顶上方的墙里;小:breakable)+ 5/4 格油(`leak_on_damage_percent 0.999`)+ hp 0.9/0.15 +
      `script_physics_body_modified=physics_lantern_damaged.lua`(像素一被打掉就 EntityLoad(misc/fire.xml) → **起火**)+ `ExplodeOnDamage`(死了炸 r12/r5、坑里 10%/50% 生火、洒油)+
      `PhysicsBodyCollisionDamage speed_threshold=120`(掉下来砸地就碎)。原版流程 = 打中 → 像素缺 → 起火 + 漏油 → 油烧;打够 / 掉下砸地 → 碎 → 炸 + 洒 5 格油烧一片。
      我们缺的:① 弹丸打刚体不抠像素(现在命中点抠 1.5px,才触发 physics_body_modified);② `leak_on_damage_percent` 之前当"伤害占比阈值"用,文档原话是"might leak when projectile damage happens" = 漏的概率;
      ③ 缺 physics_lantern_damaged 起火;④ 缺 PhysicsBodyCollisionDamage(抽进 entities.json:speed_threshold / damage_multiplier 1/60);⑤ 钉子 / 链子挂着的像素被打掉关节要断(`hasPixelNear`);
      ⑥ **矿里的灯笼从来没出现过**:带皮肤图(火苗)的道具只请求了形状图,pendingProps 永远等不到皮肤图。探针 `_noita-lantern-shot.mjs`:大灯笼第 1 发起火 + 缺像素、第 4 发漏油、第 8 发碎(0.9/0.12)炸 + 5 格油;没顶的直接掉下来砸碎。
    - **09-05 用户再报"灯笼无法击落"**:上面只修了生成表里的 physics_lantern_small;墙上到处挂的那些是 wang `spawn_lamp` 掷出来的(coalmine.lua g_lamp = `props/physics/lantern_small.xml`),
      我们一直只在 `collectLights` 里当"光源"由 noitaPlay 手画一个 5×6 的小方块 + 光圈,根本不是实体,子弹穿过去。改:LAMP 表按群系记 `ent`(coalmine/excavationsite → lantern_small,snowcave/sandcave/meat → physics_lantern_small,liquidcave → physics_lantern;
      圣山 temple_lantern / 蜡烛 / 火把没 ent 仍只画光),`Entities.spawnChunk` 第一次就位时按标记点(+ PhysicsBody2 `root_offset` 5,7 = 图心)放成刚体,noitaPlay 不再画带 ent 的灯。
      `props/physics/lantern_small.xml` 是新格式:`PhysicsBody2Component` + `PhysicsJoint2Component type=REVOLUTE_JOINT_ATTACH_TO_NEARBY_SURFACE offset 4.75,3.5 break_force 0.5 break_on_body_modified=1` —— prepare 抽成 `d.joint {attach, breakForce, breakOnModified}`,
      `_attachRopes` 从挂钩点(图顶中)12px 内找最近实心格钉上去、挂钩到墙的距离当链长(12px 内没墙就掉,原版一样),拽 8px 断,**任何像素被打掉关节就断**(灯 hp 0.15,火花弹 0.12 → 第一发起火漏油、掉下来 / 第二发碎)。
      火苗 `lantern_small_flame.xml` 19 帧 z_index −1:Noita 的 z 越小越靠前,火苗画在玻璃壳**前面**(之前把整张 171×13 的帧表当皮直接画了)→ RigidBody `over` 叠帧,睡着也走帧。
      探针 `_noita-lamp-shot.mjs`:传送到煤矿 (300,400),lights 表 56 个带 ent 的标记 → 54 只 lantern_small 刚体、53 只挂着(链长 2~5px、锚点是实心);正下方朝上打:第 2 发抠像素 + 起火 + 碎,洒 4 格油。
    - **随之而来的 20fps(用户 09-05)**:`_noita-prof-shot.mjs`(给各子系统 update/render 包计时,`deep` 连 Entities 内部方法一起包)—— 矿里 `entities.update` 15.9ms/帧,全在 `_solidC` → `bodySolidAt`:
      怪的碰撞查询一帧问 7000 次"这格有没有醒着的刚体",而 `bodySolidAt` 线性扫全部刚体(140 个:50 多盏灯笼 + 尸块 + 道具)做 contains → 一帧上百万次。
      改:`_rebuildBodyGrid` 每帧 `_updateBodies` 后把醒着的刚体按 32px 格子建哈希,`bodySolidAt` 只查一格(0~2 个)→ 0.87ms/帧。顺带:挂着的灯笼永远在摆、永远醒着(27/53)——
      `RigidBody.step` 给挂着的(hanging)加关节摩擦(每秒 ×0.15 / 角 ×0.1);钉在侧墙上的身子埝在墙里,每帧被地形顶出又被链拉回永远抖 → `_attachRopes` 先把灯挂直到锚点正下方、还重叠就横挪 ≤6px。之后醒着的灯 3/54。
    - **"灯笼掉下来又左右晃,原版是直接点着了"(用户 09-05)**:`misc/fire.xml` 不是几格火,是 `ElectricityComponent hack_is_set_fire=1` 一帧的"点火电流",在周围乱窜一段把碰到的可燃物都点了;
      我们原来 `_fireAt` 放 3 格火,火在空气里 8~18 帧就灭,油是随后几帧才从伤口漏出来、又跟着灯往下掉,根本没碰上火。改:被打中的灯笼 `fireT 2.5s` 当移动火源(每帧往边缘像素旁放 3 格火),
      漏出来的 4 格油 3 格在烧;顺带按 materials.xml `solid_gravity_scale`(glass_box2d 1.3)给刚体重力倍率 —— 灯掉得更快,≥25px 的落差砸地就过 120 阈值碎掉(和原版一样矮处掉下来不碎,倒在地上、身边一圈火)。
      "左右晃"是 9×13 的灯头轻底窄落地翻倒的过程(~0.6s 倒成横躺后就停),不是永远晃。
16. **金块颜色 / 刚体摇晃 / 怪穿墙 / 圣山崩塌 / 捡心效果(09-05 第三批)**:
    - 金块是绿红黄的:`items_gfx/goldnugget_*.png` 不是颜色图,`gold_box2d` 的父材质 gem_box2d `Graphics normal_mapped="1"` —— png 是**法线图**,显示 = 材质 color(ffc74e 金)按法线打光。
      materials.json 抽 `normalMapped`,RigidBody `_canvas` 对这类按法线(左上来光)给材质色明暗;碎屑也用材质色。宝石 / 药瓶玻璃同一套。头顶状态图标改原图 12×12 不缩放(缩到 8 就糊)。
    - 板凳 / 崩塌石块左右摇:两条腿轮流点接触给扭矩;加"坐实"规则(慢速贴地角速度再耗、离 0/90° 不到 4° 直接摆正)。顺带发现桌子会**穿地**:法线用"接触质心→刚体中心",
      桌面一排像素多、桌腿少,接触质心天然偏上 → 算出朝下的法线一路推穿。改成"接触质心→边缘像素质心",全埋(≥6 成边缘在实心里)当从上掉进去往上顶;顶出后再回收 0.25px,
      不然悬半像素掉回来再顶、vy 每个来回 ±20 永远睡不着。探针 `_noita-body-shot.mjs`:桌子 / 崩塌块落平台 3s 内入睡 rot=0。
    - 怪穿墙:三处"只查终点"的挪位 —— 走路怪爬台阶 `e.y -= c`(c ≤ climb)、飞行怪贴坡上下滑 ≤4px、爬墙怪跨小坎 ≤4px / 拐角 ≤3px,中间一段不查 → 隔着 1~2px 的板子就"抬"到另一面;
      爬墙怪还是 2px 一步。全部改成一路查 + 1px 一步。
    - 圣山崩塌按 `loose_chunks_workshop.xml` 重做:LooseGroundComponent **每帧** probability 0.25 绕上方向 ±2.1 rad 射 ≤180px,打到的地面 3~8px 一团松脱成**同材质飞行像素**(真粒子,落地堆成砖色渣);
      chunk_probability 0.15 只打顶(±0.7),按 `procedural_gfx/collapse_big/0~14.png` 形状抠一块 **concrete_collapsed**(灰混凝土,不是砖色)刚体;LifetimeComponent 320±50 帧。
      concrete_collapsed 材质:`solid_on_collision_explode=1`(砸地按 ExplosionConfig 炸:concrete_sand 火花 + 震镜)、`solid_on_sleep_convert=1 → concrete_static`(睡着化成静态混凝土,刚体撤掉)。
      之前是 44 块砖色不规则圆团、没有像素雨、不炸不化 —— 效果不对就在这。
    - 捡心 / 法术刷新的效果:heart.lua `GamePrintImportant("$log_heart", "你的最大生命现在是 N")` → 屏幕中上方大字 + 说明 3.5s;血条闪白(max_hp_old / mLastMaxHpChangeFrame);
      heart_effect 心形火花;圣山满血心同一套。法术刷新:shine 火花 + 大字 + 法力条闪白。
17. **树挡路 / 怪"挂"在树上 / 尸块晃(09-05 第四批)**:
    - materials.xml 的 `platform_type` 才是"角色碰不碰这格":0 = 穿过去 —— grass / moss / plant_material / mushroom / **wood_loose(树)** / fungus_loose / rock_loose / **meat(尸块)** / item_box2d / wood_prop_noplayerhit;
      1 = 站得住 —— rock_static / sand_static / wood / steel / brick / concrete_static / concrete_collapsed / wood_prop…;2 = templebrick_box2d;没写 = 1。原版人和怪都穿树走、踩不到尸块,子弹照样打得中树。
      之前一版按 `solid_static_type` 判是错的:wood / steel / brick / meteorite 这些 cell_type=solid 的真地形 sst≠1 但 pt=1,会被当成可穿。人(`solidAt`)和怪(`_solid`)都改按 platformType;
      刚体(原版 Box2D)另给 `_solidB`:platform_type 只管角色,箱子 / 尸块照样落在树上、堆在尸块上(不然尸块堆互相"穿"着一直醒来掉)。"怪被藤蔓挂住"其实是站在树的实心像素上,同一处修。
    - 尸块碎了以后一直晃:碎肉 3~10 像素的小块惯量极小,点接触的扭矩冲量甩到 20+ rad/s 乱转、转着钻进地里。改:n<12 的小块一律按面接触(不给扭矩)、法线按来向;
      角速度封顶 12 rad/s(box2d 默认量级)。探针 `_noita-body-shot.mjs`:僵尸 12 块尸块 3s 后 10 块睡着(之前 3 块)。
18. 没反完的:DamageModelSystem(电水接触伤害每帧多少、火伤 0.2 / 坠落 0.1~1.2 常量在 0xbc6980)、LooseGroundSystem 细节(144 条,和文档描述一致就没细读)、PhysicsThrowable。
19. **怪物死亡 / 尸体(用户 09-05:"原版怪死了基本是一整具尸体倒下,不是很多碎块")—— 反 `DamageModelSystem::KillMe`(0xbcdef0)+ `PhysicsRagdollSystem::LoadRagdoll`(0xd0fe90)+ `LoadCachedRagdollImpl`(0xd0f120)**:
    - **ragdoll png 与关节**:`filenames.txt` 列的每张 png 都是**整帧尺寸**(僵尸 18×19 = 精灵帧),各部件在帧内各占自己的位置,叠起来就是整个身体。LoadCachedRagdoll 对每一对图片做 FindOverlap(0xd0ee50:两张都有像素的格子),
      **每个重叠像素 = 一个关节**(`{i, j, x, y}`,LoadRagdoll 里 0x76ad40 建 box2d 关节)。僵尸 12 块 11 个关节(上躯干~下躯干 / 头 / 左右臂,下躯干~左右腿 / 尾,腿~脚,臂~手,各 1 像素),矿工 10 块 9 个,狼 11 块 10 个 —— 一具骨架。
      每具掷一次 `rand < 0.75` 选关节类型 0x2b68(很硬,`PHYSICS_RAGDOLL_VERY_STIFF_JOINT_STIFFNESS` xml 2 / exe 5)否则 0x2b67(`PHYSICS_RAGDOLL_JOINT_STIFFNESS` 0.05);`PHYSICS_RAGDOLL_JOINT_MIN_BREAK_FORCE` 200 / `MAX_FORCE_MULTIPLIER` 400(exe 默认)。
      整帧居中放在 实体位置 + `ragdoll_offset`(x 随朝向翻转,`scale_x` = 朝向 → 朝左整帧镜像);初速 = 自身速度 × `RAGDOLL_OWN_VELOCITY_IMPULSE_MULTIPLIER`(xml 3)+ 伤害冲量,每块 ×(1 ± `RAGDOLL_IMPULSE_RANDOMNESS` 0.04),最大块 x 再 ±2。
    - **RAGDOLL_FX 枚举(exe 字符串表 0xd7f040)**:0 NONE 1 NORMAL 2 BLOOD_EXPLOSION 3 BLOOD_SPRAY 4 FROZEN 5 CONVERT_TO_MATERIAL 6 CUSTOM_RAGDOLL_ENTITY 7 DISINTEGRATED 8 NO_RAGDOLL_FILE 9 PLAYER_RAGDOLL_CAMERA
      (lua 里 `c.ragdoll_fx` 同序:火箭 / 核弹 / 高爆 = 2,GORE 卡 = 3)。KillMe 的决定顺序:伤害带的 fx(弹丸 `ragdoll_fx_on_collision`:激光 / 狙击弹 / 挖掘弹 / 链锯 BLOOD_SPRAY,霰弹 / 锯片 / 胶弹 BLOOD_EXPLOSION,其余 NORMAL)
      → children GameEffect 的 `ragdoll_effect` 取最大并顶掉 ragdoll_material(effect_frozen FROZEN + ice_glass_b2;effect_disintegrated DISINTEGRATED + soil;effect_electricity CUSTOM + physics_ragdoll_part_electrified)
      → `create_ragdoll=0` 或 `ragdoll_filenames_file` 为空 → 8 → NORMAL 且伤害类型含 PROJECTILE|EXPLOSION(位 2|4)时 `DAMAGE_BLOOD_SPRAY_CHANCE`(exe 20)% 变 BLOOD_SPRAY → `ragdoll_fx_forced` 覆盖(37 种幽灵 / 幻影 / 雕像 / 骷髅虫 = DISINTEGRATED)→ 玩家 0/1 变 9。
      switch 表:0/1 → LoadRagdoll(**joints=1**);2/3/6/9 → LoadRagdoll(joints = fx≠2,即**只有 BLOOD_EXPLOSION 不建关节散开**),再给每块挂血喷发射器(2/3)/ 自定义实体(6);4/5/7/8 → 不用 ragdoll 文件:
      FROZEN / CONVERT / NO_RAGDOLL_FILE = **整张当前精灵帧变一块刚体**(0xbd0480:材质 = 效果的 ragdoll_material,冻住时精灵调色 (0,0.5,1),角速度 Random(−4,4));DISINTEGRATED = 每个精灵像素变一粒该材质真粒子(0xbc5a10:两轴 Random(−100,100),带像素自己的颜色)。
      火烧死(伤害类型 FIRE 或身上有着火效果):ragdoll 每 `RAGDOLL_FIRE_DEATH_IGNITE_EVERY_N_PIXEL`(xml 5)个像素点一格火 → 尸体烧成灰(meat fire_hp 600 无转化 → 烧没)。
      BLOOD_EXPLOSION 每块角速度 ±`RAGDOLL_FX_EXPLOSION_ROTATION`(xml 0.5);血喷:每块挂 ParticleEmitter,总量 = (`ragdoll_blood_amount_absolute` > −1 ? 按质量分摊 : 质量 × 1000)× `RAGDOLL_BLOOD_MULTIPLIER` 2 × rand(0.8~1.2),方向 = 伤害方向 ×(0.85~1.15),每 1~2 帧 1~3 粒,材质 `blood_spray_material`(没有就 blood_material),放 `audio_blood_spray_sound`。
      受伤时的血(DamageModelSystem 0xbcd3f0):Random(`DAMAGE_BLOOD_AMOUNT_MIN` 20, MAX 40) × `blood_multiplier` 粒 blood_material,沿伤害方向 ±0.6 rad,速度 ×(0.5~1.25)。死亡脚本只有 drop_money(第 14 条已做);分裂 / 变蛋是各怪自己的 LuaComponent(没在我们出生区的表里)。
    - **改法**:新增 `Ragdoll.js`(部件刚体 + 关节表):`_buildRagdoll` 每张 png 镜像 → 裁包围盒 → RigidBody(材质 ragdoll_material),重叠像素 → pin 关节(锚点 = 各自图心局部坐标);每帧所有部件 step 完做 3 轮顺序冲量
      (2×2 有效质量矩阵消掉锚点相对速度 + 位置按逆质量分摊拉回,每轮 ≤3px;转角刚度按 75%/25% 掷 0.12 / 0.03 把相对转角拉回初始姿势 —— 尸体大体保持精灵姿势整具倒下、四肢软一点);
      整组一起睡(相连块 0.5s 内位移 <1.5px + 任一块有支撑)/ 一起醒;着地时按地面摩擦一起耗 vx / w(box2d 里是接触 + 关节摩擦干的活,不然关节把重力速度在块之间倒来倒去整具会蠕动);
      断裂 = 一帧拉开 16px 或连续 4 帧合不拢 8px、或锚点像素被打掉 / 烧掉;散开的块(BLOOD_EXPLOSION / 断了)各自睡。刚生成先整具上移到没有像素埋在实心里(整帧居中 y−6 时脚在地里,我们的刚体埋住会一帧顶 24px 把关节撕开),部件 `softPush`。
      小块(<12 像素)的接触法线改看四周实心分布(原来按速度反方向,被拽着在地上滑时法线水平、一路往回顶把关节撕开)。BLOOD_EXPLOSION 原版散开靠 box2d 块互撞,我们刚体不互撞,补每块离心 30~80 px/s。
      `hurt()` 加 `opts {ragdollFx, effects}`:弹丸 `p.d.ragdollFx`(prepare 抽 `ragdoll_fx_on_collision`)/ 卡 `c.ragdoll_fx`(Wands C_FIELDS 放行,`_applyC` → `p.ragdollFx`,爆炸经 `_exFx` 传到 hooks.explosion 第 8 参)/ 命中给的 frozen(`e.frozenT` 120 帧)/ disintegrated。
      探针 `_noita-ragdoll-shot.mjs`:NORMAL 僵尸 12 块 11 关节 0 断、落地关节误差 <0.5px、整具包围盒 ≈11×5px、3s 内 12 块全睡成 ~60 格 meat;朝左镜像同;BLOOD_EXPLOSION 0 关节散 30~60px + 喷血;BLOOD_SPRAY 矿工 10 块连着喷血;FROZEN 一块 72 像素 ice_glass_b2;
      DISINTEGRATED 0 块 ~50 粒尘;火烧死 3s 内 20+ 格火、尸体烧没;弹丸打死 30 只 ≈ 20% BLOOD_SPRAY。`ragdoll-*.png` 8 倍放大截图。

20. **喷气尾气 / 水中折射(用户 09-05:"飞的时候脚下那一坨像火箭的效果"、"子弹射进水里有折射")**:
    - 喷气:`player_base.xml` 引 `base_jetpack_nosound.xml` 的 ParticleEmitter(`_tags=jetpack`):材质 **rocket_particles**(66FFFFFE = 40% 透明的白,liquid 材质只是借它的颜色),offset (−1,−4) 被 player_base 覆盖成 (−2,5),
      x_pos ±1、x_vel ±7、y_vel 80~180 向下、count 3~7、lifetime 0.1~0.2(player_base 把 min 覆盖成 0)、每 0~1 帧一次、cosmetic 粒子 + collide_with_grid(撞地就没)、不按寿命淡。
      同文件还有 `jetpack_smoke` 的 SpriteParticleEmitter 但 `is_emitting=0`(`PLAYER_USE_NEW_JETPACK=0`)。所以原版是一股向下的白色"火箭尾气",不是我们之前的橙色火星 + 脚下 2×2 橙块 —— 已换成原参数(`sparks` 带 `noFade` / `grid`)。
    - 折射:`post_final.frag ENABLE_REFRACTION`:液体格(extra_data.a ≥ 0.99)的采样坐标偏 `dx = sin(time×10 + (u + cam.x/VW)×50)×0.002`、`dy = cos(time×10 + (v − cam.y/VH)×50)×0.002`(采样到的那格也得是液体),
      即世界 x 的函数 → 幅 0.85px、波长 ≈ 53px;y 同理幅 0.48px。整张前景(世界像素 + 精灵)都按这个坐标采样,所以泡在水里的弹丸 / 人 / 怪跟水一起晃。
      之前我们只晃液体像素、且相位轴写反了(x 偏移是行的函数)。改:`wobX[列] / wobY[行]` 按原式算(y 幅 0.48 在 1:1 画布上按 |cos|>0.5 量化成 ±1),`liquidWobble(wx,wy)` 给弹丸(`hooks.wobble`)/ 玩家 / 怪的绘制位置加同样的偏移。
    - **用户:折射还是看不出来** —— 0.85px 的偏移原版是在**屏幕分辨率**下亚像素采样(tex_coord 是屏幕 uv,tex_fg 用 nearest 采样):翻转边界在屏幕像素之间平滑移动,2~4.5 倍缩放下看着就是水里的东西在晃;
      我们世界分辨率的 canvas 上四舍五入只剩 0/±1 的抖。改:`render/Refraction.js` —— 放大到屏幕那一步改用 WebGL(输入 = 乘完光照的世界画面 + VW×VH 液体掩码 `liqMask`,fragment 就是 post_final.frag 那几行原式),
      有 WebGL 时世界分辨率上的整像素偏移全关掉(`liquidWobble` 返 null),没 WebGL 退回原来那套。软件 GL(swiftshader)下 56fps。
    - **入水**(用户:"原版子弹入水没有多余粒子,水面会鼓动"):反 exe `VelocitySystem::Update`(0xd67458,`VelocityComponent.displace_liquid` 默认 1):实体这一帧所在格变了 → 看位置周围 **3×3** 格,
      液体格计入 `mLatestLiquidHitCount`(liquid_drag 乘它),并以 `rand%100 < 75` 的概率把那格抛成飞行粒子,速度 = **−(mVelocity × 0.1) 再转 Random(−0.3, 0.3) rad** —— 水沿弹的来向以一成弹速被顶回去,水面就这么鼓起来,没有别的溅射。
      我们之前入水那一下随机掀 3~16 粒 40~190 px/s 的水珠(自创)。改:`_displaceLiquid` 每帧一次(原版按帧末位置,不是每个子步)照上式;液体阻力乘液体格数。验证:火花弹 (749,177) 入水,水粒子 (−69,−29)(−76,−3)…= −0.1v±0.3rad,每帧 ≈7 粒;速度 769→500→395→238 几帧就慢下来。
      **用户仍看到水花**:剩下的一处是弹死时的爆炸 —— IMPL_DoExplosion 0x687d7a 对坑里的液体(hole_destroy_liquid=0)`CreateParticle` 速度 = 格子相对爆心的偏移 × 0.1 × (1 + Random(−0.35, 0.35)) px/帧:
      火花弹 r2 的坑只把水挪 ~12 px/s(基本看不出),炸弹 r60 边上才有 ~360 px/s 的大浪;我们之前不管半径一律 60~180 px/s 往上喷。改成原式后火花弹在水里死:13 粒、最快 43 px/s(含入水顶回去的)。

21. **毒液不是亮绿的(用户 09-05:原版截图里 radioactive_liquid 亮黄绿带光晕,我们是暗橄榄色)**:materials.xml `radioactive_liquid` Graphics color `44B4FF10`(alpha 只有 27%)+ `gfx_glow=60`。
    原版靠 glow:`post_final.frag` 把 glow 贴图(材质色 × gfx_glow/255,低分辨率 + 模糊 = 光晕)`lights += glow`(发光格不被黑暗压暗)再 `color = max(color + glow×0.6 − 0.6×lights, color + glow − color×sky×glow)` screen 叠上去,
    黑暗里毒液 ≈ 72% 的本色 = (130,184,12)。我们之前只按 27% alpha 混色 + 每 5 格一个 0.08 alpha 的小光 → (24,32,4)。改:发光材质 alpha += gfx_glow(毒液 68+60 = 50%),光源表上限 400 → 1600、每点 alpha 0.3 + 0.35×gl(火 0.65 / 熔岩 0.5 / 毒液 0.38)。
    探针 `_noita-glow-shot.mjs`:黑处并排毒液池 / 水池,毒液均色 (24,32,4) → (55,78,5),水不变 (18,30,25);满屏毒液(2.6 万格、光源表打满 1600)56fps。

22. **水 + 毒液同时在头顶(用户 09-05:原版能同时显示两个沾污图标)**:`StatusEffectDataComponent.stain_effects` 是 VECTOR_FLOAT —— **每种状态各一个量**;`SpriteStainsComponent` 里精灵每个像素只存一种液体材质,
    某状态的量 = 被给这种状态的液体(materials.xml `<Stains><StatusEffect type=…>`,blood 是旧写法 `status_effects="BLOODY"`)染色的像素占比;新液体盖像素时旧的按比例被顶掉,总和 ≤ 100%。
    材质字段:`liquid_sprite_stains_status_threshold`(oil / radioactive_liquid / 瞬移液 0.2:占比不到 20% 状态不生效,水 / 血 / 黏液 0)、`liquid_sprite_stain_shaken_drop_chance`(瞬移液 5,其余 1)、`liquid_sprite_stain_ignited_drop_chance`(只有水写了 10)。
    之前我们只有一个 `player.wet / stain / wetMat`(换液体就把旧的砍到 2 成)。改:`player.stains = [{mat, kind, amt}]`,`addStain` 按像素覆盖语义(新增 f → 其它各扣 f 比例),每种各自晃掉 × shaken_drop,
    `stainActive(kind)` 按材质阈值;防火 / 沾油易燃 / 辐射掉血 / 黏液减速 / 精灵染色(几种一层层叠)/ HUD 与头顶图标全部按"生效中的每一种";三个字段抽进 materials.json。
    旧接口 `player.wet`(总量)/ `stain`(量最大的)/ `wetMat` 留成 getter 给探针。验证:泡满水 WET 100% → 走进毒液 150ms:WET 54% + RADIOACTIVE 46% 两个图标同亮,650ms 后 6% / 94%;湿身碰火探针数值不变。

23. **09-05 第六批(用户:灯笼打掉后浮空 / 石块无外力左右晃 / 人跳进水没有水花)**:
    - 灯笼浮空:睡着的刚体格子被爆炸坑挖掉(或别的原因没了)→ `wake()` 清点出全部像素都丢了 → 一个 alive=0 的空刚体还挂着光、还有碰撞在飘。`_updateBodies` 开头:`alive ≤ 0` 或缺损 >60%(非物品)→ `_destroyBody`(灯笼 = 炸 + 洒油)。
      顺带两处补全:① 弹丸命中刚体抠像素用**真正打中的点**(`p.hitX/hitY`,之前用子步前的 p.x 差 1~2px 经常抠不到 → 没起火、`break_on_body_modified` 不断);② 爆炸也挖刚体像素(`carve(x,y,r,reach2)`,原版坑里的 box2d 格一样被摧毁),睡着的刚体醒来清点出的缺损也算这次伤。
    - 石块无外力晃:崎岖地面上石头搁在两个小凸起上,接触跨度 < 短边 60% 就当"点接触"给扭矩,两个支点轮流当支点 → 永远摇。加"静定"判定:接触跨度 ≥2px 且刚体中心投影落在两端之间(重心在支点之间)→ 面接触不给扭矩、慢速时 w×0.5。
      8 块石头落真实地形 4s 内全部入睡(之前 6 块里 4 块 2~4s 还在 0.2~3.4 rad 地晃)。
      **板凳 / 桌子还晃**(用户又报):逐子步日志看出桌子根本没在接触,是悬在坡上方 1~2px、每帧被抬 1px 又落回 —— `_updateBodies` 里"埋进实心太深就往上顶"的检查测的是**包围盒中心那一格**,
      桌凳的中心是两腿之间的空当,搁在斜坡上那格是地面 → 每帧顶 1px。改成只在中心真有自己像素时才查;接触法线也改用接触点附近 5×5 地形梯度(平底一角搭坡上时"质心→质心"法线是斜的,冲量消不掉下落);
      慢速时把"差 1~2px 就着地"的边缘像素也算支点做静定判定(一条腿在地一条腿悬着的板凳不再来回倒)。桌 ×3 / 凳 ×4 / 床 / 石 ×4 落真实地形 4s 内全部入睡、零晃动;平台探针 / 尸体探针不变。
    - 人入水:player_base 的 VelocityComponent 一样带 `displace_liquid`(+ LiquidDisplacerComponent radius 1 / velocity 30 把身体挤到的格挪开),按 VelocitySystem 的规则:换格时 3×3 液体格 75% 以 −0.1×自身速度 ±0.3rad 顶回去,
      几十 px/s 的小鼓包;之前按落速掀 8~45 粒 40~230 px/s 的水珠(自创)—— 水探针入水 debris 59 → 0。
24. **光明穿凿(LUMINOUS_DRILL,用户 09-05:"背包法术卡第 11 个效果不对")—— 反 `ProjectileSystem` 穿地函数 0xd32970(断言串 `max_energy != 0`)**:
    `deck/luminous_drill.xml`:speed 1400 / lifetime 2 帧 / damage 0.4 / `ground_penetration_coeff=4` / `ground_penetration_max_durability_to_destroy=14` / mass 1.65 / 4 个 spark_green 拖尾发射器(两个 0.02s 短命 + 两个 0.15~0.32s `draw_as_long`)。
    穿地**不是走固定距离**(之前 coeff×8 px 直接滑进地里、什么也不挖),而是和爆炸射线一样的能量账:格是实心/液体且 |v| > 10 → `max_durability > 0` 时耐久更高的格挡住 →
    `E = coeff × ½|v|²`(文档说还乘 mass,取 coeff×mass),`take = min(格 hp, E)`,格 hp −= take,`v ×= (1 − take/E)`;格 hp 归零就把格删掉继续钻,没吃完就停在这格(on_collision_die 死)。
    所以钻头是挖一条 1px 隧道:岩石(hp 1e5)一格掉 1.5~3% 速度,一发钻 ~29px;神殿砖(hp 1e6,耐久 14 刚好 ≤14)一格掉 15%,一发 3~4 格;长枪(coeff 6 / 400px/s / mass 0.65)扎岩石 2~3 格就停。
    顺带两处:① 穿地弹子步改 1px(2px 步会隔格挖);② `terminal_velocity` 夹速(0xd67cf7,`|v| > t → v̂·t`)在**位置积分之后**,1400 的初速第一帧仍跑满 23px,第二帧才夹到 1000 —— 之前先夹后走少跑一帧。
    探针 `_noita-drill-shot.mjs`:岩墙 depth 29 / 神殿砖 4 / 长枪 3 / 连发 12 发穿 47px。
    **楔形隧道**(用户截图:连发挖出靠人这头宽、光标那头尖的黑楔子):gun.lua → `GameShootProjectile(shooter, x, y, target_x, target_y)`,x,y 是杖的 shoot_pos 热点、target 是光标 →
    每发方向 = **杖尖→光标**,所有弹汇聚在光标那一点,杖尖随手臂 / 走路晃就在近端散开。我们 `fire()` 之前用"身体中心→光标"算角度、只是从杖尖出生 → 平行的 1~2px 细线;改成杖尖→光标(光标贴着杖尖 4px 内退回身体算)。
25. **手机背包滑不动(用户 09-05)**:`#editor` 只拦了 touchstart 的冒泡,touchmove 还是冒到 window 那个 `preventDefault` 的处理器 → 浏览器不滚。
    `#editor` 再拦 touchmove / touchend(passive)+ CSS `touch-action: pan-y`。CDP 真实触摸拖 180px:旧版 scrollTop 0 → 新版 165。
26. **矿洞"大蜘蛛"= Äitinuljaska(`animals/giantshooter_weak`,用户 09-05:"第一关 boss…我看有个大蜘蛛")**:矿洞 g_big_enemies 8% / g_unique_enemy 10%,不是 boss 但是矿洞最大的怪。
    原版 xml:base_enemy_flying(飘着追人,不放弹 attack_ranged_enabled=0,只有 base_humanoid 的 0.2~0.4 近战碰)· hp 2(显示 50)· 绿光 r80 (118,255,118) · 5 条 verlet 黏液触手子实体 ·
    MaterialInventory 400 酸 leak_on_damage 99.9% · ExplodeOnDamage 死亡必炸(r30 伤 3、坑里 70% 填酸、ray_energy 160000)· `giantshooter_death.lua`:hp 从 ≥0.3 被打到 <0.3 那一下 → ±10px 出 3 只 **slimeshooter**(非 weak),速度 x −90~90 / y −150~25 · 布娃娃 torso + 12 段触手图。
    我们之前只有一个会飘的绿团:没触手、不漏酸、不分裂、死了不炸、不发光。补:
    - prepare:`<Entity><Base file="verlet_chains/…tentacle…"><InheritTransform position>` → `d.tentacles[{x,y,points,rest,stiff,damp,massMin,massMax,pieces[{img,oy}]}]`(slimeshooter / acidshooter / tentacler 也顺带有了);`script_damage_received=giantshooter_death` → `d.splitBelow`。
    - Entities:`e.tents` verlet 链(`_tentaclesStep`:点 0 钉挂点、v=(p−prev)×0.8、重力 400×mass、一点风摆、链约束 2 轮、进实心退回;`_drawTentacles` 在身体后面画 2×2 小片);
      `e.inventory` + hurt 里弹丸命中按 leak 概率 `_leak` 6~14 格;`splitBelow` 分裂;`_die` 里 `d.explode` → `explodeConfig`(坦克 / 炮塔 / 无人机同样死亡爆炸);`lights()` 从"只有 lukki"改成所有带 LightComponent 的怪(玩家一屏内:矿工头灯 r50、火法师 r100…)。
    - 没反出来的:verlet 的重力常数(exe 0xd67de0 只看到风的 sin 叠加:sin(t×25)、sin(y×5)×100、sin(y×0.005)×300…),用 VelocityComponent 默认 400 代替。
    探针 `_noita-giantshooter-shot.mjs`:触手 5 条长 4.5~15.8px 垂下;打到 0.2 → 身边 3 只 slimeshooter、漏酸 22 格 / 库存 400→388;死亡酸 1250 格、布娃娃 1 具、掉金 20。
27. **按 noita-design.html 逐模块对表(用户 09-05:"按模块全部反了和我们的做对比,主要是细节,地图系统还是不够好")—— 第一批:光照 / 雾 / 天光(第 11 模块),这是画面"不像"的最大一项**:
    先做了材质混淆表 `_noita-map-confusion.mjs`(24 块真值 vs 我们):煤矿材质一致 71~77%(错配主要是 sand_static↔rock_static_wet 的噪声形状,不可复现)、山体 67~92%(rock_hard↔rock_static 同理)、
    地表 86~90%(差的是我们烙进材质的树 wood_loose,存档格子里没有树 —— 原版树是 PixelSprite 实体不进 petri),结构(实/空)85~100%。材质带噪声要逐位一致得反 procedural_terrain.cpp(0x8fec00~0x911600,75KB),暂缓。
    **光照反自 `shaders/post_final.frag` + `data/temp/light_mask_inv_pow22_smoothed_center.png`(data.wak 里,之前没解包)+ LightSystem 0xcb71d0 + WorldLightAndFog**,见 `render/Lighting.js` 头注释:
    - 没有"环境光":`lights = tex_lights×0.8 → ^1.5 → +glow → 加天光 → ^(1/2.2) → ×雾 + 探索过的暖灰`,前景 `color_fg *= lights`,**背景(天空)不吃光照**(fg.a==0 直接出 bg)。
    - 光罩:64×64 贴图,中心只有 143/255,径向剖面 143,142,133,121,107,92,76,62,49,43,32,22,14,8,4,1,0;**LightSystem 把 sprite.scale 设成 radius/64 → radius 是光斑直径,真照到的半径只有一半**(玩家 350 → 175px,lantern_small 240 → 120,蜡烛 64 → 32)。
      之前我们 25 盏灯笼各按 120px 满亮度叠加,整个矿洞一片亮;按原版一半半径 + 0.56 峰值后,矿里就是原版那种"灯边一团暖光、其余暗褐"。
    - 雾(fog of war):`FogOfWarRadiusComponent radius 256`(玩家默认),32px 格(0x7a2430 ×1/32)双线性;未探索 = 全黑,探索过没光的地方 `+= 0.35 × 1.4×(0.6,0.5,0.45)` ≈ 0.29 的暖灰;爆炸闪光顺带开孔(fog_of_war_hole);雾随存档走(base64 每 chunk 256 字节)。
    - 天光(skylight):`RENDER_SKYLIGHT_ABOVE_WEIGHT 1 / SIDES 0.75 / TOTAL 0.9 / MAX_REDUCTION 96`,从天空一行行往下:`(上 + 0.75 左上 + 0.75 右上)/2.5 × 0.9 − 实心占比 × 96/255`(原版 64px 格,我们 32px 一行开平方);
      敞开竖井 640px 深还剩 0.35,实心 2 格挡光;`sky_light_color` 取色板 sky 带(开局黄昏 → 地表一层橙色,原版开局就是这个色)。每 0.5s 重算(挖了洞天光跟着进来)。
    - LightComponent 缺省色 (255,178,118),所有带 LightComponent 的实体 / 道具都按 xml 半径与颜色给光(之前灯笼半径 ×0.5、怪 ×0.35 都是拍的)。
    合成在 1/4 分辩率光图上逐像素做(107×61),雾 / 天光先按 32px 格取成小数组再双线性:0.5ms/帧(第一版逐像素查 Map 1.6ms)。
    效果:矿洞截图和原版视频帧(scripts/out/noita-hd/t60.png)同一种"黑 + 暖褐 + 灯边亮"的调子;地表黄昏橙光、山洞内部黑。
28. **逐模块对表第二批:模块 2 世界生成 —— wang 群系的材质带反成逐位一致(推翻了 27 条里"不可复现、暂缓"的判断)**:
    先量化:`_noita-band-stats.mjs` 对真值块算每种材质占比 + 横/竖连续段长(= 斑块尺度),并把两边平色输出成 png。煤矿我们 sand 段长 25~29 vs 真值 8.5、rock_wet 20 vs 11,比例还反了(我们 sand 22% / rock_wet 9%,真值 17% / 18%);山桩 sand 段长 146 vs 19。
    反 exe(断言源文件 `procedural_utils/biome_materials.cpp` / `noise_utils.cpp` + WorldGen):
    - `GetCellMaterial`(0x908f40)wang 群系走 type-2:每格 `0x908cb0` 抖动(Wang offset 4.5 → floor((x+5)/10) 正是我们实测的半格;抖动 = valueNoise·(0.45·simplex+0.1) / gradNoise·((1−w)·0.33+0.111),单位 wang px,幅度只 ±1~5 世界 px)
      → 灰度位图 smoothstep 双线性得 c(白 1 黑 0 标记色 0,c<0.5 空气)→ `0x908e70`:value = max(0.5, c + simplex((x,y)+15.5·valueNoise(x·0.035,y·0.07), ×0.0489)×5.35×0.95×((c−0.5)/2)²)
      → `BiomeMaterials::GetMaterial`(0x8f5030):逐条 limit_y → (add_perlin ? value+simplexD(x·sx,y·sy) : value) ∈ [min,max) → 非稀有直接取;稀有再过 rare_use_perlin(simplexD ∈ (reqMin,reqMax])与 rare_use_polka(`0x8fbe60`:格哈希 < probability 才有点,半径 lerp(radLow,radHigh,h3),(1−d²)³,boxed 用 u⁴+v⁴)。
      条目顺序按 material_index 升序(从真值反推:挖掘场 coal_static idx 9 必须先于 rock_static_grey idx 10,否则 coal_static 永远取不到;推出来深处 63.9/36.1,真值 63/37)。
    - 三个噪声函数的置换表直接抠 exe(0x114d700 自带 256 表 → 值噪声 / 8 向梯度噪声;0x114ced0 标准 Ken Perlin 表 → Gustavson simplexnoise1234 ×40;0x114cc50 短表 → SimplexNoise.java 版 ×70 的 simplexD;polka 的格哈希是 float32 的 (x mod 71+26)²·(y mod 71+161)²·0.001013 取小数)→ `core/noitaNoise.js`。
    - 结果(真值对照):煤矿 sand 8.9/6.4 vs 8.6/6.3、rock_wet 10.4/7.9 vs 10.1/7.9;挖掘场 coal_static 26.5 vs 26.4%、段长 32.2/21.6 vs 32.7/21.8;逐像素材质一致率 煤矿 71~77% → 85~92%,挖掘场 74~79% → **96.7%**。
      真值的边界剖面也对上了:离空气 1~2px 处 sand 80%(c 0.53~0.95 的 smoothstep 过渡带),7px 以外 sand 40% / rock_wet 55%。
    - biomes.json 多了每群系 `mats`(MaterialComponent 全字段,含 add_perlin / add_perlin_scale_x/y);`BandResolver.pick(biome,x,y,c)` 用它,旧手写表只做 xml 缺失时的兜底;`World._fillFromWang` 按 exe 两遍采样(0.5 倍抖动取材质色像素,1.0 倍抖动取灰度 c)。
    - 存疑 / 未做:① 没匹配到任何条目原版返回 0(空气);神殿类 add_perlin 群系按字面深处两成格子会是洞,这里退回区间上限最大的那条(没有神殿真值);② 圣山 temple_wall 真值下半块全空(y ≥ 1280,三块一样)像是存档没生成那半块,跳过;
      ③ 地表 / 山体(type-0 过程群系:0x90a860 随机浮点位图 + mGradient 高度场 + 0x90b280/0x90b110 逐像素混合)没反完,按真值**校成概率混合**(`World._surfacePixel`):
      soil → 第二带在 90px 内线性过渡(真值 24~48px 一半一半);山桩 sand 里 rock_static 的概率按**世界 y**爬升 P=(y−140)/330 封顶 0.8(真值左桩 y<160 0% → 320 42% → 448 83%,右桩早 80px、封顶 70%),
      山体 rock_hard 里 rock_static P=0.35+y/900;颗粒 = 20px simplex 斑块 + 2px 细麻点。右桩 sand 48.7/rock 39.6 vs 真值 47.2/35.9、段长 22.6/20 vs 18.9/21.2;左桩 rock 40 vs 27(两桩剖面本就不同,取了折中)。之前是 soil<52px / sand<325px 的硬阈值,山桩整片沙。
      ④ 丘陵 wood_loose 树 vs 真值空气:原版树是 PixelSprite 实体不在材质层里,对照不了。
29. **接 Box2D(用户 09-05:"矿车轮子 / 多体机械 / 刚体互撞堆叠确实要做,看到底能复刻到什么程度;对接前先反,再定计划,看 web 选哪个 box2d")—— 先反 + 选型 + 计划,还没动代码**:
    - **原版怎么用 Box2D(反 `noita_dev.exe` + 组件文档 + xml 统计)**:
      · 内嵌 **Box2D 2.3.0**(源码路径 `Source/external/box2d_2.3.0`),跑在独立线程(`GridWorld::UpdateBox2D` 0x763280 固定 dt = 1/60;`BOX2D_THREAD_MAX_WAIT_IN_MS` / `BOX2D_FREEZE_STUCK_BODIES` 两个 magic number 名字)。
      · **单位:1 Box2D 米 = 6 游戏像素**。`PhysicsPosToGamePos`(0x83e040 → 0x752c30)= `phys × scale + offset`,scale 全局 0x132aad8 由 0x405c50 静态初始化 = (6.0, 6.0) double,offset = 512 × 0.5 = 256;`PhysicsVecToGameVec`(0x83e710)只乘 6。所以 xml 里 `PhysicsThrowable max_throw_speed 180` 是 px/s,进 Box2D 要 ÷6;`b2_force_on_leak` 之类是 Box2D 单位。
      · **地形 → 碰撞体**:`Box2DTerrain::ParseIntoPolygons_Threaded`(box2d_terrain.cpp 0x884ce0,`box2d_terrain_array.h` 每个 gridworld 点一张 `mArray2D`)在线程里用 `marching_squares_with_holes.h` 描轮廓 + `TriangulatePixels`(triangulate_pixels_impl.h)三角化;
        只在 `GridWorld::Box2D_SetUpdateRect`(0x76f950)定的更新区里做,里面两个阈值 **350² / 750²**(距离平方,px)—— 近圈全更新、远圈只维持。刚体像素与格子靠 `PhysicsBridge`(`mCellPhysicsLink.GetB2Body()`)双向连接;`csolidcell.cpp` 里 solid 格必须挂 b2Body(断言 "Sole solid cells shouldn't be created")。
      · **组件**(component_documentation.txt 1849~2088,已全文核对):`PhysicsBodyComponent`(老式,uid 分体;linear/angular_damping、allow_sleep、fixed_rotation、is_bullet、is_static/kinematic、**buoyancy 0.7**、go_through_sand、auto_clean(埋沙里被清掉,矿车轮子要关)、
        on_death_leave_physics_body、update_entity_transform=0 给非主体、hax_fix_going_through_ground)· `PhysicsBody2Component`(新式,mPixelCountOrig / mPixelCount 记原始与当前像素数 → ExplodeOnDamage 的 destruction_required 就是 1 − cur/orig)·
        `PhysicsImageShapeComponent`(image_file + material + body_id / is_root / is_circle / centered / offset)· `PhysicsShapeComponent`(无图:box / circle / capsule,friction 0.75 / restitution 0.1 / density 0.75)·
        `PhysicsJointComponent`(老式:默认 revolute,body1_id/body2_id + pos_x/pos_y 锚,`nail_to_wall` = 和 ground body 连,`grid_joint`,`breakable`,`mMotorEnabled/mMotorSpeed/mMaxMotorTorque`)·
        `PhysicsJoint2Component`(新式:type REVOLUTE / WELD / *_ATTACH_TO_NEARBY_SURFACE(沿 ray_x/ray_y 默认 (0,−10) 找地面钉到 ground body,surface_attachment_offset_y 2.5),break_force 1.3 / break_distance 1.4142 / break_on_body_modified / break_on_shear_angle_deg)+ `PhysicsJoint2MutatorComponent`(motor_speed / motor_max_torque,destroy)·
        `PhysicsThrowableComponent`(throw_force_coeff 1 / max_throw_speed 180 / torque 0.5~8 / attach_min_speed 70 / knife_style)· `PhysicsBodyCollisionDamage`(speed_threshold 60 / damage_multiplier 1/60)· `PhysicsAIComponent`(force_coeff 30 / torque_coeff 50 / force_max 100 / levitate,无人机 / 水晶 / 石像)·
        `PhysicsKeepInWorld` · `PhysicsPickUp`(两个 weld joint 抓东西)· `PhysicsRagdollComponent`(0 处使用,尸体走 LoadRagdoll 引擎路径,见第 19 条)。
      · **材质表给 Box2D 的字段**(materials.xml 出现次数):`density` 232 · `platform_type` 106 · `solid_friction` 96 · `solid_static_type` 51 · `solid_break_to_type` 38 · `solid_on_collision_material` 32 · `solid_collide_with_self` 25 · `solid_restitution` 20 · `solid_gravity_scale` 11 ·
        `solid_on_sleep_convert` 10 · `solid_on_collision_splash_power` 9 · `solid_on_collision_explode` 6 · `solid_break_on_explosion_rate` 6 · `solid_go_through_sand` 5 · `solid_on_break_explode` / `solid_on_collision_convert` 1。magic_numbers:`PHYSICS_JOINT_MAX_FORCE_MULTIPLIER 160`、`PHYSICS_RAGDOLL_VERY_STIFF_JOINT_STIFFNESS 2`、
        `PHYSICS_FLOATER_FORCE_COEFF 15 / FORCE_VEC_MAX 5 / TORQUE_COEFF 50 / FORCE_BALANCING 2.3 / TORQUE_BALANCING 0.2`(PhysicsAI 浮空体)、`RAGDOLL_OWN_VELOCITY_IMPULSE_MULTIPLIER 3`。
      · **实体侧用量**(3030 个 xml):PhysicsBody 174 / PhysicsBody2 96 / PhysicsImageShape 359 / PhysicsShape 24 / PhysicsJoint 22 / PhysicsJoint2 31 / Joint2Mutator 14 / Throwable 54 / PhysicsAI 45 / CollisionDamage 42 / **VerletPhysics 111**(链、触手、藤、电线,是另一套 verlet,不进 Box2D,只靠 VERLET_ROPE_ONE/TWO_JOINTS 挂到刚体上)。
        关节类型:REVOLUTE 93 · REVOLUTE_ATTACH_TO_NEARBY_SURFACE 19 · WELD 26 · WELD_ATTACH 3 · VERLET_ROPE_ONE/TWO 15/14。**多体实体 39 个**:矿车 / 木车 / 滑板(车身 + 两轮 revolute,`physics_minecart.xml` 轮 `is_circle` + `auto_clean=0` + `update_entity_transform=0`)、
        wheel_stand ×3、physics_fungus ×11(帽 + 4 节茎 + 脚,5 个 revolute break_force 10 / break_distance 5 + 脚 ATTACH_TO_NEARBY_SURFACE break 35/8,Mutator 电机 0 / 扭矩 10 = 只当阻尼)、家具 bunk / cryopod / locker / table、tubelamp、templedoor2(齿轮 + 齿条)、
        excavationsite_machine_3b/3c、chain_torch、banner、grass_01/02、boss_centipede body_chunks、goldnugget_x、bomb_cart。
      · **还没反、动手时补**:b2World 重力值与 Step 的 velocity/position 迭代数(b2World 构造在 gridworld_thread_impl.cpp 附近,字符串定位不到,可用真机录像量落体加速度兜底);像素盖章顺序(推测每帧 擦 → Step → 按新 xform 重写);Box2DTerrain 单块尺寸;`solid_break_on_explosion_rate` 语义。
    - **Web 选型 → planck.js 1.5.0**(2026-04,MIT,5.2k★,活跃):理由 ① 它是 **Box2D 2.3 的 JS 重写**,和原版内嵌的 2.3.0 同源 —— friction / restitution / damping / joint 类型与电机 / `getReactionForce`(break_force)/ bullet / sleep 语义一一对应,xml 参数直接抄;
      ② 纯 JS 可读可改 —— 我们一定要动内部(自定义 contact filter 做 go_through_sand / 与人不碰、fixture userData 挂像素、睡眠阈值),wasm 库改不了;③ 我们同屏醒着的刚体几十个、地形边几百条,JS 足够(<1ms),不需要 wasm 的量级;
      ④ 主线程跑(必须和 CellSim 同线程盖章),iOS 无 wasm 内存问题;Canvas2D debug draw 几行。**不选**:box2d-wasm(2.4,行为略变、emscripten 手动释放对象,改不了内部)、Rapier(不是 Box2D,求解器不同,原版常数对不上,优点确定性我们不需要)、box2d3-wasm(v3 软步进求解器,行为和 2.3 差更多)、matter.js(堆叠差)。
    - **计划(每步单独上线 + 探针 `_noita-box2d-shot.mjs`)**:
      ① ✅(已上线)`Physics.js`:planck 1.5.0 World 封装,6px = 1m,固定 dt 1/60(掉帧最多补 3 步),8/3 迭代,`maxPolygonVertices` 压回 Box2D 2.3 的 8;地形 → 静态碰撞:按 CellSim 的 32×32 块做 marching squares
        (采样 = 格中心,边中点正好落在格边上,所以平面 / 竖面的碰撞线就是像素边界,只有斜角切半格)→ Douglas-Peucker 0.6px → **planck Chain**(两面都碰,不三角化);
        块只给动态刚体包围盒 ±24px 覆盖到的建(睡着的也算,`userData.noTerrain` 的除外)、每帧最多重建 6 块、120 帧没人用就释放;判脏靠新加的 `CellSim.tver`(每块一个实心版本号,只在格子"实心(static/solid/sand)↔ 非实心"变化时 +1,
        液体流 / 火烧不碰它),块版本 = 自己 + 右 / 下 / 右下邻块(采样 33×33 要读邻块一行);块内容变了 → `queryAABB` 把压在上面的睡着刚体叫醒(Box2D 换 fixture 不会自己唤醒别人)。`CellSim.solidB(x,y)` = 刚体撞的实心(窗口外当实心)。
        noitaPlay:`?phys=0` 关、`?physTest=1` 出生点上方丢 6 箱 / 2 圆 / 1 板、`?physDraw=1` 画碰撞线(绿地形 / 黄刚体),面板多一行"物理 ms 刚体 醒/总 地形块"。
        探针 `_noita-box2d-shot.mjs`(线上要 http 直连:`$env:ORIGIN_IP` + http://,https 到源站被关了):9 个测试刚体 3.5s 后底面离地 0.04~0.1px、平地的全睡、斜坡上的还在滑;石台上睡着的箱子脚下挖空 → 150ms 内醒 → 掉到下面地面;
        27~38 块地形 / 108 顶点 / p50 0.1ms p95 0.2ms。node 单测 `_noita-box2d-unit.mjs`(合成地形:3×3 块描成 13 点闭环 → 简化 5 点;斜坡滑到坡底;跨块接缝滑行不弹)。
        **发现**:全埋在实心里的刚体看不到 chain 的边会一直掉(原版 `hax_fix_going_through_ground` 就是治这个)—— ③ 盖章时出生 / 塌方压进实心要先顶出来。b2World 重力仍用 350(没反出来)。
        **② 做完后地形改成了多边形(见下),chain 那套废了。**
      ② ✅(已上线)PhysicsImageShape → planck body:`Physics.attach(rb)` 像素 mask → marching squares → DP 0.3px → 耳切三角化 → Hertel-Mehlhorn 合并成 ≤8 顶点凸块(`pixelPolygons`,洞填实;≤3 像素 / 1px 细杆退回包围盒 Box),
        fixture density / friction / restitution = 材质表 density / solid_friction / solid_restitution(木 6/0.9、金属 8/0.7、蘑菇弹性 0.4),`gravScale` = solid_gravity_scale。`Entities._updateBodies` 里形状图道具 / 物品 / 崩塌块都挂上;
        钉的 / 挂链的(`ropes`,桌子 / 灯笼)/ 布娃娃部件仍走手写求解器(关节在 ④)。桥接:`_stepPhysBody` 只做浮力(`RigidBody.buoyancy` 抽出来)+ `pushToPhysics`(外部改了 vx/vy/w/x/y/fixDirty 才写进 planck:爆炸 / 推 / 踢 / 顶出实心 / 挖损重建 fixtures),
        `Physics._syncAll` 每步末把位置 / 速度回读到 rb 并记 `_spPrev/_vyPrev` 给药水碎裂 / 碰撞伤害 / 摔落判定;`touching` 看接触表。睡:planck 自己判(`isAwake`,阈值放到 0.03 m/s —— 6px=1m 下重力 58 m/s²,默认 0.01 太严),
        `supported` 脚下有格子才 `sleep(sim)` 写像素 + `setGridSleep` 停用 body;**一摞是一个岛同时入睡,`restList` 从低到高连锁写格子**(不然只睡最下面一个,它停用后上面的接触断了被叫醒再等 0.5s)。物品(金块 / 药水)睡着不写格子、body 留着堆在一起。
        **地形从 chain 换成多边形**:node 复现 —— Box2D 2.3 的 edge-polygon 碰撞在"箱子平放、底边正对 chain 顶点(块接缝 / 中间共线点 / 切段点)"时一摞箱子顶上永远 7px/s 抖、睡不着,幽灵顶点 / 1px 重叠都不可靠;
        多边形对多边形任何接缝位置都稳(原版也是 TriangulatePixels 出多边形)。现在每块 34×34 采样(外圈强制空气 → 轮廓全闭合,版本只看自己块)→ `contourPolygons`:内外靠包含深度判(轮廓走向任意,不能看面积符号),
        洞(子弹打的气泡 / 块内封闭洞)用 max-x 顶点桥接进外环再耳切(重合点不算"在三角形里"、没有严格凸耳时先剔共线点)→ 合并凸块;全实心块一个方块。多边形按顶点键逐块比对,只拆 / 建变了的。
        `queryAABB` 全体叫醒那段删了(planck 拆掉接触中的 fixture 会自己唤醒)。
        探针 `_noita-box2d-shot.mjs`(场景挪到高空石台:探针自己把坡挖了土会一直往台面淌,油桶滚下去摔碎的油会把箱子泡着 —— 泡液体的刚体每帧吃浮力永远睡不着):5 个 `physics_box_harmless`(11px)叠着 1s 内整摞睡 + 写格子、间距 11.0~11.1、rot 0;
        油桶 pb 落台 gap 0.09;打掉 24 像素 fixtures 1 → 3、质量 20 → 16;r18 爆炸把 29px 处的石头抛 9px、15px 处的抠掉六成炸碎(`physics_crate` 带 ExplodeOnDamage 被爆炸挖像素会连锁炸掉,测抛飞要用 harmless / 石头);
        旧探针 `_noita-body-shot`(崩塌块砸地炸 + 睡着变 concrete_static 120 格 / 金块打光)/ `_noita-ragdoll-shot`(12 块 11 关节 0 断)不回归。物理 p50 0.7 / p95 1.1ms(多边形三角化比 chain 贵、落沙区每帧重建几块;iPhone 预算 0.5ms,后面看要不要给三角化加缓存)。
        node 单测 `_noita-box2d-unit.mjs`:20×20 带 6×6 洞 + 2×2 气泡 → 16 块凸多边形,洞心 / 气泡不在任何多边形里;方块 1 块 / 桌子 5 块 / 环 11 块(填洞)。
      ④ ✅ 第一批(已上线)关节 / 多体:prepare 抽全部 `d.shapes[{image, material, bodyId, isRoot, isCircle, centered, offX, offY, z}]` / `d.bodies`(老式 uid 各自的阻尼)/ `d.joints`(老式 PhysicsJoint:REVOLUTE,pos 图内像素坐标,nail;
        新式 Joint2:REVOLUTE / WELD / *_ATTACH_TO_NEARBY_SURFACE,offset 实体坐标,break_force / break_distance / break_on_body_modified,Mutator 电机)/ `d.lift`(VariableStorage);PROPS 加 wheel_stand ×3、physics_fungus 全家 11 种、templedoor2。
        坐标约定(量过图):老式几张图同一画布各画自己那块,`pos` = 轮子像素中心(矿车左轮 (4.5,12.5) ↔ pos (4,12),轮架 (46,37) ↔ pos (46,37));新式小图 + offset(centered → 图心在实体 + offset,否则左上角)。
        `Entities._makeMultiBody`:每个 body_id 一个 RigidBody(`multi` 共享组、`partId`、`isCircle` → Circle fixture 按像素包围盒、z 大的先画),planck `revolute / weld`(nail / 没 body2 → ground;ATTACH 沿 ray 找第一格实心钉地,退 surface_attachment_offset_y);
        同一实体的部件 `filterGroupIndex` 负组不互撞(原版 Box2D_CreateFilterData;蘑菇帽和第二节茎、桌腿和桌面本来就重叠,不设一出生就弹飞);≤40 像素的小件(2.5px 的矿车轮)开 `bullet` 免穿台面;
        整组同睡(全部 planck 睡 + 组有支撑)/ 同醒(`RigidBody.wake` 叫醒兄弟)/ 支撑按组算(钉地关节算;部件脚下的格子**不能是兄弟睡进格子的像素**,不然车身压着自己的轮子永远"有支撑",挖空不醒);
        睡时按 z 从前往后写格子、`cellSet` 只记自己真正写进去的格子 —— 醒 / 清点只看这些(轮子和车身同材质重叠,之前先醒的把同材质格子全收走、后醒的当"被挖光"→ 轮子销毁关节没了);
        血 / 爆炸记在根部件(`M.root`,is_root 或第一张图),根死整组撤;`_updateMultis`:break_distance(**Box2D 米 ×6**:1.4142 → 8.5px、蘑菇 5 → 30px;按像素算矿车落地那一下就断)/ break_force × PHYSICS_JOINT_MAX_FORCE_MULTIPLIER 160 / break_on_body_modified / 部件死了拆关节。
        **physics_fungus.lua**:每帧 `PhysicsApplyForce(0, lift)`(-25 = 向上 25 N 浮力)+ 各节 Joint2Mutator `motor_speed = sin(t + joint×0.632) × ProceduralRandomf(0.1..0.75)`(第 1 节反向)—— 蘑菇是"气球 + 脚下地锚"立着的,`motor_max_torque 10`(零速电机 = 刹车)只是摆动阻尼;
        `M.lift / M.sway` 照做,`enableMotor` 在 torque > 0 时也开(之前只看速度,茎是一串自由铰链就折倒了)。
        **反出两个尺度常数(改了全局)**:① Box2D 世界重力 = exe `global_gravity = scale(6) × 10 = 60 px/s² = 10 m/s²`(0x756d09;不是我们一直用的 350 —— 原版箱子 / 尸体确实"飘着"落、药水能扔出平飞远弧),`BODY_GRAVITY` 也改 60;
        ② fixture 密度 = 材质 density / 36(每像素 density/1296 kg):各尺寸蘑菇 lift/像素 ≈ 0.06~0.095 N 恒定 = 略大于每像素重量,只有这个尺度下 262 像素的蘑菇(12 N)被 25 N 拉直;ragdoll 躯干 0.28 kg 自重 ≪ MIN_BREAK_FORCE 200;
        轮架 5 kg 的轮 200 N·m 电机 0.2s 到 1.5 rad/s;矿车 `break_force 20`×160 扛得住落地。之前 density 直接当 kg/m² 时蘑菇怎么都立不住。
        探针 `_noita-box2d-joint-shot.mjs`:高空石台上 矿车 3 部件 2 关节 / 滑板 3-2 / 轮架 2-1(轮 w=1.5)/ 蘑菇 6-6 含 1 钉地(帽 y 稳在台面上 30px,六节一条竖线轻摆)/ 桌子 4-4;推车身 90px/s → 走 30~44px 轮子转 3~12 rad 关节不断;
        r14 爆炸炸帽 → 根死整株撤;整组睡进格子 → 挖台面 → 整组醒掉 33px。旧探针 `_noita-body-shot` / `_noita-ragdoll-shot`(12 块 11 关节)不回归。物理 p50 0.3 / p95 0.6ms。
        **摆位教训**:重力小了以后车会慢慢滚到滑板上,压在别的物体上算有支撑、挖台面就不醒 —— 探针把滑板挪开了。
        ④ 第二批 ✅(已上线):**灯笼上关节** —— 单图 + 关节(lantern_small ATTACH / physics_lantern 老式 nail / physics_wheel 钉墙轮)也走多体路径,`_isMulti` 只把 chain_to_ceiling 的吊链(verlet 绳,原版也不是 Box2D 体)留给 ropes;
        实体原点 = 调用方给的图心 − root_offset(lantern_small 5,7);ATTACH 射线上没实心就在锚点 12px 内找最近的(灯的标记点不一定贴天花板);钉地关节记 `anchorCell`,那格被挖 / 炸 / 烧掉关节断(醒着睡着都查,睡着的先叫醒);
        单件吊在地上的生成时平移到锚点正下方挂直(钩子偏一点就当钟摆晃几分钟,角阻尼 0.01,煤矿 60 盏灯永远醒着);根部件带火苗 / 皮肤精灵。
        顺手修的三处:① **模拟窗口外的刚体冻住**(`setFrozen`:planck 的 world.step 不分窗口,远处区块生成的矿车 / 灯笼在没建地形块的虚空里一直掉,y 掉到 5000+ 速度 670)、进窗口解冻;
        ② **自己的静止计时**:附近滴水 / 落沙让地形块重建,planck 拆 fixture 时把压着的刚体叫醒,永远攒不够它的 0.5s → 速度 <1px/s 且贴着东西 / 吊着 0.5s 就写格子;煤矿一屏 12s 后 0 个刚体在跑、物理 0ms(之前 78/84 醒着 1.4ms);
        ③ 弹丸子步 >1px 时补采中点(2px 步会从刚体上被前几发抠出的 3px 洞里穿过去)。
        `_noita-lantern-shot` 40 发不碎的根因是探针:大灯笼是空心框,弹道比瞄准线低 5° 一直擦底边,底边打没了就全穿过去(像素级重复弹道原版也放过)→ 瞄准抬 4px + ±1.5px 抖动:第 1 发起火漏油、第 12~14 发碎。
        **物理蘑菇进真菌洞 / 丛林(顺带解锁)**:`spawn_physics_fungus` 表之前因没有定义而跳过,现在自然长出(真菌洞一屏 ~50 株,skipped {})。为此补的:
        · `PhysicsBody2Component init_offset_y`(蘑菇 40 / 小 28):形状 / 关节坐标系整体上移 —— lua `spawn()` 把实体放在地面标记点,形状从 −6 到 +41、脚在下、锚点 +41 往下射 30px 找地,不减就埔进地里 40px 被挤出来翻滚(prepare 抽进 `d.body.initOffX/Y`,`_makeMultiBody` 减掉;探针的蘑菇也改成标记放地面);
        · 摆动名额 `MAX_SWAY 4`:lua 是相机 ±50 内全摆,一屏十几株 80 多个部件永远醒着 3~5ms、倒成一堆时 26ms → 只让离相机中心最近的 4 株摆,其余电机归零静止 → 入睡写格子;
        · 全部蘑菇共用碰撞组 −1 互不碰(长得密、彼此挨着,在摆的通过接触把整片邻居一直叫醒 —— Box2D 同一岛同醒;植物重叠无妨);
        · 地锚断了不再施浮力(我们的质量尺度下浮力 25 N ≈ 1.3~2× 重量,断了会像气球飘走;各尺寸 lift/重量比 0.6~2 摆动,密度常数没法定死,先这样);
        · 地形块重建两个闸:同一块至少隔 6 帧、每帧最多 2 块(真菌洞落沙 / 孢子不停改格子,之前每帧重建 6 块 2.7ms);静止阈值放到 1.5px/s / 0.06rad/s(一串吊着浮力的铰链有 0.2~0.5px/s 残抖)。
        真菌洞一屏:物理 54ms/20fps → 2.7~3.3ms(其中 world.step 2.4、地形 0.8;那里材质模拟本身 12~16ms 才是大头);煤矿 / 出生地 0~0.5ms。
        **尺度常数反 exe 定稿(用户:"反吧";推翻了上面 ④ 里 "重力 60 / 密度 ÷36" 的推断)**:
        · **b2World 重力 (0, 12) m/s² = 72 px/s²**:GridWorld 建 b2World(`new` 0x192b8 字节 @0x760b1c,ctor 0xabb6c0)传的重力向量 = .rdata 0x11e0b70 两个 double。`global_gravity = 6×10 = 60` 是 grid_particles.cpp 的粒子重力,不是 Box2D 的。
        · **fixture density = 材质 `density` 原值**(像素刚体 CreateFixture 0x9ec1e6:density ← CellData+0x15c,xml 解析处 `lea eax,[esi+0x15c]` 配 "density" 字符串;friction ← +0x198 solid_friction、restitution ← +0x19c solid_restitution;无材质默认 1.0 / 0.3 / 0.2)。
          这个 Box2D 是**双精度**编译的(b2FixtureDef 字段是 double,PhysicsPosToGamePos 也是 double)。质量 = density × px/36:24px 木箱 96 kg、262px 蘑菇 44 kg、灯笼 11 kg —— 和爆炸 `physics_explosion_power ≈2 × 3600 N·s → ~450 px/s` 正好对上(我们经验拟合的 ×120)。
        · **关节力基准 = (mA + mB) × PHYSICS_JOINT_MAX_FORCE_MULTIPLIER(160)**(0x76ac36 / 0x76c0af:body+0xd0 是 m_mass;ragdoll 关节 0x2b67/0x2b68 用 max(200, (mA+mB)×400)),`break_force` 乘它 = 断裂阈值 N(灯笼 0.5×11×160 = 900 N > 自重 136;蘑菇茎 10×5.4×160 = 8600);
          电机 `motor_max_torque` 按同一基准乘(裸值 10 N·m 撑不住 44 kg 的蘑菇,原版蘑菇是立着的;摆幅 = ∫电机速度 dt,原版真菌洞的蘑菇本来就晃得明显)。`PhysicsApplyForce` 不换算(0x836f20 → 0xd00260 排队给 Box2D 线程),lift 25 N 对 524 N 的蘑菇只是减重。
        · 代码:`Physics` 重力默认 72、`BODY_GRAVITY` 72、density 原值、`Physics.jointForceScale(a,b)`、`_makeMultiBody` 的 `breakN`、lift 不再限制在有锚时。探针:蘑菇 6-6 立着摆、灯笼 36 发碎、矿车推 24px 轮转、堆叠 / 崩塌块 / 尸体不回归,真菌洞物理 1.1ms。
      ⑥ ✅ 第一半(已上线)**尸体换 Box2D 关节**:`_buildRagdoll` 有 planck 时把部件挂成多体组(`M.isRagdoll`,`group` 不再设 → 不走手写 pin joint 求解),每个重叠像素一个 revolute(LoadRagdoll 语义),
        刚度 = 每具掷 rand<0.75 → 2 否则 0.05,当电机刹车:扭矩 = stiff × **两端较轻那块** × 160(按质量和算时 10 kg 躯干对 0.5 kg 的手会把手甩成 16~27 rad/s 的螺旋桨),断裂 max(200, (mA+mB)×400) + 锚点像素被打掉断(`anchorPix`);
        BLOOD_EXPLOSION 不建关节、不设碰撞组靠互撞散开(手写版补的离心初速撤了);FROZEN 单块也上 planck;`Ragdoll` 类只剩血喷 / 烧尸记账(`_ragdollBlood`);根死不连坐(`!M.isRagdoll`)。
        探针:NORMAL 12 块 11 关节 0 断、1.9s 整具写格子、锚点误差 0;火烧死 3s 内 24~28 格火、67 格 meat;BLOOD_EXPLOSION 散 31~49px;`_noita-body-shot` 12 块 3s 全睡(之前 planck 第一版 133px/s 乱抖就是刹车扭矩按质量和算的)。
        手写求解器现在只剩:chain_to_ceiling 吊链(`ropes`)、货架上钉着的卡 / 特权(`nailed` 物品)、没 planck 的兜底。
      ⑤ ✅ 一半(已上线)**碰撞伤害走 Box2D 接触**:`Physics` 挂 `world.on('pre-solve')`,接触点法向接近速度 < −3 px/s(确实在撞,贴着滑 / 滚不算)时把两体**相对速度大小**(px/s)记到 `rb._impact`,`_syncAll` 汇成 `rb.impact`(一帧取最大,Entities 用完清零)。
        用它的地方:PhysicsBodyCollisionDamageComponent(`impact > speed_threshold` → 伤 impact × damage_multiplier,灯笼 120 / 药水 80)、混凝土块撞碎(>60)、药水碎(potion.xml:阈值 80、×1/60、hp 0.5 → 撞击 >80 px/s 必碎;从 44px 以上掉下来才到 80,手边掉地不碎;扔出去 180 必碎,点射墙也碎)。
        踩过的坑:一开始用法向分量,扔出去贴地滑着落地法向分量只有几十不碎;又加了 0.1s 出生保护,把"扔出去当帧撞墙"的 205 吞了 —— 出生静止的刚体本来没有接触速度,保护撤掉。手写求解器分支仍看前后帧速度差。
        浮力 `buoyancy 0.7` 没反出来(physics_bridge.cpp 6 个函数里没看到明显的按格数算力的常量;木箱 density 6 在水里能浮,说明不是简单阿基米德),先留现在按密度比的近似。
        **浮力改走 Box2D 的力 + 浮睡**(用户反馈:几具尸体挤在水坑里一直动、fps 掉到 20 —— 探针复现 5 具 60 块全醒 12s 不歇):之前浮力每帧改 rb.vy 再 pushToPhysics,setLinearVelocity 顺手 setAwake(true),泡水的刚体永远醒着。
        现在 `Physics.applyBuoyancy`:applyForceToCenter(重力 × buoy × 淹没比例,wake=false)+ 液体阻尼(线 2/s 角 2.5/s,出水复原),不碰 rb 速度;泡水(>50%)的静止阈值放宽到 4px/s / 0.25rad/s(边缘采样的台阶浮力让水面永远有 2~3px/s 起伏);
        歇下但脚下没格子且泡着 → `_floatSleep`:planck setAwake(false)、不写格子(水照常从旁边流),记入睡时淹没比例,水位降到 −0.15 以下 / 被撞 / 关节邻居醒 → 醒过来掉下去再走正常入睡。planck 自己睡着的物品(金块)定期查:没接触又没泡水就叫醒。
        探针 `_noita-corpse-water-shot`:1 具 2s 全浮睡、5 具 7s 全睡(醒 0),放水后全醒掉到底;木箱泡水 7s 浮到水面睡。
        **回收**(用户反馈尸体 / 灯笼越来越多):原版 b2body 是 camera bound 的,离相机远了就销毁(组件文档 on_death_really_leave_body 那句"camera bound... god damn"),尸体不存盘;道具随 chunk 序列化。
        我们:① `unloadChunk` 连刚体一起收(道具 / 尸块 / 崩塌块;物品留着,玩家回来东西还在;睡进格子的像素本来就在 chunk.mat 里)—— streamer LRU 40 块,刚体总数被这个兜住;
        ② 尸块在 planck 里睡(浮睡 / 压在同伴上)也算睡,睡够 8s 到期:干的写成肉像素、泡水的散掉(之前只有写进格子的才到期,水坑里的永远攒着);
        ③ 尸块上限 `MAX_RAGDOLL_PARTS` 96(≈8 具):超了先收最老的、睡着的 —— 60 块 600 对接触在 PC 上就 4.5ms,手机上这就是 20fps。
        **浮睡改成写格子**:只 setAwake(false) 不写格子的话,Box2D 下一步建岛时把接触 / 关节连着的睡体一起拉醒(b2World::Solve 的 DFS 会 SetAwake 岛内所有 body),
        十具尸体挤一坑各自歇下的时刻对不上,睡 → 拉醒 → 循环(线上探针 floatS 0/12/36/0 抖);写进格子 = 停用,岛断开各睡各的 —— 这也正是原版的做法(睡了像素就进世界,不管在不在水里)。
        醒的条件换 `_wetNear`(边缘像素 4 邻格里有液体的比例 ≥15%):水退了就醒掉下去;`_multiSupported` 里浮睡且身边有水的部件算支撑。浮睡到期(8s)收回像素散掉,不留浮着的肉筏。
        **水里的静止判定**(`_stepPhysBody`):整具尸体按"有一块泡着"算在水里(翘在水面上的胳膊按陆上阈值永远歇不下);线速 <8、角速 <0.5 算歇着(3 像素的小尸块转动惯量小,关节一拽角速 0.3~0.8),
        但 vy < −1.5(还在往上浮)不算 —— 木箱从水底浮上来 2.5px/s,不然半水深就停住;偶尔一帧超限不清零只往回扣 4×dt。施力用低通过的淹没比例(wetS,0.25/帧),小件边缘像素全采不隔 3。
        浮力系数换成 `(ld/4)×(2.85−0.25ρ)`(仍是拟合:木 / 肉 1.35 三秒浮出,金属 0.85 慢沉,混凝土 0.35;原版 buoyancy 0.7 在 PhysicsBodyComponent +0x78 反到了字段,施力处没找到);液体阻尼线 3 / 角 4。
        探针:10 具 120 块 → 上限 96、6s 醒 84、11s 醒 13;5 具 11s 醒 12;木箱 4s 浮到水面睡;搅动后 2~5s 重新睡下。偶发 `RangeError: Invalid array length`(十次里两次,无堆栈,未定位,已在探针里加 window.onerror 抓)。
        ✅(已上线)**挖掘场多体机械 excavationsite_machine_3b/3c**(`spawn_physicsstructure` 标记 0a50ff,−5,−5 处):机身 PhysicsBodyComponent `is_static=1` → planck 静态体(`rb.isStatic`),
        `centered=0` → 画布左上角在实体;三个轮子写着 centered=1 但和机身共用一张 150×125 画布(轮子包围盒中心 (35.5,64.5)(93.5,37.5)(82.5,89.5) 正好是关节 pos_x/pos_y),
        所以老式多体统一按"根图定画布左上角(根 centered 则 实体 − 画布/2),所有图都画在这张画布里,关节 pos = 画布像素"—— 矿车 / 轮架全 centered 的情况结果不变。
        含静态部件的多体永远不写格子(`M.hasStatic`:机身进格子轮子就跟地形卡上;电机 12 / −5 / 10 rad/s、3c 22 rad/s 反正一直转)、算有支撑、不做埋地上抬。探针 `_noita-machine-shot`:轮心落在关节 ±2px,角速度 = 电机速度,物理 0.6ms。
        还差:PhysicsThrowable、Joint2 的 motor_max_torque 是否真乘质量基准(推断,没直接反到)、⑤ 的 buoyancy 0.7 / go_through_sand / solid_on_collision_*。
      ② PhysicsImageShape → body:像素 → marching squares → 简化 → **凸分解**(planck 多边形 ≤8 顶点凸;先用 ear-clipping 三角化 + 相邻合并)→ fixtures(density = 材质 density / 6²,friction = solid_friction,restitution = solid_restitution);is_circle → circle;同 body_id 的多张图合一个 body;保留像素图与材质做盖章。
      ③ 盖章协议照原版:每帧 擦旧像素 → world.step → 按新 xform 重写像素(最近邻)→ CellSim 接管本帧;格子里的刚体像素被挖 / 烧 → 记 body modified → 节流重建 fixtures + 更新 mPixelCount(ExplodeOnDamage 用);
        **睡着**(planck isAwake=false 持续 0.5s)→ 像素留在格子里、fixture 设 inactive(不删 body 保留关节),`audit()` 照旧清点支撑 / 缺损;支撑没了 / 被爆炸 / 被推 → setAwake。`solid_on_sleep_convert` 睡着换材质并撤 body。
      ④ 关节:PhysicsJoint(revolute 默认;nail_to_wall → 与 ground body 在世界锚点;grid_joint;电机)+ PhysicsJoint2(REVOLUTE / WELD;ATTACH_TO_NEARBY_SURFACE 沿 ray 找实心格钉 ground;break_force × PHYSICS_JOINT_MAX_FORCE_MULTIPLIER 160 对 getReactionForce;break_distance;break_on_body_modified;Mutator 电机)。
        先做:矿车 / 木车 / 滑板轮子 → wheel_stand → physics_fungus 链 → 家具 / tubelamp → templedoor2 / 挖掘场机械。现有 `RigidBody.ropes` 的绳约束保留给 verlet 类(吊链)。
      ⑤ 互动搬到 Box2D:爆炸 → applyLinearImpulse(现有 physics_explosion_power 公式 ÷6)、弹丸命中 → dir×5(已反)、玩家推 / 踢 → 冲量、`PhysicsBodyCollisionDamage` 用 postSolve 的法向冲量 / 质量 ÷ dt 当速度对 speed_threshold、
        浮力 = buoyancy 0.7 × 淹没像素数(按材质密度差)、go_through_sand 用 contact filter、`solid_on_collision_explode / splash / convert`、`solid_break_to_type`(碎成小块)、auto_clean(埋沙 3s 撤掉)。刚体互撞 / 堆叠 / 金块堆由 Box2D 自带。
      ⑥ 收尾:PhysicsThrowable(药水扔 / 刀插墙)、PhysicsAI 浮空体(无人机 / 水晶按 force_coeff / torque_coeff 施力,替掉现在的飞行模型)、第 19 条的 `Ragdoll.js` 换成 revolute 关节 + 刚度 / 断裂(0.75 掷 2 或 0.05 刚度、break 200~400×)、
        黑洞 / 崩塌块 `LooseGround` 走同一套。手写的 `RigidBody.js` 求解器在 ⑤ 之后退役,保留像素 / 盖章 / audit 部分。
      预算:iPhone 物理 ≤0.5ms/帧(醒着 ≤60 体)、地形块重建节流每帧 ≤2 块;探针:10 箱堆叠 3s 稳、矿车推着走轮子转、蘑菇被打断裂倒、炸药箱连锁把箱子炸飞后互相弹开、睡着写回格子 / 挖脚下再醒、崩塌块与旧探针(`_noita-body-shot` / `_noita-ragdoll-shot`)不回归。

## 2.5 接手指南(新会话从这里开始)

**仓库**:`https://github.com/yinyuan1990/noita-web.git`(main;2026-09-04 首推,`.gitignore` 排除 node_modules / dist* / noita-ref / scripts/out / scripts/shots)。
本机 `git config http.proxy socks5h://127.0.0.1:2801`(用户的本地代理是 SOCKS5,走 http:// 会超时)。`noita-ref/`(原版解包数据 + 存档真值)不在仓库里,只在本机 `e:\soft\xiaoshuodongtai\web\noita-ref`。
**当前状态(2026-09-05)**:主线 + 非主线全部群系、圣山全套(商店 / 特权 / 守卫 / 入口传送门 / 出口崩塌 / 诅咒)、玩法闭环 UI(导航 / 引导 / 背包 / 踢 / 暂停 / 滚轮 / 手游布局)、存档、趟沙、
怪物随区块卸载 / 重刷、走路 AI 重做(真碰撞盒寻路 + 抛物跳)、自由模式(法术库全开 / 无限法力,`?free=0` 回经典)全部上线(第 9 条);09-05 一批(2.4 第 11~19 条:植被 / 状态区 / 灯笼 / 圣山崩塌 / 刚体摇晃 / platform_type / **尸体 ragdoll 关节 + RAGDOLL_FX 全分支**)已上线。
**正在做:接 Box2D(planck.js)** —— 反 / 选型 / 六步计划在 2.4 第 29 条;① 地形(多边形)② 形状图刚体 / 物品 / 崩塌块上 planck + 睡醒桥接 ④ 关节第一批(矿车 / 滑板 / 轮架 / 物理蘑菇 / 家具 / 钉墙轮)已上线;
**Box2D 尺度常数已反 exe 定稿(见 ④ 末):重力 12 m/s² = 72 px/s²、fixture 密度 = 材质 density 原值、关节力基准 = (mA+mB)×160**。④ 第二批(灯笼上关节 / 窗口外冻住 / 静止计时 / 物理蘑菇进真菌洞)、⑥ 尸体换 Box2D 关节、⑤ 碰撞伤害走接触(pre-solve → `rb.impact`)、挖掘场多体机械(静态机身 + 电机轮)也已上线;真机(iPhone)跑过没问题。下一步:⑤ 剩余(浮力按 buoyancy 0.7、go_through_sand、solid_on_collision_*)、PhysicsThrowable。设计介绍页 `noita-design.html`(纯静态,未进构建入口)。
**线上证书过期**(见 `docs/ssl-cert-renewal.md`),用户在阿里云走免费证书流程中(手机验证码未收到卡住);冒烟用 `$env:ORIGIN_IP='8.162.5.160'; $env:IGNORE_CERT='1'` + https URL 直连(http 已被 301)。

**先读**:本文档 → `src/noita-map/README.md`(模块全貌 + 每一步的实现细节表)→ `docs/ai-guide.md §10`(服务器 / 部署 / 日志)。原版数据在 `noita-ref/unpacked/`(data.wak 解包件,`node scripts/unpack-wak.mjs <wak> extract noita-ref/unpacked <substr>` 可补解包),存档真值在 `noita-ref/save-truth/`。

**跑起来**:`npx vite --host --port 5177`(用 `Start-Process cmd -ArgumentList '/c npx vite --host --port 5177'` 后台起,ERR_CONNECTION_REFUSED 就重启);
页面 `http://localhost:5177/noita-play.html`(可玩)/ `noita-map.html`(地图查看器,带真值对照)。调试对象 `window.__np`(play)/ `window.__nm`(map)。

**验证**:`scripts/_noita-*-shot.mjs` 是 Playwright 探针(msedge headless),每个子系统一个:surface / water / entities / props / death / ai / ai2 / climb / wand / items / biome-play(传送到任意群系)。
群系材质对真值:`_noita-biome-hist.mjs x,y`。写新探针照抄一个即可;截图落 `%TEMP%`,用 Read 工具看图。
群系纵向布局(chunk 行,世界 y = (行−14)×512):coalmine 14~15 · temple 16 · excavationsite 17~18(x 31~38,左邻 fungicave 28~30)· temple 19 · snowcave 20~22 · temple 23 · snowcastle 24~25 …(`_biome-map-dump.mjs` 打印整张群系图)。

**资源重生成**:`node scripts/noita-prepare-assets.mjs`(材质/布景/植被/天空)· `noita-prepare-projectiles.mjs`(弹)· `noita-prepare-entities.mjs`(敌人/道具/物品)· `noita-prepare-wands.mjs`(法术/法杖)· `noita-prepare-perks.mjs`(特权)· `noita-prepare-player.mjs`。
圣山探针 `_noita-temple-shot.mjs [x,y] [url]`(传送进圣山 → 列商店 / 灯 / 生成点 → 给钱买一件 → 开编辑器 → 拿一个特权,四张截图);
憋气 / 死亡画面 `_noita-drown-shot.mjs [url]`(出生地挖坑灌水 → 逐秒记气 / 血 → 死亡画面 → 点回出生点);
lukki 蜘蛛 `_noita-lukki-shot.mjs [lukki|longleg|tiny|eggs|jungle] [url]`(出生地放一只看腿 / 追 / 刺 / 打死,`jungle` 传送到丛林找真生成的;`-z*.png` 是 4 倍放大截图);
玩法 UI `_noita-ui-shot.mjs [pc|touch|all] [url]`(指引 / 引导 / 背包只读 / 踢 / 暂停 / 底栏 / 手机动作键;测"背包只读"要带 `&free=0`);
尸体 / RAGDOLL_FX 全分支 `_noita-ragdoll-shot.mjs [url]`(石台上放怪打死:NORMAL 关节数 / 断裂 / 包围盒 / 入睡 / meat 格数,BLOOD_EXPLOSION、BLOOD_SPRAY、FROZEN、DISINTEGRATED、火烧死,8 倍放大截图 `ragdoll-*.png`);黑洞 `_noita-blackhole-shot.mjs [url]`;怪物随区块重刷 `_noita-tp-spawn-shot.mjs [url]`;走路 AI(跳台子 / 埋住不动 / 1px 地板)`_noita-ai-stuck-shot.mjs [url]`;自由模式 `_noita-free-shot.mjs [url]`;圣山崩塌 + 存档 `_noita-collapse-shot.mjs [url]`;圣山入口传送门 `_noita-portal-shot.mjs [url]`;商店件数 `_noita-shopcount-shot.mjs [count]`(setGlobals 后传送圣山数货);圣山守卫 `_noita-steve-shot.mjs [url]`(检查区材质直方图 → 挪一件货出框 → Stevari 出现追人开火 → 新页挖穿顶砖;输出里有中文提示,在 PowerShell 里请 `> file` 再看)。
调研脚本 `_survey-entities.mjs`、`_dump-spawn-tables.mjs`、`_dump-biome-mats.mjs`、`_dump-wands.mjs`、`_fit-surface.mjs`。

**上线**:`npm run build:noita; tar -czf dist-noita.tar.gz -C dist-noita .; $env:DEPLOY_PW='<密码,文档不存,新会话向用户要>'; python scripts/_deploy.py noita`,
然后用 Playwright 打 `https://update.cocoaihj.com/updatesoft/noita/noita-play.html?log=0&v=<时间戳>` 冒烟。玩家日志 `node scripts/noita-logs.mjs`。
**证书**:`*.cocoaihj.com` 的泛域名证书(2026-03-05 签,半年期)在 **2026-09-04 07:59:59 到期**,之后浏览器全部 ERR_CERT_DATE_INVALID;主机 8.162.5.160 只监听 :80(docker-proxy),
TLS 在前面的阿里云 CDN 上终结,要去云控制台续证书,服务器上改不了。续签步骤、进度和证书没好之前怎么冒烟见 `docs/ssl-cert-renewal.md`
(`$env:ORIGIN_IP='8.162.5.160'` + `http://` URL 直连源站;或 `$env:IGNORE_CERT='1'` 忽略证书走 CDN)。

**代码地图**(`src/noita-map/`):`World.js` 区块生成(地表 / 布景 / 散件 / 生成点)· `core/scenes.js` 标记色→布景/光/实体表 · `core/staticScenes.js` 整图布景 / 全局 spliced / 藤蔓 ·
`core/bands.js` 材质带 · `sim/CellSim.js` 元胞自动机(障碍盒 = 玩家)· `render/ChunkPainter.js` 位图 · `worker/*` 流式加载 · `Entities.js` 怪/刚体/物品 · `RigidBody.js` 像素刚体 ·
`ProjectileSystem.js` 弹/爆炸 · `Wands.js` 法杖/法术 · `Sky.js` 视差天空 · `PlayerSprite.js` · `Sfx.js` · `OpLog.js`;玩家逻辑 / HUD / 触屏在 `src/demo/noitaPlay.js`。

**约束**:数值只从 xml/lua 抽,不拍脑袋;位置用 NollaPrng(SetRandomSeed / ProceduralRandom)保证种子确定;一切进 `chunk.mat` 当真材质;手机 60fps(iPhone 实测口径:模拟 <3ms、区块常驻 ≤48)。
用户偏好:横屏手机优先、"和原版一模一样"、每做完一步就部署并给出实测数据、有疑问先查原版数据再问。

---

## 3. 移植原则(和地图模块一致)

- **参数全部来自 xml**,`<Base file>` 合并后抽 json,代码里不出现魔法数。
- **位置全部种子确定**(NollaPrng + ProceduralRandom),同一种子进同一区块看到同样的敌人/箱子。
- **一切都是材质像素**:血、油、肉块、箱子像素都进 `chunk.mat`,自然和火/水/爆炸反应,这是 Noita "融合"的本质,不做贴图假象。
- 手机预算:实体只在激活窗口(视口 + 1 区块)内更新;刚体像素碰撞按边缘像素采样。
