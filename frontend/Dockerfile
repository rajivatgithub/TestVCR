FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# We use a simple dev server for testing
CMD ["npm", "run", "dev", "--", "--host"]
