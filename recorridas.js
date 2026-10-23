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
    hallazgosHoy: [],       // Lista de hallazgos anotados en la visita activa
    pendientesAnteriores: [],// Pendientes arrastrados de visitas pasadas
    tareasResueltasHoy: [], // Pendientes marcados como resueltos hoy
    recorridasHistorial: [], // Historial de visitas para este establecimiento
    profesional: ''
};

// Categorías disponibles
const CATEGORIAS_RECORRIDA = [
    { id: 'higiene',       label: 'Higiene',       emoji: '🧽', desc: 'Baldes, comederos, leche, sarro' },
    { id: 'alimentacion',  label: 'Alimentación',  emoji: '🥛', desc: 'Comida, agua, ración, tarritos vacíos' },
    { id: 'bioseguridad',  label: 'Bioseguridad',  emoji: '🐀', desc: 'Ratones, desratización, plagas, moscas' },
    { id: 'laboratorio',   label: 'Muestras/Lab',  emoji: '🧪', desc: 'Muestras de sangre, fecal, necropsias' },
    { id: 'sanidad',       label: 'Sanidad',       emoji: '🩺', desc: 'Diarreas, respiratorio, tratamientos' },
    { id: 'instalaciones', label: 'Instalaciones', emoji: '🔧', desc: 'Sombra, camas, roturas, reparaciones' },
    { id: 'general',       label: 'General',       emoji: '💡', desc: 'Observaciones generales o rutina' },
];

// ─── Helpers para listas de productores y establecimientos ───
function getAvailableProductores() {
    let prods = [];
    if (typeof window.getProductoresList === 'function') {
        prods = window.getProductoresList() || [];
    }
    if ((!prods || prods.length === 0) && typeof window.productores !== 'undefined' && Array.isArray(window.productores)) {
        prods = window.productores;
    }
    if ((!prods || prods.length === 0) && typeof records !== 'undefined' && Array.isArray(records)) {
        prods = [...new Set(records.map(r => r.productor))].filter(Boolean);
    }
    return [...new Set(prods.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function getAvailableEstablecimientos(productor) {
    let map = {};
    if (typeof window.getEstablecimientosPorProductorMap === 'function') {
        map = window.getEstablecimientosPorProductorMap() || {};
    } else if (typeof window.establecimientos_por_productor !== 'undefined' && window.establecimientos_por_productor) {
        map = window.establecimientos_por_productor;
    }

    let ests = [];
    if (productor && map[productor] && Array.isArray(map[productor]) && map[productor].length > 0) {
        ests = map[productor];
    } else if (productor && typeof records !== 'undefined' && Array.isArray(records)) {
        ests = [...new Set(records.filter(r => r.productor === productor).map(r => r.establecimiento))].filter(Boolean);
    }

    if (ests.length === 0 && !productor) {
        if (typeof window.establecimientos !== 'undefined' && Array.isArray(window.establecimientos)) {
            ests = window.establecimientos;
        } else if (typeof records !== 'undefined' && Array.isArray(records)) {
            ests = [...new Set(records.map(r => r.establecimiento))].filter(Boolean);
        }
    }
    return [...new Set(ests.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
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
window.initRecorridasView = function () {
    const today = new Date().toISOString().split('T')[0];
    const fechaInput = document.getElementById('rec_fecha');
    if (fechaInput && !fechaInput.value) {
        fechaInput.value = today;
        RecorridasState.fecha = today;
    }

    // Obtener nombre del veterinario desde sesión o perfil
    RecorridasState.profesional = getNombreProfesional();

    renderCategoriasChips();
    window.updateRecorridasSelects();

    // Sincronizar contexto si ya había productor/establecimiento activo en el formulario o dashboard
    const fProd = document.getElementById('f_productor')?.value ||
                  document.getElementById('dash_f_productor')?.value || '';
    const fEst = document.getElementById('f_establecimiento')?.value ||
                 document.getElementById('dash_f_establecimiento')?.value || '';

    const recProd = document.getElementById('rec_productor');
    const recEst = document.getElementById('rec_establecimiento');

    if (recProd && fProd && !recProd.value) {
        for (let i = 0; i < recProd.options.length; i++) {
            if (recProd.options[i].value.toLowerCase() === fProd.toLowerCase()) {
                recProd.selectedIndex = i;
                RecorridasState.productor = recProd.options[i].value;
                window.updateRecorridasEstablecimientos(RecorridasState.productor);
                break;
            }
        }
    }

    if (recEst && fEst && !recEst.value) {
        for (let i = 0; i < recEst.options.length; i++) {
            if (recEst.options[i].value.toLowerCase() === fEst.toLowerCase()) {
                recEst.selectedIndex = i;
                RecorridasState.establecimiento = recEst.options[i].value;
                break;
            }
        }
    }

    if (RecorridasState.establecimiento) {
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

    let val = prodSelect.value;
    if (val === '__custom__') {
        const nuevo = prompt('Ingresá el nombre del productor:');
        if (nuevo && nuevo.trim()) {
            val = nuevo.trim();
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            prodSelect.insertBefore(opt, prodSelect.lastElementChild);
            prodSelect.value = val;
        } else {
            prodSelect.value = '';
            val = '';
        }
    }

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
        defaultOpt.textContent = '-- Primero seleccioná productor --';
        estSelect.appendChild(defaultOpt);
        RecorridasState.establecimiento = '';
        window.onRecorridaContextChange();
        return;
    }

    const ests = getAvailableEstablecimientos(productor);

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = ests.length > 0 ? '-- Seleccioná establecimiento --' : '-- Sin establecimientos para este productor --';
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

    let val = estSelect.value;
    if (val === '__custom__') {
        const nuevo = prompt('Ingresá el nombre del establecimiento / tambo:');
        if (nuevo && nuevo.trim()) {
            val = nuevo.trim();
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            estSelect.insertBefore(opt, estSelect.lastElementChild);
            estSelect.value = val;
        } else {
            estSelect.value = '';
            val = '';
        }
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

    if (!RecorridasState.establecimiento) {
        RecorridasState.pendientesAnteriores = [];
        RecorridasState.hallazgosHoy = [];
        RecorridasState.recorridasHistorial = [];
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
        const url = `${API_RECORRIDAS}?action=list&establecimiento=${encodeURIComponent(establecimiento)}&productor=${encodeURIComponent(productor)}`;
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
        RecorridasState.recorridasHistorial = todasLocales.filter(r => 
            (!productor || r.productor.toLowerCase() === productor.toLowerCase()) &&
            r.establecimiento.toLowerCase() === establecimiento.toLowerCase()
        );
    }

    // 3. Extraer pendientes activos de visitas anteriores (anteriores a hoy)
    const fechaHoy = RecorridasState.fecha;
    const pendientes = [];
    const hallazgosDeHoy = [];

    RecorridasState.recorridasHistorial.forEach(rec => {
        const esHoy = (rec.fecha === fechaHoy);
        const items = Array.isArray(rec.hallazgos) ? rec.hallazgos : [];

        if (esHoy) {
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

    RecorridasState.pendientesAnteriores = pendientes;
    // Si no teníamos hallazgos cargados en memoria para hoy, usamos los del registro
    if (RecorridasState.hallazgosHoy.length === 0) {
        RecorridasState.hallazgosHoy = hallazgosDeHoy;
    }

    renderPendientesAnteriores();
    renderHallazgosHoy();
    renderHistorial();
}

// ─── Renderizar Chips de Categorías ──────────────────────────
function renderCategoriasChips() {
    const container = document.getElementById('rec-categories-container');
    if (!container) return;

    container.innerHTML = CATEGORIAS_RECORRIDA.map(cat => `
        <button type="button" 
                class="rec-chip-btn ${RecorridasState.categoriaSeleccionada === cat.id ? 'active' : ''}" 
                onclick="seleccionarCategoriaRecorrida('${cat.id}', this)"
                title="${cat.desc}">
            <span>${cat.emoji}</span>
            <span>${cat.label}</span>
        </button>
    `).join('');
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
    if (badge) badge.textContent = `${pendientes.length} pendientes`;

    list.innerHTML = pendientes.map(item => {
        const catObj = CATEGORIAS_RECORRIDA.find(c => c.id === item.categoria) || { emoji: '📌', label: item.categoria };
        const esResuelto = item.estado === 'resuelto';
        const diasTxt = item.dias_abierto === 0 ? 'Hoy' : `hace ${item.dias_abierto} día${item.dias_abierto > 1 ? 's' : ''}`;
        const reincidencias = item.visitas_reincidente || 0;

        return `
            <div class="rec-pending-card ${esResuelto ? 'resuelto-hoy' : ''}" id="card-pending-${item.id}">
                <div class="rec-pending-top">
                    <span class="rec-category-tag tag-${item.categoria}">
                        ${catObj.emoji} ${catObj.label}
                    </span>
                    <span class="rec-pending-age">
                        📅 Origen: ${formatearFechaLocal(item.fecha_origen)} (${diasTxt})
                        ${reincidencias > 0 ? `· 🚨 ${reincidencias} reiteracion${reincidencias > 1 ? 'es' : ''}` : ''}
                    </span>
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
    const chkPendiente = document.getElementById('rec_chk_pendiente');
    const chkUrgente = document.getElementById('rec_chk_urgente');

    if (!RecorridasState.establecimiento) {
        alert('Por favor seleccioná un Establecimiento antes de registrar una observación.');
        document.getElementById('rec_establecimiento')?.focus();
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
        es_pendiente: chkPendiente ? chkPendiente.checked : true,
        urgente: chkUrgente ? chkUrgente.checked : false,
        estado: (chkPendiente && chkPendiente.checked) ? 'pendiente' : 'informativo',
        fecha_creacion: RecorridasState.fecha
    };

    RecorridasState.hallazgosHoy.push(nuevoHallazgo);

    // Limpiar input
    if (txtArea) txtArea.value = '';
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
    const resueltos = RecorridasState.tareasResueltasHoy;

    if (countEl) {
        countEl.textContent = `${items.length} registro${items.length === 1 ? '' : 's'}`;
    }

    if (actionsBar) {
        actionsBar.style.display = (items.length > 0 || resueltos.length > 0) ? 'grid' : 'none';
    }

    if (items.length === 0 && resueltos.length === 0) {
        list.innerHTML = `
            <div class="rec-empty-state">
                <div style="font-size:2rem;margin-bottom:0.5rem;">📝</div>
                <div>Aún no registraste observaciones en esta recorrida.</div>
                <div style="font-size:0.78rem;opacity:0.7;margin-top:0.25rem;">Escribí arriba y presioná "+ Agregar a la Recorrida".</div>
            </div>
        `;
        return;
    }

    let html = '';

    // Mostrar tareas resueltas hoy arriba
    if (resueltos.length > 0) {
        html += resueltos.map(res => {
            const catObj = CATEGORIAS_RECORRIDA.find(c => c.id === res.categoria) || { emoji: '✅', label: res.categoria };
            return `
                <div class="rec-item-card is-resolved">
                    <div class="rec-item-header">
                        <span class="rec-category-tag tag-${res.categoria}">
                            ${catObj.emoji} ${catObj.label}
                        </span>
                        <span style="font-size:0.74rem;font-weight:700;color:#16a34a;">
                            ✓ Tarea Resuelta Hoy
                        </span>
                    </div>
                    <div class="rec-item-text" style="text-decoration: line-through; opacity: 0.85;">
                        ${escapeHtml(res.texto)}
                    </div>
                </div>
            `;
        }).join('');
    }

    // Mostrar nuevos hallazgos de hoy
    html += items.map((it, idx) => {
        const catObj = CATEGORIAS_RECORRIDA.find(c => c.id === it.categoria) || { emoji: '📌', label: it.categoria };
        const esPendiente = it.es_pendiente;
        const esUrgente = it.urgente;

        return `
            <div class="rec-item-card ${esPendiente ? 'is-pending' : ''} ${it.estado === 'reincidente' ? 'is-reincidente' : ''}">
                <div class="rec-item-header">
                    <span class="rec-category-tag tag-${it.categoria}">
                        ${catObj.emoji} ${catObj.label}
                    </span>
                    <div style="display:flex;align-items:center;gap:6px;">
                        ${esUrgente ? '<span style="font-size:0.7rem;font-weight:800;color:#dc2626;background:#fee2e2;padding:2px 6px;border-radius:4px;">🚨 URGENTE</span>' : ''}
                        ${esPendiente ? '<span style="font-size:0.7rem;font-weight:700;color:#d97706;background:#fef3c7;padding:2px 6px;border-radius:4px;">⏳ Pendiente</span>' : '<span style="font-size:0.7rem;color:#64748b;background:#f1f5f9;padding:2px 6px;border-radius:4px;">Informativo</span>'}
                        <button type="button" class="rec-item-delete" onclick="eliminarHallazgoHoy(${idx})" title="Eliminar observación">
                            <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
                        </button>
                    </div>
                </div>
                <div class="rec-item-text">${escapeHtml(it.texto)}</div>
            </div>
        `;
    }).join('');

    list.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
}

window.eliminarHallazgoHoy = function (index) {
    if (index >= 0 && index < RecorridasState.hallazgosHoy.length) {
        RecorridasState.hallazgosHoy.splice(index, 1);
        renderHallazgosHoy();
        autoGuardarRecorrida();
    }
};

// ─── Guardado y Persistencia ─────────────────────────────────
async function autoGuardarRecorrida() {
    if (!RecorridasState.establecimiento) return;

    RecorridasState.profesional = getNombreProfesional();

    const payload = {
        productor: RecorridasState.productor,
        establecimiento: RecorridasState.establecimiento,
        fecha: RecorridasState.fecha,
        profesional: RecorridasState.profesional,
        hallazgos: RecorridasState.hallazgosHoy
    };

    // 1. Guardar siempre en LocalStorage (Offline-first)
    actualizarRecorridaLocal(payload);

    // 2. Guardar en Backend si hay conexión
    try {
        const res = await apiFetchApp(API_RECORRIDAS, {
            method: 'POST',
            body: JSON.stringify({
                action: 'save',
                ...payload
            })
        });
        if (res && res.ok && res.id) {
            // Asignar ID si era nuevo
            payload.id = res.id;
        }
    } catch (e) {
        console.warn('[Recorridas] Guardado offline completado. Se sincronizará al volver la conexión.');
    }
}

// ─── Generación de Constancia: WhatsApp (1 Toque) ─────────────
window.compartirRecorridaWhatsApp = function () {
    if (!RecorridasState.establecimiento) {
        alert('Seleccioná un establecimiento primero.');
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
    msg += `📍 *Establecimiento:* ${establecimiento}\n`;
    if (productor) msg += `👤 *Productor:* ${productor}\n`;
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

    // 2. OBSERVACIONES Y RECOMENDACIONES DE HOY
    if (hallazgosHoy.length > 0) {
        msg += `📝 *OBSERVACIONES Y RECOMENDACIONES DE HOY:*\n`;
        hallazgosHoy.forEach(h => {
            const cat = CATEGORIAS_RECORRIDA.find(c => c.id === h.categoria)?.label || h.categoria;
            const flag = h.urgente ? '🚨 [URGENTE] ' : (h.es_pendiente ? '⏳ ' : '• ');
            msg += `${flag}[${cat}] ${h.texto}\n`;
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

    if (!establecimiento) {
        alert('Seleccioná un establecimiento.');
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
    doc.text(`Establecimiento: ${establecimiento}`, 14, y + 6);
    if (productor) doc.text(`Productor: ${productor}`, 14, y + 12);
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

    // Hallazgos de hoy
    hallazgosHoy.forEach(h => {
        tableData.push([
            (h.categoria || 'General').toUpperCase(),
            limpiarParaPDF(h.texto),
            h.es_pendiente ? 'PENDIENTE' : 'INFORMATIVO',
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

    const fileName = `Recorrida_${establecimiento.replace(/\s+/g, '_')}_${fecha}.pdf`;
    doc.save(fileName);
};

// ─── Historial de Recorridas Anteriores ───────────────────────
function renderHistorial() {
    const container = document.getElementById('rec-history-list');
    if (!container) return;

    const historial = RecorridasState.recorridasHistorial;

    if (!historial || historial.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:1.5rem 0;color:var(--text-secondary);font-size:0.82rem;">
                No hay recorridas anteriores registradas para este establecimiento.
            </div>
        `;
        return;
    }

    container.innerHTML = historial.map(rec => {
        const items = Array.isArray(rec.hallazgos) ? rec.hallazgos : [];
        const pendientesCount = items.filter(i => i.es_pendiente && i.estado !== 'resuelto').length;

        return `
            <div class="rec-history-item">
                <div class="rec-history-summary" onclick="toggleRecorridaDetalle(${rec.id})">
                    <div>
                        <strong style="color:var(--primary);">${formatearFechaLocal(rec.fecha)}</strong>
                        <span style="font-size:0.78rem;color:var(--text-secondary);margin-left:8px;">
                            ${items.length} observación${items.length === 1 ? '' : 'es'}
                        </span>
                    </div>
                    <div>
                        ${pendientesCount > 0 ? `
                            <span style="font-size:0.72rem;background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:9999px;font-weight:700;">
                                ${pendientesCount} pendientes
                            </span>
                        ` : `
                            <span style="font-size:0.72rem;background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:9999px;font-weight:700;">
                                ✓ Todo OK
                            </span>
                        `}
                    </div>
                </div>
                <div class="rec-history-details" id="rec-detail-${rec.id}">
                    <ul style="margin:0;padding-left:1.2rem;line-height:1.5;">
                        ${items.map(it => {
                            const cat = CATEGORIAS_RECORRIDA.find(c => c.id === it.categoria)?.label || it.categoria;
                            return `<li><strong>[${cat}]</strong> ${escapeHtml(it.texto)} ${it.estado === 'resuelto' ? '<span style="color:#16a34a;">(Resuelto)</span>' : ''}</li>`;
                        }).join('')}
                    </ul>
                </div>
            </div>
        `;
    }).join('');
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
        r.establecimiento.toLowerCase() === payload.establecimiento.toLowerCase() &&
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
