/**
 * createTerminalSession — THE owner-aware creation service (audit 20260831
 * #17/#20).
 *
 * Purpose: every production creator of a terminal session goes through this
 * one function, so "resolve the owner, stamp the options" cannot drift
 * between call sites — the panel/init auto-create, the tab bar's +,
 * "Open Terminal Here", and Run-in-Terminal's reuse-or-create all did it by
 * hand before. `canCreateTerminalSessionHere` is the AUTHORITATIVE can-create
 * predicate: it computes the same creation-time union (D-T5) the store's cap
 * gate applies (per-scope union and window-wide total), owner included, so a
 * UI gate can never say yes while creation says no.
 *
 * @coordinates-with stores/terminalStore/sessionActions.ts — terminalCreateSession + creationUnion
 * @coordinates-with resolveTerminalOwnerInstanceId.ts — the D-T1 carve-outs
 * @module services/terminal/createTerminalSession
 */
import { terminalCreationBlock } from "@/stores/terminalStore/sessionActions";
import { useTerminalStore, type TerminalSession } from "@/stores/terminalStore";
import { resolveTerminalOwnerInstanceId } from "./resolveTerminalOwnerInstanceId";

/** Whether a session created NOW in this window would pass both cap gates —
 *  the SAME decision the store applies, owner and all (never a bare count). */
export function canCreateTerminalSessionHere(windowLabel: string): boolean {
  const owner = resolveTerminalOwnerInstanceId(windowLabel);
  return terminalCreationBlock(useTerminalStore.getState().sessions, owner) === null;
}

/** Create a session in the active scope (owner stamped per D-T1's carve-outs).
 *  Returns null at the creation-union cap, exactly like the store action. */
export function createTerminalSessionInScope(
  windowLabel: string,
  options?: { requestedCwd?: string },
): TerminalSession | null {
  const owner = resolveTerminalOwnerInstanceId(windowLabel);
  return useTerminalStore.getState().terminalCreateSession({
    ...(options?.requestedCwd ? { requestedCwd: options.requestedCwd } : {}),
    ...(owner ? { ownerInstanceId: owner } : {}),
  });
}
