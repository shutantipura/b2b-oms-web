export type TaskEntryStage =
  | "confirmation"
  | "picking"
  | "billing"
  | "delivery"
  | "payment_verification";

export type TaskEntryMode = "start" | "continue";

export type TaskEntrySnapshot = {
  status: string;
  ownerStaffId: string | null;
  ownerStaffName: string | null;
};

const START_STATUS: Record<TaskEntryStage, string> = {
  confirmation: "awaiting_confirmation",
  picking: "awaiting_picking",
  billing: "awaiting_billing",
  delivery: "ready_for_delivery",
  payment_verification: "payment_submitted",
};

const CONTINUE_STATUS: Record<TaskEntryStage, string> = {
  confirmation: "awaiting_confirmation",
  picking: "picking",
  billing: "awaiting_billing",
  delivery: "out_for_delivery",
  payment_verification: "payment_submitted",
};

export type TaskEntryDecision = {
  allowed: boolean;
  message: string;
};

/**
 * Evaluate the just-fetched database state, not a task card captured when the
 * page was opened. The subsequent claim_my_task RPC is still the atomic guard.
 */
export function evaluateTaskEntry(
  stage: TaskEntryStage,
  mode: TaskEntryMode,
  snapshot: TaskEntrySnapshot,
  currentStaffId: string | null
): TaskEntryDecision {
  const deny = (message: string): TaskEntryDecision => ({ allowed: false, message });

  if (!currentStaffId) return deny("ไม่พบข้อมูลพนักงานที่เข้าสู่ระบบ กรุณาเข้าสู่ระบบอีกครั้ง");
  if (snapshot.status === "completed") {
    return deny("งานนี้เสร็จเรียบร้อยแล้ว ไม่สามารถเริ่มงานซ้ำได้");
  }
  if (snapshot.status === "cancelled") {
    return deny("คำสั่งซื้อนี้ถูกยกเลิกแล้ว ไม่สามารถทำงานต่อได้");
  }

  const ownerId = snapshot.ownerStaffId;
  if (mode === "start" && ownerId) {
    return ownerId === currentStaffId
      ? deny("คุณรับงานนี้แล้ว กรุณาใช้ปุ่มทำต่อจากรายการงานล่าสุด")
      : deny(`งานนี้มีผู้รับผิดชอบแล้ว: ${snapshot.ownerStaffName || "พนักงานคนอื่น"}`);
  }

  const expectedStatus = mode === "start" ? START_STATUS[stage] : CONTINUE_STATUS[stage];
  if (snapshot.status !== expectedStatus) {
    return deny("งานนี้เปลี่ยนขั้นตอนหรือเสร็จแล้ว กรุณาตรวจสอบรายการงานล่าสุด");
  }

  if (mode === "continue") {
    if (!ownerId) return deny("งานนี้ไม่มีผู้รับผิดชอบอยู่แล้ว กรุณากลับไปตรวจสอบรายการงาน");
    if (ownerId !== currentStaffId) {
      return deny(`งานนี้อยู่ระหว่างดำเนินการโดย: ${snapshot.ownerStaffName || "พนักงานคนอื่น"}`);
    }
  }

  return { allowed: true, message: "" };
}
