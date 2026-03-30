import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { userDb, channelTokenDb } from '../database/db.js';
import { JWT_SECRET } from '../middleware/auth.js';

// System user for channel service
export const SYSTEM_USER_ID = 0;
const SYSTEM_USERNAME = '__system__';

/**
 * Service Token Manager for Channel authentication
 *
 * Service Tokens are long-lived JWT tokens that allow Channel processes
 * to authenticate with the API without requiring user login.
 */

/**
 * Initialize the system user if it doesn't exist
 */
export function initializeSystemUser() {
  try {
    // Check if system user exists
    let systemUser = userDb.getUserById(SYSTEM_USER_ID);

    if (!systemUser) {
      // Create system user
      // Note: System user has no password and cannot be used for regular login
      const result = userDb.createSystemUser(SYSTEM_USER_ID, SYSTEM_USERNAME);
      console.log('[Channel] System user initialized:', SYSTEM_USERNAME);
      return result;
    }

    return systemUser;
  } catch (error) {
    console.error('[Channel] Failed to initialize system user:', error);
    throw error;
  }
}

/**
 * Get existing valid service token for a channel, or create a new one
 * @param {string} channelName - The name of the channel
 * @param {Object} options - Additional options
 * @returns {string} JWT token
 */
export function getOrCreateChannelServiceToken(channelName, options = {}) {
  // Check if there's already a valid token for this channel
  const existingToken = channelTokenDb.getValidTokenForChannel(channelName);

  if (existingToken) {
    // Verify the token is still valid (not expired, proper signature)
    const decoded = validateServiceToken(existingToken.token);
    if (decoded) {
      console.log(`[Channel] Reusing existing service token for channel: ${channelName}`);
      return existingToken.token;
    }
  }

  // No valid token found, create a new one
  return createChannelServiceToken(channelName, options);
}

/**
 * Generate a service token for a channel
 * @param {string} channelName - The name of the channel
 * @param {Object} options - Additional options
 * @returns {string} JWT token
 */
export function createChannelServiceToken(channelName, options = {}) {
  const tokenId = crypto.randomUUID();

  const payload = {
    type: 'service',
    tokenId,
    channel: channelName,
    userId: SYSTEM_USER_ID,
    username: SYSTEM_USERNAME,
    ...options
  };

  // Service tokens are valid for 365 days
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '365d' });

  // Store token metadata in database for revocation support
  channelTokenDb.createToken({
    tokenId,
    channelName,
    token, // Store hash only in production, but keeping full for now
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    isRevoked: false
  });

  console.log(`[Channel] New service token created for channel: ${channelName}`);

  return token;
}

/**
 * Validate a service token
 * @param {string} token - The JWT token to validate
 * @returns {Object|null} Decoded token payload or null if invalid
 */
export function validateServiceToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if it's a service token
    if (decoded.type !== 'service') {
      return null;
    }

    // Check if token is revoked
    if (decoded.tokenId && channelTokenDb.isTokenRevoked(decoded.tokenId)) {
      console.log(`[Channel] Token ${decoded.tokenId} has been revoked`);
      return null;
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      console.log('[Channel] Service token expired');
    } else {
      console.error('[Channel] Service token validation error:', error.message);
    }
    return null;
  }
}

/**
 * Check if a token is a service token
 * @param {string} token - The JWT token
 * @returns {boolean}
 */
export function isServiceToken(token) {
  if (!token) return false;

  try {
    // Decode without verification to check type
    const decoded = jwt.decode(token);
    return decoded && decoded.type === 'service';
  } catch {
    return false;
  }
}

/**
 * Revoke a service token
 * @param {string} tokenId - The token ID to revoke
 * @returns {boolean} Success
 */
export function revokeServiceToken(tokenId) {
  try {
    channelTokenDb.revokeToken(tokenId);
    console.log(`[Channel] Service token revoked: ${tokenId}`);
    return true;
  } catch (error) {
    console.error('[Channel] Failed to revoke token:', error);
    return false;
  }
}

/**
 * Revoke all tokens for a channel
 * @param {string} channelName - The channel name
 * @returns {number} Number of tokens revoked
 */
export function revokeChannelTokens(channelName) {
  try {
    const count = channelTokenDb.revokeAllChannelTokens(channelName);
    console.log(`[Channel] Revoked ${count} tokens for channel: ${channelName}`);
    return count;
  } catch (error) {
    console.error('[Channel] Failed to revoke channel tokens:', error);
    return 0;
  }
}

/**
 * Get system user info for service requests
 * @returns {Object} System user object
 */
export function getSystemUser() {
  return {
    id: SYSTEM_USER_ID,
    username: SYSTEM_USERNAME,
    isSystem: true
  };
}

/**
 * Clean up expired tokens from database
 */
export function cleanupExpiredTokens() {
  try {
    const count = channelTokenDb.deleteExpiredTokens();
    if (count > 0) {
      console.log(`[Channel] Cleaned up ${count} expired service tokens`);
    }
  } catch (error) {
    console.error('[Channel] Failed to cleanup expired tokens:', error);
  }
}

// Schedule periodic cleanup (run every hour)
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);
