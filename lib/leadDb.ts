import Dexie, { type Table } from "dexie";
import type { LocalLead } from "./types/lead";

/**
 * Local IndexedDB for Lead Inbox rows (extension).
 * BREZ: may merge with `lib/retryQueue.ts` Dexie or keep separate.
 */
export class BrevmontLeadDB extends Dexie {
  captured_leads!: Table<LocalLead, string>;

  constructor() {
    super("BrevmontLeads");
    this.version(1).stores({
      captured_leads: "id, status, sync_status, captured_at",
    });
  }
}

export const leadDb = new BrevmontLeadDB();
