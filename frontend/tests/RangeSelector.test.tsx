import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RangeSelector, visibleWindow } from "../src/components/RangeSelector";

function setup(props: Partial<React.ComponentProps<typeof RangeSelector>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <RangeSelector durationS={600} startS={60} endS={90} onChange={onChange} {...props} />,
  );
  return {
    onChange,
    start: () => screen.getByRole("slider", { name: "Start" }) as HTMLInputElement,
    end: () => screen.getByRole("slider", { name: "End" }) as HTMLInputElement,
    ...utils,
  };
}

describe("RangeSelector", () => {
  it("reports a moved start handle and keeps the end", () => {
    const { onChange, start } = setup();
    fireEvent.change(start(), { target: { value: "70" } });
    expect(onChange).toHaveBeenCalledWith({ startS: 70, endS: 90 });
  });

  it("moves the end handle when the end prop changes", () => {
    const { end, rerender, onChange } = setup();
    expect(end().value).toBe("90");
    rerender(<RangeSelector durationS={600} startS={60} endS={120} onChange={onChange} />);
    expect(end().value).toBe("120");
    expect(end()).toHaveAttribute("aria-valuetext", "00:02:00");
  });

  it("never lets the handles cross", () => {
    const { onChange, start, end } = setup();
    fireEvent.change(start(), { target: { value: "95" } });
    expect(onChange).toHaveBeenLastCalledWith({ startS: 89, endS: 90 });
    fireEvent.change(end(), { target: { value: "10" } });
    expect(onChange).toHaveBeenLastCalledWith({ startS: 60, endS: 61 });
  });

  it("steps 10 s with Shift+Arrow and 60 s with PageUp", async () => {
    const user = userEvent.setup();
    const { onChange, start, end } = setup();
    start().focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(onChange).toHaveBeenLastCalledWith({ startS: 70, endS: 90 });
    end().focus();
    await user.keyboard("{PageUp}");
    expect(onChange).toHaveBeenLastCalledWith({ startS: 60, endS: 150 });
  });

  it("zooms the visible window without changing the values", async () => {
    const user = userEvent.setup();
    const { onChange, start, end } = setup();
    expect(start()).toHaveAttribute("min", "0");
    expect(start()).toHaveAttribute("max", "600");

    await user.selectOptions(screen.getByRole("combobox", { name: "Zoom" }), "60");

    expect(Number(start().getAttribute("max")) - Number(start().getAttribute("min"))).toBe(60);
    expect(start().value).toBe("60");
    expect(end().value).toBe("90");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("visibleWindow", () => {
  it("covers the whole video when the size is 0 or larger than the video", () => {
    expect(visibleWindow(600, 60, 90, 0)).toEqual([0, 600]);
    expect(visibleWindow(600, 60, 90, 3600)).toEqual([0, 600]);
  });

  it("centres a window on the selection and keeps it inside the video", () => {
    expect(visibleWindow(36000, 18000, 18030, 300)).toEqual([17865, 18165]);
    expect(visibleWindow(600, 5, 10, 60)).toEqual([0, 60]);
    expect(visibleWindow(600, 590, 595, 60)).toEqual([540, 600]);
  });

  it("never shrinks below the selection span", () => {
    expect(visibleWindow(36000, 1000, 2000, 60)).toEqual([1000, 2000]);
  });
});
