/**
 * Example 6: Retry and Fallback Patterns
 *
 * Demonstrates:
 * - Recursive retry with exponential backoff
 * - catchTag() chains for error-specific retry strategies
 * - State management (circuit breaker)
 * - Timeout handling with Promise.race
 * - tapErr() for logging retries and circuit state changes
 *
 * Run: deno run examples/06-retry-and-fallback.ts
 */

import { AsyncBox, defineErrors, type ErrorsOf, t } from "../mod.ts";

// Define resilience errors
const ResilienceErrors = defineErrors({
  TransientError: { attempt: t.number, retryable: t.boolean },
  PermanentError: { reason: t.string },
  CircuitOpen: { service: t.string, failureCount: t.number },
  AllRetriesFailed: { attempts: t.number, lastError: t.string },
  FallbackFailed: { primary: t.string, fallback: t.string },
  Timeout: { operation: t.string, duration: t.number },
});

type ResilienceError = ErrorsOf<typeof ResilienceErrors>;

// Helper: Async delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Circuit breaker state management
class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private threshold: number,
    private resetTimeout: number = 5000,
  ) {}

  async execute<T, E>(
    fn: () => AsyncBox<T, E>,
    serviceName: string,
  ): Promise<AsyncBox<T, E | ReturnType<typeof ResilienceErrors.CircuitOpen>>> {
    // Check if circuit should reset to half-open
    if (
      this.state === "open" &&
      Date.now() - this.lastFailureTime > this.resetTimeout
    ) {
      console.log(
        `  → Circuit half-open for ${serviceName}, attempting request...`,
      );
      this.state = "half-open";
    }

    // Reject if circuit is open
    if (this.state === "open") {
      return AsyncBox.err(ResilienceErrors.CircuitOpen({
        service: serviceName,
        failureCount: this.failureCount,
      }));
    }

    const result = await fn().run();

    if (result._tag === "Ok") {
      // Success - reset failure count
      if (this.state === "half-open") {
        console.log(`  → Circuit closed for ${serviceName}`);
      }
      this.failureCount = 0;
      this.state = "closed";
      return AsyncBox.ok(result.value);
    } else {
      // Failure - increment counter
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.threshold) {
        console.log(
          `  → Circuit opened for ${serviceName} (${this.failureCount} failures)`,
        );
        this.state = "open";
      }

      return AsyncBox.err(result.error);
    }
  }

  getState(): string {
    return this.state;
  }
}

// 1. Exponential backoff retry
function withExponentialBackoff<T, E>(
  fn: () => AsyncBox<T, E>,
  config: { maxAttempts: number; initialDelay: number; maxDelay: number },
): AsyncBox<T, E | ReturnType<typeof ResilienceErrors.AllRetriesFailed>> {
  async function attempt(
    attemptNum: number,
  ): Promise<
    AsyncBox<T, E | ReturnType<typeof ResilienceErrors.AllRetriesFailed>>
  > {
    const result = await fn().run();

    if (result._tag === "Ok") {
      return AsyncBox.ok(result.value);
    }

    if (attemptNum >= config.maxAttempts) {
      return AsyncBox.err(ResilienceErrors.AllRetriesFailed({
        attempts: config.maxAttempts,
        lastError: (result.error as { _tag: string })._tag,
      }));
    }

    // Calculate backoff delay
    const delayMs = Math.min(
      config.initialDelay * Math.pow(2, attemptNum - 1),
      config.maxDelay,
    );

    console.log(
      `  → Attempt ${attemptNum} failed, retrying in ${delayMs}ms...`,
    );
    await delay(delayMs);

    return attempt(attemptNum + 1);
  }

  return AsyncBox.fromPromise(
    attempt(1).then((box) => box.run()),
    (e) => e as E | ReturnType<typeof ResilienceErrors.AllRetriesFailed>,
  ).flatMap((result) =>
    result._tag === "Ok"
      ? AsyncBox.ok(result.value)
      : AsyncBox.err(result.error)
  );
}

// 2. Simulated unreliable service
let callCount = 0;
function unreliableService(): AsyncBox<
  string,
  ReturnType<typeof ResilienceErrors.TransientError>
> {
  callCount++;
  const willSucceed = callCount >= 3; // Succeeds on 3rd attempt

  return AsyncBox.wrap({
    try: async () => {
      await delay(50);
      if (!willSucceed) {
        throw new Error("Service temporarily unavailable");
      }
      return "Service response";
    },
    catch: () =>
      ResilienceErrors.TransientError({
        attempt: callCount,
        retryable: true,
      }),
  });
}

// 3. Fallback chain - try multiple sources
function fallbackChain<T>(
  operations: Array<{ name: string; fn: () => AsyncBox<T, ResilienceError> }>,
): AsyncBox<T, ReturnType<typeof ResilienceErrors.FallbackFailed>> {
  async function tryNext(
    index: number,
  ): Promise<AsyncBox<T, ReturnType<typeof ResilienceErrors.FallbackFailed>>> {
    if (index >= operations.length) {
      return AsyncBox.err(ResilienceErrors.FallbackFailed({
        primary: operations[0].name,
        fallback: operations[operations.length - 1].name,
      }));
    }

    const { name, fn } = operations[index];
    console.log(`  → Trying ${name}...`);

    const result = await fn().run();

    if (result._tag === "Ok") {
      console.log(`  ✓ ${name} succeeded`);
      return AsyncBox.ok(result.value);
    }

    console.log(
      `  ✗ ${name} failed (${(result.error as { _tag: string })._tag})`,
    );
    return tryNext(index + 1);
  }

  return AsyncBox.fromPromise(
    tryNext(0).then((box) => box.run()),
    (e) => e as ReturnType<typeof ResilienceErrors.FallbackFailed>,
  ).flatMap((result) =>
    result._tag === "Ok"
      ? AsyncBox.ok(result.value)
      : AsyncBox.err(result.error)
  );
}

// 4. Timeout wrapper
function withTimeout<T, E extends { _tag: string }>(
  fn: () => AsyncBox<T, E>,
  timeoutMs: number,
  operation: string,
): AsyncBox<T, E | ReturnType<typeof ResilienceErrors.Timeout>> {
  return AsyncBox.wrap<T, E | ReturnType<typeof ResilienceErrors.Timeout>>({
    try: async () => {
      const timeoutPromise = delay(timeoutMs).then(() => {
        throw new Error("Timeout");
      });

      const resultPromise = fn().run();

      const result = await Promise.race([resultPromise, timeoutPromise]);

      if (result && typeof result === "object" && "_tag" in result) {
        if (result._tag === "Ok") {
          return result.value;
        }
        throw result.error;
      }

      throw new Error("Unexpected result");
    },
    catch: (e): E | ReturnType<typeof ResilienceErrors.Timeout> => {
      if (e instanceof Error && e.message === "Timeout") {
        return ResilienceErrors.Timeout({ operation, duration: timeoutMs });
      }
      return e as E;
    },
  });
}

// 5. Graceful degradation
function gracefulDegradation<T, TDegraded>(
  primaryFn: () => AsyncBox<T, ResilienceError>,
  degradedFn: () => AsyncBox<TDegraded, ResilienceError>,
  degradedLabel: string,
): AsyncBox<T | TDegraded, ResilienceError> {
  return primaryFn()
    .tapErr(() => console.log(`  → Primary failed, using ${degradedLabel}...`))
    .catchAll(() => degradedFn() as AsyncBox<T | TDegraded, ResilienceError>);
}

// Demo scenarios
async function main() {
  console.log("\n=== Example 6: Retry and Fallback Patterns ===\n");

  // Scenario 1: Exponential backoff retry
  console.log("📋 Scenario 1: Exponential backoff retry");
  callCount = 0; // Reset counter

  const result1 = await withExponentialBackoff(
    () => unreliableService(),
    { maxAttempts: 5, initialDelay: 100, maxDelay: 1000 },
  )
    .match({
      ok: (data) => `✓ Success after ${callCount} attempts: ${data}`,
      err: (e) => `✗ Failed: ${e._tag}`,
    });
  console.log(result1);
  console.log();

  // Scenario 2: Circuit breaker
  console.log("📋 Scenario 2: Circuit breaker pattern");
  const breaker = new CircuitBreaker(3);
  const failingService = () =>
    AsyncBox.err(ResilienceErrors.TransientError({
      attempt: 1,
      retryable: false,
    }));

  for (let i = 1; i <= 5; i++) {
    const result = await breaker.execute(failingService, "payment-service");
    const outcome = await result.match({
      ok: () => "Success",
      err: (e) => `${e._tag}`,
    });
    console.log(`  Request ${i}: ${outcome} (circuit: ${breaker.getState()})`);
    await delay(50);
  }
  console.log();

  // Scenario 3: Fallback chain
  console.log("📋 Scenario 3: Fallback chain (primary → secondary → cache)");

  const result3 = await fallbackChain([
    {
      name: "Primary API",
      fn: () =>
        AsyncBox.err(
          ResilienceErrors.TransientError({ attempt: 1, retryable: true }),
        ),
    },
    {
      name: "Secondary API",
      fn: () =>
        AsyncBox.err(
          ResilienceErrors.Timeout({ operation: "fetch", duration: 1000 }),
        ),
    },
    {
      name: "Cache",
      fn: () => AsyncBox.ok({ data: "cached", stale: true }),
    },
  ])
    .match({
      ok: (data) => `✓ Fallback succeeded: ${JSON.stringify(data)}`,
      err: (e) => `✗ All fallbacks failed: ${e._tag}`,
    });
  console.log(result3);
  console.log();

  // Scenario 4: Timeout handling
  console.log("📋 Scenario 4: Timeout handling");

  const slowOperation = () =>
    AsyncBox.wrap({
      try: async () => {
        await delay(200);
        return "Slow response";
      },
      catch: () =>
        ResilienceErrors.TransientError({ attempt: 1, retryable: true }),
    });

  const result4 = await withTimeout(slowOperation, 100, "slow-operation")
    .match({
      ok: (data) => `✓ Completed: ${data}`,
      err: (e) => {
        if (e._tag === "Timeout") {
          return `✗ Operation timed out after ${e.duration}ms`;
        }
        return `✗ Failed: ${e._tag}`;
      },
    });
  console.log(result4);
  console.log();

  // Scenario 5: Graceful degradation
  console.log("📋 Scenario 5: Graceful degradation (full → read-only mode)");

  const fullFeatured = () =>
    AsyncBox.err(ResilienceErrors.TransientError({
      attempt: 1,
      retryable: false,
    }));

  const readOnly = () =>
    AsyncBox.ok({
      mode: "read-only",
      features: ["view", "search"],
    });

  const result5 = await gracefulDegradation(
    fullFeatured,
    readOnly,
    "read-only mode",
  )
    .match({
      ok: (data) => `✓ Running in: ${JSON.stringify(data)}`,
      err: (e) => `✗ Failed: ${e._tag}`,
    });
  console.log(result5);

  console.log("\n" + "─".repeat(50) + "\n");
}

// Run example
if (import.meta.main) {
  await main();
}
