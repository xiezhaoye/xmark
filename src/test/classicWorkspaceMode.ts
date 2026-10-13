/**
 * classicWorkspaceMode — puts the settings store into the classic (rail-off)
 * workspace model for suites written against that model.
 *
 * XMark ships with the workspace rail ON by default; these suites assert the
 * single-workspace routing that applies when it is off, so they opt into it
 * explicitly instead of depending on the default.
 *
 * @module test/classicWorkspaceMode
 */
import { useSettingsStore } from "@/stores/settingsStore";

/** Turn workspace rail mode off in the live settings store. */
export function setClassicWorkspaceMode(): void {
  useSettingsStore.setState((s) => ({ general: { ...s.general, workspaceRailMode: false } }));
}
