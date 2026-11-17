import {
  NER_CLASSES,
  NER_CLASS_MAP,
  RELATION_CLASSES,
  RELATION_CLASS_MAP,
  normalizeEntityKey,
  type AggregatedNerEntity,
  type AggregatedNerIndex,
  type AggregatedNerRelation,
  type EntityEngineSource,
  type NerClassId,
  type PostNerExtractionRecord,
  type RelationClassId,
} from "./explorerNer";

export type SummaryClassMetric = "mentions" | "entities";
export type SummaryEntityMetric = "mentions" | "posts";
export type SummaryTimeGranularity = "day" | "week" | "month";

export interface ClassDistributionStat {
  classId: NerClassId;
  accentHex: string;
  entityCount: number;
  mentionCount: number;
  entitySharePercent: number;
  mentionSharePercent: number;
  avgMentionsPerEntity: number;
  entitiesDashArray: string;
  entitiesDashOffset: number;
  mentionsDashArray: string;
  mentionsDashOffset: number;
}

export interface TopEntityFrequencyStat {
  id: string;
  canonicalName: string;
  nerClass: NerClassId;
  accentHex: string;
  mentionCount: number;
  postCount: number;
  aliasCount: number;
  mentionSharePercent: number;
  postCoveragePercent: number;
  firstSeenMs: number;
  lastSeenMs: number;
  engines: EntityEngineSource[];
}

export type HistogramBucketKey = "1" | "2_3" | "4_9" | "10_24" | "25_plus";

export interface FrequencyHistogramBucket {
  key: HistogramBucketKey;
  entityCount: number;
  mentionCount: number;
  entitySharePercent: number;
  mentionSharePercent: number;
}

export interface TemporalClassSegment {
  classId: NerClassId;
  count: number;
  accentHex: string;
}

export interface TemporalMentionBucket {
  key: string;
  label: string;
  startMs: number;
  postCount: number;
  mentionCount: number;
  uniqueEntityCount: number;
  topEntityName: string;
  topEntityMentions: number;
  classSegments: TemporalClassSegment[];
}

export interface RelationDistributionStat {
  relationClass: RelationClassId;
  accentHex: string;
  relationCount: number;
  occurrenceCount: number;
  occurrenceSharePercent: number;
}

export interface EngineProvenanceStat {
  key: string;
  source: EntityEngineSource;
  entityCount: number;
  entitySharePercent: number;
}

export interface NerSummaryDashboardInput {
  index: AggregatedNerIndex;
  filteredEntities: AggregatedNerEntity[];
  filteredRelations: AggregatedNerRelation[];
  rawRecords?: PostNerExtractionRecord[];
  totalPostsCount: number;
  dateFromMs?: number;
  dateToMs?: number;
  hasDateFrom?: boolean;
  hasDateTo?: boolean;
  topEntitiesLimit?: number;
}

export interface NerSummaryDashboardStats {
  donutCircumference: number;
  kpis: {
    uniqueEntities: number;
    totalIndexEntities: number;
    totalMentions: number;
    totalIndexMentions: number;
    analyzedPostsCount: number;
    matchingPostsCount: number;
    totalPostsCount: number;
    coveragePercent: number;
    filteredRelationsCount: number;
    filteredOccurrencesCount: number;
    avgMentionsPerEntity: number;
    dominantClass: {
      classId: NerClassId;
      mentionSharePercent: number;
      entitySharePercent: number;
    } | null;
  };
  classDistribution: ClassDistributionStat[];
  topEntitiesByMentions: TopEntityFrequencyStat[];
  topEntitiesByPosts: TopEntityFrequencyStat[];
  frequencyHistogram: FrequencyHistogramBucket[];
  temporalGranularity: SummaryTimeGranularity;
  temporalSeries: TemporalMentionBucket[];
  undatedMentionsCount: number;
  relationDistribution: RelationDistributionStat[];
  engineBreakdown: EngineProvenanceStat[];
}

export const DONUT_RADIUS = 66;
export const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

const roundOneDecimal = (val: number): number => Math.round(val * 10) / 10;

function getUtcWeekStartMs(ms: number): number {
  const d = new Date(ms);
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dayOfWeek = new Date(utcMidnight).getUTCDay(); // 0=Sun..6=Sat
  const isoOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday start
  return utcMidnight - isoOffset * 86_400_000;
}

function getBucketMeta(
  ms: number,
  granularity: SummaryTimeGranularity
): { key: string; label: string; startMs: number } {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");

  if (granularity === "month") {
    const startMs = Date.UTC(yyyy, d.getUTCMonth(), 1);
    return { key: `${yyyy}-${mm}`, label: `${yyyy}-${mm}`, startMs };
  }
  if (granularity === "week") {
    const startMs = getUtcWeekStartMs(ms);
    const wd = new Date(startMs);
    const wmm = String(wd.getUTCMonth() + 1).padStart(2, "0");
    const wdd = String(wd.getUTCDate()).padStart(2, "0");
    const key = `${wd.getUTCFullYear()}-${wmm}-${wdd}`;
    return { key, label: `${wmm}/${wdd}`, startMs };
  }
  const startMs = Date.UTC(yyyy, d.getUTCMonth(), d.getUTCDate());
  return { key: `${yyyy}-${mm}-${dd}`, label: `${mm}/${dd}`, startMs };
}

function chooseGranularity(minMs: number, maxMs: number): SummaryTimeGranularity {
  const spanDays = Math.max(0, (maxMs - minMs) / 86_400_000);
  if (spanDays <= 35) return "day";
  if (spanDays <= 180) return "week";
  return "month";
}

export function computeNerSummaryDashboardStats(
  input: NerSummaryDashboardInput
): NerSummaryDashboardStats {
  const {
    index,
    filteredEntities,
    filteredRelations,
    rawRecords = [],
    totalPostsCount,
    dateFromMs = 0,
    dateToMs = Infinity,
    hasDateFrom = false,
    hasDateTo = false,
    topEntitiesLimit = 12,
  } = input;

  const uniqueEntities = filteredEntities.length;
  let totalMentions = 0;
  const matchingPostKeySet = new Set<string>();

  const classMap = new Map<
    NerClassId,
    { entityCount: number; mentionCount: number }
  >();
  for (const cls of NER_CLASSES) {
    classMap.set(cls.id, { entityCount: 0, mentionCount: 0 });
  }

  for (const ent of filteredEntities) {
    totalMentions += ent.mentionCount;
    for (const pk of ent.postKeys) {
      matchingPostKeySet.add(pk);
    }
    const bucket = classMap.get(ent.nerClass);
    if (bucket) {
      bucket.entityCount += 1;
      bucket.mentionCount += ent.mentionCount;
    }
  }

  // Class distribution with dual SVG arc coordinates
  const rawClassStats = NER_CLASSES.map((cls) => {
    const counts = classMap.get(cls.id)!;
    const entityShare = uniqueEntities > 0 ? (counts.entityCount / uniqueEntities) * 100 : 0;
    const mentionShare = totalMentions > 0 ? (counts.mentionCount / totalMentions) * 100 : 0;
    return {
      classId: cls.id,
      accentHex: cls.accentHex,
      entityCount: counts.entityCount,
      mentionCount: counts.mentionCount,
      entitySharePercent: roundOneDecimal(entityShare),
      mentionSharePercent: roundOneDecimal(mentionShare),
      avgMentionsPerEntity:
        counts.entityCount > 0
          ? roundOneDecimal(counts.mentionCount / counts.entityCount)
          : 0,
      entitiesDashArray: `0 ${DONUT_CIRCUMFERENCE}`,
      entitiesDashOffset: 0,
      mentionsDashArray: `0 ${DONUT_CIRCUMFERENCE}`,
      mentionsDashOffset: 0,
    };
  })
    .filter((c) => c.entityCount > 0 || c.mentionCount > 0)
    .sort((a, b) => b.mentionCount - a.mentionCount || b.entityCount - a.entityCount);

  let entOffset = 0;
  let menOffset = 0;
  for (const item of rawClassStats) {
    const entFraction = uniqueEntities > 0 ? item.entityCount / uniqueEntities : 0;
    const entArc = entFraction * DONUT_CIRCUMFERENCE;
    item.entitiesDashArray = `${entArc} ${Math.max(0, DONUT_CIRCUMFERENCE - entArc)}`;
    item.entitiesDashOffset = -entOffset;
    entOffset += entArc;

    const menFraction = totalMentions > 0 ? item.mentionCount / totalMentions : 0;
    const menArc = menFraction * DONUT_CIRCUMFERENCE;
    item.mentionsDashArray = `${menArc} ${Math.max(0, DONUT_CIRCUMFERENCE - menArc)}`;
    item.mentionsDashOffset = -menOffset;
    menOffset += menArc;
  }

  const dominantClass =
    rawClassStats.length > 0
      ? {
          classId: rawClassStats[0].classId,
          mentionSharePercent: rawClassStats[0].mentionSharePercent,
          entitySharePercent: rawClassStats[0].entitySharePercent,
        }
      : null;

  // Top entities rankings (mentions vs distinct posts)
  const analyzedDenominator = Math.max(1, index.postsAnalyzed || totalPostsCount || 1);
  const mapTopEntity = (ent: AggregatedNerEntity): TopEntityFrequencyStat => ({
    id: ent.id,
    canonicalName: ent.canonicalName,
    nerClass: ent.nerClass,
    accentHex: NER_CLASS_MAP.get(ent.nerClass)?.accentHex || "#64748b",
    mentionCount: ent.mentionCount,
    postCount: ent.postKeys.length,
    aliasCount: ent.aliases.filter((a) => a !== ent.canonicalName).length,
    mentionSharePercent:
      totalMentions > 0 ? roundOneDecimal((ent.mentionCount / totalMentions) * 100) : 0,
    postCoveragePercent: roundOneDecimal((ent.postKeys.length / analyzedDenominator) * 100),
    firstSeenMs: ent.firstSeenMs,
    lastSeenMs: ent.lastSeenMs,
    engines: ent.engines,
  });

  const topEntitiesByMentions = [...filteredEntities]
    .sort(
      (a, b) =>
        b.mentionCount - a.mentionCount ||
        b.postKeys.length - a.postKeys.length ||
        a.canonicalName.localeCompare(b.canonicalName)
    )
    .slice(0, topEntitiesLimit)
    .map(mapTopEntity);

  const topEntitiesByPosts = [...filteredEntities]
    .sort(
      (a, b) =>
        b.postKeys.length - a.postKeys.length ||
        b.mentionCount - a.mentionCount ||
        a.canonicalName.localeCompare(b.canonicalName)
    )
    .slice(0, topEntitiesLimit)
    .map(mapTopEntity);

  // Frequency distribution histogram (long-tail buckets)
  const histogramDefs: Array<{
    key: HistogramBucketKey;
    match: (mentions: number) => boolean;
  }> = [
    { key: "1", match: (m) => m <= 1 },
    { key: "2_3", match: (m) => m >= 2 && m <= 3 },
    { key: "4_9", match: (m) => m >= 4 && m <= 9 },
    { key: "10_24", match: (m) => m >= 10 && m <= 24 },
    { key: "25_plus", match: (m) => m >= 25 },
  ];

  const histAccumulator = histogramDefs.map((def) => ({
    key: def.key,
    match: def.match,
    entityCount: 0,
    mentionCount: 0,
  }));

  for (const ent of filteredEntities) {
    const target = histAccumulator.find((b) => b.match(ent.mentionCount));
    if (target) {
      target.entityCount += 1;
      target.mentionCount += ent.mentionCount;
    }
  }

  const frequencyHistogram: FrequencyHistogramBucket[] = histAccumulator.map((b) => ({
    key: b.key,
    entityCount: b.entityCount,
    mentionCount: b.mentionCount,
    entitySharePercent:
      uniqueEntities > 0 ? roundOneDecimal((b.entityCount / uniqueEntities) * 100) : 0,
    mentionSharePercent:
      totalMentions > 0 ? roundOneDecimal((b.mentionCount / totalMentions) * 100) : 0,
  }));

  // Temporal mention frequency series from rawRecords matching filteredEntities
  const filteredEntityIdSet = new Set(filteredEntities.map((e) => e.id));
  const entityNameById = new Map(filteredEntities.map((e) => [e.id, e.canonicalName]));

  interface MatchedPostMentionEvent {
    postKey: string;
    timestampMs: number;
    entityIds: string[];
    entityClasses: NerClassId[];
  }

  const matchedEvents: MatchedPostMentionEvent[] = [];
  let minTs = Infinity;
  let maxTs = -Infinity;
  let undatedMentionsCount = 0;

  for (const rec of rawRecords) {
    const ts = Number(rec.timestampMs) || 0;
    if (hasDateFrom && ts > 0 && ts < dateFromMs) continue;
    if (hasDateTo && ts > 0 && ts > dateToMs) continue;

    const entityIds: string[] = [];
    const entityClasses: NerClassId[] = [];

    const pushIfIncluded = (nerClass: NerClassId, name: string) => {
      const id = normalizeEntityKey(nerClass, name);
      if (filteredEntityIdSet.has(id)) {
        entityIds.push(id);
        entityClasses.push(nerClass);
      }
    };

    for (const ent of rec.entities || []) {
      pushIfIncluded(ent.nerClass, ent.canonical || ent.name);
    }
    for (const rel of rec.relations || []) {
      pushIfIncluded(rel.subjectClass, rel.subject);
      pushIfIncluded(rel.objectClass, rel.object);
    }

    if (entityIds.length === 0) continue;

    if (ts > 0) {
      if (ts < minTs) minTs = ts;
      if (ts > maxTs) maxTs = ts;
      matchedEvents.push({
        postKey: rec.postKey,
        timestampMs: ts,
        entityIds,
        entityClasses,
      });
    } else {
      undatedMentionsCount += entityIds.length;
    }
  }

  const temporalGranularity: SummaryTimeGranularity =
    matchedEvents.length > 0 && minTs < Infinity && maxTs > -Infinity
      ? chooseGranularity(minTs, maxTs)
      : "day";

  const bucketMap = new Map<
    string,
    {
      key: string;
      label: string;
      startMs: number;
      postKeys: Set<string>;
      mentionCount: number;
      entityCounts: Map<string, number>;
      classCounts: Map<NerClassId, number>;
    }
  >();

  for (const ev of matchedEvents) {
    const meta = getBucketMeta(ev.timestampMs, temporalGranularity);
    let bucket = bucketMap.get(meta.key);
    if (!bucket) {
      bucket = {
        key: meta.key,
        label: meta.label,
        startMs: meta.startMs,
        postKeys: new Set(),
        mentionCount: 0,
        entityCounts: new Map(),
        classCounts: new Map(),
      };
      bucketMap.set(meta.key, bucket);
    }
    bucket.postKeys.add(ev.postKey);
    bucket.mentionCount += ev.entityIds.length;

    for (let i = 0; i < ev.entityIds.length; i++) {
      const eid = ev.entityIds[i];
      const cls = ev.entityClasses[i];
      bucket.entityCounts.set(eid, (bucket.entityCounts.get(eid) || 0) + 1);
      bucket.classCounts.set(cls, (bucket.classCounts.get(cls) || 0) + 1);
    }
  }

  const temporalSeries: TemporalMentionBucket[] = Array.from(bucketMap.values())
    .sort((a, b) => a.startMs - b.startMs)
    .map((b) => {
      let topEntityId = "";
      let topEntityMentions = 0;
      for (const [eid, count] of b.entityCounts.entries()) {
        if (count > topEntityMentions) {
          topEntityMentions = count;
          topEntityId = eid;
        }
      }
      const classSegments: TemporalClassSegment[] = Array.from(b.classCounts.entries())
        .sort((a, b2) => b2[1] - a[1])
        .map(([classId, count]) => ({
          classId,
          count,
          accentHex: NER_CLASS_MAP.get(classId)?.accentHex || "#64748b",
        }));

      return {
        key: b.key,
        label: b.label,
        startMs: b.startMs,
        postCount: b.postKeys.size,
        mentionCount: b.mentionCount,
        uniqueEntityCount: b.entityCounts.size,
        topEntityName: entityNameById.get(topEntityId) || "",
        topEntityMentions,
        classSegments,
      };
    });

  // Relation type distribution
  const relAccumulator = new Map<
    RelationClassId,
    { relationCount: number; occurrenceCount: number }
  >();
  for (const relCls of RELATION_CLASSES) {
    relAccumulator.set(relCls.id, { relationCount: 0, occurrenceCount: 0 });
  }
  let filteredOccurrencesCount = 0;
  for (const rel of filteredRelations) {
    filteredOccurrencesCount += rel.occurrences.length;
    const entry = relAccumulator.get(rel.relationClass);
    if (entry) {
      entry.relationCount += 1;
      entry.occurrenceCount += rel.occurrences.length;
    }
  }

  const relationDistribution: RelationDistributionStat[] = RELATION_CLASSES.map((rc) => {
    const data = relAccumulator.get(rc.id)!;
    return {
      relationClass: rc.id,
      accentHex: RELATION_CLASS_MAP.get(rc.id)?.accentHex || "#64748b",
      relationCount: data.relationCount,
      occurrenceCount: data.occurrenceCount,
      occurrenceSharePercent:
        filteredOccurrencesCount > 0
          ? roundOneDecimal((data.occurrenceCount / filteredOccurrencesCount) * 100)
          : 0,
    };
  })
    .filter((r) => r.relationCount > 0 || r.occurrenceCount > 0)
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || b.relationCount - a.relationCount);

  // Deduplicated extraction engine breakdown across filtered entities
  const engineStatsMap = new Map<
    string,
    { source: EntityEngineSource; entityCount: number }
  >();
  for (const ent of filteredEntities) {
    for (const src of ent.engines || []) {
      const existing = engineStatsMap.get(src.key);
      if (existing) {
        existing.entityCount += 1;
      } else {
        engineStatsMap.set(src.key, { source: src, entityCount: 1 });
      }
    }
  }
  const engineBreakdown: EngineProvenanceStat[] = Array.from(engineStatsMap.entries())
    .map(([key, data]) => ({
      key,
      source: data.source,
      entityCount: data.entityCount,
      entitySharePercent:
        uniqueEntities > 0 ? roundOneDecimal((data.entityCount / uniqueEntities) * 100) : 0,
    }))
    .sort((a, b) => b.entityCount - a.entityCount);

  const coveragePercent =
    totalPostsCount > 0
      ? Math.min(100, roundOneDecimal((index.postsAnalyzed / totalPostsCount) * 100))
      : 0;

  return {
    donutCircumference: DONUT_CIRCUMFERENCE,
    kpis: {
      uniqueEntities,
      totalIndexEntities: index.entities.length,
      totalMentions,
      totalIndexMentions: index.totalMentions,
      analyzedPostsCount: index.postsAnalyzed,
      matchingPostsCount: matchingPostKeySet.size,
      totalPostsCount,
      coveragePercent,
      filteredRelationsCount: filteredRelations.length,
      filteredOccurrencesCount,
      avgMentionsPerEntity:
        uniqueEntities > 0 ? roundOneDecimal(totalMentions / uniqueEntities) : 0,
      dominantClass,
    },
    classDistribution: rawClassStats,
    topEntitiesByMentions,
    topEntitiesByPosts,
    frequencyHistogram,
    temporalGranularity,
    temporalSeries,
    undatedMentionsCount,
    relationDistribution,
    engineBreakdown,
  };
}
