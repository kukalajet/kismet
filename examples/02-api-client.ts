/**
 * Example 2: HTTP API Client
 *
 * Demonstrates:
 * - Tagged errors mapping HTTP status codes
 * - catchTag() for specific error recovery
 * - flatMap() for dependent API calls
 * - tap()/tapErr() for logging and side effects
 * - matchExhaustive() for comprehensive error handling
 *
 * Run: deno run examples/02-api-client.ts
 */

import {
  AsyncBox,
  defineErrors,
  type ErrorsOf,
  type ErrorType,
  t,
} from "../mod.ts";

// Define API-specific errors
const ApiErrors = defineErrors({
  NetworkError: { statusCode: t.number, url: t.string, retryable: t.boolean },
  NotFound: { resourceId: t.string, resourceType: t.string },
  Unauthorized: { requiredScope: t.string },
  RateLimited: { retryAfter: t.number },
  ParseError: { response: t.string },
});

type ApiError = ErrorsOf<typeof ApiErrors>;

// Domain types
interface User {
  id: string;
  name: string;
  email: string;
}

interface Post {
  id: string;
  userId: string;
  title: string;
  content: string;
}

// Mock data store
const mockUsers = new Map<string, User>([
  ["123", { id: "123", name: "Alice", email: "alice@example.com" }],
  ["456", { id: "456", name: "Bob", email: "bob@example.com" }],
]);

const mockPosts = new Map<string, Post[]>([
  ["123", [
    { id: "p1", userId: "123", title: "Hello World", content: "First post!" },
    {
      id: "p2",
      userId: "123",
      title: "AsyncBox Tips",
      content: "Type-safe errors are great",
    },
  ]],
  ["456", [
    {
      id: "p3",
      userId: "456",
      title: "Functional Programming",
      content: "Monads explained",
    },
  ]],
]);

const cachedUsers = new Map<string, User>([
  ["999", { id: "999", name: "Cached User", email: "cached@example.com" }],
]);

// Helper: Simulate network delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. Simulate fetch with different HTTP status codes
async function simulateFetch(
  url: string,
  forceStatusCode?: number,
): Promise<Response> {
  await delay(20);

  const statusCode = forceStatusCode ?? (Math.random() > 0.8 ? 500 : 200);

  // Simulate different response types
  if (statusCode === 404) {
    return new Response(null, { status: 404, statusText: "Not Found" });
  }
  if (statusCode === 401) {
    return new Response(null, { status: 401, statusText: "Unauthorized" });
  }
  if (statusCode === 429) {
    return new Response(null, { status: 429, statusText: "Too Many Requests" });
  }
  if (statusCode >= 500) {
    return new Response(null, {
      status: statusCode,
      statusText: "Server Error",
    });
  }

  // Success - extract mock data from URL
  const userId = url.split("/").pop();
  if (url.includes("/users/") && userId && !url.includes("/posts")) {
    const user = mockUsers.get(userId);
    return new Response(JSON.stringify(user), { status: 200 });
  }
  if (url.includes("/posts")) {
    const posts = mockPosts.get(userId || "");
    return new Response(JSON.stringify(posts || []), { status: 200 });
  }

  return new Response(JSON.stringify({ data: "success" }), { status: 200 });
}

// 2. Generic fetch with JSON parsing and error mapping
function fetchJson<T>(url: string): AsyncBox<T, ApiError> {
  return AsyncBox.fromPromise<Response, ApiError>(
    simulateFetch(url),
    (_e) =>
      ApiErrors.NetworkError({
        statusCode: 0,
        url,
        retryable: true,
      }),
  )
    .tap((response) => console.log(`  → GET ${url} (${response.status})`))
    .flatMap((response): AsyncBox<Response, ApiError> => {
      // Map HTTP status to typed errors
      if (response.status === 404) {
        return AsyncBox.err(ApiErrors.NotFound({
          resourceId: url.split("/").pop() || "",
          resourceType: "resource",
        }));
      }
      if (response.status === 401) {
        return AsyncBox.err(ApiErrors.Unauthorized({
          requiredScope: "read:resource",
        }));
      }
      if (response.status === 429) {
        return AsyncBox.err(ApiErrors.RateLimited({
          retryAfter: 60,
        }));
      }
      if (response.status >= 500) {
        return AsyncBox.err(ApiErrors.NetworkError({
          statusCode: response.status,
          url,
          retryable: true,
        }));
      }

      return AsyncBox.ok(response);
    })
    .flatMap((response: Response) =>
      AsyncBox.wrap({
        try: () => response.json() as Promise<T>,
        catch: (e) =>
          ApiErrors.ParseError({
            response: String(e),
          }),
      })
    )
    .tapErr((e: ApiError) => console.log(`  ✗ Error: ${e._tag}`));
}

// 3. Get user by ID
function getUser(id: string): AsyncBox<User, ApiError> {
  return fetchJson<User>(`/api/users/${id}`)
    .flatMap((user) => {
      if (!user) {
        return AsyncBox.err(ApiErrors.NotFound({
          resourceId: id,
          resourceType: "User",
        }));
      }
      return AsyncBox.ok(user);
    });
}

// 4. Get user's posts - demonstrates flatMap for dependent calls
function getUserPosts(userId: string): AsyncBox<Post[], ApiError> {
  return getUser(userId)
    .tap((user) => console.log(`  → Fetching posts for user: ${user.name}`))
    .flatMap((user) => fetchJson<Post[]>(`/api/users/${user.id}/posts`));
}

// 5. Get user with fallback to cache - demonstrates catchTag
function getUserWithFallback(
  id: string,
): AsyncBox<User, Exclude<ApiError, ErrorType<typeof ApiErrors, "NotFound">>> {
  return getUser(id)
    .catchTag("NotFound", (error) => {
      console.log(`  → User ${error.resourceId} not found, checking cache...`);
      const cached = cachedUsers.get(id);
      if (cached) {
        return AsyncBox.ok(cached);
      }
      return AsyncBox.err(ApiErrors.NetworkError({
        statusCode: 404,
        url: `/api/users/${id}`,
        retryable: false,
      }));
    });
}

// Demo scenarios
async function main() {
  console.log("\n=== Example 2: HTTP API Client ===\n");

  // Scenario 1: Successful API call
  console.log("📋 Scenario 1: Successful API call");
  const result1 = await getUser("123")
    .match({
      ok: (user) => `✓ User: ${user.name} (${user.email})`,
      err: (e) => `✗ Failed: ${e._tag}`,
    });
  console.log(result1);
  console.log();

  // Scenario 2: 404 with fallback to cache
  console.log("📋 Scenario 2: User not found, fallback to cache");
  const result2 = await getUserWithFallback("999")
    .match({
      ok: (user) => `✓ User found: ${user.name} (from cache)`,
      err: (e) => `✗ Failed: ${e._tag}`,
    });
  console.log(result2);
  console.log();

  // Scenario 3: Chained API calls (user → posts)
  console.log("📋 Scenario 3: Chained API calls (fetch user → fetch posts)");
  const result3 = await getUserPosts("123")
    .match({
      ok: (posts) => `✓ Found ${posts.length} posts`,
      err: (e) => `✗ Failed: ${e._tag}`,
    });
  console.log(result3);
  console.log();

  // Scenario 4: Exhaustive error handling
  console.log("📋 Scenario 4: Exhaustive error handling with matchExhaustive");
  const result4 = await getUser("789")
    .matchExhaustive({
      ok: (user) => `✓ User: ${user.name}`,
      NetworkError: (e) =>
        e.retryable
          ? `⚠ Network error (retryable): ${e.statusCode}`
          : `✗ Network error (permanent): ${e.statusCode}`,
      NotFound: (e) => `✗ ${e.resourceType} ${e.resourceId} not found`,
      Unauthorized: (e) => `✗ Unauthorized (required: ${e.requiredScope})`,
      RateLimited: (e) => `✗ Rate limited (retry after ${e.retryAfter}s)`,
      ParseError: (e) => `✗ Parse error: ${e.response}`,
    });
  console.log(result4);
  console.log();

  // Scenario 5: Error recovery with catchAll
  console.log("📋 Scenario 5: Catch all errors and provide default");
  const result5 = await getUser("invalid")
    .catchAll(() =>
      AsyncBox.ok({
        id: "default",
        name: "Guest User",
        email: "guest@example.com",
      })
    )
    .map((user) => `✓ Using user: ${user.name}`)
    .unwrapOr("Failed to get any user");
  console.log(result5);

  console.log("\n" + "─".repeat(50) + "\n");
}

// Run example
if (import.meta.main) {
  await main();
}
