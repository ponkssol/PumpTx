import type { Metadata } from 'next';
import type { RecentBuySummary, Transaction } from '@/lib/db';
import { getRecentBuysSameMint, getTxBySignature } from '@/lib/db';
import TxClient from '../_components/TxClient';

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

export async function generateMetadata({ params }: { params: { signature: string } }): Promise<Metadata> {
  const signature = decodeURIComponent(params.signature);
  const tx = getTxBySignature(signature);

  if (!tx) {
    return {
      title: 'Transaction not found — PumpTx',
      description: 'Transaction not found',
    };
  }

  const metadataBase = new URL(process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000');
  const image = toAbsoluteUrl(tx.image_url ?? null) ?? toAbsoluteUrl(tx.token_icon_url ?? null);
  const canonical = new URL(`/tx/${encodeURIComponent(signature)}`, metadataBase).toString();
  const tokenName = tx.token_name || tx.token_symbol || 'Token';
  const title = `PUMPTX — BUY DETECTED | ${tokenName}`;
  const description = `New buy transaction • Amount: ${tx.sol_spent} SOL • Token: ${tx.token_symbol || tokenName}`.trim();

  return {
    metadataBase,
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: canonical,
      images: image
        ? [
            {
              url: image,
              width: 1200,
              height: 630,
              alt: `PUMPTX — BUY DETECTED | ${tokenName}`,
            },
          ]
        : undefined,
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
