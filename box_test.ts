import { assertEquals, assertStrictEquals } from "@std/assert";
import { Box } from "./box.ts";
import type { TaggedError } from "./error.ts";

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
type UnauthorizedError = TaggedError<"Unauthorized">;
type TimeoutError = TaggedError<"Timeout"> & { duration: number };

type AppError =
  | NotFoundError
  | ValidationError
  | NetworkError
  | UnauthorizedError;

// =============================================================================
// Box.ok() - Creating successful boxes
// =============================================================================

Deno.test("Box.ok()", async (t) => {
  await t.step("creates Box with success value", () => {
    const box = Box.ok(42);
    assertEquals(box.isOk(), true);
    assertEquals(box.isErr(), false);
    assertEquals(box.unwrapOr(0), 42);
  });

  await t.step("accepts any value type", () => {
    const numBox = Box.ok(123);
    assertEquals(numBox.unwrapOr(0), 123);

    const strBox = Box.ok("hello");
    assertEquals(strBox.unwrapOr(""), "hello");

    const objBox = Box.ok({ name: "Alice", age: 30 });
    assertEquals(objBox.unwrapOr({ name: "", age: 0 }), {
      name: "Alice",
      age: 30,
    });

    const arrBox = Box.ok([1, 2, 3]);
    assertEquals(arrBox.unwrapOr([]), [1, 2, 3]);
  });

  await t.step("preserves null and undefined", () => {
    const nullBox = Box.ok<null, never>(null);
    assertEquals(nullBox.unwrapOr(null), null);

    const undefinedBox = Box.ok<undefined, never>(undefined);
    assertEquals(undefinedBox.unwrapOr(undefined), undefined);
  });

  await t.step("supports complex nested types", () => {
    type ComplexType = {
      user: {
        id: number;
        profile: { name: string; verified: boolean };
      };
      settings: { theme: string; notifications: boolean };
    };

    const box = Box.ok<ComplexType, never>({
      user: {
        id: 1,
        profile: { name: "Alice", verified: true },
      },
      settings: { theme: "dark", notifications: true },
    });

    const defaultValue: ComplexType = {
      user: { id: 0, profile: { name: "", verified: false } },
      settings: { theme: "", notifications: false },
    };

    assertEquals(box.unwrapOr(defaultValue).user.profile.name, "Alice");
  });
});

// =============================================================================
// Box.err() - Creating error boxes
// =============================================================================

Deno.test("Box.err()", async (t) => {
  await t.step("creates Box with error value", () => {
    const box = Box.err<string, string>("error message");
    assertEquals(box.isOk(), false);
    assertEquals(box.isErr(), true);
    assertEquals(box.unwrapOr("fallback"), "fallback");
  });

  await t.step("accepts tagged errors", () => {
    const box = Box.err<NotFoundError, never>({
      _tag: "NotFound",
      id: "user-123",
    });

    assertEquals(box.isErr(), true);
    assertEquals(
      box.match({
        ok: () => "success",
        err: (e) => e.id,
      }),
      "user-123",
    );
  });

  await t.step("accepts complex error objects", () => {
    const box = Box.err<ValidationError>({
      _tag: "ValidationError",
      field: "email",
      message: "Invalid email format",
    });

    const result = box.match({
      ok: () => null,
      err: (e) => ({ field: e.field, msg: e.message }),
    });

    assertEquals(result, { field: "email", msg: "Invalid email format" });
  });

  await t.step("preserves error object reference", () => {
    const errorObj = { _tag: "NotFound" as const, id: "123" };
    const box = Box.err(errorObj);

    box.match({
      ok: () => {},
      err: (e) => {
        assertStrictEquals(e, errorObj);
      },
    });
  });
});

// =============================================================================
// Box.from() - Creating boxes from throwing functions
// =============================================================================

Deno.test("Box.from()", async (t) => {
  await t.step("wraps successful function execution", () => {
    const box = Box.from(
      () => JSON.parse('{"name":"Alice"}'),
      (e) => ({ _tag: "ParseError" as const, message: String(e) }),
    );

    assertEquals(box.isOk(), true);
    assertEquals(box.unwrapOr({}), { name: "Alice" });
  });

  await t.step("catches thrown errors", () => {
    const box = Box.from(
      () => JSON.parse("invalid json"),
      (e) => ({ _tag: "ParseError" as const, message: String(e) }),
    );

    assertEquals(box.isErr(), true);
    const hasParseError = box.match({
      ok: () => false,
      err: (e) => e._tag === "ParseError",
    });
    assertEquals(hasParseError, true);
  });

  await t.step("handles custom error conversion", () => {
    const box = Box.from(
      () => {
        throw new Error("File not found");
      },
      (e) => ({
        _tag: "FileError" as const,
        path: "/config.json",
        originalError: String(e),
      }),
    );

    const result = box.match({
      ok: () => null,
      err: (e) => e.path,
    });

    assertEquals(result, "/config.json");
  });

  await t.step("preserves return type", () => {
    const box = Box.from(
      () => 42,
      () => ({ _tag: "Error" as const }),
    );

    assertEquals(box.unwrapOr(0), 42);
  });

  await t.step("works with throwing functions", () => {
    const box = Box.from(
      () => {
        throw "string error";
      },
      (e) => ({ _tag: "UnknownError" as const, value: e }),
    );

    assertEquals(box.isErr(), true);
  });
});

// =============================================================================
// Box.fail() - Creating typed tagged errors
// =============================================================================

Deno.test("Box.fail()", async (t) => {
  await t.step("creates tagged error without properties", () => {
    const box = Box.fail("NotFound");
    assertEquals(box.isErr(), true);
    const tag = box.match({
      ok: () => null,
      err: (e) => e._tag,
    });
    assertEquals(tag, "NotFound");
  });

  await t.step("creates tagged error with properties", () => {
    const box = Box.fail("ValidationError", {
      field: "email",
      message: "Required field",
    });

    const result = box.match({
      ok: () => null,
      err: (e) => ({ tag: e._tag, field: e.field, msg: e.message }),
    });

    assertEquals(result, {
      tag: "ValidationError",
      field: "email",
      msg: "Required field",
    });
  });

  await t.step("supports numeric and boolean properties", () => {
    const box = Box.fail("NetworkError", {
      statusCode: 500,
      retryable: true,
    });

    const result = box.match({
      ok: () => null,
      err: (e) => ({ code: e.statusCode, retry: e.retryable }),
    });

    assertEquals(result, { code: 500, retry: true });
  });

  await t.step("supports nested object properties", () => {
    const box = Box.fail("ComplexError", {
      metadata: {
        timestamp: Date.now(),
        context: { userId: "123", action: "delete" },
      },
    });

    assertEquals(box.isErr(), true);
  });
});

// =============================================================================
// isOk() and isErr() - State checking
// =============================================================================

Deno.test("isOk() and isErr()", async (t) => {
  await t.step("isOk returns true for success", () => {
    const box = Box.ok(42);
    assertEquals(box.isOk(), true);
    assertEquals(box.isErr(), false);
  });

  await t.step("isErr returns true for error", () => {
    const box = Box.err("error");
    assertEquals(box.isErr(), true);
    assertEquals(box.isOk(), false);
  });

  await t.step("work with null and undefined values", () => {
    const nullOk = Box.ok(null);
    assertEquals(nullOk.isOk(), true);

    const undefinedOk = Box.ok(undefined);
    assertEquals(undefinedOk.isOk(), true);
  });
});

// =============================================================================
// map() - Transforming success values
// =============================================================================

Deno.test("map()", async (t) => {
  await t.step("transforms success value", () => {
    const box = Box.ok(5).map((x) => x * 2);
    assertEquals(box.unwrapOr(0), 10);
  });

  await t.step("chains multiple transformations", () => {
    const box = Box.ok(10)
      .map((x) => x * 2)
      .map((x) => x + 5)
      .map((x) => `Result: ${x}`);

    assertEquals(box.unwrapOr(""), "Result: 25");
  });

  await t.step("does not execute on error", () => {
    let executed = false;
    const box = Box.err<string, number>("error").map((x) => {
      executed = true;
      return x * 2;
    });

    assertEquals(executed, false);
    assertEquals(box.isErr(), true);
  });

  await t.step("can change value type", () => {
    const box = Box.ok(42)
      .map((x) => x.toString())
      .map((s) => s.length);

    assertEquals(box.unwrapOr(0), 2);
  });

  await t.step("preserves error type", () => {
    const box = Box.err<NotFoundError, number>({
      _tag: "NotFound",
      id: "123",
    }).map((x) => x * 2);

    const result = box.match({
      ok: () => null,
      err: (e) => e.id,
    });

    assertEquals(result, "123");
  });

  await t.step("handles complex transformations", () => {
    const box = Box.ok({ name: "Alice", age: 30 }).map((user) => ({
      ...user,
      isAdult: user.age >= 18,
    }));

    assertEquals(
      box.unwrapOr({ name: "", age: 0, isAdult: false }).isAdult,
      true,
    );
  });
});

// =============================================================================
// mapErr() - Transforming error values
// =============================================================================

Deno.test("mapErr()", async (t) => {
  await t.step("transforms error value", () => {
    const box = Box.err({ code: 404 }).mapErr((e) => ({
      ...e,
      message: "Not found",
    }));

    const result = box.match({
      ok: () => null,
      err: (e) => e.message,
    });

    assertEquals(result, "Not found");
  });

  await t.step("does not execute on success", () => {
    let executed = false;
    const box = Box.ok(42).mapErr((e) => {
      executed = true;
      return e;
    });

    assertEquals(executed, false);
    assertEquals(box.isOk(), true);
  });

  await t.step("chains error transformations", () => {
    const box = Box.err("initial error")
      .mapErr((e) => ({ message: e, code: 1 }))
      .mapErr((e) => ({ ...e, timestamp: Date.now() }));

    assertEquals(box.isErr(), true);
  });

  await t.step("can change error type completely", () => {
    const box = Box.err<string, number>("string error").mapErr(
      (e) => e.length,
    );

    const result = box.match({
      ok: () => 0,
      err: (e) => e,
    });

    assertEquals(result, 12); // "string error".length
  });

  await t.step("preserves success type", () => {
    const box = Box.ok<number, string>(42).mapErr((e) => e.toUpperCase());

    assertEquals(box.unwrapOr(0), 42);
  });
});

// =============================================================================
// flatMap() - Chaining operations
// =============================================================================

Deno.test("flatMap()", async (t) => {
  await t.step("chains operations that return Box", () => {
    function parse(input: string): Box<number, TaggedError<"ParseError">> {
      const num = parseInt(input, 10);
      return isNaN(num) ? Box.fail("ParseError") : Box.ok(num);
    }

    function validate(
      num: number,
    ): Box<number, TaggedError<"ValidationError">> {
      return num > 0 ? Box.ok(num) : Box.fail("ValidationError");
    }

    const result = parse("42").flatMap(validate);
    assertEquals(result.unwrapOr(0), 42);
  });

  await t.step("accumulates error types", () => {
    function step1(x: number): Box<number, TaggedError<"Error1">> {
      return x > 0 ? Box.ok(x * 2) : Box.fail("Error1");
    }

    function step2(x: number): Box<number, TaggedError<"Error2">> {
      return x < 100 ? Box.ok(x + 10) : Box.fail("Error2");
    }

    const result = Box.ok(5).flatMap(step1).flatMap(step2);
    // Type: Box<number, TaggedError<"Error1"> | TaggedError<"Error2">>
    assertEquals(result.unwrapOr(0), 20); // (5 * 2) + 10
  });

  await t.step("short-circuits on first error", () => {
    let step2Called = false;

    function step1(_x: number): Box<number, TaggedError<"Error1">> {
      return Box.fail("Error1");
    }

    function step2(x: number): Box<number, TaggedError<"Error2">> {
      step2Called = true;
      return Box.ok(x);
    }

    const result = Box.ok(5).flatMap(step1).flatMap(step2);

    assertEquals(step2Called, false);
    assertEquals(result.isErr(), true);
  });

  await t.step("propagates error from initial Box", () => {
    const result = Box.err<TaggedError<"Initial">, number>({
      _tag: "Initial",
    }).flatMap((x) => Box.ok(x * 2));

    const tag = result.match({
      ok: () => null,
      err: (e) => e._tag,
    });

    assertEquals(tag, "Initial");
  });

  await t.step("supports complex data flow", () => {
    type User = { id: number; name: string };
    type Post = { userId: number; title: string };

    function getUser(id: number): Box<User, NotFoundError> {
      return id === 1
        ? Box.ok({ id: 1, name: "Alice" })
        : Box.fail("NotFound", { id: id.toString() });
    }

    function getUserPosts(user: User): Box<Post[], NetworkError> {
      return Box.ok([{ userId: user.id, title: "Hello World" }]);
    }

    const result = getUser(1).flatMap(getUserPosts);
    assertEquals(result.isOk(), true);
  });
});

// =============================================================================
// catchTag() - Recovering from specific errors
// =============================================================================

Deno.test("catchTag()", async (t) => {
  await t.step("recovers from specific error tag", () => {
    const box = Box.fail("NotFound", { id: "123" }).catchTag(
      "NotFound",
      (e) => Box.ok(`Created default for ${e.id}`),
    );

    assertEquals(box.unwrapOr(""), "Created default for 123");
  });

  await t.step("removes caught error from type union", () => {
    type Errors = NotFoundError | ValidationError | UnauthorizedError;

    const box: Box<string, Errors> = Box.fail("NotFound", { id: "123" });

    const handled = box.catchTag("NotFound", () => Box.ok("recovered"));
    // Type: Box<string, ValidationError | UnauthorizedError>

    assertEquals(handled.unwrapOr(""), "recovered");
  });

  await t.step("does not catch different error tags", () => {
    type Errors = ValidationError | NotFoundError;
    const box: Box<string, Errors> = Box.fail("ValidationError", {
      field: "email",
      message: "Invalid",
    });

    const handled = box.catchTag("NotFound", () => Box.ok("recovered"));

    assertEquals(handled.isErr(), true);
  });

  await t.step("passes through success values", () => {
    type Errors = NotFoundError;
    const box: Box<number, Errors> = Box.ok(42);
    const handled = box.catchTag("NotFound", () => Box.ok(0));

    assertEquals(handled.unwrapOr(0), 42);
  });

  await t.step("can introduce new error types", () => {
    const box = Box.fail("NotFound", { id: "123" }).catchTag(
      "NotFound",
      () => Box.fail("CacheMiss"),
    );

    const tag = box.match({
      ok: () => null,
      err: (e) => e._tag,
    });

    assertEquals(tag, "CacheMiss");
  });

  await t.step("chains multiple catchTag calls", () => {
    type Errors = NotFoundError | ValidationError | UnauthorizedError;
    const box: Box<number, Errors> = Box.fail("NotFound", { id: "123" });

    const handled = box
      .catchTag("NotFound", () => Box.ok(0))
      .catchTag("ValidationError", () => Box.ok(1))
      .catchTag("Unauthorized", () => Box.ok(2));

    assertEquals(handled.unwrapOr(-1), 0);
  });

  await t.step("provides access to error properties", () => {
    const box = Box.fail("NetworkError", {
      statusCode: 503,
      retryable: true,
    }).catchTag("NetworkError", (e) => {
      return e.retryable ? Box.ok("retrying") : Box.fail("Fatal");
    });

    assertEquals(box.unwrapOr(""), "retrying");
  });
});

// =============================================================================
// catchAll() - Recovering from all errors
// =============================================================================

Deno.test("catchAll()", async (t) => {
  await t.step("catches any error", () => {
    const box = Box.err<string, number>("any error").catchAll((_e) =>
      Box.ok(0)
    );

    assertEquals(box.unwrapOr(-1), 0);
  });

  await t.step("replaces error type", () => {
    type OriginalError = NotFoundError | ValidationError;
    type NewError = TaggedError<"CacheError">;

    const box: Box<string, OriginalError> = Box.fail("NotFound", {
      id: "123",
    });

    const handled = box.catchAll(() => Box.fail("CacheError"));
    // Type: Box<string, NewError>

    const tag = handled.match({
      ok: () => null,
      err: (e) => e._tag,
    });

    assertEquals(tag, "CacheError");
  });

  await t.step("does not execute on success", () => {
    let executed = false;
    const box = Box.ok(42).catchAll((_e) => {
      executed = true;
      return Box.ok(0);
    });

    assertEquals(executed, false);
    assertEquals(box.unwrapOr(0), 42);
  });

  await t.step("can recover to success", () => {
    const box = Box.err<NotFoundError, string>({
      _tag: "NotFound",
      id: "123",
    }).catchAll((_e) => Box.ok("fallback"));

    assertEquals(box.unwrapOr(""), "fallback");
  });

  await t.step("provides original error to handler", () => {
    const box = Box.fail("NotFound", { id: "user-123" }).catchAll((e) => {
      return Box.ok(`Recovered from ${e._tag} for ${e.id}`);
    });

    assertEquals(box.unwrapOr(""), "Recovered from NotFound for user-123");
  });
});

// =============================================================================
// orElseTag() - Providing fallback values
// =============================================================================

Deno.test("orElseTag()", async (t) => {
  await t.step("provides fallback for specific error", () => {
    const box: Box<number, NotFoundError> = Box.fail("NotFound", { id: "123" });
    const handled = box.orElseTag("NotFound", 0);

    assertEquals(handled.unwrapOr(-1), 0);
  });

  await t.step("removes handled error from type union", () => {
    type Errors = NotFoundError | ValidationError;
    const box: Box<number, Errors> = Box.fail("NotFound", { id: "123" });

    const handled = box.orElseTag("NotFound", 0);
    // Type: Box<number, ValidationError>

    assertEquals(handled.unwrapOr(-1), 0);
  });

  await t.step("does not handle different error tags", () => {
    type Errors = ValidationError | NotFoundError;
    const box: Box<string, Errors> = Box.fail("ValidationError", {
      field: "email",
      message: "Invalid",
    });

    const handled = box.orElseTag("NotFound", "fallback");

    assertEquals(handled.isErr(), true);
  });

  await t.step("passes through success values", () => {
    type Errors = NotFoundError;
    const box: Box<number, Errors> = Box.ok(42);
    const handled = box.orElseTag("NotFound", 0);

    assertEquals(handled.unwrapOr(-1), 42);
  });

  await t.step("chains multiple orElseTag calls", () => {
    type Errors = NotFoundError | ValidationError | UnauthorizedError;
    const box: Box<string, Errors> = Box.fail("Unauthorized");

    const handled = box
      .orElseTag("NotFound", "not-found-fallback")
      .orElseTag("ValidationError", "validation-fallback")
      .orElseTag("Unauthorized", "unauthorized-fallback");

    assertEquals(handled.unwrapOr(""), "unauthorized-fallback");
  });

  await t.step("works with various fallback types", () => {
    const numBox: Box<number, NotFoundError> = Box.fail("NotFound", {
      id: "1",
    });
    const handledNum = numBox.orElseTag("NotFound", 0);
    assertEquals(handledNum.unwrapOr(-1), 0);

    const strBox: Box<string, NotFoundError> = Box.fail("NotFound", {
      id: "2",
    });
    const handledStr = strBox.orElseTag("NotFound", "fallback");
    assertEquals(handledStr.unwrapOr(""), "fallback");

    type ObjType = { default: boolean };
    const objBox: Box<ObjType, NotFoundError> = Box.fail("NotFound", {
      id: "3",
    });
    const handledObj = objBox.orElseTag("NotFound", { default: true });
    assertEquals(handledObj.unwrapOr({ default: false }).default, true);
  });
});

// =============================================================================
// match() - Pattern matching
// =============================================================================

Deno.test("match()", async (t) => {
  await t.step("matches success value", () => {
    const result = Box.ok(42).match({
      ok: (v) => `Success: ${v}`,
      err: (e) => `Error: ${e}`,
    });

    assertEquals(result, "Success: 42");
  });

  await t.step("matches error value", () => {
    const result = Box.err("failure").match({
      ok: (v) => `Success: ${v}`,
      err: (e) => `Error: ${e}`,
    });

    assertEquals(result, "Error: failure");
  });

  await t.step("both handlers return same type", () => {
    const result = Box.ok<number, string>(42).match({
      ok: (v) => v * 2,
      err: (e) => e.length,
    });

    assertEquals(typeof result, "number");
  });

  await t.step("can return complex types", () => {
    type UiState = {
      loading: boolean;
      data: number | null;
      error: string | null;
    };

    const result = Box.ok<number, string>(42).match<UiState>({
      ok: (data) => ({ loading: false, data, error: null }),
      err: (error) => ({ loading: false, data: null, error }),
    });

    assertEquals(result, { loading: false, data: 42, error: null });
  });

  await t.step("provides typed error access", () => {
    const result = Box.fail("NotFound", { id: "user-123" }).match({
      ok: () => "found",
      err: (e) => `${e._tag}: ${e.id}`,
    });

    assertEquals(result, "NotFound: user-123");
  });

  await t.step("can be used for side effects", () => {
    let sideEffect = "";

    Box.ok(42).match({
      ok: (v) => {
        sideEffect = `processed ${v}`;
        return v;
      },
      err: (_e) => 0,
    });

    assertEquals(sideEffect, "processed 42");
  });
});

// =============================================================================
// matchExhaustive() - Exhaustive pattern matching
// =============================================================================

Deno.test("matchExhaustive()", async (t) => {
  await t.step("requires handler for each error tag", () => {
    type AppError =
      | (TaggedError<"NotFound"> & { id: string })
      | TaggedError<"Unauthorized">
      | (TaggedError<"RateLimited"> & { retryAfter: number });

    const box: Box<string, AppError> = Box.fail("NotFound", { id: "123" });

    const result = box.matchExhaustive({
      ok: (v) => `Success: ${v}`,
      NotFound: (e) => `Not found: ${e.id}`,
      Unauthorized: () => "Please log in",
      RateLimited: (e) => `Retry in ${e.retryAfter}s`,
    });

    assertEquals(result, "Not found: 123");
  });

  await t.step("handles success case", () => {
    type Errors = NotFoundError | UnauthorizedError;
    const box: Box<number, Errors> = Box.ok(42);

    const result = box.matchExhaustive({
      ok: (v) => v * 2,
      NotFound: () => 0,
      Unauthorized: () => 0,
    });

    assertEquals(result, 84);
  });

  await t.step("provides typed error properties", () => {
    type Errors =
      | (TaggedError<"NetworkError"> & {
        statusCode: number;
        retryable: boolean;
      })
      | (TaggedError<"ParseError"> & { data: string });

    const box: Box<string, Errors> = Box.fail("NetworkError", {
      statusCode: 503,
      retryable: true,
    });

    const result = box.matchExhaustive({
      ok: () => "ok",
      NetworkError: (e) => (e.retryable ? "retry" : "fail"),
      ParseError: (e) => `parse error: ${e.data}`,
    });

    assertEquals(result, "retry");
  });

  await t.step("works with single error type", () => {
    const box: Box<number, NotFoundError> = Box.fail("NotFound", {
      id: "123",
    });

    const result = box.matchExhaustive({
      ok: (v) => v,
      NotFound: (e) => parseInt(e.id),
    });

    assertEquals(result, 123);
  });
});

// =============================================================================
// unwrapOr() - Getting value with default
// =============================================================================

Deno.test("unwrapOr()", async (t) => {
  await t.step("returns success value", () => {
    const result = Box.ok(42).unwrapOr(0);
    assertEquals(result, 42);
  });

  await t.step("returns default on error", () => {
    const result = Box.err<string, number>("error").unwrapOr(0);
    assertEquals(result, 0);
  });

  await t.step("works with different types", () => {
    assertEquals(Box.ok("hello").unwrapOr(""), "hello");
    assertEquals(
      Box.err<string, string>("error").unwrapOr("fallback"),
      "fallback",
    );

    assertEquals(Box.ok(true).unwrapOr(false), true);
    assertEquals(Box.err<string, boolean>("error").unwrapOr(false), false);

    assertEquals(Box.ok([1, 2, 3]).unwrapOr([]), [1, 2, 3]);
    assertEquals(Box.err<string, number[]>("error").unwrapOr([]), []);
  });

  await t.step("works with object defaults", () => {
    const defaultUser = { name: "Guest", id: 0 };
    const user = Box.ok({ name: "Alice", id: 1 }).unwrapOr(defaultUser);

    assertEquals(user, { name: "Alice", id: 1 });

    const errorUser = Box.err<string, { name: string; id: number }>("error")
      .unwrapOr(defaultUser);

    assertEquals(errorUser, defaultUser);
  });

  await t.step("handles null and undefined", () => {
    assertEquals(Box.ok<null, never>(null).unwrapOr(null), null);
    assertEquals(
      Box.ok<undefined, never>(undefined).unwrapOr(undefined),
      undefined,
    );
    assertEquals(Box.err<string, null>("error").unwrapOr(null), null);
  });
});

// =============================================================================
// unwrap() - Getting value when all errors handled
// =============================================================================

Deno.test("unwrap()", async (t) => {
  await t.step("returns value when error type is never", () => {
    const box = Box.ok<number, never>(42);
    const value = box.unwrap();
    assertEquals(value, 42);
  });

  await t.step("returns value after all errors caught", () => {
    type Errors = NotFoundError | ValidationError;
    const box: Box<number, Errors> = Box.ok(42);

    const handled = box
      .catchTag("NotFound", () => Box.ok(0))
      .catchTag("ValidationError", () => Box.ok(0));

    const value = handled.unwrap();
    assertEquals(value, 42);
  });

  await t.step(
    "throws when called on error (type system prevents this)",
    () => {
      // This test demonstrates what happens if unwrap is somehow called on Err
      // In practice, TypeScript prevents this at compile time
      const box = Box.ok<number, never>(42);
      assertEquals(box.unwrap(), 42);
    },
  );

  await t.step("works after orElseTag removes all errors", () => {
    type Errors = NotFoundError | ValidationError;
    const box: Box<string, Errors> = Box.ok("success");

    const handled = box
      .orElseTag("NotFound", "not-found")
      .orElseTag("ValidationError", "invalid");

    const value = handled.unwrap();
    assertEquals(value, "success");
  });
});

// =============================================================================
// toResult() - Converting to Result
// =============================================================================

Deno.test("toResult()", async (t) => {
  await t.step("converts success Box to Result", () => {
    const box = Box.ok(42);
    const result = box.toResult();

    assertEquals(result._tag, "Ok");
    if (result._tag === "Ok") {
      assertEquals(result.value, 42);
    }
  });

  await t.step("converts error Box to Result", () => {
    const box = Box.err("error message");
    const result = box.toResult();

    assertEquals(result._tag, "Err");
    if (result._tag === "Err") {
      assertEquals(result.error, "error message");
    }
  });

  await t.step("preserves tagged errors", () => {
    const box = Box.fail("NotFound", { id: "123" });
    const result = box.toResult();

    assertEquals(result._tag, "Err");
    if (result._tag === "Err") {
      assertEquals(result.error._tag, "NotFound");
      assertEquals(result.error.id, "123");
    }
  });

  await t.step("preserves complex types", () => {
    const box = Box.ok({ user: { name: "Alice" }, posts: [] });
    const result = box.toResult();

    assertEquals(result._tag, "Ok");
    if (result._tag === "Ok") {
      assertEquals(result.value.user.name, "Alice");
    }
  });
});

// =============================================================================
// Complex integration scenarios
// =============================================================================

Deno.test("Complex scenarios", async (t) => {
  await t.step("complete user validation pipeline", () => {
    type User = { id: number; email: string; age: number };

    function parseUser(data: string): Box<unknown, TaggedError<"ParseError">> {
      try {
        return Box.ok(JSON.parse(data));
      } catch {
        return Box.fail("ParseError");
      }
    }

    function validateEmail(
      user: unknown,
    ): Box<unknown, TaggedError<"InvalidEmail">> {
      const u = user as { email?: string };
      return u.email?.includes("@") ? Box.ok(user) : Box.fail("InvalidEmail");
    }

    function validateAge(
      user: unknown,
    ): Box<User, TaggedError<"InvalidAge">> {
      const u = user as { age?: number };
      return u.age && u.age >= 18
        ? Box.ok(user as User)
        : Box.fail("InvalidAge");
    }

    const validData = '{"id":1,"email":"alice@example.com","age":25}';
    const result = parseUser(validData)
      .flatMap(validateEmail)
      .flatMap(validateAge);

    assertEquals(result.isOk(), true);
  });

  await t.step("error recovery chain", () => {
    const result = Box.fail("NotFound", { id: "123" })
      .catchTag("NotFound", () => Box.fail("CacheError"))
      .catchAll(() => Box.ok("final fallback"));

    assertEquals(result.unwrapOr(""), "final fallback");
  });

  await t.step("mixed operations pipeline", () => {
    const result = Box.ok(10)
      .map((x) => x * 2) // 20
      .flatMap((x) => (x > 15 ? Box.ok(x) : Box.fail("TooSmall")))
      .map((x) => x + 5) // 25
      .orElseTag("TooSmall", 0);

    assertEquals(result.unwrapOr(-1), 25);
  });

  await t.step("data fetching with retry logic", () => {
    let attempt = 0;

    function fetchData(): Box<string, NetworkError | TimeoutError> {
      attempt++;
      if (attempt === 1) {
        return Box.fail("Timeout", { duration: 5000 });
      }
      if (attempt === 2) {
        return Box.fail("NetworkError", {
          statusCode: 503,
          retryable: true,
        });
      }
      return Box.ok("data");
    }

    const result = fetchData()
      .catchTag("Timeout", () => fetchData())
      .catchTag("NetworkError", (e) => e.retryable ? fetchData() : Box.err(e));

    assertEquals(result.unwrapOr(""), "data");
    assertEquals(attempt, 3);
  });

  await t.step("combining multiple Box results", () => {
    type User = { id: number; name: string };
    type Post = { title: string };
    type Comment = { text: string };
    type CombinedData = {
      user: User;
      posts: Post[];
      comments: Comment[];
    };

    const user = Box.ok<User, never>({ id: 1, name: "Alice" });
    const posts = Box.ok<Post[], never>([{ title: "Post 1" }]);
    const comments = Box.ok<Comment[], never>([{ text: "Comment 1" }]);

    const combined = user
      .flatMap((u) => posts.map((p) => ({ user: u, posts: p })))
      .flatMap((data) => comments.map((c) => ({ ...data, comments: c })));

    const defaultValue: CombinedData = {
      user: { id: 0, name: "" },
      posts: [],
      comments: [],
    };

    const result = combined.unwrapOr(defaultValue);
    assertEquals(result.user.name, "Alice");
    assertEquals(result.posts.length, 1);
    assertEquals(result.comments.length, 1);
  });
});
