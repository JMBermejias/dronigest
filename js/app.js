const Dronigest = {
    map: null,
    markers: [],
    userLocation: null,

    init() {
        this.Navigation.init();
        this.DB.init();
        this.Mapa.init();
        this.Dashboard.init();
        this.Geolocation.init();
        this.Meteo.init();
        this.setupInstallPrompt();
        this.registerSW();
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
Dronigest.DB = {
    init() {
        const defaults = {
            vuelos: [], pilotos: [], auxiliares: [], tiposVuelo: [],
            categorias: [], drones: [], modelos: [], accesorios: [],
            trabajos: [], inspecciones: [], agricola: [], checklists: [],
            cinegetico: [], zonasCineg: [], especiesCineg: [],
            actividad: []
        };
        Object.keys(defaults).forEach(k => {
            if (!localStorage.getItem('dronigest_' + k)) {
                localStorage.setItem('dronigest_' + k, JSON.stringify(defaults[k]));
            }
        });
    },
    get(key) {
        try { return JSON.parse(localStorage.getItem('dronigest_' + key)) || []; }
        catch { return []; }
    },
    set(key, data) {
        localStorage.setItem('dronigest_' + key, JSON.stringify(data));
    },
    add(key, item) {
        const data = this.get(key);
        item.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        item.creado = new Date().toISOString();
        data.push(item);
        this.set(key, data);
        return item;
    },
    update(key, id, updates) {
        const data = this.get(key);
        const idx = data.findIndex(i => i.id === id);
        if (idx >= 0) {
            data[idx] = { ...data[idx], ...updates, modificado: new Date().toISOString() };
            this.set(key, data);
            return data[idx];
        }
        return null;
    },
    remove(key, id) {
        const data = this.get(key).filter(i => i.id !== id);
        this.set(key, data);
    },
    find(key, id) {
        return this.get(key).find(i => i.id === id) || null;
    },
    logActividad(tipo, titulo, detalle) {
        const act = this.get('actividad');
        act.unshift({ tipo, titulo, detalle, fecha: new Date().toISOString() });
        if (act.length > 50) act.length = 50;
        this.set('actividad', act);
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
        comunicacion: 'Comunicar Vuelo - Ministerio del Interior'
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

        if (page === 'vuelos') {
            if (!Dronigest.map) {
                setTimeout(() => Dronigest.Mapa.init(), 150);
            } else {
                setTimeout(() => Dronigest.map.invalidateSize(), 300);
            }
        }
        if (page === 'meteorologia') Dronigest.Meteo.obtenerMeteorologia();
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
Dronigest.Geolocation = {
    init() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos => {
                    Dronigest.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    this.reverseGeocode(pos.coords.latitude, pos.coords.longitude);
                },
                () => {
                    Dronigest.userLocation = { lat: 40.4168, lng: -3.7038 };
                    document.querySelector('#locationInfo span').textContent = 'Madrid (por defecto)';
                },
                { enableHighAccuracy: true }
            );
        } else {
            Dronigest.userLocation = { lat: 40.4168, lng: -3.7038 };
        }
    },

    async reverseGeocode(lat, lng) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es`);
            const data = await res.json();
            const city = data.address?.city || data.address?.town || data.address?.village || data.address?.municipality || '';
            const prov = data.address?.state || data.address?.province || '';
            document.querySelector('#locationInfo span').textContent = city ? `${city}, ${prov}` : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        } catch {
            document.querySelector('#locationInfo span').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }
    }
};

/* ===== MAPA ===== */
Dronigest.Mapa = {
    init() {
        if (Dronigest.map) return;
        const loc = Dronigest.userLocation || { lat: 40.4168, lng: -3.7038 };

        Dronigest.map = L.map('map').setView([loc.lat, loc.lng], 13);

        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap', maxZoom: 19
        });

        const enaireBase = L.tileLayer('https://www.ign.es/wmts/ign-base?service=WMTS&request=GetTile&version=1.0.0&Format=image/png&layer=IGNBaseTodo&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}', {
            attribution: '&copy; IGN', maxZoom: 19
        });

        const enaireTN = L.tileLayer('https://www.ign.es/wmts/ign-base?service=WMTS&request=GetTile&version=1.0.0&Format=image/jpeg&layer=IGNBase-gris&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}', {
            attribution: '&copy; IGN TN', maxZoom: 19
        });

        const enaireDronesUrl = 'https://servais.enaire.es/insignia/rest/services/NSF_SRV/SRV_UAS_ZG_V1/MapServer/export';

        const enaireDrones = L.layerGroup();
        enaireDrones._enaireOverlay = null;
        enaireDrones._enaireUpdating = false;

        enaireDrones.onAdd = function(map) {
            L.LayerGroup.prototype.onAdd.call(this, map);
            this._map = map;
            this._updateEnaire();
            map.on('moveend zoomend resize', this._updateEnaire, this);
        };

        enaireDrones.onRemove = function(map) {
            map.off('moveend zoomend resize', this._updateEnaire, this);
            if (this._enaireOverlay) {
                map.removeLayer(this._enaireOverlay);
                this._enaireOverlay = null;
            }
            L.LayerGroup.prototype.onRemove.call(this, map);
        };

        enaireDrones._updateEnaire = function() {
            if (!this._map || this._enaireUpdating) return;
            this._enaireUpdating = true;
            const map = this._map;
            const b = map.getBounds();
            const s = map.getSize();
            const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
            const url = `${enaireDronesUrl}?dpi=96&transparent=true&format=png32&layers=show:0,2,3&bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${s.x},${s.y}&f=image&${Date.now()}`;
            if (this._enaireOverlay) map.removeLayer(this._enaireOverlay);
            this._enaireOverlay = L.imageOverlay(url, b, { opacity: 0.75, crossOrigin: true });
            this._enaireOverlay.addTo(map);
            this._enaireOverlay.on('load', () => { this._enaireUpdating = false; });
            setTimeout(() => { this._enaireUpdating = false; }, 3000);
        };

        const baseMaps = {
            'OpenStreetMap': osmLayer,
            'IGN Base': enaireBase,
            'IGN TN': enaireTN
        };

        const overlayMaps = {
            'ENAIRE Drones (Zonas UAS)': enaireDrones
        };

        osmLayer.addTo(Dronigest.map);
        L.control.layers(baseMaps, overlayMaps, { collapsed: true }).addTo(Dronigest.map);

        L.control.scale({ imperial: false }).addTo(Dronigest.map);

        const userIcon = L.divIcon({
            className: 'user-marker',
            html: '<div style="width:20px;height:20px;background:#0288D1;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        L.marker([loc.lat, loc.lng], { icon: userIcon }).addTo(Dronigest.map)
            .bindPopup('<b>Tu ubicación</b>');

        this.cargarMarcadoresVuelos();

        setTimeout(() => Dronigest.map.invalidateSize(), 200);
    },

    geolocalizar() {
        if (!Dronigest.userLocation) {
            Dronigest.Toast.show('Obteniendo ubicación...', 'info');
            return;
        }
        if (Dronigest.map) {
            Dronigest.map.setView([Dronigest.userLocation.lat, Dronigest.userLocation.lng], 14);
        }
    },

    cargarMarcadoresVuelos() {
        if (!Dronigest.map) return;
        Dronigest.markers.forEach(m => Dronigest.map.removeLayer(m));
        Dronigest.markers = [];
        const vuelos = Dronigest.DB.get('vuelos');
        vuelos.filter(v => v.lat && v.lng).forEach(v => {
            const icon = L.divIcon({
                className: 'flight-marker',
                html: `<div style="width:28px;height:28px;background:${v.estado === 'completado' ? '#43A047' : v.estado === 'en_curso' ? '#FF6F00' : '#0288D1'};border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,0.3);"><i class="fas fa-helicopter" style="font-size:12px;"></i></div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });
            const marker = L.marker([v.lat, v.lng], { icon })
                .addTo(Dronigest.map)
                .bindPopup(`<b>${v.nombre || 'Vuelo'}</b><br>${v.fecha || ''}<br><span class="badge badge-${v.estado === 'completado' ? 'success' : v.estado === 'en_curso' ? 'warning' : 'info'}">${v.estado || 'programado'}</span>`);
            Dronigest.markers.push(marker);
        });
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
            const iconMap = { vuelo: 'helicopter', piloto: 'user', drone: 'helicoper', trabajo: 'briefcase', checklist: 'clipboard-check', inspeccion: 'search', agricola: 'seedling' };
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
    nuevo() {
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
        Dronigest.Mapa.cargarMarcadoresVuelos();
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
            Dronigest.Mapa.cargarMarcadoresVuelos();
            Dronigest.Dashboard.actualizar();
        }
    },

    cambiarEstado(id, estado) {
        Dronigest.DB.update('vuelos', id, { estado });
        Dronigest.Toast.show(`Vuelo marcado como ${estado}`, 'success');
        Dronigest.DB.logActividad('vuelo', `Vuelo ${estado}`, '');
        this.listar();
        Dronigest.Mapa.cargarMarcadoresVuelos();
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
                            <td><strong>${v.nombre || '-'}</strong></td>
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
                        <option value="A1">A1 - Vuelo en area de personas</option>
                        <option value="A2">A2 - Vuelo cercano a personas</option>
                        <option value="A3">A3 - Vuelo lejos de personas</option>
                        <option value="A3cat">A3 - Categoría específica</option>
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
                    <option value=" coordinador">Coordinador</option>
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
                            <td><span class="row-icon" style="background:#E3F2FD;color:#0288D1;"><i class="fas fa-user-tie"></i></span> <strong>${p.nombre}</strong></td>
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
                            <td><span class="row-icon" style="background:#E8F5E9;color:#2E7D32;"><i class="fas fa-user-friends"></i></span> <strong>${a.nombre}</strong></td>
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
                            <td><strong>${t.nombre}</strong><br><small style="color:var(--text-light)">${t.descripcion || ''}</small></td>
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
                            <td><strong>${c.nombre}</strong></td>
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
                        <option value="A1">A1</option>
                        <option value="A2">A2</option>
                        <option value="A3">A3</option>
                        <option value="Open">Open</option>
                        <option value="Specific">Specific</option>
                        <option value="Certified">Certified</option>
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
                            <td><span class="row-icon" style="background:#E1F5FE;color:#01579B;"><i class="fas fa-helicopter"></i></span> <strong>${d.nombre}</strong></td>
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
                            <td><span class="row-icon" style="background:#FFF3E0;color:#E65100;"><i class="fas fa-th-large"></i></span> <strong>${m.nombre}</strong></td>
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
                            <td><span class="row-icon" style="background:#F3E5F5;color:#7B1FA2;"><i class="fas fa-puzzle-piece"></i></span> <strong>${a.nombre}</strong></td>
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
                            <td><strong>${t.nombre}</strong><br><small style="color:var(--text-light)">${Dronigest.Utils.formatDate(t.fechaInicio)}</small></td>
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
                            <tr>
                                <td><strong>${i.nombre}</strong><br><small class="badge badge-${tipoBadge[tipoKey] || 'info'}">${i.subtipo || tipoLabels[tipoKey]}</small></td>
                                <td data-label="Fecha">${Dronigest.Utils.formatDate(i.fecha)}</td>
                                <td data-label="Cliente">${i.cliente || '-'}</td>
                                <td data-label="Piloto">${i.piloto || '-'}</td>
                                <td data-label="Elementos">${i.numElementos || 0}</td>
                                <td data-label="Anomalías">${i.numAnomalias > 0 ? `<span style="color:var(--danger);font-weight:700;">${i.numAnomalias}</span>` : '0'}</td>
                                <td class="actions">
                                    <button class="btn-action edit" onclick="Dronigest.Inspecciones.editar('${i.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                    <button class="btn-action delete" onclick="Dronigest.Inspecciones.eliminar('${i.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
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
                        <tr>
                            <td><strong>${t.nombre}</strong></td>
                            <td data-label="Tipo"><span class="badge badge-success">${tipoLabels[t.tipo] || t.tipo}</span></td>
                            <td data-label="Cultivo">${t.cultivo || '-'}</td>
                            <td data-label="Superficie">${t.superficie ? t.superficie + ' ha' : '-'}</td>
                            <td data-label="Producto">${t.producto || '-'}</td>
                            <td data-label="Fecha">${Dronigest.Utils.formatDate(t.fecha)}</td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.Agricola.editar('${t.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Agricola.eliminar('${t.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
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

    nuevo() {
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
                        <tr>
                            <td><strong>${r.nombre}</strong></td>
                            <td data-label="Tipo"><span class="badge badge-info">${tipoLabels[r.tipo] || r.tipo}</span></td>
                            <td data-label="Fecha">${Dronigest.Utils.formatDate(r.fecha)} ${r.hora || ''}</td>
                            <td data-label="Especie"><span class="badge badge-success">${r.especie || '-'}</span></td>
                            <td data-label="Nº"><strong>${r.individuos || 0}</strong></td>
                            <td data-label="Zona">${r.zona || '-'}</td>
                            <td data-label="Amenaza">${r.amenaza && r.amenaza !== 'ninguna' ? `<span class="badge badge-danger">${amenazaLabels[r.amenaza] || r.amenaza}</span>` : '-'}</td>
                            <td class="actions">
                                <button class="btn-action edit" onclick="Dronigest.Cinegetico.editar('${r.id}')" title="Editar"><i class="fas fa-edit"></i></button>
                                <button class="btn-action delete" onclick="Dronigest.Cinegetico.eliminar('${r.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
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
                            <td><strong>${z.nombre}</strong></td>
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
                            <td><strong>${e.nombre}</strong></td>
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
        if (btn) btn.onclick = () => { Dronigest.Navigation.goTo('meteorologia'); this.obtenerMeteorologia(); };
        const btnGeo = document.getElementById('btnGeolocate');
        if (btnGeo) btnGeo.onclick = () => Dronigest.Mapa.geolocalizar();

        setTimeout(() => this.obtenerMeteorologia(), 2000);
    },

    async obtenerMeteorologia() {
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
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max&timezone=auto&forecast_days=7`;
        const res = await fetch(url);
        const data = await res.json();
        return this.formatOpenMeteo(data);
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
                <div class="location"><i class="fas fa-map-marker-alt"></i> Ubicación actual</div>
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
});
