// Avisos de obras y cambios: vienen de data/obras.json (o de la copia fresca que da el servidor).
// Aquí se decide cuáles se ven hoy, para que un aviso viejo no se quede colgado.

/** Si no tiene fecha de fin, un aviso se quita solo a los 60 días de su última actualización. */
export const STALE_DAYS = 60;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const pick = (value, lang) => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return String(value[lang] || value.es || '').trim();
};

/** Los avisos que tocan hoy (`today` en AAAA-MM-DD), ya en el idioma de la web. Lo mal escrito se salta. */
export function activeWorks(list, today, lang = 'es') {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const title = pick(item.titulo, lang);
    if (!title) continue;
    const from = DAY.test(item.desde ?? '') ? item.desde : null;
    const until = DAY.test(item.hasta ?? '') ? item.hasta : null;
    const updated = DAY.test(item.actualizado ?? '') ? item.actualizado : from;
    if (from && today < from) continue;
    if (until && today > until) continue;
    if (!until && updated && today > addDays(updated, STALE_DAYS)) continue;
    const lines = Array.isArray(item.lineas) ? item.lineas.map((x) => String(x).trim()).filter(Boolean) : [];
    out.push({ title, body: pick(item.texto, lang), lines, updated, until });
  }
  return out;
}

/** La fecha de hoy en el móvil, AAAA-MM-DD. */
export function localToday(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
