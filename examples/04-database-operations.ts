/**
 * Example 4: Database Operations
 *
 * Demonstrates:
 * - Resource management patterns (connection handling)
 * - catchTag() chains for different DB error types
 * - Retry logic for transient errors
 * - Transaction simulation (all-or-nothing)
 * - tapErr() for query logging
 *
 * Run: deno run examples/04-database-operations.ts
 */

import {
  AsyncBox,
  defineErrors,
  type ErrorsOf,
  type ErrorType,
  t,
} from "../mod.ts";

// Define database errors
const DbErrors = defineErrors({
  ConnectionError: { host: t.string, port: t.number },
  QueryError: { query: t.string, code: t.string },
  NotFound: { table: t.string, id: t.string },
  DuplicateKey: { table: t.string, key: t.string, value: t.string },
  TransactionFailed: { operation: t.string, reason: t.string },
  Timeout: { query: t.string, duration: t.number },
});

type DbError = ErrorsOf<typeof DbErrors>;

// Domain types
interface User {
  id: string;
  name: string;
  email: string;
}

interface DbConnection {
  host: string;
  port: number;
  connected: boolean;
}

// Mock database
class MockDatabase {
  private users = new Map<string, User>();
  private connectionFailureRate = 0.1;

  constructor() {
    // Seed some data
    this.users.set("u1", {
      id: "u1",
      name: "Alice",
      email: "alice@example.com",
    });
    this.users.set("u2", { id: "u2", name: "Bob", email: "bob@example.com" });
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  insert(user: User): void {
    if (this.users.has(user.id)) {
      throw new Error("Duplicate key");
    }
    if (
      this.users.has(
        [...this.users.values()].find((u) => u.email === user.email)?.id || "",
      )
    ) {
      throw new Error("Duplicate email");
    }
    this.users.set(user.id, user);
  }

  update(id: string, data: Partial<User>): boolean {
    const user = this.users.get(id);
    if (!user) return false;

    this.users.set(id, { ...user, ...data });
    return true;
  }

  delete(id: string): boolean {
    return this.users.delete(id);
  }

  shouldSimulateConnectionFailure(): boolean {
    return Math.random() < this.connectionFailureRate;
  }
}

const db = new MockDatabase();

// Helper: Async delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. Connect to database
function connect(): AsyncBox<
  DbConnection,
  ErrorType<typeof DbErrors, "ConnectionError">
> {
  return AsyncBox.wrap({
    try: async () => {
      await delay(20);

      if (db.shouldSimulateConnectionFailure()) {
        throw new Error("Connection refused");
      }

      return {
        host: "localhost",
        port: 5432,
        connected: true,
      };
    },
    catch: () => DbErrors.ConnectionError({ host: "localhost", port: 5432 }),
  });
}

// 2. Generic query executor
function query<T>(
  _conn: DbConnection,
  sql: string,
  executor: () => T,
): AsyncBox<
  T,
  | ErrorType<typeof DbErrors, "QueryError">
  | ErrorType<typeof DbErrors, "Timeout">
> {
  return AsyncBox.wrap({
    try: async () => {
      await delay(15);

      // Simulate random timeout
      if (Math.random() < 0.05) {
        throw new Error("Query timeout");
      }

      return executor();
    },
    catch: (e) => {
      if (e instanceof Error && e.message.includes("timeout")) {
        return DbErrors.Timeout({ query: sql, duration: 5000 });
      }
      return DbErrors.QueryError({
        query: sql,
        code: e instanceof Error ? e.message : "UNKNOWN",
      });
    },
  });
}

// 3. Find user by ID
function findById(
  conn: DbConnection,
  id: string,
): AsyncBox<
  User,
  | ErrorType<typeof DbErrors, "NotFound">
  | ErrorType<typeof DbErrors, "QueryError">
  | ErrorType<typeof DbErrors, "Timeout">
> {
  const sql = `SELECT * FROM users WHERE id = '${id}'`;

  return query(conn, sql, () => {
    const user = db.findById(id);
    if (!user) {
      throw new Error("Not found");
    }
    return user;
  })
    .mapErr((e) => {
      if (e._tag === "QueryError" && e.code.includes("Not found")) {
        return DbErrors.NotFound({ table: "users", id });
      }
      return e;
    });
}

// 4. Insert user
function insert(
  conn: DbConnection,
  user: User,
): AsyncBox<
  User,
  | ErrorType<typeof DbErrors, "DuplicateKey">
  | ErrorType<typeof DbErrors, "QueryError">
  | ErrorType<typeof DbErrors, "Timeout">
> {
  const sql =
    `INSERT INTO users VALUES ('${user.id}', '${user.name}', '${user.email}')`;

  return query(conn, sql, () => {
    db.insert(user);
    return user;
  })
    .mapErr((e) => {
      if (e._tag === "QueryError" && e.code.includes("Duplicate")) {
        return DbErrors.DuplicateKey({
          table: "users",
          key: "id",
          value: user.id,
        });
      }
      return e;
    });
}

// 5. Update user
function _update(
  conn: DbConnection,
  id: string,
  data: Partial<User>,
): AsyncBox<
  User,
  | ErrorType<typeof DbErrors, "NotFound">
  | ErrorType<typeof DbErrors, "QueryError">
  | ErrorType<typeof DbErrors, "Timeout">
> {
  const sql = `UPDATE users SET ... WHERE id = '${id}'`;

  return query(conn, sql, () => {
    const success = db.update(id, data);
    if (!success) {
      throw new Error("Not found");
    }
    return db.findById(id)!;
  })
    .mapErr((e) => {
      if (e._tag === "QueryError" && e.code.includes("Not found")) {
        return DbErrors.NotFound({ table: "users", id });
      }
      return e;
    });
}

// 6. Transaction - execute operations atomically
function transaction<T>(
  operations: (conn: DbConnection) => AsyncBox<T, DbError>,
): AsyncBox<T, DbError> {
  return connect()
    .tap(() => console.log("  → Starting transaction..."))
    .flatMap((conn) =>
      operations(conn)
        .tap(() => console.log("  → Committing transaction..."))
        .tapErr((e) =>
          console.log(`  → Rolling back transaction (${e._tag})...`)
        )
    );
}

// 7. Retry helper for transient errors
function withRetry<T, E>(
  fn: () => AsyncBox<T, E>,
  maxAttempts: number,
): AsyncBox<T, E> {
  async function attempt(attemptsLeft: number): Promise<AsyncBox<T, E>> {
    const result = await fn().run();

    if (result._tag === "Ok") {
      return AsyncBox.ok(result.value);
    }

    if (attemptsLeft <= 1) {
      return AsyncBox.err(result.error);
    }

    const error = result.error as DbError;
    // Retry on connection errors and timeouts
    if (error._tag === "ConnectionError" || error._tag === "Timeout") {
      console.log(
        `  → Retry ${
          maxAttempts - attemptsLeft + 1
        }/${maxAttempts} after ${error._tag}...`,
      );
      await delay(100 * (maxAttempts - attemptsLeft + 1)); // Exponential backoff
      return attempt(attemptsLeft - 1);
    }

    return AsyncBox.err(result.error);
  }

  return AsyncBox.fromPromise(
    attempt(maxAttempts).then((box) => box.run()),
    (e) => e as E,
  ).flatMap((result) =>
    result._tag === "Ok"
      ? AsyncBox.ok(result.value)
      : AsyncBox.err(result.error)
  );
}

// Demo scenarios
async function main() {
  console.log("\n=== Example 4: Database Operations ===\n");

  // Scenario 1: Successful CRUD operations
  console.log("📋 Scenario 1: Successful CRUD operations");
  const result1 = await connect()
    .tap((conn) => console.log(`  ✓ Connected to ${conn.host}:${conn.port}`))
    .flatMap((conn) =>
      insert(conn, { id: "u3", name: "Charlie", email: "charlie@example.com" })
        .tap((user) => console.log(`  ✓ Inserted user: ${user.name}`))
        .flatMap(() => findById(conn, "u3"))
        .tap((user) => console.log(`  ✓ Found user: ${user.name}`))
    )
    .match({
      ok: (user) => `✓ CRUD complete: ${user.email}`,
      err: (e) => `✗ Failed: ${e._tag}`,
    });
  console.log(result1);
  console.log();

  // Scenario 2: Duplicate key error
  console.log("📋 Scenario 2: Duplicate key error");
  const result2 = await connect()
    .flatMap((conn) =>
      insert(conn, { id: "u1", name: "Duplicate", email: "dup@example.com" })
    )
    .matchExhaustive({
      ok: (user) => `✓ Inserted: ${user.name}`,
      ConnectionError: (e) => `✗ Connection failed: ${e.host}:${e.port}`,
      QueryError: (e) => `✗ Query error: ${e.code}`,
      DuplicateKey: (e) => `✗ Duplicate ${e.key} "${e.value}" in ${e.table}`,
      Timeout: (e) => `✗ Timeout: ${e.query}`,
    });
  console.log(result2);
  console.log();

  // Scenario 3: Transaction with rollback on failure
  console.log("📋 Scenario 3: Transaction (rollback on error)");
  const result3 = await transaction((conn) =>
    insert(conn, { id: "u4", name: "David", email: "david@example.com" })
      .tap((user) => console.log(`    ✓ Step 1: Inserted ${user.name}`))
      .flatMap(() =>
        // This will fail due to duplicate key
        insert(conn, {
          id: "u1",
          name: "Should Fail",
          email: "fail@example.com",
        })
      )
      .tap(() => console.log("    ✓ Step 2: Inserted second user"))
  )
    .match({
      ok: () => `✓ Transaction committed`,
      err: (e) => `✗ Transaction rolled back (${e._tag})`,
    });
  console.log(result3);
  console.log();

  // Scenario 4: Retry on transient errors
  console.log("📋 Scenario 4: Retry on connection errors");
  const result4 = await withRetry(() => connect(), 3)
    .flatMap((conn) => findById(conn, "u1"))
    .match({
      ok: (user) => `✓ Connected and found user: ${user.name}`,
      err: (e) => `✗ Failed after retries: ${e._tag}`,
    });
  console.log(result4);
  console.log();

  // Scenario 5: Error recovery with catchTag
  console.log("📋 Scenario 5: Error recovery with catchTag");
  const result5 = await connect()
    .flatMap((conn) => findById(conn, "nonexistent"))
    .catchTag("NotFound", (e) => {
      console.log(`  → User ${e.id} not found, creating default user...`);
      return connect()
        .flatMap((conn) =>
          insert(conn, {
            id: e.id,
            name: "Default User",
            email: "default@example.com",
          })
        );
    })
    .match({
      ok: (user) => `✓ User: ${user.name}`,
      err: (e) => `✗ Failed: ${e._tag}`,
    });
  console.log(result5);

  console.log("\n" + "─".repeat(50) + "\n");
}

// Run example
if (import.meta.main) {
  await main();
}
