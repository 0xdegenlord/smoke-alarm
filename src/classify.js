// Compares two snapshots of the same token and says what changed and how much it matters.
//
// Severity:
//   critical  someone can now change, or just changed, the token's rules on their own
//   warn      worth a look, not proof of anything
//   good      the token got safer
//   info      recorded, no alert sent

export const CONCENTRATION_JUMP_POINTS = 10;

const label = (s) => (s.symbol ? `${s.symbol} (${s.token})` : s.token);

export function classify(prev, curr) {
  const name = label(curr.exists ? curr : prev ?? curr);
  const ev = (severity, type, message) => ({ severity, type, token: curr.token, at: curr.takenAt, message });

  if (!prev) {
    return [ev("info", "BASELINE", `${name}: first snapshot recorded.`)];
  }
  if (prev.exists && !curr.exists) {
    return [ev("critical", "ACCOUNT_DELETED", `${name}: the token's account no longer exists.`)];
  }
  if (!prev.exists && curr.exists) {
    // A recreated account is checked like a brand new token, not waved through.
    if (curr.fullAccessKeys.length > 0) {
      return [
        ev(
          "critical",
          "ACCOUNT_CREATED",
          `${name}: the account was created again and now has ${curr.fullAccessKeys.length} master key(s). Whoever holds one can replace its code.`,
        ),
      ];
    }
    return [ev("warn", "ACCOUNT_CREATED", `${name}: the account was created again. Treat it as a new token.`)];
  }
  if (!prev.exists && !curr.exists) return [];

  const events = [];
  const prevKeys = new Set(prev.fullAccessKeys);
  const newKeys = curr.fullAccessKeys.filter((k) => !prevKeys.has(k));
  const someoneHadKey = prev.fullAccessKeys.length > 0 || curr.fullAccessKeys.length > 0;

  if (newKeys.length > 0) {
    events.push(
      ev(
        "critical",
        "NEW_FULL_ACCESS_KEY",
        `${name}: ${newKeys.length} new master key(s) added. Whoever holds it can replace the token's code.`,
      ),
    );
  }

  if (prev.fullAccessKeys.length > 0 && curr.fullAccessKeys.length === 0) {
    events.push(ev("good", "KEYS_REMOVED", `${name}: all master keys removed. The code can no longer be swapped by a key holder.`));
  }

  if (prev.codeHash !== curr.codeHash) {
    if (prev.hasContract && !curr.hasContract) {
      events.push(ev("critical", "CONTRACT_REMOVED", `${name}: the token's code was removed.`));
    } else if (someoneHadKey) {
      events.push(
        ev(
          "critical",
          "UNILATERAL_RECOMPILE",
          `${name}: the token's code changed while someone held a master key. One person could have rewritten the rules.`,
        ),
      );
    } else {
      events.push(
        ev(
          "warn",
          "UPGRADE_NO_KEYS",
          `${name}: the token's code changed with no master key present, so the contract replaced its own code through one of its methods. That can be community governance or a single owner account. Check who is allowed to call it.`,
        ),
      );
    }
  }

  if (
    typeof prev.top10Share === "number" &&
    typeof curr.top10Share === "number" &&
    curr.top10Share - prev.top10Share >= CONCENTRATION_JUMP_POINTS
  ) {
    events.push(
      ev(
        "warn",
        "CONCENTRATION_UP",
        `${name}: top 10 holders went from ${prev.top10Share}% to ${curr.top10Share}% of supply.`,
      ),
    );
  }

  return events;
}

export const shouldAlert = (event) => event.severity !== "info";
