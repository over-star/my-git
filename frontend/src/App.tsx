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
  Layers,
  Sparkles,
  RotateCw,
} from "lucide-react";
import { Events } from "@wailsio/runtime";
import type {
  BranchInfo,
  CommitItem,
  FileStatus,
  RemoteInfo,
  RepoLocation,
  RepoStatus,
  StashItem,
  TagInfo,
} from "../bindings/gitpulse/internal/git/models";
import { GitService, UpdateService } from "../bindings/gitpulse";
import type { UpdateStatus } from "../bindings/gitpulse";
import { Sidebar } from "./components/Sidebar";
import { ChangesView } from "./components/ChangesView";
import { HistoryView } from "./components/HistoryView";
import { ConflictView } from "./components/ConflictView";
import { SplitHandle } from "./components/SplitHandle";
import { UpdateModal } from "./components/UpdateModal";
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

type ViewMode = "history" | "changes" | "conflicts";

function isValidHistoryRef(
  ref: string,
  branches: BranchInfo[],
  tags: TagInfo[]
): boolean {
  if (!ref || ref === "__ALL__") return true;
  if (branches.some((b) => b.fullName === ref || b.name === ref)) return true;
  if (tags.some((t) => `refs/tags/${t.name}` === ref || t.name === ref)) return true;
  return false;
}

interface ToastMsg {
  id: number;
  type: "success" | "error" | "info";
  text: string;
}

export function App() {
  const [tabs, setTabs] = useState<RepoLocation[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
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
  const [pinnedBranches, setPinnedBranches] = useState<string[]>([]);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [globalGitVer, setGlobalGitVer] = useState("");
  const [quickFilter, setQuickFilter] = useState("");
  const [repoSwitcherOpen, setRepoSwitcherOpen] = useState(false);
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
  const [gitConfigModal, setGitConfigModal] = useState<{
    open: boolean;
    scope: "local" | "global";
  }>({ open: false, scope: "local" });
  const [effectiveAuthor, setEffectiveAuthor] = useState<{
    name: string;
    email: string;
  }>({ name: "", email: "" });
  const [httpsRemotePrompt, setHttpsRemotePrompt] = useState<{
    remoteName: string;
    currentUrl: string;
    sshUrl: string;
    errorMessage: string;
  } | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: "idle",
    currentVersion: "0.1.0",
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

  const notify = useCallback((type: "success" | "error" | "info", text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, type === "error" ? 8000 : 4500);
  }, []);

  const activeRepo = tabs.find((t) => t.path === activePath) ?? null;

  const refreshSeqRef = React.useRef(0);

  const refreshRepo = useCallback(
    async (repoPath?: string) => {
      const target = repoPath ?? activePath;
      if (!target) return;
      const seq = ++refreshSeqRef.current;
      setRefreshing(true);
      try {
        const [st, br, tg, sh, rm, pins, cfg] = await Promise.all([
          GitService.GetStatus(target),
          GitService.ListBranches(target),
          GitService.ListTags(target),
          GitService.ListStashes(target),
          GitService.ListRemotes(target).catch(() => [] as RemoteInfo[]),
          GitService.GetPinnedBranches(target).catch(() => [] as string[]),
          GitService.GetGitConfig(target, ""),
        ]);
        if (seq !== refreshSeqRef.current) return;
        const nextBranches = br ?? [];
        const nextTags = tg ?? [];
        setStatus(st);
        setBranches(nextBranches);
        setTags(nextTags);
        setStashes(sh ?? []);
        setRemotes(rm ?? []);
        setPinnedBranches(pins ?? []);
        setLastBranchRefState((prev) =>
          prev.repoPath === target &&
          prev.ref &&
          !nextBranches.some((b) => b.fullName === prev.ref || b.name === prev.ref)
            ? { repoPath: target, ref: "" }
            : prev
        );
        setHistoryBranchState((prev) =>
          prev.repoPath === target &&
          !isValidHistoryRef(prev.ref, nextBranches, nextTags)
            ? { repoPath: target, ref: "__ALL__" }
            : prev
        );
        setEffectiveAuthor({
          name: cfg?.effective?.userName ?? "",
          email: cfg?.effective?.userEmail ?? "",
        });
        setHistoryRefreshKey((k) => k + 1);
      } catch (err) {
        if (seq === refreshSeqRef.current) {
          notify("error", `Refresh failed: ${err}`);
        }
      } finally {
        if (seq === refreshSeqRef.current) {
          setRefreshing(false);
        }
      }
    },
    [activePath, notify]
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
        const loaded: RepoLocation[] = [];
        for (const p of paths) {
          try {
            const loc = await GitService.OpenRepo(p);
            loaded.push(loc);
          } catch {
            // Skip deleted/unavailable repos silently
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
      .catch(() => setRepoModalOpen(true));

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

    const offOpenRepo = Events.On("app:open-repo", (ev: any) => {
      const rawPath = String(ev?.data ?? ev ?? "").trim();
      if (!rawPath) return;
      GitService.OpenRepo(rawPath)
        .then((loc) => handleOpenedRepo(loc))
        .catch(() => {});
    });

    const updateTimer = window.setTimeout(() => {
      UpdateService.CheckForUpdate()
        .then((st) => {
          if (st) setUpdateStatus(st);
        })
        .catch(() => {});
    }, 2500);

    return () => {
      offUpdate();
      offOpenRepo();
      window.clearTimeout(updateTimer);
    };
  }, []);

  // Persist tabs whenever changed
  useEffect(() => {
    GitService.SaveOpenTabs(
      tabs.map((t) => t.path),
      activePath ?? ""
    );
  }, [tabs, activePath]);

  // Refresh whenever activePath changes
  useEffect(() => {
    setHistoryBranch("__ALL__");
    setBranchScopeMode("all");
    setLastBranchRef("");
    setFocusCommitSignal(null);
    setStatus(null);
    setBranches([]);
    setTags([]);
    setStashes([]);
    setRemotes([]);
    setPinnedBranches([]);
    setRepoSwitcherOpen(false);
    setTabCtxMenu(null);
    if (activePath) {
      refreshRepo(activePath);
    }
  }, [activePath]);

  // Close repo switcher or tab context menu on outside click / Escape
  useEffect(() => {
    if (!repoSwitcherOpen && !tabCtxMenu) return;
    const close = () => {
      setRepoSwitcherOpen(false);
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
  }, [repoSwitcherOpen, tabCtxMenu]);

  // Auto-refresh on window focus
  useEffect(() => {
    const onFocus = () => {
      if (activePath) refreshRepo(activePath);
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
    refreshRepo(loc.path);
  };

  const closeTabByPath = (repoPath: string) => {
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

  // --- Remote Actions ---
  const handleRemote = async (op: "fetch" | "pull" | "push") => {
    if (!activeRepo || remoteBusy) return;
    setRemoteBusy(op);
    try {
      const res =
        op === "fetch"
          ? await GitService.Fetch(activeRepo.path)
          : op === "pull"
          ? await GitService.Pull(activeRepo.path)
          : await GitService.Push(activeRepo.path);

      if (res.success) {
        notify("success", res.message);
      } else if (res.errorCode === "CONFLICT") {
        notify("error", "Pull resulted in merge conflicts! Resolve them in Conflict Resolver.");
        setView("conflicts");
      } else if (
        op === "push" &&
        res.errorCode === "HTTPS_REMOTE" &&
        (await promptHttpsRemoteIfNeeded(
          activeRepo.path,
          res.message || "HTTPS push failed"
        ))
      ) {
        // Modal displayed
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
      notify("error", "No remote configured for this repository");
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

  const changedCount = (status?.unstaged?.length ?? 0) + (status?.staged?.length ?? 0);
  const conflictCount = status?.conflicted?.length ?? 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#f8fafc] text-[#0b1c30] overflow-hidden">
      {/* 1. TOP WINDOW TITLEBAR + REPO TABS */}
      <header className="h-10 bg-gradient-to-b from-[#e4eeff] to-[#dae7fd] flex items-end justify-between pl-2.5 pr-0 shrink-0 app-drag select-none relative z-30">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#cbd5e1] z-0" />
        <div className="relative z-10 flex items-end gap-1.5 min-w-0 flex-1 h-full">
          {/* App Brand Mark */}
          <div
            title="mygit"
            className="h-full flex items-center gap-1.5 pr-1 shrink-0 app-no-drag"
          >
            <img
              src="/mygit-icon.png"
              alt="mygit"
              draggable={false}
              className="w-6 h-6 rounded-md shadow-xs select-none"
            />
            {tabs.length === 0 && (
              <span className="text-[12px] font-semibold tracking-tight text-[#0b1c30]">
                mygit
              </span>
            )}
          </div>

          {/* Scrollable Repo Tabs */}
          <div
            onWheel={(e) => {
              if (e.deltaY !== 0) {
                e.currentTarget.scrollLeft += e.deltaY;
              }
            }}
            className="flex items-end gap-0.5 min-w-0 overflow-x-auto no-scrollbar pt-1.5 app-no-drag"
          >
            {tabs.map((tab, idx) => {
              const active = tab.path === activePath;
              const nextActive = tabs[idx + 1]?.path === activePath;
              const showDivider = !active && !nextActive && idx < tabs.length - 1;
              const tabTitle = tab.isWsl
                ? `WSL2 (${tab.distro}): ${tab.linuxPath}`
                : tab.path;
              return (
                <React.Fragment key={tab.path}>
                  <div
                    onClick={() => setActivePath(tab.path)}
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
                    className={`group relative flex items-center gap-1.5 pl-2.5 pr-1.5 h-[34px] rounded-t-lg border-t border-x text-[11px] cursor-pointer transition-colors shrink-0 max-w-[210px] ${
                      active
                        ? "z-10 bg-white text-[#0b1c30] font-semibold border-[#cbd5e1] shadow-[0_-1px_3px_rgba(15,23,42,0.05)]"
                        : "bg-transparent border-transparent text-[#475569] font-medium hover:bg-white/55 hover:text-[#0b1c30]"
                    }`}
                  >
                    {active && (
                      <span
                        className={`absolute top-0 left-2 right-2 h-[2px] rounded-b-full ${
                          tab.isWsl ? "bg-[#7c3aed]" : "bg-[#0284c7]"
                        }`}
                      />
                    )}
                    <FolderGit2
                      className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                        tab.isWsl
                          ? active
                            ? "text-[#7c3aed]"
                            : "text-[#7c3aed]/75 group-hover:text-[#7c3aed]"
                          : active
                          ? "text-[#0284c7]"
                          : "text-[#0284c7]/75 group-hover:text-[#0284c7]"
                      }`}
                    />
                    <span className="truncate max-w-[120px]">{tab.name}</span>
                    {tab.isWsl && (
                      <span
                        className={`px-1.5 py-[1px] rounded-full text-[9px] font-mono font-semibold leading-none shrink-0 border ${
                          active
                            ? "bg-[#ede9fe] text-[#6d28d9] border-[#ddd6fe]"
                            : "bg-[#ede9fe]/75 text-[#6d28d9]/90 border-[#ddd6fe]/70"
                        }`}
                      >
                        WSL2
                      </span>
                    )}
                    <button
                      aria-label={`Close ${tab.name}`}
                      onClick={(e) => handleCloseTab(e, tab.path)}
                      className={`p-0.5 rounded-sm transition-opacity cursor-pointer shrink-0 ${
                        active
                          ? "opacity-70 hover:opacity-100 hover:bg-[#f1f5f9] text-[#64748b] hover:text-[#0b1c30]"
                          : "opacity-0 group-hover:opacity-75 hover:!opacity-100 hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0b1c30]"
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {showDivider && (
                    <div className="w-px h-3.5 bg-[#bfcee4] self-center shrink-0 mx-0.5" />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Add Repo + Quick Project Switcher */}
          <div className="flex items-center gap-1 pb-1.5 pl-0.5 shrink-0 app-no-drag relative">
            <button
              title="Open / Clone / Init Repository"
              onClick={() => setRepoModalOpen(true)}
              className="h-7 px-2 rounded-md bg-white/75 hover:bg-white border border-[#cbd5e1]/90 text-[#334155] hover:text-[#0284c7] flex items-center gap-1 text-[11px] font-medium shadow-2xs transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {tabs.length <= 1 && <span>Open</span>}
            </button>

            {tabs.length > 1 && (
              <div className="relative">
                <button
                  title={`Switch open repository (${tabs.length})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTabCtxMenu(null);
                    setRepoSwitcherOpen((v) => !v);
                  }}
                  className={`h-7 px-2 rounded-md border flex items-center gap-1 text-[11px] font-medium transition-colors cursor-pointer ${
                    repoSwitcherOpen
                      ? "bg-white border-[#0284c7] text-[#0284c7] shadow-xs"
                      : "bg-white/75 hover:bg-white border-[#cbd5e1]/90 text-[#475569] hover:text-[#0b1c30]"
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  <span className="font-mono text-[10px] font-semibold">
                    {tabs.length}
                  </span>
                  <ChevronDown className="w-3 h-3 opacity-75" />
                </button>

                {repoSwitcherOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 top-8 z-50 w-72 bg-white border border-[#cbd5e1] rounded-xl shadow-xl py-1.5 text-[12px] text-[#0b1c30]"
                  >
                    <div className="px-3 py-1 border-b border-[#f1f5f9] flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">
                      <span>Open Repositories ({tabs.length})</span>
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
                                title={`Close ${t.name}`}
                                onClick={(e) => handleCloseTab(e, t.path)}
                                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[#fee2e2] text-[#64748b] hover:text-[#dc2626] cursor-pointer"
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
                        <span>Open or Clone Another Repository...</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Flexible Drag Handle Space */}
          <div className="flex-1 min-w-[32px] h-full app-drag" />
        </div>

        {/* Window Controls */}
        <div className="flex items-center app-no-drag shrink-0 h-full">
          <button
            aria-label="Minimize"
            onClick={() => GitService.MinimizeWindow()}
            className="h-10 w-11 flex items-center justify-center text-[#475569] hover:bg-[#cdddf9] transition-colors cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            aria-label="Maximize"
            onClick={() => GitService.ToggleMaximizeWindow()}
            className="h-10 w-11 flex items-center justify-center text-[#475569] hover:bg-[#cdddf9] transition-colors cursor-pointer"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            aria-label="Close"
            onClick={() => GitService.CloseWindow()}
            className="h-10 w-11 flex items-center justify-center text-[#475569] hover:bg-[#dc2626] hover:text-white transition-colors cursor-pointer"
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
            title="Configure Git user.name, user.email & options (Local / Global / WSL2)"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-medium cursor-pointer transition-colors ${
              activeRepo && !effectiveAuthor.name && !effectiveAuthor.email
                ? "bg-[#fef2f2] border-[#fecaca] text-[#dc2626] hover:bg-[#fee2e2]"
                : "bg-white border-[#e2e8f0] text-[#334155] hover:bg-[#f8fafc] hover:border-[#cbd5e1]"
            }`}
          >
            <User className="w-3.5 h-3.5 text-[#0284c7]" />
            <span className="max-w-[140px] truncate">
              {effectiveAuthor.name || "Set Git Identity"}
            </span>
            <Settings className="w-3 h-3 text-[#64748b]" />
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
        </div>
      </div>

      {/* 3. VIEW SWITCHER BAR */}
      <div className="h-9 px-3 bg-[#eff4ff] border-b border-[#e2e8f0] flex items-center justify-between shrink-0 select-none">
        <nav className="flex items-center gap-1">
          <button
            onClick={() => setView("history")}
            className={`px-3 py-1 rounded text-[12px] font-medium transition-colors cursor-pointer ${
              view === "history"
                ? "bg-[#0284c7] text-white shadow-sm"
                : "text-[#475569] hover:text-[#0b1c30] hover:bg-[#e5eeff]"
            }`}
          >
            Commit Graph
          </button>
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

        <div className="flex items-center gap-2">
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
                if (!refName.startsWith("refs/tags/")) {
                  setLastBranchRef(refName);
                }
                const effectiveScope = forceScope ?? branchScopeMode;
                if (forceScope) {
                  setBranchScopeMode(forceScope);
                }
                if (effectiveScope === "all" && !refName.startsWith("refs/tags/")) {
                  setHistoryBranch("__ALL__");
                  if (focusSha) {
                    setFocusCommitSignal({ sha: focusSha, nonce: Date.now() });
                  }
                } else {
                  setHistoryBranch(refName);
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
                  setPinnedBranches(next ?? []);
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
                  onChangeRatios={updateLayout}
                  onRefresh={() => refreshRepo(activeRepo.path)}
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
                  selectedBranch={historyBranch}
                  onSelectBranch={(ref) => {
                    setHistoryBranch(ref);
                    if (ref === "__ALL__") {
                      setBranchScopeMode("all");
                    } else {
                      setBranchScopeMode("branch");
                      if (!ref.startsWith("refs/tags/")) {
                        setLastBranchRef(ref);
                      }
                    }
                  }}
                  focusCommitSignal={focusCommitSignal}
                  refreshKey={historyRefreshKey}
                  externalSearch={quickFilter}
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
        onClose={() => setGitConfigModal((m) => ({ ...m, open: false }))}
        onSaved={(msg) => {
          notify("success", msg);
          if (activeRepo) refreshRepo(activeRepo.path);
        }}
        onNotify={notify}
      />

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
