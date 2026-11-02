import { describe, expect, test } from "vitest";
import {
  type ForkScheduleRow,
  planScheduleUpdate,
  readSchedulingConfig,
  toUpstreamScheduleDate,
} from "./utils";

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

const NY_CFG = { timeZone: NY, localHour: 0, localMinute: 0 };
const BERLIN_CFG = { timeZone: "Europe/Berlin", localHour: 0, localMinute: 0 };

describe("toUpstreamScheduleDate", () => {
  test("stores the survey-zone day as the deployment's scheduling time", () => {
    // 11/17 03:00 UTC is still 11/16 in New York; midnight NY on 11/16 is 05:00Z (EST)
    expect(toUpstreamScheduleDate(new Date("2026-11-17T03:00:00.000Z"), NY, NY_CFG).toISOString()).toBe(
      "2026-11-16T05:00:00.000Z"
    );
    // default Berlin midnight on 11/16 is 11/15 23:00Z
    expect(toUpstreamScheduleDate(new Date("2026-11-17T03:00:00.000Z"), NY, BERLIN_CFG).toISOString()).toBe(
      "2026-11-15T23:00:00.000Z"
    );
  });

  test("handles DST (EDT in summer)", () => {
    expect(toUpstreamScheduleDate(new Date("2026-07-20T20:00:00.000Z"), NY, NY_CFG).toISOString()).toBe(
      "2026-07-20T04:00:00.000Z"
    );
  });

  test("zones ahead of UTC can land on the next day", () => {
    expect(
      toUpstreamScheduleDate(new Date("2026-11-16T20:00:00.000Z"), "Asia/Tokyo", NY_CFG).toISOString()
    ).toBe("2026-11-17T05:00:00.000Z");
  });
});

describe("readSchedulingConfig", () => {
  test("uses app defaults and ignores invalid values", () => {
    expect(readSchedulingConfig({})).toEqual({ timeZone: "Europe/Berlin", localHour: 0, localMinute: 0 });
    expect(
      readSchedulingConfig({
        SURVEY_SCHEDULING_TIME_ZONE: NY,
        SURVEY_SCHEDULING_LOCAL_HOUR: "6",
        SURVEY_SCHEDULING_LOCAL_MINUTE: "30",
      })
    ).toEqual({ timeZone: NY, localHour: 6, localMinute: 30 });
    expect(
      readSchedulingConfig({ SURVEY_SCHEDULING_TIME_ZONE: "Bad/Zone", SURVEY_SCHEDULING_LOCAL_HOUR: "99" })
    ).toEqual({ timeZone: "Europe/Berlin", localHour: 0, localMinute: 0 });
  });
});

describe("planScheduleUpdate", () => {
  test("carries a future close date on an open survey", () => {
    const plan = planScheduleUpdate(
      row({ closeOnDate: new Date("2026-11-16T05:00:00.000Z"), scheduleTimezone: NY }),
      NOW,
      NY,
      NY_CFG
    );
    expect(plan).toMatchObject({ publishOn: null, pause: false });
    expect(plan?.closeOn?.toISOString()).toBe("2026-11-16T05:00:00.000Z");
  });

  test("turns a draft with a pending run date into paused + publishOn", () => {
    const plan = planScheduleUpdate(
      row({ status: "draft", runOnDate: new Date("2026-12-01T14:00:00.000Z") }),
      NOW,
      NY,
      NY_CFG
    );
    expect(plan?.pause).toBe(true);
    expect(plan?.publishOn?.toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });

  test("keeps a paused survey paused and still sets publishOn", () => {
    const plan = planScheduleUpdate(
      row({ status: "paused", runOnDate: new Date("2026-12-01T14:00:00.000Z") }),
      NOW,
      NY,
      NY_CFG
    );
    expect(plan).toMatchObject({ pause: false });
    expect(plan?.publishOn).not.toBeNull();
  });

  test("carries a future close date on a completed survey", () => {
    const plan = planScheduleUpdate(
      row({ status: "completed", closeOnDate: new Date("2026-12-01T20:00:00.000Z") }),
      NOW,
      NY,
      NY_CFG
    );
    expect(plan?.closeOn?.toISOString()).toBe("2026-12-01T05:00:00.000Z");
    expect(plan?.pause).toBe(false);
  });

  test("compares the converted value with now, not the fork instant", () => {
    // 11/02 20:00Z is later than NOW, but midnight NY on 11/02 (05:00Z) is already past
    expect(
      planScheduleUpdate(row({ closeOnDate: new Date("2026-11-02T20:00:00.000Z") }), NOW, NY, NY_CFG)
    ).toBeNull();
  });

  test("skips past dates and non-draft run dates", () => {
    expect(
      planScheduleUpdate(row({ closeOnDate: new Date("2026-07-19T00:00:00.000Z") }), NOW, NY, NY_CFG)
    ).toBeNull();
    expect(
      planScheduleUpdate(
        row({ status: "inProgress", runOnDate: new Date("2026-12-01T00:00:00.000Z") }),
        NOW,
        NY,
        NY_CFG
      )
    ).toBeNull();
  });

  test("never overwrites existing publishOn/closeOn", () => {
    const existing = new Date("2026-12-05T12:00:00.000Z");
    expect(
      planScheduleUpdate(
        row({ closeOnDate: new Date("2026-12-01T00:00:00.000Z"), closeOn: existing }),
        NOW,
        NY,
        NY_CFG
      )
    ).toBeNull();
  });

  test("falls back to the default zone when the stored zone is invalid", () => {
    const plan = planScheduleUpdate(
      row({ closeOnDate: new Date("2026-11-17T03:00:00.000Z"), scheduleTimezone: "Not/AZone" }),
      NOW,
      NY,
      NY_CFG
    );
    expect(plan?.timeZoneFallback).toBe(true);
    expect(plan?.closeOn?.toISOString()).toBe("2026-11-16T05:00:00.000Z");
  });
});
