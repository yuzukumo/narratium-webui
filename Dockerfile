FROM node:20.12-alpine AS builder

ARG PNPM_VERSION=10.32.1

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:20.12-alpine AS runner

ARG PNPM_VERSION=10.32.1

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

COPY --from=builder /app/out ./out

RUN pnpm add serve

EXPOSE 5000

CMD ["npx", "serve", "-s", "out", "-l", "5000"]
