// Conversión de archivos de datos: CSV, JSON, Excel y Markdown.
import * as libs from '../libs.js';

const ext = (nombre) => (nombre.includes('.') ? nombre.split('.').pop().toLowerCase() : '');

const GRUPOS = {
  csv: ['csv', 'tsv'],
  json: ['json'],
  excel: ['xlsx', 'xls', 'ods'],
  texto: ['md', 'markdown', 'txt'],
};
const grupoDe = (nombre) => Object.keys(GRUPOS).find((g) => GRUPOS[g].includes(ext(nombre))) || null;

export const FORMATOS_DATOS = {
  csv: { nombre: 'CSV', mime: 'text/csv' },
  json: { nombre: 'JSON', mime: 'application/json' },
  xlsx: { nombre: 'Excel (XLSX)', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  html: { nombre: 'HTML', mime: 'text/html' },
};

// A qué se puede convertir cada archivo
export function destinosDatos(nombre) {
  return { csv: ['xlsx', 'json'], json: ['csv', 'xlsx'], excel: ['csv', 'json'], texto: ['html'] }[grupoDe(nombre)] || [];
}

// Lee el archivo como texto. Los CSV guardados por Excel en Windows no suelen
// venir en UTF-8: si la lectura falla, se intenta con la codificación de Windows.
async function leerTexto(archivo) {
  const bytes = await archivo.arrayBuffer();
  let texto;
  try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { texto = new TextDecoder('windows-1252').decode(bytes); }
  return texto.replace(/^﻿/, '');
}

// "12" → 12, pero "0412" o "007" se quedan como texto (teléfonos, cédulas, códigos)
const tipar = (v) => (typeof v === 'string' && v.length < 16 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) ? Number(v) : v);

async function csvATabla(archivo) {
  const Papa = await libs.papa();
  const r = Papa.parse(await leerTexto(archivo), { skipEmptyLines: 'greedy' });
  if (!r.data.length) throw new Error('El archivo CSV está vacío.');
  return r.data;
}

function tablaAObjetos(tabla) {
  const [cabecera, ...filas] = tabla;
  const columnas = cabecera.map((c, i) => String(c).trim() || `columna${i + 1}`);
  return filas.map((f) => Object.fromEntries(columnas.map((c, i) => [c, tipar(f[i] ?? '')])));
}

// Convierte cualquier JSON en una lista de filas (objetos planos)
function jsonAFilas(texto) {
  let datos;
  try { datos = JSON.parse(texto); } catch { throw new Error('El archivo JSON tiene un error de formato.'); }
  if (!Array.isArray(datos)) {
    // { "clientes": [ … ] } → se usa esa lista
    const listas = datos && typeof datos === 'object' ? Object.values(datos).filter(Array.isArray) : [];
    datos = listas.length === 1 ? listas[0] : [datos];
  }
  if (!datos.length) throw new Error('El JSON no contiene filas.');
  const filas = datos.map((d) => (d && typeof d === 'object' && !Array.isArray(d) ? d : { valor: d }));
  const columnas = [...new Set(filas.flatMap((f) => Object.keys(f)))];
  // Los valores que son listas u objetos se guardan como texto JSON dentro de la celda
  const plano = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? '');
  return { columnas, filas: filas.map((f) => Object.fromEntries(columnas.map((c) => [c, plano(f[c])]))) };
}

async function leerExcel(archivo) {
  const XLSX = await libs.xlsx();
  let libro;
  try { libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array', cellDates: true }); }
  catch { throw new Error('No se pudo abrir la hoja de cálculo.'); }
  const avisos = [];
  const nombreHoja = libro.SheetNames[0];
  if (libro.SheetNames.length > 1) {
    avisos.push(`El libro tiene ${libro.SheetNames.length} hojas: se convirtió solo la primera («${nombreHoja}»).`);
  }
  return { XLSX, hoja: libro.Sheets[nombreHoja], avisos };
}

async function escribirExcel(hojaDesde) {
  const XLSX = await libs.xlsx();
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hojaDesde(XLSX), 'Datos');
  return XLSX.write(libro, { type: 'array', bookType: 'xlsx', compression: true });
}

// Página HTML completa y legible a partir del Markdown convertido
function paginaHtml(titulo, cuerpo) {
  const t = titulo.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; line-height: 1.6; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  pre, code { font-family: Consolas, ui-monospace, monospace; background: #f2f2f0; border-radius: 4px; }
  pre { padding: 12px; overflow: auto; } code { padding: 1px 4px; } pre code { padding: 0; }
  table { border-collapse: collapse; } th, td { border: 1px solid #ddd; padding: 6px 10px; }
  img { max-width: 100%; } blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 16px; color: #555; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #eee; } pre, code { background: #222; } th, td { border-color: #333; } }
</style>
</head>
<body>
${cuerpo}
</body>
</html>
`;
}

const texto = (contenido, destino) => new Blob([contenido], { type: `${FORMATOS_DATOS[destino].mime};charset=utf-8` });
const recorte = (t) => (t.length > 3000 ? t.slice(0, 3000) + '\n…' : t);

// ---------- Conversión principal ----------
// Devuelve { blob, vista (texto para previsualizar), avisos }
export async function convertirDatos(archivo, destino) {
  const origen = grupoDe(archivo.name);
  const avisos = [];

  if (origen === 'texto' && destino === 'html') {
    const { marked } = await libs.marked();
    const html = paginaHtml(archivo.name.replace(/\.[^.]+$/, ''), marked.parse(await leerTexto(archivo)));
    return { blob: texto(html, 'html'), vista: recorte(html), avisos };
  }

  if (origen === 'csv') {
    const tabla = await csvATabla(archivo);
    if (destino === 'json') {
      const json = JSON.stringify(tablaAObjetos(tabla), null, 2);
      return { blob: texto(json, 'json'), vista: recorte(json), avisos };
    }
    if (destino === 'xlsx') {
      const bytes = await escribirExcel((XLSX) => XLSX.utils.aoa_to_sheet(tabla.map((f) => f.map(tipar))));
      return { blob: new Blob([bytes], { type: FORMATOS_DATOS.xlsx.mime }), vista: `Hoja de cálculo · ${tabla.length} filas × ${tabla[0].length} columnas`, avisos };
    }
  }

  if (origen === 'json') {
    const { columnas, filas } = jsonAFilas(await leerTexto(archivo));
    if (destino === 'csv') {
      const Papa = await libs.papa();
      // "﻿" al inicio hace que Excel muestre bien los acentos y la ñ
      const csv = Papa.unparse({ fields: columnas, data: filas });
      return { blob: texto('﻿' + csv, 'csv'), vista: recorte(csv), avisos };
    }
    if (destino === 'xlsx') {
      const bytes = await escribirExcel((XLSX) => XLSX.utils.json_to_sheet(filas, { header: columnas }));
      return { blob: new Blob([bytes], { type: FORMATOS_DATOS.xlsx.mime }), vista: `Hoja de cálculo · ${filas.length + 1} filas × ${columnas.length} columnas`, avisos };
    }
  }

  if (origen === 'excel') {
    const { XLSX, hoja, avisos: a } = await leerExcel(archivo);
    avisos.push(...a);
    if (!hoja || !hoja['!ref']) throw new Error('La hoja de cálculo está vacía.');
    if (destino === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(hoja);
      return { blob: texto('﻿' + csv, 'csv'), vista: recorte(csv), avisos };
    }
    if (destino === 'json') {
      const json = JSON.stringify(XLSX.utils.sheet_to_json(hoja, { defval: '' }), null, 2);
      return { blob: texto(json, 'json'), vista: recorte(json), avisos };
    }
  }

  throw new Error('Esta conversión no es compatible.');
}
