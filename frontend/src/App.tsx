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
} from "lucide-react";
import type {
  BranchInfo,
  CommitItem,
  FileStatus,
  RepoLocation,
  RepoStatus,
  StashItem,
  TagInfo,
} from "../bindings/gitpulse/internal/git/models";
import { GitService } from "../bindings/gitpulse";
import { Sidebar } from "./components/Sidebar";
import { ChangesView } from "./components/ChangesView";
import { HistoryView } from "./components/HistoryView";
import { ConflictView } from "./components/ConflictView";
import { RepoModal } from "./components/RepoModal";
import { GitConfigModal, httpsToSshUrl } from "./components/GitConfigModal";
import {
  CheckoutConflictModal,
  CreateBranchModal,
  CreateTagModal,
  DeleteBranchModal,
  DeleteRemoteBranchModal,
  DiscardConfirmModal,
  RenameBranchModal,
  ResetCommitModal,
  RevertCommitModal,
  StashModal,
} from "./components/Dialogs";

type ViewMode = "history" | "changes" | "conflicts";

interface ToastMsg {
  id: number;
  type: "success" | "error" | "info";
  text: string;
}

export function App() {
  const [tabs, setTabs] = useState<RepoLocation[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("changes");
  const [historyBranch, setHistoryBranch] = useState<string>("__ALL__");

  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [stashes, setStashes] = useState<StashItem[]>([]);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [globalGitVer, setGlobalGitVer] = useState("");
  const [quickFilter, setQuickFilter] = useState("");

  // Remote loading states
  const [remoteBusy, setRemoteBusy] = useState<"fetch" | "pull" | "push" | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Modals
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<FileStatus | null>(null);
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
    errorMessage: string;
  } | null>(null);
  const [stashModalOpen, setStashModalOpen] = useState(false);
  const [tagModal, setTagModal] = useState<{ open: boolean; target: string }>({
    open: false,
    target: "",
  });
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

  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const notify = useCallback((type: "success" | "error" | "info", text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, type === "error" ? 8000 : 4500);
  }, []);

  const activeRepo = tabs.find((t) => t.path === activePath) ?? null;

  const refreshRepo = useCallback(
    async (repoPath?: string) => {
      const target = repoPath ?? activePath;
      if (!target) return;
      setRefreshing(true);
      try {
        const [st, br, tg, sh, cfg] = await Promise.all([
          GitService.GetStatus(target),
          GitService.ListBranches(target),
          GitService.ListTags(target),
          GitService.ListStashes(target),
          GitService.GetGitConfig(target, ""),
        ]);
        setStatus(st);
        setBranches(br ?? []);
        setTags(tg ?? []);
        setStashes(sh ?? []);
        setEffectiveAuthor({
          name: cfg?.effective?.userName ?? "",
          email: cfg?.effective?.userEmail ?? "",
        });
        setHistoryRefreshKey((k) => k + 1);
      } catch (err) {
        notify("error", `Refresh failed: ${err}`);
      } finally {
        setRefreshing(false);
      }
    },
    [activePath, notify]
  );

  // Restore saved tabs on startup
  useEffect(() => {
    GitService.GetGitGlobalVersion().then(setGlobalGitVer).catch(() => {});
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
    if (activePath) {
      refreshRepo(activePath);
    } else {
      setStatus(null);
      setBranches([]);
      setTags([]);
      setStashes([]);
    }
  }, [activePath]);

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

  const handleCloseTab = (e: React.MouseEvent, repoPath: string) => {
    e.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== repoPath);
      if (activePath === repoPath) {
        setActivePath(next.length > 0 ? next[0].path : null);
        if (next.length === 0) setRepoModalOpen(true);
      }
      return next;
    });
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
      } else if (op === "push" && res.errorCode === "HTTPS_REMOTE") {
        const remotes = await GitService.ListRemotes(activeRepo.path).catch(() => []);
        const target = (remotes ?? []).find((r) => {
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
            errorMessage: res.message || "HTTPS push failed",
          });
        } else {
          notify("error", res.message || "Push failed");
        }
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

  // --- Branch & Stash Actions ---
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
          errorMessage: res.output || res.message,
        });
      } else {
        notify("error", res.message || "Checkout failed");
      }
    } catch (err) {
      notify("error", String(err));
    }
  };

  const handleStashAndCheckout = async (name: string, isRemote: boolean) => {
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
      const ckRes = await GitService.CheckoutBranch(activeRepo.path, name, isRemote);
      if (ckRes.success) {
        notify("success", `Stashed changes and switched to ${name}`);
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

  const handleDiscardConfirm = async (file: FileStatus) => {
    if (!activeRepo) return;
    setDiscardTarget(null);
    try {
      await GitService.DiscardFile(activeRepo.path, file.path, file.status === "?");
      notify("info", `Discarded ${file.path}`);
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
      <header className="h-9 bg-[#e5eeff] border-b border-[#cbd5e1] flex items-center justify-between px-2 shrink-0 app-drag select-none">
        <div className="flex items-center gap-1.5 min-w-0 app-no-drag">
          <div className="w-5 h-5 rounded bg-[#0284c7] text-white flex items-center justify-center shrink-0">
            <GitBranch className="w-3.5 h-3.5" />
          </div>

          {/* Repo Tabs */}
          <div className="flex items-center gap-1 ml-1 overflow-x-auto max-w-[60vw]">
            {tabs.map((tab) => {
              const active = tab.path === activePath;
              return (
                <div
                  key={tab.path}
                  onClick={() => setActivePath(tab.path)}
                  title={tab.isWsl ? `WSL2 (${tab.distro}): ${tab.linuxPath}` : tab.path}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-t text-[11px] font-medium cursor-pointer transition-colors shrink-0 ${
                    active
                      ? "bg-white text-[#0b1c30] shadow-sm border-t border-x border-[#cbd5e1]"
                      : "text-[#475569] hover:bg-[#dce9ff] hover:text-[#0b1c30]"
                  }`}
                >
                  <FolderGit2 className="w-3.5 h-3.5 text-[#0284c7] shrink-0" />
                  <span className="max-w-[140px] truncate">{tab.name}</span>
                  {tab.isWsl && (
                    <span className="px-1 rounded bg-[#ede9fe] text-[#6d28d9] text-[9px] font-mono font-semibold">
                      WSL2
                    </span>
                  )}
                  <button
                    onClick={(e) => handleCloseTab(e, tab.path)}
                    className="p-0.5 rounded hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0b1c30] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
            <button
              title="Open / Clone / Init Repository"
              onClick={() => setRepoModalOpen(true)}
              className="p-1 rounded hover:bg-[#dce9ff] text-[#475569] hover:text-[#0b1c30] cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="text-[10px] font-semibold uppercase tracking-widest text-[#475569] pointer-events-none hidden md:block">
          GitPulse • Windows & WSL2 Client
        </div>

        {/* Window Controls */}
        <div className="flex items-center app-no-drag -mr-2">
          <button
            aria-label="Minimize"
            onClick={() => GitService.MinimizeWindow()}
            className="h-9 w-11 flex items-center justify-center text-[#475569] hover:bg-[#dce9ff] cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            aria-label="Maximize"
            onClick={() => GitService.ToggleMaximizeWindow()}
            className="h-9 w-11 flex items-center justify-center text-[#475569] hover:bg-[#dce9ff] cursor-pointer"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            aria-label="Close"
            onClick={() => GitService.CloseWindow()}
            className="h-9 w-11 flex items-center justify-center text-[#475569] hover:bg-[#dc2626] hover:text-white cursor-pointer"
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
                <span className="font-mono text-[11px] text-[#334155]">
                  {status.upstream || status.branch || "local"}
                </span>
                <span className="px-1.5 py-0.2 rounded bg-[#e2e8f0] font-mono text-[10px] text-[#334155]">
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
              branches={branches}
              tags={tags}
              stashes={stashes}
              currentBranch={status?.branch || ""}
              activeHistoryBranch={view === "history" ? historyBranch : ""}
              onInspectBranch={(branchName) => {
                setHistoryBranch(branchName);
                setView("history");
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
              onRequestStashPush={() => setStashModalOpen(true)}
              onStashApply={(ref) => handleStashOp("apply", ref)}
              onStashPop={(ref) => handleStashOp("pop", ref)}
              onStashDrop={(ref) => handleStashOp("drop", ref)}
            />

            <main className="flex-1 flex min-w-0 min-h-0">
              {view === "changes" && (
                <ChangesView
                  repo={activeRepo}
                  status={status}
                  onRefresh={() => refreshRepo(activeRepo.path)}
                  onOpenConflictResolver={() => setView("conflicts")}
                  onOpenGitConfig={(sc = "local") =>
                    setGitConfigModal({ open: true, scope: sc })
                  }
                  onNotify={notify}
                  onConfirmDiscard={(file) => setDiscardTarget(file)}
                />
              )}
              {view === "history" && (
                <HistoryView
                  repo={activeRepo}
                  branches={branches}
                  selectedBranch={historyBranch}
                  onSelectBranch={setHistoryBranch}
                  refreshKey={historyRefreshKey}
                  externalSearch={quickFilter}
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
            <FolderGit2 className="w-12 h-12 text-[#0284c7] opacity-80" />
            <h1 className="text-base font-semibold text-[#0b1c30]">
              Welcome to GitPulse
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
      <footer className="h-6 px-3 bg-white border-t border-[#e2e8f0] flex items-center justify-between text-[11px] text-[#475569] shrink-0 select-none">
        <div className="flex items-center gap-3 min-w-0">
          {activeRepo && status ? (
            <>
              <span className="flex items-center gap-1 font-mono font-medium text-[#0284c7]">
                <GitBranch className="w-3 h-3" />
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
          <span>Git {activeRepo?.gitVersion || globalGitVer}</span>
        </div>
      </footer>

      {/* MODALS */}
      <RepoModal
        isOpen={repoModalOpen}
        canClose={tabs.length > 0}
        onClose={() => setRepoModalOpen(false)}
        onOpened={handleOpenedRepo}
      />

      <DiscardConfirmModal
        file={discardTarget}
        onCancel={() => setDiscardTarget(null)}
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
