// Iron — a dumbbell workout tracker. Data lives in the %iron agent on your ship.
const API = '/apps/iron/api';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAYS = window.IRON_DAYS, MOVES = window.IRON_MOVES, W = window.IRON_WEIGHTS;
const DAY = Object.fromEntries(DAYS.map((d) => [d.id, d]));
const DAYMS = 86400000;

async function api(path, opts = {}) {
  const r = await fetch(API + path, { credentials: 'include', headers: { 'content-type': 'application/json' }, ...opts });
  if (r.status === 403) { location.href = '/~/login?redirect=' + encodeURIComponent(location.pathname); throw new Error('login'); }
  if (!r.ok) throw new Error(`${r.status}`);
  return r.status === 204 ? null : r.json();
}

// the agent stores tenths of a pound; the page works in pounds
const fromApi = (w) => ({ ...w, entries: w.entries.map((e) => ({ ex: e.ex, sets: e.sets.map((s) => ({ lbs: s.lbs / 10, reps: s.reps })) })) });
let workouts = [], weights = [], settings = { rest: 90 };

const fmtLb = (x) => (Number.isInteger(x) ? x : x.toFixed(1)) + '';
const unit = (m) => (m.unit === 'sec' ? 's' : '');
const e1rm = (lbs, reps) => lbs * (1 + reps / 30);              // Epley estimate
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const fmtDate = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
const nextWeight = (x) => W.find((w) => w > x) ?? x;
const snap = (x) => W.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a), W[0]);

// ---------------------------------------------------------------- history helpers

function lastFor(ex) {
  for (const w of workouts) { const e = w.entries.find((x) => x.ex === ex); if (e) return { at: w.at, sets: e.sets }; }
  return null;
}
// double progression: hit the top of the range on every set → go up a weight
function plan(ex) {
  const m = MOVES[ex], last = lastFor(ex);
  if (!last) return { lbs: snap(m.start), reps: m.reps[0], why: 'starting weight' };
  const top = Math.max(...last.sets.map((s) => s.lbs));
  const atTop = last.sets.filter((s) => s.lbs === top);
  if (atTop.length >= m.sets && atTop.every((s) => s.reps >= m.reps[1]) && nextWeight(top) !== top)
    return { lbs: nextWeight(top), reps: m.reps[0], why: `up from ${fmtLb(top)} lb`, up: true };
  const best = Math.max(...atTop.map((s) => s.reps));
  return { lbs: top, reps: Math.min(m.reps[1], best + 1), why: 'same weight, one more rep' };
}
function nextDay() {
  if (!workouts.length) return DAYS[0].id;
  const i = DAYS.findIndex((d) => d.id === workouts[0].day);
  return DAYS[(i + 1) % DAYS.length].id;
}

// ---------------------------------------------------------------- tabs

function show(tab) {
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== tab));
  ({ today: renderToday, moves: renderMoves, progress: renderProgress, stats: renderStats })[tab]();
  try { localStorage.setItem('iron-tab', tab); } catch {}
}
document.querySelectorAll('.tabs [data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab)));

// ---------------------------------------------------------------- today

let draft = null, banner = '';
const saveDraft = () => { try { localStorage.setItem('iron-draft', JSON.stringify(draft)); } catch {} };
function newDraft(day) {
  const d = DAY[day];
  draft = { day, note: '', entries: Object.fromEntries(d.moves.map((ex) => { const p = plan(ex); return [ex, Array.from({ length: MOVES[ex].sets }, () => ({ lbs: p.lbs, reps: p.reps, done: false }))]; })) };
  saveDraft();
}

function renderToday() {
  if (!draft) newDraft(nextDay());
  const d = DAY[draft.day], el = $('today');
  const doneSets = Object.values(draft.entries).flat().filter((s) => s.done).length;
  el.innerHTML = `
    ${banner ? `<div class="banner">${banner}</div>` : ''}
    <div class="dayhead">
      <div><div class="kicker">day ${DAYS.indexOf(d) + 1} of ${DAYS.length}${draft.day === nextDay() ? ' · up next' : ''}</div><h1>${d.name}</h1><div class="focus">${d.focus}</div></div>
      <div class="daypick">${DAYS.map((x) => `<button data-day="${x.id}" class="${x.id === draft.day ? 'on' : ''}">${x.name}</button>`).join('')}</div>
    </div>
    <div class="exlist">${d.moves.map((ex) => exCard(ex)).join('')}</div>
    <div class="finish">
      <textarea id="note" placeholder="notes (optional): how it felt, anything to remember next time">${esc(draft.note)}</textarea>
      <div class="row"><span class="muted">${doneSets} set${doneSets === 1 ? '' : 's'} done · weights are per dumbbell</span>
        <button class="primary" id="finish" ${doneSets ? '' : 'disabled'}>Finish workout</button></div>
    </div>`;
  el.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => {
    if (b.dataset.day === draft.day) return;
    if (doneSets && !confirm(`Switch to ${DAY[b.dataset.day].name}? Sets logged here will be cleared.`)) return;
    banner = ''; newDraft(b.dataset.day); renderToday();
  }));
  $('note').oninput = (e) => { draft.note = e.target.value; saveDraft(); };
  $('finish').onclick = finish;
  el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => act(b.dataset)));
}

function exCard(ex) {
  const m = MOVES[ex], sets = draft.entries[ex], last = lastFor(ex), p = plan(ex), u = unit(m);
  const all = sets.length && sets.every((s) => s.done);
  return `<div class="card ex${all ? ' done' : ''}">
    <div class="exhead"><h3><button data-act="info" data-ex="${ex}">${m.name}</button></h3><span class="muted small">${m.muscles}</span></div>
    <div class="exmeta"><span>target <b>${m.sets} × ${m.reps[0]}–${m.reps[1]}${u}${m.side ? ' per side' : ''}</b></span>
      <span>last ${last ? `<b>${last.sets.map((s) => `${fmtLb(s.lbs)}×${s.reps}`).join(', ')}</b> · ${fmtDate(last.at)}` : '<b>never</b>'}</span>
      <span class="${p.up ? 'up' : ''}">try <b>${fmtLb(p.lbs)} lb</b> · ${p.why}</span></div>
    <div class="sets">${sets.map((s, i) => `
      <div class="setrow">
        <span class="n">${i + 1}</span>
        <div class="stepper"><button data-act="lbs" data-ex="${ex}" data-i="${i}" data-d="-1" aria-label="lighter">−</button><span class="val">${fmtLb(s.lbs)}<small>lb</small></span><button data-act="lbs" data-ex="${ex}" data-i="${i}" data-d="1" aria-label="heavier">+</button></div>
        <div class="stepper"><button data-act="reps" data-ex="${ex}" data-i="${i}" data-d="-1" aria-label="fewer">−</button><span class="val">${s.reps}<small>${m.unit === 'sec' ? 'sec' : 'reps'}</small></span><button data-act="reps" data-ex="${ex}" data-i="${i}" data-d="1" aria-label="more">+</button></div>
        <button class="check${s.done ? ' on' : ''}" data-act="done" data-ex="${ex}" data-i="${i}" aria-label="set done">✓</button>
      </div>`).join('')}</div>
    <div class="exfoot"><button class="ghost" data-act="add" data-ex="${ex}">+ set</button>${sets.length > 1 ? `<button class="ghost" data-act="drop" data-ex="${ex}">− set</button>` : ''}<button class="ghost" data-act="info" data-ex="${ex}">how to</button></div>
  </div>`;
}

function act({ act: a, ex, i, d }) {
  const sets = draft.entries[ex], m = MOVES[ex];
  if (a === 'info') return openGuide(ex);
  if (a === 'lbs') { const k = W.indexOf(snap(sets[i].lbs)); sets[i].lbs = W[Math.max(0, Math.min(W.length - 1, k + +d))]; if (!sets[i].done) for (let j = +i + 1; j < sets.length; j++) if (!sets[j].done) sets[j].lbs = sets[i].lbs; }
  if (a === 'reps') sets[i].reps = Math.max(1, sets[i].reps + +d * (m.unit === 'sec' ? 5 : 1));
  if (a === 'done') { sets[i].done = !sets[i].done; if (sets[i].done) startRest(m.unit === 'sec' ? 45 : settings.rest || 90); }
  if (a === 'add') { const l = sets[sets.length - 1]; sets.push({ lbs: l.lbs, reps: l.reps, done: false }); }
  if (a === 'drop' && sets.length > 1) sets.pop();
  saveDraft(); renderToday();
}

async function finish() {
  const entries = Object.entries(draft.entries).map(([ex, sets]) => ({ ex, sets: sets.filter((s) => s.done).map((s) => ({ lbs: Math.round(s.lbs * 10), reps: s.reps })) })).filter((e) => e.sets.length);
  if (!entries.length) return;
  $('finish').disabled = true; $('finish').textContent = 'saving…';
  try {
    const w = await api('/workout', { method: 'POST', body: JSON.stringify({ day: draft.day, note: draft.note, entries }) });
    workouts.unshift(fromApi(w)); workouts.sort((a, b) => b.at - a.at);
    const vol = entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.lbs / 10) * s.reps, 0), 0);
    banner = `<b>${DAY[draft.day].name} done.</b> ${entries.reduce((a, e) => a + e.sets.length, 0)} sets, ${Math.round(vol).toLocaleString()} lb moved. Next up: <b>${DAY[nextDay()].name}</b>.`;
    stopRest(); newDraft(nextDay()); renderToday(); window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) { $('finish').disabled = false; $('finish').textContent = 'Finish workout'; alert("Couldn't save: " + e.message); }
}

// ---------------------------------------------------------------- rest timer

let restEnd = 0, restT = 0, beeped = false;
function startRest(sec) { restEnd = Date.now() + sec * 1000; beeped = false; $('rest').hidden = false; tickRest(); clearInterval(restT); restT = setInterval(tickRest, 250); }
function stopRest() { clearInterval(restT); $('rest').hidden = true; $('rest').classList.remove('over'); }
function tickRest() {
  const left = Math.round((restEnd - Date.now()) / 1000), a = Math.abs(left);
  $('resttime').textContent = `${left < 0 ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  $('rest').classList.toggle('over', left <= 0);
  if (left <= 0 && !beeped) { beeped = true; beep(); navigator.vibrate?.([200, 100, 200]); }
  if (left < -120) stopRest();
}
function beep() { try { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.15, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.6); } catch {} }
$('restplus').onclick = () => { restEnd = Math.max(restEnd, Date.now()) + 30000; beeped = false; };
$('restskip').onclick = stopRest;

// ---------------------------------------------------------------- moves

function guideHtml(ex) {
  const m = MOVES[ex];
  return `<div class="guide">
    <ol>${m.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
    <div class="twocol"><div><h4>Cues</h4><ul class="do">${m.cues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
      <div><h4>Avoid</h4><ul class="dont">${m.mistakes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div></div>
    <div class="muted small">${m.muscles} · ${m.sets} × ${m.reps[0]}–${m.reps[1]}${m.unit === 'sec' ? ' sec' : ''}${m.side ? ' per side' : ''} · start around ${fmtLb(m.start)} lb</div>
  </div>`;
}
function openGuide(ex) {
  const s = $('sheet');
  s.innerHTML = `<div class="card"><div class="exhead"><h2>${MOVES[ex].name}</h2><button class="ghost" id="closesheet">close</button></div>${guideHtml(ex)}</div>`;
  s.hidden = false;
  $('closesheet').onclick = () => (s.hidden = true);
  s.onclick = (e) => { if (e.target === s) s.hidden = true; };
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sheet').hidden = true; });

function renderMoves() {
  $('moves').innerHTML = DAYS.map((d) => `<div class="movegroup"><h2>${d.name}<span>${d.focus}</span></h2>
    ${d.moves.map((ex) => `<details class="card move"><summary><h3>${MOVES[ex].name}</h3><span class="tag">${MOVES[ex].sets} × ${MOVES[ex].reps[0]}–${MOVES[ex].reps[1]}${unit(MOVES[ex])}</span></summary>${guideHtml(ex)}</details>`).join('')}
  </div>`).join('');
}

// ---------------------------------------------------------------- charts

function lineChart(cv, series, { yUnit = '' } = {}) {
  const dpr = Math.min(2, devicePixelRatio || 1), r = cv.getBoundingClientRect();
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = r.width, h = r.height, L = 44, B = 22, T = 10, R = 10;
  const pts = series.flatMap((s) => s.points);
  if (pts.length < 1) { c.fillStyle = '#8b8b93'; c.font = '13px system-ui'; c.fillText('Nothing logged yet.', L, h / 2); return; }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 === x0) { x0 -= DAYMS; x1 += DAYMS; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = (y1 - y0) * 0.15 || 5; y0 = Math.max(0, y0 - pad); y1 += pad;
  const X = (x) => L + ((x - x0) / (x1 - x0)) * (w - L - R), Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (h - T - B);
  c.font = '11px ui-monospace, monospace'; c.fillStyle = '#8b8b93'; c.strokeStyle = '#2c2c31'; c.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = y0 + ((y1 - y0) * i) / 4, y = Y(v); c.beginPath(); c.moveTo(L, y); c.lineTo(w - R, y); c.stroke(); c.fillText((y1 - y0 < 12 ? v.toFixed(1) : Math.round(v)) + yUnit, 4, y + 4); }
  c.fillText(fmtDate(x0), L, h - 6); const lbl = fmtDate(x1); c.fillText(lbl, w - R - c.measureText(lbl).width, h - 6);
  for (const s of series) {
    if (!s.points.length) continue;
    c.strokeStyle = s.color; c.lineWidth = s.width || 2; c.setLineDash(s.dash || []); c.beginPath();
    s.points.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y)))); c.stroke(); c.setLineDash([]);
    if (s.dots) { c.fillStyle = s.color; s.points.forEach((p) => { c.beginPath(); c.arc(X(p.x), Y(p.y), 3, 0, 7); c.fill(); }); }
  }
}
function barChart(cv, bars) {
  const dpr = Math.min(2, devicePixelRatio || 1), r = cv.getBoundingClientRect();
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = r.width, h = r.height, B = 22, max = Math.max(1, ...bars.map((b) => b.v)), bw = w / bars.length;
  c.font = '10px ui-monospace, monospace';
  bars.forEach((b, i) => {
    const bh = (b.v / max) * (h - B - 14);
    c.fillStyle = i === bars.length - 1 ? '#ffffff' : '#5a5a62'; c.fillRect(i * bw + 3, h - B - bh, bw - 6, bh);
    c.fillStyle = '#8b8b93'; if (i % 2 === bars.length % 2 || bars.length < 8) c.fillText(b.label, i * bw + 3, h - 7);
  });
}

// ---------------------------------------------------------------- progress

let progEx = null;
function renderProgress() {
  const logged = [...new Set(workouts.flatMap((w) => w.entries.map((e) => e.ex)))].filter((ex) => MOVES[ex]);
  if (!progEx || !MOVES[progEx]) progEx = logged[0] || DAYS[0].moves[0];
  const sessions = workouts.filter((w) => w.entries.some((e) => e.ex === progEx)).map((w) => ({ at: w.at, sets: w.entries.find((e) => e.ex === progEx).sets })).reverse();
  const top = sessions.map((s) => ({ x: s.at, y: Math.max(...s.sets.map((z) => z.lbs)) }));
  const est = sessions.map((s) => ({ x: s.at, y: Math.max(...s.sets.map((z) => e1rm(z.lbs, z.reps))) }));
  // weekly volume, last 12 weeks
  const wk = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d.getTime(); };
  const thisWk = wk(Date.now()), weeks = Array.from({ length: 12 }, (_, i) => thisWk - (11 - i) * 7 * DAYMS);
  const vol = weeks.map((s) => ({ label: fmtDate(s), v: workouts.filter((w) => wk(w.at) === s).reduce((a, w) => a + w.entries.reduce((b, e) => b + e.sets.reduce((c2, z) => c2 + z.lbs * z.reps, 0), 0), 0) }));
  const opt = (ex) => `<option value="${ex}" ${ex === progEx ? 'selected' : ''}>${MOVES[ex].name}${logged.includes(ex) ? '' : ' (not logged yet)'}</option>`;
  $('progress').innerHTML = `
    <div class="card">
      <div class="pick"><h2 style="margin:0">Exercise</h2><select id="exsel">${DAYS.map((d) => `<optgroup label="${d.name}">${d.moves.map(opt).join('')}</optgroup>`).join('')}</select></div>
      <canvas class="chart" id="exchart"></canvas>
      <div class="legend"><span><i style="background:#ffffff"></i>heaviest set (lb)</span><span><i style="background:#8b8b93"></i>estimated 1-rep max</span></div>
      ${sessions.length ? `<table class="log"><tr><th>date</th><th>sets</th><th>volume</th></tr>${sessions.slice().reverse().map((s) => `<tr><td>${fmtDate(s.at)}</td><td class="mono">${s.sets.map((z) => `${fmtLb(z.lbs)}×${z.reps}`).join('  ')}</td><td class="mono">${Math.round(s.sets.reduce((a, z) => a + z.lbs * z.reps, 0)).toLocaleString()}</td></tr>`).join('')}</table>` : ''}
    </div>
    <div class="grid2" style="margin-top:14px">
      <div class="card"><h2>Weekly volume <span class="muted small">lb × reps</span></h2><canvas class="chart" id="volchart" style="height:180px"></canvas></div>
      <div class="card history"><h2>Recent workouts</h2>${workouts.slice(0, 8).map((w) => `<div class="w"><span><b>${DAY[w.day]?.name || w.day}</b> <span class="muted">· ${fmtDate(w.at)} · ${w.entries.reduce((a, e) => a + e.sets.length, 0)} sets</span></span><button class="ghost small" data-delw="${w.id}">delete</button></div>`).join('') || '<p class="muted">Nothing yet. Finish a workout on the Today tab.</p>'}</div>
    </div>`;
  $('exsel').onchange = (e) => { progEx = e.target.value; renderProgress(); };
  lineChart($('exchart'), [{ points: est, color: '#8b8b93', width: 1.5, dash: [4, 4] }, { points: top, color: '#ffffff', width: 2.5, dots: true }], { yUnit: '' });
  barChart($('volchart'), vol);
  $('progress').querySelectorAll('[data-delw]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this workout?')) return;
    try { await api('/workout/' + b.dataset.delw, { method: 'DELETE' }); workouts = workouts.filter((w) => String(w.id) !== b.dataset.delw); renderProgress(); } catch (e) { alert(e.message); }
  }));
}

// ---------------------------------------------------------------- stats

const LEVELS = ['#1d1d21', '#3b3b42', '#6c6c75', '#a9a9b2', '#f4f4f6'];
function renderStats() {
  const byDay = new Map();
  for (const w of workouts) { const k = dayKey(w.at); byDay.set(k, (byDay.get(k) || 0) + w.entries.reduce((a, e) => a + e.sets.length, 0)); }
  const level = (n) => (!n ? 0 : n < 9 ? 1 : n < 16 ? 2 : n < 23 ? 3 : 4);
  // the contribution grid: 53 columns of weeks, sunday at the top
  const end = new Date(); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - start.getDay() - 52 * 7);
  const S = 13, G = 3; let cells = '', months = '', lastM = -1;
  for (let col = 0; col < 53; col++) {
    for (let row = 0; row < 7; row++) {
      const d = new Date(start); d.setDate(start.getDate() + col * 7 + row);
      if (d > end) continue;
      const n = byDay.get(dayKey(d)) || 0;
      cells += `<rect x="${30 + col * (S + G)}" y="${18 + row * (S + G)}" width="${S}" height="${S}" fill="${LEVELS[level(n)]}"><title>${d.toDateString()}: ${n ? n + ' sets' : 'rest'}</title></rect>`;
      if (row === 0 && d.getMonth() !== lastM) { lastM = d.getMonth(); months += `<text x="${30 + col * (S + G)}" y="11">${d.toLocaleDateString([], { month: 'short' })}</text>`; }
    }
  }
  const dayLbl = ['', 'Mon', '', 'Wed', '', 'Fri', ''].map((t, i) => (t ? `<text x="0" y="${18 + i * (S + G) + 10}">${t}</text>` : '')).join('');
  // week streak: consecutive weeks (ending this week or last) with at least two workouts
  const wk = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d.getTime(); };
  const perWeek = new Map(); workouts.forEach((w) => perWeek.set(wk(w.at), (perWeek.get(wk(w.at)) || 0) + 1));
  let streak = 0, cur = wk(Date.now());
  if ((perWeek.get(cur) || 0) < 2) cur -= 7 * DAYMS;
  while ((perWeek.get(cur) || 0) >= 2) { streak++; cur -= 7 * DAYMS; }
  const totalSets = workouts.reduce((a, w) => a + w.entries.reduce((b, e) => b + e.sets.length, 0), 0);
  const totalVol = workouts.reduce((a, w) => a + w.entries.reduce((b, e) => b + e.sets.reduce((c2, z) => c2 + z.lbs * z.reps, 0), 0), 0);
  // personal records: heaviest weight, and best estimated 1RM, per move
  const prs = Object.keys(MOVES).map((ex) => {
    let best = null;
    for (const w of workouts) for (const e of w.entries) if (e.ex === ex) for (const z of e.sets) if (!best || z.lbs > best.lbs || (z.lbs === best.lbs && z.reps > best.reps)) best = { ...z, at: w.at };
    return best && { ex, ...best };
  }).filter(Boolean);
  const bw = weights.slice().reverse();
  const avg = bw.map((p, i) => { const win = bw.slice(Math.max(0, i - 6), i + 1); return { x: p.at, y: win.reduce((a, q) => a + q.lbs, 0) / win.length }; });
  const change = bw.length > 1 ? (bw[bw.length - 1].lbs - bw[0].lbs) / 10 : null;

  $('stats').innerHTML = `
    <div class="tiles">
      <div class="tile"><b>${workouts.length}</b><span>workouts</span></div>
      <div class="tile"><b>${streak}</b><span>week streak (2+ a week)</span></div>
      <div class="tile"><b>${totalSets.toLocaleString()}</b><span>sets</span></div>
      <div class="tile"><b>${Math.round(totalVol / 1000).toLocaleString()}k</b><span>lb moved</span></div>
    </div>
    <div class="card"><h2>Training days <span class="muted small">last 12 months</span></h2>
      <div class="heat"><svg width="${30 + 53 * (S + G)}" height="${18 + 7 * (S + G)}" font-size="10" font-family="ui-monospace, monospace" fill="#8b8b93">${months}${dayLbl}${cells}</svg></div>
      <div class="heatfoot"><span>${byDay.size} training day${byDay.size === 1 ? '' : 's'}</span><span class="scale">less ${LEVELS.map((c) => `<i style="background:${c}"></i>`).join('')} more</span></div>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div class="card"><h2>Bodyweight</h2>
        <form class="bwform" id="bwform"><input id="bwlbs" type="number" step="0.1" min="50" max="999" placeholder="lb" required><input id="bwdate" type="date" value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}"><button class="primary" type="submit">log</button></form>
        <canvas class="chart" id="bwchart" style="height:200px"></canvas>
        <div class="legend"><span><i style="background:#8b8b93"></i>each weigh-in</span><span><i style="background:#ffffff"></i>7-entry average</span>${change !== null ? `<span>change <b style="color:var(--ink)">${change > 0 ? '+' : ''}${change.toFixed(1)} lb</b></span>` : ''}</div>
        ${weights.length ? `<table class="log"><tr><th>date</th><th>lb</th><th></th></tr>${weights.slice(0, 6).map((w) => `<tr><td>${fmtDate(w.at)}</td><td class="mono">${(w.lbs / 10).toFixed(1)}</td><td><button class="ghost small" data-delbw="${w.id}">delete</button></td></tr>`).join('')}</table>` : ''}
      </div>
      <div class="card"><h2>Personal records</h2>${prs.length ? `<div class="prs">${prs.map((p) => `<div class="pr"><b>${fmtLb(p.lbs)} lb × ${p.reps}</b><span>${MOVES[p.ex].name} · ${fmtDate(p.at)}</span></div>`).join('')}</div>` : '<p class="muted">Your heaviest sets show up here.</p>'}</div>
    </div>`;
  const heat = document.querySelector('.heat'); if (heat) heat.scrollLeft = heat.scrollWidth;
  lineChart($('bwchart'), [{ points: bw.map((p) => ({ x: p.at, y: p.lbs / 10 })), color: '#8b8b93', width: 1, dots: true }, { points: avg.map((p) => ({ x: p.x, y: p.y / 10 })), color: '#ffffff', width: 2.5 }]);
  $('bwform').onsubmit = async (e) => {
    e.preventDefault();
    const lbs = Math.round(parseFloat($('bwlbs').value) * 10), day = $('bwdate').value;
    if (!lbs) return;
    const at = day ? new Date(day + 'T12:00:00').getTime() : Date.now();
    try { const w = await api('/weight', { method: 'POST', body: JSON.stringify({ lbs, at }) }); weights.push(w); weights.sort((a, b) => b.at - a.at); renderStats(); } catch (err) { alert(err.message); }
  };
  $('stats').querySelectorAll('[data-delbw]').forEach((b) => (b.onclick = async () => {
    try { await api('/weight/' + b.dataset.delbw, { method: 'DELETE' }); weights = weights.filter((w) => String(w.id) !== b.dataset.delbw); renderStats(); } catch (e) { alert(e.message); }
  }));
}

// ---------------------------------------------------------------- boot

addEventListener('resize', () => { const t = document.querySelector('.tabs .on')?.dataset.tab; if (t === 'progress' || t === 'stats') show(t); });
(async () => {
  try {
    const st = await api('/state');
    workouts = st.workouts.map(fromApi); weights = st.weights; settings = { rest: 90, ...(st.settings || {}) };
  } catch (e) { if (e.message !== 'login') $('today').innerHTML = `<div class="card">Couldn't load your data: ${esc(e.message)}</div>`; }
  try { const d = JSON.parse(localStorage.getItem('iron-draft') || 'null'); if (d && DAY[d.day] && d.entries) draft = d; } catch {}
  let tab = 'today'; try { tab = localStorage.getItem('iron-tab') || 'today'; } catch {}
  show(['today', 'moves', 'progress', 'stats'].includes(tab) ? tab : 'today');
})();

window.__iron = { plan, nextDay, MOVES, DAYS };
