/**
 * The left drawer: groups and folders beside the selected folder's tree,
 * opened and closed as one unit. Its position comes from `useDrawerGesture`
 * so the document can move with it.
 *
 * @module components/Drawer
 */
import { t } from "../i18n";
import { GroupColumn } from "./GroupColumn";
import { TreeColumn } from "./TreeColumn";

export function Drawer({ width, offset, dragging }: { width: number; offset: number; dragging: boolean }) {
  const visible = offset > 0;
  return (
    <aside
      className={`drawer ${dragging ? "" : "animated"}`}
      style={{ width, transform: `translateX(${offset - width}px)` }}
      aria-hidden={!visible}
      aria-label={t("drawer.groups")}
      inert={!visible}
    >
      <div className="drawer-col drawer-groups">
        <div className="scroll">
          <GroupColumn />
        </div>
      </div>
      <div className="drawer-col drawer-tree">
        <TreeColumn />
      </div>
    </aside>
  );
}
