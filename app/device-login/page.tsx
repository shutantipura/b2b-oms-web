"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import LotusBrand from "@/components/LotusBrand";

export default function DeviceLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Explicitly switching accounts logs out the previous shared-device user.
        const switching = new URLSearchParams(window.location.search).get("logout") === "1";
        if (switching) {
          await supabase.auth.signOut();
          window.history.replaceState(null, "", "/device-login");
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: staff } = await supabase.from("staff")
              .select("id").eq("auth_user_id", user.id).eq("is_active", true).maybeSingle();
            if (staff) {
              window.location.replace("/login");
              return;
            }
            await supabase.auth.signOut();
          }
        }
      } catch {
        if (active) setError("ไม่สามารถตรวจสอบสถานะบัญชีได้");
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authError || !data.user) throw new Error("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      // Supabase RLS still enforces each staff member's role and permissions.
      const { data: staff, error: staffError } = await supabase.from("staff")
        .select("id").eq("auth_user_id", data.user.id).eq("is_active", true).maybeSingle();
      if (staffError || !staff) {
        await supabase.auth.signOut();
        throw new Error("บัญชีนี้ไม่ได้รับสิทธิ์พนักงาน OMS หรือถูกระงับ");
      }
      setPassword("");
      window.location.replace("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "เข้าสู่ระบบไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F3F8F7] px-4 py-10 text-[#254B43]">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-[#C9E8E0] bg-white p-6 shadow-md sm:p-8">
        <LotusBrand size="lg" />
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-[#02B0AF]">Android Staff Mode</p>
          <h1 className="mt-2 text-2xl font-black">เข้าสู่ระบบพนักงาน OMS</h1>
          <p className="mt-2 text-sm leading-6 text-[#6B857B]">
            ใช้ชื่อผู้ใช้ OMS และรหัสผ่านที่ Manager ตั้งไว้สำหรับอุปกรณ์
            ไม่ต้องติดตั้ง LINE บนโทรศัพท์เครื่องนี้
          </p>
        </div>
        <form onSubmit={e => void signIn(e)} className="space-y-4">
          <div>
            <label htmlFor="device-email" className="mb-2 block text-sm font-extrabold">ชื่อผู้ใช้ (อีเมล OMS)</label>
            <input id="device-email" type="email" autoComplete="username" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="บัญชีจากหน้า Device Accounts"
              className="h-12 w-full rounded-xl border-2 border-[#CFE5DF] bg-white px-4 text-base outline-none focus:border-[#02B0AF]"/>
          </div>
          <div>
            <label htmlFor="device-password" className="mb-2 block text-sm font-extrabold">รหัสผ่าน</label>
            <input id="device-password" type="password" autoComplete="current-password" required
              value={password} onChange={e => setPassword(e.target.value)}
              className="h-12 w-full rounded-xl border-2 border-[#CFE5DF] bg-white px-4 text-base outline-none focus:border-[#02B0AF]"/>
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
          <button disabled={busy} type="submit"
            className="min-h-12 w-full rounded-xl bg-[#02B0AF] px-5 py-3 text-base font-black text-white disabled:opacity-40">
            {busy ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ Staff Mode"}
          </button>
        </form>
        <p className="text-xs leading-5 text-[#72877F]">
          อุปกรณ์นี้สามารถออกจาก Staff Mode ได้โดยไม่หยุดระบบเสียงเตือน
          ผู้จัดการสามารถเปลี่ยนรหัสผ่านหรือปิดสิทธิ์บัญชีได้จากระบบ OMS
        </p>
      </div>
    </main>
  );
}
