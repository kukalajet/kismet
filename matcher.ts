import type { AllTags, ErrorByTag, TaggedError } from "./error.ts";
import { isOk, type Result } from "./result.ts";

/**
 * Pattern matchers for a specific error tag.
 * Creates an object type with a handler function for each error tag.
 */
type ErrorMatchers<E extends TaggedError, R> = {
  [Tag in AllTags<E>]: (error: ErrorByTag<E, Tag>) => R;
};

/**
 * Full match configuration with ok handler and all error handlers.
 * Used by `matchExhaustive` to ensure all cases are handled.
 */
export type MatchConfig<T, E extends TaggedError, R> = {
  ok: (value: T) => R;
} & ErrorMatchers<E, R>;

/**
 * Exhaustively match on a Result, handling the Ok case and each error type by tag.
 * TypeScript will produce a compile-time error if any error type is not handled.
 *
 * @typeParam T - The success value type
 * @typeParam E - The tagged error union type
 * @typeParam R - The return type of all handlers
 * @param result - The Result to match on
 * @param config - Object with `ok` handler and a handler for each error tag
 * @returns The result of the matched handler
 * @throws Error if an unhandled error tag is encountered at runtime
 *
 * @example
 * ```typescript
 * type AppError =
 *   | (TaggedError<"NotFound"> & { id: string })
 *   | (TaggedError<"Unauthorized"> & { userId: string });
 *
 * function fetchResource(id: string): Result<Resource, AppError> {
 *   // ... implementation
 * }
 *
 * const result = fetchResource("123");
 *
 * // All error types must be handled - TypeScript will error if you miss one!
 * const message = matchExhaustive(result, {
 *   ok: (resource) => `Found: ${resource.name}`,
 *   NotFound: (error) => `Resource ${error.id} not found`,
 *   Unauthorized: (error) => `User ${error.userId} not authorized`,
 * });
 *
 * // This would cause a TypeScript error (missing "Unauthorized"):
 * // const message = matchExhaustive(result, {
 * //   ok: (resource) => `Found: ${resource.name}`,
 * //   NotFound: (error) => `Not found`,
 * // });
 * ```
 */
export const matchExhaustive = <T, E extends TaggedError, R>(
  result: Result<T, E>,
  config: MatchConfig<T, E, R>,
): R => {
  if (isOk(result)) {
    return config.ok(result.value);
  }

  const { error } = result;
  const handler = (config as unknown as Record<string, (error: E) => R>)[
    error._tag
  ];

  if (!handler) {
    throw new Error(`Unhandled error tag: ${error._tag}`);
  }

  return handler(error);
};
