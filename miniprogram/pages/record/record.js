const BallTracker = require('../../utils/tracker.js');
const { analyze } = require('../../utils/analyzer.js');
const { coverMapper, drawTracer } = require('../../utils/draw.js');

Page({
  data: {
    state: 'idle', // idle | waiting | tracking | saving
    hint: '就位后点击下方按钮',
    recording: false,
    camDist: 3,
    rotate: 90, // 相机帧相对预览的旋转; 多数安卓为 90, 校准按钮可循环 0/90/270
  },

  onReady() {
    this.canvasReady = false;
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
        this.canvasReady = true;
      });
  },

  onUnload() { this._teardown(); },

  onCamReady() { this.camReady = true; },

  onCamError() {
    wx.showModal({
      title: '需要相机权限',
      content: '请在设置中允许使用摄像头，才能录制并追踪球路。',
      confirmText: '去设置',
      success: (r) => { if (r.confirm) wx.openSetting(); else wx.navigateBack(); },
    });
  },

  setDist(e) { this.setData({ camDist: Number(e.currentTarget.dataset.d) }); },

  cycleRotate() {
    const next = { 0: 90, 90: 270, 270: 0 }[this.data.rotate];
    this.setData({ rotate: next });
    wx.showToast({ title: `帧方向 ${next}°`, icon: 'none', duration: 800 });
  },

  goBack() { wx.navigateBack(); },

  toggleRecord() {
    if (this.data.recording) this._stopCapture(true);
    else this._startCapture();
  },

  _startCapture() {
    if (!this.camReady || !this.canvasReady) {
      wx.showToast({ title: '相机还没准备好', icon: 'none' });
      return;
    }
    this.tracker = new BallTracker();
    this.finished = false;
    this.camCtx = this.camCtx || wx.createCameraContext();

    this.camCtx.startRecord({
      timeout: 20,
      success: () => { this.recordStartTs = Date.now(); },
      timeoutCallback: (res) => this._onVideo(res.tempVideoPath),
      fail: () => wx.showToast({ title: '无法开始录像', icon: 'none' }),
    });

    this._busy = false;
    this.listener = this.camCtx.onCameraFrame((frame) => this._onFrame(frame));
    this.listener.start();

    this.setData({ recording: true, state: 'waiting', hint: '监测中 · 请正常击球' });
  },

  _onFrame(frame) {
    if (this._busy || this.finished || !this.tracker) return;
    this._busy = true;
    try {
      const res = this.tracker.process(new Uint8Array(frame.data), frame.width, frame.height, Date.now());
      if (res.state === 'tracking' && this.data.state !== 'tracking') {
        this.setData({ state: 'tracking', hint: '🔥 捕捉到球了' });
        wx.vibrateShort({ type: 'light' });
      }
      this._drawLive(res);
      if (res.state === 'done') this._stopCapture(false);
    } finally {
      this._busy = false;
    }
  },

  _drawLive(res) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.cw, this.ch);
    if (!res.track || res.track.length < 2) return;
    const rotate = this.data.rotate;
    const pw = res.pw, ph = res.ph;
    // 处理坐标 → 竖屏归一化 → 屏幕 (cover)
    const aspect = (rotate === 90 || rotate === 270) ? ph / pw : pw / ph;
    const map = coverMapper(aspect, this.cw, this.ch);
    const pts = res.track.map((p) => {
      let nx, ny;
      if (rotate === 90) { nx = (ph - 1 - p.y) / ph; ny = p.x / pw; }
      else if (rotate === 270) { nx = p.y / ph; ny = (pw - 1 - p.x) / pw; }
      else { nx = p.x / pw; ny = p.y / ph; }
      const [x, y] = map(nx, ny);
      return { x, y };
    });
    drawTracer(ctx, pts, { headGlow: true });
  },

  /** manual=true 表示用户手动点了结束 */
  _stopCapture(manual) {
    if (this.finished) return;
    this.finished = true;
    if (this.listener) { this.listener.stop(); this.listener = null; }
    this.setData({ state: 'saving', hint: manual ? '正在保存…' : '✅ 轨迹完成，正在保存…' });
    // 球出画后再录一小段收尾
    setTimeout(() => {
      this.camCtx.stopRecord({
        compressed: false,
        success: (res) => this._onVideo(res.tempVideoPath),
        fail: () => {
          this.setData({ recording: false, state: 'idle', hint: '保存失败，请重试' });
          this.finished = false;
        },
      });
    }, manual ? 0 : 700);
  },

  _onVideo(videoPath) {
    this.setData({ recording: false });
    const r = this.tracker ? this.tracker.result(this.data.rotate) : { valid: false, pts: [] };
    if (!r.valid) {
      this.setData({ state: 'idle', hint: '没捕捉到球轨迹，再试一次' });
      wx.showModal({
        title: '未识别到球',
        content: '试试：离球更近一点、背景换成天空、光线更亮，或击球后保持手机不动。',
        showCancel: false,
        confirmText: '重新录制',
      });
      this.finished = false;
      return;
    }
    const stats = analyze(r.pts, { camDistM: this.data.camDist, aspect: r.aspect });
    getApp().globalData.lastShot = {
      videoPath,
      pts: r.pts,
      aspect: r.aspect,
      stats,
      recordStartTs: this.recordStartTs || (r.pts[0].t - 500),
    };
    wx.navigateTo({ url: '/pages/result/result' });
    // 返回本页时恢复初始状态
    this.setData({ state: 'idle', hint: '就位后点击下方按钮' });
    if (this.ctx) this.ctx.clearRect(0, 0, this.cw, this.ch);
  },

  _teardown() {
    if (this.listener) { this.listener.stop(); this.listener = null; }
    if (this.camCtx && this.data.recording) {
      try { this.camCtx.stopRecord({}); } catch (e) { /* ignore */ }
    }
  },
});
