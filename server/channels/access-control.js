/**
 * Channel Access Control
 *
 * Handles access control for channels, including:
 * - allowlist: Only approved senders can interact
 * - pairing: New senders must complete pairing process
 * - disabled: Channel is disabled
 *
 * Reference: Based on iMessage channel implementation from claude-plugins-official
 */

import { channelAccessDb } from '../database/db.js';

// Policy types
export const AccessPolicy = {
  ALLOWLIST: 'allowlist',
  PAIRING: 'pairing',
  DISABLED: 'disabled'
};

// Gate action types
export const GateAction = {
  DELIVER: 'deliver',
  DROP: 'drop',
  PAIR: 'pair'
};

// Pending pairing requests (in-memory, cleared on restart)
const pendingPairings = new Map(); // key: `${channelName}:${code}`
const PAIRING_CODE_LENGTH = 5;
const PAIRING_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/**
 * Generate a random pairing code
 * Format: 5 lowercase letters (excluding 'l' for readability)
 * @returns {string}
 */
function generatePairingCode() {
  const chars = 'abcdefghijkmnopqrstuvwxyz'; // excluding 'l'
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Gate check for incoming messages
 * @param {Object} input
 * @param {string} input.channelName - Channel name
 * @param {string} input.senderId - Sender identifier (e.g., phone number, email)
 * @param {string} input.chatId - External chat/channel ID
 * @param {boolean} input.isGroup - Whether this is a group chat
 * @param {string} input.text - Message text
 * @param {string} input.policy - Current access policy ('allowlist' | 'pairing' | 'disabled')
 * @returns {Object} Gate result { action: 'deliver' | 'drop' | 'pair', code?, isResend? }
 */
export function gate({ channelName, senderId, chatId, isGroup, text, policy = AccessPolicy.ALLOWLIST }) {
  // Normalize sender ID
  const normalizedSenderId = senderId.toLowerCase().trim();

  // Check if disabled
  if (policy === AccessPolicy.DISABLED) {
    return { action: GateAction.DROP };
  }

  // Get current access entry
  const accessEntry = channelAccessDb.getAccess(channelName, normalizedSenderId);

  // Check if explicitly allowed
  if (accessEntry?.policy === 'allow') {
    return { action: GateAction.DELIVER };
  }

  // Check if explicitly blocked
  if (accessEntry?.policy === 'block') {
    return { action: GateAction.DROP };
  }

  // Handle group chats
  if (isGroup) {
    // For groups, check if there's a group policy (not implemented yet)
    // For now, drop unknown group messages
    return { action: GateAction.DROP };
  }

  // Handle DM policy
  if (policy === AccessPolicy.ALLOWLIST) {
    // Allowlist mode: drop if not explicitly allowed
    return { action: GateAction.DROP };
  }

  if (policy === AccessPolicy.PAIRING) {
    // Check for existing pending pairing
    const pendingKey = `${channelName}:${normalizedSenderId}`;
    const existingPending = pendingPairings.get(pendingKey);

    if (existingPending) {
      // Check if expired
      if (Date.now() > existingPending.expiresAt) {
        pendingPairings.delete(pendingKey);
      } else {
        // Already pending, resend code if replies < 2
        if (existingPending.replies < 2) {
          existingPending.replies++;
          return {
            action: GateAction.PAIR,
            code: existingPending.code,
            isResend: true
          };
        }
        // Too many reminders, drop
        return { action: GateAction.DROP };
      }
    }

    // Check global pending limit (max 3 per channel)
    const channelPendingCount = Array.from(pendingPairings.values())
      .filter(p => p.channelName === channelName && p.expiresAt > Date.now())
      .length;

    if (channelPendingCount >= 3) {
      return { action: GateAction.DROP };
    }

    // Create new pairing request
    const code = generatePairingCode();
    const now = Date.now();

    pendingPairings.set(pendingKey, {
      channelName,
      senderId: normalizedSenderId,
      chatId,
      code,
      createdAt: now,
      expiresAt: now + PAIRING_EXPIRY_MS,
      replies: 1
    });

    return {
      action: GateAction.PAIR,
      code,
      isResend: false
    };
  }

  return { action: GateAction.DROP };
}

/**
 * Verify a pairing code
 * @param {string} channelName - Channel name
 * @param {string} senderId - Sender identifier
 * @param {string} code - Pairing code to verify
 * @returns {boolean} Whether the code is valid
 */
export function verifyPairingCode(channelName, senderId, code) {
  const normalizedSenderId = senderId.toLowerCase().trim();
  const pendingKey = `${channelName}:${normalizedSenderId}`;
  const pending = pendingPairings.get(pendingKey);

  if (!pending) {
    return false;
  }

  if (Date.now() > pending.expiresAt) {
    pendingPairings.delete(pendingKey);
    return false;
  }

  if (pending.code.toLowerCase() !== code.toLowerCase().trim()) {
    return false;
  }

  // Pairing successful - add to allowlist
  channelAccessDb.setAccess(channelName, normalizedSenderId, 'user', 'allow');
  pendingPairings.delete(pendingKey);

  return true;
}

/**
 * Add a sender to the allowlist
 * @param {string} channelName - Channel name
 * @param {string} senderId - Sender identifier
 * @param {string} senderType - 'user' or 'group'
 */
export function allowSender(channelName, senderId, senderType = 'user') {
  const normalizedSenderId = senderId.toLowerCase().trim();
  channelAccessDb.setAccess(channelName, normalizedSenderId, senderType, 'allow');
}

/**
 * Remove a sender from the allowlist
 * @param {string} channelName - Channel name
 * @param {string} senderId - Sender identifier
 */
export function removeSender(channelName, senderId) {
  const normalizedSenderId = senderId.toLowerCase().trim();
  channelAccessDb.deleteAccess(channelName, normalizedSenderId);
}

/**
 * Check if a sender is allowed
 * @param {string} channelName - Channel name
 * @param {string} senderId - Sender identifier
 * @returns {boolean}
 */
export function isSenderAllowed(channelName, senderId) {
  const normalizedSenderId = senderId.toLowerCase().trim();
  const accessEntry = channelAccessDb.getAccess(channelName, normalizedSenderId);
  return accessEntry?.policy === 'allow';
}

/**
 * Get all allowed senders for a channel
 * @param {string} channelName - Channel name
 * @returns {string[]} Array of sender IDs
 */
export function getAllowedSenders(channelName) {
  return channelAccessDb.getAllowedSenders(channelName);
}

/**
 * Get access list for a channel
 * @param {string} channelName - Channel name
 * @returns {Object[]} Array of access entries
 */
export function getChannelAccessList(channelName) {
  return channelAccessDb.getAllAccess(channelName);
}

/**
 * Clean up expired pending pairings
 */
export function cleanupExpiredPairings() {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, pending] of pendingPairings) {
    if (now > pending.expiresAt) {
      pendingPairings.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[AccessControl] Cleaned up ${cleaned} expired pairing requests`);
  }
}

// Schedule periodic cleanup (every 10 minutes)
setInterval(cleanupExpiredPairings, 10 * 60 * 1000);

/**
 * Permission reply regex
 * Matches: "yes xxxxx" or "no xxxxx" where xxxxx is 5 lowercase letters
 * Reference: claude-plugins-official iMessage implementation
 */
export const PERMISSION_REPLY_REGEX = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;

/**
 * Check if text is a permission reply
 * @param {string} text - Message text
 * @returns {Object|null} { behavior: 'allow' | 'deny', requestId } or null
 */
export function parsePermissionReply(text) {
  const match = PERMISSION_REPLY_REGEX.exec(text);
  if (!match) return null;

  return {
    behavior: match[1].toLowerCase().startsWith('y') ? 'allow' : 'deny',
    requestId: match[2].toLowerCase()
  };
}
