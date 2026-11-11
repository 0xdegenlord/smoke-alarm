// Loads KEY=value lines from a .env file into process.env, if the file exists.
// Values already set in the shell win. Uses Node's built-in loader, no dependency.
import { existsSync } from "node:fs";

export function loadEnvFile(path = ".env") {
  if (!existsSync(path)) return false;
  const before = { ...process.env };
  process.loadEnvFile(path);
  for (const [k, v] of Object.entries(before)) process.env[k] = v;
  return true;
}
