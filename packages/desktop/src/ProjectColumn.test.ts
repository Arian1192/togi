import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskState } from "@togi/core";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectColumn } from "./ProjectColumn.ts";
import { buildProjects } from "./projects.ts";
import type { TaskRow } from "./TaskList.ts";
import { PENDING, type View } from "./viewState.ts";

const row = (
  number: number,
  state: string,
  repo = "o/togi",
  extra: Partial<TaskRow> = {},
): TaskRow => ({
  number,
  title: `tarea ${number}`,
  titleErased: false,
  state: state as TaskState,
  repo,
  baseBranch: "main",
  hasCriteria: true,
  updatedAt: "2026-11-07T10:00:00Z",
  version: 1,
  ...extra,
});
const TASKS = [row(1, "plan_review"), row(2, "building"), row(3, "draft", "o/promos")];

interface Calls {
  views: View[];
  toggles: string[];
}
const column = (
  over: { view?: View; closed?: string[]; truncated?: boolean; tasks?: TaskRow[] } = {},
) => {
  const calls: Calls = { views: [], toggles: [] };
  const props = {
    data: buildProjects(over.tasks ?? TASKS, over.truncated ?? false),
    view: over.view ?? PENDING,
    closed: new Set(over.closed ?? []),
    onView: (v: View) => calls.views.push(v),
    onToggle: (repo: string) => calls.toggles.push(repo),
  };
  return { props, calls, html: renderToStaticMarkup(createElement(ProjectColumn, props)) };
};

/** Recorre el árbol de elementos de React que devuelve el componente y reúne los que cumplen `test`. */
function find(
  node: ReactNode,
  test: (el: { type: unknown; props: Record<string, unknown> }) => boolean,
): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap((n) => find(n, test));
  if (!isValidElement(node)) return [];
  const el = node as unknown as { type: unknown; props: Record<string, unknown> };
  return [...(test(el) ? [el] : []), ...find(el.props.children as ReactNode, test)];
}
const buttons = (props: Parameters<typeof ProjectColumn>[0]) =>
  find(ProjectColumn(props), (el) => el.type === "button");
const labelled = (props: Parameters<typeof ProjectColumn>[0], text: RegExp) =>
  buttons(props).filter((b) =>
    text.test(
      renderToStaticMarkup(createElement("i", null, b.props.children as ReactNode)) +
        String(b.props["aria-label"] ?? ""),
    ),
  );

test("es una navegación «Proyectos» con «Pendiente de ti» arriba y un grupo por proyecto", () => {
  const { html } = column();
  assert.match(html, /<nav[^>]*aria-label="Proyectos"/);
  assert.ok(html.indexOf("Pendiente de ti") < html.indexOf("togi"));
  assert.match(html, /promos/);
});

test("los proyectos con algo que te espera salen primero", () => {
  const { html } = column();
  assert.ok(html.indexOf(">togi<") < html.indexOf(">promos<"));
});

test("todo son botones de verdad, con el estado visible para un lector de pantalla", () => {
  const { html, props } = column();
  assert.doesNotMatch(html, /<div[^>]*onclick|role="button"/i);
  for (const b of buttons(props)) assert.equal(b.props.type, "button");
});

test("lo seleccionado lleva aria-current y lo demás no", () => {
  const view: View = { kind: "task", number: 2 };
  const { html } = column({ view });
  assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
  assert.match(html, /aria-current="true"[^>]*>(?:(?!<\/button>).)*#2/);
  assert.equal((column({ view: PENDING }).html.match(/aria-current="true"/g) ?? []).length, 1);
  assert.equal(
    (column({ view: { kind: "project", repo: "o/togi" } }).html.match(/aria-current="true"/g) ?? [])
      .length,
    1,
  );
});

test("un proyecto plegado oculta sus tareas y dice que está plegado", () => {
  const open = column().html;
  assert.match(open, /tarea 1/);
  const folded = column({ closed: ["o/togi"] }).html;
  assert.doesNotMatch(folded, /tarea 1/);
  assert.match(folded, /aria-expanded="false"/);
  assert.match(open, /aria-expanded="true"/);
});

test("los contadores de un proyecto son lo que te espera y lo que está en curso", () => {
  const { html } = column({ tasks: [row(1, "plan_review"), row(2, "review"), row(3, "building")] });
  assert.match(html, /col-count[^>]*>[^<]*(?:<[^>]*>)*2/);
});

test("con la lista truncada los contadores llevan un «+»", () => {
  assert.match(column({ truncated: true }).html, /col-partial[^>]*>\+/);
  assert.doesNotMatch(column({ truncated: false }).html, /col-partial/);
});

test("una tarea con el título borrado dice [borrado] y no inventa texto", () => {
  const { html } = column({
    tasks: [row(1, "draft", "o/togi", { title: null, titleErased: true })],
  });
  assert.match(html, /\[borrado\]/);
});

test("los botones avisan de lo que se pulsa", () => {
  const { props, calls } = column();
  const click = (button: { props: Record<string, unknown> } | undefined) => {
    assert.ok(button, "no se encontró el botón");
    (button.props.onClick as () => void)();
  };
  click(labelled(props, /Pendiente de ti/)[0]);
  click(buttons(props).find((b) => b.props["aria-expanded"] !== undefined));
  click(labelled(props, /tarea 1/)[0]);
  assert.deepEqual(calls.views, [PENDING, { kind: "task", number: 1 }]);
  assert.deepEqual(calls.toggles, ["o/togi"]);
});

test("sin tareas no hay proyectos, pero «Pendiente de ti» sigue ahí", () => {
  const { html } = column({ tasks: [] });
  assert.match(html, /Pendiente de ti/);
  assert.doesNotMatch(html, /aria-expanded/);
});
