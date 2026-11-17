// Service Worker del Convertidor.
// Guarda TODA la app (incluidas las librerías) para que funcione sin conexión.
//
// Estrategia: "primero la copia guardada, y se actualiza por detrás".
// La app abre al instante con lo guardado y, si hay internet, descarga la
// versión nueva en segundo plano. La próxima vez que se abra ya es la nueva.

const CACHE = 'convertidor-v2';

const ARCHIVOS = [
  './',
  'index.html',
  'estilos.css',
  'manifest.json',
  'iconos/icono-192.png',
  'iconos/icono-512.png',
  'iconos/apple-touch-icon.png',
  'js/app.js',
  'js/libs.js',
  'js/descargas.js',
  'js/convertidores/imagenes.js',
  'js/convertidores/datos.js',
  'js/convertidores/pdf.js',
  'lib/papaparse.js',
  'lib/xlsx.js',
  'lib/marked.js',
  'lib/gifenc.js',
  'lib/fflate.js',
  'lib/heic-to.js',
  'lib/webp/encode.js',
  'lib/webp/meta.js',
  'lib/webp/utils.js',
  'lib/webp/codec/enc/webp_enc.js',
  'lib/webp/codec/enc/webp_enc.wasm',
  'lib/pdf-lib.js',
  'lib/pdfjs/pdf.mjs',
  'lib/pdfjs/pdf.worker.mjs',
  'lib/pdfjs/standard_fonts/FoxitDingbats.pfb',
  'lib/pdfjs/standard_fonts/FoxitFixed.pfb',
  'lib/pdfjs/standard_fonts/FoxitFixedBold.pfb',
  'lib/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb',
  'lib/pdfjs/standard_fonts/FoxitFixedItalic.pfb',
  'lib/pdfjs/standard_fonts/FoxitSerif.pfb',
  'lib/pdfjs/standard_fonts/FoxitSerifBold.pfb',
  'lib/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb',
  'lib/pdfjs/standard_fonts/FoxitSerifItalic.pfb',
  'lib/pdfjs/standard_fonts/FoxitSymbol.pfb',
  'lib/pdfjs/standard_fonts/LiberationSans-Bold.ttf',
  'lib/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf',
  'lib/pdfjs/standard_fonts/LiberationSans-Italic.ttf',
  'lib/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
  'lib/pdfjs/standard_fonts/LICENSE_FOXIT',
  'lib/pdfjs/standard_fonts/LICENSE_LIBERATION',
];

// Al instalarse: guarda todos los archivos
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Al activarse: borra cachés de versiones anteriores
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const pedido = e.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const guardado = await cache.match(pedido, { ignoreSearch: true });
      const deRed = fetch(pedido, { cache: 'no-cache' })
        .then((resp) => {
          if (resp.ok) cache.put(pedido, resp.clone());
          return resp;
        })
        .catch(() => null);
      if (guardado) {
        e.waitUntil(deRed); // sigue actualizando aunque ya se haya respondido
        return guardado;
      }
      return (await deRed) || new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })
  );
});
