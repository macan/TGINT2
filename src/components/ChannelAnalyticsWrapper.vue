<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import React from "react";
import ReactDOM from "react-dom/client";
import { ChannelEngagementDashboard, type PostItem } from "./analytics/ChannelEngagementDashboard";

const props = defineProps<{
  posts: any[];
  channelName: string;
  isDark?: boolean;
}>();

const emit = defineEmits<{
  (e: "open-post-modal", post: any): void;
  (e: "explore-channel", channel: string): void;
}>();

const mountRef = ref<HTMLDivElement | null>(null);
let reactRoot: ReactDOM.Root | null = null;

const parseNumericMetric = (val: any): number => {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (typeof val === "string") {
    const cleaned = val.replace(/,/g, "").trim().toLowerCase();
    if (cleaned.endsWith("k")) {
      return Math.round(parseFloat(cleaned) * 1000) || 0;
    }
    if (cleaned.endsWith("m")) {
      return Math.round(parseFloat(cleaned) * 1000000) || 0;
    }
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : Math.round(n);
  }
  return 0;
};

// Convert Vue reactive proxies into plain JavaScript objects to prevent
// React 19 inspection Proxy invariant errors (TypeError: 'get' on proxy)
const toPlainPosts = (rawPosts: any[]): PostItem[] => {
  if (!rawPosts || !Array.isArray(rawPosts)) return [];
  return rawPosts.map((p, idx) => {
    if (!p) return {} as PostItem;
    const pData = p.data || {};
    const date = pData.date || p.date || p.datetime || pData.datetime || "";
    const views = parseNumericMetric(pData.views != null ? pData.views : p.views);
    const forwards = parseNumericMetric(pData.forwards != null ? pData.forwards : p.forwards);
    const content = typeof pData.content === "string" ? pData.content : (typeof p.content === "string" ? p.content : "");
    const rawcontent = typeof pData.rawcontent === "string" ? pData.rawcontent : (typeof p.rawcontent === "string" ? p.rawcontent : "");

    return {
      _index: idx,
      id: p.id,
      key: p.key,
      url: p.url,
      link: p.link,
      data: {
        ...pData,
        date,
        views,
        forwards,
        content,
        rawcontent
      }
    };
  });
};

const renderReactDashboard = () => {
  if (!mountRef.value) return;

  if (!reactRoot) {
    reactRoot = ReactDOM.createRoot(mountRef.value);
  }

  const plainPosts = toPlainPosts(props.posts);

  reactRoot.render(
    React.createElement(ChannelEngagementDashboard, {
      posts: plainPosts,
      channelName: String(props.channelName || ""),
      isDark: Boolean(props.isDark),
      onPostClick: (clickedPost: any) => {
        let original: any = null;
        if (clickedPost && typeof clickedPost._index === "number" && props.posts[clickedPost._index]) {
          original = props.posts[clickedPost._index];
        } else if (clickedPost?.key) {
          original = (props.posts || []).find((p: any) => p && p.key === clickedPost.key);
        } else if (clickedPost?.id) {
          original = (props.posts || []).find((p: any) => p && p.id === clickedPost.id);
        }
        emit("open-post-modal", original || clickedPost);
      },
      onExploreChannel: (targetChannel: string) => {
        emit("explore-channel", targetChannel);
      }
    })
  );
};

onMounted(() => {
  nextTick(() => {
    renderReactDashboard();
  });
});

watch(
  [() => props.posts, () => props.channelName, () => props.isDark],
  () => {
    renderReactDashboard();
  },
  { deep: true }
);

onUnmounted(() => {
  if (reactRoot) {
    try {
      reactRoot.unmount();
    } catch (e) {
      console.warn("Failed to unmount React root", e);
    }
    reactRoot = null;
  }
});
</script>

<template>
  <div class="w-full">
    <div ref="mountRef" class="w-full"></div>
  </div>
</template>
