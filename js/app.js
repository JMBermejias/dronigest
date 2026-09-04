// URL publica del backend (Railway). Todos los dispositivos apuntan aqui.
// Se puede sobreescribir por dispositivo en la pantalla "Sincronizacion".
window.DRONIGEST_API_URL = 'https://dronigest-backend-production.up.railway.app';

const Dronigest = {
    userLocation: null,

    init() {
        this.Navigation.init();
        this.DB.init();
        this.Dashboard.init();
        this.Geolocation.init();
        this.Meteo.init();
        this.setupInstallPrompt();
        this.registerSW();

        // Inicializar UI de usuario y exigir inicio de sesion si hay backend
        this.Auth.actualizarUI();
        if (this.DB._apiUrl() && !this.Auth.haySesion()) {
            this.mostrarBloqueo();
            this.Auth.mostrarPantalla('login');
        }
    },

    mostrarBloqueo() {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const pageTitle = document.getElementById('pageTitle');
        if (pageTitle) pageTitle.textContent = 'Inicia sesión para continuar';
    },

    registerSW() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').then(reg => {
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'activated') {
                                Dronigest.Toast.show('App actualizada. Recarga para ver los cambios.', 'info');
                            }
                        });
                    }
                });
            }).catch(() => {});
        }

        const params = new URLSearchParams(window.location.search);
        const page = params.get('page');
        if (page) {
            setTimeout(() => Dronigest.Navigation.goTo(page), 300);
        }
    },

    setupInstallPrompt() {
        let deferredPrompt;
        let installDismissed = localStorage.getItem('dronigest_install_dismissed');

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;

            if (installDismissed) return;

            const btn = document.getElementById('btnInstall');
            if (btn) {
                btn.style.display = 'inline-flex';
                btn.onclick = () => {
                    deferredPrompt.prompt();
                    deferredPrompt.userChoice.then((result) => {
                        if (result.outcome === 'accepted') {
                            Dronigest.Toast.show('App instalada correctamente', 'success');
                        }
                        deferredPrompt = null;
                    });
                };
            }

            const banner = document.getElementById('installBanner');
            if (banner && !installDismissed) {
                setTimeout(() => {
                    banner.style.display = 'block';
                }, 5000);

                const installBtn = document.getElementById('installBannerBtn');
                const closeBtn = document.getElementById('installBannerClose');

                if (installBtn) {
                    installBtn.onclick = () => {
                        deferredPrompt.prompt();
                        deferredPrompt.userChoice.then((result) => {
                            if (result.outcome === 'accepted') {
                                Dronigest.Toast.show('App instalada correctamente', 'success');
                                banner.style.display = 'none';
                            }
                            deferredPrompt = null;
                        });
                    };
                }

                if (closeBtn) {
                    closeBtn.onclick = () => {
                        banner.style.display = 'none';
                        localStorage.setItem('dronigest_install_dismissed', '1');
                        installDismissed = '1';
                    };
                }
            }
        });

        window.addEventListener('appinstalled', () => {
            deferredPrompt = null;
            const banner = document.getElementById('installBanner');
            if (banner) banner.style.display = 'none';
            Dronigest.Toast.show('Dronigest instalada en tu dispositivo', 'success');
        });

        if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
            const btn = document.getElementById('btnInstall');
            if (btn) btn.style.display = 'none';
        }
    }
};

/* ===== DATABASE ===== */
/*
 * Dronigest.DB - Acceso a datos con sincronizacion en la nube.
 *
 * La app mantiene un cache en memoria ([] por defecto) y, cuando hay backend
 * configurado, sincroniza con el servidor REST. Si el backend no esta
 * disponible, la app funciona con datos locales (localStorage) como fallback.
 *
 * Configuracion (constantes, ver configuración al final de this block):
 *   DRONIGEST_API_URL - URL del backend REST (ej: https://mi-backend.com)
 *   DRONIGEST_API_TOKEN - Token opcional de autenticacion
 */
Dronigest.DB = {
    _cache: {},
    _ready: false,
    _online: false,
    _pending: {},

    init() {
        const defaults = {
            vuelos: [], pilotos: [], auxiliares: [], tiposVuelo: [],
            categorias: [], drones: [], modelos: [], accesorios: [],
            trabajos: [], inspecciones: [], agricola: [], checklists: [],
            cinegetico: [], zonasCineg: [], especiesCineg: [],
            actividad: [], categoriasAesa: []
        };
        // Inicializa el cache desde localStorage (fallback offline)
        Object.keys(defaults).forEach(k => {
            this._cache[k] = JSON.parse(localStorage.getItem('dronigest_' + k) || 'null') || defaults[k];
        });
        if (this.get('categoriasAesa').length === 0) {
            const now = Date.now().toString(36);
            this.set('categoriasAesa', [
                { id: now + 'a', nombre: 'A1-A3', descripcion: 'Categoría abierta A1-A3' },
                { id: now + 'b', nombre: 'A2', descripcion: 'Categoría abierta A2' },
                { id: now + 'c', nombre: 'STS', descripcion: 'STS Categoría específica' }
            ]);
        }
        // Si hay backend configurado y una sesion de usuario activa,
        // intenta cargar los datos de la nube
        if (this._apiUrl() && this._sessionToken()) {
            this._syncFromCloud();
        }
        return this;
    },

    _apiUrl() {
        return window.DRONIGEST_API_URL || localStorage.getItem('dronigest_api_url') || '';
    },

    // Token de sesion del usuario (devuelto por /api/auth/login|register)
    _sessionToken() {
        return localStorage.getItem('dronigest_user_token') || '';
    },

    _currentUser() {
        return localStorage.getItem('dronigest_user_name') || '';
    },

    _apiHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const token = this._sessionToken();
        if (token) headers['x-auth-token'] = token;
        return headers;
    },

    async _request(method, url, body) {
        const opts = { method, headers: this._apiHeaders() };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const res = await fetch(url, opts);
        if (res.status === 401 && Dronigest.Auth) {
            Dronigest.Auth.cerrar({ silencioso: true });
            throw new Error('Sesión caducada');
        }
        if (!res.ok) throw new Error('API error ' + res.status);
        return res.json();
    },

    _emitChange() {
        document.dispatchEvent(new CustomEvent('dronigest:data', { detail: {} }));
    },

    async _syncFromCloud() {
        const base = this._apiUrl().replace(/\/$/, '');
        try {
            const all = await this._request('GET', base + '/api/data');
            Object.keys(all).forEach(k => {
                if (Array.isArray(all[k])) this._cache[k] = all[k];
            });
            this._online = true;
            this._persistLocal();
            this._emitChange();
            if (window.Dronigest && Dronigest.Toast) {
                Dronigest.Toast.show('Datos sincronizados con la nube', 'success');
            }
        } catch (e) {
            this._online = false;
        }
        this._ready = true;
    },

    _persistLocal() {
        Object.keys(this._cache).forEach(k => {
            localStorage.setItem('dronigest_' + k, JSON.stringify(this._cache[k]));
        });
    },

    get(key) {
        return this._cache[key] || [];
    },

    set(key, data) {
        this._cache[key] = data;
        localStorage.setItem('dronigest_' + key, JSON.stringify(data));
        if (this._apiUrl()) {
            const base = this._apiUrl().replace(/\/$/, '');
            this._request('PUT', base + '/api/data/' + key, data).catch(() => {});
        }
        this._emitChange();
    },

    add(key, item) {
        const data = (this._cache[key] || []).slice();
        item.id = item.id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5));
        item.creado = item.creado || new Date().toISOString();
        data.push(item);
        this._cache[key] = data;
        localStorage.setItem('dronigest_' + key, JSON.stringify(data));
        if (this._apiUrl()) {
            const base = this._apiUrl().replace(/\/$/, '');
            this._request('POST', base + '/api/data/' + key, item).catch(() => {});
        }
        this._emitChange();
        return item;
    },

    update(key, id, updates) {
        const data = (this._cache[key] || []).slice();
        const idx = data.findIndex(i => i.id === id);
        if (idx >= 0) {
            data[idx] = { ...data[idx], ...updates, modificado: new Date().toISOString() };
            this._cache[key] = data;
            localStorage.setItem('dronigest_' + key, JSON.stringify(data));
            if (this._apiUrl()) {
                const base = this._apiUrl().replace(/\/$/, '');
                this._request('PUT', base + '/api/data/' + key + '/' + id, data[idx]).catch(() => {});
            }
            this._emitChange();
            return data[idx];
        }
        return null;
    },

    remove(key, id) {
        const data = (this._cache[key] || []).filter(i => i.id !== id);
        this._cache[key] = data;
        localStorage.setItem('dronigest_' + key, JSON.stringify(data));
        if (this._apiUrl()) {
            const base = this._apiUrl().replace(/\/$/, '');
            this._request('DELETE', base + '/api/data/' + key + '/' + id).catch(() => {});
        }
        this._emitChange();
    },

    find(key, id) {
        return (this._cache[key] || []).find(i => i.id === id) || null;
    },

    logActividad(tipo, titulo, detalle) {
        const act = (this._cache['actividad'] || []).slice();
        act.unshift({ tipo, titulo, detalle, fecha: new Date().toISOString() });
        if (act.length > 50) act.length = 50;
        this._cache['actividad'] = act;
        localStorage.setItem('dronigest_actividad', JSON.stringify(act));
        if (this._apiUrl()) {
            const base = this._apiUrl().replace(/\/$/, '');
            this._request('PUT', base + '/api/data/actividad', act).catch(() => {});
        }
    }
};

/* ===== AUTH (registro/login de usuario) ===== */
Dronigest.Auth = {
    mostrarPantalla(pantalla) {
        const overlay = document.getElementById('authOverlay');
        const mode = pantalla || (localStorage.getItem('dronigest_user_mode') === 'register' ? 'register' : 'login');
        if (overlay) overlay.style.display = 'flex';
        this.mostrarFormulario(mode);
    },

    ocultarPantalla() {
        const overlay = document.getElementById('authOverlay');
        if (overlay) overlay.style.display = 'none';
    },

    mostrarFormulario(mode) {
        document.getElementById('authModeTitle').textContent =
            mode === 'register' ? 'Crear cuenta' : 'Iniciar sesión';
        document.getElementById('authLoginMode').style.display =
            mode === 'login' ? 'block' : 'none';
        document.getElementById('authRegisterMode').style.display =
            mode === 'register' ? 'block' : 'none';
        document.getElementById('authToggle').innerHTML =
            mode === 'login'
                ? '¿No tienes cuenta? <a href="#" onclick="Dronigest.Auth.mostrarFormulario(\'register\');return false;">Regístrate</a>'
                : '¿Ya tienes cuenta? <a href="#" onclick="Dronigest.Auth.mostrarFormulario(\'login\');return false;">Inicia sesión</a>';
    },

    async login() {
        const username = document.getElementById('authLoginUser').value.trim();
        const password = document.getElementById('authLoginPass').value;
        if (!username || !password) {
            Dronigest.Toast.show('Introduce usuario y contraseña', 'warning');
            return;
        }
        const btn = document.getElementById('authLoginBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }
        try {
            const res = await fetch(this._apiUrl() + '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');
            this._guardarSesion(data.token, data.username);
        } catch (e) {
            Dronigest.Toast.show(e.message, 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
        }
    },

    async registrar() {
        const username = document.getElementById('authRegUser').value.trim();
        const password = document.getElementById('authRegPass').value;
        const password2 = document.getElementById('authRegPass2').value;
        if (!username || !password || !password2) {
            Dronigest.Toast.show('Rellena todos los campos', 'warning');
            return;
        }
        if (password !== password2) {
            Dronigest.Toast.show('Las contraseñas no coinciden', 'warning');
            return;
        }
        const btn = document.getElementById('authRegBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }
        try {
            const res = await fetch(this._apiUrl() + '/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al registrar');
            this._guardarSesion(data.token, data.username);
        } catch (e) {
            Dronigest.Toast.show(e.message, 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Registrarse'; }
        }
    },

    _guardarSesion(token, username) {
        localStorage.setItem('dronigest_user_token', token);
        localStorage.setItem('dronigest_user_name', username);
        this.ocultarPantalla();
        this.actualizarUI();
        Dronigest.Toast.show('Bienvenido, ' + username, 'success');
        // Cargar los datos cloud del usuario al entrar
        Dronigest.DB._syncFromCloud();
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-dashboard').classList.add('active');
    },

    cerrar(opts) {
        const silencioso = opts && opts.silencioso;
        const token = localStorage.getItem('dronigest_user_token');
        if (token) {
            fetch(this._apiUrl() + '/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': token }
            }).catch(() => {});
        }
        localStorage.removeItem('dronigest_user_token');
        localStorage.removeItem('dronigest_user_name');
        this.actualizarUI();
        if (!silencioso) {
            this.mostrarPantalla('login');
            Dronigest.Toast.show('Sesión cerrada', 'info');
        } else {
            this.mostrarPantalla('login');
        }
    },

    actualizarUI() {
        const user = localStorage.getItem('dronigest_user_name');
        const authInfo = document.getElementById('authUserInfo');
        const logoutBtn = document.getElementById('authLogoutBtn');
        if (user) {
            if (authInfo) { authInfo.textContent = user; authInfo.style.display = 'block'; }
            if (logoutBtn) logoutBtn.style.display = 'inline-block';
        } else {
            if (authInfo) authInfo.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'none';
        }
    },

    _apiUrl() {
        return window.DRONIGEST_API_URL || localStorage.getItem('dronigest_api_url') || '';
    },

    // Devuelve true si hay una sesion de usuario activa
    haySesion() {
        return !!localStorage.getItem('dronigest_user_token');
    }
};

/* ===== SYNC (configuracion del backend) ===== */
Dronigest.Sync = {
    mostrar() {
        const urlEl = document.getElementById('syncApiUrl');
        const tokenEl = document.getElementById('syncApiToken');
        if (urlEl) urlEl.value = localStorage.getItem('dronigest_api_url') || '';
        if (tokenEl) tokenEl.value = localStorage.getItem('dronigest_api_token') || '';
        this.verificar();
    },

    guardar() {
        const url = (document.getElementById('syncApiUrl').value || '').trim().replace(/\/+$/, '');
        const token = (document.getElementById('syncApiToken').value || '').trim();
        localStorage.setItem('dronigest_api_url', url);
        if (token) localStorage.setItem('dronigest_api_token', token);
        else localStorage.removeItem('dronigest_api_token');
        if (url) {
            Dronigest.DB._syncFromCloud().finally(() => {
                this.verificar();
            });
        } else {
            this.verificar();
        }
    },

    desconectar() {
        localStorage.removeItem('dronigest_api_url');
        localStorage.removeItem('dronigest_api_token');
        if (window.Dronigest && Dronigest.Toast) {
            Dronigest.Toast.show('Backend desconectado. Datos locales.', 'info');
        }
        this.verificar();
    },

    async verificar() {
        const url = localStorage.getItem('dronigest_api_url') || '';
        const statusEl = document.getElementById('syncStatus');
        if (!statusEl) return;
        if (!url) {
            statusEl.innerHTML = '<div class="sync-status-item offline"><i class="fas fa-plug"></i> Sin backend configurado. Los datos se guardan solo en este dispositivo.</div>';
            return;
        }
        statusEl.innerHTML = '<div class="sync-status-item checking"><i class="fas fa-spinner fa-spin"></i> Comprobando conexión...</div>';
        try {
            const token = localStorage.getItem('dronigest_api_token') || '';
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['x-api-token'] = token;
            const res = await fetch(url + '/api/health', { headers });
            if (!res.ok) throw new Error('status ' + res.status);
            const data = await res.json();
            const total = data.collections ? data.collections.length : 0;
            statusEl.innerHTML = '<div class="sync-status-item online"><i class="fas fa-check-circle"></i> Conectado. Sincronizando ' + (total || '') + ' colecciones de datos entre dispositivos.</div>';
            Dronigest.DB._syncFromCloud();
        } catch (e) {
            statusEl.innerHTML = '<div class="sync-status-item offline"><i class="fas fa-exclamation-triangle"></i> No se pudo conectar al backend. Revisa la URL o el token (' + e.message + ').</div>';
        }
    }
};

/* ===== NAVIGATION ===== */
Dronigest.Navigation = {
    currentPage: 'dashboard',
    titles: {
        dashboard: 'Dashboard', vuelos: 'Gestion de Vuelos',
        pilotos: 'Pilotos y Auxiliares', tiposVuelo: 'Tipos de Vuelo y Categorias',
        checklists: 'Checklists de Vuelo', equipos: 'Equipos y Drones',
        trabajos: 'Trabajos Realizados', inspecciones: 'Inspecciones',
        agricola: 'Trabajos Agricolas', meteorologia: 'Meteorologia (AEMET)',
        cinegetico: 'Control Cinegetico',
        comunicacion: 'Comunicar Vuelo - Ministerio del Interior',
        categoriasAesa: 'Categorías AESA',
        sync: 'Sincronización en la nube'
    },

    init() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const link = item.querySelector('a');
                if (link && link.target === '_blank') return;
                e.preventDefault();
                this.goTo(item.dataset.page);
            });
        });

        const toggle = document.getElementById('sidebarToggle');
        if (toggle) toggle.onclick = () => document.getElementById('sidebar').classList.toggle('collapsed');

        const mobileBtn = document.getElementById('mobileMenuBtn');
        if (mobileBtn) mobileBtn.onclick = () => {
            document.getElementById('sidebar').classList.toggle('mobile-open');
            document.getElementById('sidebarOverlay').classList.toggle('active');
        };
        const overlay = document.getElementById('sidebarOverlay');
        if (overlay) overlay.onclick = () => {
        document.getElementById('sidebar').classList.remove('mobile-open');
        const ov = document.getElementById('sidebarOverlay');
        if (ov) ov.classList.remove('active');
            overlay.classList.remove('active');
        };
    },

    goTo(page) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

        const pageEl = document.getElementById('page-' + page);
        const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (pageEl) pageEl.classList.add('active');
        if (navEl) navEl.classList.add('active');

        document.getElementById('pageTitle').textContent = this.titles[page] || page;
        this.currentPage = page;
        document.getElementById('sidebar').classList.remove('mobile-open');

        if (page === 'meteorologia') Dronigest.Meteo.obtenerMeteorologia();
        if (page === 'categoriasAesa') Dronigest.CategoriasAesa.listar();
        if (page === 'sync') Dronigest.Sync.mostrar();
    }
};

/* ===== MODAL ===== */
Dronigest.Modal = {
    show(title, bodyHTML, footerHTML) {
        document.getElementById('modalTitle').innerHTML = title;
        document.getElementById('modalBody').innerHTML = bodyHTML;
        document.getElementById('modalFooter').innerHTML = footerHTML || '';
        document.getElementById('modal').style.display = 'flex';
    },
    cerrar() {
        document.getElementById('modal').style.display = 'none';
    }
};

/* ===== TOAST ===== */
Dronigest.Toast = {
    show(msg, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        const icons = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };
        toast.innerHTML = `<i class="fas fa-${icons[type] || 'info-circle'}"></i> ${msg}`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
};

/* ===== GEOLOCATION ===== */
const LOCATION_CACHE_KEY = 'dronigest_last_location';
const MANUAL_LOCATION_KEY = 'dronigest_manual_location';

Dronigest.Geolocation = {
    cityName: '',

    init() {
        const saved = localStorage.getItem(LOCATION_CACHE_KEY);
        if (saved) {
            try {
                Dronigest.userLocation = JSON.parse(saved);
            } catch {}
        }
        const savedCity = localStorage.getItem('dronigest_city_name');
        if (savedCity) {
            try { this.cityName = savedCity; } catch {}
        }
        const el = document.querySelector('#locationInfo span');
        if (el) {
            el.style.cursor = 'pointer';
            el.onclick = () => this.showCitySearch();
            if (this.cityName) el.textContent = this.cityName;
        }
        this.refreshLocation();
    },

    async refreshLocation(forceAuto = false) {
        const manual = localStorage.getItem(MANUAL_LOCATION_KEY);
        if (manual && !forceAuto) {
            try { Dronigest.userLocation = JSON.parse(manual); return Dronigest.userLocation; } catch {}
        }
        let loc = null;
        try {
            if (window.electronAPI && window.electronAPI.getLocation) {
                loc = await window.electronAPI.getLocation();
            }
        } catch {}
        if (!loc && navigator.geolocation) {
            try {
                loc = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(
                        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
                        reject,
                        { enableHighAccuracy: false, timeout: 8000 }
                    );
                });
            } catch {}
        }
        if (!loc) {
            try {
                const r = await fetch('https://ipwho.is/');
                const d = await r.json();
                if (d.success) loc = { lat: d.latitude, lng: d.longitude, city: d.city };
            } catch {}
        }
        if (loc) {
            Dronigest.userLocation = loc;
            localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(loc));
            await this.reverseGeocode(loc.lat, loc.lng, loc.city);
            return loc;
        }
        if (!Dronigest.userLocation) Dronigest.userLocation = { lat: 40.4168, lng: -3.7038 };
        await this.reverseGeocode(Dronigest.userLocation.lat, Dronigest.userLocation.lng);
        return Dronigest.userLocation;
    },

    async setCityByName(name) {
        try {
            const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1&accept-language=es`);
            const data = await r.json();
            if (data.length) {
                const loc = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                Dronigest.userLocation = loc;
                localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(loc));
                localStorage.setItem(MANUAL_LOCATION_KEY, JSON.stringify(loc));
                await this.reverseGeocode(loc.lat, loc.lng);
                Dronigest.Toast.show('Ubicación establecida: ' + data[0].display_name.split(',')[0], 'success');
                return loc;
            }
            Dronigest.Toast.show('Ciudad no encontrada.', 'warning');
        } catch {
            Dronigest.Toast.show('Error al buscar la ciudad.', 'warning');
        }
        return null;
    },

    showCitySearch() {
        const existing = document.getElementById('citySearchOverlay');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'citySearchOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999';
        overlay.innerHTML = `<div style="background:#1a1a2e;border-radius:12px;padding:24px;width:90%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
            <h3 style="margin:0 0 12px;color:#fff">Establecer ubicación</h3>
            <input id="citySearchInput" type="text" placeholder="Escribe tu ciudad..." style="width:100%;padding:10px;border-radius:8px;border:1px solid #333;background:#16213e;color:#fff;font-size:14px;box-sizing:border-box">
            <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
                <button id="citySearchCancel" style="padding:8px 20px;border-radius:8px;border:none;background:#333;color:#fff;cursor:pointer">Cancelar</button>
                <button id="citySearchApply" style="padding:8px 20px;border-radius:8px;border:none;background:#e94560;color:#fff;cursor:pointer">Buscar</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        const input = document.getElementById('citySearchInput');
        document.getElementById('citySearchCancel').onclick = () => overlay.remove();
        document.getElementById('citySearchApply').onclick = async () => {
            if (!input.value.trim()) return;
            overlay.remove();
            await this.setCityByName(input.value.trim());
        };
        input.addEventListener('keydown', async e => { if (e.key === 'Enter') { overlay.remove(); await this.setCityByName(input.value.trim()); } });
        setTimeout(() => input.focus(), 100);
    },

    async reverseGeocode(lat, lng, fallbackCity) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es`);
            const data = await res.json();
            const city = data.address?.city || data.address?.town || data.address?.village || data.address?.municipality || '';
            const prov = data.address?.state || data.address?.province || '';
            this.cityName = city || fallbackCity || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            localStorage.setItem('dronigest_city_name', this.cityName);
            const el = document.querySelector('#locationInfo span');
            if (el) el.textContent = city && prov ? `${city}, ${prov}` : this.cityName;
        } catch {
            this.cityName = fallbackCity || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            localStorage.setItem('dronigest_city_name', this.cityName);
            const el = document.querySelector('#locationInfo span');
            if (el) el.textContent = this.cityName;
        }
    }
};

/* ===== DASHBOARD ===== */
Dronigest.Dashboard = {
    init() {
        this.actualizar();
    },
    actualizar() {
        document.getElementById('statVuelos').textContent = Dronigest.DB.get('vuelos').length;
        document.getElementById('statPilotos').textContent = Dronigest.DB.get('pilotos').length;
        document.getElementById('statAuxiliares').textContent = Dronigest.DB.get('auxiliares').length;
        document.getElementById('statDrones').textContent = Dronigest.DB.get('drones').length;
        const eqEl = document.getElementById('statEquipos');
        if (eqEl) eqEl.textContent = Dronigest.DB.get('modelos').length + Dronigest.DB.get('accesorios').length;
        document.getElementById('statTrabajos').textContent = Dronigest.DB.get('trabajos').length;
        const cinegEl = document.getElementById('statCinegetico');
        if (cinegEl) cinegEl.textContent = Dronigest.DB.get('cinegetico').length;

        const vuelos = Dronigest.DB.get('vuelos').sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 5);
        const container = document.getElementById('proximosVuelos');
        if (vuelos.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay vuelos programados</p>';
        } else {
            container.innerHTML = vuelos.map(v => `
                <div class="list-item">
                    <div class="item-icon"><i class="fas fa-helicopter"></i></div>
                    <div class="item-info">
                        <div class="item-title">${v.nombre || 'Sin nombre'}</div>
                        <div class="item-subtitle">${v.tipoVuelo || 'Sin tipo'} - ${v.piloto || 'Sin piloto'}</div>
                    </div>
                    <span class="badge badge-${v.estado === 'completado' ? 'success' : v.estado === 'en_curso' ? 'warning' : 'info'}">${v.estado || 'programado'}</span>
                </div>
            `).join('');
        }

        const act = Dronigest.DB.get('actividad').slice(0, 8);
        const actContainer = document.getElementById('actividadReciente');
        if (act.length === 0) {
            actContainer.innerHTML = '<p class="empty-state">Sin actividad reciente</p>';
        } else {
            const iconMap = { vuelo: 'helicopter', piloto: 'user', drone: 'helicopter', trabajo: 'briefcase', checklist: 'clipboard-check', inspeccion: 'search', agricola: 'seedling', cinegetico: 'crosshairs', tiposVuelo: 'plane', categoriasAesa: 'certificate' };
            actContainer.innerHTML = act.map(a => `
                <div class="list-item">
                    <div class="item-icon"><i class="fas fa-${iconMap[a.tipo] || 'circle'}"></i></div>
                    <div class="item-info">
                        <div class="item-title">${a.titulo}</div>
                        <div class="item-subtitle">${a.detalle || ''}</div>
                    </div>
                    <div class="item-time">${this.tiempoRelativo(a.fecha)}</div>
                </div>
            `).join('');
        }
    },
    tiempoRelativo(fecha) {
        const diff = Date.now() - new Date(fecha).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Ahora';
        if (mins < 60) return mins + 'min';
        const hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h';
        const days = Math.floor(hours / 24);
        return days + 'd';
    }
};

/* ===== UTILS ===== */
Dronigest.Utils = {
    formatDate(d) {
        if (!d) return '';
        return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },
    formatDateTime(d) {
        if (!d) return '';
        return new Date(d).toLocaleString('es-ES');
    },
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }
};

/* ===== VUELOS ===== */
Dronigest.Vuelos = {
    async nuevo() {
        await Dronigest.Geolocation.refreshLocation();
        const pilotos = Dronigest.DB.get('pilotos');
        const drones = Dronigest.DB.get('drones');
        const tipos = Dronigest.DB.get('tiposVuelo');
        const loc = Dronigest.userLocation || { lat: 40.4168, lng: -3.7038 };

        const body = `
            <div class="form-row">
                <div class="form-group">
                    <label>Nombre del Vuelo</label>
                    <input type="text" id="vNombre" class="form-control" placeholder="Ej: Vuelo inspección torre">
                </div>
                <div class="form-group">
                    <label>Fecha</label>
                    <input type="date" id="vFecha" class="form-control" value="${new Date().toISOString().split('T')[0]}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Hora Inicio</label>
                    <input type="time" id="vHoraInicio" class="form-control" value="${new Date().toTimeString().slice(0,5)}">
                </div>
                <div class="form-group">
                    <label>Hora Fin</label>
                    <input type="time" id="vHoraFin" class="form-control">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Piloto</label>
                    <select id="vPiloto" class="form-control">
                        <option value="">Seleccionar piloto</option>
                        ${pilotos.map(p => `<option value="${p.nombre}">${p.nombre} - ${p.certificacion || ''}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Auxiliar</label>
                    <select id="vAuxiliar" class="form-control">
                        <option value="">Sin auxiliar</option>
                        ${Dronigest.DB.get('auxiliares').map(a => `<option value="${a.nombre}">${a.nombre}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Drone</label>
                    <select id="vDrone" class="form-control">
                        <option value="">Seleccionar drone</option>
                        ${drones.map(d => `<option value="${d.nombre}">${d.nombre} - ${d.modelo || ''}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Tipo de Vuelo</label>
                    <select id="vTipoVuelo" class="form-control">
                        <option value="">Seleccionar tipo</option>
                        ${tipos.map(t => `<option value="${t.nombre}">${t.nombre}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Trabajo Asociado</label>
                <select id="vTrabajo" class="form-control">
                    <option value="">Sin trabajo asociado</option>
                    ${Dronigest.DB.get('trabajos').map(t => `<option value="${t.nombre}">${t.nombre}</option>`).join('')}
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Latitud</label>
                    <input type="number" step="any" id="vLat" class="form-control" value="${loc.lat}">
                </div>
                <div class="form-group">
                    <label>Longitud</label>
                    <input type="number" step="any" id="vLng" class="form-control" value="${loc.lng}">
                </div>
            </div>
            <div class="form-group">
                <label>Notas</label>
                <textarea id="vNotas" class="form-control" placeholder="Observaciones del vuelo..."></textarea>
            </div>
        `;
        const footer = `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Vuelos.guardar()">
                <i class="fas fa-save"></i> Guardar Vuelo
            </button>
        `;
        Dronigest.Modal.show('<i class="fas fa-plus"></i> Nuevo Vuelo', body, footer);
    },

    guardar(id) {
        const data = {
            nombre: document.getElementById('vNombre').value,
            fecha: document.getElementById('vFecha').value,
            horaInicio: document.getElementById('vHoraInicio').value,
            horaFin: document.getElementById('vHoraFin').value,
            piloto: document.getElementById('vPiloto').value,
            auxiliar: document.getElementById('vAuxiliar').value,
            drone: document.getElementById('vDrone').value,
            tipoVuelo: document.getElementById('vTipoVuelo').value,
            trabajo: document.getElementById('vTrabajo').value,
            lat: parseFloat(document.getElementById('vLat').value) || null,
            lng: parseFloat(document.getElementById('vLng').value) || null,
            notas: document.getElementById('vNotas').value,
            estado: 'programado'
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre para el vuelo', 'warning'); return; }

        if (id) {
            Dronigest.DB.update('vuelos', id, data);
            Dronigest.Toast.show('Vuelo actualizado', 'success');
            Dronigest.DB.logActividad('vuelo', 'Vuelo actualizado', data.nombre);
        } else {
            Dronigest.DB.add('vuelos', data);
            Dronigest.Toast.show('Vuelo creado correctamente', 'success');
            Dronigest.DB.logActividad('vuelo', 'Nuevo vuelo registrado', data.nombre);
        }
        Dronigest.Modal.cerrar();
        this.listar();
        Dronigest.Dashboard.actualizar();
    },

    editar(id) {
        const v = Dronigest.DB.find('vuelos', id);
        if (!v) return;
        this.nuevo();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Vuelo';
            ['vNombre','vFecha','vHoraInicio','vHoraFin','vPiloto','vAuxiliar','vDrone','vTipoVuelo','vTrabajo','vLat','vLng','vNotas'].forEach(f => {
                const el = document.getElementById(f);
                if (el && v[f.replace('v','').charAt(0).toLowerCase() + f.slice(2)]) {
                    const key = f.replace(/^v/, '');
                    const val = v[key.charAt(0).toLowerCase() + key.slice(1)];
                    if (val !== undefined) el.value = val;
                }
            });
            const keyMap = { vNombre:'nombre', vFecha:'fecha', vHoraInicio:'horaInicio', vHoraFin:'horaFin',
                vPiloto:'piloto', vAuxiliar:'auxiliar', vDrone:'drone', vTipoVuelo:'tipoVuelo',
                vTrabajo:'trabajo', vLat:'lat', vLng:'lng', vNotas:'notas' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && v[dataKey] !== undefined && v[dataKey] !== null) el.value = v[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Vuelos.guardar('${id}')">
                    <i class="fas fa-save"></i> Actualizar
                </button>`;
        }, 100);
    },

    eliminar(id) {
        if (confirm('¿Eliminar este vuelo?')) {
            Dronigest.DB.remove('vuelos', id);
            Dronigest.Toast.show('Vuelo eliminado', 'info');
            this.listar();
            Dronigest.Dashboard.actualizar();
        }
    },

    cambiarEstado(id, estado) {
        Dronigest.DB.update('vuelos', id, { estado });
        Dronigest.Toast.show(`Vuelo marcado como ${estado}`, 'success');
        Dronigest.DB.logActividad('vuelo', `Vuelo ${estado}`, '');
        this.listar();
        Dronigest.Dashboard.actualizar();
    },

    filtrar() {
        this.listar();
    },

    listar() {
        let vuelos = Dronigest.DB.get('vuelos');
        const fecha = document.getElementById('filtroFechaVuelo')?.value;
        const estado = document.getElementById('filtroEstadoVuelo')?.value;
        if (fecha) vuelos = vuelos.filter(v => v.fecha === fecha);
        if (estado) vuelos = vuelos.filter(v => v.estado === estado);

        vuelos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        const container = document.getElementById('listaVuelos');
        if (vuelos.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay vuelos que mostrar</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Nombre</th><th>Fecha</th><th>Piloto</th><th>Drone</th><th>Tipo</th><th>Estado</th><th>Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${vuelos.map(v => `
                        <tr>
                            <td data-label="Nombre"><strong>${v.nombre || '-'}</strong></td>
                            <td data-label="Fecha">${Dronigest.Utils.formatDate(v.fecha)}</td>
                            <td data-label="Piloto">${v.piloto || '-'}</td>
                            <td data-label="Drone">${v.drone || '-'}</td>
                            <td data-label="Tipo">${v.tipoVuelo || '-'}</td>
                            <td data-label="Estado"><span class="badge badge-${v.estado === 'completado' ? 'success' : v.estado === 'en_curso' ? 'warning' : v.estado === 'cancelado' ? 'danger' : 'info'}">${v.estado || 'programado'}</span></td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.Vuelos.editar('${v.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                ${v.estado === 'programado' ? `<button class="btn-action" style="background:#E8F5E9;color:#43A047;" onclick="Dronigest.Vuelos.cambiarEstado('${v.id}','en_curso')" title="Iniciar"><i class="fas fa-play"></i></button>` : ''}
                                ${v.estado === 'en_curso' ? `<button class="btn-action" style="background:#FFF8E1;color:#F57F17;" onclick="Dronigest.Vuelos.cambiarEstado('${v.id}','completado')" title="Completar"><i class="fas fa-check"></i></button>` : ''}
                                <button class="btn-action delete" onclick="Dronigest.Vuelos.eliminar('${v.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }
};

/* ===== PILOTOS ===== */
Dronigest.Pilotos = {
    mostrarTab(tab) {
        document.querySelectorAll('#page-pilotos .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#page-pilotos .tab-content').forEach(t => t.classList.remove('active'));
        event.target.closest('.tab').classList.add('active');
        document.getElementById(tab === 'pilotos' ? 'tabPilotos' : 'tabAuxiliares').classList.add('active');
    },

    nuevoPiloto() {
        const cats = Dronigest.DB.get('categoriasAesa');
        const body = `
            <div class="form-group"><label>Nombre completo</label><input type="text" id="pNombre" class="form-control" placeholder="Nombre del piloto"></div>
            <div class="form-row">
                <div class="form-group"><label>NIF/NIE</label><input type="text" id="pNif" class="form-control" placeholder="12345678A"></div>
                <div class="form-group"><label>Teléfono</label><input type="tel" id="pTelefono" class="form-control" placeholder="600 000 000"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Email</label><input type="email" id="pEmail" class="form-control" placeholder="piloto@email.com"></div>
                <div class="form-group"><label>Certificación AESA</label><input type="text" id="pCertificacion" class="form-control" placeholder="URAL-XXXXX"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Categoría</label>
                    <select id="pCategoria" class="form-control">
                        <option value="">Seleccionar categoría</option>
                        ${cats.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>Cobertura Seguro</label><input type="text" id="pSeguro" class="form-control" placeholder="Nº póliza"></div>
            </div>
            <div class="form-group"><label>Notas</label><textarea id="pNotas" class="form-control" placeholder="Observaciones..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-user-plus"></i> Nuevo Piloto', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Pilotos.guardarPiloto()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardarPiloto(id) {
        const data = {
            nombre: document.getElementById('pNombre').value,
            nif: document.getElementById('pNif').value,
            telefono: document.getElementById('pTelefono').value,
            email: document.getElementById('pEmail').value,
            certificacion: document.getElementById('pCertificacion').value,
            categoria: document.getElementById('pCategoria').value,
            seguro: document.getElementById('pSeguro').value,
            notas: document.getElementById('pNotas').value,
            tipo: 'piloto'
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce el nombre del piloto', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('pilotos', id, data);
            Dronigest.Toast.show('Piloto actualizado', 'success');
        } else {
            Dronigest.DB.add('pilotos', data);
            Dronigest.Toast.show('Piloto registrado', 'success');
            Dronigest.DB.logActividad('piloto', 'Piloto registrado', data.nombre);
        }
        Dronigest.Modal.cerrar();
        this.listarPilotos();
        Dronigest.Dashboard.actualizar();
    },

    editarPiloto(id) {
        const p = Dronigest.DB.find('pilotos', id);
        if (!p) return;
        this.nuevoPiloto();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Piloto';
            const keyMap = { pNombre:'nombre', pNif:'nif', pTelefono:'telefono', pEmail:'email',
                pCertificacion:'certificacion', pCategoria:'categoria', pSeguro:'seguro', pNotas:'notas' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && p[dataKey] !== undefined && p[dataKey] !== null) el.value = p[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Pilotos.guardarPiloto('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminarPiloto(id) {
        if (confirm('¿Eliminar este piloto?')) {
            Dronigest.DB.remove('pilotos', id);
            Dronigest.Toast.show('Piloto eliminado', 'info');
            this.listarPilotos();
            Dronigest.Dashboard.actualizar();
        }
    },

    nuevoAuxiliar() {
        const body = `
            <div class="form-group"><label>Nombre completo</label><input type="text" id="aNombre" class="form-control" placeholder="Nombre del auxiliar"></div>
            <div class="form-row">
                <div class="form-group"><label>NIF/NIE</label><input type="text" id="aNif" class="form-control" placeholder="12345678A"></div>
                <div class="form-group"><label>Teléfono</label><input type="tel" id="aTelefono" class="form-control" placeholder="600 000 000"></div>
            </div>
            <div class="form-group"><label>Email</label><input type="email" id="aEmail" class="form-control" placeholder="auxiliar@email.com"></div>
            <div class="form-group"><label>Función principal</label>
                <select id="aFuncion" class="form-control">
                    <option value="observador">Observador</option>
                    <option value="operador_camara">Operador de cámara</option>
                    <option value="seguridad">Seguridad</option>
                    <option value="coordinador">Coordinador</option>
                    <option value="otro">Otro</option>
                </select>
            </div>
            <div class="form-group"><label>Notas</label><textarea id="aNotas" class="form-control" placeholder="Observaciones..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-user-plus"></i> Nuevo Auxiliar', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Pilotos.guardarAuxiliar()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardarAuxiliar(id) {
        const data = {
            nombre: document.getElementById('aNombre').value,
            nif: document.getElementById('aNif').value,
            telefono: document.getElementById('aTelefono').value,
            email: document.getElementById('aEmail').value,
            funcion: document.getElementById('aFuncion').value,
            notas: document.getElementById('aNotas').value,
            tipo: 'auxiliar'
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce el nombre del auxiliar', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('auxiliares', id, data);
            Dronigest.Toast.show('Auxiliar actualizado', 'success');
        } else {
            Dronigest.DB.add('auxiliares', data);
            Dronigest.Toast.show('Auxiliar registrado', 'success');
            Dronigest.DB.logActividad('piloto', 'Auxiliar registrado', data.nombre);
        }
        Dronigest.Modal.cerrar();
        this.listarAuxiliares();
    },

    editarAuxiliar(id) {
        const a = Dronigest.DB.find('auxiliares', id);
        if (!a) return;
        this.nuevoAuxiliar();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Auxiliar';
            const keyMap = { aNombre:'nombre', aNif:'nif', aTelefono:'telefono', aEmail:'email',
                aFuncion:'funcion', aNotas:'notas' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && a[dataKey] !== undefined && a[dataKey] !== null) el.value = a[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Pilotos.guardarAuxiliar('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminarAuxiliar(id) {
        if (confirm('¿Eliminar este auxiliar?')) {
            Dronigest.DB.remove('auxiliares', id);
            Dronigest.Toast.show('Auxiliar eliminado', 'info');
            this.listarAuxiliares();
        }
    },

    listarPilotos() {
        const pilotos = Dronigest.DB.get('pilotos');
        const container = document.getElementById('listaPilotos');
        if (pilotos.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay pilotos registrados</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>NIF</th><th>Certificación</th><th>Categoría</th><th>Teléfono</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${pilotos.map(p => `
                        <tr>
                            <td data-label="Nombre"><span class="row-icon" style="background:#E3F2FD;color:#0288D1;"><i class="fas fa-user-tie"></i></span> <strong>${p.nombre}</strong></td>
                            <td data-label="NIF">${p.nif || '-'}</td>
                            <td data-label="Certificación">${p.certificacion || '-'}</td>
                            <td data-label="Categoría"><span class="badge badge-info">${p.categoria || '-'}</span></td>
                            <td data-label="Teléfono">${p.telefono || '-'}</td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.Pilotos.editarPiloto('${p.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Pilotos.eliminarPiloto('${p.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    },

    listarAuxiliares() {
        const auxiliares = Dronigest.DB.get('auxiliares');
        const container = document.getElementById('listaAuxiliares');
        if (auxiliares.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay auxiliares registrados</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>NIF</th><th>Función</th><th>Teléfono</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${auxiliares.map(a => `
                        <tr>
                            <td data-label="Nombre"><span class="row-icon" style="background:#E8F5E9;color:#2E7D32;"><i class="fas fa-user-friends"></i></span> <strong>${a.nombre}</strong></td>
                            <td data-label="NIF">${a.nif || '-'}</td>
                            <td data-label="Función"><span class="badge badge-info">${a.funcion || '-'}</span></td>
                            <td data-label="Teléfono">${a.telefono || '-'}</td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.Pilotos.editarAuxiliar('${a.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Pilotos.eliminarAuxiliar('${a.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }
};

/* ===== TIPOS DE VUELO ===== */
Dronigest.TiposVuelo = {
    mostrarTab(tab) {
        document.querySelectorAll('#page-tiposVuelo .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#page-tiposVuelo .tab-content').forEach(t => t.classList.remove('active'));
        event.target.closest('.tab').classList.add('active');
        document.getElementById(tab === 'tipos' ? 'tabTiposVuelo' : 'tabCategorias').classList.add('active');
    },

    nuevo() {
        const cats = Dronigest.DB.get('categorias');
        const body = `
            <div class="form-group"><label>Nombre del tipo de vuelo</label><input type="text" id="tvNombre" class="form-control" placeholder="Ej: Vuelo libre"></div>
            <div class="form-group"><label>Categoría</label>
                <select id="tvCategoria" class="form-control">
                    <option value="">Seleccionar categoría</option>
                    ${cats.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('')}
                </select>
            </div>
            <div class="form-group"><label>Descripción</label><textarea id="tvDesc" class="form-control" placeholder="Descripción del tipo de vuelo..."></textarea></div>
            <div class="form-row">
                <div class="form-group"><label>Altitud máx. (m)</label><input type="number" id="tvAltMax" class="form-control" value="120"></div>
                <div class="form-group"><label>Distancia máx. (m)</label><input type="number" id="tvDistMax" class="form-control" value="500"></div>
            </div>
        `;
        Dronigest.Modal.show('<i class="fas fa-plus"></i> Nuevo Tipo de Vuelo', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.TiposVuelo.guardar()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardar(id) {
        const data = {
            nombre: document.getElementById('tvNombre').value,
            categoria: document.getElementById('tvCategoria').value,
            descripcion: document.getElementById('tvDesc').value,
            altitudMax: document.getElementById('tvAltMax').value,
            distanciaMax: document.getElementById('tvDistMax').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('tiposVuelo', id, data);
            Dronigest.Toast.show('Tipo de vuelo actualizado', 'success');
        } else {
            Dronigest.DB.add('tiposVuelo', data);
            Dronigest.Toast.show('Tipo de vuelo registrado', 'success');
        }
        Dronigest.Modal.cerrar();
        this.listar();
    },

    editar(id) {
        const t = Dronigest.DB.find('tiposVuelo', id);
        if (!t) return;
        this.nuevo();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Tipo de Vuelo';
            const keyMap = { tvNombre:'nombre', tvCategoria:'categoria', tvDesc:'descripcion',
                tvAltMax:'altitudMax', tvDistMax:'distanciaMax' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && t[dataKey] !== undefined && t[dataKey] !== null) el.value = t[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.TiposVuelo.guardar('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminar(id) {
        if (confirm('¿Eliminar este tipo de vuelo?')) {
            Dronigest.DB.remove('tiposVuelo', id);
            Dronigest.Toast.show('Tipo de vuelo eliminado', 'info');
            this.listar();
        }
    },

    nuevaCategoria() {
        const body = `
            <div class="form-group"><label>Nombre de la categoría</label><input type="text" id="catNombre" class="form-control" placeholder="Ej: Vuelo visual (VLOS)"></div>
            <div class="form-group"><label>Código</label><input type="text" id="catCodigo" class="form-control" placeholder="Ej: VLOS"></div>
            <div class="form-group"><label>Descripción</label><textarea id="catDesc" class="form-control" placeholder="Descripción de la categoría..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-plus"></i> Nueva Categoría', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.TiposVuelo.guardarCategoria()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardarCategoria(id) {
        const data = {
            nombre: document.getElementById('catNombre').value,
            codigo: document.getElementById('catCodigo').value,
            descripcion: document.getElementById('catDesc').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('categorias', id, data);
            Dronigest.Toast.show('Categoría actualizada', 'success');
        } else {
            Dronigest.DB.add('categorias', data);
            Dronigest.Toast.show('Categoría registrada', 'success');
        }
        Dronigest.Modal.cerrar();
        this.listarCategorias();
    },

    editarCategoria(id) {
        const c = Dronigest.DB.find('categorias', id);
        if (!c) return;
        this.nuevaCategoria();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Categoría';
            const keyMap = { catNombre:'nombre', catCodigo:'codigo', catDesc:'descripcion' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && c[dataKey] !== undefined && c[dataKey] !== null) el.value = c[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.TiposVuelo.guardarCategoria('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminarCategoria(id) {
        if (confirm('¿Eliminar esta categoría?')) {
            Dronigest.DB.remove('categorias', id);
            Dronigest.Toast.show('Categoría eliminada', 'info');
            this.listarCategorias();
        }
    },

    listar() {
        const tipos = Dronigest.DB.get('tiposVuelo');
        const container = document.getElementById('listaTiposVuelo');
        if (tipos.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay tipos de vuelo registrados</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>Categoría</th><th>Alt. Máx</th><th>Dist. Máx</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${tipos.map(t => `
                        <tr>
                            <td data-label="Nombre"><strong>${t.nombre}</strong><br><small style="color:var(--text-light)">${t.descripcion || ''}</small></td>
                            <td data-label="Categoría"><span class="badge badge-info">${t.categoria || '-'}</span></td>
                            <td data-label="Alt. Máx">${t.altitudMax || '-'}m</td>
                            <td data-label="Dist. Máx">${t.distanciaMax || '-'}m</td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.TiposVuelo.editar('${t.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.TiposVuelo.eliminar('${t.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    },

    listarCategorias() {
        const cats = Dronigest.DB.get('categorias');
        const container = document.getElementById('listaCategorias');
        if (cats.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay categorías registradas</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>Código</th><th>Descripción</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${cats.map(c => `
                        <tr>
                            <td data-label="Nombre"><strong>${c.nombre}</strong></td>
                            <td data-label="Código"><span class="badge badge-info">${c.codigo || '-'}</span></td>
                            <td data-label="Descripción">${c.descripcion || '-'}</td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.TiposVuelo.editarCategoria('${c.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.TiposVuelo.eliminarCategoria('${c.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }
};

/* ===== CHECKLISTS ===== */
Dronigest.Checklists = {
    mostrarTab(tab) {
        document.querySelectorAll('#page-checklists .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#page-checklists .tab-content').forEach(t => t.classList.remove('active'));
        event.target.closest('.tab').classList.add('active');
        const tabMap = { inicio: 'tabChecklistInicio', fin: 'tabChecklistFin', historial: 'tabChecklistHistorial' };
        document.getElementById(tabMap[tab]).classList.add('active');
        if (tab === 'historial') this.listarHistorial();
    },

    guardarInicio() {
        this._guardar('inicio');
    },

    guardarFin() {
        this._guardar('fin');
    },

    _guardar(tipo) {
        const container = document.getElementById(tipo === 'inicio' ? 'checklistInicio' : 'checklistFin');
        const checks = {};
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            checks[cb.dataset.check] = cb.checked;
        });
        const total = Object.keys(checks).length;
        const completados = Object.values(checks).filter(v => v).length;

        const vuelos = Dronigest.DB.get('vuelos');
        const vueloActivo = vuelos.find(v => v.estado === 'en_curso' || v.estado === 'programado');

        const data = {
            tipo,
            vueloId: vueloActivo?.id || null,
            vueloNombre: vueloActivo?.nombre || 'Sin vuelo asociado',
            checks,
            total,
            completados,
            porcentaje: Math.round((completados / total) * 100),
            completado: completados === total
        };

        Dronigest.DB.add('checklists', data);
        Dronigest.Toast.show(
            data.completado
                ? `Checklist de ${tipo === 'inicio' ? 'inicio' : 'fin'} completado al ${data.porcentaje}%`
                : `Checklist guardado (${data.porcentaje}% completado)`,
            data.completado ? 'success' : 'warning'
        );
        Dronigest.DB.logActividad('checklist', `Checklist de ${tipo} guardado`, `${data.porcentaje}% completado`);
        Dronigest.Dashboard.actualizar();
    },

    listarHistorial() {
        const checks = Dronigest.DB.get('checklists').sort((a, b) => new Date(b.creado) - new Date(a.creado));
        const container = document.getElementById('historialChecklists');
        if (checks.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay checklists completados</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Tipo</th><th>Vuelo</th><th>Completado</th><th>Porcentaje</th><th>Fecha</th></tr></thead>
                <tbody>
                    ${checks.map(c => `
                        <tr>
                            <td><span class="badge badge-${c.tipo === 'inicio' ? 'info' : 'warning'}">${c.tipo === 'inicio' ? 'Inicio' : 'Fin'}</span></td>
                            <td>${c.vueloNombre || '-'}</td>
                            <td>${c.completado ? '<i class="fas fa-check-circle" style="color:var(--success)"></i> Sí' : '<i class="fas fa-times-circle" style="color:var(--danger)"></i> No'}</td>
                            <td><strong>${c.porcentaje}%</strong></td>
                            <td>${Dronigest.Utils.formatDateTime(c.creado)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }
};

/* ===== EQUIPOS ===== */
Dronigest.Equipos = {
    mostrarTab(tab) {
        document.querySelectorAll('#page-equipos .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#page-equipos .tab-content').forEach(t => t.classList.remove('active'));
        event.target.closest('.tab').classList.add('active');
        const tabMap = { drones: 'tabDrones', modelos: 'tabModelos', accesorios: 'tabAccesorios' };
        document.getElementById(tabMap[tab]).classList.add('active');
    },

    nuevoDrone() {
        const modelos = Dronigest.DB.get('modelos');
        const body = `
            <div class="form-group"><label>Nombre/Identificación</label><input type="text" id="dNombre" class="form-control" placeholder="Ej: Drone 01 - DJI M30T"></div>
            <div class="form-row">
                <div class="form-group"><label>Modelo</label>
                    <select id="dModelo" class="form-control">
                        <option value="">Seleccionar modelo</option>
                        ${modelos.map(m => `<option value="${m.nombre}">${m.nombre} - ${m.marca || ''}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>Nº de Serie</label><input type="text" id="dSerie" class="form-control" placeholder="Número de serie"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Fecha de compra</label><input type="date" id="dCompra" class="form-control"></div>
                <div class="form-group"><label>Horas de vuelo</label><input type="number" id="dHoras" class="form-control" value="0"></div>
            </div>
            <div class="form-group"><label>Estado</label>
                <select id="dEstado" class="form-control">
                    <option value="operativo">Operativo</option>
                    <option value="mantenimiento">En mantenimiento</option>
                    <option value="averiado">Averiado</option>
                    <option value="baja">Dado de baja</option>
                </select>
            </div>
            <div class="form-group"><label>Última revisión</label><input type="date" id="dRevision" class="form-control"></div>
            <div class="form-group"><label>Notas</label><textarea id="dNotas" class="form-control" placeholder="Observaciones..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-helicopter"></i> Nuevo Drone', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Equipos.guardarDrone()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardarDrone(id) {
        const data = {
            nombre: document.getElementById('dNombre').value,
            modelo: document.getElementById('dModelo').value,
            serie: document.getElementById('dSerie').value,
            fechaCompra: document.getElementById('dCompra').value,
            horasVuelo: parseFloat(document.getElementById('dHoras').value) || 0,
            estado: document.getElementById('dEstado').value,
            ultimaRevision: document.getElementById('dRevision').value,
            notas: document.getElementById('dNotas').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('drones', id, data);
            Dronigest.Toast.show('Drone actualizado', 'success');
        } else {
            Dronigest.DB.add('drones', data);
            Dronigest.Toast.show('Drone registrado', 'success');
            Dronigest.DB.logActividad('drone', 'Drone registrado', data.nombre);
        }
        Dronigest.Modal.cerrar();
        this.listarDrones();
        Dronigest.Dashboard.actualizar();
    },

    editarDrone(id) {
        const d = Dronigest.DB.find('drones', id);
        if (!d) return;
        this.nuevoDrone();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Drone';
            const keyMap = { dNombre:'nombre', dModelo:'modelo', dSerie:'serie', dCompra:'fechaCompra',
                dHoras:'horasVuelo', dEstado:'estado', dRevision:'ultimaRevision', dNotas:'notas' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && d[dataKey] !== undefined && d[dataKey] !== null) el.value = d[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Equipos.guardarDrone('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminarDrone(id) {
        if (confirm('¿Eliminar este drone?')) {
            Dronigest.DB.remove('drones', id);
            Dronigest.Toast.show('Drone eliminado', 'info');
            this.listarDrones();
            Dronigest.Dashboard.actualizar();
        }
    },

    nuevoModelo() {
        const cats = Dronigest.DB.get('categoriasAesa');
        const body = `
            <div class="form-group"><label>Nombre del modelo</label><input type="text" id="mNombre" class="form-control" placeholder="Ej: Matrice 30T"></div>
            <div class="form-row">
                <div class="form-group"><label>Marca</label><input type="text" id="mMarca" class="form-control" placeholder="Ej: DJI"></div>
                <div class="form-group"><label>Tipo</label>
                    <select id="mTipo" class="form-control">
                        <option value="multirotor">Multirrotor</option>
                        <option value="ala_fija">Ala fija</option>
                        <option value="hibrido">Híbrido VTOL</option>
                        <option value="helicoptero">Helicóptero</option>
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Peso máx. (g)</label><input type="number" id="mPeso" class="form-control" placeholder="g"></div>
                <div class="form-group"><label>Autonomía (min)</label><input type="number" id="mAutonomia" class="form-control" placeholder="min"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Carga máx. (g)</label><input type="number" id="mCarga" class="form-control" placeholder="g"></div>
                <div class="form-group"><label>Categoría AESA</label>
                    <select id="mCategoria" class="form-control">
                        <option value="">Seleccionar categoría</option>
                        ${cats.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Descripción</label><textarea id="mDesc" class="form-control" placeholder="Características del modelo..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-th-list"></i> Nuevo Modelo', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Equipos.guardarModelo()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardarModelo(id) {
        const data = {
            nombre: document.getElementById('mNombre').value,
            marca: document.getElementById('mMarca').value,
            tipo: document.getElementById('mTipo').value,
            peso: document.getElementById('mPeso').value,
            autonomia: document.getElementById('mAutonomia').value,
            carga: document.getElementById('mCarga').value,
            categoria: document.getElementById('mCategoria').value,
            descripcion: document.getElementById('mDesc').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('modelos', id, data);
            Dronigest.Toast.show('Modelo actualizado', 'success');
        } else {
            Dronigest.DB.add('modelos', data);
            Dronigest.Toast.show('Modelo registrado', 'success');
        }
        Dronigest.Modal.cerrar();
        this.listarModelos();
    },

    editarModelo(id) {
        const m = Dronigest.DB.find('modelos', id);
        if (!m) return;
        this.nuevoModelo();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Modelo';
            const keyMap = { mNombre:'nombre', mMarca:'marca', mTipo:'tipo', mPeso:'peso',
                mAutonomia:'autonomia', mCarga:'carga', mCategoria:'categoria', mDesc:'descripcion' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && m[dataKey] !== undefined && m[dataKey] !== null) el.value = m[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Equipos.guardarModelo('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminarModelo(id) {
        if (confirm('¿Eliminar este modelo?')) {
            Dronigest.DB.remove('modelos', id);
            Dronigest.Toast.show('Modelo eliminado', 'info');
            this.listarModelos();
        }
    },

    nuevoAccesorio() {
        const body = `
            <div class="form-group"><label>Nombre del accesorio</label><input type="text" id="accNombre" class="form-control" placeholder="Ej: Batería extra TB30"></div>
            <div class="form-row">
                <div class="form-group"><label>Marca</label><input type="text" id="accMarca" class="form-control" placeholder="Marca"></div>
                <div class="form-group"><label>Modelo compatible</label><input type="text" id="accCompatible" class="form-control" placeholder="Modelo drone"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Cantidad</label><input type="number" id="accCantidad" class="form-control" value="1"></div>
                <div class="form-group"><label>Estado</label>
                    <select id="accEstado" class="form-control">
                        <option value="disponible">Disponible</option>
                        <option value="en_uso">En uso</option>
                        <option value="agotado">Agotado</option>
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Notas</label><textarea id="accNotas" class="form-control" placeholder="Observaciones..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-puzzle-piece"></i> Nuevo Accesorio', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Equipos.guardarAccesorio()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardarAccesorio(id) {
        const data = {
            nombre: document.getElementById('accNombre').value,
            marca: document.getElementById('accMarca').value,
            compatible: document.getElementById('accCompatible').value,
            cantidad: parseInt(document.getElementById('accCantidad').value) || 1,
            estado: document.getElementById('accEstado').value,
            notas: document.getElementById('accNotas').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('accesorios', id, data);
            Dronigest.Toast.show('Accesorio actualizado', 'success');
        } else {
            Dronigest.DB.add('accesorios', data);
            Dronigest.Toast.show('Accesorio registrado', 'success');
        }
        Dronigest.Modal.cerrar();
        this.listarAccesorios();
    },

    editarAccesorio(id) {
        const a = Dronigest.DB.find('accesorios', id);
        if (!a) return;
        this.nuevoAccesorio();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Accesorio';
            const keyMap = { accNombre:'nombre', accMarca:'marca', accCompatible:'compatible',
                accCantidad:'cantidad', accEstado:'estado', accNotas:'notas' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && a[dataKey] !== undefined && a[dataKey] !== null) el.value = a[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Equipos.guardarAccesorio('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminarAccesorio(id) {
        if (confirm('¿Eliminar este accesorio?')) {
            Dronigest.DB.remove('accesorios', id);
            Dronigest.Toast.show('Accesorio eliminado', 'info');
            this.listarAccesorios();
        }
    },

    listarDrones() {
        const drones = Dronigest.DB.get('drones');
        const container = document.getElementById('listaDrones');
        if (drones.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay drones registrados</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>Modelo</th><th>Nº Serie</th><th>Horas</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${drones.map(d => `
                        <tr>
                            <td data-label="Nombre"><span class="row-icon" style="background:#E1F5FE;color:#01579B;"><i class="fas fa-helicopter"></i></span> <strong>${d.nombre}</strong></td>
                            <td data-label="Modelo">${d.modelo || '-'}</td>
                            <td data-label="Nº Serie">${d.serie || '-'}</td>
                            <td data-label="Horas">${d.horasVuelo || 0}h</td>
                            <td data-label="Estado"><span class="badge badge-${d.estado === 'operativo' ? 'success' : d.estado === 'averiado' ? 'danger' : 'warning'}">${d.estado || '-'}</span></td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.Equipos.editarDrone('${d.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Equipos.eliminarDrone('${d.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    },

    listarModelos() {
        const modelos = Dronigest.DB.get('modelos');
        const container = document.getElementById('listaModelos');
        if (modelos.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay modelos registrados</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>Marca</th><th>Tipo</th><th>Peso</th><th>Autonomía</th><th>Categoría</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${modelos.map(m => `
                        <tr>
                            <td data-label="Nombre"><span class="row-icon" style="background:#FFF3E0;color:#E65100;"><i class="fas fa-th-large"></i></span> <strong>${m.nombre}</strong></td>
                            <td data-label="Marca">${m.marca || '-'}</td>
                            <td data-label="Tipo"><span class="badge badge-info">${m.tipo || '-'}</span></td>
                            <td data-label="Peso">${m.peso ? m.peso + 'g' : '-'}</td>
                            <td data-label="Autonomía">${m.autonomia ? m.autonomia + 'min' : '-'}</td>
                            <td data-label="Categoría"><span class="badge badge-info">${m.categoria || '-'}</span></td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.Equipos.editarModelo('${m.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Equipos.eliminarModelo('${m.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    },

    listarAccesorios() {
        const acc = Dronigest.DB.get('accesorios');
        const container = document.getElementById('listaAccesorios');
        if (acc.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay accesorios registrados</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>Marca</th><th>Compatible</th><th>Cantidad</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${acc.map(a => `
                        <tr>
                            <td data-label="Nombre"><span class="row-icon" style="background:#F3E5F5;color:#7B1FA2;"><i class="fas fa-puzzle-piece"></i></span> <strong>${a.nombre}</strong></td>
                            <td data-label="Marca">${a.marca || '-'}</td>
                            <td data-label="Compatible">${a.compatible || '-'}</td>
                            <td data-label="Cantidad">${a.cantidad || 1}</td>
                            <td data-label="Estado"><span class="badge badge-${a.estado === 'disponible' ? 'success' : a.estado === 'agotado' ? 'danger' : 'warning'}">${a.estado || '-'}</span></td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.Equipos.editarAccesorio('${a.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Equipos.eliminarAccesorio('${a.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }
};

/* ===== TRABAJOS ===== */
Dronigest.Trabajos = {
    nuevo() {
        const body = `
            <div class="form-group"><label>Nombre del trabajo</label><input type="text" id="tNombre" class="form-control" placeholder="Ej: Mapeo parcela agrícola"></div>
            <div class="form-row">
                <div class="form-group"><label>Tipo de trabajo</label>
                    <select id="tTipo" class="form-control">
                        <option value="mapeo">Mapeo</option>
                        <option value="fotogrametria">Fotogrametría</option>
                        <option value="grabacion_img">Grabación de imágenes</option>
                        <option value="grabacion_video">Grabación de video</option>
                        <option value="limpieza">Limpieza</option>
                        <option value="control_superficies">Control y examen de superficies</option>
                        <option value="inspeccion_solar">Inspección planta solar</option>
                        <option value="inspeccion_eolica">Inspección torre eólica</option>
                        <option value="inspeccion_tendido">Inspección tendido eléctrico</option>
                        <option value="agricola">Trabajo agrícola</option>
                        <option value="otro">Otro</option>
                    </select>
                </div>
                <div class="form-group"><label>Cliente</label><input type="text" id="tCliente" class="form-control" placeholder="Nombre del cliente"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Fecha inicio</label><input type="date" id="tFechaInicio" class="form-control" value="${new Date().toISOString().split('T')[0]}"></div>
                <div class="form-group"><label>Fecha fin</label><input type="date" id="tFechaFin" class="form-control"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Piloto asignado</label>
                    <select id="tPiloto" class="form-control">
                        <option value="">Seleccionar piloto</option>
                        ${Dronigest.DB.get('pilotos').map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>Drone asignado</label>
                    <select id="tDrone" class="form-control">
                        <option value="">Seleccionar drone</option>
                        ${Dronigest.DB.get('drones').map(d => `<option value="${d.nombre}">${d.nombre}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Ubicación / Dirección</label><input type="text" id="tUbicacion" class="form-control" placeholder="Dirección o referencias"></div>
            <div class="form-group"><label>Descripción del trabajo</label><textarea id="tDesc" class="form-control" placeholder="Detalles del trabajo a realizar..."></textarea></div>
            <div class="form-row">
                <div class="form-group"><label>Estado</label>
                    <select id="tEstado" class="form-control">
                        <option value="pendiente">Pendiente</option>
                        <option value="en_curso">En curso</option>
                        <option value="completado">Completado</option>
                        <option value="cancelado">Cancelado</option>
                    </select>
                </div>
                <div class="form-group"><label>Presupuesto (€)</label><input type="number" step="0.01" id="tPresupuesto" class="form-control" placeholder="0.00"></div>
            </div>
        `;
        Dronigest.Modal.show('<i class="fas fa-plus"></i> Nuevo Trabajo', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Trabajos.guardar()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardar(id) {
        const data = {
            nombre: document.getElementById('tNombre').value,
            tipo: document.getElementById('tTipo').value,
            cliente: document.getElementById('tCliente').value,
            fechaInicio: document.getElementById('tFechaInicio').value,
            fechaFin: document.getElementById('tFechaFin').value,
            piloto: document.getElementById('tPiloto').value,
            drone: document.getElementById('tDrone').value,
            ubicacion: document.getElementById('tUbicacion').value,
            descripcion: document.getElementById('tDesc').value,
            estado: document.getElementById('tEstado').value,
            presupuesto: document.getElementById('tPresupuesto').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('trabajos', id, data);
            Dronigest.Toast.show('Trabajo actualizado', 'success');
        } else {
            Dronigest.DB.add('trabajos', data);
            Dronigest.Toast.show('Trabajo registrado', 'success');
            Dronigest.DB.logActividad('trabajo', 'Trabajo registrado', data.nombre);
        }
        Dronigest.Modal.cerrar();
        this.listar();
        Dronigest.Dashboard.actualizar();
    },

    editar(id) {
        const t = Dronigest.DB.find('trabajos', id);
        if (!t) return;
        this.nuevo();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Trabajo';
            const keyMap = { tNombre:'nombre', tTipo:'tipo', tCliente:'cliente', tFechaInicio:'fechaInicio',
                tFechaFin:'fechaFin', tPiloto:'piloto', tDrone:'drone', tUbicacion:'ubicacion',
                tDesc:'descripcion', tEstado:'estado', tPresupuesto:'presupuesto' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && t[dataKey] !== undefined && t[dataKey] !== null) el.value = t[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Trabajos.guardar('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminar(id) {
        if (confirm('¿Eliminar este trabajo?')) {
            Dronigest.DB.remove('trabajos', id);
            Dronigest.Toast.show('Trabajo eliminado', 'info');
            this.listar();
            Dronigest.Dashboard.actualizar();
        }
    },

    listar() {
        const trabajos = Dronigest.DB.get('trabajos').sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio));
        const container = document.getElementById('listaTrabajos');
        const tipoLabels = {
            mapeo: 'Mapeo', fotogrametria: 'Fotogrametría', grabacion_img: 'Imágenes',
            grabacion_video: 'Video', limpieza: 'Limpieza', control_superficies: 'Control Superficies',
            inspeccion_solar: 'Inspección Solar', inspeccion_eolica: 'Inspección Eólica',
            inspeccion_tendido: 'Inspección Tendido', agricola: 'Agrícola', otro: 'Otro'
        };
        if (trabajos.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay trabajos registrados</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>Tipo</th><th>Cliente</th><th>Piloto</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${trabajos.map(t => `
                        <tr>
                            <td data-label="Nombre"><strong>${t.nombre}</strong><br><small style="color:var(--text-light)">${Dronigest.Utils.formatDate(t.fechaInicio)}</small></td>
                            <td data-label="Tipo"><span class="badge badge-info">${tipoLabels[t.tipo] || t.tipo}</span></td>
                            <td data-label="Cliente">${t.cliente || '-'}</td>
                            <td data-label="Piloto">${t.piloto || '-'}</td>
                            <td data-label="Estado"><span class="badge badge-${t.estado === 'completado' ? 'success' : t.estado === 'en_curso' ? 'warning' : t.estado === 'cancelado' ? 'danger' : 'info'}">${t.estado || '-'}</span></td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.Trabajos.editar('${t.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Trabajos.eliminar('${t.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }
};

/* ===== INSPECCIONES ===== */
Dronigest.Inspecciones = {
    mostrarTab(tab) {
        document.querySelectorAll('#page-inspecciones .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#page-inspecciones .tab-content').forEach(t => t.classList.remove('active'));
        event.target.closest('.tab').classList.add('active');
        const tabMap = { solar: 'tabInspeccionSolar', eolica: 'tabInspeccionEolica', tendidos: 'tabInspeccionTendidos', superficies: 'tabInspeccionSuperficies' };
        document.getElementById(tabMap[tab]).classList.add('active');
    },

    nueva() {
        const body = `
            <div class="form-group"><label>Nombre / Referencia</label><input type="text" id="iNombre" class="form-control" placeholder="Ej: Inspección Planta Solar X"></div>
            <div class="form-row">
                <div class="form-group"><label>Tipo de inspección</label>
                    <select id="iTipo" class="form-control">
                        <option value="solar">Planta Solar</option>
                        <option value="eolica">Torre Eólica</option>
                        <option value="tendido">Tendido Eléctrico</option>
                        <option value="superficies">Control y Examen de Superficies</option>
                    </select>
                </div>
                <div class="form-group"><label>Cliente</label><input type="text" id="iCliente" class="form-control" placeholder="Nombre del cliente"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Fecha</label><input type="date" id="iFecha" class="form-control" value="${new Date().toISOString().split('T')[0]}"></div>
                <div class="form-group"><label>Piloto</label>
                    <select id="iPiloto" class="form-control">
                        <option value="">Seleccionar piloto</option>
                        ${Dronigest.DB.get('pilotos').map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Ubicación</label><input type="text" id="iUbicacion" class="form-control" placeholder="Dirección o coordenadas"></div>
            <div class="form-row">
                <div class="form-group"><label>Nº de elementos inspeccionados</label><input type="number" id="iElementos" class="form-control" value="0"></div>
                <div class="form-group"><label>Nº de anomalías encontradas</label><input type="number" id="iAnomalias" class="form-control" value="0"></div>
            </div>
            <div class="form-group"><label>Subtipo / Detalles específicos</label>
                <select id="iSubtipo" class="form-control">
                    <option value="">Seleccionar...</option>
                    <optgroup label="Planta Solar">
                        <option value="panel_termico">Análisis térmico de paneles</option>
                        <option value="panel_visual">Inspección visual de paneles</option>
                        <option value="inversor">Revisión de inversores</option>
                        <option value="cableado">Revisión de cableado</option>
                        <option value="estructura">Estado de estructuras</option>
                    </optgroup>
                    <optgroup label="Torre Eólica">
                        <option value="pala">Inspección de palas</option>
                        <option value="torre_estructura">Estructura de torre</option>
                        <option value="nacelle">Inspección de nacelle</option>
                        <option value="base">Revisión de base</option>
                        <option value="conexionado">Sistema de conexión</option>
                    </optgroup>
                    <optgroup label="Tendido Eléctrico">
                        <option value="linea_aerea">Línea aérea</option>
                        <option value="poste">Postes y estructuras</option>
                        <option value="aisladores">Aisladores</option>
                        <option value="conexiones">Conexiones</option>
                        <option value="vegetacion">Vegetación cercana</option>
                    </optgroup>
                    <optgroup label="Superficies">
                        <option value="fachada">Fachada de edificio</option>
                        <option value="cubierta">Cubierta / Tejado</option>
                        <option value="puente">Puente</option>
                        <option value="camino">Camino / Carretera</option>
                        <option value="otra_sup">Otra superficie</option>
                    </optgroup>
                </select>
            </div>
            <div class="form-group"><label>Observaciones</label><textarea id="iObs" class="form-control" placeholder="Detalle de los hallazgos..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-search"></i> Nueva Inspección', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Inspecciones.guardar()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardar(id) {
        const data = {
            nombre: document.getElementById('iNombre').value,
            tipo: document.getElementById('iTipo').value,
            cliente: document.getElementById('iCliente').value,
            fecha: document.getElementById('iFecha').value,
            piloto: document.getElementById('iPiloto').value,
            ubicacion: document.getElementById('iUbicacion').value,
            numElementos: parseInt(document.getElementById('iElementos').value) || 0,
            numAnomalias: parseInt(document.getElementById('iAnomalias').value) || 0,
            subtipo: document.getElementById('iSubtipo').value,
            observaciones: document.getElementById('iObs').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('inspecciones', id, data);
            Dronigest.Toast.show('Inspección actualizada', 'success');
        } else {
            Dronigest.DB.add('inspecciones', data);
            Dronigest.Toast.show('Inspección registrada', 'success');
            Dronigest.DB.logActividad('inspeccion', 'Inspección registrada', data.nombre);
        }
        Dronigest.Modal.cerrar();
        this.listar();
    },

    editar(id) {
        const i = Dronigest.DB.find('inspecciones', id);
        if (!i) return;
        this.nueva();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Inspección';
            const keyMap = { iNombre:'nombre', iTipo:'tipo', iCliente:'cliente', iFecha:'fecha',
                iPiloto:'piloto', iUbicacion:'ubicacion', iElementos:'numElementos',
                iAnomalias:'numAnomalias', iSubtipo:'subtipo', iObs:'observaciones' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && i[dataKey] !== undefined && i[dataKey] !== null) el.value = i[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Inspecciones.guardar('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminar(id) {
        if (confirm('¿Eliminar esta inspección?')) {
            Dronigest.DB.remove('inspecciones', id);
            Dronigest.Toast.show('Inspección eliminada', 'info');
            this.listar();
        }
    },

    listar() {
        const inspecciones = Dronigest.DB.get('inspecciones').sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        const tipoLabels = { solar: 'Planta Solar', eolica: 'Torre Eólica', tendido: 'Tendido Eléctrico', superficies: 'Control Superficies' };
        const tipoBadge = { solar: 'solar', eolica: 'eolica', tendido: 'tendidos', superficies: 'superficies' };

        ['solar', 'eolica', 'tendidos', 'superficies'].forEach(tipo => {
            const containerId = tipo === 'tendidos' ? 'listaTendidos' : tipo === 'superficies' ? 'listaSuperficies' : `lista${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`;
            const container = document.getElementById(containerId);
            const tipoKey = tipo === 'tendidos' ? 'tendido' : tipo;
            const items = inspecciones.filter(i => i.tipo === tipoKey);
            if (items.length === 0) {
                container.innerHTML = `<p class="empty-state">No hay inspecciones de ${tipoLabels[tipoKey] || tipo}</p>`;
                return;
            }
            container.innerHTML = `
                <table class="data-table">
                    <thead><tr><th>Nombre</th><th>Fecha</th><th>Cliente</th><th>Piloto</th><th>Elementos</th><th>Anomalías</th><th>Acciones</th></tr></thead>
                    <tbody>
                    ${items.map(i => `
                        <tr class="${i.completado ? 'row-completed' : ''}">
                            <td data-label="Nombre"><strong>${i.nombre}</strong>${i.completado ? ' <i class="fas fa-check-circle" style="color:var(--success);font-size:0.8rem;" title="Completado"></i>' : ''}<br><small class="badge badge-${tipoBadge[tipoKey] || 'info'}">${i.subtipo || tipoLabels[tipoKey]}</small></td>
                            <td data-label="Fecha">${Dronigest.Utils.formatDate(i.fecha)}</td>
                            <td data-label="Cliente">${i.cliente || '-'}</td>
                            <td data-label="Piloto">${i.piloto || '-'}</td>
                            <td data-label="Elementos">${i.numElementos || 0}</td>
                            <td data-label="Anomalías">${i.numAnomalias > 0 ? `<span style="color:var(--danger);font-weight:700;">${i.numAnomalias}</span>` : '0'}</td>
                            <td class="actions">
                                ${i.completado ? `
                                <button class="btn-action pdf" onclick="Dronigest.Informes.generar('inspeccion','${i.id}')" title="Generar informe PDF"><i class="fas fa-file-pdf"></i></button>
                                ` : `
                                <button class="btn-action edit" onclick="Dronigest.Inspecciones.editar('${i.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action complete" onclick="Dronigest.Informes.completar('inspeccion','${i.id}')" title="Marcar como completado"><i class="fas fa-check"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Inspecciones.eliminar('${i.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                                `}
                            </td>
                        </tr>
                    `).join('')}
                    </tbody>
                </table>`;
        });
    }
};

/* ===== AGRICOLA ===== */
Dronigest.Agricola = {
    nuevo() {
        const body = `
            <div class="form-group"><label>Nombre del trabajo</label><input type="text" id="agNombre" class="form-control" placeholder="Ej: Pulverización viña"></div>
            <div class="form-row">
                <div class="form-group"><label>Tipo de trabajo agrícola</label>
                    <select id="agTipo" class="form-control">
                        <option value="pulverizacion">Pulverización</option>
                        <option value="siembra">Siembra</option>
                        <option value="fertilizacion">Fertilización</option>
                        <option value="censos">Censos agrícolas</option>
                        <option value="vigilancia">Vigilancia de cultivos</option>
                        <option value="tratamiento_semilla">Tratamiento de semillas</option>
                        <option value="dispersión_abono">Dispersión de abono</option>
                        <option value="polinizacion">Polinización asistida</option>
                        <option value="control_plagas">Control de plagas</option>
                        <option value="riego">Control de riego</option>
                        <option value="cosecha_asistida">Cosecha asistida</option>
                        <option value="otro_ag">Otro</option>
                    </select>
                </div>
                <div class="form-group"><label>Cultivo</label><input type="text" id="agCultivo" class="form-control" placeholder="Ej: Olivar, Viña, Trigo..."></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Superficie (ha)</label><input type="number" step="0.01" id="agSuperficie" class="form-control" placeholder="Hectáreas"></div>
                <div class="form-group"><label>Fecha</label><input type="date" id="agFecha" class="form-control" value="${new Date().toISOString().split('T')[0]}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Producto utilizado</label><input type="text" id="agProducto" class="form-control" placeholder="Nombre del producto"></div>
                <div class="form-group"><label>Dosis (l/ha)</label><input type="number" step="0.01" id="agDosis" class="form-control" placeholder="Litros por hectárea"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Piloto</label>
                    <select id="agPiloto" class="form-control">
                        <option value="">Seleccionar piloto</option>
                        ${Dronigest.DB.get('pilotos').map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>Drone utilizado</label>
                    <select id="agDrone" class="form-control">
                        <option value="">Seleccionar drone</option>
                        ${Dronigest.DB.get('drones').map(d => `<option value="${d.nombre}">${d.nombre}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Condiciones del terreno</label>
                <select id="agTerreno" class="form-control">
                    <option value="llano">Llano</option>
                    <option value="onduante">Ondulante</option>
                    <option value="montañoso">Montañoso</option>
                    <option value="misto">Misto</option>
                </select>
            </div>
            <div class="form-group"><label>Observaciones</label><textarea id="agObs" class="form-control" placeholder="Notas del trabajo agrícola..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-seedling"></i> Nuevo Trabajo Agrícola', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Agricola.guardar()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardar(id) {
        const data = {
            nombre: document.getElementById('agNombre').value,
            tipo: document.getElementById('agTipo').value,
            cultivo: document.getElementById('agCultivo').value,
            superficie: parseFloat(document.getElementById('agSuperficie').value) || 0,
            fecha: document.getElementById('agFecha').value,
            producto: document.getElementById('agProducto').value,
            dosis: parseFloat(document.getElementById('agDosis').value) || 0,
            piloto: document.getElementById('agPiloto').value,
            drone: document.getElementById('agDrone').value,
            terreno: document.getElementById('agTerreno').value,
            observaciones: document.getElementById('agObs').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('agricola', id, data);
            Dronigest.Toast.show('Trabajo agrícola actualizado', 'success');
        } else {
            Dronigest.DB.add('agricola', data);
            Dronigest.Toast.show('Trabajo agrícola registrado', 'success');
            Dronigest.DB.logActividad('agricola', 'Trabajo agrícola registrado', data.nombre);
        }
        Dronigest.Modal.cerrar();
        this.listar();
    },

    editar(id) {
        const t = Dronigest.DB.find('agricola', id);
        if (!t) return;
        this.nuevo();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Trabajo Agrícola';
            const keyMap = { agNombre:'nombre', agTipo:'tipo', agCultivo:'cultivo', agSuperficie:'superficie',
                agFecha:'fecha', agProducto:'producto', agDosis:'dosis', agPiloto:'piloto',
                agDrone:'drone', agTerreno:'terreno', agObs:'observaciones' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && t[dataKey] !== undefined && t[dataKey] !== null) el.value = t[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Agricola.guardar('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminar(id) {
        if (confirm('¿Eliminar este trabajo agrícola?')) {
            Dronigest.DB.remove('agricola', id);
            Dronigest.Toast.show('Trabajo eliminado', 'info');
            this.listar();
        }
    },

    listar() {
        const trabajos = Dronigest.DB.get('agricola').sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        const container = document.getElementById('listaAgricola');
        const tipoLabels = {
            pulverizacion: 'Pulverización', siembra: 'Siembra', fertilizacion: 'Fertilización',
            censos: 'Censos', vigilancia: 'Vigilancia', tratamiento_semilla: 'Tratamiento semilla',
            'dispersión_abono': 'Dispersión abono', polinizacion: 'Polinización',
            control_plagas: 'Control plagas', riego: 'Riego', cosecha_asistida: 'Cosecha asistida', otro_ag: 'Otro'
        };
        if (trabajos.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay trabajos agrícolas registrados</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>Tipo</th><th>Cultivo</th><th>Superficie</th><th>Producto</th><th>Fecha</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${trabajos.map(t => `
                        <tr class="${t.completado ? 'row-completed' : ''}">
                            <td data-label="Nombre"><strong>${t.nombre}</strong>${t.completado ? ' <i class="fas fa-check-circle" style="color:var(--success);font-size:0.8rem;" title="Completado"></i>' : ''}</td>
                            <td data-label="Tipo"><span class="badge badge-success">${tipoLabels[t.tipo] || t.tipo}</span></td>
                            <td data-label="Cultivo">${t.cultivo || '-'}</td>
                            <td data-label="Superficie">${t.superficie ? t.superficie + ' ha' : '-'}</td>
                            <td data-label="Producto">${t.producto || '-'}</td>
                            <td data-label="Fecha">${Dronigest.Utils.formatDate(t.fecha)}</td>
                            <td class="actions">
                                ${t.completado ? `
                                <button class="btn-action pdf" onclick="Dronigest.Informes.generar('agricola','${t.id}')" title="Generar informe PDF"><i class="fas fa-file-pdf"></i></button>
                                ` : `
                                <button class="btn-action edit" onclick="Dronigest.Agricola.editar('${t.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action complete" onclick="Dronigest.Informes.completar('agricola','${t.id}')" title="Marcar como completado"><i class="fas fa-check"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Agricola.eliminar('${t.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                                `}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }
};

/* ===== CONTROL CINEGETICO ===== */
Dronigest.Cinegetico = {
    mostrarTab(tab) {
        document.querySelectorAll('#page-cinegetico .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#page-cinegetico .tab-content').forEach(t => t.classList.remove('active'));
        event.target.closest('.tab').classList.add('active');
        const tabMap = {
            registros: 'tabCinegRegistros',
            zonas: 'tabCinegZonas',
            especies: 'tabCinegEspecies',
            estadisticas: 'tabCinegEstadisticas'
        };
        document.getElementById(tabMap[tab]).classList.add('active');
        if (tab === 'estadisticas') this.actualizarEstadisticas();
    },

    async nuevo() {
        await Dronigest.Geolocation.refreshLocation();
        const zonas = Dronigest.DB.get('zonasCineg');
        const especies = Dronigest.DB.get('especiesCineg');
        const body = `
            <div class="form-group"><label>Nombre / Referencia del registro</label><input type="text" id="cgNombre" class="form-control" placeholder="Ej: Vuelo control jabalies zona norte"></div>
            <div class="form-row">
                <div class="form-group"><label>Tipo de control</label>
                    <select id="cgTipo" class="form-control">
                        <option value="avistamiento">Avistamiento de fauna</option>
                        <option value="censo_poblacion">Censo de poblacion</option>
                        <option value="control_plagas">Control de plagas</option>
                        <option value="vigilancia_caza">Vigilancia anti-presencia ilegal</option>
                        <option value="seguimiento_heridos">Seguimiento de animales heridos</option>
                        <option value="monitoreo_habitat">Monitoreo de habitat</option>
                        <option value="control_cierres">Control de cierres/vallados</option>
                        <option value="conteo_reproduccion">Conteo de reproduccion</option>
                        <option value="otro_cg">Otro</option>
                    </select>
                </div>
                <div class="form-group"><label>Zona cinegetica</label>
                    <select id="cgZona" class="form-control">
                        <option value="">Seleccionar zona</option>
                        ${zonas.map(z => `<option value="${z.nombre}">${z.nombre}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Fecha</label><input type="date" id="cgFecha" class="form-control" value="${new Date().toISOString().split('T')[0]}"></div>
                <div class="form-group"><label>Hora inicio</label><input type="time" id="cgHora" class="form-control" value="${new Date().toTimeString().slice(0,5)}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Piloto</label>
                    <select id="cgPiloto" class="form-control">
                        <option value="">Seleccionar piloto</option>
                        ${Dronigest.DB.get('pilotos').map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>Drone utilizado</label>
                    <select id="cgDrone" class="form-control">
                        <option value="">Seleccionar drone</option>
                        ${Dronigest.DB.get('drones').map(d => `<option value="${d.nombre}">${d.nombre}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Especie detectada</label>
                    <select id="cgEspecie" class="form-control">
                        <option value="">Sin especie concreta</option>
                        ${especies.map(e => `<option value="${e.nombre}">${e.nombre} (${e.nombreCientifico || ''})</option>`).join('')}
                        <option value="jabali">Jabalí</option>
                        <option value="ciervo">Ciervo</option>
                        <option value="corzo">Corzo</option>
                        <option value="gamuza">Gamuza</option>
                        <option value="conejo">Conejo</option>
                        <option value="liebre">Liebre</option>
                        <option value="perdiz">Perdiz</option>
                        <option value="avifauna">Avifauna</option>
                        <option value="otro_animal">Otro animal</option>
                    </select>
                </div>
                <div class="form-group"><label>Nº de individuos</label><input type="number" id="cgIndividuos" class="form-control" value="1" min="0"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Latitud</label><input type="number" step="any" id="cgLat" class="form-control" value="${(Dronigest.userLocation||{}).lat || ''}"></div>
                <div class="form-group"><label>Longitud</label><input type="number" step="any" id="cgLng" class="form-control" value="${(Dronigest.userLocation||{}).lng || ''}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Estado del animal</label>
                    <select id="cgEstadoAnimal" class="form-control">
                        <option value="saludable">Saludable</option>
                        <option value="herido">Herido</option>
                        <option value="enfermo">Enfermo</option>
                        <option value="muerto">Muerto</option>
                        <option value="desconocido">Desconocido</option>
                    </select>
                </div>
                <div class="form-group"><label>Amenaza detectada</label>
                    <select id="cgAmenaza" class="form-control">
                        <option value="ninguna">Ninguna</option>
                        <option value="voraceras">Voraceras / Trampas</option>
                        <option value="cerco_ilegal">Cercado ilegal</option>
                        <option value="presencia_personas">Presencia sospechosa</option>
                        <option value="incendio">Riesgo de incendio</option>
                        <option value="daño_cultivos">Dano en cultivos</option>
                        <option value="otra_amenaza">Otra amenaza</option>
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Observaciones</label><textarea id="cgObs" class="form-control" placeholder="Detalle de las observaciones: comportamiento, habitat, condiciones..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-crosshairs"></i> Nuevo Registro de Control', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Cinegetico.guardar()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardar(id) {
        const data = {
            nombre: document.getElementById('cgNombre').value,
            tipo: document.getElementById('cgTipo').value,
            zona: document.getElementById('cgZona').value,
            fecha: document.getElementById('cgFecha').value,
            hora: document.getElementById('cgHora').value,
            piloto: document.getElementById('cgPiloto').value,
            drone: document.getElementById('cgDrone').value,
            especie: document.getElementById('cgEspecie').value,
            individuos: parseInt(document.getElementById('cgIndividuos').value) || 0,
            lat: parseFloat(document.getElementById('cgLat').value) || null,
            lng: parseFloat(document.getElementById('cgLng').value) || null,
            estadoAnimal: document.getElementById('cgEstadoAnimal').value,
            amenaza: document.getElementById('cgAmenaza').value,
            observaciones: document.getElementById('cgObs').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre para el registro', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('cinegetico', id, data);
            Dronigest.Toast.show('Registro de control actualizado', 'success');
        } else {
            Dronigest.DB.add('cinegetico', data);
            Dronigest.Toast.show('Registro de control cinegetico guardado', 'success');
            Dronigest.DB.logActividad('cinegetico', 'Control cinegetico registrado', data.nombre);
        }
        Dronigest.Modal.cerrar();
        this.listar();
        Dronigest.Dashboard.actualizar();
    },

    editar(id) {
        const r = Dronigest.DB.find('cinegetico', id);
        if (!r) return;
        this.nuevo();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Registro de Control';
            const keyMap = { cgNombre:'nombre', cgTipo:'tipo', cgZona:'zona', cgFecha:'fecha',
                cgHora:'hora', cgPiloto:'piloto', cgDrone:'drone', cgEspecie:'especie',
                cgIndividuos:'individuos', cgLat:'lat', cgLng:'lng', cgEstadoAnimal:'estadoAnimal',
                cgAmenaza:'amenaza', cgObs:'observaciones' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && r[dataKey] !== undefined && r[dataKey] !== null) el.value = r[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Cinegetico.guardar('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminar(id) {
        if (confirm('¿Eliminar este registro?')) {
            Dronigest.DB.remove('cinegetico', id);
            Dronigest.Toast.show('Registro eliminado', 'info');
            this.listar();
            Dronigest.Dashboard.actualizar();
        }
    },

    nuevaZona() {
        const body = `
            <div class="form-group"><label>Nombre de la zona</label><input type="text" id="zcNombre" class="form-control" placeholder="Ej: Monte Norte - Coto La Dehesa"></div>
            <div class="form-row">
                <div class="form-group"><label>Superficie (ha)</label><input type="number" step="0.01" id="zcSuperficie" class="form-control" placeholder="Hectareas"></div>
                <div class="form-group"><label>Tipo de terreno</label>
                    <select id="zcTerreno" class="form-control">
                        <option value="monte">Monte</option>
                        <option value="dehesa">Dehesa</option>
                        <option value="campo_abierto">Campo abierto</option>
                        <option value="ribera">Ribera</option>
                        <option value="montana">Montana</option>
                        <option value="misto">Misto</option>
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Especies principales</label><input type="text" id="zcEspecies" class="form-control" placeholder="Ej: Jabali, Ciervo, Perdiz"></div>
                <div class="form-group"><label>Estado</label>
                    <select id="zcEstado" class="form-control">
                        <option value="activa">Activa</option>
                        <option value="inactiva">Inactiva</option>
                        <option value="protegida">Protegida</option>
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Propietario / Gestor</label><input type="text" id="zcPropietario" class="form-control" placeholder="Nombre del propietario o gestor"></div>
            <div class="form-group"><label>Restricciones de acceso</label><textarea id="zcRestricciones" class="form-control" placeholder="Acceso, permisos necesarios, horarios..."></textarea></div>
            <div class="form-group"><label>Notas</label><textarea id="zcNotas" class="form-control" placeholder="Observaciones sobre la zona..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-map"></i> Nueva Zona Cinegetica', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Cinegetico.guardarZona()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardarZona(id) {
        const data = {
            nombre: document.getElementById('zcNombre').value,
            superficie: parseFloat(document.getElementById('zcSuperficie').value) || 0,
            terreno: document.getElementById('zcTerreno').value,
            especies: document.getElementById('zcEspecies').value,
            estado: document.getElementById('zcEstado').value,
            propietario: document.getElementById('zcPropietario').value,
            restricciones: document.getElementById('zcRestricciones').value,
            notas: document.getElementById('zcNotas').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre para la zona', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('zonasCineg', id, data);
            Dronigest.Toast.show('Zona cinegetica actualizada', 'success');
        } else {
            Dronigest.DB.add('zonasCineg', data);
            Dronigest.Toast.show('Zona cinegetica registrada', 'success');
        }
        Dronigest.Modal.cerrar();
        this.listarZonas();
    },

    editarZona(id) {
        const z = Dronigest.DB.find('zonasCineg', id);
        if (!z) return;
        this.nuevaZona();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Zona Cinegetica';
            const keyMap = { zcNombre:'nombre', zcSuperficie:'superficie', zcTerreno:'terreno',
                zcEspecies:'especies', zcEstado:'estado', zcPropietario:'propietario',
                zcRestricciones:'restricciones', zcNotas:'notas' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && z[dataKey] !== undefined && z[dataKey] !== null) el.value = z[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Cinegetico.guardarZona('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminarZona(id) {
        if (confirm('¿Eliminar esta zona cinegetica?')) {
            Dronigest.DB.remove('zonasCineg', id);
            Dronigest.Toast.show('Zona eliminada', 'info');
            this.listarZonas();
        }
    },

    listar() {
        const registros = Dronigest.DB.get('cinegetico').sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        const container = document.getElementById('listaCinegetico');
        const tipoLabels = {
            avistamiento: 'Avistamiento', censo_poblacion: 'Censo', control_plagas: 'Control plagas',
            vigilancia_caza: 'Vigilancia', seguimiento_heridos: 'Seguimiento heridos',
            monitoreo_habitat: 'Monitoreo habitat', control_cierres: 'Control cierres',
            conteo_reproduccion: 'Conteo reproduccion', otro_cg: 'Otro'
        };
        const amenazaLabels = {
            ninguna: '-', voraceras: 'Voraceras', cerco_ilegal: 'Cercado ilegal',
            presencia_personas: 'Personas sospechosas', incendio: 'Incendio',
            daño_cultivos: 'Dano cultivos', otra_amenaza: 'Otra'
        };
        if (registros.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay registros de control cinegetico</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>Tipo</th><th>Fecha</th><th>Especie</th><th>Nº</th><th>Zona</th><th>Amenaza</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${registros.map(r => `
                        <tr class="${r.completado ? 'row-completed' : ''}">
                            <td data-label="Nombre"><strong>${r.nombre}</strong>${r.completado ? ' <i class="fas fa-check-circle" style="color:var(--success);font-size:0.8rem;" title="Completado"></i>' : ''}</td>
                            <td data-label="Tipo"><span class="badge badge-info">${tipoLabels[r.tipo] || r.tipo}</span></td>
                            <td data-label="Fecha">${Dronigest.Utils.formatDate(r.fecha)} ${r.hora || ''}</td>
                            <td data-label="Especie"><span class="badge badge-success">${r.especie || '-'}</span></td>
                            <td data-label="Nº"><strong>${r.individuos || 0}</strong></td>
                            <td data-label="Zona">${r.zona || '-'}</td>
                            <td data-label="Amenaza">${r.amenaza && r.amenaza !== 'ninguna' ? `<span class="badge badge-danger">${amenazaLabels[r.amenaza] || r.amenaza}</span>` : '-'}</td>
                            <td class="actions">
                                ${r.completado ? `
                                <button class="btn-action pdf" onclick="Dronigest.Informes.generar('cinegetico','${r.id}')" title="Generar informe PDF"><i class="fas fa-file-pdf"></i></button>
                                ` : `
                                <button class="btn-action edit" onclick="Dronigest.Cinegetico.editar('${r.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action complete" onclick="Dronigest.Informes.completar('cinegetico','${r.id}')" title="Marcar como completado"><i class="fas fa-check"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Cinegetico.eliminar('${r.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                                `}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    },

    listarZonas() {
        const zonas = Dronigest.DB.get('zonasCineg');
        const container = document.getElementById('listaZonasCineg');
        if (zonas.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay zonas cinegeticas registradas</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>Superficie</th><th>Terreno</th><th>Especies</th><th>Estado</th><th>Propietario</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${zonas.map(z => `
                        <tr>
                            <td data-label="Nombre"><strong>${z.nombre}</strong></td>
                            <td data-label="Superficie">${z.superficie ? z.superficie + ' ha' : '-'}</td>
                            <td data-label="Terreno"><span class="badge badge-info">${z.terreno || '-'}</span></td>
                            <td data-label="Especies">${z.especies || '-'}</td>
                            <td data-label="Estado"><span class="badge badge-${z.estado === 'activa' ? 'success' : z.estado === 'protegida' ? 'warning' : 'info'}">${z.estado || '-'}</span></td>
                            <td data-label="Propietario">${z.propietario || '-'}</td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.Cinegetico.editarZona('${z.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Cinegetico.eliminarZona('${z.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    },

    listarEspecies() {
        const especies = Dronigest.DB.get('especiesCineg');
        const container = document.getElementById('listaEspeciesCineg');
        if (especies.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay especies registradas</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>Nombre Cientifico</th><th>Familia</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${especies.map(e => `
                        <tr>
                            <td data-label="Nombre"><strong>${e.nombre}</strong></td>
                            <td data-label="Nombre Científico"><em>${e.nombreCientifico || '-'}</em></td>
                            <td data-label="Familia">${e.familia || '-'}</td>
                            <td data-label="Estado"><span class="badge badge-${e.estado === 'comun' ? 'success' : e.estado === 'protegida' ? 'danger' : 'warning'}">${e.estado || '-'}</span></td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.Cinegetico.editarEspecie('${e.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Cinegetico.eliminarEspecie('${e.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    },

    eliminarEspecie(id) {
        if (confirm('¿Eliminar esta especie?')) {
            Dronigest.DB.remove('especiesCineg', id);
            Dronigest.Toast.show('Especie eliminada', 'info');
            this.listarEspecies();
        }
    },

    nuevaEspecie() {
        const body = `
            <div class="form-group"><label>Nombre común</label><input type="text" id="ecNombre" class="form-control" placeholder="Ej: Jabalí"></div>
            <div class="form-row">
                <div class="form-group"><label>Nombre científico</label><input type="text" id="ecCientifico" class="form-control" placeholder="Ej: Sus scrofa"></div>
                <div class="form-group"><label>Familia</label><input type="text" id="ecFamilia" class="form-control" placeholder="Ej: Suidae"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Estado de conservación</label>
                    <select id="ecEstado" class="form-control">
                        <option value="comun">Común</option>
                        <option value="protegida">Protegida</option>
                        <option value="en_peligro">En peligro</option>
                        <option value="vulnerable">Vulnerable</option>
                    </select>
                </div>
                <div class="form-group"><label>Hábitat</label><input type="text" id="ecHabitat" class="form-control" placeholder="Ej: Monte mediterráneo"></div>
            </div>
            <div class="form-group"><label>Descripción / Notas</label><textarea id="ecNotas" class="form-control" placeholder="Características, comportamiento..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-paw"></i> Nueva Especie', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.Cinegetico.guardarEspecie()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardarEspecie(id) {
        const data = {
            nombre: document.getElementById('ecNombre').value,
            nombreCientifico: document.getElementById('ecCientifico').value,
            familia: document.getElementById('ecFamilia').value,
            estado: document.getElementById('ecEstado').value,
            habitat: document.getElementById('ecHabitat').value,
            descripcion: document.getElementById('ecNotas').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce el nombre de la especie', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('especiesCineg', id, data);
            Dronigest.Toast.show('Especie actualizada', 'success');
        } else {
            Dronigest.DB.add('especiesCineg', data);
            Dronigest.Toast.show('Especie registrada', 'success');
        }
        Dronigest.Modal.cerrar();
        this.listarEspecies();
    },

    editarEspecie(id) {
        const e = Dronigest.DB.find('especiesCineg', id);
        if (!e) return;
        this.nuevaEspecie();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Especie';
            const keyMap = { ecNombre:'nombre', ecCientifico:'nombreCientifico', ecFamilia:'familia',
                ecEstado:'estado', ecHabitat:'habitat', ecNotas:'descripcion' };
            Object.entries(keyMap).forEach(([elId, dataKey]) => {
                const el = document.getElementById(elId);
                if (el && e[dataKey] !== undefined && e[dataKey] !== null) el.value = e[dataKey];
            });
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.Cinegetico.guardarEspecie('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    actualizarEstadisticas() {
        const registros = Dronigest.DB.get('cinegetico');
        const especies = Dronigest.DB.get('especiesCineg');
        const zonas = Dronigest.DB.get('zonasCineg');

        document.getElementById('cinegTotalRegistros').textContent = registros.length;
        document.getElementById('cinegTotalEspecies').textContent = especies.length;
        document.getElementById('cinegTotalZonas').textContent = zonas.length;
        document.getElementById('cinegTotalAvistamientos').textContent = registros.filter(r => r.tipo === 'avistamiento').length;

        const conteo = {};
        registros.forEach(r => {
            const sp = r.especie || 'Desconocida';
            if (!conteo[sp]) conteo[sp] = { total: 0, individuos: 0, amenazas: 0 };
            conteo[sp].total++;
            conteo[sp].individuos += r.individuos || 0;
            if (r.amenaza && r.amenaza !== 'ninguna') conteo[sp].amenazas++;
        });

        const container = document.getElementById('cinegEstadisticasEspecies');
        const entries = Object.entries(conteo).sort((a, b) => b[1].individuos - a[1].individuos);
        if (entries.length === 0) {
            container.innerHTML = '<p class="empty-state">Sin datos para estadisticas</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Especie</th><th>Registros</th><th>Total individuos</th><th>Amenazas detectadas</th></tr></thead>
                <tbody>
                    ${entries.map(([sp, d]) => `
                        <tr>
                            <td><strong>${sp}</strong></td>
                            <td>${d.total}</td>
                            <td><strong>${d.individuos}</strong></td>
                            <td>${d.amenazas > 0 ? `<span style="color:var(--danger);font-weight:700;">${d.amenazas}</span>` : '0'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }
};

/* ===== METEOROLOGÍA ===== */
Dronigest.Meteo = {
    init() {
        const btn = document.getElementById('btnWeather');
        if (btn) btn.onclick = () => { Dronigest.Navigation.goTo('meteorologia'); };
        const btnGeo = document.getElementById('btnGeolocate');
        if (btnGeo) btnGeo.onclick = async () => {
            Dronigest.Toast.show('Detectando ubicación...', 'info');
            await Dronigest.Geolocation.refreshLocation(true);
            if (Dronigest.userLocation) {
                localStorage.removeItem('dronigest_manual_location');
                Dronigest.Toast.show(`Ubicación actualizada`, 'success');
            }
        };

        setTimeout(() => this.cargarDashboard(), 2000);
    },

    async cargarDashboard() {
        const container = document.getElementById('dashboardWeather');
        if (!container) return;
        await Dronigest.Geolocation.refreshLocation();
        const loc = Dronigest.userLocation || { lat: 40.4168, lng: -3.7038 };
        const cityName = Dronigest.Geolocation.cityName || `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
        container.innerHTML = `
            <div class="weather-location"><i class="fas fa-map-marker-alt"></i> ${cityName}</div>
            <div class="weather-loading"><i class="fas fa-spinner fa-spin"></i><p>Cargando meteorología...</p></div>`;
        try {
            const data = await this.fetchWeather(loc.lat, loc.lng);
            const c = data.current;
            container.innerHTML = `
                <div class="weather-location"><i class="fas fa-map-marker-alt"></i> ${cityName}</div>
                <div style="display:flex;align-items:center;gap:1rem;">
                    <i class="fas ${c.icon}" style="font-size:2.5rem;color:#0288D1;"></i>
                    <div>
                        <div style="font-size:1.5rem;font-weight:700;">${c.temp}°C</div>
                        <div style="color:var(--text-light);">${c.description}</div>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.8rem;font-size:0.85rem;">
                    <div><i class="fas fa-wind" style="color:#0288D1;"></i> Viento: ${c.wind} km/h ${c.windDir}</div>
                    <div><i class="fas fa-droplet" style="color:#0288D1;"></i> Humedad: ${c.humidity}%</div>
                    <div><i class="fas fa-cloud" style="color:#0288D1;"></i> Nubosidad: ${c.cloudCover}%</div>
                    <div><i class="fas fa-cloud-rain" style="color:#0288D1;"></i> Precip: ${c.precip} mm</div>
                </div>`;
        } catch {
            container.innerHTML = `
                <div class="weather-location"><i class="fas fa-map-marker-alt"></i> ${cityName}</div>
                <p class="empty-state">No se pudieron cargar datos meteorológicos</p>`;
        }
    },

    async obtenerMeteorologia() {
        await Dronigest.Geolocation.refreshLocation();
        const loc = Dronigest.userLocation || { lat: 40.4168, lng: -3.7038 };

        const container = document.getElementById('meteoActual');
        container.innerHTML = '<div class="weather-loading"><i class="fas fa-spinner fa-spin"></i><p>Cargando datos meteorológicos de AEMET...</p></div>';

        try {
            const weatherData = await this.fetchWeather(loc.lat, loc.lng);
            this.renderWeather(weatherData);
            this.renderForecast(weatherData);
            this.renderEvaluacion(weatherData);
        } catch (e) {
            container.innerHTML = `
                <div class="weather-loading">
                    <i class="fas fa-cloud-rain"></i>
                    <p>No se pudieron obtener datos de AEMET</p>
                    <p style="font-size:0.8rem;margin-top:0.5rem;">Usando datos de Open-Meteo como respaldo</p>
                </div>`;
            try {
                const backup = await this.fetchOpenMeteo(loc.lat, loc.lng);
                this.renderWeather(backup);
                this.renderForecast(backup);
                this.renderEvaluacion(backup);
            } catch {
                container.innerHTML = '<div class="weather-loading"><i class="fas fa-exclamation-triangle"></i><p>Error al obtener datos meteorológicos</p></div>';
            }
        }
    },

    async fetchWeather(lat, lng) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max&timezone=auto&forecast_days=7`;
        const res = await fetch(url);
        const data = await res.json();
        return this.formatOpenMeteo(data);
    },

    async fetchOpenMeteo(lat, lng) {
        return this.fetchWeather(lat, lng);
    },

    formatOpenMeteo(data) {
        const weatherCodes = {
            0: 'Despejado', 1: 'Principalmente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
            45: 'Niebla', 48: 'Niebla con escarcha', 51: 'Lluvia ligera', 53: 'Lluvia moderada',
            55: 'Lluvia intensa', 56: 'Lluvia helada ligera', 57: 'Lluvia helada intensa',
            61: 'Lluvia ligera', 63: 'Lluvia moderada', 65: 'Lluvia fuerte',
            66: 'Lluvia helada ligera', 67: 'Lluvia helada fuerte',
            71: 'Nieve ligera', 73: 'Nieve moderada', 75: 'Nieve fuerte',
            77: 'Granizo', 80: 'Chubascos ligeros', 81: 'Chubascos moderados',
            82: 'Chubascos fuertes', 85: 'Chubascos de nieve ligeros',
            86: 'Chubascos de nieve fuertes', 95: 'Tormenta', 96: 'Tormenta con granizo',
            99: 'Tormenta fuerte con granizo'
        };
        const weatherIcons = {
            0: 'fa-sun', 1: 'fa-cloud-sun', 2: 'fa-cloud', 3: 'fa-cloud',
            45: 'fa-smog', 48: 'fa-smog', 51: 'fa-cloud-rain', 53: 'fa-cloud-rain',
            55: 'fa-cloud-showers-heavy', 56: 'fa-cloud-rain', 57: 'fa-cloud-showers-heavy',
            61: 'fa-cloud-rain', 63: 'fa-cloud-showers-heavy', 65: 'fa-cloud-showers-heavy',
            66: 'fa-cloud-rain', 67: 'fa-cloud-showers-heavy',
            71: 'fa-snowflake', 73: 'fa-snowflake', 75: 'fa-snowflake',
            77: 'fa-cloud-meatball', 80: 'fa-cloud-rain', 81: 'fa-cloud-showers-heavy',
            82: 'fa-cloud-showers-heavy', 85: 'fa-snowflake', 86: 'fa-snowflake',
            95: 'fa-bolt', 96: 'fa-bolt', 99: 'fa-bolt'
        };
        const windDir = (deg) => {
            const dirs = ['N','NE','E','SE','S','SO','O','NO'];
            return dirs[Math.round(deg / 45) % 8];
        };
        const current = data.current;
        const code = current.weather_code;
        return {
            current: {
                temp: current.temperature_2m,
                feelsLike: current.apparent_temperature,
                humidity: current.relative_humidity_2m,
                wind: current.wind_speed_10m,
                windDir: windDir(current.wind_direction_10m),
                windGust: current.wind_gusts_10m || 0,
                precip: current.precipitation,
                cloudCover: current.cloud_cover,
                description: weatherCodes[code] || 'Desconocido',
                icon: weatherIcons[code] || 'fa-cloud'
            },
            forecast: (data.daily.time || []).map((date, i) => ({
                date,
                maxTemp: data.daily.temperature_2m_max[i],
                minTemp: data.daily.temperature_2m_min[i],
                precip: data.daily.precipitation_sum[i],
                wind: data.daily.wind_speed_10m_max[i],
                gusts: data.daily.wind_gusts_10m_max[i],
                code: data.daily.weather_code[i],
                description: weatherCodes[data.daily.weather_code[i]] || 'Desconocido',
                icon: weatherIcons[data.daily.weather_code[i]] || 'fa-cloud'
            }))
        };
    },

    renderWeather(data) {
        const c = data.current;
        document.getElementById('meteoActual').innerHTML = `
            <div class="weather-current">
                <div class="location"><i class="fas fa-map-marker-alt"></i> ${Dronigest.Geolocation.cityName || 'Ubicación actual'}</div>
                <div style="display:flex;align-items:center;gap:1.5rem;margin-top:1rem;">
                    <i class="fas ${c.icon}" style="font-size:3.5rem;"></i>
                    <div>
                        <div class="temp">${c.temp}°C</div>
                        <div class="desc">${c.description}</div>
                    </div>
                </div>
            </div>
            <div class="weather-detail">
                <i class="fas fa-temperature-half"></i>
                <div class="value">${c.feelsLike}°C</div>
                <div class="label">Sensación térmica</div>
            </div>
            <div class="weather-detail">
                <i class="fas fa-droplet"></i>
                <div class="value">${c.humidity}%</div>
                <div class="label">Humedad relativa</div>
            </div>
            <div class="weather-detail">
                <i class="fas fa-wind"></i>
                <div class="value">${c.wind} km/h</div>
                <div class="label">Viento ${c.windDir}</div>
            </div>
            <div class="weather-detail">
                <i class="fas fa-wind"></i>
                <div class="value">${c.windGust} km/h</div>
                <div class="label">Ráfagas máx</div>
            </div>
            <div class="weather-detail">
                <i class="fas fa-cloud"></i>
                <div class="value">${c.cloudCover}%</div>
                <div class="label">Nubosidad</div>
            </div>
            <div class="weather-detail">
                <i class="fas fa-cloud-rain"></i>
                <div class="value">${c.precip} mm</div>
                <div class="label">Precipitación</div>
            </div>`;
    },

    renderForecast(data) {
        const container = document.getElementById('meteoForecast');
        if (!data.forecast || data.forecast.length === 0) {
            container.innerHTML = '<p class="empty-state">Sin previsión disponible</p>';
            return;
        }
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        container.innerHTML = data.forecast.map(d => {
            const dt = new Date(d.date);
            return `
                <div class="forecast-day">
                    <div class="day-name">${dayNames[dt.getDay()]} ${dt.getDate()}</div>
                    <div class="day-icon"><i class="fas ${d.icon}"></i></div>
                    <div class="day-temp">${d.maxTemp}° / ${d.minTemp}°</div>
                    <div class="day-desc">${d.description}</div>
                    <div style="margin-top:8px;font-size:0.75rem;color:var(--text-light);">
                        <i class="fas fa-wind"></i> ${d.wind} km/h · <i class="fas fa-cloud-rain"></i> ${d.precip}mm
                    </div>
                </div>`;
        }).join('');
    },

    renderEvaluacion(data) {
        const c = data.current;
        const checks = [
            { label: 'Viento', value: `${c.wind} km/h`, valid: c.wind <= 40, warning: c.wind > 30 && c.wind <= 40 },
            { label: 'Ráfagas', value: `${c.windGust} km/h`, valid: c.windGust <= 50, warning: c.windGust > 40 && c.windGust <= 50 },
            { label: 'Precipitación', value: `${c.precip} mm`, valid: c.precip === 0, warning: c.precip > 0 && c.precip < 0.5 },
            { label: 'Visibilidad (nubosidad)', value: `${c.cloudCover}%`, valid: c.cloudCover < 80, warning: c.cloudCover >= 80 && c.cloudCover < 95 },
            { label: 'Temperatura', value: `${c.temp}°C`, valid: c.temp > -10 && c.temp < 45, warning: false }
        ];
        const allValid = checks.every(ch => ch.valid);
        document.getElementById('meteoEvaluacion').innerHTML = `
            <div style="margin-bottom:1rem;padding:1rem;border-radius:var(--radius);background:${allValid ? '#E8F5E9' : '#FFF8E1'};border:1px solid ${allValid ? '#A5D6A7' : '#FFE082'};">
                <strong style="font-size:1.1rem;color:${allValid ? 'var(--success)' : '#F57F17'};">
                    <i class="fas fa-${allValid ? 'check-circle' : 'exclamation-triangle'}"></i>
                    ${allValid ? 'Condiciones ADECUADAS para vuelo' : 'Condiciones REQUIEREN PRECAUCIÓN'}
                </strong>
            </div>
            <div class="evaluacion-vuelo">
                ${checks.map(ch => `
                    <div class="eval-item ${ch.valid ? 'valid' : ch.warning ? 'warning' : 'invalid'}">
                        <i class="fas fa-${ch.valid ? 'check-circle' : ch.warning ? 'exclamation-triangle' : 'times-circle'}"></i>
                        <span class="eval-text">${ch.label}</span>
                        <span class="eval-value">${ch.value}</span>
                    </div>
                `).join('')}
            </div>`;
    }
};

/* ===== CATEGORÍAS AESA ===== */
Dronigest.CategoriasAesa = {
    nueva() {
        const body = `
            <div class="form-group"><label>Nombre</label><input type="text" id="caNombre" class="form-control" placeholder="Ej: A1-A3"></div>
            <div class="form-group"><label>Descripción</label><textarea id="caDesc" class="form-control" placeholder="Descripción de la categoría..."></textarea></div>
        `;
        Dronigest.Modal.show('<i class="fas fa-plus"></i> Nueva Categoría AESA', body, `
            <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
            <button class="btn-primary" onclick="Dronigest.CategoriasAesa.guardar()"><i class="fas fa-save"></i> Guardar</button>
        `);
    },

    guardar(id) {
        const data = {
            nombre: document.getElementById('caNombre').value,
            descripcion: document.getElementById('caDesc').value
        };
        if (!data.nombre) { Dronigest.Toast.show('Introduce un nombre', 'warning'); return; }
        if (id) {
            Dronigest.DB.update('categoriasAesa', id, data);
            Dronigest.Toast.show('Categoría actualizada', 'success');
        } else {
            Dronigest.DB.add('categoriasAesa', data);
            Dronigest.Toast.show('Categoría registrada', 'success');
        }
        Dronigest.Modal.cerrar();
        this.listar();
    },

    editar(id) {
        const c = Dronigest.DB.find('categoriasAesa', id);
        if (!c) return;
        this.nueva();
        setTimeout(() => {
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Categoría AESA';
            document.getElementById('caNombre').value = c.nombre || '';
            document.getElementById('caDesc').value = c.descripcion || '';
            document.getElementById('modalFooter').innerHTML = `
                <button class="btn-secondary" onclick="Dronigest.Modal.cerrar()">Cancelar</button>
                <button class="btn-primary" onclick="Dronigest.CategoriasAesa.guardar('${id}')"><i class="fas fa-save"></i> Actualizar</button>`;
        }, 100);
    },

    eliminar(id) {
        if (confirm('¿Eliminar esta categoría AESA?')) {
            Dronigest.DB.remove('categoriasAesa', id);
            Dronigest.Toast.show('Categoría eliminada', 'info');
            this.listar();
        }
    },

    listar() {
        const cats = Dronigest.DB.get('categoriasAesa');
        const container = document.getElementById('listaCategoriasAesa');
        if (cats.length === 0) {
            container.innerHTML = '<p class="empty-state">No hay categorías AESA registradas</p>';
            return;
        }
        container.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Nombre</th><th>Descripción</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${cats.map(c => `
                        <tr>
                            <td data-label="Nombre"><strong>${c.nombre}</strong></td>
                            <td data-label="Descripción">${c.descripcion || '-'}</td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.CategoriasAesa.editar('${c.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.CategoriasAesa.eliminar('${c.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }
};

/* ===== INFORMES PDF ===== */
Dronigest.Informes = {
    generar(tipo, id) {
        let item, title, fields;
        if (tipo === 'inspeccion') {
            item = Dronigest.DB.find('inspecciones', id);
            if (!item) return;
            title = 'Informe de Inspección';
            const tipoLabels = { solar: 'Planta Solar', eolica: 'Torre Eólica', tendido: 'Tendido Eléctrico', superficies: 'Control Superficies' };
            fields = [
                ['Nombre / Referencia', item.nombre],
                ['Tipo', tipoLabels[item.tipo] || item.tipo],
                ['Subtipo', item.subtipo || '-'],
                ['Cliente', item.cliente || '-'],
                ['Fecha', Dronigest.Utils.formatDate(item.fecha)],
                ['Piloto', item.piloto || '-'],
                ['Ubicación', item.ubicacion || '-'],
                ['Elementos inspeccionados', String(item.numElementos || 0)],
                ['Anomalías encontradas', String(item.numAnomalias || 0)],
                ['Observaciones', item.observaciones || 'Ninguna']
            ];
        } else if (tipo === 'agricola') {
            item = Dronigest.DB.find('agricola', id);
            if (!item) return;
            title = 'Informe de Trabajo Agrícola';
            const tipoLabels = {
                pulverizacion: 'Pulverización', siembra: 'Siembra', fertilizacion: 'Fertilización',
                censos: 'Censos', vigilancia: 'Vigilancia', tratamiento_semilla: 'Tratamiento semilla',
                'dispersión_abono': 'Dispersión abono', polinizacion: 'Polinización',
                control_plagas: 'Control plagas', riego: 'Riego', cosecha_asistida: 'Cosecha asistida', otro_ag: 'Otro'
            };
            const terrenoLabels = { llano: 'Llano', onduante: 'Ondulado', montañoso: 'Montañoso', misto: 'Mixto' };
            fields = [
                ['Nombre del trabajo', item.nombre],
                ['Tipo', tipoLabels[item.tipo] || item.tipo],
                ['Cultivo', item.cultivo || '-'],
                ['Superficie', item.superficie ? item.superficie + ' ha' : '-'],
                ['Fecha', Dronigest.Utils.formatDate(item.fecha)],
                ['Producto', item.producto || '-'],
                ['Dosis', item.dosis ? item.dosis + ' l/ha' : '-'],
                ['Piloto', item.piloto || '-'],
                ['Drone', item.drone || '-'],
                ['Terreno', terrenoLabels[item.terreno] || item.terreno || '-'],
                ['Observaciones', item.observaciones || 'Ninguna']
            ];
        } else if (tipo === 'cinegetico') {
            item = Dronigest.DB.find('cinegetico', id);
            if (!item) return;
            title = 'Informe de Control Cinegético';
            const tipoLabels = {
                avistamiento: 'Avistamiento', censo_poblacion: 'Censo población', control_plagas: 'Control plagas',
                vigilancia_caza: 'Vigilancia caza', seguimiento_heridos: 'Seguimiento heridos',
                monitoreo_habitat: 'Monitoreo hábitat', control_cierres: 'Control cierres',
                conteo_reproduccion: 'Conteo reproducción', otro_cg: 'Otro'
            };
            const estadoLabels = { saludable: 'Saludable', herido: 'Herido', enfermo: 'Enfermo', muerto: 'Muerto', desconocido: 'Desconocido' };
            const amenazaLabels = {
                ninguna: 'Ninguna', voraceras: 'Voraceras', cerco_ilegal: 'Cercado ilegal',
                presencia_personas: 'Personas sospechosas', incendio: 'Incendio',
                daño_cultivos: 'Daño cultivos', otra_amenaza: 'Otra'
            };
            fields = [
                ['Nombre / Referencia', item.nombre],
                ['Tipo', tipoLabels[item.tipo] || item.tipo],
                ['Zona cinegética', item.zona || '-'],
                ['Fecha', Dronigest.Utils.formatDate(item.fecha)],
                ['Hora', item.hora || '-'],
                ['Piloto', item.piloto || '-'],
                ['Drone', item.drone || '-'],
                ['Especie', item.especie || '-'],
                ['Individuos', String(item.individuos || 0)],
                ['Estado del animal', estadoLabels[item.estadoAnimal] || item.estadoAnimal || '-'],
                ['Amenaza', amenazaLabels[item.amenaza] || item.amenaza || 'Ninguna'],
                ['Observaciones', item.observaciones || 'Ninguna']
            ];
        } else {
            return;
        }

        const ahora = new Date();
        const fechaStr = ahora.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const rows = fields.map(([label, value]) =>
            `<tr><td>${label}</td><td>${value}</td></tr>`
        ).join('');

        const win = window.open('', '_blank');
        win.document.write(`
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${title} - ${item.nombre}</title>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; padding: 40px; line-height: 1.5; }
    .report-header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px double #0288D1; }
    .report-header h1 { font-size: 24px; color: #01579B; margin: 0 0 5px; }
    .report-header .report-subtitle { color: #607D8B; font-size: 14px; }
    .report-info { margin-bottom: 25px; }
    .report-info table { width: 100%; border-collapse: collapse; }
    .report-info td { padding: 8px 12px; border: 1px solid #B3E5FC; font-size: 13px; }
    .report-info td:first-child { font-weight: 600; background: #E1F5FE; width: 30%; color: #01579B; }
    .report-section-title { font-size: 16px; font-weight: 700; color: #01579B; margin: 20px 0 10px; padding-bottom: 5px; border-bottom: 2px solid #B3E5FC; }
    .report-footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #B3E5FC; font-size: 11px; color: #607D8B; text-align: center; }
    .no-print { display: none !important; }
    @media print { @page { margin: 15mm; } body { padding: 0; } }
</style>
</head>
<body>
    <div class="report-header">
        <h1>${title}</h1>
        <div class="report-subtitle">Dronigest - Gestión de actividades con drones</div>
    </div>
    <div class="report-section-title">Datos del informe</div>
    <div class="report-info"><table>${rows}</table></div>
    <div class="report-footer">
        Informe generado el ${fechaStr} &mdash; Dronigest v1.5.0<br>
        Este documento es un resumen informativo sin validez legal.
    </div>
    <script>
        window.onload = function() { setTimeout(function() { window.print(); window.close(); }, 500); };
    <\/script>
</body>
</html>`);
        win.document.close();
    },

    completar(tipo, id) {
        const coleccion = tipo === 'inspeccion' ? 'inspecciones' : tipo === 'agricola' ? 'agricola' : 'cinegetico';
        const item = Dronigest.DB.find(coleccion, id);
        if (!item) return;
        if (item.completado) {
            if (!confirm('¿Desmarcar como completado?')) return;
        }
        const updates = {
            completado: !item.completado,
            fechaCompletado: !item.completado ? new Date().toISOString() : null
        };
        Dronigest.DB.update(coleccion, id, updates);
        Dronigest.Toast.show(updates.completado ? 'Registrado como completado' : 'Completado desmarcado', updates.completado ? 'success' : 'info');
        if (tipo === 'inspeccion') Dronigest.Inspecciones.listar();
        else if (tipo === 'agricola') Dronigest.Agricola.listar();
        else Dronigest.Cinegetico.listar();
    }
};

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
    Dronigest.init();
    Dronigest.Vuelos.listar();
    Dronigest.Pilotos.listarPilotos();
    Dronigest.Pilotos.listarAuxiliares();
    Dronigest.TiposVuelo.listar();
    Dronigest.TiposVuelo.listarCategorias();
    Dronigest.Equipos.listarDrones();
    Dronigest.Equipos.listarModelos();
    Dronigest.Equipos.listarAccesorios();
    Dronigest.Trabajos.listar();
    Dronigest.Inspecciones.listar();
    Dronigest.Agricola.listar();
    Dronigest.Cinegetico.listar();
    Dronigest.Cinegetico.listarZonas();
    Dronigest.Cinegetico.listarEspecies();
    Dronigest.CategoriasAesa.listar();
});
