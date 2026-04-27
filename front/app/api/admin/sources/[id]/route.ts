import { NextRequest, NextResponse } from 'next/server';
import { updateAdminSource } from '@/lib/scraping';

function checkToken(req: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return true;
  const header = req.headers.get('x-admin-token');
  const query = req.nextUrl.searchParams.get('token');
  return header === expected || query === expected;
}

interface PatchBody {
  active?: boolean;
  config?: unknown;
  notes?: string | null;
  description?: string | null;
  instagramUrl?: string | null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validar config — debe ser objeto serializable.
  if (body.config !== undefined) {
    try {
      JSON.stringify(body.config);
    } catch {
      return NextResponse.json({ error: 'config no es JSON serializable' }, { status: 400 });
    }
  }

  const patch = {
    active: typeof body.active === 'boolean' ? body.active : undefined,
    config: body.config,
    notes: body.notes,
    description: body.description,
    instagramUrl: body.instagramUrl,
  };

  const updated = await updateAdminSource(numericId, patch);
  if (!updated) {
    return NextResponse.json({ error: 'Sin cambios o source no encontrado' }, { status: 404 });
  }

  return NextResponse.json({ source: updated });
}
