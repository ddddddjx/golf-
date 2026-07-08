/**
 * TR4CE — 轨迹分析: 由像素轨迹估算 路径长度 / 起飞角度 / 球型。
 * 所有输出均为「基于画面几何 + 飞行物理仿真」的估算值。
 */
'use strict';

const physics = require('./physics.js');
const RAD = Math.PI / 180;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

/** 3 点滑动平均去抖 */
function smooth(pts) {
  if (pts.length < 5) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    out.push({
      x: (pts[i - 1].x + pts[i].x + pts[i + 1].x) / 3,
      y: (pts[i - 1].y + pts[i].y + pts[i + 1].y) / 3,
      t: pts[i].t,
    });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 相对首末连线(弦)的最大带符号横向偏移, 正 = 画面右侧 */
function lateralDeviation(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  const cx = b.x - a.x, cy = b.y - a.y;
  const cl = Math.hypot(cx, cy) || 1e-6;
  let maxAbs = 0, signed = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    // 图像坐标 y 向下; cross > 0 表示点在弦行进方向左手边(屏幕上偏右取反,详见符号推导)
    const cross = (cx * (pts[i].y - a.y) - cy * (pts[i].x - a.x)) / cl;
    if (Math.abs(cross) > maxAbs) { maxAbs = Math.abs(cross); signed = cross; }
  }
  // 球向上飞(cy<0)时, cross>0 即画面右侧
  return { dev: cy < 0 ? signed : -signed, chord: cl };
}

const TYPES = {
  PURE:  { name: 'PURE',  zh: '笔直球',   emoji: '🎯', color: '#4cc9f0' },
  DRAW:  { name: 'DRAW',  zh: '小左曲',   emoji: '✨', color: '#b5a7ff' },
  FADE:  { name: 'FADE',  zh: '小右曲',   emoji: '🌤', color: '#9bd16e' },
  HOOK:  { name: 'HOOK',  zh: '大左曲',   emoji: '🪝', color: '#ff6b9d' },
  SLICE: { name: 'SLICE', zh: '大右曲',   emoji: '🍌', color: '#ffb054' },
  PULL:  { name: 'PULL',  zh: '左拉球',   emoji: '⬅️', color: '#ffd166' },
  PUSH:  { name: 'PUSH',  zh: '右推球',   emoji: '➡️', color: '#ffd166' },
};

/** 由画面弯曲程度判定球型 (从球后方拍摄: 画面左右 ≈ 目标线左右) */
function classifyImage(devRatio, driftRatio) {
  if (Math.abs(devRatio) < 0.018) {
    if (driftRatio > 0.22) return TYPES.PUSH;
    if (driftRatio < -0.22) return TYPES.PULL;
    return TYPES.PURE;
  }
  if (devRatio > 0.055) return TYPES.SLICE;
  if (devRatio > 0) return TYPES.FADE;
  if (devRatio < -0.055) return TYPES.HOOK;
  return TYPES.DRAW;
}

/**
 * @param pts 竖屏归一化轨迹 [{x,y,t}] (y 向下, t 毫秒)
 * @param opts {camDistM 机位距球米数, fovVdeg 竖向视场角, aspect 帧宽高比 w/h}
 */
function analyze(pts, opts) {
  const o = Object.assign({ camDistM: 3, fovVdeg: 52, aspect: 0.75 }, opts || {});
  if (!pts || pts.length < 6) return null;
  const P = smooth(pts);

  // 球平面处的实际尺度: 整个画面高对应多少米
  const mH = 2 * o.camDistM * Math.tan((o.fovVdeg / 2) * RAD);
  const mW = mH * o.aspect;
  const M = P.map(p => ({ x: p.x * mW, y: (1 - p.y) * mH, t: p.t })); // 米, y 向上

  // 画面内轨迹长度(球平面尺度, 是真实路径的下限)
  let pathLenM = 0;
  for (let i = 1; i < M.length; i++) pathLenM += Math.hypot(M[i].x - M[i - 1].x, M[i].y - M[i - 1].y);

  // 初速度与起飞角: 取前几个点做差分
  const K = Math.min(6, M.length);
  let dtS = (M[K - 1].t - M[0].t) / 1000;
  if (!(dtS > 0.01)) dtS = (K - 1) / 30; // 时间戳异常时按 30fps 兜底
  const vx = (M[K - 1].x - M[0].x) / dtS;
  const vy = (M[K - 1].y - M[0].y) / dtS;
  const v0 = Math.hypot(vx, vy);
  const launchDeg = Math.atan2(vy, Math.abs(vx) + 1e-6) / RAD; // 画面起飞角(相对水平线)

  const flightMs = M[M.length - 1].t - M[0].t;

  // 球型: 归一化坐标系里的弯曲与漂移。
  // 注意: 后段加速弯曲的轨迹, 其中段点凸向弦的"反侧",
  // 因此弯曲方向 = 相对弦偏移的反号。
  const { dev, chord } = lateralDeviation(P);
  const curveRatio = -dev / (chord || 1e-6);
  const driftRatio = (P[P.length - 1].x - P[0].x) / (chord || 1e-6);
  const type = classifyImage(curveRatio, driftRatio);

  // 估算全程: 用测得初速/起飞角喂给飞行物理仿真
  const simLaunch = clamp(launchDeg, 6, 42);
  const simSpeed = clamp(v0, 12, 85);
  const backspin = clamp(8200 - simSpeed * 62, 2200, 9000);
  const sidespin = clamp(curveRatio * 26000, -3200, 3200);
  const sim = physics.simulate({
    ballSpeed: simSpeed, launchDeg: simLaunch, startDeg: 0,
    backspin, sidespin,
  });

  return {
    pathLenM: Math.round(pathLenM * 10) / 10,     // 画面内轨迹长度(米)
    launchDeg: Math.round(launchDeg * 10) / 10,   // 起飞角(°)
    v0Kmh: Math.round(v0 * 3.6),                  // 出球速度(km/h, 估算)
    flightMs,
    carryEstM: Math.round(sim.carryYd * 0.9144),  // 估算飞行距离(米)
    carryEstYd: Math.round(sim.carryYd),
    apexEstM: Math.round(sim.apexM),
    curveRatio: Math.round(curveRatio * 1000) / 1000,
    type,
  };
}

module.exports = { analyze, classifyImage, TYPES };
