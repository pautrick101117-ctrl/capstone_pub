const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const parseResponse = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    throw new Error(payload.message || "Request failed.");
  }

  return payload;
};

export const api = async (path, { method = "GET", body, token, headers = {} } = {}) => {
  const finalHeaders = { ...headers };
  let finalBody = body;

  if (body && !(body instanceof FormData)) {
    finalHeaders["Content-Type"] = "application/json";
    finalBody = JSON.stringify(body);
  }

  if (token) {
    finalHeaders.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: finalBody,
  });

  return parseResponse(response);
};

export { API_URL };
