/**
 * Whether the camera is open, and the one way to leave it.
 *
 * The native scanner covers the screen with a live preview; Tauri's iOS
 * implementation draws no chrome of its own, so a user who opened it by mistake
 * had no way out. The screen is therefore ours: the camera runs in WINDOWED
 * mode — its preview is inserted BEHIND a transparent webview — and
 * `ScanScreen` paints the scrim, the reticle and the cancel button on top.
 *
 * Deliberately not a store for two booleans: `scanQrCode` and the overlay sit in
 * different parts of the tree, and a subscription is all they share.
 *
 * @module scan/scanSession
 */
type Listener = () => void;

let active = false;
const listeners = new Set<Listener>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** True while the camera is open and the overlay belongs on screen. */
export const isScanning = (): boolean => active;

export function setScanning(next: boolean): void {
  if (active === next) return;
  active = next;
  emit();
}

/** Subscribe to on/off changes; returns the unsubscribe. */
export function subscribeScanning(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
