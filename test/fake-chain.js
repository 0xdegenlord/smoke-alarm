// A pretend NEAR network for tests. It answers the same RPC calls the real one does,
// so the scanner can be tested end to end without the internet.
export function createFakeChain(initial = {}) {
  const accounts = structuredClone(initial); // token -> { codeHash, keys:[{pk, full}], symbol, supply, holders:[balances] }
  let rateLimitNext = 0;

  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const enc = (v) => [...Buffer.from(JSON.stringify(v))];
  const unknown = (id) => json({ jsonrpc: "2.0", id, error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } });

  async function fetchImpl(url, init) {
    if (url.includes("/v1/ft/")) {
      const token = url.split("/v1/ft/")[1].split("/")[0];
      const a = accounts[token];
      if (!a) return json({ token_id: token, accounts: [] });
      return json({ token_id: token, accounts: a.holders.map((b, i) => ({ account_id: `h${i}.near`, balance: String(b) })) });
    }
    const { id, params } = JSON.parse(init.body);
    if (rateLimitNext > 0) {
      rateLimitNext--;
      return json({ jsonrpc: "2.0", id, error: { code: -429, message: "Rate limits exceeded" } });
    }
    const a = accounts[params.account_id];
    if (!a) return unknown(id);
    if (params.request_type === "view_account") {
      return json({ jsonrpc: "2.0", id, result: { code_hash: a.codeHash, amount: "0" } });
    }
    if (params.request_type === "view_access_key_list") {
      const keys = a.keys.map((k) => ({
        public_key: k.pk,
        access_key: { permission: k.full ? "FullAccess" : { FunctionCall: {} } },
      }));
      return json({ jsonrpc: "2.0", id, result: { keys } });
    }
    if (params.request_type === "call_function") {
      if (params.method_name === "ft_metadata") return json({ jsonrpc: "2.0", id, result: { result: enc({ symbol: a.symbol }) } });
      if (params.method_name === "ft_total_supply") return json({ jsonrpc: "2.0", id, result: { result: enc(String(a.supply)) } });
    }
    return json({ jsonrpc: "2.0", id, error: { message: "unsupported in fake" } });
  }

  return {
    fetchImpl,
    accounts,
    rateLimit(n) {
      rateLimitNext = n;
    },
  };
}
