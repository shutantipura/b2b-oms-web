import Link from "next/link";

/** Safe browser fallback; Android intercepts this route before navigation. */
export default function TerminalAlarmPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F3F8F7] p-6">
      <section className="w-full max-w-lg rounded-3xl border border-[#CDE9E3] bg-white p-7 text-center shadow-sm">
        <h1 className="text-2xl font-black text-[#17453F]">Lotus’s B2B · Alarm</h1>
        <p className="mt-4 text-sm leading-7 text-[#577E76]">
          เมนูตั้งค่าเสียงเตือนของอุปกรณ์เปิดได้จากแอป Lotus’s B2B บน Android
        </p>
        <Link href="/login" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-[#02B0AF] px-6 font-bold text-white">
          กลับหน้า OMS
        </Link>
      </section>
    </main>
  );
}
