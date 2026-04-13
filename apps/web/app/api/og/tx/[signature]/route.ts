import { NextResponse } from 'next/server';
import { getTxBySignature } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function toAbsoluteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base =
    process.env.BOT_BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    'http://localhost:3000';
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

export async function GET(_: Request, ctx: { params: { signature: string } }) {
  const signature = decodeURIComponent(ctx.params.signature);
  const tx = getTxBySignature(signature);
  if (!tx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const upstream = toAbsoluteUrl(tx.image_url ?? tx.token_icon_url ?? null);
  if (!upstream) return NextResponse.json({ error: 'No image' }, { status: 404 });

  const res = await fetch(upstream, { cache: 'no-store' });
  if (!res.ok) return NextResponse.json({ error: 'Upstream image failed' }, { status: 502 });

  const contentType = res.headers.get('content-type') ?? 'image/png';
  const buf = Buffer.from(await res.arrayBuffer());
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}

