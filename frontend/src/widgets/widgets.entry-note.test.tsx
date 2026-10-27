import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayIso } from "../app/format";
import type { Entry } from "../api/types";
import { activity, entry } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderWithApp, widgetProps } from "../test/render";
import { EveningEntryWidget } from "./EveningEntryWidget";
import { NoteWidget } from "./NoteWidget";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Faux serveur : conserve la saisie reçue, comme le vrai (fusion des champs fournis). */
function entryServer(initial: Entry | null, activities = [activity({ id: 11, rpe: null })]) {
  let current = initial;
  const api = mockApi({
    "GET /api/activities": () => ({ body: activities }),
    "GET /api/entries": () => ({ body: current ? [current] : [] }),
    [`PUT /api/entries/${todayIso()}`]: ({ body }) => {
      const b = body as { courbatures?: number | null; malade?: boolean | null; note?: string | null; sessions?: { activity_id: number; rpe: number | null }[] };
      const next = { ...(current ?? entry({ date: todayIso() })) };
      if ("courbatures" in b) next.courbatures = b.courbatures ?? null;
      if ("malade" in b) next.malade = b.malade ?? null;
      if ("note" in b) next.note = b.note ?? null;
      for (const s of b.sessions ?? []) {
        next.sessions = next.sessions.filter((x) => x.activity_id !== s.activity_id);
        if (s.rpe !== null) next.sessions.push({ activity_id: s.activity_id, rpe: s.rpe, sport: "trail_running", duration_min: 125 });
      }
      current = next;
      return { body: next };
    },
  });
  return api;
}

describe("Saisie du soir : nutrition de la sortie longue", () => {
  it("propose la nutrition uniquement pour une sortie de plus de 2 h 30 et l'enregistre", async () => {
    const long = activity({ id: 21, duration_min: 200, distance_km: 28, rpe: null });
    const short = activity({ id: 22, duration_min: 60, rpe: null });
    const api = mockApi({
      "GET /api/activities": () => ({ body: [long, short] }),
      "GET /api/entries": () => ({ body: [] }),
      "GET /api/fueling/series": () => ({ body: { min_hours: 2, points: [], missing: 0, evidence: { level: "indicatif", summary: "x" } } }),
      "POST /api/fueling": () => ({ status: 201, body: {} }),
    });
    renderWithApp(<EveningEntryWidget {...widgetProps({ day: "today" })} />);
    const form = await screen.findByRole("form", { name: "Nutrition de la sortie 21" });
    expect(screen.queryByRole("form", { name: "Nutrition de la sortie 22" })).toBeNull();
    await userEvent.type(screen.getByLabelText("Glucides (g/h)"), "65");
    await userEvent.click(screen.getByRole("button", { name: "Score digestif : 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => { expect(api.callsTo("POST /api/fueling")).toHaveLength(1); });
    expect(api.callsTo("POST /api/fueling")[0]?.body).toEqual({ activity_id: 21, glucides_g_par_h: 65, score_digestif: 2 });
    expect(form).toBeInTheDocument();
  });

  it("la saisie du soir reste utilisable si la nutrition est indisponible", async () => {
    mockApi({
      "GET /api/activities": () => ({ body: [activity({ id: 21, duration_min: 200, rpe: null })] }),
      "GET /api/entries": () => ({ body: [] }),
      "GET /api/fueling/series": () => ({ status: 500, body: { detail: "panne" } }),
    });
    renderWithApp(<EveningEntryWidget {...widgetProps({ day: "today" })} />);
    expect(await screen.findByRole("button", { name: /Effort perçu \(RPE\).* : 6$/ })).toBeInTheDocument();
  });
});

describe("Saisie du soir", () => {
  it("un tap sur le RPE d'une séance l'enregistre aussitôt, un second tap l'efface", async () => {
    const api = entryServer(null);
    renderWithApp(<EveningEntryWidget {...widgetProps({ day: "today" })} />);
    const six = await screen.findByRole("button", { name: /Effort perçu \(RPE\).* : 6$/ });
    expect(six).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(six);
    await waitFor(() => { expect(six).toHaveAttribute("aria-pressed", "true"); });
    expect(await screen.findByText("Enregistré ✓")).toBeInTheDocument();
    expect(api.callsTo(`PUT /api/entries/${todayIso()}`)[0]?.body).toEqual({ sessions: [{ activity_id: 11, rpe: 6 }] });

    await userEvent.click(six); // même valeur : efface
    await waitFor(() => { expect(six).toHaveAttribute("aria-pressed", "false"); });
    expect(api.callsTo(`PUT /api/entries/${todayIso()}`)[1]?.body).toEqual({ sessions: [{ activity_id: 11, rpe: null }] });
  });

  it("courbatures, malade et note sont envoyés séparément (champs fournis seulement)", async () => {
    const api = entryServer(null);
    renderWithApp(<EveningEntryWidget {...widgetProps({ day: "today" })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Courbatures : 4" }));
    await userEvent.click(screen.getByRole("button", { name: "Malade" }));
    const note = screen.getByPlaceholderText("Sensations, sommeil, douleurs…");
    await userEvent.type(note, "  mollets tendus ");
    fireEvent.blur(note);
    await waitFor(() => { expect(api.callsTo(`PUT /api/entries/${todayIso()}`)).toHaveLength(3); });
    expect(api.callsTo(`PUT /api/entries/${todayIso()}`).map((c) => c.body)).toEqual([
      { courbatures: 4 },
      { malade: true },
      { note: "mollets tendus" },
    ]);
    await waitFor(() => { expect(screen.getByRole("button", { name: "Malade" })).toHaveAttribute("aria-pressed", "true"); });
  });

  it("reprend la saisie existante du jour", async () => {
    entryServer(entry({ date: todayIso(), courbatures: 7, malade: true, note: "déjà noté", sessions: [{ activity_id: 11, rpe: 8, sport: "trail_running", duration_min: 125 }] }));
    renderWithApp(<EveningEntryWidget {...widgetProps({ day: "today" })} />);
    expect(await screen.findByRole("button", { name: "Courbatures : 7" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Effort perçu.* : 8$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Malade" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByDisplayValue("déjà noté")).toBeInTheDocument();
  });

  it("sans sortie ce jour-là : pas de RPE inventé, le reste reste saisissable", async () => {
    entryServer(null, []);
    renderWithApp(<EveningEntryWidget {...widgetProps({ day: "today" })} />);
    expect(await screen.findByText("Aucune sortie ce jour-là : pas de RPE à saisir.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Effort perçu/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Courbatures : 0" })).toBeInTheDocument();
  });

  it("plusieurs séances : une rangée de RPE par séance", async () => {
    entryServer(null, [activity({ id: 21, duration_min: 45 }), activity({ id: 22, sport: "strength_training", duration_min: 30 })]);
    renderWithApp(<EveningEntryWidget {...widgetProps({ day: "today" })} />);
    expect(await screen.findAllByRole("group", { name: /Effort perçu/ })).toHaveLength(2);
  });

  it("« Hier » interroge la veille", async () => {
    const api = mockApi({
      "GET /api/activities": () => ({ body: [] }),
      "GET /api/entries": () => ({ body: [] }),
    });
    renderWithApp(<EveningEntryWidget {...widgetProps({ day: "yesterday" })} />);
    await screen.findByText(/Aucune sortie/);
    const day = api.callsTo("GET /api/entries")[0]?.query.from;
    expect(day).toBeDefined();
    expect(day).not.toBe(todayIso());
  });

  it("erreur d'enregistrement : le message de l'API est affiché", async () => {
    mockApi({
      "GET /api/activities": () => ({ body: [] }),
      "GET /api/entries": () => ({ body: [] }),
      [`PUT /api/entries/${todayIso()}`]: () => ({ status: 422, body: { detail: "Impossible de saisir une date future." } }),
    });
    renderWithApp(<EveningEntryWidget {...widgetProps({ day: "today" })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Courbatures : 2" }));
    expect(await screen.findByText("Impossible de saisir une date future.")).toBeInTheDocument();
  });

  it("erreur de chargement", async () => {
    mockApi({ "GET /api/activities": () => ({ status: 500, body: { detail: "Panne" } }) });
    renderWithApp(<EveningEntryWidget {...widgetProps({ day: "today" })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Panne");
  });
});

describe("Note libre (markdown)", () => {
  it("note vide : mode édition ; sinon aperçu rendu avec bouton Modifier", async () => {
    const update = vi.fn();
    const { unmount } = renderWithApp(<NoteWidget {...widgetProps({ text: "", fontSize: "normal" }, update)} />);
    expect(screen.getByRole("textbox", { name: "Note libre" })).toBeInTheDocument();
    unmount();
    renderWithApp(<NoteWidget {...widgetProps({ text: "# Plan\n\n- **sortie** longue\n- [carte](https://exemple.org)", fontSize: "normal" }, update)} />);
    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "carte" })).toHaveAttribute("href", "https://exemple.org/");
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Modifier" }));
    expect(screen.getByRole("textbox", { name: "Note libre" })).toHaveValue("# Plan\n\n- **sortie** longue\n- [carte](https://exemple.org)");
  });

  it("enregistre le texte après un court délai et en quittant le champ", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const update = vi.fn();
    renderWithApp(<NoteWidget {...widgetProps({ text: "", fontSize: "normal" }, update)} />);
    const area = screen.getByRole("textbox", { name: "Note libre" });
    fireEvent.change(area, { target: { value: "bonjour" } });
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(update).toHaveBeenCalledWith({ text: "bonjour" });
    fireEvent.change(area, { target: { value: "bonjour tout le monde" } });
    fireEvent.blur(area);
    expect(update).toHaveBeenLastCalledWith({ text: "bonjour tout le monde" });
  });
});
