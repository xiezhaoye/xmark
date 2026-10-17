/**
 * The reader's shell: the drawer, the document beside it, and the search
 * and settings pages.
 *
 * The top bar lives inside the document's scroll area (see `DocumentView`).
 * Opening the drawer pushes the whole document (top bar included) right,
 * leaving a strip of it visible. In that state the drawer toggle, now in its
 * open state, sits at the strip's top; tapping it or anywhere on the strip
 * closes the drawer.
 *
 * @module App
 */
import { useEffect } from "react";
import { useReaderStore } from "./state/readerStore";
import { Drawer } from "./components/Drawer";
import { DocumentView } from "./components/DocumentView";
import { Icon } from "./components/Icon";
import { SearchPage } from "./components/SearchPage";
import { SettingsPage } from "./components/SettingsPage";
import { useDrawerGesture } from "./components/useDrawerGesture";
import { t } from "./i18n";

export function App() {
  const view = useReaderStore((s) => s.view);
  const { width, offset, dragging } = useDrawerGesture(view === "reader");

  useEffect(() => {
    void useReaderStore.getState().bootstrap();
  }, []);

  if (view === "settings") return <SettingsPage />;

  const open = offset > 0;
  const close = () => useReaderStore.getState().setDrawer(false);

  return (
    <div className="app">
      <Drawer width={width} offset={offset} dragging={dragging} />
      <div className={`main ${dragging ? "" : "animated"}`} style={{ transform: `translateX(${offset}px)` }} inert={open}>
        <DocumentView />
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
    </div>
  );
}
