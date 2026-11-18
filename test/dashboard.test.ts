import { test } from "node:test";
import assert from "node:assert/strict";
import { sportOf, planWeekOf, chunks, normalizeActivity, summarize, todayBerlin } from "../src/dashboard.ts";
import { PLAN } from "../src/plan.ts";

test("sport mapping", () => {
  assert.equal(sportOf("lap_swimming"), "swim");
  assert.equal(sportOf("open_water_swimming"), "swim");
  assert.equal(sportOf("virtual_ride"), "bike");
  assert.equal(sportOf("indoor_cycling"), "bike");
  assert.equal(sportOf("road_biking"), "bike");
  assert.equal(sportOf("treadmill_running"), "run");
  assert.equal(sportOf("trail_running"), "run");
  assert.equal(sportOf("strength_training"), "strength");
  assert.equal(sportOf("walking"), "other");
});

test("plan weeks", () => {
  assert.equal(PLAN.length, 41);
  assert.equal(planWeekOf("2026-11-23"), 1);
  assert.equal(planWeekOf("2026-11-29"), 1);
  assert.equal(planWeekOf("2026-11-30"), 2);
  assert.equal(planWeekOf("2026-11-22"), 0);
  assert.equal(planWeekOf("2027-09-05"), 41);
  for (const p of PLAN) {
    assert.equal(planWeekOf(p.start), p.week);
    assert.ok(Math.abs(p.swimMin + p.bikeMin + p.runMin - p.hours * 60) <= 1, `week ${p.week} sums to its hours`);
  }
});

test("chunks cover the range", () => {
  assert.deepEqual(chunks("2026-01-01", "2026-02-10", 28), [["2026-01-01", "2026-01-28"], ["2026-01-29", "2026-02-10"]]);
});

test("time zone", () => {
  assert.equal(todayBerlin(new Date("2026-11-22T23:30:00Z")), "2026-11-23");
});

test("summary per week", () => {
  const raw = [
    { activityId: 1, activityName: "Lauf", startTimeLocal: "2026-11-24 18:00:00", activityType: { typeKey: "running" }, duration: 2400, distance: 6000, averageHR: 140 },
    { activityId: 2, activityName: "Kickr", startTimeLocal: "2026-11-25 19:00:00", activityType: { typeKey: "virtual_ride" }, duration: 3600, distance: 30000 },
    { activityId: 3, activityName: "Bahn", startTimeLocal: "2026-11-26 07:00:00", activityType: { typeKey: "lap_swimming" }, duration: 1800, distance: 1000 },
    { activityId: 4, activityName: "Tri", startTimeLocal: "2026-11-26 07:00:00", activityType: { typeKey: "multi_sport" }, duration: 9999, isParent: true },
    { activityId: 5, activityName: "Vorher", startTimeLocal: "2026-11-18 15:00:00", activityType: { typeKey: "running" }, duration: 600, distance: 1000 },
  ];
  const acts = raw.map(normalizeActivity).filter((a) => a !== null);
  assert.equal(acts.length, 4);
  const d = summarize(acts, [{ date: "2026-11-24", hrv: 80, hrvStatus: "BALANCED", restingHr: 45 }], "2026-11-27", new Date("2026-11-27T10:00:00Z"));
  assert.equal(d.currentWeek, 1);
  assert.equal(d.focusWeek.week, 1);
  assert.deepEqual(d.focusWeek.min, { swim: 30, bike: 60, run: 40, strength: 0, other: 0 });
  assert.equal(d.focusWeek.totalMin, 130);
  assert.equal(d.focusWeek.runKm, 6);
  assert.equal(d.focusWeek.swimM, 1000);
  assert.equal(d.focusWeek.hrvAvg, 80);
  assert.equal(d.weeks.find((w) => w.week === 0)?.runKm, 1);
  assert.equal(d.race.daysLeft, 282);
  assert.equal(d.recent[0].id, 3);
});

test("before the plan start the focus week is week 1", () => {
  const d = summarize([], [], "2026-11-18");
  assert.equal(d.currentWeek, 0);
  assert.equal(d.focusWeek.week, 1);
  assert.equal(d.weeks.length, 13);
});
