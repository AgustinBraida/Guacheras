// =============================================================
// VETFIELD PRO — app.js v78
// Los datos ahora vienen de api/records.php (MySQL).
// Mantiene soporte offline-first: guarda en localStorage
// cuando no hay conexión y sincroniza automáticamente al volver.
// =============================================================

'use strict';

const API_RECORDS = 'api/records.php';

let _uid = null;

// Datos en memoria (cargados desde API o localStorage offline)
let records              = [];
let establecimientos     = [];
let productores          = [];
let establecimientos_por_productor = {};
let lastEntry            = {};

// Variables para el popup de conflicto de RP
let _pendingNewRecord        = null; // registro que está intentando guardarse
let _pendingConflictExisting = null; // datos del existente devueltos por el servidor


// Claves localStorage SOLO para modo offline
function getKeys(uid) {
    return {
        offline:    `vf_offline_${uid}`,    // registros pendientes de sync
        lastEntry:  `vf_last_entry_${uid}`,
    };
}

let KEYS = getKeys('guest');

// ─── Helper: apiFetch con token Bearer + detección de errores HTTP ───────
async function apiFetchApp(url, options = {}) {
    const token = localStorage.getItem('vetfield_api_token');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        ...(options.headers || {}),
    };
    try {
        const res  = await fetch(url, { ...options, headers });
        const data = await res.json().catch(() => ({ ok: false, error: 'Respuesta inesperada del servidor.' }));
        if (!res.ok) {
            data._httpStatus = res.status;
            if (res.status === 401) _handleSessionExpired();
        }
        return data;
    } catch {
        return { ok: false, error: 'Sin conexión al servidor.' };
    }
}

// ─── Manejar sesión expirada: limpiar storage y volver al login ───────
function _handleSessionExpired() {
    localStorage.removeItem('vetfield_session');
    localStorage.removeItem('vetfield_api_token');
    if (typeof showToast === 'function') showToast('⏰ Tu sesión expiró. Iniciá sesión nuevamente.');
    setTimeout(() => window.location.reload(), 1800);
}

// =============================================================
// appLoadForUser — llamado por auth.js al confirmar sesión
// =============================================================
async function appLoadForUser(uid) {
    _uid = uid;
    KEYS = getKeys(uid);
    lastEntry = JSON.parse(localStorage.getItem(KEYS.lastEntry)) || {};

    if (navigator.onLine) {
        await loadFromAPI();
    } else {
        loadFromOfflineCache();
    }

    initForm();
    initReportFilters();
    refreshSaludDatalist();
    updateUI();
    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (typeof applyIgMetodo === 'function' && typeof AuthManager !== 'undefined') {
        applyIgMetodo(AuthManager.getIgMetodo());
    }

    // Inicializar dashboard con datos cargados
    // Timeout aumentado para mobile: el layout necesita estar pintado antes de que Chart.js calcule dimensiones
    if (typeof initDashboard === 'function') {
        setTimeout(initDashboard, 400);
    }
}

window.appLoadForUser = appLoadForUser;

// ─── Aplicar preferencia de método de medición de I.G. Calostro (Brix vs mg/dL) ──
function applyIgMetodo(metodo) {
    const isBrix = (metodo || (typeof AuthManager !== 'undefined' ? AuthManager.getIgMetodo() : 'brix')) === 'brix';
    const unitText = isBrix ? '% Brix' : 'mg/dL';

    // 1. Unidad en el formulario de carga de nuevo ternero
    const fUnit = document.getElementById('f_ig_calostro_unit');
    if (fUnit) fUnit.textContent = unitText;

    // 2. Unidades en el panel de configuración de umbrales
    document.querySelectorAll('.kpi-ig-unit').forEach(el => {
        el.textContent = unitText;
    });

    // 3. Subtítulo en la tarjeta de KPI si no tiene datos calculados
    const kpiIgSub = document.getElementById('kpi_ig_sub');
    if (kpiIgSub && (!kpiIgSub.textContent || kpiIgSub.textContent.includes('promedio'))) {
        kpiIgSub.textContent = `${unitText} promedio`;
    }

    // 4. Título del gráfico de correlación si no fue modificado manualmente
    const titleEl = document.querySelector('[data-title-key="title_calostro"]');
    if (titleEl) {
        const savedTitles = JSON.parse(localStorage.getItem('vf_chart_titles') || '{}');
        if (!savedTitles['title_calostro'] || savedTitles['title_calostro'].includes('I.G. Calostro') || savedTitles['title_calostro'].includes('Grados Brix')) {
            titleEl.textContent = isBrix
                ? '🍼 Correlación Grados Brix vs Supervivencia'
                : '🍼 Correlación I.G. Calostro vs Supervivencia';
        }
    }

    // 5. Refrescar dashboard y gráficos con la nueva unidad y umbrales correspondientes
    if (typeof window.refreshDashboardIgMetodo === 'function') {
        window.refreshDashboardIgMetodo(isBrix ? 'brix' : 'mgdl');
    }
}
window.applyIgMetodo = applyIgMetodo;

// ─── Cargar datos desde la API ───────────────────────────────
async function loadFromAPI() {
    const [recData, optData] = await Promise.all([
        apiFetchApp(API_RECORDS + '?action=list'),
        apiFetchApp(API_RECORDS + '?action=get_options'),
    ]);

    if (recData.ok) {
        // Mezclar registros del servidor con pendientes offline
        const offline = getOfflineRecords();
        records = [...recData.records, ...offline];
        // Auto-corrección preventiva: si algún registro tiene I.G. >= 50 (sin coma decimal), normalizarlo
        records.forEach(r => {
            if (r.ig_ternero !== null && r.ig_ternero !== undefined && r.ig_ternero >= 50 && r.ig_ternero <= 500) {
                r.ig_ternero = parseFloat((r.ig_ternero / 10).toFixed(2));
            }
            if (r.ig_calostro !== null && r.ig_calostro !== undefined && r.ig_calostro >= 50 && r.ig_calostro <= 500) {
                r.ig_calostro = parseFloat((r.ig_calostro / 10).toFixed(2));
            }
        });
    } else {
        // Si falla la API, cargar cache offline
        loadFromOfflineCache();
    }

    if (optData.ok) {
        establecimientos      = optData.establecimientos      || [];
        productores           = optData.productores           || [];
        establecimientos_por_productor = optData.establecimientos_por_productor || {};
    }
}

// ─── Cargar datos desde cache offline ───────────────────────
function loadFromOfflineCache() {
    records     = getOfflineRecords();
    establecimientos      = [];
    productores           = [];
    establecimientos_por_productor = {};
    // Derivar listas únicas de los registros offline
    establecimientos      = [...new Set(records.map(r => r.establecimiento))].filter(Boolean);
    productores           = [...new Set(records.map(r => r.productor))].filter(Boolean);
    
    // Derivar relacion 1:N offline
    records.forEach(r => {
        if (r.productor && r.establecimiento) {
            if(!establecimientos_por_productor[r.productor]) establecimientos_por_productor[r.productor] = [];
            if(!establecimientos_por_productor[r.productor].includes(r.establecimiento)) establecimientos_por_productor[r.productor].push(r.establecimiento);
        }
    });
}

function getOfflineRecords() {
    return JSON.parse(localStorage.getItem(KEYS.offline)) || [];
}

function saveOfflineRecords(recs) {
    localStorage.setItem(KEYS.offline, JSON.stringify(recs));
}

// ─── Inicializar formulario ──────────────────────────────────
function initForm() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('f_fecha').value = today;

    if (document.getElementById('db_filter_fecha')) {
        document.getElementById('db_filter_fecha').value = today;
    }

    if (lastEntry.establecimiento) document.getElementById('f_establecimiento').value = lastEntry.establecimiento;
    if (lastEntry.productor)       document.getElementById('f_productor').value       = lastEntry.productor;
    if (lastEntry.fecha)           document.getElementById('f_fecha').value           = lastEntry.fecha;

    renderFieldDatalists();
    
    // Lógica dinámica de datalist para Establecimiento basado en Productor
    const fProductor = document.getElementById('f_productor');
    const fEstablecimiento = document.getElementById('f_establecimiento');
    if (fProductor && fEstablecimiento) {
        fProductor.addEventListener('change', () => renderEstablecimientoDatalist(fProductor.value));
        fProductor.addEventListener('input', () => renderEstablecimientoDatalist(fProductor.value));
    }

    // Asegurar que el form de entrada tenga su listener (safety net)
    bindEntryForm();
    const isMuertoChecked = !!document.querySelector('input[name="survival"]:checked')?.value?.includes('Muerto');
    toggleCausa(isMuertoChecked);
}

function renderFieldDatalists() {
    const pList = document.getElementById('productor-list');
    if (pList) {
        pList.innerHTML = '';
        productores.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            pList.appendChild(opt);
        });
    }
    const fProductor = document.getElementById('f_productor');
    renderEstablecimientoDatalist(fProductor ? fProductor.value : '');
}

function renderEstablecimientoDatalist(selectedProductor) {
    const tList = document.getElementById('establecimiento-list');
    if (!tList) return;
    tList.innerHTML = '';
    
    let listToUse = establecimientos; 
    if (selectedProductor && establecimientos_por_productor[selectedProductor] && establecimientos_por_productor[selectedProductor].length > 0) {
        listToUse = establecimientos_por_productor[selectedProductor];
    }
    
    listToUse.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        tList.appendChild(opt);
    });
}

// ─── Navegación ──────────────────────────────────────────────
function switchView(viewId, el) {
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    const targetView = document.getElementById('view-' + viewId);
    if (targetView) targetView.classList.add('active');

    if (el) {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
    } else {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(i => i.classList.remove('active'));
        if (viewId === 'entrada') navItems[1].classList.add('active');
    }

    if (viewId === 'reportes') renderTable();
    if (viewId === 'perfil') {
        const countEl = document.getElementById('profile-records-count');
        if (countEl) countEl.textContent = records.length + ' registros';
        setTimeout(() => { if (typeof window.loadProductoresList === 'function') window.loadProductoresList(); }, 50);
    }
    if (viewId === 'inicio' && typeof initDashboard === 'function') {
        setTimeout(initDashboard, 250); // Timeout aumentado para mobile
    }
    updateUI();
}

function setSegmented(btn, val) {
    const parent = btn.parentElement;
    parent.querySelectorAll('.segmented-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const hiddenInput = document.getElementById(parent.id + '_val');
    if (hiddenInput) {
        hiddenInput.value = val;
        hiddenInput.dataset.dirty = 'true';
    }
}

function setSegmentedParto(btn, val) {
    setSegmented(btn, val);
    if (val === 'Muerto al parto') {
        const vivoRadio = document.querySelector('input[name="survival"][value="Vivo"]');
        const muertoRadio = document.querySelector('input[name="survival"][value="Muerto en Establecimiento"]');
        if (vivoRadio && vivoRadio.checked && muertoRadio) {
            muertoRadio.checked = true;
            muertoRadio.dataset.dirty = 'true';
            if (typeof toggleCausa === 'function') toggleCausa(true);
        }
    }
}
window.setSegmentedParto = setSegmentedParto;

const opcionesCausa = {
    'Enfermedades e Infecciones': ['Colibacilosis', 'Salmonelosis', 'Rotavirus', 'Coronavirus', 'Criptosporidiosis', 'Onfalitis', 'Neumonía'],
    'Problemas Digestivos y Metabólicos': ['Diarrea', 'Torsión de abomaso', 'Úlcera de abomaso', 'Intoxicación'],
    'Factores Externos y de Manejo': ['Estrés calórico', 'Falsa vía', 'Traumática']
};

function selectCausaCategory(btn, cat) {
    const parent = btn.closest('.causa-segmented');
    if (parent) {
        parent.querySelectorAll('.segmented-btn').forEach(b => b.classList.remove('active'));
    }
    btn.classList.add('active');
    
    // Guardar categoría en el input oculto
    const hiddenInput = document.getElementById('f_causa_categoria_val');
    if (hiddenInput) {
        hiddenInput.value = cat;
        hiddenInput.dataset.dirty = 'true';
    }

    const select = document.getElementById('f_causa_especifica');
    const subCausaGroup = document.getElementById('subCausaGroup');
    const customCausaGroup = document.getElementById('customCausaGroup');
    const customInput = document.getElementById('f_causa_especifica_custom');

    if (cat === 'Otra Causa') {
        if (subCausaGroup) subCausaGroup.classList.add('hidden');
        if (select) {
            select.innerHTML = '<option value="">Otra Causa</option>';
            select.value = '';
            select.required = false;
        }
        if (customCausaGroup) customCausaGroup.classList.remove('hidden');
        if (customInput) customInput.required = true;
    } else {
        if (customCausaGroup) customCausaGroup.classList.add('hidden');
        if (customInput) {
            customInput.value = '';
            customInput.required = false;
        }
        if (select) {
            select.innerHTML = '<option value="">Seleccione una causa específica...</option>';
            if (opcionesCausa[cat]) {
                opcionesCausa[cat].forEach(opn => {
                    const opt = document.createElement('option');
                    opt.value = opn;
                    opt.textContent = opn;
                    select.appendChild(opt);
                });
            }
            select.required = true;
        }
        if (subCausaGroup) subCausaGroup.classList.remove('hidden');
    }
}

// ─── Sugerencias Predefinidas y Aprendizaje Dinámico de Salud ─────────────
const PRELOADED_SALUD_SUGGESTIONS = [
    // Enfermedades comunes
    'Diarrea neonatal',
    'Neumonía',
    'Onfalitis',
    'Rotavirus',
    'Coronavirus',
    'Criptosporidiosis',
    'Colibacilosis',
    'Salmonelosis',
    'Torsión de abomaso',
    'Úlcera de abomaso',
    'Intoxicación',
    'Acidosis / Timpanismo',
    'Hipotermia',
    'Estrés calórico',
    'Falsa vía',
    'Traumática',
    // Malformaciones / Problemas al nacer
    'Atresia ani',
    'Paladar hendido',
    'Hernia umbilical',
    'Contractura de tendones',
    'Debilidad congénita / Ternero tonto'
];

function refreshSaludDatalist(targetDatalistId = 'salud_sugerencias_list') {
    const dl = document.getElementById(targetDatalistId);
    if (!dl) return;
    
    let customTerms = [];
    try {
        customTerms = JSON.parse(localStorage.getItem('vf_custom_salud_terms') || '[]');
    } catch(e) {}

    const fromRecords = (typeof records !== 'undefined') 
        ? records.map(r => r.detalle_salud).filter(d => d && typeof d === 'string' && d.trim()) 
        : [];

    const allTerms = Array.from(new Set([...PRELOADED_SALUD_SUGGESTIONS, ...customTerms, ...fromRecords]))
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .sort((a, b) => a.localeCompare(b, 'es'));

    dl.innerHTML = allTerms.map(t => `<option value="${t}"></option>`).join('');
}
window.refreshSaludDatalist = refreshSaludDatalist;

function saveCustomSaludTerm(term) {
    if (!term || typeof term !== 'string') return;
    const clean = term.trim();
    if (!clean) return;
    try {
        let customTerms = JSON.parse(localStorage.getItem('vf_custom_salud_terms') || '[]');
        if (!customTerms.some(t => t.toLowerCase() === clean.toLowerCase())) {
            customTerms.push(clean);
            localStorage.setItem('vf_custom_salud_terms', JSON.stringify(customTerms));
        }
    } catch(e) {}
    refreshSaludDatalist();
}
window.saveCustomSaludTerm = saveCustomSaludTerm;

function toggleDetalleSalud(val) {
    const group = document.getElementById('f_detalle_salud_group');
    const label = document.getElementById('f_detalle_salud_label');
    const input = document.getElementById('f_detalle_salud');
    if (!group) return;

    if (!val || val === 'Sano, sin problemas aparentes') {
        group.classList.add('hidden');
        if (input) {
            input.value = '';
            input.required = false;
        }
    } else {
        group.classList.remove('hidden');
        if (input) input.required = true;
        if (label && input) {
            if (val.includes('malformación') || val.includes('problema')) {
                label.textContent = 'Especifique el problema o malformación al nacer:';
                input.placeholder = 'Ej: Paladar hendido, Atresia ani, Hernia umbilical...';
            } else if (val.includes('actualmente')) {
                label.textContent = 'Especifique la enfermedad o cuadro clínico actual:';
                input.placeholder = 'Ej: Diarrea neonatal, Neumonía, Onfalitis, Rotavirus...';
            } else if (val.includes('anteriormente')) {
                label.textContent = 'Especifique la enfermedad previa superada:';
                input.placeholder = 'Ej: Criptosporidiosis, Diarrea, Neumonía...';
            }
        }
        refreshSaludDatalist();
    }
}
window.toggleDetalleSalud = toggleDetalleSalud;

function toggleEditDetalleSalud(val) {
    const group = document.getElementById('edit_detalle_salud_group');
    const label = document.getElementById('edit_detalle_salud_label');
    const input = document.getElementById('edit_detalle_salud');
    if (!group) return;
    if (!val || val === 'Sano, sin problemas aparentes') {
        group.style.display = 'none';
        if (input) input.value = '';
    } else {
        group.style.display = '';
        if (label && input) {
            if (val.includes('malformación') || val.includes('problema')) {
                label.textContent = 'Especifique el problema o malformación al nacer:';
                input.placeholder = 'Ej: Paladar hendido, Atresia ani, Hernia umbilical...';
            } else if (val.includes('actualmente')) {
                label.textContent = 'Especifique la enfermedad o cuadro clínico actual:';
                input.placeholder = 'Ej: Diarrea neonatal, Neumonía, Onfalitis, Rotavirus...';
            } else if (val.includes('anteriormente')) {
                label.textContent = 'Especifique la enfermedad previa superada:';
                input.placeholder = 'Ej: Criptosporidiosis, Diarrea, Neumonía...';
            }
        }
    }
}
window.toggleEditDetalleSalud = toggleEditDetalleSalud;

function toggleCausa(show) {
    const seccionSalud = document.getElementById('seccion_estado_salud');
    if (seccionSalud) {
        seccionSalud.classList.toggle('hidden', show);
    }
    const group = document.getElementById('causaGroup');
    if (group) {
        group.classList.toggle('hidden', !show);
    }
    
    const specificSelect = document.getElementById('f_causa_especifica');
    const customInput = document.getElementById('f_causa_especifica_custom');
    
    if (specificSelect) {
        const catVal = document.getElementById('f_causa_categoria_val')?.value;
        specificSelect.required = show && (catVal !== 'Otra Causa');
    }
    if (customInput) {
        const catVal = document.getElementById('f_causa_categoria_val')?.value;
        customInput.required = show && (catVal === 'Otra Causa');
    }
    
    if (!show) {
        document.querySelectorAll('.causa-segmented .segmented-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById('f_causa_categoria_val').value = '';
        const subGroup = document.getElementById('subCausaGroup');
        if (subGroup) subGroup.classList.add('hidden');
        if (specificSelect) {
            specificSelect.innerHTML = '<option value="">Primero seleccione una categoría arriba...</option>';
            specificSelect.value = '';
        }
        const customGroup = document.getElementById('customCausaGroup');
        if (customGroup) customGroup.classList.add('hidden');
        if (customInput) {
            customInput.value = '';
            customInput.required = false;
        }
        toggleDetalleSalud(document.getElementById('f_estado_salud')?.value);
    } else {
        const detGroup = document.getElementById('f_detalle_salud_group');
        if (detGroup) detGroup.classList.add('hidden');
        const detInput = document.getElementById('f_detalle_salud');
        if (detInput) {
            detInput.value = '';
            detInput.required = false;
        }
    }
}

// ─── Conectividad ────────────────────────────────────────────
function updateUI() {
    const pendingCountEl = document.getElementById('pendingCount');
    const syncStatusEl   = document.getElementById('syncStatus');
    const pendingCount   = records.filter(r => !r.synced).length;

    if (pendingCountEl) pendingCountEl.textContent = pendingCount;

    populateDashboardFilters();

    if (syncStatusEl) {
        if (!navigator.onLine) {
            syncStatusEl.className = 'sync-badge pending';
            syncStatusEl.textContent = 'Offline';
        } else if (pendingCount > 0) {
            syncStatusEl.className = 'sync-badge pending';
            syncStatusEl.textContent = pendingCount + ' Pendientes';
        } else {
            syncStatusEl.className = 'sync-badge online';
            syncStatusEl.textContent = 'Sincronizado';
        }
    }

    // Dashboard filters
    const filterEstablecimiento = document.getElementById('db_filter_establecimiento')?.value;
    const filterProductor       = document.getElementById('db_filter_productor')?.value;
    const filterFecha           = document.getElementById('db_filter_fecha')?.value;
 
    let dashRecords = records.filter(r => {
        const matchT = !filterEstablecimiento || r.establecimiento === filterEstablecimiento;
        const matchP = !filterProductor       || r.productor       === filterProductor;
        const matchF = !filterFecha           || r.fecha           === filterFecha;
        return matchT && matchP && matchF;
    });

    const total   = dashRecords.length;
    const muertos = dashRecords.filter(r => r.estado !== 'Vivo').length;
    const igs     = dashRecords.map(r => parseFloat(r.ig_ternero)).filter(v => !isNaN(v));
    const avgIg   = igs.length > 0 ? (igs.reduce((a, b) => a + b, 0) / igs.length).toFixed(1) : '0.0';

    if (document.getElementById('m_total'))     document.getElementById('m_total').textContent = total;
    if (document.getElementById('m_mortalidad')) document.getElementById('m_mortalidad').textContent = total > 0 ? ((muertos / total) * 100).toFixed(1) + '%' : '0%';
    if (document.getElementById('m_ig_avg'))    document.getElementById('m_ig_avg').textContent = avgIg;

    const isFiltered = filterEstablecimiento || filterProductor || filterFecha;
    const trendEl = document.getElementById('m_total_trend');
    if (trendEl) {
        trendEl.textContent   = isFiltered ? 'Filtrado' : '-';
        trendEl.style.color   = isFiltered ? 'var(--primary)' : 'var(--text-secondary)';
    }
}

function populateDashboardFilters() {
    const tSelect = document.getElementById('db_filter_establecimiento');
    const pSelect = document.getElementById('db_filter_productor');
    if (!tSelect || !pSelect) return;

    const currentT = tSelect.value;
    const currentP = pSelect.value;

    const uniqueProducers = [...new Set(records.map(r => r.productor))].filter(p => p);

    pSelect.innerHTML = '<option value="">Todos</option>';
    uniqueProducers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p; opt.textContent = p;
        if (p === currentP) opt.selected = true;
        pSelect.appendChild(opt);
    });

    // Filtrar establecimientos según productor seleccionado
    let estToShow;
    if (currentP && establecimientos_por_productor[currentP] && establecimientos_por_productor[currentP].length > 0) {
        estToShow = establecimientos_por_productor[currentP];
    } else {
        estToShow = [...new Set(records.map(r => r.establecimiento))].filter(t => t);
    }

    tSelect.innerHTML = '<option value="">Todos</option>';
    estToShow.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        if (t === currentT) opt.selected = true;
        tSelect.appendChild(opt);
    });

    // Si el establecimiento seleccionado ya no está en la lista, limpiarlo
    if (currentT && !estToShow.includes(currentT)) {
        tSelect.value = '';
    }
}

window.addEventListener('online',  () => { updateUI(); syncData(); }); // auto-sync al volver online
window.addEventListener('offline', updateUI);

// ─── Sincronizar registros offline con la API ────────────────
async function syncData() {
    const pending = records.filter(r => !r.synced);
    if (pending.length === 0) {
        if (navigator.onLine) {
            showToast('No hay registros pendientes.');
        }
        return;
    }

    if (!navigator.onLine) {
        showToast('Sin conexión. Los datos se guardarán al volver a estar en línea.');
        return;
    }

    const btn = document.getElementById('btn-sync-cloud');
    const originalHTML = btn?.innerHTML;
    if (btn) { btn.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width:20px;"></i> Sincronizando...'; if (typeof lucide !== 'undefined') lucide.createIcons(); }

    let synced = 0;
    let limitReachedError = null;
    for (const r of pending) {
        const res = await apiFetchApp(API_RECORDS, {
            method: 'POST',
            body: JSON.stringify({ action: 'save', ...r }),
        });
        if (res.ok) {
            r.synced = true;
            r.id     = res.id || r.id; // actualizar ID con el real de la BD
            synced++;
        } else if (res._httpStatus === 403) {
            limitReachedError = res.error;
            break;
        }
    }

    if (limitReachedError) {
        if (typeof showAlert === 'function') {
            showAlert('Límite del Plan', limitReachedError, 'info');
        } else {
            showToast('🚫 ' + limitReachedError);
        }
    }

    // Limpiar registros sincronizados del cache offline
    const stillPending = records.filter(r => !r.synced);
    saveOfflineRecords(stillPending);
    
    if (btn) { btn.innerHTML = originalHTML; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    updateUI();
    if (synced > 0) showToast(`✅ ${synced} registros sincronizados.`);
}

// ─── Guardar nuevo registro ──────────────────────────────────
let _entryFormBound = false; // Evitar doble binding

function bindEntryForm() {
    const form = document.getElementById('entryForm');
    if (!form) {
        console.error('[VETFIELD] ❌ No se encontró el formulario #entryForm en el DOM.');
        return;
    }
    if (_entryFormBound) return; // Ya está vinculado
    _entryFormBound = true;
    console.log('[VETFIELD] ✅ Event listener de #entryForm registrado correctamente.');

    // Add dirty tracking listeners
    form.addEventListener('input', function(e) {
        if (e.target) {
            e.target.dataset.dirty = 'true';
        }
    });
    form.addEventListener('change', function(e) {
        if (e.target) {
            e.target.dataset.dirty = 'true';
        }
    });

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        console.log('[VETFIELD] 📝 Submit del formulario detectado.');
        
        const establecimientoVal = document.getElementById('f_establecimiento').value;
        const productorVal       = document.getElementById('f_productor').value;
        const fechaVal           = document.getElementById('f_fecha').value;
        const rpTerneroVal       = document.getElementById('f_rp_ternero').value.trim();

        // matchedRecord ya no se usa para auto-update silencioso.
        // La detección de duplicado ahora la hace el servidor y devuelve conflict:true.
        let matchedRecord = null;

        // ── Construir el registro nuevo desde el formulario ──────────────────
        const isVivo = document.querySelector('input[name="survival"]:checked').value === 'Vivo';
        const catVal = isVivo ? '' : document.getElementById('f_causa_categoria_val').value;
        const espVal = isVivo ? '' : (catVal === 'Otra Causa'
            ? document.getElementById('f_causa_especifica_custom').value.trim()
            : document.getElementById('f_causa_especifica').value);

        const estSaludVal = isVivo ? (document.getElementById('f_estado_salud')?.value || 'Sano, sin problemas aparentes') : null;
        const detSaludVal = (isVivo && estSaludVal !== 'Sano, sin problemas aparentes') ? (document.getElementById('f_detalle_salud')?.value.trim() || '') : null;
        if (detSaludVal) saveCustomSaludTerm(detSaludVal);

        const newRecord = {
            establecimiento: establecimientoVal,
            fecha:           fechaVal,
            productor:       productorVal,
            rp_ternero:      rpTerneroVal,
            ig_ternero:      document.getElementById('f_ig_ternero').value,
            sexo:            document.getElementById('f_sexo_val').value,
            ombligo:         document.getElementById('f_ombligo_val').value,
            tipo_madre:      document.getElementById('f_tipo_madre').value,
            tipo_parto:      (document.getElementById('f_tipo_parto_val')?.value) || 'Normal',
            rp_madre:        document.getElementById('f_rp_madre').value,
            tipo_calostro:   (document.getElementById('f_tipo_calostro_val')?.value) || 'De la madre',
            metodo_calostrado: (document.getElementById('f_metodo_calostrado_val')?.value) || 'Con mamadera',
            ig_calostro:     document.getElementById('f_ig_calostro').value,
            estado:          document.querySelector('input[name="survival"]:checked').value,
            estado_salud:    estSaludVal,
            detalle_salud:   detSaludVal,
            causa:           isVivo ? '' : (catVal && espVal ? `${catVal} - ${espVal}` : (catVal || espVal || '')),
            causa_categoria: catVal,
            causa_especifica:espVal,
            synced:          false,
            _local_id:       Date.now(),
        };

        // Guardar el record pendiente en la variable global por si el popup necesita retomarlo
        _pendingNewRecord = newRecord;

        console.log('[VETFIELD] 📦 Registro nuevo a guardar:', JSON.stringify(newRecord));

        if (navigator.onLine) {
            const btnSave = form.querySelector('.btn-save');
            if (btnSave) btnSave.disabled = true;

            const res = await apiFetchApp(API_RECORDS, {
                method: 'POST',
                body: JSON.stringify({ action: 'save', ...newRecord }),
            });

            console.log('[VETFIELD] 🔄 Respuesta de la API:', JSON.stringify(res));

            if (res.ok) {
                newRecord.id     = res.id;
                newRecord.synced = true;
                records.unshift(newRecord);
                showToast('✅ Registro guardado en la nube.');
                _pendingNewRecord = null;
            } else if (res.conflict) {
                // ── El servidor detectó un RP duplicado → mostrar popup ──────
                _pendingConflictExisting = res.existing; // guarda info del existente
                _showRpConflictModal(res.existing, rpTerneroVal);
                if (btnSave) btnSave.disabled = false;
                return; // no limpiar el formulario todavía
            } else if (res._httpStatus === 403) {
                console.warn('[VETFIELD] 🚫 Límite del plan alcanzado:', res.error);
                if (typeof showAlert === 'function') {
                    showAlert('Límite del Plan', res.error, 'info');
                } else {
                    showToast('🚫 ' + res.error);
                }
            } else {
                console.warn('[VETFIELD] ⚠️ API falló, guardando offline. Error:', res.error);
                _saveOffline(newRecord, establecimientoVal, productorVal);
                showToast('⚠️ Error al guardar en nube. Guardado localmente.');
                _pendingNewRecord = null;
            }

            if (btnSave) btnSave.disabled = false;
        } else {
            _saveOffline(newRecord, establecimientoVal, productorVal);
            showToast('💾 Sin conexión. Registro guardado localmente.');
            _pendingNewRecord = null;
        }


        // Add to datalists if not exists
        if (establecimientoVal && !establecimientos.includes(establecimientoVal)) establecimientos.push(establecimientoVal);
        if (productorVal && !productores.includes(productorVal)) productores.push(productorVal);
        if (productorVal && establecimientoVal) {
            if (!establecimientos_por_productor[productorVal]) establecimientos_por_productor[productorVal] = [];
            if (!establecimientos_por_productor[productorVal].includes(establecimientoVal)) establecimientos_por_productor[productorVal].push(establecimientoVal);
        }

        lastEntry = { establecimiento: establecimientoVal, productor: productorVal, fecha: fechaVal };
        localStorage.setItem(KEYS.lastEntry, JSON.stringify(lastEntry));

        renderFieldDatalists();
        form.reset();
        form.querySelectorAll('[data-dirty]').forEach(el => delete el.dataset.dirty);
        // Resetear segmented control de tipo de parto a Normal
        const partoParent = document.getElementById('f_tipo_parto');
        if (partoParent) {
            partoParent.querySelectorAll('.segmented-btn').forEach((b, idx) => {
                b.classList.toggle('active', idx === 0);
            });
            const pVal = document.getElementById('f_tipo_parto_val');
            if (pVal) pVal.value = 'Normal';
        }
        // Resetear segmented control de tipo de calostro a De la madre
        const calostroParent = document.getElementById('f_tipo_calostro');
        if (calostroParent) {
            calostroParent.querySelectorAll('.segmented-btn').forEach((b, idx) => {
                b.classList.toggle('active', idx === 0);
            });
            const cVal = document.getElementById('f_tipo_calostro_val');
            if (cVal) cVal.value = 'De la madre';
        }
        // Resetear segmented control de método de calostrado a Con mamadera
        const metodoCalostroParent = document.getElementById('f_metodo_calostrado');
        if (metodoCalostroParent) {
            metodoCalostroParent.querySelectorAll('.segmented-btn').forEach((b, idx) => {
                b.classList.toggle('active', idx === 0);
            });
            const mcVal = document.getElementById('f_metodo_calostrado_val');
            if (mcVal) mcVal.value = 'Con mamadera';
        }
        const estSaludEl = document.getElementById('f_estado_salud');
        if (estSaludEl) estSaludEl.value = 'Sano, sin problemas aparentes';
        const detSaludEl = document.getElementById('f_detalle_salud');
        if (detSaludEl) detSaludEl.value = '';
        toggleDetalleSalud('Sano, sin problemas aparentes');
        initForm();
        toggleCausa(false);
        updateUI();
        switchView('inicio');
    });
}

// Intentar vincular inmediatamente (para cuando el script se ejecuta con defer y el DOM ya está listo)
bindEntryForm();

function _saveOffline(record, establecimientoVal, productorVal) {
    records.unshift(record);
    const offline = getOfflineRecords();
    offline.unshift(record);
    saveOfflineRecords(offline);
    if (establecimientoVal && !establecimientos.includes(establecimientoVal)) establecimientos.push(establecimientoVal);
    if (productorVal && !productores.includes(productorVal)) productores.push(productorVal);
    
    if (productorVal && establecimientoVal) {
        if (!establecimientos_por_productor[productorVal]) establecimientos_por_productor[productorVal] = [];
        if (!establecimientos_por_productor[productorVal].includes(establecimientoVal)) establecimientos_por_productor[productorVal].push(establecimientoVal);
    }
}

// ─── Modal de detalles (editable) ────────────────────────────
let _currentEditId = null; // ID del registro que se está editando

function openDetail(recordId) {
    const r = records.find(rec => (rec.id || rec._local_id) == recordId);
    if (!r) return;

    _currentEditId = recordId;

    // Restablecer el estado de los botones para evitar que queden en "Guardando..." o "Eliminando..."
    const saveBtn = document.getElementById('modal-save-btn');
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar Cambios';
    }
    const deleteBtn = document.getElementById('modal-delete-btn');
    if (deleteBtn) {
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Eliminar Registro';
    }

    document.getElementById('modalTitle').textContent    = `Ternero R.P. ${r.rp_ternero || 'S/N'}`;
    document.getElementById('modalSubtitle').textContent = `${r.establecimiento || ''} • ${r.fecha || ''}`;

    const estadoOpts = ['Vivo', 'Muerto en Establecimiento', 'Muerto en Guachería', 'Muerto en Terapia'];
    const estadoOptionsHtml = estadoOpts.map(o =>
        `<option value="${o}" ${r.estado === o ? 'selected' : ''}>${o}</option>`
    ).join('');

    const causaCatOpts = ['', 'Enfermedades e Infecciones', 'Problemas Digestivos y Metabólicos', 'Factores Externos y de Manejo', 'Otra Causa'];
    const causaCatOptionsHtml = causaCatOpts.map(o =>
        `<option value="${o}" ${r.causa_categoria === o ? 'selected' : ''}>${o || '— Ninguna —'}</option>`
    ).join('');

    // Generar opciones de causa específica para la categoría actual
    const causaEspOpts = r.causa_categoria && opcionesCausa[r.causa_categoria]
        ? opcionesCausa[r.causa_categoria]
        : [];
    const causaEspOptionsHtml = ['', ...causaEspOpts].map(o =>
        `<option value="${o}" ${r.causa_especifica === o ? 'selected' : ''}>${o || '— Ninguna —'}</option>`
    ).join('');

    const body = document.getElementById('modalBody');
    body.innerHTML = `
        <!-- CAJA 1: INFORMACIÓN GENERAL -->
        <div class="modal-section-card">
            <span class="section-label">Información General</span>
            <div class="modal-card-grid">
                <div class="form-group col-span-2">
                    <label>Productor</label>
                    <input id="edit_productor" list="productor-list" value="${escHtml(r.productor || '')}">
                </div>
                <div class="form-group">
                    <label>Fecha</label>
                    <input id="edit_fecha" type="date" value="${escHtml(r.fecha || '')}">
                </div>
                <div class="form-group">
                    <label>Establecimiento</label>
                    <input id="edit_establecimiento" list="establecimiento-list" value="${escHtml(r.establecimiento || '')}">
                </div>
            </div>
        </div>

        <!-- CAJA 2: DATOS DEL TERNERO -->
        <div class="modal-section-card">
            <span class="section-label">Datos del Ternero</span>
            <div class="modal-card-grid">
                <div class="form-group">
                    <label>R.P. Ternero</label>
                    <input id="edit_rp_ternero" value="${escHtml(r.rp_ternero || '')}">
                </div>
                <div class="form-group">
                    <label>Nivel I.G. (%)</label>
                    <input id="edit_ig_ternero" type="number" step="0.1" value="${r.ig_ternero ?? ''}">
                </div>
                <div class="form-group">
                    <label>Sexo</label>
                    <select id="edit_sexo">
                        <option value="Macho" ${r.sexo === 'Macho' ? 'selected' : ''}>Macho</option>
                        <option value="Hembra" ${r.sexo === 'Hembra' ? 'selected' : ''}>Hembra</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Estado Ombligo</label>
                    <select id="edit_ombligo">
                        <option value="Bueno" ${r.ombligo === 'Bueno' ? 'selected' : ''}>Bueno</option>
                        <option value="Regular" ${r.ombligo === 'Regular' ? 'selected' : ''}>Regular</option>
                        <option value="Malo" ${r.ombligo === 'Malo' ? 'selected' : ''}>Malo</option>
                    </select>
                </div>
            </div>
        </div>

        <!-- CAJA 3: DATOS DE LA MADRE Y PARTO -->
        <div class="modal-section-card">
            <span class="section-label">Datos de la Madre y Parto</span>
            <div class="modal-card-grid">
                <div class="form-group">
                    <label>Tipo Madre</label>
                    <select id="edit_tipo_madre">
                        <option value="Vaca" ${r.tipo_madre === 'Vaca' ? 'selected' : ''}>Vaca</option>
                        <option value="Vaquillona" ${r.tipo_madre === 'Vaquillona' ? 'selected' : ''}>Vaquillona</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Tipo de Parto</label>
                    <select id="edit_tipo_parto">
                        <option value="Normal" ${(!r.tipo_parto || r.tipo_parto === 'Normal') ? 'selected' : ''}>Normal</option>
                        <option value="Asistido" ${r.tipo_parto === 'Asistido' ? 'selected' : ''}>Asistido</option>
                        <option value="Muerto al parto" ${r.tipo_parto === 'Muerto al parto' ? 'selected' : ''}>Muerto al parto</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>R.P. Madre</label>
                    <input id="edit_rp_madre" value="${escHtml(r.rp_madre || '')}">
                </div>
                <div class="form-group">
                    <label>Tipo de Calostro</label>
                    <select id="edit_tipo_calostro">
                        <option value="De la madre" ${(!r.tipo_calostro || r.tipo_calostro === 'De la madre') ? 'selected' : ''}>De la madre</option>
                        <option value="Banco de calostro" ${r.tipo_calostro === 'Banco de calostro' ? 'selected' : ''}>Banco de calostro</option>
                        <option value="Calostro mejorado" ${r.tipo_calostro === 'Calostro mejorado' ? 'selected' : ''}>Calostro mejorado</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Método de Calostrado</label>
                    <select id="edit_metodo_calostrado">
                        <option value="Con mamadera" ${(!r.metodo_calostrado || r.metodo_calostrado === 'Con mamadera') ? 'selected' : ''}>Con mamadera</option>
                        <option value="Con sonda" ${r.metodo_calostrado === 'Con sonda' ? 'selected' : ''}>Con sonda</option>
                        <option value="Mamó solo" ${r.metodo_calostrado === 'Mamó solo' ? 'selected' : ''}>Mamó solo</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>I.G. Calostro (${(typeof AuthManager !== 'undefined' && AuthManager.getIgMetodo() === 'brix') ? '% Brix' : 'mg/dL'})</label>
                    <input id="edit_ig_calostro" type="number" step="0.1" value="${r.ig_calostro ?? ''}">
                </div>
            </div>
        </div>

        <!-- CAJA 4: ESTADO DE SUPERVIVENCIA -->
        <div class="modal-section-card">
            <span class="section-label">Estado de Supervivencia</span>
            <div class="modal-card-grid">
                <div class="form-group col-span-2">
                    <label>Supervivencia</label>
                    <select id="edit_estado" onchange="toggleEditCausa(this.value)">
                        ${estadoOptionsHtml}
                    </select>
                </div>
                <div class="form-group col-span-2" id="edit_salud_group" style="${r.estado === 'Vivo' ? '' : 'display:none;'}">
                    <label>Condición Sanitaria / Salud (Animal Vivo)</label>
                    <select id="edit_estado_salud" onchange="toggleEditDetalleSalud(this.value)">
                        <option value="Sano, sin problemas aparentes" ${(!r.estado_salud || r.estado_salud === 'Sano, sin problemas aparentes') ? 'selected' : ''}>Sano, sin problemas aparentes</option>
                        <option value="Nació con algún problema o malformación" ${r.estado_salud === 'Nació con algún problema o malformación' ? 'selected' : ''}>Nació con algún problema o malformación</option>
                        <option value="Está enfermo actualmente" ${r.estado_salud === 'Está enfermo actualmente' ? 'selected' : ''}>Está enfermo actualmente</option>
                        <option value="Tuvo una enfermedad anteriormente" ${r.estado_salud === 'Tuvo una enfermedad anteriormente' ? 'selected' : ''}>Tuvo una enfermedad anteriormente</option>
                    </select>
                </div>
                <div class="form-group col-span-2" id="edit_detalle_salud_group" style="${(r.estado === 'Vivo' && r.estado_salud && r.estado_salud !== 'Sano, sin problemas aparentes') ? '' : 'display:none;'}">
                    <label id="edit_detalle_salud_label">Especifique el problema o enfermedad</label>
                    <input id="edit_detalle_salud" list="salud_sugerencias_list" value="${escHtml(r.detalle_salud || '')}" placeholder="Escriba o elija una sugerencia...">
                </div>
                <div class="form-group ${(!r.causa_categoria || r.causa_categoria === 'Otra Causa') ? 'col-span-2' : ''}" id="edit_causa_cat_group" style="${r.estado !== 'Vivo' ? '' : 'display:none;'}">
                    <label>Categoría Muerte</label>
                    <select id="edit_causa_categoria" onchange="refreshEditCausaEsp(this.value)">
                        ${causaCatOptionsHtml}
                    </select>
                </div>
                <div class="form-group" id="edit_causa_esp_group" style="${(r.estado !== 'Vivo' && r.causa_categoria && r.causa_categoria !== 'Otra Causa') ? '' : 'display:none;'}">
                    <label>Causa Específica</label>
                    <select id="edit_causa_especifica">
                        ${causaEspOptionsHtml}
                    </select>
                </div>
                <div class="form-group col-span-2" id="edit_causa_custom_group" style="${(r.estado !== 'Vivo' && r.causa_categoria === 'Otra Causa') ? '' : 'display:none;'}">
                    <label>Especifique la Causa</label>
                    <input id="edit_causa_especifica_custom" value="${escHtml(r.causa_categoria === 'Otra Causa' ? r.causa_especifica || '' : '')}">
                </div>
            </div>
        </div>
        <div id="edit_save_error" style="color:#dc2626; font-size:0.85rem; display:none; text-align:center; padding: 10px;"></div>
    `;

    document.getElementById('detailModal').classList.add('active');
}

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toggleEditCausa(estado) {
    const catGroup = document.getElementById('edit_causa_cat_group');
    const espGroup = document.getElementById('edit_causa_esp_group');
    const customGroup = document.getElementById('edit_causa_custom_group');
    const saludGroup = document.getElementById('edit_salud_group');
    const detalleSaludGroup = document.getElementById('edit_detalle_salud_group');
    if (!catGroup) return;
    if (estado === 'Vivo') {
        catGroup.style.display = 'none';
        espGroup.style.display = 'none';
        if (customGroup) customGroup.style.display = 'none';
        if (saludGroup) saludGroup.style.display = '';
        toggleEditDetalleSalud(document.getElementById('edit_estado_salud')?.value);
    } else {
        if (saludGroup) saludGroup.style.display = 'none';
        if (detalleSaludGroup) detalleSaludGroup.style.display = 'none';
        catGroup.style.display = '';
        const cat = document.getElementById('edit_causa_categoria').value;
        if (cat === 'Otra Causa') {
            catGroup.classList.add('col-span-2');
            espGroup.style.display = 'none';
            if (customGroup) customGroup.style.display = '';
        } else {
            catGroup.classList.toggle('col-span-2', !cat);
            espGroup.style.display = cat ? '' : 'none';
            if (customGroup) customGroup.style.display = 'none';
        }
    }
}

function refreshEditCausaEsp(cat) {
    const catGroup = document.getElementById('edit_causa_cat_group');
    const espGroup = document.getElementById('edit_causa_esp_group');
    const espSelect = document.getElementById('edit_causa_especifica');
    const customGroup = document.getElementById('edit_causa_custom_group');
    if (!espGroup) return;
    if (!cat) {
        if (catGroup) catGroup.classList.add('col-span-2');
        espGroup.style.display = 'none';
        if (customGroup) customGroup.style.display = 'none';
        return;
    }
    if (cat === 'Otra Causa') {
        if (catGroup) catGroup.classList.add('col-span-2');
        espGroup.style.display = 'none';
        if (customGroup) customGroup.style.display = '';
    } else {
        if (catGroup) catGroup.classList.remove('col-span-2');
        if (customGroup) customGroup.style.display = 'none';
        espGroup.style.display = '';
        if (espSelect) {
            const opts = opcionesCausa[cat] || [];
            espSelect.innerHTML = ['', ...opts].map(o =>
                `<option value="${o}">${o || '— Ninguna —'}</option>`
            ).join('');
        }
    }
}


async function saveDetail() {
    const r = records.find(rec => (rec.id || rec._local_id) == _currentEditId);
    if (!r) return;

    const errEl = document.getElementById('edit_save_error');
    const saveBtn = document.getElementById('modal-save-btn');

    const estado = document.getElementById('edit_estado').value;
    const estSaludEdit = estado === 'Vivo' ? (document.getElementById('edit_estado_salud')?.value || 'Sano, sin problemas aparentes') : null;
    const detSaludEdit = (estado === 'Vivo' && estSaludEdit !== 'Sano, sin problemas aparentes') ? (document.getElementById('edit_detalle_salud')?.value.trim() || '') : null;
    if (detSaludEdit) saveCustomSaludTerm(detSaludEdit);

    const causaCat = estado !== 'Vivo' ? (document.getElementById('edit_causa_categoria')?.value || '') : '';
    const causaEsp = estado !== 'Vivo' && causaCat 
        ? (causaCat === 'Otra Causa' 
            ? (document.getElementById('edit_causa_especifica_custom')?.value || '').trim() 
            : (document.getElementById('edit_causa_especifica')?.value || ''))
        : '';

    const updated = {
        id:              r.id,
        productor:       document.getElementById('edit_productor').value.trim(),
        ig_ternero:      document.getElementById('edit_ig_ternero').value,
        sexo:            document.getElementById('edit_sexo').value,
        ombligo:         document.getElementById('edit_ombligo').value,
        tipo_madre:      document.getElementById('edit_tipo_madre').value,
        tipo_parto:      document.getElementById('edit_tipo_parto')?.value || 'Normal',
        estado:          estado,
        estado_salud:    estSaludEdit,
        detalle_salud:   detSaludEdit,
        causa_categoria: causaCat,
        causa_especifica: causaEsp,
        causa:           causaCat && causaEsp ? `${causaCat} - ${causaEsp}` : (causaCat || causaEsp || ''),
        fecha:           document.getElementById('edit_fecha').value,
        establecimiento: document.getElementById('edit_establecimiento').value.trim(),
        rp_ternero:      document.getElementById('edit_rp_ternero').value.trim(),
        rp_madre:        document.getElementById('edit_rp_madre').value.trim(),
        tipo_calostro:   document.getElementById('edit_tipo_calostro')?.value || 'De la madre',
        metodo_calostrado: document.getElementById('edit_metodo_calostrado')?.value || 'Con mamadera',
        ig_calostro:     document.getElementById('edit_ig_calostro').value,
    };

    if (!updated.productor) {
        if (errEl) { errEl.textContent = 'El campo Productor es obligatorio.'; errEl.style.display = ''; }
        return;
    }

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }
    if (errEl) errEl.style.display = 'none';

    let saved = false;

    if (r.id && navigator.onLine) {
        // Guardar en la BD vía API
        const res = await apiFetchApp(API_RECORDS, {
            method: 'POST',
            body: JSON.stringify({ action: 'update', ...updated }),
        });
        if (res.ok) {
            saved = true;
        } else {
            if (errEl) { errEl.textContent = res.error || 'Error al guardar en el servidor.'; errEl.style.display = ''; }
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar Cambios'; }
            return;
        }
    } else if (!r.id) {
        // Registro solo local (offline) — actualizar en localStorage
        saved = true;
    } else {
        if (errEl) { errEl.textContent = 'Sin conexión. Conectate a internet para guardar cambios.'; errEl.style.display = ''; }
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar Cambios'; }
        return;
    }

    if (saved) {
        // Actualizar en memoria
        Object.assign(r, updated);
        // Si era offline, actualizar localStorage también
        if (!r.id) {
            const offline = getOfflineRecords();
            const idx = offline.findIndex(o => o._local_id === r._local_id);
            if (idx !== -1) { Object.assign(offline[idx], updated); saveOfflineRecords(offline); }
        }
        closeModal();
        renderTable();
        updateUI();
        showToast('✅ Registro actualizado correctamente.');
    }
}

async function deleteDetail() {
    if (!_currentEditId) return;

    const r = records.find(rec => (rec.id || rec._local_id) == _currentEditId);
    if (!r) return;

    const confirmMsg = `¿Estás seguro de que deseas eliminar este registro?\n` +
                       `Ternero R.P. ${r.rp_ternero || 'S/N'}\n` +
                       `Esta acción no se puede deshacer.`;
    
    if (!confirm(confirmMsg)) return;

    const errEl = document.getElementById('edit_save_error');
    const deleteBtn = document.getElementById('modal-delete-btn');
    const saveBtn = document.getElementById('modal-save-btn');

    if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.textContent = 'Eliminando...'; }
    if (saveBtn) saveBtn.disabled = true;
    if (errEl) errEl.style.display = 'none';

    let deleted = false;

    if (r.id) {
        if (navigator.onLine) {
            // Eliminar en la BD vía API
            const res = await apiFetchApp(API_RECORDS, {
                method: 'POST',
                body: JSON.stringify({ action: 'delete', id: r.id }),
            });
            if (res.ok) {
                deleted = true;
            } else {
                if (errEl) { errEl.textContent = res.error || 'Error al eliminar el registro del servidor.'; errEl.style.display = ''; }
                if (deleteBtn) { deleteBtn.disabled = false; deleteBtn.textContent = 'Eliminar Registro'; }
                if (saveBtn) saveBtn.disabled = false;
                return;
            }
        } else {
            if (errEl) { errEl.textContent = 'Sin conexión. Conectate a internet para eliminar este registro.'; errEl.style.display = ''; }
            if (deleteBtn) { deleteBtn.disabled = false; deleteBtn.textContent = 'Eliminar Registro'; }
            if (saveBtn) saveBtn.disabled = false;
            return;
        }
    } else {
        // Registro solo local (offline) — eliminar de localStorage
        deleted = true;
    }

    if (deleted) {
        // Actualizar en memoria
        records = records.filter(rec => (rec.id || rec._local_id) !== _currentEditId);
        
        // Si era offline, actualizar localStorage también
        const offline = getOfflineRecords();
        const filteredOffline = offline.filter(o => (o.id || o._local_id) !== _currentEditId);
        saveOfflineRecords(filteredOffline);

        closeModal();
        renderTable();
        updateUI();
        showToast('🗑️ Registro eliminado correctamente.');
    }
}
window.deleteDetail = deleteDetail;

function closeModal() {
    document.getElementById('detailModal').classList.remove('active');
    _currentEditId = null;
}

// ─── Lógica de Filtros ────────────────────────────────────────

function getFilteredRecords() {
    const searchTerm     = document.getElementById('searchEstablecimiento')?.value.toLowerCase() || '';
    const searchRp       = document.getElementById('searchRp')?.value.trim().toLowerCase() || '';
    const productorFilter = document.getElementById('filterProductor')?.value || '';
    const dateFrom       = document.getElementById('filterDateFrom')?.value || '';
    const dateTo         = document.getElementById('filterDateTo')?.value || '';
    const estadoFilter   = document.getElementById('filterEstado')?.value || '';
    const madreFilter    = document.getElementById('filterCategoriaMadre')?.value || '';
    const tipoPartoFilter = document.getElementById('filterTipoParto')?.value || '';
    const tipoCalostroFilter = document.getElementById('filterTipoCalostro')?.value || '';
    const metodoCalostroFilter = document.getElementById('filterMetodoCalostrado')?.value || '';
    const riesgoFilter   = document.getElementById('filterRiesgoSanitario')?.value || '';
    const saludFilter    = document.getElementById('filterEstadoSalud')?.value || '';

    return records.filter(r => {
        const matchEstablecimiento = !searchTerm || (r.establecimiento && r.establecimiento.toLowerCase().includes(searchTerm));
        const matchRp             = !searchRp || (r.rp_ternero && String(r.rp_ternero).toLowerCase().includes(searchRp));
        const matchProductor      = !productorFilter || r.productor === productorFilter;
        
        let matchDate = true;
        if (dateFrom && r.fecha < dateFrom) matchDate = false;
        if (dateTo && r.fecha > dateTo) matchDate = false;
        
        let matchEstado = true;
        if (estadoFilter === 'Vivo' && r.estado !== 'Vivo') matchEstado = false;
        if (estadoFilter === 'Muerto' && r.estado === 'Vivo') matchEstado = false;
        
        let matchMadre = true;
        if (madreFilter && r.tipo_madre !== madreFilter) matchMadre = false;

        let matchParto = true;
        if (tipoPartoFilter && (r.tipo_parto || 'Normal') !== tipoPartoFilter) matchParto = false;

        let matchCalostro = true;
        if (tipoCalostroFilter && (r.tipo_calostro || 'De la madre') !== tipoCalostroFilter) matchCalostro = false;

        let matchMetodoCalostro = true;
        if (metodoCalostroFilter && (r.metodo_calostrado || 'Con mamadera') !== metodoCalostroFilter) matchMetodoCalostro = false;
        
        let matchRiesgo = true;
        if (riesgoFilter === 'Alto') {
            // Bug Fix #4: Si ig_ternero está vacío/ausente también se considera riesgo alto
            const ig = parseFloat(r.ig_ternero);
            const isMissingIg = r.ig_ternero === '' || r.ig_ternero === null || r.ig_ternero === undefined || isNaN(ig);
            const isLowIg    = !isNaN(ig) && ig <= 10;
            const isBadNavel = r.ombligo === 'Malo' || r.ombligo === 'Regular';
            if (!isMissingIg && !isLowIg && !isBadNavel) matchRiesgo = false;
        }

        let matchSalud = true;
        if (saludFilter) {
            if (saludFilter === 'Sano') {
                matchSalud = r.estado === 'Vivo' && (!r.estado_salud || r.estado_salud === 'Sano, sin problemas aparentes');
            } else if (saludFilter === 'Enfermo') {
                matchSalud = r.estado === 'Vivo' && r.estado_salud === 'Está enfermo actualmente';
            } else if (saludFilter === 'Previa') {
                matchSalud = r.estado === 'Vivo' && r.estado_salud === 'Tuvo una enfermedad anteriormente';
            } else if (saludFilter === 'Malformacion') {
                matchSalud = r.estado === 'Vivo' && r.estado_salud === 'Nació con algún problema o malformación';
            }
        }

        return matchEstablecimiento && matchRp && matchProductor && matchDate && matchEstado && matchMadre && matchParto && matchCalostro && matchMetodoCalostro && matchRiesgo && matchSalud;
    });
}

function checkSavedFilterState() {
    const btnLoad = document.getElementById('btn-load-filter');
    if (!btnLoad) return;
    const saved = localStorage.getItem('vf_saved_filter');
    if (saved) {
        btnLoad.classList.remove('hidden');
    } else {
        btnLoad.classList.add('hidden');
    }
}

function setQuickDate(range) {
    const fromInput = document.getElementById('filterDateFrom');
    const toInput   = document.getElementById('filterDateTo');
    if (!fromInput || !toInput) return;
    
    const end = new Date();
    toInput.value = end.toISOString().split('T')[0];
    
    if (range === 'hoy') {
        fromInput.value = end.toISOString().split('T')[0];
    } else if (range === 'semana') {
        const start = new Date(end);
        const day = start.getDay();
        const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Lunes
        start.setDate(diff);
        fromInput.value = start.toISOString().split('T')[0];
    } else if (range === 'mes') {
        const start = new Date(end);
        start.setDate(start.getDate() - 30);
        fromInput.value = start.toISOString().split('T')[0];
    }
    filterTable();
}

function clearFilters() {
    ['filterProductor', 'searchEstablecimiento', 'searchRp', 'filterDateFrom', 'filterDateTo', 
     'filterEstado', 'filterCategoriaMadre', 'filterTipoParto', 'filterTipoCalostro', 'filterMetodoCalostrado', 'filterRiesgoSanitario', 'filterEstadoSalud'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    filterTable();
}

function saveReportFilter() {
    const filterState = {
        productor: document.getElementById('filterProductor')?.value || '',
        establecimiento: document.getElementById('searchEstablecimiento')?.value || '',
        rp: document.getElementById('searchRp')?.value || '',
        dateFrom: document.getElementById('filterDateFrom')?.value || '',
        dateTo: document.getElementById('filterDateTo')?.value || '',
        estado: document.getElementById('filterEstado')?.value || '',
        madre: document.getElementById('filterCategoriaMadre')?.value || '',
        parto: document.getElementById('filterTipoParto')?.value || '',
        calostro: document.getElementById('filterTipoCalostro')?.value || '',
        calostrado: document.getElementById('filterMetodoCalostrado')?.value || '',
        riesgo: document.getElementById('filterRiesgoSanitario')?.value || '',
        salud: document.getElementById('filterEstadoSalud')?.value || ''
    };
    localStorage.setItem('vf_saved_filter', JSON.stringify(filterState));
    showToast('Filtro guardado en favoritos');
    checkSavedFilterState();
}

function loadReportFilter() {
    const saved = localStorage.getItem('vf_saved_filter');
    if (!saved) return;
    
    const filterState = JSON.parse(saved);
    
    if (document.getElementById('filterProductor')) document.getElementById('filterProductor').value = filterState.productor || '';
    if (document.getElementById('searchEstablecimiento')) document.getElementById('searchEstablecimiento').value = filterState.establecimiento || '';
    if (document.getElementById('searchRp')) document.getElementById('searchRp').value = filterState.rp || '';
    if (document.getElementById('filterDateFrom')) document.getElementById('filterDateFrom').value = filterState.dateFrom || '';
    if (document.getElementById('filterDateTo')) document.getElementById('filterDateTo').value = filterState.dateTo || '';
    if (document.getElementById('filterEstado')) document.getElementById('filterEstado').value = filterState.estado || '';
    if (document.getElementById('filterCategoriaMadre')) document.getElementById('filterCategoriaMadre').value = filterState.madre || '';
    if (document.getElementById('filterTipoParto')) document.getElementById('filterTipoParto').value = filterState.parto || '';
    if (document.getElementById('filterTipoCalostro')) document.getElementById('filterTipoCalostro').value = filterState.calostro || '';
    if (document.getElementById('filterMetodoCalostrado')) document.getElementById('filterMetodoCalostrado').value = filterState.calostrado || '';
    if (document.getElementById('filterRiesgoSanitario')) document.getElementById('filterRiesgoSanitario').value = filterState.riesgo || '';
    if (document.getElementById('filterEstadoSalud')) document.getElementById('filterEstadoSalud').value = filterState.salud || '';
    
    filterTable();
}

// ─── Tabla de reportes ───────────────────────────────────────
function renderTable() {
    const tbody = document.getElementById('reportTableBody');
    if (!tbody) return;

    // Bug Fix #1 & #2: Repoblar filterProductor ANTES de filtrar,
    // preservando la selección actual correctamente.
    const producorSelect = document.getElementById('filterProductor');
    const productorFilter = producorSelect?.value || '';

    if (producorSelect) {
        const producers = [...new Set(records.map(r => r.productor))].filter(p => p);
        producorSelect.innerHTML = '<option value="">Todos los Productores</option>';
        producers.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p; opt.textContent = p;
            if (p === productorFilter) opt.selected = true;
            producorSelect.appendChild(opt);
        });
        // Restaurar selección explícitamente por si el rebuild la borró
        if (productorFilter) producorSelect.value = productorFilter;
    }

    // Bug Fix #3: Poblar el datalist de búsqueda de Establecimiento en reportes
    // Filtrado según el productor seleccionado actualmente
    const estFilterList = document.getElementById('establecimiento-filter-list');
    if (estFilterList) {
        let estOptions;
        if (productorFilter && establecimientos_por_productor[productorFilter] && establecimientos_por_productor[productorFilter].length > 0) {
            estOptions = establecimientos_por_productor[productorFilter];
        } else {
            estOptions = [...new Set(records.map(r => r.establecimiento))].filter(e => e);
        }
        estFilterList.innerHTML = '';
        estOptions.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e;
            estFilterList.appendChild(opt);
        });
        // Si el valor actual del buscador no pertenece al productor, limpiarlo
        const searchEstEl = document.getElementById('searchEstablecimiento');
        if (searchEstEl && searchEstEl.value && !estOptions.some(e => e.toLowerCase().includes(searchEstEl.value.toLowerCase()))) {
            searchEstEl.value = '';
        }
    }

    // Filtrar DESPUÉS de repoblar los selects
    let filtered = getFilteredRecords();

    const reportContext = document.getElementById('reportContext');
    if (reportContext) {
        const plural = filtered.length === 1 ? 'registro activo' : 'registros activos';
        reportContext.textContent = `Mostrando ${filtered.length} ${plural}`;
    }

    tbody.innerHTML = '';
    filtered.forEach(r => {
        const rid   = r.id || r._local_id;
        const vivo  = r.estado === 'Vivo';

        // Fecha: puede venir null (registros viejos), vacío o 'YYYY-MM-DD'
        let fechaStr = '-';
        if (r.fecha) {
            const d = new Date(r.fecha + 'T12:00:00'); // T12 evita desfase de timezone
            if (!isNaN(d)) fechaStr = d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit' });
        }

        let saludBadge = '';
        if (vivo && r.estado_salud && r.estado_salud !== 'Sano, sin problemas aparentes') {
            const shortLabel = r.estado_salud === 'Está enfermo actualmente' ? 'Enfermo' : (r.estado_salud === 'Tuvo una enfermedad anteriormente' ? 'Recuperado' : 'Problema al nacer');
            const det = r.detalle_salud ? `: ${escHtml(r.detalle_salud)}` : '';
            saludBadge = `<div style="font-size:0.68rem;color:#b45309;font-weight:600;margin-top:3px;background:rgba(245,158,11,0.12);padding:2px 6px;border-radius:4px;display:inline-block;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(r.estado_salud + (r.detalle_salud ? ' - ' + r.detalle_salud : ''))}">⚠️ ${shortLabel}${det}</div>`;
        }

        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onclick = () => openDetail(rid);
        tr.innerHTML = `
            <td>
                <div style="font-size:0.85rem;font-weight:600;">${fechaStr}</div>
                <div style="font-size:0.7rem;color:${r.synced?'var(--secondary)':'#f59e0b'};font-weight:600;margin-top:2px;">
                    ${r.synced ? '● Sync' : '● Pendiente'}
                </div>
            </td>
            <td>
                <div style="font-weight:700;">${r.productor || '-'}</div>
                <div style="font-size:0.75rem;opacity:0.7;">${r.establecimiento}</div>
            </td>
            <td style="font-size:0.9rem;">
                <div style="font-weight:600;">${r.rp_ternero || '-'}</div>
                <div style="font-size:0.7rem;color:var(--text-secondary);font-weight:600;margin-top:2px;">
                    Parto: <span style="color:${(r.tipo_parto === 'Muerto al parto') ? '#dc2626' : (r.tipo_parto === 'Asistido' ? '#d97706' : 'var(--secondary)')};">${r.tipo_parto || 'Normal'}</span>
                </div>
            </td>
            <td>
                <div style="font-weight:700;color:var(--primary);">${r.ig_ternero ?? '-'}%</div>
                <span style="display:inline-block;margin-top:3px;padding:2px 8px;border-radius:99px;font-size:0.68rem;font-weight:700;
                    background:${vivo?'rgba(16,185,129,0.12)':'rgba(220,38,38,0.1)'};
                    color:${vivo?'var(--secondary)':'#dc2626'};">${r.estado}</span>
                ${saludBadge}
            </td>
        `;
        tbody.appendChild(tr);
    });

    
    checkSavedFilterState();
}

function filterTable() { renderTable(); }

// ─── Event listeners para filtros de Reportes ────────────────
let _reportFiltersBound = false;
function initReportFilters() {
    if (_reportFiltersBound) return;
    _reportFiltersBound = true;

    const changeIds = [
        'filterProductor',
        'filterDateFrom',
        'filterDateTo',
        'filterEstado',
        'filterCategoriaMadre',
        'filterTipoParto',
        'filterTipoCalostro',
        'filterMetodoCalostrado',
        'filterRiesgoSanitario',
        'filterEstadoSalud',
    ];
    changeIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', filterTable);
    });

    // Cuando cambia el productor, limpiar el campo de establecimiento y re-renderizar
    // (el datalist se actualiza dentro de renderTable con la nueva selección de productor)
    const producerEl = document.getElementById('filterProductor');
    if (producerEl) {
        producerEl.addEventListener('change', () => {
            const searchEstEl = document.getElementById('searchEstablecimiento');
            if (searchEstEl) searchEstEl.value = '';
            filterTable();
        });
    }

    // Input en tiempo real para búsqueda de Establecimiento
    const estEl = document.getElementById('searchEstablecimiento');
    if (estEl) estEl.addEventListener('input', filterTable);

    // Input en tiempo real para búsqueda de R.P.
    const rpEl = document.getElementById('searchRp');
    if (rpEl) rpEl.addEventListener('input', filterTable);
}

// ─── PDF ─────────────────────────────────────────────────────
async function generatePDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    let filteredRecords = getFilteredRecords();
    // Filtro para PDF: solo registros sincronizados
    filteredRecords = filteredRecords.filter(r => r.synced);

    const productorFilter = document.getElementById('filterProductor')?.value || '';

    if (filteredRecords.length === 0) { showToast('No hay registros sincronizados que coincidan con los filtros.'); return; }

    doc.setFillColor(26, 35, 126);
    doc.rect(0, 0, 210, 45, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    doc.text('VETFIELD PRO', 20, 25);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Sistema de Auditoría Veterinaria de Alta Precisión', 20, 35);
    doc.setFontSize(9);
    doc.text('FECHA DE REPORTE:', 150, 20);
    doc.setFontSize(12);
    doc.text(new Date().toLocaleDateString(), 150, 28);

    doc.setTextColor(26, 35, 126);
    doc.setFontSize(20);
    doc.text('INFORME ESTRATÉGICO DE CAMPO', 20, 65);

    doc.setFillColor(245, 246, 250);
    doc.rect(20, 75, 170, 20, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);

    const total  = filteredRecords.length;
    const avgIg  = (filteredRecords.reduce((a, b) => a + parseFloat(b.ig_ternero || 0), 0) / (total || 1)).toFixed(2);
    let subtext  = `Total Registros: ${total} | I.G. Promedio: ${avgIg}%`;
    if (productorFilter) subtext += ` | Productor: ${productorFilter}`;
    const searchRpFilter = document.getElementById('searchRp')?.value.trim() || '';
    if (searchRpFilter)  subtext += ` | R.P.: ${searchRpFilter}`;

    doc.text(subtext, 30, 87);

    doc.autoTable({
        startY: 105,
        head: [['Establecimiento', 'R.P.', 'I.G.', 'Estado / Salud', 'Parto', 'Calostro', 'Vía', 'Sexo', 'Ombligo']],
        body: filteredRecords.map(r => {
            let estText = r.estado;
            if (r.estado === 'Vivo' && r.estado_salud && r.estado_salud !== 'Sano, sin problemas aparentes') {
                estText += ` (${r.detalle_salud || r.estado_salud})`;
            }
            return [r.establecimiento, r.rp_ternero, (r.ig_ternero ? r.ig_ternero + '%' : '-'), estText, r.tipo_parto || 'Normal', r.tipo_calostro || 'De la madre', r.metodo_calostrado || 'Con mamadera', r.sexo, r.ombligo];
        }),
        theme: 'grid',
        headStyles: { fillColor: [26, 35, 126], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 8.5, cellPadding: 3.5 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    doc.save(`VETFIELD_REPORTE_${Date.now()}.pdf`);
    showToast('PDF Generado con Éxito');
}

// ─── Toast ───────────────────────────────────────────────────
function showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1e293b;color:white;
        padding:12px 24px;border-radius:99px;font-size:0.9rem;font-weight:600;
        box-shadow:0 10px 25px rgba(0,0,0,0.2);z-index:10000;animation:slideDown 0.3s ease-out;`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideUp 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ─── Alert Modal (Popup Premium) ──────────────────────────────
function showAlert(title, message, icon = 'info') {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(8px);
        display:flex;align-items:center;justify-content:center;z-index:11000;padding:20px;animation:fadeIn 0.3s ease-out;`;
    
    const modal = document.createElement('div');
    modal.style.cssText = `background:rgba(255,255,255,0.95);padding:30px;border-radius:24px;max-width:400px;width:100%;
        box-shadow:0 20px 50px rgba(0,0,0,0.2);text-align:center;animation:slideInUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);`;
    
    const iconHtml = icon === 'mail' 
        ? '<div style="font-size:3rem;margin-bottom:15px;">📬</div>'
        : '<div style="font-size:3rem;margin-bottom:15px;">ℹ️</div>';

    modal.innerHTML = `
        ${iconHtml}
        <h3 style="color:#1a237e;margin-bottom:12px;font-size:1.3rem;">${title}</h3>
        <p style="color:#64748b;font-size:0.95rem;line-height:1.6;margin-bottom:24px;">${message}</p>
        <button id="alert-close-btn" class="btn-auth-primary" style="margin-top:0;height:45px;">Entendido</button>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('alert-close-btn').onclick = () => {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.3s';
        setTimeout(() => overlay.remove(), 300);
    };
}
window.showAlert = showAlert;

// =============================================================
// BACKUP ACTIONS — Exportacion e Importacion de datos (Opcion 2)
// =============================================================

async function exportBackup(btnEl) {
    // Backup export solo disponible para Plan Premium (o cuentas legacy).
    const _sess = typeof AuthManager !== 'undefined' ? AuthManager.getSession() : null;
    const _plan = _sess ? _sess.plan : undefined;
    if (_plan === 'inicio' || _plan === 'pro') {
        showAlert(
            'Función exclusiva Premium',
            'La exportación de datos está disponible únicamente en el Plan Premium. Mejorá tu plan para acceder a esta función.',
            'info'
        );
        return;
    }

    if (!navigator.onLine) {
        showToast('Debes estar conectado a Internet para exportar datos.');
        return;
    }
    
    document.getElementById('exportModal').classList.add('active');
}

function closeExportModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('exportModal').classList.remove('active');
}

async function confirmExport(btnEl) {
    const radios = document.getElementsByName('exportFormat');
    let format = 'json';
    for (const r of radios) {
        if (r.checked) {
            format = r.value;
            break;
        }
    }
    
    const originalHTML = btnEl.innerHTML;
    btnEl.disabled = true;
    btnEl.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width:18px;height:18px;"></i> Generando...';
    if (window.lucide) window.lucide.createIcons();
    
    try {
        const res = await apiFetchApp(API_RECORDS + '?action=backup_export');
        if (res.ok) {
            if (format === 'json') {
                const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const dateStr = new Date().toISOString().split('T')[0];
                a.download = `vetfield_respaldo_${dateStr}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('Respaldo descargado con éxito.');
            } else if (format === 'xlsx') {
                await generateXlsxReport(res);
            } else if (format === 'zip') {
                await generateZipRecords(res);
            }
            closeExportModal();
        } else {
            showToast('Error al exportar los datos: ' + (res.error || 'Intente nuevamente.'));
        }
    } catch (err) {
        console.error(err);
        showToast('Error de red al exportar los datos.');
    } finally {
        btnEl.disabled = false;
        btnEl.innerHTML = originalHTML;
        if (window.lucide) window.lucide.createIcons();
    }
}

async function generateXlsxReport(res) {
    if (!window.XLSX) {
        showToast('Error: La librería de Excel no se pudo cargar.');
        return;
    }
    
    try {
        const data = res.data || {};
        const productores = data.productores || [];
        const establecimientos = data.establecimientos || [];
        const registros = data.registros || [];
        
        // Map data to clean objects for Excel sheets
        const sheetProductores = productores.map(p => ({
            "Productor": p
        }));
        
        const sheetEstablecimientos = establecimientos.map(e => ({
            "Productor": e.productor,
            "Establecimiento": e.establecimiento
        }));
        
        const sheetRegistros = registros.map(r => ({
            "ID": r.id,
            "Fecha": r.fecha || "-",
            "Productor": r.productor || "-",
            "Establecimiento": r.establecimiento || "-",
            "R.P. Ternero": r.rp_ternero || "-",
            "I.G. Ternero (%)": r.ig_ternero !== null ? Number(r.ig_ternero) : "-",
            "Sexo": r.sexo || "-",
            "Estado Ombligo": r.ombligo || "-",
            "Tipo Madre": r.tipo_madre || "-",
            "Tipo de Parto": r.tipo_parto || "Normal",
            "R.P. Madre": r.rp_madre || "-",
            "Tipo de Calostro": r.tipo_calostro || "De la madre",
            "Método de Calostrado": r.metodo_calostrado || "Con mamadera",
            [((typeof AuthManager !== 'undefined' && AuthManager.getIgMetodo() === 'brix') ? "I.G. Calostro (% Brix)" : "I.G. Calostro (mg/dL)")]: r.ig_calostro !== null ? Number(r.ig_calostro) : "-",
            "Estado": r.estado || "-",
            "Condición Salud (Vivo)": (r.estado === 'Vivo') ? (r.estado_salud || "Sano, sin problemas aparentes") : "-",
            "Detalle Enfermedad (Vivo)": (r.estado === 'Vivo') ? (r.detalle_salud || "-") : "-",
            "Causa Muerte": r.causa || "-",
            "Categoría Causa": r.causa_categoria || "-",
            "Especificación Causa": r.causa_especifica || "-"
        }));
        
        const wb = XLSX.utils.book_new();
        
        // Generate worksheets
        const ws_prod = XLSX.utils.json_to_sheet(sheetProductores);
        const ws_est = XLSX.utils.json_to_sheet(sheetEstablecimientos);
        const ws_reg = XLSX.utils.json_to_sheet(sheetRegistros);
        
        // Append worksheets to workbook
        XLSX.utils.book_append_sheet(wb, ws_prod, "Clientes");
        XLSX.utils.book_append_sheet(wb, ws_est, "Establecimientos");
        XLSX.utils.book_append_sheet(wb, ws_reg, "Historias Clínicas");
        
        // Write file
        const dateStr = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `vetfield_reporte_${dateStr}.xlsx`);
        showToast('Reporte Excel descargado con éxito.');
    } catch (err) {
        console.error(err);
        showToast('Error al generar el reporte de Excel.');
    }
}

async function generateZipRecords(res) {
    if (!window.JSZip) {
        showToast('Error: La librería ZIP no se pudo cargar.');
        return;
    }
    
    try {
        const zip = new JSZip();
        const data = res.data || {};
        const registros = data.registros || [];
        
        if (registros.length === 0) {
            showToast('No hay registros para exportar.');
            return;
        }
        
        // Helper to sanitize filename characters
        function sanitizeFilename(name) {
            if (!name) return "Sin_Nombre";
            return name.replace(/[\\/:*?"<>|]/g, "_");
        }
        
        registros.forEach(r => {
            const prodName = sanitizeFilename(r.productor || "Sin Productor");
            const estName = sanitizeFilename(r.establecimiento || "Sin Establecimiento");
            const rpName = sanitizeFilename(r.rp_ternero || `Ternero_Sin_RP_${r.id}`);
            
            // Create hierarchical path in zip
            const folder = zip.folder(prodName).folder(estName);
            
            const content = `==================================================
EXPEDIENTE CLÍNICO DE TERNERO - VETFIELD PRO
==================================================
Fecha de Registro: ${r.fecha || "-"}
Productor:         ${r.productor || "-"}
Establecimiento:   ${r.establecimiento || "-"}

DATOS DEL PACIENTE:
R.P. Ternero:      ${r.rp_ternero || "-"}
I.G. Ternero:      ${r.ig_ternero !== null ? r.ig_ternero + '%' : "-"}
Sexo:              ${r.sexo || "-"}
Estado Ombligo:    ${r.ombligo || "-"}

DATOS DE LA MADRE, PARTO Y CALOSTRO:
Tipo de Madre:     ${r.tipo_madre || "-"}
Tipo de Parto:     ${r.tipo_parto || "Normal"}
R.P. Madre:        ${r.rp_madre || "-"}
Tipo de Calostro:      ${r.tipo_calostro || "De la madre"}
Método de Calostrado:  ${r.metodo_calostrado || "Con mamadera"}
I.G. Calostro:         ${r.ig_calostro !== null ? r.ig_calostro + ((typeof AuthManager !== 'undefined' && AuthManager.getIgMetodo() === 'brix') ? ' % Brix' : ' mg/dL') : "-"}

ESTADO SANITARIO:
Supervivencia:          ${r.estado || "-"}
Condición de Salud:     ${(r.estado === 'Vivo') ? (r.estado_salud || "Sano, sin problemas aparentes") : "-"}
Problema o Enfermedad:  ${(r.estado === 'Vivo') ? (r.detalle_salud || "-") : "-"}
Causa de Muerte:        ${r.causa || "-"}
Categoría Causa:   ${r.causa_categoria || "-"}
Específica Causa:  ${r.causa_especifica || "-"}
==================================================
`;
            folder.file(`Expediente_RP_${rpName}.txt`, content);
        });
        
        // Add a Readme file
        zip.file("LEEME.txt", `Expedientes clínicos exportados desde Vetfield Pro el ${new Date().toLocaleDateString('es-AR')}.\nEstructura organizada por Productor (Cliente) y Establecimiento.`);
        
        const contentBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(contentBlob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `vetfield_expedientes_${dateStr}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Expedientes comprimidos (.zip) descargados con éxito.');
    } catch (err) {
        console.error(err);
        showToast('Error al generar el archivo ZIP.');
    }
}


async function handleImportBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const btn = document.getElementById('btn-import-backup');
    const originalHTML = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width:18px;height:18px;"></i> Importando...';
        if (window.lucide) window.lucide.createIcons();
    }
    
    if (!navigator.onLine) {
        showToast('Debes estar conectado a Internet para restaurar una copia de seguridad.');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
            if (window.lucide) window.lucide.createIcons();
        }
        event.target.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data || !data.data || (!Array.isArray(data.data.registros) && !Array.isArray(data.data.productores))) {
                showToast('Error: Formato de respaldo no compatible.');
            } else {
                const res = await apiFetchApp(API_RECORDS, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'backup_import', data: data.data })
                });
                
                if (res.ok) {
                    showToast(res.message || 'Respaldo restaurado con éxito.');
                    await loadFromAPI();
                    updateUI();
                } else {
                    showToast('Error al restaurar: ' + (res.error || 'Intente de nuevo.'));
                }
            }
        } catch (err) {
            console.error(err);
            showToast('Error: El archivo no es un JSON válido.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
                if (window.lucide) window.lucide.createIcons();
            }
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}


let _parsedExcelData = null;

function openImportExcelModal() {
    _parsedExcelData = null;
    const uploadStep = document.getElementById('importExcelStepUpload');
    const reviewStep = document.getElementById('importExcelStepReview');
    if (uploadStep) uploadStep.style.display = 'block';
    if (reviewStep) reviewStep.style.display = 'none';

    const fileNameSpan = document.getElementById('excel-file-name');
    if (fileNameSpan) {
        fileNameSpan.textContent = 'Haga clic para seleccionar planilla (.xlsx)';
    }
    const fileInput = document.getElementById('excel-import-file');
    if (fileInput) fileInput.value = '';
    
    document.getElementById('importExcelModal').classList.add('active');
    if (window.lucide) window.lucide.createIcons();
}

function closeImportExcelModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('importExcelModal').classList.remove('active');
    _parsedExcelData = null;
}

function resetImportExcelModal() {
    _parsedExcelData = null;
    const uploadStep = document.getElementById('importExcelStepUpload');
    const reviewStep = document.getElementById('importExcelStepReview');
    if (uploadStep) uploadStep.style.display = 'block';
    if (reviewStep) reviewStep.style.display = 'none';

    const fileNameSpan = document.getElementById('excel-file-name');
    if (fileNameSpan) {
        fileNameSpan.textContent = 'Haga clic para seleccionar planilla (.xlsx)';
    }
    const fileInput = document.getElementById('excel-import-file');
    if (fileInput) fileInput.value = '';
    if (window.lucide) window.lucide.createIcons();
}

function downloadExcelTemplate() {
    if (!window.XLSX) {
        showToast('Error: La librería de Excel no está cargada.');
        return;
    }
    try {
        const headers = [
            "Productor",
            "Establecimiento",
            "Fecha",
            "R.P. Ternero",
            "I.G. Ternero",
            "Sexo",
            "Ombligo",
            "Tipo Madre",
            "Tipo de Parto",
            "R.P. Madre",
            "Tipo de Calostro",
            "Método de Calostrado",
            "I.G. Calostro",
            "Estado",
            "Condición Salud (Vivo)",
            "Detalle Enfermedad (Vivo)",
            "Causa Categoría",
            "Causa Específica"
        ];
        const row1 = [
            "Estancia Santa Julia",
            "Lote 4",
            "2026-05-30",
            "4912",
            "8.5",
            "Macho",
            "Bueno",
            "Vaca",
            "Normal",
            "8832",
            "De la madre",
            "Con mamadera",
            "22.5",
            "Vivo",
            "Sano, sin problemas aparentes",
            "",
            "",
            ""
        ];
        const row2 = [
            "Estancia Santa Julia",
            "Lote 4",
            "2026-05-31",
            "4913",
            "10.2",
            "Hembra",
            "Regular",
            "Vaquillona",
            "Normal",
            "8835",
            "De la madre",
            "Con mamadera",
            "18.1",
            "Vivo",
            "Está enfermo actualmente",
            "Diarrea neonatal",
            "",
            ""
        ];
        const row3 = [
            "Estancia Santa Julia",
            "Lote 4",
            "2026-06-01",
            "4914",
            "7.8",
            "Macho",
            "Malo",
            "Vaca",
            "Asistido",
            "8840",
            "Banco de calostro",
            "Con sonda",
            "14.5",
            "Muerto en Terapia",
            "",
            "",
            "Enfermedades e Infecciones",
            "Neumonía"
        ];
        
        const data = [headers, row1, row2, row3];
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Plantilla Importación");
        
        XLSX.writeFile(wb, "vetfield_plantilla_importacion.xlsx");
        showToast('Plantilla Excel descargada.');
    } catch (err) {
        console.error(err);
        showToast('Error al generar la plantilla.');
    }
}

function handleImportExcelFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
        showToast('Solo se admiten planillas en formato Excel (.xlsx).');
        resetImportExcelModal();
        return;
    }

    const confirmBtn = document.getElementById('btn-confirm-import-excel');
    const fileNameSpan = document.getElementById('excel-file-name');
    
    if (fileNameSpan) {
        fileNameSpan.textContent = `Procesando: ${file.name}...`;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            if (!window.XLSX) {
                showToast('Error: La librería de Excel no se pudo cargar.');
                if (fileNameSpan) fileNameSpan.textContent = 'Error: librería no disponible';
                return;
            }

            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', raw: true });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
            
            if (json.length === 0) {
                showToast('El archivo está vacío o no tiene registros.');
                if (fileNameSpan) fileNameSpan.textContent = 'Error: Archivo vacío';
                return;
            }

            // Helpers for parsing and normalizing
            function cleanCompareKey(str) {
                if (!str) return '';
                return String(str)
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .replace(/[^a-z0-9]/g, "");
            }

            function findValue(row, aliases) {
                const keys = Object.keys(row);
                // 1. Coincidencia exacta limpia (sin tildes, sin espacios, minúsculas)
                for (const alias of aliases) {
                    const cleanAlias = cleanCompareKey(alias);
                    if (!cleanAlias) continue;
                    const foundKey = keys.find(k => cleanCompareKey(k) === cleanAlias);
                    if (foundKey) return row[foundKey];
                }
                // 2. Coincidencia por inclusión limpia
                for (const alias of aliases) {
                    const cleanAlias = cleanCompareKey(alias);
                    if (!cleanAlias) continue;
                    const foundKey = keys.find(k => {
                        const ck = cleanCompareKey(k);
                        return ck.includes(cleanAlias) || cleanAlias.includes(ck);
                    });
                    if (foundKey) return row[foundKey];
                }
                return undefined;
            }

            function trimValue(val) {
                if (val === undefined || val === null) return "";
                return String(val).trim();
            }

            function formatDateValue(val) {
                if (!val) return "";
                if (typeof val === 'number') {
                    // Excel serial date format
                    const dateObj = new Date(Math.round((val - 25569) * 86400 * 1000));
                    return dateObj.toISOString().split('T')[0];
                }
                const str = String(val).trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
                const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
                if (dmy) {
                    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
                }
                return "";
            }

            function parseNumeric(val, isIg = false) {
                if (val === undefined || val === null || val === "") return null;
                let num = parseFloat(String(val).replace(",", "."));
                if (isNaN(num)) return null;
                // Auto-corrección de coma decimal perdida (ej. 10,3 se importó como 103, o 8,5 como 85)
                // En refractometría veterinaria el I.G./Brix oscila normalmente entre 5% y 35%
                if (isIg && num >= 50 && num <= 500) {
                    num = parseFloat((num / 10).toFixed(2));
                } else if (isIg && num > 500 && num <= 5000) {
                    num = parseFloat((num / 100).toFixed(2));
                }
                return num;
            }

            // Identificación inteligente de I.G. Ternero / Calostro Ternero vs Calostro Madre
            function findIgTernero(row) {
                const keys = Object.keys(row);
                // 1. Claves explícitas de ternero / cría (prioridad absoluta)
                for (const k of keys) {
                    const norm = k.toLowerCase().replace(/[^a-z0-9]/g, "");
                    if (norm.includes("madre")) continue; // Nunca asignar datos de madre al ternero
                    if (norm.includes("igternero") || norm.includes("calostroternero") || norm.includes("calostrocria") || norm.includes("brixternero")) {
                        return row[k];
                    }
                }
                // 2. Claves generales de calostro / IG siempre que NO sean de la madre
                for (const k of keys) {
                    const norm = k.toLowerCase().replace(/[^a-z0-9]/g, "");
                    if (norm.includes("madre")) continue;
                    if (norm === "calostro" || norm === "ig" || norm === "igcalostro" || norm === "brix" || norm === "igbrix" || norm === "inmunoglobulina" || norm.startsWith("calostro") || norm.startsWith("ig")) {
                        return row[k];
                    }
                }
                return undefined;
            }

            function findIgMadre(row) {
                const keys = Object.keys(row);
                // 1. Claves explícitas de madre con calostro/ig/brix
                for (const k of keys) {
                    const norm = k.toLowerCase().replace(/[^a-z0-9]/g, "");
                    if (norm.includes("ternero") || norm.includes("cria")) continue; // Nunca asignar datos de ternero a madre
                    if (norm.includes("madre") && (norm.includes("calostro") || norm.includes("ig") || norm.includes("brix") || norm.includes("inmuno"))) {
                        return row[k];
                    }
                }
                // 2. Claves de calostro que indiquen ig o brix
                for (const k of keys) {
                    const norm = k.toLowerCase().replace(/[^a-z0-9]/g, "");
                    if (norm.includes("ternero") || norm.includes("cria")) continue;
                    if (norm.includes("igcalostro") || norm.includes("calostroig") || norm.includes("brixcalostro") || norm.includes("calostrobrix")) {
                        return row[k];
                    }
                }
                return undefined;
            }

            function sanitizeSexo(val) {
                const str = trimValue(val).toLowerCase();
                if (str.includes("hem") || str === "h" || str === "f") return "Hembra";
                return "Macho";
            }

            function sanitizeOmbligo(val) {
                const str = trimValue(val).toLowerCase();
                if (str.includes("reg")) return "Regular";
                if (str.includes("mal")) return "Malo";
                return "Bueno";
            }

            function sanitizeTipoMadre(val) {
                const str = trimValue(val).toLowerCase();
                if (str.includes("vaq") || str.includes("heifer")) return "Vaquillona";
                return "Vaca";
            }

            function sanitizeTipoParto(val) {
                const str = trimValue(val).toLowerCase();
                if (str.includes("muert") || str.includes("mortin") || str.includes("natim")) return "Muerto al parto";
                if (str.includes("asist") || str.includes("distoc") || str.includes("ayud") || str.includes("fuerz") || str.includes("trac")) return "Asistido";
                return "Normal";
            }

            function sanitizeTipoCalostro(val) {
                const str = trimValue(val).toLowerCase();
                if (str.includes("banco") || str.includes("congel") || str.includes("reserva")) return "Banco de calostro";
                if (str.includes("mejorad") || str.includes("aditiv") || str.includes("enriquec") || str.includes("pasteuriz") || str.includes("suplement")) return "Calostro mejorado";
                return "De la madre";
            }

            function sanitizeMetodoCalostrado(val) {
                const str = trimValue(val).toLowerCase();
                if (str.includes("sonda") || str.includes("tubo") || str.includes("entub") || str.includes("esofag")) return "Con sonda";
                if (str.includes("solo") || str.includes("sola") || str.includes("pie") || str.includes("teta") || str.includes("natural")) return "Mamó solo";
                return "Con mamadera";
            }

            function sanitizeEstadoSalud(val) {
                const str = trimValue(val).toLowerCase();
                if (str.includes("malform") || str.includes("nacio con") || str.includes("defecto") || str.includes("congenit")) {
                    return "Nació con algún problema o malformación";
                }
                if (str.includes("actual") || str.includes("hoy") || str.includes("cursando") || str.includes("enfermo")) {
                    return "Está enfermo actualmente";
                }
                if (str.includes("anterior") || str.includes("pasad") || str.includes("tuvo") || str.includes("recuperad") || str.includes("previ")) {
                    return "Tuvo una enfermedad anteriormente";
                }
                return "Sano, sin problemas aparentes";
            }

            function sanitizeEstado(val) {
                const str = trimValue(val).toLowerCase();
                if (str.includes("establecimiento") || str.includes("est")) return "Muerto en Establecimiento";
                if (str.includes("guacheria") || str.includes("guach")) return "Muerto en Guachería";
                if (str.includes("terapia") || str.includes("ter")) return "Muerto en Terapia";
                if (str.includes("muert") || str.includes("fallec")) return "Muerto en Establecimiento";
                return "Vivo";
            }

            // Normaliza texto libre a Title Case: "estancia SANTA julia" → "Estancia Santa Julia"
            function toTitleCase(val) {
                const str = trimValue(val);
                if (!str) return "";
                return str
                    .toLowerCase()
                    .replace(/(?:^|\s)\S/g, c => c.toUpperCase());
            }

            // Quita tildes y pasa a minúsculas para comparación: "Onfálitis" y "onfalitis" → "onfalitis"
            function normalizeCompare(val) {
                return trimValue(val)
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "");
            }

            // Normalización inteligente de causas de muerte conocidas
            function normalizeCausa(rawCat, rawEsp) {
                let cat = toTitleCase(rawCat);
                let esp = toTitleCase(rawEsp);
                const normEsp = normalizeCompare(esp);
                const normCat = normalizeCompare(cat);

                // 1. Normalizar la categoría a nombres canónicos
                if (normCat.includes("digestiv") || normCat.includes("metabolic")) {
                    cat = "Problemas Digestivos y Metabólicos";
                } else if (normCat.includes("infecci") || normCat.includes("enfermedad")) {
                    cat = "Enfermedades e Infecciones";
                } else if (normCat.includes("extern") || normCat.includes("manejo")) {
                    cat = "Factores Externos y de Manejo";
                } else if (normCat.includes("otra")) {
                    cat = "Otra Causa";
                }

                // 2. Normalización de causas específicas
                if (normEsp.includes("diarrea") || normEsp.includes("diarea") || normEsp.match(/^di+ar+e+a$/)) {
                    if (normEsp.includes("onfalit")) {
                        esp = "Onfalitis - Diarrea";
                        if (!cat) cat = "Enfermedades e Infecciones"; // Onfalitis es infección, aunque acompañe diarrea
                    } else {
                        esp = "Diarrea";
                        if (!cat) cat = "Problemas Digestivos y Metabólicos";
                    }

                } else if (normEsp.includes("torsion") || normEsp.includes("abomaso")) {
                    esp = "Torsión de abomaso";
                    if (!cat) cat = "Problemas Digestivos y Metabólicos";
                } else if (normEsp.includes("ulcera")) {
                    esp = "Úlcera de abomaso";
                    if (!cat) cat = "Problemas Digestivos y Metabólicos";
                } else if (normEsp.includes("intoxic")) {
                    esp = "Intoxicación";
                    if (!cat) cat = "Problemas Digestivos y Metabólicos";
                } else if (normEsp.includes("acidosis") || normEsp.includes("timpanis") || normEsp.includes("hinchad") || normEsp.includes("empaste")) {
                    esp = "Acidosis / Timpanismo";
                    if (!cat) cat = "Problemas Digestivos y Metabólicos";
                } else if (normEsp.includes("neumon") || normEsp.includes("pulmon")) {
                    esp = "Neumonía";
                    if (!cat) cat = "Enfermedades e Infecciones";
                } else if (normEsp.includes("rotavirus") || normEsp.match(/\brota\b/)) {
                    esp = "Rotavirus";
                    if (!cat) cat = "Enfermedades e Infecciones";
                } else if (normEsp.includes("coronavirus") || normEsp.match(/\bcorona\b/)) {
                    esp = "Coronavirus";
                    if (!cat) cat = "Enfermedades e Infecciones";
                } else if (normEsp.includes("colibacil") || normEsp.includes("escherichia") || normEsp.includes("coli")) {
                    esp = "Colibacilosis";
                    if (!cat) cat = "Enfermedades e Infecciones";
                } else if (normEsp.includes("onfalit") || normEsp.includes("ombligo")) {
                    esp = "Onfalitis";
                    if (!cat) cat = "Enfermedades e Infecciones";
                } else if (normEsp.includes("salmonel")) {
                    esp = "Salmonelosis";
                    if (!cat) cat = "Enfermedades e Infecciones";
                } else if (normEsp.includes("cripto")) {
                    esp = "Criptosporidiosis";
                    if (!cat) cat = "Enfermedades e Infecciones";
                } else if (normEsp.includes("calor") || normEsp.includes("estres")) {
                    esp = "Estrés calórico";
                    if (!cat) cat = "Factores Externos y de Manejo";
                } else if (normEsp.includes("falsa via") || normEsp.includes("broncoaspir")) {
                    esp = "Falsa vía";
                    if (!cat) cat = "Factores Externos y de Manejo";
                } else if (normEsp.includes("trauma") || normEsp.includes("golpe") || normEsp.includes("fractura")) {
                    esp = "Traumática";
                    if (!cat) cat = "Factores Externos y de Manejo";
                } else if (normEsp.includes("hipotermia") || normEsp.includes("frio")) {
                    esp = "Hipotermia";
                    if (!cat) cat = "Factores Externos y de Manejo";
                } else if (normEsp.includes("digestiv") || normEsp.includes("metabolic")) {
                    if (!cat) cat = "Problemas Digestivos y Metabólicos";
                    esp = "";
                } else if (normEsp.includes("infeccion") || normEsp.includes("enfermedad")) {
                    if (!cat) cat = "Enfermedades e Infecciones";
                    esp = "";
                } else if (normEsp.includes("extern") || normEsp.includes("manejo")) {
                    if (!cat) cat = "Factores Externos y de Manejo";
                    esp = "";
                }

                if (!cat && esp) {
                    cat = "Otra Causa";
                }

                return { cat, esp };
            }

            const mappedRecords = [];
            const rejectedRows = [];
            const uniqueProductors = new Set();
            const uniqueEstablishments = [];
            const seenRPs = {}; // track RP duplicates within the file

            for (let i = 0; i < json.length; i++) {
                const row = json[i];
                const excelRowNum = i + 2; // +2 because row 1 is the header
                const productor = toTitleCase(findValue(row, ["productor", "cliente", "owner"]));
                const rawFecha = findValue(row, ["fecha", "date"]);
                const fecha = formatDateValue(rawFecha);
                
                // --- Validation: missing required fields ---
                const rowErrors = [];
                if (!productor) {
                    rowErrors.push('Falta el campo "Productor"');
                }
                if (!rawFecha && rawFecha !== 0) {
                    rowErrors.push('Falta el campo "Fecha"');
                } else if (!fecha) {
                    rowErrors.push(`Fecha con formato irreconocible: "${rawFecha}"`);
                }

                if (rowErrors.length > 0) {
                    const rp_preview = trimValue(findValue(row, ["rp ternero", "rp_ternero", "rp", "id ternero", "calf id"]));
                    rejectedRows.push({
                        fila: excelRowNum,
                        rp: rp_preview || '—',
                        motivos: rowErrors
                    });
                    continue;
                }
                
                const establecimiento = toTitleCase(findValue(row, ["establecimiento", "campo", "lote", "location"]));
                const rp_ternero = trimValue(findValue(row, ["rp ternero", "rp_ternero", "rp", "id ternero", "calf id"])) || "";
                const ig_ternero = parseNumeric(findIgTernero(row), true);
                const sexo = sanitizeSexo(findValue(row, ["sexo", "gender"]));
                const ombligo = sanitizeOmbligo(findValue(row, ["ombligo", "estado ombligo", "navel"]));
                const tipo_madre = sanitizeTipoMadre(findValue(row, ["tipo madre", "tipo_madre", "madre tipo"]));
                const tipo_parto = sanitizeTipoParto(findValue(row, ["tipo de parto", "tipo parto", "tipo_parto", "parto"]));
                const rp_madre = trimValue(findValue(row, ["rp madre", "rp_madre", "rp de la madre", "madre id"])) || "";
                const tipo_calostro = sanitizeTipoCalostro(findValue(row, ["tipo de calostro", "tipo calostro", "tipo_calostro", "calostro tipo", "origen calostro"]));
                const metodo_calostrado = sanitizeMetodoCalostrado(findValue(row, ["metodo de calostrado", "metodo calostrado", "metodo_calostrado", "calostrado", "via de calostrado", "via calostrado", "forma calostrado", "modo calostrado"]));
                const ig_calostro = parseNumeric(findIgMadre(row), true);
                const estado = sanitizeEstado(findValue(row, ["estado", "supervivencia", "status"]));
                const raw_estado_salud = findValue(row, ["condicion salud", "condición salud", "estado salud", "estado_salud", "salud", "morbilidad"]);
                const raw_detalle_salud = trimValue(findValue(row, ["detalle enfermedad", "detalle salud", "detalle_salud", "enfermedad vivo", "problema vivo", "diagnostico vivo", "diagnóstico vivo", "malformacion", "malformación"]));
                let estado_salud = null;
                let detalle_salud = null;
                if (estado === 'Vivo') {
                    estado_salud = sanitizeEstadoSalud(raw_estado_salud || (raw_detalle_salud ? "Está enfermo actualmente" : "Sano, sin problemas aparentes"));
                    detalle_salud = (estado_salud !== 'Sano, sin problemas aparentes') ? (raw_detalle_salud || null) : null;
                    if (detalle_salud) saveCustomSaludTerm(detalle_salud);
                }
                
                const raw_causa_cat = findValue(row, ["causa categoria", "causa categoría", "causa_categoria", "categoria", "categoría", "categoria muerte", "categoría muerte", "grupo causa"]);
                const raw_causa_esp = findValue(row, ["causa especifica", "causa específica", "causa_especifica", "subcausa", "sub causa", "diagnostico", "diagnóstico", "enfermedad", "motivo", "causa muerte", "causa"]);
                const normCausa = normalizeCausa(raw_causa_cat, raw_causa_esp);
                const causa_cat = normCausa.cat;
                const causa_esp = normCausa.esp;
                const causa = causa_cat && causa_esp ? `${causa_cat} - ${causa_esp}` : (causa_cat || causa_esp || "");

                const recordData = {
                    productor,
                    establecimiento: establecimiento || null,
                    fecha,
                    rp_ternero: rp_ternero || null,
                    ig_ternero: ig_ternero,
                    sexo,
                    ombligo,
                    tipo_madre,
                    tipo_parto,
                    rp_madre: rp_madre || null,
                    tipo_calostro,
                    metodo_calostrado,
                    ig_calostro: ig_calostro,
                    estado,
                    estado_salud,
                    detalle_salud,
                    causa: estado !== 'Vivo' ? causa || null : null,
                    causa_categoria: estado !== 'Vivo' ? causa_cat || null : null,
                    causa_especifica: estado !== 'Vivo' ? causa_esp || null : null
                };

                // --- Validation: duplicate RP within the file ---
                if (rp_ternero) {
                    const rpKey = `${normalizeCompare(productor)}||${rp_ternero.toUpperCase()}||${fecha}`;
                    if (seenRPs[rpKey]) {
                        seenRPs[rpKey].occurrences.push({
                            fila: excelRowNum,
                            record: recordData
                        });
                        rejectedRows.push({
                            fila: excelRowNum,
                            rp: rp_ternero,
                            isTwinCandidate: true,
                            rpKey: rpKey,
                            motivos: [`R.P. "${rp_ternero}" duplicado (fila ${seenRPs[rpKey].firstFila}). Si son mellizos/gemelos usar "${rp_ternero} A" y "${rp_ternero} B"`]
                        });
                        continue;
                    }
                    seenRPs[rpKey] = {
                        firstFila: excelRowNum,
                        mappedIndex: mappedRecords.length,
                        rp_base: rp_ternero,
                        occurrences: [
                            { fila: excelRowNum, record: recordData }
                        ]
                    };
                }
                
                uniqueProductors.add(productor);
                if (establecimiento) {
                    const exists = uniqueEstablishments.some(e => e.productor === productor && e.establecimiento === establecimiento);
                    if (!exists) {
                        uniqueEstablishments.push({ productor, establecimiento });
                    }
                }
                
                mappedRecords.push(recordData);
            }

            // --- Detectar RPs del Excel que ya existen en la BD (en memoria) ---
            const rpConflicts = _detectExcelRpConflicts(mappedRecords);

            // --- Show review step ---
            _parsedExcelData = {
                fileName: file.name,
                totalRows: json.length,
                productores: uniqueProductors,
                establecimientos: uniqueEstablishments,
                registros: mappedRecords,
                rejectedRows: rejectedRows,
                seenRPs: seenRPs,
                rpConflicts: rpConflicts
            };

            showImportReviewStep(file.name, json.length, mappedRecords.length, rejectedRows);

        } catch (err) {
            console.error(err);
            showToast('Error al parsear la planilla. Asegúrate de que no esté corrupta.');
            if (fileNameSpan) fileNameSpan.textContent = 'Error al leer archivo';
        }
    };
    reader.readAsArrayBuffer(file);
}

/**
 * Detecta qué terneros de la planilla Excel tienen un R.P. que ya existe en la base de datos local
 * para el mismo productor.
 */
function _detectExcelRpConflicts(mappedRecords) {
    const conflicts = [];
    if (!Array.isArray(mappedRecords)) return conflicts;
    for (let i = 0; i < mappedRecords.length; i++) {
        const rec = mappedRecords[i];
        if (!rec.rp_ternero) continue;
        const existing = records.find(r =>
            r.rp_ternero &&
            r.rp_ternero.trim().toUpperCase() === rec.rp_ternero.trim().toUpperCase() &&
            (r.productor || '').trim().toUpperCase() === (rec.productor || '').trim().toUpperCase()
        );
        if (existing) {
            conflicts.push({
                rp:              rec.rp_ternero,
                estado:          existing.estado,
                fecha:           existing.fecha,
                establecimiento: existing.establecimiento,
                productor:       existing.productor,
                newFecha:        rec.fecha,
                newEstado:       rec.estado,
                rowIndex:        i
            });
        }
    }
    return conflicts;
}

function autoResolveTwins() {
    if (!_parsedExcelData || !_parsedExcelData.seenRPs) {
        showToast('No se encontraron mellizos pendientes de resolver.');
        return;
    }

    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    let resolvedCount = 0;

    for (const rpKey in _parsedExcelData.seenRPs) {
        const group = _parsedExcelData.seenRPs[rpKey];
        if (group && group.occurrences && group.occurrences.length > 1) {
            // First occurrence: rename RP to "[Base] A"
            const firstItem = group.occurrences[0];
            if (firstItem && firstItem.record) {
                firstItem.record.rp_ternero = `${group.rp_base} A`;
            }

            // Subsequent occurrences: assign "B", "C", etc. and add to valid registros
            for (let i = 1; i < group.occurrences.length; i++) {
                const item = group.occurrences[i];
                const letter = letters[i] || `_${i + 1}`;
                item.record.rp_ternero = `${group.rp_base} ${letter}`;

                _parsedExcelData.registros.push(item.record);

                if (_parsedExcelData.productores instanceof Set) {
                    _parsedExcelData.productores.add(item.record.productor);
                } else if (Array.isArray(_parsedExcelData.productores) && !_parsedExcelData.productores.includes(item.record.productor)) {
                    _parsedExcelData.productores.push(item.record.productor);
                }

                if (item.record.establecimiento) {
                    const exists = _parsedExcelData.establecimientos.some(
                        e => e.productor === item.record.productor && e.establecimiento === item.record.establecimiento
                    );
                    if (!exists) {
                        _parsedExcelData.establecimientos.push({
                            productor: item.record.productor,
                            establecimiento: item.record.establecimiento
                        });
                    }
                }
                resolvedCount++;
            }
        }
    }

    _parsedExcelData.rejectedRows = _parsedExcelData.rejectedRows.filter(r => !r.isTwinCandidate);
    _parsedExcelData.seenRPs = null;
    _parsedExcelData.twinsResolved = resolvedCount;
    // Recalcular conflictos de RP luego de resolver mellizos
    _parsedExcelData.rpConflicts = _detectExcelRpConflicts(_parsedExcelData.registros);

    showToast(`¡Listo! Se diferenciaron ${resolvedCount} terneros como mellizos (A/B).`);

    showImportReviewStep(
        _parsedExcelData.fileName,
        _parsedExcelData.totalRows,
        _parsedExcelData.registros.length,
        _parsedExcelData.rejectedRows
    );
}

async function confirmImportExcel(btnEl) {
    if (!_parsedExcelData || _parsedExcelData.registros.length === 0) {
        showToast('No hay registros válidos para importar.');
        return;
    }
    
    if (!navigator.onLine) {
        showToast('Debes estar conectado a Internet para realizar la importación.');
        return;
    }

    const originalHTML = btnEl.innerHTML;
    btnEl.disabled = true;
    btnEl.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width:18px;height:18px;"></i> Importando...';
    if (window.lucide) window.lucide.createIcons();

    // Obtener la preferencia de conflicto de RP (si existían conflictos)
    const conflictModeRadio = document.querySelector('input[name="excelRpConflictMode"]:checked');
    const rp_conflict_mode = conflictModeRadio ? conflictModeRadio.value : 'update';

    try {
        const payload = {
            action: 'backup_import',
            rp_conflict_mode: rp_conflict_mode,
            data: {
                productores: Array.isArray(_parsedExcelData.productores) 
                    ? _parsedExcelData.productores 
                    : Array.from(_parsedExcelData.productores),
                establecimientos: _parsedExcelData.establecimientos,
                registros: _parsedExcelData.registros
            }
        };
        const res = await apiFetchApp(API_RECORDS, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            showToast(res.message || 'Importación completada con éxito.');
            await loadFromAPI();
            updateUI();
            closeImportExcelModal();
        } else {
            showToast('Error al importar: ' + (res.error || 'Intente de nuevo.'));
        }
    } catch (err) {
        console.error(err);
        showToast('Error de red al realizar la importación.');
    } finally {
        btnEl.disabled = false;
        btnEl.innerHTML = originalHTML;
        if (window.lucide) window.lucide.createIcons();
    }
}

function showImportReviewStep(fileName, totalRows, validCount, rejectedRows) {
    const uploadStep = document.getElementById('importExcelStepUpload');
    const reviewStep = document.getElementById('importExcelStepReview');
    const reviewContent = document.getElementById('importExcelReviewContent');
    
    if (uploadStep) uploadStep.style.display = 'none';
    if (reviewStep) reviewStep.style.display = 'block';

    const rejectedCount = rejectedRows.length;
    const hasErrors = rejectedCount > 0;
    const hasValid = validCount > 0;
    const twinCandidates = rejectedRows.filter(r => r.isTwinCandidate);
    const hasTwins = twinCandidates.length > 0;

    // Build the summary icon and color
    let statusIcon, statusColor, statusBg, statusTitle;
    if (!hasValid) {
        statusIcon = 'x-circle';
        statusColor = '#dc2626';
        statusBg = 'rgba(220,38,38,0.06)';
        statusTitle = 'No se puede importar';
    } else if (hasErrors) {
        statusIcon = 'alert-triangle';
        statusColor = '#d97706';
        statusBg = 'rgba(217,119,6,0.06)';
        statusTitle = 'Revisión necesaria';
    } else {
        statusIcon = 'check-circle-2';
        statusColor = '#16a34a';
        statusBg = 'rgba(22,163,74,0.06)';
        statusTitle = 'Todo listo para importar';
    }

    let html = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.85rem;">
            <div>
                <h2 style="color: var(--primary); font-size: 1.25rem; font-weight: 700; margin: 0;">Revisión de Importación</h2>
                <p style="color: var(--text-secondary); font-size: 0.8rem; margin-top: 3px;">${fileName}</p>
            </div>
            <button onclick="closeImportExcelModal()"
                style="background: var(--bg-body); border: none; padding: 6px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                <i data-lucide="x" style="width: 18px; height: 18px; color: var(--text-secondary);"></i>
            </button>
        </div>

        <!-- Status banner -->
        <div style="background: ${statusBg}; border: 1.5px solid ${statusColor}22; border-radius: 12px; padding: 14px 16px; margin-bottom: 1rem; display: flex; align-items: center; gap: 12px;">
            <i data-lucide="${statusIcon}" style="width: 28px; height: 28px; color: ${statusColor}; flex-shrink: 0;"></i>
            <div>
                <div style="font-weight: 700; font-size: 0.95rem; color: ${statusColor};">${statusTitle}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
                    Se leyeron <strong>${totalRows}</strong> filas del archivo Excel.
                </div>
            </div>
        </div>

        <!-- Stats row -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 1rem;">
            <div style="background: var(--bg-body); border-radius: 10px; padding: 10px 12px; text-align: center;">
                <div style="font-size: 1.4rem; font-weight: 800; color: var(--text-main);">${totalRows}</div>
                <div style="font-size: 0.7rem; color: var(--text-secondary); font-weight: 600;">Filas leídas</div>
            </div>
            <div style="background: var(--bg-body); border-radius: 10px; padding: 10px 12px; text-align: center;">
                <div style="font-size: 1.4rem; font-weight: 800; color: #16a34a;">${validCount}</div>
                <div style="font-size: 0.7rem; color: var(--text-secondary); font-weight: 600;">Listas para importar</div>
            </div>
            <div style="background: var(--bg-body); border-radius: 10px; padding: 10px 12px; text-align: center;">
                <div style="font-size: 1.4rem; font-weight: 800; color: ${rejectedCount > 0 ? '#dc2626' : 'var(--text-secondary)'};">${rejectedCount}</div>
                <div style="font-size: 0.7rem; color: var(--text-secondary); font-weight: 600;">Rechazadas</div>
            </div>
        </div>`;

    // Twin auto-resolve proposal banner (if detected)
    if (hasTwins) {
        html += `
        <div style="background: rgba(99, 102, 241, 0.08); border: 1.5px solid rgba(99, 102, 241, 0.25); border-radius: 12px; padding: 12px 14px; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
            <div style="display: flex; align-items: flex-start; gap: 10px; flex: 1; min-width: 220px;">
                <i data-lucide="sparkles" style="width: 22px; height: 22px; color: #4f46e5; flex-shrink: 0; margin-top: 2px;"></i>
                <div>
                    <div style="font-weight: 700; font-size: 0.88rem; color: #3730a3;">¿Son mellizos o gemelos? (${twinCandidates.length} detectados)</div>
                    <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px; line-height: 1.4;">
                        Podés resolverlos con 1 clic: se les asignará automáticamente <strong>A</strong> y <strong>B</strong> para no tener que editar el Excel.
                    </div>
                </div>
            </div>
            <button type="button" onclick="autoResolveTwins()" class="btn-save"
                style="width: auto; margin: 0; padding: 8px 14px; font-size: 0.82rem; border-radius: 8px; background: #4f46e5; color: white; border: none; display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 700; box-shadow: 0 2px 8px rgba(79, 70, 229, 0.25); transition: all 0.2s;">
                <i data-lucide="wand-2" style="width: 15px; height: 15px;"></i> Diferenciar Mellizos (A/B)
            </button>
        </div>`;
    }

    // Rejected rows detail
    if (hasErrors) {
        html += `
        <div style="margin-bottom: 1rem;">
            <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-main); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                <i data-lucide="list-x" style="width:16px;height:16px;color:#dc2626;"></i>
                Detalle de filas rechazadas (${rejectedCount})
            </div>
            <div style="max-height: 180px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-body); position: relative;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.78rem;">
                    <thead>
                        <tr>
                            <th style="position: sticky; top: 0; z-index: 2; background: var(--card-bg, #ffffff); padding: 8px 10px; text-align: left; font-weight: 700; color: var(--text-secondary); border-bottom: 1.5px solid var(--border-color); width: 60px;">Fila</th>
                            <th style="position: sticky; top: 0; z-index: 2; background: var(--card-bg, #ffffff); padding: 8px 10px; text-align: left; font-weight: 700; color: var(--text-secondary); border-bottom: 1.5px solid var(--border-color); width: 80px;">R.P.</th>
                            <th style="position: sticky; top: 0; z-index: 2; background: var(--card-bg, #ffffff); padding: 8px 10px; text-align: left; font-weight: 700; color: var(--text-secondary); border-bottom: 1.5px solid var(--border-color);">Motivo</th>
                        </tr>
                    </thead>
                    <tbody>`;

        for (const rej of rejectedRows) {
            const motivos = rej.motivos.map(m => `<span style="display:block;">${m}</span>`).join('');
            const twinBadge = rej.isTwinCandidate ? `<span style="display:inline-block; font-size:0.68rem; font-weight:700; padding:2px 6px; border-radius:4px; background:rgba(99,102,241,0.12); color:#4f46e5; margin-left:6px;">Mellizo</span>` : '';
            html += `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 6px 10px; color: var(--text-main); font-weight: 600;">${rej.fila}</td>
                            <td style="padding: 6px 10px; color: var(--text-main); font-family: monospace;">${rej.rp}${twinBadge}</td>
                            <td style="padding: 6px 10px; color: #dc2626; line-height: 1.4;">${motivos}</td>
                        </tr>`;
        }

        html += `
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    // RP Conflicts detail (RPs that already exist in DB for this producer)
    const rpConflicts = (_parsedExcelData && _parsedExcelData.rpConflicts) ? _parsedExcelData.rpConflicts : [];
    if (rpConflicts.length > 0 && hasValid) {
        html += `
        <div style="margin-bottom: 1.1rem; border: 1.5px solid rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.04); border-radius: 12px; padding: 14px 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
                <div style="font-weight: 700; font-size: 0.88rem; color: #b45309; display: flex; align-items: center; gap: 7px;">
                    <i data-lucide="alert-circle" style="width:18px;height:18px;color:#d97706;flex-shrink:0;"></i>
                    <span>R.P. ya existentes en el sistema (${rpConflicts.length})</span>
                </div>
                <span style="font-size: 0.72rem; font-weight: 600; padding: 2px 8px; border-radius: 20px; background: rgba(245,158,11,0.15); color: #b45309;">
                    Reciclado / Actualización
                </span>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-secondary); margin: 0 0 10px 0; line-height: 1.45;">
                Detectamos terneros en la planilla con números de R.P. que ya existen registrados para ese productor:
            </p>

            <div style="max-height: 160px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-body); margin-bottom: 12px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.77rem;">
                    <thead>
                        <tr style="border-bottom: 1px solid var(--border-color); background: var(--card-bg, #ffffff);">
                            <th style="position: sticky; top: 0; z-index: 2; background: var(--card-bg, #ffffff); padding: 7px 10px; text-align: left; color: var(--text-secondary); font-weight: 700;">R.P.</th>
                            <th style="position: sticky; top: 0; z-index: 2; background: var(--card-bg, #ffffff); padding: 7px 10px; text-align: left; color: var(--text-secondary); font-weight: 700;">Estado en Sistema</th>
                            <th style="position: sticky; top: 0; z-index: 2; background: var(--card-bg, #ffffff); padding: 7px 10px; text-align: left; color: var(--text-secondary); font-weight: 700;">Fecha Sistema</th>
                            <th style="position: sticky; top: 0; z-index: 2; background: var(--card-bg, #ffffff); padding: 7px 10px; text-align: left; color: var(--text-secondary); font-weight: 700;">En Planilla</th>
                        </tr>
                    </thead>
                    <tbody>`;

        for (const c of rpConflicts) {
            const isMuerto = c.estado && c.estado !== 'Vivo';
            const estadoColor = isMuerto ? '#dc2626' : '#16a34a';
            const estadoIcon  = isMuerto ? '💀' : '✅';
            const estadoBadge = `<span style="display:inline-flex; align-items:center; gap:4px; font-size:0.72rem; font-weight:700; padding:2px 7px; border-radius:12px; background:${estadoColor}18; color:${estadoColor};">
                ${estadoIcon} ${escHtml(c.estado || '—')}
            </span>`;

            html += `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 6px 10px; font-weight: 800; font-family: monospace; color: var(--primary);">${escHtml(c.rp)}</td>
                            <td style="padding: 6px 10px;">${estadoBadge}</td>
                            <td style="padding: 6px 10px; color: var(--text-secondary);">${escHtml(c.fecha || '—')}</td>
                            <td style="padding: 6px 10px; color: var(--text-main); font-weight: 600;">${escHtml(c.newFecha || '—')} <span style="font-size:0.72rem; color:var(--text-secondary);">(${escHtml(c.newEstado || 'Vivo')})</span></td>
                        </tr>`;
        }

        html += `
                    </tbody>
                </table>
            </div>

            <!-- Selector de decisión -->
            <div style="margin-top: 8px;">
                <div style="font-weight: 700; font-size: 0.82rem; color: var(--text-main); margin-bottom: 8px;">
                    ¿Qué deseas hacer con estos terneros?
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-color); background: var(--card-bg, #ffffff); cursor: pointer;">
                        <input type="radio" name="excelRpConflictMode" value="update" checked style="margin-top: 3px; accent-color: var(--primary);">
                        <div style="font-size: 0.8rem; line-height: 1.4;">
                            <strong style="color: var(--text-main); display: block;">Actualizar datos existentes</strong>
                            <span style="color: var(--text-secondary); font-size: 0.74rem;">Actualiza la información del ternero existente con los datos de esta planilla.</span>
                        </div>
                    </label>

                    <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--border-color); background: var(--card-bg, #ffffff); cursor: pointer;">
                        <input type="radio" name="excelRpConflictMode" value="create_new" style="margin-top: 3px; accent-color: var(--primary);">
                        <div style="font-size: 0.8rem; line-height: 1.4;">
                            <strong style="color: var(--text-main); display: block;">Son terneros nuevos (Reutilizan R.P.)</strong>
                            <span style="color: var(--text-secondary); font-size: 0.74rem;">Crea nuevos terneros con identificador único propio (ideal cuando se recicla la caravana por muerte previa).</span>
                        </div>
                    </label>
                </div>
            </div>
        </div>`;
    }

    // Question and action buttons
    if (hasValid && hasErrors) {
        html += `
        <div style="background: rgba(217,119,6,0.06); border: 1px solid rgba(217,119,6,0.2); border-radius: 10px; padding: 12px 14px; margin-bottom: 1rem; font-size: 0.82rem; color: var(--text-main); line-height: 1.5;">
            <strong style="color: #d97706;">¿Querés continuar?</strong><br>
            Se van a cargar únicamente los <strong>${validCount}</strong> registros válidos. Los ${rejectedCount} terneros observados no se importarán.
        </div>
        <div style="display: flex; gap: 0.75rem;">
            <button onclick="resetImportExcelModal()" class="btn-auth-primary"
                style="background: transparent; color: var(--text-secondary); border: 1.5px solid var(--border-color); margin-top: 0; box-shadow: none; flex: 1; height: 44px; font-size: 0.85rem;">
                <i data-lucide="arrow-left" style="width:16px;height:16px;"></i> Cancelar y Corregir
            </button>
            <button onclick="confirmImportExcel(this)" class="btn-auth-primary"
                style="background: var(--primary); color: white; border: none; margin-top: 0; flex: 1; height: 44px; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <i data-lucide="check" style="width:16px;height:16px;"></i> Sí, cargar los ${validCount} válidos
            </button>
        </div>`;
    } else if (hasValid && !hasErrors) {
        const resolvedTag = (_parsedExcelData && _parsedExcelData.twinsResolved)
            ? `<div style="margin-top: 4px; font-size: 0.78rem; color: #4f46e5; font-weight: 600;">✨ Se diferenciaron ${_parsedExcelData.twinsResolved} terneros como mellizos (A y B) automáticamente.</div>`
            : '';
        html += `
        <div style="background: rgba(22,163,74,0.06); border: 1px solid rgba(22,163,74,0.2); border-radius: 10px; padding: 12px 14px; margin-bottom: 1rem; font-size: 0.82rem; color: var(--text-main); line-height: 1.5;">
            <strong style="color: #16a34a;">¡Perfecto!</strong> Todos los ${validCount} registros están listos para importar sin errores.
            ${resolvedTag}
        </div>
        <div style="display: flex; gap: 0.75rem;">
            <button onclick="resetImportExcelModal()" class="btn-auth-primary"
                style="background: transparent; color: var(--text-secondary); border: 1.5px solid var(--border-color); margin-top: 0; box-shadow: none; flex: 1; height: 44px; font-size: 0.85rem;">
                Cancelar
            </button>
            <button onclick="confirmImportExcel(this)" class="btn-auth-primary"
                style="background: var(--primary); color: white; border: none; margin-top: 0; flex: 1; height: 44px; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <i data-lucide="upload" style="width:16px;height:16px;"></i> Importar ${validCount} registros
            </button>
        </div>`;
    } else {
        // No valid records at all
        html += `
        <div style="background: rgba(220,38,38,0.06); border: 1px solid rgba(220,38,38,0.2); border-radius: 10px; padding: 12px 14px; margin-bottom: 1rem; font-size: 0.82rem; color: var(--text-main); line-height: 1.5;">
            <strong style="color: #dc2626;">No hay registros válidos.</strong> Todas las filas fueron rechazadas. Revisá tu archivo Excel y asegurate de que cada fila tenga al menos <strong>Productor</strong> y <strong>Fecha</strong>.
        </div>
        <div style="display: flex; gap: 0.75rem;">
            <button onclick="resetImportExcelModal()" class="btn-auth-primary"
                style="background: var(--primary); color: white; border: none; margin-top: 0; flex: 1; height: 44px; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <i data-lucide="arrow-left" style="width:16px;height:16px;"></i> Volver e intentar con otro archivo
            </button>
        </div>`;
    }

    reviewContent.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
}

// =============================================================
// ── POPUP DE CONFLICTO DE RP ─────────────────────────────────
// =============================================================

/**
 * Muestra el modal de conflicto de R.P. con los datos del ternero existente.
 * @param {Object} existing  - { id, estado, fecha, establecimiento, productor }
 * @param {string} rp        - El RP que se intentó guardar
 */
function _showRpConflictModal(existing, rp) {
    const modal = document.getElementById('rpConflictModal');
    const body  = document.getElementById('rpConflictBody');
    if (!modal || !body) return;

    const estadoColor = existing.estado && existing.estado !== 'Vivo' ? '#dc2626' : '#16a34a';
    const estadoIcon  = existing.estado && existing.estado !== 'Vivo' ? '💀' : '✅';

    body.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="font-family:monospace;font-size:1rem;font-weight:800;color:var(--primary);">R.P. ${escHtml(String(rp))}</span>
            <span style="font-size:0.75rem;font-weight:700;padding:2px 8px;border-radius:20px;background:${estadoColor}18;color:${estadoColor};">
                ${estadoIcon} ${escHtml(existing.estado || 'Desconocido')}
            </span>
        </div>
        <div style="font-size:0.8rem;color:var(--text-secondary);line-height:1.7;">
            <div><strong>Productor:</strong> ${escHtml(existing.productor || '—')}</div>
            <div><strong>Establecimiento:</strong> ${escHtml(existing.establecimiento || '—')}</div>
            <div><strong>Fecha de registro:</strong> ${escHtml(existing.fecha || '—')}</div>
        </div>
    `;

    modal.classList.add('active');
    if (window.lucide) window.lucide.createIcons();
}

function closeRpConflictModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('rpConflictModal');
    if (modal) modal.classList.remove('active');
}

/** El usuario elige ACTUALIZAR → abre el modal de edición del ternero existente */
async function rpConflictUpdate() {
    const modal = document.getElementById('rpConflictModal');
    if (modal) modal.classList.remove('active');

    if (!_pendingConflictExisting) return;

    // Abrir el modal de edición con el registro existente
    openDetail(_pendingConflictExisting.id);

    _pendingNewRecord        = null;
    _pendingConflictExisting = null;
}

/** El usuario elige CREAR NUEVO → reenvía el registro con force_create=true */
async function rpConflictCreateNew() {
    const updateBtn = document.getElementById('rpConflict-create-btn');
    const modal     = document.getElementById('rpConflictModal');

    if (!_pendingNewRecord) return;

    if (updateBtn) { updateBtn.disabled = true; updateBtn.textContent = 'Guardando...'; }

    try {
        const res = await apiFetchApp(API_RECORDS, {
            method: 'POST',
            body: JSON.stringify({ action: 'save', force_create: true, ..._pendingNewRecord }),
        });

        if (res.ok) {
            _pendingNewRecord.id     = res.id;
            _pendingNewRecord.synced = true;
            records.unshift(_pendingNewRecord);
            showToast('✅ Nuevo ternero creado con el mismo R.P.');
            updateUI();
            // Limpiar el formulario principal
            const form = document.getElementById('entryForm');
            if (form) {
                form.reset();
                form.querySelectorAll('[data-dirty]').forEach(el => delete el.dataset.dirty);
            }
        } else {
            showToast('Error al crear el ternero: ' + (res.error || 'Intente de nuevo.'));
        }
    } catch (err) {
        console.error(err);
        showToast('Error de red al guardar.');
    } finally {
        if (modal) modal.classList.remove('active');
        if (updateBtn) { updateBtn.disabled = false; updateBtn.textContent = 'Crear nuevo con mismo R.P.'; }
        _pendingNewRecord        = null;
        _pendingConflictExisting = null;
    }
}

window.exportBackup = exportBackup;
window.closeExportModal = closeExportModal;
window.confirmExport = confirmExport;
window.generateXlsxReport = generateXlsxReport;
window.generateZipRecords = generateZipRecords;
window.handleImportBackup = handleImportBackup;
window.openImportExcelModal = openImportExcelModal;
window.closeImportExcelModal = closeImportExcelModal;
window.downloadExcelTemplate = downloadExcelTemplate;
window.handleImportExcelFile = handleImportExcelFile;
window.confirmImportExcel = confirmImportExcel;
window.resetImportExcelModal = resetImportExcelModal;
window.showImportReviewStep = showImportReviewStep;
window.autoResolveTwins = autoResolveTwins;
window.closeRpConflictModal = closeRpConflictModal;
window.rpConflictUpdate = rpConflictUpdate;
window.rpConflictCreateNew = rpConflictCreateNew;

// =============================================================
// ARRANQUE — auth.js llama a appLoadForUser() al confirmar sesión
// =============================================================
if (typeof lucide !== 'undefined') lucide.createIcons();

// =============================================================
// ── GESTIÓN DE PRODUCTORES ───────────────────────────────────
// =============================================================

let _deleteProductorTarget = null; // { nombre, totalRegistros }

/** Carga y renderiza la lista de productores en el perfil */
async function loadProductoresList() {
    const container = document.getElementById('productores-list-container');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;padding:1.5rem 0;color:var(--text-secondary);font-size:0.85rem;">Cargando...</div>';

    if (!navigator.onLine) {
        container.innerHTML = '<div style="text-align:center;padding:1.25rem 0;color:var(--text-secondary);font-size:0.85rem;">Sin conexión. Conectate para ver los productores.</div>';
        return;
    }

    // Timeout de 12 segundos para evitar quedarse en "Cargando..." infinito
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
        const token = localStorage.getItem('vetfield_api_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch(API_RECORDS + '?action=list_productores', {
            method: 'GET',
            headers,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        let data;
        try { data = await res.json(); }
        catch { data = { ok: false, error: 'El servidor devolvió una respuesta inesperada.' }; }

        if (!data.ok) throw new Error(data.error || `Error HTTP ${res.status}`);

        const prods = data.productores || [];

        if (prods.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:1.25rem 0;color:var(--text-secondary);font-size:0.85rem;">No tenés productores registrados aún.</div>';
            return;
        }

        const rows = prods.map(p => `
            <div class="prod-list-row">
                <div class="prod-list-info">
                    <span class="prod-list-name">${_esc(p.nombre)}</span>
                    <span class="prod-list-meta">
                        ${p.total_registros} registro${p.total_registros !== '1' ? 's' : ''}
                        &nbsp;·&nbsp;
                        ${p.total_establecimientos} establecimiento${p.total_establecimientos !== '1' ? 's' : ''}
                    </span>
                </div>
                <button class="prod-list-del-btn" title="Eliminar productor"
                    onclick="openDeleteProductorModal('${_esc(p.nombre).replace(/'/g, "\\'")}', ${p.total_registros})">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
            </div>
        `).join('');

        container.innerHTML = `<div class="prod-list">${rows}</div>`;

    } catch (err) {
        clearTimeout(timeoutId);
        const msg = err.name === 'AbortError'
            ? 'El servidor tardó demasiado. El servidor puede estar iniciando, intentá de nuevo en unos segundos.'
            : (err.message || 'Error desconocido al cargar productores.');
        container.innerHTML = `
            <div style="padding:1rem;border-radius:10px;background:rgba(220,38,38,0.06);border:1px solid rgba(220,38,38,0.18);">
                <p style="color:#dc2626;font-size:0.82rem;font-weight:600;margin:0 0 8px 0;">${_esc(msg)}</p>
                <button onclick="window.loadProductoresList()"
                    style="font-size:0.78rem;font-weight:700;color:var(--primary);background:transparent;border:1.5px solid var(--primary);border-radius:8px;padding:5px 12px;cursor:pointer;font-family:inherit;">
                    Reintentar
                </button>
            </div>`;
    }
}

/** Sanitiza texto para insertar en HTML */
function _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Abre el modal de confirmación de borrado */
function openDeleteProductorModal(nombre, totalRegistros) {
    _deleteProductorTarget = { nombre, totalRegistros: parseInt(totalRegistros) };

    const subtitleEl = document.getElementById('del-prod-subtitle');
    if (subtitleEl) {
        subtitleEl.textContent = `Se eliminarán ${totalRegistros} registros y todos los establecimientos de "${nombre}".`;
    }

    const input = document.getElementById('del-prod-confirm-input');
    if (input) { input.value = ''; }

    const btn = document.getElementById('btn-confirm-delete-productor');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.textContent = 'Eliminar todo'; }

    const errEl = document.getElementById('del-prod-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    const modal = document.getElementById('deleteProductorModal');
    if (modal) {
        modal.classList.add('active');
        setTimeout(() => { if (input) input.focus(); }, 200);
    }
}

/** Cierra el modal de confirmación */
function closeDeleteProductorModal(event) {
    if (event && event.target !== document.getElementById('deleteProductorModal')) return;
    const modal = document.getElementById('deleteProductorModal');
    if (modal) modal.classList.remove('active');
    _deleteProductorTarget = null;
}

/** Habilita el botón solo si el nombre escrito coincide exactamente */
function checkDeleteProductorConfirm(input) {
    if (!_deleteProductorTarget) return;
    const btn = document.getElementById('btn-confirm-delete-productor');
    const matches = input.value.trim() === _deleteProductorTarget.nombre;
    if (btn) {
        btn.disabled = !matches;
        btn.style.opacity = matches ? '1' : '0.5';
        btn.style.cursor = matches ? 'pointer' : 'not-allowed';
    }
}

/** Ejecuta el borrado en el servidor */
async function confirmDeleteProductor(btn) {
    if (!_deleteProductorTarget) return;
    const { nombre } = _deleteProductorTarget;

    btn.disabled = true;
    btn.textContent = 'Eliminando...';

    const errEl = document.getElementById('del-prod-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    try {
        const res = await apiFetchApp(API_RECORDS, {
            method: 'POST',
            body: JSON.stringify({ action: 'delete_productor', nombre }),
        });

        if (!res.ok) throw new Error(res.error || 'Error al eliminar el productor.');

        // Actualizar arrays en memoria
        records = records.filter(r => r.productor !== nombre);
        productores = productores.filter(p => p !== nombre);
        delete establecimientos_por_productor[nombre];

        // Refrescar UI
        updateUI();
        renderTable();

        const modal = document.getElementById('deleteProductorModal');
        if (modal) modal.classList.remove('active');
        _deleteProductorTarget = null;

        showToast(`🗑️ Productor "${nombre}" eliminado correctamente.`);
        loadProductoresList(); // Refrescar lista

    } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = ''; }
        btn.disabled = false;
        btn.textContent = 'Eliminar todo';
    }
}

window.loadProductoresList     = loadProductoresList;
window.openDeleteProductorModal  = openDeleteProductorModal;
window.closeDeleteProductorModal = closeDeleteProductorModal;
window.checkDeleteProductorConfirm = checkDeleteProductorConfirm;
window.confirmDeleteProductor  = confirmDeleteProductor;

