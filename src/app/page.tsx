import { HealthCard } from "@/components/health/health-card";

export default function Home() {
  return (
    <div className="min-h-screen bg-surface-primary px-6 py-16 text-content-primary sm:px-10">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-12">
        <section className="max-w-3xl space-y-5">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-primary">
            CLOTTIS Teams
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
            Team delivery, with a clean foundation.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-content-secondary">
            The web workspace is ready for authentication, projects, sprints,
            task boards and realtime collaboration to be added in approved
            phases.
          </p>
        </section>

        <section aria-labelledby="foundation-heading" className="space-y-5">
          <div>
            <p className="text-sm font-medium text-content-muted">Foundation</p>
            <h2 id="foundation-heading" className="text-2xl font-semibold">
              Runtime status
            </h2>
          </div>
          <HealthCard />
        </section>
      </main>
    </div>
  );
}
