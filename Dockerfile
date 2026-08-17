FROM node:16-slim

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

ENV PORT=80

EXPOSE 80

CMD ["node", "index.js"]
