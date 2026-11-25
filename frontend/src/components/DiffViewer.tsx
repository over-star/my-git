import React, { useMemo } from "react";
import { FileArchive, AlertCircle } from "lucide-react";
import type { DiffLine, FileDiff } from "../../bindings/gitpulse/internal/git/models";
import { formatBytes } from "./StatusBadge";

interface DiffViewerProps {
  diff: FileDiff | null;
  loading?: boolean;
  mode: "unified" | "split";
  emptyMessage?: string;
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
      <div className="flex-1 flex items-center justify-center text-[#94a3b8] bg-white text-xs">
        No textual differences in this file (mode change, empty file, or whitespace ignored).
      </div>
    );
  }

  if (mode === "split") {
    return (
      <div className="flex-1 overflow-auto bg-white font-mono text-[12px] leading-[18px]">
        <div className="min-w-[680px]">
          {splitHunks.map((hunk, hi) => (
            <div key={hi}>
              <div className="sticky top-0 z-10 px-3 py-1 bg-[#f8fafc] border-y border-[#e2e8f0] text-[11px] text-[#64748b] select-text">
                {hunk.header}
              </div>
              <table className="w-full border-collapse table-fixed">
                <tbody>
                  {hunk.rows.map((row, ri) => (
                    <tr key={ri} className="align-top">
                      {/* Left (Old) */}
                      <td
                        className={`w-10 px-1.5 text-right select-none text-[11px] border-r border-[#e2e8f0] ${
                          row.left?.type === "del"
                            ? "bg-[#fee2e2] text-[#dc2626]"
                            : row.left
                            ? "bg-[#f8fafc] text-[#94a3b8]"
                            : "bg-[#f1f5f9]"
                        }`}
                      >
                        {row.left ? row.left.oldLine || "" : ""}
                      </td>
                      <td
                        className={`w-1/2 px-2 whitespace-pre overflow-x-auto border-r border-[#cbd5e1] select-text ${
                          row.left?.type === "del"
                            ? "bg-[#fef2f2] text-[#7f1d1d]"
                            : row.left
                            ? "bg-white text-[#0b1c30]"
                            : "bg-[#f8fafc]"
                        }`}
                      >
                        {row.left ? (
                          <span>
                            <span className="inline-block w-3 select-none opacity-70">
                              {row.left.type === "del" ? "-" : " "}
                            </span>
                            {row.left.content}
                          </span>
                        ) : (
                          ""
                        )}
                      </td>

                      {/* Right (New) */}
                      <td
                        className={`w-10 px-1.5 text-right select-none text-[11px] border-r border-[#e2e8f0] ${
                          row.right?.type === "add"
                            ? "bg-[#dcfce7] text-[#16a34a]"
                            : row.right
                            ? "bg-[#f8fafc] text-[#94a3b8]"
                            : "bg-[#f1f5f9]"
                        }`}
                      >
                        {row.right ? row.right.newLine || "" : ""}
                      </td>
                      <td
                        className={`w-1/2 px-2 whitespace-pre overflow-x-auto select-text ${
                          row.right?.type === "add"
                            ? "bg-[#f0fdf4] text-[#14532d]"
                            : row.right
                            ? "bg-white text-[#0b1c30]"
                            : "bg-[#f8fafc]"
                        }`}
                      >
                        {row.right ? (
                          <span>
                            <span className="inline-block w-3 select-none opacity-70">
                              {row.right.type === "add" ? "+" : " "}
                            </span>
                            {row.right.content}
                          </span>
                        ) : (
                          ""
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-white font-mono text-[12px] leading-[18px]">
      <div className="min-w-fit">
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
                        className={`w-10 px-1.5 text-right select-none text-[11px] border-r border-[#e2e8f0] ${
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
                        className={`w-10 px-1.5 text-right select-none text-[11px] border-r border-[#e2e8f0] ${
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
                        className={`w-5 text-center select-none font-bold ${
                          isAdd
                            ? "text-[#16a34a]"
                            : isDel
                            ? "text-[#dc2626]"
                            : "text-[#cbd5e1]"
                        }`}
                      >
                        {isAdd ? "+" : isDel ? "-" : " "}
                      </td>
                      <td className="pr-4 whitespace-pre select-text">
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
