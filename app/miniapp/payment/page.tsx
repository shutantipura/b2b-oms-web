"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type DisplayFile = {
  fileType: string;
  name: string;
  mimeType:
    | string
    | null;
  url: string;
};

type PaymentResponse = {
  customer?: {
    customerCode: string;
    customerName: string;
  };

  order?: {
    orderNumber: number;
    status: string;

    finalAmount:
      | number
      | null;

    deliveryDate:
      | string
      | null;

    deliverySlot:
      | string
      | null;
  };

  files?: {
    bill:
      | DisplayFile
      | null;

    paymentQr:
      | DisplayFile
      | null;

    deliveryProof:
      | DisplayFile
      | null;

    paymentSlip:
      | DisplayFile
      | null;
  };

  success?: boolean;
  error?: string;
};

function isImage(
  file:
    | DisplayFile
    | null
) {
  return Boolean(
    file?.mimeType?.startsWith(
      "image/"
    )
  );
}

function prettyStatus(
  status: string
) {
  const map:
    Record<
      string,
      string
    > = {
    awaiting_payment:
      "Awaiting Payment",

    payment_submitted:
      "Payment Submitted",

    completed:
      "Payment Verified",
  };

  return (
    map[status] ??
    status
  );
}

export default function MiniAppPaymentPage() {
  const router =
    useRouter();

  const [
    customerCode,
    setCustomerCode,
  ] =
    useState("");

  const [
    idToken,
    setIdToken,
  ] =
    useState("");

  const [
    data,
    setData,
  ] =
    useState<PaymentResponse | null>(
      null
    );

  const [
    slipFile,
    setSlipFile,
  ] =
    useState<File | null>(
      null
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

  // =====================================================
  // LOAD PAYMENT
  // =====================================================

  async function loadPayment(
    token: string,
    code: string,
    orderNumber: number
  ) {
    const response =
      await fetch(
        "/api/line/payment",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              idToken:
                token,

              customerCode:
                code,

              orderNumber,
            }),
        }
      );

    const result =
      (await response.json()) as PaymentResponse;

    if (
      !response.ok
    ) {
      throw new Error(
        result.error ??
          "Could not load payment."
      );
    }

    setData(
      result
    );
  }

  // =====================================================
  // INITIALIZE LINE
  // =====================================================

  useEffect(() => {
    let cancelled =
      false;

    async function initialize() {
      try {
        const params =
          new URLSearchParams(
            window.location.search
          );

        const code =
          (
            params.get(
              "customer"
            ) ?? ""
          )
            .trim()
            .toUpperCase();

        const orderNumber =
          Number(
            params.get(
              "order"
            )
          );

        if (
          !code ||
          !Number.isFinite(
            orderNumber
          )
        ) {
          throw new Error(
            "Customer or order number is missing."
          );
        }

        const liffModule =
          await import(
            "@line/liff"
          );

        const liff =
          liffModule.default;

        const liffId =
          process.env
            .NEXT_PUBLIC_LINE_LIFF_ID;

        if (!liffId) {
          throw new Error(
            "LINE LIFF ID is missing."
          );
        }

        await liff.init({
          liffId,

          withLoginOnExternalBrowser:
            true,
        });

        if (
          !liff.isLoggedIn()
        ) {
          liff.login();
          return;
        }

        const token =
          liff.getIDToken();

        if (!token) {
          throw new Error(
            "LINE ID token was not available."
          );
        }

        if (
          cancelled
        ) {
          return;
        }

        setIdToken(
          token
        );

        setCustomerCode(
          code
        );

        await loadPayment(
          token,
          code,
          orderNumber
        );

        setLoading(
          false
        );
      } catch (error) {
        if (
          cancelled
        ) {
          return;
        }

        console.error(
          "Payment initialization:",
          error
        );

        setMessage(
          error instanceof
            Error
            ? error.message
            : "Could not load payment."
        );

        setLoading(
          false
        );
      }
    }

    initialize();

    return () => {
      cancelled =
        true;
    };
  }, []);

  // =====================================================
  // SUBMIT SLIP
  // =====================================================

  async function submitSlip() {
    if (
      !data?.order ||
      !slipFile ||
      !idToken ||
      !customerCode
    ) {
      setMessage(
        "Please choose your payment slip first."
      );

      return;
    }

    setSubmitting(
      true
    );

    setMessage(
      ""
    );

    try {
      const formData =
        new FormData();

      formData.append(
        "idToken",
        idToken
      );

      formData.append(
        "customerCode",
        customerCode
      );

      formData.append(
        "orderNumber",
        String(
          data.order
            .orderNumber
        )
      );

      formData.append(
        "file",
        slipFile
      );

      const response =
        await fetch(
          "/api/line/payment",
          {
            method:
              "POST",

            body:
              formData,
          }
        );

      const result =
        (await response.json()) as PaymentResponse;

      if (
        !response.ok
      ) {
        throw new Error(
          result.error ??
            "Payment slip could not be submitted."
        );
      }

      await loadPayment(
        idToken,
        customerCode,
        data.order
          .orderNumber
      );

      setSlipFile(
        null
      );

      setMessage(
        "Payment slip submitted successfully."
      );
    } catch (error) {
      setMessage(
        error instanceof
          Error
          ? error.message
          : "Payment slip could not be submitted."
      );
    } finally {
      setSubmitting(
        false
      );
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-5">

        <div className="text-center">

          <p className="text-xl font-bold">
            LOTUS&apos;S B2B
          </p>

          <p className="text-gray-500 mt-3">
            Loading payment...
          </p>

        </div>

      </main>
    );
  }

  if (
    !data?.order ||
    !data.customer
  ) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          <button
            onClick={() =>
              router.push(
                "/miniapp"
              )
            }
            className="text-gray-500"
          >
            ← Home
          </button>

          <div className="bg-white border rounded-2xl p-6 mt-5">

            <h1 className="text-xl font-bold">
              Payment Unavailable
            </h1>

            <p className="text-red-600 mt-3">
              {
                message
              }
            </p>

          </div>

        </div>

      </main>
    );
  }

  const order =
    data.order;

  const files =
    data.files;

  const canSubmit =
    order.status ===
    "awaiting_payment";

  return (
    <main className="min-h-screen bg-gray-100 pb-10">

      <header className="bg-white border-b">

        <div className="max-w-2xl mx-auto px-4 py-4">

          <button
            onClick={() =>
              router.push(
                `/miniapp/orders?customer=${data.customer?.customerCode}&view=active`
              )
            }
            className="text-sm text-gray-500"
          >
            ← Track My Order
          </button>

          <p className="text-xs text-gray-400 mt-4">
            PAYMENT
          </p>

          <h1 className="text-2xl font-bold mt-1">
            Order #
            {
              order.orderNumber
            }
          </h1>

          <p className="text-gray-500">
            {
              data.customer
                .customerName
            }
          </p>

        </div>

      </header>

      <div className="max-w-2xl mx-auto p-4">

        {message && (
          <div className="bg-white border rounded-xl p-4 mb-5">
            {
              message
            }
          </div>
        )}

        {/* AMOUNT */}

        <section className="bg-white border rounded-2xl p-6 mb-5 text-center">

          <p className="text-sm text-gray-500">
            Amount Due
          </p>

          <p className="text-4xl font-bold mt-2">

            {order.finalAmount ===
            null
              ? "Pending"
              : `฿${order.finalAmount.toLocaleString(
                  undefined,
                  {
                    minimumFractionDigits:
                      2,

                    maximumFractionDigits:
                      2,
                  }
                )}`}

          </p>

          <span className="inline-block bg-gray-100 rounded-full px-3 py-1 text-sm font-semibold mt-4">
            {prettyStatus(
              order.status
            )}
          </span>

        </section>

        {/* BILL */}

        <section className="bg-white border rounded-2xl p-5 mb-5">

          <h2 className="font-bold text-lg">
            Bill
          </h2>

          <p className="text-sm text-gray-500 mt-1">
            Uploaded by our staff.
          </p>

          {!files?.bill ? (

            <p className="text-gray-500 mt-4">
              Bill is not available yet.
            </p>

          ) : (

            <div className="mt-4">

              {isImage(
                files.bill
              ) && (
                <img
                  src={
                    files.bill.url
                  }
                  alt="Final bill"
                  className="w-full max-h-96 object-contain border rounded-xl"
                />
              )}

              <a
                href={
                  files.bill.url
                }
                target="_blank"
                rel="noreferrer"
                className="block w-full text-center border rounded-xl px-4 py-3 font-semibold mt-3"
              >
                OPEN BILL
              </a>

            </div>

          )}

        </section>

        {/* PAYMENT QR */}

        <section className="bg-white border rounded-2xl p-5 mb-5">

          <h2 className="font-bold text-lg">
            Payment QR
          </h2>

          <p className="text-sm text-gray-500 mt-1">
            Scan the QR uploaded by our staff to make payment.
          </p>

          {!files?.paymentQr ? (

            <p className="text-gray-500 mt-4">
              Payment QR is not available yet.
            </p>

          ) : (

            <div className="mt-5 text-center">

              <img
                src={
                  files.paymentQr.url
                }
                alt="Payment QR"
                className="w-full max-w-sm mx-auto object-contain border rounded-xl"
              />

              <a
                href={
                  files.paymentQr.url
                }
                target="_blank"
                rel="noreferrer"
                className="inline-block underline text-sm mt-3"
              >
                Open QR image
              </a>

            </div>

          )}

        </section>

        {/* DELIVERY PROOF */}

        <section className="bg-white border rounded-2xl p-5 mb-5">

          <h2 className="font-bold text-lg">
            Proof of Delivery
          </h2>

          <p className="text-sm text-gray-500 mt-1">
            Delivery photo submitted by our delivery team.
          </p>

          {!files?.deliveryProof ? (

            <p className="text-gray-500 mt-4">
              Proof of delivery is not available.
            </p>

          ) : (

            <div className="mt-4">

              {isImage(
                files.deliveryProof
              ) ? (

                <img
                  src={
                    files.deliveryProof.url
                  }
                  alt="Proof of delivery"
                  className="w-full max-h-96 object-contain border rounded-xl"
                />

              ) : (

                <a
                  href={
                    files.deliveryProof.url
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="block border rounded-xl p-4 font-semibold"
                >
                  OPEN PROOF OF DELIVERY
                </a>

              )}

            </div>

          )}

        </section>

        {/* PAYMENT SUBMITTED */}

        {order.status ===
          "payment_submitted" && (

          <section className="bg-white border rounded-2xl p-6 mb-5 text-center">

            <div className="text-4xl">
              ✓
            </div>

            <h2 className="text-xl font-bold mt-3">
              Payment Submitted
            </h2>

            <p className="text-gray-500 mt-2">
              Your payment slip has been received and is waiting for verification by our team.
            </p>

            {files?.paymentSlip && (

              <a
                href={
                  files.paymentSlip.url
                }
                target="_blank"
                rel="noreferrer"
                className="inline-block underline mt-4"
              >
                View submitted slip
              </a>

            )}

          </section>

        )}

        {/* COMPLETED */}

        {order.status ===
          "completed" && (

          <section className="bg-white border rounded-2xl p-6 mb-5 text-center">

            <div className="text-4xl">
              ✓
            </div>

            <h2 className="text-xl font-bold mt-3">
              Payment Verified
            </h2>

            <p className="text-gray-500 mt-2">
              This order has been completed.
            </p>

          </section>

        )}

        {/* UPLOAD */}

        {canSubmit && (

          <section className="bg-white border rounded-2xl p-5">

            <h2 className="font-bold text-lg">
              Upload Payment Slip
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              Upload a photo or PDF after completing payment.
            </p>

            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(
                event
              ) =>
                setSlipFile(
                  event.target
                    .files?.[0] ??
                    null
                )
              }
              className="block w-full border rounded-xl p-3 mt-5"
            />

            {slipFile && (
              <div className="border rounded-xl p-3 mt-3">

                <p className="font-semibold">
                  {
                    slipFile.name
                  }
                </p>

                <p className="text-xs text-gray-500 mt-1">
                  {(
                    slipFile.size /
                    1024 /
                    1024
                  ).toFixed(
                    2
                  )}{" "}
                  MB
                </p>

              </div>
            )}

            <button
              type="button"
              onClick={
                submitSlip
              }
              disabled={
                submitting ||
                !slipFile
              }
              className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-5 disabled:opacity-40"
            >
              {submitting
                ? "SUBMITTING..."
                : "SUBMIT PAYMENT"}
            </button>

          </section>

        )}

      </div>

    </main>
  );
}