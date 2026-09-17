const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${options?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  list: <T>(resource: string, params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<T[]>(`/${resource}${qs}`);
  },
  create: <T>(resource: string, data: Partial<T>) =>
    request<T>(`/${resource}`, { method: "POST", body: JSON.stringify(data) }),
  update: <T>(resource: string, id: string, data: Partial<T>) =>
    request<T>(`/${resource}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (resource: string, id: string) => request<void>(`/${resource}/${id}`, { method: "DELETE" }),
  bulkSetPoints: (updates: { id: string; field: string; value: string }[]) =>
    request<void>("/points/bulk", { method: "POST", body: JSON.stringify({ updates }) }),
  import: (
    project_id: string,
    equipment: { tempId: string; tag: string; equipment_type: string; location?: string }[],
    points: {
      equipmentTempId: string;
      panel?: string;
      ip_op?: string;
      analog_digital?: string;
      point_number: string;
      descriptor?: string;
    }[]
  ) =>
    request<{ equipment_count: number; point_count: number }>("/import", {
      method: "POST",
      body: JSON.stringify({ project_id, equipment, points }),
    }),
};
