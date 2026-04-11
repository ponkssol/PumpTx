import { NextResponse } from 'next/server';
import { getRecentBuysSameMint, getTxBySignature } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_: Request, ctx: { params: { signature: string } }) {
  try {
    const tx = getTxBySignature(ctx.params.signature);
    if (!tx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const recent_same_mint = getRecentBuysSameMint(tx.token_mint, tx.signature, 20);
    return NextResponse.json({ ...tx, recent_same_mint });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'DB error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
