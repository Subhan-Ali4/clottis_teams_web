import { getPublicEnvironment } from "@/configs/environment";
import type { ApiResponse } from "@/structs/api";
import type { HealthData } from "@/structs/health";
import { AppError } from "@/utils/app-error";

export async function fetchBackendHealth(
  signal?: AbortSignal,
): Promise<HealthData> {
  const { apiBaseUrl } = getPublicEnvironment();
  const response = await fetch(`${apiBaseUrl}/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new AppError("Backend health check failed.", "backend_health_failed");
  }

  const body = (await response.json()) as ApiResponse<HealthData>;
  return body.data;
}
