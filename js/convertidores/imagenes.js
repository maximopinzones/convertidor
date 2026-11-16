// Conversión de imágenes. Todo ocurre en el dispositivo, usando un <canvas>.
import * as libs from '../libs.js';

export const FORMATOS = {
  jpg: { nombre: 'JPG', mime: 'image/jpeg', calidad: true },
  png: { nombre: 'PNG', mime: 'image/png' },
  webp: { nombre: 'WEBP', mime: 'image/webp', calidad: true },
  gif: { nombre: 'GIF', mime: 'image/gif' },
  bmp: { nombre: 'BMP', mime: 'image/bmp' },
  ico: { nombre: 'ICO', mime: 'image/x-icon' },
};

const EXT_IMAGEN = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'ico', 'heic', 'heif', 'avif'];
export const extension = (nombre) => (nombre.includes('.') ? nombre.split('.').pop().toLowerCase() : '');
export const esImagen = (f) => EXT_IMAGEN.includes(extension(f.name)) || /^image\/(?!svg)/.test(f.type);
export const esHeic = (f) => ['heic', 'heif'].includes(extension(f.name)) || /hei[cf]/.test(f.type);

// El iPhone no deja crear lienzos de más de ~16 megapíxeles
const esIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const AREA_MAXIMA = esIOS ? 16_000_000 : 100_000_000;

// Abre el archivo como imagen lista para dibujar
async function abrir(archivo) {
  if (esHeic(archivo)) {
    // Safari abre HEIC por sí solo; los demás navegadores necesitan la librería
    try { return await createImageBitmap(archivo); } catch {}
    const { heicTo } = await libs.heic();
    return heicTo({ blob: archivo, type: 'bitmap' });
  }
  try {
    return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    // Respaldo con una etiqueta <img>
    const url = URL.createObjectURL(archivo);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error('No se pudo abrir la imagen. Puede estar dañada o no ser un formato compatible.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function lienzo(fuente, ancho, alto, fondoBlanco) {
  const c = document.createElement('canvas');
  c.width = ancho;
  c.height = alto;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('El dispositivo no tiene memoria suficiente para esta imagen.');
  ctx.imageSmoothingQuality = 'high';
  if (fondoBlanco) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ancho, alto); }
  ctx.drawImage(fuente, 0, 0, ancho, alto);
  return c;
}

const aBlob = (c, mime, calidad) => new Promise((listo) => c.toBlob(listo, mime, calidad));

// ---------- Formatos que el navegador no sabe guardar por sí solo ----------

async function aWebp(c, calidad) {
  // Chrome y Android guardan WEBP directamente; Safari devuelve un PNG, y entonces se usa la librería
  const directo = globalThis.__forzarWebpLibreria ? null : await aBlob(c, 'image/webp', calidad);
  if (directo && directo.type === 'image/webp') return directo;
  const { default: codificar } = await libs.webp();
  const datos = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const bytes = await codificar(datos, { quality: Math.round(calidad * 100) });
  return new Blob([bytes], { type: 'image/webp' });
}

async function aGif(c) {
  const { GIFEncoder, quantize, applyPalette } = await libs.gifenc();
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  let transparente = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) { transparente = true; break; }
  // GIF solo admite 256 colores: se elige la mejor paleta para esta imagen
  const formato = transparente ? 'rgba4444' : 'rgb565';
  const paleta = quantize(data, 256, { format: formato, oneBitAlpha: transparente });
  const indices = applyPalette(data, paleta, formato);
  const opciones = { palette: paleta };
  if (transparente) {
    const i = paleta.findIndex((color) => color[3] === 0);
    if (i >= 0) { opciones.transparent = true; opciones.transparentIndex = i; }
  }
  const gif = GIFEncoder();
  gif.writeFrame(indices, c.width, c.height, opciones);
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

// BMP de 24 bits, el más compatible. Se escribe a mano: cabecera + píxeles de abajo hacia arriba.
function aBmp(c) {
  const { width: w, height: h } = c;
  const { data } = c.getContext('2d').getImageData(0, 0, w, h);
  const fila = (w * 3 + 3) & ~3; // cada fila se rellena hasta un múltiplo de 4 bytes
  const total = 54 + fila * h;
  const bytes = new Uint8Array(total);
  const v = new DataView(bytes.buffer);
  bytes[0] = 0x42; bytes[1] = 0x4d;      // "BM"
  v.setUint32(2, total, true);
  v.setUint32(10, 54, true);             // dónde empiezan los píxeles
  v.setUint32(14, 40, true);             // tamaño de la cabecera de información
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);              // planos
  v.setUint16(28, 24, true);             // bits por píxel
  v.setUint32(34, fila * h, true);
  v.setInt32(38, 2835, true);            // 72 ppp
  v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * fila;
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      bytes[o++] = data[i + 2]; // azul
      bytes[o++] = data[i + 1]; // verde
      bytes[o++] = data[i];     // rojo
    }
  }
  return new Blob([bytes], { type: 'image/bmp' });
}

// ICO con varios tamaños dentro (16 a 256 px), cada uno guardado como PNG
async function aIco(fuente) {
  const lado = Math.max(fuente.width, fuente.height);
  let tamanos = [16, 32, 48, 64, 128, 256].filter((t) => t <= lado);
  if (!tamanos.length) tamanos = [16];
  const pngs = [];
  for (const t of tamanos) {
    const c = document.createElement('canvas');
    c.width = c.height = t;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    // La imagen se centra dentro del cuadrado, sin deformarla
    const escala = t / lado;
    const w = Math.max(1, Math.round(fuente.width * escala));
    const h = Math.max(1, Math.round(fuente.height * escala));
    ctx.drawImage(fuente, Math.round((t - w) / 2), Math.round((t - h) / 2), w, h);
    pngs.push(new Uint8Array(await (await aBlob(c, 'image/png')).arrayBuffer()));
  }
  const cabecera = new Uint8Array(6 + 16 * pngs.length);
  const v = new DataView(cabecera.buffer);
  v.setUint16(2, 1, true);               // tipo: ícono
  v.setUint16(4, pngs.length, true);
  let posicion = cabecera.length;
  pngs.forEach((png, i) => {
    const o = 6 + i * 16;
    cabecera[o] = tamanos[i] === 256 ? 0 : tamanos[i];     // 0 significa 256
    cabecera[o + 1] = tamanos[i] === 256 ? 0 : tamanos[i];
    v.setUint16(o + 4, 1, true);         // planos
    v.setUint16(o + 6, 32, true);        // bits por píxel
    v.setUint32(o + 8, png.length, true);
    v.setUint32(o + 12, posicion, true);
    posicion += png.length;
  });
  return { blob: new Blob([cabecera, ...pngs], { type: 'image/x-icon' }), lado: tamanos[tamanos.length - 1] };
}

// ---------- Conversión principal ----------
// opciones: { formato: 'jpg' | 'png' | …, calidad: 0.1–1, ladoMax: píxeles o 0 }
export async function convertirImagen(archivo, { formato, calidad = 0.85, ladoMax = 0 }) {
  const fuente = await abrir(archivo);
  const avisos = [];
  try {
    if (formato === 'ico') {
      const { blob, lado } = await aIco(fuente);
      return { blob, ancho: lado, alto: lado, anchoOriginal: fuente.width, altoOriginal: fuente.height, avisos };
    }

    let escala = 1;
    const lado = Math.max(fuente.width, fuente.height);
    if (ladoMax && lado > ladoMax) escala = ladoMax / lado;
    if (fuente.width * fuente.height * escala * escala > AREA_MAXIMA) {
      escala = Math.sqrt(AREA_MAXIMA / (fuente.width * fuente.height));
      avisos.push('La imagen es muy grande para este dispositivo: se redujo para poder procesarla.');
    }
    const ancho = Math.max(1, Math.round(fuente.width * escala));
    const alto = Math.max(1, Math.round(fuente.height * escala));

    // JPG y BMP no tienen transparencia: se pone fondo blanco
    const c = lienzo(fuente, ancho, alto, formato === 'jpg' || formato === 'bmp');
    let blob;
    if (formato === 'jpg') blob = await aBlob(c, 'image/jpeg', calidad);
    else if (formato === 'png') blob = await aBlob(c, 'image/png');
    else if (formato === 'webp') blob = await aWebp(c, calidad);
    else if (formato === 'gif') {
      blob = await aGif(c);
      if (archivo.type === 'image/gif') avisos.push('Si el GIF original era animado, solo se conserva la primera imagen.');
    } else if (formato === 'bmp') blob = aBmp(c);
    else throw new Error('Formato de salida no compatible.');

    c.width = c.height = 0; // libera la memoria del lienzo
    if (!blob) throw new Error('El dispositivo no pudo crear la imagen. Prueba con un tamaño menor.');
    return { blob, ancho, alto, anchoOriginal: fuente.width, altoOriginal: fuente.height, avisos };
  } finally {
    if (fuente.close) fuente.close();
  }
}
