const DEFAULT_API_BASE_URL = "https://webedit-api.onrender.com";

export const onRequest: PagesFunction = async ({ request, params, env }) => {
  const configuredBase =
    typeof env["API_BASE_URL"] === "string" && env["API_BASE_URL"].trim()
      ? env["API_BASE_URL"].trim()
      : DEFAULT_API_BASE_URL;
  const apiBase = configuredBase.replace(/\/+$/, "");
  const rawPath = params["path"];
  const path = Array.isArray(rawPath) ? rawPath.join("/") : rawPath ?? "";
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(`/api/${path}`, apiBase);
  targetUrl.search = sourceUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");

  return fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
};
