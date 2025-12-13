import { assertEquals, assertStrictEquals } from "@std/assert";
import { AsyncBox } from "./async_box.ts";
import type { TaggedError } from "./error.ts";
import { isErr, isOk } from "./result.ts";

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
type FetchError = TaggedError<"FetchError"> & { statusCode: number };
type ParseError = TaggedError<"ParseError"> & { input: string };
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

// Helper to create a delayed promise
function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// =============================================================================
// AsyncBox.fromPromise() - Creating from promises
// =============================================================================

Deno.test("AsyncBox.fromPromise()", async (t) => {
  await t.step("wraps successful promise", async () => {
    const promise = Promise.resolve(42);
    const box = AsyncBox.fromPromise(
      promise,
      (e) => ({ _tag: "Error" as const, message: String(e) }),
    );

    const result = await box.unwrapOr(0);
    assertEquals(result, 42);
  });

  await t.step("catches rejected promise", async () => {
    const promise = Promise.reject(new Error("Failed"));
    const box = AsyncBox.fromPromise(
      promise,
      (e) => ({ _tag: "Error" as const, message: String(e) }),
    );

    const result = await box.match({
      ok: () => "success",
      err: (e) => e._tag,
    });

    assertEquals(result, "Error");
  });

  await t.step("converts rejection to typed error", async () => {
    const promise = Promise.reject({ statusCode: 404 });
    const box = AsyncBox.fromPromise<unknown, FetchError>(
      promise,
      (e) => ({
        _tag: "FetchError",
        statusCode: (e as { statusCode: number }).statusCode,
      }),
    );

    const result = await box.match({
      ok: () => null,
      err: (e) => e.statusCode,
    });

    assertEquals(result, 404);
  });

  await t.step("preserves resolved value type", async () => {
    const promise = Promise.resolve({ id: 1, name: "Alice" });
    const box = AsyncBox.fromPromise(
      promise,
      (_e) => ({ _tag: "Error" as const }),
    );

    const result = await box.unwrapOr({ id: 0, name: "" });
    assertEquals(result, { id: 1, name: "Alice" });
  });

  await t.step("works with async operations", async () => {
    const box = AsyncBox.fromPromise(
      delay(10, "delayed value"),
      (_e) => ({ _tag: "Error" as const }),
    );

    const result = await box.unwrapOr("");
    assertEquals(result, "delayed value");
  });
});

// =============================================================================
// AsyncBox.ok() - Creating successful async boxes
// =============================================================================

Deno.test("AsyncBox.ok()", async (t) => {
  await t.step("creates AsyncBox with success value", async () => {
    const box = AsyncBox.ok(42);
    const result = await box.unwrapOr(0);
    assertEquals(result, 42);
  });

  await t.step("accepts any value type", async () => {
    const numBox = AsyncBox.ok(123);
    assertEquals(await numBox.unwrapOr(0), 123);

    const strBox = AsyncBox.ok("hello");
    assertEquals(await strBox.unwrapOr(""), "hello");

    const objBox = AsyncBox.ok({ name: "Alice", age: 30 });
    assertEquals(await objBox.unwrapOr({ name: "", age: 0 }), {
      name: "Alice",
      age: 30,
    });

    const arrBox = AsyncBox.ok([1, 2, 3]);
    assertEquals(await arrBox.unwrapOr([]), [1, 2, 3]);
  });

  await t.step("preserves null and undefined", async () => {
    const nullBox = AsyncBox.ok<null, never>(null);
    assertEquals(await nullBox.unwrapOr(null), null);

    const undefinedBox = AsyncBox.ok<undefined, never>(undefined);
    assertEquals(await undefinedBox.unwrapOr(undefined), undefined);
  });

  await t.step("supports complex nested types", async () => {
    type ComplexType = {
      user: {
        id: number;
        profile: { name: string; verified: boolean };
      };
      settings: { theme: string; notifications: boolean };
    };

    const box = AsyncBox.ok<ComplexType, never>({
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

    const result = await box.unwrapOr(defaultValue);
    assertEquals(result.user.profile.name, "Alice");
  });
});

// =============================================================================
// AsyncBox.err() - Creating error async boxes
// =============================================================================

Deno.test("AsyncBox.err()", async (t) => {
  await t.step("creates AsyncBox with error value", async () => {
    const box = AsyncBox.err<string, string>("error message");
    const result = await box.unwrapOr("fallback");
    assertEquals(result, "fallback");
  });

  await t.step("accepts tagged errors", async () => {
    const box = AsyncBox.err<NotFoundError, never>({
      _tag: "NotFound",
      id: "user-123",
    });

    const result = await box.match({
      ok: () => "success",
      err: (e) => e.id,
    });

    assertEquals(result, "user-123");
  });

  await t.step("accepts complex error objects", async () => {
    const box = AsyncBox.err<ValidationError, never>({
      _tag: "ValidationError",
      field: "email",
      message: "Invalid email format",
    });

    const result = await box.match({
      ok: () => null,
      err: (e) => ({ field: e.field, msg: e.message }),
    });

    assertEquals(result, { field: "email", msg: "Invalid email format" });
  });

  await t.step("preserves error object reference", async () => {
    const errorObj = { _tag: "NotFound" as const, id: "123" };
    const box = AsyncBox.err(errorObj);

    await box.match({
      ok: () => {},
      err: (e) => {
        assertStrictEquals(e, errorObj);
      },
    });
  });
});

// =============================================================================
// AsyncBox.fail() - Creating typed tagged errors
// =============================================================================

Deno.test("AsyncBox.fail()", async (t) => {
  await t.step("creates tagged error without properties", async () => {
    const box = AsyncBox.fail("NotFound");
    const tag = await box.match({
      ok: () => null,
      err: (e) => e._tag,
    });
    assertEquals(tag, "NotFound");
  });

  await t.step("creates tagged error with properties", async () => {
    const box = AsyncBox.fail("ValidationError", {
      field: "email",
      message: "Required field",
    });

    const result = await box.match({
      ok: () => null,
      err: (e) => ({ tag: e._tag, field: e.field, msg: e.message }),
    });

    assertEquals(result, {
      tag: "ValidationError",
      field: "email",
      msg: "Required field",
    });
  });

  await t.step("supports numeric and boolean properties", async () => {
    const box = AsyncBox.fail("NetworkError", {
      statusCode: 500,
      retryable: true,
    });

    const result = await box.match({
      ok: () => null,
      err: (e) => ({ code: e.statusCode, retry: e.retryable }),
    });

    assertEquals(result, { code: 500, retry: true });
  });

  await t.step("supports nested object properties", async () => {
    const box = AsyncBox.fail("ComplexError", {
      metadata: {
        timestamp: Date.now(),
        context: { userId: "123", action: "delete" },
      },
    });

    const result = await box.match({
      ok: () => false,
      err: () => true,
    });

    assertEquals(result, true);
  });
});

// =============================================================================
// map() - Transforming success values
// =============================================================================

Deno.test("map()", async (t) => {
  await t.step("transforms success value", async () => {
    const box = AsyncBox.ok(5).map((x) => x * 2);
    const result = await box.unwrapOr(0);
    assertEquals(result, 10);
  });

  await t.step("chains multiple transformations", async () => {
    const box = AsyncBox.ok(10)
      .map((x) => x * 2)
      .map((x) => x + 5)
      .map((x) => `Result: ${x}`);

    const result = await box.unwrapOr("");
    assertEquals(result, "Result: 25");
  });

  await t.step("does not execute on error", async () => {
    let executed = false;
    const box = AsyncBox.err<string, number>("error").map((x) => {
      executed = true;
      return x * 2;
    });

    await box.unwrapOr(0);
    assertEquals(executed, false);
  });

  await t.step("can change value type", async () => {
    const box = AsyncBox.ok(42)
      .map((x) => x.toString())
      .map((s) => s.length);

    const result = await box.unwrapOr(0);
    assertEquals(result, 2);
  });

  await t.step("preserves error type", async () => {
    const box = AsyncBox.err<NotFoundError, number>({
      _tag: "NotFound",
      id: "123",
    }).map((x) => x * 2);

    const result = await box.match({
      ok: () => null,
      err: (e) => e.id,
    });

    assertEquals(result, "123");
  });

  await t.step("handles complex transformations", async () => {
    const box = AsyncBox.ok({ name: "Alice", age: 30 }).map((user) => ({
      ...user,
      isAdult: user.age >= 18,
    }));

    const result = await box.unwrapOr({
      name: "",
      age: 0,
      isAdult: false,
    });
    assertEquals(result.isAdult, true);
  });

  await t.step("works with async data flow", async () => {
    const box = AsyncBox.fromPromise(
      delay(10, 100),
      (_e) => ({ _tag: "Error" as const }),
    )
      .map((x) => x * 2)
      .map((x) => x + 50);

    const result = await box.unwrapOr(0);
    assertEquals(result, 250);
  });
});

// =============================================================================
// mapErr() - Transforming error values
// =============================================================================

Deno.test("mapErr()", async (t) => {
  await t.step("transforms error value", async () => {
    const box = AsyncBox.err({ code: 404 }).mapErr((e) => ({
      ...e,
      message: "Not found",
    }));

    const result = await box.match({
      ok: () => null,
      err: (e) => e.message,
    });

    assertEquals(result, "Not found");
  });

  await t.step("does not execute on success", async () => {
    let executed = false;
    const box = AsyncBox.ok(42).mapErr((e) => {
      executed = true;
      return e;
    });

    await box.unwrapOr(0);
    assertEquals(executed, false);
  });

  await t.step("chains error transformations", async () => {
    const box = AsyncBox.err("initial error")
      .mapErr((e) => ({ message: e, code: 1 }))
      .mapErr((e) => ({ ...e, timestamp: Date.now() }));

    const result = await box.match({
      ok: () => null,
      err: (e) => e.code,
    });

    assertEquals(result, 1);
  });

  await t.step("can change error type completely", async () => {
    const box = AsyncBox.err<string, number>("string error").mapErr(
      (e) => e.length,
    );

    const result = await box.match({
      ok: () => 0,
      err: (e) => e,
    });

    assertEquals(result, 12); // "string error".length
  });

  await t.step("preserves success type", async () => {
    const box = AsyncBox.ok<number, string>(42).mapErr((e) => e.toUpperCase());

    const result = await box.unwrapOr(0);
    assertEquals(result, 42);
  });
});

// =============================================================================
// flatMap() - Chaining async operations
// =============================================================================

Deno.test("flatMap()", async (t) => {
  await t.step("chains operations that return AsyncBox", async () => {
    function parse(
      input: string,
    ): AsyncBox<number, TaggedError<"ParseError">> {
      const num = parseInt(input, 10);
      return isNaN(num) ? AsyncBox.fail("ParseError") : AsyncBox.ok(num);
    }

    function validate(
      num: number,
    ): AsyncBox<number, TaggedError<"ValidationError">> {
      return num > 0 ? AsyncBox.ok(num) : AsyncBox.fail("ValidationError");
    }

    const result = await parse("42")
      .flatMap(validate)
      .unwrapOr(0);

    assertEquals(result, 42);
  });

  await t.step("accumulates error types", async () => {
    function step1(x: number): AsyncBox<number, TaggedError<"Error1">> {
      return x > 0 ? AsyncBox.ok(x * 2) : AsyncBox.fail("Error1");
    }

    function step2(x: number): AsyncBox<number, TaggedError<"Error2">> {
      return x < 100 ? AsyncBox.ok(x + 10) : AsyncBox.fail("Error2");
    }

    const result = await AsyncBox.ok(5)
      .flatMap(step1)
      .flatMap(step2)
      .unwrapOr(0);

    assertEquals(result, 20); // (5 * 2) + 10
  });

  await t.step("short-circuits on first error", async () => {
    let step2Called = false;

    function step1(_x: number): AsyncBox<number, TaggedError<"Error1">> {
      return AsyncBox.fail("Error1");
    }

    function step2(x: number): AsyncBox<number, TaggedError<"Error2">> {
      step2Called = true;
      return AsyncBox.ok(x);
    }

    await AsyncBox.ok(5)
      .flatMap(step1)
      .flatMap(step2)
      .unwrapOr(0);

    assertEquals(step2Called, false);
  });

  await t.step("propagates error from initial AsyncBox", async () => {
    const result = await AsyncBox.err<TaggedError<"Initial">, number>({
      _tag: "Initial",
    })
      .flatMap((x) => AsyncBox.ok(x * 2))
      .match({
        ok: () => null,
        err: (e) => e._tag,
      });

    assertEquals(result, "Initial");
  });

  await t.step("supports complex async data flow", async () => {
    type User = { id: number; name: string };
    type Post = { userId: number; title: string };

    function getUser(id: number): AsyncBox<User, NotFoundError> {
      return id === 1
        ? AsyncBox.ok({ id: 1, name: "Alice" })
        : AsyncBox.fail("NotFound", { id: id.toString() });
    }

    function getUserPosts(user: User): AsyncBox<Post[], NetworkError> {
      return AsyncBox.fromPromise(
        delay(10, [{ userId: user.id, title: "Hello World" }]),
        (_e) => ({
          _tag: "NetworkError" as const,
          statusCode: 500,
          retryable: false,
        }),
      );
    }

    const result = await getUser(1)
      .flatMap(getUserPosts)
      .match({
        ok: (posts) => posts.length,
        err: () => 0,
      });

    assertEquals(result, 1);
  });

  await t.step("chains promises correctly", async () => {
    const result = await AsyncBox.fromPromise(
      delay(5, 10),
      (_e) => ({ _tag: "Error" as const }),
    )
      .flatMap((x) =>
        AsyncBox.fromPromise(
          delay(5, x * 2),
          (_e) => ({ _tag: "Error" as const }),
        )
      )
      .flatMap((x) => AsyncBox.ok(x + 5))
      .unwrapOr(0);

    assertEquals(result, 25); // (10 * 2) + 5
  });
});

// =============================================================================
// catchTag() - Recovering from specific errors
// =============================================================================

Deno.test("catchTag()", async (t) => {
  await t.step("recovers from specific error tag", async () => {
    const box = AsyncBox.fail("NotFound", { id: "123" }).catchTag(
      "NotFound",
      (e) => AsyncBox.ok(`Created default for ${e.id}`),
    );

    const result = await box.unwrapOr("");
    assertEquals(result, "Created default for 123");
  });

  await t.step("removes caught error from type union", async () => {
    type Errors = NotFoundError | ValidationError | UnauthorizedError;

    const box: AsyncBox<string, Errors> = AsyncBox.fail("NotFound", {
      id: "123",
    });

    const handled = box.catchTag("NotFound", () => AsyncBox.ok("recovered"));
    // Type: AsyncBox<string, ValidationError | UnauthorizedError>

    const result = await handled.unwrapOr("");
    assertEquals(result, "recovered");
  });

  await t.step("does not catch different error tags", async () => {
    type Errors = ValidationError | NotFoundError;
    const box: AsyncBox<string, Errors> = AsyncBox.fail("ValidationError", {
      field: "email",
      message: "Invalid",
    });

    const handled = box.catchTag("NotFound", () => AsyncBox.ok("recovered"));

    const result = await handled.match({
      ok: () => false,
      err: () => true,
    });

    assertEquals(result, true);
  });

  await t.step("passes through success values", async () => {
    type Errors = NotFoundError;
    const box: AsyncBox<number, Errors> = AsyncBox.ok(42);
    const handled = box.catchTag("NotFound", () => AsyncBox.ok(0));

    const result = await handled.unwrapOr(-1);
    assertEquals(result, 42);
  });

  await t.step("can introduce new error types", async () => {
    const box = AsyncBox.fail("NotFound", { id: "123" }).catchTag(
      "NotFound",
      () => AsyncBox.fail("CacheMiss"),
    );

    const tag = await box.match({
      ok: () => null,
      err: (e) => e._tag,
    });

    assertEquals(tag, "CacheMiss");
  });

  await t.step("chains multiple catchTag calls", async () => {
    type Errors = NotFoundError | ValidationError | UnauthorizedError;
    const box: AsyncBox<number, Errors> = AsyncBox.fail("NotFound", {
      id: "123",
    });

    const handled = box
      .catchTag("NotFound", () => AsyncBox.ok(0))
      .catchTag("ValidationError", () => AsyncBox.ok(1))
      .catchTag("Unauthorized", () => AsyncBox.ok(2));

    const result = await handled.unwrapOr(-1);
    assertEquals(result, 0);
  });

  await t.step("provides access to error properties", async () => {
    const box = AsyncBox.fail("NetworkError", {
      statusCode: 503,
      retryable: true,
    }).catchTag("NetworkError", (e) => {
      return e.retryable ? AsyncBox.ok("retrying") : AsyncBox.fail("Fatal");
    });

    const result = await box.unwrapOr("");
    assertEquals(result, "retrying");
  });

  await t.step("works with async recovery", async () => {
    const box = AsyncBox.fail("NotFound", { id: "123" }).catchTag(
      "NotFound",
      (e) =>
        AsyncBox.fromPromise(
          delay(10, `Recovered: ${e.id}`),
          () => ({ _tag: "RecoveryError" as const }),
        ),
    );

    const result = await box.unwrapOr("");
    assertEquals(result, "Recovered: 123");
  });
});

// =============================================================================
// catchAll() - Recovering from all errors
// =============================================================================

Deno.test("catchAll()", async (t) => {
  await t.step("catches any error", async () => {
    const box = AsyncBox.err<string, number>("any error").catchAll((_e) =>
      AsyncBox.ok(0)
    );

    const result = await box.unwrapOr(-1);
    assertEquals(result, 0);
  });

  await t.step("replaces error type", async () => {
    type OriginalError = NotFoundError | ValidationError;
    type NewError = TaggedError<"CacheError">;

    const box: AsyncBox<string, OriginalError> = AsyncBox.fail("NotFound", {
      id: "123",
    });

    const handled = box.catchAll(() => AsyncBox.fail("CacheError"));
    // Type: AsyncBox<string, NewError>

    const tag = await handled.match({
      ok: () => null,
      err: (e) => e._tag,
    });

    assertEquals(tag, "CacheError");
  });

  await t.step("does not execute on success", async () => {
    let executed = false;
    const box = AsyncBox.ok(42).catchAll((_e) => {
      executed = true;
      return AsyncBox.ok(0);
    });

    await box.unwrapOr(-1);
    assertEquals(executed, false);
  });

  await t.step("can recover to success", async () => {
    const box = AsyncBox.err<NotFoundError, string>({
      _tag: "NotFound",
      id: "123",
    }).catchAll((_e) => AsyncBox.ok("fallback"));

    const result = await box.unwrapOr("");
    assertEquals(result, "fallback");
  });

  await t.step("provides original error to handler", async () => {
    const box = AsyncBox.fail("NotFound", { id: "user-123" }).catchAll((e) => {
      return AsyncBox.ok(`Recovered from ${e._tag} for ${e.id}`);
    });

    const result = await box.unwrapOr("");
    assertEquals(result, "Recovered from NotFound for user-123");
  });

  await t.step("works with async recovery", async () => {
    const box = AsyncBox.fail("Error").catchAll(() =>
      AsyncBox.fromPromise(
        delay(10, "async recovery"),
        () => ({ _tag: "RecoveryError" as const }),
      )
    );

    const result = await box.unwrapOr("");
    assertEquals(result, "async recovery");
  });
});

// =============================================================================
// match() - Pattern matching
// =============================================================================

Deno.test("match()", async (t) => {
  await t.step("matches success value", async () => {
    const result = await AsyncBox.ok(42).match({
      ok: (v) => `Success: ${v}`,
      err: (e) => `Error: ${e}`,
    });

    assertEquals(result, "Success: 42");
  });

  await t.step("matches error value", async () => {
    const result = await AsyncBox.err("failure").match({
      ok: (v) => `Success: ${v}`,
      err: (e) => `Error: ${e}`,
    });

    assertEquals(result, "Error: failure");
  });

  await t.step("both handlers return same type", async () => {
    const result = await AsyncBox.ok<number, string>(42).match({
      ok: (v) => v * 2,
      err: (e) => e.length,
    });

    assertEquals(typeof result, "number");
  });

  await t.step("can return complex types", async () => {
    type UiState = {
      loading: boolean;
      data: number | null;
      error: string | null;
    };

    const result = await AsyncBox.ok<number, string>(42).match<UiState>({
      ok: (data) => ({ loading: false, data, error: null }),
      err: (error) => ({ loading: false, data: null, error }),
    });

    assertEquals(result, { loading: false, data: 42, error: null });
  });

  await t.step("provides typed error access", async () => {
    const result = await AsyncBox.fail("NotFound", {
      id: "user-123",
    }).match({
      ok: () => "found",
      err: (e) => `${e._tag}: ${e.id}`,
    });

    assertEquals(result, "NotFound: user-123");
  });

  await t.step("can be used for side effects", async () => {
    let sideEffect = "";

    await AsyncBox.ok(42).match({
      ok: (v) => {
        sideEffect = `processed ${v}`;
        return v;
      },
      err: (_e) => 0,
    });

    assertEquals(sideEffect, "processed 42");
  });

  await t.step("works with async result", async () => {
    const result = await AsyncBox.fromPromise(
      delay(10, "delayed"),
      (_e) => ({ _tag: "Error" as const }),
    ).match({
      ok: (v) => v.toUpperCase(),
      err: () => "error",
    });

    assertEquals(result, "DELAYED");
  });
});

// =============================================================================
// matchExhaustive() - Exhaustive pattern matching
// =============================================================================

Deno.test("matchExhaustive()", async (t) => {
  await t.step("requires handler for each error tag", async () => {
    type AppError =
      | (TaggedError<"NotFound"> & { id: string })
      | TaggedError<"Unauthorized">
      | (TaggedError<"RateLimited"> & { retryAfter: number });

    const box: AsyncBox<string, AppError> = AsyncBox.fail("NotFound", {
      id: "123",
    });

    const result = await box.matchExhaustive({
      ok: (v) => `Success: ${v}`,
      NotFound: (e) => `Not found: ${e.id}`,
      Unauthorized: () => "Please log in",
      RateLimited: (e) => `Retry in ${e.retryAfter}s`,
    });

    assertEquals(result, "Not found: 123");
  });

  await t.step("handles success case", async () => {
    type Errors = NotFoundError | UnauthorizedError;
    const box: AsyncBox<number, Errors> = AsyncBox.ok(42);

    const result = await box.matchExhaustive({
      ok: (v) => v * 2,
      NotFound: () => 0,
      Unauthorized: () => 0,
    });

    assertEquals(result, 84);
  });

  await t.step("provides typed error properties", async () => {
    type Errors =
      | (TaggedError<"NetworkError"> & {
        statusCode: number;
        retryable: boolean;
      })
      | (TaggedError<"ParseError"> & { data: string });

    const box: AsyncBox<string, Errors> = AsyncBox.fail("NetworkError", {
      statusCode: 503,
      retryable: true,
    });

    const result = await box.matchExhaustive({
      ok: () => "ok",
      NetworkError: (e) => (e.retryable ? "retry" : "fail"),
      ParseError: (e) => `parse error: ${e.data}`,
    });

    assertEquals(result, "retry");
  });

  await t.step("works with single error type", async () => {
    const box: AsyncBox<number, NotFoundError> = AsyncBox.fail("NotFound", {
      id: "123",
    });

    const result = await box.matchExhaustive({
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
  await t.step("returns success value", async () => {
    const result = await AsyncBox.ok(42).unwrapOr(0);
    assertEquals(result, 42);
  });

  await t.step("returns default on error", async () => {
    const result = await AsyncBox.err<string, number>("error").unwrapOr(0);
    assertEquals(result, 0);
  });

  await t.step("works with different types", async () => {
    assertEquals(await AsyncBox.ok("hello").unwrapOr(""), "hello");
    assertEquals(
      await AsyncBox.err<string, string>("error").unwrapOr("fallback"),
      "fallback",
    );

    assertEquals(await AsyncBox.ok(true).unwrapOr(false), true);
    assertEquals(
      await AsyncBox.err<string, boolean>("error").unwrapOr(false),
      false,
    );

    assertEquals(await AsyncBox.ok([1, 2, 3]).unwrapOr([]), [1, 2, 3]);
    assertEquals(
      await AsyncBox.err<string, number[]>("error").unwrapOr([]),
      [],
    );
  });

  await t.step("works with object defaults", async () => {
    const defaultUser = { name: "Guest", id: 0 };
    const user = await AsyncBox.ok({ name: "Alice", id: 1 }).unwrapOr(
      defaultUser,
    );

    assertEquals(user, { name: "Alice", id: 1 });

    const errorUser = await AsyncBox.err<
      string,
      { name: string; id: number }
    >("error").unwrapOr(defaultUser);

    assertEquals(errorUser, defaultUser);
  });

  await t.step("handles null and undefined", async () => {
    assertEquals(
      await AsyncBox.ok<null, never>(null).unwrapOr(null),
      null,
    );
    assertEquals(
      await AsyncBox.ok<undefined, never>(undefined).unwrapOr(undefined),
      undefined,
    );
    assertEquals(
      await AsyncBox.err<string, null>("error").unwrapOr(null),
      null,
    );
  });

  await t.step("works with async values", async () => {
    const result = await AsyncBox.fromPromise(
      delay(10, 42),
      (_e) => ({ _tag: "Error" as const }),
    ).unwrapOr(0);

    assertEquals(result, 42);
  });
});

// =============================================================================
// run() - Getting the underlying Result
// =============================================================================

Deno.test("run()", async (t) => {
  await t.step("returns Result for success", async () => {
    const box = AsyncBox.ok(42);
    const result = await box.run();

    assertEquals(isOk(result), true);
    if (isOk(result)) {
      assertEquals(result.value, 42);
    }
  });

  await t.step("returns Result for error", async () => {
    const box = AsyncBox.err("error message");
    const result = await box.run();

    assertEquals(isErr(result), true);
    if (isErr(result)) {
      assertEquals(result.error, "error message");
    }
  });

  await t.step("preserves tagged errors", async () => {
    const box = AsyncBox.fail("NotFound", { id: "123" });
    const result = await box.run();

    assertEquals(isErr(result), true);
    if (isErr(result)) {
      assertEquals(result.error._tag, "NotFound");
      assertEquals(result.error.id, "123");
    }
  });

  await t.step("preserves complex types", async () => {
    const box = AsyncBox.ok({ user: { name: "Alice" }, posts: [] });
    const result = await box.run();

    assertEquals(isOk(result), true);
    if (isOk(result)) {
      assertEquals(result.value.user.name, "Alice");
    }
  });

  await t.step("can be used with Result utilities", async () => {
    const box = AsyncBox.ok(42).map((x) => x * 2);
    const result = await box.run();

    if (isOk(result)) {
      assertEquals(result.value, 84);
    } else {
      throw new Error("Expected Ok");
    }
  });
});

// =============================================================================
// Complex integration scenarios
// =============================================================================

Deno.test("Complex scenarios", async (t) => {
  await t.step("complete async user validation pipeline", async () => {
    type User = { id: number; email: string; age: number };

    function parseUser(
      data: string,
    ): AsyncBox<unknown, TaggedError<"ParseError">> {
      try {
        return AsyncBox.ok(JSON.parse(data));
      } catch {
        return AsyncBox.fail("ParseError");
      }
    }

    function validateEmail(
      user: unknown,
    ): AsyncBox<unknown, TaggedError<"InvalidEmail">> {
      const u = user as { email?: string };
      return u.email?.includes("@")
        ? AsyncBox.ok(user)
        : AsyncBox.fail("InvalidEmail");
    }

    function validateAge(
      user: unknown,
    ): AsyncBox<User, TaggedError<"InvalidAge">> {
      const u = user as { age?: number };
      return u.age && u.age >= 18
        ? AsyncBox.ok(user as User)
        : AsyncBox.fail("InvalidAge");
    }

    const validData = '{"id":1,"email":"alice@example.com","age":25}';
    const result = await parseUser(validData)
      .flatMap(validateEmail)
      .flatMap(validateAge)
      .match({
        ok: (user) => user.email,
        err: () => null,
      });

    assertEquals(result, "alice@example.com");
  });

  await t.step("error recovery chain", async () => {
    const result = await AsyncBox.fail("NotFound", { id: "123" })
      .catchTag("NotFound", () => AsyncBox.fail("CacheError"))
      .catchAll(() => AsyncBox.ok("final fallback"))
      .unwrapOr("");

    assertEquals(result, "final fallback");
  });

  await t.step("mixed operations pipeline", async () => {
    const result = await AsyncBox.ok(10)
      .map((x) => x * 2) // 20
      .flatMap((x) => (x > 15 ? AsyncBox.ok(x) : AsyncBox.fail("TooSmall")))
      .map((x) => x + 5) // 25
      .unwrapOr(0);

    assertEquals(result, 25);
  });

  await t.step("async data fetching with retry logic", async () => {
    let attempt = 0;

    function fetchData(): AsyncBox<string, NetworkError | TimeoutError> {
      attempt++;
      if (attempt === 1) {
        return AsyncBox.fail("Timeout", { duration: 5000 });
      }
      if (attempt === 2) {
        return AsyncBox.fail("NetworkError", {
          statusCode: 503,
          retryable: true,
        });
      }
      return AsyncBox.fromPromise(
        delay(5, "data"),
        () => ({
          _tag: "NetworkError" as const,
          statusCode: 500,
          retryable: false,
        }),
      );
    }

    const result = await fetchData()
      .catchTag("Timeout", () => fetchData())
      .catchTag(
        "NetworkError",
        (e) => e.retryable ? fetchData() : AsyncBox.err(e),
      )
      .unwrapOr("");

    assertEquals(result, "data");
    assertEquals(attempt, 3);
  });

  await t.step("combining multiple AsyncBox results", async () => {
    type User = { id: number; name: string };
    type Post = { title: string };
    type Comment = { text: string };
    type CombinedData = {
      user: User;
      posts: Post[];
      comments: Comment[];
    };

    type ErrorType = TaggedError<"Error">;

    const user = AsyncBox.fromPromise<User, ErrorType>(
      delay(5, { id: 1, name: "Alice" }),
      () => ({ _tag: "Error" as const }),
    );

    const posts = AsyncBox.fromPromise<Post[], ErrorType>(
      delay(5, [{ title: "Post 1" }]),
      () => ({ _tag: "Error" as const }),
    );

    const comments = AsyncBox.fromPromise<Comment[], ErrorType>(
      delay(5, [{ text: "Comment 1" }]),
      () => ({ _tag: "Error" as const }),
    );

    const combined = user
      .flatMap((u) => posts.map((p) => ({ user: u, posts: p })))
      .flatMap((data) => comments.map((c) => ({ ...data, comments: c })));

    const defaultValue: CombinedData = {
      user: { id: 0, name: "" },
      posts: [],
      comments: [],
    };

    const result = await combined.unwrapOr(defaultValue);
    assertEquals(result.user.name, "Alice");
    assertEquals(result.posts.length, 1);
    assertEquals(result.comments.length, 1);
  });

  await t.step("parallel async operations", async () => {
    async function fetchUser(
      id: number,
    ): Promise<{ id: number; name: string }> {
      await delay(10, null);
      return { id, name: `User${id}` };
    }

    const box1 = AsyncBox.fromPromise(
      fetchUser(1),
      (_e) => ({ _tag: "Error" as const }),
    );
    const box2 = AsyncBox.fromPromise(
      fetchUser(2),
      (_e) => ({ _tag: "Error" as const }),
    );
    const box3 = AsyncBox.fromPromise(
      fetchUser(3),
      (_e) => ({ _tag: "Error" as const }),
    );

    const [user1, user2, user3] = await Promise.all([
      box1.unwrapOr({ id: 0, name: "" }),
      box2.unwrapOr({ id: 0, name: "" }),
      box3.unwrapOr({ id: 0, name: "" }),
    ]);

    assertEquals(user1.name, "User1");
    assertEquals(user2.name, "User2");
    assertEquals(user3.name, "User3");
  });

  await t.step("real-world API scenario", async () => {
    type ApiResponse = { data: { userId: number; content: string } };

    function fetchFromApi(
      _endpoint: string,
    ): AsyncBox<ApiResponse, FetchError> {
      return AsyncBox.fromPromise(
        delay(10, { data: { userId: 1, content: "Hello" } }),
        (_e) => ({ _tag: "FetchError" as const, statusCode: 500 }),
      );
    }

    function parseResponse(
      response: ApiResponse,
    ): AsyncBox<string, ParseError> {
      try {
        return AsyncBox.ok(response.data.content);
      } catch {
        return AsyncBox.fail("ParseError", { input: JSON.stringify(response) });
      }
    }

    const result = await fetchFromApi("/api/data")
      .flatMap(parseResponse)
      .map((content) => content.toUpperCase())
      .catchTag("FetchError", () => AsyncBox.ok("FETCH_FAILED"))
      .catchTag("ParseError", () => AsyncBox.ok("PARSE_FAILED"))
      .unwrapOr("UNKNOWN_ERROR");

    assertEquals(result, "HELLO");
  });
});
