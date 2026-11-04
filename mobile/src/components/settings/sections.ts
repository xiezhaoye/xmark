/**
 * The settings popover's sections. A new setting is a new component here and
 * one entry in this list; the popover itself does not change its shape.
 *
 * @module components/settings/sections
 */
import type { ComponentType, ReactElement } from "react";
import type { t } from "../../i18n";
import { ModeSection } from "./ModeSection";
import { ShareSection } from "./ShareSection";
import { ServersSection } from "./ServersSection";

/** What the popover hands a section: shared chrome it may place inline. */
export interface SectionProps {
  /** The popover's one toast, raised by a section that needs to say something short. */
  toast?: ReactElement | null;
}


export interface SettingsSection {
  id: string;
  titleKey: Parameters<typeof t>[0];
  /**
   * Whether the popover prints `titleKey` above the section. Off for a section
   * whose own control already says what it is (the preview/source switch), so
   * the popover does not label it twice.
   */
  showsTitle: boolean;
  /** Every section receives the popover's props; the ones that need none accept none. */
  Component: ComponentType<SectionProps>;
}

/**
 * Reading order inside the popover: share, then the preview/source switch,
 * then the servers. The type size is NOT here any more — it floats over the
 * document (components/ReadingStepper).
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "share", titleKey: "settings.share", showsTitle: true, Component: ShareSection },
  { id: "mode", titleKey: "doc.preview", showsTitle: true, Component: ModeSection },
  { id: "servers", titleKey: "settings.servers", showsTitle: true, Component: ServersSection },
];
