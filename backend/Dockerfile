FROM node:18-slim

WORKDIR /app

COPY package.json ./
RUN npm install --only=production

COPY server.js ./
COPY Procfile ./

# La base de datos SQLite se guarda en la ruta configurada por SQLITE_PATH.
# En Railway, monta un Volumen en /app/data y define SQLITE_PATH=/app/data/dronigest.db.
ENV SQLITE_PATH=/app/data/dronigest.db

EXPOSE 3001

CMD ["node", "server.js"]
