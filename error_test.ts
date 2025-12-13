import { assertEquals, assertStrictEquals } from "@std/assert";
import { makeTaggedError, type TaggedError } from "./error.ts";

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
