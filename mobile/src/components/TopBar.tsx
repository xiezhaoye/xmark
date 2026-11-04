/**
 * The reader's top bar: drawer toggle (closed state), document title,
 * search, settings. The preview/source switch is not here: it appears only
 * once this bar has scrolled away (see `DocumentView`).
 *
 * It is the first thing inside the document's scroll area, so it scrolls away
 * with the text and leaves the whole screen to the document.
 *
 * While the drawer is open the whole bar slides right with the document, and
 * the open-state toggle sits in the exposed strip instead (see `App`).
 *
 * The settings button is the popover's anchor: it carries the ref, reports
 * whether the popover is up, and forwards its taps so the shell can toggle
 * instead of the outside-tap handler closing it twice.
 *
 * @module components/TopBar
 */
import type { RefObject } from "react";
import { useReaderStore } from "../state/readerStore";
import { t } from "../i18n";
import { Icon } from "./Icon";

export interface TopBarProps {
  settingsButton?: RefObject<HTMLButtonElement | null>;
  onSettings?: () => void;
  settingsOpen?: boolean;
}

export function TopBar({ settingsButton, onSettings, settingsOpen = false }: TopBarProps) {
  const doc = useReaderStore((s) => s.doc);
  const title = doc ? doc.relPath.split("/").pop() : t("app.title");
  const openSettings = onSettings ?? (() => useReaderStore.getState().setView("settings"));
  return (
    <header className="topbar">
      <button type="button" className="icon-button" aria-label={t("drawer.open")} aria-expanded={false} onClick={() => useReaderStore.getState().setDrawer(true)}>
        <Icon name="drawerClosed" />
      </button>
      <h1 className="topbar-title">{title}</h1>
      <button type="button" className="icon-button" aria-label={t("search.title")} onClick={() => useReaderStore.getState().setView("search")}>
        <Icon name="search" />
      </button>
      <button
        ref={settingsButton}
        type="button"
        className="icon-button"
        aria-label={t("settings.open")}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={openSettings}
      >
        <Icon name="settings" size={20} />
      </button>
    </header>
  );
}
