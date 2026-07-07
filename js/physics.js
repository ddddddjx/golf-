/* TR4CE — golf flight physics (no deps, attaches to window.GolfPhysics) */
(function () {
  'use strict';

  const DEG = Math.PI / 180;
  const YD = 1.09361; // meters -> yards
  const MPH = 2.23694; // m/s -> mph

  // Club presets: max ball speed (m/s), launch angle (deg), backspin (rpm)
  const CLUBS = [
    { id: 'driver', name: 'DRIVER', short: 'DR', maxSpeed: 78, launch: 12.5, backspin: 2500 },
    { id: 'wood3',  name: '3 WOOD', short: '3W', maxSpeed: 69, launch: 14.5, backspin: 3500 },
    { id: 'iron5',  name: '5 IRON', short: '5i', maxSpeed: 58, launch: 18.5, backspin: 5300 },
    { id: 'iron7',  name: '7 IRON', short: '7i', maxSpeed: 54, launch: 22.5, backspin: 7100 },
    { id: 'iron9',  name: '9 IRON', short: '9i', maxSpeed: 48, launch: 26.5, backspin: 8600 },
    { id: 'pw',     name: 'PITCH W', short: 'PW', maxSpeed: 42, launch: 30.0, backspin: 9400 },
  ];

  /**
   * Simulate a golf shot with quadratic drag + Magnus lift/side force,
   * bounces and roll-out. Coordinates: x = lateral (+right), y = up,
   * z = downrange. All meters / seconds.
   *
   * @param {object} o {ballSpeed, launchDeg, startDeg, backspin, sidespin}
   * @returns {object} {pts, carryYd, totalYd, apexM, hangS, ballSpeedMph, carryIdx, endIdx, startDeg, curveYd, pushYd}
   */
  function simulate(o) {
    const dt = 1 / 240;
    const g = 9.81;
    const R = 0.02135;    // ball radius (m)
    const KA = 0.0191;    // 0.5 * rho * A / m  (1/m)
    const CD = 0.22;      // drag coefficient
    const CLMAX = 0.30;   // lift coefficient saturation
    const spinDecay = Math.exp(-dt / 8);

    let wb = o.backspin * Math.PI / 30;  // rpm -> rad/s
    let ws = o.sidespin * Math.PI / 30;

    const la = o.launchDeg * DEG;
    const sa = o.startDeg * DEG;
    let vx = o.ballSpeed * Math.cos(la) * Math.sin(sa);
    let vy = o.ballSpeed * Math.sin(la);
    let vz = o.ballSpeed * Math.cos(la) * Math.cos(sa);
    let x = 0, y = 0.04, z = 0, t = 0;

    const pts = [{ x, y, z, t }];
    let apex = 0, carryZ = null, carryX = 0, hang = 0, carryIdx = null;
    let phase = 'fly', bounces = 0, step = 0;

    while (t < 25) {
      t += dt; step++;
      const v = Math.hypot(vx, vy, vz) || 1e-4;

      // Spin raises drag too (high-spin irons balloon and fall shorter)
      const sr = R * Math.hypot(wb, ws) / v;
      const kd = KA * (CD + 0.30 * Math.min(sr, 0.35));
      let ax = -kd * v * vx;
      let ay = -kd * v * vy - g;
      let az = -kd * v * vz;

      if (phase !== 'roll') {
        const vh = Math.hypot(vx, vz) || 1e-4;
        // Lift coefficient from spin ratio, saturating like a real ball
        const clB = Math.min(1.4 * R * Math.abs(wb) / v, CLMAX) * Math.sign(wb);
        const clS = Math.min(1.4 * R * Math.abs(ws) / v, CLMAX) * Math.sign(ws);
        const lift = KA * clB * v * v; // backspin lift, perpendicular to v in vertical plane
        const side = KA * clS * v * v; // sidespin, horizontal perpendicular (+ curves right)
        ax += lift * (-vy * vx / (v * vh)) + side * (vz / vh);
        ay += lift * (vh / v);
        az += lift * (-vy * vz / (v * vh)) + side * (-vx / vh);
        wb *= spinDecay; ws *= spinDecay;
      } else {
        // rolling friction
        const vh = Math.hypot(vx, vz);
        if (vh < 0.4) break;
        const mu = 2.2;
        ax = -mu * vx / vh; az = -mu * vz / vh; ay = 0;
      }

      vx += ax * dt; vy += ay * dt; vz += az * dt;
      x += vx * dt; y += vy * dt; z += vz * dt;
      if (y > apex) apex = y;

      if (phase !== 'roll' && y <= 0 && vy < 0) {
        y = 0;
        if (carryZ === null) {
          carryZ = z; carryX = x; hang = t; carryIdx = pts.length;
        }
        bounces++;
        if (vy < -1.4 && bounces <= 4) {
          vy = -vy * 0.36;
          vx *= 0.6; vz *= 0.55;
          wb *= 0.35; ws *= 0.35;
          phase = 'bounce';
        } else {
          vy = 0; phase = 'roll';
        }
      }
      if (phase === 'roll') y = 0;

      if (step % 2 === 0) pts.push({ x, y, z, t });
    }
    pts.push({ x, y: 0, z, t });

    if (carryZ === null) { carryZ = z; carryX = x; hang = t; carryIdx = pts.length - 1; }

    const pushYd = Math.tan(sa) * carryZ * YD;         // lateral from start line only
    const curveYd = carryX * YD - pushYd;              // lateral caused by spin

    return {
      pts,
      carryIdx,
      endIdx: pts.length - 1,
      carryYd: carryZ * YD,
      totalYd: z * YD,
      apexM: apex,
      hangS: hang,
      ballSpeedMph: o.ballSpeed * MPH,
      startDeg: o.startDeg,
      curveYd,
      pushYd,
    };
  }

  const CAPTIONS = {
    NUKE:   ['ABSOLUTELY NUKED ☢️', 'MOON BALL 🌕', 'GONE. JUST GONE. 🛸'],
    PURE:   ['BUTTER. 🧈', 'DEAD CENTER 🎯', 'FLUSHED IT 😮‍💨'],
    DRAW:   ['TOUR VIBES 😮‍💨', 'THAT DRAW IS ART 🎨', 'BUTTER DRAW 🧈'],
    FADE:   ['CLEAN LITTLE CUT 😎', 'BABY FADE 🍼', 'STOCK SHOT ENERGY ⚡'],
    SLICE:  ['BANANA BALL 🍌💀', 'THAT THING SLICED 💀', 'GPS CAN\'T FIND IT 🛰️'],
    HOOK:   ['DUCK HOOK 🦆💨', 'SNAPPED LEFT 😵', 'IT WENT HOME EARLY 🪝'],
    PUSH:   ['BLOCKED IT 🧱', 'STRAIGHT... WRONG WAY ➡️', 'PUSH GANG 😤'],
    PULL:   ['YANKED IT 😤', 'PULLED THE TRIGGER ⬅️', 'LEFT SIDE SPECIAL 🫠'],
  };

  /**
   * Classify shot shape (right-handed golfer).
   * @returns {name, zh, emoji, color, caption}
   */
  function classify(shot, rng) {
    const rand = rng || Math.random;
    const carry = Math.max(shot.carryYd, 40);
    const big = Math.max(16, carry * 0.085);
    const mid = Math.max(5, carry * 0.026);
    const c = shot.curveYd;
    const p = shot.pushYd;

    let shape = 'STRAIGHT';
    if (c > big) shape = 'SLICE';
    else if (c > mid) shape = 'FADE';
    else if (c < -big) shape = 'HOOK';
    else if (c < -mid) shape = 'DRAW';

    let start = '';
    if (p > mid) start = 'PUSH';
    else if (p < -mid) start = 'PULL';

    let key, name, zh, emoji, color;
    if (shape === 'STRAIGHT' && !start) {
      key = shot.carryYd >= 265 ? 'NUKE' : 'PURE';
      name = 'PURE'; zh = '笔直穿透'; emoji = '🎯'; color = '#19e3ff';
    } else if (shape === 'STRAIGHT') {
      key = start;
      name = start;
      zh = start === 'PUSH' ? '右推球' : '左拉球';
      emoji = start === 'PUSH' ? '➡️' : '⬅️';
      color = '#ffd60a';
    } else {
      key = shape;
      name = start ? `${start} ${shape}` : shape;
      const zhMap = { SLICE: '大右曲', FADE: '小右曲 CUT', HOOK: '大左曲', DRAW: '小左曲' };
      const emMap = { SLICE: '🍌', FADE: '🌪️', HOOK: '🪝', DRAW: '✨' };
      const coMap = { SLICE: '#ffb02d', FADE: '#b6ff2d', HOOK: '#ff2d78', DRAW: '#7b5cff' };
      zh = (start ? (start === 'PUSH' ? '右推+' : '左拉+') : '') + zhMap[shape];
      emoji = emMap[shape]; color = coMap[shape];
    }

    const list = CAPTIONS[key] || CAPTIONS.PURE;
    const caption = list[Math.floor(rand() * list.length)];
    return { name, zh, emoji, color, caption };
  }

  const api = { CLUBS, simulate, classify, YD, MPH };
  if (typeof window !== 'undefined') window.GolfPhysics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
