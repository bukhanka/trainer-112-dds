# Production image: Next.js standalone server + Prisma migrations + pg_dump for backups.
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
# Flat node_modules so that the runtime stage can copy packages without pnpm symlinks.
RUN pnpm install --frozen-lockfile --config.node-linker=hoisted

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec prisma generate \
 && pnpm build \
 && for f in seed seed-demo demo-reset; do \
      pnpm exec esbuild prisma/$f.ts --bundle --platform=node --target=node22 \
        --outfile=dist/$f.js --external:@prisma/client --external:.prisma/client || exit 1; \
    done

FROM node:22-alpine AS runner
# pg_dump for backups; Prisma CLI (with its own dependencies) for migrations at start.
RUN apk add --no-cache postgresql16-client tzdata su-exec \
 && npm install -g prisma@6.19.3 \
 && npm cache clean --force
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 BACKUP_DIR=/backups MATERIALS_DIR=/materials TZ=Europe/Moscow
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/data ./data
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
# Files of the demo materials (prisma/seed-materials.ts): a guide, a screen and the documentation of this repository.
COPY --from=build /app/docs/dds.md /app/docs/documentation.pdf ./docs/
COPY --from=build /app/docs/img/02-dds-card.png ./docs/img/
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY docker-entrypoint.sh cluster.cjs ./
# The server runs as the unprivileged «node» user (see docker-entrypoint.sh); it writes only backups, the files of the
# library of materials and the Next.js cache.
RUN mkdir -p /backups /materials /app/.next/cache && chown -R node:node /backups /materials /app/.next/cache
VOLUME ["/backups", "/materials"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
