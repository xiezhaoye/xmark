/**
 * classicWorkspaceModeHook — side-effect import: registers a top-level
 * `beforeEach` that puts the settings store into the classic (rail-off)
 * workspace model, for suites that assert that model and are size-frozen.
 *
 * @coordinates-with test/classicWorkspaceMode.ts — the setter it registers
 * @module test/classicWorkspaceModeHook
 */
import { beforeEach } from "vitest";
import { setClassicWorkspaceMode } from "./classicWorkspaceMode";

beforeEach(setClassicWorkspaceMode);
