# DocSourcing

Demo application for an **event sourcing course**. Teaches event-sourced, offline-capable document collaboration end-to-end.

## Stack

- **TypeScript**
- **Next.js 16** (App Router) — UI, API routes, server handlers
- **PostgreSQL** — append-only event log + trigger-materialized aggregates
- **Dexie (IndexedDB)** — client-side event log for offline-first writes
- **TanStack Query** — server-confirmed data fetching
- Event sourcing with **offline capabilities** (optimistic UI, background sync, OCC conflict handling)

## Architecture guide

**Always consult [.claude/skills/event-sourcing-postgres-vanilla/SKILL.md](.claude/skills/event-sourcing-postgres-vanilla/SKILL.md) before implementing or modifying event-sourcing behavior.** It is the authoritative reference for this project and covers:

- Mode selection (offline-first vs online-only — this project is **offline-first**)
- Domain event schema, discriminated unions, type guards
- PostgreSQL aggregation trigger and composite unique index on `(aggregate_id, sequence_number)`
- Dexie store, `SyncEngine` sequential-batch guarantee, exponential backoff
- Conflict taxonomy: `transient` / `occ` / `unrecoverable`; OCC policies (`rebase`, `reject-and-investigate`, `append-and-override`)
- Poison-pill detection and the investigation / dead-letter table
- Aggregate snapshots and snapshot-based cold-start bootstrap
- Time-travel queries

The `references/` directory alongside SKILL.md has deeper dives per topic — follow the links from SKILL.md rather than guessing.

## Course branches

Work is organized into numbered branches (e.g. `2_app-seed`) that represent successive stages of the course. Check the target branch to see the expected shape of the app at that stage.
