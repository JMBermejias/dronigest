FROM node:18-slim

WORKDIR /app

COPY package.json ./
RUN npm install --only=production

COPY server.js ./
COPY Procfile ./

# Volumen para persistir la base de datos
VOLUME ["/app/data"]
ENV SQLITE_PATH=/app/data/dronigest.db

EXPOSE 3001

CMD ["node", "server.js"]
