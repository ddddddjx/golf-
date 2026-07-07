/* TR4CE — synthwave scene renderer (attaches to window.GolfRender) */
(function () {
  'use strict';

  const C = {
    bgTop: '#05010f',
    bgMid: '#160530',
    bgHor: '#3c0a5e',
    groundTop: '#12032b',
    groundBot: '#05010f',
    cyan: '#19e3ff',
    magenta: '#ff2d78',
    purple: '#7b5cff',
    lime: '#b6ff2d',
    amber: '#ffb02d',
  };

  const HOR = 0.40;      // horizon (fraction of H)
  const CAM_D = 14;      // camera distance behind tee (m)
  const CAM_H = 2.6;     // camera height (m)
  const YD = 1.09361;

  function proj(x, y, z, W, H) {
    const s = (H * 1.15) / (z + CAM_D);
    return { x: W / 2 + x * s, y: HOR * H + (CAM_H - y) * s, s };
  }

  // --- deterministic stars ---
  function makeStars(n) {
    const st = [];
    let seed = 1337;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      st.push({ x: rnd(), y: rnd() * 0.92, r: 0.6 + rnd() * 1.4, ph: rnd() * 6.28, sp: 0.5 + rnd() * 2 });
    }
    return st;
  }
  const STARS = makeStars(110);

  function drawSky(ctx, W, H, time) {
    const g = ctx.createLinearGradient(0, 0, 0, HOR * H);
    g.addColorStop(0, C.bgTop);
    g.addColorStop(0.62, C.bgMid);
    g.addColorStop(1, C.bgHor);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HOR * H + 1);

    // stars
    for (const s of STARS) {
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * s.sp + s.ph));
      ctx.globalAlpha = tw * 0.9;
      ctx.fillStyle = '#cfe9ff';
      ctx.fillRect(s.x * W, s.y * HOR * H, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawSun(ctx, W, H, time) {
    const cx = W / 2, cy = HOR * H, r = Math.max(60, Math.min(W * 0.24, 190));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, cy);
    ctx.clip();

    const g = ctx.createLinearGradient(0, cy - r, 0, cy + r * 0.2);
    g.addColorStop(0, '#ffd60a');
    g.addColorStop(0.55, C.magenta);
    g.addColorStop(1, C.purple);
    ctx.shadowColor = C.magenta;
    ctx.shadowBlur = 60;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // synthwave scanline gaps, slowly drifting
    ctx.fillStyle = C.bgHor;
    const drift = (time * 6) % 14;
    for (let i = 0; i < 6; i++) {
      const yy = cy - i * 14 - drift;
      const hh = 2 + i * 1.6;
      if (yy > cy - r) {
        ctx.globalAlpha = 0.9;
        ctx.fillRect(cx - r, yy, r * 2, hh);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // horizon glow line
    ctx.strokeStyle = C.cyan;
    ctx.shadowColor = C.cyan;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, cy + 0.5);
    ctx.lineTo(W, cy + 0.5);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawGround(ctx, W, H, time) {
    const hy = HOR * H;
    const g = ctx.createLinearGradient(0, hy, 0, H);
    g.addColorStop(0, C.groundTop);
    g.addColorStop(1, C.groundBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, hy, W, H - hy);

    ctx.lineWidth = 1;

    // longitudinal grid lines (converge to vanishing point)
    for (let gx = -42; gx <= 42; gx += 6) {
      const a = proj(gx, 0, 0, W, H);
      const b = proj(gx, 0, 900, W, H);
      const grad = ctx.createLinearGradient(0, a.y, 0, b.y);
      grad.addColorStop(0, 'rgba(123,92,255,0.16)');
      grad.addColorStop(1, 'rgba(25,227,255,0.42)');
      ctx.strokeStyle = grad;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // cross lines flowing toward the viewer
    const flow = (time * 3.2) % 10;
    for (let z = -flow + 2; z < 420; z += 10) {
      if (z <= -CAM_D + 1) continue;
      const p = proj(0, 0, z, W, H);
      const e = proj(46, 0, z, W, H);
      const alpha = Math.min(0.34, 2.4 / (z * 0.14 + 1));
      ctx.strokeStyle = `rgba(25,227,255,${alpha.toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(W / 2 - (e.x - W / 2), p.y); ctx.lineTo(e.x, p.y); ctx.stroke();
    }
  }

  function drawYardMarkers(ctx, W, H) {
    ctx.textAlign = 'left';
    let lastLabelY = Infinity; // labels converge near the horizon; skip crowded ones
    for (const yd of [50, 100, 150, 200, 250, 300]) {
      const z = yd / YD;
      const l = proj(-30, 0, z, W, H);
      const r = proj(30, 0, z, W, H);
      ctx.strokeStyle = 'rgba(255,45,120,0.5)';
      ctx.shadowColor = C.magenta;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.stroke();
      ctx.shadowBlur = 0;

      const fs = Math.max(10, Math.min(11 + l.s * 0.55, 26));
      if (lastLabelY - r.y >= fs + 4) {
        ctx.font = `700 ${fs}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText(`${yd}`, r.x + 6, r.y + fs * 0.35);
        lastLabelY = r.y;
      }
    }
    ctx.textAlign = 'start';
  }

  // cache projected trail per canvas size
  function projectTrail(shot, W, H) {
    const key = W + 'x' + H;
    if (shot._projKey !== key) {
      shot._proj = shot.pts.map(p => proj(p.x, p.y, p.z, W, H));
      shot._projKey = key;
    }
    return shot._proj;
  }

  function drawTrail(ctx, W, H, shot, idx, glowPulse) {
    const P = projectTrail(shot, W, H);
    const n = Math.max(2, Math.min(Math.floor(idx) + 1, P.length));
    const head = P[n - 1];
    const grad = ctx.createLinearGradient(P[0].x, P[0].y, head.x, head.y);
    grad.addColorStop(0, C.cyan);
    grad.addColorStop(0.6, C.purple);
    grad.addColorStop(1, C.magenta);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const path = new Path2D();
    path.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < n; i++) path.lineTo(P[i].x, P[i].y);

    // glow pass
    ctx.save();
    ctx.globalAlpha = 0.4 * (glowPulse == null ? 1 : glowPulse);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 9;
    ctx.shadowColor = C.magenta;
    ctx.shadowBlur = 22;
    ctx.stroke(path);
    ctx.restore();

    // core pass
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.6;
    ctx.stroke(path);
    ctx.globalAlpha = 1;

    // hot head segment
    const h0 = Math.max(0, n - 14);
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.shadowColor = C.cyan;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(P[h0].x, P[h0].y);
    for (let i = h0 + 1; i < n; i++) ctx.lineTo(P[i].x, P[i].y);
    ctx.stroke();
    ctx.restore();

    return head;
  }

  function drawBall(ctx, p) {
    const r = Math.max(2.6, p.s * 0.10 + 2.4);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(25,227,255,0.35)');
    g.addColorStop(1, 'rgba(25,227,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 3.2, 0, 6.29);
    ctx.fill();
  }

  function drawTee(ctx, W, H, time) {
    const p = proj(0, 0.05, 0, W, H);
    const pulse = 0.7 + 0.3 * Math.sin(time * 2.4);
    ctx.save();
    ctx.globalAlpha = pulse;
    drawBall(ctx, { x: p.x, y: p.y, s: p.s * 0.6 });
    ctx.restore();
  }

  function drawAimPreview(ctx, W, H, face, time) {
    const startDeg = face * 4.2;
    const curveM = face * 34;
    ctx.save();
    ctx.setLineDash([7, 9]);
    ctx.lineDashOffset = -time * 40;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.shadowColor = C.cyan;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const f = i / 24;
      const z = f * 195;
      const x = Math.tan(startDeg * Math.PI / 180) * z + curveM * f * f;
      const p = proj(x, 0, z, W, H);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Full scene. opts: {time, shot, idx, aimFace, ballVisible, glowPulse} */
  function drawScene(ctx, W, H, o) {
    drawSky(ctx, W, H, o.time);
    drawSun(ctx, W, H, o.time);
    drawGround(ctx, W, H, o.time);
    drawYardMarkers(ctx, W, H);

    if (o.aimFace != null) drawAimPreview(ctx, W, H, o.aimFace, o.time);

    if (o.shot && o.idx > 0) {
      const head = drawTrail(ctx, W, H, o.shot, o.idx, o.glowPulse);
      if (o.ballVisible !== false) drawBall(ctx, head);
    } else {
      drawTee(ctx, W, H, o.time);
    }
  }

  window.GolfRender = { drawScene, drawTrail, drawBall, proj, projectTrail, C, HOR };
})();
