import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});

// i18n key → English value map for keys used in the schedule window UI.
// All other keys fall back to the last dotted segment with underscores→spaces.
const I18N_STRINGS: Record<string, string> = {
  "environments.surveys.edit.schedule_survey_window_title": "Schedule survey window",
  "environments.surveys.edit.schedule_survey_window_description":
    "Automatically open and/or close this survey at a specific date and time.",
  "environments.surveys.edit.schedule_timezone_label": "Timezone",
  "environments.surveys.edit.schedule_open_label": "Open survey on",
  "environments.surveys.edit.schedule_close_label": "Close survey on",
  "environments.surveys.edit.schedule_close_must_be_after_open": "Close time must be after open time",
  "environments.surveys.edit.schedule_time_in_past":
    "This time is in the past — the schedule will fire on the next cron tick (within 5 minutes)",
  "environments.surveys.edit.schedule_preview_open": "Opens {{date}}",
  "environments.surveys.edit.schedule_preview_close": "Closes {{date}}",
};

// Mock react-i18next so useTranslation returns a passthrough t function
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let str = I18N_STRINGS[key] ?? (key.split(".").pop()?.replace(/_/g, " ") ?? key);
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          str = str.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
        }
      }
      return str;
    },
    i18n: { changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// Mock @formkit/auto-animate — it calls window.matchMedia which doesn't exist in jsdom
vi.mock("@formkit/auto-animate/react", () => ({
  useAutoAnimate: () => [null],
}));

import { ResponseOptionsCard } from "./response-options-card";

const baseSurvey = {
  id: "svr_1",
  environmentId: "env_1",
  status: "draft" as const,
  type: "link" as const,
  autoComplete: null,
  runOnDate: null,
  closeOnDate: null,
  scheduleTimezone: null,
  // Many other TSurvey fields are required for the component to render. Use a
  // minimal cast — the test only exercises schedule UI behavior.
} as any;

const makeProps = (overrides: any = {}) => ({
  localSurvey: { ...baseSurvey, ...overrides },
  setLocalSurvey: vi.fn(),
  responseCount: 0,
  isSpamProtectionAllowed: false,
}) as any;

describe("ResponseOptionsCard — schedule window", () => {
  test("toggling parent off clears all three schedule fields", () => {
    const setLocalSurvey = vi.fn();
    render(<ResponseOptionsCard {...makeProps({
      runOnDate: new Date(Date.now() + 86_400_000),
      closeOnDate: new Date(Date.now() + 172_800_000),
      scheduleTimezone: "America/New_York",
    })} setLocalSurvey={setLocalSurvey} />);

    // Toggle the parent off via the AdvancedOptionToggle switch.
    // AdvancedOptionToggle exposes the toggle via a switch role or a label connected to scheduleSurveyWindow.
    const toggle = screen.getByLabelText(/schedule survey window/i);
    fireEvent.click(toggle);
    expect(setLocalSurvey).toHaveBeenCalledWith(expect.objectContaining({
      runOnDate: null, closeOnDate: null, scheduleTimezone: null,
    }));
  });

  test("close <= open shows red error", () => {
    render(<ResponseOptionsCard {...makeProps({
      runOnDate: new Date("2026-06-08T12:00:00Z"),
      closeOnDate: new Date("2026-06-01T12:00:00Z"),
      scheduleTimezone: "America/New_York",
    })} />);
    expect(screen.getByText(/close time must be after open time/i)).toBeInTheDocument();
  });

  test("past time shows yellow warning, not error", () => {
    render(<ResponseOptionsCard {...makeProps({
      runOnDate: new Date(Date.now() - 60_000),
      closeOnDate: null,
      scheduleTimezone: "America/New_York",
    })} />);
    expect(screen.getByText(/will fire on the next cron tick/i)).toBeInTheDocument();
    expect(screen.queryByText(/close time must be after/i)).not.toBeInTheDocument();
  });

  test("DST conversion: 2026-06-01 09:00 America/New_York persists as 13:00 UTC", () => {
    const setLocalSurvey = vi.fn();
    // Use a controlled wrapper that re-renders with the latest call's localSurvey
    let current: any = { ...baseSurvey };
    const wrappedSet = vi.fn((next: any) => {
      current = typeof next === "function" ? next(current) : next;
      setLocalSurvey(next);
      rerender(<ResponseOptionsCard {...makeProps(current)} setLocalSurvey={wrappedSet} />);
    });
    const { rerender } = render(<ResponseOptionsCard {...makeProps(current)} setLocalSurvey={wrappedSet} />);

    fireEvent.click(screen.getByLabelText(/schedule survey window/i)); // toggle on (sets browserTz)
    fireEvent.change(screen.getByLabelText(/timezone/i), { target: { value: "America/New_York" } });
    fireEvent.click(screen.getByLabelText(/open survey on/i)); // enables open row, populates new Date()
    // Use getAllByTestId in case Radix Collapsible keeps hidden copies in DOM
    fireEvent.change(screen.getAllByTestId("schedule-open-date")[0], { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getAllByTestId("schedule-open-time")[0], { target: { value: "09:00" } });

    // Find the call that has runOnDate as 2026-06-01T13:00:00Z
    const matched = setLocalSurvey.mock.calls.find((args) => {
      const v = args[0]?.runOnDate;
      return v instanceof Date && v.toISOString() === "2026-06-01T13:00:00.000Z";
    });
    expect(matched).toBeTruthy();
  });
});
