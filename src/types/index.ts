export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  avatar_url?: string;
  flat_number?: string;
  vehicle_number?: string;
  resident_type?: 'owner' | 'tenant';
  role: 'admin' | 'user';
  created_at: string;
  is_approved: boolean;
  is_bot?: boolean;
  whatsapp_opt_in?: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  image_url?: string;
  created_by: string;
  created_at: string;
  is_pinned: boolean;
  profiles?: { full_name: string };
}

export interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  image_url?: string;
  created_by: string;
  max_attendees?: number;
  created_at: string;
  profiles?: { full_name: string };
  event_rsvps?: { id: string; user_id: string; status: string }[];
}

export interface Booking {
  id: string;
  user_id: string;
  facility: string;
  date: string;
  time_slot: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  notes?: string;
  created_at: string;
  profiles?: { full_name: string; flat_number?: string };
}

export interface Broadcast {
  id: string;
  title: string;
  message: string;
  created_by: string;
  created_at: string;
  profiles?: { full_name: string };
}

export interface Photo {
  id: string;
  user_id: string;
  url: string;
  caption?: string;
  created_at: string;
  profiles?: { full_name: string; avatar_url?: string };
}

export interface Update {
  id: string;
  title: string;
  content: string;
  category: string;
  created_by: string;
  created_at: string;
  profiles?: { full_name: string };
}

export interface BotMessage {
  id: string;
  body: string;
  authored_by: string | null;
  created_at: string;
}

export type WhatsAppStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'skipped_no_phone'
  | 'skipped_opt_out'
  | 'skipped_disabled';

export type VehicleType = 'car' | 'bike' | 'other';

export interface Vehicle {
  id: string;
  user_id: string;
  number: string;
  type: VehicleType;
  created_at: string;
}

export type FamilyRelation = 'spouse' | 'son' | 'daughter' | 'parent' | 'sibling' | 'other';
export type Gender = 'male' | 'female' | 'other';

export interface FamilyMember {
  id: string;
  user_id: string;
  full_name: string;
  relation: FamilyRelation;
  gender?: Gender | null;
  age?: number | null;
  phone?: string | null;
  created_at: string;
}

export type PetSpecies = 'dog' | 'cat' | 'bird' | 'other';

export interface Pet {
  id: string;
  user_id: string;
  name: string;
  species: PetSpecies;
  vaccinated: boolean;
  created_at: string;
}

export interface BotMessageRecipient {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string | null;
  whatsapp_status: WhatsAppStatus | null;
  whatsapp_message_id: string | null;
  whatsapp_error: string | null;
  whatsapp_sent_at: string | null;
  created_at: string;
  bot_messages?: BotMessage;
}

// ============================================================
// Issues (community ticket tracker)
// ============================================================

export type IssueCategory =
  | 'plumbing'
  | 'electrical'
  | 'housekeeping'
  | 'security'
  | 'lift'
  | 'garden'
  | 'pest_control'
  | 'internet'
  | 'other';

export type IssuePriority = 'low' | 'normal' | 'high' | 'urgent';

export type IssueStatus = 'todo' | 'in_progress' | 'resolved' | 'closed';

export interface Issue {
  id: string;
  created_by: string;
  title: string;
  description: string;
  category: IssueCategory;
  priority: IssuePriority;
  status: IssueStatus;
  assigned_to: string | null;
  flat_number: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  // Joined relations \u2014 optional because not every query selects them.
  profiles?: { full_name: string; flat_number?: string | null };
  assignee?: { full_name: string } | null;
}

export interface IssueComment {
  id: string;
  issue_id: string;
  author_id: string;
  body: string;
  is_internal: boolean;
  created_at: string;
  profiles?: { full_name: string; role?: 'admin' | 'user' };
}

export interface IssueStatusEvent {
  id: string;
  issue_id: string;
  from_status: IssueStatus | null;
  to_status: IssueStatus;
  changed_by: string | null;
  changed_at: string;
}

// ============================================================
// Clubhouse subscriptions / facilities / passes
// ============================================================

export interface ClubhouseFacility {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  hourly_rate: number;
  pass_rate_per_visit: number;
  requires_subscription: boolean;
  is_bookable: boolean;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export interface ClubhouseTier {
  id: string;
  name: string;
  description: string | null;
  monthly_price: number;
  yearly_price: number | null;
  // Facility slugs included in this tier.
  included_facilities: string[];
  // Null = unlimited.
  pass_quota_per_month: number | null;
  max_pass_duration_hours: number;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export type ClubhouseSubscriptionStatus =
  | 'pending_approval'
  | 'active'
  | 'expiring'
  | 'expired'
  | 'cancelled'
  | 'rejected';

// Months a resident may pick when requesting a subscription.
// Mirrored in the DB check constraint; keep in sync.
export type ClubhouseRequestMonths = 1 | 3 | 6 | 12;

export interface ClubhouseSubscription {
  id: string;
  flat_number: string;
  tier_id: string;
  primary_user_id: string;
  start_date: string;
  end_date: string;
  status: ClubhouseSubscriptionStatus;
  // Resident-initiated request metadata. NULL for admin backfills.
  requested_months: ClubhouseRequestMonths | null;
  requested_at: string | null;
  request_notes: string | null;
  // Approval audit. Filled when status transitions pending_approval -> active.
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
  // Optional joined data.
  clubhouse_tiers?: ClubhouseTier;
  primary_user?: { full_name: string; email: string; phone?: string | null };
}

export type ClubhousePassStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface ClubhousePass {
  id: string;
  code: string;
  qr_payload: string;
  subscription_id: string;
  flat_number: string;
  issued_to: string;
  facility_id: string;
  valid_from: string;
  valid_until: string;
  status: ClubhousePassStatus;
  used_at: string | null;
  validated_by: string | null;
  created_at: string;
  // Optional joined data.
  clubhouse_facilities?: Pick<ClubhouseFacility, 'id' | 'slug' | 'name'>;
  profiles?: { full_name: string; flat_number?: string | null };
}
