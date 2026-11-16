// Convertidor — pantalla principal: lista de archivos, ajustes, conversión y descargas.
import { FORMATOS, esImagen, extension, convertirImagen } from './convertidores/imagenes.js';
import { FORMATOS_DATOS, destinosDatos, convertirDatos } from './convertidores/datos.js';
import { descargar, puedeCompartir, compartir, crearZip } from './descargas.js';

const $ = (id) => document.getElementById(id);
// Evita que un nombre de archivo se interprete como HTML
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TODOS = { ...FORMATOS, ...FORMATOS_DATOS };
const VISIBLES_EN_NAVEGADOR = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'ico', 'avif'];

// Cada elemento: { id, archivo, clase: 'imagen' | 'datos' | 'otro', destinos, destino,
//                  estado: 'pendiente' | 'convirtiendo' | 'hecho' | 'error', resultado, … }
let items = [];
let siguienteId = 1;
let convirtiendo = false;
const ajustes = { formato: 'jpg', calidad: 0.85, ladoMax: 0 };

// ---------- Utilidades ----------
function tamano(bytes) {
  const unidades = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < unidades.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString('es', { maximumFractionDigits: i < 2 ? 0 : 1 })} ${unidades[i]}`;
}

let relojAviso;
function aviso(texto) {
  const a = $('aviso');
  a.textContent = texto;
  a.classList.add('ver');
  clearTimeout(relojAviso);
  relojAviso = setTimeout(() => a.classList.remove('ver'), 2800);
}

const liberar = (it) => {
  for (const u of [it.urlOriginal, it.urlResultado]) if (u) URL.revokeObjectURL(u);
  it.urlOriginal = it.urlResultado = null;
};

// Deja el elemento listo para convertirse de nuevo (por ejemplo, al cambiar un ajuste)
function reiniciar(it) {
  if (it.urlResultado) URL.revokeObjectURL(it.urlResultado);
  Object.assign(it, { estado: it.destinos.length ? 'pendiente' : 'error', resultado: null, urlResultado: null, avisos: [], vista: '', abierto: false });
}

// ---------- Añadir archivos ----------
function agregar(lista) {
  for (const archivo of lista) {
    let clase = 'otro', destinos = [];
    if (esImagen(archivo)) { clase = 'imagen'; destinos = Object.keys(FORMATOS); }
    else if (destinosDatos(archivo.name).length) { clase = 'datos'; destinos = destinosDatos(archivo.name); }
    const it = {
      id: siguienteId++, archivo, clase, destinos,
      destino: clase === 'imagen' ? ajustes.formato : destinos[0],
      estado: destinos.length ? 'pendiente' : 'error',
      mensaje: destinos.length ? '' : 'Formato no compatible todavía',
      resultado: null, avisos: [], vista: '', abierto: false,
      urlOriginal: clase === 'imagen' ? URL.createObjectURL(archivo) : null, urlResultado: null,
    };
    items.push(it);
  }
  pintar();
}

// ---------- Conversión ----------
// Nombre del archivo de salida, sin repetir nombres dentro de la lista
function nombreSalida(it) {
  const base = it.archivo.name.replace(/\.[^.]+$/, '') || 'archivo';
  let nombre = `${base}.${it.destino}`;
  const usados = new Set(items.filter((x) => x !== it && x.nombreSalida).map((x) => x.nombreSalida.toLowerCase()));
  for (let i = 2; usados.has(nombre.toLowerCase()); i++) nombre = `${base} (${i}).${it.destino}`;
  return nombre;
}

async function convertirUno(it) {
  it.estado = 'convirtiendo';
  pintar();
  // Pausa mínima para que la pantalla alcance a mostrar el avance
  await new Promise((r) => setTimeout(r, 30));
  try {
    const r = it.clase === 'imagen'
      ? await convertirImagen(it.archivo, { formato: it.destino, calidad: ajustes.calidad, ladoMax: ajustes.ladoMax })
      : await convertirDatos(it.archivo, it.destino);
    it.nombreSalida = '';
    Object.assign(it, { estado: 'hecho', resultado: r.blob, avisos: r.avisos || [], vista: r.vista || '', medidas: r });
    it.nombreSalida = nombreSalida(it);
    if (it.clase === 'imagen') it.urlResultado = URL.createObjectURL(r.blob);
  } catch (e) {
    it.estado = 'error';
    it.mensaje = e && e.message ? e.message : 'No se pudo convertir';
  }
}

async function convertirTodo() {
  if (convirtiendo) return;
  convirtiendo = true;
  const pendientes = items.filter((it) => it.estado === 'pendiente');
  let hechos = 0;
  $('progreso').hidden = false;
  $('progresoBarra').style.width = '0%';
  for (const it of pendientes) {
    if (!items.includes(it) || it.estado !== 'pendiente') continue; // se quitó o cambió mientras tanto
    await convertirUno(it);
    $('progresoBarra').style.width = `${(++hechos / pendientes.length) * 100}%`;
    pintar();
  }
  convirtiendo = false;
  setTimeout(() => { $('progreso').hidden = true; }, 500);
  pintar();
  const fallos = pendientes.filter((it) => it.estado === 'error').length;
  if (pendientes.length) aviso(fallos ? `Listo, con ${fallos} error${fallos > 1 ? 'es' : ''}` : 'Conversión terminada');
}

// ---------- Dibujar la pantalla ----------
function miniatura(it) {
  const ext = extension(it.archivo.name).slice(0, 4) || '?';
  return it.clase === 'imagen' && VISIBLES_EN_NAVEGADOR.includes(extension(it.archivo.name))
    ? `<img class="mini" src="${it.urlOriginal}" alt="" loading="lazy" decoding="async" data-ext="${esc(ext)}">`
    : `<div class="mini">${esc(ext)}</div>`;
}

function detalle(it) {
  const original = tamano(it.archivo.size);
  if (it.estado === 'error') return `<div class="detalle mal">${esc(it.mensaje)}</div>`;
  if (it.estado === 'convirtiendo') return `<div class="detalle">${original} · convirtiendo…</div>`;
  if (it.estado !== 'hecho') return `<div class="detalle">${original}</div>`;
  const cambio = it.archivo.size ? Math.round((it.resultado.size / it.archivo.size - 1) * 100) : 0;
  const signo = cambio > 0 ? `<span class="mas">+${cambio} %</span>` : `<span class="menos">${cambio === 0 ? '0' : '−' + Math.abs(cambio)} %</span>`;
  // El porcentaje solo tiene sentido en imágenes; en datos cambia el formato, no el "peso"
  if (it.clase !== 'imagen') return `<div class="detalle">${original} → <b>${tamano(it.resultado.size)}</b></div>`;
  return `<div class="detalle">${original} → <b>${tamano(it.resultado.size)}</b> ${signo} · ${it.medidas.ancho} × ${it.medidas.alto} px</div>`;
}

function comparacion(it) {
  if (it.clase !== 'imagen') return `<pre class="vista-texto">${esc(it.vista)}</pre>`;
  const sePuedeVer = VISIBLES_EN_NAVEGADOR.includes(extension(it.archivo.name));
  const m = it.medidas;
  return `<div class="comparar">
    <figure>
      <figcaption><b>Original</b><span>${m.anchoOriginal} × ${m.altoOriginal} · ${tamano(it.archivo.size)}</span></figcaption>
      <div class="marco">${sePuedeVer ? `<img src="${it.urlOriginal}" alt="Imagen original">` : 'Este navegador no muestra este formato'}</div>
    </figure>
    <figure>
      <figcaption><b>Resultado</b><span>${m.ancho} × ${m.alto} · ${tamano(it.resultado.size)}</span></figcaption>
      <div class="marco"><img src="${it.urlResultado}" alt="Imagen convertida"></div>
    </figure>
  </div>`;
}

function fila(it) {
  const opciones = it.destinos.map((d) => `<option value="${d}"${d === it.destino ? ' selected' : ''}>${esc(TODOS[d].nombre)}</option>`).join('');
  const hecho = it.estado === 'hecho';
  return `<li data-id="${it.id}">
    <div class="fila">
      ${miniatura(it)}
      <div class="cuerpo">
        <div class="nombre" title="${esc(it.archivo.name)}">${esc(hecho ? it.nombreSalida : it.archivo.name)}</div>
        ${detalle(it)}
      </div>
      ${it.destinos.length ? `<label class="destino"><select data-accion="destino" aria-label="Convertir a"${it.estado === 'convirtiendo' ? ' disabled' : ''}>${opciones}</select></label>` : ''}
      <button class="quitar" data-accion="quitar" type="button" aria-label="Quitar ${esc(it.archivo.name)}">×</button>
    </div>
    ${it.estado === 'convirtiendo' ? '<div class="trabajando"></div>' : ''}
    ${it.avisos.length ? `<div class="avisos">${it.avisos.map(esc).join('<br>')}</div>` : ''}
    ${hecho ? `<div class="fila-acciones">
      <button class="boton chico" data-accion="descargar" type="button">Descargar</button>
      ${puedeCompartir(it.resultado, it.nombreSalida) ? '<button class="boton chico" data-accion="compartir" type="button">Compartir</button>' : ''}
      <button class="boton chico" data-accion="ver" type="button">${it.abierto ? 'Ocultar' : it.clase === 'imagen' ? 'Comparar' : 'Vista previa'}</button>
    </div>` : ''}
    ${hecho && it.abierto ? comparacion(it) : ''}
  </li>`;
}

function pintar() {
  const hayItems = items.length > 0;
  const imagenes = items.filter((it) => it.clase === 'imagen');
  $('panelLista').hidden = !hayItems;
  $('barra').hidden = !hayItems;
  $('ajustes').hidden = !imagenes.length;
  $('campoCalidad').hidden = !imagenes.some((it) => FORMATOS[it.destino].calidad);

  const hechos = items.filter((it) => it.estado === 'hecho');
  const pendientes = items.filter((it) => it.estado === 'pendiente').length;
  let resumen = `${items.length} archivo${items.length === 1 ? '' : 's'}`;
  if (hechos.length) {
    const antes = hechos.reduce((s, it) => s + it.archivo.size, 0);
    const despues = hechos.reduce((s, it) => s + it.resultado.size, 0);
    resumen += ` · ${tamano(antes)} → ${tamano(despues)}`;
  }
  $('resumen').textContent = resumen;
  $('lista').innerHTML = items.map(fila).join('');

  $('btnConvertir').disabled = convirtiendo || !pendientes;
  $('btnConvertir').textContent = convirtiendo ? 'Convirtiendo…' : pendientes ? `Convertir ${pendientes}` : 'Convertido';
  $('btnZip').disabled = convirtiendo || hechos.length < 1;
  $('btnZip').textContent = hechos.length === 1 ? 'Descargar' : 'Descargar todo (.zip)';
}

// ---------- Eventos de la lista ----------
$('lista').addEventListener('click', async (e) => {
  const boton = e.target.closest('[data-accion]');
  if (!boton || boton.tagName === 'SELECT') return;
  const it = items.find((x) => x.id === Number(boton.closest('li').dataset.id));
  if (!it) return;
  const accion = boton.dataset.accion;
  if (accion === 'quitar') {
    liberar(it);
    items = items.filter((x) => x !== it);
  } else if (accion === 'descargar') {
    descargar(it.resultado, it.nombreSalida);
  } else if (accion === 'compartir') {
    try { await compartir(it.resultado, it.nombreSalida); } catch { aviso('No se pudo compartir'); }
    return;
  } else if (accion === 'ver') {
    it.abierto = !it.abierto;
  }
  pintar();
});

$('lista').addEventListener('change', (e) => {
  if (e.target.dataset.accion !== 'destino') return;
  const it = items.find((x) => x.id === Number(e.target.closest('li').dataset.id));
  if (!it) return;
  it.destino = e.target.value;
  reiniciar(it);
  pintar();
});

// Si una miniatura no se puede mostrar, se cambia por la extensión del archivo
$('lista').addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.classList.contains('mini')) return;
  const caja = document.createElement('div');
  caja.className = 'mini';
  caja.textContent = img.dataset.ext || '?';
  img.replaceWith(caja);
}, true);

// ---------- Ajustes de imagen ----------
$('selFormato').innerHTML = Object.entries(FORMATOS).map(([k, f]) => `<option value="${k}">${f.nombre}</option>`).join('');

$('selFormato').addEventListener('change', (e) => {
  ajustes.formato = e.target.value;
  for (const it of items) if (it.clase === 'imagen') { it.destino = ajustes.formato; reiniciar(it); }
  pintar();
});

const reiniciarImagenes = () => {
  for (const it of items) if (it.clase === 'imagen' && it.estado !== 'convirtiendo') reiniciar(it);
  pintar();
};

$('inCalidad').addEventListener('input', (e) => { $('valCalidad').textContent = e.target.value; });
$('inCalidad').addEventListener('change', (e) => { ajustes.calidad = Number(e.target.value) / 100; reiniciarImagenes(); });
$('inLado').addEventListener('change', (e) => {
  const n = Math.floor(Number(e.target.value));
  ajustes.ladoMax = n >= 16 ? Math.min(n, 20000) : 0;
  e.target.value = ajustes.ladoMax || '';
  reiniciarImagenes();
});

// ---------- Botones principales ----------
$('btnConvertir').addEventListener('click', convertirTodo);

$('btnZip').addEventListener('click', async () => {
  const hechos = items.filter((it) => it.estado === 'hecho');
  if (!hechos.length) return;
  if (hechos.length === 1) return descargar(hechos[0].resultado, hechos[0].nombreSalida);
  $('btnZip').disabled = true;
  $('btnZip').textContent = 'Preparando ZIP…';
  try {
    const zip = await crearZip(hechos.map((it) => ({ nombre: it.nombreSalida, blob: it.resultado })));
    descargar(zip, 'convertidos.zip');
  } catch (e) {
    aviso(e.message || 'No se pudo crear el ZIP');
  }
  pintar();
});

$('btnVaciar').addEventListener('click', () => {
  if (convirtiendo) return aviso('Espera a que termine la conversión');
  items.forEach(liberar);
  items = [];
  pintar();
});

$('btnFotos').addEventListener('click', () => $('inFotos').click());
$('btnArchivos').addEventListener('click', () => $('inArchivos').click());
for (const id of ['inFotos', 'inArchivos']) {
  $(id).addEventListener('change', (e) => {
    agregar([...e.target.files]);
    e.target.value = ''; // permite volver a elegir el mismo archivo
  });
}

// ---------- Arrastrar y soltar ----------
let arrastres = 0;
const traeArchivos = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!traeArchivos(e)) return;
  e.preventDefault();
  arrastres++;
  $('cortina').classList.add('ver');
});
window.addEventListener('dragover', (e) => { if (traeArchivos(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => {
  arrastres = Math.max(0, arrastres - 1);
  if (!arrastres) $('cortina').classList.remove('ver');
});
window.addEventListener('drop', (e) => {
  if (!traeArchivos(e)) return;
  e.preventDefault();
  arrastres = 0;
  $('cortina').classList.remove('ver');
  agregar([...e.dataTransfer.files]);
});

// También se puede pegar una imagen copiada (Ctrl + V)
window.addEventListener('paste', (e) => {
  const archivos = [...(e.clipboardData ? e.clipboardData.files : [])];
  if (archivos.length) agregar(archivos);
});

// ---------- Modo sin conexión ----------
function ponerEstado(texto, listo) {
  $('estadoTexto').textContent = texto;
  $('estado').classList.toggle('listo', !!listo);
}

async function prepararSinConexion() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) {
    return ponerEstado('Sin conexión no disponible aquí', false);
  }
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready; // se cumple cuando todo quedó guardado
    const actualizar = () => ponerEstado(navigator.onLine ? 'Funciona sin conexión' : 'Sin conexión · funcionando', true);
    actualizar();
    window.addEventListener('online', actualizar);
    window.addEventListener('offline', actualizar);
  } catch {
    ponerEstado('Sin conexión no disponible', false);
  }
}

pintar();
prepararSinConexion();
