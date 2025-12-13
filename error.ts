/**
 * Base interface for all typed errors.
 * The `_tag` field enables discriminated unions and exhaustive checking.
 *
 * @typeParam Tag - A string literal type that uniquely identifies the error type
 *
 * @example
 * ```typescript
 * type NetworkError = TaggedError<"NetworkError"> & { statusCode: number };
 *
 * const networkError: NetworkError = {
 *   _tag: "NetworkError",
 *   statusCode: 500
 * };
 * ```
 */
export type TaggedError<Tag extends string = string> = {
  readonly _tag: Tag;
};

/**
 * Helper function to create error constructors with a specific tag.
 * Returns a factory function that creates tagged error objects.
 *
 * @typeParam Tag - The string literal type for the error tag
 * @param tag - The tag string that identifies this error type
 * @returns A factory function that creates tagged error objects
 *
 * @example
 * ```typescript
 * // Create a simple error without additional properties
 * const NotFoundError = TaggedError("NotFound");
 * const error = NotFoundError();
 * // Result: { _tag: "NotFound" }
 *
 * // Create an error with additional properties
 * const ValidationError = TaggedError("ValidationError");
 * const validationErr = ValidationError({ field: "email", message: "Invalid format" });
 * // Result: { _tag: "ValidationError", field: "email", message: "Invalid format" }
 * ```
 */
const TaggedError = <Tag extends string>(tag: Tag) => {
  return <A extends Record<string, unknown> = Record<string, never>>(
    props?: A,
  ): TaggedError<Tag> & A => ({ _tag: tag, ...(props as A) });
};

/**
 * Create a tagged error class for `instanceof` checks and richer error objects.
 * The returned class extends `Error` and implements `TaggedError`.
 *
 * @typeParam Tag - The string literal type for the error tag
 * @typeParam Props - The type of additional properties the error holds
 * @param tag - The tag string that identifies this error type
 * @returns A class constructor for creating tagged error instances
 *
 * @example
 * ```typescript
 * // Define a typed error class
 * const DatabaseError = makeTaggedError<"DatabaseError", { query: string; code: number }>("DatabaseError");
 *
 * // Create an instance
 * const dbError = new DatabaseError({ query: "SELECT * FROM users", code: 1045 });
 *
 * // Use instanceof for type narrowing
 * if (dbError instanceof DatabaseError) {
 *   console.log(dbError.props.query); // "SELECT * FROM users"
 *   console.log(dbError.props.code);  // 1045
 *   console.log(dbError._tag);        // "DatabaseError"
 * }
 *
 * // It also works with try/catch
 * try {
 *   throw new DatabaseError({ query: "INSERT INTO...", code: 1062 });
 * } catch (e) {
 *   if (e instanceof DatabaseError) {
 *     console.log(`Query failed: ${e.props.query}`);
 *   }
 * }
 * ```
 */
export const makeTaggedError = <
  Tag extends string,
  Props extends Record<string, unknown>,
>(
  tag: Tag,
) => {
  return class extends Error implements TaggedError<Tag> {
    readonly _tag = tag;
    constructor(public readonly props: Props) {
      super(`${tag}: ${JSON.stringify(props)}`);
      this.name = tag;
    }
  };
};
