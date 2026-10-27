import { defineConfig, devices } from "@playwright/test";

const PORT = 8765;

/**
 * Recette de bout en bout : vrai backend FastAPI (FakeConnector) + frontend construit, servis par
 * `backend/tests/e2e_server.py`. Prérequis : `npm run build` (fait par `npm run e2e`).
 * PW_CHROMIUM : chemin d'un Chromium déjà installé (sinon celui de `npx playwright install`).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 1600 } } }],
  webServer: {
    command: `python -m tests.e2e_server --port ${PORT} --static ../frontend/dist --data /tmp/coach-trail-e2e`,
    cwd: "../backend",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
