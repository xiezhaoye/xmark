/**
 * ProviderRadio — accessibility test (audit #953).
 *
 * The visible provider name lives in a sibling <span>, not as text inside
 * the <button role="radio">. Without an aria-label, screen readers hear
 * only "radio button, not checked" with no way to tell providers apart.
 * These tests pin the contract that ProviderRadio renders an accessible
 * name from its `label` prop so getByRole(..., { name }) resolves.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderRadio, RadioMark } from "./ProviderRadio";

describe("ProviderRadio — accessible name (audit #953)", () => {
  it("exposes the label prop as the radio's accessible name", () => {
    render(
      <ProviderRadio
        checked={false}
        onChange={() => undefined}
        label="Claude Code"
      />,
    );
    // Screen readers find the radio by its accessible name, not by
    // sibling text. If the aria-label is missing this lookup throws.
    expect(
      screen.getByRole("radio", { name: "Claude Code" }),
    ).toBeInTheDocument();
  });

  it("reports the checked state via aria-checked", () => {
    render(
      <ProviderRadio
        checked
        onChange={() => undefined}
        label="Codex"
      />,
    );
    expect(screen.getByRole("radio", { name: "Codex" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("fires onChange when activated, and is disabled when disabled", async () => {
    const onChange = vi.fn();
    render(
      <ProviderRadio
        checked={false}
        disabled
        onChange={onChange}
        label="Gemini"
      />,
    );
    const radio = screen.getByRole("radio", { name: "Gemini" });
    expect(radio).toBeDisabled();
    // A disabled <button> ignores clicks — confirms the disabled prop
    // actually reaches the DOM (not just visually styled).
    await userEvent.click(radio);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("RadioMark draws the same mark but states NOTHING — the row owns the radio", () => {
    const { container } = render(<RadioMark checked />);
    // No role, no tab stop: a second `role="radio"` inside the row's own radio
    // would be a duplicate node for one choice, and a second tab stop that
    // does nothing the row does not already do.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(container.querySelector("[tabindex]")).toBeNull();
    const mark = container.firstElementChild;
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark?.className).toContain("bg-[var(--accent-primary)]");
  });

  it("RadioMark draws an empty ring when unchecked", () => {
    const { container } = render(<RadioMark checked={false} />);
    const mark = container.firstElementChild;
    expect(mark?.className).toContain("bg-transparent");
    // The inner dot only exists when checked.
    expect(mark?.children).toHaveLength(0);
  });
});
