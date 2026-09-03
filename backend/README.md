# Backend de Dronigest

Este es el backend REST que permite sincronizar los datos de Dronigest
entre todos tus dispositivos (móvil Android, Linux, Windows).

Almacena los datos en una base de datos SQLite y los expone a través de
una API REST. La aplicación Dronigest (web/PWA) se conecta a esta API
para guardar y leer los datos, de modo que cualquier dispositivo vea los
mismos datos actualizados.

## ¿Por qué necesito esto?

La app de Dronigest guardaba los datos en el `localStorage` de cada
dispositivo: lo que guardabas en el móvil solo estaba en el móvil, y lo
que guardabas en el PC solo estaba en el PC. Este backend centraliza los
datos en la nube para que se compartan entre dispositivos.

## Endpoints

| Método | Ruta                          | Descripción                                          |
|--------|-------------------------------|------------------------------------------------------|
| GET    | `/api/health`                 | Estado del servidor y colecciones                    |
| GET    | `/api/data`                   | Todas las colecciones (sincronización completa)      |
| GET    | `/api/data/:coleccion`        | Todos los datos de una colección                     |
| POST   | `/api/data/:coleccion`        | Crear un nuevo elemento                              |
| PUT    | `/api/data/:coleccion`        | Reemplazar una colección completa                    |
| PUT    | `/api/data/:coleccion/:id`    | Actualizar un elemento                               |
| DELETE | `/api/data/:coleccion/:id`    | Eliminar un elemento                                 |

Colecciones gestionadas: `vuelos, pilotos, auxiliares, tiposVuelo,
categorias, drones, modelos, accesorios, trabajos, inspecciones,
agricola, checklists, cinegetico, zonasCineg, especiesCineg, actividad,
categoriasAesa`.

## Despliegue

### Opción A: Railway (recomendada)

1. Crea una cuenta en https://railway.app
2. Crea un proyecto nuevo y elige "Deploy from GitHub repo"
   (apunta al repo de Dronigest, subcarpeta `backend/`).
3. Railway detecta el `Procfile` y ejecuta `node server.js`.
4. **IMPORTANTE - persistir los datos:** añade un Volumen a la app
   montado en la ruta `/app/data` (Railway guarda ahí la base de datos).
5. Obten la URL del servicio, p. ej. `https://dronigest-backend.up.railway.app`.

### Opción B: Render

1. Crea una cuenta en https://render.com
2. "New" → "Web Service" → conecta el repo, root directory `./backend`.
3. Build command: `npm install`. Start command: `npm start`.
4. Para persistir datos en Render necesitas un disco persistente
   montado y configurar la variable `SQLITE_PATH` apuntando al disco.

### Opción C: Vercel

Vercel es serverless y no mantiene un sistema de archivos persistente,
por lo que **no es ideal para SQLite**. Si quieres usar Vercel, habría
que cambiar la base de datos a algo como Vercel Postgres/Neon. Se
recomienda Railway o Render para simplicidad.

## Variables de entorno

| Variable        | Obligatoria | Descripción                                                                 |
|-----------------|-------------|-----------------------------------------------------------------------------|
| `PORT`          | No          | Puerto del servidor (Railway/Render lo asignan automáticamente).            |
| `SQLITE_PATH`   | No          | Ruta del archivo de base de datos. Por defecto `./dronigest.db`. Usa un volumen para persistir. |
| `API_TOKEN`     | No          | Si se define, la API requiere este token en la cabecera `x-api-token` o `Authorization: Bearer <token>`. Si no se define, la API es pública. |

## Probar en local

```bash
cd backend
npm install
npm start        # arranca en http://localhost:3001
curl http://localhost:3001/api/health
```

## Conectar la app Dronigest

En la app (web/móvil/PC), ve a **Sincronización** (menú lateral) e
introduce:

- **URL del backend**: la URL pública del servicio (p. ej.
  `https://dronigest-backend.up.railway.app`)
- **Token de acceso**: el token si definiste `API_TOKEN`, o déjalo vacío.

Haz clic en **"Guardar y conectar"**. Todos los dispositivos deben usar
la misma URL y token para compartir los mismos datos.

> Nota: la primera vez, la app migra los datos locales a la nube. Si ya
> tienes datos en un dispositivo, conéctalo primero para subirlos.
