/**
 * Settings. For now the only setting is the list of servers, so that is what
 * the page is; the sections come from `settings/sections` so others can join it.
 *
 * @module components/SettingsPage
 */
import { useReaderStore } from "../state/readerStore";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { SETTINGS_SECTIONS } from "./settings/sections";

export function SettingsPage() {
  return (
    <div className="page">
      <header className="topbar">
        <button type="button" className="icon-button" aria-label={t("settings.back")} onClick={() => useReaderStore.getState().setView("reader")}>
          <Icon name="back" />
        </button>
        <h1 className="topbar-title">{t("settings.title")}</h1>
        <span className="icon-button" />
      </header>
      <div className="scroll settings">
        {SETTINGS_SECTIONS.map(({ id, titleKey, Component }) => (
          <section key={id} aria-labelledby={`settings-${id}`}>
            <h2 className="section-title" id={`settings-${id}`}>
              {t(titleKey)}
            </h2>
            <Component />
          </section>
        ))}
      </div>
    </div>
  );
}
