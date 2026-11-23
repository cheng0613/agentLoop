import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChat } from "./useChat";
import NativeApprovalPanel from "./NativeApprovalPanel";
import { AgentBrowserLinks } from "./agent-browser-links.js";
import ActivityTrace, { ReplyTimeline } from "./ActivityTrace";
import MessageInfo from "./MessageInfo";
import GenerationDiagnostics from "./GenerationDiagnostics";
import { fullTime, messageSentAt, messageTimeLabel } from "./message-info.js";
import {
  activityForReply,
  finalReply,
  generationStored,
  hasTextSegments,
  streamingAnswerOpen,
} from "./activity";
import {
  api,
  attachmentURL,
  parseReply,
  collectArtifacts,
  visibleText,
  elapsedSeconds,
  formatElapsed,
  confirmationCaption,
  isProposalTimeout,
  canChatInProject,
  projectPickerOptions,
} from "./api";
import {
  RichContent,
  CopyButton,
  Attachment,
  ArtifactPreview,
  ImageLightbox,
} from "./RichContent";
import { DraftCard } from "./SidePanel";
import ArtifactPanel from "./ArtifactPanel";
import { useWorkspaceChanges } from "./useWorkspaceChanges";
import { localId } from "./local-id.js";
import RunAlerts from "./RunAlerts";
import { runProblems, useConversationRuns } from "./runs.js";
import { reconcileOperation, visibleSidebarArtifact } from "./platform.js";
import { isGeneratedArtifact, shouldRevealArtifactPanel } from "./artifact-autoreveal.js";
import { IconButton, Dialog, Menu, SelectMenu, CredentialAction } from "./ui";
import { CLIInstallAction } from "./cli-install.jsx";
import { credentialHint, openCredentialSettings } from "./credentials";
import { groupSessionHistory, scheduledSession, sessionProjectName } from "./session-history.js";
import { runSessionState, sessionReplyStatus, sessionTooltip, sidebarReplyStatus } from "./session-status.js";
import { unreadReply, useReadReplies } from "./session-unread.js";
import MentionPicker from "./MentionPicker";
import Participants, { Avatar, authorFor } from "./Participants";
import IssueContext from "./IssueContext";
import { mentionAt, insertMention } from "./mentions.js";
import { elementTitle } from "./element-context.js";
import HarnessIcon from "./HarnessIcon";
import QueuedMessages from "./QueuedMessages";
import "./message-queue.css";
import ConversationStatusIcon from "./ConversationStatusIcon";
import { useLocalConversations } from "./useLocalConversations.js";
import SessionContextMenu from "./SessionContextMenu";
import { usePanelPresence } from "./usePanelPresence";
import HomeWelcome from "./HomeWelcome";
import TaskBoard from "./TaskBoard";
import ModelPicker from "./ModelPicker";
import ModelProviderIcon, { hasProviderLogo } from "./ModelProviderIcon";
import PermissionPicker, { rememberApprovalMode, storedApprovalMode } from "./PermissionPicker";
import { conversationEngine, engineBrand } from "./engines.js";
import { effortOptions } from "./effort.js";
import QuickAccessWizard from "./QuickAccessWizard";
import HarnessSelect from "./HarnessSelect";
import SandboxPicker from "./SandboxPicker";
import ExecutionMachinePicker from "./ExecutionMachinePicker";
import { shouldRevealTitle, titleRevealTiming } from "./title-reveal.js";
import {
  THEME_KEY,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
} from "./theme.js";

const THEME_OPTIONS = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];
const environmentVisibilityKey = "agentflow.native-chat.environmentVisibility.v1";
function useTitleReveal(sessionId, title, revealId) {
  const lastRevealedId = useRef(null);
  const [reveal, setReveal] = useState(null);
  // A layout effect swaps in the per-character spans before the first paint,
  // so the new title never flashes as plain text first.
  useLayoutEffect(() => {
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const play = shouldRevealTitle({
      sessionId,
      revealId,
      lastRevealedId: lastRevealedId.current,
      reducedMotion,
    });
    // Leaving for the home page means the next arrival is a fresh opening.
    lastRevealedId.current = sessionId || null;
    if (!play) return;
    const timing = titleRevealTiming(title);
    setReveal({ id: sessionId, title, timing });
    const timer = setTimeout(() => setReveal(null), timing.total + 30);
    return () => {
      clearTimeout(timer);
      setReveal(null);
    };
  }, [sessionId, title, revealId]);
  return reveal && reveal.id === sessionId && reveal.title === title
    ? reveal.timing
    : null;
}

const homeStarters = [
  {
    id: "quick-access",
    icon: "sparkles",
    tone: "blue",
    title: "快速接入",
    description: "提供最低限度的鉴权与仓库，用默认角色与 SOP 立即开始。",
    steps: ["鉴权", "仓库", "默认 SOP"],
  },
  // New users asked how to hook up a test environment and how roles and SOPs
  // work; these two cards start a guided conversation instead of dropping them
  // on a settings page.
  {
    id: "environment",
    icon: "terminal",
    tone: "violet",
    title: "接入测试环境",
    description: "助手先查执行机器、镜像和沙箱，再按缺口一步步带你配好。",
    steps: ["执行机器", "镜像", "沙箱"],
    prompt:
      "带我一步步接入测试环境：先查看当前项目已有的执行机器、容器镜像、环境脚本和沙箱，告诉我还缺什么、按什么顺序配、每一步在哪里操作；能由你提交的配置，直接起草出来给我。",
  },
  {
    id: "sop",
    icon: "workflow",
    tone: "green",
    title: "选用 SOP 与角色",
    description: "了解产品、前端、后端三套交付 SOP 和其中的角色，按需求推荐一套。",
    steps: ["产品", "前端", "后端"],
    prompt:
      "我准备写需求了。平台内置的产品、前端、后端交付 SOP 分别适合什么场景、好在哪里、里面有哪些角色？请结合当前项目推荐一套，并告诉我怎么绑定和派发第一条需求。我的需求是：",
  },
];

const readJSON = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
function MessageTime({ messages, index }) {
  const date = messageSentAt(messages, index);
  if (!date) return null;
  return (
    <time
      className="message-time"
      dateTime={date.toISOString()}
      title={fullTime(date)}
    >
      {messageTimeLabel(date)}
    </time>
  );
}
function copiedReply(message, generation, live) {
  const steps = activityForReply(message, generation, live);
  const text = parseReply(message).message;
  return hasTextSegments(steps) ? finalReply(text, steps) : text;
}
function ReplyHeading({ message, steps }) {
  return (
    <div className="reply-heading">
      <ActivityTrace
        steps={steps}
        startedAt={message.startedAt}
        finishedAt={message.createdAt}
        interrupted={!!message.unfinished}
      />
    </div>
  );
}
function AssistantTurn({ message, steps, assets, projectId, sessionId, local, readOnly, onCLIInstall }) {
  const reply = parseReply(message);
  const answer = hasTextSegments(steps)
    ? finalReply(reply.message, steps)
    : message;
  return (
    <>
      {hasTextSegments(steps) ? (
        <ReplyTimeline
          steps={steps}
          startedAt={message.startedAt}
          finishedAt={message.createdAt}
        />
      ) : (
        <ReplyHeading message={message} steps={steps} />
      )}
      <div className="message-body">
        <RichContent message={answer} assets={assets} projectId={projectId} />
      </div>
      {message.failure && message.generationId && !local ? (
        <GenerationDiagnostics sessionId={sessionId} generationId={message.generationId} failure={message.failure} onCLIInstall={onCLIInstall} readOnly={readOnly} />
      ) : message.unfinished ? (
        <p className="reply-stopped">本轮未完成 · {message.unfinished}</p>
      ) : reply.stopped ? (
        <p className="reply-stopped">已停止，以上是停止前的内容。</p>
      ) : null}
    </>
  );
}
function LiveMessage({ live, generation, finished = false, local = false, readOnly = false }) {
  const steps = live.activity || [];
  const textual = hasTextSegments(steps);
  // A streamed paragraph followed by tool calls stays in the process above;
  // only the paragraph still being written shows as the answer.
  const answer =
    live.draftMessage ||
    (textual
      ? finished || streamingAnswerOpen(steps)
        ? finalReply(live.answer, steps)
        : ""
      : live.answer);
  return (
    <div
      className={`message assistant ${finished ? "interrupted" : "live"}`}
      aria-live="polite"
    >
      {textual ? (
        <ReplyTimeline
          steps={steps}
          startedAt={generation?.startedAt}
          finishedAt={generation?.updatedAt}
          live={!finished}
          interrupted={finished}
        />
      ) : (
        <div className="reply-heading">
          <ActivityTrace
            steps={steps}
            startedAt={generation?.startedAt}
            finishedAt={generation?.updatedAt}
            live={!finished}
            interrupted={finished}
          />
        </div>
      )}
      {answer ? <RichContent message={answer} /> : null}
      {!finished && !local && !readOnly && generation?.id ? <GenerationDiagnostics sessionId={generation.sessionId} generationId={generation.id} compact /> : null}
      {finished ? (
        <p className="reply-stopped">
          {generation?.status === "failed" && generation?.error
            ? generation.error
            : "已停止，以上是停止前的内容。"}
        </p>
      ) : null}
    </div>
  );
}

function readIssueMention() {
  const params = new URLSearchParams(location.search);
  const issueId = params.get("mentionIssue") || "";
  return issueId ? { issueId, projectId: params.get("projectId") || "" } : null;
}

// 角色页「发起会话」带过来的角色 ID。与 mentionIssue 同一套机制：
// 打开一个空白草稿，把角色写成 @ 引用并聚焦输入框。
function readRoleMention() {
  const params = new URLSearchParams(location.search);
  const roleId = params.get("mentionRole") || "";
  return roleId ? { roleId, projectId: params.get("projectId") || "" } : null;
}

export default function App() {
  const realChat = useChat();
  const chat = useLocalConversations(realChat);
  const sessionTitle = chat.session?.displayTitle || chat.session?.title || "新对话";
  const titleReveal = useTitleReveal(
    chat.session?.id,
    sessionTitle,
    chat.revealId,
  );
  const [panel, setPanel] = useState(false),
    [panelView, setPanelView] = useState("artifacts"),
    [artifactUnread, setArtifactUnread] = useState(0),
    [selectedArtifact, setSelectedArtifact] = useState(null),
    [menu, setMenu] = useState(null),
    [sessionContext, setSessionContext] = useState(null),
    [dialog, setDialog] = useState(null),
    [issueContextOpen, setIssueContextOpen] = useState(false),
    [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [mineOnly, setMineOnly] = useState(false),
    [pins, setPins] = useState({}),
    [text, setText] = useState(""),
    [attachments, setAttachments] = useState([]),
    [pendingAttachments, setPendingAttachments] = useState([]),
    [imagePreview, setImagePreview] = useState(null),
    [references, setReferences] = useState([]),
    [issueMention, setIssueMention] = useState(readIssueMention),
    [roleMention, setRoleMention] = useState(readRoleMention),
    [issueDraft, setIssueDraft] = useState(readIssueMention),
    [mention, setMention] = useState(null),
    [repositorySelections, setRepositorySelections] = useState({}),
    [uploading, setUploading] = useState(false),
    [runsRefresh, setRunsRefresh] = useState(0),
    [approvalSelection, setApprovalSelection] = useState(null),
    [quickAccessOpen, setQuickAccessOpen] = useState(
      () => new URLSearchParams(location.search).get("quickAccess") === "1",
    ),
    [theme, setTheme] = useState(() => readThemePreference(localStorage)),
    [environmentVisibility, setEnvironmentVisibility] = useState(() => readJSON(environmentVisibilityKey, {}));
  const approvalUserId = realChat.user?.isGuest ? null : realChat.user?.id ?? null;
  const approval = approvalSelection?.userId === approvalUserId
    ? approvalSelection.value
    : storedApprovalMode(approvalUserId);
  function setApproval(value) {
    setApprovalSelection({ userId: approvalUserId, value });
    rememberApprovalMode(approvalUserId, value);
  }
  const environmentPreferenceOwner = String(chat.user?.id || "guest");
  const showEnvironmentPicker = environmentVisibility[environmentPreferenceOwner] === true;
  function changeEnvironmentVisibility(visible) {
    const next = { ...readJSON(environmentVisibilityKey, {}), [environmentPreferenceOwner]: visible };
    setEnvironmentVisibility(next);
    try { localStorage.setItem(environmentVisibilityKey, JSON.stringify(next)); } catch {}
  }
  function startNewChat() {
    setIssueDraft(null);
    setIssueMention(null);
    chat.newChat();
  }
  const input = useRef(),
    sessionPress = useRef(null),
    sessionClickSuppressed = useRef(null),
    mentionPicker = useRef(),
    projectPicker = useRef(null),
    headerProjectPicker = useRef(null),
    fileInput = useRef(),
    scroll = useRef(),
    follow = useRef(true),
    draftReady = useRef(null),
    previousArtifacts = useRef({ id: null, ids: new Set(), baselined: false }),
    dialogInput = useRef(),
    composerPreviews = useRef(new Map());
  // A requirement handed over by the workbench drafts in its own slot so the
  // project's unsent new-conversation draft and attachments stay untouched.
  const newDraftSlot = issueDraft && issueDraft.projectId === chat.projectId ? "issue:" + issueDraft.issueId : "new:" + chat.projectId;
  const draftKey = `agentflow.native-chat.draft.${chat.user?.id || "guest"}.${chat.activeId || newDraftSlot}`;
  useEffect(() => {
    if (!chat.activeId) return;
    setIssueDraft(null);
    setIssueMention(null);
  }, [chat.activeId]);
  useEffect(() => setMention(null), [draftKey]);
  // The open conversation's reply is reported read; the history list dots
  // the replies the server still counts as unread.
  const readReplies = useReadReplies({
    enabled: realChat.ready,
    sessions: realChat.sessions,
    activeId: realChat.activeId,
    generation: realChat.generation,
  });
  const conversationRuns = useConversationRuns(chat.session, runsRefresh);
  // The workspace of this conversation (opened by workbench_workspace_open).
  // Its git state drives the "改动" view of the side panel.
  // Task conversations keep their workspace on the task run; ordinary
  // conversations bind the temporary workspace opened by Main Bot.
  const workspaceRunId =
    chat.session?.workspaceRunId || chat.session?.runId || "";
  const workspaceChanges = useWorkspaceChanges(workspaceRunId, {
    active: panel && panelView === "changes",
  });
  // A finished turn has changed the workspace; refresh the badge and the diff
  // so the panel never shows the state from before the last edits.
  const generationStatus = chat.generation?.status || "";
  const refreshWorkspaceChanges = workspaceChanges.refresh;
  useEffect(() => {
    if (workspaceRunId && generationStatus && generationStatus !== "running")
      refreshWorkspaceChanges();
  }, [workspaceRunId, generationStatus, refreshWorkspaceChanges]);
  const runAlertKeys = conversationRuns
    .flatMap((run) => runProblems(run).map((p) => p.key))
    .join(",");
  const artifactList = useMemo(
    () =>
      collectArtifacts(chat.session).map((a) =>
        reconcileOperation(a, conversationRuns),
      ),
    [chat.session, conversationRuns],
  );
  const sidebarArtifacts = artifactList.filter(visibleSidebarArtifact);
  useEffect(() => setRepositorySelections({}), [chat.activeId]);
  useEffect(() => setPanelView("artifacts"), [chat.activeId]);
  // Workspace and localhost addresses in replies open in the side panel's
  // Agent browser: the user's own browser cannot reach the execution machine.
  const [browserRequest, setBrowserRequest] = useState(null);
  useEffect(() => setBrowserRequest(null), [chat.activeId]);
  const openAgentBrowser = useCallback((url) => {
    setBrowserRequest({ id: `${Date.now()}-${Math.random()}`, url });
    setPanelView("browser");
    setPanel(true);
  }, []);
  const browserRequestHandled = useCallback(
    (id) => setBrowserRequest((current) => (current?.id === id ? null : current)),
    [],
  );
  useEffect(() => setIssueContextOpen(false), [chat.activeId, chat.projectId]);
  const operationContext = {
    projects: chat.projects,
    projectId: chat.projectId,
    issueId: chat.issueId,
    runId: chat.session?.runId,
    onLinkIssue: chat.linkIssue,
    references:
      chat.session?.messages?.flatMap((message) => message.references || []) ||
      [],
    repositorySelections,
    onRepositorySelection: (id, ids, projectId) =>
      setRepositorySelections((old) => ({ ...old, [id]: { ids, projectId } })),
  };
  const pinned =
    pins[chat.user?.id] ||
    readJSON(`agentflow.native-chat.pins.${chat.user?.id}`, []);
  const projectName =
    chat.projects.find((p) => p.id === chat.projectId)?.name ||
    (chat.projectId && (chat.session?.projectName || chat.projectId)) ||
    "个人对话";
  const selectedModel = chat.models.find((m) => m.id === chat.model) || (!chat.local ? chat.modelDetails : null);
  const modelLabel =
    selectedModel?.name?.replace(/^Claude-/, "").replace(/^GPT-/, "") || "模型";
  // The CLI switch is only for a conversation that has not started. A reply
  // in flight, or one already saved, keeps that CLI; another CLI needs a new chat.
  const lockedExecutorId = chat.session
    ? conversationEngine(chat.session.messages, chat.models, chat.session.executor) ||
      (chat.busy ? chat.executor : "")
    : "";
  const pinnedExecutor = lockedExecutorId
    ? (chat.executors || []).find((item) => item.id === lockedExecutorId)
    : undefined;
  const projectOptions = projectPickerOptions(
    chat.projects,
    chat.user,
    chat.session,
  );
  const projectActions = [
    {
      id: "new-project",
      label: "新建项目",
      icon: "plus",
      onSelect: () => setQuickAccessOpen(true),
    },
  ];
  function chooseProject(id) {
    const project = chat.projects.find((p) => p.id === id);
    if (project && !canChatInProject(project, chat.user)) {
      chat.setError(
        `你还不是「${project.name}」的成员，不能在这个项目里对话。请项目 Owner 把你加入项目，或先用「个人对话」。`,
      );
      return;
    }
    void chat.selectProject(id);
  }
  function useStarter(prompt) {
    setText(prompt);
    setMention(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      if (input.current) {
        input.current.style.height = "auto";
        input.current.style.height = `${Math.min(input.current.scrollHeight, 220)}px`;
      }
    });
  }
  function handleStarter(starter) {
    if (starter.id === "quick-access") {
      setQuickAccessOpen(true);
      return;
    }
    if (starter.view) {
      navigate(starter.view);
      return;
    }
    if (starter.prompt) useStarter(starter.prompt);
  }
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(
        theme,
        media.matches,
      );
    };
    apply();
    writeThemePreference(localStorage, theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    // The host shell writes the same key; storage events only reach the other documents.
    const onStorage = (event) => {
      if (!event.key || event.key === THEME_KEY)
        setTheme(readThemePreference(localStorage));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    if (!chat.user) return;
    const value = readJSON(draftKey, {});
    setText(value.text || "");
    setAttachments(value.attachments || []);
    setReferences(value.references || []);
    draftReady.current = draftKey;
  }, [draftKey, chat.user?.id]);
  useEffect(() => {
    if (!chat.user || draftReady.current !== draftKey) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ text, attachments, references }),
      );
    } catch {
      chat.setError("浏览器存储空间不足，草稿仍保留在当前页面。请移除较大的附件后重试。");
    }
  }, [text, attachments, references, draftKey, chat.user?.id]);
  // A requirement handed over by the workbench ("创建并去对话澄清") opens a
  // new conversation with the requirement already @-mentioned. It waits for
  // the new conversation's draft to load so the draft does not overwrite it.
  useEffect(() => {
    const listener = (event) => {
      if (
        event.source !== window.parent ||
        event.origin !== location.origin ||
        event.data?.type !== "agentflow-chat-mention-issue"
      ) return;
      const issueId = String(event.data.issueId || "");
      const projectId = String(event.data.projectId || "");
      if (!issueId || !projectId) return;
      chat.startProjectDraft(projectId);
      setIssueDraft({ issueId, projectId });
      setIssueMention({ issueId, projectId });
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [chat.startProjectDraft]);
  // 宿主 rail 的搜索按钮：打开会话搜索弹窗（和 ⌘K 同一个）。
  useEffect(() => {
    const listener = (event) => {
      if (
        event.source !== window.parent ||
        event.origin !== location.origin ||
        event.data?.type !== "agentflow-chat-search"
      ) return;
      setDialog({ type: "search" });
      setQuery("");
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  // 宿主 rail 点击会话：在本页内部切换，不重建 iframe。
  const openSessionRef = useRef(null);
  openSessionRef.current = chat.open;
  useEffect(() => {
    const listener = (event) => {
      if (
        event.source !== window.parent ||
        event.origin !== location.origin ||
        event.data?.type !== "agentflow-chat-open-session"
      ) return;
      const sessionId = String(event.data.sessionId || "");
      if (!sessionId) return;
      openSessionRef.current?.(sessionId);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  // 宿主 rail 的「新建」：开一个完全空白的新会话（不关联任务、不带项目）。
  const blankChatRef = useRef(null);
  blankChatRef.current = () => {
    setIssueDraft(null);
    setIssueMention(null);
    chat.startBlankChat();
  };
  useEffect(() => {
    const listener = (event) => {
      if (
        event.source !== window.parent ||
        event.origin !== location.origin ||
        event.data?.type !== "agentflow-chat-new"
      ) return;
      blankChatRef.current?.();
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  // 宿主 rail 的会话右键菜单：重命名 / 归档 / 删除 / 置顶。
  // 改名与删除都走本页已有的确认对话框，不在这里直接调接口。
  // 回调存进 ref，监听只绑定一次——否则每次会话列表变化都会重绑。
  const sessionActionRef = useRef(null);
  sessionActionRef.current = (action, sessionId) => {
    const target = (chat.sessions || []).find((s) => s.id === sessionId);
    if (!target) return;
    if (action === "rename") {
      setDialog({ type: "rename", session: target, value: target.title || "" });
    } else if (action === "delete") {
      setDialog({ type: "delete", session: target });
    } else if (action === "archive" || action === "restore") {
      void chat.archive(sessionId, action === "archive");
    } else if (action === "pin" || action === "unpin") {
      togglePin(sessionId);
    }
  };
  useEffect(() => {
    const listener = (event) => {
      if (
        event.source !== window.parent ||
        event.origin !== location.origin ||
        event.data?.type !== "agentflow-chat-session-action"
      ) return;
      const sessionId = String(event.data.sessionId || "");
      if (!sessionId) return;
      sessionActionRef.current?.(String(event.data.action || ""), sessionId);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    if (
      !issueMention ||
      !chat.user ||
      chat.activeId ||
      chat.projectId !== issueMention.projectId ||
      newDraftSlot !== "issue:" + issueMention.issueId ||
      draftReady.current !== draftKey
    ) return;
    let current = true;
    api(`/api/issues/${encodeURIComponent(issueMention.issueId)}`)
      .then((data) => {
        if (!current) return;
        const issue = data.issue || data;
        if ((readJSON(draftKey, {}).references || []).some((r) => r.type === "issue" && r.id === issue.id)) return;
        const ref = {
          type: "issue",
          id: issue.id,
          name: issue.title || issue.id,
          projectId: issue.projectId,
        };
        const value = insertMention("", { start: 0, end: 0 }, ref);
        setText(value.text);
        setReferences([ref]);
        setMention(null);
        requestAnimationFrame(() => {
          input.current?.focus();
          input.current?.setSelectionRange(value.caret, value.caret);
        });
      })
      .catch((e) => current && chat.setError(e.message))
      .finally(() => {
        if (!current) return;
        setIssueMention(null);
        const url = new URL(location.href);
        url.searchParams.delete("mentionIssue");
        history.replaceState({}, "", url);
      });
    return () => {
      current = false;
    };
  }, [issueMention, chat.user, chat.activeId, chat.projectId, newDraftSlot, draftKey]);

  // 与上面对应：角色页「发起会话」把角色写成 @ 引用。
  useEffect(() => {
    if (
      !roleMention ||
      !chat.user ||
      chat.activeId ||
      (roleMention.projectId && chat.projectId !== roleMention.projectId) ||
      draftReady.current !== draftKey
    ) return;
    let current = true;
    api(`/api/agents/${encodeURIComponent(roleMention.roleId)}`)
      .then((agent) => {
        if (!current || !agent) return;
        const ref = {
          type: "agent",
          id: agent.id,
          name: agent.name || agent.id,
          projectId: agent.projectId || roleMention.projectId || "",
        };
        const saved = readJSON(draftKey, {});
        if ((saved.references || []).some((r) => r.type === "agent" && r.id === ref.id)) return;
        const value = insertMention(saved.text || "", { start: 0, end: 0 }, ref);
        setText(value.text);
        setReferences([ref]);
        setMention(null);
        requestAnimationFrame(() => {
          input.current?.focus();
          input.current?.setSelectionRange(value.caret, value.caret);
        });
      })
      .catch((e) => current && chat.setError(e.message))
      .finally(() => {
        if (!current) return;
        setRoleMention(null);
        const url = new URL(location.href);
        url.searchParams.delete("mentionRole");
        history.replaceState({}, "", url);
      });
    return () => {
      current = false;
    };
  }, [roleMention, chat.user, chat.activeId, chat.projectId, draftKey]);
  useEffect(() => {
    let previous = previousArtifacts.current;
    if (previous.id !== chat.activeId) {
      setSelectedArtifact(null);
      setPanel(false);
      setArtifactUnread(0);
      previous = { id: chat.activeId, ids: new Set(), baselined: false };
      previousArtifacts.current = previous;
    }
    if (!chat.activeId || chat.session?.id !== chat.activeId) return;
    const entries = [...sidebarArtifacts, ...conversationRuns];
    const addedEntries = previous.baselined
      ? entries.filter((entry) => !previous.ids.has(entry.id)) : [];
    const addedArtifacts = previous.baselined
      ? sidebarArtifacts.filter(
          (artifact) => isGeneratedArtifact(artifact) && !previous.ids.has(artifact.id),
        ).length
      : 0;
    previousArtifacts.current = {
      id: chat.activeId,
      ids: new Set(entries.map((entry) => entry.id)),
      baselined: true,
    };
    if (panel) {
      setArtifactUnread(0);
      return;
    }
    if (addedEntries.length)
      setArtifactUnread((count) => count + addedEntries.length);
    // A newly generated artifact reveals the drawer by itself so the user does
    // not have to notice the badge. Restored artifacts (the first snapshot of
    // an existing conversation), conversations without artifacts and layouts
    // where the drawer would cover the answer keep the drawer as it was.
    // 会话侧栏已移到宿主 rail，内容区不再被它挤占。
    const revealArtifacts = shouldRevealArtifactPanel({
      addedArtifacts,
      panelOpen: panel,
      viewportWidth: window.innerWidth || document.documentElement.clientWidth,
    });
    if (revealArtifacts) {
      setArtifactUnread(0);
      setPanelView("artifacts");
      setPanel(true);
    }
  }, [
    chat.activeId,
    chat.session?.id,
    artifactList,
    conversationRuns,
    panel,
  ]);
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [
    chat.session?.messages?.length,
    chat.live.answer,
    chat.live.thinking,
    chat.busy,
    runAlertKeys,
  ]);
  useEffect(() => {
    const keyboard = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog({ type: "search" });
        setQuery("");
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o"
      ) {
        e.preventDefault();
        startNewChat();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setDialog({ type: "settings" });
      }
      if (e.key === "Escape") {
        setMenu(null);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [chat.newChat]);
  const closeMenu = () => setMenu(null),
    closeDialog = () => {
      if (dialog?.type === "search") setQuery("");
      setDialog(null);
    };
  function togglePin(id) {
    const updated = pinned.includes(id)
      ? pinned.filter((x) => x !== id)
      : [...pinned, id];
    localStorage.setItem(
      `agentflow.native-chat.pins.${chat.user.id}`,
      JSON.stringify(updated),
    );
    setPins({ ...pins, [chat.user.id]: updated });
    closeMenu();
  }
  function openArtifact(a) {
    setArtifactUnread(0);
    setPanelView("artifacts");
    setPanel(true);
    setSelectedArtifact(a);
  }
  function navigate(view, options = {}) {
    if (window.parent !== window)
      window.parent.postMessage(
        { type: "agentflow-chat-open-view", view, ...options },
        location.origin,
      );
    else location.href = `/${options.projectId ? "?projectId=" + encodeURIComponent(options.projectId) : ""}#/${view}${options.action === "create" ? "/__new__" : ""}`;
    closeDialog();
    closeMenu();
  }
  // 工作台任务卡片点开：交给父窗口切到运行详情。
  // 运行详情在 web/runs.js，chatbot 是 iframe，只能通过 postMessage 请求。
  function openTask(task) {
    if (!task) return;
    if (task.runId && window.parent !== window) {
      window.parent.postMessage(
        { type: "agentflow-chat-open-view", view: "runs", runId: task.runId },
        location.origin,
      );
      return;
    }
    // iframe 外或无 runId 时退回需求页，至少能看到任务上下文。
    navigate("issues", { projectId: task.projectId || chat.projectId });
  }
  async function submit() {
    if (uploading) return;
    follow.current = true;
    const ok = await chat.send({
      text,
      attachments,
      references,
      approvalMode: approval,
    });
    if (ok) {
      setMention(null);
      setText("");
      setAttachments([]);
      for (const a of attachments) releaseComposerPreview(a.id);
      setReferences([]);
      localStorage.removeItem(draftKey);
      if (input.current) input.current.style.height = "";
    } else {
      // A failed first message may already have opened a new conversation,
      // which loads that conversation's (empty) draft. Keep what was typed.
      setText((current) => current || text);
    }
  }
  function editQueued(item) {
    chat.removeQueued(item.id);
    setText((current) =>
      current.trim() ? `${item.text}\n${current}` : item.text,
    );
    setAttachments((old) => [...(item.attachments || []), ...old]);
    setReferences((old) => [
      ...(item.references || []).filter(
        (ref) => !old.some((o) => o.type === ref.type && o.id === ref.id),
      ),
      ...old,
    ]);
    input.current?.focus();
  }
  function composerPreviewURL(a) {
    return (
      composerPreviews.current.get(a.id) ||
      attachmentURL(a, chat.session?.id || chat.activeId || "")
    );
  }
  function releaseComposerPreview(id) {
    const url = composerPreviews.current.get(id);
    if (!url) return;
    URL.revokeObjectURL(url);
    composerPreviews.current.delete(id);
  }
  function removeAttachment(a) {
    releaseComposerPreview(a.id);
    setAttachments((old) => old.filter((x) => x.id !== a.id));
  }
  async function upload(files) {
    if (!files.length) return;
    if (files.length + attachments.length > 8) {
      chat.setError("每轮最多上传 8 个文件。");
      return;
    }
    setUploading(true);
    try {
      const results = [];
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) throw Error("单个附件不能超过 10 MB");
        // Show the picture as soon as it is pasted or dropped. A filename
        // chip alone leaves people unable to tell which screenshot is queued.
        const previewURL =
          file.type?.startsWith("image/") && !chat.local
            ? URL.createObjectURL(file)
            : "";
        const slot = previewURL
          ? {
              id: localId("pending"),
              name: file.name || "粘贴的图片",
              mimeType: file.type,
              size: file.size,
              previewURL,
            }
          : null;
        if (slot) setPendingAttachments((old) => [...old, slot]);
        try {
          if (chat.local) {
            const localDataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () =>
                reject(Error("文件读取失败，请重新选择。"));
              reader.readAsDataURL(file);
            });
            results.push({
              id: localId("local-attachment"),
              name: file.name,
              mimeType: file.type || "application/octet-stream",
              size: file.size,
              localDataUrl,
            });
            continue;
          }
          const body = new FormData();
          body.append("file", file);
          body.append("projectId", chat.projectId);
          const uploaded = await api("/api/assistant/attachments", {
            method: "POST",
            body,
          });
          if (previewURL) composerPreviews.current.set(uploaded.id, previewURL);
          results.push(uploaded);
        } catch (err) {
          if (previewURL) URL.revokeObjectURL(previewURL);
          throw err;
        } finally {
          if (slot)
            setPendingAttachments((old) =>
              old.filter((x) => x.id !== slot.id),
            );
        }
      }
      setAttachments((old) => [...old, ...results]);
    } catch (e) {
      chat.setError(e.message);
    } finally {
      setUploading(false);
    }
  }
  function openReferences() {
    const caret = input.current?.selectionStart ?? text.length;
    setMention(
      mentionAt(text, caret, references) || {
        start: caret,
        end: caret,
        query: "",
      },
    );
    closeMenu();
    input.current?.focus();
  }
  // addElementReference takes an element picked in the native preview: it
  // rides along as a reference chip, without a token in the text.
  function addElementReference(ref) {
    if (references.length >= 12) {
      chat.setError("每轮最多引用 12 个对象。");
      return;
    }
    setReferences((old) => [...old, ref]);
    requestAnimationFrame(() => input.current?.focus());
  }
  function addReference(ref) {
    if (
      references.length >= 12 &&
      !references.some((x) => x.type === ref.type && x.id === ref.id)
    ) {
      chat.setError("每轮最多引用 12 个对象。");
      return;
    }
    const value = insertMention(text, mention, ref);
    setText(value.text);
    setReferences((old) =>
      old.some((x) => x.type === ref.type && x.id === ref.id)
        ? old
        : [...old, ref],
    );
    setMention(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(value.caret, value.caret);
    });
  }
  const searchGroups = groupSessionHistory(chat.sessions, chat.projects, {
    query,
    pinned,
  });
  const messages = chat.session?.messages || [];
  // 消息列表的稳定 key 前缀。
  //
  // 原实现用 key={index}，切会话时 messages 整体替换但 index 不变，
  // React 会复用上一段对话的 DOM 节点再逐个覆盖内容：长会话下比重新
  // 挂载还慢，还会丢掉输入框焦点与滚动位置。
  //
  // 把会话 id 拼进 key：切会话 ⇒ 前缀变 ⇒ 全部重建，React 不会跨会话
  // 复用节点。同一会话内 index 稳定，不需要内容哈希。
  const messageKeyPrefix = chat.session?.id || chat.activeId || "draft";
  const conversationStarted = Boolean(
    chat.activeId && chat.session?.id === chat.activeId &&
    (messages.length || chat.busy || sidebarArtifacts.length || conversationRuns.length),
  );
  const artifactPanelVisible = panel && conversationStarted;
  useEffect(() => {
    if (conversationStarted)
      setMenu((current) => (current?.type === "host" || current?.type === "project" ? null : current));
  }, [conversationStarted]);
  const artifactPresence = usePanelPresence(artifactPanelVisible);
  function cancelSessionPress() {
    if (sessionPress.current) window.clearTimeout(sessionPress.current.timer);
    sessionPress.current = null;
  }
  useEffect(() => cancelSessionPress, []);
  function openSessionContext(event, session, keyboard = false) {
    event.preventDefault();
    event.stopPropagation();
    cancelSessionPress();
    if (["touch", "pen"].includes(event.nativeEvent?.pointerType))
      sessionClickSuppressed.current = { id: session.id, until: Date.now() + 1200 };
    const anchor = event.currentTarget.matches("button")
      ? event.currentTarget
      : event.currentTarget.querySelector(".session-link");
    const bounds = anchor.getBoundingClientRect();
    setMenu(null);
    setSessionContext({
      id: session.id,
      key: `${session.id}:${performance.now()}`,
      anchor,
      x: keyboard ? bounds.left + 16 : event.clientX,
      y: keyboard ? bounds.bottom + 4 : event.clientY,
    });
  }
  function startSessionPress(event, session) {
    if (!["touch", "pen"].includes(event.pointerType)) return;
    cancelSessionPress();
    const anchor = event.currentTarget;
    const x = event.clientX;
    const y = event.clientY;
    sessionPress.current = {
      x, y,
      timer: window.setTimeout(() => {
        sessionClickSuppressed.current = { id: session.id, until: Date.now() + 1200 };
        setMenu(null);
        setSessionContext({ id: session.id, key: `${session.id}:${performance.now()}`, anchor, x, y });
        sessionPress.current = null;
      }, 550),
    };
  }
  const renderSession = (s, options = {}) => {
    const status = sidebarReplyStatus(
      sessionReplyStatus(s, s.id === chat.activeId ? {
        generation: chat.generation,
        busy: chat.busy,
      } : undefined),
      unreadReply(s, { activeId: chat.activeId, read: readReplies }),
    );
    const runState = runSessionState(s);
    return (
    <div
      key={s.id}
      className={`session-row ${s.id === chat.activeId ? "active" : ""}`}
      onContextMenu={(event) => openSessionContext(event, s)}
    >
      <button
        type="button"
        className="session-link"
        title={sessionTooltip(s, { projectName: options.projectName, replyLabel: status.label })}
        aria-haspopup="menu"
        aria-expanded={sessionContext?.id === s.id}
        aria-controls={sessionContext?.id === s.id ? "session-context-menu" : undefined}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
            openSessionContext(event, s, true);
        }}
        onPointerDown={(event) => startSessionPress(event, s)}
        onPointerMove={(event) => {
          const press = sessionPress.current;
          if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10)
            cancelSessionPress();
        }}
        onPointerUp={cancelSessionPress}
        onPointerCancel={cancelSessionPress}
        onPointerLeave={cancelSessionPress}
        onClick={(event) => {
          const suppressed = sessionClickSuppressed.current;
          if (suppressed?.id === s.id && Date.now() < suppressed.until) {
            event.preventDefault();
            return;
          }
          setSessionContext(null);
          chat.open(s.id);
          setQuery("");
        }}
      >
        <span>{s.displayTitle || s.title || "新对话"}</span>
        {scheduledSession(s) ? (
          <span className="session-project-tag session-source-tag" title="定时任务产生的会话">
            定时
          </span>
        ) : null}
        {options.projectName ? (
          <span className="session-project-tag">{options.projectName}</span>
        ) : null}
        {runState ? (
          <span
            className="session-run"
            data-run-state={runState.state}
            title={`运行状态：${runState.label}`}
          >
            {runState.label}
          </span>
        ) : null}
        <Participants session={s} users={chat.users} compact />
        {pinned.includes(s.id) ? (
          <HarnessIcon name="pin" size={12} className="pin-mark" />
        ) : null}
        {status.icon || status.dot ? (
          <span className="session-status" data-session-status={status.state} role="img" aria-label={status.label} title={status.label}>
            {status.icon ? (
              <HarnessIcon name={status.icon} size={15} motion={status.busy ? "busy" : "idle"} />
            ) : (
              <span className="session-unread-dot" aria-hidden="true" />
            )}
          </span>
        ) : null}
      </button>
      {sessionContext?.id === s.id ? (
        <SessionContextMenu
          key={sessionContext.key}
          x={sessionContext.x}
          y={sessionContext.y}
          anchor={sessionContext.anchor}
          activeSessionId={chat.activeId}
          onClose={() => setSessionContext((current) => current?.key === sessionContext.key ? null : current)}
        >
          <button role="menuitem" onClick={() => togglePin(s.id)}>
            <HarnessIcon name="pin" size={15} />
            {pinned.includes(s.id) ? "取消置顶" : "置顶"}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setDialog({ type: "rename", session: s, value: s.title || "" });
              closeMenu();
            }}
          >
            <HarnessIcon name="edit" size={15} />
            重命名
          </button>
          {!s.shared ? (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  void chat.archive(s.id, !archived);
                  closeMenu();
                }}
              >
                <HarnessIcon name="history" size={15} />
                {archived ? "恢复会话" : "归档"}
              </button>
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  setDialog({ type: "delete", session: s });
                  closeMenu();
                }}
              >
                <HarnessIcon name="trash" size={15} />
                删除
              </button>
            </>
          ) : null}
        </SessionContextMenu>
      ) : null}
    </div>
    );
  };
  return (
    <AgentBrowserLinks.Provider
      value={conversationStarted && workspaceRunId ? openAgentBrowser : null}
    >
    <div
      className={[
        "chat-shell",
        !chat.activeId && "home-shell",
        artifactPresence.mounted && "with-panel",
        artifactPresence.animating && "artifact-transitioning",
        artifactPresence.phase === "entering" && "artifact-entering",
        artifactPresence.phase === "closing" && "artifact-closing",
      ].filter(Boolean).join(" ")}
    >
      <header className="brand">
        {/* 会话导航已移到宿主的左侧 rail；这里只保留品牌入口。 */}
        <button
          className="brand-home"
          onClick={startNewChat}
          aria-label="AgentLoop 首页"
        >
          <span className="brand-icon">
            <HarnessIcon name="workflow" size={20} />
          </span>
          <strong>AgentLoop</strong>
        </button>
      </header>
      <header className="conversation-header">
        <div className="conversation-title">
          {chat.session ? (
            <>
              <ConversationStatusIcon
                status={sessionReplyStatus(chat.session, {
                  generation: chat.generation,
                  busy: chat.busy,
                })}
              />
              <button
                disabled={chat.readOnly}
                title={sessionTitle}
                aria-label={sessionTitle}
                className={titleReveal ? "title-typing" : undefined}
                style={
                  titleReveal
                    ? {
                        "--title-step": `${titleReveal.step}ms`,
                        "--title-fade": `${titleReveal.fade}ms`,
                      }
                    : undefined
                }
                onClick={() =>
                  setDialog({
                    type: "rename",
                    session: chat.session,
                    value: chat.session.title,
                  })
                }
              >
                {titleReveal
                  ? titleReveal.chars.map((char, i) => (
                      <span
                        key={`${chat.session.id}-${i}`}
                        className="title-ch"
                        aria-hidden="true"
                        style={{ "--i": i }}
                      >
                        {char}
                      </span>
                    ))
                  : sessionTitle}
              </button>
              {!chat.readOnly ? (
                <IconButton
                  label="重命名会话"
                  onClick={() =>
                    setDialog({
                      type: "rename",
                      session: chat.session,
                      value: chat.session.title,
                    })
                  }
                >
                  <HarnessIcon name="edit" size={13} />
                </IconButton>
              ) : null}
              {pinnedExecutor ? (
                <span
                  className="conversation-engine"
                  title={`本对话使用 ${pinnedExecutor.label}，对话开始后不能切换 CLI；换 CLI 请新建对话`}
                >
                  <ModelProviderIcon
                    brand={engineBrand(pinnedExecutor.id)}
                    size={12}
                  />
                  {pinnedExecutor.label}
                </span>
              ) : null}
              {chat.local ? <span className="preview-badge">示例</span> : null}
            </>
          ) : null}
        </div>
        <div className="header-actions">
          {chat.session ? (
            <>
              {conversationStarted ? <ExecutionMachinePicker chat={chat} onManage={() => navigate("runners")} /> : null}
              {projectName ? (
                <div className="menu-anchor conversation-project-anchor">
                  {/* The conversation's project; picking another one opens a
                      new chat there (a personal chat is bound in place). */}
                  <button
                    ref={headerProjectPicker}
                    type="button"
                    className="conversation-project"
                    title={`当前项目：${projectName}，点击切换项目`}
                    aria-label={`当前项目：${projectName}，切换项目`}
                    aria-haspopup="listbox"
                    aria-expanded={menu?.type === "header-project"}
                    onClick={() =>
                      setMenu(
                        menu?.type === "header-project"
                          ? null
                          : { type: "header-project" },
                      )
                    }
                  >
                    <HarnessIcon name="folder" size={12} interactive={false} />
                    <span>{projectName}</span>
                    <HarnessIcon name="chevron-down" size={11} interactive={false} />
                  </button>
                  <SelectMenu
                    open={menu?.type === "header-project"}
                    label="切换项目"
                    value={chat.projectId}
                    options={projectOptions}
                    onSelect={chooseProject}
                    onClose={closeMenu}
                    anchorRef={headerProjectPicker}
                    searchable
                    emptyText="没有匹配的项目"
                    actions={projectActions}
                  />
                </div>
              ) : null}
              {showEnvironmentPicker ? <SandboxPicker chat={chat} onCreate={() => navigate("sandboxes", { action: "create", projectId: chat.projectId })} /> : null}
              <Participants session={chat.session} users={chat.users} />
            </>
          ) : null}
          {conversationStarted && workspaceRunId ? (
            <button
              type="button"
              className={`panel-toggle changes-toggle ${panel && panelView === "changes" ? "active" : ""}`}
              title="查看本次会话的代码改动"
              aria-label={`查看改动，共 ${workspaceChanges.files.length} 个文件`}
              aria-expanded={panel && panelView === "changes"}
              aria-controls="conversation-artifacts"
              onClick={() => {
                if (panel && panelView === "changes") {
                  setPanel(false);
                  return;
                }
                setPanelView("changes");
                setPanel(true);
              }}
            >
              <HarnessIcon name="edit" size={15} />
              <span className="changes-toggle-label">改动</span>
              {workspaceChanges.files.length ? (
                <span className="changes-toggle-count">
                  {workspaceChanges.files.length > 99
                    ? "99+"
                    : workspaceChanges.files.length}
                </span>
              ) : null}
            </button>
          ) : null}
          {conversationStarted ? <button
            type="button"
            className={`panel-toggle ${panel ? "active" : ""}`}
            data-hover-ink-control=""
            aria-label="查看会话产物"
            aria-expanded={panel}
            aria-controls="conversation-artifacts"
            aria-describedby={!panel && artifactUnread ? "artifact-unread-description" : undefined}
            title="查看会话产物"
            onClick={() => {
              setArtifactUnread(0);
              if (panel && panelView === "artifacts") {
                setPanel(false);
                return;
              }
              setPanelView("artifacts");
              setPanel(true);
            }}
          >
            <span className="artifact-toggle-glyph">
              <HarnessIcon name="chat-artifacts" size={16} />
              {!panel && artifactUnread ? (
                <span className="artifact-unread-badge" aria-hidden="true">
                  {artifactUnread > 99 ? "99+" : artifactUnread}
                </span>
              ) : null}
            </span>
            {!panel && artifactUnread ? (
              <span className="sr-only" id="artifact-unread-description">{artifactUnread} 个新产物</span>
            ) : null}
          </button> : null}
        </div>
      </header>
      <main
        className={`conversation-main ${!chat.activeId ? "empty-conversation" : ""}`}
      >
        {chat.activeId ? (
          <div
            className="message-scroll"
            ref={scroll}
            onScroll={(e) => {
              const el = e.currentTarget;
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 110;
            }}
          >
            <div className="message-column">
              {!chat.session && !chat.error ? (
                <div className="loading-session">正在恢复对话…</div>
              ) : null}
              {messages.map((message, index) =>
                isProposalTimeout(message, messages[index - 1]) ? null : confirmationCaption(message, messages[index - 1]) ? (
                  <div
                    key={`${messageKeyPrefix}:${index}`}
                    className="confirmation-note"
                    data-message-index={index}
                  >
                    <HarnessIcon name="check" size={14} aria-hidden="true" />
                    {confirmationCaption(message, messages[index - 1])}
                  </div>
                ) : (
                  <article
                    key={`${messageKeyPrefix}:${index}`}
                    className={`message ${message.role}`}
                    data-message-index={index}
                  >
                    {message.role === "assistant" ? (
                      <AssistantTurn
                        message={message}
                        steps={activityForReply(
                          message,
                          chat.generation,
                          chat.live.activity,
                        )}
                        assets={artifactList}
                        projectId={chat.session?.projectId}
                        sessionId={chat.session?.id}
                        local={chat.local}
                        readOnly={chat.readOnly}
                        onCLIInstall={chat.adoptCLIInstall}
                      />
                    ) : null}
                    {message.role === "user" ? (
                    <div className="message-body">
                        <>
                          <div className="message-author">
                            <Avatar
                              person={authorFor(
                                message,
                                chat.session,
                                chat.users,
                              )}
                            />
                            <span>
                              {
                                authorFor(message, chat.session, chat.users)
                                  .name
                              }
                            </span>
                            <MessageTime messages={messages} index={index} />
                          </div>
                          <div className="user-bubble">{message.content}</div>
                          {message.references?.length ? (
                            <div className="message-references">
                              {message.references.map((ref) => (
                                <span
                                  key={ref.type + ref.id}
                                  title={ref.type === "element" ? elementTitle(ref) : undefined}
                                >
                                  {ref.type === "element" ? (
                                    <HarnessIcon name="crosshair" size={12} />
                                  ) : (
                                    "@"
                                  )}
                                  {ref.name || ref.id}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="user-actions">
                            {!chat.readOnly ? (
                              <>
                                <IconButton
                                  label="编辑消息"
                                  disabled={chat.busy}
                                  onClick={() =>
                                    setDialog({
                                      type: "edit",
                                      index,
                                      value: message.content,
                                      fork: false,
                                    })
                                  }
                                >
                                  <HarnessIcon name="edit" size={14} />
                                </IconButton>
                                <IconButton
                                  label="从此处创建分支"
                                  disabled={chat.busy}
                                  onClick={() =>
                                    setDialog({
                                      type: "edit",
                                      index,
                                      value: message.content,
                                      fork: true,
                                    })
                                  }
                                >
                                  <HarnessIcon name="branch" size={14} />
                                </IconButton>
                              </>
                            ) : null}
                            <CopyButton
                              value={message.content}
                              label="复制消息"
                            />
                          </div>
                        </>
                    </div>
                    ) : null}
                    {message.attachments?.length ? (
                      <div className="message-attachments">
                        {message.attachments.map((a) => (
                          <Attachment
                            key={a.id}
                            attachment={a}
                            sessionId={chat.session.id}
                            onOpen={openArtifact}
                          />
                        ))}
                      </div>
                    ) : null}
                    {message.role === "assistant" ? (
                      <>
                        <div className="message-drafts">
                          {artifactList
                            .filter((a) => a.draft && a.messageIndex === index)
                            .map((a) => (
                              <DraftCard
                                key={a.id}
                                artifact={a}
                                context={operationContext}
                                onApply={chat.readOnly ? null : chat.applyDraft}
                                onDecide={
                                  chat.readOnly
                                    ? null
                                    : (messageIndex, draftIndex, decision) =>
                                        chat.decideProposal(messageIndex, draftIndex, decision, approval)
                                }
                                onPreview={openArtifact}
                              />
                            ))}
                        </div>
                        <div className="message-actions">
                          <MessageTime messages={messages} index={index} />
                          <CopyButton
                            value={copiedReply(
                              message,
                              chat.generation,
                              chat.live.activity,
                            )}
                            label="复制回复"
                          />
                          <MessageInfo message={message} />
                          {!chat.local && !chat.readOnly && message.generationId && !message.failure ? <GenerationDiagnostics sessionId={chat.session.id} generationId={message.generationId} compact /> : null}
                        </div>
                      </>
                    ) : null}
                  </article>
                ),
              )}
              {/* The live reply belongs right under its question. Alerts stay
                  last, so a finished reply does not jump above them. */}
              {chat.busy ? (
                <LiveMessage live={chat.live} generation={chat.generation} local={chat.local} readOnly={chat.readOnly} />
              ) : chat.generation &&
                !generationStored(messages, chat.generation) &&
                !["completed", "running"].includes(chat.generation.status) &&
                !messages.at(-1)?.unfinished &&
                (chat.live.activity?.length || chat.live.answer) ? (
                <LiveMessage
                  live={chat.live}
                  generation={chat.generation}
                  finished
                  local={chat.local}
                  readOnly={chat.readOnly}
                />
              ) : null}
              <NativeApprovalPanel chat={chat} onChange={() => {
                if (follow.current && scroll.current)
                  scroll.current.scrollTop = scroll.current.scrollHeight;
              }} />
              {!chat.local && !chat.busy && chat.generation?.failure && !messages.some((m) => m.generationId === chat.generation.id && m.failure) ? <GenerationDiagnostics sessionId={chat.session?.id} generationId={chat.generation.id} failure={chat.generation.failure} onCLIInstall={chat.adoptCLIInstall} readOnly={chat.readOnly} /> : null}
              {!chat.local && !chat.readOnly && !chat.busy && chat.generation?.id && chat.generation.status === "cancelled" && !chat.generation.failure && !messages.some((m) => m.generationId === chat.generation.id) ? <GenerationDiagnostics sessionId={chat.session?.id} generationId={chat.generation.id} compact /> : null}
              <RunAlerts
                runs={conversationRuns}
                user={chat.user}
                users={chat.users}
                readOnly={chat.readOnly}
                onChanged={() => setRunsRefresh((n) => n + 1)}
                onOpenNode={(run, nodeId) =>
                  openArtifact({
                    kind: "run",
                    id: run.id,
                    runId: run.id,
                    name: run.workflowSnapshot?.name || "SOP 运行",
                    nodeId,
                  })
                }
                onAsk={(item) => {
                  setText(
                    `运行 ${item.runId} 的「${item.nodeName}」节点${item.kind === "failed" ? "失败了" : "在等待人工确认"}，帮我分析具体卡在哪里、原因是什么、需要谁做什么。`,
                  );
                  document
                    .querySelector('textarea[aria-label="消息"]')
                    ?.focus();
                }}
              />
            </div>
          </div>
        ) : (
          <>
            <HomeWelcome />
            <TaskBoard projectId={chat.projectId} onOpenTask={openTask} />
          </>
        )}
        <div className="composer-region">
          <div className="composer-column">
            {chat.error && !(chat.generation?.failure && chat.error === chat.generation.error) ? (
              <div role="alert" className="chat-error">
                <span>{chat.error}</span>
                <CredentialAction text={chat.error} />
                <CLIInstallAction text={chat.error} onResult={chat.adoptCLIInstall} />
                <IconButton label="关闭提示" onClick={() => chat.setError("")}>
                  <HarnessIcon name="close" size={15} />
                </IconButton>
              </div>
            ) : null}
            {chat.ready &&
            !chat.local &&
            chat.user &&
            !chat.user.isGuest &&
            !chat.user.codeBuddyApiKeyConfigured &&
            !chat.sponsoredModel &&
            chat.executor === "codebuddy" &&
            !chat.readOnly &&
            credentialHint(chat.error)?.field !== "codeBuddyApiKey" ? (
              <div className="credential-notice" role="status">
                <HarnessIcon name="key" size={15} aria-hidden="true" />
                <span>
                  当前执行器 CodeBuddy 需要先配置 CodeBuddy API Key。
                  {chat.user.codexApiKeyConfigured ||
                  chat.user.claudeCodeApiKeyConfigured
                    ? "你已配置 Codex / Claude Code Key，也可以在输入框下方把执行器切换过去。"
                    : ""}
                </span>
                <button
                  type="button"
                  onClick={() => openCredentialSettings("codeBuddyApiKey")}
                >
                  去配置
                </button>
              </div>
            ) : null}
            {chat.readOnly ? (
              <div className="readonly-notice" role="status">
                <HarnessIcon name="eye" size={16} aria-hidden="true" />
                <span>
                  你不是「{projectName}
                  」的成员，只能查看这个会话。加入项目后可以继续聊。
                </span>
              </div>
            ) : (
              <div
                className="composer-stack"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void upload([...e.dataTransfer.files]);
                }}
              >
                {!conversationStarted ? (
                <div className="composer-context">
                  <ExecutionMachinePicker chat={chat} onManage={() => navigate("runners")} />
                  <ChevronRightSmall />
                  <div className="menu-anchor">
                    <button
                      ref={projectPicker}
                      className={`context-pill project-picker${chat.projectId ? "" : " is-unset"}`}
                      title="对话所属的项目：需求、仓库、角色和 SOP 都按项目区分"
                      aria-label="选择项目"
                      aria-haspopup="listbox"
                      aria-expanded={menu?.type === "project"}
                      onClick={() =>
                        setMenu(
                          menu?.type === "project" ? null : { type: "project" },
                        )
                      }
                    >
                      <HarnessIcon name="folder" size={14} />
                      <span>
                        {chat.projectId
                          ? projectName
                          : chat.activeId
                            ? "绑定项目"
                            : "选择项目"}
                      </span>
                      <HarnessIcon name="chevron-down" size={12} />
                    </button>
                    <SelectMenu
                      open={menu?.type === "project"}
                      label="项目"
                      value={chat.projectId}
                      options={projectOptions}
                      onSelect={chooseProject}
                      onClose={closeMenu}
                      anchorRef={projectPicker}
                      searchable
                      emptyText="没有匹配的项目"
                      actions={projectActions}
                    />
                  </div>
                  {showEnvironmentPicker && chat.projectId ? <ChevronRightSmall /> : null}
                  {showEnvironmentPicker ? <SandboxPicker chat={chat} onCreate={() => navigate("sandboxes", { action: "create", projectId: chat.projectId })} /> : null}
                </div>
                ) : null}
                <QueuedMessages
                  items={chat.queue}
                  steering={chat.steering}
                  held={chat.queueHeld}
                  busy={chat.busy}
                  readOnly={chat.readOnly}
                  onEdit={editQueued}
                  onRemove={chat.removeQueued}
                  onResume={chat.resumeQueue}
                  onSendNow={chat.sendNow}
                />
                <div className="composer">
                  <MentionPicker
                    ref={mentionPicker}
                    key={chat.projectId}
                    projectId={chat.projectId}
                    trigger={mention}
                    editor={input}
                    onSelect={addReference}
                    onClose={() => setMention(null)}
                    issueId={chat.issueId}
                    canManageIssue={!!chat.projectId && !chat.busy && (!chat.activeId || !!chat.session) && !chat.session?.shared && !chat.readOnly}
                    onManageIssue={() => {
                      setMention(null);
                      setIssueContextOpen(true);
                    }}
                  />
                  {attachments.length || pendingAttachments.length || references.length ? (
                    <div className="composer-attachments">
                      {pendingAttachments.map((a) => (
                        <span
                          key={a.id}
                          className="composer-attachment-thumb is-uploading"
                          title={`正在上传 ${a.name}`}
                        >
                          <span className="composer-attachment-preview">
                            <img src={a.previewURL} alt={a.name} />
                          </span>
                          <span className="composer-attachment-progress" />
                        </span>
                      ))}
                      {attachments.map((a) => {
                        const image = a.mimeType?.startsWith("image/");
                        const url = composerPreviewURL(a);
                        return image ? (
                          <span key={a.id} className="composer-attachment-thumb">
                            <button
                              type="button"
                              className="composer-attachment-preview"
                              title={`${a.name} · 点击查看大图`}
                              aria-label={`查看图片 ${a.name}`}
                              onClick={() =>
                                setImagePreview({ src: url, name: a.name })
                              }
                            >
                              <img src={url} alt={a.name} />
                            </button>
                            <button
                              type="button"
                              className="composer-attachment-remove"
                              aria-label={`移除 ${a.name}`}
                              title={`移除 ${a.name}`}
                              onClick={() => removeAttachment(a)}
                            >
                              <HarnessIcon name="close" size={11} />
                            </button>
                          </span>
                        ) : (
                          <span
                            key={a.id}
                            className="composer-attachment-file"
                          >
                            <HarnessIcon name="paperclip" size={13} />
                            <span className="composer-attachment-name">
                              {a.name}
                            </span>
                            {a.size ? (
                              <small>{formatFileSize(a.size)}</small>
                            ) : null}
                            <button
                              aria-label={`移除 ${a.name}`}
                              onClick={() => removeAttachment(a)}
                            >
                              <HarnessIcon name="close" size={13} />
                            </button>
                          </span>
                        );
                      })}
                      {references.map((ref) => (
                        <span
                          key={ref.type + ref.id}
                          className={`composer-attachment-file${ref.type === "element" ? " is-element" : ""}`}
                          title={ref.type === "element" ? elementTitle(ref) : undefined}
                        >
                          {ref.type === "element" ? (
                            <HarnessIcon name="crosshair" size={13} />
                          ) : (
                            "@"
                          )}
                          {ref.name || ref.id}
                          <button
                            aria-label={`移除引用 ${ref.name || ref.id}`}
                            onClick={() => {
                              setReferences((old) =>
                                old.filter(
                                  (x) => x.id !== ref.id || x.type !== ref.type,
                                ),
                              );
                              setText((old) =>
                                old.replace(`@${ref.name || ref.id} `, ""),
                              );
                              setMention(null);
                            }}
                          >
                            <HarnessIcon name="close" size={13} />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <textarea
                    ref={input}
                    aria-label="消息"
                    rows={2}
                    placeholder={
                      chat.activeId
                        ? "告诉我接下来想做点什么"
                        : "聊聊你的想法，或交给我一件事"
                    }
                    value={text}
                    aria-expanded={!!mention}
                    onChange={(e) => {
                      setText(e.target.value);
                      setReferences((old) =>
                        old.filter(
                          (ref) =>
                            !text.includes(`@${ref.name || ref.id}`) ||
                            e.target.value.includes(`@${ref.name || ref.id}`),
                        ),
                      );
                      setMention(
                        e.nativeEvent.isComposing
                          ? null
                          : mentionAt(
                              e.target.value,
                              e.target.selectionStart,
                              references,
                            ),
                      );
                      e.target.style.height = "auto";
                      e.target.style.height =
                        Math.min(e.target.scrollHeight, 220) + "px";
                    }}
                    onCompositionEnd={(e) =>
                      setMention(
                        mentionAt(
                          e.target.value,
                          e.target.selectionStart,
                          references,
                        ),
                      )
                    }
                    onClick={(e) =>
                      setMention(
                        mentionAt(
                          e.target.value,
                          e.target.selectionStart,
                          references,
                        ),
                      )
                    }
                    onPaste={(e) => {
                      const files = [...e.clipboardData.items]
                        .filter((i) => i.kind === "file")
                        .map((i) => i.getAsFile())
                        .filter(Boolean);
                      if (files.length) {
                        e.preventDefault();
                        void upload(files);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (mention && mentionPicker.current?.keyDown(e)) return;
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void submit();
                      }
                    }}
                  />
                  <footer className="composer-toolbar">
                    <div className="menu-anchor">
                      <IconButton
                        label="添加"
                        disabled={uploading}
                        aria-haspopup="menu"
                        aria-expanded={menu?.type === "add"}
                        onClick={() =>
                          setMenu(menu?.type === "add" ? null : { type: "add" })
                        }
                      >
                        <HarnessIcon name="plus" size={20} />
                      </IconButton>
                      {menu?.type === "add" ? (
                        <Menu
                          label="添加到消息"
                          className="above"
                          onClose={closeMenu}
                        >
                          <button
                            role="menuitem"
                            onClick={() => {
                              fileInput.current.click();
                              closeMenu();
                            }}
                          >
                            <HarnessIcon name="paperclip" size={15} />
                            上传图片或文件
                          </button>
                          <button role="menuitem" onClick={openReferences}>
                            <HarnessIcon name="connector" size={15} />
                            引用项目资产
                          </button>
                          <button role="menuitem" onClick={() => {
                            closeMenu();
                            setDialog({ type: "advanced" });
                          }}>
                            <HarnessIcon name="settings" size={15} />
                            高级设置
                          </button>
                        </Menu>
                      ) : null}
                    </div>
                    <input
                      ref={fileInput}
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => {
                        void upload([...e.target.files]);
                        e.target.value = "";
                      }}
                    />
                    {chat.executors.length > 1 && !pinnedExecutor ? (
                      <PermissionPicker
                        label="CLI"
                        options={chat.executors.map((executor) => {
                          const brand = engineBrand(executor.id);
                          return {
                            ...executor,
                            glyph: hasProviderLogo(brand)
                              ? <ModelProviderIcon brand={brand} size={16} />
                              : null,
                          };
                        })}
                        value={chat.executor}
                        onSelect={(id) => {
                          chat.setExecutor(id);
                          input.current?.focus();
                        }}
                        open={menu?.type === "executor"}
                        onOpenChange={(open) => setMenu(open ? { type: "executor" } : null)}
                      />
                    ) : null}
                    <ModelPicker
                      models={chat.models}
                      value={chat.model}
                      label={modelLabel}
                      open={menu?.type === "model"}
                      onOpenChange={(open) => setMenu(open ? { type: "model" } : null)}
                      onSelect={(id) => {
                        chat.setModel(id);
                        input.current?.focus();
                      }}
                    />
                    <PermissionPicker
                      label="思考强度"
                      options={effortOptions(selectedModel)}
                      value={chat.effort}
                      onSelect={chat.setEffort}
                      open={menu?.type === "effort"}
                      onOpenChange={(open) => setMenu(open ? { type: "effort" } : null)}
                    />
                    <PermissionPicker
                      value={approval}
                      onSelect={setApproval}
                      open={menu?.type === "approval"}
                      onOpenChange={(open) => setMenu(open ? { type: "approval" } : null)}
                    />
                    <span className="toolbar-spacer" />
                    {uploading ? (
                      <span className="upload-status">上传中…</span>
                    ) : null}
                    {chat.busy ? (
                      <button
                        className="send-button stop"
                        aria-label="停止生成"
                        title="停止并保留已经生成的内容；排队的消息会暂停发送"
                        disabled={
                          chat.submitting || chat.stopping || chat.generation?.status !== "running"
                        }
                        onClick={chat.stop}
                      >
                        <HarnessIcon name="chat-stop" size={14} />
                      </button>
                    ) : null}
                    {!chat.busy || text.trim() || attachments.length ? (
                      <button
                        className="send-button"
                        aria-label={chat.busy ? "排队发送" : "发送消息"}
                        title={chat.busy ? "当前回复结束后自动发送" : undefined}
                        disabled={
                          !chat.ready ||
                          chat.submitting ||
                          chat.machineSaving ||
                          (chat.activeId && chat.session?.id !== chat.activeId) ||
                          (!text.trim() && !attachments.length) ||
                          uploading
                        }
                        onClick={submit}
                      >
                        <HarnessIcon name="chat-send" size={20} />
                      </button>
                    ) : null}
                  </footer>
                </div>
              </div>
            )}
          </div>
        </div>
        {!chat.activeId && !chat.readOnly ? (
          <section className="home-starters" aria-label="可以这样开始">
            <div className="home-starter-grid">
              {homeStarters.map((starter, index) => (
                <button
                  type="button"
                  className={`home-starter home-starter-${starter.tone}`}
                  key={starter.id || starter.title}
                  style={{ "--card-index": index }}
                  onClick={() => handleStarter(starter)}
                >
                  <span className="home-starter-top">
                    <span className="home-starter-icon">
                      <HarnessIcon name={starter.icon} size={21} />
                    </span>
                    <HarnessIcon
                      name="chevron-right"
                      className="home-starter-arrow"
                      size={16}
                      aria-hidden="true"
                    />
                  </span>
                  <strong>{starter.title}</strong>
                  <span className="home-starter-description">
                    {starter.description}
                  </span>
                  <span className="home-starter-flow" aria-hidden="true">
                    {starter.steps.map((step) => (
                      <span key={step}>
                        <i />
                        {step}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </main>
      {artifactPresence.mounted ? (
        <ArtifactPanel
          open={artifactPanelVisible}
          operationContext={operationContext}
          artifacts={artifactList}
          runs={conversationRuns}
          selected={
            artifactList.find((a) => a.id === selectedArtifact?.id) ||
            selectedArtifact
          }
          setSelected={setSelectedArtifact}
          chat={chat}
          view={panelView}
          onViewChange={setPanelView}
          workspaceChanges={workspaceChanges}
          workspaceRunId={workspaceRunId}
          browserRequest={browserRequest}
          onBrowserRequestHandled={browserRequestHandled}
          onAddElement={chat.readOnly ? null : addElementReference}
          onClose={() => setPanel(false)}
        />
      ) : null}
      <IssueContext
        chat={chat}
        open={issueContextOpen}
        onClose={() => {
          setIssueContextOpen(false);
          requestAnimationFrame(() => input.current?.focus());
        }}
        hideTrigger
      />
      {dialog ? (
        <Dialog
          title={
            {
              search: "搜索会话",
              rename: "重命名会话",
              delete: "删除会话",
              edit: dialog.fork ? "创建分支" : "编辑消息",
              settings: "设置",
              advanced: "高级设置",
            }[dialog.type]
          }
          onClose={closeDialog}
          footer={
            ["rename", "edit", "delete"].includes(dialog.type) ? (
              <>
                <button className="quiet-button" onClick={closeDialog}>
                  取消
                </button>
                <button
                  className={
                    dialog.type === "delete"
                      ? "danger-button"
                      : "primary-button"
                  }
                  onClick={async () => {
                    if (dialog.type === "delete") {
                      await chat.remove(dialog.session.id);
                      closeDialog();
                    } else if (dialog.type === "rename") {
                      if (
                        await chat.rename(
                          dialog.session.id,
                          dialog.value.trim(),
                        )
                      )
                        closeDialog();
                    } else {
                      const stored = await chat.edit(
                        dialog.index,
                        dialog.value,
                        dialog.fork,
                      );
                      if (stored) {
                        closeDialog();
                        await chat.regenerate(stored, approval);
                      }
                    }
                  }}
                  disabled={dialog.type !== "delete" && !dialog.value?.trim()}
                >
                  {dialog.type === "delete"
                    ? "删除"
                    : dialog.type === "rename"
                      ? "保存"
                      : dialog.fork
                        ? "创建并继续"
                        : "保存并重新生成"}
                </button>
              </>
            ) : dialog.type === "advanced" ? (
              <button className="primary-button" onClick={closeDialog}>完成</button>
            ) : null
          }
        >
          {dialog.type === "search" ? (
            <>
              <label className="dialog-search">
                <HarnessIcon name="search" size={17} />
                <input
                  autoFocus
                  aria-label="搜索会话名称"
                  placeholder="搜索会话名称或项目"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="search-results">
                {searchGroups.map((group) => (
                  <section
                    key={group.projectId}
                    aria-label={`${group.name}的搜索结果`}
                  >
                    <div className="date-label">{group.name}</div>
                    {group.sessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          chat.open(s.id);
                          closeDialog();
                          setQuery("");
                        }}
                      >
                        <HarnessIcon name="new-request" size={16} />
                        <span>
                          {s.displayTitle || s.title}
                          <small>
                            {sessionProjectName(s.projectId, chat.projects)}
                            {s.archived ? " · 已归档" : ""}
                          </small>
                        </span>
                      </button>
                    ))}
                  </section>
                ))}
                {!searchGroups.length ? (
                  <p className="end-label">没有匹配的会话</p>
                ) : null}
              </div>
            </>
          ) : dialog.type === "rename" ? (
            <label className="field">
              会话名称
              <input
                autoFocus
                value={dialog.value}
                onChange={(e) =>
                  setDialog({ ...dialog, value: e.target.value })
                }
                onKeyDown={async (e) => {
                  if (
                    e.key === "Enter" &&
                    dialog.value.trim() &&
                    (await chat.rename(dialog.session.id, dialog.value.trim()))
                  )
                    closeDialog();
                }}
              />
            </label>
          ) : dialog.type === "delete" ? (
            <p>
              删除“{dialog.session.title}”的聊天记录？本对话里还没提交 MR
              的需求单会一并删除，已提交 MR 的需求和已保存的 SOP 会保留。
            </p>
          ) : dialog.type === "edit" ? (
            <>
              <textarea
                className="edit-message"
                autoFocus
                value={dialog.value}
                onChange={(e) =>
                  setDialog({ ...dialog, value: e.target.value })
                }
              />
              <p className="muted">
                {dialog.fork
                  ? "创建独立分支，保留原会话。"
                  : "这条消息之后的对话会重新生成，已执行的平台操作不会因此撤回。"}
              </p>
            </>
          ) : dialog.type === "advanced" ? (
            <>
              <p className="muted">默认自动使用项目配置的环境，无需选择。以下设置只影响你的界面。</p>
              <label className="settings-row">
                <span>显示运行环境选择</span>
                <HarnessSelect
                  ariaLabel="高级环境选项"
                  value={showEnvironmentPicker ? "show" : "hide"}
                  onChange={(e) => changeEnvironmentVisibility(e.target.value === "show")}
                  options={[{ value: "hide", label: "隐藏（默认）" }, { value: "show", label: "显示" }]}
                />
              </label>
              <p className="muted">开启后，可在项目旁调整对话的运行环境。隐藏入口不会改变已选环境或已有工作区。</p>
            </>
          ) : dialog.type === "settings" ? (
            <>
              <label className="settings-row">
                <span>外观</span>
                <HarnessSelect
                  value={theme}
                  ariaLabel="外观"
                  onChange={(e) => setTheme(e.target.value)}
                  options={THEME_OPTIONS}
                />
              </label>
              <button
                className="settings-row"
                onClick={() => navigate("settings")}
              >
                <span>个人配置与模型凭据</span>
                <ChevronRightSmall />
              </button>
              <button
                className="settings-row"
                onClick={() => navigate("runners")}
              >
                <span>执行机器</span>
                <ChevronRightSmall />
              </button>
              <small className="muted">
                {chat.user?.chineseName || chat.user?.loginName}
              </small>
            </>
          ) : null}
        </Dialog>
      ) : null}
      {imagePreview ? (
        <ImageLightbox
          src={imagePreview.src}
          alt={imagePreview.name}
          onClose={() => setImagePreview(null)}
        />
      ) : null}
      <QuickAccessWizard
        open={quickAccessOpen}
        user={chat.user}
        projects={chat.projects}
        projectId={chat.projectId}
        defaultModel={chat.model}
        sponsoredModel={chat.sponsoredModel}
        sponsoredModels={chat.sponsoredModels}
        onClose={() => setQuickAccessOpen(false)}
        onOpenView={(view) => navigate(view)}
        onCredentialsSaved={chat.refreshUser}
        onCompleted={async (nextProjectId) => {
          await chat.refresh();
          if (nextProjectId) await chat.selectProject(nextProjectId);
        }}
      />
    </div>
    </AgentBrowserLinks.Provider>
  );
}
function ChevronRightSmall() {
  return (
    <HarnessIcon name="chevron-right" size={14} className="small-chevron" />
  );
}
function formatFileSize(size) {
  const n = Number(size) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
