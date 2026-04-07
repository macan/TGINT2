<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { Search, Loader2, AlertCircle, Users, Calendar, Info, MessageSquare, ExternalLink, Reply, Moon, Sun, Globe, Layout, CheckCircle2, FileText, User, PenTool, Link, ListFilter, Inbox } from 'lucide-vue-next'
import { format } from 'date-fns'

const isDark = ref(false)
const activeTab = ref<'explorer' | 'search'>('explorer')

// Explorer State
const channelName = ref('')
const currentChannelName = ref('')
const loading = ref(false)
const error = ref('')
const metadata = ref<any>(null)
const posts = ref<any[]>([])

// Global Search State
const globalSearchQuery = ref('')
const searchFields = ref({
  content: true,
  user: false,
  author: false,
  url: false
})
const searchResults = ref<any[]>([])
const isSearching = ref(false)
const searchError = ref('')
const searchLimit = ref(25)
const limitOptions = [10, 25, 50, 100]
const hasSearched = ref(false)
const searchWords = ref<string[]>([])

onMounted(() => {
  if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    isDark.value = true
  }
})

watch(isDark, (val) => {
  if (val) {
    document.documentElement.classList.add('dark')
    localStorage.theme = 'dark'
  } else {
    document.documentElement.classList.remove('dark')
    localStorage.theme = 'light'
  }
}, { immediate: true })

const toggleDark = () => {
  isDark.value = !isDark.value
}

const toggleField = (field: keyof typeof searchFields.value) => {
  const selectedCount = Object.values(searchFields.value).filter(Boolean).length
  if (searchFields.value[field] && selectedCount <= 1) return
  searchFields.value[field] = !searchFields.value[field]
}

const getFieldIcon = (field: string) => {
  switch (field) {
    case 'content': return FileText
    case 'user': return User
    case 'author': return PenTool
    case 'url': return Link
    default: return Globe
  }
}

const highlightText = (text: string) => {
  if (!text || searchWords.value.length === 0) return text
  
  let highlighted = text
  searchWords.value.forEach(word => {
    if (!word.trim()) return
    const regex = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    highlighted = highlighted.replace(regex, '<mark class="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-0.5 rounded">$1</mark>')
  })
  return highlighted
}

const searchChannel = async () => {
  if (!channelName.value.trim()) return
  
  loading.value = true
  error.value = ''
  metadata.value = null
  posts.value = []
  
  const name = channelName.value.trim().replace(/^@/, '')
  currentChannelName.value = name
  
  try {
    const [metaRes, postsRes] = await Promise.all([
      fetch(`https://i.gogingko.net/api/v1/v/telegram-channel/${name}`),
      fetch(`https://i.gogingko.net/api/v1/last/${name}?n=25`)
    ])
    
    if (!metaRes.ok) {
      throw new Error(`Failed to fetch metadata: ${metaRes.statusText}`)
    }
    
    const metaData = await metaRes.json()
    metadata.value = metaData
    
    if (postsRes.ok) {
      const postsData = await postsRes.json()
      posts.value = Array.isArray(postsData) ? postsData : (postsData.data || postsData.posts || postsData.items || [])
    }
  } catch (err: any) {
    error.value = err.message || 'An error occurred while fetching data'
  } finally {
    loading.value = false
  }
}

const performGlobalSearch = async () => {
  if (!globalSearchQuery.value.trim()) return
  
  isSearching.value = true
  searchError.value = ''
  searchResults.value = []
  hasSearched.value = false
  
  const words = globalSearchQuery.value.trim().split(/\s+/).filter(w => w.length > 0)
  searchWords.value = words
  const selectedFields = Object.entries(searchFields.value)
    .filter(([_, selected]) => selected)
    .map(([field]) => field)
    
  if (selectedFields.length === 0) {
    searchError.value = 'Please select at least one field to search in'
    isSearching.value = false
    return
  }
  
  // Build query: (field:"word1" AND field:"word2") OR (field2:"word1" AND field2:"word2")
  const fieldQueries = selectedFields.map(field => {
    const wordQueries = words.map(word => {
      // Escape internal double quotes
      const escapedWord = word.replace(/"/g, '\\"')
      // Use wildcard format for 'user' field, otherwise use double quotes
      if (field === 'user') {
        return `${field}:*${escapedWord}*`
      }
      return `${field}:"${escapedWord}"`
    }).join(' AND ')
    return `(${wordQueries})`
  })
  
  // Add default date range for the current day
  const today = new Date().toISOString().split('T')[0]
  const dateRange = `date:[to_date("${today}T00:00:00+08:00", "%Y-%m-%dT%H:%M:%S%z") TO to_date("${today}T23:59:59+08:00", "%Y-%m-%dT%H:%M:%S%z")]`
  
  const finalQuery = `(${fieldQueries.join(' OR ')}) AND ${dateRange}`
  
  try {
    // Use encodeURIComponent to safely pass UTF-8 characters (like Chinese) 
    // through HTTP headers as requested by the user.
    const safeQuery = encodeURIComponent(finalQuery)
    
    const response = await fetch('https://i.gogingko.net/api/v1/ft/telegram', {
      method: 'GET',
      headers: {
        'x-gos-ft-query': safeQuery,
        'x-gos-ft-sort': 'date-',
        'x-gos-ft-topk': String(searchLimit.value)
      }
    })
    
    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`)
    }
    
    const data = await response.json()
    const keys = data.keys || []
    
    if (keys.length === 0) {
      searchResults.value = []
      return
    }

    // Transform keys into { ns, key } objects by splitting at the first dot
    const mgetPayload = keys[0].map((fullKey: string) => {
      const idx = fullKey.indexOf('.')
      return {
        ns: fullKey.slice(0, idx),
        key: fullKey.slice(idx + 1)
      }
    })

    // Fetch full post data
    const mgetResponse = await fetch('https://i.gogingko.net/api/v1/mget/_', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mgetPayload)
    })

    if (!mgetResponse.ok) {
      throw new Error(`Failed to fetch post details: ${mgetResponse.statusText}`)
    }

    const postsData = await mgetResponse.json()
    const results = Array.isArray(postsData) ? postsData : (postsData.data || [])
    
    // Sort by date descending
    results.sort((a: any, b: any) => {
      const getTimestamp = (dateVal: any) => {
        if (!dateVal) return 0
        if (typeof dateVal === 'number' && dateVal < 10000000000) return dateVal * 1000
        const parsed = new Date(dateVal).getTime()
        return isNaN(parsed) ? 0 : parsed
      }
      return getTimestamp(b.data?.date) - getTimestamp(a.data?.date)
    })
    
    searchResults.value = results
    hasSearched.value = true
  } catch (err: any) {
    searchError.value = err.message || 'An error occurred during search'
  } finally {
    isSearching.value = false
  }
}

const formatDate = (dateStr: string | number) => {
  if (!dateStr) return ''
  try {
    // If it's a unix timestamp in seconds
    if (typeof dateStr === 'number' && dateStr < 10000000000) {
      return format(new Date(dateStr * 1000), 'MMM d, yyyy h:mm:ss a')
    }
    return format(new Date(dateStr), 'MMM d, yyyy h:mm:ss a')
  } catch (e) {
    return String(dateStr)
  }
}

const telegramLogoUrl = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%232AABEE' d='M12 24c6.627 0 12-5.373 12-12S18.627 0 12 0 0 5.373 0 12s5.373 12 12 12z'/%3E%3Cpath fill='%23fff' d='M5.265 11.735l11.953-4.606c.553-.206 1.034.13.844.975l-2.02 9.516c-.15.676-.554.843-1.116.528l-3.085-2.274-1.488 1.433c-.165.165-.303.303-.62.303l.22-3.15 5.734-5.18c.25-.223-.054-.346-.387-.123l-7.09 4.466-3.054-.954c-.664-.208-.678-.664.14-.984z'/%3E%3C/svg%3E"

const handleImageError = (e: Event) => {
  const target = e.target as HTMLImageElement
  if (target.src !== telegramLogoUrl) {
    target.src = telegramLogoUrl
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-200">
    <div class="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <div class="absolute top-4 right-4 sm:top-6 sm:right-6">
        <button 
          @click="toggleDark" 
          class="p-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Toggle dark mode"
        >
        <Moon v-if="!isDark" class="h-5 w-5" />
        <Sun v-else class="h-5 w-5" />
      </button>
    </div>

    <header class="mb-8 text-center pt-8 sm:pt-0">
      <h1 class="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl mb-2">Telegram Explorer</h1>
      <p class="text-gray-500 dark:text-gray-400">Discover profiles and search content across public Telegram channels</p>
    </header>

    <!-- Tabs -->
    <div class="flex justify-center mb-8">
      <div class="bg-gray-100 dark:bg-gray-800 p-1 rounded-xl flex space-x-1">
        <button 
          @click="activeTab = 'explorer'"
          :class="[
            'px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center',
            activeTab === 'explorer' 
              ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' 
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          ]"
        >
          <Layout class="h-4 w-4 mr-2" />
          Channel Explorer
        </button>
        <button 
          @click="activeTab = 'search'"
          :class="[
            'px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center',
            activeTab === 'search' 
              ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' 
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          ]"
        >
          <Globe class="h-4 w-4 mr-2" />
          Global Search
        </button>
      </div>
    </div>

    <!-- Explorer Tab -->
    <div v-if="activeTab === 'explorer'">
      <div class="max-w-xl mx-auto mb-12">
        <form @submit.prevent="searchChannel" class="relative flex items-center">
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search class="h-5 w-5 text-gray-400" />
          </div>
          <input
            v-model="channelName"
            type="text"
            class="block w-full pl-10 pr-24 py-3 border border-gray-300 dark:border-gray-600 rounded-xl leading-5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-shadow shadow-sm"
            placeholder="Enter channel name (e.g. durov)"
          />
          <button
            type="submit"
            :disabled="loading || !channelName.trim()"
            class="absolute right-2 top-2 bottom-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
          >
            <Loader2 v-if="loading" class="h-4 w-4 animate-spin mr-2" />
            {{ loading ? 'Searching...' : 'Search' }}
          </button>
        </form>
      </div>

      <div v-if="error" class="rounded-xl bg-red-50 dark:bg-red-900/20 p-4 mb-8 border border-red-100 dark:border-red-900/50 flex items-start">
        <AlertCircle class="h-5 w-5 text-red-400 dark:text-red-500 mt-0.5 mr-3 flex-shrink-0" />
        <div class="text-sm text-red-700 dark:text-red-400">
          <h3 class="font-medium text-red-800 dark:text-red-300 mb-1">Error fetching channel</h3>
          <p>{{ error }}</p>
        </div>
      </div>

      <div v-if="metadata" class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
        <!-- Profile Sidebar -->
        <div class="lg:col-span-4 space-y-6">
          <div class="bg-white dark:bg-gray-800 rounded-3xl shadow-xl shadow-blue-900/5 dark:shadow-none border border-gray-100 dark:border-gray-700 overflow-hidden relative">
            <div class="h-32 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 relative overflow-hidden">
              <div class="absolute inset-0 bg-white/10 dark:bg-black/10 backdrop-blur-sm"></div>
              <div class="absolute -top-10 -right-10 w-32 h-32 bg-white/20 dark:bg-white/10 rounded-full blur-2xl"></div>
              <div class="absolute -bottom-10 -left-10 w-32 h-32 bg-black/10 dark:bg-black/20 rounded-full blur-2xl"></div>
            </div>
            <div class="px-8 pb-8 pt-16 relative">
              <div class="w-24 h-24 rounded-full bg-white dark:bg-gray-800 border-4 border-white dark:border-gray-800 shadow-lg absolute -top-12 flex items-center justify-center text-4xl font-bold text-blue-600 dark:text-blue-400 overflow-hidden ring-4 ring-blue-50/50 dark:ring-blue-900/30">
                <img :src="`https://i.gogingko.net/api/v1/v/telegram-profile/${currentChannelName}`" @error="handleImageError" alt="Avatar" class="w-full h-full object-cover" />
              </div>
              
              <div class="mt-2">
                <h2 class="text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight">{{ metadata.title || metadata.name }}</h2>
                <p class="text-blue-600 dark:text-blue-400 font-medium text-sm mb-6 flex items-center">
                  @{{ metadata.username || metadata.name || channelName }}
                </p>
                
                <div v-if="metadata.description || metadata.about" class="mb-6">
                  <p class="text-gray-600 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-700/50 p-4 rounded-2xl border border-gray-100 dark:border-gray-600">{{ metadata.description || metadata.about }}</p>
                </div>
                
                <div class="grid grid-cols-2 gap-4">
                  <div v-if="metadata.subscribers || metadata.members" class="bg-blue-50/50 dark:bg-blue-900/20 p-4 rounded-2xl border border-blue-100/50 dark:border-blue-800/30 flex flex-col items-center justify-center text-center">
                    <Users class="h-5 w-5 mb-1 text-blue-500 dark:text-blue-400" />
                    <span class="text-lg font-bold text-gray-900 dark:text-white">{{ (metadata.subscribers || metadata.members).toLocaleString() }}</span>
                    <span class="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-1">Subscribers</span>
                  </div>
                  
                  <div v-if="metadata.date || metadata.createdAt" class="bg-purple-50/50 dark:bg-purple-900/20 p-4 rounded-2xl border border-purple-100/50 dark:border-purple-800/30 flex flex-col items-center justify-center text-center">
                    <Calendar class="h-5 w-5 mb-1 text-purple-500 dark:text-purple-400" />
                    <span class="text-xs font-bold text-gray-900 dark:text-white">{{ formatDate(metadata.date || metadata.createdAt) }}</span>
                    <span class="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-1">Created</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Raw Metadata Debug -->
          <details class="bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-xs">
            <summary class="font-medium text-gray-700 dark:text-gray-300 cursor-pointer outline-none">View Raw Metadata</summary>
            <pre class="mt-2 overflow-x-auto text-gray-600 dark:text-gray-400">{{ JSON.stringify(metadata, null, 2) }}</pre>
          </details>
        </div>

        <!-- Posts Feed -->
        <div class="lg:col-span-8">
          <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <MessageSquare class="h-5 w-5 mr-2 text-blue-500 dark:text-blue-400" />
            Latest Posts
          </h3>
          
          <div v-if="posts.length === 0" class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
            No posts found for this channel.
          </div>
          
          <div v-else class="space-y-4">
            <div v-for="(post, index) in posts" :key="post.key || index" class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md dark:hover:shadow-gray-900/50 transition-shadow">
              <div class="flex justify-between items-start mb-3">
                <div class="flex items-center space-x-2">
                  <div class="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs overflow-hidden">
                    <img :src="`https://i.gogingko.net/api/v1/v/telegram-profile/${currentChannelName}`" @error="handleImageError" alt="Avatar" class="w-full h-full object-cover" />
                  </div>
                  <div>
                    <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ post.data?.author || post.data?.user || metadata.title || metadata.name }}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">{{ formatDate(post.data?.date) }}</p>
                  </div>
                </div>
                <a v-if="post.url || post.link" :href="post.url || post.link" target="_blank" class="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center">
                  View <ExternalLink class="h-3 w-3 ml-1" />
                </a>
              </div>
              
              <!-- Quoted Reply -->
              <div v-if="post.data?.reply && post.data.reply.length >= 2" class="mb-3 border-l-4 border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 p-3 rounded-r-xl">
                <div class="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1 flex items-center">
                  <Reply class="h-3 w-3 mr-1" />
                  Reply to ID: {{ post.data.reply[0] }}
                </div>
                <div class="text-gray-700 dark:text-gray-300 text-sm whitespace-pre-wrap break-words line-clamp-3">
                  {{ post.data.reply[1] }}
                </div>
              </div>

              <div v-if="post.data?.content" class="text-gray-800 dark:text-gray-200 text-sm whitespace-pre-wrap break-words mb-3">
                {{ post.data.content }}
              </div>

              <!-- Media Embeds -->
              <div v-if="post.data?.photos && post.data.photos.length > 0" class="mb-3 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <img :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`" class="w-full h-auto max-h-[500px] object-contain" alt="Post photo" />
              </div>

              <div v-if="post.data?.videos && post.data.videos.length > 0" class="mb-3 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-black">
                <video controls class="w-full h-auto max-h-[500px]">
                  <source :src="`https://i.gogingko.net/api/v1/v/telegram-video/${post.key}-0`" type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>

              <!-- Link Preview -->
              <div v-if="post.data?.linkPreview" class="mb-3 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex flex-col sm:flex-row">
                <div v-if="post.data.linkPreview.image" class="sm:w-32 sm:h-32 flex-shrink-0 bg-gray-200 dark:bg-gray-700">
                  <img :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`" class="w-full h-full object-cover" alt="Link preview image" />
                </div>
                <div class="p-3 sm:p-4 flex flex-col justify-center flex-1 min-w-0">
                  <span v-if="post.data.linkPreview.siteName" class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{{ post.data.linkPreview.siteName }}</span>
                  
                  <a v-if="post.data.linkPreview.href" :href="post.data.linkPreview.href" target="_blank" class="text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline mb-1 line-clamp-2">
                    {{ post.data.linkPreview.title || post.data.linkPreview.href }}
                  </a>
                  <h4 v-else-if="post.data.linkPreview.title" class="text-sm font-bold text-gray-900 dark:text-white mb-1 line-clamp-2">
                    {{ post.data.linkPreview.title }}
                  </h4>
                  
                  <p v-if="post.data.linkPreview.description" class="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mt-1">{{ post.data.linkPreview.description }}</p>
                </div>
              </div>
              
              <div class="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <div class="flex items-center space-x-4">
                  <span v-if="post.data?.views">{{ post.data.views.toLocaleString() }} views</span>
                </div>
                <span v-if="post.key" class="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-[10px] text-gray-400 dark:text-gray-500">ID: {{ post.key }}</span>
              </div>
              
              <!-- Raw Post Debug -->
              <details class="mt-3 text-xs">
                <summary class="text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">Raw Data</summary>
                <pre class="mt-2 p-2 bg-gray-50 dark:bg-gray-900 rounded overflow-x-auto text-gray-500 dark:text-gray-400">{{ JSON.stringify(post, null, 2) }}</pre>
              </details>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else-if="!loading && !error" class="text-center py-20">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-900/20 mb-4">
          <Search class="h-8 w-8 text-blue-500 dark:text-blue-400" />
        </div>
        <h2 class="text-xl font-medium text-gray-900 dark:text-white mb-2">Search for a channel</h2>
        <p class="text-gray-500 dark:text-gray-400 max-w-sm mx-auto">Enter a Telegram channel username above to view its profile and latest posts.</p>
      </div>
    </div>

    <!-- Global Search Tab -->
    <div v-if="activeTab === 'search'" class="max-w-4xl mx-auto">
      <div class="bg-white dark:bg-gray-800 rounded-3xl shadow-xl shadow-blue-900/5 dark:shadow-none border border-gray-100 dark:border-gray-700 p-6 sm:p-8 mb-8">
        <form @submit.prevent="performGlobalSearch">
          <div class="relative flex items-center mb-6">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Globe class="h-5 w-5 text-gray-400" />
            </div>
            <input
              v-model="globalSearchQuery"
              type="text"
              class="block w-full pl-10 pr-24 py-4 border border-gray-300 dark:border-gray-600 rounded-2xl leading-5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-base transition-shadow shadow-sm"
              placeholder="Search across Telegram..."
            />
            <button
              type="submit"
              :disabled="isSearching || !globalSearchQuery.trim()"
              class="absolute right-2 top-2 bottom-2 px-6 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
            >
              <Loader2 v-if="isSearching" class="h-4 w-4 animate-spin mr-2" />
              {{ isSearching ? 'Searching...' : 'Search' }}
            </button>
          </div>

          <div class="flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between">
            <div class="flex flex-wrap gap-3 items-center">
              <span class="text-sm font-semibold text-gray-400 dark:text-gray-500 mr-1 uppercase tracking-wider">Search in</span>
              <button 
                v-for="(val, field) in searchFields" 
                :key="field"
                type="button"
                @click="toggleField(field)"
                :class="[
                  'flex items-center px-4 py-2 rounded-xl border transition-all duration-300 group relative overflow-hidden',
                  searchFields[field] 
                    ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20 dark:shadow-none' 
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'
                ]"
              >
                <component :is="getFieldIcon(field)" :class="['h-4 w-4 mr-2 transition-transform duration-300', searchFields[field] ? 'scale-110' : 'group-hover:scale-110']" />
                <span class="text-sm font-bold capitalize tracking-tight">{{ field }}</span>
                <div v-if="searchFields[field]" class="absolute inset-0 bg-white/10 animate-pulse pointer-events-none"></div>
              </button>
            </div>

            <div class="flex items-center space-x-3 bg-gray-50 dark:bg-gray-900/50 p-1.5 rounded-2xl border border-gray-100 dark:border-gray-700">
              <div class="flex items-center px-3 text-gray-400 dark:text-gray-500">
                <ListFilter class="h-4 w-4 mr-2" />
                <span class="text-xs font-bold uppercase tracking-wider">Limit</span>
              </div>
              <div class="flex space-x-1">
                <button 
                  v-for="limit in limitOptions" 
                  :key="limit"
                  type="button"
                  @click="searchLimit = limit"
                  :class="[
                    'px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200',
                    searchLimit === limit 
                      ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm ring-1 ring-gray-200 dark:ring-gray-600' 
                      : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                  ]"
                >
                  {{ limit }}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>

      <div v-if="searchError" class="rounded-xl bg-red-50 dark:bg-red-900/20 p-4 mb-8 border border-red-100 dark:border-red-900/50 flex items-start">
        <AlertCircle class="h-5 w-5 text-red-400 dark:text-red-500 mt-0.5 mr-3 flex-shrink-0" />
        <div class="text-sm text-red-700 dark:text-red-400">
          <h3 class="font-medium text-red-800 dark:text-red-300 mb-1">Search Error</h3>
          <p>{{ searchError }}</p>
        </div>
      </div>

      <div v-if="searchResults.length > 0" class="space-y-6">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-lg font-bold text-gray-900 dark:text-white flex items-center">
            <MessageSquare class="h-5 w-5 mr-2 text-blue-500 dark:text-blue-400" />
            Search Results
          </h3>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ searchResults.length }} results found</span>
        </div>

        <div class="space-y-4">
          <div v-for="(post, index) in searchResults" :key="post.key || index" class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md dark:hover:shadow-gray-900/50 transition-shadow">
            <div class="flex justify-between items-start mb-3">
              <div class="flex items-center space-x-2">
                <div class="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs overflow-hidden">
                  <img :src="`https://i.gogingko.net/api/v1/v/telegram-profile/${post.data?.user || post.data?.author || 'telegram'}`" @error="handleImageError" alt="Avatar" class="w-full h-full object-cover" />
                </div>
                <div>
                  <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ post.data?.author || post.data?.user || 'Telegram User' }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ formatDate(post.data?.date) }}</p>
                </div>
              </div>
              <a v-if="post.url || post.link" :href="post.url || post.link" target="_blank" class="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center">
                View <ExternalLink class="h-3 w-3 ml-1" />
              </a>
            </div>
            
            <!-- Quoted Reply -->
            <div v-if="post.data?.reply && post.data.reply.length >= 2" class="mb-3 border-l-4 border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 p-3 rounded-r-xl">
              <div class="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1 flex items-center">
                <Reply class="h-3 w-3 mr-1" />
                Reply to ID: {{ post.data.reply[0] }}
              </div>
              <div class="text-gray-700 dark:text-gray-300 text-sm whitespace-pre-wrap break-words line-clamp-3" v-html="highlightText(post.data.reply[1])">
              </div>
            </div>

            <div v-if="post.data?.content" class="text-gray-800 dark:text-gray-200 text-sm whitespace-pre-wrap break-words mb-3" v-html="highlightText(post.data.content)">
            </div>

            <!-- Media Embeds -->
            <div v-if="post.data?.photos && post.data.photos.length > 0" class="mb-3 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <img :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`" class="w-full h-auto max-h-[500px] object-contain" alt="Post photo" />
            </div>

            <div v-if="post.data?.videos && post.data.videos.length > 0" class="mb-3 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700 bg-black">
              <video controls class="w-full h-auto max-h-[500px]">
                <source :src="`https://i.gogingko.net/api/v1/v/telegram-video/${post.key}-0`" type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>

            <!-- Link Preview -->
            <div v-if="post.data?.linkPreview" class="mb-3 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex flex-col sm:flex-row">
              <div v-if="post.data.linkPreview.image" class="sm:w-32 sm:h-32 flex-shrink-0 bg-gray-200 dark:bg-gray-700">
                <img :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_l_0`" class="w-full h-full object-cover" alt="Link preview image" />
              </div>
              <div class="p-3 sm:p-4 flex flex-col justify-center flex-1 min-w-0">
                <span v-if="post.data.linkPreview.siteName" class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{{ post.data.linkPreview.siteName }}</span>
                
                <a v-if="post.data.linkPreview.href" :href="post.data.linkPreview.href" target="_blank" class="text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline mb-1 line-clamp-2">
                  {{ post.data.linkPreview.title || post.data.linkPreview.href }}
                </a>
                <h4 v-else-if="post.data.linkPreview.title" class="text-sm font-bold text-gray-900 dark:text-white mb-1 line-clamp-2">
                  {{ post.data.linkPreview.title }}
                </h4>
                
                <p v-if="post.data.linkPreview.description" class="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mt-1">{{ post.data.linkPreview.description }}</p>
              </div>
            </div>
            
            <div class="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <div class="flex items-center space-x-4">
                <span v-if="post.data?.views">{{ post.data.views.toLocaleString() }} views</span>
              </div>
              <span v-if="post.key" class="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-[10px] text-gray-400 dark:text-gray-500">ID: {{ post.key }}</span>
            </div>
            
            <!-- Raw Post Debug -->
            <details class="mt-3 text-xs">
              <summary class="text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">Raw Data</summary>
              <pre class="mt-2 p-2 bg-gray-50 dark:bg-gray-900 rounded overflow-x-auto text-gray-500 dark:text-gray-400">{{ JSON.stringify(post, null, 2) }}</pre>
            </details>
          </div>
        </div>
      </div>

      <div v-else-if="hasSearched && !isSearching" class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-12 text-center shadow-sm">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-50 dark:bg-gray-900 mb-4">
          <Inbox class="h-8 w-8 text-gray-400" />
        </div>
        <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-2">No results found</h3>
        <p class="text-gray-500 dark:text-gray-400 max-w-xs mx-auto">
          We couldn't find any Telegram posts matching your search criteria. Try adjusting your keywords or filters.
        </p>
      </div>

      <div v-else-if="!isSearching && !searchError" class="text-center py-20">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-900/20 mb-4">
          <Globe class="h-8 w-8 text-blue-500 dark:text-blue-400" />
        </div>
        <h2 class="text-xl font-medium text-gray-900 dark:text-white mb-2">Global Content Search</h2>
        <p class="text-gray-500 dark:text-gray-400 max-w-sm mx-auto">Search for keywords, users, or authors across all public Telegram data.</p>
      </div>
    </div>
  </div>
  </div>
</template>
