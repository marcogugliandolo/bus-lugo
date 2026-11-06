// Xa Vén /demo: mapa, panel y reloj. El cálculo de posiciones está en sim.js.
import { planTrips, legPath, walkMinutes } from './plan.js';
import { prepare, busesAt, arrivalsAt, approachPath, dayKind, formatMinutes, passTime, distanceMetres, projectOnPath, scheduledTimeAt, stopIndexAt } from './sim.js';
import { t, getLang, setLang, translateDom } from './i18n.js';
import { startLive, liveFor, liveKeys, setOwn, usualFor, stopTimesFor, coachesFor, sendPosition } from './live.js';

const TILES_CHECK = 'https://tiles.openfreemap.org/planet';
const CITY_BOUNDS = [[-7.585, 42.992], [-7.53, 43.035]];
// Los textos van en castellano y t() los pasa al gallego cuando toca.
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
const routeOf = (line) => t(ROUTES[line.number]?.route ?? line.name);
const nice = (name) => String(name).replace(/^HULA \(Ent\. Personal\).*$/i, t('Hospital (entrada de personal)')).replace(/^HULA\b.*$/i, 'Hospital (HULA)');
const hasWorks = (number) => NOTICES.some((n) => n.lines.includes(number));

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Panel a la izquierda: en el ordenador y en el móvil puesto en horizontal (mismo criterio que style.css).
const desktop = matchMedia('(min-width: 1000px), (min-width: 600px) and (max-height: 540px) and (orientation: landscape)');

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
  me: null,
  arrivalKey: null,
  busKey: null,
  lineNumber: null,
  lineDir: 0,
  follow: false,
  busFromLine: false,
  wait: null,
  busFromTrip: false,
  plan: { from: null, to: null, field: 'to', text: '', places: [], sugg: [], result: null, resultFor: '', trip: null },
  stopFromLine: false,
  query: '',
  alerts: [],
  bellFor: null,
  showStops: false,
  showIdle: false,
  buses: [],
  busByKey: new Map(),
  previous: 'home',
  favs: [],                // paradas guardadas
  extras: new Map(),       // parada -> minutos de la parada e interurbanos
  ride: null,              // «Voy en este bus»
  ridePick: null,
  rideTarget: null,
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
  button.setAttribute('aria-label', dark ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro'));
  button.title = dark ? t('Modo claro') : t('Modo oscuro');
}
function setTheme(value) {
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem('xaven-tema', value); } catch { /* se aplica solo a esta visita */ }
  paintThemeButton();
  applyMapTheme();
}
const savedTheme = readTheme();
if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;

/* ---------- Mapa ---------- */
const isDark = () => {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Colores de cada capa en cada tema: cambiar de tema no vuelve a cargar el mapa. */
let themeTable = null;
const themeName = () => (isDark() ? 'dark' : 'light');

function paintStyle(style) {
  for (const layer of style.layers) {
    const paint = themeTable[themeName()][layer.id];
    if (!paint) continue;
    layer.paint ??= {};
    for (const [key, value] of Object.entries(paint)) {
      if (value === null) delete layer.paint[key];
      else layer.paint[key] = value;
    }
  }
  return style;
}

function applyMapTheme() {
  if (!mapReady) return;
  for (const [id, paint] of Object.entries(themeTable[themeName()])) {
    for (const [key, value] of Object.entries(paint)) map.setPaintProperty(id, key, value);
  }
  map.setPaintProperty('plan-walk', 'line-color', token('--mute'));
  map.setPaintProperty('route-dots', 'circle-color', token('--surface'));
  map.setPaintProperty('route-dots', 'circle-stroke-color', ['case', ['get', 'past'], token('--grab'), ['get', 'color']]);
  map.setPaintProperty('bus-stops', 'circle-color', token('--surface'));
  map.setPaintProperty('bus-stops', 'circle-stroke-color', token('--mute'));
  applyMapFocus();
}

async function buildStyle() {
  if (remoteTiles) {
    const { style, themes } = await fetch('data/map-style.json').then((r) => r.json());
    themeTable = themes;
    return paintStyle(style);
  }
  streets ??= await fetch('data/streets.json').then((r) => r.json());
  themeTable = {
    light: { bg: { 'background-color': '#E7E9E6' }, streets: { 'line-color': '#FFFFFF' } },
    dark: { bg: { 'background-color': '#14171B' }, streets: { 'line-color': '#2A3037' } },
  };
  return {
    version: 8,
    transition: { duration: 120, delay: 0 },
    sources: { streets: { type: 'geojson', data: streets, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': isDark() ? '#14171B' : '#E7E9E6' } },
      { id: 'streets', type: 'line', source: 'streets', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': isDark() ? '#2A3037' : '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 15, 1.4, 18, 5] } },
    ],
  };
}

/** Una flecha blanca que apunta hacia delante, para dibujarla a lo largo del recorrido. */
function arrowImage() {
  const size = 36;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(12, 9);
  g.lineTo(23, 18);
  g.lineTo(12, 27);
  g.strokeStyle = 'rgba(0, 0, 0, .35)';
  g.lineWidth = 8;
  g.stroke();
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = 4.5;
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

function addOverlays() {
  shownFocus = null;
  shownEnds = '';
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('routes', { type: 'geojson', data: routesData });
  map.addSource('bus-stops', { type: 'geojson', data: stopsData });
  map.addSource('focus', { type: 'geojson', data: empty });
  map.addSource('approach', { type: 'geojson', data: empty });
  map.addSource('route-dots', { type: 'geojson', data: empty });
  map.addSource('plan-bus', { type: 'geojson', data: empty });
  map.addSource('plan-walk', { type: 'geojson', data: empty });
  const round = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({ id: 'routes', type: 'line', source: 'routes', layout: round, paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.34, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 2.4, 18, 5] } });
  map.addLayer({ id: 'route-sel', type: 'line', source: 'routes', layout: round, filter: ['==', ['get', 'number'], ''], paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.4, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 15, 3.5, 18, 6] } });
  map.addLayer({ id: 'focus', type: 'line', source: 'focus', layout: round, paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.35, 'line-width': 5 } });
  map.addLayer({ id: 'approach', type: 'line', source: 'approach', layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 15, 6, 18, 9] } });
  // Flechas sobre lo que le queda al bus: se ve hacia dónde va sin leer nada.
  if (!map.hasImage('flecha')) map.addImage('flecha', arrowImage(), { pixelRatio: 2 });
  map.addLayer({ id: 'approach-arrows', type: 'symbol', source: 'approach', layout: { 'symbol-placement': 'line', 'symbol-spacing': 80, 'icon-image': 'flecha', 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.9, 15, 1.2, 18, 1.5], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotation-alignment': 'map' } });
  map.addLayer({ id: 'bus-stops', type: 'circle', source: 'bus-stops', minzoom: 14.6, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14.6, 2.6, 16, 4.5], 'circle-color': token('--surface'), 'circle-stroke-color': token('--mute'), 'circle-stroke-width': 1.2 } });
  map.addLayer({ id: 'plan-walk', type: 'line', source: 'plan-walk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': token('--mute'), 'line-width': 4, 'line-dasharray': [0.1, 2] } });
  map.addLayer({ id: 'plan-bus', type: 'line', source: 'plan-bus', layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': 6 } });
  map.addLayer({ id: 'route-dots', type: 'circle', source: 'route-dots', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5, 18, 7], 'circle-color': token('--surface'), 'circle-stroke-color': ['case', ['get', 'past'], token('--grab'), ['get', 'color']], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 2.5] } });
  shownDots = '';
  shownPlan = '';
  mapReady = true;
  applyMapTheme();
  updateApproach();
  updatePlanMap();
  updatePins();
  updateMarkers();
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
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyMapTheme);
    tickMarkers();
  } catch (err) {
    console.error(err);
    $('#nomap').hidden = false;
  }
}

function mapPadding() {
  const sheet = desktop.matches ? 0 : $('#sheet').getBoundingClientRect().height;
  const side = desktop.matches ? $('.side').getBoundingClientRect().width : 0;
  const top = desktop.matches ? 70 : 130;
  const lead = ['line', 'bus', 'ride'].includes(state.view) ? 40 : 0; // el bus resaltado es más grande
  const tag = ['stop', 'plan', 'trip'].includes(state.view) ? 70 : 0; // deja sitio al nombre de la parada
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
  const alone = ['line', 'bus', 'plan', 'trip', 'ride', 'ride-pick', 'ride-share'].includes(state.view);
  map.setPaintProperty('routes', 'line-opacity', alone || state.view === 'stop' ? 0 : (isDark() ? 0.42 : 0.34));
  let ids = null;
  if (state.view === 'line') ids = net.lines.filter((l) => l.number === state.lineNumber).flatMap((l) => l.dirs.flatMap((d) => d.stops));
  if (state.view === 'bus' || state.view === 'ride-pick' || state.view === 'ride-share') ids = (state.busByKey.get(state.busKey)?.dir ?? state.wait?.dir)?.stops ?? [];
  if (state.view === 'ride') ids = state.ride?.dir.stops ?? [];
  if (state.view === 'plan' || state.view === 'trip') ids = [];
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
  el.setAttribute('aria-label', t('Bus de la línea {n} hacia {dest}', { n: bus.line.number, dest: bus.dir.dest }));
  el.innerHTML = `${BUS_SVG}<span class="arrow"></span><span class="num">${esc(bus.line.number)}</span>`;
  el.addEventListener('click', (e) => { e.stopPropagation(); selectBus(bus.key); });
  wrap.append(el);
  const marker = new maplibregl.Marker({ element: wrap, subpixelPositioning: true }).setLngLat([bus.lng, bus.lat]).addTo(map);
  return { marker, el, x: 0, y: 0, tx: 0, ty: 0, shownX: 0, shownY: 0, lng: bus.lng, lat: bus.lat, r: null, look: '' };
}

function heroBusKey() {
  if (['bus', 'ride-pick', 'ride-share'].includes(state.view)) return state.busKey;
  if (state.view === 'ride') return state.ride?.key ?? null;
  return null;
}

const startOf = (a) => {
  const svc = a.dir.svc[clock().kind];
  return a.minutes - (svc.off[a.stopIndex] - svc.off[0]);
};

/**
 * Cuando el viaje elegido aún no ha salido, busca el bus de esa línea que hay
 * ahora en la calle: primero el que espera para hacer ese viaje y, si no, el que
 * termina su recorrido más cerca de la hora de salida.
 */
function companionOf(a) {
  const kind = clock().kind;
  const start = startOf(a);
  const same = state.buses.filter((b) => b.line.number === a.line.number);
  const waiting = same.find((b) => b.parkedUntil && Math.abs((b.parkedUntil - start) % 1440) < 0.01);
  if (waiting) return waiting;
  const score = (b) => {
    const end = passTime(b.dir.svc[kind], b.run, b.dir.stops.length - 1);
    const gap = start - end;
    return (b.line.id === a.line.id ? 0 : 5000) + (b.parkedUntil ? 10000 : 0) + (gap >= 0 ? gap : 2000 - gap);
  };
  return [...same].sort((x, y) => score(x) - score(y))[0] ?? null;
}

/** Mantiene en pantalla el bus o los buses elegidos hasta que la persona mueva el mapa. */
const BUS_ZOOM = 16.6;

function followCamera(duration = 900) {
  if (!state.follow || !map) return;
  if (state.view === 'line') {
    const mine = state.buses.filter((b) => b.line.number === state.lineNumber);
    const moving = mine.filter((b) => !b.parkedUntil);
    const list = moving.length ? moving : mine;
    // Cada bus y lo que le queda de recorrido: dónde está y hacia dónde va.
    const points = list.flatMap((b) => (b.parkedUntil ? [[b.lat, b.lng]] : approachPath(b, b.dir.stops.length - 1)));
    if (points.length) moveTo(points, 15.8, duration);
  } else if (state.view === 'ride' && state.ride) {
    const bus = state.busByKey.get(state.ride.key);
    const target = net.stopById.get(state.ride.dir.stops[state.ride.target]);
    const points = [[target.lat, target.lng]];
    if (bus) points.push([bus.lat, bus.lng]);
    if (state.me && state.ride.onRoute) points.push([state.me.lat, state.me.lng]);
    moveTo(points, BUS_ZOOM, duration);
  } else if (['bus', 'ride-pick', 'ride-share'].includes(state.view)) {
    const bus = state.busByKey.get(state.busKey);
    if (bus) {
      // El bus y sus próximas paradas: se ve dónde está y por dónde va a ir.
      const ahead = bus.parkedUntil ? [] : bus.dir.stops.slice(bus.nextStopIndex, bus.nextStopIndex + 3).map((id) => net.stopById.get(id)).filter(Boolean);
      moveTo([[bus.lat, bus.lng], ...ahead.map((x) => [x.lat, x.lng])], BUS_ZOOM, duration);
    }
    else if (state.wait) {
      const first = net.stopById.get(state.wait.dir.stops[0]);
      moveTo([[first.lat, first.lng]], BUS_ZOOM, duration);
    }
  }
}

function updateMarkers() {
  if (!map) return;
  const hero = heroBusKey();
  const coming = state.view === 'stop' ? new Set(arrivalsFor(state.stopId).map((a) => a.key)) : null;
  const onTrip = state.view === 'trip' && state.plan.trip
    ? new Set(state.plan.trip.legs.map((leg) => (state.busByKey.has(leg.key) ? leg.key : companionOf(legArrival(leg))?.key)))
    : null;
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
    const isHero = bus.key === hero || (inLine && !bus.parkedUntil) || Boolean(onTrip?.has(bus.key));
    const onlyHero = ['bus', 'ride', 'ride-pick', 'ride-share'].includes(state.view);
    const filtered = (state.view === 'line' && !inLine) || (onlyHero && bus.key !== hero) || (state.view === 'stop' && !coming.has(bus.key)) || state.view === 'plan' || (state.view === 'trip' && !onTrip?.has(bus.key));
    const dimmed = Boolean(hero) && !isHero;
    const parked = Boolean(bus.parkedUntil);
    const live = Boolean(bus.live);
    const look = `${isHero}|${filtered}|${dimmed}|${parked}|${live}`;
    if (m.look !== look) {
      m.look = look;
      m.el.classList.toggle('lead', isHero);
      m.el.classList.toggle('gone', filtered);
      m.el.classList.toggle('dim', dimmed);
      m.el.classList.toggle('parked', parked);
      m.el.classList.toggle('live', live);
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
  const scheduled = busesAt(net, c.kind, c.t);
  state.buses = c.live ? withLive(scheduled, c) : scheduled;
  state.busByKey = new Map(state.buses.map((b) => [b.key, b]));
  refreshWait();
  updateMarkers();
}

/** El viaje que se esperaba ya ha salido, o el bus que se enseñaba ha cambiado. */
function refreshWait() {
  if (!state.wait || state.view !== 'bus') return;
  const before = state.busKey;
  if (state.busByKey.has(state.wait.key)) {
    state.busKey = state.wait.key;
    state.wait = null;
  } else {
    state.busKey = companionOf(state.wait)?.key ?? null;
  }
  if (state.busKey !== before) {
    updatePins();
    applyMapFocus();
    updateApproach();
    followCamera(700);
  }
}

let stopPin = null;
let originPin = null;
let mePin = null;
function updatePins() {
  if (!map) return;
  const id = state.view === 'stop' || state.view === 'bus' ? state.stopId : (state.view === 'ride' && state.ride ? state.ride.dir.stops[state.ride.target] : null);
  stopPin?.remove();
  stopPin = null;
  if (id) {
    const stop = net.stopById.get(id);
    const el = document.createElement('div');
    el.className = 'pin sel';
    const tag = document.createElement('span');
    tag.textContent = nice(stop.name);
    el.append(tag);
    stopPin = new maplibregl.Marker({ element: el }).setLngLat([stop.lng, stop.lat]).addTo(map);
  }
  originPin?.remove();
  originPin = null;
  if (state.view === 'bus' && state.wait && !state.busByKey.has(state.busKey)) {
    const first = net.stopById.get(state.wait.dir.stops[0]);
    const el = document.createElement('div');
    el.className = 'pin sel';
    const tag = document.createElement('span');
    tag.textContent = t('Sale de {stop}', { stop: nice(first.name) });
    el.append(tag);
    originPin = new maplibregl.Marker({ element: el }).setLngLat([first.lng, first.lat]).addTo(map);
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
let shownDots = '';
let shownPlan = '';
let planPins = [];

function planPin(point, text, cls) {
  const el = document.createElement('div');
  el.className = cls;
  if (text) {
    const tag = document.createElement('span');
    tag.textContent = text;
    el.append(tag);
  }
  return new maplibregl.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map);
}

/** Marca en el mapa el origen, el destino y, si hay un viaje elegido, sus tramos. */
function updatePlanMap() {
  if (!mapReady) return;
  const { from, to, trip } = state.plan;
  const inPlan = state.view === 'plan' || state.view === 'trip';
  const key = inPlan ? `${state.view}|${from?.lat},${from?.lng}|${to?.lat},${to?.lng}|${state.view === 'trip' ? trip?.legs.map((l) => `${l.key}:${l.i}:${l.j}`).join() : ''}` : '';
  if (key === shownPlan) return;
  shownPlan = key;
  planPins.forEach((pin) => pin.remove());
  planPins = [];
  const empty = { type: 'FeatureCollection', features: [] };
  const showTrip = state.view === 'trip' && trip;
  const asPoint = (stop) => [stop.lat, stop.lng];
  map.getSource('plan-bus').setData(showTrip ? { type: 'FeatureCollection', features: trip.legs.map((leg) => asLine(legPath(leg), { color: leg.line.color })) } : empty);
  const walks = [];
  if (showTrip) {
    walks.push(asLine([[from.lat, from.lng], asPoint(trip.startStop)]));
    trip.legs.slice(0, -1).forEach((leg, i) => walks.push(asLine([asPoint(net.stopById.get(leg.dir.stops[leg.j])), asPoint(net.stopById.get(trip.legs[i + 1].dir.stops[trip.legs[i + 1].i]))])));
    walks.push(asLine([asPoint(trip.endStop), [to.lat, to.lng]]));
  }
  map.getSource('plan-walk').setData({ type: 'FeatureCollection', features: walks });
  if (!inPlan) return;
  const points = [];
  if (from) { planPins.push(planPin(from, '', 'pin')); points.push([from.lat, from.lng]); }
  if (to) { planPins.push(planPin(to, to.label, 'pin sel')); points.push([to.lat, to.lng]); }
  if (showTrip) trip.legs.forEach((leg) => points.push(...legPath(leg)));
  if (points.length) requestAnimationFrame(() => moveTo(points, 16));
}

/** Las paradas del recorrido como puntos: en gris las que el bus ya ha pasado. */
function updateDots() {
  if (state.view === 'trip' && state.plan.trip) {
    const key = `trip|${state.plan.trip.legs.map((l) => `${l.key}:${l.i}:${l.j}`).join()}`;
    if (key === shownDots) return;
    shownDots = key;
    const features = state.plan.trip.legs.flatMap((leg) => leg.dir.stops.slice(leg.i, leg.j + 1).map((id) => {
      const stop = net.stopById.get(id);
      return { type: 'Feature', properties: { past: false, color: leg.line.color }, geometry: { type: 'Point', coordinates: [stop.lng, stop.lat] } };
    }));
    map.getSource('route-dots')?.setData({ type: 'FeatureCollection', features });
    return;
  }
  const heroKey = heroBusKey();
  const bus = heroKey ? state.busByKey.get(heroKey) : null;
  const dir = bus?.dir ?? (state.view === 'bus' ? state.wait?.dir : null) ?? (state.view === 'ride' ? state.ride?.dir : null);
  const line = bus?.line ?? state.wait?.line ?? (state.ride ? keyParts(state.ride.key).line : null);
  const next = bus ? bus.nextStopIndex : 0;
  const key = dir && line ? `${state.view}|${heroKey ?? state.busKey}|${next}` : '';
  if (key === shownDots) return;
  shownDots = key;
  const features = (line ? dir?.stops ?? [] : []).map((id, i) => {
    const stop = net.stopById.get(id);
    return { type: 'Feature', properties: { past: i < next, color: line.color }, geometry: { type: 'Point', coordinates: [stop.lng, stop.lat] } };
  });
  map.getSource('route-dots')?.setData({ type: 'FeatureCollection', features });
}

/** Banderitas en el final del recorrido de los buses que se están mirando. */
let shownEnds = '';
let endPins = [];
function updateEnds(ends) {
  const unique = [...new Map(ends.filter((e) => e.id !== state.stopId).map((e) => [e.id, e])).values()];
  const sig = `${getLang()}|${unique.map((e) => e.id).join(',')}`;
  if (sig === shownEnds) return;
  shownEnds = sig;
  endPins.forEach((p) => p.remove());
  endPins = unique.map((e) => {
    const stop = net.stopById.get(e.id);
    const el = document.createElement('div');
    el.className = 'pin end';
    el.style.setProperty('--c', e.color);
    const tag = document.createElement('span');
    tag.textContent = t('Final: {stop}', { stop: nice(stop.name) });
    el.append(tag);
    return new maplibregl.Marker({ element: el }).setLngLat([stop.lng, stop.lat]).addTo(map);
  });
}

function updateApproach() {
  if (!mapReady) return;
  updateDots();
  const empty = { type: 'FeatureCollection', features: [] };
  const key = heroBusKey();
  const bus = key ? state.busByKey.get(key) : null;
  const focusSrc = map.getSource('focus');
  const approachSrc = map.getSource('approach');
  if (!focusSrc || !approachSrc) return;
  if (state.view === 'line') {
    // Con una línea elegida, cada bus lleva dibujado lo que le queda, con flechas, y su final.
    const mine = state.buses.filter((b) => b.line.number === state.lineNumber && !b.parkedUntil);
    if (shownFocus !== 'line') {
      shownFocus = 'line';
      focusSrc.setData(empty);
    }
    const ahead = mine.map((b) => ({ b, path: approachPath(b, b.dir.stops.length - 1) })).filter((x) => x.path.length > 1);
    approachSrc.setData({ type: 'FeatureCollection', features: ahead.map((x) => asLine(x.path, { color: x.b.line.color })) });
    updateEnds(ahead.map((x) => ({ id: x.b.dir.stops[x.b.dir.stops.length - 1], color: x.b.line.color })));
    return;
  }
  updateEnds(bus && !bus.parkedUntil && ['bus', 'ride-pick', 'ride-share'].includes(state.view) ? [{ id: bus.dir.stops[bus.dir.stops.length - 1], color: bus.line.color }] : []);
  if (!bus) {
    const dir = state.view === 'bus' ? state.wait?.dir : null;
    if (shownFocus !== (dir ?? null)) {
      shownFocus = dir ?? null;
      focusSrc.setData(dir ? asLine(dir.path, { color: state.wait.line.color }) : empty);
      approachSrc.setData(empty);
    }
    return;
  }
  if (shownFocus !== bus.dir) {
    shownFocus = bus.dir;
    focusSrc.setData(asLine(bus.dir.path, { color: bus.line.color }));
  }
  const path = approachPath(bus, state.view === 'ride' && state.ride ? state.ride.target : bus.dir.stops.length - 1);
  approachSrc.setData(path.length > 1 ? asLine(path, { color: bus.line.color }) : empty);
}

/* ---------- Directo: lo que han visto los viajeros, encima del horario ---------- */
const keyParts = (key) => {
  const [lineId, dirIndex, run] = key.split('|');
  const line = net.lineById.get(lineId);
  const dir = line?.dirs[Number(dirIndex)];
  return { line, dir, dirIndex: Number(dirIndex), run: Number(run) };
};

/** Identificador estable de una salida (no cambia aunque se regeneren los datos): línea, sentido, día y hora. */
function tripIdOf(key, kind) {
  const { line, dir, dirIndex, run } = keyParts(key);
  const svc = dir?.svc[kind];
  if (!svc || svc.dep[run] === undefined) return null;
  return `${line.id}|${dirIndex}|${kind}|${Math.round(svc.dep[run])}`;
}

const liveOf = (key) => (clock().live ? liveFor(key) : null);

/** Corre en el mapa los buses que alguien ha visto, según el retraso que llevan. */
function withLive(buses, c) {
  const keys = liveKeys();
  if (!keys.size) return buses;
  const seen = new Map();
  for (const key of keys) {
    const info = liveFor(key);
    if (info) seen.set(key, info);
  }
  if (!seen.size) return buses;
  const out = buses.filter((b) => !seen.has(b.key));
  for (const [key, info] of seen) {
    const { line } = keyParts(key);
    if (!line) continue;
    const shifted = busesAt(net, c.kind, c.t - info.delay, { lines: [line] }).find((b) => b.key === key);
    const base = shifted ?? buses.find((b) => b.key === key);
    if (base) out.push({ ...base, live: info });
  }
  return out;
}

/** Hora a la que pasa una carrera por una parada, con el retraso si alguien lo ha visto. */
function minutesFor(key, stopIndex) {
  const c = clock();
  const { dir, run } = keyParts(key);
  const svc = dir?.svc[c.kind];
  if (!svc || svc.dep[run] === undefined || stopIndex < 0 || stopIndex >= svc.off.length) return null;
  return passTime(svc, run, stopIndex) + (liveOf(key)?.delay ?? 0);
}

const delayText = (d) => {
  const m = Math.round(d);
  if (m >= 1) return t(m === 1 ? 'va 1 min tarde' : 'va {n} min tarde', { n: m });
  if (m <= -1) return t(m === -1 ? 'va 1 min adelantado' : 'va {n} min adelantado', { n: -m });
  return t('va a su hora');
};
const ageText = (s) => (s < 60 ? t('hace {n} s', { n: Math.max(5, Math.round(s / 5) * 5) }) : t('hace {n} min', { n: Math.round(s / 60) }));

/** La etiqueta que dice de dónde sale cada hora: del horario o de alguien que va en el bus. */
function sourceTag(live) {
  if (!live) return `<span class="src">${t('Según horario')}</span>`;
  return `<span class="src live"><i></i>${live.mine ? t('Tu GPS') : t('En directo')} · ${esc(ageText(live.age))}</span>`;
}

function usualText(a) {
  if (!a.usual || Math.abs(a.usual.delay) < 2) return '';
  const m = Math.round(a.usual.delay);
  return m > 0 ? t('Suele ir {n} min tarde', { n: m }) : t('Suele ir {n} min adelantado', { n: -m });
}

/* ---------- Panel ---------- */
const minutesHTML = (eta, live = false) => (eta === 0 ? t('Ahora') : `${live ? '<i class="live-dot"></i>' : ''}${eta}<small> min</small>`);
const BACK_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>';
const back = () => `<button type="button" class="back" data-act="back" aria-label="${t('Volver')}" title="${t('Volver')}">${BACK_ICON}</button>`;
const foot = () => `<p class="foot">${t('Horas y posiciones según el horario, salvo las marcadas «en directo». Web no oficial.')}</p>`;
const mapCredit = () => t('Mapa: OpenFreeMap © OpenMapTiles. Datos y búsqueda de sitios: © OpenStreetMap, Photon.');

const BELL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"></path><path d="M10 20a2 2 0 0 0 4 0"></path></svg>';
const STAR = '<svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"></path></svg>';
const ALERT_OPTIONS = { on: [2, 5, 10], off: [1, 2, 3] };
const kindOf = (a) => a.kind ?? 'on';
const bellId = (a) => `${kindOf(a)}|${a.key}`;
const armedFor = (a) => state.alerts.find((x) => x.key === a.key && x.stopId === a.stopId && kindOf(x) === kindOf(a));

function bellButton(a) {
  const armed = armedFor(a);
  const left = a.minutes - clock().t;
  const kind = kindOf(a);
  if (!armed && left <= ALERT_OPTIONS[kind][0]) return '';
  const label = armed
    ? t('Aviso {n} minutos antes. Cambiar', { n: armed.before })
    : (kind === 'off' ? t('Avísame antes de bajar') : t('Avísame antes de que llegue'));
  const text = armed ? `<span>${armed.before} min</span>` : (kind === 'off' ? `<span>${t('Bajar')}</span>` : '');
  return `<button type="button" class="bell${armed ? ' on' : ''}" data-act="bell" data-id="${esc(bellId(a))}" aria-label="${esc(label)}" aria-expanded="${state.bellFor === bellId(a)}">${BELL}${text}</button>`;
}

const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function alertHelp() {
  if (!clock().live) return t('En la simulación, el aviso solo sale en esta pantalla.');
  if (canPush()) return t('Te llegará como notificación al móvil, aunque cierres la web. El navegador te pedirá permiso.');
  if (isIOS()) return t('En iPhone, añade Xa Vén a la pantalla de inicio (Compartir › Añadir a inicio) y ábrela desde allí para recibir avisos. Si no, deja esta pantalla abierta.');
  return t('Este navegador no admite notificaciones: deja esta pantalla abierta para recibir el aviso.');
}

function saveAlerts() {
  try { localStorage.setItem('xaven-avisos', JSON.stringify(state.alerts)); } catch { /* solo dura esta visita */ }
}

function loadAlerts() {
  try {
    const saved = JSON.parse(localStorage.getItem('xaven-avisos') ?? '[]');
    state.alerts = Array.isArray(saved) ? saved.filter((a) => a.at > Date.now() - 30 * 60000) : [];
  } catch { state.alerts = []; }
}

const urlKey = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

/** Pide permiso y prepara el móvil para recibir avisos. Devuelve la suscripción o el motivo de que no haya. */
async function phoneSubscription() {
  if (!clock().live || !canPush()) return { reason: 'none' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { reason: 'denied' };
  await navigator.serviceWorker.register('sw.js');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const { key } = await fetch('/api/avisos/clave').then((r) => { if (!r.ok) throw new Error('sin servicio'); return r.json(); });
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(key) });
  }
  return { subscription: subscription.toJSON() };
}

function alertTexts(alert) {
  const { line, dir } = keyParts(alert.key);
  const minutes = minutesFor(alert.key, alert.stopIndex) ?? 0;
  const vars = { n: line?.number ?? alert.number, m: alert.before, stop: nice(alert.name), dest: nice(dir?.dest ?? ''), time: formatMinutes(minutes) };
  return kindOf(alert) === 'off'
    ? { title: t('Prepárate para bajar en {stop}', vars), body: t('La línea {n} llega en unos {m} min, a las {time}.', vars) }
    : { title: t('Línea {n}: llega en {m} min', vars), body: t('Hacia {dest}. Parada {stop}, a las {time}.', vars) };
}

/** Programa el aviso en el servidor para que llegue aunque la web esté cerrada. */
async function schedulePush(alert) {
  try {
    const { subscription, reason } = await phoneSubscription();
    if (!subscription) return reason;
    const { title, body } = alertTexts(alert);
    const res = await fetch('/api/avisos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: alert.id, at: alert.at, subscription, title: title.slice(0, 80), body: body.slice(0, 200), url: `/demo/#${alert.stopId}` }),
    });
    if (!res.ok) throw new Error(`servicio ${res.status}`);
    alert.pushed = true;
    saveAlerts();
    return 'ok';
  } catch (err) {
    console.warn('Aviso:', err?.message);
    return 'error';
  }
}

function cancelPush(alert) {
  if (alert?.pushed) fetch(`/api/avisos/${alert.id}`, { method: 'DELETE' }).catch(() => {});
}

/** Crea o cambia un aviso. Devuelve el resultado de programarlo en el móvil. */
async function setAlert({ key, stopId, stopIndex, kind = 'on', before }) {
  const minutes = minutesFor(key, stopIndex);
  if (minutes === null) return 'none';
  const stop = net.stopById.get(stopId);
  const { line } = keyParts(key);
  const old = state.alerts.find((x) => x.key === key && x.stopId === stopId && kindOf(x) === kind);
  cancelPush(old);
  const alert = { id: crypto.randomUUID(), key, stopId, stopIndex, kind, name: stop.name, number: line.number, before, at: Date.now() + (minutes - before - clock().t) * 60000, delayAt: liveOf(key)?.delay ?? 0, pushed: false };
  state.alerts = state.alerts.filter((x) => x !== old);
  state.alerts.push(alert);
  saveAlerts();
  return schedulePush(alert);
}

function removeAlert(alert) {
  if (!alert) return;
  cancelPush(alert);
  state.alerts = state.alerts.filter((x) => x !== alert);
  saveAlerts();
}

function bellChooser(a) {
  if (state.bellFor !== bellId(a)) return '';
  const armed = armedFor(a);
  const left = a.minutes - clock().t;
  const kind = kindOf(a);
  const options = ALERT_OPTIONS[kind].filter((n) => left > n);
  const data = `data-key="${esc(a.key)}" data-stop="${esc(a.stopId)}" data-index="${a.stopIndex}" data-kind="${kind}"`;
  return `<div class="bell-opts"><p>${kind === 'off' ? t('¿Cuánto antes de llegar a tu parada te avisamos?') : t('¿Cuánto antes te avisamos?')}</p><div class="bell-row">
    ${options.map((n) => `<button type="button" data-act="bell-set" ${data} data-before="${n}" aria-pressed="${armed?.before === n}">${n} min</button>`).join('')}
    ${armed ? `<button type="button" class="off" data-act="bell-off" ${data}>${t('Quitar')}</button>` : ''}
  </div><small>${alertHelp()}</small></div>`;
}

function arrivalRow(a) {
  const usual = usualText(a);
  const live = a.live ? `<span class="live-note">${t('En directo')}: ${esc(delayText(a.live.delay))}</span>` : '';
  const later = a.later ? `, ${t('luego')} ${a.later}` : '';
  return `<div class="row arr">
    <button type="button" class="row-main" data-act="arrival" data-key="${esc(a.key)}" data-stop="${esc(a.stopId)}">
      <span class="badge" style="--c:${a.line.color}">${esc(a.line.number)}</span>
      <span class="to">${esc(nice(a.dir.dest))}<small>${a.time}${later}${live ? `<br>${live}` : ''}${usual ? `<br>${esc(usual)}` : ''}</small></span>
      <span class="eta${a.live ? ' is-live' : ''}">${minutesHTML(a.eta, Boolean(a.live))}</span>
    </button>${bellButton(a)}
  </div>${bellChooser(a)}`;
}

/** Dónde está el bus ahora, dicho con las paradas que tiene más cerca. */
function whereNow(bus) {
  const stops = bus.dir.stops;
  const next = net.stopById.get(stops[bus.nextStopIndex]);
  const nextName = nice(next?.name ?? '');
  if (bus.parkedUntil) return { label: t('Parado en'), place: nextName, phase: 'parked' };
  if (bus.stopped) return { label: t('En la parada'), place: nextName, phase: 'at' };
  const prev = net.stopById.get(stops[Math.max(0, bus.nextStopIndex - 1)]);
  const toPrev = distanceMetres(bus.lat, bus.lng, prev.lat, prev.lng);
  const toNext = distanceMetres(bus.lat, bus.lng, next.lat, next.lng);
  const part = toPrev / Math.max(1, toPrev + toNext);
  if (part < 0.35) return { label: t('Acaba de salir de'), place: nice(prev.name), phase: 'left' };
  if (part > 0.65) return { label: t('Llegando a'), place: nextName, phase: 'arriving' };
  return { label: t('Va entre'), place: t('{a} y {b}', { a: nice(prev.name), b: nextName }), phase: 'between' };
}

const timeAt = (bus, i) => passTime(bus.dir.svc[clock().kind], bus.run, i) + (bus.live?.delay ?? 0);

/** Paradas alrededor del bus, con el bus dibujado en el sitio donde está ahora. */
function stripHTML(bus, { target = null, full = false, until = false } = {}) {
  const stops = bus.dir.stops;
  const last = stops.length - 1;
  const next = bus.nextStopIndex;
  let shown;
  if (full) shown = stops.map((_, i) => i).slice(next, until && target !== null ? target + 1 : undefined);
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
    const note = here ? `<small>${bus.live ? t('El bus está aquí') : t('Debería estar aquí')}</small>` : (isTarget ? `<small>${t('Tu parada')}</small>` : '');
    return `<li class="${cls}"><time>${formatMinutes(timeAt(bus, i))}</time><span class="rail"></span><span>${esc(name)}${note}</span></li>`;
  };
  let html = '';
  if (full) {
    const before = bus.stopped ? next : next - 1;
    if (before > 0) html += `<li class="gap before"><time></time><span class="rail"></span><span>${before === 1 ? t('1 parada anterior') : t('{n} paradas anteriores', { n: before })}</span></li>`;
  }
  if (next > 0 && !bus.stopped) html += row(next - 1, 'past');
  if (!bus.stopped) html += `<li class="bus-now"><time>${t('Ahora')}</time><span class="rail"></span><span>${bus.live ? t('El bus va por aquí') : t('Debería ir por aquí')}</span></li>`;
  for (const i of shown) {
    if (i === null) {
      const n = hiddenCount();
      if (n > 0) html += `<li class="gap"><time></time><span class="rail"></span><span>${n === 1 ? t('1 parada más') : t('{n} paradas más', { n })}</span></li>`;
    } else html += row(i);
  }
  return `<ol class="tl strip" style="--c:${bus.line.color}">${html}</ol>`;
}

function nowCard(label, place, detail, key, stopId, live = undefined) {
  const tag = live === undefined ? '' : sourceTag(live);
  const inner = `<span class="now-text"><span class="now-label">${esc(label)}${tag}</span><strong>${esc(place)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span>`;
  return key
    ? `<button type="button" class="now" data-act="${stopId ? 'arrival' : 'follow'}" data-key="${esc(key)}"${stopId ? ` data-stop="${esc(stopId)}"` : ''} aria-label="${esc(`${label} ${place}. ${t('Ver recorrido')}`)}">${inner}<span class="now-go" aria-hidden="true">›</span></button>`
    : `<div class="now">${inner}</div>`;
}

/** Dónde está el bus de la línea cuando el viaje elegido aún no ha salido. */
function waitCard(a, link = false) {
  const bus = companionOf(a);
  const start = formatMinutes(startOf(a));
  const key = link ? a.key : undefined;
  const stopId = link ? a.stopId : undefined;
  if (!bus) {
    return { bus: null, card: nowCard(t('Todavía no ha salido'), nice(a.dir.origin), t('Sale a las {time}', { time: start }), key, stopId), note: t('Ahora no hay ningún bus de esta línea en la calle.') };
  }
  const where = whereNow(bus);
  if (bus.parkedUntil && Math.abs((bus.parkedUntil - startOf(a)) % 1440) < 0.01) {
    return { bus, card: nowCard(where.label, where.place, t('Sale a las {time}', { time: start }), key, stopId, bus.live ?? null), note: '' };
  }
  return { bus, card: nowCard(where.label, where.place, t('Bus de la línea {n} que hay ahora en la calle', { n: a.line.number }), key, stopId, bus.live ?? null), note: t('Tu viaje sale a las {time} de {place}.', { time: start, place: nice(a.dir.origin) }) };
}

/** Próximos pasos por la parada, con el retraso de las carreras que alguien ha visto. */
function arrivalsFor(stopId) {
  const c = clock();
  const list = arrivalsAt(net, stopId, c.kind, c.t, { grace: c.live ? 30 : 0, limit: 5 });
  const out = [];
  for (const a of list) {
    const live = c.live ? liveFor(a.key) : null;
    const minutes = a.minutes + (live?.delay ?? 0);
    if (minutes < c.t - (live ? 0.5 : 0)) continue;
    const tripId = live ? null : tripIdOf(a.key, c.kind);
    out.push({ ...a, minutes, eta: Math.max(0, Math.round(minutes - c.t)), time: formatMinutes(minutes), live, usual: tripId ? usualFor(tripId) : null, stopId });
  }
  out.sort((x, y) => x.minutes - y.minutes);
  const perDir = new Map();
  return out.filter((a) => {
    const id = `${a.line.id}|${a.dirIndex}`;
    perDir.set(id, (perDir.get(id) ?? 0) + 1);
    return perDir.get(id) <= 3;
  });
}

/* ---------- Mis paradas ---------- */
const FAV_MAX = 6;
function loadFavs() {
  try {
    const saved = JSON.parse(localStorage.getItem('xaven-paradas') ?? '[]');
    state.favs = Array.isArray(saved) ? saved.filter((id) => net.stopById.has(id)).slice(0, FAV_MAX) : [];
  } catch { state.favs = []; }
}
function saveFavs() {
  try { localStorage.setItem('xaven-paradas', JSON.stringify(state.favs)); } catch { /* solo esta visita */ }
}
const isFav = (id) => state.favs.includes(id);

function favCard(id) {
  const stop = net.stopById.get(id);
  const rows = nextPerLine(arrivalsFor(id)).slice(0, 3);
  const list = rows.length
    ? rows.map((a) => `<button type="button" class="row mini" data-act="arrival" data-key="${esc(a.key)}" data-stop="${esc(id)}"><span class="badge" style="--c:${a.line.color}">${esc(a.line.number)}</span><span class="to">${esc(nice(a.dir.dest))}</span><span class="eta${a.live ? ' is-live' : ''}">${minutesHTML(a.eta, Boolean(a.live))}</span></button>`).join('')
    : `<p class="empty">${t('No pasa ningún bus en las próximas dos horas.')}</p>`;
  return `<div class="fav-card"><button type="button" class="fav-name" data-act="stop" data-id="${esc(id)}"><span>${esc(nice(stop.name))}</span><span class="now-go" aria-hidden="true">›</span></button>${list}</div>`;
}

/* ---------- Pantallas ---------- */
function rideBanner() {
  const ride = state.ride;
  if (!ride) return '';
  const { line } = keyParts(ride.key);
  const stop = net.stopById.get(ride.dir.stops[ride.target]);
  return `<button type="button" class="now ride-banner" data-act="ride-open"><span class="badge" style="--c:${line.color}">${esc(line.number)}</span><span class="now-text"><span class="now-label">${t('Vas en este bus')}</span><strong>${esc(t('Te bajas en {stop}', { stop: nice(stop.name) }))}</strong></span><span class="now-go" aria-hidden="true">›</span></button>`;
}

function langSwitch() {
  const lang = getLang();
  return `<div class="lang" role="group" aria-label="${t('Idioma')}"><button type="button" data-act="lang" data-lang="es" aria-pressed="${lang === 'es'}">Castellano</button><button type="button" data-act="lang" data-lang="gl" aria-pressed="${lang === 'gl'}">Galego</button></div>`;
}

function homeHTML() {
  const c = clock();
  const wake = !state.buses.length && c.live
    ? `<p class="empty">${t('Ahora mismo no hay buses en la calle.')}</p><button type="button" class="cta second" data-act="sim10">${t('Ver cómo se mueven a las 10:00')}</button>`
    : '';
  const favs = state.favs.length ? `<div class="rows favs"><h2>${t('Tus paradas')}</h2>${state.favs.map(favCard).join('')}</div>` : '';
  return `<p class="eyebrow"><img src="icon.svg" width="24" height="24" alt=""><span>Xa Vén</span> ${t('Los buses de Lugo')}</p><div class="head"><div><h1>${t('¿A dónde quieres ir?')}</h1><small>${t('Toca un bus o una parada para saber cuándo llega')}</small></div></div>
    ${rideBanner()}${favs}
    <div class="buttons one">
      <button type="button" class="cta" data-act="plan">${t('Cómo llegar a un sitio')}</button>
      <button type="button" class="cta second" data-act="near">${t('Ver la parada más cercana')}</button>
      <button type="button" class="cta second" data-act="menu">${t('Ver todas las líneas')}</button>
    </div>${wake}
    <ul class="tips">
      <li><span class="tip-icon" aria-hidden="true">${BELL}</span>${t('Con la campana te avisamos antes de que llegue tu bus, aunque tengas el móvil bloqueado.')}</li>
      ${state.favs.length ? '' : `<li><span class="tip-icon" aria-hidden="true">${STAR}</span>${t('Guarda tus paradas con la estrella y las verás aquí al abrir.')}</li>`}
    </ul>
    <p class="legend"><span><i class="lg-sched"></i>${t('Según horario')}</span><span><i class="lg-live"></i>${t('En directo, visto desde el bus')}</span></p>
    ${langSwitch()}`;
}

const nowCardWithNote = ({ card, note }) => `${card}${note ? `<p class="wait-note">${esc(note)}</p>` : ''}`;

/** Una fila por línea y sentido, con su próximo paso y el siguiente. */
function nextPerLine(list) {
  const rows = new Map();
  for (const a of list) {
    const key = `${a.line.id}|${a.dirIndex}`;
    if (rows.has(key)) rows.get(key).later ??= a.time;
    else rows.set(key, { ...a, later: null });
  }
  return [...rows.values()];
}

function nearestDistanceText(stop) {
  const metres = distanceMetres(state.me.lat, state.me.lng, stop.lat, stop.lng);
  return metres <= FAR_FROM_LUGO ? t('Estás a {d} de esta parada', { d: metresText(metres) }) : '';
}

/** Lo que llega aparte: minutos de la parada y autobuses interurbanos, si el servidor los tiene. */
function stopExtrasHTML(stop) {
  const extra = state.extras.get(stop.id);
  if (!extra) return '';
  let html = '';
  const deps = extra.times?.departures ?? [];
  if (deps.length) {
    const lineByNumber = new Map(net.lines.map((l) => [l.number, l]));
    html += `<div class="rows"><h2>${t('Lo que marca la parada ahora')}</h2>${deps.slice(0, 6).map((d) => {
      const line = lineByNumber.get(d.line);
      const badge = line ? `<span class="badge" style="--c:${line.color}">${esc(d.line)}</span>` : `<span class="badge plain">${esc(d.line)}</span>`;
      return `<div class="row"><span>${badge}</span><span class="to">${esc(titleCase(d.towards))}</span><span class="eta is-live">${minutesHTML(d.minutes, true)}</span></div>`;
    }).join('')}</div><p class="bell-hint">${t('Minutos del sistema de información de las paradas. Pueden cambiar sin aviso.')}</p>`;
  }
  const coaches = (extra.coaches?.departures ?? []).filter((x) => x.minutes >= clock().t - 1).slice(0, 4);
  if (coaches.length) {
    html += `<div class="rows"><h2>${t('Autobuses de la Xunta a pocos pasos')}</h2>${coaches.map((x) => `<div class="row"><span class="badge plain">${esc(x.route)}</span><span class="to">${esc(x.headsign)}<small>${esc(x.metres > 30 ? t('Sale de {stop}, a {d}', { stop: x.stop, d: metresText(x.metres) }) : t('Sale de esta parada'))}</small></span><span class="eta">${formatMinutes(x.minutes)}</span></div>`).join('')}</div><p class="bell-hint">${t('Horario publicado de las líneas de la Xunta.')}</p>`;
  }
  return html;
}

const titleCase = (s) => String(s).toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

function stopHTML() {
  const stop = net.stopById.get(state.stopId);
  const rows = nextPerLine(arrivalsFor(stop.id));
  const away = state.me ? nearestDistanceText(stop) : '';
  const sub = away || (stop.code ? t('Código de parada: {code}', { code: esc(stop.code) }) : t('Parada'));
  const fav = isFav(stop.id);
  const star = `<button type="button" class="fav${fav ? ' on' : ''}" data-act="fav" data-id="${esc(stop.id)}" aria-pressed="${fav}" aria-label="${fav ? t('Quitar de tus paradas') : t('Guardar en tus paradas')}">${STAR}<span>${fav ? t('Guardada') : t('Guardar')}</span></button>`;
  const head = `<div class="head">${back()}<div><h1>${esc(nice(stop.name))}</h1><small>${sub}</small></div>${star}</div>`;
  const screen = `<a class="link" href="pantalla.html#${esc(stop.id)}">${t('Ver en pantalla grande (para una tele o una tablet)')}</a>`;
  if (!rows.length) return `${head}<p class="empty">${t('No pasa ningún bus por aquí en las próximas dos horas.')}</p>${stopExtrasHTML(stop)}${screen}${foot()}`;
  const anyLive = rows.some((a) => a.live);
  return `${head}
    <div class="rows"><h2 class="with-src"><span>${t('Toca una línea para ver dónde está su bus')}</span>${sourceTag(anyLive ? rows.find((a) => a.live).live : null)}</h2>${rows.map((a) => arrivalRow(a)).join('')}</div>
    <p class="bell-hint">${t('La campana te avisa antes de que llegue.')}</p>
    ${stopExtrasHTML(stop)}
    <button type="button" class="cta second" data-act="plan-here" data-id="${esc(stop.id)}">${t('Cómo llegar a esta parada')}</button>${screen}${foot()}`;
}

function waitHTML() {
  const a = state.wait;
  const stop = net.stopById.get(a.stopId);
  const eta = Math.max(0, Math.round(a.minutes - clock().t));
  const wait = waitCard(a);
  const usual = usualText(a);
  return `<div class="head">${back()}<span class="badge" style="--c:${a.line.color}">${esc(a.line.number)}</span><div><small>${t('Hacia {dest}', { dest: esc(nice(a.dir.dest)) })}</small></div></div>
    <p class="card-title">${t('Dónde está ahora')}</p>
    ${nowCardWithNote(wait)}
    <div class="hero-time"><span class="bignum">${eta === 0 ? t('Ya llega') : `${eta} min`}</span><span>${esc(t('llega a {stop} a las {time}', { stop: nice(stop.name), time: a.time }))}</span>${usual ? `<span class="usual">${esc(usual)}</span>` : ''}</div>
    ${wait.bus && !wait.bus.parkedUntil ? `<div class="rows"><h2>${t('Su recorrido')}</h2></div>${stripHTML(wait.bus, { full: true })}` : ''}${foot()}`;
}

function busHTML() {
  if (state.wait) return waitHTML();
  const bus = state.busByKey.get(state.busKey);
  if (!bus) {
    return `<div class="head">${back()}<div><h1>${t('Este bus ha terminado su recorrido')}</h1></div></div>${foot()}`;
  }
  const c = clock();
  if (bus.parkedUntil) {
    const end = net.stopById.get(bus.dir.stops[bus.dir.stops.length - 1]);
    return `<div class="head">${back()}<span class="badge" style="--c:${bus.line.color}">${esc(bus.line.number)}</span><div><small>${t('Parado en {stop}', { stop: esc(nice(end.name)) })}</small></div></div>
      <p class="big-line">${t('Vuelve a salir a las {time}', { time: formatMinutes(bus.parkedUntil) })}</p>${foot()}`;
  }
  const mine = state.stopId ? bus.dir.stops.indexOf(state.stopId) : -1;
  const toMine = mine >= bus.nextStopIndex;
  const end = bus.dir.stops.length - 1;
  const targetTime = timeAt(bus, toMine ? mine : end);
  const eta = Math.max(0, Math.round(targetTime - c.t));
  const arrives = toMine
    ? (eta === 0 ? t('Ya llega a tu parada') : t('Llega a tu parada en {n} min', { n: eta }))
    : (eta === 0 ? t('Llegando al final del recorrido') : t('Llega al final en {n} min', { n: eta }));
  const where = whereNow(bus);
  const liveLine = bus.live ? `<p class="wait-note">${esc(t('Lo ha visto alguien que va dentro: {d}.', { d: delayText(bus.live.delay) }))}</p>` : '';
  const ride = c.live && bus.nextStopIndex < end
    ? `<button type="button" class="cta" data-act="ride-start" data-key="${esc(bus.key)}">${t('Voy en este bus')}</button><p class="bell-hint">${t('Te avisamos antes de tu parada y, si quieres, ayudas a quien espera a ver dónde va.')}</p>`
    : '';
  return `<div class="head">${back()}<span class="badge" style="--c:${bus.line.color}">${esc(bus.line.number)}</span><div><small>${t('Hacia {dest}', { dest: esc(nice(bus.dir.dest)) })}</small></div></div>
    ${nowCard(where.label, where.place, arrives, undefined, undefined, bus.live ?? null)}${liveLine}
    ${ride}
    <div class="rows"><h2>${t('Su recorrido')}</h2></div>
    ${stripHTML(bus, { full: true, target: toMine ? mine : null })}${foot()}`;
}

/* ---------- Voy en este bus ---------- */
function ridePickHTML() {
  const bus = state.busByKey.get(state.ridePick);
  if (!bus) return `<div class="head">${back()}<div><h1>${t('Este bus ha terminado su recorrido')}</h1></div></div>`;
  const first = Math.max(bus.nextStopIndex, 1);
  const stops = bus.dir.stops.slice(first).map((id, k) => {
    const i = first + k;
    return `<button type="button" class="row" data-act="ride-stop" data-index="${i}"><span class="to">${esc(nice(net.stopById.get(id)?.name ?? id))}</span><span class="eta"><small>${formatMinutes(timeAt(bus, i))}</small></span></button>`;
  }).join('');
  return `<div class="head">${back()}<span class="badge" style="--c:${bus.line.color}">${esc(bus.line.number)}</span><div><h1>${t('¿Dónde te bajas?')}</h1><small>${t('Te avisamos un poco antes de llegar')}</small></div></div>
    <div class="rows">${stops}</div>`;
}

function rideShareHTML() {
  return `<div class="head">${back()}<div><h1>${t('¿Ayudas a quien espera?')}</h1></div></div>
    <p class="intro">${t('Mientras vas en el bus, la web puede enviar dónde va. Así quien espera en las paradas siguientes ve el bus en directo y no solo según el horario.')}</p>
    <ul class="facts">
      <li>${t('No enviamos tu nombre ni ningún dato tuyo: solo la línea y el punto del recorrido.')}</li>
      <li>${t('Solo mientras tengas esta pantalla abierta y estés sobre el recorrido del bus.')}</li>
      <li>${t('Se borra a los dos minutos. Puedes dejar de compartir cuando quieras.')}</li>
    </ul>
    <div class="buttons one">
      <button type="button" class="cta" data-act="ride-share" data-share="yes">${t('Sí, compartir')}</button>
      <button type="button" class="cta second" data-act="ride-share" data-share="no">${t('Ahora no')}</button>
    </div>`;
}

function rideHTML() {
  const ride = state.ride;
  if (!ride) return `<div class="head">${back()}<div><h1>${t('Ya has llegado')}</h1></div></div>`;
  const { line, dir } = keyParts(ride.key);
  const target = net.stopById.get(dir.stops[ride.target]);
  const bus = state.busByKey.get(ride.key);
  const c = clock();
  const arriveAt = minutesFor(ride.key, ride.target);
  const left = arriveAt === null ? null : Math.max(0, Math.round(arriveAt - c.t));
  const passed = ride.metres !== null && ride.onRoute ? stopIndexAt(dir, ride.metres) : (bus ? bus.nextStopIndex - (bus.stopped ? 0 : 1) : null);
  const stopsLeft = passed === null ? null : Math.max(0, ride.target - passed);
  const leftText = [
    stopsLeft === null ? '' : (stopsLeft === 1 ? t('Es la próxima parada') : t('Faltan {n} paradas', { n: stopsLeft })),
    left === null ? '' : (left === 0 ? t('ya llegas') : t('llegas a las {time}, en unos {n} min', { time: formatMinutes(arriveAt), n: left })),
  ].filter(Boolean).join(' · ');
  let gps;
  if (ride.gps === 'off') gps = t('Sin ubicación: te avisamos según el horario.');
  else if (ride.metres === null) gps = t('Buscando tu posición…');
  else if (!ride.onRoute) gps = t('No te vemos sobre el recorrido del bus. Los tiempos van según el horario.');
  else gps = t('Te seguimos por GPS mientras esta pantalla esté abierta.');
  const alert = state.alerts.find((x) => x.id === ride.alertId);
  const options = ALERT_OPTIONS.off.map((n) => `<button type="button" data-act="ride-before" data-before="${n}" aria-pressed="${alert?.before === n}">${n} min</button>`).join('');
  const share = ride.share
    ? `<div class="share on"><p><strong>${t('Compartes dónde va el bus.')}</strong> ${t('Gracias: quien espera lo ve en directo.')}</p><button type="button" class="ghost" data-act="ride-share-toggle">${t('Dejar de compartir')}</button></div>`
    : `<div class="share"><p>${t('¿Compartes dónde va el bus para que quien espera lo vea en directo?')}</p><button type="button" class="ghost" data-act="ride-share-toggle">${t('Compartir')}</button></div>`;
  return `<div class="head">${back()}<span class="badge" style="--c:${line.color}">${esc(line.number)}</span><div><small>${t('Hacia {dest}', { dest: esc(nice(dir.dest)) })}</small></div></div>
    <div class="ride-hero"><span class="now-label">${t('Te bajas en')}</span><strong class="big-line">${esc(nice(target.name))}</strong><small>${esc(leftText)}</small></div>
    <p class="wait-note">${esc(gps)}</p>
    <div class="bell-opts"><p>${t('Te avisamos antes de llegar, aunque bloquees el móvil:')}</p><div class="bell-row">${options}</div><small>${alertHelp()}</small></div>
    ${share}
    ${bus && !bus.parkedUntil ? `<div class="rows"><h2>${t('Hasta tu parada')}</h2></div>${stripHTML(bus, { full: true, target: ride.target, until: true })}` : ''}
    <button type="button" class="cta second" data-act="ride-end">${t('Ya me he bajado')}</button>${foot()}`;
}

function lineDirections() {
  return net.lines.filter((l) => l.number === state.lineNumber).flatMap((line) => line.dirs.map((dir) => ({ line, dir })));
}

function nextDepartureOf(number, kind, tNow) {
  let best = null;
  for (const line of net.lines) {
    if (line.number !== number) continue;
    for (const dir of line.dirs) {
      const svc = dir.svc[kind];
      if (!svc) continue;
      for (const dep of svc.dep) {
        const start = dep + svc.off[0];
        if (start >= tNow && (best === null || start < best)) best = start;
      }
    }
  }
  return best;
}

function busCard(bus) {
  const stops = bus.dir.stops;
  const where = whereNow(bus);
  if (bus.parkedUntil) return nowCard(where.label, where.place, t('Vuelve a salir a las {time}', { time: formatMinutes(bus.parkedUntil) }));
  const next = net.stopById.get(stops[bus.nextStopIndex]);
  const inMin = Math.max(0, Math.round(timeAt(bus, bus.nextStopIndex) - clock().t));
  const after = net.stopById.get(stops[Math.min(bus.nextStopIndex + 1, stops.length - 1)]);
  const atOrArriving = where.phase === 'at' || where.phase === 'arriving';
  const nextText = atOrArriving
    ? (bus.nextStopIndex < stops.length - 1 ? t('Después va a {stop}', { stop: nice(after?.name ?? '') }) : t('Es el final del recorrido'))
    : (inMin ? t('Siguiente parada: {stop}, en {n} min', { stop: nice(next?.name ?? ''), n: inMin }) : t('Siguiente parada: {stop}', { stop: nice(next?.name ?? '') }));
  return `<p class="card-title">${t('Hacia {dest}', { dest: esc(nice(bus.dir.dest)) })}</p>${nowCard(where.label, where.place, nextText, bus.key, undefined, bus.live ?? null)}${stripHTML(bus)}<button type="button" class="ghost route-all" data-act="follow" data-key="${esc(bus.key)}">${t('Ver todo el recorrido')}</button>`;
}

const shortDays = (days) => (/lunes a viernes/i.test(days) ? t('Lunes a viernes') : (/todos/i.test(days) ? t('Todos los días') : days));

function lineHTML() {
  const group = net.lines.filter((l) => l.number === state.lineNumber);
  const line = group[0];
  const c = clock();
  const mine = state.buses.filter((b) => b.line.number === state.lineNumber);
  const title = mine.length > 1 ? t('Dónde están ahora sus {n} buses', { n: mine.length }) : t('Dónde está ahora');
  let status = mine.map((b) => busCard(b)).join('');
  if (!mine.length) {
    const next = nextDepartureOf(state.lineNumber, c.kind, c.t);
    status = `<div class="now"><span class="now-text"><span class="now-label">${t('Ahora mismo')}</span><strong>${t('No hay ningún bus en la calle')}</strong><small>${next === null ? t('Hoy ya no hay más salidas de esta línea') : t('El próximo sale a las {time}', { time: formatMinutes(next) })}</small></span></div>`;
  }
  const notice = hasWorks(state.lineNumber) ? `<div class="notice-item"><strong>${t('Cambios por obras')}</strong>${esc(t(NOTICES[0].body))}</div>` : '';
  const toggle = `<button type="button" class="cta second" data-act="toggle-stops" aria-expanded="${state.showStops}">${state.showStops ? t('Ocultar paradas y horario') : t('Ver paradas y horario')}</button>`;
  let details = '';
  if (state.showStops) {
    const dirs = lineDirections();
    const index = Math.min(state.lineDir, dirs.length - 1);
    const current = dirs[index];
    const hours = [...new Set(group.map((l) => [shortDays(l.days), /consultar/i.test(l.frequency) ? '' : l.frequency, t('de {a} a {b}', { a: l.first, b: l.last })].filter(Boolean).join(' · ')))];
    const dests = dirs.map((d) => d.dir.dest);
    const dirLabel = (d) => (dests.filter((x) => x === d.dir.dest).length > 1 ? t('De {a} a {b}', { a: nice(d.dir.origin), b: nice(d.dir.dest) }) : t('Hacia {dest}', { dest: nice(d.dir.dest) }));
    const buttons = dirs.map((d, i) => `<button type="button" data-act="line-dir" data-index="${i}" aria-pressed="${i === index}">${esc(dirLabel(d))}</button>`).join('');
    const stops = current.dir.stops.map((id) => {
      const stop = net.stopById.get(id);
      return `<button type="button" class="row" data-act="stop" data-id="${esc(id)}"><span class="to">${esc(nice(stop?.name ?? id))}</span></button>`;
    }).join('');
    details = `<p class="hours">${hours.map(esc).join('<br>')}</p>
      <div class="dirs" role="group" aria-label="${t('Sentido')}">${buttons}</div>
      <div class="rows"><h2>${t('{n} paradas', { n: current.dir.stops.length })}</h2>${stops}</div>`;
  }
  return `<div class="head">${back()}<span class="badge big" style="--c:${line.color}">${esc(line.number)}</span><div><h1 class="route">${esc(routeOf(line))}</h1></div></div>
    <div class="rows"><h2>${esc(title)}</h2></div>
    ${status}${notice}${toggle}${details}${foot()}`;
}

/* ---------- Cómo llegar ---------- */
const WALK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13" cy="4.5" r="1.8"></circle><path d="M9 21l2.5-6.5L9.5 11l3.5-3 2 3.5 3 1.5M11.5 14.5L15 17l1 4M9.5 11L7 13"></path></svg>';
const FLAG_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.4"></circle></svg>';
const roundMin = (m) => Math.max(1, Math.round(m));
const metresText = (m) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

function placeOfStop(stop) {
  return { label: nice(stop.name), sub: t('Parada'), lat: stop.lat, lng: stop.lng, stopId: stop.id };
}

function planSuggestions() {
  const { field, text, places } = state.plan;
  const q = norm(text.trim());
  const list = [];
  if (field === 'from' && !q) list.push({ me: true, label: t('Mi ubicación'), sub: t('Salir desde donde estoy') });
  if (q.length >= 2) {
    list.push(...places);
    const stops = net.stops.filter((s) => norm(nice(s.name)).includes(q) || norm(s.name).includes(q)).slice(0, 6);
    list.push(...stops.map(placeOfStop));
  }
  state.plan.sugg = list;
  return list;
}

function refreshPlan() {
  const { from, to } = state.plan;
  if (!from || !to) { state.plan.result = null; return; }
  const c = clock();
  const key = `${from.lat},${from.lng}|${to.lat},${to.lng}|${c.kind}|${Math.floor(c.t)}`;
  if (key === state.plan.resultFor) return;
  state.plan.resultFor = key;
  state.plan.result = planTrips(net, { from, to, kind: c.kind, t: c.t });
}

function tripSummary(trip, index) {
  const chain = trip.legs.map((leg) => `<span class="badge" style="--c:${leg.line.color}">${esc(leg.line.number)}</span>`).join('<span class="chain-sep" aria-hidden="true">›</span>');
  const waitFor = Math.max(0, Math.round(trip.leave - clock().t));
  const leave = waitFor === 0 ? t('Sal ahora') : t('Sal en {n} min, a las {time}', { n: waitFor, time: formatMinutes(trip.leave) });
  const walked = walkMinutes(trip.walked);
  const change = trip.legs.length > 1 ? ` · ${t('1 transbordo')}` : '';
  return `<button type="button" class="row trip" data-act="plan-trip" data-index="${index}">
    <span class="to"><span class="chain">${chain}</span><small>${esc(leave)}<br>${t('Andas {n} min', { n: roundMin(walked) })}${change}</small></span>
    <span class="eta">${roundMin(trip.arrive - clock().t)}<small> min</small><small class="eta-at">${t('llegas {time}', { time: formatMinutes(trip.arrive) })}</small></span>
  </button>`;
}

function planResultsHTML() {
  const plan = state.plan;
  const typing = document.activeElement?.classList?.contains('plan-input') || (!plan.from && plan.field === 'from') || (!plan.to && plan.field === 'to');
  if (typing && (plan.text.trim().length >= 2 || plan.field === 'from')) {
    const list = planSuggestions();
    if (!list.length) return plan.text.trim().length >= 2 ? `<p class="empty">${t('No encuentro ese sitio en Lugo. Prueba con otra parte del nombre.')}</p>` : '';
    return `<div class="rows">${list.map((item, i) => `<button type="button" class="row" data-act="plan-pick" data-index="${i}"><span class="to">${esc(item.label)}<small>${esc(item.sub ?? '')}</small></span></button>`).join('')}</div>`;
  }
  if (!plan.from || !plan.to) return `<p class="bell-hint plan-tip">${t('Escribe una calle, un sitio o una parada de Lugo. Por ejemplo: «hospital» o «catedral».')}</p>`;
  refreshPlan();
  const { trips, walk, better, nearFrom, nearTo } = plan.result;
  if (!nearFrom || !nearTo) return `<p class="empty">${!nearFrom ? t('No hay paradas de bus cerca del punto de salida. Prueba con otro sitio de Lugo.') : t('No hay paradas de bus cerca del destino. Prueba con otro sitio de Lugo.')}</p>`;
  const walkRow = walk !== null ? `<div class="now plan-walk"><span class="step-icon" aria-hidden="true">${WALK_ICON}</span><span class="now-text"><strong>${better ? t('Te conviene ir andando') : t('También puedes ir andando')}</strong><small>${t('Unos {n} min, llegas a las {time}', { n: roundMin(walk), time: formatMinutes(clock().t + walk) })}</small></span></div>` : '';
  if (!trips.length) {
    return `${walkRow}<p class="empty">${t('Ahora no hay ningún bus para este viaje en las próximas 3 horas.')}</p>`;
  }
  const rows = `<div class="rows"><h2>${t('Toca una opción para ver los pasos')}</h2>${trips.map((trip, i) => tripSummary(trip, i)).join('')}</div>`;
  return better ? `${walkRow}${rows}` : `${rows}${walkRow}`;
}

function planHTML() {
  const { from, to } = state.plan;
  const field = (name, value, label, placeholder) => `<label class="plan-field"><span class="plan-dot ${name}" aria-hidden="true"></span><span class="sr">${label}</span><input class="plan-input" data-field="${name}" type="search" value="${esc(value?.label ?? '')}" placeholder="${placeholder}" autocomplete="off" enterkeyhint="search"></label>`;
  return `<div class="head">${back()}<div><h1>${t('Cómo llegar')}</h1></div></div>
    <div id="plan-form" class="plan-form">
      <div class="plan-fields">${field('from', from, t('Desde'), t('¿Desde dónde sales?'))}${field('to', to, t('Hasta'), t('¿A dónde vas?'))}</div>
      <button type="button" class="plan-swap" data-act="plan-swap" aria-label="${t('Cambiar origen y destino')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4v15M8 4L4.5 7.5M8 4l3.5 3.5M16 20V5M16 20l-3.5-3.5M16 20l3.5-3.5"></path></svg></button>
    </div>
    <div id="plan-results">${planResultsHTML()}</div>${foot()}`;
}

/** El viaje tal como lo entiende el resto de la web: una llegada a la parada donde se sube. */
function legArrival(leg) {
  const minutes = leg.boardAt;
  return { key: leg.key, line: leg.line, dir: leg.dir, dirIndex: leg.dirIndex, run: leg.run, stopIndex: leg.i, minutes, eta: Math.max(0, Math.round(minutes - clock().t)), time: formatMinutes(minutes), stopId: leg.dir.stops[leg.i] };
}

/** La bajada del tramo, para poner la campana de «avísame antes de bajar». */
function legAlight(leg) {
  return { key: leg.key, kind: 'off', stopIndex: leg.j, minutes: leg.alightAt, stopId: leg.dir.stops[leg.j] };
}

function legNow(leg) {
  const arrival = legArrival(leg);
  const bus = state.busByKey.get(leg.key);
  if (bus && !bus.parkedUntil) {
    if (bus.nextStopIndex > leg.i) return t('Este bus ya ha pasado por tu parada. Mira otra opción.');
    const where = whereNow(bus);
    return t('Ahora: {where} {place}', { where: where.label.toLowerCase(), place: where.place });
  }
  const other = companionOf(arrival);
  if (!other) return t('Todavía no ha salido. Sale de {place}.', { place: nice(leg.dir.origin) });
  const where = whereNow(other);
  return t('Un bus de esta línea, ahora: {where} {place}', { where: where.label.toLowerCase(), place: where.place });
}

function step(icon, title, detail = '', extra = '') {
  return `<li class="step"><span class="step-icon"${icon.color ? ` style="--c:${icon.color}"` : ''} aria-hidden="true">${icon.html}</span><div class="step-text"><strong>${title}</strong>${detail ? `<small>${detail}</small>` : ''}${extra}</div></li>`;
}

function tripHTML() {
  const trip = state.plan.trip;
  const { from, to } = state.plan;
  const c = clock();
  const steps = [];
  const walkIcon = { html: WALK_ICON };
  if (trip.startMetres > 30) steps.push(step(walkIcon, esc(t('Camina hasta {place}', { place: nice(trip.startStop.name) })), esc(t('{n} min, {d}. Sal a las {time}.', { n: roundMin(walkMinutes(trip.startMetres)), d: metresText(trip.startMetres), time: formatMinutes(trip.leave) }))));
  trip.legs.forEach((leg, index) => {
    const board = net.stopById.get(leg.dir.stops[leg.i]);
    const off = net.stopById.get(leg.dir.stops[leg.j]);
    const arrival = legArrival(leg);
    const alight = legAlight(leg);
    const eta = Math.round(leg.boardAt - c.t);
    const when = eta <= 0 ? t('ahora') : t('en {n} min', { n: eta });
    const count = leg.j - leg.i;
    const tools = `<div class="step-tools"><button type="button" class="pill" data-act="plan-bus" data-index="${index}">${t('Ver dónde está')}</button>${bellButton(arrival)}</div>${bellChooser(arrival)}`;
    const offTools = `<div class="step-tools">${bellButton(alight)}</div>${bellChooser(alight)}`;
    steps.push(step({ html: esc(leg.line.number), color: leg.line.color }, esc(t('Coge la {n} en {stop}', { n: leg.line.number, stop: nice(board.name) })), `${esc(t('Hacia {dest}, a las {time} ({when}).', { dest: nice(leg.dir.dest), time: formatMinutes(leg.boardAt), when }))}<br>${esc(legNow(leg))}`, tools));
    steps.push(step({ html: '↓', color: leg.line.color }, esc(t('Baja en {stop}', { stop: nice(off.name) })), esc(count === 1 ? t('A las {time}, tras 1 parada.', { time: formatMinutes(leg.alightAt) }) : t('A las {time}, tras {n} paradas.', { time: formatMinutes(leg.alightAt), n: count })), offTools));
    if (index < trip.legs.length - 1 && trip.gaps[index] > 30) {
      const next = net.stopById.get(trip.legs[index + 1].dir.stops[trip.legs[index + 1].i]);
      steps.push(step(walkIcon, esc(t('Camina hasta {place}', { place: nice(next.name) })), esc(t('{n} min, {d}.', { n: roundMin(walkMinutes(trip.gaps[index])), d: metresText(trip.gaps[index]) }))));
    }
  });
  if (trip.endMetres > 30) steps.push(step(walkIcon, esc(t('Camina hasta {place}', { place: to.label })), esc(t('{n} min, {d}.', { n: roundMin(walkMinutes(trip.endMetres)), d: metresText(trip.endMetres) }))));
  steps.push(step({ html: FLAG_ICON }, esc(t('Llegas a {place}', { place: to.label })), esc(t('A las {time}.', { time: formatMinutes(trip.arrive) }))));
  return `<div class="head">${back()}<div><h1>${t('Llegas a las {time}', { time: formatMinutes(trip.arrive) })}</h1><small>${esc(from.label)} → ${esc(to.label)}</small></div></div>
    <ol class="steps">${steps.join('')}</ol>${foot()}`;
}

function searchHTML() {
  const q = norm(state.query.trim());
  if (!q) return `<div class="head">${back()}<div><h1>${t('Buscar')}</h1><small>${t('Escribe el nombre de una parada o una línea')}</small></div></div>`;
  const hospital = norm(t('hospital'));
  const lines = [...new Map(net.lines.filter((l) => norm(l.number).startsWith(q) || norm(routeOf(l)).includes(q) || norm(l.name).includes(q) || (ROUTES[l.number]?.hospital && (hospital.startsWith(q) || 'hospital'.startsWith(q)))).map((l) => [l.number, l])).values()].slice(0, 8);
  const stops = net.stops.filter((s) => norm(s.name).includes(q) || norm(nice(s.name)).includes(q) || (s.code && s.code.toLowerCase() === q)).slice(0, 30);
  if (!lines.length && !stops.length) return `<div class="head">${back()}<div><h1>${t('Sin resultados')}</h1><small>${t('Prueba con otra parte del nombre, como «Fontiñas» o «HULA»')}</small></div></div>`;
  const total = stops.length + lines.length;
  return `<div class="head">${back()}<div><h1>${total === 1 ? t('1 resultado') : t('{n} resultados', { n: total })}</h1></div></div>
    <div class="rows">
      ${lines.map((l) => `<button type="button" class="row" data-act="line" data-number="${esc(l.number)}"><span class="badge" style="--c:${l.color}">${esc(l.number)}</span><span class="to">${esc(routeOf(l))}<small>${esc(lineStatus(l.number).text)}</small></span></button>`).join('')}
      ${stops.map((s) => `<button type="button" class="row" data-act="stop" data-id="${esc(s.id)}"><span class="to">${esc(nice(s.name))}${isFav(s.id) ? ' <span class="fav-mark" aria-label="' + t('Guardada') + '">★</span>' : ''}<small>${s.lines.length === 1 ? t('1 línea') : t('{n} líneas', { n: s.lines.length })}</small></span></button>`).join('')}
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
  if (onRoad === 1) text = t('1 bus en marcha');
  else if (onRoad > 1) text = t('{n} buses en marcha', { n: onRoad });
  else if (next !== null) text = t('Próxima salida a las {time}', { time: formatMinutes(next) });
  else text = t('Hoy ya no hay más salidas');
  return { active: onRoad > 0 || soon, text };
}

function lineRow(l) {
  const status = lineStatus(l.number);
  const works = hasWorks(l.number) ? ` · ${t('Cambios por obras')}` : '';
  return `<button type="button" class="row" data-act="line" data-number="${esc(l.number)}">
    <span class="badge" style="--c:${l.color}">${esc(l.number)}</span>
    <span class="to">${esc(routeOf(l))}<small>${esc(status.text)}${works}</small></span>
  </button>`;
}

function menuHTML() {
  const numbers = [...new Map(net.lines.map((l) => [l.number, l])).values()];
  const c = clock();
  const simText = c.live ? t('Mira cómo se mueven los buses en otro momento') : t('Ahora ves las {time}', { time: formatMinutes(Math.floor(c.t)) });
  const active = numbers.filter((l) => lineStatus(l.number).active);
  const idle = numbers.filter((l) => !lineStatus(l.number).active);
  const list = active.length
    ? `<div class="rows">${active.map(lineRow).join('')}</div>`
    : `<p class="empty">${t('Ahora mismo no hay ningún bus en la calle.')}</p>`;
  const idleText = idle.length === 1 ? t('Ver la línea sin buses ahora') : t('Ver las {n} líneas sin buses ahora', { n: idle.length });
  const idleBlock = idle.length
    ? `<button type="button" class="cta second" data-act="toggle-idle" aria-expanded="${state.showIdle}">${state.showIdle ? t('Ocultar líneas sin buses') : idleText}</button>
       ${state.showIdle ? `<div class="rows">${idle.map(lineRow).join('')}</div>` : ''}`
    : '';
  return `<div class="head">${back()}<div><h1>${t('Líneas con buses ahora')}</h1><small>${t('Toca una para ver dónde está su bus')}</small></div></div>
    ${list}${idleBlock}
    <div class="rows">
      <button type="button" class="row" data-act="notices"><span class="to">${t('Obras y cambios en las líneas')}</span><span class="count">${NOTICES.length}</span></button>
      <button type="button" class="row" data-act="sim"><span class="to">${t('Ver otra hora')}<small>${esc(simText)}</small></span></button>
      <a class="row" href="pantalla.html"><span class="to">${t('Pantalla para un bar, una tienda o la entrada de casa')}<small>${t('Los próximos buses de una parada, en grande')}</small></span></a>
    </div>${langSwitch()}${foot()}`;
}

function simHTML() {
  return `<div class="head">${back()}<div><h1>${t('Ver otra hora')}</h1><small>${t('Elige el momento que quieres ver')}</small></div></div>`;
}

function noticesHTML() {
  return `<div class="head">${back()}<div><h1>${t('Obras y cambios')}</h1></div></div>
    ${NOTICES.map((n) => `<div class="notice-item"><strong>${esc(t(n.title))}</strong>${esc(t(n.body))}<small>${esc(t(n.date))}</small></div>`).join('')}
    ${foot()}`;
}

let lastHTML = '';
function renderSheet() {
  if (state.view === 'plan' && $('#plan-form')) {
    const results = planResultsHTML();
    const box = $('#plan-results');
    if (box.dataset.shown !== results) {
      box.innerHTML = results;
      box.dataset.shown = results;
    }
    return;
  }
  const html = { home: homeHTML, stop: stopHTML, bus: busHTML, menu: menuHTML, line: lineHTML, search: searchHTML, notices: noticesHTML, sim: simHTML, plan: planHTML, trip: tripHTML, 'ride-pick': ridePickHTML, 'ride-share': rideShareHTML, ride: rideHTML }[state.view]();
  if (html !== lastHTML) {
    $('#sheet-body').innerHTML = html;
    lastHTML = html;
  }
}

function renderClock() {
  const c = clock();
  const n = state.buses.filter((b) => !b.parkedUntil).length;
  const count = n === 1 ? t('1 bus') : t('{n} buses', { n });
  const el = $('#clock');
  el.classList.toggle('sim', !c.live);
  el.hidden = c.live;
  const label = { laborable: t('laborable'), sabado: t('sábado'), domingo: t('domingo') }[c.kind];
  el.innerHTML = c.live
    ? `<i></i>${count} · ${formatMinutes(Math.floor(c.t))}`
    : `<i></i>${t('Simulación')} · ${label} ${formatMinutes(Math.floor(c.t))}`;
  if (!$('#simpanel').hidden) syncSimPanel();
}

function checkAlert() {
  if (!state.alerts.length) return;
  const c = clock();
  const before = state.alerts.length;
  state.alerts = state.alerts.filter((alert) => {
    const index = alert.stopIndex ?? keyParts(alert.key).dir?.stops.indexOf(alert.stopId) ?? -1;
    const minutes = minutesFor(alert.key, index);
    if (minutes === null) return alert.at > Date.now();
    if (minutes - c.t > alert.before) return true;
    if (alert.at < Date.now() - 10 * 60000) return false;
    const vars = { n: alert.number, stop: nice(alert.name), m: alert.before };
    toast(kindOf(alert) === 'off' ? t('Prepárate: en unos {m} min llegas a {stop}', vars) : t('La línea {n} llega a {stop} en unos {m} min', vars));
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } catch { /* el aviso en pantalla ya está dado */ }
    return false;
  });
  if (state.alerts.length !== before) saveAlerts();
}

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

/* ---------- Voy en este bus: estado ---------- */
const RIDE_SEND_MS = 15000;
const ON_ROUTE_METRES = 150;

function saveRide() {
  try {
    if (state.ride) localStorage.setItem('xaven-viaxe', JSON.stringify({ ...state.ride, dir: undefined }));
    else localStorage.removeItem('xaven-viaxe');
  } catch { /* solo esta visita */ }
}

function loadRide() {
  try {
    const saved = JSON.parse(localStorage.getItem('xaven-viaxe') ?? 'null');
    if (!saved || saved.until < Date.now()) return;
    const { dir } = keyParts(saved.key);
    if (!dir) return;
    state.ride = { ...saved, dir, metres: null, onRoute: false, sent: 0 };
  } catch { /* nada guardado */ }
}

async function startRide(key, target, share) {
  const { dir } = keyParts(key);
  const end = minutesFor(key, dir.stops.length - 1) ?? clock().t + 60;
  state.ride = { key, dir, target, share, alertId: null, notified: false, until: Date.now() + (end - clock().t + 30) * 60000, metres: null, onRoute: false, sent: 0, gps: 'wait', rescheduled: 0 };
  saveRide();
  state.busKey = key;
  state.follow = true;
  go('ride');
  requestAnimationFrame(() => followCamera(700));
  const left = (minutesFor(key, target) ?? clock().t) - clock().t;
  const before = left > 3.5 ? 2 : 1;
  const result = await setAlert({ key, stopId: dir.stops[target], stopIndex: target, kind: 'off', before });
  state.ride.alertId = state.alerts.find((x) => x.key === key && kindOf(x) === 'off')?.id ?? null;
  saveRide();
  if (result === 'denied') toast(t('Las notificaciones están bloqueadas: solo te avisaremos con esta pantalla abierta'));
  askLocation(() => { if (state.ride) { state.ride.gps = 'on'; renderSheet(); } }, { quiet: true, onFail: () => { if (state.ride) { state.ride.gps = 'off'; renderSheet(); } } });
}

function endRide(message) {
  const ride = state.ride;
  if (!ride) return;
  setOwn(ride.key, null);
  if (message !== 'arrived') removeAlert(state.alerts.find((x) => x.id === ride.alertId));
  state.ride = null;
  saveRide();
  if (message === 'arrived') toast(t('Has llegado a tu parada'));
  if (state.view === 'ride') goHome();
}

/** Aviso inmediato en el móvil cuando la siguiente parada es la tuya. */
async function notifyAlight(stop) {
  const text = t('Bájate en la próxima: {stop}', { stop: nice(stop.name) });
  toast(text);
  try { navigator.vibrate?.([300, 120, 300, 120, 300]); } catch { /* sin vibración */ }
  try {
    if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('Xa Vén', { body: text, tag: 'bajada', requireInteraction: true, icon: 'icon-192.png' });
    }
  } catch { /* el aviso en pantalla ya está dado */ }
}

/** Cada vez que el GPS dice dónde está la persona que va en el bus. */
function onRidePosition(pos) {
  const ride = state.ride;
  if (!ride || !clock().live) return;
  const c = clock();
  const { dir, run } = keyParts(ride.key);
  const svc = dir.svc[c.kind];
  if (!svc) return;
  const accuracy = pos.coords.accuracy ?? 0;
  const proj = projectOnPath(dir, pos.coords.latitude, pos.coords.longitude);
  ride.gps = 'on';
  ride.metres = proj.metres;
  ride.onRoute = proj.off <= ON_ROUTE_METRES && accuracy <= 120;
  if (!ride.onRoute) return;
  const delay = c.t - scheduledTimeAt(dir, svc, run, proj.metres);
  if (delay > -6 && delay < 30) setOwn(ride.key, delay);
  if (ride.share && Date.now() - ride.sent > RIDE_SEND_MS) {
    ride.sent = Date.now();
    sendPosition(ride.key, pos.coords.latitude, pos.coords.longitude, accuracy);
  }
  const passed = stopIndexAt(dir, proj.metres);
  const targetStop = net.stopById.get(dir.stops[ride.target]);
  if (proj.metres > dir.cum[dir.pi[ride.target]] + 40) { endRide('arrived'); return; }
  if (!ride.notified && ride.target - passed <= 1) {
    ride.notified = true;
    saveRide();
    removeAlert(state.alerts.find((x) => x.id === ride.alertId));
    notifyAlight(targetStop);
    return;
  }
  // Si va con retraso o adelantado, el aviso del servidor se mueve con él.
  const alert = state.alerts.find((x) => x.id === ride.alertId);
  if (alert && Math.abs(delay - (alert.delayAt ?? 0)) >= 2 && Date.now() - ride.rescheduled > 60000) {
    ride.rescheduled = Date.now();
    setAlert({ key: alert.key, stopId: alert.stopId, stopIndex: alert.stopIndex, kind: 'off', before: alert.before }).then(() => {
      if (state.ride) state.ride.alertId = state.alerts.find((x) => x.key === alert.key && kindOf(x) === 'off')?.id ?? null;
      saveRide();
    });
  }
}

/** Trae los minutos de la parada y los interurbanos cuando se abre una parada. */
let extrasBusy = false;
async function loadStopExtras() {
  if (state.view !== 'stop' || extrasBusy || !clock().live) return;
  const id = state.stopId;
  const have = state.extras.get(id);
  if (have && Date.now() - have.at < 20000) return;
  extrasBusy = true;
  try {
    const [times, coaches] = await Promise.all([stopTimesFor(id), coachesFor(id)]);
    state.extras.set(id, { times, coaches, at: Date.now() });
    if (state.view === 'stop' && state.stopId === id) renderSheet();
  } finally { extrasBusy = false; }
}

/* ---------- Acciones ---------- */
function go(view) {
  if (view !== 'bus') state.wait = null;
  if (view !== state.view && !['search', 'notices', 'ride-pick', 'ride-share'].includes(state.view)) state.previous = state.view;
  state.view = view;
  state.bellFor = null;
  document.body.dataset.view = view;
  $('#sheet').dataset.size = ['menu', 'search', 'plan', 'ride-pick', 'ride-share'].includes(view) ? 'tall' : 'mid';
  $('#simpanel').hidden = view !== 'sim';
  if (view === 'sim') syncSimPanel();
  renderSheet();
  updateMarkers();
  updatePins();
  applyMapFocus();
  updateApproach();
  updatePlanMap();
  if (view === 'stop') loadStopExtras();
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
  requestAnimationFrame(() => moveTo([[stop.lat, stop.lng]], 15.8));
}

/** Al tocar una línea en una parada: lleva al bus de esa línea, esté donde esté. */
function openArrival(key, stopId, known = null) {
  const a = known ?? arrivalsFor(stopId).find((x) => x.key === key);
  if (!a || state.busByKey.has(key)) {
    selectBus(key);
    return;
  }
  state.follow = true;
  state.busFromLine = false;
  state.previous = state.view === 'bus' ? state.previous : state.view;
  state.wait = a;
  state.busKey = companionOf(a)?.key ?? null;
  go('bus');
  requestAnimationFrame(() => followCamera(700));
}

function openPlan(to = null) {
  const plan = state.plan;
  if (to) plan.to = to;
  if (!plan.from && inLugo()) plan.from = myPlace();
  plan.field = !plan.from ? 'from' : 'to';
  plan.text = '';
  plan.places = [];
  plan.trip = null;
  go('plan');
  if (plan.from || state.me) return;
  askLocation(() => {
    if (!inLugo()) { toast(farText()); return; }
    const typingFrom = document.activeElement?.dataset?.field === 'from' && plan.text;
    if (state.view !== 'plan' || plan.from || typingFrom) return;
    plan.from = myPlace();
    if (plan.field === 'from') plan.field = 'to';
    planAfterPick();
  }, { quiet: true });
}

function planAfterPick() {
  const plan = state.plan;
  plan.text = '';
  plan.places = [];
  document.querySelectorAll('.plan-input').forEach((input) => {
    input.value = plan[input.dataset.field]?.label ?? '';
    input.blur();
  });
  plan.field = !plan.from ? 'from' : !plan.to ? 'to' : plan.field;
  renderSheet();
  updatePlanMap();
  if (!plan.from || !plan.to) $(`.plan-input[data-field="${plan.field}"]`)?.focus();
}

let placeTimer = 0;
let placeAbort = null;

/** Busca calles y sitios de Lugo mientras se escribe, sin lanzar una petición por cada tecla. */
function searchPlaces(text) {
  clearTimeout(placeTimer);
  placeAbort?.abort();
  state.plan.places = [];
  if (text.trim().length < 3) return;
  placeTimer = setTimeout(async () => {
    placeAbort = new AbortController();
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=6&lat=43.012&lon=-7.556&bbox=-7.68,42.94,-7.44,43.08`;
      const data = await fetch(url, { signal: placeAbort.signal }).then((r) => r.json());
      if (state.plan.text !== text) return;
      const seen = new Set();
      state.plan.places = (data.features ?? []).map((f) => {
        const p = f.properties ?? {};
        const street = [p.street, p.housenumber].filter(Boolean).join(' ');
        const label = p.name || street;
        return { label, sub: [p.name ? street : '', p.district || p.city].filter(Boolean).join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
      }).filter((x) => x.label && !seen.has(x.label + x.sub) && seen.add(x.label + x.sub));
      renderSheet();
    } catch { /* sin conexión con el buscador quedan las paradas */ }
  }, 350);
}

function selectBus(key) {
  state.wait = null;
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
  if (state.view === 'trip') { state.plan.trip = null; go('plan'); return; }
  if (state.view === 'ride-pick' || state.view === 'ride-share') { state.follow = true; go('bus'); followCamera(700); return; }
  if (state.view === 'ride') { goHome(); return; }
  if (state.view === 'bus' && state.busFromTrip) {
    state.busFromTrip = false;
    state.stopId = null;
    state.follow = false;
    shownPlan = '';
    go('trip');
    return;
  }
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

const FAR_FROM_LUGO = 20000;
const IN_PLAN_REFRESH_METRES = 100;
const farText = () => t('Parece que estás fuera de Lugo. Puedes buscar cualquier parada.');
let watching = false;

function nearestStop(point) {
  let stop = net.stops[0];
  let metres = Infinity;
  for (const candidate of net.stops) {
    const d = distanceMetres(point.lat, point.lng, candidate.lat, candidate.lng);
    if (d < metres) { metres = d; stop = candidate; }
  }
  return { stop, metres };
}

const inLugo = () => Boolean(state.me) && nearestStop(state.me).metres <= FAR_FROM_LUGO;
const myPlace = () => ({ me: true, label: t('Mi ubicación'), sub: '', lat: state.me.lat, lng: state.me.lng });

function focusOnMe(duration = 700) {
  const near = nearestStop(state.me);
  requestAnimationFrame(() => moveTo([[state.me.lat, state.me.lng], [near.stop.lat, near.stop.lng]], 16, duration));
}

/** Coloca a la persona en el mapa y mantiene al día su punto de salida. */
function applyPosition(pos) {
  state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  document.body.dataset.located = 'yes';
  if (mePin) mePin.setLngLat([state.me.lng, state.me.lat]);
  else updatePins();
  onRidePosition(pos);
  const plan = state.plan;
  if (state.view === 'plan' && plan.from?.me && inLugo() && distanceMetres(plan.from.lat, plan.from.lng, state.me.lat, state.me.lng) >= IN_PLAN_REFRESH_METRES) {
    plan.from = myPlace();
    renderSheet();
    updatePlanMap();
  }
}

/** Pide la ubicación solo cuando la persona elige algo que la necesita. */
function askLocation(onReady, { quiet = false, onFail = null } = {}) {
  if (state.me && watching) { onReady(); return; }
  if (!navigator.geolocation) {
    if (!quiet) toast(t('Este navegador no da tu ubicación. Escribe una calle o una parada.'));
    onFail?.();
    return;
  }
  if (!quiet) toast(t('Buscando dónde estás…'));
  navigator.geolocation.getCurrentPosition((pos) => {
    applyPosition(pos);
    if (!watching) {
      watching = true;
      navigator.geolocation.watchPosition(applyPosition, () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
    }
    onReady();
  }, () => {
    if (!quiet) toast(t('No podemos saber dónde estás. Revisa el permiso de ubicación del navegador o escribe una parada.'));
    onFail?.();
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

/** Ver la parada más cercana. */
function locate() {
  askLocation(() => {
    if (!inLugo()) { toast(farText()); return; }
    selectStop(nearestStop(state.me).stop.id);
    focusOnMe();
  });
}

function wire() {
  $('#sheet-body').addEventListener('input', (e) => {
    if (!e.target.classList?.contains('plan-input')) return;
    const { field } = e.target.dataset;
    state.plan.field = field;
    state.plan[field] = null;
    state.plan.text = e.target.value;
    searchPlaces(e.target.value);
    renderSheet();
    $('#sheet-body').scrollTop = 0;
    updatePlanMap();
  });
  $('#sheet-body').addEventListener('focusin', (e) => {
    if (!e.target.classList?.contains('plan-input')) return;
    state.plan.field = e.target.dataset.field;
    state.plan.text = state.plan[state.plan.field] ? '' : e.target.value;
    if (state.plan[state.plan.field]) e.target.select();
    renderSheet();
  });
  $('#sheet-body').addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'back') goBack();
    else if (act === 'stop') selectStop(el.dataset.id);
    else if (act === 'line') selectLine(el.dataset.number);
    else if (act === 'follow') selectBus(el.dataset.key);
    else if (act === 'notices') go('notices');
    else if (act === 'line-dir') {
      state.lineDir = Number(el.dataset.index);
      state.follow = false;
      renderSheet();
      const d = lineDirections()[state.lineDir];
      requestAnimationFrame(() => moveTo(d.dir.path, 15));
    }
    else if (act === 'sim') go('sim');
    else if (act === 'near') locate();
    else if (act === 'plan') openPlan();
    else if (act === 'plan-here') openPlan(placeOfStop(net.stopById.get(el.dataset.id)));
    else if (act === 'plan-swap') {
      const { from, to } = state.plan;
      state.plan.from = to?.me ? null : to;
      state.plan.to = from?.me ? null : from;
      if (to?.me) state.plan.from = to;
      if (from?.me) { state.plan.to = null; }
      state.plan.field = !state.plan.from ? 'from' : 'to';
      planAfterPick();
    } else if (act === 'plan-pick') {
      const item = state.plan.sugg[Number(el.dataset.index)];
      if (!item) return;
      if (item.me) {
        askLocation(() => {
          if (!inLugo()) { toast(t('Parece que estás fuera de Lugo. Escribe una calle o una parada.')); return; }
          state.plan.from = myPlace();
          state.plan.field = state.plan.to ? 'from' : 'to';
          planAfterPick();
        });
        return;
      }
      state.plan[state.plan.field] = item;
      planAfterPick();
    } else if (act === 'plan-trip') {
      state.plan.trip = state.plan.result?.trips[Number(el.dataset.index)] ?? null;
      if (state.plan.trip) go('trip');
    } else if (act === 'plan-bus') {
      const leg = state.plan.trip?.legs[Number(el.dataset.index)];
      if (!leg) return;
      const arrival = legArrival(leg);
      state.stopId = arrival.stopId;
      state.busFromTrip = true;
      openArrival(leg.key, arrival.stopId, arrival);
    }
    else if (act === 'menu') go('menu');
    else if (act === 'sim10') setSim({ base: 600, kind: 'laborable', speed: 1 });
    else if (act === 'arrival') {
      if (state.view === 'home') selectStop(el.dataset.stop);
      openArrival(el.dataset.key, el.dataset.stop);
    } else if (act === 'bell') {
      state.bellFor = state.bellFor === el.dataset.id ? null : el.dataset.id;
      renderSheet();
    } else if (act === 'bell-set') {
      const { key, stop: stopId, kind } = el.dataset;
      const before = Number(el.dataset.before);
      state.bellFor = null;
      const pending = setAlert({ key, stopId, stopIndex: Number(el.dataset.index), kind, before });
      renderSheet();
      const result = await pending;
      renderSheet();
      if (result === 'ok') toast(t('Listo. Te avisaremos en el móvil {n} min antes, aunque cierres la web', { n: before }));
      else if (result === 'denied') toast(t('Las notificaciones están bloqueadas: solo te avisaremos con esta pantalla abierta'));
      else if (result === 'error') toast(t('No se pudo programar en el móvil: deja esta pantalla abierta para recibir el aviso'));
      else toast(t('Te avisaremos {n} min antes. Deja esta pantalla abierta', { n: before }));
    } else if (act === 'bell-off') {
      removeAlert(state.alerts.find((x) => x.key === el.dataset.key && x.stopId === el.dataset.stop && kindOf(x) === el.dataset.kind));
      state.bellFor = null;
      renderSheet();
      toast(t('Aviso quitado'));
    } else if (act === 'toggle-idle') {
      state.showIdle = !state.showIdle;
      renderSheet();
    } else if (act === 'toggle-stops') {
      state.showStops = !state.showStops;
      renderSheet();
    } else if (act === 'fav') {
      const id = el.dataset.id;
      if (isFav(id)) {
        state.favs = state.favs.filter((x) => x !== id);
        toast(t('Quitada de tus paradas'));
      } else {
        state.favs = [id, ...state.favs].slice(0, FAV_MAX);
        toast(t('Guardada. La verás al abrir Xa Vén'));
      }
      saveFavs();
      renderSheet();
    } else if (act === 'lang') {
      setLang(el.dataset.lang);
      paintThemeButton();
      renderSheet();
      renderClock();
      updatePins();
    } else if (act === 'ride-start') {
      if (state.ride) endRide();
      state.ridePick = el.dataset.key;
      go('ride-pick');
    } else if (act === 'ride-stop') {
      state.rideTarget = Number(el.dataset.index);
      let pref = null;
      try { pref = localStorage.getItem('xaven-compartir'); } catch { /* sin preferencia guardada */ }
      if (pref === null) go('ride-share');
      else startRide(state.ridePick, state.rideTarget, pref === 'si');
    } else if (act === 'ride-share') {
      const share = el.dataset.share === 'yes';
      try { localStorage.setItem('xaven-compartir', share ? 'si' : 'non'); } catch { /* se pregunta otra vez */ }
      startRide(state.ridePick, state.rideTarget, share);
    } else if (act === 'ride-share-toggle' && state.ride) {
      state.ride.share = !state.ride.share;
      try { localStorage.setItem('xaven-compartir', state.ride.share ? 'si' : 'non'); } catch { /* solo esta vez */ }
      saveRide();
      renderSheet();
      toast(state.ride.share ? t('Gracias. Compartes dónde va el bus') : t('Ya no compartes dónde va el bus'));
    } else if (act === 'ride-before' && state.ride) {
      const ride = state.ride;
      const before = Number(el.dataset.before);
      const result = await setAlert({ key: ride.key, stopId: ride.dir.stops[ride.target], stopIndex: ride.target, kind: 'off', before });
      if (state.ride) state.ride.alertId = state.alerts.find((x) => x.key === ride.key && kindOf(x) === 'off')?.id ?? null;
      saveRide();
      renderSheet();
      if (result === 'ok') toast(t('Listo. Te avisaremos en el móvil {n} min antes, aunque cierres la web', { n: before }));
    } else if (act === 'ride-end') {
      endRide();
      if (state.view !== 'home') goHome();
    } else if (act === 'ride-open' && state.ride) {
      state.busKey = state.ride.key;
      state.follow = true;
      go('ride');
      requestAnimationFrame(() => followCamera(700));
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
  $('#locate').addEventListener('click', () => { if (state.me) focusOnMe(); });
  $('#credit').addEventListener('click', () => toast(mapCredit()));
  $('#theme').addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeButton);
  paintThemeButton();
  loadAlerts();
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
  // El teclado del móvil tapa la parte de abajo: el panel se apoya justo encima.
  const viewport = window.visualViewport;
  const syncViewport = () => {
    if (!viewport) return;
    const root = document.documentElement.style;
    root.setProperty('--vvh', `${Math.round(viewport.height)}px`);
    root.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))}px`);
    if (window.scrollY) window.scrollTo(0, 0);
  };
  viewport?.addEventListener('resize', syncViewport);
  viewport?.addEventListener('scroll', syncViewport);
  syncViewport();
  // Al deslizar los resultados se quita el teclado para verlos enteros.
  $('#sheet-body').addEventListener('touchmove', () => {
    const active = document.activeElement;
    if (active?.id === 'q' || active?.classList?.contains('plan-input')) active.blur();
  }, { passive: true });
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
  translateDom();
  loadFavs();
  loadRide();
  wire();
  tickData();
  renderSheet();
  renderClock();
  syncSimPanel();
  // La web queda guardada en el móvil y abre aunque no haya cobertura.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  startLive(() => {
    tickData();
    renderSheet();
  });
  setInterval(() => {
    if (!map) tickData();
    renderSheet();
    renderClock();
    updateApproach();
    checkAlert();
    if (state.view === 'stop') loadStopExtras();
  }, 1000);
  setInterval(() => followCamera(), 4000);
  await initMap();
  updatePins();
  const initial = location.hash.slice(1);
  if (net.stopById.has(initial)) selectStop(initial);
  else if (state.ride) {
    state.busKey = state.ride.key;
    state.follow = true;
    go('ride');
    askLocation(() => { if (state.ride) state.ride.gps = 'on'; }, { quiet: true, onFail: () => { if (state.ride) state.ride.gps = 'off'; } });
  }
}

start().catch((err) => {
  console.error(err);
  $('#sheet-body').innerHTML = `<p class="empty">${t('No se han podido cargar los datos de la red. Recarga la página.')}</p>`;
});
