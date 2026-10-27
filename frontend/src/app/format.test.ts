import { describe, expect, it } from "vitest";
import {
  addDays,
  formatDuration,
  formatDurationS,
  formatKm,
  formatMeters,
  formatNumber,
  formatPace,
  formatSigned,
  formatSignedPct,
  isoDate,
  parseUtc,
} from "./format";

/** Intl met des espaces insécables fines : on les ramène à des espaces simples pour comparer. */
const n = (s: string): string => s.replace(/[\u202f\u00a0]/g, " ");

describe("formats", () => {
  it("une valeur absente s'affiche « — », jamais 0", () => {
    for (const f of [formatNumber, formatDuration, formatDurationS, formatKm, formatMeters, formatPace, formatSignedPct]) {
      expect(f(null)).toBe("—");
      expect(f(undefined)).toBe("—");
    }
    expect(formatSigned(null)).toBe("—");
  });

  it("durées", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(65)).toBe("1 h 05");
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(150.4)).toBe("2 h 30");
    expect(formatDurationS(3900)).toBe("1 h 05");
  });

  it("nombres, distances, dénivelés à la française", () => {
    expect(n(formatNumber(1234.5, 1))).toBe("1 234,5");
    expect(formatKm(12.34)).toBe("12,3 km");
    expect(n(formatMeters(1455))).toBe("1 455 m");
  });

  it("allure en minutes:secondes par km", () => {
    expect(formatPace(400)).toBe("6:40 /km");
    expect(formatPace(299.6)).toBe("5:00 /km");
    expect(formatPace(Number.NaN)).toBe("—");
  });

  it("variations avec vrai signe moins, zéro sans signe", () => {
    expect(n(formatSignedPct(12))).toBe("+12 %");
    expect(n(formatSignedPct(-3.4))).toBe("−3 %");
    expect(n(formatSignedPct(0.2))).toBe("0 %");
    expect(n(formatSignedPct(-8.25, 1))).toBe("−8,3 %");
    expect(formatSigned(-1.5, 1, "pt")).toBe("−1,5 pt");
    expect(formatSigned(0, 1, "pt")).toBe("0 pt");
  });

  it("dates locales", () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(parseUtc("2026-10-14T03:31:00").toISOString()).toBe("2026-10-14T03:31:00.000Z");
    expect(parseUtc("2026-10-14T03:31:00+02:00").toISOString()).toBe("2026-10-14T01:31:00.000Z");
  });
});
