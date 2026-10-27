"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";


type Alarm = {
  alert_id: string;
  order_number: number;
  created_at: string;
};
type AlarmFeedResponse = { alerts?: Alarm[]; error?: string };
const LOCAL_ACK_STORAGE_KEY = "lotus-b2b-public-alarm-dismissed-v1";

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
  const [error, setError] = useState("");
  const [lastChecked, setLastChecked] = useState("");
  const [audioReady, setAudioReady] = useState(false);
  const [screenAwake, setScreenAwake] = useState(false);
  const [online, setOnline] = useState(true);
  const audioRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const enabledRef = useRef(false);
  const alarmsRef = useRef<Alarm[]>([]);
  const busyRef = useRef(false);
  // Only this device can acknowledge alarms without authenticating.
  // Anonymous devices must never mutate the shared order_alerts table.
  const dismissedRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const response = await fetch("/api/order-alarm/feed", { cache: "no-store" });
      const result = (await response.json()) as AlarmFeedResponse;
      if (!response.ok) throw new Error(result.error || "Unable to check new orders");
      const next = (result.alerts ?? [])
        .filter((alarm) => !dismissedRef.current.has(alarm.alert_id))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
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
    // Restore acknowledgement BEFORE the first network request.
    try {
      const raw = window.localStorage.getItem(LOCAL_ACK_STORAGE_KEY);
      const saved: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(saved)) {
        dismissedRef.current = new Set(saved.filter((id): id is string =>
          typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)
        ));
      }
    } catch {
      // Browsers with disabled storage still support this-page acknowledgements.
    }

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

  function acknowledge(ids: string[]) {
    for (const id of ids) dismissedRef.current.add(id);
    try {
      // Bound storage; old alerts naturally fall out of the 7-day public feed.
      const recent = [...dismissedRef.current].slice(-1500);
      window.localStorage.setItem(LOCAL_ACK_STORAGE_KEY, JSON.stringify(recent));
      dismissedRef.current = new Set(recent);
    } catch {
      // In private browsing, acknowledgements persist only until this page closes.
    }
    const remaining = alarmsRef.current.filter((alarm) => !dismissedRef.current.has(alarm.alert_id));
    alarmsRef.current = remaining;
    setAlarms(remaining);
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
          <p className="mt-2 text-sm font-bold text-[#007E78]">✓ สถานีแจ้งเตือนสาธารณะ · ไม่ต้องเข้าสู่ระบบ</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">แสดงเฉพาะหมายเลขออเดอร์ ไม่แสดงข้อมูลลูกค้า · ตรวจสอบออเดอร์ที่ยังไม่มีผู้รับทราบในช่วง 7 วันที่ผ่านมา</p>
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
            เสียงจะดังซ้ำเมื่อพบออเดอร์ที่ยังไม่ได้รับทราบบนอุปกรณ์นี้ และหยุดเมื่อรับทราบครบทุกออเดอร์
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-black">ออเดอร์ที่ยังไม่ได้รับทราบ: {alarms.length}</h2>
            {alarms.length > 1 && (
              <button
                type="button"
                onClick={() => acknowledge(alarmsRef.current.map((a) => a.alert_id))}
                className="min-h-11 rounded-xl border border-[#E4C98C] bg-[#FFF1C9] px-4 py-2 text-sm font-extrabold text-[#825C00]"
              >
                ✓ รับทราบทั้งหมดบนเครื่องนี้
              </button>
            )}
          </div>
          {alarms.length === 0 ? (
            <p className="mt-3 text-slate-500">ไม่มีออเดอร์ใหม่ที่ต้องแจ้งเตือนบนเครื่องนี้</p>
          ) : (
            <div className="mt-4 space-y-4">
              {alarms.map((alarm) => (
                <article key={alarm.alert_id} className="rounded-2xl bg-white p-4 shadow-sm">
                  <p className="text-2xl font-black">ออเดอร์ #{alarm.order_number}</p>
                  <p className="text-sm text-slate-500">{new Date(alarm.created_at).toLocaleString("th-TH")}</p>
                  <button
                    onClick={() => acknowledge([alarm.alert_id])}
                    className="mt-4 w-full rounded-2xl bg-[#009F9D] px-4 py-4 text-lg font-black text-white"
                  >
                    ✓ รับทราบบนเครื่องนี้
                  </button>
                </article>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs leading-5 text-[#7B8E87]">
            การรับทราบจะหยุดเสียงเฉพาะเครื่องนี้ ไม่เปลี่ยนสถานะออเดอร์
            และไม่ปิดเสียงของอุปกรณ์อื่น · หากต้องการดำเนินงานให้ใช้บัญชีพนักงานใน OMS
          </p>
        </section>
        <Link href="/tasks" className="block text-center font-bold text-[#008B8B] underline">พนักงาน: ไปหน้ารายการงาน OMS (ต้องเข้าสู่ระบบ)</Link>
      </div>
    </main>
  );
}
