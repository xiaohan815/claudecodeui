/**
 * Mobile Bridge Utility
 * Provides communication between the ClaudeCodeUI web app and the mobile native app
 */

// Check if running in a mobile WebView
export function isMobileApp(): boolean {
  // Check for global flag set by index.html
  // @ts-ignore
  if (typeof window !== 'undefined' && window.__MOBILE_APP__) {
    return true;
  }

  // Check for mobile query param or user agent
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mobile') === 'true') {
    return true;
  }

  // Check for uni-app bridge
  // @ts-ignore
  if (typeof window.uni !== 'undefined' && window.uni.postMessage) {
    return true;
  }

  // Check user agent for mobile app
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes('claudecodeui') || userAgent.includes('uni-app');
}

// Get platform type
export function getPlatform(): 'ios' | 'android' | 'web' {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('iphone') || userAgent.includes('ipad')) {
    return 'ios';
  }
  if (userAgent.includes('android')) {
    return 'android';
  }
  return 'web';
}

// Bridge message types
export type BridgeMessageType =
  | 'SAVE_AUTH'
  | 'LOGOUT'
  | 'OPEN_EXTERNAL'
  | 'COPY_TEXT'
  | 'TOGGLE_FULLSCREEN'
  | 'SHOW_TOAST'
  | 'GET_DEVICE_INFO'
  | 'TOKEN_EXPIRED';

export interface BridgeMessage {
  type: BridgeMessageType;
  data?: any;
}

// Native message types
export type NativeMessageType =
  | 'TOKEN'
  | 'DEVICE_INFO'
  | 'LOGOUT_COMPLETE'
  | 'AUTH_SAVED';

export interface NativeMessage {
  type: NativeMessageType;
  data?: any;
}

type MessageHandler = (message: NativeMessage) => void;

// Bridge class for communication
class MobileBridge {
  private isMobile: boolean = false;
  private messageHandlers: Set<MessageHandler> = new Set();
  private initialized: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.isMobile = isMobileApp();
      this.init();
    }
  }

  private init(): void {
    if (this.initialized) return;

    // Listen for messages from native app
    window.addEventListener('message', this.handleNativeMessage.bind(this));

    // For uni-app WebView messages
    document.addEventListener('UniAppBridgeReady', () => {
      console.log('[MobileBridge] UniApp bridge ready');
    });

    this.initialized = true;
  }

  private handleNativeMessage(event: MessageEvent): void {
    const message = event.data as NativeMessage;
    if (!message || !message.type) return;

    console.log('[MobileBridge] Received native message:', message.type);

    // Notify all handlers
    this.messageHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error('[MobileBridge] Handler error:', error);
      }
    });
  }

  // Check if running in mobile app
  isMobileApp(): boolean {
    return this.isMobile;
  }

  // Send message to native app
  postMessage(message: BridgeMessage): void {
    if (!this.isMobile) {
      console.log('[MobileBridge] Not in mobile app, skipping message:', message.type);
      return;
    }

    console.log('[MobileBridge] Sending message to native:', message.type);

    // Try uni-app bridge first
    // @ts-ignore
    if (window.uni && window.uni.postMessage) {
      // @ts-ignore
      window.uni.postMessage(message);
      return;
    }

    // Fallback to window.parent (for iframe scenarios)
    if (window.parent !== window) {
      window.parent.postMessage(message, '*');
      return;
    }

    // Fallback to React Native WebView
    // @ts-ignore
    if (window.ReactNativeWebView) {
      // @ts-ignore
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
      return;
    }

    console.warn('[MobileBridge] No bridge available for message:', message.type);
  }

  // Subscribe to native messages
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  // Save authentication data
  saveAuth(token: string, user: { id: string; username: string }, expiresIn?: number): void {
    this.postMessage({
      type: 'SAVE_AUTH',
      data: { token, user, expiresIn }
    });
  }

  // Logout
  logout(): void {
    this.postMessage({ type: 'LOGOUT' });
  }

  // Open external URL
  openExternal(url: string): void {
    this.postMessage({
      type: 'OPEN_EXTERNAL',
      data: { url }
    });
  }

  // Copy text to clipboard
  copyText(text: string): void {
    this.postMessage({
      type: 'COPY_TEXT',
      data: { text }
    });
  }

  // Toggle fullscreen
  toggleFullscreen(): void {
    this.postMessage({ type: 'TOGGLE_FULLSCREEN' });
  }

  // Show toast
  showToast(message: string, duration: number = 2000): void {
    this.postMessage({
      type: 'SHOW_TOAST',
      data: { message, duration }
    });
  }

  // Notify token expired
  tokenExpired(): void {
    this.postMessage({ type: 'TOKEN_EXPIRED' });
  }

  // Request device info
  requestDeviceInfo(): void {
    this.postMessage({ type: 'GET_DEVICE_INFO' });
  }
}

// Create singleton instance
export const mobileBridge = new MobileBridge();

// Export convenience functions
export const saveAuth = mobileBridge.saveAuth.bind(mobileBridge);
export const logout = mobileBridge.logout.bind(mobileBridge);
export const openExternal = mobileBridge.openExternal.bind(mobileBridge);
export const copyText = mobileBridge.copyText.bind(mobileBridge);
export const toggleFullscreen = mobileBridge.toggleFullscreen.bind(mobileBridge);
export const showToast = mobileBridge.showToast.bind(mobileBridge);
export const tokenExpired = mobileBridge.tokenExpired.bind(mobileBridge);
export const requestDeviceInfo = mobileBridge.requestDeviceInfo.bind(mobileBridge);
export const onMessage = mobileBridge.onMessage.bind(mobileBridge);
export const isMobileAppMode = mobileBridge.isMobileApp.bind(mobileBridge);

export default mobileBridge;