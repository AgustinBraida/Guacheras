// ============================================================
// VETFIELD PRO — AUTH MODULE v3 (MySQL Edition)
// Migrado de localStorage a API PHP/MySQL centralizada.
// Soporta: Login/Register via API, Google Sign-In, Forgot/Reset.
// La sesión UI se guarda en localStorage solo como CACHÉ.
// El token de autenticación real vive también en localStorage
// y viaja como "Authorization: Bearer <token>" en cada request.
// ============================================================

'use strict';

const SESSION_KEY = 'vetfield_session';   // caché de datos del usuario (UI)
const API_TOKEN_KEY = 'vetfield_api_token'; // token de sesión para la API

const API_AUTH = 'api/auth.php';
const API_GOOGLE = 'api/google_login.php';
const API_FORGOT = 'api/forgot.php';
const API_RESET = 'api/reset.php';
const API_PROFILE_IMAGES = 'api/profile_images.php'; // Imágenes de perfil guardadas en el servidor

// ► Reemplazá esto con tu Google Client ID real:
// Ve a: console.cloud.google.com → APIs y servicios → Credenciales
const GOOGLE_CLIENT_ID = '545046898268-ukkvsriqfnm6769s44phtpm9qonrubnk.apps.googleusercontent.com';

// ─── Validaciones client-side (feedback inmediato) ──────────

function validatePassword(pwd) {
    const ok = pwd.length >= 8 && /[A-Z]/.test(pwd) && /[0-9]/.test(pwd);
    const score = [pwd.length >= 8, /[A-Z]/.test(pwd), /[0-9]/.test(pwd), /[^A-Za-z0-9]/.test(pwd)].filter(Boolean).length;
    let message = '';
    if (pwd.length < 8) message = 'Mínimo 8 caracteres.';
    else if (!/[A-Z]/.test(pwd)) message = 'Agrega al menos una mayúscula.';
    else if (!/[0-9]/.test(pwd)) message = 'Agrega al menos un número.';
    return { valid: ok, score, message };
}

function isValidEmail(e) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
}

// ─── Helper: fetch con token Bearer (A prueba de fallos) ────
async function apiFetch(url, options = {}) {
    try {
        const token = localStorage.getItem(API_TOKEN_KEY);
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
            ...(options.headers || {}),
        };

        const res = await fetch(url, { ...options, headers });

        if (!res.ok && res.status >= 500) {
            return { ok: false, error: 'Error del servidor. Intente más tarde.', status: res.status };
        }

        const data = await res.json().catch(() => ({ ok: false, error: 'Respuesta inesperada del servidor.', status: res.status }));
        if (!res.ok) data.status = res.status;
        return data;

    } catch (error) {
        // Si hay un microcorte, bloqueo de CORS o el server rechaza la conexión, cae acá.
        console.error("Error crítico de red en apiFetch:", error);
        return { ok: false, error: 'Error de red. Verificá tu conexión o intentá de nuevo.', status: 0 };
    }
}
// ─── AuthManager ────────────────────────────────────────────

const AuthManager = {

    getToken() { return localStorage.getItem(API_TOKEN_KEY); },
    getSession() { const r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; },

    _saveSession(user, token) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            id: user.id,
            name: user.nombre,
            email: user.email,
            createdAt: user.created_at,
            role: user.role || 'Veterinario de Campo',
            plan: user.plan !== undefined ? user.plan : 'inicio',
            hasMpSubscription: !!user.has_mp_subscription,
            planExpiresAt: user.plan_expires_at || null,
        }));
        if (token) localStorage.setItem(API_TOKEN_KEY, token);
    },

    logout() {
        // Invalidar sesión en el servidor (fire and forget)
        const token = this.getToken();
        if (token) {
            fetch(API_AUTH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ action: 'logout' }),
            }).catch(() => { });
        }
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(API_TOKEN_KEY);
    },

    // Validar token contra la API al cargar la app
    async validateToken() {
        const token = this.getToken();
        if (!token) return null;

        const data = await apiFetch(API_AUTH, {
            method: 'POST',
            body: JSON.stringify({ action: 'get_session' }),
        });

        if (data.ok && data.user) {
            this._saveSession(data.user, null); // refresh caché UI, mantener token
            return this.getSession();
        }

        // Si hay error 401 explícito (Token Inválido/Expirado/Sesión borrada)
        if (data.status === 401) {
            localStorage.removeItem(SESSION_KEY);
            localStorage.removeItem(API_TOKEN_KEY);
            return null;
        }

        // Cualquier otro error (red, 500, microcortes, timeout), mantenemos la sesión para uso offline
        return this.getSession();
    },

    async register({ name, email, password }) {
        name = name.trim();
        email = email.trim().toLowerCase();
        if (!name || name.length < 2) return { ok: false, error: 'El nombre debe tener al menos 2 caracteres.' };
        if (!isValidEmail(email)) return { ok: false, error: 'Email inválido.' };
        const v = validatePassword(password);
        if (!v.valid) return { ok: false, error: v.message };

        return apiFetch(API_AUTH, {
            method: 'POST',
            body: JSON.stringify({ action: 'register', nombre: name, email, password }),
        });
    },

    async login({ email, password }) {
        email = email.trim().toLowerCase();
        if (!isValidEmail(email)) return { ok: false, error: 'Email inválido.' };
        if (!password) return { ok: false, error: 'Ingresá tu contraseña.' };

        const data = await apiFetch(API_AUTH, {
            method: 'POST',
            body: JSON.stringify({ action: 'login', email, password }),
        });

        if (data.ok && data.user) {
            this._saveSession(data.user, data.token);
        }
        return data;
    },

    async loginWithGoogle(id_token) {
        const data = await apiFetch(API_GOOGLE, {
            method: 'POST',
            body: JSON.stringify({ id_token }),
        });
        if (data.ok && data.user) {
            this._saveSession(data.user, data.token);
        }
        return data;
    },

    async forgotPassword(email) {
        email = email.trim().toLowerCase();
        if (!isValidEmail(email)) return { ok: false, error: 'Email inválido.' };
        return apiFetch(API_FORGOT, {
            method: 'POST',
            body: JSON.stringify({ email }),
        });
    },

    async resetPassword(token, password) {
        const v = validatePassword(password);
        if (!v.valid) return { ok: false, error: v.message };
        return apiFetch(API_RESET, {
            method: 'POST',
            body: JSON.stringify({ token, password }),
        });
    },

    async updateProfile({ name, email, password }) {
        const sess = this.getSession();
        if (!sess) return { ok: false, error: 'Sin sesión.' };
        name = name.trim();
        email = email.trim().toLowerCase();
        if (!name || name.length < 2) return { ok: false, error: 'El nombre debe tener al menos 2 caracteres.' };
        if (!isValidEmail(email)) return { ok: false, error: 'Email inválido.' };

        const body = { action: 'update_profile', nombre: name, email };
        if (password && password.trim()) {
            const v = validatePassword(password);
            if (!v.valid) return { ok: false, error: v.message };
            body.password = password;
        }

        const data = await apiFetch(API_AUTH, { method: 'POST', body: JSON.stringify(body) });
        if (data.ok && data.user) {
            this._saveSession(data.user, null); // token no cambia en update_profile
        }
        return data;
    },

    async cancelSubscription() {
        return apiFetch(API_AUTH, {
            method: 'POST',
            body: JSON.stringify({ action: 'cancel_subscription' }),
        });
    },

    // ── Cargar imágenes de perfil desde el servidor ──────────
    // Actualiza localStorage con las URLs del servidor para que
    // funcionen en cualquier dispositivo donde el usuario inicie sesión.
    async loadProfileImages() {
        try {
            const data = await apiFetch(API_PROFILE_IMAGES, {
                method: 'POST',
                body: JSON.stringify({ action: 'get' }),
            });
            if (data.ok) {
                // Guardamos solo la URL (liviana) en lugar del base64 pesado
                if (data.avatar_url) localStorage.setItem('custom_avatar', data.avatar_url);
                if (data.banner_url) localStorage.setItem('custom_banner', data.banner_url);
                return data;
            }
        } catch (err) {
            console.warn('[Profile] No se pudieron cargar las imágenes desde el servidor:', err);
        }
        return null;
    },
};

// ─── AuthUI ─────────────────────────────────────────────────

const AuthUI = {

    async init() {
        // 1. Detectar si hay un reset_token en la URL (link del email)
        const urlParams = new URLSearchParams(window.location.search);
        const resetToken = urlParams.get('reset_token');
        const authMsg = urlParams.get('auth_msg');

        if (resetToken) {
            this._showResetPasswordForm(resetToken);
            return;
        }

        if (authMsg === 'confirmado') {
            this._bind();
            this._showAuth();
            this._showSuccessBanner('✅ ¡Cuenta confirmada! Ya podés iniciar sesión.');
            return;
        }

        if (authMsg === 'token_invalido') {
            this._bind();
            this._showAuth();
            this._err('login-error', 'El link de confirmación es inválido o ya fue usado.');
            return;
        }

        this._bind();

        // 2. Carga optimista: si hay sesión cacheada, mostrar la app INMEDIATAMENTE
        // sin esperar la validación de red. Esto elimina la pantalla negra en recargas.
        const cachedSess = AuthManager.getSession();
        const hasToken = !!AuthManager.getToken();

        if (cachedSess && hasToken) {
            // Mostrar app de inmediato con datos del caché (sin esperar la API)
            this._showApp(cachedSess);

            // Validar el token en background; solo cerrar sesión si el server
            // devuelve 401 explícito (token inválido/expirado).
            // Errores de red o 500 se ignoran para soportar uso offline.
            AuthManager.validateToken().then(sess => {
                if (sess) {
                    // Token válido: refrescar datos del perfil silenciosamente
                    this._syncProfile(sess);
                    this._syncAvatar(sess);
                } else if (!AuthManager.getSession()) {
                    // Token rechazado con 401 (se limpió en validateToken):
                    // cerrar sesión y mostrar pantalla de login
                    this._showAuth();
                }
                // Si getSession() sigue teniendo datos fue un error de red → quedarse en la app
            });
            return;
        }

        // 3. Sin sesión cacheada: esperar validación para decidir qué mostrar
        const sess = await AuthManager.validateToken();
        if (sess) {
            this._showApp(sess);
        } else {
            this._showAuth();
            const tab = urlParams.get('tab');
            if (tab === 'register') {
                const regBtn = document.querySelector('[data-tab="register"]');
                if (regBtn) regBtn.click();
            } else if (tab === 'login') {
                const loginBtn = document.querySelector('[data-tab="login"]');
                if (loginBtn) loginBtn.click();
            }
        }
    },

    _showAuth() {
        document.getElementById('auth-screen').style.display = 'flex';
        document.getElementById('main-app').style.display = 'none';
    },

    _showApp(sess) {
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        this._syncAvatar(sess);
        this._syncProfile(sess);
        // Cargar imágenes desde el servidor y refrescar UI (para otros dispositivos)
        AuthManager.loadProfileImages().then(() => {
            this._refreshProfileImages();
        });
        if (typeof window.appLoadForUser === 'function') {
            window.appLoadForUser(sess.id);
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _syncAvatar(sess) {
        const img = document.getElementById('header-user-avatar');
        if (img) {
            const custom = localStorage.getItem('custom_avatar');
            img.src = custom ? custom : 'profile_avatar.png';
            img.title = sess ? sess.name : '';
        }
    },

    // ── Refresca solo los elementos de imagen (sin reescribir todo el perfil) ──
    _refreshProfileImages() {
        const customAvatar = localStorage.getItem('custom_avatar');
        const customBanner = localStorage.getItem('custom_banner');

        if (customAvatar) {
            const headerImg = document.getElementById('header-user-avatar');
            const profileImg = document.getElementById('profile-avatar-img');
            if (headerImg) headerImg.src = customAvatar;
            if (profileImg) profileImg.src = customAvatar;
        }
        if (customBanner) {
            const heroBg = document.getElementById('profile-hero-bg');
            if (heroBg) {
                heroBg.style.backgroundImage = `url('${customBanner}')`;
            }
        }
    },

    _syncProfile(sess) {
        const $ = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        $('profile-display-name', sess.name);
        $('profile-display-email', sess.email);
        $('profile-display-date', new Date(sess.createdAt).toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' }));
        $('profile-display-role', sess.role || 'Veterinario de Campo');
        const img = document.getElementById('profile-avatar-img');
        if (img) {
            const customAvatar = localStorage.getItem('custom_avatar');
            img.src = customAvatar ? customAvatar : 'profile_avatar.png';
        }
        const heroBg = document.getElementById('profile-hero-bg');
        if (heroBg) {
            const customBanner = localStorage.getItem('custom_banner');
            if (customBanner) {
                heroBg.style.backgroundImage = `url('${customBanner}')`;
            } else {
                heroBg.style.backgroundImage = `url('profile_banner.png?v=49')`;
            }
        }
        const en = document.getElementById('edit-name'); if (en) en.value = sess.name;
        const ee = document.getElementById('edit-email'); if (ee) ee.value = sess.email;

        // Renderizado del plan y botón de suscripción/cancelación
        const plan = sess.plan !== undefined ? sess.plan : 'inicio';
        const displayPlanEl = document.getElementById('profile-display-plan');
        const subDescEl = document.getElementById('profile-subscription-desc');
        const actionContainer = document.getElementById('profile-subscription-action-container');

        if (displayPlanEl && subDescEl && actionContainer) {
            let planText = 'Plan Inicio (Beta Gratuita)';
            let descText = 'Estás utilizando la versión gratuita de vetfield.pro. Mejorá tu plan para obtener productores y registros ilimitados.';
            let actionHtml = `
                <a href="https://vetfield.pro/#pricing" target="_blank" class="btn-save" style="margin-top:0; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:0.6rem 1.2rem; font-size:0.85rem; border-radius:12px; background:var(--secondary); text-decoration:none; color:white; font-weight:700;">
                    Mejorar Plan
                </a>
            `;

            if (plan === null) {
                planText = 'Legacy (Sin Límites)';
                descText = 'Tu cuenta fue creada antes de la introducción de los planes de pago, por lo que tenés acceso ilimitado.';
                actionHtml = '';
            } else if (plan === 'pro' || plan === 'premium') {
                const planName = plan === 'pro' ? 'Pro' : 'Premium';
                planText = `Plan ${planName}`;
                
                if (sess.planExpiresAt) {
                    const expDate = new Date(sess.planExpiresAt);
                    const now = new Date();
                    const diffTime = expDate - now;
                    const diffDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
                    
                    descText = `Tu suscripción al Plan ${planName} ha sido cancelada. Conservarás el acceso completo durante los días pagados restantes. Te quedan ${diffDays} días de acceso (expira el ${expDate.toLocaleDateString('es-AR')}). Transcurridos 2 meses de la expiración sin renovación, tus datos cargados se eliminarán automáticamente por inactividad.`;
                    actionHtml = `
                        <a href="https://vetfield.pro/#pricing" target="_blank" class="btn-save" style="margin-top:0; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:0.6rem 1.2rem; font-size:0.85rem; border-radius:12px; background:var(--secondary); text-decoration:none; color:white; font-weight:700;">
                            Reactivar Plan
                        </a>
                    `;
                } else {
                    descText = `Estás suscripto al Plan ${planName}. Podés cancelar tu suscripción en cualquier momento. Al hacerlo, conservarás el acceso hasta finalizar el período pago y no se te cobrará más.`;
                    if (sess.hasMpSubscription) {
                        actionHtml = `
                            <button onclick="AuthUI.cancelSubscription()" class="btn-save" style="margin-top:0; border:none; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:0.6rem 1.2rem; font-size:0.85rem; border-radius:12px; background:#dc2626; color:white; font-weight:700; cursor:pointer;">
                                Cancelar Suscripción
                            </button>
                        `;
                    } else {
                        actionHtml = `
                            <a href="https://wa.me/5493564331711?text=Hola%20quiero%20gestionar%20mi%20suscripci%C3%B3n%20Plan%20${planName}" target="_blank" class="btn-save" style="margin-top:0; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:0.6rem 1.2rem; font-size:0.85rem; border-radius:12px; background:#dc2626; text-decoration:none; color:white; font-weight:700;">
                                Cancelar Suscripción
                            </a>
                        `;
                    }
                }
            }

            displayPlanEl.textContent = planText;
            subDescEl.textContent = descText;
            actionContainer.innerHTML = actionHtml;
        }

        // Marcar botones Premium-only visualmente para planes que no tienen acceso.
        const _premiumOnlyBtns = [
            document.querySelector('button[onclick="exportDashboardPDF(this)"]'),
            document.getElementById('btn-export-backup'),
        ];
        const _isPremiumOnly = (plan === 'inicio' || plan === 'pro');
        _premiumOnlyBtns.forEach(function (btn) {
            if (!btn) return;
            if (_isPremiumOnly) {
                btn.title = 'Exclusivo Plan Premium — mejorá tu plan para usar esta función';
                btn.style.opacity = '0.55';
                btn.style.cursor = 'not-allowed';
                if (!btn.querySelector('.vf-premium-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'vf-premium-badge';
                    badge.textContent = ' ⭐ Premium';
                    badge.style.cssText = 'font-size:0.7em; vertical-align:middle; opacity:0.8; margin-left:4px;';
                    btn.appendChild(badge);
                }
            } else {
                btn.title = '';
                btn.style.opacity = '';
                btn.style.cursor = '';
                const badge = btn.querySelector('.vf-premium-badge');
                if (badge) badge.remove();
            }
        });
    },

    _bound: false,

    _bind() {
        if (this._bound) return;
        this._bound = true;

        // Tabs
        document.querySelectorAll('.auth-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
                btn.classList.add('active');
                const f = document.getElementById('auth-form-' + btn.dataset.tab)
                    || (btn.dataset.tab === 'login' ? document.getElementById('login-form') : document.getElementById('register-form'));
                if (f) f.classList.add('active');
                this._clearErrors();
            });
        });

        // Login submit
        document.getElementById('login-form')?.addEventListener('submit', async e => { e.preventDefault(); await this._doLogin(); });

        // Register submit
        document.getElementById('register-form')?.addEventListener('submit', async e => { e.preventDefault(); await this._doRegister(); });

        // Forgot password
        document.getElementById('forgot-form')?.addEventListener('submit', async e => { e.preventDefault(); await this._doForgot(); });

        // Toggle forgot
        document.getElementById('link-forgot')?.addEventListener('click', e => {
            e.preventDefault();
            this._clearErrors();
            document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
            document.getElementById('forgot-form')?.classList.add('active');
        });
        document.getElementById('link-back-to-login')?.addEventListener('click', e => {
            e.preventDefault();
            document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
            document.getElementById('login-form')?.classList.add('active');
        });

        // Password strength (register)
        document.getElementById('reg-password')?.addEventListener('input', e => {
            const bar = document.getElementById('pwd-strength-bar');
            if (bar) { bar.style.display = e.target.value ? 'block' : 'none'; this._strength(e.target.value, 'pwd-strength-bar'); }
        });

        // Confirm password live
        document.getElementById('reg-confirm')?.addEventListener('input', () => {
            const p = document.getElementById('reg-password')?.value;
            const c = document.getElementById('reg-confirm')?.value;
            const el = document.getElementById('confirm-error');
            if (el) { el.textContent = (c && c !== p) ? 'Las contraseñas no coinciden.' : ''; el.style.display = (c && c !== p) ? 'block' : 'none'; }
        });

        // Logout
        document.getElementById('btn-logout')?.addEventListener('click', () => this._doLogout());

        // Profile save
        document.getElementById('profile-edit-form')?.addEventListener('submit', async e => { e.preventDefault(); await this._doProfileSave(); });

        // Profile password strength
        document.getElementById('edit-new-password')?.addEventListener('input', e => {
            const bar = document.getElementById('profile-pwd-strength');
            if (!bar) return;
            if (e.target.value) { this._strength(e.target.value, 'profile-pwd-strength'); bar.style.display = 'block'; }
            else { bar.style.display = 'none'; bar.innerHTML = ''; }
        });

        // 1. Definir callback global (Debe estar listo antes de inicializar el SDK)
        window.handleGoogleSignIn = async (response) => {
            const btnContainer = document.getElementById('btn-google-container');
            // Nota: Aquí no podemos poner el "loading" text tradicional fácil, el botón oficial gestiona su UI.
            const r = await AuthManager.loginWithGoogle(response.credential);
            if (r.ok) {
                this._showApp(AuthManager.getSession());
                if (typeof showToast === 'function') showToast(`¡Bienvenido, ${AuthManager.getSession().name}!`);
            } else {
                this._err('login-error', r.error || 'No se pudo iniciar sesión con Google.');
            }
        };

        // 2. Inicializar SDK y renderizar el botón oficial
        this._initGoogleAuth();

    },

    async _doLogin() {
        this._clearErrors();
        const email = document.getElementById('login-email')?.value || '';
        const password = document.getElementById('login-password')?.value || '';
        if (!email || !password) return this._err('login-error', 'Completá todos los campos.');
        const btn = document.getElementById('btn-login');
        this._setBtnLoading(btn, 'Verificando...');

        try {
            const r = await AuthManager.login({ email, password });
            if (r.ok) {
                this._showApp(AuthManager.getSession());
                if (typeof showToast === 'function') showToast(`¡Bienvenido, ${AuthManager.getSession().name}!`);
            } else {
                this._err('login-error', r.error);
                this._setBtnReady(btn, 'Iniciar Sesión');
                document.getElementById('login-form')?.classList.add('shake');
                setTimeout(() => document.getElementById('login-form')?.classList.remove('shake'), 500);
            }
        } catch (error) {
            this._err('login-error', 'Error de conexión.');
            this._setBtnReady(btn, 'Iniciar Sesión');
            setTimeout(() => document.getElementById('login-form')?.classList.remove('shake'), 500);
        }
    },

    async _doRegister() {
        this._clearErrors();
        if (document.getElementById('hp-field')?.value) return; // Honeypot
        const name = document.getElementById('reg-name')?.value || '';
        const email = document.getElementById('reg-email')?.value || '';
        const password = document.getElementById('reg-password')?.value || '';
        const confirm = document.getElementById('reg-confirm')?.value || '';
        if (!name || !email || !password || !confirm) return this._err('register-error', 'Completá todos los campos.');
        if (password !== confirm) return this._err('register-error', 'Las contraseñas no coinciden.');
        const btn = document.getElementById('btn-register');
        this._setBtnLoading(btn, 'Creando cuenta...');
        const r = await AuthManager.register({ name, email, password });
        if (r.ok) {
            // Registro exitoso → Mostrar Popup y luego volver al login
            if (typeof showAlert === 'function') {
                showAlert(
                    '¡Cuenta Creada!',
                    'Te enviamos un correo de confirmación. Por favor, revisá tu casilla (y la carpeta de spam) para activar tu cuenta antes de ingresar.',
                    'mail'
                );
            }
            this._showSuccessBanner('📬 Revisá tu email para confirmar la cuenta.');
            this._setBtnReady(btn, 'Crear Cuenta');
            // Volver al tab de login
            document.querySelector('[data-tab="login"]')?.click();
        } else {

            this._err('register-error', r.error);
            this._setBtnReady(btn, 'Crear Cuenta');
        }
    },

    async _doForgot() {
        this._clearErrors();
        const email = document.getElementById('forgot-email')?.value || '';
        if (!email) return this._err('forgot-error', 'Ingresá tu email.');
        const btn = document.getElementById('btn-forgot');
        this._setBtnLoading(btn, 'Enviando...');
        const r = await AuthManager.forgotPassword(email);
        if (r.ok) {
            this._showSuccessBanner('📬 ' + (r.message || 'Revisá tu email para restablecer la contraseña.'));
        } else {
            this._err('forgot-error', r.error);
        }
        this._setBtnReady(btn, 'Enviar Link');
    },

    _showResetPasswordForm(token) {
        document.getElementById('auth-screen').style.display = 'flex';
        document.getElementById('main-app').style.display = 'none';
        this._bind();

        // Activar el form de reset
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        const resetForm = document.getElementById('reset-form');
        if (resetForm) {
            resetForm.classList.add('active');
            resetForm.dataset.token = token;
        }

        resetForm?.addEventListener('submit', async e => {
            e.preventDefault();
            const password = document.getElementById('reset-password')?.value || '';
            const confirm = document.getElementById('reset-confirm')?.value || '';
            if (password !== confirm) return this._err('reset-error', 'Las contraseñas no coinciden.');
            const btn = document.getElementById('btn-reset');
            this._setBtnLoading(btn, 'Restableciendo...');
            const r = await AuthManager.resetPassword(token, password);
            if (r.ok) {
                this._showSuccessBanner('✅ ' + r.message);
                document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
                document.getElementById('login-form')?.classList.add('active');
                // Limpiar token de la URL
                window.history.replaceState({}, '', window.location.pathname);
            } else {
                this._err('reset-error', r.error);
                this._setBtnReady(btn, 'Cambiar Contraseña');
            }
        });
    },

    async _doProfileSave() {
        this._clearErrors();
        const btn = document.getElementById('btn-save-profile');
        const name = document.getElementById('edit-name')?.value || '';
        const email = document.getElementById('edit-email')?.value || '';
        const pwd = document.getElementById('edit-new-password')?.value || '';
        this._setBtnLoading(btn, 'Guardando...');
        const r = await AuthManager.updateProfile({ name, email, password: pwd || undefined });
        if (r.ok) {
            const sess = AuthManager.getSession();
            this._syncProfile(sess);
            this._syncAvatar(sess);
            if (document.getElementById('edit-new-password')) document.getElementById('edit-new-password').value = '';
            const bar = document.getElementById('profile-pwd-strength');
            if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
            if (typeof showToast === 'function') showToast('Perfil actualizado.');
        } else {
            this._err('profile-error', r.error);
        }
        this._setBtnReady(btn, '✓ Guardar Cambios');
    },

    async cancelSubscription() {
        const confirmMsg = "¿Estás seguro de que deseas cancelar tu suscripción?\n\n" +
                           "Al hacerlo:\n" +
                           "1. Se suspenderán todos los cobros futuros inmediatamente.\n" +
                           "2. Conservarás tu acceso Pro/Premium hasta que termine el período de facturación actual.\n" +
                           "3. Si no vuelves a suscribirte pasados 2 meses de la expiración, tus datos cargados se borrarán automáticamente.\n\n" +
                           "¿Deseas confirmar la cancelación?";
        if (!confirm(confirmMsg)) return;

        const container = document.getElementById('profile-subscription-action-container');
        const originalHtml = container ? container.innerHTML : '';
        if (container) {
            container.innerHTML = `<span class="auth-spinner" style="border-color:#dc2626; border-top-color:transparent; width:14px; height:14px; margin-right:6px; vertical-align:middle;"></span> Procesando...`;
        }

        try {
            const res = await AuthManager.cancelSubscription();
            if (res.ok && res.user) {
                // Actualizar sesión y sincronizar UI
                AuthManager._saveSession(res.user, null);
                this._syncProfile(res.user);
                this._syncAvatar(res.user);
                
                if (typeof showToast === 'function') {
                    showToast('✅ Suscripción cancelada con éxito.');
                }
            } else {
                if (container) container.innerHTML = originalHtml;
                alert(res.error || 'Ocurrió un error al procesar la cancelación. Por favor, intente de nuevo.');
            }
        } catch (err) {
            if (container) container.innerHTML = originalHtml;
            console.error(err);
            alert('Error de red al intentar cancelar la suscripción.');
        }
    },

    _doLogout() {
        const btn = document.getElementById('btn-logout');
        if (!btn) return;
        if (btn.dataset.confirm === '1') {
            AuthManager.logout();
            btn.dataset.confirm = '0'; btn.style.cssText = ''; btn.textContent = 'Cerrar Sesión';

            // Limpiar formularios y asegurar el estado "Listo" de los botones
            document.getElementById('login-form')?.reset();
            const btnLogin = document.getElementById('btn-login');
            if (btnLogin) {
                btnLogin.disabled = false;
                btnLogin.textContent = 'Iniciar Sesión';
            }
            this._clearErrors();

            this._showAuth();
            document.querySelector('[data-tab="login"]')?.click();
        } else {
            btn.dataset.confirm = '1'; btn.style.background = '#dc2626'; btn.style.color = '#fff';
            btn.textContent = '¿Confirmar cierre de sesión?';
            setTimeout(() => { if (btn.dataset.confirm === '1') { btn.dataset.confirm = '0'; btn.style.cssText = ''; btn.textContent = 'Cerrar Sesión'; } }, 3000);
        }
    },

    // ── Google Sign-In: inicialización programática ────────────
    _initGoogleAuth() {
        const tryInit = () => {
            if (window.google?.accounts?.id && document.getElementById('btn-google-container')) {
                // Inicializar
                window.google.accounts.id.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    callback: window.handleGoogleSignIn,
                    auto_select: false,
                    cancel_on_tap_outside: true,
                });

                // Renderizar el botón oficial en el contenedor
                window.google.accounts.id.renderButton(
                    document.getElementById('btn-google-container'),
                    {
                        theme: 'outline',
                        size: 'large',
                        text: 'continue_with',
                        shape: 'pill',
                        width: 280
                    }
                );
            } else {
                // Reintentar si el SDK o el DOM no están listos
                setTimeout(tryInit, 300);
            }
        };
        tryInit();
    },




    _showSuccessBanner(msg) {
        const el = document.getElementById('auth-success-banner');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
    },

    _strength(pwd, containerId) {
        const bar = document.getElementById(containerId);
        if (!bar) return;
        const { score } = validatePassword(pwd);
        const levels = ['', 'Débil', 'Regular', 'Buena', 'Fuerte'];
        const colors = ['', '#ef4444', '#f59e0b', '#3b82f6', '#22c55e'];
        bar.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;"><div style="flex:1;height:4px;background:#e2e8f0;border-radius:99px;overflow:hidden;"><div style="width:${(score / 4) * 100}%;height:100%;background:${colors[score]};border-radius:99px;transition:all 0.3s;"></div></div><span style="font-size:0.7rem;font-weight:700;color:${colors[score]};min-width:50px;text-align:right;">${levels[score] || ''}</span></div>`;
    },

    _err(id, msg) {
        const el = document.getElementById(id);
        if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
    },

    _clearErrors() {
        document.querySelectorAll('.auth-error-msg').forEach(el => { el.textContent = ''; el.style.display = 'none'; });
        const banner = document.getElementById('auth-success-banner');
        if (banner) banner.style.display = 'none';
    },

    _setBtnLoading(btn, txt) {
        if (!btn) return;
        btn.disabled = true;
        btn.innerHTML = `<span class="auth-spinner"></span> ${txt}`;
    },

    _setBtnReady(btn, txt) {
        if (!btn) return;
        btn.disabled = false;
        btn.textContent = txt;
    },
};

// Global handler for image uploads (Avatar y Banner)
// 1. Muestra la imagen inmediatamente (UX óptima)
// 2. La sube al servidor para que persista en todos los dispositivos
// 3. Guarda la URL del servidor en localStorage (reemplaza el base64 pesado)
window.handleImageUpload = function (event, type) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        alert('La imagen es demasiado grande. Por favor, elegí una imagen menor a 5 MB.');
        return;
    }

    const reader = new FileReader();
    reader.onload = async function (e) {
        const base64 = e.target.result;

        // ── 1. Actualizar UI de forma inmediata (optimistic update) ──
        if (type === 'avatar') {
            const headerImg = document.getElementById('header-user-avatar');
            const profileImg = document.getElementById('profile-avatar-img');
            if (headerImg) headerImg.src = base64;
            if (profileImg) profileImg.src = base64;
            // Guardado temporal en localStorage (base64) por si falla el servidor
            try { localStorage.setItem('custom_avatar', base64); } catch (_) { }
        } else if (type === 'banner') {
            const heroBg = document.getElementById('profile-hero-bg');
            if (heroBg) heroBg.style.backgroundImage = `url('${base64}')`;
            try { localStorage.setItem('custom_banner', base64); } catch (_) { }
        }

        // ── 2. Subir al servidor ─────────────────────────────────────
        const token = localStorage.getItem('vetfield_api_token');
        if (!token) {
            // Sin sesión válida: la imagen queda solo local
            console.warn('[Profile] Sin token, imagen guardada solo localmente.');
            return;
        }

        try {
            if (typeof showToast === 'function') showToast('Subiendo imagen...');

            const res = await apiFetch(API_PROFILE_IMAGES, {
                method: 'POST',
                body: JSON.stringify({ action: 'save', type, image: base64 }),
            });

            if (res.ok && res.url) {
                // Reemplazar el base64 pesado por la URL liviana del servidor
                if (type === 'avatar') {
                    localStorage.setItem('custom_avatar', res.url);
                    // Actualizar src con la URL definitiva del servidor
                    const headerImg = document.getElementById('header-user-avatar');
                    const profileImg = document.getElementById('profile-avatar-img');
                    if (headerImg) headerImg.src = res.url;
                    if (profileImg) profileImg.src = res.url;
                } else {
                    localStorage.setItem('custom_banner', res.url);
                    const heroBg = document.getElementById('profile-hero-bg');
                    if (heroBg) heroBg.style.backgroundImage = `url('${res.url}')`;
                }
                if (typeof showToast === 'function') showToast('✅ Imagen guardada — se verá en todos tus dispositivos.');
            } else {
                // El servidor falló, pero la imagen quedó en localStorage (base64)
                console.warn('[Profile] Error al subir al servidor:', res.error);
                if (typeof showToast === 'function') showToast('⚠️ Imagen guardada solo en este dispositivo.');
            }
        } catch (err) {
            console.error('[Profile] Error de red al subir imagen:', err);
            if (typeof showToast === 'function') showToast('⚠️ Sin conexión. Imagen guardada solo en este dispositivo.');
        }
    };
    reader.readAsDataURL(file);
};

// Global: toggle password visibility (llamado desde onclick en HTML)
function authToggleEye(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isText = input.type === 'text';
    input.type = isText ? 'password' : 'text';
    const svg = btn.querySelector('svg');
    if (svg) {
        svg.innerHTML = isText
            ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
            : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    }
}

document.addEventListener('DOMContentLoaded', () => AuthUI.init());
