# 小说动画 Demo

## 启动

```bash
cd E:\soft\xiaoshuodongtai\web
npm install
npm run dev
```

打开 http://localhost:5177/

- **选章菜单**：第一章（播完自动衔接第二章）/ 第二章
- **暂停**：空格 / `P` / 左下角按钮
- **回选章**：`Esc` /「选章」按钮
- 快捷：`?ch=1` · `?ch=2` · `?ch=1&continue=0`（一章播完不续）

### 雨天积水 Demo（俯角等距 2D）

地图重构前的技术验证页（不进主剧本）：

```
http://localhost:5177/rain-demo.html
```

- `WASD` / 点地图：移动角色
- `R`：开关雨 · `P`：开关积水
- 管线：雨滴粒子 → 落地飞溅 → 积水造波 → 水波 RT → 倒影/折射扰动

## 核心架构

| 层 | 职责 |
|---|---|
| **Director** | 总调度；`position` / `action` / `effect` 三分 |
| **Camera** | cut / pan / focus / follow |
| Character | Spine 走位 |
| Dialogue | 头顶气泡 + 左上旁白 |
| Effect | jineng/seffect（3.5→3.8 中间件） |

## 技术栈

| 模块 | 方案 |
|---|---|
| 渲染 | **PixiJS 5.3.12** |
| 骨骼 | **pixi-spine**（Spine **3.8**） |
| 角色 | `juese/` `.skel`（按 index 取皮） |
| 地图 | **M387 回合制背景**（远/中/近 · `floor` + `front`） |
| 驱动 | `chapter1.json` → `chapter2.json` |

## 资源

- `/res/juese` → `../juese`
- `/res/jineng` → `../jineng`
- `/res/spine` → `../spine`
- `/res/m387` → `../M387-1205`
- `/res/particles` → Kenney Particle Pack（CC0：爆炸/灰尘/射线/火焰/电/光/雪/雨）
