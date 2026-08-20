import { differenceInCalendarDays, format, type Locale, isSameMonth, startOfDay } from "date-fns";
import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DimensionValue,
  type LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type StyleProp,
  Text,
  type TextStyle,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector, type PanGesture } from "react-native-gesture-handler";

// Web drag-to-select relays cell pointer events up to MonthList; native drag is
// driven by a list-level pan there instead.
const isWeb = Platform.OS === "web";
import { useCalendarTheme } from "../theme";
import type { CalendarEvent, EventKeyExtractor, RenderEvent, WeekStartsOn } from "../types";
import { createSlots, type ResolvedSlot, type SlotStyleProps } from "../utils/slots";
import { withEventAccessibilityLabel } from "../utils/withEventAccessibilityLabel";
import {
  type DateRange,
  type EventAccessibilityLabeler,
  type WeekdayFormat,
  dayRangeFromDrag,
  daySelectionState,
  isDateSelectable,
  shiftEventDays,
  useCalendarSelection,
  weekdayFormatToken,
} from "@super-calendar/core";
import { dayBadgeKind, rangeBandKind } from "@super-calendar/core";
import {
  buildMonthWeeks,
  getIsToday,
  filterHiddenDays,
  getWeekDays,
  isSameCalendarDay,
  isWeekend,
} from "@super-calendar/core";
import { monthEventCapacity, monthVisibleCount } from "@super-calendar/core";
import {
  layoutMonthWeek,
  type MonthEventSegment,
  type MonthWeekEvents,
} from "@super-calendar/core";
import {
  compareDayEvents,
  groupEventsByDay,
  isAllDayEvent,
  isBackgroundEvent,
} from "@super-calendar/core";

// Day-cell metrics, mirrored from the styles below, used to estimate how many
// event chips fit when auto-fitting `maxVisibleEventCount`.
const DAY_CELL_PADDING_TOP = 4;
const DATE_BADGE_HEIGHT = 24;
// Vertical centre of the date badge, where the range band is centered.
const BAND_CENTER_Y = DAY_CELL_PADDING_TOP + DATE_BADGE_HEIGHT / 2;
const CELL_ROW_GAP = 2;
const CHIP_PADDING_V = 2;
// Where the first event row sits below the date badge (padding + badge + gap).
const BADGE_AREA = DAY_CELL_PADDING_TOP + DATE_BADGE_HEIGHT + CELL_ROW_GAP;
// Stable empty layout for the events-free picker (avoids a fresh object per render).
const EMPTY_LAYOUT = { segments: [], laneCount: 0 } as const;
// Horizontal inset of a chip within its cell (mirrors `styles.monthEvent`).
const CHIP_INSET_H = 4;
// Pre-measure fallback so the first paint isn't empty or overflowing.
const FALLBACK_VISIBLE_COUNT = 3;
// Hold before a month-grid drag takes over, so a tap or a page swipe still wins.
const DRAG_HOLD_MS = 400;

const numericStyle = (value: number | string | undefined, fallback: number) =>
  typeof value === "number" ? value : fallback;

// The distinct events touching a week row, in the per-day index's sorted order.
// A multi-day event lives in each covered day's bucket, so dedupe by reference.
function collectRowEvents<T>(
  week: Date[],
  eventsByDay: ReadonlyMap<string, CalendarEvent<T>[]>,
): CalendarEvent<T>[] {
  const seen = new Set<CalendarEvent<T>>();
  const out: CalendarEvent<T>[] = [];
  for (const day of week) {
    const list = eventsByDay.get(startOfDay(day).toISOString());
    if (!list) continue;
    for (const event of list) {
      if (!seen.has(event)) {
        seen.add(event);
        out.push(event);
      }
    }
  }
  return out;
}

const pct = (n: number): DimensionValue => `${n}%` as DimensionValue;

/**
 * The styleable parts of {@link MonthView}. Mirrors the dom renderer's slot
 * names where the structure matches; `dayBadgeText` is native-only (React
 * Native text colour doesn't inherit from the badge). Event chips are styled
 * by `renderEvent` (or the theme), not a slot.
 */
export type MonthViewSlot =
  | "title"
  | "weekdays"
  | "weekday"
  | "grid"
  | "week"
  | "day"
  | "dayBadge"
  | "dayBadgeText"
  | "rangeBand"
  | "more"
  | "morePopover";

/** Props for {@link MonthView}, the single-month grid. */
export type MonthViewProps<T> = SlotStyleProps<MonthViewSlot> & {
  date: Date;
  events: CalendarEvent<T>[];
  /**
   * Max event lanes (stacked rows) shown per week before the rest of a day's
   * events collapse into a "+N more" label. Because multi-day events draw as one
   * bar spanning a lane across the week, this caps lanes per row, not chips per
   * day, so a long bar can push a lightly-booked day's own events into "+N more".
   * Omit to auto-fit as many lanes as the cell height allows (the default); set a
   * number for a fixed cap. Auto-fit assumes the built-in chip size — pass an
   * explicit value when using a custom `renderEvent`.
   */
  maxVisibleEventCount?: number;
  weekStartsOn: WeekStartsOn;
  /** Weekdays (0=Sunday…6=Saturday) hidden from the grid, e.g. `[0, 6]` for weekends off. */
  hiddenDays?: number[];
  /** Weekday header label width: `narrow` ("M"), `short` ("Mon", default), or `long` ("Monday"). */
  weekdayFormat?: WeekdayFormat;
  locale?: Locale;
  /** Sort each day's events by start time before slicing. Default true. */
  sortedMonthView?: boolean;
  /** Template for the overflow label; `{moreCount}` is replaced. Default "{moreCount} More". */
  moreLabel?: string;
  /** Show dimmed days from adjacent months in the grid. Default true. */
  showAdjacentMonths?: boolean;
  /** Tint weekend day cells with the theme's weekend background. Default true. */
  highlightWeekends?: boolean;
  /** Ignore taps on month-cell events (day-cell taps still fire). Default false. */
  disableMonthEventCellPress?: boolean;
  /** Reverse the day order within each week (right-to-left). Default false. */
  isRTL?: boolean;
  /** Always render six week rows, for a fixed-height grid. Default false. */
  showSixWeeks?: boolean;
  /** Render the "MMMM yyyy" title above the grid. Default true. */
  showTitle?: boolean;
  /** Render the weekday-label header row above the grid. Default true. */
  showWeekdays?: boolean;
  /** Highlight this date instead of the real "today". */
  activeDate?: Date;
  /** Days drawn as selected (a filled badge), in the month grid. */
  selectedDates?: Date[];
  /** A selected span: endpoints get a filled badge, the span gets the range band. */
  selectedRange?: DateRange;
  /**
   * Fill the whole cell with the range band instead of the default centered
   * rounded "pill" strip. Default false.
   */
  fillCellOnSelection?: boolean;
  /** Earliest selectable day (inclusive); earlier days render disabled. */
  minDate?: Date;
  /** Latest selectable day (inclusive); later days render disabled. */
  maxDate?: Date;
  /** Return true to render a specific day disabled (dimmed, taps ignored). */
  isDateDisabled?: (date: Date) => boolean;
  /** Web drag-to-select relay: a pointer pressed down on this day's cell. */
  onDayPointerDown?: (date: Date) => void;
  /** Web drag-to-select relay: a pressed pointer entered this day's cell. */
  onDayPointerEnter?: (date: Date) => void;
  /** Per-date style merged onto the day cell. */
  calendarCellStyle?: (date: Date) => StyleProp<ViewStyle>;
  renderEvent: RenderEvent<T>;
  /**
   * Override the screen-reader label for each event chip. Receives the event and a
   * `{ mode: "month", isAllDay, ampm: false }` context; return the full text to
   * announce. Defaults to the built-in title-and-time label.
   */
  eventAccessibilityLabel?: EventAccessibilityLabeler<T>;
  keyExtractor: EventKeyExtractor<T>;
  onPressDay?: (date: Date) => void;
  onLongPressDay?: (date: Date) => void;
  onPressEvent: (event: CalendarEvent<T>) => void;
  onLongPressEvent?: (event: CalendarEvent<T>) => void;
  onPressMore?: (events: CalendarEvent<T>[], date: Date) => void;
  /**
   * Enables drag-to-select and reports the swept span live, as the ordered
   * inclusive `[start, end]` days (both at midnight) — pair it with
   * `useDateRange`'s `selectRange` to drive `selectedRange`. Fires on every day the
   * drag crosses, so the highlight follows it; `onCreateEvent` (when also set)
   * fires once on release. Either handler enables the same sweep: hold an empty
   * day and drag on a device, press and drag on the web.
   */
  onSelectDrag?: (start: Date, end: Date) => void;
  /**
   * Enables drag-to-create: hold an empty day and drag across others, then release
   * to fire this with the all-day range (`start` at midnight of the first day,
   * `end` at midnight after the last, exclusive). A plain tap still fires
   * `onPressDay`, not this.
   */
  onCreateEvent?: (start: Date, end: Date) => void;
  /**
   * Enables drag-to-move: hold an event chip and drag it onto another day, then
   * release to fire this with the event and its new bounds, shifted by whole days
   * (the time of day and the duration are kept). Update your own event state in
   * response. Respects each event's `draggable` / `startEditable` / `disabled`
   * flags.
   */
  onDragEvent?: (event: CalendarEvent<T>, start: Date, end: Date) => void | boolean;
  /**
   * Fired when a drag-to-move gesture picks an event up, before anything is
   * committed. Use it for haptic feedback. Inert unless `onDragEvent` is set.
   */
  onDragStart?: (event: CalendarEvent<T>) => void;
  /**
   * Replace the default date badge in each day cell. Receives the day; return
   * your own date label. Event chips and the "+N more" label still render below.
   */
  renderCustomDateForMonth?: (date: Date) => React.ReactNode;
};

function MonthViewInner<T>({
  date,
  events,
  maxVisibleEventCount,
  weekStartsOn,
  hiddenDays,
  weekdayFormat = "short",
  locale,
  sortedMonthView = true,
  moreLabel = "{moreCount} More",
  showAdjacentMonths = true,
  highlightWeekends = true,
  disableMonthEventCellPress = false,
  isRTL = false,
  showSixWeeks = false,
  showTitle = true,
  showWeekdays = true,
  activeDate,
  selectedDates: selectedDatesProp,
  selectedRange: selectedRangeProp,
  fillCellOnSelection = false,
  minDate: minDateProp,
  maxDate: maxDateProp,
  isDateDisabled: isDateDisabledProp,
  calendarCellStyle,
  renderEvent,
  eventAccessibilityLabel,
  keyExtractor,
  onPressDay,
  onLongPressDay,
  onPressEvent,
  onLongPressEvent,
  onPressMore,
  onSelectDrag,
  onCreateEvent,
  onDragEvent,
  onDragStart,
  renderCustomDateForMonth,
  onDayPointerDown,
  onDayPointerEnter,
  classNames,
  styles: styleOverrides,
}: MonthViewProps<T>): ReactElement {
  const theme = useCalendarTheme();
  const slot = createSlots<MonthViewSlot>({ classNames, styles: styleOverrides });
  // Selection comes from context (so cached pages still repaint), but explicit
  // props win for direct/standalone use of MonthView.
  const selection = useCalendarSelection();
  const selectedDates = selectedDatesProp ?? selection.selectedDates;
  const selectedRange = selectedRangeProp ?? selection.selectedRange;
  const minDate = minDateProp ?? selection.minDate;
  const maxDate = maxDateProp ?? selection.maxDate;
  const isDateDisabled = isDateDisabledProp ?? selection.isDateDisabled;
  // Month cells never show a time, so the override context reports 24h (ampm:false).
  const RenderEventComponent = useMemo(
    () => withEventAccessibilityLabel(renderEvent, eventAccessibilityLabel, false),
    [renderEvent, eventAccessibilityLabel],
  );
  // Measured grid height, used to auto-fit the event chips per cell.
  const [gridHeight, setGridHeight] = useState(0);
  // Web-only hover highlight on the day badge (mouse pointers); stays null on
  // touch/native, so it never re-renders there. Mirrors the dom renderer.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // Picker: which day is being pressed, so the tap dims only its badge (the circle),
  // not the whole cell background. Stays null in the events calendar.
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  // Built-in "+N more" popover: opens when the consumer doesn't handle
  // `onPressMore` themselves; lists the day's events in a modal card.
  const [moreOpenFor, setMoreOpenFor] = useState<{
    day: Date;
    events: CalendarEvent<T>[];
  } | null>(null);

  const weeks = useMemo(
    () => buildMonthWeeks(date, weekStartsOn, { showSixWeeks, isRTL, hiddenDays }),
    [date, weekStartsOn, isRTL, showSixWeeks, hiddenDays],
  );

  // Weekday labels for the header row (any week works; reuse this month). Reversed
  // in RTL so they line up with the mirrored day columns.
  const weekdayLabels = useMemo(() => {
    const days = filterHiddenDays(getWeekDays(date, weekStartsOn), hiddenDays);
    return isRTL ? days.reverse() : days;
  }, [date, weekStartsOn, isRTL, hiddenDays]);

  // The built-in chip's height and per-row stride, from the theme's title type.
  // Shared by the capacity estimate and the spanning-bar overlay so the bars line
  // up exactly with the rows the cells reserve for them.
  const chipMetrics = useMemo(() => {
    const fontSize = numericStyle(theme.text.eventTitle.fontSize, 12);
    const lineHeight = numericStyle(theme.text.eventTitle.lineHeight, Math.ceil(fontSize * 1.3));
    const chipHeight = lineHeight + CHIP_PADDING_V * 2;
    return { chipHeight, chipRowHeight: chipHeight + CELL_ROW_GAP };
  }, [theme]);

  // How many chips fit per cell: a fixed cap when `maxVisibleEventCount` is set,
  // else derived from the measured cell height and the (default) chip metrics.
  const capacity = useMemo(() => {
    if (maxVisibleEventCount != null) {
      return { full: maxVisibleEventCount, withMore: maxVisibleEventCount };
    }
    if (gridHeight <= 0 || weeks.length === 0) {
      return { full: FALLBACK_VISIBLE_COUNT, withMore: FALLBACK_VISIBLE_COUNT };
    }
    const rowHeight = gridHeight / weeks.length;
    const moreFontSize = numericStyle(theme.text.more.fontSize, 11);
    const moreRowHeight = Math.ceil(moreFontSize * 1.3) + CELL_ROW_GAP;
    const available = rowHeight - DAY_CELL_PADDING_TOP - DATE_BADGE_HEIGHT;
    return monthEventCapacity(available, chipMetrics.chipRowHeight, moreRowHeight);
  }, [maxVisibleEventCount, gridHeight, weeks.length, theme, chipMetrics]);

  // Group events by calendar day once per `events` change (shared with the dom
  // renderer via core's `groupEventsByDay`), rather than scanning the whole list
  // inside every one of the (up to) 42 day cells on each render. Multi-day events
  // are indexed under every day they span.
  const eventsByDay = useMemo(() => {
    // Background events shade the time grid; the month grid ignores them.
    const map = groupEventsByDay(events.filter((event) => !isBackgroundEvent(event)));
    if (sortedMonthView) {
      // All-day events head the day, then timed events by start (shared with dom).
      for (const list of map.values()) list.sort(compareDayEvents);
    }
    return map;
  }, [events, sortedMonthView]);

  // Draw the day-cell grid only for an events calendar; the events-free date
  // picker reads cleaner without it (matching the dom renderer).
  const showGrid = events.length > 0;

  // Lay out each week row's spanning bars once per data change, not per render.
  const weekLayouts = useMemo(
    () =>
      showGrid
        ? weeks.map((week) => layoutMonthWeek(week, collectRowEvents(week, eventsByDay)))
        : [],
    [showGrid, weeks, eventsByDay],
  );
  // Lanes each row actually draws (the rest collapse into "+N more"). Computed
  // once here because both the render and the drag hit-test need it.
  const visibleLanes = useMemo(
    () => weekLayouts.map((layout) => monthVisibleCount(layout.laneCount, capacity)),
    [weekLayouts, capacity],
  );

  // ---- drag-to-select / create / move --------------------------------------
  // One gesture drives all three: a hold that lands on empty day space sweeps out
  // a day span (reported live through `onSelectDrag`, committed to
  // `onCreateEvent`); a hold that lands on an event chip picks it up and drops it
  // on another day (`onDragEvent`). Native runs it as a grid-level pan, so a drag
  // crosses cells freely; on the web the day cells' own pointer events drive it,
  // because the cell touchables swallow a pan there.
  const sweepEnabled = onSelectDrag != null || onCreateEvent != null;
  const moveEnabled = onDragEvent != null;
  const dragEnabled = sweepEnabled || moveEnabled;
  // Day span being swept, as day timestamps; null when no sweep is running.
  const [sweep, setSweep] = useState<{ anchor: number; hover: number } | null>(null);
  // Event being carried, with the day it was grabbed on and the day under the drag.
  const [carried, setCarried] = useState<{
    event: CalendarEvent<T>;
    from: number;
    over: number;
  } | null>(null);
  const sweepRef = useRef(sweep);
  sweepRef.current = sweep;
  const carriedRef = useRef(carried);
  carriedRef.current = carried;
  // True once a drag has actually crossed onto another day, so a hold that never
  // moves doesn't commit anything.
  const dragMovedRef = useRef(false);
  // Measured grid box, for mapping a drag position to a cell.
  const gridSizeRef = useRef({ width: 0, height: 0 });

  const isSelectable = useCallback(
    (day: Date) =>
      (showAdjacentMonths || isSameMonth(day, date)) &&
      isDateSelectable(day, { minDate, maxDate, isDateDisabled }),
    [showAdjacentMonths, date, minDate, maxDate, isDateDisabled],
  );
  const canCarry = useCallback(
    (event: CalendarEvent<T>) =>
      moveEnabled && !event.disabled && event.draggable !== false && (event.startEditable ?? true),
    [moveEnabled],
  );

  // Map a grid-relative position to its cell, plus the offset inside the row (so
  // the caller can tell an event lane from the empty space below it).
  const cellAt = useCallback(
    (x: number, y: number): { day: Date; row: number; col: number; localY: number } | null => {
      const { width, height } = gridSizeRef.current;
      if (width <= 0 || height <= 0 || weeks.length === 0) return null;
      const rowHeight = height / weeks.length;
      const row = Math.min(weeks.length - 1, Math.max(0, Math.floor(y / rowHeight)));
      const cols = weeks[row].length;
      const col = Math.min(cols - 1, Math.max(0, Math.floor(x / (width / cols))));
      const day = weeks[row][col];
      if (!day) return null;
      return { day, row, col, localY: y - row * rowHeight };
    },
    [weeks],
  );

  // The drawn event bar under a cell position, or null for empty day space.
  const segmentAt = useCallback(
    (row: number, col: number, localY: number): MonthEventSegment<T> | null => {
      const layout = weekLayouts[row];
      if (!layout) return null;
      const lane = Math.floor((localY - BADGE_AREA) / chipMetrics.chipRowHeight);
      if (lane < 0 || lane >= (visibleLanes[row] ?? 0)) return null;
      return (
        layout.segments.find(
          (seg) => seg.lane === lane && seg.startCol <= col && seg.endCol >= col,
        ) ?? null
      );
    },
    [weekLayouts, visibleLanes, chipMetrics],
  );

  const beginSweep = useCallback((day: Date) => {
    const time = startOfDay(day).getTime();
    dragMovedRef.current = false;
    setSweep({ anchor: time, hover: time });
  }, []);
  const beginCarry = useCallback(
    (event: CalendarEvent<T>, day: Date) => {
      const time = startOfDay(day).getTime();
      dragMovedRef.current = false;
      setCarried({ event, from: time, over: time });
      onDragStart?.(event);
    },
    [onDragStart],
  );
  // Move the live drag onto `day`; ignores days the constraints rule out.
  const extendDrag = useCallback(
    (day: Date) => {
      if (!isSelectable(day)) return;
      const time = startOfDay(day).getTime();
      if (carriedRef.current) {
        if (carriedRef.current.over === time) return;
        dragMovedRef.current = true;
        setCarried((current) => (current ? { ...current, over: time } : current));
        return;
      }
      const current = sweepRef.current;
      if (!current || current.hover === time) return;
      dragMovedRef.current = true;
      setSweep((c) => (c ? { ...c, hover: time } : c));
      const [lo, hi] = current.anchor <= time ? [current.anchor, time] : [time, current.anchor];
      onSelectDrag?.(new Date(lo), new Date(hi));
    },
    [isSelectable, onSelectDrag],
  );
  const finishDrag = useCallback(() => {
    const activeSweep = sweepRef.current;
    const activeCarry = carriedRef.current;
    setSweep(null);
    setCarried(null);
    if (!dragMovedRef.current) return;
    if (activeCarry) {
      const delta = differenceInCalendarDays(
        new Date(activeCarry.over),
        new Date(activeCarry.from),
      );
      if (delta === 0) return;
      const next = shiftEventDays(activeCarry.event.start, activeCarry.event.end, delta);
      onDragEvent?.(activeCarry.event, next.start, next.end);
      return;
    }
    if (activeSweep) {
      const range = dayRangeFromDrag(new Date(activeSweep.anchor), new Date(activeSweep.hover));
      onCreateEvent?.(range.start, range.end);
    }
  }, [onCreateEvent, onDragEvent]);

  // Native: one pan over the whole grid, held first so a tap or a page swipe is
  // never hijacked. `runOnJS` because the preview is plain React state (MonthView
  // stays free of Reanimated, so the /picker entry can ship without it).
  const gridGesture = useMemo(() => {
    if (isWeb || !dragEnabled) return undefined;
    return Gesture.Pan()
      .activateAfterLongPress(DRAG_HOLD_MS)
      .runOnJS(true)
      .onStart((gesture) => {
        const cell = cellAt(gesture.x, gesture.y);
        if (!cell || !isSelectable(cell.day)) return;
        const segment = moveEnabled ? segmentAt(cell.row, cell.col, cell.localY) : null;
        if (segment && canCarry(segment.event)) beginCarry(segment.event, cell.day);
        else if (sweepEnabled) beginSweep(cell.day);
      })
      .onUpdate((gesture) => {
        const cell = cellAt(gesture.x, gesture.y);
        if (cell) extendDrag(cell.day);
      })
      .onFinalize(finishDrag);
  }, [
    dragEnabled,
    moveEnabled,
    sweepEnabled,
    cellAt,
    segmentAt,
    isSelectable,
    canCarry,
    beginCarry,
    beginSweep,
    extendDrag,
    finishDrag,
  ]);

  // Web: a released pointer ends the drag wherever it lands, matching the pan's
  // onFinalize. The cells and chips relay the start/extend (see below).
  useEffect(() => {
    if (!isWeb || !dragEnabled) return;
    const target = globalThis as unknown as {
      addEventListener?: (type: string, cb: () => void) => void;
      removeEventListener?: (type: string, cb: () => void) => void;
    };
    target.addEventListener?.("pointerup", finishDrag);
    return () => target.removeEventListener?.("pointerup", finishDrag);
  }, [dragEnabled, finishDrag]);

  // Swallow the tap that follows a committed drag, so it doesn't also open the day.
  const pressDay = useCallback(
    (day: Date) => {
      if (dragMovedRef.current) {
        dragMovedRef.current = false;
        return;
      }
      onPressDay?.(day);
    },
    [onPressDay],
  );

  const renderDay = (
    day: Date,
    dayCol: number,
    rowLayout: MonthWeekEvents<T>,
    rowVisibleLanes: number,
  ) => {
    const isCurrentMonth = isSameMonth(day, date);

    // Blank out adjacent-month days when they're hidden, keeping the grid shape.
    if (!isCurrentMonth && !showAdjacentMonths) {
      return (
        <View
          key={day.toISOString()}
          {...slot("day", {
            base: styles.dayCell,
            themed: [
              showGrid && {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderRightWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.gridLine,
              },
              // No weekend tint on blank placeholders, so the shading doesn't bleed
              // into the empty cells of non-existent days.
              theme.containers.dayCell,
            ],
          })}
        />
      );
    }

    const dayEvents = eventsByDay.get(startOfDay(day).toISOString()) ?? [];
    const isToday = getIsToday(day);
    // Highlight the chosen `activeDate` when supplied, else the real today.
    const isHighlighted = activeDate ? isSameCalendarDay(day, activeDate) : isToday;
    // Selection band wins over the weekend tint; the today badge shows unless the
    // day is selected. Shared with the headless grid so they never diverge.
    const { isDisabled, isSelected, isInRange, isRangeStart, isRangeEnd } = daySelectionState(
      day,
      { selectedDates, selectedRange },
      { minDate, maxDate, isDateDisabled },
    );
    // Events past the visible lanes (this day's segments the row can't show)
    // collapse into "+N more"; the popover still lists the whole day.
    const hiddenEvents = rowLayout.segments
      .filter((s) => s.startCol <= dayCol && s.endCol >= dayCol && s.lane >= rowVisibleLanes)
      .map((s) => s.event);
    const hiddenCount = hiddenEvents.length;

    // The range shows as a band behind the days; endpoints and discrete selected
    // days get a filled badge on top. Today's badge wins when it coincides. The
    // band/badge decisions come from core so both renderers can't disagree.
    const isFilledBadge = dayBadgeKind({ isSelected }, isHighlighted) !== "none";
    const hasBand =
      rangeBandKind({ isInRange, isRangeStart, isRangeEnd }, fillCellOnSelection) !== "none";
    const dayKey = day.toISOString();
    // A hovered, non-filled day gets the subtle badge highlight on the web, but only
    // in the events-free picker. The events calendar (month and list views) has no
    // hover, matching the dom renderer (its events-mode cell omits it).
    const isHovered = isWeb && !isDisabled && !showGrid && hoveredKey === dayKey;
    const dateColor = isDisabled
      ? theme.colors.textDisabled
      : isFilledBadge
        ? isHighlighted
          ? theme.colors.todayText
          : theme.colors.selectedText
        : isCurrentMonth
          ? theme.colors.text
          : theme.colors.textDisabled;

    // Disabled days ignore taps; pass the guards through so a press never fires.
    const handlePressDay = isDisabled || !onPressDay ? undefined : () => pressDay(day);
    const handleLongPressDay =
      isDisabled || !onLongPressDay ? undefined : () => onLongPressDay(day);

    // Live drag feedback: the days a sweep covers are tinted with the range
    // colour, and the day a carried event would land on is outlined.
    const dayTime = startOfDay(day).getTime();
    const inSweep =
      sweep != null &&
      dayTime >= Math.min(sweep.anchor, sweep.hover) &&
      dayTime <= Math.max(sweep.anchor, sweep.hover);
    const isDropTarget = carried != null && carried.over === dayTime;

    // Summarise the cell for screen readers: full date, today marker, and how
    // many events it holds (the chips inside are grouped under this cell).
    const eventCount = dayEvents.length;
    const accessibilityLabel = `${format(day, "EEEE, d LLLL yyyy", { locale })}${isToday ? ", today" : ""}${isSelected ? ", selected" : ""}${isDisabled ? ", unavailable" : ""}, ${eventCount} ${eventCount === 1 ? "event" : "events"}`;

    const daySlot = slot("day", {
      // Events mode mirrors the dom renderer: left-aligned cell content with
      // the date badge in the top-right. The picker (no grid) stays centered
      // so the selection range band lines up with the centered badge.
      base: [styles.dayCell, showGrid && styles.dayCellEvents],
      themed: [
        showGrid && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderRightWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.gridLine,
        },
        highlightWeekends && isWeekend(day) && { backgroundColor: theme.colors.weekendBackground },
        theme.containers.dayCell,
      ],
    });

    return (
      <TouchableOpacity
        key={day.toISOString()}
        {...daySlot}
        // The consumer's per-date style is an explicit override, so it merges
        // after the slot (and survives a `day` class). The drag feedback sits last
        // so it always reads, whatever the cell is otherwise styled with.
        style={[
          daySlot.style,
          calendarCellStyle?.(day),
          inSweep && { backgroundColor: theme.colors.rangeBackground },
          isDropTarget && {
            borderWidth: 2,
            borderColor: theme.colors.selectedBackground,
          },
        ]}
        // In the picker, don't dim the whole cell on press: the tap should show on
        // the badge (the circle) only, not the cell background. `onPressIn/Out` drive
        // the badge's own opacity below. The events calendar keeps the default
        // whole-cell press feedback (a tap there opens the day).
        activeOpacity={showGrid ? 0.2 : 1}
        {...(showGrid && !dragEnabled
          ? null
          : {
              // Touching down starts a fresh interaction, so any pending
              // "swallow the tap that follows a drag" is spent: a drag that ends
              // over a different cell than it started on never produces a press
              // to consume it, and the flag would otherwise eat the next tap.
              onPressIn: () => {
                dragMovedRef.current = false;
                if (!showGrid) setPressedKey(dayKey);
              },
              onPressOut: () => {
                if (!showGrid) setPressedKey((k) => (k === dayKey ? null : k));
              },
            })}
        onPress={handlePressDay}
        onLongPress={handleLongPressDay}
        disabled={isDisabled || (!onPressDay && !onLongPressDay)}
        // Web only: track hover for the badge highlight, relay pointer down/enter so
        // MonthList can extend a range as the pressed pointer sweeps across cells,
        // and drive this grid's own sweep/move drag (a pan can't reach past the cell
        // touchables there). Native uses the grid pan above, and has no hover.
        {...(isWeb && !isDisabled
          ? {
              onPointerEnter: () => {
                // Hover highlight is picker-only; the events calendar matches dom (none).
                if (!showGrid) setHoveredKey(dayKey);
                if (onDayPointerDown) onDayPointerEnter?.(day);
                if (dragEnabled) extendDrag(day);
              },
              onPointerLeave: () => {
                if (!showGrid) setHoveredKey((k) => (k === dayKey ? null : k));
              },
              ...(onDayPointerDown || (dragEnabled && sweepEnabled)
                ? {
                    onPointerDown: () => {
                      onDayPointerDown?.(day);
                      if (dragEnabled && sweepEnabled && isSelectable(day)) beginSweep(day);
                    },
                  }
                : {}),
            }
          : null)}
        // A cell, not a button — it contains the event-chip buttons, and a nested
        // <button> is invalid HTML on web. `cell` is also closer to the correct
        // semantics for a calendar day than `button`.
        role="cell"
        // On web, the events calendar's day cells are not tab stops, so keyboard
        // focus moves through the event chips (real buttons) only, not every empty
        // day — matching the dom renderer. A pointer tap still opens the day. The
        // events-free picker layout (no grid) stays keyboard-navigable for selection.
        {...(isWeb && showGrid ? { focusable: false } : null)}
        accessibilityLabel={accessibilityLabel}
      >
        {hasBand ? (
          <View
            testID="month-range-band"
            {...slot("rangeBand", {
              base: [
                styles.rangeBand,
                { pointerEvents: "none" },
                fillCellOnSelection
                  ? { top: 0, bottom: 0 }
                  : {
                      top: BAND_CENTER_Y - theme.rangeBandHeight / 2,
                      height: theme.rangeBandHeight,
                    },
                // Cap the pill at the endpoint circle (half a badge in from centre)
                // instead of spilling to the cell edge, so no band shows beside it.
                // The events calendar puts the badge in the cell's corner rather
                // than its centre, so there the band spans the whole cell and only
                // rounds its outer ends.
                !fillCellOnSelection &&
                  isRangeStart && {
                    ...(showGrid ? null : { left: "50%", marginLeft: -DATE_BADGE_HEIGHT / 2 }),
                    borderTopLeftRadius: theme.rangeBandHeight / 2,
                    borderBottomLeftRadius: theme.rangeBandHeight / 2,
                  },
                !fillCellOnSelection &&
                  isRangeEnd && {
                    ...(showGrid ? null : { right: "50%", marginRight: -DATE_BADGE_HEIGHT / 2 }),
                    borderTopRightRadius: theme.rangeBandHeight / 2,
                    borderBottomRightRadius: theme.rangeBandHeight / 2,
                  },
              ],
              themed: { backgroundColor: theme.colors.rangeBackground },
            })}
          />
        ) : null}
        {renderCustomDateForMonth ? (
          renderCustomDateForMonth(day)
        ) : (
          <View
            {...slot("dayBadge", {
              base: [
                styles.dateBadge,
                showGrid && styles.dateBadgeEvents,
                // Tap feedback lives on the badge, not the cell (picker only);
                // kept even under a class so the press still reads.
                !showGrid && pressedKey === dayKey && { opacity: 0.2 },
              ],
              themed: [
                isFilledBadge && {
                  backgroundColor: isHighlighted
                    ? theme.colors.todayBackground
                    : theme.colors.selectedBackground,
                  borderRadius: theme.todayBadgeRadius,
                },
                isHovered &&
                  !isFilledBadge && {
                    backgroundColor: theme.colors.hoverBackground,
                    borderRadius: theme.todayBadgeRadius,
                  },
                theme.containers.dayBadge,
              ],
            })}
          >
            <Text
              {...slot<TextStyle>("dayBadgeText", {
                themed: [theme.text.dateCell, { color: dateColor }],
              })}
              allowFontScaling={false}
            >
              {format(day, "d")}
            </Text>
          </View>
        )}
        {/* Reserve one row per visible lane so the overlay bars have space and
            "+more" sits below them; the bars themselves render in the row overlay
            (they span cells). */}
        {Array.from({ length: rowVisibleLanes }, (_, i) => (
          <View
            key={`lane-${i}`}
            style={{ height: chipMetrics.chipHeight, pointerEvents: "none" }}
          />
        ))}
        {hiddenCount > 0 ? (
          <Text
            {...slot<TextStyle>("more", {
              base: styles.moreLabel,
              themed: [theme.text.more, { color: theme.colors.textMuted }],
            })}
            onPress={
              onPressMore
                ? () => onPressMore(dayEvents, day)
                : () => setMoreOpenFor({ day, events: dayEvents })
            }
            accessibilityRole="button"
            accessibilityLabel={`Show ${hiddenCount} more events`}
            allowFontScaling={false}
          >
            {moreLabel.replace("{moreCount}", String(hiddenCount))}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    gridSizeRef.current = { width, height };
    setGridHeight((prev) => (prev === height ? prev : height));
  };

  return (
    <View style={styles.root}>
      {showTitle ? (
        <Text
          {...slot<TextStyle>("title", {
            base: styles.title,
            themed: [theme.text.monthTitle, { color: theme.colors.text }],
          })}
          allowFontScaling={false}
        >
          {format(date, "MMMM yyyy", locale ? { locale } : undefined)}
        </Text>
      ) : null}
      {showWeekdays ? (
        <View
          {...slot("weekdays", {
            base: styles.weekdayHeader,
            themed: theme.containers.weekdayHeader,
          })}
        >
          {weekdayLabels.map((day) => (
            <Text
              key={day.toISOString()}
              {...slot<TextStyle>("weekday", {
                base: styles.weekdayLabel,
                themed: [theme.text.weekday, { color: theme.colors.textMuted }],
              })}
              allowFontScaling={false}
            >
              {format(day, weekdayFormatToken(weekdayFormat), { locale })}
            </Text>
          ))}
        </View>
      ) : null}
      {moreOpenFor ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setMoreOpenFor(null)}>
          <Pressable
            style={styles.moreBackdrop}
            accessibilityLabel="Close"
            onPress={() => setMoreOpenFor(null)}
          >
            <Pressable
              // Swallow taps on the card so only the backdrop dismisses.
              onPress={() => {}}
              {...slot("morePopover", {
                base: styles.moreCard,
                themed: {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.gridLine,
                },
              })}
            >
              <Text
                accessibilityRole="header"
                style={[styles.moreCardTitle, { color: theme.colors.text }]}
                allowFontScaling={false}
              >
                {format(moreOpenFor.day, "EEEE, d LLLL yyyy", { locale })}
              </Text>
              <ScrollView>
                {moreOpenFor.events.map((event, index) => (
                  <View key={keyExtractor(event, index)} style={styles.moreCardRow}>
                    <RenderEventComponent
                      event={event}
                      mode="month"
                      isAllDay={isAllDayEvent(event)}
                      onPress={() => {
                        setMoreOpenFor(null);
                        onPressEvent(event);
                      }}
                    />
                  </View>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
      <Grid
        gesture={gridGesture}
        slot={slot("grid", { base: styles.container })}
        onLayout={handleLayout}
      >
        {weeks.map((week, weekIndex) => {
          // Spanning bars for this row (laid out once in `weekLayouts`). A multi-day
          // event is one bar across its columns, stacked into lanes; the bars render
          // in an overlay so they can span cells, and the cells reserve the lane rows
          // so "+more" sits below them. `rowVisibleLanes` mirrors the per-day cap.
          const rowLayout = weekLayouts[weekIndex] ?? EMPTY_LAYOUT;
          const rowVisibleLanes = visibleLanes[weekIndex] ?? 0;
          const cols = week.length;
          // With adjacent months hidden, clamp bars to the current-month columns so
          // none draw over the blank leading/trailing cells.
          let firstVisCol = 0;
          let lastVisCol = cols - 1;
          if (showGrid && !showAdjacentMonths) {
            const first = week.findIndex((d) => isSameMonth(d, date));
            if (first !== -1) {
              firstVisCol = first;
              lastVisCol = cols - 1 - [...week].reverse().findIndex((d) => isSameMonth(d, date));
            }
          }
          return (
            <View
              {...slot("week", { base: styles.weekRow, themed: theme.containers.weekRow })}
              key={week[0].toISOString()}
            >
              {week.map((day, dayCol) => renderDay(day, dayCol, rowLayout, rowVisibleLanes))}
              {showGrid ? (
                <View style={[StyleSheet.absoluteFill, { pointerEvents: "box-none" }]}>
                  {rowLayout.segments
                    .filter((seg) => seg.lane < rowVisibleLanes)
                    .map((seg) => {
                      const startCol = Math.max(seg.startCol, firstVisCol);
                      const endCol = Math.min(seg.endCol, lastVisCol);
                      if (startCol > endCol) return null;
                      const isCarried = carried?.event === seg.event;
                      return (
                        <View
                          key={`bar-${seg.event.start.toISOString()}:${seg.event.title}:${seg.lane}`}
                          style={{
                            position: "absolute",
                            left: pct((startCol / cols) * 100),
                            width: pct(((endCol - startCol + 1) / cols) * 100),
                            top: BADGE_AREA + seg.lane * chipMetrics.chipRowHeight,
                            height: chipMetrics.chipHeight,
                            paddingHorizontal: CHIP_INSET_H,
                            // Carrying an event must let the drag reach the cells
                            // underneath, so the drop lands on the day it covers.
                            pointerEvents: sweep || carried ? "none" : "box-none",
                            opacity: isCarried ? 0.4 : 1,
                          }}
                          {...(isWeb && moveEnabled && canCarry(seg.event)
                            ? {
                                onPointerDown: (event: { nativeEvent?: { offsetX?: number } }) => {
                                  // A bar can span days, so pick the day actually
                                  // under the pointer: its offset within the bar,
                                  // measured in whole columns from the bar's start.
                                  const gridWidth = gridSizeRef.current.width;
                                  const colWidth = gridWidth > 0 ? gridWidth / cols : 0;
                                  const offsetX = event.nativeEvent?.offsetX ?? 0;
                                  const span = endCol - startCol + 1;
                                  const within =
                                    colWidth > 0
                                      ? Math.min(
                                          span - 1,
                                          Math.max(0, Math.floor(offsetX / colWidth)),
                                        )
                                      : 0;
                                  const grabbed = week[startCol + within];
                                  if (grabbed) beginCarry(seg.event, grabbed);
                                },
                              }
                            : null)}
                        >
                          <RenderEventComponent
                            event={seg.event}
                            mode="month"
                            isAllDay={isAllDayEvent(seg.event)}
                            onPress={
                              disableMonthEventCellPress ? () => {} : () => onPressEvent(seg.event)
                            }
                            onLongPress={
                              disableMonthEventCellPress || !onLongPressEvent
                                ? undefined
                                : () => onLongPressEvent(seg.event)
                            }
                          />
                        </View>
                      );
                    })}
                </View>
              ) : null}
            </View>
          );
        })}
      </Grid>
    </View>
  );
}

// The month grid box, wrapped in a GestureDetector only when a drag handler is
// wired. Keeping the wrapper conditional means a plain MonthView never requires a
// GestureHandlerRootView above it.
function Grid({
  gesture,
  slot,
  onLayout,
  children,
}: {
  gesture?: PanGesture;
  slot: ResolvedSlot;
  onLayout: (event: LayoutChangeEvent) => void;
  children: React.ReactNode;
}) {
  const grid = (
    <View testID="month-grid" {...slot} onLayout={onLayout}>
      {children}
    </View>
  );
  return gesture ? <GestureDetector gesture={gesture}>{grid}</GestureDetector> : grid;
}

/**
 * A single month rendered as a 7-column grid of day cells, each showing its
 * event chips with a "+N more" overflow. Render it on its own for a static
 * month, or let `MonthList`/`Calendar` page through months for you.
 *
 * @example
 * ```tsx
 * import { MonthView, type CalendarEvent } from "@super-calendar/native";
 *
 * <MonthView
 *   date={new Date()}
 *   events={events}
 *   onPressDay={(day) => console.log(day)}
 * />
 * ```
 */
export const MonthView = memo(MonthViewInner) as typeof MonthViewInner;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // Layout only; the font is themeable via `theme.text.monthTitle`.
  title: {
    paddingTop: 10,
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  weekdayHeader: {
    flexDirection: "row",
    paddingBottom: 4,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: "center",
  },
  container: {
    flex: 1,
  },
  weekRow: {
    flex: 1,
    flexDirection: "row",
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    paddingTop: 4,
    gap: 2,
    overflow: "hidden",
  },
  dayCellEvents: {
    alignItems: "stretch",
  },
  dateBadge: {
    justifyContent: "center",
    alignItems: "center",
    height: 24,
    width: 24,
  },
  dateBadgeEvents: {
    alignSelf: "flex-end",
    marginRight: 4,
  },
  rangeBand: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  monthEvent: {
    marginHorizontal: 4,
  },
  moreLabel: {
    marginTop: 2,
    marginHorizontal: 4,
  },
  // The built-in "+N more" popover card.
  moreBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  moreCard: {
    width: "100%",
    maxWidth: 360,
    maxHeight: "60%",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 6,
  },
  moreCardTitle: { fontSize: 14, fontWeight: "600", marginBottom: 4 },
  moreCardRow: { marginBottom: 4 },
});
