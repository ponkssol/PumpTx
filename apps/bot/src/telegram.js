const fs = require('fs');
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
} = require('./db');

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const pollingEnabled = String(process.env.TELEGRAM_ENABLE_POLLING || 'true').toLowerCase() !== 'false';
const bot = token ? new TelegramBot(token, { polling: pollingEnabled }) : null;

const AUTHOR_GITHUB_URL = 'https://github.com/ponkssol';
const BOT_BRAND = 'PumpTX';
const defaultGroupMinSol = Number(process.env.DEFAULT_GROUP_MIN_SOL || process.env.MIN_BUY_SOL || 0);
const defaultGroupMinMcap = Number(process.env.DEFAULT_GROUP_MIN_MCAP || 0);
const welcomeImageUrl = process.env.TELEGRAM_WELCOME_IMAGE_URL || '';
const settingImageUrl = process.env.TELEGRAM_SETTING_IMAGE_URL || welcomeImageUrl;
const groupReadyImageUrl = process.env.TELEGRAM_GROUP_READY_IMAGE_URL || '';
const pendingSettingsInput = new Map();
/** @type {Map<string, { groupChatId: string|number, messageId: number, userId: string|number, expiresAt: number }>} */
const pendingGroupReadyUi = new Map();
/** @type {Map<string, string>} messageKey -> token (at most one active token per group greeting message) */
const pendingGroupReadyUiByMessageKey = new Map();

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

/** @returns {Promise<string|null>} */
async function getBotUsername() {
  if (!bot) return null;
  try {
    const me = await bot.getMe();
    return me && me.username ? String(me.username) : null;
  } catch (_) {
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
  await registerTelegramGroup({
    groupId,
    groupTitle: chat.title || groupId,
    ownerUserId: String((from && from.id) || ''),
    ownerUsername: from && from.username ? String(from.username) : null,
    minSol: defaultGroupMinSol,
    minMcap: defaultGroupMinMcap,
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
  const addUrl = buildAddToGroupUrl(username);
  const keyboard = [];
  if (addUrl) {
    keyboard.push([{ text: '➕ Add me to your Group', url: addUrl }]);
  }
  keyboard.push([{ text: '⚙️ Open Setting', callback_data: 'private_open_group_list' }]);

  await sendRichCard(
    privateChatId,
    `👋 <b>Welcome to ${BOT_BRAND}</b>\n\nGet fast BUY alerts with per-group filters.\nAdd the bot to your group, then continue setup.\n\nPlease set the bot as admin for reliable alert delivery.`,
    {
      imageUrl: welcomeImageUrl,
      reply_markup: { inline_keyboard: keyboard },
    },
  );
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
      imageUrl: settingImageUrl,
      reply_markup: { inline_keyboard: keyboard },
    },
  );
}

/**
 * @param {number|string} chatIdValue
 * @param {{ group_id: string, group_title: string, min_sol: number, min_mcap: number, is_active: number }} group
 */
async function sendPrivateSettingMenu(chatIdValue, group) {
  const minSol = Number(group && group.min_sol ? group.min_sol : 0);
  const minMcap = Number(group && group.min_mcap ? group.min_mcap : 0);
  const statusText = Number(group && group.is_active) === 1 ? 'active' : 'inactive';
  await bot.sendMessage(
    chatIdValue,
    `⚙️ <b>${BOT_BRAND} Settings</b>\nGroup: <b>${escHtml(group.group_title || group.group_id)}</b>\nStatus: <b>${statusText}</b>\n\n💸 Min Buy Solana: <code>${minSol}</code>\n📈 Min Market Cap (USD): <code>${minMcap}</code>`,
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
 * @param {number|string} privateChatId
 * @param {string|number} ownerUserId
 */
async function sendPrivateGroupPicker(privateChatId, ownerUserId) {
  const groups = await getTelegramGroupsByOwner(String(ownerUserId));
  if (!groups.length) {
    await bot.sendMessage(
      privateChatId,
      'No groups found for this account.\nAdd the bot to a group first, then open settings again.',
    );
    return;
  }
  const keyboard = groups.map((g) => [
    {
      text: `${Number(g.is_active) === 1 ? '🟢' : '⚪'} ${g.group_title || g.group_id}`,
      callback_data: `pick_group:${g.group_id}`,
    },
  ]);
  await bot.sendMessage(
    privateChatId,
    `Select a group to configure in ${BOT_BRAND}:`,
    { reply_markup: { inline_keyboard: keyboard } },
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
  const username = await getBotUsername();
  const keyboard = [[{ text: '⚙️ Setting', callback_data: `group_open_setting:${groupId}` }]];
  const sent = await sendRichCard(
    groupChatId,
    `✅ <b>${BOT_BRAND} added to the group successfully!</b>\n\nStatus: <b>inactive</b>. Open Settings to configure and activate this group.`,
    {
      imageUrl: groupReadyImageUrl,
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
        const openKeyboard = { inline_keyboard: [[{ text: `⚙️ Open ${BOT_BRAND} (private)`, url: https }]] };
        if (sent.photo && sent.photo.length) {
          const cap = sent.caption || `✅ <b>${BOT_BRAND} added to the group successfully!</b>`;
          await bot.editMessageCaption(`${cap}\n\nTap <b>Open</b> below if Telegram Desktop did not switch chats automatically.`, {
            chat_id: groupChatId,
            message_id: sent.message_id,
            parse_mode: 'HTML',
            reply_markup: openKeyboard,
          });
        } else {
          const t = sent.text || `${BOT_BRAND}`;
          await bot.editMessageText(`${t}\n\nTap <b>Open</b> below if Telegram Desktop did not switch chats automatically.`, {
            chat_id: groupChatId,
            message_id: sent.message_id,
            parse_mode: 'HTML',
            reply_markup: openKeyboard,
          });
        }
      }
    }
  } catch (_) {
    // ignore: greeting still works with callback-only Setting
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

/**
 * @param {string|number} targetChatId
 * @param {string} cap
 * @param {string|Buffer|null} imagePathOrBuffer
 */
async function sendToChat(targetChatId, cap, imagePathOrBuffer) {
  if (!bot) return;
  if (Buffer.isBuffer(imagePathOrBuffer) && imagePathOrBuffer.length) {
    await bot.sendPhoto(targetChatId, imagePathOrBuffer, { caption: cap, parse_mode: 'HTML' });
  } else if (imagePathOrBuffer && typeof imagePathOrBuffer === 'string' && fs.existsSync(imagePathOrBuffer)) {
    await bot.sendPhoto(targetChatId, fs.createReadStream(imagePathOrBuffer), { caption: cap, parse_mode: 'HTML' });
  } else {
    await bot.sendMessage(targetChatId, cap, { parse_mode: 'HTML', disable_web_page_preview: false });
  }
}

/**
 * @param {object} buyData
 * @param {string|Buffer|null} imagePathOrBuffer — filesystem path or in-memory PNG (no disk).
 * @returns {Promise<number>} number of groups/chats notified
 */
async function notify(buyData, imagePathOrBuffer) {
  if (!bot) throw new Error('Telegram bot token is missing');
  const txSol = Number(buyData.solSpent || 0);
  const txMcap = Number(buyData.marketCapUsd || 0);
  const cap = buildCaption(buyData);
  const groups = await getActiveTelegramGroups();
  const sentTargets = new Set();
  let sent = 0;
  for (const group of groups) {
    if (!passGroupThreshold(txSol, txMcap, group)) continue;
    try {
      await sendToChat(group.group_id, cap, imagePathOrBuffer);
      sentTargets.add(String(group.group_id));
      sent += 1;
    } catch (err) {
      if (isChatUnavailableError(err)) {
        await deactivateTelegramGroup(String(group.group_id));
        log.warn(`Telegram target ${group.group_id} was disabled: ${err.message}`);
        continue;
      }
      throw err;
    }
  }
  if (chatId && !sentTargets.has(String(chatId))) {
    try {
      await sendToChat(chatId, cap, imagePathOrBuffer);
      sent += 1;
    } catch (err) {
      if (isChatUnavailableError(err)) {
        log.warn(`Legacy TELEGRAM_CHAT_ID is invalid; fallback target skipped: ${err.message}`);
      } else {
        throw err;
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
        await registerTelegramGroup({
          groupId,
          groupTitle,
          ownerUserId: String((from && from.id) || ''),
          ownerUsername: from && from.username ? String(from.username) : null,
          minSol: defaultGroupMinSol,
          minMcap: defaultGroupMinMcap,
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
            const memo = takeGroupReadyMessage(token);
            if (memo && String(memo.userId) === String(userIdValue)) {
              await deleteMessageSafe(memo.groupChatId, memo.messageId);
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
        if (command === 'setting' || command === 'menu') {
          await sendPrivateSettingCard(msg.chat.id, botUsername);
          await sendPrivateGroupPicker(msg.chat.id, userIdValue);
        }
        return;
      }

      if (chatType !== 'group' && chatType !== 'supergroup') return;

      if (command === 'start' && typeof msg.message_id === 'number') {
        await deleteMessageSafe(msg.chat.id, msg.message_id);
      }

      const members = Array.isArray(msg.new_chat_members) ? msg.new_chat_members : [];
      if (members.length) {
        const id = await getBotId();
        if (id && members.some((m) => m && m.id === id)) {
          const groupId = await registerGroup(msg.chat, msg.from || {});
          await sendGroupReadyCard(msg.chat.id, groupId, (msg.from && msg.from.id) || 0);
          return;
        }
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
        const token = createGroupReadyToken();
        const { https: httpsOpenUrl } = buildPrivateStartLinks(username, groupId, token);
        if (!httpsOpenUrl) {
          pendingGroupReadyUi.delete(token);
          await bot.answerCallbackQuery(query.id, { text: 'Bot username missing; cannot open private chat.' }).catch(() => {});
          return;
        }
        rememberGroupReadyMessage(token, {
          groupChatId: chatIdValue,
          messageId: msg.message_id,
          userId: fromId,
        });
        await bot.answerCallbackQuery(query.id, { text: 'Continue in private chat. Use Open if Desktop did not switch chats.' }).catch(() => {});

        if (httpsOpenUrl) {
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
            // ignore: user may not have started the bot yet; group message still has Open URL.
          }
          const edited = await (async () => {
            try {
              if (msg.photo && msg.photo.length) {
                const cap = msg.caption || `✅ <b>${BOT_BRAND} added to the group successfully!</b>`;
                await bot.editMessageCaption(
                  `${cap}\n\nTap <b>Open</b> below to continue in private chat (Telegram Desktop).`,
                  {
                    chat_id: chatIdValue,
                    message_id: msg.message_id,
                    parse_mode: 'HTML',
                    reply_markup: openKeyboard,
                  },
                );
                return true;
              }
              const text = msg.text || `${BOT_BRAND}`;
              await bot.editMessageText(
                `${text}\n\nTap <b>Open</b> below to continue in private chat (Telegram Desktop).`,
                {
                  chat_id: chatIdValue,
                  message_id: msg.message_id,
                  parse_mode: 'HTML',
                  reply_markup: openKeyboard,
                },
              );
              return true;
            } catch (_) {
              return false;
            }
          })();

          if (!edited) {
            revokeGroupReadyTokensForMessage(chatIdValue, msg.message_id);
            await deleteMessageSafe(chatIdValue, msg.message_id);
            /** @type {{ message_id: number }|null} */
            let resent = null;
            if (groupReadyImageUrl) {
              try {
                resent = await bot.sendPhoto(chatIdValue, groupReadyImageUrl, {
                  caption: `✅ <b>${BOT_BRAND}</b>\n\nTap <b>Open</b> below to continue in private chat.`,
                  parse_mode: 'HTML',
                  reply_markup: openKeyboard,
                });
              } catch (_) {
                resent = await bot.sendMessage(
                  chatIdValue,
                  `${BOT_BRAND}: tap Open to continue in private chat (Telegram Desktop).`,
                  { parse_mode: 'HTML', reply_markup: openKeyboard },
                ).catch(() => null);
              }
            } else {
              resent = await bot.sendMessage(
                chatIdValue,
                `${BOT_BRAND}: tap Open to continue in private chat (Telegram Desktop).`,
                { parse_mode: 'HTML', reply_markup: openKeyboard },
              ).catch(() => null);
            }
            if (resent && typeof resent.message_id === 'number') {
              rememberGroupReadyMessage(token, {
                groupChatId: chatIdValue,
                messageId: resent.message_id,
                userId: fromId,
              });
            }
          }
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
