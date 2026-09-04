# 敌机阵型 & Boss 弹幕设计（对接文档）

> 把原游戏的**敌机出场阵型/队列**和**Boss 弹幕发射方式**整理成可对接的设计规范。
> 数据已导出到 `battle_spawn_data.json`（`node gen_battle_data.cjs` 生成）。原表在 `assets/data/`。

---

## 第一部分：敌机阵型 / 队列

### 1. 有多少种

`battleformation.tbl` 共 **145 个阵型**，按**种族**分 3 类：

| 种族(Type) | 数量 | 说明 |
|---|---|---|
| 人族(1) | 32 | Terran |
| 虫族(2) | 55 | Zerg |
| 魔灵(3) | 58 | Demon（部分带召唤/影子顺序） |

每个阵型平均出 **4.7 组怪**（范围 0~24 组）。

### 2. 阵型怎么描述（GroupDef 语法）

每个阵型是一串“出怪指令”，用 `;` 分隔，按顺序执行：

```
(怪物ID, 数量 @ 行进配置ID | 出生X, 出生Y) ;  (下一组) ;  数字(=延迟ms) ;  ...
```

- `(1321,1@10020|320,MAXHEIGHT+100)` = 出 1 只怪 1321，走位用配置 `10020`，出生在 (320, 屏幕高+100)（即从屏幕上方外侧进入）。
- 坐标可用表达式 `MAXHEIGHT` / `MAXWIDTH`（屏幕高/宽），如 `MAXHEIGHT+300` 表示在可视区上方 300px 处生成，然后按走位飞入。
- 单独一个数字（如 `500`）= 延迟 500ms 再出下一组（形成波次节奏）。

真实例（阵型#4，人族）：5 只怪从上方不同 X 依次飞入，各用不同走位配置。

### 3. 走位配置（`battlepluscfg.tbl`，敌机怎么飞）

每个出怪点引用一个走位配置。字段（运动模型）：

| 字段 | 含义 |
|---|---|
| Position 出生坐标 | 起始点 |
| Speed 初速度 `vx;vy` | px/s |
| Speed_acc 加速度 | px/s² |
| Omega 角速度 | deg/s（绕圆心旋转→绕圈/弧线进场） |
| Ct_delta 圆心相对坐标 | 旋转中心 |
| Delta_r 半径变化速度 | 半径收缩/扩张（螺旋进场） |
| Angle 初始角 / Alpha 透明度 | |

运动 = **直线(速度+加速度)** 叠加 **绕圆心旋转(Omega/半径变化)**。组合出：直线俯冲、斜插、绕弧、螺旋盘旋等进场方式。`Actiontype` 恒为 0（统一用这套参数化模型）。

### 4. 关卡怎么用阵型

`campaign.tbl` 每关有 `ConfigFile`（关卡波次配置），波次里按时间投放这些阵型；关卡的 `缺省怪物等级` 决定怪的血量（见 `敌人生命值与战斗数值设计.md`）。

---

## 第二部分：Boss 弹幕（发射子弹样式）

### 1. Boss 怎么组织攻击

`battlemonster.tbl` 里 Boss（死亡效果=704）共 **274 个**。每个 Boss 有：
- `MonsterSkill` = **技能列表**（如 幽幽谷主 = 技能 126|115|113|118），战斗中轮流/按 AI 释放；
- `CrazySkill` = **狂暴技能**（血量低于阈值触发）。

### 2. 每个技能 = 一种弹幕（`battleskill.tbl`）

关键字段：

| 字段 | 含义 |
|---|---|
| BulletPlan 弹幕方案 | **弹幕形状ID**（决定子弹排布：单发/扇/环/螺旋…） |
| BulletID 子弹 | 子弹视觉；可为组合 `"217(217,218)"`（母弹+分裂子弹） |
| TargetNum 目标/子弹数 | 一次发射的子弹数（99=密集弹幕） |
| Range 范围 `r|R` | 发射半径/作用范围 |
| Frequency 频率 | 发射间隔 ms |
| Duration 持续 | 持续时间 ms |
| IsCommon | 1=普攻，2=主动/大招 |

### 3. 子弹本身（`battleblt.tbl`）

| 字段 | 含义 |
|---|---|
| Model 模型 | `battlescene/bullet/*.png` 等 |
| **InheritPercent 属性继承** | **子弹伤害 = Boss攻击 × 该百分比** |
| IsThrough 穿透 / IsCollide 碰撞 / BoxSize 判定框 | |

### 4. 弹道运动模型（`battlebltcfg.tbl`，子弹怎么飞）

和敌机走位同一套参数（Speed/Accel/Omega/Delta_r/Center）。由参数组合出常见弹幕样式：

| 样式 | 参数特征 | 例 |
|---|---|---|
| 直线/瞄准 | 速度指向玩家，Omega≈0 | cfg106 速度(0,-400) |
| 扇形 | 多子弹不同发射角，同速度 | cfg101~106：(0,1800)(±500,866)(±258,966) = ±30/±60° |
| 环形 | N 子弹角度均分 360° | Omega=0，逐发 +360/N |
| 螺旋 | 持续发射 + Omega 每发转角 | Omega=140 |
| 加速/减速 | Speed_acc≠0 | cfg1 加速(10,-25) |

> **注意**：`BulletPlan` 共 **1069 种**，多数是**引擎脚本里定义的弹幕形状**（只有少数命中数据表），精确几何在游戏代码里。但实战里 99% 就是上面 5 种样式的组合，用第 3 部分公式即可复刻。

---

## 第三部分：程序对接（`battle_spawn_data.json`）

### JSON 结构

```jsonc
{
  "formations": [ { "id":4, "race":"人族", "type":1, "comment":"...",
    "groups":[ { "monster":1321, "count":1, "path":10020, "x":"320", "y":"MAXHEIGHT+100" },
               { "delay":500 } ] } ],
  "moveCfg":   [ { "id":10020, "speed":"vx;vy", "accel":"ax;ay", "omega":deg, "deltaR":n, "center":"cx;cy", "angle":a } ],
  "bulletCfg": [ { "id":101, "speed":"0;1800", "omega":140, ... } ],
  "bullets":   { "21": { "model":"...", "inherit":1, "through":0, "box":"80;80" } },
  "skills":    { "126": { "plan":"82", "bullet":"21", "num":"1", "freq":500, "dur":1000, "isCommon":1 } },
  "bosses":    [ { "id":107, "name":"幽幽谷主", "skills":[126,115,113,118], "crazy":"220" } ]
}
```

### 阵型生成（波次刷怪）

```js
import BD from './battle_spawn_data.json'
const SCREEN={w:720,h:1280}
function evalXY(s){ return Number(String(s).replace('MAXWIDTH',SCREEN.w).replace('MAXHEIGHT',SCREEN.h)) || 0 }
async function playFormation(fid, spawn){
  const f = BD.formations.find(x=>x.id===fid)
  for(const g of f.groups){
    if(g.delay){ await sleep(g.delay); continue }
    const cfg = BD.moveCfg.find(c=>c.id===g.path)   // 走位
    for(let i=0;i<g.count;i++) spawn(g.monster, evalXY(g.x), evalXY(g.y), cfg)
  }
}
// 敌机每帧走位(直线+绕圆心)：
function stepMove(e, cfg, dt){
  const [vx,vy]=cfg.speed.split(';').map(Number), [ax,ay]=cfg.accel.split(';').map(Number)
  e.vx+=ax*dt; e.vy+=ay*dt; e.x+=(e.vx||vx)*dt; e.y+=(e.vy||vy)*dt
  if(cfg.omega){ /* 绕 center 以 omega(deg/s) 旋转，半径按 deltaR 变化 */ }
}
```

### Boss 弹幕发射（用常见样式复刻 plan）

```js
function bossFire(boss, skillId, aimAngle){
  const sk = BD.skills[skillId]; const bl = BD.bullets[sk.bullet.split('(')[0]]
  const dmg = boss.atk * (bl?bl.inherit:1)            // 子弹伤害
  const n = Math.min(+sk.num||1, 40)
  // 按 plan 归类到常见样式(自定映射)：扇形/环形/螺旋/瞄准
  const style = classifyPlan(sk.plan)                 // 'aim'|'fan'|'ring'|'spiral'
  const shots=[]
  if(style==='aim')   shots.push(aimAngle)
  else if(style==='fan'){ const spread=Math.PI/3; for(let i=0;i<n;i++) shots.push(aimAngle - spread/2 + spread*i/(n-1||1)) }
  else if(style==='ring'){ for(let i=0;i<n;i++) shots.push(i*2*Math.PI/n) }
  else if(style==='spiral'){ shots.push(boss._spin=(boss._spin||0)+0.3) } // 每次发射转一点
  for(const a of shots) spawnBullet(boss.x,boss.y, Math.cos(a), Math.sin(a), sk.bulletSpeed||600, dmg, bl)
  // 频率 sk.freq、持续 sk.dur 控制连发
}
```

`classifyPlan` 可先用一个映射表（按 plan 段位/常见值）粗分；要精确还原某个 plan 的确切轨迹，需读引擎脚本（本项目未包含）。demo 用上面 4 种样式已足够还原手感。

---

## 附：交付文件

| 文件 | 内容 |
|---|---|
| `敌机阵型与Boss弹幕设计.md` | 本文档 |
| `battle_spawn_data.json` | 阵型(145)+走位/弹道配置+子弹+技能(4596)+Boss(274) |
| `gen_battle_data.cjs` | 导出脚本（改表重导用） |

> 敌人血量/我方攻击数值见 `敌人生命值与战斗数值设计.md`；敌人/Boss 外观动画见 `敌人动画.html`。
