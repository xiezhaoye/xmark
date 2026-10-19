/**
 * LocalServerRow — the "This Mac" radio in Settings → Servers.
 *
 * Purpose: the list of paired Macs has one row that is not a pairing — the
 * machine running this copy — and it is the first row, because "back to this
 * Mac" is how the remote mode is LEFT. It cannot be renamed, reordered or
 * removed: nothing about it is editable, only chosen.
 *
 * Key decisions:
 *   - **It looks EXACTLY like a paired Mac's row** — same height, same two-line
 *     layout, same radio mark, same status dot — or the list reads as a header
 *     plus rows instead of one set of choices. So it shows an address line too.
 *   - **The address is the Mac's own Tailscale name**, not a port: a remote row
 *     says `host:port` because that is how it is reached, while this Mac is not
 *     reached at all. `M1` above and `m1.tailc8e51.ts.net` below is the same
 *     shape as `Studio` / `m4.tailc8e51.ts.net:8740`, which is the point.
 *     Both halves are fixed strings: this row never probes anything.
 *   - **The dot is always green.** This Mac is, by definition, up — and asking
 *     the local server whether it is running would answer a question this row
 *     is not making: the row means "show this Mac's own documents", which works
 *     whether or not the pairing server is up.
 *   - **No refresh button**: there is no address to probe, and a disabled one
 *     would be a control that can never do anything.
 *   - It is a real radio (`role="radio"` in the list's `radiogroup`), so the
 *     arrow keys walk the whole list and Space/Enter selects, exactly as in the
 *     rows beside it. The row's BODY is the radio, as in `ServerRow`: the
 *     buttons a paired row puts on the right are what a `<li>`-wide hit area
 *     would have to dodge, and this row has none.
 *
 * @coordinates-with pages/settings/ServerRow.tsx — a paired Mac
 * @coordinates-with pages/settings/ServersSettings.tsx — the radiogroup
 * @module pages/settings/LocalServerRow
 */

import { useTranslation } from "react-i18next";
import { RadioMark } from "./ProviderRadio";
import { isImeKeyEvent } from "@/utils/imeGuard";

/** This Mac's Tailscale MagicDNS name, shown where a paired row shows its host. */
const LOCAL_ADDRESS = "m1.tailc8e51.ts.net";

export interface LocalServerRowProps {
  current: boolean;
  /** Tabbing stops only at the current row (roving tabindex). */
  tabbable: boolean;
  onSelect: () => void;
}

export function LocalServerRow({ current, tabbable, onSelect }: LocalServerRowProps) {
  const { t } = useTranslation("settings");
  const label = t("servers.local");

  return (
    <li className="server-row flex items-center gap-1 py-1">
      <div
        role="radio"
        aria-checked={current}
        aria-label={label}
        tabIndex={tabbable ? 0 : -1}
        className="server-row__body"
        onClick={onSelect}
        onKeyDown={(event) => {
          if (isImeKeyEvent(event)) return;
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <RadioMark checked={current} />
        <span className="min-w-0 flex-1">
          <span className="server-row__name">
            <span className="truncate text-sm font-medium text-[var(--text-color)]">{label}</span>
            <span
              className="server-row__status bg-[var(--success-color)]"
              role="img"
              aria-label={t("servers.status.online")}
              title={t("servers.status.online")}
            />
          </span>
          <span className="block truncate font-mono text-xs text-[var(--text-secondary)]">
            {LOCAL_ADDRESS}
          </span>
        </span>
        {current && <span className="sr-only">{t("servers.current")}</span>}
      </div>
    </li>
  );
}
