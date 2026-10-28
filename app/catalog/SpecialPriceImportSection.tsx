"use client";

import {
  useState,
} from "react";

import Link from "next/link";
import CatalogExportButton from "./CatalogExportButton";

import {
  supabase,
} from "../../lib/supabase";

type SpecialPriceRow = {
  customer_code: string;
  sku: string;
  agreed_price: number;
};

type InvalidRow = {
  rowNumber: number;
  customerCode: string;
  sku: string;
  reason: string;
};

type ImportResult = {
  success: boolean;
  receivedCount: number;
  insertedCount: number;
  updatedCount: number;
  unmatchedCustomerCount: number;
  unmatchedProductCount: number;
  invalidCount: number;
};

function normalizeHeader(
  value: string
) {
  return value
    .trim()
    .toLowerCase()
    .replace(
      /[\s_-]+/g,
      ""
    );
}

function normalizeSku(
  value: string
) {
  const trimmed =
    value.trim();

  if (
    /^[0-9]+$/.test(
      trimmed
    )
  ) {
    const stripped =
      trimmed.replace(
        /^0+/,
        ""
      );

    return (
      stripped ||
      "0"
    );
  }

  return trimmed;
}

function parsePrice(
  value: unknown
) {
  const text =
    String(
      value ?? ""
    )
      .trim()
      .replace(
        /,/g,
        ""
      )
      .replace(
        /฿/g,
        ""
      );

  if (
    text === ""
  ) {
    return null;
  }

  const number =
    Number(
      text
    );

  if (
    !Number.isFinite(
      number
    ) ||
    number < 0
  ) {
    return null;
  }

  return number;
}

function findHeaderIndex(
  headers: string[],
  aliases: string[]
) {
  return headers.findIndex(
    (header) =>
      aliases.includes(
        header
      )
  );
}

export default function SpecialPriceImportSection() {
  const [
    fileName,
    setFileName,
  ] =
    useState("");

  const [
    sheetName,
    setSheetName,
  ] =
    useState("");

  const [
    rows,
    setRows,
  ] =
    useState<
      SpecialPriceRow[]
    >([]);

  const [
    totalRows,
    setTotalRows,
  ] =
    useState(0);

  const [
    duplicateCount,
    setDuplicateCount,
  ] =
    useState(0);

  const [
    invalidRows,
    setInvalidRows,
  ] =
    useState<
      InvalidRow[]
    >([]);

  const [
    reading,
    setReading,
  ] =
    useState(false);

  const [
    importing,
    setImporting,
  ] =
    useState(false);

  const [
    resetting,
    setResetting,
  ] =
    useState(false);

  const [
    progress,
    setProgress,
  ] =
    useState(0);

  const [
    processed,
    setProcessed,
  ] =
    useState(0);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    success,
    setSuccess,
  ] =
    useState("");

  // =====================================================
  // READ EXCEL
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

    setSuccess(
      ""
    );

    setRows(
      []
    );

    setInvalidRows(
      []
    );

    setDuplicateCount(
      0
    );

    setTotalRows(
      0
    );

    setProgress(
      0
    );

    setProcessed(
      0
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
            type:
              "array",
          }
        );

      const preferredSheet =
        workbook
          .SheetNames
          .find(
            (
              name
            ) => {
              const normalized =
                normalizeHeader(
                  name
                );

              return [
                "customerpriceoverride",
                "specialprice",
                "customerprice",
                "ราคาพิเศษ",
                "ราคาลูกค้า",
              ].includes(
                normalized
              );
            }
          );

      const selectedSheetName =
        preferredSheet ??
        workbook
          .SheetNames[0];

      if (
        !selectedSheetName
      ) {
        throw new Error(
          "ไม่พบ Sheet ในไฟล์"
        );
      }

      const sheet =
        workbook.Sheets[
          selectedSheetName
        ];

      const data =
        XLSX.utils
          .sheet_to_json<
            any[]
          >(
            sheet,
            {
              header:
                1,

              defval:
                "",

              raw:
                false,
            }
          ) as any[][];

      if (
        !data ||
        data.length <
          2
      ) {
        throw new Error(
          "ไฟล์ราคาพิเศษไม่มีข้อมูลเพียงพอ"
        );
      }

      const headerRow =
        data[0].map(
          (
            value
          ) =>
            String(
              value ??
                ""
            ).trim()
        );

      const normalizedHeaders =
        headerRow.map(
          normalizeHeader
        );

      const customerCodeIndex =
        findHeaderIndex(
          normalizedHeaders,
          [
            "customercode",
            "custcode",
            "customerid",
            "accountnumber",
            "accountno",
            "รหัสลูกค้า",
            "เลขที่ลูกค้า",
          ]
        );

      const skuIndex =
        findHeaderIndex(
          normalizedHeaders,
          [
            "sku",
            "itemcode",
            "productcode",
            "productsku",
            "รหัสสินค้า",
          ]
        );

      const priceIndex =
        findHeaderIndex(
          normalizedHeaders,
          [
            "agreedprice",
            "specialprice",
            "customerprice",
            "overrideprice",
            "price",
            "ราคาพิเศษ",
            "ราคาลูกค้า",
            "ราคาตกลง",
          ]
        );

      if (
        customerCodeIndex <
          0 ||
        skuIndex <
          0 ||
        priceIndex <
          0
      ) {
        throw new Error(
          "ไม่พบคอลัมน์ที่จำเป็น กรุณาใช้หัวคอลัมน์ customer_code, sku และ agreed_price"
        );
      }

      const parsedRows:
        SpecialPriceRow[] =
        [];

      const invalid:
        InvalidRow[] =
        [];

      const duplicateKeys =
        new Set<
          string
        >();

      const rowMap =
        new Map<
          string,
          SpecialPriceRow
        >();

      let duplicateTotal =
        0;

      const bodyRows =
        data.slice(
          1
        );

      setTotalRows(
        bodyRows.length
      );

      bodyRows.forEach(
        (
          row,
          index
        ) => {
          const rowNumber =
            index + 2;

          const customerCode =
            String(
              row[
                customerCodeIndex
              ] ??
                ""
            )
              .trim()
              .toUpperCase();

          const sku =
            normalizeSku(
              String(
                row[
                  skuIndex
                ] ??
                  ""
              )
            );

          const price =
            parsePrice(
              row[
                priceIndex
              ]
            );

          if (
            !customerCode &&
            !sku &&
            (
              row[
                priceIndex
              ] ===
                "" ||
              row[
                priceIndex
              ] ===
                null ||
              row[
                priceIndex
              ] ===
                undefined
            )
          ) {
            return;
          }

          if (
            !customerCode
          ) {
            invalid.push(
              {
                rowNumber,
                customerCode,
                sku,
                reason:
                  "ไม่มีรหัสลูกค้า",
              }
            );

            return;
          }

          if (
            !sku
          ) {
            invalid.push(
              {
                rowNumber,
                customerCode,
                sku,
                reason:
                  "ไม่มี SKU",
              }
            );

            return;
          }

          if (
            price ===
            null
          ) {
            invalid.push(
              {
                rowNumber,
                customerCode,
                sku,
                reason:
                  "ราคาพิเศษไม่ถูกต้อง",
              }
            );

            return;
          }

          const parsed:
            SpecialPriceRow =
            {
              customer_code:
                customerCode,

              sku,

              agreed_price:
                price,
            };

          const key =
            `${customerCode}::${sku}`;

          if (
            rowMap.has(
              key
            )
          ) {
            duplicateTotal +=
              1;

            duplicateKeys.add(
              key
            );
          }

          // Last row wins when the same
          // customer + SKU appears more than once.
          rowMap.set(
            key,
            parsed
          );
        }
      );

      parsedRows.push(
        ...rowMap.values()
      );

      setFileName(
        file.name
      );

      setSheetName(
        selectedSheetName
      );

      setRows(
        parsedRows
      );

      setInvalidRows(
        invalid.slice(
          0,
          100
        )
      );

      setDuplicateCount(
        duplicateTotal
      );

      if (
        parsedRows.length ===
        0
      ) {
        setMessage(
          "ไม่พบแถวราคาพิเศษที่สามารถนำเข้าได้"
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถอ่านไฟล์ราคาพิเศษได้"
      );
    } finally {
      setReading(
        false
      );
    }
  }

  // =====================================================
  // IMPORT
  // =====================================================

  async function importPrices() {
    if (rows.length === 0) return;

    const confirmed = window.confirm(
      `ยืนยันการนำเข้าราคาพิเศษ?\n\n` +
        `รายการที่จะนำเข้า: ${rows.length.toLocaleString()}\n` +
        `แถวไม่ถูกต้อง: ${invalidRows.length.toLocaleString()}\n` +
        `รายการซ้ำในไฟล์: ${duplicateCount.toLocaleString()}\n\n` +
        `ระบบจะเพิ่มหรืออัปเดตราคาพิเศษจากไฟล์นี้`
    );
    if (!confirmed) return;

    setImporting(true);
    setMessage("");
    setSuccess("");
    setProgress(0);
    setProcessed(0);

    let inserted = 0;
    let updated = 0;
    let unmatchedCustomers = 0;
    let unmatchedProducts = 0;
    let invalid = 0;
    let cursor = 0;
    let batchSize = 20;

    try {
      while (cursor < rows.length) {
        const batch = rows.slice(cursor, cursor + batchSize);
        const { data, error } = await supabase.rpc(
          "import_customer_price_batch",
          { p_rows: batch }
        );

        if (error) {
          // Each RPC is a transaction. A timed-out batch is rolled back,
          // so it is safe to retry that same range in smaller batches.
          const timedOut =
            error.code === "57014" ||
            /statement timeout|canceling statement due to statement timeout/i.test(
              error.message
            );

          if (timedOut && batch.length > 1) {
            batchSize = Math.max(1, Math.floor(batch.length / 2));
            continue;
          }

          throw new Error(
            `นำเข้าหยุดที่แถวข้อมูล ${cursor + 1}–${cursor + batch.length} ` +
              `(นำเข้าสำเร็จแล้ว ${cursor} จาก ${rows.length} รายการ): ` +
              error.message +
              (timedOut
                ? " — แม้ส่งทีละ 1 รายการก็ยังหมดเวลา กรุณาตรวจสอบฟังก์ชัน import_customer_price_batch ใน Supabase"
                : "")
          );
        }

        const result = data as ImportResult | null;
        if (!result || result.success === false) {
          throw new Error(
            `ฟังก์ชันนำเข้ารายงานว่าไม่สำเร็จที่รายการ ${cursor + 1}–${cursor + batch.length}`
          );
        }

        inserted += Number(result.insertedCount ?? 0);
        updated += Number(result.updatedCount ?? 0);
        unmatchedCustomers += Number(result.unmatchedCustomerCount ?? 0);
        unmatchedProducts += Number(result.unmatchedProductCount ?? 0);
        invalid += Number(result.invalidCount ?? 0);

        cursor += batch.length;
        setProcessed(cursor);
        setProgress(Math.round((cursor / rows.length) * 100));
      }

      setSuccess(
        `นำเข้าราคาพิเศษสำเร็จ — เพิ่มใหม่ ${inserted.toLocaleString()} รายการ · อัปเดต ${updated.toLocaleString()} รายการ${
          unmatchedCustomers > 0
            ? ` · ไม่พบลูกค้า ${unmatchedCustomers.toLocaleString()} รายการ`
            : ""
        }${
          unmatchedProducts > 0
            ? ` · ไม่พบ SKU ${unmatchedProducts.toLocaleString()} รายการ`
            : ""
        }${
          invalid > 0
            ? ` · ข้ามข้อมูลไม่ถูกต้อง ${invalid.toLocaleString()} รายการ`
            : ""
        }`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถนำเข้าราคาพิเศษได้"
      );
    } finally {
      setImporting(false);
    }
  }

  // =====================================================
  // RESET ALL SPECIAL PRICES
  // =====================================================

  async function resetAllSpecialPrices() {
    const confirmed =
      window.confirm(
        "รีเซ็ตราคาพิเศษทั้งหมด?\n\n" +
          "ราคาพิเศษของลูกค้าทุกคนจะถูกล้างออกจากการใช้งาน และลูกค้าจะกลับไปใช้ราคาปกติทั้งหมด\n\n" +
          "หลังจากรีเซ็ต กรุณาอัปโหลดไฟล์ราคาพิเศษฉบับใหม่"
      );

    if (!confirmed) {
      return;
    }

    setResetting(true);
    setMessage("");
    setSuccess("");

    const {
      data,
      error,
    } =
      await supabase.rpc(
        "reset_all_customer_prices"
      );

    if (error) {
      setMessage(
        "ไม่สามารถรีเซ็ตราคาพิเศษได้: " +
          error.message
      );

      setResetting(false);
      return;
    }

    const resetCount =
      Number(
        (data as {
          resetCount?: number;
        } | null)
          ?.resetCount ??
          0
      );

    // Force a fresh file after reset.
    setFileName("");
    setSheetName("");
    setRows([]);
    setTotalRows(0);
    setDuplicateCount(0);
    setInvalidRows([]);
    setProgress(0);
    setProcessed(0);

    setSuccess(
      `รีเซ็ตราคาพิเศษเรียบร้อย ${resetCount.toLocaleString()} รายการ — ขณะนี้ลูกค้าทั้งหมดใช้ราคาปกติ กรุณาอัปโหลดไฟล์ราคาพิเศษฉบับใหม่`
    );

    setResetting(false);
  }

  return (
    <section className="bg-white border rounded-2xl overflow-hidden">

      <div className="p-5 border-b sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#02B0AF] font-bold text-white">
              1
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-[#17453F]">
                ราคาพิเศษรายลูกค้า
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                นำเข้าราคาพิเศษจำนวนมากจาก Excel หรือแก้ไขราคาทีละสินค้าได้
              </p>
            </div>
          </div>
          <Link
            href="/customers/favourites"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#91D6CE] bg-[#E7F8F5] px-4 py-2.5 text-sm font-extrabold text-[#007D79] transition hover:bg-[#D8F3EE]"
          >
            <span aria-hidden="true">★</span>
            จัดการสินค้าซื้อประจำ / ราคาพิเศษ
            <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>

      <div className="p-6">

        <div className="bg-gray-50 border rounded-xl p-4">

          <p className="font-semibold">
            รูปแบบไฟล์
          </p>

          <p className="text-sm text-gray-500 mt-2">
            ต้องมี 3 คอลัมน์:{" "}
            <span className="font-medium text-gray-700">
              customer_code
            </span>
            {" · "}
            <span className="font-medium text-gray-700">
              sku
            </span>
            {" · "}
            <span className="font-medium text-gray-700">
              agreed_price
            </span>
          </p>

          <p className="text-xs text-gray-500 mt-2">
            หากไฟล์มี Sheet ชื่อ Customer Price Override ระบบจะเลือก Sheet นี้ให้อัตโนมัติ
          </p>

          <p className="text-xs text-gray-500 mt-1">
            Workflow ที่แนะนำ: ดาวน์โหลด Excel ล่าสุด เพิ่มหรือแก้ไขรายการ แล้วนำเข้าซ้ำได้โดยไม่ต้องรีเซ็ต การลบแถวจากไฟล์ไม่ลบราคาเดิมในระบบ
          </p>

        </div>

        <div className="mt-6">
          <CatalogExportButton dataset="special" disabled={reading || importing || resetting} />
        </div>

        <div className="mt-6 border border-red-200 bg-red-50 rounded-xl p-5">

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

            <div>

              <p className="font-bold text-red-700">
                รีเซ็ตราคาพิเศษทั้งหมด
              </p>

              <p className="text-sm text-red-700 mt-1">
                ล้างราคาพิเศษที่ใช้งานอยู่ทั้งหมด ลูกค้าทุกคนจะกลับไปใช้ราคาปกติจนกว่าจะนำเข้าไฟล์ใหม่
              </p>

            </div>

            <button
              type="button"
              onClick={
                resetAllSpecialPrices
              }
              disabled={
                resetting ||
                importing ||
                reading
              }
              className="shrink-0 bg-white border border-red-300 text-red-700 rounded-xl px-5 py-3 font-semibold disabled:opacity-40"
            >
              {resetting
                ? "กำลังรีเซ็ต..."
                : "รีเซ็ตราคาพิเศษทั้งหมด"}
            </button>

          </div>

        </div>

        <label className="block mt-6">

          <span className="block text-sm font-semibold mb-2">
            เลือกไฟล์ราคาพิเศษ
          </span>

          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={
              reading ||
              importing ||
              resetting
            }
            onChange={(
              event
            ) => {
              const file =
                event
                  .target
                  .files?.[0];

              handleFile(
                file
              );

              event.target.value =
                "";
            }}
            className="block w-full text-sm"
          />

        </label>

        <p className="text-xs text-gray-500 mt-2">
          รองรับ .xlsx, .xls และ .csv
        </p>

        {reading && (

          <div className="mt-5 bg-gray-50 border rounded-xl p-4">
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
              Sheet:{" "}
              {
                sheetName
              }
            </p>

          </div>
        )}

        {rows.length >
          0 && (

          <div className="mt-6 border rounded-2xl overflow-hidden">

            <div className="grid grid-cols-2 md:grid-cols-4">

              <div className="p-4 border-r border-b md:border-b-0">

                <p className="text-xs text-gray-500">
                  แถวใน Sheet
                </p>

                <p className="text-2xl font-bold mt-1">
                  {
                    totalRows.toLocaleString()
                  }
                </p>

              </div>

              <div className="p-4 border-b md:border-r md:border-b-0">

                <p className="text-xs text-gray-500">
                  พร้อมนำเข้า
                </p>

                <p className="text-2xl font-bold mt-1">
                  {
                    rows.length.toLocaleString()
                  }
                </p>

              </div>

              <div className="p-4 border-r">

                <p className="text-xs text-gray-500">
                  ข้อมูลไม่ถูกต้อง
                </p>

                <p className="text-2xl font-bold mt-1">
                  {
                    invalidRows.length.toLocaleString()
                  }
                </p>

              </div>

              <div className="p-4">

                <p className="text-xs text-gray-500">
                  รายการซ้ำ
                </p>

                <p className="text-2xl font-bold mt-1">
                  {
                    duplicateCount.toLocaleString()
                  }
                </p>

              </div>

            </div>

            <div className="border-t p-5">

              <p className="font-bold">
                ตัวอย่างข้อมูล
              </p>

              <div className="overflow-x-auto mt-3">

                <table className="w-full text-sm">

                  <thead className="bg-gray-50">

                    <tr>

                      <th className="text-left p-3">
                        รหัสลูกค้า
                      </th>

                      <th className="text-left p-3">
                        SKU
                      </th>

                      <th className="text-right p-3">
                        ราคาพิเศษ
                      </th>

                    </tr>

                  </thead>

                  <tbody>

                    {rows
                      .slice(
                        0,
                        10
                      )
                      .map(
                        (
                          row,
                          index
                        ) => (

                        <tr
                          key={
                            `${row.customer_code}-${row.sku}-${index}`
                          }
                          className="border-t"
                        >

                          <td className="p-3">
                            {
                              row.customer_code
                            }
                          </td>

                          <td className="p-3">
                            {
                              row.sku
                            }
                          </td>

                          <td className="p-3 text-right">
                            ฿
                            {
                              row.agreed_price.toLocaleString(
                                "th-TH",
                                {
                                  minimumFractionDigits:
                                    2,
                                  maximumFractionDigits:
                                    2,
                                }
                              )
                            }
                          </td>

                        </tr>

                      ))
                    }

                  </tbody>

                </table>

              </div>

            </div>

          </div>

        )}

        {invalidRows.length >
          0 && (

          <div className="mt-5 bg-red-50 border border-red-200 rounded-xl p-4">

            <p className="font-bold text-red-700">
              แถวที่ไม่สามารถนำเข้าได้
            </p>

            <div className="mt-3 space-y-1 text-sm text-red-700">

              {invalidRows
                .slice(
                  0,
                  20
                )
                .map(
                  (
                    row
                  ) => (

                  <p
                    key={
                      row.rowNumber
                    }
                  >
                    แถว{" "}
                    {
                      row.rowNumber
                    }
                    :{" "}
                    {
                      row.customerCode ||
                      "-"
                    }
                    {" · "}
                    {
                      row.sku ||
                      "-"
                    }
                    {" — "}
                    {
                      row.reason
                    }
                  </p>

                ))
              }

            </div>

          </div>

        )}

        {importing && (

          <div className="mt-6">

            <div className="flex justify-between text-sm">

              <span>
                กำลังนำเข้าราคาพิเศษ...
              </span>

              <span className="font-semibold">
                {
                  progress
                }
                %
              </span>

            </div>

            <div className="w-full bg-gray-200 rounded-full h-3 mt-2 overflow-hidden">

              <div
                className="bg-black h-3 rounded-full transition-all"
                style={{
                  width:
                    `${progress}%`,
                }}
              />

            </div>

            <p className="text-xs text-gray-500 mt-2">
              {
                processed.toLocaleString()
              }
              {" / "}
              {
                rows.length.toLocaleString()
              }
              {" รายการ"}
            </p>

          </div>

        )}

        {message && (

          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mt-5">
            {
              message
            }
          </div>

        )}

        {success && (

          <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-4 mt-5 font-semibold">
            {
              success
            }
          </div>

        )}

        {rows.length >
          0 && (

          <button
            type="button"
            onClick={
              importPrices
            }
            disabled={
              importing ||
              reading ||
              resetting
            }
            className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-6 disabled:opacity-40"
          >
            {importing
              ? "กำลังนำเข้า..."
              : "ยืนยันการนำเข้าราคาพิเศษ"}
          </button>

        )}

      </div>

    </section>
  );
}
