/**
 * In-Memory Compact Index and Fast Filtering for Types Dataset
 * Provides sub-millisecond evaluation across 100K+ channels with minimal memory overhead (~5MB).
 */

import type { CompactChannelRecord, ClassifiedChannel } from "./indexedDbTypes";
import type { ParsedFilterCriteria } from "./systemoneFilter";

export interface FilterOptions {
  searchQuery?: string;
  selectedTopic?: string;
  selectedCountry?: string;
  domesticPreset?: "all" | "high" | "mid" | "low";
  domesticMinScore?: number;
  readValuePreset?: "all" | "critical" | "substantive" | "background" | "low" | "hasReadValue" | "legacyOnly" | "custom";
  readValueMinScore?: number;
  activeNlFilter?: ParsedFilterCriteria | null;
  sortBy?: "aiRelevance" | "readValDesc" | "readValAsc" | "topicConf" | "countryConf" | "domesticDesc" | "domesticAsc" | "channelAsc" | "latencyAsc";
}

/**
 * Converts a heavy ClassifiedChannel into a lightweight CompactChannelRecord.
 */
export function toCompactRecord(item: ClassifiedChannel): CompactChannelRecord {
  return {
    channel: item.channel.replace(/^@/, "").trim().toLowerCase(),
    topic: item.topic || "unknown",
    country: item.country || "unknown",
    topicConf: Number(item.topicConf || 0),
    countryConf: Number(item.countryConf || 0),
    domestic: Number(item.domestic || 0),
    hasReadValue: Boolean(item.hasReadValue),
    readValueScore: item.readValueScore !== undefined ? item.readValueScore : null,
    latencyMs: Number(item.latencyMs || 0)
  };
}

/**
 * Evaluates whether a compact record matches Natural Language filter criteria.
 */
export function matchesNlCriteria(
  record: CompactChannelRecord,
  filter: ParsedFilterCriteria
): boolean {
  // 1. Topic
  const activeTopics = (filter.targetTopics && filter.targetTopics.length > 0)
    ? filter.targetTopics
    : (filter.topic ? [filter.topic] : []);

  if (activeTopics.length > 0) {
    if (!activeTopics.includes(record.topic)) {
      return false;
    }
  }

  // 2. Region / Country
  if (filter.targetRegions && filter.targetRegions.length > 0) {
    if (!filter.targetRegions.includes(record.country)) {
      return false;
    }
  }

  // 3. Domestic Orientation
  if (filter.domesticOrientation) {
    if (filter.domesticOrientation === "domestic" && record.domestic < 0.5) {
      return false;
    } else if (filter.domesticOrientation === "external" && record.domestic >= 0.5) {
      return false;
    }
  }

  // 4. Read Value
  if (filter.minReadValue !== null && filter.minReadValue !== undefined) {
    if (!record.hasReadValue || (record.readValueScore ?? 0) < filter.minReadValue) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates whether a compact record satisfies all UI filters.
 */
export function matchesCompactFilter(
  record: CompactChannelRecord,
  options: FilterOptions
): boolean {
  const {
    searchQuery,
    selectedTopic,
    selectedCountry,
    domesticPreset = "all",
    domesticMinScore = 0,
    readValuePreset = "all",
    readValueMinScore = 0,
    activeNlFilter
  } = options;

  // 0. Natural Language Filter
  if (activeNlFilter && !matchesNlCriteria(record, activeNlFilter)) {
    return false;
  }

  // 1. Channel Search
  if (searchQuery && !record.channel.includes(searchQuery)) {
    return false;
  }

  // 2. Topic Filter
  if (selectedTopic && selectedTopic !== "all" && record.topic !== selectedTopic) {
    return false;
  }

  // 3. Country Filter
  if (selectedCountry && selectedCountry !== "all" && record.country !== selectedCountry) {
    return false;
  }

  // 4. Domestic Affairs Filter
  if (domesticPreset === "high" && record.domestic < 0.6) {
    return false;
  } else if (domesticPreset === "mid" && (record.domestic < 0.3 || record.domestic >= 0.6)) {
    return false;
  } else if (domesticPreset === "low" && record.domestic >= 0.3) {
    return false;
  } else if (domesticPreset === "all" && domesticMinScore > 0 && record.domestic < domesticMinScore) {
    return false;
  }

  // 5. Read Value Filter
  if (readValuePreset === "critical") {
    if (!record.hasReadValue || (record.readValueScore ?? 0) < 2.2) return false;
  } else if (readValuePreset === "substantive") {
    if (!record.hasReadValue || (record.readValueScore ?? 0) < 1.5) return false;
  } else if (readValuePreset === "background") {
    if (!record.hasReadValue || (record.readValueScore ?? 0) < 0.8) return false;
  } else if (readValuePreset === "low") {
    if (!record.hasReadValue || (record.readValueScore ?? 0) >= 0.8) return false;
  } else if (readValuePreset === "hasReadValue") {
    if (!record.hasReadValue) return false;
  } else if (readValuePreset === "legacyOnly") {
    if (record.hasReadValue) return false;
  } else if (readValueMinScore > 0) {
    if (!record.hasReadValue || (record.readValueScore ?? 0) < readValueMinScore) return false;
  }

  return true;
}

/**
 * Sort comparator for compact channel records.
 */
export function compareCompactRecords(
  a: CompactChannelRecord,
  b: CompactChannelRecord,
  sortBy: string = "readValDesc"
): number {
  if (sortBy === "readValDesc" || sortBy === "aiRelevance") {
    const valA = a.hasReadValue && a.readValueScore !== null ? a.readValueScore : -1;
    const valB = b.hasReadValue && b.readValueScore !== null ? b.readValueScore : -1;
    if (valB !== valA) return valB - valA;
    return b.topicConf - a.topicConf;
  }
  if (sortBy === "readValAsc") {
    const valA = a.hasReadValue && a.readValueScore !== null ? a.readValueScore : 999;
    const valB = b.hasReadValue && b.readValueScore !== null ? b.readValueScore : 999;
    if (valA !== valB) return valA - valB;
    return a.topicConf - b.topicConf;
  }
  if (sortBy === "topicConf") return b.topicConf - a.topicConf;
  if (sortBy === "countryConf") return b.countryConf - a.countryConf;
  if (sortBy === "domesticDesc") return b.domestic - a.domestic;
  if (sortBy === "domesticAsc") return a.domestic - b.domestic;
  if (sortBy === "channelAsc") return a.channel.localeCompare(b.channel);
  if (sortBy === "latencyAsc") return a.latencyMs - b.latencyMs;
  return 0;
}
