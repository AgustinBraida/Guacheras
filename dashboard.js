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

        let tipo_parto = 'Normal';
        if (estado !== 'Vivo' && rng() < 0.20) {
            tipo_parto = 'Muerto al parto';
        } else {
            tipo_parto = rng() < 0.78 ? 'Normal' : (rng() < 0.95 ? 'Asistido' : 'Muerto al parto');
        }
        if (tipo_parto === 'Muerto al parto' && estado === 'Vivo') {
            tipo_parto = 'Asistido';
        }

        const tipo_calostro = rng() < 0.70 ? 'De la madre' : (rng() < 0.88 ? 'Banco de calostro' : 'Calostro mejorado');
        const metodo_calostrado = rng() < 0.65 ? 'Con mamadera' : (rng() < 0.85 ? 'Con sonda' : 'Mamó solo');

        let estado_salud = null, detalle_salud = null;
        if (estado === 'Vivo') {
            const rSalud = rng();
            if (rSalud < 0.80) {
                estado_salud = 'Sano, sin problemas aparentes';
                detalle_salud = '';
            } else if (rSalud < 0.90) {
                estado_salud = 'Está enfermo actualmente';
                const enfOpts = ['Diarrea neonatal', 'Neumonía', 'Onfalitis leve', 'Criptosporidiosis'];
                detalle_salud = enfOpts[Math.floor(rng() * enfOpts.length)];
            } else if (rSalud < 0.96) {
                estado_salud = 'Tuvo una enfermedad anteriormente';
                const recOpts = ['Diarrea (recuperado)', 'Neumonía tratada', 'Rotavirus'];
                detalle_salud = recOpts[Math.floor(rng() * recOpts.length)];
            } else {
                estado_salud = 'Nació con algún problema o malformación';
                const malOpts = ['Hernia umbilical', 'Debilidad congénita', 'Paladar hendido'];
                detalle_salud = malOpts[Math.floor(rng() * malOpts.length)];
            }
        }

        const litros_calostro_madre = tipo_madre === 'Vaca'
            ? parseFloat((rng() * 6 + 3.5).toFixed(1))
            : parseFloat((rng() * 3.8 + 2.0).toFixed(1));
        const rp_madre = `M-${String((idx % 250) + 1).padStart(3, '0')}`;

        return {
            id: idx,
            productor: prod, establecimiento: est, fecha,
            rp_ternero: `T-${String(idx).padStart(4,'0')}`,
            rp_madre,
            litros_calostro_madre,
            ig_ternero, ig_calostro, sexo,
            ombligo: pickOmbligo(estado),
            tipo_madre, tipo_parto, tipo_calostro, metodo_calostrado, estado,
            estado_salud, detalle_salud,
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

function _getIgMetodo() {
    try {
        if (typeof AuthManager !== 'undefined' && typeof AuthManager.getIgMetodo === 'function') {
            return AuthManager.getIgMetodo();
        }
        if (window.AuthManager && typeof window.AuthManager.getIgMetodo === 'function') {
            return window.AuthManager.getIgMetodo();
        }
        const sess = JSON.parse(localStorage.getItem('vetfield_session') || '{}');
        if (sess && sess.igMetodo) return sess.igMetodo;
    } catch {}
    return 'brix';
}

function _getDefaultIgThresholds(metodo) {
    const isBrix = (metodo || _getIgMetodo()) === 'brix';
    return isBrix ? { high: 22, mid: 18 } : { high: 15, mid: 10 };
}

function _loadKpiThresholds(custom) {
    try {
        let saved = custom;
        if (!saved || Object.keys(saved).length === 0) {
            saved = JSON.parse(localStorage.getItem(_KPI_THRESHOLDS_KEY) || '{}');
        }
        if ((!saved || Object.keys(saved).length === 0) && typeof AuthManager !== 'undefined' && typeof AuthManager.getDashboardConfig === 'function') {
            const dc = AuthManager.getDashboardConfig();
            if (dc && dc.kpiThresholds) saved = dc.kpiThresholds;
        }
        const metodo = _getIgMetodo();
        const defIg = _getDefaultIgThresholds(metodo);
        const highKey = metodo === 'brix' ? 'igHigh_brix' : 'igHigh_mgdl';
        const midKey  = metodo === 'brix' ? 'igMid_brix'  : 'igMid_mgdl';
        const highMadreKey = metodo === 'brix' ? 'igMadreHigh_brix' : 'igMadreHigh_mgdl';
        const midMadreKey  = metodo === 'brix' ? 'igMadreMid_brix'  : 'igMadreMid_mgdl';
        return {
            mortHigh: saved?.mortHigh ?? 5,
            mortMid:  saved?.mortMid  ?? 3,
            igHigh:   saved?.[highKey] ?? saved?.igHigh ?? defIg.high,
            igMid:    saved?.[midKey]  ?? saved?.igMid  ?? defIg.mid,
            igHigh_brix: saved?.igHigh_brix ?? (saved?.igHigh !== undefined && metodo === 'brix' ? saved.igHigh : 22),
            igMid_brix:  saved?.igMid_brix  ?? (saved?.igMid  !== undefined && metodo === 'brix' ? saved.igMid  : 18),
            igHigh_mgdl: saved?.igHigh_mgdl ?? (saved?.igHigh !== undefined && metodo === 'mgdl' ? saved.igHigh : 15),
            igMid_mgdl:  saved?.igMid_mgdl  ?? (saved?.igMid  !== undefined && metodo === 'mgdl' ? saved.igMid  : 10),

            igMadreHigh: saved?.[highMadreKey] ?? saved?.igMadreHigh ?? defIg.high,
            igMadreMid:  saved?.[midMadreKey]  ?? saved?.igMadreMid  ?? defIg.mid,
            igMadreHigh_brix: saved?.igMadreHigh_brix ?? (saved?.igMadreHigh !== undefined && metodo === 'brix' ? saved.igMadreHigh : 22),
            igMadreMid_brix:  saved?.igMadreMid_brix  ?? (saved?.igMadreMid  !== undefined && metodo === 'brix' ? saved.igMadreMid  : 18),
            igMadreHigh_mgdl: saved?.igMadreHigh_mgdl ?? (saved?.igMadreHigh !== undefined && metodo === 'mgdl' ? saved.igMadreHigh : 15),
            igMadreMid_mgdl:  saved?.igMadreMid_mgdl  ?? (saved?.igMadreMid  !== undefined && metodo === 'mgdl' ? saved.igMadreMid  : 10),
        };
    } catch {
        return {
            mortHigh: 5, mortMid: 3,
            igHigh: 22, igMid: 18, igHigh_brix: 22, igMid_brix: 18, igHigh_mgdl: 15, igMid_mgdl: 10,
            igMadreHigh: 22, igMadreMid: 18, igMadreHigh_brix: 22, igMadreMid_brix: 18, igMadreHigh_mgdl: 15, igMadreMid_mgdl: 10
        };
    }
}

let _kpiThresholds = _loadKpiThresholds();

// Inicializar inputs del panel con valores guardados
function _initKpiPanelInputs() {
    const ids = [
        ['kpi_mort_thr_high',     _kpiThresholds.mortHigh],
        ['kpi_mort_thr_mid',      _kpiThresholds.mortMid],
        ['kpi_ig_thr_high',       _kpiThresholds.igHigh],
        ['kpi_ig_thr_mid',        _kpiThresholds.igMid],
        ['kpi_ig_madre_thr_high', _kpiThresholds.igMadreHigh],
        ['kpi_ig_madre_thr_mid',  _kpiThresholds.igMadreMid],
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
        const isMobile = window.innerWidth < 768;

        if (isMobile) {
            // En móvil: limpiar estilos inline para que el CSS media query centre el panel
            panel.style.top   = '';
            panel.style.left  = '';
            panel.style.width = '';
        } else {
            // En escritorio: posicionar bajo la card del botón
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
            panel.style.top  = (cardRect.bottom + 6) + 'px';
            panel.style.left = left + 'px';
        }

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

// ─── KPI Info Modal ───────────────────────────────────────────────────────────
const _kpiInfoData = {
    total: {
        icon: '📋',
        iconBg: 'rgba(26,35,126,0.08)',
        category: 'Registro total',
        title: 'Total Evaluados',
        formula: 'Suma de TODOS los registros del período',
        desc: `<p>Incluye <strong>todos los terneros</strong> cargados en el período seleccionado, sin importar su estado:</p>
               <ul style="margin:8px 0 0 14px;padding:0;list-style:disc;">
                 <li><strong>Vivos</strong> → en crianza / guachera</li>
                 <li><strong>Muertos en crianza</strong> → fallecidos ya dentro de la guachera</li>
                 <li><strong>Abortos</strong> → perdidos durante la gestación</li>
                 <li><strong>Nacidos muertos</strong> → pérdida al momento del parto</li>
                 <li><strong>Muertos al periparto</strong> → fallecidos en las primeras 24 hs de vida</li>
               </ul>
               <p style="margin-top:10px;">El sub-indicador muestra cuántos ingresaron a crianza vs cuántas pérdidas perinatales hay.</p>`
    },
    mort: {
        icon: '❤️‍🩹',
        iconBg: 'rgba(220,38,38,0.08)',
        category: 'Mortalidad',
        title: 'Mortalidad en Guachera',
        formula: '(Muertes en Crianza ÷ Total en Guachera) × 100',
        desc: `<p>Mide la <strong>tasa de mortandad real</strong> de los terneros que ingresaron vivos a la guachera/crianza.</p>
               <ul style="margin:8px 0 0 14px;padding:0;list-style:disc;">
                 <li><strong>Numerador:</strong> terneros que murieron <em>dentro</em> de la guachera.</li>
                 <li><strong>Denominador:</strong> terneros que ingresaron vivos (vivos actuales + muertos en crianza).</li>
               </ul>
               <p style="margin-top:10px;"><strong>No se suman</strong> abortos, nacidos muertos ni muertos al periparto, ya que esas pérdidas se muestran por separado en el gráfico de Pérdidas Perinatales.</p>
               <p style="margin-top:8px;">Los umbrales ⚙️ de alerta son configurables según el criterio del veterinario.</p>`
    },
    ig: {
        icon: '🧪',
        iconBg: 'rgba(46,125,50,0.08)',
        category: 'Inmunidad en Terneros',
        title: 'Promedio I.G. Ternero',
        formula: 'Suma de I.G. de terneros ÷ Cantidad de terneros con medición cargada',
        desc: `<p>Mide el promedio de <strong>Inmunoglobulinas en los terneros</strong> (inmunidad pasiva absorbida tras el calostrado). <strong>Nota importante:</strong> este valor evalúa directamente a los <em>terneros</em> y no la calidad del calostro de la madre.</p>
               <p style="margin-top:8px;"><strong>Umbrales de referencia:</strong></p>
               <ul style="margin:6px 0 0 14px;padding:0;list-style:disc;">
                 <li><span style="color:#16a34a;font-weight:700;">✅ Óptimo</span> → ≥ umbral alto (por defecto 22% Brix)</li>
                 <li><span style="color:#d97706;font-weight:700;">⚡ Aceptable</span> → entre umbral medio y alto</li>
                 <li><span style="color:#dc2626;font-weight:700;">⚠️ Bajo</span> → por debajo del umbral medio</li>
               </ul>
               <p style="margin-top:10px;">La unidad (% Brix o mg/dL) depende de la preferencia configurada en el perfil.</p>`
    },
    ig_madre: {
        icon: '🐄',
        iconBg: 'rgba(46,125,50,0.08)',
        category: 'Calostro Materno',
        title: 'Promedio I.G. Madre',
        formula: 'Suma de I.G. de calostro de madres ÷ Cantidad de madres con medición cargada',
        desc: `<p>Mide la calidad y concentración promedio de <strong>Inmunoglobulinas en el calostro producido por las madres</strong> al momento del parto (medido en °Brix o mg/dL).</p>
               <p style="margin-top:8px;"><strong>Umbrales de referencia:</strong></p>
               <ul style="margin:6px 0 0 14px;padding:0;list-style:disc;">
                 <li><span style="color:#16a34a;font-weight:700;">✅ Óptimo</span> → ≥ umbral alto (por defecto 22% Brix)</li>
                 <li><span style="color:#d97706;font-weight:700;">⚡ Aceptable</span> → entre umbral medio y alto</li>
                 <li><span style="color:#dc2626;font-weight:700;">⚠️ Bajo</span> → por debajo del umbral medio</li>
               </ul>
               <p style="margin-top:10px;">Los umbrales ⚙️ son configurables y se guardan en tu cuenta para sincronizarse en todos tus dispositivos.</p>`
    },
    recuperacion: {
        icon: '📈',
        iconBg: 'rgba(124,58,237,0.08)',
        category: 'Supervivencia',
        title: 'Tasa de Supervivencia',
        formula: '(Terneros Vivos en Crianza ÷ Total en Guachera) × 100',
        desc: `<p>Porcentaje de terneros que <strong>siguen vivos</strong> dentro del período evaluado, tomando como base todos los que ingresaron a crianza.</p>
               <ul style="margin:8px 0 0 14px;padding:0;list-style:disc;">
                 <li><strong>Numerador:</strong> terneros con estado <em>Vivo</em>.</li>
                 <li><strong>Denominador:</strong> vivos + muertos en crianza (terneros que efectivamente ingresaron a la guachera).</li>
               </ul>
               <p style="margin-top:10px;">Es el complemento de la Mortalidad en Guachera: Supervivencia + Mortalidad = 100%.</p>
               <p style="margin-top:8px;">No incluye abortos ni pérdidas perinatales en la base de cálculo.</p>`
    },

    // ── Información de Gráficos del Dashboard ──
    chart_tendencia: {
        icon: '📈',
        iconBg: 'rgba(99, 102, 241, 0.1)',
        category: 'Evolución temporal',
        title: 'Tendencia Temporal de Mortalidad',
        formula: '% Mortalidad agrupado por Día, Semana o Mes',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Muestra la evolución cronológica de las bajas en guachera a lo largo del tiempo, permitiendo evaluar la efectividad del manejo y detectar picos sanitarios tempranamente.</p>
<p style="margin-top:8px;"><strong>¿Qué valores toma?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li><strong>Fechas de muerte:</strong> registros de terneros fallecidos dentro del rango de fechas activo.</li>
  <li><strong>Selector de granularidad:</strong> agrupa por Día, Semanal o Mensual para analizar la curva en detalle o de forma acumulada.</li>
</ul>
<p style="margin-top:10px;"><strong>¿Qué significa?</strong><br>
Una curva descendente o estable indica buen control sanitario. Picos marcados señalan eventos críticos específicos (olas de frío/calor, fallas en la preparación del lote de leche o brotes infecciosos).</p>`
    },

    chart_ubicacion: {
        icon: '🎯',
        iconBg: 'rgba(239, 68, 68, 0.1)',
        category: 'Distribución espacial',
        title: 'Mortalidad por Ubicación',
        formula: '(Muertes en Sector ÷ Total de Muertes) × 100',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Distribuye las muertes según las instalaciones o sectores físicos del establecimiento donde se produjo cada deceso.</p>
<p style="margin-top:8px;"><strong>¿Qué valores toma?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li>El campo <em>Lugar / Ubicación de muerte</em> registrado al cargar la baja (Guachera individual, Corrales colectivos, Preparto, etc.).</li>
</ul>
<p style="margin-top:10px;"><strong>¿Qué significa?</strong><br>
Identifica si hay áreas críticas o "puntos calientes" en el establecimiento. Si un sector concentra una proporción atípica de bajas, orienta a auditar la higiene, ventilación, densidad o drenajes de ese lugar en particular.</p>`
    },

    chart_causas: {
        icon: '☠️',
        iconBg: 'rgba(220, 38, 38, 0.1)',
        category: 'Diagnóstico clínico',
        title: 'Causas de Muerte',
        formula: 'Frecuencia de decesos según Categoría y Causa',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Clasifica las muertes ocurridas en guachera según el diagnóstico presuntivo o confirmado por el médico veterinario.</p>
<p style="margin-top:8px;"><strong>¿Qué valores toma?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li><strong>Categorías principales:</strong> Infecciosas, Digestivas, Factores de Manejo, Traumatismos y Otras.</li>
  <li><strong>Causas específicas:</strong> diarrea neonatal, neumonía, timpanismo, deshidratación, etc.</li>
</ul>
<p style="margin-top:10px;"><strong>¿Qué significa?</strong><br>
Es la base para definir planes de vacunación, tratamientos y protocolos de bioseguridad. La predominancia de patologías digestivas exige revisar el calostrado y la leche; mientras que problemas respiratorios apuntan al confort y ambiente.</p>`
    },

    chart_calostro: {
        icon: '🍼',
        iconBg: 'rgba(16, 185, 129, 0.1)',
        category: 'Inmunidad pasiva',
        title: 'Correlación Brix vs Supervivencia',
        formula: 'Calidad del Calostro (° Brix) vs Condición (Vivo / Muerto)',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Analiza la correlación directa entre el tenor de inmunoglobulinas del calostro ofrecido y la probabilidad de que el ternero sobreviva a la etapa de guachera.</p>
<p style="margin-top:8px;"><strong>¿Qué valores toma?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li><strong>Eje horizontal (° Brix):</strong> concentración de anticuerpos medida con refractómetro óptico o digital.</li>
  <li><strong>Eje vertical:</strong> condición del ternero (Vivo o Muerto). Cada punto representa un ternero cargado.</li>
</ul>
<p style="margin-top:10px;"><strong>¿Qué significa?</strong><br>
Demuestra de forma gráfica el impacto de la transferencia pasiva: calostros con ≥ 22° Brix (óptimos) deben asociarse a altas tasas de supervivencia, mientras que puntos de muerte agrupados a la izquierda indican fallas de calostrado.</p>`
    },

    chart_madre: {
        icon: '🐄',
        iconBg: 'rgba(245, 158, 11, 0.1)',
        category: 'Categoría materna',
        title: 'Desempeño por Tipo de Madre',
        formula: 'Tasa de sobrevida y mortandad: Vacas vs Vaquillonas',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Compara el desempeño y supervivencia de los terneros según hayan nacido de madres adultas (Vacas multíparas) o de primer parto (Vaquillonas).</p>
<p style="margin-top:8px;"><strong>¿Qué valores toma?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li>El campo <em>Tipo de Madre</em> de los registros del período, cruzado con el estado vital del ternero (*Vivo* vs *Muerto*).</li>
</ul>
<p style="margin-top:10px;"><strong>¿Qué significa?</strong><br>
Las vaquillonas suelen producir calostro con menor concentración de IgG y tienen mayor incidencia de partos difíciles. Permite detectar si la cría de primerizas requiere refuerzo de banco de calostro o cuidados intensivos especiales.</p>`
    },

    chart_brix_salud: {
        icon: '🩺',
        iconBg: 'rgba(14, 165, 233, 0.1)',
        category: 'Inmunidad & Morbilidad',
        title: 'Grados Brix vs Salud y Supervivencia',
        formula: 'Nivel de Brix vs Estado Clínico (Sano, Enfermo, Fallecido)',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Muestra la relación entre la inmunidad transferida y la propensión a enfermarse o morir durante toda la estancia en la crianza artificial.</p>
<p style="margin-top:8px;"><strong>¿Qué valores toma?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li><strong>Nivel Brix:</strong> según el selector, puede ser Brix en suero del ternero, Brix de la madre o promedio.</li>
  <li><strong>Condición clínica:</strong> Sano (verde), Enfermo / Tuvo enfermedad (naranja) o Falleció (rojo).</li>
  <li><strong>Filtro de enfermedad:</strong> permite aislar el análisis para una patología específica (ej. diarrea, neumonía).</li>
</ul>
<p style="margin-top:10px;"><strong>¿Qué significa?</strong><br>
Permite comprobar si un bajo nivel de calostrado incrementa los casos de morbilidad y requerimiento de tratamientos médicos, aun en aquellos terneros que lograron sobrevivir.</p>`
    },

    chart_ombligos: {
        icon: '🔵',
        iconBg: 'rgba(37, 99, 235, 0.1)',
        category: 'Manejo neonatal',
        title: 'Salud de Ombligos al Alta',
        formula: '% Ombligos Normales vs Afectados (Onfalitis / Hernias)',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Evalúa la integridad sanitaria de la zona umbilical de los terneros evaluados, principal vía de ingreso de bacterias en las primeras horas de vida.</p>
<p style="margin-top:8px;"><strong>¿Qué valores toma?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li>Calificación registrada en el examen clínico: <em>Normal</em>, <em>Onfalitis</em> (infección bacteriana), <em>Onfaloflebitis</em>, <em>Hernia umbilical</em> u <em>Otras</em>.</li>
</ul>
<p style="margin-top:10px;"><strong>¿Qué significa?</strong><br>
Un valor normal inferior al 95% refleja fallas graves en la higiene del corral de parto o demoras en la cura del cordón con tintura de iodo al 7%, lo que predispone a poliartritis, meningitis y septicemias.</p>`
    },

    chart_ranking: {
        icon: '🏆',
        iconBg: 'rgba(234, 179, 8, 0.1)',
        category: 'Comparativa de campos',
        title: 'Ranking de Establecimientos',
        formula: '(Muertes en Campo ÷ Terneros Totales del Campo) × 100',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Compara y clasifica el desempeño de los distintos tambos o establecimientos registrados, facilitando la auditoría comparada.</p>
<p style="margin-top:8px;"><strong>¿Qué valores toma?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li><strong>Total:</strong> cantidad de animales ingresados en cada campo.</li>
  <li><strong>Incidencia:</strong> número absoluto de terneros muertos.</li>
  <li><strong>Tasa:</strong> porcentaje de mortandad resultante por establecimiento.</li>
</ul>
<p style="margin-top:10px;"><strong>¿Qué significa?</strong><br>
Permite identificar rápidamente los establecimientos más vulnerables para concentrar recursos, capacitación al personal y visitas técnicas de urgencia.</p>`
    },

    chart_sexo: {
        icon: '⚤',
        iconBg: 'rgba(219, 39, 119, 0.1)',
        category: 'Demografía animal',
        title: 'Mortalidad por Sexo',
        formula: 'Tasa de bajas en Machos vs Tasa de bajas en Hembras',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Compara el volumen y la tasa porcentual de mortandad entre terneros machos y terneras hembras criados en el establecimiento.</p>
<p style="margin-top:8px;"><strong>¿Qué valores toma?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li>Sexo del animal (Macho o Hembra) cruzado con su condición final (Vivo o Fallecido).</li>
</ul>
<p style="margin-top:10px;"><strong>¿Qué significa?</strong><br>
Permite corroborar si existe trato diferenciado en la rutina de crianza o en la asignación de calostro de calidad entre hembras de reposición y machos, o si hay impacto derivado del mayor peso al nacer de los machos.</p>`
    },

    chart_parto: {
        icon: '🩺',
        iconBg: 'rgba(99, 102, 241, 0.1)',
        category: 'Manejo del parto',
        title: 'Tipo y Dificultad de Parto',
        formula: '% de Partos Normales (Eutócicos) vs Asistidos / Distócicos',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Muestra la proporción de nacimientos que ocurrieron de forma natural y espontánea versus aquellos que requirieron asistencia del personal o intervención quirúrgica.</p>
<p style="margin-top:8px;"><strong>¿Qué valores toma?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li>Clasificación de parto: <em>Normal</em>, <em>Asistido / Distócico</em>, <em>Cesárea</em>.</li>
</ul>
<p style="margin-top:10px;"><strong>¿Qué significa?</strong><br>
El parto asistido es una de las principales causas de asfixia neonatal y baja vitalidad. Una tasa elevada de distocias indica desproporción pelvi-fetal, sugiriendo revisar la elección de reproductores o la nutrición de vacas en preparto.</p>`
    },

    chart_perinatal: {
        icon: '⚠️',
        iconBg: 'rgba(249, 115, 22, 0.1)',
        category: 'Pérdidas tempranas',
        title: 'Pérdidas Gestacionales y Perinatales',
        formula: 'Abortos + Nacidos Muertos + Muertos en Periparto (< 24 hs)',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Contabiliza las pérdidas ocurridas antes de que el ternero comience formalmente su crianza en la guachera.</p>
<p style="margin-top:8px;"><strong>¿Qué valores toma?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li><strong>Aborto:</strong> interrupción de la gestación.</li>
  <li><strong>Nacido muerto:</strong> óbito fetal al momento de nacer.</li>
  <li><strong>Muerto al periparto:</strong> ternero nacido vivo que falleció en sus primeras 24 hs de vida.</li>
</ul>
<p style="margin-top:10px;"><strong>¿Qué significa?</strong><br>
Distingue los problemas obstétricos y de sanidad reproductiva del tambo de la eficiencia propia de la guachera. Ayuda a investigar enfermedades infecciosas reproductivas y el protocolo de atención inmediata del recién nacido.</p>`
    },

    chart_litros_calostro: {
        icon: '🍼',
        iconBg: 'rgba(59, 130, 246, 0.1)',
        category: 'Nutrición preparto',
        title: 'Volumen vs Calidad de Calostro (Vacas vs Vaquillonas)',
        formula: 'Litros de Calostro de la Madre vs Concentración I.G. (°Brix / mg/dL)',
        desc: `<p><strong>¿A qué hace referencia?</strong><br>
Evalúa la relación directa entre la cantidad de calostro producida por la madre y su calidad inmunológica, diferenciando el comportamiento de vacas multíparas frente a vaquillonas de primer parto.</p>
<p style="margin-top:8px;"><strong>¿Qué indica para el manejo y dieta preparto?</strong></p>
<ul style="margin:4px 0 0 14px;padding:0;list-style:disc;">
  <li><strong>Efecto Dilución:</strong> En animales de muy alta producción de calostro suele observarse una dilución de anticuerpos (menor °Brix). Una adecuada nutrición en el período seco ayuda a sostener altos niveles de I.G. incluso con volúmenes elevados.</li>
  <li><strong>Vacas vs Vaquillonas:</strong> Las vaquillonas frecuentemente producen menor volumen pero con concentraciones elevadas de inmunoglobulinas.</li>
</ul>
<p style="margin-top:10px;">Podés alternar con el selector superior entre la vista de <strong>Curvas</strong> (promedios por rangos de litros) y la vista de <strong>Puntos</strong> (cada madre mapeada individualmente).</p>`
    }
};

function toggleKpiInfoModal(type, _btn) {
    const info = _kpiInfoData[type];
    if (!info) return;

    const modal = document.getElementById('kpiInfoModal');
    if (!modal) return;

    // Poblar contenido
    const iconWrap = document.getElementById('kpiInfoIconWrap');
    const iconEl   = document.getElementById('kpiInfoIcon');
    const catEl    = document.getElementById('kpiInfoCategory');
    const titleEl  = document.getElementById('kpiInfoTitle');
    const formulaBox = document.getElementById('kpiInfoFormulaBox');
    const formulaLabel = document.getElementById('kpiInfoFormulaLabel');
    const formulaEl = document.getElementById('kpiInfoFormulaText');
    const descEl   = document.getElementById('kpiInfoDescription');

    if (iconWrap) iconWrap.style.background = info.iconBg || 'rgba(26,35,126,0.08)';
    if (iconEl)   iconEl.textContent = info.icon || '📊';
    if (catEl)    catEl.textContent  = info.category || 'Información';
    if (titleEl)  titleEl.textContent = info.title || '';
    
    if (formulaLabel) {
        formulaLabel.textContent = info.formulaLabel || (info.formula && info.formula.includes('÷') ? '📐 Fórmula' : '📊 Métrica / Indicador');
    }
    if (formulaBox) {
        if (info.formula) {
            formulaBox.style.display = 'block';
            if (formulaEl) formulaEl.textContent = info.formula;
        } else {
            formulaBox.style.display = 'none';
        }
    }
    if (descEl)   descEl.innerHTML = info.desc || '';

    // Refrescar icono de cierre lucide
    if (window.lucide) window.lucide.createIcons();

    modal.classList.add('active');
}
window.toggleKpiInfoModal = toggleKpiInfoModal;
window.openChartInfoModal = toggleKpiInfoModal;

function closeKpiInfoModal(e) {
    if (e && e.target !== document.getElementById('kpiInfoModal')) return;
    const modal = document.getElementById('kpiInfoModal');
    if (modal) modal.classList.remove('active');
}
window.closeKpiInfoModal = closeKpiInfoModal;

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
        const metodo = _getIgMetodo();
        const highKey = metodo === 'brix' ? 'igHigh_brix' : 'igHigh_mgdl';
        const midKey  = metodo === 'brix' ? 'igMid_brix'  : 'igMid_mgdl';
        _kpiThresholds[highKey] = high;
        _kpiThresholds[midKey]  = mid;
    } else if (type === 'ig_madre') {
        const high = parseFloat(document.getElementById('kpi_ig_madre_thr_high')?.value);
        const mid  = parseFloat(document.getElementById('kpi_ig_madre_thr_mid')?.value);
        if (isNaN(high) || isNaN(mid) || mid >= high) {
            alert('El umbral “Aceptable” debe ser menor que el umbral “Óptimo”.');
            return;
        }
        _kpiThresholds.igMadreHigh = high;
        _kpiThresholds.igMadreMid  = mid;
        const metodo = _getIgMetodo();
        const highKey = metodo === 'brix' ? 'igMadreHigh_brix' : 'igMadreHigh_mgdl';
        const midKey  = metodo === 'brix' ? 'igMadreMid_brix'  : 'igMadreMid_mgdl';
        _kpiThresholds[highKey] = high;
        _kpiThresholds[midKey]  = mid;
    }
    try { localStorage.setItem(_KPI_THRESHOLDS_KEY, JSON.stringify(_kpiThresholds)); } catch {}

    // Sincronizar en la cuenta del usuario en la base de datos (nube)
    if (typeof AuthManager !== 'undefined' && typeof AuthManager.saveDashboardConfig === 'function') {
        AuthManager.saveDashboardConfig({ kpiThresholds: _kpiThresholds });
    }

    // Cerrar panel y actualizar KPIs
    _closeAllKpiPanels();
    const data = _getDashRecords();
    _renderKPIs(data);
}
window.saveKpiRanges = saveKpiRanges;

// Recalcular y refrescar umbrales cuando el usuario cambia su preferencia de medición
function refreshDashboardIgMetodo(metodo) {
    const isBrix = (metodo || _getIgMetodo()) === 'brix';
    const defIg = _getDefaultIgThresholds(isBrix ? 'brix' : 'mgdl');
    try {
        let saved = JSON.parse(localStorage.getItem(_KPI_THRESHOLDS_KEY) || '{}');
        if ((!saved || Object.keys(saved).length === 0) && typeof AuthManager !== 'undefined' && typeof AuthManager.getDashboardConfig === 'function') {
            const dc = AuthManager.getDashboardConfig();
            if (dc && dc.kpiThresholds) saved = dc.kpiThresholds;
        }
        const highKey = isBrix ? 'igHigh_brix' : 'igHigh_mgdl';
        const midKey  = isBrix ? 'igMid_brix'  : 'igMid_mgdl';
        _kpiThresholds.igHigh = saved[highKey] ?? defIg.high;
        _kpiThresholds.igMid  = saved[midKey]  ?? defIg.mid;

        const highMadreKey = isBrix ? 'igMadreHigh_brix' : 'igMadreHigh_mgdl';
        const midMadreKey  = isBrix ? 'igMadreMid_brix'  : 'igMadreMid_mgdl';
        _kpiThresholds.igMadreHigh = saved[highMadreKey] ?? defIg.high;
        _kpiThresholds.igMadreMid  = saved[midMadreKey]  ?? defIg.mid;
    } catch {
        _kpiThresholds.igHigh = defIg.high;
        _kpiThresholds.igMid  = defIg.mid;
        _kpiThresholds.igMadreHigh = defIg.high;
        _kpiThresholds.igMadreMid  = defIg.mid;
    }
    _initKpiPanelInputs();

    // Actualizar título del gráfico en la interfaz
    const titleEl = document.querySelector('[data-title-key="title_calostro"]');
    if (titleEl) {
        const savedTitles = JSON.parse(localStorage.getItem('vf_chart_titles') || '{}');
        if (!savedTitles['title_calostro'] || savedTitles['title_calostro'].includes('I.G. Calostro') || savedTitles['title_calostro'].includes('Grados Brix')) {
            titleEl.textContent = isBrix
                ? '🍼 Correlación Grados Brix vs Supervivencia'
                : '🍼 Correlación I.G. Calostro vs Supervivencia';
        }
    }

    const data = _getDashRecords();
    if (data && data.length > 0) {
        _renderKPIs(data);
        if (typeof _renderCorrelacionCalostro === 'function') {
            _renderCorrelacionCalostro(data);
        }
    }
}
window.refreshDashboardIgMetodo = refreshDashboardIgMetodo;

// ─── INIT: llamado desde updateUI() de app.js ─────────────────
function initDashboard() {
    _kpiThresholds = _loadKpiThresholds();
    _populateDashFilterDropdowns();
    _bindDashFilterEvents();
    _initKpiPanelInputs();
    _setupBackdropClick();

    // Sincronizar título de gráfico según método activo
    const isBrix = _getIgMetodo() === 'brix';
    const titleEl = document.querySelector('[data-title-key="title_calostro"]');
    if (titleEl) {
        const savedTitles = JSON.parse(localStorage.getItem('vf_chart_titles') || '{}');
        if (!savedTitles['title_calostro'] || savedTitles['title_calostro'].includes('I.G. Calostro') || savedTitles['title_calostro'].includes('Grados Brix')) {
            titleEl.textContent = isBrix
                ? '🍼 Correlación Grados Brix vs Supervivencia'
                : '🍼 Correlación I.G. Calostro vs Supervivencia';
        }
    }

    // Sincronizar orden y títulos de gráficos restaurados
    if (typeof window.restoreDashboardOrderAndTitles === 'function') {
        window.restoreDashboardOrderAndTitles();
    }

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

// ─── Helpers de Clasificación Perinatal vs Guachera ──────────
function _isPerinatal(r) {
    if (!r) return false;
    if (r.estado === 'Aborto' || r.estado === 'Nacido muerto' || r.estado === 'Muerto al periparto') return true;
    if (r.tipo_parto === 'Muerto al parto' && r.estado === 'Muerto en Establecimiento') return true;
    return false;
}
window._isPerinatal = _isPerinatal;

function _isMuertoGuachera(r) {
    if (!r || r.estado === 'Vivo') return false;
    return !_isPerinatal(r);
}
window._isMuertoGuachera = _isMuertoGuachera;

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
    _renderTipoParto(data);
    _renderPerinatal(data);
    _renderBrixSalud(data);
    _renderLitrosCalostro(data);
}
window.renderDashboard = renderDashboard;

// ────────────────────────────────────────────────────────────────
// KPIs
// ────────────────────────────────────────────────────────────────
function _renderKPIs(data) {
    const total = data.length;
    const perinatales = data.filter(_isPerinatal).length;
    const muertosGuachera = data.filter(_isMuertoGuachera).length;
    const vivos = data.filter(r => r.estado === 'Vivo').length;
    
    // Total que ingresó a guachera / crianza (vivos + los que murieron en guachera)
    const totalCrianza = vivos + muertosGuachera;
    // Tasa de mortalidad real en guachera (NO se infla con abortos ni nacidos muertos)
    const tasaMortalidad = totalCrianza > 0 ? (muertosGuachera / totalCrianza * 100) : 0;

    const igs = data.map(r => parseFloat(r.ig_ternero)).filter(v => !isNaN(v));
    const avgIg = igs.length > 0 ? igs.reduce((a, b) => a + b, 0) / igs.length : 0;

    const igsMadre = data.map(r => parseFloat(r.ig_calostro)).filter(v => !isNaN(v));
    const avgIgMadre = igsMadre.length > 0 ? igsMadre.reduce((a, b) => a + b, 0) / igsMadre.length : null;

    const enTerapia = data.filter(r => r.estado === 'Muerto en Terapia').length;
    const tasaRecuperacion = totalCrianza > 0
        ? ((vivos / totalCrianza) * 100)
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
    if (el('kpi_ig')) el('kpi_ig').textContent = igs.length > 0 ? avgIg.toFixed(1) : '—';
    if (el('kpi_ig_madre')) el('kpi_ig_madre').textContent = avgIgMadre !== null ? avgIgMadre.toFixed(1) : '—';
    if (el('kpi_recuperacion')) el('kpi_recuperacion').textContent = tasaRecuperacion.toFixed(1) + '%';

    // Sub-labels
    if (el('kpi_total_sub')) {
        el('kpi_total_sub').textContent = perinatales > 0 
            ? `${totalCrianza} en crianza · ${perinatales} perinatales`
            : `${vivos} vivos · ${muertosGuachera} muertos`;
    }
    if (el('kpi_mortalidad_sub')) {
        el('kpi_mortalidad_sub').textContent = `${muertosGuachera} en crianza · ${vivos} vivos`;
    }
    if (el('kpi_ig_sub')) {
        const igLevel = avgIg >= _kpiThresholds.igHigh
            ? '✅ Óptimo'
            : avgIg >= _kpiThresholds.igMid
                ? '⚡ Aceptable'
                : '⚠️ Bajo';
        const unit = _getIgMetodo() === 'brix' ? '% Brix' : 'mg/dL';
        el('kpi_ig_sub').textContent = igs.length > 0 ? `${igLevel} · ${unit}` : `Sin datos · ${unit}`;
        // Aplicar color de estado a la card IG
        const igCard = el('kpi_ig_card');
        if (igCard) {
            igCard.classList.remove('kpi-state--success', 'kpi-state--warning', 'kpi-state--danger');
            if (igs.length > 0) {
                if (avgIg >= _kpiThresholds.igHigh)      igCard.classList.add('kpi-state--success');
                else if (avgIg >= _kpiThresholds.igMid)  igCard.classList.add('kpi-state--warning');
                else                                      igCard.classList.add('kpi-state--danger');
            }
        }
    }
    if (el('kpi_ig_madre_sub')) {
        const unit = _getIgMetodo() === 'brix' ? '% Brix' : 'mg/dL';
        const igMadreCard = el('kpi_ig_madre_card');
        if (avgIgMadre === null) {
            el('kpi_ig_madre_sub').textContent = `Sin datos · ${unit}`;
            if (igMadreCard) {
                igMadreCard.classList.remove('kpi-state--success', 'kpi-state--warning', 'kpi-state--danger');
            }
        } else {
            const igMadreLevel = avgIgMadre >= _kpiThresholds.igMadreHigh
                ? '✅ Óptimo'
                : avgIgMadre >= _kpiThresholds.igMadreMid
                    ? '⚡ Aceptable'
                    : '⚠️ Bajo';
            el('kpi_ig_madre_sub').textContent = `${igMadreLevel} · ${unit}`;
            if (igMadreCard) {
                igMadreCard.classList.remove('kpi-state--success', 'kpi-state--warning', 'kpi-state--danger');
                if (avgIgMadre >= _kpiThresholds.igMadreHigh)      igMadreCard.classList.add('kpi-state--success');
                else if (avgIgMadre >= _kpiThresholds.igMadreMid)  igMadreCard.classList.add('kpi-state--warning');
                else                                               igMadreCard.classList.add('kpi-state--danger');
            }
        }
    }
    if (el('kpi_recuperacion_sub')) el('kpi_recuperacion_sub').textContent = `${enTerapia} en terapia`;
    if (window.lucide) window.lucide.createIcons();
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

// Plugin de Chart.js para corregir el desfase de coordenadas del mouse provocado por CSS zoom (body { zoom: 0.75 })
function _initChartZoomCoordinateFix() {
    if (typeof Chart === 'undefined') return;
    if (!Chart._zoomCoordinateFixRegistered) {
        Chart._zoomCoordinateFixRegistered = true;
        Chart.register({
            id: 'zoomCoordinateFix',
            beforeEvent(chart, args) {
                const e = args.event;
                if (!e) return;
                const native = e.native;
                if (!native) return;

                const source = (native.touches && native.touches[0])
                    || (native.changedTouches && native.changedTouches[0])
                    || native;

                if (typeof source.clientX !== 'number' || typeof source.clientY !== 'number') return;

                const canvas = chart.canvas;
                if (!canvas) return;

                const rect = canvas.getBoundingClientRect();
                if (!rect.width || !rect.height || !chart.width || !chart.height) return;

                // Si las dimensiones del rect en pantalla difieren de las internas del canvas (debido a CSS zoom o transform),
                // proyectar proporcionalmente la coordenada del mouse al canvas interno del gráfico
                const scaleX = rect.width / chart.width;
                const scaleY = rect.height / chart.height;
                if (Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01) {
                    e.x = ((source.clientX - rect.left) / rect.width) * chart.width;
                    e.y = ((source.clientY - rect.top) / rect.height) * chart.height;
                }
            }
        });
    }
}
_initChartZoomCoordinateFix();

// Positioner personalizado de Tooltip para seguir al cursor en tiempo real en cualquier punto de las barras
function _initChartTooltipPositioner() {
    if (typeof Chart !== 'undefined' && Chart.Tooltip) {
        if (!Chart.Tooltip.positioners) Chart.Tooltip.positioners = {};
        if (!Chart.Tooltip.positioners.followPointer) {
            Chart.Tooltip.positioners.followPointer = function(elements, eventPosition) {
                if (!elements || !elements.length) return false;
                if (eventPosition && typeof eventPosition.x === 'number' && typeof eventPosition.y === 'number') {
                    return { x: eventPosition.x, y: eventPosition.y };
                }
                return typeof this.getCenterPoint === 'function' ? this.getCenterPoint(elements[0]) : false;
            };
        }
        if (Chart.defaults?.plugins?.tooltip) {
            Chart.defaults.plugins.tooltip.position = 'followPointer';
            Chart.defaults.plugins.tooltip.animation = { duration: 0 };
        }
    }
}
_initChartTooltipPositioner();

const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 10, bottom: 10, left: 6, right: 6 } },
    plugins: {
        legend: {
            labels: {
                font: { family: 'Inter', size: 11 },
                _color: null,
                get color() { return this._color !== null ? this._color : (_isDarkMode() ? '#f1f5f9' : '#475569'); },
                set color(val) { this._color = val; },
                padding: 14
            }
        },
        tooltip: {
            position: 'followPointer',
            animation: { duration: 0 }
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

    _initChartZoomCoordinateFix();
    _initChartTooltipPositioner();

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
                mode: 'nearest',
                axis: 'y',
                intersect: false
            },

            plugins: {
                ...CHART_DEFAULTS.plugins,
                legend: { display: false },
                tooltip: {
                    position: 'followPointer',
                    animation: { duration: 0 },
                    caretPadding: 6,
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

    // 1. Obtener lugares configurados activos
    const configLugares = (typeof window.getLugaresMuerte === 'function' ? window.getLugaresMuerte() : [])
        .filter(l => l && l.activo && l.nombre)
        .map(l => l.nombre.trim());

    // 2. Extraer lugares presentes en los registros de muerte
    const dataLugares = [];
    muertos.forEach(r => {
        let loc = (r.estado || '').replace(/^Muerto\s+en\s+/i, '').trim();
        if (!loc || loc.toLowerCase() === 'vivo') loc = 'Otro';
        if (!dataLugares.some(d => d.toLowerCase() === loc.toLowerCase())) {
            dataLugares.push(loc);
        }
    });

    // 3. Unir respetando primero el orden de los configurados, luego los no configurados que existan en datos
    const allLabels = [...configLugares];
    dataLugares.forEach(loc => {
        if (!allLabels.some(l => l.toLowerCase() === loc.toLowerCase())) {
            allLabels.push(loc);
        }
    });

    if (allLabels.length === 0) {
        allLabels.push('Establecimiento', 'Guachería', 'Terapia');
    }

    // 4. Conteo de muertes por cada lugar
    const counts = allLabels.map(loc => {
        return muertos.filter(r => {
            const rLoc = (r.estado || '').replace(/^Muerto\s+en\s+/i, '').trim();
            return rLoc.toLowerCase() === loc.toLowerCase();
        }).length;
    });

    // 5. Paleta armónica de colores para cualquier número de lugares
    const COLOR_PALETTE = [
        { bg: (PALETTE.danger || '#ef4444') + ALPHA80, border: PALETTE.danger || '#ef4444' },
        { bg: (PALETTE.orange || '#f97316') + ALPHA80, border: PALETTE.orange || '#f97316' },
        { bg: (PALETTE.warning || '#f59e0b') + ALPHA80, border: PALETTE.warning || '#f59e0b' },
        { bg: 'rgba(168, 85, 247, 0.8)', border: '#a855f7' },
        { bg: 'rgba(236, 72, 153, 0.8)', border: '#ec4899' },
        { bg: 'rgba(20, 184, 166, 0.8)', border: '#14b8a6' },
        { bg: 'rgba(59, 130, 246, 0.8)', border: '#3b82f6' },
        { bg: 'rgba(99, 102, 241, 0.8)', border: '#6366f1' },
    ];

    const bgColors = allLabels.map((_, i) => COLOR_PALETTE[i % COLOR_PALETTE.length].bg);
    const borderColors = allLabels.map((_, i) => COLOR_PALETTE[i % COLOR_PALETTE.length].border);

    _dashCharts.chart_ubicacion = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: allLabels,
            datasets: [{
                data: counts,
                backgroundColor: bgColors,
                borderColor: borderColors,
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
                        color: (typeof _getThemeColors === 'function' ? _getThemeColors().legendText : '#475569'),
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
                        label: ctx => {
                            const isBrix = _getIgMetodo() === 'brix';
                            return isBrix
                                ? ` Grados Brix: ${ctx.raw.x}% | I.G. Ternero: ${ctx.raw.y}%`
                                : ` Calostro: ${ctx.raw.x} mg/dL | I.G. Ternero: ${ctx.raw.y}%`;
                        }
                    }
                }
            },
            scales: {
                x: { 
                    title: { 
                        display: true, 
                        text: _getIgMetodo() === 'brix' 
                            ? 'Grados Brix (% Brix)' 
                            : 'I.G. Calostro Madre (mg/dL)', 
                        color: _getChartTheme().textAxisTitle, 
                        font: { family: 'Inter' } 
                    }, 
                    grid: { color: _getChartTheme().gridFaint }, 
                    ticks: { color: _getChartTheme().textSecondary } 
                },
                y: { title: { display: true, text: 'I.G. Ternero (%)', color: _getChartTheme().textAxisTitle, font: { family: 'Inter' } }, grid: { color: _getChartTheme().gridFaint }, ticks: { color: _getChartTheme().textSecondary } }
            }
        }
    });
}

// ────────────────────────────────────────────────────────────────
// 3b. Brix vs Salud + Supervivencia — ScatterChart con filtro
// ────────────────────────────────────────────────────────────────

// Datos actuales del gráfico (para que el filtro pueda re-renderizar sin re-fetch)
let _brixSaludAllData = [];

window._onBrixSaludFilter = function() {
    _renderBrixSalud(_brixSaludAllData);
};

function _renderBrixSalud(data) {
    _brixSaludAllData = data; // guardar para el filtro

    const ctx = _getCtx('chart_brix_salud');
    if (!ctx) return;

    const isBrix = _getIgMetodo() === 'brix';
    const threshold = isBrix ? 8.6 : 25.0; // umbral de calostro óptimo

    // ── Poblar el dropdown de enfermedades ──────────────────────
    const sel = document.getElementById('brix_salud_filter');
    if (sel) {
        const currentVal = sel.value;
        // Recolectar todas las enfermedades únicas del campo detalle_salud
        const enfermedadesSet = new Set();
        data.forEach(r => {
            if (r.detalle_salud && r.detalle_salud.trim()) {
                enfermedadesSet.add(r.detalle_salud.trim());
            }
            // También incluir causa_especifica de muertos
            if (r.estado !== 'Vivo' && r.causa_especifica && r.causa_especifica.trim()) {
                enfermedadesSet.add(r.causa_especifica.trim());
            }
        });
        const sorted = [...enfermedadesSet].sort();
        sel.innerHTML = '<option value="">Todas las enfermedades</option>' +
            sorted.map(e => `<option value="${e}" ${e === currentVal ? 'selected' : ''}>${e}</option>`).join('');
    }

    const filtroEnf = sel ? sel.value : '';

    const fuenteSel = document.getElementById('brix_salud_fuente');
    const fuente = fuenteSel ? fuenteSel.value : 'ternero';

    // ── Helper: valor X según fuente seleccionada ────────────────
    function _getBrixX(r) {
        const madre   = parseFloat(r.ig_calostro);
        const ternero = parseFloat(r.ig_ternero);
        if (fuente === 'madre')   return isNaN(madre)   ? null : madre;
        if (fuente === 'ternero') return isNaN(ternero) ? null : ternero;
        if (!isNaN(madre) && !isNaN(ternero)) return parseFloat(((madre + ternero) / 2).toFixed(2));
        return null;
    }

    // ── Filtrar registros: solo los que tienen el campo requerido ─
    let sample = data.filter(r => _getBrixX(r) !== null);

    // Si hay filtro de enfermedad, mostrar solo terneros con esa enfermedad/causa
    if (filtroEnf) {
        sample = sample.filter(r =>
            (r.detalle_salud && r.detalle_salud.trim() === filtroEnf) ||
            (r.causa_especifica && r.causa_especifica.trim() === filtroEnf)
        );
    }

    const theme = _getChartTheme();

    // ── Clasificar en 3 grupos ───────────────────────────────────
    // 1) Muertos
    const muertos = sample
        .filter(r => r.estado !== 'Vivo')
        .map(r => ({ x: _getBrixX(r), y: 0, label: r.causa_especifica || r.estado }));

    // 2) Vivos con enfermedad (actual o pasada)
    const enfermos = sample
        .filter(r => r.estado === 'Vivo' &&
            (r.estado_salud === 'Está enfermo actualmente' ||
             r.estado_salud === 'Tuvo una enfermedad anteriormente' ||
             r.estado_salud === 'Nació con algún problema o malformación'))
        .map(r => ({ x: _getBrixX(r), y: 1, label: r.detalle_salud || r.estado_salud }));

    // 3) Sanos
    const sanos = sample
        .filter(r => r.estado === 'Vivo' && r.estado_salud === 'Sano, sin problemas aparentes')
        .map(r => ({ x: _getBrixX(r), y: 2, label: 'Sano' }));

    // ── Plugin: línea vertical del umbral ───────────────────────
    const umbralPlugin = {
        id: 'umbralBrix',
        afterDraw(chart) {
            const { ctx: c, chartArea, scales } = chart;
            if (!scales.x || !chartArea) return;
            const xPx = scales.x.getPixelForValue(threshold);
            if (xPx < chartArea.left || xPx > chartArea.right) return;
            c.save();
            c.beginPath();
            c.strokeStyle = theme.isDark ? 'rgba(251,191,36,0.7)' : 'rgba(180,120,0,0.65)';
            c.lineWidth = 1.8;
            c.setLineDash([5, 4]);
            c.moveTo(xPx, chartArea.top);
            c.lineTo(xPx, chartArea.bottom);
            c.stroke();
            c.setLineDash([]);
            c.fillStyle = theme.isDark ? 'rgba(251,191,36,0.85)' : 'rgba(140,90,0,0.85)';
            c.font = '10px Inter, sans-serif';
            c.textAlign = 'center';
            c.fillText(isBrix ? `${threshold}° Brix` : `${threshold} mg/dL`, xPx, chartArea.top - 4);
            c.restore();
        }
    };

    _dashCharts.chart_brix_salud = new Chart(ctx, {
        type: 'scatter',
        plugins: [umbralPlugin],
        data: {
            datasets: [
                {
                    label: '✅ Sano',
                    data: sanos,
                    backgroundColor: PALETTE.secondary + 'bb',
                    borderColor: PALETTE.secondary,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                },
                {
                    label: '⚠️ Enfermo / Tuvo enfermedad',
                    data: enfermos,
                    backgroundColor: PALETTE.warning + 'bb',
                    borderColor: PALETTE.warning,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                },
                {
                    label: '❌ Falleció',
                    data: muertos,
                    backgroundColor: PALETTE.danger + 'bb',
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
                        label: ctx => {
                            const unit = isBrix ? '° Brix' : ' mg/dL';
                            const estados = ['Falleció', 'Enfermo / Tuvo enfermedad', 'Sano'];
                            return ` ${ctx.raw.x}${unit} · ${ctx.raw.label || estados[ctx.raw.y] || ''}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: (() => {
                            const fuenteLabel = { ternero: 'del ternero', madre: 'de la madre', promedio: 'promedio' }[fuente] || 'del ternero';
                            return isBrix ? `° Brix ${fuenteLabel}` : `Calidad calostro ${fuenteLabel} (mg/dL)`;
                        })(),
                        color: theme.textAxisTitle,
                        font: { family: 'Inter' }
                    },
                    grid: { color: theme.gridFaint },
                    ticks: { color: theme.textSecondary }
                },
                y: {
                    min: -0.5,
                    max: 2.5,
                    title: {
                        display: true,
                        text: 'Estado de salud del ternero',
                        color: theme.textAxisTitle,
                        font: { family: 'Inter' }
                    },
                    grid: { color: theme.gridFaint },
                    ticks: {
                        color: theme.textSecondary,
                        stepSize: 1,
                        callback: v => v === 0 ? 'Falleció' : v === 1 ? 'Enfermo' : v === 2 ? 'Sano' : ''
                    }
                }
            }
        }
    });
}

// ────────────────────────────────────────────────────────────────
// Selector y renderizado de Volumen vs Calidad de Calostro
// (Vacas vs Vaquillonas — Líneas vs Dispersión)
// ────────────────────────────────────────────────────────────────
function _getCalostroView() {
    try {
        if (typeof AuthManager !== 'undefined' && typeof AuthManager.getDashboardConfig === 'function') {
            const dc = AuthManager.getDashboardConfig();
            if (dc && dc.calostroView) return dc.calostroView;
        }
        const saved = localStorage.getItem('vetfield_calostro_view');
        if (saved) return saved;
    } catch {}
    return 'lines'; // Por defecto curvas
}

function _updateCalostroViewButtons(view) {
    const btnLines = document.getElementById('btn_calostro_view_lines');
    const btnScatter = document.getElementById('btn_calostro_view_scatter');
    if (btnLines && btnScatter) {
        if (view === 'scatter') {
            btnLines.classList.remove('active');
            btnScatter.classList.add('active');
        } else {
            btnScatter.classList.remove('active');
            btnLines.classList.add('active');
        }
    }
}

window.setCalostroView = function(view) {
    localStorage.setItem('vetfield_calostro_view', view);
    if (typeof AuthManager !== 'undefined' && typeof AuthManager.saveDashboardConfig === 'function') {
        AuthManager.saveDashboardConfig({ calostroView: view });
    }
    _updateCalostroViewButtons(view);
    const data = _getDashRecords();
    _renderLitrosCalostro(data);
};

function _renderLitrosCalostro(data) {
    const ctx = _getCtx('chart_litros_calostro');
    if (!ctx) return;

    const canvasEl = ctx.canvas || ctx;
    const wrapper = canvasEl.parentElement;
    const oldOverlay = wrapper?.querySelector('.dash-no-data-overlay');
    if (oldOverlay) oldOverlay.remove();

    const isBrix = _getIgMetodo() === 'brix';
    const unit = isBrix ? '% Brix' : 'mg/dL';
    const threshold = _kpiThresholds.igMadreHigh ?? (isBrix ? 22.0 : 15.0);

    const valid = (data || []).filter(r => {
        const lit = parseFloat(r.litros_calostro_madre);
        const ig = parseFloat(r.ig_calostro);
        return !isNaN(lit) && lit > 0 && !isNaN(ig) && ig > 0;
    });

    const isVaca = r => {
        const t = (r.tipo_madre || '').toLowerCase().trim();
        return t === 'vaca' || (t.includes('vaca') && !t.includes('vaquillona'));
    };
    const isVaquillona = r => {
        const t = (r.tipo_madre || '').toLowerCase().trim();
        return t.includes('vaquillona');
    };

    const vacas = valid.filter(isVaca);
    const vaquillonas = valid.filter(isVaquillona);

    // Calcular promedios para el badge comparativo de cabecera
    const vacaAvgLit = vacas.length ? (vacas.reduce((a, b) => a + parseFloat(b.litros_calostro_madre), 0) / vacas.length).toFixed(1) : null;
    const vacaAvgIg  = vacas.length ? (vacas.reduce((a, b) => a + parseFloat(b.ig_calostro), 0) / vacas.length).toFixed(1) : null;
    const vaqAvgLit  = vaquillonas.length ? (vaquillonas.reduce((a, b) => a + parseFloat(b.litros_calostro_madre), 0) / vaquillonas.length).toFixed(1) : null;
    const vaqAvgIg   = vaquillonas.length ? (vaquillonas.reduce((a, b) => a + parseFloat(b.ig_calostro), 0) / vaquillonas.length).toFixed(1) : null;

    const vacaEl = document.getElementById('vaca_avg_summary');
    if (vacaEl) vacaEl.textContent = (vacaAvgLit !== null && vacaAvgIg !== null) ? `${vacaAvgLit} L · ${vacaAvgIg} ${unit}` : 'Sin datos';
    const vaqEl = document.getElementById('vaq_avg_summary');
    if (vaqEl) vaqEl.textContent = (vaqAvgLit !== null && vaqAvgIg !== null) ? `${vaqAvgLit} L · ${vaqAvgIg} ${unit}` : 'Sin datos';

    if (valid.length === 0) {
        if (wrapper) {
            wrapper.style.position = 'relative';
            const overlay = document.createElement('div');
            overlay.className = 'dash-no-data-overlay';
            overlay.innerHTML = `
                <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                            background:rgba(255,255,255,0.85);border-radius:12px;z-index:5;flex-direction:column;gap:8px;">
                    <span style="font-size:2.2rem;">🍼</span>
                    <span style="color:#64748b;font-size:0.95rem;font-weight:500;text-align:center;max-width:320px;">
                        Sin datos de Litros vs Calidad de Calostro.<br>
                        <span style="font-size:0.82rem;color:#94a3b8;">Cargá litros cosechados e I.G. de la madre para visualizar la comparativa.</span>
                    </span>
                </div>`;
            wrapper.appendChild(overlay);
        }
        return;
    }

    const view = _getCalostroView();
    _updateCalostroViewButtons(view);
    const theme = _getChartTheme();

    // Plugin para línea horizontal de umbral óptimo
    const umbralPlugin = {
        id: 'umbralOptimoCalostro',
        afterDraw(chart) {
            const { ctx: c, chartArea, scales } = chart;
            if (!scales.y || !chartArea) return;
            const yPx = scales.y.getPixelForValue(threshold);
            if (yPx < chartArea.top || yPx > chartArea.bottom) return;
            c.save();
            c.beginPath();
            c.strokeStyle = '#16a34a';
            c.lineWidth = 1.6;
            c.setLineDash([5, 4]);
            c.moveTo(chartArea.left, yPx);
            c.lineTo(chartArea.right, yPx);
            c.stroke();
            c.setLineDash([]);
            c.fillStyle = theme.isDark ? '#4ade80' : '#16a34a';
            c.font = '10px Inter, sans-serif';
            c.textAlign = 'right';
            c.fillText(`Óptimo ≥ ${threshold} ${unit}`, chartArea.right - 8, yPx - 4);
            c.restore();
        }
    };

    if (view === 'lines') {
        // Vista CURVAS: agrupado por rangos de litros
        const buckets = [
            { label: '≤ 3 L',     min: 0,    max: 3.09 },
            { label: '3.1 - 5 L', min: 3.1,  max: 5.09 },
            { label: '5.1 - 7 L', min: 5.1,  max: 7.09 },
            { label: '7.1 - 9 L', min: 7.1,  max: 9.09 },
            { label: '> 9 L',     min: 9.1,  max: 999.0 }
        ];

        const vacaData = [];
        const vacaCounts = [];
        const vaqData = [];
        const vaqCounts = [];

        buckets.forEach(b => {
            const inBucketVacas = vacas.filter(r => {
                const l = parseFloat(r.litros_calostro_madre);
                return l >= b.min && l <= b.max;
            });
            const inBucketVaq = vaquillonas.filter(r => {
                const l = parseFloat(r.litros_calostro_madre);
                return l >= b.min && l <= b.max;
            });

            if (inBucketVacas.length > 0) {
                const avg = inBucketVacas.reduce((acc, r) => acc + parseFloat(r.ig_calostro), 0) / inBucketVacas.length;
                vacaData.push(parseFloat(avg.toFixed(1)));
                vacaCounts.push(inBucketVacas.length);
            } else {
                vacaData.push(null);
                vacaCounts.push(0);
            }

            if (inBucketVaq.length > 0) {
                const avg = inBucketVaq.reduce((acc, r) => acc + parseFloat(r.ig_calostro), 0) / inBucketVaq.length;
                vaqData.push(parseFloat(avg.toFixed(1)));
                vaqCounts.push(inBucketVaq.length);
            } else {
                vaqData.push(null);
                vaqCounts.push(0);
            }
        });

        _dashCharts.chart_litros_calostro = new Chart(ctx, {
            type: 'line',
            plugins: [umbralPlugin],
            data: {
                labels: buckets.map(b => b.label),
                datasets: [
                    {
                        label: '🐄 Vacas',
                        data: vacaData,
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.08)',
                        borderWidth: 2.5,
                        tension: 0.35,
                        fill: false,
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        pointBackgroundColor: '#2563eb',
                        spanGaps: true,
                        counts: vacaCounts
                    },
                    {
                        label: '🐮 Vaquillonas',
                        data: vaqData,
                        borderColor: '#7c3aed',
                        backgroundColor: 'rgba(124, 58, 237, 0.08)',
                        borderWidth: 2.5,
                        tension: 0.35,
                        fill: false,
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        pointBackgroundColor: '#7c3aed',
                        spanGaps: true,
                        counts: vaqCounts
                    }
                ]
            },
            options: {
                ...CHART_DEFAULTS,
                plugins: {
                    ...CHART_DEFAULTS.plugins,
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            font: { family: 'Inter', size: 12, weight: 600 },
                            usePointStyle: true,
                            padding: 14,
                            color: theme.legendText
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(c) {
                                const ds = c.dataset;
                                const count = ds.counts ? ds.counts[c.dataIndex] : 0;
                                return ` ${ds.label}: ${c.raw} ${unit} (promedio de ${count} ${count === 1 ? 'parto' : 'partos'})`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Rango de Litros Cosechados', color: theme.textAxisTitle, font: { family: 'Inter', size: 11, weight: 600 } },
                        grid: { display: false },
                        ticks: { color: theme.textSecondary }
                    },
                    y: {
                        title: { display: true, text: `Calidad de Calostro (${unit})`, color: theme.textAxisTitle, font: { family: 'Inter', size: 11, weight: 600 } },
                        grid: { color: theme.gridFaint },
                        ticks: { color: theme.textSecondary },
                        suggestedMin: 10,
                        suggestedMax: 30
                    }
                }
            }
        });
    } else {
        // Vista PUNTOS (Scatter)
        const vacasPoints = vacas.map(r => ({
            x: parseFloat(r.litros_calostro_madre),
            y: parseFloat(r.ig_calostro),
            rp_madre: r.rp_madre || 'S/N',
            rp_ternero: r.rp_ternero || r.rp || 'S/N'
        }));

        const vaqPoints = vaquillonas.map(r => ({
            x: parseFloat(r.litros_calostro_madre),
            y: parseFloat(r.ig_calostro),
            rp_madre: r.rp_madre || 'S/N',
            rp_ternero: r.rp_ternero || r.rp || 'S/N'
        }));

        _dashCharts.chart_litros_calostro = new Chart(ctx, {
            type: 'scatter',
            plugins: [umbralPlugin],
            data: {
                datasets: [
                    {
                        label: '🐄 Vacas',
                        data: vacasPoints,
                        backgroundColor: 'rgba(37, 99, 235, 0.70)',
                        borderColor: '#2563eb',
                        borderWidth: 1.5,
                        pointRadius: 5,
                        pointHoverRadius: 7
                    },
                    {
                        label: '🐮 Vaquillonas',
                        data: vaqPoints,
                        backgroundColor: 'rgba(124, 58, 237, 0.70)',
                        borderColor: '#7c3aed',
                        borderWidth: 1.5,
                        pointRadius: 5,
                        pointHoverRadius: 7
                    }
                ]
            },
            options: {
                ...CHART_DEFAULTS,
                plugins: {
                    ...CHART_DEFAULTS.plugins,
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            font: { family: 'Inter', size: 12, weight: 600 },
                            usePointStyle: true,
                            padding: 14,
                            color: theme.legendText
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(c) {
                                const pt = c.raw;
                                const dsLabel = c.dataset.label;
                                return [
                                    ` ${dsLabel} · RP Madre: ${pt.rp_madre}`,
                                    ` Volumen: ${pt.x} Litros · Calidad: ${pt.y} ${unit}`,
                                    ` Ternero: ${pt.rp_ternero}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Litros de Calostro Producidos', color: theme.textAxisTitle, font: { family: 'Inter', size: 11, weight: 600 } },
                        grid: { color: theme.gridFaint },
                        ticks: { color: theme.textSecondary },
                        suggestedMin: 0,
                        suggestedMax: 12
                    },
                    y: {
                        title: { display: true, text: `Calidad de Calostro (${unit})`, color: theme.textAxisTitle, font: { family: 'Inter', size: 11, weight: 600 } },
                        grid: { color: theme.gridFaint },
                        ticks: { color: theme.textSecondary },
                        suggestedMin: 10,
                        suggestedMax: 30
                    }
                }
            }
        });
    }
}
window._renderLitrosCalostro = _renderLitrosCalostro;

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
let _tendenciaData = null;
let _tendenciaMode = 'semanal'; // 'dia' | 'semanal' | 'mensual'

function _renderTendenciaTemporal(data) {
    _tendenciaData = data;
    _buildTendenciaChart(data, _tendenciaMode);
}

function setTendenciaMode(mode) {
    _tendenciaMode = mode;
    // Actualizar botones
    const btnD = document.getElementById('btn-tendencia-dia');
    const btnS = document.getElementById('btn-tendencia-semanal');
    const btnM = document.getElementById('btn-tendencia-mensual');
    if (btnD) btnD.classList.toggle('active', mode === 'dia');
    if (btnS) btnS.classList.toggle('active', mode === 'semanal');
    if (btnM) btnM.classList.toggle('active', mode === 'mensual');
    // Actualizar subtítulo
    const sub = document.getElementById('tendencia-sub');
    if (sub) {
        if (mode === 'dia') {
            sub.textContent = 'Evolución diaria de la tasa de mortalidad (mes actual)';
        } else if (mode === 'semanal') {
            sub.textContent = 'Evolución semanal de la tasa de mortalidad';
        } else {
            sub.textContent = 'Evolución mensual de la tasa de mortalidad';
        }
    }
    if (_tendenciaData) _buildTendenciaChart(_tendenciaData, mode);
}
window.setTendenciaMode = setTendenciaMode;

function _buildTendenciaChart(data, mode) {
    const ctx = _getCtx('chart_tendencia');
    if (!ctx) return;

    // Destruir instancia anterior si existe
    if (_dashCharts.chart_tendencia) {
        _dashCharts.chart_tendencia.destroy();
        _dashCharts.chart_tendencia = null;
    }

    const grouped = {};
    let sourceRecords = data;

    if (mode === 'dia') {
        const now = new Date();
        const currYear = now.getFullYear();
        const currMonth = now.getMonth();
        const todayDay = now.getDate();

        // Inicializar todos los días del mes actual desde el 1 hasta el día actual
        for (let d = 1; d <= todayDay; d++) {
            const key = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            grouped[key] = { total: 0, muertos: 0 };
        }

        // Respetar filtros activos de productor y establecimiento sobre el dataset completo
        if (typeof records !== 'undefined' && Array.isArray(records)) {
            const { productor, establecimiento } = (typeof _dashFilters !== 'undefined') ? _dashFilters : {};
            sourceRecords = records.filter(r => {
                if (productor && r.productor !== productor) return false;
                if (establecimiento && r.establecimiento !== establecimiento) return false;
                return true;
            });
        }
    }

    sourceRecords.forEach(r => {
        if (!r.fecha) return;
        let key;
        if (mode === 'dia') {
            key = String(r.fecha).substring(0, 10);
            if (!grouped[key]) return; // Solo días del mes actual hasta hoy
        } else if (mode === 'mensual') {
            const d = new Date(r.fecha.includes('T') ? r.fecha : r.fecha + 'T12:00:00');
            key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        } else {
            // Clave: lunes de esa semana (YYYY-MM-DD)
            const d = new Date(r.fecha.includes('T') ? r.fecha : r.fecha + 'T12:00:00');
            const day = d.getDay();
            const diff = (day === 0) ? -6 : 1 - day;
            d.setDate(d.getDate() + diff);
            key = d.toISOString().split('T')[0];
        }
        if (!grouped[key]) grouped[key] = { total: 0, muertos: 0 };
        if (r.estado === 'Vivo' || _isMuertoGuachera(r)) {
            grouped[key].total++;
            if (_isMuertoGuachera(r)) grouped[key].muertos++;
        }
    });

    const limit = mode === 'mensual' ? 12 : (mode === 'dia' ? 31 : 26);
    const sorted = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0])).slice(-limit);

    const labels = sorted.map(([k]) => {
        if (mode === 'dia') {
            const [y, m, d] = k.split('-');
            const dateObj = new Date(+y, +m - 1, +d, 12, 0, 0);
            return dateObj.toLocaleDateString('es', { day: 'numeric', month: 'short' });
        }
        if (mode === 'mensual') {
            const [y, m] = k.split('-');
            // Solo nombre del mes, sin año
            return new Date(+y, +m - 1, 1).toLocaleDateString('es', { month: 'long' });
        }
        // Semanal: mostrar rango lunes–domingo (ej: "30 dic – 5 ene")
        const lunes = new Date(k + 'T00:00:00');
        const domingo = new Date(lunes);
        domingo.setDate(lunes.getDate() + 6);
        const fmt = d => d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
        return `${fmt(lunes)} – ${fmt(domingo)}`;
    });
    const tasas = sorted.map(([, v]) => v.total > 0 ? parseFloat((v.muertos / v.total * 100).toFixed(1)) : 0);
    const totales = sorted.map(([, v]) => v.total);
    const muertos = sorted.map(([, v]) => v.muertos);

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
                        label: ctx => {
                            if (ctx.datasetIndex === 0) {
                                return ` Tasa Mortalidad: ${ctx.raw}% (Muertos: ${muertos[ctx.dataIndex]})`;
                            }
                            return ` ${ctx.dataset.label}: ${ctx.raw}`;
                        }
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
                        maxTicksLimit: mode === 'dia' ? 31 : 14
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
        if (r.estado === 'Vivo' || _isMuertoGuachera(r)) {
            byEst[r.establecimiento].total++;
            if (_isMuertoGuachera(r)) byEst[r.establecimiento].muertos++;
        }
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

// ────────────────────────────────────────────────────────────────
// 9. Tipo y Dificultad de Parto — Donut Chart
// ────────────────────────────────────────────────────────────────
function _renderTipoParto(data) {
    const ctx = _getCtx('chart_parto');
    if (!ctx) return;

    const normal  = data.filter(r => (r.tipo_parto || 'Normal') === 'Normal').length;
    const asistido = data.filter(r => r.tipo_parto === 'Asistido').length;
    const muertoAlParto = data.filter(r => r.tipo_parto === 'Muerto al parto').length;

    const labels = muertoAlParto > 0 ? ['Normal', 'Asistido', 'Muerto al parto'] : ['Normal', 'Asistido'];
    const chartData = muertoAlParto > 0 ? [normal, asistido, muertoAlParto] : [normal, asistido];
    const bgColors = muertoAlParto > 0 
        ? [PALETTE.secondary + 'cc', PALETTE.warning + 'cc', PALETTE.danger + 'cc']
        : [PALETTE.secondary + 'cc', PALETTE.warning + 'cc'];
    const borderColors = muertoAlParto > 0
        ? [PALETTE.secondary, PALETTE.warning, PALETTE.danger]
        : [PALETTE.secondary, PALETTE.warning];

    _dashCharts.chart_parto = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: chartData,
                backgroundColor: bgColors,
                borderColor: borderColors,
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
// 10. Pérdidas Gestacionales y Perinatales — Donut Chart
// ────────────────────────────────────────────────────────────────
function _renderPerinatal(data) {
    const ctx = _getCtx('chart_perinatal');
    if (!ctx) return;

    const wrap = document.getElementById('chart_perinatal_wrap');
    const oldOverlay = wrap ? wrap.querySelector('.dash-no-data-overlay') : null;
    if (oldOverlay) oldOverlay.remove();

    const abortos = data.filter(r => r.estado === 'Aborto').length;
    const nacidosMuertos = data.filter(r => r.estado === 'Nacido muerto' || (r.tipo_parto === 'Muerto al parto' && r.estado === 'Muerto en Establecimiento')).length;
    const periparto = data.filter(r => r.estado === 'Muerto al periparto').length;
    const totalPerinatal = abortos + nacidosMuertos + periparto;

    const sub = document.getElementById('perinatal-sub');
    if (sub) {
        if (totalPerinatal > 0) {
            sub.innerHTML = `<strong>${totalPerinatal}</strong> en total · Abortos: <strong>${abortos}</strong> · Nacidos muertos: <strong>${nacidosMuertos}</strong> · Periparto: <strong>${periparto}</strong>`;
        } else {
            sub.textContent = 'Abortos · Nacidos muertos · Periparto (< 24 hs)';
        }
    }

    if (totalPerinatal === 0) {
        if (wrap) {
            wrap.style.position = 'relative';
            const overlay = document.createElement('div');
            overlay.className = 'dash-no-data-overlay';
            overlay.innerHTML = `
                <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                            background:rgba(255,255,255,0.85);border-radius:12px;z-index:5;flex-direction:column;gap:6px;">
                    <span style="font-size:2rem;">✅</span>
                    <span style="color:#16a34a;font-size:0.92rem;font-weight:700;">Sin pérdidas perinatales</span>
                    <span style="font-size:0.75rem;color:#64748b;text-align:center;max-width:240px;">
                        No se registran abortos ni muertes al parto en este período.
                    </span>
                </div>`;
            wrap.appendChild(overlay);
        }
    }

    _dashCharts.chart_perinatal = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Abortos (gestación)', 'Nacidos muertos (al parto)', 'Periparto (< 24 hs)'],
            datasets: [{
                data: [abortos, nacidosMuertos, periparto],
                backgroundColor: ['rgba(139, 92, 246, 0.8)', 'rgba(239, 68, 68, 0.8)', 'rgba(245, 158, 11, 0.8)'],
                borderColor: ['#8b5cf6', '#ef4444', '#f59e0b'],
                borderWidth: 2,
                hoverOffset: 6,
            }]
        },
        options: {
            ...CHART_DEFAULTS,
            cutout: '65%',
            plugins: {
                ...CHART_DEFAULTS.plugins,
                legend: {
                    ...CHART_DEFAULTS.plugins?.legend,
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 10,
                        font: { size: 10, family: 'Inter' },
                        color: _getChartTheme().legendText
                    }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const val = ctx.raw;
                            const pct = totalPerinatal > 0 ? ((val / totalPerinatal) * 100).toFixed(1) : 0;
                            return ` ${ctx.label}: ${val} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}


// ═══════════════════════════════════════════════════════════════
// SORTABLE CHART BLOCKS — drag & drop reorder + editable titles
// ═══════════════════════════════════════════════════════════════

(function initChartSortable() {
    var LS_ORDER  = 'vf_chart_block_order';
    var LS_TITLES = 'vf_chart_titles';
    var _syncTimer = null;

    function syncToCloud() {
        clearTimeout(_syncTimer);
        _syncTimer = setTimeout(function() {
            var order = JSON.parse(localStorage.getItem(LS_ORDER) || 'null');
            var titles = JSON.parse(localStorage.getItem(LS_TITLES) || '{}');
            var kpis = JSON.parse(localStorage.getItem(_KPI_THRESHOLDS_KEY) || 'null');
            if (typeof AuthManager !== 'undefined' && typeof AuthManager.saveDashboardConfig === 'function') {
                AuthManager.saveDashboardConfig({ order: order, titles: titles, kpiThresholds: kpis });
            }
        }, 500);
    }

    function restoreOrder(customOrder) {
        var saved = customOrder || JSON.parse(localStorage.getItem(LS_ORDER) || 'null');
        if (!saved || !Array.isArray(saved)) return;
        var container = document.getElementById('charts-sortable');
        if (!container) return;
        saved.forEach(function(id) {
            var el = container.querySelector('[data-chart-id="' + id + '"]');
            if (el) container.appendChild(el);
        });
    }

    function restoreTitles(customTitles) {
        var saved = customTitles || JSON.parse(localStorage.getItem(LS_TITLES) || '{}');
        Object.keys(saved).forEach(function(key) {
            var el = document.querySelector('[data-title-key="' + key + '"]');
            if (el && saved[key]) el.textContent = saved[key];
        });
    }

    window.restoreDashboardOrderAndTitles = function(customOrder, customTitles, customKpiThresholds) {
        if (customOrder && Array.isArray(customOrder) && customOrder.length > 0) {
            localStorage.setItem(LS_ORDER, JSON.stringify(customOrder));
        }
        if (customTitles && typeof customTitles === 'object' && Object.keys(customTitles).length > 0) {
            localStorage.setItem(LS_TITLES, JSON.stringify(customTitles));
        }
        if (customKpiThresholds && typeof customKpiThresholds === 'object' && Object.keys(customKpiThresholds).length > 0) {
            localStorage.setItem(_KPI_THRESHOLDS_KEY, JSON.stringify(customKpiThresholds));
        }
        restoreOrder(customOrder);
        restoreTitles(customTitles);
        _kpiThresholds = _loadKpiThresholds(customKpiThresholds);
        _initKpiPanelInputs();
        const data = _getDashRecords();
        if (data && data.length > 0) {
            _renderKPIs(data);
        }
    };

    function saveOrder() {
        var container = document.getElementById('charts-sortable');
        if (!container) return;
        var ids = Array.from(container.querySelectorAll('.chart-block')).map(function(b) {
            return b.dataset.chartId;
        });
        localStorage.setItem(LS_ORDER, JSON.stringify(ids));
        syncToCloud();
    }

    function saveTitle(key, value) {
        var saved = JSON.parse(localStorage.getItem(LS_TITLES) || '{}');
        saved[key] = value;
        localStorage.setItem(LS_TITLES, JSON.stringify(saved));
        syncToCloud();
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
                filter: '.btn-causa-detail-header, .chart-info-btn, .chart-edit-title-btn, button, input, select, textarea, [contenteditable]',
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

// ────────────────────────────────────────────────────────────────
// Helper: Alternar tema de gráficos para exportación a PDF (alto contraste en negro)
// ────────────────────────────────────────────────────────────────
function _setChartsForExport(forPdf = true) {
    if (forPdf) {
        // 1. Modo PDF: Forzar texto principal, ejes y leyendas a negro (#000000)
        Object.values(_dashCharts).forEach(c => {
            if (!c) return;
            if (c.options?.plugins?.legend?.labels) {
                c.options.plugins.legend.labels.color = '#000000';
            }
            if (c.options?.scales) {
                Object.values(c.options.scales).forEach(s => {
                    if (!s) return;
                    if (s.ticks) s.ticks.color = '#000000';
                    if (s.title) s.title.color = '#000000';
                    if (s.grid)  s.grid.color  = '#e2e8f0';
                });
            }
        });

        if (_dashCharts.chart_tendencia) {
            const c = _dashCharts.chart_tendencia;
            if (c.data?.datasets?.[1]) {
                c.data.datasets[1].borderColor = PALETTE.primary;
                c.data.datasets[1].pointBackgroundColor = PALETTE.primary;
            }
            if (c.options?.scales?.y?.ticks) {
                c.options.scales.y.ticks.color = '#b91c1c'; // Rojo oscuro de alta legibilidad
            }
            if (c.options?.scales?.y1?.ticks) {
                c.options.scales.y1.ticks.color = '#000000';
            }
        }

        if (_dashCharts.chart_causas) {
            const c = _dashCharts.chart_causas;
            if (c.options?.scales?.y?.ticks) c.options.scales.y.ticks.color = '#000000';
            if (c.options?.scales?.x?.ticks) c.options.scales.x.ticks.color = '#000000';
        }

        if (_dashCharts.chart_madre) {
            const c = _dashCharts.chart_madre;
            if (c.options?.scales?.x?.ticks) c.options.scales.x.ticks.color = '#000000';
            if (c.options?.scales?.y?.ticks) c.options.scales.y.ticks.color = '#000000';
        }

        if (_dashCharts.chart_calostro) {
            const c = _dashCharts.chart_calostro;
            if (c.options?.scales?.x?.title) c.options.scales.x.title.color = '#000000';
            if (c.options?.scales?.y?.title) c.options.scales.y.title.color = '#000000';
            if (c.options?.scales?.x?.ticks) c.options.scales.x.ticks.color = '#000000';
            if (c.options?.scales?.y?.ticks) c.options.scales.y.ticks.color = '#000000';
        }

        if (_dashCharts.chart_brix_salud) {
            const c = _dashCharts.chart_brix_salud;
            if (c.options?.scales?.x?.title) c.options.scales.x.title.color = '#000000';
            if (c.options?.scales?.y?.title) c.options.scales.y.title.color = '#000000';
            if (c.options?.scales?.x?.ticks) c.options.scales.x.ticks.color = '#000000';
            if (c.options?.scales?.y?.ticks) c.options.scales.y.ticks.color = '#000000';
        }

        if (_dashCharts.chart_litros_calostro) {
            const c = _dashCharts.chart_litros_calostro;
            if (c.options?.scales?.x?.title) c.options.scales.x.title.color = '#000000';
            if (c.options?.scales?.y?.title) c.options.scales.y.title.color = '#000000';
            if (c.options?.scales?.x?.ticks) c.options.scales.x.ticks.color = '#000000';
            if (c.options?.scales?.y?.ticks) c.options.scales.y.ticks.color = '#000000';
        }

        if (_dashCharts.chart_sexo) {
            const c = _dashCharts.chart_sexo;
            if (c.options?.scales?.x?.ticks) c.options.scales.x.ticks.color = '#000000';
            if (c.options?.scales?.y?.ticks) c.options.scales.y.ticks.color = '#000000';
            if (c.data?.datasets?.[0]) {
                c.data.datasets[0].backgroundColor = [PALETTE.primary + 'cc', PALETTE.pink + 'cc'];
                c.data.datasets[0].borderColor = [PALETTE.primary, PALETTE.pink];
            }
        }

        Object.values(_dashCharts).forEach(c => {
            if (c) c.update('none');
        });
    } else {
        // 2. Restaurar el tema de pantalla activo (Oscuro o Claro)
        if (typeof window.updateChartsTheme === 'function') {
            window.updateChartsTheme(_isDarkMode());
        }
    }
}

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
            // Aplicar tema de alto contraste para PDF (textos, leyendas y ejes en negro)
            _setChartsForExport(true);

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            
            // Título
            doc.setFontSize(18);
            doc.setTextColor(0);
            doc.text("Reporte Analítico - VETFIELD PRO", 14, 20);
            
            // Fecha y Filtros
            doc.setFontSize(10);
            doc.setTextColor(50);
            doc.text(`Fecha de generación: ${new Date().toLocaleDateString()}`, 14, 28);
            
            let filtrosStr = [];
            if (_dashFilters.desde) filtrosStr.push(`Desde: ${_dashFilters.desde}`);
            if (_dashFilters.hasta) filtrosStr.push(`Hasta: ${_dashFilters.hasta}`);
            if (_dashFilters.productor) filtrosStr.push(`Productor: ${_dashFilters.productor}`);
            if (_dashFilters.establecimiento) filtrosStr.push(`Establecimiento: ${_dashFilters.establecimiento}`);
            
            if (filtrosStr.length > 0) {
                doc.setFontSize(9);
                doc.setTextColor(40);
                doc.text(`Filtros: ${filtrosStr.join(' | ')}`, 14, 34);
            }
            
            let yPos = 42;
            const pageWidth = doc.internal.pageSize.getWidth();

            // ─── TARJETAS KPI ────────────────────────────────────────────
            // Leer valores desde el DOM
            const _kpiTotal      = document.getElementById('kpi_total')?.textContent?.trim() || '-';
            const _kpiTotalSub   = document.getElementById('kpi_total_sub')?.textContent?.trim() || '';
            const _kpiMort       = document.getElementById('kpi_mortalidad')?.textContent?.trim() || '-';
            const _kpiMortBadge  = document.getElementById('kpi_mortalidad_badge')?.textContent?.trim() || '';
            const _kpiIg         = document.getElementById('kpi_ig')?.textContent?.trim() || '-';
            const _kpiIgSub      = document.getElementById('kpi_ig_sub')?.textContent?.trim() || '';
            const _kpiIgMadre    = document.getElementById('kpi_ig_madre')?.textContent?.trim() || '-';
            const _kpiIgMadreSub = document.getElementById('kpi_ig_madre_sub')?.textContent?.trim() || '';
            const _kpiRecup      = document.getElementById('kpi_recuperacion')?.textContent?.trim() || '-';
            const _kpiRecupSub   = document.getElementById('kpi_recuperacion_sub')?.textContent?.trim() || '';

            // Detectar estados de color para mortalidad e IG
            const _mortCard      = document.getElementById('kpi_mortalidad_card');
            const _igCard        = document.getElementById('kpi_ig_card');
            const _igMadreCard   = document.getElementById('kpi_ig_madre_card');
            const _mortIsDanger  = _mortCard?.classList.contains('kpi-danger');
            const _mortIsWarning = _mortCard?.classList.contains('kpi-warning');
            const _igIsSuccess   = _igCard?.classList.contains('kpi-state--success');
            const _igIsWarning   = _igCard?.classList.contains('kpi-state--warning');
            const _igIsDanger    = _igCard?.classList.contains('kpi-state--danger');
            const _igMadreIsSuccess = _igMadreCard?.classList.contains('kpi-state--success');
            const _igMadreIsWarning = _igMadreCard?.classList.contains('kpi-state--warning');
            const _igMadreIsDanger  = _igMadreCard?.classList.contains('kpi-state--danger');

            // Colores por estado
            const _colorMort     = _mortIsDanger ? [220, 38, 38] : _mortIsWarning ? [234, 88, 12] : [22, 163, 74];
            const _colorIg       = _igIsSuccess  ? [22, 163, 74] : _igIsWarning  ? [234, 88, 12] : _igIsDanger ? [220, 38, 38] : [99, 102, 241];
            const _colorIgMadre  = _igMadreIsSuccess ? [22, 163, 74] : _igMadreIsWarning ? [234, 88, 12] : _igMadreIsDanger ? [220, 38, 38] : [99, 102, 241];
            const _colorTotal    = [99, 102, 241];   // índigo (neutro)
            const _colorRecup    = [99, 102, 241];   // índigo (neutro, como la UI)

            // Layout: tarjetas en fila
            const _kpiCards = [
                { label: 'TOTAL EVALUADOS',       value: _kpiTotal,     sub: _kpiTotalSub,     color: _colorTotal },
                { label: 'TASA DE MORTALIDAD',    value: _kpiMort,      sub: _kpiMortBadge,    color: _colorMort  },
                { label: 'PROMEDIO I.G. TERNERO', value: _kpiIg,        sub: _kpiIgSub,        color: _colorIg    },
                { label: 'PROMEDIO I.G. MADRE',   value: _kpiIgMadre,   sub: _kpiIgMadreSub,   color: _colorIgMadre },
                { label: 'TASA DE SUPERVIVENCIA', value: _kpiRecup,     sub: _kpiRecupSub,     color: _colorRecup },
            ];

            const _cardMargin = 4;
            const _cardCount  = _kpiCards.length;
            const _cardW      = (pageWidth - 14 - (_cardCount - 1) * _cardMargin - 14) / _cardCount;
            const _cardH      = 28;
            let _cardX        = 14;

            _kpiCards.forEach(kpi => {
                const [r, g, b] = kpi.color;

                // Fondo blanco con borde sutil
                doc.setDrawColor(220, 220, 230);
                doc.setFillColor(255, 255, 255);
                doc.roundedRect(_cardX, yPos, _cardW, _cardH, 3, 3, 'FD');

                // Barra lateral de color (izquierda)
                doc.setFillColor(r, g, b);
                doc.roundedRect(_cardX, yPos, 2.5, _cardH, 1, 1, 'F');

                // Etiqueta pequeña
                doc.setFontSize(6);
                doc.setTextColor(120, 120, 140);
                doc.text(kpi.label, _cardX + 5, yPos + 7);

                // Valor principal grande
                doc.setFontSize(14);
                doc.setTextColor(r, g, b);
                doc.text(kpi.value, _cardX + 5, yPos + 17);

                // Subtexto
                if (kpi.sub) {
                    doc.setFontSize(6.5);
                    doc.setTextColor(100, 100, 120);
                    doc.text(kpi.sub, _cardX + 5, yPos + 23);
                }

                _cardX += _cardW + _cardMargin;
            });

            yPos += _cardH + 10; // Espacio debajo de las tarjetas
            // ─────────────────────────────────────────────────────────────

            // Recorrer los bloques en el orden actual
            const blocks = document.querySelectorAll('.chart-block');
            
            blocks.forEach(block => {
                const charts = block.querySelectorAll('.db-chart-card');
                charts.forEach(card => {
                    const titleEl = card.querySelector('.db-chart-title');
                    let title = titleEl ? titleEl.textContent.trim() : 'Gráfico';
                    // Limpiar emojis para evitar caracteres corruptos en jsPDF (ej: Ø=ÜÈ)
                    title = title.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
                    
                    const canvas = card.querySelector('canvas');
                    
                    if (canvas) {
                        const chartInstance = window.Chart ? window.Chart.getChart(canvas) : null;
                        const isDoughnut = chartInstance?.config?.type === 'doughnut' || canvas.id === 'chart_ombligos';
                        const rawRatio = canvas.height / canvas.width;
                        // Si es un donut de ancho completo (ratio bajo), su ratio final será 0.40 para igualar a los otros
                        const effectiveRatio = (isDoughnut && rawRatio < 0.35) ? 0.40 : rawRatio;
                        const estHeight = (pageWidth - 28) * effectiveRatio;

                        if (yPos + estHeight + 12 > 280 || yPos > 240) {
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

                        // 2. Dibujar el gráfico con tema PDF (textos y números en negro)
                        tCtx.drawImage(canvas, 0, 0);

                        // ─── FIX CRÍTICO: Corregir el espacio de coordenadas ──────────────
                        const _dpr = window.devicePixelRatio || 1;
                        tCtx.scale(_dpr, _dpr);

                        // 3. Dibujar etiquetas de datos visibles para el PDF (en negro)
                        if (chartInstance) {
                            const chartId = canvas.id;

                            chartInstance.data.datasets.forEach((dataset, i) => {
                                const meta = chartInstance.getDatasetMeta(i);
                                if (meta.hidden) return;

                                meta.data.forEach((element, index) => {
                                    const dataVal = dataset.data[index];
                                    if (dataVal === null || dataVal === undefined || dataVal === 0 || dataVal === '0.0') return;

                                    // ── Gráficos de dispersión (Scatter) o puntos con coordenadas {x, y} ──
                                    // No dibujar etiquetas numéricas sobre puntos para que queden completamente limpios y visibles,
                                    // y evitar la sobreimpresión de "[object Object]" que tapa los puntos del gráfico.
                                    const isScatter = chartInstance.config?.type === 'scatter' ||
                                                      (typeof dataVal === 'object' && dataVal !== null) ||
                                                      chartId === 'chart_calostro' ||
                                                      chartId === 'chart_brix_salud' ||
                                                      (chartId === 'chart_litros_calostro' && typeof dataVal === 'object');
                                    if (isScatter) return;

                                    let text          = String(dataVal);
                                    let pos           = element.tooltipPosition ? element.tooltipPosition() : { x: element.x, y: element.y };
                                    let align         = 'center';
                                    let drawBg        = false;
                                    let bgBorderColor = '#94a3b8';
                                    let customYOffset = 0;
                                    let customXOffset = 0;
                                    let textColor     = '#000000'; // Todo texto y número en negro por defecto
                                    let strokeColor   = '#ffffff'; // Contorno blanco para contraste sobre barras/gajos
                                    let fontSize      = 12;

                                    // ── Tendencia Temporal (line) ─────────────────────────
                                    if (chartId === 'chart_tendencia') {
                                        if (i === 0) {
                                            // Tasa Mortalidad → muertes absolutas, centradas sobre el nodo con el color de su línea
                                            const total = chartInstance.data.datasets[1]?.data[index] ?? 0;
                                            text = String(Math.round((parseFloat(dataVal) / 100) * (total || 1)));
                                            customYOffset = -18;
                                            textColor     = PALETTE.danger; // Rojo de la línea de mortalidad (#dc2626)
                                            bgBorderColor = PALETTE.danger; // Borde distintivo a juego
                                            strokeColor   = null;
                                            drawBg        = true;
                                        } else {
                                            // Total evaluados → debajo del nodo con el color de su línea
                                            customYOffset = 18;
                                            textColor     = PALETTE.primary; // Azul de la línea de total evaluados (#1a237e)
                                            bgBorderColor = PALETTE.primary; // Borde distintivo a juego
                                            strokeColor   = null;
                                            drawBg        = true;
                                        }
                                        fontSize = 11;

                                    // ── Causas de Muerte (bar horizontal) ────────────────
                                    } else if (chartId === 'chart_causas') {
                                        const barEnd = element.x ?? pos.x;
                                        pos = { x: barEnd, y: pos.y };
                                        align         = 'right';
                                        customXOffset = -8;
                                        textColor     = '#000000';
                                        strokeColor   = '#ffffff';
                                        fontSize      = 11;

                                    // ── Donuts: Ubicación, Ombligos, Parto y Perinatal ─────
                                    } else if (chartId === 'chart_ubicacion' || chartId === 'chart_ombligos' || chartId === 'chart_parto' || chartId === 'chart_perinatal') {
                                        const total   = chartInstance.data.datasets[0].data.reduce((a, b) => a + b, 0);
                                        const pct     = total > 0 ? ((dataVal / total) * 100).toFixed(0) : 0;
                                        text          = `${dataVal}\n(${pct}%)`;
                                        textColor     = '#000000';
                                        strokeColor   = '#ffffff';
                                        fontSize      = 11;

                                    // ── Desempeño por Tipo de Madre (bar stacked) ────────
                                    } else if (chartId === 'chart_madre') {
                                        const elH = element.height ?? 0;
                                        if (elH <= 24) {
                                            align         = 'left';
                                            customXOffset = (element.width ?? 30) / 2 + 6;
                                            textColor     = '#000000';
                                            strokeColor   = null;
                                            drawBg        = true;
                                        } else {
                                            textColor   = '#000000';
                                            strokeColor = '#ffffff';
                                        }
                                        fontSize = 12;

                                    // ── Mortalidad por Sexo (bar grouped) ───────────────
                                    } else if (chartId === 'chart_sexo') {
                                        const elH = element.height ?? 0;
                                        if (elH <= 24) {
                                            align         = 'left';
                                            customXOffset = (element.width ?? 30) / 2 + 6;
                                            textColor     = '#000000';
                                            strokeColor   = null;
                                            drawBg        = true;
                                        } else {
                                            textColor   = '#000000';
                                            strokeColor = '#ffffff';
                                        }
                                        text    = dataVal + '%';
                                        fontSize = 12;

                                    // ── Volumen vs Calidad de Calostro (modo líneas / promedios) ─
                                    } else if (chartId === 'chart_litros_calostro') {
                                        const isBrix = typeof _getIgMetodo === 'function' ? _getIgMetodo() === 'brix' : true;
                                        const unit = isBrix ? '%' : '';
                                        text = `${dataVal}${unit}`;
                                        customYOffset = (i === 0) ? -14 : 14;
                                        textColor = (i === 0) ? '#2563eb' : '#7c3aed';
                                        strokeColor = '#ffffff';
                                        fontSize = 10;
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
                                        const bgH  = lineH * lines.length + 6;
                                        let bgX    = finalX;
                                        if (align === 'center') bgX -= maxW / 2;
                                        else if (align === 'right') bgX -= maxW;
                                        tCtx.fillStyle   = 'rgba(255, 255, 255, 0.95)';
                                        tCtx.strokeStyle = bgBorderColor || '#94a3b8';
                                        tCtx.lineWidth   = 1;
                                        if (tCtx.roundRect) {
                                            tCtx.beginPath();
                                            tCtx.roundRect(bgX - 4, finalY - bgH / 2, maxW + 8, bgH, 4);
                                            tCtx.fill();
                                            tCtx.stroke();
                                        } else {
                                            tCtx.fillRect(bgX - 4, finalY - bgH / 2, maxW + 8, bgH);
                                            tCtx.strokeRect(bgX - 4, finalY - bgH / 2, maxW + 8, bgH);
                                        }
                                    }

                                    lines.forEach((line, li) => {
                                        const ly = finalY + (li - (lines.length - 1) / 2) * lineH;
                                        if (strokeColor) {
                                            tCtx.strokeStyle = strokeColor;
                                            tCtx.lineWidth   = 3;
                                            tCtx.strokeText(line, finalX, ly);
                                        }
                                        tCtx.fillStyle = textColor;
                                        tCtx.fillText(line, finalX, ly);
                                    });

                                    tCtx.restore();
                                });
                            });
                        }

                        // ── Normalización de tamaño para gráficos redondos (Donuts) ──
                        // En la UI, chart_ombligos está en un bloque de 100% de ancho (~1100px) con altura de 220px (ratio ~0.20),
                        // mientras que los otros donuts (ubicación, parto, perinatal) están en bloques de 2 columnas (~550px, ratio ~0.40).
                        // Al estirar a ancho de página en el PDF, chart_ombligos quedaba con altura de apenas ~35mm y un donut enano de ~29mm.
                        // Recortamos el exceso de blanco lateral centrándonos en el donut para que su ratio sea 0.40 exacto,
                        // resultando en una altura de ~73mm y un donut de ~60mm, idéntico a todos los demás gráficos redondos.
                        let canvasToExport = tempCanvas;
                        const currentRatio = tempCanvas.height / tempCanvas.width;

                        if (isDoughnut && currentRatio < 0.35) {
                            const targetRatio = 0.40; // Proporción estándar de 2 columnas (220/550)
                            const targetW = tempCanvas.height / targetRatio;
                            if (tempCanvas.width > targetW) {
                                const cropCanvas = document.createElement('canvas');
                                cropCanvas.width = Math.round(targetW);
                                cropCanvas.height = tempCanvas.height;
                                const cCtx = cropCanvas.getContext('2d');
                                cCtx.fillStyle = '#ffffff';
                                cCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
                                const cropX = Math.round((tempCanvas.width - targetW) / 2);
                                cCtx.drawImage(
                                    tempCanvas,
                                    cropX, 0, cropCanvas.width, cropCanvas.height,
                                    0, 0, cropCanvas.width, cropCanvas.height
                                );
                                canvasToExport = cropCanvas;
                            }
                        }

                        const imgData = canvasToExport.toDataURL('image/png', 1.0);
                        
                        const pdfWidth = pageWidth - 28;
                        const canvasRatio = canvasToExport.height / canvasToExport.width;
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
                            styles: { font: 'helvetica', fontSize: 9, textColor: [0, 0, 0] },
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
            
            // Restaurar tema original de los gráficos
            _setChartsForExport(false);

            doc.save('Vetfield_Reporte_Analitico.pdf');
        } catch(e) {
            console.error('Error exporting PDF:', e);
            alert('Hubo un error al generar el PDF.');
        } finally {
            _setChartsForExport(false);
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

    if (_dashCharts.chart_brix_salud) {
        const c = _dashCharts.chart_brix_salud;
        if (c.options?.scales?.x?.ticks) c.options.scales.x.ticks.color = theme.textSecondary;
        if (c.options?.scales?.y?.ticks) c.options.scales.y.ticks.color = theme.textSecondary;
        if (c.options?.scales?.x?.grid) c.options.scales.x.grid.color = theme.gridFaint;
        if (c.options?.scales?.y?.grid) c.options.scales.y.grid.color = theme.gridFaint;
        if (c.options?.scales?.x?.title) c.options.scales.x.title.color = theme.textAxisTitle;
        if (c.options?.scales?.y?.title) c.options.scales.y.title.color = theme.textAxisTitle;
        if (c.options?.plugins?.legend?.labels) c.options.plugins.legend.labels.color = theme.legendText;
        c.update();
    }

    if (_dashCharts.chart_litros_calostro) {
        const c = _dashCharts.chart_litros_calostro;
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
