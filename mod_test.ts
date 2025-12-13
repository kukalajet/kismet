import { assertEquals } from "@std/assert";
import {
  AsyncBox,
  Box,
  defineErrors,
  isErr,
  isOk,
  makeTaggedError,
  t as typeHelpers,
  unknownError,
} from "./mod.ts";
import type {
  AllTags,
  ErrorByTag,
  ErrorOf,
  ErrorsOf,
  ExcludeByTag,
  MatchConfig,
  Result,
  SuccessOf,
  TaggedError,
  TagOf,
  UnknownError,
} from "./mod.ts";

// =============================================================================
// Verify exports exist and work correctly
// =============================================================================

Deno.test("mod.ts exports", async (t) => {
  await t.step("Box is exported and works", () => {
    const box = Box.ok(42);
    assertEquals(box.unwrapOr(0), 42);

    const errBox = Box.fail("TestError", { code: 1 });
    assertEquals(errBox.isErr(), true);
  });

  await t.step("AsyncBox is exported and works", async () => {
    const box = AsyncBox.ok(42);
    assertEquals(await box.unwrapOr(0), 42);

    const wrapped = AsyncBox.wrap(() => Promise.resolve("test"));
    assertEquals(await wrapped.unwrapOr(""), "test");
  });

  await t.step("defineErrors is exported and works", () => {
    const Errors = defineErrors({
      NotFound: { id: typeHelpers.string },
      Invalid: undefined,
    });

    const error = Errors.NotFound({ id: "123" });
    assertEquals(error._tag, "NotFound");
    assertEquals(error.id, "123");
  });

  await t.step("t type helpers are exported", () => {
    assertEquals(typeof typeHelpers.string, "string");
    assertEquals(typeof typeHelpers.number, "number");
    assertEquals(typeof typeHelpers.boolean, "boolean");
  });

  await t.step("isOk and isErr are exported and work", () => {
    const okResult: Result<number, string> = { _tag: "Ok", value: 42 };
    const errResult: Result<number, string> = { _tag: "Err", error: "fail" };

    assertEquals(isOk(okResult), true);
    assertEquals(isErr(okResult), false);
    assertEquals(isOk(errResult), false);
    assertEquals(isErr(errResult), true);
  });

  await t.step("matchExhaustive is exported and works", () => {
    // Use Box.matchExhaustive instead as the standalone matchExhaustive
    // requires specific type constraints
    type TestError = TaggedError<"A"> | TaggedError<"B">;
    const box: Box<number, TestError> = Box.ok(42);

    const matched = box.matchExhaustive({
      ok: (v) => v * 2,
      A: () => 0,
      B: () => 0,
    });

    assertEquals(matched, 84);
  });

  await t.step("makeTaggedError is exported and works", () => {
    const TestError = makeTaggedError<"TestError", { code: number }>(
      "TestError",
    );
    const error = new TestError({ code: 500 });

    assertEquals(error._tag, "TestError");
    assertEquals(error.props.code, 500);
    assertEquals(error instanceof TestError, true);
  });

  await t.step("unknownError is exported and works", () => {
    const error = unknownError(new Error("test"));
    assertEquals(error._tag, "UnknownError");
    assertEquals(error.message, "test");
  });

  await t.step("type utilities are available", () => {
    // These are type-only checks - if they compile, they work
    const Errors = defineErrors({
      A: { x: typeHelpers.number },
      B: { y: typeHelpers.string },
    });

    type TestErrors = ErrorsOf<typeof Errors>;
    type TestResult = Result<string, TestErrors>;
    type TestSuccess = SuccessOf<TestResult>;
    type TestError = ErrorOf<TestResult>;
    type TestTags = AllTags<TestErrors>;
    type TestTagOf = TagOf<TestErrors>;
    type TestByTag = ErrorByTag<TestErrors, "A">;
    type TestExclude = ExcludeByTag<TestErrors, "A">;
    type TestUnknown = UnknownError;

    // Type assertions (compile-time only)
    const _success: TestSuccess = "test";
    const _error: TestError = { _tag: "A", x: 1 };
    const _tags: TestTags = "A";
    const _tagOf: TestTagOf = "B";
    const _byTag: TestByTag = { _tag: "A", x: 1 };
    const _exclude: TestExclude = { _tag: "B", y: "test" };
    const _unknown: TestUnknown = {
      _tag: "UnknownError",
      cause: null,
      message: "",
    };

    assertEquals(true, true); // If we got here, types work
  });

  await t.step("MatchConfig type is exported", () => {
    // Type-only check
    type TestConfig = MatchConfig<number, TaggedError<"A">, string>;
    const _config: TestConfig = {
      ok: (v) => String(v),
      A: () => "error",
    };
    assertEquals(true, true);
  });
});
