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

    <main className="min-h-screen bg-gray-100">



      {/* HEADER */}



      <header className="bg-white border-b">



        <div className="max-w-5xl mx-auto px-5 py-6">



          <button

            type="button"

            onClick={() =>

              router.push(

                "/login"

              )

            }

            className="text-sm text-gray-500"

          >

            ← กลับหน้าหลัก

          </button>



          <div className="mt-4">



            <p className="text-sm text-gray-500 font-semibold">

              ผู้จัดการ

            </p>



            <h1 className="text-3xl font-bold mt-1">

              จัดการแคตตาล็อก

            </h1>



            <p className="text-gray-500 mt-2">

              นำเข้าและจัดการ Product Master ราคาปกติ ราคาพิเศษ รูปสินค้า และรายการสินค้าที่แสดงให้ลูกค้า

            </p>



          </div>



        </div>



      </header>



      <div className="max-w-5xl mx-auto p-5 space-y-6">



        {/* ================================================= */}

        {/* 1. SPECIAL CUSTOMER PRICES */}

        {/* ================================================= */}



        <SpecialPriceImportSection />

        {/* ================================================= */}

        {/* 2. PRODUCT MASTER */}

        {/* ================================================= */}



        <section className="bg-white border rounded-2xl overflow-hidden">



          <div className="p-6 border-b">



            <div className="flex items-start gap-4">



              <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center font-bold shrink-0">

                2

              </div>



              <div>



                <h2 className="text-xl font-bold">

                  ข้อมูลสินค้าและราคา

                </h2>



                <p className="text-sm text-gray-500 mt-1">

                  อัปโหลดไฟล์ Master Price เพื่อเพิ่มสินค้าใหม่และอัปเดตข้อมูลสินค้าเดิม

                </p>



              </div>



            </div>



          </div>



          <div className="p-6">



            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">

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



            <div className="bg-gray-50 rounded-xl p-4 text-sm">



              <p className="font-semibold">

                รูปแบบที่ต้องการ

              </p>



              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-gray-600">



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





              </div>



              <p className="text-xs text-gray-400 mt-3">

                ไม่ต้องมีคอลัมน์ Category — หมวดหมู่สินค้าจัดการผ่าน Visible Products เท่านั้น ระบบจะเลือก Sheet ชื่อ “Master Price” ให้อัตโนมัติ

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

                  className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-6 disabled:opacity-40"

                >

                  {importingMaster

                    ? "กำลังนำเข้า..."

                    : "ยืนยันการนำเข้า Product Master"}

                </button>



              </div>



            )}



          </div>



        </section>



        {/* ================================================= */}

        {/* 3. VISIBLE SKU */}

        {/* ================================================= */}



        <section className="bg-white border rounded-2xl overflow-hidden">



          <div className="border-b p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#02B0AF] font-bold text-white">
                  3
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-bold">สินค้าที่แสดงให้ลูกค้า</h2>
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

          <div className="p-6">



            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">

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



            <div className="bg-gray-50 rounded-xl p-4 mb-6 text-sm">

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

                className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-6 disabled:opacity-40"

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

                    className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold disabled:opacity-40"

                  >

                    {applyingVisible

                      ? `กำลังอัปเดต ${visibleStageProcessed.toLocaleString()} / ${visibleStageTotal.toLocaleString()}`

                      : "ยืนยันการอัปเดต"}

                  </button>



                </div>



              </div>



            )}



          </div>



        </section>



        {/* ================================================= */}

        {/* 4. PICTURE MASTER */}

        {/* ================================================= */}



        <div className="space-y-4">

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



          <PictureImportSection

            key={

              pictureResetKey

            }

          />



        </div>





      </div>



    </main>

  );

}