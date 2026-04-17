FROM node:22-slim

WORKDIR /app

COPY . .

RUN npm ci \
  && npm run build --workspace @frolf-tour/shared \
  && npm run build --workspace @frolf-tour/api \
  && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app/apps/api

CMD ["node", "dist/index.js"]
