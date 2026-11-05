/** Variable que fija el tope de coste por sesión, en dólares. */
export const SESSION_COST_ENV = "TOGI_MAX_SESSION_COST_USD";
export const DEFAULT_SESSION_COST_USD = 1;
/** Techo de lo que se puede configurar: un valor mayor casi seguro es un error de tecleo. */
export const MAX_SESSION_COST_USD = 20;

export class InvalidSessionCostError extends Error {
  override name = "InvalidSessionCostError";
  constructor(raw: string) {
    super(
      `${SESSION_COST_ENV}=${JSON.stringify(raw.slice(0, 40))} no es válido: debe ser un número mayor que 0 y como mucho ${MAX_SESSION_COST_USD}`,
    );
  }
}

/** El tope de coste por sesión: el del entorno si es válido, 1 USD si no hay. Un valor inválido lanza. */
export function sessionCostCap(env: Record<string, string | undefined>): {
  usd: number;
  source: "default" | "env";
} {
  const raw = env[SESSION_COST_ENV];
  if (raw === undefined) return { usd: DEFAULT_SESSION_COST_USD, source: "default" };
  const usd = /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(usd) || usd <= 0 || usd > MAX_SESSION_COST_USD) {
    throw new InvalidSessionCostError(raw);
  }
  return { usd, source: "env" };
}
