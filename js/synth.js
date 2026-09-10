// Synthetic warehouse: a scripted "controlled environment" (as allowed by the challenge)
// that renders a miniature loading bay and emits ground-truth detections through the
// SAME tracking / behaviour / risk pipeline used for real footage.
import { CFG, ZONES } from './config.js';

const W = 960, H = 540, FLOOR = 486, G = 1400;
const PH = 417, PW = 86;          // person px size
const CARRY_Y = 326;              // box bottom when carried at waist
const OVERHEAD_Y = 150;           // box bottom when lifted overhead

// ---------- entity factories -------------------------------------------------
const mkPerson = (x) => ({ kind: 'person', x, y: FLOOR, w: PW, h: PH, dir: 1, crouch: 0, arms: 'idle', phase: 0, moving: false });
const mkCarton = (x, w, opts = {}) => ({ kind: 'carton', x, y: FLOOR, w, h: Math.round(w * 0.62), tag: opts.tag || null, fragile: opts.fragile || false });
const mkMattress = (x, w) => ({ kind: 'mattress', x, y: FLOOR, w, h: Math.round(w * 0.38), fragile: true });
const mkPallet = (x, w) => ({ kind: 'pallet', x, y: FLOOR, w, h: 26 });
const mkTrolley = (x) => ({ kind: 'trolley', x, y: FLOOR, w: 96, h: 84 });

// ---------- drawing ----------------------------------------------------------
function drawScene(ctx, sc) {
  // wall + floor
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#161d29'); grd.addColorStop(1, '#1d2635');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2a3547'; ctx.fillRect(0, 324, W, H - 324);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) { const y = 340 + i * 28; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let i = 0; i < 12; i++) { const x = 30 + i * 82; ctx.beginPath(); ctx.moveTo(x, 324); ctx.lineTo((x - W / 2) * 1.35 + W / 2, H); ctx.stroke(); }
  // dock shutter
  ctx.fillStyle = '#232f42'; ctx.fillRect(614, 58, 318, 266);
  ctx.strokeStyle = '#3b4c68';
  for (let y = 74; y < 324; y += 22) { ctx.beginPath(); ctx.moveTo(620, y); ctx.lineTo(926, y); ctx.stroke(); }
  ctx.fillStyle = '#f5a524'; ctx.fillRect(614, 318, 318, 7);
  ctx.fillStyle = 'rgba(245,165,36,0.85)'; ctx.font = 'bold 17px system-ui';
  ctx.fillText('DOCK  /  VEHICLE', 700, 90);
  // wall sign
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'bold 15px system-ui';
  ctx.fillText('WAREHOUSE - LOADING BAY', 40, 46);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '12px system-ui';
  ctx.fillText('SIMULATED CONTROLLED ENVIRONMENT', 40, 64);
  // zones
  for (const z of Object.values(ZONES)) {
    const x = z.x0 * W, y = z.y0 * H, w = (z.x1 - z.x0) * W, h = (z.y1 - z.y0) * H;
    ctx.strokeStyle = z.color; ctx.setLineDash([9, 7]); ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    ctx.fillStyle = z.color + '14'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = z.color; ctx.font = 'bold 13px system-ui';
    ctx.fillText(z.name.toUpperCase(), x + 8, y - 6);
  }
  // rack shelf (used by overreach scenario)
  if (sc && sc.showShelf) {
    ctx.strokeStyle = '#8b97a8'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(640, 100); ctx.lineTo(790, 100); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(648, 100); ctx.lineTo(648, 324); ctx.moveTo(782, 100); ctx.lineTo(782, 324); ctx.stroke();
    ctx.fillStyle = 'rgba(139,151,168,0.9)'; ctx.font = '11px system-ui'; ctx.fillText('RACK SHELF', 686, 92);
  }
}

function drawEntity(ctx, e, t) {
  if (e.kind === 'person') { drawPerson(ctx, e, t); return; }
  const x = e.x - e.w / 2, y = e.y - e.h;
  if (e.kind === 'carton') {
    ctx.fillStyle = '#b98a4e'; ctx.strokeStyle = '#7c5a30'; ctx.lineWidth = 2;
    ctx.fillRect(x, y, e.w, e.h); ctx.strokeRect(x, y, e.w, e.h);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + e.w / 2 - 4, y, 8, e.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.moveTo(x, y + e.h / 2); ctx.lineTo(x + e.w, y + e.h / 2); ctx.stroke();
    if (e.tag) { ctx.fillStyle = '#ff3b30'; ctx.font = 'bold 11px system-ui'; ctx.fillText(e.tag, x + 4, y + 14); }
    if (e.fragile) { ctx.fillStyle = '#fff'; ctx.font = '10px system-ui'; ctx.fillText('FRAGILE', x + 4, y + e.h - 5); }
  } else if (e.kind === 'mattress') {
    ctx.fillStyle = '#dfe9f7'; ctx.strokeStyle = '#8fa8c8'; ctx.lineWidth = 2;
    roundRect(ctx, x, y, e.w, e.h, 10); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#9fc1e8';
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + e.w * i / 4, y + 4); ctx.lineTo(x + e.w * i / 4, y + e.h - 4); ctx.stroke(); }
  } else if (e.kind === 'pallet') {
    ctx.fillStyle = '#a97c50'; ctx.strokeStyle = '#6e4e2e'; ctx.lineWidth = 1.5;
    ctx.fillRect(x, e.y - 12, e.w, 9); ctx.fillRect(x, e.y - 24, e.w, 9);
    for (let i = 0; i <= 4; i++) ctx.fillRect(x + (e.w / 4) * i - 5, e.y - 26, 10, 26);
  } else if (e.kind === 'trolley') {
    ctx.fillStyle = '#9aa7b4'; ctx.strokeStyle = '#5f6b78'; ctx.lineWidth = 2;
    ctx.fillRect(x, e.y - 14, e.w, 7);
    ctx.beginPath(); ctx.arc(x + 14, e.y - 8, 8, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x + e.w - 14, e.y - 8, 8, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + e.w - 6, e.y - 14); ctx.lineTo(x + e.w + 12, e.y - 74); ctx.lineTo(x + e.w + 22, e.y - 74); ctx.stroke();
  }
}

function drawPerson(ctx, p, t) {
  const ph = p.h * (1 - 0.32 * (p.crouch || 0));
  const x = p.x, yb = p.y;
  const hip = yb - ph * 0.45, sh = yb - ph * 0.82, headY = yb - ph * 0.93;
  p.phase = p.moving ? (p.phase || 0) + 0.32 : 0;
  const swing = p.moving ? Math.sin(p.phase) * 16 : 0;
  ctx.lineCap = 'round';
  // legs
  ctx.strokeStyle = '#55647a'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(x, hip); ctx.lineTo(x - 12 + swing, yb); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, hip); ctx.lineTo(x + 12 - swing, yb); ctx.stroke();
  // torso + vest
  ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 15;
  ctx.beginPath(); ctx.moveTo(x, hip); ctx.lineTo(x, sh); ctx.stroke();
  // arms
  ctx.strokeStyle = '#cdd7e4'; ctx.lineWidth = 7;
  if (p.arms === 'up') {
    ctx.beginPath(); ctx.moveTo(x - 8, sh + 4); ctx.lineTo(x - 20, sh - 40); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 8, sh + 4); ctx.lineTo(x + 20, sh - 40); ctx.stroke();
  } else if (p.arms === 'carry') {
    ctx.beginPath(); ctx.moveTo(x - 6, sh + 6); ctx.lineTo(x + p.dir * 26, sh + 34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 6, sh + 6); ctx.lineTo(x + p.dir * 30, sh + 40); ctx.stroke();
  } else if (p.arms === 'front') {
    ctx.beginPath(); ctx.moveTo(x - 6, sh + 6); ctx.lineTo(x + p.dir * 30, sh + 26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 6, sh + 8); ctx.lineTo(x + p.dir * 34, sh + 34); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(x - 8, sh + 4); ctx.lineTo(x - 14, hip + 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 8, sh + 4); ctx.lineTo(x + 14, hip + 8); ctx.stroke();
  }
  // head + helmet
  ctx.fillStyle = '#e8b98a'; ctx.beginPath(); ctx.arc(x, headY, 15, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x, headY - 3, 15, Math.PI, 2 * Math.PI); ctx.fill();
  ctx.fillRect(x - 17, headY - 5, 34, 4);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------- scenario runner --------------------------------------------------
export class ScenarioRunner {
  constructor(scenario) {
    this.sc = scenario;
    this.e = {};
    this.clips = [];
    this.t = 0;
    scenario.build(this.api());
  }
  api() {
    const self = this;
    return {
      add: (name, ent) => { self.e[name] = ent; return ent; },
      clip: (dur, fn) => self.clips.push({ dur, fn, start: self.clips.reduce((a, c) => a + c.dur, 0) }),
      wait: (dur) => self.clips.push({ dur, fn: () => {}, start: self.clips.reduce((a, c) => a + c.dur, 0) }),
    };
  }
  get duration() { return this.sc.dur; }

  applyTo(t) {
    for (const c of this.clips) {
      const p = Math.max(0, Math.min(1, (t - c.start) / c.dur));
      if (t < c.start) break;
      c.fn(this.e, p, c.start + p * c.dur);
    }
    this.physics(t);
  }

  physics(t) {
    for (const e of Object.values(this.e)) {
      if (e.kind === 'person') continue;
      if (e.flight) {
        const tr = t - e.flight.t0;
        const y = e.flight.y0 + (e.flight.vy0 || 0) * tr + 0.5 * G * tr * tr;
        e.x = e.flight.x0 + (e.flight.vx || 0) * tr;
        e.y = Math.min(FLOOR, y);
        if (y >= FLOOR) { e.flight = null; e.landedAt = t; }
      } else if (e.roll) {
        const tr = t - e.roll.t0;
        const v = e.roll.v0 - e.roll.decel * tr;
        if (v <= 0) { e.x = e.roll.x0 + (e.roll.v0 * e.roll.v0) / (2 * e.roll.decel); e.roll = null; }
        else e.x = e.roll.x0 + e.roll.v0 * tr - 0.5 * e.roll.decel * tr * tr;
      }
    }
  }

  step(dt) { this.t = Math.min(this.duration + 2, this.t + dt); this.applyTo(this.t); }
  seek(t) { this.t = t; this.applyTo(t); }
  done() { return this.t >= this.duration; }

  detections() {
    const dets = [];
    for (const e of Object.values(this.e)) {
      if (e.kind === 'person') {
        dets.push(det('person', 'person', e.x - e.w / 2, e.y - e.h, e.w, e.h));
      } else {
        dets.push(det(e.kind, e.kind, e.x - e.w / 2, e.y - e.h, e.w, e.h));
      }
    }
    return dets;
  }

  draw(ctx) {
    drawScene(ctx, this.sc);
    const ents = Object.values(this.e).sort((a, b) => (a.kind === 'person' ? 1 : 0) - (b.kind === 'person' ? 1 : 0));
    for (const e of ents) drawEntity(ctx, e, this.t);
  }
}

function det(label, cls, x, y, w, h) {
  const j = () => (Math.random() - 0.5) * 2;
  return {
    label, cls, score: 0.9 + Math.random() * 0.09,
    x: (x + j()) / W, y: (y + j()) / H, w: w / W, h: h / H,
  };
}

// ---------- movement helpers (all positions absolute => seekable) ------------
const ease = p => p * p * (3 - 2 * p);
function walkTo(p, x0, x1, k) {
  p.x = x0 + (x1 - x0) * ease(k);
  p.moving = true; p.dir = x1 >= x0 ? 1 : -1; p.arms = 'idle';
}
function stopWalk(p) { p.moving = false; }
function holdAt(p, b, y, dx = 26) { b.x = p.x + p.dir * dx; b.y = y; }
function bend(p, k) { p.crouch = Math.sin(Math.PI * Math.min(1, k)) * 0.9; }
function release(b, t, vx = 0, vy0 = 0) { if (!b.flight && !b.landedAt) b.flight = { t0: t, x0: b.x, y0: b.y, vx, vy0 }; }
function startRoll(b, t, v0, decel = 55) { if (!b.roll && !b.landedAt) b.roll = { t0: t, x0: b.x, v0, decel }; }

// ---------- scenarios --------------------------------------------------------
export const SCENARIOS = [
  {
    id: 'drop-high', title: 'Drop from shoulder height', expect: 'BOX_DROP - Critical',
    dur: 11.5,
    build(api) {
      const p = api.add('p', mkPerson(110));
      const C = api.add('c', mkCarton(215, 100));
      api.clip(1.5, (e, k) => { walkTo(e.p, 110, 208, k); e.p.arms = 'front'; });
      api.clip(0.8, (e, k) => { stopWalk(e.p); bend(e.p, k); if (k > 0.55) holdAt(e.p, e.c, FLOOR - 40 * (k - 0.55) / 0.45, 18); });
      api.clip(0.9, (e, k) => { e.p.crouch = 0.9 * (1 - k); holdAt(e.p, e.c, CARRY_Y, 24); e.p.arms = 'carry'; });
      api.clip(2.1, (e, k) => { walkTo(e.p, 208, 690, k); holdAt(e.p, e.c, CARRY_Y, 24); });
      api.clip(0.8, (e, k) => { stopWalk(e.p); e.p.arms = 'up'; holdAt(e.p, e.c, CARRY_Y + (OVERHEAD_Y - CARRY_Y) * ease(k), 16); });
      api.clip(0.5, (e) => { e.p.arms = 'up'; });
      api.clip(2.4, (e, k, t) => { if (k > 0.06 && !e.c.flight) release(e.c, t, 0, 0); e.p.arms = 'front'; });
      api.clip(1.4, (e, k) => { walkTo(e.p, 690, 780, k); });
      api.clip(1.1, (e) => { stopWalk(e.p); });
    },
  },
  {
    id: 'gentle-place', title: 'Correct gentle placement', expect: 'GOOD_PLACE - Good practice',
    dur: 10.5,
    build(api) {
      const p = api.add('p', mkPerson(110));
      api.add('tr', mkTrolley(70));
      const C = api.add('c', mkCarton(190, 96));
      api.clip(1.2, (e, k) => { walkTo(e.p, 110, 185, k); e.p.arms = 'front'; });
      api.clip(0.8, (e, k) => { stopWalk(e.p); bend(e.p, k); if (k > 0.55) holdAt(e.p, e.c, FLOOR - 40 * (k - 0.55) / 0.45, 18); });
      api.clip(0.9, (e, k) => { e.p.crouch = 0.9 * (1 - k); holdAt(e.p, e.c, CARRY_Y, 24); e.p.arms = 'carry'; });
      api.clip(1.9, (e, k) => { walkTo(e.p, 185, 300, k); holdAt(e.p, e.c, CARRY_Y, 24); });
      api.clip(1.6, (e, k) => { stopWalk(e.p); e.p.crouch = 0.75 * ease(k); holdAt(e.p, e.c, CARRY_Y + (FLOOR - CARRY_Y) * ease(k), 20); e.p.arms = 'front'; });
      api.clip(2.6, (e) => { e.p.crouch = 0; e.p.arms = 'idle'; stopWalk(e.p); });
      api.clip(1.3, (e, k) => { walkTo(e.p, 300, 400, k); });
    },
  },
  {
    id: 'throw', title: 'Carton thrown to dock', expect: 'THROW - Critical',
    dur: 11,
    build(api) {
      const p = api.add('p', mkPerson(130));
      const C = api.add('c', mkCarton(215, 96));
      api.clip(1.3, (e, k) => { walkTo(e.p, 130, 208, k); e.p.arms = 'front'; });
      api.clip(0.8, (e, k) => { stopWalk(e.p); bend(e.p, k); if (k > 0.55) holdAt(e.p, e.c, FLOOR - 40 * (k - 0.55) / 0.45, 18); });
      api.clip(0.9, (e, k) => { e.p.crouch = 0.9 * (1 - k); holdAt(e.p, e.c, CARRY_Y, 24); e.p.arms = 'carry'; });
      api.clip(0.9, (e, k) => { e.p.dir = 1; holdAt(e.p, e.c, CARRY_Y - 20 * Math.sin(Math.PI * k), 30 - 26 * k); e.p.arms = 'carry'; });
      api.clip(2.6, (e, k, t) => { if (k > 0.05 && !e.c.flight) release(e.c, t, 720, -220); e.p.arms = 'front'; });
      api.clip(2.2, (e, k) => { walkTo(e.p, 208, 560, k); });
      api.clip(1.9, (e) => { stopWalk(e.p); });
    },
  },
  {
    id: 'drag', title: 'Carton dragged across floor', expect: 'DRAG - High',
    dur: 13,
    build(api) {
      const p = api.add('p', mkPerson(130));
      const C = api.add('c', mkCarton(215, 100));
      api.clip(1.2, (e, k) => { walkTo(e.p, 130, 172, k); e.p.arms = 'front'; });
      api.clip(0.7, (e, k) => { stopWalk(e.p); e.p.crouch = 0.5 * Math.min(1, k * 1.4); });
      api.clip(4.6, (e, k) => { e.p.crouch = 0.45; e.p.arms = 'front'; walkTo(e.p, 172, 660, k); e.c.x = e.p.x + 44; e.c.y = FLOOR; });
      api.clip(1.0, (e) => { e.p.crouch = 0; e.p.arms = 'idle'; stopWalk(e.p); });
      api.clip(1.6, (e, k) => { walkTo(e.p, 660, 740, k); });
      api.clip(2.4, (e) => { stopWalk(e.p); });
    },
  },
  {
    id: 'stack-large-on-small', title: 'Large packet stacked on smaller packet', expect: 'IMPROPER_STACK - High',
    dur: 12,
    build(api) {
      const p = api.add('p', mkPerson(110));
      const S = api.add('s', mkCarton(255, 70, { fragile: false }));
      const L = api.add('l', mkCarton(150, 118, { tag: null }));
      api.clip(1.2, (e, k) => { walkTo(e.p, 110, 148, k); e.p.arms = 'front'; });
      api.clip(0.8, (e, k) => { stopWalk(e.p); bend(e.p, k); if (k > 0.55) holdAt(e.p, e.l, FLOOR - 40 * (k - 0.55) / 0.45, 18); });
      api.clip(0.9, (e, k) => { e.p.crouch = 0.9 * (1 - k); holdAt(e.p, e.l, CARRY_Y, 24); e.p.arms = 'carry'; });
      api.clip(1.8, (e, k) => { walkTo(e.p, 148, 208, k); holdAt(e.p, e.l, CARRY_Y, 47); });
      api.clip(1.2, (e, k) => { stopWalk(e.p); e.p.crouch = 0.4 * ease(k); holdAt(e.p, e.l, CARRY_Y + (FLOOR - 43 - CARRY_Y) * ease(k), 47); e.p.arms = 'front'; });
      api.clip(2.2, (e) => { e.p.crouch = 0; stopWalk(e.p); });
      api.clip(1.4, (e, k) => { walkTo(e.p, 208, 330, k); });
      api.clip(1.7, (e) => { stopWalk(e.p); });
    },
  },
  {
    id: 'stack-overhang', title: 'Unstable stack - packet overhanging edge', expect: 'UNSTABLE_STACK - High',
    dur: 12.5,
    build(api) {
      const p = api.add('p', mkPerson(110));
      api.add('pal', mkPallet(780, 230));
      const B1 = api.add('b1', mkCarton(780, 100));
      B1.y = FLOOR - 26;
      const B2 = api.add('b2', mkCarton(160, 100));
      api.clip(1.2, (e, k) => { walkTo(e.p, 110, 155, k); e.p.arms = 'front'; });
      api.clip(0.8, (e, k) => { stopWalk(e.p); bend(e.p, k); if (k > 0.55) holdAt(e.p, e.b2, FLOOR - 40 * (k - 0.55) / 0.45, 18); });
      api.clip(0.9, (e, k) => { e.p.crouch = 0.9 * (1 - k); holdAt(e.p, e.b2, CARRY_Y, 24); e.p.arms = 'carry'; });
      api.clip(2.3, (e, k) => { walkTo(e.p, 155, 700, k); holdAt(e.p, e.b2, CARRY_Y, 24); });
      api.clip(1.2, (e, k) => { stopWalk(e.p); e.p.crouch = 0.35 * ease(k); holdAt(e.p, e.b2, CARRY_Y + ((FLOOR - 26 - 62) - CARRY_Y) * ease(k), 40); e.p.arms = 'front'; });
      api.clip(2.4, (e) => { e.p.crouch = 0; stopWalk(e.p); });
      api.clip(1.5, (e, k) => { walkTo(e.p, 700, 790, k); });
      api.clip(2.2, (e) => { stopWalk(e.p); });
    },
  },
  {
    id: 'out-of-zone', title: 'Product left outside designated area', expect: 'OUT_OF_ZONE - Medium',
    dur: 12,
    build(api) {
      const p = api.add('p', mkPerson(110));
      const C = api.add('c', mkCarton(185, 96));
      api.clip(1.2, (e, k) => { walkTo(e.p, 110, 180, k); e.p.arms = 'front'; });
      api.clip(0.8, (e, k) => { stopWalk(e.p); bend(e.p, k); if (k > 0.55) holdAt(e.p, e.c, FLOOR - 40 * (k - 0.55) / 0.45, 18); });
      api.clip(0.9, (e, k) => { e.p.crouch = 0.9 * (1 - k); holdAt(e.p, e.c, CARRY_Y, 24); e.p.arms = 'carry'; });
      api.clip(2.0, (e, k) => { walkTo(e.p, 180, 460, k); holdAt(e.p, e.c, CARRY_Y, 24); });
      api.clip(1.5, (e, k) => { stopWalk(e.p); e.p.crouch = 0.7 * ease(k); holdAt(e.p, e.c, CARRY_Y + (FLOOR - CARRY_Y) * ease(k), 20); e.p.arms = 'front'; });
      api.clip(3.2, (e) => { e.p.crouch = 0; e.p.arms = 'idle'; });
      api.clip(1.2, (e, k) => { walkTo(e.p, 460, 560, k); });
      api.clip(1.2, (e) => { stopWalk(e.p); });
    },
  },
  {
    id: 'manual-carry', title: 'Heavy carton carried manually across bay', expect: 'NO_EQUIPMENT - High',
    dur: 14,
    build(api) {
      const p = api.add('p', mkPerson(110));
      api.add('tr', mkTrolley(60));
      const Hc = api.add('h', mkCarton(200, 124, { tag: 'HEAVY' }));
      api.clip(1.2, (e, k) => { walkTo(e.p, 110, 193, k); e.p.arms = 'front'; });
      api.clip(0.8, (e, k) => { stopWalk(e.p); bend(e.p, k); if (k > 0.55) holdAt(e.p, e.h, FLOOR - 40 * (k - 0.55) / 0.45, 18); });
      api.clip(0.9, (e, k) => { e.p.crouch = 0.9 * (1 - k); holdAt(e.p, e.h, CARRY_Y, 24); e.p.arms = 'carry'; });
      api.clip(4.6, (e, k) => { walkTo(e.p, 193, 840, k); holdAt(e.p, e.h, CARRY_Y, 24); });
      api.clip(1.4, (e, k) => { stopWalk(e.p); e.p.crouch = 0.7 * ease(k); holdAt(e.p, e.h, CARRY_Y + (FLOOR - CARRY_Y) * ease(k), 20); e.p.arms = 'front'; });
      api.clip(2.0, (e) => { e.p.crouch = 0; e.p.arms = 'idle'; });
      api.clip(1.5, (e, k) => { walkTo(e.p, 840, 740, k); });
      api.clip(1.4, (e) => { stopWalk(e.p); });
    },
  },
  {
    id: 'step-on-box', title: 'Operator steps on carton', expect: 'STEP_ON - High',
    dur: 11,
    build(api) {
      const p = api.add('p', mkPerson(300));
      const C = api.add('c', mkCarton(330, 100));
      api.clip(1.3, (e, k) => { walkTo(e.p, 300, 288, k); });
      api.clip(0.7, (e, k) => { walkTo(e.p, 288, 328, k); });
      api.clip(0.6, (e, k) => { stopWalk(e.p); e.p.x = 330 + (k - 0.5) * 6; e.p.y = FLOOR - 62 * ease(k); });
      api.clip(1.8, (e) => { e.p.y = FLOOR - 62; e.p.moving = false; });
      api.clip(0.6, (e, k) => { e.p.y = FLOOR - 62 + 62 * ease(k); });
      api.clip(1.4, (e, k) => { walkTo(e.p, 333, 430, k); });
      api.clip(2.0, (e) => { stopWalk(e.p); });
      api.clip(2.6, (e) => { stopWalk(e.p); });
    },
  },
  {
    id: 'rolling', title: 'Carton rolled across the floor', expect: 'ROLLING - Medium',
    dur: 11.5,
    build(api) {
      const p = api.add('p', mkPerson(150));
      const C = api.add('c', mkCarton(230, 96));
      api.clip(1.1, (e, k) => { walkTo(e.p, 150, 190, k); e.p.arms = 'front'; });
      api.clip(0.6, (e) => { stopWalk(e.p); e.p.crouch = 0.35; });
      api.clip(0.6, (e, k) => { e.p.crouch = 0.35; e.p.arms = 'front'; walkTo(e.p, 190, 235, k); e.c.x = e.p.x + 52; e.c.y = FLOOR; });
      api.clip(2.6, (e, k, t) => { startRoll(e.c, t, 190, 30); e.p.crouch = Math.max(0, 0.35 - k * 2); stopWalk(e.p); });
      api.clip(2.4, (e) => { e.p.arms = 'idle'; stopWalk(e.p); });
      api.clip(1.7, (e, k) => { walkTo(e.p, 235, 330, k); });
      api.clip(1.7, (e) => { stopWalk(e.p); });
    },
  },
  {
    id: 'overreach', title: 'Loading above safe reach height', expect: 'OVERREACH - Medium',
    dur: 12.5, showShelf: true,
    build(api) {
      const p = api.add('p', mkPerson(110));
      const C = api.add('c', mkCarton(190, 92));
      api.clip(1.2, (e, k) => { walkTo(e.p, 110, 185, k); e.p.arms = 'front'; });
      api.clip(0.8, (e, k) => { stopWalk(e.p); bend(e.p, k); if (k > 0.55) holdAt(e.p, e.c, FLOOR - 40 * (k - 0.55) / 0.45, 18); });
      api.clip(0.9, (e, k) => { e.p.crouch = 0.9 * (1 - k); holdAt(e.p, e.c, CARRY_Y, 24); e.p.arms = 'carry'; });
      api.clip(2.2, (e, k) => { walkTo(e.p, 185, 660, k); holdAt(e.p, e.c, CARRY_Y, 24); });
      api.clip(1.6, (e, k) => { stopWalk(e.p); e.p.arms = 'up'; holdAt(e.p, e.c, CARRY_Y + (104 - CARRY_Y) * ease(k), 12); });
      api.clip(2.6, (e) => { e.p.arms = 'up'; stopWalk(e.p); });
      api.clip(1.4, (e, k) => { e.p.arms = 'idle'; walkTo(e.p, 660, 580, k); });
      api.clip(1.8, (e) => { stopWalk(e.p); });
    },
  },
  {
    id: 'pallet-overhang', title: 'Long panel placed on undersized pallet', expect: 'PALLET_OVERHANG - High',
    dur: 12.5,
    build(api) {
      const p = api.add('p', mkPerson(560));
      api.add('pal', mkPallet(255, 200));
      const L = api.add('l', mkCarton(640, 276));
      api.clip(1.2, (e, k) => { walkTo(e.p, 560, 636, k); e.p.arms = 'front'; });
      api.clip(0.8, (e, k) => { stopWalk(e.p); bend(e.p, k); if (k > 0.55) holdAt(e.p, e.l, FLOOR - 40 * (k - 0.55) / 0.45, 18); });
      api.clip(0.9, (e, k) => { e.p.crouch = 0.9 * (1 - k); holdAt(e.p, e.l, CARRY_Y, 24); e.p.arms = 'carry'; });
      api.clip(2.2, (e, k) => { walkTo(e.p, 636, 330, k); holdAt(e.p, e.l, CARRY_Y, 24); });
      api.clip(1.2, (e, k) => { stopWalk(e.p); e.p.crouch = 0.45 * ease(k); holdAt(e.p, e.l, CARRY_Y + ((FLOOR - 26) - CARRY_Y) * ease(k), 22); e.p.arms = 'front'; });
      api.clip(2.4, (e) => { e.p.crouch = 0; stopWalk(e.p); });
      api.clip(1.5, (e, k) => { walkTo(e.p, 330, 430, k); });
      api.clip(2.3, (e) => { stopWalk(e.p); });
    },
  },
];

export function scenarioById(id) { return SCENARIOS.find(s => s.id === id); }

// Runs several scenarios back-to-back for a full demo / recording
export class ChainRunner {
  constructor(ids) {
    this.runners = ids.map(id => new ScenarioRunner(scenarioById(id)));
    this.idx = 0;
    this.finished = false;
  }
  get current() { return this.runners[Math.min(this.idx, this.runners.length - 1)]; }
  get duration() { return this.runners.reduce((a, r) => a + r.duration, 0); }
  step(dt) {
    if (this.finished) { this.current.step(dt); return; }
    this.current.step(dt);
    if (this.current.done()) {
      this.idx++;
      if (this.idx >= this.runners.length) this.finished = true;
    }
  }
  detections() { return this.current.detections(); }
  draw(ctx) { this.current.draw(ctx); }
  progressLabel() {
    return this.finished ? 'Demo complete' : `Scenario ${this.idx + 1}/${this.runners.length}: ${this.current.sc.title}`;
  }
}
