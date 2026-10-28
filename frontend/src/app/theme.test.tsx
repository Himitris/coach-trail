import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { applyStoredTheme, useTheme } from "./theme";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("thème clair / sombre", () => {
  it("applique le thème mémorisé au démarrage", () => {
    localStorage.setItem("coach-trail-theme", "dark");
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("bascule, l'applique sur la page et le mémorise", () => {
    localStorage.setItem("coach-trail-theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("light");
    act(() => { result.current[1](); });
    expect(result.current[0]).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("coach-trail-theme")).toBe("dark");
  });
});
