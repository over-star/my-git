import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  XCircle,
  CheckCircle2,
  GitMerge,
} from "lucide-react";
import type {
  ConflictBlock,
  ConflictFileContent,
  RepoLocation,
  RepoStatus,
} from "../../bindings/gitpulse/internal/git/models";
import { GitService } from "../../bindings/gitpulse";

interface ConflictViewProps {
  repo: RepoLocation;
  status: RepoStatus | null;
  onRefresh: () => Promise<void>;
  onNotify: (type: "success" | "error" | "info", msg: string) => void;
  onGoToChanges: () => void;
}

export const ConflictView: React.FC<ConflictViewProps> = ({
  repo,
  status,
  onRefresh,
  onNotify,
  onGoToChanges,
}) => {
  const conflicted = status?.conflicted ?? [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileData, setFileData] = useState<ConflictFileContent | null>(null);
  const [draftText, setDraftText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (conflicted.length > 0) {
      if (!selectedPath || !conflicted.some((f) => f.path === selectedPath)) {
        setSelectedPath(conflicted[0].path);
      }
    } else {
      setSelectedPath(null);
      setFileData(null);
      setDraftText("");
    }
  }, [conflicted, repo.path]);

  useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    setLoading(true);
    GitService.GetConflictFile(repo.path, selectedPath)
      .then((res) => {
        if (cancelled) return;
        setFileData(res);
        setDraftText(res.rawContent);
      })
      .catch((err) => {
        if (!cancelled) onNotify("error", `Failed to read conflict file: ${err}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.path, selectedPath, status]);

  const applyChoice = (
    block: ConflictBlock,
    choice: "ours" | "theirs" | "both"
  ) => {
    const lines = draftText.split("\n");
    // Locate the first matching conflict marker block in current draft
    let startIdx = -1;
    let midIdx = -1;
    let endIdx = -1;
    let seen = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("<<<<<<<")) {
        if (seen === block.index || startIdx === -1) {
          startIdx = i;
        }
      } else if (startIdx >= 0 && midIdx < 0 && lines[i].startsWith("=======")) {
        midIdx = i;
      } else if (startIdx >= 0 && midIdx >= 0 && lines[i].startsWith(">>>>>>>")) {
        endIdx = i;
        break;
      }
    }
    if (startIdx < 0 || midIdx < 0 || endIdx < 0) {
      // Fallback: reload and replace
      onNotify("info", "Edit the merge buffer directly or reload file.");
      return;
    }

    const ours = lines.slice(startIdx + 1, midIdx);
    const theirs = lines.slice(midIdx + 1, endIdx);
    let replacement: string[] = [];
    if (choice === "ours") replacement = ours;
    else if (choice === "theirs") replacement = theirs;
    else replacement = [...ours, ...theirs];

    const updated = [
      ...lines.slice(0, startIdx),
      ...replacement,
      ...lines.slice(endIdx + 1),
    ].join("\n");
    setDraftText(updated);
  };

  const hasRemainingMarkers =
    draftText.includes("<<<<<<<") &&
    draftText.includes("=======") &&
    draftText.includes(">>>>>>>");

  const handleMarkResolved = async () => {
    if (!selectedPath) return;
    if (hasRemainingMarkers) {
      onNotify("error", "Conflict markers (<<<<<<< / ======= / >>>>>>>) still remain in buffer.");
      return;
    }
    setSaving(true);
    try {
      await GitService.SaveResolvedConflict(
        repo.path,
        selectedPath,
        draftText,
        true
      );
      onNotify("success", `Resolved and staged ${selectedPath}`);
      await onRefresh();
    } catch (err) {
      onNotify("error", `Failed to save resolution: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAbortMerge = async () => {
    try {
      const res = await GitService.AbortMerge(repo.path);
      if (res.success) {
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

  if (conflicted.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#f8fafc] gap-3 p-6">
        <CheckCircle2 className="w-10 h-10 text-[#16a34a] opacity-75" />
        <div className="text-sm font-semibold text-[#0b1c30]">
          No Merge Conflicts
        </div>
        <div className="text-xs text-[#64748b] max-w-md text-center">
          {(status?.mergeState ?? "") !== ""
            ? "All conflicted files have been resolved. Switch to Working Tree to commit the merge."
            : "Your working tree has no unmerged files. Conflicts from Pull or Merge will appear here."}
        </div>
        {(status?.mergeState ?? "") !== "" && (
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={onGoToChanges}
              className="px-3 py-1.5 rounded bg-[#0284c7] text-white text-xs font-medium hover:bg-[#0369a1] cursor-pointer"
            >
              Go to Commit Panel
            </button>
            <button
              onClick={handleAbortMerge}
              className="px-3 py-1.5 rounded bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] text-xs font-medium hover:bg-[#fee2e2] cursor-pointer"
            >
              Abort Merge
            </button>
          </div>
        )}
      </div>
    );
  }

  const blocks = fileData?.blocks ?? [];

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#f8fafc] p-2 gap-2">
      {/* Top Conflict Banner */}
      <div className="px-3 py-2 bg-white border border-[#fecaca] rounded-lg flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-[#fef2f2] text-[#dc2626] flex items-center justify-center">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-[#0b1c30] flex items-center gap-2">
              <span>Merge Conflict Resolver</span>
              <span className="px-1.5 py-0.5 rounded bg-[#dc2626] text-white text-[10px] font-mono font-bold">
                {conflicted.length} UNRESOLVED
              </span>
            </div>
            <div className="text-[11px] text-[#64748b]">
              Resolve conflict hunks below or open in your external editor, then mark files resolved.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedPath && (
            <button
              onClick={() => GitService.OpenInEditor(repo.path, selectedPath)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-white border border-[#e2e8f0] hover:border-[#cbd5e1] text-xs font-medium text-[#334155] cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in External Editor
            </button>
          )}
          <button
            onClick={handleAbortMerge}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#fef2f2] border border-[#fecaca] hover:bg-[#fee2e2] text-xs font-medium text-[#dc2626] cursor-pointer"
          >
            <XCircle className="w-3.5 h-3.5" />
            Abort Merge
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0 gap-2">
        {/* Conflicted Files Sidebar */}
        <div className="w-64 shrink-0 bg-white border border-[#e2e8f0] rounded-lg flex flex-col overflow-hidden">
          <div className="h-8 px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between text-[11px] font-semibold text-[#0b1c30]">
            <span className="flex items-center gap-1.5">
              <GitMerge className="w-3.5 h-3.5 text-[#dc2626]" />
              Conflicted Files
            </span>
            <span className="font-mono text-[10px] text-[#dc2626]">
              {conflicted.length} left
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1">
            {conflicted.map((f) => {
              const active = f.path === selectedPath;
              return (
                <button
                  key={f.path}
                  onClick={() => setSelectedPath(f.path)}
                  className={`w-full text-left px-2.5 py-1.5 rounded flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                    active
                      ? "bg-[#f0f9ff] text-[#0b1c30] border border-[#bae6fd]"
                      : "hover:bg-[#f8fafc] text-[#334155] border border-transparent"
                  }`}
                >
                  <span className="font-mono text-[11px] truncate">
                    {f.path}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[#fef2f2] text-[#dc2626] text-[10px] font-bold shrink-0">
                    U
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Resolver Workspace */}
        <div className="flex-1 flex flex-col min-w-0 gap-2">
          {loading ? (
            <div className="flex-1 bg-white border border-[#e2e8f0] rounded-lg flex items-center justify-center text-xs text-[#64748b]">
              Loading conflicted file...
            </div>
          ) : (
            <>
              {/* Conflict Hunks Quick Picker */}
              {blocks.length > 0 && (
                <div className="max-h-[44%] overflow-y-auto flex flex-col gap-2">
                  {blocks.map((block) => (
                    <div
                      key={block.index}
                      className="bg-white border border-[#e2e8f0] rounded-lg overflow-hidden shrink-0"
                    >
                      <div className="px-3 py-1.5 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-semibold text-[#475569]">
                          Conflict #{block.index + 1} (Lines {block.startLine}–
                          {block.endLine})
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => applyChoice(block, "ours")}
                            className="px-2 py-0.5 rounded bg-[#e0f2fe] hover:bg-[#bae6fd] text-[#0369a1] text-[11px] font-medium cursor-pointer"
                          >
                            Choose Ours ({block.oursLabel || "HEAD"})
                          </button>
                          <button
                            onClick={() => applyChoice(block, "theirs")}
                            className="px-2 py-0.5 rounded bg-[#ede9fe] hover:bg-[#ddd6fe] text-[#6d28d9] text-[11px] font-medium cursor-pointer"
                          >
                            Choose Theirs ({block.theirsLabel || "Incoming"})
                          </button>
                          <button
                            onClick={() => applyChoice(block, "both")}
                            className="px-2 py-0.5 rounded bg-white border border-[#e2e8f0] hover:bg-[#f1f5f9] text-[#334155] text-[11px] font-medium cursor-pointer"
                          >
                            Choose Both
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-[#e2e8f0] font-mono text-[11px]">
                        <div className="bg-[#f0f9ff]/40 p-2 overflow-x-auto">
                          <div className="text-[10px] font-semibold text-[#0284c7] mb-1">
                            OURS ({block.oursLabel || "HEAD"})
                          </div>
                          <pre className="whitespace-pre text-[#0b1c30]">
                            {(block.oursLines ?? []).join("\n") || "(empty)"}
                          </pre>
                        </div>
                        <div className="bg-[#faf5ff]/50 p-2 overflow-x-auto">
                          <div className="text-[10px] font-semibold text-[#7c3aed] mb-1">
                            THEIRS ({block.theirsLabel || "Incoming"})
                          </div>
                          <pre className="whitespace-pre text-[#0b1c30]">
                            {(block.theirsLines ?? []).join("\n") || "(empty)"}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Merge Result Output Buffer */}
              <div className="flex-1 flex flex-col min-h-0 bg-white border border-[#e2e8f0] rounded-lg overflow-hidden">
                <div className="h-9 px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#0b1c30]">
                      Merge Result Buffer
                    </span>
                    {hasRemainingMarkers ? (
                      <span className="px-1.5 py-0.5 rounded bg-[#fef2f2] text-[#dc2626] text-[10px] font-mono font-semibold">
                        UNRESOLVED MARKERS PRESENT
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-[#dcfce7] text-[#15803d] text-[10px] font-mono font-semibold">
                        READY TO STAGE
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleMarkResolved}
                    disabled={saving || hasRemainingMarkers}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#16a34a] hover:bg-[#15803d] text-white text-[11px] font-medium disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {saving ? "Saving..." : "Mark as Resolved"}
                  </button>
                </div>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  spellCheck={false}
                  className="flex-1 w-full p-3 font-mono text-[12px] leading-[18px] text-[#0b1c30] outline-none resize-none bg-white"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
