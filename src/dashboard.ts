import type { GarminClient } from "./garmin.js";
import { PLAN, PLAN_START, RACE_DATE, RACE_NAME, type PlanWeek } from "./plan.js";

/**
 * Builds the data for the progress app: actual training per week (from Garmin) against the plan,
 * plus HRV and resting heart rate. Everything is fetched live from Garmin; nothing is stored.
 */

export type Sport = "swim" | "bike" | "run" | "strength" | "other";

const DAY_MS = 86_400_000;
/** How many weeks before the plan start (or before today) the trend charts show. */
const HISTORY_WEEKS = 12;
/** Garmin range endpoints accept at most about a month per call. */
const CHUNK_DAYS = 28;

export function sportOf(typeKey: string): Sport {
  const k = typeKey.toLowerCase();
  if (k.includes("swim")) return "swim";
  if (k.includes("cycl") || k.includes("bik") || k.includes("ride")) return "bike";
  if (k.includes("run") || k === "track_running") return "run";
  if (k.includes("strength") || k.includes("hiit") || k.includes("fitness_equipment")) return "strength";
  return "other";
}

/** Days since 1970-01-01 for a YYYY-MM-DD calendar date (time zone free). */
export function dayNumber(date: string): number {
  return Math.floor(Date.parse(date.slice(0, 10) + "T00:00:00Z") / DAY_MS);
}

export function isoDay(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Plan week of a calendar date: 1 = week from 23.11.2026, 0 = the week before, negative = earlier. */
export function planWeekOf(date: string): number {
  return Math.floor((dayNumber(date) - dayNumber(PLAN_START)) / 7) + 1;
}

/** Today's date in Paul's time zone (Garmin's local dates are German time). */
export function todayBerlin(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(now);
}

export interface Activity {
  id: number;
  date: string;
  time: string;
  name: string;
  sport: Sport;
  type: string;
  durationMin: number;
  distanceKm: number;
  avgHr: number | null;
  load: number | null;
}

type RawActivity = {
  activityId?: number;
  activityName?: string;
  startTimeLocal?: string;
  activityType?: { typeKey?: string };
  duration?: number;
  distance?: number;
  averageHR?: number;
  activityTrainingLoad?: number;
  isParent?: boolean;
  parent?: boolean;
};

export function normalizeActivity(a: RawActivity): Activity | null {
  if (!a.startTimeLocal || typeof a.duration !== "number") return null;
  // A multisport parent duplicates the time of its child activities, which are listed separately.
  if (a.isParent || a.parent) return null;
  const type = a.activityType?.typeKey ?? "other";
  return {
    id: a.activityId ?? 0,
    date: a.startTimeLocal.slice(0, 10),
    time: a.startTimeLocal.slice(11, 16),
    name: a.activityName ?? type,
    sport: sportOf(type),
    type,
    durationMin: Math.round(a.duration / 6) / 10,
    distanceKm: Math.round((a.distance ?? 0) / 10) / 100,
    avgHr: typeof a.averageHR === "number" ? Math.round(a.averageHR) : null,
    load: typeof a.activityTrainingLoad === "number" ? Math.round(a.activityTrainingLoad) : null,
  };
}

export interface DayHealth {
  date: string;
  hrv: number | null;
  hrvStatus: string | null;
  restingHr: number | null;
}

export interface WeekSummary {
  week: number;
  start: string;
  plan: PlanWeek | null;
  /** Minutes per sport */
  min: Record<Sport, number>;
  totalMin: number;
  runKm: number;
  bikeKm: number;
  swimM: number;
  sessions: number;
  hrvAvg: number | null;
  restingHrAvg: number | null;
}

export interface Dashboard {
  generatedAt: string;
  today: string;
  race: { name: string; date: string; daysLeft: number };
  currentWeek: number;
  planWeeks: number;
  /** The plan week shown on top: the current one, or week 1 before the start. */
  focusWeek: WeekSummary;
  weeks: WeekSummary[];
  days: DayHealth[];
  recent: Activity[];
  plan: PlanWeek[];
}

const avg = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

export function summarize(activities: Activity[], days: DayHealth[], today: string, now = new Date()): Dashboard {
  const current = planWeekOf(today);
  const firstWeek = Math.min(current, 1) - HISTORY_WEEKS + 1;
  const lastWeek = Math.max(current, 1);
  const weeks: WeekSummary[] = [];
  for (let w = firstWeek; w <= lastWeek; w++) {
    const start = isoDay(dayNumber(PLAN_START) + (w - 1) * 7);
    const acts = activities.filter((a) => planWeekOf(a.date) === w);
    const dh = days.filter((d) => planWeekOf(d.date) === w);
    const min: Record<Sport, number> = { swim: 0, bike: 0, run: 0, strength: 0, other: 0 };
    let runKm = 0, bikeKm = 0, swimM = 0;
    for (const a of acts) {
      min[a.sport] += a.durationMin;
      if (a.sport === "run") runKm += a.distanceKm;
      if (a.sport === "bike") bikeKm += a.distanceKm;
      if (a.sport === "swim") swimM += a.distanceKm * 1000;
    }
    for (const k of Object.keys(min) as Sport[]) min[k] = Math.round(min[k]);
    weeks.push({
      week: w,
      start,
      plan: PLAN.find((p) => p.week === w) ?? null,
      min,
      totalMin: Math.round(min.swim + min.bike + min.run + min.strength),
      runKm: Math.round(runKm * 10) / 10,
      bikeKm: Math.round(bikeKm * 10) / 10,
      swimM: Math.round(swimM),
      sessions: acts.filter((a) => a.sport !== "other").length,
      hrvAvg: avg(dh.map((d) => d.hrv)),
      restingHrAvg: avg(dh.map((d) => d.restingHr)),
    });
  }
  const focusNo = Math.min(Math.max(current, 1), PLAN.length);
  const focusWeek = weeks.find((w) => w.week === focusNo) ?? weeks[weeks.length - 1];
  return {
    generatedAt: now.toISOString(),
    today,
    race: { name: RACE_NAME, date: RACE_DATE, daysLeft: dayNumber(RACE_DATE) - dayNumber(today) },
    currentWeek: current,
    planWeeks: PLAN.length,
    focusWeek,
    weeks,
    days: days.filter((d) => dayNumber(d.date) >= dayNumber(today) - 7 * HISTORY_WEEKS),
    recent: [...activities].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 15),
    plan: PLAN,
  };
}

/** Splits [start, end] into chunks Garmin's range endpoints accept. */
export function chunks(start: string, end: string, size = CHUNK_DAYS): [string, string][] {
  const out: [string, string][] = [];
  for (let s = dayNumber(start); s <= dayNumber(end); s += size) {
    out.push([isoDay(s), isoDay(Math.min(s + size - 1, dayNumber(end)))]);
  }
  return out;
}

async function fetchActivities(garmin: GarminClient, since: string, until: string): Promise<Activity[]> {
  const out: Activity[] = [];
  const limit = 100;
  for (let start = 0; start < 2000; start += limit) {
    const page = (await garmin.get("/activitylist-service/activities/search/activities", {
      start,
      limit,
      startDate: since,
      endDate: until,
    })) as RawActivity[] | null;
    if (!Array.isArray(page) || page.length === 0) break;
    for (const raw of page) {
      const a = normalizeActivity(raw);
      if (a && a.date >= since && a.date <= until) out.push(a);
    }
    const oldest = page[page.length - 1]?.startTimeLocal ?? "";
    if (page.length < limit || (oldest && oldest.slice(0, 10) < since)) break;
  }
  return out;
}

async function fetchHealth(garmin: GarminClient, since: string, until: string): Promise<DayHealth[]> {
  const byDate = new Map<string, DayHealth>();
  const day = (date: string) => {
    let d = byDate.get(date);
    if (!d) byDate.set(date, (d = { date, hrv: null, hrvStatus: null, restingHr: null }));
    return d;
  };
  const tasks = chunks(since, until).flatMap(([s, e]) => [
    garmin.get(`/hrv-service/hrv/daily/${s}/${e}`).then((r) => {
      const list = (r as { hrvSummaries?: { calendarDate: string; lastNightAvg?: number; status?: string }[] })?.hrvSummaries ?? [];
      for (const h of list) {
        const d = day(h.calendarDate);
        d.hrv = h.lastNightAvg ?? null;
        d.hrvStatus = h.status ?? null;
      }
    }),
    garmin.get("/usersummary-service/v2/dailysummaries", { startDate: s, endDate: e }).then((r) => {
      const list = (r as { data?: { calendarDate: string; heartRate?: { restingValue?: number } }[] })?.data ?? [];
      for (const x of list) {
        const v = x.heartRate?.restingValue;
        if (typeof v === "number" && v > 0) day(x.calendarDate).restingHr = v;
      }
    }),
  ]);
  const results = await Promise.allSettled(tasks);
  // Health data is a bonus: only fail when every call failed.
  if (results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function buildDashboard(garmin: GarminClient, now = new Date()): Promise<Dashboard> {
  const today = todayBerlin(now);
  const current = planWeekOf(today);
  const firstWeek = Math.min(current, 1) - HISTORY_WEEKS + 1;
  const since = isoDay(dayNumber(PLAN_START) + (firstWeek - 1) * 7);
  const [activities, days] = await Promise.all([
    fetchActivities(garmin, since, today),
    fetchHealth(garmin, isoDay(dayNumber(today) - 7 * HISTORY_WEEKS), today),
  ]);
  return summarize(activities, days, today, now);
}
