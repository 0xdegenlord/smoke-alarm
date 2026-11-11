import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Starts the real command, the way a person or GitHub Actions would, on any operating system.
// It uses a bad flag so it stops right away without touching the network.
test("the scan command actually starts when run from the terminal", () => {
  const script = fileURLToPath(new URL("../src/scan.js", import.meta.url));
  let output = "";
  try {
    execFileSync(process.execPath, [script, "--every", "1"], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    output = `${e.stdout}${e.stderr}`;
  }
  assert.match(output, /--every needs a number of seconds, from 5 to 86400/);
});
