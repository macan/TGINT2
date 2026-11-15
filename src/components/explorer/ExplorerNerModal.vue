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
      class="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-5"
      @click="$emit('close')"
    >
      <div
        class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden border border-gray-200/70 dark:border-gray-700/70"
        @click.stop
      >
        <!-- Modal Top Header -->
        <div class="px-6 py-4 border-b border-gray-200/70 dark:border-gray-700/70 flex flex-wrap items-center justify-between gap-4 shrink-0">
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
        <div class="px-6 py-3 bg-gray-50/70 dark:bg-gray-900/40 border-b border-gray-200/70 dark:border-gray-700/70 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <!-- Mode Tabs -->
          <div class="flex items-center gap-1 p-1 bg-gray-200/70 dark:bg-gray-800 rounded-xl shrink-0">
            <button
              type="button"
              @click="modalMode = 'directory'"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5',
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
          </div>
        </div>

        <!-- Main Modal Body -->
        <div class="flex-1 min-h-0 flex overflow-hidden">
          <!-- MODE 1: ENTITY DIRECTORY -->
          <template v-if="modalMode === 'directory'">
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
                    @click="selectedInspectorEntityId = ent.id; selectedInspectorRelId = null"
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

          <!-- MODE 2: INTERACTIVE ENTITY-RELATION GRAPH -->
          <template v-else-if="modalMode === 'graph'">
            <div ref="graphWrapperRef" class="flex-1 min-w-0 relative bg-gray-50/60 dark:bg-gray-950/60 overflow-hidden">
              <canvas
                ref="graphCanvasRef"
                @mousedown="onGraphMouseDown"
                @mousemove="onGraphMouseMove"
                @mouseup="onGraphMouseUp"
                @mouseleave="onGraphMouseUp"
                @wheel.prevent="onGraphWheel"
                class="block w-full h-full cursor-grab active:cursor-grabbing"
              ></canvas>

              <!-- Graph Zoom Controls -->
              <div class="absolute top-3 right-3 flex items-center gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xs border border-gray-200/70 dark:border-gray-700 rounded-xl p-1 shadow-xs">
                <button
                  type="button"
                  @click="zoomGraph(1.2)"
                  class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 cursor-pointer"
                  :title="t('explorer.zoomIn')"
                >
                  <ZoomIn class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  @click="zoomGraph(0.83)"
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
              <div class="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xs border border-gray-200/70 dark:border-gray-700 rounded-xl text-[10px] text-gray-500 dark:text-gray-400 pointer-events-none">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span v-for="cls in NER_CLASSES" :key="cls.id" class="inline-flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full shrink-0" :style="{ backgroundColor: cls.accentHex }"></span>
                    <span>{{ t(`explorer.ner.classes.${cls.id}`) }}</span>
                  </span>
                </div>
                <span class="font-mono tabular-nums">
                  {{ graphNodesCount }} {{ t('explorer.ner.entitiesShort') }} · {{ graphEdgesCount }} {{ t('explorer.ner.relationsShort') }}
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

                    <button
                      type="button"
                      @click="jumpToTimelineClaim(item)"
                      class="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start"
                    >
                      {{ t('explorer.ner.jumpToPost') }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- Right Inspector Drawer (Visible in Directory & Graph when an entity/relation is selected) -->
          <div
            v-if="modalMode !== 'timeline' && (inspectedEntity || inspectedRelation)"
            class="w-80 lg:w-96 border-l border-gray-200/70 dark:border-gray-700/70 bg-gray-50/60 dark:bg-gray-900/40 p-5 overflow-y-auto shrink-0 space-y-5 custom-scrollbar"
          >
            <div v-if="inspectedEntity" class="space-y-4">
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
                <button
                  type="button"
                  @click="selectedInspectorEntityId = null"
                  class="p-1 text-gray-400 hover:text-gray-600 cursor-pointer"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                @click="jumpToEntity(inspectedEntity)"
                class="w-full py-2 px-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                {{ t('explorer.ner.filterAndJump') }}
              </button>

              <!-- Aliases -->
              <div v-if="inspectedEntity.aliases.length > 0" class="space-y-1">
                <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                  {{ t('explorer.ner.aliasesLabel') }}
                </div>
                <p class="text-xs text-gray-700 dark:text-gray-300">
                  {{ inspectedEntity.aliases.join(' · ') }}
                </p>
              </div>

              <!-- Related Timestamped Claims -->
              <div v-if="inspectedEntityRelations.length > 0" class="space-y-2">
                <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                  {{ t('explorer.ner.linkedRelations') }} ({{ inspectedEntityRelations.length }})
                </div>
                <div class="divide-y divide-gray-200/60 dark:divide-gray-700/60">
                  <button
                    v-for="rel in inspectedEntityRelations"
                    :key="rel.id"
                    type="button"
                    @click="jumpToRelation(rel)"
                    class="w-full text-left py-2 hover:bg-white/80 dark:hover:bg-gray-800/70 px-1.5 rounded-lg transition-colors cursor-pointer space-y-0.5"
                  >
                    <div class="text-xs font-semibold text-gray-900 dark:text-gray-100">
                      {{ rel.subjectName }} → {{ t(`explorer.ner.relations.${rel.relationClass}`) }} → {{ rel.objectName }}
                    </div>
                    <div class="text-[10px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
                      {{ formatNerTimestamp(rel.latestTimestampMs) }} · {{ rel.occurrences.length }}×
                    </div>
                  </button>
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
                <button
                  type="button"
                  @click="selectedInspectorRelId = null"
                  class="p-1 text-gray-400 hover:text-gray-600 cursor-pointer"
                >
                  <X class="w-4 h-4" />
                </button>
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
                  <div class="flex items-center justify-between text-[10px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
                    <span>{{ formatNerTimestamp(occ.timestampMs) }}</span>
                    <button
                      type="button"
                      @click="jumpToSingleRelationOccurrence(inspectedRelation, occ)"
                      class="text-teal-600 dark:text-teal-400 font-sans font-bold hover:underline cursor-pointer"
                    >
                      {{ t('explorer.ner.jumpToPost') }}
                    </button>
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
  Clock,
  Network,
  RotateCcw,
  ScanSearch,
  Search,
  Square,
  Table2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";
import {
  NER_CLASSES,
  NER_CLASS_MAP,
  RELATION_CLASSES,
  RELATION_CLASS_MAP,
  formatNerDateDay,
  formatNerTimestamp,
  type ActiveNerFeedFilter,
  type AggregatedNerEntity,
  type AggregatedNerIndex,
  type AggregatedNerRelation,
  type NerClassId,
  type RelationClassId,
  type RelationOccurrence,
} from "../../utils/explorerNer";

const props = defineProps<{
  open: boolean;
  channelName: string;
  index: AggregatedNerIndex;
  totalPostsCount: number;
  uncachedCount: number;
  isExtracting: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "extract", forceReextract: boolean): void;
  (e: "cancel"): void;
  (e: "select-filter", filter: ActiveNerFeedFilter, targetPostKey?: string): void;
}>();

const { t } = useI18n();

const modalMode = ref<"directory" | "graph" | "timeline">("directory");
const query = ref("");
const nerClassFilter = ref<"all" | NerClassId>("all");
const relClassFilter = ref<"all" | RelationClassId>("all");
const dateFrom = ref("");
const dateTo = ref("");
const timelineDesc = ref(true);

const dirSortField = ref<"name" | "mentions" | "firstSeen" | "lastSeen">("mentions");
const dirSortAsc = ref(false);

const selectedInspectorEntityId = ref<string | null>(null);
const selectedInspectorRelId = ref<string | null>(null);

const dateRangeMs = computed(() => {
  const start = dateFrom.value ? new Date(`${dateFrom.value}T00:00:00`).getTime() : 0;
  const end = dateTo.value ? new Date(`${dateTo.value}T23:59:59.999`).getTime() : Infinity;
  return { start, end };
});

const totalRelationOccurrences = computed(() =>
  props.index.relations.reduce((sum, r) => sum + r.occurrences.length, 0)
);

const getNerMeta = (id: NerClassId) => NER_CLASS_MAP.get(id);

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
// Interactive Canvas Force Graph (Mode 2)
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string;
  label: string;
  nerClass: NerClassId;
  mentions: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface GraphEdge {
  relId: string;
  source: GraphNode;
  target: GraphNode;
  relationClass: RelationClassId;
  weight: number;
}

const graphWrapperRef = ref<HTMLDivElement | null>(null);
const graphCanvasRef = ref<HTMLCanvasElement | null>(null);
const graphNodesCount = ref(0);
const graphEdgesCount = ref(0);

let nodes: GraphNode[] = [];
let edges: GraphEdge[] = [];
let scale = 1;
let offsetX = 0;
let offsetY = 0;
let isDraggingBg = false;
let draggedNode: GraphNode | null = null;
let lastPointerX = 0;
let lastPointerY = 0;
let dragMoved = false;
let animFrameId: number | null = null;

const buildGraphData = () => {
  const relList = filteredRelations.value.slice(0, 90);
  const nodeMap = new Map<string, GraphNode>();

  const addNodeById = (entId: string) => {
    if (nodeMap.has(entId)) return nodeMap.get(entId)!;
    const ent = props.index.entityById.get(entId);
    if (!ent) return null;
    const idx = nodeMap.size;
    const angle = (idx * 137.5 * Math.PI) / 180;
    const dist = 45 + Math.sqrt(idx + 1) * 32;
    const gn: GraphNode = {
      id: ent.id,
      label: ent.canonicalName,
      nerClass: ent.nerClass,
      mentions: ent.mentionCount,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      vx: 0,
      vy: 0,
      radius: Math.min(22, Math.max(8, 7 + Math.sqrt(ent.mentionCount) * 2.5)),
    };
    nodeMap.set(ent.id, gn);
    return gn;
  };

  const builtEdges: GraphEdge[] = [];
  for (const rel of relList) {
    const s = addNodeById(rel.subjectId);
    const o = addNodeById(rel.objectId);
    if (s && o) {
      builtEdges.push({
        relId: rel.id,
        source: s,
        target: o,
        relationClass: rel.relationClass,
        weight: rel.occurrences.length,
      });
    }
  }

  // Include top isolated filtered entities if graph has room
  for (const ent of filteredDirectoryEntities.value.slice(0, 35)) {
    if (nodeMap.size >= 60) break;
    addNodeById(ent.id);
  }

  nodes = Array.from(nodeMap.values());
  edges = builtEdges;
  graphNodesCount.value = nodes.length;
  graphEdgesCount.value = edges.length;

  // Run quick settle ticks
  for (let iter = 0; iter < 85; iter++) {
    stepForceSimulation(0.85);
  }
  drawGraph();
};

const stepForceSimulation = (damping: number) => {
  const n = nodes.length;
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    // Gentle center pull
    a.vx += -a.x * 0.004;
    a.vy += -a.y * 0.004;

    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 1) distSq = 1;
      const force = 1100 / distSq;
      const dist = Math.sqrt(distSq);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  for (const edge of edges) {
    const dx = edge.target.x - edge.source.x;
    const dy = edge.target.y - edge.source.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const targetDist = 115;
    const pull = (dist - targetDist) * 0.035;
    const fx = (dx / dist) * pull;
    const fy = (dy / dist) * pull;
    edge.source.vx += fx;
    edge.source.vy += fy;
    edge.target.vx -= fx;
    edge.target.vy -= fy;
  }

  for (const node of nodes) {
    if (node === draggedNode) continue;
    node.vx *= damping;
    node.vy *= damping;
    node.x += node.vx;
    node.y += node.vy;
  }
};

const drawGraph = () => {
  const canvas = graphCanvasRef.value;
  const wrapper = graphWrapperRef.value;
  if (!canvas || !wrapper) return;

  const rect = wrapper.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const isDark = document.documentElement.classList.contains("dark");
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.translate(rect.width / 2 + offsetX, rect.height / 2 + offsetY);
  ctx.scale(scale, scale);

  // Draw Edges
  for (const edge of edges) {
    const isSelectedEdge = selectedInspectorRelId.value === edge.relId;
    const meta = RELATION_CLASS_MAP.get(edge.relationClass);
    ctx.beginPath();
    ctx.moveTo(edge.source.x, edge.source.y);
    ctx.lineTo(edge.target.x, edge.target.y);
    ctx.strokeStyle = isSelectedEdge
      ? "#0d9488"
      : meta?.accentHex || (isDark ? "#475569" : "#94a3b8");
    ctx.globalAlpha = isSelectedEdge ? 0.95 : 0.45;
    ctx.lineWidth = isSelectedEdge ? 2.6 : Math.min(2.4, 1 + edge.weight * 0.25);
    ctx.stroke();

    // Relation mid-label when zoomed or selected
    if (scale >= 1.05 || isSelectedEdge) {
      const mx = (edge.source.x + edge.target.x) / 2;
      const my = (edge.source.y + edge.target.y) / 2;
      ctx.globalAlpha = 0.85;
      ctx.font = "500 9px sans-serif";
      ctx.fillStyle = isDark ? "#cbd5e1" : "#334155";
      ctx.textAlign = "center";
      ctx.fillText(t(`explorer.ner.relations.${edge.relationClass}`), mx, my - 3);
    }
  }

  // Draw Nodes
  for (const node of nodes) {
    const isSelected = selectedInspectorEntityId.value === node.id;
    const meta = NER_CLASS_MAP.get(node.nerClass);
    const fill = meta?.accentHex || "#0f766e";

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.lineWidth = isSelected ? 3 : 1.5;
    ctx.strokeStyle = isSelected ? (isDark ? "#ffffff" : "#0f172a") : (isDark ? "#1e293b" : "#ffffff");
    ctx.stroke();

    ctx.font = isSelected ? "700 11px sans-serif" : "600 10px sans-serif";
    ctx.fillStyle = isDark ? "#f1f5f9" : "#0f172a";
    ctx.textAlign = "center";
    ctx.fillText(node.label, node.x, node.y + node.radius + 12);
  }

  ctx.restore();
};

const screenToWorld = (clientX: number, clientY: number) => {
  const canvas = graphCanvasRef.value;
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  const sx = clientX - rect.left - rect.width / 2 - offsetX;
  const sy = clientY - rect.top - rect.height / 2 - offsetY;
  return { x: sx / scale, y: sy / scale };
};

const distToSegmentSq = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) => {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return (px - x1) ** 2 + (py - y1) ** 2;
  let tVal = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  tVal = Math.max(0, Math.min(1, tVal));
  const projX = x1 + tVal * (x2 - x1);
  const projY = y1 + tVal * (y2 - y1);
  return (px - projX) ** 2 + (py - projY) ** 2;
};

const onGraphMouseDown = (ev: MouseEvent) => {
  const world = screenToWorld(ev.clientX, ev.clientY);
  lastPointerX = ev.clientX;
  lastPointerY = ev.clientY;
  dragMoved = false;

  const hitNode = nodes.find((n) => {
    const dx = world.x - n.x;
    const dy = world.y - n.y;
    return dx * dx + dy * dy <= (n.radius + 5) ** 2;
  });

  if (hitNode) {
    draggedNode = hitNode;
    isDraggingBg = false;
  } else {
    draggedNode = null;
    isDraggingBg = true;
  }
};

const onGraphMouseMove = (ev: MouseEvent) => {
  if (!draggedNode && !isDraggingBg) return;
  const dx = ev.clientX - lastPointerX;
  const dy = ev.clientY - lastPointerY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;

  lastPointerX = ev.clientX;
  lastPointerY = ev.clientY;

  if (draggedNode) {
    draggedNode.x += dx / scale;
    draggedNode.y += dy / scale;
    drawGraph();
  } else if (isDraggingBg) {
    offsetX += dx;
    offsetY += dy;
    drawGraph();
  }
};

const onGraphMouseUp = (ev: MouseEvent) => {
  if (!dragMoved) {
    const world = screenToWorld(ev.clientX, ev.clientY);
    if (draggedNode) {
      selectedInspectorEntityId.value = draggedNode.id;
      selectedInspectorRelId.value = null;
      drawGraph();
    } else {
      // Check edge hit
      const hitEdge = edges.find(
        (e) =>
          distToSegmentSq(
            world.x,
            world.y,
            e.source.x,
            e.source.y,
            e.target.x,
            e.target.y
          ) <= (8 / scale) ** 2
      );
      if (hitEdge) {
        selectedInspectorRelId.value = hitEdge.relId;
        selectedInspectorEntityId.value = null;
        drawGraph();
      }
    }
  }
  draggedNode = null;
  isDraggingBg = false;
};

const onGraphWheel = (ev: WheelEvent) => {
  const factor = ev.deltaY < 0 ? 1.12 : 0.89;
  zoomGraph(factor);
};

const zoomGraph = (factor: number) => {
  scale = Math.min(3.5, Math.max(0.35, scale * factor));
  drawGraph();
};

const resetGraphLayout = () => {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  buildGraphData();
};

watch(
  [() => props.open, modalMode, filteredRelations, filteredDirectoryEntities],
  () => {
    if (props.open && modalMode.value === "graph") {
      nextTick(() => {
        buildGraphData();
      });
    }
  }
);

onBeforeUnmount(() => {
  if (animFrameId !== null) cancelAnimationFrame(animFrameId);
});
</script>
