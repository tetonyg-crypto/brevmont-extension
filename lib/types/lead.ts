export interface CapturedLead {
  id: string; // UUIDv4 generated client-side
  dealership_id?: string; // Set by API from JWT, not by client
  rep_id?: string; // Set by API from JWT, not by client
  customer_name: string;
  phone: string | null;
  email: string | null;
  vehicle_interest: string | null;
  source_platform: string;
  source_raw_text: string;
  status: "captured" | "enriched" | "logged_to_crm";
  captured_at: number; // Epoch ms (local), converted to ISO on sync
  enriched_at?: number;
  logged_at?: number;
  metadata?: Record<string, any>;
}

export interface LocalLead extends CapturedLead {
  sync_status: "pending" | "synced" | "error";
  updated_at: number; // Epoch ms, for conflict resolution
}
