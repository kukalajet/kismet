import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  type AllTags,
  defineErrors,
  type ErrorByTag,
  type ErrorOf,
  type ErrorsOf,
  type ExcludeByTag,
  makeTaggedError,
  type SuccessOf,
  t as types,
  type TaggedError,
  type TagOf,
} from "./error.ts";
import type { Result } from "./result.ts";

// =============================================================================
// Helper types for tests
// =============================================================================

type NotFoundError = TaggedError<"NotFound"> & { id: number };
type ValidationError = TaggedError<"ValidationError"> & {
  field: string;
  message: string;
};
type NetworkError = TaggedError<"NetworkError"> & {
  statusCode: number;
  retryable: boolean;
};
type DatabaseError = TaggedError<"DatabaseError"> & {
  query: string;
  code: number;
};

type AppError = NotFoundError | ValidationError | NetworkError;

// =============================================================================
// TaggedError type tests
// =============================================================================

Deno.test("TaggedError type", async (t) => {
  await t.step("has _tag property", () => {
    const error: TaggedError<"TestError"> = { _tag: "TestError" };
    assertEquals(error._tag, "TestError");
  });

  await t.step("can be extended with additional properties", () => {
    const error: TaggedError<"ValidationError"> & { field: string } = {
      _tag: "ValidationError",
      field: "email",
    };
    assertEquals(error._tag, "ValidationError");
    assertEquals(error.field, "email");
  });

  await t.step("supports discriminated unions", () => {
    type ErrorUnion =
      | (TaggedError<"TypeA"> & { valueA: number })
      | (TaggedError<"TypeB"> & { valueB: string });

    const errorA: ErrorUnion = { _tag: "TypeA", valueA: 42 };
    const errorB: ErrorUnion = { _tag: "TypeB", valueB: "test" };

    if (errorA._tag === "TypeA") {
      assertEquals(errorA.valueA, 42);
    }
    if (errorB._tag === "TypeB") {
      assertEquals(errorB.valueB, "test");
    }
  });

  await t.step("_tag is readonly", () => {
    const error: TaggedError<"Test"> = { _tag: "Test" };
    assertEquals(error._tag, "Test");
    // TypeScript prevents: error._tag = "Other"
  });
});

// =============================================================================
// makeTaggedError class constructor
// =============================================================================

Deno.test("makeTaggedError", async (t) => {
  await t.step("creates Error subclass with correct name", () => {
    const DatabaseError = makeTaggedError<
      "DatabaseError",
      { query: string; code: number }
    >("DatabaseError");
    const error = new DatabaseError({ query: "SELECT *", code: 1045 });

    assertEquals(error.name, "DatabaseError");
    assertEquals(error instanceof Error, true);
  });

  await t.step("has correct _tag property", () => {
    const NotFoundError = makeTaggedError<"NotFound", { id: number }>(
      "NotFound",
    );
    const error = new NotFoundError({ id: 123 });

    assertEquals(error._tag, "NotFound");
  });

  await t.step("stores props correctly", () => {
    const ValidationError = makeTaggedError<
      "ValidationError",
      { field: string; message: string }
    >("ValidationError");
    const error = new ValidationError({
      field: "email",
      message: "Invalid format",
    });

    assertEquals(error.props.field, "email");
    assertEquals(error.props.message, "Invalid format");
  });

  await t.step("generates message from tag and props", () => {
    const NetworkError = makeTaggedError<
      "NetworkError",
      { statusCode: number }
    >("NetworkError");
    const error = new NetworkError({ statusCode: 500 });

    assertEquals(error.message, 'NetworkError: {"statusCode":500}');
  });

  await t.step("works with instanceof checks", () => {
    const CustomError = makeTaggedError<"Custom", { code: number }>("Custom");
    const error = new CustomError({ code: 42 });

    assertEquals(error instanceof CustomError, true);
    assertEquals(error instanceof Error, true);
  });

  await t.step("supports try/catch", () => {
    const ApiError = makeTaggedError<"ApiError", { endpoint: string }>(
      "ApiError",
    );

    try {
      throw new ApiError({ endpoint: "/users" });
    } catch (e) {
      if (e instanceof ApiError) {
        assertEquals(e.props.endpoint, "/users");
        assertEquals(e._tag, "ApiError");
      }
    }
  });

  await t.step("props with various types", async (t) => {
    await t.step("string properties", () => {
      const Error1 = makeTaggedError<"Error1", { msg: string }>("Error1");
      const error = new Error1({ msg: "test message" });
      assertEquals(error.props.msg, "test message");
    });

    await t.step("number properties", () => {
      const Error2 = makeTaggedError<"Error2", { code: number }>("Error2");
      const error = new Error2({ code: 404 });
      assertEquals(error.props.code, 404);
    });

    await t.step("boolean properties", () => {
      const Error3 = makeTaggedError<"Error3", { fatal: boolean }>("Error3");
      const error = new Error3({ fatal: true });
      assertEquals(error.props.fatal, true);
    });

    await t.step("array properties", () => {
      const Error4 = makeTaggedError<"Error4", { items: number[] }>("Error4");
      const error = new Error4({ items: [1, 2, 3] });
      assertEquals(error.props.items, [1, 2, 3]);
    });

    await t.step("object properties", () => {
      const Error5 = makeTaggedError<
        "Error5",
        { meta: { user: string; timestamp: number } }
      >("Error5");
      const error = new Error5({ meta: { user: "john", timestamp: 123 } });
      assertEquals(error.props.meta.user, "john");
      assertEquals(error.props.meta.timestamp, 123);
    });

    await t.step("Date properties", () => {
      const Error6 = makeTaggedError<"Error6", { timestamp: Date }>("Error6");
      const date = new Date("2024-01-01");
      const error = new Error6({ timestamp: date });
      assertStrictEquals(error.props.timestamp, date);
    });

    await t.step("null properties", () => {
      const Error7 = makeTaggedError<"Error7", { value: null }>("Error7");
      const error = new Error7({ value: null });
      assertEquals(error.props.value, null);
    });

    await t.step("undefined properties", () => {
      const Error8 = makeTaggedError<
        "Error8",
        { optional: string | undefined }
      >("Error8");
      const error = new Error8({ optional: undefined });
      assertEquals(error.props.optional, undefined);
    });
  });

  await t.step("multiple instances are independent", () => {
    const TestError = makeTaggedError<"Test", { id: number }>("Test");
    const error1 = new TestError({ id: 1 });
    const error2 = new TestError({ id: 2 });

    assertEquals(error1.props.id, 1);
    assertEquals(error2.props.id, 2);
    assertEquals(error1 instanceof TestError, true);
    assertEquals(error2 instanceof TestError, true);
  });

  await t.step("readonly _tag property", () => {
    const TestError = makeTaggedError<"Test", Record<string, never>>("Test");
    const error = new TestError({});
    assertEquals(error._tag, "Test");
    // TypeScript prevents: error._tag = "Other"
  });

  await t.step("readonly props property", () => {
    const TestError = makeTaggedError<"Test", { value: number }>("Test");
    const error = new TestError({ value: 42 });
    assertEquals(error.props.value, 42);
    // TypeScript prevents: error.props = { value: 100 }
    // TypeScript prevents: error.props.value = 100
  });
});

// =============================================================================
// Practical usage patterns
// =============================================================================

Deno.test("error handling patterns", async (t) => {
  await t.step("exhaustive error handling with switch", () => {
    function handleError(error: AppError): string {
      switch (error._tag) {
        case "NotFound":
          return `Resource not found: ${error.id}`;
        case "ValidationError":
          return `Validation failed on ${error.field}: ${error.message}`;
        case "NetworkError":
          return `Network error (${error.statusCode}), retryable: ${error.retryable}`;
      }
    }

    const notFound: NotFoundError = { _tag: "NotFound", id: 123 };
    assertEquals(handleError(notFound), "Resource not found: 123");

    const validation: ValidationError = {
      _tag: "ValidationError",
      field: "email",
      message: "Invalid format",
    };
    assertEquals(
      handleError(validation),
      "Validation failed on email: Invalid format",
    );

    const network: NetworkError = {
      _tag: "NetworkError",
      statusCode: 503,
      retryable: true,
    };
    assertEquals(handleError(network), "Network error (503), retryable: true");
  });

  await t.step("type narrowing with _tag", () => {
    const error: AppError = {
      _tag: "NotFound",
      id: 456,
    };

    if (error._tag === "NotFound") {
      const id: number = error.id;
      assertEquals(id, 456);
    }
  });

  await t.step("combining tagged errors with Error classes", () => {
    const DbError = makeTaggedError<
      "DatabaseError",
      { query: string; code: number }
    >("DatabaseError");

    type CombinedError =
      | InstanceType<typeof DbError>
      | ValidationError
      | NotFoundError;

    function processError(error: CombinedError): string {
      if (error instanceof DbError) {
        return `DB Error ${error.props.code}: ${error.props.query}`;
      }
      switch (error._tag) {
        case "ValidationError":
          return `Validation: ${error.field}`;
        case "NotFound":
          return `Not found: ${error.id}`;
      }
    }

    const dbError = new DbError({ query: "SELECT *", code: 1062 });
    assertEquals(processError(dbError), "DB Error 1062: SELECT *");

    const validationError: ValidationError = {
      _tag: "ValidationError",
      field: "username",
      message: "Required",
    };
    assertEquals(processError(validationError), "Validation: username");

    const notFoundError: NotFoundError = { _tag: "NotFound", id: 789 };
    assertEquals(processError(notFoundError), "Not found: 789");
  });
});

// =============================================================================
// Error class inheritance and composition
// =============================================================================

Deno.test("error class features", async (t) => {
  await t.step("stack trace is available", () => {
    const TestError = makeTaggedError<"Test", { code: number }>("Test");
    const error = new TestError({ code: 123 });

    assertEquals(typeof error.stack, "string");
    assertEquals(error.stack!.length > 0, true);
  });

  await t.step("can be used in Error.cause chain", () => {
    const OriginalError = makeTaggedError<"Original", { id: number }>(
      "Original",
    );
    const original = new OriginalError({ id: 1 });

    const wrapper = new Error("Wrapper error", { cause: original });

    assertEquals(wrapper.cause, original);
    assertEquals(wrapper.cause instanceof OriginalError, true);
  });

  await t.step("preserves Error prototype chain", () => {
    const CustomError = makeTaggedError<"Custom", Record<string, never>>(
      "Custom",
    );
    const error = new CustomError({});

    assertEquals(Object.getPrototypeOf(error.constructor), Error);
  });
});

// =============================================================================
// Complex scenarios
// =============================================================================

Deno.test("complex error scenarios", async (t) => {
  await t.step("nested error information", () => {
    const ComplexError = makeTaggedError<
      "Complex",
      {
        operation: string;
        context: { userId: number; action: string };
        originalError: Error;
      }
    >("Complex");

    const original = new Error("Original failure");
    const complex = new ComplexError({
      operation: "updateUser",
      context: { userId: 123, action: "updateEmail" },
      originalError: original,
    });

    assertEquals(complex.props.operation, "updateUser");
    assertEquals(complex.props.context.userId, 123);
    assertStrictEquals(complex.props.originalError, original);
  });

  await t.step("error with function properties", () => {
    const ErrorWithRetry = makeTaggedError<
      "RetryableError",
      {
        attempt: number;
        maxAttempts: number;
        retry: () => void;
      }
    >("RetryableError");

    let retryCount = 0;
    const error = new ErrorWithRetry({
      attempt: 1,
      maxAttempts: 3,
      retry: () => {
        retryCount++;
      },
    });

    error.props.retry();
    assertEquals(retryCount, 1);
  });

  await t.step("error with generic metadata", () => {
    type Metadata = {
      timestamp: Date;
      environment: "dev" | "prod" | "staging";
      version: string;
    };

    const MetaError = makeTaggedError<"MetaError", { meta: Metadata }>(
      "MetaError",
    );

    const error = new MetaError({
      meta: {
        timestamp: new Date("2024-01-01"),
        environment: "prod",
        version: "1.0.0",
      },
    });

    assertEquals(error.props.meta.environment, "prod");
    assertEquals(error.props.meta.version, "1.0.0");
  });
});

// =============================================================================
// Edge cases
// =============================================================================

Deno.test("edge cases", async (t) => {
  await t.step("empty props object", () => {
    const EmptyError = makeTaggedError<"Empty", Record<string, never>>("Empty");
    const error = new EmptyError({});

    assertEquals(error._tag, "Empty");
    assertEquals(error.props, {});
    assertEquals(error.message, "Empty: {}");
  });

  await t.step("props with special characters in strings", () => {
    const SpecialError = makeTaggedError<"Special", { msg: string }>("Special");
    const error = new SpecialError({
      msg: "Special chars: \"quotes\", 'apostrophes', and \nnewlines",
    });

    assertEquals(
      error.props.msg,
      "Special chars: \"quotes\", 'apostrophes', and \nnewlines",
    );
  });

  await t.step("props with numeric edge values", () => {
    const NumericError = makeTaggedError<
      "Numeric",
      {
        zero: number;
        negativeZero: number;
        infinity: number;
        negativeInfinity: number;
        nan: number;
      }
    >("Numeric");

    const error = new NumericError({
      zero: 0,
      negativeZero: -0,
      infinity: Infinity,
      negativeInfinity: -Infinity,
      nan: NaN,
    });

    assertEquals(error.props.zero, 0);
    assertEquals(error.props.negativeZero, -0);
    assertEquals(error.props.infinity, Infinity);
    assertEquals(error.props.negativeInfinity, -Infinity);
    assertEquals(Number.isNaN(error.props.nan), true);
  });

  await t.step("very long error messages", () => {
    const LongError = makeTaggedError<"Long", { data: string }>("Long");
    const longString = "x".repeat(10000);
    const error = new LongError({ data: longString });

    assertEquals(error.props.data.length, 10000);
  });

  await t.step("error tag with special characters", () => {
    const SpecialTagError = makeTaggedError<
      "Error-With-Dashes_And_Underscores",
      { value: number }
    >("Error-With-Dashes_And_Underscores");

    const error = new SpecialTagError({ value: 42 });
    assertEquals(error._tag, "Error-With-Dashes_And_Underscores");
  });
});

// =============================================================================
// Type inference verification
// =============================================================================

Deno.test("type inference", async (t) => {
  await t.step("infers tag type from makeTaggedError", () => {
    const TestError = makeTaggedError<"Test", { id: number }>("Test");
    const error = new TestError({ id: 42 });

    const tag: "Test" = error._tag;
    assertEquals(tag, "Test");
  });

  await t.step("infers props type correctly", () => {
    const TypedError = makeTaggedError<
      "Typed",
      { str: string; num: number; bool: boolean }
    >("Typed");
    const error = new TypedError({ str: "test", num: 42, bool: true });

    const str: string = error.props.str;
    const num: number = error.props.num;
    const bool: boolean = error.props.bool;

    assertEquals(str, "test");
    assertEquals(num, 42);
    assertEquals(bool, true);
  });
});

// =============================================================================
// Real-world scenarios
// =============================================================================

Deno.test("real-world usage examples", async (t) => {
  await t.step("HTTP API error handling", () => {
    const BadRequestError = makeTaggedError<
      "BadRequest",
      { field: string; reason: string }
    >("BadRequest");
    const UnauthorizedError = makeTaggedError<
      "Unauthorized",
      { token?: string }
    >("Unauthorized");
    const ServerError = makeTaggedError<"ServerError", { code: number }>(
      "ServerError",
    );

    // Test instanceof checks work independently
    const badRequest = new BadRequestError({
      field: "email",
      reason: "invalid",
    });
    assertEquals(badRequest instanceof BadRequestError, true);
    assertEquals(badRequest._tag, "BadRequest");

    const unauthorized = new UnauthorizedError({});
    assertEquals(unauthorized instanceof UnauthorizedError, true);
    assertEquals(unauthorized._tag, "Unauthorized");

    const serverError = new ServerError({ code: 5000 });
    assertEquals(serverError instanceof ServerError, true);
    assertEquals(serverError._tag, "ServerError");

    // Test exhaustive handling using _tag
    type ApiError =
      | InstanceType<typeof BadRequestError>
      | InstanceType<typeof UnauthorizedError>
      | InstanceType<typeof ServerError>;

    function getStatusCode(error: ApiError): number {
      switch (error._tag) {
        case "BadRequest":
          return 400;
        case "Unauthorized":
          return 401;
        case "ServerError":
          return 500;
      }
    }

    assertEquals(getStatusCode(badRequest), 400);
    assertEquals(getStatusCode(unauthorized), 401);
    assertEquals(getStatusCode(serverError), 500);
  });

  await t.step("database operation errors", () => {
    const ConnectionError = makeTaggedError<
      "ConnectionError",
      { host: string; port: number }
    >("ConnectionError");
    const QueryError = makeTaggedError<
      "QueryError",
      { query: string; sqlState: string }
    >("QueryError");
    const ConstraintError = makeTaggedError<
      "ConstraintError",
      { table: string; constraint: string }
    >("ConstraintError");

    const connError = new ConnectionError({
      host: "localhost",
      port: 5432,
    });
    assertEquals(connError.props.host, "localhost");
    assertEquals(connError.props.port, 5432);

    const queryError = new QueryError({
      query: "SELECT * FROM users",
      sqlState: "42P01",
    });
    assertEquals(queryError.props.sqlState, "42P01");

    const constraintError = new ConstraintError({
      table: "users",
      constraint: "unique_email",
    });
    assertEquals(constraintError.props.constraint, "unique_email");
  });

  await t.step("validation errors with multiple fields", () => {
    const FormValidationError = makeTaggedError<
      "FormValidation",
      {
        errors: Array<{ field: string; message: string }>;
      }
    >("FormValidation");

    const error = new FormValidationError({
      errors: [
        { field: "email", message: "Invalid email format" },
        { field: "password", message: "Password too short" },
        { field: "age", message: "Must be 18 or older" },
      ],
    });

    assertEquals(error.props.errors.length, 3);
    assertEquals(error.props.errors[0].field, "email");
    assertEquals(error.props.errors[1].message, "Password too short");
  });
});

// =============================================================================
// Type helper object (types)
// =============================================================================

Deno.test("type helper object (t)", async (t) => {
  await t.step("t.string returns string type", () => {
    const value = types.string;
    assertEquals(typeof value, "string");
    // Verify it's the empty string
    assertEquals(value, "");
  });

  await t.step("t.number returns number type", () => {
    const value = types.number;
    assertEquals(typeof value, "number");
    assertEquals(value, 0);
  });

  await t.step("t.boolean returns boolean type", () => {
    const value = types.boolean;
    assertEquals(typeof value, "boolean");
    assertEquals(value, false);
  });

  await t.step("t.bigint returns bigint type", () => {
    const value = types.bigint;
    assertEquals(typeof value, "bigint");
    assertEquals(value, 0n);
  });

  await t.step("t.symbol returns symbol type", () => {
    const value = types.symbol;
    assertEquals(typeof value, "symbol");
  });

  await t.step("t.date returns Date type", () => {
    const value = types.date;
    assertEquals(value instanceof Date, true);
  });

  await t.step("t.array() returns empty array", () => {
    const stringArray = types.array<string>();
    assertEquals(Array.isArray(stringArray), true);
    assertEquals(stringArray.length, 0);

    const numberArray = types.array<number>();
    assertEquals(Array.isArray(numberArray), true);
    assertEquals(numberArray.length, 0);
  });

  await t.step("t.optional() returns undefined", () => {
    const value = types.optional<string>();
    assertEquals(value, undefined);
  });

  await t.step("t.nullable() returns null", () => {
    const value = types.nullable<string>();
    assertEquals(value, null);
  });

  await t.step("t.type() returns undefined for custom types", () => {
    type CustomType = { foo: string; bar: number };
    const value = types.type<CustomType>();
    assertEquals(value, undefined);
  });

  await t.step("type helpers used in error definitions", () => {
    // This demonstrates the intended usage pattern
    const errorDef = {
      NetworkError: { statusCode: types.number, message: types.string },
      NotFound: { id: types.string },
      ValidationError: {
        fields: types.array<string>(),
        timestamp: types.date,
      },
    };

    assertEquals(typeof errorDef.NetworkError.statusCode, "number");
    assertEquals(typeof errorDef.NetworkError.message, "string");
    assertEquals(typeof errorDef.NotFound.id, "string");
    assertEquals(Array.isArray(errorDef.ValidationError.fields), true);
    assertEquals(errorDef.ValidationError.timestamp instanceof Date, true);
  });
});

// =============================================================================
// defineErrors function
// =============================================================================

Deno.test("defineErrors", async (t) => {
  await t.step("creates error factories with properties", () => {
    const Errors = defineErrors({
      NotFound: { id: types.string },
      ValidationError: { field: types.string, message: types.string },
    });

    const notFound = Errors.NotFound({ id: "123" });
    assertEquals(notFound._tag, "NotFound");
    assertEquals(notFound.id, "123");

    const validation = Errors.ValidationError({
      field: "email",
      message: "Invalid",
    });
    assertEquals(validation._tag, "ValidationError");
    assertEquals(validation.field, "email");
    assertEquals(validation.message, "Invalid");
  });

  await t.step("creates error factories without properties", () => {
    const Errors = defineErrors({
      Unauthorized: undefined,
      Timeout: undefined,
    });

    const unauthorized = Errors.Unauthorized();
    assertEquals(unauthorized._tag, "Unauthorized");
    assertEquals(Object.keys(unauthorized).length, 1); // Only _tag

    const timeout = Errors.Timeout();
    assertEquals(timeout._tag, "Timeout");
  });

  await t.step("mixes errors with and without properties", () => {
    const Errors = defineErrors({
      NotFound: { resourceId: types.string },
      Unauthorized: undefined,
      BadRequest: { reason: types.string },
    });

    const notFound = Errors.NotFound({ resourceId: "user-123" });
    assertEquals(notFound._tag, "NotFound");
    assertEquals(notFound.resourceId, "user-123");

    const unauthorized = Errors.Unauthorized();
    assertEquals(unauthorized._tag, "Unauthorized");

    const badRequest = Errors.BadRequest({ reason: "Invalid input" });
    assertEquals(badRequest._tag, "BadRequest");
    assertEquals(badRequest.reason, "Invalid input");
  });

  await t.step("supports all type helpers", () => {
    const Errors = defineErrors({
      StringError: { value: types.string },
      NumberError: { code: types.number },
      BooleanError: { flag: types.boolean },
      BigIntError: { bigNum: types.bigint },
      DateError: { timestamp: types.date },
      ArrayError: { items: types.array<number>() },
      OptionalError: { maybe: types.optional<string>() },
      NullableError: { nullValue: types.nullable<number>() },
    });

    const stringErr = Errors.StringError({ value: "test" });
    assertEquals(stringErr.value, "test");

    const numberErr = Errors.NumberError({ code: 42 });
    assertEquals(numberErr.code, 42);

    const boolErr = Errors.BooleanError({ flag: true });
    assertEquals(boolErr.flag, true);

    const bigIntErr = Errors.BigIntError({ bigNum: 100n });
    assertEquals(bigIntErr.bigNum, 100n);

    const date = new Date();
    const dateErr = Errors.DateError({ timestamp: date });
    assertStrictEquals(dateErr.timestamp, date);

    const arrayErr = Errors.ArrayError({ items: [1, 2, 3] });
    assertEquals(arrayErr.items, [1, 2, 3]);

    const optionalErr = Errors.OptionalError({ maybe: undefined });
    assertEquals(optionalErr.maybe, undefined);

    const nullableErr = Errors.NullableError({ nullValue: null });
    assertEquals(nullableErr.nullValue, null);
  });

  await t.step("supports complex nested objects", () => {
    const Errors = defineErrors({
      ComplexError: {
        metadata: {
          user: types.string,
          timestamp: types.date,
          retryCount: types.number,
        } as { user: string; timestamp: Date; retryCount: number },
      },
    });

    const date = new Date();
    const error = Errors.ComplexError({
      metadata: {
        user: "john",
        timestamp: date,
        retryCount: 3,
      },
    });

    assertEquals(error._tag, "ComplexError");
    assertEquals(error.metadata.user, "john");
    assertStrictEquals(error.metadata.timestamp, date);
    assertEquals(error.metadata.retryCount, 3);
  });

  await t.step("created errors work with discriminated unions", () => {
    const ApiErrors = defineErrors({
      NotFound: { resourceId: types.string },
      Forbidden: { action: types.string },
      ServerError: { code: types.number },
    });

    type ApiError = ErrorsOf<typeof ApiErrors>;

    function handleError(error: ApiError): string {
      switch (error._tag) {
        case "NotFound":
          return `Not found: ${error.resourceId}`;
        case "Forbidden":
          return `Forbidden: ${error.action}`;
        case "ServerError":
          return `Server error: ${error.code}`;
      }
    }

    const notFound = ApiErrors.NotFound({ resourceId: "user-123" });
    assertEquals(handleError(notFound), "Not found: user-123");

    const forbidden = ApiErrors.Forbidden({ action: "delete" });
    assertEquals(handleError(forbidden), "Forbidden: delete");

    const serverError = ApiErrors.ServerError({ code: 500 });
    assertEquals(handleError(serverError), "Server error: 500");
  });

  await t.step("supports old syntax with type casting", () => {
    const Errors = defineErrors({
      NotFound: { userId: "" as string },
      InvalidEmail: { email: "" as string },
      InvalidAge: { age: 0 as number, reason: "" as string },
    });

    const notFound = Errors.NotFound({ userId: "123" });
    assertEquals(notFound._tag, "NotFound");
    assertEquals(notFound.userId, "123");

    const invalidEmail = Errors.InvalidEmail({ email: "bad@email" });
    assertEquals(invalidEmail._tag, "InvalidEmail");
    assertEquals(invalidEmail.email, "bad@email");

    const invalidAge = Errors.InvalidAge({ age: -5, reason: "negative" });
    assertEquals(invalidAge._tag, "InvalidAge");
    assertEquals(invalidAge.age, -5);
    assertEquals(invalidAge.reason, "negative");
  });

  await t.step("multiple instances are independent", () => {
    const Errors = defineErrors({
      TestError: { id: types.number },
    });

    const error1 = Errors.TestError({ id: 1 });
    const error2 = Errors.TestError({ id: 2 });

    assertEquals(error1.id, 1);
    assertEquals(error2.id, 2);

    // Modifying one doesn't affect the other
    error1.id = 100;
    assertEquals(error1.id, 100);
    assertEquals(error2.id, 2);
  });

  await t.step("empty error definitions object", () => {
    const Errors = defineErrors({});
    assertEquals(Object.keys(Errors).length, 0);
  });

  await t.step("single error definition", () => {
    const Errors = defineErrors({
      SingleError: { message: types.string },
    });

    const error = Errors.SingleError({ message: "test" });
    assertEquals(error._tag, "SingleError");
    assertEquals(error.message, "test");
  });
});

// =============================================================================
// ErrorsOf type helper
// =============================================================================

Deno.test("ErrorsOf type helper", async (t) => {
  await t.step("extracts union type from error definitions", () => {
    const UserErrors = defineErrors({
      NotFound: { userId: types.string },
      InvalidEmail: { email: types.string },
      Unauthorized: undefined,
    });

    type UserError = ErrorsOf<typeof UserErrors>;

    // Test that all error types are included in the union
    const notFound: UserError = UserErrors.NotFound({ userId: "123" });
    assertEquals(notFound._tag, "NotFound");

    const invalidEmail: UserError = UserErrors.InvalidEmail({
      email: "bad",
    });
    assertEquals(invalidEmail._tag, "InvalidEmail");

    const unauthorized: UserError = UserErrors.Unauthorized();
    assertEquals(unauthorized._tag, "Unauthorized");
  });

  await t.step("works with exhaustive pattern matching", () => {
    const PaymentErrors = defineErrors({
      InsufficientFunds: { balance: types.number, required: types.number },
      InvalidCard: { last4: types.string },
      ProcessingFailed: { reason: types.string },
    });

    type PaymentError = ErrorsOf<typeof PaymentErrors>;

    function getErrorMessage(error: PaymentError): string {
      switch (error._tag) {
        case "InsufficientFunds":
          return `Need ${error.required}, have ${error.balance}`;
        case "InvalidCard":
          return `Card ending in ${error.last4} is invalid`;
        case "ProcessingFailed":
          return `Processing failed: ${error.reason}`;
      }
    }

    const insufficientFunds = PaymentErrors.InsufficientFunds({
      balance: 10,
      required: 100,
    });
    assertEquals(getErrorMessage(insufficientFunds), "Need 100, have 10");

    const invalidCard = PaymentErrors.InvalidCard({ last4: "1234" });
    assertEquals(
      getErrorMessage(invalidCard),
      "Card ending in 1234 is invalid",
    );

    const processingFailed = PaymentErrors.ProcessingFailed({
      reason: "Network timeout",
    });
    assertEquals(
      getErrorMessage(processingFailed),
      "Processing failed: Network timeout",
    );
  });

  await t.step("works with function return types", () => {
    const DbErrors = defineErrors({
      ConnectionFailed: { host: types.string },
      QueryFailed: { query: types.string },
    });

    type DbError = ErrorsOf<typeof DbErrors>;

    function simulateDbOperation(shouldFail: boolean): DbError | null {
      if (shouldFail) {
        return DbErrors.ConnectionFailed({ host: "localhost" });
      }
      return null;
    }

    const error = simulateDbOperation(true);
    assertEquals(error?._tag, "ConnectionFailed");
    assertEquals(error && "host" in error ? error.host : null, "localhost");

    const success = simulateDbOperation(false);
    assertEquals(success, null);
  });

  await t.step("preserves type information in generic functions", () => {
    const ValidationErrors = defineErrors({
      Required: { field: types.string },
      TooLong: { field: types.string, maxLength: types.number },
    });

    type ValidationError = ErrorsOf<typeof ValidationErrors>;

    function createValidator<E extends ValidationError>(
      errorFactory: () => E,
    ): () => E {
      return errorFactory;
    }

    const requiredValidator = createValidator(() =>
      ValidationErrors.Required({ field: "email" })
    );
    const error = requiredValidator();

    assertEquals(error._tag, "Required");
    assertEquals(error.field, "email");
  });
});

// =============================================================================
// Integration tests for defineErrors workflow
// =============================================================================

// =============================================================================
// Type helper utilities
// =============================================================================

Deno.test("ErrorOf type helper", async (t) => {
  await t.step("extracts error type from Result", () => {
    const UserErrors = defineErrors({
      NotFound: { userId: types.string },
      ValidationError: { field: types.string },
    });

    type UserError = ErrorsOf<typeof UserErrors>;
    type UserResult = Result<{ id: string; name: string }, UserError>;

    // ErrorOf should extract UserError
    type ExtractedError = ErrorOf<UserResult>;

    // Test that the extracted type works correctly by assigning to it
    const error: ExtractedError = UserErrors.NotFound({ userId: "123" });
    // Type assertion to access properties (TypeScript inference limitation)
    const notFoundError = error as ReturnType<typeof UserErrors.NotFound>;
    assertEquals(notFoundError._tag, "NotFound");
    assertEquals(notFoundError.userId, "123");

    const validationError: ExtractedError = UserErrors.ValidationError({
      field: "email",
    });
    const valError = validationError as ReturnType<
      typeof UserErrors.ValidationError
    >;
    assertEquals(valError._tag, "ValidationError");
    assertEquals(valError.field, "email");
  });

  await t.step("works with simple error types", () => {
    type SimpleResult = Result<string, { _tag: "Error"; message: string }>;
    type ExtractedError = ErrorOf<SimpleResult>;

    const error: ExtractedError = { _tag: "Error", message: "failed" };
    const typedError = error as { _tag: "Error"; message: string };
    assertEquals(typedError._tag, "Error");
    assertEquals(typedError.message, "failed");
  });

  await t.step("works with union error types", () => {
    type NetworkError = { _tag: "NetworkError"; statusCode: number };
    type ParseError = { _tag: "ParseError"; data: string };
    type MultiErrorResult = Result<number, NetworkError | ParseError>;
    type ExtractedError = ErrorOf<MultiErrorResult>;

    const networkError: ExtractedError = {
      _tag: "NetworkError",
      statusCode: 500,
    };
    const typedNetworkError = networkError as NetworkError | ParseError;
    assertEquals(typedNetworkError._tag, "NetworkError");
    if (typedNetworkError._tag === "NetworkError") {
      assertEquals(typedNetworkError.statusCode, 500);
    }

    const parseError: ExtractedError = { _tag: "ParseError", data: "invalid" };
    const typedParseError = parseError as NetworkError | ParseError;
    assertEquals(typedParseError._tag, "ParseError");
    if (typedParseError._tag === "ParseError") {
      assertEquals(typedParseError.data, "invalid");
    }
  });
});

Deno.test("SuccessOf type helper", async (t) => {
  await t.step("extracts success type from Result", () => {
    type UserData = { id: string; name: string; email: string };
    type UserResult = Result<UserData, { _tag: "Error" }>;
    type ExtractedSuccess = SuccessOf<UserResult>;

    const success: ExtractedSuccess = {
      id: "123",
      name: "John",
      email: "john@example.com",
    };
    const typedSuccess = success as UserData;
    assertEquals(typedSuccess.id, "123");
    assertEquals(typedSuccess.name, "John");
    assertEquals(typedSuccess.email, "john@example.com");
  });

  await t.step("works with primitive types", () => {
    type StringResult = Result<string, { _tag: "Error" }>;
    type NumberResult = Result<number, { _tag: "Error" }>;
    type BooleanResult = Result<boolean, { _tag: "Error" }>;

    type StringSuccess = SuccessOf<StringResult>;
    type NumberSuccess = SuccessOf<NumberResult>;
    type BooleanSuccess = SuccessOf<BooleanResult>;

    const str: StringSuccess = "test";
    const num: NumberSuccess = 42;
    const bool: BooleanSuccess = true;

    assertEquals(str, "test");
    assertEquals(num, 42);
    assertEquals(bool, true);
  });

  await t.step("works with complex nested types", () => {
    type ComplexData = {
      user: { id: string; profile: { name: string; age: number } };
      settings: { theme: "light" | "dark"; notifications: boolean };
    };
    type ComplexResult = Result<ComplexData, { _tag: "Error" }>;
    type ExtractedSuccess = SuccessOf<ComplexResult>;

    const success: ExtractedSuccess = {
      user: {
        id: "user-1",
        profile: { name: "Alice", age: 30 },
      },
      settings: {
        theme: "dark",
        notifications: true,
      },
    };

    const typedSuccess = success as ComplexData;
    assertEquals(typedSuccess.user.id, "user-1");
    assertEquals(typedSuccess.user.profile.name, "Alice");
    assertEquals(typedSuccess.settings.theme, "dark");
  });

  await t.step("works with array types", () => {
    type ArrayResult = Result<string[], { _tag: "Error" }>;
    type ExtractedSuccess = SuccessOf<ArrayResult>;

    const success: ExtractedSuccess = ["a", "b", "c"];
    const typedSuccess = success as string[];
    assertEquals(typedSuccess.length, 3);
    assertEquals(typedSuccess[0], "a");
  });

  await t.step("works with union success types", () => {
    type UnionResult = Result<string | number, { _tag: "Error" }>;
    type ExtractedSuccess = SuccessOf<UnionResult>;

    const stringSuccess: ExtractedSuccess = "test";
    const numberSuccess: ExtractedSuccess = 42;

    assertEquals(stringSuccess, "test");
    assertEquals(numberSuccess, 42);
  });
});

Deno.test("TagOf type helper", async (t) => {
  await t.step("extracts tag from tagged error", () => {
    type NetworkError = TaggedError<"NetworkError"> & { statusCode: number };
    type ExtractedTag = TagOf<NetworkError>;

    // TypeScript should enforce that ExtractedTag is exactly "NetworkError"
    const tag: ExtractedTag = "NetworkError";
    assertEquals(tag, "NetworkError");
  });

  await t.step("works with multiple error types", () => {
    type NotFoundError = TaggedError<"NotFound">;
    type ValidationError = TaggedError<"ValidationError">;
    type AuthError = TaggedError<"AuthError">;

    type Tag1 = TagOf<NotFoundError>;
    type Tag2 = TagOf<ValidationError>;
    type Tag3 = TagOf<AuthError>;

    const tag1: Tag1 = "NotFound";
    const tag2: Tag2 = "ValidationError";
    const tag3: Tag3 = "AuthError";

    assertEquals(tag1, "NotFound");
    assertEquals(tag2, "ValidationError");
    assertEquals(tag3, "AuthError");
  });

  await t.step("extracts tag from error with complex properties", () => {
    type ComplexError = TaggedError<"ComplexError"> & {
      metadata: { user: string; timestamp: Date };
      retryable: boolean;
    };
    type ExtractedTag = TagOf<ComplexError>;

    const tag: ExtractedTag = "ComplexError";
    assertEquals(tag, "ComplexError");
  });
});

Deno.test("AllTags type helper", async (t) => {
  await t.step("extracts all tags from error union", () => {
    type AppError =
      | TaggedError<"NetworkError">
      | TaggedError<"ValidationError">
      | TaggedError<"AuthError">;

    type Tags = AllTags<AppError>;

    // TypeScript should allow any of the three tags
    const tag1: Tags = "NetworkError";
    const tag2: Tags = "ValidationError";
    const tag3: Tags = "AuthError";

    assertEquals(tag1, "NetworkError");
    assertEquals(tag2, "ValidationError");
    assertEquals(tag3, "AuthError");
  });

  await t.step("works with errors with properties", () => {
    type ErrorUnion =
      | (TaggedError<"NotFound"> & { id: string })
      | (TaggedError<"Forbidden"> & { action: string })
      | (TaggedError<"ServerError"> & { code: number });

    type Tags = AllTags<ErrorUnion>;

    const tag1: Tags = "NotFound";
    const tag2: Tags = "Forbidden";
    const tag3: Tags = "ServerError";

    assertEquals(tag1, "NotFound");
    assertEquals(tag2, "Forbidden");
    assertEquals(tag3, "ServerError");
  });

  await t.step("works with defineErrors result", () => {
    const UserErrors = defineErrors({
      NotFound: { userId: types.string },
      InvalidEmail: { email: types.string },
      Unauthorized: undefined,
    });

    type UserError = ErrorsOf<typeof UserErrors>;
    type Tags = AllTags<UserError>;

    const tag1: Tags = "NotFound";
    const tag2: Tags = "InvalidEmail";
    const tag3: Tags = "Unauthorized";

    assertEquals(tag1, "NotFound");
    assertEquals(tag2, "InvalidEmail");
    assertEquals(tag3, "Unauthorized");
  });

  await t.step("used in exhaustive switch statements", () => {
    const ApiErrors = defineErrors({
      NetworkError: { statusCode: types.number },
      ParseError: { data: types.string },
      TimeoutError: undefined,
    });

    type ApiError = ErrorsOf<typeof ApiErrors>;
    type ApiTag = AllTags<ApiError>;

    function handleErrorTag(tag: ApiTag): string {
      switch (tag) {
        case "NetworkError":
          return "network";
        case "ParseError":
          return "parse";
        case "TimeoutError":
          return "timeout";
      }
    }

    assertEquals(handleErrorTag("NetworkError"), "network");
    assertEquals(handleErrorTag("ParseError"), "parse");
    assertEquals(handleErrorTag("TimeoutError"), "timeout");
  });
});

Deno.test("ErrorByTag type helper", async (t) => {
  await t.step("extracts specific error from union", () => {
    type AppError =
      | (TaggedError<"NetworkError"> & { statusCode: number })
      | (TaggedError<"ValidationError"> & { field: string })
      | (TaggedError<"AuthError"> & { token: string });

    type NetworkErr = ErrorByTag<AppError, "NetworkError">;

    const error: NetworkErr = { _tag: "NetworkError", statusCode: 500 };
    assertEquals(error._tag, "NetworkError");
    assertEquals(error.statusCode, 500);
  });

  await t.step("preserves error properties", () => {
    const UserErrors = defineErrors({
      NotFound: { userId: types.string, reason: types.string },
      InvalidEmail: { email: types.string },
      Unauthorized: undefined,
    });

    type UserError = ErrorsOf<typeof UserErrors>;
    type NotFoundErr = ErrorByTag<UserError, "NotFound">;

    const error: NotFoundErr = {
      _tag: "NotFound",
      userId: "user-123",
      reason: "User does not exist",
    };

    assertEquals(error._tag, "NotFound");
    assertEquals(error.userId, "user-123");
    assertEquals(error.reason, "User does not exist");
  });

  await t.step("used for specific error handling", () => {
    const ApiErrors = defineErrors({
      NetworkError: { statusCode: types.number, retryable: types.boolean },
      ParseError: { data: types.string },
      TimeoutError: { duration: types.number },
    });

    type ApiError = ErrorsOf<typeof ApiErrors>;
    type NetworkErr = ErrorByTag<ApiError, "NetworkError">;

    function handleNetworkError(error: NetworkErr): string {
      return error.retryable
        ? `Retrying after ${error.statusCode}`
        : `Failed with ${error.statusCode}`;
    }

    const retryableError: NetworkErr = {
      _tag: "NetworkError",
      statusCode: 503,
      retryable: true,
    };
    assertEquals(handleNetworkError(retryableError), "Retrying after 503");

    const nonRetryableError: NetworkErr = {
      _tag: "NetworkError",
      statusCode: 404,
      retryable: false,
    };
    assertEquals(handleNetworkError(nonRetryableError), "Failed with 404");
  });

  await t.step("works with errors without properties", () => {
    const Errors = defineErrors({
      Unauthorized: undefined,
      Forbidden: { resource: types.string },
      NotFound: { id: types.string },
    });

    type AppError = ErrorsOf<typeof Errors>;
    type UnauthorizedErr = ErrorByTag<AppError, "Unauthorized">;

    const error: UnauthorizedErr = { _tag: "Unauthorized" };
    assertEquals(error._tag, "Unauthorized");
    assertEquals(Object.keys(error).length, 1);
  });

  await t.step("used in narrowing functions", () => {
    const ValidationErrors = defineErrors({
      Required: { field: types.string },
      InvalidFormat: { field: types.string, pattern: types.string },
      OutOfRange: { field: types.string, min: types.number, max: types.number },
    });

    type ValidationError = ErrorsOf<typeof ValidationErrors>;
    type RequiredErr = ErrorByTag<ValidationError, "Required">;
    type OutOfRangeErr = ErrorByTag<ValidationError, "OutOfRange">;

    function isRequired(error: ValidationError): error is RequiredErr {
      return error._tag === "Required";
    }

    function isOutOfRange(error: ValidationError): error is OutOfRangeErr {
      return error._tag === "OutOfRange";
    }

    const requiredErr = ValidationErrors.Required({ field: "email" });
    const outOfRangeErr = ValidationErrors.OutOfRange({
      field: "age",
      min: 0,
      max: 120,
    });

    assertEquals(isRequired(requiredErr), true);
    assertEquals(isRequired(outOfRangeErr), false);
    assertEquals(isOutOfRange(outOfRangeErr), true);
    assertEquals(isOutOfRange(requiredErr), false);
  });
});

Deno.test("ExcludeByTag type helper", async (t) => {
  await t.step("removes specific error from union", () => {
    type AppError =
      | (TaggedError<"NetworkError"> & { statusCode: number })
      | (TaggedError<"ValidationError"> & { field: string })
      | (TaggedError<"AuthError"> & { token: string });

    type NonNetworkErrors = ExcludeByTag<AppError, "NetworkError">;

    const validation: NonNetworkErrors = {
      _tag: "ValidationError",
      field: "email",
    };
    const auth: NonNetworkErrors = { _tag: "AuthError", token: "abc" };

    assertEquals(validation._tag, "ValidationError");
    assertEquals(auth._tag, "AuthError");
  });

  await t.step("removes multiple errors by chaining", () => {
    const ApiErrors = defineErrors({
      NetworkError: { statusCode: types.number },
      ParseError: { data: types.string },
      TimeoutError: undefined,
      AuthError: { token: types.string },
    });

    type ApiError = ErrorsOf<typeof ApiErrors>;
    type OnlyDataErrors = ExcludeByTag<
      ExcludeByTag<ApiError, "NetworkError">,
      "TimeoutError"
    >;

    const parseError: OnlyDataErrors = { _tag: "ParseError", data: "invalid" };
    const authError: OnlyDataErrors = { _tag: "AuthError", token: "xyz" };

    assertEquals(parseError._tag, "ParseError");
    assertEquals(authError._tag, "AuthError");
  });

  await t.step("used for error filtering", () => {
    const UserErrors = defineErrors({
      NotFound: { userId: types.string },
      InvalidEmail: { email: types.string },
      InvalidAge: { age: types.number },
      Unauthorized: undefined,
    });

    type UserError = ErrorsOf<typeof UserErrors>;
    type ValidationErrors = ExcludeByTag<
      ExcludeByTag<UserError, "NotFound">,
      "Unauthorized"
    >;

    function handleValidationError(error: ValidationErrors): string {
      switch (error._tag) {
        case "InvalidEmail":
          return `Email validation failed: ${error.email}`;
        case "InvalidAge":
          return `Age validation failed: ${error.age}`;
      }
    }

    const emailError: ValidationErrors = {
      _tag: "InvalidEmail",
      email: "bad@email",
    };
    const ageError: ValidationErrors = { _tag: "InvalidAge", age: -5 };

    assertEquals(
      handleValidationError(emailError),
      "Email validation failed: bad@email",
    );
    assertEquals(handleValidationError(ageError), "Age validation failed: -5");
  });

  await t.step("works with single error type remaining", () => {
    const Errors = defineErrors({
      ErrorA: { valueA: types.string },
      ErrorB: { valueB: types.number },
      ErrorC: undefined,
    });

    type AllErrors = ErrorsOf<typeof Errors>;
    type OnlyErrorA = ExcludeByTag<ExcludeByTag<AllErrors, "ErrorB">, "ErrorC">;

    const error: OnlyErrorA = { _tag: "ErrorA", valueA: "test" };
    assertEquals(error._tag, "ErrorA");
    assertEquals(error.valueA, "test");
  });

  await t.step("preserves type information after exclusion", () => {
    const PaymentErrors = defineErrors({
      InsufficientFunds: { balance: types.number, required: types.number },
      InvalidCard: { last4: types.string, issuer: types.string },
      NetworkError: { statusCode: types.number },
      ProcessingError: { code: types.string },
    });

    type PaymentError = ErrorsOf<typeof PaymentErrors>;
    type BusinessErrors = ExcludeByTag<
      ExcludeByTag<PaymentError, "NetworkError">,
      "ProcessingError"
    >;

    function getBusinessErrorMessage(error: BusinessErrors): string {
      switch (error._tag) {
        case "InsufficientFunds":
          return `Need ${error.required}, have ${error.balance}`;
        case "InvalidCard":
          return `Invalid ${error.issuer} card ending in ${error.last4}`;
      }
    }

    const insufficientFunds: BusinessErrors = {
      _tag: "InsufficientFunds",
      balance: 50,
      required: 100,
    };
    const invalidCard: BusinessErrors = {
      _tag: "InvalidCard",
      last4: "1234",
      issuer: "Visa",
    };

    assertEquals(
      getBusinessErrorMessage(insufficientFunds),
      "Need 100, have 50",
    );
    assertEquals(
      getBusinessErrorMessage(invalidCard),
      "Invalid Visa card ending in 1234",
    );
  });

  await t.step("used in error transformation pipelines", () => {
    const SourceErrors = defineErrors({
      NetworkError: { statusCode: types.number },
      DatabaseError: { query: types.string },
      ValidationError: { field: types.string },
    });

    const TargetErrors = defineErrors({
      ValidationError: { field: types.string },
      SystemError: { message: types.string },
    });

    type SourceError = ErrorsOf<typeof SourceErrors>;
    type TargetError = ErrorsOf<typeof TargetErrors>;
    type SystemSourceErrors = ExcludeByTag<SourceError, "ValidationError">;

    function transformError(error: SourceError): TargetError {
      if (error._tag === "ValidationError") {
        return TargetErrors.ValidationError({ field: error.field });
      }

      const systemError = error as SystemSourceErrors;
      switch (systemError._tag) {
        case "NetworkError":
          return TargetErrors.SystemError({
            message: `Network error: ${systemError.statusCode}`,
          });
        case "DatabaseError":
          return TargetErrors.SystemError({
            message: `Database error: ${systemError.query}`,
          });
      }
    }

    const networkErr = SourceErrors.NetworkError({ statusCode: 500 });
    const transformed = transformError(networkErr);
    assertEquals(transformed._tag, "SystemError");
    if (transformed._tag === "SystemError") {
      assertEquals(transformed.message, "Network error: 500");
    }
  });
});

Deno.test("defineErrors integration scenarios", async (t) => {
  await t.step("complete user service error handling", () => {
    // Define all errors for a user service
    const UserErrors = defineErrors({
      NotFound: { userId: types.string },
      EmailTaken: { email: types.string },
      InvalidAge: { age: types.number, min: types.number },
      Unauthorized: undefined,
    });

    type UserError = ErrorsOf<typeof UserErrors>;

    // Simulate service functions
    function findUser(id: string): { id: string; email: string } | UserError {
      if (id === "missing") {
        return UserErrors.NotFound({ userId: id });
      }
      return { id, email: "user@example.com" };
    }

    function createUser(
      email: string,
      age: number,
    ): { id: string; email: string } | UserError {
      if (email === "taken@example.com") {
        return UserErrors.EmailTaken({ email });
      }
      if (age < 18) {
        return UserErrors.InvalidAge({ age, min: 18 });
      }
      return { id: "new-id", email };
    }

    // Test successful case
    const user = findUser("123");
    if ("_tag" in user) {
      throw new Error("Should not be an error");
    }
    assertEquals(user.id, "123");

    // Test error case
    const notFound = findUser("missing");
    if (!("_tag" in notFound)) {
      throw new Error("Should be an error");
    }
    assertEquals(notFound._tag, "NotFound");
    if (notFound._tag === "NotFound") {
      assertEquals(notFound.userId, "missing");
    }

    // Test creation errors
    const emailTaken = createUser("taken@example.com", 25);
    if (!("_tag" in emailTaken)) {
      throw new Error("Should be an error");
    }
    assertEquals(emailTaken._tag, "EmailTaken");

    const invalidAge = createUser("new@example.com", 15);
    if (!("_tag" in invalidAge)) {
      throw new Error("Should be an error");
    }
    assertEquals(invalidAge._tag, "InvalidAge");
    if (invalidAge._tag === "InvalidAge") {
      assertEquals(invalidAge.age, 15);
      assertEquals(invalidAge.min, 18);
    }
  });

  await t.step("error mapping and transformation", () => {
    const ApiErrors = defineErrors({
      NetworkError: { statusCode: types.number },
      ParseError: { data: types.string },
    });

    const UserErrors = defineErrors({
      NotFound: { userId: types.string },
      ServiceUnavailable: undefined,
    });

    type ApiError = ErrorsOf<typeof ApiErrors>;
    type UserError = ErrorsOf<typeof UserErrors>;

    // Map API errors to User errors
    function mapError(apiError: ApiError): UserError {
      switch (apiError._tag) {
        case "NetworkError":
          return apiError.statusCode === 404
            ? UserErrors.NotFound({ userId: "unknown" })
            : UserErrors.ServiceUnavailable();
        case "ParseError":
          return UserErrors.ServiceUnavailable();
      }
    }

    const networkError = ApiErrors.NetworkError({ statusCode: 404 });
    const mappedNotFound = mapError(networkError);
    assertEquals(mappedNotFound._tag, "NotFound");

    const parseError = ApiErrors.ParseError({ data: "invalid" });
    const mappedUnavailable = mapError(parseError);
    assertEquals(mappedUnavailable._tag, "ServiceUnavailable");
  });

  await t.step("error aggregation and collection", () => {
    const ValidationErrors = defineErrors({
      Required: { field: types.string },
      InvalidFormat: { field: types.string, pattern: types.string },
      OutOfRange: { field: types.string, min: types.number, max: types.number },
    });

    type ValidationError = ErrorsOf<typeof ValidationErrors>;

    const errors: ValidationError[] = [
      ValidationErrors.Required({ field: "email" }),
      ValidationErrors.InvalidFormat({ field: "phone", pattern: "^\\d+$" }),
      ValidationErrors.OutOfRange({ field: "age", min: 0, max: 120 }),
    ];

    assertEquals(errors.length, 3);
    assertEquals(errors[0]._tag, "Required");
    assertEquals(errors[1]._tag, "InvalidFormat");
    assertEquals(errors[2]._tag, "OutOfRange");

    // Group by tag
    const grouped = errors.reduce(
      (acc, err) => {
        if (!acc[err._tag]) {
          acc[err._tag] = [];
        }
        acc[err._tag].push(err);
        return acc;
      },
      {} as Record<string, ValidationError[]>,
    );

    assertEquals(grouped["Required"].length, 1);
    assertEquals(grouped["InvalidFormat"].length, 1);
    assertEquals(grouped["OutOfRange"].length, 1);
  });
});
