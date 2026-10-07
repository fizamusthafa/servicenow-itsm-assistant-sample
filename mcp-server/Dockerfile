FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

USER node
ENV PORT=3001
EXPOSE 3001
CMD ["node", "src/server.js"]
