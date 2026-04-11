const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'public', 'generated');
const LOGO_PATH = path.join(__dirname, '..', 'templates', 'pumptx-logo.png');

/** Sora stack — no double quotes inside (breaks SVG attrs). */
const FONT = 'Sora, Segoe UI, system-ui, sans-serif';
/** Monospace for full mint in CA card. */
const FONT_MONO = 'Consolas, ui-monospace, SFMono-Regular, monospace';

const W = 1200;
const H = 630;

/** Theme-aligned with apps/web globals (dark + #00ff41). */
const C = {
  bg0: '#030303',
  bg1: '#060606',
  bg2: '#0a0a0a',
  text: '#f4f4f4',
  textMuted: '#9a9a9a',
  textDim: '#6a6a6a',
  accent: '#00ff41',
  accentMuted: '#00c936',
  border: '#1f1f1f',
};

/** Base layout (px); final Ys computed in generateImage so gaps never overlap glyphs. */
const L = {
  pad: 48,
  yTime: 46,
  pillPadX: 24,
  statRow: 36,
  statCardPadTop: 26,
  statCardPadBottom: 18,
  statInnerPad: 20,
  statLabelColW: 100,
  statValueGap: 16,
  footerBarH: 72,
  footerTextInsetY: 28,
};

/** @param {string} t */
function esc(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** @param {string} s @param {number} max */
function clip(s, max) {
  const t = String(s);
  if (t.length <= max) return esc(t);
  return esc(`${t.slice(0, max - 1)}…`);
}

/** @param {string} s @param {number} max */
function clipRaw(s, max) {
  const t = String(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** @param {number} n */
function formatMc(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 'N/A';
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}M`;
  if (x >= 1000) return `$${Math.round(x / 1000)}K`;
  return `$${Math.round(x)}`;
}

/** @param {number} n */
function formatSol(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return '0';
  const s = x.toFixed(4);
  const [intPart, dec] = s.split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec ? `${withCommas}.${dec}` : withCommas;
}

/**
 * @param {object} buyData
 * @returns {Promise<{filePath: string, imageUrl: string}>}
 */
async function generateImage(buyData) {
  const baseUrl = (process.env.BOT_BASE_URL || `http://localhost:${process.env.BOT_PORT || 4000}`).replace(/\/$/, '');
  fs.mkdirSync(OUT, { recursive: true });
  const ts = Math.floor(Date.now() / 1000);
  const m8 = buyData.tokenMint.slice(0, 8);
  const fileName = `${ts}_${m8}.png`;
  const filePath = path.join(OUT, fileName);
  const hasLogo = fs.existsSync(LOGO_PATH);

  const rx = W - L.pad;
  const tokenName = String(buyData.tokenName || 'Token').toUpperCase();
  const sym = String(buyData.tokenSymbol || '???').toUpperCase();
  const showSym = sym !== '???' && sym !== tokenName;
  const mintFull = esc(String(buyData.tokenMint || ''));
  const solNum = esc(formatSol(Number(buyData.solSpent)));
  const mcStr = formatMc(buyData.marketCapUsd);
  const tokAmt = esc(clipRaw(String(buyData.tokenAmount ?? '—'), 32));
  const buyer = esc(clipRaw(String(buyData.buyerWalletShort || ''), 44));
  const sigS = esc(clipRaw(String(buyData.signatureShort || buyData.signature || ''), 52));

  /** Left edge for amount + MC/CA + stat row (matches Bought/SOL card). */
  const contentAlignX = L.pad - 10;
  const innerW = W - contentAlignX - L.pad;
  const cardGap = 12;
  const mcCardW = Math.min(320, Math.floor(innerW * 0.3));
  const caCardW = innerW - mcCardW - cardGap;
  const mcCardX = contentAlignX;
  const caCardX = contentAlignX + mcCardW + cardGap;
  const footerTop = H - L.footerBarH;
  const footerTextY = H - L.footerTextInsetY;

  /** Stack baselines top→bottom; nudged down for balance (full CA lives in pill row, not under title). */
  let y = 178;
  const Y = {};
  if (showSym) {
    Y.ySym = y;
    y += 38;
  }
  Y.yName = y;
  /* Space below 36px title before the amount card (avoids overlap with “Bought”). */
  y += 58;
  Y.yBuyLbl = y;
  /* “Bought” line + gap before 60px SOL numerals. */
  y += 62;
  Y.yHero = y;
  y += 48;
  Y.yPillTop = y;
  Y.pillH = 44;
  const pillEnd = Y.yPillTop + Y.pillH;
  const gapAfterPill = 6;
  const statCardTop = pillEnd + gapAfterPill;
  const statFirstBaselineLead = 20;
  Y.yStat0 = statCardTop + statFirstBaselineLead;
  const yTok = Y.yStat0;
  const yBuy = Y.yStat0 + L.statRow;
  const yTx = Y.yStat0 + L.statRow * 2;
  /** Slight nudge so 20px values optically center with 13px labels on same row. */
  const vDy = 2;
  const statCardH = yTx - statCardTop + 14 + L.statCardPadBottom + vDy;

  const statLabelX = contentAlignX + L.statInnerPad;
  const statValueX = statLabelX + L.statLabelColW + L.statValueGap;
  const statCardW = innerW;

  const pillTextY = Y.yPillTop + Y.pillH / 2 + 5;

  /** Single card wrapping “Bought” label + SOL line (aligned insets, balanced padding). */
  const amountPadX = 22;
  const amountTextX = contentAlignX + amountPadX;
  const amountCardX = contentAlignX;
  const amountCardTop = Y.yBuyLbl - 22;
  const amountCardBottom = Y.yHero + 26;
  const amountCardH = amountCardBottom - amountCardTop;
  const amountCardW = Math.min(528, innerW);

  const brandFallback = hasLogo
    ? ''
    : `<text x="${L.pad}" y="78" fill="${C.accent}" font-size="18" font-weight="800" font-family="${FONT}">[PumpTx]</text>`;

  const symSvg = showSym
    ? `<text x="${L.pad}" y="${Y.ySym}" fill="${C.accent}" font-size="15" font-weight="700" font-family="${FONT}" letter-spacing="0.12em">${esc(sym)}</text>`
    : '';

  const defs = `<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${C.bg0}"/>
<stop offset="38%" stop-color="${C.bg1}"/>
<stop offset="100%" stop-color="${C.bg2}"/>
</linearGradient>
<radialGradient id="accentGlow" cx="82%" cy="12%" r="0.55">
<stop offset="0%" stop-color="#003d12" stop-opacity="0.65"/>
<stop offset="35%" stop-color="${C.accent}" stop-opacity="0.09"/>
<stop offset="100%" stop-color="${C.bg0}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="floorGlow" cx="50%" cy="100%" r="0.7">
<stop offset="0%" stop-color="#001a08" stop-opacity="0.75"/>
<stop offset="55%" stop-color="${C.bg0}" stop-opacity="0"/>
</radialGradient>
<linearGradient id="veil" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="#020202" stop-opacity="0.82"/>
<stop offset="52%" stop-color="#020202" stop-opacity="0.22"/>
<stop offset="100%" stop-color="#020202" stop-opacity="0"/>
</linearGradient>
<linearGradient id="heroSol" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#8dffac"/>
<stop offset="48%" stop-color="${C.accent}"/>
<stop offset="100%" stop-color="#009928"/>
</linearGradient>
<linearGradient id="amountCardFill" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#06180d" stop-opacity="0.94"/>
<stop offset="55%" stop-color="#030a06" stop-opacity="0.97"/>
<stop offset="100%" stop-color="#020403" stop-opacity="0.99"/>
</linearGradient>
<linearGradient id="boughtLabel" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="#5cff8f"/>
<stop offset="100%" stop-color="${C.accent}"/>
</linearGradient>
</defs>`;

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
${defs}
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#accentGlow)"/>
<rect width="${W}" height="${H}" fill="url(#floorGlow)"/>
<rect width="${W}" height="${H}" fill="url(#veil)"/>
${brandFallback}
<text x="${rx}" y="${L.yTime}" text-anchor="end" fill="${C.textMuted}" font-size="13" font-weight="500" font-family="${FONT}">${esc(buyData.timestamp)}</text>
${symSvg}
<text x="${L.pad}" y="${Y.yName}" fill="${C.text}" font-size="36" font-weight="800" font-family="${FONT}" letter-spacing="-0.02em">${clip(tokenName, 22)}</text>
<rect x="${amountCardX}" y="${amountCardTop}" rx="5" ry="5" width="${amountCardW}" height="${amountCardH}" fill="url(#amountCardFill)" stroke="rgba(0,255,65,0.28)" stroke-width="1"/>
<text x="${amountTextX}" y="${Y.yBuyLbl}" fill="url(#boughtLabel)" font-size="16" font-weight="800" font-family="${FONT}" letter-spacing="0.04em">Bought</text>
<text x="${amountTextX}" y="${Y.yHero}" font-family="${FONT}" font-weight="800">
<tspan fill="url(#heroSol)" font-size="60" letter-spacing="-0.035em">${solNum}</tspan><tspan fill="${C.accentMuted}" font-size="24" font-weight="700" dx="10">SOL</tspan>
</text>
<rect x="${mcCardX}" y="${Y.yPillTop}" rx="4" ry="4" width="${mcCardW}" height="${Y.pillH}" fill="rgba(0,255,65,0.1)" stroke="rgba(0,255,65,0.32)" stroke-width="1"/>
<rect x="${caCardX}" y="${Y.yPillTop}" rx="4" ry="4" width="${caCardW}" height="${Y.pillH}" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
<text x="${mcCardX + L.pillPadX}" y="${pillTextY}" fill="#e8fff0" font-size="18" font-weight="700" font-family="${FONT}">Market cap · ${esc(mcStr)}</text>
<text x="${caCardX + L.pillPadX}" y="${pillTextY}" fill="${C.text}" font-size="14" font-weight="600" font-family="${FONT_MONO}" letter-spacing="-0.01em">${mintFull}</text>
<rect x="${contentAlignX}" y="${statCardTop}" rx="4" ry="4" width="${statCardW}" height="${statCardH}" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
<text x="${statLabelX}" y="${yTok}" fill="${C.textDim}" font-size="13" font-weight="700" font-family="${FONT}" letter-spacing="0.12em">TOKENS</text>
<text x="${statValueX}" y="${yTok + vDy}" fill="${C.text}" font-size="20" font-weight="600" font-family="${FONT}" font-variant-numeric="tabular-nums">${tokAmt}</text>
<text x="${statLabelX}" y="${yBuy}" fill="${C.textDim}" font-size="13" font-weight="700" font-family="${FONT}" letter-spacing="0.12em">BUYER</text>
<text x="${statValueX}" y="${yBuy + vDy}" fill="${C.text}" font-size="20" font-weight="600" font-family="${FONT}" font-variant-numeric="tabular-nums">${buyer}</text>
<text x="${statLabelX}" y="${yTx}" fill="${C.textDim}" font-size="13" font-weight="700" font-family="${FONT}" letter-spacing="0.12em">TX</text>
<text x="${statValueX}" y="${yTx + vDy}" fill="${C.text}" font-size="20" font-weight="600" font-family="${FONT}" font-variant-numeric="tabular-nums">${sigS}</text>
<rect x="0" y="${footerTop}" width="${W}" height="${L.footerBarH}" fill="rgba(0,0,0,0.62)"/>
<text x="${L.pad}" y="${footerTextY}" fill="${C.textMuted}" font-size="13" font-weight="500" font-family="${FONT}">${clip(`pump.fun/coin/${buyData.tokenMint}`, 76)}</text>
<text x="${rx}" y="${footerTextY}" text-anchor="end" fill="${C.accent}" font-size="13" font-weight="700" font-family="${FONT}">PumpTx</text>
</svg>`;

  let pipeline = sharp(Buffer.from(body)).png();

  if (hasLogo) {
    const logoBuf = await sharp(LOGO_PATH).resize({ height: 26 }).ensureAlpha().png().toBuffer();
    pipeline = pipeline.composite([{ input: logoBuf, left: L.pad, top: 56 }]);
  }

  await pipeline.toFile(filePath);
  return { filePath, imageUrl: `${baseUrl}/generated/${fileName}` };
}

module.exports = { generateImage };
