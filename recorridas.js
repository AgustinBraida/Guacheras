// ============================================================
// VETFIELD PRO — recorridas.js v1.0
// Módulo de Recorridas, Auditoría y Seguimiento de Pendientes
// 100% basado en texto y control de hallazgos de campo
// ============================================================

'use strict';

const API_RECORRIDAS = 'api/recorridas.php';

// Estado local del módulo
const RecorridasState = {
    productor: '',
    establecimiento: '',
    fecha: new Date().toISOString().split('T')[0],
    categoriaSeleccionada: 'higiene',
    hallazgosHoy: [],        // Lista de hallazgos anotados en la visita activa
    pendientesAnteriores: [], // Pendientes arrastrados de visitas pasadas
    tareasResueltasHoy: [],  // Pendientes marcados como resueltos hoy
    recorridasHistorial: [],  // Historial de visitas para este establecimiento
    profesional: '',
    recorridaId: null        // ID de la recorrida de HOY en la base de datos (evita duplicados)
};

// ─── Datos de Productores y Establecimientos en Recorridas ─────
// Se cargan desde api/recorridas.php?action=get_options (tablas del sistema + recorridas)
const RecorridasOptions = {
    productores: [],           // ['Don Juan', 'Pedro López', ...]
    est_por_productor: {},     // { 'Don Juan': ['Puesto 1', 'Tambo Norte'], ... }

    // Agrega un productor localmente (cuando el user escribe uno nuevo)
    addProductor(nombre) {
        if (!nombre) return;
        nombre = nombre.trim();
        if (!this.productores.includes(nombre)) {
            this.productores.push(nombre);
            this.productores.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        }
        if (!this.est_por_productor[nombre]) this.est_por_productor[nombre] = [];
        if (Array.isArray(window.productores) && !window.productores.includes(nombre)) {
            window.productores.push(nombre);
            window.productores.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        }
    },

    // Agrega un establecimiento localmente para un productor dado
    addEstablecimiento(productor, nombre) {
        if (!productor || !nombre) return;
        nombre = nombre.trim();
        if (!this.est_por_productor[productor]) this.est_por_productor[productor] = [];
        if (!this.est_por_productor[productor].includes(nombre)) {
            this.est_por_productor[productor].push(nombre);
            this.est_por_productor[productor].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        }
        if (window.establecimientos_por_productor) {
            if (!window.establecimientos_por_productor[productor]) window.establecimientos_por_productor[productor] = [];
            if (!window.establecimientos_por_productor[productor].includes(nombre)) {
                window.establecimientos_por_productor[productor].push(nombre);
                window.establecimientos_por_productor[productor].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            }
        }
    }
};

// Carga las opciones desde el backend y las combina con el estado global de la app
async function loadRecorridasOptions() {
    try {
        const res = await apiFetchApp(`${API_RECORRIDAS}?action=get_options`, { method: 'GET' });
        if (res && res.ok) {
            RecorridasOptions.productores       = res.productores       || [];
            RecorridasOptions.est_por_productor = res.est_por_productor || {};
        }
    } catch (e) {
        console.warn('[Recorridas] No se pudo cargar opciones desde servidor.');
    }

    // Integrar con los productores cargados en la aplicación global si los hubiera
    if (Array.isArray(window.productores)) {
        window.productores.forEach(p => {
            if (p && !RecorridasOptions.productores.includes(p)) {
                RecorridasOptions.productores.push(p);
            }
        });
        RecorridasOptions.productores.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    if (window.establecimientos_por_productor && typeof window.establecimientos_por_productor === 'object') {
        for (const [prod, ests] of Object.entries(window.establecimientos_por_productor)) {
            if (!RecorridasOptions.est_por_productor[prod]) {
                RecorridasOptions.est_por_productor[prod] = [];
            }
            if (Array.isArray(ests)) {
                ests.forEach(e => {
                    if (e && !RecorridasOptions.est_por_productor[prod].includes(e)) {
                        RecorridasOptions.est_por_productor[prod].push(e);
                    }
                });
                RecorridasOptions.est_por_productor[prod].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            }
        }
    }
}

// Categorías disponibles (mutable – pueden editarse desde el gestor de categorías)
const CATEGORIAS_DEFAULT = [
    { id: 'higiene',       label: 'Higiene',       emoji: '🧽', desc: 'Baldes, comederos, leche, sarro',            visible: true },
    { id: 'alimentacion',  label: 'Alimentación',  emoji: '🥛', desc: 'Comida, agua, ración, tarritos vacíos',      visible: true },
    { id: 'bioseguridad',  label: 'Bioseguridad',  emoji: '🐀', desc: 'Ratones, desratización, plagas, moscas',     visible: true },
    { id: 'laboratorio',   label: 'Muestras/Lab',  emoji: '🧪', desc: 'Muestras de sangre, fecal, necropsias',      visible: true },
    { id: 'sanidad',       label: 'Sanidad',       emoji: '🩺', desc: 'Diarreas, respiratorio, tratamientos',       visible: true },
    { id: 'instalaciones', label: 'Instalaciones', emoji: '🔧', desc: 'Sombra, camas, roturas, reparaciones',       visible: true },
    { id: 'general',       label: 'General',       emoji: '💡', desc: 'Observaciones generales o rutina',           visible: true },
];

const CATS_LS_KEY = 'vf_categorias_recorrida_v1';

function loadCategoriasDesdeStorage() {
    try {
        const raw = localStorage.getItem(CATS_LS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch (e) { /* ignore */ }
    return CATEGORIAS_DEFAULT.map(c => ({ ...c }));
}

function saveCategoriasToStorage() {
    try { localStorage.setItem(CATS_LS_KEY, JSON.stringify(CATEGORIAS_RECORRIDA)); } catch (e) { /* ignore */ }
}

// Array activo (mutable)
let CATEGORIAS_RECORRIDA = loadCategoriasDesdeStorage();


// ─── Helpers para listas — combinan RecorridasOptions y app general ───
function getAvailableProductores() {
    const set = new Set();
    (RecorridasOptions.productores || []).forEach(p => { if (p) set.add(p.trim()); });
    if (Array.isArray(window.productores)) {
        window.productores.forEach(p => { if (p) set.add(p.trim()); });
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function getAvailableEstablecimientos(productor) {
    if (!productor) return [];
    const set = new Set();
    const listRec = RecorridasOptions.est_por_productor[productor] || [];
    listRec.forEach(e => { if (e) set.add(e.trim()); });

    if (window.establecimientos_por_productor && Array.isArray(window.establecimientos_por_productor[productor])) {
        window.establecimientos_por_productor[productor].forEach(e => { if (e) set.add(e.trim()); });
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// ─── Modal reutilizable para ingresar un nombre (reemplaza prompt) ─
function rec_showNombreModal({ titulo, subtitulo, label, placeholder, hint = '', onConfirm }) {
    let overlay = document.getElementById('rec-nombre-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'rec-nombre-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:9999',
            'display:flex', 'align-items:center', 'justify-content:center',
            'padding:1.25rem',
            'background:rgba(0,0,0,0.45)',
            'backdrop-filter:blur(6px)',
            '-webkit-backdrop-filter:blur(6px)',
            'opacity:0', 'pointer-events:none',
            'transition:opacity 0.25s ease'
        ].join(';');
        overlay.innerHTML = `
        <div class="voice-ctx-modal" role="document" style="max-width:400px;">
            <div class="voice-ctx-modal-header">
                <div class="voice-ctx-modal-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </div>
                <div>
                    <div class="voice-ctx-modal-title" id="rec-nombre-modal-title"></div>
                    <div class="voice-ctx-modal-subtitle" id="rec-nombre-modal-subtitle"></div>
                </div>
            </div>
            <div class="voice-ctx-modal-field">
                <label class="voice-ctx-modal-label" for="rec-nombre-modal-input" id="rec-nombre-modal-label"></label>
                <input id="rec-nombre-modal-input" class="voice-ctx-modal-input" type="text" autocomplete="off" spellcheck="false" />
                <div class="voice-ctx-modal-hint" id="rec-nombre-modal-hint"></div>
            </div>
            <div class="voice-ctx-modal-divider"></div>
            <div class="voice-ctx-modal-actions">
                <button class="voice-ctx-modal-btn cancel" id="rec-nombre-modal-cancel">Cancelar</button>
                <button class="voice-ctx-modal-btn save" id="rec-nombre-modal-save">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    Confirmar
                </button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
    }

    // Rellenar contenido dinámico
    document.getElementById('rec-nombre-modal-title').textContent     = titulo;
    document.getElementById('rec-nombre-modal-subtitle').textContent  = subtitulo;
    document.getElementById('rec-nombre-modal-label').textContent     = label;
    const input = document.getElementById('rec-nombre-modal-input');
    input.placeholder = placeholder;
    input.value = '';
    const hintEl = document.getElementById('rec-nombre-modal-hint');
    hintEl.textContent = hint;
    hintEl.style.display = hint ? '' : 'none';

    const btnSave   = document.getElementById('rec-nombre-modal-save');
    const btnCancel = document.getElementById('rec-nombre-modal-cancel');

    // Abrir
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'all';
    });
    const modal = overlay.querySelector('.voice-ctx-modal');
    modal.style.transform = 'translateY(18px) scale(0.97)';
    modal.style.opacity   = '0';
    modal.style.transition = 'transform 0.28s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease';
    requestAnimationFrame(() => {
        modal.style.transform = 'translateY(0) scale(1)';
        modal.style.opacity   = '1';
    });
    setTimeout(() => input.focus(), 60);

    function doConfirm() {
        const val = input.value.trim();
        if (!val) { input.focus(); return; }
        doClose();
        onConfirm(val);
    }

    function doClose() {
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        btnSave.removeEventListener('click', doConfirm);
        btnCancel.removeEventListener('click', doClose);
        overlay.removeEventListener('click', onBg);
        document.removeEventListener('keydown', onKey);
    }

    function onBg(e)  { if (e.target === overlay) doClose(); }
    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); doClose(); }
        if (e.key === 'Enter' && document.activeElement !== btnCancel) { e.preventDefault(); doConfirm(); }
    }

    btnSave.addEventListener('click', doConfirm);
    btnCancel.addEventListener('click', doClose);
    overlay.addEventListener('click', onBg);
    document.addEventListener('keydown', onKey);
}

// ─── Helper: Obtener nombre del veterinario registrado ───────
function getNombreProfesional() {
    try {
        if (typeof AuthManager !== 'undefined' && typeof AuthManager.getSession === 'function') {
            const s = AuthManager.getSession();
            if (s && (s.name || s.nombre)) return (s.name || s.nombre).trim();
        }
        const session = JSON.parse(localStorage.getItem('vetfield_session') || '{}');
        if (session && (session.name || session.nombre)) {
            return (session.name || session.nombre).trim();
        }
        const profileEl = document.getElementById('profile-display-name');
        if (profileEl && profileEl.textContent.trim()) {
            return profileEl.textContent.trim();
        }
        const editEl = document.getElementById('edit-name');
        if (editEl && editEl.value.trim()) {
            return editEl.value.trim();
        }
    } catch (e) {
        console.warn('Error al obtener nombre profesional:', e);
    }
    return 'Veterinario Actuante';
}

// ─── Inicialización de la Vista ──────────────────────────────
window.initRecorridasView = async function () {
    const today = new Date().toISOString().split('T')[0];
    const fechaInput = document.getElementById('rec_fecha');
    if (fechaInput && !fechaInput.value) {
        fechaInput.value = today;
        RecorridasState.fecha = today;
    }

    RecorridasState.profesional = getNombreProfesional();
    renderCategoriasChips();

    // Cargar los productores/establecimientos PROPIOS de recorridas (independiente de terneros)
    await loadRecorridasOptions();
    window.updateRecorridasSelects();

    if (RecorridasState.productor || RecorridasState.establecimiento) {
        onRecorridaContextChange();
    } else {
        renderPendientesAnteriores();
        renderHallazgosHoy();
        renderHistorial();
    }
};

// ─── Sincronizar Selectores de Productor / Establecimiento ────
window.updateRecorridasSelects = function () {
    const prodSelect = document.getElementById('rec_productor');
    if (!prodSelect) return;

    const currentVal = prodSelect.value || RecorridasState.productor || '';
    const prods = getAvailableProductores();

    prodSelect.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = prods.length > 0 ? '-- Seleccioná un productor --' : '-- Sin productores cargados --';
    prodSelect.appendChild(defaultOpt);

    let foundCurrent = false;
    prods.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        if (p === currentVal) {
            opt.selected = true;
            foundCurrent = true;
        }
        prodSelect.appendChild(opt);
    });

    // Opción para escribir o crear uno nuevo si hace falta
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '✏️ + Escribir nuevo productor...';
    prodSelect.appendChild(customOpt);

    if (foundCurrent) {
        prodSelect.value = currentVal;
        RecorridasState.productor = currentVal;
    }

    // Actualizar los establecimientos según el productor activo
    window.updateRecorridasEstablecimientos(prodSelect.value);
};

// ─── Evento al cambiar Productor ─────────────────────────────
window.onRecorridaProductorChange = function () {
    const prodSelect = document.getElementById('rec_productor');
    if (!prodSelect) return;

    const val = prodSelect.value;
    if (val === '__custom__') {
        // Resetear select mientras el modal está abierto
        prodSelect.value = RecorridasState.productor || '';

        rec_showNombreModal({
            titulo:      'Nuevo productor',
            subtitulo:   'Ingresá el nombre del productor',
            label:       'Nombre del productor',
            placeholder: 'Ej: Don Juan',
            onConfirm(nombre) {
                RecorridasOptions.addProductor(nombre);
                RecorridasState.productor = nombre;
                // Limpiar estado al cambiar de productor
                RecorridasState.hallazgosHoy = [];
                RecorridasState.pendientesAnteriores = [];
                RecorridasState.tareasResueltasHoy = [];
                RecorridasState.recorridasHistorial = [];
                RecorridasState.establecimiento = '';
                RecorridasState.recorridaId = null;
                renderHallazgosHoy();
                renderPendientesAnteriores();
                renderHistorial();
                window.updateRecorridasSelects();
            }
        });
        return;
    }

    // ── Limpiar SIEMPRE el estado al cambiar de productor ──────
    // Evita que observaciones del productor anterior se mezclen
    RecorridasState.hallazgosHoy = [];
    RecorridasState.pendientesAnteriores = [];
    RecorridasState.tareasResueltasHoy = [];
    RecorridasState.recorridasHistorial = [];
    RecorridasState.establecimiento = '';
    RecorridasState.recorridaId = null;
    renderHallazgosHoy();
    renderPendientesAnteriores();
    renderHistorial();

    RecorridasState.productor = val;
    window.updateRecorridasEstablecimientos(val);
};

// ─── Actualizar Desplegable de Establecimientos ──────────────
window.updateRecorridasEstablecimientos = function (productor) {
    const estSelect = document.getElementById('rec_establecimiento');
    if (!estSelect) return;

    const currentVal = estSelect.value || RecorridasState.establecimiento || '';
    estSelect.innerHTML = '';

    if (!productor) {
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- Opcional: primero seleccioná productor --';
        estSelect.appendChild(defaultOpt);
        RecorridasState.establecimiento = '';
        window.onRecorridaContextChange();
        return;
    }

    const ests = getAvailableEstablecimientos(productor);

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = ests.length > 0 ? '-- Sin establecimiento (opcional) --' : '-- Sin establecimientos para este productor (opcional) --';
    estSelect.appendChild(defaultOpt);

    let foundCurrent = false;
    ests.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e;
        opt.textContent = e;
        if (e === currentVal) {
            opt.selected = true;
            foundCurrent = true;
        }
        estSelect.appendChild(opt);
    });

    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '✏️ + Escribir nuevo tambo/campo...';
    estSelect.appendChild(customOpt);

    // Auto-selección inteligente: Si hay un único establecimiento para este productor, preseleccionarlo
    if (ests.length === 1) {
        estSelect.value = ests[0];
        RecorridasState.establecimiento = ests[0];
    } else if (foundCurrent) {
        estSelect.value = currentVal;
        RecorridasState.establecimiento = currentVal;
    } else {
        RecorridasState.establecimiento = '';
    }

    window.onRecorridaContextChange();
};

// ─── Evento al cambiar Establecimiento ───────────────────────
window.onRecorridaEstablecimientoChange = function () {
    const estSelect = document.getElementById('rec_establecimiento');
    if (!estSelect) return;

    const val = estSelect.value;
    if (val === '__custom__') {
        // Resetear select mientras el modal está abierto
        estSelect.value = RecorridasState.establecimiento || '';

        rec_showNombreModal({
            titulo:      'Nuevo tambo / establecimiento',
            subtitulo:   `Para el productor: ${RecorridasState.productor || '—'}`,
            label:       'Nombre del establecimiento o tambo',
            placeholder: 'Ej: Tambo Norte, Puesto 2',
            hint:        '',
            onConfirm(nombre) {
                RecorridasOptions.addEstablecimiento(RecorridasState.productor, nombre);

                // Agregar opción al select y seleccionarla
                const opt = document.createElement('option');
                opt.value = nombre;
                opt.textContent = nombre;
                estSelect.insertBefore(opt, estSelect.lastElementChild);
                estSelect.value = nombre;

                RecorridasState.establecimiento = nombre;
                window.onRecorridaContextChange();
            }
        });
        return;
    }

    RecorridasState.establecimiento = val;
    window.onRecorridaContextChange();
};

// ─── Cambio de Contexto (recargar datos) ──────────────────────
window.onRecorridaContextChange = async function () {
    const prodEl = document.getElementById('rec_productor');
    const estEl = document.getElementById('rec_establecimiento');
    const fechaEl = document.getElementById('rec_fecha');

    RecorridasState.productor = prodEl ? prodEl.value.trim() : '';
    RecorridasState.establecimiento = estEl ? estEl.value.trim() : '';
    RecorridasState.fecha = fechaEl ? (fechaEl.value || new Date().toISOString().split('T')[0]) : '';

    if (!RecorridasState.productor && !RecorridasState.establecimiento) {
        RecorridasState.pendientesAnteriores = [];
        RecorridasState.hallazgosHoy = [];
        RecorridasState.recorridasHistorial = [];
        RecorridasState.recorridaId = null;
        renderPendientesAnteriores();
        renderHallazgosHoy();
        renderHistorial();
        return;
    }

    // Cargar datos locales / remotos
    await cargarDatosEstablecimiento(RecorridasState.productor, RecorridasState.establecimiento);
};

// ─── Cargar Pendientes e Historial ───────────────────────────
async function cargarDatosEstablecimiento(productor, establecimiento) {
    // 1. Intentar cargar desde el backend
    let remotasCargadas = false;
    try {
        const url = `${API_RECORRIDAS}?action=list&establecimiento=${encodeURIComponent(establecimiento || '')}&productor=${encodeURIComponent(productor || '')}`;
        const res = await apiFetchApp(url, { method: 'GET' });
        if (res && res.ok && Array.isArray(res.recorridas)) {
            RecorridasState.recorridasHistorial = res.recorridas;
            remotasCargadas = true;
            // Guardar copia offline
            guardarRecorridasLocal(res.recorridas);
        }
    } catch (e) {
        console.warn('[Recorridas] Sin conexión al servidor, usando datos locales.');
    }

    // 2. Fallback a LocalStorage si falló la API
    if (!remotasCargadas) {
        const todasLocales = getRecorridasLocal();
        RecorridasState.recorridasHistorial = todasLocales.filter(r => {
            const matchProd = !productor || ((r.productor || '').toLowerCase() === productor.toLowerCase());
            const matchEst = establecimiento 
                ? ((r.establecimiento || '').toLowerCase() === establecimiento.toLowerCase())
                : (!r.establecimiento || r.establecimiento === '');
            return matchProd && matchEst;
        });
    }

    // 3. Extraer pendientes activos de visitas anteriores (anteriores a hoy)
    const fechaHoy = RecorridasState.fecha;
    const pendientes = [];
    const hallazgosDeHoy = [];
    let recorridaIdHoy = null;

    RecorridasState.recorridasHistorial.forEach(rec => {
        const esHoy = (rec.fecha === fechaHoy);
        const items = Array.isArray(rec.hallazgos) ? rec.hallazgos : [];

        if (esHoy) {
            // Capturar el ID de la recorrida de hoy para no duplicar en futuros saves
            if (!recorridaIdHoy && rec.id) recorridaIdHoy = rec.id;
            // Si ya existía una recorrida guardada para la fecha de hoy, recuperamos sus hallazgos
            items.forEach(it => {
                if (!hallazgosDeHoy.some(h => h.id === it.id)) {
                    hallazgosDeHoy.push(it);
                }
            });
        } else {
            // Es una visita pasada -> extraer pendientes que sigan abiertos
            items.forEach(it => {
                const esPend = !!it.es_pendiente;
                const est = it.estado || 'pendiente';
                if (esPend && (est === 'pendiente' || est === 'reincidente')) {
                    pendientes.push({
                        ...it,
                        recorrida_id: rec.id,
                        fecha_origen: rec.fecha,
                        dias_abierto: calcularDiasDiferencia(rec.fecha, fechaHoy)
                    });
                }
            });
        }
    });

    // Guardar el ID de la recorrida de hoy en el state para que el próximo save haga UPDATE
    RecorridasState.recorridaId = recorridaIdHoy;

    RecorridasState.pendientesAnteriores = pendientes;
    // Siempre reemplazamos los hallazgos de hoy con la fuente autoritativa
    // (backend o localStorage). Esto garantiza que los borrados persistan
    // y que nunca se mezclen datos de otro productor/establecimiento.
    RecorridasState.hallazgosHoy = hallazgosDeHoy;

    renderPendientesAnteriores();
    renderHallazgosHoy();
    renderHistorial();
}

// ─── Renderizar Chips de Categorías ──────────────────────────
function renderCategoriasChips() {
    const container = document.getElementById('rec-categories-container');
    if (!container) return;

    const visibles = CATEGORIAS_RECORRIDA.filter(c => c.visible !== false);

    // Asegurar que la categoría seleccionada sea válida
    if (!visibles.find(c => c.id === RecorridasState.categoriaSeleccionada)) {
        RecorridasState.categoriaSeleccionada = visibles[0]?.id || 'general';
    }

    container.innerHTML = visibles.map(cat => `
        <button type="button" 
                class="rec-chip-btn ${RecorridasState.categoriaSeleccionada === cat.id ? 'active' : ''}" 
                onclick="seleccionarCategoriaRecorrida('${cat.id}', this)"
                title="${cat.desc || cat.label}">
            <span>${cat.emoji}</span>
            <span>${cat.label}</span>
        </button>
    `).join('') + `
        <button type="button" class="rec-chip-btn rec-chip-manage" onclick="abrirGestionCategoriasModal()" title="Gestionar categorías">
            <span>⚙️</span>
            <span>Gestionar</span>
        </button>
    `;
}


window.seleccionarCategoriaRecorrida = function (catId, btn) {
    RecorridasState.categoriaSeleccionada = catId;
    document.querySelectorAll('.rec-chip-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    // Cambiar placeholder dinámicamente según la categoría
    const txtArea = document.getElementById('rec_texto_hallazgo');
    if (txtArea) {
        const cat = CATEGORIAS_RECORRIDA.find(c => c.id === catId);
        txtArea.placeholder = `Escribí tu observación de ${cat ? cat.label : ''} (ej: ${cat ? cat.desc : ''})...`;
        txtArea.focus();
    }
};

// ─── Renderizar Pendientes de Visitas Anteriores (¡Solución Ratones!) ───
function renderPendientesAnteriores() {
    const section = document.getElementById('rec-pendientes-section');
    const list = document.getElementById('rec-pendientes-list');
    const badge = document.getElementById('rec-pendientes-count');

    if (!section || !list) return;

    const pendientes = RecorridasState.pendientesAnteriores;

    if (pendientes.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    if (badge) badge.textContent = `${pendientes.length} pendiente${pendientes.length > 1 ? 's' : ''}`;

    // Agrupar por fecha_origen (más antigua primero)
    const grupos = {};
    pendientes.forEach(item => {
        const fecha = item.fecha_origen || 'sin-fecha';
        if (!grupos[fecha]) grupos[fecha] = [];
        grupos[fecha].push(item);
    });
    const fechasOrdenadas = Object.keys(grupos).sort((a, b) => a.localeCompare(b));

    list.innerHTML = fechasOrdenadas.map(fecha => {
        const items = grupos[fecha];
        const diasAbierto = items[0].dias_abierto ?? 0;
        const diasTxt = diasAbierto === 0 ? 'hoy mismo' : `hace ${diasAbierto} día${diasAbierto > 1 ? 's' : ''}`;

        const itemsHtml = items.map(item => {
            const catObj = CATEGORIAS_RECORRIDA.find(c => c.id === item.categoria) || { emoji: '📌', label: item.categoria };
            const esResuelto = item.estado === 'resuelto';
            const reincidencias = item.visitas_reincidente || 0;

            return `
                <div class="rec-pending-card ${esResuelto ? 'resuelto-hoy' : ''}" id="card-pending-${item.id}">
                    <div class="rec-pending-top">
                        <span class="rec-category-tag tag-${item.categoria}">
                            ${catObj.emoji} ${catObj.label}
                        </span>
                        ${reincidencias > 0 ? `<span style="font-size:0.72rem;font-weight:700;color:#dc2626;">🚨 ${reincidencias} reiteración${reincidencias > 1 ? 'es' : ''}</span>` : ''}
                    </div>
                    <div class="rec-pending-text">${escapeHtml(item.texto)}</div>
                    <div class="rec-pending-actions">
                        ${esResuelto ? `
                            <span style="font-size:0.78rem;font-weight:700;color:#16a34a;display:inline-flex;align-items:center;gap:4px;">
                                ✓ Marcado como Resuelto hoy
                            </span>
                            <button type="button" class="rec-btn-discard" onclick="deshacerResolucion('${item.id}')" title="Deshacer">Deshacer</button>
                        ` : `
                            <button type="button" class="rec-btn-resolve" onclick="resolverPendiente('${item.id}', '${item.recorrida_id}')">
                                ✓ Marcar Resuelto
                            </button>
                            <button type="button" class="rec-btn-reincide" onclick="reiterarPendiente('${item.id}', '${item.recorrida_id}')">
                                ⚠️ Sigue Pendiente
                            </button>
                        `}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="rec-pending-date-group">
                <div class="rec-pending-date-header">
                    <span class="rec-pending-date-label">📅 ${formatearFechaLocal(fecha)}</span>
                    <span class="rec-pending-date-age">${diasTxt} &nbsp;·&nbsp; ${items.length} observación${items.length > 1 ? 'es' : ''}</span>
                </div>
                <div class="rec-pending-date-items">${itemsHtml}</div>
            </div>
        `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
}

// ─── Resolver Pendiente ──────────────────────────────────────
window.resolverPendiente = async function (hallazgoId, recorridaId) {
    const pend = RecorridasState.pendientesAnteriores.find(p => p.id === hallazgoId);
    if (!pend) return;

    pend.estado = 'resuelto';
    pend.fecha_resolucion = RecorridasState.fecha;

    // Agregar a la lista de tareas resueltas hoy para que aparezca en el acta y WhatsApp
    if (!RecorridasState.tareasResueltasHoy.some(t => t.id === hallazgoId)) {
        RecorridasState.tareasResueltasHoy.push({
            id: hallazgoId,
            texto: pend.texto,
            categoria: pend.categoria,
            fecha_origen: pend.fecha_origen
        });
    }

    renderPendientesAnteriores();
    renderHallazgosHoy();

    // Actualizar en backend si está disponible
    if (recorridaId) {
        apiFetchApp(API_RECORRIDAS, {
            method: 'POST',
            body: JSON.stringify({
                action: 'update_status',
                recorrida_id: recorridaId,
                hallazgo_id: hallazgoId,
                nuevo_estado: 'resuelto'
            })
        }).catch(err => console.warn('Error al actualizar status:', err));
    }
};

window.deshacerResolucion = function (hallazgoId) {
    const pend = RecorridasState.pendientesAnteriores.find(p => p.id === hallazgoId);
    if (!pend) return;

    pend.estado = 'pendiente';
    delete pend.fecha_resolucion;

    RecorridasState.tareasResueltasHoy = RecorridasState.tareasResueltasHoy.filter(t => t.id !== hallazgoId);

    renderPendientesAnteriores();
    renderHallazgosHoy();
};

// ─── Reiterar Pendiente (Sigue estando el problema de los ratones) ───
window.reiterarPendiente = async function (hallazgoId, recorridaId) {
    const pend = RecorridasState.pendientesAnteriores.find(p => p.id === hallazgoId);
    if (!pend) return;

    pend.estado = 'reincidente';
    pend.visitas_reincidente = (pend.visitas_reincidente || 0) + 1;
    pend.ultima_verificacion = RecorridasState.fecha;

    // Notificación visual de reiteración
    const card = document.getElementById(`card-pending-${hallazgoId}`);
    if (card) {
        card.classList.add('is-reincidente');
    }

    // Lo agregamos automáticamente como nota reiterada en la visita de hoy
    const yaExisteEnHoy = RecorridasState.hallazgosHoy.some(h => h.id === `reit_${hallazgoId}`);
    if (!yaExisteEnHoy) {
        RecorridasState.hallazgosHoy.push({
            id: `reit_${hallazgoId}`,
            texto: `[REINCIDENTE] Sigue sin resolverse: ${pend.texto}`,
            categoria: pend.categoria,
            es_pendiente: true,
            estado: 'reincidente',
            visitas_reincidente: pend.visitas_reincidente,
            fecha_creacion: RecorridasState.fecha
        });
    }

    renderPendientesAnteriores();
    renderHallazgosHoy();

    if (recorridaId) {
        apiFetchApp(API_RECORRIDAS, {
            method: 'POST',
            body: JSON.stringify({
                action: 'update_status',
                recorrida_id: recorridaId,
                hallazgo_id: hallazgoId,
                nuevo_estado: 'reincidente'
            })
        }).catch(err => console.warn('Error al actualizar status:', err));
    }
};

// ─── Agregar Observación de Hoy (100% Texto de Campo) ─────────
window.agregarObservacionHoy = function () {
    const txtArea = document.getElementById('rec_texto_hallazgo');
    const chkUrgente = document.getElementById('rec_chk_urgente');

    if (!RecorridasState.productor && !RecorridasState.establecimiento) {
        alert('Por favor seleccioná al menos un Productor antes de registrar una observación.');
        document.getElementById('rec_productor')?.focus();
        return;
    }

    const texto = txtArea ? txtArea.value.trim() : '';
    if (!texto) {
        alert('Escribí el detalle de la observación.');
        txtArea?.focus();
        return;
    }

    const nuevoHallazgo = {
        id: 'h_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        categoria: RecorridasState.categoriaSeleccionada,
        texto: texto,
        es_pendiente: true,
        urgente: chkUrgente ? chkUrgente.checked : false,
        estado: 'pendiente',
        fecha_creacion: RecorridasState.fecha
    };

    RecorridasState.hallazgosHoy.push(nuevoHallazgo);

    // Limpiar input y mensaje de corrección
    if (txtArea) txtArea.value = '';
    if (chkUrgente) chkUrgente.checked = false;
    const fbMain = document.getElementById('rec-spell-feedback-main');
    if (fbMain) fbMain.style.display = 'none';
    txtArea?.focus();

    renderHallazgosHoy();
    autoGuardarRecorrida();
};

// ─── Renderizar Hallazgos de la Recorrida Actual ──────────────
function renderHallazgosHoy() {
    const list = document.getElementById('rec-items-list');
    const countEl = document.getElementById('rec-today-count');
    const actionsBar = document.getElementById('rec-actions-bar');

    if (!list) return;

    const items = RecorridasState.hallazgosHoy;

    // Clasificar entre pendientes y resueltas de la visita
    const pendientes = [];
    const resueltasHoy = [];

    items.forEach((it, idx) => {
        if (it.estado === 'resuelto') {
            resueltasHoy.push({ it, idx });
        } else {
            pendientes.push({ it, idx });
        }
    });

    const totalActivos = pendientes.length;
    const totalResueltos = resueltasHoy.length + RecorridasState.tareasResueltasHoy.length;

    if (countEl) {
        if (totalActivos > 0) {
            countEl.textContent = `${totalActivos} pendiente${totalActivos === 1 ? '' : 's'}`;
        } else if (totalResueltos > 0) {
            countEl.textContent = `0 pendientes (${totalResueltos} en historial)`;
        } else {
            countEl.textContent = '0 registros';
        }
    }

    if (actionsBar) {
        actionsBar.style.display = (items.length > 0 || RecorridasState.tareasResueltasHoy.length > 0) ? 'grid' : 'none';
    }

    if (pendientes.length === 0) {
        if (totalResueltos > 0) {
            list.innerHTML = `
                <div class="rec-empty-state" style="padding:1.5rem 1rem;">
                    <div style="font-size:2.2rem;margin-bottom:0.4rem;">✅</div>
                    <div style="font-weight:700;font-size:0.95rem;color:var(--text-main);">Todas las observaciones de hoy están resueltas</div>
                    <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.35rem;">
                        Las ${totalResueltos} observación${totalResueltos === 1 ? '' : 'es'} resuelta${totalResueltos === 1 ? '' : 's'} pasaron al <strong>Historial de Recorridas</strong> abajo.
                    </div>
                </div>
            `;
        } else {
            list.innerHTML = `
                <div class="rec-empty-state">
                    <div style="font-size:2rem;margin-bottom:0.5rem;">📝</div>
                    <div>Aún no registraste observaciones en esta recorrida.</div>
                    <div style="font-size:0.78rem;opacity:0.7;margin-top:0.25rem;">Escribí arriba y presioná "+ Agregar a la Recorrida".</div>
                </div>
            `;
        }
        return;
    }

    let html = '';

    // 1. Mostrar hallazgos activos / pendientes de hoy (agrupados por categoría/tema)
    if (pendientes.length > 0) {
        // Agrupar pendientes por categoría
        const gruposCat = {};
        pendientes.forEach(p => {
            const catId = p.it.categoria || 'general';
            if (!gruposCat[catId]) gruposCat[catId] = [];
            gruposCat[catId].push(p);
        });

        // Ordenar respetando CATEGORIAS_RECORRIDA
        const categoriasOrdenadas = CATEGORIAS_RECORRIDA
            .filter(c => gruposCat[c.id])
            .map(c => c.id);

        Object.keys(gruposCat).forEach(cId => {
            if (!categoriasOrdenadas.includes(cId)) categoriasOrdenadas.push(cId);
        });

        categoriasOrdenadas.forEach(catId => {
            const itemsCat = gruposCat[catId];
            const catObj = CATEGORIAS_RECORRIDA.find(c => c.id === catId) || { emoji: '📌', label: catId };

            html += `
                <div class="rec-cat-group">
                    <div class="rec-cat-group-header">
                        <div class="rec-cat-group-title">
                            <span>${catObj.emoji}</span>
                            <span>${catObj.label}</span>
                        </div>
                        <span class="rec-cat-group-count">
                            ${itemsCat.length} observación${itemsCat.length === 1 ? '' : 'es'}
                        </span>
                    </div>
                    <div class="rec-cat-group-items">
            `;

            html += itemsCat.map(({ it, idx }) => {
                const esUrgente = it.urgente;

                return `
                    <div class="rec-item-card is-pending ${it.estado === 'reincidente' ? 'is-reincidente' : ''}">
                        <div class="rec-item-header">
                            <div class="rec-item-meta">
                                ${esUrgente ? '<span class="rec-badge-urgent">🚨 URGENTE</span>' : ''}
                                <span class="rec-status-tag is-pending">
                                    <span class="rec-status-dot"></span>
                                    <span>Pendiente</span>
                                </span>
                            </div>
                            <div class="rec-item-actions-cluster">
                                <button type="button" class="rec-action-btn rec-btn-resolve" onclick="marcarHallazgoResuelto(${idx})" title="Marcar como realizada / resuelta (pasa abajo al historial)">
                                    <i data-lucide="check" style="width:13px;height:13px;"></i>
                                    <span>Resuelta</span>
                                </button>
                                <button type="button" class="rec-action-btn rec-btn-edit" onclick="abrirEditarHallazgoModal(${idx})" title="Editar observación">
                                    <i data-lucide="pencil" style="width:13px;height:13px;"></i>
                                    <span>Editar</span>
                                </button>
                                <button type="button" class="rec-action-btn rec-btn-delete" onclick="confirmarEliminarHallazgoHoy(${idx})" title="Eliminar observación">
                                    <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
                                    <span>Borrar</span>
                                </button>
                            </div>
                        </div>
                        <div class="rec-item-text">${escapeHtml(it.texto)}</div>
                    </div>
                `;
            }).join('');

            html += `
                    </div>
                </div>
            `;
        });
    }

    list.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
}

// ─── Acciones de Hallazgos de Hoy ─────────────────────────────
window.marcarHallazgoResuelto = function (idx) {
    if (idx < 0 || idx >= RecorridasState.hallazgosHoy.length) return;
    const it = RecorridasState.hallazgosHoy[idx];
    it.estado = 'resuelto';
    it.es_pendiente = false;
    it.fecha_resolucion = RecorridasState.fecha;

    if (!RecorridasState.tareasResueltasHoy.some(t => t.id === it.id)) {
        RecorridasState.tareasResueltasHoy.push({
            id: it.id,
            categoria: it.categoria,
            texto: it.texto,
            fecha_origen: it.fecha_creacion || RecorridasState.fecha,
            fecha_resolucion: RecorridasState.fecha
        });
    }

    renderHallazgosHoy();
    autoGuardarRecorrida();

    // Desplegar automáticamente hoy en el historial abajo para confirmar visualmente
    setTimeout(() => {
        const hToday = RecorridasState.recorridasHistorial.find(r => r.fecha === RecorridasState.fecha);
        if (hToday && hToday.id) {
            const detailEl = document.getElementById(`rec-detail-${hToday.id}`);
            if (detailEl && !detailEl.classList.contains('open')) {
                detailEl.classList.add('open');
            }
        }
    }, 100);
};

window.reabrirHallazgoHoy = function (idx) {
    if (idx < 0 || idx >= RecorridasState.hallazgosHoy.length) return;
    const it = RecorridasState.hallazgosHoy[idx];
    it.estado = 'pendiente';
    it.es_pendiente = true;
    delete it.fecha_resolucion;

    RecorridasState.tareasResueltasHoy = RecorridasState.tareasResueltasHoy.filter(t => t.id !== it.id);

    renderHallazgosHoy();
    autoGuardarRecorrida();
};

// ─── Modal de Confirmación y Eliminación de Observación ───────
window.confirmarEliminarHallazgoHoy = function (index) {
    if (index < 0 || index >= RecorridasState.hallazgosHoy.length) return;
    const it = RecorridasState.hallazgosHoy[index];
    const catObj = CATEGORIAS_RECORRIDA.find(c => c.id === it.categoria) || { emoji: '📌', label: it.categoria };

    let overlay = document.getElementById('rec-delete-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'rec-delete-modal-overlay';
        overlay.className = 'rec-modal-overlay';
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div class="rec-modal-card is-delete" role="dialog" aria-modal="true" aria-labelledby="rec-del-title">
            <div class="rec-modal-icon is-danger">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            </div>
            <h3 class="rec-modal-title" id="rec-del-title" style="font-size:1.2rem;">¿Eliminar observación?</h3>
            <p class="rec-modal-subtitle" style="margin-top:0.35rem;">
                Se eliminará permanentemente de la recorrida actual y de todo el historial.
            </p>

            <div class="rec-modal-preview-box">
                <div style="font-size:0.75rem;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">
                    ${catObj.emoji} ${catObj.label.toUpperCase()}
                </div>
                <div>${escapeHtml(it.texto)}</div>
            </div>

            <div class="rec-modal-actions" style="justify-content:center;gap:0.75rem;margin-top:1rem;">
                <button type="button" class="rec-modal-btn cancel" onclick="cerrarEliminarModal()">
                    Cancelar
                </button>
                <button type="button" class="rec-modal-btn delete-confirm" onclick="ejecutarEliminarHallazgo(${index})">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    Sí, eliminar
                </button>
            </div>
        </div>
    `;

    overlay.style.display = 'flex';

    const onKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            cerrarEliminarModal();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            ejecutarEliminarHallazgo(index);
        }
    };
    if (overlay._keyListener) {
        document.removeEventListener('keydown', overlay._keyListener);
    }
    overlay._keyListener = onKey;
    document.addEventListener('keydown', onKey);

    overlay.onclick = (e) => {
        if (e.target === overlay) cerrarEliminarModal();
    };
};

window.cerrarEliminarModal = function () {
    const overlay = document.getElementById('rec-delete-modal-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        if (overlay._keyListener) {
            document.removeEventListener('keydown', overlay._keyListener);
            overlay._keyListener = null;
        }
    }
};

window.ejecutarEliminarHallazgo = async function (index) {
    cerrarEliminarModal();
    if (index < 0 || index >= RecorridasState.hallazgosHoy.length) return;

    const deleted = RecorridasState.hallazgosHoy.splice(index, 1)[0];
    if (!deleted) return;

    // 1. Eliminar de tareasResueltasHoy
    RecorridasState.tareasResueltasHoy = RecorridasState.tareasResueltasHoy.filter(t => t.id !== deleted.id);

    // 2. Eliminar de recorridasHistorial de hoy
    const fechaHoy = RecorridasState.fecha;
    const idxHist = RecorridasState.recorridasHistorial.findIndex(r => r.fecha === fechaHoy);
    if (idxHist >= 0) {
        const histRec = RecorridasState.recorridasHistorial[idxHist];
        histRec.hallazgos = (histRec.hallazgos || []).filter(h => h.id !== deleted.id);
        if (histRec.hallazgos.length === 0) {
            RecorridasState.recorridasHistorial.splice(idxHist, 1);
        }
    }

    // 3. Actualizar LocalStorage
    const key = getRecorridasKey();
    const listLoc = getRecorridasLocal();
    const idxLoc = listLoc.findIndex(r => 
        (r.productor || '').toLowerCase() === (RecorridasState.productor || '').toLowerCase() &&
        (r.establecimiento || '').toLowerCase() === (RecorridasState.establecimiento || '').toLowerCase() &&
        r.fecha === fechaHoy
    );
    if (idxLoc >= 0) {
        if (RecorridasState.hallazgosHoy.length === 0) {
            listLoc.splice(idxLoc, 1);
        } else {
            listLoc[idxLoc].hallazgos = [...RecorridasState.hallazgosHoy];
            listLoc[idxLoc].updated_at = new Date().toISOString();
        }
        guardarRecorridasLocal(listLoc);
    }

    // 4. Actualizar backend
    if (RecorridasState.recorridaId) {
        if (RecorridasState.hallazgosHoy.length === 0) {
            apiFetchApp(API_RECORRIDAS, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'delete',
                    id: RecorridasState.recorridaId
                })
            }).catch(e => console.warn('Error eliminando recorrida en backend:', e));
            RecorridasState.recorridaId = null;
        } else {
            apiFetchApp(API_RECORRIDAS, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'save',
                    id: RecorridasState.recorridaId,
                    productor: RecorridasState.productor,
                    establecimiento: RecorridasState.establecimiento,
                    fecha: fechaHoy,
                    profesional: RecorridasState.profesional,
                    hallazgos: RecorridasState.hallazgosHoy
                })
            }).catch(e => console.warn('Error actualizando recorrida en backend:', e));
        }
    }

    renderHallazgosHoy();
    renderHistorial();
};

// ─── Modal de Edición de Hallazgo ─────────────────────────────
let _editHallazgoCatSeleccionada = 'general';

window.abrirEditarHallazgoModal = function (idx) {
    if (idx < 0 || idx >= RecorridasState.hallazgosHoy.length) return;
    const it = RecorridasState.hallazgosHoy[idx];
    _editHallazgoCatSeleccionada = it.categoria || 'general';

    let overlay = document.getElementById('rec-edit-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'rec-edit-modal-overlay';
        overlay.className = 'rec-modal-overlay';
        document.body.appendChild(overlay);
    }

    const catChipsHtml = CATEGORIAS_RECORRIDA.map(c => `
        <button type="button" 
                class="rec-modal-cat-chip ${c.id === _editHallazgoCatSeleccionada ? 'active' : ''}" 
                data-cat="${c.id}"
                onclick="seleccionarCatModal('${c.id}')">
            <span>${c.emoji}</span>
            <span>${c.label}</span>
        </button>
    `).join('');

    overlay.innerHTML = `
        <div class="rec-modal-card" role="dialog" aria-modal="true" aria-labelledby="rec-modal-title">
            <div class="rec-modal-header">
                <div class="rec-modal-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </div>
                <div style="flex:1;">
                    <h3 class="rec-modal-title" id="rec-modal-title">Editar Observación</h3>
                    <p class="rec-modal-subtitle">Modificá el detalle, categoría o estado de la tarea</p>
                </div>
                <button type="button" class="rec-modal-close" onclick="cerrarEditarHallazgoModal()" aria-label="Cerrar modal">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>

            <div class="rec-modal-body">
                <div class="rec-modal-field">
                    <label class="rec-modal-label">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                            <line x1="7" y1="7" x2="7.01" y2="7"/>
                        </svg>
                        Categoría
                    </label>
                    <div class="rec-modal-cats-grid" id="rec-edit-cats">
                        ${catChipsHtml}
                    </div>
                </div>

                <div class="rec-modal-field">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;gap:8px;">
                        <label class="rec-modal-label" for="rec-edit-texto" style="margin-bottom:0;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="16" y1="13" x2="8" y2="13"/>
                                <line x1="16" y1="17" x2="8" y2="17"/>
                            </svg>
                            Detalle de la Observación
                        </label>
                        <button type="button" class="rec-btn-spell-mini" id="rec-btn-spell-modal" onclick="corregirOrtografiaRecorrida('rec-edit-texto', 'rec-btn-spell-modal', 'rec-spell-feedback-modal')" title="Corregir ortografía y redacción con IA">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                            </svg>
                            <span>Corregir Ortografía</span>
                        </button>
                    </div>
                    <textarea id="rec-edit-texto" class="rec-modal-textarea" rows="4" 
                        spellcheck="true" 
                        lang="es" 
                        autocomplete="on" 
                        autocorrect="on" 
                        autocapitalize="sentences"
                        placeholder="Escribí el detalle...">${escapeHtml(it.texto)}</textarea>
                    <div id="rec-spell-feedback-modal" class="rec-spell-feedback" style="display:none;"></div>
                </div>

                <div class="rec-modal-toggles">
                    <label class="rec-modal-toggle-card">
                        <input type="checkbox" id="rec-edit-urgente" ${it.urgente ? 'checked' : ''}>
                        <div class="rec-modal-toggle-info">
                            <span class="rec-modal-toggle-title" style="color:#dc2626;">🚨 Marcar como Urgente</span>
                            <span class="rec-modal-toggle-sub">Destacar con máxima prioridad en WhatsApp y PDF</span>
                        </div>
                    </label>
                    <label class="rec-modal-toggle-card">
                        <input type="checkbox" id="rec-edit-resuelta" ${it.estado === 'resuelto' ? 'checked' : ''}>
                        <div class="rec-modal-toggle-info">
                            <span class="rec-modal-toggle-title" style="color:#16a34a;">✓ Marcar como Resuelta / Realizada</span>
                            <span class="rec-modal-toggle-sub">Pasa la observación al historial como completada</span>
                        </div>
                    </label>
                </div>
            </div>

            <div class="rec-modal-actions">
                <button type="button" class="rec-modal-btn cancel" onclick="cerrarEditarHallazgoModal()">
                    Cancelar
                </button>
                <button type="button" class="rec-modal-btn save" onclick="guardarEditarHallazgo(${idx})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Guardar Cambios
                </button>
            </div>
        </div>
    `;

    overlay.style.display = 'flex';
    const txt = document.getElementById('rec-edit-texto');
    if (txt) {
        setTimeout(() => {
            txt.focus();
            txt.setSelectionRange(txt.value.length, txt.value.length);
        }, 50);
    }

    // Keyboard handlers
    const onKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            cerrarEditarHallazgoModal();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            guardarEditarHallazgo(idx);
        }
    };
    if (overlay._keyListener) {
        document.removeEventListener('keydown', overlay._keyListener);
    }
    overlay._keyListener = onKey;
    document.addEventListener('keydown', onKey);

    overlay.onclick = (e) => {
        if (e.target === overlay) cerrarEditarHallazgoModal();
    };
};

window.seleccionarCatModal = function (catId) {
    _editHallazgoCatSeleccionada = catId;
    const chips = document.querySelectorAll('.rec-modal-cat-chip');
    chips.forEach(chip => {
        chip.classList.toggle('active', chip.dataset.cat === catId);
    });
};

window.cerrarEditarHallazgoModal = function () {
    const overlay = document.getElementById('rec-edit-modal-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        if (overlay._keyListener) {
            document.removeEventListener('keydown', overlay._keyListener);
            overlay._keyListener = null;
        }
    }
};

window.guardarEditarHallazgo = function (idx) {
    if (idx < 0 || idx >= RecorridasState.hallazgosHoy.length) return;
    const it = RecorridasState.hallazgosHoy[idx];
    const txtArea = document.getElementById('rec-edit-texto');
    const chkUrgente = document.getElementById('rec-edit-urgente');
    const chkResuelta = document.getElementById('rec-edit-resuelta');

    const texto = txtArea ? txtArea.value.trim() : '';
    if (!texto) {
        alert('El detalle de la observación no puede quedar vacío.');
        txtArea?.focus();
        return;
    }

    it.categoria = _editHallazgoCatSeleccionada || it.categoria || 'general';
    it.texto = texto;
    it.urgente = chkUrgente ? chkUrgente.checked : false;

    const esResuelta = chkResuelta ? chkResuelta.checked : false;
    if (esResuelta) {
        it.estado = 'resuelto';
        it.es_pendiente = false;
        it.fecha_resolucion = it.fecha_resolucion || RecorridasState.fecha;
        if (!RecorridasState.tareasResueltasHoy.some(t => t.id === it.id)) {
            RecorridasState.tareasResueltasHoy.push({
                id: it.id,
                categoria: it.categoria,
                texto: it.texto,
                fecha_origen: it.fecha_creacion || RecorridasState.fecha,
                fecha_resolucion: it.fecha_resolucion
            });
        }
    } else {
        it.estado = 'pendiente';
        it.es_pendiente = true;
        delete it.fecha_resolucion;
        RecorridasState.tareasResueltasHoy = RecorridasState.tareasResueltasHoy.filter(t => t.id !== it.id);
    }

    cerrarEditarHallazgoModal();
    renderHallazgosHoy();
    autoGuardarRecorrida();
};

// ─── Gestión de Categorías ────────────────────────────────────
const EMOJIS_SUGERIDOS = [
    '🧽','🥛','🐀','🧪','🩺','🔧','💡','🌿','💊','🐄','🐂','🏠','📋','⚠️',
    '🌡️','💉','🔬','🧬','🥗','🌾','🚿','🪣','🔩','📦','🏷️','🐛','🦟','🌤️'
];

let _gestionCatEditIdx = -1; // -1 = nueva categoría, >=0 = editando existente

window.abrirGestionCategoriasModal = function () {
    let overlay = document.getElementById('rec-gestion-cat-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'rec-gestion-cat-overlay';
        overlay.className = 'rec-modal-overlay';
        document.body.appendChild(overlay);
    }
    _gestionCatEditIdx = -1;
    _renderGestionCatModal(overlay);
    overlay.style.display = 'flex';
    overlay.onclick = (e) => { if (e.target === overlay) cerrarGestionCategoriasModal(); };
    const onKey = (e) => { if (e.key === 'Escape') cerrarGestionCategoriasModal(); };
    if (overlay._keyListener) document.removeEventListener('keydown', overlay._keyListener);
    overlay._keyListener = onKey;
    document.addEventListener('keydown', onKey);
};

function _renderGestionCatModal(overlay) {
    const listHtml = CATEGORIAS_RECORRIDA.map((cat, idx) => `
        <div class="rec-gcat-row ${cat.visible === false ? 'is-hidden' : ''}" data-idx="${idx}">
            <span class="rec-gcat-emoji">${cat.emoji}</span>
            <span class="rec-gcat-label">${escapeHtml(cat.label)}</span>
            <div class="rec-gcat-actions">
                <button type="button" class="rec-gcat-btn rec-gcat-vis" onclick="toggleVisibilidadCategoria(${idx})" title="${cat.visible === false ? 'Mostrar en selector' : 'Ocultar del selector'}">
                    ${cat.visible === false ? '👁️‍🗨️' : '👁️'}
                </button>
                <button type="button" class="rec-gcat-btn rec-gcat-edit" onclick="editarCategoria(${idx})" title="Editar">✏️</button>
                <button type="button" class="rec-gcat-btn rec-gcat-del" onclick="eliminarCategoria(${idx})" title="Eliminar"
                    ${CATEGORIAS_RECORRIDA.filter(c => c.visible !== false).length <= 1 && cat.visible !== false ? 'disabled' : ''}>🗑️</button>
            </div>
        </div>
    `).join('');

    const isEditing = _gestionCatEditIdx >= 0;
    const editCat = isEditing ? CATEGORIAS_RECORRIDA[_gestionCatEditIdx] : null;

    const emojiPickerHtml = EMOJIS_SUGERIDOS.map(em => `
        <button type="button" class="rec-emoji-pick" onclick="seleccionarEmojiGestion('${em}')" title="${em}">${em}</button>
    `).join('');

    overlay.innerHTML = `
        <div class="rec-modal-card rec-gcat-modal" role="dialog" aria-modal="true">
            <div class="rec-modal-header">
                <div class="rec-modal-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 0 0 4.93 19.07M4.93 4.93A10 10 0 0 1 19.07 19.07"/>
                    </svg>
                </div>
                <div style="flex:1;">
                    <h3 class="rec-modal-title">Gestionar Categorías</h3>
                    <p class="rec-modal-subtitle">Agregá, editá, ocultá o eliminá categorías</p>
                </div>
                <button type="button" class="rec-modal-close" onclick="cerrarGestionCategoriasModal()" aria-label="Cerrar">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>

            <div class="rec-modal-body" style="max-height:65vh;overflow-y:auto;display:flex;flex-direction:column;gap:1rem;">

                <!-- Lista de categorías -->
                <div>
                    <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary);margin-bottom:0.5rem;">
                        Categorías actuales (👁️ = visible en selector)
                    </div>
                    <div class="rec-gcat-list" id="rec-gcat-list">
                        ${listHtml}
                    </div>
                </div>

                <!-- Formulario nueva / editar -->
                <div class="rec-gcat-form-wrap">
                    <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary);margin-bottom:0.6rem;">
                        ${isEditing ? '✏️ Editar: ' + escapeHtml(editCat.label) : '➕ Nueva Categoría'}
                    </div>

                    <div style="display:flex;gap:0.65rem;align-items:flex-start;flex-wrap:wrap;margin-bottom:0.7rem;">
                        <div style="flex-shrink:0;">
                            <div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:4px;">Emoji</div>
                            <div id="rec-gcat-emoji-preview" style="width:44px;height:44px;border:2px solid var(--border-color);border-radius:0.75rem;display:flex;align-items:center;justify-content:center;font-size:1.5rem;cursor:pointer;background:var(--input-bg);" onclick="toggleEmojiPicker()" title="Cambiar emoji">
                                ${isEditing ? editCat.emoji : '📌'}
                            </div>
                            <input type="hidden" id="rec-gcat-emoji-val" value="${isEditing ? editCat.emoji : '📌'}">
                        </div>
                        <div style="flex:1;min-width:120px;">
                            <div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:4px;">Nombre</div>
                            <input type="text" id="rec-gcat-nombre" class="voice-ctx-modal-input" style="width:100%;" placeholder="ej: Nutrición" maxlength="30" value="${isEditing ? escapeHtml(editCat.label) : ''}">
                        </div>
                        <div style="flex:2;min-width:160px;">
                            <div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:4px;">Descripción (opcional)</div>
                            <input type="text" id="rec-gcat-desc" class="voice-ctx-modal-input" style="width:100%;" placeholder="ej: Suplementos, vitaminas" maxlength="60" value="${isEditing ? escapeHtml(editCat.desc || '') : ''}">
                        </div>
                    </div>

                    <!-- Picker de emojis -->
                    <div id="rec-emoji-picker" class="rec-emoji-picker-grid" style="display:none;">
                        ${emojiPickerHtml}
                    </div>

                    <div style="display:flex;justify-content:flex-end;gap:0.65rem;margin-top:0.5rem;">
                        ${isEditing ? `<button type="button" class="rec-modal-btn cancel" onclick="cancelarEditarCategoria()" style="font-size:0.8rem;padding:0.5rem 1rem;">Cancelar</button>` : ''}
                        <button type="button" class="rec-modal-btn save" onclick="guardarCategoriaGestion()" style="font-size:0.8rem;padding:0.5rem 1.2rem;">
                            ${isEditing ? '💾 Guardar Cambios' : '➕ Agregar Categoría'}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    `;

    if (window.lucide) window.lucide.createIcons();
}

window.toggleEmojiPicker = function () {
    const picker = document.getElementById('rec-emoji-picker');
    if (picker) picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
};

window.seleccionarEmojiGestion = function (em) {
    const val = document.getElementById('rec-gcat-emoji-val');
    const preview = document.getElementById('rec-gcat-emoji-preview');
    if (val) val.value = em;
    if (preview) preview.textContent = em;
    const picker = document.getElementById('rec-emoji-picker');
    if (picker) picker.style.display = 'none';
};

window.toggleVisibilidadCategoria = function (idx) {
    if (idx < 0 || idx >= CATEGORIAS_RECORRIDA.length) return;
    const cat = CATEGORIAS_RECORRIDA[idx];
    const visibles = CATEGORIAS_RECORRIDA.filter(c => c.visible !== false);
    // No dejar ocultar la última visible
    if (cat.visible !== false && visibles.length <= 1) {
        alert('Debe haber al menos una categoría visible.');
        return;
    }
    cat.visible = (cat.visible === false) ? true : false;
    saveCategoriasToStorage();
    renderCategoriasChips();
    const overlay = document.getElementById('rec-gestion-cat-overlay');
    if (overlay) _renderGestionCatModal(overlay);
};

window.editarCategoria = function (idx) {
    if (idx < 0 || idx >= CATEGORIAS_RECORRIDA.length) return;
    _gestionCatEditIdx = idx;
    const overlay = document.getElementById('rec-gestion-cat-overlay');
    if (overlay) {
        _renderGestionCatModal(overlay);
        // Scrollear al formulario de edición para que el usuario lo vea
        setTimeout(() => {
            const formWrap = overlay.querySelector('.rec-gcat-form-wrap');
            if (formWrap) {
                formWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            // También hacer foco en el campo de nombre
            const nombreInput = document.getElementById('rec-gcat-nombre');
            if (nombreInput) nombreInput.focus();
        }, 60);
    }
};

window.cancelarEditarCategoria = function () {
    _gestionCatEditIdx = -1;
    const overlay = document.getElementById('rec-gestion-cat-overlay');
    if (overlay) _renderGestionCatModal(overlay);
};

window.guardarCategoriaGestion = function () {
    const nombre = (document.getElementById('rec-gcat-nombre')?.value || '').trim();
    const desc   = (document.getElementById('rec-gcat-desc')?.value || '').trim();
    const emoji  = (document.getElementById('rec-gcat-emoji-val')?.value || '📌').trim();

    if (!nombre) {
        alert('Escribí un nombre para la categoría.');
        document.getElementById('rec-gcat-nombre')?.focus();
        return;
    }

    if (_gestionCatEditIdx >= 0) {
        // Editar existente
        const cat = CATEGORIAS_RECORRIDA[_gestionCatEditIdx];
        cat.label = nombre;
        cat.desc  = desc;
        cat.emoji = emoji;
        _gestionCatEditIdx = -1;
    } else {
        // Nueva categoría
        const id = 'cat_' + Date.now();
        // Verificar si ya existe
        if (CATEGORIAS_RECORRIDA.some(c => c.label.toLowerCase() === nombre.toLowerCase())) {
            alert('Ya existe una categoría con ese nombre.');
            return;
        }
        CATEGORIAS_RECORRIDA.push({ id, label: nombre, emoji, desc, visible: true });
    }

    saveCategoriasToStorage();
    renderCategoriasChips();
    const overlay = document.getElementById('rec-gestion-cat-overlay');
    if (overlay) _renderGestionCatModal(overlay);
};

window.eliminarCategoria = function (idx) {
    if (idx < 0 || idx >= CATEGORIAS_RECORRIDA.length) return;
    const cat = CATEGORIAS_RECORRIDA[idx];
    const visibles = CATEGORIAS_RECORRIDA.filter(c => c.visible !== false);
    if (cat.visible !== false && visibles.length <= 1) {
        alert('No podés eliminar la única categoría visible.');
        return;
    }

    // Popup propio de confirmación (sin confirm() del browser)
    let delOverlay = document.getElementById('rec-eliminar-cat-modal-overlay');
    if (!delOverlay) {
        delOverlay = document.createElement('div');
        delOverlay.id = 'rec-eliminar-cat-modal-overlay';
        delOverlay.className = 'rec-modal-overlay';
        delOverlay.style.cssText = 'z-index:10000;';
        document.body.appendChild(delOverlay);
    }

    delOverlay.innerHTML = `
        <div class="rec-modal-card is-delete" role="dialog" aria-modal="true">
            <div class="rec-modal-icon is-danger">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            </div>
            <h3 class="rec-modal-title" style="font-size:1.15rem;">¿Eliminar categoría?</h3>
            <p class="rec-modal-subtitle" style="margin-top:0.35rem;">
                Las observaciones que ya usaron esta categoría la conservarán.
            </p>
            <div class="rec-modal-preview-box">
                <div style="font-size:0.75rem;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">Categoría a eliminar</div>
                <div>${escapeHtml(cat.emoji)} ${escapeHtml(cat.label)}</div>
            </div>
            <div class="rec-modal-actions" style="justify-content:center;gap:0.75rem;margin-top:1rem;">
                <button type="button" class="rec-modal-btn cancel" id="rec-elimcat-cancel-btn">Cancelar</button>
                <button type="button" class="rec-modal-btn delete-confirm" id="rec-elimcat-confirm-btn">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    Sí, eliminar
                </button>
            </div>
        </div>
    `;

    delOverlay.style.display = 'flex';

    function cerrarDelCatModal() {
        delOverlay.style.display = 'none';
        document.removeEventListener('keydown', onDelKey);
    }

    function confirmarElimCat() {
        cerrarDelCatModal();
        CATEGORIAS_RECORRIDA.splice(idx, 1);
        if (_gestionCatEditIdx === idx) _gestionCatEditIdx = -1;
        saveCategoriasToStorage();
        renderCategoriasChips();
        const overlay = document.getElementById('rec-gestion-cat-overlay');
        if (overlay) _renderGestionCatModal(overlay);
    }

    function onDelKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); cerrarDelCatModal(); }
        if (e.key === 'Enter')  { e.preventDefault(); confirmarElimCat(); }
    }

    document.getElementById('rec-elimcat-cancel-btn').addEventListener('click', cerrarDelCatModal);
    document.getElementById('rec-elimcat-confirm-btn').addEventListener('click', confirmarElimCat);
    delOverlay.addEventListener('click', (e) => { if (e.target === delOverlay) cerrarDelCatModal(); });
    document.addEventListener('keydown', onDelKey);
};

window.cerrarGestionCategoriasModal = function () {
    const overlay = document.getElementById('rec-gestion-cat-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        if (overlay._keyListener) {
            document.removeEventListener('keydown', overlay._keyListener);
            overlay._keyListener = null;
        }
    }
};

// ─── Guardado y Persistencia ─────────────────────────────────
async function autoGuardarRecorrida() {
    if (!RecorridasState.productor && !RecorridasState.establecimiento) return;

    RecorridasState.profesional = getNombreProfesional();

    const payload = {
        productor: RecorridasState.productor,
        establecimiento: RecorridasState.establecimiento || '',
        fecha: RecorridasState.fecha,
        profesional: RecorridasState.profesional,
        hallazgos: RecorridasState.hallazgosHoy
    };

    // Incluir ID si ya existe una recorrida para hoy → hace UPDATE en vez de INSERT
    if (RecorridasState.recorridaId) {
        payload.id = RecorridasState.recorridaId;
    }

    // 1. Guardar siempre en LocalStorage (Offline-first)
    actualizarRecorridaLocal(payload);

    // 2. Sincronizar en memoria con recorridasHistorial para reflejo instantáneo en el Historial
    const fechaHoy = RecorridasState.fecha;
    const idxHist = RecorridasState.recorridasHistorial.findIndex(r => r.fecha === fechaHoy);
    const recHistItem = {
        ...payload,
        id: payload.id || RecorridasState.recorridaId || ('rec_hoy_' + Date.now())
    };
    if (idxHist >= 0) {
        RecorridasState.recorridasHistorial[idxHist] = { ...RecorridasState.recorridasHistorial[idxHist], ...recHistItem };
    } else {
        RecorridasState.recorridasHistorial.unshift(recHistItem);
    }
    renderHistorial();

    // 3. Guardar en Backend si hay conexión
    try {
        const res = await apiFetchApp(API_RECORRIDAS, {
            method: 'POST',
            body: JSON.stringify({
                action: 'save',
                ...payload
            })
        });
        if (res && res.ok && res.id) {
            // Persistir el ID en el state para que todos los saves siguientes hagan UPDATE
            RecorridasState.recorridaId = res.id;
            const h = RecorridasState.recorridasHistorial.find(r => r.fecha === fechaHoy);
            if (h) h.id = res.id;
        }
    } catch (e) {
        console.warn('[Recorridas] Guardado offline completado. Se sincronizará al volver la conexión.');
    }
}

// ─── Generación de Constancia: WhatsApp (1 Toque) ─────────────
window.compartirRecorridaWhatsApp = function () {
    if (!RecorridasState.productor && !RecorridasState.establecimiento) {
        alert('Seleccioná un productor o establecimiento primero.');
        return;
    }

    RecorridasState.profesional = getNombreProfesional();
    const { productor, establecimiento, fecha, profesional, hallazgosHoy, pendientesAnteriores, tareasResueltasHoy } = RecorridasState;

    if (hallazgosHoy.length === 0 && tareasResueltasHoy.length === 0) {
        alert('No hay observaciones registradas en esta recorrida para enviar.');
        return;
    }

    let msg = `*VETFIELD PRO — CONSTANCIA DE RECORRIDA*\n`;
    msg += `📅 *Fecha:* ${formatearFechaLocal(fecha)}\n`;
    if (productor) msg += `👤 *Productor:* ${productor}\n`;
    if (establecimiento) msg += `📍 *Establecimiento:* ${establecimiento}\n`;
    if (profesional) msg += `👨‍⚕️ *Profesional:* ${profesional}\n`;
    msg += `------------------------------------\n\n`;

    // 1. PENDIENTES QUE PERSISTEN (Crucial para el cliente: constancia de advertencia previa)
    const persisten = pendientesAnteriores.filter(p => p.estado !== 'resuelto');
    if (persisten.length > 0) {
        msg += `⚠️ *PENDIENTES DE VISITAS ANTERIORES QUE PERSISTEN:*\n`;
        persisten.forEach(p => {
            const cat = CATEGORIAS_RECORRIDA.find(c => c.id === p.categoria)?.label || p.categoria;
            const dias = p.dias_abierto > 0 ? ` (Lleva ${p.dias_abierto} días)` : '';
            msg += `• [${cat}] ${p.texto}${dias}\n`;
        });
        msg += `\n`;
    }

    // 2. OBSERVACIONES Y RECOMENDACIONES DE HOY (Agrupadas por tema)
    if (hallazgosHoy.length > 0) {
        msg += `📝 *OBSERVACIONES Y RECOMENDACIONES DE HOY:*\n`;

        // Agrupar por categoría
        const grupos = {};
        hallazgosHoy.forEach(h => {
            const catId = h.categoria || 'general';
            if (!grupos[catId]) grupos[catId] = [];
            grupos[catId].push(h);
        });

        // Respetar orden de categorías predefinidas
        const categoriasOrdenadas = CATEGORIAS_RECORRIDA
            .filter(c => grupos[c.id])
            .map(c => c.id);
        Object.keys(grupos).forEach(cId => {
            if (!categoriasOrdenadas.includes(cId)) categoriasOrdenadas.push(cId);
        });

        categoriasOrdenadas.forEach(catId => {
            const itemsCat = grupos[catId];
            const catObj = CATEGORIAS_RECORRIDA.find(c => c.id === catId) || { emoji: '📌', label: catId };
            msg += `\n*${catObj.emoji} ${catObj.label.toUpperCase()}* (${itemsCat.length}):\n`;
            itemsCat.forEach(h => {
                let prefix = '• ';
                if (h.estado === 'resuelto') {
                    prefix = '✓ [RESUELTA] ';
                } else if (h.urgente) {
                    prefix = '🚨 [URGENTE] ';
                } else {
                    prefix = '⏳ ';
                }
                msg += `  ${prefix}${h.texto}\n`;
            });
        });
        msg += `\n`;
    }

    // 3. TAREAS RESUELTAS HOY
    if (tareasResueltasHoy.length > 0) {
        msg += `✅ *TAREAS RESUELTAS HOY:*\n`;
        tareasResueltasHoy.forEach(t => {
            const cat = CATEGORIAS_RECORRIDA.find(c => c.id === t.categoria)?.label || t.categoria;
            msg += `• [${cat}] ${t.texto}\n`;
        });
        msg += `\n`;
    }

    msg += `_Constancia técnica generada con VETFIELD PRO_\n`;

    const encoded = encodeURIComponent(msg);
    const waUrl = `https://api.whatsapp.com/send?text=${encoded}`;

    // Abrir WhatsApp
    const opened = window.open(waUrl, '_blank');
    if (!opened) {
        // Fallback: copiar al portapapeles si el navegador bloquea popups
        navigator.clipboard.writeText(msg).then(() => {
            alert('El informe fue copiado al portapapeles. Podés pegarlo directamente en WhatsApp.');
        }).catch(() => {
            window.location.href = waUrl;
        });
    }
};

// ─── Generación de Constancia: PDF Formal ─────────────────────
window.exportarRecorridaPDF = function () {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert('Cargando librería de PDF... Aguardá un segundo y volvé a presionar.');
        return;
    }

    RecorridasState.profesional = getNombreProfesional();
    const { productor, establecimiento, fecha, profesional, hallazgosHoy, pendientesAnteriores, tareasResueltasHoy } = RecorridasState;

    if (!productor && !establecimiento) {
        alert('Seleccioná un productor o establecimiento primero.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');

    // ── Header con Branding
    doc.setFillColor(26, 35, 126);
    doc.rect(0, 0, 210, 24, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text('VETFIELD PRO — ACTA DE RECORRIDA DE GUACHERA', 14, 15);

    // ── Metadatos de la Visita
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(33, 37, 41);

    let y = 34;
    doc.text(`Fecha: ${formatearFechaLocal(fecha)}`, 14, y);
    if (productor) {
        doc.text(`Productor: ${productor}`, 14, y + 6);
        if (establecimiento) {
            doc.text(`Establecimiento: ${establecimiento}`, 14, y + 12);
        }
    } else if (establecimiento) {
        doc.text(`Establecimiento: ${establecimiento}`, 14, y + 6);
    }
    doc.text(`Profesional: ${profesional}`, 120, y);
    doc.text(`Tipo de Control: Auditoría de Campo y Manejo`, 120, y + 6);

    y += 20;

    // ── Tabla de Hallazgos y Observaciones de Hoy
    const tableData = [];

    // Pendientes anteriores que persisten
    const persisten = pendientesAnteriores.filter(p => p.estado !== 'resuelto');
    persisten.forEach(p => {
        tableData.push([
            (p.categoria || 'Bioseguridad').toUpperCase(),
            `[PERSISTE HACE ${p.dias_abierto || 0} DÍAS] ${limpiarParaPDF(p.texto)}`,
            'REINCIDENTE',
            'ALTA'
        ]);
    });

    // Hallazgos de hoy (ordenados por categoría para agrupar temas iguales en el reporte PDF)
    const hallazgosOrdenados = [...hallazgosHoy].sort((a, b) => {
        const catA = (a.categoria || 'general').toLowerCase();
        const catB = (b.categoria || 'general').toLowerCase();
        if (catA !== catB) return catA.localeCompare(catB);
        return (b.urgente ? 1 : 0) - (a.urgente ? 1 : 0);
    });

    hallazgosOrdenados.forEach(h => {
        const catObj = CATEGORIAS_RECORRIDA.find(c => c.id === h.categoria);
        const catLabel = catObj ? catObj.label.toUpperCase() : (h.categoria || 'GENERAL').toUpperCase();
        let estadoLabel = 'PENDIENTE';
        if (h.estado === 'resuelto') estadoLabel = 'RESUELTA';
        else if (h.estado === 'reincidente') estadoLabel = 'REINCIDENTE';

        tableData.push([
            catLabel,
            limpiarParaPDF(h.texto),
            estadoLabel,
            h.urgente ? 'ALTA' : 'NORMAL'
        ]);
    });

    // Tareas resueltas
    tareasResueltasHoy.forEach(t => {
        tableData.push([
            (t.categoria || 'General').toUpperCase(),
            `[RESUELTO HOY] ${limpiarParaPDF(t.texto)}`,
            'RESUELTO',
            'NORMAL'
        ]);
    });

    if (tableData.length === 0) {
        tableData.push(['GENERAL', 'Sin observaciones registradas.', 'OK', 'NORMAL']);
    }

    if (doc.autoTable) {
        doc.autoTable({
            startY: y,
            head: [['Categoría', 'Descripción del Hallazgo / Recomendación', 'Estado', 'Prioridad']],
            body: tableData,
            theme: 'striped',
            headStyles: {
                fillColor: [26, 35, 126],
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                fontSize: 9
            },
            styles: {
                fontSize: 8.5,
                cellPadding: 3.5,
                overflow: 'linebreak'
            },
            columnStyles: {
                0: { cellWidth: 32, fontStyle: 'bold' },
                1: { cellWidth: 105 },
                2: { cellWidth: 28, fontStyle: 'bold' },
                3: { cellWidth: 22 }
            },
            didParseCell: function (data) {
                if (data.section === 'body') {
                    const est = data.row.raw[2];
                    if (est === 'REINCIDENTE') {
                        data.cell.styles.textColor = [220, 38, 38];
                    } else if (est === 'RESUELTO') {
                        data.cell.styles.textColor = [22, 163, 74];
                    } else if (est === 'PENDIENTE') {
                        data.cell.styles.textColor = [217, 119, 6];
                    }
                }
            }
        });

        y = doc.lastAutoTable.finalY + 25;
    } else {
        y += 40;
    }

    // ── Firmas y Constancia Legal
    if (y > 250) {
        doc.addPage();
        y = 40;
    }

    doc.setDrawColor(180, 180, 180);
    doc.line(25, y + 15, 85, y + 15);
    doc.line(125, y + 15, 185, y + 15);

    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text('Firma Profesional Veterinario', 35, y + 20);
    doc.text('Recepción / Encargado de Guachera', 130, y + 20);

    if (profesional && profesional !== 'Veterinario Actuante') {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(33, 37, 41);
        doc.text(profesional, 55, y + 24, { align: 'center' });
    }

    doc.text('Constancia de visita y recomendaciones técnicas de manejo. Documento generado por VETFIELD PRO.', 14, 285);

    const targetNombre = establecimiento || productor || 'Campo';
    const fileName = `Recorrida_${targetNombre.replace(/\s+/g, '_')}_${fecha}.pdf`;
    doc.save(fileName);
};

// ─── Historial de Recorridas Anteriores ───────────────────────
function renderHistorial() {
    const container = document.getElementById('rec-history-list');
    if (!container) return;

    const fechaHoy = RecorridasState.fecha;

    // Regla: Para la visita de hoy, SOLO se muestra en el historial si tiene al menos 1 observación realizada
    const historial = (RecorridasState.recorridasHistorial || []).filter(rec => {
        const items = Array.isArray(rec.hallazgos) ? rec.hallazgos : [];
        if (rec.fecha === fechaHoy) {
            return items.some(it => it.estado === 'resuelto');
        }
        return items.length > 0;
    });

    if (historial.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:1.5rem 0;color:var(--text-secondary);font-size:0.82rem;">
                No hay recorridas anteriores registradas para esta selección.
            </div>
        `;
        return;
    }

    container.innerHTML = historial.map(rec => {
        const items = Array.isArray(rec.hallazgos) ? rec.hallazgos : [];
        const esHoy = (rec.fecha === fechaHoy);

        // Para la visita de hoy, en el historial solo se listan las que están realizadas
        const itemsParaHistorial = esHoy 
            ? items.filter(it => it.estado === 'resuelto') 
            : items;

        const resueltasCount = itemsParaHistorial.filter(i => i.estado === 'resuelto').length;
        const pendientesCount = itemsParaHistorial.filter(i => i.es_pendiente && i.estado !== 'resuelto').length;

        return `
            <div class="rec-history-item ${esHoy ? 'is-today-rec' : ''}">
                <div class="rec-history-summary" onclick="toggleRecorridaDetalle('${rec.id}')">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <strong class="rec-history-date">${formatearFechaLocal(rec.fecha)}</strong>
                        ${esHoy ? '<span class="rec-history-badge-today">Visita de Hoy (Realizadas)</span>' : ''}
                        <span style="font-size:0.78rem;color:var(--text-secondary);">
                            · ${itemsParaHistorial.length} observación${itemsParaHistorial.length === 1 ? '' : 'es'}
                        </span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        ${resueltasCount > 0 ? `
                            <span class="rec-history-pill is-resolved">
                                ✓ ${resueltasCount} realizada${resueltasCount === 1 ? '' : 's'}
                            </span>
                        ` : ''}
                        ${pendientesCount > 0 ? `
                            <span class="rec-history-pill is-pending">
                                ${pendientesCount} pendiente${pendientesCount === 1 ? '' : 's'}
                            </span>
                        ` : (resueltasCount === 0 ? `
                            <span class="rec-history-pill is-ok">
                                ✓ Todo OK
                            </span>
                        ` : '')}
                        <span style="font-size:0.72rem;color:var(--text-secondary);opacity:0.6;">▼</span>
                    </div>
                </div>
                <div class="rec-history-details ${esHoy ? 'open' : ''}" id="rec-detail-${rec.id}">
                    <ul style="margin:0;padding:0;list-style:none;line-height:1.5;">
                        ${itemsParaHistorial.map(it => {
                            const catObj = CATEGORIAS_RECORRIDA.find(c => c.id === it.categoria) || { emoji: '📌', label: it.categoria };
                            const isRes = (it.estado === 'resuelto');
                            const idxHoy = esHoy ? RecorridasState.hallazgosHoy.findIndex(h => h.id === it.id) : -1;

                            return `
                                <li class="rec-history-li">
                                    <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:200px;">
                                        <span class="rec-history-cat">
                                            ${catObj.emoji} ${catObj.label}:
                                        </span>
                                        <span class="rec-history-text">${escapeHtml(it.texto)}</span>
                                        ${isRes ? '<span class="rec-history-badge-done">✓ Realizada</span>' : ''}
                                    </div>
                                    ${esHoy && idxHoy !== -1 ? `
                                        <div style="display:inline-flex;align-items:center;gap:6px;">
                                            <button type="button" class="rec-action-btn rec-btn-delete" onclick="confirmarEliminarHallazgoHoy(${idxHoy})" title="Eliminar observación" style="height:26px;min-width:auto;padding:0 9px;font-size:0.72rem;">
                                                <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                                                <span>Borrar</span>
                                            </button>
                                        </div>
                                    ` : ''}
                                </li>
                            `;
                        }).join('')}
                    </ul>
                </div>
            </div>
        `;
    }).join('');
    if (window.lucide) window.lucide.createIcons();
}

window.toggleRecorridaDetalle = function (id) {
    const el = document.getElementById(`rec-detail-${id}`);
    if (el) el.classList.toggle('open');
};

// ─── Helpers de Almacenamiento Local ──────────────────────────
function getRecorridasKey() {
    const session = JSON.parse(localStorage.getItem('vetfield_session') || '{}');
    const uid = session.id || 'guest';
    return `vf_recorridas_${uid}`;
}

function getRecorridasLocal() {
    try {
        return JSON.parse(localStorage.getItem(getRecorridasKey()) || '[]');
    } catch {
        return [];
    }
}

function guardarRecorridasLocal(list) {
    try {
        localStorage.setItem(getRecorridasKey(), JSON.stringify(list));
    } catch (e) {
        console.warn('Error al guardar recorridas local:', e);
    }
}

function actualizarRecorridaLocal(payload) {
    const list = getRecorridasLocal();
    const idx = list.findIndex(r => 
        (r.productor || '').toLowerCase() === (payload.productor || '').toLowerCase() &&
        (r.establecimiento || '').toLowerCase() === (payload.establecimiento || '').toLowerCase() &&
        r.fecha === payload.fecha
    );

    if (idx >= 0) {
        list[idx] = { ...list[idx], ...payload, updated_at: new Date().toISOString() };
    } else {
        list.unshift({ ...payload, id: 'loc_' + Date.now(), created_at: new Date().toISOString() });
    }

    guardarRecorridasLocal(list);
}

// ─── Helpers Utilitarios ─────────────────────────────────────
function calcularDiasDiferencia(fechaInicio, fechaFin) {
    if (!fechaInicio || !fechaFin) return 0;
    const d1 = new Date(fechaInicio);
    const d2 = new Date(fechaFin);
    const diffTime = Math.abs(d2 - d1);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function formatearFechaLocal(fechaStr) {
    if (!fechaStr) return '';
    const partes = fechaStr.split('-');
    if (partes.length === 3) {
        return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    return fechaStr;
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

function limpiarParaPDF(txt) {
    if (!txt) return '';
    return txt.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
}

// ─── Asistente de Corrección Ortográfica y Redacción ─────────
const _spellUndoHistory = {};

window.corregirOrtografiaRecorrida = async function (textareaId, buttonId, feedbackId) {
    const txtArea = document.getElementById(textareaId);
    const btn = document.getElementById(buttonId);
    const fb = document.getElementById(feedbackId);

    if (!txtArea) return;
    const originalText = txtArea.value.trim();

    if (!originalText) {
        if (fb) {
            fb.style.display = 'flex';
            fb.className = 'rec-spell-feedback rec-spell-info';
            fb.innerHTML = '<span>ℹ️ Escribí una observación primero para poder corregirla.</span>';
            setTimeout(() => { if (fb) fb.style.display = 'none'; }, 3000);
        } else {
            alert('Escribí una observación primero para poder corregirla.');
        }
        txtArea.focus();
        return;
    }

    // Estado cargando en el botón
    const originalBtnHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.classList.add('loading');
        btn.innerHTML = `
            <span class="rec-spell-spinner"></span>
            <span>Corrigiendo...</span>
        `;
    }
    if (fb) {
        fb.style.display = 'none';
    }

    try {
        const res = await apiFetchApp(API_RECORRIDAS, {
            method: 'POST',
            body: JSON.stringify({
                action: 'corregir_texto',
                texto: originalText
            })
        });

        if (res && res.ok && typeof res.corregido === 'string') {
            const corregido = res.corregido;

            if (res.cambio && corregido !== originalText) {
                // Guardar para deshacer
                _spellUndoHistory[textareaId] = originalText;

                txtArea.value = corregido;
                txtArea.classList.add('rec-textarea-pulse');
                setTimeout(() => txtArea.classList.remove('rec-textarea-pulse'), 1500);

                if (fb) {
                    fb.style.display = 'flex';
                    fb.className = 'rec-spell-feedback rec-spell-success';
                    fb.innerHTML = `
                        <span>✨ Ortografía y redacción corregidas</span>
                        <button type="button" class="rec-spell-undo-btn" onclick="deshacerCorreccionOrtografia('${textareaId}', '${feedbackId}')" title="Volver al texto que escribiste originalmente">
                            ↩ Deshacer
                        </button>
                    `;
                }
            } else {
                if (fb) {
                    fb.style.display = 'flex';
                    fb.className = 'rec-spell-feedback rec-spell-same';
                    fb.innerHTML = `<span>✓ ¡Excelente ortografía! No se detectaron errores en el texto.</span>`;
                    setTimeout(() => { if (fb) fb.style.display = 'none'; }, 4000);
                }
            }
        } else {
            throw new Error(res?.error || 'No se pudo corregir el texto');
        }
    } catch (err) {
        console.warn('[Recorridas] Error al corregir ortografía:', err);
        if (fb) {
            fb.style.display = 'flex';
            fb.className = 'rec-spell-feedback rec-spell-error';
            fb.innerHTML = `<span>⚠️ No se pudo conectar con el corrector. Podés seguir escribiendo normalmente.</span>`;
            setTimeout(() => { if (fb) fb.style.display = 'none'; }, 4500);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('loading');
            btn.innerHTML = originalBtnHtml;
            if (window.lucide && typeof lucide.createIcons === 'function') {
                lucide.createIcons();
            }
        }
    }
};

window.deshacerCorreccionOrtografia = function (textareaId, feedbackId) {
    const txtArea = document.getElementById(textareaId);
    const fb = document.getElementById(feedbackId);
    if (!txtArea || !_spellUndoHistory[textareaId]) return;

    txtArea.value = _spellUndoHistory[textareaId];
    delete _spellUndoHistory[textareaId];

    if (fb) {
        fb.style.display = 'flex';
        fb.className = 'rec-spell-feedback rec-spell-info';
        fb.innerHTML = `<span>↩ Se restauró el texto original.</span>`;
        setTimeout(() => { if (fb) fb.style.display = 'none'; }, 3000);
    }
    txtArea.focus();
};

