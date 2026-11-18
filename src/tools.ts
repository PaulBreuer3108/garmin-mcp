import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GarminApiError, type GarminClient } from "./garmin.js";

const MAX_RANGE_DAYS = 31;
/** Keep tool results small enough for the model's context. */
const MAX_OUTPUT_CHARS = 120_000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD")
  .describe("Kalendertag im Format YYYY-MM-DD (lokale Zeit des Garmin-Kontos)");

const range = {
  start_date: isoDate.describe("Erster Tag, YYYY-MM-DD (inklusive)"),
  end_date: isoDate.describe(`Letzter Tag, YYYY-MM-DD (inklusive), höchstens ${MAX_RANGE_DAYS} Tage nach start_date`),
};

export function checkRange(start: string, end: string): void {
  const s = Date.parse(start + "T00:00:00Z");
  const e = Date.parse(end + "T00:00:00Z");
  if (Number.isNaN(s) || Number.isNaN(e)) throw new Error("Ungültiges Datum");
  if (e < s) throw new Error("end_date liegt vor start_date");
  const days = (e - s) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) throw new Error(`Zeitraum zu lang (${days} Tage). Maximal ${MAX_RANGE_DAYS} Tage pro Abruf.`);
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export function formatResult(data: unknown): ToolResult {
  let text = typeof data === "string" ? data : JSON.stringify(data);
  if (text.length > MAX_OUTPUT_CHARS) {
    text = text.slice(0, MAX_OUTPUT_CHARS) + `\n…[gekürzt: ${text.length} Zeichen insgesamt. Kleineren Zeitraum wählen.]`;
  }
  return { content: [{ type: "text", text }] };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return formatResult(await fn());
  } catch (err) {
    const msg = err instanceof GarminApiError || err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Fehler: ${msg}` }], isError: true };
  }
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export function registerTools(server: McpServer, garmin: GarminClient): void {
  server.registerTool(
    "garmin_daily_summaries",
    {
      title: "Tageswerte",
      description:
        "Garmin-Tageszusammenfassungen pro Tag: Schritte, Kalorien, Ruhepuls, Intensitätsminuten, Stress, Body Battery u. a.",
      inputSchema: range,
      annotations: readOnly,
    },
    ({ start_date, end_date }) =>
      run(async () => {
        checkRange(start_date, end_date);
        return garmin.get("/usersummary-service/v2/dailysummaries", { startDate: start_date, endDate: end_date });
      }),
  );

  server.registerTool(
    "garmin_sleep",
    {
      title: "Schlaf (eine Nacht, detailliert)",
      description:
        "Detaillierte Schlafdaten einer Nacht: Schlafphasen, Schlafscore, Atmung, HRV und Herzfrequenz im Schlaf. date ist der Tag, an dem die Nacht endet.",
      inputSchema: { date: isoDate },
      annotations: readOnly,
    },
    ({ date }) => run(() => garmin.get("/sleep-service/sleep/dailySleep", { date })),
  );

  server.registerTool(
    "garmin_sleep_summaries",
    {
      title: "Schlaf (Zeitraum)",
      description: "Schlafzusammenfassungen pro Nacht über einen Zeitraum (Dauer, Phasen, Score).",
      inputSchema: range,
      annotations: readOnly,
    },
    ({ start_date, end_date }) =>
      run(async () => {
        checkRange(start_date, end_date);
        return garmin.get("/sleep-service/sleep/dailySleepSummariesByDate", { startDate: start_date, endDate: end_date });
      }),
  );

  server.registerTool(
    "garmin_hrv",
    {
      title: "HRV (eine Nacht)",
      description: "Herzfrequenzvariabilität einer Nacht mit Einzelwerten, Nachtmittel, 7-Tage-Mittel, Baseline und HRV-Status.",
      inputSchema: { date: isoDate },
      annotations: readOnly,
    },
    ({ date }) => run(() => garmin.get(`/hrv-service/hrv/${date}`)),
  );

  server.registerTool(
    "garmin_hrv_summaries",
    {
      title: "HRV (Zeitraum)",
      description: "HRV-Zusammenfassungen pro Tag über einen Zeitraum (Nachtmittel, Wochenmittel, Status).",
      inputSchema: range,
      annotations: readOnly,
    },
    ({ start_date, end_date }) =>
      run(async () => {
        checkRange(start_date, end_date);
        return garmin.get(`/hrv-service/hrv/daily/${start_date}/${end_date}`);
      }),
  );

  server.registerTool(
    "garmin_heart_rate",
    {
      title: "Herzfrequenz (ein Tag)",
      description: "Herzfrequenz eines Tages: Ruhepuls, Min/Max und Verlauf über den Tag.",
      inputSchema: { date: isoDate },
      annotations: readOnly,
    },
    ({ date }) => run(() => garmin.get("/wellness-service/wellness/dailyHeartRate", { date })),
  );

  server.registerTool(
    "garmin_body_battery",
    {
      title: "Body Battery",
      description: "Body Battery pro Tag über einen Zeitraum (Aufladung, Verbrauch, Verlauf).",
      inputSchema: range,
      annotations: readOnly,
    },
    ({ start_date, end_date }) =>
      run(async () => {
        checkRange(start_date, end_date);
        return garmin.get("/wellness-service/wellness/bodyBattery/reports/daily", { startDate: start_date, endDate: end_date });
      }),
  );

  server.registerTool(
    "garmin_stress",
    {
      title: "Stress",
      description: "Durchschnittlicher Stresswert pro Tag über einen Zeitraum.",
      inputSchema: range,
      annotations: readOnly,
    },
    ({ start_date, end_date }) =>
      run(async () => {
        checkRange(start_date, end_date);
        return garmin.get(`/usersummary-service/stats/stress/daily/${start_date}/${end_date}`);
      }),
  );

  server.registerTool(
    "garmin_spo2",
    {
      title: "Pulsoximetrie",
      description: "SpO2-Werte (Sauerstoffsättigung) eines Tages, sofern die Uhr sie misst.",
      inputSchema: { date: isoDate },
      annotations: readOnly,
    },
    ({ date }) => run(() => garmin.get(`/wellness-service/wellness/daily/spo2acclimation/${date}`)),
  );

  server.registerTool(
    "garmin_activities",
    {
      title: "Aktivitäten suchen",
      description:
        "Liste der Aktivitäten (Schwimmen, Rad, Lauf, Kraft …) mit Dauer, Distanz, Puls, Leistung, Training Effect. Neueste zuerst.",
      inputSchema: {
        start_date: isoDate.optional().describe("Optional: frühester Tag, YYYY-MM-DD"),
        end_date: isoDate.optional().describe("Optional: spätester Tag, YYYY-MM-DD"),
        activity_type: z
          .string()
          .optional()
          .describe("Optional: Garmin-Aktivitätstyp, z. B. running, cycling, lap_swimming, open_water_swimming, multi_sport"),
        start: z.number().int().min(0).default(0).describe("Offset für Paging"),
        limit: z.number().int().min(1).max(100).default(20).describe("Anzahl, 1 bis 100"),
      },
      annotations: readOnly,
    },
    ({ start_date, end_date, activity_type, start, limit }) =>
      run(() =>
        garmin.get("/activitylist-service/activities/search/activities", {
          start,
          limit,
          startDate: start_date,
          endDate: end_date,
          activityType: activity_type,
        }),
      ),
  );

  server.registerTool(
    "garmin_activity",
    {
      title: "Aktivität (Details)",
      description: "Details einer einzelnen Aktivität per activity_id (aus garmin_activities): Zusammenfassung, Zonen, Laps-Metadaten.",
      inputSchema: { activity_id: z.number().int().positive().describe("activityId aus garmin_activities") },
      annotations: readOnly,
    },
    ({ activity_id }) => run(() => garmin.get(`/activity-service/activity/${activity_id}`)),
  );

  server.registerTool(
    "garmin_activity_workouts",
    {
      title: "Workout einer Aktivität",
      description: "Das geplante Workout (Schritte, Ziele), das zu einer Aktivität gehört, falls vorhanden.",
      inputSchema: { activity_id: z.number().int().positive() },
      annotations: readOnly,
    },
    ({ activity_id }) => run(() => garmin.get(`/activity-service/activity/${activity_id}/workouts`)),
  );

  server.registerTool(
    "garmin_heart_rate_zones",
    {
      title: "Herzfrequenzzonen",
      description: "Die in Garmin Connect hinterlegten Herzfrequenzzonen je Sportart.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => run(() => garmin.get("/biometric-service/heartRateZones/v2")),
  );

  server.registerTool(
    "garmin_weight",
    {
      title: "Gewicht",
      description: "Gewichts- und Körperzusammensetzungsmessungen über einen Zeitraum.",
      inputSchema: range,
      annotations: readOnly,
    },
    ({ start_date, end_date }) =>
      run(async () => {
        checkRange(start_date, end_date);
        return garmin.get(`/weight-service/weight/range/${start_date}/${end_date}`, { includeAll: "true" });
      }),
  );
}
