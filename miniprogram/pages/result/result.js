const { coverMapper, drawTracer, smoothPath, ACCENT } = require('../../utils/draw.js');

Page({
  data: {
    videoPath: '',
    stats: null,
  },

  onLoad() {
    const shot = getApp().globalData.lastShot;
    if (!shot) {
      wx.showToast({ title: '没有轨迹数据', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.shot = shot;
    this.setData({ videoPath: shot.videoPath, stats: shot.stats });
    this._saveHistory(shot.stats);
  },

  onReady() {
    wx.createSelectorQuery()
      .select('#overlay')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return;
        const dpr = Math.min(wx.getWindowInfo().pixelRatio || 1, 2);
        const { node, width, height } = res[0];
        node.width = width * dpr;
        node.height = height * dpr;
        this.canvas = node;
        this.ctx = node.getContext('2d');
        this.ctx.scale(dpr, dpr);
        this.cw = width; this.ch = height;
        this._prepareScreenPts();
        this._startLoop();
      });
  },

  onUnload() { this._stopLoop(); },

  /** 归一化轨迹 → 屏幕坐标, 并把时间转为「相对录像起点的毫秒」 */
  _prepareScreenPts() {
    const shot = this.shot;
    if (!shot) return;
    const map = coverMapper(shot.aspect, this.cw, this.ch);
    this.screenPts = shot.pts.map((p) => {
      const [x, y] = map(p.x, p.y);
      return { x, y, rel: p.t - shot.recordStartTs };
    });
  },

  onPlay() {
    this.playWall = Date.now();
    this.playBaseMs = 0;
  },

  onTimeUpdate(e) {
    // timeupdate 粒度约 250ms, 用它校准我们的高帧率时钟
    this.playWall = Date.now();
    this.playBaseMs = (e.detail.currentTime || 0) * 1000;
  },

  _startLoop() {
    const step = () => {
      this._draw();
      this.rafId = this.canvas.requestAnimationFrame(step);
    };
    this.rafId = this.canvas.requestAnimationFrame(step);
  },

  _stopLoop() {
    if (this.rafId && this.canvas) this.canvas.cancelAnimationFrame(this.rafId);
  },

  _draw() {
    const ctx = this.ctx;
    if (!ctx || !this.screenPts) return;
    ctx.clearRect(0, 0, this.cw, this.ch);
    const curMs = this.playWall ? (Date.now() - this.playWall) + this.playBaseMs : 0;
    const pts = this.screenPts;
    let n = 0;
    while (n < pts.length && pts[n].rel <= curMs) n++;
    if (n < 2) return;
    const done = n >= pts.length;
    drawTracer(ctx, pts.slice(0, n), { headGlow: !done, alpha: done ? 0.85 : 1 });
  },

  goBack() { wx.navigateBack(); },
  retry() { wx.navigateBack(); },

  _saveHistory(stats) {
    if (!stats || this._saved) return;
    this._saved = true;
    const d = new Date();
    const list = wx.getStorageSync('tr4ce_history') || [];
    list.unshift({
      emoji: stats.type.emoji,
      typeZh: stats.type.zh,
      launchDeg: stats.launchDeg,
      carryEstM: stats.carryEstM,
      date: `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    });
    wx.setStorageSync('tr4ce_history', list.slice(0, 20));
  },

  // ---------- 战绩海报 ----------
  savePoster() {
    wx.showLoading({ title: '生成中…' });
    wx.createSelectorQuery()
      .select('#poster')
      .fields({ node: true })
      .exec((res) => {
        if (!res || !res[0]) { wx.hideLoading(); return; }
        const node = res[0].node;
        this._drawPoster(node);
        wx.canvasToTempFilePath({
          canvas: node,
          success: (r) => this._saveToAlbum(r.tempFilePath),
          fail: () => { wx.hideLoading(); wx.showToast({ title: '生成失败', icon: 'none' }); },
        });
      });
  },

  _drawPoster(node) {
    const W = 750, H = 1200;
    node.width = W; node.height = H;
    const c = node.getContext('2d');
    const s = this.data.stats;

    // 背景
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#10161d');
    bg.addColorStop(1, '#0a0e13');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // 轨迹(居中重绘)
    const pts = this.shot.pts;
    if (pts && pts.length > 1) {
      let minx = 1, maxx = 0, miny = 1, maxy = 0;
      for (const p of pts) {
        if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
        if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
      }
      const bw = Math.max(maxx - minx, 0.05), bh = Math.max(maxy - miny, 0.05);
      const area = { x: 115, y: 250, w: 520, h: 560 };
      const sc = Math.min(area.w / bw, area.h / bh);
      const ox = area.x + (area.w - bw * sc) / 2 - minx * sc;
      const oy = area.y + (area.h - bh * sc) / 2 - miny * sc;
      const sp = smoothPath(pts.map((p) => ({ x: p.x * sc + ox, y: p.y * sc + oy })));
      drawTracer(c, sp, { headGlow: false });
      // 起点小圆
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(sp[0].x, sp[0].y, 7, 0, Math.PI * 2); c.fill();
    }

    c.textAlign = 'center';
    // 标题
    c.fillStyle = '#e8edf2';
    c.font = '900 64px sans-serif';
    c.fillText('TR4CE ⛳', W / 2, 120);
    c.fillStyle = '#8b98a5';
    c.font = '400 26px sans-serif';
    const d = new Date();
    c.fillText(`球路追踪 · ${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`, W / 2, 165);

    // 球型
    c.font = '900 60px sans-serif';
    c.fillStyle = s.type.color;
    c.fillText(`${s.type.emoji} ${s.type.name} · ${s.type.zh}`, W / 2, 900);

    // 大数字
    c.fillStyle = ACCENT;
    c.font = '900 130px sans-serif';
    c.fillText(String(s.carryEstM), W / 2, 1035);
    c.fillStyle = '#8b98a5';
    c.font = '400 28px sans-serif';
    c.fillText('估算全程 · 米', W / 2, 1078);

    // 数据行
    c.fillStyle = '#e8edf2';
    c.font = '600 30px sans-serif';
    c.fillText(`画面轨迹 ${s.pathLenM}m　·　起飞角 ${s.launchDeg}°　·　出球 ${s.v0Kmh}km/h`, W / 2, 1140);
  },

  _saveToAlbum(path) {
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => { wx.hideLoading(); wx.showToast({ title: '已保存到相册 ✅' }); },
      fail: (err) => {
        wx.hideLoading();
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存图片到相册。',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting(); },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  },

  onShareAppMessage() {
    const s = this.data.stats;
    return {
      title: s ? `我打出了一记 ${s.type.zh}${s.type.emoji} 起飞角 ${s.launchDeg}° — 来测测你的球路` : 'TR4CE 高尔夫球路追踪',
      path: '/pages/index/index',
    };
  },
});
