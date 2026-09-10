// Grounded AI assistant: answers are generated ONLY from the event store (no invention).
import { SEVERITY } from './config.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const SUGGESTED = [
  'Show me all high-risk handling events',
  'What were the most common risky behaviours?',
  'Which camera bay had the most risky events?',
  'Summarize this shift for me',
  'Why was the last critical event flagged?',
  'What corrective actions do you recommend?',
  'How many good handling practices did you observe?',
  'Are risky events trending up or down?',
];

export function answer(q, events) {
  const s = q.toLowerCase();
  const bad = events.filter(e => e.severity !== 'good');
  const hi = bad.filter(e => e.severity === 'high' || e.severity === 'critical');
  const has = (...words) => words.some(w => s.includes(w));

  // event-specific explanation: "why was E-05 ..." / "explain event 5"
  const idMatch = s.match(/e-?0*(\d+)/);
  if ((has('why', 'explain', 'detail') || s.includes('e-')) && idMatch) {
    const ev = events.find(e => e.id === 'E-' + idMatch[1].padStart(2, '0'));
    if (ev) return whyEvent(ev, events);
  }

  if (has('high risk', 'high-risk', 'critical', 'serious', 'urgent')) {
    if (!hi.length) return base(events, 'I have not detected any high or critical risk events in this session. The current events are all lower severity or good practices.');
    const rows = hi.slice(0, 8).map(e => `<li><b>${e.id}</b> [${e.score}] ${esc(e.behaviour)} - ${esc(e.product || '')} at ${esc(e.where || e.bay)}, t=${e.t.toFixed(1)}s</li>`).join('');
    return base(events, `I found <b>${hi.length} high/critical risk event(s)</b>:<ul>${rows}</ul>Open the Events tab and click <b>Replay</b> on any of them to review the incident clip.`);
  }

  if (has('common', 'frequent', 'most', 'top', 'often')) {
    if (!bad.length) return base(events, 'No risky behaviours detected yet.');
    const c = {};
    for (const e of bad) c[e.behaviour] = (c[e.behaviour] || 0) + 1;
    const top = Object.entries(c).sort((a, b) => b[1] - a[1]);
    const rows = top.slice(0, 5).map(([b, n], i) => `<li><b>#${i + 1}</b> ${esc(b)} - ${n} occurrence(s)</li>`).join('');
    return base(events, `The most common risky behaviours in this session:<ul>${rows}</ul>Each of these maps to a training topic in the Insights tab.`);
  }

  if (has('bay', 'camera', 'location', 'where', 'zone', 'area')) {
    if (!bad.length) return base(events, 'No risky events yet, so no location ranking.');
    const c = {};
    for (const e of bad) { const k = e.where || e.bay; c[k] = (c[k] || 0) + 1; }
    const top = Object.entries(c).sort((a, b) => b[1] - a[1]);
    const rows = top.map(([b, n]) => `<li>${esc(b)} - <b>${n}</b> risky event(s)</li>`).join('');
    return base(events, `Risky events by location:<ul>${rows}</ul>Consider a layout or supervision review at the top location.`);
  }

  if (has('summary', 'summarize', 'overview', 'how is', 'shift', 'report')) {
    const good = events.length - bad.length;
    const c = {};
    for (const e of bad) c[e.severity] = (c[e.severity] || 0) + 1;
    const sev = Object.entries(c).map(([k, n]) => `${n} ${SEVERITY[k].label.toLowerCase()}`).join(', ') || 'none';
    const top = Object.entries(bad.reduce((m, e) => ((m[e.behaviour] = (m[e.behaviour] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0];
    return base(events, `<b>Shift summary:</b><br>• ${events.length} total events: ${good} good practices, ${bad.length} risky (${sev}).<br>${top ? `• Top risky behaviour: <b>${esc(top[0])}</b> (${top[1]}x).<br>` : ''}${hi.length ? `• ${hi.length} event(s) need supervisor review today.<br>` : ''}• Framing: these are <b>prevention opportunities</b> - risks surfaced before damage could be confirmed.`);
  }

  if (has('corrective', 'recommend', 'fix', 'action', 'training', 'coach', 'improve')) {
    const seen = new Set(); const acts = [];
    for (const e of bad) { if (!seen.has(e.rule) && e.corrective) { seen.add(e.rule); acts.push(`<li><b>${esc(e.behaviour)}</b>: ${esc(e.corrective)}</li>`); } }
    if (!acts.length) return base(events, 'No risky behaviours detected yet - nothing to correct. Keep reinforcing the good practices I observed.');
    return base(events, `Recommended corrective actions based on detected behaviours:<ul>${acts.slice(0, 6).join('')}</ul>Training focus areas are listed per behaviour in the Insights tab.`);
  }

  if (has('good', 'safe', 'correct', 'positive', 'well')) {
    const good = events.filter(e => e.severity === 'good');
    if (!good.length) return base(events, 'I have not logged good-practice events yet. Gentle placements and correct stacking are recognized automatically when they happen.');
    const rows = good.slice(0, 5).map(e => `<li><b>${e.id}</b> ${esc(e.desc || 'Correct gentle placement')} - t=${e.t.toFixed(1)}s</li>`).join('');
    return base(events, `Yes - <b>${good.length} good handling practice(s)</b> observed:<ul>${rows}</ul>Reinforcing these matters as much as correcting risk.`);
  }

  if (has('trend', 'up or down', 'getting better', 'worse', 'improving')) {
    if (bad.length < 4) return base(events, 'Not enough events yet for a trend. Keep the demo running and ask again.');
    const half = Math.floor(bad.length / 2);
    // events are newest-first: second half of array = earlier
    const recent = bad.slice(0, half).length, older = bad.length - recent;
    const dir = recent > older * 1.3 ? 'increasing' : recent < older * 0.7 ? 'decreasing' : 'broadly stable';
    return base(events, `Comparing the first and second half of this session, risky events are <b>${dir}</b> (${recent} recent vs ${older} earlier). Use the Dashboard timeline chart for the full shape, and track "high-risk events per shift" as the operational KPI.`);
  }

  if (has('damage', 'prevented', 'impact', 'business', 'saving')) {
    return base(events, `${hi.length} high/critical event(s) were surfaced in real time. Each represents a potential damage event that could be <b>prevented</b> rather than reimbursed afterwards - the conservation equivalent of this solution. Suggested metrics to track: high-risk events per shift (down), good-practice rate (up), and confirmed damage claims (target: zero).`);
  }

  if (has('hello', 'hi', 'help', 'what can')) {
    return base(events, `I am the HandleGuard field assistant. I answer <b>only from what the vision pipeline detected</b> - never invented. Try asking for high-risk events, behaviour rankings, bay comparisons, shift summaries, why an event was flagged (e.g. "why was E-01 high risk"), or corrective actions.`);
  }

  return base(events, `I did not find that in the detected event data. I can answer about: <b>high/critical events</b>, <b>most common behaviours</b>, <b>locations/bays</b>, <b>shift summary</b>, <b>why an event was flagged</b> ("why E-03"), <b>corrective actions</b>, <b>good practices</b>, and <b>trends</b>.`);
}

function whyEvent(ev, events) {
  const rows = (ev.factors || []).map(f => `<li><b>${esc(f.name)}</b>: ${esc(f.detail)} ${f.pts ? `(+${f.pts} pts)` : ''}</li>`).join('');
  return base(events, `<b>${ev.id}</b> - ${esc(ev.behaviour)} [${ev.score} / 100, ${SEVERITY[ev.severity].label}]<br>Detected at t=${ev.t.toFixed(1)}s on ${esc(ev.bay)}, location: ${esc(ev.where || 'n/a')}.<ul>${rows}</ul>The score is a transparent, factor-weighted model - no black box. Recommended action: ${esc(ev.corrective || 'supervisor review of the incident clip.')}`);
}

function base(events, html) {
  return `<div>${html}</div><span class="grounded">Grounded in ${events.length} event(s) detected this session - no invented information.</span>`;
}
