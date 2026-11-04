/**
 * `mountsWysiwygEditor` — the gate that decides whether a large open reports
 * progress at all.
 *
 * Behaviour under test: only a path that dispatches to a format with a
 * `wysiwygComponent` (the markdown adapter) returns true, because `TiptapEditor`
 * is the ONLY caller of `endLoad`. A large HTML/PDF/code file that started the
 * indicator used to leave it in the status bar forever.
 */
import { describe, expect, it, vi } from "vitest";

const registry = vi.hoisted(() => ({
  dispatchEditor: vi.fn(),
}));
vi.mock("./registry", () => registry);

const { mountsWysiwygEditor } = await import("./openProgressGate");

describe("mountsWysiwygEditor", () => {
  it("is true for a format that declares a WYSIWYG surface", () => {
    registry.dispatchEditor.mockReturnValue({ id: "markdown", wysiwygComponent: () => Promise.resolve({}) });
    expect(mountsWysiwygEditor("/notes/plan.md")).toBe(true);
  });

  it("is false for a format without one — nothing would end the load", () => {
    registry.dispatchEditor.mockReturnValue({ id: "html", extensions: ["html"] });
    expect(mountsWysiwygEditor("/reports/big.html")).toBe(false);
  });

  it("falls back to the extension when the registry cannot answer", () => {
    registry.dispatchEditor.mockImplementation(() => {
      throw new Error("[formats] dispatchEditor: registry is empty");
    });
    // markdown IS the WYSIWYG family, so an unanswered lookup must not claim
    // "no editor" and clear an indicator the editor was about to clear.
    expect(mountsWysiwygEditor("/notes/plan.md")).toBe(true);
    expect(mountsWysiwygEditor("/reports/big.html")).toBe(false);
  });
});
