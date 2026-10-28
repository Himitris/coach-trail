import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { applyStoredTheme } from "./app/theme";
import { LockGate } from "./app/LockGate";
import { DashboardProvider } from "./app/DashboardProvider";
import { Shell } from "./app/Shell";
import { ToastProvider } from "./app/toasts";
import "./styles.css";
import "./widgets";

applyStoredTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const root = document.getElementById("root");
if (!root) throw new Error("Élément #root introuvable");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <LockGate>
          <BrowserRouter>
            <DashboardProvider>
              <Shell />
            </DashboardProvider>
          </BrowserRouter>
        </LockGate>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Service worker : production uniquement (en développement il masquerait les changements).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
