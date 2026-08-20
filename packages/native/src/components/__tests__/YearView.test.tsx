import { act, fireEvent, render } from "@testing-library/react-native";
import type { CalendarEvent } from "../../types";
import { YearView } from "../YearView";

const events: CalendarEvent[] = [
  { title: "Standup", start: new Date(2026, 6, 15, 9), end: new Date(2026, 6, 15, 10) },
];

describe("YearView", () => {
  it("renders all twelve months of the anchor year", () => {
    const { getByLabelText } = render(<YearView date={new Date(2026, 6, 20)} weekStartsOn={1} />);
    expect(getByLabelText("January 2026")).toBeTruthy();
    expect(getByLabelText("December 2026")).toBeTruthy();
  });

  it("fires onPressDay with the tapped day", () => {
    const onPressDay = jest.fn();
    const { getByLabelText } = render(
      <YearView date={new Date(2026, 6, 20)} weekStartsOn={1} onPressDay={onPressDay} />,
    );
    fireEvent.press(getByLabelText(/Wednesday, 15 July 2026/));
    expect(onPressDay).toHaveBeenCalledTimes(1);
    expect(onPressDay.mock.calls[0][0].getDate()).toBe(15);
    expect(onPressDay.mock.calls[0][0].getMonth()).toBe(6);
  });

  it("marks days holding events and announces them", () => {
    const { getByLabelText } = render(
      <YearView date={new Date(2026, 6, 20)} weekStartsOn={1} events={events} />,
    );
    expect(getByLabelText(/15 July 2026.*has events/)).toBeTruthy();
  });

  it("fires onPressMonth from a month title", () => {
    const onPressMonth = jest.fn();
    const { getByLabelText } = render(
      <YearView date={new Date(2026, 6, 20)} weekStartsOn={1} onPressMonth={onPressMonth} />,
    );
    fireEvent.press(getByLabelText("March 2026"));
    expect(onPressMonth).toHaveBeenCalledTimes(1);
    expect(onPressMonth.mock.calls[0][0].getMonth()).toBe(2);
  });
});

describe("YearView selection", () => {
  it("announces selected days and marks the range interior", () => {
    const { getByLabelText } = render(
      <YearView
        date={new Date(2026, 6, 20)}
        weekStartsOn={1}
        selectedRange={{ start: new Date(2026, 6, 15), end: new Date(2026, 6, 17) }}
      />,
    );
    expect(getByLabelText(/15 July 2026, selected/)).toBeTruthy();
    expect(getByLabelText(/17 July 2026, selected/)).toBeTruthy();
    // An interior day is in the range but is not itself an endpoint.
    expect(getByLabelText(/Thursday, 16 July 2026$/)).toBeTruthy();
  });

  it("renders days outside minDate/maxDate as unavailable and ignores their taps", () => {
    const onPressDay = jest.fn();
    const { getByLabelText } = render(
      <YearView
        date={new Date(2026, 6, 20)}
        weekStartsOn={1}
        minDate={new Date(2026, 6, 10)}
        onPressDay={onPressDay}
      />,
    );
    fireEvent.press(getByLabelText(/9 July 2026, unavailable/));
    expect(onPressDay).not.toHaveBeenCalled();
  });
});

describe("YearView drag to select", () => {
  // July 2026 with weekStartsOn 1 lays out five rows from Mon 29 June, so a
  // 140x120 mini month puts each column at 20px and each row at 24px.
  const GRID = { width: 140, height: 120 };

  type PanHandlers = Record<string, (gesture?: { x: number; y: number }) => void>;
  // One pan is built per mini month, in month order, on every render — so the
  // current batch is the last twelve.
  const monthPan = (monthIndex: number): PanHandlers => {
    const { __gestures } = jest.requireMock("react-native-gesture-handler") as {
      __gestures: { handlers: PanHandlers }[];
    };
    return __gestures[__gestures.length - 12 + monthIndex].handlers;
  };

  it("reports the sweep live and commits an all-day range on release", () => {
    const onSelectDrag = jest.fn();
    const onCreateEvent = jest.fn();
    const { getByTestId } = render(
      <YearView
        date={new Date(2026, 6, 20)}
        weekStartsOn={1}
        onSelectDrag={onSelectDrag}
        onCreateEvent={onCreateEvent}
      />,
    );
    // The third row (index 2) runs Mon 13 July to Sun 19 July.
    fireEvent(getByTestId("year-month-grid-6"), "layout", { nativeEvent: { layout: GRID } });

    act(() => monthPan(6).onStart({ x: 50, y: 50 })); // row 2, col 2: Wed 15 July
    act(() => monthPan(6).onUpdate({ x: 90, y: 50 })); // row 2, col 4: Fri 17 July
    expect(onSelectDrag).toHaveBeenLastCalledWith(new Date(2026, 6, 15), new Date(2026, 6, 17));

    act(() => monthPan(6).onFinalize());
    expect(onCreateEvent).toHaveBeenCalledTimes(1);
    const [start, end] = onCreateEvent.mock.calls[0] as [Date, Date];
    expect(start).toEqual(new Date(2026, 6, 15));
    expect(end).toEqual(new Date(2026, 6, 18));
  });

  it("commits nothing when the hold never leaves its day", () => {
    const onCreateEvent = jest.fn();
    const { getByTestId } = render(
      <YearView date={new Date(2026, 6, 20)} weekStartsOn={1} onCreateEvent={onCreateEvent} />,
    );
    fireEvent(getByTestId("year-month-grid-6"), "layout", { nativeEvent: { layout: GRID } });

    act(() => monthPan(6).onStart({ x: 50, y: 50 }));
    act(() => monthPan(6).onFinalize());
    expect(onCreateEvent).not.toHaveBeenCalled();
  });
});
