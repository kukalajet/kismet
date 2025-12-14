/**
 * Example 1: Basic Async Operations
 *
 * Demonstrates:
 * - AsyncBox.fromPromise() for converting promises
 * - AsyncBox.wrap() in both simple and config forms
 * - map() for sync transformations
 * - flatMap() for chaining dependent async operations
 * - unwrapOr() for safe value extraction
 *
 * Run: deno run examples/01-basic-async.ts
 */

import {
  AsyncBox,
  defineErrors,
  type ErrorsOf,
  type ErrorType,
  t,
} from "../mod.ts";

// Define domain-specific errors
const BasicErrors = defineErrors({
  FetchError: { url: t.string, message: t.string },
  TimeoutError: { duration: t.number },
  ParseError: { input: t.string },
});

type BasicError = ErrorsOf<typeof BasicErrors>;

// Helper: Platform-agnostic delay
function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// 1. Simple async operation with random success/failure
function simulateAsyncOperation(): AsyncBox<
  string,
  ErrorType<typeof BasicErrors, "TimeoutError">
> {
  const willSucceed = Math.random() > 0.3;

  return AsyncBox.fromPromise(
    delay(50, willSucceed ? "Operation completed" : null).then((result) => {
      if (result === null) {
        throw new Error("Timeout");
      }
      return result;
    }),
    (_e) => BasicErrors.TimeoutError({ duration: 50 }),
  );
}

// 2. Fetch data - demonstrates AsyncBox.fromPromise()
function fetchData(
  url: string,
): AsyncBox<string, ErrorType<typeof BasicErrors, "FetchError">> {
  // Simulate fetch with potential failure
  const willSucceed = Math.random() > 0.2;

  return AsyncBox.fromPromise(
    delay(30, { ok: willSucceed, data: `Data from ${url}` }).then(
      (response) => {
        if (!response.ok) {
          throw new Error("Fetch failed");
        }
        return response.data;
      },
    ),
    (e) =>
      BasicErrors.FetchError({
        url,
        message: e instanceof Error ? e.message : String(e),
      }),
  );
}

// 3. Parse JSON - demonstrates AsyncBox.wrap() in both forms
function _parseJsonSimple(
  text: string,
): AsyncBox<unknown, ErrorType<typeof BasicErrors, "ParseError">> {
  // Simple form: uses automatic error wrapping
  return AsyncBox.wrap(() => Promise.resolve(JSON.parse(text)))
    .mapErr((_unknownErr) => BasicErrors.ParseError({ input: text }));
}

function parseJsonConfig(
  text: string,
): AsyncBox<unknown, ErrorType<typeof BasicErrors, "ParseError">> {
  // Config form: custom error handling with full type control
  return AsyncBox.wrap({
    try: async () => {
      await Promise.resolve(); // Make it truly async
      return JSON.parse(text);
    },
    catch: (_error) => BasicErrors.ParseError({ input: text }),
  });
}

// 4. Transform data - demonstrates .map() chaining
function transformData(
  data: string,
): AsyncBox<{ transformed: boolean; length: number; data: string }, never> {
  return AsyncBox.ok(data)
    .map((d) => d.toUpperCase())
    .map((d) => ({
      transformed: true,
      length: d.length,
      data: d,
    }));
}

// 5. Complete pipeline - demonstrates .flatMap() for chaining dependent operations
function basicPipeline(
  url: string,
): AsyncBox<
  { transformed: boolean; length: number; data: string },
  BasicError
> {
  return fetchData(url)
    .flatMap((rawData) => parseJsonConfig(rawData))
    .map((parsed) => JSON.stringify(parsed))
    .flatMap((stringData) => transformData(stringData));
}

// Demo scenarios
async function main() {
  console.log("\n=== Example 1: Basic Async Operations ===\n");

  // Scenario 1: Simple async operation
  console.log("📋 Scenario 1: Simple async operation");
  const result1 = await simulateAsyncOperation()
    .map((msg) => `Success: ${msg}`)
    .unwrapOr("Operation timed out");
  console.log(result1);
  console.log();

  // Scenario 2: Fetch with error handling
  console.log("📋 Scenario 2: Fetch data with error handling");
  const result2 = await fetchData("/api/users")
    .match({
      ok: (data) => `✓ Fetched: ${data}`,
      err: (e) => `✗ Error: ${e._tag} - ${e.message}`,
    });
  console.log(result2);
  console.log();

  // Scenario 3: Parse JSON (success case)
  console.log("📋 Scenario 3a: Parse valid JSON");
  const validJson = '{"name":"Alice","age":30}';
  const result3a = await parseJsonConfig(validJson)
    .match({
      ok: (data) => `✓ Parsed: ${JSON.stringify(data)}`,
      err: (e) => `✗ Parse error: ${e._tag}`,
    });
  console.log(result3a);
  console.log();

  // Scenario 3b: Parse JSON (error case)
  console.log("📋 Scenario 3b: Parse invalid JSON");
  const invalidJson = "{invalid json}";
  const result3b = await parseJsonConfig(invalidJson)
    .match({
      ok: (data) => `✓ Parsed: ${JSON.stringify(data)}`,
      err: (e) => `✗ Parse error: ${e._tag} (input: "${e.input}")`,
    });
  console.log(result3b);
  console.log();

  // Scenario 4: Transform data
  console.log("📋 Scenario 4: Transform data with map()");
  const result4 = await transformData("hello world")
    .map((transformed) => `${transformed.data} (length: ${transformed.length})`)
    .unwrapOr("Transform failed");
  console.log(`✓ ${result4}`);
  console.log();

  // Scenario 5: Complete pipeline
  console.log(
    "📋 Scenario 5: Complete async pipeline (fetch → parse → transform)",
  );
  const result5 = await basicPipeline("/api/config")
    .match({
      ok: (data) => `✓ Pipeline success: ${JSON.stringify(data)}`,
      err: (e) => {
        // Exhaustive error handling based on tag
        switch (e._tag) {
          case "FetchError":
            return `✗ Fetch failed: ${e.message} (${e.url})`;
          case "ParseError":
            return `✗ Parse failed: ${e.input}`;
          case "TimeoutError":
            return `✗ Timeout: ${e.duration}ms`;
        }
      },
    });
  console.log(result5);

  console.log("\n" + "─".repeat(50) + "\n");
}

// Run example
if (import.meta.main) {
  await main();
}
