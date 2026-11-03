/** Quita los caracteres de control salvo salto de línea y tabulador: el texto de una tarea no puede mover la terminal. */
export const clean = (text: string): string => text.replace(/(?![\n\t])\p{Cc}/gu, "");
