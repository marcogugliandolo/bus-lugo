// Xa Vén /demo: mapa, panel y reloj. El cálculo de posiciones está en sim.js.
import { prepare, busesAt, arrivalsAt, approachPath, dayKind, formatMinutes, passTime, distanceMetres } from './sim.js';

const TILES_CHECK = 'https://tiles.openfreemap.org/planet';
const CITY_BOUNDS = [[-7.585, 42.992], [-7.53, 43.035]];
const NOTICES = [{
  title: 'Cambios en las líneas 7, 8, 9 y 12 por obras',
  lines: ['7', '8', '9', '12'],
  body: 'El recorrido que ves en el mapa puede no incluir estos desvíos.',
  date: 'Actualizado el 2 de noviembre de 2026',
}];

// Cómo llama el operador a cada línea (buslugo.com/lineas, 2 de noviembre de 2026).
// Es lo que entiende quien no conoce la red; `hospital` marca las que llegan al HULA.
const ROUTES = {
  '1.1': { route: 'Campus USC – Fingoi – O Ceao' },
  '1.2': { route: 'Campus USC – Fingoi – O Ceao – Hospital', hospital: true },
  '1.3': { route: 'Campus USC – Fontiñas – O Ceao' },
  '1.4': { route: 'Campus USC – Fingoi – O Ceao – Hospital', hospital: true },
  2: { route: 'Rda. Xosé Castiñeira – Ramil' },
  '3.1': { route: 'Rda. Muralla (Sindicatos) – Avda. Coruña – Fontiñas – Montirón – A Tolda' },
  '3.2': { route: 'Rda. Muralla (Sindicatos) – Fontiñas – Montirón – A Tolda' },
  '4.1': { route: 'Rda. Muralla (Sindicatos) – Hospital, por Fervedoira', hospital: true },
  '4.2': { route: 'Rda. Muralla (Sindicatos) – Hospital, por As Gándaras', hospital: true },
  '5DS': { route: 'Avda. das Américas – Magoi – Fontiñas – Hospital', hospital: true },
  '5ES': { route: 'Fonte dos Ranchos – Abella – Garabolos – Hospital', hospital: true },
  '5.1': { route: 'Avda. das Américas – Rda. Muralla – Fontiñas – Carqueixo – Hospital', hospital: true },
  '5.2': { route: 'Avda. das Américas – Magoi – Fontiñas – Hospital', hospital: true },
  6: { route: 'A Piringalla – Magoi – Acea de Olga – Veterinaria' },
  7: { route: 'Casco Histórico (Bolaño) – Barrio da Ponte' },
  8: { route: 'Casco Histórico (Bolaño) – A Cheda' },
  9: { route: 'Casco Histórico (Bolaño) – Abella (Casás)' },
  10: { route: 'Ramón Ferreiro – Cementerio' },
  11: { route: 'Línea rural: Pías, Bóveda, Calde y Nadela' },
  12: { route: 'Casco Histórico (Bolaño) – Polígono Gándaras' },
  13: { route: 'Rda. Muralla (Sindicatos) – As Gándaras' },
};
const routeOf = (line) => ROUTES[line.number]?.route ?? line.name;
const nice = (name) => String(name).replace(/^HULA \(Ent\. Personal\).*$/i, 'Hospital (entrada de personal)').replace(/^HULA\b.*$/i, 'Hospital (HULA)');
const hasWorks = (number) => NOTICES.some((n) => n.lines.includes(number));
const shortDays = (days) => (/lunes a viernes/i.test(days) ? 'Lunes a viernes' : (/todos/i.test(days) ? 'Todos los días' : days));

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
  view: 'home',            // home | stop | bus | menu | line | notices | sim | search
  stopId: null,
  homeStopId: null,
  me: null,
  arrivalKey: null,
  busKey: null,
  lineNumber: null,
  lineDir: 0,
  follow: false,
  busFromLine: false,
  stopFromLine: false,
  query: '',
  alerts: [],
  bellFor: null,
  showStops: false,
  showIdle: false,
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
  renderClock();
}

let sliderHeld = false;
function syncSimPanel() {
  const c = clock();
  document.querySelectorAll('[data-day]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.day === c.kind)));
  document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === (c.live ? 1 : sim.speed))));
  const slider = $('#sim-time');
  if (!sliderHeld) slider.value = String(Math.max(300, Math.floor(c.t)));
  $('#sim-out').textContent = formatMinutes(Math.floor(c.t));
  $('#sim-live').hidden = c.live;
}

/* ---------- Tema: sigue al sistema hasta que la persona elige con el botón ---------- */
const SUN = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"></circle><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"></path></svg>';
const MOON = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"></path></svg>';
function readTheme() {
  try { return localStorage.getItem('xaven-tema'); } catch { return null; }
}
function paintThemeButton() {
  const dark = isDark();
  const button = $('#theme');
  button.innerHTML = dark ? SUN : MOON;
  button.setAttribute('aria-label', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  button.title = dark ? 'Modo claro' : 'Modo oscuro';
}
function setTheme(value) {
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem('xaven-tema', value); } catch { /* se aplica solo a esta visita */ }
  paintThemeButton();
}
const savedTheme = readTheme();
if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;

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
  shownFocus = null;
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('routes', { type: 'geojson', data: routesData });
  map.addSource('bus-stops', { type: 'geojson', data: stopsData });
  map.addSource('focus', { type: 'geojson', data: empty });
  map.addSource('approach', { type: 'geojson', data: empty });
  const round = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({ id: 'routes', type: 'line', source: 'routes', layout: round, paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.34, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 2.4, 18, 5] } });
  map.addLayer({ id: 'route-sel', type: 'line', source: 'routes', layout: round, filter: ['==', ['get', 'number'], ''], paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 5, 18, 8] } });
  map.addLayer({ id: 'focus', type: 'line', source: 'focus', layout: round, paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.7, 'line-width': 4 } });
  map.addLayer({ id: 'approach', type: 'line', source: 'approach', layout: round, paint: { 'line-color': token('--ink'), 'line-width': 6 } });
  map.addLayer({ id: 'bus-stops', type: 'circle', source: 'bus-stops', minzoom: 14.6, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14.6, 2.6, 16, 4.5], 'circle-color': token('--surface'), 'circle-stroke-color': token('--mute'), 'circle-stroke-width': 1.2 } });
  mapReady = true;
  applyMapFocus(false);
  updateApproach();
}

async function initMap() {
  try {
    const box = $('#map');
    if (!box.clientWidth || !box.clientHeight) {
      await new Promise((resolve) => {
        const wait = new ResizeObserver(() => {
          if (box.clientWidth && box.clientHeight) {
            wait.disconnect();
            resolve();
          }
        });
        wait.observe(box);
      });
    }
    remoteTiles = await fetch(TILES_CHECK, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
    map = new maplibregl.Map({
      container: 'map',
      style: await buildStyle(),
      bounds: CITY_BOUNDS,
      fitBoundsOptions: { padding: mapPadding() },
      attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      fadeDuration: 80,
      renderWorldCopies: false,
      refreshExpiredTiles: false,
      validateStyle: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxZoom: 18,
      minZoom: 10,
    });
    map.touchZoomRotate.disableRotation();
    map.on('dragstart', () => { state.follow = false; });
    map.on('wheel', () => { state.follow = false; });
    map.on('touchstart', (e) => { if (e.originalEvent?.touches?.length > 1) state.follow = false; });
    new ResizeObserver(() => map.resize()).observe(box);
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
  const lead = state.view === 'line' || state.view === 'bus' ? 40 : 0; // el bus resaltado es más grande
  const tag = state.view === 'stop' ? 70 : 0; // deja sitio al nombre de la parada
  return { top: top + lead + tag, bottom: sheet + 30 + lead, left: side + 40 + lead + tag, right: 40 + lead + tag };
}

function moveTo(points, maxZoom = 15.6, duration = 700) {
  if (!map) return;
  const lngs = points.map((p) => p[1]);
  const lats = points.map((p) => p[0]);
  const bounds = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
  map.fitBounds(bounds, { padding: mapPadding(), maxZoom, duration: reduced ? 0 : duration });
}

const asLine = (coords, properties = {}) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords.map((p) => [p[1], p[0]]) } });

/** Atenúa la red cuando hay algo elegido y resalta la línea o el recorrido. */
function applyMapFocus() {
  if (!mapReady) return;
  const alone = state.view === 'line' || state.view === 'bus';
  map.setPaintProperty('routes', 'line-opacity', alone || state.view === 'stop' ? 0 : (isDark() ? 0.42 : 0.34));
  let ids = null;
  if (state.view === 'line') ids = net.lines.filter((l) => l.number === state.lineNumber).flatMap((l) => l.dirs.flatMap((d) => d.stops));
  if (state.view === 'bus') ids = state.busByKey.get(state.busKey)?.dir.stops ?? null;
  map.setFilter('bus-stops', ids ? ['in', ['get', 'id'], ['literal', [...new Set(ids)]]] : null);
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
  const marker = new maplibregl.Marker({ element: wrap, subpixelPositioning: true }).setLngLat([bus.lng, bus.lat]).addTo(map);
  return { marker, el, x: 0, y: 0, tx: 0, ty: 0, shownX: 0, shownY: 0, lng: bus.lng, lat: bus.lat, r: null, look: '' };
}

function heroBusKey() {
  if (state.view === 'bus') return state.busKey;
  if (state.view === 'stop') {
    const hero = currentHero();
    if (hero && state.busByKey.has(hero.key)) return hero.key;
  }
  return null;
}

/** Mantiene en pantalla el bus o los buses elegidos hasta que la persona mueva el mapa. */
function followCamera(duration = 900) {
  if (!state.follow || !map) return;
  if (state.view === 'line') {
    const mine = state.buses.filter((b) => b.line.number === state.lineNumber);
    const moving = mine.filter((b) => !b.parkedUntil);
    const list = moving.length ? moving : mine;
    if (list.length) moveTo(list.map((b) => [b.lat, b.lng]), 15.8, duration);
  } else if (state.view === 'bus') {
    const bus = state.busByKey.get(state.busKey);
    if (!bus) return;
    const points = [[bus.lat, bus.lng]];
    const i = state.stopId ? bus.dir.stops.indexOf(state.stopId) : -1;
    if (i >= bus.nextStopIndex) {
      const stop = net.stopById.get(state.stopId);
      points.push([stop.lat, stop.lng]);
    }
    moveTo(points, 15.8, duration);
  }
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
    if (Math.abs(m.lng - bus.lng) > 1e-6 || Math.abs(m.lat - bus.lat) > 1e-6) {
      m.lng = bus.lng;
      m.lat = bus.lat;
      m.marker.setLngLat([bus.lng, bus.lat]);
    }
    if (m.r !== bus.bearing) {
      m.r = bus.bearing;
      m.el.style.setProperty('--r', `${bus.bearing}deg`);
    }
    const inLine = state.view === 'line' && bus.line.number === state.lineNumber;
    const isHero = bus.key === hero || (inLine && !bus.parkedUntil);
    const filtered = (state.view === 'line' && !inLine) || (state.view === 'bus' && bus.key !== state.busKey) || (state.view === 'stop' && !isHero);
    const dimmed = Boolean(hero) && !isHero;
    const parked = Boolean(bus.parkedUntil);
    const look = `${isHero}|${filtered}|${dimmed}|${parked}`;
    if (m.look !== look) {
      m.look = look;
      m.el.classList.toggle('lead', isHero);
      m.el.classList.toggle('gone', filtered);
      m.el.classList.toggle('dim', dimmed);
      m.el.classList.toggle('parked', parked);
      m.marker.getElement().style.zIndex = isHero ? '5' : '1';
    }
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
    items.push({ m, x: p.x, y: p.y, fixed: bus.key === hero || m.el.classList.contains('lead'), ox: 0, oy: 0 });
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
  const fast = sim.on && sim.speed > 1;
  if (now - lastBusTick < (fast ? 66 : 200)) return;
  if (!fast && map?.isMoving()) return;
  lastBusTick = now;
  tickData();
  if (now - lastClutter > 500 && !map?.isMoving()) {
    lastClutter = now;
    declutter();
  }
  for (const m of markers.values()) {
    m.x += (m.tx - m.x) * 0.35;
    m.y += (m.ty - m.y) * 0.35;
    if (Math.abs(m.x - m.shownX) > 0.3 || Math.abs(m.y - m.shownY) > 0.3) {
      m.shownX = m.x;
      m.shownY = m.y;
      m.marker.setOffset([m.x, m.y]);
    }
  }
}

function tickData() {
  const c = clock();
  state.buses = busesAt(net, c.kind, c.t);
  state.busByKey = new Map(state.buses.map((b) => [b.key, b]));
  updateMarkers();
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
      tag.textContent = nice(stop.name);
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

let shownFocus = null;
function updateApproach() {
  if (!mapReady) return;
  const empty = { type: 'FeatureCollection', features: [] };
  const key = heroBusKey();
  const bus = key ? state.busByKey.get(key) : null;
  const focusSrc = map.getSource('focus');
  const approachSrc = map.getSource('approach');
  if (!focusSrc || !approachSrc) return;
  if (!bus) {
    if (shownFocus) {
      shownFocus = null;
      focusSrc.setData(empty);
      approachSrc.setData(empty);
    }
    return;
  }
  if (shownFocus !== bus.dir) {
    shownFocus = bus.dir;
    focusSrc.setData(asLine(bus.dir.path, { color: bus.line.color }));
  }
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
const BACK = '<button type="button" class="back" data-act="back" ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>Volver</button>';
const FOOT = '<p class="foot">Hora y posición aproximadas según el horario. Web no oficial.</p>';
const MAP_CREDIT = 'Mapa: OpenFreeMap © OpenMapTiles. Datos © OpenStreetMap.';

const BELL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"></path><path d="M10 20a2 2 0 0 0 4 0"></path></svg>';
const ALERT_OPTIONS = [2, 5, 10];

function bellButton(a) {
  const armed = state.alerts.find((x) => x.key === a.key && x.stopId === a.stopId);
  const left = a.minutes - clock().t;
  if (!armed && left <= ALERT_OPTIONS[0]) return '';
  const label = armed ? `Aviso ${armed.before} minutos antes. Cambiar` : 'Avisarme antes de que llegue';
  return `<button type="button" class="bell${armed ? ' on' : ''}" data-act="bell" data-key="${esc(a.key)}" data-stop="${esc(a.stopId)}" aria-label="${label}" aria-expanded="${state.bellFor === a.key}">${BELL}${armed ? `<span>${armed.before} min</span>` : ''}</button>`;
}

function bellChooser(a) {
  if (state.bellFor !== a.key) return '';
  const armed = state.alerts.find((x) => x.key === a.key && x.stopId === a.stopId);
  const left = a.minutes - clock().t;
  const options = ALERT_OPTIONS.filter((n) => left > n);
  return `<div class="bell-opts"><p>¿Cuánto antes te avisamos?</p><div class="bell-row">
    ${options.map((n) => `<button type="button" data-act="bell-set" data-key="${esc(a.key)}" data-stop="${esc(a.stopId)}" data-before="${n}" aria-pressed="${armed?.before === n}">${n} min</button>`).join('')}
    ${armed ? `<button type="button" class="off" data-act="bell-off" data-key="${esc(a.key)}" data-stop="${esc(a.stopId)}">Quitar</button>` : ''}
  </div><small>Deja esta pantalla abierta para recibir el aviso.</small></div>`;
}

function arrivalRow(a) {
  return `<div class="row arr">
    <button type="button" class="row-main" data-act="arrival" data-key="${esc(a.key)}" data-stop="${esc(a.stopId)}">
      <span class="badge" style="--c:${a.line.color}">${esc(a.line.number)}</span>
      <span class="to">${esc(nice(a.dir.dest))}<small>a las ${a.time}</small></span>
      <span class="eta">${minutesHTML(a.eta)}</span>
    </button>${bellButton(a)}
  </div>${bellChooser(a)}`;
}

/** Dónde está el bus ahora, dicho con las paradas que tiene más cerca. */
function whereNow(bus) {
  const stops = bus.dir.stops;
  const next = net.stopById.get(stops[bus.nextStopIndex]);
  const nextName = nice(next?.name ?? '');
  if (bus.parkedUntil) return { label: 'Parado en', place: nextName, phase: 'parked' };
  if (bus.stopped) return { label: 'Ahora en la parada', place: nextName, phase: 'at' };
  const prev = net.stopById.get(stops[Math.max(0, bus.nextStopIndex - 1)]);
  const toPrev = distanceMetres(bus.lat, bus.lng, prev.lat, prev.lng);
  const toNext = distanceMetres(bus.lat, bus.lng, next.lat, next.lng);
  const part = toPrev / Math.max(1, toPrev + toNext);
  if (part < 0.35) return { label: 'Acaba de salir de', place: nice(prev.name), phase: 'left' };
  if (part > 0.65) return { label: 'Llegando a', place: nextName, phase: 'arriving' };
  return { label: 'Va entre', place: `${nice(prev.name)} y ${nextName}`, phase: 'between' };
}

/** Paradas alrededor del bus, con el bus dibujado en el sitio donde está ahora. */
function stripHTML(bus, { target = null, full = false } = {}) {
  const svc = bus.dir.svc[clock().kind];
  const stops = bus.dir.stops;
  const last = stops.length - 1;
  const next = bus.nextStopIndex;
  let shown;
  if (full) shown = stops.map((_, i) => i).slice(next);
  else if (target !== null) {
    shown = [];
    for (let i = next; i <= target; i++) shown.push(i);
    if (shown.length > 4) shown = [shown[0], shown[1], null, target];
  } else {
    shown = [next];
    if (next + 1 <= last) shown.push(next + 1);
    if (next + 2 < last) shown.push(null);
    if (next + 1 < last) shown.push(last);
  }
  const hiddenCount = () => {
    const known = shown.filter((i) => i !== null);
    const end = known[known.length - 1];
    const start = known[known.indexOf(end) - 1];
    return end - start - 1;
  };
  const row = (i, extra = '') => {
    const name = nice(net.stopById.get(stops[i])?.name ?? stops[i]);
    const isTarget = i === target;
    const here = bus.stopped && i === next;
    const cls = [here ? 'here' : '', isTarget ? 'you' : '', extra].filter(Boolean).join(' ');
    const note = here ? '<small>El bus está aquí</small>' : (isTarget ? '<small>Tu parada</small>' : '');
    return `<li class="${cls}"><time>${formatMinutes(passTime(svc, bus.run, i))}</time><span class="rail"></span><span>${esc(name)}${note}</span></li>`;
  };
  let html = '';
  if (next > 0 && !bus.stopped) html += row(next - 1, 'past');
  if (!bus.stopped) html += '<li class="bus-now"><time>Ahora</time><span class="rail"></span><span>El bus va por aquí</span></li>';
  for (const i of shown) {
    if (i === null) {
      const n = hiddenCount();
      if (n > 0) html += `<li class="gap"><time></time><span class="rail"></span><span>${n === 1 ? '1 parada más' : `${n} paradas más`}</span></li>`;
    } else html += row(i);
  }
  return `<ol class="tl strip" style="--c:${bus.line.color}">${html}</ol>`;
}

function nowCard(label, place, detail, key) {
  const inner = `<span class="now-text"><span class="now-label">${esc(label)}</span><strong>${esc(place)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span>`;
  return key
    ? `<button type="button" class="now" data-act="follow" data-key="${esc(key)}" aria-label="${esc(`${label} ${place}. Ver recorrido`)}">${inner}<span class="now-go" aria-hidden="true">›</span></button>`
    : `<div class="now">${inner}</div>`;
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
  const c = clock();
  const wake = !state.buses.length && c.live
    ? `<p class="empty">Ahora mismo no hay buses en la calle.</p><button type="button" class="cta second" data-act="sim10">Ver cómo se mueven a las 10:00</button>`
    : '';
  if (!state.homeStopId) {
    return `<p class="eyebrow"><img src="icon.svg" width="24" height="24" alt=""><span>Xa Vén</span> Los buses de Lugo</p><div class="head"><div><h1>¿A dónde quieres ir?</h1><small>Toca un bus o una parada para saber cuándo llega</small></div></div>
      <div class="buttons one">
        <button type="button" class="cta" data-act="near">Ver la parada más cercana</button>
        <button type="button" class="cta second" data-act="menu">Ver todas las líneas</button>
      </div>${wake}`;
  }
  const stop = net.stopById.get(state.homeStopId);
  const list = arrivalsFor(stop.id).slice(0, 3);
  const where = state.me ? `Tu parada más cercana, a ${Math.round(distanceMetres(state.me.lat, state.me.lng, stop.lat, stop.lng) / 10) * 10} m` : 'Tu parada';
  const rows = list.length
    ? `<div class="rows">${list.map((a) => arrivalRow(a)).join('')}</div>`
    : '<p class="empty">No pasa ningún bus por aquí en las próximas dos horas.</p>';
  return `<div class="head"><div><h1>${esc(nice(stop.name))}</h1><small>${esc(where)}</small></div></div>${rows}${wake}
    <button type="button" class="cta second" data-act="menu">Ver todas las líneas</button>`;
}

function stopHTML() {
  const stop = net.stopById.get(state.stopId);
  const list = arrivalsFor(stop.id);
  const hero = list.find((a) => a.key === state.arrivalKey) ?? list[0];
  const sub = stop.code ? `Código de parada: ${esc(stop.code)}` : 'Parada';
  const head = `<div class="head">${BACK}<div><h1>${esc(nice(stop.name))}</h1><small>${sub}</small></div></div>`;
  if (!hero) return `${head}<p class="empty">No pasa ningún bus por aquí en las próximas dos horas.</p>${FOOT}`;
  const bus = state.busByKey.get(hero.key);
  const big = hero.eta === 0 ? 'Ya llega' : `${hero.eta} min`;
  let card;
  if (bus) {
    const left = Math.max(0, hero.stopIndex - bus.nextStopIndex);
    const where = whereNow(bus);
    let detail;
    if (left === 0) detail = where.phase === 'at' ? 'Está en esta parada' : 'Esta parada es la siguiente';
    else detail = left === 1 ? 'Le falta 1 parada para llegar aquí' : `Le faltan ${left} paradas para llegar aquí`;
    card = nowCard(where.label, where.place, detail, hero.key);
  } else {
    const svc = hero.dir.svc[clock().kind];
    card = nowCard('Todavía no ha salido', nice(hero.dir.origin), `Sale a las ${formatMinutes(svc.dep[hero.run] + svc.off[0])}`);
  }
  const later = list.filter((a) => a.key !== hero.key).slice(0, 5);
  return `${head}
    <div class="stop-grid">
      <div class="hero">
        <div class="hero-line">
          <span class="badge big" style="--c:${hero.line.color}">${esc(hero.line.number)}</span>
          <p class="hacia">Hacia <strong>${esc(nice(hero.dir.dest))}</strong></p>
          ${bellButton(hero)}
        </div>
        ${bellChooser(hero)}
        <div class="hero-time"><span class="bignum">${big}</span><span>a las ${hero.time}</span></div>
        ${card}
        ${bus ? stripHTML(bus, { target: hero.stopIndex }) : ''}
      </div>
      <div class="rows"><h2>Después pasan</h2>${later.length ? later.map((a) => arrivalRow(a)).join('') : '<p class="empty">No hay más buses en las próximas dos horas.</p>'}</div>
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
    return `<div class="head">${BACK}<span class="badge" style="--c:${bus.line.color}">${esc(bus.line.number)}</span><div><small>Parado en ${esc(nice(end.name))}</small></div></div>
      <p class="big-line">Vuelve a salir a las ${formatMinutes(bus.parkedUntil)}</p>${FOOT}`;
  }
  const svc = bus.dir.svc[c.kind];
  const mine = state.stopId ? bus.dir.stops.indexOf(state.stopId) : -1;
  const toMine = mine >= bus.nextStopIndex;
  const end = bus.dir.stops.length - 1;
  const targetTime = passTime(svc, bus.run, toMine ? mine : end);
  const eta = Math.max(0, Math.round(targetTime - c.t));
  const arrives = toMine ? (eta === 0 ? 'Ya llega a tu parada' : `Llega a tu parada en ${eta} min`) : (eta === 0 ? 'Llegando al final del recorrido' : `Llega al final en ${eta} min`);
  const where = whereNow(bus);
  return `<div class="head">${BACK}<span class="badge" style="--c:${bus.line.color}">${esc(bus.line.number)}</span><div><small>Hacia ${esc(nice(bus.dir.dest))}</small></div></div>
    ${nowCard(where.label, where.place, arrives)}
    <div class="rows"><h2>Su recorrido</h2></div>
    ${stripHTML(bus, { full: true, target: toMine ? mine : null })}${FOOT}`;
}

function lineDirections() {
  return net.lines.filter((l) => l.number === state.lineNumber).flatMap((line) => line.dirs.map((dir) => ({ line, dir })));
}

function nextDepartureOf(number, kind, t) {
  let best = null;
  for (const line of net.lines) {
    if (line.number !== number) continue;
    for (const dir of line.dirs) {
      const svc = dir.svc[kind];
      if (!svc) continue;
      for (const dep of svc.dep) {
        const start = dep + svc.off[0];
        if (start >= t && (best === null || start < best)) best = start;
      }
    }
  }
  return best;
}

function busCard(bus, kind) {
  const stops = bus.dir.stops;
  const where = whereNow(bus);
  if (bus.parkedUntil) return nowCard(where.label, where.place, `Vuelve a salir a las ${formatMinutes(bus.parkedUntil)}`);
  const svc = bus.dir.svc[kind];
  const next = net.stopById.get(stops[bus.nextStopIndex]);
  const inMin = Math.max(0, Math.round(passTime(svc, bus.run, bus.nextStopIndex) - clock().t));
  const after = net.stopById.get(stops[Math.min(bus.nextStopIndex + 1, stops.length - 1)]);
  const atOrArriving = where.phase === 'at' || where.phase === 'arriving';
  const nextText = atOrArriving
    ? (bus.nextStopIndex < stops.length - 1 ? `Después va a ${nice(after?.name ?? '')}` : 'Es el final del recorrido')
    : `Siguiente parada: ${nice(next?.name ?? '')}${inMin ? `, en ${inMin} min` : ''}`;
  return `<p class="card-title">Hacia ${esc(nice(bus.dir.dest))}</p>${nowCard(where.label, where.place, nextText, bus.key)}${stripHTML(bus)}`;
}

function lineHTML() {
  const group = net.lines.filter((l) => l.number === state.lineNumber);
  const line = group[0];
  const c = clock();
  const mine = state.buses.filter((b) => b.line.number === state.lineNumber);
  const title = mine.length > 1 ? `Dónde están ahora sus ${mine.length} buses` : 'Dónde está ahora';
  let status = mine.map((b) => busCard(b, c.kind)).join('');
  if (!mine.length) {
    const next = nextDepartureOf(state.lineNumber, c.kind, c.t);
    status = `<div class="now"><span class="now-text"><span class="now-label">Ahora mismo</span><strong>No hay ningún bus en la calle</strong><small>${next === null ? 'Hoy ya no hay más salidas de esta línea' : `El próximo sale a las ${formatMinutes(next)}`}</small></span></div>`;
  }
  const notice = hasWorks(state.lineNumber) ? `<div class="notice-item"><strong>Cambios por obras</strong>${esc(NOTICES[0].body)}</div>` : '';
  const toggle = `<button type="button" class="cta second" data-act="toggle-stops" aria-expanded="${state.showStops}">${state.showStops ? 'Ocultar paradas y horario' : 'Ver paradas y horario'}</button>`;
  let details = '';
  if (state.showStops) {
    const dirs = lineDirections();
    const index = Math.min(state.lineDir, dirs.length - 1);
    const current = dirs[index];
    const hours = [...new Set(group.map((l) => [shortDays(l.days), /consultar/i.test(l.frequency) ? '' : l.frequency, `de ${l.first} a ${l.last}`].filter(Boolean).join(' · ')))];
    const dests = dirs.map((d) => d.dir.dest);
    const dirLabel = (d) => (dests.filter((x) => x === d.dir.dest).length > 1 ? `De ${nice(d.dir.origin)} a ${nice(d.dir.dest)}` : `Hacia ${nice(d.dir.dest)}`);
    const buttons = dirs.map((d, i) => `<button type="button" data-act="line-dir" data-index="${i}" aria-pressed="${i === index}">${esc(dirLabel(d))}</button>`).join('');
    const stops = current.dir.stops.map((id) => {
      const stop = net.stopById.get(id);
      return `<button type="button" class="row" data-act="stop" data-id="${esc(id)}"><span class="to">${esc(nice(stop?.name ?? id))}</span></button>`;
    }).join('');
    details = `<p class="hours">${hours.map(esc).join('<br>')}</p>
      <div class="dirs" role="group" aria-label="Sentido">${buttons}</div>
      <div class="rows"><h2>${current.dir.stops.length} paradas</h2>${stops}</div>`;
  }
  return `<div class="head">${BACK}<span class="badge big" style="--c:${line.color}">${esc(line.number)}</span><div><h1 class="route">${esc(routeOf(line))}</h1></div></div>
    <div class="rows"><h2>${esc(title)}</h2></div>
    ${status}${notice}${toggle}${details}${FOOT}`;
}

function searchHTML() {
  const q = norm(state.query.trim());
  if (!q) return `<div class="head">${BACK}<div><h1>Buscar</h1><small>Escribe el nombre de una parada o una línea</small></div></div>`;
  const lines = [...new Map(net.lines.filter((l) => norm(l.number).startsWith(q) || norm(routeOf(l)).includes(q) || norm(l.name).includes(q) || (ROUTES[l.number]?.hospital && 'hospital'.startsWith(q))).map((l) => [l.number, l])).values()].slice(0, 8);
  const stops = net.stops.filter((s) => norm(s.name).includes(q) || norm(nice(s.name)).includes(q) || (s.code && s.code.toLowerCase() === q)).slice(0, 30);
  if (!lines.length && !stops.length) return `<div class="head">${BACK}<div><h1>Sin resultados</h1><small>Prueba con otra parte del nombre, como «Fontiñas» o «HULA»</small></div></div>`;
  return `<div class="head">${BACK}<div><h1>${stops.length + lines.length} resultado${stops.length + lines.length === 1 ? '' : 's'}</h1></div></div>
    <div class="rows">
      ${lines.map((l) => `<button type="button" class="row" data-act="line" data-number="${esc(l.number)}"><span class="badge" style="--c:${l.color}">${esc(l.number)}</span><span class="to">${esc(routeOf(l))}<small>${esc(lineStatus(l.number).text)}</small></span></button>`).join('')}
      ${stops.map((s) => `<button type="button" class="row" data-act="stop" data-id="${esc(s.id)}"><span class="to">${esc(nice(s.name))}<small>${s.lines.length} línea${s.lines.length === 1 ? '' : 's'}</small></span></button>`).join('')}
    </div>`;
}

const SOON_MINUTES = 20;

/** Situación de una línea en este momento: buses en marcha y próxima salida de hoy. */
function lineStatus(number) {
  const c = clock();
  const onRoad = state.buses.filter((b) => b.line.number === number).length;
  const next = nextDepartureOf(number, c.kind, c.t);
  const soon = next !== null && next - c.t <= SOON_MINUTES;
  let text;
  if (onRoad === 1) text = '1 bus en marcha';
  else if (onRoad > 1) text = `${onRoad} buses en marcha`;
  else if (next !== null) text = `Próxima salida a las ${formatMinutes(next)}`;
  else text = 'Hoy ya no hay más salidas';
  return { active: onRoad > 0 || soon, text };
}

function lineRow(l) {
  const status = lineStatus(l.number);
  const works = hasWorks(l.number) ? ' · Cambios por obras' : '';
  return `<button type="button" class="row" data-act="line" data-number="${esc(l.number)}">
    <span class="badge" style="--c:${l.color}">${esc(l.number)}</span>
    <span class="to">${esc(routeOf(l))}<small>${esc(status.text)}${works}</small></span>
  </button>`;
}

function menuHTML() {
  const numbers = [...new Map(net.lines.map((l) => [l.number, l])).values()];
  const c = clock();
  const simText = c.live ? 'Mira cómo se mueven los buses en otro momento' : `Ahora ves las ${formatMinutes(Math.floor(c.t))}`;
  const active = numbers.filter((l) => lineStatus(l.number).active);
  const idle = numbers.filter((l) => !lineStatus(l.number).active);
  const list = active.length
    ? `<div class="rows">${active.map(lineRow).join('')}</div>`
    : '<p class="empty">Ahora mismo no hay ningún bus en la calle.</p>';
  const idleBlock = idle.length
    ? `<button type="button" class="cta second" data-act="toggle-idle" aria-expanded="${state.showIdle}">${state.showIdle ? 'Ocultar líneas sin buses' : `Ver ${idle.length === 1 ? 'la línea' : `las ${idle.length} líneas`} sin buses ahora`}</button>
       ${state.showIdle ? `<div class="rows">${idle.map(lineRow).join('')}</div>` : ''}`
    : '';
  return `<div class="head">${BACK}<div><h1>Líneas con buses ahora</h1><small>Toca una para ver dónde está su bus</small></div></div>
    ${list}${idleBlock}
    <div class="rows">
      <button type="button" class="row" data-act="notices"><span class="to">Avisos del servicio</span><span class="count">${NOTICES.length}</span></button>
      <button type="button" class="row" data-act="sim"><span class="to">Ver otra hora<small>${esc(simText)}</small></span></button>
    </div>${FOOT}`;
}

function simHTML() {
  return `<div class="head">${BACK}<div><h1>Ver otra hora</h1><small>Elige el momento que quieres ver</small></div></div>`;
}

function noticesHTML() {
  return `<div class="head">${BACK}<div><h1>Avisos</h1></div></div>
    ${NOTICES.map((n) => `<div class="notice-item"><strong>${esc(n.title)}</strong>${esc(n.body)}<small>${esc(n.date)}</small></div>`).join('')}
    ${FOOT}`;
}

let lastHTML = '';
function renderSheet() {
  const html = { home: homeHTML, stop: stopHTML, bus: busHTML, menu: menuHTML, line: lineHTML, search: searchHTML, notices: noticesHTML, sim: simHTML }[state.view]();
  if (html !== lastHTML) {
    $('#sheet-body').innerHTML = html;
    lastHTML = html;
  }
}

function renderClock() {
  const c = clock();
  const n = state.buses.filter((b) => !b.parkedUntil).length;
  const count = `${n} bus${n === 1 ? '' : 'es'}`;
  const el = $('#clock');
  el.classList.toggle('sim', !c.live);
  el.hidden = c.live;
  const label = { laborable: 'laborable', sabado: 'sábado', domingo: 'domingo' }[c.kind];
  el.innerHTML = c.live
    ? `<i></i>${count} · ${formatMinutes(Math.floor(c.t))}`
    : `<i></i>Simulación · ${label} ${formatMinutes(Math.floor(c.t))}`;
  if (!$('#simpanel').hidden) syncSimPanel();
}

function checkAlert() {
  if (!state.alerts.length) return;
  const c = clock();
  state.alerts = state.alerts.filter((alert) => {
    const a = arrivalsFor(alert.stopId).find((x) => x.key === alert.key);
    if (!a) return false;
    if (a.minutes - c.t > alert.before) return true;
    const text = `La línea ${alert.number} llega a ${nice(alert.name)} en unos ${alert.before} min`;
    toast(text);
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Xa Vén', { body: text, icon: 'icon-192.png' });
    } catch { /* el aviso en pantalla ya está dado */ }
    return false;
  });
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
  state.bellFor = null;
  document.body.dataset.view = view;
  $('#sheet').dataset.size = view === 'menu' || view === 'search' ? 'tall' : 'mid';
  $('#simpanel').hidden = view !== 'sim';
  if (view === 'sim') syncSimPanel();
  renderSheet();
  updateMarkers();
  updatePins();
  applyMapFocus();
  updateApproach();
  const body = $('#sheet-body');
  body.scrollTop = 0;
  if (!reduced && body.animate) {
    body.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'ease-out' });
  }
}

function selectStop(id, keepArrival = false) {
  if (!net.stopById.has(id)) return;
  state.stopFromLine = state.view === 'line';
  state.follow = false;
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
  state.busFromLine = state.view === 'line';
  state.follow = true;
  state.previous = state.view === 'bus' ? state.previous : state.view;
  go('bus');
  const bus = state.busByKey.get(key);
  if (bus) {
    requestAnimationFrame(() => followCamera(700));
  }
}

function selectLine(number) {
  state.lineNumber = number;
  state.lineDir = 0;
  state.showStops = false;
  state.stopId = null;
  state.follow = true;
  go('line');
  const onRoad = state.buses.some((b) => b.line.number === number);
  const points = net.lines.filter((l) => l.number === number).flatMap((l) => l.dirs.flatMap((d) => d.path));
  requestAnimationFrame(() => (onRoad ? followCamera(700) : moveTo(points, 15)));
  if (onRoad) setTimeout(() => followCamera(500), 800);
}

function goHome() {
  state.follow = false;
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
  if (state.view === 'bus' && state.busFromLine) { state.follow = true; go('line'); followCamera(700); return; }
  if (state.view === 'bus' && state.stopId) { state.follow = false; go('stop'); focusHero(); return; }
  if (state.view === 'stop' && state.stopFromLine) {
    state.stopId = null;
    state.follow = true;
    go('line');
    followCamera(700);
    return;
  }
  if (['line', 'notices', 'sim'].includes(state.view)) {
    go('menu');
    if (map) requestAnimationFrame(() => map.fitBounds(CITY_BOUNDS, { padding: mapPadding(), duration: reduced ? 0 : 700 }));
    return;
  }
  goHome();
}

async function locate() {
  if (!navigator.geolocation) { toast('Este navegador no da tu ubicación. Escribe el nombre de tu parada arriba.'); return; }
  navigator.geolocation.getCurrentPosition((pos) => {
    state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    document.body.dataset.located = 'yes';
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
  }, () => toast('No hemos podido saber dónde estás. Escribe el nombre de tu parada arriba.'), { timeout: 8000, maximumAge: 60000 });
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
    else if (act === 'notices') go('notices');
    else if (act === 'line-dir') {
      state.lineDir = Number(t.dataset.index);
      state.follow = false;
      renderSheet();
      const d = lineDirections()[state.lineDir];
      requestAnimationFrame(() => moveTo(d.dir.path, 15));
    }
    else if (act === 'sim') go('sim');
    else if (act === 'near') locate();
    else if (act === 'menu') go('menu');
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
    } else if (act === 'bell') {
      state.bellFor = state.bellFor === t.dataset.key ? null : t.dataset.key;
      renderSheet();
    } else if (act === 'bell-set') {
      const { key, stop: stopId } = t.dataset;
      const stop = net.stopById.get(stopId);
      const line = net.lineById.get(key.split('|')[0]);
      const before = Number(t.dataset.before);
      state.alerts = state.alerts.filter((x) => !(x.key === key && x.stopId === stopId));
      state.alerts.push({ key, stopId, name: stop.name, number: line.number, before });
      state.bellFor = null;
      renderSheet();
      toast(`Te avisaremos ${before} minutos antes de que llegue`);
      try {
        if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      } catch { /* sin permiso, queda el aviso en pantalla */ }
    } else if (act === 'bell-off') {
      state.alerts = state.alerts.filter((x) => !(x.key === t.dataset.key && x.stopId === t.dataset.stop));
      state.bellFor = null;
      renderSheet();
      toast('Aviso quitado');
    } else if (act === 'toggle-idle') {
      state.showIdle = !state.showIdle;
      renderSheet();
    } else if (act === 'toggle-stops') {
      state.showStops = !state.showStops;
      renderSheet();
    }
  });

  $('#q').addEventListener('input', (e) => {
    state.query = e.target.value;
    go(state.query ? 'search' : 'home');
  });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.target.value = ''; state.query = ''; goHome(); }
  });
  $('#menu').addEventListener('click', () => {
    if (state.view === 'menu') goHome();
    else go('menu');
  });
  $('#locate').addEventListener('click', locate);
  $('#credit').addEventListener('click', () => toast(MAP_CREDIT));
  $('#theme').addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeButton);
  paintThemeButton();
  $('#zoom-in').addEventListener('click', () => { state.follow = false; map?.zoomIn(); });
  $('#zoom-out').addEventListener('click', () => { state.follow = false; map?.zoomOut(); });
  $('#clock').addEventListener('click', () => { if (sim.on) go('sim'); });
  const slider = $('#sim-time');
  slider.addEventListener('pointerdown', () => { sliderHeld = true; });
  ['pointerup', 'pointercancel', 'blur'].forEach((type) => slider.addEventListener(type, () => { sliderHeld = false; }));
  slider.addEventListener('input', (e) => setSim({ base: Number(e.target.value) }));
  document.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => setSim({ kind: b.dataset.day })));
  document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => setSim({ speed: Number(b.dataset.speed) })));
  $('#sim-live').addEventListener('click', () => {
    sim.on = false;
    sim.speed = 1;
    syncSimPanel();
    tickData();
    renderSheet();
    renderClock();
  });

  // Panel inferior: se arrastra desde el asa o el título y se queda en tres alturas.
  // Durante el gesto solo cambia `transform`, que no obliga a recalcular la página.
  const sheet = $('#sheet');
  const SIZES = ['peek', 'mid', 'tall'];
  let drag = null;
  let settling = 0;
  let sheetVarTimer = 0;
  const syncSheetVar = () => {
    if (desktop.matches) {
      document.documentElement.style.removeProperty('--sheet-h');
      return;
    }
    if (drag?.moved || settling) return;
    const h = `${Math.round(sheet.getBoundingClientRect().height)}px`;
    if (document.documentElement.style.getPropertyValue('--sheet-h') !== h) document.documentElement.style.setProperty('--sheet-h', h);
  };
  const clearSheet = (size) => {
    clearTimeout(settling);
    settling = 0;
    sheet.classList.remove('dragging', 'settling');
    sheet.style.height = '';
    sheet.style.maxHeight = '';
    sheet.style.transform = '';
    if (size) sheet.dataset.size = size;
    syncSheetVar();
  };
  const measure = () => {
    const saved = sheet.dataset.size;
    const out = SIZES.map((size) => {
      sheet.dataset.size = size;
      return sheet.getBoundingClientRect().height;
    });
    sheet.dataset.size = saved;
    return out;
  };
  sheet.addEventListener('pointerdown', (e) => {
    if (desktop.matches || !e.target.closest('#grab, .head')) return;
    if (settling) clearSheet(sheet.dataset.size);
    drag = { id: e.pointerId, y: e.clientY, moved: false, lastY: e.clientY, lastT: e.timeStamp, v: 0, onGrab: Boolean(e.target.closest('#grab')) };
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dy) < 6) return;
      drag.moved = true;
      drag.startH = sheet.getBoundingClientRect().height;
      drag.heights = measure();
      drag.full = Math.round(window.innerHeight * 0.92);
      sheet.setPointerCapture(e.pointerId);
      sheet.classList.add('dragging');
      sheet.style.height = `${drag.full}px`;
      sheet.style.maxHeight = 'none';
    }
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.v = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    drag.visible = Math.max(84, Math.min(drag.full, drag.startH - dy));
    sheet.style.transform = `translate3d(0, ${drag.full - drag.visible}px, 0)`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, v, onGrab, heights, full, visible, startH } = drag;
    drag = null;
    if (!moved) {
      if (onGrab && e.type === 'pointerup') {
        sheet.dataset.size = SIZES[(SIZES.indexOf(sheet.dataset.size) + 1) % SIZES.length];
      }
      return;
    }
    const now = visible ?? startH;
    let index = heights.reduce((best, h, i) => (Math.abs(h - now) < Math.abs(heights[best] - now) ? i : best), 0);
    if (v < -0.45) {
      const up = heights.findIndex((h) => h > startH + 1);
      index = up === -1 ? SIZES.length - 1 : up;
    } else if (v > 0.45) {
      index = 0;
      heights.forEach((h, i) => { if (h < startH - 1) index = i; });
    }
    sheet.classList.remove('dragging');
    sheet.classList.add('settling');
    sheet.style.transform = `translate3d(0, ${full - heights[index]}px, 0)`;
    settling = setTimeout(() => clearSheet(SIZES[index]), reduced ? 0 : 230);
  };
  sheet.addEventListener('pointerup', endDrag);
  sheet.addEventListener('pointercancel', endDrag);
  new ResizeObserver(() => {
    clearTimeout(sheetVarTimer);
    sheetVarTimer = setTimeout(syncSheetVar, 60);
  }).observe(sheet);

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (net.stopById.has(id) && id !== state.stopId) selectStop(id);
  });
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
  wire();
  tickData();
  renderSheet();
  renderClock();
  syncSimPanel();
  setInterval(() => {
    if (!map) tickData();
    renderSheet();
    renderClock();
    updateApproach();
    checkAlert();
  }, 1000);
  setInterval(() => followCamera(), 4000);
  await initMap();
  updatePins();
  const initial = location.hash.slice(1);
  if (net.stopById.has(initial)) selectStop(initial);
}

start().catch((err) => {
  console.error(err);
  $('#sheet-body').innerHTML = '<p class="empty">No se han podido cargar los datos de la red. Recarga la página.</p>';
});
