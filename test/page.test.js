import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage, tokenStatus } from "../src/page.js";

const snap = (over = {}) => ({
  token: "tok.near",
  takenAt: "2026-11-09T00:00:00Z",
  exists: true,
  hasContract: true,
  codeHash: "ABCDEFGHIJKL",
  fullAccessKeys: [],
  symbol: "TOK",
  top10Share: 42.5,
  ...over,
});

test("statuses use plain words", () => {
  assert.equal(tokenStatus(snap()).text, "Locked");
  assert.equal(tokenStatus(snap({ fullAccessKeys: ["k1"] })).text, "1 master key held");
  assert.equal(tokenStatus(snap({ fullAccessKeys: ["k1", "k2"] })).text, "2 master keys held");
  assert.equal(tokenStatus({ token: "x", exists: false }).key, "missing");
});

test("the page shows tokens, counts and alerts, newest first", () => {
  const html = renderPage([
    {
      label: "Mainnet",
      network: "mainnet",
      snapshots: { a: snap(), b: snap({ token: "b.near", fullAccessKeys: ["k"] }) },
      events: [
        { severity: "info", type: "BASELINE", at: "2026-11-09T00:00:00Z", message: "baseline" },
        { severity: "critical", type: "X", at: "2026-11-09T01:00:00Z", message: "first alert" },
        { severity: "good", type: "Y", at: "2026-11-09T02:00:00Z", message: "second alert" },
      ],
    },
  ]);
  assert.match(html, /Tokens watched<\/div><div class="value">2/);
  assert.match(html, /1 master key held/);
  assert.ok(!html.includes(">baseline<"), "routine events are not shown as alerts");
  assert.ok(html.indexOf("second alert") < html.indexOf("first alert"), "newest alert first");
  assert.match(html, /nearblocks\.io\/address\/tok\.near/);
});

test("anything read from the chain is escaped, so a token name cannot inject HTML", () => {
  const html = renderPage([
    { label: "Mainnet", network: "mainnet", snapshots: { a: snap({ symbol: "<script>x</script>" }) }, events: [] },
  ]);
  assert.ok(!html.includes("<script>x"));
  assert.match(html, /&lt;script&gt;x/);
});

test("an empty page tells you what to run", () => {
  assert.match(renderPage([]), /Run <code>npm run scan<\/code>/);
});

test("no alerts shows a calm empty state", () => {
  const html = renderPage([{ label: "Mainnet", network: "mainnet", snapshots: { a: snap() }, events: [] }]);
  assert.match(html, /No alerts\. Every change so far has been routine\./);
});
