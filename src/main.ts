import { createApp } from 'vue'
import './index.css'
import App from './App.vue'

// Global image load error interceptor for '/telegram-photo/' resources
window.addEventListener(
  'error',
  (event) => {
    const target = event.target
    if (target instanceof HTMLImageElement) {
      const src = target.src
      if (src && src.includes('/telegram-photo/')) {
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
            const originalSrc = el._originalSrc
            const separator = originalSrc.includes('?') ? '&' : '?'
            // Append retry attempt and timestamp to bypass any cached error responses
            target.src = `${originalSrc}${separator}retry_attempt=${el._retryCount}&_cb=${Date.now()}`
          }, delay)
        } else {
          console.error(`[Image Retry] Failed to load telegram-photo after 3 attempts: ${el._originalSrc || src}`)
        }
      }
    }
  },
  true // Use capture phase to intercept 'error' events which do not bubble
)

createApp(App).mount('#app')

