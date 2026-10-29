export const REPORT_TASK_STAGES = [
  "confirmation",
  "picking",
  "billing",
  "delivery",
  "payment_verification",
] as const;

export type ReportTaskStage = (typeof REPORT_TASK_STAGES)[number];

export type CompletedTaskClaim = {
  id: string;
  staff_id: string;
  stage: string;
  claim_status: string;
  completed_at: string | null;
};

export type TaskCounts = {
  total: number;
  byStage: Record<ReportTaskStage, number>;
};

function emptyCounts(): TaskCounts {
  return {
    total: 0,
    byStage: {
      confirmation: 0,
      picking: 0,
      billing: 0,
      delivery: 0,
      payment_verification: 0,
    },
  };
}

export function bangkokCalendarDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
}

export function addCalendarDays(day: string, offset: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("รูปแบบวันที่ไม่ถูกต้อง");
  }
  const time = Date.parse(day + "T00:00:00.000Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw new Error("วันที่ไม่ถูกต้อง");
  }
  return new Date(time + offset * 86_400_000).toISOString().slice(0, 10);
}

/** Inclusive Thai calendar dates, converted to an exclusive UTC upper bound. */
export function completedTaskDateWindow(fromDay: string, toDay: string) {
  addCalendarDays(fromDay, 0);
  addCalendarDays(toDay, 0);
  if (fromDay > toDay) {
    throw new Error("วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด");
  }
  return {
    fromInclusive: new Date(fromDay + "T00:00:00+07:00").toISOString(),
    toExclusive: new Date(addCalendarDays(toDay, 1) + "T00:00:00+07:00").toISOString(),
  };
}

/** One completed claim is one finished task, including legitimately repeated work. */
export function summarizeCompletedTasks(rows: CompletedTaskClaim[]): {
  overall: TaskCounts;
  byStaff: Map<string, TaskCounts>;
} {
  const overall = emptyCounts();
  const byStaff = new Map<string, TaskCounts>();
  const stageSet: ReadonlySet<string> = new Set(REPORT_TASK_STAGES);

  for (const row of rows) {
    if (
      row.claim_status !== "completed" ||
      !row.completed_at ||
      !row.staff_id ||
      !stageSet.has(row.stage)
    ) {
      continue;
    }
    const stage = row.stage as ReportTaskStage;
    overall.total += 1;
    overall.byStage[stage] += 1;

    const staffCounts = byStaff.get(row.staff_id) ?? emptyCounts();
    staffCounts.total += 1;
    staffCounts.byStage[stage] += 1;
    byStaff.set(row.staff_id, staffCounts);
  }

  return { overall, byStaff };
}
