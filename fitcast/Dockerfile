# FitCast API (NestJS + Prisma). Built from the repository root; the frontend and the Python service have their own
# Dockerfiles. Migrations are applied on every start (prisma migrate deploy is idempotent).
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx prisma generate && npx nest build && test -f dist/main.js
ENV NODE_ENV=production PORT=3002
EXPOSE 3002
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
