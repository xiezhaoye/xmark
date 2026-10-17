/**
 * The pairing token: one random secret the phone presents on every request.
 *
 * Lives in a 0600 file inside a 0700 directory. A running server re-reads it
 * when its mtime changes, so `rotate-token` from another process takes effect
 * without a restart. A file that exists but does not hold a token is an error,
 * never silently replaced: replacing it would unpair the phone with no hint why.
 *
 * @module token
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function newToken(): string {
  return randomBytes(32).toString("hex");
}

async function writeTokenAtomically(file: string, token: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(file), 0o700);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${token}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

async function readToken(file: string): Promise<string> {
  const token = (await readFile(file, "utf8")).trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error(`Token file ${file} is corrupt; run \`xmark-mobile-server rotate-token\` to replace it`);
  }
  return token;
}

/** Read the token, creating it on first use. */
export async function loadOrCreateToken(file: string): Promise<string> {
  try {
    return await readToken(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const token = newToken();
  await writeTokenAtomically(file, token);
  return token;
}

/** Replace the token; every paired phone must pair again. */
export async function rotateToken(file: string): Promise<string> {
  const token = newToken();
  await writeTokenAtomically(file, token);
  return token;
}

/** Constant-time comparison; hashing first makes the lengths equal. */
export function tokenMatches(expected: string, presented: string | undefined): boolean {
  if (!presented) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(presented).digest();
  return timingSafeEqual(a, b) && expected.length === presented.length;
}

export interface TokenSource {
  current(): Promise<string>;
}

/**
 * A token reader that follows rotations. Keeps the last good token when the
 * file is briefly missing or unreadable, so a half-finished rotation never
 * locks the phone out.
 */
export async function createTokenSource(file: string): Promise<TokenSource> {
  let token = await loadOrCreateToken(file);
  let mtimeMs = (await stat(file)).mtimeMs;
  return {
    async current() {
      try {
        const now = (await stat(file)).mtimeMs;
        if (now !== mtimeMs) {
          token = await readToken(file);
          mtimeMs = now;
        }
      } catch {
        // Keep the last good token.
      }
      return token;
    },
  };
}
