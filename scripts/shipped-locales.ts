/** Languages whose UI dictionaries and package metadata ship with Harness. */
export const SHIPPED_LOCALE_IDS = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const

/** Locale id required by repository translation checks. */
export type ShippedLocaleId = typeof SHIPPED_LOCALE_IDS[number]

/**
 * Extract copy tokens that translations must preserve verbatim.
 * @param text - Dictionary text containing placeholders, slash commands or API field names.
 * @returns Sorted tokens, retaining repeated occurrences.
 */
export function localeTokens(text: string): string[] {
  return (text.match(/\{\w+\}|(?<![A-Za-z0-9/])\/[A-Za-z][\w-]*(?:=[\w-]+| (?:on|off))?|\b[a-z]+_[a-z_]+\b/gu) ?? []).sort()
}
