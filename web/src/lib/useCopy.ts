import { useLang } from './i18n';

/** Bilingual editorial copy; subscribes to the existing language preference. */
export function useCopy() {
  const lang = useLang();
  return (en: string, tr: string) => lang === 'tr' ? tr : en;
}
