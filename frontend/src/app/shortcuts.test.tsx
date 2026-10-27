import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isTypingTarget, pageIndexForKey, shortcutLabel, usePageShortcuts } from "./shortcuts";

const key = (k: string, extra: Partial<KeyboardEvent> = {}, target: EventTarget | null = document.body) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  target,
  ...extra,
});

describe("pageIndexForKey", () => {
  it("1 à 9 visent la page correspondante (index base 0)", () => {
    expect(pageIndexForKey(key("1"), 5)).toBe(0);
    expect(pageIndexForKey(key("5"), 5)).toBe(4);
    expect(pageIndexForKey(key("9"), 20)).toBe(8);
  });

  it("la rangée AZERTY & é \" ' ( - è _ ç à vise les pages 1 à 10", () => {
    const keys = ["&", "é", '"', "'", "(", "-", "è", "_", "ç", "à"];
    keys.forEach((k, i) => {
      expect(pageIndexForKey(key(k), 12)).toBe(i);
    });
    expect(pageIndexForKey(key("à"), 9)).toBeNull();
    expect(pageIndexForKey(key("é", { shiftKey: true }), 5)).toBeNull();
    expect(shortcutLabel(0)).toBe("&");
    expect(shortcutLabel(10)).toBeNull();
  });

  it("ignore les touches hors 1–9 et les pages inexistantes", () => {
    expect(pageIndexForKey(key("0"), 5)).toBeNull();
    expect(pageIndexForKey(key("a"), 5)).toBeNull();
    expect(pageIndexForKey(key("10"), 20)).toBeNull();
    expect(pageIndexForKey(key("6"), 5)).toBeNull();
    expect(pageIndexForKey(key("1"), 0)).toBeNull();
  });

  it("ignore les combinaisons avec modificateur et les répétitions", () => {
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) {
      expect(pageIndexForKey(key("2", extra), 5)).toBeNull();
    }
  });

  it("ne gêne pas la saisie de texte", () => {
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    for (const el of [input, area, select, editable]) {
      expect(isTypingTarget(el)).toBe(true);
      expect(pageIndexForKey(key("2", {}, el), 5)).toBeNull();
    }
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("usePageShortcuts", () => {
  function Harness({ count, goTo }: { count: number; goTo: (i: number) => void }) {
    usePageShortcuts(count, goTo);
    return <input aria-label="champ" />;
  }

  it("appelle goTo avec la page demandée", () => {
    const goTo = vi.fn();
    render(<Harness count={3} goTo={goTo} />);
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "4" }); // pas de 4e page
    expect(goTo.mock.calls).toEqual([[1], [2]]);
  });

  it("n'agit pas pendant la saisie dans un champ, ni avec Ctrl", () => {
    const goTo = vi.fn();
    const { getByLabelText } = render(<Harness count={3} goTo={goTo} />);
    fireEvent.keyDown(getByLabelText("champ"), { key: "1" });
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(goTo).not.toHaveBeenCalled();
  });

  it("se désabonne au démontage", () => {
    const goTo = vi.fn();
    const { unmount } = render(<Harness count={3} goTo={goTo} />);
    unmount();
    fireEvent.keyDown(window, { key: "1" });
    expect(goTo).not.toHaveBeenCalled();
  });
});
