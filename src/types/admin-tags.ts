// Admin association tags (President, VP, Secretary, Treasurer, ...).
// See supabase/migrations/20260426_admin_association_tags.sql.

export interface AdminTag {
  id: string;
  code: string;
  label: string;
  description: string | null;
  color: string;
  icon: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export interface ProfileAdminTag {
  profile_id: string;
  tag_id: string;
  assigned_by: string | null;
  assigned_at: string;
}

// Shape returned by v_admin_tags_by_profile and used by the badge component.
export interface AdminTagBadge {
  id: string;
  code: string;
  label: string;
  color: string;
  icon: string | null;
}
