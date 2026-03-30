/**
 * Channels Module
 *
 * Unified exports for channel functionality.
 */

export {
  // Token management
  createChannelServiceToken,
  getOrCreateChannelServiceToken,
  validateServiceToken,
  isServiceToken,
  revokeServiceToken,
  revokeChannelTokens,
  initializeSystemUser,
  getSystemUser
} from './token-manager.js';

export {
  // Access control
  gate,
  verifyPairingCode,
  allowSender,
  removeSender,
  isSenderAllowed,
  getAllowedSenders,
  getChannelAccessList,
  parsePermissionReply,
  AccessPolicy,
  GateAction,
  PERMISSION_REPLY_REGEX
} from './access-control.js';

export {
  // MCP management
  startMCPClient,
  stopMCPClient,
  getMCPConnection,
  isMCPConnected,
  listActiveConnections,
  stopAllMCPClients,
  callMCPTool,
  sendNotification
} from './mcp-manager.js';

export {
  // Channel management
  getAllChannels,
  getChannel,
  startChannel,
  stopChannel,
  enableChannel,
  disableChannel,
  uninstallChannel,
  handleIncomingMessage,
  startEnabledChannels,
  stopAllChannels,
  getChannelStatus,
  restartChannel,
  getChannelServiceToken
} from './channel-manager.js';

export {
  // Channel bridge
  initializeChannelBridge,
  subscribeToChannel,
  unsubscribeFromChannel,
  unsubscribeAll,
  broadcastToChannel,
  handleAIResponse,
  forwardToAI,
  handlePermissionRequest,
  handlePermissionReply,
  getBridgeStatus
} from './channel-bridge.js';
