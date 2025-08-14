FROM node:20-alpine as builder

WORKDIR /app

COPY package*.json ./


RUN npm ci


COPY . .


RUN npx prisma generate


RUN npm run build


RUN npm prune --production


FROM node:20-alpine

WORKDIR /app


RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001


ENV NODE_ENV=production


COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./


RUN mkdir -p logs && chown -R nodejs:nodejs logs


USER nodejs


EXPOSE 8078


CMD ["npm", "run", "start"] 