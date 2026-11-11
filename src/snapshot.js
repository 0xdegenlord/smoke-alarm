// Takes one snapshot of a token: the facts we compare over time.
import { viewAccount, viewAccessKeys, callView, isAccountMissing } from "./rpc.js";

// NEAR reports this hash for an account with no contract deployed.
export const EMPTY_CODE_HASH = "11111111111111111111111111111111";

export const HOLDERS_URL = (token) => `https://api.fastnear.com/v1/ft/${token}/top`;

export async function takeSnapshot(token, opts = {}) {
  const { fetchImpl = fetch, now = () => new Date() } = opts;
  const takenAt = now().toISOString();

  let account;
  try {
    account = await viewAccount(token, opts);
  } catch (e) {
    if (isAccountMissing(e)) return { token, takenAt, exists: false };
    throw e;
  }

  const keyList = await viewAccessKeys(token, opts);
  const fullAccessKeys = keyList.keys
    .filter((k) => k.access_key.permission === "FullAccess")
    .map((k) => k.public_key)
    .sort();
  const functionCallKeys = keyList.keys.length - fullAccessKeys.length;

  const snap = {
    token,
    takenAt,
    exists: true,
    codeHash: account.code_hash,
    hasContract: account.code_hash !== EMPTY_CODE_HASH,
    fullAccessKeys,
    functionCallKeys,
    symbol: null,
    totalSupply: null,
    top10Share: null,
  };

  // The rest is nice to have. If any of it fails, the snapshot still counts.
  if (snap.hasContract) {
    try {
      snap.symbol = (await callView(token, "ft_metadata", {}, opts)).symbol ?? null;
    } catch {}
    try {
      snap.totalSupply = String(await callView(token, "ft_total_supply", {}, opts));
    } catch {}
  }
  if (snap.totalSupply && opts.holders !== false) {
    try {
      snap.top10Share = await fetchTop10Share(token, snap.totalSupply, fetchImpl);
    } catch {}
  }
  return snap;
}

// Percent of total supply held by the 10 largest holders, rounded to 0.01.
export async function fetchTop10Share(token, totalSupply, fetchImpl = fetch) {
  const res = await fetchImpl(HOLDERS_URL(token), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`holders HTTP ${res.status}`);
  const data = await res.json();
  const rows = data.accounts ?? [];
  const total = BigInt(totalSupply);
  if (total === 0n || rows.length === 0) return null;
  const top = rows
    .map((r) => BigInt(r.balance))
    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
    .slice(0, 10)
    .reduce((s, b) => s + b, 0n);
  return Number((top * 10000n) / total) / 100;
}
