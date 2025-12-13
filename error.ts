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

/**
 * Type helper functions for defining error property types.
 * These provide a more ergonomic syntax than casting (e.g., "" as string).
 *
 * @example
 * ```typescript
 * const UserErrors = defineErrors({
 *   NotFound: { userId: t.string },
 *   InvalidAge: { age: t.number },
 *   IsActive: { active: t.boolean },
 * });
 * ```
 */
export const t = {
  /** Define a string property */
  string: "" as string,
  /** Define a number property */
  number: 0 as number,
  /** Define a boolean property */
  boolean: false as boolean,
  /** Define a bigint property */
  bigint: 0n as bigint,
  /** Define a symbol property */
  symbol: Symbol(),
  /** Define a Date property */
  date: new Date(),
  /** Define an array property of a specific type */
  array: <T>(): T[] => [] as T[],
  /** Define an optional property of a specific type */
  optional: <T>(): T | undefined => undefined as T | undefined,
  /** Define a nullable property of a specific type */
  nullable: <T>(): T | null => null as T | null,
  /** Define a custom type property */
  type: <T>(): T => undefined as T,
} as const;

/**
 * Define a set of typed errors for a module or domain.
 * Creates factory functions for each error type with proper typing.
 *
 * @typeParam Defs - Object mapping error tags to their property types
 * @param definitions - Object defining error tags and their properties
 * @returns An object with factory functions for each error type
 *
 * @example
 * ```typescript
 * // Define errors for a user module using type helpers
 * const UserErrors = defineErrors({
 *   NotFound: { userId: t.string },
 *   InvalidEmail: { email: t.string },
 *   InvalidAge: { age: t.number, reason: t.string },
 *   Unauthorized: undefined, // No additional properties
 * });
 *
 * // Or use the old syntax (still supported)
 * const UserErrors = defineErrors({
 *   NotFound: { userId: "" as string },
 *   InvalidEmail: { email: "" as string },
 *   AlreadyExists: { email: "" as string },
 *   Unauthorized: undefined,
 * });
 *
 * // Create error instances
 * const notFound = UserErrors.NotFound({ userId: "123" });
 * // Type: { _tag: "NotFound", userId: string }
 *
 * const invalidEmail = UserErrors.InvalidEmail({ email: "bad" });
 * // Type: { _tag: "InvalidEmail", email: string }
 *
 * const unauthorized = UserErrors.Unauthorized();
 * // Type: { _tag: "Unauthorized" }
 *
 * // Use with Result
 * function findUser(id: string): Result<User, ErrorsOf<typeof UserErrors>> {
 *   const user = users.find(u => u.id === id);
 *   if (!user) {
 *     return err(UserErrors.NotFound({ userId: id }));
 *   }
 *   return ok(user);
 * }
 * ```
 */
export const defineErrors = <
  Defs extends Record<string, Record<string, unknown> | undefined>,
>(
  definitions: Defs,
): {
  [K in keyof Defs]: Defs[K] extends Record<string, unknown>
    ? (props: Defs[K]) => TaggedError<K & string> & Defs[K]
    : () => TaggedError<K & string>;
} => {
  const result = {} as {
    [K in keyof Defs]: Defs[K] extends Record<string, unknown>
      ? (props: Defs[K]) => TaggedError<K & string> & Defs[K]
      : () => TaggedError<K & string>;
  };

  for (const tag of Object.keys(definitions)) {
    result[tag as keyof Defs] = ((props?: Record<string, unknown>) => ({
      _tag: tag,
      ...props,
    })) as {
      [K in keyof Defs]: Defs[K] extends Record<string, unknown>
        ? (props: Defs[K]) => TaggedError<K & string> & Defs[K]
        : () => TaggedError<K & string>;
    }[keyof Defs];
  }

  return result;
};

/**
 * Infer the error union type from error definitions created by `defineErrors`.
 *
 * @typeParam D - The type of the error definitions object
 * @returns A union of all possible error types
 *
 * @example
 * ```typescript
 * const ApiErrors = defineErrors({
 *   NetworkError: { statusCode: 0 as number },
 *   ParseError: { message: "" as string },
 *   Timeout: undefined,
 * });
 *
 * type ApiError = ErrorsOf<typeof ApiErrors>;
 * // Type: (TaggedError<"NetworkError"> & { statusCode: number })
 * //     | (TaggedError<"ParseError"> & { message: string })
 * //     | TaggedError<"Timeout">
 *
 * // Use in function signatures
 * function fetchData(): Result<Data, ApiError> {
 *   // ... implementation
 * }
 * ```
 */
// deno-lint-ignore no-explicit-any
export type ErrorsOf<D> = D extends Record<string, (...args: any) => infer E>
  ? E
  : never;
