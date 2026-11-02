import { describe, expect, test } from "vitest";
import { type ForkScheduleRow, planScheduleUpdate, toUpstreamScheduleDate } from "./utils";

const NOW = new Date("2026-11-02T15:00:00.000Z");
const NY = "America/New_York";

const row = (overrides: Partial<ForkScheduleRow>): ForkScheduleRow => ({
  id: "s1",
  status: "inProgress",
  runOnDate: null,
  closeOnDate: null,
  scheduleTimezone: null,
  publishOn: null,
  closeOn: null,
  ...overrides,
});

describe("toUpstreamScheduleDate", () => {
  test("takes the calendar day in the survey zone, as noon UTC", () => {
    // 11/17 03:00 UTC is still 11/16 in New York
    expect(toUpstreamScheduleDate(new Date("2026-11-17T03:00:00.000Z"), NY).toISOString()).toBe(
      "2026-11-16T12:00:00.000Z"
    );
    expect(toUpstreamScheduleDate(new Date("2026-11-17T03:00:00.000Z"), "UTC").toISOString()).toBe(
      "2026-11-17T12:00:00.000Z"
    );
  });

  test("zones ahead of UTC can land on the next day", () => {
    expect(toUpstreamScheduleDate(new Date("2026-11-16T20:00:00.000Z"), "Asia/Tokyo").toISOString()).toBe(
      "2026-11-17T12:00:00.000Z"
    );
  });
});

describe("planScheduleUpdate", () => {
  test("carries a future close date on an open survey", () => {
    const plan = planScheduleUpdate(
      row({ closeOnDate: new Date("2026-11-16T05:00:00.000Z"), scheduleTimezone: NY }),
      NOW,
      NY
    );
    expect(plan).toMatchObject({ publishOn: null, pause: false });
    expect(plan?.closeOn?.toISOString()).toBe("2026-11-16T12:00:00.000Z");
  });

  test("turns a draft with a pending run date into paused + publishOn", () => {
    const plan = planScheduleUpdate(
      row({ status: "draft", runOnDate: new Date("2026-12-01T14:00:00.000Z") }),
      NOW,
      NY
    );
    expect(plan?.pause).toBe(true);
    expect(plan?.publishOn?.toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });

  test("keeps a paused survey paused and still sets publishOn", () => {
    const plan = planScheduleUpdate(
      row({ status: "paused", runOnDate: new Date("2026-12-01T14:00:00.000Z") }),
      NOW,
      NY
    );
    expect(plan).toMatchObject({ pause: false });
    expect(plan?.publishOn).not.toBeNull();
  });

  test("skips past dates and completed surveys", () => {
    expect(
      planScheduleUpdate(row({ closeOnDate: new Date("2026-07-19T00:00:00.000Z") }), NOW, NY)
    ).toBeNull();
    expect(
      planScheduleUpdate(
        row({ status: "completed", closeOnDate: new Date("2026-12-01T00:00:00.000Z") }),
        NOW,
        NY
      )
    ).toBeNull();
    expect(
      planScheduleUpdate(
        row({ status: "inProgress", runOnDate: new Date("2026-12-01T00:00:00.000Z") }),
        NOW,
        NY
      )
    ).toBeNull();
  });

  test("never overwrites existing publishOn/closeOn", () => {
    const existing = new Date("2026-12-05T12:00:00.000Z");
    expect(
      planScheduleUpdate(
        row({ closeOnDate: new Date("2026-12-01T00:00:00.000Z"), closeOn: existing }),
        NOW,
        NY
      )
    ).toBeNull();
  });

  test("falls back to the default zone when the stored zone is invalid", () => {
    const plan = planScheduleUpdate(
      row({ closeOnDate: new Date("2026-11-17T03:00:00.000Z"), scheduleTimezone: "Not/AZone" }),
      NOW,
      NY
    );
    expect(plan?.timeZoneFallback).toBe(true);
    expect(plan?.closeOn?.toISOString()).toBe("2026-11-16T12:00:00.000Z");
  });
});
