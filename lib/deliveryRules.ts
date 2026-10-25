// Customer ordering is available 24 hours a day.
// A slot is selectable until its start time (Bangkok time); once started,
// offer the next scheduled two-hour delivery window, or tomorrow's first slot.
export const DELIVERY_RULES = {
  timezone: "Asia/Bangkok",
  daysToShow: 7,
  slots: [
    { value: "07:00–09:00", label: "07:00–09:00", startMinutes: 7 * 60 },
    { value: "09:00–11:00", label: "09:00–11:00", startMinutes: 9 * 60 },
    { value: "11:00–13:00", label: "11:00–13:00", startMinutes: 11 * 60 },
    { value: "13:00–15:00", label: "13:00–15:00", startMinutes: 13 * 60 },
    { value: "15:00–17:00", label: "15:00–17:00", startMinutes: 15 * 60 },
    { value: "17:00–19:00", label: "17:00–19:00", startMinutes: 17 * 60 },
    { value: "19:00–21:00", label: "19:00–21:00", startMinutes: 19 * 60 },
  ],
};

function bangkokDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DELIVERY_RULES.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (part: string) => Number(parts.find((item) => item.type === part)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function bangkokToday(now = new Date()): string {
  const { year, month, day } = bangkokDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Compare slot starts and current time in the same Bangkok wall-clock basis.
// Keep milliseconds so a slot that has just started is no longer offered.
function bangkokWallClockMs(now: Date): number {
  const { year, month, day, hour, minute, second } = bangkokDateParts(now);
  return Date.UTC(year, month - 1, day, hour, minute, second, now.getMilliseconds());
}

function dateStartWallClockMs(deliveryDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) return null;
  const [year, month, day] = deliveryDate.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  // Reject invalid dates like 2026-02-31.
  return new Date(timestamp).toISOString().slice(0, 10) === deliveryDate ? timestamp : null;
}

function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day + days);
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function getAvailableSlots(deliveryDate: string, now = new Date()) {
  const deliveryDayMs = dateStartWallClockMs(deliveryDate);
  if (deliveryDayMs === null) return [];

  const submittedAtMs = bangkokWallClockMs(now);

  return DELIVERY_RULES.slots.filter((slot) => {
    const slotStartMs = deliveryDayMs + slot.startMinutes * 60_000;
    return slotStartMs >= submittedAtMs;
  });
}

export function getEarliestDeliveryDate(now = new Date()): string {
  const today = bangkokToday(now);
  // Once the final window's start time (19:00) has passed, tomorrow is first.
  return getAvailableSlots(today, now).length > 0 ? today : addDays(today, 1);
}

export function getDeliveryOptions(now = new Date()) {
  const firstDate = getEarliestDeliveryDate(now);
  return Array.from({ length: DELIVERY_RULES.daysToShow }, (_, index) => {
    const date = addDays(firstDate, index);
    return {
      date,
      slots: getAvailableSlots(date, now).map((slot) => ({
        value: slot.value,
        label: slot.label,
      })),
    };
  });
}

export function validateDeliverySelection(
  deliveryDate: string,
  deliverySlot: string,
  now = new Date()
) {
  const options = getDeliveryOptions(now);
  const option = options.find((entry) => entry.date === deliveryDate);
  if (!option) {
    return {
      valid: false,
      message: "วันที่จัดส่งนี้ไม่สามารถเลือกได้ในขณะนี้ กรุณาเลือกวันใหม่",
    };
  }
  if (!option.slots.some((slot) => slot.value === deliverySlot)) {
    return {
      valid: false,
      message: "รอบจัดส่งที่เลือกเริ่มไปแล้ว กรุณาเลือกรอบถัดไป",
    };
  }
  return { valid: true, message: "" };
}

/**
 * Manager rescheduling keeps a two-hour preparation lead from submission.
 * A window remains selectable while there is some time left after that lead:
 * at 10:04, 11:00–13:00 is available with delivery no earlier than 12:04.
 * Customer ordering continues to use the separate start-of-window rule.
 */
export function getManagerDeliveryOptions(now = new Date()) {
  const cutoffMs = bangkokWallClockMs(now) + 2 * 60 * 60_000;
  const today = bangkokToday(now);
  const eligibleSlots = (date: string) => {
    const dayMs = dateStartWallClockMs(date);
    if (dayMs === null) return [];
    return DELIVERY_RULES.slots
      .filter((slot) => dayMs + (slot.startMinutes + 120) * 60_000 > cutoffMs)
      .map((slot) => ({ value: slot.value, label: slot.label }));
  };
  const firstDate = eligibleSlots(today).length > 0 ? today : addDays(today, 1);
  return Array.from({ length: DELIVERY_RULES.daysToShow }, (_, index) => {
    const date = addDays(firstDate, index);
    return { date, slots: eligibleSlots(date) };
  });
}

/**
 * One delivery-window colour policy for Orders and Tasks.
 * All uncompleted, non-cancelled orders use their requested slot regardless of
 * operational stage. The clock is measured in Bangkok local wall-clock time.
 *
 * - Red: delivery date is past, or today's window has ended.
 * - Orange: today's window is currently in progress.
 * - Yellow: delivery is today but its window has not started.
 * - None: tomorrow or later, or a completed/cancelled order.
 *
 * Keep the "at-risk" key for existing UI palette compatibility; the label now
 * means "inside the delivery window", not "within two hours beforehand".
 */
export type DeliveryUrgency = "overdue" | "at-risk" | "today" | "none";

export function getOrderDeliveryUrgency(
  order: { status: string; delivery_date: string | null; delivery_slot: string | null },
  now: { date: string; minutes: number }
): DeliveryUrgency {
  if (order.status === "completed" || order.status === "cancelled") return "none";

  const deliveryDate = order.delivery_date;
  if (!deliveryDate || !/^\\d{4}-\\d{2}-\\d{2}$/.test(deliveryDate)) return "none";
  if (deliveryDate < now.date) return "overdue";
  if (deliveryDate > now.date) return "none";

  const times = [...(order.delivery_slot ?? "").matchAll(/([01]?\\d|2[0-3]):([0-5]\\d)/g)]
    .map((match) => Number(match[1]) * 60 + Number(match[2]));
  // If an older order has no parseable window, it remains yellow until midnight.
  if (times.length < 2) return "today";

  const start = times[0];
  const end = times[1] <= start ? times[1] + 24 * 60 : times[1];

  if (now.minutes >= end) return "overdue";
  if (now.minutes >= start) return "at-risk";
  return "today";
}
