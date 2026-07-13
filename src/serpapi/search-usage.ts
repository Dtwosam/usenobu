import type { SearchUsageRecord, SearchUsageRecorder } from "./types.js";

/** In-memory search budget counter for connector and tests. */
export class InMemorySearchUsageRecorder implements SearchUsageRecorder {
  private readonly entries: SearchUsageRecord[] = [];

  record(entry: SearchUsageRecord): void {
    this.entries.push(entry);
  }

  getCount(): number {
    return this.entries.length;
  }

  getEntries(): readonly SearchUsageRecord[] {
    return this.entries;
  }
}
