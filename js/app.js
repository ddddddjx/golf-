/* TR4CE — app logic */
(function () {
  'use strict';

  const PH = window.GolfPhysics;
  const R = window.GolfRender;

  // ---------- elements ----------
  const scene = document.getElementById('scene');
  const ctx = scene.getContext('2d');
  const mapView = document.getElementById('mapView');
  const arcView = document.getElementById('arcView');
  const clubsEl = document.getElementById('clubs');
  const hintEl = document.getElementById('hint');
  const swingBtn = document.getElementById('swingBtn');
  const powerFill = document.getElementById('powerFill');
  const curveMark = document.getElementById('curveMark');
  const meterPower = document.getElementById('meterPower');
  const meterCurve = document.getElementById('meterCurve');
  const controlsEl = document.getElementById('controls');
  const panel = document.getElementById('panel');
  const pbEl = document.getElementById('pb');
  const toastEl = document.getElementById('toast');

  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    scene.width = W * dpr; scene.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const c of [mapView, arcView]) {
      const r = c.getBoundingClientRect();
      c.width = r.width * dpr; c.height = r.height * dpr;
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }
  window.addEventListener('resize', resize);

  // ---------- state ----------
  const S = {
    state: 'idle',           // idle | charge | aim | fly | done
    clubIdx: 0,
    power: 0, face: 0,
    chargeT0: 0, aimT0: 0,
    shot: null, type: null,
    animT: 0, ptr: 0,
    impactDone: false,
    shake: 0, flash: 0,
    particles: [], confetti: [], rings: [],
    revealT: 0,
    recording: false,
    pb: Number(localStorage.getItem('tr4ce_pb') || 0),
    history: JSON.parse(localStorage.getItem('tr4ce_history') || '[]'),
    lastFrame: performance.now(),
    time: 0,
  };

  // ---------- clubs ----------
  PH.CLUBS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'club-chip' + (i === 0 ? ' active' : '');
    b.textContent = c.short;
    b.title = c.name;
    b.addEventListener('click', () => {
      if (S.state === 'fly') return;
      S.clubIdx = i;
      document.querySelectorAll('.club-chip').forEach((el, j) => el.classList.toggle('active', j === i));
      haptic(8);
    });
    clubsEl.appendChild(b);
  });
  const club = () => PH.CLUBS[S.clubIdx];

  // ---------- audio ----------
  let AC = null;
  function audioInit() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ }
  }
  function whoosh() {
    if (!AC) return;
    const t = AC.currentTime;
    const len = 0.45, buf = AC.createBuffer(1, AC.sampleRate * len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = AC.createBufferSource(); src.buffer = buf;
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.28);
    const g = AC.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(bp).connect(g).connect(AC.destination);
    src.start(t);
  }
  function thump() {
    if (!AC) return;
    const t = AC.currentTime;
    const o = AC.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    const g = AC.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(AC.destination);
    o.start(t); o.stop(t + 0.22);
  }
  function chime() {
    if (!AC) return;
    const t = AC.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = AC.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = AC.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.22, t + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.5);
      o.connect(g).connect(AC.destination);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.55);
    });
  }
  const haptic = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

  // ---------- input ----------
  function setHint(t) { hintEl.innerHTML = t; }

  function onPressStart(e) {
    e.preventDefault();
    audioInit();
    if (S.state === 'idle' || S.state === 'done') {
      hidePanel();
      S.state = 'charge';
      S.chargeT0 = S.time;
      swingBtn.classList.add('charging');
      setHint('松开锁定力量 · <b>RELEASE!</b>');
    } else if (S.state === 'aim') {
      lockCurveAndFire();
    }
  }
  function onPressEnd(e) {
    e.preventDefault();
    if (S.state === 'charge') {
      S.power = Math.max(0.15, S.power);
      S.state = 'aim';
      S.aimT0 = S.time;
      swingBtn.classList.remove('charging');
      swingBtn.classList.add('aiming');
      swingBtn.textContent = 'LOCK';
      setHint('再点一下锁定弧线 · <b>TAP TO LOCK CURVE</b>');
      haptic(12);
    }
  }
  function lockCurveAndFire() {
    swingBtn.classList.remove('aiming');
    swingBtn.textContent = 'SWING';
    fire();
  }
  swingBtn.addEventListener('pointerdown', onPressStart);
  swingBtn.addEventListener('pointerup', onPressEnd);
  swingBtn.addEventListener('pointercancel', onPressEnd);
  scene.addEventListener('pointerdown', (e) => { if (S.state === 'aim') { e.preventDefault(); lockCurveAndFire(); } });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    e.preventDefault();
    if (S.state === 'aim') lockCurveAndFire();
    else onPressStart(e);
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') onPressEnd(e); });

  // ---------- fire ----------
  function fire() {
    const c = club();
    const rnd = () => Math.random() - 0.5;
    const power = S.power, face = S.face;
    const params = {
      ballSpeed: c.maxSpeed * (0.42 + 0.58 * power),
      launchDeg: c.launch + (1 - power) * 1.6 + rnd() * 1.2,
      startDeg: face * 4.2 + rnd() * 0.9,
      backspin: c.backspin * (0.9 + 0.25 * (1 - power)),
      sidespin: face * 3000 * (0.55 + 0.45 * power) + rnd() * 240,
    };
    S.shot = PH.simulate(params);
    S.type = PH.classify(S.shot);
    S.shot._power = power;
    startFlight(false);
  }

  function startFlight(isReplay) {
    S.state = 'fly';
    S.animT = 0; S.ptr = 0;
    S.impactDone = false;
    S.revealT = 0;
    S.particles.length = 0; S.rings.length = 0;
    if (!isReplay) S.confetti.length = 0;
    controlsEl.classList.add('hidden-soft');
    hintEl.classList.add('hidden-soft');
    hidePanel();
    whoosh();
    haptic(28);
    S.flash = 0.35;
    S.shake = 0.5;
  }

  // ---------- impact / finish ----------
  function onImpact() {
    S.impactDone = true;
    S.shake = 1; S.flash = 0.5;
    thump(); haptic([12, 40, 14]);
    const P = R.projectTrail(S.shot, W, H);
    const hp = P[Math.min(S.shot.carryIdx, P.length - 1)];
    S.rings.push({ x: hp.x, y: hp.y, t: 0 });
    for (let i = 0; i < 42; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 5;
      S.particles.push({
        x: hp.x, y: hp.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2.2,
        life: 1, color: Math.random() < 0.5 ? R.C.cyan : R.C.magenta,
      });
    }
  }

  function onFlightEnd() {
    S.state = 'done';
    S.revealT = 0;
    const carry = Math.round(S.shot.carryYd);
    const isPB = carry > S.pb;
    if (!S.recording) {
      if (isPB) {
        S.pb = carry;
        localStorage.setItem('tr4ce_pb', String(carry));
        chime();
      }
      if (isPB || carry >= 280) spawnConfetti();
      S.shot._isPB = isPB;
      pushHistory();
      showPanel();
    } else {
      // replay-for-video: stop recording shortly after the reveal
      setTimeout(() => window.GolfShare.stopRecording(), 1400);
    }
    controlsEl.classList.remove('hidden-soft');
    hintEl.classList.remove('hidden-soft');
    setHint('按住 SWING 蓄力 · <b>HOLD TO CHARGE</b>');
  }

  function spawnConfetti() {
    const colors = [R.C.cyan, R.C.magenta, R.C.lime, R.C.amber, R.C.purple, '#fff'];
    for (let i = 0; i < 130; i++) {
      S.confetti.push({
        x: Math.random() * W, y: -20 - Math.random() * H * 0.4,
        vx: (Math.random() - 0.5) * 1.6, vy: 2 + Math.random() * 3.2,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3,
        w: 4 + Math.random() * 6, h: 6 + Math.random() * 8,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  // ---------- panel / history ----------
  function fmt(n, d = 0) { return n.toFixed(d); }
  function showPanel() {
    const s = S.shot, t = S.type, c = club();
    document.getElementById('badgeEmoji').textContent = t.emoji;
    document.getElementById('badgeName').textContent = t.name;
    document.getElementById('badgeName').style.color = t.color;
    document.getElementById('badgeZh').textContent = t.zh;
    document.getElementById('caption').textContent = t.caption + (s._isPB ? '  ·  🏆 NEW PB!' : '');
    document.getElementById('carryNum').textContent = Math.round(s.carryYd);
    const grid = document.getElementById('statGrid');
    grid.innerHTML = '';
    const items = [
      ['TOTAL', `${Math.round(s.totalYd)}<i>yds</i>`],
      ['APEX 弹道高', `${fmt(s.apexM, 0)}<i>m</i>`],
      ['BALL SPEED', `${fmt(s.ballSpeedMph, 0)}<i>mph</i>`],
      ['HANG TIME', `${fmt(s.hangS, 1)}<i>s</i>`],
      ['CURVE 侧曲', `${s.curveYd > 0 ? 'R' : 'L'}${fmt(Math.abs(s.curveYd), 0)}<i>yds</i>`],
      ['CLUB', `${c.short}<i>${Math.round(s._power * 100)}%</i>`],
    ];
    for (const [k, v] of items) {
      const d = document.createElement('div');
      d.className = 'stat';
      d.innerHTML = `<span>${k}</span><b>${v}</b>`;
      grid.appendChild(d);
    }
    renderHistory();
    panel.classList.remove('hidden');
    document.getElementById('minis').classList.add('hidden-soft');
    updatePBChip();
  }
  function hidePanel() {
    panel.classList.add('hidden');
    document.getElementById('minis').classList.remove('hidden-soft');
  }

  function pushHistory() {
    S.history.unshift({
      club: club().short,
      carry: Math.round(S.shot.carryYd),
      emoji: S.type.emoji,
      name: S.type.name,
    });
    S.history = S.history.slice(0, 12);
    localStorage.setItem('tr4ce_history', JSON.stringify(S.history));
  }
  function renderHistory() {
    const el = document.getElementById('history');
    el.innerHTML = '';
    for (const h of S.history) {
      const d = document.createElement('div');
      d.className = 'hist-chip';
      d.textContent = `${h.emoji} ${h.club} ${h.carry}y`;
      el.appendChild(d);
    }
  }
  function updatePBChip() { pbEl.textContent = S.pb ? `PB ${S.pb}y 🏆` : 'PB —'; }
  updatePBChip();

  // ---------- panel buttons ----------
  document.getElementById('btnAgain').addEventListener('click', () => {
    hidePanel();
    S.state = 'idle';
    setHint('按住 SWING 蓄力 · <b>HOLD TO CHARGE</b>');
  });
  document.getElementById('btnCard').addEventListener('click', async () => {
    if (!S.shot) return;
    toast('正在生成战绩卡… 📸');
    try {
      await window.GolfShare.shareCard(S.shot, S.type, club());
      toast('战绩卡已生成 ✅ 快去发给球友!');
    } catch (e) { toast('生成失败: ' + e.message); }
  });
  document.getElementById('btnVideo').addEventListener('click', () => {
    if (!S.shot || S.recording) return;
    const ok = window.GolfShare.startRecording(scene, () => {
      S.recording = false;
      showPanel();
      toast('回放视频已保存 🎥 发到群里吧!');
    }, (err) => {
      S.recording = false;
      showPanel();
      toast('录制不可用: ' + err);
    });
    if (!ok) return;
    S.recording = true;
    hidePanel();
    toast('录制回放中… 🎥');
    startFlight(true);
  });

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  // ---------- mini views ----------
  function drawMap() {
    const c = mapView.getContext('2d');
    const w = mapView.width / dpr, h = mapView.height / dpr;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(8,2,26,0.72)';
    c.fillRect(0, 0, w, h);
    const maxYd = 320, pad = 10;
    const zTo = (yd) => h - pad - (yd / maxYd) * (h - pad * 2);
    const xTo = (xm) => w / 2 + xm * PH.YD * 1.6 * ((h - 20) / maxYd);
    c.strokeStyle = 'rgba(25,227,255,0.25)';
    c.setLineDash([3, 4]);
    c.beginPath(); c.moveTo(w / 2, h - pad); c.lineTo(w / 2, pad); c.stroke();
    c.setLineDash([]);
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.font = '600 7px ui-monospace, monospace';
    for (let yd = 100; yd <= 300; yd += 100) {
      c.fillRect(w / 2 - 3, zTo(yd), 6, 1);
      c.fillText(yd, w / 2 + 6, zTo(yd) + 2.5);
    }
    if (S.shot) {
      const n = Math.max(2, Math.min(Math.floor(S.ptr) + 1, S.shot.pts.length));
      c.strokeStyle = R.C.magenta;
      c.shadowColor = R.C.magenta; c.shadowBlur = 5;
      c.lineWidth = 1.6;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const p = S.shot.pts[i];
        const px = xTo(p.x), py = zTo(p.z * PH.YD);
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
      c.shadowBlur = 0;
    }
    c.fillStyle = 'rgba(255,255,255,0.65)';
    c.font = '700 8px ui-monospace, monospace';
    c.fillText('TOP', 5, 11);
  }

  function drawArc() {
    const c = arcView.getContext('2d');
    const w = arcView.width / dpr, h = arcView.height / dpr;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(8,2,26,0.72)';
    c.fillRect(0, 0, w, h);
    const maxYd = 320, maxH = 55, pad = 8;
    const zTo = (yd) => pad + (yd / maxYd) * (w - pad * 2);
    const yTo = (m) => h - pad - (m / maxH) * (h - pad * 2);
    c.strokeStyle = 'rgba(25,227,255,0.3)';
    c.beginPath(); c.moveTo(pad, h - pad); c.lineTo(w - pad, h - pad); c.stroke();
    if (S.shot) {
      const n = Math.max(2, Math.min(Math.floor(S.ptr) + 1, S.shot.pts.length));
      c.strokeStyle = R.C.cyan;
      c.shadowColor = R.C.cyan; c.shadowBlur = 5;
      c.lineWidth = 1.6;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const p = S.shot.pts[i];
        if (i === 0) c.moveTo(zTo(p.z * PH.YD), yTo(p.y)); else c.lineTo(zTo(p.z * PH.YD), yTo(p.y));
      }
      c.stroke();
      c.shadowBlur = 0;
    }
    c.fillStyle = 'rgba(255,255,255,0.65)';
    c.font = '700 8px ui-monospace, monospace';
    c.fillText('SIDE', 5, 11);
  }

  // ---------- in-canvas HUD (captured in the replay video) ----------
  function drawHUD() {
    if (!S.shot || S.state === 'idle' || S.state === 'charge' || S.state === 'aim') return;
    const s = S.shot;
    const pt = s.pts[Math.min(Math.floor(S.ptr), s.pts.length - 1)];
    const flying = S.state === 'fly';
    const distYd = flying ? pt.z * PH.YD : s.totalYd;
    const big = flying && !S.impactDone ? distYd : s.carryYd;

    ctx.save();
    ctx.textAlign = 'center';

    // big carry counter
    const bigStr = String(Math.round(big));
    const fs = Math.min(W * 0.19, 92);
    ctx.font = `900 ${fs}px -apple-system, 'SF Pro Display', 'Segoe UI', Roboto, 'PingFang SC', sans-serif`;
    const grad = ctx.createLinearGradient(0, H * 0.06, 0, H * 0.06 + fs);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, S.impactDone ? (S.type ? S.type.color : R.C.cyan) : R.C.cyan);
    ctx.shadowColor = 'rgba(25,227,255,0.8)';
    ctx.shadowBlur = 26;
    ctx.fillStyle = grad;
    ctx.fillText(bigStr, W / 2, H * 0.075 + fs * 0.8);
    ctx.shadowBlur = 0;

    ctx.font = `800 ${Math.max(12, fs * 0.16)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(S.impactDone ? 'CARRY · YARDS' : 'YARDS', W / 2, H * 0.075 + fs * 0.98);

    if (flying && !S.impactDone) {
      ctx.font = `700 ${Math.max(11, fs * 0.14)}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`H ${pt.y.toFixed(0)}m`, W / 2, H * 0.075 + fs * 1.22);
    }

    // type reveal after landing
    if (S.impactDone && S.type && (S.state === 'done' || S.ptr >= s.carryIdx)) {
      const rp = Math.min(1, S.revealT / 0.4);
      const ease = 1 - Math.pow(1 - rp, 3);
      ctx.globalAlpha = ease;
      const ry = H * 0.075 + fs * 1.3 + (1 - ease) * 18;
      const tfs = Math.min(W * 0.085, 40);
      ctx.font = `900 ${tfs}px -apple-system, 'Segoe UI', 'PingFang SC', sans-serif`;
      ctx.shadowColor = S.type.color; ctx.shadowBlur = 18;
      ctx.fillStyle = S.type.color;
      ctx.fillText(`${S.type.emoji} ${S.type.name}`, W / 2, ry + tfs);
      ctx.shadowBlur = 0;
      ctx.font = `700 ${tfs * 0.42}px -apple-system, 'PingFang SC', sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`${S.type.zh} · TOTAL ${Math.round(s.totalYd)} YDS`, W / 2, ry + tfs * 1.55);
      if (S.state === 'done') {
        ctx.font = `800 ${tfs * 0.5}px -apple-system, 'PingFang SC', sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.fillText(S.type.caption, W / 2, ry + tfs * 2.25);
      }
      ctx.globalAlpha = 1;
    }

    // watermark (shows up in recordings/screenshots)
    ctx.font = '800 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('⛳ TR4CE', W / 2, H - 12);
    ctx.restore();
  }

  // ---------- FX ----------
  function drawFX(dt) {
    // impact rings
    for (let i = S.rings.length - 1; i >= 0; i--) {
      const r = S.rings[i];
      r.t += dt;
      const p = r.t / 0.7;
      if (p >= 1) { S.rings.splice(i, 1); continue; }
      ctx.strokeStyle = R.C.lime;
      ctx.globalAlpha = 1 - p;
      ctx.lineWidth = 2.5 * (1 - p) + 0.5;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 6 + p * 70, (6 + p * 70) * 0.34, 0, 0, 6.29);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // particles
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.life -= dt * 1.6;
      if (p.life <= 0) { S.particles.splice(i, 1); continue; }
      p.x += p.vx; p.y += p.vy; p.vy += 0.14;
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 2.4, 2.4);
      ctx.globalAlpha = 1;
    }
    // confetti
    for (let i = S.confetti.length - 1; i >= 0; i--) {
      const p = S.confetti[i];
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (p.y > H + 30) { S.confetti.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // flash
    if (S.flash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${S.flash.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      S.flash *= 0.85;
    }
  }

  // ---------- main loop ----------
  function frame(now) {
    const dt = Math.min((now - S.lastFrame) / 1000, 0.05);
    S.lastFrame = now;
    S.time += dt;

    // meters
    if (S.state === 'charge') {
      const t = S.time - S.chargeT0;
      S.power = (1 - Math.cos(t * (Math.PI * 2 / 1.5))) / 2;
      powerFill.style.width = (S.power * 100).toFixed(1) + '%';
      powerFill.classList.toggle('max', S.power > 0.94);
      meterPower.classList.add('active');
    } else meterPower.classList.remove('active');

    if (S.state === 'aim') {
      const t = S.time - S.aimT0;
      S.face = Math.sin(t * (Math.PI * 2 / 1.6));
      curveMark.style.left = (50 + S.face * 46) + '%';
      meterCurve.classList.add('active');
    } else meterCurve.classList.remove('active');

    // flight progression
    if (S.state === 'fly' && S.shot) {
      // bounces + roll-out play fast so the reveal lands quickly
      S.animT += dt * (S.impactDone ? 2.6 : 1);
      const pts = S.shot.pts;
      while (S.ptr < pts.length - 1 && pts[Math.floor(S.ptr) + 1].t <= S.animT) S.ptr++;
      if (!S.impactDone && S.animT >= S.shot.hangS) onImpact();
      if (S.impactDone) S.revealT += dt;
      if (Math.floor(S.ptr) >= pts.length - 1) onFlightEnd();
    }
    if (S.state === 'done') S.revealT += dt;

    // camera shake
    S.shake *= 0.88;
    const sx = (Math.random() - 0.5) * S.shake * 16;
    const sy = (Math.random() - 0.5) * S.shake * 16;

    ctx.save();
    ctx.translate(sx, sy);
    R.drawScene(ctx, W, H, {
      time: S.time,
      shot: (S.state === 'fly' || S.state === 'done') ? S.shot : null,
      idx: S.ptr,
      aimFace: S.state === 'aim' ? S.face : null,
      glowPulse: S.state === 'done' ? 0.75 + 0.25 * Math.sin(S.time * 3) : 1,
    });
    drawFX(dt);
    drawHUD();
    ctx.restore();

    drawMap();
    drawArc();

    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
})();
