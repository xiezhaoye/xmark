/**
 * Whether a path's tab will mount the WYSIWYG editing surface.
 *
 * Purpose: the StatusBar's "Opening large file…" indicator is cleared by ONE
 * consumer — `TiptapEditor`, once its document is parsed and interactive. A
 * large file that opens on any other surface (HTML preview, PDF, code, CSV,
 * SVG split pane) therefore never clears it, and the indicator sits in the
 * status bar for the rest of the session. The gate belongs where the indicator
 * is STARTED, so the read is reported only when something will report its end.
 *
 * A format declares a WYSIWYG surface by registering `wysiwygComponent`; only
 * the markdown adapter does. `dispatchEditor` throws when the registry has not
 * been bootstrapped, and the indicator is cosmetic — an unanswered throw must
 * not cost the user their file open, so a failure reads as "no indicator".
 *
 * @coordinates-with services/navigation/fileOpen.ts — the size-gated open
 * @coordinates-with services/navigation/replaceTabWithFile.ts — the same gate
 * @coordinates-with components/Editor/TiptapEditor.tsx — the only endLoad caller
 * @module lib/formats/openProgressGate
 */

import { dispatchEditor } from "./registry";

/** True when `filePath` opens on a surface that will clear the load indicator. */
export function mountsWysiwygEditor(filePath: string): boolean {
  try {
    return dispatchEditor(filePath).wysiwygComponent !== undefined;
  } catch {
    return false;
  }
}
