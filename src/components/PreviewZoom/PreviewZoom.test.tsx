/**
 * PreviewZoom — the −/100%/+ control and its arrow-key equivalent.
 *
 * Behaviour under test: the control and the keys drive ONE persisted value
 * (`appearance.previewZoom`), snapped to a 10% grid and clamped to 50–300; the
 * value button resets to 100; and the arrows stay out of the way of a caret.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSettingsStore } from "@/stores/settingsStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { PreviewZoomBar, clampPreviewZoom, usePreviewZoom } = await import("./PreviewZoom");

const zoom = () => useSettingsStore.getState().appearance.previewZoom;

/** Mount the control alone, and expose the resolved scale for assertions. */
function Harness() {
  const { scale } = usePreviewZoom();
  return (
    <div>
      <PreviewZoomBar />
      <output data-testid="scale">{scale}</output>
    </div>
  );
}

beforeEach(() => {
  useSettingsStore.setState((s) => ({ appearance: { ...s.appearance, previewZoom: 100 } }));
});

describe("clampPreviewZoom", () => {
  it("snaps to the 10% grid and clamps to the supported range", () => {
    expect(clampPreviewZoom(104)).toBe(100);
    expect(clampPreviewZoom(106)).toBe(110);
    expect(clampPreviewZoom(10)).toBe(50);
    expect(clampPreviewZoom(900)).toBe(300);
  });
});

describe("PreviewZoomBar", () => {
  it("shows the current zoom and steps it with the buttons", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole("button", { name: "preview.zoomReset" })).toHaveTextContent("100%");
    await user.click(screen.getByRole("button", { name: "preview.zoomIn" }));
    expect(zoom()).toBe(110);
    expect(screen.getByTestId("scale")).toHaveTextContent("1.1");

    await user.click(screen.getByRole("button", { name: "preview.zoomOut" }));
    expect(zoom()).toBe(100);
  });

  it("resets to 100% from the value button", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState((s) => ({ appearance: { ...s.appearance, previewZoom: 180 } }));
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "preview.zoomReset" }));
    expect(zoom()).toBe(100);
  });

  it("disables the button that would leave the range", () => {
    useSettingsStore.setState((s) => ({ appearance: { ...s.appearance, previewZoom: 300 } }));
    render(<Harness />);
    expect(screen.getByRole("button", { name: "preview.zoomIn" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "preview.zoomOut" })).toBeEnabled();
  });

  it("zooms with ← and → while the pane has focus", async () => {
    // Held keys are coalesced to one write per frame, so the assertion waits
    // for the frame instead of for a synchronous store write.
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    render(<Harness />);

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await nextFrame();
    expect(zoom()).toBe(110);

    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await nextFrame();
    // Two presses inside ONE frame still step twice: the pending value is read
    // back, not the stale store value.
    expect(zoom()).toBe(90);
  });

  it("leaves the arrows to a caret in the editor", () => {
    render(
      <>
        <Harness />
        <div contentEditable data-testid="editor" />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId("editor"), { key: "ArrowRight" });
    expect(zoom()).toBe(100);
  });

  it("ignores the key when a modifier is held", () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true });
    expect(zoom()).toBe(100);
  });
});
