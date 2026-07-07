/* TR4CE — share card + replay video recording (attaches to window.GolfShare) */
(function () {
  'use strict';

  const R = window.GolfRender;
  const PH = window.GolfPhysics;
  const FONT = "-apple-system, 'SF Pro Display', 'Segoe UI', Roboto, 'PingFang SC', 'Noto Sans SC', sans-serif";
  const MONO = 'ui-monospace, Menlo, Consolas, monospace';

  // ---------- 9:16 share card ----------
  function buildShareCard(shot, type, club) {
    const W = 1080, H = 1920;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');

    // scene as the backdrop, full trail drawn
    shot._projKey = null; // force reproject at card size
    R.drawScene(c, W, H, { time: 4.2, shot, idx: shot.pts.length, ballVisible: true });
    shot._projKey = null; // don't poison the live canvas cache

    // vignette top & bottom for legibility
    let g = c.createLinearGradient(0, 0, 0, H * 0.42);
    g.addColorStop(0, 'rgba(4,1,14,0.92)');
    g.addColorStop(1, 'rgba(4,1,14,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H * 0.42);
    g = c.createLinearGradient(0, H * 0.55, 0, H);
    g.addColorStop(0, 'rgba(4,1,14,0)');
    g.addColorStop(0.45, 'rgba(4,1,14,0.86)');
    g.addColorStop(1, 'rgba(4,1,14,0.97)');
    c.fillStyle = g; c.fillRect(0, H * 0.55, W, H * 0.45);

    c.textAlign = 'center';

    // logo + date
    c.font = `900 64px ${FONT}`;
    const lg = c.createLinearGradient(W / 2 - 140, 0, W / 2 + 140, 0);
    lg.addColorStop(0, R.C.cyan); lg.addColorStop(1, R.C.magenta);
    c.fillStyle = lg;
    c.fillText('TR4CE ⛳', W / 2, 118);
    c.font = `700 30px ${MONO}`;
    c.fillStyle = 'rgba(255,255,255,0.55)';
    const d = new Date();
    c.fillText(`GOLF SHOT TRACER · ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`, W / 2, 166);

    // shot type badge
    const badgeY = 268;
    c.font = `900 78px ${FONT}`;
    c.shadowColor = type.color; c.shadowBlur = 40;
    c.fillStyle = type.color;
    c.fillText(`${type.emoji} ${type.name}`, W / 2, badgeY);
    c.shadowBlur = 0;
    c.font = `700 40px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillText(type.zh, W / 2, badgeY + 58);

    // giant carry number
    const numY = H * 0.62;
    c.font = `900 340px ${FONT}`;
    const ng = c.createLinearGradient(0, numY - 300, 0, numY);
    ng.addColorStop(0, '#ffffff'); ng.addColorStop(1, type.color);
    c.shadowColor = type.color; c.shadowBlur = 70;
    c.fillStyle = ng;
    c.fillText(String(Math.round(shot.carryYd)), W / 2, numY);
    c.shadowBlur = 0;
    c.font = `800 44px ${MONO}`;
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.fillText('CARRY · YARDS 码', W / 2, numY + 64);

    // caption
    c.font = `900 52px ${FONT}`;
    c.fillStyle = '#fff';
    c.fillText(type.caption + (shot._isPB ? ' · 🏆 NEW PB' : ''), W / 2, numY + 158);

    // stats row
    const stats = [
      ['TOTAL', `${Math.round(shot.totalYd)}y`],
      ['APEX', `${shot.apexM.toFixed(0)}m`],
      ['BALL SPD', `${shot.ballSpeedMph.toFixed(0)}mph`],
      ['HANG', `${shot.hangS.toFixed(1)}s`],
      ['CLUB', club.short],
    ];
    const rowY = numY + 300, colW = W / stats.length;
    stats.forEach(([k, v], i) => {
      const x = colW * (i + 0.5);
      c.font = `700 28px ${MONO}`;
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.fillText(k, x, rowY);
      c.font = `900 48px ${FONT}`;
      c.fillStyle = '#fff';
      c.fillText(v, x, rowY + 54);
    });
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(80, rowY - 52); c.lineTo(W - 80, rowY - 52); c.stroke();

    // footer
    c.font = `700 30px ${MONO}`;
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.fillText('made with TR4CE ⛳ · #golf #shottracer #高尔夫', W / 2, H - 64);

    return cv;
  }

  function canvasToBlob(cv) {
    return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
  }

  async function shareCard(shot, type, club) {
    const cv = buildShareCard(shot, type, club);
    const blob = await canvasToBlob(cv);
    const file = new File([blob], `tr4ce-${Math.round(shot.carryYd)}yds.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'TR4CE golf shot',
          text: `${type.emoji} ${type.name} · ${Math.round(shot.carryYd)} YDS carry ⛳ #TR4CE`,
        });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user closed the sheet
      }
    }
    downloadBlob(blob, file.name);
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  // ---------- replay video recording ----------
  let recorder = null, chunks = [], onDone = null;

  function pickMime() {
    const list = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const m of list) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    }
    return null;
  }

  /** Start capturing the given canvas. Returns false (and calls onErr) if unsupported. */
  function startRecording(canvas, onFinish, onErr) {
    const mime = pickMime();
    if (!mime || !canvas.captureStream) {
      onErr && onErr('当前浏览器不支持视频录制, 试试 Chrome 📱');
      return false;
    }
    try {
      const stream = canvas.captureStream(60);
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      chunks = [];
      onDone = onFinish;
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        const file = new File([blob], `tr4ce-replay.${ext}`, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: 'TR4CE replay' }); }
          catch (e) { if (e.name !== 'AbortError') downloadBlob(blob, file.name); }
        } else {
          downloadBlob(blob, file.name);
        }
        recorder = null;
        onDone && onDone();
      };
      recorder.start(120);
      return true;
    } catch (e) {
      onErr && onErr(e.message);
      return false;
    }
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  window.GolfShare = { shareCard, buildShareCard, startRecording, stopRecording, downloadBlob };
})();
