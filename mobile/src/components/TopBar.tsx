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
 * @module components/TopBar
 */
import { useReaderStore } from "../state/readerStore";
import { t } from "../i18n";
import { Icon } from "./Icon";

export function TopBar() {
  const doc = useReaderStore((s) => s.doc);
  const title = doc ? doc.relPath.split("/").pop() : t("app.title");
  return (
    <header className="topbar">
      <button type="button" className="icon-button" aria-label={t("drawer.open")} aria-expanded={false} onClick={() => useReaderStore.getState().setDrawer(true)}>
        <Icon name="drawerClosed" />
      </button>
      <h1 className="topbar-title">{title}</h1>
      <button type="button" className="icon-button" aria-label={t("search.title")} onClick={() => useReaderStore.getState().setView("search")}>
        <Icon name="search" />
      </button>
      <button type="button" className="icon-button" aria-label={t("settings.open")} onClick={() => useReaderStore.getState().setView("settings")}>
        <Icon name="settings" size={20} />
      </button>
    </header>
  );
}
