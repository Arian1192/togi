import { serve, srtSandbox } from "./worker.ts";

// Solo habla por la entrada y la salida estándar con el daemon (ADR-008 §4).
await serve(process.stdin, process.stdout, { createSandbox: srtSandbox });
