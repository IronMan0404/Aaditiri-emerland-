export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  avatar_url?: string;
  flat_number?: string;
  vehicle_number?: string;
  resident_type?: 'owner' | 'tenant' | 'family';
  role: 'admin' | 'user';
  created_at: string;
  is_approved: boolean;
  is_bot?: boolean;
  whatsapp_opt_in?: boolean;
  // Family-member fields. Only populated when resident_type='family'.
  // See supabase/migrations/20260427_family_member_invites.sql.
  inviter_id?: string | null;
  family_relation?: 'spouse' | 'son' | 'daughter' | 'parent' | 'sibling' | 'in_law' | 'other' | null;
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
  // Login-account linkage. See migration 20260427.
  // - email: captured at invite time, also used for resend
  // - account_profile_id: set after invite acceptance — points to the
  //   live profiles row for this family member's login
  // - invitation_id: set while an invite is pending, cleared on
  //   accept/revoke/expire
  email?: string | null;
  account_profile_id?: string | null;
  invitation_id?: string | null;
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

// ============================================================
// Directory / phone book
// ============================================================

export type DirectoryCategory =
  | 'plumbing'
  | 'electrical'
  | 'carpentry'
  | 'painting'
  | 'pest_control'
  | 'lift_amc'
  | 'maid'
  | 'cook'
  | 'nanny'
  | 'driver'
  | 'milkman'
  | 'newspaper'
  | 'gas_cylinder'
  | 'laundry'
  | 'tailor'
  | 'cab_auto'
  | 'doctor'
  | 'hospital'
  | 'pharmacy'
  | 'police'
  | 'ambulance'
  | 'fire'
  | 'hardware'
  | 'grocery'
  | 'rwa_official'
  | 'society_office'
  | 'security_agency'
  | 'other';

export interface DirectoryContact {
  id: string;
  name: string;
  category: DirectoryCategory;
  phone: string;
  alt_phone: string | null;
  whatsapp: string | null;
  notes: string | null;
  area_served: string | null;
  hourly_rate: number | null;
  is_society_contact: boolean;
  is_verified: boolean;
  is_archived: boolean;
  submitted_by: string | null;
  vote_count: number;
  report_count: number;
  created_at: string;
  updated_at: string;
  // Optional joined data — only populated when the query selects the
  // relationship via supabase-js's nested select.
  profiles?: { full_name: string; flat_number?: string | null } | null;
}

export type DirectoryVoteKind = 'helpful' | 'reported';

export interface DirectoryVote {
  id: string;
  contact_id: string;
  user_id: string;
  kind: DirectoryVoteKind;
  created_at: string;
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

// ============================================================
// Telegram bot integration
// (See supabase/migrations/20260430_telegram.sql)
// ============================================================

export interface TelegramLink {
  id: string;
  user_id: string;
  chat_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean;
  linked_at: string;
  last_seen_at: string | null;
  updated_at: string;
}

export interface TelegramPairing {
  id: string;
  user_id: string;
  code: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

// The dedup ledger (telegram_notifications_sent) is keyed by a
// free-form `kind` string. The authoritative list of kinds lives
// in src/lib/notify-routing.ts as `NotificationKind`. Importing
// it from there into client code would pull in server-only
// modules, so we don't re-export it here \u2014 just document the
// intent.
