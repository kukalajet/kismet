import { assertEquals, assertStrictEquals } from "@std/assert";
import { err, isErr, isOk, ok, type Result } from "./result.ts";

// =============================================================================
// Helper types for tests
// =============================================================================

type DivisionError = { _tag: "DivisionByZero" };
type ParseError = { _tag: "ParseError"; input: string };
type MathError = { _tag: "DivisionByZero" } | { _tag: "NegativeNumber" };
type NetworkError = { _tag: "NetworkError"; message: string };
type ValidationError = { _tag: "ValidationError"; field: string };
type AppError = NetworkError | ValidationError;

interface User {
  id: number;
  name: string;
}

type UserError = { _tag: "NotFound" } | { _tag: "InvalidId" };

// =============================================================================
// Helper functions for tests
// =============================================================================

function divide(a: number, b: number): Result<number, DivisionError> {
  if (b === 0) {
    return err({ _tag: "DivisionByZero" });
  }
  return ok(a / b);
}

function parseNumber(str: string): Result<number, ParseError> {
  const num = Number(str);
  if (Number.isNaN(num)) {
    return err({ _tag: "ParseError", input: str });
  }
  return ok(num);
}

function divideWithMathError(a: number, b: number): Result<number, MathError> {
  if (b === 0) return err({ _tag: "DivisionByZero" });
  return ok(a / b);
}

function sqrt(n: number): Result<number, MathError> {
  if (n < 0) return err({ _tag: "NegativeNumber" });
  return ok(Math.sqrt(n));
}

function validateAndFetch(url: string): Result<{ data: string }, AppError> {
  if (!url.startsWith("https://")) {
    return err({ _tag: "ValidationError", field: "url" });
  }
  if (url.includes("fail")) {
    return err({ _tag: "NetworkError", message: "Connection refused" });
  }
  return ok({ data: "fetched data" });
}

function getUser(id: number): Result<User, UserError> {
  if (id < 0) return err({ _tag: "InvalidId" });
  if (id === 0) return err({ _tag: "NotFound" });
  return ok({ id, name: `User ${id}` });
}

// =============================================================================
// ok() constructor
// =============================================================================

Deno.test("ok", async (t) => {
  await t.step("creates Ok variant with correct _tag", () => {
    const result = ok(42);
    assertEquals(result._tag, "Ok");
  });

  await t.step("stores the provided value", () => {
    const result = ok(42);
    if (isOk(result)) {
      assertEquals(result.value, 42);
    }
  });

  await t.step("primitive types", async (t) => {
    await t.step("number", () => {
      const result = ok(123);
      if (isOk(result)) assertEquals(result.value, 123);
    });

    await t.step("string", () => {
      const result = ok("hello");
      if (isOk(result)) assertEquals(result.value, "hello");
    });

    await t.step("boolean", () => {
      const result = ok(true);
      if (isOk(result)) assertEquals(result.value, true);
    });

    await t.step("null", () => {
      const result = ok(null);
      if (isOk(result)) assertEquals(result.value, null);
    });

    await t.step("undefined", () => {
      const result = ok(undefined);
      if (isOk(result)) assertEquals(result.value, undefined);
    });

    await t.step("bigint", () => {
      const result = ok(BigInt(9007199254740991));
      if (isOk(result)) assertEquals(result.value, BigInt(9007199254740991));
    });

    await t.step("symbol", () => {
      const sym = Symbol("test");
      const result = ok(sym);
      if (isOk(result)) assertStrictEquals(result.value, sym);
    });
  });

  await t.step("complex types", async (t) => {
    await t.step("object preserves reference", () => {
      const obj = { name: "John", age: 30 };
      const result = ok(obj);
      if (isOk(result)) {
        assertEquals(result.value, obj);
        assertStrictEquals(result.value, obj);
      }
    });

    await t.step("array", () => {
      const arr = [1, 2, 3];
      const result = ok(arr);
      if (isOk(result)) assertEquals(result.value, arr);
    });

    await t.step("nested object", () => {
      const nested = { user: { profile: { settings: { theme: "dark" } } } };
      const result = ok(nested);
      if (isOk(result)) {
        assertEquals(result.value.user.profile.settings.theme, "dark");
      }
    });

    await t.step("function", () => {
      const fn = (x: number) => x * 2;
      const result = ok(fn);
      if (isOk(result)) {
        assertStrictEquals(result.value, fn);
        assertEquals(result.value(5), 10);
      }
    });

    await t.step("Map", () => {
      const map = new Map([["key", "value"]]);
      const result = ok(map);
      if (isOk(result)) {
        assertStrictEquals(result.value, map);
        assertEquals(result.value.get("key"), "value");
      }
    });

    await t.step("Set", () => {
      const set = new Set([1, 2, 3]);
      const result = ok(set);
      if (isOk(result)) {
        assertStrictEquals(result.value, set);
        assertEquals(result.value.has(2), true);
      }
    });

    await t.step("Date", () => {
      const date = new Date("2024-01-01");
      const result = ok(date);
      if (isOk(result)) assertStrictEquals(result.value, date);
    });
  });

  await t.step("edge cases", async (t) => {
    await t.step("empty string", () => {
      const result = ok("");
      if (isOk(result)) assertEquals(result.value, "");
    });

    await t.step("zero", () => {
      const result = ok(0);
      if (isOk(result)) assertEquals(result.value, 0);
    });

    await t.step("negative zero", () => {
      const result = ok(-0);
      if (isOk(result)) assertEquals(result.value, -0);
    });

    await t.step("NaN", () => {
      const result = ok(NaN);
      if (isOk(result)) assertEquals(Number.isNaN(result.value), true);
    });

    await t.step("Infinity", () => {
      const result = ok(Infinity);
      if (isOk(result)) assertEquals(result.value, Infinity);
    });

    await t.step("negative Infinity", () => {
      const result = ok(-Infinity);
      if (isOk(result)) assertEquals(result.value, -Infinity);
    });

    await t.step("empty object", () => {
      const result = ok({});
      if (isOk(result)) assertEquals(result.value, {});
    });

    await t.step("empty array", () => {
      const result = ok([]);
      if (isOk(result)) assertEquals(result.value, []);
    });
  });
});

// =============================================================================
// err() constructor
// =============================================================================

Deno.test("err", async (t) => {
  await t.step("creates Err variant with correct _tag", () => {
    const result = err("Something went wrong");
    assertEquals(result._tag, "Err");
  });

  await t.step("stores the provided error", () => {
    const result = err("Something went wrong");
    if (isErr(result)) assertEquals(result.error, "Something went wrong");
  });

  await t.step("error types", async (t) => {
    await t.step("string", () => {
      const result = err("error message");
      if (isErr(result)) assertEquals(result.error, "error message");
    });

    await t.step("Error object", () => {
      const error = new Error("test error");
      const result = err(error);
      if (isErr(result)) {
        assertStrictEquals(result.error, error);
        assertEquals(result.error.message, "test error");
      }
    });

    await t.step("tagged error object", () => {
      const result = err({ _tag: "ValidationError" as const, field: "email" });
      if (isErr(result)) {
        assertEquals(result.error._tag, "ValidationError");
        assertEquals(result.error.field, "email");
      }
    });

    await t.step("number (error code)", () => {
      const result = err(404);
      if (isErr(result)) assertEquals(result.error, 404);
    });

    await t.step("null", () => {
      const result = err(null);
      if (isErr(result)) assertEquals(result.error, null);
    });

    await t.step("undefined", () => {
      const result = err(undefined);
      if (isErr(result)) assertEquals(result.error, undefined);
    });

    await t.step("complex object with metadata", () => {
      const result = err({
        code: "NETWORK_ERROR",
        message: "Failed to fetch",
        retryable: true,
        timestamp: new Date("2024-01-01"),
      });
      if (isErr(result)) {
        assertEquals(result.error.code, "NETWORK_ERROR");
        assertEquals(result.error.retryable, true);
      }
    });
  });

  await t.step("custom Error subclass", () => {
    class CustomError extends Error {
      constructor(
        public readonly code: string,
        message: string,
      ) {
        super(message);
        this.name = "CustomError";
      }
    }

    const customErr = new CustomError("E001", "Custom error occurred");
    const result = err(customErr);

    if (isErr(result)) {
      assertStrictEquals(result.error, customErr);
      assertEquals(result.error.code, "E001");
      assertEquals(result.error.message, "Custom error occurred");
    }
  });
});

// =============================================================================
// isOk() type guard
// =============================================================================

Deno.test("isOk", async (t) => {
  await t.step("returns true for Ok variant", () => {
    assertEquals(isOk(ok(42)), true);
  });

  await t.step("returns false for Err variant", () => {
    assertEquals(isOk(err("error")), false);
  });

  await t.step("narrows type to access .value", () => {
    const result: Result<number, string> = ok(42);
    if (isOk(result)) {
      const value: number = result.value;
      assertEquals(value, 42);
    }
  });

  await t.step("returns true for falsy Ok values", async (t) => {
    await t.step("null", () => assertEquals(isOk(ok(null)), true));
    await t.step("undefined", () => assertEquals(isOk(ok(undefined)), true));
    await t.step("false", () => assertEquals(isOk(ok(false)), true));
    await t.step("0", () => assertEquals(isOk(ok(0)), true));
    await t.step("empty string", () => assertEquals(isOk(ok("")), true));
  });
});

// =============================================================================
// isErr() type guard
// =============================================================================

Deno.test("isErr", async (t) => {
  await t.step("returns true for Err variant", () => {
    assertEquals(isErr(err("error")), true);
  });

  await t.step("returns false for Ok variant", () => {
    assertEquals(isErr(ok(42)), false);
  });

  await t.step("narrows type to access .error", () => {
    const result: Result<number, string> = err("something went wrong");
    if (isErr(result)) {
      const error: string = result.error;
      assertEquals(error, "something went wrong");
    }
  });

  await t.step("returns true for falsy Err values", async (t) => {
    await t.step("null", () => assertEquals(isErr(err(null)), true));
    await t.step("undefined", () => assertEquals(isErr(err(undefined)), true));
    await t.step("false", () => assertEquals(isErr(err(false)), true));
    await t.step("0", () => assertEquals(isErr(err(0)), true));
    await t.step("empty string", () => assertEquals(isErr(err("")), true));
  });
});

// =============================================================================
// isOk and isErr mutual exclusivity
// =============================================================================

Deno.test("isOk and isErr are mutually exclusive", async (t) => {
  await t.step("Ok variant: isOk=true, isErr=false", () => {
    const result: Result<string, string> = ok("success");
    assertEquals(isOk(result), true);
    assertEquals(isErr(result), false);
  });

  await t.step("Err variant: isOk=false, isErr=true", () => {
    const result: Result<string, string> = err("failure");
    assertEquals(isOk(result), false);
    assertEquals(isErr(result), true);
  });
});

// =============================================================================
// Practical usage patterns
// =============================================================================

Deno.test("division function pattern", async (t) => {
  await t.step("successful division returns Ok with quotient", () => {
    const result = divide(10, 2);
    assertEquals(isOk(result), true);
    if (isOk(result)) assertEquals(result.value, 5);
  });

  await t.step("division by zero returns Err", () => {
    const result = divide(10, 0);
    assertEquals(isErr(result), true);
    if (isErr(result)) assertEquals(result.error._tag, "DivisionByZero");
  });
});

Deno.test("parse function pattern", async (t) => {
  await t.step("valid input returns Ok with parsed number", () => {
    const result = parseNumber("42");
    assertEquals(isOk(result), true);
    if (isOk(result)) assertEquals(result.value, 42);
  });

  await t.step("invalid input returns Err with original input", () => {
    const result = parseNumber("not a number");
    assertEquals(isErr(result), true);
    if (isErr(result)) {
      assertEquals(result.error._tag, "ParseError");
      assertEquals(result.error.input, "not a number");
    }
  });
});

Deno.test("result chaining", async (t) => {
  await t.step("both operations succeed", () => {
    const divideResult = divideWithMathError(16, 4);
    const finalResult = isOk(divideResult)
      ? sqrt(divideResult.value)
      : divideResult;

    assertEquals(isOk(finalResult), true);
    if (isOk(finalResult)) assertEquals(finalResult.value, 2);
  });

  await t.step("first operation fails - error propagates", () => {
    const divideResult = divideWithMathError(16, 0);
    const finalResult = isOk(divideResult)
      ? sqrt(divideResult.value)
      : divideResult;

    assertEquals(isErr(finalResult), true);
    if (isErr(finalResult)) {
      assertEquals(finalResult.error._tag, "DivisionByZero");
    }
  });

  await t.step("second operation fails", () => {
    const divideResult = divideWithMathError(-16, 4);
    const finalResult = isOk(divideResult)
      ? sqrt(divideResult.value)
      : divideResult;

    assertEquals(isErr(finalResult), true);
    if (isErr(finalResult)) {
      assertEquals(finalResult.error._tag, "NegativeNumber");
    }
  });
});

Deno.test("multiple error types (union)", async (t) => {
  await t.step("validation error", () => {
    const result = validateAndFetch("http://example.com");
    assertEquals(isErr(result), true);
    if (isErr(result)) assertEquals(result.error._tag, "ValidationError");
  });

  await t.step("network error", () => {
    const result = validateAndFetch("https://fail.example.com");
    assertEquals(isErr(result), true);
    if (isErr(result)) assertEquals(result.error._tag, "NetworkError");
  });

  await t.step("success", () => {
    const result = validateAndFetch("https://example.com");
    assertEquals(isOk(result), true);
    if (isOk(result)) assertEquals(result.value.data, "fetched data");
  });
});

Deno.test("discriminated union exhaustive handling", () => {
  type ErrorType =
    | { _tag: "NotFound"; id: number }
    | { _tag: "Unauthorized"; reason: string }
    | { _tag: "ServerError"; code: number };

  function handleError(error: ErrorType): string {
    switch (error._tag) {
      case "NotFound":
        return `Not found: ${error.id}`;
      case "Unauthorized":
        return `Unauthorized: ${error.reason}`;
      case "ServerError":
        return `Server error: ${error.code}`;
    }
  }

  const notFound: Result<string, ErrorType> = err({
    _tag: "NotFound",
    id: 123,
  });
  if (isErr(notFound)) {
    assertEquals(handleError(notFound.error), "Not found: 123");
  }

  const unauthorized: Result<string, ErrorType> = err({
    _tag: "Unauthorized",
    reason: "Invalid token",
  });
  if (isErr(unauthorized)) {
    assertEquals(
      handleError(unauthorized.error),
      "Unauthorized: Invalid token",
    );
  }

  const serverError: Result<string, ErrorType> = err({
    _tag: "ServerError",
    code: 500,
  });
  if (isErr(serverError)) {
    assertEquals(handleError(serverError.error), "Server error: 500");
  }
});

Deno.test("function return type", async (t) => {
  await t.step("returns Ok with user for valid id", () => {
    const result = getUser(1);
    assertEquals(isOk(result), true);
    if (isOk(result)) {
      assertEquals(result.value.id, 1);
      assertEquals(result.value.name, "User 1");
    }
  });

  await t.step("returns NotFound error for id 0", () => {
    const result = getUser(0);
    assertEquals(isErr(result), true);
    if (isErr(result)) assertEquals(result.error._tag, "NotFound");
  });

  await t.step("returns InvalidId error for negative id", () => {
    const result = getUser(-1);
    assertEquals(isErr(result), true);
    if (isErr(result)) assertEquals(result.error._tag, "InvalidId");
  });
});

Deno.test("async/Promise wrapping", async (t) => {
  type FetchError = { _tag: "NetworkError"; message: string };

  async function fetchData(
    shouldSucceed: boolean,
  ): Promise<Result<{ data: string }, FetchError>> {
    await Promise.resolve();
    if (shouldSucceed) return ok({ data: "fetched successfully" });
    return err({ _tag: "NetworkError", message: "Connection failed" });
  }

  await t.step("async success", async () => {
    const result = await fetchData(true);
    assertEquals(isOk(result), true);
    if (isOk(result)) assertEquals(result.value.data, "fetched successfully");
  });

  await t.step("async failure", async () => {
    const result = await fetchData(false);
    assertEquals(isErr(result), true);
    if (isErr(result)) assertEquals(result.error._tag, "NetworkError");
  });
});

// =============================================================================
// Nested Results
// =============================================================================

Deno.test("nested Results", async (t) => {
  await t.step("Result containing Ok Result as value", () => {
    const inner: Result<number, string> = ok(42);
    const outer: Result<Result<number, string>, string> = ok(inner);

    assertEquals(isOk(outer), true);
    if (isOk(outer)) {
      assertEquals(isOk(outer.value), true);
      if (isOk(outer.value)) assertEquals(outer.value.value, 42);
    }
  });

  await t.step("Result containing Err Result as error", () => {
    const inner: Result<number, string> = err("inner error");
    const outer: Result<string, Result<number, string>> = err(inner);

    assertEquals(isErr(outer), true);
    if (isErr(outer)) {
      assertEquals(isErr(outer.error), true);
      if (isErr(outer.error)) assertEquals(outer.error.error, "inner error");
    }
  });
});

// =============================================================================
// Immutability (compile-time, verified at runtime)
// =============================================================================

Deno.test("readonly properties", async (t) => {
  await t.step("Ok._tag is readonly", () => {
    const result = ok(42);
    assertEquals(result._tag, "Ok");
    // TypeScript prevents: result._tag = "Err"
  });

  await t.step("Err._tag is readonly", () => {
    const result = err("error");
    assertEquals(result._tag, "Err");
    // TypeScript prevents: result._tag = "Ok"
  });
});

// =============================================================================
// Type inference verification
// =============================================================================

Deno.test("type inference", async (t) => {
  await t.step("ok() infers value type", () => {
    const numResult = ok(42);
    if (isOk(numResult)) {
      const n: number = numResult.value;
      assertEquals(typeof n, "number");
    }

    const strResult = ok("hello");
    if (isOk(strResult)) {
      const s: string = strResult.value;
      assertEquals(typeof s, "string");
    }
  });

  await t.step("err() infers error type", () => {
    const strErr = err("error message");
    if (isErr(strErr)) {
      const e: string = strErr.error;
      assertEquals(typeof e, "string");
    }

    const objErr = err({ code: 500, message: "Internal error" });
    if (isErr(objErr)) {
      const e: { code: number; message: string } = objErr.error;
      assertEquals(typeof e, "object");
    }
  });
});
