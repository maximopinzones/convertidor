// Entregar los resultados: descargar, compartir (celular) y juntar todo en un ZIP.
import * as libs from './libs.js';

export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const comoArchivo = (blob, nombre) => new File([blob], nombre, { type: blob.type });

// En el celular, "Compartir" permite guardar en Fotos o mandar por WhatsApp directamente
export function puedeCompartir(blob, nombre) {
  try { return !!navigator.canShare && navigator.canShare({ files: [comoArchivo(blob, nombre)] }); }
  catch { return false; }
}

export async function compartir(blob, nombre) {
  try { await navigator.share({ files: [comoArchivo(blob, nombre)] }); }
  catch (e) { if (e.name !== 'AbortError') throw e; } // AbortError = el usuario cerró el menú
}

// entradas: [{ nombre, blob }]
export async function crearZip(entradas) {
  const { zip } = await libs.fflate();
  const contenido = {};
  for (const e of entradas) {
    // Las imágenes ya vienen comprimidas: se guardan tal cual (nivel 0) para ir más rápido
    const yaComprimido = /\.(jpe?g|png|webp|gif|xlsx|ico)$/i.test(e.nombre);
    contenido[e.nombre] = [new Uint8Array(await e.blob.arrayBuffer()), { level: yaComprimido ? 0 : 6 }];
  }
  const bytes = await new Promise((listo, fallo) => zip(contenido, (error, salida) => (error ? fallo(error) : listo(salida))));
  return new Blob([bytes], { type: 'application/zip' });
}
