-- Snapshot throttle helper: reads current snapshot_interval_seconds from app_settings.
CREATE OR REPLACE FUNCTION docsourcing_snapshot_interval_ms()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((value)::text::bigint, 60) * 1000
  FROM app_settings
  WHERE key = 'snapshot_interval_seconds'
$$;

-- Fold a single event into aggregate state (pure; no I/O).
-- Returns a jsonb state shaped like the client's DocumentState.
CREATE OR REPLACE FUNCTION docsourcing_fold_event(prev JSONB, ev_type TEXT, ev_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  state JSONB := COALESCE(prev, '{}'::jsonb);
  body  TEXT  := COALESCE(state->>'body', '');
  pos   INT;
  len   INT;
  ins   TEXT;
BEGIN
  CASE ev_type
    WHEN 'DOCUMENT_CREATED' THEN
      state := jsonb_set(state, '{title}',       to_jsonb(COALESCE(ev_payload->>'title', '')), true);
      state := jsonb_set(state, '{ownerId}',     COALESCE(ev_payload->'ownerId', 'null'::jsonb), true);
      state := jsonb_set(state, '{body}',        to_jsonb(''::text), true);
      state := jsonb_set(state, '{isArchived}',  to_jsonb(false), true);

    WHEN 'DOCUMENT_RENAMED' THEN
      state := jsonb_set(state, '{title}', to_jsonb(COALESCE(ev_payload->>'title', '')), true);

    WHEN 'TEXT_INSERTED' THEN
      pos := GREATEST(0, LEAST(length(body), COALESCE((ev_payload->>'position')::int, length(body))));
      ins := COALESCE(ev_payload->>'text', '');
      body := substr(body, 1, pos) || ins || substr(body, pos + 1);
      state := jsonb_set(state, '{body}', to_jsonb(body), true);

    WHEN 'TEXT_DELETED' THEN
      pos := GREATEST(0, LEAST(length(body), COALESCE((ev_payload->>'position')::int, 0)));
      len := GREATEST(0, LEAST(length(body) - pos, COALESCE((ev_payload->>'length')::int, 0)));
      body := substr(body, 1, pos) || substr(body, pos + len + 1);
      state := jsonb_set(state, '{body}', to_jsonb(body), true);

    WHEN 'DOCUMENT_ARCHIVED' THEN
      state := jsonb_set(state, '{isArchived}', to_jsonb(true), true);

    ELSE
      -- Unknown event type: leave state unchanged so we don't poison the aggregate.
      RETURN state;
  END CASE;

  RETURN state;
END;
$$;

-- AFTER INSERT trigger on documents_events: materialize aggregate + throttled snapshot.
CREATE OR REPLACE FUNCTION documents_events_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  existing        document_aggregate%ROWTYPE;
  prev_state      JSONB;
  next_state      JSONB;
  new_last_seq    INT;
  new_last_event  BIGINT;
  snapshot_ms     BIGINT;
  since_last_ms   BIGINT;
BEGIN
  SELECT * INTO existing FROM document_aggregate WHERE id = NEW.aggregate_id FOR UPDATE;

  IF NOT FOUND THEN
    prev_state := '{}'::jsonb;
    new_last_seq   := NEW.sequence_number;
    new_last_event := NEW.created_at;
  ELSE
    prev_state := jsonb_build_object(
      'title',      existing.title,
      'body',       existing.body,
      'ownerId',    existing.owner_id,
      'isArchived', existing.is_archived
    );
    new_last_seq   := GREATEST(existing.last_seq, NEW.sequence_number);
    new_last_event := GREATEST(existing.last_event_at, NEW.created_at);
  END IF;

  next_state := docsourcing_fold_event(prev_state, NEW.type, NEW.payload);

  -- Throttled snapshot: write the PRIOR state before mutating the aggregate, if enough time has passed.
  IF FOUND THEN
    snapshot_ms   := docsourcing_snapshot_interval_ms();
    since_last_ms := NEW.created_at - existing.last_event_at;
    IF since_last_ms >= snapshot_ms THEN
      INSERT INTO document_snapshots (aggregate_id, state, last_seq, last_event_at)
      VALUES (existing.id, prev_state, existing.last_seq, existing.last_event_at);
    END IF;
  END IF;

  INSERT INTO document_aggregate (id, title, body, owner_id, is_archived, last_seq, last_event_at, updated_at)
  VALUES (
    NEW.aggregate_id,
    COALESCE(next_state->>'title', ''),
    COALESCE(next_state->>'body',  ''),
    NULLIF(next_state->>'ownerId', '')::uuid,
    COALESCE((next_state->>'isArchived')::boolean, false),
    new_last_seq,
    new_last_event,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    title         = EXCLUDED.title,
    body          = EXCLUDED.body,
    owner_id      = EXCLUDED.owner_id,
    is_archived   = EXCLUDED.is_archived,
    last_seq      = EXCLUDED.last_seq,
    last_event_at = EXCLUDED.last_event_at,
    updated_at    = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_events_after_insert ON documents_events;
CREATE TRIGGER trg_documents_events_after_insert
  AFTER INSERT ON documents_events
  FOR EACH ROW
  EXECUTE FUNCTION documents_events_after_insert();
