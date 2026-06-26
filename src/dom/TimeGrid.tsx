import { format, type Locale } from "date-fns";
import { type ComponentType, type CSSProperties, useEffect, useMemo, useRef } from "react";
import {
  type CalendarEvent,
  type CalendarMode,
  getIsToday,
  getViewDays,
  isAllDayEvent,
  isSameCalendarDay,
  layoutDayEvents,
  type TimeGridMode,
  type WeekStartsOn,
} from "../headless";
import { type DomCalendarTheme, mergeDomTheme } from "./theme";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const GUTTER_WIDTH = 56;

/** Props passed to a custom time-grid event renderer. */
export interface DomRenderEventArgs<T = unknown> {
  event: CalendarEvent<T>;
  mode: CalendarMode;
  /** True when rendered in the all-day lane. */
  isAllDay: boolean;
  /** Pixel height of the event box (timed events only). */
  boxHeight?: number;
  /** Clipped multi-day segment markers. */
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  onPress: () => void;
}

export type DomRenderEvent<T = unknown> = ComponentType<DomRenderEventArgs<T>>;

export interface TimeGridProps<T = unknown> {
  /** Anchor date; the visible day columns are derived from `mode`. */
  date: Date;
  events?: CalendarEvent<T>[];
  /** "day" (default), "3days", "week", or "custom" (with `numberOfDays`). */
  mode?: TimeGridMode;
  /** Column count for "3days"/"custom"-style N-day views. */
  numberOfDays?: number;
  weekStartsOn?: WeekStartsOn;
  /** Pixels per hour (default 48). */
  hourHeight?: number;
  /** Initial scroll position, in minutes from midnight (default 8:00). */
  scrollOffsetMinutes?: number;
  locale?: Locale;
  theme?: Partial<DomCalendarTheme>;
  /** Height of the scroll viewport, in px (default 600). */
  height?: number | string;
  /** Custom event renderer; falls back to a built-in chip. */
  renderEvent?: DomRenderEvent<T>;
  onPressEvent?: (event: CalendarEvent<T>) => void;
  onPressDayHeader?: (day: Date) => void;
  className?: string;
  style?: CSSProperties;
}

function DefaultDomEvent<T>({
  event,
  isAllDay,
  theme,
}: DomRenderEventArgs<T> & { theme: DomCalendarTheme }) {
  return (
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
        padding: "2px 6px",
        borderRadius: 6,
        background: theme.eventBackground,
        color: theme.eventText,
        fontSize: 12,
        lineHeight: 1.25,
      }}
    >
      <div
        style={{
          fontWeight: 600,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
        }}
      >
        {event.title}
      </div>
      {!isAllDay ? (
        <div style={{ opacity: 0.75 }}>
          {format(event.start, "HH:mm")}–{format(event.end, "HH:mm")}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A day / week / N-day time grid rendered with plain DOM elements. Events are
 * positioned with the library's pure `layoutDayEvents`, so overlap columns and
 * multi-day clipping match the React Native renderer. Static for now: pinch-zoom
 * and drag land in a later pass.
 */
export function TimeGrid<T = unknown>({
  date,
  events = [],
  mode = "day",
  numberOfDays = 1,
  weekStartsOn = 0,
  hourHeight = 48,
  scrollOffsetMinutes = 8 * 60,
  locale,
  theme: themeOverrides,
  height = 600,
  renderEvent,
  onPressEvent,
  onPressDayHeader,
  className,
  style,
}: TimeGridProps<T>) {
  const theme = useMemo(() => mergeDomTheme(themeOverrides), [themeOverrides]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dfns = locale ? { locale } : undefined;

  const days = useMemo(
    () => getViewDays(mode, date, weekStartsOn, numberOfDays),
    [mode, date, weekStartsOn, numberOfDays],
  );

  const allDayByDay = useMemo(
    () =>
      days.map((day) => events.filter((e) => isAllDayEvent(e) && isSameCalendarDay(e.start, day))),
    [days, events],
  );
  const hasAllDay = allDayByDay.some((list) => list.length > 0);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = (scrollOffsetMinutes / 60) * hourHeight;
  }, [scrollOffsetMinutes, hourHeight]);

  const Renderer = renderEvent;
  const totalHeight = 24 * hourHeight;
  const now = new Date();

  return (
    <div
      className={className}
      style={{
        fontFamily: theme.fontFamily,
        color: theme.text,
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {/* Header: day columns */}
      <div style={{ display: "flex", borderBottom: `1px solid ${theme.gridLine}` }}>
        <div style={{ width: GUTTER_WIDTH, flex: "none" }} />
        {days.map((day) => {
          const today = getIsToday(day);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={onPressDayHeader ? () => onPressDayHeader(day) : undefined}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                font: "inherit",
                color: theme.textMuted,
                cursor: onPressDayHeader ? "pointer" : "default",
                padding: "6px 0",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600 }}>{format(day, "EEE", dfns)}</span>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 15,
                  fontWeight: 600,
                  background: today ? theme.todayBackground : "transparent",
                  color: today ? theme.todayText : theme.text,
                }}
              >
                {format(day, "d", dfns)}
              </span>
            </button>
          );
        })}
      </div>

      {/* All-day lane */}
      {hasAllDay ? (
        <div style={{ display: "flex", borderBottom: `1px solid ${theme.gridLine}` }}>
          <div
            style={{
              width: GUTTER_WIDTH,
              flex: "none",
              fontSize: 10,
              color: theme.textMuted,
              textAlign: "right",
              padding: "4px 6px 0 0",
            }}
          >
            all-day
          </div>
          {allDayByDay.map((list, i) => (
            <div
              key={days[i].toISOString()}
              style={{ flex: 1, padding: 2, display: "flex", flexDirection: "column", gap: 2 }}
            >
              {list.map((event, j) => {
                const args: DomRenderEventArgs<T> = {
                  event,
                  mode,
                  isAllDay: true,
                  onPress: () => onPressEvent?.(event),
                };
                return (
                  <button
                    key={j}
                    type="button"
                    onClick={() => onPressEvent?.(event)}
                    style={{
                      border: "none",
                      padding: 0,
                      background: "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      height: 22,
                    }}
                  >
                    {Renderer ? (
                      <Renderer {...args} />
                    ) : (
                      <DefaultDomEvent {...args} theme={theme} />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      {/* Scrollable body */}
      <div ref={scrollRef} style={{ overflowY: "auto", height, position: "relative" }}>
        <div style={{ display: "flex", height: totalHeight, position: "relative" }}>
          {/* Hour gutter */}
          <div style={{ width: GUTTER_WIDTH, flex: "none", position: "relative" }}>
            {HOURS.map((h) => (
              <div
                key={h}
                style={{
                  position: "absolute",
                  top: h * hourHeight - 6,
                  right: 6,
                  fontSize: 10,
                  color: theme.textMuted,
                }}
              >
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const positioned = layoutDayEvents(events, day);
            const showNow = isSameCalendarDay(day, now);
            const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * hourHeight;
            return (
              <div
                key={day.toISOString()}
                style={{
                  flex: 1,
                  position: "relative",
                  borderLeft: `1px solid ${theme.gridLine}`,
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${hourHeight - 1}px, ${theme.gridLine} ${hourHeight - 1}px, ${theme.gridLine} ${hourHeight}px)`,
                }}
              >
                {positioned.map((pe, idx) => {
                  const top = pe.startHours * hourHeight;
                  const boxHeight = Math.max(pe.durationHours * hourHeight, 14);
                  const widthPct = 100 / pe.columns;
                  const args: DomRenderEventArgs<T> = {
                    event: pe.event,
                    mode,
                    isAllDay: false,
                    boxHeight,
                    continuesBefore: pe.continuesBefore,
                    continuesAfter: pe.continuesAfter,
                    onPress: () => onPressEvent?.(pe.event),
                  };
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onPressEvent?.(pe.event)}
                      style={{
                        position: "absolute",
                        top,
                        height: boxHeight,
                        left: `calc(${pe.column * widthPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                        border: "none",
                        padding: 0,
                        background: "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {Renderer ? (
                        <Renderer {...args} />
                      ) : (
                        <DefaultDomEvent {...args} theme={theme} />
                      )}
                    </button>
                  );
                })}
                {showNow ? (
                  <div
                    style={{
                      position: "absolute",
                      top: nowTop,
                      left: 0,
                      right: 0,
                      height: 0,
                      zIndex: 2,
                    }}
                  >
                    <div style={{ height: 2, background: theme.nowIndicator }} />
                    <div
                      style={{
                        position: "absolute",
                        left: -3,
                        top: -3,
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: theme.nowIndicator,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
