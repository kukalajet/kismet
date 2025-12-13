/**
 * Example 3: Validation Pipeline
 *
 * Demonstrates:
 * - AsyncBox.ok/err() for wrapping sync validations
 * - flatMap() chains for sequential dependent validations
 * - Promise.all() for parallel validation
 * - Error collection patterns
 * - tap() for logging validation steps
 *
 * Run: deno run examples/03-validation-pipeline.ts
 */

import { AsyncBox, defineErrors, type ErrorsOf, t } from "../mod.ts";

// Define validation errors
const ValidationErrors = defineErrors({
  InvalidEmail: { email: t.string, reason: t.string },
  InvalidAge: { age: t.number, min: t.number, max: t.number },
  EmailTaken: { email: t.string },
  UsernameInvalid: { username: t.string, rules: t.array<string>() },
  RateLimited: { retryAfter: t.number },
});

type ValidationError = ErrorsOf<typeof ValidationErrors>;

// Domain types
interface UserData {
  email: string;
  age: number;
  username: string;
}

interface ValidatedUser extends UserData {
  validated: true;
}

// Mock database of existing emails
const existingEmails = new Set(["existing@example.com", "taken@example.com"]);

// Helper: Async delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. Validate email format (sync validation wrapped in AsyncBox)
function validateEmail(
  email: string,
): AsyncBox<string, ReturnType<typeof ValidationErrors.InvalidEmail>> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email) {
    return AsyncBox.err(ValidationErrors.InvalidEmail({
      email,
      reason: "Email is required",
    }));
  }

  if (!emailRegex.test(email)) {
    return AsyncBox.err(ValidationErrors.InvalidEmail({
      email,
      reason: "Invalid email format",
    }));
  }

  return AsyncBox.ok(email);
}

// 2. Check email uniqueness (async database check)
function checkEmailUnique(
  email: string,
): AsyncBox<string, ReturnType<typeof ValidationErrors.EmailTaken>> {
  return AsyncBox.wrap({
    try: async () => {
      await delay(30); // Simulate database query
      if (existingEmails.has(email)) {
        throw new Error("Email taken");
      }
      return email;
    },
    catch: () => ValidationErrors.EmailTaken({ email }),
  });
}

// 3. Validate age range
function validateAge(
  age: number,
): AsyncBox<number, ReturnType<typeof ValidationErrors.InvalidAge>> {
  const MIN_AGE = 13;
  const MAX_AGE = 120;

  if (age < MIN_AGE || age > MAX_AGE) {
    return AsyncBox.err(ValidationErrors.InvalidAge({
      age,
      min: MIN_AGE,
      max: MAX_AGE,
    }));
  }

  return AsyncBox.ok(age);
}

// 4. Validate username (multiple rules)
function validateUsername(
  username: string,
): AsyncBox<string, ReturnType<typeof ValidationErrors.UsernameInvalid>> {
  const failedRules: string[] = [];

  if (username.length < 3) {
    failedRules.push("Username must be at least 3 characters");
  }
  if (username.length > 20) {
    failedRules.push("Username must be at most 20 characters");
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    failedRules.push(
      "Username can only contain letters, numbers, and underscores",
    );
  }
  if (/^[0-9]/.test(username)) {
    failedRules.push("Username cannot start with a number");
  }

  if (failedRules.length > 0) {
    return AsyncBox.err(ValidationErrors.UsernameInvalid({
      username,
      rules: failedRules,
    }));
  }

  return AsyncBox.ok(username);
}

// 5. Orchestrate sequential validation
function validateUserAsync(
  data: UserData,
): AsyncBox<ValidatedUser, ValidationError> {
  return validateEmail(data.email)
    .tap(() => console.log("  ✓ Email format valid"))
    .flatMap((email) =>
      checkEmailUnique(email)
        .tap(() => console.log("  ✓ Email is unique"))
    )
    .flatMap(() =>
      validateAge(data.age)
        .tap(() => console.log("  ✓ Age is valid"))
    )
    .flatMap(() =>
      validateUsername(data.username)
        .tap(() => console.log("  ✓ Username is valid"))
    )
    .map(() => ({ ...data, validated: true as const }));
}

// 6. Validate multiple users in parallel
async function validateMultipleUsers(
  users: UserData[],
): Promise<
  {
    valid: ValidatedUser[];
    invalid: { user: UserData; error: ValidationError }[];
  }
> {
  const results = await Promise.all(
    users.map((user) =>
      validateUserAsync(user)
        .run()
        .then((result) => ({ user, result }))
    ),
  );

  const valid: ValidatedUser[] = [];
  const invalid: { user: UserData; error: ValidationError }[] = [];

  for (const { user, result } of results) {
    if (result._tag === "Ok") {
      valid.push(result.value);
    } else {
      invalid.push({ user, error: result.error });
    }
  }

  return { valid, invalid };
}

// Demo scenarios
async function main() {
  console.log("\n=== Example 3: Validation Pipeline ===\n");

  // Scenario 1: Valid user data
  console.log("📋 Scenario 1: Valid user data");
  const validUser: UserData = {
    email: "alice@example.com",
    age: 25,
    username: "alice_123",
  };

  const result1 = await validateUserAsync(validUser)
    .match({
      ok: (user) => `✓ User validated: ${user.email}`,
      err: (e) => `✗ Validation failed: ${e._tag}`,
    });
  console.log(result1);
  console.log();

  // Scenario 2: Invalid email format
  console.log("📋 Scenario 2: Invalid email format");
  const invalidEmailUser: UserData = {
    email: "not-an-email",
    age: 25,
    username: "user_123",
  };

  const result2 = await validateUserAsync(invalidEmailUser)
    .matchExhaustive({
      ok: (user) => `✓ Valid: ${user.email}`,
      InvalidEmail: (e) => `✗ Invalid email "${e.email}": ${e.reason}`,
      InvalidAge: (e) => `✗ Invalid age ${e.age} (must be ${e.min}-${e.max})`,
      EmailTaken: (e) => `✗ Email ${e.email} is already registered`,
      UsernameInvalid: (e) =>
        `✗ Invalid username "${e.username}": ${e.rules.join(", ")}`,
      RateLimited: (e) => `✗ Rate limited (retry after ${e.retryAfter}s)`,
    });
  console.log(result2);
  console.log();

  // Scenario 3: Email already taken
  console.log("📋 Scenario 3: Email already taken (async check)");
  const takenEmailUser: UserData = {
    email: "existing@example.com",
    age: 30,
    username: "newuser",
  };

  const result3 = await validateUserAsync(takenEmailUser)
    .matchExhaustive({
      ok: (user) => `✓ Valid: ${user.email}`,
      InvalidEmail: (e) => `✗ Invalid email: ${e.reason}`,
      InvalidAge: (e) => `✗ Invalid age ${e.age}`,
      EmailTaken: (e) => `✗ Email ${e.email} is already registered`,
      UsernameInvalid: (e) => `✗ Invalid username: ${e.rules.join(", ")}`,
      RateLimited: (e) => `✗ Rate limited: ${e.retryAfter}s`,
    });
  console.log(result3);
  console.log();

  // Scenario 4: Invalid username
  console.log("📋 Scenario 4: Invalid username (multiple rules)");
  const invalidUsernameUser: UserData = {
    email: "bob@example.com",
    age: 28,
    username: "1a", // Too short, starts with number
  };

  const result4 = await validateUserAsync(invalidUsernameUser)
    .matchExhaustive({
      ok: (user) => `✓ Valid: ${user.username}`,
      InvalidEmail: (e) => `✗ ${e.reason}`,
      InvalidAge: (e) => `✗ Age must be ${e.min}-${e.max}`,
      EmailTaken: (e) => `✗ Email taken: ${e.email}`,
      UsernameInvalid: (e) =>
        `✗ Username errors:\n    - ${e.rules.join("\n    - ")}`,
      RateLimited: (e) => `✗ Rate limited: ${e.retryAfter}s`,
    });
  console.log(result4);
  console.log();

  // Scenario 5: Parallel validation of multiple users
  console.log("📋 Scenario 5: Parallel validation of 3 users");
  const users: UserData[] = [
    { email: "user1@example.com", age: 25, username: "user_one" },
    { email: "existing@example.com", age: 30, username: "user_two" },
    { email: "user3@example.com", age: 150, username: "user_three" },
  ];

  console.log("  → Validating 3 users in parallel...");
  const { valid, invalid } = await validateMultipleUsers(users);

  console.log(`  ✓ Valid users: ${valid.length}`);
  for (const user of valid) {
    console.log(`    - ${user.email} (${user.username})`);
  }

  console.log(`  ✗ Invalid users: ${invalid.length}`);
  for (const { user, error } of invalid) {
    console.log(`    - ${user.email}: ${error._tag}`);
  }

  console.log("\n" + "─".repeat(50) + "\n");
}

// Run example
if (import.meta.main) {
  await main();
}
