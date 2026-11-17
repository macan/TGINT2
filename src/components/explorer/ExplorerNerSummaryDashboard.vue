<template>
  <div class="flex-1 min-w-0 overflow-y-auto bg-gray-50/50 dark:bg-gray-950/30 p-4 sm:p-5 space-y-4 custom-scrollbar">
    <!-- Empty state: No posts analyzed yet -->
    <div
      v-if="index.postsAnalyzed === 0"
      class="h-full min-h-[340px] flex flex-col items-center justify-center text-center px-6 py-12 bg-white dark:bg-gray-800/80 border border-gray-200/70 dark:border-gray-700/70 rounded-2xl"
    >
      <BarChart3 class="w-8 h-8 text-teal-600 dark:text-teal-400 mb-3 opacity-85" />
      <p class="text-sm font-semibold text-gray-800 dark:text-gray-100 max-w-md">
        {{
          totalPostsCount > 0
            ? t('explorer.ner.emptyReady', { count: totalPostsCount })
            : t('explorer.ner.emptyNoPosts')
        }}
      </p>
      <button
        v-if="totalPostsCount > 0 && !isExtracting"
        type="button"
        @click="$emit('extract')"
        class="mt-4 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
      >
        {{ t('explorer.ner.extract') }}
      </button>
    </div>

    <!-- Empty state: Filters match zero entities -->
    <div
      v-else-if="stats.kpis.uniqueEntities === 0"
      class="h-full min-h-[340px] flex flex-col items-center justify-center text-center px-6 py-12 bg-white dark:bg-gray-800/80 border border-gray-200/70 dark:border-gray-700/70 rounded-2xl"
    >
      <Filter class="w-7 h-7 text-gray-400 dark:text-gray-500 mb-3" />
      <p class="text-sm font-semibold text-gray-800 dark:text-gray-100">
        {{ t('explorer.ner.noFilterMatches') }}
      </p>
      <button
        v-if="hasActiveFilters"
        type="button"
        @click="$emit('clear-filters')"
        class="mt-4 px-3.5 py-1.5 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-xs font-semibold text-gray-800 dark:text-gray-100 transition-colors cursor-pointer whitespace-nowrap"
      >
        {{ t('explorer.ner.summaryResetFilters') }}
      </button>
    </div>

    <!-- Dashboard Content -->
    <template v-else>
      <!-- Top KPI Strip (single flat elevation with hairline dividers) -->
      <div class="bg-white dark:bg-gray-800/80 border border-gray-200/70 dark:border-gray-700/70 rounded-2xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 sm:divide-x divide-gray-200/70 dark:divide-gray-700/70">
        <div class="px-4 py-3.5 min-w-0">
          <div class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 truncate">
            {{ t('explorer.ner.summaryKpiEntities') }}
          </div>
          <div class="mt-1 flex items-baseline gap-2">
            <span class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white font-mono tabular-nums tracking-tight">
              {{ stats.kpis.uniqueEntities.toLocaleString() }}
            </span>
            <span
              v-if="stats.kpis.uniqueEntities !== stats.kpis.totalIndexEntities"
              class="text-[11px] font-mono tabular-nums text-gray-400 dark:text-gray-500"
            >
              / {{ stats.kpis.totalIndexEntities.toLocaleString() }}
            </span>
          </div>
          <div class="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 truncate font-mono tabular-nums">
            <template v-if="stats.kpis.dominantClass">
              {{ t(`explorer.ner.classes.${stats.kpis.dominantClass.classId}`) }} · {{ stats.kpis.dominantClass.mentionSharePercent }}%
            </template>
            <template v-else>—</template>
          </div>
        </div>

        <div class="px-4 py-3.5 min-w-0">
          <div class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 truncate">
            {{ t('explorer.ner.summaryKpiMentions') }}
          </div>
          <div class="mt-1 flex items-baseline gap-2">
            <span class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white font-mono tabular-nums tracking-tight">
              {{ stats.kpis.totalMentions.toLocaleString() }}
            </span>
            <span
              v-if="stats.kpis.totalMentions !== stats.kpis.totalIndexMentions"
              class="text-[11px] font-mono tabular-nums text-gray-400 dark:text-gray-500"
            >
              / {{ stats.kpis.totalIndexMentions.toLocaleString() }}
            </span>
          </div>
          <div class="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 truncate font-mono tabular-nums">
            {{ t('explorer.ner.summaryAvgPerEntity', { avg: stats.kpis.avgMentionsPerEntity }) }}
          </div>
        </div>

        <div class="px-4 py-3.5 min-w-0">
          <div class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 truncate">
            {{ t('explorer.ner.summaryKpiCoverage') }}
          </div>
          <div class="mt-1 flex items-baseline gap-2">
            <span class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white font-mono tabular-nums tracking-tight">
              {{ stats.kpis.coveragePercent }}%
            </span>
            <span class="text-[11px] font-mono tabular-nums text-gray-400 dark:text-gray-500">
              {{ stats.kpis.analyzedPostsCount.toLocaleString() }}/{{ stats.kpis.totalPostsCount.toLocaleString() }}
            </span>
          </div>
          <div class="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 truncate font-mono tabular-nums">
            {{ t('explorer.ner.matchingPostsCount', { count: stats.kpis.matchingPostsCount }) }}
          </div>
        </div>

        <div class="px-4 py-3.5 min-w-0">
          <div class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 truncate">
            {{ t('explorer.ner.summaryKpiRelations') }}
          </div>
          <div class="mt-1 flex items-baseline gap-2">
            <span class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white font-mono tabular-nums tracking-tight">
              {{ stats.kpis.filteredRelationsCount.toLocaleString() }}
            </span>
          </div>
          <div class="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 truncate font-mono tabular-nums">
            {{ stats.kpis.filteredOccurrencesCount.toLocaleString() }} {{ t('explorer.ner.timestampedClaims') }}
          </div>
        </div>
      </div>

      <!-- Row 1: Class Distribution Donut + Top Entities Frequency Bar Chart -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <!-- Entity Class Distribution -->
        <section class="lg:col-span-5 bg-white dark:bg-gray-800/80 border border-gray-200/70 dark:border-gray-700/70 rounded-2xl p-4 sm:p-5 flex flex-col">
          <div class="flex items-start justify-between gap-2 pb-3 border-b border-gray-100 dark:border-gray-700/60">
            <div class="min-w-0">
              <h3 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate">
                {{ t('explorer.ner.summaryClassDistribution') }}
              </h3>
              <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                {{ t('explorer.ner.summaryClickToFilterClass') }}
              </p>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              <button
                v-if="activeNerClassFilter !== 'all'"
                type="button"
                @click="$emit('toggle-class-filter', activeNerClassFilter)"
                class="px-2 py-1 rounded-lg border border-teal-500/40 text-[11px] font-semibold text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors cursor-pointer whitespace-nowrap"
              >
                {{ t('explorer.ner.summaryClearFilter') }}
              </button>
              <div class="inline-flex items-center p-0.5 bg-gray-100 dark:bg-gray-900/70 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
                <button
                  type="button"
                  @click="classMetric = 'mentions'"
                  :class="[
                    'px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap',
                    classMetric === 'mentions'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200',
                  ]"
                >
                  {{ t('explorer.ner.summaryMentionsMetric') }}
                </button>
                <button
                  type="button"
                  @click="classMetric = 'entities'"
                  :class="[
                    'px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap',
                    classMetric === 'entities'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200',
                  ]"
                >
                  {{ t('explorer.ner.summaryEntitiesMetric') }}
                </button>
              </div>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-4 items-center flex-1">
            <!-- SVG Donut -->
            <div class="sm:col-span-5 flex flex-col items-center justify-center">
              <div class="relative w-40 h-40 flex items-center justify-center">
                <svg
                  class="w-full h-full -rotate-90"
                  viewBox="0 0 180 180"
                  role="img"
                  :aria-label="t('explorer.ner.summaryClassDistribution')"
                  @mouseleave="hoveredClassId = null"
                >
                  <circle
                    cx="90"
                    cy="90"
                    :r="DONUT_RADIUS"
                    fill="none"
                    class="stroke-gray-100 dark:stroke-gray-700/50"
                    stroke-width="18"
                  />
                  <circle
                    v-for="item in stats.classDistribution"
                    :key="'donut-' + item.classId"
                    cx="90"
                    cy="90"
                    :r="DONUT_RADIUS"
                    fill="none"
                    :stroke="item.accentHex"
                    :stroke-width="isClassHighlighted(item.classId) ? 22 : 17"
                    :stroke-dasharray="classMetric === 'mentions' ? item.mentionsDashArray : item.entitiesDashArray"
                    :stroke-dashoffset="classMetric === 'mentions' ? item.mentionsDashOffset : item.entitiesDashOffset"
                    :opacity="activeDonutFocusId && activeDonutFocusId !== item.classId ? 0.32 : 1"
                    stroke-linecap="butt"
                    class="transition-all duration-200 cursor-pointer"
                    style="pointer-events: stroke;"
                    @mouseenter="hoveredClassId = item.classId"
                    @mouseleave="hoveredClassId = null"
                    @click="$emit('toggle-class-filter', item.classId)"
                  />
                  <circle
                    cx="90"
                    cy="90"
                    r="52"
                    fill="transparent"
                    style="pointer-events: fill;"
                    @mouseenter="hoveredClassId = null"
                  />
                </svg>

                <!-- Center Readout -->
                <div class="absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none select-none">
                  <template v-if="focusedClassStat">
                    <span
                      class="w-2 h-2 rounded-full mb-1"
                      :style="{ backgroundColor: focusedClassStat.accentHex }"
                    ></span>
                    <span class="text-[11px] font-bold text-gray-800 dark:text-gray-100 truncate max-w-[96px]">
                      {{ t(`explorer.ner.classes.${focusedClassStat.classId}`) }}
                    </span>
                    <span class="text-lg font-bold text-gray-900 dark:text-white font-mono tabular-nums leading-tight">
                      {{
                        (classMetric === 'mentions'
                          ? focusedClassStat.mentionCount
                          : focusedClassStat.entityCount
                        ).toLocaleString()
                      }}
                    </span>
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                      {{
                        classMetric === 'mentions'
                          ? focusedClassStat.mentionSharePercent
                          : focusedClassStat.entitySharePercent
                      }}%
                    </span>
                  </template>
                  <template v-else>
                    <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                      {{
                        classMetric === 'mentions'
                          ? t('explorer.ner.summaryMentionsMetric')
                          : t('explorer.ner.summaryEntitiesMetric')
                      }}
                    </span>
                    <span class="text-xl font-bold text-gray-900 dark:text-white font-mono tabular-nums leading-tight mt-0.5">
                      {{
                        (classMetric === 'mentions'
                          ? stats.kpis.totalMentions
                          : stats.kpis.uniqueEntities
                        ).toLocaleString()
                      }}
                    </span>
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 font-mono tabular-nums mt-0.5">
                      {{ stats.classDistribution.length }} {{ t('explorer.ner.summaryActiveClasses') }}
                    </span>
                  </template>
                </div>
              </div>
            </div>

            <!-- Ranked Class Breakdown List -->
            <div class="sm:col-span-7 divide-y divide-gray-100 dark:divide-gray-700/50 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
              <button
                v-for="item in sortedClassDistribution"
                :key="'cls-row-' + item.classId"
                type="button"
                @click="$emit('toggle-class-filter', item.classId)"
                @mouseenter="hoveredClassId = item.classId"
                @mouseleave="hoveredClassId = null"
                :class="[
                  'w-full py-2 px-2 rounded-lg text-left transition-colors cursor-pointer flex items-center justify-between gap-3',
                  activeNerClassFilter === item.classId
                    ? 'bg-teal-50/80 dark:bg-teal-950/30'
                    : hoveredClassId === item.classId
                      ? 'bg-gray-50 dark:bg-gray-900/50'
                      : '',
                ]"
              >
                <div class="min-w-0 flex-1 space-y-1">
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="w-2 h-2 rounded-full shrink-0"
                      :style="{ backgroundColor: item.accentHex }"
                    ></span>
                    <span class="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">
                      {{ t(`explorer.ner.classes.${item.classId}`) }}
                    </span>
                  </div>
                  <div class="h-1.5 w-full bg-gray-100 dark:bg-gray-700/60 rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-300"
                      :style="{
                        width: `${Math.max(2, classMetric === 'mentions' ? item.mentionSharePercent : item.entitySharePercent)}%`,
                        backgroundColor: item.accentHex,
                      }"
                    ></div>
                  </div>
                </div>

                <div class="text-right shrink-0 font-mono tabular-nums">
                  <div class="text-xs font-bold text-gray-900 dark:text-white">
                    {{
                      (classMetric === 'mentions' ? item.mentionCount : item.entityCount).toLocaleString()
                    }}
                  </div>
                  <div class="text-[10px] text-gray-500 dark:text-gray-400">
                    {{ classMetric === 'mentions' ? item.mentionSharePercent : item.entitySharePercent }}%
                  </div>
                </div>
              </button>
            </div>
          </div>
        </section>

        <!-- Top Entities by Frequency (Horizontal Ranked Bar Chart) -->
        <section class="lg:col-span-7 bg-white dark:bg-gray-800/80 border border-gray-200/70 dark:border-gray-700/70 rounded-2xl p-4 sm:p-5 flex flex-col">
          <div class="flex items-start justify-between gap-2 pb-3 border-b border-gray-100 dark:border-gray-700/60">
            <div class="min-w-0">
              <h3 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate">
                {{ t('explorer.ner.summaryTopEntities') }}
              </h3>
              <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                {{ t('explorer.ner.summaryClickEntityToInspect') }}
              </p>
            </div>

            <div class="inline-flex items-center p-0.5 bg-gray-100 dark:bg-gray-900/70 rounded-lg border border-gray-200/60 dark:border-gray-700/60 shrink-0">
              <button
                type="button"
                @click="entityMetric = 'mentions'"
                :class="[
                  'px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap',
                  entityMetric === 'mentions'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200',
                ]"
              >
                {{ t('explorer.ner.summaryMentionsMetric') }}
              </button>
              <button
                type="button"
                @click="entityMetric = 'posts'"
                :class="[
                  'px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap',
                  entityMetric === 'posts'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200',
                ]"
              >
                {{ t('explorer.ner.summaryPostsMetric') }}
              </button>
            </div>
          </div>

          <div class="mt-3 space-y-1.5 flex-1">
            <button
              v-for="(ent, idx) in activeTopEntities"
              :key="'top-ent-' + ent.id"
              type="button"
              @click="$emit('select-entity', ent.id)"
              :class="[
                'w-full px-2.5 py-1.5 rounded-xl text-left transition-colors cursor-pointer group flex items-center gap-3',
                selectedEntityId === ent.id
                  ? 'bg-teal-50/90 dark:bg-teal-950/35 ring-1 ring-teal-500/40'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-900/50',
              ]"
            >
              <span class="w-5 text-[11px] font-mono tabular-nums text-gray-400 dark:text-gray-500 shrink-0">
                {{ String(idx + 1).padStart(2, '0') }}
              </span>

              <div class="w-40 sm:w-48 min-w-0 shrink-0">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span
                    class="w-2 h-2 rounded-full shrink-0"
                    :style="{ backgroundColor: ent.accentHex }"
                  ></span>
                  <span class="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate group-hover:text-teal-700 dark:group-hover:text-teal-300">
                    {{ ent.canonicalName }}
                  </span>
                </div>
                <div class="text-[10px] text-gray-400 dark:text-gray-500 truncate pl-3.5">
                  {{ t(`explorer.ner.classes.${ent.nerClass}`) }}
                  <template v-if="ent.aliasCount > 0">
                    · +{{ ent.aliasCount }}
                  </template>
                </div>
              </div>

              <!-- Horizontal Proportional Bar -->
              <div class="flex-1 min-w-[60px] h-2.5 bg-gray-100 dark:bg-gray-700/50 rounded-md overflow-hidden">
                <div
                  class="h-full rounded-md transition-all duration-300"
                  :style="{
                    width: `${getEntityBarWidthPercent(ent)}%`,
                    backgroundColor: ent.accentHex,
                    opacity: selectedEntityId && selectedEntityId !== ent.id ? 0.65 : 0.9,
                  }"
                ></div>
              </div>

              <!-- Exact Value & Share -->
              <div class="w-24 text-right shrink-0 font-mono tabular-nums">
                <span class="text-xs font-bold text-gray-900 dark:text-white">
                  {{
                    (entityMetric === 'mentions' ? ent.mentionCount : ent.postCount).toLocaleString()
                  }}
                </span>
                <span class="text-[10px] text-gray-400 dark:text-gray-500 ml-1">
                  {{
                    entityMetric === 'mentions'
                      ? `${ent.mentionSharePercent}%`
                      : `${ent.postCoveragePercent}%`
                  }}
                </span>
              </div>
            </button>
          </div>
        </section>
      </div>

      <!-- Row 2: Mention Frequency Over Time + Frequency Histogram & Relation Distribution -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <!-- Mention Frequency Over Time (Stacked Chronological Chart) -->
        <section class="lg:col-span-7 bg-white dark:bg-gray-800/80 border border-gray-200/70 dark:border-gray-700/70 rounded-2xl p-4 sm:p-5 flex flex-col">
          <div class="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-gray-100 dark:border-gray-700/60">
            <div class="min-w-0">
              <h3 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate">
                {{ t('explorer.ner.summaryFrequencyTimeline') }}
              </h3>
              <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 font-mono tabular-nums">
                {{ temporalGranularityLabel }} · {{ stats.temporalSeries.length }} {{ t('explorer.ner.summaryBucketsUnit') }}
                <template v-if="stats.undatedMentionsCount > 0">
                  · {{ stats.undatedMentionsCount }} {{ t('explorer.ner.summaryUndated') }}
                </template>
              </p>
            </div>

            <!-- Hover Readout Bar (avoids occluded tooltips) -->
            <div
              v-if="activeTemporalBucket"
              class="text-[11px] font-mono tabular-nums text-gray-700 dark:text-gray-200 flex flex-wrap items-center gap-x-2 gap-y-0.5"
            >
              <span class="font-bold text-gray-900 dark:text-white">{{ activeTemporalBucket.key }}</span>
              <span aria-hidden="true" class="text-gray-400">·</span>
              <span>{{ activeTemporalBucket.mentionCount }} {{ t('explorer.ner.mentionsUnit') }}</span>
              <span aria-hidden="true" class="text-gray-400">·</span>
              <span>{{ activeTemporalBucket.uniqueEntityCount }} {{ t('explorer.ner.entitiesShort') }}</span>
              <template v-if="activeTemporalBucket.topEntityName">
                <span aria-hidden="true" class="text-gray-400">·</span>
                <span class="font-sans font-semibold text-teal-700 dark:text-teal-300 truncate max-w-[160px]">
                  {{ activeTemporalBucket.topEntityName }} ({{ activeTemporalBucket.topEntityMentions }})
                </span>
              </template>
            </div>
          </div>

          <div
            v-if="stats.temporalSeries.length === 0"
            class="flex-1 min-h-[210px] flex items-center justify-center text-xs text-gray-400 dark:text-gray-500"
          >
            {{ t('explorer.ner.summaryNoTemporalData') }}
          </div>

          <div v-else class="mt-4 relative flex-1 min-h-[220px]">
            <svg
              class="w-full h-56 overflow-visible select-none"
              :viewBox="`0 0 ${TIMELINE_SVG_W} ${TIMELINE_SVG_H}`"
              preserveAspectRatio="none"
              role="img"
              :aria-label="t('explorer.ner.summaryFrequencyTimeline')"
              @mouseleave="hoveredBucketIndex = null"
            >
              <!-- Horizontal Gridlines + Y-axis labels -->
              <g
                v-for="tick in timelineYAxisTicks"
                :key="'y-' + tick.value"
              >
                <line
                  :x1="TIMELINE_PAD_LEFT"
                  :x2="TIMELINE_SVG_W - TIMELINE_PAD_RIGHT"
                  :y1="tick.y"
                  :y2="tick.y"
                  class="stroke-gray-200/80 dark:stroke-gray-700/70"
                  stroke-width="1"
                  stroke-dasharray="3 3"
                />
                <text
                  :x="TIMELINE_PAD_LEFT - 6"
                  :y="tick.y + 3"
                  text-anchor="end"
                  class="fill-gray-400 dark:fill-gray-500 font-mono text-[10px]"
                >
                  {{ tick.value }}
                </text>
              </g>

              <!-- Stacked Class Columns -->
              <g
                v-for="bar in timelineBars"
                :key="'tbar-' + bar.bucket.key"
                class="cursor-pointer"
                @mouseenter="hoveredBucketIndex = bar.index"
                @mouseleave="hoveredBucketIndex = null"
              >
                <!-- Full-column hover hit zone -->
                <rect
                  :x="bar.hitX"
                  :y="TIMELINE_PAD_TOP"
                  :width="bar.hitWidth"
                  :height="TIMELINE_PLOT_H"
                  :fill="hoveredBucketIndex === bar.index ? 'rgba(20, 184, 166, 0.08)' : 'transparent'"
                  rx="2"
                />

                <!-- Stacked class segments -->
                <rect
                  v-for="(seg, sIdx) in bar.segments"
                  :key="'seg-' + bar.index + '-' + seg.classId + '-' + sIdx"
                  :x="bar.x"
                  :y="seg.y"
                  :width="bar.barWidth"
                  :height="seg.height"
                  :fill="seg.accentHex"
                  :opacity="hoveredBucketIndex !== null && hoveredBucketIndex !== bar.index ? 0.48 : 0.92"
                  :rx="sIdx === bar.segments.length - 1 ? 2 : 0"
                />

                <!-- X-axis tick label -->
                <text
                  v-if="bar.showLabel"
                  :x="bar.x + bar.barWidth / 2"
                  :y="TIMELINE_SVG_H - 6"
                  text-anchor="middle"
                  class="fill-gray-500 dark:fill-gray-400 font-mono text-[10px]"
                >
                  {{ bar.bucket.label }}
                </text>
              </g>
            </svg>
          </div>
        </section>

        <!-- Right Column: Frequency Distribution Histogram + Relation & Engine Breakdown -->
        <div class="lg:col-span-5 flex flex-col gap-4">
          <!-- Frequency Tier Distribution Histogram -->
          <section class="bg-white dark:bg-gray-800/80 border border-gray-200/70 dark:border-gray-700/70 rounded-2xl p-4 sm:p-5">
            <div class="pb-3 border-b border-gray-100 dark:border-gray-700/60">
              <h3 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white">
                {{ t('explorer.ner.summaryFrequencyHistogram') }}
              </h3>
              <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                {{ t('explorer.ner.summaryFrequencyHistogramHint') }}
              </p>
            </div>

            <div class="mt-3.5 space-y-2.5">
              <div
                v-for="bucket in stats.frequencyHistogram"
                :key="'hist-' + bucket.key"
                class="flex items-center gap-3 text-xs"
              >
                <span class="w-14 font-mono tabular-nums font-semibold text-gray-700 dark:text-gray-200 shrink-0">
                  {{ formatHistogramLabel(bucket.key) }}
                </span>

                <div class="flex-1 h-2.5 bg-gray-100 dark:bg-gray-700/50 rounded-md overflow-hidden">
                  <div
                    class="h-full bg-teal-600 dark:bg-teal-500 rounded-md transition-all duration-300"
                    :style="{ width: `${bucket.entitySharePercent}%` }"
                  ></div>
                </div>

                <div class="w-28 text-right font-mono tabular-nums shrink-0">
                  <span class="font-bold text-gray-900 dark:text-white">{{ bucket.entityCount }}</span>
                  <span class="text-[10px] text-gray-400 dark:text-gray-500 ml-1">
                    ({{ bucket.entitySharePercent }}%)
                  </span>
                </div>
              </div>
            </div>
          </section>

          <!-- Relation Types & Extraction Provenance -->
          <section class="bg-white dark:bg-gray-800/80 border border-gray-200/70 dark:border-gray-700/70 rounded-2xl p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
            <div>
              <div class="flex items-center justify-between gap-2 pb-2.5 border-b border-gray-100 dark:border-gray-700/60">
                <h3 class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white">
                  {{ t('explorer.ner.summaryRelationDistribution') }}
                </h3>
                <button
                  v-if="activeRelClassFilter !== 'all'"
                  type="button"
                  @click="$emit('toggle-relation-filter', activeRelClassFilter)"
                  class="text-[11px] font-semibold text-teal-700 dark:text-teal-300 hover:underline cursor-pointer"
                >
                  {{ t('explorer.ner.summaryClearFilter') }}
                </button>
              </div>

              <div
                v-if="stats.relationDistribution.length === 0"
                class="py-4 text-xs text-gray-400 dark:text-gray-500"
              >
                {{ t('explorer.ner.noFilterMatches') }}
              </div>

              <div v-else class="mt-2.5 space-y-1.5 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                <button
                  v-for="rel in stats.relationDistribution"
                  :key="'rel-dist-' + rel.relationClass"
                  type="button"
                  @click="$emit('toggle-relation-filter', rel.relationClass)"
                  :class="[
                    'w-full px-2 py-1.5 rounded-lg flex items-center justify-between gap-2.5 text-left transition-colors cursor-pointer',
                    activeRelClassFilter === rel.relationClass
                      ? 'bg-teal-50/80 dark:bg-teal-950/35'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-900/50',
                  ]"
                >
                  <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      class="w-2 h-2 rounded-full shrink-0"
                      :style="{ backgroundColor: rel.accentHex }"
                    ></span>
                    <span class="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">
                      {{ t(`explorer.ner.relations.${rel.relationClass}`) }}
                    </span>
                  </div>

                  <div class="w-20 h-1.5 bg-gray-100 dark:bg-gray-700/60 rounded-full overflow-hidden shrink-0">
                    <div
                      class="h-full rounded-full"
                      :style="{
                        width: `${Math.max(4, rel.occurrenceSharePercent)}%`,
                        backgroundColor: rel.accentHex,
                      }"
                    ></div>
                  </div>

                  <span class="w-16 text-right text-[11px] font-mono tabular-nums font-semibold text-gray-700 dark:text-gray-200 shrink-0">
                    {{ rel.occurrenceCount }} ({{ rel.occurrenceSharePercent }}%)
                  </span>
                </button>
              </div>
            </div>

            <!-- Engine Provenance Footer -->
            <div
              v-if="stats.engineBreakdown.length > 0"
              class="pt-3 border-t border-gray-100 dark:border-gray-700/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400"
            >
              <span class="font-semibold text-gray-700 dark:text-gray-300">
                {{ t('explorer.ner.extractionEngineLabel') }}:
              </span>
              <span
                v-for="(eng, eIdx) in stats.engineBreakdown"
                :key="'eng-' + eng.key"
                class="font-mono tabular-nums inline-flex items-center gap-1.5"
              >
                <span v-if="eIdx > 0" aria-hidden="true" class="text-gray-300 dark:text-gray-600">·</span>
                <span>{{ formatEngineLabel(eng.source) }}</span>
                <span class="text-gray-800 dark:text-gray-200 font-bold">{{ eng.entityCount }}</span>
              </span>
            </div>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { BarChart3, Filter } from "lucide-vue-next";
import { useI18n } from "../../i18n";
import type {
  AggregatedNerEntity,
  AggregatedNerIndex,
  AggregatedNerRelation,
  EntityEngineSource,
  NerClassId,
  PostNerExtractionRecord,
  RelationClassId,
} from "../../utils/explorerNer";
import {
  DONUT_RADIUS,
  computeNerSummaryDashboardStats,
  type HistogramBucketKey,
  type SummaryClassMetric,
  type SummaryEntityMetric,
  type TopEntityFrequencyStat,
} from "../../utils/nerSummaryStats";

const props = defineProps<{
  index: AggregatedNerIndex;
  filteredEntities: AggregatedNerEntity[];
  filteredRelations: AggregatedNerRelation[];
  rawRecords?: PostNerExtractionRecord[];
  totalPostsCount: number;
  isExtracting: boolean;
  activeNerClassFilter: "all" | NerClassId;
  activeRelClassFilter: "all" | RelationClassId;
  selectedEntityId: string | null;
  hasActiveFilters: boolean;
  dateFromMs: number;
  dateToMs: number;
  hasDateFrom: boolean;
  hasDateTo: boolean;
}>();

defineEmits<{
  (e: "select-entity", entityId: string): void;
  (e: "toggle-class-filter", classId: NerClassId): void;
  (e: "toggle-relation-filter", relClassId: RelationClassId): void;
  (e: "clear-filters"): void;
  (e: "extract"): void;
}>();

const { t } = useI18n();

const classMetric = ref<SummaryClassMetric>("mentions");
const entityMetric = ref<SummaryEntityMetric>("mentions");
const hoveredClassId = ref<NerClassId | null>(null);
const hoveredBucketIndex = ref<number | null>(null);

const stats = computed(() =>
  computeNerSummaryDashboardStats({
    index: props.index,
    filteredEntities: props.filteredEntities,
    filteredRelations: props.filteredRelations,
    rawRecords: props.rawRecords,
    totalPostsCount: props.totalPostsCount,
    dateFromMs: props.dateFromMs,
    dateToMs: props.dateToMs,
    hasDateFrom: props.hasDateFrom,
    hasDateTo: props.hasDateTo,
    topEntitiesLimit: 12,
  })
);

const sortedClassDistribution = computed(() => {
  const list = [...stats.value.classDistribution];
  if (classMetric.value === "entities") {
    list.sort((a, b) => b.entityCount - a.entityCount || b.mentionCount - a.mentionCount);
  } else {
    list.sort((a, b) => b.mentionCount - a.mentionCount || b.entityCount - a.entityCount);
  }
  return list;
});

const activeDonutFocusId = computed<NerClassId | null>(() => {
  if (hoveredClassId.value) return hoveredClassId.value;
  if (props.activeNerClassFilter !== "all") return props.activeNerClassFilter;
  return null;
});

const isClassHighlighted = (id: NerClassId) =>
  hoveredClassId.value === id || props.activeNerClassFilter === id;

const focusedClassStat = computed(() => {
  if (!activeDonutFocusId.value) return null;
  return (
    stats.value.classDistribution.find((c) => c.classId === activeDonutFocusId.value) || null
  );
});

const activeTopEntities = computed(() =>
  entityMetric.value === "posts"
    ? stats.value.topEntitiesByPosts
    : stats.value.topEntitiesByMentions
);

const maxTopEntityValue = computed(() => {
  const list = activeTopEntities.value;
  if (list.length === 0) return 1;
  return Math.max(
    1,
    ...list.map((e) => (entityMetric.value === "posts" ? e.postCount : e.mentionCount))
  );
});

const getEntityBarWidthPercent = (ent: TopEntityFrequencyStat): number => {
  const val = entityMetric.value === "posts" ? ent.postCount : ent.mentionCount;
  return Math.max(4, Math.round((val / maxTopEntityValue.value) * 100));
};

// Timeline SVG Geometry
const TIMELINE_SVG_W = 600;
const TIMELINE_SVG_H = 210;
const TIMELINE_PAD_LEFT = 36;
const TIMELINE_PAD_RIGHT = 10;
const TIMELINE_PAD_TOP = 12;
const TIMELINE_PAD_BOTTOM = 24;
const TIMELINE_PLOT_W = TIMELINE_SVG_W - TIMELINE_PAD_LEFT - TIMELINE_PAD_RIGHT;
const TIMELINE_PLOT_H = TIMELINE_SVG_H - TIMELINE_PAD_TOP - TIMELINE_PAD_BOTTOM;

const maxTimelineMentions = computed(() => {
  const maxVal = Math.max(1, ...stats.value.temporalSeries.map((b) => b.mentionCount));
  // Round up cleanly to nice step
  if (maxVal <= 5) return maxVal;
  if (maxVal <= 20) return Math.ceil(maxVal / 5) * 5;
  if (maxVal <= 100) return Math.ceil(maxVal / 10) * 10;
  return Math.ceil(maxVal / 25) * 25;
});

const timelineYAxisTicks = computed(() => {
  const maxVal = maxTimelineMentions.value;
  const steps = [0, 0.5, 1];
  return steps.map((ratio) => ({
    value: Math.round(maxVal * ratio),
    y: TIMELINE_PAD_TOP + TIMELINE_PLOT_H * (1 - ratio),
  }));
});

const timelineBars = computed(() => {
  const series = stats.value.temporalSeries;
  const n = series.length;
  if (n === 0) return [];

  const slotWidth = TIMELINE_PLOT_W / n;
  const barWidth = Math.min(28, Math.max(3, slotWidth * 0.68));
  const maxLabels = 7;
  const labelStride = Math.max(1, Math.ceil(n / maxLabels));
  const maxVal = maxTimelineMentions.value;

  return series.map((bucket, index) => {
    const slotX = TIMELINE_PAD_LEFT + index * slotWidth;
    const x = slotX + (slotWidth - barWidth) / 2;
    let cursorY = TIMELINE_PAD_TOP + TIMELINE_PLOT_H;
    const segments: Array<{
      classId: NerClassId;
      accentHex: string;
      y: number;
      height: number;
    }> = [];

    for (const seg of bucket.classSegments) {
      const segHeight = (seg.count / maxVal) * TIMELINE_PLOT_H;
      if (segHeight <= 0) continue;
      cursorY -= segHeight;
      segments.push({
        classId: seg.classId,
        accentHex: seg.accentHex,
        y: cursorY,
        height: Math.max(1, segHeight),
      });
    }

    const showLabel =
      n <= maxLabels || index === 0 || index === n - 1 || index % labelStride === 0;

    return {
      index,
      bucket,
      x,
      barWidth,
      hitX: slotX,
      hitWidth: slotWidth,
      segments,
      showLabel,
    };
  });
});

const activeTemporalBucket = computed(() => {
  const series = stats.value.temporalSeries;
  if (series.length === 0) return null;
  if (hoveredBucketIndex.value !== null && series[hoveredBucketIndex.value]) {
    return series[hoveredBucketIndex.value];
  }
  return series[series.length - 1];
});

const temporalGranularityLabel = computed(() => {
  if (stats.value.temporalGranularity === "month") {
    return t("explorer.ner.summaryGranularityMonth");
  }
  if (stats.value.temporalGranularity === "week") {
    return t("explorer.ner.summaryGranularityWeek");
  }
  return t("explorer.ner.summaryGranularityDay");
});

const formatHistogramLabel = (key: HistogramBucketKey): string => {
  if (key === "1") return "1×";
  if (key === "2_3") return "2–3×";
  if (key === "4_9") return "4–9×";
  if (key === "10_24") return "10–24×";
  return "25+×";
};

const formatEngineLabel = (src: EntityEngineSource): string => {
  if (src.engine === "manual") return t("explorer.ner.engineManual");
  if (src.engine === "gemini") return t("explorer.ner.engineAi");
  if (src.localTier === "ml") {
    if (src.mlModel === "cjk-bert") return "CJK BERT";
    if (src.mlModel === "gliner") return "GLiNER";
    return t("explorer.ner.engineNeuralLocalShort");
  }
  return t("explorer.ner.engineStructured");
};
</script>
