import React from "react";
import HarnessSelect from "./HarnessSelect";
import HarnessIcon from "./HarnessIcon";
import { canChatInProject } from "./api.js";
import "./project-picker.css";

// 工作台的项目归属选择器。
//
// 新建对话可以不选项目：不选时这条对话属于平台，不绑定任何项目
// （后端 projectId 留空，侧栏归入「平台对话」）。选了项目才把当前
// 草稿切进那个项目，并让宿主顶栏跟着切。
export default function ProjectPicker({ chat }) {
  // 只列能发消息的项目：没加入的项目选了也发不出第一句，不如不出现。
  const options = [
    { value: "", label: "平台 · 不关联项目" },
    ...(chat.projects || [])
      .filter((project) => canChatInProject(project, chat.user))
      .map((project) => ({
        value: project.id,
        label: project.name,
        meta: project.key || "",
      })),
  ];
  const current = (chat.projects || []).find((p) => p.id === chat.projectId);
  return (
    <span className="project-context menu-anchor">
      <HarnessIcon
        name={chat.projectId ? "folder" : "globe"}
        size={13}
        interactive={false}
      />
      <HarnessSelect
        className="project-context-select"
        ariaLabel="对话归属项目"
        placeholder="平台 · 不关联项目"
        value={chat.projectId || ""}
        options={options}
        onChange={(event) => {
          const next = event.target.value || "";
          if (next === (chat.projectId || "")) return;
          // 只改这条对话的归属：不新开对话，也不动宿主顶栏的浏览范围
          //（移动会话时 app.js 会通过 agentflow-chat-project 把顶栏同步过去）。
          void chat.moveToProject(next);
        }}
      />
      {current?.key ? <span className="project-context-key">{current.key}</span> : null}
    </span>
  );
}
