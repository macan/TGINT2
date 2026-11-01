import { createApp } from 'vue'
import './index.css'
import App from './App.vue'
import { i18nPlugin, t } from './i18n'

// Fallback SVG placeholder for unavailable images
const FALLBACK_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" fill="none">
  <rect width="200" height="200" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2"/>
  <circle cx="100" cy="85" r="28" fill="#e2e8f0"/>
  <path d="M88 85C88 80.58 91.58 77 96 77H104C108.42 77 112 80.58 112 85C112 89.42 108.42 93 104 93H96C91.58 93 88 89.42 88 85Z" fill="#94a3b8"/>
  <path d="M60 135L85 108L105 125L125 102L145 135H60Z" fill="#cbd5e1"/>
  <text x="50%" y="162" text-anchor="middle" fill="#94a3b8" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="500">Image unavailable</text>
</svg>
`);

// Global image load error interceptor for '/telegram-photo/' resources
window.addEventListener(
  'error',
  (event) => {
    const target = event.target
    if (target instanceof HTMLImageElement) {
      const src = target.src
      if (src && !src.startsWith('data:') && !target.hasAttribute('data-fallback') && src.includes('/telegram-photo/')) {
        const el = target as any
        el._retryCount = el._retryCount || 0
        if (el._retryCount < 3) {
          el._retryCount += 1
          
          // Exponential/progressive delay: 1.5s, 3s, 4.5s
          const delay = el._retryCount * 1500
          
          if (!el._originalSrc) {
            el._originalSrc = src
          }
          
          console.warn(`[Image Retry] Failed to load telegram-photo: ${src}. Retrying (attempt ${el._retryCount}/3) in ${delay}ms...`)
          
          setTimeout(() => {
            if (target.hasAttribute('data-fallback')) return
            const originalSrc = el._originalSrc
            const separator = originalSrc.includes('?') ? '&' : '?'
            // Append retry attempt and timestamp to bypass any cached error responses
            target.src = `${originalSrc}${separator}retry_attempt=${el._retryCount}&_cb=${Date.now()}`
          }, delay)
        } else {
          // Gracefully fallback to SVG placeholder on retry exhaustion without console.error
          console.warn(`[Image Retry] Failed to load telegram-photo after 3 attempts: ${el._originalSrc || src}. Displaying fallback placeholder.`)
          target.setAttribute('data-fallback', 'true')
          target.src = FALLBACK_SVG
        }
      }
    }
  },
  true // Use capture phase to intercept 'error' events which do not bubble
)

const app = createApp(App)
app.use(i18nPlugin)
app.config.globalProperties.$t = t
app.config.globalProperties.t = t
app.mount('#app')

