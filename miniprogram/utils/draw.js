/**
 * TR4CE — 轨迹叠加绘制。
 * 相机预览/视频均为 aspectFill(cover) 显示, 这里统一做归一化坐标 → 屏幕坐标映射,
 * 并绘制「白热核心 + 琥珀光晕」的彗星式描迹。
 */
'use strict';

const ACCENT = '#ff8a3c';   // 光晕
const CORE = '#ffffff';     // 核心

/** cover 映射: 帧宽高比 frameAspect(w/h) 的画面铺满 cw×ch 画布 */
function coverMapper(frameAspect, cw, ch) {
  const canvasAspect = cw / ch;
  let dw, dh; // 画面在画布坐标系下的显示尺寸
  if (frameAspect > canvasAspect) { dh = ch; dw = ch * frameAspect; }
  else { dw = cw; dh = cw / frameAspect; }
  const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
  return (nx, ny) => [ox + nx * dw, oy + ny * dh];
}

/** Catmull-Rom 平滑取样, 让描迹圆润 */
function smoothPath(pts) {
  if (pts.length < 3) return pts.slice();
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 0; j < 4; j++) {
      const u = j / 4, u2 = u * u, u3 = u2 * u;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * 绘制描迹。
 * @param ctx canvas 2d context (已按 dpr 缩放)
 * @param screenPts [{x,y}] 屏幕坐标轨迹(到当前时刻为止)
 * @param opts {headGlow: 是否绘制头部光点, alpha}
 */
function drawTracer(ctx, screenPts, opts) {
  const o = Object.assign({ headGlow: true, alpha: 1 }, opts || {});
  if (screenPts.length < 2) return;
  const P = smoothPath(screenPts);
  const head = P[P.length - 1];

  ctx.save();
  ctx.globalAlpha = o.alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y);
  };

  // 外层光晕
  ctx.strokeStyle = 'rgba(255,138,60,0.30)';
  ctx.lineWidth = 12;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 18;
  path(); ctx.stroke();

  // 中层
  ctx.shadowBlur = 8;
  ctx.strokeStyle = 'rgba(255,170,90,0.75)';
  ctx.lineWidth = 5;
  path(); ctx.stroke();

  // 白热核心
  ctx.shadowBlur = 0;
  ctx.strokeStyle = CORE;
  ctx.lineWidth = 2;
  path(); ctx.stroke();

  // 头部光点
  if (o.headGlow) {
    const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 14);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,200,140,0.8)');
    g.addColorStop(1, 'rgba(255,138,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

module.exports = { coverMapper, drawTracer, smoothPath, ACCENT };
