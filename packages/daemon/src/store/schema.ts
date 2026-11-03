export const SCHEMA_VERSION = 1;

const appendOnly = (table: string) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, 'append-only'); END;`;

/** Esquema del ADR-004. */
export const SCHEMA_SQL = `
CREATE TABLE events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  stream         TEXT    NOT NULL,
  stream_version INTEGER NOT NULL,
  type           TEXT    NOT NULL,
  schema_version INTEGER NOT NULL,
  actor          TEXT    NOT NULL,
  at             TEXT    NOT NULL,
  correlation_id TEXT,
  payload        TEXT    NOT NULL,
  prev_hash      TEXT    NOT NULL,
  hash           TEXT    NOT NULL,
  UNIQUE (stream, stream_version)
);
${appendOnly("events")}
CREATE TABLE agent_events (
  session_id TEXT    NOT NULL,
  seq        INTEGER NOT NULL,
  at         TEXT    NOT NULL,
  kind       TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  prev_hash  TEXT    NOT NULL,
  hash       TEXT    NOT NULL,
  PRIMARY KEY (session_id, seq)
);
${appendOnly("agent_events")}
`;
