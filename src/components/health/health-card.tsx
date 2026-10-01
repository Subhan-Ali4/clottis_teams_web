"use client";

import { useEffect, useState } from "react";

import { loadHealthViewModel } from "@/executors/health.executor";
import { ServiceStatus, type HealthViewModel } from "@/structs/health";

const initialState: HealthViewModel = {
  status: ServiceStatus.Unavailable,
  title: "Checking backend",
  detail: "Waiting for the API health response.",
  checkedAt: null,
};

export function HealthCard() {
  const [health, setHealth] = useState(initialState);

  useEffect(() => {
    const controller = new AbortController();
    void loadHealthViewModel(controller.signal).then(setHealth);
    return () => controller.abort();
  }, []);

  const isHealthy = health.status === ServiceStatus.Healthy;

  return (
    <article className="rounded-2xl border border-border-theme bg-surface-card p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 rounded-full ${isHealthy ? "bg-brand-success" : "bg-brand-danger"}`}
            />
            <h3 className="text-lg font-semibold">{health.title}</h3>
          </div>
          <p className="text-content-secondary">{health.detail}</p>
        </div>
        <div className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-content-muted">
          {health.checkedAt
            ? `Checked ${new Date(health.checkedAt).toLocaleString()}`
            : "No successful check yet"}
        </div>
      </div>
    </article>
  );
}
