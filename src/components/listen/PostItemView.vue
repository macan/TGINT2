<script setup lang="ts">
import { computed } from "vue";
import { format } from "date-fns";
import { useI18n } from "../../i18n";
import {
  Layers,
  Share2,
  ExternalLink,
  Eye,
  FileText,
  User,
  Image as ImageIcon,
  Video as VideoIcon
} from "lucide-vue-next";
import {
  getUsername,
  getToolName,
  getPostAvatarUrl,
  getParsedReactions,
  getVideoUrl,
  getPostDocuments,
  formatViews,
  formatDate
} from "../../utils/hotsEngine";

const props = withDefaults(
  defineProps<{
    post: any;
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
  (e: "open-lightbox", url: string): void;
  (e: "add-to-workspace", post: any): void;
  (e: "share-post", post: any): void;
  (e: "jump-to-channel", channelUsername: string, postKey?: string): void;
  (e: "click-post", post: any): void;
}>();

const { t } = useI18n();

const channelUsername = computed(() => {
  if (props.post.channelUsername) return props.post.channelUsername;
  if (props.post.key && typeof props.post.key === "string" && props.post.key.includes(".")) {
    return props.post.key.split(".")[0];
  }
  const url = props.post.data?.url || props.post.url;
  if (url && typeof url === "string") {
    const match = url.match(/t\.me\/([a-zA-Z0-9_+]+)/);
    if (match && match[1]) return match[1];
  }
  return props.post.channelName || "";
});

const authorTitle = computed(() => {
  // Use posts metadata (post.data) in value of indexeddb table row
  const author = props.post.data?.author;
  if (author && typeof author === "string" && author.trim()) {
    return author.trim();
  }
  const u = getUsername(props.post);
  if (u && u !== "Telegram User") {
    return u;
  }
  const rawUser = props.post.data?.user;
  if (rawUser && typeof rawUser === "string" && rawUser.trim() && !rawUser.startsWith("http")) {
    return rawUser.trim();
  }
  if (props.post.channelTitle) {
    return props.post.channelTitle;
  }
  if (channelUsername.value) {
    return channelUsername.value;
  }
  return "Telegram User";
});

const trueUsername = computed(() => {
  return getUsername(props.post);
});

const toolName = computed(() => {
  return getToolName(props.post);
});

const avatarUrl = computed(() => {
  return getPostAvatarUrl(props.post);
});

const postDateFormatted = computed(() => {
  return formatDate(props.post.data?.date || props.post.date);
});

const parsedReactions = computed(() => {
  return getParsedReactions(props.post.data?.reactions);
});

const documents = computed(() => {
  return getPostDocuments(props.post);
});

const postText = computed(() => {
  return (
    props.post.data?.message ||
    props.post.data?.text ||
    props.post.data?.content ||
    props.post.text ||
    props.post.cleanSnippet ||
    ""
  );
});

const viewsCountFormatted = computed(() => {
  const v = props.post.data?.views ?? props.post.views;
  return formatViews(v);
});

function handleImageError(event: Event) {
  const target = event.target as HTMLImageElement;
  if (target && !target.src.includes("data:image/svg+xml")) {
    target.src =
      "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' fill='%232AABEE'/%3E%3Cpath fill='%23fff' d='M5.265 11.735l11.953-4.606c.553-.206 1.034.13.844.975l-2.02 9.516c-.15.676-.554.843-1.116.528l-3.085-2.274-1.488 1.433c-.165.165-.303.303-.62.303l.22-3.15 5.734-5.18c.25-.223-.054-.346-.387-.123l-7.09 4.466-3.054-.954c-.664-.208-.678-.664.14-.984z'/%3E%3C/svg%3E";
  }
}

function handleChannelJump() {
  if (channelUsername.value) {
    emit("jump-to-channel", channelUsername.value, props.post.key || String(props.post.id));
  }
}
</script>

<template>
  <div
    class="rounded-3xl shadow-sm border p-4 sm:p-5 transition-all duration-300 relative overflow-hidden bg-white dark:bg-gray-800 border-gray-150 dark:border-gray-700/80 group"
    :class="[
      compact ? 'hover:shadow-md hover:border-teal-400/50' : 'hover:shadow-lg hover:-translate-y-0.5'
    ]"
    @click="$emit('click-post', post)"
  >
    <div class="absolute -top-10 -right-10 w-24 h-24 bg-teal-50/50 dark:bg-teal-900/10 rounded-full blur-2xl pointer-events-none"></div>

    <!-- Quoted / Hover actions (Workspace & Share) -->
    <div class="absolute top-4 right-4 flex space-x-1.5 z-20">
      <button
        type="button"
        @click.stop="$emit('add-to-workspace', post)"
        class="text-[10px] font-bold text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors flex items-center bg-gray-100 dark:bg-gray-700/80 px-2.5 py-1 rounded-full cursor-pointer shadow-3xs"
        :title="t('listen.addToWorkspaceAnalysis') || 'Add to Workspace'"
      >
        <Layers class="h-3 w-3 mr-1" />
        <span class="hidden sm:inline">{{ t('listen.workspace') || 'Workspace' }}</span>
      </button>
      <button
        type="button"
        @click.stop="$emit('share-post', post)"
        class="text-[10px] font-bold text-gray-400 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors flex items-center bg-gray-100 dark:bg-gray-700/80 px-2.5 py-1 rounded-full cursor-pointer shadow-3xs"
        :title="t('listen.shareLinks') || 'Share'"
      >
        <Share2 class="h-3 w-3 mr-1" />
        <span class="hidden sm:inline">{{ t('listen.share') || 'Share' }}</span>
      </button>
    </div>

    <!-- Post Top Profile Header Card -->
    <div class="flex justify-between items-start mb-3.5 relative z-10 pr-24">
      <div class="flex items-center space-x-3 min-w-0">
        <!-- Rank badge if passed -->
        <span
          v-if="rank !== undefined"
          class="text-xs font-black text-teal-600 dark:text-teal-400 font-mono tabular-nums shrink-0"
        >
          #{{ rank }}
        </span>

        <!-- Post Avatar -->
        <div
          class="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center text-teal-600 dark:text-teal-400 font-bold text-sm overflow-hidden ring-1 ring-white dark:ring-gray-800 shadow-sm shrink-0 cursor-pointer"
          @click.stop="handleChannelJump"
        >
          <img
            :src="avatarUrl"
            @error="handleImageError"
            alt="Avatar"
            class="w-full h-full object-cover"
          />
        </div>

        <!-- Sender / Author Details from post.data -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center flex-wrap gap-1.5">
            <h4
              class="text-xs sm:text-sm font-extrabold text-gray-900 dark:text-white hover:text-teal-500 transition-colors truncate max-w-[200px] cursor-pointer"
              @click.stop="handleChannelJump"
              :title="authorTitle"
            >
              {{ authorTitle }}
            </h4>

            <!-- Tool badge (TGB / TG) -->
            <span
              v-if="toolName"
              class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full shrink-0"
              :class="
                toolName === 'TGB'
                  ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-100/50 dark:border-purple-900/10'
                  : 'bg-gray-50 dark:bg-gray-900 text-gray-450 border border-gray-150/40 dark:border-gray-800'
              "
            >
              {{ toolName }}
            </span>

            <!-- True Username badge (only if data.url exists) -->
            <span
              v-if="trueUsername"
              class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/30 text-teal-650 dark:text-teal-400 border border-teal-100/40 dark:border-teal-900/20 shrink-0"
            >
              {{ trueUsername }}
            </span>
          </div>

          <div class="text-[11px] font-mono text-gray-400 dark:text-gray-500 flex items-center space-x-2 mt-0.5">
            <span>{{ postDateFormatted }}</span>
            <span v-if="post.data?.edit_date">({{ t('listen.edited') || 'edited' }})</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Message text content -->
    <div
      class="text-xs sm:text-sm text-gray-800 dark:text-gray-200 leading-relaxed mb-3.5 whitespace-pre-wrap break-words relative z-10"
      :class="{ 'line-clamp-3': compact }"
    >
      {{ postText }}
    </div>

    <!-- Contact card if shared -->
    <div
      v-if="post.data?.contact && Object.keys(post.data.contact).length > 0"
      class="mb-3.5 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-950/20 p-3.5 relative z-10"
    >
      <div class="flex items-center text-[10px] font-black tracking-widest text-blue-500 uppercase mb-1.5">
        <User class="h-3.5 w-3.5 mr-1" />
        {{ t('listen.contactShared') || 'Contact Shared' }}
      </div>
      <div class="text-xs text-gray-800 dark:text-gray-300 font-mono">
        {{ post.data.contact.first_name }} {{ post.data.contact.last_name }}
        <span v-if="post.data.contact.phone_number" class="block text-blue-500 mt-1 font-bold">
          {{ post.data.contact.phone_number }}
        </span>
      </div>
    </div>

    <!-- Photos Embeddings -->
    <div
      v-if="post.data?.photos && post.data.photos.length > 0 && post.key"
      class="mb-3.5 rounded-2xl overflow-hidden shadow-sm border border-gray-150 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 group-cursor cursor-zoom-in max-w-sm"
      @click.stop="$emit('open-lightbox', `https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`)"
    >
      <img
        :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`"
        class="w-full h-auto max-h-[300px] object-cover transition-transform duration-700 hover:scale-105"
        alt="Photo"
        referrerpolicy="no-referrer"
      />
    </div>

    <!-- Document Images -->
    <div
      v-if="post.data?.documents && post.data.documents.length > 0 && post.data.documents[0].mime_type?.startsWith('image/') && post.key"
      class="mb-3.5 rounded-2xl overflow-hidden shadow-sm border border-gray-150 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 group-cursor cursor-zoom-in max-w-sm"
      @click.stop="$emit('open-lightbox', `https://i.gogingko.net/api/v1/v/telegram-doc/${post.key}`)"
    >
      <img
        :src="`https://i.gogingko.net/api/v1/v/telegram-doc/${post.key}`"
        class="w-full h-auto max-h-[400px] object-contain mx-auto transition-transform duration-700 hover:scale-105"
        alt="Doc photo"
        referrerpolicy="no-referrer"
      />
    </div>

    <!-- Videos -->
    <div
      v-if="post.data?.videos && post.data.videos.length > 0 && !compact"
      class="mb-3.5 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-black max-w-sm shadow-sm"
      @click.stop
    >
      <video controls preload="metadata" playsinline class="w-full h-auto max-h-[300px]">
        <source :src="getVideoUrl(post)" type="video/mp4" />
      </video>
    </div>

    <!-- Link Preview Embed -->
    <div
      v-if="post.data?.linkPreview"
      class="mb-3 rounded-2xl overflow-hidden border border-gray-150 dark:border-gray-700/80 bg-gray-50/50 dark:bg-gray-800/10 flex flex-col sm:flex-row shadow-xs hover:shadow-sm transition-shadow shrink-0"
    >
      <div
        v-if="post.data.linkPreview.image"
        class="sm:w-24 sm:h-24 shrink-0 bg-gray-200 dark:bg-gray-800 overflow-hidden cursor-zoom-in"
        @click.stop="$emit('open-lightbox', post.key ? `https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0` : post.data.linkPreview.image)"
      >
        <img
          :src="post.key ? `https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0` : post.data.linkPreview.image"
          class="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
          alt="Link Preview"
        />
      </div>
      <div class="p-3.5 flex-1 min-w-0">
        <div class="text-[10px] font-black uppercase tracking-widest text-teal-500 truncate mb-1">
          {{ post.data.linkPreview.siteName || post.data.linkPreview.site_name || t('listen.embedWebpage') || 'Web Page' }}
        </div>
        <a
          v-if="post.data.linkPreview.href || post.data.linkPreview.url"
          :href="post.data.linkPreview.href || post.data.linkPreview.url"
          target="_blank"
          @click.stop
          class="text-xs sm:text-sm font-bold text-gray-950 dark:text-gray-100 hover:text-blue-500 hover:underline transition-colors block line-clamp-1 mb-1"
        >
          {{ post.data.linkPreview.title || t('listen.embedLinkUrl') || 'Article Link' }}
        </a>
        <p v-if="post.data.linkPreview.description" class="text-xs text-gray-400 dark:text-gray-500 line-clamp-2">
          {{ post.data.linkPreview.description }}
        </p>
      </div>
    </div>

    <!-- Documents Preview List -->
    <div
      v-for="(doc, dIdx) in documents"
      :key="dIdx"
      class="mb-3 last:mb-3.5 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/50 flex items-center p-3.5 shadow-xs hover:shadow-sm transition-shadow relative z-10"
    >
      <div class="mr-3">
        <FileText class="h-8 w-8 text-red-500" />
      </div>
      <div class="flex-1 min-w-0">
        <h4 class="text-xs font-bold text-gray-900 dark:text-white mb-0.5 break-all">
          {{ doc.title }}
        </h4>
        <a
          v-if="doc.url"
          :href="doc.url"
          target="_blank"
          @click.stop
          class="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold"
        >
          {{ t('listen.viewDocument') || 'View Document' }}
        </a>
      </div>
    </div>

    <!-- Bottom Metadata Bar -->
    <div class="mt-3.5 pt-3 border-t border-gray-100 dark:border-gray-700/80 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 flex-wrap gap-2">
      <div class="flex items-center space-x-3 flex-wrap gap-y-1">
        <!-- Views Count -->
        <span v-if="viewsCountFormatted" class="font-medium text-gray-600 dark:text-gray-300">
          {{ t('listen.viewsCount', { views: viewsCountFormatted }) || `${viewsCountFormatted} views` }}
        </span>

        <!-- Post Reactions -->
        <div
          v-if="parsedReactions.length > 0"
          class="flex flex-wrap items-center gap-1"
        >
          <span
            v-for="(react, rIdx) in parsedReactions"
            :key="rIdx"
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-3xs"
          >
            <span v-html="react.emoji"></span>
            <span class="text-[9px] font-bold font-mono text-gray-400 dark:text-gray-500">
              {{ react.count.toLocaleString() }}
            </span>
          </span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <!-- Jump to Channel Button -->
        <button
          type="button"
          v-if="channelUsername"
          @click.stop="handleChannelJump"
          class="font-mono bg-gray-100 hover:bg-teal-50 dark:bg-gray-700 dark:hover:bg-teal-900/30 px-2 py-0.5 rounded text-[10px] text-teal-600 dark:text-teal-400 transition-colors cursor-pointer"
          :title="`Jump to @${channelUsername}`"
        >
          {{ channelUsername }}
        </button>

        <!-- Post ID Badge -->
        <span
          v-if="post.key || post.id"
          class="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-[10px] text-gray-400 dark:text-gray-500"
        >
          ID: {{ post.key || post.id }}
        </span>
      </div>
    </div>
  </div>
</template>
