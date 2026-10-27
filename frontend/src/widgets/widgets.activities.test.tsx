import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activity, detail } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderWithApp, widgetProps } from "../test/render";
import { ActivityDetailView, ActivityDetailWidget, buildSamples } from "./ActivityDetailWidget";
import { RecentActivitiesWidget } from "./RecentActivitiesWidget";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Dernières sorties", () => {
  const list = [
    activity({ id: 1, day: "2026-10-25", rpe: 6 }),
    activity({ id: 2, day: "2026-10-23", sport: "running", sport_group: "run", duration_min: 45, distance_km: 11, dplus_m: 120, hr_avg: 134, rpe: null }),
    activity({ id: 3, day: "2026-10-20", sport: "strength_training", sport_group: "other", duration_min: 30, distance_km: null, dplus_m: null, hr_avg: null, rpe: null, pace_s_per_km: null }),
  ];

  it("affiche durée, distance, D+, FC moyenne et RPE ; un tiret quand la valeur manque", async () => {
    mockApi({ "GET /api/activities": () => ({ body: list }) });
    renderWithApp(<RecentActivitiesWidget {...widgetProps({ count: 7, sport: "all" })} />);
    const rows = await screen.findAllByRole("button", { name: /^Détail :/ });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/2\s?h\s?05/);
    expect(rows[0]).toHaveTextContent("18,4 km");
    expect(rows[0]).toHaveTextContent("820 m");
    expect(rows[0]).toHaveTextContent("142");
    expect(rows[0]).toHaveTextContent("6");
    // séance de renfo : aucune distance, D+ ni FC inventés
    const strength = within(rows[2] as HTMLElement).getAllByRole("cell").map((c) => c.textContent);
    expect(strength).toEqual(["20 oct.", "Renforcement", "30 min", "—", "—", "—", "—", "⤓"]);
  });

  it("n'affiche la colonne GAP que si une sortie en a un", async () => {
    mockApi({ "GET /api/activities": () => ({ body: list }) });
    const { unmount } = renderWithApp(<RecentActivitiesWidget {...widgetProps({ count: 7, sport: "all" })} />);
    await screen.findAllByRole("button", { name: /^Détail :/ });
    expect(screen.queryByRole("columnheader", { name: "GAP" })).toBeNull();
    unmount();
    mockApi({ "GET /api/activities": () => ({ body: [activity({ gap_s_per_km: 390 })] }) });
    renderWithApp(<RecentActivitiesWidget {...widgetProps({ count: 7, sport: "all" })} />);
    expect(await screen.findByRole("columnheader", { name: "GAP" })).toBeInTheDocument();
    expect(screen.getByText("6:30 /km")).toBeInTheDocument();
  });

  it("le nombre et le sport réglés sont envoyés à l'API (5 à 10)", async () => {
    const api = mockApi({ "GET /api/activities": () => ({ body: list }) });
    renderWithApp(<RecentActivitiesWidget {...widgetProps({ count: 10, sport: "trail" })} />);
    await screen.findAllByRole("button", { name: /^Détail :/ });
    expect(api.callsTo("GET /api/activities")[0]?.query).toMatchObject({ limit: "10", group: "trail" });
  });

  it("borne le nombre de sorties entre 5 et 10", async () => {
    const api = mockApi({ "GET /api/activities": () => ({ body: list }) });
    renderWithApp(<RecentActivitiesWidget {...widgetProps({ count: 50, sport: "all" })} />);
    await screen.findAllByRole("button", { name: /^Détail :/ });
    expect(api.callsTo("GET /api/activities")[0]?.query.limit).toBe("10");
  });

  it("un clic ouvre le détail de la séance (et Échap le ferme)", async () => {
    const api = mockApi({
      "GET /api/activities": () => ({ body: list }),
      "GET /api/activities/2": () => ({ body: detail({ id: 2, sport: "running", day: "2026-10-23" }) }),
    });
    renderWithApp(<RecentActivitiesWidget {...widgetProps({ count: 7, sport: "all" })} />);
    const rows = await screen.findAllByRole("button", { name: /^Détail :/ });
    await userEvent.click(rows[1] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Détail de la séance" });
    expect(await within(dialog).findByText(/Course à pied · 23 oct\./)).toBeInTheDocument();
    expect(api.callsTo("GET /api/activities/2")).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
  });

  it("la fenêtre s'ouvre dans <body> (pas dans le cadre déplacé par transform)", async () => {
    mockApi({
      "GET /api/activities": () => ({ body: list }),
      "GET /api/activities/1": () => ({ body: detail() }),
    });
    const { container } = renderWithApp(<RecentActivitiesWidget {...widgetProps({ count: 7, sport: "all" })} />);
    await userEvent.click((await screen.findAllByRole("button", { name: /^Détail :/ }))[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Détail de la séance" });
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("vide et erreur", async () => {
    mockApi({ "GET /api/activities": () => ({ body: [] }) });
    const { unmount } = renderWithApp(<RecentActivitiesWidget {...widgetProps({ count: 7, sport: "all" })} />);
    expect(await screen.findByText("Aucune sortie enregistrée.")).toBeInTheDocument();
    unmount();
    mockApi({ "GET /api/activities": () => ({ status: 500, body: { detail: "Panne" } }) });
    renderWithApp(<RecentActivitiesWidget {...widgetProps({ count: 7, sport: "all" })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Panne");
  });
});

describe("Détail de séance", () => {
  it("affiche profil, allure, temps par zone, côtes et notes", async () => {
    mockApi({ "GET /api/activities/1": () => ({ body: detail() }) });
    renderWithApp(<ActivityDetailView activityId={1} />);
    expect(await screen.findByText(/Trail · 25 oct\./)).toBeInTheDocument();
    expect(screen.getByText("Profil altimétrique et fréquence cardiaque")).toBeInTheDocument();
    expect(document.querySelectorAll(".recharts-wrapper").length).toBe(2); // profil + allure
    // temps par zone : 3 600 s en zone 3 sur 7 500 s = 48 %
    const zones = screen.getByRole("table", { name: "Temps par zone de fréquence cardiaque" });
    expect(within(zones).getByText("Z3", { exact: false })).toBeInTheDocument();
    expect(zones).toHaveTextContent(/1\s?h\s?00\s·\s48\s%/);
    expect(zones).toHaveTextContent(/Bas d'intensité \(sous Z1 à Z2\) : 48\s%/);
    // découpage par côte
    const climbs = screen.getByRole("columnheader", { name: "Pente moy." }).closest("table") as HTMLElement;
    expect(within(climbs).getByText("120 m")).toBeInTheDocument();
    expect(within(climbs).getByText("10,9 %")).toBeInTheDocument();
    expect(climbs).toHaveTextContent("0,4–1,5");
    // GAP : jamais inventé
    expect(screen.getAllByText(/GAP/).length).toBeGreaterThan(0);
    expect(screen.getByText(/non disponible pour l'instant/)).toBeInTheDocument();
    expect(screen.getByText("indicatif")).toBeInTheDocument();
  });

  it("sans flux : aucune courbe inventée, valeurs de la sortie conservées", async () => {
    mockApi({
      "GET /api/activities/1": () => ({
        body: detail({ stream: null, zones: null, climbs: [], notes: ["Pas de flux seconde par seconde pour cette sortie."] }),
      }),
    });
    renderWithApp(<ActivityDetailView activityId={1} />);
    expect(await screen.findByText("Pas de profil détaillé pour cette sortie.")).toBeInTheDocument();
    expect(document.querySelectorAll(".recharts-wrapper")).toHaveLength(0);
    expect(screen.getByText("Temps par zone indisponible (pas de FC).")).toBeInTheDocument();
    expect(screen.getByText("Découpage par côte indisponible (pas d'altitude).")).toBeInTheDocument();
    expect(screen.getByText("18,4 km")).toBeInTheDocument();
  });

  it("sans côte significative : le dit", async () => {
    mockApi({ "GET /api/activities/1": () => ({ body: detail({ climbs: [] }) }) });
    renderWithApp(<ActivityDetailView activityId={1} />);
    expect(await screen.findByText(/Aucune côte significative détectée/)).toBeInTheDocument();
  });

  it("erreur 404 : message de l'API", async () => {
    mockApi({ "GET /api/activities/9": () => ({ status: 404, body: { detail: "Sortie introuvable." } }) });
    renderWithApp(<ActivityDetailView activityId={9} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sortie introuvable.");
  });

  it("buildSamples ignore les points sans distance et plafonne les allures irréalistes", () => {
    const stream = {
      points_total: 4,
      t: [0, 1, 2, 3],
      distance_km: [0, null, 0.2, 0.3],
      altitude_m: [10, 11, 12, 13],
      hr: [100, 110, null, 130],
      pace_s_per_km: [300, 300, 2000, 360],
    };
    expect(buildSamples(stream)).toEqual([
      { km: 0, alt: 10, hr: 100, pace: 300 },
      { km: 0.2, alt: 12, hr: null, pace: null }, // 33 min/km : à l'arrêt
      { km: 0.3, alt: 13, hr: 130, pace: 360 },
    ]);
  });

  it("le widget propose la dernière sortie par défaut et mémorise le choix", async () => {
    const updateSettings = vi.fn();
    mockApi({
      "GET /api/activities": () => ({ body: [activity({ id: 5 }), activity({ id: 4, day: "2026-10-22" })] }),
      "GET /api/activities/5": () => ({ body: detail({ id: 5 }) }),
      "GET /api/activities/4": () => ({ body: detail({ id: 4, day: "2026-10-22" }) }),
    });
    renderWithApp(<ActivityDetailWidget {...({ settings: { activityId: null }, instanceId: "w", updateSettings })} />);
    const picker = await screen.findByLabelText("Séance");
    expect(picker).toHaveValue("latest");
    expect(await screen.findByText(/Trail · 25 oct\./)).toBeInTheDocument();
    await userEvent.selectOptions(picker, "4");
    expect(updateSettings).toHaveBeenCalledWith({ activityId: 4 });
  });

  it("le widget : aucune sortie → état vide", async () => {
    mockApi({ "GET /api/activities": () => ({ body: [] }) });
    renderWithApp(<ActivityDetailWidget {...widgetProps({ activityId: null })} />);
    expect(await screen.findByText("Aucune sortie à afficher.")).toBeInTheDocument();
  });
});
