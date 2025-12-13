/**
 * Example 5: Parallel Operations
 *
 * Demonstrates:
 * - Promise.all() with AsyncBox operations
 * - Promise.race() for fastest response
 * - Promise.allSettled() equivalent for best-effort
 * - Batch processing with concurrency control
 * - Partial success patterns
 * - tap() for progress tracking
 *
 * Run: deno run examples/05-parallel-operations.ts
 */

import { AsyncBox, defineErrors, type ErrorsOf, t } from "../mod.ts";

// Define parallel operation errors
const ParallelErrors = defineErrors({
  ServiceUnavailable: { service: t.string },
  PartialFailure: {
    succeeded: t.number,
    failed: t.number,
    errors: t.array<string>(),
  },
  AllFailed: { attempted: t.number },
  Timeout: { service: t.string, duration: t.number },
});

type ParallelError = ErrorsOf<typeof ParallelErrors>;

// Domain types
interface ServiceResponse {
  service: string;
  data: string;
  latency: number;
}

// Helper: Async delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. Fetch from service with variable latency and failure rate
function fetchFromService(
  service: string,
  latency: number = 50,
  failureRate: number = 0.2,
): AsyncBox<
  ServiceResponse,
  | ReturnType<typeof ParallelErrors.ServiceUnavailable>
  | ReturnType<typeof ParallelErrors.Timeout>
> {
  return AsyncBox.wrap({
    try: async () => {
      await delay(latency);

      if (Math.random() < failureRate) {
        throw new Error("Service unavailable");
      }

      return {
        service,
        data: `Data from ${service}`,
        latency,
      };
    },
    catch: (e) => {
      if (e instanceof Error && e.message.includes("unavailable")) {
        return ParallelErrors.ServiceUnavailable({ service });
      }
      return ParallelErrors.Timeout({ service, duration: latency });
    },
  });
}

// 2. Fetch from all services - fail if any fails
function parallelFetchAll(
  services: string[],
): AsyncBox<
  ServiceResponse[],
  | ReturnType<typeof ParallelErrors.ServiceUnavailable>
  | ReturnType<typeof ParallelErrors.Timeout>
  | ReturnType<typeof ParallelErrors.AllFailed>
> {
  return AsyncBox.wrap({
    try: async () => {
      const results = await Promise.all(
        services.map((service) =>
          fetchFromService(service, Math.random() * 100 + 20, 0.1).run()
        ),
      );

      const responses: ServiceResponse[] = [];
      for (const result of results) {
        if (result._tag === "Err") {
          throw result.error;
        }
        responses.push(result.value);
      }

      return responses;
    },
    catch: (e) => {
      if (e && typeof e === "object" && "_tag" in e) {
        return e as
          | ReturnType<typeof ParallelErrors.ServiceUnavailable>
          | ReturnType<typeof ParallelErrors.Timeout>;
      }
      return ParallelErrors.AllFailed({ attempted: services.length });
    },
  });
}

// 3. Race - first success wins
function parallelFetchAny(
  services: string[],
): AsyncBox<ServiceResponse, ReturnType<typeof ParallelErrors.AllFailed>> {
  return AsyncBox.wrap({
    try: async () => {
      const promises = services.map((service) =>
        fetchFromService(service, Math.random() * 150 + 30, 0.3)
          .run()
          .then((result) => {
            if (result._tag === "Ok") {
              return result.value;
            }
            throw result.error;
          })
      );

      return await Promise.race(promises);
    },
    catch: () => ParallelErrors.AllFailed({ attempted: services.length }),
  });
}

// 4. Best effort - collect successes, tolerate failures
async function parallelFetchBestEffort(
  services: string[],
): Promise<{
  successes: ServiceResponse[];
  failures: { service: string; error: string }[];
}> {
  const results = await Promise.all(
    services.map((service) =>
      fetchFromService(service, Math.random() * 100 + 20, 0.3)
        .run()
        .then((result) => ({ service, result }))
    ),
  );

  const successes: ServiceResponse[] = [];
  const failures: { service: string; error: string }[] = [];

  for (const { service, result } of results) {
    if (result._tag === "Ok") {
      successes.push(result.value);
    } else {
      failures.push({ service, error: result.error._tag });
    }
  }

  return { successes, failures };
}

// 5. Batch process items with concurrency limit
async function batchProcess<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => AsyncBox<R, ParallelError>,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    console.log(
      `  → Processing batch ${
        Math.floor(i / batchSize) + 1
      } (${batch.length} items)...`,
    );

    const batchResults = await Promise.all(
      batch.map((item) => processor(item).run()),
    );

    for (const result of batchResults) {
      if (result._tag === "Ok") {
        results.push(result.value);
      }
    }
  }

  return results;
}

// 6. Aggregate results from multiple sources
function aggregateResults(
  responses: ServiceResponse[],
): { combined: string; sources: number; avgLatency: number } {
  const combined = responses.map((r) => r.data).join(", ");
  const avgLatency = responses.reduce((sum, r) => sum + r.latency, 0) /
    responses.length;

  return {
    combined,
    sources: responses.length,
    avgLatency: Math.round(avgLatency),
  };
}

// Demo scenarios
async function main() {
  console.log("\n=== Example 5: Parallel Operations ===\n");

  // Scenario 1: Fetch from all services (success)
  console.log("📋 Scenario 1: Fetch from all services in parallel");
  const services1 = ["service-a", "service-b", "service-c", "service-d"];
  const startTime1 = Date.now();

  const result1 = await parallelFetchAll(services1)
    .tap((responses) => {
      const elapsed = Date.now() - startTime1;
      console.log(
        `  ✓ All ${responses.length} services responded in ${elapsed}ms`,
      );
      for (const response of responses) {
        console.log(`    - ${response.service}: ${response.latency}ms`);
      }
    })
    .map(aggregateResults)
    .match({
      ok: (agg) =>
        `✓ Aggregated ${agg.sources} sources (avg latency: ${agg.avgLatency}ms)`,
      err: (e) => `✗ Failed: ${e._tag}`,
    });
  console.log(result1);
  console.log();

  // Scenario 2: Race between services
  console.log("📋 Scenario 2: Race - first response wins");
  const services2 = ["service-fast", "service-medium", "service-slow"];
  const startTime2 = Date.now();

  const result2 = await parallelFetchAny(services2)
    .tap((response) => {
      const elapsed = Date.now() - startTime2;
      console.log(`  ✓ Fastest response: ${response.service} (${elapsed}ms)`);
    })
    .match({
      ok: (response) =>
        `✓ Winner: ${response.service} with ${response.latency}ms latency`,
      err: (e) => `✗ All services failed (attempted: ${e.attempted})`,
    });
  console.log(result2);
  console.log();

  // Scenario 3: Best-effort parallel fetch
  console.log("📋 Scenario 3: Best-effort fetch (tolerate failures)");
  const services3 = [
    "service-1",
    "service-2",
    "service-3",
    "service-4",
    "service-5",
  ];

  const { successes, failures } = await parallelFetchBestEffort(services3);

  console.log(
    `  ✓ Succeeded: ${successes.length}/${services3.length} services`,
  );
  for (const success of successes) {
    console.log(`    - ${success.service}: OK`);
  }

  if (failures.length > 0) {
    console.log(`  ✗ Failed: ${failures.length} services`);
    for (const failure of failures) {
      console.log(`    - ${failure.service}: ${failure.error}`);
    }
  }

  const finalResult = successes.length > 0
    ? `✓ Continuing with ${successes.length} partial results`
    : `✗ All services failed`;
  console.log(finalResult);
  console.log();

  // Scenario 4: Batch processing with concurrency control
  console.log("📋 Scenario 4: Batch processing (concurrency limit: 3)");
  const items = Array.from({ length: 10 }, (_, i) => `item-${i + 1}`);

  const processed = await batchProcess(items, 3, (item) =>
    AsyncBox.wrap({
      try: async () => {
        await delay(50);
        return `Processed ${item}`;
      },
      catch: () => ParallelErrors.ServiceUnavailable({ service: item }),
    }));

  console.log(
    `✓ Processed ${processed.length}/${items.length} items in batches of 3`,
  );
  console.log();

  // Scenario 5: Parallel with progress tracking
  console.log("📋 Scenario 5: Parallel fetch with progress tracking");
  const services5 = ["api-1", "api-2", "api-3", "api-4", "api-5", "api-6"];
  let completed = 0;

  const promises = services5.map((service) =>
    fetchFromService(service, Math.random() * 80 + 20, 0.15)
      .tap((response) => {
        completed++;
        console.log(
          `  [${completed}/${services5.length}] ${response.service} completed`,
        );
      })
      .run()
  );

  const results5 = await Promise.all(promises);
  const successful = results5.filter((r) => r._tag === "Ok").length;

  console.log(`✓ Completed: ${successful}/${services5.length} successful`);

  console.log("\n" + "─".repeat(50) + "\n");
}

// Run example
if (import.meta.main) {
  await main();
}
