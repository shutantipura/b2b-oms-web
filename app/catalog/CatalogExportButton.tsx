"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

export type SnapshotDataset = "master" | "visible" | "pictures" | "special";

type ExportRecord = {
  sku?: string;
  product?: string;
  unit?: string;
  normal_price?: number | string;
  cost?: number | string | null;
  sales?: number | string;
  department?: string | null;
  thumbnail_image?: string;
  customer_code?: string;
  agreed_price?: number | string;
};

type BatchResult = {
  rows: ExportRecord[];
  nextCursor: string | null;
  done: boolean;
};

const EXPORT_SETTINGS: Record<SnapshotDataset, {
  filePrefix: string;
  sheetName: string;
  headers: string[];
  columnWidths: number[];
  skuColumn: number;
  numberColumns: number[];
  description: string;
}> = {
  master: {
    filePrefix: "master_prices_live",
    sheetName: "Master Price",
    headers: ["SKU", "Product", "Unit", "Normal Price", "Cost"],
    columnWidths: [17, 56, 22, 18, 17],
    skuColumn: 0,
    numberColumns: [3, 4],
    description: "สินค้าที่ใช้งานทั้งหมด รวมราคาปกติและต้นทุนล่าสุด (N/A เมื่อไม่มีต้นทุน)",
  },
  visible: {
    filePrefix: "visible_products_live",
    sheetName: "Visible Products",
    headers: ["SKU", "Sales", "Department"],
    columnWidths: [17, 19, 40],
    skuColumn: 0,
    numberColumns: [1],
    description: "รายการ SKU ที่แสดงทั้งหมด · การนำเข้าใหม่จะแทนรายการที่แสดงทั้งหมด อย่าลบ SKU ที่ยังต้องแสดง",
  },
  pictures: {
    filePrefix: "picture_catalog_live",
    sheetName: "Picture Catalog",
    headers: ["SKU", "thumbnail_image"],
    columnWidths: [17, 95],
    skuColumn: 0,
    numberColumns: [],
    description: "รายการรูปภาพสินค้าที่มี URL อยู่ในระบบ รวมรูปที่แก้ไขราย SKU แล้ว",
  },
  special: {
    filePrefix: "customer_special_prices_live",
    sheetName: "Customer Price Override",
    headers: ["customer_code", "sku", "agreed_price"],
    columnWidths: [23, 17, 19],
    skuColumn: 1,
    numberColumns: [2],
    description: "ราคาพิเศษที่ใช้งานอยู่ รวมการปรับราย SKU · การลบแถวออกจาก Excel จะไม่ลบราคาเดิม",
  },
};

const PAGE_SIZE = 2000;
const MAX_PAGES = 300;

function requiredText(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("ข้อมูลในระบบไม่ครบ: " + label);
  return text;
}

function requiredNumber(value: unknown, label: string): number {
  if (value === null || value === undefined || value === "") {
    throw new Error("ข้อมูลตัวเลขในระบบไม่ครบ: " + label);
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error("ข้อมูลตัวเลขในระบบไม่ถูกต้อง: " + label);
  }
  return num;
}

function toExcelRow(dataset: SnapshotDataset, row: ExportRecord): (string | number)[] {
  const sku = requiredText(row.sku, "SKU");
  if (dataset === "master") {
    const cost = row.cost === null || row.cost === undefined
      ? "N/A" : requiredNumber(row.cost, "Cost (" + sku + ")");
    return [
      sku,
      requiredText(row.product, "Product (" + sku + ")"),
      requiredText(row.unit, "Unit (" + sku + ")"),
      requiredNumber(row.normal_price, "Normal Price (" + sku + ")"),
      cost,
    ];
  }
  if (dataset === "visible") {
    return [
      sku,
      requiredNumber(row.sales, "Sales (" + sku + ")"),
      requiredText(row.department, "Department (" + sku + ")"),
    ];
  }
  if (dataset === "pictures") {
    const image = requiredText(row.thumbnail_image, "thumbnail_image (" + sku + ")");
    if (!/^https?:\/\//i.test(image)) {
      throw new Error("URL รูปภาพไม่ถูกต้องสำหรับ SKU " + sku);
    }
    return [sku, image];
  }
  return [
    requiredText(row.customer_code, "customer_code (" + sku + ")"),
    sku,
    requiredNumber(row.agreed_price, "agreed_price (" + sku + ")"),
  ];
}

export default function CatalogExportButton({
  dataset,
  disabled = false,
}: {
  dataset: SnapshotDataset;
  disabled?: boolean;
}) {
  const [exporting, setExporting] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const settings = EXPORT_SETTINGS[dataset];

  async function download() {
    if (disabled || exporting) return;
    setExporting(true);
    setLoaded(0);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const records: ExportRecord[] = [];
      let cursor: string | null = null;
      let finished = false;

      for (let page = 0; page < MAX_PAGES; page++) {
        let batch: BatchResult | null = null;
        let lastError = "";

        for (let attempt = 1; attempt <= 3; attempt++) {
          const { data, error } = await supabase.rpc("export_catalog_snapshot_batch", {
            p_dataset: dataset,
            p_after_id: cursor,
            p_limit: PAGE_SIZE,
          });
          if (!error) {
            batch = data as BatchResult;
            break;
          }
          lastError = error.message;
          if (attempt < 3) {
            await new Promise<void>((resolve) =>
              window.setTimeout(resolve, attempt * 600)
            );
          }
        }

        if (!batch) {
          throw new Error("อ่านข้อมูลปัจจุบันไม่สำเร็จ: " + lastError);
        }
        if (!Array.isArray(batch.rows) || typeof batch.done !== "boolean") {
          throw new Error("รูปแบบข้อมูลที่ส่งกลับมาไม่ถูกต้อง");
        }
        records.push(...batch.rows);
        setLoaded(records.length);
        if (batch.done) {
          finished = true;
          break;
        }
        if (!batch.nextCursor || batch.nextCursor === cursor ||
            batch.rows.length !== PAGE_SIZE) {
          throw new Error("การดึงข้อมูลไม่ต่อเนื่อง กรุณาลองใหม่");
        }
        cursor = batch.nextCursor;
      }

      if (!finished) {
        throw new Error("จำนวนหน้าข้อมูลเกินขีดจำกัด กรุณาติดต่อผู้ดูแลระบบ");
      }

      const rows = records.map((record) => toExcelRow(dataset, record));
      records.length = 0;
      rows.sort((a, b) => {
        if (dataset === "special") {
          const customerCompare = String(a[0]).localeCompare(String(b[0]));
          if (customerCompare) return customerCompare;
          return String(a[1]).localeCompare(String(b[1]));
        }
        return String(a[0]).localeCompare(String(b[0]));
      });

      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.aoa_to_sheet([settings.headers, ...rows]);
      sheet["!cols"] = settings.columnWidths.map((wch) => ({ wch }));
      sheet["!autofilter"] = {
        ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: {
          c: settings.headers.length - 1, r: rows.length,
        } }),
      };

      // SKU and customer codes are identifiers; Excel must retain leading zeroes.
      for (let r = 1; r <= rows.length; r++) {
        const skuCell = sheet[XLSX.utils.encode_cell({ c: settings.skuColumn, r })];
        if (skuCell) {
          skuCell.t = "s";
          skuCell.z = "@";
        }
        if (dataset === "special") {
          const customerCell = sheet[XLSX.utils.encode_cell({ c: 0, r })];
          if (customerCell) {
            customerCell.t = "s";
            customerCell.z = "@";
          }
        }
        for (const c of settings.numberColumns) {
          const cell = sheet[XLSX.utils.encode_cell({ c, r })];
          if (cell && cell.t === "n") cell.z = "0.00";
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, settings.sheetName);
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      XLSX.writeFile(workbook, settings.filePrefix + "_" + date + ".xlsx", {
        compression: true,
      });
      setSuccessMessage("ดาวน์โหลดข้อมูลล่าสุด " + rows.length.toLocaleString() + " รายการแล้ว");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "ส่งออก Excel ไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#BDE1D8] bg-[#F3FAF7] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#205849]">ส่งออกข้อมูลล่าสุด (Excel)</p>
          <p className="mt-1 text-xs leading-relaxed text-[#617C72]">
            {settings.description} · ใช้ไฟล์นี้เป็นฐานก่อนเพิ่มข้อมูลและนำเข้าครั้งถัดไป
          </p>
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={disabled || exporting}
          className="shrink-0 rounded-xl border border-[#91D6CE] bg-white px-5 py-3 text-sm font-extrabold text-[#087E78] transition hover:bg-[#E6F7F1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? "กำลังส่งออก..." : "ดาวน์โหลด Excel ล่าสุด"}
        </button>
      </div>
      {exporting && (
        <p role="status" className="mt-2 text-xs text-[#347C6A]">
          กำลังอ่านข้อมูล {loaded.toLocaleString()} รายการ โปรดเปิดหน้านี้ไว้จนดาวน์โหลดเสร็จ
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
          {errorMessage} · ไม่มีการดาวน์โหลดไฟล์ที่ข้อมูลไม่ครบ
        </p>
      )}
      {successMessage && (
        <p role="status" className="mt-2 text-xs font-semibold text-green-700">
          {successMessage}
        </p>
      )}
    </div>
  );
}
