import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LOCKED_EVENT, request } from "../api/client";
import { mockApi } from "../test/mockApi";
import { LockGate } from "./LockGate";
import { vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); });

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LockGate>
        <p>Contenu protégé</p>
      </LockGate>
    </QueryClientProvider>,
  );

describe("Verrouillage simple", () => {
  it("sans code configuré, l'appli s'affiche directement", async () => {
    mockApi({ "GET /api/auth/status": () => ({ body: { locked: false, authenticated: true } }) });
    mount();
    expect(await screen.findByText("Contenu protégé")).toBeInTheDocument();
  });

  it("verrouillée : demande le code, refuse un mauvais code, puis déverrouille", async () => {
    let authenticated = false;
    const api = mockApi({
      "GET /api/auth/status": () => ({ body: { locked: true, authenticated } }),
      "POST /api/auth/login": (call) => {
        if ((call.body as { code: string }).code !== "bon") return { status: 401, body: { detail: "Code incorrect." } };
        authenticated = true;
        return { status: 204 };
      },
    });
    mount();
    const field = await screen.findByLabelText("Code d'accès");
    expect(screen.queryByText("Contenu protégé")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Déverrouiller" })).toBeDisabled();

    await userEvent.type(field, "faux{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Code incorrect.");

    await userEvent.clear(field);
    await userEvent.type(field, "bon{Enter}");
    expect(await screen.findByText("Contenu protégé")).toBeInTheDocument();
    expect(api.callsTo("POST /api/auth/login")).toHaveLength(2);
  });

  it("une réponse « verrouillé » en cours d'utilisation ramène à l'écran de code", async () => {
    let authenticated = true;
    mockApi({
      "GET /api/auth/status": () => ({ body: { locked: true, authenticated } }),
      "GET /api/profile": () => {
        authenticated = false;
        return { status: 401, body: { detail: "Accès verrouillé : code requis.", locked: true } };
      },
    });
    mount();
    expect(await screen.findByText("Contenu protégé")).toBeInTheDocument();
    const seen = vi.fn();
    window.addEventListener(LOCKED_EVENT, seen);
    await expect(request("GET", "/api/profile")).rejects.toThrow("Accès verrouillé");
    expect(seen).toHaveBeenCalled();
    window.removeEventListener(LOCKED_EVENT, seen);
    expect(await screen.findByLabelText("Code d'accès")).toBeInTheDocument();
  });

  it("statut illisible (serveur éteint) : l'interface gère ses propres erreurs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("réseau"))));
    mount();
    await waitFor(() => { expect(screen.getByText("Contenu protégé")).toBeInTheDocument(); });
  });
});
