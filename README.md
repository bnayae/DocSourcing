# DocSourcing

Event-sourced document collaboration built on Next.js 16 + PostgreSQL. Offline-first: clients write events to IndexedDB (Dexie), a `SyncEngine` replicates them to the server in sequential batches; the server materializes aggregates via a PostgreSQL `AFTER INSERT` trigger.

## Quick start

```bash
cp .env.local.example .env.local
npm install
npm run db:up       # start Postgres (docker compose)
npm run db:migrate  # apply schema + triggers (idempotent)
npm run dev         # http://localhost:3000
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (next config) |
| `npm run db:up` | Start local Postgres |
| `npm run db:down` | Stop local Postgres (keeps volume) |
| `npm run db:reset` | Drop volume + recreate |
| `npm run db:migrate` | Apply SQL files under `db/init/` and `db/migrations/` |

## Architecture

See [`.claude/skills/event-sourcing-postgres-vanilla/`](./.claude/skills/event-sourcing-postgres-vanilla/) for the full architecture guide. Short version:

- **Append-only log:** `documents_events` is the single source of truth.
- **Materialized aggregate:** `document_aggregate` is updated by a PL/pgSQL trigger on every insert.
- **Snapshots:** `document_snapshots` throttled to one per `app_settings.snapshot_interval_seconds` (default 60s) for fast cold start.
- **Offline-first client:** Dexie holds `pending | synced | failed | parked` events. `useLiveQuery` drives reactive UI.
- **SyncEngine:** one batch at a time, FIFO by aggregate. Conflicts routed by `errorClass` — `transient` / `occ` / `unrecoverable`.
- **Per-event-type OCC policy:** `src/lib/events/policies.ts`.

## Domain events (v1)

- `DOCUMENT_CREATED { title, ownerId }`
- `DOCUMENT_RENAMED { title }`
- `TEXT_INSERTED   { position, text }`
- `TEXT_DELETED    { position, length }`
- `DOCUMENT_ARCHIVED { }`
