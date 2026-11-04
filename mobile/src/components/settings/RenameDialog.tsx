/**
 * Renaming a local group or folder: a dialog, not a field wedged into the rail.
 *
 * A rail row is one line wide; editing in place pushed the name out of sight and
 * made the whole column reflow. The dialog owns the name, returns it, and the
 * caller writes it to the library.
 *
 * @module components/settings/RenameDialog
 */
import { useState } from "react";
import { t } from "../../i18n";
import { Modal } from "../Modal";

export function RenameDialog({
  title,
  initial,
  onCancel,
  onConfirm,
}: {
  title: string;
  initial: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Modal label={title} onClose={onCancel}>
      <form
        className="rename-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = value.trim();
          if (!trimmed) return;
          onConfirm(trimmed);
        }}
      >
        <h2 className="modal-title">{title}</h2>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={title}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <div className="modal-actions">
          <button type="button" className="button" onClick={onCancel}>
            {t("settings.cancel")}
          </button>
          <button type="submit" className="button primary" disabled={!value.trim()}>
            {t("settings.renameSave")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
