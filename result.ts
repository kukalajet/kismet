type OkVariant<T> = {
	readonly _tag: "Ok";
	readonly value: T;
};

type ErrVariant<E> = {
	readonly _tag: "Err";
	readonly error: E;
};

/**
 * The core Result type - a discriminated union representing either success (`Ok`) or failure (`Err`).
 * Use this type for functions that can fail in predictable ways.
 *
 * @typeParam T - The type of the success value
 * @typeParam E - The type of the error value
 *
 * @example
 * ```typescript
 * function divide(a: number, b: number): Result<number, TaggedError<"DivisionByZero">> {
 *   if (b === 0) {
 *     return err({ _tag: "DivisionByZero" });
 *   }
 *   return ok(a / b);
 * }
 *
 * const result = divide(10, 2);
 * if (isOk(result)) {
 *   console.log(result.value); // 5
 * } else {
 *   console.log(result.error._tag); // "DivisionByZero"
 * }
 * ```
 */
export type Result<T, E> = OkVariant<T> | ErrVariant<E>;

/**
 * Creates an Ok Result containing a success value.
 *
 * @typeParam T - The type of the success value
 * @typeParam E - The error type (defaults to `never` for type inference)
 * @param value - The success value to wrap
 * @returns A Result in the Ok state
 *
 * @example
 * ```typescript
 * // Simple usage
 * const result = ok(42);
 * // Type: Result<number, never>
 *
 * // With explicit error type
 * const result2 = ok<string, Error>("success");
 * // Type: Result<string, Error>
 *
 * // In a function
 * function fetchUser(id: number): Result<User, NotFoundError> {
 *   const user = users.find(u => u.id === id);
 *   if (user) {
 *     return ok(user);
 *   }
 *   return err({ _tag: "NotFound", id });
 * }
 * ```
 */
export const ok = <T, E = never>(value: T): Result<T, E> => ({
	_tag: "Ok",
	value,
});

/**
 * Creates an Err Result containing an error value.
 *
 * @typeParam E - The type of the error value
 * @typeParam T - The success type (defaults to `never` for type inference)
 * @param error - The error value to wrap
 * @returns A Result in the Err state
 *
 * @example
 * ```typescript
 * // Simple usage
 * const result = err("Something went wrong");
 * // Type: Result<never, string>
 *
 * // With tagged error
 * const result2 = err({ _tag: "ValidationError", field: "email" });
 * // Type: Result<never, { _tag: "ValidationError", field: string }>
 *
 * // In a function
 * function parseNumber(str: string): Result<number, TaggedError<"ParseError">> {
 *   const num = parseInt(str, 10);
 *   if (isNaN(num)) {
 *     return err({ _tag: "ParseError" });
 *   }
 *   return ok(num);
 * }
 * ```
 */
export const err = <E, T = never>(error: E): Result<T, E> => ({
	_tag: "Err",
	error,
});

/**
 * Type guard that checks if a Result is an Ok variant.
 * Narrows the type to `OkVariant<T>` when true.
 *
 * @typeParam T - The success value type
 * @typeParam E - The error type
 * @param result - The Result to check
 * @returns `true` if the result is Ok, `false` otherwise
 *
 * @example
 * ```typescript
 * const result: Result<number, string> = ok(42);
 *
 * if (isOk(result)) {
 *   // TypeScript knows result.value exists here
 *   console.log(result.value); // 42
 * }
 * ```
 */
export const isOk = <T, E>(result: Result<T, E>): result is OkVariant<T> =>
	result._tag === "Ok";

/**
 * Type guard that checks if a Result is an Err variant.
 * Narrows the type to `ErrVariant<E>` when true.
 *
 * @typeParam T - The success value type
 * @typeParam E - The error type
 * @param result - The Result to check
 * @returns `true` if the result is Err, `false` otherwise
 *
 * @example
 * ```typescript
 * const result: Result<number, string> = err("Something went wrong");
 *
 * if (isErr(result)) {
 *   // TypeScript knows result.error exists here
 *   console.log(result.error); // "Something went wrong"
 * }
 * ```
 */
export const isErr = <T, E>(result: Result<T, E>): result is ErrVariant<E> =>
	result._tag === "Err";
