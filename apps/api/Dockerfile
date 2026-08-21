# syntax=docker/dockerfile:1

# Build reproduzível de apps/api dentro do monorepo pnpm+Turborepo (Fase 9,
# item 11). `pnpm deploy` (não `pnpm install` + cópia manual de node_modules)
# é o mecanismo oficial do pnpm para produzir, a partir de um workspace, uma
# pasta autocontida com só as dependências de PRODUÇÃO de um pacote — evita
# depender dos symlinks do pnpm store entre estágios do Docker, que não
# sobrevivem a um COPY --from de forma confiável.

FROM node:24-slim AS base
# node:*-slim (Debian) não vem com OpenSSL — o engine do Prisma precisa dele
# pra detectar a versão certa de libssl; sem isso ele funciona "no chute"
# (defaulting to openssl-1.1.x), o que já apareceu como warning real ao
# construir esta imagem pela primeira vez.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# Só os manifests primeiro (cache de camada: só reinstala se package.json/
# lockfile mudarem, não a cada mudança de código-fonte). O schema do Prisma
# também precisa estar presente aqui porque `pnpm install` roda o hook
# postinstall (`prisma generate`) da Fase 1.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY apps/api apps/api
COPY packages packages
RUN pnpm --filter @arenahub/api build

FROM build AS deploy
# --prod: exclui devDependencies do resultado (nunca precisamos de
# ts-node/jest/eslint em produção). --legacy: a partir do pnpm v10, "deploy"
# por padrão só funciona com "inject-workspace-packages" habilitado no
# workspace; --legacy volta ao comportamento anterior (empacotar as
# dependências reais, não symlinks) sem precisar mudar a config do
# workspace só por causa do Dockerfile — achado real ao construir esta
# imagem pela primeira vez. O destino fica fora de /repo para não ser
# sombreado por nenhuma camada anterior.
RUN pnpm --filter @arenahub/api deploy --prod --legacy /deploy

# `pnpm deploy --legacy` reexecuta o postinstall (prisma generate) dentro do
# seu próprio diretório, mas o código gerado (.prisma/client — o pacote de
# verdade com os models/enums; @prisma/client em si é só um molde fino que
# reexporta dali) não sobrevive de forma utilizável nesse processo: achado
# real ao rodar a imagem pela primeira vez, o processo subia mas todo enum
# do Prisma (ArenaRole, Sport, BookingType...) vinha `undefined`. Uma
# tentativa inicial de localizar o diretório certo com `find` por padrão de
# nome também falhou silenciosamente — o pnpm mantém MAIS de uma cópia de
# @prisma/client no store (peer deps diferentes resolvem pra instâncias
# isoladas diferentes), e `find` achava uma cópia-molde não gerada. A forma
# confiável é deixar o próprio `require.resolve()` do Node encontrar
# exatamente o arquivo que o require() em tempo de execução usaria, tanto
# na origem (client já gerado no estágio `build`, o mesmo artefato que
# passou pelos 126 testes unitários e 132 e2e da Fase 8) quanto no destino
# (dentro de /deploy) — nunca um terceiro `generate`.
RUN set -eu; \
    resolve_dot_prisma_dir() { \
      node -e " \
        const path = require('path'); \
        const entry = require.resolve('@prisma/client', { paths: ['$1'] }); \
        const nodeModulesDir = path.resolve(path.dirname(entry), '..', '..'); \
        console.log(path.join(nodeModulesDir, '.prisma')); \
      "; \
    }; \
    generated_dot_prisma=$(resolve_dot_prisma_dir /repo/apps/api); \
    target_dot_prisma=$(resolve_dot_prisma_dir /deploy); \
    rm -rf "$target_dot_prisma"; \
    cp -r "$generated_dot_prisma" "$target_dot_prisma"

FROM node:24-slim AS runtime
# Mesmo OpenSSL do estágio `base` onde o client foi gerado (não só do
# estágio de build) — achado real: sem isso, o engine do Prisma foi
# compilado contra "debian-openssl-3.0.x" (a libssl que ESTE Dockerfile
# instala) mas o runtime, sem a mesma instalação, tentava carregar um
# binário para outra versão de libssl e falhava ao conectar.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app

# Usuário não-root (item 11) — a imagem node:*-slim já cria o usuário "node".
COPY --from=deploy --chown=node:node /deploy/node_modules ./node_modules
COPY --from=deploy --chown=node:node /deploy/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/prisma ./prisma

# Nenhum .env é copiado (item 11) — todas as variáveis vêm da plataforma em
# runtime, nunca embutidas na imagem. Ver apps/api/.dockerignore.
USER node
EXPOSE 3001

# dist/src/main.js, não dist/main.js — o tsconfig não declara rootDir
# explicitamente, e como prisma/seed.ts (fora de src/) também é compilado,
# o TypeScript infere a raiz como a pasta do projeto inteiro, não src/,
# então a estrutura de src/ é preservada dentro de dist/. Achado real ao
# rodar esta imagem pela primeira vez (o script start:prod tinha o mesmo
# engano — corrigido junto, ver apps/api/package.json).
CMD ["node", "dist/src/main.js"]
