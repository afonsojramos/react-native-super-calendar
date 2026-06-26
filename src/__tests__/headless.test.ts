import {
  buildMonthGrid,
  buildMonthWeeks,
  daySelectionState,
  getIsToday,
  getWeekDays,
  isDateSelectable,
  isRangeEndpoint,
  isSameCalendarDay,
  isWeekend,
  isWithinDateRange,
  minutesIntoDay,
  nextDateRange,
  useDateRange,
  useMonthGrid,
} from "../headless";

// The headless entry must stay importable without React Native (this suite runs
// in the node test project), and expose the full pure grid + selection + date API.
describe("headless entry point", () => {
  it("exposes the render-agnostic API as callables", () => {
    for (const fn of [
      buildMonthGrid,
      buildMonthWeeks,
      daySelectionState,
      getIsToday,
      getWeekDays,
      isDateSelectable,
      isRangeEndpoint,
      isSameCalendarDay,
      isWeekend,
      isWithinDateRange,
      minutesIntoDay,
      nextDateRange,
      useDateRange,
      useMonthGrid,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("builds a month grid with range state, no renderer required", () => {
    const open = nextDateRange(null, new Date(2026, 6, 8));
    const range = nextDateRange(open, new Date(2026, 6, 16));
    const grid = buildMonthGrid(new Date(2026, 6, 1), {
      selectedRange: range ?? undefined,
      weekStartsOn: 1,
    });

    expect(grid.weekdays).toHaveLength(7);
    const ownDays = grid.weeks.flatMap((week) => week.days).filter((day) => day.isCurrentMonth);
    expect(ownDays).toHaveLength(31);

    const tenth = ownDays.find((day) => day.label === "10");
    expect(tenth?.isInRange).toBe(true);
    expect(ownDays.find((day) => day.label === "8")?.isRangeStart).toBe(true);
    expect(ownDays.find((day) => day.label === "16")?.isRangeEnd).toBe(true);
  });
});
