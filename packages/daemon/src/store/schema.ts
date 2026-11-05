export const SCHEMA_VERSION = 11;

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
  // Idempotency-Key de POST /v1/tasks (ADR-005). Por usuario; se escribe en la transacción de la
  // tarea. Sin caducidad por ahora. Sin triggers: la limpieza futura borrará filas.
  6: `
CREATE TABLE idempotency_keys (
  user_id       TEXT    NOT NULL,
  key           TEXT    NOT NULL,
  request_hash  TEXT    NOT NULL,
  status        INTEGER NOT NULL,
  response_body TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  PRIMARY KEY (user_id, key)
);`,
  // `tasks.title` guarda ahora la BlobRef del título en JSON, no el texto (ADR-004). No hay logs
  // reales con títulos en claro: se vacía la proyección en lugar de migrar sus filas.
  7: "DELETE FROM tasks;",
  // `has_criteria`: si la tarea tiene criterio de aceptación. Es un booleano; el texto sigue cifrado.
  // Vacía la proyección porque DEFAULT 0 mentiría en las filas viejas; `REBUILD_PROJECTIONS` la repuebla.
  8: `
ALTER TABLE tasks ADD COLUMN has_criteria INTEGER NOT NULL DEFAULT 0;
DELETE FROM tasks;`,
  // Proyecciones de la planificación (ver projections/planning.ts). Sin triggers: se reconstruyen.
  // Solo referencias a blobs (approach, reason): nunca el texto.
  9: `
CREATE TABLE plans (
  task_number          INTEGER NOT NULL,
  plan_version         INTEGER NOT NULL,
  session_id           TEXT    NOT NULL,
  base_sha             TEXT    NOT NULL,
  files                TEXT    NOT NULL,
  new_tests            TEXT    NOT NULL,
  approach             TEXT    NOT NULL,
  estimated_production INTEGER NOT NULL,
  estimated_tests      INTEGER NOT NULL,
  proposed_at          TEXT    NOT NULL,
  PRIMARY KEY (task_number, plan_version)
);
CREATE TABLE sessions (
  session_id  TEXT PRIMARY KEY,
  task_number INTEGER NOT NULL,
  role        TEXT    NOT NULL,
  runtime     TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  specialist  TEXT    NOT NULL,
  state       TEXT    NOT NULL,
  started_at  TEXT    NOT NULL,
  ended_at    TEXT,
  outcome     TEXT,
  usage       TEXT
);
CREATE TABLE decisions (
  seq          INTEGER PRIMARY KEY,
  task_number  INTEGER NOT NULL,
  gate         TEXT    NOT NULL,
  verdict      TEXT    NOT NULL,
  plan_version INTEGER NOT NULL,
  actor        TEXT    NOT NULL,
  reason       TEXT,
  decided_at   TEXT    NOT NULL
);`,
  // Repos registrados: configuración del usuario, no una proyección. owner/repo no distingue mayúsculas.
  10: `
CREATE TABLE repos (
  repo     TEXT PRIMARY KEY COLLATE NOCASE,
  path     TEXT NOT NULL,
  added_at TEXT NOT NULL
);`,
  // Código del fallo de una sesión (session.ended v2). NULL en las que terminaron antes, o sin fallo.
  11: "ALTER TABLE sessions ADD COLUMN failure_reason TEXT;",
};

/**
 * Migraciones que dejan las proyecciones vacías o inválidas. Al abrir la base, si alguna de las
 * aplicadas está aquí, se reconstruyen desde el log dentro de la misma transacción.
 */
export const REBUILD_PROJECTIONS: ReadonlySet<number> = new Set([7, 8, 9]);
