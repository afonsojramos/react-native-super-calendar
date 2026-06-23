import {
  isTimeVisibleAtHeight,
  MIN_BOX_HEIGHT_FOR_TIME,
  monthEventCapacity,
  monthVisibleCount,
  shouldShowEventTime,
  titleEllipsizeMode,
  titleNumberOfLines,
} from "../eventDisplay";

describe("titleEllipsizeMode", () => {
  it("clips by default", () => {
    expect(titleEllipsizeMode(false)).toBe("clip");
  });

  it("ellipsizes when opted in", () => {
    expect(titleEllipsizeMode(true)).toBe("tail");
  });
});

describe("titleNumberOfLines", () => {
  it("clamps month cells to one line", () => {
    expect(titleNumberOfLines("month", false)).toBe(1);
  });

  it("clamps all-day events to one line in any mode", () => {
    expect(titleNumberOfLines("week", true)).toBe(1);
    expect(titleNumberOfLines("day", true)).toBe(1);
  });

  it("lets timed-grid titles wrap (undefined)", () => {
    expect(titleNumberOfLines("day", false)).toBeUndefined();
    expect(titleNumberOfLines("3days", false)).toBeUndefined();
    expect(titleNumberOfLines("week", false)).toBeUndefined();
    expect(titleNumberOfLines("custom", false)).toBeUndefined();
  });
});

describe("shouldShowEventTime", () => {
  it("never shows the time in month cells", () => {
    expect(shouldShowEventTime("month", false, true)).toBe(false);
  });

  it("never shows the time for all-day events", () => {
    expect(shouldShowEventTime("week", true, true)).toBe(false);
  });

  it("honours showTime=false", () => {
    expect(shouldShowEventTime("week", false, false)).toBe(false);
  });

  it("shows the time for timed events when enabled", () => {
    expect(shouldShowEventTime("week", false, true)).toBe(true);
    expect(shouldShowEventTime("day", false, true)).toBe(true);
    expect(shouldShowEventTime("schedule", false, true)).toBe(true);
  });
});

describe("isTimeVisibleAtHeight", () => {
  it("always shows when there is no live box height (e.g. schedule)", () => {
    expect(isTimeVisibleAtHeight(undefined, "week")).toBe(true);
    expect(isTimeVisibleAtHeight(undefined, "schedule")).toBe(true);
  });

  it("always shows in the wide day column regardless of height", () => {
    expect(isTimeVisibleAtHeight(16, "day")).toBe(true);
    expect(isTimeVisibleAtHeight(MIN_BOX_HEIGHT_FOR_TIME - 1, "day")).toBe(true);
  });

  it("hides on narrow multi-column boxes shorter than the threshold", () => {
    expect(isTimeVisibleAtHeight(32, "week")).toBe(false);
    expect(isTimeVisibleAtHeight(MIN_BOX_HEIGHT_FOR_TIME - 1, "week")).toBe(false);
    expect(isTimeVisibleAtHeight(40, "3days")).toBe(false);
  });

  it("shows on narrow boxes at or above the threshold", () => {
    expect(isTimeVisibleAtHeight(MIN_BOX_HEIGHT_FOR_TIME, "week")).toBe(true);
    expect(isTimeVisibleAtHeight(100, "week")).toBe(true);
    expect(isTimeVisibleAtHeight(64, "3days")).toBe(true);
  });
});

describe("monthEventCapacity", () => {
  it("fits more chips when no overflow label is needed", () => {
    // 100px / 22px chip = 4 chips; reserving a 17px label leaves room for 3.
    expect(monthEventCapacity(100, 22, 17)).toEqual({ full: 4, withMore: 3 });
  });

  it("clamps to zero when nothing fits", () => {
    expect(monthEventCapacity(10, 22, 17)).toEqual({ full: 0, withMore: 0 });
  });

  it("guards against a non-positive chip height", () => {
    expect(monthEventCapacity(100, 0, 17)).toEqual({ full: 0, withMore: 0 });
  });
});

describe("monthVisibleCount", () => {
  const capacity = { full: 4, withMore: 3 };

  it("shows every event when they all fit", () => {
    expect(monthVisibleCount(3, capacity)).toBe(3);
    expect(monthVisibleCount(4, capacity)).toBe(4);
  });

  it("reserves the overflow label when events exceed the full count", () => {
    expect(monthVisibleCount(5, capacity)).toBe(3);
  });

  it("always shows at least one chip when overflowing a tiny cell", () => {
    expect(monthVisibleCount(5, { full: 0, withMore: 0 })).toBe(1);
  });
});
