import { fireEvent, render } from "@testing-library/react";
import { MonthView } from "../MonthView";

describe("dom MonthView", () => {
  it("renders the month title and weekday headers", () => {
    const { getByText, getAllByText } = render(
      <MonthView date={new Date(2026, 6, 1)} weekStartsOn={1} />,
    );
    expect(getByText("July 2026")).toBeTruthy();
    expect(getAllByText("Mon").length).toBeGreaterThan(0);
  });

  it("fires onPressDay with the clicked date", () => {
    const onPressDay = jest.fn();
    const { getByLabelText } = render(
      <MonthView date={new Date(2026, 6, 1)} weekStartsOn={1} onPressDay={onPressDay} />,
    );
    fireEvent.click(getByLabelText("Wednesday, 15 July 2026"));
    expect(onPressDay).toHaveBeenCalledTimes(1);
    const clicked = onPressDay.mock.calls[0][0] as Date;
    expect(clicked.getDate()).toBe(15);
    expect(clicked.getMonth()).toBe(6);
  });

  it("disables days outside the min/max range", () => {
    const onPressDay = jest.fn();
    const { getByLabelText } = render(
      <MonthView
        date={new Date(2026, 6, 1)}
        weekStartsOn={1}
        minDate={new Date(2026, 6, 10)}
        onPressDay={onPressDay}
      />,
    );
    const early = getByLabelText("Wednesday, 8 July 2026") as HTMLButtonElement;
    expect(early.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(early);
    expect(onPressDay).not.toHaveBeenCalled();
  });

  it("keeps one tab stop and moves focus with the arrow keys (roving tabindex)", () => {
    const { container } = render(<MonthView date={new Date(2030, 0, 1)} weekStartsOn={1} />);
    const tabbable = () => container.querySelectorAll('[data-day][tabindex="0"]');
    // exactly one day is tabbable; the rest are removed from the tab order
    expect(tabbable()).toHaveLength(1);
    expect(container.querySelector('[data-day="2030-01-01"]')!.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(container.querySelector('[role="grid"]')!, { key: "ArrowRight" });
    expect(tabbable()).toHaveLength(1);
    expect(container.querySelector('[data-day="2030-01-02"]')!.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(container.querySelector('[role="grid"]')!, { key: "ArrowDown" });
    expect(container.querySelector('[data-day="2030-01-09"]')!.getAttribute("tabindex")).toBe("0");
  });
});
