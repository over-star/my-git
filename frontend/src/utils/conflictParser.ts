export type ConflictChoice =
  | "unresolved"
  | "ours"
  | "theirs"
  | "both_ours_first"
  | "both_theirs_first"
  | "neither"
  | "custom";

export interface NormalSegment {
  kind: "normal";
  id: string;
  startLine: number;
  lines: string[];
}

export interface ConflictSegment {
  kind: "conflict";
  id: string;
  conflictIndex: number;
  startLine: number;
  endLine: number;
  oursLabel: string;
  baseLabel: string;
  theirsLabel: string;
  oursLines: string[];
  baseLines: string[];
  theirsLines: string[];
  choice: ConflictChoice;
  customLines: string[];
}

export type ConflictDocumentSegment = NormalSegment | ConflictSegment;

/**
 * Parses a git conflicted file text into ordered normal context segments and
 * interactive conflict segments. Supports standard 2-way markers as well as
 * diff3/zdiff3 base sections (|||||||).
 */
export function parseConflictDocument(rawText: string): ConflictDocumentSegment[] {
  const normalized = rawText.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const segments: ConflictDocumentSegment[] = [];

  let normalLines: string[] = [];
  let normalStart = 1;
  let state: "normal" | "ours" | "base" | "theirs" = "normal";
  let conflictIdx = 0;

  let curStart = 1;
  let oursLabel = "";
  let baseLabel = "";
  let theirsLabel = "";
  let oursLines: string[] = [];
  let baseLines: string[] = [];
  let theirsLines: string[] = [];
  let rawBlockLines: string[] = [];

  const flushNormal = () => {
    if (normalLines.length === 0) return;
    segments.push({
      kind: "normal",
      id: `normal-${segments.length}-${normalStart}`,
      startLine: normalStart,
      lines: normalLines,
    });
    normalLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (state === "normal") {
      if (line.startsWith("<<<<<<<")) {
        flushNormal();
        state = "ours";
        curStart = lineNo;
        oursLabel = line.slice(7).trim();
        baseLabel = "";
        theirsLabel = "";
        oursLines = [];
        baseLines = [];
        theirsLines = [];
        rawBlockLines = [line];
      } else {
        if (normalLines.length === 0) {
          normalStart = lineNo;
        }
        normalLines.push(line);
      }
      continue;
    }

    rawBlockLines.push(line);

    if (state === "ours" && line.startsWith("|||||||")) {
      state = "base";
      baseLabel = line.slice(7).trim();
    } else if ((state === "ours" || state === "base") && line.startsWith("=======")) {
      state = "theirs";
    } else if (state === "theirs" && line.startsWith(">>>>>>>")) {
      theirsLabel = line.slice(7).trim();
      segments.push({
        kind: "conflict",
        id: `conflict-${conflictIdx}`,
        conflictIndex: conflictIdx,
        startLine: curStart,
        endLine: lineNo,
        oursLabel,
        baseLabel,
        theirsLabel,
        oursLines,
        baseLines,
        theirsLines,
        choice: "unresolved",
        customLines: [...oursLines],
      });
      conflictIdx++;
      state = "normal";
      normalStart = lineNo + 1;
    } else if (state === "ours") {
      oursLines.push(line);
    } else if (state === "base") {
      baseLines.push(line);
    } else {
      theirsLines.push(line);
    }
  }

  // Graceful fallback if EOF was reached mid-marker
  if (state !== "normal" && rawBlockLines.length > 0) {
    if (normalLines.length === 0) {
      normalStart = curStart;
    }
    normalLines.push(...rawBlockLines);
  }
  flushNormal();

  return segments;
}

export function isSideSelected(
  choice: ConflictChoice,
  side: "ours" | "theirs"
): boolean {
  if (side === "ours") {
    return (
      choice === "ours" ||
      choice === "both_ours_first" ||
      choice === "both_theirs_first"
    );
  }
  return (
    choice === "theirs" ||
    choice === "both_ours_first" ||
    choice === "both_theirs_first"
  );
}

/**
 * Fork-style side checkbox toggle:
 * - Checking Ours alone => "ours"
 * - Checking Theirs after Ours => "both_ours_first"
 * - Checking Ours after Theirs => "both_theirs_first"
 * - Unchecking the only active side => "unresolved"
 */
export function toggleConflictSide(
  choice: ConflictChoice,
  side: "ours" | "theirs"
): ConflictChoice {
  const hasOurs = isSideSelected(choice, "ours");
  const hasTheirs = isSideSelected(choice, "theirs");

  if (side === "ours") {
    if (hasOurs) {
      return hasTheirs ? "theirs" : "unresolved";
    }
    return hasTheirs ? "both_theirs_first" : "ours";
  }

  if (hasTheirs) {
    return hasOurs ? "ours" : "unresolved";
  }
  return hasOurs ? "both_ours_first" : "theirs";
}

export function getConflictMarkerLines(seg: ConflictSegment): string[] {
  const out = [`<<<<<<< ${seg.oursLabel}`.trimEnd(), ...seg.oursLines];
  if (seg.baseLines.length > 0 || seg.baseLabel) {
    out.push(`||||||| ${seg.baseLabel}`.trimEnd(), ...seg.baseLines);
  }
  out.push(
    "=======",
    ...seg.theirsLines,
    `>>>>>>> ${seg.theirsLabel}`.trimEnd()
  );
  return out;
}

export function getSegmentResolvedLines(seg: ConflictDocumentSegment): string[] {
  if (seg.kind === "normal") return seg.lines;
  switch (seg.choice) {
    case "ours":
      return seg.oursLines;
    case "theirs":
      return seg.theirsLines;
    case "both_ours_first":
      return [...seg.oursLines, ...seg.theirsLines];
    case "both_theirs_first":
      return [...seg.theirsLines, ...seg.oursLines];
    case "neither":
      return [];
    case "custom":
      return seg.customLines;
    case "unresolved":
    default:
      return getConflictMarkerLines(seg);
  }
}

export function buildMergedText(segments: ConflictDocumentSegment[]): string {
  const out: string[] = [];
  for (const seg of segments) {
    out.push(...getSegmentResolvedLines(seg));
  }
  return out.join("\n");
}

export function hasConflictMarkers(text: string): boolean {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let hasStart = false;
  let hasMid = false;
  let hasEnd = false;
  for (const line of lines) {
    if (line.startsWith("<<<<<<<")) hasStart = true;
    else if (line.startsWith("=======")) hasMid = true;
    else if (line.startsWith(">>>>>>>")) hasEnd = true;
  }
  return hasStart && hasMid && hasEnd;
}
