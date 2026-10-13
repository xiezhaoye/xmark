import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollapsedColumnStrip } from "./CollapsedColumnStrip";

describe("CollapsedColumnStrip", () => {
  it("the whole strip is one expand control", async () => {
    const onExpand = vi.fn();
    render(<CollapsedColumnStrip expandLabel="Expand Files" onExpand={onExpand} />);

    const strip = screen.getByRole("button", { name: "Expand Files" });
    expect(strip).toHaveAttribute("aria-expanded", "false");
    expect(strip).toHaveAttribute("title", "Expand Files");
    expect(screen.getAllByRole("button")).toHaveLength(1);

    await userEvent.click(strip);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
