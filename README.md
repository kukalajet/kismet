# Kismet

A TypeScript/Deno library for type-safe error handling using Rust-inspired `Result` types with exhaustive pattern matching.

## Features

- **Type-Safe Error Handling**: Errors are explicitly typed in function signatures, not hidden in thrown exceptions
- **Tagged Error System**: Discriminated unions with string literal tags for precise error identification
- **Exhaustive Matching**: TypeScript enforces handling of all possible error cases at compile time
- **Fluent API**: Chain operations with `Box` and `AsyncBox` wrappers for ergonomic error handling
- **Zero Runtime Dependencies**: Built with Deno standard library only
- **Async Support**: First-class support for Promise-based workflows with `AsyncBox`

## Installation

```typescript
import { Result, ok, err } from "jsr:@kukalajet/kismet";
```

## Quick Start

### Basic Result Type

```typescript
import { Result, ok, err, isOk } from "@kukalajet/kismet";

function divide(a: number, b: number): Result<number, string> {
  if (b === 0) {
    return err("Division by zero");
  }
  return ok(a / b);
}

const result = divide(10, 2);
if (isOk(result)) {
  console.log(result.value); // 5
} else {
  console.log(result.error); // error message
}
```

### Tagged Errors

```typescript
import { defineErrors, type ErrorsOf } from "@kukalajet/kismet";

const UserErrors = defineErrors({
  NotFound: { userId: "" as string },
  InvalidEmail: { email: "" as string },
  Unauthorized: undefined, // No additional properties
});

function findUser(id: string): Result<User, ErrorsOf<typeof UserErrors>> {
  const user = users.find(u => u.id === id);
  if (!user) {
    return err(UserErrors.NotFound({ userId: id }));
  }
  if (!user.isActive) {
    return err(UserErrors.Unauthorized());
  }
  return ok(user);
}
```

### Fluent API with Box

```typescript
import { Box } from "@kukalajet/kismet";

const result = Box.ok(10)
  .map(x => x * 2)           // Transform success value
  .map(x => x + 5)           // Chain transformations
  .unwrapOr(0);              // Extract value with default

console.log(result); // 25
```

### Error Recovery

```typescript
type NetworkError = TaggedError<"NetworkError"> & { code: number };
type ParseError = TaggedError<"ParseError"> & { input: string };

const result = fetchData()
  .flatMap(data => parseData(data))
  .catchTag("NetworkError", (err) => 
    Box.ok({ status: "offline", cached: true })
  )
  .catchTag("ParseError", (err) => 
    Box.ok(getDefaultData())
  );
```

### Exhaustive Pattern Matching

```typescript
import { matchExhaustive } from "@kukalajet/kismet";

type AppError =
  | (TaggedError<"NotFound"> & { id: string })
  | (TaggedError<"Unauthorized"> & { userId: string })
  | TaggedError<"RateLimited">;

const result = fetchResource("123");

// TypeScript enforces handling ALL error types
const message = matchExhaustive(result, {
  ok: (resource) => `Found: ${resource.name}`,
  NotFound: (error) => `Resource ${error.id} not found`,
  Unauthorized: (error) => `User ${error.userId} not authorized`,
  RateLimited: () => `Too many requests, try again later`,
  // Missing any handler = compile-time error!
});
```

### Async Operations

```typescript
import { AsyncBox } from "@kukalajet/kismet";

const result = await AsyncBox.fromPromise(
  fetch("/api/user"),
  (e) => ({ _tag: "FetchError" as const, message: String(e) })
)
  .flatMap(response => parseJSON(response))
  .catchTag("ParseError", () => AsyncBox.ok(defaultUser))
  .unwrapOr(null);
```

## Core API

### Result Type

```typescript
type Result<T, E> = 
  | { _tag: "Ok"; value: T }
  | { _tag: "Err"; error: E };

// Constructors
ok<T, E>(value: T): Result<T, E>
err<E, T>(error: E): Result<T, E>

// Type guards
isOk<T, E>(result: Result<T, E>): result is OkVariant<T>
isErr<T, E>(result: Result<T, E>): result is ErrVariant<E>
```

### Tagged Errors

```typescript
// Define typed error sets
defineErrors({
  ErrorName: { prop1: t.string, prop2: t.number },
  SimpleError: undefined,
})

// Type helpers
t.string, t.number, t.boolean, t.array<T>(), 
t.optional<T>(), t.nullable<T>(), t.type<T>()

// Error class creation
makeTaggedError<Tag, Props>(tag)
```

### Box API

```typescript
class Box<T, E> {
  // Constructors
  static ok<T>(value: T): Box<T, never>
  static err<E>(error: E): Box<never, E>
  static fail<Tag>(tag: Tag, props?: Props): Box<never, TaggedError<Tag>>
  static from<T, E>(fn: () => T, onError: (e) => E): Box<T, E>

  // Transformations
  map<U>(fn: (value: T) => U): Box<U, E>
  mapErr<F>(fn: (error: E) => F): Box<T, F>
  flatMap<U, F>(fn: (value: T) => Box<U, F>): Box<U, E | F>

  // Error handling
  catchTag<Tag>(tag: Tag, handler: (e) => Box<T, F>): Box<T, RemainingErrors | F>
  catchAll<F>(handler: (error: E) => Box<T, F>): Box<T, F>
  orElseTag<Tag>(tag: Tag, fallback: T): Box<T, ExcludeByTag<E, Tag>>

  // Pattern matching
  match<R>(config: { ok: (T) => R; err: (E) => R }): R
  matchExhaustive<R>(config: MatchConfig<T, E, R>): R

  // Extraction
  unwrapOr(defaultValue: T): T
  unwrap(): T  // Only when E = never
  toResult(): Result<T, E>

  // Inspection
  isOk(): boolean
  isErr(): boolean
}
```

### AsyncBox API

Same methods as `Box` but returns `AsyncBox<T, E>` or `Promise<T>`:

```typescript
class AsyncBox<T, E> {
  // Additional constructor
  static fromPromise<T, E>(promise: Promise<T>, onError: (e) => E): AsyncBox<T, E>
  
  // All Box methods (async versions)
  map, flatMap, catchTag, match, unwrapOr, etc.
  
  // Execute the async chain
  run(): Promise<Result<T, E>>
}
```

### Type Utilities

```typescript
// Extract types from error definitions
ErrorsOf<Definitions>      // Union of all errors
ErrorOf<Result>            // Error type from Result
SuccessOf<Result>          // Success type from Result

// Tag manipulation
TagOf<Error>               // Extract tag literal
AllTags<ErrorUnion>        // All tag literals
ErrorByTag<Union, Tag>     // Extract specific error
ExcludeByTag<Union, Tag>   // Remove specific error
```

## Use Cases

- **API Clients**: Type-safe HTTP error handling with specific error codes
- **Form Validation**: Multiple validation error types with field-level details
- **File I/O**: Predictable error handling for read/write operations
- **Database Operations**: Typed errors for not found, duplicate key, timeout, etc.
- **Complex Async Workflows**: Chain operations with automatic error propagation

## Philosophy

Kismet brings Rust's approach to error handling into TypeScript:

1. **Errors as Values**: Errors are returned, not thrown, making them visible in type signatures
2. **Explicit Error Handling**: The type system enforces handling errors at compile time
3. **Error Composition**: Errors accumulate through operations, maintaining full type information
4. **Zero Cost Abstraction**: Simple objects with no runtime overhead beyond standard TypeScript

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
