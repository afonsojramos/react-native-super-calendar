import { format, type Locale } from "date-fns";
import { type CSSProperties, useMemo } from "react";
import {
  buildMonthGrid,
  type DateRange,
  type DateSelectionConstraints,
  type MonthGridDay,
  type WeekStartsOn,
} from "../headless";
import { type DomCalendarTheme, mergeDomTheme } from "./theme";

export interface MonthViewProps extends DateSelectionConstraints {
  /** Any day within the month to render. */
  date: Date;
  /** First day of the week. Sunday = 0 (default) … Saturday = 6. */
  weekStartsOn?: WeekStartsOn;
  /** Selected span; days between the endpoints get the range band. */
  selectedRange?: DateRange;
  /** Discrete selected days (single / multiple). */
  selectedDates?: Date[];
  /** Show only this month's days (default true), matching the picker look. */
  ownDaysOnly?: boolean;
  /** Render the "Month yyyy" title above the grid (default true). */
  showTitle?: boolean;
  /** Render the weekday header row (default true). */
  showWeekdays?: boolean;
  /** date-fns locale for the title and weekday labels. */
  locale?: Locale;
  /** Theme overrides; falls back to the default light theme. */
  theme?: Partial<DomCalendarTheme>;
  /** Fired when a selectable day is clicked. */
  onPressDay?: (date: Date) => void;
  className?: string;
  style?: CSSProperties;
}

function dayCellStyle(day: MonthGridDay, theme: DomCalendarTheme): CSSProperties {
  const base: CSSProperties = {
    height: theme.cellHeight,
    border: "none",
    background: "transparent",
    font: "inherit",
    fontSize: 15,
    color: day.isDisabled ? theme.textDisabled : theme.text,
    cursor: day.isDisabled ? "default" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    WebkitTapHighlightColor: "transparent",
  };
  if (day.isWeekend && !day.isInRange) base.background = theme.weekendBackground;
  // Continuous range band: full fill inside, half-fill on the endpoints so the
  // badge sits on a clean side.
  if (day.isInRange) base.background = theme.rangeBackground;
  if (day.isRangeStart && !day.isRangeEnd) {
    base.background = `linear-gradient(to right, transparent 50%, ${theme.rangeBackground} 50%)`;
  }
  if (day.isRangeEnd && !day.isRangeStart) {
    base.background = `linear-gradient(to left, transparent 50%, ${theme.rangeBackground} 50%)`;
  }
  if (day.isRangeStart && day.isRangeEnd) base.background = "transparent";
  return base;
}

function badgeStyle(day: MonthGridDay, theme: DomCalendarTheme): CSSProperties {
  const filled =
    day.isToday || day.isRangeStart || day.isRangeEnd || (day.isSelected && !day.isInRange);
  return {
    width: theme.dayBadgeSize,
    height: theme.dayBadgeSize,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: filled
      ? day.isToday
        ? theme.todayBackground
        : theme.selectedBackground
      : "transparent",
    color: filled ? (day.isToday ? theme.todayText : theme.selectedText) : "inherit",
  };
}

/** A single static month grid, rendered with plain DOM elements. */
export function MonthView({
  date,
  weekStartsOn = 0,
  selectedRange,
  selectedDates,
  ownDaysOnly = true,
  showTitle = true,
  showWeekdays = true,
  locale,
  theme: themeOverrides,
  minDate,
  maxDate,
  isDateDisabled,
  onPressDay,
  className,
  style,
}: MonthViewProps) {
  const theme = useMemo(() => mergeDomTheme(themeOverrides), [themeOverrides]);
  const { weeks, weekdays } = useMemo(
    () =>
      buildMonthGrid(date, {
        weekStartsOn,
        selectedRange,
        selectedDates,
        minDate,
        maxDate,
        isDateDisabled,
        locale,
      }),
    [date, weekStartsOn, selectedRange, selectedDates, minDate, maxDate, isDateDisabled, locale],
  );

  return (
    <div
      className={className}
      style={{ fontFamily: theme.fontFamily, color: theme.text, ...style }}
    >
      {showTitle ? (
        <div style={{ fontSize: 17, fontWeight: 700, padding: "10px 14px 6px" }}>
          {format(date, "MMMM yyyy", locale ? { locale } : undefined)}
        </div>
      ) : null}
      {showWeekdays ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            borderBottom: `1px solid ${theme.gridLine}`,
            padding: "6px 0",
          }}
        >
          {weekdays.map((wd) => (
            <span
              key={wd.label}
              style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: theme.textMuted }}
            >
              {wd.label}
            </span>
          ))}
        </div>
      ) : null}
      {weeks.map((week) => (
        <div key={week.id} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {week.days.map((day) => {
            const hidden = ownDaysOnly && !day.isCurrentMonth;
            if (hidden) return <div key={day.id} style={{ height: theme.cellHeight }} />;
            return (
              <button
                key={day.id}
                type="button"
                disabled={day.isDisabled}
                aria-label={format(day.date, "EEEE, d MMMM yyyy", locale ? { locale } : undefined)}
                aria-pressed={day.isSelected || day.isInRange}
                style={dayCellStyle(day, theme)}
                onClick={day.isDisabled ? undefined : () => onPressDay?.(day.date)}
              >
                <span style={badgeStyle(day, theme)}>{day.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
