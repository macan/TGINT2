/**
 * Channel Language Lookup & Utility functions
 * Integrates with the JOB_TG metadata endpoint used in Types tab:
 * https://i.gogingko.net/api/v1/z/JOB_TG/metas/{channel}
 */

export interface LanguageInfo {
  name: string;
  flag: string;
  short: string;
}

export const LANGUAGE_CONFIG: Record<string, LanguageInfo> = {
  "zh-cn": { name: "Chinese (Simplified)", flag: "🇨🇳", short: "ZH" },
  "zh-tw": { name: "Chinese (Traditional)", flag: "🇹🇼", short: "ZH" },
  "zh-hk": { name: "Chinese (HK)", flag: "🇭🇰", short: "ZH" },
  "zh": { name: "Chinese", flag: "🇨🇳", short: "ZH" },
  "en": { name: "English", flag: "🇬🇧", short: "EN" },
  "en-us": { name: "English (US)", flag: "🇺🇸", short: "EN" },
  "en-gb": { name: "English (UK)", flag: "🇬🇧", short: "EN" },
  "ru": { name: "Russian", flag: "🇷🇺", short: "RU" },
  "uk": { name: "Ukrainian", flag: "🇺🇦", short: "UK" },
  "fa": { name: "Persian", flag: "🇮🇷", short: "FA" },
  "ar": { name: "Arabic", flag: "🇸🇦", short: "AR" },
  "es": { name: "Spanish", flag: "🇪🇸", short: "ES" },
  "fr": { name: "French", flag: "🇫🇷", short: "FR" },
  "de": { name: "German", flag: "🇩🇪", short: "DE" },
  "pt": { name: "Portuguese", flag: "🇵🇹", short: "PT" },
  "pt-br": { name: "Portuguese (BR)", flag: "🇧🇷", short: "PT" },
  "tr": { name: "Turkish", flag: "🇹🇷", short: "TR" },
  "ja": { name: "Japanese", flag: "🇯🇵", short: "JA" },
  "ko": { name: "Korean", flag: "🇰🇷", short: "KO" },
  "it": { name: "Italian", flag: "🇮🇹", short: "IT" },
  "pl": { name: "Polish", flag: "🇵🇱", short: "PL" },
  "nl": { name: "Dutch", flag: "🇳🇱", short: "NL" },
  "he": { name: "Hebrew", flag: "🇮🇱", short: "HE" },
  "iw": { name: "Hebrew", flag: "🇮🇱", short: "HE" },
  "vi": { name: "Vietnamese", flag: "🇻🇳", short: "VI" },
  "id": { name: "Indonesian", flag: "🇮🇩", short: "ID" },
  "th": { name: "Thai", flag: "🇹🇭", short: "TH" },
  "uz": { name: "Uzbek", flag: "🇺🇿", short: "UZ" },
  "kk": { name: "Kazakh", flag: "🇰🇿", short: "KK" },
  "az": { name: "Azerbaijani", flag: "🇦🇿", short: "AZ" },
  "hy": { name: "Armenian", flag: "🇦🇲", short: "HY" },
  "ka": { name: "Georgian", flag: "🇬🇪", short: "KA" },
  "be": { name: "Belarusian", flag: "🇧🇾", short: "BE" },
  "hi": { name: "Hindi", flag: "🇮🇳", short: "HI" },
  "cs": { name: "Czech", flag: "🇨🇿", short: "CS" },
  "sv": { name: "Swedish", flag: "🇸🇪", short: "SV" },
  "el": { name: "Greek", flag: "🇬🇷", short: "EL" },
  "ro": { name: "Romanian", flag: "🇷🇴", short: "RO" },
  "hu": { name: "Hungarian", flag: "🇭🇺", short: "HU" }
};

export const getLanguageInfo = (langCode?: string): LanguageInfo | null => {
  if (!langCode) return null;
  const key = langCode.trim().toLowerCase();
  if (LANGUAGE_CONFIG[key]) {
    return LANGUAGE_CONFIG[key];
  }
  const base = key.split(/[-_]/)[0];
  if (LANGUAGE_CONFIG[base]) {
    return LANGUAGE_CONFIG[base];
  }
  return {
    name: langCode.toUpperCase(),
    flag: "🌐",
    short: (base || langCode).substring(0, 3).toUpperCase()
  };
};

export const formatLanguageCode = (langCode?: string): string => {
  if (!langCode) return "";
  const info = getLanguageInfo(langCode);
  return info?.short || langCode.toUpperCase();
};

export const getLanguageFlag = (langCode?: string): string => {
  if (!langCode) return "🌐";
  const info = getLanguageInfo(langCode);
  return info?.flag || "🌐";
};

export const getLanguageDisplayName = (langCode?: string): string => {
  if (!langCode) return "";
  const info = getLanguageInfo(langCode);
  return info?.name || langCode;
};

// In-memory cache for channel language lookups
const channelLanguageCache = new Map<string, string | null>();

/**
 * Detect script language from sample text as fallback
 */
export const detectScriptLanguage = (sampleText: string): string | null => {
  if (!sampleText || !sampleText.trim()) return null;
  const text = sampleText.trim();
  
  // Count script occurrences
  const cjkCount = (text.match(/[\u4E00-\u9FFF]/g) || []).length;
  const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const arabicCount = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const hangulCount = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
  const kanaCount = (text.match(/[\u3040-\u30FF]/g) || []).length;
  const hebrewCount = (text.match(/[\u0590-\u05FF]/g) || []).length;
  const greekCount = (text.match(/[\u0370-\u03FF]/g) || []).length;

  if (kanaCount >= 3) return "ja";
  if (hangulCount >= 3) return "ko";
  if (cjkCount >= 5) return "zh-cn";
  if (cyrillicCount >= 10) return "ru";
  if (arabicCount >= 8) return "ar";
  if (hebrewCount >= 6) return "he";
  if (greekCount >= 6) return "el";

  return null;
};

/**
 * Fetch channel language using the Types Tab JOB_TG/metas endpoint
 */
export const fetchChannelLanguage = async (
  rawChannel: string,
  sampleTextFallback?: string
): Promise<string | null> => {
  const clean = (rawChannel || "").replace(/^@/, "").trim();
  if (!clean) return null;

  if (channelLanguageCache.has(clean)) {
    return channelLanguageCache.get(clean) || null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(
      `https://i.gogingko.net/api/v1/z/JOB_TG/metas/${encodeURIComponent(clean)}`,
      { signal: controller.signal }
    );
    
    if (res.ok) {
      const data = await res.json();
      if (data.state === 0 && data.gso?.result) {
        let parsed: any = null;
        if (typeof data.gso.result === "object" && data.gso.result !== null) {
          parsed = data.gso.result;
        } else if (typeof data.gso.result === "string") {
          try {
            parsed = JSON.parse(data.gso.result);
          } catch {
            try {
              parsed = JSON.parse(data.gso.result.replace(/'/g, '"'));
            } catch {
              const matchLang = data.gso.result.match(/['"]l['"]\s*:\s*['"]([^'"]+)['"]/);
              if (matchLang) {
                parsed = { l: matchLang[1] };
              }
            }
          }
        }

        const lang = parsed?.l || parsed?.lang || undefined;
        if (lang && typeof lang === "string") {
          const normalized = lang.trim().toLowerCase();
          channelLanguageCache.set(clean, normalized);
          return normalized;
        }
      }
    }
  } catch (e) {
    console.warn(`[ChannelLanguage] Lookup failed for ${clean}:`, e);
  } finally {
    clearTimeout(timeoutId);
  }

  // Fallback: heuristic script detection if sample text is provided
  if (sampleTextFallback) {
    const detected = detectScriptLanguage(sampleTextFallback);
    if (detected) {
      channelLanguageCache.set(clean, detected);
      return detected;
    }
  }

  return null;
};
