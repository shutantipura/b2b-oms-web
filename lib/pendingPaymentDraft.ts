/** Local-only slip staging. Nothing is submitted to OMS until staff confirm. */
const DATABASE = "lotus_oms_payment_drafts_v1";
const STORE = "slips";
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

type StoredFile = {
  name: string;
  type: string;
  lastModified: number;
  bytes: Blob;
};

type StoredDraft = {
  savedAt: number;
  first: StoredFile;
  second: StoredFile | null;
};

export type PaymentDraft = {
  first: File;
  second: File | null;
};

export function paymentDraftKey(userId: string, orderNumber: number) {
  if (!/^[a-f0-9-]{36}$/i.test(userId) || !Number.isSafeInteger(orderNumber) || orderNumber < 1) {
    throw new Error("Invalid payment draft owner or order");
  }
  return `${userId}:${orderNumber}`;
}

export function isFreshPaymentDraft(savedAt: number, now = Date.now()) {
  return Number.isFinite(savedAt) && savedAt <= now && now - savedAt <= MAX_AGE_MS;
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local draft storage unavailable"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open draft storage"));
    request.onblocked = () => reject(new Error("Draft storage is busy"));
  });
}

function storedFile(file: File): StoredFile {
  return { name: file.name, type: file.type, lastModified: file.lastModified, bytes: file };
}

function restoredFile(value: StoredFile): File {
  if (!value || !(value.bytes instanceof Blob) || typeof value.name !== "string") {
    throw new Error("Invalid saved payment image");
  }
  return new File([value.bytes], value.name, {
    type: value.type,
    lastModified: value.lastModified,
  });
}

export async function savePaymentDraft(
  userId: string,
  orderNumber: number,
  first: File,
  second: File | null,
) {
  const db = await openDraftDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put({
        savedAt: Date.now(),
        first: storedFile(first),
        second: second ? storedFile(second) : null,
      } satisfies StoredDraft, paymentDraftKey(userId, orderNumber));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Cannot save payment draft"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Payment draft interrupted"));
    });
  } finally {
    db.close();
  }
}

export async function loadPaymentDraft(userId: string, orderNumber: number): Promise<PaymentDraft | null> {
  const db = await openDraftDb();
  let value: StoredDraft | undefined;
  try {
    value = await new Promise<StoredDraft | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly")
        .objectStore(STORE).get(paymentDraftKey(userId, orderNumber));
      request.onsuccess = () => resolve(request.result as StoredDraft | undefined);
      request.onerror = () => reject(request.error ?? new Error("Cannot restore payment draft"));
    });
  } finally {
    db.close();
  }
  if (!value) return null;
  if (!isFreshPaymentDraft(value.savedAt)) {
    await clearPaymentDraft(userId, orderNumber);
    return null;
  }
  try {
    return {
      first: restoredFile(value.first),
      second: value.second ? restoredFile(value.second) : null,
    };
  } catch {
    await clearPaymentDraft(userId, orderNumber);
    return null;
  }
}

export async function clearPaymentDraft(userId: string, orderNumber: number) {
  const db = await openDraftDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(paymentDraftKey(userId, orderNumber));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Cannot clear payment draft"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Clear draft interrupted"));
    });
  } finally {
    db.close();
  }
}
