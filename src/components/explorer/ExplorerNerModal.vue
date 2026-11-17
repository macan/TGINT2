<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 scale-95"
    enter-to-class="opacity-100 scale-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-95"
  >
    <div
      v-if="open"
      class="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-1.5 sm:p-2.5"
      @click="$emit('close')"
    >
      <div
        class="bg-white dark:bg-gray-800 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-[98vw] h-[96vh] flex flex-col overflow-hidden border border-gray-200/70 dark:border-gray-700/70"
        @click.stop
      >
        <!-- Modal Top Header -->
        <div class="px-5 py-3 border-b border-gray-200/70 dark:border-gray-700/70 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div class="min-w-0">
            <div class="flex items-center gap-2.5">
              <h2 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">
                {{ t('explorer.ner.modalTitle') }}
              </h2>
              <span
                v-if="channelName"
                class="text-xs font-mono text-gray-500 dark:text-gray-400 truncate"
              >
                @{{ channelName }}
              </span>
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums">
              <span>{{ index.entities.length }} {{ t('explorer.ner.entitiesShort') }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ index.relations.length }} {{ t('explorer.ner.relationsShort') }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ totalRelationOccurrences }} {{ t('explorer.ner.timestampedClaims') }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ index.postsAnalyzed }}/{{ totalPostsCount }} {{ t('explorer.ner.postsShort') }}</span>
              <template v-if="index.enginesUsed.size > 0">
                <span aria-hidden="true">·</span>
                <span>
                  {{
                    index.enginesUsed.has('gemini')
                      ? t('explorer.ner.engineAi')
                      : index.localTiersUsed?.has('ml')
                        ? t('explorer.ner.engineNeuralLocal')
                        : t('explorer.ner.engineStructured')
                  }}
                </span>
              </template>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button
              v-if="!isExtracting"
              type="button"
              @click="$emit('extract', false)"
              :disabled="totalPostsCount === 0"
              class="px-3.5 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white transition-colors disabled:opacity-45 cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <ScanSearch class="w-3.5 h-3.5" />
              <span>{{
                index.postsAnalyzed > 0 && uncachedCount > 0
                  ? t('explorer.ner.extractNew', { count: uncachedCount })
                  : t('explorer.ner.reExtract')
              }}</span>
            </button>
            <button
              v-else
              type="button"
              @click="$emit('cancel')"
              class="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <Square class="w-3.5 h-3.5" />
              <span>{{ t('explorer.ner.cancel') }}</span>
            </button>

            <button
              type="button"
              @click="$emit('close')"
              class="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-200 transition-colors cursor-pointer shrink-0"
              :title="t('search.closeFullScreen')"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Shared Mode Switcher + Filter Toolbar -->
        <div class="px-5 py-2.5 bg-gray-50/70 dark:bg-gray-900/40 border-b border-gray-200/70 dark:border-gray-700/70 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <!-- Mode Tabs -->
          <div class="flex items-center gap-1 p-1 bg-gray-200/70 dark:bg-gray-800 rounded-xl shrink-0 overflow-x-auto scrollbar-none">
            <button
              type="button"
              @click="modalMode = 'summary'"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5',
                modalMode === 'summary'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
              ]"
            >
              <BarChart3 class="w-3.5 h-3.5" />
              <span>{{ t('explorer.ner.modeSummary') }}</span>
            </button>
            <button
              type="button"
              @click="modalMode = 'directory'"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5',
                modalMode === 'directory'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
              ]"
            >
              <Table2 class="w-3.5 h-3.5" />
              <span>{{ t('explorer.ner.modeDirectory') }}</span>
            </button>
            <button
              type="button"
              @click="modalMode = 'graph'"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5',
                modalMode === 'graph'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
              ]"
            >
              <Network class="w-3.5 h-3.5" />
              <span>{{ t('explorer.ner.modeGraph') }}</span>
            </button>
            <button
              type="button"
              @click="modalMode = 'timeline'"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5',
                modalMode === 'timeline'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200',
              ]"
            >
              <Clock class="w-3.5 h-3.5" />
              <span>{{ t('explorer.ner.modeTimeline') }}</span>
            </button>
          </div>

          <!-- Shared Filter Controls -->
          <div class="flex flex-wrap items-center gap-2 flex-1 justify-end min-w-[260px]">
            <div class="relative flex items-center min-w-[180px] max-w-xs flex-1">
              <Search class="w-3.5 h-3.5 text-gray-400 absolute left-2.5 pointer-events-none" />
              <input
                v-model="query"
                type="text"
                :placeholder="t('explorer.ner.modalSearchPlaceholder')"
                class="w-full pl-8 pr-7 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-gray-900 dark:text-gray-100"
              />
              <button
                v-if="query"
                type="button"
                @click="query = ''"
                class="absolute right-2 text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X class="w-3.5 h-3.5" />
              </button>
            </div>

            <select
              v-model="nerClassFilter"
              class="px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 cursor-pointer"
            >
              <option value="all">{{ t('explorer.ner.allClasses') }}</option>
              <option v-for="cls in NER_CLASSES" :key="cls.id" :value="cls.id">
                {{ t(`explorer.ner.classes.${cls.id}`) }} ({{ index.classCounts[cls.id] || 0 }})
              </option>
            </select>

            <select
              v-model="relClassFilter"
              class="px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 cursor-pointer"
            >
              <option value="all">{{ t('explorer.ner.allRelations') }}</option>
              <option v-for="rel in RELATION_CLASSES" :key="rel.id" :value="rel.id">
                {{ t(`explorer.ner.relations.${rel.id}`) }} ({{ index.relationClassCounts[rel.id] || 0 }})
              </option>
            </select>

            <input
              v-model="dateFrom"
              type="date"
              class="px-2 py-1.5 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-200"
              :title="t('explorer.ner.dateFrom')"
            />
            <input
              v-model="dateTo"
              type="date"
              class="px-2 py-1.5 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-700 dark:text-gray-200"
              :title="t('explorer.ner.dateTo')"
            />

            <button
              v-if="modalMode === 'directory' && (postSummaries?.length || 0) > 0"
              type="button"
              @click="openCreateEntityDrawer"
              class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-teal-500 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:text-teal-700 dark:hover:text-teal-300 transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1"
            >
              <Plus class="w-3.5 h-3.5" />
              <span>{{ t('explorer.ner.addEntity') }}</span>
            </button>
          </div>
        </div>

        <datalist id="ner-entity-autocomplete">
          <option v-for="ent in index.entities" :key="ent.id" :value="ent.canonicalName">
            {{ t(`explorer.ner.classes.${ent.nerClass}`) }}
          </option>
        </datalist>

        <!-- Main Modal Body -->
        <div class="flex-1 min-h-0 flex overflow-hidden">
          <!-- MODE 0: SUMMARY DASHBOARD -->
          <ExplorerNerSummaryDashboard
            v-if="modalMode === 'summary'"
            :index="index"
            :filtered-entities="filteredDirectoryEntities"
            :filtered-relations="filteredRelations"
            :raw-records="rawRecords"
            :total-posts-count="totalPostsCount"
            :is-extracting="isExtracting"
            :active-ner-class-filter="nerClassFilter"
            :active-rel-class-filter="relClassFilter"
            :selected-entity-id="selectedInspectorEntityId"
            :has-active-filters="hasActiveModalFilters"
            :date-from-ms="dateRangeMs.start"
            :date-to-ms="dateRangeMs.end"
            :has-date-from="Boolean(dateFrom)"
            :has-date-to="Boolean(dateTo)"
            @select-entity="selectInspectorEntity"
            @toggle-class-filter="toggleSummaryClassFilter"
            @toggle-relation-filter="toggleSummaryRelationFilter"
            @clear-filters="clearModalFilters"
            @extract="$emit('extract', false)"
          />

          <!-- MODE 1: ENTITY DIRECTORY -->
          <template v-else-if="modalMode === 'directory'">
            <div class="flex-1 min-w-0 overflow-auto custom-scrollbar">
              <table class="w-full text-left border-collapse">
                <thead class="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-[11px] font-bold text-gray-500 dark:text-gray-400">
                  <tr>
                    <th class="py-2.5 px-4 cursor-pointer select-none whitespace-nowrap" @click="toggleDirSort('name')">
                      {{ t('explorer.ner.colEntity') }} {{ dirSortField === 'name' ? (dirSortAsc ? '↑' : '↓') : '' }}
                    </th>
                    <th class="py-2.5 px-3 whitespace-nowrap">{{ t('explorer.ner.colClass') }}</th>
                    <th class="py-2.5 px-3 text-right cursor-pointer select-none whitespace-nowrap" @click="toggleDirSort('mentions')">
                      {{ t('explorer.ner.colMentions') }} {{ dirSortField === 'mentions' ? (dirSortAsc ? '↑' : '↓') : '' }}
                    </th>
                    <th class="py-2.5 px-3 cursor-pointer select-none whitespace-nowrap" @click="toggleDirSort('firstSeen')">
                      {{ t('explorer.ner.colFirstSeen') }} {{ dirSortField === 'firstSeen' ? (dirSortAsc ? '↑' : '↓') : '' }}
                    </th>
                    <th class="py-2.5 px-3 cursor-pointer select-none whitespace-nowrap" @click="toggleDirSort('lastSeen')">
                      {{ t('explorer.ner.colLastSeen') }} {{ dirSortField === 'lastSeen' ? (dirSortAsc ? '↑' : '↓') : '' }}
                    </th>
                    <th class="py-2.5 px-4 text-right whitespace-nowrap">{{ t('explorer.ner.colActions') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-700/60 text-xs">
                  <tr
                    v-for="ent in filteredDirectoryEntities"
                    :key="ent.id"
                    @click="selectInspectorEntity(ent.id)"
                    :class="[
                      'h-10 transition-colors cursor-pointer',
                      selectedInspectorEntityId === ent.id
                        ? 'bg-teal-50/80 dark:bg-teal-950/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-900/40',
                    ]"
                  >
                    <td class="py-2 px-4 max-w-[260px]">
                      <div class="font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {{ ent.canonicalName }}
                      </div>
                      <div
                        v-if="ent.aliases.filter(a => a !== ent.canonicalName).length > 0"
                        class="text-[10px] text-gray-400 dark:text-gray-500 truncate"
                      >
                        {{ ent.aliases.filter(a => a !== ent.canonicalName).slice(0, 3).join(' · ') }}
                      </div>
                    </td>
                    <td class="py-2 px-3 whitespace-nowrap">
                      <span :class="['text-[11px] font-semibold', getNerMeta(ent.nerClass)?.textClass]">
                        {{ t(`explorer.ner.classes.${ent.nerClass}`) }}
                      </span>
                    </td>
                    <td class="py-2 px-3 text-right font-mono tabular-nums font-bold text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      {{ ent.mentionCount }}
                    </td>
                    <td class="py-2 px-3 font-mono tabular-nums text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {{ formatNerTimestamp(ent.firstSeenMs) }}
                    </td>
                    <td class="py-2 px-3 font-mono tabular-nums text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {{ formatNerTimestamp(ent.lastSeenMs) }}
                    </td>
                    <td class="py-2 px-4 text-right whitespace-nowrap" @click.stop>
                      <button
                        type="button"
                        @click="jumpToEntity(ent)"
                        class="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                      >
                        {{ t('explorer.ner.filterAndJump') }}
                      </button>
                    </td>
                  </tr>
                  <tr v-if="filteredDirectoryEntities.length === 0">
                    <td colspan="6" class="py-10 text-center text-xs text-gray-400 dark:text-gray-500">
                      {{ t('explorer.ner.noFilterMatches') }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <!-- MODE 2: INTERACTIVE ENTITY-RELATION GRAPH (Cytoscape + CoSE Worker) -->
          <template v-else-if="modalMode === 'graph'">
            <div ref="graphWrapperRef" class="flex-1 min-w-0 relative bg-gray-50/60 dark:bg-gray-950/60 overflow-hidden">
              <div ref="graphContainerRef" class="w-full h-full"></div>

              <!-- Graph Zoom Controls -->
              <div class="absolute top-3 right-3 z-10 flex items-center gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xs border border-gray-200/70 dark:border-gray-700 rounded-xl p-1 shadow-xs">
                <button
                  type="button"
                  @click="zoomGraph(1.25)"
                  class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 cursor-pointer"
                  :title="t('explorer.zoomIn')"
                >
                  <ZoomIn class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  @click="zoomGraph(0.8)"
                  class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 cursor-pointer"
                  :title="t('explorer.zoomOut')"
                >
                  <ZoomOut class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  @click="resetGraphLayout"
                  class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 cursor-pointer"
                  :title="t('explorer.resetView')"
                >
                  <RotateCcw class="w-4 h-4" />
                </button>
              </div>

              <!-- Legend Strip -->
              <div class="absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xs border border-gray-200/70 dark:border-gray-700 rounded-xl text-[10px] text-gray-500 dark:text-gray-400 pointer-events-none">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span v-for="cls in NER_CLASSES" :key="cls.id" class="inline-flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: cls.accentHex }"></span>
                    <span>{{ t(`explorer.ner.classes.${cls.id}`) }}</span>
                  </span>
                </div>
                <span class="inline-flex items-center gap-1.5 font-mono tabular-nums">
                  <Loader2 v-if="isGraphLayouting" class="w-3 h-3 animate-spin text-teal-600 dark:text-teal-400" />
                  <span>{{ graphNodesCount }} {{ t('explorer.ner.entitiesShort') }} · {{ graphEdgesCount }} {{ t('explorer.ner.relationsShort') }}</span>
                </span>
              </div>
            </div>
          </template>

          <!-- MODE 3: CHRONOLOGICAL TIMELINE -->
          <template v-else>
            <div class="flex-1 min-w-0 overflow-auto p-6 space-y-6 custom-scrollbar">
              <div class="flex items-center justify-between">
                <div class="text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                  {{ timelineGroups.reduce((acc, g) => acc + g.items.length, 0) }} {{ t('explorer.ner.timestampedClaims') }}
                </div>
                <button
                  type="button"
                  @click="timelineDesc = !timelineDesc"
                  class="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-gray-900 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-200/70 dark:hover:bg-gray-700 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {{ timelineDesc ? t('explorer.ner.newestFirst') : t('explorer.ner.oldestFirst') }}
                </button>
              </div>

              <div v-if="timelineGroups.length === 0" class="py-12 text-center text-xs text-gray-400 dark:text-gray-500">
                {{ t('explorer.ner.noTimelineMatches') }}
              </div>

              <div v-for="group in timelineGroups" :key="group.day" class="space-y-3">
                <div class="sticky top-0 z-10 py-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur-xs border-b border-gray-200/70 dark:border-gray-700 flex items-center justify-between">
                  <span class="text-xs font-mono font-bold text-gray-700 dark:text-gray-200 tabular-nums">
                    {{ group.day }}
                  </span>
                  <span class="text-[11px] font-mono text-gray-400 tabular-nums">
                    {{ group.items.length }} {{ group.items.length === 1 ? t('explorer.ner.claimSingle') : t('explorer.ner.claimPlural') }}
                  </span>
                </div>

                <div class="divide-y divide-gray-100 dark:divide-gray-700/60">
                  <div
                    v-for="item in group.items"
                    :key="item.uid"
                    class="py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 hover:bg-gray-50/70 dark:hover:bg-gray-900/40 px-2 rounded-xl transition-colors"
                  >
                    <div class="min-w-0 space-y-1 flex-1">
                      <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                        <span class="font-mono tabular-nums text-[11px] text-gray-500 dark:text-gray-400">
                          {{ formatNerTimestamp(item.timestampMs) }}
                        </span>
                        <span aria-hidden="true" class="text-gray-400">·</span>
                        <span class="font-bold text-gray-900 dark:text-white">{{ item.relation.subjectName }}</span>
                        <span :class="['text-[10px] font-semibold', getNerMeta(item.relation.subjectClass)?.textClass]">
                          ({{ t(`explorer.ner.classes.${item.relation.subjectClass}`) }})
                        </span>
                        <span class="text-teal-700 dark:text-teal-300 font-semibold">
                          → {{ t(`explorer.ner.relations.${item.relation.relationClass}`) }} →
                        </span>
                        <span class="font-bold text-gray-900 dark:text-white">{{ item.relation.objectName }}</span>
                        <span :class="['text-[10px] font-semibold', getNerMeta(item.relation.objectClass)?.textClass]">
                          ({{ t(`explorer.ner.classes.${item.relation.objectClass}`) }})
                        </span>
                      </div>

                      <p
                        v-if="item.occurrence.evidenceQuote"
                        class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed"
                      >
                        “{{ item.occurrence.evidenceQuote }}”
                      </p>

                      <div class="flex items-center gap-2 text-[10px] text-gray-400 font-mono tabular-nums">
                        <span>{{ t('explorer.ner.confidence') }}: {{ Math.round(item.occurrence.confidence * 100) }}%</span>
                        <span aria-hidden="true">·</span>
                        <span>{{ item.occurrence.engine === 'gemini' ? t('explorer.ner.engineAi') : t('explorer.ner.engineStructured') }}</span>
                      </div>
                    </div>

                    <div class="flex items-center gap-1.5 shrink-0 self-start">
                      <button
                        type="button"
                        @click="inspectAndEditTimelineClaim(item)"
                        class="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-gray-100 dark:hover:bg-gray-700/70 transition-colors cursor-pointer"
                        :title="t('explorer.ner.inspectRelation')"
                      >
                        <Pencil class="w-3.5 h-3.5" />
                      </button>
                      <template v-if="confirmDeleteTimelineUid === item.uid">
                        <button
                          type="button"
                          @click="confirmRemoveTimelineClaim(item)"
                          class="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap"
                        >
                          {{ t('explorer.ner.confirm') }}
                        </button>
                        <button
                          type="button"
                          @click="confirmDeleteTimelineUid = null"
                          class="px-1.5 py-1 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-[10px] cursor-pointer"
                        >
                          {{ t('explorer.ner.cancel') }}
                        </button>
                      </template>
                      <button
                        v-else
                        type="button"
                        @click="confirmDeleteTimelineUid = item.uid"
                        class="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-gray-100 dark:hover:bg-gray-700/70 transition-colors cursor-pointer"
                        :title="t('explorer.ner.deleteRelation')"
                      >
                        <Trash2 class="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        @click="jumpToTimelineClaim(item)"
                        class="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {{ t('explorer.ner.jumpToPost') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- Right Inspector Drawer (Visible in Directory & Graph when an entity, relation, or creator is active) -->
          <div
            v-if="modalMode !== 'timeline' && (isCreatingEntity || inspectedEntity || inspectedRelation)"
            class="w-80 lg:w-96 border-l border-gray-200/70 dark:border-gray-700/70 bg-gray-50/60 dark:bg-gray-900/40 p-5 overflow-y-auto shrink-0 space-y-5 custom-scrollbar"
          >
            <!-- CREATE MANUAL ENTITY -->
            <div v-if="isCreatingEntity" class="space-y-4">
              <div class="flex items-start justify-between gap-2">
                <h3 class="text-sm font-bold text-gray-900 dark:text-white">
                  {{ t('explorer.ner.createEntityTitle') }}
                </h3>
                <button
                  type="button"
                  @click="isCreatingEntity = false"
                  class="p-1 text-gray-400 hover:text-gray-600 cursor-pointer"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>

              <div class="space-y-3">
                <label class="block space-y-1">
                  <span class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                    {{ t('explorer.ner.entityNameLabel') }}
                  </span>
                  <input
                    v-model="createEntityName"
                    type="text"
                    maxlength="90"
                    class="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  />
                </label>

                <label class="block space-y-1">
                  <span class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                    {{ t('explorer.ner.colClass') }}
                  </span>
                  <select
                    v-model="createEntityClass"
                    class="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 cursor-pointer"
                  >
                    <option v-for="cls in NER_CLASSES" :key="cls.id" :value="cls.id">
                      {{ t(`explorer.ner.classes.${cls.id}`) }}
                    </option>
                  </select>
                </label>

                <label v-if="(postSummaries?.length || 0) > 0" class="block space-y-1">
                  <span class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                    {{ t('explorer.ner.sourcePostLabel') }}
                  </span>
                  <select
                    v-model="createEntityPostKey"
                    class="w-full px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 cursor-pointer"
                  >
                    <option v-for="ps in postSummaries" :key="ps.postKey" :value="ps.postKey">
                      {{ formatNerTimestamp(ps.timestampMs) }} · {{ ps.snippet }}
                    </option>
                  </select>
                </label>

                <label class="block space-y-1">
                  <span class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                    {{ t('explorer.ner.quoteLabel') }}
                  </span>
                  <input
                    v-model="createEntityQuote"
                    type="text"
                    maxlength="220"
                    :placeholder="t('explorer.ner.quotePlaceholder')"
                    class="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100"
                  />
                </label>

                <div class="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    @click="submitCreateEntity"
                    :disabled="!createEntityName.trim() || !createEntityPostKey"
                    class="flex-1 py-1.5 px-3 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-45 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {{ t('explorer.ner.save') }}
                  </button>
                  <button
                    type="button"
                    @click="isCreatingEntity = false"
                    class="py-1.5 px-3 rounded-xl bg-gray-200/70 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-semibold hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {{ t('explorer.ner.cancel') }}
                  </button>
                </div>
              </div>
            </div>

            <!-- INSPECT & EDIT ENTITY -->
            <div v-else-if="inspectedEntity" class="space-y-4">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div :class="['text-[11px] font-bold uppercase tracking-wider', getNerMeta(inspectedEntity.nerClass)?.textClass]">
                    {{ t(`explorer.ner.classes.${inspectedEntity.nerClass}`) }}
                  </div>
                  <h3 class="text-base font-bold text-gray-900 dark:text-white break-words">
                    {{ inspectedEntity.canonicalName }}
                  </h3>
                  <div class="mt-1 text-[11px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
                    {{ inspectedEntity.mentionCount }} {{ t('explorer.ner.mentionsUnit') }} · {{ inspectedEntity.postKeys.length }} {{ t('explorer.ner.postsShort') }}
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    @click="startMergeEntity(inspectedEntity)"
                    :class="[
                      'p-1.5 rounded-lg transition-colors cursor-pointer',
                      isMergingEntity
                        ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300'
                        : 'text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-white dark:hover:bg-gray-800',
                    ]"
                    :title="t('explorer.ner.mergeEntity')"
                  >
                    <GitMerge class="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    @click="startEditEntity(inspectedEntity)"
                    :class="[
                      'p-1.5 rounded-lg transition-colors cursor-pointer',
                      isEditingEntity
                        ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300'
                        : 'text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-white dark:hover:bg-gray-800',
                    ]"
                    :title="t('explorer.ner.editEntity')"
                  >
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    @click="confirmDeleteEntity = !confirmDeleteEntity"
                    :class="[
                      'p-1.5 rounded-lg transition-colors cursor-pointer',
                      confirmDeleteEntity
                        ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400'
                        : 'text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-white dark:hover:bg-gray-800',
                    ]"
                    :title="t('explorer.ner.deleteEntity')"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    @click="closeInspectorDrawer"
                    class="p-1 text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    <X class="w-4 h-4" />
                  </button>
                </div>
              </div>

              <!-- Inline Delete Confirmation -->
              <div
                v-if="confirmDeleteEntity"
                class="p-2.5 rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/30 space-y-2"
              >
                <p class="text-[11px] font-medium text-rose-700 dark:text-rose-300">
                  {{ t('explorer.ner.confirmDeleteEntity') }}
                </p>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    @click="confirmRemoveEntity(inspectedEntity)"
                    class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {{ t('explorer.ner.delete') }}
                  </button>
                  <button
                    type="button"
                    @click="confirmDeleteEntity = false"
                    class="px-2.5 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                  >
                    {{ t('explorer.ner.cancel') }}
                  </button>
                </div>
              </div>

              <!-- Inline Entity Editor Form -->
              <div
                v-if="isEditingEntity"
                class="p-3 rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-white dark:bg-gray-800 space-y-2.5"
              >
                <label class="block space-y-1">
                  <span class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                    {{ t('explorer.ner.entityNameLabel') }}
                  </span>
                  <input
                    v-model="editEntityName"
                    type="text"
                    maxlength="90"
                    class="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  />
                </label>

                <label class="block space-y-1">
                  <span class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                    {{ t('explorer.ner.colClass') }}
                  </span>
                  <select
                    v-model="editEntityClass"
                    class="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 cursor-pointer"
                  >
                    <option v-for="cls in NER_CLASSES" :key="cls.id" :value="cls.id">
                      {{ t(`explorer.ner.classes.${cls.id}`) }}
                    </option>
                  </select>
                </label>

                <label class="inline-flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                  <input
                    v-model="editEntityKeepAlias"
                    type="checkbox"
                    class="rounded border-gray-300 dark:border-gray-600 text-teal-600 focus:ring-teal-500/30 cursor-pointer"
                  />
                  <span>{{ t('explorer.ner.preserveAliasLabel') }}</span>
                </label>

                <p
                  v-if="editEntityMergeTarget"
                  class="text-[11px] font-medium text-amber-700 dark:text-amber-300"
                >
                  {{ t('explorer.ner.mergeHint') }} ({{ editEntityMergeTarget.canonicalName }})
                </p>

                <div class="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    @click="saveEditEntity(inspectedEntity)"
                    :disabled="!editEntityName.trim()"
                    class="flex-1 py-1.5 px-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-45 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {{ t('explorer.ner.save') }}
                  </button>
                  <button
                    type="button"
                    @click="isEditingEntity = false"
                    class="py-1.5 px-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    {{ t('explorer.ner.cancel') }}
                  </button>
                </div>
              </div>

              <!-- Inline Merge Entity Panel + Relation Impact Preview -->
              <div
                v-if="isMergingEntity"
                class="p-3 rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-white dark:bg-gray-800 space-y-2.5"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[11px] font-bold text-gray-700 dark:text-gray-200 inline-flex items-center gap-1.5">
                    <GitMerge class="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    <span>{{ t('explorer.ner.mergeEntity') }}</span>
                  </span>
                  <button
                    type="button"
                    @click="isMergingEntity = false"
                    class="p-0.5 text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    <X class="w-3.5 h-3.5" />
                  </button>
                </div>

                <!-- Partner Search Input -->
                <div class="relative flex items-center">
                  <Search class="w-3.5 h-3.5 text-gray-400 absolute left-2.5 pointer-events-none" />
                  <input
                    v-model="mergeSearchQuery"
                    type="text"
                    :placeholder="t('explorer.ner.mergeSearchPlaceholder')"
                    class="w-full pl-8 pr-7 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  />
                  <button
                    v-if="mergeSearchQuery"
                    type="button"
                    @click="mergeSearchQuery = ''"
                    class="absolute right-2 text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    <X class="w-3 h-3" />
                  </button>
                </div>

                <!-- Ranked Candidate Picker -->
                <div class="max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60 border border-gray-200/70 dark:border-gray-700/70 rounded-lg custom-scrollbar">
                  <button
                    v-for="cand in mergeCandidateEntities"
                    :key="cand.id"
                    type="button"
                    @click="selectMergePartner(inspectedEntity, cand)"
                    :class="[
                      'w-full px-2.5 py-1.5 text-left flex items-center justify-between gap-2 transition-colors cursor-pointer',
                      mergePartnerId === cand.id
                        ? 'bg-teal-50 dark:bg-teal-950/40'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-900/50',
                    ]"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {{ cand.canonicalName }}
                      </div>
                      <div :class="['text-[10px] font-medium truncate', getNerMeta(cand.nerClass)?.textClass]">
                        {{ t(`explorer.ner.classes.${cand.nerClass}`) }}
                      </div>
                    </div>
                    <span class="text-[10px] font-mono tabular-nums text-gray-400 shrink-0">
                      {{ cand.mentionCount }}
                    </span>
                  </button>
                  <div
                    v-if="mergeCandidateEntities.length === 0"
                    class="py-3 px-2.5 text-center text-[11px] text-gray-400 dark:text-gray-500"
                  >
                    {{ t('explorer.ner.mergeNoMatches') }}
                  </div>
                </div>

                <!-- Selected Merge Direction + Relation Impact Preview -->
                <template v-if="mergePartnerEntity && mergeSourceEntity && mergeSurvivorEntity">
                  <div class="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/60 border border-gray-200/70 dark:border-gray-700/70 space-y-2">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0 space-y-1 flex-1">
                        <div class="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                          {{ t('explorer.ner.mergeRemovedLabel') }}
                        </div>
                        <div class="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">
                          {{ mergeSourceEntity.canonicalName }}
                          <span :class="['text-[10px] font-normal ml-1', getNerMeta(mergeSourceEntity.nerClass)?.textClass]">
                            ({{ t(`explorer.ner.classes.${mergeSourceEntity.nerClass}`) }})
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        @click="mergeIntoPartner = !mergeIntoPartner"
                        class="p-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-teal-600 dark:hover:text-teal-400 cursor-pointer shrink-0"
                        :title="t('explorer.ner.mergeDirectionSwap')"
                      >
                        <ArrowLeftRight class="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div class="space-y-0.5 pt-1 border-t border-gray-200/60 dark:border-gray-700/60">
                      <div class="text-[10px] font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                        {{ t('explorer.ner.mergeSurvivorLabel') }}
                      </div>
                      <div class="text-xs font-bold text-gray-900 dark:text-white truncate">
                        {{ mergeSurvivorEntity.canonicalName }}
                        <span :class="['text-[10px] font-normal ml-1', getNerMeta(mergeSurvivorEntity.nerClass)?.textClass]">
                          ({{ t(`explorer.ner.classes.${mergeSurvivorEntity.nerClass}`) }})
                        </span>
                      </div>
                    </div>
                  </div>

                  <label class="inline-flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                    <input
                      v-model="mergePreserveAliases"
                      type="checkbox"
                      class="rounded border-gray-300 dark:border-gray-600 text-teal-600 focus:ring-teal-500/30 cursor-pointer"
                    />
                    <span>{{ t('explorer.ner.preserveAliasLabel') }}</span>
                  </label>

                  <!-- Relation Impact Summary & List -->
                  <div
                    v-if="mergePreview"
                    class="p-2.5 rounded-lg border border-gray-200/70 dark:border-gray-700/70 bg-gray-50/70 dark:bg-gray-900/40 space-y-1.5"
                  >
                    <div class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      {{ t('explorer.ner.mergeImpactTitle') }}
                    </div>
                    <div
                      v-if="mergePreview.impacts.length > 0"
                      class="text-[11px] font-mono tabular-nums text-gray-700 dark:text-gray-200"
                    >
                      {{
                        t('explorer.ner.mergeImpactSummary', {
                          relinked: mergePreview.relinkedCount,
                          consolidated: mergePreview.consolidatedCount,
                          removed: mergePreview.removedSelfLoopCount,
                        })
                      }}
                    </div>
                    <div
                      v-else
                      class="text-[11px] text-gray-500 dark:text-gray-400"
                    >
                      {{ t('explorer.ner.mergeImpactNone', { posts: mergePreview.affectedPostsCount }) }}
                    </div>

                    <div
                      v-if="mergePreview.impacts.length > 0"
                      class="divide-y divide-gray-200/50 dark:divide-gray-700/50 pt-1"
                    >
                      <div
                        v-for="imp in mergePreview.impacts.slice(0, 5)"
                        :key="imp.relationId"
                        class="py-1.5 space-y-0.5"
                      >
                        <div class="text-[11px] text-gray-800 dark:text-gray-200 break-words">
                          {{ imp.subjectName }} → {{ t(`explorer.ner.relations.${imp.relationClass}`) }} → {{ imp.objectName }}
                        </div>
                        <div class="flex items-center justify-between gap-2 text-[10px]">
                          <span
                            :class="[
                              'font-semibold',
                              imp.action === 'remove_self_loop'
                                ? 'text-rose-600 dark:text-rose-400'
                                : imp.action === 'consolidate'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-teal-600 dark:text-teal-400',
                            ]"
                          >
                            {{
                              imp.action === 'remove_self_loop'
                                ? t('explorer.ner.mergeActionSelfLoop')
                                : imp.action === 'consolidate'
                                  ? t('explorer.ner.mergeActionConsolidate')
                                  : t('explorer.ner.mergeActionRelink')
                            }}
                          </span>
                          <span class="font-mono tabular-nums text-gray-400">
                            {{ imp.occurrencesCount }}×
                          </span>
                        </div>
                      </div>
                      <div
                        v-if="mergePreview.impacts.length > 5"
                        class="pt-1 text-[10px] font-mono text-gray-400"
                      >
                        {{ t('explorer.ner.mergeMoreImpacts', { count: mergePreview.impacts.length - 5 }) }}
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      @click="submitMergeEntity"
                      class="flex-1 py-1.5 px-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {{ t('explorer.ner.mergeConfirm') }}
                    </button>
                    <button
                      type="button"
                      @click="isMergingEntity = false"
                      class="py-1.5 px-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      {{ t('explorer.ner.cancel') }}
                    </button>
                  </div>
                </template>
              </div>

              <button
                type="button"
                @click="jumpToEntity(inspectedEntity)"
                class="w-full py-2 px-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                {{ t('explorer.ner.filterAndJump') }}
              </button>

              <!-- Extraction Engine(s) -->
              <div v-if="inspectedEntity.engines?.length > 0" class="space-y-1">
                <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                  {{ t('explorer.ner.extractionEngineLabel') }}
                </div>
                <p class="text-xs font-mono text-gray-700 dark:text-gray-300">
                  {{ formatEntityEngines(inspectedEntity.engines).join(' · ') }}
                </p>
              </div>

              <!-- Aliases -->
              <div v-if="inspectedEntity.aliases.length > 0" class="space-y-1">
                <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                  {{ t('explorer.ner.aliasesLabel') }}
                </div>
                <p class="text-xs text-gray-700 dark:text-gray-300">
                  {{ inspectedEntity.aliases.join(' · ') }}
                </p>
              </div>

              <!-- Related Timestamped Claims + Add/Edit/Delete -->
              <div class="space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                    {{ t('explorer.ner.linkedRelations') }} ({{ inspectedEntityRelations.length }})
                  </div>
                  <button
                    v-if="availableEntityPostOptions.length > 0"
                    type="button"
                    @click="toggleAddEntityRelation(inspectedEntity)"
                    class="text-[11px] font-semibold text-teal-600 dark:text-teal-400 hover:underline cursor-pointer inline-flex items-center gap-0.5 whitespace-nowrap"
                  >
                    <Plus class="w-3 h-3" />
                    <span>{{ t('explorer.ner.addRelation') }}</span>
                  </button>
                </div>

                <!-- Inline Add Relation Composer for Inspected Entity -->
                <div
                  v-if="isAddingEntityRelation"
                  class="p-3 rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-white dark:bg-gray-800 space-y-2.5"
                >
                  <div class="flex items-center justify-between gap-2 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                    <span class="truncate">
                      {{
                        addRelOutgoing
                          ? `${inspectedEntity.canonicalName} → ${addRelTargetName.trim() || '...'}`
                          : `${addRelTargetName.trim() || '...'} → ${inspectedEntity.canonicalName}`
                      }}
                    </span>
                    <button
                      type="button"
                      @click="addRelOutgoing = !addRelOutgoing"
                      class="p-1 rounded-md text-gray-500 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer shrink-0"
                      :title="t('explorer.ner.swapDirection')"
                    >
                      <ArrowLeftRight class="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <label class="block space-y-1">
                    <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      {{ t('explorer.ner.relationLabel') }}
                    </span>
                    <select
                      v-model="addRelClass"
                      class="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 cursor-pointer"
                    >
                      <option v-for="relCls in RELATION_CLASSES" :key="relCls.id" :value="relCls.id">
                        {{ t(`explorer.ner.relations.${relCls.id}`) }}
                      </option>
                    </select>
                  </label>

                  <div class="grid grid-cols-5 gap-1.5">
                    <label class="col-span-3 block space-y-1">
                      <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                        {{ t('explorer.ner.counterpartyLabel') }}
                      </span>
                      <input
                        v-model="addRelTargetName"
                        @input="syncTargetClassFromExisting(addRelTargetName, (c) => (addRelTargetClass = c))"
                        list="ner-entity-autocomplete"
                        type="text"
                        maxlength="90"
                        class="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100"
                      />
                    </label>
                    <label class="col-span-2 block space-y-1">
                      <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                        {{ t('explorer.ner.colClass') }}
                      </span>
                      <select
                        v-model="addRelTargetClass"
                        class="w-full px-1.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 cursor-pointer"
                      >
                        <option v-for="cls in NER_CLASSES" :key="cls.id" :value="cls.id">
                          {{ t(`explorer.ner.classes.${cls.id}`) }}
                        </option>
                      </select>
                    </label>
                  </div>

                  <label class="block space-y-1">
                    <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      {{ t('explorer.ner.sourcePostLabel') }}
                    </span>
                    <select
                      v-model="addRelPostKey"
                      class="w-full px-2 py-1.5 text-[11px] font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 cursor-pointer"
                    >
                      <option v-for="opt in availableEntityPostOptions" :key="opt.postKey" :value="opt.postKey">
                        {{ formatNerTimestamp(opt.timestampMs) }} · {{ opt.snippet }}
                      </option>
                    </select>
                  </label>

                  <label class="block space-y-1">
                    <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      {{ t('explorer.ner.quoteLabel') }}
                    </span>
                    <input
                      v-model="addRelQuote"
                      type="text"
                      maxlength="220"
                      :placeholder="t('explorer.ner.quotePlaceholder')"
                      class="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100"
                    />
                  </label>

                  <div class="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      @click="submitAddEntityRelation(inspectedEntity)"
                      :disabled="!addRelTargetName.trim() || !addRelPostKey"
                      class="flex-1 py-1.5 px-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-45 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {{ t('explorer.ner.save') }}
                    </button>
                    <button
                      type="button"
                      @click="isAddingEntityRelation = false"
                      class="py-1.5 px-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      {{ t('explorer.ner.cancel') }}
                    </button>
                  </div>
                </div>

                <div
                  v-if="inspectedEntityRelations.length > 0"
                  class="divide-y divide-gray-200/60 dark:divide-gray-700/60"
                >
                  <div
                    v-for="rel in inspectedEntityRelations"
                    :key="rel.id"
                    class="py-2 px-1.5 rounded-lg hover:bg-white/80 dark:hover:bg-gray-800/70 transition-colors flex items-start justify-between gap-2"
                  >
                    <button
                      type="button"
                      @click="jumpToRelation(rel)"
                      class="flex-1 min-w-0 text-left cursor-pointer space-y-0.5"
                    >
                      <div class="text-xs font-semibold text-gray-900 dark:text-gray-100 break-words">
                        {{ rel.subjectName }} → {{ t(`explorer.ner.relations.${rel.relationClass}`) }} → {{ rel.objectName }}
                      </div>
                      <div class="text-[10px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
                        {{ formatNerTimestamp(rel.latestTimestampMs) }} · {{ rel.occurrences.length }}×
                      </div>
                    </button>

                    <div class="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        @click="openRelationInspector(rel, true)"
                        class="p-1 rounded-md text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-gray-100 dark:hover:bg-gray-700/70 transition-colors cursor-pointer"
                        :title="t('explorer.ner.inspectRelation')"
                      >
                        <Pencil class="w-3 h-3" />
                      </button>
                      <template v-if="confirmDeleteLinkedRelId === rel.id">
                        <button
                          type="button"
                          @click="confirmRemoveLinkedRelation(rel.id)"
                          class="p-1 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                          :title="t('explorer.ner.confirm')"
                        >
                          <Check class="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          @click="confirmDeleteLinkedRelId = null"
                          class="p-1 rounded-md text-gray-400 hover:text-gray-600 cursor-pointer"
                          :title="t('explorer.ner.cancel')"
                        >
                          <X class="w-3 h-3" />
                        </button>
                      </template>
                      <button
                        v-else
                        type="button"
                        @click="confirmDeleteLinkedRelId = rel.id"
                        class="p-1 rounded-md text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-gray-100 dark:hover:bg-gray-700/70 transition-colors cursor-pointer"
                        :title="t('explorer.ner.deleteRelation')"
                      >
                        <Trash2 class="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Evidence Quotes -->
              <div v-if="inspectedEntity.sampleQuotes.length > 0" class="space-y-2">
                <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                  {{ t('explorer.ner.sourceQuotes') }}
                </div>
                <div class="space-y-2">
                  <div
                    v-for="(q, qIdx) in inspectedEntity.sampleQuotes"
                    :key="qIdx"
                    class="p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200/70 dark:border-gray-700/70 space-y-1.5"
                  >
                    <div class="flex items-center justify-between text-[10px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
                      <span>{{ formatNerTimestamp(q.timestampMs) }}</span>
                      <button
                        type="button"
                        @click="jumpToSingleQuote(inspectedEntity, q)"
                        class="text-teal-600 dark:text-teal-400 font-sans font-bold hover:underline cursor-pointer"
                      >
                        {{ t('explorer.ner.jumpToPost') }}
                      </button>
                    </div>
                    <p class="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                      “{{ q.quote }}”
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- INSPECT & EDIT RELATION -->
            <div v-else-if="inspectedRelation" class="space-y-4">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-[11px] font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                    {{ t(`explorer.ner.relations.${inspectedRelation.relationClass}`) }}
                  </div>
                  <h3 class="text-sm font-bold text-gray-900 dark:text-white break-words mt-0.5">
                    {{ inspectedRelation.subjectName }} → {{ inspectedRelation.objectName }}
                  </h3>
                  <div class="mt-1 text-[11px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
                    {{ inspectedRelation.occurrences.length }} {{ t('explorer.ner.timestampedClaims') }}
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    @click="startEditRelation(inspectedRelation)"
                    :class="[
                      'p-1.5 rounded-lg transition-colors cursor-pointer',
                      isEditingRelation
                        ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300'
                        : 'text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-white dark:hover:bg-gray-800',
                    ]"
                    :title="t('explorer.ner.editRelation')"
                  >
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    @click="confirmDeleteRelation = !confirmDeleteRelation"
                    :class="[
                      'p-1.5 rounded-lg transition-colors cursor-pointer',
                      confirmDeleteRelation
                        ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400'
                        : 'text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-white dark:hover:bg-gray-800',
                    ]"
                    :title="t('explorer.ner.deleteRelation')"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    @click="closeInspectorDrawer"
                    class="p-1 text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    <X class="w-4 h-4" />
                  </button>
                </div>
              </div>

              <!-- Inline Delete Relation Confirmation -->
              <div
                v-if="confirmDeleteRelation"
                class="p-2.5 rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/30 space-y-2"
              >
                <p class="text-[11px] font-medium text-rose-700 dark:text-rose-300">
                  {{ t('explorer.ner.confirmDeleteRelation') }}
                </p>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    @click="confirmRemoveRelation(inspectedRelation)"
                    class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {{ t('explorer.ner.delete') }}
                  </button>
                  <button
                    type="button"
                    @click="confirmDeleteRelation = false"
                    class="px-2.5 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                  >
                    {{ t('explorer.ner.cancel') }}
                  </button>
                </div>
              </div>

              <!-- Inline Relation Editor Form -->
              <div
                v-if="isEditingRelation"
                class="p-3 rounded-xl border border-gray-200/80 dark:border-gray-700/80 bg-white dark:bg-gray-800 space-y-2.5"
              >
                <div class="grid grid-cols-5 gap-1.5">
                  <label class="col-span-3 block space-y-1">
                    <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      {{ t('explorer.ner.subjectLabel') }}
                    </span>
                    <input
                      v-model="editRelSubjName"
                      @input="syncTargetClassFromExisting(editRelSubjName, (c) => (editRelSubjClass = c))"
                      list="ner-entity-autocomplete"
                      type="text"
                      maxlength="90"
                      class="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100"
                    />
                  </label>
                  <label class="col-span-2 block space-y-1">
                    <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      {{ t('explorer.ner.colClass') }}
                    </span>
                    <select
                      v-model="editRelSubjClass"
                      class="w-full px-1.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 cursor-pointer"
                    >
                      <option v-for="cls in NER_CLASSES" :key="cls.id" :value="cls.id">
                        {{ t(`explorer.ner.classes.${cls.id}`) }}
                      </option>
                    </select>
                  </label>
                </div>

                <div class="flex items-end gap-1.5">
                  <label class="flex-1 block space-y-1">
                    <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      {{ t('explorer.ner.relationLabel') }}
                    </span>
                    <select
                      v-model="editRelClass"
                      class="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 cursor-pointer"
                    >
                      <option v-for="relCls in RELATION_CLASSES" :key="relCls.id" :value="relCls.id">
                        {{ t(`explorer.ner.relations.${relCls.id}`) }}
                      </option>
                    </select>
                  </label>
                  <button
                    type="button"
                    @click="swapEditRelationEndpoints"
                    class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer shrink-0"
                    :title="t('explorer.ner.swapDirection')"
                  >
                    <ArrowLeftRight class="w-3.5 h-3.5" />
                  </button>
                </div>

                <div class="grid grid-cols-5 gap-1.5">
                  <label class="col-span-3 block space-y-1">
                    <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      {{ t('explorer.ner.objectLabel') }}
                    </span>
                    <input
                      v-model="editRelObjName"
                      @input="syncTargetClassFromExisting(editRelObjName, (c) => (editRelObjClass = c))"
                      list="ner-entity-autocomplete"
                      type="text"
                      maxlength="90"
                      class="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100"
                    />
                  </label>
                  <label class="col-span-2 block space-y-1">
                    <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                      {{ t('explorer.ner.colClass') }}
                    </span>
                    <select
                      v-model="editRelObjClass"
                      class="w-full px-1.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 cursor-pointer"
                    >
                      <option v-for="cls in NER_CLASSES" :key="cls.id" :value="cls.id">
                        {{ t(`explorer.ner.classes.${cls.id}`) }}
                      </option>
                    </select>
                  </label>
                </div>

                <label v-if="editRelOnlyPostKey" class="block space-y-1">
                  <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                    {{ t('explorer.ner.quoteLabel') }}
                  </span>
                  <input
                    v-model="editRelQuote"
                    type="text"
                    maxlength="220"
                    class="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100"
                  />
                </label>

                <div class="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    @click="saveEditRelation(inspectedRelation)"
                    :disabled="!editRelSubjName.trim() || !editRelObjName.trim()"
                    class="flex-1 py-1.5 px-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-45 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {{ t('explorer.ner.save') }}
                  </button>
                  <button
                    type="button"
                    @click="cancelEditRelation"
                    class="py-1.5 px-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    {{ t('explorer.ner.cancel') }}
                  </button>
                </div>
              </div>

              <button
                type="button"
                @click="jumpToRelation(inspectedRelation)"
                class="w-full py-2 px-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                {{ t('explorer.ner.filterAndJump') }}
              </button>

              <div class="space-y-2">
                <div
                  v-for="(occ, idx) in inspectedRelation.occurrences"
                  :key="idx"
                  class="p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200/70 dark:border-gray-700/70 space-y-1.5"
                >
                  <div class="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
                    <span>{{ formatNerTimestamp(occ.timestampMs) }}</span>
                    <div class="flex items-center gap-1.5">
                      <button
                        type="button"
                        @click="startEditSingleOccurrence(inspectedRelation, occ)"
                        class="text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 cursor-pointer"
                        :title="t('explorer.ner.editRelation')"
                      >
                        <Pencil class="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        @click="removeSingleOccurrence(inspectedRelation, occ)"
                        class="text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                        :title="t('explorer.ner.delete')"
                      >
                        <Trash2 class="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        @click="jumpToSingleRelationOccurrence(inspectedRelation, occ)"
                        class="text-teal-600 dark:text-teal-400 font-sans font-bold hover:underline cursor-pointer"
                      >
                        {{ t('explorer.ner.jumpToPost') }}
                      </button>
                    </div>
                  </div>
                  <p class="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                    “{{ occ.evidenceQuote }}”
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import { useI18n } from "../../i18n";
import {
  ArrowLeftRight,
  BarChart3,
  Check,
  Clock,
  GitMerge,
  Loader2,
  Network,
  Pencil,
  Plus,
  RotateCcw,
  ScanSearch,
  Search,
  Square,
  Table2,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";
import ExplorerNerSummaryDashboard from "./ExplorerNerSummaryDashboard.vue";
import type cytoscape from "cytoscape";
import type {
  NerGraphLayoutRequest,
  NerGraphLayoutResponse,
  WorkerGraphEdgeInput,
  WorkerGraphNodeInput,
} from "../../utils/nerGraphLayoutSolver";
import {
  NER_CLASSES,
  NER_CLASS_MAP,
  RELATION_CLASSES,
  RELATION_CLASS_MAP,
  buildNerRelationKey,
  formatNerDateDay,
  formatNerTimestamp,
  normalizeEntityKey,
  previewEntityMerge,
  type ActiveNerFeedFilter,
  type AggregatedNerEntity,
  type AggregatedNerIndex,
  type AggregatedNerRelation,
  type EntityEngineSource,
  type EntityMergePreview,
  type NerClassId,
  type PostNerExtractionRecord,
  type RelationClassId,
  type RelationOccurrence,
} from "../../utils/explorerNer";

export interface NerPostSummary {
  postKey: string;
  timestampMs: number;
  snippet: string;
}

const props = defineProps<{
  open: boolean;
  channelName: string;
  index: AggregatedNerIndex;
  totalPostsCount: number;
  uncachedCount: number;
  isExtracting: boolean;
  postSummaries?: NerPostSummary[];
  rawRecords?: PostNerExtractionRecord[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "extract", forceReextract: boolean): void;
  (e: "cancel"): void;
  (e: "select-filter", filter: ActiveNerFeedFilter, targetPostKey?: string): void;
  (
    e: "update-entity",
    payload: {
      targetEntityId: string;
      newCanonicalName: string;
      newNerClass: NerClassId;
      preserveAliases: boolean;
    }
  ): void;
  (
    e: "merge-entity",
    payload: {
      sourceEntityIds: string[];
      targetCanonicalName: string;
      targetNerClass: NerClassId;
      preserveAliases: boolean;
    }
  ): void;
  (e: "delete-entity", targetEntityId: string): void;
  (
    e: "create-entity",
    payload: {
      postKey: string;
      timestampMs: number;
      name: string;
      nerClass: NerClassId;
      quote?: string;
    }
  ): void;
  (
    e: "update-relation",
    payload: {
      targetRelationId: string;
      newSubjectName: string;
      newSubjectClass: NerClassId;
      newRelationClass: RelationClassId;
      newObjectName: string;
      newObjectClass: NerClassId;
      newQuote?: string;
      onlyPostKey?: string;
      targetOccurrenceQuote?: string;
    }
  ): void;
  (
    e: "delete-relation",
    payload: {
      targetRelationId: string;
      onlyPostKey?: string;
      targetOccurrenceQuote?: string;
    }
  ): void;
  (
    e: "create-relation",
    payload: {
      postKey: string;
      timestampMs: number;
      subjectName: string;
      subjectClass: NerClassId;
      relationClass: RelationClassId;
      objectName: string;
      objectClass: NerClassId;
      evidenceQuote?: string;
    }
  ): void;
}>();

const { t } = useI18n();

const modalMode = ref<"summary" | "directory" | "graph" | "timeline">("summary");
const query = ref("");
const nerClassFilter = ref<"all" | NerClassId>("all");
const relClassFilter = ref<"all" | RelationClassId>("all");
const dateFrom = ref("");
const dateTo = ref("");
const timelineDesc = ref(true);

const hasActiveModalFilters = computed(() =>
  Boolean(
    query.value.trim() ||
      nerClassFilter.value !== "all" ||
      relClassFilter.value !== "all" ||
      dateFrom.value ||
      dateTo.value
  )
);

const toggleSummaryClassFilter = (classId: NerClassId) => {
  nerClassFilter.value = nerClassFilter.value === classId ? "all" : classId;
};

const toggleSummaryRelationFilter = (relClassId: RelationClassId) => {
  relClassFilter.value = relClassFilter.value === relClassId ? "all" : relClassId;
};

const clearModalFilters = () => {
  query.value = "";
  nerClassFilter.value = "all";
  relClassFilter.value = "all";
  dateFrom.value = "";
  dateTo.value = "";
};

const dirSortField = ref<"name" | "mentions" | "firstSeen" | "lastSeen">("mentions");
const dirSortAsc = ref(false);

const selectedInspectorEntityId = ref<string | null>(null);
const selectedInspectorRelId = ref<string | null>(null);

// Manual Entity & Relation Editor State
const isCreatingEntity = ref(false);
const createEntityName = ref("");
const createEntityClass = ref<NerClassId>("person");
const createEntityPostKey = ref("");
const createEntityQuote = ref("");

const isEditingEntity = ref(false);
const editEntityName = ref("");
const editEntityClass = ref<NerClassId>("person");
const editEntityKeepAlias = ref(true);
const confirmDeleteEntity = ref(false);

const isMergingEntity = ref(false);
const mergeSearchQuery = ref("");
const mergePartnerId = ref<string | null>(null);
const mergeIntoPartner = ref(true);
const mergePreserveAliases = ref(true);

const isAddingEntityRelation = ref(false);
const addRelOutgoing = ref(true);
const addRelClass = ref<RelationClassId>("affiliated_with");
const addRelTargetName = ref("");
const addRelTargetClass = ref<NerClassId>("organization");
const addRelPostKey = ref("");
const addRelQuote = ref("");
const confirmDeleteLinkedRelId = ref<string | null>(null);

const isEditingRelation = ref(false);
const editRelSubjName = ref("");
const editRelSubjClass = ref<NerClassId>("person");
const editRelClass = ref<RelationClassId>("affiliated_with");
const editRelObjName = ref("");
const editRelObjClass = ref<NerClassId>("organization");
const editRelOnlyPostKey = ref<string | undefined>(undefined);
const editRelTargetQuote = ref<string | undefined>(undefined);
const editRelQuote = ref("");
const confirmDeleteRelation = ref(false);

const confirmDeleteTimelineUid = ref<string | null>(null);

const dateRangeMs = computed(() => {
  const start = dateFrom.value ? new Date(`${dateFrom.value}T00:00:00`).getTime() : 0;
  const end = dateTo.value ? new Date(`${dateTo.value}T23:59:59.999`).getTime() : Infinity;
  return { start, end };
});

const totalRelationOccurrences = computed(() =>
  props.index.relations.reduce((sum, r) => sum + r.occurrences.length, 0)
);

const getNerMeta = (id: NerClassId) => NER_CLASS_MAP.get(id);

const formatEntityEngines = (engines: EntityEngineSource[]): string[] => {
  const labels: string[] = [];
  for (const src of engines) {
    if (src.engine === "manual") {
      labels.push(t("explorer.ner.engineManual"));
    } else if (src.engine === "gemini") {
      labels.push(t("explorer.ner.engineAi"));
    } else if (src.localTier === "ml") {
      const base =
        src.mlModel === "cjk-bert"
          ? "CJK BERT"
          : src.mlModel === "gliner"
            ? "GLiNER"
            : t("explorer.ner.engineNeuralLocalShort");
      const prov =
        src.mlProvider === "webgpu"
          ? "WebGPU"
          : src.mlProvider === "wasm"
            ? "WASM"
            : "";
      labels.push(prov ? `${base} (${prov})` : base);
    } else {
      labels.push(t("explorer.ner.engineStructured"));
    }
  }
  return Array.from(new Set(labels));
};

const filteredDirectoryEntities = computed(() => {
  const q = query.value.trim().toLowerCase();
  const { start, end } = dateRangeMs.value;

  const list = props.index.entities.filter((e) => {
    if (nerClassFilter.value !== "all" && e.nerClass !== nerClassFilter.value) return false;
    if (q) {
      const hay = `${e.canonicalName} ${e.aliases.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (dateFrom.value && e.lastSeenMs > 0 && e.lastSeenMs < start) return false;
    if (dateTo.value && e.firstSeenMs > 0 && e.firstSeenMs > end) return false;
    return true;
  });

  const mult = dirSortAsc.value ? 1 : -1;
  return [...list].sort((a, b) => {
    if (dirSortField.value === "name") return a.canonicalName.localeCompare(b.canonicalName) * mult;
    if (dirSortField.value === "firstSeen") return (a.firstSeenMs - b.firstSeenMs) * mult;
    if (dirSortField.value === "lastSeen") return (a.lastSeenMs - b.lastSeenMs) * mult;
    return (a.mentionCount - b.mentionCount) * mult;
  });
});

const filteredRelations = computed(() => {
  const q = query.value.trim().toLowerCase();
  const { start, end } = dateRangeMs.value;

  return props.index.relations.filter((r) => {
    if (relClassFilter.value !== "all" && r.relationClass !== relClassFilter.value) return false;
    if (
      nerClassFilter.value !== "all" &&
      r.subjectClass !== nerClassFilter.value &&
      r.objectClass !== nerClassFilter.value
    ) {
      return false;
    }
    if (q) {
      const hay = `${r.subjectName} ${r.objectName} ${r.relationClass} ${r.occurrences
        .map((o) => o.evidenceQuote)
        .join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (dateFrom.value && r.latestTimestampMs > 0 && r.latestTimestampMs < start) return false;
    if (dateTo.value && r.earliestTimestampMs > 0 && r.earliestTimestampMs > end) return false;
    return true;
  });
});

interface TimelineClaimItem {
  uid: string;
  timestampMs: number;
  relation: AggregatedNerRelation;
  occurrence: RelationOccurrence;
}

const timelineGroups = computed(() => {
  const { start, end } = dateRangeMs.value;
  const flat: TimelineClaimItem[] = [];

  for (const rel of filteredRelations.value) {
    rel.occurrences.forEach((occ, idx) => {
      if (dateFrom.value && occ.timestampMs > 0 && occ.timestampMs < start) return;
      if (dateTo.value && occ.timestampMs > 0 && occ.timestampMs > end) return;
      flat.push({
        uid: `${rel.id}::${occ.postKey}::${idx}`,
        timestampMs: occ.timestampMs,
        relation: rel,
        occurrence: occ,
      });
    });
  }

  flat.sort((a, b) =>
    timelineDesc.value ? b.timestampMs - a.timestampMs : a.timestampMs - b.timestampMs
  );

  const grouped: Array<{ day: string; items: TimelineClaimItem[] }> = [];
  const byDay = new Map<string, TimelineClaimItem[]>();
  for (const item of flat) {
    const day = formatNerDateDay(item.timestampMs);
    if (!byDay.has(day)) {
      const arr: TimelineClaimItem[] = [];
      byDay.set(day, arr);
      grouped.push({ day, items: arr });
    }
    byDay.get(day)!.push(item);
  }
  return grouped;
});

const inspectedEntity = computed(() =>
  selectedInspectorEntityId.value
    ? props.index.entityById.get(selectedInspectorEntityId.value) || null
    : null
);

const inspectedRelation = computed(() =>
  selectedInspectorRelId.value
    ? props.index.relationById.get(selectedInspectorRelId.value) || null
    : null
);

const inspectedEntityRelations = computed(() => {
  if (!inspectedEntity.value) return [];
  const eid = inspectedEntity.value.id;
  return props.index.relations.filter((r) => r.subjectId === eid || r.objectId === eid);
});

const editEntityMergeTarget = computed<AggregatedNerEntity | null>(() => {
  if (!isEditingEntity.value || !inspectedEntity.value) return null;
  const cleanName = editEntityName.value.trim();
  if (!cleanName) return null;
  const candidateId = normalizeEntityKey(editEntityClass.value, cleanName);
  if (candidateId === inspectedEntity.value.id) return null;
  return props.index.entityById.get(candidateId) || null;
});

const availableEntityPostOptions = computed<NerPostSummary[]>(() => {
  const summaries = props.postSummaries || [];
  if (!inspectedEntity.value) return summaries;
  const entityPostSet = new Set(inspectedEntity.value.postKeys);
  const byKey = new Map<string, NerPostSummary>();
  for (const s of summaries) {
    byKey.set(s.postKey, s);
  }
  const preferred: NerPostSummary[] = [];
  for (const pk of inspectedEntity.value.postKeys) {
    const found = byKey.get(pk);
    if (found) preferred.push(found);
  }
  if (preferred.length === 0 && inspectedEntity.value.sampleQuotes.length > 0) {
    for (const q of inspectedEntity.value.sampleQuotes) {
      preferred.push({
        postKey: q.postKey,
        timestampMs: q.timestampMs,
        snippet: q.quote.slice(0, 48),
      });
    }
  }
  const rest = summaries.filter((s) => !entityPostSet.has(s.postKey));
  return [...preferred, ...rest].slice(0, 120);
});

const mergePartnerEntity = computed<AggregatedNerEntity | null>(() => {
  if (!isMergingEntity.value || !mergePartnerId.value) return null;
  return props.index.entityById.get(mergePartnerId.value) || null;
});

const mergeSourceEntity = computed<AggregatedNerEntity | null>(() => {
  if (!inspectedEntity.value || !mergePartnerEntity.value) return null;
  return mergeIntoPartner.value ? inspectedEntity.value : mergePartnerEntity.value;
});

const mergeSurvivorEntity = computed<AggregatedNerEntity | null>(() => {
  if (!inspectedEntity.value || !mergePartnerEntity.value) return null;
  return mergeIntoPartner.value ? mergePartnerEntity.value : inspectedEntity.value;
});

const mergeCandidateEntities = computed<AggregatedNerEntity[]>(() => {
  if (!isMergingEntity.value || !inspectedEntity.value) return [];
  const current = inspectedEntity.value;
  const currentNameLower = current.canonicalName.toLowerCase();
  const q = mergeSearchQuery.value.trim().toLowerCase();
  const cooccurSet = new Set(current.cooccurringIds || []);
  const currentTokens = currentNameLower.split(/[\s\-_·.,/()（）]+/).filter((t) => t.length >= 2);

  const scored: Array<{ ent: AggregatedNerEntity; score: number }> = [];
  for (const cand of props.index.entities) {
    if (cand.id === current.id) continue;
    const candNameLower = cand.canonicalName.toLowerCase();
    const hay = `${cand.canonicalName} ${cand.aliases.join(" ")}`.toLowerCase();
    if (q && !hay.includes(q)) continue;

    let score = 0;
    if (candNameLower.includes(currentNameLower) || currentNameLower.includes(candNameLower)) {
      score += 100;
    }
    if (
      current.aliases.some((a) => hay.includes(a.toLowerCase())) ||
      cand.aliases.some((a) => currentNameLower.includes(a.toLowerCase()))
    ) {
      score += 60;
    }
    if (currentTokens.some((tok) => hay.includes(tok))) {
      score += 40;
    }
    if (cooccurSet.has(cand.id)) {
      score += 20;
    }
    if (cand.nerClass === current.nerClass) {
      score += 10;
    }
    scored.push({ ent: cand, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.ent.mentionCount - a.ent.mentionCount ||
      a.ent.canonicalName.localeCompare(b.ent.canonicalName)
  );
  return scored.slice(0, 40).map((s) => s.ent);
});

const mergePreview = computed<EntityMergePreview | null>(() => {
  if (!isMergingEntity.value || !mergeSourceEntity.value || !mergeSurvivorEntity.value) {
    return null;
  }
  return previewEntityMerge(props.rawRecords || [], {
    sourceEntityIds: [mergeSourceEntity.value.id],
    targetCanonicalName: mergeSurvivorEntity.value.canonicalName,
    targetNerClass: mergeSurvivorEntity.value.nerClass,
  });
});

const resetAllEditorStates = () => {
  isCreatingEntity.value = false;
  isEditingEntity.value = false;
  isMergingEntity.value = false;
  mergeSearchQuery.value = "";
  mergePartnerId.value = null;
  confirmDeleteEntity.value = false;
  isAddingEntityRelation.value = false;
  confirmDeleteLinkedRelId.value = null;
  isEditingRelation.value = false;
  editRelOnlyPostKey.value = undefined;
  editRelTargetQuote.value = undefined;
  confirmDeleteRelation.value = false;
  confirmDeleteTimelineUid.value = null;
};

const selectInspectorEntity = (entityId: string) => {
  resetAllEditorStates();
  selectedInspectorEntityId.value = entityId;
  selectedInspectorRelId.value = null;
};

const closeInspectorDrawer = () => {
  resetAllEditorStates();
  selectedInspectorEntityId.value = null;
  selectedInspectorRelId.value = null;
};

const openCreateEntityDrawer = () => {
  resetAllEditorStates();
  selectedInspectorEntityId.value = null;
  selectedInspectorRelId.value = null;
  isCreatingEntity.value = true;
  createEntityName.value = "";
  createEntityClass.value = nerClassFilter.value !== "all" ? nerClassFilter.value : "person";
  createEntityPostKey.value = props.postSummaries?.[0]?.postKey || "";
  createEntityQuote.value = "";
};

const submitCreateEntity = () => {
  const cleanName = createEntityName.value.trim();
  const postKey = createEntityPostKey.value;
  if (!cleanName || !postKey) return;
  const postSummary = props.postSummaries?.find((p) => p.postKey === postKey);
  const nextEntityId = normalizeEntityKey(createEntityClass.value, cleanName);
  emit("create-entity", {
    postKey,
    timestampMs: postSummary?.timestampMs || 0,
    name: cleanName,
    nerClass: createEntityClass.value,
    quote: createEntityQuote.value.trim() || undefined,
  });
  isCreatingEntity.value = false;
  selectedInspectorEntityId.value = nextEntityId;
  selectedInspectorRelId.value = null;
};

const startEditEntity = (ent: AggregatedNerEntity) => {
  if (isEditingEntity.value) {
    isEditingEntity.value = false;
    return;
  }
  confirmDeleteEntity.value = false;
  isAddingEntityRelation.value = false;
  isMergingEntity.value = false;
  editEntityName.value = ent.canonicalName;
  editEntityClass.value = ent.nerClass;
  editEntityKeepAlias.value = true;
  isEditingEntity.value = true;
};

const startMergeEntity = (_ent: AggregatedNerEntity) => {
  if (isMergingEntity.value) {
    isMergingEntity.value = false;
    return;
  }
  confirmDeleteEntity.value = false;
  isAddingEntityRelation.value = false;
  isEditingEntity.value = false;
  mergeSearchQuery.value = "";
  mergePartnerId.value = null;
  mergeIntoPartner.value = true;
  mergePreserveAliases.value = true;
  isMergingEntity.value = true;
};

const selectMergePartner = (current: AggregatedNerEntity, cand: AggregatedNerEntity) => {
  mergePartnerId.value = cand.id;
  mergeIntoPartner.value = cand.mentionCount >= current.mentionCount;
};

const submitMergeEntity = () => {
  if (!mergeSourceEntity.value || !mergeSurvivorEntity.value) return;
  const survivorId = mergeSurvivorEntity.value.id;
  emit("merge-entity", {
    sourceEntityIds: [mergeSourceEntity.value.id],
    targetCanonicalName: mergeSurvivorEntity.value.canonicalName,
    targetNerClass: mergeSurvivorEntity.value.nerClass,
    preserveAliases: mergePreserveAliases.value,
  });
  isMergingEntity.value = false;
  mergePartnerId.value = null;
  mergeSearchQuery.value = "";
  selectedInspectorEntityId.value = survivorId;
  selectedInspectorRelId.value = null;
};

const saveEditEntity = (ent: AggregatedNerEntity) => {
  const cleanName = editEntityName.value.trim();
  if (!cleanName) return;
  const nextEntityId = normalizeEntityKey(editEntityClass.value, cleanName);
  emit("update-entity", {
    targetEntityId: ent.id,
    newCanonicalName: cleanName,
    newNerClass: editEntityClass.value,
    preserveAliases: editEntityKeepAlias.value,
  });
  isEditingEntity.value = false;
  selectedInspectorEntityId.value = nextEntityId;
  selectedInspectorRelId.value = null;
};

const confirmRemoveEntity = (ent: AggregatedNerEntity) => {
  emit("delete-entity", ent.id);
  closeInspectorDrawer();
};

const syncTargetClassFromExisting = (name: string, setter: (cls: NerClassId) => void) => {
  const cleanLower = name.trim().toLowerCase();
  if (!cleanLower) return;
  const match = props.index.entities.find(
    (e) =>
      e.canonicalName.toLowerCase() === cleanLower ||
      e.aliases.some((a) => a.toLowerCase() === cleanLower)
  );
  if (match) setter(match.nerClass);
};

const toggleAddEntityRelation = (_ent: AggregatedNerEntity) => {
  if (isAddingEntityRelation.value) {
    isAddingEntityRelation.value = false;
    return;
  }
  confirmDeleteEntity.value = false;
  isEditingEntity.value = false;
  addRelOutgoing.value = true;
  addRelClass.value = "affiliated_with";
  addRelTargetName.value = "";
  addRelTargetClass.value = "organization";
  addRelPostKey.value = availableEntityPostOptions.value[0]?.postKey || "";
  addRelQuote.value = "";
  isAddingEntityRelation.value = true;
};

const submitAddEntityRelation = (ent: AggregatedNerEntity) => {
  const targetClean = addRelTargetName.value.trim();
  const postKey = addRelPostKey.value;
  if (!targetClean || !postKey) return;
  const entKey = normalizeEntityKey(ent.nerClass, ent.canonicalName);
  const targetKey = normalizeEntityKey(addRelTargetClass.value, targetClean);
  if (entKey === targetKey) return;

  const postOpt = availableEntityPostOptions.value.find((p) => p.postKey === postKey);
  const subjectName = addRelOutgoing.value ? ent.canonicalName : targetClean;
  const subjectClass = addRelOutgoing.value ? ent.nerClass : addRelTargetClass.value;
  const objectName = addRelOutgoing.value ? targetClean : ent.canonicalName;
  const objectClass = addRelOutgoing.value ? addRelTargetClass.value : ent.nerClass;

  emit("create-relation", {
    postKey,
    timestampMs: postOpt?.timestampMs || 0,
    subjectName,
    subjectClass,
    relationClass: addRelClass.value,
    objectName,
    objectClass,
    evidenceQuote: addRelQuote.value.trim() || undefined,
  });
  isAddingEntityRelation.value = false;
  addRelTargetName.value = "";
  addRelQuote.value = "";
};

const openRelationInspector = (rel: AggregatedNerRelation, openEditor = false) => {
  resetAllEditorStates();
  selectedInspectorEntityId.value = null;
  selectedInspectorRelId.value = rel.id;
  if (openEditor) {
    startEditRelation(rel);
  }
};

const confirmRemoveLinkedRelation = (relId: string) => {
  emit("delete-relation", { targetRelationId: relId });
  confirmDeleteLinkedRelId.value = null;
};

const startEditRelation = (rel: AggregatedNerRelation, occ?: RelationOccurrence) => {
  if (!occ && isEditingRelation.value && !editRelOnlyPostKey.value) {
    cancelEditRelation();
    return;
  }
  confirmDeleteRelation.value = false;
  editRelSubjName.value = rel.subjectName;
  editRelSubjClass.value = rel.subjectClass;
  editRelClass.value = rel.relationClass;
  editRelObjName.value = rel.objectName;
  editRelObjClass.value = rel.objectClass;
  editRelOnlyPostKey.value = occ?.postKey;
  editRelTargetQuote.value = occ ? occ.evidenceQuote : undefined;
  editRelQuote.value = occ?.evidenceQuote || "";
  isEditingRelation.value = true;
};

const swapEditRelationEndpoints = () => {
  const prevName = editRelSubjName.value;
  const prevClass = editRelSubjClass.value;
  editRelSubjName.value = editRelObjName.value;
  editRelSubjClass.value = editRelObjClass.value;
  editRelObjName.value = prevName;
  editRelObjClass.value = prevClass;
};

const saveEditRelation = (rel: AggregatedNerRelation) => {
  const subjClean = editRelSubjName.value.trim();
  const objClean = editRelObjName.value.trim();
  if (!subjClean || !objClean) return;
  const subjId = normalizeEntityKey(editRelSubjClass.value, subjClean);
  const objId = normalizeEntityKey(editRelObjClass.value, objClean);
  if (subjId === objId) return;

  const nextRelId = buildNerRelationKey(subjId, editRelClass.value, objId);
  emit("update-relation", {
    targetRelationId: rel.id,
    newSubjectName: subjClean,
    newSubjectClass: editRelSubjClass.value,
    newRelationClass: editRelClass.value,
    newObjectName: objClean,
    newObjectClass: editRelObjClass.value,
    newQuote: editRelOnlyPostKey.value ? editRelQuote.value : undefined,
    onlyPostKey: editRelOnlyPostKey.value,
    targetOccurrenceQuote: editRelTargetQuote.value,
  });

  selectedInspectorRelId.value = nextRelId;
  selectedInspectorEntityId.value = null;
  cancelEditRelation();
};

const cancelEditRelation = () => {
  isEditingRelation.value = false;
  editRelOnlyPostKey.value = undefined;
  editRelTargetQuote.value = undefined;
};

const confirmRemoveRelation = (rel: AggregatedNerRelation) => {
  emit("delete-relation", { targetRelationId: rel.id });
  closeInspectorDrawer();
};

const startEditSingleOccurrence = (rel: AggregatedNerRelation, occ: RelationOccurrence) => {
  startEditRelation(rel, occ);
};

const removeSingleOccurrence = (rel: AggregatedNerRelation, occ: RelationOccurrence) => {
  emit("delete-relation", {
    targetRelationId: rel.id,
    onlyPostKey: occ.postKey,
    targetOccurrenceQuote: occ.evidenceQuote,
  });
  if (rel.occurrences.length <= 1) {
    closeInspectorDrawer();
  }
};

const inspectAndEditTimelineClaim = (item: TimelineClaimItem) => {
  modalMode.value = "directory";
  openRelationInspector(item.relation, false);
  startEditRelation(item.relation, item.occurrence);
};

const confirmRemoveTimelineClaim = (item: TimelineClaimItem) => {
  emit("delete-relation", {
    targetRelationId: item.relation.id,
    onlyPostKey: item.occurrence.postKey,
    targetOccurrenceQuote: item.occurrence.evidenceQuote,
  });
  confirmDeleteTimelineUid.value = null;
};

const toggleDirSort = (field: "name" | "mentions" | "firstSeen" | "lastSeen") => {
  if (dirSortField.value === field) {
    dirSortAsc.value = !dirSortAsc.value;
  } else {
    dirSortField.value = field;
    dirSortAsc.value = field === "name";
  }
};

// Jump Actions -> Filter Explorer Feed + Scroll to Quote
const jumpToEntity = (ent: AggregatedNerEntity) => {
  emit(
    "select-filter",
    {
      type: "entity",
      id: ent.id,
      label: ent.canonicalName,
      sublabel: t(`explorer.ner.classes.${ent.nerClass}`),
      postKeys: ent.postKeys,
      quotes: ent.sampleQuotes,
      surfaceTerms: Array.from(new Set([ent.canonicalName, ...ent.aliases])),
    },
    ent.postKeys[0]
  );
  emit("close");
};

const jumpToSingleQuote = (
  ent: AggregatedNerEntity,
  q: { postKey: string; timestampMs: number; quote: string }
) => {
  emit(
    "select-filter",
    {
      type: "entity",
      id: ent.id,
      label: ent.canonicalName,
      sublabel: t(`explorer.ner.classes.${ent.nerClass}`),
      postKeys: ent.postKeys,
      quotes: [q, ...ent.sampleQuotes.filter((x) => x.postKey !== q.postKey)],
      surfaceTerms: Array.from(new Set([ent.canonicalName, ...ent.aliases])),
    },
    q.postKey
  );
  emit("close");
};

const jumpToRelation = (rel: AggregatedNerRelation) => {
  emit(
    "select-filter",
    {
      type: "relation",
      id: rel.id,
      label: `${rel.subjectName} → ${t(`explorer.ner.relations.${rel.relationClass}`)} → ${rel.objectName}`,
      sublabel: formatNerTimestamp(rel.latestTimestampMs),
      postKeys: rel.postKeys,
      quotes: rel.occurrences.map((o) => ({
        postKey: o.postKey,
        timestampMs: o.timestampMs,
        quote: o.evidenceQuote,
      })),
      surfaceTerms: [rel.subjectName, rel.objectName],
    },
    rel.postKeys[0]
  );
  emit("close");
};

const jumpToSingleRelationOccurrence = (
  rel: AggregatedNerRelation,
  occ: RelationOccurrence
) => {
  emit(
    "select-filter",
    {
      type: "relation",
      id: rel.id,
      label: `${rel.subjectName} → ${t(`explorer.ner.relations.${rel.relationClass}`)} → ${rel.objectName}`,
      sublabel: formatNerTimestamp(occ.timestampMs),
      postKeys: rel.postKeys,
      quotes: [
        { postKey: occ.postKey, timestampMs: occ.timestampMs, quote: occ.evidenceQuote },
        ...rel.occurrences
          .filter((x) => x.postKey !== occ.postKey)
          .map((o) => ({
            postKey: o.postKey,
            timestampMs: o.timestampMs,
            quote: o.evidenceQuote,
          })),
      ],
      surfaceTerms: [rel.subjectName, rel.objectName],
    },
    occ.postKey
  );
  emit("close");
};

const jumpToTimelineClaim = (item: TimelineClaimItem) => {
  jumpToSingleRelationOccurrence(item.relation, item.occurrence);
};

// ---------------------------------------------------------------------------
// Cytoscape Interactive Force-Directed Graph (Mode 2)
// Runs Cytoscape's CoSE physics + Spatial-Hash collision detection in Web Worker
// and tunes Cytoscape viewport culling/haystack batching for 10k+ nodes & edges.
// ---------------------------------------------------------------------------

const graphWrapperRef = ref<HTMLDivElement | null>(null);
const graphContainerRef = ref<HTMLDivElement | null>(null);
const graphNodesCount = ref(0);
const graphEdgesCount = ref(0);
const isGraphLayouting = ref(false);

let cyInstance: cytoscape.Core | null = null;
let layoutWorker: Worker | null = null;
let resizeObserver: ResizeObserver | null = null;
let activeLayoutReqId = 0;
let activeWorkerNodeIds: string[] = [];
let hoveredNodeId: string | null = null;
let hoveredEdgeId: string | null = null;
let totalGraphElementsCount = 0;
let isUnmounted = false;
let wheelTargetEl: HTMLElement | null = null;
let wheelRafId: number | null = null;
let pendingWheelDelta = 0;
let pendingWheelX = 0;
let pendingWheelY = 0;

const truncateGraphLabel = (label: string, maxLen = 22): string => {
  if (label.length <= maxLen) return label;
  return `${label.slice(0, maxLen - 1)}…`;
};

const estimateLabelHalfWidth = (shortLabel: string): number => {
  let units = 0;
  for (let i = 0; i < shortLabel.length; i++) {
    units += shortLabel.charCodeAt(i) > 255 ? 10 : 5.8;
  }
  return Math.max(18, Math.min(82, units * 0.5 + 6));
};

const onGraphContainerWheel = (ev: WheelEvent) => {
  if (!cyInstance || !wheelTargetEl) return;
  ev.preventDefault();
  ev.stopPropagation();

  let dy = ev.deltaY;
  if (ev.deltaMode === 1) dy *= 28;
  else if (ev.deltaMode === 2) dy *= 120;
  if (dy === 0) return;

  dy = Math.max(-240, Math.min(240, dy));
  pendingWheelDelta += dy;

  const rect = wheelTargetEl.getBoundingClientRect();
  pendingWheelX = ev.clientX - rect.left;
  pendingWheelY = ev.clientY - rect.top;

  if (wheelRafId === null) {
    wheelRafId = requestAnimationFrame(() => {
      wheelRafId = null;
      if (!cyInstance || pendingWheelDelta === 0) return;
      const delta = pendingWheelDelta;
      pendingWheelDelta = 0;
      const factor = Math.exp(-delta * 0.0022);
      const nextZoom = Math.min(4, Math.max(0.02, cyInstance.zoom() * factor));
      cyInstance.zoom({
        level: nextZoom,
        renderedPosition: {
          x: pendingWheelX,
          y: pendingWheelY,
        },
      });
    });
  }
};

const detachWheelZoom = () => {
  if (wheelRafId !== null) {
    cancelAnimationFrame(wheelRafId);
    wheelRafId = null;
  }
  pendingWheelDelta = 0;
  if (wheelTargetEl) {
    wheelTargetEl.removeEventListener("wheel", onGraphContainerWheel, true);
    wheelTargetEl = null;
  }
};

const destroyCytoscape = () => {
  detachWheelZoom();
  if (cyInstance) {
    cyInstance.destroy();
    cyInstance = null;
  }
  hoveredNodeId = null;
  hoveredEdgeId = null;
};

const getCytoscapeStylesheet = (
  isDark: boolean,
  isLargeEdgeGraph: boolean
): cytoscape.StylesheetStyle[] => {
  const edgeOpacity = isLargeEdgeGraph ? 0.34 : 0.56;
  const labelBg = isDark ? "#0f172a" : "#ffffff";
  const labelFg = isDark ? "#f1f5f9" : "#0f172a";
  const nodeBorder = isDark ? "#1e293b" : "#ffffff";
  const activeBorder = isDark ? "#ffffff" : "#0f172a";

  return [
    {
      selector: "node",
      style: {
        width: "data(size)",
        height: "data(size)",
        "background-color": "data(color)",
        "border-width": 1.5,
        "border-color": nodeBorder,
        label: "data(shortLabel)",
        "font-size": 10,
        "font-weight": 600,
        color: labelFg,
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 4,
        "text-background-color": labelBg,
        "text-background-opacity": 0.82,
        "text-background-padding": "2px",
        "text-background-shape": "rectangle",
        "min-zoomed-font-size": 9,
      },
    },
    {
      selector: "edge",
      style: isLargeEdgeGraph
        ? {
            "curve-style": "haystack",
            "haystack-radius": 0.25,
            width: "data(width)",
            "line-color": "data(color)",
            opacity: edgeOpacity,
          }
        : {
            "curve-style": "bezier",
            "control-point-step-size": 26,
            width: "data(width)",
            "line-color": "data(color)",
            "target-arrow-color": "data(color)",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.78,
            opacity: edgeOpacity,
          },
    },
    {
      selector: ".ner-dim",
      style: {
        opacity: 0.14,
      },
    },
    {
      selector: "edge.ner-focus",
      style: {
        opacity: 0.96,
        width: 2.5,
        "line-color": "#0d9488",
        "target-arrow-color": "#0d9488",
        label: "data(relationLabel)",
        "font-size": 9,
        "font-weight": 600,
        color: isDark ? "#e2e8f0" : "#334155",
        "text-background-color": labelBg,
        "text-background-opacity": 0.88,
        "text-background-padding": "2px",
        "text-background-shape": "roundrectangle",
        "text-rotation": "autorotate",
        "min-zoomed-font-size": 7,
        "z-index": 20,
      },
    },
    {
      selector: "node.ner-focus",
      style: {
        opacity: 1,
        "border-width": 3,
        "border-color": activeBorder,
        label: "data(label)",
        "font-size": 11,
        "font-weight": 700,
        "min-zoomed-font-size": 0,
        "z-index": 30,
      },
    },
  ];
};

const syncGraphHighlights = (allowDimming = true) => {
  if (!cyInstance) return;
  const focusNodeId = hoveredNodeId || selectedInspectorEntityId.value;
  const focusRelId = hoveredEdgeId || selectedInspectorRelId.value;

  cyInstance.batch(() => {
    const all = cyInstance!.elements();
    all.removeClass("ner-dim ner-focus");

    if (!focusNodeId && !focusRelId) return;

    const focusedEles = cyInstance!.collection();
    if (focusNodeId) {
      const node = cyInstance!.getElementById(focusNodeId);
      if (node.nonempty()) {
        focusedEles.merge(node);
        focusedEles.merge(node.connectedEdges());
        if (totalGraphElementsCount <= 3000 || selectedInspectorEntityId.value === focusNodeId) {
          focusedEles.merge(node.neighborhood("node"));
        }
      }
    } else if (focusRelId) {
      const edge = cyInstance!.getElementById(`e:${focusRelId}`);
      if (edge.nonempty()) {
        focusedEles.merge(edge);
        focusedEles.merge(edge.connectedNodes());
      }
    }

    if (focusedEles.nonempty()) {
      if (allowDimming || totalGraphElementsCount <= 2500) {
        all.not(focusedEles).addClass("ner-dim");
      }
      focusedEles.addClass("ner-focus");
    }
  });
};

const applySettledPositions = (
  reqId: number,
  positions: Float64Array,
  nodeIds: string[]
) => {
  if (
    isUnmounted ||
    reqId !== activeLayoutReqId ||
    !cyInstance ||
    !props.open ||
    modalMode.value !== "graph"
  ) {
    return;
  }

  cyInstance.batch(() => {
    const count = Math.min(nodeIds.length, Math.floor(positions.length / 2));
    for (let i = 0; i < count; i++) {
      const node = cyInstance!.getElementById(nodeIds[i]);
      if (node.nonempty()) {
        node.position({
          x: positions[i * 2],
          y: positions[i * 2 + 1],
        });
      }
    }
  });

  cyInstance.fit(undefined, 40);
  isGraphLayouting.value = false;
};

const ensureLayoutWorker = (): Worker | null => {
  if (layoutWorker) return layoutWorker;
  if (typeof Worker === "undefined") return null;
  try {
    layoutWorker = new Worker(
      new URL("../../workers/nerGraphLayout.worker.ts", import.meta.url),
      { type: "module" }
    );
    layoutWorker.onmessage = (ev: MessageEvent<NerGraphLayoutResponse>) => {
      const { id, positions } = ev.data;
      if (id !== activeLayoutReqId) return;
      applySettledPositions(id, positions, activeWorkerNodeIds);
    };
    layoutWorker.onerror = () => {
      isGraphLayouting.value = false;
    };
    return layoutWorker;
  } catch {
    return null;
  }
};

const buildGraphData = async () => {
  const container = graphContainerRef.value;
  if (!container || !props.open || modalMode.value !== "graph") return;

  const reqId = ++activeLayoutReqId;
  const { default: cytoscapeLib } = await import("cytoscape");
  if (isUnmounted || reqId !== activeLayoutReqId || !graphContainerRef.value) return;

  const workerNodes: WorkerGraphNodeInput[] = [];
  const workerEdges: WorkerGraphEdgeInput[] = [];
  const nodeIds: string[] = [];
  const cyNodes: cytoscape.ElementDefinition[] = [];
  const cyEdges: cytoscape.ElementDefinition[] = [];
  const addedNodeIds = new Set<string>();
  const addedEdgeIds = new Set<string>();

  const ensureEntityNode = (entId: string): boolean => {
    if (addedNodeIds.has(entId)) return true;
    const ent = props.index.entityById.get(entId);
    if (!ent) return false;
    addedNodeIds.add(entId);

    const shortLabel = truncateGraphLabel(ent.canonicalName);
    const radius = Math.min(20, Math.max(8, 7 + Math.sqrt(ent.mentionCount) * 2.2));
    const labelHalfW = estimateLabelHalfWidth(shortLabel);
    const color = NER_CLASS_MAP.get(ent.nerClass)?.accentHex || "#0f766e";

    nodeIds.push(ent.id);
    workerNodes.push({
      id: ent.id,
      radius,
      labelHalfW,
      mentions: ent.mentionCount,
    });

    const idx = nodeIds.length - 1;
    const cols = Math.max(8, Math.ceil(Math.sqrt(Math.max(16, filteredDirectoryEntities.value.length))));
    const seedX = (idx % cols) * 140;
    const seedY = Math.floor(idx / cols) * 90;

    cyNodes.push({
      group: "nodes",
      data: {
        id: ent.id,
        label: ent.canonicalName,
        shortLabel,
        color,
        size: radius * 2,
      },
      position: { x: seedX, y: seedY },
    });
    return true;
  };

  for (const rel of filteredRelations.value) {
    if (!ensureEntityNode(rel.subjectId) || !ensureEntityNode(rel.objectId)) continue;
    const edgeId = `e:${rel.id}`;
    if (addedEdgeIds.has(edgeId)) continue;
    addedEdgeIds.add(edgeId);

    const meta = RELATION_CLASS_MAP.get(rel.relationClass);
    const relationLabel = t(`explorer.ner.relations.${rel.relationClass}`);
    workerEdges.push({
      id: edgeId,
      source: rel.subjectId,
      target: rel.objectId,
    });
    cyEdges.push({
      group: "edges",
      data: {
        id: edgeId,
        relId: rel.id,
        source: rel.subjectId,
        target: rel.objectId,
        relationLabel,
        color: meta?.accentHex || "#64748b",
        width: Math.min(2.6, 1 + rel.occurrences.length * 0.24),
      },
    });
  }

  for (const ent of filteredDirectoryEntities.value) {
    ensureEntityNode(ent.id);
  }

  graphNodesCount.value = cyNodes.length;
  graphEdgesCount.value = cyEdges.length;
  totalGraphElementsCount = cyNodes.length + cyEdges.length;
  activeWorkerNodeIds = nodeIds;

  destroyCytoscape();

  const isDark = document.documentElement.classList.contains("dark");
  const isLargeGraph = totalGraphElementsCount > 350;
  const isLargeEdgeGraph = cyEdges.length > 1500;

  cyInstance = cytoscapeLib({
    container: graphContainerRef.value,
    elements: [...cyNodes, ...cyEdges],
    layout: {
      name: "preset",
      fit: true,
      padding: 36,
    },
    style: getCytoscapeStylesheet(isDark, isLargeEdgeGraph),
    pixelRatio: 1,
    hideEdgesOnViewport: isLargeGraph,
    textureOnViewport: totalGraphElementsCount > 600,
    motionBlur: false,
    boxSelectionEnabled: false,
    minZoom: 0.02,
    maxZoom: 4,
  });

  if (graphContainerRef.value) {
    wheelTargetEl = graphContainerRef.value;
    wheelTargetEl.addEventListener("wheel", onGraphContainerWheel, {
      passive: false,
      capture: true,
    });
  }

  cyInstance.on("tap", "node", (ev) => {
    const id = ev.target.id();
    resetAllEditorStates();
    selectedInspectorEntityId.value = id;
    selectedInspectorRelId.value = null;
    syncGraphHighlights(true);
  });

  cyInstance.on("tap", "edge", (ev) => {
    const relId = ev.target.data("relId") as string | undefined;
    if (relId) {
      resetAllEditorStates();
      selectedInspectorRelId.value = relId;
      selectedInspectorEntityId.value = null;
      syncGraphHighlights(true);
    }
  });

  cyInstance.on("tap", (ev) => {
    if (ev.target === cyInstance) {
      closeInspectorDrawer();
      syncGraphHighlights(true);
    }
  });

  cyInstance.on("mouseover", "node", (ev) => {
    hoveredNodeId = ev.target.id();
    hoveredEdgeId = null;
    syncGraphHighlights(totalGraphElementsCount <= 2500);
  });

  cyInstance.on("mouseover", "edge", (ev) => {
    hoveredEdgeId = (ev.target.data("relId") as string | undefined) || null;
    hoveredNodeId = null;
    syncGraphHighlights(totalGraphElementsCount <= 2500);
  });

  cyInstance.on("mouseout", "node, edge", () => {
    if (hoveredNodeId !== null || hoveredEdgeId !== null) {
      hoveredNodeId = null;
      hoveredEdgeId = null;
      syncGraphHighlights(selectedInspectorEntityId.value !== null || selectedInspectorRelId.value !== null);
    }
  });

  syncGraphHighlights(true);

  if (workerNodes.length === 0) {
    isGraphLayouting.value = false;
    return;
  }

  isGraphLayouting.value = true;
  const worker = ensureLayoutWorker();
  if (worker) {
    const payload: NerGraphLayoutRequest = {
      id: reqId,
      nodes: workerNodes,
      edges: workerEdges,
    };
    worker.postMessage(payload);
  } else {
    const { computeNerGraphLayout } = await import("../../utils/nerGraphLayoutSolver");
    if (isUnmounted || reqId !== activeLayoutReqId) return;
    const positions = computeNerGraphLayout(workerNodes, workerEdges);
    applySettledPositions(reqId, positions, nodeIds);
  }
};

const zoomGraph = (factor: number) => {
  if (!cyInstance) return;
  const targetZoom = Math.min(4, Math.max(0.02, cyInstance.zoom() * factor));
  cyInstance.zoom({
    level: targetZoom,
    renderedPosition: {
      x: cyInstance.width() * 0.5,
      y: cyInstance.height() * 0.5,
    },
  });
};

const resetGraphLayout = () => {
  hoveredNodeId = null;
  hoveredEdgeId = null;
  void buildGraphData();
};

watch(
  [() => props.open, modalMode, filteredRelations, filteredDirectoryEntities],
  () => {
    if (!props.open) {
      resetAllEditorStates();
    }
    if (props.open && modalMode.value === "graph") {
      nextTick(() => {
        if (graphWrapperRef.value && !resizeObserver && typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            cyInstance?.resize();
          });
          resizeObserver.observe(graphWrapperRef.value);
        }
        void buildGraphData();
      });
    } else {
      activeLayoutReqId += 1;
      isGraphLayouting.value = false;
      destroyCytoscape();
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
    }
  }
);

watch([selectedInspectorEntityId, selectedInspectorRelId], () => {
  if (props.open && modalMode.value === "graph") {
    syncGraphHighlights(true);
  }
});

onBeforeUnmount(() => {
  isUnmounted = true;
  activeLayoutReqId += 1;
  destroyCytoscape();
  if (layoutWorker) {
    layoutWorker.terminate();
    layoutWorker = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});
</script>
