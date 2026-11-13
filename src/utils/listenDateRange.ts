export type ListenDatePreset = "all" | "1h" | "24h" | "3d" | "7d" | "30d" | "custom";

export interface ListenDateRangeValue {
  preset: ListenDatePreset;
  customStart: string; // YYYY-MM-DD (local)
  customEnd: string;   // YYYY-MM-DD (local)
}

export const DEFAULT_LISTEN_DATE_RANGE: ListenDateRangeValue = {
  preset: "all",
  customStart: "",
  customEnd: "",
};

export interface ListenDateBounds {
  startMs: number | null;
  endMs: number | null;
}

export const isListenDateRangeActive = (range?: ListenDateRangeValue | null): boolean => {
  if (!range || range.preset === "all") return false;
  if (range.preset === "custom") {
    return !!(range.customStart || range.customEnd);
  }
  return true;
};

export const getListenDateRangeBounds = (
  range?: ListenDateRangeValue | null,
  nowMs: number = Date.now()
): ListenDateBounds => {
  if (!range || range.preset === "all") {
    return { startMs: null, endMs: null };
  }

  switch (range.preset) {
    case "1h":
      return { startMs: nowMs - 1 * 60 * 60 * 1000, endMs: null };
    case "24h":
      return { startMs: nowMs - 24 * 60 * 60 * 1000, endMs: null };
    case "3d":
      return { startMs: nowMs - 3 * 24 * 60 * 60 * 1000, endMs: null };
    case "7d":
      return { startMs: nowMs - 7 * 24 * 60 * 60 * 1000, endMs: null };
    case "30d":
      return { startMs: nowMs - 30 * 24 * 60 * 60 * 1000, endMs: null };
    case "custom": {
      let startMs: number | null = null;
      let endMs: number | null = null;
      if (range.customStart) {
        const parsedStart = new Date(`${range.customStart}T00:00:00`).getTime();
        if (!isNaN(parsedStart)) startMs = parsedStart;
      }
      if (range.customEnd) {
        const parsedEnd = new Date(`${range.customEnd}T23:59:59.999`).getTime();
        if (!isNaN(parsedEnd)) endMs = parsedEnd;
      }
      if (startMs !== null && endMs !== null && startMs > endMs) {
        return { startMs: endMs, endMs: startMs };
      }
      return { startMs, endMs };
    }
    default:
      return { startMs: null, endMs: null };
  }
};

export const isTimestampInListenDateRange = (
  timestamp: number,
  bounds: ListenDateBounds
): boolean => {
  if (bounds.startMs === null && bounds.endMs === null) {
    return true;
  }
  if (!timestamp || timestamp <= 0) {
    return false;
  }
  if (bounds.startMs !== null && timestamp < bounds.startMs) {
    return false;
  }
  if (bounds.endMs !== null && timestamp > bounds.endMs) {
    return false;
  }
  return true;
};

export const loadSavedListenDateRange = (
  storageKey = "listen_date_range_filter"
): ListenDateRangeValue => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...DEFAULT_LISTEN_DATE_RANGE };
    const parsed = JSON.parse(raw);
    const validPresets: ListenDatePreset[] = ["all", "1h", "24h", "3d", "7d", "30d", "custom"];
    if (parsed && validPresets.includes(parsed.preset)) {
      return {
        preset: parsed.preset,
        customStart: typeof parsed.customStart === "string" ? parsed.customStart : "",
        customEnd: typeof parsed.customEnd === "string" ? parsed.customEnd : "",
      };
    }
  } catch {
    // Ignore storage parse error
  }
  return { ...DEFAULT_LISTEN_DATE_RANGE };
};
