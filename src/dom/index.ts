// react-dom entry point: real DOM components (no React Native, no react-native-web).
// Built on the library's headless core and Legend List's DOM renderer. Pair with
// the headless hooks (useDateRange, useMonthGrid) re-exported below for selection
// state and custom layouts.
export { MonthView, type MonthViewProps } from "./MonthView";
export { MonthList, type MonthListProps } from "./MonthList";
export { type DomCalendarTheme, darkDomTheme, defaultDomTheme, mergeDomTheme } from "./theme";
export {
  type DateRange,
  type DateSelectionConstraints,
  type DaySelectionState,
  type UseDateRangeOptions,
  type WeekStartsOn,
  daySelectionState,
  isDateSelectable,
  isRangeEndpoint,
  isWithinDateRange,
  nextDateRange,
  useDateRange,
  useMonthGrid,
  buildMonthGrid,
  type MonthGrid,
  type MonthGridDay,
  type MonthGridWeek,
  type MonthGridWeekday,
  type UseMonthGridOptions,
} from "../headless";
