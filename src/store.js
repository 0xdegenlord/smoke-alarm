// Keeps the latest snapshot per token and an append-only log of every event.
// Plain JSON files in data/, so the history can be committed and read by anyone.
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export function createStore(dir = "data") {
  const snapshotsPath = join(dir, "snapshots.json");
  const eventsPath = join(dir, "events.jsonl");

  return {
    async loadSnapshots() {
      try {
        return JSON.parse(await readFile(snapshotsPath, "utf8"));
      } catch (e) {
        if (e.code === "ENOENT") return {};
        throw e;
      }
    },
    async saveSnapshots(snapshots) {
      await mkdir(dir, { recursive: true });
      await writeFile(snapshotsPath, JSON.stringify(snapshots, null, 2) + "\n");
    },
    async appendEvents(events) {
      if (events.length === 0) return;
      await mkdir(dir, { recursive: true });
      await appendFile(eventsPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    },
    async loadEvents() {
      try {
        const text = await readFile(eventsPath, "utf8");
        const events = [];
        for (const line of text.split("\n").filter(Boolean)) {
          try {
            events.push(JSON.parse(line));
          } catch {
            console.warn(`Skipping an unreadable line in ${eventsPath}.`);
          }
        }
        return events;
      } catch (e) {
        if (e.code === "ENOENT") return [];
        throw e;
      }
    },
  };
}
