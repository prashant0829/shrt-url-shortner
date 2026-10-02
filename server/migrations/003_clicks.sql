CREATE TABLE clicks (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Producer-generated id; the unique index makes the worker idempotent (at-least-once delivery).
  event_id      uuid        NOT NULL,
  link_id       bigint      NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  clicked_at    timestamptz NOT NULL,
  -- Keyed hash of ip + user agent; the raw IP is never stored.
  visitor_hash  text        NOT NULL,
  country       text,
  referrer_host text,
  browser       text,
  os            text,
  device_type   text        NOT NULL DEFAULT 'unknown',
  is_bot        boolean     NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX clicks_event_id_key ON clicks (event_id);

-- Serves every analytics query: one link, one time range.
CREATE INDEX clicks_link_time_idx ON clicks (link_id, clicked_at);
