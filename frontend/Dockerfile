FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Run Vite from inside its package so import('../dist/node/cli.js') resolves correctly
CMD ["sh", "-c", "cd node_modules/vite && node bin/vite.js /app -c /app/vite.config.js --host"]
