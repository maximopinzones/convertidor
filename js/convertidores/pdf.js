// Operaciones con PDF. Dos librerías, cada una para lo suyo:
//  - pdf-lib: crear y modificar PDF (unir, separar, rotar, meter imágenes).
//  - pdf.js:  "dibujar" las páginas de un PDF para convertirlas en imágenes.
import * as libs from '../libs.js';
import { convertirImagen } from './imagenes.js';
import { crearZip } from '../descargas.js';

export const esPdf = (f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';

// Opciones que aparecen en el selector de cada PDF
export const FORMATOS_PDF = {
  'pdf-jpg': { nombre: 'Imágenes JPG' },
  'pdf-png': { nombre: 'Imágenes PNG' },
  'pdf-separar': { nombre: 'Separar páginas' },
  'pdf-extraer': { nombre: 'Extraer páginas' },
  'pdf-derecha': { nombre: 'Rotar a la derecha' },
  'pdf-izquierda': { nombre: 'Rotar a la izquierda' },
  'pdf-180': { nombre: 'Girar 180°' },
  'pdf-comprimir': { nombre: 'Comprimir' },
  pdf: { nombre: 'PDF' }, // para imágenes y textos
};
export const DESTINOS_DE_PDF = Object.keys(FORMATOS_PDF).filter((k) => k !== 'pdf');

// Calidad al dibujar páginas: escala (nitidez) y calidad JPG
export const CALIDADES = {
  alta: { nombre: 'Alta', escala: 2, jpg: 0.85 },
  media: { nombre: 'Media', escala: 1.5, jpg: 0.7 },
  baja: { nombre: 'Baja', escala: 1, jpg: 0.5 },
};

const MIME_PDF = 'application/pdf';
const ANCHO_A4 = 595.28, ALTO_A4 = 841.89; // tamaño A4 en puntos
const dosCifras = (n, total) => String(n).padStart(String(total).length, '0');
const aBlob = (c, mime, calidad) => new Promise((listo) => c.toBlob(listo, mime, calidad));

// ---------- Abrir ----------
async function abrir(archivo) {
  const { PDFDocument } = await libs.pdflib();
  try {
    return await PDFDocument.load(await archivo.arrayBuffer());
  } catch (e) {
    if (/encrypt/i.test(String(e && e.message))) throw new Error('El PDF está protegido con contraseña.');
    throw new Error('No se pudo abrir el PDF. Puede estar dañado.');
  }
}

const guardar = async (doc) => new Blob([await doc.save()], { type: MIME_PDF });

// Dibuja cada página en un lienzo y se lo pasa a "cadaPagina"
async function dibujarPaginas(archivo, escala, cadaPagina, avance) {
  const pdfjs = await libs.pdfjs();
  const tarea = pdfjs.getDocument({
    data: new Uint8Array(await archivo.arrayBuffer()),
    standardFontDataUrl: new URL('../../lib/pdfjs/standard_fonts/', import.meta.url).href,
  });
  let doc;
  try {
    doc = await tarea.promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error('El PDF está protegido con contraseña.');
    throw new Error('No se pudo abrir el PDF. Puede estar dañado.');
  }
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      if (avance) avance(`página ${n} de ${doc.numPages}`);
      const pagina = await doc.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      // Límite de 12 megapíxeles por página, para no agotar la memoria del celular
      const e = Math.min(escala, Math.sqrt(12_000_000 / (base.width * base.height)));
      const vista = pagina.getViewport({ scale: e });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(vista.width));
      c.height = Math.max(1, Math.floor(vista.height));
      await pagina.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vista }).promise;
      await cadaPagina(c, n, doc.numPages, base);
      pagina.cleanup();
      c.width = c.height = 0;
    }
  } finally {
    await tarea.destroy();
  }
}

// "1-3, 5" → [0, 1, 2, 4] (posiciones empezando en 0). Lanza un error claro si algo no cuadra.
export function leerPaginas(texto, total) {
  const limpio = String(texto || '').replace(/\s/g, '');
  if (!limpio) throw new Error('Escribe qué páginas extraer en el campo «Páginas» (por ejemplo: 1-3, 5).');
  const paginas = [];
  for (const parte of limpio.split(',').filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(parte);
    if (!m) throw new Error(`No entiendo «${parte}». Usa números y rangos, por ejemplo: 1-3, 5.`);
    const desde = Number(m[1]), hasta = Number(m[2] || m[1]);
    if (desde < 1 || hasta > total || desde > hasta) throw new Error(`El PDF tiene ${total} página${total === 1 ? '' : 's'}: «${parte}» está fuera de rango.`);
    for (let p = desde; p <= hasta; p++) paginas.push(p - 1);
  }
  return paginas;
}

// ---------- Operaciones sobre un PDF ----------
// Devuelven { blob, ext, sufijo, vista, avisos }

async function aImagenes(archivo, formato, calidad, avance) {
  const base = archivo.name.replace(/\.[^.]+$/, '');
  const mime = formato === 'png' ? 'image/png' : 'image/jpeg';
  const paginas = [];
  await dibujarPaginas(archivo, calidad.escala, async (c, n, total) => {
    paginas.push({ nombre: `${base} - página ${dosCifras(n, total)}.${formato}`, blob: await aBlob(c, mime, 0.9) });
  }, avance);
  if (paginas.length === 1) return { blob: paginas[0].blob, ext: formato, vista: '1 página convertida en imagen', avisos: [] };
  return { blob: await crearZip(paginas), ext: 'zip', sufijo: ' (imágenes)', vista: `ZIP con ${paginas.length} imágenes, una por página`, avisos: [] };
}

async function separar(archivo) {
  const { PDFDocument } = await libs.pdflib();
  const doc = await abrir(archivo);
  const total = doc.getPageCount();
  if (total < 2) throw new Error('El PDF tiene una sola página: no hay nada que separar.');
  const base = archivo.name.replace(/\.[^.]+$/, '');
  const partes = [];
  for (let i = 0; i < total; i++) {
    const nuevo = await PDFDocument.create();
    const [pagina] = await nuevo.copyPages(doc, [i]);
    nuevo.addPage(pagina);
    partes.push({ nombre: `${base} - página ${dosCifras(i + 1, total)}.pdf`, blob: await guardar(nuevo) });
  }
  return { blob: await crearZip(partes), ext: 'zip', sufijo: ' (páginas)', vista: `ZIP con ${total} PDF, uno por página`, avisos: [] };
}

async function extraer(archivo, textoPaginas) {
  const { PDFDocument } = await libs.pdflib();
  const doc = await abrir(archivo);
  const indices = leerPaginas(textoPaginas, doc.getPageCount());
  const nuevo = await PDFDocument.create();
  for (const pagina of await nuevo.copyPages(doc, indices)) nuevo.addPage(pagina);
  return { blob: await guardar(nuevo), ext: 'pdf', sufijo: ' (extracto)', vista: `${indices.length} de ${doc.getPageCount()} páginas`, avisos: [] };
}

async function rotar(archivo, grados) {
  const { degrees } = await libs.pdflib();
  const doc = await abrir(archivo);
  for (const pagina of doc.getPages()) pagina.setRotation(degrees((pagina.getRotation().angle + grados + 360) % 360));
  return { blob: await guardar(doc), ext: 'pdf', sufijo: ' (rotado)', vista: `${doc.getPageCount()} páginas rotadas`, avisos: [] };
}

// Comprimir = volver a crear el PDF con cada página convertida en una foto JPG.
// Reduce mucho los documentos escaneados, pero el texto deja de ser seleccionable.
async function comprimir(archivo, calidad, avance) {
  const { PDFDocument } = await libs.pdflib();
  const nuevo = await PDFDocument.create();
  await dibujarPaginas(archivo, calidad.escala, async (c, n, total, base) => {
    const jpg = await (await aBlob(c, 'image/jpeg', calidad.jpg)).arrayBuffer();
    const imagen = await nuevo.embedJpg(jpg);
    const pagina = nuevo.addPage([base.width, base.height]);
    pagina.drawImage(imagen, { x: 0, y: 0, width: base.width, height: base.height });
  }, avance);
  const blob = await guardar(nuevo);
  const avisos = ['Las páginas quedaron como imágenes: el texto ya no se puede seleccionar ni buscar.'];
  if (blob.size >= archivo.size) avisos.push('Este PDF ya estaba bien optimizado: el resultado no es más pequeño. Prueba con calidad Baja o conserva el original.');
  return { blob, ext: 'pdf', sufijo: ' (comprimido)', vista: `${nuevo.getPageCount()} páginas`, avisos };
}

export function convertirPdf(archivo, destino, { paginas, calidad }, avance) {
  const q = CALIDADES[calidad] || CALIDADES.media;
  switch (destino) {
    case 'pdf-jpg': return aImagenes(archivo, 'jpg', q, avance);
    case 'pdf-png': return aImagenes(archivo, 'png', q, avance);
    case 'pdf-separar': return separar(archivo);
    case 'pdf-extraer': return extraer(archivo, paginas);
    case 'pdf-derecha': return rotar(archivo, 90);
    case 'pdf-izquierda': return rotar(archivo, -90);
    case 'pdf-180': return rotar(archivo, 180);
    case 'pdf-comprimir': return comprimir(archivo, q, avance);
  }
  throw new Error('Operación no compatible.');
}

// ---------- Crear PDF a partir de otras cosas ----------

// Añade una imagen como página nueva (del ancho de un A4, sin márgenes ni deformación)
async function agregarImagen(doc, archivo, ajustes) {
  const r = await convertirImagen(archivo, { formato: 'jpg', calidad: ajustes.calidad, ladoMax: ajustes.ladoMax });
  const imagen = await doc.embedJpg(await r.blob.arrayBuffer());
  const alto = ANCHO_A4 * (r.alto / r.ancho);
  doc.addPage([ANCHO_A4, alto]).drawImage(imagen, { x: 0, y: 0, width: ANCHO_A4, height: alto });
}

export async function imagenAPdf(archivo, ajustes) {
  const { PDFDocument } = await libs.pdflib();
  const doc = await PDFDocument.create();
  await agregarImagen(doc, archivo, ajustes);
  return { blob: await guardar(doc), ext: 'pdf', vista: 'PDF de 1 página', avisos: [] };
}

// Texto simple → PDF en A4, con saltos de línea automáticos
export async function textoAPdf(archivo, textoPlano) {
  const { PDFDocument, StandardFonts } = await libs.pdflib();
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const cuerpo = 11, interlinea = 15.5, margen = 56;
  const anchoUtil = ANCHO_A4 - margen * 2;
  let cambiados = false;
  // Esta fuente solo conoce los caracteres de Europa occidental (incluye acentos y ñ)
  const escribible = (t) => [...t.replace(/\t/g, '    ')].map((ch) => {
    try { fuente.encodeText(ch); return ch; } catch { cambiados = true; return '?'; }
  }).join('');
  const lineas = [];
  for (const parrafo of textoPlano.replace(/\r/g, '').split('\n')) {
    let linea = '';
    for (const palabra of escribible(parrafo).split(' ')) {
      const prueba = linea ? `${linea} ${palabra}` : palabra;
      if (linea && fuente.widthOfTextAtSize(prueba, cuerpo) > anchoUtil) { lineas.push(linea); linea = palabra; }
      else linea = prueba;
    }
    lineas.push(linea);
  }
  let pagina = null, y = 0;
  for (const linea of lineas) {
    if (!pagina || y < margen) { pagina = doc.addPage([ANCHO_A4, ALTO_A4]); y = ALTO_A4 - margen - cuerpo; }
    if (linea) pagina.drawText(linea, { x: margen, y, size: cuerpo, font: fuente });
    y -= interlinea;
  }
  if (!pagina) doc.addPage([ANCHO_A4, ALTO_A4]);
  const avisos = cambiados ? ['Algunos símbolos (como emojis) no existen en la fuente del PDF y se cambiaron por «?».'] : [];
  return { blob: await guardar(doc), ext: 'pdf', vista: `PDF de ${doc.getPageCount()} página${doc.getPageCount() === 1 ? '' : 's'}`, avisos };
}

// Une varios archivos (PDF e imágenes) en un solo PDF, en el orden recibido
export async function unir(archivos, ajustes, avance) {
  const { PDFDocument } = await libs.pdflib();
  const doc = await PDFDocument.create();
  for (let i = 0; i < archivos.length; i++) {
    const f = archivos[i];
    if (avance) avance(`archivo ${i + 1} de ${archivos.length}`);
    try {
      if (esPdf(f)) {
        const origen = await abrir(f);
        for (const pagina of await doc.copyPages(origen, origen.getPageIndices())) doc.addPage(pagina);
      } else {
        await agregarImagen(doc, f, ajustes);
      }
    } catch (e) {
      throw new Error(`«${f.name}»: ${e.message}`);
    }
  }
  return { blob: await guardar(doc), paginas: doc.getPageCount() };
}
