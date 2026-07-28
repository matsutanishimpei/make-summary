export async function mobileApi<T = unknown>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });
  const value = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(value.error?.message ?? `HTTP ${response.status}`);
  return value;
}

export async function fetchArtifact(jobId: string, name: string): Promise<Response> {
  const response = await fetch(
    `/api/v1/jobs/${jobId}/artifacts/${encodeURIComponent(name)}`,
    { credentials: "include" }
  );
  if (!response.ok) throw new Error(`${name}を取得できませんでした。`);
  return response;
}
