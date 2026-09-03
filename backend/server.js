// dronigest-backend/server.js
/**
 * Backend REST de Dronigest
 * Almacena los datos en SQLite y los expone a traves de una API REST
 * para sincronizar entre dispositivos (movil, Linux, Windows).
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuracion de la base de datos
const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, 'dronigest.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Claves de datos que gestiona la aplicacion
const COLLECTIONS = [
  'vuelos', 'pilotos', 'auxiliares', 'tiposVuelo', 'categorias',
  'drones', 'modelos', 'accesorios', 'trabajos', 'inspecciones',
  'agricola', 'checklists', 'cinegetico', 'zonasCineg', 'especiesCineg',
  'actividad', 'categoriasAesa'
];

// Token de autenticacion (opcional). Si no se define, la API es publica.
// Recuerda definir esta variable de entorno en el despliegue.
const API_TOKEN = process.env.API_TOKEN || null;

// Crear la tabla de datos si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS dronigest_data (
    collection TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
`);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Autenticacion basica por token
function auth(req, res, next) {
  if (!API_TOKEN) return next(); // API publica si no hay token
  const token = req.headers['x-api-token'] || req.headers['authorization'];
  if (token === API_TOKEN || token === `Bearer ${API_TOKEN}`) {
    return next();
  }
  return res.status(401).json({ error: 'No autorizado' });
}

// === Operaciones de persistencia ===

function getCollection(collection) {
  const row = db.prepare('SELECT data FROM dronigest_data WHERE collection = ?')
    .get(collection);
  return row ? JSON.parse(row.data) : [];
}

function setCollection(collection, data) {
  db.prepare(`
    INSERT INTO dronigest_data (collection, data) VALUES (?, ?)
    ON CONFLICT(collection) DO UPDATE SET data = excluded.data
  `).run(collection, JSON.stringify(data));
}

function generateId() {
  const base = Date.now().toString(36);
  const suffix = Math.random().toString(36).substr(2, 5);
  return base + suffix;
}

// === Endpoints ===

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', collections: COLLECTIONS });
});

// Obtener todos los datos de una coleccion
app.get('/api/data/:collection', auth, (req, res) => {
  const { collection } = req.params;
  if (!COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: `Coleccion invalida: ${collection}` });
  }
  res.json(getCollection(collection));
});

// Obtener todos los datos de todas las colecciones (para sincronizacion completa)
app.get('/api/data', auth, (req, res) => {
  const result = {};
  COLLECTIONS.forEach(c => { result[c] = getCollection(c); });
  res.json(result);
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
  setCollection(collection, data);
  res.json({ ok: true, count: data.length });
});

// Crear un nuevo elemento en una coleccion
app.post('/api/data/:collection', auth, (req, res) => {
  const { collection } = req.params;
  if (!COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: `Coleccion invalida: ${collection}` });
  }
  const data = getCollection(collection);
  const item = { ...req.body };
  item.id = item.id || generateId();
  item.creado = item.creado || new Date().toISOString();
  data.push(item);
  setCollection(collection, data);
  res.status(201).json(item);
});

// Actualizar un elemento de una coleccion
app.put('/api/data/:collection/:id', auth, (req, res) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: `Coleccion invalida: ${collection}` });
  }
  const data = getCollection(collection);
  const idx = data.findIndex(i => i.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Elemento no encontrado' });
  }
  data[idx] = { ...data[idx], ...req.body, modificado: new Date().toISOString() };
  setCollection(collection, data);
  res.json(data[idx]);
});

// Eliminar un elemento de una coleccion
app.delete('/api/data/:collection/:id', auth, (req, res) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) {
    return res.status(400).json({ error: `Coleccion invalida: ${collection}` });
  }
  const filtered = getCollection(collection).filter(i => i.id !== id);
  setCollection(collection, filtered);
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
  console.log(`Auth: ${API_TOKEN ? 'token habilitado' : 'publica (sin token)'}`);
});
