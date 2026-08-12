# ─── Stage 1: build + prerender ──────────────────────────────────────────────
#
# Installs all dependencies (including devDependencies), builds every TypeScript
# package, then runs the prerender script to write dist/document.html.
# Git is available in this stage because prerender reads the journey via
# `git show`. It is absent from the final image.
#
FROM node:20-slim AS builder

WORKDIR /app

# Copy manifests first so the npm ci layer is cached independently of source.
COPY package.json package-lock.json ./
COPY packages/journey-model/package.json packages/journey-model/
COPY packages/port/package.json           packages/port/
COPY packages/store/package.json          packages/store/
COPY packages/adapter-sketch/package.json packages/adapter-sketch/
COPY packages/render/package.json         packages/render/
COPY packages/gate/package.json           packages/gate/
COPY packages/pipeline/package.json       packages/pipeline/
COPY packages/studio/package.json         packages/studio/

# git is needed by the store resolver (reads via `git show`).
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

# Install all dependencies (devDependencies included for tsc, vitest, etc.).
RUN npm ci

# Copy source after install so a source-only change skips the npm ci layer.
# Both are needed: tsconfig.base.json carries the shared compiler options, and
# tsconfig.json carries the project references `tsc -b` walks. Omitting the second
# fails the build with "Cannot read file '/app/tsconfig.json'".
COPY tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY examples/ examples/

# Build every package (tsc -b then postbuild scripts).
RUN npm run build

# Commit the working tree so `git show HEAD:...` works in the prerender step.
# This is the only git operation needed — the store reads the journey document
# out of the git object store, which is why git must exist in the builder.
RUN git config --global user.email "build@design-space.invalid" \
 && git config --global user.name  "Build"                      \
 && git init -q                                                  \
 && git add -A                                                   \
 && git commit -qm "build snapshot"

# Prerender the broadband-switch journey at HEAD → packages/studio/dist/document.html.
RUN node packages/studio/scripts/prerender-build.mjs /app


# ─── Stage 2: runtime ────────────────────────────────────────────────────────
#
# Slim image that carries only compiled JS artefacts and production
# node_modules. No git, no devDependencies, no source.
#
FROM node:20-slim AS runtime

WORKDIR /app

# Non-root user — required by the story's constraints and good practice on Cloud Run.
RUN addgroup --system studio && adduser --system --ingroup studio studio

# Copy manifests for `npm ci --omit=dev`.
COPY --from=builder /app/package.json         ./
COPY --from=builder /app/package-lock.json    ./
COPY --from=builder /app/packages/journey-model/package.json  packages/journey-model/
COPY --from=builder /app/packages/port/package.json            packages/port/
COPY --from=builder /app/packages/store/package.json           packages/store/
COPY --from=builder /app/packages/adapter-sketch/package.json  packages/adapter-sketch/
COPY --from=builder /app/packages/render/package.json          packages/render/
COPY --from=builder /app/packages/gate/package.json            packages/gate/
COPY --from=builder /app/packages/pipeline/package.json        packages/pipeline/
COPY --from=builder /app/packages/studio/package.json          packages/studio/

# Production dependencies only — no devDependencies, no git.
RUN npm ci --omit=dev

# Compiled artefacts from the builder stage.
COPY --from=builder /app/packages/journey-model/dist  packages/journey-model/dist
COPY --from=builder /app/packages/port/dist           packages/port/dist
COPY --from=builder /app/packages/store/dist          packages/store/dist
COPY --from=builder /app/packages/adapter-sketch/dist packages/adapter-sketch/dist
COPY --from=builder /app/packages/render/dist         packages/render/dist
COPY --from=builder /app/packages/gate/dist           packages/gate/dist
COPY --from=builder /app/packages/pipeline/dist       packages/pipeline/dist
# studio/dist includes both serve.js and the prerendered document.html.
COPY --from=builder /app/packages/studio/dist         packages/studio/dist

USER studio

# Cloud Run injects PORT; the server reads it and defaults to 8080.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "packages/studio/dist/serve.js"]
