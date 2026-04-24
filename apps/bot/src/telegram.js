const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const log = require('./logger');
const { formatMarketCapUsd } = require('./format-mc');
const { formatSolAmount } = require('./format-sol');
const {
  registerTelegramGroup,
  activateTelegramGroup,
  deactivateTelegramGroup,
  deleteTelegramGroupPermanently,
  updateTelegramGroupThreshold,
  getTelegramGroupById,
  getTelegramGroupsByOwner,
  getActiveTelegramGroups,
  updateTelegramGroupUrl,
  setTelegramGroupWelcomeMessageId,
} = require('./db');

/** Official PumpTx channel/group in .env; trimmed. User-registered active groups are handled separately. */
const rawOfficialTg = process.env.TELEGRAM_CHAT_ID;
const officialTelegramChatId = rawOfficialTg && String(rawOfficialTg).trim() ? String(rawOfficialTg).trim() : null;
const pollingEnabled = String(process.env.TELEGRAM_ENABLE_POLLING || 'true').toLowerCase() !== 'false';

// Interactive bot: /start, /menu, /setting, callbacks, group join lifecycle (polling).
// Prefer TELEGRAM_BOT_TOKEN_GENERAL; fall back to TELEGRAM_BOT_TOKEN for old deployments.
const generalToken = String(
  process.env.TELEGRAM_BOT_TOKEN_GENERAL || process.env.TELEGRAM_BOT_TOKEN || '',
).trim();
const alertToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const useSeparateAlertBot = Boolean(alertToken && generalToken && alertToken !== generalToken);
const bot = generalToken ? new TelegramBot(generalToken, { polling: pollingEnabled }) : null;
// Outgoing BUY alerts only (no second polling loop if token differs from general).
const botAlert = useSeparateAlertBot ? new TelegramBot(alertToken, { polling: false }) : null;

/** Official / team channel: prefer the dedicated alert token when configured. */
function getAlertSender() {
  return botAlert || bot;
}

/**
 * User supergroups register with the "general" bot (polling). The optional `botAlert` is often
 * not a member of those groups, so we must post with `bot` first; fall back to alert for single-token setups.
 * @returns {import('node-telegram-bot-api')|null}
 */
function getUserGroupSender() {
  return bot || botAlert;
}

const AUTHOR_GITHUB_URL = 'https://github.com/ponkssol';
const BOT_BRAND = 'PumpTX';
const defaultGroupMinSol = Number(process.env.DEFAULT_GROUP_MIN_SOL || process.env.MIN_BUY_SOL || 0);
const defaultGroupMinMcap = Number(process.env.DEFAULT_GROUP_MIN_MCAP || 0);
/** Same rules as per-group `min_sol`: only share to `TELEGRAM_CHAT_ID` when solSpent >= this. */
const legacyChatMinBuySol = Number(process.env.MIN_BUY_SOL || 0);
const welcomeImageUrl = process.env.TELEGRAM_WELCOME_IMAGE_URL || '';
const settingImageUrlEnv = process.env.TELEGRAM_SETTING_IMAGE_URL || '';
const groupReadyImageUrl = process.env.TELEGRAM_GROUP_READY_IMAGE_URL || '';

const publicDir = path.join(__dirname, '../public');
const publicWelcomePng = path.join(publicDir, 'welcome.png');
const publicSettingPng = path.join(publicDir, 'setting.png');
const publicSettingsPng = path.join(publicDir, 'settings.png');

/** @param {string} envVal @param {string} localFile @returns {string} */
function resolveCardImageEnvOrLocal(envVal, localFile) {
  const e = envVal && String(envVal).trim();
  if (e) return e;
  if (localFile && fs.existsSync(localFile)) return localFile;
  return '';
}

function getWelcomeCardImage() {
  return resolveCardImageEnvOrLocal(welcomeImageUrl, publicWelcomePng);
}

function getSettingCardImage() {
  const fromEnv = settingImageUrlEnv && String(settingImageUrlEnv).trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync(publicSettingPng)) return publicSettingPng;
  if (fs.existsSync(publicSettingsPng)) return publicSettingsPng;
  const w = welcomeImageUrl && String(welcomeImageUrl).trim();
  return w || '';
}

/** Group join card: optional dedicated env, else same as welcome card. */
function getGroupReadyCardImage() {
  const g = groupReadyImageUrl && String(groupReadyImageUrl).trim();
  if (g) return g;
  return getWelcomeCardImage();
}

const WELCOME_CARD_CAPTION = `👋 <b>Welcome to ${BOT_BRAND}</b>\n\nGet fast BUY alerts with per-group filters.\nAdd the bot to your group, then continue setup.\n\nPlease set the bot as admin for reliable alert delivery.`;

/** @param {string|null} username */
function buildWelcomeInlineKeyboard(username) {
  const addUrl = buildAddToGroupUrl(username);
  const keyboard = [];
  if (addUrl) {
    keyboard.push([{ text: '➕ Add me to your Group', url: addUrl }]);
  }
  keyboard.push([{ text: '⚙️ Open Setting', callback_data: 'private_open_group_list' }]);
  return { inline_keyboard: keyboard };
}

/**
 * @param {number|string} chatIdValue
 * @param {string|null} username
 */
async function sendWelcomeRichCard(chatIdValue, username) {
  return sendRichCard(chatIdValue, WELCOME_CARD_CAPTION, {
    imageUrl: getWelcomeCardImage(),
    reply_markup: buildWelcomeInlineKeyboard(username),
  });
}
const pendingSettingsInput = new Map();
/** @type {Map<string, { groupChatId: string|number, messageId: number, userId: string|number, expiresAt: number }>} */
const pendingGroupReadyUi = new Map();
/** @type {Map<string, string>} messageKey -> token (at most one active token per group greeting message) */
const pendingGroupReadyUiByMessageKey = new Map();
/** Last "Welcome to PumpTX" card message_id per group (removed before join success card). */
/** @type {Map<string, number>} */
const lastGroupWelcomeMessageId = new Map();

/** Legacy: old join cards used callback "Open" (gpo:). Prefer t.me url buttons for one-tap private chat. */
const CB_OPEN_PRIVATE_PREFIX = 'gpo:';

/**
 * @param {string|number} chatIdValue
 * @param {unknown} sent
 */
async function rememberGroupWelcomeMessage(chatIdValue, sent) {
  if (!sent || typeof sent !== 'object' || typeof sent.message_id !== 'number') return;
  const sid = String(chatIdValue);
  lastGroupWelcomeMessageId.set(sid, sent.message_id);
  try {
    await setTelegramGroupWelcomeMessageId(sid, sent.message_id);
  } catch (_) {
    // DB row may not exist yet; in-memory is enough until register completes.
  }
}

/**
 * Deletes the stored "Welcome to PumpTX" group card (memory + DB) so it is gone before the join-success message.
 * @param {string|number} chatIdValue
 */
async function deleteStoredGroupWelcomeIfAny(chatIdValue) {
  const id = String(chatIdValue);
  let mid = lastGroupWelcomeMessageId.get(id);
  if (typeof mid !== 'number') {
    const row = await getTelegramGroupById(id);
    if (row && row.welcome_message_id != null) {
      const n = Number(row.welcome_message_id);
      if (Number.isFinite(n)) mid = n;
    }
  }
  if (typeof mid !== 'number' || !Number.isFinite(mid)) return;
  lastGroupWelcomeMessageId.delete(id);
  try {
    await setTelegramGroupWelcomeMessageId(id, null);
  } catch (_) {
    // ignore
  }
  await deleteMessageSafe(chatIdValue, mid);
}

/** @param {string|number} groupChatId @param {number} messageId */
function groupReadyMessageKey(groupChatId, messageId) {
  return `${String(groupChatId)}:${String(messageId)}`;
}

/**
 * @param {string|number} groupChatId
 * @param {number} messageId
 */
function revokeGroupReadyTokensForMessage(groupChatId, messageId) {
  const messageKey = groupReadyMessageKey(groupChatId, messageId);
  const mappedToken = pendingGroupReadyUiByMessageKey.get(messageKey);
  if (mappedToken) {
    pendingGroupReadyUi.delete(mappedToken);
    pendingGroupReadyUiByMessageKey.delete(messageKey);
  }
}

/** @type {Promise<number|null>|null} */
let botIdPromise = null;

function getBotId() {
  if (!bot) return Promise.resolve(null);
  if (!botIdPromise) {
    botIdPromise = bot.getMe().then((me) => me.id).catch(() => null);
  }
  return botIdPromise;
}

/**
 * @returns {Promise<string|null>} Used for t.me/… deep links; must be the **general** (interactive) bot.
 * Set TELEGRAM_BOT_USERNAME in .env (without @) if getMe is unreliable.
 */
async function getBotUsername() {
  const fromEnv = String(process.env.TELEGRAM_BOT_USERNAME || '')
    .replace(/^@/, '')
    .trim();
  if (fromEnv) return fromEnv;
  if (!bot) return null;
  try {
    const me = await bot.getMe();
    return me && me.username ? String(me.username) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Resolves a stable web/open link for the group: public supergroups use t.me/username;
 * private groups use the primary invite link (requires bot admin).
 * @param {string|number} groupChatId
 * @param {{ username?: string }} chat
 * @returns {Promise<string|null>}
 */
async function resolveTelegramGroupUrl(groupChatId, chat) {
  if (!bot) return null;
  const raw = chat && chat.username ? String(chat.username).replace(/^@/, '') : '';
  if (raw) {
    return `https://t.me/${encodeURIComponent(raw)}`;
  }
  try {
    const link = await bot.exportChatInviteLink(groupChatId);
    return link ? String(link).trim() : null;
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    log.warn(`exportChatInviteLink failed for ${groupChatId}: ${msg}`);
    return null;
  }
}

/** @param {string} s */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** @param {string} text */
function parseCommand(text) {
  if (!text) return null;
  const match = String(text).trim().match(/^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s|$)/);
  return match ? match[1].toLowerCase() : null;
}

/** @param {string} text */
function parseCommandPayload(text) {
  if (!text) return '';
  const match = String(text).trim().match(/^\/[a-zA-Z0-9_]+(?:@[a-zA-Z0-9_]+)?(?:\s+(.+))?$/);
  return match && match[1] ? String(match[1]).trim() : '';
}

/**
 * Parses generic numeric input (supports comma decimal separators).
 * @param {string} raw
 * @returns {number|null}
 */
function parseNumericInput(raw) {
  const normalized = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * Parses market cap input like "$6K", "6k", "6000" into absolute USD.
 * @param {string} raw
 * @returns {number|null}
 */
function parseMarketCapInput(raw) {
  const normalized = String(raw).trim().toLowerCase().replace(/\$/g, '').replace(/,/g, '').replace(/\s+/g, '');
  const match = normalized.match(/^(\d*\.?\d+)([kmb])?$/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2] || '';
  const multiplier = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1;
  return Math.round(base * multiplier);
}

/**
 * @param {{ id: string|number, title?: string, type?: string }} chat
 * @param {{ id?: string|number, username?: string }} from
 */
async function registerGroup(chat, from) {
  const groupId = String(chat.id);
  const groupUrl = await resolveTelegramGroupUrl(chat.id, chat);
  await registerTelegramGroup({
    groupId,
    groupTitle: chat.title || groupId,
    ownerUserId: String((from && from.id) || ''),
    ownerUsername: from && from.username ? String(from.username) : null,
    minSol: defaultGroupMinSol,
    minMcap: defaultGroupMinMcap,
    groupUrl,
  });
  return groupId;
}

/**
 * @param {number|string} chatIdValue
 * @param {string} text
 * @param {object} [options]
 */
async function sendRichCard(chatIdValue, text, options = {}) {
  const imageUrl = options.imageUrl ? String(options.imageUrl) : '';
  const messageOptions = {
    parse_mode: 'HTML',
    ...(options.reply_markup ? { reply_markup: options.reply_markup } : {}),
    ...(options.disable_web_page_preview ? { disable_web_page_preview: true } : {}),
  };
  if (imageUrl) {
    return bot.sendPhoto(chatIdValue, imageUrl, { caption: text, ...messageOptions });
  }
  return bot.sendMessage(chatIdValue, text, messageOptions);
}

/**
 * Silently deletes a Telegram message when possible.
 * @param {number|string} chatIdValue
 * @param {number} messageId
 * @returns {Promise<void>}
 */
async function deleteMessageSafe(chatIdValue, messageId) {
  if (!bot) return;
  try {
    await bot.deleteMessage(chatIdValue, String(messageId));
  } catch (_) {
    // Ignore delete failures (permissions, already deleted, etc).
  }
}

/**
 * Checks whether a user is admin/creator in a group.
 * @param {number|string} chatIdValue
 * @param {number|string} userIdValue
 * @returns {Promise<boolean>}
 */
async function isGroupAdmin(chatIdValue, userIdValue) {
  if (!bot) return false;
  try {
    const member = await bot.getChatMember(chatIdValue, Number(userIdValue));
    const status = member && member.status ? String(member.status) : '';
    return status === 'administrator' || status === 'creator';
  } catch (_) {
    return false;
  }
}

/** @param {string|null} username */
function buildAddToGroupUrl(username) {
  if (!username) return null;
  return `https://t.me/${username}?startgroup=setup`;
}

/**
 * Deep links to open the bot private chat with a /start payload.
 * Prefer `https://t.me/...` for Telegram Desktop compatibility (opens inside Telegram app when possible).
 * @param {string|null} username
 * @param {string} groupId
 * @param {string} [readyToken]
 * @returns {{ https: string|null, startPayload: string }}
 */
function buildPrivateStartLinks(username, groupId, readyToken) {
  const startPayload = readyToken
    ? `gr_${readyToken}`
    : `continue_${encodeURIComponent(groupId)}`;
  if (!username) {
    return { https: null, startPayload };
  }
  const u = String(username).replace(/^@/, '');
  return {
    https: `https://t.me/${encodeURIComponent(u)}?start=${encodeURIComponent(startPayload)}`,
    startPayload,
  };
}

/**
 * @param {number|string} privateChatId
 * @param {string|null} username
 */
async function sendPrivateWelcomeCard(privateChatId, username) {
  await sendWelcomeRichCard(privateChatId, username);
}

/**
 * @param {number|string} privateChatId
 * @param {string|null} username
 */
async function sendPrivateSettingCard(privateChatId, username) {
  const addUrl = buildAddToGroupUrl(username);
  const keyboard = [[{ text: '⚙️ Choose Group for Settings', callback_data: 'private_open_group_list' }]];
  if (addUrl) {
    keyboard.push([{ text: '➕ Add me to your Group', url: addUrl }]);
  }
  await sendRichCard(
    privateChatId,
    `⚙️ <b>${BOT_BRAND} Settings</b>\n\nSelect a group to configure:\n• Min Buy Solana\n• Min Market Cap (USD)`,
    {
      imageUrl: getSettingCardImage(),
      reply_markup: { inline_keyboard: keyboard },
    },
  );
}

/**
 * @param {number|string} chatIdValue
 * @param {{ group_id: string, group_title: string, min_sol: number, min_mcap: number, is_active: number, group_url?: string|null }} group
 */
async function sendPrivateSettingMenu(chatIdValue, group) {
  const minSol = Number(group && group.min_sol ? group.min_sol : 0);
  const minMcap = Number(group && group.min_mcap ? group.min_mcap : 0);
  const statusText = Number(group && group.is_active) === 1 ? 'active' : 'inactive'; 
  await bot.sendMessage(
    chatIdValue,
    `⚙️ <b>${BOT_BRAND} Settings</b>\nGroup: <b>${escHtml(group.group_title || group.group_id)}</b>\nStatus: <b>${statusText}</b>\n💸 Min Buy Solana: <code>${minSol}</code>\n📈 Min Market Cap (USD): <code>${minMcap}</code>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '▶️ Start Group', callback_data: `private_start_group:${group.group_id}` },
            { text: '⏸ Stop Group', callback_data: `private_stop_group:${group.group_id}` },
          ],
          [{ text: `💸 Min Buy Solana (${minSol})`, callback_data: `setting_min_sol:${group.group_id}` }],
          [{ text: `📈 Min Market Cap (${minMcap} USD)`, callback_data: `setting_min_mcap:${group.group_id}` }],
          [{ text: '🗑 Delete Group Permanently', callback_data: `private_delete_group:${group.group_id}` }],
          [{ text: '⬅️ Back', callback_data: 'private_setting_back' }],
        ],
      },
    },
  );
}

/**
 * @param {string|number} chatIdValue
 * @param {string|number} userIdValue
 */
function pendingKey(chatIdValue, userIdValue) {
  return `${chatIdValue}:${userIdValue}`;
}

/** @returns {string} */
function createGroupReadyToken() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {string} token
 * @param {{ groupChatId: string|number, messageId: number, userId: string|number }} payload
 */
function rememberGroupReadyMessage(token, payload) {
  const ttlMs = 1000 * 60 * 60 * 24;
  const messageKey = groupReadyMessageKey(payload.groupChatId, payload.messageId);
  for (const [mk, mappedToken] of pendingGroupReadyUiByMessageKey.entries()) {
    if (mappedToken === token && mk !== messageKey) {
      pendingGroupReadyUiByMessageKey.delete(mk);
    }
  }
  revokeGroupReadyTokensForMessage(payload.groupChatId, payload.messageId);
  pendingGroupReadyUiByMessageKey.set(messageKey, token);
  pendingGroupReadyUi.set(token, {
    ...payload,
    expiresAt: Date.now() + ttlMs,
  });
}

/** @param {string} token */
function peekGroupReadyMessage(token) {
  const row = pendingGroupReadyUi.get(token);
  if (!row) return null;
  if (Date.now() > row.expiresAt) return null;
  return row;
}

/** @param {string} token */
function takeGroupReadyMessage(token) {
  const row = pendingGroupReadyUi.get(token);
  pendingGroupReadyUi.delete(token);
  if (!row) return null;
  if (Date.now() > row.expiresAt) return null;
  const messageKey = groupReadyMessageKey(row.groupChatId, row.messageId);
  const mapped = pendingGroupReadyUiByMessageKey.get(messageKey);
  if (mapped === token) pendingGroupReadyUiByMessageKey.delete(messageKey);
  return row;
}

/** @param {string} groupId */
function clearPendingInputsForGroup(groupId) {
  for (const [key, state] of pendingSettingsInput.entries()) {
    if (state && String(state.groupId) === String(groupId)) {
      pendingSettingsInput.delete(key);
    }
  }
}

/** @param {unknown} err */
function isChatUnavailableError(err) {
  const msg = err && err.message ? String(err.message).toLowerCase() : '';
  return (
    msg.includes('chat not found')
    || msg.includes('bot was kicked')
    || msg.includes('forbidden')
    || msg.includes('chat is deactivated')
  );
}

/**
 * True when the bot is not yet allowed to DM the user (must /start in private, or t.me first).
 * @param {unknown} e
 * @returns {boolean}
 */
function isCannotMessageUserInPrivateError(e) {
  const desc =
    (e
      && e.response
      && e.response.body
      && (e.response.body.description || e.response.body.error_message)
      && String(e.response.body.description || e.response.body.error_message))
    || (e && e.message && String(e.message))
    || '';
  const m = String(desc).toLowerCase();
  if (
    /forbidden: bot can'?t initiate|have no chat|cannot initiate|user is deactivated|blocked|chat not found|need the user'?s|start the chat/i.test(
      m,
    )
  ) {
    return true;
  }
  const bodyCode = e && e.response && e.response.body && e.response.body.error_code;
  const c = e && (e.code || bodyCode || (e.response && (e.response.statusCode || e.response.status)));
  if (c === 403) return true;
  return false;
}

/**
 * @param {number|string} privateChatId
 * @param {string|number} ownerUserId
 */
async function sendPrivateGroupPicker(privateChatId, ownerUserId) {
  const groups = await getTelegramGroupsByOwner(String(ownerUserId));
  const settingImg = getSettingCardImage();
  if (!groups.length) {
    await sendRichCard(
      privateChatId,
      'No groups found for this account.\nAdd the bot to a group first, then open settings again.',
      { imageUrl: settingImg },
    );
    return;
  }
  const keyboard = groups.map((g) => [
    {
      text: `${Number(g.is_active) === 1 ? '🟢' : '⚪'} ${g.group_title || g.group_id}`,
      callback_data: `pick_group:${g.group_id}`,
    },
  ]);
  await sendRichCard(
    privateChatId,
    `Select a group to configure in ${BOT_BRAND}:`,
    {
      imageUrl: settingImg,
      reply_markup: { inline_keyboard: keyboard },
    },
  );
}

/**
 * @param {string|number} ownerUserId
 * @param {string} groupId
 * @returns {boolean}
 */
async function ownerHasGroupAccess(ownerUserId, groupId) {
  const groups = await getTelegramGroupsByOwner(String(ownerUserId));
  return groups.some((g) => String(g.group_id) === String(groupId));
}

/**
 * @param {number|string} groupChatId
 * @param {string} groupId
 */
async function sendGroupReadyCard(groupChatId, groupId, fromUserId) {
  await deleteStoredGroupWelcomeIfAny(groupChatId);
  const username = await getBotUsername();
  const keyboard = [[{ text: '⚙️ Setting', callback_data: `group_open_setting:${groupId}` }]];
  const sent = await sendRichCard(
    groupChatId,
    `✅ <b>${BOT_BRAND} added to the group successfully!</b>\n\nStatus: <b>active</b> (BUY alerts on while thresholds are met). Open Settings to change Min SOL / Min MCAP or pause.`,
    {
      imageUrl: getGroupReadyCardImage(),
      reply_markup: { inline_keyboard: keyboard },
    },
  );
  try {
    if (sent && typeof sent.message_id === 'number' && username && fromUserId) {
      const token = createGroupReadyToken();
      rememberGroupReadyMessage(token, {
        groupChatId,
        messageId: sent.message_id,
        userId: fromUserId,
      });
      const { https } = buildPrivateStartLinks(username, groupId, token);
      if (https) {
        // URL button: one tap opens private chat with this (general) bot and passes start=gr_… (works without prior /start).
        const openKeyboard = {
          inline_keyboard: [
            [{ text: `⚙️ Open ${BOT_BRAND} (private)`, url: https }],
            [{ text: '⚙️ Setting', callback_data: `group_open_setting:${groupId}` }],
          ],
        };
        if (sent.photo && sent.photo.length) {
          const cap = sent.caption || `✅ <b>${BOT_BRAND} added to the group successfully!</b>`;
          await bot.editMessageCaption(
            `${cap}\n\nTap <b>Open ${BOT_BRAND} (private)</b> to open a chat with the bot; your settings will load there (this group message is removed when you start in private).`,
            {
              chat_id: groupChatId,
              message_id: sent.message_id,
              parse_mode: 'HTML',
              reply_markup: openKeyboard,
            },
          );
        } else {
          const t = sent.text || `${BOT_BRAND}`;
          await bot.editMessageText(
            `${t}\n\nTap <b>Open ${BOT_BRAND} (private)</b> to open a chat with the bot; your settings will load there (this group message is removed when you start in private).`,
            {
              chat_id: groupChatId,
              message_id: sent.message_id,
              parse_mode: 'HTML',
              reply_markup: openKeyboard,
            },
          );
        }
      }
    }
  } catch (_) {
    // ignore: greeting still works with Setting only
  }
}

/**
 * @param {object} buyData
 * @returns {string}
 */
function buildCaption(buyData) {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const detailUrl = `${base}/tx/${buyData.signature}`;
  const mint = buyData.tokenMint || '';
  return [
    `🚀 <b>${BOT_BRAND} — BUY DETECTED</b>`,
    '',
    `🏛️ <b>${escHtml(buyData.tokenName)}</b> (<code>${escHtml(buyData.tokenSymbol)}</code>)`,
    `💰 <b>SOL:</b> <code>${escHtml(formatSolAmount(buyData.solSpent))} SOL</code>`,
    `📊 <b>MC:</b> <code>${escHtml(formatMarketCapUsd(buyData.marketCapUsd))}</code>`, 
    `📋 <b>CA:</b> <code>${escHtml(mint)}</code>`,
    `👛 <b>Buyer:</b> <code>${escHtml(buyData.buyerWallet || buyData.buyerWalletShort || '')}</code>`,
    `🕒 ${buyData.timestamp}`,
    '',
    `🔗 <a href="${buyData.pumpFunUrl}">PumpFun</a> | <a href="${buyData.solscanUrl}">Solscan</a> | <a href="${detailUrl}">PumpTx Detail</a>`,
    '',
    `<i>powered by PumpTx · by <a href="${AUTHOR_GITHUB_URL}">ponks</a></i>`,
  ].join('\n');
}

/**
 * @param {number} txSol
 * @param {number} txMcap
 * @param {{ min_sol: number, min_mcap: number }} group
 * @returns {boolean}
 */
function passGroupThreshold(txSol, txMcap, group) {
  return txSol >= Number(group.min_sol || 0) && txMcap >= Number(group.min_mcap || 0);
}

/** @param {string|number|undefined} id */
function normChatId(id) {
  if (id === undefined || id === null) return '';
  return String(id).trim();
}

/**
 * @param {import('node-telegram-bot-api')|null|undefined} tg
 * @param {string|number} targetChatId
 * @param {string} cap
 * @param {string|Buffer|null} imagePathOrBuffer
 */
async function sendToChatWith(tg, targetChatId, cap, imagePathOrBuffer) {
  if (!tg) return;
  if (Buffer.isBuffer(imagePathOrBuffer) && imagePathOrBuffer.length) {
    await tg.sendPhoto(targetChatId, imagePathOrBuffer, { caption: cap, parse_mode: 'HTML' });
  } else if (imagePathOrBuffer && typeof imagePathOrBuffer === 'string' && fs.existsSync(imagePathOrBuffer)) {
    await tg.sendPhoto(targetChatId, fs.createReadStream(imagePathOrBuffer), { caption: cap, parse_mode: 'HTML' });
  } else {
    await tg.sendMessage(targetChatId, cap, { parse_mode: 'HTML', disable_web_page_preview: false });
  }
}

/**
 * Delivers to (1) every is_active=1 row in `telegram_groups` (any owner) using each group’s
 * `min_sol` / `min_mcap`, and (2) optional official destination `TELEGRAM_CHAT_ID` with `MIN_BUY_SOL`
 * when that ID is not already covered as an “active user group” (if it is, only that group’s
 * settings apply; no second looser post).
 *
 * @param {object} buyData
 * @param {string|Buffer|null} imagePathOrBuffer — filesystem path or in-memory PNG (no disk).
 * @returns {Promise<number>} number of groups/chats notified
 */
async function notify(buyData, imagePathOrBuffer) {
  if (!getUserGroupSender() && !getAlertSender()) {
    throw new Error('Telegram bot token is missing (set TELEGRAM_BOT_TOKEN and/or TELEGRAM_BOT_TOKEN_GENERAL)');
  }
  const userSender = getUserGroupSender();
  const txSol = Number(buyData.solSpent || 0);
  const txMcap = Number(buyData.marketCapUsd || 0);
  const cap = buildCaption(buyData);
  const groups = await getActiveTelegramGroups();
  const sentChatIds = new Set();
  let sent = 0;

  // (1) User-registered supergroups (all owners, each with own thresholds while active)
  for (const group of groups) {
    if (!passGroupThreshold(txSol, txMcap, group)) continue;
    if (!userSender) continue;
    const gid = normChatId(group.group_id);
    try {
      await sendToChatWith(userSender, gid, cap, imagePathOrBuffer);
      sentChatIds.add(gid);
      sent += 1;
    } catch (err) {
      if (isChatUnavailableError(err)) {
        await deactivateTelegramGroup(String(group.group_id));
        log.warn(`Telegram target ${group.group_id} was disabled: ${err.message}`);
        continue;
      }
      log.warn(`Telegram send failed for group ${group.group_id}: ${err && err.message ? err.message : err}`);
    }
  }

  // (2) Official channel / group: use alert token (add that bot to the channel), MIN_BUY_SOL when not a managed group row
  const officialSender = getAlertSender();
  if (officialTelegramChatId && officialSender) {
    const off = normChatId(officialTelegramChatId);
    if (sentChatIds.has(off)) {
      // Already delivered under per-group rules (same id as a registered group row).
    } else {
      const inDbAsActive = groups.some((g) => normChatId(g.group_id) === off);
      if (inDbAsActive) {
        // This ID is a user-registered group: we only use (1), not a looser official threshold.
      } else if (txSol >= legacyChatMinBuySol) {
        try {
          await sendToChatWith(officialSender, officialTelegramChatId, cap, imagePathOrBuffer);
          sent += 1;
        } catch (err) {
          if (isChatUnavailableError(err)) {
            log.warn(`TELEGRAM_CHAT_ID (official) is invalid; target skipped: ${err.message}`);
          } else {
            throw err;
          }
        }
      }
    }
  }
  return sent;
}

/**
 * Registers/deactivates group records as bot is added/removed from groups.
 */
function setupTelegramGroupLifecycle() {
  if (!bot || !pollingEnabled) return;

  bot.on('my_chat_member', async (update) => {
    try {
      const chat = update && update.chat;
      const from = update && update.from;
      const oldStatus = update && update.old_chat_member && update.old_chat_member.status;
      const newStatus = update && update.new_chat_member && update.new_chat_member.status;
      if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;
      const groupId = String(chat.id);
      const groupTitle = chat.title || groupId;
      if (newStatus === 'member' || newStatus === 'administrator') {
        const groupUrl = await resolveTelegramGroupUrl(chat.id, chat);
        await registerTelegramGroup({
          groupId,
          groupTitle,
          ownerUserId: String((from && from.id) || ''),
          ownerUsername: from && from.username ? String(from.username) : null,
          minSol: defaultGroupMinSol,
          minMcap: defaultGroupMinMcap,
          groupUrl,
        });
      }
      if (
        (oldStatus === 'member' || oldStatus === 'administrator')
        && (newStatus === 'left' || newStatus === 'kicked')
      ) {
        await deactivateTelegramGroup(groupId);
      }
    } catch (_) {
      // Ignore lifecycle handler errors so listener keeps running.
    }
  });

  bot.on('message', async (msg) => {
    try {
      if (!msg || !msg.chat) return;
      const chatType = msg.chat.type;
      const text = msg.text ? String(msg.text).trim() : '';
      const command = parseCommand(text);

      if (chatType === 'private') {
        if (!msg.from) return;
        const userIdValue = msg.from.id;
        const botUsername = await getBotUsername();
        const key = pendingKey(msg.chat.id, userIdValue);
        const pending = pendingSettingsInput.get(key);
        if (pending) {
          if (!(await ownerHasGroupAccess(userIdValue, pending.groupId))) {
            pendingSettingsInput.delete(key);
            await bot.sendMessage(msg.chat.id, 'Invalid group access. Please choose a group again via /setting.');
            return;
          }
          const value = pending.field === 'min_mcap' ? parseMarketCapInput(text) : parseNumericInput(text);
          if (!Number.isFinite(value) || value < 0) {
            const hint = pending.field === 'min_mcap'
              ? 'Invalid input. Use values like 6000, 6k, or $6K.'
              : 'Invalid input. Enter a number >= 0, e.g. 1.5';
            await bot.sendMessage(msg.chat.id, hint);
            return;
          }
          await updateTelegramGroupThreshold(pending.groupId, pending.field, value);
          pendingSettingsInput.delete(key);
          const updatedGroup = await getTelegramGroupById(pending.groupId);
          if (!updatedGroup) {
            await bot.sendMessage(msg.chat.id, 'Group not found.');
            return;
          }
          const label = pending.field === 'min_sol' ? 'Min Buy Solana' : 'Min Market Cap (USD)';
          await bot.sendMessage(
            msg.chat.id,
            `✅ ${label} for <b>${escHtml(updatedGroup.group_title || updatedGroup.group_id)}</b> was updated to <code>${value}</code>.`,
            { parse_mode: 'HTML' },
          );
          await sendPrivateSettingMenu(msg.chat.id, updatedGroup);
          return;
        }

        if (!command) return;
        const payload = parseCommandPayload(text);
        if (command === 'start') {
          if (payload === 'setting') {
            await sendPrivateSettingCard(msg.chat.id, botUsername);
            await sendPrivateGroupPicker(msg.chat.id, userIdValue);
            return;
          }
          if (payload.startsWith('gr_')) {
            const token = payload.slice('gr_'.length);
            const memo = peekGroupReadyMessage(token);
            if (memo && String(memo.userId) === String(userIdValue)) {
              await deleteMessageSafe(memo.groupChatId, memo.messageId);
              takeGroupReadyMessage(token);
              const group = await getTelegramGroupById(String(memo.groupChatId));
              if (group && (await ownerHasGroupAccess(userIdValue, group.group_id))) {
                await sendPrivateSettingMenu(msg.chat.id, group);
                return;
              }
            }
            await sendPrivateSettingCard(msg.chat.id, botUsername);
            await sendPrivateGroupPicker(msg.chat.id, userIdValue);
            return;
          }
          if (payload.startsWith('continue_')) {
            const groupId = decodeURIComponent(payload.slice('continue_'.length));
            if (await ownerHasGroupAccess(userIdValue, groupId)) {
              const group = await getTelegramGroupById(groupId);
              if (group) {
                await sendPrivateSettingMenu(msg.chat.id, group);
                return;
              }
            }
            await sendPrivateSettingCard(msg.chat.id, botUsername);
            await sendPrivateGroupPicker(msg.chat.id, userIdValue);
            return;
          }
          await sendPrivateWelcomeCard(msg.chat.id, botUsername);
          return;
        }
        if (command === 'menu') {
          await sendPrivateWelcomeCard(msg.chat.id, botUsername);
          return;
        }
        if (command === 'setting') {
          await sendPrivateSettingCard(msg.chat.id, botUsername);
          await sendPrivateGroupPicker(msg.chat.id, userIdValue);
        }
        return;
      }

      if (chatType !== 'group' && chatType !== 'supergroup') return;

      const members = Array.isArray(msg.new_chat_members) ? msg.new_chat_members : [];
      if (members.length) {
        const id = await getBotId();
        if (id && members.some((m) => m && m.id === id)) {
          await deleteStoredGroupWelcomeIfAny(msg.chat.id);
          const groupId = await registerGroup(msg.chat, msg.from || {});
          await sendGroupReadyCard(msg.chat.id, groupId, (msg.from && msg.from.id) || 0);
          return;
        }
      }

      if (command === 'start') {
        if (typeof msg.message_id === 'number') {
          await deleteMessageSafe(msg.chat.id, msg.message_id);
        }
        const botUsername = await getBotUsername();
        const sent = await sendWelcomeRichCard(msg.chat.id, botUsername);
        await rememberGroupWelcomeMessage(msg.chat.id, sent);
        return;
      }
      if (command === 'menu') {
        const botUsername = await getBotUsername();
        const sent = await sendWelcomeRichCard(msg.chat.id, botUsername);
        await rememberGroupWelcomeMessage(msg.chat.id, sent);
        return;
      }
      if (command === 'setting') {
        const botUsername = await getBotUsername();
        const gid = String(msg.chat.id);
        const addUrl = buildAddToGroupUrl(botUsername);
        const settingKb = [[{ text: '⚙️ Setting', callback_data: `group_open_setting:${gid}` }]];
        if (addUrl) {
          settingKb.push([{ text: '➕ Add me to your Group', url: addUrl }]);
        }
        await sendRichCard(
          msg.chat.id,
          `⚙️ <b>${BOT_BRAND} Settings</b>\n\nConfigure this group in private chat — tap Setting below.`,
          {
            imageUrl: getSettingCardImage(),
            reply_markup: { inline_keyboard: settingKb },
          },
        );
        return;
      }
    } catch (_) {
      // Ignore message handler errors so listener keeps running.
    }
  });

  bot.on('callback_query', async (query) => {
    try {
      if (!query || !query.message || !query.message.chat) return;
      const chat = query.message.chat;
      const chatIdValue = chat.id;
      const fromId = query.from && query.from.id;
      const data = query.data || '';
      const chatType = chat.type;

      if (!fromId) return;

      if (chatType === 'private') {
        if (data === 'private_open_group_list') {
          await bot.answerCallbackQuery(query.id);
          await sendPrivateGroupPicker(chatIdValue, fromId);
          return;
        }
        const startGroupPrefix = 'private_start_group:';
        const stopGroupPrefix = 'private_stop_group:';
        const deleteGroupPrefix = 'private_delete_group:';
        const deleteConfirmPrefix = 'private_delete_confirm:';
        const deleteCancelPrefix = 'private_delete_cancel:';
        if (data.startsWith(startGroupPrefix)) {
          const groupId = data.slice(startGroupPrefix.length);
          if (!(await ownerHasGroupAccess(fromId, groupId))) {
            await bot.answerCallbackQuery(query.id, { text: 'Access denied.' });
            return;
          }
          await activateTelegramGroup(groupId);
          try {
            const tchat = await bot.getChat(groupId);
            const url = await resolveTelegramGroupUrl(groupId, tchat);
            if (url) await updateTelegramGroupUrl(groupId, url);
          } catch (_) {
            // ignore: link may already exist from join, or export still not allowed
          }
          const updated = await getTelegramGroupById(groupId);
          await bot.answerCallbackQuery(query.id, { text: 'Group activated.' });
          if (updated) await sendPrivateSettingMenu(chatIdValue, updated);
          return;
        }
        if (data.startsWith(stopGroupPrefix)) {
          const groupId = data.slice(stopGroupPrefix.length);
          if (!(await ownerHasGroupAccess(fromId, groupId))) {
            await bot.answerCallbackQuery(query.id, { text: 'Access denied.' });
            return;
          }
          await deactivateTelegramGroup(groupId);
          const updated = await getTelegramGroupById(groupId);
          await bot.answerCallbackQuery(query.id, { text: 'Group stopped.' });
          if (updated) await sendPrivateSettingMenu(chatIdValue, updated);
          return;
        }
        if (data.startsWith(deleteGroupPrefix)) {
          const groupId = data.slice(deleteGroupPrefix.length);
          if (!(await ownerHasGroupAccess(fromId, groupId))) {
            await bot.answerCallbackQuery(query.id, { text: 'Access denied.' });
            return;
          }
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(
            chatIdValue,
            'Are you sure you want to permanently delete this group from PumpTX?',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '✅ Yes, Delete Permanently', callback_data: `private_delete_confirm:${groupId}` }],
                  [{ text: '❌ Cancel', callback_data: `private_delete_cancel:${groupId}` }],
                ],
              },
            },
          );
          return;
        }
        if (data.startsWith(deleteCancelPrefix)) {
          const groupId = data.slice(deleteCancelPrefix.length);
          if (!(await ownerHasGroupAccess(fromId, groupId))) {
            await bot.answerCallbackQuery(query.id, { text: 'Access denied.' });
            return;
          }
          const group = await getTelegramGroupById(groupId);
          await bot.answerCallbackQuery(query.id, { text: 'Deletion canceled.' });
          if (group) await sendPrivateSettingMenu(chatIdValue, group);
          return;
        }
        if (data.startsWith(deleteConfirmPrefix)) {
          const groupId = data.slice(deleteConfirmPrefix.length);
          if (!(await ownerHasGroupAccess(fromId, groupId))) {
            await bot.answerCallbackQuery(query.id, { text: 'Access denied.' });
            return;
          }
          const deleted = await deleteTelegramGroupPermanently(groupId);
          clearPendingInputsForGroup(groupId);
          if (deleted) {
            try {
              await bot.leaveChat(groupId);
            } catch (_) {
              // Ignore leave errors (already left, no permission, etc).
            }
          }
          await bot.answerCallbackQuery(query.id, { text: deleted ? 'Group deleted.' : 'Group not found.' });
          await sendPrivateGroupPicker(chatIdValue, fromId);
          return;
        }
        if (data.startsWith('pick_group:')) {
          const groupId = data.slice('pick_group:'.length);
          if (!(await ownerHasGroupAccess(fromId, groupId))) {
            await bot.answerCallbackQuery(query.id, { text: "You don't have access to this group." });
            return;
          }
          const group = await getTelegramGroupById(groupId);
          if (!group) {
            await bot.answerCallbackQuery(query.id, { text: 'Group not found.' });
            return;
          }
          await bot.answerCallbackQuery(query.id);
          await sendPrivateSettingMenu(chatIdValue, group);
          return;
        }

        if (data === 'private_setting_back') {
          await bot.answerCallbackQuery(query.id);
          await sendPrivateGroupPicker(chatIdValue, fromId);
          return;
        }

        const minSolPrefix = 'setting_min_sol:';
        const minMcapPrefix = 'setting_min_mcap:';
        const key = pendingKey(chatIdValue, fromId);
        if (data.startsWith(minSolPrefix)) {
          const groupId = data.slice(minSolPrefix.length);
          if (!(await ownerHasGroupAccess(fromId, groupId))) {
            await bot.answerCallbackQuery(query.id, { text: 'Access denied.' });
            return;
          }
          pendingSettingsInput.set(key, { field: 'min_sol', groupId });
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(chatIdValue, 'Enter Min Buy Solana value (number >= 0).');
          return;
        }
        if (data.startsWith(minMcapPrefix)) {
          const groupId = data.slice(minMcapPrefix.length);
          if (!(await ownerHasGroupAccess(fromId, groupId))) {
            await bot.answerCallbackQuery(query.id, { text: 'Access denied.' });
            return;
          }
          pendingSettingsInput.set(key, { field: 'min_mcap', groupId });
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(chatIdValue, 'Enter Min Market Cap in USD (examples: 6000, 6k, $6K).');
        }
        return;
      }

      if (chatType !== 'group' && chatType !== 'supergroup') return;
      if (data.startsWith(CB_OPEN_PRIVATE_PREFIX)) {
        const token = data.slice(CB_OPEN_PRIVATE_PREFIX.length);
        const memo = peekGroupReadyMessage(token);
        if (!memo) {
          await bot.answerCallbackQuery(query.id, { text: 'This link expired. Re-add the bot to get a new one.' }).catch(() => {});
          return;
        }
        if (String(memo.userId) !== String(fromId)) {
          await bot
            .answerCallbackQuery(query.id, { text: 'Only the user who added the bot can open private settings.' })
            .catch(() => {});
          return;
        }
        if (!query.message || typeof query.message.message_id !== 'number') {
          await bot.answerCallbackQuery(query.id, { text: 'Message unavailable.' }).catch(() => {});
          return;
        }
        await deleteMessageSafe(chatIdValue, query.message.message_id);
        const group = await getTelegramGroupById(String(memo.groupChatId));
        if (!group || !(await ownerHasGroupAccess(fromId, group.group_id))) {
          takeGroupReadyMessage(token);
          await bot.answerCallbackQuery(query.id, { text: 'Group not found.' }).catch(() => {});
          return;
        }
        // Do not takeGroupReadyMessage until private DM works, or the t.me?start=gr_ fallback must keep the token.
        try {
          await sendPrivateSettingMenu(fromId, group);
          takeGroupReadyMessage(token);
          await bot.answerCallbackQuery(query.id, { text: 'Settings sent in private.' }).catch(() => {});
        } catch (e) {
          if (isCannotMessageUserInPrivateError(e)) {
            const username = await getBotUsername();
            const { https } = buildPrivateStartLinks(username, String(group.group_id), token);
            if (https) {
              try {
                await bot.sendMessage(
                  chatIdValue,
                  `You haven’t started <b>${BOT_BRAND}</b> in private yet. Tap the button below to open a chat with the bot, then your settings will load (same as <code>/start</code> with a deep link).`,
                  {
                    parse_mode: 'HTML',
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: `⚙️ Open ${BOT_BRAND} (private)`, url: https }],
                      ],
                    },
                  },
                );
                await bot
                  .answerCallbackQuery(query.id, {
                    text: 'Use the “Open in private” button in this group, then your settings will appear in DM.',
                  })
                  .catch(() => {});
              } catch (sendErr) {
                log.warn(`gpo fallback in-group send failed: ${sendErr && sendErr.message ? sendErr.message : sendErr}`);
                await bot
                  .answerCallbackQuery(query.id, {
                    text: 'Set your bot’s @username in @BotFather, or open the bot in private and send /start first.',
                    show_alert: true,
                  })
                  .catch(() => {});
              }
            } else {
              log.warn('gpo: cannot DM and no t.me link — ensure the bot has a @username in BotFather');
              await bot
                .answerCallbackQuery(query.id, {
                  text: 'Open the bot in private and send /start, then return here and use Open again.',
                  show_alert: true,
                })
                .catch(() => {});
            }
            return;
          }
          log.warn(`sendPrivateSettingMenu after gpo: ${e && e.message ? e.message : e}`);
          takeGroupReadyMessage(token);
          await bot
            .answerCallbackQuery(query.id, {
              text: 'Could not open settings. Try /start the bot in private, then use Open in the group again.',
              show_alert: true,
            })
            .catch(() => {});
        }
        return;
      }
      const groupSettingPrefix = 'group_open_setting:';
      if (data.startsWith(groupSettingPrefix)) {
        const isAdmin = await isGroupAdmin(chatIdValue, fromId);
        if (!isAdmin) {
          await bot.answerCallbackQuery(query.id, {
            text: 'Only group admins can open settings.',
          }).catch(() => {});
          return;
        }
        const groupId = data.slice(groupSettingPrefix.length);
        if (!(await ownerHasGroupAccess(fromId, groupId))) {
          await bot.answerCallbackQuery(query.id, {
            text: 'Only the PumpTX-registered group owner can change settings.',
          }).catch(() => {});
          return;
        }
        const username = await getBotUsername();
        const msg = query.message;
        if (!msg || typeof msg.message_id !== 'number') {
          await bot.answerCallbackQuery(query.id, { text: 'Message unavailable. Re-add the bot or ask an admin to post setup again.' }).catch(() => {});
          return;
        }

        await deleteStoredGroupWelcomeIfAny(chatIdValue);
        revokeGroupReadyTokensForMessage(chatIdValue, msg.message_id);
        await deleteMessageSafe(chatIdValue, msg.message_id);

        const { https: httpsOpenUrl } = buildPrivateStartLinks(username, groupId);
        if (!httpsOpenUrl) {
          await bot.answerCallbackQuery(query.id, { text: 'Bot username missing; cannot open private chat.' }).catch(() => {});
          return;
        }

        await bot.answerCallbackQuery(query.id, { text: 'Continue in private chat. Use Open if Desktop did not switch chats.' }).catch(() => {});

        const openKeyboard = {
          inline_keyboard: [[{ text: `⚙️ Open ${BOT_BRAND} (private)`, url: httpsOpenUrl }]],
        };
        try {
          await bot.sendMessage(
            fromId,
            `Tap the button below to open <b>${BOT_BRAND}</b> private chat for this group.`,
            { parse_mode: 'HTML', reply_markup: openKeyboard },
          );
        } catch (_) {
          // ignore: user may not have started the bot yet.
        }
        return;
      }
      await bot.answerCallbackQuery(query.id).catch(() => {});
    } catch (_) {
      // Ignore callback errors so listener keeps running.
    }
  });
}

module.exports = { notify, setupTelegramGroupLifecycle };
