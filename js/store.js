// Event store: holds detected events, persistence, subscriptions
import { CFG } from './config.js';

const LS_KEY = 'handleguard_events_v1';
let _nextEventId = 1;

export class EventStore {
  constructor() {
    this.events = [];
    this.listeners = [];
    this._restore();
  }
  subscribe(fn) { this.listeners.push(fn); }
  _emit() { for (const fn of this.listeners) fn(this.events); }

  add(evt) {
    if (!evt.id) {
      evt.id = 'E-' + String(_nextEventId++).padStart(3, '0');
    }
    evt.wall = Date.now();
    this.events.unshift(evt);
    if (this.events.length > CFG.MAX_EVENTS) this.events.pop();
    this._persist();
    this._emit();
    return evt;
  }

  clear() {
    this.events = [];
    _nextEventId = 1;
    this._persist();
    this._emit();
  }

  countsBy(fn) {
    const m = {};
    for (const e of this.events) { const k = fn(e); m[k] = (m[k] || 0) + 1; }
    return m;
  }
  badEvents() { return this.events.filter(e => e.severity !== 'good'); }
  goodCount() { return this.events.filter(e => e.severity === 'good').length; }

  _persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.events));
    } catch (e) {
      try {
        const slim = this.events.map(ev => ({ ...ev, thumb: null }));
        localStorage.setItem(LS_KEY, JSON.stringify(slim));
      } catch (e2) { /* storage unavailable - session only */ }
    }
  }
  _restore() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        this.events = JSON.parse(raw) || [];
        for (const e of this.events) {
          const m = /^E-(\d+)$/.exec(e.id || '');
          if (m) _nextEventId = Math.max(_nextEventId, parseInt(m[1], 10) + 1);
        }
      }
    } catch (e) { this.events = []; }
  }
}

// Transparent risk model: base behaviour weight + evidence factors -> 0..100 -> category
export function scoreEvent(rule, factors = [], track = null) {
  const basePts = (rule && Number.isFinite(rule.base)) ? rule.base : 40;
  let score = basePts;
  const rows = [{ name: 'Behaviour type', detail: (rule && rule.label) || 'Handling event', pts: basePts }];
  for (const f of factors) {
    const pts = Math.round(Number.isFinite(f.pts) ? f.pts : 0);
    score += pts;
    rows.push({ ...f, pts });
  }
  score = Math.max(5, Math.min(100, Math.round(Number.isFinite(score) ? score : 45)));
  return { score, factors: rows };
}
