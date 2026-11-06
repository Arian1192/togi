/** Lo único que se mira de un stream: si es una terminal. */
export interface TtyLike {
  isTTY?: boolean | undefined;
}

/**
 * ¿Se puede preguntar y abrir un editor? Hace falta una terminal en la entrada (para teclear) y en
 * stderr (donde se pregunta y donde va la salida del editor). Stdout no cuenta: `togi new > f` sigue
 * siendo interactivo.
 */
export const isInteractive = (stdin: TtyLike, stderr: TtyLike): boolean =>
  stdin.isTTY === true && stderr.isTTY === true;
