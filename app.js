// =============================================================
// VETFIELD PRO — app.js v3 (MySQL Edition)
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
    updateUI();
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Inicializar dashboard con datos cargados
    // Timeout aumentado para mobile: el layout necesita estar pintado antes de que Chart.js calcule dimensiones
    if (typeof initDashboard === 'function') {
        setTimeout(initDashboard, 400);
    }
}

window.appLoadForUser = appLoadForUser;

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

const opcionesCausa = {
    'Enfermedades e Infecciones': ['Colibacilosis', 'Salmonelosis', 'Rotavirus', 'Coronavirus', 'Criptosporidiosis', 'Onfalitis', 'Neumonía'],
    'Problemas Digestivos y Metabólicos': ['Torsión de abomaso', 'Úlcera de abomaso', 'Intoxicación'],
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

function toggleCausa(show) {
    const group = document.getElementById('causaGroup');
    group.classList.toggle('hidden', !show);
    
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

        // 1. Check if rp_ternero is filled and matches an existing record
        let matchedRecord = null;
        if (rpTerneroVal !== '') {
            matchedRecord = records.find(r => r.rp_ternero && r.rp_ternero.trim().toUpperCase() === rpTerneroVal.toUpperCase());
        }

        if (matchedRecord) {
            console.log('[VETFIELD] 🔄 Ternero existente encontrado. RP:', rpTerneroVal);
            
            // Construct the updated record object starting from the matched record
            const updatedRecord = { ...matchedRecord };

            // productor: required, update if not empty
            if (productorVal.trim() !== '') {
                updatedRecord.productor = productorVal.trim();
            }
            // establecimiento: update if not empty
            if (establecimientoVal.trim() !== '') {
                updatedRecord.establecimiento = establecimientoVal.trim();
            }
            // fecha: update if dirty or if it changed
            const fechaInput = document.getElementById('f_fecha');
            if (fechaInput && (fechaInput.dataset.dirty === 'true' || fechaVal !== matchedRecord.fecha)) {
                updatedRecord.fecha = fechaVal;
            }
            // ig_ternero: update if filled
            const igTerneroVal = document.getElementById('f_ig_ternero').value.trim();
            if (igTerneroVal !== '') {
                updatedRecord.ig_ternero = igTerneroVal;
            }
            // sexo: update if dirty
            const sexoInput = document.getElementById('f_sexo_val');
            if (sexoInput && (sexoInput.dataset.dirty === 'true' || matchedRecord.sexo === undefined || matchedRecord.sexo === null)) {
                updatedRecord.sexo = sexoInput.value;
            }
            // ombligo: update if dirty
            const ombligoInput = document.getElementById('f_ombligo_val');
            if (ombligoInput && (ombligoInput.dataset.dirty === 'true' || matchedRecord.ombligo === undefined || matchedRecord.ombligo === null)) {
                updatedRecord.ombligo = ombligoInput.value;
            }
            // tipo_madre: update if dirty
            const tipoMadreInput = document.getElementById('f_tipo_madre');
            if (tipoMadreInput && (tipoMadreInput.dataset.dirty === 'true' || matchedRecord.tipo_madre === undefined || matchedRecord.tipo_madre === null)) {
                updatedRecord.tipo_madre = tipoMadreInput.value;
            }
            // rp_madre: update if filled
            const rpMadreVal = document.getElementById('f_rp_madre').value.trim();
            if (rpMadreVal !== '') {
                updatedRecord.rp_madre = rpMadreVal;
            }
            // ig_calostro: update if filled
            const igCalostroVal = document.getElementById('f_ig_calostro').value.trim();
            if (igCalostroVal !== '') {
                updatedRecord.ig_calostro = igCalostroVal;
            }

            // survival: check if dirty
            let isSurvivalDirty = false;
            document.querySelectorAll('input[name="survival"]').forEach(radio => {
                if (radio.dataset.dirty === 'true') isSurvivalDirty = true;
            });

            if (isSurvivalDirty || matchedRecord.estado === undefined || matchedRecord.estado === null) {
                const newEstado = document.querySelector('input[name="survival"]:checked').value;
                updatedRecord.estado = newEstado;
                if (newEstado === 'Vivo') {
                    updatedRecord.causa = '';
                    updatedRecord.causa_categoria = '';
                    updatedRecord.causa_especifica = '';
                } else {
                    const catVal = document.getElementById('f_causa_categoria_val').value;
                    const espVal = catVal === 'Otra Causa'
                        ? document.getElementById('f_causa_especifica_custom').value.trim()
                        : document.getElementById('f_causa_especifica').value;
                    if (catVal.trim() !== '') {
                        updatedRecord.causa_categoria = catVal;
                    }
                    if (espVal.trim() !== '') {
                        updatedRecord.causa_especifica = espVal;
                    }
                    updatedRecord.causa = (updatedRecord.causa_categoria && updatedRecord.causa_especifica)
                        ? `${updatedRecord.causa_categoria} - ${updatedRecord.causa_especifica}`
                        : (updatedRecord.causa_categoria || updatedRecord.causa_especifica || '');
                }
            } else {
                // If survival wasn't changed but the original state was not Vivo, check if category or specific cause were changed
                if (matchedRecord.estado !== 'Vivo') {
                    const catVal = document.getElementById('f_causa_categoria_val').value;
                    const espVal = catVal === 'Otra Causa'
                        ? document.getElementById('f_causa_especifica_custom').value.trim()
                        : document.getElementById('f_causa_especifica').value;
                    if (catVal.trim() !== '') {
                        updatedRecord.causa_categoria = catVal;
                    }
                    if (espVal.trim() !== '') {
                        updatedRecord.causa_especifica = espVal;
                    }
                    updatedRecord.causa = (updatedRecord.causa_categoria && updatedRecord.causa_especifica)
                        ? `${updatedRecord.causa_categoria} - ${updatedRecord.causa_especifica}`
                        : (updatedRecord.causa_categoria || updatedRecord.causa_especifica || '');
                }
            }

            updatedRecord.synced = false;

            const btnSave = form.querySelector('.btn-save');
            if (btnSave) btnSave.disabled = true;

            let saved = false;

            if (updatedRecord.id && navigator.onLine) {
                // Modo Online con ID: llamar a action: 'update'
                const res = await apiFetchApp(API_RECORDS, {
                    method: 'POST',
                    body: JSON.stringify({ action: 'update', ...updatedRecord }),
                });
                console.log('[VETFIELD] 🔄 Respuesta de la API para UPDATE:', JSON.stringify(res));
                if (res.ok) {
                    updatedRecord.synced = true;
                    saved = true;
                    showToast('✅ Registro del ternero actualizado en la nube.');
                } else {
                    console.warn('[VETFIELD] ⚠️ UPDATE falló, guardando localmente. Error:', res.error);
                }
            }

            if (!saved) {
                // Modo Offline o falla de API o registro sin ID: actualizar localmente
                updatedRecord.synced = false;
                // Actualizamos en memoria
                Object.assign(matchedRecord, updatedRecord);
                
                // Actualizar offline records
                const offline = getOfflineRecords();
                const idx = offline.findIndex(o => (o._local_id && o._local_id === matchedRecord._local_id) || (o.id && o.id === matchedRecord.id));
                if (idx !== -1) {
                    Object.assign(offline[idx], updatedRecord);
                } else {
                    offline.unshift(updatedRecord);
                }
                saveOfflineRecords(offline);

                showToast('💾 Sin conexión o error. Actualizado localmente.');
            } else {
                // Actualización online exitosa, actualizar en memoria
                Object.assign(matchedRecord, updatedRecord);
            }

            if (btnSave) btnSave.disabled = false;

        } else {
            const isVivo = document.querySelector('input[name="survival"]:checked').value === 'Vivo';
            const catVal = isVivo ? '' : document.getElementById('f_causa_categoria_val').value;
            const espVal = isVivo ? '' : (catVal === 'Otra Causa'
                ? document.getElementById('f_causa_especifica_custom').value.trim()
                : document.getElementById('f_causa_especifica').value);

            const newRecord = {
                establecimiento: establecimientoVal,
                fecha:           fechaVal,
                productor:       productorVal,
                rp_ternero:      rpTerneroVal,
                ig_ternero:      document.getElementById('f_ig_ternero').value,
                sexo:            document.getElementById('f_sexo_val').value,
                ombligo:         document.getElementById('f_ombligo_val').value,
                tipo_madre:      document.getElementById('f_tipo_madre').value,
                rp_madre:        document.getElementById('f_rp_madre').value,
                ig_calostro:     document.getElementById('f_ig_calostro').value,
                estado:          document.querySelector('input[name="survival"]:checked').value,
                causa:           isVivo ? '' : (catVal && espVal ? `${catVal} - ${espVal}` : (catVal || espVal || '')),
                causa_categoria: catVal,
                causa_especifica:espVal,
                synced:          false,
                _local_id:       Date.now(), // ID temporal para modo offline
            };

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
                }

                if (btnSave) btnSave.disabled = false;
            } else {
                _saveOffline(newRecord, establecimientoVal, productorVal);
                showToast('💾 Sin conexión. Registro guardado localmente.');
            }
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
    const r = records.find(rec => (rec.id || rec._local_id) === recordId);
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
        <div class="form-group">
            <label>Productor</label>
            <input id="edit_productor" value="${escHtml(r.productor || '')}">
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
        <div class="form-group">
            <label>Tipo Madre</label>
            <select id="edit_tipo_madre">
                <option value="Vaca" ${r.tipo_madre === 'Vaca' ? 'selected' : ''}>Vaca</option>
                <option value="Vaquillona" ${r.tipo_madre === 'Vaquillona' ? 'selected' : ''}>Vaquillona</option>
            </select>
        </div>
        <div class="form-group">
            <label>Supervivencia</label>
            <select id="edit_estado" onchange="toggleEditCausa(this.value)">
                ${estadoOptionsHtml}
            </select>
        </div>
        <div class="form-group" id="edit_causa_cat_group" style="${r.estado !== 'Vivo' ? '' : 'display:none;'}">
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
        <div class="form-group" id="edit_causa_custom_group" style="${(r.estado !== 'Vivo' && r.causa_categoria === 'Otra Causa') ? '' : 'display:none;'}">
            <label>Especifique la Causa</label>
            <input id="edit_causa_especifica_custom" value="${escHtml(r.causa_categoria === 'Otra Causa' ? r.causa_especifica || '' : '')}">
        </div>
        <div class="form-group">
            <label>Fecha</label>
            <input id="edit_fecha" type="date" value="${escHtml(r.fecha || '')}">
        </div>
        <div class="form-group">
            <label>Establecimiento</label>
            <input id="edit_establecimiento" value="${escHtml(r.establecimiento || '')}">
        </div>
        <div class="form-group">
            <label>R.P. Ternero</label>
            <input id="edit_rp_ternero" value="${escHtml(r.rp_ternero || '')}">
        </div>
        <div class="form-group">
            <label>R.P. Madre</label>
            <input id="edit_rp_madre" value="${escHtml(r.rp_madre || '')}">
        </div>
        <div class="form-group">
            <label>I.G. Calostro Madre</label>
            <input id="edit_ig_calostro" type="number" step="0.1" value="${r.ig_calostro ?? ''}">
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
    if (!catGroup) return;
    if (estado === 'Vivo') {
        catGroup.style.display = 'none';
        espGroup.style.display = 'none';
        if (customGroup) customGroup.style.display = 'none';
    } else {
        catGroup.style.display = '';
        const cat = document.getElementById('edit_causa_categoria').value;
        if (cat === 'Otra Causa') {
            espGroup.style.display = 'none';
            if (customGroup) customGroup.style.display = '';
        } else {
            espGroup.style.display = cat ? '' : 'none';
            if (customGroup) customGroup.style.display = 'none';
        }
    }
}

function refreshEditCausaEsp(cat) {
    const espGroup = document.getElementById('edit_causa_esp_group');
    const espSelect = document.getElementById('edit_causa_especifica');
    const customGroup = document.getElementById('edit_causa_custom_group');
    if (!espGroup) return;
    if (!cat) {
        espGroup.style.display = 'none';
        if (customGroup) customGroup.style.display = 'none';
        return;
    }
    if (cat === 'Otra Causa') {
        espGroup.style.display = 'none';
        if (customGroup) customGroup.style.display = '';
    } else {
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
    const r = records.find(rec => (rec.id || rec._local_id) === _currentEditId);
    if (!r) return;

    const errEl = document.getElementById('edit_save_error');
    const saveBtn = document.getElementById('modal-save-btn');

    const estado = document.getElementById('edit_estado').value;
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
        estado:          estado,
        causa_categoria: causaCat,
        causa_especifica: causaEsp,
        causa:           causaCat && causaEsp ? `${causaCat} - ${causaEsp}` : (causaCat || causaEsp || ''),
        fecha:           document.getElementById('edit_fecha').value,
        establecimiento: document.getElementById('edit_establecimiento').value.trim(),
        rp_ternero:      document.getElementById('edit_rp_ternero').value.trim(),
        rp_madre:        document.getElementById('edit_rp_madre').value.trim(),
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

    const r = records.find(rec => (rec.id || rec._local_id) === _currentEditId);
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
    const productorFilter = document.getElementById('filterProductor')?.value || '';
    const dateFrom       = document.getElementById('filterDateFrom')?.value || '';
    const dateTo         = document.getElementById('filterDateTo')?.value || '';
    const estadoFilter   = document.getElementById('filterEstado')?.value || '';
    const madreFilter    = document.getElementById('filterCategoriaMadre')?.value || '';
    const riesgoFilter   = document.getElementById('filterRiesgoSanitario')?.value || '';

    return records.filter(r => {
        const matchEstablecimiento = !searchTerm || (r.establecimiento && r.establecimiento.toLowerCase().includes(searchTerm));
        const matchProductor      = !productorFilter || r.productor === productorFilter;
        
        let matchDate = true;
        if (dateFrom && r.fecha < dateFrom) matchDate = false;
        if (dateTo && r.fecha > dateTo) matchDate = false;
        
        let matchEstado = true;
        if (estadoFilter === 'Vivo' && r.estado !== 'Vivo') matchEstado = false;
        if (estadoFilter === 'Muerto' && r.estado === 'Vivo') matchEstado = false;
        
        let matchMadre = true;
        if (madreFilter && r.tipo_madre !== madreFilter) matchMadre = false;
        
        let matchRiesgo = true;
        if (riesgoFilter === 'Alto') {
            // Bug Fix #4: Si ig_ternero está vacío/ausente también se considera riesgo alto
            const ig = parseFloat(r.ig_ternero);
            const isMissingIg = r.ig_ternero === '' || r.ig_ternero === null || r.ig_ternero === undefined || isNaN(ig);
            const isLowIg    = !isNaN(ig) && ig <= 10;
            const isBadNavel = r.ombligo === 'Malo' || r.ombligo === 'Regular';
            if (!isMissingIg && !isLowIg && !isBadNavel) matchRiesgo = false;
        }

        return matchEstablecimiento && matchProductor && matchDate && matchEstado && matchMadre && matchRiesgo;
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
    ['filterProductor', 'searchEstablecimiento', 'filterDateFrom', 'filterDateTo', 
     'filterEstado', 'filterCategoriaMadre', 'filterRiesgoSanitario'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    filterTable();
}

function saveReportFilter() {
    const filterState = {
        productor: document.getElementById('filterProductor')?.value || '',
        establecimiento: document.getElementById('searchEstablecimiento')?.value || '',
        dateFrom: document.getElementById('filterDateFrom')?.value || '',
        dateTo: document.getElementById('filterDateTo')?.value || '',
        estado: document.getElementById('filterEstado')?.value || '',
        madre: document.getElementById('filterCategoriaMadre')?.value || '',
        riesgo: document.getElementById('filterRiesgoSanitario')?.value || ''
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
    if (document.getElementById('filterDateFrom')) document.getElementById('filterDateFrom').value = filterState.dateFrom || '';
    if (document.getElementById('filterDateTo')) document.getElementById('filterDateTo').value = filterState.dateTo || '';
    if (document.getElementById('filterEstado')) document.getElementById('filterEstado').value = filterState.estado || '';
    if (document.getElementById('filterCategoriaMadre')) document.getElementById('filterCategoriaMadre').value = filterState.madre || '';
    if (document.getElementById('filterRiesgoSanitario')) document.getElementById('filterRiesgoSanitario').value = filterState.riesgo || '';
    
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
            <td style="font-size:0.9rem;">${r.rp_ternero || '-'}</td>
            <td>
                <div style="font-weight:700;color:var(--primary);">${r.ig_ternero ?? '-'}%</div>
                <span style="display:inline-block;margin-top:3px;padding:2px 8px;border-radius:99px;font-size:0.68rem;font-weight:700;
                    background:${vivo?'rgba(16,185,129,0.12)':'rgba(220,38,38,0.1)'};
                    color:${vivo?'var(--secondary)':'#dc2626'};">${r.estado}</span>
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
        'filterRiesgoSanitario',
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

    doc.text(subtext, 30, 87);

    doc.autoTable({
        startY: 105,
        head: [['Establecimiento', 'R.P.', 'I.G.', 'Estado', 'Sexo', 'Ombligo']],
        body: filteredRecords.map(r => [r.establecimiento, r.rp_ternero, r.ig_ternero + '%', r.estado, r.sexo, r.ombligo]),
        theme: 'grid',
        headStyles: { fillColor: [26, 35, 126], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 4 },
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
            "R.P. Madre": r.rp_madre || "-",
            "I.G. Calostro Madre (mg/dL)": r.ig_calostro !== null ? Number(r.ig_calostro) : "-",
            "Estado": r.estado || "-",
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

DATOS DE LA MADRE:
Tipo de Madre:     ${r.tipo_madre || "-"}
R.P. Madre:        ${r.rp_madre || "-"}
I.G. Calostro:     ${r.ig_calostro !== null ? r.ig_calostro + ' mg/dL' : "-"}

ESTADO SANITARIO:
Supervivencia:     ${r.estado || "-"}
Causa de Muerte:   ${r.causa || "-"}
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
    const confirmBtn = document.getElementById('btn-confirm-import-excel');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Subir y Procesar';
    }
    const fileNameSpan = document.getElementById('excel-file-name');
    if (fileNameSpan) {
        fileNameSpan.textContent = 'Haga clic para seleccionar planilla (.xlsx / .csv)';
    }
    const fileInput = document.getElementById('excel-import-file');
    if (fileInput) fileInput.value = '';
    
    document.getElementById('importExcelModal').classList.add('active');
}

function closeImportExcelModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('importExcelModal').classList.remove('active');
    _parsedExcelData = null;
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
            "R.P. Madre",
            "I.G. Calostro Madre",
            "Estado",
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
            "8832",
            "22.5",
            "Vivo",
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
            "8835",
            "18.1",
            "Muerto en Terapia",
            "Enfermedades e Infecciones",
            "Neumonía"
        ];
        
        const data = [headers, row1, row2];
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
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
            
            if (json.length === 0) {
                showToast('El archivo está vacío o no tiene registros.');
                if (fileNameSpan) fileNameSpan.textContent = 'Error: Archivo vacío';
                return;
            }

            // Helpers for parsing and normalizing
            function findValue(row, aliases) {
                const keys = Object.keys(row);
                for (const alias of aliases) {
                    const foundKey = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, "").includes(alias.toLowerCase().replace(/[^a-z0-9]/g, "")));
                    if (foundKey) return row[foundKey];
                }
                // Fallback search
                for (const key of keys) {
                    if (key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(aliases[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) {
                        return row[key];
                    }
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

            function parseNumeric(val) {
                if (val === undefined || val === null || val === "") return null;
                const num = parseFloat(String(val).replace(",", "."));
                return isNaN(num) ? null : num;
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

            function sanitizeEstado(val) {
                const str = trimValue(val).toLowerCase();
                if (str.includes("establecimiento") || str.includes("est")) return "Muerto en Establecimiento";
                if (str.includes("guacheria") || str.includes("guach")) return "Muerto en Guachería";
                if (str.includes("terapia") || str.includes("ter")) return "Muerto en Terapia";
                if (str.includes("muert") || str.includes("fallec")) return "Muerto en Establecimiento";
                return "Vivo";
            }

            const mappedRecords = [];
            const uniqueProductors = new Set();
            const uniqueEstablishments = [];

            for (const row of json) {
                const productor = trimValue(findValue(row, ["productor", "cliente", "owner"]));
                const fecha = formatDateValue(findValue(row, ["fecha", "date"]));
                
                if (!productor || !fecha) {
                    continue; // Skip invalid rows
                }
                
                const establecimiento = trimValue(findValue(row, ["establecimiento", "campo", "lote", "location"])) || "";
                const rp_ternero = trimValue(findValue(row, ["rp ternero", "rp_ternero", "rp", "id ternero", "calf id"])) || "";
                const ig_ternero = parseNumeric(findValue(row, ["ig ternero", "ig_ternero", "ig", "ig%"]));
                const sexo = sanitizeSexo(findValue(row, ["sexo", "gender"]));
                const ombligo = sanitizeOmbligo(findValue(row, ["ombligo", "estado ombligo", "navel"]));
                const tipo_madre = sanitizeTipoMadre(findValue(row, ["tipo madre", "tipo_madre", "madre tipo"]));
                const rp_madre = trimValue(findValue(row, ["rp madre", "rp_madre", "rp de la madre", "madre id"])) || "";
                const ig_calostro = parseNumeric(findValue(row, ["ig calostro", "ig_calostro", "calostro"]));
                const estado = sanitizeEstado(findValue(row, ["estado", "supervivencia", "status"]));
                
                const causa_cat = trimValue(findValue(row, ["causa categoria", "causa_categoria", "categoria muerte", "categoria"])) || "";
                const causa_esp = trimValue(findValue(row, ["causa especifica", "causa_especifica", "causa muerte", "causa"])) || "";
                const causa = causa_cat && causa_esp ? `${causa_cat} - ${causa_esp}` : (causa_cat || causa_esp || "");
                
                uniqueProductors.add(productor);
                if (establecimiento) {
                    const exists = uniqueEstablishments.some(e => e.productor === productor && e.establecimiento === establecimiento);
                    if (!exists) {
                        uniqueEstablishments.push({ productor, establecimiento });
                    }
                }
                
                mappedRecords.push({
                    productor,
                    establecimiento: establecimiento || null,
                    fecha,
                    rp_ternero: rp_ternero || null,
                    ig_ternero: ig_ternero,
                    sexo,
                    ombligo,
                    tipo_madre,
                    rp_madre: rp_madre || null,
                    ig_calostro: ig_calostro,
                    estado,
                    causa: estado !== 'Vivo' ? causa || null : null,
                    causa_categoria: estado !== 'Vivo' ? causa_cat || null : null,
                    causa_especifica: estado !== 'Vivo' ? causa_esp || null : null
                });
            }

            if (mappedRecords.length === 0) {
                showToast('No se encontraron registros válidos. Verifica Productor y Fecha.');
                if (fileNameSpan) fileNameSpan.textContent = 'Error: Sin registros válidos';
                return;
            }

            _parsedExcelData = {
                productores: Array.from(uniqueProductors),
                establecimientos: uniqueEstablishments,
                registros: mappedRecords
            };

            if (fileNameSpan) {
                fileNameSpan.textContent = `Archivo: ${file.name} (${mappedRecords.length} registros)`;
            }
            if (confirmBtn) {
                confirmBtn.disabled = false;
            }
            showToast(`Listo para importar: ${mappedRecords.length} registros cargados.`);
        } catch (err) {
            console.error(err);
            showToast('Error al parsear la planilla. Asegúrate de que no esté corrupta.');
            if (fileNameSpan) fileNameSpan.textContent = 'Error al leer archivo';
        }
    };
    reader.readAsArrayBuffer(file);
}

async function confirmImportExcel(btnEl) {
    if (!_parsedExcelData) {
        showToast('No hay datos cargados para importar.');
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

    try {
        const payload = {
            action: 'backup_import',
            data: _parsedExcelData
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

// =============================================================
// ARRANQUE — auth.js llama a appLoadForUser() al confirmar sesión
// =============================================================
if (typeof lucide !== 'undefined') lucide.createIcons();
