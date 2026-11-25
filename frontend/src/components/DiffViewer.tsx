import React, { useMemo } from "react";
import { FileArchive, AlertCircle, ShieldAlert } from "lucide-react";
import type { DiffLine, FileDiff } from "../../bindings/gitpulse/internal/git/models";
import { formatBytes } from "./StatusBadge";

interface DiffViewerProps {
  diff: FileDiff | null;
  loading?: boolean;
  mode: "unified" | "split";
  emptyMessage?: string;
  onDisableFileMode?: () => void;
  onDisableAutoCRLF?: () => void;
  onRestoreFile?: () => void;
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i];
    if (cur.type === "context") {
      rows.push({ left: cur, right: cur });
      i++;
      continue;
    }
    if (cur.type === "del") {
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === "del") {
        dels.push(lines[i]);
        i++;
      }
      while (i < lines.length && lines[i].type === "add") {
        adds.push(lines[i]);
        i++;
      }
      const max = Math.max(dels.length, adds.length);
      for (let k = 0; k < max; k++) {
        rows.push({
          left: k < dels.length ? dels[k] : null,
          right: k < adds.length ? adds[k] : null,
        });
      }
      continue;
    }
    if (cur.type === "add") {
      rows.push({ left: null, right: cur });
      i++;
    }
  }
  return rows;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  diff,
  loading,
  mode,
  emptyMessage = "Select a file to inspect its diff",
  onDisableFileMode,
  onDisableAutoCRLF,
  onRestoreFile,
}) => {
  const hunks = diff?.hunks ?? [];

  const splitHunks = useMemo(() => {
    if (mode !== "split") return [];
    return hunks.map((h) => ({
      header: h.header,
      rows: buildSplitRows(h.lines ?? []),
    }));
  }, [hunks, mode]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#64748b] bg-white">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-4 h-4 border-2 border-[#0284c7] border-t-transparent rounded-full animate-spin" />
          <span>Loading diff...</span>
        </div>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#94a3b8] bg-white text-xs">
        {emptyMessage}
      </div>
    );
  }

  if (diff.rawError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white p-6">
        <div className="flex items-center gap-2 text-xs text-[#dc2626] bg-[#fef2f2] border border-[#fecaca] px-3 py-2 rounded">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{diff.rawError}</span>
        </div>
      </div>
    );
  }

  if (diff.isBinary) {
    const delta = diff.newSize - diff.oldSize;
    return (
      <div className="flex-1 flex items-center justify-center bg-white p-6">
        <div className="max-w-md w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-5 text-center">
          <div className="w-10 h-10 rounded-full bg-[#e0f2fe] text-[#0284c7] flex items-center justify-center mx-auto mb-3">
            <FileArchive className="w-5 h-5" />
          </div>
          <div className="text-[13px] font-semibold text-[#0b1c30] mb-1">
            Binary File
          </div>
          <div className="text-xs text-[#64748b] mb-3 font-mono truncate">
            {diff.path}
          </div>
          <div className="inline-flex items-center gap-3 px-3 py-1.5 rounded bg-white border border-[#e2e8f0] text-xs font-mono">
            <span className="text-[#64748b]">
              Before: <strong className="text-[#0b1c30]">{formatBytes(diff.oldSize)}</strong>
            </span>
            <span className="text-[#94a3b8]">→</span>
            <span className="text-[#64748b]">
              After: <strong className="text-[#0b1c30]">{formatBytes(diff.newSize)}</strong>
            </span>
            {delta !== 0 && (
              <span
                className={
                  delta > 0 ? "text-[#16a34a] font-semibold" : "text-[#dc2626] font-semibold"
                }
              >
                ({delta > 0 ? "+" : ""}
                {formatBytes(Math.abs(delta))})
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (hunks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white p-6">
        <div className="max-w-md w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-5 text-center flex flex-col items-center gap-2">
          <ShieldAlert className="w-7 h-7 text-[#d97706]" />
          <div className="text-[13px] font-semibold text-[#0b1c30]">
            {diff.modeChange
              ? `File Mode Changed (${diff.modeChange})`
              : "No Textual Content Differences"}
          </div>
          <p className="text-xs text-[#64748b] leading-relaxed">
            {diff.modeChange
              ? "Git detected an executable permission change without content edits. This commonly happens across Windows / WSL2 filesystems."
              : "File content matches HEAD, or only line endings (CRLF/LF) / file permissions differ (common between Windows and WSL2)."}
          </p>
          {(onDisableFileMode || onDisableAutoCRLF || onRestoreFile) && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              {onDisableFileMode && (
                <button
                  onClick={onDisableFileMode}
                  className="px-2.5 py-1 rounded bg-[#0284c7] hover:bg-[#0369a1] text-white text-[11px] font-medium cursor-pointer"
                >
                  Ignore Permissions (filemode=false)
                </button>
              )}
              {onDisableAutoCRLF && (
                <button
                  onClick={onDisableAutoCRLF}
                  className="px-2.5 py-1 rounded bg-white border border-[#cbd5e1] hover:bg-[#f1f5f9] text-[#0b1c30] text-[11px] font-medium cursor-pointer"
                >
                  No CRLF Conversion (autocrlf=false)
                </button>
              )}
              {onRestoreFile && (
                <button
                  onClick={onRestoreFile}
                  className="px-2.5 py-1 rounded bg-white border border-[#fca5a5] hover:bg-[#fef2f2] text-[#dc2626] text-[11px] font-medium cursor-pointer"
                >
                  Restore to HEAD...
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === "split") {
    return (
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden bg-white font-mono text-[12px] leading-[20px]">
        <div className="grid grid-cols-2 min-w-0 divide-x divide-[#cbd5e1]">
          {/* Left (Old) */}
          <div className="min-w-0 overflow-x-auto">
            <div className="w-max min-w-full">
              {splitHunks.map((hunk, hi) => (
                <div key={hi}>
                  <div className="sticky top-0 z-10 h-[26px] flex items-center px-3 bg-[#f8fafc] border-y border-[#e2e8f0] text-[11px] text-[#64748b] select-text whitespace-pre">
                    {hunk.header}
                  </div>
                  {hunk.rows.map((row, ri) => (
                    <div
                      key={ri}
                      className={`flex h-[20px] items-center ${
                        row.left?.type === "del"
                          ? "bg-[#fef2f2] text-[#7f1d1d]"
                          : row.left
                          ? "bg-white text-[#0b1c30]"
                          : "bg-[#f8fafc]"
                      }`}
                    >
                      <span
                        className={`w-10 min-w-[40px] shrink-0 h-full px-1.5 text-right select-none text-[11px] border-r border-[#e2e8f0] ${
                          row.left?.type === "del"
                            ? "bg-[#fee2e2] text-[#dc2626]"
                            : row.left
                            ? "bg-[#f8fafc] text-[#94a3b8]"
                            : "bg-[#f1f5f9]"
                        }`}
                      >
                        {row.left ? row.left.oldLine || "" : ""}
                      </span>
                      <span className="px-2 pr-6 whitespace-pre select-text">
                        {row.left ? (
                          <>
                            <span className="inline-block w-3 select-none opacity-70">
                              {row.left.type === "del" ? "-" : " "}
                            </span>
                            {row.left.content}
                          </>
                        ) : (
                          ""
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Right (New) */}
          <div className="min-w-0 overflow-x-auto">
            <div className="w-max min-w-full">
              {splitHunks.map((hunk, hi) => (
                <div key={hi}>
                  <div className="sticky top-0 z-10 h-[26px] flex items-center px-3 bg-[#f8fafc] border-y border-[#e2e8f0] text-[11px] text-[#64748b] select-text whitespace-pre">
                    {hunk.header}
                  </div>
                  {hunk.rows.map((row, ri) => (
                    <div
                      key={ri}
                      className={`flex h-[20px] items-center ${
                        row.right?.type === "add"
                          ? "bg-[#f0fdf4] text-[#14532d]"
                          : row.right
                          ? "bg-white text-[#0b1c30]"
                          : "bg-[#f8fafc]"
                      }`}
                    >
                      <span
                        className={`w-10 min-w-[40px] shrink-0 h-full px-1.5 text-right select-none text-[11px] border-r border-[#e2e8f0] ${
                          row.right?.type === "add"
                            ? "bg-[#dcfce7] text-[#16a34a]"
                            : row.right
                            ? "bg-[#f8fafc] text-[#94a3b8]"
                            : "bg-[#f1f5f9]"
                        }`}
                      >
                        {row.right ? row.right.newLine || "" : ""}
                      </span>
                      <span className="px-2 pr-6 whitespace-pre select-text">
                        {row.right ? (
                          <>
                            <span className="inline-block w-3 select-none opacity-70">
                              {row.right.type === "add" ? "+" : " "}
                            </span>
                            {row.right.content}
                          </>
                        ) : (
                          ""
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 min-h-0 overflow-auto bg-white font-mono text-[12px] leading-[20px]">
      <div className="w-max min-w-full">
        {hunks.map((hunk, hi) => (
          <div key={hi}>
            <div className="sticky top-0 z-10 px-3 py-1 bg-[#f8fafc] border-y border-[#e2e8f0] text-[11px] text-[#64748b] select-text">
              {hunk.header}
            </div>
            <table className="w-full border-collapse">
              <tbody>
                {(hunk.lines ?? []).map((line, li) => {
                  const isAdd = line.type === "add";
                  const isDel = line.type === "del";
                  return (
                    <tr
                      key={li}
                      className={
                        isAdd
                          ? "bg-[#f0fdf4] text-[#14532d]"
                          : isDel
                          ? "bg-[#fef2f2] text-[#7f1d1d]"
                          : "bg-white text-[#0b1c30] hover:bg-[#f8fafc]"
                      }
                    >
                      <td
                        className={`w-10 min-w-[40px] px-1.5 text-right select-none text-[11px] border-r border-[#e2e8f0] ${
                          isAdd
                            ? "bg-[#dcfce7] text-[#16a34a]"
                            : isDel
                            ? "bg-[#fee2e2] text-[#dc2626]"
                            : "bg-[#f8fafc] text-[#94a3b8]"
                        }`}
                      >
                        {line.oldLine > 0 ? line.oldLine : ""}
                      </td>
                      <td
                        className={`w-10 min-w-[40px] px-1.5 text-right select-none text-[11px] border-r border-[#e2e8f0] ${
                          isAdd
                            ? "bg-[#dcfce7] text-[#16a34a]"
                            : isDel
                            ? "bg-[#fee2e2] text-[#dc2626]"
                            : "bg-[#f8fafc] text-[#94a3b8]"
                        }`}
                      >
                        {line.newLine > 0 ? line.newLine : ""}
                      </td>
                      <td
                        className={`w-5 min-w-[20px] text-center select-none font-bold ${
                          isAdd
                            ? "text-[#16a34a]"
                            : isDel
                            ? "text-[#dc2626]"
                            : "text-[#cbd5e1]"
                        }`}
                      >
                        {isAdd ? "+" : isDel ? "-" : " "}
                      </td>
                      <td className="pr-6 whitespace-pre select-text">
                        {line.content}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
};
