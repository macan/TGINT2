<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "../../i18n";
import {
  Users,
  Activity,
  ExternalLink,
  Lock,
  Radio,
  Flame,
  ArrowRight
} from "lucide-vue-next";
import { formatDate, formatViews } from "../../utils/hotsEngine";

const props = withDefaults(
  defineProps<{
    channel: any;
    metadata?: any;
    compact?: boolean;
    isDark?: boolean;
    rank?: number;
  }>(),
  {
    compact: false,
    isDark: false
  }
);

const emit = defineEmits<{
  (e: "select-channel", channelId: string): void;
}>();

const { t } = useI18n();

const username = computed(() => {
  const meta = props.metadata;
  if (meta?.username) return meta.username.replace(/^@/, "");
  if (meta?.name) return meta.name.replace(/^@/, "");
  if (props.channel.channelUsername) return props.channel.channelUsername.replace(/^@/, "");
  if (props.channel.channelName) return props.channel.channelName.replace(/^@/, "");
  return String(props.channel.channelId || "").replace(/^@/, "");
});

const isPrivate = computed(() => {
  return username.value.startsWith("-100");
});

const channelTitle = computed(() => {
  return (
    props.metadata?.title ||
    props.metadata?.name ||
    props.channel.title ||
    props.channel.channelName ||
    username.value
  );
});

const avatarUrl = computed(() => {
  const meta = props.metadata;
  if (meta?.photo && typeof meta.photo === "string" && meta.photo.startsWith("data:")) {
    return meta.photo;
  }
  if (username.value) {
    return `https://i.gogingko.net/api/v1/v/telegram-profile/${username.value}`;
  }
  return props.channel.avatarUrl || "";
});

const subscribersCount = computed(() => {
  const meta = props.metadata;
  return meta?.subscribers ?? meta?.members ?? meta?.participants_count ?? props.channel.subscribers;
});

const onlineCount = computed(() => {
  const meta = props.metadata;
  return meta?.online ?? meta?.online_count ?? props.channel.online;
});

const descriptionText = computed(() => {
  const meta = props.metadata;
  return meta?.description || meta?.about || props.channel.description || "";
});

const firstSeenDate = computed(() => {
  const meta = props.metadata;
  const d = meta?.date || meta?.createdAt || props.channel.date;
  return d ? formatDate(d) : "";
});

const channelType = computed(() => {
  const meta = props.metadata;
  if (meta?._type && typeof meta._type === "string") {
    return meta._type.split(".").pop();
  }
  return "";
});

function handleImageError(event: Event) {
  const target = event.target as HTMLImageElement;
  if (target && !target.src.includes("data:image/svg+xml")) {
    target.src =
      "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' fill='%232AABEE'/%3E%3Cpath fill='%23fff' d='M5.265 11.735l11.953-4.606c.553-.206 1.034.13.844.975l-2.02 9.516c-.15.676-.554.843-1.116.528l-3.085-2.274-1.488 1.433c-.165.165-.303.303-.62.303l.22-3.15 5.734-5.18c.25-.223-.054-.346-.387-.123l-7.09 4.466-3.054-.954c-.664-.208-.678-.664.14-.984z'/%3E%3C/svg%3E";
  }
}

function handleClick() {
  emit("select-channel", props.channel.channelId || username.value);
}
</script>

<template>
  <!-- Full View Mode Style (Drill-Down Modal or large display) -->
  <div
    v-if="!compact"
    class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden flex flex-col md:flex-row items-stretch relative group hover:border-teal-500/50 hover:shadow-md transition-all cursor-pointer"
    @click="handleClick"
  >
    <!-- Left accent gradient and avatar bar -->
    <div
      class="bg-gradient-to-br from-teal-500/20 to-teal-600/5 dark:from-teal-950/40 dark:to-teal-900/10 p-5 sm:p-6 flex flex-row md:flex-col items-center justify-center gap-4 border-b md:border-b-0 md:border-r border-gray-150 dark:border-gray-700 md:w-52 shrink-0 select-none"
    >
      <!-- Rank in drilldown if present -->
      <span
        v-if="rank !== undefined"
        class="text-xs font-black text-emerald-600 dark:text-emerald-400 font-mono tabular-nums shrink-0 self-start md:self-center"
      >
        #{{ rank }}
      </span>

      <div
        class="w-16 h-16 rounded-2xl bg-white dark:bg-gray-800 border-2 shadow-md shrink-0 flex items-center justify-center relative transition-all duration-300"
        :class="
          isPrivate
            ? 'border-amber-400 dark:border-amber-500/60 ring-4 ring-amber-500/15'
            : 'border-teal-100 dark:border-teal-900/40'
        "
      >
        <img
          :src="avatarUrl"
          @error="handleImageError"
          alt="Avatar"
          class="w-full h-full object-cover rounded-2xl"
        />

        <!-- Private Badge -->
        <div
          v-if="isPrivate"
          class="absolute -bottom-1 w-full bg-gradient-to-r from-amber-500 to-orange-600 text-white text-[7px] font-black uppercase tracking-widest py-0.5 rounded-b-xl flex items-center justify-center gap-0.5 shadow-sm border-t border-white/20 select-none"
        >
          <Lock class="h-1.5 w-1.5" />
          <span>{{ t('listen.private') || 'Private' }}</span>
        </div>
      </div>

      <div class="text-center md:text-center flex-1 min-w-0">
        <h4
          class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest leading-none mb-1.5 truncate max-w-[150px]"
          :title="`@${username}`"
        >
          @{{ username }}
        </h4>

        <!-- Subscribers Badge -->
        <div class="flex flex-wrap items-center justify-center gap-1">
          <span
            v-if="subscribersCount"
            class="inline-flex items-center gap-1 text-[10px] bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 font-black px-2 py-0.5 rounded-full uppercase tracking-wider scale-95 border border-teal-100/50 dark:border-teal-900/20"
          >
            <Users class="h-3 w-3" />
            {{ Number(subscribersCount).toLocaleString() }}
          </span>

          <!-- Online Badge -->
          <span
            v-if="onlineCount !== undefined && onlineCount !== null && onlineCount !== ''"
            class="inline-flex items-center gap-1 text-[10px] bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 font-black px-2 py-0.5 rounded-full uppercase tracking-wider scale-95 border border-emerald-100/50 dark:border-emerald-900/20"
          >
            <Activity class="h-3 w-3" />
            {{ Number(onlineCount).toLocaleString() }} {{ t('explorer.online') || 'online' }}
          </span>
        </div>
      </div>
    </div>

    <!-- Right description & actions info -->
    <div class="p-5 sm:p-6 flex-1 flex flex-col justify-between gap-4 min-w-0">
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2 min-w-0">
            <h3 class="text-base font-black text-gray-900 dark:text-white leading-tight truncate">
              {{ channelTitle }}
            </h3>
          </div>

          <a
            v-if="username"
            :href="`https://t.me/${username}`"
            target="_blank"
            @click.stop
            class="inline-flex items-center gap-1.5 px-3 py-1 bg-teal-500 hover:bg-teal-600 text-white dark:bg-teal-600 dark:hover:bg-teal-700 text-[11px] font-bold rounded-xl shadow-xs transition-all shadow-teal-500/10 hover:-translate-y-0.5 shrink-0"
          >
            <ExternalLink class="h-3 w-3" />
            <span>{{ t('listen.joinChannel') || 'Join' }}</span>
          </a>
        </div>

        <p
          v-if="descriptionText"
          class="text-xs text-gray-650 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words bg-gray-50/50 dark:bg-gray-800/50 p-3 rounded-2xl border border-gray-100/50 dark:border-gray-700/50 line-clamp-3"
        >
          {{ descriptionText }}
        </p>
        <p v-else class="text-xs text-gray-400 dark:text-gray-500 italic">
          {{ t('listen.noChannelDescription') || 'No description available' }}
        </p>
      </div>

      <!-- Additional mini details tags grid -->
      <div class="flex flex-wrap items-center gap-2.5 text-[10px] font-mono text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700/60 pt-3">
        <span v-if="firstSeenDate">
          {{ t('listen.firstSeen') || 'First seen' }}: <strong class="text-gray-600 dark:text-gray-300">{{ firstSeenDate }}</strong>
        </span>
        <span v-if="firstSeenDate" aria-hidden="true">·</span>
        <span v-if="channelType">
          {{ t('listen.type') || 'Type' }}: <strong class="text-gray-600 dark:text-gray-300">{{ channelType }}</strong>
        </span>
        <span v-if="channelType" aria-hidden="true">·</span>
        <span>
          {{ t('listen.cachedPosts', { count: channel.postCount }) || `${channel.postCount} posts` }}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Views: <strong class="text-teal-600 dark:text-teal-400">{{ formatViews(channel.totalViews) }}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Activity: <strong class="text-emerald-600 dark:text-emerald-400">{{ channel.activityScore }}</strong>
        </span>
      </div>
    </div>
  </div>

  <!-- Compact View Mode Style (Top 5 Column Card) -->
  <div
    v-else
    class="pt-3 first:pt-0 group cursor-pointer hover:bg-gray-50/80 dark:hover:bg-gray-700/30 p-2.5 -mx-1 rounded-2xl transition-all"
    @click="handleClick"
  >
    <div class="flex items-start justify-between gap-2.5 mb-1.5">
      <div class="flex items-center gap-2.5 min-w-0">
        <!-- Rank badge -->
        <span
          v-if="rank !== undefined"
          class="text-xs font-black text-emerald-600 dark:text-emerald-400 font-mono tabular-nums shrink-0"
        >
          #{{ rank }}
        </span>

        <!-- Channel avatar with border -->
        <div
          class="w-10 h-10 rounded-xl bg-white dark:bg-gray-800 border shadow-xs shrink-0 flex items-center justify-center relative overflow-hidden"
          :class="isPrivate ? 'border-amber-400' : 'border-teal-200/60 dark:border-teal-800/60'"
        >
          <img
            :src="avatarUrl"
            @error="handleImageError"
            alt="Avatar"
            class="w-full h-full object-cover"
          />
        </div>

        <!-- Name & Handle -->
        <div class="min-w-0 flex-1">
          <h5
            class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors"
          >
            {{ channelTitle }}
          </h5>
          <div class="flex items-center gap-1.5 mt-0.5">
            <span class="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate">
              @{{ username }}
            </span>
            <!-- Subscribers pill -->
            <span
              v-if="subscribersCount"
              class="inline-flex items-center gap-0.5 text-[9px] text-teal-600 dark:text-teal-400 font-bold font-mono"
            >
              <Users class="h-2.5 w-2.5" />
              {{ Number(subscribersCount).toLocaleString() }}
            </span>
            <!-- Online pill -->
            <span
              v-if="onlineCount !== undefined && onlineCount !== null && onlineCount !== ''"
              class="inline-flex items-center gap-0.5 text-[9px] text-emerald-600 dark:text-emerald-400 font-bold font-mono"
            >
              <Activity class="h-2.5 w-2.5" />
              {{ Number(onlineCount).toLocaleString() }}
            </span>
          </div>
        </div>
      </div>

      <!-- Views / Stats block -->
      <div class="text-right shrink-0">
        <span class="text-xs font-mono font-bold text-gray-900 dark:text-white tabular-nums block">
          {{ formatViews(channel.totalViews) }}
        </span>
        <span class="text-[9px] uppercase tracking-wider text-gray-400 font-bold block">
          views
        </span>
      </div>
    </div>

    <!-- Description snippet if present -->
    <p
      v-if="descriptionText"
      class="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-1 mb-1.5 pl-6"
    >
      {{ descriptionText }}
    </p>

    <!-- Unboxed Zero-Pill Metadata Line -->
    <div class="flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500 font-mono tabular-nums pl-6">
      <span class="font-bold text-gray-700 dark:text-gray-300">{{ channel.postCount }} posts</span>
      <span aria-hidden="true">·</span>
      <span>Avg {{ formatViews(channel.avgViews) }}/post</span>
      <span aria-hidden="true">·</span>
      <span class="text-emerald-600 dark:text-emerald-400 font-bold">Activity {{ channel.activityScore }}</span>
    </div>
  </div>
</template>
