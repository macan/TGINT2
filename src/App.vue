<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from "vue";
import {
  Search,
  Loader2,
  AlertCircle,
  Users,
  Calendar,
  Info,
  MessageSquare,
  ExternalLink,
  Reply,
  Moon,
  Sun,
  Globe,
  Layout,
  CheckCircle2,
  FileText,
  User,
  PenTool,
  Link,
  ListFilter,
  Inbox,
  Filter,
  LayoutGrid,
  Clock,
  List,
  ImageIcon,
  Video,
  X,
  Layers,
  PanelLeftClose,
  PanelLeft,
  Phone,
  ChevronUp,
  BotMessageSquare,
  GripHorizontal,
  Sparkles,
  Pin,
  LoaderCircle,
  Forward,
  Share2,
} from "lucide-vue-next";

import MarkdownIt from "markdown-it";
import markdownItMark from "markdown-it-mark";
const md = new MarkdownIt({ html: true }).use(markdownItMark);

const isAnalyzing = ref(false);
const analysisResult = ref("");
const isAnalysisModalVisible = ref(false);
const analyzedCount = ref(0);
const renderedMarkdown = computed(() => md.render(analysisResult.value));

const counters = ref<Record<string, number>>({});
const frequencies = ref<Record<string, number>>({});
const pendingJobs = ref<number | null>(null);
let counterTimer: any = null;
let pendingJobsTimer: any = null;

const fetchCounters = async () => {
  try {
    const yyyymmdd = format(new Date(), "yyyyMMdd");
    const response = await fetch(`https://i.gogingko.net/api/v1/v/counter/${yyyymmdd}`);
    if (response.ok) {
      const newCounters = await response.json();
      for (const type in newCounters) {
        const oldVal = counters.value[type] || 0;
        const newVal = newCounters[type];
        frequencies.value[type] = Math.max(0, (newVal - oldVal) / 30);
      }
      counters.value = newCounters;
    }
  } catch (err) {
    console.error("Failed to fetch counters:", err);
  }
};

const fetchPendingJobs = async () => {
  try {
    const response = await fetch("https://i.gogingko.net/api/v1/z/test2/set0", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (response.ok) {
      const data = await response.json();
      pendingJobs.value = data.gso?.result ?? 0;
    }
  } catch (err) {
    console.error("Failed to fetch pending jobs:", err);
  }
};


// Filtering state
const filterAuthor = ref("");
const filterStartDate = ref("");
const filterEndDate = ref("");
const filterMedia = ref({ photos: false, videos: false, links: false });

const filteredPosts = computed(() => {
  let result = posts.value;

  if (filterAuthor.value) {
    const author = filterAuthor.value.toLowerCase();
    result = result.filter((p) =>
      (p.data?.author || p.data?.user || "").toLowerCase().includes(author)
    );
  }

  if (filterStartDate.value) {
    const start = new Date(filterStartDate.value).getTime();
    result = result.filter(
      (p) => p.data?.date && new Date(p.data.date).getTime() >= start
    );
  }

  if (filterEndDate.value) {
    const end = new Date(filterEndDate.value).getTime();
    result = result.filter(
      (p) => p.data?.date && new Date(p.data.date).getTime() <= end
    );
  }

  if (filterMedia.value.photos) {
    result = result.filter((p) => p.data?.photos && p.data.photos.length > 0);
  }
  if (filterMedia.value.videos) {
    result = result.filter((p) => p.data?.videos && p.data.videos.length > 0);
  }
  if (filterMedia.value.links) {
    result = result.filter((p) => !!p.data?.linkPreview);
  }

  return result;
});

// Draggable widget state
const widgetX = ref(32);
const widgetY = ref(600);
const postWidgetX = ref(400);
const postWidgetY = ref(600);
const isDragging = ref(false);
let dragOffsetX = 0;
let dragOffsetY = 0;
let currentDragWidget: "analysis" | "post" | null = null;

const startDrag = (e: MouseEvent, widgetType: "analysis" | "post") => {
  isDragging.value = true;
  currentDragWidget = widgetType;
  const targetX = widgetType === "analysis" ? widgetX.value : postWidgetX.value;
  const targetY = widgetType === "analysis" ? widgetY.value : postWidgetY.value;
  dragOffsetX = e.clientX - targetX;
  dragOffsetY = e.clientY - targetY;
  window.addEventListener("mousemove", onDrag);
  window.addEventListener("mouseup", endDrag);
};

const onDrag = (e: MouseEvent) => {
  if (!isDragging.value || !currentDragWidget) return;
  if (currentDragWidget === "analysis") {
    widgetX.value = e.clientX - dragOffsetX;
    widgetY.value = e.clientY - dragOffsetY;
  } else if (currentDragWidget === "post") {
    postWidgetX.value = e.clientX - dragOffsetX;
    postWidgetY.value = e.clientY - dragOffsetY;
  }
};

const endDrag = () => {
  isDragging.value = false;
  currentDragWidget = null;
  window.removeEventListener("mousemove", onDrag);
  window.removeEventListener("mouseup", endDrag);
};

const analyzePosts = async () => {
  const targetPosts =
    activeTab.value === "search" ? searchResults.value : posts.value;
  if (!targetPosts || targetPosts.length === 0) return;

  isAnalyzing.value = true;
  analyzedCount.value = targetPosts.length;
  try {
    // Strip unnecessary fields
    const strippedPosts = targetPosts
      .map((p) => {
        const { data, key } = p;
        // Keep essential data only
        return {
          key,
          content: data?.content,
          date: data?.date,
          author: data?.author || data?.user,
          reply: data?.reply,
          linkPreview: data?.linkPreview
            ? {
                title: data.linkPreview.title,
                description: data.linkPreview.description,
              }
            : undefined,
        };
      })
      .filter((p) => p.content || p.reply || p.linkPreview);

    const response = await fetch("https://ask.gingkogo.uk/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: "mc",
        chat_id: "mc",
        text:
          "Please analyze the following posts from a telegram group. You should consider grouping by the sent user or account. Note that some post might be a submission from other users which can be identified by the content signatures, some post might contain non empty reply field which means the content is a reply to that post. For each grouped account, try hard to find anything that represented the personality of the account in social life, for example living city or country, post date that reflect the active hours, job postion, career, location, language, education, interests, favorite things, troubles, cognitive state. Output the findings in Chinese.\n\n" +
          JSON.stringify(strippedPosts),
      }),
    });

    if (!response.ok) throw new Error("Analysis request failed");
    const data = await response.json();
    analysisResult.value = data.reply || "No analysis data received.";
    isAnalysisModalVisible.value = true;
  } catch (err) {
    console.error(err);
    alert("Failed to analyze posts.");
  } finally {
    isAnalyzing.value = false;
  }
};

const runAutoFinding = async () => {
  if (!autoChannelName.value.trim()) return;

  isAutoFinding.value = true;
  autoCells.value = []; // Reset cells

  const name = autoChannelName.value.trim().replace(/^@/, "");
  let minId: string | null = null;
  let currentDateForUser = new Date();
  let iteration = 0;

  try {
    while (iteration < numIterations.value) {
      iteration++;
      const cell: AutoFindingCell = {
        id: iteration,
        logs: [`Iteration ${iteration}: Initializing...`],
        status: "running",
      };
      autoCells.value.push(cell);
      autoCells.value = [...autoCells.value];
      await nextTick();

      let posts: any[] = [];

      try {
        if (searchMode.value === "channel") {
          cell.logs[0] = `Iteration ${iteration}:\nFetching 150 posts (${searchMode.value})...`;
          let url = `https://i.gogingko.net/api/v1/last/${name}?n=150`;
          if (minId) url += `&b=${minId}`;

          const res = await fetch(url);
          if (!res.ok) throw new Error("Fetch failed");

          const data = await res.json();
          posts = Array.isArray(data)
            ? data
            : data.data || data.posts || data.items || [];

          if (posts.length === 0) {
            cell.logs.push("No more posts found.");
            cell.status = "completed";
            continue;
          }

          const lastPostId = posts[posts.length - 1].key.split(".").pop();
          minId = lastPostId;
          cell.logs.push(`Fetched ${posts.length} posts. Lowest ID: ${minId}`);
        } else {
          cell.logs[0] = `Iteration ${iteration}:\nSearching 500 posts (${searchMode.value})...`;
          // Build time range for day X
          const day = subDays(currentDateForUser, iteration - 1);
          const start = format(startOfDay(day), "yyyy-MM-dd HH:mm:ss");
          const end = format(endOfDay(day), "yyyy-MM-dd HH:mm:ss");

          // Get local timezone offset
          const offset = -new Date().getTimezoneOffset();
          const sign = offset >= 0 ? "+" : "-";
          const hours = Math.floor(Math.abs(offset) / 60)
            .toString()
            .padStart(2, "0");
          const minutes = (Math.abs(offset) % 60).toString().padStart(2, "0");
          const timezoneStr = `${sign}${hours}${minutes}`;

          const dateRange = `date:[to_date("${start}${timezoneStr}", "%Y-%m-%d %H:%M:%S%z") TO to_date("${end}${timezoneStr}", "%Y-%m-%d %H:%M:%S%z")]`;
          const query = `user:*${name}* AND ${dateRange}`;

          let data: any = null;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 100000); // 100s timeout

            try {
              const res = await fetch(
                "https://i.gogingko.net/api/v1/ft/telegram",
                {
                  method: "GET",
                  headers: {
                    "x-gos-ft-query": encodeURIComponent(query),
                    "x-gos-ft-sort": "date-",
                    "x-gos-ft-topk": "500",
                  },
                  signal: controller.signal,
                }
              );

              if (!res.ok) {
                const err = new Error(
                  `Search failed: ${res.status} ${res.statusText || ""}`
                ) as any;
                err.url = "https://i.gogingko.net/api/v1/ft/telegram";
                err.status = res.status;
                err.statusText = res.statusText;
                throw err;
              }

              data = await res.json();
              console.log("Search API Response:", data);
              posts = data.data || data.posts || data.items || [];
            } finally {
              clearTimeout(timeoutId);
            }
          } catch (err: any) {
            console.error("Fetch/Parsing error:", err);
            if (!err.url) err.url = "https://i.gogingko.net/api/v1/ft/telegram";
            if (err.name === "AbortError") {
              const newErr = new Error(
                "Network error: Request timed out after 100s from " + err.url
              );
              (newErr as any).url = err.url;
              throw newErr;
            } else if (
              err.message &&
              err.message.toLowerCase().includes("failed to fetch")
            ) {
              const newErr = new Error(
                "Network error or CORS issue: Failed to fetch from " + err.url
              );
              (newErr as any).url = err.url;
              throw newErr;
            }
            throw err;
          }

          if (!data || !data.keys || data.keys.length === 0) {
            cell.logs.push(
              `No posts found for ${format(
                day,
                "yyyy-MM-dd"
              )}. Searching previous day...`
            );
            continue;
          }

          const keys = data.keys[0].map((fullKey: string) => {
            const idx = fullKey.indexOf(".");
            return { ns: fullKey.slice(0, idx), key: fullKey.slice(idx + 1) };
          });

          let mgetResponse;
          try {
            mgetResponse = await fetch("https://i.gogingko.net/api/v1/mget/_", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(keys),
            });
          } catch (err: any) {
            const newErr = new Error(
              err.message &&
              err.message.toLowerCase().includes("failed to fetch")
                ? "MGET Network error or CORS issue: Failed to fetch from https://i.gogingko.net/api/v1/mget/_"
                : err.message
            );
            (newErr as any).url = "https://i.gogingko.net/api/v1/mget/_";
            throw newErr;
          }
          if (!mgetResponse.ok) throw new Error("MGET failed");
          posts = await mgetResponse.json();
          cell.logs.push(
            `Fetched ${posts.length} posts for ${format(day, "yyyy-MM-dd")}.`
          );
        }

        autoCells.value = [...autoCells.value];
        await nextTick();

        if (posts.length === 0) {
          cell.logs.push("No posts to analyze.");
          cell.status = "completed";
          autoCells.value = [...autoCells.value];
          await nextTick();
          continue;
        }

        const strippedPosts = posts
          .map((p: any) => ({
            key: p.key,
            content: p.data?.content,
            date: p.data?.date,
            author: p.data?.author || p.data?.user,
            reply: p.data?.reply,
          }))
          .filter((p: any) => p.content || p.reply);

        let analysisRes;
        try {
          analysisRes = await fetch("https://ask.gingkogo.uk/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sender: "mc",
              chat_id: "mc",
              text:
                "Please analyze the following posts from a telegram group. You should consider grouping by the sent user or account. Note that some post might be a submission from other users which can be identified by the content signatures, some post might contain non empty reply field which means the content is a reply to that post. For each grouped account, try hard to find anything that represented the personality of the account in life, for example living city or country, post date that reflect the active hours, job postion, career, location, language, education, interests, favorite things, troubles, cognitive state, social relations, or any rules you found. Output the findings in Chinese with post id range hint in proper place.\n " +
                JSON.stringify(strippedPosts),
            }),
          });
        } catch (err: any) {
          const newErr = new Error(
            err.message && err.message.toLowerCase().includes("failed to fetch")
              ? "Analysis Network error or CORS issue: Failed to fetch from https://ask.gingkogo.uk/"
              : err.message
          );
          (newErr as any).url = "https://ask.gingkogo.uk/";
          throw newErr;
        }
        if (!analysisRes.ok) throw new Error("Analysis failed");
        const analysisData = await analysisRes.json();
        cell.analysisResult = analysisData.reply;
        cell.logs.push(`Analysis received: ${analysisRes.status}`);
        autoCells.value = [...autoCells.value];
        await nextTick();

        cell.logs.push("Sending for verification...");
        autoCells.value = [...autoCells.value];
        await nextTick();
        let checkRes;
        try {
          checkRes = await fetch("https://ask.gingkogo.uk/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sender: "mc",
              chat_id: "mc",
              text:
                "Consider the following text, can you find any deterministic or definitive personality evidence for any user or account. If you can find it, return the evidence. Otherwise just answer No Evidence. the following are REPLY text: " +
                cell.analysisResult,
            }),
          });
        } catch (err: any) {
          const newErr = new Error(
            err.message && err.message.toLowerCase().includes("failed to fetch")
              ? "Verification Network error or CORS issue: Failed to fetch from https://ask.gingkogo.uk/"
              : err.message
          );
          (newErr as any).url = "https://ask.gingkogo.uk/";
          throw newErr;
        }
        if (!checkRes.ok)
          throw new Error(
            `Verification failed: ${checkRes.status} ${
              checkRes.statusText || ""
            }`
          );
        const checkData = await checkRes.json();
        cell.verificationResult = checkData.reply;
        cell.logs.push("Verification finished.");
        cell.status = "completed";
        autoCells.value = [...autoCells.value];
        await nextTick();

        if (
          cell.verificationResult &&
          !cell.verificationResult.includes("No Evidence") &&
          !cell.verificationResult.includes("无证据")
        ) {
          cell.logs.push("Evidence found!");
        }
        cell.logs.push("Continuing...");
      } catch (err: any) {
        cell.status = "error";
        cell.logs.push(`Error: ${err.message}`);

        // Log to console for better visibility
        console.error("AutoFinding Error:", err);

        debugInfo.value = {
          request: `URL: ${err.url || "N/A"}, Mode: ${searchMode.value}`,
          response: err.status
            ? `${err.status} ${err.statusText} | Headers: ${JSON.stringify(
                err.headers || {}
              )}`
            : err.message || "Unknown error",
        };
        showDebugPanel.value = true;
        autoCells.value = [...autoCells.value];
        throw err;
      }
    }
    await generateFinalTable();
  } catch (err: any) {
    // Already logged error in each iteration/check
  } finally {
    isAutoFinding.value = false;
  }
};
//...
// (Rendering debug panel)
// <div v-if="showDebugPanel" class="fixed bottom-4 right-4 z-50 p-6 bg-red-900 text-white rounded-xl shadow-2xl w-96 max-h-[80vh] overflow-y-auto">
//   ...
// </div>
import {
  format,
  formatDistanceToNow,
  subDays,
  startOfDay,
  endOfDay,
} from "date-fns";

const isDark = ref(false);
const showBackToTop = ref(false);
const activeTab = ref<"explorer" | "search" | "auto-finding">("explorer");

// Auto Finding State
interface AutoFindingCell {
  id: number;
  logs: string[];
  analysisResult?: string;
  verificationResult?: string;
  status: "running" | "completed" | "error";
}
const autoCells = ref<AutoFindingCell[]>([]);
const autoChannelName = ref("");
const searchMode = ref<"channel" | "user">("channel");
const showDebugPanel = ref(false);
const debugInfo = ref({ request: "", response: "" });
const singlePostId = ref("");
const singlePost = ref<any>(null);
const isFetchingPost = ref(false);
const summaryResults = computed(() => {
  const completedCells = autoCells.value.filter(
    (c) => c.status === "completed"
  );
  return completedCells.map((c) => ({
    id: c.id,
    analysis: c.analysisResult || "",
    verification: c.verificationResult || "",
  }));
});

const finalTableHtml = ref("");
const isGeneratingFinalTable = ref(false);

const generateFinalTable = async () => {
  isGeneratingFinalTable.value = true;
  try {
    const context = JSON.stringify(summaryResults.value);
    const response = await fetch("https://ask.gingkogo.uk/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: "mc",
        chat_id: "mc",
        text:
          "Generate a table from the following results of iterations with columns while each row stand for a active user in the results and each column stand for different evidence type. Make sure to contains all the appeared users. Here is the context input: " +
          context,
      }),
    });
    const data = await response.json();
    finalTableHtml.value = md.render(data.reply);
  } catch (err) {
    console.error(err);
    finalTableHtml.value =
      '<p class="text-red-500">Failed to generate table.</p>';
  } finally {
    isGeneratingFinalTable.value = false;
  }
};

const isAutoFinding = ref(false);
const numIterations = ref(5);
const xSearchResults = ref<any[]>([]);
const isSearchingX = ref(false);
const xSearchInput = ref("");

const searchOnGoogle = (text: string) => {
  if (text) {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, '_blank');
  }
};

const sharePost = async (post: any) => {
  const postUrl = `https://i.gogingko.net/api/v1/v/telegram-post/${post.key}`;
  try {
    if (navigator.share) {
      await navigator.share({
        title: 'Shared Telegram Post',
        url: postUrl
      });
    } else {
      await navigator.clipboard.writeText(postUrl);
      console.log('Link copied to clipboard!');
    }
  } catch (err) {
    console.error('Error sharing:', err);
  }
};

const searchXUser = async (term: string) => {
  isSearchingX.value = true;
  xSearchResults.value = [];
  try {
    const response = await fetch("https://i.gogingko.net/api/v1/es/x", {
      method: "POST",
      body: JSON.stringify({
        query: {
          multi_match: {
            query: term,
            fields: ["name", "screen_name", "description"],
          },
        },
        size: 25
      }),
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    xSearchResults.value = data.hits?.hits.map((h: any) => h._source) || [];
  } catch (e) {
    console.error("X Search Failed", e);
  } finally {
    isSearchingX.value = false;
  }
};

const formatScrapedDate = (mtime: number) => {
  if (!mtime) return "";
  const date = new Date(mtime * 1000);
  const utcDate = new Date(date.getTime() + (date.getTimezoneOffset() * 60000));
  const utc8Date = new Date(utcDate.getTime() + (8 * 3600000));
  return format(utc8Date, "yyyy-MM-dd HH:mm:ss");
};

const getForwardInfo = (post: any) => {
  if (!post.data?.forward_url || !post.data?.forward_from) return null;
  
  if (typeof post.data.forward_from === 'string') {
    const parts = post.data.forward_url.split('/').filter(Boolean);
    const yyyy = parts[parts.length - 2] || 'unknown';
    const zzzz = parts[parts.length - 1] || 'unknown';
    if (yyyy == 't.me') {
      return {
        text: `Forward from ${post.data.forward_from} (ID: ${zzzz})`,
        date: null
      }
    }
    return {
      text: `Forward from ${post.data.forward_from} (ID: ${yyyy}.${zzzz})`,
      date: null
    };
  } else {
    return {
      text: `Forward from ${post.data.forward_from.title} (ID: ${post.data.forward_from.username}.${post.data.forward_from.post})`,
      date: post.data.forward_from.date
    };
  }
};

const fetchSinglePost = async () => {
  if (!autoChannelName.value.trim() || !singlePostId.value.trim()) return;
  isFetchingPost.value = true;
  singlePost.value = null;
  const name = autoChannelName.value.trim().replace(/^@/, "");
  try {
    let _key = `${name}.${singlePostId.value.trim()}`;
    if (singlePostId.value.includes(".")) {
      _key = singlePostId.value.trim();
    }
    const url = `https://i.gogingko.net/api/v1/v/telegram-post/${_key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Post not found");
    singlePost.value = {
      key: _key,
      data: await res.json(),
    };
  } catch (err: any) {
    alert("Failed to fetch post: " + err.message);
  } finally {
    isFetchingPost.value = false;
  }
};

const handleScroll = () => {
  showBackToTop.value = window.scrollY > 500;
};

const scrollToTop = () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
};

const scrollToPost = (key: string) => {
  console.log("Scrolling to:", key);
  viewMode.value = "list";
  nextTick(() => {
    const el = document.getElementById(`post-${key}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      console.log("Post element not found for key:", key);
    }
  });
};

const pollLatestPosts = async () => {
  if (!currentChannelName.value || activeTab.value !== 'explorer') return;
  
  try {
    const res = await fetch(`https://i.gogingko.net/api/v1/last/${currentChannelName.value}?n=25`);
    if (!res.ok) return;

    const latestPostsVal = await res.json();
    const newPostsData = Array.isArray(latestPostsVal)
      ? latestPostsVal
      : latestPostsVal.data || latestPostsVal.posts || latestPostsVal.items || [];

    if (newPostsData.length === 0) return;

    // Ensure new posts are sorted DSC by ID component
    newPostsData.sort((a: any, b: any) => {
      const idA = parseInt(a.key.split('.')[1]);
      const idB = parseInt(b.key.split('.')[1]);
      return idB - idA;
    });

    // Get max ID from existing posts to compare
    let maxOldId = -1;
    if (posts.value.length > 0) {
      const parts = posts.value[0].key.split('.');
      if (parts.length > 1) {
        maxOldId = parseInt(parts[1]);
      }
    }

    // Filter new posts that are > maxOldId
    const postsToInsert = newPostsData.filter(p => {
      const parts = p.key.split('.');
      if (parts.length <= 1) return false;
      return parseInt(parts[1]) > maxOldId;
    });

    if (postsToInsert.length > 0) {
      // Mark as newly inserted for visual emphasis
      const emphasizedPosts = postsToInsert.map((p: any) => ({ ...p, isNewEmphasized: true }));
      
      posts.value = [...emphasizedPosts, ...posts.value];

      // Remove emphasis after a few seconds
      setTimeout(() => {
        posts.value.forEach(p => delete p.isNewEmphasized);
      }, 15000);
    }
  } catch (err) {
    console.error("Failed to poll latest posts:", err);
  }
};

let pollingTimer: any = null;
watch(activeTab, (newTab) => {
  if (newTab === 'explorer') {
    pollingTimer = setInterval(pollLatestPosts, 30000);
  } else {
    if (pollingTimer) clearInterval(pollingTimer);
  }
});

onMounted(() => {
  window.addEventListener("scroll", handleScroll);
  fetchCounters();
  counterTimer = setInterval(fetchCounters, 30000);
  fetchPendingJobs();
  pendingJobsTimer = setInterval(fetchPendingJobs, 30000);
  if (activeTab.value === 'explorer') {
    pollingTimer = setInterval(pollLatestPosts, 30000);
  }
});

onUnmounted(() => {
  window.removeEventListener("scroll", handleScroll);
  if (counterTimer) clearInterval(counterTimer);
  if (pendingJobsTimer) clearInterval(pendingJobsTimer);
  if (pollingTimer) clearInterval(pollingTimer);
});
const isProfileVisible = ref(true);

// Explorer State
const channelName = ref("");
const currentChannelName = ref("");
const loading = ref(false);
const error = ref("");
const metadata = ref<any>(null);
const posts = ref<any[]>([]);
const viewMode = ref<"list" | "masonry" | "timeline">("list");
const isPostModalVisible = ref(false);
const selectedPost = ref<any>(null);

const openPostModal = (post: any) => {
  selectedPost.value = post;
  isPostModalVisible.value = true;
};

const closePostModal = () => {
  isPostModalVisible.value = false;
  selectedPost.value = null;
};

const latestPostTimeDelta = computed(() => {
  if (!posts.value || posts.value.length === 0) return null;
  const latestDateStr = posts.value[0]?.data?.date;
  if (!latestDateStr) return null;

  try {
    let dateObj;
    if (typeof latestDateStr === "number" && latestDateStr < 10000000000) {
      dateObj = new Date(latestDateStr * 1000);
    } else {
      dateObj = new Date(latestDateStr);
    }

    if (isNaN(dateObj.getTime())) return null;
    return formatDistanceToNow(dateObj, { addSuffix: true });
  } catch {
    return null;
  }
});
const lightboxPhoto = ref<string | null>(null);
const lightboxScale = ref(1);

const handleWheel = (e: WheelEvent) => {
  if (!lightboxPhoto.value) return;
  const zoomFactor = 0.1;
  const delta = e.deltaY > 0 ? -zoomFactor : zoomFactor;
  lightboxScale.value = Math.min(Math.max(0.5, lightboxScale.value + delta), 6);
};

// Group Color Helper
const groupColorMap = [
  {
    name: "indigo",
    bg: "bg-indigo-50/30 dark:bg-indigo-900/10",
    border: "border-indigo-100 dark:border-indigo-800/50",
    badge:
      "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400",
    masonryBadge: "bg-indigo-600/80",
  },
  {
    name: "purple",
    bg: "bg-purple-50/30 dark:bg-purple-900/10",
    border: "border-purple-100 dark:border-purple-800/50",
    badge:
      "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400",
    masonryBadge: "bg-purple-600/80",
  },
  {
    name: "cyan",
    bg: "bg-cyan-50/30 dark:bg-cyan-900/10",
    border: "border-cyan-100 dark:border-cyan-800/50",
    badge: "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 dark:text-cyan-400",
    masonryBadge: "bg-cyan-600/80",
  },
  {
    name: "amber",
    bg: "bg-amber-50/30 dark:bg-amber-900/10",
    border: "border-amber-100 dark:border-amber-800/50",
    badge:
      "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400",
    masonryBadge: "bg-amber-600/80",
  },
  {
    name: "rose",
    bg: "bg-rose-50/30 dark:bg-rose-900/10",
    border: "border-rose-100 dark:border-rose-800/50",
    badge: "bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400",
    masonryBadge: "bg-rose-600/80",
  },
  {
    name: "emerald",
    bg: "bg-emerald-50/30 dark:bg-emerald-900/10",
    border: "border-emerald-100 dark:border-emerald-800/50",
    badge:
      "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400",
    masonryBadge: "bg-emerald-600/80",
  },
];

const getGroupStyles = (rootId: string | number | undefined) => {
  if (!rootId) return groupColorMap[0];
  const idStr = String(rootId);
  let hash = 0;
  for (let i = 0; i < idStr.length; i++) {
    hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % groupColorMap.length;
  return groupColorMap[index];
};

// Infinite Scroll State
const isLoadingMore = ref(false);
const hasMorePosts = ref(true);
const bottomSentinel = ref<HTMLElement | null>(null);

// Global Search State
const globalSearchQuery = ref("");
const searchFields = ref({
  content: true,
  user: false,
  author: false,
  url: false,
});
const searchResults = ref<any[]>([]);
const selectedUsernames = ref<string[]>([]);
const lastVisitedChannels = ref<{ name: string; isPinned: boolean }[]>([]);

const addToLastVisited = (name: string) => {
  const index = lastVisitedChannels.value.findIndex((c) => c.name === name);
  let channel = { name, isPinned: false };
  if (index !== -1) {
    channel = lastVisitedChannels.value[index];
    lastVisitedChannels.value.splice(index, 1);
  }
  lastVisitedChannels.value.unshift(channel);

  // Keep up to 20 channels, prioritizing pinned ones
  const pinned = lastVisitedChannels.value.filter((c) => c.isPinned);
  const unpinned = lastVisitedChannels.value.filter((c) => !c.isPinned);

  if (unpinned.length > 20 - pinned.length) {
    lastVisitedChannels.value = pinned.concat(
      unpinned.slice(0, 20 - pinned.length)
    );
  }

  localStorage.setItem(
    "lastVisitedChannels",
    JSON.stringify(lastVisitedChannels.value)
  );
};

const removeVisitedChannel = (name: string) => {
  lastVisitedChannels.value = lastVisitedChannels.value.filter(
    (c) => c.name !== name
  );
  localStorage.setItem(
    "lastVisitedChannels",
    JSON.stringify(lastVisitedChannels.value)
  );
};

const togglePin = (name: string) => {
  const channel = lastVisitedChannels.value.find((c) => c.name === name);
  if (channel) {
    channel.isPinned = !channel.isPinned;
    localStorage.setItem(
      "lastVisitedChannels",
      JSON.stringify(lastVisitedChannels.value)
    );
  }
};

const clearAllChannels = () => {
  lastVisitedChannels.value = lastVisitedChannels.value.filter(
    (c) => c.isPinned
  );
  localStorage.setItem(
    "lastVisitedChannels",
    JSON.stringify(lastVisitedChannels.value)
  );
};

const allUsernames = computed(() => {
  const users = new Set<string>();
  searchResults.value.forEach((p) => {
    const rawUser = p.data?.user;
    if (rawUser) {
      const parts = rawUser.split("/");
      users.add(parts[parts.length - 1]);
    }
  });
  return Array.from(users).sort();
});

const filteredSearchResults = computed(() => {
  if (selectedUsernames.value.length === 0) return searchResults.value;

  return searchResults.value.filter((p) => {
    const rawUser = p.data?.user;
    if (!rawUser) return false;
    const parts = rawUser.split("/");
    const username = parts[parts.length - 1];
    return selectedUsernames.value.includes(username);
  });
});

const toggleUsername = (username: string) => {
  const index = selectedUsernames.value.indexOf(username);
  if (index > -1) {
    selectedUsernames.value.splice(index, 1);
  } else {
    selectedUsernames.value.push(username);
  }
};

const getVideoUrl = (post: any) => {
  if (
    post.data?.videos &&
    post.data.videos.length > 0 &&
    post.data?.documents &&
    post.data.documents.length > 0 &&
    post.data.documents[0].mime_type?.startsWith("video/")
  ) {
    return `https://i.gogingko.net/api/v1/v/telegram-doc/${post.key}`;
  }
  return `https://i.gogingko.net/api/v1/v/telegram-video/${post.key}-0`;
};

const getUsername = (post: any) => {
  const rawUser = post.data?.user;
  if (!rawUser || typeof rawUser !== "string") return "Telegram User";
  const parts = rawUser.split("/");
  return parts[parts.length - 1];
};

const getToolName = (post: any) => {
  const tool = post.data?._tool;
  if (typeof tool === "string" && tool.startsWith("tgb.")) {
    return "TGB";
  }
  return "TG";
};
const isSearching = ref(false);
const searchError = ref("");
const searchLimit = ref(25);
const limitOptions = [10, 25, 50, 100, 250, 500, 1000];

const getLocalFormattedDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T00:00`;
};

const today = new Date();
today.setHours(0, 0, 0, 0);
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);

const searchStartDate = ref(getLocalFormattedDate(today));
const searchEndDate = ref(getLocalFormattedDate(tomorrow));
const hasSearched = ref(false);
const searchWords = ref<string[]>([]);

const searchTimelineStats = computed(() => {
  if (!filteredSearchResults.value || filteredSearchResults.value.length === 0)
    return null;

  const validResults = filteredSearchResults.value
    .map((p) => ({
      post: p,
      date: new Date(p.data?.date),
      time: new Date(p.data?.date).getTime(),
    }))
    .filter((item) => !isNaN(item.time) && item.date.getFullYear() >= 2013)
    .sort((a, b) => b.time - a.time); // Newest first

  if (validResults.length === 0) return null;

  const newest = validResults[0].time;
  const oldest = validResults[validResults.length - 1].time;
  const span = newest - oldest;

  const items = validResults.map((item) => ({
    position:
      span === 0
        ? 50
        : Math.max(0, Math.min(100, ((newest - item.time) / span) * 100)),
    post: item.post,
  }));

  return {
    start: format(validResults[0].date, "MMM d, HH:mm"),
    end: format(validResults[validResults.length - 1].date, "MMM d, HH:mm"),
    spanText: formatDistanceToNow(validResults[validResults.length - 1].date, {
      addSuffix: true,
    }),
    count: validResults.length,
    items,
  };
});

const postsTimelineStats = computed(() => {
  if (!filteredPosts.value || filteredPosts.value.length === 0) return null;

  const validResults = filteredPosts.value
    .map((p) => ({
      post: p,
      date: new Date(p.data?.date),
      time: new Date(p.data?.date).getTime(),
    }))
    .filter((item) => !isNaN(item.time) && item.date.getFullYear() >= 2013)
    .sort((a, b) => b.time - a.time); // Newest first

  if (validResults.length === 0) return null;

  const gaps = [];
  for (let i = 0; i < validResults.length - 1; i++) {
    gaps.push(validResults[i].time - validResults[i + 1].time);
  }
  const avgGapMs = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  let maxGap = 0;
  let maxGapIndex = -1;
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] > maxGap) {
      maxGap = gaps[i];
      maxGapIndex = i;
    }
  }

  const newest = validResults[0].time;
  const oldest = validResults[validResults.length - 1].time;
  const spanMs = newest - oldest;
  const spanHours = spanMs / (1000 * 60 * 60);
  const bucketHours = Math.max(1, Math.ceil(spanHours / 20));

  const bucketMap: Record<string, number> = {};
  for (const item of validResults) {
    const hoursFromEpoch = Math.floor(item.time / (1000 * 60 * 60));
    const bucketStartHour = Math.floor(hoursFromEpoch / bucketHours) * bucketHours;
    const bucketKey = format(new Date(bucketStartHour * 1000 * 60 * 60), "yyyy-MM-dd HH:00");
    bucketMap[bucketKey] = (bucketMap[bucketKey] || 0) + 1;
  }
  const hourlyData = Object.entries(bucketMap)
    .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
    .map(([hour, count]) => ({ hour, count }));

  const span = spanMs;
  const items = validResults.map((item) => ({
    position:
      span === 0
        ? 50
        : Math.max(0, Math.min(100, ((newest - item.time) / span) * 100)),
    post: item.post,
  }));

  return {
    start: format(validResults[0].date, "MMM d, HH:mm"),
    end: format(validResults[validResults.length - 1].date, "MMM d, HH:mm"),
    spanText: formatDistanceToNow(validResults[validResults.length - 1].date, {
      addSuffix: true,
    }),
    count: validResults.length,
    items,
    avgGap: (avgGapMs / 1000 / 60).toFixed(1) + " min",
    maxGap: maxGapIndex !== -1 ? Math.round(maxGap / 1000 / 60 / 60) + " hours" : "N/A",
    hourlyData,
  };
});

onMounted(() => {
  if (
    localStorage.theme === "dark" ||
    (!("theme" in localStorage) &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  ) {
    isDark.value = true;
  }
  const saved = localStorage.getItem("lastVisitedChannels");
  if (saved) {
    lastVisitedChannels.value = JSON.parse(saved);
  }
});

watch(
  isDark,
  (val) => {
    if (val) {
      document.documentElement.classList.add("dark");
      localStorage.theme = "dark";
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.theme = "light";
    }
  },
  { immediate: true }
);

const toggleDark = () => {
  isDark.value = !isDark.value;
};

const isScrapingDisabled = ref(false);

const scheduleScrape = async () => {
  if (!currentChannelName.value || isScrapingDisabled.value) return;
  try {
    const res = await fetch(
      `https://i.gogingko.net/api/v1/lq/${encodeURIComponent(
        currentChannelName.value
      )}`,
      {
        method: "POST",
      }
    );
    if (!res.ok)
      throw new Error(`Failed to schedule scrape: ${res.statusText}`);

    isScrapingDisabled.value = true;
    setTimeout(() => {
      isScrapingDisabled.value = false;
    }, 5000);
  } catch (err: any) {
    console.error(err);
    alert("Failed to schedule scrape: " + err.message);
  }
};

const toggleField = (field: keyof typeof searchFields.value) => {
  const selectedCount = Object.values(searchFields.value).filter(
    Boolean
  ).length;
  if (searchFields.value[field] && selectedCount <= 1) return;
  searchFields.value[field] = !searchFields.value[field];
};

const getFieldIcon = (field: string) => {
  switch (field) {
    case "content":
      return FileText;
    case "user":
      return User;
    case "author":
      return PenTool;
    case "url":
      return Link;
    default:
      return Globe;
  }
};

const highlightText = (text: any) => {
  if (!text || searchWords.value.length === 0) return text ? String(text) : "";

  let highlighted = String(text);
  searchWords.value.forEach((word) => {
    if (!word.trim()) return;
    const regex = new RegExp(
      `(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi"
    );
    highlighted = highlighted.replace(
      regex,
      '<mark class="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-0.5 rounded">$1</mark>'
    );
  });
  return highlighted;
};

const suggestedChannels = ref<string[]>([]);

const searchChannel = async () => {
  if (!channelName.value.trim()) return;

  loading.value = true;
  error.value = "";
  metadata.value = null;
  posts.value = [];
  hasMorePosts.value = true;
  suggestedChannels.value = [];

  const name = channelName.value.trim().replace(/^@/, "");
  currentChannelName.value = name;

  addToLastVisited(name);

  try {
    const metaRes = await fetch(
      `https://i.gogingko.net/api/v1/v/telegram-channel/${name}`
    );

    if (metaRes.status === 404) {
      const fallbackRes = await fetch(
        `https://i.gogingko.net/api/v1/zr/telegram-channel?prefix=${encodeURIComponent(
          name
        )}&k=20`
      );
      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        suggestedChannels.value = data.keys || [];
      } else {
        error.value = "Channel not found and could not fetch suggestions";
      }
      loading.value = false;
      return;
    }

    if (!metaRes.ok) {
      throw new Error(`Failed to fetch metadata: ${metaRes.statusText}`);
    }

    const metaData = await metaRes.json();
    metadata.value = metaData;

    const postsRes = await fetch(
      `https://i.gogingko.net/api/v1/last/${name}?n=25`
    );

    if (postsRes.ok) {
      const postsData = await postsRes.json();
      posts.value = Array.isArray(postsData)
        ? postsData
        : postsData.data || postsData.posts || postsData.items || [];
    }
  } catch (err: any) {
    error.value = err.message || "An error occurred while fetching data";
  } finally {
    loading.value = false;
  }
};

const performGlobalSearch = async () => {
  if (!globalSearchQuery.value.trim()) return;

  isSearching.value = true;
  searchError.value = "";
  searchResults.value = [];
  hasSearched.value = false;

  const words = globalSearchQuery.value
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  searchWords.value = words;
  const selectedFields = Object.entries(searchFields.value)
    .filter(([_, selected]) => selected)
    .map(([field]) => field);

  if (selectedFields.length === 0) {
    searchError.value = "Please select at least one field to search in";
    isSearching.value = false;
    return;
  }

  // Build query: (field:"word1" AND field:"word2") OR (field2:"word1" AND field2:"word2")
  const fieldQueries = selectedFields.map((field) => {
    const wordQueries = words
      .map((word) => {
        // Escape internal double quotes
        const escapedWord = word.replace(/"/g, '\\"');

        // Use wildcard format for 'user' field, otherwise use double quotes
        if (field === "user") {
          return `${field}:*${escapedWord}*`;
        }
        if (field === "url") {
          return `${field}:*${escapedWord}*`;
        }
        return `${field}:"${escapedWord}"`;
      })
      .join(" AND ");
    return `(${wordQueries})`;
  });

  // Add date range for the selected range or default to today
  const start = searchStartDate.value.replace("T", " ");
  const end = searchEndDate.value.replace("T", " ");

  // Get local timezone offset in format like "+07:00" or "-04:00"
  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(offset) / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (Math.abs(offset) % 60).toString().padStart(2, "0");
  const timezoneStr = `${sign}${hours}${minutes}`;

  const dateRange = `date:[to_date("${start}:00${timezoneStr}", "%Y-%m-%d %H:%M:%S%z") TO to_date("${end}:59${timezoneStr}", "%Y-%m-%d %H:%M:%S%z")]`;

  const finalQuery = `(${fieldQueries.join(" OR ")}) AND ${dateRange}`;

  try {
    // Use encodeURIComponent to safely pass UTF-8 characters (like Chinese)
    // through HTTP headers as requested by the user.
    const safeQuery = encodeURIComponent(finalQuery);

    const response = await fetch("https://i.gogingko.net/api/v1/ft/telegram", {
      method: "GET",
      headers: {
        "x-gos-ft-query": safeQuery,
        "x-gos-ft-sort": "date-",
        "x-gos-ft-topk": String(searchLimit.value),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Search failed: ${response.status} ${response.statusText || ""}`
      );
    }

    const data = await response.json();
    const keys = data.keys || [];

    if (keys.length === 0) {
      searchResults.value = [];
      hasSearched.value = true;
      return;
    }

    // Transform keys into { ns, key } objects by splitting at the first dot
    const mgetPayload = keys[0].map((fullKey: string) => {
      const idx = fullKey.indexOf(".");
      return {
        ns: fullKey.slice(0, idx),
        key: fullKey.slice(idx + 1),
      };
    });

    // Fetch full post data
    const mgetResponse = await fetch("https://i.gogingko.net/api/v1/mget/_", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mgetPayload),
    });

    if (!mgetResponse.ok) {
      throw new Error(
        `Failed to fetch post details: ${mgetResponse.statusText}`
      );
    }

    const postsData = await mgetResponse.json();
    const results = Array.isArray(postsData) ? postsData : postsData.data || [];

    // Sort by date descending
    results.sort((a: any, b: any) => {
      const getTimestamp = (dateVal: any) => {
        if (!dateVal) return 0;
        if (typeof dateVal === "number" && dateVal < 10000000000)
          return dateVal * 1000;
        const parsed = new Date(dateVal).getTime();
        return isNaN(parsed) ? 0 : parsed;
      };
      return getTimestamp(b.data?.date) - getTimestamp(a.data?.date);
    });

    searchResults.value = results;
    hasSearched.value = true;
  } catch (err: any) {
    console.error("Search error details:", err);
    searchError.value = `Search failed: ${
      err.message || "An unknown error occurred"
    }. Please verify your network connection and query parameters.`;
  } finally {
    isSearching.value = false;
  }
};

const formatDate = (dateStr: string | number) => {
  if (!dateStr) return "";
  try {
    // If it's a unix timestamp in seconds
    if (typeof dateStr === "number" && dateStr < 10000000000) {
      return format(new Date(dateStr * 1000), "MMM d, yyyy h:mm:ss a");
    }
    return format(new Date(dateStr), "MMM d, yyyy h:mm:ss a");
  } catch (e) {
    return String(dateStr);
  }
};

const formatViews = (views: any) => {
  if (views == null) return "";
  if (typeof views === "number") return views.toLocaleString();
  if (typeof views === "string") {
    const parsed = Number(views);
    if (!isNaN(parsed)) return parsed.toLocaleString();
    return views;
  }
  return String(views);
};

const telegramLogoUrl =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%232AABEE' d='M12 24c6.627 0 12-5.373 12-12S18.627 0 12 0 0 5.373 0 12s5.373 12 12 12z'/%3E%3Cpath fill='%23fff' d='M5.265 11.735l11.953-4.606c.553-.206 1.034.13.844.975l-2.02 9.516c-.15.676-.554.843-1.116.528l-3.085-2.274-1.488 1.433c-.165.165-.303.303-.62.303l.22-3.15 5.734-5.18c.25-.223-.054-.346-.387-.123l-7.09 4.466-3.054-.954c-.664-.208-.678-.664.14-.984z'/%3E%3C/svg%3E";

const loadMorePosts = async () => {
  if (
    isLoadingMore.value ||
    !hasMorePosts.value ||
    !currentChannelName.value ||
    posts.value.length === 0
  )
    return;

  isLoadingMore.value = true;
  const lastPost = posts.value[posts.value.length - 1];
  const lastPostId = lastPost.key;

  if (!lastPostId) {
    hasMorePosts.value = false;
    isLoadingMore.value = false;
    return;
  }

  try {
    const numericId = lastPostId.includes(".")
      ? lastPostId.split(".")[1]
      : lastPostId;
    const response = await fetch(
      `https://i.gogingko.net/api/v1/last/${currentChannelName.value}?n=50&b=${numericId}`
    );
    if (response.ok) {
      const morePostsData = await response.json();
      const newPosts = Array.isArray(morePostsData)
        ? morePostsData
        : morePostsData.data ||
          morePostsData.posts ||
          morePostsData.items ||
          [];

      if (newPosts.length === 0) {
        hasMorePosts.value = false;
      } else {
        posts.value = [...posts.value, ...newPosts];
      }
    } else {
      hasMorePosts.value = false;
    }
  } catch (err) {
    console.error("Error loading more posts:", err);
    hasMorePosts.value = false;
  } finally {
    isLoadingMore.value = false;
  }
};

const closeLightbox = () => {
  lightboxPhoto.value = null;
  lightboxScale.value = 1;
  document.body.style.overflow = "auto";
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape" && lightboxPhoto.value) {
    closeLightbox();
  }
};

let observer: IntersectionObserver | null = null;

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);

  observer = new IntersectionObserver(
    (entries) => {
      if (
        entries[0].isIntersecting &&
        activeTab.value === "explorer" &&
        !loading.value
      ) {
        loadMorePosts();
      }
    },
    { threshold: 0.1 }
  );

  if (bottomSentinel.value) {
    observer.observe(bottomSentinel.value);
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});

watch(
  () => bottomSentinel.value,
  (newEl) => {
    if (observer) {
      observer.disconnect();
      if (newEl) observer.observe(newEl);
    }
  }
);

const openLightbox = (url: string) => {
  lightboxPhoto.value = url;
  lightboxScale.value = 1;
  document.body.style.overflow = "hidden";
};

const handleImageError = (e: Event) => {
  const target = e.target as HTMLImageElement;
  if (target.src !== telegramLogoUrl) {
    target.src = telegramLogoUrl;
  }
};

const getPostAvatarUrl = (post: any) => {
  const user = post.data?.user;
  if (user) {
    const parts = String(user).split("/");
    const username = parts[parts.length - 1];
    if (username) {
      return `https://i.gogingko.net/api/v1/v/telegram-profile/${username}`;
    }
  }
  return telegramLogoUrl;
};

const mediaPosts = computed(() => {
  return filteredPosts.value.filter(
    (post) =>
      (post.data?.photos && post.data.photos.length > 0) ||
      (post.data?.videos && post.data.videos.length > 0) ||
      (post.data?.linkPreview && post.data.linkPreview.image)
  );
});
</script>

<template>
  <div
    class="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-200"
  >
    <div class="max-w-[96rem] mx-auto p-4 sm:p-6 lg:p-8 xl:p-10">
      <!-- Analysis Button -->
      <button
        v-if="
          (activeTab === 'explorer' && posts.length > 0) ||
          (activeTab === 'search' && searchResults.length > 0)
        "
        @click="analyzePosts"
        :disabled="isAnalyzing"
        class="fixed bottom-24 right-8 z-50 p-4 rounded-full bg-blue-600/90 dark:bg-blue-500/90 backdrop-blur-lg border border-blue-400 dark:border-blue-600 shadow-xl text-white hover:scale-110 transition-all duration-300 hover:shadow-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Analyze posts"
        :title="isAnalyzing ? 'Analyzing...' : 'Analyze posts'"
      >
        <Loader2 v-if="isAnalyzing" class="h-6 w-6 animate-spin" />
        <BotMessageSquare v-else class="h-6 w-6" />
      </button>

      <!-- Back to Top Button -->
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 translate-y-10"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-10"
      >
        <button
          v-if="showBackToTop"
          @click="scrollToTop"
          class="fixed bottom-8 right-8 z-50 p-4 rounded-full bg-white/80 dark:bg-gray-800/80 backdrop-blur-lg border border-gray-200 dark:border-gray-700 shadow-xl text-blue-600 dark:text-blue-400 hover:scale-110 transition-all duration-300 hover:shadow-blue-500/20"
          aria-label="Back to top"
        >
          <ChevronUp class="h-6 w-6" />
        </button>
      </Transition>

      <!-- Premium Header & Glass Navigation -->
      <header class="mb-12 relative flex flex-col items-center">
        <div class="absolute top-0 right-0 z-50">
          <button
            @click="toggleDark"
            class="p-2.5 rounded-full bg-white/50 dark:bg-gray-800/50 backdrop-blur-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 hover:shadow-md"
            aria-label="Toggle dark mode"
          >
            <Moon v-if="!isDark" class="h-4 w-4" />
            <Sun v-else class="h-4 w-4" />
          </button>
        </div>

        <div class="text-center pt-8 sm:pt-4 mb-8">
          <h1
            class="text-4xl sm:text-5xl font-black tracking-tighter text-gray-900 dark:text-white mb-4 flex items-center justify-center gap-3"
          >
            Telegram Explorer
            <span
              v-if="pendingJobs !== null"
              class="text-xs font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 px-3 py-1 rounded-full border border-blue-200 dark:border-blue-700 shadow-sm"
            >
              {{ pendingJobs }}
            </span>
          </h1>
          <p
            class="text-gray-500 dark:text-gray-400 font-medium max-w-lg mx-auto leading-relaxed mb-8"
          >
            Discover profiles, posts and search content across public Telegram channels
            instantly.
          </p>
          <div
            v-if="Object.keys(counters).length > 0"
            class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 mb-8 max-w-6xl mx-auto"
          >
            <div
              v-for="(count, type) in counters"
              :key="type"
              class="px-4 py-3 bg-white/50 dark:bg-gray-800/50 backdrop-blur rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center justify-center gap-1 transition-transform hover:scale-105"
            >
              <span
                class="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest"
                >{{ type }}</span
              >
              <span
                class="text-lg font-black text-blue-600 dark:text-blue-400 tabular-nums"
                >{{ count.toLocaleString() }}</span
              >
              <span
                v-if="frequencies[type] !== undefined"
                class="text-[10px] text-gray-400 dark:text-gray-500"
                >{{ frequencies[type].toFixed(1) }} obj/s</span
              >
            </div>
          </div>
        </div>

        <!-- Glass Tabs -->
        <div
          class="inline-flex bg-gray-200/50 dark:bg-gray-800/50 p-1.5 rounded-2xl backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 shadow-inner"
        >
          <button
            @click="activeTab = 'explorer'"
            :class="[
              'px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center',
              activeTab === 'explorer'
                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-md shadow-blue-500/5 ring-1 ring-gray-900/5 dark:ring-white/5'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
            ]"
          >
            <Layout
              :class="[
                'h-4 w-4 mr-2 transition-transform duration-300',
                activeTab === 'explorer' ? 'scale-110' : '',
              ]"
            />
            Channel Explorer
          </button>
          <button
            @click="activeTab = 'search'"
            :class="[
              'px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center',
              activeTab === 'search'
                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-md shadow-blue-500/5 ring-1 ring-gray-900/5 dark:ring-white/5'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
            ]"
          >
            <Globe
              :class="[
                'h-4 w-4 mr-2 transition-transform duration-300',
                activeTab === 'search' ? 'scale-110' : '',
              ]"
            />
            Global Search
          </button>
          <button
            @click="activeTab = 'auto-finding'"
            :class="[
              'px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center',
              activeTab === 'auto-finding'
                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-md shadow-blue-500/5 ring-1 ring-gray-900/5 dark:ring-white/5'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
            ]"
          >
            <BotMessageSquare
              :class="[
                'h-4 w-4 mr-2 transition-transform duration-300',
                activeTab === 'auto-finding' ? 'scale-110' : '',
              ]"
            />
            Auto Finding
          </button>
        </div>
      </header>

      <!-- Explorer Tab -->
      <div v-show="activeTab === 'explorer'">
        <div class="max-w-2xl mx-auto mb-16 px-4 sm:px-0">
          <form @submit.prevent="searchChannel" class="relative group">
            <div
              class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none transition-transform duration-300 group-focus-within:scale-110 group-focus-within:text-blue-500 z-10"
            >
              <Layout class="h-5 w-5 text-gray-400" />
            </div>
            <input
              v-model="channelName"
              type="text"
              class="block w-full pl-14 pr-[120px] py-3.5 border border-gray-200 dark:border-gray-700 rounded-xl leading-5 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-medium shadow-sm hover:shadow-md focus:shadow-xl transition-all duration-300"
              placeholder="Enter channel name (e.g. durov)"
            />
            <button
              type="submit"
              :disabled="loading || !channelName.trim()"
              class="absolute right-2 top-2 bottom-2 px-5 bg-blue-600 text-white rounded-[0.65rem] text-xs font-bold tracking-wide hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:-translate-y-0.5 active:translate-y-0"
            >
              <Loader2 v-if="loading" class="h-4 w-4 animate-spin mr-2" />
              {{ loading ? "Exploring..." : "Explore" }}
            </button>
          </form>

          <div v-if="suggestedChannels.length > 0" class="mt-4">
            <h4
              class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3"
            >
              Did you mean:
            </h4>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="channel in suggestedChannels"
                :key="channel"
                @click="
                  channelName = channel;
                  searchChannel();
                "
                class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900 border border-gray-200 dark:border-gray-700 transition"
              >
                {{ channel }}
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="error"
          class="rounded-xl bg-red-50 dark:bg-red-900/20 p-4 mb-8 border border-red-100 dark:border-red-900/50 flex items-start"
        >
          <AlertCircle
            class="h-5 w-5 text-red-400 dark:text-red-500 mt-0.5 mr-3 flex-shrink-0"
          />
          <div class="text-sm text-red-700 dark:text-red-400">
            <h3 class="font-medium text-red-800 dark:text-red-300 mb-1">
              Error fetching channel
            </h3>
            <p>{{ error }}</p>
          </div>
        </div>

        <div
          v-if="metadata"
          class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 transition-all duration-500"
        >
          <!-- Profile Sidebar -->
          <div
            v-show="isProfileVisible"
            class="lg:col-span-4 xl:col-span-3 space-y-6 transition-all duration-500 origin-left"
          >
            <div
              class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-[2.5rem] shadow-xl shadow-blue-900/5 dark:shadow-none border border-gray-100 dark:border-gray-700 overflow-hidden relative"
            >
              <div
                class="h-40 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 relative overflow-hidden"
              >
                <div
                  class="absolute inset-0 bg-white/10 dark:bg-black/10 backdrop-blur-sm"
                ></div>
                <div
                  class="absolute -top-10 -right-10 w-40 h-40 bg-white/20 dark:bg-white/10 rounded-full blur-3xl"
                ></div>
                <div
                  class="absolute -bottom-10 -left-10 w-40 h-40 bg-black/10 dark:bg-black/20 rounded-full blur-3xl"
                ></div>
              </div>
              <div class="px-8 pb-10 pt-12 relative">
                <div
                  class="w-20 h-20 rounded-full bg-white dark:bg-gray-800 border-4 border-white dark:border-gray-800 shadow-2xl absolute -top-10 left-8 flex items-center justify-center text-4xl font-bold text-blue-600 dark:text-blue-400 overflow-hidden ring-4 ring-blue-50 dark:ring-blue-900/30"
                >
                  <img
                    :src="`https://i.gogingko.net/api/v1/v/telegram-profile/${currentChannelName}`"
                    @error="handleImageError"
                    alt="Avatar"
                    class="w-full h-full object-cover"
                  />
                </div>

                <div class="mt-2">
                  <h2
                    class="text-xl font-bold text-gray-900 dark:text-white tracking-tight leading-none mb-1"
                  >
                    {{ metadata.title || metadata.name }}
                  </h2>
                  <p
                    class="text-blue-600 dark:text-blue-400 font-bold text-sm mb-6 flex items-center tracking-wide"
                  >
                    @{{ metadata.username || metadata.name || channelName }}
                  </p>

                  <div
                    v-if="metadata.description || metadata.about"
                    class="mb-8"
                  >
                    <p
                      class="text-gray-600 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap break-words bg-gray-50/80 dark:bg-gray-700/30 p-5 rounded-3xl border border-gray-100/50 dark:border-gray-600/50"
                    >
                      {{ metadata.description || metadata.about }}
                    </p>
                  </div>

                  <div class="grid grid-cols-2 gap-4">
                    <div
                      v-if="metadata.subscribers || metadata.members"
                      class="bg-blue-50/80 dark:bg-blue-900/20 p-5 rounded-[2rem] border border-blue-100/50 dark:border-blue-800/30 flex flex-col items-center justify-center text-center transition-transform hover:scale-105 duration-300"
                    >
                      <Users
                        class="h-6 w-6 mb-2 text-blue-500 dark:text-blue-400"
                      />
                      <span
                        class="text-xl font-black text-gray-900 dark:text-white"
                        >{{
                          (
                            metadata.subscribers || metadata.members
                          ).toLocaleString()
                        }}</span
                      >
                      <span
                        class="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mt-1"
                        >Subscribers</span
                      >
                    </div>

                    <div
                      v-if="metadata.date || metadata.createdAt"
                      class="bg-purple-50/80 dark:bg-purple-900/20 p-5 rounded-[2rem] border border-purple-100/50 dark:border-purple-800/30 flex flex-col items-center justify-center text-center transition-transform hover:scale-105 duration-300"
                    >
                      <Calendar
                        class="h-6 w-6 mb-2 text-purple-500 dark:text-purple-400"
                      />
                      <span
                        class="text-sm font-black text-gray-900 dark:text-white"
                        >{{
                          formatDate(metadata.date || metadata.createdAt)
                        }}</span
                      >
                      <span
                        class="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mt-1"
                        >Created</span
                      >
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Raw Metadata Debug -->
            <details
              class="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-xs"
            >
              <summary
                class="font-medium text-gray-700 dark:text-gray-300 cursor-pointer outline-none"
              >
                View Raw Metadata
              </summary>
              <pre
                class="mt-2 overflow-x-auto text-gray-600 dark:text-gray-400"
                >{{ JSON.stringify(metadata, null, 2) }}</pre
              >
            </details>

            <!-- Last Visited Channels Widget -->
            <div
              v-show="isProfileVisible && lastVisitedChannels.length > 0"
              class="mt-8 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-[2.5rem] shadow-xl shadow-blue-900/5 dark:shadow-none border border-gray-100 dark:border-gray-700 p-8"
            >
              <div class="flex items-center justify-between mb-6">
                <h3
                  class="text-xs font-black text-gray-400 uppercase tracking-widest"
                >
                  Last Visited
                </h3>
                <button
                  @click="clearAllChannels"
                  class="text-[10px] font-bold text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400 uppercase tracking-widest"
                >
                  Clear
                </button>
              </div>
              <div class="space-y-3">
                <div
                  v-for="channel in lastVisitedChannels"
                  :key="channel.name"
                  class="flex items-center justify-between group py-1"
                >
                  <button
                    @click="
                      channelName = channel.name;
                      searchChannel();
                    "
                    class="text-sm text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 truncate flex-1 text-left"
                  >
                    {{ channel.name }}
                  </button>
                  <div
                    class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <button @click="togglePin(channel.name)">
                      <Pin
                        :class="{
                          'text-blue-500 fill-blue-500': channel.isPinned,
                          'text-gray-400': !channel.isPinned,
                        }"
                        class="h-3.5 w-3.5"
                      />
                    </button>
                    <button @click="removeVisitedChannel(channel.name)">
                      <X class="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- X Similar Users Widget -->
            <div
              v-show="isProfileVisible"
              class="mt-8 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-[2.5rem] shadow-xl shadow-blue-900/5 dark:shadow-none border border-gray-100 dark:border-gray-700 p-8 sticky top-20 relative"
            >
              <div class="flex items-center justify-between mb-6 relative">
                <div class="flex items-center gap-2">
                  <h3
                    class="text-xs font-black text-gray-400 uppercase tracking-widest"
                  >
                    X Similar Users
                  </h3>
                  <div class="group relative inline-block">
                    <Info class="h-4 w-4 text-gray-400 cursor-help" />
                    <div class="absolute -left-2 top-full mt-2 w-48 p-2 bg-gray-900 border border-gray-700 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                      Search for similar users on X to find matching profiles.
                    </div>
                  </div>
                </div>
                <LoaderCircle
                  v-if="isSearchingX"
                  class="h-5 w-5 animate-spin text-blue-500 absolute top-0 -right-2"
                />
              </div>

              <div class="mb-4 flex gap-2">
                <input
                  v-model="xSearchInput"
                  @keyup.enter="searchXUser(xSearchInput)"
                  placeholder="Search X users..."
                  class="w-full px-4 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-gray-100 placeholder:text-gray-400"
                />
                <button
                  @click="searchXUser(xSearchInput)"
                  :disabled="isSearchingX || !xSearchInput.trim()"
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 flex items-center justify-center min-w-[44px]"
                >
                  <Search class="h-4 w-4" />
                </button>
              </div>

              <div
                v-if="xSearchResults.length > 0"
                class="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar"
              >
                <div
                  v-for="user in xSearchResults"
                  :key="user.id"
                  class="p-3 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 space-y-2"
                >
                  <div class="flex items-center gap-3">
                    <img
                      v-if="user.profile_image_url"
                      :src="user.profile_image_url"
                      class="w-10 h-10 rounded-full"
                      alt="Profile"
                    />
                    <div>
                      <p
                        class="text-sm font-bold text-gray-900 dark:text-gray-100"
                      >
                        {{ user.name }}
                      </p>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        @{{ user.screen_name }}
                      </p>
                    </div>
                  </div>
                  <p class="text-xs text-gray-600 dark:text-gray-300">
                    {{ user.description }}
                  </p>
                  <div class="flex text-[10px] text-gray-400 gap-3 pt-1">
                    <span v-if="user.location">📍 {{ user.location }}</span>
                    <span v-if="user.followers_count != null"
                      >👥 {{ user.followers_count }}</span
                    >
                    <span v-if="user.friends_count != null"
                      >👤 {{ user.friends_count }}</span
                    >
                  </div>
                  <a
                    v-if="user.screen_name"
                    :href="`https://x.com/${user.screen_name}`"
                    target="_blank"
                    class="block text-[10px] text-blue-500 font-bold underline"
                    >View X Profile</a
                  >
                </div>
              </div>
              <p v-else-if="!isSearchingX" class="text-sm text-gray-400">
                No results. Click an author name to search on X.
              </p>
            </div>
          </div>

          <!-- Posts Feed -->
          <div
            :class="[
              isProfileVisible
                ? 'lg:col-span-8 xl:col-span-9'
                : 'lg:col-span-12',
              'transition-all duration-500 ease-in-out min-w-0',
            ]"
          >
            <div class="relative">
              <div
                class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"
              >
                <h3
                  class="text-xl font-extrabold text-gray-900 dark:text-white flex flex-wrap items-center gap-y-2"
                >
                  <button
                    @click="isProfileVisible = !isProfileVisible"
                    class="hidden lg:flex mr-4 p-2 -ml-2 rounded-xl text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    :title="isProfileVisible ? 'Hide Sidebar' : 'Show Sidebar'"
                  >
                    <PanelLeftClose v-if="isProfileVisible" class="h-5 w-5" />
                    <PanelLeft v-else class="h-5 w-5" />
                  </button>
                  <div class="flex items-center">
                    <MessageSquare
                      class="h-6 w-6 mr-3 text-blue-600 dark:text-blue-400"
                    />
                    {{ viewMode === "list" ? "Feed" : "Medias" }}
                  </div>
                  <span
                    v-if="latestPostTimeDelta"
                    class="ml-2 sm:ml-4 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/50 text-[10px] uppercase tracking-widest font-black flex items-center shadow-sm"
                  >
                    <Clock class="h-3 w-3 mr-1.5" />
                    Latest Post {{ latestPostTimeDelta }}
                  </span>
                </h3>

                <div
                  class="flex bg-gray-100 dark:bg-gray-900/50 p-1 rounded-xl border border-gray-200 dark:border-gray-700 self-start sm:self-auto shrink-0"
                >
                  <button
                    @click="viewMode = 'list'"
                    :class="[
                      'p-2 rounded-lg transition-all flex items-center justify-center',
                      viewMode === 'list'
                        ? 'bg-white dark:bg-gray-800 text-blue-600 shadow-sm ring-1 ring-gray-200 dark:ring-gray-700'
                        : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
                    ]"
                    title="List View"
                  >
                    <List class="h-4 w-4" />
                  </button>
                  <button
                    @click="viewMode = 'masonry'"
                    :class="[
                      'p-2 rounded-lg transition-all flex items-center justify-center',
                      viewMode === 'masonry'
                        ? 'bg-white dark:bg-gray-800 text-blue-600 shadow-sm ring-1 ring-gray-200 dark:ring-gray-700'
                        : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
                    ]"
                    title="Masonry Grid"
                  >
                    <LayoutGrid class="h-4 w-4" />
                  </button>
                  <button
                    @click="viewMode = 'timeline'"
                    :class="[
                      'p-2 rounded-lg transition-all flex items-center justify-center',
                      viewMode === 'timeline'
                        ? 'bg-white dark:bg-gray-800 text-blue-600 shadow-sm ring-1 ring-gray-200 dark:ring-gray-700'
                        : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
                    ]"
                    title="Timeline View"
                  >
                    <Clock class="h-4 w-4" />
                  </button>
                  <button
                    @click="scheduleScrape"
                    :disabled="isScrapingDisabled"
                    class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Schedule this channel for scraping"
                  >
                    <ListFilter class="h-3 w-3" />
                    {{
                      isScrapingDisabled ? "Scheduled" : "Scheduled to Scrape"
                    }}
                  </button>
                </div>
              </div>

              <div
                v-if="posts.length === 0"
                class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400"
              >
                No posts found for this channel.
              </div>

              <div v-else>
                <div
                  class="mb-8 p-6 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700 w-full"
                >
                  <div
                    class="flex items-center gap-2 mb-4 text-gray-900 dark:text-gray-100 font-semibold"
                  >
                    <Filter class="h-4 w-4 text-blue-500" />
                    <h4 class="text-sm">Filter Posts</h4>
                  </div>
                  <div
                    class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
                  >
                    <input
                      v-model="filterAuthor"
                      placeholder="Filter by author..."
                      class="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                    />
                    <input
                      v-model="filterStartDate"
                      type="date"
                      class="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                    />
                    <input
                      v-model="filterEndDate"
                      type="date"
                      class="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                    />
                    <div
                      class="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-400"
                    >
                      <label class="flex items-center gap-2 cursor-pointer"
                        ><input
                          type="checkbox"
                          v-model="filterMedia.photos"
                          class="rounded text-blue-600"
                        />
                        Photos</label
                      >
                      <label class="flex items-center gap-2 cursor-pointer"
                        ><input
                          type="checkbox"
                          v-model="filterMedia.videos"
                          class="rounded text-blue-600"
                        />
                        Videos</label
                      >
                      <label class="flex items-center gap-2 cursor-pointer"
                        ><input
                          type="checkbox"
                          v-model="filterMedia.links"
                          class="rounded text-blue-600"
                        />
                        Links</label
                      >
                    </div>
                  </div>
                </div>
                <!-- Posts Timeline -->
                <div
                  v-if="postsTimelineStats && viewMode !== 'timeline'"
                  class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl border border-[#cfd5df] p-6 shadow-sm mb-8"
                >
                  <div class="flex items-center justify-between mb-4">
                    <h4
                      class="text-sm font-bold text-gray-900 dark:text-white flex items-center"
                    >
                      <Calendar class="h-4 w-4 mr-2 text-blue-500" />
                      Feed Activity Timeline
                    </h4>
                    <div class="flex items-center gap-4">
                      <div class="h-8 w-20 flex items-end gap-0.5 mr-2 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                        <div v-for="(item, idx) in postsTimelineStats.hourlyData" :key="idx" 
                             class="w-1 bg-blue-500 rounded-t-sm hover:bg-blue-600 transition-all cursor-pointer"
                             :title="`${item.hour}: ${item.count} posts`"
                             :style="{ height: `${(item.count / Math.max(...postsTimelineStats.hourlyData.map(d => d.count))) * 100}%` }">
                        </div>
                      </div>
                      <div class="text-[10px] bg-gray-100 dark:bg-gray-700 p-2 rounded-lg text-gray-600 dark:text-gray-300">
                        <span class="font-bold">Avg Gap:</span> {{ postsTimelineStats.avgGap }}
                      </div>
                      <div class="text-[10px] bg-gray-100 dark:bg-gray-700 p-2 rounded-lg text-gray-600 dark:text-gray-300">
                        <span class="font-bold">Max Sleep:</span> {{ postsTimelineStats.maxGap }}
                      </div>
                      <span
                        class="text-xs font-medium text-gray-500 dark:text-gray-400"
                      >
                        {{ postsTimelineStats.count }} dates
                      </span>
                    </div>
                  </div>

                  <div class="relative pt-4 pb-2 px-3">
                    <!-- Timeline track -->
                    <div
                      class="absolute w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full top-1/2 -translate-y-1/2"
                    ></div>

                    <!-- Timeline points -->
                    <div
                      v-for="(item, idx) in postsTimelineStats.items"
                      :key="idx"
                      class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-blue-500 border-2 border-white dark:border-gray-800 shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-300 hover:scale-150 cursor-pointer group"
                      :style="{ left: `${item.position}%` }"
                      @click="scrollToPost(item.post.key)"
                    >
                      <div
                        class="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none"
                      >
                        {{
                          format(new Date(item.post.data.date), "MMM d, HH:mm")
                        }}
                      </div>
                    </div>
                  </div>

                  <!-- Timeline Labels -->
                  <div
                    class="flex justify-between items-center mt-3 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider"
                  >
                    <span>{{ postsTimelineStats.start }}</span>
                    <span
                      class="px-2 py-1 bg-gray-50 dark:bg-gray-900 rounded-md"
                      >Span: Starts {{ postsTimelineStats.spanText }}</span
                    >
                    <span>{{ postsTimelineStats.end }}</span>
                  </div>
                </div>

                <!-- List View -->
                <div v-if="viewMode === 'list'" class="space-y-3">
                  <div
                    v-for="(post, index) in filteredPosts"
                    :id="`post-${post.key}`"
                    :key="post.key || index"
                    :class="[
                      'rounded-3xl shadow-sm border p-4 sm:p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden',
                      post.data?.grouped?.nr > 0
                        ? `${getGroupStyles(post.data.grouped.root).bg} ${
                            getGroupStyles(post.data.grouped.root).border
                          }`
                        : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700',
                      post.isNewEmphasized ? 'ring-2 ring-blue-500' : '',
                    ]"
                  >
                    <!-- Decorative Corner Glow -->
                    <div
                      class="absolute -top-10 -right-10 w-24 h-24 bg-blue-50/50 dark:bg-blue-900/10 rounded-full blur-2xl pointer-events-none"
                    ></div>

                    <!-- Badges -->
                    <div class="absolute top-4 right-4 flex space-x-1 z-20">
                      <button
                        @click.stop="sharePost(post)"
                        class="text-[10px] font-bold text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors flex items-center bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full"
                        title="Share"
                      >
                        <Share2 class="h-3 w-3 mr-1" /> Share
                      </button>
                      <span
                        class="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        :class="
                          getToolName(post) === 'TGB'
                            ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                            : 'bg-gray-50 dark:bg-gray-700/50 text-gray-400'
                        "
                      >
                        {{ getToolName(post) }}
                      </span>
                      <span
                        class="text-[10px] font-bold text-gray-400 bg-gray-50 dark:bg-gray-700/50 px-2 py-0.5 rounded-full"
                      >
                        {{ getUsername(post) }}
                      </span>
                    </div>

                    <div
                      class="flex justify-between items-start mb-3 relative z-10"
                    >
                      <div class="flex items-center space-x-3">
                        <div
                          class="w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs overflow-hidden ring-1 ring-white dark:ring-gray-800 shadow-sm"
                        >
                          <img
                            :src="getPostAvatarUrl(post)"
                            @error="handleImageError"
                            alt="Avatar"
                            class="w-full h-full object-cover"
                          />
                        </div>
                        <div>
                          <button
                            class="text-sm font-bold text-gray-900 dark:text-white hover:text-blue-500 transition-colors"
                            @click="
                              searchXUser(
                                post.data?.author ||
                                  post.data?.user ||
                                  metadata.name
                              )
                            "
                          >
                            {{
                              post.data?.author ||
                              post.data?.user ||
                              metadata.title ||
                              metadata.name
                            }}
                          </button>
                          <div
                            v-if="post.data?.grouped?.nr > 0"
                            :class="[
                              'flex items-center px-1.5 py-0.5 rounded-sm text-[8px] font-black uppercase tracking-wider',
                              getGroupStyles(post.data.grouped.root).badge,
                            ]"
                          >
                            <Layers class="h-2 w-2 mr-0.5" />
                            Group: {{ post.data.grouped.root }}
                          </div>
                          <p
                            class="flex justify-between items-center text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mt-0"
                          >
                            <span>{{ formatDate(post.data?.date) }}</span>
                            <span v-if="post.mtime" class="text-[9px] text-blue-500 dark:text-blue-400 ml-2">
                              Scraped: {{ formatScrapedDate(post.mtime) }}
                            </span>
                          </p>
                        </div>
                      </div>
                      <a
                        v-if="post.url || post.link"
                        :href="post.url || post.link"
                        target="_blank"
                        class="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors flex items-center bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full"
                      >
                        View <ExternalLink class="h-2.5 w-2.5 ml-0.5" />
                      </a>
                    </div>

                    <!-- Quoted Reply -->
                    <div
                      v-if="post.data?.reply && post.data.reply.length >= 2"
                      class="mb-4 border-l-4 border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/10 p-4 rounded-r-2xl relative z-10"
                    >
                      <div
                        class="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-1.5"
                      >
                        <div class="flex items-center">
                          <Reply class="h-3 w-3 mr-1" />
                          Reply to message
                        </div>
                        <span
                          v-if="
                            Array.isArray(post.data?.reply) &&
                            post.data.reply[0] != null
                          "
                          class="font-mono bg-blue-100/50 dark:bg-blue-800/30 px-2 py-0.5 rounded border border-blue-200/50 dark:border-blue-700/50 tracking-normal text-[10px] normal-case"
                          >ID:
                          {{
                            post.data._tool
                              ? post.data.reply[0]
                              : String(post.data.reply[0]).split("/").pop()
                          }}</span
                        >
                      </div>
                      <div
                        class="text-gray-700 dark:text-gray-300 text-sm whitespace-pre-wrap break-words italic line-clamp-3"
                      >
                        {{ post.data.reply[1] }}
                      </div>
                    </div>

                    <!-- Forward Area -->
                    <div
                      v-if="post.data?.forward_url"
                      class="mb-4 border-l-4 border-purple-400 dark:border-purple-500 bg-purple-50/50 dark:bg-purple-900/10 p-4 rounded-r-2xl relative z-10"
                    >
                      <div
                        class="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-1.5"
                      >
                        <div class="flex items-center">
                          <Forward class="h-3 w-3 mr-1" />
                          Forward
                        </div>
                        <span v-if="getForwardInfo(post)?.date" class="font-mono bg-purple-100/50 dark:bg-purple-800/30 px-2 py-0.5 rounded border border-purple-200/50 dark:border-purple-700/50 tracking-normal text-[10px] normal-case">
                          {{ getForwardInfo(post)?.date }}
                        </span>
                      </div>
                      <div class="text-gray-800 dark:text-gray-200 text-sm font-medium whitespace-pre-wrap break-words italic line-clamp-3">
                        {{ getForwardInfo(post)?.text }}
                      </div>
                    </div>

                    <div
                      v-if="post.data?.content"
                      class="flex items-start gap-2 mb-4 relative z-10"
                    >
                      <div
                        class="text-gray-800 dark:text-gray-200 text-[15px] leading-relaxed whitespace-pre-wrap break-words flex-1"
                      >
                        {{ post.data.content }}
                      </div>
                      <button
                        @click="searchOnGoogle(post.data.content)"
                        class="p-1 -mt-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors flex-shrink-0"
                        title="Search on Google"
                      >
                        <Search class="h-4 w-4" />
                      </button>
                    </div>

                    <!-- Contact Subcard -->
                    <div
                      v-if="
                        post.data?.contact &&
                        Object.keys(post.data.contact).length > 0
                      "
                      class="mb-4 rounded-xl border border-blue-200/50 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-900/20 p-4 relative z-10 shadow-sm"
                    >
                      <div class="flex items-center mb-3">
                        <div
                          class="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-800/50 flex flex-shrink-0 items-center justify-center text-blue-600 dark:text-blue-400 mr-3"
                        >
                          <User class="h-4 w-4" />
                        </div>
                        <div
                          class="text-[10px] font-black tracking-widest text-blue-500 uppercase"
                        >
                          Contact Shared
                        </div>
                      </div>
                      <div
                        v-if="typeof post.data.contact === 'object'"
                        class="space-y-2 bg-white/60 dark:bg-gray-900/60 p-3 rounded-lg border border-gray-100/50 dark:border-gray-700/50"
                      >
                        <div
                          v-if="
                            post.data.contact.first_name ||
                            post.data.contact.last_name
                          "
                          class="flex items-center text-sm font-bold text-gray-900 dark:text-gray-100"
                        >
                          {{ post.data.contact.first_name }}
                          {{ post.data.contact.last_name }}
                        </div>
                        <div
                          v-if="post.data.contact.phone_number"
                          class="flex items-center text-xs text-gray-700 dark:text-gray-300"
                        >
                          <Phone class="h-3.5 w-3.5 mr-1.5 text-blue-500/70" />
                          {{ post.data.contact.phone_number }}
                        </div>
                        <div
                          v-if="
                            !post.data.contact.first_name &&
                            !post.data.contact.phone_number
                          "
                          class="text-xs text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words"
                        >
                          {{
                            JSON.stringify(post.data.contact, null, 2)
                              .replace(/[\{\}"]/g, "")
                              .trim()
                          }}
                        </div>
                      </div>
                      <div
                        v-else
                        class="text-xs text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words bg-white/60 dark:bg-gray-900/60 p-3 rounded-lg border border-gray-100/50 dark:border-gray-700/50"
                      >
                        {{ post.data.contact }}
                      </div>
                    </div>

                    <!-- Media Embeds -->
                    <div
                      v-if="post.data?.photos && post.data.photos.length > 0"
                      class="mb-4 rounded-3xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 group/media cursor-zoom-in flex items-center justify-center"
                      @click="
                        openLightbox(
                          `https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`
                        )
                      "
                    >
                      <img
                        :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`"
                        class="w-full h-auto max-h-[500px] object-contain mx-auto transition-transform duration-700 group-hover/media:scale-105"
                        alt="Post photo"
                        referrerpolicy="no-referrer"
                      />
                    </div>

                    <div
                      v-if="post.data?.videos && post.data.videos.length > 0"
                      class="mb-4 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-black shadow-lg relative z-10"
                    >
                      <video
                        controls
                        class="w-full h-auto max-h-[500px] mx-auto"
                      >
                        <source :src="getVideoUrl(post)" type="video/mp4" />
                      </video>
                    </div>

                    <!-- Link Preview -->
                    <div
                      v-if="post.data?.linkPreview"
                      class="mb-4 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/50 flex flex-col sm:flex-row shadow-sm hover:shadow-md transition-shadow relative z-10"
                    >
                      <div
                        v-if="post.data.linkPreview.image"
                        class="sm:w-32 sm:h-32 flex-shrink-0 bg-gray-200 dark:bg-gray-800 overflow-hidden cursor-zoom-in"
                        @click="
                          openLightbox(
                            `https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`
                          )
                        "
                      >
                        <img
                          :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`"
                          class="w-full h-full object-cover transition-transform duration-700 hover:scale-105"
                          alt="Link preview"
                          referrerpolicy="no-referrer"
                        />
                      </div>
                      <div
                        class="p-4 sm:p-5 flex flex-col justify-center flex-1 min-w-0"
                      >
                        <span
                          v-if="post.data.linkPreview.siteName"
                          class="text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5"
                          >{{ post.data.linkPreview.siteName }}</span
                        >
                        <a
                          v-if="post.data.linkPreview.href"
                          :href="post.data.linkPreview.href"
                          target="_blank"
                          class="text-sm font-bold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 mb-1.5 line-clamp-1 transition-colors"
                        >
                          {{
                            post.data.linkPreview.title ||
                            post.data.linkPreview.href
                          }}
                        </a>
                        <p
                          v-if="post.data.linkPreview.description"
                          class="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 leading-relaxed"
                        >
                          {{ post.data.linkPreview.description }}
                        </p>
                      </div>
                    </div>

                    <div
                      class="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700/50 flex flex-col space-y-4 relative z-10"
                    >
                      <div
                        class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400"
                      >
                        <div class="flex items-center space-x-6">
                          <span
                            v-if="post.data?.views != null"
                            class="flex items-center font-semibold border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800"
                          >
                            <Users class="h-3 w-3 mr-1.5 text-gray-400" />
                            {{ formatViews(post.data.views) }}
                          </span>
                        </div>
                        <span
                          v-if="post.key"
                          class="font-mono bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200/50 dark:border-gray-700/50 px-2.5 py-1 rounded-lg text-[10px] font-medium text-gray-400 dark:text-gray-500 backdrop-blur-sm"
                          >ID: {{ post.key }}</span
                        >
                      </div>
                      <!-- Raw Post Debug -->
                      <details
                        class="bg-gray-50/50 dark:bg-gray-900/30 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-4 text-xs transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/50"
                      >
                        <summary
                          class="font-medium text-gray-700 dark:text-gray-400 cursor-pointer outline-none hover:text-gray-900 dark:hover:text-gray-300"
                        >
                          View Raw Post Data
                        </summary>
                        <pre
                          class="mt-3 overflow-x-auto text-gray-600 dark:text-gray-400 custom-scrollbar"
                          >{{ JSON.stringify(post, null, 2) }}</pre
                        >
                      </details>
                    </div>
                  </div>
                </div>

                <!-- Masonry View -->
                <div
                  v-else-if="viewMode === 'masonry'"
                  class="columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5 min-[1900px]:columns-6 gap-6 space-y-6"
                >
                  <div
                    v-for="(post, index) in mediaPosts"
                    :key="post.key || index"
                    :class="[
                      'break-inside-avoid rounded-3xl shadow-sm border overflow-hidden group hover:shadow-2xl hover:-translate-y-1 transition-all duration-500',
                      post.data?.grouped?.nr > 0
                        ? `${getGroupStyles(post.data.grouped.root).bg.replace(
                            '/30',
                            '/10'
                          )} border-white/20 dark:border-gray-700`
                        : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700',
                    ]"
                  >
                    <div
                      class="relative overflow-hidden cursor-pointer group/inner"
                      @click="openPostModal(post)"
                    >
                      <!-- ID Badge -->
                      <div
                        class="absolute top-4 left-4 z-10 flex flex-col space-y-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      >
                        <div
                          v-if="post.key"
                          class="font-mono text-[10px] font-bold tracking-tight bg-black/60 backdrop-blur-md text-white px-2.5 py-1 rounded-lg border border-white/10 w-fit shadow-xl"
                        >
                          ID: {{ post.key.split(".").pop() }}
                        </div>
                        <div
                          v-if="post.data?.grouped?.nr > 0"
                          :class="[
                            'flex items-center px-2 py-1 rounded-lg backdrop-blur-md text-white text-[9px] font-black uppercase tracking-widest border border-white/20 w-fit shadow-xl',
                            getGroupStyles(post.data.grouped.root).masonryBadge,
                          ]"
                        >
                          <Layers class="h-2.5 w-2.5 mr-1.5" />
                          Group: {{ post.data.grouped.root }}
                        </div>
                      </div>

                      <img
                        v-if="post.data?.photos && post.data.photos.length > 0"
                        :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`"
                        class="w-full h-auto object-cover transition-transform duration-1000 group-hover/inner:scale-105"
                        referrerpolicy="no-referrer"
                      />
                      <div
                        v-else-if="
                          post.data?.videos && post.data.videos.length > 0
                        "
                        class="relative bg-black flex items-center justify-center cursor-default"
                        @click.stop
                      >
                        <video class="w-full h-auto object-cover max-h-[500px]">
                          <source :src="getVideoUrl(post)" type="video/mp4" />
                        </video>
                      </div>
                      <img
                        v-else-if="
                          post.data?.linkPreview && post.data.linkPreview.image
                        "
                        :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`"
                        class="w-full h-auto object-cover transition-transform duration-1000 group-hover/inner:scale-105"
                        referrerpolicy="no-referrer"
                      />

                      <div
                        class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500 flex flex-col justify-end p-6 translate-y-2 group-hover:translate-y-0"
                      >
                        <p
                          class="text-white text-sm font-medium line-clamp-3 leading-relaxed mb-4 drop-shadow-sm"
                        >
                          {{
                            post.data?.content ||
                            post.data?.linkPreview?.title ||
                            "Media update"
                          }}
                        </p>
                        <div class="flex items-center justify-between">
                          <div class="flex flex-col">
                            <div class="flex items-center gap-1.5 mb-0.5">
                              <span
                                class="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                                :class="
                                  getToolName(post) === 'TGB'
                                    ? 'bg-purple-500/20 text-purple-200'
                                    : 'bg-white/10 text-white/50'
                                "
                              >
                                {{ getToolName(post) }}
                              </span>
                              <span
                                class="text-[10px] font-black text-blue-400 uppercase tracking-widest"
                                >{{
                                  post.data?.author ||
                                  post.data?.user ||
                                  metadata.title
                                }}</span
                              >
                            </div>
                            <span
                              class="text-white/70 text-[9px] font-bold uppercase tracking-wider"
                              >{{ formatDate(post.data?.date) }}</span
                            >
                          </div>
                          <a
                            :href="post.url || post.link"
                            target="_blank"
                            class="p-2.5 bg-white/10 hover:bg-white/20 rounded-xl backdrop-blur-md transition-all border border-white/10 shadow-lg"
                          >
                            <ExternalLink class="h-3.5 w-3.5 text-white" />
                          </a>
                          <button
                            @click.stop="sharePost(post)"
                            class="p-2.5 bg-white/10 hover:bg-white/20 rounded-xl backdrop-blur-md transition-all border border-white/10 shadow-lg ml-2"
                          >
                            <Share2 class="h-3.5 w-3.5 text-white" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div
                    v-if="mediaPosts.length === 0"
                    class="col-span-full py-20 text-center"
                  >
                    <ImageIcon class="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <p class="text-gray-500 dark:text-gray-400">
                      No media posts found in this channel.
                    </p>
                  </div>
                </div>

                <!-- Timeline View -->
                <div
                  v-else-if="viewMode === 'timeline'"
                  class="relative space-y-16 pb-12 before:absolute before:inset-0 before:left-8 md:before:left-1/2 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-blue-500/0 before:via-blue-500/30 before:to-blue-500/0"
                >
                  <div
                    v-for="(post, index) in mediaPosts"
                    :key="post.key || index"
                    class="relative flex flex-col md:flex-row items-start md:justify-between group"
                  >
                    <!-- Central Timeline Axis with Date -->
                    <div
                      class="absolute left-8 md:left-1/2 w-48 -mx-24 flex flex-col items-center justify-center z-20 pointer-events-none group-hover:scale-105 transition-transform duration-500"
                    >
                      <div
                        @click="scrollToPost(post.key)"
                        class="pointer-events-auto cursor-pointer flex items-center justify-center w-12 h-12 rounded-full border-4 border-white dark:border-gray-900 bg-blue-600 text-white shadow-xl shadow-blue-500/20 shrink-0 transition-colors duration-500 group-hover:bg-blue-500 group-hover:shadow-blue-500/40"
                      >
                        <ImageIcon
                          v-if="
                            post.data?.photos?.length ||
                            post.data?.linkPreview?.image
                          "
                          class="h-5 w-5"
                        />
                        <Video v-else class="h-5 w-5" />
                        <!-- Hidden ID for screen readers -->
                        <span class="sr-only">Post {{ post.key }}</span>
                      </div>
                      <!-- Inline Timeline Date Display -->
                      <div
                        class="mt-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col items-center pointer-events-auto"
                      >
                        <span
                          class="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest leading-none whitespace-nowrap"
                          >{{ formatDate(post.data?.date).split(" ")[0] }}</span
                        >
                        <span
                          class="text-[10px] font-bold text-gray-500 dark:text-gray-400 mt-1 leading-none whitespace-nowrap"
                          >{{
                            formatDate(post.data?.date)
                              .split(" ")
                              .slice(1)
                              .join(" ")
                          }}</span
                        >
                      </div>
                    </div>

                    <!-- Metadata Side (Right on Desktop) -->
                    <div
                      class="w-full pl-24 md:pl-0 md:w-[calc(50%-4rem)] md:text-left pr-0 md:pl-16 order-2 md:order-3 mb-4 md:mb-0 mt-3 md:mt-0"
                    >
                      <div class="flex flex-col md:items-start">
                        <div
                          class="flex items-center space-x-2 md:flex-row mb-1"
                        >
                          <button
                            class="text-base font-black text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors uppercase tracking-tighter hover:text-blue-500"
                            @click="
                              searchXUser(
                                post.data?.author ||
                                  post.data?.user ||
                                  metadata.name
                              )
                            "
                          >
                            {{
                              post.data?.author ||
                              post.data?.user ||
                              metadata.title
                            }}
                          </button>
                          <div
                            v-if="post.data?.grouped?.nr > 0"
                            :class="[
                              'flex items-center px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider',
                              getGroupStyles(post.data.grouped.root).badge,
                            ]"
                          >
                            <Layers class="h-2.5 w-2.5 mr-1" />
                            Group: {{ post.data.grouped.root }}
                          </div>
                        </div>
                        <div class="flex flex-col flex-start space-y-1 mb-4">
                          <span
                            v-if="post.key"
                            class="text-[9px] font-mono text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/40 px-2 rounded-md"
                            >ID: {{ post.key.split(".").pop() }}</span
                          >
                        </div>

                        <!-- Post Content -->
                        <div
                          v-if="post.data?.content"
                          class="text-gray-700 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap break-words mb-4 md:max-w-md bg-gray-50/50 dark:bg-gray-800/30 p-4 rounded-2xl border border-gray-100/50 dark:border-gray-700/50"
                        >
                          {{ post.data.content }}
                        </div>

                        <!-- Link Preview Text -->
                        <div
                          v-if="post.data?.linkPreview"
                          class="bg-gray-50 dark:bg-gray-900/40 p-3 rounded-2xl border border-gray-100 dark:border-gray-800 mb-4 flex flex-col md:items-start max-w-full"
                        >
                          <span
                            v-if="post.data.linkPreview.siteName"
                            class="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1"
                            >{{ post.data.linkPreview.siteName }}</span
                          >
                          <h4
                            v-if="post.data.linkPreview.title"
                            class="text-xs font-bold text-gray-900 dark:text-white mb-1 leading-tight"
                          >
                            {{ post.data.linkPreview.title }}
                          </h4>
                          <p
                            v-if="post.data.linkPreview.description"
                            class="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-3 md:text-left"
                          >
                            {{ post.data.linkPreview.description }}
                          </p>
                        </div>

                        <div
                          v-if="post.data?.views != null"
                          class="inline-flex items-center px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg text-[9px] font-bold text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700"
                        >
                          <Users class="h-3 w-3 mr-1" />
                          {{ formatViews(post.data.views) }} Views
                        </div>
                      </div>
                    </div>

                    <!-- Media Content Side (Left on Desktop) -->
                    <div
                      class="w-full pl-24 md:pl-0 md:w-[calc(50%-4rem)] md:pr-16 order-3 md:order-1 flex items-center justify-center"
                    >
                      <div
                        class="bg-white dark:bg-gray-800 p-5 rounded-[2.5rem] shadow-xl shadow-blue-500/[0.02] border border-gray-100 dark:border-gray-700 hover:border-blue-500/30 dark:hover:border-blue-400/30 transition-all duration-500 hover:shadow-2xl hover:shadow-blue-500/[0.05] dark:hover:shadow-none bg-clip-padding flex flex-col items-center justify-center"
                      >
                        <div
                          class="rounded-3xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 group/media cursor-zoom-in flex items-center justify-center"
                          @click="
                            openLightbox(
                              post.data?.photos?.length
                                ? `https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`
                                : `https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`
                            )
                          "
                        >
                          <img
                            v-if="
                              post.data?.photos && post.data.photos.length > 0
                            "
                            :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`"
                            class="w-full h-auto object-cover max-h-[400px] transition-transform duration-1000 group-hover/media:scale-105"
                            referrerpolicy="no-referrer"
                          />
                          <video
                            v-else-if="
                              post.data?.videos && post.data.videos.length > 0
                            "
                            controls
                            class="w-full h-auto bg-black max-h-[400px] cursor-default"
                            @click.stop
                          >
                            <source :src="getVideoUrl(post)" type="video/mp4" />
                          </video>
                          <img
                            v-else-if="
                              post.data?.linkPreview &&
                              post.data.linkPreview.image
                            "
                            :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`"
                            class="w-full h-auto object-cover max-h-[400px] transition-transform duration-1000 group-hover/media:scale-105"
                            referrerpolicy="no-referrer"
                          />
                        </div>

                        <div
                          class="mt-4 pt-3 border-t border-gray-50 dark:border-gray-700 flex justify-end"
                        >
                          <a
                            v-if="post.url || post.link"
                            :href="post.url || post.link"
                            target="_blank"
                            class="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center"
                          >
                            OPEN IN TELEGRAM
                            <ExternalLink class="h-2.5 w-2.5 ml-1" />
                          </a>
                          <button
                            @click.stop="sharePost(post)"
                            class="text-[10px] font-bold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:underline flex items-center ml-4"
                          >
                            SHARE
                            <Share2 class="h-2.5 w-2.5 ml-1" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div v-if="mediaPosts.length === 0" class="py-20 text-center">
                    <Clock class="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <p class="text-gray-500 dark:text-gray-400">
                      No media posts found in this channel.
                    </p>
                  </div>
                </div>

                <!-- Scroll Sentinel -->
                <div
                  ref="bottomSentinel"
                  class="h-10 mt-4 flex items-center justify-center"
                >
                  <div
                    v-if="isLoadingMore"
                    class="flex items-center space-x-2 text-blue-500"
                  >
                    <Loader2 class="h-5 w-5 animate-spin" />
                    <span class="text-sm font-medium">Loading more...</span>
                  </div>
                  <div
                    v-else-if="!hasMorePosts && posts.length > 0"
                    class="text-xs text-gray-400 uppercase tracking-widest font-bold opacity-50"
                  >
                    End of feed
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="!loading && !error" class="text-center py-24 sm:py-32">
          <div
            class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-50 dark:bg-blue-900/20 mb-6 shadow-inner ring-1 ring-blue-100 dark:ring-blue-800 border-8 border-white dark:border-gray-900"
          >
            <Search class="h-8 w-8 text-blue-500 dark:text-blue-400" />
          </div>
          <h2
            class="text-2xl font-black tracking-tight text-gray-900 dark:text-white mb-3"
          >
            Explore Channels
          </h2>
          <p
            class="text-gray-500 dark:text-gray-400 max-w-sm mx-auto font-medium"
          >
            Enter a Telegram channel username above to view its detailed profile
            and latest media posts.
          </p>
        </div>
      </div>

      <!-- Global Search Tab -->
      <div
        v-show="activeTab === 'search'"
        class="max-w-[96rem] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10"
      >
        <div
          class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-[2rem] shadow-2xl shadow-blue-900/5 dark:shadow-none border border-gray-100 dark:border-gray-700 p-5 sm:p-8 mb-10 relative overflow-hidden"
        >
          <!-- Background Decoration -->
          <div
            class="absolute -top-20 -right-20 w-40 h-40 bg-blue-500/10 dark:bg-blue-500/20 rounded-full blur-3xl pointer-events-none"
          ></div>
          <div
            class="absolute -bottom-20 -left-20 w-40 h-40 bg-purple-500/10 dark:bg-purple-500/20 rounded-full blur-3xl pointer-events-none"
          ></div>

          <form @submit.prevent="performGlobalSearch" class="relative z-10">
            <div class="relative flex items-center mb-6 group">
              <div
                class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-transform duration-300 group-focus-within:scale-110 group-focus-within:text-blue-500 z-10"
              >
                <Globe class="h-5 w-5 text-gray-400" />
              </div>
              <input
                v-model="globalSearchQuery"
                type="text"
                class="block w-full pl-12 pr-[120px] py-3.5 border border-gray-200 dark:border-gray-700 rounded-xl leading-5 bg-white/90 dark:bg-gray-800/90 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-medium shadow-sm hover:shadow-md focus:shadow-xl transition-all duration-300"
                placeholder="Search across all telegram data..."
              />
              <button
                type="submit"
                :disabled="isSearching || !globalSearchQuery.trim()"
                class="absolute right-2 top-2 bottom-2 px-5 bg-blue-600 text-white rounded-[0.65rem] text-xs font-bold tracking-wide hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:-translate-y-0.5 active:translate-y-0"
              >
                <Loader2 v-if="isSearching" class="h-5 w-5 animate-spin mr-2" />
                {{ isSearching ? "Searching..." : "Search" }}
              </button>
            </div>

            <div class="flex flex-col gap-4">
              <div class="flex flex-wrap gap-2 items-center">
                <span
                  class="text-[9px] font-black text-gray-400 dark:text-gray-500 mr-2 uppercase tracking-widest"
                  >Search in</span
                >
                <button
                  v-for="(val, field) in searchFields"
                  :key="field"
                  type="button"
                  @click="toggleField(field)"
                  :class="[
                    'flex items-center px-2.5 py-1 rounded-lg border transition-all duration-300',
                    searchFields[field]
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white/50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400',
                  ]"
                >
                  <component :is="getFieldIcon(field)" class="h-3 w-3 mr-1.5" />
                  <span
                    class="text-[10px] font-bold capitalize tracking-tight"
                    >{{ field === "content" ? "Post" : field }}</span
                  >
                </button>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <div
                  class="flex flex-wrap items-center bg-gray-50/80 dark:bg-gray-900/50 p-1.5 rounded-xl border border-gray-200 dark:border-gray-700 backdrop-blur-sm gap-1"
                >
                  <input
                    type="datetime-local"
                    v-model="searchStartDate"
                    class="bg-transparent text-[10px] p-0.5 text-gray-600 dark:text-gray-300 focus:outline-none w-[130px]"
                  />
                  <span class="text-[10px] text-gray-400 px-1">to</span>
                  <input
                    type="datetime-local"
                    v-model="searchEndDate"
                    class="bg-transparent text-[10px] p-0.5 text-gray-600 dark:text-gray-300 focus:outline-none w-[130px]"
                  />
                </div>

                <div
                  class="flex items-center bg-gray-50/80 dark:bg-gray-900/50 p-1.5 rounded-xl border border-gray-200 dark:border-gray-700 backdrop-blur-sm"
                >
                  <div class="px-2 text-gray-400 dark:text-gray-500">
                    <ListFilter class="h-3 w-3" />
                  </div>
                  <div class="flex space-x-0.5">
                    <button
                      v-for="limit in limitOptions"
                      :key="limit"
                      type="button"
                      @click="searchLimit = limit"
                      :class="[
                        'px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all',
                        searchLimit === limit
                          ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                          : 'text-gray-400',
                      ]"
                    >
                      {{ limit }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>

        <div
          v-if="searchError"
          class="rounded-xl bg-red-50 dark:bg-red-900/20 p-4 mb-8 border border-red-100 dark:border-red-900/50 flex items-start"
        >
          <AlertCircle
            class="h-5 w-5 text-red-400 dark:text-red-500 mt-0.5 mr-3 flex-shrink-0"
          />
          <div class="text-sm text-red-700 dark:text-red-400">
            <h3 class="font-medium text-red-800 dark:text-red-300 mb-1">
              Search Error
            </h3>
            <p>{{ searchError }}</p>
          </div>
        </div>

        <div
          v-if="isSearching"
          class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-[2.5rem] border border-gray-100 dark:border-gray-700 p-16 text-center shadow-lg"
        >
          <div
            class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-50 dark:bg-blue-900/20 mb-6 shadow-inner ring-1 ring-blue-100 dark:ring-blue-800 border-8 border-white dark:border-gray-900"
          >
            <Loader2
              class="h-8 w-8 text-blue-500 dark:text-blue-400 animate-spin"
            />
          </div>
          <h3
            class="text-2xl font-black tracking-tight text-gray-900 dark:text-white mb-3"
          >
            Searching Telegram...
          </h3>
          <p
            class="text-gray-500 dark:text-gray-400 max-w-sm mx-auto font-medium"
          >
            Querying internal dataset, this may take a few seconds.
          </p>
        </div>

        <div
          v-else-if="filteredSearchResults.length > 0"
          class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start px-4 sm:px-0"
        >
          <!-- Usernames Widget -->
          <div
            class="lg:col-span-4 xl:col-span-3 space-y-4 h-fit sticky top-20 flex-shrink-0"
          >
            <div
              class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl border border-gray-100 dark:border-gray-700 p-6 shadow-sm"
            >
              <h3
                class="text-xs font-black text-gray-400 uppercase tracking-wider mb-4"
              >
                Usernames
              </h3>
              <div
                class="max-h-[calc(100vh-15rem)] overflow-y-auto space-y-1 pr-2 custom-scrollbar"
              >
                <button
                  v-for="username in allUsernames"
                  :key="username"
                  @click="toggleUsername(username)"
                  :class="[
                    'w-full text-left p-2.5 rounded-lg text-xs font-medium transition-all',
                    selectedUsernames.includes(username)
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
                  ]"
                >
                  {{ username }}
                </button>
              </div>
            </div>
          </div>

          <div class="lg:col-span-8 xl:col-span-9 space-y-6">
            <div
              v-if="searchTimelineStats"
              class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl border border-gray-100 dark:border-gray-700 p-6 shadow-sm mb-8"
            >
              <div class="flex items-center justify-between mb-4">
                <h4
                  class="text-sm font-bold text-gray-900 dark:text-white flex items-center"
                >
                  <Calendar class="h-4 w-4 mr-2 text-blue-500" />
                  Activity Timeline
                </h4>
                <span
                  class="text-xs font-medium text-gray-500 dark:text-gray-400"
                >
                  {{ searchTimelineStats.count }} dates mapped
                </span>
              </div>

              <div class="relative pt-4 pb-2">
                <!-- Timeline track -->
                <div
                  class="absolute w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full top-1/2 -translate-y-1/2"
                ></div>

                <!-- Timeline points -->
                <div
                  v-for="(item, idx) in searchTimelineStats.items"
                  :key="idx"
                  class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-blue-500 border-2 border-white dark:border-gray-800 shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-300 hover:scale-150 cursor-pointer group"
                  :style="{ left: `${item.position}%` }"
                  @click="scrollToPost(item.post.key)"
                >
                  <div
                    class="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none"
                  >
                    {{ format(new Date(item.post.data.date), "MMM d, HH:mm") }}
                  </div>
                </div>
              </div>

              <!-- Timeline Labels -->
              <div
                class="flex justify-between items-center mt-3 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider"
              >
                <span>{{ searchTimelineStats.start }}</span>
                <span class="px-2 py-1 bg-gray-50 dark:bg-gray-900 rounded-md"
                  >Span: Starts {{ searchTimelineStats.spanText }}</span
                >
                <span>{{ searchTimelineStats.end }}</span>
              </div>
            </div>

            <div class="flex items-center justify-between mb-2">
              <h3
                class="text-lg font-bold text-gray-900 dark:text-white flex items-center"
              >
                <MessageSquare
                  class="h-5 w-5 mr-2 text-blue-500 dark:text-blue-400"
                />
                Search Results
              </h3>
              <span class="text-xs text-gray-500 dark:text-gray-400"
                >{{ filteredSearchResults.length }} results found</span
              >
            </div>

            <div class="space-y-4">
              <div
                v-for="(post, index) in filteredSearchResults"
                :id="`post-${post.key}`"
                :key="post.key || index"
                :class="[
                  'relative rounded-2xl shadow-sm border p-5 hover:shadow-md transition-all duration-300',
                  post.data?.grouped?.nr > 0
                    ? `${getGroupStyles(post.data.grouped.root).bg} ${
                        getGroupStyles(post.data.grouped.root).border
                      }`
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700',
                ]"
              >
                <div class="absolute top-4 right-4 flex space-x-1">
                  <button
                    @click.stop="sharePost(post)"
                    class="text-[10px] font-bold text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors flex items-center bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full"
                    title="Share"
                  >
                    <Share2 class="h-3 w-3 mr-1" /> Share
                  </button>
                  <span
                    class="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    :class="
                      getToolName(post) === 'TGB'
                        ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                        : 'bg-gray-50 dark:bg-gray-700/50 text-gray-400'
                    "
                  >
                    {{ getToolName(post) }}
                  </span>
                  <span
                    class="text-[10px] font-bold text-gray-400 bg-gray-50 dark:bg-gray-700/50 px-2 py-0.5 rounded-full"
                  >
                    {{ getUsername(post) }}
                  </span>
                </div>
                <div class="flex justify-between items-start mb-3">
                  <div class="flex items-center space-x-2">
                    <div
                      class="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs overflow-hidden"
                    >
                      <img
                        :src="getPostAvatarUrl(post)"
                        @error="handleImageError"
                        alt="Avatar"
                        class="w-full h-full object-cover"
                      />
                    </div>
                    <div>
                      <div class="flex items-center space-x-2">
                        <p
                          class="text-sm font-semibold text-gray-900 dark:text-white"
                        >
                          {{
                            post.data?.author ||
                            post.data?.user ||
                            "Telegram User"
                          }}
                        </p>
                        <div
                          v-if="post.data?.grouped?.nr > 0"
                          :class="[
                            'flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider',
                            getGroupStyles(post.data.grouped.root).badge,
                          ]"
                        >
                          <Layers class="h-2.5 w-2.5 mr-1" />
                          Group: {{ post.data.grouped.root }}
                        </div>
                      </div>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        {{ formatDate(post.data?.date) }}
                      </p>
                    </div>
                  </div>
                  <a
                    v-if="post.url || post.link"
                    :href="post.url || post.link"
                    target="_blank"
                    class="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center"
                  >
                    View <ExternalLink class="h-3 w-3 ml-1" />
                  </a>
                </div>

                <!-- Quoted Reply -->
                <div
                  v-if="post.data?.reply && post.data.reply.length >= 2"
                  class="mb-3 border-l-4 border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 p-3 rounded-r-xl"
                >
                  <div
                    class="flex items-center justify-between text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1"
                  >
                    <div class="flex items-center">
                      <Reply class="h-3 w-3 mr-1" />
                      Reply to message
                    </div>
                    <span
                      v-if="
                        Array.isArray(post.data?.reply) &&
                        post.data.reply[0] != null
                      "
                      class="font-mono bg-blue-100/50 dark:bg-blue-800/30 px-2 py-0.5 rounded border border-blue-200/50 dark:border-blue-700/50 text-[10px]"
                      >ID:
                      {{
                        post.data._tool
                          ? post.data.reply[0]
                          : String(post.data.reply[0]).split("/").pop()
                      }}</span
                    >
                  </div>
                  <div
                    class="text-gray-700 dark:text-gray-300 text-sm whitespace-pre-wrap break-words line-clamp-3"
                    v-html="highlightText(post.data.reply[1])"
                  ></div>
                </div>

                <!-- Forward Area -->
                <div
                  v-if="post.data?.forward_url"
                  class="mb-3 border-l-4 border-purple-400 dark:border-purple-500 bg-purple-50/50 dark:bg-purple-900/20 p-3 rounded-r-xl"
                >
                  <div
                    class="flex items-center justify-between text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1"
                  >
                    <div class="flex items-center">
                      <Forward class="h-3 w-3 mr-1" />
                      Forward
                    </div>
                    <span v-if="getForwardInfo(post)?.date" class="font-mono bg-purple-100/50 dark:bg-purple-800/30 px-2 py-0.5 rounded border border-purple-200/50 dark:border-purple-700/50 text-[10px]">
                      {{ getForwardInfo(post)?.date }}
                    </span>
                  </div>
                  <div
                    class="text-gray-800 dark:text-gray-200 text-sm font-medium whitespace-pre-wrap break-words line-clamp-3"
                  >
                    {{ getForwardInfo(post)?.text }}
                  </div>
                </div>

                <div
                  v-if="post.data?.content"
                  class="flex items-start gap-2 mb-3"
                >
                  <div
                    class="text-gray-800 dark:text-gray-200 text-sm whitespace-pre-wrap break-words flex-1"
                    v-html="highlightText(post.data.content)"
                  ></div>
                  <button
                    @click="searchOnGoogle(post.data.content)"
                    class="p-1 -mt-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors flex-shrink-0"
                    title="Search on Google"
                  >
                    <Search class="h-4 w-4" />
                  </button>
                </div>

                <!-- Contact Subcard -->
                <div
                  v-if="
                    post.data?.contact &&
                    Object.keys(post.data.contact).length > 0
                  "
                  class="mb-3 rounded-lg border border-blue-200/50 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-900/20 p-3 relative z-10 shadow-sm"
                >
                  <div class="flex items-center mb-2">
                    <div
                      class="h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-800/50 flex flex-shrink-0 items-center justify-center text-blue-600 dark:text-blue-400 mr-2"
                    >
                      <User class="h-3.5 w-3.5" />
                    </div>
                    <div
                      class="text-[9px] font-black tracking-widest text-blue-500 uppercase"
                    >
                      Contact Shared
                    </div>
                  </div>
                  <div
                    v-if="typeof post.data.contact === 'object'"
                    class="space-y-1.5 bg-white/60 dark:bg-gray-900/60 p-2.5 rounded-md border border-gray-100/50 dark:border-gray-700/50"
                  >
                    <div
                      v-if="
                        post.data.contact.first_name ||
                        post.data.contact.last_name
                      "
                      class="flex items-center text-xs font-bold text-gray-900 dark:text-gray-100"
                    >
                      {{ post.data.contact.first_name }}
                      {{ post.data.contact.last_name }}
                    </div>
                    <div
                      v-if="post.data.contact.phone_number"
                      class="flex items-center text-xs text-gray-700 dark:text-gray-300"
                    >
                      <Phone class="h-3 w-3 mr-1.5 text-blue-500/70" />
                      {{ post.data.contact.phone_number }}
                    </div>
                    <div
                      v-if="
                        !post.data.contact.first_name &&
                        !post.data.contact.phone_number
                      "
                      class="text-[11px] text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words"
                    >
                      {{
                        JSON.stringify(post.data.contact, null, 2)
                          .replace(/[\{\}"]/g, "")
                          .trim()
                      }}
                    </div>
                  </div>
                  <div
                    v-else
                    class="text-[11px] text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap break-words bg-white/60 dark:bg-gray-900/60 p-2.5 rounded-md border border-gray-100/50 dark:border-gray-700/50"
                  >
                    {{ post.data.contact }}
                  </div>
                </div>

                <!-- Media Embeds -->
                <div
                  v-if="post.data?.photos && post.data.photos.length > 0"
                  class="mb-3 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 cursor-zoom-in group"
                  @click="
                    openLightbox(
                      `https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`
                    )
                  "
                >
                  <img
                    :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`"
                    class="w-full h-auto max-h-[500px] object-contain transition-transform duration-700 group-hover:scale-105"
                    alt="Post photo"
                  />
                </div>

                <div
                  v-if="post.data?.videos && post.data.videos.length > 0"
                  class="mb-3 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-black"
                >
                  <video controls class="w-full h-auto max-h-[500px]">
                    <source :src="getVideoUrl(post)" type="video/mp4" />
                    Your browser does not support the video tag.
                  </video>
                </div>

                <!-- Link Preview -->
                <div
                  v-if="post.data?.linkPreview"
                  class="mb-3 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex flex-col sm:flex-row"
                >
                  <div
                    v-if="post.data.linkPreview.image"
                    class="sm:w-32 sm:h-32 flex-shrink-0 bg-gray-200 dark:bg-gray-700 cursor-zoom-in"
                    @click="
                      openLightbox(
                        `https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`
                      )
                    "
                  >
                    <img
                      :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`"
                      class="w-full h-full object-cover transition-transform duration-700 hover:scale-105"
                      alt="Link preview image"
                    />
                  </div>
                  <div
                    class="p-3 sm:p-4 flex flex-col justify-center flex-1 min-w-0"
                  >
                    <span
                      v-if="post.data.linkPreview.siteName"
                      class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1"
                      >{{ post.data.linkPreview.siteName }}</span
                    >

                    <a
                      v-if="post.data.linkPreview.href"
                      :href="post.data.linkPreview.href"
                      target="_blank"
                      class="text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline mb-1 line-clamp-2"
                    >
                      {{
                        post.data.linkPreview.title ||
                        post.data.linkPreview.href
                      }}
                    </a>
                    <h4
                      v-else-if="post.data.linkPreview.title"
                      class="text-sm font-bold text-gray-900 dark:text-white mb-1 line-clamp-2"
                    >
                      {{ post.data.linkPreview.title }}
                    </h4>

                    <p
                      v-if="post.data.linkPreview.description"
                      class="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mt-1"
                    >
                      {{ post.data.linkPreview.description }}
                    </p>
                  </div>
                </div>

                <div
                  class="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400"
                >
                  <div class="flex items-center space-x-4">
                    <span v-if="post.data?.views != null"
                      >{{ formatViews(post.data.views) }} views</span
                    >
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      class="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-[10px] text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      @click="
                        activeTab = 'explorer';
                        channelName = post.key.split('.')[0];
                        searchChannel();
                      "
                    >
                      {{ post.key.split('.')[0] }}
                    </button>
                    <span
                      v-if="post.key"
                      class="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-[10px] text-gray-400 dark:text-gray-500"
                      >ID: {{ post.key }}</span
                    >
                  </div>
                </div>

                <!-- Raw Post Debug -->
                <details class="mt-3 text-xs">
                  <summary
                    class="text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    Raw Data
                  </summary>
                  <pre
                    class="mt-2 p-2 bg-gray-50 dark:bg-gray-900 rounded overflow-x-auto text-gray-500 dark:text-gray-400"
                    >{{ JSON.stringify(post, null, 2) }}</pre
                  >
                </details>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else-if="hasSearched && !isSearching"
          class="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-[2.5rem] border border-gray-100 dark:border-gray-700 p-16 text-center shadow-lg"
        >
          <div
            class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-50 dark:bg-gray-900 border-8 border-white dark:border-gray-800 mb-6 shadow-inner ring-1 ring-gray-100 dark:ring-gray-700"
          >
            <Inbox class="h-8 w-8 text-gray-400" />
          </div>
          <h3
            class="text-2xl font-black tracking-tight text-gray-900 dark:text-white mb-3"
          >
            No results found
          </h3>
          <p
            class="text-gray-500 dark:text-gray-400 max-w-sm mx-auto font-medium"
          >
            We couldn't find any Telegram posts matching your search criteria.
            Try adjusting your keywords or filters.
          </p>
        </div>

        <div
          v-else-if="!isSearching && !searchError"
          class="text-center py-24 sm:py-32"
        >
          <div
            class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-50 dark:bg-blue-900/20 mb-6 shadow-inner ring-1 ring-blue-100 dark:ring-blue-800 border-8 border-white dark:border-gray-900"
          >
            <Globe class="h-8 w-8 text-blue-500 dark:text-blue-400" />
          </div>
          <h2
            class="text-2xl font-black tracking-tight text-gray-900 dark:text-white mb-3"
          >
            Global Content Search
          </h2>
          <p
            class="text-gray-500 dark:text-gray-400 max-w-sm mx-auto font-medium"
          >
            Search for keywords, users, or authors across all public Telegram
            data.
          </p>
        </div>
      </div>

      <!-- Photo Lightbox -->
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div class="contents">
          <!-- Post Modal -->
          <div
            v-if="isPostModalVisible"
            class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            @click="closePostModal"
          >
            <div
              class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-6 sm:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto relative"
              @click.stop
            >
              <button
                @click="closePostModal"
                class="absolute top-4 right-4 p-2 bg-gray-100 dark:bg-gray-700 rounded-full text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <X class="h-5 w-5" />
              </button>

              <div v-if="selectedPost" class="space-y-6">
                <div
                  class="rounded-2xl overflow-hidden shadow-inner border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-center"
                >
                  <img
                    v-if="
                      selectedPost.data?.photos &&
                      selectedPost.data.photos.length > 0
                    "
                    :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${selectedPost.key}_0`"
                    class="w-full h-auto max-h-[400px] object-contain"
                    referrerpolicy="no-referrer"
                  />
                  <video
                    v-else-if="
                      selectedPost.data?.videos &&
                      selectedPost.data.videos.length > 0
                    "
                    controls
                    class="w-full h-auto bg-black max-h-[400px]"
                  >
                    <source :src="getVideoUrl(selectedPost)" type="video/mp4" />
                  </video>
                  <img
                    v-else-if="
                      selectedPost.data?.linkPreview &&
                      selectedPost.data.linkPreview.image
                    "
                    :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${selectedPost.key}_l_0`"
                    class="w-full h-auto max-h-[400px] object-contain"
                    referrerpolicy="no-referrer"
                  />
                </div>

                <div class="space-y-4">
                  <h2 class="text-xl font-black text-gray-900 dark:text-white">
                    {{
                      selectedPost.data?.author ||
                      selectedPost.data?.user ||
                      metadata.title ||
                      "Post details"
                    }}
                  </h2>
                  <p
                    class="text-gray-600 dark:text-gray-400 text-sm leading-relaxed"
                  >
                    {{ selectedPost.data?.content }}
                  </p>
                  <div
                    class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400"
                  >
                    <span>{{ formatDate(selectedPost.data?.date) }}</span>
                    <span v-if="selectedPost.data?.views != null"
                      >{{ formatViews(selectedPost.data.views) }} views</span
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="lightboxPhoto"
            class="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm p-4 sm:p-8"
            @click="closeLightbox"
          >
            <button
              @click="closeLightbox"
              class="absolute top-6 right-6 p-3 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-all z-[110]"
              aria-label="Close lightbox"
            >
              <X class="h-6 w-6" />
            </button>
            <div
              class="relative w-full h-full flex items-center justify-center cursor-pointer overflow-hidden pb-4 pt-8 sm:py-2"
              @wheel.prevent="handleWheel"
            >
              <img
                :src="lightboxPhoto"
                :style="{
                  transform: `scale(${lightboxScale})`,
                  transition:
                    lightboxScale === 1 ? 'transform 0.3s ease' : 'none',
                }"
                class="max-w-full max-h-full object-contain shadow-2xl rounded-lg cursor-grab active:cursor-grabbing origin-center"
                referrerpolicy="no-referrer"
                alt="Enlarged view"
                @click.stop
              />
            </div>
          </div>
        </div>
      </Transition>
      <!-- Analysis Floating Widget -->
      <div
        v-if="isAnalysisModalVisible"
        :style="{
          position: 'fixed',
          left: widgetX + 'px',
          top: widgetY + 'px',
          zIndex: 200,
        }"
        class="w-96 max-w-[90vw] h-[60vh] bg-white/95 dark:bg-gray-800/95 backdrop-blur-xl rounded-3xl shadow-2xl flex flex-col border border-gray-200 dark:border-gray-700"
      >
        <div
          class="cursor-grab p-3 bg-blue-500/10 border-b border-blue-500/20 flex justify-between items-center"
          @mousedown.prevent="startDrag($event, 'analysis')"
        >
          <div class="flex items-center gap-2">
            <GripHorizontal class="h-4 w-4 text-blue-500" />
            <h2 class="text-sm font-black text-gray-900 dark:text-white">
              Analysis Result ({{ analyzedCount }})
            </h2>
          </div>
          <button
            @click="isAnalysisModalVisible = false"
            class="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
        <div
          class="flex-1 overflow-y-auto p-6 text-gray-700 dark:text-gray-300 prose dark:prose-invert prose-sm prose-p:leading-relaxed prose-headings:font-black prose-a:text-blue-500 prose-ul:my-2"
          v-html="renderedMarkdown"
        ></div>
      </div>

      <!-- Debug Panel -->
      <div
        v-if="showDebugPanel"
        class="fixed bottom-4 right-4 z-[300] p-6 bg-gray-900 text-white rounded-2xl shadow-2xl w-96 max-h-[80vh] overflow-y-auto border border-red-500"
      >
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-black text-red-500">Debug Api Error</h3>
          <button
            @click="showDebugPanel = false"
            class="text-white hover:text-gray-400"
          >
            Close
          </button>
        </div>
        <div class="text-xs space-y-2">
          <p><strong>Request:</strong> {{ debugInfo.request }}</p>
          <p><strong>Response:</strong> {{ debugInfo.response }}</p>
        </div>
      </div>

      <!-- Auto Finding Tab -->
      <div v-show="activeTab === 'auto-finding'" class="space-y-6">
        <div class="max-w-xl mx-auto mb-8 px-4 sm:px-0 space-y-4">
          <div
            class="flex items-center gap-4 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl"
          >
            <button
              @click="searchMode = 'channel'"
              :disabled="isAutoFinding"
              :class="[
                'flex-1 py-2 text-xs font-bold rounded-lg transition',
                isAutoFinding ? 'opacity-50 cursor-not-allowed' : '',
                searchMode === 'channel'
                  ? 'bg-white dark:bg-gray-700 shadow-sm'
                  : 'text-gray-500',
              ]"
            >
              Channel
            </button>
            <button
              @click="searchMode = 'user'"
              :disabled="isAutoFinding"
              :class="[
                'flex-1 py-2 text-xs font-bold rounded-lg transition',
                isAutoFinding ? 'opacity-50 cursor-not-allowed' : '',
                searchMode === 'user'
                  ? 'bg-white dark:bg-gray-700 shadow-sm'
                  : 'text-gray-500',
              ]"
            >
              User
            </button>
          </div>
          <div class="mb-4 px-1">
            <div class="flex justify-between items-center mb-1">
              <label
                class="block text-[10px] font-black text-gray-500 uppercase tracking-widest"
                >Iterations</label
              >
              <span
                class="text-[10px] font-bold text-blue-600 dark:text-blue-400"
                >{{ numIterations }}</span
              >
            </div>
            <input
              type="range"
              min="1"
              max="25"
              v-model="numIterations"
              class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-600"
            />
          </div>
          <form @submit.prevent="runAutoFinding" class="relative group">
            <input
              v-model="autoChannelName"
              type="text"
              class="block w-full pl-6 pr-[120px] py-3.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-medium shadow-sm transition-all duration-300"
              :placeholder="
                searchMode === 'channel'
                  ? 'Enter channel name...'
                  : 'Enter user name...'
              "
            />
            <button
              type="submit"
              :disabled="isAutoFinding || !autoChannelName.trim()"
              class="absolute right-2 top-2 bottom-2 px-5 bg-blue-600 text-white rounded-[0.65rem] text-xs font-bold tracking-wide hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/30 flex items-center"
            >
              <Loader2 v-if="isAutoFinding" class="h-4 w-4 animate-spin mr-2" />
              {{ isAutoFinding ? "Finding..." : "Start Finding" }}
            </button>
          </form>
        </div>

        <!-- Floating Post Tool Widget -->
        <div
          v-show="activeTab === 'auto-finding'"
          :style="{
            position: 'fixed',
            left: postWidgetX + 'px',
            top: postWidgetY + 'px',
            zIndex: 100,
          }"
          class="w-80 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col p-4 cursor-default"
        >
          <div
            class="cursor-grab p-2 mb-2 bg-purple-500/10 border-b border-purple-500/20 flex justify-between items-center rounded-lg"
            @mousedown.prevent="startDrag($event, 'post')"
          >
            <h2 class="text-xs font-black text-purple-700 dark:text-purple-300">
              Post Fetcher
            </h2>
            <GripHorizontal class="h-3 w-3 text-purple-400" />
          </div>

          <form @submit.prevent="fetchSinglePost" class="relative group">
            <input
              v-model="singlePostId"
              type="text"
              class="block w-full pl-3 pr-20 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
              placeholder="Post ID..."
            />
            <button
              type="submit"
              :disabled="isFetchingPost"
              class="absolute right-1 top-1 bottom-1 px-3 bg-purple-600 text-white rounded-md text-[10px] font-bold"
            >
              {{ isFetchingPost ? "..." : "Fetch" }}
            </button>
          </form>
          <div
            v-if="singlePost"
            class="mt-3 flex-1 overflow-y-auto max-h-[300px] border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-xl"
          >
            <div class="p-3">
              <!-- Header -->
              <div class="flex justify-between items-start mb-2.5">
                <div class="flex items-center space-x-2 min-w-0 pr-2">
                  <div
                    class="h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex-shrink-0 flex items-center justify-center text-blue-600 dark:text-blue-400"
                  >
                    <User class="h-3.5 w-3.5" />
                  </div>
                  <div class="min-w-0">
                    <h4
                      class="text-xs font-bold text-gray-900 dark:text-gray-100 truncate"
                    >
                      {{
                        singlePost.data?.author ||
                        singlePost.data?.user ||
                        "Anonymous"
                      }}
                    </h4>
                    <p
                      class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5"
                    >
                      {{ formatDate(singlePost.data?.date) }}
                    </p>
                  </div>
                </div>
                <span
                  v-if="singlePost.key"
                  class="font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-1.5 py-0.5 rounded shadow-sm text-[9px] text-gray-500 flex-shrink-0"
                >
                  #{{ singlePost.key }}
                </span>
              </div>

              <!-- Quoted Reply -->
              <div
                v-if="
                  singlePost.data?.reply && singlePost.data.reply.length >= 2
                "
                class="mb-3 border-l-4 border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 p-3 rounded-r-xl"
              >
                <div
                  class="flex items-center justify-between text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1"
                >
                  <div class="flex items-center">
                    <Reply class="h-3 w-3 mr-1" />
                    Reply to
                  </div>
                  <span
                    v-if="
                      Array.isArray(singlePost.data?.reply) &&
                      singlePost.data.reply[0] != null
                    "
                    class="font-mono bg-blue-100/50 dark:bg-blue-800/30 px-2 py-0.5 rounded border border-blue-200/50 dark:border-blue-700/50 text-[10px]"
                    >ID:
                    {{
                      singlePost.data._tool
                        ? singlePost.data.reply[0]
                        : String(singlePost.data.reply[0]).split("/").pop()
                    }}</span
                  >
                </div>
                <div
                  class="text-gray-700 dark:text-gray-300 text-xs leading-relaxed whitespace-pre-wrap break-words"
                  v-html="highlightText(singlePost.data.reply[1])"
                ></div>
              </div>

              <!-- Media Embedding (Photos, Videos, Links) -->
              <div
                v-if="
                  singlePost.data?.photos && singlePost.data.photos.length > 0
                "
                class="mb-2.5 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-black cursor-zoom-in group"
                @click="
                  openLightbox(
                    `https://i.gogingko.net/api/v1/v/telegram-photo/${singlePost.key}_0`
                  )
                "
              >
                <img
                  :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${singlePost.key}_0`"
                  class="w-full h-32 object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                />
              </div>
              <div
                v-else-if="
                  singlePost.data?.videos && singlePost.data.videos.length > 0
                "
                class="mb-2.5 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-black"
              >
                <video controls class="w-full h-32 object-cover">
                  <source :src="getVideoUrl(singlePost)" type="video/mp4" />
                </video>
              </div>

              <!-- Content Body -->
              <div
                class="text-xs leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words"
                v-html="highlightText(singlePost.data?.content || '')"
              ></div>

              <!-- Contact & Extras if needed -->
              <div
                v-if="singlePost.data?.contact"
                class="mt-2 text-[10px] p-2 bg-white dark:bg-gray-800 border border-blue-100 dark:border-blue-900 rounded flex items-center text-blue-600 dark:text-blue-400"
              >
                <Phone class="h-3 w-3 mr-1.5" /> Contact Card Attached
              </div>

              <!-- Footer Stats / Links -->
              <div
                class="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400 flex items-center justify-between"
              >
                <span>{{
                  singlePost.data?.views != null
                    ? formatViews(singlePost.data.views) + " views"
                    : ""
                }}</span>
                <a
                  v-if="singlePost.url || singlePost.link"
                  :href="singlePost.url || singlePost.link"
                  target="_blank"
                  class="text-blue-500 dark:text-blue-400 hover:underline flex items-center"
                >
                  View original <ExternalLink class="h-2.5 w-2.5 ml-1" />
                </a>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="autoCells.length === 0 && !isAutoFinding"
          class="text-center py-24 sm:py-32"
        >
          <div
            class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-purple-50 dark:bg-purple-900/20 mb-6 shadow-inner ring-1 ring-purple-100 dark:ring-purple-800 border-8 border-white dark:border-gray-900"
          >
            <BotMessageSquare
              class="h-8 w-8 text-purple-500 dark:text-purple-400"
            />
          </div>
          <h2
            class="text-2xl font-black tracking-tight text-gray-900 dark:text-white mb-3"
          >
            Auto Sequence Finding
          </h2>
          <p
            class="text-gray-500 dark:text-gray-400 max-w-sm mx-auto font-medium"
          >
            Enter a channel name to automatically fetch, analyze, and verify
            consecutive posts for evidence.
          </p>
        </div>

        <div
          v-else
          class="w-full max-w-full lg:max-w-7xl xl:max-w-[90rem] mx-auto space-y-4"
        >
          <!-- Final Result Area -->
          <div
            v-if="autoCells.length > 0"
            class="w-full max-w-full lg:max-w-7xl xl:max-w-[90rem] mx-auto bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 mb-8"
          >
            <h3
              class="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center"
            >
              <CheckCircle2 class="h-5 w-5 mr-2 text-green-500" />
              Final Analysis Summary
            </h3>
            <div class="text-sm text-gray-600 dark:text-gray-300">
              <p>
                {{ autoCells.filter((c) => c.status === "completed").length }}
                / {{ autoCells.length }} iterations completed.
              </p>

              <div
                v-if="isGeneratingFinalTable"
                class="mt-4 flex items-center text-blue-500"
              >
                <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                Generating table...
              </div>

              <div
                v-if="finalTableHtml"
                class="mt-8 bg-gradient-to-br from-white to-blue-50/50 dark:bg-gray-900 p-6 rounded-3xl border border-blue-100 dark:border-gray-700 shadow-xl shadow-blue-500/5 prose dark:prose-invert max-w-none text-sm"
              >
                <div class="flex items-center gap-2 mb-4">
                  <div
                    class="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center"
                  >
                    <Sparkles class="w-4 h-4 text-white" />
                  </div>
                  <h5
                    class="text-sm font-black text-blue-900 dark:text-blue-100 uppercase tracking-wider"
                  >
                    Final Analysis Insights
                  </h5>
                </div>
                <div v-html="finalTableHtml" class="prose-sm"></div>
              </div>
            </div>
          </div>

          <h3 class="text-sm font-bold text-gray-900 dark:text-white mb-4">
            Finding Logs & Results
          </h3>
          <div
            v-for="cell in autoCells"
            :key="cell.id"
            class="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-900"
          >
            <h4 class="font-bold text-xs text-gray-500 mb-2 flex items-center">
              Cell {{ cell.id }}
              <Loader2
                v-if="cell.status === 'running'"
                class="h-3 w-3 ml-2 animate-spin text-blue-500"
              />
              <span
                v-if="cell.status === 'error'"
                class="ml-2 text-red-500 text-[10px]"
                >Error</span
              >
            </h4>
            <div class="space-y-2">
              <div
                class="bg-gray-100 dark:bg-gray-950 p-3 rounded font-mono text-xs text-gray-600 dark:text-gray-400"
              >
                <div v-for="(log, i) in cell.logs" :key="i">{{ log }}</div>
              </div>
              <div
                v-if="cell.analysisResult"
                class="bg-blue-50 dark:bg-blue-900/10 p-3 rounded border border-blue-100 dark:border-blue-900"
              >
                <h5
                  class="text-[10px] font-black text-blue-800 dark:text-blue-400 uppercase mb-1"
                >
                  Analysis
                </h5>
                <div
                  class="prose dark:prose-invert prose-xs"
                  v-html="md.render(cell.analysisResult)"
                ></div>
              </div>
              <div
                v-if="cell.verificationResult"
                class="bg-green-50 dark:bg-green-900/10 p-3 rounded border border-green-100 dark:border-green-900"
              >
                <h5
                  class="text-[10px] font-black text-green-800 dark:text-green-400 uppercase mb-1"
                >
                  Verification
                </h5>
                <div
                  class="prose dark:prose-invert prose-xs"
                  v-html="md.render(cell.verificationResult)"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
