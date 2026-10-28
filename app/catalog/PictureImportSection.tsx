"use client";

import {
  useState,
} from "react";

import {
  supabase,
} from "../../lib/supabase";
import CatalogExportButton from "./CatalogExportButton";

type PictureRow = {
  sku: string;
  image_url: string;
};

type PicturePreview = {
  totalRows: number;
  validRows: number;
  uniqueSkus: number;
  duplicateCount: number;
  invalidCount: number;
};

type PictureImportResult = {
  success: boolean;
  receivedCount: number;
  validCount: number;
  updatedCount: number;
  matchedCount: number;
  unmatchedCount: number;
  invalidCount: number;
};

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

    return stripped || "0";
  }

  return trimmed;
}

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

export default function PictureImportSection() {
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
    pictureRows,
    setPictureRows,
  ] =
    useState<
      PictureRow[]
    >(
      []
    );

  const [
    preview,
    setPreview,
  ] =
    useState<
      PicturePreview | null
    >(
      null
    );

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
    successMessage,
    setSuccessMessage,
  ] =
    useState("");

  // =====================================================
  // READ PICTURE FILE
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

    setPictureRows(
      []
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
            type: "array",
          }
        );

      if (
        workbook
          .SheetNames
          .length ===
        0
      ) {
        throw new Error(
          "ไม่พบ Sheet ในไฟล์"
        );
      }

      let selectedSheetName:
        string | null =
        null;

      let selectedData:
        any[][] | null =
        null;

      // Find a sheet containing both
      // sku and thumbnail_image.

      for (
        const candidateName of
        workbook.SheetNames
      ) {
        const sheet =
          workbook.Sheets[
            candidateName
          ];

        const data =
          XLSX.utils
            .sheet_to_json<
              any[]
            >(
              sheet,
              {
                header: 1,
                defval: "",
                raw: false,
              }
            );

        if (
          !data ||
          data.length ===
            0
        ) {
          continue;
        }

        const headers =
          data[0].map(
            (
              value
            ) =>
              normalizeHeader(
                String(
                  value ??
                    ""
                )
              )
          );

        if (
          headers.includes(
            "sku"
          ) &&
          headers.includes(
            "thumbnailimage"
          )
        ) {
          selectedSheetName =
            candidateName;

          selectedData =
            data;

          break;
        }
      }

      if (
        !selectedSheetName ||
        !selectedData
      ) {
        throw new Error(
          "ไม่พบ Sheet ที่มีคอลัมน์ SKU และ thumbnail_image"
        );
      }

      const headerRow =
        selectedData[0].map(
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

      const skuIndex =
        normalizedHeaders.indexOf(
          "sku"
        );

      const imageIndex =
        normalizedHeaders.indexOf(
          "thumbnailimage"
        );

      if (
        skuIndex === -1 ||
        imageIndex === -1
      ) {
        throw new Error(
          "ไม่พบคอลัมน์ SKU หรือ thumbnail_image"
        );
      }

      const rawRows =
        selectedData.slice(
          1
        );

      const validRows:
        PictureRow[] =
        [];

      const seen =
        new Set<
          string
        >();

      let totalRows =
        0;

      let duplicateCount =
        0;

      let invalidCount =
        0;

      for (
        const row of
        rawRows
      ) {
        const sku =
          String(
            row[
              skuIndex
            ] ??
              ""
          ).trim();

        const imageUrl =
          String(
            row[
              imageIndex
            ] ??
              ""
          ).trim();

        // Ignore fully blank rows

        if (
          !sku &&
          !imageUrl
        ) {
          continue;
        }

        totalRows +=
          1;

        if (
          !sku ||
          !imageUrl ||
          !/^https?:\/\//i.test(
            imageUrl
          )
        ) {
          invalidCount +=
            1;

          continue;
        }

        const normalized =
          normalizeSku(
            sku
          );

        if (
          seen.has(
            normalized
          )
        ) {
          duplicateCount +=
            1;

          continue;
        }

        seen.add(
          normalized
        );

        validRows.push(
          {
            sku,
            image_url:
              imageUrl,
          }
        );
      }

      setFileName(
        file.name
      );

      setSheetName(
        selectedSheetName
      );

      setPictureRows(
        validRows
      );

      setPreview(
        {
          totalRows,

          validRows:
            validRows.length,

          uniqueSkus:
            validRows.length,

          duplicateCount,

          invalidCount,
        }
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถอ่าน Picture Catalog ได้"
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

  async function importPictures() {
    if (
      !preview ||
      pictureRows.length ===
        0
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `ยืนยันการนำเข้ารูปสินค้า?\n\n` +
        `รูปที่พร้อมนำเข้า: ${pictureRows.length.toLocaleString()} SKU\n` +
        `SKU ซ้ำ: ${preview.duplicateCount.toLocaleString()}\n` +
        `ข้อมูลไม่ถูกต้อง: ${preview.invalidCount.toLocaleString()}\n\n` +
        `ระบบจะอัปเดตเฉพาะ image_url และจะไม่แก้ไขราคา ชื่อสินค้า หรือสถานะการแสดงสินค้า`
      );

    if (!confirmed) {
      return;
    }

    setImporting(
      true
    );

    setMessage(
      ""
    );

    setSuccessMessage(
      ""
    );

    setProgress(
      0
    );

    setProcessed(
      0
    );

    let updated =
      0;

    let matched =
      0;

    let unmatched =
      0;

    let invalid =
      0;

    const batchSize =
      1000;

    try {
      for (
        let start = 0;
        start <
        pictureRows.length;
        start +=
          batchSize
      ) {
        const batch =
          pictureRows.slice(
            start,
            start +
              batchSize
          );

        const {
          data,
          error,
        } =
          await supabase.rpc(
            "import_product_image_batch",
            {
              p_rows:
                batch,
            }
          );

        if (error) {
          throw new Error(
            `Import หยุดที่ประมาณ SKU ลำดับ ${
              start + 1
            }: ${
              error.message
            }`
          );
        }

        const result =
          data as PictureImportResult;

        updated +=
          Number(
            result
              .updatedCount ??
              0
          );

        matched +=
          Number(
            result
              .matchedCount ??
              0
          );

        unmatched +=
          Number(
            result
              .unmatchedCount ??
              0
          );

        invalid +=
          Number(
            result
              .invalidCount ??
              0
          );

        const done =
          Math.min(
            start +
              batch.length,
            pictureRows.length
          );

        setProcessed(
          done
        );

        setProgress(
          Math.round(
            (
              done /
              pictureRows.length
            ) *
              100
          )
        );
      }

      setSuccessMessage(
        `นำเข้ารูปสำเร็จ — จับคู่สินค้า ${matched.toLocaleString()} SKU · อัปเดตรูป ${updated.toLocaleString()} SKU · หา Product Master ไม่พบ ${unmatched.toLocaleString()} SKU${
          invalid > 0
            ? ` · ข้าม ${invalid.toLocaleString()} รายการ`
            : ""
        }`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถนำเข้ารูปสินค้าได้"
      );
    } finally {
      setImporting(
        false
      );
    }
  }

  return (
    <section id="catalog-pictures" className="scroll-mt-5 overflow-hidden rounded-2xl border border-[#D8E7E7] bg-white shadow-sm">

      <div className="border-b border-[#DFEEEE] bg-[#F4FBFB] p-4 sm:p-5">

        <div className="flex items-start gap-4">

          <div className="w-9 h-9 rounded-lg bg-[#00A6A6] text-white flex items-center justify-center font-extrabold shrink-0">
            3
          </div>

          <div>

            <h2 className="text-lg font-bold text-[#273C45]">
              Picture Catalog · รูปสินค้า
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              ดูแล URL รูปสินค้าปัจจุบันและเพิ่มรูปใหม่ด้วย Excel
            </p>

          </div>

        </div>

      </div>

      <div className="p-4 sm:p-5">

        <div className="mb-6">
          <CatalogExportButton dataset="pictures" disabled={reading || importing} />
        </div>

        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-extrabold text-[#007F80]">ขั้นตอน 2 · อัปโหลดไฟล์รูปภาพที่แก้ไข</h3>
          <span className="text-xs text-[#718891]">ตรวจตัวอย่างก่อนยืนยัน</span>
        </div>

        <div className="rounded-xl border border-[#E3EEEE] bg-[#F8FBFB] p-4 text-sm">

          <p className="font-semibold">
            คอลัมน์ที่ระบบใช้
          </p>

          <div className="grid grid-cols-2 gap-2 mt-3 text-gray-600">

            <span>
              SKU
            </span>

            <span>
              thumbnail_image
            </span>

          </div>

          <p className="text-xs text-gray-400 mt-3">
            ระบบจะค้นหา Sheet ที่มีสองคอลัมน์นี้ให้อัตโนมัติ
          </p>

        </div>

        <label className="block mt-6">

          <span className="text-sm font-semibold">
            เลือก Picture Catalog
          </span>

          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={
              reading ||
              importing
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

        {reading && (

          <div className="mt-5 bg-gray-50 rounded-xl p-4">
            กำลังอ่าน Picture Catalog...
          </div>

        )}

        {message && (

          <div className="mt-5 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
            {
              message
            }
          </div>

        )}

        {successMessage && (

          <div className="mt-5 bg-green-50 border border-green-200 text-green-700 rounded-xl p-4 font-semibold">
            {
              successMessage
            }
          </div>

        )}

        {preview && (

          <div className="mt-6">

            <div className="border rounded-2xl overflow-hidden">

              <div className="p-5 border-b">

                <p className="font-bold">
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

              <div className="grid grid-cols-2 md:grid-cols-5">

                <div className="p-4 border-r border-b md:border-b-0">

                  <p className="text-xs text-gray-500">
                    แถวทั้งหมด
                  </p>

                  <p className="text-2xl font-bold mt-1">
                    {
                      preview.totalRows.toLocaleString()
                    }
                  </p>

                </div>

                <div className="p-4 border-b md:border-r md:border-b-0">

                  <p className="text-xs text-gray-500">
                    พร้อมนำเข้า
                  </p>

                  <p className="text-2xl font-bold mt-1">
                    {
                      preview.validRows.toLocaleString()
                    }
                  </p>

                </div>

                <div className="p-4 border-r">

                  <p className="text-xs text-gray-500">
                    SKU ไม่ซ้ำ
                  </p>

                  <p className="text-2xl font-bold mt-1">
                    {
                      preview.uniqueSkus.toLocaleString()
                    }
                  </p>

                </div>

                <div className="p-4 border-r">

                  <p className="text-xs text-gray-500">
                    SKU ซ้ำ
                  </p>

                  <p className="text-2xl font-bold mt-1">
                    {
                      preview.duplicateCount.toLocaleString()
                    }
                  </p>

                </div>

                <div className="p-4">

                  <p className="text-xs text-gray-500">
                    ข้อมูลไม่ถูกต้อง
                  </p>

                  <p className="text-2xl font-bold mt-1">
                    {
                      preview.invalidCount.toLocaleString()
                    }
                  </p>

                </div>

              </div>

            </div>

            <div className="mt-5">

              <p className="font-semibold">
                ตัวอย่างข้อมูล
              </p>

              <div className="overflow-x-auto border rounded-xl mt-2">

                <table className="w-full text-sm">

                  <thead className="bg-gray-50">

                    <tr>

                      <th className="text-left p-3">
                        SKU
                      </th>

                      <th className="text-left p-3">
                        Image URL
                      </th>

                    </tr>

                  </thead>

                  <tbody>

                    {pictureRows
                      .slice(
                        0,
                        5
                      )
                      .map(
                        (
                          row
                        ) => (

                        <tr
                          key={
                            row.sku
                          }
                          className="border-t"
                        >

                          <td className="p-3 whitespace-nowrap">
                            {
                              row.sku
                            }
                          </td>

                          <td className="p-3 text-xs break-all">
                            {
                              row.image_url
                            }
                          </td>

                        </tr>

                      ))}

                  </tbody>

                </table>

              </div>

            </div>

            {importing && (

              <div className="mt-6">

                <div className="flex justify-between text-sm">

                  <span>
                    กำลังนำเข้ารูปสินค้า...
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
                  }{" "}
                  /{" "}
                  {
                    pictureRows.length.toLocaleString()
                  }{" "}
                  SKU
                </p>

              </div>

            )}

            <button
              type="button"
              onClick={
                importPictures
              }
              disabled={
                importing ||
                pictureRows.length ===
                  0
              }
              className="w-full bg-[#00A6A6] text-white rounded-xl px-5 py-4 transition hover:bg-[#008F8C] font-semibold mt-6 disabled:opacity-40"
            >
              {importing
                ? "กำลังนำเข้า..."
                : "ยืนยันการนำเข้ารูปสินค้า"}
            </button>

          </div>

        )}

      </div>

    </section>
  );
}