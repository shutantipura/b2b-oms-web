// Customer ordering is allowed at any hour, including after midnight.
// The ONLY lead-time rule is that the requested delivery slot must begin
// at least two full hours after the order is submitted (Bangkok time).
export const DELIVERY_RULES = {
  timezone: "Asia/Bangkok",
  minLeadTimeMinutes: 120,
  daysToShow: 7,
  slots: [
    { value: "07:00–09:00", label: "07:00–09:00", startMinutes: 7 * 60 },
    { value: "09:00–11:00", label: "09:00–11:00", startMinutes: 9 * 60 },
    { value: "11:00–13:00", label: "11:00–13:00", startMinutes: 11 * 60 },
    { value: "13:00–15:00", label: "13:00–15:00", startMinutes: 13 * 60 },
    { value: "15:00–17:00", label: "15:00–17:00", startMinutes: 15 * 60 },
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

// Both numbers use the same Bangkok wall-clock basis (expressed as
// UTC-milliseconds for easy subtraction). This also works across midnight.
// Keep the current millisecond part so 1h 59m 59.999s is never rounded up.
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

  const earliestStartMs = bangkokWallClockMs(now) +
    DELIVERY_RULES.minLeadTimeMinutes * 60_000;

  return DELIVERY_RULES.slots.filter((slot) => {
    const slotStartMs = deliveryDayMs + slot.startMinutes * 60_000;
    return slotStartMs >= earliestStartMs;
  });
}

export function getEarliestDeliveryDate(now = new Date()): string {
  const today = bangkokToday(now);
  // If every today's slot has started or is fewer than two hours away,
  // the first selectable delivery date is tomorrow.
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
      message: "กรุณาเลือกช่วงเวลาจัดส่งที่เริ่มอย่างน้อย 2 ชั่วโมงหลังเวลาสั่งซื้อ",
    };
  }
  return { valid: true, message: "" };
}
