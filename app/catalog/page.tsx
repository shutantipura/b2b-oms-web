"use client";



import {

  useEffect,

  useMemo,

  useState,

} from "react";



import {

  useRouter,

} from "next/navigation";



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

  unmatchedSkus: string[];

};



type VisibleApplyResult = {

  success: boolean;

  matchedCount: number;

  visibleProductCount: number;

};



type MasterProduct = {

  sku: string;

  product_name: string;

  unit: string;

  normal_price: number;

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

            "import_product_master_batch",

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

  // VISIBLE SKU VALUES

  // =====================================================



  const visibleSkuValues =

    useMemo(() => {

      if (

        visibleSkuColumnIndex ===

        null

      ) {

        return [];

      }



      return visibleRows

        .map(

          (

            row

          ) =>

            row[

              visibleSkuColumnIndex

            ]

        )

        .filter(

          (

            value

          ) =>

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

          (

            value

          ) =>

            String(

              value

            ).trim()

        );

    }, [

      visibleRows,

      visibleSkuColumnIndex,

    ]);



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



      if (

        detectedIndex ===

        null

      ) {

        setVisibleMessage(

          "อ่านไฟล์สำเร็จ แต่ไม่พบคอลัมน์ SKU อัตโนมัติ กรุณาเลือกคอลัมน์ด้านล่าง"

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

  // PREVIEW VISIBLE SKU

  // =====================================================



  async function previewVisibleImport() {

    if (

      visibleSkuColumnIndex ===

        null

    ) {

      setVisibleMessage(

        "กรุณาเลือกคอลัมน์ SKU"

      );



      return;

    }



    if (

      visibleSkuValues.length ===

        0

    ) {

      setVisibleMessage(

        "ไม่พบ SKU ในคอลัมน์ที่เลือก"

      );



      return;

    }



    setPreviewingVisible(

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

          "preview_customer_visible_skus",

          {

            p_skus:

              visibleSkuValues,

          }

        );



      if (error) {

        throw error;

      }



      setVisiblePreview(

        data as VisiblePreviewResult

      );

    } catch (error) {

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

  // =====================================================



  async function applyVisibleImport() {

    if (

      !visiblePreview ||

      visibleSkuValues.length ===

        0

    ) {

      return;

    }



    if (

      visiblePreview

        .matchedCount ===

        0

    ) {

      setVisibleMessage(

        "ไม่สามารถยืนยันได้ เนื่องจากไม่มี SKU ใดจับคู่กับ Product Master"

      );



      return;

    }



    const confirmed =

      window.confirm(

        `ยืนยันการอัปเดตสินค้าที่แสดงให้ลูกค้า?\n\n` +

          `SKU ที่จับคู่สำเร็จ: ${visiblePreview.matchedCount.toLocaleString()}\n` +

          `SKU ที่หาไม่พบ: ${visiblePreview.unmatchedCount.toLocaleString()}\n\n` +

          `รายการสินค้าที่แสดงอยู่เดิมจะถูกแทนที่ด้วยรายการใหม่นี้`

      );



    if (

      !confirmed

    ) {

      return;

    }



    setApplyingVisible(

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

          "apply_customer_visible_skus",

          {

            p_skus:

              visibleSkuValues,

          }

        );



      if (error) {

        throw error;

      }



      const result =

        data as VisibleApplyResult;



      setVisibleSuccess(

        `อัปเดตสำเร็จ — สินค้าที่แสดงให้ลูกค้า ${result.visibleProductCount.toLocaleString()} รายการ`

      );

    } catch (error) {

      setVisibleMessage(

        error instanceof Error

          ? error.message

          : "ไม่สามารถอัปเดตรายการสินค้าได้"

      );

    } finally {

      setApplyingVisible(

        false

      );

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

                "/"

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

        {/* 1. PRODUCT MASTER */}

        {/* ================================================= */}



        <section className="bg-white border rounded-2xl overflow-hidden">



          <div className="p-6 border-b">



            <div className="flex items-start gap-4">



              <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center font-bold shrink-0">

                1

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

                ระบบจะเลือก Sheet ชื่อ “Master Price” ให้อัตโนมัติ

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

        {/* 2. PICTURE MASTER */}

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



        {/* ================================================= */}

        {/* 3. VISIBLE SKU */}

        {/* ================================================= */}



        <section className="bg-white border rounded-2xl overflow-hidden">



          <div className="p-6 border-b">



            <div className="flex items-start gap-4">



              <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center font-bold shrink-0">

                3

              </div>



              <div>



                <h2 className="text-xl font-bold">

                  สินค้าที่แสดงให้ลูกค้า

                </h2>



                <p className="text-sm text-gray-500 mt-1">

                  อัปโหลด Excel หรือ CSV ที่มีรายการ SKU ที่ต้องการแสดงบน B2B Ordering

                </p>



              </div>



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



            {visibleSkuColumnIndex !==

              null && (



              <div className="mt-4 bg-gray-50 rounded-xl p-4">



                <p className="text-sm text-gray-500">

                  ตัวอย่าง SKU ที่อ่านได้

                </p>



                <div className="flex flex-wrap gap-2 mt-2">



                  {visibleSkuValues

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

                  พบ SKU{" "}

                  {

                    visibleSkuValues.length.toLocaleString()

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

                    null

                }

                className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-6 disabled:opacity-40"

              >

                {previewingVisible

                  ? "กำลังตรวจสอบ..."

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



                <div className="grid grid-cols-2 md:grid-cols-5">



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



                  <div className="p-4">



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

                        0

                    }

                    className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold disabled:opacity-40"

                  >

                    {applyingVisible

                      ? "กำลังอัปเดต..."

                      : "ยืนยันการอัปเดต"}

                  </button>



                </div>



              </div>



            )}



          </div>



        </section>



        {/* ================================================= */}

        {/* 4. SPECIAL CUSTOMER PRICES */}

        {/* ================================================= */}



        <SpecialPriceImportSection />



      </div>



    </main>

  );

}