// ============================================================
// VETFIELD PRO — Service Worker v59 (Offline Resiliente)
// IMPORTANTE: Incrementar CACHE_VERSION al hacer deploy de cambios
// para forzar la actualización del caché en los dispositivos.
// ============================================================

const CACHE_VERSION = 'v68';
const CACHE_NAME = 'vetfield-guacheras-' + CACHE_VERSION;

// ── Recursos CRÍTICOS locales (deben estar todos disponibles) ──
// Si alguno falla el usuario verá pantalla negra → mantener mínimo y seguro.
const CORE_ASSETS = [
    './',
    './index',
    './styles.css',
    './app.js',
    './auth.js',
    './voice.css',
    './voice.js',
    './dashboard.js',
    './logoternero.png',
    './Logoterneroblanco.png',
    './profile_avatar.png',
    './profile_banner.png',
];

// ── Recursos externos (se intenta cachear, pero si fallan NO rompen la instalación) ──
const OPTIONAL_ASSETS = [
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js',
];

// ── Instalación: cachear assets críticos (garantizado) + opcionales (best-effort) ──
self.addEventListener('install', (event) => {
    // Saltar la espera para activar inmediatamente
    self.skipWaiting();

    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // 1. Cachear assets críticos uno a uno y limpiar redirecciones
            console.log('[SW] Cacheando assets críticos...');
            for (const asset of CORE_ASSETS) {
                try {
                    const response = await fetch(asset, { cache: 'reload' });
                    if (!response.ok) {
                        throw new Error(`Fallo al cargar ${asset} (Status: ${response.status})`);
                    }

                    // Si la respuesta fue redireccionada por el servidor (.htaccess),
                    // recreamos la respuesta limpia con redirected: false para evitar
                    // el crash del navegador al servirla en solicitudes de navegación.
                    let responseToCache = response;
                    if (response.redirected) {
                        console.log(`[SW] Detectada redirección en asset crítico: ${asset}. Limpiando...`);
                        const blob = await response.blob();
                        responseToCache = new Response(blob, {
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers
                        });
                    }

                    await cache.put(asset, responseToCache);
                } catch (err) {
                    console.error(`[SW] Error crítico al cachear ${asset}:`, err);
                    throw err; // Hace fallar la instalación del SW
                }
            }
            console.log('[SW] Assets críticos cacheados con éxito.');

            // 2. Cachear assets externos de forma individual — fallos silenciosos.
            console.log('[SW] Intentando cachear assets opcionales (CDN)...');
            const optionalResults = await Promise.allSettled(
                OPTIONAL_ASSETS.map(url =>
                    cache.add(url).catch(err => {
                        console.warn('[SW] Asset opcional no cacheado (OK offline):', url, err.message);
                    })
                )
            );
            console.log('[SW] Instalación completa. Assets opcionales:', optionalResults.length);
        })
    );
});

// ── Activación: limpiar cachés obsoletos y tomar el control ──
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => {
                        console.log('[SW] Eliminando caché obsoleto:', key);
                        return caches.delete(key);
                    })
            );
        }).then(() => {
            console.log('[SW] Activado. Tomando control de todos los clientes.');
            return self.clients.claim();
        })
    );
});

// Helper para realizar fetch con un timeout máximo para evitar bloqueos en redes lentas
function fetchWithTimeout(url, options = {}, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('Timeout de red (2s)'));
        }, timeoutMs);

        fetch(url, options).then((response) => {
            clearTimeout(timeoutId);
            resolve(response);
        }).catch((err) => {
            clearTimeout(timeoutId);
            reject(err);
        });
    });
}

// Helper para realizar fetch con un timeout máximo para evitar bloqueos en redes lentas
function fetchWithTimeout(urlOrRequest, options = null, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('Timeout de red (2s)'));
        }, timeoutMs);

        const fetchPromise = options ? fetch(urlOrRequest, options) : fetch(urlOrRequest);

        fetchPromise.then((response) => {
            clearTimeout(timeoutId);
            resolve(response);
        }).catch((err) => {
            clearTimeout(timeoutId);
            reject(err);
        });
    });
}

// ── Fetch: estrategia según tipo de solicitud ──
self.addEventListener('fetch', (event) => {
    // Solo interceptamos peticiones GET
    if (event.request.method !== 'GET') {
        return;
    }

    const url = new URL(event.request.url);

    // ── 1. API calls → siempre red directa ──
    if (url.pathname.includes('/api/')) {
        return;
    }

    // ── 2. Autenticación de Google → siempre red directa (evita problemas de CORS/Auth) ──
    const AUTH_HOSTS = [
        'accounts.google.com',
        'apis.google.com',
    ];
    if (AUTH_HOSTS.some(h => url.hostname.includes(h))) {
        return;
    }

    // ── 3. Solicitudes de navegación (HTML principal) ──
    if (event.request.mode === 'navigate') {
        const path = url.pathname;

        // Rutas de la App (SPA): cualquier variante de /index
        const isAppPath = (
            path === '/index.html' ||
            path === '/index' ||
            path.startsWith('/index')
        );

        if (isAppPath) {
            // Estrategia Network-First para la App Shell
            event.respondWith(
                fetchWithTimeout('./index', { redirect: 'follow' }, 2000)
                    .then(async (networkResponse) => {
                        let responseToUse = networkResponse;
                        if (networkResponse && networkResponse.redirected) {
                            console.log(`[SW] Detectada redirección en app path: ${path}. Limpiando...`);
                            const blob = await networkResponse.blob();
                            responseToUse = new Response(blob, {
                                status: networkResponse.status,
                                statusText: networkResponse.statusText,
                                headers: networkResponse.headers
                            });
                        }
                        if (responseToUse && responseToUse.status === 200) {
                            const responseClone = responseToUse.clone();
                            caches.open(CACHE_NAME).then((cache) => {
                                cache.put('./index', responseClone);
                            });
                        }
                        return responseToUse;
                    })
                    .catch((err) => {
                        console.log(`[SW] Offline/Red lenta para app path. Buscando cache. Detalle:`, err.message);
                        return caches.match('./index', { ignoreSearch: true }).then((cachedResponse) => {
                            if (cachedResponse) return cachedResponse;
                            return new Response(
                                '<html><body style="font-family:sans-serif;text-align:center;padding:2rem;background:#0d1240;color:#f1f5f9;"><h2>Sin conexión</h2><p>Esta sección no está disponible sin conexión a internet.</p></body></html>',
                                { headers: { 'Content-Type': 'text/html' } }
                            );
                        });
                    })
            );
            return;
        }

        // Raíz (/) -> Cargar de la red directamente. Solo si está offline, usar App Shell del caché.
        // NUNCA cachear la landing page de la raíz bajo './index'.
        if (path === '/' || path === '') {
            event.respondWith(
                fetchWithTimeout(event.request.url, { redirect: 'follow' }, 2500)
                    .catch((err) => {
                        console.log(`[SW] Sin red para raíz, sirviendo App desde caché.`);
                        return caches.match('./index', { ignoreSearch: true }).then((cached) => {
                            if (cached) return cached;
                            return new Response(
                                '<html><body style="font-family:sans-serif;text-align:center;padding:2rem;background:#0d1240;color:#f1f5f9;"><h2>Sin conexión</h2><p>Conéctate a internet para cargar la primera vez.</p></body></html>',
                                { headers: { 'Content-Type': 'text/html' } }
                            );
                        });
                    })
            );
            return;
        }

        // Cualquier otra subpágina de la landing -> siempre red directa
        event.respondWith(
            fetchWithTimeout(event.request.url, { redirect: 'follow' }, 2500)
                .catch(() => {
                    return new Response(
                        '<html><body style="font-family:sans-serif;text-align:center;padding:2rem;background:#0d1240;color:#f1f5f9;"><h2>Sin conexión</h2><p>Esta página no está disponible sin conexión.</p></body></html>',
                        { headers: { 'Content-Type': 'text/html' } }
                    );
                })
        );
        return;
    }

    // ── 4. Recursos Locales (CSS, JS, imágenes locales) → Network-First con timeout ──
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetchWithTimeout(event.request, null, 2000)
                .then((networkResponse) => {
                    if (
                        networkResponse &&
                        networkResponse.status === 200 &&
                        (networkResponse.type === 'basic' || networkResponse.type === 'cors')
                    ) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                })
                .catch((err) => {
                    console.log(`[SW] Offline/Red lenta para recurso local: ${url.pathname}. Buscando en caché...`);
                    return caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
                        if (cachedResponse) return cachedResponse;
                        throw err;
                    });
                })
        );
        return;
    }

    // ── 5. Recursos Externos (CDNs, Fuentes, librerías) → Cache-First ──
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(event.request).then((networkResponse) => {
                if (
                    networkResponse &&
                    networkResponse.status === 200 &&
                    (networkResponse.type === 'basic' || networkResponse.type === 'cors')
                ) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                console.warn('[SW] Sin caché y sin red para recurso externo:', event.request.url);
            });
        })
    );
});
