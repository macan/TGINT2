<script setup lang="ts">
import { ref } from 'vue'
import { Search, Loader2, AlertCircle, Users, Calendar, Info, MessageSquare, ExternalLink, Reply } from 'lucide-vue-next'
import { format } from 'date-fns'

const channelName = ref('')
const currentChannelName = ref('')
const loading = ref(false)
const error = ref('')
const metadata = ref<any>(null)
const posts = ref<any[]>([])

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

const formatDate = (dateStr: string | number) => {
  if (!dateStr) return ''
  try {
    // If it's a unix timestamp in seconds
    if (typeof dateStr === 'number' && dateStr < 10000000000) {
      return format(new Date(dateStr * 1000), 'MMM d, yyyy h:mm a')
    }
    return format(new Date(dateStr), 'MMM d, yyyy h:mm a')
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
  <div class="min-h-screen max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
    <header class="mb-8 text-center">
      <h1 class="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl mb-2">Telegram Channel Explorer</h1>
      <p class="text-gray-500">Discover profiles and latest posts from any public Telegram channel</p>
    </header>

    <div class="max-w-xl mx-auto mb-12">
      <form @submit.prevent="searchChannel" class="relative flex items-center">
        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search class="h-5 w-5 text-gray-400" />
        </div>
        <input
          v-model="channelName"
          type="text"
          class="block w-full pl-10 pr-24 py-3 border border-gray-300 rounded-xl leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-shadow shadow-sm"
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

    <div v-if="error" class="rounded-xl bg-red-50 p-4 mb-8 border border-red-100 flex items-start">
      <AlertCircle class="h-5 w-5 text-red-400 mt-0.5 mr-3 flex-shrink-0" />
      <div class="text-sm text-red-700">
        <h3 class="font-medium text-red-800 mb-1">Error fetching channel</h3>
        <p>{{ error }}</p>
      </div>
    </div>

    <div v-if="metadata" class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
      <!-- Profile Sidebar -->
      <div class="lg:col-span-4 space-y-6">
        <div class="bg-white rounded-3xl shadow-xl shadow-blue-900/5 border border-gray-100 overflow-hidden relative">
          <div class="h-32 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 relative overflow-hidden">
            <div class="absolute inset-0 bg-white/10 backdrop-blur-sm"></div>
            <div class="absolute -top-10 -right-10 w-32 h-32 bg-white/20 rounded-full blur-2xl"></div>
            <div class="absolute -bottom-10 -left-10 w-32 h-32 bg-black/10 rounded-full blur-2xl"></div>
          </div>
          <div class="px-8 pb-8 pt-16 relative">
            <div class="w-24 h-24 rounded-full bg-white border-4 border-white shadow-lg absolute -top-12 flex items-center justify-center text-4xl font-bold text-blue-600 overflow-hidden ring-4 ring-blue-50/50">
              <img :src="`https://i.gogingko.net/api/v1/v/telegram-profile/${currentChannelName}`" @error="handleImageError" alt="Avatar" class="w-full h-full object-cover" />
            </div>
            
            <div class="mt-2">
              <h2 class="text-2xl font-extrabold text-gray-900 tracking-tight">{{ metadata.title || metadata.name }}</h2>
              <p class="text-blue-600 font-medium text-sm mb-6 flex items-center">
                @{{ metadata.username || metadata.name || channelName }}
              </p>
              
              <div v-if="metadata.description || metadata.about" class="mb-6">
                <p class="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap break-words bg-gray-50 p-4 rounded-2xl border border-gray-100">{{ metadata.description || metadata.about }}</p>
              </div>
              
              <div class="grid grid-cols-2 gap-4">
                <div v-if="metadata.subscribers || metadata.members" class="bg-blue-50/50 p-4 rounded-2xl border border-blue-100/50 flex flex-col items-center justify-center text-center">
                  <Users class="h-5 w-5 mb-1 text-blue-500" />
                  <span class="text-lg font-bold text-gray-900">{{ (metadata.subscribers || metadata.members).toLocaleString() }}</span>
                  <span class="text-[10px] font-medium text-gray-500 uppercase tracking-wider mt-1">Subscribers</span>
                </div>
                
                <div v-if="metadata.date || metadata.createdAt" class="bg-purple-50/50 p-4 rounded-2xl border border-purple-100/50 flex flex-col items-center justify-center text-center">
                  <Calendar class="h-5 w-5 mb-1 text-purple-500" />
                  <span class="text-xs font-bold text-gray-900">{{ formatDate(metadata.date || metadata.createdAt) }}</span>
                  <span class="text-[10px] font-medium text-gray-500 uppercase tracking-wider mt-1">Created</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Raw Metadata Debug -->
        <details class="bg-gray-50 rounded-xl border border-gray-200 p-4 text-xs">
          <summary class="font-medium text-gray-700 cursor-pointer outline-none">View Raw Metadata</summary>
          <pre class="mt-2 overflow-x-auto text-gray-600">{{ JSON.stringify(metadata, null, 2) }}</pre>
        </details>
      </div>

      <!-- Posts Feed -->
      <div class="lg:col-span-8">
        <h3 class="text-lg font-bold text-gray-900 mb-4 flex items-center">
          <MessageSquare class="h-5 w-5 mr-2 text-blue-500" />
          Latest Posts
        </h3>
        
        <div v-if="posts.length === 0" class="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
          No posts found for this channel.
        </div>
        
        <div v-else class="space-y-4">
          <div v-for="(post, index) in posts" :key="post.key || index" class="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow">
            <div class="flex justify-between items-start mb-3">
              <div class="flex items-center space-x-2">
                <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs overflow-hidden">
                  <img :src="`https://i.gogingko.net/api/v1/v/telegram-profile/${currentChannelName}`" @error="handleImageError" alt="Avatar" class="w-full h-full object-cover" />
                </div>
                <div>
                  <p class="text-sm font-semibold text-gray-900">{{ post.data?.author || post.data?.user || metadata.title || metadata.name }}</p>
                  <p class="text-xs text-gray-500">{{ formatDate(post.data?.date) }}</p>
                </div>
              </div>
              <a v-if="post.url || post.link" :href="post.url || post.link" target="_blank" class="text-xs text-blue-600 hover:underline flex items-center">
                View <ExternalLink class="h-3 w-3 ml-1" />
              </a>
            </div>
            
            <!-- Quoted Reply -->
            <div v-if="post.data?.reply && post.data.reply.length >= 2" class="mb-3 border-l-4 border-blue-400 bg-blue-50/50 p-3 rounded-r-xl">
              <div class="text-xs font-semibold text-blue-600 mb-1 flex items-center">
                <Reply class="h-3 w-3 mr-1" />
                Reply to ID: {{ post.data.reply[0] }}
              </div>
              <div class="text-gray-700 text-sm whitespace-pre-wrap break-words line-clamp-3">
                {{ post.data.reply[1] }}
              </div>
            </div>

            <div v-if="post.data?.content" class="text-gray-800 text-sm whitespace-pre-wrap break-words mb-3">
              {{ post.data.content }}
            </div>

            <!-- Media Embeds -->
            <div v-if="post.data?.photos && post.data.photos.length > 0" class="mb-3 rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
              <img :src="`https://i.gogingko.net/api/v1/v/telegram-photo/${post.key}_0`" class="w-full h-auto max-h-[500px] object-contain" alt="Post photo" />
            </div>

            <div v-if="post.data?.videos && post.data.videos.length > 0" class="mb-3 rounded-xl overflow-hidden border border-gray-100 bg-black">
              <video controls class="w-full h-auto max-h-[500px]">
                <source :src="`https://i.gogingko.net/api/v1/v/telegram-video/${post.key}-0`" type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>
            
            <div class="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
              <div class="flex items-center space-x-4">
                <span v-if="post.data?.views">{{ post.data.views.toLocaleString() }} views</span>
              </div>
              <span v-if="post.key" class="font-mono bg-gray-100 px-2 py-1 rounded text-[10px] text-gray-400">ID: {{ post.key }}</span>
            </div>
            
            <!-- Raw Post Debug -->
            <details class="mt-3 text-xs">
              <summary class="text-gray-400 cursor-pointer hover:text-gray-600">Raw Data</summary>
              <pre class="mt-2 p-2 bg-gray-50 rounded overflow-x-auto text-gray-500">{{ JSON.stringify(post, null, 2) }}</pre>
            </details>
          </div>
        </div>
      </div>
    </div>
    
    <div v-else-if="!loading && !error" class="text-center py-20">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 mb-4">
        <Search class="h-8 w-8 text-blue-500" />
      </div>
      <h2 class="text-xl font-medium text-gray-900 mb-2">Search for a channel</h2>
      <p class="text-gray-500 max-w-sm mx-auto">Enter a Telegram channel username above to view its profile and latest posts.</p>
    </div>
  </div>
</template>
