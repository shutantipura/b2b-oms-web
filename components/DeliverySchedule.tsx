"use client";

import { useEffect, useState } from "react";

type DeliveryScheduleProps = {
  date: string | null;
  slot: string | null;
  delivered?: boolean;
};

type Urgency = "overdue" | "risk" | "today" | "none";

function bangkokNow(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (name: string) => parts.find((p) => p.type === name)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function dayNumber(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function relativeDate(date: string | null, nowDate: string) {
  if (!date) return { label: "ไม่ระบุวันจัดส่ง", days: null };
  const target = dayNumber(date);
  const current = dayNumber(nowDate);
  if (target === null || current === null) return { label: "ไม่ระบุวันจัดส่ง", days: null };
  const days = Math.round(target - current);
  if (days === 0) return { label: "วันนี้", days };
  if (days === 1) return { label: "พรุ่งนี้", days };
  if (days === -1) return { label: "เมื่อวาน", days };
  return { label: days < 0 ? `${-days} วันที่แล้ว` : `${days} วันข้างหน้า`, days };
}

function windowMinutes(slot: string | null) {
  if (!slot) return null;
  const times = [...slot.matchAll(/([01]?\d|2[0-3]):([0-5]\d)/g)]
    .map((parts) => Number(parts[1]) * 60 + Number(parts[2]));
  if (times.length < 2) return null;
  return { start: times[0], end: times[1] <= times[0] ? times[1] + 1440 : times[1] };
}

const badge: Record<Urgency, string> = {
  overdue: "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]",
  risk: "border-[#FED7AA] bg-[#FFF1E6] text-[#C2410C]",
  today: "border-[#FDE68A] bg-[#FEF9C3] text-[#854D0E]",
  none: "border-transparent bg-transparent text-[#5F7A72]",
};

export default function DeliverySchedule({ date, slot, delivered = false }: DeliveryScheduleProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const clock = bangkokNow(now);
  const { label, days } = relativeDate(date, clock.date);
  const slotWindow = windowMinutes(slot);
  let urgency: Urgency = "none";

  if (days !== null) {
    if (!delivered && days < 0) urgency = "overdue";
    else if (!delivered && days === 0 && slotWindow && clock.minutes >= slotWindow.end) urgency = "overdue";
    else if (!delivered && slotWindow && days <= 1 && days >= 0) {
      const untilStart = days * 1440 + slotWindow.start - clock.minutes;
      const untilEnd = days * 1440 + slotWindow.end - clock.minutes;
      if (untilStart <= 120 && untilEnd > 0) urgency = "risk";
      else if (days === 0) urgency = "today";
    } else if (days === 0) urgency = "today";
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <span className={`inline-flex min-h-8 items-center rounded-lg border px-2.5 py-1 text-sm font-bold ${badge[urgency]}`}>
        {label}
      </span>
      <span className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[#CDE4DE] bg-[#EDF7F4] px-2.5 py-1 text-sm font-extrabold text-[#17453F]">
        <svg aria-hidden="true" className="h-4 w-4 text-[#008F8D]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {slot || "ไม่ระบุช่วงเวลา"}
      </span>
      {urgency === "overdue" && <span className="text-xs font-bold text-[#B91C1C]">เกินกำหนด</span>}
      {urgency === "risk" && <span className="text-xs font-bold text-[#C2410C]">เสี่ยงล่าช้า</span>}
    </div>
  );
}
