// @vitest-environment jsdom
/**
 * setupWebglRenderer — suspend/resume of the WebGL renderer for hidden
 * terminals. A terminal hidden behind another session (or another workspace)
 * releases its WebGL addon — GPU context, canvases and its claim on the shared
 * glyph atlas — and gets a fresh one when it is shown again. The buffer and the
 * shell are untouched: xterm keeps them in the Terminal, not in the renderer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { addons } = vi.hoisted(() => ({
  addons: [] as Array<{
    dispose: ReturnType<typeof vi.fn>;
    clearTextureAtlas: ReturnType<typeof vi.fn>;
    contextLoss: Array<() => void>;
  }>,
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    dispose = vi.fn();
    clearTextureAtlas = vi.fn();
    contextLoss: Array<() => void> = [];
    constructor() {
      addons.push(this);
    }
    onContextLoss(cb: () => void) {
      this.contextLoss.push(cb);
      return { dispose: vi.fn() };
    }
  },
}));

vi.mock("@/utils/debug", () => ({ terminalLog: vi.fn() }));

import type { Terminal } from "@xterm/xterm";
import { setupWebglRenderer } from "./setupWebglRenderer";

function makeTerm() {
  return {
    rows: 24,
    loadAddon: vi.fn(),
    refresh: vi.fn(),
  };
}

function setup(enabled = true) {
  const term = makeTerm();
  const container = document.createElement("div");
  const handle = setupWebglRenderer({
    term: term as unknown as Terminal,
    container,
    enabled,
  });
  return { term, container, handle };
}

describe("setupWebglRenderer suspend/resume", () => {
  beforeEach(() => {
    addons.length = 0;
  });

  it("suspend disposes the live WebGL addon", () => {
    const { handle } = setup();
    expect(addons).toHaveLength(1);

    handle.suspend();

    expect(addons[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("resume attaches a fresh addon and repaints the viewport", () => {
    const { term, handle } = setup();
    handle.suspend();
    term.loadAddon.mockClear();

    handle.resume();

    expect(addons).toHaveLength(2);
    expect(term.loadAddon).toHaveBeenCalledWith(addons[1]);
    expect(term.refresh).toHaveBeenCalledWith(0, 23);
  });

  it("suspend and resume are idempotent", () => {
    const { handle } = setup();
    handle.suspend();
    handle.suspend();
    expect(addons[0].dispose).toHaveBeenCalledTimes(1);

    handle.resume();
    handle.resume();
    expect(addons).toHaveLength(2);
  });

  it("resume on a running renderer does nothing", () => {
    const { handle } = setup();
    handle.resume();
    expect(addons).toHaveLength(1);
    expect(addons[0].dispose).not.toHaveBeenCalled();
  });

  it("does nothing when WebGL is disabled", () => {
    const { term, handle } = setup(false);
    handle.suspend();
    handle.resume();
    expect(addons).toHaveLength(0);
    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it("does not resurrect WebGL after a context loss fell back to the DOM renderer", () => {
    const { handle } = setup();
    addons[0].contextLoss[0]();

    handle.suspend();
    handle.resume();

    expect(addons).toHaveLength(1);
  });

  it("a suspended terminal neither clears the shared atlas nor receives the broadcast", () => {
    const a = setup();
    const b = setup();
    b.handle.suspend();
    const bFirst = addons[1];

    a.handle.resetDisplay();

    expect(addons[0].clearTextureAtlas).toHaveBeenCalledTimes(1);
    // The suspended terminal holds no addon, so nothing of it is touched.
    expect(bFirst.clearTextureAtlas).not.toHaveBeenCalled();
    expect(b.term.refresh).not.toHaveBeenCalled();
  });

  it("a resumed terminal rejoins the atlas-clear broadcast", () => {
    const a = setup();
    const b = setup();
    b.handle.suspend();
    b.handle.resume();
    const bSecond = addons[2];

    a.handle.resetDisplay();

    expect(bSecond.clearTextureAtlas).toHaveBeenCalledTimes(1);
  });

  it("cleanup after suspend does not dispose the addon a second time", () => {
    const { handle } = setup();
    handle.suspend();
    handle.cleanup();
    expect(addons[0].dispose).toHaveBeenCalledTimes(1);
  });
});
