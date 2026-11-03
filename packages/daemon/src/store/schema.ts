export const SCHEMA_VERSION = 5;

const appendOnly = (table: string) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, 'append-only'); END;`;

/** Esquema de la versión 1 (ADR-004). Congelado: los cambios van como migraciones. */
export const SCHEMA_V1_SQL = `
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

/** Migraciones por versión de destino. Cada una se ejecuta dentro de la transacción de apertura. */
export const MIGRATIONS: Readonly<Record<number, string>> = {
  // Sin triggers append-only: crypto-shredding borra filas.
  2: `
CREATE TABLE data_keys (
  key_id      TEXT    PRIMARY KEY,
  task_id     INTEGER NOT NULL,
  data_class  TEXT    NOT NULL,
  wrapped_key BLOB    NOT NULL,
  created_at  TEXT    NOT NULL,
  UNIQUE (task_id, data_class)
);`,
  // Proyección de lectura (ver projections/tasks.ts). Sin triggers: se reconstruye.
  3: `
CREATE TABLE tasks (
  number         INTEGER PRIMARY KEY,
  title          TEXT    NOT NULL,
  state          TEXT    NOT NULL,
  risk           TEXT    NOT NULL,
  repo           TEXT    NOT NULL,
  base_branch    TEXT    NOT NULL,
  stream_version INTEGER NOT NULL,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);`,
  // Reserva de números de tarea. AUTOINCREMENT: un número reservado no se reutiliza (hay huecos).
  4: `
CREATE TABLE task_numbers (
  number      INTEGER PRIMARY KEY AUTOINCREMENT,
  reserved_at TEXT    NOT NULL
);`,
  // Identidad (ADR-005). Solo se guarda el hash del token; revocar es borrar sus filas.
  5: `
CREATE TABLE users (
  user_id      TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE TABLE tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  created_at TEXT NOT NULL
);`,
};
