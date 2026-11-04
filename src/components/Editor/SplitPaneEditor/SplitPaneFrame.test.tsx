/**
 * SplitPaneFrame — the split-pane layout's structure.
 *
 * The order and presence of the rows is the contract the real-engine
 * geometry test (splitPaneLayout.webkit.test.tsx) measures: banner, then the
 * header row, then the source | resize | preview body. These pin that
 * structure in jsdom so a reorder fails here before it fails in WebKit.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SplitPaneFrame } from "./SplitPaneFrame";

function frame(props: Partial<Parameters<typeof SplitPaneFrame>[0]> = {}) {
  const { container } = render(
    <SplitPaneFrame ariaLabel="Editor" formatId="html" sourceFraction={0.5} {...props} />,
  );
  return container.querySelector(".split-pane-editor") as HTMLElement;
}

const classesOf = (el: Element) => [...el.children].map((c) => c.className);

describe("SplitPaneFrame", () => {
  it("floats the controls over the body, taking no height", () => {
    const root = frame({
      header: <span>toggle</span>,
      source: <span>src</span>,
      resizeHandle: <div className="split-pane-editor__resize-handle" />,
      preview: <span>preview</span>,
    });
    // Nothing in flow above the body: the chrome is an overlay, so the reading
    // area starts at the very top — the same as the remote preview.
    expect(classesOf(root)).toEqual(["editor-overlay", "split-pane-editor__body"]);
    const overlay = root.querySelector(".editor-overlay") as HTMLElement;
    expect(overlay.querySelector(".editor-overlay__left")?.childElementCount).toBe(0);
    expect(overlay.querySelector(".editor-overlay__right")?.textContent).toBe("toggle");
    const body = root.querySelector(".split-pane-editor__body") as HTMLElement;
    expect(classesOf(body)).toEqual([
      "split-pane-editor__source",
      "split-pane-editor__resize-handle",
      "split-pane-editor__preview",
    ]);
  });

  it("renders no overlay when there are no controls", () => {
    const root = frame({ source: <span>src</span> });
    expect(root.querySelector(".editor-overlay")).toBeNull();
  });

  it("omits an empty pane slot, so single-pane modes keep one pane", () => {
    const root = frame({ header: <span>t</span>, preview: <span>p</span> });
    expect(root.querySelector(".split-pane-editor__source")).toBeNull();
    expect(root.querySelector(".split-pane-editor__preview")).not.toBeNull();
  });

  it("carries the label, the format id and the source share", () => {
    const root = frame({ sourceFraction: 0.3, formatId: "json" });
    expect(root.getAttribute("role")).toBe("group");
    expect(root.getAttribute("aria-label")).toBe("Editor");
    expect(root.dataset.formatId).toBe("json");
    expect(root.style.getPropertyValue("--split-pane-source-fraction")).toBe("0.3");
  });
});
