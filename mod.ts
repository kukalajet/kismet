// Result type (for type annotations only)
export type { Result } from "./result.ts";
export { isErr, isOk } from "./result.ts";

// Error types and utilities
export type {
  AllTags,
  ErrorByTag,
  ErrorOf,
  ErrorsOf,
  ExcludeByTag,
  SuccessOf,
  TaggedError,
  TagOf,
  UnknownError,
} from "./error.ts";
export { defineErrors, makeTaggedError, t, unknownError } from "./error.ts";

// Box wrappers (primary API)
export { Box } from "./box.ts";
export { AsyncBox } from "./async_box.ts";

// Matcher
export type { MatchConfig } from "./matcher.ts";
export { matchExhaustive } from "./matcher.ts";
