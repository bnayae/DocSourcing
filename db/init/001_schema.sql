CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS documents_events (
  id                  UUID        PRIMARY KEY,
  aggregate_id        UUID        NOT NULL,
  type                TEXT        NOT NULL,
  payload             JSONB       NOT NULL,
  created_at          BIGINT      NOT NULL,
  sequence_number     INT         NOT NULL,
  server_received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS documents_events_seq_uniq
  ON documents_events (aggregate_id, sequence_number);

CREATE INDEX IF NOT EXISTS documents_events_agg_created
  ON documents_events (aggregate_id, created_at);

CREATE TABLE IF NOT EXISTS document_aggregate (
  id             UUID        PRIMARY KEY,
  title          TEXT        NOT NULL DEFAULT '',
  body           TEXT        NOT NULL DEFAULT '',
  owner_id       UUID,
  is_archived    BOOLEAN     NOT NULL DEFAULT false,
  last_seq       INT         NOT NULL DEFAULT 0,
  last_event_at  BIGINT      NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_snapshots (
  id             BIGSERIAL   PRIMARY KEY,
  aggregate_id   UUID        NOT NULL REFERENCES document_aggregate(id) ON DELETE CASCADE,
  state          JSONB       NOT NULL,
  last_seq       INT         NOT NULL,
  last_event_at  BIGINT      NOT NULL,
  taken_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_snapshots_agg_last_seq
  ON document_snapshots (aggregate_id, last_seq);

CREATE TABLE IF NOT EXISTS event_investigation (
  id              UUID        PRIMARY KEY,
  aggregate_id    UUID,
  original_event  JSONB       NOT NULL,
  error_class     TEXT        NOT NULL,
  error_code      TEXT        NOT NULL,
  description     TEXT,
  parked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolution      TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key    TEXT  PRIMARY KEY,
  value  JSONB NOT NULL
);

INSERT INTO app_settings (key, value)
VALUES ('snapshot_interval_seconds', '60'::jsonb)
ON CONFLICT (key) DO NOTHING;
