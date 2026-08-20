import { act, fireEvent, render, within } from "@testing-library/react-native";
import { StyleSheet, Text, type ViewStyle } from "react-native";
import { CalendarThemeProvider, defaultTheme, mergeTheme } from "../../theme";
import type { CalendarEvent } from "../../types";
import { DefaultEvent } from "../DefaultEvent";
import { MonthView } from "../MonthView";

const baseProps = {
  date: new Date(2026, 5, 15), // June 2026
  events: [] as CalendarEvent[],
  weekStartsOn: 0 as const,
  renderEvent: DefaultEvent,
  keyExtractor: (_event: CalendarEvent, index: number) => String(index),
  onPressEvent: () => {},
};

const backgroundColorOf = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as ViewStyle)?.backgroundColor;

describe("MonthView selection", () => {
  it("announces a single selected day", () => {
    const { getByLabelText } = render(
      <MonthView {...baseProps} selectedDates={[new Date(2026, 5, 15)]} />,
    );
    expect(getByLabelText(/15 June 2026, selected/)).toBeTruthy();
  });

  it("marks both range endpoints as selected and renders a band behind the interior", () => {
    const range = { start: new Date(2026, 5, 10), end: new Date(2026, 5, 14) };
    const { getByLabelText } = render(<MonthView {...baseProps} selectedRange={range} />);

    expect(getByLabelText(/10 June 2026, selected/)).toBeTruthy();
    expect(getByLabelText(/14 June 2026, selected/)).toBeTruthy();

    // An interior day carries the range band (a child layer), not the badge.
    const interior = getByLabelText(/12 June 2026, 0 events/);
    const band = within(interior).getByTestId("month-range-band");
    expect(backgroundColorOf(band)).toBe(defaultTheme.colors.rangeBackground);
    expect(() => getByLabelText(/12 June 2026, selected/)).toThrow();
  });

  it("renders the band as a rounded pill by default and a full-cell fill when opted in", () => {
    const range = { start: new Date(2026, 5, 10), end: new Date(2026, 5, 14) };
    const radiusOf = (n: { props: { style?: unknown } }) =>
      StyleSheet.flatten(n.props.style as ViewStyle)?.borderTopLeftRadius ?? 0;

    const pill = render(<MonthView {...baseProps} selectedRange={range} />);
    const pillStart = within(pill.getByLabelText(/10 June 2026/)).getByTestId("month-range-band");
    expect(radiusOf(pillStart)).toBeGreaterThan(0); // rounded leading edge

    const fill = render(<MonthView {...baseProps} selectedRange={range} fillCellOnSelection />);
    const fillStart = within(fill.getByLabelText(/10 June 2026/)).getByTestId("month-range-band");
    expect(radiusOf(fillStart)).toBe(0); // square, fills the cell
  });

  it("leaves cells outside any selection unstyled by selection", () => {
    const { getByLabelText } = render(
      <MonthView {...baseProps} selectedDates={[new Date(2026, 5, 15)]} />,
    );
    const other = getByLabelText(/20 June 2026, 0 events/);
    expect(within(other).queryByTestId("month-range-band")).toBeNull();
  });
});

describe("MonthView grid", () => {
  const borderOf = (n: { props: { style?: unknown } }) =>
    StyleSheet.flatten(n.props.style as ViewStyle)?.borderTopWidth ?? 0;

  it("draws no day-cell grid for the events-free picker", () => {
    const { getByLabelText } = render(<MonthView {...baseProps} />); // events: []
    expect(borderOf(getByLabelText(/15 June 2026/))).toBe(0);
  });

  it("draws the day-cell grid when there are events (calendar)", () => {
    const events: CalendarEvent[] = [
      { title: "X", start: new Date(2026, 5, 15, 9), end: new Date(2026, 5, 15, 10) },
    ];
    const { getByLabelText } = render(<MonthView {...baseProps} events={events} />);
    expect(borderOf(getByLabelText(/15 June 2026/))).toBeGreaterThan(0);
  });
});

describe("MonthView weekend shading", () => {
  // Sat 20 June 2026 is a weekend day in the rendered month.
  it("tints weekend cells by default and drops the tint with highlightWeekends=false", () => {
    const on = render(<MonthView {...baseProps} />);
    expect(backgroundColorOf(on.getByLabelText(/Saturday, 20 June 2026/))).toBe(
      defaultTheme.colors.weekendBackground,
    );
    const off = render(<MonthView {...baseProps} highlightWeekends={false} />);
    expect(backgroundColorOf(off.getByLabelText(/Saturday, 20 June 2026/))).toBeUndefined();
  });
});

describe("MonthView renderCustomDateForMonth", () => {
  it("replaces the default date badge with the custom renderer's output", () => {
    const { getByText, queryByText } = render(
      <MonthView
        {...baseProps}
        renderCustomDateForMonth={(day) => <Text>{`day-${day.getDate()}`}</Text>}
      />,
    );
    // The custom label renders for the current month's days.
    expect(getByText("day-15")).toBeTruthy();
    // The default bare day number is gone (replaced by the custom label).
    expect(queryByText("15")).toBeNull();
  });
});

describe("MonthView container theming", () => {
  const styleOf = (n: { props: { style?: unknown } }) =>
    StyleSheet.flatten(n.props.style as ViewStyle) ?? {};

  // Native components read the theme from context (as <Calendar> provides it).
  const withTheme = (containers: Parameters<typeof mergeTheme>[0]) => (
    <CalendarThemeProvider value={mergeTheme(containers)}>
      <MonthView {...baseProps} />
    </CalendarThemeProvider>
  );

  it("merges theme.containers.dayCell onto every day cell", () => {
    const { getByLabelText } = render(withTheme({ containers: { dayCell: { opacity: 0.42 } } }));
    expect(styleOf(getByLabelText(/15 June 2026/)).opacity).toBe(0.42);
  });
});

describe("MonthView disabled days", () => {
  it("marks days outside the min/max range as unavailable", () => {
    const { getByLabelText } = render(
      <MonthView {...baseProps} minDate={new Date(2026, 5, 10)} maxDate={new Date(2026, 5, 20)} />,
    );
    expect(getByLabelText(/, 9 June 2026, unavailable/)).toBeTruthy();
    expect(getByLabelText(/, 21 June 2026, unavailable/)).toBeTruthy();
    // Inside the window stays available.
    expect(() => getByLabelText(/, 15 June 2026, unavailable/)).toThrow();
  });

  it("honours an isDateDisabled predicate", () => {
    const onPressDay = jest.fn();
    const { getByLabelText } = render(
      <MonthView
        {...baseProps}
        isDateDisabled={(d) => d.getDate() === 12}
        onPressDay={onPressDay}
      />,
    );
    const disabled = getByLabelText(/, 12 June 2026, unavailable/);
    fireEvent.press(disabled);
    expect(onPressDay).not.toHaveBeenCalled();
  });

  it("does not select a disabled day even if passed in selectedDates", () => {
    const { getByLabelText } = render(
      <MonthView
        {...baseProps}
        selectedDates={[new Date(2026, 5, 12)]}
        isDateDisabled={(d) => d.getDate() === 12}
      />,
    );
    expect(() => getByLabelText(/, 12 June 2026, selected/)).toThrow();
  });

  it("uses eventAccessibilityLabel to override an event chip's label", () => {
    const events: CalendarEvent[] = [
      { title: "Standup", start: new Date(2026, 5, 15, 9, 0), end: new Date(2026, 5, 15, 9, 30) },
    ];
    const { getByLabelText } = render(
      <MonthView
        {...baseProps}
        events={events}
        eventAccessibilityLabel={(event) => `Custom: ${event.title}`}
      />,
    );
    expect(getByLabelText("Custom: Standup")).toBeTruthy();
  });
});

describe("MonthView slot styling", () => {
  const flatten = (node: { props: { style?: unknown } }) =>
    StyleSheet.flatten(node.props.style as ViewStyle) as Record<string, unknown>;

  it("passes a slot class through and drops that slot's themed styles", () => {
    const { getByText } = render(
      <MonthView {...baseProps} classNames={{ title: "text-xl font-bold text-indigo-900" }} />,
    );
    const title = getByText("June 2026");
    expect(title.props.className).toBe("text-xl font-bold text-indigo-900");
    const flat = flatten(title);
    // Themed typography is dropped so the class owns the look...
    expect(flat.fontSize).toBeUndefined();
    expect(flat.color).toBeUndefined();
    // ...but the structural layout padding is kept.
    expect(flat.paddingTop).toBe(10);
  });

  it("keeps the themed look and merges per-slot style overrides last", () => {
    const { getByText } = render(
      <MonthView {...baseProps} styles={{ title: { color: "rebeccapurple" } }} />,
    );
    const title = getByText("June 2026");
    expect(title.props.className).toBeUndefined();
    const flat = flatten(title);
    expect(flat.color).toBe("rebeccapurple");
    expect(flat.fontSize).toBe(defaultTheme.text.monthTitle.fontSize);
  });

  it("keeps a consumer calendarCellStyle even when the day slot has a class", () => {
    const { getByLabelText } = render(
      <MonthView
        {...baseProps}
        classNames={{ day: "bg-slate-50" }}
        calendarCellStyle={() => ({ backgroundColor: "papayawhip" })}
      />,
    );
    const cell = getByLabelText(/15 June 2026/);
    expect(flatten(cell).backgroundColor).toBe("papayawhip");
  });

  it("classes a state-styled slot: the badge drops its today colors for the class", () => {
    const { UNSAFE_getAllByProps } = render(
      <MonthView
        {...baseProps}
        classNames={{ dayBadge: "rounded-full bg-indigo-600" }}
        activeDate={new Date(2026, 5, 15)}
      />,
    );
    // Every day badge carries the class; none keeps the themed active-day fill,
    // because a classed slot drops its themed styles.
    const badges = UNSAFE_getAllByProps({ className: "rounded-full bg-indigo-600" });
    expect(badges.length).toBeGreaterThan(27);
    for (const badge of badges) expect(flatten(badge).backgroundColor).toBeUndefined();
  });
});

describe("MonthView hiddenDays", () => {
  it("drops hidden weekdays from the grid and header", () => {
    const { queryAllByText, queryByLabelText } = render(
      <MonthView {...baseProps} hiddenDays={[0, 6]} />,
    );
    expect(queryAllByText("Sun")).toHaveLength(0);
    expect(queryAllByText("Sat")).toHaveLength(0);
    // 14 June 2026 is a Sunday: its cell is gone entirely.
    expect(queryByLabelText(/14 June 2026/)).toBeNull();
  });
});

describe("MonthView built-in more popover", () => {
  const manyEvents: CalendarEvent[] = Array.from({ length: 6 }, (_, i) => ({
    title: `Event ${i + 1}`,
    start: new Date(2026, 5, 15, 9 + i),
    end: new Date(2026, 5, 15, 10 + i),
  }));

  it("opens a popover listing the day's events when onPressMore is absent", () => {
    const onPressEvent = jest.fn();
    const { getByText, getByRole } = render(
      <MonthView
        {...baseProps}
        events={manyEvents}
        maxVisibleEventCount={2}
        onPressEvent={onPressEvent}
      />,
    );
    fireEvent.press(getByText(/More/));
    expect(getByRole("header", { name: "Monday, 15 June 2026" })).toBeTruthy();
    fireEvent.press(getByText("Event 6"));
    expect(onPressEvent).toHaveBeenCalledWith(expect.objectContaining({ title: "Event 6" }));
  });

  it("defers to a consumer onPressMore instead", () => {
    const onPressMore = jest.fn();
    const { getByText, queryByRole } = render(
      <MonthView
        {...baseProps}
        events={manyEvents}
        maxVisibleEventCount={2}
        onPressMore={onPressMore}
      />,
    );
    fireEvent.press(getByText(/More/));
    expect(onPressMore).toHaveBeenCalledTimes(1);
    expect(queryByRole("header", { name: "Monday, 15 June 2026" })).toBeNull();
  });
});

describe("MonthView multi-day events", () => {
  it("draws a multi-day event as one spanning bar, not a chip per day", () => {
    const span: CalendarEvent[] = [
      // Mon 15 -> covers 15 and 16 (end exclusive at midnight of the 17th).
      { title: "Trip", start: new Date(2026, 5, 15), end: new Date(2026, 5, 17) },
    ];
    const { getAllByText } = render(<MonthView {...baseProps} events={span} />);
    // One bar spanning two days, not a chip repeated on each day.
    expect(getAllByText("Trip")).toHaveLength(1);
  });
});

describe("MonthView drag", () => {
  // June 2026 with weekStartsOn 0 lays out five rows starting Sun 31 May, so a
  // 700x500 grid puts each column at 100px and each row at 100px.
  const GRID = { width: 700, height: 500 };
  // A day cell reserves its date badge before the first event lane, so a press
  // above this offset lands on empty space and one below it lands on a chip.
  const LANE_Y = 31;

  type PanHandlers = Record<string, (gesture?: { x: number; y: number }) => void>;
  const latestPan = (): PanHandlers => {
    const { __gestures } = jest.requireMock("react-native-gesture-handler") as {
      __gestures: { handlers: PanHandlers }[];
    };
    return __gestures[__gestures.length - 1].handlers;
  };
  const measure = (getByTestId: (id: string) => unknown) =>
    fireEvent(getByTestId("month-grid") as never, "layout", { nativeEvent: { layout: GRID } });
  // Column/row of a June day in the grid above: Mon 15 June sits at row 2, col 1.
  const at = (col: number, row: number, offsetY: number) => ({
    x: col * 100 + 50,
    y: row * 100 + offsetY,
  });

  it("sweeps a day span into onSelectDrag live and onCreateEvent on release", () => {
    const onSelectDrag = jest.fn();
    const onCreateEvent = jest.fn();
    const { getByTestId } = render(
      <MonthView {...baseProps} onSelectDrag={onSelectDrag} onCreateEvent={onCreateEvent} />,
    );
    measure(getByTestId);
    const pan = latestPan();

    act(() => pan.onStart(at(1, 2, 10))); // Mon 15 June, above the first lane
    act(() => pan.onUpdate(at(3, 2, 10))); // Wed 17 June
    expect(onSelectDrag).toHaveBeenLastCalledWith(new Date(2026, 5, 15), new Date(2026, 5, 17));

    act(() => pan.onFinalize());
    expect(onCreateEvent).toHaveBeenCalledTimes(1);
    const [start, end] = onCreateEvent.mock.calls[0] as [Date, Date];
    expect(start).toEqual(new Date(2026, 5, 15));
    // End is exclusive: midnight after the last swept day.
    expect(end).toEqual(new Date(2026, 5, 18));
  });

  it("commits nothing when the hold never leaves its day", () => {
    const onCreateEvent = jest.fn();
    const { getByTestId } = render(<MonthView {...baseProps} onCreateEvent={onCreateEvent} />);
    measure(getByTestId);
    const pan = latestPan();

    act(() => pan.onStart(at(1, 2, 10)));
    act(() => pan.onUpdate(at(1, 2, 12)));
    act(() => pan.onFinalize());
    expect(onCreateEvent).not.toHaveBeenCalled();
  });

  it("keeps a sweep inside the selectable range", () => {
    const onSelectDrag = jest.fn();
    const { getByTestId } = render(
      <MonthView {...baseProps} maxDate={new Date(2026, 5, 16)} onSelectDrag={onSelectDrag} />,
    );
    measure(getByTestId);
    const pan = latestPan();

    act(() => pan.onStart(at(1, 2, 10))); // Mon 15 June
    act(() => pan.onUpdate(at(3, 2, 10))); // Wed 17 June, past maxDate
    expect(onSelectDrag).not.toHaveBeenCalled();
    act(() => pan.onUpdate(at(2, 2, 10))); // Tue 16 June, the last selectable day
    expect(onSelectDrag).toHaveBeenLastCalledWith(new Date(2026, 5, 15), new Date(2026, 5, 16));
  });

  it("carries an event chip onto another day and shifts it by whole days", () => {
    const event: CalendarEvent = {
      title: "Standup",
      start: new Date(2026, 5, 15, 9),
      end: new Date(2026, 5, 15, 10),
    };
    const onDragEvent = jest.fn();
    const { getByTestId } = render(
      <MonthView {...baseProps} events={[event]} onDragEvent={onDragEvent} />,
    );
    measure(getByTestId);
    const pan = latestPan();

    act(() => pan.onStart(at(1, 2, LANE_Y))); // on the chip, Mon 15 June
    act(() => pan.onUpdate(at(3, 2, LANE_Y))); // Wed 17 June
    act(() => pan.onFinalize());

    expect(onDragEvent).toHaveBeenCalledTimes(1);
    const [dragged, start, end] = onDragEvent.mock.calls[0] as [CalendarEvent, Date, Date];
    expect(dragged).toBe(event);
    // Two days later, same time of day.
    expect(start).toEqual(new Date(2026, 5, 17, 9));
    expect(end).toEqual(new Date(2026, 5, 17, 10));
  });

  it("sweeps instead of carrying when the hold lands below the chips", () => {
    const event: CalendarEvent = {
      title: "Standup",
      start: new Date(2026, 5, 15, 9),
      end: new Date(2026, 5, 15, 10),
    };
    const onDragEvent = jest.fn();
    const onCreateEvent = jest.fn();
    const { getByTestId } = render(
      <MonthView
        {...baseProps}
        events={[event]}
        onDragEvent={onDragEvent}
        onCreateEvent={onCreateEvent}
      />,
    );
    measure(getByTestId);
    const pan = latestPan();

    act(() => pan.onStart(at(1, 2, 10))); // above the first lane: empty day space
    act(() => pan.onUpdate(at(3, 2, 10)));
    act(() => pan.onFinalize());
    expect(onDragEvent).not.toHaveBeenCalled();
    expect(onCreateEvent).toHaveBeenCalledTimes(1);
  });

  it("does not carry an event the consumer locked", () => {
    const onDragEvent = jest.fn();
    const { getByTestId } = render(
      <MonthView
        {...baseProps}
        events={[
          {
            title: "Standup",
            start: new Date(2026, 5, 15, 9),
            end: new Date(2026, 5, 15, 10),
            draggable: false,
          },
        ]}
        onDragEvent={onDragEvent}
      />,
    );
    measure(getByTestId);
    const pan = latestPan();

    act(() => pan.onStart(at(1, 2, LANE_Y)));
    act(() => pan.onUpdate(at(3, 2, LANE_Y)));
    act(() => pan.onFinalize());
    expect(onDragEvent).not.toHaveBeenCalled();
  });

  it("swallows the tap that follows a committed drag", () => {
    const onPressDay = jest.fn();
    const onCreateEvent = jest.fn();
    const { getByTestId, getByLabelText } = render(
      <MonthView {...baseProps} onPressDay={onPressDay} onCreateEvent={onCreateEvent} />,
    );
    measure(getByTestId);
    const pan = latestPan();

    act(() => pan.onStart(at(1, 2, 10)));
    act(() => pan.onUpdate(at(3, 2, 10)));
    act(() => pan.onFinalize());

    fireEvent.press(getByLabelText(/17 June 2026/));
    expect(onPressDay).not.toHaveBeenCalled();
    // Only the drag's trailing tap is swallowed; the next one goes through.
    fireEvent.press(getByLabelText(/17 June 2026/));
    expect(onPressDay).toHaveBeenCalledTimes(1);
  });
});
