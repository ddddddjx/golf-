/**
 * TR4CE — 高尔夫球运动目标追踪器（纯 JS，可在 node 中单测）
 *
 * 输入: 相机 RGBA 帧 (onCameraFrame)。内部降采样为灰度图后做帧差,
 * 用「小而快、方向一致」的运动块启动追踪, 之后按速度预测 + 最近邻关联,
 * 输出球的像素轨迹点序列。
 */
'use strict';

const PROC_MAX = 160; // 处理分辨率上限（长边）

/** 在二值 mask 上找连通块（BFS 泛洪） */
function findBlobs(mask, w, h, maxBlobs) {
  const visited = new Uint8Array(w * h);
  const blobs = [];
  const qx = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || visited[i]) continue;
    let head = 0, tail = 0;
    qx[tail++] = i; visited[i] = 1;
    let size = 0, sx = 0, sy = 0;
    let minx = w, maxx = 0, miny = h, maxy = 0;
    while (head < tail && size < 400) {
      const c = qx[head++];
      const cx = c % w, cy = (c / w) | 0;
      size++; sx += cx; sy += cy;
      if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
      if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
      // 4-邻域
      if (cx > 0 && mask[c - 1] && !visited[c - 1]) { visited[c - 1] = 1; qx[tail++] = c - 1; }
      if (cx < w - 1 && mask[c + 1] && !visited[c + 1]) { visited[c + 1] = 1; qx[tail++] = c + 1; }
      if (cy > 0 && mask[c - w] && !visited[c - w]) { visited[c - w] = 1; qx[tail++] = c - w; }
      if (cy < h - 1 && mask[c + w] && !visited[c + w]) { visited[c + w] = 1; qx[tail++] = c + w; }
    }
    // 球在处理分辨率下是 2~60 像素的紧凑小块; 大块(人/杆身)与噪点都排除
    if (size < 2 || size > 60) continue;
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if (size / (bw * bh) < 0.22) continue; // 过于松散 → 不是实心球
    if (bw > 14 || bh > 14) continue;
    blobs.push({ x: sx / size, y: sy / size, size });
  }
  blobs.sort((a, b) => b.size - a.size);
  return blobs.slice(0, maxBlobs);
}

class BallTracker {
  constructor(opts) {
    this.o = Object.assign({
      diffThresh: 26,   // 帧差阈值
      minSpeed: 2.0,    // 启动所需最小帧间位移(处理像素)
      maxSpeed: 40,     // 最大帧间位移
      maxMiss: 7,       // 连续丢失多少帧判定结束
      minTrack: 8,      // 有效轨迹最少点数
      maxTrack: 140,
    }, opts || {});
    this.prev = null;
    this.pw = 0; this.ph = 0; this.stride = 1;
    this.hist = [];       // 扫描期最近 3 帧的 blob 列表
    this.track = [];      // [{x,y,t}]
    this.vx = 0; this.vy = 0;
    this.miss = 0;
    this.state = 'scanning'; // scanning | tracking | done
  }

  /** rgba: Uint8Array/Uint8ClampedArray, 帧尺寸 w×h, t: 毫秒时间戳 */
  process(rgba, w, h, t) {
    if (!this.pw) {
      this.stride = Math.max(1, Math.ceil(Math.max(w, h) / PROC_MAX));
      this.pw = Math.floor(w / this.stride);
      this.ph = Math.floor(h / this.stride);
      this.srcW = w; this.srcH = h;
    }
    if (this.state === 'done') return this._out();
    const pw = this.pw, ph = this.ph, st = this.stride;

    // 降采样灰度
    const g = new Uint8Array(pw * ph);
    for (let py = 0; py < ph; py++) {
      const rowOff = py * st * w;
      for (let px = 0; px < pw; px++) {
        const i = (rowOff + px * st) * 4;
        g[py * pw + px] = (rgba[i] * 3 + rgba[i + 1] * 4 + rgba[i + 2]) >> 3;
      }
    }
    if (!this.prev) { this.prev = g; return this._out(); }

    // 帧差二值化
    const mask = new Uint8Array(pw * ph);
    const th = this.o.diffThresh;
    const prev = this.prev;
    for (let i = 0; i < g.length; i++) {
      const d = g[i] - prev[i];
      if (d > th || d < -th) mask[i] = 1;
    }
    this.prev = g;

    const blobs = findBlobs(mask, pw, ph, 14);
    this.lastBlobs = blobs; // 调试用: 本帧候选运动块
    if (this.state === 'tracking') this._step(blobs, t);
    else this._scan(blobs, t);
    return this._out();
  }

  /** 扫描期: 连续 3 帧出现速度/方向一致的小块 → 启动追踪 */
  _scan(blobs, t) {
    this.hist.push({ blobs, t });
    if (this.hist.length > 3) this.hist.shift();
    if (this.hist.length < 3) return;
    const [A, B, C] = this.hist;
    let best = null;
    for (const b1 of A.blobs) {
      for (const b2 of B.blobs) {
        const v1x = b2.x - b1.x, v1y = b2.y - b1.y;
        const s1 = Math.hypot(v1x, v1y);
        if (s1 < this.o.minSpeed || s1 > this.o.maxSpeed) continue;
        for (const b3 of C.blobs) {
          const v2x = b3.x - b2.x, v2y = b3.y - b2.y;
          const s2 = Math.hypot(v2x, v2y);
          if (s2 < this.o.minSpeed || s2 > this.o.maxSpeed) continue;
          const ratio = s2 / s1;
          if (ratio < 0.45 || ratio > 2.2) continue;
          const dot = (v1x * v2x + v1y * v2y) / (s1 * s2);
          if (dot < 0.75) continue; // 方向变化 > ~40° 不是球
          // 偏好速度快且向上飞(图像 y 减小)的候选 —— 球离开画面通常向上
          const score = s1 + s2 - (v1y + v2y) * 0.5;
          if (!best || score > best.score) {
            best = {
              score,
              pts: [{ x: b1.x, y: b1.y, t: A.t }, { x: b2.x, y: b2.y, t: B.t }, { x: b3.x, y: b3.y, t: C.t }],
              vx: (v1x + v2x) / 2, vy: (v1y + v2y) / 2,
            };
          }
        }
      }
    }
    if (best) {
      this.state = 'tracking';
      this.track = best.pts;
      this.vx = best.vx; this.vy = best.vy;
      this.miss = 0;
      this.hist = [];
    }
  }

  /** 追踪期: 速度预测 + 门限内最近邻关联 */
  _step(blobs, t) {
    const last = this.track[this.track.length - 1];
    const px = last.x + this.vx, py = last.y + this.vy;
    const gate = Math.max(5, Math.hypot(this.vx, this.vy) * 1.7);
    let best = null, bd = Infinity;
    for (const b of blobs) {
      const d = Math.hypot(b.x - px, b.y - py);
      if (d < gate && d < bd) { bd = d; best = b; }
    }
    if (best) {
      const nvx = best.x - last.x, nvy = best.y - last.y;
      this.vx = this.vx * 0.55 + nvx * 0.45;
      this.vy = this.vy * 0.55 + nvy * 0.45 + 0.05; // 轻微重力先验
      this.track.push({ x: best.x, y: best.y, t });
      this.miss = 0;
      const nearEdge = best.x < 1.5 || best.x > this.pw - 2.5 || best.y < 1.5;
      if (this.track.length >= this.o.maxTrack || nearEdge) this._finish();
    } else if (++this.miss > this.o.maxMiss) {
      this._finish();
    }
  }

  _finish() {
    if (this.track.length >= this.o.minTrack) this.state = 'done';
    else { this.state = 'scanning'; this.track = []; this.hist = []; this.miss = 0; }
  }

  _out() {
    return { state: this.state, track: this.track, pw: this.pw, ph: this.ph };
  }

  /**
   * 输出竖屏归一化轨迹 (x,y ∈ 0..1)。
   * rotate: 相机帧相对预览的旋转 (0 | 90 | 270, 顺时针)。
   * 多数安卓机型 onCameraFrame 为横向帧, 需转 90。
   */
  result(rotate) {
    const pw = this.pw, ph = this.ph;
    const pts = this.track.map(p => {
      if (rotate === 90) return { x: (ph - 1 - p.y) / ph, y: p.x / pw, t: p.t };
      if (rotate === 270) return { x: p.y / ph, y: (pw - 1 - p.x) / pw, t: p.t };
      return { x: p.x / pw, y: p.y / ph, t: p.t };
    });
    const aspect = (rotate === 90 || rotate === 270) ? ph / pw : pw / ph; // 竖屏帧宽高比 w/h
    return { pts, aspect, valid: this.state === 'done' && pts.length >= this.o.minTrack };
  }
}

module.exports = BallTracker;
