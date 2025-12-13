import type {
  AllTags,
  ErrorByTag,
  ExcludeByTag,
  TaggedError,
} from "./error.ts";
import { type MatchConfig, matchExhaustive } from "./matcher.ts";
import { err, isErr, isOk, ok, type Result } from "./result.ts";

/**
 * A wrapper class providing a fluent API for working with Results.
 * Enables chaining of operations while maintaining type-safe error tracking.
 *
 * @typeParam T - The success value type
 * @typeParam E - The error type
 *
 * @example
 * ```typescript
 * // Basic usage with chaining
 * const result = Box.ok(10)
 *   .map(x => x * 2)
 *   .map(x => x + 5)
 *   .unwrap(); // 25
 *
 * // Error handling with type tracking
 * type ParseError = TaggedError<"ParseError"> & { input: string };
 * type NetworkError = TaggedError<"NetworkError"> & { code: number };
 *
 * function parseData(input: string): Box<Data, ParseError> {
 *   // ... implementation
 * }
 *
 * function sendData(data: Data): Box<Response, NetworkError> {
 *   // ... implementation
 * }
 *
 * // Error types accumulate through flatMap
 * const result = parseData(rawInput)
 *   .flatMap(data => sendData(data));
 * // Type: Box<Response, ParseError | NetworkError>
 *
 * // Handle specific errors
 * const handled = result
 *   .catchTag("NetworkError", (err) =>
 *     Box.ok({ status: "offline", cached: true })
 *   );
 * // Type: Box<Response | { status: string; cached: boolean }, ParseError>
 * ```
 */
export class Box<T, E> {
  private constructor(private readonly result: Result<T, E>) {}

  /**
   * Create a successful Box containing a value.
   *
   * @typeParam T - The type of the success value
   * @typeParam E - The error type (defaults to `never`)
   * @param value - The success value to wrap
   * @returns A Box in the Ok state
   *
   * @example
   * ```typescript
   * const result = Box.ok(42);
   * console.log(result.unwrap()); // 42
   *
   * const user = Box.ok({ id: 1, name: "Alice" });
   * console.log(user.unwrap().name); // "Alice"
   * ```
   */
  static ok<T, E = never>(value: T): Box<T, E> {
    return new Box(ok(value));
  }

  /**
   * Create a failed Box containing an error.
   *
   * @typeParam E - The type of the error value
   * @typeParam T - The success type (defaults to `never`)
   * @param error - The error value to wrap
   * @returns A Box in the Err state
   *
   * @example
   * ```typescript
   * const error = Box.err({ _tag: "NotFound", id: "123" });
   * console.log(error.isErr()); // true
   *
   * const result = Box.err(new Error("Something went wrong"));
   * console.log(result.unwrapOr("default")); // "default"
   * ```
   */
  static err<E, T = never>(error: E): Box<T, E> {
    return new Box(err(error));
  }

  /**
   * Create a Box from a function that might throw.
   * Catches any thrown errors and converts them using the provided handler.
   *
   * @typeParam T - The type of the success value
   * @typeParam E - The type of the converted error
   * @param fn - A function that might throw
   * @param onError - A function to convert caught errors to the error type
   * @returns A Box with either the function result or converted error
   *
   * @example
   * ```typescript
   * // Safely parse JSON
   * const result = Box.from(
   *   () => JSON.parse('{"name": "Alice"}'),
   *   (e) => ({ _tag: "ParseError" as const, message: String(e) })
   * );
   * // Type: Box<unknown, { _tag: "ParseError"; message: string }>
   *
   * // Wrap file system operations
   * const content = Box.from(
   *   () => fs.readFileSync("config.json", "utf-8"),
   *   (e) => ({ _tag: "FileError" as const, path: "config.json" })
   * );
   * ```
   */
  static from<T, E>(fn: () => T, onError: (e: unknown) => E): Box<T, E> {
    try {
      return Box.ok(fn());
    } catch (e) {
      return Box.err(onError(e));
    }
  }

  /**
   * Create a typed error Result with a specific tag.
   * Convenience method for creating tagged errors inline.
   *
   * @typeParam Tag - The tag string literal type
   * @typeParam Props - Additional properties for the error
   * @param tag - The error tag
   * @param props - Optional additional properties
   * @returns A Box in the Err state with a tagged error
   *
   * @example
   * ```typescript
   * // Simple tagged error
   * const notFound = Box.fail("NotFound");
   * // Type: Box<never, TaggedError<"NotFound">>
   *
   * // Tagged error with properties
   * const validationError = Box.fail("ValidationError", {
   *   field: "email",
   *   message: "Invalid email format"
   * });
   * // Type: Box<never, TaggedError<"ValidationError"> & { field: string; message: string }>
   * ```
   */
  static fail<Tag extends string, Props extends Record<string, unknown>>(
    tag: Tag,
    props?: Props,
  ): Box<never, TaggedError<Tag> & Props> {
    return Box.err({ _tag: tag, ...props } as TaggedError<Tag> & Props);
  }

  /**
   * Check if this Box contains a success value.
   *
   * @returns `true` if Ok, `false` if Err
   *
   * @example
   * ```typescript
   * const success = Box.ok(42);
   * console.log(success.isOk()); // true
   *
   * const failure = Box.err("error");
   * console.log(failure.isOk()); // false
   * ```
   */
  isOk(): boolean {
    return isOk(this.result);
  }

  /**
   * Check if this Box contains an error.
   *
   * @returns `true` if Err, `false` if Ok
   *
   * @example
   * ```typescript
   * const success = Box.ok(42);
   * console.log(success.isErr()); // false
   *
   * const failure = Box.err("error");
   * console.log(failure.isErr()); // true
   * ```
   */
  isErr(): boolean {
    return isErr(this.result);
  }

  /**
   * Transform the success value using the provided function.
   * If this is an Err, returns the error unchanged.
   *
   * @typeParam U - The type of the transformed value
   * @param fn - Function to transform the success value
   * @returns A new Box with the transformed value or original error
   *
   * @example
   * ```typescript
   * const result = Box.ok(5)
   *   .map(x => x * 2)
   *   .map(x => `Value: ${x}`);
   * console.log(result.unwrap()); // "Value: 10"
   *
   * // Errors pass through unchanged
   * const errResult = Box.err<string, number>("failed")
   *   .map(x => x * 2);
   * console.log(errResult.isErr()); // true
   * ```
   */
  map<U>(fn: (value: T) => U): Box<U, E> {
    return new Box(isOk(this.result) ? ok(fn(this.result.value)) : this.result);
  }

  /**
   * Transform the error value using the provided function.
   * If this is Ok, returns the success value unchanged.
   *
   * @typeParam F - The type of the transformed error
   * @param fn - Function to transform the error value
   * @returns A new Box with original value or transformed error
   *
   * @example
   * ```typescript
   * const result = Box.err({ code: 404 })
   *   .mapErr(e => ({ ...e, message: "Not found" }));
   * // Error is now: { code: 404, message: "Not found" }
   *
   * // Success values pass through unchanged
   * const okResult = Box.ok(42)
   *   .mapErr(e => "transformed");
   * console.log(okResult.unwrap()); // 42
   * ```
   */
  mapErr<F>(fn: (error: E) => F): Box<T, F> {
    return new Box(
      isErr(this.result) ? err(fn(this.result.error)) : this.result,
    );
  }

  /**
   * Chain operations that return Box. Error types accumulate in the union.
   * If this is an Err, the function is not called and the error is propagated.
   *
   * @typeParam U - The success type of the chained operation
   * @typeParam F - The error type of the chained operation
   * @param fn - Function that returns a Box
   * @returns A Box with combined error types (E | F)
   *
   * @example
   * ```typescript
   * type ParseError = TaggedError<"ParseError">;
   * type ValidationError = TaggedError<"ValidationError">;
   *
   * function parse(input: string): Box<number, ParseError> {
   *   const num = parseInt(input, 10);
   *   return isNaN(num)
   *     ? Box.fail("ParseError")
   *     : Box.ok(num);
   * }
   *
   * function validate(num: number): Box<number, ValidationError> {
   *   return num > 0
   *     ? Box.ok(num)
   *     : Box.fail("ValidationError");
   * }
   *
   * const result = parse("42").flatMap(validate);
   * // Type: Box<number, ParseError | ValidationError>
   *
   * const invalid = parse("abc").flatMap(validate);
   * // Returns ParseError, validate is never called
   * ```
   */
  flatMap<U, F>(fn: (value: T) => Box<U, F>): Box<U, E | F> {
    if (isOk(this.result)) {
      return fn(this.result.value) as Box<U, E | F>;
    }

    return this as unknown as Box<U, E | F>;
  }

  /**
   * Recover from a specific error type by its tag.
   * The recovered error type is removed from the error union.
   *
   * @typeParam Tag - The tag of the error to catch
   * @typeParam U - The success type of the recovery operation
   * @typeParam F - The error type of the recovery operation
   * @param tag - The error tag to match
   * @param handler - Function to handle the matched error
   * @returns A Box with the caught error removed from the union
   *
   * @example
   * ```typescript
   * type NotFound = TaggedError<"NotFound"> & { id: string };
   * type Forbidden = TaggedError<"Forbidden">;
   *
   * function getResource(id: string): Box<Resource, NotFound | Forbidden> {
   *   // ... implementation
   * }
   *
   * const result = getResource("123")
   *   .catchTag("NotFound", (error) => {
   *     console.log(`Creating new resource for ${error.id}`);
   *     return Box.ok(createDefaultResource(error.id));
   *   });
   * // Type: Box<Resource, Forbidden>
   * // NotFound is handled, only Forbidden can remain
   * ```
   */
  catchTag<Tag extends AllTags<E & TaggedError>, U, F>(
    tag: Tag,
    handler: (error: ErrorByTag<E & TaggedError, Tag>) => Box<U, F>,
  ): Box<T | U, ExcludeByTag<E, Tag> | F> {
    if (isErr(this.result)) {
      const error = this.result.error as TaggedError;

      if (error._tag === tag) {
        return handler(error as ErrorByTag<E & TaggedError, Tag>) as Box<
          T | U,
          ExcludeByTag<E, Tag> | F
        >;
      }
    }

    return this as unknown as Box<T | U, ExcludeByTag<E, Tag> | F>;
  }

  /**
   * Catch all errors and attempt recovery.
   * Replaces the entire error type with the handler's error type.
   *
   * @typeParam U - The success type of the recovery operation
   * @typeParam F - The new error type from the handler
   * @param handler - Function to handle any error
   * @returns A Box with the new error type
   *
   * @example
   * ```typescript
   * type NetworkError = TaggedError<"NetworkError">;
   * type CacheError = TaggedError<"CacheError">;
   *
   * function fetchData(): Box<Data, NetworkError> {
   *   // ... implementation
   * }
   *
   * function loadFromCache(): Box<Data, CacheError> {
   *   // ... implementation
   * }
   *
   * const result = fetchData()
   *   .catchAll((error) => {
   *     console.log("Network failed, trying cache...");
   *     return loadFromCache();
   *   });
   * // Type: Box<Data, CacheError>
   * ```
   */
  catchAll<U, F>(handler: (error: E) => Box<U, F>): Box<T | U, F> {
    if (isErr(this.result)) {
      return handler(this.result.error) as Box<T | U, F>;
    }

    return this as unknown as Box<T | U, F>;
  }

  /**
   * Provide a fallback value for a specific error tag.
   * The handled error type is removed from the error union.
   *
   * @typeParam Tag - The tag of the error to handle
   * @param tag - The error tag to match
   * @param fallback - The fallback value to use
   * @returns A Box with the handled error removed
   *
   * @example
   * ```typescript
   * type NotFound = TaggedError<"NotFound">;
   * type Forbidden = TaggedError<"Forbidden">;
   *
   * function getCount(): Box<number, NotFound | Forbidden> {
   *   // ... implementation
   * }
   *
   * const result = getCount()
   *   .orElseTag("NotFound", 0);
   * // Type: Box<number, Forbidden>
   * // If NotFound, returns 0. If Forbidden, error remains.
   * ```
   */
  orElseTag<Tag extends AllTags<E & TaggedError>>(
    tag: Tag,
    fallback: T,
  ): Box<T, ExcludeByTag<E, Tag>> {
    if (isErr(this.result)) {
      const error = this.result.error as TaggedError;

      if (error._tag === tag) {
        return Box.ok(fallback);
      }
    }

    return this as unknown as Box<T, ExcludeByTag<E, Tag>>;
  }

  /**
   * Match on the Result with separate handlers for Ok and Err.
   * Both handlers must return the same type.
   *
   * @typeParam R - The return type of both handlers
   * @param handlers - Object with `ok` and `err` handler functions
   * @returns The result of the matched handler
   *
   * @example
   * ```typescript
   * const result = Box.ok<number, string>(42);
   *
   * const message = result.match({
   *   ok: (value) => `Success: ${value}`,
   *   err: (error) => `Error: ${error}`,
   * });
   * console.log(message); // "Success: 42"
   *
   * // Pattern for converting to UI state
   * const uiState = fetchResult.match({
   *   ok: (data) => ({ loading: false, data, error: null }),
   *   err: (error) => ({ loading: false, data: null, error }),
   * });
   * ```
   */
  match<R>(handlers: { ok: (value: T) => R; err: (error: E) => R }): R {
    return isOk(this.result)
      ? handlers.ok(this.result.value)
      : handlers.err(this.result.error);
  }

  /**
   * Exhaustively match on the Result, requiring handlers for each error type.
   * TypeScript will error if any error tag is not handled.
   *
   * @typeParam R - The return type of all handlers
   * @param config - Object with `ok` handler and a handler for each error tag
   * @returns The result of the matched handler
   *
   * @example
   * ```typescript
   * type AppError =
   *   | (TaggedError<"NotFound"> & { id: string })
   *   | (TaggedError<"Unauthorized">)
   *   | (TaggedError<"RateLimited"> & { retryAfter: number });
   *
   * function fetchResource(id: string): Box<Resource, AppError> {
   *   // ... implementation
   * }
   *
   * const message = fetchResource("123").matchExhaustive({
   *   ok: (resource) => `Found: ${resource.name}`,
   *   NotFound: (e) => `Resource ${e.id} not found`,
   *   Unauthorized: () => `Please log in`,
   *   RateLimited: (e) => `Try again in ${e.retryAfter}s`,
   * });
   *
   * // Missing any handler causes a TypeScript error!
   * ```
   */
  matchExhaustive<R>(
    this: Box<T, E & TaggedError>,
    config: MatchConfig<T, E & TaggedError, R>,
  ): R {
    return matchExhaustive(this.result, config);
  }

  /**
   * Get the success value or return a default if this is an Err.
   *
   * @param defaultValue - The value to return if this is an Err
   * @returns The success value or the default
   *
   * @example
   * ```typescript
   * const result = Box.ok(42);
   * console.log(result.unwrapOr(0)); // 42
   *
   * const error = Box.err<string, number>("failed");
   * console.log(error.unwrapOr(0)); // 0
   *
   * // Useful for providing defaults
   * const config = loadConfig().unwrapOr(defaultConfig);
   * ```
   */
  unwrapOr(defaultValue: T): T {
    return isOk(this.result) ? this.result.value : defaultValue;
  }

  /**
   * Get the success value when all errors have been handled.
   * This method is only available when the error type is `never`,
   * ensuring exhaustive error handling at compile time.
   *
   * @returns The success value
   *
   * @example
   * ```typescript
   * // ✓ Compiles - all errors handled
   * const result = fetchDataWithRetry("/api/data")
   *   .catchTag("ConnectionTimeout", () => Box.ok("recovered"))
   *   .catchTag("ConnectionRefused", () => Box.ok("recovered"))
   *   .catchTag("DNSResolutionFailed", () => Box.ok("recovered"))
   *   .catchTag("InvalidJSON", () => Box.ok("recovered"))
   *   .catchTag("UnexpectedFormat", () => Box.ok("recovered"));
   * const value = result.unwrap(); // ✓ Safe!
   *
   * // ✗ Type error - not all errors handled
   * const partial = fetchDataWithRetry("/api/data")
   *   .catchTag("ConnectionTimeout", () => Box.ok("recovered"));
   * const value = partial.unwrap(); // ✗ Compile error!
   * // Error: Type 'ConnectionRefused | DNSResolutionFailed | ...' does not satisfy constraint 'never'
   * ```
   */
  unwrap(this: Box<T, never>): T {
    if (isOk(this.result)) {
      return this.result.value;
    }
    throw new Error(
      `Unwrap called on Err: ${JSON.stringify(this.result.error)}`,
    );
  }

  /**
   * Convert the Box back to a plain Result object.
   *
   * @returns The underlying Result<T, E>
   *
   * @example
   * ```typescript
   * const box = Box.ok(42);
   * const result = box.toResult();
   * // result: { _tag: "Ok", value: 42 }
   *
   * const errBox = Box.err("failed");
   * const errResult = errBox.toResult();
   * // errResult: { _tag: "Err", error: "failed" }
   * ```
   */
  toResult(): Result<T, E> {
    return this.result;
  }
}
