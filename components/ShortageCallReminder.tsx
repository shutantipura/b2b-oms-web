"use client";

type Props = {
  stage: "stock" | "picking";
  customerName: string;
  phone: string | null | undefined;
  stockItems: string[];
  pickItems?: string[];
  busy?: boolean;
  onCancel: () => void;
  onContinue: () => void;
  onSkip: () => void;
};

export default function ShortageCallReminder({
  stage, customerName, phone, stockItems, pickItems = [], busy = false,
  onCancel, onContinue, onSkip,
}: Props) {
  const phoneNumber = phone?.trim() || "";
  const hasPhone = Boolean(phoneNumber);
  const unique = (names: string[]) => Array.from(new Set(names));
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-[#062B27]/60 px-3 pb-3 pt-10 sm:items-center"
      role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="shortage-call-title"
        aria-describedby="shortage-call-description"
        className="w-full max-w-md overflow-y-auto rounded-3xl border border-[#D9E8E3] bg-white p-5 shadow-2xl sm:p-6"
        style={{ maxHeight: "calc(100dvh - 28px)" }}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFF1DB] text-2xl" aria-hidden="true">📞</span>
            <div>
              <p className="text-[11px] font-extrabold text-[#A65D00]">แจ้งเตือนสินค้าขาด</p>
              <h2 id="shortage-call-title" className="text-lg font-extrabold text-[#17453F]">โทรแจ้งลูกค้าก่อนปิดงาน</h2>
            </div>
          </div>
          <button type="button" aria-label="กลับไปตรวจสอบรายการ" disabled={busy} onClick={onCancel}
            className="rounded-xl border border-[#DFE9E5] px-3 py-2 text-[#4C6B60]">✕</button>
        </div>
        <p id="shortage-call-description" className="text-sm leading-6 text-[#58766B]">
          {stage === "stock"
            ? "จำนวนที่เช็คสต็อกไม่ครบตามที่ลูกค้าสั่ง แนะนำให้โทรแจ้งก่อนส่งงานไปจัดสินค้า"
            : "พบสินค้าขาดจากการเช็คสต็อกหรือหยิบจริง แนะนำให้โทรแจ้งก่อนส่งงานไปออกบิล"}
          {" "}สามารถข้ามได้หากแจ้งลูกค้าแล้วหรือไม่สะดวกโทร
        </p>
        <div className="mt-3 rounded-2xl border border-[#D6ECE6] bg-[#F3FBF8] p-3">
          <p className="truncate text-sm font-extrabold text-[#17453F]">{customerName}</p>
          {hasPhone ? (
            <a href={`tel:${phoneNumber.replace(/[^+\d]/g, "")}`}
              className="mt-2 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#02B0AF] px-4 py-3 text-base font-extrabold text-white">
              ☎ โทร {phoneNumber}
            </a>
          ) : (
            <p className="mt-2 rounded-xl bg-[#FFF2E1] px-3 py-2 text-sm font-semibold text-[#955C13]">
              ไม่มีเบอร์โทรศัพท์ลูกค้าในระบบ — สามารถข้ามได้
            </p>
          )}
        </div>
        <div className="mt-3 max-h-36 space-y-2 overflow-y-auto text-xs">
          {stockItems.length > 0 && (
            <div className="rounded-xl border border-[#F6E2C7] bg-[#FFFAF3] px-3 py-2">
              <p className="font-extrabold text-[#9E610B]">Short Stock · {unique(stockItems).length} รายการ</p>
              <p className="mt-1 break-words leading-5 text-[#6B6658]">{unique(stockItems).slice(0, 5).join(" · ")}
                {unique(stockItems).length > 5 ? ` และอีก ${unique(stockItems).length - 5} รายการ` : ""}
              </p>
            </div>
          )}
          {pickItems.length > 0 && (
            <div className="rounded-xl border border-[#F6E2C7] bg-[#FFFAF3] px-3 py-2">
              <p className="font-extrabold text-[#9E610B]">Short Pick · {unique(pickItems).length} รายการ</p>
              <p className="mt-1 break-words leading-5 text-[#6B6658]">{unique(pickItems).slice(0, 5).join(" · ")}
                {unique(pickItems).length > 5 ? ` และอีก ${unique(pickItems).length - 5} รายการ` : ""}
              </p>
            </div>
          )}
        </div>
        <button type="button" onClick={onContinue} disabled={busy}
          className="mt-4 min-h-12 w-full rounded-xl bg-[#007F7B] px-3 py-3 text-sm font-extrabold text-white disabled:opacity-50">
          โทรแจ้งแล้ว · ปิดงาน
        </button>
        <button type="button" onClick={onSkip} disabled={busy}
          className="mt-2 min-h-11 w-full rounded-xl border border-[#D5E8E2] bg-white px-3 py-2.5 text-sm font-bold text-[#567A70] disabled:opacity-50">
          ข้ามการโทร · ปิดงานต่อ
        </button>
        <p className="mt-2 text-center text-[11px] text-[#8A9B93]">การโทรไม่ใช่เงื่อนไขบังคับในการปิดงาน</p>
      </section>
    </div>
  );
}
