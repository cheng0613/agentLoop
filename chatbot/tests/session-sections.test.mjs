import { test } from "vitest";
import assert from "node:assert/strict";
import { splitSidebarSections } from "../src/session-sections.js";

// 会话导航已从聊天侧栏移到宿主的左侧 rail。这些是它的数据语义：
// 「仅我参与的对话」只看共享会话里有没有我，自己发起的会话永远算我的。
const now = new Date().toISOString();
const projects = [{ id: "p1", name: "项目一" }, { id: "p2", name: "项目二" }];

const sessions = [
  {
    id: "mine",
    title: "我参与的项目会话",
    projectId: "p1",
    userId: "u2",
    shared: true,
    participants: [
      { id: "u1", name: "tester" },
      { id: "u2", name: "同事" },
    ],
    updatedAt: now,
    messages: [],
  },
  {
    id: "theirs",
    title: "同事独自发起的会话",
    projectId: "p1",
    userId: "u2",
    shared: true,
    participants: [{ id: "u2", name: "同事" }],
    updatedAt: now,
    messages: [],
  },
  {
    id: "own",
    title: "我自己发起的会话",
    projectId: "p2",
    userId: "u1",
    updatedAt: now,
    messages: [],
  },
];

const idsIn = (sections) => [
  ...sections.pinnedSessions.map((s) => s.id),
  ...sections.groups.flatMap((g) => g.sessions.map((s) => s.id)),
];

test("mineOnly keeps shared conversations the reader joined plus their own", () => {
  const all = splitSidebarSections(sessions, projects, {
    currentUserId: "u1",
    mineOnly: false,
  });
  assert.deepEqual(idsIn(all).sort(), ["mine", "own", "theirs"].sort());

  const mine = splitSidebarSections(sessions, projects, {
    currentUserId: "u1",
    mineOnly: true,
  });
  // 同事独自发起的那条没有我，被滤掉；我没被缓存进 participants 的旧会话
  // 按 userId 归属判断，所以自己发起的那条仍在。
  assert.deepEqual(idsIn(mine).sort(), ["mine", "own"].sort());
});

test("a pinned conversation is listed once, under 置顶", () => {
  const sections = splitSidebarSections(sessions, projects, {
    currentUserId: "u1",
    pinned: ["own"],
  });
  assert.deepEqual(
    sections.pinnedSessions.map((s) => s.id),
    ["own"]
  );
  assert.equal(idsIn(sections).filter((id) => id === "own").length, 1);
});
