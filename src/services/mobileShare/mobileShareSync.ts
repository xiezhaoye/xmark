/**
 * mobileShareSync — publishes the workspace groups for the mobile server.
 *
 * The iPhone reader may browse only the folders in the user's workspace
 * groups. The groups live in WebView localStorage, which the standalone
 * `xmark-mobile-server` cannot read, so every change is pushed to Rust's
 * `write_mobile_share`, which writes `<app data>/mobile-share.json`.
 *
 * Key decisions:
 *   - **Debounced, latest-wins.** A rename typed letter by letter or a drag
 *     produces many store writes; one push of the final state is enough.
 *   - **Repeats skipped here and in Rust.** Collapsing a section or a
 *     rehydrate in another window changes nothing the phone sees; skipping it
 *     keeps the server's mtime-driven reload quiet. Every window runs this,
 *     and identical pushes from several windows are harmless.
 *   - **A failed push is retried by the next change**, and logged.
 *
 * @coordinates-with src-tauri/src/mobile_share.rs — the command and file shape
 * @module services/mobileShare/mobileShareSync
 */
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceGroupsStore, type WorkspaceGroup } from "@/stores/workspaceGroupsStore";
import { workspaceWarn } from "@/utils/debug";

export const MOBILE_SHARE_DEBOUNCE_MS = 500;

function snapshot(groups: WorkspaceGroup[]): WorkspaceGroup[] {
  return groups.map(({ id, name, folders }) => ({ id, name, folders: [...folders] }));
}

export function startMobileShareSync(): () => void {
  let lastPushed: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const push = () => {
    timer = null;
    const groups = snapshot(useWorkspaceGroupsStore.getState().groups);
    const key = JSON.stringify(groups);
    if (key === lastPushed) return;
    lastPushed = key;
    invoke("write_mobile_share", { groups }).catch((err: unknown) => {
      lastPushed = null;
      workspaceWarn("Could not publish workspace groups for XMark Mobile:", err);
    });
  };

  const schedule = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(push, MOBILE_SHARE_DEBOUNCE_MS);
  };

  schedule();
  const unsubscribe = useWorkspaceGroupsStore.subscribe((state, prev) => {
    if (state.groups !== prev.groups) schedule();
  });

  return () => {
    disposed = true;
    unsubscribe();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
