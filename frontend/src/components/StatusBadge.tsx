import React from "react";

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val < 10 && idx > 0 ? val.toFixed(1) : Math.round(val)} ${units[idx]}`;
}

export function getStatusTextColor(status: string, conflicted?: boolean): string {
  if (conflicted || status === "U") return "text-[#dc2626] font-medium";
  switch (status) {
    case "A":
    case "?":
      return "text-[#16a34a]";
    case "D":
      return "text-[#dc2626] line-through";
    case "M":
      return "text-[#0284c7]";
    case "R":
    case "C":
      return "text-[#7c3aed]";
    default:
      return "text-[#334155]";
  }
}

export const StatusBadge: React.FC<{ status: string; conflicted?: boolean }> = ({
  status,
  conflicted,
}) => {
  const s = conflicted ? "U" : status || "M";
  let classes = "bg-[#dbeafe] text-[#0284c7]";
  let title = "Modified";

  switch (s) {
    case "A":
    case "?":
      classes = "bg-[#dcfce7] text-[#16a34a]";
      title = s === "?" ? "Added (Untracked)" : "Added";
      break;
    case "D":
      classes = "bg-[#fee2e2] text-[#dc2626]";
      title = "Deleted";
      break;
    case "R":
    case "C":
      classes = "bg-[#ede9fe] text-[#7c3aed]";
      title = "Renamed";
      break;
    case "U":
      classes = "bg-[#dc2626] text-white";
      title = "Conflicted";
      break;
    case "M":
    default:
      classes = "bg-[#dbeafe] text-[#0284c7]";
      title = "Modified";
      break;
  }

  return (
    <span
      title={title}
      className={`w-4 h-4 shrink-0 inline-flex items-center justify-center rounded text-[10px] font-bold font-mono ${classes}`}
    >
      {s === "?" ? "A" : s}
    </span>
  );
};
