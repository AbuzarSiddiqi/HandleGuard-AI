// Dashboard: KPIs + dependency-free SVG charts, all computed from the event store
import { SEVERITY, BEHAVIOURS, BAYS } from './config.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderKpis(el, events) {
  const bad = events.filter(e => e.severity !== 'good');
  const hi = bad.filter(e => e.severity === 'high' || e.severity === 'critical');
  const good = events.length - bad.length;
  const avgScore = bad.length ? Math.round(bad.reduce((a, e) => a + (e.score || 0), 0) / bad.length) : 0;
  const prevented = hi.length; // high-risk events surfaced before damage confirmed
  const kpis = [
    { v: events.length, l: 'Events detected', s: `${good} good practices observed` },
    { v: hi.length, l: 'High / Critical risks', s: 'requiring supervisor review' },
    { v: prevented, l: 'Damage-prevention interventions', s: 'potential damage events caught early' },
    { v: avgScore, l: 'Avg risk score', s: 'transparent factor-weighted model' },
    { v: events.length ? Math.min(99, Math.round(100 * good / Math.max(1, events.length))) + '%' : '-', l: 'Safe handling rate', s: 'good placements / total events' },
  ];
  el.innerHTML = kpis.map(k => `<div class="kpi"><div class="k-val">${k.v}</div><div class="k-label">${k.l}</div><div class="k-sub">${k.s}</div></div>`).join('');
}

export function barsSVG(items, colorFn, width = 320) {
  if (!items.length) return '<div class="empty-note">No data yet - run a scenario.</div>';
  const max = Math.max(...items.map(i => i.n), 1);
  const rows = items.map(i => `
    <div class="bar-row"><span title="${esc(i.k)}">${esc(i.k.length > 24 ? i.k.slice(0, 23) + '…' : i.k)}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${(i.n / max * 100).toFixed(0)}%;background:${colorFn(i)}"></div></div>
    <span class="bar-num">${i.n}</span></div>`).join('');
  return rows;
}

export function donutSVG(counts) {
  const entries = Object.entries(counts).filter(([k]) => SEVERITY[k]);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (!total) return '<div class="empty-note">No data yet - run a scenario.</div>';
  const R = 52, C = 2 * Math.PI * R;
  let off = 0, segs = '';
  for (const [k, n] of entries) {
    const frac = n / total;
    segs += `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${SEVERITY[k].color}" stroke-width="20"
      stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-off * C).toFixed(1)}"
      transform="rotate(-90 70 70)"/>`;
    off += frac;
  }
  const legend = entries.map(([k, n]) => `<span><i style="background:${SEVERITY[k].color}"></i>${SEVERITY[k].label} (${n})</span>`).join('');
  return `<div style="display:grid;place-items:center;padding:6px 0 2px">
    <svg width="140" height="140">${segs}
      <text x="70" y="66" text-anchor="middle" fill="#e8edf3" font-size="24" font-weight="800" font-family="ui-monospace">${total}</text>
      <text x="70" y="84" text-anchor="middle" fill="#8b98a7" font-size="10">events</text></svg>
    <div class="legend" style="flex-direction:column;gap:4px;align-items:flex-start">${legend}</div></div>`;
}

export function timelineSVG(events) {
  if (!events.length) return '<div class="empty-note">No data yet - run a scenario.</div>';
  const W = 860, Ht = 130, N = 40;
  const tMax = Math.max(...events.map(e => e.t), 10);
  const buckets = new Array(N).fill(0);
  const badB = new Array(N).fill(0);
  for (const e of events) {
    const b = Math.min(N - 1, Math.floor(e.t / tMax * N));
    buckets[b]++;
    if (e.severity !== 'good') badB[b]++;
  }
  const max = Math.max(...buckets, 1);
  const pts = buckets.map((n, i) => `${(i / (N - 1) * W).toFixed(1)},${(Ht - 14 - n / max * (Ht - 30)).toFixed(1)}`).join(' ');
  const badPts = badB.map((n, i) => `${(i / (N - 1) * W).toFixed(1)},${(Ht - 14 - n / max * (Ht - 30)).toFixed(1)}`).join(' ');
  return `<svg width="100%" viewBox="0 0 ${W} ${Ht}">
    <line x1="0" y1="${Ht - 14}" x2="${W}" y2="${Ht - 14}" stroke="#263140"/>
    <polyline points="${pts}" fill="none" stroke="#4c9ffe" stroke-width="2"/>
    <polyline points="${badPts}" fill="none" stroke="#ff3b30" stroke-width="2"/>
  </svg><div class="legend"><span><i style="background:#4c9ffe"></i>All events</span><span><i style="background:#ff3b30"></i>Risky events</span></div>`;
}

export function goodBadSVG(events) {
  const good = events.filter(e => e.severity === 'good').length;
  const bad = events.length - good;
  if (!events.length) return '<div class="empty-note">No data yet - run a scenario.</div>';
  const tot = Math.max(1, good + bad);
  return `<div style="padding-top:14px">
    ${barsSVG([{ k: 'Good practices', n: good }, { k: 'Risky behaviours', n: bad }], i => i.k.startsWith('Good') ? '#2fbf71' : '#ff3b30')}
    <div class="legend"><span><i style="background:#2fbf71"></i>Reinforce these</span><span><i style="background:#ff3b30"></i>Coach these</span></div></div>`;
}

export function shiftSummary(events) {
  if (!events.length) return 'Run a scenario or upload footage to generate the shift summary.';
  const bad = events.filter(e => e.severity !== 'good');
  const good = events.length - bad.length;
  const bySev = {};
  for (const e of bad) bySev[e.severity] = (bySev[e.severity] || 0) + 1;
  const byType = {};
  for (const e of bad) byType[e.behaviour] = (byType[e.behaviour] || 0) + 1;
  const top = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const byBay = {};
  for (const e of bad) byBay[e.bay] = (byBay[e.bay] || 0) + 1;
  const worstBay = Object.entries(byBay).sort((a, b) => b[1] - a[1])[0];
  const hi = bad.filter(e => e.severity === 'high' || e.severity === 'critical').length;
  const lines = [];
  lines.push(`This session the system analysed handling activity and logged ${events.length} events: ${good} correct practices and ${bad.length} risky behaviours (${Object.entries(bySev).map(([s, n]) => `${n} ${SEVERITY[s].label.toLowerCase()}`).join(', ') || 'none'}).`);
  if (top.length) lines.push(`The most frequent risky behaviours were ${top.map(([b, n]) => `${b} (${n}x)`).join(', ')}.`);
  if (worstBay) lines.push(`${worstBay[0]} recorded the highest risky-event count (${worstBay[1]}), making it the priority for supervisor attention.`);
  if (hi) lines.push(`${hi} high/critical events were surfaced in real time - each one represents a potential product damage caught before it could be confirmed, the shift from damage detection to damage prevention.`);
  const train = [...new Set(bad.map(e => e.training).filter(Boolean))].slice(0, 3);
  if (train.length) lines.push(`Recommended training focus: ${train.join('; ')}.`);
  return lines.join('\n\n');
}

// ---------- insights view ----------
export function renderInsights(els, events) {
  const bad = events.filter(e => e.severity !== 'good');
  // recurring
  const byType = {};
  for (const e of bad) { (byType[e.behaviour] = byType[e.behaviour] || { n: 0, sev: e.severity }); byType[e.behaviour].n++; }
  const rec = Object.entries(byType).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  els.recurring.innerHTML = rec.length
    ? rec.map(([b, v]) => `<div class="insight-item"><span class="n">${v.n}x</span><span>${esc(b)} <span style="color:var(--muted)">- ${SEVERITY[v.sev].label}</span></span></div>`).join('')
    : '<div class="empty-note">No risky behaviours yet.</div>';
  // locations
  const byWhere = {};
  for (const e of bad) { (byWhere[e.where || e.bay] = byWhere[e.where || e.bay] || { n: 0 }); byWhere[e.where || e.bay].n++; }
  const locs = Object.entries(byWhere).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  els.locations.innerHTML = locs.length
    ? locs.map(([w, v]) => `<div class="insight-item"><span class="n">${v.n}x</span><span>${esc(w)}</span></div>`).join('')
    : '<div class="empty-note">No location data yet.</div>';
  // training
  const train = {};
  for (const e of bad) if (e.training) train[e.training] = (train[e.training] || 0) + 1;
  const tr = Object.entries(train).sort((a, b) => b[1] - a[1]).slice(0, 6);
  els.training.innerHTML = tr.length
    ? tr.map(([t, n]) => `<div class="insight-item"><span class="n">${n}x</span><span>${esc(t)}</span></div>`).join('')
    : '<div class="empty-note">No training gaps identified yet.</div>';
  // playbook
  const seen = new Set();
  const rows = [];
  for (const e of bad) {
    if (seen.has(e.rule) || !e.corrective) continue;
    seen.add(e.rule);
    rows.push(`<div class="pb-row"><span class="pb-bad">${esc(e.behaviour)}</span><span class="pb-arrow">&rarr;</span><span class="pb-good">${esc(e.corrective)}</span></div>`);
  }
  els.playbook.innerHTML = rows.length ? rows.join('') : '<div class="empty-note">Run scenarios to build the playbook.</div>';
}
