"use client";



import {

  useEffect,

  useMemo,

  useState,

} from "react";



import {

  useRouter,

} from "next/navigation";



import Link from "next/link";
import PictureImportSection from "./PictureImportSection";
import SpecialPriceImportSection from "./SpecialPriceImportSection";
import ManualMasterPriceEditor from "./ManualMasterPriceEditor";
import CatalogExportButton from "./CatalogExportButton";



import {

  supabase,

} from "../../lib/supabase";



// =======================================================

// TYPES

// =======================================================



type VisiblePreviewResult = {

  totalRows: number;

  uniqueSkus: number;

  duplicateCount: number;

  matchedCount: number;

  unmatchedCount: number;

  invalidSalesCount: number;

  invalidCategoryCount: number;

  unmatchedSkus: string[];

};



type VisibleApplyResult = {

  success: boolean;

  matchedCount: number;

  unmatchedCount: number;

  visibleProductCount: number;

};



type MasterProduct = {

  sku: string;

  product_name: string;

  unit: string;

  normal_price: number;

  cost: number | "N/A" | null;

};



type VisibleUploadRow = {

  sku: string;

  sales_score: string;

  category: string;

};



type MasterPreview = {

  totalRows: number;

  validRows: number;

  uniqueSkus: number;

  duplicateCount: number;

  invalidCount: number;



  invalidRows: {

    rowNumber: number;

    sku: string;

    reason: string;

  }[];

};



type MasterImportResult = {

  success: boolean;

  receivedCount: number;

  insertedCount: number;

  updatedCount: number;

  invalidCount: number;

};



// =======================================================

// HELPERS

// =======================================================



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

    )

  ) {

    return null;

  }



  return number;

}



// Round decimal cost text using decimal digits (avoids floating-point tie errors).
function roundCostToTwoDecimals(text: string) {
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100
    + Number((fraction + "00").slice(0, 2))
    + (fraction.length > 2 && fraction[2] >= "5" ? 1 : 0);
  return cents / 100;
}

// =======================================================

// PAGE

// =======================================================



export default function CatalogPage() {

  const router =

    useRouter();



  // =====================================================

  // ผู้จัดการ ACCESS

  // =====================================================



  const [

    checkingAccess,

    setCheckingAccess,

  ] =

    useState(true);



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

  // PRODUCT MASTER STATE

  // =====================================================



  const [

    masterFileName,

    setMasterFileName,

  ] =

    useState("");



  const [

    masterSheetName,

    setMasterSheetName,

  ] =

    useState("");



  const [

    masterRows,

    setMasterRows,

  ] =

    useState<

      MasterProduct[]

    >(

      []

    );



  const [

    masterPreview,

    setMasterPreview,

  ] =

    useState<

      MasterPreview | null

    >(

      null

    );



  const [

    readingMaster,

    setReadingMaster,

  ] =

    useState(false);



  const [

    importingMaster,

    setImportingMaster,

  ] =

    useState(false);



  const [

    resettingProducts,

    setResettingProducts,

  ] =

    useState(false);



  const [

    resettingPictures,

    setResettingPictures,

  ] =

    useState(false);



  const [

    pictureResetKey,

    setPictureResetKey,

  ] =

    useState(0);



  const [

    pictureResetMessage,

    setPictureResetMessage,

  ] =

    useState("");



  const [

    pictureResetSuccess,

    setPictureResetSuccess,

  ] =

    useState("");



  const [

    masterProgress,

    setMasterProgress,

  ] =

    useState(0);



  const [

    masterProcessed,

    setMasterProcessed,

  ] =

    useState(0);



  const [

    masterMessage,

    setMasterMessage,

  ] =

    useState("");



  const [

    masterSuccess,

    setMasterSuccess,

  ] =

    useState("");



  const [masterAdjustRevision, setMasterAdjustRevision] = useState(0);

  // =====================================================

  // VISIBLE SKU STATE

  // =====================================================



  const [

    visibleFileName,

    setVisibleFileName,

  ] =

    useState("");



  const [

    visibleHeaders,

    setVisibleHeaders,

  ] =

    useState<

      string[]

    >(

      []

    );



  const [

    visibleRows,

    setVisibleRows,

  ] =

    useState<

      any[][]

    >(

      []

    );



  const [

    visibleSkuColumnIndex,

    setVisibleSkuColumnIndex,

  ] =

    useState<

      number | null

    >(

      null

    );



  const [

    visibleSalesColumnIndex,

    setVisibleSalesColumnIndex,

  ] =

    useState<

      number | null

    >(

      null

    );



  const [

    visibleCategoryColumnIndex,

    setVisibleCategoryColumnIndex,

  ] =

    useState<

      number | null

    >(

      null

    );



  const [

    visiblePreview,

    setVisiblePreview,

  ] =

    useState<

      VisiblePreviewResult | null

    >(

      null

    );



  const [

    readingVisible,

    setReadingVisible,

  ] =

    useState(false);



  const [

    previewingVisible,

    setPreviewingVisible,

  ] =

    useState(false);



  const [

    applyingVisible,

    setApplyingVisible,

  ] =

    useState(false);



  const [

    visibleStageProcessed,

    setVisibleStageProcessed,

  ] =

    useState(0);



  const [

    visibleStageTotal,

    setVisibleStageTotal,

  ] =

    useState(0);



  const [

    resettingVisible,

    setResettingVisible,

  ] =

    useState(false);



  const [

    visibleMessage,

    setVisibleMessage,

  ] =

    useState("");



  const [

    visibleSuccess,

    setVisibleSuccess,

  ] =

    useState("");



  // =====================================================

  // PRODUCT MASTER FILE

  // =====================================================



  async function handleMasterFile(

    file:

      | File

      | undefined

  ) {

    if (!file) {

      return;

    }



    setReadingMaster(

      true

    );



    setMasterMessage(

      ""

    );



    setMasterSuccess(

      ""

    );



    setMasterPreview(

      null

    );



    setMasterRows(

      []

    );



    setMasterProgress(

      0

    );



    setMasterProcessed(

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



      const preferredSheet =

        workbook

          .SheetNames

          .find(

            (

              name

            ) =>

              name

                .trim()

                .toLowerCase() ===

              "master price"

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

          .sheet_to_json<any[]>(

            sheet,

            {

              header: 1,

              defval: "",

              raw: false,

            }

          ) as any[][];



      if (

        !data ||

        data.length < 2

      ) {

        throw new Error(

          "Master Price ไม่มีข้อมูลเพียงพอ"

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

      const worksheetOrigin = XLSX.utils.decode_range(sheet["!ref"] ?? "A1").s;



      const skuIndex =

        normalizedHeaders.indexOf(

          "sku"

        );



      const productIndex =

        normalizedHeaders.indexOf(

          "product"

        );



      const unitIndex =

        normalizedHeaders.indexOf(

          "unit"

        );



      const priceIndex =

        normalizedHeaders.indexOf(

          "normalprice"

        );

      // Optional confidential unit cost (same unit as selling price).
      const costIndex = normalizedHeaders.indexOf("cost");





      const missingHeaders:

        string[] =

        [];



      if (

        skuIndex === -1

      ) {

        missingHeaders.push(

          "SKU"

        );

      }



      if (

        productIndex === -1

      ) {

        missingHeaders.push(

          "Product"

        );

      }



      if (

        unitIndex === -1

      ) {

        missingHeaders.push(

          "Unit"

        );

      }



      if (

        priceIndex === -1

      ) {

        missingHeaders.push(

          "Normal Price"

        );

      }





      if (

        missingHeaders.length >

        0

      ) {

        throw new Error(

          `ไม่พบคอลัมน์: ${missingHeaders.join(

            ", "

          )}`

        );

      }



      const rawRows =

        data.slice(

          1

        );



      const validRows:

        MasterProduct[] =

        [];



      const invalidRows:

        {

          rowNumber: number;

          sku: string;

          reason: string;

        }[] =

        [];



      const seen =

        new Set<

          string

        >();



      let totalRows =

        0;



      let duplicateCount =

        0;



      rawRows.forEach(

        (

          row,

          index

        ) => {

          const sku =

            String(

              row[

                skuIndex

              ] ??

                ""

            ).trim();



          const productName =

            String(

              row[

                productIndex

              ] ??

                ""

            ).trim();



          const unit =

            String(

              row[

                unitIndex

              ] ??

                ""

            ).trim();



          const rawPrice =

            row[

              priceIndex

            ];

          const costCell = costIndex >= 0
            ? sheet[XLSX.utils.encode_cell({
                r: worksheetOrigin.r + index + 1,
                c: worksheetOrigin.c + costIndex,
              })]
            : undefined;
          // Excel formula #N/A cells have type "e" and numeric error code 0x2A.
          // Preserve the distinction from an empty cell, which keeps old cost.
          const rawCost = costCell?.t === "e"
            ? (Number(costCell.v) === 0x2A ? "#N/A" : (costCell.w ?? "#ERROR"))
            : costIndex >= 0 ? row[costIndex] : null;





          const completelyBlank =

            !sku &&

            !productName &&

            !unit &&

            String(

              rawPrice ??

                ""

            ).trim() ===

              "";



          if (

            completelyBlank

          ) {

            return;

          }



          totalRows +=

            1;



          const rowNumber =

            index + 2;



          if (!sku) {

            invalidRows.push(

              {

                rowNumber,

                sku: "",

                reason:

                  "ไม่มี SKU",

              }

            );



            return;

          }



          if (

            !productName

          ) {

            invalidRows.push(

              {

                rowNumber,

                sku,

                reason:

                  "ไม่มีชื่อสินค้า",

              }

            );



            return;

          }



          const price =

            parsePrice(

              rawPrice

            );



          if (

            price === null ||

            price < 0

          ) {

            invalidRows.push(

              {

                rowNumber,

                sku,

                reason:

                  "ราคาไม่ถูกต้อง",

              }

            );



            return;

          }



          // Blank or missing cost does not overwrite any previously imported cost.
          const cleanedCost = String(rawCost ?? "").replace(/[,฿]/g, "").trim();
          const costProvided = cleanedCost.length > 0;
          const costUnavailable = /^(?:n\/?a|#n\/a)$/i.test(cleanedCost);
          if (costProvided && !costUnavailable && !/^[0-9]{1,10}(?:\.[0-9]+)?$/.test(cleanedCost)) {
            invalidRows.push({
              rowNumber,
              sku,
              reason: "ต้นทุน (Cost) ต้องเป็นตัวเลขไม่ติดลบ หรือ N/A",
            });
            return;
          }
          // Empty cell preserves the old cost; explicit N/A clears it.
          const parsedCost = costUnavailable
            ? "N/A" as const
            : costProvided ? roundCostToTwoDecimals(cleanedCost) : null;
          if (typeof parsedCost === "number" && parsedCost >= 10_000_000_000) {
            invalidRows.push({
              rowNumber,
              sku,
              reason: "ต้นทุน (Cost) สูงเกินขอบเขตที่รองรับหลังปัดเศษ",
            });
            return;
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



            return;

          }



          seen.add(

            normalized

          );



          validRows.push(

            {

              sku,



              product_name:

                productName,



              unit,



              normal_price:

                price,

              cost: parsedCost,

            }

          );

        }

      );



      setMasterFileName(

        file.name

      );



      setMasterSheetName(

        selectedSheetName

      );



      setMasterRows(

        validRows

      );



      setMasterPreview(

        {

          totalRows,



          validRows:

            validRows.length,



          uniqueSkus:

            validRows.length,



          duplicateCount,



          invalidCount:

            invalidRows.length,



          invalidRows:

            invalidRows.slice(

              0,

              100

            ),

        }

      );

    } catch (error) {

      setMasterMessage(

        error instanceof Error

          ? error.message

          : "ไม่สามารถอ่าน Master Price ได้"

      );

    } finally {

      setReadingMaster(

        false

      );

    }

  }



  // =====================================================

  // IMPORT PRODUCT MASTER

  // =====================================================



  async function importMaster() {

    if (

      !masterPreview ||

      masterRows.length ===

        0

    ) {

      return;

    }



    const confirmed =

      window.confirm(

        `ยืนยันการนำเข้า Product Master?\n\n` +

          `SKU ที่จะนำเข้า: ${masterRows.length.toLocaleString()}\n` +

          `ข้อมูลไม่ถูกต้อง: ${masterPreview.invalidCount.toLocaleString()}\n` +

          `SKU ซ้ำ: ${masterPreview.duplicateCount.toLocaleString()}\n\n` +

          `สินค้าที่มีอยู่แล้วจะถูกอัปเดต และสินค้าใหม่จะถูกเพิ่ม`

      );



    if (

      !confirmed

    ) {

      return;

    }



    setImportingMaster(

      true

    );



    setMasterMessage(

      ""

    );



    setMasterSuccess(

      ""

    );



    setMasterProcessed(

      0

    );



    setMasterProgress(

      0

    );



    let inserted =

      0;



    let updated =

      0;



    let invalid =

      0;



    const batchSize =

      1000;



    try {

      for (

        let start = 0;

        start <

        masterRows.length;

        start +=

          batchSize

      ) {

        const batch =

          masterRows.slice(

            start,

            start +

              batchSize

          );



        const {

          data,

          error,

        } =

          await supabase.rpc(

            "import_product_master_with_category_batch",

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

          data as MasterImportResult;



        inserted +=

          Number(

            result

              .insertedCount ??

              0

          );



        updated +=

          Number(

            result

              .updatedCount ??

              0

          );



        invalid +=

          Number(

            result

              .invalidCount ??

              0

          );



        const processed =

          Math.min(

            start +

              batch.length,

            masterRows.length

          );



        setMasterProcessed(

          processed

        );



        setMasterProgress(

          Math.round(

            (

              processed /

              masterRows.length

            ) *

              100

          )

        );

      }



      setMasterSuccess(

        `นำเข้าสำเร็จ — เพิ่มสินค้าใหม่ ${inserted.toLocaleString()} รายการ · อัปเดตสินค้าเดิม ${updated.toLocaleString()} รายการ${

          invalid > 0

            ? ` · ข้าม ${invalid.toLocaleString()} รายการ`

            : ""

        }`

      );

      setMasterAdjustRevision((current) => current + 1);

    } catch (error) {

      setMasterMessage(

        error instanceof Error

          ? error.message

          : "ไม่สามารถนำเข้า Product Master ได้"

      );

    } finally {

      setImportingMaster(

        false

      );

    }

  }



  // =====================================================

  // RESET PRODUCT MASTER

  // =====================================================



  async function resetAllProducts() {

    const confirmed =

      window.confirm(

        "รีเซ็ต Product Master ทั้งหมด?\n\n" +

          "สินค้าทั้งหมดจะถูกปิดใช้งานและซ่อนจาก B2B Ordering\n" +

          "ข้อมูลออเดอร์เก่าและประวัติจะไม่ถูกลบ\n\n" +

          "หลังจากรีเซ็ต กรุณาอัปโหลด Master Price ฉบับใหม่"

      );



    if (!confirmed) {

      return;

    }



    setResettingProducts(

      true

    );



    setMasterMessage(

      ""

    );



    setMasterSuccess(

      ""

    );



    try {

      const {

        data,

        error,

      } =

        await supabase.rpc(

          "reset_all_products"

        );



      if (error) {

        throw error;

      }



      const resetCount =

        Number(

          (data as {

            resetCount?: number;

          } | null)

            ?.resetCount ??

            0

        );



      setMasterFileName(

        ""

      );



      setMasterSheetName(

        ""

      );



      setMasterRows(

        []

      );



      setMasterPreview(

        null

      );



      setMasterProgress(

        0

      );



      setMasterProcessed(

        0

      );



      setMasterSuccess(

        `รีเซ็ต Product Master เรียบร้อย ${resetCount.toLocaleString()} รายการ — กรุณาอัปโหลด Master Price ฉบับใหม่`

      );

      setMasterAdjustRevision((current) => current + 1);

    } catch (error) {

      setMasterMessage(

        error instanceof Error

          ? "ไม่สามารถรีเซ็ต Product Master ได้: " +

            error.message

          : "ไม่สามารถรีเซ็ต Product Master ได้"

      );

    } finally {

      setResettingProducts(

        false

      );

    }

  }



  // =====================================================

  // VISIBLE PRODUCT VALUES

  // =====================================================



  const visibleImportRows =

    useMemo<VisibleUploadRow[]>(() => {

      if (

        visibleSkuColumnIndex ===

          null ||

        visibleSalesColumnIndex ===

          null ||

        visibleCategoryColumnIndex ===

          null

      ) {

        return [];

      }



      return visibleRows

        .map(

          (

            row

          ) => ({

            sku:

              String(

                row[

                  visibleSkuColumnIndex

                ] ??

                  ""

              ).trim(),

            sales_score:

              String(

                row[

                  visibleSalesColumnIndex

                ] ??

                  ""

              ).trim(),

            category:

              String(

                row[

                  visibleCategoryColumnIndex

                ] ??

                  ""

              ).trim(),

          })

        )

        .filter(

          (

            row

          ) =>

            row.sku !==

            ""

        );

    }, [

      visibleRows,

      visibleSkuColumnIndex,

      visibleSalesColumnIndex,

      visibleCategoryColumnIndex,

    ]);

  // Collapse duplicate SKUs BEFORE batching them to Supabase.
  // PostgreSQL cannot execute one INSERT ... ON CONFLICT DO UPDATE
  // statement when the same conflict key appears twice in that statement.
  // Keeping one row per normalized SKU prevents that permanently.
  // If the same SKU appears more than once, keep the row with the
  // highest Sales value. If Sales ties, keep the later row.
  const visibleUniqueImportRows =

    useMemo<VisibleUploadRow[]>(() => {
      const bySku =
        new Map<
          string,
          VisibleUploadRow
        >();

      visibleImportRows.forEach(
        (row) => {
          const key =
            normalizeSku(
              row.sku
            );

          const existing =
            bySku.get(
              key
            );

          if (!existing) {
            bySku.set(
              key,
              row
            );
            return;
          }

          const currentSales =
            Number(
              row.sales_score
                .trim()
                .replace(
                  /,/g,
                  ""
                ) ||
                "0"
            );

          const existingSales =
            Number(
              existing.sales_score
                .trim()
                .replace(
                  /,/g,
                  ""
                ) ||
                "0"
            );

          if (
            Number.isFinite(
              currentSales
            ) &&
            (
              !Number.isFinite(
                existingSales
              ) ||
              currentSales >=
                existingSales
            )
          ) {
            bySku.set(
              key,
              row
            );
          }
        }
      );

      return Array.from(
        bySku.values()
      );
    }, [
      visibleImportRows,
    ]);



  const visibleSkuValues =

    useMemo(

      () =>

        visibleImportRows.map(

          (

            row

          ) =>

            row.sku

        ),

      [

        visibleImportRows,

      ]

    );



  // =====================================================

  // DETECT VISIBLE SKU COLUMN

  // =====================================================



  function detectSkuColumn(

    columnHeaders:

      string[]

  ) {

    const candidates =

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

        (

          header

        ) =>

          header

            .trim()

            .toLowerCase()

      );



    for (

      const candidate of candidates

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

  // DETECT SALES COLUMN

  // =====================================================



  function detectSalesColumn(

    columnHeaders:

      string[]

  ) {

    const candidates =

      [

        "sales",

        "sales score",

        "sales_score",

        "sales value",

        "sales_value",

        "ยอดขาย",

        "ยอดขายสินค้า",

      ];



    const normalized =

      columnHeaders.map(

        (

          header

        ) =>

          header

            .trim()

            .toLowerCase()

      );



    for (

      const candidate of candidates

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

  // DETECT THAI DEPARTMENT / CATEGORY COLUMN

  // =====================================================



  function detectCategoryColumn(

    columnHeaders:

      string[]

  ) {

    const candidates =

      [

        "category",

        "department",

        "department name",

        "department_name",

        "หมวดหมู่",

        "แผนก",

        "แผนกสินค้า",

        "ชื่อแผนก",

      ];



    const normalized =

      columnHeaders.map(

        (

          header

        ) =>

          header

            .trim()

            .toLowerCase()

      );



    for (

      const candidate of candidates

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

  // READ VISIBLE SKU FILE

  // =====================================================



  async function handleVisibleFile(

    file:

      | File

      | undefined

  ) {

    if (!file) {

      return;

    }



    setReadingVisible(

      true

    );



    setVisibleMessage(

      ""

    );



    setVisibleSuccess(

      ""

    );



    setVisiblePreview(

      null

    );



    setVisibleHeaders(

      []

    );



    setVisibleRows(

      []

    );



    setVisibleSkuColumnIndex(

      null

    );



    setVisibleSalesColumnIndex(

      null

    );



    setVisibleCategoryColumnIndex(

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

          ) as any[][];



      if (

        !data ||

        data.length < 2

      ) {

        throw new Error(

          "ไฟล์ไม่มีข้อมูลเพียงพอ"

        );

      }



      const parsedHeaders =

        data[0].map(

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



      const detectedSalesIndex =

        detectSalesColumn(

          parsedHeaders

        );



      const detectedCategoryIndex =

        detectCategoryColumn(

          parsedHeaders

        );



      setVisibleFileName(

        file.name

      );



      setVisibleHeaders(

        parsedHeaders

      );



      setVisibleRows(

        parsedRows

      );



      setVisibleSkuColumnIndex(

        detectedIndex

      );



      setVisibleSalesColumnIndex(

        detectedSalesIndex

      );



      setVisibleCategoryColumnIndex(

        detectedCategoryIndex

      );



      if (

        detectedIndex ===

        null ||

        detectedSalesIndex ===

        null ||

        detectedCategoryIndex ===

        null

      ) {

        setVisibleMessage(

          "อ่านไฟล์สำเร็จ แต่ไม่พบคอลัมน์ SKU, Sales หรือแผนกสินค้าอัตโนมัติ กรุณาเลือกคอลัมน์ด้านล่าง"

        );

      }

    } catch (error) {

      setVisibleMessage(

        error instanceof Error

          ? error.message

          : "ไม่สามารถอ่านไฟล์ได้"

      );

    } finally {

      setReadingVisible(

        false

      );

    }

  }



  // =====================================================

  // VISIBLE PRODUCT API HELPER

  // =====================================================

  async function callVisibleProductsAdminApi(
    body: Record<string, unknown>
  ) {
    const {
      data: { session },
      error: sessionError,
    } =
      await supabase.auth.getSession();

    if (
      sessionError ||
      !session?.access_token
    ) {
      throw new Error(
        "กรุณาเข้าสู่ระบบ OMS ใหม่อีกครั้ง"
      );
    }

    const response =
      await fetch(
        "/api/admin/catalog/visible-products",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${session.access_token}`,
          },
          body:
            JSON.stringify(body),
        }
      );

    const result =
      (await response.json()) as {
        error?: string;
        matchedKeys?: string[];
        matchedCount?: number;
        updatedCount?: number;
        items?: {
          id: string;
          catalogue_sku_key: string | null;
        }[];
        nextCursor?: string | null;
        done?: boolean;
      };

    if (!response.ok) {
      throw new Error(
        result.error ??
          "ไม่สามารถประมวลผลรายการสินค้าได้"
      );
    }

    return result;
  }

  // =====================================================

  // PREVIEW VISIBLE SKU
  //
  // Important: matching is deliberately done in small API
  // batches. We no longer ask Supabase to compare 10k+
  // products in one SQL statement, so statement_timeout is
  // no longer part of the normal import path.

  // =====================================================

  async function previewVisibleImport() {

    if (
      visibleSkuColumnIndex ===
        null ||
      visibleSalesColumnIndex ===
        null ||
      visibleCategoryColumnIndex ===
        null
    ) {
      setVisibleMessage(
        "กรุณาเลือกคอลัมน์ SKU, Sales และแผนกสินค้า"
      );
      return;
    }

    if (
      visibleImportRows.length ===
        0
    ) {
      setVisibleMessage(
        "ไม่พบ SKU ในคอลัมน์ที่เลือก"
      );
      return;
    }

    const invalidSalesCount =
      visibleImportRows.filter(
        (row) => {
          const value =
            row.sales_score
              .trim()
              .replace(
                /,/g,
                ""
              );

          if (value === "") {
            return false;
          }

          return !/^[0-9]+([.][0-9]+)?$/.test(
            value
          );
        }
      ).length;

    const invalidCategoryCount =
      visibleImportRows.filter(
        (row) =>
          row.category.trim() ===
          ""
      ).length;

    const uniqueSkus =
      visibleUniqueImportRows.length;

    const duplicateCount =
      visibleImportRows.length -
      uniqueSkus;

    if (
      invalidSalesCount > 0 ||
      invalidCategoryCount > 0
    ) {
      setVisiblePreview({
        totalRows:
          visibleImportRows.length,
        uniqueSkus,
        duplicateCount,
        matchedCount: 0,
        unmatchedCount: 0,
        invalidSalesCount,
        invalidCategoryCount,
        unmatchedSkus: [],
      });

      setVisibleMessage(
        invalidSalesCount > 0
          ? `พบค่า Sales ไม่ถูกต้อง ${invalidSalesCount.toLocaleString()} รายการ`
          : `พบรายการที่ไม่มีแผนกสินค้า ${invalidCategoryCount.toLocaleString()} รายการ`
      );

      return;
    }

    setPreviewingVisible(
      true
    );
    setVisibleMessage("");
    setVisibleSuccess("");
    setVisiblePreview(null);
    setVisibleStageProcessed(0);
    setVisibleStageTotal(
      visibleUniqueImportRows.length
    );

    const batchSize = 500;

    try {
      const matchedKeys =
        new Set<string>();

      for (
        let start = 0;
        start <
        visibleUniqueImportRows.length;
        start += batchSize
      ) {
        const batch =
          visibleUniqueImportRows.slice(
            start,
            start + batchSize
          );

        let lastError =
          "ไม่ทราบสาเหตุ";
        let result:
          | Awaited<
              ReturnType<
                typeof callVisibleProductsAdminApi
              >
            >
          | null = null;

        for (
          let attempt = 1;
          attempt <= 3;
          attempt += 1
        ) {
          try {
            result =
              await callVisibleProductsAdminApi({
                action: "match",
                rows: batch,
              });
            break;
          } catch (error) {
            lastError =
              error instanceof Error
                ? error.message
                : "ไม่ทราบสาเหตุ";

            if (attempt < 3) {
              await new Promise(
                (resolve) =>
                  window.setTimeout(
                    resolve,
                    600 * attempt
                  )
              );
            }
          }
        }

        if (!result) {
          throw new Error(
            `ตรวจสอบสินค้าไม่สำเร็จบริเวณรายการ ${(start + 1).toLocaleString()}: ${lastError}`
          );
        }

        (
          result.matchedKeys ??
          []
        ).forEach(
          (key) =>
            matchedKeys.add(key)
        );

        setVisibleStageProcessed(
          Math.min(
            start + batch.length,
            visibleUniqueImportRows.length
          )
        );
      }

      const originalSkuByKey =
        new Map<string, string>();

      visibleUniqueImportRows.forEach(
        (row) => {
          originalSkuByKey.set(
            normalizeSku(row.sku),
            row.sku
          );
        }
      );

      const unmatchedSkus =
        visibleUniqueImportRows
          .filter(
            (row) =>
              !matchedKeys.has(
                normalizeSku(
                  row.sku
                )
              )
          )
          .map(
            (row) =>
              originalSkuByKey.get(
                normalizeSku(
                  row.sku
                )
              ) ??
              row.sku
          );

      setVisiblePreview({
        totalRows:
          visibleImportRows.length,
        uniqueSkus,
        duplicateCount,
        matchedCount:
          matchedKeys.size,
        unmatchedCount:
          unmatchedSkus.length,
        invalidSalesCount: 0,
        invalidCategoryCount: 0,
        unmatchedSkus,
      });

    } catch (
      error: unknown
    ) {
      console.error(
        "Visible product preview failed:",
        error
      );

      setVisibleMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถตรวจสอบรายการสินค้าได้"
      );
    } finally {
      setPreviewingVisible(
        false
      );
    }
  }

  // =====================================================

  // APPLY VISIBLE SKU
  //
  // Apply the new assortment in small batches first, then
  // scan the currently-visible catalogue in pages and hide
  // only products that are not in the new file. This avoids
  // one giant UPDATE and also avoids temporarily emptying the
  // live customer catalogue if an individual request fails.

  // =====================================================

  async function applyVisibleImport() {

    if (!visiblePreview) {
      setVisibleMessage(
        "กรุณากดตรวจสอบรายการสินค้าอีกครั้งก่อนยืนยัน"
      );
      return;
    }

    if (
      visiblePreview.matchedCount ===
        0
    ) {
      setVisibleMessage(
        "ไม่สามารถยืนยันได้ เนื่องจากไม่มี SKU ใดจับคู่กับ Product Master"
      );
      return;
    }

    if (
      visiblePreview
        .invalidSalesCount >
        0
    ) {
      setVisibleMessage(
        "ไม่สามารถยืนยันได้ เนื่องจากมีค่า Sales ที่ไม่ถูกต้อง กรุณาแก้ไขไฟล์ก่อน"
      );
      return;
    }

    if (
      visiblePreview
        .invalidCategoryCount >
        0
    ) {
      setVisibleMessage(
        "ไม่สามารถยืนยันได้ เนื่องจากมี SKU ที่ไม่มีชื่อแผนกภาษาไทย กรุณาแก้ไขไฟล์ก่อน"
      );
      return;
    }

    const confirmed =
      window.confirm(
        `ยืนยันการอัปเดตสินค้าที่แสดงให้ลูกค้า?\n\n` +
          `SKU ที่จับคู่สำเร็จ: ${visiblePreview.matchedCount.toLocaleString()}\n` +
          `SKU ที่หาไม่พบ: ${visiblePreview.unmatchedCount.toLocaleString()}\n` +
          `SKU ซ้ำ: ${visiblePreview.duplicateCount.toLocaleString()}\n\n` +
          `ระบบจะอัปเดตเป็นชุดเล็ก ๆ เพื่อลดปัญหา timeout`
      );

    if (!confirmed) {
      return;
    }

    setApplyingVisible(true);
    setVisibleMessage("");
    setVisibleSuccess("");
    setVisibleStageProcessed(0);
    setVisibleStageTotal(
      visibleUniqueImportRows.length
    );

    const batchSize = 500;

    try {
      // --------------------------------------------------
      // Phase 1: add/update every SKU in the new file.
      // Old visible products stay visible during this phase.
      // --------------------------------------------------
      for (
        let start = 0;
        start <
        visibleUniqueImportRows.length;
        start += batchSize
      ) {
        const batch =
          visibleUniqueImportRows.slice(
            start,
            start + batchSize
          );

        let success = false;
        let lastError =
          "ไม่ทราบสาเหตุ";

        for (
          let attempt = 1;
          attempt <= 3;
          attempt += 1
        ) {
          try {
            await callVisibleProductsAdminApi({
              action: "apply",
              rows: batch,
            });
            success = true;
            break;
          } catch (error) {
            lastError =
              error instanceof Error
                ? error.message
                : "ไม่ทราบสาเหตุ";

            if (attempt < 3) {
              await new Promise(
                (resolve) =>
                  window.setTimeout(
                    resolve,
                    700 * attempt
                  )
              );
            }
          }
        }

        if (!success) {
          throw new Error(
            `อัปเดตสินค้าไม่สำเร็จบริเวณรายการ ${(start + 1).toLocaleString()}: ${lastError}`
          );
        }

        setVisibleStageProcessed(
          Math.min(
            start + batch.length,
            visibleUniqueImportRows.length
          )
        );
      }

      // --------------------------------------------------
      // Phase 2: remove old visible products that are not
      // present in the newly uploaded assortment.
      // --------------------------------------------------
      const keepKeys =
        new Set(
          visibleUniqueImportRows.map(
            (row) =>
              normalizeSku(
                row.sku
              )
          )
        );

      let cursor:
        | string
        | null = null;

      while (true) {
        const page =
          await callVisibleProductsAdminApi({
            action: "list-visible",
            afterId: cursor,
            limit: 500,
          });

        const items =
          page.items ?? [];

        const staleIds =
          items
            .filter(
              (item) => {
                const key =
                  item.catalogue_sku_key ??
                  "";

                return (
                  key !== "" &&
                  !keepKeys.has(key)
                );
              }
            )
            .map(
              (item) =>
                item.id
            );

        if (
          staleIds.length >
          0
        ) {
          await callVisibleProductsAdminApi({
            action: "hide",
            ids: staleIds,
          });
        }

        if (
          page.done ||
          !page.nextCursor
        ) {
          break;
        }

        cursor =
          page.nextCursor;
      }

      setVisibleSuccess(
        `อัปเดตสำเร็จ — สินค้าที่แสดงให้ลูกค้า ${visiblePreview.matchedCount.toLocaleString()} SKU`
      );

    } catch (
      error: unknown
    ) {
      console.error(
        "Visible product batched apply failed:",
        error
      );

      setVisibleMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถอัปเดตรายการสินค้าได้"
      );
    } finally {
      setApplyingVisible(false);
    }
  }

  // =====================================================

  // RESET VISIBLE PRODUCTS

  // =====================================================



  async function resetVisibleProducts() {

    const confirmed =

      window.confirm(

        "รีเซ็ตรายการสินค้าที่แสดงให้ลูกค้าทั้งหมด?\n\n" +

          "สินค้าทุกตัวจะถูกซ่อนจากหน้า B2B Ordering จนกว่าจะอัปโหลดรายการ SKU ใหม่\n\n" +

          "Product Master และราคาสินค้าจะไม่ถูกลบ"

      );



    if (!confirmed) {

      return;

    }



    setResettingVisible(

      true

    );



    setVisibleMessage(

      ""

    );



    setVisibleSuccess(

      ""

    );



    try {

      const {

        data,

        error,

      } =

        await supabase.rpc(

          "reset_all_customer_visible_products"

        );



      if (error) {

        throw error;

      }



      const resetCount =

        Number(

          (data as {

            resetCount?: number;

          } | null)

            ?.resetCount ??

            0

        );



      // Force a fresh file after reset, same idea as special prices.

      setVisibleFileName(

        ""

      );



      setVisibleHeaders(

        []

      );



      setVisibleRows(

        []

      );



      setVisibleSkuColumnIndex(

        null

      );



      setVisibleSalesColumnIndex(

        null

      );



      setVisibleCategoryColumnIndex(

        null

      );



      setVisiblePreview(

        null

      );

      setVisibleSuccess(

        `รีเซ็ตรายการสินค้าที่แสดงเรียบร้อย ${resetCount.toLocaleString()} รายการ — ขณะนี้ยังไม่มีสินค้าแสดงให้ลูกค้า กรุณาอัปโหลดรายการ SKU ใหม่`

      );

    } catch (error) {

      setVisibleMessage(

        error instanceof Error

          ? "ไม่สามารถรีเซ็ตรายการสินค้าได้: " +

            error.message

          : "ไม่สามารถรีเซ็ตรายการสินค้าได้"

      );

    } finally {

      setResettingVisible(

        false

      );

    }

  }



  // =====================================================

  // RESET PRODUCT PICTURES

  // =====================================================



  async function resetAllPictures() {

    const confirmed =

      window.confirm(

        "รีเซ็ตรูปสินค้าทั้งหมด?\n\n" +

          "URL รูปสินค้าทั้งหมดจะถูกล้างออกจาก Product Master\n" +

          "ข้อมูลสินค้า ราคา และรายการสินค้าที่แสดงจะไม่ถูกลบ\n\n" +

          "หลังจากรีเซ็ต กรุณาอัปโหลด Picture Catalog ฉบับใหม่"

      );



    if (!confirmed) {

      return;

    }



    setResettingPictures(

      true

    );



    setPictureResetMessage(

      ""

    );



    setPictureResetSuccess(

      ""

    );



    try {

      const {

        data,

        error,

      } =

        await supabase.rpc(

          "reset_all_product_pictures"

        );



      if (error) {

        throw error;

      }



      const resetCount =

        Number(

          (data as {

            resetCount?: number;

          } | null)

            ?.resetCount ??

            0

        );



      // Remount PictureImportSection so any previously selected
      // file/preview is cleared after reset.

      setPictureResetKey(

        (current) =>

          current + 1

      );



      setPictureResetSuccess(

        `รีเซ็ตรูปสินค้าเรียบร้อย ${resetCount.toLocaleString()} รายการ — กรุณาอัปโหลด Picture Catalog ฉบับใหม่`

      );

    } catch (error) {

      setPictureResetMessage(

        error instanceof Error

          ? "ไม่สามารถรีเซ็ตรูปสินค้าได้: " +

            error.message

          : "ไม่สามารถรีเซ็ตรูปสินค้าได้"

      );

    } finally {

      setResettingPictures(

        false

      );

    }

  }



  // =====================================================

  // ACCESS CHECK

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

    <main className="min-h-screen bg-[#F6F9F9] pb-4 text-[#273C45]">
      <div className="flex h-1.5 bg-[#00A6A6]" aria-hidden="true">
        <div className="ml-auto w-20 bg-[#FFC629]" />
      </div>
      <header className="border-b border-[#DDEAEA] bg-white">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold tracking-wide text-[#007F80]">LOTUS’S B2B · MANAGER</p>
              <h1 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight text-[#273C45] sm:text-3xl">
                จัดการข้อมูลสินค้า
              </h1>
              <p className="mt-1.5 text-sm leading-6 text-[#647782]">
                ราคาและต้นทุน · สินค้าที่แสดง · รูปสินค้า · ราคาพิเศษ
              </p>
            </div>
            <div className="hidden shrink-0 items-center gap-2 rounded-full bg-[#EAF9F8] px-3 py-2 text-xs font-bold text-[#007F80] sm:flex">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#FFC629]" />
              4 หมวดข้อมูล
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
        <section id="catalog-guide" className="mt-4 rounded-xl border border-[#CEEAE7] bg-white px-4 py-3.5 shadow-sm sm:px-5">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFF5D6] text-lg font-extrabold text-[#B27900]">↻</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-extrabold text-[#273C45]">เริ่มจาก Excel ล่าสุดก่อนแก้ไขข้อมูล</h2>
              <p className="mt-1 text-xs leading-5 text-[#617781] sm:text-sm">
                <span className="font-semibold text-[#007F80]">ดาวน์โหลด</span>
                {" → "}เพิ่ม/แก้ไขแถว{" → "}อัปโหลด{" → "}ตรวจสอบและยืนยัน
              </p>
            </div>
          </div>
          <details className="group mt-2 pl-12">
            <summary className="w-fit cursor-pointer text-xs font-bold text-[#007F80] hover:underline">
              ดูคำแนะนำและข้อควรระวัง
            </summary>
            <div className="mt-3 rounded-lg bg-[#F5FAFA] p-3 text-xs leading-6 text-[#4E6470]">
              <ol className="list-decimal space-y-1 pl-4">
                <li>ดาวน์โหลดข้อมูลจริงจากหมวดที่ต้องการ</li>
                <li>เพิ่มหรือแก้ไขใน Excel โดยเก็บแถวเดิมที่ยังต้องใช้งานไว้</li>
                <li>อัปโหลดไฟล์ ตรวจตัวอย่างและ SKU ก่อนยืนยันการนำเข้า</li>
              </ol>
              <p className="mt-2 border-l-2 border-[#FFC629] pl-3 text-[#805F14]">
                หากมีการปรับราย SKU หลังจากดาวน์โหลด ให้ดาวน์โหลดไฟล์ใหม่ก่อนนำเข้า เพื่อป้องกันการเขียนทับข้อมูลล่าสุด
              </p>
            </div>
          </details>
        </section>

        <nav aria-label="ไปยังหมวดจัดการข้อมูล" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <a href="#catalog-master" className="flex min-h-11 items-center gap-2 rounded-xl border border-[#D8E7E7] bg-white px-3 py-2.5 text-sm font-bold text-[#294D53] shadow-sm transition hover:border-[#00A6A6] hover:bg-[#F1FBFA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00A6A6]"><span className="text-xs font-extrabold text-[#007F80]">01</span> ราคาและต้นทุน</a>
          <a href="#catalog-visible" className="flex min-h-11 items-center gap-2 rounded-xl border border-[#D8E7E7] bg-white px-3 py-2.5 text-sm font-bold text-[#294D53] shadow-sm transition hover:border-[#00A6A6] hover:bg-[#F1FBFA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00A6A6]"><span className="text-xs font-extrabold text-[#007F80]">02</span> สินค้าที่แสดง</a>
          <a href="#catalog-pictures" className="flex min-h-11 items-center gap-2 rounded-xl border border-[#D8E7E7] bg-white px-3 py-2.5 text-sm font-bold text-[#294D53] shadow-sm transition hover:border-[#00A6A6] hover:bg-[#F1FBFA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00A6A6]"><span className="text-xs font-extrabold text-[#007F80]">03</span> รูปสินค้า</a>
          <a href="#catalog-special" className="flex min-h-11 items-center gap-2 rounded-xl border border-[#D8E7E7] bg-white px-3 py-2.5 text-sm font-bold text-[#294D53] shadow-sm transition hover:border-[#00A6A6] hover:bg-[#F1FBFA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00A6A6]"><span className="text-xs font-extrabold text-[#007F80]">04</span> ราคาพิเศษ</a>
        </nav>

        <div className="mt-4 space-y-5">

        {/* ================================================= */}

        {/* 1. PRODUCT MASTER */}

        {/* ================================================= */}



        <section id="catalog-master" className="scroll-mt-5 overflow-hidden rounded-2xl border border-[#D8E7E7] bg-white shadow-sm">



          <div className="border-b border-[#DFEEEE] bg-[#F4FBFB] p-4 sm:p-5">



            <div className="flex items-start gap-4">



              <div className="w-9 h-9 rounded-lg bg-[#007F80] text-white flex items-center justify-center font-extrabold shrink-0">

                1

              </div>



              <div>



                <h2 className="text-lg font-bold text-[#273C45]">

                  Product Master และราคาปกติ

                </h2>



                <p className="text-sm text-gray-500 mt-1">

                  จัดการชื่อสินค้า หน่วย ราคาปกติ และต้นทุนราย SKU ทั้งแบบ Excel และรายสินค้า

                </p>



              </div>



            </div>



          </div>



          <div className="p-4 sm:p-5">



            <div className="mb-6">
              <CatalogExportButton
                dataset="master"
                disabled={readingMaster || importingMaster || resettingProducts}
              />
            </div>

            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-extrabold text-[#007F80]">ขั้นตอน 2 · อัปโหลดไฟล์ที่แก้ไข</h3>
              <span className="text-xs text-[#718891]">ตรวจตัวอย่างก่อนยืนยัน</span>
            </div>

            <div className="rounded-xl border border-[#E3EEEE] bg-[#F8FBFB] p-4 text-sm">



              <p className="font-semibold">

                รูปแบบที่ต้องการ

              </p>



              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3 text-gray-600">



                <span>

                  SKU

                </span>



                <span>

                  Product

                </span>



                <span>

                  Unit

                </span>



                <span>

                  Normal Price

                </span>

                <span className="font-semibold text-[#007F80]">Cost (optional)</span>





              </div>



              <p className="text-xs text-gray-400 mt-3">

                รองรับ Cost (ต้นทุนต่อหน่วยเดียวกับราคา) · ทศนิยมเกิน 2 ตำแหน่งจะปัดเป็น 2 ตำแหน่ง · ใส่ N/A หรือ #N/A เพื่อล้างต้นทุนเดิมและแสดง N/A · ช่องว่างจะเก็บต้นทุนเดิมไว้ · ไม่ต้องมีคอลัมน์ Category — หมวดหมู่สินค้าจัดการผ่าน Visible Products เท่านั้น ระบบจะเลือก Sheet ชื่อ “Master Price” ให้อัตโนมัติ

              </p>



            </div>



            <label className="block mt-6">



              <span className="text-sm font-semibold">

                เลือก Master Price

              </span>



              <input

                type="file"

                accept=".xlsx,.xls,.csv"

                disabled={

                  readingMaster ||

                  importingMaster ||

                  resettingProducts

                }

                onChange={(event) =>

                  handleMasterFile(

                    event

                      .target

                      .files?.[0]

                  )

                }

                className="block w-full border rounded-xl px-4 py-4 mt-2 bg-white"

              />



            </label>



            {readingMaster && (



              <div className="mt-5 bg-gray-50 rounded-xl p-4">

                กำลังอ่าน Master Price...

              </div>



            )}



            {masterMessage && (



              <div className="mt-5 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">

                {

                  masterMessage

                }

              </div>



            )}



            {masterSuccess && (



              <div className="mt-5 bg-green-50 border border-green-200 text-green-700 rounded-xl p-4 font-semibold">

                {

                  masterSuccess

                }

              </div>



            )}



            {masterPreview && (



              <div className="mt-6">



                <div className="border rounded-2xl overflow-hidden">



                  <div className="p-5 border-b">



                    <p className="font-bold">

                      {

                        masterFileName

                      }

                    </p>



                    <p className="text-sm text-gray-500 mt-1">

                      Sheet:{" "}

                      {

                        masterSheetName

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

                          masterPreview

                            .totalRows

                            .toLocaleString()

                        }

                      </p>



                    </div>



                    <div className="p-4 border-b md:border-r md:border-b-0">



                      <p className="text-xs text-gray-500">

                        พร้อมนำเข้า

                      </p>



                      <p className="text-2xl font-bold mt-1">

                        {

                          masterPreview

                            .validRows

                            .toLocaleString()

                        }

                      </p>



                    </div>



                    <div className="p-4 border-r">



                      <p className="text-xs text-gray-500">

                        SKU ไม่ซ้ำ

                      </p>



                      <p className="text-2xl font-bold mt-1">

                        {

                          masterPreview

                            .uniqueSkus

                            .toLocaleString()

                        }

                      </p>



                    </div>



                    <div className="p-4 border-r">



                      <p className="text-xs text-gray-500">

                        SKU ซ้ำ

                      </p>



                      <p className="text-2xl font-bold mt-1">

                        {

                          masterPreview

                            .duplicateCount

                            .toLocaleString()

                        }

                      </p>



                    </div>



                    <div className="p-4">



                      <p className="text-xs text-gray-500">

                        ข้อมูลไม่ถูกต้อง

                      </p>



                      <p className="text-2xl font-bold mt-1">

                        {

                          masterPreview

                            .invalidCount

                            .toLocaleString()

                        }

                      </p>



                    </div>



                  </div>



                </div>



                {/* Optional cost values are stored privately and displayed only
                  on the manager customer-price adjustment page. */}
              {/* SAMPLE */}



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

                            Product

                          </th>



                          <th className="text-left p-3">

                            Unit

                          </th>



                          <th className="text-right p-3">

                            ราคา

                          </th>





                        </tr>



                      </thead>



                      <tbody>



                        {masterRows

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



                              <td className="p-3">

                                {

                                  row.product_name

                                }

                              </td>



                              <td className="p-3">

                                {

                                  row.unit

                                }

                              </td>



                              <td className="p-3 text-right whitespace-nowrap">

                                ฿

                                {

                                  row

                                    .normal_price

                                    .toLocaleString()

                                }

                              </td>





                            </tr>



                          ))}



                      </tbody>



                    </table>



                  </div>



                </div>



                {/* INVALID ROWS */}



                {masterPreview

                  .invalidRows

                  .length >

                  0 && (



                  <div className="mt-5 bg-red-50 border border-red-200 rounded-xl p-4">



                    <p className="font-bold text-red-700">

                      แถวที่ไม่สามารถนำเข้าได้

                    </p>



                    <div className="mt-3 space-y-1 text-sm text-red-700">



                      {masterPreview

                        .invalidRows

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

                              row.sku ||

                              "-"

                            }{" "}

                            —{" "}

                            {

                              row.reason

                            }

                          </p>



                        ))}



                    </div>



                  </div>



                )}



                {/* PROGRESS */}



                {importingMaster && (



                  <div className="mt-6">



                    <div className="flex justify-between text-sm">



                      <span>

                        กำลังนำเข้าสินค้า...

                      </span>



                      <span className="font-semibold">

                        {

                          masterProgress

                        }

                        %

                      </span>



                    </div>



                    <div className="w-full bg-gray-200 rounded-full h-3 mt-2 overflow-hidden">



                      <div

                        className="bg-black h-3 rounded-full transition-all"

                        style={{

                          width:

                            `${masterProgress}%`,

                        }}

                      />



                    </div>



                    <p className="text-xs text-gray-500 mt-2">

                      {

                        masterProcessed.toLocaleString()

                      }{" "}

                      /{" "}

                      {

                        masterRows.length.toLocaleString()

                      }{" "}

                      SKU

                    </p>



                  </div>



                )}



                <button

                  type="button"

                  onClick={

                    importMaster

                  }

                  disabled={

                    importingMaster ||

                    resettingProducts ||

                    masterRows.length ===

                      0

                  }

                  className="w-full bg-[#007F80] text-white rounded-xl px-5 py-4 transition hover:bg-[#008F8C] font-semibold mt-6 disabled:opacity-40"

                >

                  {importingMaster

                    ? "กำลังนำเข้า..."

                    : "ยืนยันการนำเข้า Product Master"}

                </button>



              </div>



            )}



          </div>



            <details className="mt-6 rounded-xl border border-[#D8E7E7] bg-[#F4FBFB]">
              <summary className="cursor-pointer px-4 py-4 text-sm font-bold text-[#007F80]">
                ต้องการแก้ไขเพียงสินค้าเดียว? เปิดตัวแก้ไขราคาและต้นทุนราย SKU
              </summary>
              <div className="px-4 pb-4">
            <ManualMasterPriceEditor
              disabled={readingMaster || importingMaster || resettingProducts}
              refreshToken={masterAdjustRevision}
            />
              </div>
            </details>

            <details className="mt-6 rounded-xl border border-amber-200 bg-amber-50/50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-amber-800">
                การจัดการขั้นสูง · รีเซ็ต Product Master ทั้งหมด
              </summary>
              <div className="px-4 pb-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">

              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

                <div>

                  <p className="font-semibold text-red-800">

                    รีเซ็ต Product Master

                  </p>

                  <p className="text-sm text-red-700 mt-1">

                    ปิดใช้งานสินค้าทั้งหมดและซ่อนจาก B2B Ordering โดยไม่ลบออเดอร์เก่าหรือประวัติ

                  </p>

                </div>

                <button

                  type="button"

                  onClick={

                    resetAllProducts

                  }

                  disabled={

                    resettingProducts ||

                    readingMaster ||

                    importingMaster

                  }

                  className="shrink-0 bg-white border border-red-300 text-red-700 rounded-xl px-5 py-3 font-semibold disabled:opacity-40"

                >

                  {resettingProducts

                    ? "กำลังรีเซ็ต..."

                    : "รีเซ็ต Product Master ทั้งหมด"}

                </button>

              </div>

            </div>
              </div>
            </details>

        </section>



        {/* ================================================= */}

        {/* 2. VISIBLE SKU */}

        {/* ================================================= */}



        <section id="catalog-visible" className="scroll-mt-5 overflow-hidden rounded-2xl border border-[#D8E7E7] bg-white shadow-sm">



          <div className="border-b border-[#DFEEEE] bg-[#F4FBFB] p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#007F80] font-bold text-white">
                  2
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-[#273C45]">สินค้าที่แสดงให้ลูกค้า</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    อัปโหลด Excel หรือ CSV ที่มี SKU, Sales และชื่อแผนกภาษาไทย ระบบจะเก็บชื่อแผนกตามไฟล์โดยตรงโดยไม่แปลอีกครั้ง
                  </p>
                </div>
              </div>
              <Link href="/catalog/visibility"
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#91D6CE] bg-[#E7F8F5] px-4 py-2.5 text-sm font-extrabold text-[#007D79] transition hover:bg-[#D8F3EE]">
                <span aria-hidden="true">☷</span>
                จัดการรายการสินค้าเป็นราย SKU
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>

          <div className="p-4 sm:p-5">



            <div className="mb-6">
              <CatalogExportButton
                dataset="visible"
                disabled={readingVisible || previewingVisible || applyingVisible || resettingVisible}
              />
            </div>

            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-extrabold text-[#007F80]">ขั้นตอน 2 · อัปโหลดไฟล์ที่แก้ไข</h3>
              <span className="text-xs text-[#718891]">ตรวจตัวอย่างก่อนยืนยัน</span>
            </div>

            <div className="mb-6 rounded-xl border border-[#E3EEEE] bg-[#F8FBFB] p-4 text-sm">

              <p className="font-semibold">

                รูปแบบที่ต้องการ

              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-gray-600">

                <span>SKU</span>

                <span>Sales</span>

                <span>Department / แผนกสินค้า (ภาษาไทย)</span>

              </div>

              <p className="text-xs text-gray-400 mt-3">

                ตัวอย่างชื่อแผนก: ผักและผลไม้, เนื้อสัตว์และอาหารทะเล, อาหารแช่แข็ง, ของใช้ส่วนบุคคล

              </p>

            </div>



            <label className="block">



              <span className="text-sm font-semibold">

                เลือกไฟล์

              </span>



              <input

                type="file"

                accept=".xlsx,.xls,.csv"

                disabled={

                  readingVisible ||

                  applyingVisible ||

                  resettingVisible

                }

                onChange={(event) =>

                  handleVisibleFile(

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



            {readingVisible && (



              <div className="mt-5 bg-gray-50 rounded-xl p-4">

                กำลังอ่านไฟล์...

              </div>



            )}



            {visibleFileName && (



              <div className="mt-6 border-t pt-6">



                <p className="text-sm text-gray-500">

                  ไฟล์ที่เลือก

                </p>



                <p className="font-semibold mt-1">

                  {

                    visibleFileName

                  }

                </p>



                <p className="text-sm text-gray-500 mt-1">

                  พบข้อมูล{" "}

                  {

                    visibleRows.length.toLocaleString()

                  }{" "}

                  แถว

                </p>



              </div>



            )}



            {visibleHeaders.length >

              0 && (



              <div className="mt-6">



                <label className="block text-sm font-semibold">

                  เลือกคอลัมน์ SKU

                </label>



                <select

                  value={

                    visibleSkuColumnIndex ??

                    ""

                  }

                  onChange={(event) => {

                    const value =

                      event

                        .target

                        .value;



                    setVisibleSkuColumnIndex(

                      value ===

                        ""

                        ? null

                        : Number(

                            value

                          )

                    );



                    setVisiblePreview(

                      null

                    );



                    setVisibleSuccess(

                      ""

                    );

                  }}

                  className="w-full border rounded-xl px-4 py-3 mt-2 bg-white"

                >



                  <option value="">

                    -- เลือกคอลัมน์ --

                  </option>



                  {visibleHeaders.map(

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



            {visibleHeaders.length >

              0 && (



              <div className="mt-4">



                <label className="block text-sm font-semibold">

                  เลือกคอลัมน์ Sales

                </label>



                <select

                  value={

                    visibleSalesColumnIndex ??

                    ""

                  }

                  onChange={(event) => {

                    const value =

                      event

                        .target

                        .value;



                    setVisibleSalesColumnIndex(

                      value ===

                        ""

                        ? null

                        : Number(

                            value

                          )

                    );



                    setVisiblePreview(

                      null

                    );



                    setVisibleSuccess(

                      ""

                    );

                  }}

                  className="w-full border rounded-xl px-4 py-3 mt-2 bg-white"

                >



                  <option value="">

                    -- เลือกคอลัมน์ --

                  </option>



                  {visibleHeaders.map(

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



            {visibleHeaders.length >

              0 && (



              <div className="mt-4">



                <label className="block text-sm font-semibold">

                  เลือกคอลัมน์แผนกสินค้า (ภาษาไทย)

                </label>



                <select

                  value={

                    visibleCategoryColumnIndex ??

                    ""

                  }

                  onChange={(event) => {

                    const value =

                      event

                        .target

                        .value;



                    setVisibleCategoryColumnIndex(

                      value ===

                        ""

                        ? null

                        : Number(

                            value

                          )

                    );



                    setVisiblePreview(

                      null

                    );



                    setVisibleSuccess(

                      ""

                    );

                  }}

                  className="w-full border rounded-xl px-4 py-3 mt-2 bg-white"

                >



                  <option value="">

                    -- เลือกคอลัมน์ --

                  </option>



                  {visibleHeaders.map(

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





            {visibleSkuColumnIndex !==

              null &&

              visibleSalesColumnIndex !==

                null &&

              visibleCategoryColumnIndex !==

                null && (



              <div className="mt-4 bg-gray-50 rounded-xl p-4">



                <p className="text-sm text-gray-500">

                  ตัวอย่างข้อมูลที่อ่านได้

                </p>



                <div className="overflow-x-auto border rounded-xl mt-3 bg-white">



                  <table className="w-full text-sm">



                    <thead className="bg-gray-50">



                      <tr>



                        <th className="text-left p-3">

                          SKU

                        </th>



                        <th className="text-right p-3">

                          Sales

                        </th>



                        <th className="text-left p-3">

                          แผนกสินค้า

                        </th>



                      </tr>



                    </thead>



                    <tbody>



                      {visibleImportRows

                        .slice(

                          0,

                          8

                        )

                        .map(

                          (

                            row,

                            index

                          ) => (



                          <tr

                            key={

                              `${row.sku}-${index}`

                            }

                            className="border-t"

                          >



                            <td className="p-3">

                              {

                                row.sku

                              }

                            </td>



                            <td className="p-3 text-right">

                              {

                                row.sales_score ||

                                "0"

                              }

                            </td>



                            <td className="p-3">

                              {

                                row.category ||

                                "—"

                              }

                            </td>



                          </tr>



                        ))}



                    </tbody>



                  </table>



                </div>



                <p className="text-xs text-gray-400 mt-3">

                  พบ SKU{" "}

                  {

                    visibleImportRows.length.toLocaleString()

                  }{" "}

                  แถวก่อนตรวจสอบกับ Product Master

                </p>



              </div>



            )}



            {visibleHeaders.length >

              0 && (



              <button

                type="button"

                onClick={

                  previewVisibleImport

                }

                disabled={

                  previewingVisible ||

                  resettingVisible ||

                  visibleSkuColumnIndex ===

                    null ||

                  visibleSalesColumnIndex ===

                    null ||

                  visibleCategoryColumnIndex ===

                    null

                }

                className="w-full bg-[#007F80] text-white rounded-xl px-5 py-4 transition hover:bg-[#008F8C] font-semibold mt-6 disabled:opacity-40"

              >

                {previewingVisible

                  ? `กำลังตรวจสอบ ${visibleStageProcessed.toLocaleString()} / ${visibleStageTotal.toLocaleString()}`

                  : "ตรวจสอบรายการสินค้า"}

              </button>



            )}



            {visibleMessage && (



              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mt-5">

                {

                  visibleMessage

                }

              </div>



            )}



            {visibleSuccess && (



              <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-4 mt-5 font-semibold">

                {

                  visibleSuccess

                }

              </div>



            )}



            {visiblePreview && (



              <div className="mt-6 border rounded-2xl overflow-hidden">



                <div className="p-5 border-b">



                  <h3 className="font-bold">

                    ผลการตรวจสอบ

                  </h3>



                  <p className="text-sm text-gray-500 mt-1">

                    ข้อมูลยังไม่ถูกเปลี่ยนแปลงจนกว่าจะกดยืนยัน

                  </p>



                </div>



                <div className="grid grid-cols-2 md:grid-cols-7">



                  <div className="p-4 border-r border-b md:border-b-0">



                    <p className="text-xs text-gray-500">

                      แถวทั้งหมด

                    </p>



                    <p className="text-2xl font-bold mt-1">

                      {

                        visiblePreview

                          .totalRows

                          .toLocaleString()

                      }

                    </p>



                  </div>



                  <div className="p-4 border-b md:border-r md:border-b-0">



                    <p className="text-xs text-gray-500">

                      SKU ไม่ซ้ำ

                    </p>



                    <p className="text-2xl font-bold mt-1">

                      {

                        visiblePreview

                          .uniqueSkus

                          .toLocaleString()

                      }

                    </p>



                  </div>



                  <div className="p-4 border-r">



                    <p className="text-xs text-gray-500">

                      จับคู่สำเร็จ

                    </p>



                    <p className="text-2xl font-bold mt-1">

                      {

                        visiblePreview

                          .matchedCount

                          .toLocaleString()

                      }

                    </p>



                  </div>



                  <div className="p-4 border-r">



                    <p className="text-xs text-gray-500">

                      หาไม่พบ

                    </p>



                    <p className="text-2xl font-bold mt-1">

                      {

                        visiblePreview

                          .unmatchedCount

                          .toLocaleString()

                      }

                    </p>



                  </div>



                  <div className="p-4 border-r">



                    <p className="text-xs text-gray-500">

                      SKU ซ้ำ

                    </p>



                    <p className="text-2xl font-bold mt-1">

                      {

                        visiblePreview

                          .duplicateCount

                          .toLocaleString()

                      }

                    </p>



                  </div>



                  <div className="p-4 border-r">



                    <p className="text-xs text-gray-500">

                      Sales ไม่ถูกต้อง

                    </p>



                    <p className="text-2xl font-bold mt-1">

                      {

                        visiblePreview

                          .invalidSalesCount

                          .toLocaleString()

                      }

                    </p>



                  </div>



                  <div className="p-4">



                    <p className="text-xs text-gray-500">

                      แผนกว่าง

                    </p>



                    <p className="text-2xl font-bold mt-1">

                      {

                        visiblePreview

                          .invalidCategoryCount

                          .toLocaleString()

                      }

                    </p>



                  </div>



                </div>



                {visiblePreview

                  .unmatchedSkus

                  .length >

                  0 && (



                  <div className="border-t p-5">



                    <p className="font-bold">

                      SKU ที่หาไม่พบ

                    </p>



                    <p className="text-sm text-gray-500 mt-1">

                      SKU เหล่านี้ยังไม่มีใน Product Master

                    </p>



                    <div className="flex flex-wrap gap-2 mt-3">



                      {visiblePreview

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



                  </div>



                )}



                <div className="border-t p-5 bg-gray-50">



                  <button

                    type="button"

                    onClick={

                      applyVisibleImport

                    }

                    disabled={

                      applyingVisible ||

                      resettingVisible ||

                      visiblePreview

                        .matchedCount ===

                        0 ||

                      visiblePreview

                        .invalidSalesCount >

                        0 ||

                      visiblePreview

                        .invalidCategoryCount >

                        0

                    }

                    className="w-full bg-[#007F80] text-white rounded-xl px-5 py-4 transition hover:bg-[#008F8C] font-semibold disabled:opacity-40"

                  >

                    {applyingVisible

                      ? `กำลังอัปเดต ${visibleStageProcessed.toLocaleString()} / ${visibleStageTotal.toLocaleString()}`

                      : "ยืนยันการอัปเดต"}

                  </button>



                </div>



              </div>



            )}



          </div>



            <details className="mt-6 rounded-xl border border-amber-200 bg-amber-50/50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-amber-800">
                การจัดการขั้นสูง · ซ่อนสินค้าที่แสดงทั้งหมด
              </summary>
              <div className="px-4 pb-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">

              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

                <div>

                  <p className="font-semibold text-red-800">
                    รีเซ็ตรายการสินค้าที่แสดง
                  </p>

                  <p className="text-sm text-red-700 mt-1">
                    ซ่อนสินค้าที่กำลังแสดงให้ลูกค้าทั้งหมด โดยไม่ลบ Product Master ราคา หรือรูปสินค้า
                  </p>

                </div>

                <button
                  type="button"
                  onClick={
                    resetVisibleProducts
                  }
                  disabled={
                    resettingVisible ||
                    readingVisible ||
                    previewingVisible ||
                    applyingVisible
                  }
                  className="shrink-0 bg-white border border-red-300 text-red-700 rounded-xl px-5 py-3 font-semibold disabled:opacity-40"
                >
                  {resettingVisible
                    ? "กำลังรีเซ็ต..."
                    : "รีเซ็ตรายการที่แสดงทั้งหมด"}
                </button>

              </div>

            </div>
              </div>
            </details>

        </section>



        {/* ================================================= */}

        {/* 3. PICTURE MASTER */}

        {/* ================================================= */}



        <div className="space-y-4">

          <PictureImportSection

            key={

              pictureResetKey

            }

          />

          <details className="rounded-xl border border-amber-200 bg-amber-50/50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-amber-800">
              การจัดการขั้นสูง · รีเซ็ตรูปสินค้าทั้งหมด
            </summary>
            <div className="p-4">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

              <div>

                <p className="font-semibold text-red-800">

                  รีเซ็ตรูปสินค้าทั้งหมด

                </p>

                <p className="text-sm text-red-700 mt-1">

                  ล้างเฉพาะ URL รูปสินค้า โดยไม่ลบ Product Master ราคา หรือรายการสินค้าที่แสดง

                </p>

              </div>

              <button

                type="button"

                onClick={

                  resetAllPictures

                }

                disabled={

                  resettingPictures

                }

                className="shrink-0 bg-white border border-red-300 text-red-700 rounded-xl px-5 py-3 font-semibold disabled:opacity-40"

              >

                {resettingPictures

                  ? "กำลังรีเซ็ต..."

                  : "รีเซ็ตรูปสินค้าทั้งหมด"}

              </button>

            </div>

            {pictureResetMessage && (

              <div className="mt-4 bg-white border border-red-200 text-red-700 rounded-xl p-4">

                {pictureResetMessage}

              </div>

            )}

            {pictureResetSuccess && (

              <div className="mt-4 bg-white border border-green-200 text-green-700 rounded-xl p-4">

                {pictureResetSuccess}

              </div>

            )}

          </div>
            </div>
          </details>




        </div>

        <SpecialPriceImportSection />

        </div>
      </div>

    </main>

  );

}