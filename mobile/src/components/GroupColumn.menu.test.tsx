/**
 * The ⋯ menu's placement.
 *
 * Behaviour under test: it opens UNDER the ⋯ that opened it, as a portal to
 * <body> — inline in the rail it was painted after the last folder ("below
 * everything") and clipped by the rail's scroll box.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useReaderStore } from "../state/readerStore";
import { useLocalLibrary, DEFAULT_LOCAL_GROUP_ID, DEFAULT_LOCAL_GROUP_NAME } from "../state/localLibrary";
import { GroupColumn } from "./GroupColumn";

beforeEach(() => {
  localStorage.clear();
  useLocalLibrary.getState().setGroups([]);
  useReaderStore.setState({
    // The local source: groups here are the phone's own and carry no Mac.
    connection: { host: "local", port: 0, token: "", local: true },
    groups: [{ id: DEFAULT_LOCAL_GROUP_ID, name: DEFAULT_LOCAL_GROUP_NAME, folders: [] }],
    collapsedGroups: {},
    selectedRootId: null,
    groupsError: null,
  });
});

afterEach(() => cleanup());

describe("GroupColumn ⋯ menu", () => {
  it("opens as a fixed portal pinned just under its button", () => {
    render(<GroupColumn />);
    const trigger = document.querySelector(".group-more") as HTMLElement;
    // jsdom has no layout: give the trigger a rect so the anchor is meaningful.
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 100, bottom: 128, left: 20, right: 44, width: 24, height: 28, x: 20, y: 100, toJSON: () => ({}),
    } as DOMRect);

    fireEvent.click(trigger);

    const menu = document.querySelector(".local-menu") as HTMLElement;
    expect(menu).not.toBeNull();
    // Portalled out of the rail.
    expect(menu.parentElement).toBe(document.body);
    // Pinned below the button, not appended after the folders.
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.top).toBe("132px"); // bottom (128) + 4
  });

  it("closes on a tap anywhere else", () => {
    render(<GroupColumn />);
    fireEvent.click(document.querySelector(".group-more") as HTMLElement);
    expect(document.querySelector(".local-menu")).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(document.querySelector(".local-menu")).toBeNull();
  });
});
