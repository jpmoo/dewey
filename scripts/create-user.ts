/**
 * Create a Dewey credentials user (same as POST /api/register).
 *
 * Usage (from repo root, DATABASE_URL in .env.local):
 *   npx tsx scripts/create-user.ts
 *
 * Defaults: username tester, password tester123 (Dewey enforces password length ≥8; "tester1" is too short).
 * Override: CREATE_USER_USERNAME / CREATE_USER_PASSWORD
 */
import { config } from "dotenv";
import { resolve } from "path";
import { existsSync } from "fs";

const root = process.cwd();
if (existsSync(resolve(root, ".env.local"))) {
  config({ path: resolve(root, ".env.local") });
}
config({ path: resolve(root, ".env") });

const USERNAME = (process.env.CREATE_USER_USERNAME ?? "tester").trim();
const PASSWORD = process.env.CREATE_USER_PASSWORD ?? "tester123";

async function main() {
  if (!USERNAME || !PASSWORD) {
    console.error("Username and password required (defaults: tester / tester123).");
    process.exit(1);
  }
  if (PASSWORD.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const { createUser } = await import("../lib/db");
  const { hashPassword } = await import("../lib/password");
  const { getDefaultSettingsFromEnvFile, setSettings } = await import("../lib/settings");

  const password_hash = await hashPassword(PASSWORD);
  const user = await createUser({ username: USERNAME, password_hash });
  await setSettings(String(user.id), { ...getDefaultSettingsFromEnvFile(), is_system_admin: false });
  console.log(`Created user "${USERNAME}" (id ${user.id}).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
