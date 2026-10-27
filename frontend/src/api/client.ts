/** Client HTTP minimal : JSON en entrée/sortie, erreurs typées. L'UI ne lit que l'API locale. */

export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** Message lisible à partir du champ `detail` de FastAPI. */
export function messageFromDetail(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return "Certains champs sont invalides.";
  if (detail && typeof detail === "object" && "message" in detail) {
    const message = (detail).message;
    if (typeof message === "string") return message;
  }
  return `Erreur ${status}`;
}

export interface RequestOptions {
  body?: unknown;
  /** Octets bruts (import de fichier) : envoyés tels quels, sans JSON. */
  file?: Blob;
  /** Permet à la requête de finir pendant la fermeture de la page (sauvegarde de dernière minute). */
  keepalive?: boolean;
  signal?: AbortSignal;
}

/** Émis quand l'API répond « verrouillé » (code d'accès requis) : l'écran de verrouillage s'affiche. */
export const LOCKED_EVENT = "coach-trail:locked";

export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers:
        options.file !== undefined
          ? { "Content-Type": "application/octet-stream" }
          : options.body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
      body: options.file ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      keepalive: options.keepalive,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, null, "Serveur injoignable");
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? (payload).detail
        : payload;
    if (response.status === 401 && isLocked(payload)) window.dispatchEvent(new Event(LOCKED_EVENT));
    throw new ApiError(response.status, detail, messageFromDetail(detail, response.status));
  }
  return payload as T;
}

function isLocked(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && "locked" in payload && payload.locked === true;
}
