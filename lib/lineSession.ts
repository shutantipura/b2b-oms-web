// Browser-side recovery for expired LINE LIFF ID tokens.
// The server remains responsible for verifying LINE identity and access.
const RELOAD_ONCE_KEY = "lotus_b2b_line_session_reload_once";

export const LINE_SESSION_EXPIRED_MESSAGE =
  "เซสชัน LINE หมดอายุ กรุณาปิดแล้วเปิด Lotus’s B2B MINI App ผ่าน LINE อีกครั้ง";

export function isLineIdTokenExpired(token: string, skewSeconds = 30): boolean {
  try {
    const part = token.split(".")[1];
    if (!part) return false;
    const claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: unknown;
    };
    return typeof claims.exp === "number" &&
      claims.exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    // Invalid JWTs are rejected by server-side LINE verification.
    return false;
  }
}

export function requestLineSessionReloadOnce(): boolean {
  try {
    if (window.sessionStorage.getItem(RELOAD_ONCE_KEY) === "1") return false;
    window.sessionStorage.setItem(RELOAD_ONCE_KEY, "1");
    // Preserve route, customer selection and locally persisted cart.
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export function clearLineSessionReload(): void {
  try {
    window.sessionStorage.removeItem(RELOAD_ONCE_KEY);
  } catch {
    // Private browsing may disable session storage.
  }
}

function tokenFromBody(body: BodyInit | null | undefined): string | null {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      return typeof parsed.idToken === "string" ? parsed.idToken : null;
    } catch {
      return null;
    }
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const value = body.get("idToken");
    return typeof value === "string" ? value : null;
  }
  return null;
}

function isLineIdentityFailure(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as { code?: unknown; error?: unknown };
  return record.code === "LINE_ID_TOKEN_INVALID" ||
    (typeof record.error === "string" &&
      /LINE identity could not be verified/i.test(record.error));
}

export async function lineApiFetch(path: string, options: RequestInit): Promise<Response> {
  const token = tokenFromBody(options.body);
  if (token && isLineIdTokenExpired(token)) {
    if (requestLineSessionReloadOnce()) {
      throw new Error("เซสชัน LINE หมดอายุ กำลังเชื่อมต่อใหม่...");
    }
    throw new Error(LINE_SESSION_EXPIRED_MESSAGE);
  }
  const response = await fetch(path, options);
  if (response.ok) {
    clearLineSessionReload();
    return response;
  }
  // Recognize older checkout/payment 500 identity errors during rollout.
  if (response.status === 401 || response.status === 500) {
    const errorBody: unknown = await response.clone().json().catch(() => null);
    if (isLineIdentityFailure(errorBody)) {
      if (requestLineSessionReloadOnce()) {
        throw new Error("เซสชัน LINE หมดอายุ กำลังเชื่อมต่อใหม่...");
      }
      throw new Error(LINE_SESSION_EXPIRED_MESSAGE);
    }
  }
  return response;
}
