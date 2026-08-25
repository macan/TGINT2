export type LocaleCode = 'en' | 'zh-CN' | 'zh-TW' | 'ru' | 'ja' | 'es';

export interface LanguageOption {
  code: LocaleCode;
  name: string;
  nativeName: string;
  flag: string;
}

export type TranslationDictionary = Record<string, any>;
