import { ref, computed } from 'vue';
import type { LocaleCode, LanguageOption, TranslationDictionary } from './types';
import en from './locales/en';
import zhCN from './locales/zh-CN';
import zhTW from './locales/zh-TW';
import ru from './locales/ru';
import ja from './locales/ja';
import es from './locales/es';

export const availableLanguages: LanguageOption[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'zh-CN', name: 'Simplified Chinese', nativeName: '简体中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: 'Traditional Chinese', nativeName: '繁體中文', flag: '🇭🇰' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
];

const messages: Record<LocaleCode, TranslationDictionary> = {
  'en': en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ru': ru,
  'ja': ja,
  'es': es,
};

const getInitialLocale = (): LocaleCode => {
  if (typeof window !== 'undefined') {
    try {
      const savedLocal = localStorage.getItem('app_locale') as LocaleCode;
      if (savedLocal && messages[savedLocal]) {
        return savedLocal;
      }
      const savedSession = sessionStorage.getItem('app_locale') as LocaleCode;
      if (savedSession && messages[savedSession]) {
        return savedSession;
      }
    } catch (e) {
      console.warn('[i18n] Storage access error:', e);
    }
  }
  // Default language is English
  return 'en';
};

export const currentLocale = ref<LocaleCode>(getInitialLocale());

// Update html lang attribute on initial load
if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLocale.value;
}

const getNestedValue = (obj: any, path: string): any => {
  if (!obj) return undefined;
  const parts = path.split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr && typeof curr === 'object' && part in curr) {
      curr = curr[part];
    } else {
      return undefined;
    }
  }
  return curr;
};

export const t = (key: string, params?: Record<string, string | number>): string => {
  const locale = currentLocale.value;
  let val = getNestedValue(messages[locale], key);
  
  // Fallback to English if missing in current locale
  if (val === undefined && locale !== 'en') {
    val = getNestedValue(messages['en'], key);
  }
  
  if (val === undefined || typeof val !== 'string') {
    return key;
  }
  
  if (params) {
    let formatted = val;
    for (const [pKey, pVal] of Object.entries(params)) {
      formatted = formatted.replace(new RegExp(`\\{${pKey}\\}`, 'g'), String(pVal));
    }
    return formatted;
  }
  
  return val;
};

// Layout recalculation listeners callback registry
const layoutChangeListeners = new Set<() => void>();

export const onLocaleLayoutChange = (cb: () => void) => {
  layoutChangeListeners.add(cb);
  return () => {
    layoutChangeListeners.delete(cb);
  };
};

export const setLocale = (locale: LocaleCode) => {
  if (messages[locale]) {
    currentLocale.value = locale;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('app_locale', locale);
      } catch (e) {
        console.warn('[i18n] Failed to save locale to localStorage:', e);
      }
    }
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem('app_locale', locale);
      } catch (e) {
        console.warn('[i18n] Failed to save locale to sessionStorage:', e);
      }
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
    
    // Dispatch layout recalculations
    layoutChangeListeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.warn('[i18n] Layout listener error:', err);
      }
    });
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-locale-changed', { detail: { locale } }));
      // Trigger a window resize event so graph canvases and ResizeObservers recalculate accurately
      window.dispatchEvent(new Event('resize'));
    }
  }
};

export const currentLanguage = computed(() => {
  return availableLanguages.find(l => l.code === currentLocale.value) || availableLanguages[0];
});

export const useI18n = () => {
  return {
    locale: currentLocale,
    currentLanguage,
    availableLanguages,
    t,
    setLocale,
    onLocaleLayoutChange
  };
};
