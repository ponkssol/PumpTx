const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'public', 'generated');
const LOGO_PATH = path.join(__dirname, '..', 'templates', 'pumptx-logo.png');

/** Sora stack — no double quotes inside (breaks SVG attrs). */
const FONT = 'Sora, Segoe UI, system-ui, sans-serif';

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

/** Layout grid (px). */
const L = {
  pad: 48,
  colVal: 340,
  yTime: 46,
  ySym: 176,
  yName: 218,
  yMint: 252,
  yBuyLbl: 286,
  yHero: 354,
  yPillTop: 386,
  pillH: 60,
  pillPadX: 26,
  /** Tight stack under pill; baseline step (px). */
  yStat0: 454,
  statRow: 32,
  footerTop: H - 58,
  footerTextY: H - 18,
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
  if (!Number.isFinite(x) || x <= 0) return '—';
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
  const mintShort = clip(`${buyData.tokenMint.slice(0, 6)}…${buyData.tokenMint.slice(-6)}`, 44);
  const solNum = esc(formatSol(Number(buyData.solSpent)));
  const mcStr = formatMc(buyData.marketCapUsd);
  const tokAmt = esc(clipRaw(String(buyData.tokenAmount ?? '—'), 32));
  const buyer = esc(clipRaw(String(buyData.buyerWalletShort || ''), 44));
  const sigS = esc(clipRaw(String(buyData.signatureShort || buyData.signature || ''), 52));

  const pillW = W - L.pad * 2;
  const pillCenterY = L.yPillTop + L.pillH / 2;
  const pillTextY = pillCenterY + 7;

  const brandFallback = hasLogo
    ? ''
    : `<text x="${L.pad}" y="78" fill="${C.accent}" font-size="18" font-weight="800" font-family="${FONT}">[PumpTx]</text>`;

  const yTok = L.yStat0;
  const yBuy = L.yStat0 + L.statRow;
  const yTx = L.yStat0 + L.statRow * 2;

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
<text x="${L.pad}" y="${L.ySym}" fill="${C.accent}" font-size="15" font-weight="700" font-family="${FONT}" letter-spacing="0.12em">${esc(sym)}</text>
<text x="${L.pad}" y="${L.yName}" fill="${C.text}" font-size="36" font-weight="800" font-family="${FONT}" letter-spacing="-0.02em">${clip(tokenName, 22)}</text>
<text x="${L.pad}" y="${L.yMint}" fill="${C.textMuted}" font-size="16" font-weight="500" font-family="${FONT}">${mintShort}</text>
<text x="${L.pad}" y="${L.yBuyLbl}" fill="${C.textDim}" font-size="13" font-weight="700" font-family="${FONT}" letter-spacing="0.14em">BUY</text>
<text x="${L.pad}" y="${L.yHero}" font-family="${FONT}" font-weight="800">
<tspan fill="url(#heroSol)" font-size="64" letter-spacing="-0.03em">${solNum}</tspan><tspan fill="${C.accentMuted}" font-size="26" font-weight="700"> SOL</tspan>
</text>
<rect x="${L.pad}" y="${L.yPillTop}" rx="26" ry="26" width="${pillW}" height="${L.pillH}" fill="rgba(0,255,65,0.1)" stroke="rgba(0,255,65,0.32)" stroke-width="1"/>
<text x="${L.pad + L.pillPadX}" y="${pillTextY}" fill="#e8fff0" font-size="21" font-weight="700" font-family="${FONT}">Market cap · ${esc(mcStr)}</text>
<text x="${L.pad}" y="${yTok}" fill="${C.textMuted}" font-size="16" font-weight="700" font-family="${FONT}" letter-spacing="0.08em">TOKENS</text>
<text x="${L.colVal}" y="${yTok}" fill="${C.text}" font-size="22" font-weight="600" font-family="${FONT}">${tokAmt}</text>
<text x="${L.pad}" y="${yBuy}" fill="${C.textMuted}" font-size="16" font-weight="700" font-family="${FONT}" letter-spacing="0.08em">BUYER</text>
<text x="${L.colVal}" y="${yBuy}" fill="${C.text}" font-size="22" font-weight="600" font-family="${FONT}">${buyer}</text>
<text x="${L.pad}" y="${yTx}" fill="${C.textMuted}" font-size="16" font-weight="700" font-family="${FONT}" letter-spacing="0.08em">TX</text>
<text x="${L.colVal}" y="${yTx}" fill="${C.text}" font-size="21" font-weight="600" font-family="${FONT}">${sigS}</text>
<rect x="0" y="${L.footerTop}" width="${W}" height="58" fill="rgba(0,0,0,0.5)"/>
<text x="${L.pad}" y="${L.footerTextY}" fill="${C.textDim}" font-size="12" font-family="${FONT}">${clip(`pump.fun/coin/${buyData.tokenMint}`, 82)}</text>
<text x="${rx}" y="${L.footerTextY}" text-anchor="end" fill="${C.accent}" font-size="13" font-weight="700" font-family="${FONT}">PumpTx</text>
</svg>`;

  let pipeline = sharp(Buffer.from(body)).png();

  if (hasLogo) {
    const logoBuf = await sharp(LOGO_PATH).resize({ height: 42 }).ensureAlpha().png().toBuffer();
    pipeline = pipeline.composite([{ input: logoBuf, left: L.pad, top: 62 }]);
  }

  await pipeline.toFile(filePath);
  return { filePath, imageUrl: `${baseUrl}/generated/${fileName}` };
}

module.exports = { generateImage };
