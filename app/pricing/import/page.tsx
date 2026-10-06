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

type FavouriteExcelRow = {
  Customer?: string | number;
  SKU?: string | number;
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

type ExistingFavourite = {
  id: string;
  customer_id: string;
  product_id: string;
  sort_order: number | null;
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

type FavouritePreviewRow = {
  customer_code: string;
  customer_name: string | null;

  sku: string;
  product_name: string | null;

  customer_id: string | null;
  product_id: string | null;

  sort_order: number;

  action:
    | "Add"
    | "Keep"
    | "Remove";

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

  const [favouriteRows, setFavouriteRows] =
    useState<FavouritePreviewRow[]>([]);

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
    setFavouriteRows([]);

    setFileName(file.name);

    try {
      const buffer =
        await file.arrayBuffer();

      const workbook =
        XLSX.read(buffer, {
          type: "array",
        });

      // ==================================================
      // LOAD CURRENT DATABASE DATA
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
          "Could not load customer prices: " +
            priceError.message
        );

        setLoadingFile(false);
        return;
      }

      const existingCustomerPrices =
        (priceData ??
          []) as ExistingCustomerPrice[];

      const {
        data: favouriteData,
        error: favouriteError,
      } = await supabase
        .from("favourites")
        .select(`
          id,
          customer_id,
          product_id,
          sort_order
        `);

      if (favouriteError) {
        setMessage(
          "Could not load existing favourites: " +
            favouriteError.message
        );

        setLoadingFile(false);
        return;
      }

      const existingFavourites =
        (favouriteData ??
          []) as ExistingFavourite[];

      // ==================================================
      // LOOKUP MAPS
      // ==================================================

      const productBySku =
        new Map<
          string,
          ExistingProduct
        >();

      existingProducts.forEach(
        (product) => {
          productBySku.set(
            String(
              product.sku
            ).trim(),
            product
          );
        }
      );

      const productById =
        new Map<
          string,
          ExistingProduct
        >();

      existingProducts.forEach(
        (product) => {
          productById.set(
            product.id,
            product
          );
        }
      );

      const customerByCode =
        new Map<
          string,
          ExistingCustomer
        >();

      existingCustomers.forEach(
        (customer) => {
          customerByCode.set(
            customer.customer_code
              .trim()
              .toUpperCase(),
            customer
          );
        }
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

      if (
        masterExcelRows.length ===
        0
      ) {
        setMessage(
          'The "Master Price" sheet contains no data.'
        );

        setLoadingFile(false);
        return;
      }

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

      if (specialWorksheet) {
        const specialExcelRows =
          XLSX.utils.sheet_to_json<SpecialExcelRow>(
            specialWorksheet,
            {
              defval: "",
            }
          );

        const specialDuplicateCounter:
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

              specialDuplicateCounter[
                key
              ] =
                (specialDuplicateCounter[
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
                  specialDuplicateCounter[
                    `${customerCode}::${sku}`
                  ] > 1
                ) {
                  error =
                    "Duplicate Customer + SKU";
                }

                const productId =
                  existingProduct?.id ??
                  null;

                const productName =
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

      // ==================================================
      // FAVOURITES SHEET
      // ==================================================

      const favouriteWorksheet =
        workbook.Sheets[
          "Favourites"
        ];

      if (favouriteWorksheet) {
        const favouriteExcelRows =
          XLSX.utils.sheet_to_json<FavouriteExcelRow>(
            favouriteWorksheet,
            {
              defval: "",
            }
          );

        const favouriteDuplicateCounter:
          Record<string, number> =
          {};

        favouriteExcelRows.forEach(
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

              favouriteDuplicateCounter[
                key
              ] =
                (favouriteDuplicateCounter[
                  key
                ] ?? 0) + 1;
            }
          }
        );

        // ----------------------------------------------
        // Customers appearing in this sheet
        // ----------------------------------------------
        // Only these customers will be synchronized.
        // If C003 does not appear at all, C003 is untouched.

        const customerCodesInSheet =
          new Set(
            favouriteExcelRows
              .map((row) =>
                String(
                  row.Customer ??
                    ""
                )
                  .trim()
                  .toUpperCase()
              )
              .filter(Boolean)
          );

        // ----------------------------------------------
        // Desired SKUs by customer
        // ----------------------------------------------

        const desiredSkuMap =
          new Map<
            string,
            Set<string>
          >();

        customerCodesInSheet.forEach(
          (customerCode) => {
            desiredSkuMap.set(
              customerCode,
              new Set()
            );
          }
        );

        // Sort order follows Excel row order
        // within each customer.

        const sortCounter =
          new Map<
            string,
            number
          >();

        const favouritePreview:
          FavouritePreviewRow[] =
          [];

        // ----------------------------------------------
        // ADD / KEEP
        // ----------------------------------------------

        favouriteExcelRows.forEach(
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
              !customerCode &&
              !sku
            ) {
              return;
            }

            const customer =
              customerByCode.get(
                customerCode
              );

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
              favouriteDuplicateCounter[
                `${customerCode}::${sku}`
              ] > 1
            ) {
              error =
                "Duplicate Customer + SKU";
            }

            if (
              customerCode &&
              sku
            ) {
              desiredSkuMap
                .get(
                  customerCode
                )
                ?.add(sku);
            }

            const currentSort =
              (sortCounter.get(
                customerCode
              ) ?? 0) + 1;

            sortCounter.set(
              customerCode,
              currentSort
            );

            const productId =
              existingProduct?.id ??
              null;

            const productName =
              existingProduct
                ?.product_name ??
              masterProduct
                ?.product_name ??
              null;

            let action:
              | "Add"
              | "Keep" =
              "Add";

            if (
              customer &&
              productId
            ) {
              const exists =
                existingFavourites.some(
                  (favourite) =>
                    favourite.customer_id ===
                      customer.id &&
                    favourite.product_id ===
                      productId
                );

              if (exists) {
                action =
                  "Keep";
              }
            }

            favouritePreview.push({
              customer_code:
                customerCode,

              customer_name:
                customer
                  ?.customer_name ??
                null,

              sku,

              product_name:
                productName,

              customer_id:
                customer?.id ??
                null,

              product_id:
                productId,

              sort_order:
                currentSort,

              action,

              valid:
                error === null,

              error,
            });
          }
        );

        // ----------------------------------------------
        // REMOVE
        // ----------------------------------------------
        // Existing favourites are removed ONLY when:
        //
        // 1. That customer appears somewhere in
        //    the Favourites Excel sheet
        //
        // 2. That SKU is NOT present for that customer.
        //
        // Customers completely absent from the sheet
        // remain untouched.
        // ----------------------------------------------

        existingFavourites.forEach(
          (favourite) => {
            const customer =
              existingCustomers.find(
                (item) =>
                  item.id ===
                  favourite.customer_id
              );

            const product =
              productById.get(
                favourite.product_id
              );

            if (
              !customer ||
              !product
            ) {
              return;
            }

            const customerCode =
              customer.customer_code
                .trim()
                .toUpperCase();

            if (
              !customerCodesInSheet.has(
                customerCode
              )
            ) {
              return;
            }

            const desiredSkus =
              desiredSkuMap.get(
                customerCode
              );

            const sku =
              String(
                product.sku
              ).trim();

            if (
              desiredSkus?.has(
                sku
              )
            ) {
              return;
            }

            favouritePreview.push({
              customer_code:
                customerCode,

              customer_name:
                customer.customer_name,

              sku,

              product_name:
                product.product_name,

              customer_id:
                customer.id,

              product_id:
                product.id,

              sort_order:
                favourite.sort_order ??
                0,

              action:
                "Remove",

              valid:
                true,

              error:
                null,
            });
          }
        );

        setFavouriteRows(
          favouritePreview
        );
      } else {
        // No Favourites sheet =
        // do not touch favourites at all.
        setFavouriteRows([]);
      }

      setMessage(
        `Loaded workbook ${file.name}. Review all changes before importing.`
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
  // IMPORT WORKBOOK
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

    const invalidFavourite =
      favouriteRows.filter(
        (row) => !row.valid
      );

    const totalInvalid =
      invalidMaster.length +
      invalidSpecial.length +
      invalidFavourite.length;

    if (
      totalInvalid > 0
    ) {
      setMessage(
        `Import blocked. Fix ${totalInvalid} invalid row(s) first.`
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

    const favouriteRemoveCount =
      favouriteRows.filter(
        (row) =>
          row.action ===
          "Remove"
      ).length;

    let confirmationMessage =
      `Import this workbook?\n\n` +
      `Master Price: ${masterRows.length} row(s)\n` +
      `Customer Price Override: ${specialRows.length} row(s)\n` +
      `Favourites: ${favouriteRows.length} change/keep row(s)`;

    if (
      favouriteRemoveCount >
      0
    ) {
      confirmationMessage +=
        `\n\nWARNING: ${favouriteRemoveCount} favourite(s) will be removed.`;
    }

    const confirmed =
      window.confirm(
        confirmationMessage
      );

    if (!confirmed) {
      return;
    }

    setImporting(true);
    setMessage("");

    // ==================================================
    // STEP 1 — MASTER PRODUCTS
    // ==================================================

    const productsToImport =
      masterRows.map(
        (row) => ({
          sku:
            row.sku,

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
          onConflict:
            "sku",
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
    // ==================================================
    // Important because this workbook may introduce
    // brand-new SKUs that special prices or favourites
    // refer to.
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
        "Products were imported, but the remaining import could not continue: " +
          refreshProductError.message
      );

      setImporting(false);
      return;
    }

    const refreshedProductMap =
      new Map<
        string,
        string
      >();

    (
      refreshedProducts ?? []
    ).forEach((product) => {
      refreshedProductMap.set(
        String(
          product.sku
        ).trim(),
        product.id
      );
    });

    // ==================================================
    // STEP 3 — CUSTOMER SPECIAL PRICES
    // ==================================================

    if (
      specialRows.length >
      0
    ) {
      const pricesToImport: {
        customer_id: string;
        product_id: string;
        agreed_price: number;
        is_active: boolean;
      }[] = [];

      for (
        const row of
        specialRows
      ) {
        const productId =
          refreshedProductMap.get(
            row.sku
          );

        if (
          !productId ||
          !row.customer_id
        ) {
          setMessage(
            `Could not resolve customer price ${row.customer_code} / ${row.sku}.`
          );

          setImporting(false);
          return;
        }

        pricesToImport.push({
          customer_id:
            row.customer_id,

          product_id:
            productId,

          agreed_price:
            row.special_price,

          is_active:
            true,
        });
      }

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
          "Products imported, but customer prices failed: " +
            priceImportError.message
        );

        setImporting(false);
        return;
      }
    }

    // ==================================================
    // STEP 4 — FAVOURITES
    // ==================================================

    if (
      favouriteRows.length >
      0
    ) {
      // -----------------------------------------------
      // ADD + KEEP
      // -----------------------------------------------
      // Keep rows are also upserted because their
      // Excel row order may change sort_order.
      // -----------------------------------------------

      const desiredRows =
        favouriteRows.filter(
          (row) =>
            row.action ===
              "Add" ||
            row.action ===
              "Keep"
        );

      if (
        desiredRows.length >
        0
      ) {
        const favouritesToUpsert: {
          customer_id: string;
          product_id: string;
          sort_order: number;
        }[] = [];

        for (
          const row of
          desiredRows
        ) {
          const productId =
            refreshedProductMap.get(
              row.sku
            );

          if (
            !productId ||
            !row.customer_id
          ) {
            setMessage(
              `Could not resolve favourite ${row.customer_code} / ${row.sku}.`
            );

            setImporting(false);
            return;
          }

          favouritesToUpsert.push({
            customer_id:
              row.customer_id,

            product_id:
              productId,

            sort_order:
              row.sort_order,
          });
        }

        const {
          error:
            favouriteUpsertError,
        } = await supabase
          .from("favourites")
          .upsert(
            favouritesToUpsert,
            {
              onConflict:
                "customer_id,product_id",
            }
          );

        if (
          favouriteUpsertError
        ) {
          setMessage(
            "Favourite import failed: " +
              favouriteUpsertError.message
          );

          setImporting(false);
          return;
        }
      }

      // -----------------------------------------------
      // REMOVE
      // -----------------------------------------------

      const rowsToRemove =
        favouriteRows.filter(
          (row) =>
            row.action ===
            "Remove"
        );

      const removalsByCustomer =
        new Map<
          string,
          string[]
        >();

      rowsToRemove.forEach(
        (row) => {
          if (
            !row.customer_id ||
            !row.product_id
          ) {
            return;
          }

          const current =
            removalsByCustomer.get(
              row.customer_id
            ) ?? [];

          current.push(
            row.product_id
          );

          removalsByCustomer.set(
            row.customer_id,
            current
          );
        }
      );

      for (
        const [
          customerId,
          productIds,
        ] of
        removalsByCustomer
      ) {
        const {
          error:
            favouriteDeleteError,
        } = await supabase
          .from("favourites")
          .delete()
          .eq(
            "customer_id",
            customerId
          )
          .in(
            "product_id",
            productIds
          );

        if (
          favouriteDeleteError
        ) {
          setMessage(
            "Favourite removal failed: " +
              favouriteDeleteError.message
          );

          setImporting(false);
          return;
        }
      }
    }

    // ==================================================
    // SUCCESS SUMMARY
    // ==================================================

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

    const favouriteAdd =
      favouriteRows.filter(
        (row) =>
          row.action ===
          "Add"
      ).length;

    const favouriteKeep =
      favouriteRows.filter(
        (row) =>
          row.action ===
          "Keep"
      ).length;

    const favouriteRemove =
      favouriteRows.filter(
        (row) =>
          row.action ===
          "Remove"
      ).length;

    setMessage(
      `Import complete. ` +
        `Products: ${masterNew} new, ${masterUpdate} changed, ${masterUnchanged} unchanged. ` +
        `Customer prices: ${specialNew} new, ${specialUpdate} changed, ${specialUnchanged} unchanged. ` +
        `Favourites: ${favouriteAdd} added, ${favouriteKeep} kept, ${favouriteRemove} removed.`
    );

    setImporting(false);
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
    ).length +
    favouriteRows.filter(
      (row) => !row.valid
    ).length;

  const masterNewCount =
    masterRows.filter(
      (row) =>
        row.valid &&
        row.action === "New"
    ).length;

  const masterUpdateCount =
    masterRows.filter(
      (row) =>
        row.valid &&
        row.action === "Update"
    ).length;

  const masterUnchangedCount =
    masterRows.filter(
      (row) =>
        row.valid &&
        row.action ===
          "Unchanged"
    ).length;

  const favouriteAddCount =
    favouriteRows.filter(
      (row) =>
        row.action === "Add"
    ).length;

  const favouriteKeepCount =
    favouriteRows.filter(
      (row) =>
        row.action === "Keep"
    ).length;

  const favouriteRemoveCount =
    favouriteRows.filter(
      (row) =>
        row.action === "Remove"
    ).length;

  return (
    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-7xl mx-auto">

        {/* HEADER */}

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
            Import products, customer prices and favourites from Excel.
          </p>

        </div>

        {/* FILE */}

        <section className="bg-white border rounded-2xl p-6 mb-6">

          <h2 className="font-bold text-lg">
            1. Choose Excel File
          </h2>

          <div className="text-sm text-gray-500 mt-2 space-y-1">

            <p>
              Required sheet:
              {" "}
              <strong>
                Master Price
              </strong>
            </p>

            <p>
              Optional sheet:
              {" "}
              <strong>
                Customer Price Override
              </strong>
            </p>

            <p>
              Optional sheet:
              {" "}
              <strong>
                Favourites
              </strong>
            </p>

          </div>

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

        {/* MESSAGE */}

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6">
            {message}
          </div>
        )}

        {/* MASTER SUMMARY */}

        {masterRows.length >
          0 && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">

            <div className="bg-white border rounded-2xl p-5">

              <p className="text-sm text-gray-500">
                Master Rows
              </p>

              <p className="text-3xl font-bold mt-2">
                {masterRows.length}
              </p>

            </div>

            <div className="bg-white border rounded-2xl p-5">

              <p className="text-sm text-gray-500">
                New Products
              </p>

              <p className="text-3xl font-bold mt-2">
                {masterNewCount}
              </p>

            </div>

            <div className="bg-white border rounded-2xl p-5">

              <p className="text-sm text-gray-500">
                Changed Products
              </p>

              <p className="text-3xl font-bold mt-2">
                {masterUpdateCount}
              </p>

            </div>

            <div className="bg-white border rounded-2xl p-5">

              <p className="text-sm text-gray-500">
                Unchanged Products
              </p>

              <p className="text-3xl font-bold mt-2">
                {masterUnchangedCount}
              </p>

            </div>

          </section>
        )}

        {/* MASTER TABLE */}

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
                          {row.sku ||
                            "—"}
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

                        <td className="p-4 font-medium">
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

        {/* CUSTOMER PRICE OVERRIDES */}

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
                            {row.customer_code}
                          </p>

                          <p className="text-sm text-gray-500">
                            {row.customer_name ??
                              "—"}
                          </p>

                        </td>

                        <td className="p-4">
                          {row.sku ||
                            "—"}
                        </td>

                        <td className="p-4">
                          {row.product_name ??
                            "—"}
                        </td>

                        <td className="p-4 text-right">

                          {row.valid
                            ? `฿${row.special_price.toFixed(
                                2
                              )}`
                            : "—"}

                        </td>

                        <td className="p-4 font-medium">
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

        {/* FAVOURITES */}

        {favouriteRows.length >
          0 && (
          <section className="bg-white border rounded-2xl overflow-hidden mb-6">

            <div className="p-6 border-b">

              <h2 className="font-bold text-lg">
                Favourites
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                Only customers included in the Favourites sheet are synchronized.
              </p>

            </div>

            <div className="grid grid-cols-3 border-b">

              <div className="p-5">

                <p className="text-sm text-gray-500">
                  Add
                </p>

                <p className="text-3xl font-bold mt-1">
                  {favouriteAddCount}
                </p>

              </div>

              <div className="p-5 border-l">

                <p className="text-sm text-gray-500">
                  Keep
                </p>

                <p className="text-3xl font-bold mt-1">
                  {favouriteKeepCount}
                </p>

              </div>

              <div className="p-5 border-l">

                <p className="text-sm text-gray-500">
                  Remove
                </p>

                <p className="text-3xl font-bold mt-1">
                  {favouriteRemoveCount}
                </p>

              </div>

            </div>

            {favouriteRemoveCount >
              0 && (
              <div className="p-4 border-b">
                <strong>
                  ⚠ {favouriteRemoveCount} existing favourite(s) will be removed.
                </strong>
              </div>
            )}

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
                      Order
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

                  {favouriteRows.map(
                    (
                      row,
                      index
                    ) => (

                      <tr
                        key={`${row.customer_code}-${row.sku}-${row.action}-${index}`}
                        className="border-t"
                      >

                        <td className="p-4">

                          <p className="font-semibold">
                            {row.customer_code}
                          </p>

                          <p className="text-sm text-gray-500">
                            {row.customer_name ??
                              "—"}
                          </p>

                        </td>

                        <td className="p-4">
                          {row.sku ||
                            "—"}
                        </td>

                        <td className="p-4">
                          {row.product_name ??
                            "—"}
                        </td>

                        <td className="p-4 text-right">

                          {row.action ===
                          "Remove"
                            ? "—"
                            : row.sort_order}

                        </td>

                        <td className="p-4 font-semibold">

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
                    Fix all {invalidCount} invalid row(s) before importing.
                  </p>
                ) : (
                  <p className="text-gray-500 mt-1">
                    All supplied sheets passed validation.
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