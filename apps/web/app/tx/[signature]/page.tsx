import type { Metadata } from 'next';
import type { RecentBuySummary, Transaction } from '@/lib/db';
import { getRecentBuysSameMint, getTxBySignature } from '@/lib/db';
import TxClient from '../_components/TxClient';

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

export async function generateMetadata({ params }: { params: { signature: string } }): Promise<Metadata> {
  const signature = decodeURIComponent(params.signature);
  const tx = getTxBySignature(signature);

  if (!tx) {
    return {
      title: 'Transaction not found — PumpTx',
      description: 'Transaction not found',
    };
  }

  const image = toAbsoluteUrl(tx.image_url ?? tx.token_icon_url ?? null);
  const title = `${tx.token_symbol || tx.token_name || 'Transaction'} — PumpTx`;
  const description = `PumpFun BUY • ${tx.sol_spent} SOL • ${tx.token_amount} ${tx.token_symbol || ''}`.trim();
  const metadataBase = new URL(process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000');

  return {
    metadataBase,
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function TxPage({ params }: { params: { signature: string } }) {
  const signature = decodeURIComponent(params.signature);
  const tx = getTxBySignature(signature) ?? null;
  const recentSameMint: RecentBuySummary[] = tx
    ? getRecentBuysSameMint(tx.token_mint, tx.signature, 20)
    : [];

  return (
    <TxClient
      signature={signature}
      initialTx={tx as Transaction | null}
      initialRecentSameMint={recentSameMint}
    />
  );
}
