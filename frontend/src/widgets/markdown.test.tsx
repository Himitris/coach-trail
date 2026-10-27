import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown, parseBlocks, safeUrl } from "./markdown";

describe("Markdown simple", () => {
  it("titres, listes, gras, italique, code et liens", () => {
    const { container } = render(
      <Markdown
        source={[
          "# Titre",
          "",
          "Un **gras**, un *italique* et du `code`.",
          "",
          "- premier",
          "- deuxième",
          "",
          "1. un",
          "2. deux",
          "",
          "Voir [le site](https://exemple.org/page).",
        ].join("\n")}
      />,
    );
    expect(screen.getByRole("heading", { name: "Titre" })).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("gras");
    expect(container.querySelector("em")).toHaveTextContent("italique");
    expect(container.querySelector("code")).toHaveTextContent("code");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    const link = screen.getByRole("link", { name: "le site" });
    expect(link).toHaveAttribute("href", "https://exemple.org/page");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("n'exécute jamais de HTML ni de lien dangereux", () => {
    const { container } = render(
      <Markdown source={'<img src=x onerror="alert(1)"> <script>alert(2)</script>\n\n[piège](javascript:alert(3))'} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("<img src=x onerror=");
    expect(container).toHaveTextContent("piège"); // le texte reste, sans lien
  });

  it("safeUrl n'accepte que http et https", () => {
    expect(safeUrl("https://a.b/c")).toBe("https://a.b/c");
    expect(safeUrl("http://a.b")).toBe("http://a.b/");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://a.b", "pas une url", "//a.b"]) {
      expect(safeUrl(bad)).toBeNull();
    }
  });

  it("découpe en blocs : paragraphes sur plusieurs lignes, listes séparées, source vide", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("a\nb\n\nc")).toEqual([
      { kind: "paragraph", lines: ["a", "b"] },
      { kind: "paragraph", lines: ["c"] },
    ]);
    expect(parseBlocks("- x\n1. y")).toEqual([
      { kind: "list", ordered: false, items: ["x"] },
      { kind: "list", ordered: true, items: ["y"] },
    ]);
    expect(parseBlocks("### Petit")).toEqual([{ kind: "heading", level: 3, text: "Petit" }]);
  });
});
