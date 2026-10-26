/**
 * ============================================================
 * VETFIELD PRO — informes.js
 * Módulo de Informes de Laboratorio en la Nube
 * Gestión de PDFs por productor, sincronización y envío a WhatsApp
 * ============================================================
 */

(function () {
    'use strict';

    const InformesApp = {
        informes: [],
        productores: [],
        countsMap: {},
        selectedProductor: '',
        selectedFile: null,
        isLoading: false,
        _initialized: false,

        /** Obtiene productores combinando los locales del sistema y los de la nube */
        getAvailableProductores: function () {
            const set = new Set();
            (this.productores || []).forEach(p => { if (p && p.trim()) set.add(p.trim()); });
            if (Array.isArray(window.productores)) {
                window.productores.forEach(p => { if (p && p.trim()) set.add(p.trim()); });
            }
            if (this.countsMap) {
                Object.keys(this.countsMap).forEach(p => { if (p && p.trim()) set.add(p.trim()); });
            }
            return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        },

        /** Inicialización al abrir la vista */
        init: function () {
            if (!this._initialized) {
                this.setupDropzone();
                this.setupForm();
                this._initialized = true;
            }
            // Sincronizar y renderizar de inmediato los productores disponibles en la app
            this.renderProductorSelector();
            this.fetchData();
        },

        /** Obtiene Bearer token de autenticación */
        getToken: function () {
            return localStorage.getItem('vetfield_api_token') || '';
        },

        /** Realiza petición a la API de informes */
        apiFetch: async function (endpoint, options = {}) {
            const token = this.getToken();
            const headers = options.headers || {};
            if (token) {
                headers['Authorization'] = 'Bearer ' + token;
            }
            options.headers = headers;

            const res = await fetch(endpoint, options);
            let data;
            try {
                data = await res.json();
            } catch (e) {
                throw new Error('Respuesta no válida del servidor.');
            }

            if (!res.ok || !data.ok) {
                throw new Error(data.error || `Error en el servidor (HTTP ${res.status})`);
            }
            return data;
        },

        /** Carga datos de la API */
        fetchData: async function () {
            const grid = document.getElementById('inf-reports-grid');
            if (grid) {
                grid.innerHTML = `
                    <div class="inf-skeleton-card"></div>
                    <div class="inf-skeleton-card"></div>
                    <div class="inf-skeleton-card"></div>
                `;
            }

            this.isLoading = true;

            try {
                const prodParam = this.selectedProductor ? `&productor=${encodeURIComponent(this.selectedProductor)}` : '';
                const data = await this.apiFetch(`api/informes.php?action=list${prodParam}`);

                this.informes = data.informes || [];
                this.productores = data.productores || [];
                this.countsMap = data.counts_map || {};

                this.renderProductorSelector();
                this.renderStatsHeader();
                this.renderProducerBanner();
                this.renderReportsList();

            } catch (err) {
                console.error('[Informes] Error al cargar:', err);
                if (grid) {
                    grid.innerHTML = `
                        <div class="inf-empty-state" style="border-color: rgba(220,38,38,0.3); background: rgba(220,38,38,0.03);">
                            <div class="inf-empty-icon" style="background: rgba(220,38,38,0.1); color: #dc2626;">
                                <i data-lucide="alert-circle" style="width:32px;height:32px;"></i>
                            </div>
                            <h3 class="inf-empty-title" style="color:#dc2626;">No se pudieron cargar los informes</h3>
                            <p class="inf-empty-desc">${this.escapeHtml(err.message || 'Verificá tu conexión a internet.')}</p>
                            <button type="button" class="inf-btn-upload" onclick="InformesApp.fetchData()" style="padding:0.6rem 1.2rem;">
                                <i data-lucide="refresh-cw" style="width:16px;height:16px;"></i> Reintentar
                            </button>
                        </div>
                    `;
                    if (window.lucide) window.lucide.createIcons();
                }
            } finally {
                this.isLoading = false;
            }
        },

        /** Renderiza el selector de productores (custom dropdown + select oculto) */
        renderProductorSelector: function () {
            const select   = document.getElementById('inf-filter-productor');
            const ul       = document.getElementById('inf-filter-dropdown');
            const labelEl  = document.getElementById('inf-filter-label');
            if (!select || !ul) return;

            const prevVal = this.selectedProductor;
            const prods   = this.getAvailableProductores();

            // ── Actualizar el <select> oculto (para compatibilidad) ──
            let optHtml = '<option value="">-- Todos los Productores --</option>';
            prods.forEach(p => {
                const count      = this.countsMap[p] || 0;
                const countBadge = count > 0 ? ` (${count} informe${count > 1 ? 's' : ''})` : '';
                const sel        = p === prevVal ? 'selected' : '';
                optHtml += `<option value="${this.escapeHtml(p)}" ${sel}>${this.escapeHtml(p)}${countBadge}</option>`;
            });
            select.innerHTML = optHtml;
            select.value = prevVal || '';

            // ── Actualizar la lista custom ──
            let liHtml = `<li role="option" class="${prevVal === '' ? 'active' : ''}" data-value="">-- Todos los Productores --</li>`;
            prods.forEach(p => {
                const count      = this.countsMap[p] || 0;
                const countBadge = count > 0 ? ` <span style="opacity:0.55;font-size:0.8em;">(${count})</span>` : '';
                const active     = p === prevVal ? ' active' : '';
                liHtml += `<li role="option" class="${active}" data-value="${this.escapeHtml(p)}">${this.escapeHtml(p)}${countBadge}</li>`;
            });
            ul.innerHTML = liHtml;

            // ── Actualizar label del botón ──
            if (labelEl) {
                const found = prods.find(p => p === prevVal);
                labelEl.textContent = found ? found : '-- Todos los Productores --';
            }

            // ── Eventos en los items (delegado) ──
            ul.onclick = (e) => {
                const li = e.target.closest('li[data-value]');
                if (!li) return;
                this.selectProductorOption(li.dataset.value);
            };
        },

        /** Abre / cierra el dropdown custom */
        toggleDropdown: function () {
            const ul      = document.getElementById('inf-filter-dropdown');
            const btn     = document.getElementById('inf-filter-btn');
            const chevron = document.getElementById('inf-filter-chevron');
            if (!ul) return;

            const isOpen = ul.style.display !== 'none';
            if (isOpen) {
                this.closeDropdown();
            } else {
                ul.style.display = 'block';
                if (btn) btn.setAttribute('aria-expanded', 'true');
                if (chevron) chevron.style.transform = 'rotate(180deg)';

                // Cerrar al hacer clic fuera
                setTimeout(() => {
                    document.addEventListener('click', this._outsideClickHandler = (e) => {
                        const wrap = document.getElementById('inf-custom-select-wrap');
                        if (wrap && !wrap.contains(e.target)) {
                            this.closeDropdown();
                        }
                    }, { once: true });
                }, 0);
            }
        },

        /** Cierra el dropdown custom */
        closeDropdown: function () {
            const ul      = document.getElementById('inf-filter-dropdown');
            const btn     = document.getElementById('inf-filter-btn');
            const chevron = document.getElementById('inf-filter-chevron');
            if (ul) ul.style.display = 'none';
            if (btn) btn.setAttribute('aria-expanded', 'false');
            if (chevron) chevron.style.transform = '';
        },

        /** Selecciona una opción del dropdown custom */
        selectProductorOption: function (value) {
            this.selectedProductor = value;

            const select  = document.getElementById('inf-filter-productor');
            const labelEl = document.getElementById('inf-filter-label');
            const ul      = document.getElementById('inf-filter-dropdown');

            if (select) {
                select.value = value;
                select.dispatchEvent(new Event('change'));
            }
            if (labelEl) {
                labelEl.textContent = value || '-- Todos los Productores --';
            }
            // Marcar item activo
            if (ul) {
                ul.querySelectorAll('li').forEach(li => {
                    li.classList.toggle('active', li.dataset.value === value);
                });
            }
            this.closeDropdown();
            this.fetchData();
        },

        /** Maneja el cambio en el select oculto (fallback) */
        onProductorChange: function () {
            const select = document.getElementById('inf-filter-productor');
            if (!select) return;
            this.selectedProductor = select.value.trim();
            this.fetchData();
        },

        /** Renderiza métricas rápidas del encabezado */
        renderStatsHeader: function () {
            const totalInfEl = document.getElementById('inf-stat-total');
            const totalProdEl = document.getElementById('inf-stat-prods');

            if (totalInfEl) {
                const total = Object.values(this.countsMap).reduce((a, b) => a + b, 0);
                totalInfEl.textContent = total;
            }
            if (totalProdEl) {
                const prodsConInformes = Object.keys(this.countsMap).filter(k => this.countsMap[k] > 0).length;
                totalProdEl.textContent = prodsConInformes;
            }
        },

        /** Renderiza banner de estado del productor seleccionado */
        renderProducerBanner: function () {
            const banner = document.getElementById('inf-producer-banner');
            if (!banner) return;

            if (!this.selectedProductor) {
                banner.style.display = 'none';
                return;
            }

            banner.style.display = 'flex';
            const initial = this.selectedProductor.charAt(0).toUpperCase() || 'P';
            const count = this.countsMap[this.selectedProductor] || this.informes.length || 0;

            banner.innerHTML = `
                <div class="inf-producer-info">
                    <div class="inf-producer-avatar">${this.escapeHtml(initial)}</div>
                    <div>
                        <div class="inf-producer-name">${this.escapeHtml(this.selectedProductor)}</div>
                        <div class="inf-producer-count">${count} informe${count !== 1 ? 's' : ''} de laboratorio registrado${count !== 1 ? 's' : ''}</div>
                    </div>
                </div>
                <button type="button" class="inf-btn-upload" onclick="InformesApp.openUploadModal('${this.escapeHtml(this.selectedProductor).replace(/'/g, "\\'")}')" style="height:36px;font-size:0.8rem;padding:0 1rem;">
                    <i data-lucide="file-plus" style="width:16px;height:16px;"></i> Anexar Informe
                </button>
            `;
            if (window.lucide) window.lucide.createIcons();
        },

        /** Renderiza la cuadrícula de informes */
        renderReportsList: function () {
            const grid = document.getElementById('inf-reports-grid');
            if (!grid) return;

            if (this.informes.length === 0) {
                const isFiltered = !!this.selectedProductor;
                grid.innerHTML = `
                    <div class="inf-empty-state">
                        <div class="inf-empty-icon">
                            <i data-lucide="file-text" style="width:32px;height:32px;"></i>
                        </div>
                        <h3 class="inf-empty-title">
                            ${isFiltered ? `Sin informes para ${this.escapeHtml(this.selectedProductor)}` : 'No hay informes de laboratorio cargados'}
                        </h3>
                        <p class="inf-empty-desc">
                            ${isFiltered
                                ? 'Subí el primer resultado de análisis en PDF para este productor. Quedará disponible en la nube para todos tus dispositivos.'
                                : 'Subí los resultados de laboratorio en PDF para organizarlos por productor y compartirlos en 1 clic por WhatsApp.'}
                        </p>
                        <button type="button" class="inf-btn-upload" onclick="InformesApp.openUploadModal(${isFiltered ? `'${this.escapeHtml(this.selectedProductor).replace(/'/g, "\\'")}'` : 'null'})">
                            <i data-lucide="upload-cloud" style="width:18px;height:18px;"></i> Subir Primer Informe PDF
                        </button>
                    </div>
                `;
                if (window.lucide) window.lucide.createIcons();
                return;
            }

            let html = '';
            this.informes.forEach(item => {
                const tagClass = this.getTagClass(item.tipo_analisis);
                const fechaFormateada = this.formatFecha(item.fecha);
                const tamanoFormateado = this.formatBytes(item.archivo_tamano);
                const safeUrl = this.escapeHtml(item.archivo_url);
                const safeTitulo = this.escapeHtml(item.titulo);
                const safeProductor = this.escapeHtml(item.productor);

                html += `
                    <div class="inf-card" data-id="${item.id}">
                        <div>
                            <!-- Header de la tarjeta -->
                            <div class="inf-card-header">
                                <span class="inf-tag ${tagClass}">
                                    <i data-lucide="flask-conical" style="width:12px;height:12px;"></i>
                                    ${this.escapeHtml(item.tipo_analisis || 'General')}
                                </span>
                                <span class="inf-card-date" title="Fecha del análisis">
                                    <i data-lucide="calendar" style="width:13px;height:13px;"></i>
                                    ${fechaFormateada}
                                </span>
                            </div>

                            <!-- Cuerpo de la tarjeta -->
                            <div class="inf-card-main" style="margin-top:0.75rem;">
                                <div class="inf-pdf-icon-wrap" title="Documento PDF">
                                    <i data-lucide="file-text" style="width:24px;height:24px;"></i>
                                </div>
                                <div class="inf-card-details">
                                    <h4 class="inf-card-title">${safeTitulo}</h4>
                                    <div class="inf-card-meta">
                                        <span class="inf-card-meta-prod"><i data-lucide="user" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;"></i> ${safeProductor}</span>
                                        <span>·</span>
                                        <span>${tamanoFormateado}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Observaciones / Dictamen si existen -->
                            ${item.notas ? `
                                <div class="inf-card-notes" style="margin-top:0.75rem;">
                                    "${this.escapeHtml(item.notas)}"
                                </div>
                            ` : ''}
                        </div>

                        <!-- Acciones -->
                        <div class="inf-card-actions">
                            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="inf-btn-action inf-btn-view" title="Abrir y visualizar PDF">
                                <i data-lucide="external-link" style="width:15px;height:15px;"></i>
                                <span>Ver PDF</span>
                            </a>
                            <button type="button" class="inf-btn-action inf-btn-wa" onclick="InformesApp.compartirWhatsApp(${item.id})" title="Enviar informe al productor por WhatsApp">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                    <path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.099-.114.133-.198.198-.33.065-.134.034-.248-.016-.348-.05-.099-.445-1.074-.61-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.729.729 0 0 0-.529.247c-.182.198-.691.677-.691 1.654 0 .977.71 1.916.81 2.049.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232z"/>
                                </svg>
                                <span>WhatsApp</span>
                            </button>
                            <button type="button" class="inf-btn-action inf-btn-icon-only" onclick="InformesApp.copiarEnlace('${safeUrl}')" title="Copiar enlace directo">
                                <i data-lucide="copy" style="width:16px;height:16px;"></i>
                            </button>
                            <button type="button" class="inf-btn-action inf-btn-icon-only inf-btn-del" onclick="InformesApp.eliminarInforme(${item.id}, '${safeTitulo.replace(/'/g, "\\'")}')" title="Eliminar informe">
                                <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
                            </button>
                        </div>
                    </div>
                `;
            });

            grid.innerHTML = html;
            if (window.lucide) window.lucide.createIcons();
        },

        /** Abre modal para cargar nuevo informe */
        openUploadModal: function (prefillProductor = null) {
            const modal = document.getElementById('modal-upload-informe');
            if (!modal) return;

            // Resetear archivo seleccionado
            this.selectedFile = null;
            this.updateDropzoneUI();

            // Llenar selector de productores en el modal
            const select = document.getElementById('inf-modal-productor');
            if (select) {
                let html = '<option value="">-- Seleccionar productor... --</option>';
                const prods = this.getAvailableProductores();
                prods.forEach(p => {
                    const sel = (prefillProductor && p === prefillProductor) || (!prefillProductor && p === this.selectedProductor) ? 'selected' : '';
                    html += `<option value="${this.escapeHtml(p)}" ${sel}>${this.escapeHtml(p)}</option>`;
                });
                select.innerHTML = html;
            }

            // Establecer fecha de hoy por defecto
            const fechaInput = document.getElementById('inf-modal-fecha');
            if (fechaInput && !fechaInput.value) {
                const today = new Date().toISOString().split('T')[0];
                fechaInput.value = today;
            }

            // Limpiar inputs
            const tituloInput = document.getElementById('inf-modal-titulo');
            if (tituloInput) tituloInput.value = '';

            const notasInput = document.getElementById('inf-modal-notas');
            if (notasInput) notasInput.value = '';

            const fileInput = document.getElementById('inf-modal-file-input');
            if (fileInput) fileInput.value = '';

            modal.classList.add('active');
            if (window.lucide) window.lucide.createIcons();
        },

        /** Cierra modal de carga */
        closeUploadModal: function () {
            const modal = document.getElementById('modal-upload-informe');
            if (modal) modal.classList.remove('active');
            this.selectedFile = null;
            this.updateDropzoneUI();
        },

        /** Configura la zona Drag & Drop */
        setupDropzone: function () {
            const dropzone = document.getElementById('inf-dropzone');
            const fileInput = document.getElementById('inf-modal-file-input');
            if (!dropzone || !fileInput) return;

            dropzone.addEventListener('click', () => fileInput.click());

            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    this.handleFileSelected(e.target.files[0]);
                }
            });

            ['dragenter', 'dragover'].forEach(eventName => {
                dropzone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.classList.add('dragover');
                }, false);
            });

            ['dragleave', 'drop'].forEach(eventName => {
                dropzone.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropzone.classList.remove('dragover');
                }, false);
            });

            dropzone.addEventListener('drop', (e) => {
                const dt = e.dataTransfer;
                if (dt && dt.files && dt.files[0]) {
                    this.handleFileSelected(dt.files[0]);
                }
            });
        },

        /** Maneja el archivo PDF seleccionado */
        handleFileSelected: function (file) {
            // Validar extensión
            const name = file.name || '';
            if (!name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
                alert('Solo podés seleccionar archivos en formato PDF (.pdf).');
                return;
            }

            // Validar tamaño: máximo 25 MB
            if (file.size > 25 * 1024 * 1024) {
                alert('El archivo supera el tamaño máximo permitido de 25 MB.');
                return;
            }

            this.selectedFile = file;
            this.updateDropzoneUI();

            // Si el título está vacío, autocompletar con el nombre del archivo
            const tituloInput = document.getElementById('inf-modal-titulo');
            if (tituloInput && !tituloInput.value.trim()) {
                const cleanName = name.replace(/\.pdf$/i, '').replace(/[_\\-]/g, ' ');
                tituloInput.value = cleanName;
            }
        },

        /** Actualiza el aspecto de la dropzone según haya archivo o no */
        updateDropzoneUI: function () {
            const dropzone = document.getElementById('inf-dropzone');
            if (!dropzone) return;

            if (this.selectedFile) {
                const size = this.formatBytes(this.selectedFile.size);
                dropzone.innerHTML = `
                    <div class="inf-selected-file">
                        <div class="inf-selected-info">
                            <i data-lucide="file-check" style="width:24px;height:24px;color:#059669;flex-shrink:0;"></i>
                            <div style="min-width:0;">
                                <div class="inf-selected-name">${this.escapeHtml(this.selectedFile.name)}</div>
                                <div class="inf-selected-size">${size} · PDF listo para subir</div>
                            </div>
                        </div>
                        <button type="button" onclick="event.stopPropagation(); InformesApp.clearSelectedFile();" style="background:transparent;border:none;cursor:pointer;color:#dc2626;padding:4px;" title="Quitar archivo">
                            <i data-lucide="x" style="width:18px;height:18px;"></i>
                        </button>
                    </div>
                `;
            } else {
                dropzone.innerHTML = `
                    <div class="inf-dropzone-icon">
                        <i data-lucide="upload-cloud" style="width:26px;height:26px;"></i>
                    </div>
                    <div class="inf-dropzone-txt">Arrastrá tu archivo PDF acá o hacé clic para buscar</div>
                    <div class="inf-dropzone-sub">Formato PDF hasta 25 MB</div>
                `;
            }
            if (window.lucide) window.lucide.createIcons();
        },

        clearSelectedFile: function () {
            this.selectedFile = null;
            const fileInput = document.getElementById('inf-modal-file-input');
            if (fileInput) fileInput.value = '';
            this.updateDropzoneUI();
        },

        /** Configura el formulario de subida */
        setupForm: function () {
            const form = document.getElementById('form-upload-informe');
            if (!form) return;

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.submitUpload();
            });
        },

        /** Envía el informe a la API en la nube */
        submitUpload: async function () {
            const selectProductor = document.getElementById('inf-modal-productor');
            const tituloInput     = document.getElementById('inf-modal-titulo');
            const tipoSelect      = document.getElementById('inf-modal-tipo');
            const fechaInput      = document.getElementById('inf-modal-fecha');
            const notasInput      = document.getElementById('inf-modal-notas');
            const submitBtn       = document.getElementById('inf-btn-submit-upload');

            const productor = selectProductor ? selectProductor.value.trim() : '';

            if (!productor) {
                alert('Por favor, seleccioná un productor.');
                if (selectProductor) selectProductor.focus();
                return;
            }

            if (!this.selectedFile) {
                alert('Por favor, seleccioná el archivo PDF del informe.');
                return;
            }

            const titulo = tituloInput ? tituloInput.value.trim() : '';
            const tipoAnalisis = tipoSelect ? tipoSelect.value.trim() : 'General';
            const fecha = fechaInput ? fechaInput.value.trim() : '';
            const notas = notasInput ? notasInput.value.trim() : '';

            // Preparar FormData para subida multipart
            const formData = new FormData();
            formData.append('action', 'upload');
            formData.append('productor', productor);
            formData.append('titulo', titulo);
            formData.append('tipo_analisis', tipoAnalisis);
            formData.append('fecha', fecha);
            formData.append('notas', notas);
            formData.append('archivo', this.selectedFile);

            // Bloquear botón y mostrar spinner
            const prevBtnHtml = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `<i data-lucide="loader-2" class="animate-spin" style="width:18px;height:18px;"></i> Subiendo a la nube...`;
                if (window.lucide) window.lucide.createIcons();
            }

            try {
                const token = this.getToken();
                const headers = {};
                if (token) headers['Authorization'] = 'Bearer ' + token;

                const res = await fetch('api/informes.php', {
                    method: 'POST',
                    headers,
                    body: formData
                });

                let data;
                try {
                    data = await res.json();
                } catch (e) {
                    throw new Error('El servidor devolvió una respuesta inesperada.');
                }

                if (!res.ok || !data.ok) {
                    throw new Error(data.error || 'Error al subir el informe al servidor.');
                }

                // Éxito: cerrar modal y refrescar
                this.closeUploadModal();
                this.selectedProductor = productor; // Enfocar en el productor subido

                // Toast o mensaje amigable
                this.showToast('✅ Informe guardado con éxito en la nube.');

                await this.fetchData();

            } catch (err) {
                console.error('[Informes] Error subida:', err);
                alert('Error al subir el informe: ' + (err.message || 'Error desconocido'));
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = prevBtnHtml;
                    if (window.lucide) window.lucide.createIcons();
                }
            }
        },

        /** Elimina un informe previa confirmación */
        eliminarInforme: async function (id, titulo) {
            const confirma = confirm(`¿Estás seguro de que deseás eliminar el informe "${titulo}"?\n\nEl archivo PDF se eliminará permanentemente del servidor.`);
            if (!confirma) return;

            try {
                await this.apiFetch('api/informes.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete', id: id })
                });

                this.showToast('🗑️ Informe eliminado del servidor.');
                await this.fetchData();

            } catch (err) {
                console.error('[Informes] Error al eliminar:', err);
                alert('No se pudo eliminar el informe: ' + (err.message || 'Error desconocido'));
            }
        },

        /** Envía informe por WhatsApp al productor */
        compartirWhatsApp: function (id) {
            const item = this.informes.find(x => x.id === id);
            if (!item) {
                alert('No se encontró la información del informe.');
                return;
            }

            const fechaFmt = this.formatFecha(item.fecha);

            // Mensaje profesional pre-formateado
            let msg = `🔬 *VETFIELD PRO — Informe de Laboratorio*\n\n`;
            msg += `Estimado/a *${item.productor}*:\n`;
            msg += `Le comparto el informe con los resultados de laboratorio:\n\n`;
            msg += `📋 *Estudio:* ${item.titulo}\n`;
            if (item.tipo_analisis && item.tipo_analisis !== 'General') {
                msg += `🧪 *Tipo de Análisis:* ${item.tipo_analisis}\n`;
            }
            msg += `📅 *Fecha:* ${fechaFmt}\n`;
            if (item.notas && item.notas.trim() !== '') {
                msg += `📝 *Observaciones Veterinarias:* ${item.notas.trim()}\n`;
            }
            msg += `\n📥 *Acceso directo para ver o descargar el informe en PDF:*\n`;
            msg += `${item.archivo_url}\n\n`;
            msg += `_Documento generado y archivado en VETFIELD PRO_`;

            const encoded = encodeURIComponent(msg);
            const waUrl = `https://api.whatsapp.com/send?text=${encoded}`;

            const opened = window.open(waUrl, '_blank');
            if (!opened) {
                // Fallback si el navegador bloquea popups
                navigator.clipboard.writeText(msg).then(() => {
                    alert('El mensaje con el enlace al informe fue copiado al portapapeles. Podés pegarlo en WhatsApp.');
                }).catch(() => {
                    window.location.href = waUrl;
                });
            }
        },

        /** Copia enlace al portapapeles */
        copiarEnlace: function (url) {
            if (!url) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(() => {
                    this.showToast('🔗 ¡Enlace del PDF copiado al portapapeles!');
                }).catch(() => {
                    prompt('Copiá el enlace del PDF:', url);
                });
            } else {
                prompt('Copiá el enlace del PDF:', url);
            }
        },

        /** Notificación flotante rápida (Toast) */
        showToast: function (mensaje) {
            let toast = document.getElementById('inf-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'inf-toast';
                toast.style.cssText = `
                    position: fixed;
                    bottom: 75px;
                    left: 50%;
                    transform: translateX(-50%) translateY(20px);
                    background: #1e293b;
                    color: #ffffff;
                    padding: 10px 20px;
                    border-radius: 9999px;
                    font-size: 0.86rem;
                    font-weight: 600;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.25);
                    z-index: 9999;
                    opacity: 0;
                    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                    pointer-events: none;
                    white-space: nowrap;
                    border: 1px solid rgba(255,255,255,0.15);
                `;
                document.body.appendChild(toast);
            }

            toast.textContent = mensaje;
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';

            clearTimeout(this._toastTimeout);
            this._toastTimeout = setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(-50%) translateY(20px)';
            }, 3200);
        },

        /** Asigna clase CSS a cada tipo de análisis */
        getTagClass: function (tipo) {
            const t = (tipo || '').toLowerCase();
            if (t.includes('copro') || t.includes('parásit')) return 'inf-tag-coprologia';
            if (t.includes('sangre') || t.includes('sero') || t.includes('bioquím')) return 'inf-tag-sangre';
            if (t.includes('leche') || t.includes('mastitis')) return 'inf-tag-leche';
            if (t.includes('bacteri') || t.includes('antibio') || t.includes('cultivo')) return 'inf-tag-bacteria';
            if (t.includes('necro') || t.includes('patolog')) return 'inf-tag-necropsia';
            return 'inf-tag-general';
        },

        /** Formatea tamaño en bytes a KB/MB */
        formatBytes: function (bytes) {
            const b = parseInt(bytes, 10);
            if (!b || b <= 0) return '0 KB';
            if (b < 1024 * 1024) {
                return (b / 1024).toFixed(0) + ' KB';
            }
            return (b / (1024 * 1024)).toFixed(1) + ' MB';
        },

        /** Formatea fecha YYYY-MM-DD a DD/MM/YYYY */
        formatFecha: function (isoDate) {
            if (!isoDate) return '';
            const parts = isoDate.split('-');
            if (parts.length === 3) {
                return `${parts[2]}/${parts[1]}/${parts[0]}`;
            }
            return isoDate;
        },

        /** Escapa HTML para prevenir inyecciones */
        escapeHtml: function (str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
    };

    // Exponer globalmente
    window.InformesApp = InformesApp;
    window.initInformesView = function () {
        InformesApp.init();
    };

    // Pre-poblar el selector de productores de inmediato si el DOM ya está listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => InformesApp.renderProductorSelector());
    } else {
        InformesApp.renderProductorSelector();
    }

})();
