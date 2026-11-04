/**
 * Reading an original file without letting it grow past a limit.
 *
 * `stat` followed by `readFile` is a check-then-act: between the two the file
 * can grow (a log being appended to, a sync client writing a large note), and
 * `readFile` allocates whatever it finds. This module reads the way the
 * snapshot needs it instead:
 *
 * 1. `open` the file, so everything below applies to one inode;
 * 2. `fstat` the handle — regular file only, size within the limit;
 * 3. read at most `max + 1` bytes through the handle;
 * 4. `fstat` again and compare size *and* mtime: if they moved, or more than
 *    `max` bytes arrived, the capture is not a snapshot of anything;
 * 5. close in `finally`, whatever happened.
 *
 * A capture that saw the file change is retried a bounded number of times
 * (the writer usually has finished by then) and then reported as `changed` —
 * the caller answers a conflict rather than serving a torn read. Failures are
 * values, not exceptions, because every caller renders them as a status.
 *
 * Limits, stated honestly: this detects *observed* change between the two
 * stats, which is what a file being written by another process looks like. A
 * same-size, same-mtime rewrite is undetectable on a coarse-mtime filesystem.
 * With `followFinalSymlink: false` the final component must not be a symlink;
 * the caller's own path containment still runs first, so a link inside the
 * root cannot be used to reach outside it.
 *
 * @module boundedRead
 */
import { lstatSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

export type ReadFailure = "missing" | "not_a_file" | "too_large" | "changed" | "unreadable";

export type BoundedRead = { ok: true; bytes: Buffer } | { ok: false; reason: ReadFailure };

export interface BoundedReadOptions {
  /** Whole-file symlinks are refused when false (the final component only). */
  followFinalSymlink?: boolean;
  /** How many captures to attempt before reporting `changed`. Default 2. */
  captureAttempts?: number;
  /** Test seam: runs between the first `fstat` and the read. */
  beforeRead?: (path: string) => Promise<void> | void;
}

/** Node's error shape, without the `any` that comes with catching. */
function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

function failureFor(err: unknown): ReadFailure {
  const code = codeOf(err);
  if (code === "ENOENT" || code === "ENOTDIR") return "missing";
  if (code === "EACCES" || code === "EPERM") return "unreadable";
  return "unreadable";
}

/** Refuse a planted final symlink before the handle follows it. */
function isSymlink(file: string): boolean {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

interface Stamped {
  size: number;
  mtimeMs: number;
}

async function stamp(handle: FileHandle): Promise<Stamped & { isFile: boolean }> {
  const stats = await handle.stat();
  return { size: stats.size, mtimeMs: stats.mtimeMs, isFile: stats.isFile() };
}

/** Read at most `max + 1` bytes; `null` when the file turned out larger. */
async function readUpTo(handle: FileHandle, max: number): Promise<Buffer | null> {
  const buffer = Buffer.allocUnsafe(max + 1);
  let total = 0;
  while (total <= max) {
    const { bytesRead } = await handle.read(buffer, total, max + 1 - total, total);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return total > max ? null : Buffer.from(buffer.subarray(0, total));
}

/** One capture attempt: the handle is closed here, win or lose. */
async function capture(file: string, max: number, options: BoundedReadOptions): Promise<BoundedRead | "retry"> {
  if (options.followFinalSymlink === false && isSymlink(file)) return { ok: false, reason: "not_a_file" };
  let handle: FileHandle | null = null;
  try {
    handle = await open(file, "r");
    const before = await stamp(handle);
    if (!before.isFile) return { ok: false, reason: "not_a_file" };
    if (before.size > max) return { ok: false, reason: "too_large" };
    await options.beforeRead?.(file);
    const bytes = await readUpTo(handle, max);
    const after = await stamp(handle);
    if (!bytes) return { ok: false, reason: "too_large" };
    if (!after.isFile) return { ok: false, reason: "not_a_file" };
    const changed = after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes.length !== before.size;
    return changed ? "retry" : { ok: true, bytes };
  } catch (err) {
    return { ok: false, reason: failureFor(err) };
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Read a regular file of at most `max` bytes, or explain why it was refused.
 * `buffer.bytes` is the file exactly as it was when every check agreed.
 */
export async function readFileBounded(file: string, max: number, options: BoundedReadOptions = {}): Promise<BoundedRead> {
  const attempts = Math.max(1, options.captureAttempts ?? 2);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await capture(file, max, options);
    if (result !== "retry") return result;
  }
  return { ok: false, reason: "changed" };
}
