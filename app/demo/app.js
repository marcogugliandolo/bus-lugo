// Buses de Lugo /demo: mapa, panel y reloj. El cálculo de posiciones está en sim.js.
import { prepare, busesAt, arrivalsAt, approachPath, dayKind, formatMinutes, passTime, distanceMetres } from './sim.js';

const TILES_CHECK = 'https://tiles.openfreemap.org/planet';
const EXAMPLE_STOP = 's70'; // Rúa Vilalba 6: pasan 11 líneas y está junto a la Muralla.
const CITY_BOUNDS = [[-7.585, 42.992], [-7.53, 43.035]];
const NOTICES = [{
  title: 'Cambios en las líneas 7, 8, 9 y 12 por obras',
  body: 'Los recorridos de la demo pueden no reflejar estos desvíos. El detalle está en la web del operador.',
  source: 'buslugo.com, consultado el 2 de noviembre de 2026',
  url: 'https://buslugo.com/',
}];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const desktop = matchMedia('(min-width: 1000px)');

let net;
let map = null;
let mapReady = false;
let remoteTiles = false;
let streets = null;
let routesData = null;
let stopsData = null;

const state = {
  view: 'home',            // home | stop | bus | line | search | notices
  stopId: null,
  homeStopId: EXAMPLE_STOP,
  me: null,
  arrivalKey: null,
  busKey: null,
  lineNumber: null,
  query: '',
  alert: null,
  buses: [],
  busByKey: new Map(),
  previous: 'home',
};

/* ---------- Reloj: la hora de Lugo, viva donde viva quien mira ---------- */
const sim = { on: false, kind: 'laborable', base: 600, realBase: 0, speed: 1 };
const madridFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const WEEK = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', weekday: 'short' });

function madridNow() {
  const now = new Date();
  const p = Object.fromEntries(madridFormat.formatToParts(now).map((x) => [x.type, x.value]));
  return {
    iso: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEK[weekdayFormat.format(now).toLowerCase()],
    minutes: Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60,
  };
}

function clock() {
  if (!sim.on) {
    const m = madridNow();
    return { kind: dayKind(net, m.iso, m.weekday), t: m.minutes, live: true };
  }
  let t = sim.base + ((performance.now() - sim.realBase) / 60000) * sim.speed;
  if (t >= 1440) {
    sim.base = 300;
    sim.realBase = performance.now();
    t = 300;
  }
  return { kind: sim.kind, t, live: false };
}

function setSim(changes) {
  const current = clock();
  Object.assign(sim, { on: true, kind: current.kind, base: current.t, speed: sim.on ? sim.speed : 1 }, changes);
  sim.realBase = performance.now();
  syncSimPanel();
  tickData();
  renderSheet();
}

function syncSimPanel() {
  const c = clock();
  document.querySelectorAll('[data-day]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.day === c.kind)));
  document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === (c.live ? 1 : sim.speed))));
  const slider = $('#sim-time');
  if (document.activeElement !== slider) slider.value = String(Math.max(300, Math.floor(c.t)));
  $('#sim-out').textContent = formatMinutes(Math.floor(c.t));
  $('#sim-live').hidden = c.live;
}

/* ---------- Mapa ---------- */
const isDark = () => {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

async function buildStyle() {
  if (remoteTiles) {
    const res = await fetch(`data/map-style-${isDark() ? 'dark' : 'light'}.json`);
    return res.json();
  }
  streets ??= await fetch('data/streets.json').then((r) => r.json());
  return {
    version: 8,
    sources: { streets: { type: 'geojson', data: streets, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': isDark() ? '#14171B' : '#E7E9E6' } },
      { id: 'streets', type: 'line', source: 'streets', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': isDark() ? '#2A3037' : '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 15, 1.4, 18, 5] } },
    ],
  };
}

function addOverlays() {
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('routes', { type: 'geojson', data: routesData });
  map.addSource('bus-stops', { type: 'geojson', data: stopsData });
  map.addSource('focus', { type: 'geojson', data: empty });
  map.addSource('approach', { type: 'geojson', data: empty });
  const round = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({ id: 'routes', type: 'line', source: 'routes', layout: round, paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.5, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.4, 15, 3, 18, 6] } });
  map.addLayer({ id: 'route-sel', type: 'line', source: 'routes', layout: round, filter: ['==', ['get', 'number'], ''], paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 5, 18, 8] } });
  map.addLayer({ id: 'focus', type: 'line', source: 'focus', layout: round, paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.7, 'line-width': 4 } });
  map.addLayer({ id: 'approach', type: 'line', source: 'approach', layout: round, paint: { 'line-color': token('--ink'), 'line-width': 6 } });
  map.addLayer({ id: 'bus-stops', type: 'circle', source: 'bus-stops', minzoom: 13, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.8, 16, 4.5], 'circle-color': token('--surface'), 'circle-stroke-color': token('--mute'), 'circle-stroke-width': 1.2 } });
  mapReady = true;
  applyMapFocus(false);
  updateApproach();
}

async function initMap() {
  try {
    remoteTiles = await fetch(TILES_CHECK, { signal: AbortSignal.timeout(3500) }).then((r) => r.ok).catch(() => false);
    map = new maplibregl.Map({
      container: 'map',
      style: await buildStyle(),
      bounds: CITY_BOUNDS,
      fitBoundsOptions: { padding: mapPadding() },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      maxZoom: 18,
      minZoom: 10,
    });
    map.touchZoomRotate.disableRotation();
    map.on('style.load', addOverlays);
    map.on('click', (e) => {
      if (!mapReady) return;
      const box = [[e.point.x - 14, e.point.y - 14], [e.point.x + 14, e.point.y + 14]];
      const hit = map.queryRenderedFeatures(box, { layers: ['bus-stops'] })[0];
      if (hit) selectStop(hit.properties.id);
    });
    map.on('mousemove', 'bus-stops', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'bus-stops', () => { map.getCanvas().style.cursor = ''; });
    map.on('error', (e) => console.warn('Mapa:', e.error?.message));
    const onTheme = async () => {
      mapReady = false;
      map.setStyle(await buildStyle(), { diff: false });
    };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
    new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    tickMarkers();
  } catch (err) {
    console.error(err);
    $('#nomap').hidden = false;
  }
}

function mapPadding() {
  const sheet = desktop.matches ? 0 : $('#sheet').getBoundingClientRect().height;
  const side = desktop.matches ? 408 : 0;
  const top = desktop.matches ? 70 : 130;
  return { top, bottom: sheet + 30, left: side + 40, right: state.view === 'home' ? 40 : 120 };
}

function moveTo(points, maxZoom = 15.6) {
  if (!map) return;
  const lngs = points.map((p) => p[1]);
  const lats = points.map((p) => p[0]);
  const bounds = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
  map.fitBounds(bounds, { padding: mapPadding(), maxZoom, duration: reduced ? 0 : 700 });
}

const asLine = (coords, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords.map((p) => [p[1], p[0]]) } });

/** Atenúa la red cuando hay algo elegido y resalta la línea o el recorrido. */
function applyMapFocus() {
  if (!mapReady) return;
  const focused = state.view === 'line' || state.view === 'stop' || state.view === 'bus';
  map.setPaintProperty('routes', 'line-opacity', focused ? 0.16 : (isDark() ? 0.6 : 0.5));
  map.setFilter('route-sel', ['==', ['get', 'number'], state.view === 'line' ? state.lineNumber : '']);
}

/* ---------- Marcadores ---------- */
const markers = new Map();
const BUS_SVG = '<svg width="34" height="62" viewBox="0 0 34 62" aria-hidden="true"><rect x="2" y="2" width="30" height="58" rx="8" fill="var(--c)" stroke="#fff" stroke-width="3"></rect><rect x="7" y="7" width="20" height="9" rx="3" fill="#DCE3EA"></rect><rect x="7" y="47" width="20" height="6" rx="2" fill="#DCE3EA" fill-opacity=".6"></rect></svg>';

function busMarker(bus) {
  const wrap = document.createElement('div');
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'bus';
  el.style.setProperty('--c', bus.line.color);
  el.setAttribute('aria-label', `Bus de la línea ${bus.line.number} hacia ${bus.dir.dest}`);
  el.innerHTML = `${BUS_SVG}<span class="arrow"></span><span class="num">${esc(bus.line.number)}</span>`;
  el.addEventListener('click', (e) => { e.stopPropagation(); selectBus(bus.key); });
  wrap.append(el);
  const marker = new maplibregl.Marker({ element: wrap }).setLngLat([bus.lng, bus.lat]).addTo(map);
  return { marker, el, x: 0, y: 0, tx: 0, ty: 0 };
}

function heroBusKey() {
  if (state.view === 'bus') return state.busKey;
  if (state.view === 'stop') {
    const hero = currentHero();
    if (hero && state.busByKey.has(hero.key)) return hero.key;
  }
  return null;
}

function updateMarkers() {
  if (!map) return;
  const hero = heroBusKey();
  const seen = new Set();
  for (const bus of state.buses) {
    seen.add(bus.key);
    let m = markers.get(bus.key);
    if (!m) {
      m = busMarker(bus);
      markers.set(bus.key, m);
    }
    m.marker.setLngLat([bus.lng, bus.lat]);
    m.el.style.setProperty('--r', `${bus.bearing}deg`);
    const isHero = bus.key === hero;
    const filtered = state.view === 'line' && bus.line.number !== state.lineNumber;
    m.el.classList.toggle('lead', isHero);
    m.el.classList.toggle('gone', filtered);
    m.el.classList.toggle('dim', Boolean(hero) && !isHero);
    m.el.classList.toggle('parked', Boolean(bus.parkedUntil));
    m.marker.getElement().style.zIndex = isHero ? '5' : '1';
  }
  for (const [key, m] of markers) {
    if (!seen.has(key)) {
      m.marker.remove();
      markers.delete(key);
    }
  }
}

/** Separa en pantalla los buses que coinciden en la misma calle para poder tocarlos. */
function declutter() {
  if (!map) return;
  const hero = heroBusKey();
  const items = [];
  for (const bus of state.buses) {
    const m = markers.get(bus.key);
    if (!m || m.el.classList.contains('gone')) continue;
    const p = map.project([bus.lng, bus.lat]);
    items.push({ m, x: p.x, y: p.y, fixed: bus.key === hero, ox: 0, oy: 0 });
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const dx = b.x + b.ox - a.x - a.ox;
        const dy = b.y + b.oy - a.y - a.oy;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d >= 30) continue;
        const push = (30 - d) / 2;
        const ux = dx === 0 && dy === 0 ? 1 : dx / d;
        const uy = dx === 0 && dy === 0 ? 0 : dy / d;
        if (!a.fixed) { a.ox -= ux * push; a.oy -= uy * push; }
        if (!b.fixed) { b.ox += ux * push; b.oy += uy * push; }
      }
    }
  }
  for (const it of items) {
    it.m.tx = it.ox;
    it.m.ty = it.oy;
  }
}

let lastBusTick = 0;
let lastClutter = 0;
function tickMarkers(now = 0) {
  requestAnimationFrame(tickMarkers);
  if (now - lastBusTick < 120) return;
  lastBusTick = now;
  tickData();
  if (now - lastClutter > 350) {
    lastClutter = now;
    declutter();
  }
  for (const m of markers.values()) {
    m.x += (m.tx - m.x) * 0.35;
    m.y += (m.ty - m.y) * 0.35;
    m.marker.setOffset([Math.round(m.x * 10) / 10, Math.round(m.y * 10) / 10]);
  }
}

function tickData() {
  const c = clock();
  state.buses = busesAt(net, c.kind, c.t);
  state.busByKey = new Map(state.buses.map((b) => [b.key, b]));
  updateMarkers();
  updateApproach();
}

let stopPin = null;
let mePin = null;
function updatePins() {
  if (!map) return;
  const id = state.view === 'stop' ? state.stopId : (state.view === 'home' ? state.homeStopId : (state.view === 'bus' ? state.stopId : null));
  stopPin?.remove();
  stopPin = null;
  if (id) {
    const stop = net.stopById.get(id);
    const el = document.createElement('div');
    el.className = state.view === 'home' ? 'pin' : 'pin sel';
    if (state.view !== 'home') {
      const tag = document.createElement('span');
      tag.textContent = 'Tu parada';
      el.append(tag);
    }
    stopPin = new maplibregl.Marker({ element: el }).setLngLat([stop.lng, stop.lat]).addTo(map);
  }
  if (state.me && !mePin) {
    const el = document.createElement('div');
    el.className = 'me';
    mePin = new maplibregl.Marker({ element: el }).setLngLat([state.me.lng, state.me.lat]).addTo(map);
  } else if (state.me) {
    mePin.setLngLat([state.me.lng, state.me.lat]);
  }
}

function updateApproach() {
  if (!mapReady) return;
  const empty = { type: 'FeatureCollection', features: [] };
  const key = heroBusKey();
  const bus = key ? state.busByKey.get(key) : null;
  const focusSrc = map.getSource('focus');
  const approachSrc = map.getSource('approach');
  if (!focusSrc || !approachSrc) return;
  if (!bus) {
    focusSrc.setData(empty);
    approachSrc.setData(empty);
    return;
  }
  focusSrc.setData(asLine(bus.dir.path, { color: bus.line.color }));
  let target = bus.dir.stops.length - 1;
  if (state.stopId) {
    const i = bus.dir.stops.indexOf(state.stopId);
    if (i >= bus.nextStopIndex) target = i;
  }
  const path = approachPath(bus, target);
  approachSrc.setData(path.length > 1 ? asLine(path) : empty);
}

/* ---------- Panel ---------- */
const minutesHTML = (eta) => (eta === 0 ? 'Ahora' : `${eta}<small> min</small>`);
const BACK = '<button type="button" class="back" data-act="back" aria-label="Volver"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg></button>';
const FOOT = '<p class="foot">Posición estimada con el horario oficial, sin GPS real. Web no oficial. Datos: <a href="https://buslugo.com/" target="_blank" rel="noopener">buslugo.com</a>.</p>';

function arrivalRow(a, selected, withHead) {
  return `<button type="button" class="row${selected ? ' sel' : ''}" data-act="arrival" data-key="${esc(a.key)}" data-stop="${esc(a.stopId)}">
    <span class="badge" style="--c:${a.line.color}">${esc(a.line.number)}</span>
    <span class="to">${esc(a.dir.dest)}<small>${withHead ? `a las ${a.time}` : ''}</small></span>
    <span class="eta">${minutesHTML(a.eta)}</span>
  </button>`;
}

function arrivalsFor(stopId) {
  const c = clock();
  return arrivalsAt(net, stopId, c.kind, c.t).map((a) => ({ ...a, stopId }));
}

function currentHero() {
  if (!state.stopId) return null;
  const list = arrivalsFor(state.stopId);
  return list.find((a) => a.key === state.arrivalKey) ?? list[0] ?? null;
}

function homeHTML() {
  const stop = net.stopById.get(state.homeStopId);
  const list = arrivalsFor(stop.id).slice(0, 3);
  const c = clock();
  const where = state.me ? `a ${Math.round(distanceMetres(state.me.lat, state.me.lng, stop.lat, stop.lng) / 10) * 10} m de ti` : 'Parada de ejemplo. Usa la flecha para ver la tuya';
  const rows = list.length
    ? `<div class="rows">${list.map((a) => arrivalRow(a, false, false)).join('')}</div>`
    : `<p class="empty">${state.buses.length ? 'No hay buses por esta parada en las próximas dos horas.' : 'Ahora mismo no hay buses en la calle.'}</p>`;
  const wake = !state.buses.length && c.live ? '<button type="button" class="cta" data-act="sim10">Ver cómo se mueven a las 10:00</button>' : '';
  return `<div class="head"><div><h1>${esc(stop.name)}</h1><small>${esc(where)}</small></div></div>${rows}${wake}${FOOT}`;
}

function stepsHTML(bus, a) {
  const left = Math.max(0, a.stopIndex - bus.nextStopIndex);
  const dots = Math.min(left, 6);
  let track = `<i class="from" style="--c:${a.line.color}"></i><b></b>`;
  for (let i = 0; i < dots; i++) track += '<i></i><b></b>';
  track += '<i class="to"></i>';
  const label = left === 0 ? "Es la siguiente" : left === 1 ? "Falta 1 parada" : `Faltan ${left} paradas`;
  return `<div class="steps"><div class="track" aria-hidden="true">${track}</div><span>${label}</span></div>`;
}

function stopHTML() {
  const stop = net.stopById.get(state.stopId);
  const list = arrivalsFor(stop.id);
  const hero = list.find((a) => a.key === state.arrivalKey) ?? list[0];
  const sub = stop.code ? `Poste ${esc(stop.code)}` : 'Parada';
  const head = `<div class="head">${BACK}<div><h1>${esc(stop.name)}</h1><small>${sub}</small></div></div>`;
  if (!hero) return `${head}<p class="empty">No hay buses por esta parada en las próximas dos horas.</p>${FOOT}`;
  const bus = state.busByKey.get(hero.key);
  const label = bus ? 'Tu bus llega en' : 'Sale de cabecera en';
  const big = hero.eta === 0 ? 'Ya' : `${hero.eta} min`;
  const armed = state.alert?.key === hero.key;
  const canAlert = hero.minutes - clock().t > 2;
  const later = list.filter((a) => a.key !== hero.key).slice(0, 5);
  return `${head}
    <div class="stop-grid">
      <div class="hero">
        <div class="hero-top">
          <div><p>${label}</p><div class="bignum">${big}</div></div>
          <div class="hero-side"><span class="badge big" style="--c:${hero.line.color}">${esc(hero.line.number)}</span><span>a las ${hero.time}</span></div>
        </div>
        <p class="hacia">Hacia <strong>${esc(hero.dir.dest)}</strong></p>
        ${bus ? stepsHTML(bus, hero) : ''}
        <div class="buttons">
          ${canAlert ? `<button type="button" class="cta${armed ? ' on' : ''}" data-act="alert" data-key="${esc(hero.key)}">${armed ? 'Aviso activado · Quitar' : 'Avísame 2 min antes'}</button>` : ''}
          ${bus ? `<button type="button" class="cta second" data-act="follow" data-key="${esc(hero.key)}">Seguir el bus</button>` : ''}
        </div>
      </div>
      <div class="rows"><h2>Después</h2>${later.length ? later.map((a) => arrivalRow(a, false, false)).join('') : '<p class="empty">No hay más buses en las próximas dos horas.</p>'}</div>
    </div>${FOOT}`;
}

function busHTML() {
  const bus = state.busByKey.get(state.busKey);
  if (!bus) {
    return `<div class="head">${BACK}<div><h1>Este bus ha terminado su recorrido</h1></div></div>${FOOT}`;
  }
  const c = clock();
  if (bus.parkedUntil) {
    const end = net.stopById.get(bus.dir.stops[bus.dir.stops.length - 1]);
    return `<div class="head">${BACK}<span class="badge" style="--c:${bus.line.color}">${esc(bus.line.number)}</span><div><small>En cabecera: ${esc(end.name)}</small></div></div>
      <p class="big-line">Vuelve a salir a las ${formatMinutes(bus.parkedUntil)}</p>${FOOT}`;
  }
  const svc = bus.dir.svc[c.kind];
  const mine = state.stopId ? bus.dir.stops.indexOf(state.stopId) : -1;
  const toMine = mine >= bus.nextStopIndex;
  const end = bus.dir.stops.length - 1;
  const targetTime = passTime(svc, bus.run, toMine ? mine : end);
  const eta = Math.max(0, Math.round(targetTime - c.t));
  const title = toMine ? (eta === 0 ? 'Llegando a tu parada' : `A ${eta} min de tu parada`) : (eta === 0 ? 'Llegando al final' : `A ${eta} min del final`);
  const from = Math.max(0, bus.nextStopIndex - 1);
  const rows = bus.dir.stops.slice(from).map((id, offset) => {
    const i = from + offset;
    const cls = i < bus.nextStopIndex ? 'past' : (i === mine ? 'you' : '');
    const name = net.stopById.get(id)?.name ?? id;
    return `<li class="${cls}"><time>${formatMinutes(passTime(svc, bus.run, i))}</time><span class="rail"></span><span>${esc(name)}${i === mine ? ' · Tu parada' : ''}</span></li>`;
  }).join('');
  return `<div class="head">${BACK}<span class="badge" style="--c:${bus.line.color}">${esc(bus.line.number)}</span><div><small>Hacia ${esc(bus.dir.dest)}</small></div></div>
    <p class="big-line">${title}</p>
    <ol class="tl">${rows}</ol>
    <button type="button" class="cta second" data-act="soon">Voy en este bus · Próximamente</button>${FOOT}`;
}

function lineHTML() {
  const group = net.lines.filter((l) => l.number === state.lineNumber);
  const line = group[0];
  const running = state.buses.filter((b) => b.line.number === state.lineNumber).length;
  const variants = group.map((l) => `<div class="row"><span class="to">${esc(l.name)}<small>${esc(l.days)} · ${esc(l.frequency)} · de ${esc(l.first)} a ${esc(l.last)}</small></span></div>`).join('');
  const stateText = running === 0 ? 'Ningún bus en ruta ahora' : `${running} bus${running === 1 ? '' : 'es'} en ruta ahora`;
  return `<div class="head">${BACK}<span class="badge big" style="--c:${line.color}">${esc(line.number)}</span><div><h1>Línea ${esc(line.number)}</h1><small>${stateText}</small></div></div>
    <div class="rows">${variants}</div>${FOOT}`;
}

function searchHTML() {
  const q = norm(state.query.trim());
  if (!q) return `<div class="head">${BACK}<div><h1>Buscar</h1><small>Escribe el nombre de una parada o una línea</small></div></div>`;
  const lines = [...new Map(net.lines.filter((l) => norm(l.number).startsWith(q) || norm(l.name).includes(q)).map((l) => [l.number, l])).values()].slice(0, 6);
  const stops = net.stops.filter((s) => norm(s.name).includes(q) || (s.code && s.code.toLowerCase() === q)).slice(0, 30);
  if (!lines.length && !stops.length) return `<div class="head">${BACK}<div><h1>Sin resultados</h1><small>Prueba con otra parte del nombre, como «Fontiñas» o «HULA»</small></div></div>`;
  return `<div class="head">${BACK}<div><h1>${stops.length + lines.length} resultado${stops.length + lines.length === 1 ? '' : 's'}</h1></div></div>
    <div class="rows">
      ${lines.map((l) => `<button type="button" class="row" data-act="line" data-number="${esc(l.number)}"><span class="badge" style="--c:${l.color}">${esc(l.number)}</span><span class="to">${esc(l.name)}</span></button>`).join('')}
      ${stops.map((s) => `<button type="button" class="row" data-act="stop" data-id="${esc(s.id)}"><span class="to">${esc(s.name)}<small>${s.lines.length} línea${s.lines.length === 1 ? '' : 's'}</small></span></button>`).join('')}
    </div>`;
}

function noticesHTML() {
  return `<div class="head">${BACK}<div><h1>Avisos</h1></div></div>
    ${NOTICES.map((n) => `<div class="notice-item"><strong>${esc(n.title)}</strong>${esc(n.body)}<small><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.source)}</a></small></div>`).join('')}
    ${FOOT}`;
}

let lastHTML = '';
function renderSheet() {
  const html = { home: homeHTML, stop: stopHTML, bus: busHTML, line: lineHTML, search: searchHTML, notices: noticesHTML }[state.view]();
  if (html !== lastHTML) {
    $('#sheet-body').innerHTML = html;
    lastHTML = html;
  }
}

function renderClock() {
  const c = clock();
  const n = state.buses.filter((b) => !b.parkedUntil).length;
  const count = `${n} bus${n === 1 ? '' : 'es'} en ruta`;
  const el = $('#clock');
  el.classList.toggle('sim', !c.live);
  const label = { laborable: 'laborable', sabado: 'sábado', domingo: 'domingo' }[c.kind];
  el.innerHTML = c.live
    ? `<i></i>${count} · ${formatMinutes(Math.floor(c.t))}`
    : `<i></i>Simulación ×${sim.speed} · ${label} ${formatMinutes(Math.floor(c.t))} · ${n}`;
  if (!$('#simpanel').hidden) syncSimPanel();
}

function checkAlert() {
  if (!state.alert) return;
  const c = clock();
  const { key, stopId, name, number } = state.alert;
  const a = arrivalsFor(stopId).find((x) => x.key === key);
  if (a && a.minutes - c.t > 2) return;
  state.alert = null;
  const text = `La línea ${number} llega a ${name} en menos de 2 minutos`;
  toast(text);
  try {
    if (navigator.vibrate) navigator.vibrate(200);
    if ('Notification' in window && Notification.permission === 'granted') new Notification('Buses de Lugo', { body: text });
  } catch { /* el aviso en pantalla ya está dado */ }
}

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

/* ---------- Acciones ---------- */
function go(view) {
  if (view !== state.view && state.view !== 'search' && state.view !== 'notices') state.previous = state.view;
  state.view = view;
  document.body.dataset.view = view;
  if ($('#sheet').dataset.size === 'peek') $('#sheet').dataset.size = 'mid';
  document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(view === 'line' && c.dataset.number === state.lineNumber)));
  renderSheet();
  updateMarkers();
  updatePins();
  applyMapFocus();
  updateApproach();
  $('#sheet-body').scrollTop = 0;
}

function selectStop(id, keepArrival = false) {
  if (!net.stopById.has(id)) return;
  state.stopId = id;
  if (!keepArrival) state.arrivalKey = null;
  $('#q').value = '';
  state.query = '';
  go('stop');
  try { history.replaceState(null, '', `#${id}`); } catch { /* sin historial en el visor */ }
  focusHero();
}

function focusHero() {
  const stop = net.stopById.get(state.stopId);
  const hero = currentHero();
  const bus = hero ? state.busByKey.get(hero.key) : null;
  requestAnimationFrame(() => {
    if (bus) moveTo([[stop.lat, stop.lng], ...approachPath(bus, hero.stopIndex)]);
    else moveTo([[stop.lat, stop.lng]], 15.5);
  });
}

function selectBus(key) {
  state.busKey = key;
  state.previous = state.view === 'bus' ? state.previous : state.view;
  go('bus');
  const bus = state.busByKey.get(key);
  if (bus) {
    const i = state.stopId ? bus.dir.stops.indexOf(state.stopId) : -1;
    const target = i >= bus.nextStopIndex ? i : Math.min(bus.nextStopIndex + 6, bus.dir.stops.length - 1);
    requestAnimationFrame(() => moveTo(approachPath(bus, target)));
  }
}

function selectLine(number) {
  if (state.view === 'line' && state.lineNumber === number) {
    goHome();
    return;
  }
  state.lineNumber = number;
  go('line');
  const points = net.lines.filter((l) => l.number === number).flatMap((l) => l.dirs.flatMap((d) => d.path));
  requestAnimationFrame(() => moveTo(points, 15));
}

function goHome() {
  state.stopId = null;
  state.arrivalKey = null;
  state.busKey = null;
  $('#q').value = '';
  state.query = '';
  go('home');
  try { history.replaceState(null, '', location.pathname); } catch { /* sin historial en el visor */ }
  if (map) requestAnimationFrame(() => map.fitBounds(CITY_BOUNDS, { padding: mapPadding(), duration: reduced ? 0 : 700 }));
}

function goBack() {
  if (state.view === 'bus' && state.stopId) { go('stop'); focusHero(); return; }
  goHome();
}

async function locate() {
  if (!navigator.geolocation) { toast('Este navegador no da la ubicación. Busca tu parada por el nombre.'); return; }
  navigator.geolocation.getCurrentPosition((pos) => {
    state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    let best = net.stops[0];
    let bestD = Infinity;
    for (const s of net.stops) {
      const d = distanceMetres(state.me.lat, state.me.lng, s.lat, s.lng);
      if (d < bestD) { bestD = d; best = s; }
    }
    state.homeStopId = best.id;
    state.stopId = null;
    go('home');
    if (bestD > 20000) {
      toast('Estás lejos de Lugo: esta es la parada más cercana.');
      return;
    }
    requestAnimationFrame(() => moveTo([[state.me.lat, state.me.lng], [best.lat, best.lng]], 16));
  }, () => toast('No se ha podido obtener tu ubicación. Busca tu parada por el nombre.'), { timeout: 8000, maximumAge: 60000 });
}

function wire() {
  $('#sheet-body').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'back') goBack();
    else if (act === 'stop') selectStop(t.dataset.id);
    else if (act === 'line') selectLine(t.dataset.number);
    else if (act === 'follow') selectBus(t.dataset.key);
    else if (act === 'soon') toast('Compartir la posición del bus aún no está en la demo.');
    else if (act === 'sim10') setSim({ base: 600, kind: 'laborable', speed: 1 });
    else if (act === 'arrival') {
      if (state.view === 'home') {
        state.arrivalKey = t.dataset.key;
        selectStop(t.dataset.stop, true);
      } else {
        state.arrivalKey = t.dataset.key;
        renderSheet();
        updateMarkers();
        updateApproach();
        focusHero();
      }
    } else if (act === 'alert') {
      if (state.alert?.key === t.dataset.key) {
        state.alert = null;
        renderSheet();
        return;
      }
      const stop = net.stopById.get(state.stopId);
      const line = net.lineById.get(t.dataset.key.split('|')[0]);
      state.alert = { key: t.dataset.key, stopId: stop.id, name: stop.name, number: line.number };
      renderSheet();
      toast('Te avisaremos en esta pantalla. Déjala abierta.');
      try {
        if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      } catch { /* sin permiso, queda el aviso en pantalla */ }
    }
  });

  $('#q').addEventListener('input', (e) => {
    state.query = e.target.value;
    go(state.query ? 'search' : 'home');
  });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.target.value = ''; state.query = ''; goHome(); }
  });
  $('#bell').addEventListener('click', () => go('notices'));
  $('#notice').addEventListener('click', () => go('notices'));
  $('#locate').addEventListener('click', locate);
  $('#zoom-in').addEventListener('click', () => map?.zoomIn());
  $('#zoom-out').addEventListener('click', () => map?.zoomOut());
  $('#chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) selectLine(c.dataset.number);
  });

  $('#clock').addEventListener('click', () => {
    const panel = $('#simpanel');
    panel.hidden = !panel.hidden;
    $('#clock').setAttribute('aria-expanded', String(!panel.hidden));
    syncSimPanel();
  });
  $('#sim-time').addEventListener('input', (e) => setSim({ base: Number(e.target.value) }));
  document.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => setSim({ kind: b.dataset.day })));
  document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => setSim({ speed: Number(b.dataset.speed) })));
  $('#sim-live').addEventListener('click', () => {
    sim.on = false;
    sim.speed = 1;
    syncSimPanel();
    tickData();
    renderSheet();
  });

  // Panel inferior: tocar el asa cambia de tamaño; arrastrar elige hacia dónde.
  const sheet = $('#sheet');
  const sizes = ['peek', 'mid', 'tall'];
  let startY = null;
  const grab = $('#grab');
  grab.addEventListener('pointerdown', (e) => { startY = e.clientY; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointerup', (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    const i = sizes.indexOf(sheet.dataset.size);
    if (Math.abs(dy) < 8) sheet.dataset.size = sizes[(i + 1) % sizes.length];
    else sheet.dataset.size = sizes[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))];
  });
  new ResizeObserver(() => {
    if (desktop.matches) {
      document.documentElement.style.removeProperty('--sheet-h');
      return;
    }
    document.documentElement.style.setProperty('--sheet-h', `${Math.round(sheet.getBoundingClientRect().height)}px`);
  }).observe(sheet);

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (net.stopById.has(id) && id !== state.stopId) selectStop(id);
  });
}

function buildChips() {
  const seen = new Map();
  for (const l of net.lines) if (!seen.has(l.number)) seen.set(l.number, l);
  $('#chips').innerHTML = [...seen.values()]
    .map((l) => `<button type="button" class="chip" data-number="${esc(l.number)}" aria-pressed="false" style="--c:${l.color}"><i></i>${esc(l.number)}</button>`)
    .join('');
}

async function start() {
  net = prepare(await fetch('data/network.json').then((r) => r.json()));
  routesData = {
    type: 'FeatureCollection',
    features: net.lines.flatMap((l) => l.dirs.map((d) => asLine(d.path, { line: l.id, number: l.number, color: l.color }))),
  };
  stopsData = {
    type: 'FeatureCollection',
    features: net.stops.map((s) => ({ type: 'Feature', properties: { id: s.id }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })),
  };
  document.body.dataset.view = state.view;
  buildChips();
  wire();
  tickData();
  renderSheet();
  renderClock();
  syncSimPanel();
  await initMap();
  updatePins();
  const initial = location.hash.slice(1);
  if (net.stopById.has(initial)) selectStop(initial);
  setInterval(() => {
    if (!map) tickData();
    renderSheet();
    renderClock();
    checkAlert();
  }, 1000);
}

start().catch((err) => {
  console.error(err);
  $('#sheet-body').innerHTML = '<p class="empty">No se han podido cargar los datos de la red. Recarga la página.</p>';
});
