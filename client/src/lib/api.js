// Every request has a deadline so a stalled backend cannot leave a page loading forever.
// No automatic retries: writes, login, and notification actions must not be replayed.
const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const DEFAULT_TIMEOUT_MS = 35_000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = "API_ERROR", reference = null, retryAfter = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.reference = reference;
    this.retryAfter = retryAfter;
  }
}

const parseResponse = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  let payload;
  try {
    payload = contentType.includes("application/json") ? await response.json() : await response.text();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const details = payload && typeof payload === "object" ? payload : {};
    let message = typeof details.message === "string" && details.message.trim()
      ? details.message : response.status === 429
        ? "Too many attempts. Wait a few minutes before retrying."
        : response.status >= 500
          ? "The Barangay Iba service is currently unavailable. Please try again."
          : "The request could not be completed. Please check your information.";
    const retryAfter = response.headers.get("Retry-After");
    if (response.status === 429 && retryAfter) {
      const seconds = /^\d+$/.test(retryAfter)
        ? Number(retryAfter) : Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000);
      if (Number.isFinite(seconds) && seconds >= 0) {
        message += ` Retry in ${Math.max(1, seconds)} seconds.`;
      }
    }
    const reference = typeof details.reference === "string" ? details.reference : null;
    throw new ApiError(reference ? `${message} Reference: ${reference}` : message, {
      status: response.status,
      code: details.code || `HTTP_${response.status}`,
      reference,
      retryAfter,
    });
  }
  return payload;
};

export const api = async (path, { method = "GET", body, token, headers = {}, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const finalHeaders = { ...headers };
  let finalBody = body;
  if (body && !(body instanceof FormData)) {
    finalHeaders["Content-Type"] = "application/json";
    finalBody = JSON.stringify(body);
  }
  if (token) finalHeaders.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, duration);
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: finalBody,
      signal: controller.signal,
    });
    return await parseResponse(response);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError(
      "The server took too long to respond. Check your connection and try again. If this action may have saved data, check its status before retrying.",
      { code: "API_TIMEOUT" },
    );
    if (signal?.aborted) throw error; // Explicit caller cancellation is not a service failure.
    if (error instanceof TypeError || error?.name === "AbortError") throw new ApiError(
      "Could not contact the Barangay Iba server. Check your connection, then try again.",
      { code: "API_NETWORK_ERROR" },
    );
    throw new ApiError("The server response could not be processed. Please retry.", { code: "API_RESPONSE_ERROR" });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
};

export { API_URL };

