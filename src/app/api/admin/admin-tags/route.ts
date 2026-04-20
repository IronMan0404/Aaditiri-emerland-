import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { logAdminAction } from '@/lib/admin-audit';

interface CreateBody {
  code: string;
  label: string;
  description?: string;
  color?: string;
  icon?: string;
  display_order?: number;
}

// GET /api/admin/admin-tags
// Lists every defined association tag (active + inactive) so the manage
// page can show what's available.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from('admin_tags')
    .select('*')
    .order('display_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tags: data ?? [] });
}

// POST /api/admin/admin-tags — create a new tag (e.g. "Joint Secretary 2026").
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as CreateBody;
  if (!body.code?.trim()) return NextResponse.json({ error: 'Code required' }, { status: 400 });
  if (!body.label?.trim()) return NextResponse.json({ error: 'Label required' }, { status: 400 });

  // Normalise the code so duplicates with different casing collide on the
  // unique constraint. Also enforces a friendly URL-safe slug shape.
  const code = body.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');

  const { data, error } = await auth.supabase
    .from('admin_tags')
    .insert({
      code,
      label: body.label.trim(),
      description: body.description?.trim() || null,
      color: body.color?.trim() || '#374151',
      icon: body.icon?.trim() || null,
      display_order: body.display_order ?? 100,
    })
    .select()
    .single();

  if (error) {
    // Surface the unique-violation as a clean 409 instead of a confusing 500.
    if (error.code === '23505') {
      return NextResponse.json({ error: `Tag with code "${code}" already exists` }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAdminAction({
    actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'create',
    targetType: 'admin_tag',
    targetId: data.id,
    targetLabel: data.label,
    after: data,
    request: req,
  });

  return NextResponse.json({ tag: data });
}
