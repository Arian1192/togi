/**
 * Quita los caracteres de control salvo el salto de línea y el tabulador: la misma limpieza que usa
 * la CLI para lo que pinta. Un texto que escribió un agente no debe poder mover ni ordenar nada a
 * la terminal de quien lea el log.
 */
export const stripControl = (text: string): string => text.replace(/(?![\n\t])\p{Cc}/gu, "");
