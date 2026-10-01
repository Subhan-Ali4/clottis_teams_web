import { fetchBackendHealth } from "@/services/health.service";
import { ServiceStatus, type HealthViewModel } from "@/structs/health";

export async function loadHealthViewModel(
  signal?: AbortSignal,
): Promise<HealthViewModel> {
  try {
    const health = await fetchBackendHealth(signal);
    return {
      status: health.status,
      title: "Backend connected",
      detail: `${health.service} v${health.version} is responding in ${health.environment} mode.`,
      checkedAt: health.timestamp,
    };
  } catch {
    return {
      status: ServiceStatus.Unavailable,
      title: "Backend unavailable",
      detail: "Start the Rust API or verify NEXT_PUBLIC_API_BASE_URL.",
      checkedAt: null,
    };
  }
}
