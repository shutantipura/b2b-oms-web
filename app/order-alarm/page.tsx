"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Alarm = {
  alert_id: string;
  order_id: string;
  order_number: number;
  customer_name: string;
  created_at: string;
};

export default function OrderAlarmPage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState("");
  const audioRef = useRef<AudioContext | null>(null);
  const enabledRef = useRef(false);
  const alarmsRef = useRef<Alarm[]>([]);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setAuthorized(false);
        setAlarms([]);
        alarmsRef.current = [];
        setError("กรุณาเข้าสู่ระบบด้วยบัญชีพนักงาน Supabase Auth ก่อน");
        return;
      }
      const { data, error: rpcError } = await supabase.rpc("get_pending_order_alarms");
      if (rpcError) throw rpcError;
      setAuthorized(true);
      const next = (data ?? []) as Alarm[];
      alarmsRef.current = next;
      setAlarms(next);
      setLastChecked(new Date().toLocaleTimeString("th-TH"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์");
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    // Browser audio can start only after the user taps Enable Alarm.
    const playPulse = () => {
      const ctx = audioRef.current;
      if (!ctx || ctx.state !== "running" || alarmsRef.current.length === 0) return;
      const now = ctx.currentTime;
      for (const offset of [0, 0.25, 0.5]) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "square";
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.16, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.21);
      }
    };
    playPulse();
    const interval = window.setInterval(playPulse, 1300);
    return () => window.clearInterval(interval);
  }, [enabled]);

  async function enableSound() {
    try {
      const ctx = audioRef.current ?? new AudioContext();
      audioRef.current = ctx;
      await ctx.resume();
      setEnabled(true);
      setError("");
    } catch {
      setError("ไม่สามารถเปิดเสียงได้ กรุณาตรวจสอบการตั้งค่าเสียงของโทรศัพท์");
    }
  }

  async function acknowledge(id: string) {
    setBusy(id);
    try {
      const { data, error: rpcError } = await supabase.rpc("acknowledge_order_alarm", {
        p_alert_id: id,
      });
      if (rpcError) throw rpcError;
      if (!data) throw new Error("รายการนี้ถูกยืนยันไปแล้ว กรุณารีเฟรช");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ไม่สามารถยืนยันรายการ");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => () => {
    void audioRef.current?.close();
  }, []);

  return (
    <main className="min-h-screen bg-[#F2F8F6] px-4 py-8 text-[#17453F]">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="rounded-3xl bg-white p-6 shadow-sm">
          <p className="text-xs font-extrabold tracking-widest text-[#009F9D]">LOTUS’S B2B OMS</p>
          <h1 className="mt-2 text-3xl font-black">🔔 แจ้งเตือนออเดอร์ใหม่</h1>
          <p className="mt-2 text-sm text-slate-500">ตรวจสอบทุก 5 วินาที · ล่าสุด {lastChecked || "กำลังเชื่อมต่อ"}</p>
          <p className="mt-2 text-sm">{authorized === null ? "กำลังตรวจสอบสิทธิ์..." : authorized ? "● เชื่อมต่อบัญชีพนักงานแล้ว" : "● ยังไม่ได้เข้าสู่ระบบพนักงาน"}</p>
        </header>

        {error && <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>}

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <p className="text-lg font-bold">ระบบเสียงเตือน</p>
          <p className="mt-1 text-sm text-slate-500">เปิดหน้านี้ค้างไว้ เปิดเสียงโทรศัพท์ และเสียบสายชาร์จ</p>
          {!enabled ? (
            <button onClick={enableSound} className="mt-4 w-full rounded-2xl bg-[#009F9D] px-4 py-5 text-xl font-black text-white">
              เปิดเสียงแจ้งเตือน
            </button>
          ) : (
            <button onClick={() => setEnabled(false)} className="mt-4 w-full rounded-2xl bg-emerald-100 px-4 py-5 text-lg font-bold text-emerald-900">
              ✓ เปิดเสียงแล้ว · แตะเพื่อปิดเสียง
            </button>
          )}
        </section>

        <section className={`rounded-3xl p-6 shadow-sm ${alarms.length ? "bg-red-50 ring-2 ring-red-400" : "bg-white"}`}>
          <h2 className="text-2xl font-black">ออเดอร์รอยืนยัน: {alarms.length}</h2>
          {alarms.length === 0 ? (
            <p className="mt-3 text-slate-500">ยังไม่มีออเดอร์ที่รอรับทราบ</p>
          ) : (
            <div className="mt-4 space-y-4">
              {alarms.map((alarm) => (
                <article key={alarm.alert_id} className="rounded-2xl bg-white p-4 shadow-sm">
                  <p className="text-2xl font-black">ออเดอร์ #{alarm.order_number}</p>
                  <p className="mt-1 text-lg">{alarm.customer_name}</p>
                  <p className="text-sm text-slate-500">{new Date(alarm.created_at).toLocaleString("th-TH")}</p>
                  <button
                    disabled={busy === alarm.alert_id}
                    onClick={() => void acknowledge(alarm.alert_id)}
                    className="mt-4 w-full rounded-2xl bg-[#009F9D] px-4 py-4 text-lg font-black text-white disabled:opacity-50"
                  >
                    {busy === alarm.alert_id ? "กำลังบันทึก..." : "✓ รับทราบออเดอร์"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
        <Link href="/tasks" className="block text-center font-bold text-[#008B8B] underline">ไปหน้ารายการงาน OMS</Link>
      </div>
    </main>
  );
}
