"use client";

import { ChangeEvent, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { supabase } from "../../../lib/supabase";

type ExcelRow = {
  SKU?: string | number;
  Product?: string;
  Unit?: string;
  "Normal Price"?: string | number;
};

type PreviewRow = {
  sku: string;
  product_name: string;
  unit: string;
  normal_price: number;
  action: "New" | "Update";
  valid: boolean;
  error: string | null;
};

export default function PricingImportPage() {
  const [fileName, setFileName] =
    useState("");

  const [rows, setRows] =
    useState<PreviewRow[]>([]);

  const [loadingFile, setLoadingFile] =
    useState(false);

  const [importing, setImporting] =
    useState(false);

  const [message, setMessage] =
    useState("");

  async function handleFile(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file) return;

    setLoadingFile(true);
    setMessage("");
    setRows([]);
    setFileName(file.name);

    try {
      const buffer =
        await file.arrayBuffer();

      const workbook =
        XLSX.read(buffer, {
          type: "array",
        });

      const sheetName =
        "Master Price";

      const worksheet =
        workbook.Sheets[sheetName];

      if (!worksheet) {
        setMessage(
          'The workbook does not contain a sheet called "Master Price".'
        );

        setLoadingFile(false);
        return;
      }

      const excelRows =
        XLSX.utils.sheet_to_json<ExcelRow>(
          worksheet,
          {
            defval: "",
          }
        );

      if (excelRows.length === 0) {
        setMessage(
          'The "Master Price" sheet contains no data.'
        );

        setLoadingFile(false);
        return;
      }

      // Load current products so we know
      // whether each Excel row is NEW or UPDATE.

      const {
        data: existingProducts,
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

      const existingSkuSet =
        new Set(
          (existingProducts ?? []).map(
            (product) =>
              String(product.sku).trim()
          )
        );

      const duplicateCounter:
        Record<string, number> = {};

      excelRows.forEach((row) => {
        const sku =
          String(row.SKU ?? "").trim();

        if (sku) {
          duplicateCounter[sku] =
            (duplicateCounter[sku] ?? 0) +
            1;
        }
      });

      const preview:
        PreviewRow[] =
        excelRows
          .map((row) => {
            const sku =
              String(
                row.SKU ?? ""
              ).trim();

            const productName =
              String(
                row.Product ?? ""
              ).trim();

            const unit =
              String(
                row.Unit ?? ""
              ).trim();

            const rawPrice =
              row["Normal Price"];

            const normalPrice =
              Number(rawPrice);

            let error:
              string | null = null;

            if (!sku) {
              error =
                "Missing SKU";
            } else if (!productName) {
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
              duplicateCounter[
                sku
              ] > 1
            ) {
              error =
                "Duplicate SKU in Excel file";
            }

            return {
              sku,
              product_name:
                productName,
              unit,
              normal_price:
                normalPrice,
              action:
                existingSkuSet.has(
                  sku
                )
                  ? "Update"
                  : "New",
              valid:
                error === null,
              error,
            } as PreviewRow;
          })
          // Ignore completely blank Excel rows
          .filter(
            (row) =>
              row.sku ||
              row.product_name ||
              row.unit
          );

      setRows(preview);

      setMessage(
        `Loaded ${preview.length} product rows from ${file.name}.`
      );
    } catch (error) {
      console.error(error);

      setMessage(
        "Could not read the Excel file."
      );
    }

    setLoadingFile(false);
  }

  async function importProducts() {
    const invalidRows =
      rows.filter(
        (row) => !row.valid
      );

    if (invalidRows.length > 0) {
      setMessage(
        `Import blocked. Fix the ${invalidRows.length} invalid row(s) in Excel first.`
      );

      return;
    }

    if (rows.length === 0) {
      setMessage(
        "There are no products to import."
      );

      return;
    }

    const confirmed =
      window.confirm(
        `Import ${rows.length} products into the database?`
      );

    if (!confirmed) {
      return;
    }

    setImporting(true);
    setMessage("");

    const productsToImport =
      rows.map((row) => ({
        sku: row.sku,
        product_name:
          row.product_name,
        unit: row.unit,
        normal_price:
          row.normal_price,
      }));

    const {
      data,
      error,
    } = await supabase
      .from("products")
      .upsert(
        productsToImport,
        {
          onConflict: "sku",
        }
      )
      .select(`
        id,
        sku
      `);

    if (error) {
      setMessage(
        "Import failed: " +
          error.message
      );

      setImporting(false);
      return;
    }

    if (
      !data ||
      data.length === 0
    ) {
      setMessage(
        "The database did not import any products. Check Supabase permissions."
      );

      setImporting(false);
      return;
    }

    const newCount =
      rows.filter(
        (row) =>
          row.action === "New"
      ).length;

    const updateCount =
      rows.filter(
        (row) =>
          row.action === "Update"
      ).length;

    setMessage(
      `Import complete. ${newCount} new product(s), ${updateCount} updated product(s).`
    );

    setImporting(false);

    // Re-read the same rows conceptually as
    // existing products after successful import.
    setRows(
      rows.map((row) => ({
        ...row,
        action: "Update",
      }))
    );
  }

  const validCount =
    rows.filter(
      (row) => row.valid
    ).length;

  const invalidCount =
    rows.filter(
      (row) => !row.valid
    ).length;

  const newCount =
    rows.filter(
      (row) =>
        row.valid &&
        row.action === "New"
    ).length;

  const updateCount =
    rows.filter(
      (row) =>
        row.valid &&
        row.action === "Update"
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
            Import Product Prices
          </h1>

          <p className="text-gray-500 mt-1">
            Upload the weekly Excel product and master price file.
          </p>

        </div>

        {/* UPLOAD */}

        <section className="bg-white border rounded-2xl p-6 mb-6">

          <h2 className="font-bold text-lg">
            1. Choose Excel File
          </h2>

          <p className="text-sm text-gray-500 mt-1 mb-5">
            The workbook must contain a sheet called
            {" "}
            <strong>Master Price</strong>
            {" "}
            with SKU, Product, Unit and Normal Price columns.
          </p>

          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFile}
            className="block"
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
              Reading Excel file...
            </p>
          )}

        </section>

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6">
            {message}
          </div>
        )}

        {/* SUMMARY */}

        {rows.length > 0 && (
          <>

            <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">

              <div className="bg-white border rounded-2xl p-5">

                <p className="text-sm text-gray-500">
                  Valid Rows
                </p>

                <p className="text-3xl font-bold mt-2">
                  {validCount}
                </p>

              </div>

              <div className="bg-white border rounded-2xl p-5">

                <p className="text-sm text-gray-500">
                  New Products
                </p>

                <p className="text-3xl font-bold mt-2">
                  {newCount}
                </p>

              </div>

              <div className="bg-white border rounded-2xl p-5">

                <p className="text-sm text-gray-500">
                  Updates
                </p>

                <p className="text-3xl font-bold mt-2">
                  {updateCount}
                </p>

              </div>

              <div className="bg-white border rounded-2xl p-5">

                <p className="text-sm text-gray-500">
                  Invalid Rows
                </p>

                <p className="text-3xl font-bold mt-2">
                  {invalidCount}
                </p>

              </div>

            </section>

            {/* PREVIEW */}

            <section className="bg-white border rounded-2xl overflow-hidden mb-6">

              <div className="p-6 border-b">

                <h2 className="font-bold text-lg">
                  2. Preview
                </h2>

                <p className="text-sm text-gray-500 mt-1">
                  Check the file before changing the database.
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
                        Normal Price
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

                    {rows.map(
                      (row, index) => (

                        <tr
                          key={`${row.sku}-${index}`}
                          className="border-t"
                        >

                          <td className="p-4 font-medium">
                            {row.sku || "—"}
                          </td>

                          <td className="p-4">
                            {row.product_name ||
                              "—"}
                          </td>

                          <td className="p-4">
                            {row.unit ||
                              "—"}
                          </td>

                          <td className="p-4 text-right">
                            {row.valid
                              ? `฿${row.normal_price.toFixed(
                                  2
                                )}`
                              : "—"}
                          </td>

                          <td className="p-4">

                            <span className="inline-block bg-gray-100 rounded-full px-3 py-1 text-sm font-medium">

                              {row.action}

                            </span>

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

            {/* IMPORT */}

            <section className="bg-white border rounded-2xl p-6">

              <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">

                <div>

                  <h2 className="font-bold text-lg">
                    3. Import
                  </h2>

                  {invalidCount > 0 ? (
                    <p className="text-red-600 mt-1">
                      Fix all invalid rows before importing.
                    </p>
                  ) : (
                    <p className="text-gray-500 mt-1">
                      All rows passed validation.
                    </p>
                  )}

                </div>

                <button
                  onClick={importProducts}
                  disabled={
                    importing ||
                    invalidCount > 0
                  }
                  className="bg-black text-white rounded-lg px-8 py-3 font-semibold disabled:opacity-30"
                >
                  {importing
                    ? "IMPORTING..."
                    : `IMPORT ${validCount} PRODUCTS`}
                </button>

              </div>

            </section>

          </>
        )}

      </div>

    </main>
  );
}