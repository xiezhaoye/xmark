/**
 * remoteSessionStore — which server THIS window is looking at.
 *
 * Key decisions:
 *   - **Session-only, and always starts on this Mac.** The window is a view of
 *     one server at a time; persisting the choice would mean a window that
 *     reopens onto another machine's tree after a restart, before the server
 *     has answered — and the safe default is always "this Mac".
 *   - **Separate from `remoteServersStore`.** The list of paired servers is
 *     shared and durable; the selection is neither. Keeping them apart is what
 *     lets the settings page and the switcher read one and write the other
 *     without a rehydrate clobbering a live choice.
 *   - **Switching never touches local state.** Local tabs, unsaved edits and
 *     the sidebar live in their own stores; selecting a remote server only
 *     changes what the shell RENDERS. Nothing local is saved, moved or closed,
 *     so switching back restores the same window it left (the render surfaces
 *     are conditionally mounted, and the document store outlives them).
 *   - **Per-window.** A Map keyed by window label, like the tab store, so two
 *     windows can look at two different Macs.
 *
 * @coordinates-with components/WorkspaceRail/ServerSwitcher.tsx — the picker
 * @coordinates-with stores/remoteServersStore.ts — the list it chooses from
 * @module stores/remoteSessionStore
 */

import { create } from "zustand";

interface RemoteSessionState {
  /** window label → the chosen remote server id; absent means this Mac. */
  active: Record<string, string | null>;
  /** The server a window shows, or null for this Mac. */
  getActive: (windowLabel: string) => string | null;
  /** Point a window at a server id, or at this Mac (`null`). */
  setActive: (windowLabel: string, serverId: string | null) => void;
  /** Forget a window's choice (its window closed, or the server was deleted). */
  clear: (windowLabel: string) => void;
}

export const useRemoteSessionStore = create<RemoteSessionState>()((set, get) => ({
  active: {},
  getActive: (windowLabel) => get().active[windowLabel] ?? null,
  setActive: (windowLabel, serverId) =>
    set((s) => ({ active: { ...s.active, [windowLabel]: serverId } })),
  clear: (windowLabel) =>
    set((s) => {
      if (!(windowLabel in s.active)) return s;
      const { [windowLabel]: _gone, ...rest } = s.active;
      return { active: rest };
    }),
}));
