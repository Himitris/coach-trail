import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "./OfflineBanner";

afterEach(() => { vi.restoreAllMocks(); });

const setOnline = (value: boolean) => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
  act(() => { window.dispatchEvent(new Event(value ? "online" : "offline")); });
};

describe("Bandeau hors ligne", () => {
  it("n'apparaît que sans réseau et disparaît au retour", () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    setOnline(false);
    expect(screen.getByRole("status")).toHaveTextContent("Hors ligne");
    setOnline(true);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
