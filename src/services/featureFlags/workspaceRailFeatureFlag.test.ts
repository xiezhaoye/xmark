// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { isWorkspaceRailEnabled } from "./workspaceRailFeatureFlag";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
  useSettingsStore.getState().resetSettings();
});

describe("workspace rail feature flag", () => {
  // XMark: the workspace rail is the first of three columns, so it is ON by default.
  it("is enabled by default", () => {
    expect(useSettingsStore.getState().general.workspaceRailMode).toBe(true);
    expect(isWorkspaceRailEnabled()).toBe(true);
  });

  it("reads the persisted general setting", () => {
    useSettingsStore.getState().updateGeneralSetting("workspaceRailMode", false);
    expect(isWorkspaceRailEnabled()).toBe(false);
  });

  it("resets to enabled", () => {
    useSettingsStore.getState().updateGeneralSetting("workspaceRailMode", false);
    useSettingsStore.getState().resetSettings();
    expect(isWorkspaceRailEnabled()).toBe(true);
  });
});
