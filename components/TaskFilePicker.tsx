"use client";

import { useRef } from "react";

type TaskFilePickerProps = {
  label: string;
  chooseLabel?: string;
  replaceLabel?: string;
  accept: string;
  uploaded: boolean;
  uploading: boolean;
  disabled?: boolean;
  fileName?: string | null;
  onSelect: (file: File) => void | Promise<void>;
};

export default function TaskFilePicker({
  label,
  chooseLabel,
  replaceLabel,
  accept,
  uploaded,
  uploading,
  disabled = false,
  fileName,
  onSelect,
}: TaskFilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = disabled || uploading;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={busy}
        className="sr-only"
        aria-label={label}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Allow selecting the same file again for a retry or replacement.
          event.currentTarget.value = "";
          if (file) void onSelect(file);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#008F8D] px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-[#007C7A] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4m-4 4 4-4 4 4" />
          <path d="M4 16v4h16v-4" />
        </svg>
        {uploading ? "กำลังอัปโหลด..." : uploaded ? (replaceLabel ?? `เปลี่ยน${label}`) : (chooseLabel ?? `เลือก${label}`)}
      </button>
      <p className="mt-2 text-xs leading-relaxed text-[#6D8B82]" role="status">
        {uploading
          ? "กรุณารอให้ระบบบันทึกไฟล์ให้เรียบร้อย"
          : uploaded
            ? "✓ บันทึกแล้ว · สามารถเลือกรูปหรือไฟล์ใหม่ได้จนกว่าจะปิดงาน"
            : "เลือกไฟล์แล้วระบบจะอัปโหลดให้อัตโนมัติ ไม่ต้องกดส่งอีกครั้ง"}
      </p>
      {fileName && <p className="mt-1 break-all text-xs font-semibold text-[#17453F]">{fileName}</p>}
    </div>
  );
}
