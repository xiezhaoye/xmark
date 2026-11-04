/**
 * The reader's shell: the drawer, the document beside it, and the popover
 * and overlay the top bar can open.
 *
 * The top bar lives inside the document's scroll area (see `DocumentView`).
 * Opening the drawer pushes the whole document (top bar included) right,
 * leaving a strip of it visible. In that state the drawer toggle, now in its
 * open state, sits at the strip's top; tapping it or anywhere on the strip
 * closes the drawer.
 *
 * Settings is a popover anchored to its own icon, not a page: the document
 * stays mounted underneath — position, zoom and loaded content included — and
 * the popover sits above the drawer when the drawer happens to be open. It
 * closes on the icon, a tap anywhere outside it, Escape, or its Back row, and
 * every one of those hands focus back to the icon. Search is still a page of
 * its own, because it needs the whole screen.
 *
 * @module App
 */
import { useEffect, useRef } from "react";
import { useReaderStore } from "./state/readerStore";
import { Drawer } from "./components/Drawer";
import { DocumentView } from "./components/DocumentView";
import { ScanScreen } from "./components/ScanScreen";
import { Icon } from "./components/Icon";
import { SearchPage } from "./components/SearchPage";
import { SettingsPopover } from "./components/settings/SettingsPopover";
import { useDrawerGesture } from "./components/useDrawerGesture";
import { t } from "./i18n";

export function App() {
  const view = useReaderStore((s) => s.view);
  const { width, offset, dragging } = useDrawerGesture(view === "reader");
  const settingsButton = useRef<HTMLButtonElement>(null);
  const settingsOpen = view === "settings";

  useEffect(() => {
    void useReaderStore.getState().bootstrap();
  }, []);

  // A tap anywhere outside the open popover closes it. The icon is excluded:
  // a tap there is the toggle, no matter which happens first.
  useEffect(() => {
    if (!settingsOpen) return;
    useReaderStore.getState().setDrawer(false);
    // `Event`, not `PointerEvent`: the same handler is on touchstart (see below).
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      // A sheet a section opened (the drawer's server picker) is part of settings.
      const inside = (target as Element).closest?.(".settings-popover, .server-sheet-backdrop");
      const icon = settingsButton.current?.contains(target);
      if (inside || icon) return;
      useReaderStore.getState().setView("reader");
    };
    // `pointerdown` alone is not enough: the document's scroller calls
    // `preventDefault()` on touchstart (to stop rubber-banding), which
    // suppresses the pointer event derived from that touch — so a tap on the
    // text left the popover up. Both are listened to; the handler is
    // idempotent.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("touchstart", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("touchstart", onPointerDown, true);
    };
  }, [settingsOpen]);

  const closeSettings = () => {
    useReaderStore.getState().setView("reader");
    settingsButton.current?.focus();
  };

  const toggleSettings = () => {
    if (settingsOpen) closeSettings();
    else useReaderStore.getState().setView("settings");
  };

  const open = offset > 0;
  const close = () => useReaderStore.getState().setDrawer(false);

  return (
    <div className="app">
      <Drawer width={width} offset={offset} dragging={dragging} />
      <div className={`main ${dragging ? "" : "animated"}`} style={{ transform: `translateX(${offset}px)` }} inert={open}>
        <DocumentView settingsButton={settingsButton} onSettings={toggleSettings} settingsOpen={settingsOpen} />
      </div>
      {open && (
        <div className="main-strip" style={{ left: offset }} onClick={close}>
          <button
            type="button"
            className="icon-button strip-toggle"
            aria-label={t("drawer.close")}
            aria-expanded={true}
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
          >
            <Icon name="drawerOpen" />
          </button>
        </div>
      )}
      {view === "search" && (
        <div className="overlay-page">
          <SearchPage />
        </div>
      )}
      {settingsOpen && <SettingsPopover anchor={() => settingsButton.current} onClose={closeSettings} />}
      {/* Above everything, including the popover: the camera is the whole task. */}
      <ScanScreen />
    </div>
  );
}
