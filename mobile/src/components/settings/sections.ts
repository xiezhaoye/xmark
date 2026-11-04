/**
 * The settings popover's sections. A new setting is a new component here and
 * one entry in this list; the popover itself does not change its shape.
 *
 * @module components/settings/sections
 */
import type { ComponentType, ReactElement } from "react";
import type { t } from "../../i18n";
import { ReadingSection } from "./ReadingSection";
import { ServersSection } from "./ServersSection";
import { ShareSection } from "./ShareSection";

/** What the popover hands a section: shared chrome it may place inline. */
export interface SectionProps {
  /** The popover's one toast, raised by a section that needs to say something short. */
  toast?: ReactElement | null;
}


export interface SettingsSection {
  id: string;
  titleKey: Parameters<typeof t>[0];
  /** Every section receives the popover's props; the ones that need none accept none. */
  Component: ComponentType<SectionProps>;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "reading", titleKey: "settings.reading", Component: ReadingSection },
  { id: "share", titleKey: "settings.share", Component: ShareSection },
  { id: "servers", titleKey: "settings.servers", Component: ServersSection },
];
