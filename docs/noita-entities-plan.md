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
  仍跳过:家具 / 物理蘑菇的多体关节(家具已取第一块形状图)、多体机械 excavationsite_machine_3b/3c、门。
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

---

## 2.5 接手指南(新会话从这里开始)

**仓库**:`https://github.com/yinyuan1990/noita-web.git`(main;2026-09-04 首推,`.gitignore` 排除 node_modules / dist* / noita-ref / scripts/out / scripts/shots)。
本机 `git config http.proxy socks5h://127.0.0.1:2801`(用户的本地代理是 SOCKS5,走 http:// 会超时)。`noita-ref/`(原版解包数据 + 存档真值)不在仓库里,只在本机 `e:\soft\xiaoshuodongtai\web\noita-ref`。
**当前状态(2026-09-04 18:00)**:主线 + 非主线全部群系、圣山全套(商店 / 特权 / 守卫 / 入口传送门 / 出口崩塌 / 诅咒)、玩法闭环 UI(导航 / 引导 / 背包 / 踢 / 暂停 / 滚轮 / 手游布局)、存档、趟沙全部上线。
**线上证书过期**(见 `docs/ssl-cert-renewal.md`),用户在阿里云走免费证书流程中(手机验证码未收到卡住);此前冒烟用 `$env:ORIGIN_IP='8.162.5.160'` 直连源站。

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
玩法 UI `_noita-ui-shot.mjs [pc|touch|all] [url]`(指引 / 引导 / 背包只读 / 踢 / 暂停 / 底栏 / 手机动作键);圣山崩塌 + 存档 `_noita-collapse-shot.mjs [url]`;圣山入口传送门 `_noita-portal-shot.mjs [url]`;商店件数 `_noita-shopcount-shot.mjs [count]`(setGlobals 后传送圣山数货);圣山守卫 `_noita-steve-shot.mjs [url]`(检查区材质直方图 → 挪一件货出框 → Stevari 出现追人开火 → 新页挖穿顶砖;输出里有中文提示,在 PowerShell 里请 `> file` 再看)。
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
