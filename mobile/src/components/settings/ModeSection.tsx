/**
 * Preview / source, as a section of the settings popover.
 *
 * It used to float above the document once the top bar had scrolled away; the
 * floating pill now carries the type size instead, so the switch lives here —
 * one tap further from the text, out of the reading area, and looks exactly
 * as it did there — the same two-tab switch, not a stretched copy of it. It is
 * offered only
 * for a document that HAS both renderings (markdown and HTML); every other
 * kind would show a switch whose other half does nothing.
 *
 * @module components/settings/ModeSection
 */
import { useReaderStore } from "../../state/readerStore";
import { ModeSwitch } from "../ModeSwitch";

export function ModeSection() {
  const doc = useReaderStore((s) => s.doc);
  const docState = useReaderStore((s) => s.docState);
  const isMarkdown = docState.status === "ready" && docState.content.kind === "markdown";
  const isHtml = docState.status === "ready" && /\.html?$/i.test(doc?.relPath ?? "");
  if (!isMarkdown && !isHtml) return null;
  return <ModeSwitch />;
}
