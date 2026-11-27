import React, { useCallback, useEffect, useState } from "react";
import {
  FolderGit2,
  Plus,
  X,
  Minus,
  Square,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  Archive,
  ArchiveRestore,
  GitBranch,
  Tag as TagIcon,
  Terminal,
  FolderOpen,
  CheckCircle2,
  Cloud,
  Search,
  AlertTriangle,
  Settings,
  User,
  ChevronDown,
  Copy,
  Check,
  Sparkles,
  RotateCw,
  FolderTree,
} from "lucide-react";
import { Events } from "@wailsio/runtime";
import type {
  BranchInfo,
  CommandEvent,
  CommitItem,
  FileStatus,
  RemoteInfo,
  RepoLocation,
  RepoStatus,
  StashItem,
  TagInfo,
  WorktreeInfo,
} from "../bindings/gitpulse/internal/git/models";
import { GitService, UpdateService } from "../bindings/gitpulse";
import type { UpdateStatus } from "../bindings/gitpulse";
import type { AppSettings } from "../bindings/gitpulse/internal/store/models";
import { Sidebar } from "./components/Sidebar";
import { ChangesView } from "./components/ChangesView";
import { HistoryView } from "./components/HistoryView";
import { ConflictView } from "./components/ConflictView";
import { SplitHandle } from "./components/SplitHandle";
import { UpdateModal } from "./components/UpdateModal";
import { AppSettingsModal } from "./components/AppSettingsModal";
import {
  DEFAULT_LAYOUT,
  LayoutPrefs,
  clamp,
  hasPersistedLayout,
  loadCachedLayout,
  normalizeLayout,
  saveCachedLayout,
} from "./utils/layout";
import { RepoModal } from "./components/RepoModal";
import { GitConfigModal, httpsToSshUrl } from "./components/GitConfigModal";
import {
  CheckoutConflictModal,
  ConfirmDangerModal,
  CreateBranchModal,
  CreateTagModal,
  DeleteBranchModal,
  DeleteRemoteBranchModal,
  DeleteRemoteTagModal,
  DeleteTagModal,
  DiscardConfirmModal,
  PushTagModal,
  RenameBranchModal,
  ResetCommitModal,
  RevertCommitModal,
  StashModal,
} from "./components/Dialogs";
import {
  CreateWorktreeModal,
  CreateWorktreePayload,
  LockWorktreeModal,
  RemoveWorktreeModal,
  WorktreeInUseModal,
} from "./components/WorktreeModals";

const DEFAULT_APP_SETTINGS: AppSettings = {
  autoCheckUpdates: true,
  fontSize: 13,
  diffFontSize: 12,
  autoRefreshOnFocus: true,
  defaultHistoryScope: "all",
  ignoreWhitespace: false,
  githubToken: "",
};

function loadCachedAppSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem("mygit.appSettings");
    if (!raw) return DEFAULT_APP_SETTINGS;
    return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

function applyAppFontVars(s: AppSettings) {
  const ui = Math.min(18, Math.max(11, s.fontSize || 13));
  const diff = Math.min(18, Math.max(10, s.diffFontSize || 12));
  const root = document.documentElement;
  root.style.setProperty("--ui-font-size", `${ui}px`);
  root.style.setProperty("--ui-font-delta", `${ui - 13}px`);
  root.style.setProperty("--diff-font-size", `${diff}px`);
}

type ViewMode = "history" | "changes" | "conflicts";

function isValidHistoryRef(
  ref: string,
  branches: BranchInfo[],
  tags: TagInfo[],
  stashes: StashItem[] = []
): boolean {
  if (!ref || ref === "__ALL__") return true;
  if (branches.some((b) => b.fullName === ref || b.name === ref)) return true;
  if (tags.some((t) => `refs/tags/${t.name}` === ref || t.name === ref)) return true;
  if (stashes.some((s) => s.ref === ref)) return true;
  return false;
}

interface ToastMsg {
  id: number;
  type: "success" | "error" | "info";
  text: string;
}

function formatCmdDuration(ms: number): string {
  if (!ms || ms < 1) return "<1ms";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCmdTime(ts: number): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

export function App() {
  const [tabs, setTabs] = useState<RepoLocation[]>([]);
  const [tabsHydrated, setTabsHydrated] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [draggingTabPath, setDraggingTabPath] = useState<string | null>(null);
  const tabStripRef = React.useRef<HTMLDivElement | null>(null);
  const tabElRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const suppressTabClickRef = React.useRef(false);
  const tabDragCleanupRef = React.useRef<(() => void) | null>(null);
  const [view, setView] = useState<ViewMode>("changes");
  const [historyBranchState, setHistoryBranchState] = useState<{
    repoPath: string;
    ref: string;
  }>({ repoPath: "", ref: "__ALL__" });
  const [branchScopeMode, setBranchScopeMode] = useState<"branch" | "all">("all");
  const [lastBranchRefState, setLastBranchRefState] = useState<{
    repoPath: string;
    ref: string;
  }>({ repoPath: "", ref: "" });

  const historyBranch =
    activePath && historyBranchState.repoPath === activePath
      ? historyBranchState.ref
      : "__ALL__";
  const lastBranchRef =
    activePath && lastBranchRefState.repoPath === activePath
      ? lastBranchRefState.ref
      : "";

  const setHistoryBranch = useCallback(
    (ref: string) => {
      setHistoryBranchState({ repoPath: activePath ?? "", ref });
    },
    [activePath]
  );
  const setLastBranchRef = useCallback(
    (ref: string) => {
      setLastBranchRefState({ repoPath: activePath ?? "", ref });
    },
    [activePath]
  );
  const [focusCommitSignal, setFocusCommitSignal] = useState<{
    sha: string;
    nonce: number;
  } | null>(null);

  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [stashes, setStashes] = useState<StashItem[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [pinnedBranches, setPinnedBranches] = useState<string[]>([]);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [globalGitVer, setGlobalGitVer] = useState("");
  const [quickFilter, setQuickFilter] = useState("");
  const [repoSwitcherOpen, setRepoSwitcherOpen] = useState(false);
  const [commandLogs, setCommandLogs] = useState<CommandEvent[]>([]);
  const [cmdHistoryOpen, setCmdHistoryOpen] = useState(false);
  const [copiedCmdId, setCopiedCmdId] = useState<string | null>(null);
  const [tabCtxMenu, setTabCtxMenu] = useState<{
    x: number;
    y: number;
    repo: RepoLocation;
  } | null>(null);

  // Remote loading states
  const [remoteBusy, setRemoteBusy] = useState<"fetch" | "pull" | "push" | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Modals
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [discardTargets, setDiscardTargets] = useState<FileStatus[]>([]);
  const [branchModal, setBranchModal] = useState<{
    open: boolean;
    startPoint: string;
    defaultCheckout: boolean;
  }>({
    open: false,
    startPoint: "",
    defaultCheckout: true,
  });
  const [renameBranchTarget, setRenameBranchTarget] = useState<string | null>(null);
  const [deleteBranchTarget, setDeleteBranchTarget] = useState<string | null>(null);
  const [deleteRemoteTarget, setDeleteRemoteTarget] = useState<string | null>(null);
  const [deletingRemote, setDeletingRemote] = useState(false);
  const [checkoutConflict, setCheckoutConflict] = useState<{
    name: string;
    isRemote: boolean;
    kind?: "branch" | "tag";
    errorMessage: string;
  } | null>(null);
  const [stashModalOpen, setStashModalOpen] = useState(false);
  const [dropStashTarget, setDropStashTarget] = useState<StashItem | null>(null);
  const [tagModal, setTagModal] = useState<{ open: boolean; target: string }>({
    open: false,
    target: "",
  });
  const [deleteTagTarget, setDeleteTagTarget] = useState<TagInfo | null>(null);
  const [deleteRemoteTagTarget, setDeleteRemoteTagTarget] = useState<TagInfo | null>(null);
  const [pushTagTarget, setPushTagTarget] = useState<TagInfo | null>(null);
  const [tagOpBusy, setTagOpBusy] = useState(false);
  const [revertTarget, setRevertTarget] = useState<CommitItem | null>(null);
  const [resetTarget, setResetTarget] = useState<CommitItem | null>(null);
  const [createWorktreeModal, setCreateWorktreeModal] = useState<{
    open: boolean;
    mode: "new-branch" | "existing-branch" | "detach";
    branch: string;
    baseRef: string;
  }>({
    open: false,
    mode: "new-branch",
    branch: "",
    baseRef: "",
  });
  const [removeWorktreeTarget, setRemoveWorktreeTarget] = useState<WorktreeInfo | null>(null);
  const [lockWorktreeTarget, setLockWorktreeTarget] = useState<WorktreeInfo | null>(null);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeInUsePrompt, setWorktreeInUsePrompt] = useState<{
    branchName: string;
    worktree: WorktreeInfo | null;
    errorMessage: string;
  } | null>(null);
  const [gitConfigModal, setGitConfigModal] = useState<{
    open: boolean;
    scope: "local" | "global";
    expandAdvanced?: boolean;
  }>({ open: false, scope: "local" });
  const [effectiveAuthor, setEffectiveAuthor] = useState<{
    name: string;
    email: string;
    source: "local" | "global" | "none";
  }>({ name: "", email: "", source: "none" });
  const [httpsRemotePrompt, setHttpsRemotePrompt] = useState<{
    remoteName: string;
    currentUrl: string;
    sshUrl: string;
    errorMessage: string;
  } | null>(null);
  const [remoteConfigPrompt, setRemoteConfigPrompt] = useState<{
    kind: "NO_REMOTE" | "REMOTE_ACCESS_ERROR" | "NO_UPSTREAM";
    op: "fetch" | "pull" | "push" | "tag";
    remoteName: string;
    currentUrl: string;
    draftUrl: string;
    localBranch: string;
    targetBranch: string;
    availableRemotes: { name: string; url: string }[];
    availableRemoteBranches: string[];
    fetchingBranches?: boolean;
    errorMessage: string;
  } | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(() =>
    loadCachedAppSettings()
  );
  const appSettingsRef = React.useRef<AppSettings>(appSettings);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: "idle",
    currentVersion: "",
    available: null,
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
    canSelfUpdate: true,
    repoUrl: "https://github.com/over-star/my-git",
    releasesUrl: "https://github.com/over-star/my-git/releases",
  });

  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [layout, setLayout] = useState<LayoutPrefs>(() => loadCachedLayout());
  const layoutRef = React.useRef<LayoutPrefs>(layout);
  const sidebarStartWidthRef = React.useRef<number>(layout.sidebarWidth);

  const updateLayout = useCallback(
    (patch: Partial<LayoutPrefs>, persist: boolean) => {
      const next = normalizeLayout({ ...layoutRef.current, ...patch });
      layoutRef.current = next;
      setLayout(next);
      if (persist) {
        saveCachedLayout(next);
        GitService.SaveLayoutState(next).catch(() => {});
      }
    },
    []
  );

  const updateAppSettings = useCallback((patch: Partial<AppSettings>) => {
    const next: AppSettings = { ...appSettingsRef.current, ...patch };
    appSettingsRef.current = next;
    setAppSettings(next);
    applyAppFontVars(next);
    try {
      window.localStorage.setItem("mygit.appSettings", JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
    GitService.SaveAppSettings(next)
      .then((saved) => {
        if (!saved) return;
        appSettingsRef.current = saved;
        setAppSettings(saved);
        applyAppFontVars(saved);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    applyAppFontVars(appSettings);
  }, []);

  const notify = useCallback((type: "success" | "error" | "info", text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, type === "error" ? 8000 : 4500);
  }, []);

  const activeRepo = tabs.find((t) => t.path === activePath) ?? null;

  const refreshSeqRef = React.useRef(0);
  const repoCacheRef = React.useRef<
    Record<
      string,
      {
        status: RepoStatus | null;
        branches: BranchInfo[];
        tags: TagInfo[];
        stashes: StashItem[];
        remotes: RemoteInfo[];
        worktrees: WorktreeInfo[];
        pinnedBranches: string[];
        effectiveAuthor: {
          name: string;
          email: string;
          source: "local" | "global" | "none";
        };
      }
    >
  >({});

  const updateRepoCache = useCallback(
    (
      repoPath: string,
      patch: Partial<{
        status: RepoStatus | null;
        branches: BranchInfo[];
        tags: TagInfo[];
        stashes: StashItem[];
        remotes: RemoteInfo[];
        worktrees: WorktreeInfo[];
        pinnedBranches: string[];
        effectiveAuthor: {
          name: string;
          email: string;
          source: "local" | "global" | "none";
        };
      }>
    ) => {
      const prev = repoCacheRef.current[repoPath] ?? {
        status: null,
        branches: [],
        tags: [],
        stashes: [],
        remotes: [],
        worktrees: [],
        pinnedBranches: [],
        effectiveAuthor: { name: "", email: "", source: "none" as const },
      };
      repoCacheRef.current[repoPath] = { ...prev, ...patch };
    },
    []
  );

  const refreshRepo = useCallback(
    async (repoPath?: string, opts?: { skipHistoryBump?: boolean }) => {
      const target = repoPath ?? activePath;
      if (!target) return;
      const seq = ++refreshSeqRef.current;
      setRefreshing(true);
      let firstError: unknown = null;

      const tasks = [
        GitService.ListBranches(target)
          .then((br) => {
            if (seq !== refreshSeqRef.current) return;
            const nextBranches = br ?? [];
            setBranches(nextBranches);
            updateRepoCache(target, { branches: nextBranches });
            setLastBranchRefState((prev) =>
              prev.repoPath === target &&
              prev.ref &&
              !nextBranches.some((b) => b.fullName === prev.ref || b.name === prev.ref)
                ? { repoPath: target, ref: "" }
                : prev
            );
            setHistoryBranchState((prev) =>
              prev.repoPath === target &&
              prev.ref !== "__ALL__" &&
              !prev.ref.startsWith("refs/tags/") &&
              !prev.ref.startsWith("stash@{") &&
              !isValidHistoryRef(prev.ref, nextBranches, [])
                ? { repoPath: target, ref: "__ALL__" }
                : prev
            );
          })
          .catch((err) => {
            if (firstError === null) firstError = err;
          }),

        GitService.GetPinnedBranches(target)
          .catch(() => [] as string[])
          .then((pins) => {
            if (seq !== refreshSeqRef.current) return;
            const nextPins = pins ?? [];
            setPinnedBranches(nextPins);
            updateRepoCache(target, { pinnedBranches: nextPins });
          }),

        GitService.GetStatus(target, appSettingsRef.current.ignoreWhitespace)
          .then((st) => {
            if (seq !== refreshSeqRef.current) return;
            setStatus(st);
            updateRepoCache(target, { status: st });
          })
          .catch((err) => {
            if (firstError === null) firstError = err;
          }),

        GitService.ListTags(target)
          .then((tg) => {
            if (seq !== refreshSeqRef.current) return;
            const nextTags = tg ?? [];
            setTags(nextTags);
            updateRepoCache(target, { tags: nextTags });
            setHistoryBranchState((prev) =>
              prev.repoPath === target &&
              prev.ref.startsWith("refs/tags/") &&
              !isValidHistoryRef(prev.ref, [], nextTags)
                ? { repoPath: target, ref: "__ALL__" }
                : prev
            );
          })
          .catch((err) => {
            if (firstError === null) firstError = err;
          }),

        GitService.ListStashes(target)
          .then((sh) => {
            if (seq !== refreshSeqRef.current) return;
            const nextStashes = sh ?? [];
            setStashes(nextStashes);
            updateRepoCache(target, { stashes: nextStashes });
            setHistoryBranchState((prev) =>
              prev.repoPath === target &&
              prev.ref.startsWith("stash@{") &&
              !isValidHistoryRef(prev.ref, [], [], nextStashes)
                ? { repoPath: target, ref: "__ALL__" }
                : prev
            );
          })
          .catch((err) => {
            if (firstError === null) firstError = err;
          }),

        GitService.ListRemotes(target)
          .catch(() => [] as RemoteInfo[])
          .then((rm) => {
            if (seq !== refreshSeqRef.current) return;
            const nextRemotes = rm ?? [];
            setRemotes(nextRemotes);
            updateRepoCache(target, { remotes: nextRemotes });
          }),

        GitService.ListWorktrees(target)
          .catch(() => [] as WorktreeInfo[])
          .then((wts) => {
            if (seq !== refreshSeqRef.current) return;
            const nextWts = wts ?? [];
            setWorktrees(nextWts);
            updateRepoCache(target, { worktrees: nextWts });
          }),

        GitService.GetGitConfig(target, "")
          .then((cfg) => {
            if (seq !== refreshSeqRef.current) return;
            const effName = cfg?.effective?.userName ?? "";
            const effEmail = cfg?.effective?.userEmail ?? "";
            const hasLocalOverride = Boolean(
              cfg?.local?.userName || cfg?.local?.userEmail
            );
            const nextAuthor = {
              name: effName,
              email: effEmail,
              source: (effName || effEmail
                ? hasLocalOverride
                  ? "local"
                  : "global"
                : "none") as "local" | "global" | "none",
            };
            setEffectiveAuthor(nextAuthor);
            updateRepoCache(target, { effectiveAuthor: nextAuthor });
          })
          .catch((err) => {
            if (firstError === null) firstError = err;
          }),
      ];

      await Promise.allSettled(tasks);
      if (seq !== refreshSeqRef.current) return;
      if (firstError !== null) {
        notify("error", `Refresh failed: ${firstError}`);
      } else if (!opts?.skipHistoryBump) {
        setHistoryRefreshKey((k) => k + 1);
        const curTab = tabs.find((t) => t.path === target);
        if (curTab?.commonDir) {
          for (const t of tabs) {
            if (t.path !== target && t.commonDir === curTab.commonDir) {
              delete repoCacheRef.current[t.path];
            }
          }
        }
      }
      setRefreshing(false);
    },
    [activePath, notify, tabs, updateRepoCache]
  );

  // Restore saved tabs & layout on startup
  useEffect(() => {
    GitService.GetGitGlobalVersion().then(setGlobalGitVer).catch(() => {});
    GitService.GetLayoutState()
      .then((saved) => {
        if (hasPersistedLayout(saved)) {
          const normalized = normalizeLayout(saved);
          layoutRef.current = normalized;
          setLayout(normalized);
          saveCachedLayout(normalized);
        }
      })
      .catch(() => {});
    GitService.GetSavedTabs()
      .then(async (saved) => {
        const paths = saved.tabs ?? [];
        if (paths.length === 0) {
          setRepoModalOpen(true);
          return;
        }
        const results = await Promise.allSettled(
          paths.map((p) => GitService.OpenRepo(p))
        );
        const loaded: RepoLocation[] = [];
        for (const r of results) {
          if (r.status === "fulfilled") {
            loaded.push(r.value);
          }
        }
        if (loaded.length === 0) {
          setRepoModalOpen(true);
          return;
        }
        setTabs(loaded);
        const active =
          saved.activeTab && loaded.some((l) => l.path === saved.activeTab)
            ? saved.activeTab
            : loaded[0].path;
        setActivePath(active);
      })
      .catch(() => setRepoModalOpen(true))
      .finally(() => setTabsHydrated(true));

    UpdateService.GetUpdateStatus()
      .then((st) => {
        if (st) setUpdateStatus(st);
      })
      .catch(() => {});

    const offUpdate = Events.On("update:status", (ev: any) => {
      const payload = (ev?.data ?? ev) as UpdateStatus;
      if (payload && payload.state) {
        setUpdateStatus(payload);
      }
    });

    const offCommand = Events.On("git:command", (ev: any) => {
      const payload = (ev?.data ?? ev) as CommandEvent;
      if (!payload || !payload.id || !payload.command) return;
      setCommandLogs((prev) => {
        const idx = prev.findIndex((item) => item.id === payload.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = payload;
          return next;
        }
        return [payload, ...prev].slice(0, 40);
      });
    });

    const offOpenRepo = Events.On("app:open-repo", (ev: any) => {
      const rawPath = String(ev?.data ?? ev ?? "").trim();
      if (!rawPath) return;
      GitService.OpenRepo(rawPath)
        .then((loc) => handleOpenedRepo(loc))
        .catch(() => {});
    });

    let updateTimer = 0;
    GitService.GetAppSettings()
      .then((loaded) => {
        const merged = { ...DEFAULT_APP_SETTINGS, ...loaded };
        appSettingsRef.current = merged;
        setAppSettings(merged);
        applyAppFontVars(merged);
        try {
          window.localStorage.setItem("mygit.appSettings", JSON.stringify(merged));
        } catch {
          // ignore
        }
        if (merged.autoCheckUpdates) {
          updateTimer = window.setTimeout(() => {
            UpdateService.CheckForUpdate()
              .then((st) => {
                if (st) setUpdateStatus(st);
              })
              .catch(() => {});
          }, 2500);
        }
      })
      .catch(() => {});

    return () => {
      offUpdate();
      offCommand();
      offOpenRepo();
      tabDragCleanupRef.current?.();
      if (updateTimer) window.clearTimeout(updateTimer);
    };
  }, []);

  // Persist tabs whenever changed (skip intermediate writes mid-drag)
  useEffect(() => {
    if (!tabsHydrated || draggingTabPath) return;
    GitService.SaveOpenTabs(
      tabs.map((t) => t.path),
      activePath ?? ""
    );
  }, [tabs, activePath, tabsHydrated, draggingTabPath]);

  const prevIgnoreWsRef = React.useRef<boolean>(appSettings.ignoreWhitespace);
  useEffect(() => {
    if (prevIgnoreWsRef.current === appSettings.ignoreWhitespace) return;
    prevIgnoreWsRef.current = appSettings.ignoreWhitespace;
    for (const k of Object.keys(repoCacheRef.current)) {
      if (k !== activePath) {
        delete repoCacheRef.current[k];
      }
    }
    if (activePath) {
      refreshRepo(activePath, { skipHistoryBump: true });
    }
  }, [appSettings.ignoreWhitespace, activePath, refreshRepo]);

  // Refresh whenever activePath changes
  useEffect(() => {
    const scope =
      appSettingsRef.current.defaultHistoryScope === "branch" ? "branch" : "all";
    setBranchScopeMode(scope);
    setHistoryBranch("__ALL__");
    setLastBranchRef("");
    setFocusCommitSignal(null);
    const cached = activePath ? repoCacheRef.current[activePath] : undefined;
    if (cached) {
      setStatus(cached.status);
      setBranches(cached.branches);
      setTags(cached.tags);
      setStashes(cached.stashes);
      setRemotes(cached.remotes);
      setWorktrees(cached.worktrees);
      setPinnedBranches(cached.pinnedBranches);
      setEffectiveAuthor(cached.effectiveAuthor);
    } else {
      setStatus(null);
      setBranches([]);
      setTags([]);
      setStashes([]);
      setRemotes([]);
      setWorktrees([]);
      setPinnedBranches([]);
    }
    setRepoSwitcherOpen(false);
    setCmdHistoryOpen(false);
    setTabCtxMenu(null);
    if (activePath) {
      refreshRepo(activePath, { skipHistoryBump: true });
    }
  }, [activePath]);

  // Close repo switcher, command history or tab context menu on outside click / Escape
  useEffect(() => {
    if (!repoSwitcherOpen && !tabCtxMenu && !cmdHistoryOpen) return;
    const close = () => {
      setRepoSwitcherOpen(false);
      setCmdHistoryOpen(false);
      setTabCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [repoSwitcherOpen, tabCtxMenu, cmdHistoryOpen]);

  // Auto-refresh on window focus
  useEffect(() => {
    const onFocus = () => {
      if (activePath && appSettingsRef.current.autoRefreshOnFocus) {
        refreshRepo(activePath);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [activePath, refreshRepo]);

  // Ctrl+F shortcut to jump to History search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setView("history");
        const el = document.getElementById("global-quick-search");
        el?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleOpenedRepo = (loc: RepoLocation) => {
    const isSameActive = loc.path === activePath;
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === loc.path);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = loc;
        return copy;
      }
      return [...prev, loc];
    });
    setActivePath(loc.path);
    setRepoModalOpen(false);
    if (isSameActive) {
      refreshRepo(loc.path);
    }
  };

  const closeTabByPath = (repoPath: string) => {
    delete repoCacheRef.current[repoPath];
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== repoPath);
      if (activePath === repoPath) {
        setActivePath(next.length > 0 ? next[0].path : null);
        if (next.length === 0) setRepoModalOpen(true);
      }
      return next;
    });
  };

  const closeOtherTabs = (keepPath: string) => {
    const keepCache = repoCacheRef.current[keepPath];
    repoCacheRef.current = keepCache ? { [keepPath]: keepCache } : {};
    setTabs((prev) => prev.filter((t) => t.path === keepPath));
    setActivePath(keepPath);
  };

  const handleCloseTab = (e: React.MouseEvent, repoPath: string) => {
    e.stopPropagation();
    closeTabByPath(repoPath);
  };

  const promptHttpsRemoteIfNeeded = async (
    repoPath: string,
    errorMessage: string,
    preferredRemote?: string
  ): Promise<boolean> => {
    const list = await GitService.ListRemotes(repoPath).catch(() => []);
    const target = (list ?? []).find((r) => {
      if (preferredRemote && r.name !== preferredRemote) return false;
      const u = (r.pushUrl || r.fetchUrl || "").toLowerCase();
      return u.startsWith("https://") || u.startsWith("http://");
    });
    const sshCandidate = target
      ? httpsToSshUrl(target.pushUrl || target.fetchUrl)
      : null;
    if (target && sshCandidate) {
      setHttpsRemotePrompt({
        remoteName: target.name,
        currentUrl: target.pushUrl || target.fetchUrl,
        sshUrl: sshCandidate,
        errorMessage,
      });
      return true;
    }
    return false;
  };

  const promptRemoteConfigIfNeeded = async (
    repoPath: string,
    op: "fetch" | "pull" | "push" | "tag",
    errorCode: string | undefined,
    errorMessage: string,
    preferredRemote?: string
  ): Promise<boolean> => {
    if (
      errorCode !== "NO_REMOTE" &&
      errorCode !== "REMOTE_ACCESS_ERROR" &&
      errorCode !== "NO_UPSTREAM"
    ) {
      return false;
    }
    const [list, brs] = await Promise.all([
      GitService.ListRemotes(repoPath).catch(() => []),
      errorCode === "NO_UPSTREAM"
        ? GitService.ListBranches(repoPath).catch(() => [])
        : Promise.resolve([]),
    ]);
    const availableRemotes = (list ?? []).map((r) => ({
      name: r.name,
      url: r.pushUrl || r.fetchUrl || "",
    }));
    const match =
      availableRemotes.find((r) =>
        preferredRemote ? r.name === preferredRemote : r.name === "origin"
      ) ?? availableRemotes[0];
    const remoteName = match?.name || preferredRemote || "origin";
    const currentUrl = match?.url || "";

    const curBranch =
      (status?.branch && status.branch !== "HEAD" ? status.branch : "") || "";
    const remoteBranches = (brs ?? [])
      .filter((b) => b.isRemote && (!remoteName || b.remoteName === remoteName))
      .map((b) =>
        b.name.startsWith(`${remoteName}/`)
          ? b.name.slice(remoteName.length + 1)
          : b.name
      );
    const defaultTarget =
      (curBranch && remoteBranches.includes(curBranch) ? curBranch : "") ||
      curBranch ||
      remoteBranches[0] ||
      "main";

    // If remote list is completely empty, treat NO_UPSTREAM as NO_REMOTE
    const resolvedKind =
      errorCode === "NO_UPSTREAM" && availableRemotes.length === 0
        ? "NO_REMOTE"
        : errorCode;

    setRemoteConfigPrompt({
      kind: resolvedKind,
      op,
      remoteName,
      currentUrl,
      draftUrl: currentUrl,
      localBranch: curBranch,
      targetBranch: defaultTarget,
      availableRemotes,
      availableRemoteBranches: remoteBranches,
      errorMessage,
    });
    return true;
  };

  // --- Remote Actions ---
  const executePush = async (
    repoPath: string,
    opts?: { fromCommit?: boolean; amended?: boolean }
  ) => {
    if (!repoPath || remoteBusy) return;
    setRemoteBusy("push");
    try {
      const res = await GitService.Push(repoPath);
      if (res.success) {
        if (opts?.fromCommit) {
          notify(
            "success",
            opts.amended
              ? `Amended commit & pushed (${res.message})`
              : `Committed & pushed (${res.message})`
          );
        } else {
          notify("success", res.message);
        }
      } else if (
        res.errorCode === "HTTPS_REMOTE" &&
        (await promptHttpsRemoteIfNeeded(
          repoPath,
          res.message || "HTTPS push failed"
        ))
      ) {
        if (opts?.fromCommit) {
          notify(
            "info",
            "Commit succeeded locally. Switch remote to SSH to push."
          );
        }
      } else if (
        await promptRemoteConfigIfNeeded(
          repoPath,
          "push",
          res.errorCode,
          res.output || res.message || "push failed"
        )
      ) {
        if (opts?.fromCommit) {
          notify(
            "info",
            "Commit succeeded locally. Configure remote to push."
          );
        }
      } else {
        notify(
          "error",
          opts?.fromCommit
            ? `Committed locally, but push failed: ${res.message || "push failed"}`
            : res.message || "push failed"
        );
      }
      await refreshRepo(repoPath);
    } catch (err) {
      notify(
        "error",
        opts?.fromCommit
          ? `Committed locally, but push failed: ${err}`
          : String(err)
      );
      await refreshRepo(repoPath);
    } finally {
      setRemoteBusy(null);
    }
  };

  const handleRemote = async (op: "fetch" | "pull" | "push") => {
    if (!activeRepo || remoteBusy) return;
    if (op === "push") {
      await executePush(activeRepo.path);
      return;
    }
    setRemoteBusy(op);
    try {
      const res =
        op === "fetch"
          ? await GitService.Fetch(activeRepo.path)
          : await GitService.Pull(activeRepo.path);

      if (res.success) {
        notify("success", res.message);
      } else if (res.errorCode === "CONFLICT") {
        notify("error", "Pull resulted in merge conflicts! Resolve them in Conflict Resolver.");
        setView("conflicts");
      } else if (
        await promptRemoteConfigIfNeeded(
          activeRepo.path,
          op,
          res.errorCode,
          res.output || res.message || `${op} failed`
        )
      ) {
        // Remote config modal displayed
      } else {
        notify("error", res.message || `${op} failed`);
      }
      await refreshRepo(activeRepo.path);
    } catch (err) {
      notify("error", String(err));
    } finally {
      setRemoteBusy(null);
    }
  };

  // --- Worktree Actions ---
  const invalidateSiblingCaches = useCallback(
    (sourceRepo: RepoLocation | null) => {
      if (!sourceRepo?.commonDir) return;
      for (const t of tabs) {
        if (t.path !== sourceRepo.path && t.commonDir === sourceRepo.commonDir) {
          delete repoCacheRef.current[t.path];
        }
      }
    },
    [tabs]
  );

  const handleOpenWorktree = async (wt: WorktreeInfo) => {
    const existing = tabs.find(
      (t) => t.path.toLowerCase() === wt.path.toLowerCase()
    );
    if (existing) {
      setActivePath(existing.path);
      return;
    }
    try {
      const loc = await GitService.OpenRepo(wt.path);
      handleOpenedRepo(loc);
    } catch (err) {
      notify("error", `Failed to open worktree: ${err}`);
    }
  };

  const handleCreateWorktree = async (payload: CreateWorktreePayload) => {
    if (!activeRepo) return;
    setWorktreeBusy(true);
    try {
      const res = await GitService.AddWorktree(
        activeRepo.path,
        payload.targetPath,
        payload.branch,
        payload.baseRef,
        payload.createBranch,
        payload.detach,
        payload.force
      );
      if (!res.result.success) {
        if (res.result.errorCode === "WORKTREE_IN_USE") {
          const holder =
            worktrees.find((w) => w.branch === payload.branch) ?? null;
          setCreateWorktreeModal((m) => ({ ...m, open: false }));
          setWorktreeInUsePrompt({
            branchName: payload.branch,
            worktree: holder,
            errorMessage: res.result.output || res.result.message,
          });
          return;
        }
        notify("error", res.result.message || "Create worktree failed");
        return;
      }

      setCreateWorktreeModal((m) => ({ ...m, open: false }));
      notify("success", res.result.message);
      invalidateSiblingCaches(activeRepo);
      if (payload.openInTab && res.repo?.path) {
        const loc = await GitService.OpenRepo(res.repo.path).catch(
          () => res.repo
        );
        handleOpenedRepo(loc);
      } else {
        await refreshRepo(activeRepo.path);
      }
    } catch (err) {
      notify("error", String(err));
    } finally {
      setWorktreeBusy(false);
    }
  };

  const handleRemoveWorktree = async (
    wt: WorktreeInfo,
    force: boolean,
    unlockFirst: boolean
  ) => {
    if (!activeRepo) return;
    setWorktreeBusy(true);
    try {
      if (wt.isLocked && unlockFirst) {
        const unRes = await GitService.UnlockWorktree(activeRepo.path, wt.path);
        if (!unRes.success) {
          notify("error", unRes.message || "Failed to unlock worktree");
          return;
        }
      }
      const res = await GitService.RemoveWorktree(
        activeRepo.path,
        wt.path,
        force
      );
      if (!res.success) {
        notify("error", res.message || "Remove worktree failed");
        return;
      }
      setRemoveWorktreeTarget(null);
      notify("success", res.message);
      const openTab = tabs.find(
        (t) => t.path.toLowerCase() === wt.path.toLowerCase()
      );
      if (openTab) {
        closeTabByPath(openTab.path);
      }
      invalidateSiblingCaches(activeRepo);
      await refreshRepo(activeRepo.path);
    } catch (err) {
      notify("error", String(err));
    } finally {
      setWorktreeBusy(false);
    }
  };

  const handleLockWorktree = async (wt: WorktreeInfo, reason: string) => {
    if (!activeRepo) return;
    setWorktreeBusy(true);
    try {
      const res = await GitService.LockWorktree(
        activeRepo.path,
        wt.path,
        reason
      );
      if (res.success) {
        setLockWorktreeTarget(null);
        notify("success", res.message);
        invalidateSiblingCaches(activeRepo);
        await refreshRepo(activeRepo.path);
      } else {
        notify("error", res.message || "Lock worktree failed");
      }
    } catch (err) {
      notify("error", String(err));
    } finally {
      setWorktreeBusy(false);
    }
  };

  const handleUnlockWorktree = async (wt: WorktreeInfo) => {
    if (!activeRepo) return;
    try {
      const res = await GitService.UnlockWorktree(activeRepo.path, wt.path);
      if (res.success) {
        notify("success", res.message);
        invalidateSiblingCaches(activeRepo);
        await refreshRepo(activeRepo.path);
      } else {
        notify("error", res.message || "Unlock worktree failed");
      }
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handlePruneWorktrees = async () => {
    if (!activeRepo) return;
    try {
      const res = await GitService.PruneWorktrees(activeRepo.path);
      if (res.success) {
        notify("success", res.message);
        invalidateSiblingCaches(activeRepo);
        await refreshRepo(activeRepo.path);
      } else {
        notify("error", res.message || "Prune worktrees failed");
      }
    } catch (err) {
      notify("error", String(err));
    }
  };

  // --- Branch, Tag & Stash Actions ---
  const handleCheckout = async (name: string, isRemote: boolean) => {
    if (!activeRepo) return;
    try {
      const res = await GitService.CheckoutBranch(activeRepo.path, name, isRemote);
      if (res.success) {
        notify("success", res.message);
        await refreshRepo(activeRepo.path);
      } else if (res.errorCode === "DIRTY_WORKTREE") {
        setCheckoutConflict({
          name,
          isRemote,
          kind: "branch",
          errorMessage: res.output || res.message,
        });
      } else if (res.errorCode === "WORKTREE_IN_USE") {
        const localName =
          isRemote && name.includes("/")
            ? name.slice(name.indexOf("/") + 1)
            : name;
        const holder =
          worktrees.find((w) => w.branch === localName && !w.isCurrent) ?? null;
        setWorktreeInUsePrompt({
          branchName: localName,
          worktree: holder,
          errorMessage: res.output || res.message,
        });
      } else {
        notify("error", res.message || "Checkout failed");
      }
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleCheckoutTag = async (tagName: string) => {
    if (!activeRepo) return;
    try {
      const res = await GitService.CheckoutTag(activeRepo.path, tagName);
      if (res.success) {
        notify("success", res.message);
        await refreshRepo(activeRepo.path);
      } else if (res.errorCode === "DIRTY_WORKTREE") {
        setCheckoutConflict({
          name: tagName,
          isRemote: false,
          kind: "tag",
          errorMessage: res.output || res.message,
        });
      } else {
        notify("error", res.message || "Checkout tag failed");
      }
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleStashAndCheckout = async (
    name: string,
    isRemote: boolean,
    kind: "branch" | "tag" = "branch"
  ) => {
    if (!activeRepo) return;
    setCheckoutConflict(null);
    try {
      const stRes = await GitService.StashPush(
        activeRepo.path,
        `Auto-stash before switching to ${name}`,
        true
      );
      if (!stRes.success) {
        notify("error", stRes.message);
        return;
      }
      const ckRes =
        kind === "tag"
          ? await GitService.CheckoutTag(activeRepo.path, name)
          : await GitService.CheckoutBranch(activeRepo.path, name, isRemote);
      if (ckRes.success) {
        notify("success", `Stashed changes and checked out ${name}`);
      } else {
        notify("error", ckRes.message);
      }
      await refreshRepo(activeRepo.path);
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleMerge = async (branchName: string) => {
    if (!activeRepo) return;
    try {
      const res = await GitService.MergeBranch(activeRepo.path, branchName);
      if (res.success) {
        notify("success", res.message);
      } else if (res.errorCode === "CONFLICT") {
        notify("error", `Merge conflict when merging ${branchName}.`);
        setView("conflicts");
      } else {
        notify("error", res.message || "Merge failed");
      }
      await refreshRepo(activeRepo.path);
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleCreateBranch = async (name: string, startPoint: string, checkout: boolean) => {
    if (!activeRepo) return;
    setBranchModal({ open: false, startPoint: "", defaultCheckout: true });
    try {
      const res = await GitService.CreateBranch(activeRepo.path, name, startPoint, checkout);
      if (res.success) {
        notify("success", res.message);
        await refreshRepo(activeRepo.path);
      } else {
        notify("error", res.message);
      }
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleRenameBranch = async (oldName: string, newName: string) => {
    if (!activeRepo) return;
    setRenameBranchTarget(null);
    try {
      const res = await GitService.RenameBranch(activeRepo.path, oldName, newName);
      if (res.success) {
        notify("success", res.message);
        const oldFull = `refs/heads/${oldName}`;
        const newFull = `refs/heads/${newName}`;
        if (historyBranch === oldName || historyBranch === oldFull) {
          setHistoryBranch(newFull);
        }
        if (lastBranchRef === oldName || lastBranchRef === oldFull) {
          setLastBranchRef(newFull);
        }
        await refreshRepo(activeRepo.path);
      } else {
        notify("error", res.message);
      }
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleDeleteBranch = async (name: string, force: boolean) => {
    if (!activeRepo) return;
    setDeleteBranchTarget(null);
    try {
      const res = await GitService.DeleteBranch(activeRepo.path, name, force);
      if (res.success) {
        notify("success", res.message);
        const full = `refs/heads/${name}`;
        if (historyBranch === name || historyBranch === full) {
          setHistoryBranch("__ALL__");
        }
        if (lastBranchRef === name || lastBranchRef === full) {
          setLastBranchRef("");
        }
        await refreshRepo(activeRepo.path);
      } else {
        notify("error", res.message);
      }
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleDeleteRemoteBranch = async (remoteBranch: string) => {
    if (!activeRepo) return;
    setDeletingRemote(true);
    try {
      const res = await GitService.DeleteRemoteBranch(activeRepo.path, remoteBranch);
      setDeleteRemoteTarget(null);
      if (res.success) {
        notify("success", res.message);
        const full = `refs/remotes/${remoteBranch}`;
        if (historyBranch === remoteBranch || historyBranch === full) {
          setHistoryBranch("__ALL__");
        }
        if (lastBranchRef === remoteBranch || lastBranchRef === full) {
          setLastBranchRef("");
        }
        await refreshRepo(activeRepo.path);
      } else {
        notify("error", res.message);
      }
    } catch (err) {
      notify("error", String(err));
    } finally {
      setDeletingRemote(false);
    }
  };

  const handleStashPush = async (msg: string, includeUntracked: boolean) => {
    if (!activeRepo) return;
    setStashModalOpen(false);
    try {
      const res = await GitService.StashPush(activeRepo.path, msg, includeUntracked);
      if (res.success) {
        notify("success", res.message);
        await refreshRepo(activeRepo.path);
      } else {
        notify("error", res.message);
      }
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleStashOp = async (op: "apply" | "pop" | "drop", ref: string) => {
    if (!activeRepo) return;
    try {
      const res =
        op === "apply"
          ? await GitService.StashApply(activeRepo.path, ref)
          : op === "pop"
          ? await GitService.StashPop(activeRepo.path, ref)
          : await GitService.StashDrop(activeRepo.path, ref);
      if (res.success) {
        notify("success", res.message);
      } else if (res.errorCode === "CONFLICT") {
        notify("error", "Stash caused conflicts. Please resolve them.");
        setView("conflicts");
      } else {
        notify("error", res.message);
      }
      await refreshRepo(activeRepo.path);
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleDiscardConfirm = async (files: FileStatus[]) => {
    if (!activeRepo || files.length === 0) return;
    setDiscardTargets([]);
    try {
      const tracked = files.filter((f) => f.status !== "?").map((f) => f.path);
      const untracked = files.filter((f) => f.status === "?").map((f) => f.path);
      await GitService.DiscardFiles(activeRepo.path, tracked, untracked);
      notify(
        "info",
        files.length === 1
          ? `Discarded ${files[0].path}`
          : `Discarded ${files.length} files`
      );
      await refreshRepo(activeRepo.path);
    } catch (err) {
      notify("error", `Discard failed: ${err}`);
    }
  };

  const handleCreateTag = async (name: string, target: string, message: string) => {
    if (!activeRepo) return;
    setTagModal({ open: false, target: "" });
    try {
      const res = await GitService.CreateTag(activeRepo.path, name, target, message);
      if (res.success) {
        notify("success", res.message);
        await refreshRepo(activeRepo.path);
      } else {
        notify("error", res.message);
      }
    } catch (err) {
      notify("error", String(err));
    }
  };

  const executePushTag = async (tagName: string, remoteName: string) => {
    if (!activeRepo) return;
    setTagOpBusy(true);
    try {
      const res = await GitService.PushTag(activeRepo.path, remoteName, tagName);
      setPushTagTarget(null);
      if (res.success) {
        notify("success", res.message);
        await refreshRepo(activeRepo.path);
      } else if (
        res.errorCode === "HTTPS_REMOTE" &&
        (await promptHttpsRemoteIfNeeded(
          activeRepo.path,
          res.message || "Push tag failed",
          remoteName
        ))
      ) {
        // HTTPS prompt opened
      } else if (
        await promptRemoteConfigIfNeeded(
          activeRepo.path,
          "tag",
          res.errorCode,
          res.output || res.message || "Push tag failed",
          remoteName
        )
      ) {
        // Remote config modal displayed
      } else {
        notify("error", res.message || "Push tag failed");
      }
    } catch (err) {
      notify("error", String(err));
    } finally {
      setTagOpBusy(false);
    }
  };

  const handleRequestPushTag = (tag: TagInfo) => {
    if (remotes.length === 0) {
      setRemoteConfigPrompt({
        kind: "NO_REMOTE",
        op: "tag",
        remoteName: "origin",
        currentUrl: "",
        draftUrl: "",
        localBranch: "",
        targetBranch: "main",
        availableRemotes: [],
        availableRemoteBranches: [],
        errorMessage: "当前仓库尚未配置远程仓库 (origin)，无法推送标签。",
      });
      return;
    }
    if (remotes.length === 1) {
      executePushTag(tag.name, remotes[0].name);
      return;
    }
    setPushTagTarget(tag);
  };

  const handleDeleteTagConfirm = async (
    tagName: string,
    alsoRemote: boolean,
    remoteName: string
  ) => {
    if (!activeRepo) return;
    setTagOpBusy(true);
    try {
      const res = await GitService.DeleteTag(activeRepo.path, tagName);
      if (!res.success) {
        setDeleteTagTarget(null);
        notify("error", res.message || "Delete tag failed");
        return;
      }
      if (alsoRemote) {
        const remRes = await GitService.DeleteRemoteTag(
          activeRepo.path,
          remoteName,
          tagName
        );
        setDeleteTagTarget(null);
        if (remRes.success) {
          notify("success", `Deleted tag ${tagName} locally and on ${remoteName}`);
        } else if (
          remRes.errorCode === "HTTPS_REMOTE" &&
          (await promptHttpsRemoteIfNeeded(
            activeRepo.path,
            remRes.message || "Delete remote tag failed",
            remoteName
          ))
        ) {
          notify("info", `Deleted local tag ${tagName}`);
        } else if (
          await promptRemoteConfigIfNeeded(
            activeRepo.path,
            "tag",
            remRes.errorCode,
            remRes.output || remRes.message || "Delete remote tag failed",
            remoteName
          )
        ) {
          notify("info", `Deleted local tag ${tagName}`);
        } else {
          notify("error", `Deleted local tag, but remote delete failed: ${remRes.message}`);
        }
      } else {
        setDeleteTagTarget(null);
        notify("success", res.message);
      }
      if (historyBranch === tagName || historyBranch === `refs/tags/${tagName}`) {
        setHistoryBranch("__ALL__");
      }
      await refreshRepo(activeRepo.path);
    } catch (err) {
      notify("error", String(err));
    } finally {
      setTagOpBusy(false);
    }
  };

  const handleDeleteRemoteTagConfirm = async (tagName: string, remoteName: string) => {
    if (!activeRepo) return;
    setTagOpBusy(true);
    try {
      const res = await GitService.DeleteRemoteTag(
        activeRepo.path,
        remoteName,
        tagName
      );
      setDeleteRemoteTagTarget(null);
      if (res.success) {
        notify("success", res.message);
        await refreshRepo(activeRepo.path);
      } else if (
        res.errorCode === "HTTPS_REMOTE" &&
        (await promptHttpsRemoteIfNeeded(
          activeRepo.path,
          res.message || "Delete remote tag failed",
          remoteName
        ))
      ) {
        // HTTPS prompt opened
      } else if (
        await promptRemoteConfigIfNeeded(
          activeRepo.path,
          "tag",
          res.errorCode,
          res.output || res.message || "Delete remote tag failed",
          remoteName
        )
      ) {
        // Remote config modal displayed
      } else {
        notify("error", res.message || "Delete remote tag failed");
      }
    } catch (err) {
      notify("error", String(err));
    } finally {
      setTagOpBusy(false);
    }
  };

  const handleRevertCommit = async (commit: CommitItem) => {
    if (!activeRepo) return;
    setRevertTarget(null);
    try {
      const isMerge = (commit.parents?.length ?? 0) > 1;
      const res = await GitService.RevertCommit(activeRepo.path, commit.hash, isMerge);
      if (res.success) {
        notify("success", res.message);
      } else if (res.errorCode === "CONFLICT") {
        notify("error", "Revert caused conflicts. Resolve them in Conflict Resolver.");
        setView("conflicts");
      } else {
        notify("error", res.message || "Revert failed");
      }
      await refreshRepo(activeRepo.path);
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleResetCommit = async (
    commit: CommitItem,
    mode: "soft" | "mixed" | "hard"
  ) => {
    if (!activeRepo) return;
    setResetTarget(null);
    try {
      const res = await GitService.ResetToCommit(activeRepo.path, commit.hash, mode);
      if (res.success) {
        notify("success", res.message);
      } else {
        notify("error", res.message || "Reset failed");
      }
      await refreshRepo(activeRepo.path);
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleTabMouseDown = (
    e: React.MouseEvent<HTMLDivElement>,
    tabPath: string
  ) => {
    if (e.button !== 0 || tabs.length < 2) return;
    if ((e.target as HTMLElement).closest("button")) return;

    const startX = e.clientX;
    let didDrag = false;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;

    const finish = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      tabDragCleanupRef.current = null;
      if (didDrag) {
        setDraggingTabPath(null);
        window.setTimeout(() => {
          suppressTabClickRef.current = false;
        }, 0);
      }
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!didDrag) {
        if (Math.abs(ev.clientX - startX) < 5) return;
        didDrag = true;
        suppressTabClickRef.current = true;
        setDraggingTabPath(tabPath);
        setRepoSwitcherOpen(false);
        setTabCtxMenu(null);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }

      const strip = tabStripRef.current;
      if (strip) {
        const sr = strip.getBoundingClientRect();
        if (ev.clientX < sr.left + 28) {
          strip.scrollLeft -= 12;
        } else if (ev.clientX > sr.right - 28) {
          strip.scrollLeft += 12;
        }
      }

      setTabs((prev) => {
        const curIdx = prev.findIndex((t) => t.path === tabPath);
        if (curIdx < 0) return prev;
        const curEl = tabElRefs.current[tabPath];
        if (!curEl) return prev;
        const curRect = curEl.getBoundingClientRect();

        let targetIdx = curIdx;
        if (ev.clientX < curRect.left) {
          for (let j = 0; j < curIdx; j++) {
            const el = tabElRefs.current[prev[j].path];
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (ev.clientX < r.left + r.width * 0.5) {
              targetIdx = j;
              break;
            }
          }
        } else if (ev.clientX > curRect.right) {
          for (let j = prev.length - 1; j > curIdx; j--) {
            const el = tabElRefs.current[prev[j].path];
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (ev.clientX > r.left + r.width * 0.5) {
              targetIdx = j;
              break;
            }
          }
        }

        if (targetIdx === curIdx) return prev;
        const next = [...prev];
        const [moved] = next.splice(curIdx, 1);
        next.splice(targetIdx, 0, moved);
        return next;
      });
    };

    tabDragCleanupRef.current?.();
    tabDragCleanupRef.current = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
  };

  const copyCommandText = (id: string, cmdText: string) => {
    navigator.clipboard?.writeText(cmdText).catch(() => {});
    setCopiedCmdId(id);
    window.setTimeout(() => {
      setCopiedCmdId((cur) => (cur === id ? null : cur));
    }, 1500);
  };

  const activeCommandLogs = commandLogs.filter(
    (c) => !activePath || !c.repoPath || c.repoPath === activePath
  );
  const latestCmd = activeCommandLogs[0] ?? commandLogs[0] ?? null;

  const changedCount = (status?.unstaged?.length ?? 0) + (status?.staged?.length ?? 0);
  const conflictCount = status?.conflicted?.length ?? 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#f8fafc] text-[#0b1c30] overflow-hidden">
      {/* 1. TOP WINDOW TITLEBAR + CHROME-STYLE REPO TABS */}
      <header className="h-[40px] bg-[#dbe6f7] flex items-end justify-between pl-2.5 pr-0 shrink-0 app-drag select-none relative z-30">
        <div className="relative z-10 flex items-end min-w-0 flex-1 h-full">
          {/* App Brand Mark + Quick Tab Switcher (Chrome left pill) */}
          <div className="h-full flex items-center gap-1.5 pr-1.5 shrink-0 app-no-drag">
            <img
              src="/mygit-icon.png"
              alt="mygit"
              title="mygit"
              draggable={false}
              className="w-5 h-5 rounded-md shadow-2xs select-none"
            />
            {tabs.length === 0 && (
              <span className="text-[12px] font-semibold tracking-tight text-[#0b1c30]">
                mygit
              </span>
            )}
            {tabs.length > 1 && (
              <div className="relative">
                <button
                  title={`切换已打开的项目 (${tabs.length})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTabCtxMenu(null);
                    setRepoSwitcherOpen((v) => !v);
                  }}
                  className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                    repoSwitcherOpen
                      ? "bg-white text-[#0284c7] shadow-xs"
                      : "bg-[#cad9f0]/80 hover:bg-[#becfe9] text-[#334155]"
                  }`}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>

                {repoSwitcherOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 top-8 z-50 w-72 bg-white border border-[#cbd5e1] rounded-xl shadow-xl py-1.5 text-[12px] text-[#0b1c30]"
                  >
                    <div className="px-3 py-1 border-b border-[#f1f5f9] flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">
                      <span>已打开项目 ({tabs.length})</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1">
                      {tabs.map((t) => {
                        const isCur = t.path === activePath;
                        return (
                          <div
                            key={t.path}
                            onClick={() => {
                              setActivePath(t.path);
                              setRepoSwitcherOpen(false);
                            }}
                            className={`group flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                              isCur
                                ? "bg-[#f0f9ff] text-[#0369a1]"
                                : "hover:bg-[#f8fafc] text-[#0b1c30]"
                            }`}
                          >
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                              <FolderGit2
                                className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                                  t.isWsl ? "text-[#7c3aed]" : "text-[#0284c7]"
                                }`}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`truncate text-[12px] ${
                                      isCur ? "font-semibold" : "font-medium"
                                    }`}
                                  >
                                    {t.name}
                                  </span>
                                  {t.isWorktree && (
                                    <span className="px-1.5 py-[1px] rounded-full bg-[#f0fdfa] border border-[#99f6e4] text-[#0f766e] text-[9px] font-mono font-semibold shrink-0">
                                      WT
                                    </span>
                                  )}
                                  {t.isWsl && (
                                    <span className="px-1.5 py-[1px] rounded-full bg-[#ede9fe] text-[#6d28d9] text-[9px] font-mono font-semibold shrink-0">
                                      WSL2
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] font-mono text-[#64748b] truncate">
                                  {t.isWsl ? t.linuxPath : t.path}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {isCur && (
                                <Check className="w-3.5 h-3.5 text-[#0284c7]" />
                              )}
                              <button
                                title={`关闭 ${t.name}`}
                                onClick={(e) => handleCloseTab(e, t.path)}
                                className="p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-[#fee2e2] text-[#64748b] hover:text-[#dc2626] cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="pt-1 mt-1 border-t border-[#f1f5f9] px-1.5">
                      <button
                        onClick={() => {
                          setRepoSwitcherOpen(false);
                          setRepoModalOpen(true);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg text-left flex items-center gap-2 text-[11px] font-medium text-[#0284c7] hover:bg-[#f0f9ff] cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>打开或克隆新仓库...</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Scrollable Chrome-style Repo Tabs */}
          <div
            ref={tabStripRef}
            onWheel={(e) => {
              if (e.deltaY !== 0) {
                e.currentTarget.scrollLeft += e.deltaY;
              }
            }}
            className="flex items-end min-w-0 overflow-x-auto no-scrollbar h-full px-[10px] app-no-drag"
          >
            {tabs.map((tab, idx) => {
              const active = tab.path === activePath;
              const isDragging = draggingTabPath === tab.path;
              const nextActive = tabs[idx + 1]?.path === activePath;
              const showDivider =
                !active && !nextActive && !isDragging && idx < tabs.length - 1;
              const tabTitle = `${tab.isWsl ? `WSL2 (${tab.distro}): ${tab.linuxPath}` : tab.path}${
                tab.isWorktree ? " (Worktree)" : ""
              }${tabs.length > 1 ? "\n拖拽可调整项目顺序" : ""}`;
              return (
                <React.Fragment key={tab.path}>
                  <div
                    ref={(el) => {
                      tabElRefs.current[tab.path] = el;
                    }}
                    onMouseDown={(e) => handleTabMouseDown(e, tab.path)}
                    onClick={() => {
                      if (suppressTabClickRef.current) {
                        suppressTabClickRef.current = false;
                        return;
                      }
                      setActivePath(tab.path);
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        closeTabByPath(tab.path);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setRepoSwitcherOpen(false);
                      setTabCtxMenu({
                        x: Math.min(e.clientX, window.innerWidth - 210),
                        y: Math.min(e.clientY, window.innerHeight - 210),
                        repo: tab,
                      });
                    }}
                    title={tabTitle}
                    className={`group relative flex items-center justify-between gap-1.5 px-3 text-[12px] select-none transition-all duration-150 shrink-0 min-w-[116px] max-w-[205px] ${
                      isDragging
                        ? "opacity-80 scale-[0.98] ring-1 ring-[#0284c7]/60 shadow-sm z-30 cursor-grabbing"
                        : "cursor-pointer"
                    } ${
                      active
                        ? "chrome-tab-active z-20 h-[34px] rounded-t-[10px] bg-white text-[#0b1c30] font-semibold"
                        : "h-[28px] mb-[4px] mx-[1px] rounded-[8px] bg-transparent text-[#3f4d63] font-medium hover:bg-[#cad9f0]/75 hover:text-[#0b1c30]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {tab.isWorktree ? (
                        <FolderTree
                          className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                            active
                              ? "text-[#0f766e]"
                              : "text-[#0f766e]/80 group-hover:text-[#0f766e]"
                          }`}
                        />
                      ) : (
                        <FolderGit2
                          className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                            tab.isWsl
                              ? active
                                ? "text-[#7c3aed]"
                                : "text-[#7c3aed]/80 group-hover:text-[#7c3aed]"
                              : active
                              ? "text-[#0284c7]"
                              : "text-[#0284c7]/80 group-hover:text-[#0284c7]"
                          }`}
                        />
                      )}
                      <span className="truncate">{tab.name}</span>
                      {tab.isWorktree && (
                        <span
                          className={`px-1.5 py-[1px] rounded-full text-[9px] font-mono font-semibold leading-none shrink-0 ${
                            active
                              ? "bg-[#f0fdfa] text-[#0f766e]"
                              : "bg-white/60 text-[#0f766e]"
                          }`}
                        >
                          WT
                        </span>
                      )}
                      {tab.isWsl && (
                        <span
                          className={`px-1.5 py-[1px] rounded-full text-[9px] font-mono font-semibold leading-none shrink-0 ${
                            active
                              ? "bg-[#ede9fe] text-[#6d28d9]"
                              : "bg-white/60 text-[#6d28d9]"
                          }`}
                        >
                          WSL2
                        </span>
                      )}
                    </div>
                    <button
                      aria-label={`Close ${tab.name}`}
                      onClick={(e) => handleCloseTab(e, tab.path)}
                      className={`w-4 h-4 rounded-full flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                        active
                          ? "opacity-75 hover:opacity-100 hover:bg-[#e2e8f0] text-[#475569] hover:text-[#0b1c30]"
                          : "opacity-0 group-hover:opacity-80 hover:!opacity-100 hover:bg-[#b5c7e3] text-[#475569] hover:text-[#0b1c30]"
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {showDivider && (
                    <div className="w-px h-4 bg-[#b8c8e2] self-center mb-[2px] shrink-0" />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Chrome-style Circular '+' New Tab Button */}
          <div className="h-full flex items-center pl-0.5 shrink-0 app-no-drag">
            <button
              title="打开 / 克隆 / 初始化仓库"
              onClick={() => setRepoModalOpen(true)}
              className="w-7 h-7 rounded-full hover:bg-[#cad9f0]/80 text-[#334155] hover:text-[#0b1c30] flex items-center justify-center transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Flexible Drag Handle Space */}
          <div className="flex-1 min-w-[40px] h-full app-drag" />
        </div>

        {/* Window Controls */}
        <div className="flex items-center app-no-drag shrink-0 h-full">
          <button
            aria-label="Minimize"
            onClick={() => GitService.MinimizeWindow()}
            className="h-full w-11 flex items-center justify-center text-[#3f4d63] hover:bg-[#cad9f0]/80 transition-colors cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            aria-label="Maximize"
            onClick={() => GitService.ToggleMaximizeWindow()}
            className="h-full w-11 flex items-center justify-center text-[#3f4d63] hover:bg-[#cad9f0]/80 transition-colors cursor-pointer"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            aria-label="Close"
            onClick={() => GitService.CloseWindow()}
            className="h-full w-11 flex items-center justify-center text-[#3f4d63] hover:bg-[#c42b1c] hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 2. ACTION TOOLBAR */}
      <div className="h-10 px-3 bg-white border-b border-[#e2e8f0] flex items-center justify-between gap-2 shrink-0 select-none">
        <div className="flex items-center gap-1">
          <button
            disabled={!activeRepo || remoteBusy !== null}
            onClick={() => handleRemote("fetch")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-[#f1f5f9] text-[12px] font-medium text-[#334155] disabled:opacity-45 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-[#0284c7] ${
                remoteBusy === "fetch" ? "animate-spin" : ""
              }`}
            />
            Fetch
          </button>
          <button
            disabled={!activeRepo || remoteBusy !== null}
            onClick={() => handleRemote("pull")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium disabled:opacity-45 cursor-pointer transition-colors ${
              (status?.behind ?? 0) > 0
                ? "bg-[#fffbeb] border border-[#fde68a] text-[#b45309] hover:bg-[#fef3c7]"
                : "text-[#334155] hover:bg-[#f1f5f9]"
            }`}
          >
            {remoteBusy === "pull" ? (
              <RefreshCw className="w-3.5 h-3.5 text-[#0284c7] animate-spin" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5 text-[#0284c7]" />
            )}
            <span>Pull</span>
            {(status?.behind ?? 0) > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-[#d97706] text-white font-mono text-[10px] font-semibold leading-tight">
                ↓{status?.behind}
              </span>
            )}
          </button>
          <button
            disabled={!activeRepo || remoteBusy !== null}
            onClick={() => handleRemote("push")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium disabled:opacity-45 cursor-pointer transition-colors ${
              (status?.ahead ?? 0) > 0
                ? "bg-[#f0f9ff] border border-[#bae6fd] text-[#0369a1] hover:bg-[#e0f2fe]"
                : "text-[#334155] hover:bg-[#f1f5f9]"
            }`}
          >
            {remoteBusy === "push" ? (
              <RefreshCw className="w-3.5 h-3.5 text-[#0284c7] animate-spin" />
            ) : (
              <ArrowUp className="w-3.5 h-3.5 text-[#0284c7]" />
            )}
            <span>Push</span>
            {(status?.ahead ?? 0) > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-[#0284c7] text-white font-mono text-[10px] font-semibold leading-tight">
                ↑{status?.ahead}
              </span>
            )}
          </button>

          <div className="h-4 w-px bg-[#e2e8f0] mx-1" />

          <button
            disabled={!activeRepo}
            onClick={() => setStashModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-[#f1f5f9] text-[12px] font-medium text-[#334155] disabled:opacity-45 cursor-pointer"
          >
            <Archive className="w-3.5 h-3.5 text-[#475569]" />
            Stash
          </button>
          <button
            disabled={!activeRepo || stashes.length === 0}
            onClick={() => handleStashOp("pop", "stash@{0}")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-[#f1f5f9] text-[12px] font-medium text-[#334155] disabled:opacity-45 cursor-pointer"
          >
            <ArchiveRestore className="w-3.5 h-3.5 text-[#475569]" />
            Pop
          </button>
          <button
            disabled={!activeRepo}
            onClick={() =>
              setBranchModal({ open: true, startPoint: "", defaultCheckout: true })
            }
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-[#f1f5f9] text-[12px] font-medium text-[#334155] disabled:opacity-45 cursor-pointer"
          >
            <GitBranch className="w-3.5 h-3.5 text-[#475569]" />
            Branch
          </button>
          <button
            disabled={!activeRepo}
            onClick={() => setTagModal({ open: true, target: "" })}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-[#f1f5f9] text-[12px] font-medium text-[#334155] disabled:opacity-45 cursor-pointer"
          >
            <TagIcon className="w-3.5 h-3.5 text-[#475569]" />
            Tag
          </button>
          <button
            disabled={!activeRepo}
            title="Create New Git Worktree"
            onClick={() =>
              setCreateWorktreeModal({
                open: true,
                mode: "new-branch",
                branch: "",
                baseRef: "",
              })
            }
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-[#f1f5f9] text-[12px] font-medium text-[#334155] disabled:opacity-45 cursor-pointer"
          >
            <FolderTree className="w-3.5 h-3.5 text-[#0f766e]" />
            Worktree
          </button>

          <div className="h-4 w-px bg-[#e2e8f0] mx-1" />

          <button
            disabled={!activeRepo}
            onClick={() => activeRepo && GitService.OpenInTerminal(activeRepo.path)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-[#f1f5f9] text-[12px] font-medium text-[#334155] disabled:opacity-45 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-[#475569]" />
            Terminal
          </button>
          <button
            disabled={!activeRepo}
            onClick={() => activeRepo && GitService.OpenInExplorer(activeRepo.path, "")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-[#f1f5f9] text-[12px] font-medium text-[#334155] disabled:opacity-45 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#475569]" />
            Explorer
          </button>
        </div>

        {/* Right Upstream, Repo Type & Git Config */}
        <div className="flex items-center gap-2">
          {activeRepo && status && (
            <>
              {activeRepo.isWsl && (
                <span className="px-2 py-0.5 rounded bg-[#ede9fe] border border-[#ddd6fe] text-[#6d28d9] font-mono text-[11px] font-medium">
                  WSL2: {activeRepo.distro}
                </span>
              )}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#f8fafc] border border-[#e2e8f0]">
                <Cloud className="w-3.5 h-3.5 text-[#16a34a]" />
                <span className="font-mono text-[12px] text-[#334155]">
                  {status.upstream || status.branch || "local"}
                </span>
                <span className="px-1.5 py-0.2 rounded bg-[#e2e8f0] font-mono text-[11px] text-[#334155]">
                  {!status.upstream
                    ? "no upstream"
                    : status.ahead === 0 && status.behind === 0
                    ? "up-to-date"
                    : `${status.ahead > 0 ? `↑${status.ahead} ` : ""}${
                        status.behind > 0 ? `↓${status.behind}` : ""
                      }`.trim()}
                </span>
              </div>
            </>
          )}
          <button
            onClick={() =>
              setGitConfigModal({
                open: true,
                scope: activeRepo ? "local" : "global",
              })
            }
            title={
              effectiveAuthor.source === "local"
                ? `当前使用【仓库独立配置】(--local): ${effectiveAuthor.name} <${effectiveAuthor.email}>\n点击修改配置`
                : effectiveAuthor.source === "global"
                ? `当前继承【全局配置】(--global): ${effectiveAuthor.name} <${effectiveAuthor.email}>\n点击修改或为当前仓库单独覆盖`
                : "未配置 Git 作者身份，点击立即配置"
            }
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-medium cursor-pointer transition-colors ${
              activeRepo && !effectiveAuthor.name && !effectiveAuthor.email
                ? "bg-[#fef2f2] border-[#fecaca] text-[#dc2626] hover:bg-[#fee2e2]"
                : "bg-white border-[#e2e8f0] text-[#334155] hover:bg-[#f8fafc] hover:border-[#cbd5e1]"
            }`}
          >
            <User className="w-3.5 h-3.5 text-[#0284c7]" />
            <span className="max-w-[140px] truncate">
              {effectiveAuthor.name || "未配置 Git 身份"}
            </span>
            {activeRepo && effectiveAuthor.source !== "none" && (
              <span
                className={`px-1.5 py-[1px] rounded text-[10px] font-medium ${
                  effectiveAuthor.source === "local"
                    ? "bg-[#e0f2fe] text-[#0369a1]"
                    : "bg-[#f1f5f9] text-[#64748b]"
                }`}
              >
                {effectiveAuthor.source === "local" ? "仓库" : "全局"}
              </span>
            )}
          </button>
          {(updateStatus.state === "available" ||
            updateStatus.state === "downloading" ||
            updateStatus.state === "verifying" ||
            updateStatus.state === "installing" ||
            updateStatus.state === "ready") && (
            <button
              onClick={() => setUpdateModalOpen(true)}
              title="查看并安装软件更新"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                updateStatus.state === "ready"
                  ? "bg-[#16a34a] text-white hover:bg-[#15803d]"
                  : "bg-[#f0f9ff] border border-[#bae6fd] text-[#0369a1] hover:bg-[#e0f2fe]"
              }`}
            >
              {updateStatus.state === "ready" ? (
                <>
                  <RotateCw className="w-3 h-3" />
                  <span>重启更新</span>
                </>
              ) : updateStatus.state === "available" ? (
                <>
                  <Sparkles className="w-3 h-3" />
                  <span>新版本 v{updateStatus.available?.version}</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>更新 {updateStatus.percent}%</span>
                </>
              )}
            </button>
          )}
          <button
            onClick={() => setSettingsModalOpen(true)}
            title="软件设置（字体大小 / 检查更新 / Git 全局配置）"
            className="relative flex items-center gap-1 px-2.5 py-1 rounded border border-[#e2e8f0] bg-white hover:bg-[#f8fafc] hover:border-[#cbd5e1] text-[11px] font-medium text-[#334155] cursor-pointer transition-colors"
          >
            <Settings className="w-3.5 h-3.5 text-[#475569]" />
            <span>设置</span>
            {(updateStatus.state === "available" ||
              updateStatus.state === "ready") && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#0284c7]" />
            )}
          </button>
        </div>
      </div>

      {/* 3. VIEW SWITCHER BAR */}
      <div className="h-9 px-3 bg-[#eff4ff] border-b border-[#e2e8f0] flex items-center justify-between gap-3 shrink-0 select-none">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <nav className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setView("changes")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-[12px] font-medium transition-colors cursor-pointer ${
                view === "changes"
                  ? "bg-[#0284c7] text-white shadow-sm"
                  : "text-[#475569] hover:text-[#0b1c30] hover:bg-[#e5eeff]"
              }`}
            >
              <span>Staging & Working Tree</span>
              {changedCount > 0 && (
                <span
                  className={`px-1.5 rounded-full text-[10px] font-mono font-semibold ${
                    view === "changes"
                      ? "bg-white/25 text-white"
                      : "bg-[#dbeafe] text-[#0369a1]"
                  }`}
                >
                  {changedCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setView("conflicts")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-[12px] font-medium transition-colors cursor-pointer ${
                view === "conflicts"
                  ? "bg-[#0284c7] text-white shadow-sm"
                  : "text-[#475569] hover:text-[#0b1c30] hover:bg-[#e5eeff]"
              }`}
            >
              <span>Merge Conflict Resolver</span>
              {conflictCount > 0 && (
                <span className="px-1.5 rounded-full text-[10px] font-mono font-semibold bg-[#dc2626] text-white">
                  {conflictCount}
                </span>
              )}
            </button>
          </nav>

          {/* Executed Git Command Echo (right of Merge Conflict Resolver) */}
          <div className="relative min-w-0 flex-1 flex items-center">
            {latestCmd ? (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setRepoSwitcherOpen(false);
                  setTabCtxMenu(null);
                  setCmdHistoryOpen((v) => !v);
                }}
                title={`${latestCmd.command}${
                  latestCmd.status === "running"
                    ? " (执行中...)"
                    : latestCmd.status === "error"
                    ? ` (失败: ${latestCmd.error || "error"})`
                    : ` (成功 · ${formatCmdDuration(latestCmd.durationMs)})`
                }\n点击查看历史命令`}
                className={`group h-6 max-w-full min-w-0 px-2 rounded-md border flex items-center gap-1.5 font-mono text-[11px] cursor-pointer transition-colors ${
                  latestCmd.status === "running"
                    ? "bg-[#f0f9ff] border-[#bae6fd] text-[#0369a1]"
                    : latestCmd.status === "error"
                    ? "bg-[#fef2f2] border-[#fecaca] text-[#991b1b] hover:bg-[#fee2e2]/70"
                    : "bg-white border-[#cbd5e1] text-[#334155] hover:border-[#94a3b8]"
                }`}
              >
                {latestCmd.status === "running" ? (
                  <RefreshCw className="w-3 h-3 text-[#0284c7] animate-spin shrink-0" />
                ) : latestCmd.status === "error" ? (
                  <AlertTriangle className="w-3 h-3 text-[#dc2626] shrink-0" />
                ) : (
                  <Terminal className="w-3 h-3 text-[#16a34a] shrink-0" />
                )}
                <span className="truncate select-text">{latestCmd.command}</span>
                {latestCmd.status !== "running" && (
                  <span className="text-[10px] opacity-65 shrink-0">
                    {formatCmdDuration(latestCmd.durationMs)}
                  </span>
                )}
                <button
                  type="button"
                  title="复制命令"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyCommandText(latestCmd.id, latestCmd.command);
                  }}
                  className="p-0.5 rounded hover:bg-black/5 text-current opacity-65 hover:opacity-100 cursor-pointer shrink-0"
                >
                  {copiedCmdId === latestCmd.id ? (
                    <Check className="w-3 h-3 text-[#16a34a]" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
                {commandLogs.length > 1 && (
                  <span className="inline-flex items-center gap-0.5 pl-1 border-l border-current/15 text-[10px] opacity-70 shrink-0">
                    <span>{commandLogs.length}</span>
                    <ChevronDown className="w-3 h-3" />
                  </span>
                )}
              </div>
            ) : (
              <div
                title="执行 Git 操作时将在此回显具体命令"
                className="h-6 px-2 rounded-md border border-dashed border-[#cbd5e1]/80 bg-white/50 flex items-center gap-1.5 font-mono text-[11px] text-[#94a3b8] max-w-full min-w-0"
              >
                <Terminal className="w-3 h-3 shrink-0" />
                <span className="truncate">$ 等待操作命令...</span>
              </div>
            )}

            {cmdHistoryOpen && commandLogs.length > 0 && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute left-0 top-7 z-50 w-[min(640px,78vw)] bg-white border border-[#cbd5e1] rounded-xl shadow-xl py-1.5 text-[12px] text-[#0b1c30]"
              >
                <div className="px-3 py-1 border-b border-[#f1f5f9] flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">
                  <span>最近执行的 Git 命令 ({commandLogs.length})</span>
                  <button
                    type="button"
                    onClick={() => {
                      setCommandLogs([]);
                      setCmdHistoryOpen(false);
                    }}
                    className="text-[10px] font-medium normal-case text-[#64748b] hover:text-[#dc2626] cursor-pointer"
                  >
                    清空记录
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-[#f1f5f9]">
                  {commandLogs.map((item) => {
                    const repoTab = item.repoPath
                      ? tabs.find((t) => t.path === item.repoPath)
                      : null;
                    return (
                      <div
                        key={item.id}
                        className="px-3 py-2 flex items-start justify-between gap-2 hover:bg-[#f8fafc]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {item.status === "running" ? (
                              <RefreshCw className="w-3 h-3 text-[#0284c7] animate-spin shrink-0" />
                            ) : item.status === "error" ? (
                              <AlertTriangle className="w-3 h-3 text-[#dc2626] shrink-0" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3 text-[#16a34a] shrink-0" />
                            )}
                            {repoTab && (
                              <span className="px-1.5 py-[1px] rounded bg-[#eff6ff] text-[#0369a1] font-sans text-[10px] font-medium shrink-0">
                                {repoTab.name}
                              </span>
                            )}
                            <span className="font-mono text-[10px] text-[#94a3b8]">
                              {formatCmdTime(item.timestamp)}
                            </span>
                            {item.status !== "running" && (
                              <span className="font-mono text-[10px] text-[#64748b]">
                                {formatCmdDuration(item.durationMs)}
                              </span>
                            )}
                          </div>
                          <div
                            className={`font-mono text-[11px] break-all select-text ${
                              item.status === "error"
                                ? "text-[#991b1b]"
                                : "text-[#0b1c30]"
                            }`}
                          >
                            {item.command}
                          </div>
                          {item.status === "error" && item.error && (
                            <div className="mt-0.5 text-[10px] text-[#dc2626] break-words select-text">
                              {item.error}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          title="复制命令"
                          onClick={() => copyCommandText(item.id, item.command)}
                          className="p-1 rounded hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0b1c30] cursor-pointer shrink-0"
                        >
                          {copiedCmdId === item.id ? (
                            <Check className="w-3.5 h-3.5 text-[#16a34a]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center bg-white border border-[#cbd5e1] rounded px-2 py-0.5 w-60">
            <Search className="w-3.5 h-3.5 text-[#94a3b8] mr-1.5 shrink-0" />
            <input
              id="global-quick-search"
              type="text"
              value={quickFilter}
              onChange={(e) => {
                setQuickFilter(e.target.value);
                if (view !== "history") setView("history");
              }}
              placeholder="Filter commits (Ctrl+F)"
              className="w-full bg-transparent text-[11px] outline-none placeholder:text-[#94a3b8]"
            />
          </div>
          {activeRepo && (
            <button
              title="Refresh repository state"
              onClick={() => refreshRepo()}
              className="p-1 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-[#475569] cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>

      {/* 4. MAIN WORKSPACE */}
      <div className="flex-1 flex min-h-0">
        {activeRepo ? (
          <>
            <Sidebar
              key={`sidebar:${activeRepo.path}`}
              width={layout.sidebarWidth}
              branches={branches}
              tags={tags}
              stashes={stashes}
              remotes={remotes}
              worktrees={worktrees}
              openTabPaths={tabs.map((t) => t.path)}
              pinnedBranches={pinnedBranches}
              currentBranch={status?.branch || ""}
              activeHistoryBranch={view === "history" ? historyBranch : ""}
              branchScopeMode={branchScopeMode}
              onChangeBranchScopeMode={(mode) => {
                setBranchScopeMode(mode);
                if (mode === "all") {
                  setHistoryBranch("__ALL__");
                  setView("history");
                } else {
                  const validLast =
                    lastBranchRef &&
                    branches.some(
                      (b) => b.fullName === lastBranchRef || b.name === lastBranchRef
                    )
                      ? lastBranchRef
                      : "";
                  const fallback =
                    validLast ||
                    branches.find((b) => b.isCurrent)?.fullName ||
                    branches[0]?.fullName ||
                    "__ALL__";
                  setHistoryBranch(fallback);
                  setView("history");
                }
              }}
              onInspectBranch={(refName, focusSha, forceScope) => {
                const isTag = refName.startsWith("refs/tags/");
                const isStash = refName.startsWith("stash@{");
                if (!isTag && !isStash) {
                  setLastBranchRef(refName);
                }
                const effectiveScope = forceScope ?? branchScopeMode;
                if (forceScope) {
                  setBranchScopeMode(forceScope);
                }
                if (isStash) {
                  setHistoryBranch(refName);
                  setFocusCommitSignal(null);
                } else if (effectiveScope === "all") {
                  setHistoryBranch("__ALL__");
                  if (focusSha) {
                    setFocusCommitSignal({ sha: focusSha, nonce: Date.now() });
                  }
                } else {
                  setHistoryBranch(refName);
                  if (focusSha) {
                    setFocusCommitSignal({ sha: focusSha, nonce: Date.now() });
                  }
                }
                setView("history");
              }}
              onTogglePinBranch={async (fullName) => {
                if (!activeRepo) return;
                try {
                  const next = await GitService.TogglePinBranch(
                    activeRepo.path,
                    fullName
                  );
                  const nextPins = next ?? [];
                  setPinnedBranches(nextPins);
                  updateRepoCache(activeRepo.path, { pinnedBranches: nextPins });
                } catch (err) {
                  notify("error", `Pin branch failed: ${err}`);
                }
              }}
              onCheckout={handleCheckout}
              onMerge={handleMerge}
              onRequestDeleteBranch={(name) => setDeleteBranchTarget(name)}
              onRequestDeleteRemoteBranch={(remoteBranch) =>
                setDeleteRemoteTarget(remoteBranch)
              }
              onRequestRenameBranch={(name) => setRenameBranchTarget(name)}
              onRequestCreateBranch={(startPoint = "", checkout = true) =>
                setBranchModal({
                  open: true,
                  startPoint,
                  defaultCheckout: checkout,
                })
              }
              onRequestCreateTag={(target = "") =>
                setTagModal({ open: true, target })
              }
              onCheckoutTag={handleCheckoutTag}
              onPushTag={handleRequestPushTag}
              onRequestDeleteTag={(t) => setDeleteTagTarget(t)}
              onRequestDeleteRemoteTag={(t) => setDeleteRemoteTagTarget(t)}
              onRequestStashPush={() => setStashModalOpen(true)}
              onStashApply={(ref) => handleStashOp("apply", ref)}
              onStashPop={(ref) => handleStashOp("pop", ref)}
              onStashDrop={(stash) => setDropStashTarget(stash)}
              onOpenWorktree={handleOpenWorktree}
              onRequestCreateWorktree={(opts) =>
                setCreateWorktreeModal({
                  open: true,
                  mode: opts?.mode ?? "new-branch",
                  branch: opts?.branch ?? "",
                  baseRef: opts?.baseRef ?? "",
                })
              }
              onRequestRemoveWorktree={(wt) => setRemoveWorktreeTarget(wt)}
              onRequestLockWorktree={(wt) => setLockWorktreeTarget(wt)}
              onUnlockWorktree={handleUnlockWorktree}
              onPruneWorktrees={handlePruneWorktrees}
              onOpenWorktreeInExplorer={(wt) =>
                GitService.OpenInExplorer(wt.path, "")
              }
              onOpenWorktreeInTerminal={(wt) =>
                GitService.OpenInTerminal(wt.path)
              }
              onNotify={notify}
            />

            <SplitHandle
              direction="horizontal"
              variant="edge"
              title="Drag to resize sidebar · Double-click to reset"
              onDragStart={() => {
                sidebarStartWidthRef.current = layoutRef.current.sidebarWidth;
              }}
              onDragMove={(dx) => {
                const maxAllowed = Math.max(
                  260,
                  Math.min(560, window.innerWidth - 520)
                );
                const nextWidth = clamp(
                  Math.round(sidebarStartWidthRef.current + dx),
                  200,
                  maxAllowed
                );
                updateLayout({ sidebarWidth: nextWidth }, false);
              }}
              onDragEnd={() => updateLayout({}, true)}
              onReset={() =>
                updateLayout({ sidebarWidth: DEFAULT_LAYOUT.sidebarWidth }, true)
              }
            />

            <main className="flex-1 flex min-w-0 min-h-0">
              {view === "changes" && (
                <ChangesView
                  key={`changes:${activeRepo.path}`}
                  repo={activeRepo}
                  status={status}
                  leftRatio={layout.changesLeftRatio}
                  unstagedRatio={layout.changesUnstagedRatio}
                  ignoreWhitespace={Boolean(appSettings.ignoreWhitespace)}
                  pushBusy={remoteBusy !== null}
                  onToggleIgnoreWhitespace={(ignore) =>
                    updateAppSettings({ ignoreWhitespace: ignore })
                  }
                  onChangeRatios={updateLayout}
                  onRefresh={() => refreshRepo(activeRepo.path)}
                  onPushAfterCommit={(amended) =>
                    executePush(activeRepo.path, { fromCommit: true, amended })
                  }
                  onOpenConflictResolver={() => setView("conflicts")}
                  onOpenGitConfig={(sc = "local") =>
                    setGitConfigModal({ open: true, scope: sc })
                  }
                  onNotify={notify}
                  onConfirmDiscard={(files) => setDiscardTargets(files)}
                />
              )}
              {view === "history" && (
                <HistoryView
                  key={`history:${activeRepo.path}`}
                  repo={activeRepo}
                  branches={branches}
                  tags={tags}
                  stashes={stashes}
                  selectedBranch={historyBranch}
                  onSelectBranch={(ref) => {
                    setHistoryBranch(ref);
                    if (ref === "__ALL__") {
                      setBranchScopeMode("all");
                    } else if (!ref.startsWith("stash@{")) {
                      setBranchScopeMode("branch");
                      if (!ref.startsWith("refs/tags/")) {
                        setLastBranchRef(ref);
                      }
                    }
                  }}
                  focusCommitSignal={focusCommitSignal}
                  refreshKey={historyRefreshKey}
                  externalSearch={quickFilter}
                  defaultIgnoreWhitespace={Boolean(appSettings.ignoreWhitespace)}
                  bottomRatio={layout.historyBottomRatio}
                  detailLeftRatio={layout.historyDetailLeftRatio}
                  onChangeRatios={updateLayout}
                  onCreateBranchFromCommit={(sha) =>
                    setBranchModal({
                      open: true,
                      startPoint: sha,
                      defaultCheckout: false,
                    })
                  }
                  onCreateTagFromCommit={(sha) =>
                    setTagModal({ open: true, target: sha })
                  }
                  onCreateWorktreeFromCommit={(sha) =>
                    setCreateWorktreeModal({
                      open: true,
                      mode: "new-branch",
                      branch: "",
                      baseRef: sha,
                    })
                  }
                  onRequestRevertCommit={(c) => setRevertTarget(c)}
                  onRequestResetCommit={(c) => setResetTarget(c)}
                  onNotify={notify}
                />
              )}
              {view === "conflicts" && (
                <ConflictView
                  key={`conflicts:${activeRepo.path}`}
                  repo={activeRepo}
                  status={status}
                  onRefresh={() => refreshRepo(activeRepo.path)}
                  onNotify={notify}
                  onGoToChanges={() => setView("changes")}
                />
              )}
            </main>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
            <img
              src="/mygit-icon.png"
              alt="mygit"
              draggable={false}
              className="w-16 h-16 rounded-2xl shadow-sm select-none"
            />
            <h1 className="text-base font-semibold text-[#0b1c30]">
              Welcome to mygit
            </h1>
            <p className="text-xs text-[#64748b] max-w-md">
              Open a local Windows Git repository, browse native WSL2 Linux repositories, or clone from remote.
            </p>
            <button
              onClick={() => setRepoModalOpen(true)}
              className="px-4 py-2 rounded-md bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium cursor-pointer"
            >
              Open or Clone Repository
            </button>
          </div>
        )}
      </div>

      {/* 5. BOTTOM STATUS BAR */}
      <footer className="h-6 px-3 bg-white border-t border-[#e2e8f0] flex items-center justify-between text-[12px] text-[#475569] shrink-0 select-none">
        <div className="flex items-center gap-3 min-w-0">
          {activeRepo && status ? (
            <>
              <span className="flex items-center gap-1 font-mono font-medium text-[#0284c7]">
                <GitBranch className="w-3.5 h-3.5" />
                {status.branch || "HEAD"}
              </span>
              <span>
                Ahead: {status.ahead} • Behind: {status.behind}
              </span>
              {conflictCount > 0 ? (
                <span className="flex items-center gap-1 text-[#dc2626] font-medium">
                  <AlertTriangle className="w-3 h-3" />
                  {conflictCount} conflict(s)
                </span>
              ) : changedCount > 0 ? (
                <span className="text-[#d97706] font-medium">
                  {changedCount} uncommitted change(s)
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[#16a34a]">
                  <CheckCircle2 className="w-3 h-3" />
                  Working directory clean
                </span>
              )}
            </>
          ) : (
            <span>No repository open</span>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-[#64748b]">
          {activeRepo?.isWorktree && (
            <span className="px-1.5 py-[1px] rounded bg-[#f0fdfa] border border-[#99f6e4] text-[#0f766e] font-semibold">
              Worktree
            </span>
          )}
          {activeRepo && (
            <span className="truncate max-w-[360px]" title={activeRepo.path}>
              {activeRepo.isWsl
                ? `WSL2 (${activeRepo.distro}) ${activeRepo.linuxPath}`
                : activeRepo.path}
            </span>
          )}
          <span>
            {activeRepo?.isWsl ? "WSL2 Git" : "Git"}{" "}
            {activeRepo?.gitVersion || globalGitVer}
          </span>
          <button
            onClick={() => setUpdateModalOpen(true)}
            title="检查软件更新"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#e2e8f0] text-[#475569] cursor-pointer transition-colors"
          >
            <span>v{updateStatus.currentVersion}</span>
            {(updateStatus.state === "available" ||
              updateStatus.state === "ready") && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#0284c7]" />
            )}
          </button>
        </div>
      </footer>

      {/* MODALS */}
      <AppSettingsModal
        open={settingsModalOpen}
        settings={appSettings}
        hasActiveRepo={Boolean(activeRepo)}
        effectiveAuthor={effectiveAuthor}
        updateStatus={updateStatus}
        onClose={() => setSettingsModalOpen(false)}
        onUpdateSettings={updateAppSettings}
        onOpenGitConfig={(scope) => setGitConfigModal({ open: true, scope })}
        onCheckUpdate={() => {
          UpdateService.CheckForUpdate()
            .then((st) => {
              if (st) setUpdateStatus(st);
            })
            .catch((err) => notify("error", String(err)));
        }}
        onDownloadUpdate={() => {
          UpdateService.DownloadAndInstall()
            .then((st) => {
              if (st) setUpdateStatus(st);
            })
            .catch((err) => notify("error", String(err)));
        }}
        onRestartUpdate={() => {
          UpdateService.RestartAndApply().catch((err) =>
            notify("error", `重启应用失败: ${err}`)
          );
        }}
        onOpenRelease={(url) => {
          UpdateService.OpenReleasePage(url).catch((err) =>
            notify("error", String(err))
          );
        }}
      />

      <UpdateModal
        open={updateModalOpen}
        status={updateStatus}
        onClose={() => setUpdateModalOpen(false)}
        onCheck={() => {
          UpdateService.CheckForUpdate()
            .then((st) => {
              if (st) setUpdateStatus(st);
            })
            .catch((err) => notify("error", String(err)));
        }}
        onDownloadAndInstall={() => {
          UpdateService.DownloadAndInstall()
            .then((st) => {
              if (st) setUpdateStatus(st);
            })
            .catch((err) => notify("error", String(err)));
        }}
        onRestart={() => {
          UpdateService.RestartAndApply().catch((err) =>
            notify("error", `重启应用失败: ${err}`)
          );
        }}
        onOpenRelease={(url) => {
          UpdateService.OpenReleasePage(url).catch((err) =>
            notify("error", String(err))
          );
        }}
      />

      <RepoModal
        isOpen={repoModalOpen}
        canClose={tabs.length > 0}
        onClose={() => setRepoModalOpen(false)}
        onOpened={handleOpenedRepo}
      />

      <DiscardConfirmModal
        files={discardTargets}
        onCancel={() => setDiscardTargets([])}
        onConfirm={handleDiscardConfirm}
      />

      <CreateBranchModal
        open={branchModal.open}
        startPoint={branchModal.startPoint}
        defaultCheckout={branchModal.defaultCheckout}
        onCancel={() =>
          setBranchModal({ open: false, startPoint: "", defaultCheckout: true })
        }
        onConfirm={handleCreateBranch}
      />

      <RenameBranchModal
        branchName={renameBranchTarget}
        onCancel={() => setRenameBranchTarget(null)}
        onConfirm={handleRenameBranch}
      />

      <DeleteBranchModal
        branchName={deleteBranchTarget}
        onCancel={() => setDeleteBranchTarget(null)}
        onConfirm={handleDeleteBranch}
      />

      <DeleteRemoteBranchModal
        remoteBranch={deleteRemoteTarget}
        busy={deletingRemote}
        onCancel={() => setDeleteRemoteTarget(null)}
        onConfirm={handleDeleteRemoteBranch}
      />

      <CheckoutConflictModal
        target={checkoutConflict}
        onCancel={() => setCheckoutConflict(null)}
        onStashAndCheckout={handleStashAndCheckout}
        onGoToChanges={() => {
          setCheckoutConflict(null);
          setView("changes");
        }}
      />

      <CreateWorktreeModal
        open={createWorktreeModal.open}
        repo={activeRepo}
        branches={branches}
        worktrees={worktrees}
        initialMode={createWorktreeModal.mode}
        initialBranch={createWorktreeModal.branch}
        initialBaseRef={createWorktreeModal.baseRef}
        busy={worktreeBusy}
        onCancel={() =>
          setCreateWorktreeModal((m) => ({ ...m, open: false }))
        }
        onConfirm={handleCreateWorktree}
      />

      <RemoveWorktreeModal
        worktree={removeWorktreeTarget}
        busy={worktreeBusy}
        onCancel={() => setRemoveWorktreeTarget(null)}
        onConfirm={handleRemoveWorktree}
      />

      <LockWorktreeModal
        worktree={lockWorktreeTarget}
        busy={worktreeBusy}
        onCancel={() => setLockWorktreeTarget(null)}
        onConfirm={handleLockWorktree}
      />

      <WorktreeInUseModal
        info={worktreeInUsePrompt}
        onCancel={() => setWorktreeInUsePrompt(null)}
        onSwitchToWorktree={(wt) => {
          setWorktreeInUsePrompt(null);
          handleOpenWorktree(wt);
        }}
      />

      <StashModal
        open={stashModalOpen}
        onCancel={() => setStashModalOpen(false)}
        onConfirm={handleStashPush}
      />

      <CreateTagModal
        open={tagModal.open}
        target={tagModal.target}
        onCancel={() => setTagModal({ open: false, target: "" })}
        onConfirm={handleCreateTag}
      />

      <DeleteTagModal
        tag={deleteTagTarget}
        remotes={remotes}
        busy={tagOpBusy}
        onCancel={() => setDeleteTagTarget(null)}
        onConfirm={handleDeleteTagConfirm}
      />

      <DeleteRemoteTagModal
        tag={deleteRemoteTagTarget}
        remotes={remotes}
        busy={tagOpBusy}
        onCancel={() => setDeleteRemoteTagTarget(null)}
        onConfirm={handleDeleteRemoteTagConfirm}
      />

      <PushTagModal
        tag={pushTagTarget}
        remotes={remotes}
        busy={tagOpBusy}
        onCancel={() => setPushTagTarget(null)}
        onConfirm={executePushTag}
      />

      <ConfirmDangerModal
        open={Boolean(dropStashTarget)}
        title="Drop Stash?"
        description="This will permanently delete this stash entry and its saved changes:"
        detail={
          dropStashTarget
            ? `${dropStashTarget.ref}: ${dropStashTarget.message}`
            : undefined
        }
        confirmLabel="Drop Stash"
        onCancel={() => setDropStashTarget(null)}
        onConfirm={() => {
          const target = dropStashTarget;
          setDropStashTarget(null);
          if (target) handleStashOp("drop", target.ref);
        }}
      />

      {/* REPO TAB CONTEXT MENU */}
      {tabCtxMenu && (
        <div
          style={{ left: tabCtxMenu.x, top: tabCtxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-52 bg-white border border-[#cbd5e1] rounded-lg shadow-xl py-1 text-[12px] text-[#0b1c30] select-none"
        >
          <div className="px-3 py-1 border-b border-[#f1f5f9] text-[10px] font-mono text-[#64748b] truncate">
            {tabCtxMenu.repo.name}
          </div>
          {tabCtxMenu.repo.path !== activePath && (
            <button
              onClick={() => {
                const p = tabCtxMenu.repo.path;
                setTabCtxMenu(null);
                setActivePath(p);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
            >
              <Check className="w-3.5 h-3.5 text-[#0284c7]" />
              <span>Switch to Repository</span>
            </button>
          )}
          <button
            onClick={() => {
              const r = tabCtxMenu.repo;
              setTabCtxMenu(null);
              GitService.OpenInTerminal(r.path);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-[#475569]" />
            <span>Open in Terminal</span>
          </button>
          <button
            onClick={() => {
              const r = tabCtxMenu.repo;
              setTabCtxMenu(null);
              GitService.OpenInExplorer(r.path, "");
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f0f9ff] hover:text-[#0284c7] cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#475569]" />
            <span>Open in Explorer</span>
          </button>
          <button
            onClick={() => {
              const r = tabCtxMenu.repo;
              setTabCtxMenu(null);
              const text = r.isWsl ? r.linuxPath : r.path;
              navigator.clipboard.writeText(text);
              notify("info", `Copied ${text}`);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f8fafc] text-[#475569] cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Path</span>
          </button>
          <div className="my-1 border-t border-[#f1f5f9]" />
          {tabs.length > 1 && (
            <button
              onClick={() => {
                const p = tabCtxMenu.repo.path;
                setTabCtxMenu(null);
                closeOtherTabs(p);
              }}
              className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[#f8fafc] text-[#475569] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Close Other Tabs</span>
            </button>
          )}
          <button
            onClick={() => {
              const p = tabCtxMenu.repo.path;
              setTabCtxMenu(null);
              closeTabByPath(p);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Close Tab</span>
          </button>
        </div>
      )}

      <RevertCommitModal
        commit={revertTarget}
        onCancel={() => setRevertTarget(null)}
        onConfirm={handleRevertCommit}
      />

      <ResetCommitModal
        commit={resetTarget}
        currentBranch={status?.branch || "HEAD"}
        onCancel={() => setResetTarget(null)}
        onConfirm={handleResetCommit}
      />

      <GitConfigModal
        open={gitConfigModal.open}
        repo={activeRepo}
        initialScope={gitConfigModal.scope}
        initialExpandAdvanced={gitConfigModal.expandAdvanced}
        onClose={() => setGitConfigModal((m) => ({ ...m, open: false }))}
        onSaved={(msg) => {
          notify("success", msg);
          if (activeRepo) refreshRepo(activeRepo.path);
        }}
        onNotify={notify}
      />

      {remoteConfigPrompt && activeRepo && (
        <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-[#fef3c7] text-[#d97706] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[#0b1c30]">
                  {remoteConfigPrompt.kind === "NO_REMOTE"
                    ? "未配置远程仓库"
                    : remoteConfigPrompt.kind === "NO_UPSTREAM"
                    ? "未配置分支上游跟踪 (Upstream)"
                    : "无法访问远程仓库"}
                </h3>
                <p className="text-xs text-[#64748b] mt-1">
                  {remoteConfigPrompt.kind === "NO_REMOTE"
                    ? `当前仓库尚未配置远程地址 (${remoteConfigPrompt.remoteName})，请填写远程仓库地址后再执行操作：`
                    : remoteConfigPrompt.kind === "NO_UPSTREAM"
                    ? `当前分支${
                        remoteConfigPrompt.localBranch
                          ? ` "${remoteConfigPrompt.localBranch}" `
                          : ""
                      }尚未关联远程跟踪分支，请指定要关联并拉取的远程仓库与分支：`
                    : `无法读取或推送到远程仓库 ${remoteConfigPrompt.remoteName}，请检查远程地址是否正确、仓库是否存在以及 SSH 访问权限是否已配置：`}
                </p>

                {remoteConfigPrompt.kind === "NO_UPSTREAM" ? (
                  <div className="mt-2.5 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-28 shrink-0">
                        <label className="block text-[10.5px] font-medium text-[#475569] mb-1">
                          远程仓库
                        </label>
                        {remoteConfigPrompt.availableRemotes.length > 1 ? (
                          <select
                            value={remoteConfigPrompt.remoteName}
                            onChange={async (e) => {
                              const nextRemote = e.target.value;
                              const brs = await GitService.ListBranches(
                                activeRepo.path
                              ).catch(() => []);
                              const remBranches = (brs ?? [])
                                .filter(
                                  (b) =>
                                    b.isRemote && b.remoteName === nextRemote
                                )
                                .map((b) =>
                                  b.name.startsWith(`${nextRemote}/`)
                                    ? b.name.slice(nextRemote.length + 1)
                                    : b.name
                                );
                              setRemoteConfigPrompt((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      remoteName: nextRemote,
                                      availableRemoteBranches: remBranches,
                                    }
                                  : prev
                              );
                            }}
                            className="w-full px-2 py-1.5 rounded bg-white border border-[#cbd5e1] text-[12px] font-mono outline-none"
                          >
                            {remoteConfigPrompt.availableRemotes.map((r) => (
                              <option key={r.name} value={r.name}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="px-2.5 py-1.5 rounded bg-[#f1f5f9] border border-[#e2e8f0] font-mono text-[12px] font-semibold text-[#0b1c30] truncate">
                            {remoteConfigPrompt.remoteName}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10.5px] font-medium text-[#475569]">
                            目标远程分支 (将关联{" "}
                            <code className="font-mono">
                              {remoteConfigPrompt.remoteName}/
                              {remoteConfigPrompt.targetBranch || "<branch>"}
                            </code>
                            )
                          </label>
                          <button
                            type="button"
                            disabled={remoteConfigPrompt.fetchingBranches}
                            onClick={async () => {
                              setRemoteConfigPrompt((prev) =>
                                prev
                                  ? { ...prev, fetchingBranches: true }
                                  : prev
                              );
                              const fRes = await GitService.Fetch(
                                activeRepo.path
                              ).catch(() => null);
                              if (fRes && !fRes.success) {
                                setRemoteConfigPrompt((prev) =>
                                  prev
                                    ? { ...prev, fetchingBranches: false }
                                    : prev
                                );
                                await promptRemoteConfigIfNeeded(
                                  activeRepo.path,
                                  remoteConfigPrompt.op,
                                  fRes.errorCode,
                                  fRes.output || fRes.message
                                );
                                return;
                              }
                              const brs = await GitService.ListBranches(
                                activeRepo.path
                              ).catch(() => []);
                              const remBranches = (brs ?? [])
                                .filter(
                                  (b) =>
                                    b.isRemote &&
                                    b.remoteName ===
                                      remoteConfigPrompt.remoteName
                                )
                                .map((b) =>
                                  b.name.startsWith(
                                    `${remoteConfigPrompt.remoteName}/`
                                  )
                                    ? b.name.slice(
                                        remoteConfigPrompt.remoteName.length + 1
                                      )
                                    : b.name
                                );
                              setRemoteConfigPrompt((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      fetchingBranches: false,
                                      availableRemoteBranches: remBranches,
                                      targetBranch:
                                        (prev.localBranch &&
                                        remBranches.includes(prev.localBranch)
                                          ? prev.localBranch
                                          : "") ||
                                        remBranches[0] ||
                                        prev.targetBranch,
                                    }
                                  : prev
                              );
                            }}
                            className="text-[10.5px] text-[#0284c7] hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            {remoteConfigPrompt.fetchingBranches
                              ? "正在获取..."
                              : "刷新远程分支"}
                          </button>
                        </div>
                        <input
                          type="text"
                          autoFocus
                          placeholder="例如 main 或 master"
                          value={remoteConfigPrompt.targetBranch}
                          onChange={(e) =>
                            setRemoteConfigPrompt((prev) =>
                              prev
                                ? { ...prev, targetBranch: e.target.value }
                                : prev
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-[12px] font-mono outline-none"
                        />
                      </div>
                    </div>

                    {remoteConfigPrompt.availableRemoteBranches.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10.5px] text-[#64748b]">
                          已有远程分支：
                        </span>
                        {remoteConfigPrompt.availableRemoteBranches
                          .slice(0, 8)
                          .map((b) => (
                            <button
                              key={b}
                              type="button"
                              onClick={() =>
                                setRemoteConfigPrompt((prev) =>
                                  prev ? { ...prev, targetBranch: b } : prev
                                )
                              }
                              className={`px-1.5 py-0.5 rounded font-mono text-[10.5px] border cursor-pointer ${
                                remoteConfigPrompt.targetBranch === b
                                  ? "bg-[#e0f2fe] border-[#7dd3fc] text-[#0369a1] font-semibold"
                                  : "bg-[#f8fafc] border-[#e2e8f0] hover:bg-[#f1f5f9] text-[#475569]"
                              }`}
                            >
                              {remoteConfigPrompt.remoteName}/{b}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-2.5 flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium text-[#334155]">
                      远程仓库地址 ({remoteConfigPrompt.remoteName})
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-1.5 rounded bg-[#f1f5f9] font-mono text-[11px] font-semibold text-[#0b1c30] shrink-0">
                        {remoteConfigPrompt.remoteName}
                      </span>
                      <input
                        type="text"
                        autoFocus
                        placeholder="git@github.com:user/repo.git 或 https://..."
                        value={remoteConfigPrompt.draftUrl}
                        onChange={(e) =>
                          setRemoteConfigPrompt((prev) =>
                            prev ? { ...prev, draftUrl: e.target.value } : prev
                          )
                        }
                        className="flex-1 px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-[12px] font-mono outline-none"
                      />
                      {httpsToSshUrl(remoteConfigPrompt.draftUrl) && (
                        <button
                          type="button"
                          onClick={() => {
                            const ssh = httpsToSshUrl(
                              remoteConfigPrompt.draftUrl
                            );
                            if (!ssh) return;
                            setRemoteConfigPrompt((prev) =>
                              prev ? { ...prev, draftUrl: ssh } : prev
                            );
                          }}
                          className="px-2 py-1.5 rounded bg-[#f0f9ff] border border-[#bae6fd] hover:bg-[#e0f2fe] text-[#0369a1] text-[11px] font-medium shrink-0 cursor-pointer"
                        >
                          转为 SSH
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {remoteConfigPrompt.errorMessage && (
                  <pre className="mt-2.5 p-2 rounded bg-[#fef2f2] border border-[#fecaca] text-[10px] font-mono text-[#991b1b] whitespace-pre-wrap max-h-24 overflow-y-auto select-text">
                    {remoteConfigPrompt.errorMessage}
                  </pre>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setRemoteConfigPrompt(null);
                  setGitConfigModal({
                    open: true,
                    scope: "local",
                    expandAdvanced: true,
                  });
                }}
                className="px-3 py-1.5 rounded bg-[#f8fafc] border border-[#cbd5e1] hover:bg-[#f1f5f9] text-[#334155] text-xs font-medium cursor-pointer"
              >
                配置 SSH / Git
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRemoteConfigPrompt(null)}
                  className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] text-xs font-medium cursor-pointer"
                >
                  取消
                </button>
                {remoteConfigPrompt.kind === "NO_UPSTREAM" ? (
                  <button
                    type="button"
                    disabled={!remoteConfigPrompt.targetBranch.trim()}
                    onClick={async () => {
                      const p = remoteConfigPrompt;
                      const branchTarget = p.targetBranch.trim();
                      if (!branchTarget) return;
                      setRemoteConfigPrompt(null);
                      notify(
                        "info",
                        `正在关联 ${p.remoteName}/${branchTarget}...`
                      );
                      const upRes = await GitService.SetBranchUpstream(
                        activeRepo.path,
                        p.localBranch,
                        p.remoteName,
                        branchTarget
                      );
                      if (!upRes.success) {
                        const handled = await promptRemoteConfigIfNeeded(
                          activeRepo.path,
                          p.op,
                          upRes.errorCode,
                          upRes.output ||
                            upRes.message ||
                            "设置上游分支失败",
                          p.remoteName
                        );
                        if (!handled) {
                          notify(
                            "error",
                            upRes.message || "设置上游跟踪分支失败"
                          );
                        }
                        return;
                      }
                      await refreshRepo(activeRepo.path);
                      if (p.op === "pull" || p.op === "push" || p.op === "fetch") {
                        await handleRemote(p.op);
                      } else {
                        notify("success", upRes.message);
                      }
                    }}
                    className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                  >
                    关联并重试拉取
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!remoteConfigPrompt.draftUrl.trim()}
                    onClick={async () => {
                      const p = remoteConfigPrompt;
                      const targetUrl = p.draftUrl.trim();
                      if (!targetUrl) return;
                      setRemoteConfigPrompt(null);
                      const setRes = await GitService.SetRemoteURL(
                        activeRepo.path,
                        p.remoteName,
                        targetUrl
                      );
                      if (!setRes.success) {
                        notify("error", setRes.message || "保存远程仓库地址失败");
                        return;
                      }
                      await refreshRepo(activeRepo.path);
                      if (p.op === "tag") {
                        notify(
                          "success",
                          `已保存远程仓库 ${p.remoteName}，请重试标签操作`
                        );
                        return;
                      }
                      notify("info", `已配置 ${p.remoteName}，正在重试...`);
                      await handleRemote(p.op);
                    }}
                    className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                  >
                    {remoteConfigPrompt.op === "push"
                      ? "保存并重试推送"
                      : remoteConfigPrompt.op === "pull"
                      ? "保存并重试拉取"
                      : remoteConfigPrompt.op === "fetch"
                      ? "保存并重试获取"
                      : "保存远程地址"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {httpsRemotePrompt && activeRepo && (
        <div className="fixed inset-0 z-50 bg-[#0f172a]/30 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white border border-[#cbd5e1] rounded-xl shadow-xl p-4 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-[#fef3c7] text-[#d97706] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[#0b1c30]">
                  Push Failed (Remote Uses HTTPS)
                </h3>
                <p className="text-xs text-[#64748b] mt-1">
                  Remote <code className="font-mono">{httpsRemotePrompt.remoteName}</code> is currently using HTTPS, so SSH keys are not used:
                </p>
                <div className="mt-2 p-2 rounded bg-[#f8fafc] border border-[#e2e8f0] font-mono text-[11px] flex flex-col gap-1">
                  <div className="text-[#dc2626] break-all">
                    Current: {httpsRemotePrompt.currentUrl}
                  </div>
                  <div className="text-[#16a34a] break-all">
                    SSH URL: {httpsRemotePrompt.sshUrl}
                  </div>
                </div>
                <pre className="mt-2 p-2 rounded bg-[#fef2f2] border border-[#fecaca] text-[10px] font-mono text-[#991b1b] whitespace-pre-wrap max-h-24 overflow-y-auto">
                  {httpsRemotePrompt.errorMessage}
                </pre>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setHttpsRemotePrompt(null)}
                className="px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const p = httpsRemotePrompt;
                  setHttpsRemotePrompt(null);
                  const setRes = await GitService.SetRemoteURL(
                    activeRepo.path,
                    p.remoteName,
                    p.sshUrl
                  );
                  if (!setRes.success) {
                    notify("error", setRes.message);
                    return;
                  }
                  notify("info", `Switched ${p.remoteName} to SSH, pushing...`);
                  await handleRemote("push");
                }}
                className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium cursor-pointer"
              >
                Switch to SSH & Retry Push
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOASTS */}
      <div className="fixed bottom-8 right-4 z-50 flex flex-col gap-1.5 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto px-3 py-2 rounded-lg shadow-lg border text-xs font-medium max-w-md flex items-start justify-between gap-2 ${
              t.type === "error"
                ? "bg-[#fef2f2] border-[#fecaca] text-[#991b1b]"
                : t.type === "success"
                ? "bg-[#f0fdf4] border-[#bbf7d0] text-[#14532d]"
                : "bg-white border-[#cbd5e1] text-[#0b1c30]"
            }`}
          >
            <span className="break-words select-text">{t.text}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="opacity-60 hover:opacity-100 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
