'use strict';
// ================================================================
// VETFIELD PRO — voice.js
// Módulo independiente de Registro por Voz
// ================================================================

// ── IndexedDB: cola offline de registros de voz ──────────────
const VDB = {
    name: 'vf_voice_db', version: 1, storeName: 'voice_queue',
    _db: null,
    open() {
        return new Promise((res, rej) => {
            if (this._db) return res(this._db);
            const req = indexedDB.open(this.name, this.version);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = e => { this._db = e.target.result; res(this._db); };
            req.onerror = e => rej(e.target.error);
        });
    },
    async add(record) {
        const db = await this.open();
        return new Promise((res, rej) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const req = tx.objectStore(this.storeName).add({ ...record, status: 'pending', timestamp: new Date().toISOString() });
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    },
    async getAll() {
        const db = await this.open();
        return new Promise((res, rej) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const req = tx.objectStore(this.storeName).getAll();
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    },
    async delete(id) {
        const db = await this.open();
        return new Promise((res, rej) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const req = tx.objectStore(this.storeName).delete(id);
            req.onsuccess = () => res();
            req.onerror = () => rej(req.error);
        });
    },
    async count() {
        const all = await this.getAll();
        return all.filter(r => r.status === 'pending').length;
    }
};

// ── Capa de Sanitización de Texto ────────────────────────────
// Whisper ya entrega números como dígitos gracias al prompt de contexto.
// Esta capa solo normaliza casos residuales y siglas.
function voice_sanitizeTranscript(text) {
    let t = text;
    // Decimales con coma escrita → punto (ej: "2,5" o "2 con 5")
    t = t.replace(/(\d+)\s*[,.]\s*(\d+)/g, '$1.$2');
    t = t.replace(/(\d+)\s+(?:coma|con|punto)\s+(\d+)/gi, '$1.$2');
    // Normalizar siglas fonéticas y abreviaturas aisladas
    t = t.replace(/(^|\s)(?:y\.?\s*g\.?|i\.?\s*g\.?|ige)(?=\s|[.,:;\-]|$)/gi, '$1ig');
    t = t.replace(/(^|\s)(?:erre\s*pe|r\.?\s*p\.?|erre\s*p)(?=\s|[.,:;\-]|$)/gi, '$1rp');
    return t.toLowerCase();
}

// ── AI Mapper: reglas regex en español veterinario ────────────
const VoiceMapper = {
    map(text) {
        const t = voice_sanitizeTranscript(text);
        const d = {};

        // ── Fecha: hoy por defecto ────────────────────────────────
        const hoy = new Date();
        d.fecha = hoy.toISOString().split('T')[0];

        // ── Productor ─────────────────────────────────────────────
        const prodMatch = t.match(/\bproductor\b[\s,.]*([\w\s\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00f1]{2,35}?)(?=\s*[,.]|\s+establecimiento|\s+rp\b|\s+ig\b|\s+sexo|\s+ombligo|\s+estado|\s+madre|\s+caravana|\s*$)/i);
        if (prodMatch) d.productor = prodMatch[1].trim().replace(/\b\w/g, c => c.toUpperCase());

        // ── Establecimiento ───────────────────────────────────────
        const estMatch = t.match(/\bestablecimiento\b[\s,.]*([\w\s\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00f1\d]{2,35}?)(?=\s*[,.]|\s+productor|\s+rp\b|\s+ig\b|\s+sexo|\s+ombligo|\s+estado|\s+madre|\s*$)/i);
        if (estMatch) d.establecimiento = estMatch[1].trim().replace(/\b\w/g, c => c.toUpperCase());

        // ── RP Ternero ────────────────────────────────────────────
        const rpTMatch = t.match(/\b(?:rp|caravana)\s*(?:del?\s*)?ternero[\s,.:\-]*(?:es\s+|era\s+|de\s+)?([\w\-\/]{1,20})/i);
        if (rpTMatch) d.rp_ternero = rpTMatch[1].trim().toUpperCase();

        // ── IG Ternero ────────────────────────────────────────────
        const igTMatch = t.match(/\b(?:ig|inmunoglobulinas?)\s*(?:del?\s*)?ternero[\s,.:\-]*(?:es\s+|era\s+|de\s+)?([\d.]+)\.?/i);
        // Eliminar punto final residual que puede agregar la IA (ej: "2.5." → "2.5")
        if (igTMatch) d.ig_ternero = igTMatch[1].replace(/\.$/, '');

        // ── IG Calostro / IG Madre ────────────────────────────────
        const igMadreMatch = t.match(/\b(?:ig\s*(?:de\s+(?:la\s+)?)?madre|ig\s*(?:del?\s*)?calostro|calostro\s*(?:de\s+(?:la\s+)?)?madre|calidad\s+(?:del?\s*)?calostro|inmunoglobulinas?\s*(?:de\s+(?:la\s+)?)?madre|inmunoglobulinas?\s*(?:del?\s*)?calostro|calostro|inmunoglobulinas?)[\s,.:\-]*(?:es\s+|era\s+|de\s+)?([\d.]+)\.?/i);
        // Eliminar punto final residual que puede agregar la IA (ej: "2.8." → "2.8")
        if (igMadreMatch) d.ig_calostro = igMadreMatch[1].replace(/\.$/, '');

        // ── RP Madre ──────────────────────────────────────────────
        const rpMMatch = t.match(/\b(?:rp|caravana)\s*(?:de\s+(?:la\s+)?)?madre[\s,.:\-]*(?:es\s+|era\s+|de\s+)?([\w\-\/]{1,20})/i);
        if (rpMMatch) d.rp_madre = rpMMatch[1].trim().toUpperCase();

        // ── Sexo ──────────────────────────────────────────────────
        if (/\b(?:sexo\s+)?(?:macho|toro|torito)\b/i.test(t)) d.sexo = 'Macho';
        else if (/\b(?:sexo\s+)?(?:hembra|ternera)\b/i.test(t)) d.sexo = 'Hembra';

        // ── Ombligo ───────────────────────────────────────────────
        if (/\bombligo\s+(?:mal[o]?|infect|hinchad)/i.test(t)) d.ombligo = 'Malo';
        else if (/\bombligo\s+regul/i.test(t)) d.ombligo = 'Regular';
        else if (/\bombligo\s+(?:bien|buen|normal|limpi)/i.test(t)) d.ombligo = 'Bueno';

        // ── Tipo Madre ────────────────────────────────────────────
        if (/\bvaquillon[ae]?\b/i.test(t)) d.tipo_madre = 'Vaquillona';
        else if (/\b(?:tipo\s+madre\s+)?vaca\b/i.test(t)) d.tipo_madre = 'Vaca';

        // ── Estado (orden: más específico → menos específico) ─────
        // 'huachera' cubre la transcripción alternativa de Whisper para 'guachera'
        // 'lugar guachera/huachera' cubre el patrón dictado "Estado muerto, Lugar guachera"
        if (/\b(?:lugar\s+)?(?:guacher[ií]?as?|huacher[ií]?as?)\b/i.test(t)) {
            d.estado = 'Muerto en Guachería';
        } else if (/\b(?:lugar\s+)?terapia\b/i.test(t)) {
            d.estado = 'Muerto en Terapia';
        } else if (/\bmuert[ao]\s*(?:en\s+(?:el\s+)?)?establecimiento\b/i.test(t)) {
            d.estado = 'Muerto en Establecimiento';
        } else if (/\b(?:muert[ao]|falleci[o\u00f3]|baj[a\u00f3])\b/i.test(t)) {
            d.estado = 'Muerto en Establecimiento';
        } else if (/\b(?:viv[oa]|est[a\u00e1]\s+bien|bien)\b/i.test(t)) {
            d.estado = 'Vivo';
        }

        // ── Causa: expansión de término parcial ───────────────────
        const causaMap = [
            // Enfermedades e Infecciones (Prioridad Alta)
            { re: /\b(?:colibacilosis|colibacil|e\.?\s*coli)\b/i, cat: 'Enfermedades e Infecciones', esp: 'Colibacilosis' },
            { re: /\b(?:salmonela|salmonelosis|salmonella)\b/i, cat: 'Enfermedades e Infecciones', esp: 'Salmonelosis' },
            { re: /\b(?:rotavirus)\b/i, cat: 'Enfermedades e Infecciones', esp: 'Rotavirus' },
            { re: /\b(?:coronavirus|corona)\b/i, cat: 'Enfermedades e Infecciones', esp: 'Coronavirus' },
            { re: /\b(?:criptosporidi|cripto|criptosporidiosis)\b/i, cat: 'Enfermedades e Infecciones', esp: 'Criptosporidiosis' },
            { re: /\b(?:onfalitis|onfalo|omfalitis|omfalo|infecci[oó]n\s+en\s+el\s+ombligo|ombligo\s+infectado)\b/i, cat: 'Enfermedades e Infecciones', esp: 'Onfalitis' },
            { re: /\b(?:neumon[ií]a|pulmon[ií]a|problema\s+respiratorio)\b/i, cat: 'Enfermedades e Infecciones', esp: 'Neumonía' },
            { re: /\b(?:septicemia|infecci[oó]n\s+generalizada)\b/i, cat: 'Enfermedades e Infecciones', esp: 'Septicemia' },
            { re: /\b(?:infecci[oó]n)\b/i, cat: 'Enfermedades e Infecciones', esp: 'Infección General' },

            // Problemas Digestivos y Metabólicos
            { re: /\b(?:torsi[oó]n|torsi[oó]n\s+de\s+abomaso)\b/i, cat: 'Problemas Digestivos y Metabólicos', esp: 'Torsión de abomaso' },
            { re: /\b(?:[uú]lcera|[uú]lcera\s+de\s+abomaso)\b/i, cat: 'Problemas Digestivos y Metabólicos', esp: 'Úlcera de abomaso' },
            { re: /\b(?:intoxicaci[oó]n|intoxicado)\b/i, cat: 'Problemas Digestivos y Metabólicos', esp: 'Intoxicación' },
            { re: /\b(?:diarrea|empacho|cagadera|curso)\b/i, cat: 'Problemas Digestivos y Metabólicos', esp: 'Diarrea' },
            { re: /\b(?:acidosis|timpanismo|hinchado|hinchaz[oó]n)\b/i, cat: 'Problemas Digestivos y Metabólicos', esp: 'Acidosis / Timpanismo' },
            { re: /\b(?:digestivo|metab[oó]lico)\b/i, cat: 'Problemas Digestivos y Metabólicos', esp: 'Problemas Digestivos y Metabólicos' },

            // Factores Externos y de Manejo
            { re: /\b(?:estr[eé]s\s+cal[oó]ric|calor|golpe\s+de\s+calor)\b/i, cat: 'Factores Externos y de Manejo', esp: 'Estrés calórico' },
            { re: /\b(?:hipotermia|fr[ií]o|congelad[oa])\b/i, cat: 'Factores Externos y de Manejo', esp: 'Hipotermia / Frío' },
            { re: /\b(?:falsa\s+v[ií]a|broncoaspiraci[oó]n|ahogad[oa]\s+(?:con\s+)?leche)\b/i, cat: 'Factores Externos y de Manejo', esp: 'Falsa vía' },
            { re: /\b(?:traum[aá]t|aplastad[oa]|pisad[oa]|quebrad[oa]|golpead[oa]|traumatismo)\b/i, cat: 'Factores Externos y de Manejo', esp: 'Traumática' },
            { re: /\b(?:guacher[ií]a)\b/i, cat: 'Factores Externos y de Manejo', esp: 'Muerte Guachería' },
        ];

        let causaEncontrada = false;
        for (const c of causaMap) {
            if (c.re.test(t)) {
                d.causa_categoria = c.cat;
                d.causa_especifica = c.esp;
                causaEncontrada = true;
                break;
            }
        }

        if (!causaEncontrada) {
            const customCausaMatch = t.match(/\bcausa\s*(?:de\s+muerte)?\s*(?:es|era|de)?[\s,.:\-]+([a-záéíóúüñ\s\d]{2,35}?)(?=\s*[,.]|\s+madre|\s+tipo|\s+rp\b|\s+ig\b|\s*$)/i);
            if (customCausaMatch) {
                d.causa_categoria = 'Otra Causa';
                d.causa_especifica = customCausaMatch[1].trim().replace(/\b\w/g, c => c.toUpperCase());
                causaEncontrada = true;
            }
        }

        // Si se infiere una causa, el estado debe ser 'Muerto' si no fue especificado previamente
        if (causaEncontrada && (!d.estado || d.estado === 'Vivo')) {
            d.estado = 'Muerto en Establecimiento';
        }

        return d;
    }
};

// ── Transcripción: MediaRecorder → api/transcribe.php → Whisper ─
const VoiceTranscriber = {
    _mediaRecorder: null,
    _audioChunks: [],
    _stream: null,
    _mimeType: '',
    _onTranscribed: null,
    _onError: null,

    isSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },

    async init(onTranscribed, onError) {
        this._onTranscribed = onTranscribed;
        this._onError = onError;
        try {
            this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
            this._mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
            const opts = this._mimeType ? { mimeType: this._mimeType } : {};
            this._mediaRecorder = new MediaRecorder(this._stream, opts);
            this._audioChunks = [];
            this._mediaRecorder.ondataavailable = e => {
                if (e.data && e.data.size > 0) this._audioChunks.push(e.data);
            };
            this._mediaRecorder.onstop = async () => {
                const blob = new Blob(this._audioChunks, { type: this._mimeType || 'audio/webm' });
                this._audioChunks = [];
                await this._sendToWhisper(blob);
            };
            return true;
        } catch (e) {
            const code = e.name === 'NotAllowedError' ? 'not-allowed' : e.message;
            if (this._onError) this._onError(code);
            return false;
        }
    },

    start() {
        if (!this._mediaRecorder) return false;
        this._audioChunks = [];
        try { this._mediaRecorder.start(500); return true; } catch (e) { return false; }
    },

    stop() {
        if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
            this._mediaRecorder.stop();
        }
        if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    },

    async _sendToWhisper(blob) {
        if (!navigator.onLine) {
            const ab = await blob.arrayBuffer();
            await VDB.add({ audioData: ab, mimeType: blob.type, type: 'audio' });
            VoiceState.offlineCount = await VDB.count();
            voice_updateOfflineBadge();
            if (typeof showToast === 'function') showToast('💾 Sin conexión. Audio guardado para procesar cuando vuelvas.');
            voice_setIdleUI();
            return;
        }
        const token = localStorage.getItem('vetfield_api_token') || '';
        const ext = (blob.type.includes('mp4')) ? 'mp4' : 'webm';
        const fd = new FormData();
        fd.append('audio', blob, `recording.${ext}`);
        try {
            const res = await fetch('api/transcribe.php', {
                method: 'POST',
                headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                body: fd,
            });
            const json = await res.json();
            if (json.ok && json.text) {
                if (this._onTranscribed) this._onTranscribed(json.text);
            } else {
                if (this._onError) this._onError(json.error || 'Error de transcripción');
            }
        } catch (e) {
            if (this._onError) this._onError('Error de red: ' + e.message);
        }
    }
};

// ── Estado del módulo de voz ──────────────────────────────────
const VoiceState = {
    isListening: false,
    fullTranscript: '',
    interimTranscript: '',
    mappedData: null,
    stickyProductor: '',
    stickyEstablecimiento: '',
    offlineCount: 0,
    isReviewing: false,
    reviewQueue: [],
    currentReviewId: null,

    loadSticky() {
        const uid = (typeof _uid !== 'undefined' && _uid) ? _uid : 'guest';
        this.stickyProductor = localStorage.getItem(`vf_voice_prod_${uid}`) || '';
        this.stickyEstablecimiento = localStorage.getItem(`vf_voice_est_${uid}`) || '';
    },
    saveSticky() {
        const uid = (typeof _uid !== 'undefined' && _uid) ? _uid : 'guest';
        localStorage.setItem(`vf_voice_prod_${uid}`, this.stickyProductor);
        localStorage.setItem(`vf_voice_est_${uid}`, this.stickyEstablecimiento);
    },
    clearSticky() {
        const uid = (typeof _uid !== 'undefined' && _uid) ? _uid : 'guest';
        localStorage.removeItem(`vf_voice_prod_${uid}`);
        localStorage.removeItem(`vf_voice_est_${uid}`);
        this.stickyProductor = '';
        this.stickyEstablecimiento = '';
    }
};

// ── UI: renderizar la sección de voz dentro de #view-voz ──────
function voice_renderUI() {
    const section = document.getElementById('view-voz');
    if (!section) return;
    section.innerHTML = `
    <div class="voice-header">
        <div class="voice-eyebrow">VetField PRO · Captura de Campo</div>
        <h1 class="voice-title">Registro <strong>por Voz</strong></h1>
        <p class="voice-subtitle">Hablá con naturalidad y la IA completará el formulario automáticamente.</p>
    </div>
    <div class="voice-context-bar ${VoiceState.stickyProductor ? '' : 'is-empty'}" id="voice-ctx-bar">
        <div class="voice-context-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        </div>
        <div class="voice-context-body">
            <div class="voice-context-label">Contexto activo</div>
            <div class="voice-context-value" id="voice-ctx-value">
                ${VoiceState.stickyProductor ? VoiceState.stickyProductor + (VoiceState.stickyEstablecimiento ? ' · ' + VoiceState.stickyEstablecimiento : '') : 'Sin contexto — se detectará del audio'}
            </div>
        </div>
        <div class="voice-context-actions" style="display: flex; gap: 4px; align-items: center;">
            <button class="voice-context-edit" onclick="voice_editSticky()" title="Editar contexto" style="background:none; border:none; color:currentColor; cursor:pointer; padding:4px; opacity:0.7; transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
            ${VoiceState.stickyProductor ? '<button class="voice-context-clear" onclick="voice_clearSticky()" title="Borrar contexto"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' : ''}
        </div>
    </div>
    <div class="voice-offline-queue ${VoiceState.offlineCount > 0 ? 'visible' : ''}" id="voice-offline-queue">
        <div class="voice-offline-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55"/><path d="M5 12.55a10.94 10.94 0 015.17-2.39"/><path d="M10.71 5.05A16 16 0 0122.56 9"/><path d="M1.42 9a15.91 15.91 0 014.7-2.88"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg></div>
        <div class="voice-offline-text">
            <div class="voice-offline-title">Pendiente de sincronización</div>
            <div class="voice-offline-sub">Se enviará al volver la conexión</div>
        </div>
        <div class="voice-offline-count" id="voice-offline-count">${VoiceState.offlineCount}</div>
    </div>
    <div class="voice-arena">
        <div class="voice-btn-wrap" id="voice-btn-wrap">
            <button class="voice-btn" id="voice-btn-main" onclick="voice_toggle()" aria-label="Iniciar grabación">
                <svg class="voice-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                </svg>
                <span class="voice-btn-label" id="voice-btn-label">Grabar</span>
            </button>
        </div>
        <div class="voice-waveform" id="voice-waveform">
            <div class="voice-wave-bar"></div><div class="voice-wave-bar"></div>
            <div class="voice-wave-bar"></div><div class="voice-wave-bar"></div>
            <div class="voice-wave-bar"></div><div class="voice-wave-bar"></div>
            <div class="voice-wave-bar"></div>
        </div>
        <div class="voice-status-text" id="voice-status-text">Presioná el botón para comenzar</div>
    </div>
    
    <div class="voice-guide-container">
        <h3 class="voice-guide-title">Orden de Dictado Sugerido</h3>
        <ul class="voice-guide-list">
            <li><span class="guide-tag">1</span> <strong>Contexto:</strong> Productor, Establecimiento</li>
            <li><span class="guide-tag">2</span> <strong>Ternero:</strong> RP del Ternero.<br> IG del Ternero.<br> Sexo: (Macho/Hembra).<br> Ombligo: (Bueno/Regular/Malo).<br> Estado: (Vivo/Muerto).<br> SI MURIO:<br> Lugar (Establecimiento/Guachera/Terapia).<br> Causa: (Coronavirus, Onfalítis, etc)</li>
            <li><span class="guide-tag">3</span> <strong>Madre:</strong> Vaca/Vaquillona.<br> RP de la Madre.<br> IG de la Madre.</li>
        </ul>
    </div>

    <div class="voice-transcript-section">
        <div class="voice-transcript-box" id="voice-transcript-box">
            <div class="voice-transcript-placeholder" id="voice-transcript-placeholder">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                Tu dictado aparecerá aquí...
            </div>
            <div class="voice-transcript-text" id="voice-transcript-text"></div>
            <span class="voice-transcript-cursor hidden" id="voice-transcript-cursor"></span>
        </div>
    </div>
    <div class="voice-summary-card" id="voice-summary-card">
        <div class="voice-summary-header">
            <span class="voice-summary-title">Datos Detectados</span>
            <span class="voice-summary-badge">Revisá y confirmá</span>
        </div>
        <div class="voice-summary-fields" id="voice-summary-fields"></div>
        <div class="voice-summary-actions">
            <button class="voice-btn-confirm" id="voice-btn-confirm" onclick="voice_confirmSave()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                Guardar Registro
            </button>
            <button class="voice-btn-discard" onclick="voice_discard()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Descartar
            </button>
        </div>
    </div>
    <div class="voice-tips">
        <p class="voice-tip-text">
            <strong>Ejemplo 1:</strong> "Productor Don Juan, Establecimiento Puesto 2, RP del Ternero T1300, IG ternero 2.4, Sexo Hembra, Ombligo Bueno, Estado Vivo, Madre Vaquillona, RP de la Madre T120, IG de la Madre 2.8"<br>
            <strong>Ejemplo 2:</strong> "Productor Don Juan, Establecimiento Puesto 2, RP del Ternero T1300, IG ternero 2.4, Sexo Hembra, Ombligo Bueno, Estado Muerto, Lugar Guachera, Causa Neumonia, Madre Vaca, RP de la Madre T120, IG de la Madre 2.8"
        </p>
    </div>`;
    if (!VoiceTranscriber.isSupported()) {
        const btn = document.getElementById('voice-btn-main');
        if (btn) { btn.disabled = true; }
        const st = document.getElementById('voice-status-text');
        if (st) st.textContent = 'Requiere HTTPS y permiso de micrófono';
    }
}

async function voice_toggle() {
    if (VoiceState.isListening) { voice_stopListening(); } else { await voice_startListening(); }
}

async function voice_startListening() {
    if (VoiceState.isListening) return;
    const st = document.getElementById('voice-status-text');
    const lbl = document.getElementById('voice-btn-label');
    if (st) st.textContent = 'Solicitando micrófono…';
    const ok = await VoiceTranscriber.init(voice_onTranscribed, voice_onTranscribeError);
    if (!ok) return;
    const started = VoiceTranscriber.start();
    if (!started) { if (typeof showToast === 'function') showToast('Error al iniciar la grabación.'); return; }
    VoiceState.isListening = true;
    VoiceState.fullTranscript = '';
    document.getElementById('voice-btn-main')?.classList.add('listening');
    document.getElementById('voice-btn-wrap')?.classList.add('listening');
    document.getElementById('voice-waveform')?.classList.add('active');
    if (st) st.textContent = 'Grabando… presioná para enviar a Whisper';
    if (lbl) lbl.textContent = 'Detener';
    document.getElementById('voice-transcript-cursor')?.classList.remove('hidden');
    document.getElementById('voice-transcript-box')?.classList.add('listening');
    document.getElementById('voice-transcript-placeholder')?.classList.add('hidden');
    document.getElementById('voice-summary-card')?.classList.remove('visible');
    const txtEl = document.getElementById('voice-transcript-text');
    if (txtEl) txtEl.textContent = '';
}

function voice_stopListening() {
    VoiceState.isListening = false;
    VoiceTranscriber.stop();   // dispara onstop → _sendToWhisper → voice_onTranscribed
    voice_setProcessingUI();
}

function voice_setProcessingUI() {
    const btn = document.getElementById('voice-btn-main');
    if (btn) { btn.classList.remove('listening'); btn.classList.add('processing'); btn.disabled = true; }
    document.getElementById('voice-btn-wrap')?.classList.remove('listening');
    document.getElementById('voice-waveform')?.classList.remove('active');
    document.getElementById('voice-transcript-cursor')?.classList.add('hidden');
    document.getElementById('voice-transcript-box')?.classList.remove('listening');
    const lbl = document.getElementById('voice-btn-label'); if (lbl) lbl.textContent = 'IA…';
    const st = document.getElementById('voice-status-text'); if (st) st.textContent = 'Procesando con IA…';
}

function voice_setIdleUI() {
    const btn = document.getElementById('voice-btn-main');
    if (btn) { btn.classList.remove('listening', 'processing'); btn.disabled = false; }
    document.getElementById('voice-btn-wrap')?.classList.remove('listening');
    document.getElementById('voice-waveform')?.classList.remove('active');
    document.getElementById('voice-transcript-cursor')?.classList.add('hidden');
    document.getElementById('voice-transcript-box')?.classList.remove('listening');
    const lbl = document.getElementById('voice-btn-label'); if (lbl) lbl.textContent = 'Grabar';
    const st = document.getElementById('voice-status-text'); if (st) st.textContent = 'Presioná el botón para comenzar';
}

// Callback: Whisper devuelve texto transcrito
function voice_onTranscribed(text) {
    VoiceState.fullTranscript = text;
    const txtEl = document.getElementById('voice-transcript-text');
    if (txtEl) txtEl.textContent = text;
    document.getElementById('voice-transcript-placeholder')?.classList.add('hidden');
    voice_setIdleUI();
    if (text.trim()) voice_processTranscript(text);
}

// Callback: error de transcripción
function voice_onTranscribeError(err) {
    voice_setIdleUI();
    const msg = err === 'not-allowed'
        ? 'Permiso de micrófono denegado.'
        : 'Error al transcribir: ' + err;
    if (typeof showToast === 'function') showToast(msg);
    const st = document.getElementById('voice-status-text'); if (st) st.textContent = msg;
}

function voice_processTranscript(text) {
    const st = document.getElementById('voice-status-text'); if (st) st.textContent = 'Analizando…';
    const lower = text.toLowerCase();
    const changeEst = lower.match(/cambi(?:a|ame|á)\s+(?:al?\s+)?(?:establecimiento|campo|tambo|estancia)\s+([a-záéíóúüñ\s\d]+)/i);
    if (changeEst) { VoiceState.stickyEstablecimiento = changeEst[1].trim().replace(/\b\w/g, c => c.toUpperCase()); VoiceState.saveSticky(); }
    const changeProd = lower.match(/cambi(?:a|ame|á)\s+(?:al?\s+)?productor\s+([a-záéíóúüñ\s]+)/i);
    if (changeProd) { VoiceState.stickyProductor = changeProd[1].trim().replace(/\b\w/g, c => c.toUpperCase()); VoiceState.saveSticky(); }
    const mapped = VoiceMapper.map(text);
    if (!mapped.productor && VoiceState.stickyProductor) mapped.productor = VoiceState.stickyProductor;
    if (!mapped.establecimiento && VoiceState.stickyEstablecimiento) mapped.establecimiento = VoiceState.stickyEstablecimiento;
    if (mapped.productor) { VoiceState.stickyProductor = mapped.productor; VoiceState.saveSticky(); }
    if (mapped.establecimiento) { VoiceState.stickyEstablecimiento = mapped.establecimiento; VoiceState.saveSticky(); }
    VoiceState.mappedData = mapped;
    const st2 = document.getElementById('voice-status-text'); if (st2) st2.textContent = 'Revisá los datos detectados';
    voice_renderSummary(mapped); voice_refreshContextBar();
}

const VOICE_FIELDS_CONFIG = [
    { key: 'productor', label: 'Productor', type: 'text' },
    { key: 'establecimiento', label: 'Establecimiento', type: 'text' },
    { key: 'fecha', label: 'Fecha', type: 'date' },
    { key: 'rp_ternero', label: 'R.P. Ternero', type: 'text' },
    { key: 'ig_ternero', label: 'I.G. Ternero', type: 'number' },
    { key: 'sexo', label: 'Sexo', type: 'select', opts: ['Macho', 'Hembra'] },
    { key: 'ombligo', label: 'Ombligo', type: 'select', opts: ['Bueno', 'Regular', 'Malo'] },
    { key: 'tipo_madre', label: 'Tipo Madre', type: 'select', opts: ['Vaca', 'Vaquillona'] },
    { key: 'rp_madre', label: 'R.P. Madre', type: 'text' },
    { key: 'ig_calostro', label: 'I.G. Calostro', type: 'number' },
    { key: 'estado', label: 'Estado', type: 'select', opts: ['Vivo', 'Muerto en Establecimiento', 'Muerto en Guachería', 'Muerto en Terapia'] },
    { key: 'causa_categoria', label: 'Categoría Causa', type: 'select', opts: ['', 'Enfermedades e Infecciones', 'Problemas Digestivos y Metabólicos', 'Factores Externos y de Manejo', 'Otra Causa'] },
    { key: 'causa_especifica', label: 'Causa Específica', type: 'text' },
];

function voice_renderSummary(data) {
    const fieldsEl = document.getElementById('voice-summary-fields'); if (!fieldsEl) return;
    const isMuerto = (data.estado || '').includes('Muerto');
    fieldsEl.innerHTML = VOICE_FIELDS_CONFIG.map(f => {
        const val = data[f.key] || '';
        const detected = val !== '' && val !== 'Macho' && val !== 'Bueno' && val !== 'Vaca' && val !== 'Vivo';
        const highlightDead = isMuerto && f.key.startsWith('causa_') ? 'border: 1px solid var(--accent-red); background: rgba(239, 68, 68, 0.05);' : '';
        if (f.type === 'select') {
            const opts = f.opts.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o || '—'}</option>`).join('');
            return `<div class="voice-field-row"><div class="voice-field-label">${f.label}</div><select class="voice-field-input voice-field-select ${detected ? 'detected' : ''}" data-key="${f.key}" style="${highlightDead}">${opts}</select></div>`;
        }
        return `<div class="voice-field-row"><div class="voice-field-label">${f.label}</div><input type="${f.type}" class="voice-field-input ${detected ? 'detected' : ''}" data-key="${f.key}" value="${val}" placeholder="—" style="${highlightDead}"></div>`;
    }).join('');
    const card = document.getElementById('voice-summary-card'); if (card) card.classList.add('visible');
}

async function voice_confirmSave() {
    const fields = document.querySelectorAll('#voice-summary-fields [data-key]');
    const rec = { synced: false, _local_id: Date.now() };
    fields.forEach(el => { rec[el.dataset.key] = el.value || ''; });
    rec.causa = (rec.causa_categoria && rec.causa_especifica) ? `${rec.causa_categoria} - ${rec.causa_especifica}` : (rec.causa_categoria || rec.causa_especifica || '');
    const btn = document.getElementById('voice-btn-confirm');
    if (btn) { btn.disabled = true; btn.innerHTML = 'Guardando…'; }
    if (navigator.onLine) {
        try {
            const res = await apiFetchApp('api/records.php', { method: 'POST', body: JSON.stringify({ action: 'save', ...rec }) });
            if (res && res.ok) {
                rec.id = res.id; rec.synced = true;
                if (typeof records !== 'undefined') records.unshift({ ...rec });
                if (typeof updateUI === 'function') updateUI();
                if (typeof showToast === 'function') showToast('✅ Registro de voz guardado.');
                if (VoiceState.isReviewing && VoiceState.currentReviewId) {
                    // REGLA: borrar de IDB SOLO después de OK del servidor ✅
                    await VDB.delete(VoiceState.currentReviewId);
                    VoiceState.offlineCount = await VDB.count();
                    voice_updateOfflineBadge();
                    voice_processNextReview();
                } else {
                    voice_afterSave();
                }
            } else { await voice_saveOfflineQueue(rec); }
        } catch (e) { await voice_saveOfflineQueue(rec); }
    } else { await voice_saveOfflineQueue(rec); }
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar Registro'; }
}

async function voice_saveOfflineQueue(rec) {
    // REGLA CRÍTICA: si ya estamos revisando un registro que está en IDB,
    // NO lo borramos. Simplemente lo dejamos en IDB con status 'pending'
    // para que se retome en el próximo inicio o reconexión.
    // Solo añadimos a IDB si es un registro NUEVO (no es una revisión existente).
    if (VoiceState.isReviewing && VoiceState.currentReviewId) {
        // El registro ya existe en IDB — no hacer nada, ya persiste.
        VoiceState.isReviewing = false;
        VoiceState.currentReviewId = null;
    } else {
        // Registro nuevo (vino de un dictado online que falló) → guardarlo
        await VDB.add({ mappedData: rec });
    }
    if (typeof updateUI === 'function') updateUI();
    VoiceState.offlineCount = await VDB.count(); voice_updateOfflineBadge();
    if (typeof showToast === 'function') showToast('💾 Sin conexión. Registro guardado localmente.');
    voice_afterSave();
}

function voice_afterSave() {
    VoiceState.fullTranscript = ''; VoiceState.mappedData = null;
    const el = document.getElementById('voice-transcript-text'); if (el) el.textContent = '';
    document.getElementById('voice-transcript-placeholder')?.classList.remove('hidden');
    document.getElementById('voice-summary-card')?.classList.remove('visible');
    voice_setIdleUI(); voice_refreshContextBar();
}

function voice_discard() {
    VoiceState.fullTranscript = ''; VoiceState.mappedData = null;
    const el = document.getElementById('voice-transcript-text'); if (el) el.textContent = '';
    document.getElementById('voice-transcript-placeholder')?.classList.remove('hidden');
    document.getElementById('voice-summary-card')?.classList.remove('visible');
    voice_setIdleUI();
    if (VoiceState.isReviewing && VoiceState.currentReviewId) {
        VDB.delete(VoiceState.currentReviewId).then(async () => {
            VoiceState.offlineCount = await VDB.count();
            voice_updateOfflineBadge();
            voice_processNextReview();
        });
    }
}

function voice_refreshContextBar() {
    const bar = document.getElementById('voice-ctx-bar'); const val = document.getElementById('voice-ctx-value');
    if (!bar || !val) return;
    if (VoiceState.stickyProductor) {
        bar.classList.remove('is-empty');
        val.textContent = VoiceState.stickyProductor + (VoiceState.stickyEstablecimiento ? ' · ' + VoiceState.stickyEstablecimiento : '');
    } else { bar.classList.add('is-empty'); val.textContent = 'Sin contexto — se detectará del audio'; }
}

function voice_clearSticky() { VoiceState.clearSticky(); voice_renderUI(); }

function voice_editSticky() {
    const prod = prompt('Editar Productor:', VoiceState.stickyProductor || '');
    if (prod === null) return;
    const est = prompt('Editar Establecimiento (opcional):', VoiceState.stickyEstablecimiento || '');
    if (est === null) return;

    if (!prod.trim() && !est.trim()) {
        VoiceState.clearSticky();
    } else {
        VoiceState.stickyProductor = prod.trim();
        VoiceState.stickyEstablecimiento = est.trim();
        VoiceState.saveSticky();
    }
    voice_renderUI();
}

function voice_updateOfflineBadge() {
    const queue = document.getElementById('voice-offline-queue');
    const count = document.getElementById('voice-offline-count');
    if (!queue) return;
    if (VoiceState.offlineCount > 0) { queue.classList.add('visible'); if (count) count.textContent = VoiceState.offlineCount; }
    else { queue.classList.remove('visible'); }
}

async function voice_syncQueue() {
    if (!navigator.onLine) return;
    const pending = (await VDB.getAll()).filter(r => r.status === 'pending');
    if (!pending.length) return;

    // En lugar de enviar automático, mostrar Toast para revisión manual
    voice_showReviewToast(pending.length);
}

function voice_showReviewToast(count) {
    // Evitar toasts duplicados si se llama múltiples veces a online
    if (document.getElementById('voice-review-toast')) return;

    const toast = document.createElement('div');
    toast.id = 'voice-review-toast';
    toast.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1e293b;color:white;
        padding:16px 24px;border-radius:12px;font-size:0.95rem;font-weight:600;
        box-shadow:0 10px 25px rgba(0,0,0,0.2);z-index:10000;animation:slideDown 0.3s ease-out;
        display: flex; flex-direction: column; align-items: center; gap: 12px; border: 1px solid rgba(255,255,255,0.1);`;

    toast.innerHTML = `
        <div>Tenés ${count} registro${count > 1 ? 's' : ''} de voz pendiente${count > 1 ? 's' : ''} de revisar.</div>
        <button onclick="voice_startReviewFlow(); this.parentElement.remove()" style="background:#10b981;color:white;border:none;padding:8px 16px;border-radius:8px;font-weight:bold;cursor:pointer;width:100%;">Revisar pendientes</button>
    `;
    document.body.appendChild(toast);
}

async function voice_startReviewFlow() {
    VoiceState.isReviewing = true;
    const pending = (await VDB.getAll()).filter(r => r.status === 'pending');
    VoiceState.reviewQueue = pending;

    // Navegar a la pestaña de voz si no está activa
    if (typeof switchView === 'function') switchView('voz');

    voice_processNextReview();
}

async function voice_processNextReview() {
    if (!VoiceState.reviewQueue.length) {
        VoiceState.isReviewing = false;
        VoiceState.currentReviewId = null;
        if (typeof showToast === 'function') showToast('✅ Todos los registros fueron revisados.');
        if (typeof loadFromAPI === 'function' && typeof updateUI === 'function') { await loadFromAPI(); updateUI(); }
        voice_afterSave();
        return;
    }

    const item = VoiceState.reviewQueue.shift();
    VoiceState.currentReviewId = item.id;

    const st = document.getElementById('voice-status-text');
    if (st) st.textContent = 'Procesando registro pendiente con IA...';
    const btn = document.getElementById('voice-btn-main');
    if (btn) btn.disabled = true;
    document.getElementById('voice-transcript-placeholder')?.classList.add('hidden');

    try {
        if (item.type === 'audio' && item.audioData) {
            const blob = new Blob([item.audioData], { type: item.mimeType || 'audio/webm' });
            const ext = (item.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
            const fd = new FormData();
            fd.append('audio', blob, `recording.${ext}`);
            const token = localStorage.getItem('vetfield_api_token') || '';
            const tRes = await fetch('api/transcribe.php', {
                method: 'POST',
                headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                body: fd
            });
            const tJson = await tRes.json();
            if (tJson.ok && tJson.text) {
                const mapped = VoiceMapper.map(tJson.text);
                if (!mapped.productor && VoiceState.stickyProductor) mapped.productor = VoiceState.stickyProductor;
                if (!mapped.establecimiento && VoiceState.stickyEstablecimiento) mapped.establecimiento = VoiceState.stickyEstablecimiento;

                const txtEl = document.getElementById('voice-transcript-text');
                if (txtEl) txtEl.textContent = tJson.text;

                if (st) st.textContent = 'Revisá el registro pendiente';
                voice_renderSummary(mapped);
            } else {
                if (typeof showToast === 'function') showToast('Error en la transcripción. Se descartará el audio.');
                await VDB.delete(item.id);
                VoiceState.offlineCount = await VDB.count();
                voice_updateOfflineBadge();
                voice_processNextReview();
            }
        } else if (item.mappedData) {
            const txtEl = document.getElementById('voice-transcript-text');
            if (txtEl) txtEl.textContent = '(Registro pre-procesado)';
            if (st) st.textContent = 'Revisá el registro pendiente';
            voice_renderSummary(item.mappedData);
        } else {
            await VDB.delete(item.id);
            VoiceState.offlineCount = await VDB.count();
            voice_updateOfflineBadge();
            voice_processNextReview();
        }
    } catch (e) {
        VoiceState.reviewQueue.unshift(item); // Devolver a la cola
        VoiceState.isReviewing = false;
        VoiceState.currentReviewId = null;
        if (typeof showToast === 'function') showToast('Error de conexión. Se pausó la revisión.');
        voice_afterSave();
    }
}

window.addEventListener('online', voice_syncQueue);
window.voice_toggle = voice_toggle;
window.voice_confirmSave = voice_confirmSave;
window.voice_discard = voice_discard;
window.voice_clearSticky = voice_clearSticky;
window.voice_editSticky = voice_editSticky;
window.voice_startReviewFlow = voice_startReviewFlow;

document.addEventListener('DOMContentLoaded', async () => {
    if (document.getElementById('view-voz')) {
        VoiceState.loadSticky();
        VoiceState.offlineCount = await VDB.count();
        voice_renderUI();

        // ── RECUPERACIÓN AUTOMÁTICA TRAS REFRESCO ─────────────────────
        // Si hay registros pendientes en IDB al cargar la página,
        // se restaura el popup de revisión automáticamente para que
        // el usuario no pierda ningún dato aunque haya refrescado.
        if (VoiceState.offlineCount > 0 && navigator.onLine) {
            // Pequeño delay para que el DOM esté completamente renderizado
            setTimeout(() => {
                voice_showReviewToast(VoiceState.offlineCount);
            }, 800);
        } else if (VoiceState.offlineCount > 0) {
            // Sin conexión: mostrar badge pero no el toast de revisión
            voice_updateOfflineBadge();
        }
    }
});
