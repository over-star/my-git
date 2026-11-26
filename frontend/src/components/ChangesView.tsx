import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Minus,
  RotateCcw,
  Check,
  Columns2,
  AlignJustify,
  ExternalLink,
  AlertTriangle,
  FileText,
  XCircle,
  History,
  ChevronDown,
  ArrowUp,
  RefreshCw,
  Search,
} from "lucide-react";
import type {
  FileDiff,
  FileStatus,
  RecentCommitMessage,
  RepoLocation,
  RepoStatus,
} from "../../bindings/gitpulse/internal/git/models";
import { GitService } from "../../bindings/gitpulse";
import { DiffViewer } from "./DiffViewer";
import { StatusBadge, getStatusTextColor } from "./StatusBadge";
import { ConfirmDangerModal } from "./Dialogs";
import { SplitHandle } from "./SplitHandle";
import { DEFAULT_LAYOUT, clamp } from "../utils/layout";

interface ChangesViewProps {
  repo: RepoLocation;
  status: RepoStatus | null;
  leftRatio: number;
  unstagedRatio: number;
  ignoreWhitespace: boolean;
  pushBusy?: boolean;
  onToggleIgnoreWhitespace: (ignore: boolean) => void;
  onChangeRatios: (
    patch: { changesLeftRatio?: number; changesUnstagedRatio?: number },
    persist: boolean
  ) => void;
  onRefresh: () => Promise<void>;
  onPushAfterCommit: (amended: boolean) => Promise<void>;
  onOpenConflictResolver: () => void;
  onOpenGitConfig: (scope?: "local" | "global") => void;
  onNotify: (type: "success" | "error" | "info", msg: string) => void;
  onConfirmDiscard: (files: FileStatus[]) => void;
}

const PREFIX_CHIPS = ["feat", "fix", "refactor", "docs", "chore"];
const SUMMARY_RECOMMENDED_LIMIT = 200;

export const ChangesView: React.FC<ChangesViewProps> = ({
  repo,
  status,
  leftRatio,
  unstagedRatio,
  ignoreWhitespace,
  pushBusy = false,
  onToggleIgnoreWhitespace,
  onChangeRatios,
  onRefresh,
  onPushAfterCommit,
  onOpenConflictResolver,
  onOpenGitConfig,
  onNotify,
  onConfirmDiscard,
}) => {
  const unstaged = status?.unstaged ?? [];
  const staged = status?.staged ?? [];
  const conflicted = status?.conflicted ?? [];

  const [selected, setSelected] = useState<{
    file: FileStatus;
    staged: boolean;
  } | null>(null);
  const [multiPaths, setMultiPaths] = useState<string[]>([]);
  const [activeSection, setActiveSection] = useState<"unstaged" | "staged">(
    "unstaged"
  );
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<"split" | "unified">("unified");
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [amend, setAmend] = useState(false);
  const [commitMode, setCommitMode] = useState<"commit" | "commit-push">(() => {
    try {
      return window.localStorage.getItem("mygit.commitMode") === "commit-push"
        ? "commit-push"
        : "commit";
    } catch {
      return "commit";
    }
  });
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const [commitAction, setCommitAction] = useState<
    null | "commit" | "commit-push-committing" | "commit-push-pushing"
  >(null);
  const committing = commitAction !== null;
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [abortConfirmOpen, setAbortConfirmOpen] = useState(false);
  const autoFilledMergeKeyRef = useRef("");

  const [recentOpen, setRecentOpen] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentMessages, setRecentMessages] = useState<RecentCommitMessage[]>([]);
  const [recentFilter, setRecentFilter] = useState("");
  const [recentError, setRecentError] = useState("");
  const recentLoadedKeyRef = useRef("");
  const recentBtnRef = useRef<HTMLButtonElement>(null);
  const recentPopoverRef = useRef<HTMLDivElement>(null);
  const recentSearchRef = useRef<HTMLInputElement>(null);
  const summaryInputRef = useRef<HTMLInputElement>(null);
  const commitMenuRef = useRef<HTMLDivElement>(null);

  const leftColRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);
  const unstagedRef = useRef<HTMLDivElement>(null);
  const stagedRef = useRef<HTMLDivElement>(null);
  const colDragRef = useRef<{ startPx: number; totalPx: number }>({
    startPx: 0,
    totalPx: 1,
  });
  const listDragRef = useRef<{ startPx: number; totalPx: number }>({
    startPx: 0,
    totalPx: 1,
  });

  // Auto-select first available file if selection disappears
  useEffect(() => {
    if (selected) {
      const list = selected.staged ? staged : unstaged;
      const stillThere = list.find((f) => f.path === selected.file.path);
      if (stillThere) {
        if (stillThere !== selected.file) {
          setSelected({ file: stillThere, staged: selected.staged });
        }
        const validSet = new Set(list.map((f) => f.path));
        setMultiPaths((prev) => {
          const filtered = prev.filter((p) => validSet.has(p));
          return filtered.length > 0 ? filtered : [stillThere.path];
        });
        return;
      }
    }
    if (unstaged.length > 0) {
      setSelected({ file: unstaged[0], staged: false });
      setActiveSection("unstaged");
      setMultiPaths([unstaged[0].path]);
      setAnchorPath(unstaged[0].path);
    } else if (staged.length > 0) {
      setSelected({ file: staged[0], staged: true });
      setActiveSection("staged");
      setMultiPaths([staged[0].path]);
      setAnchorPath(staged[0].path);
    } else {
      setSelected(null);
      setMultiPaths([]);
      setAnchorPath(null);
      setDiff(null);
    }
  }, [repo.path, unstaged, staged]);

  // Capture Ctrl+A inside Working Tree to select all files in active section
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "a") return;
      const activeEl = document.activeElement as HTMLElement | null;
      const tag = activeEl?.tagName?.toUpperCase();
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        activeEl?.isContentEditable
      ) {
        return;
      }
      const targetIsStaged =
        (activeSection === "staged" && staged.length > 0) ||
        (unstaged.length === 0 && staged.length > 0);
      const list = targetIsStaged ? staged : unstaged;
      if (list.length === 0) return;

      e.preventDefault();
      e.stopPropagation();
      setActiveSection(targetIsStaged ? "staged" : "unstaged");
      setMultiPaths(list.map((f) => f.path));
      setAnchorPath(list[0].path);
      if (!selected || selected.staged !== targetIsStaged) {
        setSelected({ file: list[0], staged: targetIsStaged });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSection, unstaged, staged, selected]);

  const handleRowSelect = (
    e: React.MouseEvent,
    file: FileStatus,
    isStaged: boolean
  ) => {
    const list = isStaged ? staged : unstaged;
    const sec = isStaged ? "staged" : "unstaged";
    setSelected({ file, staged: isStaged });
    setActiveSection(sec);

    if (e.shiftKey && anchorPath && activeSection === sec) {
      const i1 = list.findIndex((f) => f.path === anchorPath);
      const i2 = list.findIndex((f) => f.path === file.path);
      if (i1 >= 0 && i2 >= 0) {
        const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
        setMultiPaths(list.slice(lo, hi + 1).map((f) => f.path));
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && activeSection === sec) {
      setMultiPaths((prev) =>
        prev.includes(file.path)
          ? prev.length > 1
            ? prev.filter((p) => p !== file.path)
            : prev
          : [...prev, file.path]
      );
      setAnchorPath(file.path);
      return;
    }

    setMultiPaths([file.path]);
    setAnchorPath(file.path);
  };

  // Load diff whenever selection or flags change
  useEffect(() => {
    if (!selected) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    GitService.GetWorkingDiff(
      repo.path,
      selected.file.path,
      selected.staged,
      selected.file.status === "?",
      ignoreWhitespace
    )
      .then((res) => {
        if (!cancelled) setDiff(res);
      })
      .catch((err) => {
        if (!cancelled)
          setDiff({
            path: selected.file.path,
            oldPath: "",
            modeChange: "",
            isBinary: false,
            oldSize: 0,
            newSize: 0,
            additions: 0,
            deletions: 0,
            hunks: [],
            truncated: false,
            rawError: String(err),
          });
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    repo.path,
    selected?.file.path,
    selected?.staged,
    selected?.file.status,
    ignoreWhitespace,
    status,
  ]);

  const handleStage = async (e: React.MouseEvent, file: FileStatus) => {
    e.stopPropagation();
    const targets =
      activeSection === "unstaged" &&
      multiPaths.length > 1 &&
      multiPaths.includes(file.path)
        ? multiPaths
        : [file.path];
    setBusyPath(file.path);
    try {
      await GitService.StageFiles(repo.path, targets);
      await onRefresh();
    } catch (err) {
      onNotify("error", `Stage failed: ${err}`);
    } finally {
      setBusyPath(null);
    }
  };

  const handleUnstage = async (e: React.MouseEvent, file: FileStatus) => {
    e.stopPropagation();
    const targets =
      activeSection === "staged" &&
      multiPaths.length > 1 &&
      multiPaths.includes(file.path)
        ? multiPaths
        : [file.path];
    setBusyPath(file.path);
    try {
      await GitService.UnstageFiles(repo.path, targets);
      await onRefresh();
    } catch (err) {
      onNotify("error", `Unstage failed: ${err}`);
    } finally {
      setBusyPath(null);
    }
  };

  const handleStageSelected = async () => {
    if (activeSection !== "unstaged" || multiPaths.length === 0) return;
    try {
      await GitService.StageFiles(repo.path, multiPaths);
      await onRefresh();
    } catch (err) {
      onNotify("error", `Stage failed: ${err}`);
    }
  };

  const handleUnstageSelected = async () => {
    if (activeSection !== "staged" || multiPaths.length === 0) return;
    try {
      await GitService.UnstageFiles(repo.path, multiPaths);
      await onRefresh();
    } catch (err) {
      onNotify("error", `Unstage failed: ${err}`);
    }
  };

  const handleStageAll = async () => {
    if (unstaged.length === 0) return;
    try {
      if (ignoreWhitespace) {
        await GitService.StageFiles(
          repo.path,
          unstaged.map((f) => f.path)
        );
      } else {
        await GitService.StageAll(repo.path);
      }
      await onRefresh();
    } catch (err) {
      onNotify("error", `Stage all failed: ${err}`);
    }
  };

  const handleUnstageAll = async () => {
    if (staged.length === 0) return;
    try {
      if (ignoreWhitespace) {
        await GitService.UnstageFiles(
          repo.path,
          staged.map((f) => f.path)
        );
      } else {
        await GitService.UnstageAll(repo.path);
      }
      await onRefresh();
    } catch (err) {
      onNotify("error", `Unstage all failed: ${err}`);
    }
  };

  const mergeState = status?.mergeState ?? "";
  const mergeBranch = status?.mergeBranch ?? "";

  useEffect(() => {
    if (!mergeState) {
      autoFilledMergeKeyRef.current = "";
      return;
    }
    const mergeKey = `${repo.path}::${mergeState}::${mergeBranch}`;
    if (autoFilledMergeKeyRef.current === mergeKey) return;
    autoFilledMergeKeyRef.current = mergeKey;
    if (amend) return;

    GitService.GetMergeCommitMessage(repo.path)
      .then((msg) => {
        if (msg.summary) {
          setSummary((cur) => (cur.trim() ? cur : msg.summary));
        }
        if (msg.description) {
          setDescription((cur) => (cur.trim() ? cur : msg.description));
        }
      })
      .catch(() => {
        // Ignore if MERGE_MSG unavailable
      });
  }, [repo.path, mergeState, mergeBranch, amend]);

  const handleToggleAmend = async (checked: boolean) => {
    setAmend(checked);
    if (checked && !summary.trim()) {
      try {
        const last = await GitService.GetLastCommitMessage(repo.path);
        if (last.summary) setSummary(last.summary);
        if (last.description) setDescription(last.description);
      } catch {
        // Ignore if initial repo
      }
    }
  };

  const hasCommitPayload =
    staged.length > 0 || (mergeState !== "" && conflicted.length === 0);

  const recentCacheKey = `${repo.path}::${status?.headSha ?? ""}`;

  const loadRecentMessages = async (force = false) => {
    if (
      !force &&
      recentLoadedKeyRef.current === recentCacheKey &&
      recentMessages.length > 0
    ) {
      return;
    }
    setRecentLoading(true);
    setRecentError("");
    try {
      const list = await GitService.GetRecentCommitMessages(repo.path, 25);
      setRecentMessages(list ?? []);
      recentLoadedKeyRef.current = recentCacheKey;
    } catch (err) {
      setRecentError(String(err));
    } finally {
      setRecentLoading(false);
    }
  };

  const handleToggleRecentMenu = () => {
    const next = !recentOpen;
    setRecentOpen(next);
    if (next) {
      setRecentFilter("");
      loadRecentMessages(recentLoadedKeyRef.current !== recentCacheKey);
      setTimeout(() => recentSearchRef.current?.focus(), 0);
    }
  };

  useEffect(() => {
    if (!recentOpen && !commitMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        recentOpen &&
        !recentPopoverRef.current?.contains(target) &&
        !recentBtnRef.current?.contains(target)
      ) {
        setRecentOpen(false);
      }
      if (commitMenuOpen && !commitMenuRef.current?.contains(target)) {
        setCommitMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRecentOpen(false);
        setCommitMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [recentOpen, commitMenuOpen]);

  const selectCommitMode = (mode: "commit" | "commit-push") => {
    setCommitMode(mode);
    setCommitMenuOpen(false);
    try {
      window.localStorage.setItem("mygit.commitMode", mode);
    } catch {
      // ignore storage errors
    }
  };

  const filteredRecentMessages = useMemo(() => {
    const q = recentFilter.trim().toLowerCase();
    if (!q) return recentMessages;
    return recentMessages.filter(
      (item) =>
        item.subject.toLowerCase().includes(q) ||
        item.body.toLowerCase().includes(q) ||
        item.shortHash.toLowerCase().includes(q) ||
        item.author.toLowerCase().includes(q)
    );
  }, [recentMessages, recentFilter]);

  const handleSelectRecentMessage = (item: RecentCommitMessage) => {
    setSummary(item.subject);
    setDescription(item.body || "");
    setRecentOpen(false);
    setTimeout(() => summaryInputRef.current?.focus(), 0);
  };

  const handleCommit = async (withPush = false) => {
    if (!summary.trim() || !hasCommitPayload || committing) return;
    if (withPush && (pushBusy || status?.isDetached)) return;
    const wasAmend = amend;
    setCommitAction(withPush ? "commit-push-committing" : "commit");
    try {
      const res = await GitService.Commit(
        repo.path,
        summary,
        description,
        wasAmend
      );
      if (!res.success) {
        if (res.errorCode === "AUTHOR_IDENTITY_UNKNOWN") {
          onNotify("error", "Git author identity is not configured yet. Please set user.name and user.email.");
          onOpenGitConfig("local");
        } else {
          onNotify("error", res.message || "Commit failed");
        }
        return;
      }
      setSummary("");
      setDescription("");
      setAmend(false);
      setRecentOpen(false);
      autoFilledMergeKeyRef.current = "";
      recentLoadedKeyRef.current = "";
      await onRefresh();
      if (withPush) {
        setCommitAction("commit-push-pushing");
        await onPushAfterCommit(wasAmend);
      } else {
        onNotify("success", wasAmend ? "Amended commit" : "Committed changes");
      }
    } catch (err) {
      onNotify("error", String(err));
    } finally {
      setCommitAction(null);
    }
  };

  const handleAbortMerge = async () => {
    setAbortConfirmOpen(false);
    try {
      const res = await GitService.AbortMerge(repo.path);
      if (res.success) {
        onNotify("info", res.message);
        await onRefresh();
      } else {
        onNotify("error", res.message);
      }
    } catch (err) {
      onNotify("error", String(err));
    }
  };

  const summaryTooLong = summary.length > SUMMARY_RECOMMENDED_LIMIT;
  const effectiveCommitMode: "commit" | "commit-push" = status?.isDetached
    ? "commit"
    : commitMode;
  const commitDisabled = committing || !hasCommitPayload || !summary.trim();
  const commitPushDisabled =
    commitDisabled || pushBusy || Boolean(status?.isDetached);
  const activeCommitDisabled =
    effectiveCommitMode === "commit-push" ? commitPushDisabled : commitDisabled;

  const applyRepoConfigKey = async (key: string, value: string) => {
    const res = await GitService.SetRepoConfigKey(repo.path, key, value);
    if (res.success) {
      onNotify("success", `Set ${key} = ${value} and refreshed index`);
      await onRefresh();
    } else {
      onNotify("error", res.message);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#f8fafc]">
      {/* Merge / Conflict Alert Banner */}
      {(conflicted.length > 0 || (status?.mergeState ?? "") !== "") && (
        <div className="px-3 py-2 bg-[#fef2f2] border-b border-[#fecaca] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-[#991b1b]">
            <AlertTriangle className="w-4 h-4 text-[#dc2626] shrink-0" />
            <span>
              <strong>
                {status?.mergeState === "rebase"
                  ? "Rebase"
                  : status?.mergeState === "cherry-pick"
                  ? "Cherry-pick"
                  : "Merge"}{" "}
                in progress:
              </strong>{" "}
              {conflicted.length > 0
                ? `${conflicted.length} conflicted file(s) require resolution.`
                : "所有冲突已解决，已自动生成合并提交信息，可确认后直接提交完成合并。"}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {conflicted.length === 0 && mergeState !== "" && !summary.trim() && (
              <button
                onClick={async () => {
                  const msg = await GitService.GetMergeCommitMessage(repo.path).catch(() => null);
                  if (msg?.summary) setSummary(msg.summary);
                  if (msg?.description) setDescription(msg.description);
                }}
                className="px-2.5 py-1 rounded text-[11px] font-medium bg-white border border-[#bae6fd] text-[#0369a1] hover:bg-[#f0f9ff] transition-colors cursor-pointer"
              >
                填入合并提交信息
              </button>
            )}
            {conflicted.length > 0 && (
              <button
                onClick={onOpenConflictResolver}
                className="px-2.5 py-1 rounded text-[11px] font-medium bg-[#0284c7] text-white hover:bg-[#0369a1] transition-colors cursor-pointer"
              >
                Open Conflict Resolver
              </button>
            )}
            <button
              onClick={() => setAbortConfirmOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-white border border-[#fecaca] text-[#dc2626] hover:bg-[#fee2e2] transition-colors cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5" />
              Abort Merge
            </button>
          </div>
        </div>
      )}

      {/* Subheader bar */}
      <div className="h-9 px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-[#0284c7] shrink-0" />
          <span className="font-semibold text-[#0b1c30]">
            Working Tree Inspector
          </span>
          <span className="text-[#cbd5e1]">/</span>
          <span className="font-mono text-[11px] text-[#64748b] truncate">
            {repo.name} • {unstaged.length + staged.length} file(s) altered (
            {unstaged.length} unstaged, {staged.length} staged)
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center bg-white border border-[#e2e8f0] rounded p-0.5">
            <button
              onClick={() => setDiffMode("unified")}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                diffMode === "unified"
                  ? "bg-[#f0f9ff] text-[#0284c7]"
                  : "text-[#64748b] hover:text-[#0b1c30]"
              }`}
            >
              <AlignJustify className="w-3.5 h-3.5" />
              Unified
            </button>
            <button
              onClick={() => setDiffMode("split")}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                diffMode === "split"
                  ? "bg-[#f0f9ff] text-[#0284c7]"
                  : "text-[#64748b] hover:text-[#0b1c30]"
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              Split
            </button>
          </div>

          <div className="h-4 w-px bg-[#e2e8f0]" />

          <label className="flex items-center gap-1.5 text-[11px] text-[#475569] hover:text-[#0b1c30] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ignoreWhitespace}
              onChange={(e) => onToggleIgnoreWhitespace(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-[#0284c7] cursor-pointer"
            />
            Ignore Whitespace
          </label>
        </div>
      </div>

      {/* Main Split Workbench */}
      <div className="flex-1 flex min-w-0 min-h-0 p-2">
        {/* LEFT COLUMN: Unstaged + Staged + Commit Box */}
        <div
          ref={leftColRef}
          style={{ width: `calc((100% - 8px) * ${leftRatio})` }}
          className="min-w-[240px] shrink-0 flex flex-col bg-white border border-[#e2e8f0] rounded-lg overflow-hidden"
        >
          {/* Unstaged + Staged Resizable Lists */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Unstaged Changes */}
            <div
              ref={unstagedRef}
              style={{ height: `calc((100% - 6px) * ${unstagedRatio})` }}
              className="min-h-[84px] shrink-0 flex flex-col"
            >
            <div className="h-8 px-2.5 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between shrink-0 gap-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-[12px] text-[#0b1c30]">
                  Unstaged Changes
                </span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-semibold bg-[#fef3c7] text-[#b45309]">
                  {unstaged.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {activeSection === "unstaged" && multiPaths.length > 1 && (
                  <>
                    <button
                      title="Discard all selected files"
                      onClick={() => {
                        const set = new Set(multiPaths);
                        onConfirmDiscard(unstaged.filter((f) => set.has(f.path)));
                      }}
                      className="px-1.5 py-0.5 rounded bg-[#fef2f2] border border-[#fecaca] hover:bg-[#fee2e2] text-[#dc2626] text-[10px] font-medium cursor-pointer"
                    >
                      Discard ({multiPaths.length})
                    </button>
                    <button
                      onClick={handleStageSelected}
                      className="px-1.5 py-0.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-[10px] font-medium cursor-pointer"
                    >
                      Stage ({multiPaths.length})
                    </button>
                  </>
                )}
                <button
                  onClick={handleStageAll}
                  disabled={unstaged.length === 0}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-[#e2e8f0] hover:border-[#0284c7] text-[#0284c7] text-[11px] font-medium disabled:opacity-40 cursor-pointer disabled:cursor-default transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Stage All
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1 flex flex-col gap-0.5">
              {unstaged.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-[11px] text-[#94a3b8]">
                  No unstaged changes
                </div>
              ) : (
                unstaged.map((file) => {
                  const isPrimary =
                    selected && !selected.staged && selected.file.path === file.path;
                  const isMulti =
                    activeSection === "unstaged" && multiPaths.includes(file.path);
                  return (
                    <div
                      key={`u:${file.path}`}
                      onClick={(e) => handleRowSelect(e, file, false)}
                      onDoubleClick={(e) => {
                        if (!busyPath) handleStage(e, file);
                      }}
                      title={`${file.path} · Double-click to stage`}
                      className={`group flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors relative select-none ${
                        isMulti
                          ? "bg-[#e0f2fe] text-[#0b1c30]"
                          : "hover:bg-[#f8fafc] text-[#334155]"
                      }`}
                    >
                      {(isPrimary || isMulti) && (
                        <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-[#0284c7] rounded-r" />
                      )}
                      <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
                        <StatusBadge
                          status={file.status}
                          conflicted={file.conflicted}
                        />
                        <span
                          title={file.path}
                          className={`font-mono text-[11px] truncate ${getStatusTextColor(
                            file.status,
                            file.conflicted
                          )}`}
                        >
                          {file.path}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!file.isBinary && (file.additions > 0 || file.deletions > 0) && (
                          <span className="font-mono text-[10px] mr-1">
                            {file.additions > 0 && (
                              <span className="text-[#16a34a] mr-1">
                                +{file.additions}
                              </span>
                            )}
                            {file.deletions > 0 && (
                              <span className="text-[#dc2626]">
                                -{file.deletions}
                              </span>
                            )}
                          </span>
                        )}
                        {file.conflicted && (
                          <button
                            title="Open in External Editor"
                            onClick={(e) => {
                              e.stopPropagation();
                              GitService.OpenInEditor(repo.path, file.path);
                            }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            className="p-0.5 rounded hover:bg-[#e2e8f0] text-[#dc2626] cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          title="Discard changes"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              activeSection === "unstaged" &&
                              multiPaths.length > 1 &&
                              multiPaths.includes(file.path)
                            ) {
                              const set = new Set(multiPaths);
                              onConfirmDiscard(
                                unstaged.filter((f) => set.has(f.path))
                              );
                            } else {
                              onConfirmDiscard([file]);
                            }
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#fee2e2] text-[#dc2626] transition-opacity cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          title="Stage file"
                          disabled={busyPath === file.path}
                          onClick={(e) => handleStage(e, file)}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className="p-0.5 rounded hover:bg-[#dcfce7] text-[#16a34a] cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <SplitHandle
            direction="vertical"
            variant="divider"
            title="Drag to resize Unstaged / Staged · Double-click to reset"
            onDragStart={() => {
              const u = unstagedRef.current?.getBoundingClientRect().height ?? 0;
              const s = stagedRef.current?.getBoundingClientRect().height ?? 0;
              listDragRef.current = { startPx: u, totalPx: Math.max(1, u + s) };
            }}
            onDragMove={(_, dy) => {
              const { startPx, totalPx } = listDragRef.current;
              const minPane = 84;
              const nextPx = clamp(
                startPx + dy,
                minPane,
                Math.max(minPane, totalPx - minPane)
              );
              const nextRatio = clamp(nextPx / totalPx, 0.15, 0.85);
              onChangeRatios({ changesUnstagedRatio: nextRatio }, false);
            }}
            onDragEnd={() => onChangeRatios({}, true)}
            onReset={() =>
              onChangeRatios(
                { changesUnstagedRatio: DEFAULT_LAYOUT.changesUnstagedRatio },
                true
              )
            }
          />

          {/* Staged Changes */}
          <div
            ref={stagedRef}
            className="flex-1 flex flex-col min-h-[84px]"
          >
            <div className="h-8 px-2.5 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between shrink-0 gap-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-[12px] text-[#0b1c30]">
                  Staged Changes
                </span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-semibold bg-[#dcfce7] text-[#15803d]">
                  {staged.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {activeSection === "staged" && multiPaths.length > 1 && (
                  <button
                    onClick={handleUnstageSelected}
                    className="px-1.5 py-0.5 rounded bg-[#475569] hover:bg-[#334155] text-white text-[10px] font-medium cursor-pointer"
                  >
                    Unstage ({multiPaths.length})
                  </button>
                )}
                <button
                  onClick={handleUnstageAll}
                  disabled={staged.length === 0}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-[#e2e8f0] hover:border-[#cbd5e1] text-[#475569] text-[11px] font-medium disabled:opacity-40 cursor-pointer disabled:cursor-default transition-colors"
                >
                  <Minus className="w-3 h-3" />
                  Unstage All
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1 flex flex-col gap-0.5">
              {staged.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-[11px] text-[#94a3b8]">
                  Stage files above to include in commit
                </div>
              ) : (
                staged.map((file) => {
                  const isPrimary =
                    selected && selected.staged && selected.file.path === file.path;
                  const isMulti =
                    activeSection === "staged" && multiPaths.includes(file.path);
                  return (
                    <div
                      key={`s:${file.path}`}
                      onClick={(e) => handleRowSelect(e, file, true)}
                      onDoubleClick={(e) => {
                        if (!busyPath) handleUnstage(e, file);
                      }}
                      title={`${file.origPath ? `${file.origPath} → ${file.path}` : file.path} · Double-click to unstage`}
                      className={`group flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors relative select-none ${
                        isMulti
                          ? "bg-[#e0f2fe] text-[#0b1c30]"
                          : "hover:bg-[#f8fafc] text-[#334155]"
                      }`}
                    >
                      {(isPrimary || isMulti) && (
                        <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-[#0284c7] rounded-r" />
                      )}
                      <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
                        <StatusBadge status={file.status} />
                        <span
                          title={file.path}
                          className={`font-mono text-[11px] truncate ${
                            file.status === "D" ? "line-through text-[#94a3b8]" : ""
                          }`}
                        >
                          {file.origPath ? `${file.origPath} → ${file.path}` : file.path}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!file.isBinary && (file.additions > 0 || file.deletions > 0) && (
                          <span className="font-mono text-[10px] mr-1">
                            {file.additions > 0 && (
                              <span className="text-[#16a34a] mr-1">
                                +{file.additions}
                              </span>
                            )}
                            {file.deletions > 0 && (
                              <span className="text-[#dc2626]">
                                -{file.deletions}
                              </span>
                            )}
                          </span>
                        )}
                        <button
                          title="Unstage file"
                          disabled={busyPath === file.path}
                          onClick={(e) => handleUnstage(e, file)}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className="p-0.5 rounded hover:bg-[#fee2e2] text-[#dc2626] cursor-pointer"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          </div>

          {/* Commit Panel */}
          <div className="p-2.5 bg-[#f8fafc] border-t border-[#e2e8f0] flex flex-col gap-2 shrink-0 relative">
            {recentOpen && (
              <div
                ref={recentPopoverRef}
                className="absolute left-2.5 right-2.5 bottom-full mb-1.5 z-30 bg-white border border-[#cbd5e1] rounded-lg shadow-xl flex flex-col overflow-hidden"
                style={{ maxHeight: "min(280px, 45vh)" }}
              >
                <div className="px-2.5 py-1.5 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0b1c30]">
                    <History className="w-3.5 h-3.5 text-[#0284c7]" />
                    <span>最近 Commit 信息</span>
                    {!recentLoading && recentMessages.length > 0 && (
                      <span className="font-mono text-[10px] font-normal text-[#64748b]">
                        ({filteredRecentMessages.length})
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    title="刷新最近提交"
                    onClick={() => loadRecentMessages(true)}
                    disabled={recentLoading}
                    className="p-0.5 rounded hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0b1c30] disabled:opacity-40 cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${recentLoading ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>

                {recentMessages.length > 4 && (
                  <div className="px-2 py-1.5 border-b border-[#f1f5f9] shrink-0">
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#f8fafc] border border-[#e2e8f0] focus-within:border-[#0284c7]">
                      <Search className="w-3 h-3 text-[#94a3b8] shrink-0" />
                      <input
                        ref={recentSearchRef}
                        type="text"
                        value={recentFilter}
                        onChange={(e) => setRecentFilter(e.target.value)}
                        placeholder="搜索历史提交信息..."
                        className="w-full bg-transparent text-[11px] text-[#0b1c30] placeholder:text-[#94a3b8] outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-1 flex flex-col gap-0.5">
                  {recentLoading && recentMessages.length === 0 ? (
                    <div className="py-6 text-center text-[11px] text-[#64748b]">
                      加载中...
                    </div>
                  ) : recentError ? (
                    <div className="p-2.5 text-[11px] text-[#dc2626] break-words">
                      加载失败: {recentError}
                    </div>
                  ) : filteredRecentMessages.length === 0 ? (
                    <div className="py-6 text-center text-[11px] text-[#94a3b8]">
                      {recentMessages.length === 0
                        ? "暂无历史提交记录"
                        : "未找到匹配的提交信息"}
                    </div>
                  ) : (
                    filteredRecentMessages.map((item) => {
                      const isCurrent =
                        summary === item.subject &&
                        description === (item.body || "");
                      return (
                        <button
                          key={item.hash}
                          type="button"
                          onClick={() => handleSelectRecentMessage(item)}
                          className={`w-full text-left px-2 py-1.5 rounded transition-colors cursor-pointer flex flex-col gap-0.5 ${
                            isCurrent
                              ? "bg-[#e0f2fe] text-[#0b1c30]"
                              : "hover:bg-[#f1f5f9] text-[#0b1c30]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <span className="text-[11px] font-medium leading-snug line-clamp-2 break-words">
                              {item.subject}
                            </span>
                            {isCurrent && (
                              <Check className="w-3 h-3 text-[#0284c7] shrink-0 mt-0.5" />
                            )}
                          </div>
                          {item.body && (
                            <div className="text-[10px] font-mono text-[#64748b] truncate">
                              {item.body}
                            </div>
                          )}
                          <div className="flex items-center gap-1.5 text-[10px] text-[#64748b]">
                            <span className="font-mono px-1 rounded bg-[#f1f5f9] text-[#475569]">
                              {item.shortHash}
                            </span>
                            <span className="truncate">{item.author}</span>
                            <span className="ml-auto shrink-0">
                              {item.relativeTime}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1 flex-wrap min-w-0">
                {PREFIX_CHIPS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      if (!summary.startsWith(`${p}: `)) {
                        setSummary(`${p}: ${summary.replace(/^(feat|fix|refactor|docs|chore):\s*/i, "")}`);
                      }
                    }}
                    className="px-1.5 py-0.5 rounded bg-white border border-[#e2e8f0] hover:border-[#0284c7] text-[10px] font-mono text-[#475569] hover:text-[#0284c7] cursor-pointer transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  ref={recentBtnRef}
                  type="button"
                  onClick={handleToggleRecentMenu}
                  title="选择最近的 Commit 信息"
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium cursor-pointer transition-colors ${
                    recentOpen
                      ? "bg-[#e0f2fe] border-[#0284c7] text-[#0284c7]"
                      : "bg-white border-[#e2e8f0] hover:border-[#0284c7] text-[#475569] hover:text-[#0284c7]"
                  }`}
                >
                  <History className="w-3 h-3" />
                  <span>最近</span>
                  <ChevronDown
                    className={`w-2.5 h-2.5 transition-transform ${
                      recentOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <span
                  className={`font-mono text-[10px] ${
                    summaryTooLong
                      ? "text-[#d97706] font-semibold"
                      : "text-[#94a3b8]"
                  }`}
                >
                  {summary.length}/{SUMMARY_RECOMMENDED_LIMIT}
                </span>
              </div>
            </div>

            <div>
              <input
                ref={summaryInputRef}
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    if (e.shiftKey) {
                      if (!commitPushDisabled) handleCommit(true);
                    } else if (!activeCommitDisabled) {
                      handleCommit(effectiveCommitMode === "commit-push");
                    }
                  }
                }}
                placeholder={`Commit summary (required, <= ${SUMMARY_RECOMMENDED_LIMIT} chars recommended)`}
                className={`w-full px-2.5 py-1.5 rounded bg-white text-[12px] font-medium text-[#0b1c30] placeholder:text-[#94a3b8] outline-none border transition-all ${
                  summaryTooLong
                    ? "border-[#d97706] focus:ring-2 focus:ring-[#d97706]/20"
                    : "border-[#cbd5e1] focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15"
                }`}
              />
              {summaryTooLong && (
                <div className="mt-1 text-[10px] text-[#d97706]">
                  Summary exceeds {SUMMARY_RECOMMENDED_LIMIT} characters ({summary.length} chars). Consider moving details to description.
                </div>
              )}
            </div>

            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (e.shiftKey) {
                    if (!commitPushDisabled) handleCommit(true);
                  } else if (!activeCommitDisabled) {
                    handleCommit(effectiveCommitMode === "commit-push");
                  }
                }
              }}
              placeholder="Extended description (optional)..."
              className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15 text-[11px] font-mono text-[#0b1c30] placeholder:text-[#94a3b8] outline-none resize-none"
            />

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <label className="flex items-center gap-1.5 text-[11px] text-[#475569] cursor-pointer select-none min-w-0">
                <input
                  type="checkbox"
                  checked={amend}
                  onChange={(e) => handleToggleAmend(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-[#0284c7] cursor-pointer shrink-0"
                />
                <span className="truncate">Amend last commit</span>
              </label>

              <div ref={commitMenuRef} className="relative inline-flex items-stretch min-w-0 max-w-[68%]">
                <button
                  type="button"
                  onClick={() => handleCommit(effectiveCommitMode === "commit-push")}
                  disabled={activeCommitDisabled}
                  title={
                    effectiveCommitMode === "commit-push"
                      ? `Commit to ${status?.branch || "HEAD"} & Push (Ctrl+Enter)`
                      : `Commit to ${status?.branch || "HEAD"} (Ctrl+Enter)`
                  }
                  className="min-w-0 flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 rounded-l bg-[#0284c7] hover:bg-[#0369a1] active:bg-[#075985] text-white text-[12px] font-medium disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  {committing ? (
                    <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
                  ) : effectiveCommitMode === "commit-push" ? (
                    <ArrowUp className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <Check className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span className="truncate">
                    {commitAction === "commit" ||
                    commitAction === "commit-push-committing"
                      ? "Committing..."
                      : commitAction === "commit-push-pushing"
                      ? "Pushing..."
                      : effectiveCommitMode === "commit-push"
                      ? amend
                        ? "Amend & Push"
                        : mergeState === "merge"
                        ? "Merge & Push"
                        : "Commit & Push"
                      : amend
                      ? "Amend Commit"
                      : mergeState === "merge"
                      ? "Commit Merge"
                      : `Commit to ${status?.branch || "HEAD"}`}
                  </span>
                </button>

                <button
                  type="button"
                  aria-label="选择提交方式"
                  disabled={committing}
                  onClick={() => setCommitMenuOpen((v) => !v)}
                  title="切换 Commit / Commit & Push"
                  className="flex items-center justify-center px-1.5 py-1.5 rounded-r bg-[#0284c7] hover:bg-[#0369a1] active:bg-[#075985] border-l border-white/25 text-white disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${
                      commitMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {commitMenuOpen && (
                  <div className="absolute right-0 bottom-full mb-1.5 z-30 w-56 bg-white border border-[#cbd5e1] rounded-lg shadow-xl py-1 text-left">
                    <button
                      type="button"
                      onClick={() => selectCommitMode("commit")}
                      className={`w-full px-2.5 py-1.5 flex items-start justify-between gap-2 text-left transition-colors cursor-pointer ${
                        effectiveCommitMode === "commit"
                          ? "bg-[#f0f9ff] text-[#0284c7]"
                          : "hover:bg-[#f8fafc] text-[#0b1c30]"
                      }`}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#0284c7]" />
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium leading-tight">
                            {amend
                              ? "Amend Commit"
                              : mergeState === "merge"
                              ? "Commit Merge"
                              : "Commit"}
                          </div>
                          <div className="text-[10px] text-[#64748b] mt-0.5 truncate">
                            仅提交到本地 ({status?.branch || "HEAD"})
                          </div>
                        </div>
                      </div>
                      {effectiveCommitMode === "commit" && (
                        <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#0284c7]" />
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={Boolean(status?.isDetached)}
                      onClick={() => selectCommitMode("commit-push")}
                      className={`w-full px-2.5 py-1.5 flex items-start justify-between gap-2 text-left transition-colors ${
                        status?.isDetached
                          ? "opacity-45 cursor-not-allowed text-[#64748b]"
                          : effectiveCommitMode === "commit-push"
                          ? "bg-[#f0f9ff] text-[#0284c7] cursor-pointer"
                          : "hover:bg-[#f8fafc] text-[#0b1c30] cursor-pointer"
                      }`}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <ArrowUp className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#0284c7]" />
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium leading-tight">
                            {amend
                              ? "Amend & Push"
                              : mergeState === "merge"
                              ? "Merge & Push"
                              : "Commit & Push"}
                          </div>
                          <div className="text-[10px] text-[#64748b] mt-0.5 truncate">
                            {status?.isDetached
                              ? "Detached HEAD 无法推送"
                              : "提交后自动推送到远程仓库"}
                          </div>
                        </div>
                      </div>
                      {effectiveCommitMode === "commit-push" && (
                        <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#0284c7]" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <SplitHandle
          direction="horizontal"
          variant="gap"
          title="Drag to resize Staging / Diff · Double-click to reset"
          onDragStart={() => {
            const l = leftColRef.current?.getBoundingClientRect().width ?? 0;
            const r = rightColRef.current?.getBoundingClientRect().width ?? 0;
            colDragRef.current = { startPx: l, totalPx: Math.max(1, l + r) };
          }}
          onDragMove={(dx) => {
            const { startPx, totalPx } = colDragRef.current;
            const minLeft = 240;
            const minRight = 280;
            const nextPx = clamp(
              startPx + dx,
              minLeft,
              Math.max(minLeft, totalPx - minRight)
            );
            const nextRatio = clamp(nextPx / totalPx, 0.18, 0.65);
            onChangeRatios({ changesLeftRatio: nextRatio }, false);
          }}
          onDragEnd={() => onChangeRatios({}, true)}
          onReset={() =>
            onChangeRatios(
              { changesLeftRatio: DEFAULT_LAYOUT.changesLeftRatio },
              true
            )
          }
        />

        {/* RIGHT COLUMN: Diff Inspector */}
        <div
          ref={rightColRef}
          className="flex-1 flex flex-col min-w-0 min-h-0 bg-white border border-[#e2e8f0] rounded-lg overflow-hidden"
        >
          {selected ? (
            <>
              <div className="h-9 px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge
                    status={selected.file.status}
                    conflicted={selected.file.conflicted}
                  />
                  <span className="font-mono text-[12px] font-semibold text-[#0b1c30] truncate">
                    {selected.file.path}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#f1f5f9] text-[#475569]">
                    {selected.staged ? "Staged" : "Working Tree"}
                  </span>
                  {diff && !diff.isBinary && (
                    <span className="font-mono text-[11px]">
                      <span className="text-[#16a34a] font-semibold mr-1.5">
                        +{diff.additions}
                      </span>
                      <span className="text-[#dc2626] font-semibold">
                        -{diff.deletions}
                      </span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() =>
                      GitService.OpenInEditor(repo.path, selected.file.path)
                    }
                    className="flex items-center gap-1 px-2 py-1 rounded bg-white border border-[#e2e8f0] hover:border-[#cbd5e1] text-[11px] text-[#334155] cursor-pointer"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open in Editor
                  </button>
                  {!selected.staged && (
                    <button
                      onClick={() => onConfirmDiscard([selected.file])}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-[#fef2f2] border border-[#fecaca] hover:bg-[#fee2e2] text-[11px] text-[#dc2626] cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Discard
                    </button>
                  )}
                  <button
                    onClick={(e) =>
                      selected.staged
                        ? handleUnstage(e, selected.file)
                        : handleStage(e, selected.file)
                    }
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer ${
                      selected.staged
                        ? "bg-white border border-[#e2e8f0] text-[#334155] hover:bg-[#f8fafc]"
                        : "bg-[#0284c7] text-white hover:bg-[#0369a1]"
                    }`}
                  >
                    {selected.staged ? (
                      <>
                        <Minus className="w-3 h-3" /> Unstage File
                      </>
                    ) : (
                      <>
                        <Plus className="w-3 h-3" /> Stage File
                      </>
                    )}
                  </button>
                </div>
              </div>
              <DiffViewer
                diff={diff}
                loading={diffLoading}
                mode={diffMode}
                onDisableFileMode={() => applyRepoConfigKey("core.filemode", "false")}
                onDisableAutoCRLF={() => applyRepoConfigKey("core.autocrlf", "false")}
                onRestoreFile={
                  !selected.staged && selected.file.status !== "?"
                    ? () => onConfirmDiscard([selected.file])
                    : undefined
                }
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[#94a3b8] gap-2">
              <Check className="w-8 h-8 text-[#16a34a] opacity-60" />
              <div className="text-xs font-medium text-[#475569]">
                Working tree is clean
              </div>
              <div className="text-[11px]">
                Modify files in your repository to inspect diffs and stage commits.
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDangerModal
        open={abortConfirmOpen}
        title="Abort In-Progress Merge?"
        description="This will abort the current merge and discard any unresolved conflict edits, restoring the working tree to HEAD."
        confirmLabel="Abort Merge"
        onCancel={() => setAbortConfirmOpen(false)}
        onConfirm={handleAbortMerge}
      />
    </div>
  );
};
