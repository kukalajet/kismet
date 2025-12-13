import { assertEquals, assertThrows } from "@std/assert";
import {
  defineErrors,
  type ErrorsOf,
  t as types,
  type TaggedError,
} from "./error.ts";
import { err, ok, type Result } from "./result.ts";
import { type MatchConfig, matchExhaustive } from "./matcher.ts";

// =============================================================================
// Helper types for tests
// =============================================================================

type NotFoundError = TaggedError<"NotFound"> & { id: string };
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

type SimpleError =
  | (TaggedError<"NotFound"> & { id: string })
  | (TaggedError<"Unauthorized"> & { userId: string });

type AppError = NotFoundError | ValidationError | NetworkError;

// =============================================================================
// Helper functions for tests
// =============================================================================

function fetchResource(id: string): Result<string, SimpleError> {
  if (id === "404") {
    return err({ _tag: "NotFound", id });
  }
  if (id === "401") {
    return err({ _tag: "Unauthorized", userId: "user-123" });
  }
  return ok(`Resource ${id}`);
}

function validateAndFetch(
  input: string,
): Result<number, AppError> {
  if (input === "invalid") {
    return err({
      _tag: "ValidationError",
      field: "input",
      message: "Invalid input",
    });
  }
  if (input === "network-error") {
    return err({
      _tag: "NetworkError",
      statusCode: 500,
      retryable: true,
    });
  }
  if (input === "not-found") {
    return err({
      _tag: "NotFound",
      id: "123",
    });
  }
  return ok(42);
}

// =============================================================================
// matchExhaustive basic functionality tests
// =============================================================================

Deno.test("matchExhaustive basic functionality", async (t) => {
  await t.step("handles Ok result", () => {
    type SimpleError = TaggedError<"Error">;
    const result: Result<number, SimpleError> = ok(42);
    const message = matchExhaustive(result, {
      ok: (value) => `Success: ${value}`,
      Error: () => "Error",
    });
    assertEquals(message, "Success: 42");
  });

  await t.step("handles single error type", () => {
    type NotFound = TaggedError<"NotFound"> & { id: string };
    const result: Result<string, NotFound> = err({
      _tag: "NotFound",
      id: "123",
    });
    const message = matchExhaustive(result, {
      ok: (value) => `Success: ${value}`,
      NotFound: (error) => `Not found: ${error.id}`,
    });
    assertEquals(message, "Not found: 123");
  });

  await t.step("handles multiple error types", () => {
    const result1 = fetchResource("404");
    const message1 = matchExhaustive(result1, {
      ok: (value) => `Found: ${value}`,
      NotFound: (error) => `Resource ${error.id} not found`,
      Unauthorized: (error) => `User ${error.userId} not authorized`,
    });
    assertEquals(message1, "Resource 404 not found");

    const result2 = fetchResource("401");
    const message2 = matchExhaustive(result2, {
      ok: (value) => `Found: ${value}`,
      NotFound: (error) => `Resource ${error.id} not found`,
      Unauthorized: (error) => `User ${error.userId} not authorized`,
    });
    assertEquals(message2, "User user-123 not authorized");

    const result3 = fetchResource("200");
    const message3 = matchExhaustive(result3, {
      ok: (value) => `Found: ${value}`,
      NotFound: (error) => `Resource ${error.id} not found`,
      Unauthorized: (error) => `User ${error.userId} not authorized`,
    });
    assertEquals(message3, "Found: Resource 200");
  });

  await t.step("handles three error types", () => {
    const result1 = validateAndFetch("invalid");
    const message1 = matchExhaustive(result1, {
      ok: (value) => `Success: ${value}`,
      ValidationError: (error) => `Validation failed: ${error.message}`,
      NetworkError: (error) => `Network error: ${error.statusCode}`,
      NotFound: (error) => `Not found: ${error.id}`,
    });
    assertEquals(message1, "Validation failed: Invalid input");

    const result2 = validateAndFetch("network-error");
    const message2 = matchExhaustive(result2, {
      ok: (value) => `Success: ${value}`,
      ValidationError: (error) => `Validation failed: ${error.message}`,
      NetworkError: (error) => `Network error: ${error.statusCode}`,
      NotFound: (error) => `Not found: ${error.id}`,
    });
    assertEquals(message2, "Network error: 500");

    const result3 = validateAndFetch("not-found");
    const message3 = matchExhaustive(result3, {
      ok: (value) => `Success: ${value}`,
      ValidationError: (error) => `Validation failed: ${error.message}`,
      NetworkError: (error) => `Network error: ${error.statusCode}`,
      NotFound: (error) => `Not found: ${error.id}`,
    });
    assertEquals(message3, "Not found: 123");
  });
});

// =============================================================================
// matchExhaustive return type tests
// =============================================================================

Deno.test("matchExhaustive return types", async (t) => {
  await t.step("can return different types", () => {
    const result = fetchResource("200");

    // Return number
    const num = matchExhaustive(result, {
      ok: (_value) => 42,
      NotFound: (_error) => 0,
      Unauthorized: (_error) => -1,
    });
    assertEquals(num, 42);

    // Return boolean
    const bool = matchExhaustive(result, {
      ok: (_value) => true,
      NotFound: (_error) => false,
      Unauthorized: (_error) => false,
    });
    assertEquals(bool, true);

    // Return object
    type ResponseObj =
      | { success: true; data: string }
      | { success: false; error: string };
    const obj: ResponseObj = matchExhaustive(result, {
      ok: (value): ResponseObj => ({ success: true, data: value }),
      NotFound: (error): ResponseObj => ({ success: false, error: error.id }),
      Unauthorized: (error): ResponseObj => ({
        success: false,
        error: error.userId,
      }),
    });
    assertEquals(obj, { success: true, data: "Resource 200" });
  });

  await t.step("returns same type from all handlers", () => {
    type Response = { status: number; message: string };

    const result1 = fetchResource("404");
    const response1: Response = matchExhaustive(result1, {
      ok: (value) => ({ status: 200, message: value }),
      NotFound: (error) => ({ status: 404, message: `Not found: ${error.id}` }),
      Unauthorized: (error) => ({
        status: 401,
        message: `Unauthorized: ${error.userId}`,
      }),
    });
    assertEquals(response1, { status: 404, message: "Not found: 404" });

    const result2 = fetchResource("200");
    const response2: Response = matchExhaustive(result2, {
      ok: (value) => ({ status: 200, message: value }),
      NotFound: (error) => ({ status: 404, message: `Not found: ${error.id}` }),
      Unauthorized: (error) => ({
        status: 401,
        message: `Unauthorized: ${error.userId}`,
      }),
    });
    assertEquals(response2, { status: 200, message: "Resource 200" });
  });
});

// =============================================================================
// matchExhaustive with defineErrors tests
// =============================================================================

Deno.test("matchExhaustive with defineErrors", async (t) => {
  await t.step("works with defineErrors API", () => {
    const ApiErrors = defineErrors({
      NotFound: { resourceId: types.string },
      Forbidden: { action: types.string },
      ServerError: { code: types.number },
    });

    type ApiError = ErrorsOf<typeof ApiErrors>;

    function apiCall(scenario: string): Result<string, ApiError> {
      if (scenario === "not-found") {
        return err(ApiErrors.NotFound({ resourceId: "resource-123" }));
      }
      if (scenario === "forbidden") {
        return err(ApiErrors.Forbidden({ action: "delete" }));
      }
      if (scenario === "server-error") {
        return err(ApiErrors.ServerError({ code: 500 }));
      }
      return ok("Success");
    }

    const result1 = apiCall("not-found");
    const message1 = matchExhaustive(result1, {
      ok: (value) => `OK: ${value}`,
      NotFound: (error) => `Not found: ${error.resourceId}`,
      Forbidden: (error) => `Forbidden: ${error.action}`,
      ServerError: (error) => `Server error: ${error.code}`,
    });
    assertEquals(message1, "Not found: resource-123");

    const result2 = apiCall("forbidden");
    const message2 = matchExhaustive(result2, {
      ok: (value) => `OK: ${value}`,
      NotFound: (error) => `Not found: ${error.resourceId}`,
      Forbidden: (error) => `Forbidden: ${error.action}`,
      ServerError: (error) => `Server error: ${error.code}`,
    });
    assertEquals(message2, "Forbidden: delete");

    const result3 = apiCall("server-error");
    const message3 = matchExhaustive(result3, {
      ok: (value) => `OK: ${value}`,
      NotFound: (error) => `Not found: ${error.resourceId}`,
      Forbidden: (error) => `Forbidden: ${error.action}`,
      ServerError: (error) => `Server error: ${error.code}`,
    });
    assertEquals(message3, "Server error: 500");

    const result4 = apiCall("success");
    const message4 = matchExhaustive(result4, {
      ok: (value) => `OK: ${value}`,
      NotFound: (error) => `Not found: ${error.resourceId}`,
      Forbidden: (error) => `Forbidden: ${error.action}`,
      ServerError: (error) => `Server error: ${error.code}`,
    });
    assertEquals(message4, "OK: Success");
  });

  await t.step("works with complex error structures", () => {
    const UserErrors = defineErrors({
      NotFound: { userId: types.string },
      InvalidEmail: { email: types.string },
      InvalidAge: { age: types.number, reason: types.string },
      Unauthorized: {},
    });

    type UserError = ErrorsOf<typeof UserErrors>;

    function validateUser(scenario: string): Result<{ id: string }, UserError> {
      if (scenario === "not-found") {
        return err(UserErrors.NotFound({ userId: "user-123" }));
      }
      if (scenario === "invalid-email") {
        return err(UserErrors.InvalidEmail({ email: "invalid@" }));
      }
      if (scenario === "invalid-age") {
        return err(
          UserErrors.InvalidAge({ age: 15, reason: "Must be 18 or older" }),
        );
      }
      if (scenario === "unauthorized") {
        return err(UserErrors.Unauthorized({}));
      }
      return ok({ id: "user-456" });
    }

    const result1 = validateUser("not-found");
    const message1 = matchExhaustive(result1, {
      ok: (value) => `User ID: ${value.id}`,
      NotFound: (error) => `User ${error.userId} not found`,
      InvalidEmail: (error) => `Invalid email: ${error.email}`,
      InvalidAge: (error) => `Invalid age ${error.age}: ${error.reason}`,
      Unauthorized: () => "Unauthorized access",
    });
    assertEquals(message1, "User user-123 not found");

    const result2 = validateUser("invalid-email");
    const message2 = matchExhaustive(result2, {
      ok: (value) => `User ID: ${value.id}`,
      NotFound: (error) => `User ${error.userId} not found`,
      InvalidEmail: (error) => `Invalid email: ${error.email}`,
      InvalidAge: (error) => `Invalid age ${error.age}: ${error.reason}`,
      Unauthorized: () => "Unauthorized access",
    });
    assertEquals(message2, "Invalid email: invalid@");

    const result3 = validateUser("invalid-age");
    const message3 = matchExhaustive(result3, {
      ok: (value) => `User ID: ${value.id}`,
      NotFound: (error) => `User ${error.userId} not found`,
      InvalidEmail: (error) => `Invalid email: ${error.email}`,
      InvalidAge: (error) => `Invalid age ${error.age}: ${error.reason}`,
      Unauthorized: () => "Unauthorized access",
    });
    assertEquals(message3, "Invalid age 15: Must be 18 or older");

    const result4 = validateUser("unauthorized");
    const message4 = matchExhaustive(result4, {
      ok: (value) => `User ID: ${value.id}`,
      NotFound: (error) => `User ${error.userId} not found`,
      InvalidEmail: (error) => `Invalid email: ${error.email}`,
      InvalidAge: (error) => `Invalid age ${error.age}: ${error.reason}`,
      Unauthorized: () => "Unauthorized access",
    });
    assertEquals(message4, "Unauthorized access");

    const result5 = validateUser("success");
    const message5 = matchExhaustive(result5, {
      ok: (value) => `User ID: ${value.id}`,
      NotFound: (error) => `User ${error.userId} not found`,
      InvalidEmail: (error) => `Invalid email: ${error.email}`,
      InvalidAge: (error) => `Invalid age ${error.age}: ${error.reason}`,
      Unauthorized: () => "Unauthorized access",
    });
    assertEquals(message5, "User ID: user-456");
  });
});

// =============================================================================
// matchExhaustive error handling tests
// =============================================================================

Deno.test("matchExhaustive error handling", async (t) => {
  await t.step("throws on unhandled error tag", () => {
    // Create a result with an error tag that won't be in the config
    const result: Result<string, TaggedError<"UnknownError">> = err({
      _tag: "UnknownError",
    });

    // Cast to bypass TypeScript checking to test runtime behavior
    const config = {
      ok: (value: string) => value,
    } as MatchConfig<string, TaggedError<"UnknownError">, string>;

    assertThrows(
      () => matchExhaustive(result, config),
      Error,
      "Unhandled error tag: UnknownError",
    );
  });

  await t.step("handles errors with complex data", () => {
    type ComplexError = TaggedError<"ComplexError"> & {
      metadata: {
        timestamp: Date;
        userId: string;
        attempts: number;
      };
      reasons: string[];
    };

    const date = new Date("2024-01-01");
    const result: Result<string, ComplexError> = err({
      _tag: "ComplexError",
      metadata: {
        timestamp: date,
        userId: "user-123",
        attempts: 3,
      },
      reasons: ["Invalid input", "Rate limited"],
    });

    const message = matchExhaustive(result, {
      ok: (value) => `Success: ${value}`,
      ComplexError: (error) => {
        return `Error for ${error.metadata.userId} after ${error.metadata.attempts} attempts: ${
          error.reasons.join(", ")
        }`;
      },
    });

    assertEquals(
      message,
      "Error for user-123 after 3 attempts: Invalid input, Rate limited",
    );
  });
});

// =============================================================================
// matchExhaustive nested and chained tests
// =============================================================================

Deno.test("matchExhaustive nested and chained", async (t) => {
  await t.step("can be nested", () => {
    type OuterError =
      | (TaggedError<"OuterNotFound"> & { id: string })
      | (TaggedError<"OuterInvalid"> & { reason: string });

    type InnerError =
      | (TaggedError<"InnerNotFound"> & { id: string })
      | (TaggedError<"InnerInvalid"> & { reason: string });

    function outerOperation(
      scenario: string,
    ): Result<Result<string, InnerError>, OuterError> {
      if (scenario === "outer-not-found") {
        return err({ _tag: "OuterNotFound", id: "outer-123" });
      }
      if (scenario === "outer-invalid") {
        return err({ _tag: "OuterInvalid", reason: "Outer invalid" });
      }
      if (scenario === "inner-not-found") {
        return ok(err({ _tag: "InnerNotFound", id: "inner-123" }));
      }
      if (scenario === "inner-invalid") {
        return ok(err({ _tag: "InnerInvalid", reason: "Inner invalid" }));
      }
      return ok(ok("Success"));
    }

    const result1 = outerOperation("outer-not-found");
    const message1 = matchExhaustive(result1, {
      ok: (innerResult) =>
        matchExhaustive(innerResult, {
          ok: (value) => `Success: ${value}`,
          InnerNotFound: (error) => `Inner not found: ${error.id}`,
          InnerInvalid: (error) => `Inner invalid: ${error.reason}`,
        }),
      OuterNotFound: (error) => `Outer not found: ${error.id}`,
      OuterInvalid: (error) => `Outer invalid: ${error.reason}`,
    });
    assertEquals(message1, "Outer not found: outer-123");

    const result2 = outerOperation("inner-not-found");
    const message2 = matchExhaustive(result2, {
      ok: (innerResult) =>
        matchExhaustive(innerResult, {
          ok: (value) => `Success: ${value}`,
          InnerNotFound: (error) => `Inner not found: ${error.id}`,
          InnerInvalid: (error) => `Inner invalid: ${error.reason}`,
        }),
      OuterNotFound: (error) => `Outer not found: ${error.id}`,
      OuterInvalid: (error) => `Outer invalid: ${error.reason}`,
    });
    assertEquals(message2, "Inner not found: inner-123");

    const result3 = outerOperation("success");
    const message3 = matchExhaustive(result3, {
      ok: (innerResult) =>
        matchExhaustive(innerResult, {
          ok: (value) => `Success: ${value}`,
          InnerNotFound: (error) => `Inner not found: ${error.id}`,
          InnerInvalid: (error) => `Inner invalid: ${error.reason}`,
        }),
      OuterNotFound: (error) => `Outer not found: ${error.id}`,
      OuterInvalid: (error) => `Outer invalid: ${error.reason}`,
    });
    assertEquals(message3, "Success: Success");
  });

  await t.step("can be chained for control flow", () => {
    type StepError =
      | (TaggedError<"Step1Failed"> & { reason: string })
      | (TaggedError<"Step2Failed"> & { reason: string })
      | (TaggedError<"Step3Failed"> & { reason: string });

    function step1(input: string): Result<string, StepError> {
      if (input === "fail-step1") {
        return err({ _tag: "Step1Failed", reason: "Step 1 error" });
      }
      return ok("step1-result");
    }

    function step2(input: string): Result<string, StepError> {
      if (input === "fail-step2") {
        return err({ _tag: "Step2Failed", reason: "Step 2 error" });
      }
      return ok("step2-result");
    }

    function step3(input: string): Result<string, StepError> {
      if (input === "fail-step3") {
        return err({ _tag: "Step3Failed", reason: "Step 3 error" });
      }
      return ok("step3-result");
    }

    function pipeline(scenario: string): string {
      const result1 = step1(scenario);
      return matchExhaustive(result1, {
        ok: (val1) => {
          const result2 = step2(scenario);
          return matchExhaustive(result2, {
            ok: (val2) => {
              const result3 = step3(scenario);
              return matchExhaustive(result3, {
                ok: (val3) => `Success: ${val1} -> ${val2} -> ${val3}`,
                Step1Failed: (e) => `Step 1 failed: ${e.reason}`,
                Step2Failed: (e) => `Step 2 failed: ${e.reason}`,
                Step3Failed: (e) => `Step 3 failed: ${e.reason}`,
              });
            },
            Step1Failed: (e) => `Step 1 failed: ${e.reason}`,
            Step2Failed: (e) => `Step 2 failed: ${e.reason}`,
            Step3Failed: (e) => `Step 3 failed: ${e.reason}`,
          });
        },
        Step1Failed: (e) => `Step 1 failed: ${e.reason}`,
        Step2Failed: (e) => `Step 2 failed: ${e.reason}`,
        Step3Failed: (e) => `Step 3 failed: ${e.reason}`,
      });
    }

    assertEquals(
      pipeline("success"),
      "Success: step1-result -> step2-result -> step3-result",
    );
    assertEquals(pipeline("fail-step1"), "Step 1 failed: Step 1 error");
    assertEquals(pipeline("fail-step2"), "Step 2 failed: Step 2 error");
    assertEquals(pipeline("fail-step3"), "Step 3 failed: Step 3 error");
  });
});

// =============================================================================
// matchExhaustive with various value types tests
// =============================================================================

Deno.test("matchExhaustive with various value types", async (t) => {
  await t.step("works with primitive types", () => {
    type SimpleError = TaggedError<"Error"> & { message: string };

    // String
    const stringResult: Result<string, SimpleError> = ok("hello");
    const stringMessage = matchExhaustive(stringResult, {
      ok: (value) => value.toUpperCase(),
      Error: (error) => error.message,
    });
    assertEquals(stringMessage, "HELLO");

    // Number
    const numberResult: Result<number, SimpleError> = ok(42);
    const numberMessage = matchExhaustive(numberResult, {
      ok: (value) => value * 2,
      Error: () => 0,
    });
    assertEquals(numberMessage, 84);

    // Boolean
    const boolResult: Result<boolean, SimpleError> = ok(true);
    const boolMessage = matchExhaustive(boolResult, {
      ok: (value) => !value,
      Error: () => false,
    });
    assertEquals(boolMessage, false);

    // null
    const nullResult: Result<null, SimpleError> = ok(null);
    const nullMessage = matchExhaustive(nullResult, {
      ok: () => "was null",
      Error: () => "error",
    });
    assertEquals(nullMessage, "was null");

    // undefined
    const undefinedResult: Result<undefined, SimpleError> = ok(undefined);
    const undefinedMessage = matchExhaustive(undefinedResult, {
      ok: () => "was undefined",
      Error: () => "error",
    });
    assertEquals(undefinedMessage, "was undefined");
  });

  await t.step("works with complex value types", () => {
    type SimpleError = TaggedError<"Error">;

    // Array
    const arrayResult: Result<number[], SimpleError> = ok([1, 2, 3]);
    const arraySum = matchExhaustive(arrayResult, {
      ok: (arr) => arr.reduce((sum, n) => sum + n, 0),
      Error: () => 0,
    });
    assertEquals(arraySum, 6);

    // Object
    interface User {
      id: string;
      name: string;
      age: number;
    }
    const objResult: Result<User, SimpleError> = ok({
      id: "1",
      name: "Alice",
      age: 30,
    });
    const greeting = matchExhaustive(objResult, {
      ok: (user) => `Hello, ${user.name} (${user.age})`,
      Error: () => "Error",
    });
    assertEquals(greeting, "Hello, Alice (30)");

    // Nested object
    type Config = {
      app: { name: string; version: string };
      server: { host: string; port: number };
    };
    const configResult: Result<Config, SimpleError> = ok({
      app: { name: "MyApp", version: "1.0.0" },
      server: { host: "localhost", port: 3000 },
    });
    const configStr = matchExhaustive(configResult, {
      ok: (config) =>
        `${config.app.name} v${config.app.version} on ${config.server.host}:${config.server.port}`,
      Error: () => "Error",
    });
    assertEquals(configStr, "MyApp v1.0.0 on localhost:3000");
  });

  await t.step("works with special types", () => {
    type SimpleError = TaggedError<"Error">;

    // Date
    const date = new Date("2024-01-01T00:00:00Z");
    const dateResult: Result<Date, SimpleError> = ok(date);
    const year = matchExhaustive(dateResult, {
      ok: (d) => d.getFullYear(),
      Error: () => 0,
    });
    assertEquals(year, 2024);

    // RegExp
    const regexResult: Result<RegExp, SimpleError> = ok(/hello/i);
    const matches = matchExhaustive(regexResult, {
      ok: (regex) => regex.test("HELLO"),
      Error: () => false,
    });
    assertEquals(matches, true);

    // Map
    const mapResult: Result<Map<string, number>, SimpleError> = ok(
      new Map([
        ["a", 1],
        ["b", 2],
      ]),
    );
    const mapSize = matchExhaustive(mapResult, {
      ok: (map) => map.size,
      Error: () => 0,
    });
    assertEquals(mapSize, 2);

    // Set
    const setResult: Result<Set<number>, SimpleError> = ok(new Set([1, 2, 3]));
    const setHas = matchExhaustive(setResult, {
      ok: (set) => set.has(2),
      Error: () => false,
    });
    assertEquals(setHas, true);
  });
});

// =============================================================================
// matchExhaustive type safety tests
// =============================================================================

Deno.test("matchExhaustive type safety", async (t) => {
  await t.step("preserves error type information", () => {
    type TypedError = TaggedError<"TypedError"> & {
      code: number;
      message: string;
      metadata: { userId: string };
    };

    const result: Result<string, TypedError> = err({
      _tag: "TypedError",
      code: 404,
      message: "Not found",
      metadata: { userId: "user-123" },
    });

    const info = matchExhaustive(result, {
      ok: (_value) => "ok",
      TypedError: (error) => {
        // All properties should be accessible with correct types
        const code: number = error.code;
        const message: string = error.message;
        const userId: string = error.metadata.userId;
        return `${code}: ${message} (${userId})`;
      },
    });

    assertEquals(info, "404: Not found (user-123)");
  });

  await t.step("handler receives correctly narrowed error type", () => {
    const Errors = defineErrors({
      NotFound: { resourceId: types.string },
      ValidationError: {
        field: types.string,
        errors: types.array<string>(),
      },
      NetworkError: { statusCode: types.number, retryable: types.boolean },
    });

    type AppError = ErrorsOf<typeof Errors>;

    const result: Result<string, AppError> = err(
      Errors.ValidationError({
        field: "email",
        errors: ["Invalid format", "Too long"],
      }),
    );

    const message = matchExhaustive(result, {
      ok: (value) => `Success: ${value}`,
      NotFound: (error) => {
        // error should be narrowed to NotFound type
        const id: string = error.resourceId;
        return `Not found: ${id}`;
      },
      ValidationError: (error) => {
        // error should be narrowed to ValidationError type
        const field: string = error.field;
        const errors: string[] = error.errors;
        return `Validation failed on ${field}: ${errors.join(", ")}`;
      },
      NetworkError: (error) => {
        // error should be narrowed to NetworkError type
        const code: number = error.statusCode;
        const retry: boolean = error.retryable;
        return `Network error ${code} (retryable: ${retry})`;
      },
    });

    assertEquals(
      message,
      "Validation failed on email: Invalid format, Too long",
    );
  });
});

// =============================================================================
// MatchConfig type tests
// =============================================================================

Deno.test("MatchConfig type", async (t) => {
  await t.step("correctly types the config object", () => {
    type TestError =
      | (TaggedError<"ErrorA"> & { valueA: string })
      | (TaggedError<"ErrorB"> & { valueB: number });

    // This should type-check correctly
    const config: MatchConfig<string, TestError, string> = {
      ok: (value: string) => value,
      ErrorA: (error) => error.valueA,
      ErrorB: (error) => error.valueB.toString(),
    };

    const result1: Result<string, TestError> = ok("success");
    assertEquals(matchExhaustive(result1, config), "success");

    const result2: Result<string, TestError> = err({
      _tag: "ErrorA",
      valueA: "a-value",
    });
    assertEquals(matchExhaustive(result2, config), "a-value");

    const result3: Result<string, TestError> = err({
      _tag: "ErrorB",
      valueB: 42,
    });
    assertEquals(matchExhaustive(result3, config), "42");
  });

  await t.step("enforces return type consistency", () => {
    type TestError = TaggedError<"Error"> & { message: string };

    // All handlers must return the same type
    const config: MatchConfig<number, TestError, boolean> = {
      ok: (value) => value > 0,
      Error: (error) => error.message.length > 0,
    };

    const result1: Result<number, TestError> = ok(42);
    assertEquals(matchExhaustive(result1, config), true);

    const result2: Result<number, TestError> = err({
      _tag: "Error",
      message: "error",
    });
    assertEquals(matchExhaustive(result2, config), true);
  });
});

// =============================================================================
// Real-world usage scenarios
// =============================================================================

Deno.test("matchExhaustive real-world scenarios", async (t) => {
  await t.step("HTTP response handling", () => {
    const HttpErrors = defineErrors({
      BadRequest: { message: types.string },
      Unauthorized: {},
      Forbidden: { resource: types.string },
      NotFound: { path: types.string },
      ServerError: { code: types.number },
    });

    type HttpError = ErrorsOf<typeof HttpErrors>;
    type Response<T> = Result<T, HttpError>;

    function fetchUser(userId: string): Response<{ id: string; name: string }> {
      if (userId === "unauthorized") {
        return err(HttpErrors.Unauthorized({}));
      }
      if (userId === "not-found") {
        return err(HttpErrors.NotFound({ path: `/users/${userId}` }));
      }
      if (userId === "forbidden") {
        return err(HttpErrors.Forbidden({ resource: "user profile" }));
      }
      return ok({ id: userId, name: "John Doe" });
    }

    type HttpResponse =
      | { status: 200; body: { id: string; name: string } }
      | { status: 400 | 401 | 403 | 404 | 500; body: { error: string } };

    function handleResponse(
      result: Response<{ id: string; name: string }>,
    ): HttpResponse {
      return matchExhaustive(result, {
        ok: (user): HttpResponse => ({ status: 200, body: user }),
        BadRequest: (error): HttpResponse => ({
          status: 400,
          body: { error: error.message },
        }),
        Unauthorized: (): HttpResponse => ({
          status: 401,
          body: { error: "Unauthorized" },
        }),
        Forbidden: (error): HttpResponse => ({
          status: 403,
          body: { error: `Forbidden: ${error.resource}` },
        }),
        NotFound: (error): HttpResponse => ({
          status: 404,
          body: { error: `Not found: ${error.path}` },
        }),
        ServerError: (error): HttpResponse => ({
          status: 500,
          body: { error: `Server error: ${error.code}` },
        }),
      });
    }

    const response1 = handleResponse(fetchUser("123"));
    assertEquals(response1, {
      status: 200,
      body: { id: "123", name: "John Doe" },
    });

    const response2 = handleResponse(fetchUser("unauthorized"));
    assertEquals(response2, {
      status: 401,
      body: { error: "Unauthorized" },
    });

    const response3 = handleResponse(fetchUser("not-found"));
    assertEquals(response3, {
      status: 404,
      body: { error: "Not found: /users/not-found" },
    });

    const response4 = handleResponse(fetchUser("forbidden"));
    assertEquals(response4, {
      status: 403,
      body: { error: "Forbidden: user profile" },
    });
  });

  await t.step("form validation with multiple errors", () => {
    const ValidationErrors = defineErrors({
      Required: { field: types.string },
      InvalidFormat: { field: types.string, pattern: types.string },
      TooShort: { field: types.string, minLength: types.number },
      TooLong: { field: types.string, maxLength: types.number },
    });

    type ValidationError = ErrorsOf<typeof ValidationErrors>;

    function validateEmail(email: string): Result<string, ValidationError> {
      if (!email) {
        return err(ValidationErrors.Required({ field: "email" }));
      }
      if (!email.includes("@")) {
        return err(
          ValidationErrors.InvalidFormat({
            field: "email",
            pattern: "must contain @",
          }),
        );
      }
      return ok(email);
    }

    function getValidationMessage(
      result: Result<string, ValidationError>,
    ): string {
      return matchExhaustive(result, {
        ok: () => "Valid",
        Required: (error) => `${error.field} is required`,
        InvalidFormat: (error) => `${error.field} ${error.pattern}`,
        TooShort: (error) =>
          `${error.field} must be at least ${error.minLength} characters`,
        TooLong: (error) =>
          `${error.field} must be at most ${error.maxLength} characters`,
      });
    }

    assertEquals(
      getValidationMessage(validateEmail("")),
      "email is required",
    );
    assertEquals(
      getValidationMessage(validateEmail("invalid")),
      "email must contain @",
    );
    assertEquals(
      getValidationMessage(validateEmail("valid@example.com")),
      "Valid",
    );
  });

  await t.step("database operation with retry logic", () => {
    const DbErrors = defineErrors({
      ConnectionFailed: { host: types.string, attempt: types.number },
      QueryFailed: { query: types.string, sqlError: types.string },
      Timeout: { duration: types.number },
      Deadlock: { table: types.string },
    });

    type DbError = ErrorsOf<typeof DbErrors>;

    function executeQuery(scenario: string): Result<unknown[], DbError> {
      if (scenario === "connection-failed") {
        return err(
          DbErrors.ConnectionFailed({ host: "localhost", attempt: 1 }),
        );
      }
      if (scenario === "query-failed") {
        return err(
          DbErrors.QueryFailed({
            query: "SELECT * FROM users",
            sqlError: "Syntax error",
          }),
        );
      }
      if (scenario === "timeout") {
        return err(DbErrors.Timeout({ duration: 5000 }));
      }
      if (scenario === "deadlock") {
        return err(DbErrors.Deadlock({ table: "users" }));
      }
      return ok([{ id: 1, name: "John" }]);
    }

    type RetryDecision = { shouldRetry: boolean; message: string };

    function handleDbError(result: Result<unknown[], DbError>): RetryDecision {
      return matchExhaustive(result, {
        ok: (): RetryDecision => ({ shouldRetry: false, message: "Success" }),
        ConnectionFailed: (error): RetryDecision => ({
          shouldRetry: error.attempt < 3,
          message:
            `Connection to ${error.host} failed (attempt ${error.attempt})`,
        }),
        QueryFailed: (error): RetryDecision => ({
          shouldRetry: false,
          message: `Query failed: ${error.sqlError}`,
        }),
        Timeout: (error): RetryDecision => ({
          shouldRetry: true,
          message: `Timeout after ${error.duration}ms`,
        }),
        Deadlock: (error): RetryDecision => ({
          shouldRetry: true,
          message: `Deadlock on table ${error.table}`,
        }),
      });
    }

    const decision1 = handleDbError(executeQuery("connection-failed"));
    assertEquals(decision1, {
      shouldRetry: true,
      message: "Connection to localhost failed (attempt 1)",
    });

    const decision2 = handleDbError(executeQuery("query-failed"));
    assertEquals(decision2, {
      shouldRetry: false,
      message: "Query failed: Syntax error",
    });

    const decision3 = handleDbError(executeQuery("timeout"));
    assertEquals(decision3, {
      shouldRetry: true,
      message: "Timeout after 5000ms",
    });

    const decision4 = handleDbError(executeQuery("deadlock"));
    assertEquals(decision4, {
      shouldRetry: true,
      message: "Deadlock on table users",
    });

    const decision5 = handleDbError(executeQuery("success"));
    assertEquals(decision5, {
      shouldRetry: false,
      message: "Success",
    });
  });
});
