import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import GlassFolder from "../src/GlassFolder.jsx";
import { folderTexture, mulberry32 } from "../src/glass-folder-engine.js";

const files = [
  { id: "a", name: "Cover — final", meta: "PNG · 4.8 MB", tone: "ember" },
  { id: "b", name: "Moodboard", meta: "24 images", tone: "dusk" },
  { id: "c", name: "Brief.pdf", meta: "PDF · 1.2 MB", tone: "paper" },
];

describe("GlassFolder", () => {
  test("seeded generator is deterministic", () => {
    const first = mulberry32(7);
    const second = mulberry32(7);
    const a = [first(), first(), first()];
    const b = [second(), second(), second()];
    expect(a).toEqual(b);
    expect(a.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  test("texture cache survives a missing 2D context", () => {
    // jsdom has no canvas backend; the engine must fall back, not throw.
    expect(folderTexture("aurora", 340, 272)).toBeNull();
    expect(folderTexture("aurora", 340, 272)).toBeNull();
  });

  test("closed folders keep their files out of the tab order and open on click", async () => {
    const user = userEvent.setup();
    render(<GlassFolder title="My Files" files={files} />);

    const toggle = screen.getByRole("button", { name: "展开 My Files" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Closed: no readable panel, and the decorative sheet text is hidden.
    expect(screen.queryByRole("group", { name: "My Files 的文件" })).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = await screen.findByRole("group", { name: "My Files 的文件" });
    expect(within(panel).getByRole("button", { name: /Moodboard/ })).toBeInTheDocument();
    const onSelect = vi.fn();
    render(<GlassFolder title="Second" files={files} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "展开 Second" }));
    const secondPanel = await screen.findByRole("group", { name: "Second 的文件" });
    await user.click(within(secondPanel).getByRole("button", { name: /Moodboard/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  });

  test("adds a sheet and keeps at most four", async () => {
    const user = userEvent.setup();
    render(<GlassFolder title="My Files" files={files} />);
    const stage = screen.getByRole("button", { name: "展开 My Files" }).closest(".glass-folder");
    const add = within(stage).getByRole("button", { name: "添加纸张" });
    for (let i = 0; i < 3; i += 1) await user.click(add);
    // The label counts the sheets that are actually on the stack.
    expect(within(stage).getByText("4 files")).toBeInTheDocument();
  });

  test("the more menu exposes open / add / reset and Esc returns focus", async () => {
    const user = userEvent.setup();
    render(<GlassFolder title="My Files" files={files} />);
    const stage = screen.getByRole("button", { name: "展开 My Files" }).closest(".glass-folder");
    const more = within(stage).getByRole("button", { name: "My Files 更多操作" });
    await user.click(more);
    const menu = screen.getByRole("menu", { name: "My Files 操作" });
    expect(within(menu).getByRole("menuitem", { name: "Reset contents" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(more).toHaveFocus();
  });
});
