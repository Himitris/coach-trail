import { vi } from "vitest";

export interface RecordedCall {
  method: string;
  /** Chemin sans la chaîne de requête. */
  path: string;
  query: Record<string, string>;
  body: unknown;
}

type Handler = (call: RecordedCall) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>;

/** Remplace `fetch` par un faux serveur : `routes` associe « METHODE /chemin » à une réponse. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const [path = "", search = ""] = url.split("?");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const call: RecordedCall = { method, path, query: Object.fromEntries(new URLSearchParams(search)), body };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ detail: `non géré : ${method} ${path}` }), { status: 404 });
    const { status = 200, body: payload } = await handler(call);
    return new Response(payload === undefined ? null : JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, callsTo: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key) };
}
