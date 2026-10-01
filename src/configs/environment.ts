const DEFAULT_API_BASE_URL = "http://localhost:8080/api/v1";

export interface PublicEnvironment {
  apiBaseUrl: string;
}

export function getPublicEnvironment(): PublicEnvironment {
  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

  try {
    new URL(apiBaseUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must be a valid absolute URL.");
  }

  return { apiBaseUrl: apiBaseUrl.replace(/\/$/, "") };
}
