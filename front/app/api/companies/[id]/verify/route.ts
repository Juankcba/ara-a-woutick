import { NextRequest, NextResponse } from 'next/server';
import { updateCompanyField, type VerifiableField } from '@/lib/leads';

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
  // Al menos uno de los dos debe estar.
  verified?: boolean;
  value?: string | null;
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
  if (body.verified === undefined && body.value === undefined) {
    return NextResponse.json({ error: 'pasar al menos verified o value' }, { status: 400 });
  }
  if (body.verified !== undefined && typeof body.verified !== 'boolean') {
    return NextResponse.json({ error: 'verified debe ser boolean' }, { status: 400 });
  }
  if (body.value !== undefined && body.value !== null && typeof body.value !== 'string') {
    return NextResponse.json({ error: 'value debe ser string o null' }, { status: 400 });
  }

  const patch: { value?: string | null; verified?: boolean } = {};
  if (body.value !== undefined) patch.value = body.value;
  if (body.verified !== undefined) patch.verified = body.verified;

  const result = await updateCompanyField(numericId, body.field as VerifiableField, patch);
  if (!result.updated) {
    return NextResponse.json({ error: 'Company no encontrada' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
