/**
 * The settings page's sections. A new setting is a new component here and one
 * entry in this list; the page itself does not change. While there is a single
 * section the page shows it directly; with several, the page can become a list
 * of sections that each open on their own screen.
 *
 * @module components/settings/sections
 */
import type { ComponentType } from "react";
import type { t } from "../../i18n";
import { ReadingSection } from "./ReadingSection";
import { ServersSection } from "./ServersSection";

export interface SettingsSection {
  id: string;
  titleKey: Parameters<typeof t>[0];
  Component: ComponentType;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "servers", titleKey: "settings.servers", Component: ServersSection },
  { id: "reading", titleKey: "settings.reading", Component: ReadingSection },
];
