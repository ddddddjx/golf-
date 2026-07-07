# TR4CE ⛳ — Golf Shot Tracer 高尔夫轨迹追踪

一个 **零依赖、纯前端** 的高尔夫球路轨迹 mini app。合成波霓虹 (synthwave) 视觉风格，
专为让人想截图 / 录屏分享而设计 🎥✨

A zero-dependency, pure front-end golf shot tracer mini app with a synthwave
neon aesthetic, built to be screenshotted and shared.

## ✨ 功能 Features

- 🏌️ **两段式击球手感** — 按住 `SWING` 蓄力，松开锁定力量；再点一下锁定弧线 (DRAW ◀ ▶ FADE)
- 🌈 **霓虹球路轨迹** — 伪 3D 透视球道 + 发光渐变轨迹 + 落地冲击波与粒子特效
- 📐 **真实飞行物理** — 二次阻力 + 马格努斯效应（后旋升力 / 侧旋弯曲）+ 弹跳与滚动，
  一号木 ~250 码、7 铁 ~175 码，右曲球真的会往右拐
- 🍌 **球型自动判定** — PURE / DRAW / FADE / SLICE / HOOK / PUSH / PULL 及组合
  （如 PUSH SLICE 右推大右曲），配 Gen Z 风格锐评文案
- 📊 **完整数据** — CARRY 码数、TOTAL、弹道高、球速 mph、滞空时间、侧曲码数
- 🗺️ **迷你视图** — 俯视 (TOP) + 侧视 (SIDE) 实时轨迹小窗
- 📸 **一键战绩卡** — 生成 1080×1920 竖版分享图，直接走系统分享或下载
- 🎥 **回放视频** — MediaRecorder 录制飞行回放 (mp4/webm)，发群里炫耀
- 🏆 **PB 记录 + 历史** — localStorage 保存最远纪录与最近 12 杆
- 📳 音效 (WebAudio 合成) + 震动反馈 + 破纪录彩带

## 🚀 运行 Run

无需构建、无需依赖：

```bash
# 任意静态服务器
python3 -m http.server 8080
# 打开 http://localhost:8080
```

或直接双击 `index.html`（所有脚本均为普通 script，非 ES module，file:// 也能跑）。
手机体验最佳 📱，桌面端可用空格键操作。

## 🕹️ 玩法 How to play

1. 选杆（DR / 3W / 5i / 7i / 9i / PW）
2. **按住** `SWING` — 力量表往返摆动，松开锁定力量
3. **再点一下** — 弧线标记左右扫动，点击锁定（左=DRAW 右=FADE，拉满就是香蕉球 🍌）
4. 看着球飞，落地后查看判定 + 数据，一键生成战绩卡 / 回放视频分享

## 🧱 结构 Structure

```
index.html        入口
css/style.css     霓虹 UI
js/physics.js     飞行物理仿真 + 球型判定 (可在 node 中单测)
js/render.js      合成波场景渲染 (透视网格 / 太阳 / 发光轨迹)
js/share.js       战绩卡生成 + 回放视频录制
js/app.js         状态机 / 交互 / 特效 / HUD
```

物理引擎可独立验证：

```bash
node -e "const P=require('./js/physics.js');console.log(P.simulate({ballSpeed:78,launchDeg:12.5,startDeg:0,backspin:2500,sidespin:0}).carryYd)"
```
