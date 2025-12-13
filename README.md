# Kismet

A TypeScript/Deno library for type-safe error handling using Rust-inspired
`Result` types with exhaustive pattern matching.

## Features

- **Type-Safe Error Handling**: Errors are explicitly typed in function
  signatures, not hidden in thrown exceptions
- **Tagged Error System**: Discriminated unions with string literal tags for
  precise error identification
- **Exhaustive Matching**: TypeScript enforces handling of all possible error
  cases at compile time
- **Fluent API**: Chain operations with `Box` and `AsyncBox` wrappers for
  ergonomic error handling
- **Zero Runtime Dependencies**: Built with Deno standard library only
- **Async Support**: First-class support for Promise-based workflows with
  `AsyncBox`

## Installation

```typescript
import { AsyncBox, Box } from "jsr:@kukalajet/kismet";
```

## Quick Start

### Fluent API with Box

`Box` is the primary API for working with Result types. It provides a fluent
interface for transforming values and handling errors.

```typescript
import { Box } from "@kukalajet/kismet";

const result = Box.ok(10)
  .map((x) => x * 2) // Transform success value
  .map((x) => x + 5) // Chain transformations
  .unwrapOr(0); // Extract value with default

console.log(result); // 25
```

### Creating Errors

```typescript
import { Box } from "@kukalajet/kismet";

// Create a typed error with properties
const notFound = Box.fail("NotFound", { userId: "123" });
// Type: Box<never, TaggedError<"NotFound"> & { userId: string }>

// Create from a throwing function
const parsed = Box.from(
  () => JSON.parse(input),
  (e) => ({ _tag: "ParseError" as const, message: String(e) }),
);
```

### Tagged Errors with defineErrors

```typescript
import { Box, defineErrors, type ErrorsOf, t } from "@kukalajet/kismet";

const UserErrors = defineErrors({
  NotFound: { userId: t.string },
  InvalidEmail: { email: t.string },
  Unauthorized: undefined, // No additional properties
});

type UserError = ErrorsOf<typeof UserErrors>;

function findUser(id: string): Box<User, UserError> {
  const user = users.find((u) => u.id === id);
  if (!user) {
    return Box.err(UserErrors.NotFound({ userId: id }));
  }
  if (!user.isActive) {
    return Box.err(UserErrors.Unauthorized());
  }
  return Box.ok(user);
}
```

### Error Recovery

```typescript
import { Box, type TaggedError } from "@kukalajet/kismet";

type NetworkError = TaggedError<"NetworkError"> & { code: number };
type ParseError = TaggedError<"ParseError"> & { input: string };

const result = fetchData()
  .flatMap((data) => parseData(data))
  .catchTag(
    "NetworkError",
    (err) => Box.ok({ status: "offline", cached: true }),
  )
  .catchTag("ParseError", (err) => Box.ok(getDefaultData()));
```

### Exhaustive Pattern Matching

```typescript
import { Box, type TaggedError } from "@kukalajet/kismet";

type AppError =
  | (TaggedError<"NotFound"> & { id: string })
  | (TaggedError<"Unauthorized"> & { userId: string })
  | TaggedError<"RateLimited">;

const result: Box<Resource, AppError> = fetchResource("123");

// TypeScript enforces handling ALL error types
const message = result.matchExhaustive({
  ok: (resource) => `Found: ${resource.name}`,
  NotFound: (error) => `Resource ${error.id} not found`,
  Unauthorized: (error) => `User ${error.userId} not authorized`,
  RateLimited: () => `Too many requests, try again later`,
  // Missing any handler = compile-time error!
});
```

### Side Effects with tap() and tapErr()

Use `tap()` and `tapErr()` for debugging, logging, or other side effects without
changing the value:

```typescript
import { Box } from "@kukalajet/kismet";

const result = Box.ok({ id: 1, name: "Alice" })
  .tap((user) => console.log(`Processing user: ${user.name}`))
  .map((user) => user.id)
  .tap((id) => console.log(`User ID: ${id}`))
  .unwrapOr(0);

// With error logging
Box.fail("NetworkError", { statusCode: 503 })
  .tapErr((e) => console.error(`[${e._tag}] Status: ${e.statusCode}`))
  .catchAll(() => Box.ok("fallback"));
```

### Async Operations with AsyncBox

`AsyncBox` provides the same fluent API for async operations:

```typescript
import { AsyncBox } from "@kukalajet/kismet";

const result = await AsyncBox.fromPromise(
  fetch("/api/user"),
  (e) => ({ _tag: "FetchError" as const, message: String(e) }),
)
  .flatMap((response) => parseJSON(response))
  .catchTag("ParseError", () => AsyncBox.ok(defaultUser))
  .unwrapOr(null);
```

### Wrapping Async Functions with AsyncBox.wrap()

`AsyncBox.wrap()` provides an ergonomic way to convert async functions to
AsyncBox:

```typescript
import { AsyncBox } from "@kukalajet/kismet";

// Simple: uses UnknownError for any exceptions
const result = AsyncBox.wrap(() => fetch("/api/data"));
// Type: AsyncBox<Response, UnknownError>

// With custom error handling (like Effect.tryPromise)
const result = AsyncBox.wrap({
  try: () => fetch("/api/data"),
  catch: (error) => ({
    _tag: "FetchError" as const,
    message: error instanceof Error ? error.message : String(error),
  }),
});
// Type: AsyncBox<Response, { _tag: "FetchError"; message: string }>

// Chain multiple async operations
const userName = await AsyncBox.wrap(() => fetch("/api/user"))
  .flatMap((response) => AsyncBox.wrap(() => response.json()))
  .map((user) => user.name)
  .tap((name) => console.log(`Fetched: ${name}`))
  .tapErr((e) => console.error(`Failed: ${e.message}`))
  .unwrapOr("Unknown");
```

### Async Side Effects

`tap()` and `tapErr()` support async handlers in AsyncBox:

```typescript
import { AsyncBox } from "@kukalajet/kismet";

await AsyncBox.ok(user)
  .tap(async (u) => await analytics.track("user_loaded", u.id))
  .tapErr(async (e) => await logger.error("Failed", e))
  .map((u) => u.name)
  .unwrapOr("");
```

## Core API

### Box API

```typescript
class Box<T, E> {
  // Constructors
  static ok<T>(value: T): Box<T, never>;
  static err<E>(error: E): Box<never, E>;
  static fail<Tag>(tag: Tag, props?: Props): Box<never, TaggedError<Tag>>;
  static from<T, E>(fn: () => T, onError: (e) => E): Box<T, E>;

  // Transformations
  map<U>(fn: (value: T) => U): Box<U, E>;
  mapErr<F>(fn: (error: E) => F): Box<T, F>;
  flatMap<U, F>(fn: (value: T) => Box<U, F>): Box<U, E | F>;

  // Side effects
  tap(fn: (value: T) => void): Box<T, E>;
  tapErr(fn: (error: E) => void): Box<T, E>;

  // Error handling
  catchTag<Tag>(
    tag: Tag,
    handler: (e) => Box<T, F>,
  ): Box<T, RemainingErrors | F>;
  catchAll<F>(handler: (error: E) => Box<T, F>): Box<T, F>;
  orElseTag<Tag>(tag: Tag, fallback: T): Box<T, ExcludeByTag<E, Tag>>;

  // Pattern matching
  match<R>(config: { ok: (T) => R; err: (E) => R }): R;
  matchExhaustive<R>(config: MatchConfig<T, E, R>): R;

  // Extraction
  unwrapOr(defaultValue: T): T;
  unwrap(): T; // Only when E = never
  toResult(): Result<T, E>;

  // Inspection
  isOk(): boolean;
  isErr(): boolean;
}
```

### AsyncBox API

Same methods as `Box` but returns `AsyncBox<T, E>` or `Promise<T>`:

```typescript
class AsyncBox<T, E> {
  // Constructors
  static ok<T>(value: T): AsyncBox<T, never>
  static err<E>(error: E): AsyncBox<never, E>
  static fail<Tag>(tag: Tag, props?: Props): AsyncBox<never, TaggedError<Tag>>
  static fromPromise<T, E>(promise: Promise<T>, onError: (e) => E): AsyncBox<T, E>
  
  // Wrapping async functions
  static wrap<T>(fn: () => Promise<T>): AsyncBox<T, UnknownError>
  static wrap<T, E>(config: { try: () => Promise<T>; catch: (e) => E }): AsyncBox<T, E>
  
  // Transformations (same as Box)
  map, mapErr, flatMap
  
  // Side effects (support async handlers)
  tap(fn: (value: T) => void | Promise<void>): AsyncBox<T, E>
  tapErr(fn: (error: E) => void | Promise<void>): AsyncBox<T, E>
  
  // Error handling (same as Box)
  catchTag, catchAll
  
  // Pattern matching (async)
  match<R>(config): Promise<R>
  matchExhaustive<R>(config): Promise<R>
  
  // Extraction
  unwrapOr(defaultValue: T): Promise<T>
  run(): Promise<Result<T, E>>
}
```

### Tagged Errors

```typescript
// Define typed error sets
defineErrors({
  ErrorName: { prop1: t.string, prop2: t.number },
  SimpleError: undefined,
});

// Type helpers
t.string,
  t.number,
  t.boolean,
  t.array<T>(),
  t.optional<T>(),
  t.nullable<T>(),
  t.type<T>();

// Error class creation (for instanceof checks)
makeTaggedError<Tag, Props>(tag);

// Standard error for unknown exceptions
type UnknownError = TaggedError<"UnknownError"> & {
  cause: unknown;
  message: string;
};
```

### Type Utilities

```typescript
// Extract types from error definitions
ErrorsOf<Definitions>; // Union of all errors
ErrorOf<Result>; // Error type from Result
SuccessOf<Result>; // Success type from Result

// Tag manipulation
TagOf<Error>; // Extract tag literal
AllTags<ErrorUnion>; // All tag literals
ErrorByTag<Union, Tag>; // Extract specific error
ExcludeByTag<Union, Tag>; // Remove specific error
```

## Use Cases

- **API Clients**: Type-safe HTTP error handling with specific error codes
- **Form Validation**: Multiple validation error types with field-level details
- **File I/O**: Predictable error handling for read/write operations
- **Database Operations**: Typed errors for not found, duplicate key, timeout,
  etc.
- **Complex Async Workflows**: Chain operations with automatic error propagation

## Philosophy

Kismet brings Rust's approach to error handling into TypeScript:

1. **Errors as Values**: Errors are returned, not thrown, making them visible in
   type signatures
2. **Explicit Error Handling**: The type system enforces handling errors at
   compile time
3. **Error Composition**: Errors accumulate through operations, maintaining full
   type information
4. **Zero Cost Abstraction**: Simple objects with no runtime overhead beyond
   standard TypeScript

## Development

```bash
# Run tests
deno test

# Run tests in watch mode
deno task dev
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
