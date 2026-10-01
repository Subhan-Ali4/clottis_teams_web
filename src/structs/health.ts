export enum ServiceStatus {
  Healthy = "healthy",
  Ready = "ready",
  Unavailable = "unavailable",
}

export enum Environment {
  Development = "development",
  Test = "test",
  Production = "production",
}

export interface HealthData {
  service: string;
  status: ServiceStatus.Healthy;
  environment: Environment;
  version: string;
  timestamp: string;
}

export interface HealthViewModel {
  status: ServiceStatus;
  title: string;
  detail: string;
  checkedAt: string | null;
}
