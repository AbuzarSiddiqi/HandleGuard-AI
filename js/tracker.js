// Multi-object tracker: IoU + label matching, velocity smoothing, kinematic state (fall, rest, carry)
import { CFG } from './config.js';

export const M = CFG.SCENE_HEIGHT_M;               // meters per full frame height
export const toM = v => (Number.isFinite(v) ? v * M : 0); // normalized height-units -> meters
export const speedMs = tr => Math.hypot(tr.vx, tr.vy) * M;

let _nextId = 1;
export function resetTracker() { _nextId = 1; }

export function iou(a, b) {
  const ax0 = a.x, ay0 = a.y, ax1 = a.x + a.w, ay1 = a.y + a.h;
  const bx0 = b.x, by0 = b.y, bx1 = b.x + b.w, by1 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const iy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

export function xOverlap(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  return ix / Math.max(0.0001, Math.min(a.w, b.w));
}

const SAME_LABEL = (a, b) => a.label === b.label ||
  (a.cls !== 'person' && b.cls !== 'person');

export class Tracker {
  constructor() { this.tracks = []; }

  update(dets, t) {
    const tracks = this.tracks;
    for (const tr of tracks) tr._matched = false;

    // Greedy best-IoU matching
    const pairs = [];
    for (let i = 0; i < tracks.length; i++)
      for (let j = 0; j < dets.length; j++)
        if (SAME_LABEL(tracks[i], dets[j])) {
          const ov = iou(tracks[i], dets[j]);
          if (ov > 0.12) pairs.push([ov, i, j]);
        }
    pairs.sort((a, b) => b[0] - a[0]);
    const usedD = new Set();
    for (const [ov, i, j] of pairs) {
      if (tracks[i]._matched || usedD.has(j)) continue;
      tracks[i]._matched = true; usedD.add(j);
      this._apply(tracks[i], dets[j], t);
    }
    for (let j = 0; j < dets.length; j++) {
      if (usedD.has(j)) continue;
      const tr = this._spawn(dets[j], t);
      tracks.push(tr);
    }
    // Coast & cull
    for (const tr of tracks) {
      if (!tr._matched) {
        if (t - tr.lastSeen > CFG.COAST_S) tr.dead = true;
      }
    }
    this.tracks = tracks.filter(tr => !tr.dead);
    return this.tracks;
  }

  _spawn(d, t) {
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    const tr = {
      id: _nextId++, label: d.label, cls: d.cls, score: d.score,
      x: d.x, y: d.y, w: d.w, h: d.h, t,
      cx, cy,
      top: d.y, bottom: d.y + d.h, area: d.w * d.h,
      motion: !!d.motion,
      vx: 0, vy: 0, lastSeen: t, born: t,
      history: [{ t, x: cx, y: cy }],
      // kinematic state
      airborne: false, apexBottom: d.y + d.h, fallVy: 0, _prevVy: 0, recentDownVy: 0,
      restSince: (speedNow(d) < 0.14) ? t : null, moveDist: 0, dragTime: 0,
      carriedBy: null, lastCarryEnd: 0,
    };
    return tr;
  }

  _apply(tr, d, t) {
    const dt = Math.max(0.016, t - tr.t);
    const nx = d.x, ny = d.y;
    const ivx = (nx - tr.x) / dt, ivy = (ny - tr.y) / dt;
    const a = 0.45; // EMA smoothing
    tr.vx = tr.vx * (1 - a) + ivx * a;
    tr.vy = tr.vy * (1 - a) + ivy * a;
    tr.x = nx; tr.y = ny; tr.w = d.w; tr.h = d.h;
    tr.score = d.score; tr.t = t; tr.lastSeen = t;
    tr.cx = nx + tr.w / 2; tr.cy = ny + tr.h / 2;
    tr.bottom = ny + tr.h; tr.top = ny;
    tr.area = tr.w * tr.h;
    tr.motion = !!d.motion;
    tr.history.push({ t, x: tr.cx, y: tr.cy });
    if (tr.history.length > 40) tr.history.shift();

    const sp = speedMs(tr);
    const hSpeed = Math.abs(tr.vx) * M;
    // rest / movement bookkeeping
    if (sp < 0.14 && !tr.airborne && !tr.flightActive) { if (tr.restSince == null) tr.restSince = t; }
    else tr.restSince = null;
    if (sp > 0.3 && !tr.airborne) tr.moveDist += sp * dt;

    // Ballistic trajectory / throw tracking (captures mattresses & boxes thrown horizontally/upward)
    const recentlyReleased = !tr._contact && tr.lastContactT != null && (t - tr.lastContactT < 1.6);
    const fastThrowMotion = (sp > 0.60 || hSpeed > 0.55);

    if (recentlyReleased && fastThrowMotion) {
      if (!tr.flightActive) {
        tr.flightActive = true;
        tr.flightStartT = t;
        tr.flightStartX = tr.cx;
        tr.flightStartY = tr.cy;
        tr.maxFlightSpeed = sp;
        tr.flightDist = 0;
      }
      tr.flightDist = (tr.flightDist || 0) + sp * dt;
      tr.maxFlightSpeed = Math.max(tr.maxFlightSpeed || 0, sp);
      tr.airborne = true;
      // Real-time in-flight throw detection (so alerts trigger while mattress is in mid-air)
      if (tr.flightDist > 0.40 && tr.maxFlightSpeed > 0.70) {
        tr.throwInFlight = {
          t,
          hSpeed,
          launchSpeed: tr.maxFlightSpeed,
          flightDist: tr.flightDist,
          elevated: tr.bottom < CFG.FLOOR_BOTTOM - 0.06,
        };
      }
    } else if (tr.flightActive) {
      if (sp < 0.22 || tr._contact || (t - (tr.flightStartT || 0) > 2.2)) {
        if ((tr.flightDist || 0) > 0.32 && (tr.maxFlightSpeed || 0) > 0.65) {
          tr.throwEvent = {
            t,
            hSpeed,
            launchSpeed: tr.maxFlightSpeed,
            flightDist: tr.flightDist,
            elevated: tr.bottom < CFG.FLOOR_BOTTOM - 0.06,
          };
        }
        tr.flightActive = false;
        tr.airborne = false;
      }
    }

    // Vertical fall state machine (airborne = downward drop)
    const onFloor = tr.bottom > CFG.FLOOR_BOTTOM - 0.035;
    const rising = tr.vy > (tr._prevVy || 0) + 0.008;
    if (!onFloor && (tr.vy > 0.30 || (tr.vy > 0.16 && rising))) {
      if (!tr.airborne) { tr.airborne = true; tr.apexBottom = tr.bottom; tr.fallVy = 0; }
      tr.apexBottom = Math.min(tr.apexBottom, tr.bottom);
      tr.fallVy = Math.max(tr.fallVy, tr.vy);
    } else if (tr.airborne && (onFloor || tr.vy < 0.05)) {
      // landing from drop
      tr.justLanded = {
        t,
        fallM: toM(Math.max(0, CFG.FLOOR_BOTTOM - tr.apexBottom)),
        landSpeed: toM(Math.abs(tr.fallVy)),
        hSpeed: toM(Math.abs(tr.vx)),
      };
      if (!tr.flightActive) tr.airborne = false;
    } else if (onFloor && !tr.flightActive) {
      tr.airborne = false;
    }
    // peak controlled descent speed (for gentle-placement detection)
    if (tr.vy > 0) tr.recentDownVy = Math.max(tr.vy, (tr.recentDownVy || 0) * 0.93);
    tr._prevVy = tr.vy;
  }

  // person overlap: is person P physically holding/carrying track tr
  static carriedBy(tr, tracks) {
    for (const p of tracks) {
      if (p.cls !== 'person') continue;
      if (iou(p, tr) > 0.22) return p;
    }
    return null;
  }
}

function speedNow(d) { return 0; }
