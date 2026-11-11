import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Runs the demo contracts with a tiny stand-in for NEAR's host, and checks each
// read-only method returns valid JSON, exactly like a wallet would receive it.
async function load(version) {
  const bytes = await readFile(new URL(`../demo/token-${version}.wasm`, import.meta.url));
  let returned;
  let memory;
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      value_return: (len, ptr) => {
        returned = new TextDecoder().decode(new Uint8Array(memory.buffer, Number(ptr), Number(len)));
      },
    },
  });
  memory = instance.exports.memory;
  const call = (name) => {
    instance.exports[name]();
    return JSON.parse(returned);
  };
  return { bytes, call };
}

for (const v of ["v1", "v2"]) {
  test(`demo token ${v} answers like a token`, async () => {
    const { call } = await load(v);
    assert.deepEqual(call("ft_metadata"), { spec: "ft-1.0.0", name: "Smoke Alarm Demo", symbol: "DEMO", decimals: 0 });
    assert.equal(call("ft_total_supply"), "1000000");
    assert.equal(call("ft_balance_of"), "1000000");
    assert.match(call("version"), new RegExp(`^${v}:`));
  });
}

test("v1 and v2 have different code, so the swap changes the code fingerprint", async () => {
  const hash = async (v) => createHash("sha256").update((await load(v)).bytes).digest("hex");
  assert.notEqual(await hash("v1"), await hash("v2"));
});
