"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  ReactNode,
} from "react";

import Link from "next/link";
import {
  usePathname,
} from "next/navigation";

import {
  supabase,
} from "../../lib/supabase";

type TaskStage =
  | "confirmation"
  | "picking"
  | "billing"
  | "delivery"
  | "payment_verification";

const SEGMENT_STAGE_MAP:
  Record<string, TaskStage> = {
  confirmation:
    "confirmation",
  picking:
    "picking",
  billing:
    "billing",
  delivery:
    "delivery",
  "payment-verification":
    "payment_verification",
};

export default function TasksLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname =
    usePathname();

  const stage =
    useMemo(
      () => {
        const parts =
          pathname
            .split("/")
            .filter(Boolean);

        // /tasks itself is always allowed for authenticated staff.
        if (
          parts.length < 2
        ) {
          return null;
        }

        return (
          SEGMENT_STAGE_MAP[
            parts[1]
          ] ?? null
        );
      },
      [pathname]
    );

  const [
    checking,
    setChecking,
  ] =
    useState(
      Boolean(stage)
    );

  const [
    allowed,
    setAllowed,
  ] =
    useState(
      !stage
    );

  const [
    message,
    setMessage,
  ] =
    useState("");

  useEffect(() => {
    let cancelled =
      false;

    async function checkAccess() {
      if (!stage) {
        setAllowed(true);
        setChecking(false);
        setMessage("");
        return;
      }

      setChecking(true);
      setAllowed(false);
      setMessage("");

      const {
        data: { user },
      } =
        await supabase.auth
          .getUser();

      if (cancelled) {
        return;
      }

      if (!user) {
        setMessage(
          "กรุณาเข้าสู่ระบบ OMS ก่อน"
        );
        setChecking(false);
        return;
      }

      const {
        data,
        error,
      } =
        await supabase.rpc(
          "staff_can_access_stage",
          {
            p_stage:
              stage,
          }
        );

      if (cancelled) {
        return;
      }

      if (error) {
        setMessage(
          "ไม่สามารถตรวจสอบสิทธิ์งานได้: " +
            error.message
        );
        setChecking(false);
        return;
      }

      if (data !== true) {
        setMessage(
          "บัญชีนี้ไม่มีสิทธิ์ทำงานประเภทนี้"
        );
        setChecking(false);
        return;
      }

      setAllowed(true);
      setChecking(false);
    }

    void checkAccess();

    return () => {
      cancelled = true;
    };
  }, [stage]);

  if (checking) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-xl mx-auto bg-white border rounded-2xl p-6">
          กำลังตรวจสอบสิทธิ์งาน...
        </div>
      </main>
    );
  }

  if (!allowed) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-xl mx-auto bg-white border rounded-2xl p-8">
          <h1 className="text-2xl font-bold">
            ไม่มีสิทธิ์เข้าถึงงานนี้
          </h1>

          <p className="text-gray-500 mt-2">
            {message ||
              "Manager ยังไม่ได้ให้สิทธิ์งานประเภทนี้กับบัญชีของคุณ"}
          </p>

          <Link
            href="/tasks"
            className="inline-block mt-6 underline font-semibold"
          >
            ← กลับไปหน้างาน
          </Link>
        </div>
      </main>
    );
  }

  return children;
}
