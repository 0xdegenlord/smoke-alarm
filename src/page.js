#!/usr/bin/env node
// Builds docs/index.html: a plain-language status page from the saved snapshots and events.
// One self-contained file. Open it by double-clicking, or publish docs/ with GitHub Pages.
// Usage: npm run page
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createStore } from "./store.js";
import { explorerUrl } from "./notify.js";

const SOURCES = [
  { label: "Mainnet", network: "mainnet", dir: "data" },
  { label: "Testnet demo", network: "testnet", dir: "data-testnet" },
];
const RECENT_ALERTS = 20;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function tokenStatus(snap) {
  if (!snap.exists) return { key: "missing", text: "Account missing", detail: "This token's account does not exist." };
  if (!snap.hasContract) return { key: "missing", text: "No code", detail: "There is no token code on this account." };
  const n = snap.fullAccessKeys.length;
  if (n === 0) return { key: "locked", text: "Locked", detail: "No master key exists. Nobody can swap the code on their own." };
  return {
    key: "key-held",
    text: `${n} master key${n > 1 ? "s" : ""} held`,
    detail: "Whoever holds this key can replace the token's code at any time.",
  };
}

const SEVERITY_TEXT = { critical: "Critical", warn: "Warning", good: "Good news" };

function formatTime(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function tokenRow(snap, network) {
  const s = tokenStatus(snap);
  const share = typeof snap.top10Share === "number" ? `${snap.top10Share}%` : "n/a";
  return `<tr>
  <td><div class="sym">${esc(snap.symbol ?? "")}</div><a class="acct" href="${esc(explorerUrl(snap.token, network))}">${esc(snap.token)}</a></td>
  <td><span class="chip ${s.key}" title="${esc(s.detail)}">${esc(s.text)}</span></td>
  <td class="mono">${esc((snap.codeHash ?? "").slice(0, 10))}</td>
  <td class="num">${esc(share)}</td>
  <td class="muted">${esc(formatTime(snap.takenAt))}</td>
</tr>`;
}

function alertItem(e) {
  return `<li class="alert ${esc(e.severity)}">
  <div class="alert-head"><span class="chip ${esc(e.severity)}">${esc(SEVERITY_TEXT[e.severity] ?? e.severity)}</span><span class="muted">${esc(formatTime(e.at))}</span></div>
  <p>${esc(e.message)}</p>
</li>`;
}

export function renderSection({ label, network, snapshots, events }) {
  const snaps = Object.values(snapshots);
  if (snaps.length === 0) return "";
  const locked = snaps.filter((s) => tokenStatus(s).key === "locked").length;
  const keyHeld = snaps.filter((s) => tokenStatus(s).key === "key-held").length;
  const alerts = events.filter((e) => e.severity !== "info").slice(-RECENT_ALERTS).reverse();
  const lastCheck = snaps.map((s) => s.takenAt).sort().at(-1);

  return `<section>
  <h2>${esc(label)}</h2>
  <div class="stats">
    <div class="stat"><div class="label">Tokens watched</div><div class="value">${snaps.length}</div></div>
    <div class="stat"><div class="label">Locked</div><div class="value">${locked}</div></div>
    <div class="stat"><div class="label">Master key held</div><div class="value">${keyHeld}</div></div>
    <div class="stat"><div class="label">Last check</div><div class="value small">${esc(formatTime(lastCheck))}</div></div>
  </div>
  <h3>Recent alerts</h3>
  ${
    alerts.length === 0
      ? `<p class="empty">No alerts. Every change so far has been routine.</p>`
      : `<ul class="alerts">${alerts.map(alertItem).join("\n")}</ul>`
  }
  <h3>Tokens</h3>
  <div class="table-wrap"><table>
    <thead><tr><th>Token</th><th>Status</th><th>Code fingerprint</th><th class="num">Top 10 hold</th><th>Checked</th></tr></thead>
    <tbody>${snaps.map((s) => tokenRow(s, network)).join("\n")}</tbody>
  </table></div>
</section>`;
}

export function renderPage(sections, generatedAt = new Date().toISOString()) {
  const body = sections.map(renderSection).filter(Boolean).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smoke Alarm</title>
<style>
:root{--bg:#fafaf8;--card:#fff;--text:#1f1f1d;--muted:#6b6a65;--border:#e4e2db;
--green-bg:#e6f4ea;--green:#1e6b3a;--amber-bg:#fdf1dc;--amber:#8a5300;--red-bg:#fbe9e9;--red:#a12b2b;--blue-bg:#e8f0fb;--blue:#1d4f91}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1d1d1b;--text:#ecebe6;--muted:#a3a29b;--border:#33322e;
--green-bg:#173723;--green:#8fd6a6;--amber-bg:#3a2a0d;--amber:#f2c26b;--red-bg:#3d1717;--red:#f29b9b;--blue-bg:#16263d;--blue:#9cc1f2}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:26px;font-weight:600;margin:0}
.lede{color:var(--muted);margin:4px 0 28px;max-width:640px}
h2{font-size:19px;font-weight:600;margin:36px 0 12px;padding-top:20px;border-top:1px solid var(--border)}
h3{font-size:15px;font-weight:600;margin:24px 0 8px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.label{color:var(--muted);font-size:13px}.value{font-size:22px;font-weight:600}.value.small{font-size:15px;padding-top:6px}
.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:10px;background:var(--card)}
table{width:100%;border-collapse:collapse;min-width:620px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top}
tr:last-child td{border-bottom:none}
th{font-size:13px;color:var(--muted);font-weight:500}
.num{text-align:right}.muted{color:var(--muted);font-size:13px}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:13px}
.sym{font-weight:600}.acct{color:var(--muted);font-size:13px;word-break:break-all;text-decoration:none}
.acct:hover{text-decoration:underline}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.chip.locked,.chip.good{background:var(--green-bg);color:var(--green)}
.chip.key-held,.chip.warn{background:var(--amber-bg);color:var(--amber)}
.chip.missing,.chip.critical{background:var(--red-bg);color:var(--red)}
.alerts{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.alert{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px}
.alert.critical{border-color:var(--red)}
.alert-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.alert p{margin:6px 0 0}
.empty{background:var(--card);border:1px dashed var(--border);border-radius:10px;padding:14px;color:var(--muted);margin:0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0}
dt{font-weight:600}dd{margin:0;color:var(--muted)}
footer{margin-top:40px;color:var(--muted);font-size:13px}
</style>
</head>
<body>
<main>
<h1>Smoke Alarm</h1>
<p class="lede">Watches NEAR tokens and tells you when someone can change, or just changed, the rules behind your balance.</p>
${body || `<p class="empty">No scans yet. Run <code>npm run scan</code>, then <code>npm run page</code>.</p>`}
<h2>How to read this</h2>
<dl>
<dt><span class="chip locked">Locked</span></dt><dd>No master key exists, so no single person can swap the token's code.</dd>
<dt><span class="chip key-held">Master key held</span></dt><dd>Someone holds a key that can replace the token's code at any moment.</dd>
<dt>Code fingerprint</dt><dd>A short ID of the token's code. If it changes, the rules changed.</dd>
<dt>Top 10 hold</dt><dd>Share of supply held by the 10 largest accounts. These are often pools, bridges and exchanges, not people, so a high number is normal for big tokens.</dd>
</dl>
<footer>Generated ${esc(formatTime(generatedAt))}. Smoke Alarm detects changes, not intentions: a quiet page is not a safety guarantee.</footer>
</main>
</body>
</html>
`;
}

async function main() {
  const sections = [];
  for (const src of SOURCES) {
    if (!existsSync(src.dir)) continue;
    const store = createStore(src.dir);
    sections.push({ ...src, snapshots: await store.loadSnapshots(), events: await store.loadEvents() });
  }
  await mkdir("docs", { recursive: true });
  await writeFile("docs/index.html", renderPage(sections));
  const n = sections.reduce((s, x) => s + Object.keys(x.snapshots).length, 0);
  console.log(`Wrote docs/index.html with ${n} token(s). Open it in your browser.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
