// Carga de librerías solo cuando se necesitan.
// Están dentro de la carpeta "lib" del proyecto, así funcionan sin conexión.

const cargadas = {};

// Para librerías "clásicas", que al cargarse dejan una variable global (window.Papa, window.XLSX)
function guion(url, global) {
  if (!cargadas[url]) {
    cargadas[url] = new Promise((listo, fallo) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => listo(window[global]);
      s.onerror = () => {
        delete cargadas[url];
        fallo(new Error('No se pudo cargar una parte de la app. Conéctate a internet una vez y vuelve a intentarlo.'));
      };
      document.head.appendChild(s);
    });
  }
  return cargadas[url];
}

// Para librerías modernas (módulos)
async function modulo(url) {
  try {
    return await import(url);
  } catch {
    throw new Error('No se pudo cargar una parte de la app. Conéctate a internet una vez y vuelve a intentarlo.');
  }
}

export const papa = () => guion('lib/papaparse.js', 'Papa');   // CSV
export const xlsx = () => guion('lib/xlsx.js', 'XLSX');         // Excel
export const marked = () => modulo('../lib/marked.js');         // Markdown
export const gifenc = () => modulo('../lib/gifenc.js');         // GIF
export const heic = () => modulo('../lib/heic-to.js');          // HEIC (fotos del iPhone)
export const webp = () => modulo('../lib/webp/encode.js');      // WEBP
export const fflate = () => modulo('../lib/fflate.js');         // ZIP

// PDF
export const pdflib = () => guion('lib/pdf-lib.js', 'PDFLib');  // crear y modificar PDF
let pdfjsListo;
export function pdfjs() {                                        // dibujar páginas de PDF
  if (!pdfjsListo) {
    pdfjsListo = modulo('../lib/pdfjs/pdf.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('../lib/pdfjs/pdf.worker.mjs', import.meta.url).href;
      return m;
    });
    pdfjsListo.catch(() => { pdfjsListo = null; });
  }
  return pdfjsListo;
}
