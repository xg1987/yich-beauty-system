import bcrypt from "bcryptjs";

/**
 * Password hashing utilities (works in both Node.js and Cloudflare Workers).
 *
 * We use bcryptjs (pure JS) so it runs everywhere without native dependencies.
 */

const SALT_ROUNDS = 10;

/**
 * Hash a plaintext password.
 * Always use this when storing new passwords (registration, invite, password reset, etc).
 */
export async function hashPassword(plain: string): Promise<string> {
  if (!plain || plain.length < 6) {
    throw new Error("密码长度至少需要 6 位");
  }
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a stored hash.
 */
export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  if (!plain || !hashed) return false;
  return bcrypt.compare(plain, hashed);
}

/**
 * Detect whether a stored password value is still in legacy plaintext format.
 * bcrypt hashes always start with $2a$, $2b$ or $2y$.
 */
export function isLegacyPlaintextPassword(storedPassword: string): boolean {
  return !storedPassword.startsWith("$2");
}

/**
 * Convenience helper: given a stored value, verify against it.
 * Automatically handles legacy plaintext during migration period.
 */
export async function verifyPasswordWithLegacySupport(
  plain: string,
  stored: string
): Promise<{ ok: boolean; needsMigration: boolean }> {
  if (!plain || !stored) {
    return { ok: false, needsMigration: false };
  }

  const isLegacy = isLegacyPlaintextPassword(stored);

  if (isLegacy) {
    // Legacy mode: direct compare (will be removed after migration)
    const ok = plain === stored;
    return { ok, needsMigration: ok }; // if login succeeds, we should migrate
  }

  const ok = await bcrypt.compare(plain, stored);
  return { ok, needsMigration: false };
}
