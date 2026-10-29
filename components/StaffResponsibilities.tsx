"use client";

import { useEffect, useMemo, useState } from "react";
import {
  REPORT_TASK_STAGES,
  addCalendarDays,
  bangkokCalendarDate,
  completedTaskDateWindow,
  summarizeCompletedTasks,
  type CompletedTaskClaim,
  type ReportTaskStage,
} from "@/lib/staffTaskReport";
import { supabase } from "@/lib/supabase";

type StaffSummary = {
  id: string;
  staffCode: string;
  staffName: string;
  accountType: "staff" | "manager";
  isActive: boolean;
};

type Period = "today" | "7days" | "30days" | "custom";

const STAGE_LABELS: Record<ReportTaskStage, string> = {
  confirmation: "เช็คสต็อก",
  picking: "จัดสินค้า",
  billing: "ออกบิล",
  delivery: "จัดส่ง",
  payment_verification: "ตรวจสอบการชำระเงิน",
};

const PERIOD_OPTIONS: { value: Exclude<Period, "custom">; label: string; days: number }[] = [
  { value: "today", label: "วันนี้", days: 1 },
  { value: "7days", label: "7 วัน", days: 7 },
  { value: "30days", label: "30 วัน", days: 30 },
];

const PAGE_SIZE = 500;

function displayDate(day: string) {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(day + "T12:00:00+07:00"));
}

export default function StaffResponsibilities({ staff }: { staff: StaffSummary[] }) {
  const [fromDay, setFromDay] = useState(() => addCalendarDays(bangkokCalendarDate(), -6));
  const [toDay, setToDay] = useState(() => bangkokCalendarDate());
  const [period, setPeriod] = useState<Period>("7days");
  const [selectedStaffId, setSelectedStaffId] = useState("all");
  const [showWithoutTasks, setShowWithoutTasks] = useState(false);
  const [claims, setClaims] = useState<CompletedTaskClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setErrorMessage("");
      setClaims([]);

      try {
        const { fromInclusive, toExclusive } = completedTaskDateWindow(fromDay, toDay);
        const collected: CompletedTaskClaim[] = [];

        // PostgREST caps individual responses; fetch every page so totals
        // remain accurate even after the store has thousands of completed tasks.
        for (let page = 0; ; page += 1) {
          const { data, error } = await supabase
            .from("task_claims")
            .select("id, staff_id, stage, claim_status, completed_at")
            .eq("claim_status", "completed")
            .not("completed_at", "is", null)
            .gte("completed_at", fromInclusive)
            .lt("completed_at", toExclusive)
            .order("completed_at", { ascending: false })
            .order("id", { ascending: false })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

          if (cancelled) return;
          if (error) throw error;
          const pageRows = (data ?? []) as CompletedTaskClaim[];
          collected.push(...pageRows);
          if (pageRows.length < PAGE_SIZE) break;
        }

        if (!cancelled) setClaims(collected);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error ? error.message : "ไม่สามารถโหลดรายงานงานที่เสร็จแล้วได้"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadReport();
    return () => {
      cancelled = true;
    };
  }, [fromDay, toDay, reloadKey]);

  function selectPeriod(days: number, selected: Exclude<Period, "custom">) {
    const today = bangkokCalendarDate();
    setFromDay(addCalendarDays(today, 1 - days));
    setToDay(today);
    setPeriod(selected);
  }

  const selectedClaims = useMemo(
    () => selectedStaffId === "all"
      ? claims
      : claims.filter((claim) => claim.staff_id === selectedStaffId),
    [claims, selectedStaffId]
  );

  const { overall, byStaff } = useMemo(
    () => summarizeCompletedTasks(selectedClaims),
    [selectedClaims]
  );

  const people = useMemo(() => {
    const result = [...staff];
    const knownIds = new Set(staff.map((person) => person.id));

    for (const staffId of byStaff.keys()) {
      if (!knownIds.has(staffId)) {
        result.push({
          id: staffId,
          staffCode: "—",
          staffName: "พนักงานที่ไม่มีข้อมูลบัญชี",
          accountType: "staff",
          isActive: false,
        });
      }
    }

    return result
      .filter((person) => selectedStaffId === "all" || person.id === selectedStaffId)
      .filter((person) => showWithoutTasks || (byStaff.get(person.id)?.total ?? 0) > 0 || selectedStaffId !== "all")
      .sort((a, b) =>
        (byStaff.get(b.id)?.total ?? 0) - (byStaff.get(a.id)?.total ?? 0) ||
        a.staffCode.localeCompare(b.staffCode)
      );
  }, [staff, byStaff, selectedStaffId, showWithoutTasks]);

  const contributors = byStaff.size;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#CFE9E2] bg-white shadow-[0_4px_18px_rgba(16,84,76,0.05)]">
      <div className="border-b border-[#DCEDE8] bg-[#F5FCF9] px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wider text-[#008B85]">รายงานผลงานพนักงาน</p>
            <h2 className="mt-1 text-xl font-black text-[#17453F] sm:text-2xl">งานที่ทำเสร็จแล้ว</h2>
            <p className="mt-1 text-sm text-[#66877D]">
              จำนวนงานที่แต่ละคนทำสำเร็จ แยกตามประเภทและวันที่เสร็จงาน
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            disabled={loading}
            className="min-h-11 rounded-xl border border-[#A8DBD0] bg-white px-4 text-sm font-extrabold text-[#007E7C] disabled:opacity-50"
          >
            {loading ? "กำลังโหลด..." : "↻ รีเฟรช"}
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-[#D7EAE4] bg-white p-3 sm:p-4">
          <div className="flex flex-wrap gap-2" aria-label="ช่วงวันที่">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={period === option.value}
                onClick={() => selectPeriod(option.days, option.value)}
                className={
                  period === option.value
                    ? "min-h-10 rounded-xl bg-[#00AFAA] px-4 text-sm font-extrabold text-white"
                    : "min-h-10 rounded-xl border border-[#D3E8E0] bg-[#F6FBF9] px-4 text-sm font-bold text-[#47736A]"
                }
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="text-xs font-extrabold text-[#50756C]">ตั้งแต่วันที่</span>
              <input
                type="date"
                value={fromDay}
                max={toDay || undefined}
                onChange={(event) => {
                  setFromDay(event.target.value);
                  setPeriod("custom");
                }}
                className="mt-1 block min-h-11 w-full rounded-xl border border-[#C8E1D8] bg-white px-3 text-sm font-semibold text-[#17453F]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-extrabold text-[#50756C]">ถึงวันที่</span>
              <input
                type="date"
                value={toDay}
                min={fromDay || undefined}
                onChange={(event) => {
                  setToDay(event.target.value);
                  setPeriod("custom");
                }}
                className="mt-1 block min-h-11 w-full rounded-xl border border-[#C8E1D8] bg-white px-3 text-sm font-semibold text-[#17453F]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-extrabold text-[#50756C]">พนักงาน</span>
              <select
                value={selectedStaffId}
                onChange={(event) => setSelectedStaffId(event.target.value)}
                className="mt-1 block min-h-11 w-full rounded-xl border border-[#C8E1D8] bg-white px-3 text-sm font-semibold text-[#17453F]"
              >
                <option value="all">ทุกคน</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.staffCode + " · " + person.staffName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs text-[#77948A]">
            ใช้วันและเวลาประเทศไทย (UTC+7) โดยนับวันที่กดเสร็จงาน ไม่ใช่วันที่จัดส่ง
          </p>
        </div>
      </div>

      {errorMessage && (
        <p role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {errorMessage}
        </p>
      )}

      {loading ? (
        <p className="px-5 py-12 text-center text-sm font-semibold text-[#729087]">กำลังคำนวณผลงานพนักงาน...</p>
      ) : !errorMessage ? (
        <>
          <div className="px-4 pt-5 sm:px-6">
            <p className="text-xs font-bold text-[#66877D]">
              {fromDay && toDay
                ? displayDate(fromDay) + (fromDay === toDay ? "" : " – " + displayDate(toDay))
                : "กรุณาเลือกช่วงวันที่"}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[#95D9CE] bg-[#E5F8F4] p-4">
                <p className="text-xs font-bold text-[#39766D]">งานที่เสร็จทั้งหมด</p>
                <p className="mt-1 text-3xl font-black tabular-nums text-[#008B86]">{overall.total.toLocaleString("th-TH")}</p>
                <p className="mt-1 text-xs text-[#669188]">รายการงาน</p>
              </div>
              <div className="rounded-2xl border border-[#E4EBDC] bg-[#FCFFF3] p-4">
                <p className="text-xs font-bold text-[#5A7556]">ผู้ที่ทำงานสำเร็จ</p>
                <p className="mt-1 text-3xl font-black tabular-nums text-[#537945]">{contributors.toLocaleString("th-TH")}</p>
                <p className="mt-1 text-xs text-[#839A79]">คน</p>
              </div>
              <div className="col-span-2 rounded-2xl border border-[#F4E3A4] bg-[#FFF9E7] p-4 sm:col-span-1">
                <p className="text-xs font-bold text-[#927026]">ประเภทของงาน</p>
                <p className="mt-1 text-3xl font-black tabular-nums text-[#A27820]">
                  {REPORT_TASK_STAGES.filter((stage) => overall.byStage[stage] > 0).length}
                </p>
                <p className="mt-1 text-xs text-[#A59365]">จาก 5 ประเภท</p>
              </div>
            </div>

            <h3 className="mt-6 text-base font-black text-[#17453F]">สรุปตามประเภทงาน</h3>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              {REPORT_TASK_STAGES.map((stage) => (
                <div key={stage} className="rounded-xl border border-[#DCECE6] bg-[#FAFDFC] p-3">
                  <p className="min-h-9 text-xs font-bold leading-5 text-[#65847A]">{STAGE_LABELS[stage]}</p>
                  <p className="mt-1 text-2xl font-black tabular-nums text-[#167D77]">
                    {overall.byStage[stage].toLocaleString("th-TH")}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="px-4 pb-5 pt-7 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-[#17453F]">ผลงานรายพนักงาน</h3>
                <p className="mt-1 text-xs text-[#7A958D]">เรียงจากจำนวนงานที่ทำสำเร็จมากที่สุด</p>
              </div>
              <label className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-[#52786F]">
                <input
                  type="checkbox"
                  checked={showWithoutTasks}
                  onChange={(event) => setShowWithoutTasks(event.target.checked)}
                  className="h-4 w-4 accent-[#00AFAA]"
                />
                แสดงคนที่ไม่มีงานด้วย
              </label>
            </div>

            {people.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-[#CCE5DD] bg-[#F8FCFA] px-4 py-10 text-center">
                <p className="font-bold text-[#52786F]">ไม่พบงานที่เสร็จในช่วงวันที่เลือก</p>
                <p className="mt-1 text-sm text-[#7D9B90]">ลองเลือกช่วงวันที่อื่น หรือเปิดแสดงคนที่ไม่มีงาน</p>
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-3 md:hidden">
                  {people.map((person) => {
                    const counts = byStaff.get(person.id);
                    return (
                      <article key={person.id} className="rounded-2xl border border-[#D7E9E3] bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="font-black text-[#17453F]">{person.staffName}</h4>
                            <p className="mt-0.5 text-xs text-[#82998F]">
                              {person.staffCode}
                              {person.isActive ? "" : " · ปิดใช้งาน"}
                            </p>
                          </div>
                          <div className="rounded-xl bg-[#E3F8F3] px-3 py-2 text-right">
                            <p className="text-xl font-black tabular-nums text-[#008C85]">{counts?.total ?? 0}</p>
                            <p className="text-[10px] font-bold text-[#579187]">งาน</p>
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          {REPORT_TASK_STAGES.map((stage) => (
                            <div key={stage} className="flex items-center justify-between gap-2 rounded-lg bg-[#F4FAF7] px-2.5 py-2">
                              <span className="text-xs font-semibold text-[#668178]">{STAGE_LABELS[stage]}</span>
                              <span className="text-sm font-black tabular-nums text-[#187E78]">{counts?.byStage[stage] ?? 0}</span>
                            </div>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-[#D7E9E3] md:block">
                  <table className="w-full min-w-[850px] text-left">
                    <thead className="bg-[#E7F7F2] text-xs font-extrabold text-[#52786F]">
                      <tr>
                        <th className="px-4 py-3">พนักงาน</th>
                        {REPORT_TASK_STAGES.map((stage) => (
                          <th key={stage} className="px-3 py-3 text-center">{STAGE_LABELS[stage]}</th>
                        ))}
                        <th className="bg-[#D8F2EB] px-4 py-3 text-right">รวม</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E7EFEB]">
                      {people.map((person) => {
                        const counts = byStaff.get(person.id);
                        return (
                          <tr key={person.id} className="hover:bg-[#F8FCFA]">
                            <td className="px-4 py-3">
                              <p className="text-sm font-extrabold text-[#17453F]">{person.staffName}</p>
                              <p className="text-xs text-[#8A9E95]">
                                {person.staffCode}{person.isActive ? "" : " · ปิดใช้งาน"}
                              </p>
                            </td>
                            {REPORT_TASK_STAGES.map((stage) => (
                              <td key={stage} className="px-3 py-3 text-center text-sm font-bold tabular-nums text-[#55786E]">
                                {counts?.byStage[stage] ?? 0}
                              </td>
                            ))}
                            <td className="bg-[#F1FAF6] px-4 py-3 text-right text-base font-black tabular-nums text-[#008B85]">
                              {counts?.total ?? 0}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <p className="mt-4 text-xs leading-5 text-[#81968D]">
              นับเฉพาะงานที่สถานะเป็นเสร็จสมบูรณ์ (Completed) เท่านั้น งานที่ปล่อยคืนคิวหรือยังทำไม่เสร็จไม่นับ รวมถึงงานซ้ำที่ทำเสร็จหลายรอบจะนับตามจำนวนครั้งที่เสร็จจริง
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}
