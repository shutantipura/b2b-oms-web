"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type StaffAccount = {
  id: string;
  staffCode: string;
  staffName: string;
  accountType: "staff" | "manager";
  isActive: boolean;
  authUserId: string | null;
  taskPermissions: string[];
};
type StaffResponse = { staff?: StaffAccount[]; error?: string };
type CredentialResponse = {
  success?: boolean;
  loginEmail?: string;
  staffCode?: string;
  isActive?: boolean;
  error?: string;
};

async function managerRequest(url: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("กรุณาเข้าสู่ระบบผู้จัดการผ่าน LINE");
  return fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    cache: "no-store",
  });
}

export default function DeviceAccountsPage() {
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [staffId, setStaffId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await managerRequest("/api/admin/staff");
        const result = await response.json() as StaffResponse;
        if (!response.ok) throw new Error(result.error || "Unable to load staff");
        if (active) setStaff((result.staff ?? []).filter(s => s.isActive && !!s.authUserId));
      } catch (e) {
        if (active) setMessage(e instanceof Error ? e.message : "Unable to load accounts");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!staffId) {
      setEmail("");
      return;
    }
    let active = true;
    setEmail("");
    setMessage("");
    void (async () => {
      try {
        const response = await managerRequest(
          `/api/admin/device-credentials?staffId=${encodeURIComponent(staffId)}`
        );
        const result = await response.json() as CredentialResponse;
        if (!response.ok) throw new Error(result.error || "Unable to fetch login");
        if (active) setEmail(result.loginEmail ?? "");
      } catch (e) {
        if (active) setMessage(e instanceof Error ? e.message : "Unable to load login");
      }
    })();
    return () => { active = false; };
  }, [staffId]);

  const selected = staff.find(s => s.id === staffId);

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setSuccess("");
    if (!staffId || !selected) { setMessage("กรุณาเลือกบัญชีพนักงาน"); return; }
    if (password.length < 12 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setMessage("รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร พร้อมตัวอักษรและตัวเลข");
      return;
    }
    if (password !== confirm) { setMessage("รหัสผ่านทั้งสองช่องไม่ตรงกัน"); return; }
    if (!window.confirm(`ตั้งค่าหรือเปลี่ยนรหัสผ่าน OMS สำหรับ ${selected.staffCode} ${selected.staffName} ใช่หรือไม่?\n\nการเปลี่ยนนี้จะทำให้รหัสผ่านเดิมใช้ไม่ได้ แต่ยังเข้าสู่ระบบผ่าน LINE ได้`)) return;
    setBusy(true);
    try {
      const response = await managerRequest("/api/admin/device-credentials", {
        method: "POST", body: JSON.stringify({ staffId, password }),
      });
      const result = await response.json() as CredentialResponse;
      if (!response.ok || !result.success) throw new Error(result.error || "Save failed");
      setEmail(result.loginEmail ?? "");
      setPassword("");
      setConfirm("");
      setSuccess("✓ ตั้งค่ารหัสผ่านสำเร็จ สามารถใช้ชื่อผู้ใช้ด้านล่างและรหัสผ่านที่เพิ่งตั้งเข้าสู่ระบบ Android Staff Mode ได้");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save password");
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-[#F3F8F7] p-4 pb-28 text-[#24483F] sm:p-8">
      <div className="mx-auto max-w-2xl space-y-5">
        <Link href="/staff" className="inline-block rounded-xl border bg-white px-4 py-3 font-bold text-[#008F89]">
          ← กลับไปจัดการพนักงาน
        </Link>
        <section className="rounded-3xl border border-[#D5E8E2] bg-white p-5 shadow-sm sm:p-7">
          <p className="text-xs font-bold tracking-widest text-[#008F89]">ANDROID OMS / MANAGER</p>
          <h1 className="mt-2 text-2xl font-black">บัญชีเข้าใช้งาน OMS บนอุปกรณ์</h1>
          <p className="mt-2 text-sm leading-6 text-[#647B72]">
            ตั้งรหัสผ่านให้บัญชีพนักงานที่มีอยู่ เพื่อใช้ Staff Mode บน Android โดยไม่ต้องลง LINE บนอุปกรณ์
            สิทธิ์ใช้งานจะเป็นไปตามบทบาทและสิทธิ์งานของบัญชีนั้น
          </p>
          <p className="mt-4 rounded-xl border border-[#EAD48D] bg-[#FFF9E9] p-3 text-sm leading-6 text-[#805E17]">
            สำหรับเครื่องใช้ร่วมกัน แนะนำให้สร้างบัญชีพนักงานเฉพาะอุปกรณ์ในหน้า
            <Link className="mx-1 font-bold underline" href="/staff">จัดการพนักงาน</Link>
            และกำหนดสิทธิ์งานเท่าที่จำเป็น ไม่ควรใช้บัญชี Manager ร่วมกันโดยไม่จำเป็น
          </p>
        </section>
        <form onSubmit={e => void savePassword(e)} className="space-y-4 rounded-3xl border border-[#D5E8E2] bg-white p-5 sm:p-7">
          <label className="block text-sm font-bold" htmlFor="account">เลือกบัญชีพนักงาน</label>
          <select id="account" value={staffId} disabled={loading || busy}
            onChange={e => { setStaffId(e.target.value); setSuccess(""); setPassword(""); setConfirm(""); }}
            className="h-12 w-full rounded-xl border border-[#C4DED6] bg-white px-3 text-base">
            <option value="">{loading ? "กำลังโหลด..." : "— เลือกบัญชี —"}</option>
            {staff.map(s => (
              <option key={s.id} value={s.id}>{s.staffCode} · {s.staffName} ({s.accountType})</option>
            ))}
          </select>
          {selected && (
            <div className="rounded-xl bg-[#F1F9F6] p-3 text-sm">
              บทบาท: <b>{selected.accountType === "manager" ? "Manager" : "Staff"}</b>
              <p className="mt-1 text-xs text-[#688278]">สิทธิ์งาน: {selected.taskPermissions.join(", ") || "ยังไม่ได้รับสิทธิ์งาน"}</p>
            </div>
          )}
          {email && (
            <div className="rounded-xl border border-[#A7DCD1] bg-[#E7F8F4] p-4">
              <label className="block text-sm font-bold">ชื่อผู้ใช้สำหรับ Android (อีเมล OMS)</label>
              <p className="mt-2 break-all text-sm font-bold text-[#006F6B]">{email}</p>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(email)}
                className="mt-3 rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#008F89]">คัดลอกชื่อผู้ใช้</button>
            </div>
          )}
          <label className="block text-sm font-bold" htmlFor="new-password">กำหนดรหัสผ่านใหม่</label>
          <input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128}
            value={password} onChange={e => setPassword(e.target.value)}
            placeholder="12 ตัวอักษรขึ้นไป มีตัวเลขและตัวอักษร" required
            className="h-12 w-full rounded-xl border border-[#C4DED6] bg-white px-3 text-base" />
          <label className="block text-sm font-bold" htmlFor="confirm-password">ยืนยันรหัสผ่านใหม่</label>
          <input id="confirm-password" type="password" autoComplete="new-password"
            value={confirm} onChange={e => setConfirm(e.target.value)} required
            className="h-12 w-full rounded-xl border border-[#C4DED6] bg-white px-3 text-base" />
          <button type="submit" disabled={!staffId || busy || !email}
            className="min-h-12 w-full rounded-xl bg-[#02B0AF] px-5 py-3 font-extrabold text-white disabled:opacity-40">
            {busy ? "กำลังบันทึก..." : "ยืนยันตั้งรหัสผ่านสำหรับอุปกรณ์"}
          </button>
          {message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{message}</p>}
          {success && <p role="status" className="rounded-xl bg-[#E8F9F2] p-3 text-sm font-bold text-[#007868]">{success}</p>}
        </form>
        <p className="text-center text-sm text-[#647B72]">
          เข้าสู่ระบบที่ <Link href="/device-login" className="font-bold text-[#008F89] underline">Device Staff Login</Link>
        </p>
      </div>
    </main>
  );
}
