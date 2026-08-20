import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isSameMonth,
  type Locale,
  startOfDay,
  startOfMonth,
} from "date-fns";
import {
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  bandRounding,
  buildMonthGrid,
  type CalendarEvent,
  compareDayEvents,
  dayBadgeKind,
  type DateRange,
  type DateSelectionConstraints,
  dayRangeFromDrag,
  type EventAccessibilityLabeler,
  groupEventsByDay,
  isBackgroundEvent,
  isAllDayEvent,
  layoutMonthWeek,
  type MonthGridDay,
  type MonthGridWeek,
  rangeBandKind,
  shiftEventDays,
  type WeekdayFormat,
  type WeekStartsOn,
} from "@super-calendar/core";
import { createSlots, dataState, type SlotDefault, type SlotStyleProps } from "./slots";
import { type DomCalendarTheme, mergeDomTheme } from "./theme";

/**
 * Styleable parts of {@link MonthView}. Pass a class or inline style per slot via
 * the `classNames` / `styles` props to restyle just that part.
 */
export type MonthViewSlot =
  | "title"
  | "weekdays"
  | "weekday"
  | "grid"
  | "week"
  | "day"
  | "dayBadge"
  | "rangeBand"
  | "events"
  | "chipButton"
  | "chip"
  | "more"
  | "morePopover";

// Stable empty layout for rows with no events (avoids a fresh object per render).
const EMPTY_LAYOUT = { segments: [], laneCount: 0 } as const;

// Chip metrics for the events layout (when `events` is provided).
const DATE_ROW = 24;
const CHIP_HEIGHT = 18;
const CHIP_GAP = 2;
const CELL_PAD = 4;
// Pointer travel (px, Manhattan distance) before a press on a chip becomes a
// drag-to-move rather than a click that opens the event.
const MOVE_THRESHOLD_PX = 4;

/** Props passed to a custom month event chip renderer. */
export interface DomMonthEventArgs<T = unknown> {
  /** The event to render. */
  event: CalendarEvent<T>;
  /** Call to fire the view's `onPressEvent` for this chip. */
  onPress: () => void;
}

/** A component that renders a single month-grid event chip. */
export type DomMonthEvent<T = unknown> = ComponentType<DomMonthEventArgs<T>>;

/** Props for {@link MonthView}. */
export interface MonthViewProps<T = unknown>
  extends DateSelectionConstraints, SlotStyleProps<MonthViewSlot> {
  /** Any day within the month to render. */
  date: Date;
  /** First day of the week. Sunday = 0 (default) … Saturday = 6. */
  weekStartsOn?: WeekStartsOn;
  /** Weekdays (0=Sunday…6=Saturday) hidden from the grid, e.g. `[0, 6]` for weekends off. */
  hiddenDays?: number[];
  /** Weekday header label width: `narrow` ("M"), `short` ("Mon", default), or `long` ("Monday"). */
  weekdayFormat?: WeekdayFormat;
  /**
   * Events to render as chips in each day cell. Passing this (even `[]`) switches
   * the grid to the calendar layout (date in the corner, chips below); omit it for
   * the compact date-picker look.
   */
  events?: CalendarEvent<T>[];
  /** Custom chip renderer; falls back to the built-in titled chip. */
  renderEvent?: DomMonthEvent<T>;
  /**
   * Override the screen-reader label for each event chip. Receives the event and a
   * `{ mode: "month", isAllDay, ampm: false }` context; return the full text to
   * announce. Defaults to the event title and day (e.g. "Standup, 15 July").
   */
  eventAccessibilityLabel?: EventAccessibilityLabeler<T>;
  /**
   * Max event lanes (stacked rows) shown per week before the rest of a day's
   * events collapse into a "+N more" row (default 3). Because multi-day events draw
   * as one bar spanning a lane across the week, this caps lanes per row, not chips
   * per day, so a long bar can push a lightly-booked day's own events into "+N more".
   */
  maxVisibleEventCount?: number;
  /** Template for the overflow row; `{moreCount}` is replaced (default "{moreCount} More"). */
  moreLabel?: string;
  /** Tap an event chip. */
  onPressEvent?: (event: CalendarEvent<T>) => void;
  /** Tap the "+N more" overflow row. */
  onPressMore?: (events: CalendarEvent<T>[], date: Date) => void;
  /** Selected span; days between the endpoints get the range band. */
  selectedRange?: DateRange;
  /** Discrete selected days (single / multiple). */
  selectedDates?: Date[];
  /** Render days from the neighbouring months in the leading/trailing cells (default true). */
  showAdjacentMonths?: boolean;
  /** Tint weekend day cells with the theme's weekend background (default true). */
  highlightWeekends?: boolean;
  /**
   * Fill the whole cell with the range background instead of the default
   * centered rounded "pill" strip. Default false.
   */
  fillCellOnSelection?: boolean;
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
  /**
   * In events mode, enables drag-to-create: press on a day and drag across others
   * to sketch a span, then release to fire this with the all-day range (`start` at
   * midnight of the first day, `end` at midnight after the last, exclusive). A plain
   * click without dragging still fires `onPressDay`, not this. Days being sketched
   * carry `data-creating` for styling.
   */
  onCreateEvent?: (start: Date, end: Date) => void;
  /**
   * Enables drag-to-select and reports the swept span live, as the ordered
   * inclusive `[start, end]` days (both at midnight) — pair it with
   * `useDateRange`'s `selectRange` to drive `selectedRange`. Fires on every day the
   * pointer crosses, so the highlight follows the drag; `onCreateEvent` (when also
   * set) fires once on release. Either handler enables the same sweep gesture.
   */
  onSelectDrag?: (start: Date, end: Date) => void;
  /**
   * Enables drag-to-move: drag an event chip onto another day and release to fire
   * this with the event and its new bounds, shifted by whole days (the time of day
   * and duration are kept). Update your own event state in response. Respects each
   * event's `draggable` / `startEditable` / `disabled` flags. The day under the
   * pointer carries `data-dragover` for styling.
   */
  onDragEvent?: (event: CalendarEvent<T>, start: Date, end: Date) => void | boolean;
  /**
   * When events are shown, also make the day cells keyboard-navigable: a single
   * roving tab stop, arrow keys move the focus, Enter opens the day (`onPressDay`).
   * Default false, so keyboard focus moves through events only. The date picker
   * (rendered without `events`) is always navigable regardless of this flag.
   */
  keyboardDayNavigation?: boolean;
  /** Class applied to the root element. */
  className?: string;
  /** Inline styles applied to the root element. */
  style?: CSSProperties;
}

// Each helper returns the slot's built-in styling split into `base` (structural,
// always applied) and `themed` (colour/type/spacing, dropped when a class is set).

function dayCellDefault(
  day: MonthGridDay,
  theme: DomCalendarTheme,
  highlightWeekends: boolean,
): SlotDefault {
  return {
    base: {
      position: "relative",
      height: theme.cellHeight,
      border: "none",
      font: "inherit",
      cursor: day.isDisabled ? "default" : "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 0,
      WebkitTapHighlightColor: "transparent",
    },
    themed: {
      // The range band is a separate layer; the cell only carries the weekend tint.
      background:
        highlightWeekends && day.isWeekend && !day.isInRange
          ? theme.weekendBackground
          : "transparent",
      fontSize: 15,
      color: day.isDisabled ? theme.textDisabled : theme.text,
    },
  };
}

/**
 * The range band behind a day, rendered as its own layer so it can be a centered
 * rounded strip (the default) or fill the whole cell (`fillCell`). Returns null
 * for days with no band. Endpoints get the leading/trailing pill rounding. Its
 * geometry is structural; only the fill colour is themed.
 *
 * In events mode the strip tracks the compact date badge instead of the picker's
 * tall cell, so it reads as a band across the dates rather than a block over the
 * event chips (and matches the native renderer's month grid).
 */
function rangeBandDefault(
  day: MonthGridDay,
  theme: DomCalendarTheme,
  fillCell: boolean,
  eventsMode: boolean,
): SlotDefault | null {
  const kind = rangeBandKind(day, fillCell);
  if (kind === "none") return null;
  const fill = kind === "fill";
  const badgeSize = eventsMode ? DATE_ROW - 2 : theme.dayBadgeSize;
  const bandHeight = eventsMode ? badgeSize : theme.rangeBandHeight;
  const inset = fill ? 0 : eventsMode ? CELL_PAD : Math.max(0, (theme.cellHeight - bandHeight) / 2);
  const radius = fill ? 0 : bandHeight / 2;
  const rounding = bandRounding(kind);
  // Cap the pill at the endpoint circles: a start/end band stops at the circle's
  // outer edge (half a badge in from the cell centre) rather than spilling to the
  // cell edge, so no band shows in the empty space beside the day circles. Events
  // mode puts the badge in the cell's corner instead of its centre, so there the
  // band spans the whole cell and only rounds its outer ends.
  const cap = eventsMode ? 0 : `calc(50% - ${badgeSize / 2}px)`;
  const base: CSSProperties = {
    position: "absolute",
    left: rounding.start ? cap : 0,
    right: rounding.end ? cap : 0,
    top: inset,
    // An events cell is far taller than its date row, so the strip is sized from
    // the badge rather than stretched to the cell's bottom.
    ...(fill || !eventsMode ? { bottom: inset } : { height: bandHeight }),
    zIndex: 0,
  };
  if (rounding.start) {
    base.borderTopLeftRadius = radius;
    base.borderBottomLeftRadius = radius;
  }
  if (rounding.end) {
    base.borderTopRightRadius = radius;
    base.borderBottomRightRadius = radius;
  }
  return { base, themed: { background: theme.rangeBackground } };
}

function badgeDefault(day: MonthGridDay, theme: DomCalendarTheme, hovered: boolean): SlotDefault {
  const badge = dayBadgeKind(day, day.isToday);
  const filled = badge !== "none";
  const background = filled
    ? badge === "today"
      ? theme.todayBackground
      : theme.selectedBackground
    : hovered
      ? theme.hoverBackground
      : "transparent";
  return {
    base: {
      position: "relative",
      zIndex: 1,
      width: theme.dayBadgeSize,
      height: theme.dayBadgeSize,
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    themed: {
      background,
      color: filled ? (day.isToday ? theme.todayText : theme.selectedText) : "inherit",
    },
  };
}

// --- Calendar (events) layout styles -------------------------------------

function eventCellDefault(
  day: MonthGridDay,
  theme: DomCalendarTheme,
  height: number,
  highlightWeekends: boolean,
): SlotDefault {
  return {
    base: {
      position: "relative",
      minHeight: height,
      minWidth: 0,
      border: "none",
      cursor: day.isDisabled ? "default" : "pointer",
      display: "flex",
      flexDirection: "column",
      gap: CHIP_GAP,
      padding: CELL_PAD,
      boxSizing: "border-box",
      textAlign: "left",
      WebkitTapHighlightColor: "transparent",
    },
    themed: {
      borderTop: `1px solid ${theme.gridLine}`,
      background:
        highlightWeekends && day.isWeekend && !day.isInRange
          ? theme.weekendBackground
          : "transparent",
      color: day.isDisabled ? theme.textDisabled : theme.text,
    },
  };
}

function compactBadgeDefault(day: MonthGridDay, theme: DomCalendarTheme): SlotDefault {
  const badge = dayBadgeKind(day, day.isToday);
  const filled = badge !== "none";
  return {
    base: {
      position: "relative",
      zIndex: 1,
      alignSelf: "flex-end",
      width: DATE_ROW - 2,
      height: DATE_ROW - 2,
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    themed: {
      fontSize: 13,
      background: filled
        ? badge === "today"
          ? theme.todayBackground
          : theme.selectedBackground
        : "transparent",
      color: filled ? (day.isToday ? theme.todayText : theme.selectedText) : "inherit",
    },
  };
}

const chipButtonDefault: SlotDefault = {
  base: {
    position: "relative",
    zIndex: 1,
    border: "none",
    padding: 0,
    margin: 0,
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
  },
};

function chipDefault(theme: DomCalendarTheme): SlotDefault {
  return {
    base: {
      display: "block",
      height: CHIP_HEIGHT,
      lineHeight: `${CHIP_HEIGHT}px`,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    themed: {
      padding: "0 6px",
      borderRadius: 4,
      background: theme.eventBackground,
      color: theme.eventText,
      fontSize: 11,
      fontWeight: 600,
    },
  };
}

function moreButtonDefault(theme: DomCalendarTheme): SlotDefault {
  return {
    base: {
      position: "relative",
      zIndex: 1,
      border: "none",
      background: "transparent",
      cursor: "pointer",
      textAlign: "left",
      height: CHIP_HEIGHT,
      lineHeight: `${CHIP_HEIGHT}px`,
      fontFamily: "inherit",
    },
    themed: {
      padding: "0 6px",
      fontSize: 11,
      fontWeight: 600,
      color: theme.textMuted,
    },
  };
}

// Internal-only: MonthList passes a day→events index built once for the whole
// list (via `groupEventsByDay`) so each month doesn't rebuild it. Not exported,
// so it stays off the public MonthViewProps surface.
interface MonthViewInternalProps<T = unknown> extends MonthViewProps<T> {
  eventsByDay?: ReadonlyMap<string, CalendarEvent<T>[]>;
}

// The distinct events touching a week row, in the per-day index's sorted order.
// A multi-day event lives in each covered day's bucket, so dedupe by reference;
// this scans only the row's days, not every event in the month.
function collectRowEvents<T>(
  week: MonthGridWeek,
  eventsByDay: ReadonlyMap<string, CalendarEvent<T>[]>,
): CalendarEvent<T>[] {
  const seen = new Set<CalendarEvent<T>>();
  const out: CalendarEvent<T>[] = [];
  for (const day of week.days) {
    const list = eventsByDay.get(startOfDay(day.date).toISOString());
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

/**
 * A single static month grid, rendered with plain DOM elements.
 *
 * @example
 * ```tsx
 * <MonthView date={new Date()} events={events} onPressDay={(d) => setDate(d)} />
 * ```
 */
export function MonthView<T = unknown>({
  date,
  weekStartsOn = 0,
  hiddenDays,
  weekdayFormat = "short",
  events,
  eventsByDay: eventsByDayProp,
  renderEvent,
  eventAccessibilityLabel,
  maxVisibleEventCount = 3,
  moreLabel = "{moreCount} More",
  onPressEvent,
  onPressMore,
  selectedRange,
  selectedDates,
  showAdjacentMonths = true,
  highlightWeekends = true,
  fillCellOnSelection = false,
  showTitle = true,
  showWeekdays = true,
  locale,
  theme: themeOverrides,
  minDate,
  maxDate,
  isDateDisabled,
  onPressDay,
  onCreateEvent,
  onSelectDrag,
  onDragEvent,
  keyboardDayNavigation = false,
  className,
  style,
  classNames,
  styles,
}: MonthViewInternalProps<T>): ReactElement {
  const theme = useMemo(() => mergeDomTheme(themeOverrides), [themeOverrides]);
  const slot = createSlots<MonthViewSlot>({ classNames, styles });

  // Calendar layout (date in the corner + event chips) is on whenever `events`
  // is provided; otherwise the compact picker badge layout is used.
  const eventsMode = events !== undefined;
  // The day cells form a roving tab stop (arrow keys + Enter) in the picker
  // always, and in events mode only when the consumer opts in. Otherwise events
  // mode tabs through the event chips alone.
  const dayRoving = !eventsMode || keyboardDayNavigation;
  // Use the list-built index when provided (MonthList), else build it for this
  // month. Either way lookups use startOfDay(date).toISOString().
  const eventsByDay = useMemo(() => {
    // The list (MonthList) sorts before passing its index in; only sort here when
    // building our own, so each day reads all-day events first, then by start.
    if (eventsByDayProp) return eventsByDayProp;
    // Background events shade the time grid; the month grid ignores them.
    const map = groupEventsByDay((events ?? []).filter((event) => !isBackgroundEvent(event)));
    for (const list of map.values()) list.sort(compareDayEvents);
    return map;
  }, [eventsByDayProp, events]);
  const Chip = renderEvent;
  // Built-in "+N more" popover: opens when the consumer doesn't handle
  // `onPressMore` themselves. Keyed by the day id; closes on outside click,
  // Escape, or picking an event.
  const [moreOpenFor, setMoreOpenFor] = useState<string | null>(null);
  const morePopoverRef = useRef<HTMLDivElement | null>(null);
  // The "+N more" button that opened the popover, so focus can return to it.
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (moreOpenFor) {
      // Move focus into the dialog so keyboard users land on the first event.
      morePopoverRef.current?.querySelector<HTMLElement>("button")?.focus();
      return;
    }
    // Return focus to the trigger when the popover closes.
    moreTriggerRef.current?.focus();
    moreTriggerRef.current = null;
  }, [moreOpenFor]);
  useEffect(() => {
    if (!moreOpenFor) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (!morePopoverRef.current?.contains(e.target as Node)) {
        // A pointer dismissal moves focus to whatever was clicked; don't yank
        // it back to the trigger (that's for Escape and event selection).
        moreTriggerRef.current = null;
        setMoreOpenFor(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpenFor(null);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpenFor]);
  // Reserve `maxVisibleEventCount` rows below the date so every cell is uniform;
  // when a day overflows, the last row becomes the "+N more" affordance.
  const eventRowHeight = CELL_PAD * 2 + DATE_ROW + maxVisibleEventCount * (CHIP_HEIGHT + CHIP_GAP);
  const { weeks, weekdays } = useMemo(
    () =>
      buildMonthGrid(date, {
        weekStartsOn,
        hiddenDays,
        weekdayFormat,
        selectedRange,
        selectedDates,
        minDate,
        maxDate,
        isDateDisabled,
        locale,
      }),
    [
      date,
      weekStartsOn,
      weekdayFormat,
      selectedRange,
      selectedDates,
      minDate,
      maxDate,
      isDateDisabled,
      locale,
    ],
  );

  // Lay out each week row's spanning bars once per data change, not per render, so
  // hover / popover / drag-create state changes don't relay out every row.
  const weekLayouts = useMemo(
    () =>
      eventsMode
        ? weeks.map((week) =>
            layoutMonthWeek(
              week.days.map((d) => d.date),
              collectRowEvents(week, eventsByDay),
            ),
          )
        : [],
    [eventsMode, weeks, eventsByDay],
  );

  // Roving tabindex: only one day is in the tab order; arrow keys move focus
  // within the month, so the grid is a single, sensible tab stop.
  const initialFocus = useMemo(() => {
    const inMonth = (d?: Date | null) => !!d && isSameMonth(d, date);
    if (inMonth(selectedRange?.start)) return startOfDay(selectedRange!.start);
    const picked = selectedDates?.find(inMonth);
    if (picked) return startOfDay(picked);
    const today = new Date();
    return isSameMonth(today, date) ? startOfDay(today) : startOfMonth(date);
  }, [date, selectedRange, selectedDates]);

  const [focusedDate, setFocusedDate] = useState(initialFocus);
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;
  const monthKey = format(date, "yyyy-MM");
  useEffect(() => setFocusedDate(initialFocusRef.current), [monthKey]);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusKey = format(focusedDate, "yyyy-MM-dd");

  // Drag-to-create / drag-to-select (events mode): press a day and drag across
  // others to sketch an all-day span, released on a window pointerup so a drop
  // anywhere still commits. `onSelectDrag` reports the span live during the sweep;
  // `onCreateEvent` reports it once on release. Either handler enables the gesture.
  const sweepEnabled = onCreateEvent != null || onSelectDrag != null;
  const [creating, setCreating] = useState<{ anchor: number; hover: number } | null>(null);
  const creatingRef = useRef(creating);
  creatingRef.current = creating;
  const movedRef = useRef(false);
  // Set when a drag commits, so the click the browser fires next is swallowed
  // (it must not also open the day via onPressDay).
  const suppressClickRef = useRef(false);
  const beginCreate = (day: Date) => {
    if (!sweepEnabled) return;
    const t = startOfDay(day).getTime();
    movedRef.current = false;
    setCreating({ anchor: t, hover: t });
  };
  const extendCreate = (day: Date) => {
    if (!creatingRef.current) return;
    const t = startOfDay(day).getTime();
    if (t !== creatingRef.current.hover) {
      movedRef.current = true;
      setCreating((c) => (c ? { ...c, hover: t } : c));
      const anchor = creatingRef.current.anchor;
      const [lo, hi] = anchor <= t ? [anchor, t] : [t, anchor];
      onSelectDrag?.(new Date(lo), new Date(hi));
    }
  };
  const isCreating = creating !== null;
  useEffect(() => {
    if (!isCreating) return;
    const finish = () => {
      const c = creatingRef.current;
      setCreating(null);
      if (!c || !movedRef.current) return;
      suppressClickRef.current = true;
      const range = dayRangeFromDrag(new Date(c.anchor), new Date(c.hover));
      onCreateEvent?.(range.start, range.end);
    };
    window.addEventListener("pointerup", finish);
    return () => window.removeEventListener("pointerup", finish);
  }, [isCreating, onCreateEvent]);

  // Drag-to-move: pick an event chip up and drop it on another day. The drag only
  // arms on pointerdown; it activates once the pointer travels past a small
  // threshold, so a plain click still opens the event. The day under the pointer
  // comes from the cells' own pointerenter (the chips go non-interactive while a
  // drag is live), so a drop lands on the day it visually covers.
  const [moving, setMoving] = useState<{
    event: CalendarEvent<T>;
    from: number;
    over: number;
    active: boolean;
  } | null>(null);
  const movingRef = useRef(moving);
  movingRef.current = moving;
  const moveOriginRef = useRef({ x: 0, y: 0 });
  const canDragEvent = (event: CalendarEvent<T>) =>
    onDragEvent != null &&
    !event.disabled &&
    event.draggable !== false &&
    (event.startEditable ?? true);
  const beginMove = (event: CalendarEvent<T>, day: Date, clientX: number, clientY: number) => {
    const t = startOfDay(day).getTime();
    moveOriginRef.current = { x: clientX, y: clientY };
    setMoving({ event, from: t, over: t, active: false });
  };
  const extendMove = (day: Date) => {
    const t = startOfDay(day).getTime();
    setMoving((m) => (m && m.over !== t ? { ...m, over: t } : m));
  };
  const isMoveArmed = moving !== null;
  const isMoving = moving?.active === true;
  useEffect(() => {
    if (!isMoveArmed) return;
    const onPointerMove = (e: PointerEvent) => {
      if (movingRef.current?.active !== false) return;
      const origin = moveOriginRef.current;
      if (Math.abs(e.clientX - origin.x) + Math.abs(e.clientY - origin.y) < MOVE_THRESHOLD_PX)
        return;
      setMoving((m) => (m ? { ...m, active: true } : m));
    };
    const finish = () => {
      const m = movingRef.current;
      setMoving(null);
      if (!m?.active) return;
      // A drag that ends where it began is a no-op, but it must still swallow the
      // click so the chip doesn't also report a press.
      suppressClickRef.current = true;
      const delta = differenceInCalendarDays(new Date(m.over), new Date(m.from));
      if (delta === 0) return;
      const next = shiftEventDays(m.event.start, m.event.end, delta);
      onDragEvent?.(m.event, next.start, next.end);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
    };
  }, [isMoveArmed, onDragEvent]);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: Date | null = null;
    if (e.key === "ArrowLeft") next = addDays(focusedDate, -1);
    else if (e.key === "ArrowRight") next = addDays(focusedDate, 1);
    else if (e.key === "ArrowUp") next = addDays(focusedDate, -7);
    else if (e.key === "ArrowDown") next = addDays(focusedDate, 7);
    else if (e.key === "Home") next = startOfMonth(date);
    else if (e.key === "End") next = endOfMonth(date);
    else return;
    e.preventDefault();
    if (!isSameMonth(next, date)) return;
    setFocusedDate(next);
    const key = format(next, "yyyy-MM-dd");
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`)?.focus();
  };

  return (
    <div
      className={className}
      style={{ fontFamily: theme.fontFamily, color: theme.text, ...style }}
    >
      {showTitle ? (
        <div
          {...slot("title", {
            themed: { fontSize: 17, fontWeight: 700, padding: "10px 14px 6px" },
          })}
        >
          {format(date, "MMMM yyyy", locale ? { locale } : undefined)}
        </div>
      ) : null}
      {showWeekdays ? (
        <div
          {...slot("weekdays", {
            base: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" },
            themed: { borderBottom: `1px solid ${theme.gridLine}`, padding: "6px 0" },
          })}
        >
          {weekdays.map((wd) => (
            <span
              key={wd.label}
              {...slot("weekday", {
                themed: {
                  textAlign: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  color: theme.textMuted,
                },
              })}
            >
              {wd.label}
            </span>
          ))}
        </div>
      ) : null}
      <div
        ref={gridRef}
        role="grid"
        aria-label={format(date, "MMMM yyyy", locale ? { locale } : undefined)}
        // Arrow-key roving applies whenever the day cells are a tab stop: the
        // picker always, events mode only when keyboardDayNavigation is set.
        onKeyDown={dayRoving ? onKeyDown : undefined}
        // A drag that ends over a cell other than the one it started on produces no
        // click, so the flag it armed would otherwise swallow the next real click.
        // Capture phase, so it still runs when a chip stops its own pointerdown.
        onPointerDownCapture={() => {
          suppressClickRef.current = false;
        }}
        {...slot("grid")}
      >
        {weeks.map((week, weekIndex) => {
          // Spanning bars for this row (laid out once in `weekLayouts`). A multi-day
          // event is one bar across its columns, stacked into lanes; each bar renders
          // inside its start-column cell (valid grid content that reads with that day)
          // and overflows right across the days it spans. The cells reserve the lane
          // rows so "+more" sits below the bars.
          const rowLayout = weekLayouts[weekIndex] ?? EMPTY_LAYOUT;
          // When lanes overflow, keep the last row for "+more" but always show at
          // least one bar, so a day never collapses to only the overflow row.
          const overflowing = rowLayout.laneCount > maxVisibleEventCount;
          const visibleLanes = overflowing
            ? Math.max(maxVisibleEventCount - 1, 1)
            : rowLayout.laneCount;
          // With adjacent months hidden, clamp bars to the current-month columns so
          // none draw over the blank leading/trailing cells.
          const cols = week.days.length;
          let firstVisCol = 0;
          let lastVisCol = cols - 1;
          if (eventsMode && !showAdjacentMonths) {
            const first = week.days.findIndex((d) => d.isCurrentMonth);
            const lastFromEnd = [...week.days].reverse().findIndex((d) => d.isCurrentMonth);
            if (first !== -1) {
              firstVisCol = first;
              lastVisCol = cols - 1 - lastFromEnd;
            }
          }
          const barSegs = rowLayout.segments
            .filter((s) => s.lane < visibleLanes)
            .map((s) => {
              const startCol = Math.max(s.startCol, firstVisCol);
              const endCol = Math.min(s.endCol, lastVisCol);
              return {
                seg: s,
                startCol,
                endCol,
                continuesBefore: s.continuesBefore || startCol > s.startCol,
                continuesAfter: s.continuesAfter || endCol < s.endCol,
              };
            })
            .filter((b) => b.startCol <= b.endCol);
          const barChipButton = slot("chipButton", chipButtonDefault);
          const barChip = slot("chip", chipDefault(theme));
          return (
            <div
              key={week.id}
              role="row"
              {...slot("week", {
                base: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" },
              })}
            >
              {week.days.map((day, dayCol) => {
                const hidden = !showAdjacentMonths && !day.isCurrentMonth;
                const cellHeight = eventsMode ? eventRowHeight : theme.cellHeight;
                if (hidden) {
                  return (
                    <div key={day.id} role="gridcell" aria-hidden style={{ height: cellHeight }} />
                  );
                }
                const band = rangeBandDefault(day, theme, fillCellOnSelection, eventsMode);
                const label = format(
                  day.date,
                  "EEEE, d MMMM yyyy",
                  locale ? { locale } : undefined,
                );
                const dayTime = startOfDay(day.date).getTime();
                const inCreate =
                  creating != null &&
                  dayTime >= Math.min(creating.anchor, creating.hover) &&
                  dayTime <= Math.max(creating.anchor, creating.hover);
                const isDropTarget = isMoving && moving?.over === dayTime;
                // Present/absent data-* attributes so consumers can style day state
                // with CSS/Tailwind variants (e.g. `data-[today]:bg-blue-500`).
                const dayData = dataState({
                  "data-today": day.isToday,
                  "data-selected": day.isSelected,
                  "data-range": day.isInRange,
                  "data-weekend": day.isWeekend,
                  "data-outside": !day.isCurrentMonth,
                  "data-disabled": day.isDisabled,
                  "data-creating": inCreate,
                  "data-dragover": isDropTarget,
                });

                if (eventsMode) {
                  const dayEvents = eventsByDay.get(startOfDay(day.date).toISOString()) ?? [];
                  // Events past the visible lanes (this day's segments in a lane the
                  // row doesn't show) collapse into "+N more"; the popover lists the
                  // whole day.
                  const hiddenEvents = rowLayout.segments
                    .filter(
                      (s) => s.startCol <= dayCol && s.endCol >= dayCol && s.lane >= visibleLanes,
                    )
                    .map((s) => s.event);
                  const dayLabel = format(day.date, "d MMMM", locale ? { locale } : undefined);
                  const dayCellProps = slot(
                    "day",
                    eventCellDefault(day, theme, cellHeight, highlightWeekends),
                  );
                  return (
                    // Events mode: by default the cell is not a tab stop, so keyboard
                    // focus moves through the event chips (real buttons) only, not
                    // every empty day. With keyboardDayNavigation the cell joins the
                    // roving tab order (arrow keys + Enter to open the day). A pointer
                    // click always drills into the day.
                    <div
                      key={day.id}
                      role="gridcell"
                      data-day={day.id}
                      {...dayData}
                      tabIndex={keyboardDayNavigation ? (day.id === focusKey ? 0 : -1) : undefined}
                      aria-disabled={day.isDisabled || undefined}
                      aria-label={label}
                      {...dayCellProps}
                      // Drag-to-create and drag-to-move disable touch scroll on the
                      // cell so a swipe sketches a span (or carries a chip) instead
                      // of scrolling the grid.
                      style={
                        sweepEnabled || onDragEvent
                          ? {
                              ...dayCellProps.style,
                              touchAction: "none",
                              ...(isDropTarget
                                ? {
                                    outline: `2px solid ${theme.selectedBackground}`,
                                    outlineOffset: -2,
                                  }
                                : null),
                            }
                          : dayCellProps.style
                      }
                      onPointerDown={
                        sweepEnabled && !day.isDisabled
                          ? (e) => {
                              if (e.button === 0) beginCreate(day.date);
                            }
                          : undefined
                      }
                      onPointerEnter={
                        sweepEnabled || onDragEvent
                          ? () => {
                              extendCreate(day.date);
                              if (movingRef.current && !day.isDisabled) extendMove(day.date);
                            }
                          : undefined
                      }
                      onClick={
                        day.isDisabled
                          ? undefined
                          : () => {
                              if (suppressClickRef.current) {
                                suppressClickRef.current = false;
                                return;
                              }
                              onPressDay?.(day.date);
                            }
                      }
                      onKeyDown={
                        keyboardDayNavigation && !day.isDisabled
                          ? (e) => {
                              // Let Enter/Space on a focused chip activate the chip.
                              if (e.target !== e.currentTarget) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onPressDay?.(day.date);
                              }
                            }
                          : undefined
                      }
                    >
                      {band ? <span data-band aria-hidden {...slot("rangeBand", band)} /> : null}
                      <span {...dayData} {...slot("dayBadge", compactBadgeDefault(day, theme))}>
                        {day.label}
                      </span>
                      {/* Spanning bars that start in this column: absolutely placed,
                          overflowing right across the days they span. Rendered here
                          (not a row overlay) so each bar is valid content of its
                          start day's gridcell and reads with that day. Made
                          non-interactive mid drag-create (and mid drag-move) so a
                          sweep reaches the cells beneath. */}
                      {barSegs
                        .filter((b) => b.startCol === dayCol)
                        .map((b) => {
                          const span = b.endCol - b.startCol + 1;
                          const draggable = canDragEvent(b.seg.event);
                          const isDragged = isMoving && moving?.event === b.seg.event;
                          return (
                            <button
                              key={`bar-${b.seg.event.start.toISOString()}:${b.seg.event.title}:${b.seg.lane}`}
                              type="button"
                              onPointerDown={
                                draggable
                                  ? (e) => {
                                      if (e.button !== 0) return;
                                      // A press on a chip picks the event up, so it
                                      // must not also start a create sweep on the
                                      // cell underneath.
                                      e.stopPropagation();
                                      // A bar can span several days, so grab the day
                                      // actually under the pointer rather than the
                                      // bar's start day — the drop then shifts by
                                      // what the user sees them move. An unmeasured
                                      // bar falls back to its first day.
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      const col =
                                        rect.width > 0
                                          ? Math.min(
                                              span - 1,
                                              Math.max(
                                                0,
                                                Math.floor(
                                                  (e.clientX - rect.left) / (rect.width / span),
                                                ),
                                              ),
                                            )
                                          : 0;
                                      const grabbed = week.days[b.startCol + col];
                                      if (grabbed) {
                                        beginMove(b.seg.event, grabbed.date, e.clientX, e.clientY);
                                      }
                                    }
                                  : undefined
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                if (suppressClickRef.current) {
                                  suppressClickRef.current = false;
                                  return;
                                }
                                onPressEvent?.(b.seg.event);
                              }}
                              {...barChipButton}
                              title={b.seg.event.title}
                              aria-label={
                                eventAccessibilityLabel
                                  ? eventAccessibilityLabel(b.seg.event, {
                                      mode: "month",
                                      isAllDay: isAllDayEvent(b.seg.event),
                                      ampm: false,
                                    })
                                  : `${b.seg.event.title}, ${dayLabel}`
                              }
                              style={{
                                ...barChipButton.style,
                                position: "absolute",
                                left: 2,
                                width: `calc(${span * 100}% - 4px)`,
                                top:
                                  CELL_PAD +
                                  DATE_ROW +
                                  CHIP_GAP +
                                  b.seg.lane * (CHIP_HEIGHT + CHIP_GAP),
                                height: CHIP_HEIGHT,
                                pointerEvents: isCreating || isMoving ? "none" : "auto",
                                ...(draggable ? { touchAction: "none", cursor: "grab" } : null),
                                ...(isDragged ? { opacity: 0.4 } : null),
                                zIndex: 2,
                              }}
                            >
                              {Chip ? (
                                <Chip
                                  event={b.seg.event}
                                  onPress={() => onPressEvent?.(b.seg.event)}
                                />
                              ) : (
                                <span
                                  {...barChip}
                                  style={{
                                    ...barChip.style,
                                    ...(b.continuesBefore
                                      ? { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }
                                      : null),
                                    ...(b.continuesAfter
                                      ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 }
                                      : null),
                                  }}
                                >
                                  {b.seg.event.title}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      <div
                        {...slot("events", {
                          base: { display: "flex", flexDirection: "column", gap: CHIP_GAP },
                        })}
                      >
                        {/* Reserve one row per visible lane so the absolute bars have
                          space and "+more" sits below them. */}
                        {Array.from({ length: visibleLanes }, (_, i) => (
                          <div key={`lane-${i}`} aria-hidden style={{ height: CHIP_HEIGHT }} />
                        ))}
                        {hiddenEvents.length > 0 ? (
                          <button
                            type="button"
                            // In built-in-popover mode, keep the document
                            // pointerdown dismiss from firing before this click's
                            // toggle, so pressing the button again closes it.
                            onPointerDown={onPressMore ? undefined : (e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onPressMore) onPressMore(hiddenEvents, day.date);
                              else {
                                moreTriggerRef.current = e.currentTarget;
                                setMoreOpenFor((open) => (open === day.id ? null : day.id));
                              }
                            }}
                            {...slot("more", moreButtonDefault(theme))}
                            aria-label={`${hiddenEvents.length} more events, ${dayLabel}`}
                            aria-expanded={onPressMore ? undefined : moreOpenFor === day.id}
                          >
                            {moreLabel.replace("{moreCount}", String(hiddenEvents.length))}
                          </button>
                        ) : null}
                        {moreOpenFor === day.id ? (
                          <div
                            ref={morePopoverRef}
                            // A non-modal dialog: Tab stays inside and Escape closes,
                            // but the page behind is not inert (outside clicks work),
                            // so no aria-modal claim.
                            role="dialog"
                            aria-label={dayLabel}
                            onPointerDown={(e) => e.stopPropagation()}
                            // Contain Tab inside the dialog; Escape (handled on the
                            // document) closes it and restores focus to the trigger.
                            onKeyDown={(e) => {
                              if (e.key !== "Tab") return;
                              const buttons =
                                morePopoverRef.current?.querySelectorAll<HTMLElement>("button");
                              if (!buttons?.length) return;
                              const first = buttons[0];
                              const last = buttons[buttons.length - 1];
                              if (e.shiftKey && document.activeElement === first) {
                                e.preventDefault();
                                last.focus();
                              } else if (!e.shiftKey && document.activeElement === last) {
                                e.preventDefault();
                                first.focus();
                              }
                            }}
                            {...slot("morePopover", {
                              base: {
                                position: "absolute",
                                top: 2,
                                left: 2,
                                right: 2,
                                zIndex: 10,
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                                maxHeight: 240,
                                overflowY: "auto",
                              },
                              themed: {
                                background: theme.surface,
                                border: `1px solid ${theme.gridLine}`,
                                borderRadius: 8,
                                padding: 6,
                                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                              },
                            })}
                          >
                            <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted }}>
                              {dayLabel}
                            </div>
                            {dayEvents.map((event, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => {
                                  setMoreOpenFor(null);
                                  onPressEvent?.(event);
                                }}
                                style={{
                                  display: "block",
                                  width: "100%",
                                  border: "none",
                                  background: "transparent",
                                  padding: 0,
                                  font: "inherit",
                                  textAlign: "left",
                                  cursor: "pointer",
                                }}
                              >
                                {Chip ? (
                                  <Chip event={event} onPress={() => onPressEvent?.(event)} />
                                ) : (
                                  <span {...slot("chip", chipDefault(theme))}>{event.title}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                }

                return (
                  <button
                    key={day.id}
                    type="button"
                    role="gridcell"
                    data-day={day.id}
                    {...dayData}
                    tabIndex={day.id === focusKey ? 0 : -1}
                    aria-disabled={day.isDisabled || undefined}
                    aria-label={label}
                    aria-pressed={day.isSelected || day.isInRange}
                    {...slot("day", dayCellDefault(day, theme, highlightWeekends))}
                    onClick={day.isDisabled ? undefined : () => onPressDay?.(day.date)}
                    onMouseEnter={day.isDisabled ? undefined : () => setHoveredKey(day.id)}
                    onMouseLeave={() => setHoveredKey((k) => (k === day.id ? null : k))}
                  >
                    {band ? <span data-band aria-hidden {...slot("rangeBand", band)} /> : null}
                    <span
                      {...dayData}
                      {...slot("dayBadge", badgeDefault(day, theme, hoveredKey === day.id))}
                    >
                      {day.label}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
