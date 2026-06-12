const BASE = process.env.REACT_APP_API_URL;

async function request(method, path, body, getToken) {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  shorten:    (longUrl, getToken) =>
    request("POST", "/api/shorten", { longUrl }, getToken),

  listUrls:   (getToken) =>
    request("GET", "/api/urls", null, getToken),

  deleteUrl:  (code, getToken) =>
    request("DELETE", `/api/urls/${code}`, null, getToken),
};
