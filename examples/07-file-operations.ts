/**
 * Example 7: File Operations
 *
 * Demonstrates:
 * - Resource cleanup patterns
 * - Streaming simulation (chunked processing)
 * - Parallel I/O operations
 * - Error recovery with fallback to defaults
 * - tap() for progress reporting
 *
 * Run: deno run examples/07-file-operations.ts
 */

import { AsyncBox, defineErrors, type ErrorsOf, t } from "../mod.ts";

// Define file operation errors
const FileErrors = defineErrors({
  NotFound: { path: t.string },
  PermissionDenied: { path: t.string, operation: t.string },
  InvalidFormat: { path: t.string, expectedFormat: t.string },
  DiskFull: { path: t.string, required: t.number, available: t.number },
  CorruptedFile: { path: t.string, reason: t.string },
});

type FileError = ErrorsOf<typeof FileErrors>;

// Simulated filesystem
class MockFilesystem {
  private files = new Map<string, string>([
    [
      "config.json",
      JSON.stringify({ theme: "dark", language: "en", port: 3000 }),
    ],
    ["app.json", JSON.stringify({ name: "MyApp", version: "1.0.0" })],
    ["data.json", JSON.stringify({ users: 100, posts: 450 })],
    ["settings.json", JSON.stringify({ notifications: true, autoSave: false })],
    ["large-file.dat", "x".repeat(10000)],
    ["corrupted.json", "{invalid json content}"],
  ]);

  private readOnlyFiles = new Set(["system.conf"]);

  exists(path: string): boolean {
    return this.files.has(path);
  }

  read(path: string): string {
    const content = this.files.get(path);
    if (!content) {
      throw new Error("File not found");
    }
    return content;
  }

  write(path: string, content: string): void {
    if (this.readOnlyFiles.has(path)) {
      throw new Error("Permission denied");
    }
    // Simulate disk full (randomly)
    if (Math.random() < 0.1 && content.length > 1000) {
      throw new Error("Disk full");
    }
    this.files.set(path, content);
  }

  listFiles(): string[] {
    return Array.from(this.files.keys());
  }
}

const fs = new MockFilesystem();

// Helper: Async delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. Read file with error handling
function readFile(
  path: string,
): AsyncBox<
  string,
  | ReturnType<typeof FileErrors.NotFound>
  | ReturnType<typeof FileErrors.PermissionDenied>
> {
  return AsyncBox.wrap({
    try: async () => {
      await delay(10); // Simulate I/O
      return fs.read(path);
    },
    catch: (e) => {
      if (e instanceof Error && e.message.includes("not found")) {
        return FileErrors.NotFound({ path });
      }
      return FileErrors.PermissionDenied({ path, operation: "read" });
    },
  });
}

// 2. Write file with permission and space checks
function writeFile(
  path: string,
  content: string,
): AsyncBox<
  void,
  | ReturnType<typeof FileErrors.PermissionDenied>
  | ReturnType<typeof FileErrors.DiskFull>
> {
  return AsyncBox.wrap({
    try: async () => {
      await delay(15); // Simulate I/O
      fs.write(path, content);
    },
    catch: (e) => {
      if (e instanceof Error && e.message.includes("Permission denied")) {
        return FileErrors.PermissionDenied({ path, operation: "write" });
      }
      if (e instanceof Error && e.message.includes("Disk full")) {
        return FileErrors.DiskFull({
          path,
          required: content.length,
          available: 500,
        });
      }
      return FileErrors.PermissionDenied({ path, operation: "write" });
    },
  });
}

// 3. Parse JSON file
function parseJsonFile<T>(
  path: string,
): AsyncBox<T, FileError> {
  return readFile(path)
    .tap(() => console.log(`  → Reading ${path}...`))
    .flatMap((content) =>
      AsyncBox.wrap({
        try: () => Promise.resolve(JSON.parse(content) as T),
        catch: () =>
          FileErrors.InvalidFormat({
            path,
            expectedFormat: "JSON",
          }),
      })
    );
}

// 4. Process large file in chunks
function processLargeFile(
  path: string,
  chunkSize: number,
): AsyncBox<{ chunks: number; totalBytes: number }, FileError> {
  return readFile(path)
    .tap(() =>
      console.log(`  → Processing ${path} in chunks of ${chunkSize} bytes...`)
    )
    .flatMap((content) =>
      AsyncBox.wrap({
        try: async () => {
          const chunks: string[] = [];
          for (let i = 0; i < content.length; i += chunkSize) {
            chunks.push(content.slice(i, i + chunkSize));
            const progress = Math.round(
              ((i + chunkSize) / content.length) * 100,
            );
            console.log(
              `  [${
                Math.min(progress, 100)
              }%] Processed chunk ${chunks.length}...`,
            );
            await delay(50); // Simulate processing time
          }

          return {
            chunks: chunks.length,
            totalBytes: content.length,
          };
        },
        catch: () =>
          FileErrors.CorruptedFile({
            path,
            reason: "Failed to process file chunks",
          }),
      })
    );
}

// 5. Batch read multiple files in parallel
async function batchReadFiles(
  paths: string[],
): Promise<
  {
    successes: Array<{ path: string; size: number }>;
    failures: Array<{ path: string; error: string }>;
  }
> {
  const results = await Promise.all(
    paths.map((path) =>
      readFile(path)
        .map((content) => ({ path, content }))
        .run()
    ),
  );

  const successes: Array<{ path: string; size: number }> = [];
  const failures: Array<{ path: string; error: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const path = paths[i];

    if (result._tag === "Ok") {
      successes.push({ path, size: result.value.content.length });
    } else {
      failures.push({ path, error: result.error._tag });
    }
  }

  return { successes, failures };
}

// 6. Safe file operation with resource cleanup
function safeFileOperation<T>(
  operation: () => AsyncBox<T, FileError>,
): AsyncBox<T, FileError> {
  return operation()
    .tap(() => console.log("  → Operation completed, cleaning up resources..."))
    .tapErr(() =>
      console.log("  → Operation failed, cleaning up resources...")
    );
}

// Demo scenarios
async function main() {
  console.log("\n=== Example 7: File Operations ===\n");

  // Scenario 1: Read configuration file
  console.log("📋 Scenario 1: Read configuration file");
  const result1 = await parseJsonFile<{ theme: string; language: string }>(
    "config.json",
  )
    .match({
      ok: (config) =>
        `✓ Loaded config: theme=${config.theme}, lang=${config.language}`,
      err: (e) => `✗ Failed: ${e._tag}`,
    });
  console.log(result1);
  console.log();

  // Scenario 2: Missing file with fallback to defaults
  console.log("📋 Scenario 2: Missing file with fallback to defaults");
  const defaultConfig = { theme: "light", language: "en" };

  const result2 = await parseJsonFile<{ theme: string; language: string }>(
    "user-preferences.json",
  )
    .catchTag("NotFound", () => {
      console.log("  → File not found, using default configuration");
      return AsyncBox.ok(defaultConfig);
    })
    .match({
      ok: (config) => `✓ Using config: ${JSON.stringify(config)}`,
      err: (e) => `✗ Failed: ${e._tag}`,
    });
  console.log(result2);
  console.log();

  // Scenario 3: Batch file processing
  console.log("📋 Scenario 3: Batch file processing (parallel reads)");
  const filesToRead = [
    "app.json",
    "config.json",
    "missing.json",
    "data.json",
    "settings.json",
  ];

  console.log(`  → Reading ${filesToRead.length} files in parallel...`);
  const { successes, failures } = await batchReadFiles(filesToRead);

  console.log(`  ✓ Successfully read ${successes.length} files:`);
  for (const { path, size } of successes) {
    console.log(`    - ${path}: ${size} bytes`);
  }

  if (failures.length > 0) {
    console.log(`  ✗ Failed to read ${failures.length} files:`);
    for (const { path, error } of failures) {
      console.log(`    - ${path}: ${error}`);
    }
  }

  console.log(
    `✓ Processed ${successes.length}/${filesToRead.length} files successfully`,
  );
  console.log();

  // Scenario 4: Large file streaming
  console.log("📋 Scenario 4: Large file streaming (chunked processing)");
  const result4 = await processLargeFile("large-file.dat", 2500)
    .match({
      ok: (stats) =>
        `✓ Processed ${stats.totalBytes} bytes in ${stats.chunks} chunks`,
      err: (e) => `✗ Processing failed: ${e._tag}`,
    });
  console.log(result4);
  console.log();

  // Scenario 5: Handle corrupted file
  console.log("📋 Scenario 5: Handle corrupted/invalid file");
  const result5 = await parseJsonFile("corrupted.json")
    .matchExhaustive({
      ok: (data) => `✓ Parsed: ${JSON.stringify(data)}`,
      NotFound: (e) => `✗ File not found: ${e.path}`,
      PermissionDenied: (e) =>
        `✗ Permission denied: ${e.operation} on ${e.path}`,
      InvalidFormat: (e) => `✗ Invalid ${e.expectedFormat} in ${e.path}`,
      DiskFull: (e) =>
        `✗ Disk full: need ${e.required} bytes, have ${e.available}`,
      CorruptedFile: (e) => `✗ Corrupted: ${e.path} (${e.reason})`,
    });
  console.log(result5);
  console.log();

  // Scenario 6: Safe operation with cleanup
  console.log("📋 Scenario 6: Safe file operation with cleanup");
  const result6 = await safeFileOperation(() =>
    writeFile("output.json", JSON.stringify({ result: "success" }))
      .map(() => "File written successfully")
  )
    .match({
      ok: (msg) => `✓ ${msg}`,
      err: (e) => `✗ Failed: ${e._tag}`,
    });
  console.log(result6);
  console.log();

  // Scenario 7: Cascade of file operations
  console.log(
    "📋 Scenario 7: Cascade of operations (read → transform → write)",
  );
  const result7 = await readFile("config.json")
    .tap(() => console.log("  → Read config"))
    .flatMap((content) =>
      AsyncBox.wrap({
        try: () => Promise.resolve(JSON.parse(content)),
        catch: () =>
          FileErrors.InvalidFormat({
            path: "config.json",
            expectedFormat: "JSON",
          }),
      })
    )
    .tap(() => console.log("  → Parsed JSON"))
    .map((config: { theme: string }) => ({
      ...config,
      modified: true,
      timestamp: Date.now(),
    }))
    .tap(() => console.log("  → Transformed data"))
    .flatMap((newConfig) =>
      writeFile("config-modified.json", JSON.stringify(newConfig, null, 2))
        .map(() => newConfig)
    )
    .tap(() => console.log("  → Wrote modified config"))
    .match({
      ok: (config) =>
        `✓ Pipeline complete: ${Object.keys(config).length} fields`,
      err: (e) => `✗ Pipeline failed: ${e._tag}`,
    });
  console.log(result7);

  console.log("\n" + "─".repeat(50) + "\n");
}

// Run example
if (import.meta.main) {
  await main();
}
