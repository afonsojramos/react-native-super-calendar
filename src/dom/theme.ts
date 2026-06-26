// Theme for the react-dom renderer. The DOM components style themselves with
// plain inline styles driven by this object, so consumers don't need to import
// a stylesheet or configure their bundler for CSS. The tokens mirror the React
// Native theme (src/theme.ts) so the two renderers look identical.

export interface DomCalendarTheme {
  /** Primary day-number colour. */
  text: string;
  /** Weekday headers and secondary labels. */
  textMuted: string;
  /** Disabled (out-of-range / blocked) days. */
  textDisabled: string;
  /** Hairline borders and separators. */
  gridLine: string;
  /** Subtle fill behind weekend columns. */
  weekendBackground: string;
  /** Today's badge fill. */
  todayBackground: string;
  /** Today's badge text. */
  todayText: string;
  /** Selected single day / range endpoint badge fill. */
  selectedBackground: string;
  /** Selected single day / range endpoint badge text. */
  selectedText: string;
  /** Continuous band behind a selected range. */
  rangeBackground: string;
  /** Row height of a day cell, in px. */
  cellHeight: number;
  /** Diameter of the day badge, in px. */
  dayBadgeSize: number;
  /** Font stack for the calendar. */
  fontFamily: string;
}

const SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const defaultDomTheme: DomCalendarTheme = {
  text: "#1A1B1E",
  textMuted: "#6B7280",
  textDisabled: "#B5B9C0",
  gridLine: "#E2E4E9",
  weekendBackground: "#F6F7F9",
  todayBackground: "#1F6FEB",
  todayText: "#FFFFFF",
  selectedBackground: "#1F6FEB",
  selectedText: "#FFFFFF",
  rangeBackground: "#DCE7FF",
  cellHeight: 48,
  dayBadgeSize: 34,
  fontFamily: SYSTEM_FONT,
};

export const darkDomTheme: DomCalendarTheme = {
  text: "#E6E8EB",
  textMuted: "#9AA0A6",
  textDisabled: "#52565E",
  gridLine: "#2A2D31",
  weekendBackground: "#1B1D21",
  todayBackground: "#3B82F6",
  todayText: "#FFFFFF",
  selectedBackground: "#3B82F6",
  selectedText: "#FFFFFF",
  rangeBackground: "#1E3A66",
  cellHeight: 48,
  dayBadgeSize: 34,
  fontFamily: SYSTEM_FONT,
};

/** Merge a partial override onto a base theme (defaults to {@link defaultDomTheme}). */
export function mergeDomTheme(
  overrides?: Partial<DomCalendarTheme>,
  base: DomCalendarTheme = defaultDomTheme,
): DomCalendarTheme {
  return overrides ? { ...base, ...overrides } : base;
}
