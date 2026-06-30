// Row types for the POS Slice 2 customer / patient tables.
// Mirror supabase/migrations/0022_pos_customers.sql.

export type Customer = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  phone_normalized: string | null;
  birthdate: string | null;
  marketing_consent: boolean;
  do_not_contact: boolean;
  is_medical_patient: boolean;
  loyalty_signup_id: string | null;
  visit_count: number;
  lifetime_spend_minor_units: number;
  last_visit_at: string | null;
  staff_note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientAuthorization = {
  id: string;
  customer_id: string;
  authorization_id: string | null;
  issued_on: string | null;
  expires_on: string | null;
  notes: string | null;
  status: string; // active | expired | revoked
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Input shape for create/update (subset of editable fields). */
export type CustomerInput = {
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  birthdate?: string | null;
  marketing_consent?: boolean;
  do_not_contact?: boolean;
  staff_note?: string | null;
};
