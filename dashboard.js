// =============================================================
// VETFIELD PRO — dashboard.js
// Dashboard dinámico con 10 visualizaciones + 4 KPIs
// Usa Chart.js (cargado en index.html)
// =============================================================

'use strict';

// ─── MOCK DATA — 440 registros determinísticos ──────────────────
const MOCK_RECORDS = (function generateMockData() {

    const PRODUCTORES      = ['AgroSura', 'El Ombú', 'Don Juan', 'Lácteo Pro'];
    const ESTABLECIMIENTOS = ['Sección A', 'Sección B', 'Lote Sur', 'Guachería'];

    const CAUSAS = {
        'Enfermedades e Infecciones':         ['Neumonía','Salmonelosis','Rotavirus','Colibacilosis','Onfalitis','Criptosporidiosis','Coronavirus'],
        'Problemas Digestivos y Metabólicos': ['Diarrea','Torsión de abomaso','Úlcera de abomaso','Intoxicación'],
        'Factores Externos y de Manejo':      ['Estrés calórico','Traumática','Falsa vía'],
    };
    const CAT_KEYS = Object.keys(CAUSAS);

    // RNG determinístico (mismo dataset en cada carga de página)
    let _s = 20260101;
    function rng() {
        _s = Math.imul(_s ^ (_s >>> 16), 0x45d9f3b);
        _s = Math.imul(_s ^ (_s >>> 16), 0x45d9f3b);
        _s = _s ^ (_s >>> 16);
        return (_s >>> 0) / 0x100000000;
    }

    const START    = new Date('2026-01-01T00:00:00Z').getTime();
    const END      = new Date('2026-04-19T00:00:00Z').getTime();
    const RANGE_MS = END - START;

    function randomDate() {
        return new Date(START + Math.floor(rng() * RANGE_MS)).toISOString().split('T')[0];
    }
    function randomDateInRange(a, b) {
        return new Date(a + Math.floor(rng() * (b - a))).toISOString().split('T')[0];
    }

    const LOCS = ['Muerto en Establecimiento','Muerto en Guachería','Muerto en Terapia'];

    function pickLoc()   { return LOCS[Math.floor(rng() * 3)]; }
    function pickCausa() {
        // Pesos: Infecciones 55 %, Digestivos 20 %, Manejo 25 %
        const r = rng();
        const cat = r < 0.55 ? CAT_KEYS[0] : r < 0.75 ? CAT_KEYS[1] : CAT_KEYS[2];
        const opts = CAUSAS[cat];
        return { causa_categoria: cat, causa_especifica: opts[Math.floor(rng() * opts.length)] };
    }

    function pickOmbligo(estado) {
        const r = rng();
        if (estado === 'Muerto en Guachería') return r < 0.62 ? 'Malo' : r < 0.88 ? 'Regular' : 'Bueno';
        if (estado !== 'Vivo')               return r < 0.28 ? 'Malo' : r < 0.60 ? 'Regular' : 'Bueno';
        return r < 0.70 ? 'Bueno' : r < 0.92 ? 'Regular' : 'Malo';
    }

    function makeRecord(idx, prod, est, fecha, tipo_madre, ig_calostro, forceDeathCat, forceDeathEsp) {
        const ig_ternero = parseFloat((rng() * 28 + 3).toFixed(1));
        const sexo       = rng() < 0.52 ? 'Macho' : 'Hembra';
        const mortThresh = tipo_madre === 'Vaca' ? 0.09 : 0.108; // vaquillona +20 %

        let estado = 'Vivo', causa_categoria = '', causa_especifica = '';

        if (forceDeathCat) {
            // Muerte forzada (bloque Febrero Lote Sur)
            estado = pickLoc();
            causa_categoria  = forceDeathCat;
            causa_especifica = forceDeathEsp;
        } else if (ig_calostro < 5.0 && rng() < 0.50) {
            // Calostro bajo → 50 % muere por Rotavirus u Onfalitis
            estado = pickLoc();
            causa_categoria  = 'Enfermedades e Infecciones';
            causa_especifica = rng() < 0.5 ? 'Rotavirus' : 'Onfalitis';
        } else if (rng() < mortThresh) {
            // Mortalidad base según tipo madre
            estado = pickLoc();
            const c = pickCausa();
            causa_categoria  = c.causa_categoria;
            causa_especifica = c.causa_especifica;
        }

        // Regla: ig_calostro > 8 → siempre vivo (override)
        if (!forceDeathCat && ig_calostro > 8.0 && estado !== 'Vivo') {
            estado = 'Vivo'; causa_categoria = ''; causa_especifica = '';
        }

        return {
            id: idx,
            productor: prod, establecimiento: est, fecha,
            rp_ternero: `T-${String(idx).padStart(4,'0')}`,
            ig_ternero, ig_calostro, sexo,
            ombligo: pickOmbligo(estado),
            tipo_madre, estado,
            causa_categoria, causa_especifica,
            causa: causa_categoria ? `${causa_categoria} - ${causa_especifica}` : '',
            synced: true,
        };
    }

    const records = [];

    // ── BLOQUE A: 361 registros generales (sin Lote Sur) ────────
    const ESTS_A = ['Sección A', 'Sección B', 'Guachería'];
    for (let i = 1; i <= 361; i++) {
        const prod       = PRODUCTORES[Math.floor(rng() * 4)];
        const est        = ESTS_A[Math.floor(rng() * 3)];
        const tipo_madre = rng() < 0.62 ? 'Vaca' : 'Vaquillona';
        const ig_calostro = parseFloat((rng() * 38 + 1.5).toFixed(1));
        records.push(makeRecord(i, prod, est, randomDate(), tipo_madre, ig_calostro, null, null));
    }

    // ── BLOQUE B: 15 muertes por Estrés calórico en Lote Sur, Febrero ──
    const FEB_S = new Date('2026-02-01T00:00:00Z').getTime();
    const FEB_E = new Date('2026-02-28T00:00:00Z').getTime();
    for (let i = 1; i <= 15; i++) {
        const tipo_madre  = rng() < 0.55 ? 'Vaca' : 'Vaquillona';
        const ig_calostro = parseFloat((rng() * 5 + 1.5).toFixed(1));
        const prod        = PRODUCTORES[Math.floor(rng() * 4)];
        records.push(makeRecord(
            361 + i, prod, 'Lote Sur',
            randomDateInRange(FEB_S, FEB_E),
            tipo_madre, ig_calostro,
            'Factores Externos y de Manejo', 'Estrés calórico'
        ));
    }

    // ── BLOQUE C: 64 registros adicionales de Lote Sur (mix normal) ──
    for (let i = 1; i <= 64; i++) {
        const prod        = PRODUCTORES[Math.floor(rng() * 4)];
        const tipo_madre  = rng() < 0.60 ? 'Vaca' : 'Vaquillona';
        const ig_calostro = parseFloat((rng() * 36 + 2).toFixed(1));
        records.push(makeRecord(376 + i, prod, 'Lote Sur', randomDate(), tipo_madre, ig_calostro, null, null));
    }

    return records.slice(0, 440);
})();

// ─── ESTADO ──────────────────────────────────────────────────────

let _dashCharts = {};
let _dashFilters = { desde: '', hasta: '', productor: '', establecimiento: '' };
let _useMock = false; // true si los records reales están vacíos

// Datos para el drill-down modal de causas de muerte
let _causasGroupData = null;
let _causasAllData = null;

// Umbrales configurables por el veterinario (se persisten en localStorage)
const _KPI_THRESHOLDS_KEY = 'vetfield_kpi_thresholds';
let _kpiThresholds = (() => {
    try {
        const saved = JSON.parse(localStorage.getItem(_KPI_THRESHOLDS_KEY) || '{}');
        return {
            mortHigh: saved.mortHigh ?? 5,
            mortMid:  saved.mortMid  ?? 3,
            igHigh:   saved.igHigh   ?? 15,
            igMid:    saved.igMid    ?? 10,
        };
    } catch { return { mortHigh: 5, mortMid: 3, igHigh: 15, igMid: 10 }; }
})();

// Inicializar inputs del panel con valores guardados
function _initKpiPanelInputs() {
    const ids = [
        ['kpi_mort_thr_high', _kpiThresholds.mortHigh],
        ['kpi_mort_thr_mid',  _kpiThresholds.mortMid],
        ['kpi_ig_thr_high',   _kpiThresholds.igHigh],
        ['kpi_ig_thr_mid',    _kpiThresholds.igMid],
    ];
    ids.forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    });
}

// Función centralizada para cerrar todos los paneles de rangos y el backdrop overlay
function _closeAllKpiPanels() {
    document.querySelectorAll('.kpi-range-panel.open').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.kpi-config-btn.active').forEach(b => b.classList.remove('active'));
    const backdrop = document.getElementById('kpi_panel_backdrop');
    if (backdrop) backdrop.classList.remove('open');
}

// Toggle apertura/cierre del panel de rangos
function toggleKpiPanel(panelId, btn) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const isOpen = panel.classList.contains('open');
    _closeAllKpiPanels();
    if (!isOpen) {
        // Usar el ancho de la card padre, con un mínimo de 280px para evitar desbordamiento en mobile
        const card = btn.closest('.kpi-card');
        const cardRect = card ? card.getBoundingClientRect() : btn.getBoundingClientRect();
        const panelWidth = Math.max(280, cardRect.width);
        panel.style.width = panelWidth + 'px';
        // Centrar horizontalmente sobre la card y limitar a los límites de la pantalla
        let left = cardRect.left + (cardRect.width - panelWidth) / 2;
        const viewportWidth = window.innerWidth;
        if (left < 10) left = 10;
        if (left + panelWidth > viewportWidth - 10) {
            left = viewportWidth - panelWidth - 10;
        }
        const top  = cardRect.bottom + 6;
        panel.style.top  = top + 'px';
        panel.style.left = left + 'px';
        panel.classList.add('open');
        if (btn) btn.classList.add('active');

        // Mostrar el backdrop en celulares/tablets
        const backdrop = document.getElementById('kpi_panel_backdrop');
        if (backdrop) backdrop.classList.add('open');

        window._kpiPanelJustOpened = true;
        setTimeout(() => { window._kpiPanelJustOpened = false; }, 50);
    }
}
window.toggleKpiPanel = toggleKpiPanel;

// Listener global para cerrar panel al hacer clic fuera
document.addEventListener('click', function(e) {
    if (window._kpiPanelJustOpened) return;
    if (e.target.closest('.kpi-range-panel') || e.target.closest('.kpi-config-btn')) return;

    // Si el usuario está interactuando o escribiendo en un input del panel, ignorar el clic.
    // Esto previene que los eventos de click fantasma (generados al re-evaluar las coordenadas
    // de tap cuando el teclado virtual de iOS se despliega) cierren el modal.
    const activeEl = document.activeElement;
    if (activeEl && activeEl.closest('.kpi-range-panel')) {
        return;
    }

    const anyOpen = document.querySelector('.kpi-range-panel.open');
    if (anyOpen) {
        _closeAllKpiPanels();
    }
});

// Cerrar panel cuando el usuario hace scroll (evita que quede flotando en lugar incorrecto).
// En celulares/tablets (ancho < 768px), como el modal queda fijo y centrado en la pantalla,
// no es necesario cerrarlo al hacer scroll, previniendo cierres accidentales al desplegar el teclado o hacer zoom.
document.addEventListener('scroll', function() {
    if (window.innerWidth < 768) return;
    const activeEl = document.activeElement;
    if (activeEl && activeEl.closest('.kpi-range-panel')) {
        return; // No cerrar si el scroll se debe al teclado virtual o foco en el panel
    }
    _closeAllKpiPanels();
}, true);

function _closeKpiPanelOutside(e) {
    if (!e.target.closest('.kpi-range-panel') && !e.target.closest('.kpi-config-btn')) {
        _closeAllKpiPanels();
    }
}

// Guardar rangos y re-renderizar KPIs
function saveKpiRanges(type) {
    if (type === 'mort') {
        const high = parseFloat(document.getElementById('kpi_mort_thr_high')?.value);
        const mid  = parseFloat(document.getElementById('kpi_mort_thr_mid')?.value);
        if (isNaN(high) || isNaN(mid) || mid >= high) {
            alert('El umbral “Moderado” debe ser menor que el umbral “Alto Riesgo”.');
            return;
        }
        _kpiThresholds.mortHigh = high;
        _kpiThresholds.mortMid  = mid;
    } else if (type === 'ig') {
        const high = parseFloat(document.getElementById('kpi_ig_thr_high')?.value);
        const mid  = parseFloat(document.getElementById('kpi_ig_thr_mid')?.value);
        if (isNaN(high) || isNaN(mid) || mid >= high) {
            alert('El umbral “Aceptable” debe ser menor que el umbral “Óptimo”.');
            return;
        }
        _kpiThresholds.igHigh = high;
        _kpiThresholds.igMid  = mid;
    }
    try { localStorage.setItem(_KPI_THRESHOLDS_KEY, JSON.stringify(_kpiThresholds)); } catch {}
    // Cerrar panel y actualizar KPIs
    _closeAllKpiPanels();
    const data = _getDashRecords();
    _renderKPIs(data);
}
window.saveKpiRanges = saveKpiRanges;

// ─── INIT: llamado desde updateUI() de app.js ─────────────────
function initDashboard() {
    _populateDashFilterDropdowns();
    _bindDashFilterEvents();
    _initKpiPanelInputs();
    _setupBackdropClick();
    renderDashboard();
}
window.initDashboard = initDashboard;

function _setupBackdropClick() {
    const backdrop = document.getElementById('kpi_panel_backdrop');
    if (backdrop && !backdrop.dataset.bound) {
        backdrop.addEventListener('click', () => {
            // Ignorar el click en el backdrop si el usuario está enfocado en un input.
            // Esto evita el cierre accidental debido a clicks fantasmas causados por el shift del teclado.
            const activeEl = document.activeElement;
            if (activeEl && activeEl.closest('.kpi-range-panel')) {
                return;
            }
            _closeAllKpiPanels();
        });
        backdrop.dataset.bound = '1';
    }
}

function _getDashRecords() {
    // Solo datos reales (cargados desde API o localStorage offline)
    const base = (typeof records !== 'undefined') ? records : [];

    const { desde, hasta, productor, establecimiento } = _dashFilters;
    return base.filter(r => {
        if (desde && r.fecha < desde) return false;
        if (hasta && r.fecha > hasta) return false;
        if (productor && r.productor !== productor) return false;
        if (establecimiento && r.establecimiento !== establecimiento) return false;
        return true;
    });
}

function _populateDashFilterDropdowns() {
    const base = (typeof records !== 'undefined') ? records : [];

    const prodSel = document.getElementById('dash_f_productor');
    const estSel  = document.getElementById('dash_f_establecimiento');
    if (!prodSel || !estSel) return;

    const savedP = prodSel.value;
    const savedE = estSel.value;

    const prods = [...new Set(base.map(r => r.productor))].filter(Boolean).sort();
    prodSel.innerHTML = '<option value="">Todos los Productores</option>' +
        prods.map(p => `<option value="${p}" ${p === savedP ? 'selected' : ''}>${p}</option>`).join('');

    // Filtrar establecimientos según el productor seleccionado
    _repopulateEstablecimientoDropdown(savedP, savedE);
}

// Repobla el select de establecimiento del dashboard segun el productor activo
function _repopulateEstablecimientoDropdown(selectedProductor, keepValue) {
    const base    = (typeof records !== 'undefined') ? records : [];
    const estSel  = document.getElementById('dash_f_establecimiento');
    if (!estSel) return;

    let ests;
    if (selectedProductor && typeof establecimientos_por_productor !== 'undefined' &&
        establecimientos_por_productor[selectedProductor] &&
        establecimientos_por_productor[selectedProductor].length > 0) {
        ests = [...establecimientos_por_productor[selectedProductor]].sort();
    } else {
        ests = [...new Set(base.map(r => r.establecimiento))].filter(Boolean).sort();
    }

    estSel.innerHTML = '<option value="">Todos los Establecimientos</option>' +
        ests.map(e => `<option value="${e}" ${e === keepValue ? 'selected' : ''}>${e}</option>`).join('');

    // Si el establecimiento guardado ya no está en la lista, limpiarlo
    if (keepValue && !ests.includes(keepValue)) {
        estSel.value = '';
        _dashFilters.establecimiento = '';
    }
}

function _bindDashFilterEvents() {
    ['dash_f_desde','dash_f_hasta','dash_f_productor','dash_f_establecimiento'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.dashBound) {
            el.addEventListener('change', () => {
                _dashFilters.desde           = document.getElementById('dash_f_desde')?.value || '';
                _dashFilters.hasta           = document.getElementById('dash_f_hasta')?.value || '';
                _dashFilters.productor       = document.getElementById('dash_f_productor')?.value || '';
                _dashFilters.establecimiento = document.getElementById('dash_f_establecimiento')?.value || '';

                // Cuando cambia el productor, repoblar el dropdown de establecimiento
                if (id === 'dash_f_productor') {
                    _repopulateEstablecimientoDropdown(
                        _dashFilters.productor,
                        _dashFilters.establecimiento
                    );
                    // _repopulateEstablecimientoDropdown puede haber limpiado el valor
                    _dashFilters.establecimiento = document.getElementById('dash_f_establecimiento')?.value || '';
                }

                renderDashboard();
            });
            el.dataset.dashBound = '1';
        }
    });

    // Botones rápidos de fecha
    document.querySelectorAll('[data-dash-quick]').forEach(btn => {
        if (!btn.dataset.dashBound) {
            btn.addEventListener('click', () => {
                const range = btn.dataset.dashQuick;
                const now = new Date();
                // Usar fecha local (YYYY-MM-DD) para evitar desfase de timezone UTC
                const todayStr = now.getFullYear() + '-' +
                    String(now.getMonth() + 1).padStart(2, '0') + '-' +
                    String(now.getDate()).padStart(2, '0');
                let startStr = todayStr;
                let endStr = todayStr;
                if (range === 'semana') {
                    const s = new Date(now); s.setDate(s.getDate() - 7);
                    startStr = s.getFullYear() + '-' + String(s.getMonth() + 1).padStart(2, '0') + '-' + String(s.getDate()).padStart(2, '0');
                } else if (range === 'mes') {
                    const s = new Date(now); s.setDate(s.getDate() - 30);
                    startStr = s.getFullYear() + '-' + String(s.getMonth() + 1).padStart(2, '0') + '-' + String(s.getDate()).padStart(2, '0');
                } else if (range === 'trimestre') {
                    const s = new Date(now); s.setMonth(s.getMonth() - 3);
                    startStr = s.getFullYear() + '-' + String(s.getMonth() + 1).padStart(2, '0') + '-' + String(s.getDate()).padStart(2, '0');
                } else if (range === 'ano') {
                    // Inicio: 1 de enero del año actual
                    startStr = now.getFullYear() + '-01-01';
                    // Fin: 31 de diciembre del año actual (incluye registros futuros del año)
                    endStr = now.getFullYear() + '-12-31';
                }
                const desdeEl = document.getElementById('dash_f_desde');
                const hastaEl = document.getElementById('dash_f_hasta');
                if (desdeEl) desdeEl.value = startStr;
                if (hastaEl) hastaEl.value = endStr;
                _dashFilters.desde = startStr;
                _dashFilters.hasta = endStr;
                renderDashboard();

                document.querySelectorAll('[data-dash-quick]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
            btn.dataset.dashBound = '1';
        }
    });
}

// ─── RENDER PRINCIPAL ─────────────────────────────────────────
function renderDashboard() {
    const data = _getDashRecords();
    _renderKPIs(data);
    _renderCausasMuerte(data);
    _renderUbicacionMortalidad(data);
    _renderCorrelacionCalostro(data);
    _renderDesempenoMadre(data);
    _renderSaludOmbligos(data);
    _renderTendenciaTemporal(data);
    _renderRankingEstablecimientos(data);
    _renderMortalidadSexo(data);
}
window.renderDashboard = renderDashboard;

// ────────────────────────────────────────────────────────────────
// KPIs
// ────────────────────────────────────────────────────────────────
function _renderKPIs(data) {
    const total = data.length;
    const muertos = data.filter(r => r.estado !== 'Vivo').length;
    const vivos = total - muertos;
    const tasaMortalidad = total > 0 ? (muertos / total * 100) : 0;

    const igs = data.map(r => parseFloat(r.ig_ternero)).filter(v => !isNaN(v));
    const avgIg = igs.length > 0 ? igs.reduce((a, b) => a + b, 0) / igs.length : 0;

    const enTerapia = data.filter(r => r.estado === 'Muerto en Terapia').length;
    const totalMuertos = muertos;
    const tasaRecuperacion = total > 0
        ? ((vivos / total) * 100)
        : 0;

    const el = id => document.getElementById(id);

    if (el('kpi_total')) el('kpi_total').textContent = total;
    if (el('kpi_mortalidad')) {
        el('kpi_mortalidad').textContent = tasaMortalidad.toFixed(1) + '%';
        const card = el('kpi_mortalidad_card');
        if (card) {
            card.classList.toggle('kpi-danger', tasaMortalidad > _kpiThresholds.mortHigh);
            card.classList.toggle('kpi-warning', tasaMortalidad > _kpiThresholds.mortMid && tasaMortalidad <= _kpiThresholds.mortHigh);
        }
        const badge = el('kpi_mortalidad_badge');
        if (badge) {
            badge.textContent = tasaMortalidad > _kpiThresholds.mortHigh
                ? '⚠️ Alto Riesgo'
                : tasaMortalidad > _kpiThresholds.mortMid
                    ? '⚡ Moderado'
                    : '✅ Normal';
            badge.className = 'kpi-badge ' + (
                tasaMortalidad > _kpiThresholds.mortHigh ? 'badge-danger'
                : tasaMortalidad > _kpiThresholds.mortMid ? 'badge-warning'
                : 'badge-success'
            );
        }
    }
    if (el('kpi_ig')) el('kpi_ig').textContent = avgIg.toFixed(1);
    if (el('kpi_recuperacion')) el('kpi_recuperacion').textContent = tasaRecuperacion.toFixed(1) + '%';

    // Sub-labels
    if (el('kpi_total_sub')) el('kpi_total_sub').textContent = `${muertos} fallecidos · ${vivos} vivos`;
    if (el('kpi_ig_sub')) {
        const igLevel = avgIg >= _kpiThresholds.igHigh
            ? '✅ Óptimo'
            : avgIg >= _kpiThresholds.igMid
                ? '⚡ Aceptable'
                : '⚠️ Bajo';
        el('kpi_ig_sub').textContent = igLevel;
        // Aplicar color de estado a la card IG
        const igCard = el('kpi_ig_card');
        if (igCard) {
            igCard.classList.remove('kpi-state--success', 'kpi-state--warning', 'kpi-state--danger');
            if (avgIg >= _kpiThresholds.igHigh)      igCard.classList.add('kpi-state--success');
            else if (avgIg >= _kpiThresholds.igMid)  igCard.classList.add('kpi-state--warning');
            else                                      igCard.classList.add('kpi-state--danger');
        }
    }
    if (el('kpi_recuperacion_sub')) el('kpi_recuperacion_sub').textContent = `${enTerapia} en terapia`;
}

// ────────────────────────────────────────────────────────────────
// Helper: destruir y recrear chart
// ────────────────────────────────────────────────────────────────
function _getCtx(id) {
    if (_dashCharts[id]) {
        _dashCharts[id].destroy();
        delete _dashCharts[id];
    }
    const canvas = document.getElementById(id);
    return canvas ? canvas.getContext('2d') : null;
}

const PALETTE = {
    primary:      '#1a237e',
    primaryLight: '#3949ab',
    secondary:    '#2e7d32',   // Verde supervivencia
    danger:       '#dc2626',   // Rojo mortalidad
    warning:      '#d97706',
    info:         '#0284c7',
    purple:       '#7c3aed',
    pink:         '#db2777',
    teal:         '#0f766e',
    orange:       '#ea580c',
};

// Opacidad 80% para todos los colores de fondo
const ALPHA80 = 'cc'; // hex cc = 204 / 255 ≈ 80%

function _isDarkMode() {
    return document.documentElement.classList.contains('dark');
}

function _getChartTheme() {
    const isDark = _isDarkMode();
    return {
        isDark,
        textPrimary:     isDark ? '#ffffff' : '#1e293b',
        textSecondary:   isDark ? '#94a3b8' : '#64748b',
        textBold:        isDark ? '#f8fafc' : '#334155',
        textAxisTitle:   isDark ? '#cbd5e1' : '#64748b',
        legendText:      isDark ? '#f1f5f9' : '#475569',
        gridSubtle:      isDark ? 'rgba(255, 255, 255, 0.08)' : '#E0E0E0',
        gridFaint:       isDark ? 'rgba(255, 255, 255, 0.05)' : '#f1f5f9',
        evaluadosLine:   isDark ? '#60a5fa' : PALETTE.primary,
        evaluadosPoint:  isDark ? '#93c5fd' : PALETTE.primary,
        evaluadosText:   isDark ? '#ffffff' : PALETTE.primary,
        evaluadosTicks:  isDark ? '#ffffff' : PALETTE.primary,
        badgeBg:         isDark ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.82)',
        sexoMachoBg:     isDark ? 'rgba(96, 165, 250, 0.8)' : PALETTE.primary + 'cc',
        sexoMachoBorder: isDark ? '#60a5fa' : PALETTE.primary,
    };
}

const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 10, bottom: 10, left: 6, right: 6 } },
    plugins: {
        legend: {
            labels: {
                font: { family: 'Inter', size: 11 },
                get color() { return _isDarkMode() ? '#f1f5f9' : '#475569'; },
                padding: 14
            }
        }
    }
};

// Grid Y sutil reutilizable
const GRID_Y_SUBTLE = { color: '#E0E0E0', lineWidth: 1 };
const GRID_NONE     = { display: false };

// Helper functions for fuzzy unification y detalle de causas de muerte
function cleanCausaString(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // remove accents
        .replace(/^h+/g, '') // remove leading h (e.g. hipotermia -> ipotermia)
        .replace(/h/g, '') // remove all h's
        .replace(/v/g, 'b') // treat v and b as same
        .replace(/y/g, 'i') // treat y and i as same
        .replace(/z/g, 's') // treat z and s as same
        .replace(/c(?=[ei])/g, 's') // treat c before e or i as s
        .replace(/[^a-z0-9]/g, ''); // keep only letters and numbers
}

function levenshteinDist(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// Nombres canónicos de las categorías principales (usados en el formulario de app.js)
const CATEGORIAS_CANONICAS = [
    'Problemas Digestivos y Metabólicos',
    'Enfermedades e Infecciones',
    'Factores Externos y de Manejo',
    'Otra Causa'
];

function matchCanonicalCategory(str) {
    if (!str) return null;
    const s = str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (/digestiv|metab/i.test(s)) return 'Problemas Digestivos y Metabólicos';
    if (/infecci|enfermedad/i.test(s)) return 'Enfermedades e Infecciones';
    if (/factor|extern|manejo/i.test(s)) return 'Factores Externos y de Manejo';
    if (/^otra(?:\s+causa)?$/i.test(s)) return 'Otra Causa';
    return null;
}

// Mapa de enfermedades específicas con regex para detección en texto libre
const MAPA_CAUSAS_ESPECIFICAS = [
    { re: /\b(?:diarrea|empacho|cagadera|curso)\b/i, label: 'Diarrea', cat: 'Problemas Digestivos y Metabólicos' },
    { re: /\b(?:torsi[oó]n(?:\s+de\s+abomaso)?)\b/i, label: 'Torsión de abomaso', cat: 'Problemas Digestivos y Metabólicos' },
    { re: /\b(?:[uú]lcera(?:\s+de\s+abomaso)?)\b/i, label: 'Úlcera de abomaso', cat: 'Problemas Digestivos y Metabólicos' },
    { re: /\b(?:intoxicaci[oó]n|intoxicado)\b/i, label: 'Intoxicación', cat: 'Problemas Digestivos y Metabólicos' },
    { re: /\b(?:acidosis|timpanismo|hinchado|hinchaz[oó]n|empaste)\b/i, label: 'Acidosis / Timpanismo', cat: 'Problemas Digestivos y Metabólicos' },
    { re: /\b(?:neumon[ií]a|pulmon[ií]a)\b/i, label: 'Neumonía', cat: 'Enfermedades e Infecciones' },
    { re: /\b(?:salmonelosis|salmonela)\b/i, label: 'Salmonelosis', cat: 'Enfermedades e Infecciones' },
    { re: /\b(?:rotavirus|rota\b)\b/i, label: 'Rotavirus', cat: 'Enfermedades e Infecciones' },
    { re: /\b(?:coronavirus|corona\b)\b/i, label: 'Coronavirus', cat: 'Enfermedades e Infecciones' },
    { re: /\b(?:colibacilosis|escherichia|e\.?\s*coli)\b/i, label: 'Colibacilosis', cat: 'Enfermedades e Infecciones' },
    { re: /\b(?:onfalitis|ombligo)\b/i, label: 'Onfalitis', cat: 'Enfermedades e Infecciones' },
    { re: /\b(?:criptosporidiosis|cripto\b)\b/i, label: 'Criptosporidiosis', cat: 'Enfermedades e Infecciones' },
    { re: /\b(?:estr[eé]s\s+cal[oó]rico|golpe\s+de\s+calor)\b/i, label: 'Estrés calórico', cat: 'Factores Externos y de Manejo' },
    { re: /\b(?:falsa\s+v[ií]a|broncoaspiraci[oó]n)\b/i, label: 'Falsa vía', cat: 'Factores Externos y de Manejo' },
    { re: /\b(?:traum[aá]tica|trauma|golpe|fractura)\b/i, label: 'Traumática', cat: 'Factores Externos y de Manejo' },
    { re: /\b(?:hipotermia|fr[ií]o)\b/i, label: 'Hipotermia', cat: 'Factores Externos y de Manejo' }
];

/**
 * Obtiene la categoría principal de un registro de muerte.
 * Analiza causa_categoria, causa, causa_especifica y texto libre.
 */
function getCategoryForRecord(r) {
    if (!r) return 'Otra Causa';

    const cat = (r.causa_categoria || '').trim();
    const esp = (r.causa_especifica || '').trim();
    const causa = (r.causa || '').trim();

    // 1) Si "causa" tiene formato "Categoría - Enfermedad", tomar la parte antes del guion
    if (causa && causa.includes(' - ')) {
        const beforeDash = causa.split(' - ')[0].trim();
        const m = matchCanonicalCategory(beforeDash);
        if (m) return m;
    }

    // 2) Si causa_categoria coincide con alguna categoría conocida
    if (cat) {
        const m = matchCanonicalCategory(cat);
        if (m) return m;
    }

    // 3) Si causa_especifica contiene el nombre de una categoría (muy habitual en datos heredados)
    if (esp) {
        const m = matchCanonicalCategory(esp);
        if (m) return m;
    }

    // 4) Si causa completa coincide con alguna categoría
    if (causa) {
        const m = matchCanonicalCategory(causa);
        if (m) return m;
    }

    // 5) Búsqueda por palabras clave de enfermedades o temas conocidos
    const full = `${cat} ${esp} ${causa} ${r.diagnostico || ''}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    if (/digestiv|metab|diarrea|empacho|cagadera|curso|torsion|abomaso|ulcera|intoxicaci|acidosis|timpanismo|hinchad|empaste/i.test(full)) {
        return 'Problemas Digestivos y Metabólicos';
    }

    if (/infecci|enfermedad|neumon|pulmon|salmonel|rotavirus|rota\b|coronavirus|corona\b|colibacilosis|escherichia|e\.?\s*coli|onfalitis|ombligo|cripto|bacteri|viral|virus|septicemia|mancha|clostridi/i.test(full)) {
        return 'Enfermedades e Infecciones';
    }

    if (/factor|extern|manejo|estres|calor|falsa\s*via|broncoaspiraci|trauma|golpe|fractura|hipotermia|frio|ahogad|aplastad|accidente/i.test(full)) {
        return 'Factores Externos y de Manejo';
    }

    // 6) Si causa_categoria tiene algún texto personalizado que no sea "Sin categoría"
    if (cat && !/sin\s+cat/i.test(cat)) {
        return cat;
    }

    return 'Otra Causa';
}

/**
 * Extrae la enfermedad o causa específica real de un registro.
 * NUNCA devuelve el nombre de una categoría macro repetida.
 * Devuelve null si el registro solo tenía la categoría general sin subdiagnóstico.
 */
function getSpecificDisease(r) {
    if (!r) return null;

    const rawCausa = (r.causa || '').trim();
    const rawEsp = (r.causa_especifica || '').trim();

    // 1) Si tiene formato "Categoría - Enfermedad", tomar la parte después del guion
    if (rawCausa && rawCausa.includes(' - ')) {
        const parts = rawCausa.split(' - ');
        if (parts.length >= 2) {
            const afterDash = parts.slice(1).join(' - ').trim();
            // Verificar que no sea el nombre de una categoría
            if (afterDash && !matchCanonicalCategory(afterDash)) {
                return cleanAndCapitalizeDisease(afterDash);
            }
        }
    }

    // 2) Si causa_especifica tiene valor y NO es el nombre de una categoría
    if (rawEsp && !matchCanonicalCategory(rawEsp)) {
        return cleanAndCapitalizeDisease(rawEsp);
    }

    // 3) Buscar en todos los campos si coincide con alguna enfermedad específica conocida
    const fullText = `${rawCausa} ${rawEsp} ${r.diagnostico || ''} ${r.observaciones || ''}`;
    for (const item of MAPA_CAUSAS_ESPECIFICAS) {
        if (item.re.test(fullText)) {
            return item.label;
        }
    }

    // 4) Si causa completa no tiene guion y NO es nombre de categoría
    if (rawCausa && !matchCanonicalCategory(rawCausa)) {
        return cleanAndCapitalizeDisease(rawCausa);
    }

    // Solo se registró la categoría general
    return null;
}

function cleanAndCapitalizeDisease(str) {
    if (!str) return '';
    const cleaned = str
        .replace(/Ã¡/g, 'á').replace(/Ã©/g, 'é').replace(/Ã­/g, 'í').replace(/Ã³/g, 'ó').replace(/Ãº/g, 'ú')
        .replace(/ã¡/g, 'á').replace(/ã©/g, 'é').replace(/ã­/g, 'í').replace(/ã³/g, 'ó').replace(/ãº/g, 'ú')
        .trim();
    return cleaned.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// ────────────────────────────────────────────────────────────────
// 1. Causas de Muerte — BarChart Horizontal
//    BARRAS = Categorías principales (Problemas Digestivos, Infecciones, etc.)
//    TOOLTIP/MODAL = Enfermedades específicas dentro de esa categoría
// ────────────────────────────────────────────────────────────────
function _renderCausasMuerte(data) {
    const ctx = _getCtx('chart_causas');
    if (!ctx) return;

    const muertos = data.filter(r => r.estado !== 'Vivo' && (r.causa_especifica || r.causa_categoria || r.causa));

    // Agrupar por CATEGORÍA PRINCIPAL
    const categoryGroups = {};
    muertos.forEach(r => {
        const cat = getCategoryForRecord(r);
        if (!categoryGroups[cat]) {
            categoryGroups[cat] = { count: 0, records: [] };
        }
        categoryGroups[cat].count++;
        categoryGroups[cat].records.push(r);
    });

    // Ordenar de mayor a menor y tomar las que tengan casos (> 0)
    const sorted = Object.entries(categoryGroups)
        .filter(([_, d]) => d.count > 0)
        .map(([name, d]) => ({ canonicalName: name, count: d.count, records: d.records }))
        .sort((a, b) => b.count - a.count);

    const labels = sorted.map(g => g.canonicalName);
    const values = sorted.map(g => g.count);

    // Colores por categoría
    const catColorMap = {
        'Problemas Digestivos y Metabólicos': '#d97706',
        'Enfermedades e Infecciones': '#dc2626',
        'Factores Externos y de Manejo': '#0284c7',
        'Otra Causa': '#64748b'
    };
    const colors = labels.map(l => catColorMap[l] || PALETTE.primary);

    // Guardar datos para drill-down modal
    _causasGroupData = sorted;
    _causasAllData = data;

    _dashCharts.chart_causas = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Muertes',
                data: values,
                backgroundColor: colors.map(c => c + ALPHA80),
                borderColor: colors,
                borderWidth: 1.5,
                borderRadius: 6,
                datalabels: {
                    anchor: 'end',
                    align: 'left',
                    color: '#ffffff',
                    font: { family: 'Inter', size: 11, weight: '700' },
                    formatter: v => v,
                    padding: { right: 6 },
                }
            }]
        },
        options: {
            ...CHART_DEFAULTS,
            indexAxis: 'y',
            interaction: {
                mode: 'index',
                axis: 'y',
                intersect: false
            },

            plugins: {
                ...CHART_DEFAULTS.plugins,
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const totalMuertos = data.filter(r => r.estado !== 'Vivo').length;
                            const pct = totalMuertos > 0 ? ((ctx.raw / totalMuertos) * 100).toFixed(1) : 0;
                            return ` ${ctx.raw} casos · ${pct}% de muertes`;
                        },
                        afterBody: ctxItems => {
                            const item = ctxItems[0];
                            const group = _causasGroupData?.[item.dataIndex];
                            if (!group || !group.records) return [];

                            // Contar enfermedades específicas dentro de esta categoría
                            const diseaseCounts = {};
                            let generalCount = 0;
                            group.records.forEach(r => {
                                const disease = getSpecificDisease(r);
                                if (disease) {
                                    diseaseCounts[disease] = (diseaseCounts[disease] || 0) + 1;
                                } else {
                                    generalCount++;
                                }
                            });

                            const entries = Object.entries(diseaseCounts).sort((a, b) => b[1] - a[1]);
                            const lines = [''];
                            if (entries.length > 0) {
                                lines.push('Enfermedades específicas:');
                                entries.slice(0, 5).forEach(([name, count]) => {
                                    lines.push(`  • ${name}: ${count}`);
                                });
                                if (entries.length > 5) {
                                    lines.push(`  ... y ${entries.length - 5} más`);
                                }
                            }
                            if (generalCount > 0) {
                                lines.push(`  • Diagnóstico general: ${generalCount}`);
                            }
                            return lines;
                        }
                    }
                }
            },
            scales: {
                x: { grid: { color: _getChartTheme().gridSubtle, lineWidth: 1 }, ticks: { color: _getChartTheme().textSecondary, font: { family: 'Inter' } } },
                y: { grid: GRID_NONE,     ticks: { color: _getChartTheme().textBold, font: { family: 'Inter', weight: '600' } } }
            },
        }
    });

    // Cursor default: las barras ya no son clicables
    ctx.canvas.style.cursor = 'default';
}

// ────────────────────────────────────────────────────────────────
// Drill-down modal: detalle de una categoría de causa de muerte
// Muestra las ENFERMEDADES ESPECÍFICAS dentro de esa categoría
// ────────────────────────────────────────────────────────────────
function _showCausaDetailModal(groupIndex) {
    const group = _causasGroupData?.[groupIndex];
    if (!group || !_causasAllData) return;

    const muertos = _causasAllData.filter(r => r.estado !== 'Vivo');
    const totalMuertos = muertos.length;
    const pct = totalMuertos > 0 ? ((group.count / totalMuertos) * 100).toFixed(1) : 0;

    // Título y subtítulo
    document.getElementById('causaDetailTitle').textContent = `☠️ ${group.canonicalName}`;
    document.getElementById('causaDetailSubtitle').textContent =
        `${group.count} caso${group.count !== 1 ? 's' : ''} · ${pct}% del total de muertes`;

    const matchingRecords = group.records || [];

    // Contar enfermedades específicas
    const diseaseCounts = {};
    let generalCount = 0;

    matchingRecords.forEach(r => {
        const disease = getSpecificDisease(r);
        if (disease) {
            diseaseCounts[disease] = (diseaseCounts[disease] || 0) + 1;
        } else {
            generalCount++;
        }
    });

    let html = '';

    // Si hay más de una categoría de muerte, permitir alternar entre ellas con botones/pestañas
    if (_causasGroupData && _causasGroupData.length > 1) {
        html += `<div class="causa-category-pills" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:6px; margin-bottom:1rem; -webkit-overflow-scrolling:touch;">`;
        _causasGroupData.forEach((g, idx) => {
            const isActive = idx === groupIndex;
            html += `<button type="button" class="causa-pill-btn ${isActive ? 'active' : ''}" onclick="_showCausaDetailModal(${idx})"
                style="padding:6px 12px; border-radius:10px; font-size:0.78rem; font-weight:700; white-space:nowrap; cursor:pointer; transition:all 0.15s; border:1.5px solid ${isActive ? 'var(--primary)' : 'var(--border-color)'}; background:${isActive ? 'var(--primary)' : 'var(--input-bg)'}; color:${isActive ? '#ffffff' : 'var(--text-secondary)'};">
                ${g.canonicalName} (${g.count})
            </button>`;
        });
        html += `</div>`;
    }

    // ── Resumen estadístico ──
    html += `<div class="causa-detail-summary">
        <div class="causa-detail-stat">
            <span class="causa-detail-stat-value">${group.count}</span>
            <span class="causa-detail-stat-label">Casos</span>
        </div>
        <div class="causa-detail-stat">
            <span class="causa-detail-stat-value">${pct}%</span>
            <span class="causa-detail-stat-label">Del Total</span>
        </div>`;

    const uniqueDiseases = Object.keys(diseaseCounts).length;
    if (uniqueDiseases > 0) {
        html += `<div class="causa-detail-stat">
            <span class="causa-detail-stat-value">${uniqueDiseases}</span>
            <span class="causa-detail-stat-label">Enfermedades</span>
        </div>`;
    }
    html += `</div>`;

    // ── Desglose de Enfermedades Específicas ──
    const diseaseEntries = Object.entries(diseaseCounts).sort((a, b) => b[1] - a[1]);
    if (diseaseEntries.length > 0 || generalCount > 0) {
        html += `<div style="width:100%; margin-bottom:1rem; padding:12px 16px; background:var(--input-bg); border-radius:12px; border:1px solid var(--border-color);">
            <div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:8px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">
                🔬 Diagnóstico específico / Enfermedad:
            </div>`;

        diseaseEntries.forEach(([name, count]) => {
            const subPct = group.count > 0 ? ((count / group.count) * 100).toFixed(0) : 0;
            html += `<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.84rem; padding:4px 0; border-bottom:1px dashed var(--border-color);">
                <span style="color:var(--text-main); font-weight:600;">• ${name}</span>
                <span class="causa-disease-count">${count} caso${count !== 1 ? 's' : ''} <span style="font-weight:400; color:var(--text-secondary); font-size:0.75rem;">(${subPct}%)</span></span>
            </div>`;
        });

        if (generalCount > 0) {
            const genPct = group.count > 0 ? ((generalCount / group.count) * 100).toFixed(0) : 0;
            html += `<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.84rem; padding:4px 0; color:var(--text-secondary);">
                <span>• Diagnóstico general (sin subcausa)</span>
                <span style="font-weight:600;">${generalCount} caso${generalCount !== 1 ? 's' : ''} <span style="font-size:0.75rem;">(${genPct}%)</span></span>
            </div>`;
        }

        html += `</div>`;
    }

    // ── Lista de terneros afectados ──
    html += `<div style="font-size:0.82rem; font-weight:700; color:var(--text-main); margin-bottom:6px;">
        🐄 Terneros afectados (${matchingRecords.length}):
    </div>`;

    if (matchingRecords.length > 0) {
        matchingRecords
            .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
            .forEach(r => {
                const estadoIcon = r.estado === 'Muerto en Guachería' ? '🏠'
                    : r.estado === 'Muerto en Establecimiento' ? '🏢'
                    : r.estado === 'Muerto en Terapia' ? '💉' : '☠️';

                const rDisease = getSpecificDisease(r);
                const diseaseBadge = rDisease
                    ? `<span class="causa-disease-badge">🦠 ${rDisease}</span>`
                    : `<span style="color:var(--text-secondary); font-size:0.8rem;">📋 General</span>`;

                html += `<div class="causa-detail-item">
                    <div class="causa-detail-rp">${r.rp_ternero || 'S/N'}</div>
                    <div class="causa-detail-info">
                        📅 ${r.fecha || '—'} · 📍 ${r.establecimiento || '—'}<br>
                        ${estadoIcon} ${r.estado || '—'} · ${diseaseBadge}
                    </div>
                </div>`;
            });
    } else {
        html += `<div style="text-align:center; color:var(--text-secondary); padding:1.5rem; font-size:0.85rem;">
            No se encontraron registros detallados para esta causa.
        </div>`;
    }

    document.getElementById('causaDetailBody').innerHTML = html;
    document.getElementById('causaDetailModal').classList.add('active');
    if (window.lucide) window.lucide.createIcons();
}

function closeCausaDetailModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('causaDetailModal').classList.remove('active');
}
window.closeCausaDetailModal = closeCausaDetailModal;
window._showCausaDetailModal = _showCausaDetailModal;

let _lastCausaDetailOpen = 0;
function openCausaDetailModalFromHeader(e) {
    if (e) {
        if (e.stopPropagation) e.stopPropagation();
        if (e.type === 'touchend' && e.cancelable) {
            e.preventDefault();
        }
    }
    const now = Date.now();
    if (now - _lastCausaDetailOpen < 350) return;
    _lastCausaDetailOpen = now;

    if (_causasGroupData && _causasGroupData.length > 0) {
        _showCausaDetailModal(0);
    } else if (typeof showToast === 'function') {
        showToast('ℹ️ No hay registros de muertes con diagnóstico disponibles.');
    }
}
window.openCausaDetailModalFromHeader = openCausaDetailModalFromHeader;

// ────────────────────────────────────────────────────────────────
// 2. Mortalidad por Ubicación — PieChart
// ────────────────────────────────────────────────────────────────
function _renderUbicacionMortalidad(data) {
    const ctx = _getCtx('chart_ubicacion');
    if (!ctx) return;

    const muertos = data.filter(r => r.estado !== 'Vivo');
    const establecimiento = muertos.filter(r => r.estado === 'Muerto en Establecimiento').length;
    const guacheria = muertos.filter(r => r.estado === 'Muerto en Guachería').length;
    const terapia = muertos.filter(r => r.estado === 'Muerto en Terapia').length;

    _dashCharts.chart_ubicacion = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Establecimiento', 'Guachería', 'Terapia'],
            datasets: [{
                data: [establecimiento, guacheria, terapia],
                backgroundColor: [PALETTE.danger + ALPHA80, PALETTE.orange + ALPHA80, PALETTE.warning + ALPHA80],
                borderColor: [PALETTE.danger, PALETTE.orange, PALETTE.warning],
                borderWidth: 2,
                hoverOffset: 8,
            }]
        },
        options: {
            ...CHART_DEFAULTS,
            cutout: '68%',
            plugins: {
                ...CHART_DEFAULTS.plugins,
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { family: 'Inter', size: 11 },
                        color: '#475569',
                        padding: 16,
                        usePointStyle: true,
                    }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${ctx.raw} (${muertos.length > 0 ? ((ctx.raw/muertos.length)*100).toFixed(1) : 0}%)`
                    }
                }
            }
        }
    });
}

// ────────────────────────────────────────────────────────────────
// 3. Correlación Calostro — ScatterChart
// ────────────────────────────────────────────────────────────────
function _renderCorrelacionCalostro(data) {
    const ctx = _getCtx('chart_calostro');
    if (!ctx) return;

    // Limpiar overlay previo si existe
    const canvasEl = ctx.canvas || ctx;
    const wrapper = canvasEl.parentElement;
    const oldOverlay = wrapper?.querySelector('.dash-no-data-overlay');
    if (oldOverlay) oldOverlay.remove();

    const sample = data.filter(r => r.ig_calostro && r.ig_ternero).slice(0, 120);

    // Si no hay registros con I.G., mostrar mensaje amigable
    if (sample.length === 0) {
        if (wrapper) {
            wrapper.style.position = 'relative';
            const overlay = document.createElement('div');
            overlay.className = 'dash-no-data-overlay';
            overlay.innerHTML = `
                <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                            background:rgba(255,255,255,0.85);border-radius:12px;z-index:5;flex-direction:column;gap:8px;">
                    <span style="font-size:2.2rem;">📊</span>
                    <span style="color:#64748b;font-size:0.95rem;font-weight:500;text-align:center;max-width:280px;">
                        Sin datos de I.G. Calostro / Ternero.<br>
                        <span style="font-size:0.82rem;color:#94a3b8;">Cargá registros con valores de inmunoglobulinas para ver la correlación.</span>
                    </span>
                </div>`;
            wrapper.appendChild(overlay);
        }
        // Crear chart vacío para que no se vea roto
    }

    const vivos = sample.filter(r => r.estado === 'Vivo').map(r => ({ x: parseFloat(r.ig_calostro), y: parseFloat(r.ig_ternero) }));
    const muertos = sample.filter(r => r.estado !== 'Vivo').map(r => ({ x: parseFloat(r.ig_calostro), y: parseFloat(r.ig_ternero) }));

    _dashCharts.chart_calostro = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Sobrevivió',
                    data: vivos,
                    backgroundColor: PALETTE.secondary + '99',
                    borderColor: PALETTE.secondary,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                },
                {
                    label: 'Falleció',
                    data: muertos,
                    backgroundColor: PALETTE.danger + '99',
                    borderColor: PALETTE.danger,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                }
            ]
        },
        options: {
            ...CHART_DEFAULTS,
            plugins: {
                ...CHART_DEFAULTS.plugins,
                tooltip: {
                    callbacks: {
                        label: ctx => ` Calostro: ${ctx.raw.x} mg/dL | I.G. Ternero: ${ctx.raw.y}%`
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: 'I.G. Calostro Madre (mg/dL)', color: _getChartTheme().textAxisTitle, font: { family: 'Inter' } }, grid: { color: _getChartTheme().gridFaint }, ticks: { color: _getChartTheme().textSecondary } },
                y: { title: { display: true, text: 'I.G. Ternero (%)', color: _getChartTheme().textAxisTitle, font: { family: 'Inter' } }, grid: { color: _getChartTheme().gridFaint }, ticks: { color: _getChartTheme().textSecondary } }
            }
        }
    });
}

// ────────────────────────────────────────────────────────────────
// 4. Desempeño por Tipo de Madre — Stacked BarChart
// ────────────────────────────────────────────────────────────────
function _renderDesempenoMadre(data) {
    const ctx = _getCtx('chart_madre');
    if (!ctx) return;

    const vacas = data.filter(r => r.tipo_madre === 'Vaca');
    const vaquil = data.filter(r => r.tipo_madre === 'Vaquillona');

    const vivosV = vacas.filter(r => r.estado === 'Vivo').length;
    const muertosV = vacas.filter(r => r.estado !== 'Vivo').length;
    const vivosQ = vaquil.filter(r => r.estado === 'Vivo').length;
    const muertosQ = vaquil.filter(r => r.estado !== 'Vivo').length;

    _dashCharts.chart_madre = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Vaca', 'Vaquillona'],
            datasets: [
                {
                    label: 'Vivos',
                    data: [vivosV, vivosQ],
                    backgroundColor: PALETTE.secondary + 'cc',
                    borderColor: PALETTE.secondary,
                    borderWidth: 1.5,
                    borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 6, bottomRight: 6 }
                },
                {
                    label: 'Fallecidos',
                    data: [muertosV, muertosQ],
                    backgroundColor: PALETTE.danger + 'cc',
                    borderColor: PALETTE.danger,
                    borderWidth: 1.5,
                    borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 }
                }
            ]
        },
        options: {
            ...CHART_DEFAULTS,
            plugins: {
                ...CHART_DEFAULTS.plugins,
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.label === 'Vivos'
                                ? (ctx.dataIndex === 0 ? vacas.length : vaquil.length)
                                : (ctx.dataIndex === 0 ? vacas.length : vaquil.length);
                            return ` ${ctx.dataset.label}: ${ctx.raw} (${total > 0 ? ((ctx.raw/total)*100).toFixed(1) : 0}%)`;
                        }
                    }
                }
            },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { color: _getChartTheme().textBold, font: { family: 'Inter', weight: '600' } } },
                y: { stacked: true, grid: { color: _getChartTheme().gridFaint }, ticks: { color: _getChartTheme().textSecondary } }
            }
        }
    });
}

// ────────────────────────────────────────────────────────────────
// 5. Salud de Ombligos — Donut Chart
// ────────────────────────────────────────────────────────────────
function _renderSaludOmbligos(data) {
    const ctx = _getCtx('chart_ombligos');
    if (!ctx) return;

    const bueno  = data.filter(r => r.ombligo === 'Bueno').length;
    const regular = data.filter(r => r.ombligo === 'Regular').length;
    const malo   = data.filter(r => r.ombligo === 'Malo').length;

    _dashCharts.chart_ombligos = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Bueno', 'Regular', 'Malo'],
            datasets: [{
                data: [bueno, regular, malo],
                backgroundColor: [PALETTE.secondary + 'cc', PALETTE.warning + 'cc', PALETTE.danger + 'cc'],
                borderColor: [PALETTE.secondary, PALETTE.warning, PALETTE.danger],
                borderWidth: 2,
                hoverOffset: 6,
            }]
        },
        options: {
            ...CHART_DEFAULTS,
            cutout: '65%',
            plugins: {
                ...CHART_DEFAULTS.plugins,
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${ctx.raw} (${data.length > 0 ? ((ctx.raw/data.length)*100).toFixed(1) : 0}%)`
                    }
                }
            }
        }
    });
}

// ────────────────────────────────────────────────────────────────
// 6. Tendencia Temporal — AreaChart (Line)
// ────────────────────────────────────────────────────────────────
function _renderTendenciaTemporal(data) {
    const ctx = _getCtx('chart_tendencia');
    if (!ctx) return;

    // Agrupar por semana
    const byWeek = {};
    data.forEach(r => {
        if (!r.fecha) return;
        const d = new Date(r.fecha);
        // Round to Monday of that week
        const day = d.getDay();
        const diff = (day === 0) ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        const key = d.toISOString().split('T')[0];
        if (!byWeek[key]) byWeek[key] = { total: 0, muertos: 0 };
        byWeek[key].total++;
        if (r.estado !== 'Vivo') byWeek[key].muertos++;
    });

    const sorted = Object.entries(byWeek).sort((a, b) => a[0].localeCompare(b[0])).slice(-26); // últimas 26 semanas
    const labels = sorted.map(([k]) => {
        const d = new Date(k + 'T00:00:00');
        return d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
    });
    const tasas = sorted.map(([, v]) => v.total > 0 ? parseFloat((v.muertos / v.total * 100).toFixed(1)) : 0);
    const totales = sorted.map(([, v]) => v.total);

    _dashCharts.chart_tendencia = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Tasa Mortalidad (%)',
                    data: tasas,
                    borderColor: PALETTE.danger,
                    backgroundColor: 'rgba(220,38,38,0.08)',
                    tension: 0.4,
                    fill: true,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    pointBackgroundColor: PALETTE.danger,
                    yAxisID: 'y',
                },
                {
                    label: 'Total Evaluados',
                    data: totales,
                    borderColor: _getChartTheme().evaluadosLine,
                    backgroundColor: 'rgba(26,35,126,0.05)',
                    tension: 0.4,
                    fill: false,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: _getChartTheme().evaluadosPoint,
                    borderDash: [4, 4],
                    yAxisID: 'y1',
                }
            ]
        },
        options: {
            ...CHART_DEFAULTS,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                ...CHART_DEFAULTS.plugins,
                legend: {
                    labels: {
                        font: { family: 'Inter', size: 11 },
                        color: _getChartTheme().legendText,
                        padding: 14
                    }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}${ctx.datasetIndex === 0 ? '%' : ''}`
                    }
                }
            },
            scales: {
                // Rotación 45° para evitar solapamiento de fechas
                x: {
                    grid: { color: _getChartTheme().gridFaint },
                    ticks: {
                        color: _getChartTheme().textSecondary,
                        maxRotation: 45,
                        minRotation: 45,
                        font: { size: 10, family: 'Inter' },
                        autoSkip: true,
                        maxTicksLimit: 14
                    }
                },
                y:  {
                    type: 'linear', position: 'left',
                    grid: { color: _getChartTheme().gridSubtle, lineWidth: 1 },
                    ticks: { color: PALETTE.danger, callback: v => v + '%', font: { family: 'Inter' } }
                },
                y1: {
                    type: 'linear', position: 'right',
                    grid: GRID_NONE,
                    ticks: {
                        color: _getChartTheme().evaluadosTicks,
                        font: { family: 'Inter', weight: '700' }
                    }
                }
            }
        }
    });
}

// ────────────────────────────────────────────────────────────────
// 7. Ranking de Establecimientos — Tabla
// ────────────────────────────────────────────────────────────────
function _renderRankingEstablecimientos(data) {
    const tbody = document.getElementById('ranking_tbody');
    if (!tbody) return;

    const byEst = {};
    data.forEach(r => {
        if (!r.establecimiento) return;
        if (!byEst[r.establecimiento]) byEst[r.establecimiento] = { total: 0, muertos: 0 };
        byEst[r.establecimiento].total++;
        if (r.estado !== 'Vivo') byEst[r.establecimiento].muertos++;
    });

    const sorted = Object.entries(byEst)
        .map(([est, v]) => ({ est, ...v, tasa: v.total > 0 ? (v.muertos / v.total * 100) : 0 }))
        .sort((a, b) => b.tasa - a.tasa)
        .slice(0, 7);

    tbody.innerHTML = sorted.map((row, i) => {
        const pct = row.tasa.toFixed(1);
        const color = row.tasa > 10 ? '#dc2626' : row.tasa > 5 ? '#d97706' : '#16a34a';
        const badge = row.tasa > 10 ? 'badge-danger' : row.tasa > 5 ? 'badge-warning' : 'badge-success';
        const barW = Math.min(row.tasa * 5, 100).toFixed(0);
        return `<tr class="ranking-row">
            <td class="ranking-pos">${i + 1}</td>
            <td class="ranking-name">${row.est}</td>
            <td class="ranking-total">${row.total}</td>
            <td class="ranking-bar-cell">
                <div class="ranking-bar-bg">
                    <div class="ranking-bar-fill" style="width:${barW}%; background:${color}"></div>
                </div>
            </td>
            <td><span class="kpi-badge ${badge}">${pct}%</span></td>
        </tr>`;
    }).join('');
}

// ────────────────────────────────────────────────────────────────
// 8. Mortalidad por Sexo — Radial Bar (Doughnut styled)
// ────────────────────────────────────────────────────────────────
function _renderMortalidadSexo(data) {
    const ctx = _getCtx('chart_sexo');
    if (!ctx) return;

    const machos = data.filter(r => r.sexo === 'Macho');
    const hembras = data.filter(r => r.sexo === 'Hembra');

    const tasaM = machos.length > 0 ? (machos.filter(r => r.estado !== 'Vivo').length / machos.length * 100) : 0;
    const tasaH = hembras.length > 0 ? (hembras.filter(r => r.estado !== 'Vivo').length / hembras.length * 100) : 0;
    const supervM = 100 - tasaM;
    const supervH = 100 - tasaH;

    const theme = _getChartTheme();

    _dashCharts.chart_sexo = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Machos', 'Hembras'],
            datasets: [
                {
                    label: 'Supervivencia (%)',
                    data: [supervM.toFixed(1), supervH.toFixed(1)],
                    backgroundColor: [theme.sexoMachoBg, PALETTE.pink + 'cc'],
                    borderColor: [theme.sexoMachoBorder, PALETTE.pink],
                    borderWidth: 2,
                    borderRadius: 8,
                },
                {
                    label: 'Mortalidad (%)',
                    data: [tasaM.toFixed(1), tasaH.toFixed(1)],
                    backgroundColor: [PALETTE.danger + '55', PALETTE.danger + '55'],
                    borderColor: [PALETTE.danger + 'aa', PALETTE.danger + 'aa'],
                    borderWidth: 1,
                    borderRadius: 8,
                }
            ]
        },
        options: {
            ...CHART_DEFAULTS,
            plugins: {
                ...CHART_DEFAULTS.plugins,
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}%`
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: theme.textBold, font: { family: 'Inter', weight: '600', size: 12 } } },
                y: { max: 100, grid: { color: theme.gridFaint }, ticks: { color: theme.textSecondary, callback: v => v + '%' } }
            }
        }
    });

    // Update text stats
    const el = id => document.getElementById(id);
    if (el('sexo_machos_total')) el('sexo_machos_total').textContent = machos.length;
    if (el('sexo_hembras_total')) el('sexo_hembras_total').textContent = hembras.length;
    if (el('sexo_machos_tasa')) el('sexo_machos_tasa').textContent = tasaM.toFixed(1) + '% mort.';
    if (el('sexo_hembras_tasa')) el('sexo_hembras_tasa').textContent = tasaH.toFixed(1) + '% mort.';
}


// ═══════════════════════════════════════════════════════════════
// SORTABLE CHART BLOCKS — drag & drop reorder + editable titles
// ═══════════════════════════════════════════════════════════════

(function initChartSortable() {
    var LS_ORDER  = 'vf_chart_block_order';
    var LS_TITLES = 'vf_chart_titles';

    function restoreOrder() {
        var saved = JSON.parse(localStorage.getItem(LS_ORDER) || 'null');
        if (!saved || !Array.isArray(saved)) return;
        var container = document.getElementById('charts-sortable');
        if (!container) return;
        saved.forEach(function(id) {
            var el = container.querySelector('[data-chart-id="' + id + '"]');
            if (el) container.appendChild(el);
        });
    }

    function restoreTitles() {
        var saved = JSON.parse(localStorage.getItem(LS_TITLES) || '{}');
        Object.keys(saved).forEach(function(key) {
            var el = document.querySelector('[data-title-key="' + key + '"]');
            if (el && saved[key]) el.textContent = saved[key];
        });
    }

    function saveOrder() {
        var container = document.getElementById('charts-sortable');
        if (!container) return;
        var ids = Array.from(container.querySelectorAll('.chart-block')).map(function(b) {
            return b.dataset.chartId;
        });
        localStorage.setItem(LS_ORDER, JSON.stringify(ids));
    }

    function saveTitle(key, value) {
        var saved = JSON.parse(localStorage.getItem(LS_TITLES) || '{}');
        saved[key] = value;
        localStorage.setItem(LS_TITLES, JSON.stringify(saved));
    }

    function initEditOnTitle(titleEl) {
        titleEl.addEventListener('mousedown', function(e) { e.stopPropagation(); });
        titleEl.addEventListener('touchstart', function(e) { e.stopPropagation(); });

        titleEl.addEventListener('blur', function() {
            titleEl.setAttribute('contenteditable', 'false');
            var val = titleEl.textContent.trim();
            if (val) saveTitle(titleEl.dataset.titleKey, val);
        });

        titleEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
            if (e.key === 'Escape') {
                var saved = JSON.parse(localStorage.getItem(LS_TITLES) || '{}');
                if (saved[titleEl.dataset.titleKey]) {
                    titleEl.textContent = saved[titleEl.dataset.titleKey];
                }
                titleEl.blur();
            }
        });
    }

    window.dashEditTitle = function(btn) {
        var header  = btn.closest('.db-chart-header');
        var titleEl = header && header.querySelector('.db-chart-title');
        if (!titleEl) return;
        titleEl.setAttribute('contenteditable', 'true');
        titleEl.focus();
        var range = document.createRange();
        range.selectNodeContents(titleEl);
        range.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    };

    function init() {
        restoreOrder();
        restoreTitles();
        
        var container = document.getElementById('charts-sortable');
        if (container && window.Sortable) {
            new Sortable(container, {
                animation: 200,
                delay: 200, // Tiempo presionando para iniciar arrastre en móviles
                delayOnTouchOnly: true, // Sólo requerir delay en pantallas táctiles
                filter: '.btn-causa-detail-header, .chart-edit-title-btn, button, input, select, textarea, [contenteditable]',
                preventOnFilter: false,
                ghostClass: 'is-dragging',
                onEnd: function() {
                    saveOrder();
                }
            });
        }
        
        document.querySelectorAll('[data-title-key]').forEach(initEditOnTitle);
    }

    function tryInit() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                setTimeout(init, 300);
            });
        } else {
            setTimeout(init, 300);
        }
    }
    
    tryInit();
})();

// ═══════════════════════════════════════════════════════════════
// EXPORTAR A PDF
// ═══════════════════════════════════════════════════════════════

window.exportDashboardPDF = function(btnEl) {
    // La descarga de gráficos como PDF es exclusiva del Plan Premium (o cuentas legacy).
    const _sess = typeof AuthManager !== 'undefined' ? AuthManager.getSession() : null;
    const _plan = _sess ? _sess.plan : undefined;
    if (_plan === 'inicio' || _plan === 'pro') {
        if (typeof showAlert === 'function') {
            showAlert(
                'Función exclusiva Premium',
                'La descarga de gráficos como PDF está disponible únicamente en el Plan Premium. Mejorá tu plan para desbloquear esta función.',
                'info'
            );
        }
        return;
    }

    if (btnEl) {
        btnEl.innerHTML = '<i data-lucide="loader" class="spin" style="width: 18px; height: 18px; animation: spin 2s linear infinite;"></i> Generando...';
        btnEl.disabled = true;
    }
    
    // Pequeño timeout para permitir que la UI actualice el botón
    setTimeout(() => {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            
            // Título
            doc.setFontSize(18);
            doc.text("Reporte Analítico - VETFIELD PRO", 14, 20);
            
            // Fecha y Filtros
            doc.setFontSize(10);
            doc.setTextColor(100);
            doc.text(`Fecha de generación: ${new Date().toLocaleDateString()}`, 14, 28);
            
            let filtrosStr = [];
            if (_dashFilters.desde) filtrosStr.push(`Desde: ${_dashFilters.desde}`);
            if (_dashFilters.hasta) filtrosStr.push(`Hasta: ${_dashFilters.hasta}`);
            if (_dashFilters.productor) filtrosStr.push(`Productor: ${_dashFilters.productor}`);
            if (_dashFilters.establecimiento) filtrosStr.push(`Establecimiento: ${_dashFilters.establecimiento}`);
            
            if (filtrosStr.length > 0) {
                doc.setFontSize(9);
                doc.text(`Filtros: ${filtrosStr.join(' | ')}`, 14, 34);
            }
            
            let yPos = 42;
            const pageWidth = doc.internal.pageSize.getWidth();
            
            // Recorrer los bloques en el orden actual
            const blocks = document.querySelectorAll('.chart-block');
            
            blocks.forEach(block => {
                const charts = block.querySelectorAll('.db-chart-card');
                charts.forEach(card => {
                    const titleEl = card.querySelector('.db-chart-title');
                    const title = titleEl ? titleEl.textContent.trim() : 'Gráfico';
                    
                    const canvas = card.querySelector('canvas');
                    
                    if (canvas) {
                        if (yPos > 240) {
                            doc.addPage();
                            yPos = 20;
                        }
                        
                        doc.setFontSize(12);
                        doc.setTextColor(0);
                        doc.text(title, 14, yPos);
                        yPos += 6;
                        
                        // Crear canvas temporal para no afectar el canvas visible en la UI
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = canvas.width;
                        tempCanvas.height = canvas.height;
                        const tCtx = tempCanvas.getContext('2d');

                        // 1. Fondo blanco (en píxeles físicos, ANTES de aplicar escala)
                        tCtx.fillStyle = '#ffffff';
                        tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

                        // 2. Dibujar el gráfico original (pixel-perfect)
                        tCtx.drawImage(canvas, 0, 0);

                        // ─── FIX CRÍTICO: Corregir el espacio de coordenadas ──────────────
                        // Chart.js internamente usa ctx.scale(dpr, dpr) en el canvas real,
                        // por lo que element.x / tooltipPosition() devuelven valores en
                        // espacio CSS-pixel (p.ej. 0-400 en pantalla 2x).
                        // El tempCanvas trabaja en píxeles físicos (p.ej. 0-800).
                        // Sin escalar, los números aparecen a la mitad de la posición correcta.
                        const _dpr = window.devicePixelRatio || 1;
                        tCtx.scale(_dpr, _dpr);

                        // 3. Dibujar etiquetas de datos visibles para el PDF
                        const chartInstance = window.Chart ? window.Chart.getChart(canvas) : null;
                        if (chartInstance) {
                            const chartId = canvas.id;

                            chartInstance.data.datasets.forEach((dataset, i) => {
                                const meta = chartInstance.getDatasetMeta(i);
                                if (meta.hidden) return;

                                meta.data.forEach((element, index) => {
                                    const dataVal = dataset.data[index];
                                    if (dataVal === null || dataVal === undefined || dataVal === 0 || dataVal === '0.0') return;

                                    // ── Scatter: sin etiquetas numéricas ──────────────────
                                    if (chartId === 'chart_calostro') return;

                                    let text          = String(dataVal);
                                    let pos           = element.tooltipPosition ? element.tooltipPosition() : { x: element.x, y: element.y };
                                    let align         = 'center';
                                    let drawBg        = false;
                                    let customYOffset = 0;
                                    let customXOffset = 0;
                                    let textColor     = '#ffffff';
                                    let strokeColor   = 'rgba(0,0,0,0.55)';
                                    let fontSize      = 12;

                                    // ── Tendencia Temporal (line) ─────────────────────────
                                    if (chartId === 'chart_tendencia') {
                                        if (i === 0) {
                                            // Tasa Mortalidad → muertes absolutas, centradas sobre el nodo, offset constante +5px visual
                                            const total = chartInstance.data.datasets[1]?.data[index] ?? 0;
                                            text = String(Math.round((parseFloat(dataVal) / 100) * (total || 1)));
                                            customYOffset = -18; // offset fijo arriba del nodo
                                            textColor     = PALETTE.danger;
                                            strokeColor   = null;
                                            drawBg        = true;
                                        } else {
                                            // Total evaluados → debajo del nodo
                                            customYOffset = 18;
                                            textColor     = _getChartTheme().evaluadosText;
                                            strokeColor   = null;
                                            drawBg        = true;
                                        }
                                        fontSize = 11;

                                    // ── Causas de Muerte (bar horizontal) ────────────────
                                    } else if (chartId === 'chart_causas') {
                                        // Etiqueta de frecuencia al final de la barra, dentro, contraste blanco
                                        // element.base = inicio de la barra; element.x = fin de la barra
                                        const barEnd = element.x ?? pos.x;
                                        pos = { x: barEnd, y: pos.y };
                                        align         = 'right';
                                        customXOffset = -8; // margen interno desde el extremo derecho
                                        textColor     = '#ffffff';
                                        strokeColor   = 'rgba(0,0,0,0.5)';
                                        fontSize      = 11;

                                    // ── Donut Ubicación ──────────────────────────────────
                                    } else if (chartId === 'chart_ubicacion') {
                                        const total   = chartInstance.data.datasets[0].data.reduce((a, b) => a + b, 0);
                                        const pct     = total > 0 ? ((dataVal / total) * 100).toFixed(0) : 0;
                                        text          = `${dataVal}\n(${pct}%)`;
                                        textColor     = '#ffffff';
                                        strokeColor   = 'rgba(0,0,0,0.6)';
                                        fontSize      = 11;

                                    // ── Desempeño por Tipo de Madre (bar stacked) ────────
                                    } else if (chartId === 'chart_madre') {
                                        const elH = element.height ?? 0;
                                        if (elH <= 24) {
                                            // Barra muy pequeña → etiqueta fuera con bg
                                            align         = 'left';
                                            customXOffset = (element.width ?? 30) / 2 + 6;
                                            textColor     = _getChartTheme().textBold;
                                            strokeColor   = null;
                                            drawBg        = true;
                                        } else {
                                            // Dentro de la barra
                                            textColor  = '#ffffff';
                                        }
                                        fontSize = 12;

                                    // ── Donut Ombligos ───────────────────────────────────
                                    } else if (chartId === 'chart_ombligos') {
                                        const total = chartInstance.data.datasets[0].data.reduce((a, b) => a + b, 0);
                                        const pct   = total > 0 ? ((dataVal / total) * 100).toFixed(0) : 0;
                                        text        = `${dataVal}\n(${pct}%)`;
                                        textColor   = '#ffffff';
                                        strokeColor = 'rgba(0,0,0,0.6)';
                                        fontSize    = 11;

                                    // ── Mortalidad por Sexo (bar grouped) ───────────────
                                    } else if (chartId === 'chart_sexo') {
                                        const elH = element.height ?? 0;
                                        if (elH <= 24) {
                                            align         = 'left';
                                            customXOffset = (element.width ?? 30) / 2 + 6;
                                            textColor     = _getChartTheme().textBold;
                                            strokeColor   = null;
                                            drawBg        = true;
                                        } else {
                                            textColor  = '#ffffff';
                                        }
                                        text    = dataVal + '%';
                                        fontSize = 12;
                                    }

                                    // ── Renderizado ──────────────────────────────────────
                                    tCtx.save();
                                    tCtx.font        = `bold ${fontSize}px Inter, sans-serif`;
                                    tCtx.textAlign   = align;
                                    tCtx.textBaseline = 'middle';

                                    const lines  = text.split('\n');
                                    const lineH  = fontSize + 3;
                                    const finalX = pos.x + customXOffset;
                                    const finalY = pos.y + customYOffset;

                                    if (drawBg) {
                                        const maxW = Math.max(...lines.map(l => tCtx.measureText(l).width));
                                        const bgH  = lineH * lines.length + 8;
                                        let bgX    = finalX;
                                        if (align === 'center') bgX -= maxW / 2;
                                        else if (align === 'right') bgX -= maxW;
                                        tCtx.fillStyle = _getChartTheme().badgeBg;
                                        if (tCtx.roundRect) {
                                            tCtx.beginPath();
                                            tCtx.roundRect(bgX - 4, finalY - bgH / 2, maxW + 8, bgH, 4);
                                            tCtx.fill();
                                        } else {
                                            tCtx.fillRect(bgX - 4, finalY - bgH / 2, maxW + 8, bgH);
                                        }
                                    }

                                    lines.forEach((line, li) => {
                                        const ly = finalY + (li - (lines.length - 1) / 2) * lineH;
                                        if (strokeColor) {
                                            tCtx.strokeStyle = strokeColor;
                                            tCtx.lineWidth   = 2.5;
                                            tCtx.strokeText(line, finalX, ly);
                                        }
                                        tCtx.fillStyle = textColor;
                                        tCtx.fillText(line, finalX, ly);
                                    });

                                    tCtx.restore();
                                });
                            });
                        }

                        const imgData = tempCanvas.toDataURL('image/png', 1.0);
                        
                        const pdfWidth = pageWidth - 28;
                        const canvasRatio = canvas.height / canvas.width;
                        const pdfHeight = pdfWidth * canvasRatio;
                        
                        doc.addImage(imgData, 'PNG', 14, yPos, pdfWidth, pdfHeight);

                        // Línea separadora sutil entre gráficos
                        const sepY = yPos + pdfHeight + 8;
                        doc.setDrawColor(220, 220, 220);
                        doc.setLineWidth(0.3);
                        doc.line(14, sepY, pageWidth - 14, sepY);

                        yPos += pdfHeight + 20; // padding generoso para que el reporte respire
                    }
                    
                    // Tabla de ranking
                    const table = card.querySelector('table');
                    if (table) {
                        if (yPos > 220) {
                            doc.addPage();
                            yPos = 20;
                        }
                        doc.setFontSize(12);
                        doc.setTextColor(0);
                        doc.text(title, 14, yPos);
                        yPos += 6;
                        
                        // Ocultar columna de barra de progreso para el PDF
                        doc.autoTable({
                            html: table,
                            startY: yPos,
                            theme: 'grid',
                            styles: { font: 'helvetica', fontSize: 9 },
                            headStyles: { fillColor: [26, 35, 126] },
                            didParseCell: function(data) {
                                if (data.column.index === 3) {
                                    data.cell.styles.cellWidth = 0;
                                    data.cell.styles.fontSize = 0;
                                    data.cell.text = [''];
                                }
                                if (data.column.index === 4) {
                                    if (data.section === 'head') {
                                        data.cell.text = ['Muertes'];
                                    } else if (data.section === 'body') {
                                        let total = 0;
                                        
                                        if (data.row && data.row.cells && data.row.cells[2]) {
                                            total = parseInt(data.row.cells[2].text.join(''), 10);
                                        } else if (data.row && data.row.raw) {
                                            if (data.row.raw.cells && data.row.raw.cells[2]) {
                                                total = parseInt(data.row.raw.cells[2].textContent, 10);
                                            } else if (Array.isArray(data.row.raw) && data.row.raw[2]) {
                                                let val = data.row.raw[2];
                                                total = parseInt(val.textContent || val.content || val, 10);
                                            }
                                        }
                                        
                                        const pctText = Array.isArray(data.cell.text) ? data.cell.text.join('') : String(data.cell.text);
                                        const pct = parseFloat(pctText);
                                        
                                        if (!isNaN(total) && !isNaN(pct)) {
                                            data.cell.text = [String(Math.round((pct / 100) * total))];
                                        }
                                    }
                                }
                            }
                        });
                        yPos = doc.lastAutoTable.finalY + 15;
                    }
                });
            });
            
            doc.save('Vetfield_Reporte_Analitico.pdf');
        } catch(e) {
            console.error('Error exporting PDF:', e);
            alert('Hubo un error al generar el PDF.');
        }
        
        if (btnEl) {
            btnEl.innerHTML = '<i data-lucide="download" style="width: 18px; height: 18px;"></i> Descargar PDF';
            btnEl.disabled = false;
            if (window.lucide) window.lucide.createIcons();
        }
    }, 150);
};

// ────────────────────────────────────────────────────────────────
// Sincronización de tema (Modo Oscuro / Claro) en todos los gráficos
// ────────────────────────────────────────────────────────────────
window.updateChartsTheme = function(isDark) {
    const theme = _getChartTheme();

    if (_dashCharts.chart_tendencia) {
        const c = _dashCharts.chart_tendencia;
        if (c.data?.datasets?.[1]) {
            c.data.datasets[1].borderColor = theme.evaluadosLine;
            c.data.datasets[1].pointBackgroundColor = theme.evaluadosPoint;
        }
        if (c.options?.scales?.y1?.ticks) {
            c.options.scales.y1.ticks.color = theme.evaluadosTicks;
        }
        if (c.options?.scales?.y?.grid) {
            c.options.scales.y.grid.color = theme.gridSubtle;
        }
        if (c.options?.scales?.x?.grid) {
            c.options.scales.x.grid.color = theme.gridFaint;
        }
        if (c.options?.scales?.x?.ticks) {
            c.options.scales.x.ticks.color = theme.textSecondary;
        }
        if (c.options?.plugins?.legend?.labels) {
            c.options.plugins.legend.labels.color = theme.legendText;
        }
        c.update();
    }

    if (_dashCharts.chart_causas) {
        const c = _dashCharts.chart_causas;
        if (c.options?.scales?.y?.ticks) c.options.scales.y.ticks.color = theme.textBold;
        if (c.options?.scales?.x?.ticks) c.options.scales.x.ticks.color = theme.textSecondary;
        if (c.options?.scales?.x?.grid) c.options.scales.x.grid.color = theme.gridSubtle;
        c.update();
    }

    if (_dashCharts.chart_madre) {
        const c = _dashCharts.chart_madre;
        if (c.options?.scales?.x?.ticks) c.options.scales.x.ticks.color = theme.textBold;
        if (c.options?.scales?.y?.ticks) c.options.scales.y.ticks.color = theme.textSecondary;
        if (c.options?.scales?.y?.grid) c.options.scales.y.grid.color = theme.gridFaint;
        if (c.options?.plugins?.legend?.labels) c.options.plugins.legend.labels.color = theme.legendText;
        c.update();
    }

    if (_dashCharts.chart_calostro) {
        const c = _dashCharts.chart_calostro;
        if (c.options?.scales?.x?.ticks) c.options.scales.x.ticks.color = theme.textSecondary;
        if (c.options?.scales?.y?.ticks) c.options.scales.y.ticks.color = theme.textSecondary;
        if (c.options?.scales?.x?.grid) c.options.scales.x.grid.color = theme.gridFaint;
        if (c.options?.scales?.y?.grid) c.options.scales.y.grid.color = theme.gridFaint;
        if (c.options?.scales?.x?.title) c.options.scales.x.title.color = theme.textAxisTitle;
        if (c.options?.scales?.y?.title) c.options.scales.y.title.color = theme.textAxisTitle;
        if (c.options?.plugins?.legend?.labels) c.options.plugins.legend.labels.color = theme.legendText;
        c.update();
    }

    if (_dashCharts.chart_sexo) {
        const c = _dashCharts.chart_sexo;
        if (c.options?.scales?.x?.ticks) c.options.scales.x.ticks.color = theme.textBold;
        if (c.options?.scales?.y?.ticks) c.options.scales.y.ticks.color = theme.textSecondary;
        if (c.options?.scales?.y?.grid) c.options.scales.y.grid.color = theme.gridFaint;
        if (c.options?.plugins?.legend?.labels) c.options.plugins.legend.labels.color = theme.legendText;
        if (c.data?.datasets?.[0]) {
            c.data.datasets[0].backgroundColor = [theme.sexoMachoBg, PALETTE.pink + 'cc'];
            c.data.datasets[0].borderColor = [theme.sexoMachoBorder, PALETTE.pink];
        }
        c.update();
    }

    if (_dashCharts.chart_ubicacion) {
        const c = _dashCharts.chart_ubicacion;
        if (c.options?.plugins?.legend?.labels) c.options.plugins.legend.labels.color = theme.legendText;
        c.update();
    }

    if (_dashCharts.chart_ombligos) {
        const c = _dashCharts.chart_ombligos;
        if (c.options?.plugins?.legend?.labels) c.options.plugins.legend.labels.color = theme.legendText;
        c.update();
    }
};
