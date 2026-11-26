import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  CheckCircle2,
  Code2,
  Columns2,
  Edit3,
  ExternalLink,
  FoldVertical,
  GitMerge,
  RefreshCw,
  RotateCcw,
  UnfoldVertical,
  XCircle,
} from "lucide-react";
import type {
  RepoLocation,
  RepoStatus,
} from "../../bindings/gitpulse/internal/git/models";
import { GitService } from "../../bindings/gitpulse";
import { ConfirmDangerModal } from "./Dialogs";
import {
  buildMergedText,
  type ConflictChoice,
  type ConflictDocumentSegment,
  type ConflictSegment,
  getSegmentResolvedLines,
  hasConflictMarkers,
  isSideSelected,
  type NormalSegment,
  parseConflictDocument,
  toggleConflictSide,
} from "../utils/conflictParser";

interface ConflictViewProps {
  repo: RepoLocation;
  status: RepoStatus | null;
  onRefresh: () => Promise<void>;
  onNotify: (type: "success" | "error" | "info", msg: string) => void;
  onGoToChanges: () => void;
}

interface FileDraftState {
  rawOriginal: string;
  segments: ConflictDocumentSegment[];
  rawMode: boolean;
  rawDraft: string;
}

function splitFilePath(fullPath: string): { name: string; dir: string } {
  const idx = fullPath.lastIndexOf("/");
  if (idx < 0) return { name: fullPath, dir: "" };
  return { name: fullPath.slice(idx + 1), dir: fullPath.slice(0, idx) };
}

function getChoiceBadge(seg: ConflictSegment): {
  label: string;
  className: string;
} {
  switch (seg.choice) {
    case "ours":
      return {
        label: "已选: Ours",
        className: "bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd]",
      };
    case "theirs":
      return {
        label: "已选: Theirs",
        className: "bg-[#ede9fe] text-[#6d28d9] border-[#ddd6fe]",
      };
    case "both_ours_first":
      return {
        label: "已选: Ours → Theirs",
        className: "bg-[#ccfbf1] text-[#0f766e] border-[#99f6e4]",
      };
    case "both_theirs_first":
      return {
        label: "已选: Theirs → Ours",
        className: "bg-[#ccfbf1] text-[#0f766e] border-[#99f6e4]",
      };
    case "neither":
      return {
        label: "已选: 均不保留",
        className: "bg-[#f1f5f9] text-[#475569] border-[#cbd5e1]",
      };
    case "custom":
      return {
        label: "已手改",
        className: "bg-[#fef3c7] text-[#b45309] border-[#fde68a]",
      };
    case "unresolved":
    default:
      return {
        label: "待解决",
        className: "bg-[#fef2f2] text-[#dc2626] border-[#fecaca]",
      };
  }
}

interface FoldedSliceResult {
  top: { line: string; lineNo: number }[];
  foldedCount: number;
  bottom: { line: string; lineNo: number }[];
}

function computeFoldedSlice(
  lines: string[],
  startLine: number,
  isFirst: boolean,
  isLast: boolean,
  expanded: boolean
): FoldedSliceResult {
  const mapped = lines.map((line, i) => ({ line, lineNo: startLine + i }));
  if (expanded || lines.length <= 10) {
    return { top: mapped, foldedCount: 0, bottom: [] };
  }
  if (isFirst && !isLast) {
    const keepBottom = mapped.slice(-4);
    return {
      top: [],
      foldedCount: lines.length - keepBottom.length,
      bottom: keepBottom,
    };
  }
  if (!isFirst && isLast) {
    const keepTop = mapped.slice(0, 4);
    return {
      top: keepTop,
      foldedCount: lines.length - keepTop.length,
      bottom: [],
    };
  }
  return {
    top: mapped.slice(0, 3),
    foldedCount: lines.length - 6,
    bottom: mapped.slice(-3),
  };
}

const NormalCodeRows: React.FC<{
  segment: NormalSegment;
  startLine: number;
  isFirst: boolean;
  isLast: boolean;
  expanded: boolean;
  onExpand: () => void;
  twoColumns?: boolean;
}> = ({
  segment,
  startLine,
  isFirst,
  isLast,
  expanded,
  onExpand,
  twoColumns = false,
}) => {
  const slice = computeFoldedSlice(
    segment.lines,
    startLine,
    isFirst,
    isLast,
    expanded
  );

  const renderLines = (items: { line: string; lineNo: number }[]) =>
    items.map(({ line, lineNo }) =>
      twoColumns ? (
        <div
          key={lineNo}
          className="grid grid-cols-2 divide-x divide-[#e2e8f0] font-mono text-[11.5px] leading-[19px] hover:bg-[#f8fafc]"
        >
          <div className="flex min-w-0">
            <span className="w-11 shrink-0 select-none text-right pr-2.5 text-[#94a3b8] bg-[#f8fafc]/70 border-r border-[#f1f5f9]">
              {lineNo}
            </span>
            <pre className="px-2.5 whitespace-pre overflow-hidden text-ellipsis text-[#334155]">
              {line || " "}
            </pre>
          </div>
          <div className="flex min-w-0">
            <span className="w-11 shrink-0 select-none text-right pr-2.5 text-[#94a3b8] bg-[#f8fafc]/70 border-r border-[#f1f5f9]">
              {lineNo}
            </span>
            <pre className="px-2.5 whitespace-pre overflow-hidden text-ellipsis text-[#334155]">
              {line || " "}
            </pre>
          </div>
        </div>
      ) : (
        <div
          key={lineNo}
          className="flex font-mono text-[11.5px] leading-[19px] hover:bg-[#f8fafc]"
        >
          <span className="w-11 shrink-0 select-none text-right pr-2.5 text-[#94a3b8] bg-[#f8fafc]/70 border-r border-[#f1f5f9]">
            {lineNo}
          </span>
          <pre className="px-3 whitespace-pre-wrap break-all text-[#334155] flex-1">
            {line || " "}
          </pre>
        </div>
      )
    );

  return (
    <div>
      {renderLines(slice.top)}
      {slice.foldedCount > 0 && (
        <button
          type="button"
          onClick={onExpand}
          className="w-full py-1 px-3 bg-[#f8fafc] hover:bg-[#f1f5f9] border-y border-[#e2e8f0] text-[11px] text-[#64748b] hover:text-[#0284c7] flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
        >
          <UnfoldVertical className="w-3.5 h-3.5" />
          <span>展开 {slice.foldedCount} 行未冲突代码</span>
        </button>
      )}
      {renderLines(slice.bottom)}
    </div>
  );
};

export const ConflictView: React.FC<ConflictViewProps> = ({
  repo,
  status,
  onRefresh,
  onNotify,
  onGoToChanges,
}) => {
  const conflicted = status?.conflicted ?? [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FileDraftState>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [abortConfirmOpen, setAbortConfirmOpen] = useState(false);
  const [mergeSummary, setMergeSummary] = useState("");
  const [mergeDescription, setMergeDescription] = useState("");
  const [committingMerge, setCommittingMerge] = useState(false);

  const [activeConflictIdx, setActiveConflictIdx] = useState<number>(0);
  const [showFullContext, setShowFullContext] = useState(false);
  const [expandedNormalIds, setExpandedNormalIds] = useState<
    Record<string, boolean>
  >({});
  const [expandedBaseIds, setExpandedBaseIds] = useState<
    Record<string, boolean>
  >({});
  const [topPanePercent, setTopPanePercent] = useState<number>(56);

  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const compareBlockRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const resultBlockRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const draftKey = selectedPath ? `${repo.path}::${selectedPath}` : "";
  const currentDraft = draftKey ? drafts[draftKey] : undefined;

  useEffect(() => {
    if (conflicted.length > 0) {
      if (!selectedPath || !conflicted.some((f) => f.path === selectedPath)) {
        setSelectedPath(conflicted[0].path);
      }
    } else {
      setSelectedPath(null);
    }
  }, [conflicted, repo.path, selectedPath]);

  useEffect(() => {
    const mState = status?.mergeState ?? "";
    if (conflicted.length !== 0 || !mState) {
      return;
    }
    let cancelled = false;
    GitService.GetMergeCommitMessage(repo.path)
      .then((msg) => {
        if (cancelled) return;
        if (msg.summary) {
          setMergeSummary((cur) => (cur.trim() ? cur : msg.summary));
        }
        if (msg.description) {
          setMergeDescription((cur) => (cur.trim() ? cur : msg.description));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repo.path, conflicted.length, status?.mergeState]);

  const loadFileFromDisk = async (
    filePath: string,
    forceReset = false
  ) => {
    const key = `${repo.path}::${filePath}`;
    if (!forceReset && drafts[key]) return;
    setLoading(true);
    try {
      const res = await GitService.GetConflictFile(repo.path, filePath);
      const raw = (res.rawContent ?? "").replace(/\r\n/g, "\n");
      const segments = parseConflictDocument(raw);
      setDrafts((prev) => ({
        ...prev,
        [key]: {
          rawOriginal: raw,
          segments,
          rawMode: false,
          rawDraft: raw,
        },
      }));
      setActiveConflictIdx(0);
    } catch (err) {
      onNotify("error", `读取冲突文件失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedPath) return;
    loadFileFromDisk(selectedPath, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path, selectedPath]);

  const updateCurrentDraft = (
    updater: (prev: FileDraftState) => FileDraftState
  ) => {
    if (!draftKey) return;
    setDrafts((prev) => {
      const cur = prev[draftKey];
      if (!cur) return prev;
      return { ...prev, [draftKey]: updater(cur) };
    });
  };

  const conflictSegments = useMemo(
    () =>
      (currentDraft?.segments ?? []).filter(
        (s): s is ConflictSegment => s.kind === "conflict"
      ),
    [currentDraft]
  );

  const resolvedCount = useMemo(
    () => conflictSegments.filter((c) => c.choice !== "unresolved").length,
    [conflictSegments]
  );
  const unresolvedList = useMemo(
    () => conflictSegments.filter((c) => c.choice === "unresolved"),
    [conflictSegments]
  );

  const mergedText = useMemo(() => {
    if (!currentDraft) return "";
    if (currentDraft.rawMode) return currentDraft.rawDraft;
    return buildMergedText(currentDraft.segments);
  }, [currentDraft]);

  const remainingMarkers = useMemo(
    () => hasConflictMarkers(mergedText),
    [mergedText]
  );

  const readyToResolve = useMemo(() => {
    if (!currentDraft) return false;
    if (currentDraft.rawMode) return !remainingMarkers;
    return unresolvedList.length === 0 && !remainingMarkers;
  }, [currentDraft, remainingMarkers, unresolvedList.length]);

  const resultSegmentStartLines = useMemo(() => {
    if (!currentDraft) return [];
    let lineCursor = 1;
    return currentDraft.segments.map((seg) => {
      const start = lineCursor;
      const lines = getSegmentResolvedLines(seg);
      lineCursor += lines.length;
      return start;
    });
  }, [currentDraft]);

  const primaryLabels = useMemo(() => {
    const first = conflictSegments[0];
    return {
      ours: first?.oursLabel || "HEAD",
      theirs: first?.theirsLabel || "Incoming",
    };
  }, [conflictSegments]);

  const jumpToConflict = (idx: number) => {
    setActiveConflictIdx(idx);
    compareBlockRefs.current[idx]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    resultBlockRefs.current[idx]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  const stepConflict = (delta: -1 | 1) => {
    if (conflictSegments.length === 0) return;
    const next =
      (activeConflictIdx + delta + conflictSegments.length) %
      conflictSegments.length;
    jumpToConflict(next);
  };

  const setSegmentChoice = (conflictId: string, choice: ConflictChoice) => {
    updateCurrentDraft((d) => ({
      ...d,
      segments: d.segments.map((s) => {
        if (s.kind !== "conflict" || s.id !== conflictId) return s;
        if (choice === "custom" && s.choice !== "custom") {
          return {
            ...s,
            choice,
            customLines:
              s.choice === "unresolved"
                ? [...s.oursLines]
                : getSegmentResolvedLines(s),
          };
        }
        return { ...s, choice };
      }),
    }));
  };

  const toggleSideForSegment = (
    conflictId: string,
    side: "ours" | "theirs"
  ) => {
    updateCurrentDraft((d) => ({
      ...d,
      segments: d.segments.map((s) => {
        if (s.kind !== "conflict" || s.id !== conflictId) return s;
        return { ...s, choice: toggleConflictSide(s.choice, side) };
      }),
    }));
  };

  const swapBothOrderForSegment = (conflictId: string) => {
    updateCurrentDraft((d) => ({
      ...d,
      segments: d.segments.map((s) => {
        if (s.kind !== "conflict" || s.id !== conflictId) return s;
        if (s.choice === "both_ours_first") {
          return { ...s, choice: "both_theirs_first" };
        }
        if (s.choice === "both_theirs_first") {
          return { ...s, choice: "both_ours_first" };
        }
        return s;
      }),
    }));
  };

  const updateCustomLinesForSegment = (conflictId: string, text: string) => {
    const normalized = text.replace(/\r\n/g, "\n");
    const lines = normalized === "" ? [] : normalized.split("\n");
    updateCurrentDraft((d) => ({
      ...d,
      segments: d.segments.map((s) =>
        s.kind === "conflict" && s.id === conflictId
          ? { ...s, choice: "custom", customLines: lines }
          : s
      ),
    }));
  };

  const applyAllChoice = (choice: ConflictChoice) => {
    updateCurrentDraft((d) => ({
      ...d,
      rawMode: false,
      segments: d.segments.map((s) =>
        s.kind === "conflict" ? { ...s, choice } : s
      ),
    }));
  };

  const toggleRawMode = () => {
    if (!currentDraft) return;
    if (!currentDraft.rawMode) {
      const built = buildMergedText(currentDraft.segments);
      updateCurrentDraft((d) => ({
        ...d,
        rawMode: true,
        rawDraft: built,
      }));
    } else {
      if (hasConflictMarkers(currentDraft.rawDraft)) {
        const reparsed = parseConflictDocument(currentDraft.rawDraft);
        updateCurrentDraft((d) => ({
          ...d,
          rawMode: false,
          segments: reparsed,
        }));
      } else {
        updateCurrentDraft((d) => ({ ...d, rawMode: false }));
      }
    }
  };

  const handleMarkResolved = async () => {
    if (!selectedPath || !currentDraft) return;
    if (!readyToResolve) {
      onNotify(
        "error",
        "仍有未解决的冲突或残留的冲突标记 (<<<<<<< / ======= / >>>>>>>)。"
      );
      return;
    }
    setSaving(true);
    try {
      await GitService.SaveResolvedConflict(
        repo.path,
        selectedPath,
        mergedText,
        true
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      onNotify("success", `已保存并暂存解决后的文件：${selectedPath}`);
      await onRefresh();
    } catch (err) {
      onNotify("error", `保存冲突解决失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResolveSpecialSide = async (side: "ours" | "theirs") => {
    if (!selectedPath) return;
    setSaving(true);
    try {
      const res = await GitService.ResolveConflictSide(
        repo.path,
        selectedPath,
        side
      );
      if (!res.success) {
        onNotify("error", res.message || `采用 ${side} 失败`);
        return;
      }
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      onNotify("success", res.message || `已采用 ${side} 版本并暂存`);
      await onRefresh();
    } catch (err) {
      onNotify("error", String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAbortMerge = async () => {
    setAbortConfirmOpen(false);
    try {
      const res = await GitService.AbortMerge(repo.path);
      if (res.success) {
        setDrafts({});
        onNotify("info", res.message);
        await onRefresh();
        onGoToChanges();
      } else {
        onNotify("error", res.message);
      }
    } catch (err) {
      onNotify("error", String(err));
    }
  };

  const startSplitResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      if (rect.height <= 0) return;
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setTopPanePercent(Math.max(24, Math.min(78, pct)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (conflicted.length === 0) {
    const mergeInProgress = (status?.mergeState ?? "") !== "";
    const handleCommitMerge = async () => {
      if (!mergeSummary.trim() || committingMerge) return;
      setCommittingMerge(true);
      try {
        const res = await GitService.Commit(
          repo.path,
          mergeSummary.trim(),
          mergeDescription.trim(),
          false
        );
        if (!res.success) {
          onNotify("error", res.message || "提交合并失败");
          return;
        }
        setMergeSummary("");
        setMergeDescription("");
        onNotify("success", "已完成合并提交");
        await onRefresh();
        onGoToChanges();
      } catch (err) {
        onNotify("error", String(err));
      } finally {
        setCommittingMerge(false);
      }
    };

    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#f8fafc] gap-3 p-6">
        <CheckCircle2 className="w-10 h-10 text-[#16a34a] opacity-80" />
        <div className="text-sm font-semibold text-[#0b1c30]">
          当前没有合并冲突
        </div>
        <div className="text-xs text-[#64748b] max-w-md text-center">
          {mergeInProgress
            ? "所有冲突文件已解决并暂存，已自动为你生成合并提交信息，可确认后直接提交或前往工作区检查。"
            : "工作区没有未解决的冲突文件。执行 Pull / Merge / Rebase 产生冲突时会在此显示。"}
        </div>
        {mergeInProgress && (
          <div className="w-full max-w-lg mt-1 bg-white border border-[#e2e8f0] rounded-xl shadow-xs p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#0b1c30]">
                自动生成的合并提交信息
              </span>
              <span className="px-1.5 py-0.5 rounded bg-[#f0fdf4] border border-[#bbf7d0] text-[#15803d] text-[10px] font-mono uppercase">
                {status?.mergeState}
              </span>
            </div>
            <input
              type="text"
              value={mergeSummary}
              onChange={(e) => setMergeSummary(e.target.value)}
              placeholder="Merge commit summary..."
              className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-xs font-medium text-[#0b1c30] outline-none"
            />
            <textarea
              rows={2}
              value={mergeDescription}
              onChange={(e) => setMergeDescription(e.target.value)}
              placeholder="补充说明（可选）..."
              className="w-full px-2.5 py-1.5 rounded bg-white border border-[#cbd5e1] focus:border-[#0284c7] text-[11px] font-mono text-[#0b1c30] outline-none resize-none"
            />
            <div className="flex items-center justify-end gap-2 pt-0.5">
              <button
                onClick={() => setAbortConfirmOpen(true)}
                className="px-3 py-1.5 rounded-md bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] text-xs font-medium hover:bg-[#fee2e2] cursor-pointer"
              >
                中止合并
              </button>
              <button
                onClick={onGoToChanges}
                className="px-3 py-1.5 rounded-md bg-white border border-[#cbd5e1] text-[#334155] text-xs font-medium hover:bg-[#f8fafc] cursor-pointer"
              >
                前往工作区面板
              </button>
              <button
                disabled={!mergeSummary.trim() || committingMerge}
                onClick={handleCommitMerge}
                className="px-3.5 py-1.5 rounded-md bg-[#16a34a] hover:bg-[#15803d] disabled:opacity-45 text-white text-xs font-medium cursor-pointer flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                {committingMerge ? "正在提交..." : "完成合并提交"}
              </button>
            </div>
          </div>
        )}
        <ConfirmDangerModal
          open={abortConfirmOpen}
          title="确认中止当前合并？"
          description="这将中止正在进行的合并并放弃所有未提交的冲突解决改动，恢复工作区到 HEAD。"
          confirmLabel="中止合并"
          onCancel={() => setAbortConfirmOpen(false)}
          onConfirm={handleAbortMerge}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#f8fafc] p-2 gap-2">
      {/* Top Conflict Banner */}
      <div className="px-3 py-2 bg-white border border-[#fecaca] rounded-lg flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-md bg-[#fef2f2] text-[#dc2626] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#0b1c30] flex items-center gap-2 flex-wrap">
              <span>合并冲突解决器</span>
              <span className="px-1.5 py-0.5 rounded bg-[#dc2626] text-white text-[10px] font-mono font-bold">
                剩余 {conflicted.length} 个文件
              </span>
              {status?.mergeState && (
                <span className="px-1.5 py-0.5 rounded bg-[#fef3c7] text-[#b45309] text-[10px] font-mono font-semibold uppercase">
                  {status.mergeState}
                </span>
              )}
            </div>
            <div className="text-[11px] text-[#64748b] truncate">
              在下方左右对比视图勾选每一处冲突点（支持 Ours / Theirs / 双向合并 / 单块手改），确认实时结果后暂存。
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {selectedPath && (
            <>
              <button
                onClick={() => loadFileFromDisk(selectedPath, true)}
                title="从磁盘重新读取当前冲突文件"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] text-xs font-medium text-[#334155] cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重载文件
              </button>
              <button
                onClick={() => GitService.OpenInEditor(repo.path, selectedPath)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-white border border-[#e2e8f0] hover:border-[#cbd5e1] text-xs font-medium text-[#334155] cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                外部编辑器
              </button>
            </>
          )}
          <button
            onClick={() => setAbortConfirmOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#fef2f2] border border-[#fecaca] hover:bg-[#fee2e2] text-xs font-medium text-[#dc2626] cursor-pointer"
          >
            <XCircle className="w-3.5 h-3.5" />
            中止合并
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0 gap-2">
        {/* Conflicted Files Sidebar */}
        <div className="w-60 shrink-0 bg-white border border-[#e2e8f0] rounded-lg flex flex-col overflow-hidden">
          <div className="h-8 px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between text-[11px] font-semibold text-[#0b1c30]">
            <span className="flex items-center gap-1.5">
              <GitMerge className="w-3.5 h-3.5 text-[#dc2626]" />
              冲突文件列表
            </span>
            <span className="font-mono text-[10px] text-[#dc2626]">
              {conflicted.length} 个
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1">
            {conflicted.map((f) => {
              const active = f.path === selectedPath;
              const { name, dir } = splitFilePath(f.path);
              const fileDraft = drafts[`${repo.path}::${f.path}`];
              const fileBlocks = (fileDraft?.segments ?? []).filter(
                (s): s is ConflictSegment => s.kind === "conflict"
              );
              const fileResolved = fileBlocks.filter(
                (s) => s.choice !== "unresolved"
              ).length;
              return (
                <button
                  key={f.path}
                  onClick={() => setSelectedPath(f.path)}
                  title={f.path}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                    active
                      ? "bg-[#f0f9ff] text-[#0b1c30] border border-[#bae6fd]"
                      : "hover:bg-[#f8fafc] text-[#334155] border border-transparent"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11.5px] font-medium truncate">
                      {name}
                    </div>
                    {dir && (
                      <div className="font-mono text-[10px] text-[#64748b] truncate">
                        {dir}
                      </div>
                    )}
                  </div>
                  {fileBlocks.length > 0 ? (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 ${
                        fileResolved === fileBlocks.length
                          ? "bg-[#dcfce7] text-[#15803d]"
                          : "bg-[#fef2f2] text-[#dc2626]"
                      }`}
                    >
                      {fileResolved}/{fileBlocks.length}
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-[#fef2f2] text-[#dc2626] text-[10px] font-bold shrink-0">
                      U
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Resolver Workspace */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 gap-2">
          {loading || !currentDraft ? (
            <div className="flex-1 bg-white border border-[#e2e8f0] rounded-lg flex items-center justify-center text-xs text-[#64748b]">
              正在加载冲突文件...
            </div>
          ) : (
            <>
              {/* Workspace Toolbar */}
              <div className="px-3 py-1.5 bg-white border border-[#e2e8f0] rounded-lg flex items-center justify-between gap-2 flex-wrap shrink-0">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-mono text-xs font-semibold text-[#0b1c30] truncate max-w-[260px]">
                    {selectedPath}
                  </span>

                  {conflictSegments.length > 0 && !currentDraft.rawMode && (
                    <>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          unresolvedList.length === 0
                            ? "bg-[#f0fdf4] border-[#bbf7d0] text-[#15803d]"
                            : "bg-[#fef2f2] border-[#fecaca] text-[#dc2626]"
                        }`}
                      >
                        已解决 {resolvedCount} / {conflictSegments.length} 处冲突
                      </span>

                      {/* Conflict Jump Navigation */}
                      <div className="flex items-center gap-1 pl-1 border-l border-[#e2e8f0]">
                        <button
                          type="button"
                          onClick={() => stepConflict(-1)}
                          title="上一处冲突"
                          className="p-1 rounded hover:bg-[#f1f5f9] text-[#475569] cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <div className="flex items-center gap-1 flex-wrap max-w-[260px]">
                          {conflictSegments.map((c) => {
                            const isResolved = c.choice !== "unresolved";
                            const isFocused =
                              activeConflictIdx === c.conflictIndex;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => jumpToConflict(c.conflictIndex)}
                                title={`跳转到冲突 #${c.conflictIndex + 1} (第 ${c.startLine}–${c.endLine} 行)`}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold cursor-pointer border transition-colors ${
                                  isFocused
                                    ? "ring-2 ring-[#0284c7]/40 "
                                    : ""
                                }${
                                  isResolved
                                    ? "bg-[#dcfce7] border-[#86efac] text-[#15803d]"
                                    : "bg-[#fef2f2] border-[#fecaca] text-[#dc2626]"
                                }`}
                              >
                                #{c.conflictIndex + 1}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          onClick={() => stepConflict(1)}
                          title="下一处冲突"
                          className="p-1 rounded hover:bg-[#f1f5f9] text-[#475569] cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {conflictSegments.length > 0 && !currentDraft.rawMode && (
                    <>
                      <button
                        type="button"
                        onClick={() => applyAllChoice("ours")}
                        title={`所有冲突点均采用 Ours (${primaryLabels.ours})`}
                        className="px-2 py-1 rounded bg-[#e0f2fe] hover:bg-[#bae6fd] text-[#0369a1] text-[11px] font-medium cursor-pointer"
                      >
                        全部 Ours
                      </button>
                      <button
                        type="button"
                        onClick={() => applyAllChoice("theirs")}
                        title={`所有冲突点均采用 Theirs (${primaryLabels.theirs})`}
                        className="px-2 py-1 rounded bg-[#ede9fe] hover:bg-[#ddd6fe] text-[#6d28d9] text-[11px] font-medium cursor-pointer"
                      >
                        全部 Theirs
                      </button>
                      <button
                        type="button"
                        onClick={() => applyAllChoice("unresolved")}
                        title="重置所有冲突选择"
                        className="px-2 py-1 rounded bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] text-[#475569] text-[11px] font-medium cursor-pointer flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        重置
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowFullContext((v) => !v)}
                        title={
                          showFullContext
                            ? "折叠长未冲突代码段"
                            : "展开全部未冲突代码"
                        }
                        className="px-2 py-1 rounded bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] text-[#475569] text-[11px] font-medium cursor-pointer flex items-center gap-1"
                      >
                        {showFullContext ? (
                          <FoldVertical className="w-3 h-3" />
                        ) : (
                          <UnfoldVertical className="w-3 h-3" />
                        )}
                        {showFullContext ? "折叠上下文" : "展开全部"}
                      </button>
                    </>
                  )}

                  {conflictSegments.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleRawMode}
                      className={`px-2 py-1 rounded border text-[11px] font-medium cursor-pointer flex items-center gap-1 ${
                        currentDraft.rawMode
                          ? "bg-[#0284c7] border-[#0284c7] text-white"
                          : "bg-white border-[#e2e8f0] hover:bg-[#f8fafc] text-[#334155]"
                      }`}
                    >
                      {currentDraft.rawMode ? (
                        <>
                          <Columns2 className="w-3 h-3" />
                          返回可视化合并
                        </>
                      ) : (
                        <>
                          <Code2 className="w-3 h-3" />
                          源码编辑
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Special Case: No text conflict markers found (delete/modify, binary, or externally cleaned) */}
              {conflictSegments.length === 0 ? (
                <div className="flex-1 flex flex-col min-h-0 bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
                  <div className="p-4 bg-[#fffbeb] border-b border-[#fde68a] flex items-center justify-between gap-4 flex-wrap">
                    <div className="text-xs text-[#92400e]">
                      <div className="font-semibold mb-0.5">
                        未检测到文本冲突标记 (&lt;&lt;&lt;&lt;&lt;&lt;&lt; / ======= / &gt;&gt;&gt;&gt;&gt;&gt;&gt;)
                      </div>
                      <div className="text-[11px]">
                        该文件可能是「一方修改、另一方删除」的树冲突、二进制文件，或已在外部处理完冲突标记。你可以直接选择保留哪一侧版本并标记解决：
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleResolveSpecialSide("ours")}
                        className="px-3 py-1.5 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-xs font-medium cursor-pointer disabled:opacity-45"
                      >
                        采用 Ours 版本
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleResolveSpecialSide("theirs")}
                        className="px-3 py-1.5 rounded bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-xs font-medium cursor-pointer disabled:opacity-45"
                      >
                        采用 Theirs 版本
                      </button>
                      <button
                        type="button"
                        disabled={saving || remainingMarkers}
                        onClick={handleMarkResolved}
                        className="px-3 py-1.5 rounded bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-medium cursor-pointer disabled:opacity-45 flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        保留当前内容并暂存
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={currentDraft.rawDraft}
                    onChange={(e) =>
                      updateCurrentDraft((d) => ({
                        ...d,
                        rawMode: true,
                        rawDraft: e.target.value,
                      }))
                    }
                    spellCheck={false}
                    className="flex-1 w-full p-3 font-mono text-[12px] leading-[19px] text-[#0b1c30] outline-none resize-none bg-white"
                  />
                </div>
              ) : currentDraft.rawMode ? (
                /* Raw Text Editor Mode */
                <div className="flex-1 flex flex-col min-h-0 bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
                  <div className="h-9 px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[#0b1c30]">
                        源码手动编辑模式
                      </span>
                      {remainingMarkers ? (
                        <span className="px-1.5 py-0.5 rounded bg-[#fef2f2] text-[#dc2626] text-[10px] font-mono font-semibold">
                          存在未清理的冲突标记
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-[#dcfce7] text-[#15803d] text-[10px] font-mono font-semibold">
                          无残留标记 · 可暂存
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleMarkResolved}
                      disabled={saving || !readyToResolve}
                      className="flex items-center gap-1 px-3 py-1 rounded bg-[#16a34a] hover:bg-[#15803d] text-white text-[11px] font-medium disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {saving ? "保存中..." : "完成并暂存文件"}
                    </button>
                  </div>
                  <textarea
                    value={currentDraft.rawDraft}
                    onChange={(e) =>
                      updateCurrentDraft((d) => ({
                        ...d,
                        rawDraft: e.target.value,
                      }))
                    }
                    spellCheck={false}
                    className="flex-1 w-full p-3 font-mono text-[12px] leading-[19px] text-[#0b1c30] outline-none resize-none bg-white"
                  />
                </div>
              ) : (
                /* Fork-Style Side-by-Side Comparison + Live Result Preview */
                <div
                  ref={splitContainerRef}
                  className="flex-1 flex flex-col min-h-0 gap-1"
                >
                  {/* Top Pane: Side-by-Side Ours vs Theirs Comparison */}
                  <div
                    style={{ height: `${topPanePercent}%` }}
                    className="min-h-[150px] bg-white border border-[#e2e8f0] rounded-lg flex flex-col overflow-hidden"
                  >
                    {/* Sticky 2-Column Header */}
                    <div className="grid grid-cols-2 divide-x divide-[#e2e8f0] bg-[#f8fafc] border-b border-[#e2e8f0] shrink-0">
                      <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#0284c7] shrink-0" />
                          <span className="text-[11px] font-semibold text-[#0369a1] truncate">
                            OURS · 当前分支 ({primaryLabels.ours})
                          </span>
                        </div>
                        <span className="text-[10px] text-[#64748b] shrink-0">
                          点击冲突块左侧勾选
                        </span>
                      </div>
                      <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#7c3aed] shrink-0" />
                          <span className="text-[11px] font-semibold text-[#6d28d9] truncate">
                            THEIRS · 传入变更 ({primaryLabels.theirs})
                          </span>
                        </div>
                        <span className="text-[10px] text-[#64748b] shrink-0">
                          点击冲突块右侧勾选
                        </span>
                      </div>
                    </div>

                    {/* Unified Vertically Scrollable 2-Column Document */}
                    <div className="flex-1 overflow-y-auto divide-y divide-[#f1f5f9]">
                      {currentDraft.segments.map((seg, segIdx) => {
                        if (seg.kind === "normal") {
                          return (
                            <NormalCodeRows
                              key={seg.id}
                              segment={seg}
                              startLine={seg.startLine}
                              isFirst={segIdx === 0}
                              isLast={
                                segIdx === currentDraft.segments.length - 1
                              }
                              expanded={
                                showFullContext ||
                                Boolean(expandedNormalIds[seg.id])
                              }
                              onExpand={() =>
                                setExpandedNormalIds((prev) => ({
                                  ...prev,
                                  [seg.id]: true,
                                }))
                              }
                              twoColumns
                            />
                          );
                        }

                        const oursChecked = isSideSelected(seg.choice, "ours");
                        const theirsChecked = isSideSelected(
                          seg.choice,
                          "theirs"
                        );
                        const isBoth = oursChecked && theirsChecked;
                        const badge = getChoiceBadge(seg);
                        const isFocused =
                          activeConflictIdx === seg.conflictIndex;
                        const showBase = Boolean(expandedBaseIds[seg.id]);

                        return (
                          <div
                            key={seg.id}
                            ref={(el) => {
                              compareBlockRefs.current[seg.conflictIndex] = el;
                            }}
                            onClick={() =>
                              setActiveConflictIdx(seg.conflictIndex)
                            }
                            className={`my-1.5 mx-1.5 rounded-lg border overflow-hidden transition-shadow ${
                              isFocused
                                ? "border-[#0284c7] ring-2 ring-[#0284c7]/20 shadow-sm"
                                : seg.choice === "unresolved"
                                ? "border-[#fca5a5] shadow-xs"
                                : "border-[#cbd5e1]"
                            }`}
                          >
                            {/* Conflict Chunk Control Bar */}
                            <div
                              className={`px-2.5 py-1.5 border-b flex items-center justify-between gap-2 flex-wrap ${
                                seg.choice === "unresolved"
                                  ? "bg-[#fef2f2]/80 border-[#fecaca]"
                                  : "bg-[#f8fafc] border-[#e2e8f0]"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[11px] font-bold text-[#0b1c30]">
                                  冲突 #{seg.conflictIndex + 1}
                                </span>
                                <span className="font-mono text-[10px] text-[#64748b]">
                                  第 {seg.startLine}–{seg.endLine} 行
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.className}`}
                                >
                                  {badge.label}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 flex-wrap">
                                {isBoth && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      swapBothOrderForSegment(seg.id);
                                    }}
                                    title="切换 Ours 与 Theirs 的先后拼接顺序"
                                    className="px-2 py-0.5 rounded bg-white border border-[#99f6e4] hover:bg-[#f0fdfa] text-[#0f766e] text-[10.5px] font-medium flex items-center gap-1 cursor-pointer"
                                  >
                                    <ArrowLeftRight className="w-3 h-3" />
                                    {seg.choice === "both_ours_first"
                                      ? "Ours 在前"
                                      : "Theirs 在前"}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSegmentChoice(seg.id, "neither");
                                  }}
                                  className={`px-2 py-0.5 rounded border text-[10.5px] font-medium cursor-pointer ${
                                    seg.choice === "neither"
                                      ? "bg-[#334155] border-[#334155] text-white"
                                      : "bg-white border-[#e2e8f0] hover:bg-[#f1f5f9] text-[#475569]"
                                  }`}
                                >
                                  都不保留
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSegmentChoice(seg.id, "custom");
                                    resultBlockRefs.current[
                                      seg.conflictIndex
                                    ]?.scrollIntoView({
                                      behavior: "smooth",
                                      block: "center",
                                    });
                                  }}
                                  className={`px-2 py-0.5 rounded border text-[10.5px] font-medium flex items-center gap-1 cursor-pointer ${
                                    seg.choice === "custom"
                                      ? "bg-[#d97706] border-[#d97706] text-white"
                                      : "bg-white border-[#e2e8f0] hover:bg-[#f1f5f9] text-[#475569]"
                                  }`}
                                >
                                  <Edit3 className="w-3 h-3" />
                                  手改此块
                                </button>
                                {seg.choice !== "unresolved" && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSegmentChoice(seg.id, "unresolved");
                                    }}
                                    className="px-1.5 py-0.5 rounded bg-white border border-[#e2e8f0] hover:bg-[#f1f5f9] text-[#64748b] text-[10.5px] cursor-pointer"
                                  >
                                    重置
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Optional Base (diff3 ancestor) collapsible bar */}
                            {(seg.baseLines.length > 0 || seg.baseLabel) && (
                              <div className="border-b border-[#e2e8f0] bg-[#fffbeb]/70">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedBaseIds((prev) => ({
                                      ...prev,
                                      [seg.id]: !prev[seg.id],
                                    }));
                                  }}
                                  className="w-full px-2.5 py-1 text-left text-[10.5px] text-[#92400e] hover:bg-[#fef3c7]/60 flex items-center justify-between cursor-pointer"
                                >
                                  <span>
                                    共同祖先 Base ({seg.baseLabel || "ancestor"} ·{" "}
                                    {seg.baseLines.length} 行)
                                  </span>
                                  <span>{showBase ? "收起" : "查看"}</span>
                                </button>
                                {showBase && (
                                  <pre className="px-3 py-1.5 font-mono text-[11px] leading-[18px] text-[#78350f] bg-[#fffbeb] border-t border-[#fde68a] overflow-x-auto whitespace-pre">
                                    {seg.baseLines.join("\n") || "(空)"}
                                  </pre>
                                )}
                              </div>
                            )}

                            {/* Side-by-Side Interactive Ours vs Theirs Columns */}
                            <div className="grid grid-cols-2 divide-x divide-[#e2e8f0]">
                              {/* Left Side (Ours) */}
                              <div
                                className={`flex flex-col min-w-0 transition-colors ${
                                  oursChecked
                                    ? "bg-[#f0f9ff]/80"
                                    : seg.choice === "unresolved"
                                    ? "bg-[#f0f9ff]/35"
                                    : "bg-[#f8fafc] opacity-65"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleSideForSegment(seg.id, "ours");
                                  }}
                                  className={`px-2.5 py-1 border-b flex items-center justify-between gap-2 text-left cursor-pointer transition-colors ${
                                    oursChecked
                                      ? "bg-[#e0f2fe] border-[#bae6fd] text-[#0369a1]"
                                      : "bg-[#f0f9ff]/70 hover:bg-[#e0f2fe]/70 border-[#e2e8f0] text-[#0284c7]"
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5 text-[11px] font-semibold truncate">
                                    <span
                                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                                        oursChecked
                                          ? "bg-[#0284c7] border-[#0284c7] text-white"
                                          : "bg-white border-[#7dd3fc]"
                                      }`}
                                    >
                                      {oursChecked && (
                                        <Check className="w-2.5 h-2.5" />
                                      )}
                                    </span>
                                    采用 Ours ({seg.oursLabel || "HEAD"})
                                  </span>
                                  <span className="font-mono text-[10px] opacity-80 shrink-0">
                                    {seg.oursLines.length} 行
                                  </span>
                                </button>
                                <div className="overflow-x-auto py-1 font-mono text-[11.5px] leading-[19px]">
                                  {seg.oursLines.length === 0 ? (
                                    <div className="px-3 py-1.5 text-[11px] italic text-[#94a3b8]">
                                      (空 — 此分支删除了该段代码)
                                    </div>
                                  ) : (
                                    seg.oursLines.map((line, i) => (
                                      <div
                                        key={i}
                                        className="flex hover:bg-[#e0f2fe]/40"
                                      >
                                        <span className="w-9 shrink-0 select-none text-right pr-2 text-[#0284c7]/70">
                                          {seg.startLine + 1 + i}
                                        </span>
                                        <pre
                                          className={`px-2 whitespace-pre text-[#0b1c30] ${
                                            seg.choice !== "unresolved" &&
                                            !oursChecked &&
                                            seg.choice !== "custom"
                                              ? "line-through text-[#94a3b8]"
                                              : ""
                                          }`}
                                        >
                                          {line || " "}
                                        </pre>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>

                              {/* Right Side (Theirs) */}
                              <div
                                className={`flex flex-col min-w-0 transition-colors ${
                                  theirsChecked
                                    ? "bg-[#faf5ff]/90"
                                    : seg.choice === "unresolved"
                                    ? "bg-[#faf5ff]/40"
                                    : "bg-[#f8fafc] opacity-65"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleSideForSegment(seg.id, "theirs");
                                  }}
                                  className={`px-2.5 py-1 border-b flex items-center justify-between gap-2 text-left cursor-pointer transition-colors ${
                                    theirsChecked
                                      ? "bg-[#ede9fe] border-[#ddd6fe] text-[#6d28d9]"
                                      : "bg-[#faf5ff]/80 hover:bg-[#ede9fe]/70 border-[#e2e8f0] text-[#7c3aed]"
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5 text-[11px] font-semibold truncate">
                                    <span
                                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                                        theirsChecked
                                          ? "bg-[#7c3aed] border-[#7c3aed] text-white"
                                          : "bg-white border-[#c4b5fd]"
                                      }`}
                                    >
                                      {theirsChecked && (
                                        <Check className="w-2.5 h-2.5" />
                                      )}
                                    </span>
                                    采用 Theirs (
                                    {seg.theirsLabel || "Incoming"})
                                  </span>
                                  <span className="font-mono text-[10px] opacity-80 shrink-0">
                                    {seg.theirsLines.length} 行
                                  </span>
                                </button>
                                <div className="overflow-x-auto py-1 font-mono text-[11.5px] leading-[19px]">
                                  {seg.theirsLines.length === 0 ? (
                                    <div className="px-3 py-1.5 text-[11px] italic text-[#94a3b8]">
                                      (空 — 传入分支删除了该段代码)
                                    </div>
                                  ) : (
                                    seg.theirsLines.map((line, i) => (
                                      <div
                                        key={i}
                                        className="flex hover:bg-[#ede9fe]/40"
                                      >
                                        <span className="w-9 shrink-0 select-none text-right pr-2 text-[#7c3aed]/70">
                                          {seg.startLine +
                                            1 +
                                            seg.oursLines.length +
                                            (seg.baseLines.length > 0 ||
                                            seg.baseLabel
                                              ? seg.baseLines.length + 1
                                              : 0) +
                                            1 +
                                            i}
                                        </span>
                                        <pre
                                          className={`px-2 whitespace-pre text-[#0b1c30] ${
                                            seg.choice !== "unresolved" &&
                                            !theirsChecked &&
                                            seg.choice !== "custom"
                                              ? "line-through text-[#94a3b8]"
                                              : ""
                                          }`}
                                        >
                                          {line || " "}
                                        </pre>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Draggable Splitter Handle */}
                  <div
                    onMouseDown={startSplitResize}
                    title="上下拖拽调整对比区与结果预览区高度"
                    className="h-1.5 shrink-0 cursor-ns-resize flex items-center justify-center group"
                  >
                    <div className="w-16 h-1 rounded-full bg-[#cbd5e1] group-hover:bg-[#0284c7] transition-colors" />
                  </div>

                  {/* Bottom Pane: Live Merged Result Output */}
                  <div className="flex-1 min-h-[140px] flex flex-col bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
                    <div className="h-9 px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between gap-2 shrink-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-[#0b1c30]">
                          合并结果实时预览
                        </span>
                        {unresolvedList.length > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              jumpToConflict(unresolvedList[0].conflictIndex)
                            }
                            className="px-2 py-0.5 rounded bg-[#fef2f2] hover:bg-[#fee2e2] text-[#dc2626] text-[10.5px] font-medium cursor-pointer"
                          >
                            还有 {unresolvedList.length} 处待处理 · 点击定位下一处
                          </button>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-[#dcfce7] text-[#15803d] text-[10.5px] font-medium">
                            所有冲突已解决，可直接暂存
                          </span>
                        )}
                      </div>
                      <button
                        onClick={handleMarkResolved}
                        disabled={saving || !readyToResolve}
                        className="flex items-center gap-1 px-3 py-1 rounded bg-[#16a34a] hover:bg-[#15803d] text-white text-[11px] font-medium disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors shrink-0"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {saving ? "保存中..." : "完成并暂存文件"}
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto divide-y divide-[#f1f5f9]">
                      {currentDraft.segments.map((seg, segIdx) => {
                        const outStartLine =
                          resultSegmentStartLines[segIdx] ?? 1;
                        if (seg.kind === "normal") {
                          return (
                            <NormalCodeRows
                              key={`res-${seg.id}`}
                              segment={seg}
                              startLine={outStartLine}
                              isFirst={segIdx === 0}
                              isLast={
                                segIdx === currentDraft.segments.length - 1
                              }
                              expanded={
                                showFullContext ||
                                Boolean(expandedNormalIds[seg.id])
                              }
                              onExpand={() =>
                                setExpandedNormalIds((prev) => ({
                                  ...prev,
                                  [seg.id]: true,
                                }))
                              }
                            />
                          );
                        }

                        const outLines = getSegmentResolvedLines(seg);
                        const accentClass =
                          seg.choice === "ours"
                            ? "border-l-[#0284c7] bg-[#f0f9ff]/35"
                            : seg.choice === "theirs"
                            ? "border-l-[#7c3aed] bg-[#faf5ff]/40"
                            : seg.choice === "both_ours_first" ||
                              seg.choice === "both_theirs_first"
                            ? "border-l-[#0d9488] bg-[#f0fdfa]/50"
                            : seg.choice === "custom"
                            ? "border-l-[#d97706] bg-[#fffbeb]/50"
                            : seg.choice === "neither"
                            ? "border-l-[#94a3b8] bg-[#f8fafc]"
                            : "border-l-[#dc2626] bg-[#fef2f2]/45";

                        const badge = getChoiceBadge(seg);

                        return (
                          <div
                            key={`res-${seg.id}`}
                            ref={(el) => {
                              resultBlockRefs.current[seg.conflictIndex] = el;
                            }}
                            className={`border-l-[3px] ${accentClass}`}
                          >
                            <div className="px-3 py-1 flex items-center justify-between gap-2 border-b border-[#f1f5f9]">
                              <button
                                type="button"
                                onClick={() =>
                                  jumpToConflict(seg.conflictIndex)
                                }
                                className="flex items-center gap-1.5 text-[10.5px] font-medium text-[#334155] hover:text-[#0284c7] cursor-pointer"
                              >
                                <span className="font-mono font-bold">
                                  #{seg.conflictIndex + 1}
                                </span>
                                <span
                                  className={`px-1.5 py-[1px] rounded border text-[10px] ${badge.className}`}
                                >
                                  {badge.label}
                                </span>
                              </button>

                              <div className="flex items-center gap-1.5">
                                {seg.choice === "unresolved" ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSegmentChoice(seg.id, "ours")
                                      }
                                      className="px-2 py-0.5 rounded bg-[#e0f2fe] hover:bg-[#bae6fd] text-[#0369a1] text-[10px] font-medium cursor-pointer"
                                    >
                                      采用 Ours
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSegmentChoice(seg.id, "theirs")
                                      }
                                      className="px-2 py-0.5 rounded bg-[#ede9fe] hover:bg-[#ddd6fe] text-[#6d28d9] text-[10px] font-medium cursor-pointer"
                                    >
                                      采用 Theirs
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSegmentChoice(
                                          seg.id,
                                          "both_ours_first"
                                        )
                                      }
                                      className="px-2 py-0.5 rounded bg-white border border-[#cbd5e1] hover:bg-[#f8fafc] text-[#334155] text-[10px] font-medium cursor-pointer"
                                    >
                                      都保留
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {seg.choice !== "custom" && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setSegmentChoice(seg.id, "custom")
                                        }
                                        className="text-[10px] text-[#64748b] hover:text-[#0284c7] underline cursor-pointer"
                                      >
                                        手改此段
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSegmentChoice(seg.id, "unresolved")
                                      }
                                      className="text-[10px] text-[#64748b] hover:text-[#dc2626] underline cursor-pointer"
                                    >
                                      重选
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {seg.choice === "unresolved" ? (
                              <div className="px-3 py-2 text-[11px] text-[#b91c1c] flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  该冲突段尚未选择方案 —— 可在上方对比区勾选 Ours / Theirs，或直接点击右侧按钮快速选择。
                                </span>
                              </div>
                            ) : seg.choice === "custom" ? (
                              <div className="p-2">
                                <textarea
                                  value={seg.customLines.join("\n")}
                                  onChange={(e) =>
                                    updateCustomLinesForSegment(
                                      seg.id,
                                      e.target.value
                                    )
                                  }
                                  rows={Math.max(
                                    3,
                                    Math.min(12, seg.customLines.length + 1)
                                  )}
                                  spellCheck={false}
                                  placeholder="在此输入该冲突段的自定义合并内容..."
                                  className="w-full p-2 rounded border border-[#fcd34d] focus:border-[#d97706] bg-white font-mono text-[11.5px] leading-[19px] text-[#0b1c30] outline-none resize-y"
                                />
                              </div>
                            ) : outLines.length === 0 ? (
                              <div className="px-3 py-1.5 text-[11px] italic text-[#64748b]">
                                (已选择不保留此段任何代码行 · 0 行)
                              </div>
                            ) : (
                              <div className="py-0.5 font-mono text-[11.5px] leading-[19px]">
                                {outLines.map((line, i) => (
                                  <div
                                    key={i}
                                    className="flex hover:bg-black/[0.03]"
                                  >
                                    <span className="w-11 shrink-0 select-none text-right pr-2.5 text-[#64748b] border-r border-[#e2e8f0]/70">
                                      {outStartLine + i}
                                    </span>
                                    <pre className="px-3 whitespace-pre-wrap break-all text-[#0b1c30] flex-1">
                                      {line || " "}
                                    </pre>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDangerModal
        open={abortConfirmOpen}
        title="确认中止当前合并？"
        description="这将中止正在进行的合并并放弃所有未提交的冲突解决改动，恢复工作区到 HEAD。"
        confirmLabel="中止合并"
        onCancel={() => setAbortConfirmOpen(false)}
        onConfirm={handleAbortMerge}
      />
    </div>
  );
};
