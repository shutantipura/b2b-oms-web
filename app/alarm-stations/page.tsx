"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Station = {
  id: string;
  label: string;
  created_at: string;
  last_seen_at: string | null;
  last_success_at: string | null;
  monitor_active: boolean;
  pending_count: number;
  app_version: string | null;
  last_error: string | null;
  revoked_at: string | null;
};
type StationResponse = { stations?: Station[]; serverTime?: string; error?: string };
type PairResponse = { pairingCode?: string; expiresAt?: string; error?: string };

async function authenticated(url: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("กรุณาเข้าสู่ระบบ Manager ก่อน");
  return fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...init.headers,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  });
}

function ago(iso: string | null, now: number) {
  if (!iso) return "ยังไม่เคยเชื่อมต่อ";
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} วินาทีก่อน`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} นาทีก่อน`;
  return `${Math.floor(seconds / 3600)} ชั่วโมงก่อน`;
}

function statusOf(station: Station, now: number) {
  if (station.revoked_at) return { text: "ยกเลิกการจับคู่", style: "bg-gray-100 text-gray-700" };
  if (!station.last_seen_at) return { text: "รออุปกรณ์เชื่อมต่อ", style: "bg-amber-100 text-amber-800" };
  const lastSeen = new Date(station.last_seen_at).getTime();
  const lastOk = station.last_success_at ? new Date(station.last_success_at).getTime() : 0;
  if (now - lastSeen > 90_000) return { text: "ไม่ออนไลน์ / ไม่ส่งสถานะ", style: "bg-red-100 text-red-700" };
  if (!station.monitor_active) return { text: "ออนไลน์ แต่ปิดเสียงเตือน", style: "bg-amber-100 text-amber-800" };
  if (now - lastOk > 120_000) return { text: "ออนไลน์ แต่เชื่อม OMS ไม่สำเร็จ", style: "bg-amber-100 text-amber-800" };
  return { text: "ออนไลน์ · ตรวจสอบออเดอร์ได้", style: "bg-emerald-100 text-emerald-800" };
}

export default function AlarmStationsPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("JAS Alarm Station");
  const [code, setCode] = useState("");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await authenticated("/api/admin/alarm-stations");
      const data = await response.json() as StationResponse;
      if (!response.ok) throw new Error(data.error ?? "Cannot load alarm stations");
      setStations(data.stations ?? []);
      setNow(Date.now());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot load alarm stations");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const every = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(every);
  }, [refresh]);

  async function createCode() {
    setError("");
    setCode("");
    setBusy(true);
    try {
      const response = await authenticated("/api/admin/alarm-stations", {
        method: "POST", body: JSON.stringify({ label: name.trim() }),
      });
      const data = await response.json() as PairResponse;
      if (!response.ok || !data.pairingCode) throw new Error(data.error ?? "Cannot create pairing code");
      setCode(data.pairingCode);
      setExpires(data.expiresAt ?? "");
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot create code");
    } finally { setBusy(false); }
  }

  async function revoke(station: Station) {
    if (!window.confirm(`ยกเลิกการจับคู่กับ ${station.label}?\nการส่งสถานะเครื่องจะถูกยกเลิก แต่เสียงเตือน OMS ยังทำงานบนเครื่องได้เหมือนเดิม`)) return;
    setBusy(true);
    try {
      const response = await authenticated("/api/admin/alarm-stations", {
        method: "DELETE", body: JSON.stringify({ stationId: station.id }),
      });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error ?? "Cannot unpair");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot revoke");
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-[#F4F9F7] px-3 py-6 pb-28 text-[#284F45] sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <Link href="/staff" className="inline-flex rounded-xl border border-[#CAE5DA] bg-white px-4 py-3 text-sm font-bold text-[#008C85]">← จัดการพนักงาน</Link>
        <section className="rounded-3xl border border-[#CFE6DE] bg-white p-5 shadow-sm sm:p-7">
          <p className="text-xs font-black tracking-widest text-[#008F89]">ANDROID / ALARM HEALTH</p>
          <h1 className="mt-2 text-2xl font-black">ตรวจสอบเครื่องแจ้งเตือนออเดอร์</h1>
          <p className="mt-2 text-sm leading-6 text-[#657E73]">
            ตรวจสอบว่า Android Alarm ส่งสัญญาณมาได้และเชื่อม OMS สำเร็จครั้งล่าสุดเมื่อใด
            หากไม่มีสัญญาณเกิน 90 วินาที จะแสดงว่าไม่ออนไลน์
          </p>
          <div className="mt-4 rounded-xl bg-[#FFF7E4] p-3 text-sm leading-6 text-[#865F12]">
            การจับคู่เป็นทางเลือกเท่านั้น ไม่ใช่การเข้าสู่ระบบพนักงาน
            เครื่องที่ไม่ได้จับคู่ยังสามารถเปิดเสียงเตือนออเดอร์ได้ตามปกติ
            สถานะออนไลน์ไม่รับประกันว่า Android จะเล่นเสียงได้ทุกครั้ง
          </div>
        </section>

        <section className="rounded-3xl border border-[#CFE6DE] bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-lg font-extrabold">เพิ่มเครื่องติดตามสุขภาพ Alarm</h2>
          <p className="mt-1 text-sm text-[#6B867B]">ตั้งชื่อเครื่อง แล้วสร้างรหัสจับคู่ใช้ครั้งเดียว (หมดอายุภายใน 15 นาที)</p>
          <label className="mt-4 block text-sm font-bold" htmlFor="station-name">ชื่ออุปกรณ์</label>
          <input id="station-name" value={name} maxLength={80} onChange={e => setName(e.target.value)}
            className="mt-2 h-12 w-full rounded-xl border border-[#C7E2D9] px-4 text-base focus:outline-[#02B0AF]" />
          <button type="button" disabled={busy || !name.trim()}
            onClick={() => void createCode()}
            className="mt-3 min-h-12 w-full rounded-xl bg-[#02B0AF] px-4 font-extrabold text-white disabled:opacity-40">
            {busy ? "กำลังบันทึก..." : "สร้างรหัสจับคู่เครื่อง"}
          </button>
          {code && (
            <div className="mt-4 rounded-2xl border border-[#9DD9CE] bg-[#E6F8F4] p-4">
              <p className="text-sm font-extrabold">รหัสจับคู่เครื่อง (ใช้ได้ครั้งเดียว)</p>
              <p className="mt-2 break-all font-mono text-lg font-black tracking-wider text-[#00756F]">{code}</p>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(code)}
                className="mt-3 rounded-xl border border-[#8ECBC1] bg-white px-4 py-2 text-sm font-bold text-[#007A73]">
                คัดลอกรหัส
              </button>
              <p className="mt-2 text-xs text-[#648076]">หมดอายุ {expires ? new Date(expires).toLocaleString("th-TH", {timeZone:"Asia/Bangkok"}) : "—"} · คัดลอกไว้จนกว่าจะใช้งาน</p>
            </div>
          )}
        </section>

        {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-black">อุปกรณ์ที่จับคู่แล้ว ({stations.filter(x => !x.revoked_at).length})</h2>
            <button type="button" onClick={() => void refresh()} className="min-h-10 rounded-xl border border-[#C8E5DA] bg-white px-3 text-sm font-bold text-[#008D87]">↻ รีเฟรช</button>
          </div>
          {loading && <p className="rounded-xl bg-white p-5 text-sm text-[#729184]">กำลังโหลด...</p>}
          {!loading && stations.length === 0 && (
            <p className="rounded-xl border bg-white p-5 text-sm text-[#6B877C]">
              ยังไม่มีเครื่องที่จับคู่ · สร้างรหัสเมื่อได้ Android กลับมาแล้ว จับคู่ในแอปได้ทันที
            </p>
          )}
          {stations.map(station => {
            const state = statusOf(station, now);
            return (
              <article key={station.id} className="rounded-2xl border border-[#CEE6DE] bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-base font-extrabold">{station.label}</h3>
                  <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${state.style}`}>{state.text}</span>
                </div>
                <div className="mt-3 grid gap-1 text-sm text-[#668177] sm:grid-cols-2">
                  <p>ติดต่อครั้งล่าสุด: {ago(station.last_seen_at, now)}</p>
                  <p>ตรวจ OMS สำเร็จ: {ago(station.last_success_at, now)}</p>
                  <p>ออเดอร์รอรับทราบบนเครื่อง: {station.pending_count}</p>
                  <p>เวอร์ชัน: {station.app_version ?? "—"}</p>
                </div>
                {station.last_error && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">ข้อผิดพลาด: {station.last_error}</p>}
                {!station.revoked_at && (
                  <button type="button" disabled={busy} onClick={() => void revoke(station)}
                    className="mt-4 rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-40">ยกเลิกการจับคู่</button>
                )}
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
