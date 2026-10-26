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

function playAlertPattern(ctx: AudioContext) {
  if (ctx.state !== "running") return;
  const start = ctx.currentTime + 0.03;
  for (const [index, frequency] of [880, 1040, 880].entries()) {
    const when = start + index * 0.27;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.24, when + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.23);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(when);
    oscillator.stop(when + 0.24);
  }
}

export default function OrderAlarmPage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState("");
  const [audioReady, setAudioReady] = useState(false);
  const [screenAwake, setScreenAwake] = useState(false);
  const [online, setOnline] = useState(true);
  const audioRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
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

  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") {
      setScreenAwake(false);
      return;
    }
    if (wakeLockRef.current && !wakeLockRef.current.released) return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      wakeLockRef.current = lock;
      setScreenAwake(true);
      lock.addEventListener("release", () => {
        if (wakeLockRef.current === lock) {
          wakeLockRef.current = null;
          setScreenAwake(false);
        }
      });
    } catch {
      // Sound still works, but the device may turn its screen off.
      setScreenAwake(false);
    }
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => { setOnline(true); void refresh(); };
    const onOffline = () => setOnline(false);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        setScreenAwake(false);
        return;
      }
      void refresh();
      if (enabledRef.current) {
        void acquireWakeLock();
        void audioRef.current?.resume().catch(() => setAudioReady(false));
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, acquireWakeLock]);

  useEffect(() => {
    if (!enabled) return;
    // Repeat until every pending order is acknowledged.
    const playPulse = () => {
      const ctx = audioRef.current;
      if (ctx?.state === "running" && alarmsRef.current.length > 0) {
        playAlertPattern(ctx);
      }
    };
    playPulse();
    const interval = window.setInterval(playPulse, 1550);
    return () => window.clearInterval(interval);
  }, [enabled]);

  async function enableSound() {
    try {
      const ctx = audioRef.current ?? new AudioContext();
      audioRef.current = ctx;
      ctx.onstatechange = () => setAudioReady(ctx.state === "running");
      await ctx.resume();
      if (ctx.state !== "running") throw new Error("Audio context is suspended");
      enabledRef.current = true;
      setEnabled(true);
      setAudioReady(true);
      setError("");
      // The first sound confirms the Android media volume immediately.
      playAlertPattern(ctx);
      await acquireWakeLock();
    } catch {
      setAudioReady(false);
      setError("ไม่สามารถเปิดเสียงได้ กรุณาตรวจสอบระดับเสียงสื่อและแตะเปิดเสียงอีกครั้ง");
    }
  }

  async function testSound() {
    try {
      const ctx = audioRef.current;
      if (!ctx) return await enableSound();
      await ctx.resume();
      setAudioReady(ctx.state === "running");
      playAlertPattern(ctx);
    } catch {
      setError("เสียงถูกระงับโดยเบราว์เซอร์ กรุณาแตะเปิดเสียงอีกครั้ง");
    }
  }

  function disableSound() {
    enabledRef.current = false;
    setEnabled(false);
    setAudioReady(false);
    void audioRef.current?.suspend();
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
    setScreenAwake(false);
  }

  async function acknowledge(id: string) {
    setBusy(id);
    try {
      const { data, error: rpcError } = await supabase.rpc("acknowledge_order_alarm", {
        p_alert_id: id,
      });
      if (rpcError) throw rpcError;
      if (!data) throw new Error("รายการนี้ถูกยืนยันไปแล้ว กรุณารีเฟรช");
      // Stop ringing immediately when the final queued alarm is acknowledged.
      const remaining = alarmsRef.current.filter((alarm) => alarm.alert_id !== id);
      alarmsRef.current = remaining;
      setAlarms(remaining);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ไม่สามารถยืนยันรายการ");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => () => {
    void wakeLockRef.current?.release();
    if (audioRef.current) {
      audioRef.current.onstatechange = null;
      void audioRef.current.close();
    }
  }, []);

  return (
    <main className="min-h-screen bg-[#F2F8F6] px-4 py-8 text-[#17453F]">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="rounded-3xl bg-white p-6 shadow-sm">
          <p className="text-xs font-extrabold tracking-widest text-[#009F9D]">LOTUS’S B2B OMS</p>
          <h1 className="mt-2 text-3xl font-black">🔔 แจ้งเตือนออเดอร์ใหม่</h1>
          <p className="mt-2 text-sm text-slate-500">ตรวจสอบทุก 5 วินาที · ล่าสุด {lastChecked || "กำลังเชื่อมต่อ"}</p>
          <p className="mt-2 text-sm">{authorized === null ? "กำลังตรวจสอบสิทธิ์..." : authorized ? "● เชื่อมต่อบัญชีพนักงานแล้ว" : "● ยังไม่ได้เข้าสู่ระบบพนักงาน"}</p>
          {authorized === false && (
            <div className="mt-3 flex gap-4 text-sm font-bold text-[#008B8B]">
              <Link href="/miniapp">เข้าสู่ระบบด้วย LINE</Link>
              <Link href="/login">เข้าสู่ระบบพนักงาน</Link>
            </div>
          )}
        </header>

        {!online && (
          <div role="alert" className="rounded-2xl border border-red-400 bg-red-100 p-4 font-bold text-red-900">
            ⚠ ไม่มีอินเทอร์เน็ต · จะไม่ทราบว่ามีออเดอร์ใหม่จนกว่าจะเชื่อมต่ออีกครั้ง
          </div>
        )}
        {error && <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>}

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <p className="text-lg font-bold">🔊 ระบบเสียงเตือนออเดอร์</p>
          <p className="mt-1 text-sm text-slate-500">
            เสียงจะดังซ้ำต่อเนื่องทุกครั้งที่มีออเดอร์รอรับทราบ และหยุดเมื่อรับทราบครบทุกออเดอร์
          </p>
          {!enabled ? (
            <button type="button" onClick={() => void enableSound()} className="mt-4 w-full rounded-2xl bg-[#02B0AF] px-4 py-5 text-xl font-black text-white shadow-lg">
              🔊 เปิดเสียงเตือน (พร้อมทดสอบเสียง)
            </button>
          ) : (
            <div className="mt-4 space-y-3">
              <div role="status" className={audioReady ? "rounded-xl bg-emerald-100 p-3 text-center font-bold text-emerald-900" : "rounded-xl bg-red-100 p-3 text-center font-bold text-red-900"}>
                {audioReady ? "✓ เปิดเสียงเตือนแล้ว" : "⚠ เสียงถูกระงับ กรุณาแตะทดสอบเสียง"}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => void testSound()} className="rounded-xl bg-[#02B0AF] px-3 py-4 font-bold text-white">
                  🔔 ทดสอบเสียง
                </button>
                <button type="button" onClick={disableSound} className="rounded-xl border border-slate-300 px-3 py-4 font-bold text-slate-600">
                  ปิดเสียงเตือน
                </button>
              </div>
              <p className="text-center text-sm">
                {screenAwake ? "✓ ระบบกำลังช่วยเปิดหน้าจอค้างไว้" : "⚠ กรุณาตั้งค่าหน้าจอไม่ให้ดับขณะใช้งาน"}
              </p>
            </div>
          )}
          <p className="mt-4 text-xs leading-5 text-slate-500">
            เพื่อไม่ให้พลาดออเดอร์: เปิดหน้านี้ค้างไว้ใน Chrome, เปิดระดับเสียงสื่อ, เสียบสายชาร์จ และอย่าล็อกหน้าจอ
          </p>
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
