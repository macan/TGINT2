<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from "vue";
import cytoscape from "cytoscape";
import pako from "pako";
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
  GripVertical,
  Sparkles,
  Pin,
  Bot,
  LoaderCircle,
  Forward,
  Share2,
  Languages,
  PanelRightOpen,
  PanelRightClose,
  Copy,
  Library,
  Hash,
  Activity,
  RefreshCw,
  Radio,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  Trash2,
  Database,
  Edit,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
} from "lucide-vue-next";

import MarkdownIt from "markdown-it";
import markdownItMark from "markdown-it-mark";
// @ts-ignore
import clm from "country-locale-map";
const md = new MarkdownIt({ html: true }).use(markdownItMark);

// Login State Logic
const showLoginModal = ref(false);
const loginName = ref("");
const loginToken = ref("");
const isLoginTokenValid = ref(false);

const saveLogin = () => {
  localStorage.setItem("user-login-name", loginName.value);
  localStorage.setItem("user-login-token", loginToken.value);
  showLoginModal.value = false;
  toastMessage.value = "Access Token info saved!";
  toastType.value = "success";
  setTimeout(() => { toastMessage.value = ""; }, 3000);
};

const loadLogin = () => {
  loginName.value = localStorage.getItem("user-login-name") || "";
  loginToken.value = localStorage.getItem("user-login-token") || "";
  if (loginToken.value) {
    toastMessage.value = "Access Token info retrieved ok!";
    toastType.value = "success";
    setTimeout(() => { toastMessage.value = ""; }, 3000);
  }
}

const isAddingAll = ref(false);
const addAllToWorkspace = async () => {
    if (isAddingAll.value || filteredSearchResults.value.length === 0) return;
    
    isAddingAll.value = true;
    for (const post of filteredSearchResults.value) {
        await addToWorkspaceFromPost(post);
        // Small delay to allow graph updates and prevent UI locking if necessary
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    isAddingAll.value = false;
    toastMessage.value = `Added ${filteredSearchResults.value.length} posts to workspace!`;
    toastType.value = 'success';
    setTimeout(() => { toastMessage.value = ""; }, 5000);
};

const analysisResult = ref("");
const analysisResultOfGraph = ref("");
const isAnalyzing = ref(false);
const isSummarizing = ref(false);
const isPostFetcherVisible = ref(false);
const copyUsernamesToClipboard = (allNames) => {
    const text = allNames.join(',');
    navigator.clipboard.writeText(text);
    toastMessage.value = "Usernames copied to clipboard!";
    toastType.value = "success";
    setTimeout(() => { toastMessage.value = ""; }, 3000);
};
const longPressTimerInSummarize = ref<number | null>(null);
const isLongPressInSummarize = ref(false);
const telegramUsername = ref("");
const telegramUser = ref<any>(null);
const loadingTelegramUser = ref(false);
const telegramError = ref("");
const isHistoryVisible = ref(false);
const isAnalyzingGraph = ref(false);
const isAnalysisModalVisible = ref(false);
const analyzedCount = ref(0);
const lookupUserHistory = ref<string[]>(JSON.parse(localStorage.getItem('telegramUserLookupHistory') || '[]'));
const dropdownContainer = ref<HTMLElement | null>(null);

const handleClickOutside = (event: MouseEvent) => {
    if (dropdownContainer.value && !dropdownContainer.value.contains(event.target as Node)) {
        isHistoryVisible.value = false;
    }
};

const startChatDrag = (e: MouseEvent) => {
    isChatDragging.value = true;
    chatDragOffset.value = { x: e.clientX - widgetPosition.value.left, y: e.clientY - widgetPosition.value.top };
};

const startChatResize = (e: MouseEvent) => {
    isChatResizing.value = true;
    e.stopPropagation();
    e.preventDefault();
};

const onMouseMove = (e: MouseEvent) => {
    if (isChatDragging.value) {
        widgetPosition.value = { top: e.clientY - chatDragOffset.value.y, left: e.clientX - chatDragOffset.value.x };
    } else if (isChatResizing.value) {
        widgetSize.value = { width: Math.max(200, e.clientX - widgetPosition.value.left), height: Math.max(150, e.clientY - widgetPosition.value.top) };
    }
};

const onMouseUp = () => {
    isChatDragging.value = false;
    isChatResizing.value = false;
};

onMounted(() => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
});

onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
});

const renderedMarkdown = computed(() => md.render(analysisResult.value));
const renderedMarkdownOfGraph = computed(() => md.render(analysisResultOfGraph.value));

const deleteHistory = (username: string) => {
    lookupUserHistory.value = lookupUserHistory.value.filter(u => u !== username);
    localStorage.setItem('telegramUserLookupHistory', JSON.stringify(lookupUserHistory.value));
};
const selectHistory = (user: string) => {
    telegramUsername.value = user;
    isHistoryVisible.value = false;
    fetchTelegramUser();
};

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

const fetchChannelNamesByLang = async (langCode: string) => {
  try {
    const response = await fetch(`https://i.gogingko.net/api/v1/lang/${langCode}`, {
      method: "GET",
    });
    if (!response.ok) throw new Error("Failed to fetch channel names: " + response.status);
    const text = await response.text();
    return text.split(',').map(name => name.trim()).filter(name => name.length > 0);
  } catch (err) {
    console.error("Failed to fetch channel names:", err);
    return [];
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
  
  // filter the selected Usernames
  if (selectedUsernamesExplorer.value.length > 0) {
    result = result.filter((p) => {
      const rawUser = p.data?.user;
      if (!rawUser) {
        if (p.data?.uid !== undefined) {
          return selectedUsernamesExplorer.value.includes(p.data?.uid);
        }
        return false;
      }
      const parts = rawUser.split("/");
      const username = parts[parts.length - 1];
      return selectedUsernamesExplorer.value.includes(username);
    });
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

const generalAsk = async (userInputText) => {
  try {
    const targetPosts =
      activeTab.value === "search" ? searchResults.value : posts.value;
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
          outlinks: data?.outlinks,
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
          userInputText.replace('$POSTS$', JSON.stringify(strippedPosts)),
      }),
    });
    if (!response.ok) throw new Error("Ask request failed: " + response.status);
    const data = await response.json();
    return data.reply || "No ask data received."
  } catch (err) {
    console.error(err);
  } finally {
  }
}

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
          "Please analyze the following posts from a telegram group. You should consider grouping by the sent user or account. Note that some post might be a submission from other users which can be identified by the content signatures, some post might contain non empty reply field which means the content is a reply to that post. For each grouped account, try hard to find anything that represented the personality of the account in social life, for example living city or country, post date that reflect the active hours(reference to China), job postion, career, gender, age, location, tour, language, education, interests, hobby, favorite things, politic opinions, special opinions, technology skills, troubles, cognitive state. Output the findings in Chinese, , for any confirmed evidence please attach with the post id.\n\n" +
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

const summarizePosts = async () => {
    const targetPosts = activeTab.value === "search" ? searchResults.value : posts.value;
    if (!targetPosts || targetPosts.length === 0) return;

    isSummarizing.value = true;
    try {
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
                text: "Please summarize the following posts, make sure to group them into different topics, for each group, generate briefing title and summarized content, return in Chinese with channel name and post id range:\n\n" + JSON.stringify(strippedPosts),
            }),
        });

        if (!response.ok) throw new Error("Summarization failed");
        const data = await response.json();
        analysisResult.value = data.reply || "No summary data received.";
        isAnalysisModalVisible.value = true;
    } catch (err) {
        console.error(err);
        alert("Failed to summarize posts.");
    } finally {
        isSummarizing.value = false;
    }
};

const startLongPressInSummarize = () => {
    isLongPressInSummarize.value = false;
    longPressTimerInSummarize.value = window.setTimeout(() => {
        isLongPressInSummarize.value = true;
        isSummarizeMenuVisible.value = true;
    }, 800);
};

const summarizeAndClose = () => {
    isSummarizeMenuVisible.value = false;
    summarizePosts();
};

const openFreeAskAndClose = () => {
    isSummarizeMenuVisible.value = false;
    isChatWidgetVisible.value = true;
};

const endLongPressInSummarize = () => {
    if (longPressTimerInSummarize.value) {
        clearTimeout(longPressTimerInSummarize.value);
        longPressTimerInSummarize.value = null;
    }
    if (!isLongPressInSummarize.value) {
        analyzePosts();
    }
    isLongPressInSummarize.value = false;
};

const cancelLongPressInSummarize = () => {
    if (longPressTimerInSummarize.value) {
        clearTimeout(longPressTimerInSummarize.value);
        longPressTimerInSummarize.value = null;
    }
    isLongPressInSummarize.value = false;
};

const TelegramCDNRegions = {
  1: ['Miami, FL, USA', 'North and South America'],
  2: ['Amsterdam, NL', 'Europe, Africa, parts of Middle East'],
  3: ['Miami, FL, USA', 'Secondary for Americas (often used for storage)'],
  4: ['Amsterdam, NL', 'Secondary for Europe/Africa'],
  5: ['Singapore, SG', 'Asia, Australia, and Oceania'],
}

const fetchTelegramUser = async () => {
    isHistoryVisible.value = false;
    if (!telegramUsername.value.trim()) return;
    loadingTelegramUser.value = true;
    telegramError.value = "";
    telegramUser.value = null;
    try {
        const response = await fetch(`https://i.gogingko.net/api/v1/v/telegram-user/${telegramUsername.value}`);
        if (!response.ok) throw new Error("User not found");
        telegramUser.value = await response.json();
        const username = telegramUsername.value.trim();
        if (!lookupUserHistory.value.includes(username)) {
            lookupUserHistory.value.unshift(username);
            if (lookupUserHistory.value.length > 10) lookupUserHistory.value.pop();
            localStorage.setItem('telegramUserLookupHistory', JSON.stringify(lookupUserHistory.value));
        }
        // there are two differnt user results, we should regular it
        if ('about' in telegramUser.value) {
          telegramUser.value.description = telegramUser.value.about
          telegramUser.value.title = `${telegramUser.value.first_name || ''} ${telegramUser.value.last_name || ''}`
          telegramUser.value.status = telegramUser.value.status?.status
        }
        // set DC Flag
        if (telegramUser.value.photo) {
          const match = String(telegramUser.value.photo).match(/cdn(\d+)/);
          if (match) {
            telegramUser.value.cdnNumber = match[1];
            telegramUser.value.cdnRegion = TelegramCDNRegions[telegramUser.value.cdnNumber as keyof typeof TelegramCDNRegions];
          }
        }
    } catch(err) {
        telegramError.value = err.message;
    } finally {
        loadingTelegramUser.value = false;
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
            forward_from: p.data?.forward_from,
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
                "Please analyze the following posts from a telegram group. You should consider grouping by the sent user or account. Note that some posts might be submissions from other users which can be identified by the content signatures and some posts might contain non empty reply field or quoted content which means the content is a reply to that (you shoud distinguish which dialog is truely the target expressed). For each grouped account, keep record their username (extract from 'user' field if non empty) and try hard to find anything that represented the personality of the account in life, for example living city or country, post date that reflect the active hours(reference to China), job postion, career, gender, age, location, tour, language, education, interests, hobby, favorite things, politic opinions, special opinions, technology skills, troubles, cognitive state, social relations, or any pattern or regularity you found. Output the findings in Chinese with post id range hint in proper place.\n " +
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

const isDark = ref(localStorage.theme === 'dark');
const isSummarizeMenuVisible = ref(false);
const isChatWidgetVisible = ref(false);
const chatMessages = ref<{role: 'user' | 'bot', content: string}[]>([]);
const chatInput = ref('');
const isChatLoading = ref(false);
const widgetPosition = ref({ top: 100, left: 100 });
const widgetSize = ref({ width: 320, height: 384 });
const isChatDragging = ref(false);
const chatDragOffset = ref({ x: 0, y: 0 });
const isChatResizing = ref(false);

const handleChatSubmit = async () => {
    if (!chatInput.value.trim()) return;
    const userMessage = chatInput.value;
    chatMessages.value.push({ role: 'user', content: userMessage });
    chatInput.value = '';
    isChatLoading.value = true;
    
    // Construct the prompt with instructions
    const precheck = `Is user's ask intent related with the posts of channel/group or search context? Please only answer 'yes' or 'no'. The user's input is: ${userMessage}`;
    const precheckResult = await generalAsk(precheck);
    
    let prompt = null;

    if (precheckResult.includes('yes')) {
      prompt = `Based on the provided posts below, answer the following question: ${userMessage}\n\nPosts: $POSTS$`;
    } else {
      prompt = `${userMessage}`;
    }
    
    const reply = await generalAsk(prompt);
    
    chatMessages.value.push({ role: 'bot', content: reply || "No response." });
    isChatLoading.value = false;
};
const explorerTab = ref<HTMLElement | null>(null);
const explorerMinHeight = ref("0px");
const suggestedChannels = ref<string[]>([]);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

const showBackToTop = ref(false);
const activeTab = ref<"explorer" | "search" | "listen" | "monitor" | "auto-finding" | "workspace" | "profile" | "channel">("explorer");
const channels = ref<any[]>([]);
const activeChannelOrUser = ref<"channel" | "user">("channel");
const isLoadingChannels = ref(false);
const langCode = ref("");

const toggleChannelOrUser = () => {
    activeChannelOrUser.value = activeChannelOrUser.value === 'channel' ? 'user' : 'channel';
    fetchChannels(false);
};

// --- Listen Tab Setup ---
export interface ListenItem {
  id: string;
  name: string;
  isFolder: boolean;
  create_time: string;
  type?: "channel" | "keyword";
  argument?: string;
  description?: string;
  children?: ListenItem[];
}

const listenDirectory = ref<ListenItem[]>([
  {
    id: "folder-1",
    name: "Tech Streams",
    isFolder: true,
    create_time: new Date().toISOString(),
    children: [
      {
        id: "item-durov",
        name: "Pavel Durov",
        isFolder: false,
        create_time: new Date().toISOString(),
        type: "channel",
        argument: "durov",
        description: "Official channel of Telegram founder Pavel Durov"
      },
      {
        id: "item-ai-keywords",
        name: "AI & Neural Networks",
        isFolder: false,
        create_time: new Date().toISOString(),
        type: "keyword",
        argument: "artificial intelligence, deepmind, gemini",
        description: "Post stream containing key AI phrases"
      }
    ]
  },
  {
    id: "item-ton",
    name: "TON Blockchain",
    isFolder: false,
    create_time: new Date().toISOString(),
    type: "channel",
    argument: "toncoin",
    description: "Updates about TON network"
  }
]);

const selectedListenNode = ref<ListenItem | null>(null);
const expandedFolders = ref<Record<string, boolean>>({
  "folder-1": true
});

const listenPosts = ref<any[]>([]);
const selectedChannelMetadata = ref<any | null>(null);
const isFetchingChannelMetadata = ref(false);
const newlyFetchedListenKeys = ref<Set<string>>(new Set());
const isFetchingListenPosts = ref(false);
const listenAutoRefreshActive = ref(false);
let listenRefreshInterval: any = null;

const isListenModalOpen = ref(false);
const isEditingListenItem = ref(false);
const listenItemForm = ref({
  id: "",
  name: "",
  isFolder: false,
  type: "channel" as "channel" | "keyword",
  argument: "",
  description: "",
  parentId: ""
});

const toggleFolderExpanded = (id: string) => {
  expandedFolders.value[id] = !expandedFolders.value[id];
};

const findNodeAndPerform = (
  nodes: ListenItem[],
  id: string,
  action: (nodes: ListenItem[], index: number) => void
): boolean => {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) {
      action(nodes, i);
      return true;
    }
    if (nodes[i].isFolder && nodes[i].children) {
      const found = findNodeAndPerform(nodes[i].children!, id, action);
      if (found) return true;
    }
  }
  return false;
};

const addChildToFolder = (nodes: ListenItem[], folderId: string, child: ListenItem): boolean => {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === folderId) {
      if (!nodes[i].children) {
        nodes[i].children = [];
      }
      nodes[i].children!.push(child);
      return true;
    }
    if (nodes[i].isFolder && nodes[i].children) {
      const added = addChildToFolder(nodes[i].children!, folderId, child);
      if (added) return true;
    }
  }
  return false;
};

const loadListenDirectory = () => {
  const cached = localStorage.getItem("listen_directory_tree");
  if (cached) {
    try {
      listenDirectory.value = JSON.parse(cached);
    } catch (e) {
      console.error("Failed to load listen_directory_tree", e);
    }
  }
};

const saveListenDirectory = () => {
  localStorage.setItem("listen_directory_tree", JSON.stringify(listenDirectory.value));
};

const openAddModal = (parentId: string = "", isFolder: boolean = false) => {
  isEditingListenItem.value = false;
  listenItemForm.value = {
    id: "",
    name: "",
    isFolder,
    type: "channel",
    argument: "",
    description: "",
    parentId
  };
  isListenModalOpen.value = true;
};

const openEditModal = (item: ListenItem) => {
  isEditingListenItem.value = true;
  listenItemForm.value = {
    id: item.id,
    name: item.name,
    isFolder: item.isFolder,
    type: item.type || "channel",
    argument: item.argument || "",
    description: item.description || "",
    parentId: ""
  };
  isListenModalOpen.value = true;
};

const saveListenItemForm = () => {
  if (!listenItemForm.value.name.trim()) return;

  if (isEditingListenItem.value) {
    findNodeAndPerform(listenDirectory.value, listenItemForm.value.id, (nodes, idx) => {
      const original = nodes[idx];
      nodes[idx] = {
        ...original,
        name: listenItemForm.value.name,
        type: listenItemForm.value.type,
        argument: listenItemForm.value.argument,
        description: listenItemForm.value.description
      };
      if (selectedListenNode.value && selectedListenNode.value.id === original.id) {
        selectedListenNode.value = nodes[idx];
        fetchListenPosts(nodes[idx]);
      }
    });
  } else {
    const newItem: ListenItem = {
      id: "node-" + Math.random().toString(36).substr(2, 9),
      name: listenItemForm.value.name,
      isFolder: listenItemForm.value.isFolder,
      create_time: new Date().toISOString(),
      type: listenItemForm.value.isFolder ? undefined : listenItemForm.value.type,
      argument: listenItemForm.value.isFolder ? undefined : listenItemForm.value.argument,
      description: listenItemForm.value.description,
      children: listenItemForm.value.isFolder ? [] : undefined
    };

    if (listenItemForm.value.parentId) {
      addChildToFolder(listenDirectory.value, listenItemForm.value.parentId, newItem);
      expandedFolders.value[listenItemForm.value.parentId] = true;
    } else {
      listenDirectory.value.push(newItem);
    }
  }

  saveListenDirectory();
  isListenModalOpen.value = false;
};

const isDeleteConfirmOpen = ref(false);
const itemToDeleteId = ref("");
const itemToDeleteName = ref("");

const deleteListenItem = (id: string, name: string = "") => {
  itemToDeleteId.value = id;
  itemToDeleteName.value = name;
  isDeleteConfirmOpen.value = true;
};

const confirmDeleteListenItem = () => {
  if (itemToDeleteId.value) {
    const id = itemToDeleteId.value;
    findNodeAndPerform(listenDirectory.value, id, (nodes, idx) => {
      nodes.splice(idx, 1);
    });
    if (selectedListenNode.value && selectedListenNode.value.id === id) {
      selectedListenNode.value = null;
      listenPosts.value = [];
    }
    saveListenDirectory();
  }
  isDeleteConfirmOpen.value = false;
  itemToDeleteId.value = "";
  itemToDeleteName.value = "";
};

const getVisibleNodes = (nodes: ListenItem[], depth = 0, parentId: string | null = null): any[] => {
  const list: any[] = [];
  for (const node of nodes) {
    const hasChildren = !!(node.isFolder && node.children && node.children.length > 0);
    const isExpanded = !!expandedFolders.value[node.id];
    
    list.push({
      item: node,
      depth,
      parentId,
      hasChildren,
      isExpanded
    });
    
    if (node.isFolder && isExpanded && node.children) {
      list.push(...getVisibleNodes(node.children, depth + 1, node.id));
    }
  }
  return list;
};

const visibleDirectoryNodes = computed(() => {
  return getVisibleNodes(listenDirectory.value);
});

// Drag and drop states for Listen Directory items
const draggedNode = ref<any | null>(null);
const dragOverNode = ref<any | null>(null);
const dragOverPosition = ref<"before" | "after" | "inside" | null>(null);

const isDescendant = (parent: ListenItem, childId: string): boolean => {
  if (!parent.isFolder || !parent.children) return false;
  for (const child of parent.children) {
    if (child.id === childId) return true;
    if (isDescendant(child, childId)) return true;
  }
  return false;
};

const onDragStart = (event: DragEvent, node: any) => {
  draggedNode.value = node;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.item.id);
  }
};

const onDragOver = (event: DragEvent, node: any) => {
  event.preventDefault();
  if (!draggedNode.value || draggedNode.value.item.id === node.item.id) {
    dragOverNode.value = null;
    dragOverPosition.value = null;
    return;
  }

  if (isDescendant(draggedNode.value.item, node.item.id)) {
    dragOverNode.value = null;
    dragOverPosition.value = null;
    return;
  }

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const relativeY = event.clientY - rect.top;
  const height = rect.height;

  if (node.item.isFolder) {
    if (relativeY < height * 0.25) {
      dragOverPosition.value = "before";
    } else if (relativeY > height * 0.75) {
      dragOverPosition.value = "after";
    } else {
      dragOverPosition.value = "inside";
    }
  } else {
    if (relativeY < height * 0.5) {
      dragOverPosition.value = "before";
    } else {
      dragOverPosition.value = "after";
    }
  }

  dragOverNode.value = node;
};

const onDragEnd = () => {
  draggedNode.value = null;
  dragOverNode.value = null;
  dragOverPosition.value = null;
};

const onDrop = (event: DragEvent, targetNode: any) => {
  event.preventDefault();
  if (!draggedNode.value) return;

  const draggedId = draggedNode.value.item.id;
  const targetId = targetNode.item.id;

  if (draggedId === targetId) {
    onDragEnd();
    return;
  }

  if (isDescendant(draggedNode.value.item, targetId)) {
    onDragEnd();
    return;
  }

  let itemToMove: ListenItem | null = null;
  findNodeAndPerform(listenDirectory.value, draggedId, (nodes, idx) => {
    itemToMove = nodes.splice(idx, 1)[0];
  });

  if (!itemToMove) {
    onDragEnd();
    return;
  }

  const pos = dragOverPosition.value;
  if (pos === "inside") {
    findNodeAndPerform(listenDirectory.value, targetId, (nodes, idx) => {
      const folder = nodes[idx];
      if (folder.isFolder) {
        if (!folder.children) {
          folder.children = [];
        }
        folder.children.push(itemToMove!);
        expandedFolders.value[folder.id] = true;
      }
    });
  } else {
    findNodeAndPerform(listenDirectory.value, targetId, (nodes, idx) => {
      if (pos === "before") {
        nodes.splice(idx, 0, itemToMove!);
      } else {
        nodes.splice(idx + 1, 0, itemToMove!);
      }
    });
  }

  saveListenDirectory();
  onDragEnd();
};

const selectListenItem = (item: ListenItem) => {
  if (item.isFolder) {
    toggleFolderExpanded(item.id);
  } else {
    newlyFetchedListenKeys.value.clear();
    selectedListenNode.value = item;
    fetchListenPosts(item);
  }
};

function formatDateForSearch(date) {
    const pad = (num) => String(num).padStart(2, '0');

    // Extract local date and time components
    const YYYY = date.getFullYear();
    const MM = pad(date.getMonth() + 1); // Months are 0-indexed
    const DD = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());

    // Calculate timezone offset in +/-HHmm format
    const offsetMinutes = date.getTimezoneOffset();
    const sign = offsetMinutes <= 0 ? '+' : '-';
    const absOffset = Math.abs(offsetMinutes);
    const offsetHours = pad(Math.floor(absOffset / 60));
    const offsetMins = pad(absOffset % 60);
    const tz = `${sign}${offsetHours}${offsetMins}`;

    return `${YYYY}-${MM}-${DD}T${hh}:${mm}:${ss}${tz}`;
}

const fetchListenPosts = async (node: ListenItem) => {
  if (!node || node.isFolder) return;
  if (!selectedListenNode.value || selectedListenNode.value.id !== node.id) return;
  
  // 1. Immediately load cached posts from localStorage for instant display
  const cachedStorageKey = `listen_cached_posts_${node.id}`;
  let cached: any[] = [];
  try {
    const cachedRaw = localStorage.getItem(cachedStorageKey);
    if (cachedRaw) {
      cached = JSON.parse(cachedRaw);
    }
  } catch (err) {
    console.error("Failed to parse cached listen posts:", err);
  }

  // Bind cached items directly
  if (!selectedListenNode.value || selectedListenNode.value.id !== node.id) return;
  listenPosts.value = cached;
  isFetchingListenPosts.value = true;
  
  try {
    let fetchedPosts: any[] = [];

    if (node.type === "channel") {
      const username = node.argument?.trim();
      if (!username) {
        if (selectedListenNode.value?.id === node.id) {
          isFetchingListenPosts.value = false;
        }
        return;
      }
      const response = await fetch(`https://i.gogingko.net/api/v1/last/${username}?n=50`);
      if (!selectedListenNode.value || selectedListenNode.value.id !== node.id) return;
      if (response.ok) {
        const data = await response.json();
        if (!selectedListenNode.value || selectedListenNode.value.id !== node.id) return;
        fetchedPosts = Array.isArray(data) ? data : (data.data || data.posts || data.items || []);
      }
    } else if (node.type === "keyword") {
      const keywords = node.argument?.trim().split(',');
      if (!keywords) {
        if (selectedListenNode.value?.id === node.id) {
          isFetchingListenPosts.value = false;
        }
        return;
      }
      const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const end = new Date();

      const fieldQueries = keywords.map(keyword => `content:"${keyword}"`);
      const dateRange = `date:[to_date("${formatDateForSearch(start)}", "%Y-%m-%dT%H:%M:%S%z") TO to_date("${formatDateForSearch(end)}", "%Y-%m-%dT%H:%M:%S%z")]`;
      const finalQuery = `(${fieldQueries.join(" OR ")}) AND ${dateRange}`;

      const response = await fetch("https://i.gogingko.net/api/v1/ft/telegram", {
        method: "GET",
        headers: {
          "x-gos-ft-query": encodeURIComponent(finalQuery),
          "x-gos-ft-sort": "date-",
          "x-gos-ft-topk": "50",
        }
      });
      if (!selectedListenNode.value || selectedListenNode.value.id !== node.id) return;
      if (response.ok) {
        const data = await response.json();
        if (!selectedListenNode.value || selectedListenNode.value.id !== node.id) return;
        const keys = data.keys || [];

        if (keys.length > 0) {
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
          if (!selectedListenNode.value || selectedListenNode.value.id !== node.id) return;

          if (mgetResponse.ok) {
            const postsData = await mgetResponse.json();
            if (!selectedListenNode.value || selectedListenNode.value.id !== node.id) return;
            fetchedPosts = Array.isArray(postsData) ? postsData : postsData.data || [];
          }
        }
      }
    }

    if (!selectedListenNode.value || selectedListenNode.value.id !== node.id) return;

    const getPostId = (post: any): string => {
      return post.key || post.id || (post.data && post.data.id) || '';
    };

    const getPostTimestamp = (dateVal: any) => {
      if (!dateVal) return 0;
      if (typeof dateVal === "number" && dateVal < 10000000000)
        return dateVal * 1000;
      const parsed = new Date(dateVal).getTime();
      return isNaN(parsed) ? 0 : parsed;
    };

    if (fetchedPosts.length > 0) {
      const cachedKeys = new Set(cached.map(p => getPostId(p)).filter(Boolean));
      const hasPreviousCache = cached.length > 0;

      // Merge cached and fetched, letting fetched entries overwrite cached ones for fresh metadata
      const mergedMap = new Map<string, any>();
      for (const p of cached) {
        const id = getPostId(p);
        if (id) mergedMap.set(id, p);
      }
      for (const p of fetchedPosts) {
        const id = getPostId(p);
        if (id) mergedMap.set(id, p);
      }

      const merged = Array.from(mergedMap.values());
      // Sort by date descending
      merged.sort((a, b) => getPostTimestamp(b.data?.date) - getPostTimestamp(a.data?.date));

      // Slice to keep reasonable history limit (max 1000)
      const finalPosts = merged.slice(0, 1000);

      // Save to cache
      try {
        localStorage.setItem(cachedStorageKey, JSON.stringify(finalPosts));
      } catch (err) {
        console.error("Failed to save cached posts:", err);
      }

      if (!selectedListenNode.value || selectedListenNode.value.id !== node.id) return;

      // Check for strictly new posts to highlight
      const freshlyAdded: string[] = [];
      for (const p of fetchedPosts) {
        const id = getPostId(p);
        if (id && (!hasPreviousCache || !cachedKeys.has(id))) {
          // If there's previous cache, highlight strictly new items that arrived.
          // If there was no previous cache, we can highlight the top items of this first load so that user feels they are fresh
          freshlyAdded.push(id);
        }
      }

      freshlyAdded.forEach(id => newlyFetchedListenKeys.value.add(id));
      listenPosts.value = finalPosts;
    }
  } catch (e) {
    console.error("Error in fetchListenPosts:", e);
  } finally {
    if (selectedListenNode.value?.id === node.id) {
      isFetchingListenPosts.value = false;
    }
  }
};

const startListenPolling = () => {
  if (listenRefreshInterval) {
    clearInterval(listenRefreshInterval);
    listenRefreshInterval = null;
  }
  if (!listenAutoRefreshActive.value || !selectedListenNode.value) return;

  const intervalTime = selectedListenNode.value.type === "keyword" ? 30000 : 15000;
  listenRefreshInterval = setInterval(() => {
    if (selectedListenNode.value) {
      fetchListenPosts(selectedListenNode.value);
    }
  }, intervalTime);
};

const toggleListenAutoRefresh = () => {
  listenAutoRefreshActive.value = !listenAutoRefreshActive.value;
  if (listenAutoRefreshActive.value) {
    startListenPolling();
  } else {
    if (listenRefreshInterval) {
      clearInterval(listenRefreshInterval);
      listenRefreshInterval = null;
    }
  }
};

const fetchSelectedChannelMetadata = async (node: ListenItem) => {
  if (node.type !== 'channel') {
    selectedChannelMetadata.value = null;
    return;
  }
  
  const username = node.argument?.trim();
  if (!username) {
    selectedChannelMetadata.value = null;
    return;
  }
  
  isFetchingChannelMetadata.value = true;
  try {
    const response = await fetch(`https://i.gogingko.net/api/v1/v/telegram-channel/${username}`);
    if (!response.ok) throw new Error('Failed to fetch channel metadata');
    const data = await response.json();
    if (selectedListenNode.value?.id === node.id) {
      selectedChannelMetadata.value = data;
    }
  } catch (error) {
    console.error("Error fetching channel metadata:", error);
    if (selectedListenNode.value?.id === node.id) {
      selectedChannelMetadata.value = null;
    }
  } finally {
    if (selectedListenNode.value?.id === node.id) {
      isFetchingChannelMetadata.value = false;
    }
  }
};

watch(selectedListenNode, (newNode) => {
  if (listenAutoRefreshActive.value) {
    startListenPolling();
  }
  if (newNode && newNode.type === 'channel') {
    fetchSelectedChannelMetadata(newNode);
  } else {
    selectedChannelMetadata.value = null;
  }
});

const clearCachedListenPosts = () => {
  if (!selectedListenNode.value) return;
  const cachedStorageKey = `listen_cached_posts_${selectedListenNode.value.id}`;
  localStorage.removeItem(cachedStorageKey);
  listenPosts.value = [];
  newlyFetchedListenKeys.value.clear();
};

const getCountryCodeFromLanguage = (lang: string): string | null => {
    if (!lang) return null;
    const cleaned = lang.trim();
    if (cleaned.includes('-')) {
        const parts = cleaned.split('-');
        const potentialCountry = parts[parts.length - 1].toUpperCase();
        if (potentialCountry.length === 2) {
            return potentialCountry;
        }
    }
    try {
        if (clm && typeof clm.getAllCountries === 'function') {
            const allCountries = clm.getAllCountries();
            if (Array.isArray(allCountries)) {
                const cleanLower = cleaned.toLowerCase();
                let found = allCountries.find(c => 
                    c.default_locale?.toLowerCase() === cleanLower ||
                    (c.locales && c.locales.some(loc => loc.toLowerCase() === cleanLower))
                );
                if (!found) {
                    found = allCountries.find(c => 
                        c.languages && c.languages.some(lang => lang.toLowerCase() === cleanLower || cleanLower.startsWith(lang.toLowerCase()))
                    );
                }
                if (found && found.alpha2) {
                    return found.alpha2.toUpperCase();
                }
            }
        }
    } catch (err) {
        console.error("Error mapping language with clm:", err);
    }
    const mapping: Record<string, string> = {
        zh: "CN",
        en: "US",
        es: "ES",
        ru: "RU",
        ja: "JP",
        ko: "KR",
        fr: "FR",
        de: "DE",
        it: "IT",
        pt: "PT",
        ar: "SA",
        vi: "VN",
        fa: "IR",
        tr: "TR",
        id: "ID",
        hi: "IN",
        uk: "UA",
        th: "TH",
        pl: "PL",
        nl: "NL",
        sv: "SE",
        no: "NO",
        fi: "FI",
        da: "DK",
        he: "IL",
        el: "GR",
        cs: "CZ",
        hu: "HU",
        ro: "RO",
        bg: "BG",
        sk: "SK",
        ms: "MY",
        tl: "PH"
    };
    const base = cleaned.toLowerCase().split(/[_-]/)[0];
    return mapping[base] || null;
};

const getFlagEmoji = (countryCode: string | null): string => {
    if (!countryCode) return "";
    try {
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map(char => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
    } catch (e) {
        return "";
    }
};

const computedFlag = computed(() => {
    if (!langCode.value) return "";
    const countryCode = getCountryCodeFromLanguage(langCode.value);
    return getFlagEmoji(countryCode);
});

const fetchChannels = async (forceFetch: boolean = false) => {
    if (!forceFetch) {
        const cached = localStorage.getItem('telegram' + activeChannelOrUser.value);
        if (cached) {
            channels.value = JSON.parse(cached);
            return;
        }
    }

    isLoadingChannels.value = true;
    try {
        let headers = {}
        const endpoint = activeChannelOrUser.value === 'channel' ? 'telegram-channel' : 'telegram-user';
        if (activeChannelOrUser.value === 'user') {
          headers = { 'x-gos-token': loginToken.value }
        }
        const response = await fetch(`https://i.gogingko.net/api/v1/zr/${endpoint}`, {
          method: 'GET',
          headers: headers,
        });
        if (response.ok) {
            const data = await response.json();
            const keys: string[] = data.keys || [];
            
            // Fetch profiles for each channel concurrently
            const channelPromises = keys.map(async (name) => {
                try {
                    const profileRes = await fetch(`https://i.gogingko.net/api/v1/v/${endpoint}/${name}`, {
                    });
                    if (profileRes.ok) {
                        let userData = await profileRes.json()
                        const match = String(userData.photo).match(/cdn(\d+)/);
                        let cdnNumber = null
                        let cdnRegion = null
                        if (match) {
                            cdnNumber = match[1];
                            cdnRegion = TelegramCDNRegions[cdnNumber as keyof typeof TelegramCDNRegions];
                        }
                        userData.cdnNumber = cdnNumber
                        userData.cdnRegion = cdnRegion
                        return userData;
                    }
                } catch (e) {
                    console.error(`Failed to fetch profile for ${name}`, e);
                }
                return { name: name }; 
            });
            const results = await Promise.all(channelPromises);
            channels.value = results;
            localStorage.setItem('telegram' + activeChannelOrUser.value, JSON.stringify(results));
        }
    } catch (e) {
        console.error(e);
    } finally {
        isLoadingChannels.value = false;
    }
};

const handleLangFetch = async () => {
    if (!langCode.value) return;
    isLoadingChannels.value = true;
    try {
        const names = await fetchChannelNamesByLang(langCode.value);
        if (names.length > 0) {
            const channelPromises = names.map(async (channelName) => {
                try {
                    const profileRes = await fetch(`https://i.gogingko.net/api/v1/v/telegram-channel/${channelName}`);
                    if (profileRes.ok) {
                        let userData = await profileRes.json()
                        const match = String(userData.photo).match(/cdn(\d+)/);
                        let cdnNumber = null
                        let cdnRegion = null
                        if (match) {
                            cdnNumber = match[1];
                            cdnRegion = TelegramCDNRegions[cdnNumber as keyof typeof TelegramCDNRegions];
                        }
                        userProfile.value = {
                            username: userData.username,
                            avatarUrl: `https://i.gogingko.net/api/v1/v/telegram-profile/${name}`,
                            title: userData.title,
                            description: userData.description,
                            cdnNumber: cdnNumber,
                            cdnRegion: cdnRegion
                        };
                        userData.cdnNumber = cdnNumber
                        userData.cdnRegion = cdnRegion
                        return userData;
                    }
                } catch (e) {
                    console.error(`Failed to fetch profile for ${channelName}`, e);
                }
                return { name: channelName }; 
            });
            channels.value = await Promise.all(channelPromises);
        } else {
            channels.value = [];
        }
    } catch (e) {
        console.error(e);
    } finally {
        isLoadingChannels.value = false;
    }
};

const isChannelLoaded = ref(false);

watch(activeTab, (newTab) => {
    if (newTab === 'channel' && !isChannelLoaded.value) {
        fetchChannels();
        isChannelLoaded.value = true;
    }
});

// Workspace State & Logic
const workspaceGraph = ref<any>(null);
const graphState = ref<any>(null);
const toastMessage = ref("");
const toastType = ref<'error' | 'success'>('error');
const contextMenu = ref({ visible: false, x: 0, y: 0, node: null });
const nodeSearchQuery = ref("");
const graphNameInput = ref("");

const findNode = () => {
  if (!workspaceGraph.value || !nodeSearchQuery.value) return;
  const node = workspaceGraph.value.getElementById(nodeSearchQuery.value);
  if (node.length > 0) {
    workspaceGraph.value.animate({
        center: { eles: node },
        zoom: 2
    });
    selectedNode.value = node;
    toastMessage.value = `Node ${nodeSearchQuery.value} found.`;
    toastType.value = 'success';
    
    // Highlight logic
    node.style({
        'border-width': '4px',
        'border-color': '#2563eb', // Tailwind blue-600
        'border-style': 'solid'
    });
    
    // After 5 seconds, remove the style overrides
    setTimeout(() => {
        if (!node || node.removed()) return; // node might be deleted in the meantime
        node.removeStyle('border-width');
        node.removeStyle('border-color');
        node.removeStyle('border-style');
    }, 5000);

    setTimeout(() => { toastMessage.value = ""; }, 3000);
  } else {
    toastMessage.value = `Node ${nodeSearchQuery.value} not found.`;
    toastType.value = 'error';
    setTimeout(() => { toastMessage.value = ""; }, 3000);
  }
};

const saveGraph = async () => {
    if (!graphNameInput.value) {
        toastMessage.value = "Please enter a graph name.";
        toastType.value = "error";
        setTimeout(() => { toastMessage.value = ""; }, 3000);
        return;
    }
    const name = graphNameInput.value;
    if (isLoginTokenValid.value) {
        if (!workspaceGraph.value) return;
        const data = JSON.stringify(workspaceGraph.value.json());
        try {
            await saveProfileRemotely(`graph-${name}`, loginToken.value, data);
            toastMessage.value = 'Graph saved remotely.';
            toastType.value = 'success';
            setTimeout(() => { toastMessage.value = ""; }, 3000);
        } catch (e: any) {
            toastMessage.value = 'Failed to save remotely.';
            toastType.value = 'error';
            console.error(e);
            setTimeout(() => { toastMessage.value = ""; }, 3000);
        }
    } else {
        if (!workspaceGraph.value) return;
        const data = JSON.stringify(workspaceGraph.value.json());
        localStorage.setItem('graphData', data);
        toastMessage.value = 'Graph saved.';
        toastType.value = 'success';
        setTimeout(() => { toastMessage.value = ""; }, 3000);
    }
};


function applyGraphStyle() {
    if (workspaceGraph.value) {
      workspaceGraph.value.style()
        .selector('node')
          .style('color', isDark.value ? '#f8fafc' : '#1e293b')
        .selector('edge')
          .style('color', isDark.value ? '#f8fafc' : '#1e293b')
          .style('text-background-color', isDark.value ? '#1e293b' : '#ffffff')
          .style('text-border-color', isDark.value ? '#334155' : '#e2e8f0')
        .update();
    }
}

const loadGraph = async () => {
    if (!graphNameInput.value && isLoginTokenValid.value) {
        toastMessage.value = "Please enter a graph name.";
        toastType.value = "error";
        setTimeout(() => { toastMessage.value = ""; }, 3000);
        return;
    }

    // Reset currently selected node or edge in inspector to avoid stale views
    selectedNode.value = null;
    selectedEdge.value = null;

    if (isLoginTokenValid.value && graphNameInput.value) {
        try {
            // Reusing profile loading logic as it seems to return content directly
            const response = await fetch(`https://i.gogingko.net/api/v1/v/profiles/graph-${graphNameInput.value}`, {
                method: 'GET',
                headers: { 'x-gos-token': loginToken.value }
            });
            if (!response.ok) throw new Error("Failed to load graph");
            const data = await response.json();
            if (workspaceGraph.value) {
                const parsedData = JSON.parse(data);
                delete parsedData.style;
                // Clear existing elements in cytoscape before loading the new graph structure
                workspaceGraph.value.elements().remove();
                workspaceGraph.value.json(parsedData);
                applyGraphStyle(); // Apply styles to newly loaded graph
                toastMessage.value = 'Graph loaded remotely.';
                toastType.value = 'success';
                setTimeout(() => { toastMessage.value = ""; }, 3000);
            }
        } catch (e: any) {
             toastMessage.value = 'Failed to load graph remotely.';
             toastType.value = 'error';
             console.error(e);
             setTimeout(() => { toastMessage.value = ""; }, 3000);
        }
    } else {
        const data = localStorage.getItem('graphData');
        if (data && workspaceGraph.value) {
            // Clear existing elements in cytoscape before loading the new graph structure
            workspaceGraph.value.elements().remove();
            workspaceGraph.value.json(JSON.parse(data));
            toastMessage.value = 'Graph loaded.';
            toastType.value = 'success';
            setTimeout(() => { toastMessage.value = ""; }, 3000);
        } else {
            toastMessage.value = 'No saved graph found.';
            toastType.value = 'error';
            setTimeout(() => { toastMessage.value = ""; }, 3000);
        }
    }
};

const reLayoutGraph = () => {
    if (!workspaceGraph.value) return;
    
    workspaceGraph.value.layout({
        name: 'cose',
        fit: true,
        padding: 50,
        animate: true,
        stop: () => {
             if (workspaceGraph.value.zoom() > 1.5) {
               workspaceGraph.value.zoom(1.5);
               workspaceGraph.value.center();
             }
        }
    }).run();
};

const clearGraph = () => {
    if (workspaceGraph.value) {
        workspaceGraph.value.destroy();
        workspaceGraph.value = null;
    }
    localStorage.removeItem('graphData');
    initGraph();
};

const shareGraph = () => {
    if (!workspaceGraph.value) return;
    const graphData = workspaceGraph.value.json();
    const str = JSON.stringify(graphData);
    const compressed = pako.deflate(str);
    let binary = '';
    for (let i = 0; i < compressed.length; i++) {
        binary += String.fromCharCode(compressed[i]);
    }
    const encoded = btoa(binary);
    const url = `${window.location.origin}${window.location.pathname}?graph=${encodeURIComponent(encoded)}`;
    navigator.clipboard.writeText(url).then(() => {
        toastMessage.value = 'Link copied to clipboard!';
        toastType.value = 'success';
        setTimeout(() => { toastMessage.value = ""; }, 3000);
    });
};

const analyzeGraph = async () => {
    if (!workspaceGraph.value || isAnalyzingGraph.value) return;                
    isAnalyzingGraph.value = true;
    try {
        const postInEdges = workspaceGraph.value.edges('[label="post in"]');
        
        toastMessage.value = `Filtered ${postInEdges.length} "post in" edges.`;
        toastType.value = 'success';
        setTimeout(() => { toastMessage.value = ""; }, 5000);

        let ids: string[] = [];
        // for each post-in edge, get all the post ids
        postInEdges.forEach((edge: any) => {
          const lines = (edge.data('facts') || '').split('\n');
          let oldIdsStr = '';

          for (const line of lines) {
            if (line.startsWith('post id:')) oldIdsStr = line.replace('post id:', '').trim();
          }
          if (oldIdsStr) {
            ids.push(...oldIdsStr.split(', '))
          }
        });
        if (ids.length === 0) {
          return
        }
        // Transform keys into { ns, key } objects by splitting at the first dot
        const mgetPayload = ids.map((fullKey: string) => {
          return {
            ns: 'telegram-post',
            key: fullKey,
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

        let postsData = await mgetResponse.json();
        console.log(`mget ${postsData.length} posts`)

        // for each channel edge, get all the post ids from the channel
        const directChannels = workspaceGraph.value.edges('[label="channel"]');
        //for (const edge of directChannels) {
        //  const channelPosts = await fetchChannelPosts(edge.target().id());
        //  postsData.push(...channelPosts);
        //};
        console.log(`total get ${postsData.length} posts`)

        const results = Array.isArray(postsData) ? postsData : postsData.data || [];

        const strippedPosts = results
         .map((p: any) => ({
           key: p.key,
           content: p.data?.content,
           date: p.data?.date,
           author: p.data?.author || p.data?.user,
           reply: p.data?.reply,
           forward_from: p.data?.forward_from,
         }))
         .filter((p: any) => p.content || p.reply);

        const response = await fetch("https://ask.gingkogo.uk/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: "mc",
            chat_id: "mc",
            text:
              "Please analyze the following posts that MIGHT from one user. You should consider grouping by the sent user or account. Note that some posts might be submission from other users which can be identified by the content signatures and some posts might contain non empty reply field or quoted content which means the content is a reply to that content (you should distinguish which dialog is truely the target expressed). For each grouped account, keep record the username (extract from 'user' field if non empty) and try hard to find anything that represented the personality of the account in social life, for example living city or country, post date that reflect the active hours(reference to China), job postion, career, gender, age, location, tour, language, education, interests, hobby, favorite things, politic opinions, special opinions, technology skills, troubles, cognitive state. Output the findings for each grouped account or user in Chinese including a table to clearly view, for any confirmed evidence please attach with the post id.\n\n" +
              JSON.stringify(strippedPosts),
          }),
        });

        if (!response.ok) throw new Error("Analysis request to ASK service failed " + response.status);
        const data = await response.json();
        // if it is a long response, we need to wait for the final result
        if (data.token) {
          analysisResultOfGraph.value = data.text;
        } else {
          analysisResultOfGraph.value = data.reply;
        }
        // save the analysis result to localStorage
        const personNodes = workspaceGraph.value.nodes('[type="person"]');
        if (personNodes.length === 1) {
          localStorage.setItem(`profile-person-${personNodes[0].data('label')}-${new Date().toISOString().slice(0, 13)}`, JSON.stringify(data));
          if (loginToken.value) {
            await saveProfileRemotely(`profile-person-${personNodes[0].data('label')}-${new Date().toISOString().slice(0, 13)}`, loginToken.value, JSON.stringify(data));
          }
        }
    } catch (error) {
        toastMessage.value = "Analysis failed: " + error;
        toastType.value = "error";
        setTimeout(() => { toastMessage.value = ""; }, 5000);
        console.error(error);
    } finally {
        isAnalyzingGraph.value = false;
    }
};

const fetchNodeMetadata = async (nodeType: string, nodeId: string) => {
    try {
        if (nodeType === 'user' && nodeId.includes('Telegram User')) {
          return;
        }
        const response = await fetch(`https://i.gogingko.net/api/v1/v/telegram-${nodeType}/${nodeId}`);
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();
        
        if (data.title) {
          editingNodeData.value.label = data.title;
        } 
        editingNodeData.value.username = data.username || '';
        editingNodeData.value.link = `https://t.me/${data.username || ''}`;

        // Facts array
        const facts = [];
        if (data.username) facts.push(`Username: ${data.username}`);
        if (data.description) facts.push(`Description: ${data.description || ''}`);
        if (data.subscribers) facts.push(`Subscribers: ${data.subscribers}`);
        if (data.members) facts.push(`Members: ${data.members}`);
        editingNodeData.value.facts = facts.join('\n');
        
        saveChanges();
        
        toastMessage.value = 'Metadata fetched!';
        toastType.value = 'success';
        setTimeout(() => { toastMessage.value = ""; }, 3000);
    } catch (e) {
        toastMessage.value = 'Fetch failed.';
        toastType.value = 'error';
        setTimeout(() => { toastMessage.value = ""; }, 3000);
    }
};

const fetchChannelDates = async (nodeId: string) => {
    try {
        let response = await fetch(`https://i.gogingko.net/api/v1/last/${nodeId}?n=100`);
        if (!response.ok) throw new Error('Failed to fetch');
        let data = await response.json();
        
        // Assuming posts are returned in data.posts
        let posts = data || [];
        if (posts.length === 0) {
           toastMessage.value = 'No posts found in channel.';
           toastType.value = 'error';
           setTimeout(() => { toastMessage.value = ""; }, 3000);
           return;
        }
        
        let dates = posts.map((p: any) => new Date(p.date || p.data?.date).getTime());
        let min = new Date(Math.min(...dates)).toISOString();
        const max = new Date(Math.max(...dates)).toISOString();

        response = await fetch(`https://i.gogingko.net/api/v1/last/${nodeId}?n=100&b=100`);
        if (!response.ok) throw new Error('Failed to fetch');
        data = await response.json();
        
        // Assuming posts are returned in data.posts
        posts = data || [];
        if (posts.length != 0) {
          dates = posts.map((p: any) => new Date(p.date || p.data?.date).getTime());
          min = new Date(Math.min(...dates)).toISOString();
        }
        
        // Update facts
        let factsStr = editingEdgeData.value.facts || '';
        const dateLine = `post date: ${min} to ${max}`;
        
        const lines = factsStr.split('\n');
        const newLines = lines.filter((l: string) => !l.startsWith('post date:'));
        newLines.push(dateLine);
        
        editingEdgeData.value.facts = newLines.join('\n');
        saveChanges();
        
        toastMessage.value = 'Dates detected!';
        toastType.value = 'success';
        setTimeout(() => { toastMessage.value = ""; }, 3000);
    } catch (e) {
        toastMessage.value = 'Fetch failed.';
        toastType.value = 'error';
        setTimeout(() => { toastMessage.value = ""; }, 3000);
    }
};

const fetchChannelPosts = async (nodeId: string, atMost = 100) => {
    try {
        let response = await fetch(`https://i.gogingko.net/api/v1/last/${nodeId}?n=100`);
        if (!response.ok) throw new Error('Failed to fetch');
        let data = await response.json();
        
        // Assuming posts are returned in data.posts
        let allPosts = [];
        let posts = data || [];
        let min = 1;

        if (posts.length === 0) {
           toastMessage.value = 'No posts found in channel.';
           toastType.value = 'error';
           setTimeout(() => { toastMessage.value = ""; }, 3000);
           return [];
        } else {
          min = parseInt(posts[posts.length - 1].key.split('.')[1]);
        }
        allPosts.push(...posts);
        toastMessage.value = `Fetched ${allPosts.length} posts from ${nodeId}! Continue...`;
        toastType.value = 'success';
        setTimeout(() => { toastMessage.value = ""; }, 3000);

        // iterate to the first post
        while (min > 1) {
          response = await fetch(`https://i.gogingko.net/api/v1/last/${nodeId}?n=100&b=${min}`);
          if (!response.ok) throw new Error('Failed to fetch ' + nodeId + ' b=' + min);
          data = await response.json();
          posts = data || [];
          if (posts.length != 0) {
            min = parseInt(posts[posts.length - 1].key.split('.')[1]);
            allPosts.push(...posts);
          } else {
            min = min - 100;
          }
          if (atMost > 0 && allPosts.length >= atMost) {
            break;
          }
        }
        toastMessage.value = `Fetched ${allPosts.length} posts from ${nodeId}!`;
        toastType.value = 'success';
        setTimeout(() => { toastMessage.value = ""; }, 3000);

        return allPosts;
    } catch (e) {
        toastMessage.value = 'Fetch failed.';
        toastType.value = 'error';
        setTimeout(() => { toastMessage.value = ""; }, 3000);
    }
  return [];
};

const generateHash5 = (seed) => {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0, ch; i < seed.length; i++) {
    ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  
  // Convert the resulting 64-bit integer to a base36 string and slice
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).substring(0, 5);
};

const addToWorkspaceFromPost = (post: any) => {
    if (!workspaceGraph.value) {
        toastMessage.value = 'Workspace not initiated, try to switch to it.';
        toastType.value = 'error';
        setTimeout(() => { toastMessage.value = ""; }, 5000);
        return;
    }
    const channelUsername = post.key.split('.')[0];
    let userUsername = getUsername(post);

    if (userUsername == 'Telegram User') {
      if (post.data?.uid === undefined) {
        userUsername = `Telegram User ${generateHash5(post.data?.author)}`
      } else {
        userUsername = `${post.data?.uid}`
      }
    }
    if (workspaceGraph.value.getElementById(channelUsername).length === 0) {
        addNode(channelUsername, 'channel', { id: channelUsername, label: post.data?.owner });
    }
    if (workspaceGraph.value.getElementById(userUsername).length === 0) {
        addNode(userUsername, 'user', { id: userUsername, label: post.data?.author });
    }

    if (channelUsername != userUsername) {
      // if source and target is not the same object, add edge
      const existingEdges = workspaceGraph.value.edges(`[source="${userUsername}"][target="${channelUsername}"]`);
      if (existingEdges.length === 0) {
          addEdge(userUsername, channelUsername, {label: 'post in', facts: `post date: ${post.data?.date}\npost id: ${post.key}`});
      } else {
          const edge = existingEdges[0];
          const oldFacts = edge.data('facts') || '';
          
          let oldDateStr = '';
          let oldIdsStr = '';
          
          const lines = oldFacts.split('\n');
          for (const line of lines) {
              if (line.startsWith('post date:')) oldDateStr = line.replace('post date:', '').trim();
              if (line.startsWith('post id:')) oldIdsStr = line.replace('post id:', '').trim();
          }
          
          let minDate = post.data?.date;
          let maxDate = post.data?.date;
          
          if (oldDateStr) {
              const dates = oldDateStr.split(' to ');
              if (dates.length === 1) {
                  const oldDate = new Date(dates[0]);
                  const newDate = new Date(post.data?.date);
                  if (!isNaN(oldDate.getTime()) && !isNaN(newDate.getTime())) {
                      minDate = oldDate < newDate ? dates[0] : post.data?.date;
                      maxDate = oldDate > newDate ? dates[0] : post.data?.date;
                  } else {
                      minDate = dates[0];
                      maxDate = minDate;
                  }
              } else if (dates.length === 2) {
                  const minD = new Date(dates[0]);
                  const maxD = new Date(dates[1]);
                  const newD = new Date(post.data?.date);
                  
                  if (!isNaN(newD.getTime())) {
                      minDate = newD < minD ? post.data?.date : dates[0];
                      maxDate = newD > maxD ? post.data?.date : dates[1];
                  } else {
                      minDate = dates[0];
                      maxDate = dates[1];
                  }
              }
          }
          const newDateStr = (minDate && maxDate && minDate !== maxDate) ? `${minDate} to ${maxDate}` : minDate;
          
          const idSet = new Set(oldIdsStr ? oldIdsStr.split(', ') : []);
          if (post.key) idSet.add(post.key);
          const newIdsStr = Array.from(idSet).join(', ');
          
          const newFacts = `post date: ${newDateStr}\npost id: ${newIdsStr}`;
          edge.data('facts', newFacts);

          // Ensure graph state is persisted and UI is updated if the edge is selected
          graphState.value = workspaceGraph.value.json();
          
          if (selectedEdge.value && selectedEdge.value.id() === edge.id()) {
              editingEdgeData.value = { ...edge.data() };
          }
      }

      const personNodes = workspaceGraph.value.nodes('[type="person"]');
      if (personNodes.length === 1) {
          const personId = personNodes[0].id();
          if (workspaceGraph.value.edges(`[source="${personId}"][target="${userUsername}"]`).length === 0) {
              addEdge(personId, userUsername, {label: 'account'});
          }
      }
      
      toastMessage.value = `Added ${userUsername} to workspace with edge!`;
      toastType.value = 'success';
      setTimeout(() => { toastMessage.value = ""; }, 5000);
    } else {
      // if source and target is the same object, do not add s->t edge
      const personNodes = workspaceGraph.value.nodes('[type="person"]');
      if (personNodes.length === 1) {
          const personId = personNodes[0].id();
          if (workspaceGraph.value.edges(`[source="${personId}"][target="${channelUsername}"]`).length === 0) {
              addEdge(personId, channelUsername, {label: 'channel'});
          }
      }

      toastMessage.value = `Added ${channelUsername} to workspace without edge!`;
      toastType.value = 'success';
      setTimeout(() => { toastMessage.value = ""; }, 5000);
    }
};

const startAddEdge = () => {
    if (contextMenu.value.node) {
        addingEdge.value = true;
        sourceNode.value = contextMenu.value.node;
        contextMenu.value.visible = false;
        toastMessage.value = 'Select target node to add edge.';
        toastType.value = 'success';
        setTimeout(() => { toastMessage.value = ""; }, 5000);
    }
};

const addForwardFrom = async () => {
  if (contextMenu.value.node) {
    try {
      const profileRes = await fetch(`https://i.gogingko.net/api/v1/v/profiles/CG-${contextMenu.value.node.id()}`);
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        const forwards = profileData.forwards || [];
        forwards.map(item => {
          // add a new node to the graph
          addNode(item, 'channel', {
            id: item, // Custom ID used by Cytoscape graph
            username: item,
            link: `https://t.me/${item}`,
            facts: ''
         });
         // add a new edge
         addEdge(contextMenu.value.node.id(), item, {label: 'forward from'});
        })
      }
    } catch (e) {
      console.error("Failed to fetch forwards", e);
    }
    contextMenu.value.visible = false;
  }
}

const deleteNode = () => {
    if (contextMenu.value.node && workspaceGraph.value) {
        workspaceGraph.value.remove(contextMenu.value.node);
        contextMenu.value.visible = false;
        graphState.value = workspaceGraph.value.json();
        toastMessage.value = 'Node deleted.';
        toastType.value = 'success';
        setTimeout(() => { toastMessage.value = ""; }, 5000);
    }
};

const deleteEdge = (edge: any) => {
    if (workspaceGraph.value) {
        workspaceGraph.value.remove(edge);
        graphState.value = workspaceGraph.value.json();
        toastMessage.value = 'Edge deleted.';
        toastType.value = 'success';
        setTimeout(() => { toastMessage.value = ""; }, 5000);
    }
};
const addingEdge = ref(false);
const sourceNode = ref<any>(null);
const lastContainerSize = ref({ width: 0, height: 0 });
const selectedNode = ref<any>(null);
const selectedEdge = ref<any>(null);
const editingNodeData = ref<any>({});
const editingEdgeData = ref<any>({});

const saveChanges = () => {
  if (selectedNode.value) {
    selectedNode.value.data(editingNodeData.value);
  }
  if (selectedEdge.value) {
    const oldData = selectedEdge.value.data();
    const newData = editingEdgeData.value;
    
    if (oldData.source !== newData.source || oldData.target !== newData.target) {
        // Recreate edge if structural connection changed
        const id = oldData.id;
        selectedEdge.value.remove();
        const addedEdge = workspaceGraph.value.add({
            group: 'edges',
            data: { ...newData, id }
        });
        selectedEdge.value = addedEdge;
    } else {
        selectedEdge.value.data(newData);
    }
  }
};

const getEdges = computed(() => {
    if (!selectedNode.value) return { incoming: [], outgoing: [] };
    const node = selectedNode.value;
    return {
        incoming: node.incomers('edge').toArray(),
        outgoing: node.outgoers('edge').toArray()
    };
});

watch(selectedNode, (newSelectedNode) => {
  if (newSelectedNode) {
    editingNodeData.value = { ...newSelectedNode.data() };
    selectedEdge.value = null;
  } else {
    editingNodeData.value = {};
  }
});

watch(selectedEdge, (newSelectedEdge) => {
  if (newSelectedEdge) {
    editingEdgeData.value = { ...newSelectedEdge.data() };
    selectedNode.value = null;
  } else {
    editingEdgeData.value = {};
  }
});

const selectEdge = (edge: any) => {
    selectedEdge.value = edge;
};

const initGraph = () => {
  const container = document.getElementById('workspace-canvas');
  if (!container) return;
  if (!workspaceGraph.value) {
    const urlParams = new URLSearchParams(window.location.search);
    const sharedGraph = urlParams.get('graph');
    
    let elements;
    if (sharedGraph) {
        try {
            const binaryString = atob(decodeURIComponent(sharedGraph));
            const bytes = Uint8Array.from(binaryString, c => c.charCodeAt(0));
            const decompressed = pako.inflate(bytes, { to: 'string' });
            const data = JSON.parse(decompressed);
            elements = data.elements;
        } catch (e) {
            console.error('Failed to parse shared graph', e);
        }
    }
    
    if (!elements) {
        const savedGraph = localStorage.getItem('graphData');
        elements = savedGraph ? JSON.parse(savedGraph).elements : [
            { data: { id: 'a', label: 'Person A', type: 'person' } },
        ];
    }

    workspaceGraph.value = cytoscape({
      container: container,
      elements: elements,
      pixelRatio: 1,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'color': isDark.value ? '#f8fafc' : '#1e293b',
            'font-size': '10px'
          }
        },
        {
          selector: 'node[type="person"]',
          style: {
            'background-color': '#ec4899', // Pink-500
            'shape': 'ellipse',
            'width': 30,
            'height': 30,
          }
        },
        {
          selector: 'node[type="user"]',
          style: {
            'background-color': '#10b981', // Emerald-500
            'shape': 'round-rectangle',
            'width': 30,
            'height': 30,
          }
        },
        {
          selector: 'node[type="channel"]',
          style: {
            'background-color': '#f59e0b', // Amber-500
            'shape': 'diamond',
            'width': 30,
            'height': 30,
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 1,
            'line-color': '#cbd5e1',
            'target-arrow-color': '#cbd5e1',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(label)',
            'color': isDark.value ? '#f8fafc' : '#1e293b',
            'font-size': '10px',
            'text-background-color': isDark.value ? '#1e293b' : '#ffffff',
            'text-background-opacity': 0.8,
            'text-background-padding': '2px',
            'text-border-color': isDark.value ? '#334155' : '#e2e8f0',
            'text-border-width': 1,
            'text-border-opacity': 1,
            'text-wrap': 'wrap',
            'text-max-width': '100px',
            'curve-style': 'bezier', 
            'control-point-step-size': 10
          }
        }
      ],
      layout: { 
        name: 'cose', 
        padding: 50, 
        fit: true,
        stop: () => {
          if (workspaceGraph.value.zoom() > 1.5) {
            workspaceGraph.value.zoom(1.5);
            workspaceGraph.value.center();
          }
        }
      }
    });

watch(isDark, () => {
  applyGraphStyle();
});

    lastContainerSize.value = { width: container.clientWidth, height: container.clientHeight };

    workspaceGraph.value.on('tap', 'node', (evt: any) => {
      selectedNode.value = evt.target;
      contextMenu.value.visible = false;
      if (addingEdge.value && sourceNode.value) {
          if (sourceNode.value !== evt.target) {
              addEdge(sourceNode.value.id(), evt.target.id());
              addingEdge.value = false;
              sourceNode.value = null;
          }
      }
    });
    workspaceGraph.value.on('cxttap', 'node', (evt: any) => {
        console.log('Right-clicked node');
        const pos = evt.renderedPosition;
        contextMenu.value = {
            visible: true,
            x: pos.x,
            y: pos.y,
            node: evt.target
        };
    });
    
    workspaceGraph.value.on('tap', 'edge', (evt: any) => {
      selectedEdge.value = evt.target;
      contextMenu.value.visible = false;
    });
    workspaceGraph.value.on('tap', (evt: any) => {
      if (evt.target === evt.cy) {
        selectedNode.value = null;
        selectedEdge.value = null;
        contextMenu.value.visible = false;
      }
    });
    workspaceGraph.value.on('cxttap', (evt: any) => {
      if (evt.originalEvent && evt.originalEvent.preventDefault) {
        evt.originalEvent.preventDefault();
      }
      if (evt.target === evt.cy) {
        if (addingEdge.value) {
            addingEdge.value = false;
            sourceNode.value = null;
            toastMessage.value = 'Cancelled adding edge.';
            toastType.value = 'error';
            setTimeout(() => { toastMessage.value = ""; }, 3000);
        }
      }
    });
  } else {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width !== lastContainerSize.value.width || height !== lastContainerSize.value.height) {
        workspaceGraph.value.resize();
        workspaceGraph.value.layout({ 
          name: 'cose', 
          padding: 50, 
          fit: true,
          stop: () => {
            if (workspaceGraph.value.zoom() > 1.5) {
              workspaceGraph.value.zoom(1.5);
              workspaceGraph.value.center();
            }
          }
        }).run();
        lastContainerSize.value = { width, height };
    }
  }
};

const addNode = (label: string, type: 'person' | 'user' | 'channel', data: any = {}) => {
  if (!workspaceGraph.value) return;
  const id = data.id || ('n' + Date.now());
  workspaceGraph.value.add({
    group: 'nodes',
    data: { id, label, type, ...data }
  });
  
  // Update state if it exists
  if (workspaceGraph.value) {
      graphState.value = workspaceGraph.value.json();
  }
};

const addToWorkspace = () => {
    if (!metadata.value) return;

    if (!workspaceGraph.value) {
        toastMessage.value = 'Workspace not initiated, try to switch to it.';
        toastType.value = 'error';
        setTimeout(() => { toastMessage.value = ""; }, 5000);
        return;
    }

    const m = metadata.value;
    const username = m.username || m.name || channelName.value;
    
    // Check if node already exists
    if (username && workspaceGraph.value.getElementById(username).length > 0) {
        toastMessage.value = `Node ${username} already exists`;
        toastType.value = 'error';
        setTimeout(() => { toastMessage.value = ""; }, 5000);
        return;
    }

    const label = m.title || m.name || channelName.value;
    
    // Facts array
    const facts = [];
    if (m.username) facts.push(`Username: ${m.username}`);
    if (m.description) facts.push(`Description: ${m.description || ''}`);
    if (m.subscribers) facts.push(`Subscribers: ${m.subscribers}`);
    if (m.members) facts.push(`Members: ${m.members}`);
    
    addNode(label, 'channel', {
      id: username, // Custom ID used by Cytoscape graph
      username: username,
      link: `https://t.me/${username}`,
      facts: facts.join('\n')
    });

    // Automatically connect to Person node if only one exists
    const personNodes = workspaceGraph.value.nodes('[type="person"]');
    if (personNodes.length === 1) {
        addEdge(personNodes[0].id(), username, {label: 'channel'});
    }
    
    toastMessage.value = `Added ${label} to workspace!`;
    toastType.value = 'success';
    setTimeout(() => { toastMessage.value = ""; }, 5000);
};

const addEdge = (source: string, target: string, data: any = {}) => {
  if (!workspaceGraph.value) return;
  const edgeData = { label: '', ...data };
  workspaceGraph.value.add({
    group: 'edges',
    data: { source, target, createdAt: new Date().toISOString(), ...edgeData }
  });
  
  // Update state to trigger reactivity
  if (workspaceGraph.value) {
      graphState.value = workspaceGraph.value.json();
  }
};

const tabScrollPositions = ref<Record<string, number>>({});

watch(activeTab, (newTab, oldTab) => {
  // Save current scroll position
  if (oldTab) {
    tabScrollPositions.value[oldTab] = window.scrollY;
  }

  // If we are leaving workspace, save state
  if (oldTab === 'workspace' && workspaceGraph.value) {
    graphState.value = workspaceGraph.value.json();
  }
  
  // If we are entering workspace, init or restore
  if (newTab === 'workspace') {
    nextTick(() => {
      initGraph();
      if (graphState.value && workspaceGraph.value) {
        workspaceGraph.value.json(graphState.value);
      }
    });
  }

  // Restore scroll position
  nextTick(() => {
    const savedScroll = tabScrollPositions.value[newTab] || 0;
    window.scrollTo(0, savedScroll);
  });
});

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
          "Generate a table from the following results of iterations with columns while each row stand for a active user in the results and each column stand for different evidence type. Make sure to contains all the appeared users and keep the post id ranges. Here is the context input: \n" +
          context,
      }),
    });
    const data = await response.json();
    finalTableHtml.value = md.render(data.reply);
    // save the results to localStorage
    localStorage.setItem(
      `profile-${searchMode.value}-${autoChannelName.value.trim().replace(/^@/, "")}-${new Date().toISOString().slice(0, 13)}`,
      JSON.stringify(data)
    );
    if (loginToken.value) {
        await saveProfileRemotely(`profile-${searchMode.value}-${autoChannelName.value.trim().replace(/^@/, "")}-${new Date().toISOString().slice(0, 13)}`, loginToken.value, JSON.stringify(data));
    }
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
const channelProfile = ref("");
const channelProfileDate = ref("");
const loadingChannelProfile = ref(false);

const translatedPosts = ref<Record<string, string>>({});
const isTranslating = ref<Record<string, boolean>>({});

const translatePost = async (post: any) => {
  if (translatedPosts.value[post.key]) {
    delete translatedPosts.value[post.key];
    return;
  }
  
  isTranslating.value[post.key] = true;
  try {
     const res = await fetch(`https://i.gogingko.net/api/v1/gtr?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(post.data.content)}`, {
        method: 'GET'
    });
    if (!res.ok) throw new Error("Translation failed");
    const data = await res.json();
    // Assuming the API returns a structure where [0][0][0] is the translated text as per common google translate API behavior
    if (data[0]) {
      const translatedTextArray = data[0].map(item => item[0])
      translatedPosts.value[post.key] = translatedTextArray.join(''); 
    } else {
      translatedPosts.value[post.key] = "Please retry later.";
    }
  } catch(e) {
    console.error("Translation error", e);
    translatedPosts.value[post.key] = "Translation failed.";
  } finally {
    isTranslating.value[post.key] = false;
  }
};

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

  if (newTab === 'search' || newTab === 'auto-finding' || newTab === 'workspace' || newTab === 'profile') {
    loadSavedProfiles();
  }
  if (newTab === 'workspace') {
    loadSavedGraphRemotely();
  }
  if (newTab === 'profile') {
    fetchRemoteProfiles();
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
  loadSavedProfiles();
  loadLogin();
  loadListenDirectory();
});

onUnmounted(() => {
  window.removeEventListener("scroll", handleScroll);
  if (counterTimer) clearInterval(counterTimer);
  if (pendingJobsTimer) clearInterval(pendingJobsTimer);
  if (pollingTimer) clearInterval(pollingTimer);
  if (listenRefreshInterval) clearInterval(listenRefreshInterval);
});
const isProfileVisible = ref(true);

// Explorer State
const channelName = ref("");
const isInputFocused = ref(false);
const currentChannelName = ref("");
const forwardsChannels = ref<string[]>([]);
const userProfile = ref<any>(null);
const loadingUserProfile = ref(false);
const savedProfiles = ref<{channel: string[], user: string[], person: string[]}>({ channel: [], user: [], person: [] });
const savedGraphRemotely = ref<string[]>([]);
const savedFinalTableHtml = ref("")
const savedProfileName = ref("")
const savedPersonProfileHtml = ref("")
const loading = ref(false);
const error = ref("");
const profileError = ref("");
const metadata = ref<any>(null);
const posts = ref<any[]>([]);
const viewMode = ref<"list" | "masonry" | "timeline">("list");
const isPostModalVisible = ref(false);
const selectedPost = ref<any>(null);
const selectedUsernamesExplorer = ref<string[]>([]);

const fetchChannelProfile = async (channel: string) => {
  if (!channel) return;
  loadingChannelProfile.value = true;
  channelProfile.value = "";
  channelProfileDate.value = "";
  try {
    const profileName = `profile-channel-${channel}`;
    let response = await fetch(`https://i.gogingko.net/api/v1/v/profiles/${profileName}`, {
        method: 'GET',
        headers: { 'x-gos-token': loginToken.value }
    });
    if (response.status === 404) {
      const clistResponse = await fetch(`https://i.gogingko.net/api/v1/zr/profiles?prefix=${profileName}-&k=24`, {
          method: 'GET',
          headers: { 'x-gos-token': loginToken.value }
      });
      if (clistResponse.ok) {
        const clistRes = await clistResponse.json()
        const clist = clistRes.keys.map(item => decodeURIComponent(item)).sort((a, b) => {
          const dateA = new Date(a.replace(`${profileName}-`, '') + ':00')
          const dateB = new Date(b.replace(`${profileName}-`, '') + ':00')
          return dateB - dateA
        })
        console.log(clistRes.keys)
        console.log(clist)
        if (clist.length > 0) {
          channelProfileDate.value = clist[0].replace(`${profileName}-`, '')
          response = await fetch(`https://i.gogingko.net/api/v1/v/profiles/${clist[0]}`, {
            method: 'GET',
            headers: { 'x-gos-token': loginToken.value }
        });
        }
      } else {
        response = clistResponse
      }
    }
    if (!response.ok) throw new Error("Failed to load channel profile");
    const data = JSON.parse(await response.json());
    channelProfile.value = md.render(data.reply);
  } catch(e) {
    channelProfile.value = "Channel profile un-generated or not found.";
  } finally {
    loadingChannelProfile.value = false;
  }
};

watch(currentChannelName, (newChannel) => {
    if (newChannel) fetchChannelProfile(newChannel);
});

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
const selectedChannels = ref<string[]>([]);
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

const allChannels = computed(() => {
  const channels = new Set<string>();
  searchResults.value.forEach((p) => {
    if (p.key) {
      channels.add(p.key.split('.')[0]);
    }
  });
  return Array.from(channels).sort();
});

const allUsernamesExplorer = computed(() => {
  const users = new Set<string>();
  posts.value.forEach((p) => {
    const rawUser = p.data?.user;
    if (rawUser) {
      const parts = rawUser.split("/");
      users.add(parts[parts.length - 1]);
    } else if (p.data?.uid !== undefined) {
      users.add(p.data?.uid)
    }
  });
  return Array.from(users).sort();
});

const usernamePostCounts = computed(() => {
  const counts: Record<string, number> = {};
  searchResults.value.forEach((p) => {
    const rawUser = p.data?.user;
    let username: string | undefined;
    if (rawUser) {
      const parts = rawUser.split("/");
      username = parts[parts.length - 1];
    } else if (p.data?.uid !== undefined) {
      username = String(p.data?.uid);
    }
    
    if (username) {
      counts[username] = (counts[username] || 0) + 1;
    }
  });
  return counts;
});

const channelPostCounts = computed(() => {
  const counts: Record<string, number> = {};
  searchResults.value.forEach((p) => {
    const channel = p.key.split('.')[0];
    if (channel) {
      counts[channel] = (counts[channel] || 0) + 1;
    }
  });
  return counts;
});

const usernamePostCountsExplorer = computed(() => {
  const counts: Record<string, number> = {};
  posts.value.forEach((p) => {
    const rawUser = p.data?.user;
    let username: string | undefined;
    if (rawUser) {
      const parts = rawUser.split("/");
      username = parts[parts.length - 1];
    } else if (p.data?.uid !== undefined) {
      username = String(p.data?.uid);
    }
    
    if (username) {
      counts[username] = (counts[username] || 0) + 1;
    }
  });
  return counts;
});

const allUsernames = computed(() => {
  const users = new Set<string>();
  searchResults.value.forEach((p) => {
    const rawUser = p.data?.user;
    if (rawUser) {
      const parts = rawUser.split("/");
      users.add(parts[parts.length - 1]);
    } else if (p.data?.uid !== undefined) {
      users.add(p.data?.uid)
    }
  });
  return Array.from(users).sort();
});

const filteredSearchResults = computed(() => {
  let result = searchResults.value;

  if (selectedUsernames.value.length > 0) {
    result = result.filter((p) => {
      const rawUser = p.data?.user;
      if (!rawUser) {
        if (p.data?.uid !== undefined) {
          return selectedUsernames.value.includes(p.data?.uid);
        }
        return false;
      }
      const parts = rawUser.split("/");
      const username = parts[parts.length - 1];
      return selectedUsernames.value.includes(username);
    });
  }

  if (selectedChannels.value.length > 0) {
    result = result.filter((p) => {
      if (!p.key) return false;
      const channel = p.key.split('.')[0];
      return selectedChannels.value.includes(channel);
    });
  }

  return result;
});

const toggleUsernameExplorer = (username: string) => {
  const index = selectedUsernamesExplorer.value.indexOf(username);
  if (index > -1) {
    selectedUsernamesExplorer.value.splice(index, 1);
  } else {
    selectedUsernamesExplorer.value.push(username);
  }
};

const handleBlur = () => {
  setTimeout(() => {
    isInputFocused.value = false;
  }, 200);
};

const toggleUsername = (username: string) => {
  const index = selectedUsernames.value.indexOf(username);
  if (index > -1) {
    selectedUsernames.value.splice(index, 1);
  } else {
    selectedUsernames.value.push(username);
  }
};

const toggleChannel = (channel: string) => {
  const index = selectedChannels.value.indexOf(channel);
  if (index > -1) {
    selectedChannels.value.splice(index, 1);
  } else {
    selectedChannels.value.push(channel);
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
  if (!rawUser || typeof rawUser !== "string") {
    if (post.data?.uid !== undefined) {
      return post.data?.uid;
    }
    return "Telegram User";
  }
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


watch(channelName, (newVal) => {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (newVal.trim().length === 0 || !isLoginTokenValid.value) {
        suggestedChannels.value = [];
        return;
    }

    searchTimeout = setTimeout(async () => {
         try {
            const response = await fetch(`https://i.gogingko.net/api/v1/zr/telegram-channel?prefix=${encodeURIComponent(newVal)}&k=24`, {
                headers: { 'x-gos-token': loginToken.value }
            });
            if (response.ok) {
                const data = await response.json();
                suggestedChannels.value = data.keys || [];
            }
         } catch (e) {
             console.error(e);
         }
    }, 1000);
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
const isRepeatScheduleMode = ref(false);
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
const startLongPress = () => {
    longPressTimer = setTimeout(() => {
        isRepeatScheduleMode.value = !isRepeatScheduleMode.value;
        toastMessage.value = isRepeatScheduleMode.value ? "Mode: Repeatly" : "Mode: Once";
        toastType.value = "info";
        setTimeout(() => { toastMessage.value = ""; }, 2000);
    }, 500);
};
const cancelLongPress = () => {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
};
const handleScrapeClick = async () => {
    if (isRepeatScheduleMode.value) {
        await scheduleScrapeRepeatly();
    } else {
        await scheduleScrape();
    }
};

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

const scheduleScrapeRepeatly = async () => {
  if (!currentChannelName.value || isScrapingDisabled.value) return;
  try {
    const res = await fetch(
      `https://i.gogingko.net/api/v1/lq/${encodeURIComponent(
        currentChannelName.value
      )}?qn=q1`,
      {
        method: "POST",
      }
    );
    if (!res.ok)
      throw new Error(`Failed to schedule scrape repeatly: ${res.statusText}`);

    toastMessage.value = `Schedule scrape ${currentChannelName.value} repeatly.`;
    toastType.value = 'success';
    setTimeout(() => { toastMessage.value = ""; }, 3000);

    isScrapingDisabled.value = true;
    setTimeout(() => {
      isScrapingDisabled.value = false;
    }, 5000);
  } catch (err: any) {
    console.error(err);
    alert("Failed to schedule scrape repeatly: " + err.message);
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

const highlightTextByKeywords = (text: any) => {
  if (!text || !selectedListenNode.value || !selectedListenNode.value.argument) return text ? String(text) : "";

  let highlighted = String(text);
  selectedListenNode.value.argument.split(',').forEach((word) => {
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

const fetchUserProfile = async (name: string) => {
  loadingUserProfile.value = true;
  userProfile.value = null;
  try {
    const [userRes] = await Promise.all([
      fetch(`https://i.gogingko.net/api/v1/v/telegram-user/${name}`)
    ]);

    if (userRes.ok) {
      const userData = await userRes.json();
      if (userData._tool) {
        userProfile.value = {
            username: userData.username,
            avatarUrl: `https://i.gogingko.net/api/v1/v/telegram-profile/${name}`,
            id: userData.id,
            about: userData.about,
            firstName: userData.first_name,
            lastName: userData.last_name,
            phone: userData.phone,
            status: userData.status,
            lang: userData.lang,
            verified: userData.verified
        };
      } else {
        const match = String(userData.photo).match(/cdn(\d+)/);
        let cdnNumber = null
        let cdnRegion = null
        if (match) {
            cdnNumber = match[1];
            cdnRegion = TelegramCDNRegions[cdnNumber as keyof typeof TelegramCDNRegions];
        }
        userProfile.value = {
            username: userData.username,
            avatarUrl: `https://i.gogingko.net/api/v1/v/telegram-profile/${name}`,
            title: userData.title,
            description: userData.description,
            cdnNumber: cdnNumber,
            cdnRegion: cdnRegion
        };
      }
    }
  } catch (e) {
    console.error("Failed to fetch user profile", e);
  } finally {
    loadingUserProfile.value = false;
  }
};

const getSha1HexDigest = async (fdata) => {
    // 1. Encode string into an array of bytes (Uint8Array)
    const encoder = new TextEncoder();
    const data = encoder.encode(fdata);
    
    // 2. Calculate the SHA-1 hash array buffer
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    
    // 3. Convert the binary buffer into a hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hexdigest = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hexdigest;
}

const saveProfileRemotely = async (profileName: string, gosToken: string, dataContent: any) => {
  try {
    const finalData = JSON.stringify(dataContent)
    const digest = await getSha1HexDigest(finalData)

    const response = await fetch(`https://i.gogingko.net/api/v1/p/profiles/${profileName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gos-token': gosToken,
        'x-gos-digest': digest,
      },
      body: finalData,
    });
    
    if (response.status == 412) {
      isLoginTokenValid.value = true;
      return 'Profile not changed.'
    }
    if (!response.ok) {
        isLoginTokenValid.value = false;
        throw new Error(`Failed to save profile remotely: ${response.status} ${response.statusText}`);
    }
    isLoginTokenValid.value = true;
    
    return await response.json();
  } catch (error) {
    console.error("Error saving profile remotely:", error);
    throw error;
  }
};

const remoteProfiles = ref<string[]>([]);
const selectedRemoteProfileContent = ref("");
const selectedRemoteProfileName = ref("");
const loadingRemoteProfiles = ref(false);

const fetchRemoteProfiles = async () => {
  // use this function to auto check the loginToken
  if (!loginToken.value) return;
  
  profileError.value = "";
  loadingRemoteProfiles.value = true;
  try {
    const response = await fetch(`https://i.gogingko.net/api/v1/zr/profiles?prefix=profile-&k=32`, {
      method: 'GET',
      headers: {
        'x-gos-token': loginToken.value,
      },
    });
    
    if (!response.ok) {
        isLoginTokenValid.value = false;
        throw new Error(`Failed to fetch profiles remotely: ${response.status} ${response.statusText}`);
    }
    const res = await response.json()
    if (res.state == 0) {
      remoteProfiles.value = res.keys.map(item => decodeURIComponent(item));
    }
    isLoginTokenValid.value = true;
  } catch (err) {
    console.error("Error fetching remote profiles:", err);
    profileError.value = err.message || "An error occurred while fetching data";
  } finally {
    loadingRemoteProfiles.value = false;
  }
};

const handleSaveRemote = async (profileName: string) => {
    const data = localStorage.getItem(profileName);
    if (!data) {
        toastMessage.value = "No data found to save.";
        toastType.value = "error";
        return;
    }
    try {
        await saveProfileRemotely(profileName, loginToken.value, JSON.stringify(JSON.parse(data)));
        toastMessage.value = "Profile saved remotely!";
        toastType.value = "success";
        setTimeout(() => { toastMessage.value = ""; }, 3000);
    } catch (e) {
        toastMessage.value = "Failed to save remotely.";
        toastType.value = "error";
        console.error(e);
        setTimeout(() => { toastMessage.value = ""; }, 3000);
    }
}

const viewRemoteProfile = async (profileName: string) => {
    loadingRemoteProfiles.value = true;
    try {
        const response = await fetch(`https://i.gogingko.net/api/v1/v/profiles/${profileName}`, {
            method: 'GET',
        });
        if (!response.ok) throw new Error("Failed to load profile");
        let data = JSON.parse(await response.json());
        if (data.token) {
          // this is a marker of in-completed result, need to fetch the true result.
            try {
              const response = await fetch(`https://i.gogingko.net/api/v1/v/test/${data.token}`, {
                method: 'GET',
              });
              if (!response.ok) {
                throw new Error(`Failed to fetch profiles remotely: token=${data.token} ${response.status}`); 
              } else {
                data = await response.json();
              }
            } catch (err) {
              toastMessage.value = "Failed to load token from remote: " + err.message;
              toastType.value = "error";
              setTimeout(() => { toastMessage.value = ""; }, 3000);
            }
        }
        // Assuming data structure: { reply: "markdown content" }
        selectedRemoteProfileName.value = profileName;
        let jsonData = data.text.split('Here is the context input: ')[1] || '';
        try {
            const parsed = JSON.parse(jsonData);
            if (Array.isArray(parsed)) {
              jsonData = parsed.map(item => `\n---\n# **ID ${item.id}**\n${item.analysis}`).join('\n')
            }
        } catch (e) {
            // Keep original if parsing fails
        }
        selectedRemoteProfileContent.value = md.render(data.reply + '\n---\n# **Inputs >>>>>>>**\n---\n' + jsonData + '');
    } catch(e) {
        console.error(e);
        toastMessage.value = "Failed to load profile.";
        toastType.value = "error";
        setTimeout(() => { toastMessage.value = ""; }, 3000);
    } finally {
        loadingRemoteProfiles.value = false;
    }
}

const loadSavedProfiles = () => {
    const profiles = { channel: [] as string[], user: [] as string[], person: [] as string[] };
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('profile-')) {
        const parts = key.split('-');
        const type = parts[1];
        const name = parts.slice(2).join('-');
        if (type === 'channel' || type === 'user' || type === 'person') {
            profiles[type as 'channel' | 'user' | 'person'].push(name);
        }
      }
    }
    savedProfiles.value = profiles;
}

const viewSavedProfile = async (type: string, name: string) => {
    const data = localStorage.getItem(`profile-${type}-${name}`);
    if (data) {
        const parsed = JSON.parse(data);
        savedProfileName.value = `profile-${type}-${name}`
        if (type == 'person') {
          if (parsed.token) {
            // try to fetch the final result from GOS
            try {
              const response = await fetch(`https://i.gogingko.net/api/v1/v/test/${parsed.token}`, {
                method: 'GET',
              });
              if (!response.ok) {
                savedPersonProfileHtml.value = md.render(`Token ${parsed.token} result not found, please reload later!`);
              } else {
                const fetched = await response.json();
                savedPersonProfileHtml.value = md.render(fetched.reply);
              }
            } catch (err) {
              toastMessage.value = "Failed to load token from remote: " + err.message;
              toastType.value = "error";
              setTimeout(() => { toastMessage.value = ""; }, 3000);
            }
          } else {
            savedPersonProfileHtml.value = md.render(parsed.reply);
          }
          activeTab.value = 'workspace'; // Make sure we are in the right tab or just display it
        } else {
          savedFinalTableHtml.value = md.render(parsed.reply);
          activeTab.value = 'auto-finding'; // Make sure we are in the right tab or just display it
        }
    }
}

const loadSavedGraphRemotely = async () => {
  if (!isLoginTokenValid.value) return;

  try {
    const response = await fetch(`https://i.gogingko.net/api/v1/zr/profiles?prefix=graph-&k=24`, {
      method: 'GET',
      headers: {
        'x-gos-token': loginToken.value,
      },
    });
    
    if (!response.ok) {
        isLoginTokenValid.value = false;
        throw new Error(`Failed to fetch graphs remotely: ${response.status} ${response.statusText}`);
    }
    const res = await response.json()
    if (res.state == 0) {
      savedGraphRemotely.value = res.keys.map(item => decodeURIComponent(item));
    }
    isLoginTokenValid.value = true;
  } catch (err) {
    toastMessage.value = "Failed to load graph from remote: " + err.message;
    toastType.value = "error";
    setTimeout(() => { toastMessage.value = ""; }, 3000);
  } finally {
  }
}

const viewSavedGraphRemotely = async (name: string) => {
  try {
    const response = await fetch(`https://i.gogingko.net/api/v1/v/profiles/${name}`, {
      method: 'GET',
      headers: {
        'x-gos-token': loginToken.value,
      },
    });

    if (!response.ok) {
      isLoginTokenValid.value = false;

      throw new Error(`Failed to fetch graphs remotely: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (workspaceGraph.value) {
      const parsedData = JSON.parse(data);
      delete parsedData.style;
      workspaceGraph.value.elements().remove();
      workspaceGraph.value.json(parsedData);
      applyGraphStyle(); // Apply styles to newly loaded graph
      //workspaceGraph.value.json(JSON.parse(data));
      toastMessage.value = 'Graph loaded remotely.';
      toastType.value = 'success';
      setTimeout(() => { toastMessage.value = ""; }, 3000);
    }
  } catch (err) {
    toastMessage.value = "Failed to load graph to canvas: " + err.message;
    toastType.value = "error";
    setTimeout(() => { toastMessage.value = ""; }, 3000);
  } finally {
  } 
}

const searchChannel = async () => {
  if (!channelName.value.trim()) return;

  if (explorerTab.value) {
    explorerMinHeight.value = `${explorerTab.value.clientHeight}px`;
  }

  isInputFocused.value = false;
  loading.value = true;
  error.value = "";
  metadata.value = null;
  posts.value = [];
  forwardsChannels.value = [];
  hasMorePosts.value = true;
  suggestedChannels.value = [];
  
  let name = channelName.value.trim().replace(/^@/, "");
  let binit = null;
  if (name.includes('?b=')) {
    binit = name.split('?b=')[1]
    name = name.split('?b=')[0]
  }
  
  currentChannelName.value = name;
  addToLastVisited(name);

  try {
    let metaRes = await fetch(
      `https://i.gogingko.net/api/v1/v/telegram-channel/${name}`
    );
    // need to check if it is private channel id if 404
    if (metaRes.status === 404 && name.startsWith('-100')) {
      metaRes = await fetch(
        `https://i.gogingko.net/api/v1/v/telegram-channel/${name.slice(4)}`
      );
    }
    // try to lookup the resolve cache
    if (metaRes.status === 404) {
      const resolveRes = await fetch(`https://i.gogingko.net/api/v1/z/test2/dict_tg_resolve/${name}`)
      if (resolveRes.ok) {
        const data = await resolveRes.json()
        if (data.state == 0 && data.gso?.result) {
          name = data.gso.result
          currentChannelName.value = name
          metaRes = await fetch(
            `https://i.gogingko.net/api/v1/v/telegram-channel/${name}`
          );
        }
      }
    }
    if (metaRes.status === 404) {
      const fallbackRes = await fetch(
        `https://i.gogingko.net/api/v1/zr/telegram-channel?prefix=${encodeURIComponent(
          name
        )}&k=24`
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

    let metaData = await metaRes.json();
    const match = String(metaData.photo).match(/cdn(\d+)/);
    if (match) {
        metaData.cdnNumber = match[1];
        metaData.cdnRegion = TelegramCDNRegions[metaData.cdnNumber as keyof typeof TelegramCDNRegions];
    }
    metadata.value = metaData;

    try {
      const profileRes = await fetch(`https://i.gogingko.net/api/v1/v/profiles/CG-${name}`);
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        forwardsChannels.value = profileData.forwards || [];
      }
    } catch (e) {
      console.error("Failed to fetch forwards", e);
    }

    let postsRes = await fetch(
      binit ? `https://i.gogingko.net/api/v1/last/${name}?n=25&b=${binit}` : `https://i.gogingko.net/api/v1/last/${name}?n=25`
    );

    if (postsRes.ok) {
      let postsData = await postsRes.json();
      if (postsData.length === 0) {
        // check resolve cache
        const resolveRes = await fetch(`https://i.gogingko.net/api/v1/z/test2/dict_tg_resolve/${name}`)
        if (resolveRes.ok) {
          const data = await resolveRes.json()
          if (data.state == 0 && data.gso?.result) {
            name = data.gso.result
            currentChannelName.value = name
            postsRes = await fetch(
              `https://i.gogingko.net/api/v1/last/${name}?n=25`
            );
            if (postsRes.ok) {
              postsData = await postsRes.json();
            }
          }
        }
      }
      // need to reset the selectedUsernamesExplorer
      selectedUsernamesExplorer.value = []
      posts.value = Array.isArray(postsData)
        ? postsData
        : postsData.data || postsData.posts || postsData.items || [];
    }
  } catch (err: any) {
    error.value = err.message || "An error occurred while fetching data";
  } finally {
    loading.value = false;
    nextTick(() => {
      explorerMinHeight.value = "0px";
    });
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
  let isUserSelected = false;
  const fieldQueries = selectedFields.map((field) => {
    const wordQueries = words
      .map((word) => {
        // Escape internal double quotes
        const escapedWord = word.replace(/"/g, '\\"');

        // Use wildcard format for 'user' field, otherwise use double quotes
        if (field === "user") {
          isUserSelected = true
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

    // check if we should load user profile
    if (isUserSelected) {
      await fetchUserProfile(globalSearchQuery.value.trim())
    }
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
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' fill='%232AABEE'/%3E%3Cpath fill='%23fff' d='M5.265 11.735l11.953-4.606c.553-.206 1.034.13.844.975l-2.02 9.516c-.15.676-.554.843-1.116.528l-3.085-2.274-1.488 1.433c-.165.165-.303.303-.62.303l.22-3.15 5.734-5.18c.25-.223-.054-.346-.387-.123l-7.09 4.466-3.054-.954c-.664-.208-.678-.664.14-.984z'/%3E%3C/svg%3E";

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

  let numericId = parseInt(lastPostId.includes(".")
    ? lastPostId.split(".")[1]
    : lastPostId);

  while (numericId > 1) {
    try {
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
          if (numericId - 50 > 0) {
            numericId -= 50;
            continue;
          }
          hasMorePosts.value = false;
        } else {
          posts.value = [...posts.value, ...newPosts];
        }
        break;
      } else {
        hasMorePosts.value = false;
      }
    } catch (err) {
      console.error("Error loading more posts:", err);
      hasMorePosts.value = false;
    }
  }
  isLoadingMore.value = false;
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

const colors = ['blue', 'red', 'green', 'purple', 'indigo', 'emerald', 'rose', 'cyan'];

const getColorFromSeed = (seed) => {
  const hash = String(seed).split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  // Use the absolute hash value to pick an index
  return colors[Math.abs(hash) % colors.length];
};

const timelineData = computed(() => {
    if (!workspaceGraph.value) return [];
    
    const edges = workspaceGraph.value.edges();
    const result: any[] = [];
    
    edges.forEach((edge: any) => {
        if (edge.data('label') === 'post in') {
            const facts = edge.data('facts') || '';
            const postDateLine = facts.split('\n').find((l: string) => l.startsWith('post date:'));
            
            if (postDateLine) {
                const dateStr = postDateLine.replace('post date:', '').trim();
                let start, end;
                
                if (dateStr.includes(' to ')) {
                    const [s, e] = dateStr.split(' to ');
                    start = new Date(s);
                    end = new Date(e);
                } else {
                    start = new Date(dateStr);
                    end = start;
                }
                
                if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                    result.push({
                        id: edge.id(),
                        source: edge.source().id(),
                        start: start.getTime(),
                        end: end.getTime(),
                        color: `bg-${getColorFromSeed(edge.source().id())}-700`
                    });
                }
            }
        } else if (edge.data('label') === 'channel') {
          const facts = edge.data('facts') || '';
            const postDateLine = facts.split('\n').find((l: string) => l.startsWith('post date:'));
            
            if (postDateLine) {
                const dateStr = postDateLine.replace('post date:', '').trim();
                let start, end;
                
                if (dateStr.includes(' to ')) {
                    const [s, e] = dateStr.split(' to ');
                    start = new Date(s);
                    end = new Date(e);
                } else {
                    start = new Date(dateStr);
                    end = start;
                }
                
                if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                    result.push({
                        id: edge.id(),
                        source: edge.target().id(),
                        start: start.getTime(),
                        end: end.getTime(),
                        color: `bg-${getColorFromSeed(edge.target().id())}-700`
                    });
                }
            }
        }
    });
    return result;
});

const timelineRange = computed(() => {
    if (timelineData.value.length === 0) return { min: 0, max: 1 };
    const starts = timelineData.value.map(d => d.start);
    const ends = timelineData.value.map(d => d.end);
    const min = Math.min(...starts, ...ends);
    const max = Math.max(...starts, ...ends);
    // Add buffer for "all available" view (expanded for better panning)
    const buffer = (max - min) * 0.05 || 86400000; // default 1 day buffer
    return {
        min: min - buffer,
        max: max + buffer
    };
});

const timelineRows = computed(() => {
    const data = timelineData.value.sort((a,b) => a.start - b.start);
    const rows: any[][] = [];
    
    for (const item of data) {
        let rowIdx = 0;
        while(rowIdx < rows.length) {
            // Check overlaps
            if (!rows[rowIdx].some(existing => item.start < existing.end && item.end > existing.start)) {
                break;
            }
            rowIdx++;
        }
        if (rowIdx === rows.length) rows.push([]);
        rows[rowIdx].push({...item, row: rowIdx});
    }
    return rows;
});

const zoomLevel = ref(1);
const hoveredItem = ref<any>(null);
const timelineContainer = ref<HTMLElement | null>(null);
const isTimelineDragging = ref(false);
const panOffset = ref(0);
let startX = 0;
let startPanOffset = 0;

const onTimelineWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!timelineContainer.value) return;

    const oldZoom = zoomLevel.value;
    const rect = timelineContainer.value.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    
    const sensitivity = 0.001;
    const delta = -e.deltaY;
    const newZoom = Math.max(0.5, Math.min(100, oldZoom + delta * sensitivity));
    
    zoomLevel.value = newZoom;
    
    // Update panOffset to keep timestamp constant
    panOffset.value = (mouseX + panOffset.value) * (newZoom / oldZoom) - mouseX;
};

const resetZoom = () => {
    zoomLevel.value = 1;
    panOffset.value = 0;
};

const onTimelineMouseDown = (e: MouseEvent) => {
    isTimelineDragging.value = true;
    startX = e.pageX;
    startPanOffset = panOffset.value;
};

const onTimelineMouseMove = (e: MouseEvent) => {
    if (!isTimelineDragging.value) return;
    const dx = e.pageX - startX;
    panOffset.value = startPanOffset - dx;
};

const onTimelineMouseUp = () => { isTimelineDragging.value = false; };
const onTimelineMouseLeave = () => { isTimelineDragging.value = false; };

const focusNode = (nodeId: string) => {
    if (!workspaceGraph.value) return;
    const node = workspaceGraph.value.getElementById(nodeId);
    if (node.length > 0) {
        workspaceGraph.value.animate({
            center: { eles: node },
            zoom: 2
        });
        selectedNode.value = node;
        activeTab.value = 'workspace';

        // Highlight logic
        node.style({
            'border-width': '4px',
            'border-color': '#2563eb', // Tailwind blue-600
            'border-style': 'solid'
        });
        
        // After 5 seconds, remove the style overrides
        setTimeout(() => {
            if (!node || node.removed()) return; // node might be deleted in the meantime
            node.removeStyle('border-width');
            node.removeStyle('border-color');
            node.removeStyle('border-style');
        }, 5000);
    }
};

const timelineTicks = computed(() => {
    const { min, max } = timelineRange.value;
    const span = max - min;
    const containerWidth = timelineContainer.value?.clientWidth || 1000;
    
    // Target approx 1 tick per 70 pixels to keep it readable.
    const targetTickCount = Math.max(2, Math.floor(containerWidth / 70));
    
    // Time interval that gives approx the targetTickCount in visible span
    const visibleSpan = span / Math.max(1, zoomLevel.value);
    const interval = visibleSpan / targetTickCount;

    // Nearest "nice" interval
    const ONE_MINUTE = 60000;
    const ONE_HOUR = 60 * ONE_MINUTE;
    const ONE_DAY = 24 * ONE_HOUR;
    const ONE_WEEK = 7 * ONE_DAY;
    const ONE_MONTH = 30 * ONE_DAY;
    const ONE_YEAR = 365 * ONE_DAY;

    const niceIntervals = [
        1000, 5000, 10000, 30000, // 1s, 5s, 10s, 30s
        ONE_MINUTE, 5 * ONE_MINUTE, 15 * ONE_MINUTE, 30 * ONE_MINUTE, // 1m, 5m, 15m, 30m
        ONE_HOUR, 2 * ONE_HOUR, 4 * ONE_HOUR, 6 * ONE_HOUR, 12 * ONE_HOUR, // 1h, 2h, ...
        ONE_DAY, // 1d
        ONE_WEEK, // 1w
        ONE_MONTH, // 1m
        ONE_YEAR // 1y
    ];
    const bestInterval = niceIntervals.find(i => i >= interval) || niceIntervals[niceIntervals.length - 1];

    const ticks = [];
    
    // Start tick at the first major interval after min
    let current = Math.ceil(min / bestInterval) * bestInterval;
    
    while (current <= max) {
        const date = new Date(current);
        let label = '';
        if (bestInterval < ONE_MINUTE) {
            label = date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'});
        } else if (bestInterval < ONE_HOUR) {
            label = date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
        } else if (bestInterval < ONE_DAY) {
            label = date.toLocaleString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
        } else if (bestInterval < ONE_MONTH) {
            label = date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
        } else if (bestInterval < ONE_YEAR) {
            label = date.toLocaleDateString(undefined, {month: 'short', year: 'numeric'});
        } else {
            label = date.toLocaleDateString(undefined, {year: 'numeric'});
        }
        
        ticks.push({
            time: current,
            position: ((current - min) / span) * 100,
            label
        });
        current += bestInterval;
    }
    
    return ticks;
});
</script>

<template>
  <div
    class="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-200"
  >
    <div class="max-w-[98%] mx-auto p-4 sm:p-6 lg:p-8 xl:p-10">

      <!-- Analysis Button -->
      <button
        v-if="
          (activeTab === 'explorer' && posts.length > 0) ||
          (activeTab === 'search' && searchResults.length > 0)
        "
        @mousedown="startLongPressInSummarize"
        @mouseup="endLongPressInSummarize"
        @mouseleave="cancelLongPressInSummarize"
        @touchstart="startLongPressInSummarize"
        @touchend="endLongPressInSummarize"
        :disabled="isAnalyzing || isSummarizing"
        class="fixed bottom-24 right-8 z-50 p-4 rounded-full bg-blue-600/90 dark:bg-blue-500/90 backdrop-blur-lg border border-blue-400 dark:border-blue-600 shadow-xl text-white hover:scale-110 transition-all duration-300 hover:shadow-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Analyze posts"
        :title="isAnalyzing ? 'Analyzing...' : (isSummarizing ? 'Summarizing...' : 'Click to Analyze, Long Press for Options')"
      >
        <Loader2 v-if="isAnalyzing || isSummarizing" class="h-6 w-6 animate-spin" />
        <BotMessageSquare v-else class="h-6 w-6" />
      </button>

      <!-- Popup Menu -->
      <div v-if="isSummarizeMenuVisible" @click="isSummarizeMenuVisible = false" class="fixed inset-0 z-[55]"></div>
      <div v-if="isSummarizeMenuVisible" class="fixed bottom-40 right-8 z-[60] bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-40 overflow-hidden">
          <button @click="summarizeAndClose" class="w-full text-left px-4 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700">Summarize</button>
          <button @click="openFreeAskAndClose" class="w-full text-left px-4 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white">Free Ask</button>
      </div>

      <!-- Chat Widget -->
      <div v-if="isChatWidgetVisible" 
           :style="{ top: `${widgetPosition.top}px`, left: `${widgetPosition.left}px`, width: `${widgetSize.width}px`, height: `${widgetSize.height}px` }"
           class="fixed z-[70] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
          <!-- Chat Header -->
          <div @mousedown="startChatDrag" class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900 cursor-move">
              <h3 class="font-bold text-gray-900 dark:text-gray-100">Free Ask</h3>
              <button @click="isChatWidgetVisible = false" class="text-gray-500 hover:text-red-500"><X class="h-4 w-4" /></button>
          </div>
          <!-- Chat Content -->
          <div class="flex-grow p-4 overflow-y-auto text-gray-900 dark:text-white text-sm space-y-3">
             <div v-for="(msg, index) in chatMessages" :key="index" :class="msg.role === 'user' ? 'text-right' : 'text-left'">
                 <div :class="msg.role === 'user' ? 'bg-blue-100 dark:bg-blue-900 p-2 rounded-lg inline-block' : 'prose prose-sm dark:prose-invert'">
                     <div v-html="md.render(msg.content)"></div>
                 </div>
             </div>
             <div v-if="isChatLoading" class="text-gray-500 text-xs italic flex items-center gap-2">
                 <Loader2 class="h-4 w-4 animate-spin" /> AI is thinking...
             </div>
          </div>
          <!-- Input -->
          <div class="p-4 border-t border-gray-200 dark:border-gray-700">
              <input type="text" v-model="chatInput" @keyup.enter="handleChatSubmit" placeholder="Ask anything..." class="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 dark:text-white" :disabled="isChatLoading" />
          </div>
          <!-- Resize Handle -->
          <div @mousedown="startChatResize" class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize bg-gray-300 dark:bg-gray-600 rounded-tl-lg"></div>
      </div>

      <button
        v-if="
          (activeTab === 'auto-finding')
        "
        @click="isPostFetcherVisible = !isPostFetcherVisible"
        class="fixed bottom-24 right-8 z-50 p-4 rounded-full bg-purple-600/90 dark:bg-purple-500/90 backdrop-blur-lg border border-purple-400 dark:border-purple-600 shadow-xl text-white hover:scale-110 transition-all duration-300 hover:shadow-purple-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <PanelRightOpen v-if="!isPostFetcherVisible" class="w-6 h-6" />
        <PanelRightClose v-else class="w-6 h-6" />
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

      <!-- Title & Counters (non-sticky) -->
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
          class="flex flex-wrap items-center justify-center gap-1.5 mb-8 max-w-4xl mx-auto px-4"
        >
          <div
            v-for="(count, type) in counters"
            :key="type"
            class="inline-flex items-center gap-1.5 px-3 py-1 bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm rounded-full border border-gray-150/40 dark:border-gray-700/40 text-[11px]"
          >
            <span class="font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider text-[9px]">
              {{ type }}
            </span>
            <span class="font-extrabold text-teal-600 dark:text-teal-400 font-mono tracking-tight tabular-nums">
              {{ count.toLocaleString() }}
            </span>
            <span
              v-if="frequencies[type] !== undefined"
              class="text-[9px] text-gray-400 dark:text-gray-500 font-mono opacity-80"
            >
              ({{ frequencies[type].toFixed(1) }}/s)
            </span>
          </div>
          
          <button
            @click="activeTab = 'monitor'"
            class="inline-flex items-center gap-1 px-3 py-1 bg-pink-50/50 dark:bg-pink-950/20 text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-950/40 rounded-full border border-pink-100/50 dark:border-pink-900/20 transition-all font-bold hover:scale-105 text-[10px] uppercase tracking-wider cursor-pointer"
          >
            <Activity class="h-3 w-3 animate-pulse text-pink-500" />
            <span>Monitor Engine</span>
          </button>
        </div>
      </div>

      <!-- Sticky Navigation Header -->
      <header
        class="sticky top-0 z-50 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur-md mb-12 relative flex items-center justify-center border-b border-gray-200 dark:border-gray-800 py-3"
      >
        <div class="absolute right-4 z-50 flex items-center space-x-2">
          <button
            @click="showLoginModal = true"
            class="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900 border border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition shadow-sm"
            aria-label="Access Tokens"
          >
            <User class="h-5 w-5" />
          </button>
          <button
            @click="toggleDark"
            class="p-2.5 rounded-full bg-white/50 dark:bg-gray-800/50 backdrop-blur-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 hover:shadow-md"
            aria-label="Toggle dark mode"
          >
            <Moon v-if="!isDark" class="h-4 w-4" />
            <Sun v-else class="h-4 w-4" />
          </button>
        </div>

        <!-- Login Modal -->
        <div v-if="showLoginModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
           <div class="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-2xl border border-gray-200 dark:border-gray-700">
               <h2 class="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">Access Tokens</h2>
               <input v-model="loginName" placeholder="User Name" class="w-full mb-3 p-2 border border-gray-300 rounded dark:bg-gray-900" />
               <input v-model="loginToken" type="password" placeholder="Access Token" class="w-full mb-4 p-2 border border-gray-300 rounded dark:bg-gray-900" />
               <div class="flex justify-end gap-2">
                   <button @click="showLoginModal = false" class="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">Cancel</button>
                   <button @click="saveLogin" class="px-4 py-2 bg-blue-600 text-white rounded">Save</button>
               </div>
           </div>
        </div>

        <!-- Glass Tabs -->
        <div
          class="inline-flex bg-gray-200/50 dark:bg-gray-800/50 p-1.5 rounded-2xl backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 shadow-inner"
        >
          <button
            @click="activeTab = 'channel'"
            :class="[
              'px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center',
              activeTab === 'channel'
                ? 'bg-white dark:bg-gray-700 text-yellow-600 dark:text-yellow-400 shadow-md shadow-yellow-500/5 ring-1 ring-gray-900/5 dark:ring-white/5'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
            ]"
          >
            <Library
              :class="[
                'h-4 w-4 mr-2 transition-transform duration-300',
                activeTab === 'channel' ? 'scale-110' : '',
              ]"
            />
            Channels
          </button>
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
            Explorer
          </button>
          <button
            @click="activeTab = 'search'"
            :class="[
              'px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center',
              activeTab === 'search'
                ? 'bg-white dark:bg-gray-700 text-cyan-600 dark:text-cyan-400 shadow-md shadow-cyan-500/5 ring-1 ring-gray-900/5 dark:ring-white/5'
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
            @click="activeTab = 'listen'"
            :class="[
              'px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center',
              activeTab === 'listen'
                ? 'bg-white dark:bg-gray-700 text-teal-600 dark:text-teal-400 shadow-md shadow-teal-500/5 ring-1 ring-gray-900/5 dark:ring-white/5'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
            ]"
          >
            <Radio
              :class="[
                'h-4 w-4 mr-2 transition-transform duration-300',
                activeTab === 'listen' ? 'scale-110' : '',
              ]"
            />
            Listen
          </button>
          <button
            @click="activeTab = 'auto-finding'"
            :class="[
              'px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center',
              activeTab === 'auto-finding'
                ? 'bg-white dark:bg-gray-700 text-green-600 dark:text-green-400 shadow-md shadow-green-500/5 ring-1 ring-gray-900/5 dark:ring-white/5'
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
          <button
            @click="activeTab = 'workspace'"
            :class="[
              'px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center',
              activeTab === 'workspace'
                ? 'bg-white dark:bg-gray-700 text-purple-600 dark:text-purple-400 shadow-md shadow-purple-500/5 ring-1 ring-gray-900/5 dark:ring-white/5'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
            ]"
          >
            <Layers
              :class="[
                'h-4 w-4 mr-2 transition-transform duration-300',
                activeTab === 'workspace' ? 'scale-110' : '',
              ]"
            />
            Workspace
          </button>
          <button
            v-show="loginToken"
            @click="activeTab = 'profile'"
            :class="[
              'px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center',
              activeTab === 'profile'
                ? 'bg-white dark:bg-gray-700 text-orange-600 dark:text-orange-400 shadow-md shadow-orange-500/5 ring-1 ring-gray-900/5 dark:ring-white/5'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
            ]"
          >
            <Layers
              :class="[
                'h-4 w-4 mr-2 transition-transform duration-300',
                activeTab === 'profile' ? 'scale-110' : '',
              ]"
            />
            Profiles
          </button>
          <button
            @click="activeTab = 'monitor'"
            :class="[
              'px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center justify-center',
              activeTab === 'monitor'
                ? 'bg-white dark:bg-gray-700 text-pink-600 dark:text-pink-400 shadow-md shadow-pink-500/5 ring-1 ring-gray-900/5 dark:ring-white/5'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
            ]"
          >
            <Activity
              :class="[
                'h-4 w-4 mr-2 transition-transform duration-300',
                activeTab === 'monitor' ? 'scale-110' : '',
              ]"
            />
            Monitor
          </button>
        </div>
      </header>

      <!-- Channel Tab -->
      <div v-show="activeTab === 'channel'" class="max-w-[96rem] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pt-1 pb-16 space-y-8">
        <!-- Control Bar Card -->
        <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-750 p-6 shadow-sm relative overflow-hidden">
          <!-- Ambient highlights -->
          <div class="absolute -top-16 -right-16 w-32 h-32 bg-teal-500/5 dark:bg-teal-500/10 rounded-full blur-2xl pointer-events-none"></div>
          <div class="absolute -bottom-16 -left-16 w-32 h-32 bg-indigo-500/5 dark:bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>

          <div class="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <!-- Left: Beautiful Tab Switches -->
            <div class="space-y-2.5">
              <label class="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Metadata Directory</label>
              <div class="flex items-center gap-1.5 bg-gray-50/80 dark:bg-gray-900 border border-gray-150/80 dark:border-gray-850 p-1 rounded-2xl w-full sm:w-80">
                <button 
                  @click="activeChannelOrUser = 'channel'; fetchChannels(false)"
                  :class="[
                    'flex-1 py-2 text-xs font-black rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer',
                    activeChannelOrUser === 'channel'
                      ? 'bg-teal-600 text-white shadow-md shadow-teal-500/10'
                      : 'text-gray-450 hover:text-gray-650 dark:text-gray-400 dark:hover:text-gray-250'
                  ]"
                >
                  <Hash class="h-3.5 w-3.5" />
                  Channels
                </button>
                <button 
                  @click="activeChannelOrUser = 'user'; fetchChannels(false)"
                  :class="[
                    'flex-1 py-2 text-xs font-black rounded-xl transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer',
                    activeChannelOrUser === 'user'
                      ? 'bg-teal-600 text-white shadow-md shadow-teal-500/10'
                      : 'text-gray-450 hover:text-gray-650 dark:text-gray-400 dark:hover:text-gray-250'
                  ]"
                >
                  <User class="h-3.5 w-3.5" />
                  Users
                </button>
              </div>
            </div>

            <!-- Right: Interactive Filters & Batches -->
            <div class="flex flex-wrap items-end gap-4">
              <!-- Language Filter input -->
              <div v-if="activeChannelOrUser === 'channel'" class="space-y-2.5">
                <label class="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Language Target</label>
                <div class="relative flex items-center bg-gray-50 dark:bg-gray-900 border border-gray-150 dark:border-gray-850 rounded-2xl px-4 py-2 shadow-sm focus-within:ring-2 focus-within:ring-teal-500/20 focus-within:border-teal-500 transition-all w-full sm:w-56">
                  <Globe class="h-4 w-4 text-teal-600 dark:text-teal-400 mr-2 shrink-0" />
                  <input 
                    v-model="langCode" 
                    placeholder="e.g. zh-CN, en, ru" 
                    class="bg-transparent text-xs font-semibold outline-none text-gray-900 dark:text-white placeholder-gray-400 w-full" 
                    @keyup.enter="handleLangFetch" 
                  />
                  <!-- Animated flag -->
                  <span v-if="computedFlag" class="absolute right-3 inline-block text-sm transition-transform duration-300 hover:scale-125 select-none" :title="'Language Flag for: ' + langCode">
                    {{ computedFlag }}
                  </span>
                </div>
              </div>

              <!-- Refetch / Next Batch Button -->
              <div class="space-y-2.5 w-full sm:w-auto">
                <label class="hidden sm:block text-[10px] font-black text-transparent select-none uppercase tracking-widest">Action</label>
                <button 
                  @click="(activeChannelOrUser === 'channel' && langCode) ? handleLangFetch() : fetchChannels(true)"
                  class="w-full sm:w-auto px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl text-xs font-black tracking-wide flex items-center justify-center gap-2 shadow-md shadow-teal-500/25 hover:shadow-teal-500/40 cursor-pointer transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
                >
                  <RefreshCw class="h-3.5 w-3.5 shrink-0" :class="[isLoadingChannels ? 'animate-spin' : '']" />
                  <span>{{ (activeChannelOrUser === 'channel' && langCode) ? 'Apply Lang Filter' : 'Fetch Next Batch' }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Loading Registry State -->
        <div v-if="isLoadingChannels" class="flex flex-col items-center justify-center py-32 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-750/60 shadow-sm relative overflow-hidden">
          <div class="relative flex items-center justify-center mb-6">
            <div class="absolute w-16 h-16 rounded-full bg-teal-500/10 animate-ping"></div>
            <div class="relative h-12 w-12 animate-spin rounded-full border-[3px] border-teal-500 border-t-transparent flex items-center justify-center shadow-md">
              <Bot class="h-5 w-5 text-teal-650 dark:text-teal-400 animate-pulse" />
            </div>
          </div>
          <p class="text-xs font-black uppercase tracking-widest text-teal-600 dark:text-teal-400">Synthesizing Archive Registry...</p>
          <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-2 font-semibold">Downloading profiles and parsing CDN routing metadata...</p>
        </div>

        <!-- Empty Directory State -->
        <div v-else-if="channels.length === 0" class="text-center py-20 bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-750/60 p-8 shadow-sm max-w-md mx-auto my-12">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-50 dark:bg-teal-950/40 mb-4 shadow-inner border border-teal-100/20">
            <Bot class="h-8 w-8 text-teal-500" />
          </div>
          <h3 class="text-xs font-black text-gray-900 dark:text-white uppercase tracking-wider mb-2">No Profiles Available</h3>
          <p class="text-xs text-gray-400 dark:text-gray-500 font-semibold leading-relaxed">
            We couldn't retrieve any profiles for this selection. Try updating your language code or fetch a new random batch.
          </p>
        </div>

        <!-- Directory Cards Grid -->
        <div v-else class="columns-1 md:columns-2 lg:columns-3 xl:columns-4 gap-6">
          <div v-for="channel in channels" :key="channel.name"
               class="break-inside-avoid bg-white dark:bg-gray-800 p-5 rounded-3xl border border-gray-200/75 dark:border-gray-750 shadow-sm hover:shadow-xl hover:border-teal-500/20 dark:hover:border-teal-500/15 transition-all duration-300 mb-6 relative overflow-hidden group">
            <!-- Subtle Hover Gradient Accent -->
            <div class="absolute -right-12 -top-12 w-24 h-24 bg-teal-500/[0.03] dark:bg-teal-500/[0.04] rounded-full blur-xl group-hover:scale-150 transition-transform duration-500 pointer-events-none"></div>

            <div class="flex items-center gap-4 mb-4 relative z-10">
              <!-- Avatar Circle Container -->
              <div class="relative shrink-0 select-none">
                <img 
                  :src="'https://i.gogingko.net/api/v1/v/telegram-profile/' + (channel.id || channel.username || channel.name)" 
                  @error="handleImageError"
                  class="w-12 h-12 rounded-2xl border-2 border-teal-500/10 dark:border-teal-500/20 object-cover shadow-sm bg-gray-50 dark:bg-gray-900 group-hover:border-teal-500/40 transition-colors duration-300" 
                  alt="Avatar"
                />
                <!-- Type-specific badge indicator bottom right of avatar -->
                <span class="absolute -bottom-1 -right-1 p-1 rounded-lg text-white bg-teal-600 border border-white dark:border-gray-800 shadow-sm flex items-center justify-center">
                  <component :is="activeChannelOrUser === 'channel' ? (channel._type === 'snscrape.modules.telegram.TelegramChannel' ? Hash : channel._type === 'snscrape.modules.telegram.TelegramGroup' ? Users : User) : User" class="h-2.5 w-2.5 text-white" />
                </span>
              </div>

              <!-- Metadata content -->
              <div class="flex-grow min-w-0 pr-4">
                <h3 class="text-xs font-black text-gray-900 truncate dark:text-white group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors duration-300" :title="channel.title || channel.name || (channel.first_name ? channel.first_name : '') + (channel.last_name ? ' ' + channel.last_name : '')">
                  {{ channel.title || channel.name || (channel.first_name ? channel.first_name : '') + (channel.last_name ? ' ' + channel.last_name : '')}}
                </h3>
                <p v-if="channel.username || channel.id" class="text-[10px] font-bold text-gray-400 dark:text-gray-500 truncate mt-0.5 flex items-center gap-1.5">
                  <span v-if="channel.username">@{{ channel.username }}</span>
                  <span v-if="channel.username && channel.id" class="opacity-60">•</span>
                  <span v-if="channel.id" class="font-mono">ID: {{ channel.id }}</span>
                </p>
              </div>

              <!-- Right badges aligned -->
              <div class="absolute top-0 right-0 z-15">
                <span v-if="channel.bot !== undefined" :class="['text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-lg border shadow-sm shrink-0', channel.bot ? 'bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400 border-emerald-500/10' : 'bg-rose-500/[0.06] text-rose-600 dark:text-rose-400 border-rose-500/10']">
                  {{ channel.bot ? 'Bot' : 'User' }}
                </span>
              </div>
            </div>

            <!-- Description with clamping -->
            <p v-if="channel.description || channel.about" class="text-[11px] text-gray-500 dark:text-gray-400 mb-4 leading-relaxed whitespace-pre-wrap break-words overflow-hidden line-clamp-3 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors">
              {{ channel.description || channel.about }}
            </p>

            <!-- Status badges -->
            <div class="flex flex-wrap gap-2 mb-3 z-10 relative">
              <span v-if="channel.status && channel.status.status" class="text-[9px] font-bold text-teal-600 dark:text-teal-400 bg-teal-500/[0.05] border border-teal-500/10 px-2 py-0.5 rounded-lg max-w-full truncate">{{ channel.status.status }}</span>
              <span v-if="channel.phone" class="text-[9px] font-bold text-rose-600 dark:text-rose-400 bg-rose-500/[0.05] border border-rose-500/10 px-2 py-0.5 rounded-lg max-w-full truncate">{{ channel.phone }}</span>
            </div>
            
            <!-- Metric tags board -->
            <div v-if="channel.members || channel.files || channel.photos || channel.videos" class="grid grid-cols-2 gap-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 mb-4 pt-3 border-t border-gray-100/50 dark:border-gray-800/30">
              <span v-if="channel.members" class="flex items-center gap-1.5 bg-gray-50/50 dark:bg-gray-900/20 px-2.5 py-1.5 rounded-xl border border-gray-150/40 dark:border-gray-800/30"><Users class="h-3 w-3 text-teal-650" /> {{ channel.members }}</span>
              <span v-if="channel.files" class="flex items-center gap-1.5 bg-gray-50/50 dark:bg-gray-900/20 px-2.5 py-1.5 rounded-xl border border-gray-150/40 dark:border-gray-800/30"><FileText class="h-3 w-3 text-teal-650" /> {{ channel.files }}</span>
              <span v-if="channel.photos" class="flex items-center gap-1.5 bg-gray-50/50 dark:bg-gray-900/20 px-2.5 py-1.5 rounded-xl border border-gray-150/40 dark:border-gray-800/30"><ImageIcon class="h-3 w-3 text-teal-650" /> {{ channel.photos }}</span>
              <span v-if="channel.videos" class="flex items-center gap-1.5 bg-gray-50/50 dark:bg-gray-900/20 px-2.5 py-1.5 rounded-xl border border-gray-150/40 dark:border-gray-800/30"><Video class="h-3 w-3 text-teal-650" /> {{ channel.videos }}</span>
            </div>

            <!-- DC Chip Badge -->
            <div v-if="channel.cdnNumber" class="text-[9px] font-mono font-black uppercase tracking-wider text-teal-650 dark:text-teal-400 bg-teal-500/[0.04] dark:bg-teal-950/40 px-2 py-0.5 rounded-lg border border-teal-500/10 mb-4 inline-flex items-center gap-1">
              <span>DC: {{ channel.cdnNumber }}</span>
              <span v-if="channel.cdnRegion" class="opacity-70">({{ channel.cdnRegion[1] }})</span>
            </div>

            <!-- View Action button -->
            <button 
              v-if="activeChannelOrUser === 'channel'" 
              @click="activeTab = 'explorer'; channelName = channel.username || channel.name; searchChannel()" 
              class="w-full mt-2 py-2 bg-gray-50 hover:bg-teal-650 text-teal-600 hover:text-white dark:bg-gray-900/80 dark:hover:bg-teal-600 dark:text-teal-400 dark:hover:text-white text-xs font-black tracking-wide rounded-xl border border-gray-150 dark:border-gray-800/80 hover:border-transparent cursor-pointer transition-all duration-300 hover:shadow-md hover:shadow-teal-500/10 text-center flex items-center justify-center gap-1.5"
            >
              <span>View Channel Archive</span>
              <ExternalLink class="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <!-- Explorer Tab -->
      <div ref="explorerTab" v-show="activeTab === 'explorer'" :style="{ minHeight: explorerMinHeight }">
        <div class="max-w-[95%] mx-auto mb-16 px-4 sm:px-0">
              <form @submit.prevent="searchChannel" class="relative group">
                <div
                  class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none transition-transform duration-300 group-focus-within:scale-110 group-focus-within:text-teal-650 z-10"
                >
                  <Layout class="h-5 w-5 text-gray-400" />
                </div>
                <input
                  v-model="channelName"
                  @focus="isInputFocused = true"
                  @blur="handleBlur"
                  type="text"
                  class="block w-full pl-14 pr-[120px] py-4 border border-gray-200 dark:border-gray-700 rounded-2xl leading-5 bg-white/95 dark:bg-gray-800/95 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-sm font-semibold shadow-sm hover:shadow-md focus:shadow-lg transition-all duration-300"
                  placeholder="Enter channel name (e.g. durov)"
                />
                <button
                  type="submit"
                  @click.prevent="searchChannel"
                  :disabled="loading || !channelName.trim()"
                  @mousedown.prevent
                  class="absolute right-2 top-2 bottom-2 px-6 bg-teal-600 text-white rounded-xl text-xs font-black tracking-wide hover:bg-teal-700 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center shadow-md shadow-teal-500/20 hover:shadow-teal-500/40 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                >
                  <Loader2 v-if="loading" class="h-4 w-4 animate-spin mr-2" />
                  {{ loading ? "Exploring..." : "Explore" }}
                </button>
                
                <!-- Autocomplete Dropdown -->
                <div
                  v-if="isInputFocused && (lastVisitedChannels.length > 0 || suggestedChannels.length > 0)"
                  class="absolute z-50 w-full mt-2 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-250/60 dark:border-gray-700/60 overflow-hidden"
                >
                   <div v-show="isLoginTokenValid && suggestedChannels.length > 0" class="px-4 py-2 text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-gray-900/50">
                     Auto completed
                   </div>
                   <div v-if="isLoginTokenValid && suggestedChannels.length > 0" class="max-h-60 overflow-y-auto">
                     <button
                       v-for="channel in suggestedChannels"
                       :key="channel"
                       class="flex items-center justify-between w-full text-left px-5 py-2.5 hover:bg-teal-50/50 dark:hover:bg-teal-950/20 text-xs font-bold text-gray-700 dark:text-gray-200 transition-colors cursor-pointer"
                     >
                       <span
                         @click.prevent="
                           channelName = channel;
                           isInputFocused = false;
                           searchChannel();
                         "
                         class="flex-1"
                       >
                         @{{ channel }}
                       </span>
                     </button>
                   </div>

                   <div class="px-5 py-2.5 text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-gray-900/50">
                     Last Visited
                   </div>
                   <div class="max-h-60 overflow-y-auto">
                     <div
                       v-for="channel in lastVisitedChannels"
                       :key="channel.name"
                       class="flex items-center justify-between w-full text-left px-5 py-2.5 hover:bg-teal-50/50 dark:hover:bg-teal-950/20 text-xs font-bold text-gray-700 dark:text-gray-200 transition-colors"
                     >
                       <span
                         @click.prevent="
                           channelName = channel.name;
                           isInputFocused = false;
                           searchChannel();
                         "
                         class="flex-1 cursor-pointer"
                       >
                         @{{ channel.name }}
                       </span>
                       <button
                         @click.stop.prevent="removeVisitedChannel(channel.name)"
                         class="ml-2 text-gray-400 hover:text-red-550 cursor-pointer"
                         title="Remove"
                       >
                         <X class="h-3.5 w-3.5" />
                       </button>
                     </div>
                   </div>
                </div>
              </form>

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
              class="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-200/60 dark:border-gray-700/60 overflow-hidden relative"
            >
              <div
                class="h-28 bg-gradient-to-br from-teal-500 via-emerald-600 to-indigo-700 relative overflow-hidden"
              >
                <div
                  class="absolute inset-0 bg-white/5 dark:bg-black/10 backdrop-blur-[2px]"
                ></div>
                <div
                  class="absolute -top-10 -right-10 w-36 h-36 bg-white/20 dark:bg-white/10 rounded-full blur-2xl"
                ></div>
                <div
                  class="absolute -bottom-10 -left-10 w-36 h-36 bg-black/10 dark:bg-black/20 rounded-full blur-2xl"
                ></div>
              </div>
              <div class="px-6 pb-8 pt-10 relative">
                <div
                  class="w-20 h-20 rounded-2xl bg-white dark:bg-gray-800 border-2 border-white dark:border-gray-800 shadow-md absolute -top-10 left-6 flex items-center justify-center overflow-hidden ring-4 ring-teal-500/10"
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
                    class="text-lg font-black text-gray-900 dark:text-white tracking-tight leading-tight mb-1 flex items-center justify-between"
                  >
                    <span>{{ metadata.title || metadata.name }}</span>
                    <component :is="metadata._type === 'snscrape.modules.telegram.TelegramChannel' ? Hash : metadata._type === 'snscrape.modules.telegram.TelegramGroup' ? Users : User" class="h-4 w-4 text-gray-400" />
                  </h2>
                  
                  <p
                    class="text-teal-600 dark:text-teal-400 font-bold text-xs mb-5 flex items-center tracking-wide"
                  >
                    @{{ metadata.username || metadata.name || channelName }}
                    <button @click="addToWorkspace" class="ml-2 flex items-center gap-1 px-1.5 py-0.5 bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-teal-600 dark:text-teal-400 rounded-md border border-gray-200 dark:border-gray-600 text-[9px] font-extrabold transition-all">
                      <Layout class="h-2.5 w-2.5" />
                      Add
                    </button>
                  </p>

                  <div
                    v-if="metadata.description || metadata.about"
                    class="mb-6"
                  >
                    <p
                      class="text-gray-600 dark:text-gray-300 text-xs leading-relaxed whitespace-pre-wrap break-words bg-gray-50/50 dark:bg-gray-900/30 p-4 rounded-2xl border border-gray-150 dark:border-gray-700/60"
                    >
                      {{ metadata.description || metadata.about }}
                    </p>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div
                      v-if="metadata.subscribers || metadata.members || metadata.participants_count"
                      class="bg-gray-50/50 dark:bg-gray-900/10 p-3 rounded-2xl border border-gray-150 dark:border-gray-750 flex flex-col items-center justify-center text-center transition-all hover:-translate-y-0.5 duration-300"
                    >
                      <Users
                        class="h-5 w-5 mb-1.5 text-teal-500"
                      />
                      <span
                        class="text-base font-black text-gray-900 dark:text-white font-mono tracking-tight"
                        >{{
                          (
                            metadata.subscribers || metadata.members || metadata.participants_count
                          ).toLocaleString()
                        }}</span
                      >
                      <span
                        class="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-0.5"
                        >Subscribers</span
                      >
                    </div>

                    <div
                      v-if="metadata.date || metadata.createdAt"
                      class="bg-gray-50/50 dark:bg-gray-900/10 p-3 rounded-2xl border border-gray-150 dark:border-gray-750 flex flex-col items-center justify-center text-center transition-all hover:-translate-y-0.5 duration-300"
                    >
                      <Calendar
                        class="h-5 w-5 mb-1.5 text-indigo-500"
                      />
                      <span
                        class="text-xs font-black text-gray-900 dark:text-white"
                        >{{
                          formatDate(metadata.date || metadata.createdAt)
                        }}</span
                      >
                      <span
                        class="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-0.5"
                        >Created</span
                      >
                    </div>

                    <div
                      v-if="metadata.files"
                      class="bg-gray-50/50 dark:bg-gray-900/10 p-3 rounded-2xl border border-gray-150 dark:border-gray-750 flex flex-col items-center justify-center text-center transition-all hover:-translate-y-0.5 duration-300"
                    >
                      <FileText
                        class="h-5 w-5 mb-1.5 text-amber-500"
                      />
                      <span
                        class="text-base font-black text-gray-900 dark:text-white font-mono tracking-tight"
                        >{{ metadata.files }}</span
                      >
                      <span
                        class="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-0.5"
                        >Files</span
                      >
                    </div>

                    <div
                      v-if="metadata.photos"
                      class="bg-gray-50/50 dark:bg-gray-900/10 p-3 rounded-2xl border border-gray-150 dark:border-gray-750 flex flex-col items-center justify-center text-center transition-all hover:-translate-y-0.5 duration-300"
                    >
                      <ImageIcon
                        class="h-5 w-5 mb-1.5 text-emerald-500"
                      />
                      <span
                        class="text-base font-black text-gray-900 dark:text-white font-mono tracking-tight"
                        >{{ metadata.photos }}</span
                      >
                      <span
                        class="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-0.5"
                        >Photos</span
                      >
                    </div>

                    <div
                      v-if="metadata.videos"
                      class="bg-gray-50/50 dark:bg-gray-900/10 p-3 rounded-2xl border border-gray-150 dark:border-gray-750 flex flex-col items-center justify-center text-center transition-all hover:-translate-y-0.5 duration-300"
                    >
                      <Video
                        class="h-5 w-5 mb-1.5 text-rose-500"
                      />
                      <span
                        class="text-base font-black text-gray-900 dark:text-white font-mono tracking-tight"
                        >{{ metadata.videos }}</span
                      >
                      <span
                        class="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-0.5"
                        >Videos</span
                      >
                    </div>
                  </div>

                  <div
                    v-if="metadata.cdnNumber"
                    class="mt-3 bg-gray-50/50 dark:bg-gray-900/10 p-4 rounded-2xl border border-gray-150 dark:border-gray-750 flex flex-col items-center justify-center text-center"
                  >
                    <span class="text-xs font-black text-gray-700 dark:text-gray-200">
                      {{ 'IDC Center DC: ' + metadata.cdnNumber }} <span v-if="metadata.cdnRegion" class="text-teal-600 dark:text-teal-400">({{ Array.isArray(metadata.cdnRegion) ? metadata.cdnRegion[1] : metadata.cdnRegion }})</span>
                    </span>
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


            <!-- Usernames Widget -->
            <div
              class="space-y-4 h-fit flex-shrink-0"
            >
              <div
                class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-700/60 p-6 shadow-sm"
              >
                <div class="flex justify-between items-center mb-4">
                  <h3 class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    Usernames
                  </h3>
                  <button @click="copyUsernamesToClipboard(allUsernamesExplorer)" class="text-gray-400 hover:text-teal-500 transition-colors">
                    <Copy class="w-4 h-4" />
                  </button>
                </div>
                <div
                  class="max-h-[calc(100vh-15rem)] overflow-y-auto space-y-1.5 pr-2 custom-scrollbar"
                >
                  <button
                    v-for="username in allUsernamesExplorer"
                    :key="username"
                    @click="toggleUsernameExplorer(username)"
                    :class="[
                      'w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex justify-between items-center cursor-pointer',
                      selectedUsernamesExplorer.includes(username)
                        ? 'bg-teal-600 text-white shadow-sm shadow-teal-500/10'
                        : 'bg-gray-50 dark:bg-gray-900 border border-gray-150/40 dark:border-gray-800/40 text-gray-700 dark:text-gray-300 hover:bg-teal-50/50 dark:hover:bg-teal-950/20 hover:text-teal-600 dark:hover:text-teal-400',
                    ]"
                  >
                    <span>{{ username }}</span>
                    <span class="text-[10px] font-mono opacity-80 font-bold bg-white/20 px-1.5 py-0.5 rounded-md">{{ usernamePostCountsExplorer[username] || 0 }}</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Forwards From Widget -->
            <div
              v-show="isProfileVisible && forwardsChannels.length > 0"
              class="mt-6 bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-700/60 p-6 shadow-sm"
            >
              <div class="flex items-center justify-between mb-4 relative">
                <h3
                  class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider"
                >
                  Forwards From
                </h3>
              </div>
              <div class="space-y-1.5 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                <button
                  v-for="channelNameForward in forwardsChannels"
                  :key="channelNameForward"
                  @click="
                    channelName = channelNameForward;
                    searchChannel();
                  "
                  class="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold bg-gray-50 dark:bg-gray-900 text-gray-850 dark:text-gray-200 border border-gray-150/40 dark:border-gray-800/40 hover:bg-teal-50/50 dark:hover:bg-teal-950/20 hover:text-teal-600 dark:hover:text-teal-400 hover:border-teal-100 dark:hover:border-teal-900/40 transition-colors"
                >
                  @{{ channelNameForward }}
                </button>
              </div>
            </div>

            <!-- Profile Widget -->
            <div
              v-show="isProfileVisible && channelProfile"
              class="mt-6 bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-700/60 p-6 shadow-sm"
            >
              <div class="flex items-center justify-between mb-4 relative">
                <h3
                  class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider"
                >
                  Channel Profile
                </h3>
                <span v-if="channelProfileDate" class="text-[9px] font-mono font-bold text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 border border-teal-100/50 dark:border-teal-900/20 px-2 py-0.5 rounded-full">
                    {{ channelProfileDate }}
                </span>
              </div>
              <div v-if="loadingChannelProfile" class="text-xs text-gray-450 animate-pulse">Loading profile...</div>
              <div v-else class="overflow-x-auto">
                <div v-html="channelProfile" class="prose prose-xs text-xs dark:prose-invert"></div>
              </div>
            </div>

            <!-- X Similar Users Widget -->
            <div
              v-show="isProfileVisible"
              class="mt-6 bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-700/60 p-6 sticky top-20 shadow-sm"
            >
              <div class="flex items-center justify-between mb-4 relative">
                <div class="flex items-center gap-2">
                  <h3
                    class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider"
                  >
                    X Similar Users
                  </h3>
                  <div class="group relative inline-block">
                    <Info class="h-4 w-4 text-gray-400 cursor-help" />
                    <div class="absolute -left-2 top-full mt-2 w-48 p-2 bg-gray-900 border border-gray-700 text-white text-[10px] rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 leading-normal">
                      Search for similar users on X to find matching profiles.
                    </div>
                  </div>
                </div>
                <LoaderCircle
                  v-if="isSearchingX"
                  class="h-4 w-4 animate-spin text-teal-500 absolute top-0 -right-1"
                />
              </div>

              <div class="mb-4 flex gap-1.5">
                <input
                  v-model="xSearchInput"
                  @keyup.enter="searchXUser(xSearchInput)"
                  placeholder="Search X users..."
                  class="w-full px-3.5 py-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-150 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all dark:text-gray-100 placeholder:text-gray-400"
                />
                <button
                  @click="searchXUser(xSearchInput)"
                  :disabled="isSearchingX || !xSearchInput.trim()"
                  class="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 flex items-center justify-center min-w-[36px] cursor-pointer"
                >
                  <Search class="h-3.5 w-3.5" />
                </button>
              </div>

              <div
                v-if="xSearchResults.length > 0"
                class="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar"
              >
                <div
                  v-for="user in xSearchResults"
                  :key="user.id"
                  class="p-3 bg-gray-50 dark:bg-gray-900/40 rounded-2xl border border-gray-150/40 dark:border-gray-800/40 space-y-2"
                >
                  <div class="flex items-center gap-2.5">
                    <img
                      v-if="user.profile_image_url"
                      :src="user.profile_image_url"
                      class="w-8 h-8 rounded-lg object-cover border border-gray-150 dark:border-gray-800 shrink-0"
                      alt="Profile"
                    />
                    <div class="min-w-0">
                      <p
                        class="text-xs font-bold text-gray-900 dark:text-gray-100 truncate"
                      >
                        {{ user.name }}
                      </p>
                      <p class="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        @{{ user.screen_name }}
                      </p>
                    </div>
                  </div>
                  <p class="text-[11px] text-gray-600 dark:text-gray-300 leading-normal line-clamp-3">
                    {{ user.description }}
                  </p>
                  <div class="flex text-[9px] text-gray-400 gap-2.5 pt-1 border-t border-gray-100 dark:border-gray-800/60">
                    <span v-if="user.location" class="truncate max-w-[80px]">📍 {{ user.location }}</span>
                    <span v-if="user.followers_count != null" class="font-mono"
                      >👥 {{ user.followers_count.toLocaleString() }}</span
                    >
                  </div>
                  <a
                    v-if="user.screen_name"
                    :href="`https://x.com/${user.screen_name}`"
                    target="_blank"
                    class="inline-flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400 font-extrabold hover:underline"
                    >View X Profile <ExternalLink class="h-2.5 w-2.5" /></a
                  >
                </div>
              </div>
              <p v-else-if="!isSearchingX" class="text-[11px] text-gray-400 dark:text-gray-500 italic text-center py-2">
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
                    @mousedown="startLongPress"
                    @mouseup="cancelLongPress"
                    @mouseleave="cancelLongPress"
                    @touchstart="startLongPress"
                    @touchend="cancelLongPress"
                    @click="handleScrapeClick"
                    :disabled="isScrapingDisabled"
                    class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    :title="isRepeatScheduleMode ? 'Schedule repeatly' : 'Schedule this channel for scraping'"
                  >
                    <ListFilter class="h-3 w-3" />
                    {{
                      isRepeatScheduleMode ? "Schedule Repeatly" : (isScrapingDisabled ? "Scheduled" : "Schedule Once")
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
                      'rounded-2xl border p-5 hover:shadow-md transition-all duration-300 relative overflow-hidden',
                      post.data?.grouped?.nr > 0
                        ? `${getGroupStyles(post.data.grouped.root).bg} ${
                            getGroupStyles(post.data.grouped.root).border
                          }`
                        : 'bg-white dark:bg-gray-800 border-gray-200/60 dark:border-gray-700/60',
                      post.isNewEmphasized ? 'ring-2 ring-teal-500' : '',
                    ]"
                  >
                    <!-- Decorative Corner Glow -->
                    <div
                      class="absolute -top-10 -right-10 w-24 h-24 bg-teal-500/5 dark:bg-teal-500/5 rounded-full blur-2xl pointer-events-none"
                    ></div>

                    <!-- Post Card Header -->
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-3 border-b border-gray-100 dark:border-gray-700/50">
                      <div class="flex items-center gap-3">
                        <div
                          class="w-10 h-10 rounded-xl bg-gray-50 dark:bg-gray-900 flex items-center justify-center font-bold text-xs overflow-hidden ring-1 ring-gray-150 dark:ring-gray-850 shadow-sm shrink-0"
                        >
                          <img
                            :src="getPostAvatarUrl(post)"
                            @error="handleImageError"
                            alt="Avatar"
                            class="w-full h-full object-cover"
                          />
                        </div>
                        <div class="min-w-0">
                          <div class="flex items-center gap-1.5 flex-wrap">
                            <button
                              class="text-xs font-extrabold text-gray-900 dark:text-white hover:text-teal-600 dark:hover:text-teal-400 transition-colors text-left"
                              @click="searchXUser(post.data?.author || post.data?.user || metadata.name)"
                            >
                              {{ post.data?.author || post.data?.user || metadata.title || metadata.name }}
                            </button>
                            <span
                              class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full"
                              :class="
                                getToolName(post) === 'TGB'
                                  ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-100/50 dark:border-purple-900/10'
                                  : 'bg-gray-50 dark:bg-gray-900 text-gray-450 border border-gray-150/40 dark:border-gray-800'
                              "
                            >
                              {{ getToolName(post) }}
                            </span>
                          </div>
                          <p
                            class="flex items-center gap-2 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-0.5"
                          >
                            <span>{{ formatDate(post.data?.date) }}</span>
                            <span v-if="post.mtime" class="text-[9px] text-teal-600 dark:text-teal-400">
                              (Scraped {{ formatScrapedDate(post.mtime) }})
                            </span>
                          </p>
                        </div>
                      </div>

                      <!-- Header Action Controls -->
                      <div class="flex items-center gap-1.5 sm:self-center">
                        <button
                          @click.stop="addToWorkspaceFromPost(post)"
                          class="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-850 text-gray-650 dark:text-gray-300 rounded-lg border border-gray-200/50 dark:border-gray-700/50 text-[10px] font-extrabold transition-all cursor-pointer"
                          title="Add to Workspace"
                        >
                          <Layout class="h-3 w-3 text-teal-500" />
                          <span>Add</span>
                        </button>
                        <button
                          @click.stop="sharePost(post)"
                          class="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-850 text-gray-650 dark:text-gray-300 rounded-lg border border-gray-200/50 dark:border-gray-700/50 text-[10px] font-extrabold transition-all cursor-pointer"
                          title="Share"
                        >
                          <Share2 class="h-3 w-3 text-teal-500" />
                          <span>Share</span>
                        </button>
                        <a
                          v-if="post.url || post.link"
                          :href="post.url || post.link"
                          target="_blank"
                          class="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/50 dark:hover:bg-teal-900/40 text-teal-600 dark:text-teal-450 rounded-lg border border-teal-100 dark:border-teal-900/30 text-[10px] font-extrabold transition-all cursor-pointer"
                        >
                          <span>View</span>
                          <ExternalLink class="h-3 w-3" />
                        </a>
                      </div>
                    </div>

                    <!-- Sub Group Status Badge -->
                    <div
                      v-if="post.data?.grouped?.nr > 0"
                      :class="[
                        'inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider mb-3.5',
                        getGroupStyles(post.data.grouped.root).badge,
                      ]"
                    >
                      <Layers class="h-3 w-3 mr-1" />
                      Group: {{ post.data.grouped.root }}
                    </div>

                    <!-- Quoted Reply -->
                    <div
                      v-if="post.data?.reply && post.data.reply.length >= 2"
                      class="mb-4 border-l-4 border-teal-500 bg-teal-500/[0.03] dark:bg-teal-950/[0.15] p-3.5 rounded-r-2xl relative z-10 border border-teal-100/50 dark:border-teal-900/20"
                    >
                      <div
                        class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 mb-1.5"
                      >
                        <div class="flex items-center">
                          <Reply class="h-3.5 w-3.5 mr-1" />
                          Reply to message
                        </div>
                        <span
                          v-if="
                            Array.isArray(post.data?.reply) &&
                            post.data.reply[0] != null
                          "
                          class="font-mono bg-teal-50 dark:bg-teal-950/40 px-2 py-0.5 rounded border border-teal-100/50 dark:border-teal-900/10 tracking-normal text-[9px] normal-case"
                          >ID:
                          {{
                            post.data._tool
                              ? post.data.reply[0]
                              : String(post.data.reply[0]).split("/").pop()
                          }}</span
                        >
                      </div>
                      <div
                        class="text-gray-600 dark:text-gray-300 text-xs whitespace-pre-wrap break-words italic line-clamp-3"
                      >
                        {{ post.data.reply[1] }}
                      </div>
                    </div>

                    <!-- Forward Area -->
                    <div
                      v-if="post.data?.forward_url"
                      class="mb-4 border-l-4 border-indigo-500 bg-indigo-500/[0.03] dark:bg-indigo-950/[0.15] p-3.5 rounded-r-2xl relative z-10 border border-indigo-100/50 dark:border-indigo-900/20"
                    >
                      <div
                        class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1.5"
                      >
                        <div class="flex items-center">
                          <Forward class="h-3.5 w-3.5 mr-1" />
                          Forwarded Message
                        </div>
                        <span v-if="getForwardInfo(post)?.date" class="font-mono bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-100/50 dark:border-indigo-900/10 tracking-normal text-[9px] normal-case">
                          {{ getForwardInfo(post)?.date }}
                        </span>
                      </div>
                      <div class="text-gray-600 dark:text-gray-300 text-xs font-medium whitespace-pre-wrap break-words italic line-clamp-3">
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
                        {{ post.key in translatedPosts ? post.data.content + '\n--------\n' + translatedPosts[post.key] : post.data.content}}
                      </div>
                      <button
                        @click="translatePost(post)"
                        class="p-1 -mt-1 text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-md transition-colors flex-shrink-0"
                        title="Translate to Chinese"
                      >
                        <Languages v-if="!isTranslating[post.key]" class="h-4 w-4" />
                        <Loader2 v-else class="h-4 w-4 animate-spin" />
                      </button>
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
                          v-if="post.data.linkPreview.href || post.data.linkPreview.url"
                          :href="post.data.linkPreview.href || post.data.linkPreview.url"
                          target="_blank"
                          class="text-sm font-bold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 mb-1.5 line-clamp-1 transition-colors"
                        >
                          {{
                            post.data.linkPreview.title ||
                            post.data.linkPreview.href ||
                            post.data.linkPreview.url
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

                    <!-- PDF Document Preview -->
                    <div
                      v-if="post.data?.documents && post.data.documents.length > 0 && post.data.documents[0].mime_type == 'application/pdf'"
                      class="mb-4 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/50 flex items-center p-4 shadow-sm hover:shadow-md transition-shadow relative z-10"
                    >
                      <div class="mr-4">
                        <FileText class="h-10 w-10 text-red-500" />
                      </div>
                      <div class="flex-1 min-w-0">
                        <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-1">
                          {{ post.data.documents[0].attributes[0].file_name || 'Document.pdf' }}
                        </h4>
                        <a
                          :href="`https://i.gogingko.net/api/v1/v/telegram-doc/${post.key}`"
                          target="_blank"
                          class="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-semibold"
                        >
                          View Document
                        </a>
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
          class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-750 p-6 sm:p-8 mb-8 shadow-sm relative overflow-hidden"
        >
          <!-- Background Decoration -->
          <div
            class="absolute -top-20 -right-20 w-40 h-40 bg-teal-500/5 dark:bg-teal-505/10 rounded-full blur-3xl pointer-events-none"
          ></div>
          <div
            class="absolute -bottom-20 -left-20 w-40 h-40 bg-indigo-500/5 dark:bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"
          ></div>

          <form @submit.prevent="performGlobalSearch" class="relative z-10">
            <div class="relative flex items-center mb-6 group">
              <div
                class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none transition-transform duration-300 group-focus-within:scale-110 group-focus-within:text-teal-600 z-10"
              >
                <Globe class="h-5 w-5 text-gray-400" />
              </div>
              <input
                v-model="globalSearchQuery"
                type="text"
                class="block w-full pl-14 pr-[120px] py-4 border border-gray-200 dark:border-gray-700 rounded-2xl leading-5 bg-white/95 dark:bg-gray-800/95 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-sm font-semibold shadow-sm hover:shadow-md focus:shadow-lg transition-all duration-300"
                placeholder="Search across all telegram data..."
              />
              <button
                type="submit"
                :disabled="isSearching || !globalSearchQuery.trim()"
                class="absolute right-2 top-2 bottom-2 px-6 bg-teal-600 text-white rounded-xl text-xs font-black tracking-wide hover:bg-teal-700 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center shadow-md shadow-teal-500/20 hover:shadow-teal-500/40 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
              >
                <Loader2 v-if="isSearching" class="h-4 w-4 animate-spin mr-2" />
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
                    'flex items-center px-3 py-1.5 rounded-xl border text-[11px] font-bold tracking-tight transition-all duration-350 cursor-pointer',
                    searchFields[field]
                      ? 'bg-teal-600 border-teal-600 text-white shadow-sm shadow-teal-500/10'
                      : 'bg-white/50 dark:bg-gray-800/50 border-gray-150 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-teal-50/50 dark:hover:bg-teal-950/20 hover:text-teal-600 dark:hover:text-teal-400',
                  ]"
                >
                  <component :is="getFieldIcon(field)" class="h-3.5 w-3.5 mr-1.5" />
                  <span
                    class="capitalize"
                    >{{ field === "content" ? "Post" : field }}</span
                  >
                </button>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <div
                  class="flex flex-wrap items-center bg-gray-50/80 dark:bg-gray-900/50 p-1.5 rounded-xl border border-gray-150 dark:border-gray-700 backdrop-blur-sm gap-1"
                >
                  <input
                    type="datetime-local"
                    v-model="searchStartDate"
                    class="bg-transparent text-[10px] p-0.5 text-gray-605 dark:text-gray-300 focus:outline-none w-[130px] font-mono font-semibold"
                  />
                  <span class="text-[10px] text-gray-400 px-1 font-mono">to</span>
                  <input
                    type="datetime-local"
                    v-model="searchEndDate"
                    class="bg-transparent text-[10px] p-0.5 text-gray-650 dark:text-gray-300 focus:outline-none w-[130px] font-mono font-semibold"
                  />
                </div>

                <div
                  class="flex items-center bg-gray-50/80 dark:bg-gray-900/50 p-1.5 rounded-xl border border-gray-150 dark:border-gray-700 backdrop-blur-sm"
                >
                  <div class="px-2 text-gray-450 dark:text-gray-550">
                    <ListFilter class="h-3.5 w-3.5" />
                  </div>
                  <div class="flex space-x-0.5">
                    <button
                      v-for="limit in limitOptions"
                      :key="limit"
                      type="button"
                      @click="searchLimit = limit"
                      :class="[
                        'px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer',
                        searchLimit === limit
                          ? 'bg-white dark:bg-gray-700 text-teal-650 dark:text-teal-400 shadow-sm'
                          : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
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
          class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-750 p-16 text-center shadow-sm"
        >
          <div
            class="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-teal-50 dark:bg-teal-950/40 mb-6 shadow-inner ring-1 ring-teal-100 dark:ring-teal-900/20 border-4 border-white dark:border-gray-900"
          >
            <Loader2
              class="h-8 w-8 text-teal-600 dark:text-teal-400 animate-spin"
            />
          </div>
          <h3
            class="text-xl font-black tracking-tight text-gray-900 dark:text-white mb-2"
          >
            Searching Telegram...
          </h3>
          <p
            class="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto font-medium"
          >
            Querying internal dataset, this may take a few seconds.
          </p>
        </div>

        <div v-if="filteredSearchResults.length > 0" class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-bold text-gray-900 dark:text-white">
                Search Results ({{ filteredSearchResults.length }})
              </h3>
              <button
                @click="addAllToWorkspace"
                :disabled="isAddingAll"
                class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center shadow-md shadow-teal-500/25 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
              >
                <Loader2 v-if="isAddingAll" class="h-3.5 w-3.5 animate-spin mr-2" />
                <Layers v-else class="h-3.5 w-3.5 mr-2" />
                {{ isAddingAll ? 'Adding...' : 'Add All to Workspace' }}
              </button>
            </div>
          
            <div
              v-if="filteredSearchResults.length > 0"
              class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start px-4 sm:px-0"
            >

          <div
            class="lg:col-span-4 xl:col-span-3 space-y-4 h-fit sticky top-20 flex-shrink-0"
          >
            <!-- User Profile Widget -->
            <div
              v-if="userProfile || loadingUserProfile"
              class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-700/60 p-6 shadow-sm"
            >
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">User Profile</h3>
                </div>
                
                <div v-if="loadingUserProfile" class="text-xs text-gray-400 py-4 flex items-center gap-2 animate-pulse">
                    <Loader2 class="w-3.5 h-3.5 animate-spin text-teal-500" /> Loading profile...
                </div>

                <div v-else-if="userProfile" class="flex flex-col gap-3">
                    <div class="flex items-center gap-4">
                        <img 
                          v-if="userProfile.avatarUrl" 
                          :src="userProfile.avatarUrl" 
                          @error="handleImageError" 
                          alt="Avatar" 
                          class="w-16 h-16 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-md object-cover ring-4 ring-teal-500/10 shrink-0" 
                        />
                        <div class="flex-1 min-w-0">
                            <p class="font-extrabold text-base text-gray-900 dark:text-white truncate">@{{ userProfile.username }}</p>
                            <p v-if="userProfile.title" class="text-xs font-bold text-teal-600 dark:text-teal-400 truncate mt-0.5">{{ userProfile.title }}</p>
                        </div>
                    </div>

                    <div class="text-xs text-gray-700 dark:text-gray-300">
                        <p class="font-black">{{ userProfile.firstName }} {{ userProfile.lastName }}</p>
                        <div v-if="userProfile.cdnNumber || userProfile.cdnRegion" class="text-[10px] text-gray-400 dark:text-gray-500 mt-1 font-mono">
                            <span v-if="userProfile.cdnNumber" class="font-medium">IDC Center DC: {{ userProfile.cdnNumber }}</span>
                            <span v-if="userProfile.cdnRegion" class="ml-2 text-teal-600 dark:text-teal-400">({{ userProfile.cdnRegion[1] }})</span>
                        </div>
                    </div>

                    <div v-if="userProfile.about || userProfile.description" class="text-xs pt-2.5 border-t border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400 leading-relaxed">
                        {{ userProfile.about || userProfile.description }}
                    </div>
                </div>
            </div>

            <!-- Usernames Widget -->
            <div
              class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-700/60 p-6 shadow-sm"
            >
              <div class="flex justify-between items-center mb-4">
                <h3                
                  class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider"
                >
                  Usernames
                </h3>
                <button @click="copyUsernamesToClipboard(allUsernames)" class="text-gray-400 hover:text-teal-500 transition-colors cursor-pointer">
                  <Copy class="w-4 h-4" />
                </button>
              </div>
              <div
                class="max-h-[300px] overflow-y-auto space-y-1.5 pr-2 custom-scrollbar"
              >
                <button
                  v-for="username in allUsernames"
                  :key="username"
                  @click="toggleUsername(username)"
                  :class="[
                    'w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex justify-between items-center cursor-pointer',
                    selectedUsernames.includes(username)
                      ? 'bg-teal-600 text-white shadow-sm shadow-teal-500/10'
                      : 'bg-gray-50 dark:bg-gray-900 border border-gray-150/40 dark:border-gray-800/40 text-gray-700 dark:text-gray-300 hover:bg-teal-50/50 dark:hover:bg-teal-950/20 hover:text-teal-600 dark:hover:text-teal-400',
                  ]"
                >
                  <span>{{ username }}</span>
                  <span
                    :class="[
                      'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md',
                      selectedUsernames.includes(username)
                        ? 'opacity-80 bg-white/20 text-white'
                        : 'opacity-70 bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    ]"
                  >{{ usernamePostCounts[username] || 0 }}</span>
                </button>
              </div>
            </div>

            <!-- Channels Widget -->
            <div
              class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-700/60 p-6 shadow-sm"
            >
              <h3
                class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4"
              >
                Channels
              </h3>
              <div
                class="max-h-[300px] overflow-y-auto space-y-1.5 pr-2 custom-scrollbar"
              >
                <button
                  v-for="channel in allChannels"
                  :key="channel"
                  @click="toggleChannel(channel)"
                  :class="[
                    'w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex justify-between items-center cursor-pointer',
                    selectedChannels.includes(channel)
                      ? 'bg-teal-600 text-white shadow-sm shadow-teal-500/10'
                      : 'bg-gray-50 dark:bg-gray-900 border border-gray-150/40 dark:border-gray-800/40 text-gray-700 dark:text-gray-300 hover:bg-teal-50/50 dark:hover:bg-teal-950/20 hover:text-teal-600 dark:hover:text-teal-400',
                  ]"
                >
                  <span>{{ channel }}</span>
                  <span
                    :class="[
                      'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md',
                      selectedChannels.includes(channel)
                        ? 'opacity-80 bg-white/20 text-white'
                        : 'opacity-70 bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    ]"
                  >{{ channelPostCounts[channel] || 0 }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="lg:col-span-8 xl:col-span-9 space-y-6">
            <div
              v-if="searchTimelineStats"
              class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-700/60 p-6 shadow-sm mb-8"
            >
              <div class="flex items-center justify-between mb-4">
                <h4
                  class="text-sm font-bold text-gray-900 dark:text-white flex items-center"
                >
                  <Calendar class="h-4 w-4 mr-2 text-teal-600 dark:text-teal-450" />
                  Activity Timeline
                </h4>
                <span
                  class="text-xs font-semibold text-gray-400 dark:text-gray-500 font-mono"
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
                  class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-teal-500 border-2 border-white dark:border-gray-800 shadow-[0_0_8px_rgba(20,184,166,0.5)] transition-all duration-355 hover:scale-150 cursor-pointer group"
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
                <span class="px-2.5 py-1 bg-gray-50 dark:bg-gray-900 rounded-md text-[9px] font-mono normal-case"
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
                  class="h-5 w-5 mr-2 text-teal-600 dark:text-teal-400"
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
                  'relative rounded-3xl shadow-sm border p-6 hover:shadow-md transition-all duration-350',
                  post.data?.grouped?.nr > 0
                    ? `${getGroupStyles(post.data.grouped.root).bg} ${
                        getGroupStyles(post.data.grouped.root).border
                      }`
                    : 'bg-white dark:bg-gray-800 border-gray-200/60 dark:border-gray-700/60',
                ]"
              >
                <!-- Decorative Corner Glow -->
                <div
                  class="absolute -top-10 -right-10 w-24 h-24 bg-teal-500/5 dark:bg-teal-500/5 rounded-full blur-2xl pointer-events-none"
                ></div>

                <!-- Post Card Header -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-3 border-b border-gray-100 dark:border-gray-700/50">
                  <div class="flex items-center gap-3">
                    <div
                      class="w-10 h-10 rounded-xl bg-gray-50 dark:bg-gray-900 flex items-center justify-center font-bold text-xs overflow-hidden ring-1 ring-gray-150 dark:ring-gray-850 shadow-sm shrink-0"
                    >
                      <img
                        :src="getPostAvatarUrl(post)"
                        @error="handleImageError"
                        alt="Avatar"
                        class="w-full h-full object-cover"
                      />
                    </div>
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <button
                          class="text-xs font-extrabold text-gray-900 dark:text-white hover:text-teal-600 dark:hover:text-teal-400 transition-colors text-left"
                          @click="searchXUser(post.data?.author || post.data?.user || 'Telegram User')"
                        >
                          {{ post.data?.author || post.data?.user || "Telegram User" }}
                        </button>
                        <span
                          class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full"
                          :class="
                            getToolName(post) === 'TGB'
                              ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-100/50 dark:border-purple-900/10'
                              : 'bg-gray-50 dark:bg-gray-900 text-gray-450 border border-gray-150/40 dark:border-gray-800'
                          "
                        >
                          {{ getToolName(post) }}
                        </span>
                        <span class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/30 text-teal-650 dark:text-teal-400 border border-teal-100/40 dark:border-teal-900/20">
                          {{ getUsername(post) }}
                        </span>
                      </div>
                      <p
                        class="flex items-center gap-2 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-0.5"
                      >
                        <span>{{ formatDate(post.data?.date) }}</span>
                        <span v-if="post.mtime" class="text-[9px] text-teal-600 dark:text-teal-400">
                          (Scraped {{ formatScrapedDate(post.mtime) }})
                        </span>
                      </p>
                    </div>
                  </div>

                  <!-- Header Action Controls -->
                  <div class="flex items-center gap-1.5 sm:self-center">
                    <button
                      @click.stop="addToWorkspaceFromPost(post)"
                      class="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-850 text-gray-650 dark:text-gray-300 rounded-lg border border-gray-200/50 dark:border-gray-700/50 text-[10px] font-extrabold transition-all cursor-pointer"
                      title="Add to Workspace"
                    >
                      <Layout class="h-3 w-3 text-teal-500" />
                      <span>Add</span>
                    </button>
                    <button
                      @click.stop="sharePost(post)"
                      class="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-850 text-gray-650 dark:text-gray-300 rounded-lg border border-gray-200/50 dark:border-gray-700/50 text-[10px] font-extrabold transition-all cursor-pointer"
                      title="Share"
                    >
                      <Share2 class="h-3 w-3 text-teal-500" />
                      <span>Share</span>
                    </button>
                    <a
                      v-if="post.url || post.link"
                      :href="post.url || post.link"
                      target="_blank"
                      class="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/50 dark:hover:bg-teal-900/40 text-teal-600 dark:text-teal-450 rounded-lg border border-teal-100 dark:border-teal-900/30 text-[10px] font-extrabold transition-all cursor-pointer"
                    >
                      <span>View</span>
                      <ExternalLink class="h-3 w-3" />
                    </a>
                  </div>
                </div>

                <!-- Sub Group Status Badge -->
                <div
                  v-if="post.data?.grouped?.nr > 0"
                  :class="[
                    'inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider mb-3.5',
                    getGroupStyles(post.data.grouped.root).badge,
                  ]"
                >
                  <Layers class="h-3 w-3 mr-1" />
                  Group: {{ post.data.grouped.root }}
                </div>

                <!-- Quoted Reply -->
                <div
                  v-if="post.data?.reply && post.data.reply.length >= 2"
                  class="mb-4 border-l-4 border-teal-500 bg-teal-500/[0.03] dark:bg-teal-950/[0.15] p-3.5 rounded-r-2xl relative z-10 border border-teal-100/50 dark:border-teal-900/20"
                >
                  <div
                    class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 mb-1.5"
                  >
                    <div class="flex items-center">
                      <Reply class="h-3.5 w-3.5 mr-1" />
                      Reply to message
                    </div>
                    <span
                      v-if="
                        Array.isArray(post.data?.reply) &&
                        post.data.reply[0] != null
                      "
                      class="font-mono bg-teal-50 dark:bg-teal-950/40 px-2 py-0.5 rounded border border-teal-100/50 dark:border-teal-900/10 tracking-normal text-[9px] normal-case"
                      >ID:
                      {{
                        post.data._tool
                          ? post.data.reply[0]
                          : String(post.data.reply[0]).split("/").pop()
                      }}</span
                    >
                  </div>
                  <div
                    class="text-gray-600 dark:text-gray-300 text-xs whitespace-pre-wrap break-words italic line-clamp-3"
                    v-html="highlightText(post.data.reply[1])"
                  ></div>
                </div>

                <!-- Forward Area -->
                <div
                  v-if="post.data?.forward_url"
                  class="mb-4 border-l-4 border-indigo-500 bg-indigo-500/[0.03] dark:bg-indigo-950/[0.15] p-3.5 rounded-r-2xl relative z-10 border border-indigo-100/50 dark:border-indigo-900/20"
                >
                  <div
                    class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1.5"
                  >
                    <div class="flex items-center">
                      <Forward class="h-3.5 w-3.5 mr-1" />
                      Forwarded Message
                    </div>
                    <span v-if="getForwardInfo(post)?.date" class="font-mono bg-indigo-55 dark:bg-indigo-950/45 px-2 py-0.5 rounded border border-indigo-100/50 dark:border-indigo-900/10 tracking-normal text-[9px] normal-case">
                      {{ getForwardInfo(post)?.date }}
                    </span>
                  </div>
                  <div
                    class="text-gray-650 dark:text-gray-300 text-xs font-semibold whitespace-pre-wrap break-words italic line-clamp-3"
                  >
                    {{ getForwardInfo(post)?.text }}
                  </div>
                </div>

                <div
                  v-if="post.data?.content"
                  class="flex items-start gap-2 mb-4"
                >
                  <div
                    class="text-gray-800 dark:text-gray-200 text-sm whitespace-pre-wrap break-words flex-1 leading-relaxed"
                    v-html="highlightText(post.key in translatedPosts ? post.data.content + '\n--------\n' + translatedPosts[post.key] : post.data.content)"
                  ></div>
                  <button
                    @click="translatePost(post)"
                    class="p-1.5 -mt-1 text-gray-450 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/25 rounded-md transition-colors flex-shrink-0 cursor-pointer"
                    title="Translate to Chinese"
                  >
                    <Languages v-if="!isTranslating[post.key]" class="h-4 w-4" />
                    <Loader2 v-else class="h-4 w-4 animate-spin text-teal-650" />
                  </button>
                  <button
                    @click="searchOnGoogle(post.data.content)"
                    class="p-1.5 -mt-1 text-gray-450 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/25 rounded-md transition-colors flex-shrink-0 cursor-pointer"
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
                  class="mb-3 rounded-2xl border border-teal-150/40 bg-teal-500/[0.02] dark:bg-teal-950/[0.10] p-4 relative z-10 border border-teal-100/30 dark:border-teal-900/10"
                >
                  <div class="flex items-center mb-2.5">
                    <div
                      class="h-7 w-7 rounded-lg bg-teal-50 dark:bg-teal-900/30 flex flex-shrink-0 items-center justify-center text-teal-600 dark:text-teal-400 mr-2 border border-teal-100 dark:border-teal-900/40 shadow-sm"
                    >
                      <User class="h-3.5 w-3.5" />
                    </div>
                    <div
                      class="text-[9px] font-black tracking-wider text-teal-600 dark:text-teal-400 uppercase"
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
                      class="flex items-center text-xs text-gray-700 dark:text-gray-300 font-mono"
                    >
                      <Phone class="h-3 w-3 mr-1.5 text-teal-600/70" />
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

      <!-- Toast Message -->
      <div v-if="toastMessage" class="fixed top-5 right-5 z-[100] px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-white" :class="toastType === 'success' ? 'bg-green-500' : 'bg-red-500'">
        <AlertCircle class="w-5 h-5" />
        {{ toastMessage }}
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
      <!-- Workspace Tab -->
      <div v-show="activeTab === 'workspace'" class="w-full relative pt-2 pb-6 flex flex-col h-full overflow-y-auto">
        
        <!-- Header Banner Section -->
        <div class="relative bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-750 p-6 md:p-8 shadow-sm overflow-hidden mb-6 mx-4 md:mx-6 shrink-0">
          <div class="absolute -right-20 -top-20 w-44 h-44 bg-purple-500/[0.04] dark:bg-purple-500/[0.08] rounded-full blur-3xl pointer-events-none"></div>
          <div class="absolute -left-20 -bottom-20 w-44 h-44 bg-indigo-500/[0.04] dark:bg-indigo-500/[0.08] rounded-full blur-3xl pointer-events-none"></div>

          <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <span class="p-1.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-450">
                  <Layers class="h-5 w-5" />
                </span>
                <span class="text-[10px] font-black text-purple-600 dark:text-purple-400 uppercase tracking-widest leading-none">Network Studio</span>
              </div>
              <h2 class="text-xl md:text-2xl font-black text-gray-900 dark:text-white tracking-tight">Interactive Graph Workspace</h2>
              <p class="text-xs text-gray-400 dark:text-gray-500 font-semibold max-w-xl">
                Map channels and entities, establish forward flows, analyze relationship linkages, and view dynamic chronologies.
              </p>
            </div>

            <!-- Dashboard micro-indicator -->
            <div class="flex items-center gap-6 text-[11px] font-semibold text-gray-400 dark:text-gray-500 shrink-0 self-start md:self-center border-t md:border-t-0 md:border-l border-gray-200/60 dark:border-gray-750 pt-4 md:pt-0 md:pl-6">
              <div v-if="savedProfiles.person.length > 0" class="space-y-1">
                <p class="text-[10px] uppercase font-black tracking-wider text-gray-400 dark:text-gray-500 leading-none">Local Persons</p>
                <p class="font-mono text-gray-900 dark:text-white font-bold">{{ savedProfiles.person.length }} entities</p>
              </div>
              <div v-if="savedGraphRemotely.length > 0" class="space-y-1">
                <p class="text-[10px] uppercase font-black tracking-wider text-gray-400 dark:text-gray-500 leading-none">Remote Graphs</p>
                <p class="font-mono text-gray-900 dark:text-white font-bold">{{ savedGraphRemotely.length }} charts</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Saved Libraries Sub-grid -->
        <div v-if="savedProfiles.person.length > 0 || savedGraphRemotely.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-6 mx-4 md:mx-6 mb-6 shrink-0">
          <!-- Saved Persons Local Cabinet -->
          <div v-if="savedProfiles.person.length > 0" class="bg-gradient-to-br from-white to-gray-50/50 dark:from-gray-800 dark:to-gray-900/40 p-5 rounded-3xl border border-gray-200/75 dark:border-gray-750 space-y-4 shadow-sm">
            <div class="flex items-center gap-2">
              <User class="h-4.5 w-4.5 text-purple-600 dark:text-purple-400" />
              <h4 class="text-xs font-black text-gray-900 dark:text-white uppercase tracking-wider">Saved Local Persons</h4>
            </div>
            <p class="text-[11px] text-gray-450 dark:text-gray-500 font-semibold leading-relaxed">
              Dossier saved in your offline storage pool:
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <button 
                v-for="name in savedProfiles.person" 
                :key="name" 
                @click="viewSavedProfile('person', name)" 
                class="px-3 py-1.5 text-xs font-semibold bg-white hover:bg-purple-500/[0.04] dark:bg-gray-800/85 hover:text-purple-600 dark:hover:text-purple-400 border border-gray-200/60 dark:border-gray-750 rounded-xl transition-all cursor-pointer shadow-sm hover:border-purple-500/30"
              >
                {{ name }}
              </button>
            </div>
          </div>

          <!-- Saved Remote Graphs Cabinet -->
          <div v-if="savedGraphRemotely.length > 0" class="bg-gradient-to-br from-white to-gray-50/50 dark:from-gray-800 dark:to-gray-900/40 p-5 rounded-3xl border border-gray-200/75 dark:border-gray-750 space-y-4 shadow-sm">
            <div class="flex items-center gap-2">
              <Layers class="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" />
              <h4 class="text-xs font-black text-gray-900 dark:text-white uppercase tracking-wider">Remote Saved Graphs</h4>
            </div>
            <p class="text-[11px] text-gray-450 dark:text-gray-500 font-semibold leading-relaxed">
              Interactive structural topologies synchronized with cloud catalogs:
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <button 
                v-for="name in savedGraphRemotely" 
                :key="name" 
                @click="viewSavedGraphRemotely(name)" 
                class="px-3 py-1.5 text-xs font-semibold bg-white hover:bg-indigo-500/[0.04] dark:bg-gray-800/85 hover:text-indigo-600 dark:hover:text-indigo-400 border border-gray-200/60 dark:border-gray-750 rounded-xl transition-all cursor-pointer shadow-sm hover:border-indigo-500/30"
              >
                {{ name }}
              </button>
            </div>
          </div>
        </div>

        <!-- Saved Person Profile Viewer Sheet -->
        <transition enter-active-class="transition duration-300 ease-out" enter-from-class="transform scale-98 opacity-0" enter-to-class="transform scale-100 opacity-100">
          <div
            v-if="savedPersonProfileHtml"
            class="mx-4 md:mx-6 mb-6 bg-white dark:bg-gray-800 p-6 md:p-8 rounded-3xl border border-gray-200/80 dark:border-gray-750 shadow-sm relative overflow-hidden space-y-6 shrink-0"
          >
            <div class="flex items-center justify-between pb-4 border-b border-gray-150 dark:border-gray-750">
              <div class="flex items-center gap-2.5">
                <span class="p-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-500/10">
                  <Sparkles class="h-4.5 w-4.5" />
                </span>
                <div>
                  <h3 class="text-xs font-black text-gray-400 dark:text-gray-550 uppercase tracking-widest leading-none">Inspecting Local Target</h3>
                  <h4 class="text-base font-black text-gray-900 dark:text-white mt-1">{{ savedProfileName }}</h4>
                </div>
              </div>
              
              <div class="flex items-center gap-2">
                <button 
                  @click="handleSaveRemote(savedProfileName)" 
                  class="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black tracking-wide flex items-center justify-center gap-1.5 shadow-md shadow-purple-500/15 cursor-pointer transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
                >
                  <Database class="h-3.5 w-3.5" />
                  <span>Save Remotely</span>
                </button>
                <button 
                  @click="savedPersonProfileHtml = null; savedProfileName = ''" 
                  class="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all cursor-pointer border border-gray-200/60 dark:border-gray-750 bg-white dark:bg-gray-800"
                >
                  <X class="h-4 w-4" />
                </button>
              </div>
            </div>
          
            <div class="prose dark:prose-invert prose-sm leading-relaxed max-w-none text-xs text-gray-750 dark:text-gray-300 p-5 bg-gray-50/50 dark:bg-gray-900/35 border border-gray-150/40 dark:border-gray-850/50 rounded-2xl overflow-y-auto max-h-[500px]">
              <div v-html="savedPersonProfileHtml" class="prose-sm prose-pre:whitespace-pre-wrap font-semibold"></div>
            </div>
          </div>
        </transition>

        <!-- Main Graph Studio Card -->
        <div class="mx-4 md:mx-6 h-[960px] flex-none bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-750 flex flex-col relative overflow-hidden shadow-sm">
          
          <!-- Modern Control Hub Header -->
          <div class="px-6 py-5 border-b border-gray-150 dark:border-gray-750 flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4 bg-white/50 dark:bg-gray-800/50 backdrop-blur-md z-10">
            <div class="flex items-center gap-3">
              <span class="p-2 bg-gradient-to-tr from-purple-500/10 to-indigo-500/10 text-purple-600 dark:text-purple-400 rounded-xl border border-purple-500/10">
                <Layers class="w-4 h-4" />
              </span>
              <div>
                <h2 class="text-sm font-black text-gray-900 dark:text-white tracking-widest uppercase mb-0.5">
                  {{ isLoginTokenValid ? 'Graph Remote Studio' : 'Graph Local Studio' }}
                </h2>
                <span class="text-[10px] font-bold text-gray-400 dark:text-gray-500">Workspace Graph Sandbox</span>
              </div>
            </div>

            <!-- Sleek Control Toolbar -->
            <div class="flex flex-wrap items-center gap-3">
              <!-- Search query field -->
              <div class="relative min-w-[140px] sm:min-w-[180px] flex-grow lg:flex-grow-0">
                <Search class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-550" />
                <input 
                  type="text" 
                  v-model="nodeSearchQuery" 
                  @keyup.enter="findNode" 
                  placeholder="Find node ID..." 
                  class="pl-9 pr-3.5 py-2 hover:bg-gray-50/50 dark:hover:bg-gray-900/35 border border-gray-200/80 dark:border-gray-700 rounded-xl bg-transparent text-xs font-semibold outline-none text-gray-900 dark:text-white placeholder-gray-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/15 transition-all w-full" 
                />
              </div>

              <!-- Graph name field -->
              <div class="relative min-w-[110px] sm:min-w-[140px] flex-grow lg:flex-grow-0">
                <FileText class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-teal-600 dark:text-teal-400" />
                <input 
                  type="text" 
                  v-model="graphNameInput" 
                  placeholder="Graph title..." 
                  class="pl-9 pr-3.5 py-2 hover:bg-gray-50/50 dark:hover:bg-gray-900/35 border border-gray-200/80 dark:border-gray-700 rounded-xl bg-transparent text-xs font-semibold outline-none text-gray-900 dark:text-white placeholder-gray-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/15 transition-all w-full" 
                />
              </div>

              <!-- Button Actions -->
              <div class="flex flex-wrap items-center gap-2">
                <button 
                  @click="saveGraph" 
                  class="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black tracking-wide flex items-center justify-center gap-1.5 shadow-md shadow-purple-500/10 cursor-pointer transition-all hover:-translate-y-0.5 active:translate-y-0"
                >
                  <Plus class="h-3.5 w-3.5" />
                  <span>Save</span>
                </button>

                <button 
                  @click="loadGraph" 
                  class="px-3.5 py-2 border border-gray-200/80 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-bold tracking-wide flex items-center justify-center gap-1.5 bg-white dark:bg-gray-800 transition-all cursor-pointer"
                >
                  <FolderOpen class="h-3.5 w-3.5" />
                  <span>Load</span>
                </button>

                <button 
                  @click="reLayoutGraph" 
                  class="px-3.5 py-2 border border-gray-200/80 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-bold tracking-wide flex items-center justify-center gap-1.5 bg-white dark:bg-gray-800 transition-all cursor-pointer"
                >
                  <RefreshCw class="h-3.5 w-3.5" />
                  <span>Re-layout</span>
                </button>

                <button 
                  @click="clearGraph" 
                  class="px-3.5 py-2 border border-rose-500/20 text-rose-500 dark:text-rose-455 hover:bg-rose-500/10 rounded-xl text-xs font-bold tracking-wide flex items-center justify-center gap-1.5 bg-rose-500/[0.02] transition-all cursor-pointer"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                  <span>Clear</span>
                </button>

                <button 
                  @click="shareGraph" 
                  class="px-3.5 py-2 border border-emerald-500/20 text-emerald-600 dark:text-emerald-450 hover:bg-emerald-500/10 rounded-xl text-xs font-bold tracking-wide flex items-center justify-center gap-1.5 bg-emerald-500/[0.02] transition-all cursor-pointer"
                >
                  <Share2 class="h-3.5 w-3.5" />
                  <span>Share</span>
                </button>

                <button 
                  @click="analyzeGraph" 
                  :disabled="isAnalyzingGraph"
                  class="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-black tracking-wide flex items-center justify-center gap-1.5 shadow-md shadow-orange-500/15 cursor-pointer disabled:opacity-50 transition-all hover:-translate-y-0.5 active:translate-y-0"
                >
                  <Sparkles class="h-3.5 w-3.5 animate-pulse" />
                  <span>{{ isAnalyzingGraph ? 'Analyzing...' : 'Deep Analysis' }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="flex-1 relative flex flex-col h-full z-0 overflow-hidden bg-[#fafafa] dark:bg-[#121c2d]">
             <!-- Hint Message -->
             <transition enter-active-class="transition duration-150 ease-out" enter-from-class="transform -translate-y-2 opacity-0" enter-to-class="transform translate-y-0 opacity-100">
               <div v-if="addingEdge" class="absolute top-4 left-4 z-[100] px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2 text-white bg-purple-600 font-semibold text-xs border border-purple-500/20 select-none">
                  <span class="font-black bg-white/20 px-1.5 py-0.5 rounded-lg uppercase tracking-wider text-[10px]">Add Link</span> 
                  <span>Select any target node on the canvas to add an edge.</span>
               </div>
             </transition>

             <!-- Context Menu (Highly Premium) -->
             <div v-if="contextMenu.visible" @mousedown.stop @touchstart.stop @pointerdown.stop @click.stop @contextmenu.stop.prevent :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }" class="absolute z-50 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-200/80 dark:border-gray-750 p-1.5 w-40 divide-y divide-gray-100 dark:divide-gray-850">
                 <div class="py-1">
                   <button @click="startAddEdge" class="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-750 rounded-xl text-xs font-semibold text-gray-900 dark:text-white flex items-center gap-2 cursor-pointer">
                     <Plus class="w-3.5 h-3.5 text-purple-500" />
                     <span>Add Edge</span>
                   </button>
                   <button v-if="contextMenu.node.data('type') === 'channel'" @click="addForwardFrom" class="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-750 rounded-xl text-xs font-semibold text-gray-900 dark:text-white flex items-center gap-2 cursor-pointer">
                     <Forward class="w-3.5 h-3.5 text-teal-500" />
                     <span>Add Forward</span>
                   </button>
                 </div>
                 <div class="py-1">
                   <button @click="deleteNode" class="w-full text-left px-3 py-2 hover:bg-rose-500/[0.05] rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-455 flex items-center gap-2 cursor-pointer">
                     <Trash2 class="w-3.5 h-3.5 text-rose-500" />
                     <span>Delete Node</span>
                   </button>
                 </div>
                 <div class="py-1">
                   <button @click="contextMenu.visible = false" class="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-750 rounded-lg text-[11px] font-bold text-gray-400 dark:text-gray-550 text-center cursor-pointer">
                     Close
                   </button>
                 </div>
             </div>
             
             <!-- Canvas Area -->
             <div id="workspace-canvas" class="w-full h-full min-h-[500px] flex-1 bg-[#f9fafb] dark:bg-[#0b121f] relative z-0">
             </div>

          <!-- Property Viewer (Floating Inspector Card) -->
          <div v-if="selectedNode || selectedEdge" class="absolute top-6 right-6 w-80 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md p-5 rounded-3xl shadow-xl border border-gray-200/80 dark:border-gray-750 z-20 pointer-events-auto transition-all space-y-4">
            <div class="flex items-center justify-between pb-2 border-b border-gray-150 dark:border-gray-750">
              <h3 class="text-[10px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 flex items-center gap-1.5 leading-none">
                <Database class="w-3.5 h-3.5" />
                <span>Sandbox Inspector</span>
              </h3>
              <button @click="selectedNode = null; selectedEdge = null" class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 hover:text-gray-655 transition-colors cursor-pointer">
                <X class="w-3.5 h-3.5" />
              </button>
            </div>
            
            <!-- Node Viewer -->
            <div v-if="selectedNode" class="space-y-4">
              <div class="flex justify-between items-start gap-2">
                <div class="max-w-[70%]">
                  <p class="text-xs font-black text-gray-900 dark:text-white break-words">{{ editingNodeData.label }}</p>
                  <p class="text-[10px] text-gray-400 dark:text-gray-550 font-mono tracking-tight font-bold select-all mt-0.5 truncate">{{ editingNodeData.id }}</p>
                </div>
                <div class="flex flex-col items-end gap-1.5 shrink-0">
                  <span class="text-[9px] bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/10 px-2 py-0.5 rounded-lg font-black uppercase tracking-wider leading-none">{{ editingNodeData.type }}</span>
                  <button v-if="editingNodeData.type === 'channel' || editingNodeData.type === 'user'" @click="fetchNodeMetadata(editingNodeData.type, editingNodeData.id)" class="text-[9px] bg-teal-500/10 hover:bg-teal-500/20 text-teal-600 dark:text-teal-400 border border-teal-500/10 px-2 py-0.5 rounded-lg font-black uppercase cursor-pointer transition-colors">
                    Fetch Metadata
                  </button>
                </div>
              </div>
              
              <div class="space-y-2.5">
                  <div>
                    <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Custom Display Name</label>
                    <input v-model="editingNodeData.label" @input="saveChanges" placeholder="Enter Label" class="w-full bg-gray-50 dark:bg-gray-900/50 border border-gray-150 dark:border-gray-750 rounded-xl px-3 py-2 text-xs font-semibold outline-none text-gray-900 dark:text-white focus:border-purple-500 transition-colors" />
                  </div>
              
                  <div v-if="editingNodeData.type !== 'person'" class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Handle</label>
                      <input v-model="editingNodeData.username" @input="saveChanges" placeholder="@User" class="w-full bg-gray-50 dark:bg-gray-900/50 border border-gray-150 dark:border-gray-750 rounded-xl px-3 py-1.5 text-xs font-semibold outline-none text-gray-900 dark:text-white focus:border-purple-500 transition-colors" />
                    </div>
                    <div>
                      <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Link</label>
                      <input v-model="editingNodeData.link" @input="saveChanges" placeholder="URL Link" class="w-full bg-gray-50 dark:bg-gray-900/50 border border-gray-150 dark:border-gray-750 rounded-xl px-3 py-1.5 text-xs font-semibold outline-none text-gray-900 dark:text-white focus:border-purple-500 transition-colors" />
                    </div>
                  </div>

                  <div>
                    <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Facts & Bio Notes</label>
                    <textarea v-model="editingNodeData.facts" @input="saveChanges" placeholder="Dossier analytical bio notes..." class="w-full bg-gray-50 dark:bg-gray-900/50 border border-gray-150 dark:border-gray-750 rounded-xl p-3 text-xs font-semibold outline-none text-gray-900 dark:text-white h-20 focus:border-purple-500 transition-colors resize-none" />
                  </div>
              </div>

              <!-- In/Out Edges List -->
              <div class="pt-3 border-t border-gray-150 dark:border-gray-750 space-y-2 mt-2">
                  <div>
                    <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                      <ChevronRight class="w-3 h-3 text-gray-400" />
                      <span>Incoming Links ({{ getEdges.incoming.length }})</span>
                    </p>
                    <div class="max-h-24 overflow-y-auto space-y-1">
                      <div v-for="edge in getEdges.incoming" :key="edge.id()" class="w-full bg-gray-50 dark:bg-gray-900/35 p-2 rounded-xl text-[10px] border border-gray-200/50 dark:border-gray-750 truncate text-left flex justify-between items-center pr-2">
                         <button @click="selectEdge(edge)" class="truncate hover:text-purple-600 dark:hover:text-purple-400 font-bold cursor-pointer max-w-[85%] text-[10px]">
                           {{ edge.source().id() }} → ID Box
                         </button>
                         <button @click.stop="deleteEdge(edge)" class="text-rose-500 hover:text-rose-700 font-bold p-1 hover:bg-rose-500/10 rounded-md cursor-pointer transition-colors text-xs leading-none">×</button>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                      <ChevronRight class="w-3 h-3 text-gray-400" />
                      <span>Outgoing Links ({{ getEdges.outgoing.length }})</span>
                    </p>
                    <div class="max-h-24 overflow-y-auto space-y-1">
                      <div v-for="edge in getEdges.outgoing" :key="edge.id()" class="w-full bg-gray-50 dark:bg-gray-900/35 p-2 rounded-xl text-[10px] border border-gray-200/50 dark:border-gray-750 truncate text-left flex justify-between items-center pr-2">
                         <button @click="selectEdge(edge)" class="truncate hover:text-purple-600 dark:hover:text-purple-400 font-bold cursor-pointer max-w-[85%] text-[10px]">
                           ID Box → {{ edge.target().id() }}
                         </button>
                         <button @click.stop="deleteEdge(edge)" class="text-rose-500 hover:text-rose-700 font-bold p-1 hover:bg-rose-500/10 rounded-md cursor-pointer transition-colors text-xs leading-none">×</button>
                      </div>
                    </div>
                  </div>
              </div>
            </div>

            <!-- Edge Viewer -->
            <div v-else-if="selectedEdge" class="space-y-4">
              <div class="flex justify-between items-center pb-2 border-b border-gray-150 dark:border-gray-750">
                <div>
                  <p class="text-xs font-black text-gray-900 dark:text-white">Edge Relationship</p>
                  <p class="text-[9px] text-gray-400 dark:text-gray-550 font-mono mt-0.5">ID: {{ editingEdgeData.id }}</p>
                </div>
                <button v-if="editingEdgeData.label === 'channel'" @click="fetchChannelDates(editingEdgeData.target)" class="text-[9px] bg-teal-500/10 hover:bg-teal-500/20 text-teal-650 dark:text-teal-400 border border-teal-500/10 px-2.5 py-0.5 rounded-lg font-black uppercase cursor-pointer transition-colors">
                  Sync Target
                </button>
              </div>
              
              <div class="grid grid-cols-2 gap-2.5">
                <div>
                  <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Source Node ID</label>
                  <input v-model="editingEdgeData.source" @input="saveChanges" placeholder="Source" class="w-full bg-gray-50 dark:bg-gray-900/50 border border-gray-150 dark:border-gray-750 rounded-xl px-3 py-1.5 text-xs font-semibold outline-none text-gray-900 dark:text-white focus:border-purple-500 transition-colors" />
                </div>
                <div>
                  <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Target Node ID</label>
                  <input v-model="editingEdgeData.target" @input="saveChanges" placeholder="Target" class="w-full bg-gray-50 dark:bg-gray-900/50 border border-gray-150 dark:border-gray-750 rounded-xl px-3 py-1.5 text-xs font-semibold outline-none text-gray-900 dark:text-white focus:border-purple-500 transition-colors" />
                </div>
              </div>

              <div>
                <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Relationship Type</label>
                <input v-model="editingEdgeData.label" @input="saveChanges" placeholder="e.g. forward, mentions" class="w-full bg-gray-50 dark:bg-gray-900/50 border border-gray-150 dark:border-gray-750 rounded-xl px-3 py-2 text-xs font-semibold outline-none text-gray-900 dark:text-white focus:border-purple-500 transition-colors" />
              </div>

              <div>
                <label class="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Facts Context</label>
                <textarea v-model="editingEdgeData.facts" @input="saveChanges" placeholder="Enter association facts..." class="w-full bg-gray-50 dark:bg-gray-900/50 border border-gray-150 dark:border-gray-750 rounded-xl p-3 text-xs font-semibold outline-none text-gray-900 dark:text-white h-20 focus:border-purple-500 transition-colors resize-none" />
              </div>

              <div class="text-[9px] font-bold text-gray-400 dark:text-gray-500 flex items-center gap-1 bg-gray-50 dark:bg-gray-900/55 p-2 rounded-xl">
                <span>Created context:</span>
                <span class="font-mono text-gray-600 dark:text-gray-400">{{ editingEdgeData.createdAt || 'N/A' }}</span>
              </div>
            </div>
            </div>
            
            <div v-else class="text-center py-6 text-gray-400">
              <p class="text-xs font-medium">Select a node or relationship link on the graph</p>
            </div>
          </div>
        </div>
        
        <!-- Timeline Viewer Card -->
        <div class="mx-4 md:mx-6 min-h-[300px] border border-gray-200/80 dark:border-gray-750 bg-white dark:bg-gray-800 rounded-3xl mt-6 p-6 md:p-8 overflow-hidden relative shadow-sm" :style="{ height: `${Math.max(300, timelineRows.length * 56 + 180)}px` }">
           
           <!-- Timeline Header -->
           <div class="flex items-center justify-between mb-6 sticky left-0 right-0 z-10 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm pb-3 border-b border-gray-150 dark:border-gray-750">
                <div class="flex items-center gap-2.5">
                  <span class="p-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-500/10">
                    <Clock class="w-4 h-4" />
                  </span>
                  <div>
                    <h3 class="text-xs font-black uppercase tracking-wider text-gray-900 dark:text-white">Dossier Event Timeline</h3>
                    <p class="text-[10px] font-bold text-gray-400 dark:text-gray-500">Chronological analysis of registered interactions</p>
                  </div>
                </div>

                <!-- Zoom controls -->
                <div class="flex items-center gap-3">
                    <span class="text-[10px] font-mono font-black uppercase tracking-wide text-gray-500 bg-gray-50 dark:bg-gray-900 px-2.5 py-1 rounded-lg border border-gray-200/50 dark:border-gray-750 rounded-xl">Zoom: {{ zoomLevel.toFixed(1) }}x</span>
                    <button @click="resetZoom" class="text-[10px] font-black uppercase tracking-wide px-3 py-1 bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-650 rounded-xl text-gray-750 dark:text-gray-300 transition-colors border border-gray-205 dark:border-gray-750 cursor-pointer">Reset</button>
                </div>
           </div>
           
           <!-- Timeline Board -->
           <div 
             ref="timelineContainer"
             class="relative h-full cursor-grab active:cursor-grabbing overflow-hidden"
             @wheel.prevent="onTimelineWheel"
             @mousedown="onTimelineMouseDown"
             @mousemove="onTimelineMouseMove"
             @mouseup="onTimelineMouseUp"
             @mouseleave="onTimelineMouseLeave"
           >
              <div id="timeline-canvas" class="relative min-w-[max-content] p-2 pb-24" :style="{ 
                width: `${100 * zoomLevel}%`,
                left: `${-panOffset}px`
              }"> 
                <div class="hidden bg-green-700 bg-blue-700 bg-red-700 bg-purple-700 bg-indigo-700 bg-emerald-700 bg-rose-700 bg-cyan-700"></div>
                
                <div v-for="(row, rowIdx) in timelineRows" :key="rowIdx" class="relative h-8 mt-3 first:mt-0">
                    <div v-for="item in row" :key="item.id" 
                          class="absolute h-6 rounded-xl flex items-center px-3.5 text-[10px] text-white font-black uppercase tracking-wider whitespace-nowrap cursor-pointer shadow-md hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:z-10 border border-white/10" 
                          :style="{ 
                             left: `${((item.start - timelineRange.min) / (timelineRange.max - timelineRange.min)) * 100}%`,
                             width: `${Math.max(0.2, (((item.start === item.end ? item.start + 3600000 : item.end) - item.start) / Math.max(1, (timelineRange.max - timelineRange.min))) * 100)}%`
                          }"
                          :class="[item.color]"
                          @mouseenter="hoveredItem = item"
                          @mouseleave="hoveredItem = null"
                          @click.stop="focusNode(item.source)"
                    >
                          {{ item.source }}
                    </div>
                </div>

                <!-- Axis -->
                <div class="absolute bottom-6 left-0 w-full h-8 flex text-[9px] text-gray-400 dark:text-gray-550 pointer-events-none border-t border-gray-150 dark:border-gray-750 pt-2 font-mono">
                    <div v-for="tick in timelineTicks" :key="tick.time" class="absolute h-3 border-l border-gray-200 dark:border-gray-750" :style="{ left: `${tick.position}%` }">
                        <span class="absolute top-3 -translate-x-1/2 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 px-1.5 rounded whitespace-nowrap font-bold tracking-tight">{{ tick.label }}</span>
                    </div>
                </div>
              </div>
           </div>

           <!-- Hover Label -->
           <transition enter-active-class="transition duration-150 ease-out" enter-from-class="transform scale-95 opacity-0" enter-to-class="transform scale-100 opacity-100">
             <div v-if="hoveredItem" class="absolute left-1/2 -translate-x-1/2 bottom-12 bg-gray-900/95 dark:bg-gray-950/95 backdrop-blur-md text-white text-[10px] px-4 py-2.5 rounded-2xl shadow-xl z-50 pointer-events-none whitespace-nowrap border border-white/10 flex items-center gap-3">
                 <span class="font-black uppercase tracking-wider text-teal-400 pr-3 border-r border-gray-700 flex items-center gap-1">
                   <Clock class="w-3 h-3" />
                   <span>{{ hoveredItem.source }}</span>
                 </span>
                 <span class="font-semibold text-gray-300">{{ new Date(hoveredItem.start).toLocaleString() }} <span class="text-teal-550 mx-1">→</span> {{ new Date(hoveredItem.end).toLocaleString() }}</span>
             </div>
           </transition>
        </div>
        
        <!-- Analysis Result Section -->
        <transition enter-active-class="transition duration-300 ease-out" enter-from-class="transform scale-98 opacity-0" enter-to-class="transform scale-100 opacity-100">
          <div v-if="analysisResultOfGraph" class="mx-4 md:mx-6 mt-6 p-6 md:p-8 bg-gradient-to-br from-white to-amber-50/[0.12] dark:from-gray-800 dark:to-orange-950/20 rounded-3xl border border-amber-500/15 shadow-sm relative overflow-hidden space-y-4">
             <div class="absolute -right-24 -bottom-24 w-48 h-48 bg-amber-500/[0.03] rounded-full blur-3xl pointer-events-none"></div>
             
             <div class="flex items-center gap-2.5 pb-3 border-b border-gray-150 dark:border-gray-750">
               <span class="p-1.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/10">
                 <Sparkles class="h-4.5 w-4.5" />
               </span>
               <div>
                 <h2 class="text-xs font-black uppercase tracking-wider text-gray-900 dark:text-white">AI Studio Network Diagnosis</h2>
                 <p class="text-[10px] font-bold text-gray-400 dark:text-gray-500">Heuristic structural relationship findings</p>
               </div>
             </div>

             <div class="prose dark:prose-invert max-w-none text-xs text-gray-750 dark:text-gray-300 p-5 bg-white dark:bg-gray-900/40 border border-gray-150 dark:border-gray-750 rounded-2xl select-text font-semibold">
               <div class="prose-sm prose-pre:whitespace-pre-wrap leading-relaxed" v-html="renderedMarkdownOfGraph"></div>
             </div>
          </div>
        </transition>

        <!-- Extra bottom anchor spacer -->
        <div class="h-10"></div>
      </div>

      <!-- Monitor Tab -->
      <div v-show="activeTab === 'monitor'" class="space-y-6 max-w-[95%] mx-auto px-4 py-6">
        <!-- Overview Banner -->
        <div class="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h2 class="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Activity class="h-5 w-5 text-pink-500 animate-pulse" />
              <span>Real-Time Engine Monitor</span>
            </h2>
            <p class="text-sm text-gray-400 mt-1">
              Live statistics and object ingestion frequencies for public Telegram channel networks
            </p>
          </div>
          
          <div class="flex items-center gap-3">
            <button
              @click="fetchCounters"
              class="px-4 py-2 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-300 transition-colors flex items-center gap-2"
            >
              <RefreshCw class="h-4 w-4" />
              <span>Sync Metrics</span>
            </button>
            <div class="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-950/30 border border-green-200/50 dark:border-green-900/30 rounded-xl">
              <span class="h-2.5 w-2.5 rounded-full bg-green-500 animate-ping"></span>
              <span class="text-xs font-semibold text-green-700 dark:text-green-400">Live Connection</span>
            </div>
          </div>
        </div>

        <!-- Metric Details Bento Grid -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Pending Workload & Activity Status Card -->
          <div class="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 p-6 rounded-3xl border border-blue-100 dark:border-blue-900/30 shadow-sm flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold font-mono uppercase tracking-wider text-blue-600 dark:text-blue-400">Pending Jobs</span>
                <span class="p-1.5 bg-blue-100 dark:bg-blue-900/40 rounded-lg text-blue-600 dark:text-blue-400">
                  <Activity class="h-4 w-4" />
                </span>
              </div>
              <div class="mt-4">
                <p class="text-3xl font-black text-gray-900 dark:text-white tabular-nums">
                  {{ pendingJobs !== null ? pendingJobs : '0' }}
                </p>
                <p class="text-xs text-gray-400 mt-1">
                  Jobs queued in GSO executor waiting to be evaluated
                </p>
              </div>
            </div>
            
            <div class="mt-6 pt-4 border-t border-blue-100 dark:border-blue-900/20 flex items-center justify-between text-xs">
              <span class="text-gray-500">Status</span>
              <span class="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <CheckCircle2 class="h-3.5 w-3.5" />
                <span>Executor Idle</span>
              </span>
            </div>
          </div>

          <!-- Total Metrics Catalogued Card -->
          <div class="bg-gradient-to-br from-pink-50 to-rose-50 dark:from-pink-950/20 dark:to-rose-950/20 p-6 rounded-3xl border border-pink-100 dark:border-pink-900/30 shadow-sm flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold font-mono uppercase tracking-wider text-pink-600 dark:text-pink-400">Captured Objects Today</span>
                <span class="p-1.5 bg-pink-100 dark:bg-pink-900/40 rounded-lg text-pink-600 dark:text-pink-400">
                  <Layers class="h-4 w-4" />
                </span>
              </div>
              <div class="mt-4">
                <p class="text-3xl font-black text-gray-900 dark:text-white tabular-nums">
                  {{ Object.values(counters).reduce((a, b) => a + b, 0).toLocaleString() }}
                </p>
                <p class="text-xs text-gray-400 mt-1">
                  Combined telemetric events processed in past 24 hours
                </p>
              </div>
            </div>
            
            <div class="mt-6 pt-4 border-t border-pink-100 dark:border-pink-900/20 flex items-center justify-between text-xs">
              <span class="text-gray-500">Sync Interval</span>
              <span class="font-bold text-pink-600 dark:text-pink-400">30s Refreshed</span>
            </div>
          </div>

          <!-- Network Diagnostics Card -->
          <div class="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold font-mono uppercase tracking-wider text-gray-500 dark:text-gray-400">System Clock (UTC)</span>
                <span class="p-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-500 dark:text-gray-400 font-mono">
                  <Clock class="h-4 w-4" />
                </span>
              </div>
              <div class="mt-4">
                <h3 class="text-base font-black text-gray-900 dark:text-white font-mono leading-none tracking-tight">
                  2026-05-30
                </h3>
                <p class="text-xl font-bold text-gray-600 dark:text-gray-400 font-mono mt-1">
                  {{ String(new Date().getUTCHours()).padStart(2, '0') }}:{{ String(new Date().getUTCMinutes()).padStart(2, '0') }}:{{ String(new Date().getUTCSeconds()).padStart(2, '0') }} UTC
                </p>
              </div>
            </div>
            
            <div class="mt-6 pt-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs">
              <span class="text-gray-500">Region</span>
              <span class="font-bold text-gray-700 dark:text-gray-300">Global Cluster</span>
            </div>
          </div>
        </div>

        <!-- In-Depth Object Ingestion Status -->
        <div class="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-sm font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">Inbound Event Stream Channels</h3>
            <span class="text-xs bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full text-gray-700 dark:text-gray-300 font-mono">
              {{ Object.keys(counters).length }} active event types
            </span>
          </div>
          
          <div v-if="Object.keys(counters).length === 0" class="flex flex-col items-center justify-center py-12 text-gray-400">
            <LoaderCircle class="h-8 w-8 animate-spin mb-3 text-pink-500" />
            <p class="text-sm">Retrieving diagnostic data stream...</p>
          </div>

          <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
              v-for="(count, type) in counters"
              :key="type"
              class="px-5 py-4 bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-850 flex items-center justify-between gap-4 hover:border-pink-500/30 transition-colors duration-300"
            >
              <div class="min-w-0">
                <span class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest block mb-1">
                  {{ type }}
                </span>
                <span class="text-2xl font-black text-gray-900 dark:text-white tabular-nums">
                  {{ count.toLocaleString() }}
                </span>
              </div>
              <div class="text-right flex flex-col items-end gap-1 shrink-0">
                <span
                  class="text-xs font-bold font-mono px-2 py-0.5 rounded-lg"
                  :class="[
                    frequencies[type] > 0
                      ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                  ]"
                >
                  <span v-if="frequencies[type] > 0" class="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-ping mr-1"></span>
                  {{ frequencies[type] !== undefined ? frequencies[type].toFixed(2) : '0.00' }} obj/s
                </span>
                <span class="text-[10px] text-gray-400">Ingress Rate</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Listen Tab -->
      <div v-show="activeTab === 'listen'" class="space-y-6 w-full max-w-[98%] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <!-- Main Panel Split Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          <!-- Left directory tree widget (col-span-4) -->
          <div class="lg:col-span-4 bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden flex flex-col min-h-[800px]">
            <!-- Watchlist Header -->
            <div class="p-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
              <div>
                <h3 class="text-sm font-black uppercase tracking-wider text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Radio class="h-4 w-4 text-teal-500 animate-pulse" />
                  <span>Listen Directory</span>
                </h3>
                <p class="text-[11px] text-gray-400 mt-0.5">Hierarchical live watchlists</p>
              </div>
              <div class="flex items-center gap-1.5 self-end sm:self-auto">
                <button
                  @click="openAddModal('', true)"
                  class="px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 flex items-center gap-1 transition-colors"
                  title="Add Root Folder"
                >
                  <FolderPlus class="h-3 w-3 text-yellow-500" />
                  <span>Folder</span>
                </button>
                <button
                  @click="openAddModal('', false)"
                  class="px-2 py-1 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/30 dark:hover:bg-teal-900/30 rounded-lg text-xs font-bold text-teal-600 dark:text-teal-400 flex items-center gap-1 transition-colors"
                  title="Add Root Listen"
                >
                  <Plus class="h-3 w-3" />
                  <span>Listen</span>
                </button>
              </div>
            </div>

            <!-- Scrollable Directories Stream -->
            <div class="p-3 overflow-y-auto flex-1 space-y-1 select-none max-h-[750px]">
              <div v-if="visibleDirectoryNodes.length === 0" class="flex flex-col items-center justify-center py-16 text-center text-gray-400 dark:text-gray-500">
                <Inbox class="h-10 w-10 mb-2 opacity-50" />
                <p class="text-xs">No watchlists configured.</p>
                <p class="text-[10px] opacity-75 mt-1">Click the action buttons above to get started.</p>
              </div>

              <div
                v-for="node in visibleDirectoryNodes"
                :key="node.item.id"
                class="group text-sm font-medium rounded-xl transition-all duration-200 flex items-center justify-between px-3 py-2 border relative"
                draggable="true"
                @dragstart="onDragStart($event, node)"
                @dragover="onDragOver($event, node)"
                @dragend="onDragEnd"
                @drop="onDrop($event, node)"
                :class="[
                  selectedListenNode && selectedListenNode.id === node.item.id
                    ? 'bg-teal-50 hover:bg-teal-100/80 border-teal-100 text-teal-700 dark:bg-teal-950/20 dark:hover:bg-teal-900/10 dark:border-teal-900/30 dark:text-teal-400'
                    : 'bg-transparent hover:bg-gray-50 border-transparent text-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40',
                  dragOverNode && dragOverNode.item.id === node.item.id && dragOverPosition === 'inside'
                    ? 'border-dashed border-teal-500 bg-teal-50/30 dark:bg-teal-950/20 scale-[0.98]'
                    : '',
                  draggedNode && draggedNode.item.id === node.item.id
                    ? 'opacity-40 border-dashed border-gray-300 dark:border-gray-600'
                    : ''
                ]"
                :style="{ paddingLeft: `calc(0.5rem + ${node.depth * 1.25}rem)` }"
              >
                <!-- Drop indicator lines -->
                <div v-if="dragOverNode && dragOverNode.item.id === node.item.id && dragOverPosition === 'before'" class="absolute top-0 left-0 right-0 h-0.5 bg-teal-500 z-50 pointer-events-none"></div>
                <div v-if="dragOverNode && dragOverNode.item.id === node.item.id && dragOverPosition === 'after'" class="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 z-50 pointer-events-none"></div>

                <!-- Indent guidance bar -->
                <div 
                  v-if="node.depth > 0" 
                  class="absolute top-0 bottom-0 border-l border-gray-100 dark:border-gray-700/60"
                  :style="{ left: `calc(${node.depth * 1.25}rem - 0.25rem)` }"
                ></div>

                <!-- Drag handle/grip -->
                <div class="cursor-grab text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 shrink-0 relative z-30 mr-1" title="Drag node to move or reorder">
                  <GripVertical class="h-3 w-3" />
                </div>

                <!-- Interaction click targets -->
                <div 
                  @click="selectListenItem(node.item)"
                  class="flex items-center gap-2 min-w-0 flex-1 cursor-pointer relative z-10"
                >
                  <!-- Arrow indicators for directories/folders -->
                  <span v-if="node.item.isFolder" class="text-gray-400 dark:text-gray-500 shrink-0">
                    <ChevronDown v-if="node.isExpanded" class="h-3.5 w-3.5" />
                    <ChevronRight v-else class="h-3.5 w-3.5" />
                  </span>
                  <span v-else class="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                    <span 
                      class="h-1.5 w-1.5 rounded-full"
                      :class="[
                        node.item.type === 'channel' ? 'bg-orange-400' : 'bg-cyan-400'
                      ]"
                    ></span>
                  </span>

                  <!-- Folder / File icon indicators -->
                  <component 
                    :is="node.item.isFolder ? Folder : Radio" 
                    class="h-4 w-4 shrink-0"
                    :class="[
                      node.item.isFolder 
                        ? 'text-yellow-500 dark:text-yellow-600 fill-yellow-500/10'
                        : selectedListenNode && selectedListenNode.id === node.item.id
                          ? 'text-teal-500' 
                          : 'text-gray-400 dark:text-gray-500'
                    ]"
                  />

                  <span class="truncate font-semibold tracking-tight text-xs sm:text-sm">
                    {{ node.item.name }}
                  </span>
                </div>

                <!-- Action Button Hover Overlay -->
                <div class="flex items-center gap-1 relative z-20 shrink-0 pl-1">
                  <!-- Add submenu trigger to folders -->
                  <button
                    v-if="node.item.isFolder"
                    @click.stop="openAddModal(node.item.id, false)"
                    class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md text-gray-400 hover:text-teal-500 transition-colors"
                    title="Add Listen Item here"
                  >
                    <Plus class="h-3 w-3" />
                  </button>
                  <button
                    v-if="node.item.isFolder"
                    @click.stop="openAddModal(node.item.id, true)"
                    class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md text-gray-400 hover:text-yellow-500 transition-colors"
                    title="Add Subfolder here"
                  >
                    <FolderPlus class="h-3 w-3" />
                  </button>

                  <!-- Edit configs -->
                  <button
                    @click.stop="openEditModal(node.item)"
                    class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md text-gray-400 hover:text-blue-500 transition-colors"
                    title="Edit Configs"
                  >
                    <Edit class="h-3 w-3" />
                  </button>

                  <!-- Delete node -->
                  <button
                    @click.stop="deleteListenItem(node.item.id, node.item.name)"
                    class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md text-gray-400 hover:text-red-500 transition-colors"
                    title="Delete item"
                  >
                    <Trash2 class="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Right telemetry posts viewer (col-span-8) -->
          <div class="lg:col-span-8 space-y-6">
            
            <!-- Empty state when no node is selected -->
            <div v-if="!selectedListenNode" class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col items-center justify-center p-8 py-24 text-center w-full min-h-[800px]">
              <div class="max-w-md mx-auto flex flex-col items-center">
                <div class="h-16 w-16 bg-teal-50 dark:bg-teal-950/20 rounded-full flex items-center justify-center text-teal-500 mb-6 border border-teal-100/50 dark:border-teal-900/20 scale-110">
                  <Radio class="h-8 w-8 text-teal-600 dark:text-teal-400 animate-pulse" />
                </div>
                <h3 class="text-lg font-black text-gray-900 dark:text-white uppercase tracking-wider">
                  Live Real-Time Listen Feed
                </h3>
                <p class="text-sm text-gray-400 mt-2 leading-relaxed">
                  Configure your listeners in the tree workspace on the left. Click on any public Telegram channel or Keyword tracker to wiretap inbound real-time feed alerts.
                </p>
                <div class="mt-6 flex flex-wrap gap-2 justify-center">
                  <span class="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full font-mono font-medium">Channel Listening</span>
                  <span class="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full font-mono font-medium">Keyword Filtering</span>
                  <span class="text-xs px-3 py-1 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 rounded-full font-mono font-bold flex items-center gap-1">
                    <span class="h-1.5 w-1.5 rounded-full bg-green-500 animate-ping"></span>
                    Polling engine ready
                  </span>
                </div>
              </div>
            </div>

            <!-- Active Listen feed pane -->
            <div v-else class="space-y-6 select-text">
              <!-- Active Info Header -->
              <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <span 
                      class="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full"
                      :class="[
                        selectedListenNode.type === 'channel'
                          ? 'bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 border border-orange-100 dark:border-orange-900/30'
                          : 'bg-cyan-50 dark:bg-cyan-950/30 text-cyan-600 dark:text-cyan-400 border border-cyan-100 dark:border-cyan-900/30'
                      ]"
                    >
                      Telegram {{ selectedListenNode.type }}
                    </span>
                    <span v-if="listenAutoRefreshActive" class="text-[10px] bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider animate-pulse flex items-center gap-1">
                      <span class="h-1.5 w-1.5 bg-green-500 rounded-full"></span>
                      Listening Live
                    </span>
                  </div>
                  <h2 class="text-xl font-black text-gray-900 dark:text-white tracking-tight">
                    {{ selectedListenNode.name }}
                  </h2>
                  <div class="text-xs font-mono text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Target: <strong class="text-gray-700 dark:text-gray-200">{{ selectedListenNode.argument }}</strong></span>
                    <span>Created: <strong>{{ new Date(selectedListenNode.create_time).toLocaleDateString() }}</strong></span>
                    <span v-if="listenPosts && listenPosts.length > 0">
                      Newest: <strong class="text-teal-600 dark:text-teal-400">{{ formatDate(listenPosts[0]?.data?.date) }}</strong>
                    </span>
                  </div>
                  <p v-if="selectedListenNode.description" class="text-xs text-gray-550 dark:text-gray-400 italic max-w-xl">
                    {{ selectedListenNode.description }}
                  </p>
                </div>

                <!-- Listen Control Bar -->
                <div class="flex items-center gap-2 self-start md:self-center shrink-0">
                  <!-- Local Saved Post Counter Badge with Clear Button -->
                  <div class="flex items-center bg-gray-100 dark:bg-gray-800/80 px-3 py-1.5 rounded-xl border border-gray-200/50 dark:border-gray-700/50 text-xs font-semibold text-gray-600 dark:text-gray-300 gap-1.5">
                    <Database class="h-3.5 w-3.5 text-teal-500" />
                    <span>{{ listenPosts.length }} cached</span>
                    <button
                      v-if="listenPosts.length > 0"
                      @click="clearCachedListenPosts"
                      class="ml-1 p-0.5 text-gray-400 hover:text-red-500 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                      title="Clear Cached Posts"
                    >
                      <X class="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <button
                    @click="toggleListenAutoRefresh"
                    class="px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 transition-all duration-300"
                    :class="[
                      listenAutoRefreshActive
                        ? 'bg-green-600 hover:bg-green-700 text-white shadow-md shadow-green-600/10'
                        : 'bg-gray-150 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                    ]"
                  >
                    <span 
                      class="h-2 w-2 rounded-full bg-white block" 
                      :class="[listenAutoRefreshActive ? 'animate-ping' : '']"
                    ></span>
                    <span>{{ selectedListenNode?.type === 'keyword' ? '30s' : '15s' }} Live Polling: {{ listenAutoRefreshActive ? 'ON' : 'OFF' }}</span>
                  </button>

                  <button
                    @click="fetchListenPosts(selectedListenNode)"
                    class="p-2 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl text-gray-500 dark:text-gray-300 transition-colors"
                    title="Manual Sync"
                    :disabled="isFetchingListenPosts"
                  >
                    <RefreshCw class="h-4 w-4" :class="[isFetchingListenPosts ? 'animate-spin' : '']" />
                  </button>
                </div>
              </div>

              <!-- Channel Metadata Widget -->
              <div v-if="selectedListenNode.type === 'channel'" class="transition-all duration-300">
                <!-- Loading Metadata state -->
                <div v-if="isFetchingChannelMetadata" class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 flex items-center justify-center gap-3 text-gray-500 text-xs">
                  <LoaderCircle class="h-4 w-4 animate-spin text-teal-500" />
                  <span>Fetching channel profile...</span>
                </div>
                
                <!-- Display Metadata state -->
                <div v-else-if="selectedChannelMetadata" class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden flex flex-col md:flex-row items-stretch">
                  <!-- Left accent gradient and avatar bar -->
                  <div class="bg-gradient-to-br from-teal-500/20 to-teal-600/5 dark:from-teal-950/40 dark:to-teal-900/10 p-6 flex flex-row md:flex-col items-center justify-center gap-4 border-b md:border-b-0 md:border-r border-gray-150 dark:border-gray-700 md:w-48 shrink-0 select-none">
                    <div class="w-16 h-16 rounded-full bg-white dark:bg-gray-800 border-2 border-teal-100 dark:border-teal-900/40 shadow-md overflow-hidden shrink-0 flex items-center justify-center">
                      <img
                        :src="`https://i.gogingko.net/api/v1/v/telegram-profile/${selectedChannelMetadata.username || selectedChannelMetadata.name || selectedListenNode.argument}`"
                        @error="handleImageError"
                        alt="Channel Avatar"
                        class="w-full h-full object-cover"
                      />
                    </div>
                    <div class="text-center md:text-center flex-1">
                      <h4 class="text-xs font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">
                        @{{ selectedChannelMetadata.username || selectedChannelMetadata.name || selectedListenNode.argument }}
                      </h4>
                      <span v-if="selectedChannelMetadata.subscribers || selectedChannelMetadata.members || selectedChannelMetadata.participants_count" class="inline-flex items-center gap-1 text-[10px] bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 font-black px-2 py-0.5 rounded-full uppercase tracking-wider scale-95 border border-teal-100/50 dark:border-teal-900/20">
                        <Users class="h-3 w-3" />
                        {{ (selectedChannelMetadata.subscribers || selectedChannelMetadata.members || selectedChannelMetadata.participants_count).toLocaleString() }}
                      </span>
                    </div>
                  </div>

                  <!-- Right description & actions info -->
                  <div class="p-6 flex-1 flex flex-col justify-between gap-4">
                    <div class="space-y-2">
                      <div class="flex items-center justify-between gap-2 flex-wrap">
                        <div class="flex items-center gap-2">
                          <h3 class="text-base font-black text-gray-900 dark:text-white leading-tight">
                            {{ selectedChannelMetadata.title || selectedChannelMetadata.name }}
                          </h3>
                        </div>
                        <a
                          :href="`https://t.me/${selectedChannelMetadata.username || selectedListenNode.argument}`"
                          target="_blank"
                          class="inline-flex items-center gap-1.5 px-3 py-1 bg-teal-500 hover:bg-teal-600 text-white dark:bg-teal-600 dark:hover:bg-teal-700 text-[11px] font-bold rounded-xl shadow-sm transition-all shadow-teal-500/10 hover:-translate-y-0.5 shrink-0"
                        >
                          <ExternalLink class="h-3 w-3" />
                          <span>Join Channel</span>
                        </a>
                      </div>
                      <p v-if="selectedChannelMetadata.description || selectedChannelMetadata.about" class="text-xs text-gray-650 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words bg-gray-50/50 dark:bg-gray-800/50 p-3 rounded-2xl border border-gray-100/50 dark:border-gray-700/50">
                        {{ selectedChannelMetadata.description || selectedChannelMetadata.about }}
                      </p>
                      <p v-else class="text-xs text-gray-400 italic">No description provided for this channel.</p>
                    </div>

                    <!-- Additional mini details tags grid -->
                    <div class="flex flex-wrap gap-2 text-[10px] font-mono text-gray-400 border-t border-gray-100 dark:border-gray-700/60 pt-3">
                      <span v-if="selectedChannelMetadata.date || selectedChannelMetadata.createdAt">First Seen: <strong class="text-gray-600 dark:text-gray-300">{{ formatDate(selectedChannelMetadata.date || selectedChannelMetadata.createdAt) }}</strong></span>
                      <span v-if="selectedChannelMetadata._type">Type: <strong class="text-gray-600 dark:text-gray-300">{{ selectedChannelMetadata._type.split('.').pop() }}</strong></span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Stream Messages Feed Area -->
              <div class="space-y-6">
                
                <!-- Loading State -->
                <div v-if="isFetchingListenPosts && listenPosts.length === 0" class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col items-center justify-center py-20 text-gray-400">
                  <LoaderCircle class="h-10 w-10 animate-spin text-teal-500 mb-4" />
                  <p class="text-sm font-semibold text-gray-500">Connecting internal pipeline...</p>
                </div>

                <!-- Empty Feed alert -->
                <div v-else-if="listenPosts.length === 0" class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col items-center justify-center py-24 text-center max-w-sm mx-auto text-gray-400">
                  <Inbox class="h-12 w-12 mb-4 opacity-40 text-teal-400" />
                  <p class="text-sm font-bold text-gray-700 dark:text-gray-300">No intercepted logs found</p>
                  <p class="text-xs mt-1">This query didn't trigger any historical records, or the public service is currently offline.</p>
                </div>

                <!-- Active post list feeds cascade -->
                <div v-else class="space-y-6">
                  <div
                    v-for="(post, index) in listenPosts"
                    :key="post.key || index"
                    class="rounded-3xl shadow-sm border p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden bg-white dark:bg-gray-800"
                    :class="[
                      newlyFetchedListenKeys.has(post.key) || (post.id && newlyFetchedListenKeys.has(post.id))
                        ? 'border-amber-400 dark:border-amber-500 ring-2 ring-amber-500/20'
                        : 'border-gray-150 dark:border-gray-700'
                    ]"
                  >
                    <div class="absolute -top-10 -right-10 w-24 h-24 bg-teal-50/50 dark:bg-teal-900/10 rounded-full blur-2xl pointer-events-none"></div>

                    <!-- Quoted / Hover actions -->
                    <div class="absolute top-4 right-4 flex space-x-1.5 z-20">
                      <button
                        @click.stop="addToWorkspaceFromPost(post)"
                        class="text-[10px] font-bold text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors flex items-center bg-gray-100 dark:bg-gray-700 px-2.5 py-1 rounded-full"
                        title="Add to Workspace Analysis"
                      >
                        <Layers class="h-3 w-3 mr-1" /> Add
                      </button>
                      <button
                        @click.stop="sharePost(post)"
                        class="text-[10px] font-bold text-gray-400 hover:text-blue-650 dark:text-gray-400 dark:hover:text-blue-400 transition-colors flex items-center bg-gray-100 dark:bg-gray-700 px-2.5 py-1 rounded-full"
                        title="Share Links"
                      >
                        <Share2 class="h-3 w-3 mr-1" /> Share
                      </button>
                    </div>

                    <!-- Post top profile header card -->
                    <div class="flex justify-between items-start mb-4 relative z-10">
                      <div class="flex items-center space-x-3">
                        <div class="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center text-teal-600 dark:text-teal-400 font-bold text-sm overflow-hidden ring-1 ring-white dark:ring-gray-800 shadow-sm shrink-0">
                          <img
                            :src="getPostAvatarUrl(post)"
                            @error="handleImageError"
                            alt="TelegAvatar"
                            class="w-full h-full object-cover"
                          />
                        </div>
                        <div>
                          <h4 class="text-xs sm:text-sm font-extrabold text-gray-900 dark:text-white block hover:text-teal-500 transition-colors">
                            {{ post.data?.author || post.data?.user || selectedListenNode.name }}
                          </h4>
                          <div class="flex items-center gap-x-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-0.5">
                            <span>{{ formatDate(post.data?.date) }}</span>
                            <span v-if="post.mtime" class="text-[9px] text-teal-500 lowercase normal-case tracking-normal">
                              (Scraped {{ formatScrapedDate(post.mtime) }})
                            </span>
                            <span 
                              v-if="newlyFetchedListenKeys.has(post.key) || (post.id && newlyFetchedListenKeys.has(post.id))"
                              class="text-[9px] bg-amber-550 dark:bg-amber-500 text-white dark:text-white font-extrabold px-1.5 py-0.5 rounded-md tracking-wider animate-pulse inline-flex items-center"
                            >
                              NEW
                            </span>
                          </div>
                        </div>
                      </div>
                      <a
                        v-if="post.url || post.link"
                        :href="post.url || post.link"
                        target="_blank"
                        class="text-[10px] font-bold text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-350 transition-colors flex items-center bg-teal-50 dark:bg-teal-900/30 px-2 py-0.5 rounded-full shrink-0"
                      >
                        View TG <ExternalLink class="h-2.5 w-2.5 ml-0.5" />
                      </a>
                    </div>

                    <!-- Reply Segment Quoted -->
                    <div
                      v-if="post.data?.reply && post.data.reply.length >= 2"
                      class="mb-4 border-l-4 border-teal-400 dark:border-teal-500 bg-teal-50/30 dark:bg-teal-900/10 p-3.5 rounded-r-2xl relative z-10"
                    >
                      <div class="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-teal-600 dark:text-teal-400 mb-1">
                        <div class="flex items-center gap-1">
                          <Reply class="h-3 w-3" />
                          <span>Reply to Message</span>
                        </div>
                      </div>
                      <div class="text-gray-600 dark:text-gray-350 text-xs sm:text-sm whitespace-pre-wrap break-words italic line-clamp-2">
                        {{ post.data.reply[1] }}
                      </div>
                    </div>

                    <!-- Forward Subcard Segment -->
                    <div
                      v-if="post.data?.forward_url"
                      class="mb-4 border-l-4 border-purple-400 dark:border-purple-500 bg-purple-50/50 dark:bg-purple-900/10 p-3.5 rounded-r-2xl relative z-10"
                    >
                      <div class="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-1">
                        <div class="flex items-center gap-1">
                          <Forward class="h-3 w-3" />
                          <span>Forward</span>
                        </div>
                      </div>
                      <div class="text-gray-700 dark:text-gray-300 text-xs sm:text-sm whitespace-pre-wrap break-words italic">
                        {{ getForwardInfo(post)?.text || post.data.forward_url }}
                      </div>
                    </div>

                    <!-- Post content string messages -->
                    <div v-if="post.data?.content" class="flex items-start gap-2 mb-4 relative z-10">
                      <div 
                        v-html="post.key in translatedPosts ? highlightTextByKeywords(post.data.content) + '\n--------\n' + translatedPosts[post.key] : highlightTextByKeywords(post.data.content)"
                        class="text-gray-800 dark:text-gray-100 text-[14px] leading-relaxed whitespace-pre-wrap break-words flex-1"
                      ></div>
                      <button
                        @click="translatePost(post)"
                        class="p-1 -mt-1 text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-md transition-colors flex-shrink-0"
                        title="Translate contents"
                      >
                        <Languages v-if="!isTranslating[post.key]" class="h-4 w-4" />
                        <Loader2 v-else class="h-4 w-4 animate-spin" />
                      </button>
                    </div>

                    <!-- Contact details -->
                    <div
                      v-if="post.data?.contact && Object.keys(post.data.contact).length > 0"
                      class="mb-4 rounded-xl border border-blue-250 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-950/20 p-4 relative z-10"
                    >
                      <div class="flex items-center text-[10px] font-black tracking-widest text-blue-500 uppercase mb-2">
                        <User class="h-3.5 w-3.5 mr-1" /> Contact Shared
                      </div>
                      <div class="text-xs text-gray-800 dark:text-gray-300 font-mono">
                        {{ post.data.contact.first_name }} {{ post.data.contact.last_name }} 
                        <span v-if="post.data.contact.phone_number" class="block text-blue-500 mt-1 font-bold">{{ post.data.contact.phone_number }}</span>
                      </div>
                    </div>

                    <!-- Multimedia Embeddings photos -->
                    <div
                      v-if="post.data?.photos && post.data.photos.length > 0"
                      class="mb-4 rounded-2xl overflow-hidden shadow-sm border border-gray-150 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 group-cursor cursor-zoom-in max-w-sm"
                      @click="openLightbox(`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`)"
                    >
                      <img
                        :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`"
                        class="w-full h-auto max-h-[300px] object-cover transition-transform duration-700 hover:scale-105"
                        alt="TelegPhoto"
                        referrerpolicy="no-referrer"
                      />
                    </div>

                    <!-- Videos playables -->
                    <div
                      v-if="post.data?.videos && post.data.videos.length > 0"
                      class="mb-4 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-black max-w-sm shadow-sm"
                    >
                      <video controls class="w-full h-auto max-h-[300px]">
                        <source :src="getVideoUrl(post)" type="video/mp4" />
                      </video>
                    </div>

                    <!-- Link Metadata Embeds -->
                    <div
                      v-if="post.data?.linkPreview"
                      class="mb-3 rounded-2xl overflow-hidden border border-gray-150 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/10 flex flex-col sm:flex-row shadow-sm hover:shadow-md transition-shadow shrink-0"
                    >
                      <div
                        v-if="post.data.linkPreview.image"
                        class="sm:w-24 sm:h-24 shrink-0 bg-gray-200 dark:bg-gray-800 overflow-hidden cursor-zoom-in"
                        @click="openLightbox(`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`)"
                      >
                        <img
                          :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`"
                          class="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                          alt="PreTelegPhoto"
                        />
                      </div>
                      <div class="p-4 flex-1 min-w-0">
                        <div class="text-[10px] font-black uppercase tracking-widest text-teal-500 truncate mb-1">
                          {{ post.data.linkPreview.site_name || 'Embed Webpage' }}
                        </div>
                        <a
                          v-if="post.data.linkPreview.url"
                          :href="post.data.linkPreview.url"
                          target="_blank"
                          class="text-xs sm:text-sm font-bold text-gray-950 dark:text-gray-100 hover:text-blue-500 hover:underline transition-colors block line-clamp-1 mb-1"
                        >
                          {{ post.data.linkPreview.title || 'Embed Link URL' }}
                        </a>
                        <p v-if="post.data.linkPreview.description" class="text-xs text-gray-400 dark:text-gray-500 line-clamp-2">
                          {{ post.data.linkPreview.description }}
                        </p>
                      </div>
                    </div>

                    <!-- Bottom Metadata Bar -->
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
                          class="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-[10px] text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
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

                  </div>
                </div>

              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- Add/Edit Directory Item Modal Popup -->
      <div 
        v-if="isListenModalOpen" 
        class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm"
        @click.self="isListenModalOpen = false"
      >
        <div class="w-full max-w-lg bg-white dark:bg-gray-800 rounded-3xl overflow-hidden shadow-2xl border border-gray-150 dark:border-gray-700 animate-in fade-in zoom-in duration-300">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4 border-b border-gray-150 dark:border-gray-700 pb-3">
              <h3 class="text-base sm:text-lg font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                <component :is="listenItemForm.isFolder ? FolderOpen : Radio" class="h-5 w-5 text-teal-500" />
                <span>{{ isEditingListenItem ? 'Modify Configurations' : listenItemForm.isFolder ? 'Add Watch Directory' : 'Add Telemetry Monitor' }}</span>
              </h3>
              <button @click="isListenModalOpen = false" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg p-1">
                <X class="h-5 w-5" />
              </button>
            </div>

            <div class="space-y-4">
              <!-- Name inputs -->
              <div>
                <label class="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Node Name Label</label>
                <input
                  v-model="listenItemForm.name"
                  type="text"
                  placeholder="e.g. Durov Crypto Chat, Web3 Alerts"
                  class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-750 bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>

              <!-- Only show metadata fields if NOT a folder -->
              <div v-if="!listenItemForm.isFolder" class="space-y-4 animate-in fade-in duration-200">
                <div class="grid grid-cols-2 gap-4">
                  <!-- Type select options -->
                  <div>
                    <label class="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Stream Type</label>
                    <select
                      v-model="listenItemForm.type"
                      class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-750 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                    >
                      <option value="channel">Telegram Channel</option>
                      <option value="keyword">Search Keywords</option>
                    </select>
                  </div>

                  <!-- Argument inputs -->
                  <div>
                    <label class="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                      {{ listenItemForm.type === 'channel' ? 'Channel Username' : 'Filter Keyword Terms' }}
                    </label>
                    <input
                      v-model="listenItemForm.argument"
                      type="text"
                      :placeholder="listenItemForm.type === 'channel' ? 'e.g. durov' : 'e.g. solana, block'"
                      class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-750 bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                    />
                  </div>
                </div>
              </div>

              <!-- Description comments -->
              <div>
                <label class="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Description Context (Optional)</label>
                <textarea
                  v-model="listenItemForm.description"
                  rows="3"
                  placeholder="Brief annotations explaining what this stream monitors..."
                  class="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-750 bg-transparent text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                ></textarea>
              </div>
            </div>

            <!-- Footer Buttons -->
            <div class="mt-6 flex items-center justify-end gap-2.5 border-t border-gray-150 dark:border-gray-700 pt-4">
              <button
                @click="isListenModalOpen = false"
                class="px-4 py-2 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-xl text-sm font-semibold text-gray-750 dark:text-gray-300 transition-colors"
                >
                Cancel
              </button>
              <button
                @click="saveListenItemForm"
                :disabled="!listenItemForm.name.trim()"
                class="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold shadow-md shadow-teal-500/10 transition-colors"
              >
                Confirm Save
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Custom Delete Confirmation Modal -->
      <div 
        v-if="isDeleteConfirmOpen" 
        class="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm"
        @click.self="isDeleteConfirmOpen = false"
      >
        <div class="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-2xl border border-gray-150 dark:border-gray-700 animate-in fade-in zoom-in duration-200">
          <div class="p-6">
            <div class="flex items-center gap-3 mb-4 text-red-500">
              <div class="p-2 bg-red-50 dark:bg-red-950/30 rounded-xl">
                <Trash2 class="h-6 w-6" />
              </div>
              <h3 class="text-base sm:text-lg font-extrabold text-gray-900 dark:text-white">
                Delete Item?
              </h3>
            </div>
            
            <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
              Are you sure you want to delete <span class="font-extrabold text-gray-900 dark:text-white">"{{ itemToDeleteName }}"</span>? This action is permanent and cannot be undone.
            </p>

            <div class="flex items-center justify-end gap-2.5">
              <button
                @click="isDeleteConfirmOpen = false"
                class="px-4 py-2 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-xl text-sm font-semibold text-gray-750 dark:text-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                @click="confirmDeleteListenItem"
                class="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold shadow-md shadow-red-500/10 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

       <!-- Auto Finding Tab -->
      <div v-show="activeTab === 'auto-finding'" class="space-y-6">
        <div class="max-w-[96rem] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10">
          <div
            class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-750 p-6 sm:p-8 mb-8 shadow-sm relative overflow-hidden"
          >
            <!-- Background Decoration -->
            <div
              class="absolute -top-20 -right-20 w-40 h-40 bg-teal-500/5 dark:bg-teal-500/10 rounded-full blur-3xl pointer-events-none"
            ></div>
            <div
              class="absolute -bottom-20 -left-20 w-40 h-40 bg-indigo-500/5 dark:bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"
            ></div>

            <div class="relative z-10 space-y-8">
              <!-- Top parameters grid -->
              <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                <!-- Left panel: Configuration (5 cols) -->
                <div class="lg:col-span-5 bg-gray-50/50 dark:bg-gray-900/40 border border-gray-150/45 dark:border-gray-850/40 p-5 rounded-2xl space-y-5">
                  <div class="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-gray-800">
                    <SlidersHorizontal class="h-4 w-4 text-teal-600 dark:text-teal-400" />
                    <h3 class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">Params Setup</h3>
                  </div>

                  <!-- Select Mode -->
                  <div class="space-y-2">
                    <label class="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">Search Target Mode</label>
                    <div
                      class="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-150 dark:border-gray-850 p-1 rounded-xl"
                    >
                      <button
                        @click="searchMode = 'channel'"
                        :disabled="isAutoFinding"
                        :class="[
                          'flex-1 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 cursor-pointer',
                          isAutoFinding ? 'opacity-50 cursor-not-allowed' : '',
                          searchMode === 'channel'
                            ? 'bg-teal-600 text-white shadow-sm shadow-teal-500/10'
                            : 'text-gray-450 hover:text-gray-600 dark:hover:text-gray-300',
                        ]"
                      >
                        Channel
                      </button>
                      <button
                        @click="searchMode = 'user'"
                        :disabled="isAutoFinding"
                        :class="[
                          'flex-1 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 cursor-pointer',
                          isAutoFinding ? 'opacity-50 cursor-not-allowed' : '',
                          searchMode === 'user'
                            ? 'bg-teal-600 text-white shadow-sm shadow-teal-500/10'
                            : 'text-gray-450 hover:text-gray-600 dark:hover:text-gray-300',
                        ]"
                      >
                        User
                      </button>
                    </div>
                  </div>

                  <!-- Slider control -->
                  <div class="space-y-2">
                    <div class="flex justify-between items-center">
                      <label
                        class="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider"
                        >Iterations Limit</label
                      >
                      <span
                        class="text-[10px] font-mono font-bold text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-2 py-0.5 rounded border border-teal-100/50 dark:border-teal-900/10"
                        >Run Count: {{ numIterations }}</span
                      >
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="25"
                      v-model="numIterations"
                      class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-teal-600"
                    />
                  </div>
                </div>

                <!-- Right panel: Input Form & Guidance (7 cols) -->
                <div class="lg:col-span-7 space-y-5">
                  <div class="flex items-center gap-2">
                    <BotMessageSquare class="h-4 w-4 text-teal-650 dark:text-teal-400" />
                    <h3 class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">Execute Search</h3>
                  </div>

                  <!-- Input Form -->
                  <form @submit.prevent="runAutoFinding" class="relative group">
                    <div
                      class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none transition-transform duration-300 group-focus-within:scale-110 group-focus-within:text-teal-600 z-10"
                    >
                      <Search class="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      v-model="autoChannelName"
                      type="text"
                      class="block w-full pl-14 pr-[150px] py-4 border border-gray-200/90 dark:border-gray-700/90 rounded-2xl leading-5 bg-white/95 dark:bg-gray-800/95 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 text-sm font-semibold shadow-sm hover:shadow-md focus:shadow-lg transition-all duration-300"
                      :placeholder="
                        searchMode === 'channel'
                          ? 'Enter channel name (e.g. durov)'
                          : 'Enter user name (e.g. user_id)'
                      "
                    />
                    <button
                      type="submit"
                      :disabled="isAutoFinding || !autoChannelName.trim()"
                      class="absolute right-2 top-2 bottom-2 px-6 bg-teal-600 text-white rounded-xl text-xs font-black tracking-wide hover:bg-teal-700 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center shadow-md shadow-teal-500/20 hover:shadow-teal-500/40 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                    >
                      <Loader2 v-if="isAutoFinding" class="h-4 w-4 animate-spin mr-2" />
                      {{ isAutoFinding ? "Finding..." : "Start Finding" }}
                    </button>
                  </form>

                  <!-- Quick Guidance Info Tip -->
                  <div class="bg-teal-50/[0.18] dark:bg-teal-950/[0.08] p-4 rounded-2xl border border-teal-100/30 dark:border-teal-900/20 text-xs text-gray-500 dark:text-gray-450 flex items-start gap-3">
                    <Info class="h-4 w-4 text-teal-600 shrink-0 mt-0.5" />
                    <p class="leading-relaxed">
                      Auto Sequence Finding automatically traces consecutive indices back-to-back to extract, translate, and synthesize an intelligence grid from available channels or individual users.
                    </p>
                  </div>
                </div>

              </div>

              <!-- Saved Profiles Row (Always beautifully visible when profiles list exists) -->
              <div v-if="savedProfiles.channel.length > 0 || savedProfiles.user.length > 0" class="pt-6 border-t border-gray-100 dark:border-gray-700/50 space-y-4">
                <div class="flex items-center gap-2">
                  <Database class="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <h4 class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">Local Archives Directory</h4>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <!-- Channels Column -->
                  <div v-if="savedProfiles.channel.length > 0" class="bg-gray-50/50 dark:bg-gray-900/30 p-4 rounded-2xl border border-gray-150/40 dark:border-gray-850/40 space-y-2.5">
                    <h5 class="text-[10px] font-black text-teal-650 dark:text-teal-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span class="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                      <span>Saved Channel Scrapes</span>
                    </h5>
                    <div class="flex flex-wrap gap-2">
                      <button 
                        v-for="name in savedProfiles.channel" 
                        :key="name" 
                        @click="viewSavedProfile('channel', name)" 
                        class="px-3 py-1.5 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-150/50 dark:border-gray-750 rounded-xl hover:bg-teal-50/50 dark:hover:bg-teal-950/20 hover:text-teal-600 dark:hover:text-teal-400 text-gray-700 dark:text-gray-300 cursor-pointer shadow-sm transition-colors"
                      >
                        @{{ name }}
                      </button>
                    </div>
                  </div>

                  <!-- Users Column -->
                  <div v-if="savedProfiles.user.length > 0" class="bg-gray-50/50 dark:bg-gray-900/30 p-4 rounded-2xl border border-gray-150/40 dark:border-gray-850/40 space-y-2.5">
                    <h5 class="text-[10px] font-black text-indigo-650 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span class="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                      <span>Saved User Scrapes</span>
                    </h5>
                    <div class="flex flex-wrap gap-2">
                      <button 
                        v-for="name in savedProfiles.user" 
                        :key="name" 
                        @click="viewSavedProfile('user', name)" 
                        class="px-3 py-1.5 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-150/50 dark:border-gray-750 rounded-xl hover:bg-teal-50/50 dark:hover:bg-teal-950/20 hover:text-teal-600 dark:hover:text-teal-400 text-gray-700 dark:text-gray-300 cursor-pointer shadow-sm transition-colors"
                      >
                        @{{ name }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Saved Final Table Insight display -->
              <div
                v-if="savedFinalTableHtml"
                class="w-full mt-6 bg-gradient-to-br from-white to-teal-50/[0.12] dark:from-gray-900 dark:to-gray-950 p-6 rounded-3xl border border-teal-150/40 dark:border-teal-900/10 shadow-sm prose dark:prose-invert max-w-none text-sm relative overflow-hidden"
              >
                <!-- subtle gradient highlight -->
                <div class="absolute -top-12 -right-12 w-24 h-24 bg-teal-500/5 dark:bg-teal-500/5 rounded-full blur-xl pointer-events-none"></div>

                <div class="flex items-center gap-2 mb-4">
                  <div
                    class="w-8 h-8 rounded-xl bg-teal-50 dark:bg-teal-950/50 border border-teal-105 dark:border-teal-900/30 flex items-center justify-center shadow-sm"
                  >
                    <Sparkles class="w-4 h-4 text-teal-650 dark:text-teal-400" />
                  </div>
                  <h5
                    class="text-xs font-black text-teal-800 dark:text-teal-100 uppercase tracking-wider"
                  >
                    Saved Final Analysis Insights
                  </h5>
                </div>
              
                <div class="flex items-center justify-between gap-4 mb-4 pb-2 border-b border-gray-100 dark:border-gray-800">
                    <h3 class="text-base font-extrabold text-gray-900 dark:text-gray-100">@{{ savedProfileName }}</h3>
                    <button @click="handleSaveRemote(savedProfileName)" class="text-[10px] font-black bg-teal-600 text-white px-3.5 py-1.5 rounded-lg hover:bg-teal-700 shadow-sm cursor-pointer transition-colors">Save Remotely</button>
                </div>
                <div v-html="savedFinalTableHtml" class="prose-sm overflow-x-auto"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Floating Post Tool Widget -->
        <div
          v-show="activeTab === 'auto-finding' && isPostFetcherVisible"
          :style="{
            position: 'fixed',
            left: postWidgetX + 'px',
            top: postWidgetY + 'px',
            zIndex: 100,
          }"
          class="w-80 bg-white/95 dark:bg-gray-800/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/80 dark:border-gray-700/80 flex flex-col p-4 cursor-default border-t-2 border-t-teal-500"
        >
          <div
            class="cursor-grab p-2.5 mb-3 bg-teal-500/[0.08] border-b border-teal-500/10 flex justify-between items-center rounded-xl"
            @mousedown.prevent="startDrag($event, 'post')"
          >
            <h2 class="text-xs font-black uppercase tracking-wider text-teal-600 dark:text-teal-400">
              Post Fetcher
            </h2>
            <GripHorizontal class="h-3.5 w-3.5 text-teal-500 animate-pulse" />
          </div>

          <form @submit.prevent="fetchSinglePost" class="relative group">
            <input
              v-model="singlePostId"
              type="text"
              class="block w-full pl-3 pr-20 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              placeholder="Enter unique Post ID..."
            />
            <button
              type="submit"
              :disabled="isFetchingPost"
              class="absolute right-1 top-1 bottom-1 px-3.5 bg-teal-600 text-white rounded-lg text-[10px] font-extrabold hover:bg-teal-700 cursor-pointer disabled:opacity-50 transition-colors"
            >
              {{ isFetchingPost ? "..." : "Fetch" }}
            </button>
          </form>
          <div
            v-if="singlePost"
            class="mt-3 flex-1 overflow-y-auto max-h-[300px] border border-gray-150 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/40 backdrop-blur-sm rounded-xl custom-scrollbar"
          >
            <div class="p-3">
              <!-- Header -->
              <div class="flex justify-between items-start mb-2.5">
                <div class="flex items-center space-x-2 min-w-0 pr-2">
                  <div
                    class="h-7 w-7 rounded-lg bg-teal-50 dark:bg-teal-950/40 border border-teal-100/30 flex-shrink-0 flex items-center justify-center text-teal-600 dark:text-teal-400"
                  >
                    <User class="h-3.5 w-3.5" />
                  </div>
                  <div class="min-w-0">
                    <h4
                      class="text-xs font-extrabold text-gray-900 dark:text-gray-100 truncate"
                    >
                      {{
                        singlePost.data?.author ||
                        singlePost.data?.user ||
                        "Anonymous"
                      }}
                    </h4>
                    <p
                      class="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5"
                    >
                      {{ formatDate(singlePost.data?.date) }}
                    </p>
                  </div>
                </div>
                <span
                  v-if="singlePost.key"
                  class="font-mono bg-white dark:bg-gray-800 border border-gray-205 dark:border-gray-700 px-1.5 py-0.5 rounded shadow-sm text-[9px] text-gray-500 flex-shrink-0"
                >
                  #{{ singlePost.key }}
                </span>
              </div>

              <!-- Quoted Reply -->
              <div
                v-if="
                  singlePost.data?.reply && singlePost.data.reply.length >= 2
                "
                class="mb-3 border-l-4 border-teal-500 bg-teal-500/[0.03] dark:bg-teal-950/[0.15] p-2.5 rounded-r-xl border border-teal-100/30 dark:border-teal-900/10"
              >
                <div
                  class="flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 mb-1"
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
                    class="font-mono bg-teal-50 dark:bg-teal-950/40 px-1.5 py-0.2 rounded border border-teal-100/50 dark:border-teal-900/10 text-[9px] normal-case"
                    >ID:
                    {{
                      singlePost.data._tool
                        ? singlePost.data.reply[0]
                        : String(singlePost.data.reply[0]).split("/").pop()
                    }}</span
                  >
                </div>
                <div
                  class="text-gray-600 dark:text-gray-300 text-[11px] leading-relaxed whitespace-pre-wrap break-words italic line-clamp-3"
                  v-html="highlightText(singlePost.data.reply[1])"
                ></div>
              </div>

              <!-- Media Embedding (Photos, Videos, Links) -->
              <div
                v-if="
                  singlePost.data?.photos && singlePost.data.photos.length > 0
                "
                class="mb-2.5 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-black cursor-zoom-in group"
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
                class="mb-2.5 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-black"
              >
                <video controls class="w-full h-32 object-cover">
                  <source :src="getVideoUrl(singlePost)" type="video/mp4" />
                </video>
              </div>

              <!-- Content Body -->
              <div
                class="text-xs leading-relaxed text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words mt-1"
                v-html="highlightText(singlePost.data?.content || '')"
              ></div>

              <!-- Contact & Extras if needed -->
              <div
                v-if="singlePost.data?.contact"
                class="mt-2 text-[10px] font-semibold p-2.5 bg-teal-500/[0.02] dark:bg-teal-950/[0.10] border border-teal-150/40 dark:border-teal-900/10 rounded-xl flex items-center text-teal-600 dark:text-teal-400"
              >
                <Phone class="h-3.5 w-3.5 mr-1.5 text-teal-500" /> Contact Card Attached
              </div>

              <!-- Footer Stats / Links -->
              <div
                class="mt-3 pt-2 border-t border-gray-150 dark:border-gray-800 text-[10px] text-gray-400 dark:text-gray-500 flex items-center justify-between font-mono"
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
                  class="text-teal-6s0 dark:text-teal-400 hover:underline flex items-center hover:text-teal-600 transition-colors"
                >
                  View original <ExternalLink class="h-2.5 w-2.5 ml-1" />
                </a>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="autoCells.length === 0 && !isAutoFinding"
          class="text-center py-20 sm:py-24 max-w-lg mx-auto bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/60 dark:border-gray-700/60 p-8 shadow-sm my-8"
        >
          <div
            class="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-teal-50 dark:bg-teal-950/40 mb-6 shadow-inner ring-4 ring-teal-500/10 border-2 border-teal-100 dark:border-teal-850"
          >
            <BotMessageSquare
              class="h-8 w-8 text-teal-600 dark:text-teal-400 animate-pulse"
            />
          </div>
          <h2
            class="text-xl font-extrabold tracking-tight text-gray-900 dark:text-white mb-2"
          >
            Auto Sequence Finding
          </h2>
          <p
            class="text-gray-400 dark:text-gray-500 text-xs font-semibold leading-relaxed"
          >
            Enter a channel or user handle above to automatically trace, analyze, and verify continuous posts consecutively.
          </p>
        </div>

        <div
          v-else
          class="max-w-[96rem] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 space-y-6 pb-20"
        >
          <!-- Final Result Area -->
          <div
            v-if="autoCells.length > 0"
            class="w-full bg-white dark:bg-gray-800 rounded-3xl p-6 sm:p-8 border border-gray-200/60 dark:border-gray-700/60 shadow-sm relative overflow-hidden backdrop-blur-sm"
          >
            <!-- Background highlight -->
            <div
              class="absolute -top-12 -right-12 w-28 h-28 bg-emerald-500/5 dark:bg-emerald-500/5 rounded-full blur-2xl pointer-events-none"
            ></div>

            <h3
              class="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider mb-4 flex items-center"
            >
              <CheckCircle2 class="h-4.5 w-4.5 mr-2 text-teal-600 dark:text-teal-400" />
              Final Analysis Summary
            </h3>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              <p class="font-semibold flex items-center gap-2">
                <span>Iterations processed:</span>
                <span class="font-mono text-xs font-black px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400 border border-teal-100/30 dark:border-teal-900/30">
                  {{ autoCells.filter((c) => c.status === "completed").length }} / {{ autoCells.length }} completed
                </span>
              </p>

              <div
                v-if="isGeneratingFinalTable"
                class="mt-4 flex items-center text-teal-600 font-bold animate-pulse text-xs"
              >
                <Loader2 class="h-3.5 w-3.5 mr-2 animate-spin text-teal-500" />
                Synthesizing global timeline matrix...
              </div>

              <div
                v-if="finalTableHtml"
                class="mt-6 bg-gradient-to-br from-white to-teal-50/[0.08] dark:from-gray-900 dark:to-gray-950 p-6 sm:p-8 rounded-3xl border border-teal-150/40 dark:border-teal-900/10 shadow-xl shadow-teal-500/[0.02] prose dark:prose-invert max-w-none text-xs leading-relaxed"
              >
                <div class="flex items-center gap-2 mb-4">
                  <div
                    class="w-8 h-8 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-100/30 flex items-center justify-center shadow-sm"
                  >
                    <Sparkles class="w-4 h-4 text-teal-650 dark:text-teal-400" />
                  </div>
                  <h5
                    class="text-[10px] font-black text-teal-800 dark:text-teal-100 uppercase tracking-widest"
                  >
                    Final Analysis Insights
                  </h5>
                </div>
                <div v-html="finalTableHtml" class="prose-sm overflow-x-auto"></div>
              </div>
            </div>
          </div>

          <h3 class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider pt-2">
            Sequence Finding Cells & Logs
          </h3>
          <div
            v-for="cell in autoCells"
            :key="cell.id"
            class="bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-750 p-5 sm:p-6 rounded-3xl shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden"
          >
            <!-- Cell Header -->
            <div class="flex items-center justify-between gap-4 mb-4 pb-3 border-b border-gray-100 dark:border-gray-800">
              <span
                class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-gray-50 dark:bg-gray-900/60 text-gray-550 dark:text-gray-400 border border-gray-150/40 dark:border-gray-800"
              >
                Cell ID: {{ cell.id }}
                <Loader2
                  v-if="cell.status === 'running'"
                  class="h-3 w-3 ml-1 animate-spin text-teal-500"
                />
                <span
                  v-if="cell.status === 'error'"
                  class="ml-1 text-red-500 font-mono font-bold"
                  >● Offline Error</span
                >
                <span
                  v-else-if="cell.status === 'completed'"
                  class="ml-1 text-emerald-500 font-mono font-bold"
                  >● Verified</span
                >
              </span>
            </div>

            <!-- Content list -->
            <div class="space-y-4">
              <!-- Log Board -->
              <div
                class="bg-gray-950 text-emerald-400 border border-gray-900 p-4 rounded-2xl font-mono text-xs leading-relaxed max-h-40 overflow-y-auto custom-scrollbar shadow-inner"
              >
                <div v-for="(log, i) in cell.logs" :key="i" class="flex gap-2">
                  <span class="text-gray-600 shrink-0">[{{ i + 1 }}]</span>
                  <span>{{ log }}</span>
                </div>
              </div>

              <!-- Analysis Block -->
              <div
                v-if="cell.analysisResult"
                class="bg-gradient-to-br from-teal-500/[0.02] to-teal-500/[0.04] dark:from-teal-950/[0.12] dark:to-teal-950/[0.15] border border-teal-150/30 dark:border-teal-900/10 p-5 rounded-2xl"
              >
                <h5
                  class="text-[10px] font-black text-teal-700 dark:text-teal-400 uppercase tracking-widest mb-2 flex items-center gap-1"
                >
                  <Bot class="h-3.5 w-3.5" />
                  <span>Cognitive Intelligence Analysis</span>
                </h5>
                <div
                  class="prose dark:prose-invert prose-xs text-xs text-gray-700 dark:text-gray-300 leading-relaxed max-w-none"
                  v-html="md.render(cell.analysisResult)"
                ></div>
              </div>

              <!-- Verification Block -->
              <div
                v-if="cell.verificationResult"
                class="bg-gradient-to-br from-indigo-500/[0.02] to-indigo-500/[0.04] dark:from-indigo-950/[0.12] dark:to-indigo-950/[0.15] border border-indigo-150/30 dark:border-indigo-900/10 p-5 rounded-2xl"
              >
                <h5
                  class="text-[10px] font-black text-indigo-700 dark:text-indigo-400 uppercase tracking-widest mb-2 flex items-center gap-1"
                >
                  <CheckCircle2 class="h-3.5 w-3.5" />
                  <span>Sequence Verification Result</span>
                </h5>
                <div
                  class="prose dark:prose-invert prose-xs text-xs text-gray-700 dark:text-gray-300 leading-relaxed max-w-none"
                  v-html="md.render(cell.verificationResult)"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

       <!-- Profile Tab -->
      <div v-show="activeTab === 'profile'" class="max-w-[96rem] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pt-1 pb-24 space-y-10">
        
        <!-- Header Banner Section -->
        <div class="relative bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-750 p-6 md:p-8 shadow-sm overflow-hidden mb-2">
          <!-- Decorative gradients -->
          <div class="absolute -right-20 -top-20 w-44 h-44 bg-teal-500/[0.04] dark:bg-teal-500/[0.08] rounded-full blur-3xl pointer-events-none"></div>
          <div class="absolute -left-20 -bottom-20 w-44 h-44 bg-indigo-500/[0.04] dark:bg-indigo-500/[0.08] rounded-full blur-3xl pointer-events-none"></div>

          <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <span class="p-1.5 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400">
                  <User class="h-5 w-5" />
                </span>
                <span class="text-[10px] font-black text-teal-655 dark:text-teal-400 uppercase tracking-widest">Dossier Workspace</span>
              </div>
              <h2 class="text-xl md:text-2xl font-black text-gray-900 dark:text-white tracking-tight">Identity & User Profile Explorer</h2>
              <p class="text-xs text-gray-400 dark:text-gray-500 font-semibold max-w-xl">
                Scan Telegram user nodes, look up cached database entities, and query deep registry descriptors.
              </p>
            </div>

            <!-- Dashboard micro-indicator -->
            <div class="grid grid-cols-2 gap-4 md:flex md:items-center md:gap-6 text-[11px] font-semibold text-gray-400 dark:text-gray-500 shrink-0 self-stretch md:self-center border-t md:border-t-0 md:border-l border-gray-200/60 dark:border-gray-750 pt-4 md:pt-0 md:pl-6">
              <div class="space-y-1">
                <p class="text-[10px] uppercase font-black tracking-wider text-gray-400 dark:text-gray-500">History Pool</p>
                <p class="font-mono text-gray-900 dark:text-white font-bold">{{ lookupUserHistory.length }} lookups</p>
              </div>
              <div class="space-y-1">
                <p class="text-[10px] uppercase font-black tracking-wider text-gray-400 dark:text-gray-500">Registry Archives</p>
                <p class="font-mono text-gray-900 dark:text-white font-bold">{{ remoteProfiles.length }} catalogs</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Search Dossier Box Block -->
        <div class="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start w-full">
          
          <!-- Outer lookup panel -->
          <div class="col-span-12 xl:col-span-5 space-y-6 w-full">
            <div class="bg-white dark:bg-gray-800 border border-gray-200/75 dark:border-gray-750 rounded-3xl p-6 shadow-sm space-y-6 relative">
              <div class="space-y-1">
                <h3 class="text-xs font-black text-gray-900 dark:text-white uppercase tracking-wider">Search Identity Node</h3>
                <p class="text-[11px] text-gray-400 dark:text-gray-500 font-semibold">Provide an exact Telegram handle to extract remote server descriptors.</p>
              </div>

              <!-- Input dropdown wrap -->
              <div ref="dropdownContainer" class="relative">
                <div class="flex gap-2">
                  <div class="relative flex items-center bg-gray-50 dark:bg-gray-900 border border-gray-150 dark:border-gray-850 rounded-2xl px-4 py-2.5 shadow-sm focus-within:ring-2 focus-within:ring-teal-500/20 focus-within:border-teal-500 transition-all w-full">
                    <User class="h-4 w-4 text-teal-600 dark:text-teal-400 mr-2 shrink-0" />
                    <input 
                      v-model="telegramUsername" 
                      @keyup.enter="fetchTelegramUser" 
                      @focus="isHistoryVisible = true" 
                      @blur="handleBlur"
                      placeholder="e.g. durov, telegram" 
                      class="bg-transparent text-xs font-semibold outline-none text-gray-900 dark:text-white placeholder-gray-400 w-full" 
                    />
                  </div>
                  <button 
                    @click="fetchTelegramUser" 
                    class="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl text-xs font-black tracking-wide flex items-center justify-center gap-1.5 shadow-md shadow-teal-500/20 hover:shadow-teal-500/30 cursor-pointer transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 shrink-0"
                  >
                    <Search class="h-3.5 w-3.5" />
                    <span>Search</span>
                  </button>
                </div>
                
                <!-- Suggestions Dropdown -->
                <transition enter-active-class="transition duration-150 ease-out" enter-from-class="transform scale-95 opacity-0" enter-to-class="transform scale-100 opacity-100" leave-active-class="transition duration-100 ease-in" leave-from-class="transform scale-100 opacity-100" leave-to-class="transform scale-95 opacity-0">
                  <div v-if="isHistoryVisible && lookupUserHistory.length > 0" class="absolute z-50 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                    <div class="px-3.5 py-2 bg-gray-50/50 dark:bg-gray-900/30 text-[10px] font-black uppercase tracking-widest text-gray-400">
                      Recent Queries
                    </div>
                    <div 
                      v-for="user in lookupUserHistory" 
                      :key="user" 
                      class="w-full text-left px-3.5 py-2.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-750 text-gray-900 dark:text-white flex justify-between items-center group/item transition-colors"
                    >
                      <button @click="selectHistory(user)" class="flex-grow text-left font-semibold hover:text-teal-600 dark:hover:text-teal-400 cursor-pointer flex items-center gap-2">
                        <Clock class="h-3 w-3 text-gray-400" />
                        <span>@{{ user }}</span>
                      </button>
                      <button @click.stop="deleteHistory(user)" class="opacity-0 group-hover/item:opacity-100 p-1 text-gray-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg cursor-pointer transition-all">
                        <X class="w-3 h-3"/>
                      </button>
                    </div>
                  </div>
                </transition>
              </div>

              <!-- Loader and Error outputs -->
              <div v-if="loadingTelegramUser" class="flex flex-col items-center justify-center py-10 text-gray-400">
                <div class="relative h-10 w-10 animate-spin rounded-full border-[3px] border-teal-500 border-t-transparent flex items-center justify-center shadow-md mb-2">
                  <Bot class="h-4.5 w-4.5 text-teal-600 dark:text-teal-400 animate-pulse" />
                </div>
                <p class="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400 animate-pulse">Syncing User profile...</p>
              </div>

              <div v-if="telegramError" class="rounded-2xl bg-rose-500/[0.04] p-4 border border-rose-500/10 flex items-start gap-3">
                <AlertCircle class="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                <div class="space-y-0.5">
                  <p class="text-xs font-black uppercase tracking-wide text-rose-600 dark:text-rose-450">Query Dispatch Failure</p>
                  <p class="text-xs text-rose-500/90 dark:text-gray-400 font-semibold leading-relaxed">{{ telegramError }}</p>
                </div>
              </div>
            </div>

            <!-- Searched User Dossier Sheet Card -->
            <transition v-if="telegramUser" enter-active-class="transition duration-300 ease-out" enter-from-class="transform scale-98 opacity-0" enter-to-class="transform scale-100 opacity-100">
              <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-200/80 dark:border-gray-750 p-6 md:p-8 shadow-sm relative overflow-hidden space-y-6">
                
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-5 pb-5 border-b border-gray-100 dark:border-gray-800/80">
                  <div class="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                    <div class="relative shrink-0">
                      <img 
                        :src="`https://i.gogingko.net/api/v1/v/telegram-profile/${telegramUser.username}`" 
                        @error="handleImageError" 
                        class="w-16 h-16 rounded-2xl object-cover border-2 border-teal-500/10 shadow-sm" 
                        referrerPolicy="no-referrer"
                        alt="Profile photo" 
                      />
                      <span class="absolute -bottom-1 -right-1 p-1 bg-teal-600 rounded-lg text-white border border-white dark:border-gray-800 shadow-md">
                        <User class="h-3 w-3" />
                      </span>
                    </div>
                    <div class="space-y-1">
                      <h3 class="text-base font-black text-gray-900 dark:text-white leading-tight break-words max-w-[280px] sm:max-w-xs">{{ telegramUser.title || telegramUser.username }}</h3>
                      <p class="text-xs font-bold text-teal-655 dark:text-teal-400 flex items-center gap-1">@{{ telegramUser.username }}</p>
                    </div>
                  </div>

                  <!-- Responsive badge / DC Region context -->
                  <div v-if="telegramUser.cdnNumber || telegramUser.cdnRegion" class="flex flex-row sm:flex-col items-center sm:items-end gap-1.5 sm:gap-1 select-none shrink-0 bg-gray-50 dark:bg-gray-900/30 sm:bg-transparent p-2.5 sm:p-0 rounded-xl sm:rounded-none">
                    <span v-if="telegramUser.cdnNumber" class="text-[9px] font-mono font-black uppercase tracking-wider text-teal-655 dark:text-teal-400 bg-teal-500/[0.04] border border-teal-500/10 px-2 py-0.5 rounded-lg">
                      DC {{ telegramUser.cdnNumber }}
                    </span>
                    <p v-if="telegramUser.cdnRegion && telegramUser.cdnRegion[1]" class="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider leading-none">
                      {{ telegramUser.cdnRegion[1] }}
                    </p>
                  </div>
                </div>

                <!-- Description / Bio -->
                <div v-if="telegramUser.description" class="space-y-2">
                  <h4 class="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Biography Desk</h4>
                  <p class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed font-semibold bg-gray-50/50 dark:bg-gray-900/35 p-4 rounded-2xl border border-gray-150/40 dark:border-gray-850/50 whitespace-pre-wrap break-words">
                    {{ telegramUser.description }}
                  </p>
                </div>

                <!-- Bento Metrics layout -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <!-- ID -->
                  <div class="p-4 bg-gray-50/50 dark:bg-gray-900/20 border border-gray-150/40 dark:border-gray-850/50 rounded-2xl flex items-center gap-3">
                    <div class="p-1.5 rounded-xl bg-teal-500/[0.08] dark:bg-teal-950/40 text-teal-650 dark:text-teal-400 shrink-0">
                      <Hash class="h-4 w-4" />
                    </div>
                    <div class="space-y-0.5">
                      <p class="text-[9px] uppercase font-black text-gray-400 tracking-wider">Unique Node ID</p>
                      <p class="text-xs font-bold font-mono text-gray-955 dark:text-white">{{ telegramUser.id || 'N/A' }}</p>
                    </div>
                  </div>

                  <!-- Lang context -->
                  <div class="p-4 bg-gray-50/50 dark:bg-gray-900/20 border border-gray-150/40 dark:border-gray-850/50 rounded-2xl flex items-center gap-3">
                    <div class="p-1.5 rounded-xl bg-teal-500/[0.08] dark:bg-teal-950/40 text-teal-650 dark:text-teal-400 shrink-0">
                      <Globe class="h-4 w-4" />
                    </div>
                    <div class="space-y-0.5">
                      <p class="text-[9px] uppercase font-black text-gray-400 tracking-wider">Locale Profile</p>
                      <p class="text-xs font-bold text-gray-955 dark:text-white">{{ telegramUser.lang || 'Global (Default)' }}</p>
                    </div>
                  </div>

                  <!-- Phone number -->
                  <div v-if="telegramUser.phone" class="p-4 bg-gray-50/50 dark:bg-gray-900/20 border border-gray-150/40 dark:border-gray-850/50 rounded-2xl flex items-center gap-3">
                    <div class="p-1.5 rounded-xl bg-teal-500/[0.08] dark:bg-teal-950/40 text-teal-650 dark:text-teal-400 shrink-0">
                      <Phone class="h-4 w-4" />
                    </div>
                    <div class="space-y-0.5">
                      <p class="text-[9px] uppercase font-black text-gray-400 tracking-wider">Linked Phone</p>
                      <p class="text-xs font-bold text-gray-955 dark:text-white">{{ telegramUser.phone }}</p>
                    </div>
                  </div>

                  <!-- Presence Status -->
                  <div v-if="telegramUser.status" class="p-4 bg-gray-50/50 dark:bg-gray-900/20 border border-gray-150/40 dark:border-gray-850/50 rounded-2xl flex items-center gap-3">
                    <div class="p-1.5 rounded-xl bg-teal-500/[0.08] dark:bg-teal-950/40 text-teal-650 dark:text-teal-400 shrink-0">
                      <Activity class="h-4 w-4" />
                    </div>
                    <div class="space-y-0.5">
                      <p class="text-[9px] uppercase font-black text-gray-400 tracking-wider">Remote Status</p>
                      <p class="text-xs font-bold text-gray-955 dark:text-white">{{ telegramUser.status }}</p>
                    </div>
                  </div>
                </div>

                <!-- Raw inspector dropdown -->
                <details class="bg-gray-50 dark:bg-gray-950 rounded-2xl border border-gray-200/60 dark:border-gray-900 group">
                  <summary class="flex items-center justify-between p-4 cursor-pointer outline-none select-none">
                    <span class="text-xs font-black text-gray-700 dark:text-gray-300 uppercase tracking-widest flex items-center gap-2">
                      <Database class="h-3.5 w-3.5 text-teal-650 dark:text-teal-400" />
                      <span>Schema Inspector</span>
                    </span>
                    <ChevronDown class="h-4 w-4 text-gray-400 group-open:rotate-180 duration-200 transition-transform" />
                  </summary>
                  <div class="p-4 pt-0 border-t border-gray-150 dark:border-gray-900 col-span-2">
                    <pre class="mt-4 text-[10px] font-mono text-teal-650 dark:text-teal-400 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-48 custom-scrollbar">{{ JSON.stringify(telegramUser, null, 2) }}</pre>
                  </div>
                </details>
              </div>
            </transition>

            <!-- Beautiful collateral panel: remote dossier categories -->
            <div class="bg-gradient-to-br from-white to-gray-50/50 dark:from-gray-800 dark:to-gray-900/40 border border-gray-200/80 dark:border-gray-750/80 rounded-3xl p-6 shadow-sm space-y-4">
              <div class="flex items-center gap-2 mb-2">
                <FileText class="h-4.5 w-4.5 text-teal-600 dark:text-teal-400" />
                <h3 class="text-xs font-black text-gray-900 dark:text-white uppercase tracking-wider">Remote Profiles Index</h3>
              </div>
              <p class="text-[11px] text-gray-400 dark:text-gray-500 font-semibold leading-relaxed">
                Unlock high-fidelity profiles maintained in foreign indexers. Select any directory source below to bind details into the inspector pane immediately.
              </p>

              <div v-if="loadingRemoteProfiles" class="flex flex-col items-center justify-center py-6 text-gray-400">
                <Loader2 class="w-6 h-6 animate-spin text-teal-500" />
              </div>

              <div v-else class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-3 pt-2">
                <button 
                  v-for="profile in remoteProfiles" 
                  :key="profile" 
                  @click="viewRemoteProfile(profile)" 
                  :title="profile"
                  :class="[
                    'p-3.5 text-left rounded-2xl border text-xs font-semibold cursor-pointer transition-all duration-300 flex flex-col justify-between h-20 group relative overflow-hidden',
                    selectedRemoteProfileName === profile
                      ? 'bg-teal-650/5 dark:bg-teal-600/[0.08] border-teal-500 text-teal-700 dark:text-teal-400'
                      : 'bg-white dark:bg-gray-800/80 border-gray-200/60 dark:border-gray-750 text-gray-655 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:border-teal-500/30'
                  ]"
                >
                  <FileText class="h-4 w-4 text-teal-650 dark:text-teal-400 mb-2 transition-transform group-hover:scale-110 duration-300" />
                  <span class="truncate pr-2 font-black tracking-wide">{{ profile }}</span>
                  <ChevronRight class="absolute right-2.5 bottom-2.5 h-3.5 w-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 duration-300" />
                </button>
              </div>
            </div>
          </div>

          <!-- Inspector Dossier Visualizer Panel -->
          <div class="col-span-12 xl:col-span-7 space-y-6 w-full">
            
            <!-- Fallback empty state -->
            <div v-if="!selectedRemoteProfileContent" class="flex flex-col items-center justify-center py-24 bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-750 rounded-3xl p-8 text-center shadow-sm relative overflow-hidden">
              <div class="absolute -right-24 -bottom-24 w-48 h-48 bg-teal-500/[0.02] rounded-full blur-3xl pointer-events-none"></div>
              <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-50 dark:bg-teal-950/40 mb-4 shadow-inner border border-teal-100/10">
                <FileText class="h-7 w-7 text-teal-500" />
              </div>
              <h4 class="text-xs font-black text-gray-900 dark:text-white uppercase tracking-wider mb-2">No Remote Profile Selected</h4>
              <p class="text-xs text-gray-400 dark:text-gray-500 font-semibold max-w-sm leading-relaxed">
                Tap any file entry from the remote profiles index on the left to load its interactive dossier catalog here.
              </p>
            </div>

            <!-- Selected Remote Profile Binder Card -->
            <transition v-if="selectedRemoteProfileContent" enter-active-class="transition duration-300 ease-out" enter-from-class="transform scale-98 opacity-0" enter-to-class="transform scale-100 opacity-100">
              <div class="bg-white dark:bg-gray-800 rounded-3xl p-6 md:p-8 border border-gray-200/80 dark:border-gray-750 shadow-sm relative overflow-hidden space-y-6">
                <!-- Abstract header info -->
                <div class="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800/80">
                  <div class="flex items-center gap-2.5">
                    <span class="p-1.5 rounded-xl bg-teal-50 dark:bg-teal-950/40 text-teal-650 dark:text-teal-400">
                      <FileText class="h-4.5 w-4.5" />
                    </span>
                    <div>
                      <h3 class="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest leading-none">Catalog Target</h3>
                      <h4 class="text-xs sm:text-sm font-black text-gray-900 dark:text-white mt-1 break-all max-w-[180px] xs:max-w-xs sm:max-w-md">{{ selectedRemoteProfileName }}</h4>
                    </div>
                  </div>
                  <!-- Close binding button -->
                  <button @click="selectedRemoteProfileContent = null; selectedRemoteProfileName = ''" class="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all cursor-pointer">
                    <X class="h-4 w-4" />
                  </button>
                </div>

                <!-- Document reader contents -->
                <div class="prose dark:prose-invert prose-xs leading-relaxed max-w-none text-xs text-gray-750 dark:text-gray-300 p-5 bg-gray-50/50 dark:bg-gray-900/35 border border-gray-150/40 dark:border-gray-850/50 rounded-2xl overflow-y-auto max-h-[850px]">
                  <div v-html="selectedRemoteProfileContent" class="prose-sm prose-pre:whitespace-pre-wrap font-semibold"></div>
                </div>
              </div>
            </transition>

            <!-- Global Index Fetch Error alert -->
            <div v-if="profileError" class="rounded-2xl bg-rose-500/[0.04] p-5 border border-rose-500/15 flex items-start gap-4">
              <AlertCircle class="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
              <div class="space-y-1">
                <h3 class="text-xs font-black uppercase tracking-wider text-rose-600 dark:text-rose-450">Catalogue Query Failure</h3>
                <p class="text-xs text-rose-500 dark:text-gray-400 font-semibold leading-relaxed">{{ profileError }}</p>
              </div>
            </div>

          </div>

          <!-- Extra bottom anchor spacer -->
          <div class="col-span-12 h-6"></div>

        </div>

      </div>

    </div>

  </div>
</template>
