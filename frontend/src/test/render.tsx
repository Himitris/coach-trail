import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { ToastProvider } from "../app/toasts";

/** Rend un composant avec TanStack Query (sans nouvelle tentative) et les notifications. */
export function renderWithApp(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ToastProvider>{ui}</ToastProvider>
      </QueryClientProvider>,
    ),
  };
}

/** Props d'un widget pour les tests : les réglages sont typés par le composant testé. */
export function widgetProps(settings: Record<string, unknown>, updateSettings = vi.fn()) {
  return {
    settings: settings as never,
    instanceId: "w",
    updateSettings: updateSettings as never,
  };
}
