// Genera una página por parada y por línea, con su horario, para que Google las encuentre:
// quien busca «horario bus Sindicatos Lugo» llega a una página que lo dice y que enlaza a la web.
// Se vuelve a ejecutar cada vez que se regeneran los datos:
//   node tools/build-pages.mjs            (escribe en app/parada, app/linea, app/paradas, app/lineas…)
// SITIO=https://otra.direccion para otra dirección pública.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare, distanceMetres } from '../app/demo/sim.js';

const SITE = (process.env.SITIO || 'https://bus.marcogugliandolo.com').replace(/\/$/, '');
const APP = fileURLToPath(new URL('../app/', import.meta.url));
const net = prepare(JSON.parse(readFileSync(join(APP, 'demo/data/network.json'), 'utf8')));
const today = new Date().toISOString().slice(0, 10);

const KINDS = [['laborable', 'Laborables'], ['sabado', 'Sábados'], ['domingo', 'Domingos y festivos']];
const ROUTES = {
  '1.1': 'Campus USC – Fingoi – O Ceao', '1.2': 'Campus USC – Fingoi – O Ceao – Hospital', '1.3': 'Campus USC – Fontiñas – O Ceao', '1.4': 'Campus USC – Fingoi – O Ceao – Hospital',
  2: 'Rda. Xosé Castiñeira – Ramil', '3.1': 'Rda. Muralla (Sindicatos) – Avda. Coruña – Fontiñas – Montirón – A Tolda', '3.2': 'Rda. Muralla (Sindicatos) – Fontiñas – Montirón – A Tolda',
  '4.1': 'Rda. Muralla (Sindicatos) – Hospital, por Fervedoira', '4.2': 'Rda. Muralla (Sindicatos) – Hospital, por As Gándaras', '5DS': 'Avda. das Américas – Magoi – Fontiñas – Hospital',
  '5ES': 'Fonte dos Ranchos – Abella – Garabolos – Hospital', '5.1': 'Avda. das Américas – Rda. Muralla – Fontiñas – Carqueixo – Hospital', '5.2': 'Avda. das Américas – Magoi – Fontiñas – Hospital',
  6: 'A Piringalla – Magoi – Acea de Olga – Veterinaria', 7: 'Casco Histórico (Bolaño) – Barrio da Ponte', 8: 'Casco Histórico (Bolaño) – A Cheda', 9: 'Casco Histórico (Bolaño) – Abella (Casás)',
  10: 'Ramón Ferreiro – Cementerio', 11: 'Línea rural: Pías, Bóveda, Calde y Nadela', 12: 'Casco Histórico (Bolaño) – Polígono Gándaras', 13: 'Rda. Muralla (Sindicatos) – As Gándaras',
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nice = (name) => String(name).replace(/^HULA \(Ent\. Personal\).*$/i, 'Hospital (entrada de personal)').replace(/^HULA\b.*$/i, 'Hospital (HULA)');
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hhmm = (m) => { const n = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
const badge = (line) => `<span class="badge" style="--c:${esc(line.color)}">${esc(line.number)}</span>`;

// Direcciones estables: el nombre de la parada; si dos se llaman igual, con su código.
const stopSlug = new Map();
const used = new Map();
for (const s of net.stops) used.set(slug(nice(s.name)), (used.get(slug(nice(s.name))) ?? 0) + 1);
for (const s of net.stops) {
  const base = slug(nice(s.name));
  stopSlug.set(s.id, used.get(base) > 1 ? `${base}-${slug(s.code ?? s.id)}` : base);
}
const numbers = [...new Map(net.lines.map((l) => [l.number, l])).values()];
const lineSlug = (number) => slug(number);
const routeOf = (line) => ROUTES[line.number] ?? line.name;

function page({ title, description, path, body, jsonld }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${path}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:type" content="website">
<meta name="theme-color" content="#111318">
<link rel="icon" href="/demo/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/paginas.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<header class="top"><a class="brand" href="/demo/"><img src="/demo/icon.svg" width="28" height="28" alt="">Xa Vén</a><nav><a href="/lineas/">Líneas</a><a href="/paradas/">Paradas</a></nav></header>
<main>
${body}
</main>
<footer class="foot"><p>Xa Vén: los buses urbanos de Lugo. Web no oficial. Horas según el horario de cada línea: el bus puede adelantarse o retrasarse.</p><p><a href="/demo/">Abrir Xa Vén</a> · <a href="/lineas/">Todas las líneas</a> · <a href="/paradas/">Todas las paradas</a></p></footer>
</body>
</html>
`;
}

/** Tabla de horas por día: una fila por hora, los minutos en cada columna. */
function hourTable(byKind) {
  const hours = new Set();
  for (const list of Object.values(byKind)) for (const m of list) hours.add(Math.floor((((m % 1440) + 1440) % 1440) / 60));
  if (!hours.size) return '<p class="empty">Sin servicio.</p>';
  const cols = KINDS.filter(([kind]) => byKind[kind]?.length);
  const rows = [...hours].sort((a, b) => a - b).map((h) => {
    const cells = cols.map(([kind]) => {
      const mins = byKind[kind].filter((m) => Math.floor((((m % 1440) + 1440) % 1440) / 60) === h).map((m) => hhmm(m).slice(3));
      return `<td>${mins.join(' ') || '—'}</td>`;
    }).join('');
    return `<tr><th scope="row">${String(h).padStart(2, '0')}</th>${cells}</tr>`;
  }).join('');
  return `<div class="scroll"><table><thead><tr><th scope="col">Hora</th>${cols.map(([, label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function stopPage(stop) {
  const path = `/parada/${stopSlug.get(stop.id)}/`;
  const visits = [];
  for (const lineId of stop.lines) {
    const line = net.lineById.get(lineId);
    if (!line) continue;
    line.dirs.forEach((dir) => {
      const i = dir.stops.indexOf(stop.id);
      if (i === -1 || i === dir.stops.length - 1) return;
      const byKind = {};
      for (const [kind] of KINDS) {
        const svc = dir.svc[kind];
        if (svc) byKind[kind] = svc.dep.map((dep) => dep + svc.off[i]).sort((a, b) => a - b);
      }
      visits.push({ line, dir, byKind });
    });
  }
  const lineNumbers = [...new Set(visits.map((v) => v.line.number))];
  const name = nice(stop.name);
  const near = net.stops.filter((s) => s.id !== stop.id).map((s) => ({ s, m: distanceMetres(stop.lat, stop.lng, s.lat, s.lng) })).filter((x) => x.m <= 400).sort((a, b) => a.m - b.m).slice(0, 6);
  const linesList = [...new Map(visits.map((v) => [`${v.line.number}|${v.dir.dest}`, v])).values()]
    .map((v) => `<li><a href="/linea/${lineSlug(v.line.number)}/">${badge(v.line)}<span>Hacia ${esc(nice(v.dir.dest))}<small>${esc(routeOf(v.line))}</small></span></a></li>`).join('');
  const tables = visits.map((v) => `<section class="tt"><h3>${badge(v.line)} Hacia ${esc(nice(v.dir.dest))}</h3>${hourTable(v.byKind)}</section>`).join('');
  const body = `<p class="crumbs"><a href="/paradas/">Paradas</a> › ${esc(name)}</p>
<h1>${esc(name)}</h1>
<p class="sub">Parada de bus urbano en Lugo${stop.code ? ` · código ${esc(stop.code)}` : ''}${name !== stop.name ? ` · ${esc(stop.name)}` : ''}</p>
<a class="cta" href="/demo/#${esc(stop.id)}">Ver cuándo llega el próximo bus</a>
<h2>Líneas que paran aquí</h2>
${linesList ? `<ul class="lines">${linesList}</ul>` : '<p class="empty">Ninguna línea para aquí ahora mismo.</p>'}
${tables ? `<h2>Horario de paso</h2><p class="note">Horas aproximadas: salida publicada de cada línea más el tiempo de recorrido hasta esta parada.</p>${tables}` : ''}
${near.length ? `<h2>Paradas cercanas</h2><ul class="near">${near.map((x) => `<li><a href="/parada/${stopSlug.get(x.s.id)}/">${esc(nice(x.s.name))}</a> <small>a ${Math.round(x.m / 10) * 10} m</small></li>`).join('')}</ul>` : ''}`;
  return {
    path,
    html: page({
      title: `${name}: horario de buses en Lugo · Xa Vén`,
      description: `Parada ${name} de Lugo${lineNumbers.length ? `: líneas ${lineNumbers.join(', ')}` : ''}. Horario de laborables, sábados y festivos, y cuándo llega el próximo bus.`,
      path,
      body,
      jsonld: { '@context': 'https://schema.org', '@type': 'BusStop', name, identifier: stop.code ?? undefined, geo: { '@type': 'GeoCoordinates', latitude: stop.lat, longitude: stop.lng }, address: { '@type': 'PostalAddress', addressLocality: 'Lugo', addressCountry: 'ES' }, url: `${SITE}${path}` },
    }),
  };
}

function linePage(first) {
  const group = net.lines.filter((l) => l.number === first.number);
  const path = `/linea/${lineSlug(first.number)}/`;
  const route = routeOf(first);
  const facts = [...new Set(group.map((l) => [l.days, /consultar/i.test(l.frequency) ? '' : l.frequency, `de ${l.first} a ${l.last}`].filter(Boolean).join(' · ')))];
  const dirs = group.flatMap((line) => line.dirs.map((dir) => ({ line, dir })));
  const sections = dirs.map(({ line, dir }) => {
    const byKind = {};
    for (const [kind] of KINDS) {
      const svc = dir.svc[kind];
      if (svc) byKind[kind] = svc.dep.map((dep) => dep + svc.off[0]).sort((a, b) => a - b);
    }
    const svc = dir.svc.laborable ?? dir.svc.sabado ?? dir.svc.domingo;
    const stops = dir.stops.map((id, i) => {
      const s = net.stopById.get(id);
      const offset = svc ? Math.round(svc.off[i] - svc.off[0]) : null;
      return `<li><a href="/parada/${stopSlug.get(id)}/">${esc(nice(s?.name ?? id))}</a>${offset !== null && i ? ` <small>+${offset} min</small>` : ''}</li>`;
    }).join('');
    return `<section class="tt"><h2>De ${esc(nice(dir.origin))} a ${esc(nice(dir.dest))}</h2>
<h3>Salidas desde ${esc(nice(dir.origin))}</h3>${hourTable(byKind)}
<h3>Paradas (${dir.stops.length})</h3><ol class="stops">${stops}</ol></section>`;
  }).join('');
  const body = `<p class="crumbs"><a href="/lineas/">Líneas</a> › Línea ${esc(first.number)}</p>
<h1>${badge(first)} Línea ${esc(first.number)}</h1>
<p class="sub">${esc(route)}</p>
<p class="facts">${facts.map(esc).join('<br>')}</p>
<a class="cta" href="/demo/">Ver dónde están sus buses ahora</a>
${sections}`;
  return {
    path,
    html: page({
      title: `Línea ${first.number} del bus urbano de Lugo: ${route} · horario y paradas`,
      description: `Línea ${first.number} de los buses urbanos de Lugo (${route}): horario de salidas, todas sus paradas y dónde va el bus ahora.`,
      path,
      body,
    }),
  };
}

function indexPages() {
  const stops = [...net.stops].sort((a, b) => nice(a.name).localeCompare(nice(b.name), 'es'));
  const byLetter = new Map();
  for (const s of stops) {
    const letter = nice(s.name).normalize('NFD')[0].toUpperCase();
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter).push(s);
  }
  const stopsBody = `<h1>Paradas de bus de Lugo</h1>
<p class="sub">Las ${net.stops.length} paradas de los buses urbanos, con su horario y las líneas que pasan.</p>
<a class="cta" href="/demo/">Buscar mi parada en el mapa</a>
${[...byLetter].map(([letter, list]) => `<h2>${esc(letter)}</h2><ul class="near">${list.map((s) => `<li><a href="/parada/${stopSlug.get(s.id)}/">${esc(nice(s.name))}</a></li>`).join('')}</ul>`).join('')}`;
  const linesBody = `<h1>Líneas de bus urbano de Lugo</h1>
<p class="sub">Las ${numbers.length} líneas, con su horario, sus paradas y dónde están sus buses ahora.</p>
<a class="cta" href="/demo/">Ver los buses en el mapa</a>
<ul class="lines">${numbers.map((l) => `<li><a href="/linea/${lineSlug(l.number)}/">${badge(l)}<span>${esc(routeOf(l))}<small>${esc(l.days)}</small></span></a></li>`).join('')}</ul>`;
  return [
    { path: '/paradas/', html: page({ title: 'Paradas de bus de Lugo: horarios · Xa Vén', description: `Todas las paradas de los buses urbanos de Lugo, con su horario y las líneas que pasan.`, path: '/paradas/', body: stopsBody }) },
    { path: '/lineas/', html: page({ title: 'Líneas de bus urbano de Lugo: horarios y paradas · Xa Vén', description: 'Las líneas de los buses urbanos de Lugo: horarios, paradas y dónde está cada bus ahora.', path: '/lineas/', body: linesBody }) },
  ];
}

const pages = [...net.stops.map(stopPage), ...numbers.map(linePage), ...indexPages()];
for (const dir of ['parada', 'linea', 'paradas', 'lineas']) rmSync(join(APP, dir), { recursive: true, force: true });
for (const p of pages) {
  const dir = join(APP, p.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), p.html);
}
const urls = ['/demo/', ...pages.map((p) => p.path)];
writeFileSync(join(APP, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
writeFileSync(join(APP, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`${pages.length} páginas, sitemap con ${urls.length} direcciones`);
