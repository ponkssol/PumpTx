import { NextResponse } from 'next/server';
import { getAllTx, getStats } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const transactions = getAllTx(50);
    const row = getStats();
    const stats = {
      total_transactions: row?.total_transactions ?? 0,
      total_sol_volume: row?.total_sol_volume ?? 0,
    };
    return NextResponse.json({ transactions, stats });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'DB error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
