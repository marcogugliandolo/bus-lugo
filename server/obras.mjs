// Xa Vén: los avisos de obras y cambios en las líneas.
//
// Se escriben a mano en app/demo/data/obras.json. Este módulo vuelve a leer ese fichero de GitHub
// cada 10 minutos, así un cambio guardado en GitHub sale en la web sin reiniciar nada. Si el
// fichero nuevo tiene un error, se sigue enseñando el último que estaba bien.
// La web se encarga de las fechas: lo que aún no empieza o ya ha caducado no se ve.
import { readFile } from 'node:fs/promises';
import { reply } from './red.mjs';

const MAX_SIZE = 64 * 1024;
const MAX_ITEMS = 30;

/** Comprueba la forma del fichero. Devuelve la lista o lanza un error que se pueda leer en los registros. */
export function checkWorks(text) {
  if (text.length > MAX_SIZE) throw new Error('el fichero es demasiado grande');
  let data;
  try { data = JSON.parse(text); } catch (err) { throw new Error(`no es JSON válido (${err.message})`); }
  if (!data || !Array.isArray(data.avisos)) throw new Error('falta la lista "avisos"');
  if (data.avisos.length > MAX_ITEMS) throw new Error(`hay más de ${MAX_ITEMS} avisos`);
  data.avisos.forEach((a, i) => {
    const where = `aviso ${i + 1}`;
    if (!a || typeof a !== 'object') throw new Error(`${where}: no es un aviso`);
    if (typeof a.titulo?.es !== 'string' || !a.titulo.es.trim()) throw new Error(`${where}: falta titulo.es`);
    for (const field of ['desde', 'hasta', 'actualizado']) {
      if (a[field] && !/^\d{4}-\d{2}-\d{2}$/.test(a[field])) throw new Error(`${where}: "${field}" tiene que ser AAAA-MM-DD`);
    }
    if (a.lineas !== undefined && !Array.isArray(a.lineas)) throw new Error(`${where}: "lineas" tiene que ser una lista`);
  });
  return data.avisos;
}

export function createWorks({ repo = null, branch = 'main', token = '', file = null, fetchImpl = fetch } = {}) {
  let works = null;
  let at = 0;

  async function load() {
    if (file) return readFile(file, 'utf8');
    if (!repo) return null;
    const url = `https://api.github.com/repos/${repo}/contents/app/demo/data/obras.json?ref=${encodeURIComponent(branch)}`;
    const headers = { Accept: 'application/vnd.github.raw', 'User-Agent': 'xa-ven' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
    return res.text();
  }

  async function tick() {
    try {
      const text = await load();
      if (text == null) return;
      works = checkWorks(text);
      at = Date.now();
    } catch (err) {
      console.warn(`[obras] no se ha podido leer obras.json: ${err.message}. Sigo con ${works ? 'el anterior' : 'el de la web'}.`);
    }
  }

  async function handle(req, res, path) {
    if (path !== '/api/obras' || req.method !== 'GET') return false;
    if (file) await tick();
    // Sin copia propia, la web usa la que trae consigo.
    return reply(res, 200, { avisos: works, at: at || null }, 60);
  }

  return { handle, tick };
}
