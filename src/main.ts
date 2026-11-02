import { createApp } from 'vue'
import './index.css'
import App from './App.vue'
import { i18nPlugin, t } from './i18n'

// Fallback SVG placeholder for unavailable images
export const FALLBACK_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" fill="none">
  <rect width="200" height="200" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2"/>
  <circle cx="100" cy="85" r="28" fill="#e2e8f0"/>
  <path d="M88 85C88 80.58 91.58 77 96 77H104C108.42 77 112 80.58 112 85C112 89.42 108.42 93 104 93H96C91.58 93 88 89.42 88 85Z" fill="#94a3b8"/>
  <path d="M60 135L85 108L105 125L125 102L145 135H60Z" fill="#cbd5e1"/>
  <text x="50%" y="162" text-anchor="middle" fill="#94a3b8" font-size="11" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="500">Image unavailable</text>
</svg>
`);

// Clean URL helper: removes retry and cache-busting query params to get canonical image key
export function cleanImageUrl(url: string): string {
  if (!url) return ''
  try {
    const u = new URL(url, window.location.href)
    u.searchParams.delete('retry_attempt')
    u.searchParams.delete('_cb')
    u.searchParams.delete('_retry')
    u.searchParams.delete('_t')
    u.searchParams.delete('t')
    return u.origin + u.pathname
  } catch {
    return url.split('?')[0]
  }
}

// Global registry of successfully loaded photo URLs
export const successfullyFetchedPhotos = new Set<string>()

// Restores any placeholder images in the DOM that match the newly fetched clean URL
export function restorePlaceholdersForUrl(cleanUrl: string, resolvedSrc: string) {
  if (!cleanUrl) return
  successfullyFetchedPhotos.add(cleanUrl)

  // Query all images that have data-fallback="true" or data-original-src
  const candidates = document.querySelectorAll<HTMLImageElement>(
    'img[data-fallback="true"], img[data-original-src]'
  )
  candidates.forEach((img) => {
    const orig = img.getAttribute('data-original-src') || (img as any)._originalSrc
    if (orig && cleanImageUrl(orig) === cleanUrl) {
      console.log(`[Image Restore] Restoring placeholder to newly fetched photo: ${cleanUrl}`)
      img.removeAttribute('data-fallback')
      ;(img as any)._retryCount = 0
      img.src = resolvedSrc
      img.classList.remove('opacity-60', 'grayscale')
    }
  })

  // Dispatch global event for Vue components to update reactive state
  window.dispatchEvent(
    new CustomEvent('photo-fetched-success', {
      detail: { cleanUrl, src: resolvedSrc }
    })
  )
}

// Global image load interceptor to detect whenever a photo is successfully fetched
window.addEventListener(
  'load',
  (event) => {
    const target = event.target
    if (target instanceof HTMLImageElement) {
      const src = target.src
      if (
        src &&
        !src.startsWith('data:') &&
        !target.hasAttribute('data-fallback') &&
        (src.includes('/telegram-photo/') || src.includes('/telegram-doc/'))
      ) {
        const clean = cleanImageUrl(src)
        restorePlaceholdersForUrl(clean, target.src)
      }
    }
  },
  true // Use capture phase so load events are caught reliably
)

// Global image load error interceptor for '/telegram-photo/' and '/telegram-doc/' resources
window.addEventListener(
  'error',
  (event) => {
    const target = event.target
    if (target instanceof HTMLImageElement) {
      const src = target.src
      if (
        src &&
        !src.startsWith('data:') &&
        !target.hasAttribute('data-fallback') &&
        (src.includes('/telegram-photo/') || src.includes('/telegram-doc/'))
      ) {
        const el = target as any
        el._retryCount = el._retryCount || 0
        if (!el._originalSrc) {
          el._originalSrc = cleanImageUrl(src)
        }
        // Always store canonical URL attribute on the DOM element for robust recovery
        target.setAttribute('data-original-src', el._originalSrc)

        if (el._retryCount < 3) {
          el._retryCount += 1
          
          // Exponential/progressive delay: 1.5s, 3s, 4.5s
          const delay = el._retryCount * 1500
          
          console.warn(`[Image Retry] Failed to load telegram media: ${src}. Retrying (attempt ${el._retryCount}/3) in ${delay}ms...`)
          
          setTimeout(() => {
            if (target.hasAttribute('data-fallback')) return
            const originalSrc = el._originalSrc
            const separator = originalSrc.includes('?') ? '&' : '?'
            // Append retry attempt and timestamp to bypass any cached error responses
            target.src = `${originalSrc}${separator}retry_attempt=${el._retryCount}&_cb=${Date.now()}`
          }, delay)
        } else {
          // Gracefully fallback to SVG placeholder on retry exhaustion without console.error
          console.warn(`[Image Retry] Failed to load telegram media after 3 attempts: ${el._originalSrc || src}. Displaying fallback placeholder.`)
          target.setAttribute('data-fallback', 'true')
          target.setAttribute('data-original-src', el._originalSrc)
          target.src = FALLBACK_SVG

          window.dispatchEvent(
            new CustomEvent('photo-fallback', {
              detail: { cleanUrl: el._originalSrc, element: target }
            })
          )
        }
      }
    }
  },
  true // Use capture phase to intercept 'error' events which do not bubble
)

// Expose on window for runtime access
;(window as any).restorePlaceholdersForUrl = restorePlaceholdersForUrl
;(window as any).cleanImageUrl = cleanImageUrl
;(window as any).FALLBACK_SVG = FALLBACK_SVG


const app = createApp(App)
app.use(i18nPlugin)
app.config.globalProperties.$t = t
app.config.globalProperties.t = t
app.mount('#app')

