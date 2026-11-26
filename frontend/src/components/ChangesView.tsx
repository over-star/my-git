import React, { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import type {
  FileDiff,
  FileStatus,
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
  onChangeRatios: (
    patch: { changesLeftRatio?: number; changesUnstagedRatio?: number },
    persist: boolean
  ) => void;
  onRefresh: () => Promise<void>;
  onOpenConflictResolver: () => void;
  onOpenGitConfig: (scope?: "local" | "global") => void;
  onNotify: (type: "success" | "error" | "info", msg: string) => void;
  onConfirmDiscard: (files: FileStatus[]) => void;
}

const PREFIX_CHIPS = ["feat", "fix", "refactor", "docs", "chore"];

export const ChangesView: React.FC<ChangesViewProps> = ({
  repo,
  status,
  leftRatio,
  unstagedRatio,
  onChangeRatios,
  onRefresh,
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
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [amend, setAmend] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [abortConfirmOpen, setAbortConfirmOpen] = useState(false);

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
      ignoreWs
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
    ignoreWs,
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
    try {
      await GitService.StageAll(repo.path);
      await onRefresh();
    } catch (err) {
      onNotify("error", `Stage all failed: ${err}`);
    }
  };

  const handleUnstageAll = async () => {
    try {
      await GitService.UnstageAll(repo.path);
      await onRefresh();
    } catch (err) {
      onNotify("error", `Unstage all failed: ${err}`);
    }
  };

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

  const handleCommit = async () => {
    if (!summary.trim() || staged.length === 0) return;
    setCommitting(true);
    try {
      const res = await GitService.Commit(
        repo.path,
        summary,
        description,
        amend
      );
      if (!res.success) {
        if (res.errorCode === "AUTHOR_IDENTITY_UNKNOWN") {
          onNotify("error", "Git author identity is not configured yet. Please set user.name and user.email.");
          onOpenGitConfig("local");
        } else {
          onNotify("error", res.message || "Commit failed");
        }
      } else {
        onNotify("success", amend ? "Amended commit" : "Committed changes");
        setSummary("");
        setDescription("");
        setAmend(false);
        await onRefresh();
      }
    } catch (err) {
      onNotify("error", String(err));
    } finally {
      setCommitting(false);
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

  const summaryTooLong = summary.length > 50;
  const commitDisabled = committing || staged.length === 0 || !summary.trim();

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
                : "All conflicts resolved. Stage files and commit to finish."}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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
              checked={ignoreWs}
              onChange={(e) => setIgnoreWs(e.target.checked)}
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
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#fee2e2] text-[#dc2626] transition-opacity cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          title="Stage file"
                          disabled={busyPath === file.path}
                          onClick={(e) => handleStage(e, file)}
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
          <div className="p-2.5 bg-[#f8fafc] border-t border-[#e2e8f0] flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
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
              <span
                className={`font-mono text-[10px] ${
                  summaryTooLong
                    ? "text-[#d97706] font-semibold"
                    : "text-[#94a3b8]"
                }`}
              >
                {summary.length}/50
              </span>
            </div>

            <div>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                onKeyDown={(e) => {
                  if (e.ctrlKey && e.key === "Enter" && !commitDisabled) {
                    handleCommit();
                  }
                }}
                placeholder="Commit summary (required, <= 50 chars recommended)"
                className={`w-full px-2.5 py-1.5 rounded bg-white text-[12px] font-medium text-[#0b1c30] placeholder:text-[#94a3b8] outline-none border transition-all ${
                  summaryTooLong
                    ? "border-[#d97706] focus:ring-2 focus:ring-[#d97706]/20"
                    : "border-[#cbd5e1] focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15"
                }`}
              />
              {summaryTooLong && (
                <div className="mt-1 text-[10px] text-[#d97706]">
                  Summary exceeds 50 characters ({summary.length} chars). Consider moving details to description.
                </div>
              )}
            </div>

            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === "Enter" && !commitDisabled) {
                  handleCommit();
                }
              }}
              placeholder="Extended description (optional)..."
              className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/15 text-[11px] font-mono text-[#0b1c30] placeholder:text-[#94a3b8] outline-none resize-none"
            />

            <div className="flex items-center justify-between pt-0.5">
              <label className="flex items-center gap-1.5 text-[11px] text-[#475569] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={amend}
                  onChange={(e) => handleToggleAmend(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-[#0284c7] cursor-pointer"
                />
                Amend last commit
              </label>

              <button
                onClick={handleCommit}
                disabled={commitDisabled}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] active:bg-[#075985] text-white text-[12px] font-medium disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                {committing
                  ? "Committing..."
                  : amend
                  ? "Amend Commit"
                  : `Commit to ${status?.branch || "HEAD"}`}
              </button>
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
