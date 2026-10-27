import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WeatherResponse } from "../api/types";
import { evidence } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderWithApp, widgetProps } from "../test/render";
import { getWidget } from ".";
import { WeatherWidget } from "./WeatherWidget";

afterEach(() => {
  vi.unstubAllGlobals();
});

const place = { nom: "Bruniquel, Occitanie", lat: 44.0364, lon: 1.6667 };

const weather = (over: Partial<WeatherResponse> = {}, stale = false): WeatherResponse => ({
  day_basis: "session",
  session: { date: "2026-10-16", titre: "Côtes courtes", type_label: "Côtes", duree_min: 60 },
  weather: {
    place,
    day: { date: "2026-10-16", label: "Pluie", temp_min_c: 7, temp_max_c: 14, rain_mm: 5.5, rain_prob_max_pct: 70, wind_max_kmh: 32, gust_max_kmh: 55, sunrise: "07:52", sunset: "18:41" },
    periods: [
      { name: "Matin (6–12 h)", temp_c: 9.5, rain_prob_pct: 30, rain_mm: 0.6, wind_kmh: 21 },
      { name: "Après-midi (12–18 h)", temp_c: 13, rain_prob_pct: 70, rain_mm: 3.2, wind_kmh: 32 },
      { name: "Soir (18–22 h)", temp_c: 10, rain_prob_pct: 40, rain_mm: 0.4, wind_kmh: 18 },
    ],
    hours: [6, 7, 8, 9].map((hour) => ({ hour, temp_c: 8 + hour / 2, feels_c: 6, rain_prob_pct: 20, rain_mm: 0, wind_kmh: 12, gust_kmh: 25, label: "Couvert" })),
    fetched_at: 1_800_000_000,
    stale,
    attribution: "Prévisions : Open-Meteo.com (CC BY 4.0).",
    evidence: evidence("indicatif", "Prévision d'un modèle météo, à revoir la veille."),
  },
  ...over,
});

describe("Météo du jour de sortie", () => {
  it("sans lieu : invitation à en choisir un ; recherche puis choix du lieu", async () => {
    let chosen: typeof place | null = null;
    const api = mockApi({
      "GET /api/weather/location": () => ({ body: chosen }),
      "GET /api/weather/geocode": () => ({ body: [place, { nom: "Bruniquel, Quelque part", lat: 1, lon: 2 }] }),
      "PUT /api/weather/location": ({ body }) => {
        chosen = body as typeof place;
        return { body };
      },
      "GET /api/weather": () => ({ body: weather() }),
    });
    renderWithApp(<WeatherWidget {...widgetProps({ day: "session" })} />);
    expect(await screen.findByText(/Choisissez le lieu de vos sorties/)).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Lieu de la météo" });
    expect(within(form).getByRole("button", { name: "Chercher" })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText(/Lieu de vos sorties/), "Bruniquel");
    await userEvent.click(within(form).getByRole("button", { name: "Chercher" }));
    await userEvent.click(await within(form).findByRole("button", { name: "Bruniquel, Occitanie" }));
    await waitFor(() => { expect(api.callsTo("PUT /api/weather/location")).toHaveLength(1); });
    expect(api.callsTo("PUT /api/weather/location")[0]?.body).toEqual(place);
    expect(api.callsTo("GET /api/weather/geocode")[0]?.query.q).toBe("Bruniquel");
    expect(await screen.findByText("Bruniquel, Occitanie")).toBeInTheDocument(); // la météo s'affiche une fois le lieu choisi
  });

  it("séance prévue, résumé du jour, périodes, heure par heure et attribution", async () => {
    const api = mockApi({
      "GET /api/weather/location": () => ({ body: place }),
      "GET /api/weather": () => ({ body: weather() }),
    });
    renderWithApp(<WeatherWidget {...widgetProps({ day: "today" })} />);
    expect((await screen.findByText("Côtes courtes")).closest("p")).toHaveTextContent(/Séance prévue le 16 oct\. : Côtes courtes \(Côtes, 1\s?h\s?00\)/);
    expect(api.callsTo("GET /api/weather")[0]?.query.day).toBe("today");
    expect(screen.getByText("Bruniquel, Occitanie")).toBeInTheDocument();
    expect(screen.getByText("Pluie", { selector: ".stat-value" })).toBeInTheDocument();
    expect(screen.getByText(/probabilité max 70 %/)).toBeInTheDocument();
    expect(screen.getByText(/rafales 55 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/soleil 07:52–18:41/)).toBeInTheDocument();
    const periods = screen.getAllByRole("table")[0] as HTMLElement;
    expect(within(periods).getByRole("row", { name: /Après-midi/ })).toHaveTextContent("70 % · 3,2 mm");
    expect(screen.getByText(/Pluie probable : prévoir une veste/)).toBeInTheDocument();
    expect(screen.getByText("Heure par heure")).toBeInTheDocument();
    expect(screen.getByText("Prévisions : Open-Meteo.com (CC BY 4.0).")).toBeInTheDocument();
    expect(screen.getByText("Prévision d'un modèle météo, à revoir la veille.")).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("sans séance prévue : le jour affiché est dit ; temps sec : pas de conseil de pluie", async () => {
    const dry = weather({ session: null, day_basis: "today" });
    dry.weather.day = { ...dry.weather.day, rain_mm: 0, rain_prob_max_pct: 10, label: "Ciel dégagé" };
    mockApi({ "GET /api/weather/location": () => ({ body: place }), "GET /api/weather": () => ({ body: dry }) });
    renderWithApp(<WeatherWidget {...widgetProps({ day: "session" })} />);
    expect(await screen.findByText(/Aucune séance prévue : météo du 16 oct\./)).toBeInTheDocument();
    expect(screen.queryByText(/Pluie probable/)).toBeNull();
  });

  it("service météo injoignable : dernière prévision conservée, signalée", async () => {
    mockApi({ "GET /api/weather/location": () => ({ body: place }), "GET /api/weather": () => ({ body: weather({}, true) }) });
    renderWithApp(<WeatherWidget {...widgetProps({ day: "session" })} />);
    expect(await screen.findByRole("note")).toHaveTextContent("dernière prévision connue conservée");
  });

  it("jour hors prévision : message vide ; service en erreur : message et nouvel essai", async () => {
    mockApi({
      "GET /api/weather/location": () => ({ body: place }),
      "GET /api/weather": () => ({ status: 404, body: { detail: "Pas de prévision pour le 01/10/2026 : disponible jusqu'à 14 jours à l'avance." } }),
    });
    renderWithApp(<WeatherWidget {...widgetProps({ day: "session" })} />);
    expect(await screen.findByText(/Pas de prévision pour le 01\/10\/2026/)).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockApi({
      "GET /api/weather/location": () => ({ body: place }),
      "GET /api/weather": () => ({ status: 502, body: { detail: "Service météo injoignable (ConnectError)." } }),
    });
    renderWithApp(<WeatherWidget {...widgetProps({ day: "session" })} />);
    expect(await screen.findByText("Service météo injoignable (ConnectError).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("changer de lieu depuis la météo affichée", async () => {
    mockApi({ "GET /api/weather/location": () => ({ body: place }), "GET /api/weather": () => ({ body: weather() }) });
    renderWithApp(<WeatherWidget {...widgetProps({ day: "session" })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Changer de lieu" }));
    const form = screen.getByRole("form", { name: "Lieu de la météo" });
    expect(within(form).getByLabelText(/Lieu actuel : Bruniquel, Occitanie/)).toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Annuler" }));
    expect(await screen.findByText("Pluie", { selector: ".stat-value" })).toBeInTheDocument();
  });

  it("export Markdown : séance, résumé, périodes, attribution ; rien sans lieu", async () => {
    mockApi({ "GET /api/weather": () => ({ body: weather() }) });
    const block = await getWidget("weather")?.exportData({ day: "session" });
    const md = (block?.markdown ?? "").replace(/\s/g, " ");
    expect(md).toContain("## Météo — Bruniquel, Occitanie, 16 oct.");
    expect(md).toContain("Séance prévue : Côtes courtes (Côtes, 1 h 00).");
    expect(md).toContain("Pluie · 7–14 °C · pluie 5,5 mm (probabilité max 70 %)");
    expect(md).toContain("| Après-midi (12–18 h) | 13 °C | 70 % | 3,2 | 32 km/h |");
    expect(md).toContain("Open-Meteo.com");
    vi.unstubAllGlobals();
    mockApi({ "GET /api/weather": () => ({ status: 409, body: { detail: "Aucun lieu choisi" } }) });
    expect(await getWidget("weather")?.exportData({ day: "session" })).toBeNull();
  });
});
