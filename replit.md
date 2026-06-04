# Webjal Demo Studio

A website editor where agencies create and deliver client demo websites — build from templates, fill in client details, generate HTML, and download a ZIP.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (auto-provisioned)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite, Wouter routing, TanStack Query, shadcn/ui

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth for all routes)
- `lib/db/src/schema/templates.ts` — templates table
- `lib/db/src/schema/projects.ts` — projects table
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/webjal-studio/src/` — React frontend
- `artifacts/webjal-studio/src/pages/` — Dashboard, Templates, Projects pages
- `artifacts/webjal-studio/src/pages/projects/workspace.tsx` — per-project editor + ZIP download

## Architecture decisions

- Download ZIP uses `archiver` v8 with dynamic import in the projects route (`GET /api/projects/:id/download-zip`)
- File uploads use `multer` v2 (`POST /api/uploads/image`)
- Frontend uses Wouter with `base` set to `import.meta.env.BASE_URL` for proxy path compatibility
- All API routes are prefixed `/api` and served by the api-server artifact

## Product

Agencies use this studio to: pick or create an HTML template, fill in a client's business details (name, services, packages, colors, images), generate the website, preview it, and download a ZIP containing the final HTML file for delivery.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `archiver` and `multer` must be in `artifacts/api-server/package.json` dependencies (not devDependencies) — the ZIP download was broken without them
- Always run `pnpm --filter @workspace/db run push` after schema changes before restarting the API server

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
