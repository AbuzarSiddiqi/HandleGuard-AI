// Behaviour rules engine: temporal rules over tracked objects -> risk-scored events
import { CFG, ZONES, BEHAVIOURS, PRODUCT_CLASSES, severityFor } from './config.js';
import { iou, xOverlap, speedMs, toM } from './tracker.js';
import { scoreEvent } from './store.js';

const isBox = tr => tr.cls !== 'person';
const onFloor = tr => tr.bottom > CFG.FLOOR_BOTTOM - 0.045;
const rest = tr => tr.restSince != null && (tr.justLanded == null);

export function zoneName(cx, cy) {
  for (const [k, z] of Object.entries(ZONES)) {
    if (cx >= z.x0 && cx <= z.x1 && cy >= z.y0 && cy <= z.y1) return z.name;
  }
  return 'Walkway / unmarked area';
}

export class BehaviourEngine {
  constructor() {
    this.latches = new Map();     // key -> untilT
    this.stacks = new Map();      // upperId -> lowerId
    this.sessionCounts = {};      // type -> count (repeat-behaviour factor)
  }

  latched(key, t) { const until = this.latches.get(key); return until != null && t < until; }
  setLatch(key, t, dur) { this.latches.set(key, t + dur); }

  evaluate(tracks, t, dt, meta) {
    const events = [];
    this._dt = dt;
    for (const tr of tracks) BehaviourEngine.unlatchIfMoved(this, tr);
    this.updateContacts(tracks, t);
    for (const tr of tracks) {
      if (tr.cls === 'person') { this.stepRule(tr, tracks, t, meta, events); this.equipmentRule(tr, tracks, t, meta, events); }
      else {
        this.throwRule(tr, t, meta, events);
        this.landingRule(tr, t, meta, events);
        this.placementRule(tr, t, meta, events);
        this.dragRule(tr, tracks, t, dt, meta, events);
        this.rollingRule(tr, tracks, t, meta, events);
        this.zoneRule(tr, t, meta, events);
        this.overreachRule(tr, t, meta, events);
        this.palletRule(tr, tracks, t, meta, events);
      }
      this.stackRules(tr, tracks, t, meta, events);
    }
    this.collapseRule(tracks, t, meta, events);
    // decay latches
    for (const [k, until] of this.latches) if (t > until + 30) this.latches.delete(k);
    return events;
  }

  // ---- projectile throw: horizontal / elevated launch across loading bay ----
  throwRule(tr, t, meta, events) {
    if (tr.cls === 'person') return;
    const info = tr.throwInFlight || tr.throwEvent;
    if (!info) return;
    tr.throwInFlight = null;
    tr.throwEvent = null;

    const launchSpeed = Number.isFinite(info.launchSpeed) ? info.launchSpeed : 1.2;
    const flightDist = Number.isFinite(info.flightDist) ? info.flightDist : 0.6;
    const hSpeed = Number.isFinite(info.hSpeed) ? info.hSpeed : 0.9;

    const ev = this.fire('THROW', tr, t, [
      { name: 'Projectile release velocity', detail: launchSpeed.toFixed(1) + ' m/s', pts: Math.min(20, Math.round(launchSpeed * 7)) },
      { name: 'Airborne flight trajectory', detail: flightDist.toFixed(2) + ' m into loading bay', pts: Math.min(18, Math.round(flightDist * 14)) },
      { name: 'Handling violation', detail: 'Product thrown instead of placed gently', pts: 6 },
    ], meta, { cooldown: 4.5 });
    if (ev) events.push(ev);
  }

  fire(rule, tr, t, factors, meta, extra = {}) {
    const key = `${rule}:${tr.id}`;
    if (this.latched(key, t)) return;
    this.setLatch(key, t, extra.cooldown || 4);
    const def = BEHAVIOURS[rule];
    const { score, factors: rows } = scoreEvent(def, factors, tr);
    const severity = def.good ? 'good' : severityFor(score);
    this.sessionCounts[rule] = (this.sessionCounts[rule] || 0) + 1;
    const prod = PRODUCT_CLASSES[tr.cls] ? PRODUCT_CLASSES[tr.cls].label : tr.label;
    const where = tr.cx != null ? zoneName(tr.cx, tr.cy) : meta.bay;
    return {
      type: rule, behaviour: def.label, rule, corrective: def.corrective, training: def.training,
      trackId: tr.id, product: prod, t, bay: meta.bay, score: def.good ? null : score, severity,
      factors: rows, where, ...extra,
    };
  }

  // per-frame person<->object interaction state (held vs mere contact)
  updateContacts(tracks, t) {
    for (const tr of tracks) {
      if (tr.cls === 'person') continue;
      let held = null, contact = null;
      for (const p of tracks) {
        if (p.cls !== 'person') continue;
        const xo = xOverlap(p, tr);
        if (xo > 0.35 && tr.bottom < p.y - p.h * 0.18 && tr.bottom > p.y - p.h * 1.12) held = p;
        if (xo > 0.25) contact = p;
      }
      if (held) { tr._carrier = held; tr.lastCarriedT = t; }
      else if (t - (tr.lastCarriedT || -9) > 1.5) tr._carrier = null;
      if (contact) tr.lastContactT = t;
      tr._contact = contact;
    }
  }

  // ---- landing: drop / throw / rough impact --------------------------------
  landingRule(tr, t, meta, events) {
    const L = tr.justLanded;
    if (!L) return;
    tr.justLanded = null;
    if (tr.cls === 'person') return;
    if (this.latched('THROW:' + tr.id, t)) return; // already handled as throw
    const fallM = Number.isFinite(L.fallM) ? L.fallM : 0;
    const hSpeed = Number.isFinite(L.hSpeed) ? L.hSpeed : 0;
    const landSpeed = Number.isFinite(L.landSpeed) ? L.landSpeed : 0;
    const ev = fallM >= 0.18 && hSpeed >= 1.5
      ? this.fire('THROW', tr, t, [
          { name: 'Horizontal release speed', detail: hSpeed.toFixed(1) + ' m/s', pts: Math.min(18, Math.round(hSpeed * 5)) },
          { name: 'Fall distance', detail: fallM.toFixed(2) + ' m', pts: Math.min(12, Math.round(fallM * 8)) },
        ], meta, { evidence: L, cooldown: 5 })
      : fallM >= 0.30 && landSpeed >= 0.95
      ? this.fire('BOX_DROP', tr, t, [
          { name: 'Drop height', detail: '~' + fallM.toFixed(2) + ' m', pts: Math.min(26, Math.round(fallM * 20)) },
          { name: 'Impact speed', detail: landSpeed.toFixed(1) + ' m/s', pts: Math.min(14, Math.round(landSpeed * 6)) },
        ], meta, { evidence: L, cooldown: 5 })
      : landSpeed >= 0.85
      ? this.fire('ROUGH_IMPACT', tr, t, [
          { name: 'Impact speed', detail: landSpeed.toFixed(1) + ' m/s', pts: Math.min(15, Math.round(landSpeed * 8)) },
          { name: 'Fall distance', detail: fallM.toFixed(2) + ' m (low)', pts: 0 },
        ], meta, { evidence: L, cooldown: 5 })
      : null;
    if (ev) events.push(ev);
  }

  // ---- gentle placement: controlled set-down after a carried move ----------
  placementRule(tr, t, meta, events) {
    if (!(tr.restSince != null && t - tr.restSince < 0.5)) return;
    if (tr.airborne || !onFloor(tr)) return;
    if ((tr.moveDist || 0) < 0.35) return;
    if (toM(tr.recentDownVy || 0) > 0.6) return;
    const key = 'place:' + tr.id;
    if (this.latched(key, t)) return;
    this.setLatch(key, t, 9999);
    events.push(this.fire('GOOD_PLACE', tr, t, [], meta, { cooldown: 9999, desc: 'Product lifted and placed gently under control.' }));
  }

  // ---- dragging: box sliding on floor while an operator stays in contact ---
  dragRule(tr, tracks, t, dt, meta, events) {
    const sp = speedMs(tr);
    if (onFloor(tr) && sp > 0.25 && sp < 1.8 && tr._contact) {
      tr.dragTime = (tr.dragTime || 0) + dt;
      if (tr.dragTime > 1.1) {
        const ev = this.fire('DRAG', tr, t, [
          { name: 'Duration dragged', detail: tr.dragTime.toFixed(1) + ' s', pts: tr.dragTime > 3 ? 18 : (tr.dragTime > 2 ? 12 : 6) },
          { name: 'Drag speed', detail: sp.toFixed(1) + ' m/s', pts: 5 },
        ], meta, { cooldown: 2.6 }); // re-fires escalated (high) once duration crosses 3s
        if (ev) events.push(ev);
      }
    } else if (sp < 0.15) {
      tr.dragTime = 0;
      const key = 'DRAG:' + tr.id;
      if (this.latches.get(key) > t + 900) this.latches.set(key, t); // allow re-fire after stop
    }
  }

  // ---- rolling: box moving on floor with no one in contact -----------------
  rollingRule(tr, tracks, t, meta, events) {
    const sp = speedMs(tr);
    if (onFloor(tr) && sp > 0.5 && !tr._contact && (t - (tr.lastContactT || -9)) < 1.2) {
      const ev = this.fire('ROLLING', tr, t, [
        { name: 'Rolling speed', detail: sp.toFixed(1) + ' m/s', pts: Math.min(12, Math.round(sp * 8)) },
        { name: 'No operator in contact', detail: 'product released while moving', pts: 4 },
      ], meta, { cooldown: 6 });
      if (ev) events.push(ev);
    }
  }

  // ---- stacking: improper order, overhang ----------------------------------
  stackRules(tr, tracks, t, meta, events) {
    if (tr.motion || tr.cls === 'person') return; // Optical flow blobs are not physical stacked packages
    if (tr.bottom == null || tr.top == null) return;
    if (!(tr.restSince != null && t - tr.restSince < 0.8)) return;
    if (this.latched('stack:' + tr.id, t)) return;
    for (const lower of tracks) {
      if (lower.id === tr.id || lower.cls === 'person' || lower.cls === 'pallet' || lower.motion || lower.restSince == null) continue;
      if (lower.top == null || lower.bottom == null) continue;
      if (xOverlap(tr, lower) < 0.45) continue;
      const gap = tr.bottom - lower.top;
      if (gap < -0.03 || gap > 0.06) continue;
      this.setLatch('stack:' + tr.id, t, 9999); // until track moves again (restSince resets)
      const ratio = tr.area / Math.max(0.0001, lower.area);
      const leftOver = Math.max(0, lower.x - tr.x), rightOver = Math.max(0, (tr.x + tr.w) - (lower.x + lower.w));
      const overhang = Math.max(leftOver, rightOver) / Math.max(0.0001, tr.w);
      const fragileLower = PRODUCT_CLASSES[lower.cls] && PRODUCT_CLASSES[lower.cls].fragile;
      if (ratio > 1.35 || (fragileLower && tr.cls === 'carton')) {
        events.push(this.fire('IMPROPER_STACK', tr, t, [
          { name: 'Footprint ratio vs lower packet', detail: ratio.toFixed(2) + 'x larger on top', pts: ratio > 1.6 ? 14 : 7 },
          ...(fragileLower ? [{ name: 'Fragile product below', detail: PRODUCT_CLASSES[lower.cls].label + ' under carton', pts: 10 }] : []),
        ], meta, { cooldown: 10 }));
        this.stacks.set(tr.id, lower.id);
        return;
      }
      if (overhang > 0.28) {
        const overhangPts = Math.min(20, Math.round(overhang * 35));
        events.push(this.fire('UNSTABLE_STACK', tr, t, [
          { name: 'Overhang beyond support', detail: Math.round(overhang * 100) + '% of packet unsupported', pts: overhangPts },
        ], meta, { cooldown: 10 }));
        this.stacks.set(tr.id, lower.id);
        return;
      }
      if (ratio < 0.9 && overhang < 0.12) {
        events.push(this.fire('GOOD_PLACE', tr, t, [], meta, { cooldown: 10, desc: 'Correct stacking: smaller packet placed on larger, fully supported.' }));
      }
      return;
    }
  }

  // ---- stack collapse monitoring -------------------------------------------
  collapseRule(tracks, t, meta, events) {
    for (const [upperId, lowerId] of this.stacks) {
      const A = tracks.find(x => x.id === upperId), B = tracks.find(x => x.id === lowerId);
      if (!A || !B || A.motion || B.motion) continue;
      const grand = this.stacks.get(lowerId);
      if (grand == null) continue;
      const C = tracks.find(x => x.id === grand);
      if (!C || C.motion) continue;
      const overhang = Math.max(0, Math.max(C.x - A.x, (A.x + A.w) - (C.x + C.w))) / Math.max(0.0001, A.w);
      if (overhang > 0.25) {
        const overhangPts = Math.min(18, Math.round(overhang * 35));
        const ev = this.fire('COLLAPSE_RISK', A, t, [
          { name: 'Stack height', detail: '3+ packets', pts: 10 },
          { name: 'Top overhang', detail: Math.round(overhang * 100) + '%', pts: overhangPts },
        ], meta, { cooldown: 30 });
        if (ev) events.push(ev);
      }
    }
  }

  // ---- zoning: product / pallet outside designated areas -------------------
  zoneRule(tr, t, meta, events) {
    if (!(tr.restSince != null && t - tr.restSince > 1.2)) return;
    const key = 'zone:' + tr.id;
    if (this.latched(key, t)) return;
    const inZone = Object.values(ZONES).some(z => tr.cx >= z.x0 && tr.cx <= z.x1 && tr.cy >= z.y0 && tr.cy <= z.y1);
    if (inZone || !onFloor(tr)) return;
    // latch until it moves meaningfully
    this.setLatch(key, t, 9999);
    const rule = tr.cls === 'pallet' ? 'PALLET_MISPLACE' : 'OUT_OF_ZONE';
    events.push(this.fire(rule, tr, t, [
      { name: 'Location', detail: zoneName(tr.cx, tr.cy), pts: 8 },
      { name: 'State', detail: 'stationary outside designated area', pts: 3 },
    ], meta, { cooldown: 9999 }));
  }
  static unlatchIfMoved(engine, tr) {
    const key = 'zone:' + tr.id, skey = 'stack:' + tr.id;
    if (speedMs(tr) > 0.3) { engine.latches.delete(key); engine.latches.delete(skey); engine.stacks.delete(tr.id); }
  }

  // ---- heavy manual carry without equipment --------------------------------
  equipmentRule(person, tracks, t, meta, events) {
    for (const tr of tracks) {
      if (tr.cls === 'person' || tr._carrier !== person) continue;
      const heavy = tr.w >= 0.11 || tr.area >= 0.012;
      if (!heavy) continue;
      const sp = speedMs(person);
      if (sp > 0.3) tr.carryDist = (tr.carryDist || 0) + sp * this._dt;
      const trolleyNear = tracks.some(o => o.cls === 'trolley' && Math.hypot(o.cx - person.cx, o.cy - person.cy) < 0.22);
      if ((tr.carryDist || 0) > 1.5 && !trolleyNear) {
        const ev = this.fire('NO_EQUIPMENT', tr, t, [
          { name: 'Manual carry distance', detail: (tr.carryDist || 0).toFixed(1) + ' m', pts: Math.min(22, (tr.carryDist || 0) * 7) },
          { name: 'Estimated load', detail: 'heavy (large packet)', pts: 5 },
        ], meta, { cooldown: 20 });
        if (ev) events.push(ev);
      }
    }
  }

  // ---- stepping / standing on product ---------------------------------------
  stepRule(person, tracks, t, meta, events) {
    if (person.bottom > CFG.FLOOR_BOTTOM - 0.03) return; // standing on floor
    for (const c of tracks) {
      if (c.cls === 'person' || !onFloor(c)) continue;
      if (person.bottom > c.top - 0.05 && person.bottom < c.top + 0.06 && xOverlap(person, c) > 0.3) {
        const ev = this.fire('STEP_ON', person, t, [
          { name: 'Standing on', detail: PRODUCT_CLASSES[c.cls]?.label || 'product', pts: 10 },
        ], meta, { cooldown: 6 });
        if (ev) events.push(ev);
      }
    }
  }

  // ---- overreach: placement above safe height --------------------------------
  overreachRule(tr, t, meta, events) {
    if (tr.motion || tr.cls === 'person') return;
    if (tr.bottom == null || !Number.isFinite(tr.bottom)) return;
    if (!(tr.restSince != null && t - tr.restSince < 1.0)) return;
    const rawH = CFG.FLOOR_BOTTOM - tr.bottom;
    if (!Number.isFinite(rawH)) return;
    const h = toM(Math.max(0, rawH));
    if (!Number.isFinite(h) || h < 1.3) return;
    const key = 'overreach:' + tr.id;
    if (this.latched(key, t)) return;
    this.setLatch(key, t, 12);
    events.push(this.fire('OVERREACH', tr, t, [
      { name: 'Placement height', detail: '~' + h.toFixed(2) + ' m above floor', pts: Math.min(24, Math.round((h - 1.25) * 35)) },
      { name: 'Safe reach guideline', detail: 'placement above ~1.3 m requires equipment', pts: 0 },
    ], meta, { cooldown: 12 }));
  }

  // ---- pallet overhang --------------------------------------------------------
  palletRule(tr, tracks, t, meta, events) {
    if (!(tr.restSince != null && t - tr.restSince < 0.8)) return;
    for (const p of tracks) {
      if (p.cls !== 'pallet' || p.restSince == null) continue;
      const gap = tr.bottom - p.top;
      if (gap < -0.015 || gap > 0.05) continue;
      if (xOverlap(tr, p) < 0.4) continue;
      const ratio = tr.w / Math.max(0.0001, p.w);
      if (ratio > 1.06) {
        const ev = this.fire('PALLET_OVERHANG', tr, t, [
          { name: 'Packet vs pallet width', detail: ratio.toFixed(2) + 'x pallet width', pts: Math.min(15, (ratio - 1) * 60) },
        ], meta, { cooldown: 8 });
        if (ev) events.push(ev);
      }
      return;
    }
  }
}
