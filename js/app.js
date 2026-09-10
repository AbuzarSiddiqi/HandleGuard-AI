// HandleGuard AI - application glue: sources, pipeline loop, overlay, views
import { CFG, ZONES, SEVERITY, BEHAVIOURS, PRODUCT_CLASSES, BAYS } from './config.js';
import { Tracker, resetTracker, speedMs } from './tracker.js';
import { BehaviourEngine } from './behaviours.js';
import { EventStore } from './store.js';
import { loadModel, modelReady, detectFrame } from './detector.js';
import { MotionDetector } from './motion.js';
import { SCENARIOS, ScenarioRunner, ChainRunner } from './synth.js';
import { renderKpis, barsSVG, donutSVG, timelineSVG, goodBadSVG, shiftSummary, renderInsights } from './dashboard.js';
import { answer, SUGGESTED } from './assistant.js';

const $ = id => document.getElementById(id);
const stage = $('stage'), ctx = stage.getContext('2d');
const video = $('video');

const store = new EventStore();
const tracker = new Tracker();
const engine = new BehaviourEngine();
const motionDetector = new MotionDetector();

const S = {
  mode: 'none',            // none | synth | file | webcam
  running: false,
  t: 0, lastT: 0,
  lastFrame: 0,
  detectBusy: false, lastDetect: 0,
  latestDets: [], detsVer: 0, lastPipelineVer: -1,
  replay: null,            // {id, startT, endT}
  privacy: localStorage.getItem('hg_privacy') === '1',
  recorder: null, recChunks: [],
  flash: new Map(),        // trackId -> {until, severity}
};

// ---------------- header / tabs ----------------
document.querySelectorAll('#tabs .tab').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('#tabs .tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  btn.classList.add('active');
  $('view-' + btn.dataset.view).classList.add('active');
  refreshViews();
}));

function setModelStatus(cls, text) {
  $('modelStatus').querySelector('.dot').className = 'dot ' + cls;
  $('modelStatusText').textContent = text;
}
loadModel().then(() => setModelStatus('ready', 'AI model ready (COCO-SSD, local)'))
  .catch(e => { console.error(e); setModelStatus('error', 'Model unavailable - synthetic demo still works'); });

// privacy mode
const privacyBtn = $('privacyToggle');
function paintPrivacy() { privacyBtn.classList.toggle('on', S.privacy); privacyBtn.style.color = S.privacy ? '#2fbf71' : ''; }
privacyBtn.addEventListener('click', () => {
  S.privacy = !S.privacy; localStorage.setItem('hg_privacy', S.privacy ? '1' : '0'); paintPrivacy();
});
paintPrivacy();

// ---------------- scenario controls ----------------
const sel = $('scenarioSelect');
for (const sc of SCENARIOS) {
  const o = document.createElement('option');
  o.value = sc.id; o.textContent = `${sc.title}  (${sc.expect})`;
  sel.appendChild(o);
}

$('btnStartScenario').addEventListener('click', () => {
  if (!sel.value) { alert('Pick a scenario first'); return; }
  startSynth(new ScenarioRunner(SCENARIOS.find(s => s.id === sel.value)), SCENARIOS.find(s => s.id === sel.value).title);
});
$('btnRunAll').addEventListener('click', () => {
  startSynth(new ChainRunner(SCENARIOS.map(s => s.id)), 'Full demo - all 12 behaviours');
  startRecording(false);
});
$('btnRecord').addEventListener('click', () => {
  if (S.recorder) { stopRecording(); return; }
  if (S.mode !== 'synth') { alert('Recording works on the synthetic demo canvas.'); return; }
  startRecording(true);
});

function hideStageEmpty() {
  const el = $('stageEmpty');
  if (el) {
    el.hidden = true;
    el.style.display = 'none';
  }
}
function showStageEmpty() {
  const el = $('stageEmpty');
  if (el) {
    el.hidden = false;
    el.style.display = 'grid';
  }
}

let synthRunner = null, synthTitle = '';
function startSynth(runner, title) {
  synthRunner = runner; synthTitle = title;
  S.mode = 'synth'; S.t = 0; S.lastT = 0; S.running = true;
  tracker.tracks = []; engine.latches.clear(); engine.sessionCounts = {};
  hideStageEmpty();
  $('srcName').textContent = 'SIMULATED BAY - ' + title;
  $('btnPlayPause').disabled = false; $('btnPlayPause').innerHTML = '&#10073;&#10073;';
  $('replayBadge').hidden = true; S.replay = null;
}

// file / webcam / pilot samples
const SAMPLES = [
  { file: 'rolling-dropping-carton.mp4', label: 'Rolling and dropping carton (Dock 09)' },
  { file: 'throwing-strap.mp4', label: 'Throwing seating cartons / lifting by strap (Dock 06)' },
  { file: 'kd-dragged-stacking.mp4', label: 'KD packets dragged, heavy box on top' },
  { file: 'stepping-stacking.mp4', label: 'Stepping on cartons / heavy on top' },
  { file: 'throwing-mattresses.mp4', label: 'Throwing mattresses' },
  { file: 'wet-floor.mp4', label: 'Rolling and dragging on wet floor' },
  { file: 'dock-dragging.mp4', label: 'Dock level - dragging cupboard' },
];
const sampleSel = $('sampleSelect');
for (const s of SAMPLES) {
  const o = document.createElement('option');
  o.value = s.file; o.textContent = s.label;
  sampleSel.appendChild(o);
}

function loadVideoSource(src, label) {
  video.pause();
  video.srcObject = null;
  video.src = src;
  video.loop = false;
  video.muted = true;
  video.playsInline = true;

  const onReady = () => {
    S.mode = 'file';
    S.running = true;
    tracker.tracks = [];
    engine.latches.clear();
    S.t = 0;
    S.lastT = 0;
    S.latestDets = [];
    S.detsVer = 0;
    hideStageEmpty();
    $('srcName').textContent = label;
    $('btnPlayPause').disabled = false;
    $('btnPlayPause').innerHTML = '&#10073;&#10073;';
    video.play().catch(err => {
      console.warn('Playback error or autoplay blocked:', err);
      S.running = false;
      $('btnPlayPause').innerHTML = '&#9654;';
    });
  };

  video.onloadedmetadata = onReady;
  video.onerror = e => {
    console.error('Video error:', e);
    alert('Failed to load video file. Please check format/codec (MP4 / WebM).');
  };
  video.load();
}

$('btnLoadSample').addEventListener('click', () => {
  if (!sampleSel.value) { alert('Pick a sample clip first'); return; }
  const meta = SAMPLES.find(s => s.file === sampleSel.value);
  loadVideoSource('samples/' + meta.file, 'PILOT CLIP - ' + meta.label.slice(0, 46));
});

$('videoFile').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  loadVideoSource(url, 'FILE - ' + f.name.slice(0, 40));
  e.target.value = '';
});
$('btnWebcam').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 540 } });
    video.srcObject = stream; video.src = null; video.muted = true;
    await video.play();
    S.mode = 'webcam'; S.running = true; S.t = 0; S.lastT = 0;
    tracker.tracks = []; engine.latches.clear();
    hideStageEmpty();
    $('srcName').textContent = 'WEBCAM (live)';
    $('btnPlayPause').disabled = true;
  } catch (e) { alert('Webcam unavailable: ' + e.message); }
});

$('btnPlayPause').addEventListener('click', () => {
  if (S.mode === 'file') {
    if (video.paused) {
      video.play().catch(err => console.warn('Play blocked:', err));
      S.running = true;
    } else {
      video.pause();
      S.running = false;
    }
  } else if (S.mode === 'synth') {
    S.running = !S.running;
  }
  $('btnPlayPause').innerHTML = S.running ? '&#10073;&#10073;' : '&#9654;';
});

const tlWrap = document.querySelector('.timeline-wrap');
if (tlWrap) {
  tlWrap.style.cursor = 'pointer';
  tlWrap.title = 'Click to seek playback';
  tlWrap.addEventListener('click', e => {
    if (S.mode === 'file' && video.duration) {
      const rect = tlWrap.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      video.currentTime = pct * video.duration;
      if (S.replay) stopReplay();
    }
  });
}

// ---------------- main loop ----------------
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.06, (now - S.lastFrame) / 1000 || 0.016);
  S.lastFrame = now;
  if (S.mode === 'none') return;

  let dets = null, pipelineT = null;

  if (S.mode === 'synth') {
    if (S.running) { synthRunner.step(dt); S.t += dt; }
    synthRunner.draw(ctx);
    dets = synthRunner.detections(); pipelineT = S.t;
    // engine stats
    const sc = synthRunner.current ? synthRunner.current.sc : synthRunner.sc;
    $('engineStats').textContent = `sim t=${S.t.toFixed(1)}s | tracks=${tracker.tracks.length} | sim 30fps`;
    $('timecode').textContent = fmtT(S.t);
    const dur = synthRunner.duration || 1;
    $('tlFill').style.width = Math.min(100, S.t / dur * 100) + '%';
  } else if (S.mode === 'file' || S.mode === 'webcam') {
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, CFG.W, CFG.H);
      if (S.mode === 'file') {
        S.t = video.currentTime;
        $('timecode').textContent = fmtT(video.currentTime);
        if (video.duration) $('tlFill').style.width = (video.currentTime / video.duration * 100) + '%';
        if (video.ended) {
          S.running = false;
          $('btnPlayPause').innerHTML = '&#9654;';
        }
      } else {
        S.t += dt;
      }
      $('engineStats').textContent = `t=${S.t.toFixed(1)}s | tracks=${tracker.tracks.length} | detect ${S.detectBusy ? '...' : 'ok'}`;
      if (S.running && modelReady() && !S.detectBusy && now - S.lastDetect > CFG.ANALYSIS_MS) {
        S.detectBusy = true; S.lastDetect = now;
        detectFrame(video).then(async d => {
          // fuse motion blobs (moving products) with model detections
          const persons = d.filter(x => x.cls === 'person');
          let motion = [];
          try { motion = motionDetector.detect(video, persons); } catch (e) { /* keep model-only */ }
          S.latestDets = [...d, ...motion];
          S.detsVer++; S.detectBusy = false;
        }).catch(() => { S.detectBusy = false; });
      }
      dets = S.latestDets; pipelineT = S.t;
    }
  }

  if (S.privacy) pixelatePeople(dets);

  // pipeline step only on fresh detections (kinematics need real dt)
  if (dets && pipelineT != null && S.running) {
    const fresh = S.mode === 'synth' || S.detsVer !== S.lastPipelineVer;
    if (fresh) {
      S.lastPipelineVer = S.detsVer;
      const stepDt = Math.max(0.016, pipelineT - S.lastT);
      tracker.update(dets, pipelineT);
      const events = engine.evaluate(tracker.tracks, pipelineT, stepDt, { bay: $('baySelect').value });
      for (const ev of events) handleEvent(ev, pipelineT);
      S.lastT = pipelineT;
    }
  }

  drawOverlay();
  if (S.replay && S.replay.active && S.mode === 'file') {
    if (video.currentTime >= S.replay.endT || video.ended) {
      stopReplay();
    }
  }
}
requestAnimationFrame(loop);

function handleEvent(ev, t) {
  const tr = tracker.tracks.find(x => x.id === ev.trackId);
  if (tr) {
    ev.px = tr.cx; ev.py = tr.cy;
    S.flash.set(tr.id, { until: t + 2.2, severity: ev.severity, label: ev.behaviour });
  }
  ev.source = S.mode === 'synth' ? 'Simulated bay' : S.mode === 'webcam' ? 'Webcam' : 'Uploaded footage';
  ev.videoSrc = (video && (video.currentSrc || video.src)) || '';
  ev.sourceName = ($('srcName') && $('srcName').textContent) || '';
  ev.sampleFile = ($('sampleSelect') && $('sampleSelect').value) || '';
  ev.mode = S.mode;
  // evidence snapshot (stage canvas already has frame + privacy + overlay boxes)
  try {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    c.getContext('2d').drawImage(stage, 0, 0, 320, 180);
    ev.thumb = c.toDataURL('image/jpeg', 0.68);
  } catch (e) { ev.thumb = null; }
  store.add(ev);
}

// ---------------- overlay ----------------
function pixelatePeople(dets) {
  if (!dets) return;
  for (const d of dets) {
    if (d.cls !== 'person') continue;
    const x = d.x * CFG.W, y = d.y * CFG.H, w = d.w * CFG.W, h = d.h * CFG.H * 0.28;
    const tmp = document.createElement('canvas');
    tmp.width = 8; tmp.height = 5;
    tmp.getContext('2d').drawImage(stage, x, y, w, h, 0, 0, 8, 5);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, 8, 5, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }
}

function drawOverlay() {
  if (S.mode === 'none') return;
  // Update CCTV telemetry HUD
  const camTag = $('hudCamTag');
  if (camTag) camTag.textContent = `${($('baySelect') && $('baySelect').value) || 'BAY 1'} // CAMERA 01`;
  const clock = $('hudClock');
  if (clock) {
    const d = new Date();
    clock.textContent = d.toTimeString().split(' ')[0];
  }

  // zones with glowing dashed borders
  for (const z of Object.values(ZONES)) {
    ctx.strokeStyle = z.color + 'bb';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(z.x0 * CFG.W, z.y0 * CFG.H, (z.x1 - z.x0) * CFG.W, (z.y1 - z.y0) * CFG.H);
    ctx.setLineDash([]);
    ctx.fillStyle = z.color + '12';
    ctx.fillRect(z.x0 * CFG.W, z.y0 * CFG.H, (z.x1 - z.x0) * CFG.W, (z.y1 - z.y0) * CFG.H);
    ctx.fillStyle = z.color + 'dd';
    ctx.font = 'bold 10.5px JetBrains Mono, monospace';
    ctx.fillText(`ZONE: ${z.name.toUpperCase()}`, z.x0 * CFG.W + 6, z.y0 * CFG.H - 5);
  }

  // tracks
  const t = S.t;
  for (const tr of tracker.tracks) {
    const flash = S.flash.get(tr.id);
    const active = flash && flash.until > t;
    const color = active ? SEVERITY[flash.severity].color : (PRODUCT_CLASSES[tr.cls] || PRODUCT_CLASSES.object).color;
    const x = tr.x * CFG.W, y = tr.y * CFG.H, w = tr.w * CFG.W, h = tr.h * CFG.H;

    // Semi-transparent box backdrop
    ctx.fillStyle = active ? color + '20' : color + '08';
    ctx.fillRect(x, y, w, h);

    // Box outline with rounded aesthetic
    ctx.strokeStyle = color;
    ctx.lineWidth = active ? 2.8 : 1.8;
    ctx.strokeRect(x, y, w, h);

    // Corner reticles for high-tech industrial feel
    const cl = Math.min(10, Math.min(w, h) * 0.3);
    ctx.lineWidth = active ? 3.5 : 2.5;
    ctx.beginPath();
    // top-left
    ctx.moveTo(x, y + cl); ctx.lineTo(x, y); ctx.lineTo(x + cl, y);
    // top-right
    ctx.moveTo(x + w - cl, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cl);
    // bottom-left
    ctx.moveTo(x, y + h - cl); ctx.lineTo(x, y + h); ctx.lineTo(x + cl, y + h);
    // bottom-right
    ctx.moveTo(x + w - cl, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cl);
    ctx.stroke();

    // Label pill
    const label = `${tr.label === 'person' ? 'OPERATOR' : tr.label.toUpperCase()} #${tr.id}`;
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = active ? color : 'rgba(8, 12, 19, 0.88)';
    ctx.fillRect(x, Math.max(0, y - 18), tw, 18);
    ctx.fillStyle = active ? '#ffffff' : color;
    ctx.fillText(label, x + 6, Math.max(12, y - 5));

    // Active violation banner above box
    if (active && flash.label) {
      const vLabel = `ALERT: ${flash.label.toUpperCase()}`;
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      const vtw = ctx.measureText(vLabel).width + 12;
      ctx.fillStyle = SEVERITY[flash.severity].color;
      ctx.fillRect(x, Math.max(0, y - 36), vtw, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(vLabel, x + 6, Math.max(11, y - 24));
    }

    // Velocity / Kinematic telemetry
    if (tr.cls !== 'person') {
      const sp = speedMs(tr).toFixed(1);
      const isThrow = tr.flightActive;
      ctx.font = '9.5px JetBrains Mono, monospace';
      ctx.fillStyle = isThrow ? '#ff3b30' : 'rgba(203, 213, 225, 0.85)';
      const telemetryText = isThrow ? `PROJECTILE ${sp} m/s` : `${sp} m/s`;
      ctx.fillText(telemetryText, x + 2, y + h + 13);
    }
  }

  // event bursts / radar pulse rings
  for (const [id, f] of S.flash) {
    if (f.until <= t) { S.flash.delete(id); continue; }
    const tr = tracker.tracks.find(x => x.id === id);
    if (!tr || f.severity === 'good') continue;
    const age = 1 - (f.until - t) / 2.2;
    ctx.strokeStyle = SEVERITY[f.severity].color;
    ctx.lineWidth = 2.2;
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.beginPath();
    ctx.arc(tr.cx * CFG.W, tr.cy * CFG.H, 20 + age * 50, 0, 7);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (S.mode === 'synth' && synthRunner) {
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const txt = synthRunner.progressLabel ? synthRunner.progressLabel() : synthTitle;
    ctx.fillText(txt, 28, CFG.H - 14);
  }

  // Replay mode high-visibility HUD banner
  if (S.replay && S.replay.active) {
    ctx.save();
    ctx.fillStyle = 'rgba(220, 38, 38, 0.92)';
    ctx.fillRect(0, 0, CFG.W, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    const repEv = S.replay.ev;
    const bannerText = `● REPLAY ACTIVE: ${S.replay.id}${repEv && repEv.behaviour ? ` (${repEv.behaviour.toUpperCase()})` : ''} [${S.replay.startT.toFixed(1)}s – ${S.replay.endT.toFixed(1)}s]`;
    ctx.fillText(bannerText, 14, 17);
    ctx.restore();
  }
}

// ---------------- event store -> views ----------------
store.subscribe(() => { refreshViews(); updateSessionChips(); });

function updateSessionChips() {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, good: 0 };
  for (const e of store.events) counts[e.severity] = (counts[e.severity] || 0) + 1;
  $('sevChips').innerHTML = Object.entries(counts).filter(([, n]) => n)
    .map(([k, n]) => `<span class="sev-chip" style="color:${SEVERITY[k].color};border-color:${SEVERITY[k].color}44"><span style="width:6px;height:6px;border-radius:50%;background:${SEVERITY[k].color};display:inline-block"></span>${SEVERITY[k].label}: ${n}</span>`).join('')
    || '<span class="sev-chip" style="color:var(--text-muted)">No active events</span>';
  const last = store.events[0];
  if (last) {
    $('ticker').innerHTML = `<span class="tick-dot" style="background:${SEVERITY[last.severity].color}"></span>
      <span class="ticker-text"><b style="color:${SEVERITY[last.severity].color}">${last.id} ${SEVERITY[last.severity].label.toUpperCase()}</b>: ${esc(last.behaviour)} (${esc(last.where || last.bay)})</span>`;
  }
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// filters
const sevFilterState = new Set();
function renderSevFilter() {
  const keys = ['good', 'medium', 'high', 'critical'];
  $('sevFilter').innerHTML = ['all', ...keys].map(k => {
    const label = k === 'all' ? 'All Severities' : SEVERITY[k].label.replace(' Risk', '').replace(' Practice', '');
    return `<button data-sev="${k}" class="${sevFilterState.size === 0 && k === 'all' ? 'on' : sevFilterState.has(k) ? 'on' : ''}" style="${sevFilterState.has(k) ? `color:${SEVERITY[k].color}` : ''}">${label}</button>`;
  }).join('');
  $('sevFilter').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const s = b.dataset.sev;
    if (s === 'all') sevFilterState.clear();
    else { sevFilterState.has(s) ? sevFilterState.delete(s) : sevFilterState.add(s); }
    renderSevFilter(); renderEventGrid();
  }));
}
renderSevFilter();
$('filterBay').addEventListener('change', renderEventGrid);
$('filterSearch').addEventListener('input', renderEventGrid);

function filteredEvents() {
  const bay = $('filterBay').value, q = $('filterSearch').value.toLowerCase();
  return store.events.filter(e => {
    if (bay && e.bay !== bay) return false;
    if (sevFilterState.size && !sevFilterState.has(e.severity)) return false;
    if (q && !(`${e.behaviour} ${e.product} ${e.where}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function eventCard(e, compact = false) {
  const sev = SEVERITY[e.severity];
  const factors = (e.factors || []).map(f => `<div class="f-row"><span>${esc(f.name)}</span><b>${esc(f.detail)}${f.pts ? ` <span style="color:${sev.color}">+${f.pts}</span>` : ''}</b></div>`).join('');
  const isRep = S.replay && S.replay.id === e.id;
  return `<div class="event-card clickable ${isRep ? 'replay-active' : ''}" 
               data-event-id="${e.id}"
               onclick="window.__replay('${e.id}')"
               title="Click to review incident snippet"
               style="border-left-color:${sev.color}">
    <div class="event-top">
      <span class="sev-badge" style="background:${sev.color}">${sev.label}</span>
      <span class="ev-behaviour">${esc(e.behaviour)}</span>
      <span class="score-big" style="color:${sev.color}">${e.score ?? '✓'}</span>
      <span class="ev-id">${e.id}</span>
    </div>
    <div class="ev-meta">
      <span><b>t:</b> ${e.t.toFixed(1)}s</span>
      <span><b>Cam:</b> ${esc(e.bay)}</span>
      <span><b>Zone:</b> ${esc(e.where || 'Bay area')}</span>
      <span><b>Target:</b> ${esc(e.product || 'Product')}</span>
    </div>
    <div class="ev-body">
      ${e.thumb ? `<img class="ev-thumb" src="${e.thumb}" alt="Incident frame">` : ''}
      <div class="ev-factors">${factors || '<div class="f-row"><span>Standard handling protocol observed</span></div>'}</div>
    </div>
    ${e.corrective && e.severity !== 'good' ? `<div class="ev-corrective"><b>Corrective Protocol:</b> ${esc(e.corrective)}</div>` : ''}
    <div class="ev-actions" onclick="event.stopPropagation()">
      <button class="btn secondary small" onclick="event.stopPropagation(); window.__replay('${e.id}')">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Replay Snippet
      </button>
      <button class="btn ghost small" onclick="event.stopPropagation(); window.__ask('${e.id}')">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Investigate with Copilot
      </button>
    </div>
  </div>`;
}

function renderEventGrid() {
  const evs = filteredEvents();
  $('eventGrid').innerHTML = evs.length ? evs.map(e => eventCard(e)).join('')
    : '<div class="empty-note"><span>No incidents match current filter criteria. Run an audit clip or adjust search.</span></div>';
}

function renderLiveFeed() {
  const recent = store.events.slice(0, 14);
  $('liveFeed').innerHTML = recent.length ? recent.map(e => {
    const isRep = S.replay && S.replay.id === e.id;
    return `
    <div class="event-card clickable ${isRep ? 'replay-active' : ''}" 
         data-event-id="${e.id}"
         onclick="window.__replay('${e.id}')"
         title="Click to replay snippet (${e.t.toFixed(1)}s)"
         style="border-left-color:${SEVERITY[e.severity].color};padding:10px 12px">
      <div class="event-top">
        <span class="sev-badge" style="background:${SEVERITY[e.severity].color}">${SEVERITY[e.severity].label}</span>
        <span class="ev-behaviour" style="font-size:12px">${esc(e.behaviour)}</span>
        <span class="ev-id">${e.id}</span>
      </div>
      <div class="ev-meta">
        <span><b>t:</b> ${e.t.toFixed(1)}s</span>
        <span><b>Zone:</b> ${esc(e.where || e.bay)}</span>
        ${e.score ? `<span style="color:${SEVERITY[e.severity].color};font-weight:700">Risk ${e.score}</span>` : ''}
      </div>
      <div class="ev-replay-hint">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Replay Snippet (${Math.max(0, e.t - 3.5).toFixed(1)}s - ${(e.t + 4.0).toFixed(1)}s)
      </div>
    </div>`;
  }).join('') : '<div class="empty-note"><span>Real-time vision feed active. Verified violations will stream here instantly.</span></div>';
}

// replay / ask hooks
window.__replay = id => {
  const e = store.events.find(x => x.id === id); if (!e) return;

  // 1. Switch to Live Vision Stream view immediately
  const liveTab = document.querySelector('#tabs button[data-view="live"]');
  if (liveTab && !liveTab.classList.contains('active')) {
    liveTab.click();
  }

  // 2. Simulated scenario seek
  if (e.mode === 'synth' || (!e.videoSrc && S.mode === 'synth')) {
    if (synthRunner instanceof ScenarioRunner) {
      synthRunner.seek(Math.max(0, e.t - 2.5));
      S.t = synthRunner.t;
      S.running = true;
      tracker.tracks = [];
      engine.latches.clear();
      S.lastT = 0;
      const badge = $('replayBadge');
      if (badge) {
        badge.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#fff;margin-right:5px"></span> REPLAY: ${e.id} (${esc(e.behaviour)})`;
        badge.hidden = false;
        setTimeout(() => { if ($('replayBadge')) $('replayBadge').hidden = true; }, 3500);
      }
    } else {
      alert('Replay restarts the full demo - single scenarios support precise seek.');
    }
    return;
  }

  // 3. Video clip playback
  let targetSrc = e.videoSrc || (video && (video.currentSrc || video.src));
  let targetLabel = e.sourceName || 'Archived incident';

  if (!targetSrc) {
    const file = e.sampleFile || ($('sampleSelect') && $('sampleSelect').value) || (SAMPLES[0] && SAMPLES[0].file);
    if (file) {
      targetSrc = 'videos/' + file;
      const sObj = SAMPLES.find(s => s.file === file);
      targetLabel = sObj ? sObj.label : file;
      if ($('sampleSelect')) $('sampleSelect').value = file;
    }
  }

  const startT = Math.max(0, e.t - 3.5);
  const endT = e.t + 4.5;

  const curSrc = (video && (video.currentSrc || video.src)) || '';
  const needsLoad = !curSrc || (!curSrc.endsWith(targetSrc) && curSrc !== targetSrc);

  if (needsLoad && targetSrc) {
    loadVideoSource(targetSrc, targetLabel);
    const onLoaded = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      startReplay(startT, endT, e);
    };
    video.addEventListener('loadedmetadata', onLoaded, { once: true });
  } else {
    startReplay(startT, endT, e);
  }
};

function startReplay(startT, endT, ev) {
  const dur = (video && video.duration) || 99999;
  const safeStart = Math.max(0, Math.min(startT, Math.max(0, dur - 0.2)));
  const safeEnd = Math.min(dur, Math.max(safeStart + 1.2, endT));

  S.replay = {
    id: ev ? ev.id : 'REPLAY',
    startT: safeStart,
    endT: safeEnd,
    active: false,
    ev
  };

  hideStageEmpty();

  const badge = $('replayBadge');
  if (badge) {
    badge.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#fff;margin-right:6px"></span> REPLAY ACTIVE: ${ev ? ev.id + ' (' + esc(ev.behaviour) + ')' : 'SNIPPET'} [${safeStart.toFixed(1)}s - ${safeEnd.toFixed(1)}s]`;
    badge.hidden = false;
  }

  const ticker = $('ticker');
  if (ticker) {
    ticker.innerHTML = `<span class="tick-dot" style="background:#ef4444"></span>
      <span class="ticker-text"><b style="color:#ef4444">REPLAY IN PROGRESS</b>: ${ev ? ev.id + ' — ' + esc(ev.behaviour) : 'Incident snippet'} [t=${safeStart.toFixed(1)}s – ${safeEnd.toFixed(1)}s]</span>`;
  }

  // Highlight active event cards
  document.querySelectorAll('.event-card').forEach(c => c.classList.remove('replay-active'));
  if (ev) {
    document.querySelectorAll(`[data-event-id="${ev.id}"]`).forEach(c => c.classList.add('replay-active'));
  }

  video.pause();
  video.currentTime = safeStart;
  video.muted = true;

  const launchPlayback = () => {
    if (!S.replay) return;
    S.replay.active = true;
    S.running = true;
    S.lastT = video.currentTime;
    tracker.tracks = [];
    engine.latches.clear();
    $('btnPlayPause').disabled = false;
    $('btnPlayPause').innerHTML = '&#10073;&#10073;';
    const p = video.play();
    if (p !== undefined) {
      p.catch(err => {
        console.warn('Replay play failed, retry muted:', err);
        video.muted = true;
        video.play().catch(e => console.error('Autoplay blocked:', e));
      });
    }
  };

  if (video.seeking) {
    video.addEventListener('seeked', launchPlayback, { once: true });
  } else {
    setTimeout(launchPlayback, 60);
  }
}

function stopReplay() {
  const rep = S.replay;
  S.replay = null;
  const badge = $('replayBadge');
  if (badge) badge.hidden = true;
  document.querySelectorAll('.event-card.replay-active').forEach(c => c.classList.remove('replay-active'));

  video.pause();
  S.running = false;
  $('btnPlayPause').innerHTML = '&#9654;';

  const ticker = $('ticker');
  if (ticker) {
    ticker.innerHTML = `<span class="tick-dot" style="background:var(--accent-blue)"></span>
      <span class="ticker-text">Snippet replay concluded (${rep && rep.id ? rep.id : 'incident'}). Click Play (▶) to resume continuous analysis or click any event to replay.</span>`;
  }
}

window.__ask = id => {
  document.querySelector('[data-view="assistant"]').click();
  $('chatText').value = `Why was ${id} flagged?`;
  $('chatForm').dispatchEvent(new Event('submit'));
};

// ---------------- dashboard / insights ----------------
function renderDashboard() {
  renderKpis($('kpiRow'), store.events);
  const bad = store.events.filter(e => e.severity !== 'good');
  $('chartTimeline').innerHTML = timelineSVG(store.events);
  $('chartSeverity').innerHTML = donutSVG(store.events.reduce((m, e) => ((m[e.severity] = (m[e.severity] || 0) + 1), m), {}));
  const byType = {};
  for (const e of bad) byType[e.behaviour] = (byType[e.behaviour] || 0) + 1;
  $('chartBehaviours').innerHTML = barsSVG(Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ k, n })), () => '#f76b15');
  const byBay = {};
  for (const e of bad) byBay[e.bay] = (byBay[e.bay] || 0) + 1;
  $('chartBays').innerHTML = barsSVG(BAYS.map(b => ({ k: b, n: byBay[b] || 0 })), () => '#f5a524');
  $('chartGoodBad').innerHTML = goodBadSVG(store.events);
  $('shiftSummary').textContent = shiftSummary(store.events);
}

function refreshViews() {
  renderEventGrid(); renderLiveFeed(); renderDashboard();
  renderInsights({
    recurring: $('insightRecurring'), locations: $('insightLocations'),
    training: $('insightTraining'), playbook: $('insightPlaybook'),
  }, store.events);
}

// ---------------- assistant ----------------
function pushMsg(cls, html) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls; d.innerHTML = html;
  $('chatLog').appendChild(d);
  $('chatLog').scrollTop = 1e9;
}
$('chatChips').innerHTML = SUGGESTED.map(q => `<button>${esc(q)}</button>`).join('');
$('chatChips').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  $('chatText').value = b.textContent; $('chatForm').dispatchEvent(new Event('submit'));
}));
$('chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('chatText').value.trim(); if (!q) return;
  $('chatText').value = '';
  pushMsg('user', esc(q));
  setTimeout(() => pushMsg('ai', answer(q, store.events)), 250);
});
pushMsg('ai', answer('help', store.events));

// ---------------- session actions ----------------
$('btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'HandleGuard AI', exportedAt: new Date().toISOString(), events: store.events }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'handleguard-events.json'; a.click();
});
$('btnClear').addEventListener('click', () => {
  store.clear(); tracker.tracks = []; engine.latches.clear(); engine.sessionCounts = {}; S.flash.clear();
  if (S.mode === 'file') { video.pause(); }
  S.mode = 'none'; S.running = false;
  showStageEmpty();
  $('srcName').textContent = 'No source';
  $('btnPlayPause').disabled = true; $('btnPlayPause').innerHTML = '&#10073;&#10073;';
  ctx.clearRect(0, 0, CFG.W, CFG.H);
  refreshViews(); updateSessionChips();
});

// ---------------- recording ----------------
function startRecording(alsoRunAll) {
  if (!stage.captureStream) { alert('Recording not supported in this browser.'); return; }
  if (alsoRunAll) $('btnRunAll').click();
  const stream = stage.captureStream(30);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  S.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  S.recChunks = [];
  S.recorder.ondataavailable = e => e.data.size && S.recChunks.push(e.data);
  S.recorder.onstop = () => {
    const blob = new Blob(S.recChunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'handleguard-demo.webm'; a.click();
    $('btnRecord').textContent = 'Record Clip';
  };
  S.recorder.start();
  $('btnRecord').textContent = 'Stop & Save';
}
function stopRecording() { if (S.recorder) { S.recorder.stop(); S.recorder = null; } }

// ---------------- responsible ai widgets ----------------
$('retentionSlider').addEventListener('input', e => $('retentionVal').textContent = e.target.value);
$('fbConfirm').addEventListener('click', () => toast('Feedback logged: event confirmed - model thresholds unchanged.'));
$('fbDismiss').addEventListener('click', () => toast('Feedback logged as false positive - stored for threshold tuning.'));

function toast(msg) {
  const t = $('ticker');
  const old = t.innerHTML;
  t.innerHTML = `<span class="tick-dot" style="background:#2fbf71"></span>${esc(msg)}`;
  setTimeout(() => { t.innerHTML = old; }, 2600);
}

function fmtT(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

updateSessionChips(); refreshViews();
