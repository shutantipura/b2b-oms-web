"use client";

import { ChangeEvent, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { supabase } from "../../../lib/supabase";

// ======================================================
// EXCEL INPUT TYPES
// ======================================================

type MasterExcelRow = {
  SKU?: string | number;
  Product?: string;
  Unit?: string;
  "Normal Price"?: string | number;
};

type SpecialExcelRow = {
  Customer?: string | number;
  SKU?: string | number;
  "Special Price"?: string | number;
};

// ======================================================
// DATABASE TYPES
// ======================================================

type ExistingProduct = {
  id: string;
  sku: string;
  product_name: string;
  unit: string;
  normal_price: number | string;
};

type ExistingCustomer = {
  id: string;
  customer_code: string;
  customer_name: string;
};

type ExistingCustomerPrice = {
  id: string;
  customer_id: string;
  product_id: string;
  agreed_price: number | string;
  is_active: boolean;
};

// ======================================================
// PREVIEW TYPES
// ======================================================

type MasterPreviewRow = {
  sku: string;
  product_name: string;
  unit: string;
  normal_price: number;

  action:
    | "New"
    | "Update"
    | "Unchanged";

  valid: boolean;
  error: string | null;
};

type SpecialPreviewRow = {
  customer_code: string;
  customer_name: string | null;

  sku: string;
  product_name: string | null;

  special_price: number;

  customer_id: string | null;
  product_id: string | null;

  action:
    | "New"
    | "Update"
    | "Unchanged";

  valid: boolean;
  error: string | null;
};

export default function PricingImportPage() {
  const [fileName, setFileName] =
    useState("");

  const [masterRows, setMasterRows] =
    useState<MasterPreviewRow[]>([]);

  const [specialRows, setSpecialRows] =
    useState<SpecialPreviewRow[]>([]);

  const [loadingFile, setLoadingFile] =
    useState(false);

  const [importing, setImporting] =
    useState(false);

  const [message, setMessage] =
    useState("");

  // ======================================================
  // READ EXCEL FILE
  // ======================================================

  async function handleFile(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file) return;

    setLoadingFile(true);
    setMessage("");
    setMasterRows([]);
    setSpecialRows([]);
    setFileName(file.name);

    try {
      const buffer =
        await file.arrayBuffer();

      const workbook =
        XLSX.read(buffer, {
          type: "array",
        });

      // ==================================================
      // LOAD DATABASE REFERENCE DATA
      // ==================================================

      const {
        data: productData,
        error: productError,
      } = await supabase
        .from("products")
        .select(`
          id,
          sku,
          product_name,
          unit,
          normal_price
        `);

      if (productError) {
        setMessage(
          "Could not load existing products: " +
            productError.message
        );

        setLoadingFile(false);
        return;
      }

      const existingProducts =
        (productData ??
          []) as ExistingProduct[];

      const {
        data: customerData,
        error: customerError,
      } = await supabase
        .from("customers")
        .select(`
          id,
          customer_code,
          customer_name
        `);

      if (customerError) {
        setMessage(
          "Could not load customers: " +
            customerError.message
        );

        setLoadingFile(false);
        return;
      }

      const existingCustomers =
        (customerData ??
          []) as ExistingCustomer[];

      const {
        data: priceData,
        error: priceError,
      } = await supabase
        .from("customer_prices")
        .select(`
          id,
          customer_id,
          product_id,
          agreed_price,
          is_active
        `);

      if (priceError) {
        setMessage(
          "Could not load existing customer prices: " +
            priceError.message
        );

        setLoadingFile(false);
        return;
      }

      const existingCustomerPrices =
        (priceData ??
          []) as ExistingCustomerPrice[];

      // ==================================================
      // LOOKUP MAPS
      // ==================================================

      const productBySku =
        new Map(
          existingProducts.map(
            (product) => [
              String(
                product.sku
              ).trim(),
              product,
            ]
          )
        );

      const customerByCode =
        new Map(
          existingCustomers.map(
            (customer) => [
              customer.customer_code
                .trim()
                .toUpperCase(),
              customer,
            ]
          )
        );

      const customerPriceMap =
        new Map<
          string,
          ExistingCustomerPrice
        >();

      existingCustomerPrices.forEach(
        (price) => {
          customerPriceMap.set(
            `${price.customer_id}::${price.product_id}`,
            price
          );
        }
      );

      // ==================================================
      // MASTER PRICE SHEET
      // ==================================================

      const masterWorksheet =
        workbook.Sheets[
          "Master Price"
        ];

      if (!masterWorksheet) {
        setMessage(
          'The workbook does not contain a sheet called "Master Price".'
        );

        setLoadingFile(false);
        return;
      }

      const masterExcelRows =
        XLSX.utils.sheet_to_json<MasterExcelRow>(
          masterWorksheet,
          {
            defval: "",
          }
        );

      const masterDuplicateCounter:
        Record<string, number> = {};

      masterExcelRows.forEach(
        (row) => {
          const sku =
            String(
              row.SKU ?? ""
            ).trim();

          if (sku) {
            masterDuplicateCounter[
              sku
            ] =
              (masterDuplicateCounter[
                sku
              ] ?? 0) + 1;
          }
        }
      );

      const masterPreview =
        masterExcelRows
          .map(
            (
              row
            ): MasterPreviewRow => {
              const sku =
                String(
                  row.SKU ?? ""
                ).trim();

              const productName =
                String(
                  row.Product ??
                    ""
                ).trim();

              const unit =
                String(
                  row.Unit ?? ""
                ).trim();

              const rawPrice =
                row[
                  "Normal Price"
                ];

              const normalPrice =
                Number(rawPrice);

              let error:
                string | null =
                null;

              if (!sku) {
                error =
                  "Missing SKU";
              } else if (
                !productName
              ) {
                error =
                  "Missing product name";
              } else if (!unit) {
                error =
                  "Missing unit";
              } else if (
                rawPrice === "" ||
                Number.isNaN(
                  normalPrice
                ) ||
                normalPrice < 0
              ) {
                error =
                  "Invalid normal price";
              } else if (
                masterDuplicateCounter[
                  sku
                ] > 1
              ) {
                error =
                  "Duplicate SKU in Master Price";
              }

              const existing =
                productBySku.get(
                  sku
                );

              let action:
                | "New"
                | "Update"
                | "Unchanged" =
                "New";

              if (existing) {
                const same =
                  existing.product_name ===
                    productName &&
                  existing.unit ===
                    unit &&
                  Number(
                    existing.normal_price
                  ) === normalPrice;

                action =
                  same
                    ? "Unchanged"
                    : "Update";
              }

              return {
                sku,
                product_name:
                  productName,
                unit,
                normal_price:
                  normalPrice,

                action,

                valid:
                  error === null,

                error,
              };
            }
          )
          .filter(
            (row) =>
              row.sku ||
              row.product_name ||
              row.unit
          );

      setMasterRows(
        masterPreview
      );

      // ==================================================
      // CUSTOMER PRICE OVERRIDE SHEET
      // ==================================================

      const specialWorksheet =
        workbook.Sheets[
          "Customer Price Override"
        ];

      if (
        specialWorksheet
      ) {
        const specialExcelRows =
          XLSX.utils.sheet_to_json<SpecialExcelRow>(
            specialWorksheet,
            {
              defval: "",
            }
          );

        const duplicateCounter:
          Record<string, number> =
          {};

        specialExcelRows.forEach(
          (row) => {
            const customerCode =
              String(
                row.Customer ??
                  ""
              )
                .trim()
                .toUpperCase();

            const sku =
              String(
                row.SKU ?? ""
              ).trim();

            if (
              customerCode &&
              sku
            ) {
              const key =
                `${customerCode}::${sku}`;

              duplicateCounter[
                key
              ] =
                (duplicateCounter[
                  key
                ] ?? 0) + 1;
            }
          }
        );

        const specialPreview =
          specialExcelRows
            .map(
              (
                row
              ): SpecialPreviewRow => {
                const customerCode =
                  String(
                    row.Customer ??
                      ""
                  )
                    .trim()
                    .toUpperCase();

                const sku =
                  String(
                    row.SKU ?? ""
                  ).trim();

                const rawPrice =
                  row[
                    "Special Price"
                  ];

                const specialPrice =
                  Number(rawPrice);

                const customer =
                  customerByCode.get(
                    customerCode
                  );

                // Product may already
                // exist in DB, OR be a
                // new SKU in this same
                // Excel Master sheet.
                const existingProduct =
                  productBySku.get(
                    sku
                  );

                const masterProduct =
                  masterPreview.find(
                    (master) =>
                      master.sku ===
                      sku &&
                      master.valid
                  );

                let error:
                  string | null =
                  null;

                if (
                  !customerCode
                ) {
                  error =
                    "Missing customer code";
                } else if (
                  !customer
                ) {
                  error =
                    "Customer does not exist";
                } else if (!sku) {
                  error =
                    "Missing SKU";
                } else if (
                  !existingProduct &&
                  !masterProduct
                ) {
                  error =
                    "SKU does not exist";
                } else if (
                  rawPrice === "" ||
                  Number.isNaN(
                    specialPrice
                  ) ||
                  specialPrice < 0
                ) {
                  error =
                    "Invalid special price";
                } else if (
                  duplicateCounter[
                    `${customerCode}::${sku}`
                  ] > 1
                ) {
                  error =
                    "Duplicate Customer + SKU";
                }

                let productId:
                  string | null =
                  existingProduct?.id ??
                  null;

                let productName:
                  string | null =
                  existingProduct
                    ?.product_name ??
                  masterProduct
                    ?.product_name ??
                  null;

                let action:
                  | "New"
                  | "Update"
                  | "Unchanged" =
                  "New";

                if (
                  customer &&
                  productId
                ) {
                  const existingPrice =
                    customerPriceMap.get(
                      `${customer.id}::${productId}`
                    );

                  if (
                    existingPrice
                  ) {
                    const same =
                      existingPrice.is_active &&
                      Number(
                        existingPrice.agreed_price
                      ) ===
                        specialPrice;

                    action =
                      same
                        ? "Unchanged"
                        : "Update";
                  }
                }

                return {
                  customer_code:
                    customerCode,

                  customer_name:
                    customer
                      ?.customer_name ??
                    null,

                  sku,

                  product_name:
                    productName,

                  special_price:
                    specialPrice,

                  customer_id:
                    customer?.id ??
                    null,

                  product_id:
                    productId,

                  action,

                  valid:
                    error === null,

                  error,
                };
              }
            )
            .filter(
              (row) =>
                row.customer_code ||
                row.sku
            );

        setSpecialRows(
          specialPreview
        );
      } else {
        setSpecialRows([]);
      }

      setMessage(
        `Loaded workbook ${file.name}. Review the preview before importing.`
      );
    } catch (error) {
      console.error(error);

      setMessage(
        "Could not read the Excel file."
      );
    }

    setLoadingFile(false);
  }

  // ======================================================
  // IMPORT
  // ======================================================

  async function importWorkbook() {
    const invalidMaster =
      masterRows.filter(
        (row) => !row.valid
      );

    const invalidSpecial =
      specialRows.filter(
        (row) => !row.valid
      );

    if (
      invalidMaster.length >
        0 ||
      invalidSpecial.length >
        0
    ) {
      setMessage(
        `Import blocked. Fix ${
          invalidMaster.length +
          invalidSpecial.length
        } invalid row(s) first.`
      );

      return;
    }

    if (
      masterRows.length ===
      0
    ) {
      setMessage(
        "There are no products to import."
      );

      return;
    }

    const confirmed =
      window.confirm(
        `Import ${masterRows.length} master product rows and ${specialRows.length} customer price rows?`
      );

    if (!confirmed) {
      return;
    }

    setImporting(true);
    setMessage("");

    // ==================================================
    // STEP 1 — PRODUCTS
    // ==================================================

    const productsToImport =
      masterRows.map(
        (row) => ({
          sku: row.sku,

          product_name:
            row.product_name,

          unit:
            row.unit,

          normal_price:
            row.normal_price,
        })
      );

    const {
      error:
        productImportError,
    } = await supabase
      .from("products")
      .upsert(
        productsToImport,
        {
          onConflict: "sku",
        }
      );

    if (
      productImportError
    ) {
      setMessage(
        "Product import failed: " +
          productImportError.message
      );

      setImporting(false);
      return;
    }

    // ==================================================
    // STEP 2 — RELOAD PRODUCTS
    // Important because Excel may have introduced
    // brand-new SKUs.
    // ==================================================

    const {
      data:
        refreshedProducts,
      error:
        refreshProductError,
    } = await supabase
      .from("products")
      .select(`
        id,
        sku
      `);

    if (
      refreshProductError
    ) {
      setMessage(
        "Products were imported, but customer prices could not be prepared: " +
          refreshProductError.message
      );

      setImporting(false);
      return;
    }

    const refreshedProductMap =
      new Map(
        (
          refreshedProducts ??
          []
        ).map(
          (product) => [
            String(
              product.sku
            ).trim(),
            product.id,
          ]
        )
      );

    // ==================================================
    // STEP 3 — SPECIAL PRICES
    // ==================================================

    if (
      specialRows.length >
      0
    ) {
      const pricesToImport =
        specialRows.map(
          (row) => {
            const productId =
              refreshedProductMap.get(
                row.sku
              );

            if (
              !productId ||
              !row.customer_id
            ) {
              throw new Error(
                `Could not resolve ${row.customer_code} / ${row.sku}.`
              );
            }

            return {
              customer_id:
                row.customer_id,

              product_id:
                productId,

              agreed_price:
                row.special_price,

              is_active:
                true,
            };
          }
        );

      const {
        error:
          priceImportError,
      } = await supabase
        .from(
          "customer_prices"
        )
        .upsert(
          pricesToImport,
          {
            onConflict:
              "customer_id,product_id",
          }
        );

      if (
        priceImportError
      ) {
        setMessage(
          "Products were imported, but customer prices failed: " +
            priceImportError.message
        );

        setImporting(false);
        return;
      }
    }

    const masterNew =
      masterRows.filter(
        (row) =>
          row.action ===
          "New"
      ).length;

    const masterUpdate =
      masterRows.filter(
        (row) =>
          row.action ===
          "Update"
      ).length;

    const masterUnchanged =
      masterRows.filter(
        (row) =>
          row.action ===
          "Unchanged"
      ).length;

    const specialNew =
      specialRows.filter(
        (row) =>
          row.action ===
          "New"
      ).length;

    const specialUpdate =
      specialRows.filter(
        (row) =>
          row.action ===
          "Update"
      ).length;

    const specialUnchanged =
      specialRows.filter(
        (row) =>
          row.action ===
          "Unchanged"
      ).length;

    setMessage(
      `Import complete. Products: ${masterNew} new, ${masterUpdate} changed, ${masterUnchanged} unchanged. Customer prices: ${specialNew} new, ${specialUpdate} changed, ${specialUnchanged} unchanged.`
    );

    setImporting(false);

    // Everything now exists in DB.
    setMasterRows(
      masterRows.map(
        (row) => ({
          ...row,
          action:
            "Unchanged",
        })
      )
    );

    setSpecialRows(
      specialRows.map(
        (row) => ({
          ...row,
          action:
            "Unchanged",
        })
      )
    );
  }

  // ======================================================
  // COUNTS
  // ======================================================

  const invalidCount =
    masterRows.filter(
      (row) => !row.valid
    ).length +
    specialRows.filter(
      (row) => !row.valid
    ).length;

  return (
    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-7xl mx-auto">

        <div className="mb-8">

          <Link
            href="/pricing"
            className="text-gray-500"
          >
            ← Back to Pricing
          </Link>

          <h1 className="text-3xl font-bold mt-3">
            Import Catalogue
          </h1>

          <p className="text-gray-500 mt-1">
            Import master products and customer-specific prices from Excel.
          </p>

        </div>

        {/* FILE */}

        <section className="bg-white border rounded-2xl p-6 mb-6">

          <h2 className="font-bold text-lg">
            1. Choose Excel File
          </h2>

          <p className="text-sm text-gray-500 mt-2">
            Required sheet:
            {" "}
            <strong>
              Master Price
            </strong>
          </p>

          <p className="text-sm text-gray-500">
            Optional sheet:
            {" "}
            <strong>
              Customer Price Override
            </strong>
          </p>

          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={
              handleFile
            }
            className="block mt-5"
          />

          {fileName && (
            <p className="mt-4 text-sm">
              Selected:
              {" "}
              <strong>
                {fileName}
              </strong>
            </p>
          )}

          {loadingFile && (
            <p className="mt-4">
              Reading workbook...
            </p>
          )}

        </section>

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6">
            {message}
          </div>
        )}

        {/* MASTER */}

        {masterRows.length >
          0 && (
          <section className="bg-white border rounded-2xl overflow-hidden mb-6">

            <div className="p-6 border-b">

              <h2 className="font-bold text-lg">
                Master Price
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                Products and normal prices.
              </p>

            </div>

            <div className="overflow-x-auto">

              <table className="w-full">

                <thead className="bg-gray-50">

                  <tr>

                    <th className="p-4 text-left">
                      SKU
                    </th>

                    <th className="p-4 text-left">
                      Product
                    </th>

                    <th className="p-4 text-left">
                      Unit
                    </th>

                    <th className="p-4 text-right">
                      Price
                    </th>

                    <th className="p-4 text-left">
                      Action
                    </th>

                    <th className="p-4 text-left">
                      Validation
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {masterRows.map(
                    (
                      row,
                      index
                    ) => (

                      <tr
                        key={`${row.sku}-${index}`}
                        className="border-t"
                      >

                        <td className="p-4 font-medium">
                          {row.sku}
                        </td>

                        <td className="p-4">
                          {
                            row.product_name
                          }
                        </td>

                        <td className="p-4">
                          {row.unit}
                        </td>

                        <td className="p-4 text-right">
                          ฿
                          {row.normal_price.toFixed(
                            2
                          )}
                        </td>

                        <td className="p-4">
                          {row.action}
                        </td>

                        <td className="p-4">
                          {row.valid
                            ? "✓ Valid"
                            : row.error}
                        </td>

                      </tr>

                    )
                  )}

                </tbody>

              </table>

            </div>

          </section>
        )}

        {/* CUSTOMER PRICES */}

        {specialRows.length >
          0 && (
          <section className="bg-white border rounded-2xl overflow-hidden mb-6">

            <div className="p-6 border-b">

              <h2 className="font-bold text-lg">
                Customer Price Overrides
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                Customer-specific agreed prices.
              </p>

            </div>

            <div className="overflow-x-auto">

              <table className="w-full">

                <thead className="bg-gray-50">

                  <tr>

                    <th className="p-4 text-left">
                      Customer
                    </th>

                    <th className="p-4 text-left">
                      SKU
                    </th>

                    <th className="p-4 text-left">
                      Product
                    </th>

                    <th className="p-4 text-right">
                      Special Price
                    </th>

                    <th className="p-4 text-left">
                      Action
                    </th>

                    <th className="p-4 text-left">
                      Validation
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {specialRows.map(
                    (
                      row,
                      index
                    ) => (

                      <tr
                        key={`${row.customer_code}-${row.sku}-${index}`}
                        className="border-t"
                      >

                        <td className="p-4">

                          <p className="font-semibold">
                            {
                              row.customer_code
                            }
                          </p>

                          <p className="text-sm text-gray-500">
                            {
                              row.customer_name ??
                              "—"
                            }
                          </p>

                        </td>

                        <td className="p-4">
                          {row.sku}
                        </td>

                        <td className="p-4">
                          {
                            row.product_name ??
                            "—"
                          }
                        </td>

                        <td className="p-4 text-right">
                          ฿
                          {row.special_price.toFixed(
                            2
                          )}
                        </td>

                        <td className="p-4">
                          {row.action}
                        </td>

                        <td className="p-4">

                          {row.valid ? (
                            <span>
                              ✓ Valid
                            </span>
                          ) : (
                            <span className="text-red-600 font-medium">
                              {row.error}
                            </span>
                          )}

                        </td>

                      </tr>

                    )
                  )}

                </tbody>

              </table>

            </div>

          </section>
        )}

        {/* IMPORT */}

        {masterRows.length >
          0 && (
          <section className="bg-white border rounded-2xl p-6">

            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">

              <div>

                <h2 className="font-bold text-lg">
                  Import Workbook
                </h2>

                {invalidCount >
                0 ? (
                  <p className="text-red-600 mt-1">
                    Fix all {invalidCount} invalid row(s) first.
                  </p>
                ) : (
                  <p className="text-gray-500 mt-1">
                    Validation passed.
                  </p>
                )}

              </div>

              <button
                onClick={
                  importWorkbook
                }
                disabled={
                  importing ||
                  invalidCount >
                    0
                }
                className="bg-black text-white rounded-lg px-8 py-3 font-semibold disabled:opacity-30"
              >
                {importing
                  ? "IMPORTING..."
                  : "IMPORT WORKBOOK"}
              </button>

            </div>

          </section>
        )}

      </div>

    </main>
  );
}