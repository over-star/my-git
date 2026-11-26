export interface LayoutPrefs {
  sidebarWidth: number;
  changesLeftRatio: number;
  changesUnstagedRatio: number;
  historyBottomRatio: number;
  historyDetailLeftRatio: number;
}

export const DEFAULT_LAYOUT: LayoutPrefs = {
  sidebarWidth: 296,
  changesLeftRatio: 0.34,
  changesUnstagedRatio: 0.5,
  historyBottomRatio: 0.46,
  historyDetailLeftRatio: 0.42,
};

const LAYOUT_CACHE_KEY = "gitpulse:layout:v1";

export function clamp(val: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, val));
}

function pickNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return clamp(value, min, max);
}

export function normalizeLayout(raw?: Partial<LayoutPrefs> | null): LayoutPrefs {
  if (!raw) return { ...DEFAULT_LAYOUT };
  return {
    sidebarWidth: Math.round(
      pickNumber(raw.sidebarWidth, DEFAULT_LAYOUT.sidebarWidth, 200, 560)
    ),
    changesLeftRatio: pickNumber(
      raw.changesLeftRatio,
      DEFAULT_LAYOUT.changesLeftRatio,
      0.18,
      0.65
    ),
    changesUnstagedRatio: pickNumber(
      raw.changesUnstagedRatio,
      DEFAULT_LAYOUT.changesUnstagedRatio,
      0.15,
      0.85
    ),
    historyBottomRatio: pickNumber(
      raw.historyBottomRatio,
      DEFAULT_LAYOUT.historyBottomRatio,
      0.2,
      0.75
    ),
    historyDetailLeftRatio: pickNumber(
      raw.historyDetailLeftRatio,
      DEFAULT_LAYOUT.historyDetailLeftRatio,
      0.2,
      0.75
    ),
  };
}

export function hasPersistedLayout(raw?: Partial<LayoutPrefs> | null): boolean {
  if (!raw) return false;
  return (
    (raw.sidebarWidth ?? 0) > 0 ||
    (raw.changesLeftRatio ?? 0) > 0 ||
    (raw.changesUnstagedRatio ?? 0) > 0 ||
    (raw.historyBottomRatio ?? 0) > 0 ||
    (raw.historyDetailLeftRatio ?? 0) > 0
  );
}

export function loadCachedLayout(): LayoutPrefs {
  try {
    const str = window.localStorage.getItem(LAYOUT_CACHE_KEY);
    if (!str) return { ...DEFAULT_LAYOUT };
    return normalizeLayout(JSON.parse(str));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveCachedLayout(layout: LayoutPrefs): void {
  try {
    window.localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(layout));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}
