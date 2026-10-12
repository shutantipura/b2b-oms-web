"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  supabase,
} from "../../lib/supabase";

type PreviewResult = {
  totalRows: number;
  uniqueSkus: number;
  duplicateCount: number;
  matchedCount: number;
  unmatchedCount: number;
  unmatchedSkus: string[];
};

type ApplyResult = {
  success: boolean;
  matchedCount: number;
  visibleProductCount: number;
};

export default function CatalogPage() {
  const router =
    useRouter();

  const [
    checkingAccess,
    setCheckingAccess,
  ] =
    useState(true);

  const [
    fileName,
    setFileName,
  ] =
    useState("");

  const [
    headers,
    setHeaders,
  ] =
    useState<string[]>(
      []
    );

  const [
    rows,
    setRows,
  ] =
    useState<any[][]>(
      []
    );

  const [
    skuColumnIndex,
    setSkuColumnIndex,
  ] =
    useState<number | null>(
      null
    );

  const [
    preview,
    setPreview,
  ] =
    useState<PreviewResult | null>(
      null
    );

  const [
    reading,
    setReading,
  ] =
    useState(false);

  const [
    previewing,
    setPreviewing,
  ] =
    useState(false);

  const [
    applying,
    setApplying,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    successMessage,
    setSuccessMessage,
  ] =
    useState("");

  // =====================================================
  // MANAGER ACCESS
  // =====================================================

  useEffect(() => {
    async function checkManager() {
      const {
        data,
        error,
      } =
        await supabase.rpc(
          "is_current_manager"
        );

      if (
        error ||
        data !== true
      ) {
        router.replace(
          "/tasks"
        );

        return;
      }

      setCheckingAccess(
        false
      );
    }

    checkManager();
  }, [
    router,
  ]);

  // =====================================================
  // SKU VALUES
  // =====================================================

  const skuValues =
    useMemo(() => {
      if (
        skuColumnIndex ===
        null
      ) {
        return [];
      }

      return rows
        .map(
          (row) =>
            row[
              skuColumnIndex
            ]
        )
        .filter(
          (value) =>
            value !==
              undefined &&
            value !==
              null &&
            String(
              value
            ).trim() !==
              ""
        )
        .map(
          (value) =>
            String(
              value
            ).trim()
        );
    }, [
      rows,
      skuColumnIndex,
    ]);

  // =====================================================
  // AUTO-DETECT SKU COLUMN
  // =====================================================

  function detectSkuColumn(
    columnHeaders: string[]
  ) {
    const preferredNames =
      [
        "sku",
        "item number",
        "item_number",
        "item no",
        "item_no",
        "item code",
        "item_code",
        "product code",
        "product_code",
        "รหัสสินค้า",
        "รหัส sku",
        "รหัสสินค้า sku",
      ];

    const normalized =
      columnHeaders.map(
        (header) =>
          header
            .trim()
            .toLowerCase()
      );

    for (
      const candidate of preferredNames
    ) {
      const index =
        normalized.indexOf(
          candidate
        );

      if (
        index !== -1
      ) {
        return index;
      }
    }

    return null;
  }

  // =====================================================
  // READ EXCEL / CSV
  // =====================================================

  async function handleFile(
    file:
      | File
      | undefined
  ) {
    if (!file) {
      return;
    }

    setReading(
      true
    );

    setMessage(
      ""
    );

    setSuccessMessage(
      ""
    );

    setPreview(
      null
    );

    setHeaders(
      []
    );

    setRows(
      []
    );

    setSkuColumnIndex(
      null
    );

    try {
      const XLSX =
        await import(
          "xlsx"
        );

      const buffer =
        await file.arrayBuffer();

      const workbook =
        XLSX.read(
          buffer,
          {
            type: "array",
          }
        );

      const firstSheetName =
        workbook
          .SheetNames[0];

      if (
        !firstSheetName
      ) {
        throw new Error(
          "ไม่พบ Sheet ในไฟล์"
        );
      }

      const sheet =
        workbook.Sheets[
          firstSheetName
        ];

      const data =
        XLSX.utils
          .sheet_to_json<any[]>(
            sheet,
            {
              header: 1,
              defval: "",
              raw: false,
            }
          );

      if (
        !data ||
        data.length < 2
      ) {
        throw new Error(
          "ไฟล์ไม่มีข้อมูลเพียงพอ"
        );
      }

      const firstRow =
        data[0];

      const parsedHeaders =
        firstRow.map(
          (
            value,
            index
          ) => {
            const text =
              String(
                value ??
                  ""
              ).trim();

            return (
              text ||
              `Column ${
                index + 1
              }`
            );
          }
        );

      const parsedRows =
        data.slice(
          1
        );

      const detectedIndex =
        detectSkuColumn(
          parsedHeaders
        );

      setFileName(
        file.name
      );

      setHeaders(
        parsedHeaders
      );

      setRows(
        parsedRows
      );

      setSkuColumnIndex(
        detectedIndex
      );

      if (
        detectedIndex ===
        null
      ) {
        setMessage(
          "อ่านไฟล์สำเร็จ แต่ไม่พบคอลัมน์ SKU อัตโนมัติ กรุณาเลือกคอลัมน์ด้านล่าง"
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถอ่านไฟล์ได้"
      );
    } finally {
      setReading(
        false
      );
    }
  }

  // =====================================================
  // PREVIEW IMPORT
  // =====================================================

  async function previewImport() {
    if (
      skuColumnIndex ===
        null
    ) {
      setMessage(
        "กรุณาเลือกคอลัมน์ SKU"
      );

      return;
    }

    if (
      skuValues.length ===
        0
    ) {
      setMessage(
        "ไม่พบ SKU ในคอลัมน์ที่เลือก"
      );

      return;
    }

    setPreviewing(
      true
    );

    setMessage(
      ""
    );

    setSuccessMessage(
      ""
    );

    try {
      const {
        data,
        error,
      } =
        await supabase.rpc(
          "preview_customer_visible_skus",
          {
            p_skus:
              skuValues,
          }
        );

      if (error) {
        throw error;
      }

      setPreview(
        data as PreviewResult
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถตรวจสอบรายการสินค้าได้"
      );
    } finally {
      setPreviewing(
        false
      );
    }
  }

  // =====================================================
  // APPLY IMPORT
  // =====================================================

  async function applyImport() {
    if (
      !preview ||
      skuValues.length ===
        0
    ) {
      return;
    }

    if (
      preview.matchedCount ===
        0
    ) {
      setMessage(
        "ไม่สามารถยืนยันได้ เนื่องจากไม่มี SKU ใดจับคู่กับ Product Master"
      );

      return;
    }

    const confirmed =
      window.confirm(
        `ยืนยันการอัปเดตสินค้าที่แสดงให้ลูกค้า?\n\n` +
        `SKU ที่จับคู่สำเร็จ: ${preview.matchedCount}\n` +
        `SKU ที่หาไม่พบ: ${preview.unmatchedCount}\n\n` +
        `รายการสินค้าที่แสดงอยู่เดิมจะถูกแทนที่ด้วยรายการใหม่นี้`
      );

    if (!confirmed) {
      return;
    }

    setApplying(
      true
    );

    setMessage(
      ""
    );

    setSuccessMessage(
      ""
    );

    try {
      const {
        data,
        error,
      } =
        await supabase.rpc(
          "apply_customer_visible_skus",
          {
            p_skus:
              skuValues,
          }
        );

      if (error) {
        throw error;
      }

      const result =
        data as ApplyResult;

      setSuccessMessage(
        `อัปเดตสำเร็จ — สินค้าที่แสดงให้ลูกค้า ${result.visibleProductCount} รายการ`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถอัปเดตรายการสินค้าได้"
      );
    } finally {
      setApplying(
        false
      );
    }
  }

  // =====================================================
  // ACCESS LOADING
  // =====================================================

  if (
    checkingAccess
  ) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-5">
        <div className="bg-white border rounded-2xl p-6">
          กำลังตรวจสอบสิทธิ์...
        </div>
      </main>
    );
  }

  // =====================================================
  // PAGE
  // =====================================================

  return (
    <main className="min-h-screen bg-gray-100">

      <header className="bg-white border-b">

        <div className="max-w-5xl mx-auto px-5 py-5">

          <button
            type="button"
            onClick={() =>
              router.push(
                "/"
              )
            }
            className="text-sm text-gray-500"
          >
            ← กลับหน้าหลัก
          </button>

          <div className="mt-4">

            <p className="text-sm text-gray-500 font-semibold">
              MANAGER
            </p>

            <h1 className="text-3xl font-bold mt-1">
              จัดการแคตตาล็อก
            </h1>

            <p className="text-gray-500 mt-2">
              กำหนดรายการสินค้าที่ลูกค้าสามารถเห็นและสั่งซื้อได้
            </p>

          </div>

        </div>

      </header>

      <div className="max-w-5xl mx-auto p-5">

        {/* ========================================= */}
        {/* UPLOAD */}
        {/* ========================================= */}

        <section className="bg-white border rounded-2xl p-6">

          <h2 className="text-xl font-bold">
            สินค้าที่แสดงให้ลูกค้า
          </h2>

          <p className="text-sm text-gray-500 mt-2">
            อัปโหลด Excel หรือ CSV ที่มีรายการ SKU
            ที่ต้องการให้แสดงบน B2B Ordering
          </p>

          <div className="mt-6">

            <label className="block">

              <span className="text-sm font-semibold">
                เลือกไฟล์
              </span>

              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={
                  reading
                }
                onChange={(event) =>
                  handleFile(
                    event
                      .target
                      .files?.[0]
                  )
                }
                className="block w-full border rounded-xl px-4 py-4 mt-2 bg-white"
              />

            </label>

            <p className="text-xs text-gray-400 mt-2">
              รองรับ .xlsx, .xls และ .csv
            </p>

          </div>

          {reading && (

            <div className="mt-5 bg-gray-50 rounded-xl p-4">
              กำลังอ่านไฟล์...
            </div>

          )}

          {fileName && (

            <div className="mt-6 border-t pt-6">

              <p className="text-sm text-gray-500">
                ไฟล์ที่เลือก
              </p>

              <p className="font-semibold mt-1">
                {
                  fileName
                }
              </p>

              <p className="text-sm text-gray-500 mt-1">
                พบข้อมูล{" "}
                {
                  rows.length
                }{" "}
                แถว
              </p>

            </div>

          )}

          {/* COLUMN SELECTION */}

          {headers.length >
            0 && (

            <div className="mt-6">

              <label className="block text-sm font-semibold">
                เลือกคอลัมน์ SKU
              </label>

              <select
                value={
                  skuColumnIndex ??
                  ""
                }
                onChange={(event) => {
                  const value =
                    event
                      .target
                      .value;

                  setSkuColumnIndex(
                    value ===
                      ""
                      ? null
                      : Number(
                          value
                        )
                  );

                  setPreview(
                    null
                  );

                  setSuccessMessage(
                    ""
                  );
                }}
                className="w-full border rounded-xl px-4 py-3 mt-2 bg-white"
              >

                <option value="">
                  -- เลือกคอลัมน์ --
                </option>

                {headers.map(
                  (
                    header,
                    index
                  ) => (

                  <option
                    key={
                      index
                    }
                    value={
                      index
                    }
                  >
                    {
                      header
                    }
                  </option>

                ))}

              </select>

            </div>

          )}

          {/* SKU EXAMPLE */}

          {skuColumnIndex !==
            null && (

            <div className="mt-4 bg-gray-50 rounded-xl p-4">

              <p className="text-sm text-gray-500">
                ตัวอย่าง SKU ที่อ่านได้
              </p>

              <div className="flex flex-wrap gap-2 mt-2">

                {skuValues
                  .slice(
                    0,
                    8
                  )
                  .map(
                    (
                      sku,
                      index
                    ) => (

                    <span
                      key={
                        `${sku}-${index}`
                      }
                      className="bg-white border rounded-lg px-3 py-1 text-sm"
                    >
                      {
                        sku
                      }
                    </span>

                  ))}

              </div>

              <p className="text-xs text-gray-400 mt-3">
                พบ SKU ทั้งหมด{" "}
                {
                  skuValues.length
                }{" "}
                แถวก่อนตรวจสอบกับ Product Master
              </p>

            </div>

          )}

          {headers.length >
            0 && (

            <button
              type="button"
              onClick={
                previewImport
              }
              disabled={
                previewing ||
                skuColumnIndex ===
                  null
              }
              className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-6 disabled:opacity-40"
            >

              {previewing
                ? "กำลังตรวจสอบ..."
                : "ตรวจสอบรายการสินค้า"}

            </button>

          )}

        </section>

        {/* ========================================= */}
        {/* ERROR */}
        {/* ========================================= */}

        {message && (

          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mt-5">
            {
              message
            }
          </div>

        )}

        {/* ========================================= */}
        {/* SUCCESS */}
        {/* ========================================= */}

        {successMessage && (

          <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-4 mt-5 font-semibold">
            {
              successMessage
            }
          </div>

        )}

        {/* ========================================= */}
        {/* PREVIEW */}
        {/* ========================================= */}

        {preview && (

          <section className="bg-white border rounded-2xl mt-5 overflow-hidden">

            <div className="p-6 border-b">

              <h2 className="text-xl font-bold">
                ผลการตรวจสอบ
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                ข้อมูลยังไม่ถูกเปลี่ยนแปลงจนกว่าจะกดยืนยัน
              </p>

            </div>

            <div className="grid grid-cols-2 md:grid-cols-5">

              <div className="p-5 border-b md:border-b-0 md:border-r">

                <p className="text-sm text-gray-500">
                  แถวทั้งหมด
                </p>

                <p className="text-3xl font-bold mt-1">
                  {
                    preview.totalRows
                  }
                </p>

              </div>

              <div className="p-5 border-b md:border-b-0 md:border-r">

                <p className="text-sm text-gray-500">
                  SKU ไม่ซ้ำ
                </p>

                <p className="text-3xl font-bold mt-1">
                  {
                    preview.uniqueSkus
                  }
                </p>

              </div>

              <div className="p-5 border-b md:border-b-0 md:border-r">

                <p className="text-sm text-gray-500">
                  จับคู่สำเร็จ
                </p>

                <p className="text-3xl font-bold mt-1">
                  {
                    preview.matchedCount
                  }
                </p>

              </div>

              <div className="p-5 border-r">

                <p className="text-sm text-gray-500">
                  หาไม่พบ
                </p>

                <p className="text-3xl font-bold mt-1">
                  {
                    preview.unmatchedCount
                  }
                </p>

              </div>

              <div className="p-5">

                <p className="text-sm text-gray-500">
                  SKU ซ้ำ
                </p>

                <p className="text-3xl font-bold mt-1">
                  {
                    preview.duplicateCount
                  }
                </p>

              </div>

            </div>

            {/* UNMATCHED */}

            {preview
              .unmatchedSkus
              .length >
              0 && (

              <div className="border-t p-6">

                <h3 className="font-bold">
                  SKU ที่หาไม่พบ
                </h3>

                <p className="text-sm text-gray-500 mt-1">
                  SKU เหล่านี้ยังไม่มีใน Product Master
                  และจะไม่ถูกแสดงให้ลูกค้า
                </p>

                <div className="flex flex-wrap gap-2 mt-4">

                  {preview
                    .unmatchedSkus
                    .slice(
                      0,
                      100
                    )
                    .map(
                      (
                        sku
                      ) => (

                      <span
                        key={
                          sku
                        }
                        className="bg-red-50 border border-red-200 rounded-lg px-3 py-1 text-sm"
                      >
                        {
                          sku
                        }
                      </span>

                    ))}

                </div>

                {preview
                  .unmatchedSkus
                  .length >
                  100 && (

                  <p className="text-xs text-gray-400 mt-3">
                    แสดง 100 SKU แรก จากทั้งหมด{" "}
                    {
                      preview
                        .unmatchedSkus
                        .length
                    }
                  </p>

                )}

              </div>

            )}

            {/* APPLY */}

            <div className="border-t p-6 bg-gray-50">

              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

                <div>

                  <p className="font-bold">
                    พร้อมอัปเดตรายการสินค้า
                  </p>

                  <p className="text-sm text-gray-500 mt-1">
                    หลังยืนยัน ลูกค้าจะเห็นเฉพาะ SKU
                    ที่จับคู่สำเร็จจากไฟล์นี้
                  </p>

                </div>

                <button
                  type="button"
                  onClick={
                    applyImport
                  }
                  disabled={
                    applying ||
                    preview
                      .matchedCount ===
                      0
                  }
                  className="bg-black text-white rounded-xl px-6 py-4 font-semibold disabled:opacity-40"
                >

                  {applying
                    ? "กำลังอัปเดต..."
                    : "ยืนยันการอัปเดต"}

                </button>

              </div>

            </div>

          </section>

        )}

      </div>

    </main>
  );
}