// Community Internal Funds — TypeScript shapes mirroring the SQL schema in
// supabase/migrations/20260424_community_funds.sql. All monetary fields are
// in PAISE (integer). Use src/lib/money.ts to format for display.

export type FundStatus = 'collecting' | 'spending' | 'closed' | 'cancelled';
export type FundVisibility = 'all_residents' | 'committee_only';

export type ContributionMethod =
  | 'upi'
  | 'cash'
  | 'cheque'
  | 'neft'
  | 'imps'
  | 'in_kind'
  | 'other';

export type ContributionStatus = 'reported' | 'received' | 'rejected';

export type SpendMethod =
  | 'cash'
  | 'upi'
  | 'cheque'
  | 'bank_transfer'
  | 'credit_card'
  | 'other';

export type FundRecurringPeriod = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | null;

export interface FundCategory {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  color: string | null;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export interface CommunityFund {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  purpose: string | null;
  target_amount: number | null;
  suggested_per_flat: number | null;
  start_date: string | null;
  collection_deadline: string | null;
  event_date: string | null;
  status: FundStatus;
  visibility: FundVisibility;
  total_collected: number;
  total_in_kind_value: number;
  total_spent: number;
  total_refunded: number;
  contributor_count: number;
  is_recurring: boolean;
  recurring_period: FundRecurringPeriod;
  parent_fund_id: string | null;
  closed_by: string | null;
  closed_at: string | null;
  closure_notes: string | null;
  cover_image_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Joined when convenient
  fund_categories?: FundCategory;
}

// Shape returned by the v_fund_summary view — flatter, includes
// computed progress %.
export interface FundSummary {
  id: string;
  name: string;
  status: FundStatus;
  target_amount: number | null;
  suggested_per_flat: number | null;
  start_date: string | null;
  collection_deadline: string | null;
  event_date: string | null;
  total_collected: number;
  total_in_kind_value: number;
  total_spent: number;
  total_refunded: number;
  current_balance: number;
  contributor_count: number;
  cover_image_url: string | null;
  visibility: FundVisibility;
  collection_progress_pct: number | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  category_code: string | null;
}

export interface FundContribution {
  id: string;
  fund_id: string;
  flat_number: string;
  resident_id: string | null;
  contributor_name: string;
  amount: number;
  method: ContributionMethod;
  reference_number: string | null;
  contribution_date: string;
  notes: string | null;
  screenshot_url: string | null;
  status: ContributionStatus;
  is_in_kind: boolean;
  in_kind_description: string | null;
  is_anonymous: boolean;
  reported_by: string | null;
  reported_at: string;
  received_by: string | null;
  received_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface FundSpend {
  id: string;
  fund_id: string;
  amount: number;
  spend_date: string;
  description: string;
  vendor_name: string | null;
  vendor_phone: string | null;
  category_hint: string | null;
  payment_method: SpendMethod;
  payment_reference: string | null;
  paid_by_name: string | null;
  paid_by_user_id: string | null;
  is_reimbursement: boolean;
  reimbursed_at: string | null;
  receipt_url: string | null;
  invoice_url: string | null;
  recorded_by: string;
  recorded_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FundRefund {
  id: string;
  fund_id: string;
  contribution_id: string | null;
  flat_number: string;
  resident_id: string | null;
  amount: number;
  refund_date: string;
  method: SpendMethod;
  reference_number: string | null;
  notes: string | null;
  recorded_by: string;
  recorded_at: string;
}

export interface FundComment {
  id: string;
  fund_id: string;
  parent_comment_id: string | null;
  author_id: string;
  author_name: string;
  author_flat: string | null;
  body: string;
  is_admin_reply: boolean;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryTotals {
  category_id: string;
  category_code: string;
  category_name: string;
  icon: string | null;
  color: string | null;
  fund_count: number;
  total_collected: number;
  total_in_kind_value: number;
  total_spent: number;
  current_balance: number;
}

export interface CommunityBalanceOverall {
  total_ever_collected: number;
  total_ever_in_kind_value: number;
  total_ever_spent: number;
  total_ever_refunded: number;
  net_current_balance: number;
  active_collecting: number;
  active_spending: number;
  completed_funds: number;
}
