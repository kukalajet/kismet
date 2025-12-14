import {
  type AllTags,
  type ErrorByTag,
  type TaggedError,
  type UnknownError,
  unknownError,
} from "./error.ts";
import { type MatchConfig, matchExhaustive } from "./matcher.ts";
import { err, isErr, isOk, ok, type Result } from "./result.ts";

/**
 * Configuration for `AsyncBox.wrap()` with custom error handling.
 *
 * @typeParam T - The success type of the async operation
 * @typeParam E - The error type returned by the catch handler
 */
type WrapConfig<T, E> = {
  /** The async function to execute */
  try: () => Promise<T>;
  /** Handler to convert unknown errors to a typed error */
  catch: (error: unknown) => E;
};

/**
 * Async version of ResultBox for handling Promise-based operations.
 * Provides the same error tracking and chaining capabilities for async code.
 *
 * @typeParam T - The success value type
 * @typeParam E - The error type
 *
 * @example
 * ```typescript
 * type FetchError = TaggedError<"FetchError"> & { statusCode: number };
 * type ParseError = TaggedError<"ParseError">;
 *
 * function fetchJson(url: string): AsyncBox<unknown, FetchError> {
 *   return AsyncBox.fromPromise(
 *     fetch(url).then(r => {
 *       if (!r.ok) throw { statusCode: r.status };
 *       return r.json();
 *     }),
 *     (e) => ({ _tag: "FetchError", statusCode: (e as any).statusCode ?? 0 })
 *   );
 * }
 *
 * function parseUser(data: unknown): AsyncBox<User, ParseError> {
 *   // ... validation logic
 * }
 *
 * // Chain async operations with type-safe error accumulation
 * const result = fetchJson("/api/user")
 *   .flatMap(data => parseUser(data))
 *   .map(user => user.name);
 * // Type: AsyncBox<string, FetchError | ParseError>
 *
 * // Execute and handle the result
 * const name = await result.match({
 *   ok: (name) => name,
 *   err: (error) => "Unknown",
 * });
 * ```
 */
export class AsyncBox<T, E> {
  private constructor(private readonly promise: Promise<Result<T, E>>) {}

  /**
   * Create an AsyncBox from a Promise, converting rejections to errors.
   *
   * @typeParam T - The type of the resolved value
   * @typeParam E - The type of the converted error
   * @param promise - The Promise to wrap
   * @param onError - Function to convert rejected values to errors
   * @returns An AsyncBox wrapping the Promise
   *
   * @example
   * ```typescript
   * // Wrap a fetch call
   * const result = AsyncBox.fromPromise(
   *   fetch("/api/data").then(r => r.json()),
   *   (e) => ({ _tag: "FetchError" as const, message: String(e) })
   * );
   *
   * // Wrap any async operation
   * const fileContent = AsyncBox.fromPromise(
   *   fs.promises.readFile("config.json", "utf-8"),
   *   (e) => ({ _tag: "FileError" as const, path: "config.json" })
   * );
   * ```
   */
  static fromPromise<T, E>(
    promise: Promise<T>,
    onError: (e: unknown) => E,
  ): AsyncBox<T, E> {
    return new AsyncBox(promise.then(ok<T, E>).catch((e) => err(onError(e))));
  }

  /**
   * Create a successful AsyncBox.
   *
   * @typeParam T - The type of the success value
   * @typeParam E - The error type (defaults to `never`)
   * @param value - The success value
   * @returns An AsyncBox in the Ok state
   *
   * @example
   * ```typescript
   * const result = AsyncBox.ok(42);
   * const value = await result.unwrapOr(0); // 42
   * ```
   */
  static ok<T, E = never>(value: T): AsyncBox<T, E> {
    return new AsyncBox(Promise.resolve(ok(value)));
  }

  /**
   * Create a failed AsyncBox.
   *
   * @typeParam E - The type of the error value
   * @typeParam T - The success type (defaults to `never`)
   * @param error - The error value
   * @returns An AsyncBox in the Err state
   *
   * @example
   * ```typescript
   * const result = AsyncBox.err({ _tag: "NotFound", id: "123" });
   * const value = await result.unwrapOr(null); // null
   * ```
   */
  static err<E, T = never>(error: E): AsyncBox<T, E> {
    return new AsyncBox(Promise.resolve(err(error)));
  }

  /**
   * Create a typed error AsyncBox with a specific tag.
   *
   * @typeParam Tag - The tag string literal type
   * @typeParam Props - Additional properties for the error
   * @param tag - The error tag
   * @param props - Optional additional properties
   * @returns An AsyncBox in the Err state with a tagged error
   *
   * @example
   * ```typescript
   * const notFound = AsyncBox.fail("NotFound", { resourceId: "123" });
   * // Type: AsyncBox<never, TaggedError<"NotFound"> & { resourceId: string }>
   * ```
   */
  static fail<Tag extends string, Props extends Record<string, unknown>>(
    tag: Tag,
    props?: Props,
  ): AsyncBox<never, TaggedError<Tag> & Props> {
    return AsyncBox.err({ _tag: tag, ...props } as TaggedError<Tag> & Props);
  }

  /**
   * Wrap an async function, converting exceptions to typed errors.
   *
   * **Simple overload:** Pass a function directly to get `UnknownError` on failure.
   *
   * **Config overload:** Pass `{ try, catch }` for custom error handling with
   * full type inference.
   *
   * @example
   * ```typescript
   * // Simple: uses UnknownError for any exceptions
   * const result = AsyncBox.wrap(() => fetch("/api/data"));
   * // Type: AsyncBox<Response, UnknownError>
   *
   * // Config: custom error type with full inference
   * const result = AsyncBox.wrap({
   *   try: () => fetch("/api/data"),
   *   catch: (error) => ({
   *     _tag: "FetchError" as const,
   *     message: error instanceof Error ? error.message : String(error),
   *   }),
   * });
   * // Type: AsyncBox<Response, { _tag: "FetchError"; message: string }>
   *
   * // Chain with other operations
   * const userName = await AsyncBox.wrap(() => fetch("/api/user"))
   *   .flatMap(response => AsyncBox.wrap(() => response.json()))
   *   .map(user => user.name)
   *   .unwrapOr("Unknown");
   * ```
   */
  static wrap<T>(fn: () => Promise<T>): AsyncBox<T, UnknownError>;
  static wrap<T, E extends TaggedError>(
    config: WrapConfig<T, E>,
  ): AsyncBox<T, E>;
  static wrap<T, E extends TaggedError>(
    fnOrConfig: (() => Promise<T>) | WrapConfig<T, E>,
  ): AsyncBox<T, UnknownError | E> {
    if (typeof fnOrConfig === "function") {
      return AsyncBox.fromPromise(fnOrConfig(), unknownError);
    }
    return AsyncBox.fromPromise(fnOrConfig.try(), fnOrConfig.catch);
  }

  /**
   * Transform the success value using the provided function.
   *
   * @typeParam U - The type of the transformed value
   * @param fn - Function to transform the success value
   * @returns A new AsyncBox with the transformed value
   *
   * @example
   * ```typescript
   * const result = AsyncBox.ok({ id: 1, name: "Alice" })
   *   .map(user => user.name)
   *   .map(name => name.toUpperCase());
   *
   * const name = await result.unwrapOr(""); // "ALICE"
   * ```
   */
  map<U>(this: AsyncBox<T, E>, fn: (value: T) => U): AsyncBox<U, E> {
    return new AsyncBox(
      this.promise.then((r) => (isOk(r) ? ok(fn(r.value)) : r)),
    );
  }

  /**
   * Transform the error value using the provided function.
   *
   * @typeParam F - The type of the transformed error
   * @param fn - Function to transform the error
   * @returns A new AsyncBox with the transformed error
   *
   * @example
   * ```typescript
   * const result = AsyncBox.err({ code: 404 })
   *   .mapErr(e => ({ ...e, _tag: "HttpError" as const }));
   * ```
   */
  mapErr<F>(this: AsyncBox<T, E>, fn: (error: E) => F): AsyncBox<T, F> {
    return new AsyncBox(
      this.promise.then((r) => (isErr(r) ? err(fn(r.error)) : r)),
    );
  }

  /**
   * Execute a side effect on the success value without changing it.
   * If this is an Err, the function is not called.
   * The handler can be sync or async.
   *
   * @param fn - Function to execute with the success value
   * @returns The same AsyncBox unchanged
   *
   * @example
   * ```typescript
   * const result = await AsyncBox.ok(42)
   *   .tap(value => console.log(`Got value: ${value}`))
   *   .map(x => x * 2)
   *   .unwrapOr(0);
   * // Logs: "Got value: 42"
   * // result is 84
   *
   * // Async side effects
   * await AsyncBox.ok(user)
   *   .tap(async (u) => await analytics.track("user_loaded", u.id))
   *   .map(u => u.name);
   * ```
   */
  tap(
    this: AsyncBox<T, E>,
    fn: (value: T) => void | Promise<void>,
  ): AsyncBox<T, E> {
    return new AsyncBox(
      this.promise.then(async (r) => {
        if (isOk(r)) {
          await fn(r.value);
        }
        return r;
      }),
    );
  }

  /**
   * Execute a side effect on the error without changing it.
   * If this is Ok, the function is not called.
   * The handler can be sync or async.
   *
   * @param fn - Function to execute with the error value
   * @returns The same AsyncBox unchanged
   *
   * @example
   * ```typescript
   * const result = await AsyncBox.err({ code: 404 })
   *   .tapErr(error => console.error(`Error: ${error.code}`))
   *   .catchAll(() => AsyncBox.ok("default"))
   *   .unwrapOr("fallback");
   * // Logs: "Error: 404"
   * // result is "default"
   *
   * // Async error logging
   * await fetchUser(id)
   *   .tapErr(async (error) => await logger.error("Fetch failed", error))
   *   .unwrapOr(null);
   * ```
   */
  tapErr(
    this: AsyncBox<T, E>,
    fn: (error: E) => void | Promise<void>,
  ): AsyncBox<T, E> {
    return new AsyncBox(
      this.promise.then(async (r) => {
        if (isErr(r)) {
          await fn(r.error);
        }
        return r;
      }),
    );
  }

  /**
   * Chain async operations. Error types accumulate in the union.
   *
   * @typeParam U - The success type of the chained operation
   * @typeParam F - The error type of the chained operation
   * @param fn - Function returning an AsyncBox
   * @returns An AsyncBox with combined error types
   *
   * @example
   * ```typescript
   * function fetchUser(id: string): AsyncBox<User, FetchError> { ... }
   * function fetchPosts(userId: string): AsyncBox<Post[], FetchError> { ... }
   *
   * const result = fetchUser("123")
   *   .flatMap(user => fetchPosts(user.id));
   * // Type: AsyncBox<Post[], FetchError>
   * ```
   */
  flatMap<U, F>(
    this: AsyncBox<T, E>,
    fn: (value: T) => AsyncBox<U, F>,
  ): AsyncBox<U, E | F> {
    return new AsyncBox(
      // eslint-disable-next-line @typescript-eslint/promise-function-async
      this.promise.then((r) =>
        isOk(r) ? fn(r.value).run() : (r as Result<U, E | F>)
      ),
    );
  }

  /**
   * Recover from a specific error type by its tag.
   * The recovered error is removed from the error union.
   *
   * @typeParam Tag - The tag of the error to catch
   * @typeParam U - The success type of the recovery operation
   * @typeParam F - The error type of the recovery operation
   * @param tag - The error tag to match
   * @param handler - Async handler for the matched error
   * @returns An AsyncBox with the caught error removed
   *
   * @example
   * ```typescript
   * const result = fetchFromPrimary()
   *   .catchTag("NetworkError", () => fetchFromBackup());
   * // NetworkError is handled, other errors remain
   * ```
   */
  catchTag<Tag extends AllTags<E & TaggedError>, U, F>(
    this: AsyncBox<T, E>,
    tag: Tag,
    handler: (error: ErrorByTag<E & TaggedError, Tag>) => AsyncBox<U, F>,
  ): AsyncBox<T | U, Exclude<E, ErrorByTag<E & TaggedError, Tag>> | F> {
    return new AsyncBox(
      // eslint-disable-next-line @typescript-eslint/promise-function-async
      this.promise.then((r) => {
        if (isErr(r)) {
          const error = r.error as TaggedError;

          if (error._tag === tag) {
            return handler(
              error as ErrorByTag<E & TaggedError, Tag>,
            ).run() as Promise<
              Result<T | U, Exclude<E, ErrorByTag<E & TaggedError, Tag>> | F>
            >;
          }
        }

        return r as Result<
          T | U,
          Exclude<E, ErrorByTag<E & TaggedError, Tag>> | F
        >;
      }),
    );
  }

  /**
   * Catch all errors and attempt recovery.
   *
   * @typeParam U - The success type of the recovery operation
   * @typeParam F - The new error type
   * @param handler - Async handler for any error
   * @returns An AsyncBox with the new error type
   *
   * @example
   * ```typescript
   * const result = fetchData()
   *   .catchAll((error) => {
   *     console.error("Fetch failed:", error);
   *     return AsyncBox.ok(cachedData);
   *   });
   * ```
   */
  catchAll<U, F>(
    this: AsyncBox<T, E>,
    handler: (error: E) => AsyncBox<U, F>,
  ): AsyncBox<T | U, F> {
    return new AsyncBox(
      // eslint-disable-next-line @typescript-eslint/promise-function-async
      this.promise.then((r) =>
        isErr(r) ? handler(r.error).run() : (r as Result<T | U, F>)
      ),
    );
  }

  /**
   * Match on the result with separate handlers for Ok and Err.
   *
   * @typeParam R - The return type of both handlers
   * @param handlers - Object with `ok` and `err` handler functions
   * @returns A Promise resolving to the handler result
   *
   * @example
   * ```typescript
   * const message = await fetchUser("123").match({
   *   ok: (user) => `Hello, ${user.name}!`,
   *   err: (error) => `Error: ${error._tag}`,
   * });
   * ```
   */
  async match<R>(this: AsyncBox<T, E>, handlers: {
    ok: (value: T) => R;
    err: (error: E) => R;
  }): Promise<R> {
    const r = await this.promise;

    return isOk(r) ? handlers.ok(r.value) : handlers.err(r.error);
  }

  /**
   * Exhaustively match on the result, requiring handlers for each error type.
   *
   * @typeParam R - The return type of all handlers
   * @param config - Object with `ok` handler and a handler for each error tag
   * @returns A Promise resolving to the handler result
   *
   * @example
   * ```typescript
   * type AppError =
   *   | TaggedError<"NotFound">
   *   | TaggedError<"Unauthorized">;
   *
   * const message = await fetchResource().matchExhaustive({
   *   ok: (resource) => `Found: ${resource.name}`,
   *   NotFound: () => "Resource not found",
   *   Unauthorized: () => "Please log in",
   * });
   * ```
   */
  async matchExhaustive<R>(
    this: AsyncBox<T, E & TaggedError>,
    config: MatchConfig<T, E & TaggedError, R>,
  ): Promise<R> {
    const r = await this.promise;

    return matchExhaustive(r, config);
  }

  /**
   * Get the success value or return a default if this is an Err.
   *
   * @param defaultValue - The value to return if this is an Err
   * @returns A Promise resolving to the success value or default
   *
   * @example
   * ```typescript
   * const count = await fetchCount().unwrapOr(0);
   * ```
   */
  async unwrapOr(defaultValue: T): Promise<T> {
    const r = await this.promise;

    return isOk(r) ? r.value : defaultValue;
  }

  /**
   * Execute the async operation and get the underlying Result.
   *
   * @returns A Promise resolving to the Result
   *
   * @example
   * ```typescript
   * const result = await fetchUser("123").run();
   *
   * if (isOk(result)) {
   *   console.log(result.value.name);
   * } else {
   *   console.log(result.error._tag);
   * }
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  run(): Promise<Result<T, E>> {
    return this.promise;
  }
}
