// Minimal NEAR JSON-RPC client. No dependencies, no API key.
// Tries each endpoint in order and uses the first one that answers.

export const DEFAULT_ENDPOINTS = [
  "https://free.rpc.fastnear.com",
  "https://rpc.mainnet.near.org", // deprecated by NEAR, kept only as a last resort
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRateLimited(err) {
  return err?.rpcError?.code === -429 || /429|Rate limit/i.test(String(err?.message));
}

// The free endpoint rate-limits bursts (seen live: about 80 quick calls, then code -429).
// So every call waits a little, and a rate-limited call backs off and retries.
export async function rpcCall(method, params, opts = {}) {
  const { retries = 4, baseDelayMs = 1500, sleepImpl = sleep } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await rpcOnce(method, params, opts);
    } catch (e) {
      if (!isRateLimited(e) || attempt >= retries) throw e;
      await sleepImpl(baseDelayMs * 2 ** attempt);
    }
  }
}

async function rpcOnce(method, params, { endpoints = DEFAULT_ENDPOINTS, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  let lastError;
  for (const url of endpoints) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "smoke-alarm", method, params }),
        signal: AbortSignal.timeout(timeoutMs), // a hanging endpoint fails over instead of stalling
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const json = await res.json();
      if (json.error) {
        const err = new Error(JSON.stringify(json.error).slice(0, 200));
        err.rpcError = json.error;
        throw err;
      }
      return json.result;
    } catch (e) {
      // An RPC-level error (for example "account does not exist") is a real answer, not an outage.
      if (e.rpcError) throw e;
      lastError = e;
    }
  }
  throw new Error(`All endpoints failed. Last error: ${lastError?.message}`);
}

export function isAccountMissing(err) {
  const text = JSON.stringify(err?.rpcError ?? err?.message ?? "");
  return /UNKNOWN_ACCOUNT|does not exist|AccountDoesNotExist/i.test(text);
}

export async function viewAccount(accountId, opts) {
  return rpcCall("query", { request_type: "view_account", finality: "final", account_id: accountId }, opts);
}

export async function viewAccessKeys(accountId, opts) {
  return rpcCall("query", { request_type: "view_access_key_list", finality: "final", account_id: accountId }, opts);
}

export async function callView(accountId, methodName, args, opts) {
  const result = await rpcCall(
    "query",
    {
      request_type: "call_function",
      finality: "final",
      account_id: accountId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args ?? {})).toString("base64"),
    },
    opts,
  );
  return JSON.parse(Buffer.from(result.result).toString());
}
