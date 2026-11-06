// Xa Vén · pantalla: los próximos buses de una o dos paradas, en grande y siempre encendida.
// Para una tele en un bar, una tablet en una tienda o una Raspberry Pi en la entrada de casa.
//   pantalla.html#s12          una parada
//   pantalla.html#s12,s40      dos paradas, una al lado de otra
//   pantalla.html?andar=5#s12  tardas 5 min en llegar: dice cuándo salir, no cuándo pasa
import { prepare, arrivalsAt, dayKind, formatMinutes } from './sim.js';
import { t, translateDom } from './i18n.js';
import { startLive, liveFor } from './live.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nice = (name) => String(name).replace(/^HULA \(Ent\. Personal\).*$/i, t('Hospital (entrada de personal)')).replace(/^HULA\b.*$/i, 'Hospital (HULA)');
const ROWS = 7;

let net;
const params = new URLSearchParams(location.search);
const walk = Math.max(0, Math.min(30, Number(params.get('andar')) || 0));

const madridFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const WEEK = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', weekday: 'short' });

function clock() {
  const now = new Date();
  const p = Object.fromEntries(madridFormat.formatToParts(now).map((x) => [x.type, x.value]));
  const iso = `${p.year}-${p.month}-${p.day}`;
  return { kind: dayKind(net, iso, WEEK[weekdayFormat.format(now)]), t: Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60 };
}

/** Lo mismo que la web: próximos pasos, con el retraso de las carreras que alguien ha visto. */
function arrivals(stopId) {
  const c = clock();
  const out = [];
  for (const a of arrivalsAt(net, stopId, c.kind, c.t, { grace: 30, limit: 4, horizon: 150 })) {
    const live = liveFor(a.key);
    const minutes = a.minutes + (live?.delay ?? 0);
    if (minutes < c.t - (live ? 0.5 : 0)) continue;
    const leave = minutes - walk;
    if (walk && leave < c.t - 0.5) continue;
    out.push({ ...a, minutes, live, eta: Math.max(0, Math.round((walk ? leave : minutes) - c.t)) });
  }
  return out.sort((x, y) => x.minutes - y.minutes).slice(0, ROWS);
}

function rowHTML(a) {
  const when = formatMinutes(a.minutes);
  const sub = walk ? t('Pasa a las {time}', { time: when }) : t('A las {time}', { time: when });
  const live = a.live ? ` · <span class="live">${t('En directo')}</span>` : '';
  let eta;
  if (walk) eta = a.eta <= 0 ? `<span class="eta now">${t('Sal ya')}</span>` : `<span class="eta${a.live ? ' is-live' : ''}"><small>${t('sal en')} </small>${a.eta}<small> min</small></span>`;
  else eta = a.eta === 0 ? `<span class="eta now">${t('Ya llega')}</span>` : `<span class="eta${a.live ? ' is-live' : ''}">${a.eta}<small> min</small></span>`;
  return `<div class="row"><span class="badge" style="--c:${a.line.color}">${esc(a.line.number)}</span><span class="dest">${esc(nice(a.dir.dest))}<small>${esc(sub)}${live}</small></span>${eta}</div>`;
}

function listHTML(stopId) {
  const list = arrivals(stopId);
  if (!list.length) return `<p class="empty">${t('No pasa ningún bus por aquí en las próximas dos horas.')}</p>`;
  return `<div class="list">${list.map(rowHTML).join('')}</div>`;
}

function renderBoard(ids) {
  const c = clock();
  const stops = ids.map((id) => net.stopById.get(id));
  const title = stops.length === 1 ? esc(nice(stops[0].name)) : t('Próximos buses');
  const sub = walk ? t('Contando {n} min andando hasta la parada', { n: walk }) : t('Próximos buses');
  const body = stops.length === 1
    ? listHTML(ids[0])
    : `<div class="two">${stops.map((s) => `<section><h2>${esc(nice(s.name))}</h2>${listHTML(s.id)}</section>`).join('')}</div>`;
  const html = `<header class="bar"><img src="icon.svg" alt="Xa Vén"><h1>${title}<small>${esc(stops.length === 1 ? sub : (walk ? sub : ''))}</small></h1><span class="clock">${formatMinutes(Math.floor(c.t))}</span></header>
    ${body}
    <footer class="foot"><span>${t('Horas según el horario, salvo las marcadas «en directo». Web no oficial.')}</span><span class="lg"><i></i>${t('En directo: lo comparte alguien que va dentro')}</span><span>bus.marcogugliandolo.com</span></footer>`;
  const board = $('#board');
  if (board.dataset.shown !== html) {
    board.innerHTML = html;
    board.dataset.shown = html;
    fitRows();
  }
}

/** Solo las filas que caben enteras: en una tele no se puede bajar con el dedo. */
function fitRows() {
  for (const list of document.querySelectorAll('#board .list')) {
    const rows = [...list.children];
    rows.forEach((row) => { row.hidden = false; });
    const bottom = list.getBoundingClientRect().bottom;
    rows.forEach((row, i) => { if (i > 0 && row.getBoundingClientRect().bottom > bottom + 1) row.hidden = true; });
  }
}
window.addEventListener('resize', fitRows);

/* ---------- Elegir parada ---------- */
const chosen = [];
function renderSetup(query = '') {
  const q = norm(query.trim());
  const found = q.length >= 2 ? net.stops.filter((s) => norm(s.name).includes(q) || norm(nice(s.name)).includes(q) || (s.code && s.code.toLowerCase() === q)).slice(0, 12) : [];
  const url = new URL(`pantalla.html${walk ? `?andar=${walk}` : ''}#${chosen.join(',')}`, location.href).href;
  $('#setup').innerHTML = `
    <h1>${t('Pantalla de parada')}</h1>
    <p>${t('Elige una o dos paradas y deja la pantalla encendida: los próximos buses se actualizan solos. Sirve para una tele en un bar, una tablet en una tienda o una Raspberry Pi en la entrada de casa.')}</p>
    <label>${t('Busca la parada')}<input id="find" type="search" autocomplete="off" value="${esc(query)}" placeholder="${t('Por ejemplo: Sindicatos')}"></label>
    <div class="results">${found.map((s) => `<button type="button" data-id="${esc(s.id)}"${chosen.includes(s.id) ? ' disabled' : ''}><span>${esc(nice(s.name))}</span><small>${s.lines.length === 1 ? t('1 línea') : t('{n} líneas', { n: s.lines.length })}</small></button>`).join('')}</div>
    ${chosen.length ? `<div class="chosen">${chosen.map((id) => `<button type="button" data-remove="${esc(id)}" aria-label="${t('Quitar')}">${esc(nice(net.stopById.get(id).name))} ✕</button>`).join('')}</div>` : ''}
    <label>${t('¿Cuánto se tarda andando hasta la parada?')}
      <select id="walk">${[0, 2, 3, 5, 8, 10, 15].map((n) => `<option value="${n}"${n === walk ? ' selected' : ''}>${n ? t('{n} min: dime cuándo salir', { n }) : t('Nada: la pantalla está en la parada')}</option>`).join('')}</select>
    </label>
    <button type="button" class="go" id="open"${chosen.length ? '' : ' disabled'}>${t('Abrir la pantalla')}</button>
    ${chosen.length ? `<p>${t('Para dejarla fija en una Raspberry Pi o un ordenador, abre esta dirección a pantalla completa:')}</p><code>chromium --kiosk --noerrdialogs --disable-session-crashed-bubble "${esc(url)}"</code>` : ''}`;
  const input = $('#find');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function wireSetup() {
  const setup = $('#setup');
  setup.addEventListener('input', (e) => { if (e.target.id === 'find') renderSetup(e.target.value); });
  setup.addEventListener('change', (e) => {
    if (e.target.id !== 'walk') return;
    const value = Number(e.target.value);
    const next = new URL(location.href);
    if (value) next.searchParams.set('andar', String(value)); else next.searchParams.delete('andar');
    location.replace(next.href);
  });
  setup.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-id]');
    const remove = e.target.closest('[data-remove]');
    if (pick && chosen.length < 2) { chosen.push(pick.dataset.id); renderSetup(''); }
    else if (remove) { chosen.splice(chosen.indexOf(remove.dataset.remove), 1); renderSetup($('#find').value); }
    else if (e.target.id === 'open' && chosen.length) location.hash = chosen.join(',');
  });
}

/* ---------- Siempre encendida ---------- */
async function keepAwake() {
  try { await navigator.wakeLock?.request('screen'); } catch { /* sin permiso: la pantalla decide */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('#board').hidden) keepAwake(); });

function route() {
  const ids = location.hash.slice(1).split(',').filter((id) => net.stopById.has(id)).slice(0, 2);
  $('#board').hidden = !ids.length;
  $('#setup').hidden = Boolean(ids.length);
  $('#exit').hidden = !ids.length;
  if (ids.length) {
    document.title = `${nice(net.stopById.get(ids[0]).name)} · Xa Vén`;
    renderBoard(ids);
    keepAwake();
  } else {
    chosen.splice(0, chosen.length);
    renderSetup('');
  }
  return ids;
}

async function start() {
  net = prepare(await fetch('data/network.json').then((r) => r.json()));
  translateDom();
  wireSetup();
  let ids = route();
  window.addEventListener('hashchange', () => { ids = route(); });
  startLive(() => { if (ids.length) renderBoard(ids); });
  setInterval(() => { if (ids.length) renderBoard(ids); }, 5000);
  // Un píxel arriba o abajo cada minuto, para no marcar la tele, y una recarga de madrugada por si hay versión nueva.
  let shift = 0;
  setInterval(() => {
    shift = (shift + 1) % 4;
    $('#board').style.translate = `${shift % 2 ? 2 : 0}px ${shift > 1 ? 2 : 0}px`;
  }, 60000);
  const loaded = Date.now();
  setInterval(() => { if (Date.now() - loaded > 6 * 3600000 && clock().t < 300) location.reload(); }, 10 * 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<p class="empty">${t('No se han podido cargar los datos de la red. Recarga la página.')}</p>`);
});
