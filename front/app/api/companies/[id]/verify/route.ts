import { NextRequest, NextResponse } from 'next/server';
import { setCompanyVerified, type VerifiableField } from '@/lib/leads';

const VALID_FIELDS: VerifiableField[] = [
  'website',
  'email',
  'phone',
  'linkedin',
  'instagram',
  'facebook',
  'twitter',
];

interface PatchBody {
  field?: string;
  verified?: boolean;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  if (!body.field || !(VALID_FIELDS as readonly string[]).includes(body.field)) {
    return NextResponse.json(
      { error: `field debe ser uno de: ${VALID_FIELDS.join(', ')}` },
      { status: 400 },
    );
  }
  if (typeof body.verified !== 'boolean') {
    return NextResponse.json({ error: 'verified debe ser boolean' }, { status: 400 });
  }

  const result = await setCompanyVerified(numericId, body.field as VerifiableField, body.verified);
  if (!result.updated) {
    return NextResponse.json({ error: 'Company no encontrada' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
