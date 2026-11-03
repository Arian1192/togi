import assert from "node:assert/strict";
import { test } from "node:test";
import { relativeTime } from "./format.ts";
import { createOutput } from "./output.ts";
import { PAGE, renderStatus, type StatusTask } from "./status-view.ts";

const NOW = new Date("2026-11-03T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const plain = createOutput({ env: {}, isTTY: false, noColorFlag: true });
const colored = createOutput({ env: { FORCE_COLOR: "1" }, isTTY: false, noColorFlag: false });

const task = (n: number, over: Partial<StatusTask> = {}): StatusTask => ({
  number: n,
  title: `Tarea ${n}`,
  titleErased: false,
  state: "planning",
  risk: "low",
  hasCriteria: true,
  updatedAt: ago(2 * 60 * MIN),
  ...over,
});
const view = (tasks: StatusTask[], opts: { state?: string; all?: boolean } = {}, out = plain) =>
  renderStatus(tasks, { all: opts.all === true, ...opts }, out, NOW);

test("la fecha relativa usa el reloj inyectado", () => {
  assert.equal(relativeTime(ago(10_000), NOW), "ahora");
  assert.equal(relativeTime(ago(5 * MIN), NOW), "hace 5 min");
  assert.equal(relativeTime(ago(2 * 60 * MIN), NOW), "hace 2 h");
  assert.equal(relativeTime(ago(30 * 60 * MIN), NOW), "hace 1 d");
  assert.equal(relativeTime("no es fecha", NOW), "");
});

test("dos grupos alineados, falta criterio y el resumen, como en la guía", () => {
  const out = view([
    task(12, { title: "Filtro por fecha en envíos" }),
    task(13, { title: "Paginación de pedidos", risk: "medium", updatedAt: ago(30 * 60 * MIN) }),
    task(15, { title: "Migración de perfiles", state: "draft", risk: "high", hasCriteria: false }),
    task(9, { state: "rejected" }),
    task(8, { state: "rejected" }),
  ]);
  assert.equal(
    out,
    [
      "Pendiente de ti",
      "  #15  Migración de perfiles       draft     alto   falta criterio",
      "",
      "En curso",
      "  #12  Filtro por fecha en envíos  planning  bajo   hace 2 h",
      "  #13  Paginación de pedidos       planning  medio  hace 1 d",
      "",
      "3 tareas · 2 rechazadas ocultas (togi status --all)",
      "",
    ].join("\n"),
  );
});

test("--all y --state muestran las cerradas y no hay línea de ocultas", () => {
  const tasks = [task(1), task(2, { state: "merged" })];
  assert.match(view(tasks, { all: true }), /\nCerradas\n {2}#2 .* merged /);
  assert.ok(!view(tasks, { all: true }).includes("ocultas"));
  assert.match(view([tasks[1] as StatusTask], { state: "merged" }), /Cerradas\n {2}#2 /);
});

test("solo cerradas: no hay tareas abiertas y se cuentan las ocultas", () => {
  assert.equal(
    view([task(1, { state: "merged" })]),
    "No hay tareas abiertas · 1 fusionada oculta (togi status --all)\n",
  );
});

test("sin tareas, una línea", () => {
  assert.equal(view([]), "No hay tareas.\n");
  assert.equal(view([], { state: "review" }), "No hay tareas en estado review.\n");
});

test("con 200 tareas avisa del límite y no presenta el recuento como total", () => {
  const tasks = Array.from({ length: PAGE }, (_, i) => task(i + 1));
  const out = view(tasks);
  assert.match(out, /Solo se muestran las primeras 200 tareas; puede haber más\n$/);
  assert.ok(!/\d+ tareas\n$/.test(out.replace(/primeras 200 tareas/, "")), out);
  const one = view([...tasks.slice(1), task(300, { state: "rejected" })]);
  assert.match(one, /puede haber más · 1 rechazada oculta \(togi status --all\)\n$/);
});

test("la fila cabe en 80 columnas y el título largo se recorta con …", () => {
  const out = view([task(7, { title: "x".repeat(200), hasCriteria: false })]);
  const row = out.split("\n").find((l) => l.includes("#7")) as string;
  assert.ok([...row].length <= 80, row);
  assert.match(row, /x… {2}planning/);
});

test("el texto de la tarea no mueve la terminal ni parte la fila", () => {
  const out = view([task(1, { title: "\x1b[31mrojo\x07\nsegunda\tlínea" })]);
  assert.ok(!out.includes("\x1b") && !out.includes("\x07"), JSON.stringify(out));
  assert.match(out, /\[31mrojo segunda línea/);
});

test("un título borrado se decide por titleErased y va en gris; uno que se llama [borrado] no", () => {
  const erased = view([task(1, { title: null, titleErased: true })], {}, colored);
  assert.ok(erased.includes("\x1b[90m[borrado]\x1b[0m"), erased);
  const literal = view([task(2, { title: "[borrado]" })], {}, colored);
  assert.ok(!literal.includes("\x1b[90m[borrado]"), literal);
});
