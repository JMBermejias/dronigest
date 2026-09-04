// dronigest-backend/server.js
/**
 * Backend REST de Dronigest
 * Sistema de usuarios con registro/login (usuario + contrasena).
 * Cada usuario tiene sus propios datos aislados, sincronizables
 * entre dispositivos (movil, Linux, Windows) con la misma cuenta.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuracion de la base de datos
const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, 'dronigest.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Claves de datos que gestiona la aplicacion
const COLLECTIONS = [
  'vuelos', 'pilotos', 'auxiliares', 'tiposVuelo', 'categorias',
  'drones', 'modelos', 'accesorios', 'trabajos', 'inspecciones',
  'agricola', 'checklists', 'cinegetico', 'zonasCineg', 'especiesCineg',
  'actividad', 'categoriasAesa'
];

// Crear tablas
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dronigest_data (
    username TEXT NOT NULL,
    collection TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (username, collection)
  );
`);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// === Utilidades ===

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Autenticacion de sesion. Requiere header Authorization: Bearer <token>
function auth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-auth-token'] || '');
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  const row = db.prepare('SELECT username FROM sessions WHERE token = ?').get(token);
  if (!row) {
    return res.status(401).json({ error: 'Sesion no valida o caducada' });
  }
  req.user = row.username;
  req.sessionToken = token;
  next();
}

// === Operaciones de persistencia (por usuario) ===

function getCollection(username, collection) {
  const row = db.prepare('SELECT data FROM dronigest_data WHERE username = ? AND collection = ?')
    .get(username, collection);
  return row ? JSON.parse(row.data) : [];
}

function setCollection(username, collection, data) {
  db.prepare(`
    INSERT INTO dronigest_data (username, collection, data) VALUES (?, ?, ?)
    ON CONFLICT(username, collection) DO UPDATE SET data = excluded.data
  `).run(username, collection, JSON.stringify(data));
}

// === Endpoints de autenticacion ===

// Health check (publico)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', collections: COLLECTIONS, auth: 'users' });
});

// Registrar nuevo usuario
app.post('/api/auth/register', (req, res) => {
  const username = String((req.body.username || '').trim().toLowerCase());
  const password = String(req.body.password || '');
  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'El usuario debe tener 3-30 caracteres (letras, numeros, _ . -)' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contrasena debe tener al menos 6 caracteres' });
  }
  const exists = db.prepare('SELECT username FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(409).json({ error: 'Ese usuario ya existe' });
  }
  const salt = newSalt();
  const password_hash = hashPassword(password, salt);
  db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, salt + ':' + password_hash, new Date().toISOString());
  const token = newSessionToken();
  db.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)')
    .run(token, username, new Date().toISOString());
  res.status(201).json({ ok: true, username, token });
});

// Iniciar sesion
app.post('/api/auth/login', (req, res) => {
  const username = String((req.body.username || '').trim().toLowerCase());
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get(username);
  if (!row) {
    return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
  }
  const [salt, hash] = row.password_hash.split(':');
  const attempt = hashPassword(password, salt);
  if (attempt !== hash) {
    return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
  }
  const token = newSessionToken();
  db.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)')
    .run(token, username, new Date().toISOString());
  res.json({ ok: true, username, token });
});

// Cerrar sesion
app.post('/api/auth/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.json({ ok: true });
});

// Validar sesion actual
app.get('/api/auth/me', auth, (req, res) => {
  res.json({ ok: true, username: req.user });
});

// === Endpoints de datos (requieren sesion, aislados por usuario) ===

// Obtener todos los datos de todas las colecciones (sincronizacion completa)
app.get('/api/data', auth, (req, res) => {
  const result = {};
  COLLECTIONS.forEach(c => { result[c] = getCollection(req.user, c); });
  res.json(result);
});

// Obtener todos los datos de una coleccion
app.get('/api/data/:collection', auth, (req, res) => {
  const { collection } = req.params;
  if (!COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: `Coleccion invalida: ${collection}` });
  }
  res.json(getCollection(req.user, collection));
});

// Reemplazar una coleccion completa (sincronizacion)
app.put('/api/data/:collection', auth, (req, res) => {
  const { collection } = req.params;
  if (!COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: `Coleccion invalida: ${collection}` });
  }
  const data = req.body;
  if (!Array.isArray(data)) {
    return res.status(400).json({ error: 'El cuerpo debe ser un array' });
  }
  setCollection(req.user, collection, data);
  res.json({ ok: true, count: data.length });
});

// Crear un nuevo elemento en una coleccion
app.post('/api/data/:collection', auth, (req, res) => {
  const { collection } = req.params;
  if (!COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: `Coleccion invalida: ${collection}` });
  }
  const data = getCollection(req.user, collection);
  const item = { ...req.body };
  item.id = item.id || generateId();
  item.creado = item.creado || new Date().toISOString();
  data.push(item);
  setCollection(req.user, collection, data);
  res.status(201).json(item);
});

// Actualizar un elemento de una coleccion
app.put('/api/data/:collection/:id', auth, (req, res) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: `Coleccion invalida: ${collection}` });
  }
  const data = getCollection(req.user, collection);
  const idx = data.findIndex(i => i.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Elemento no encontrado' });
  }
  data[idx] = { ...data[idx], ...req.body, modificado: new Date().toISOString() };
  setCollection(req.user, collection, data);
  res.json(data[idx]);
});

// Eliminar un elemento de una coleccion
app.delete('/api/data/:collection/:id', auth, (req, res) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: `Coleccion invalida: ${collection}` });
  }
  const filtered = getCollection(req.user, collection).filter(i => i.id !== id);
  setCollection(req.user, collection, filtered);
  res.json({ ok: true });
});

// Middleware de errores
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`Dronigest backend corriendo en puerto ${PORT}`);
  console.log(`Base de datos: ${DB_PATH}`);
  console.log(`Auth: usuarios (registro/login)`);
});
