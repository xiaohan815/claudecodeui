/**
 * Mobile utilities for touch support and mobile app integration
 */

import { isMobileAppMode, openExternal } from './mobileBridge';

/**
 * Check if device supports touch
 */
export function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      // @ts-ignore
      navigator.msMaxTouchPoints > 0)
  );
}

/**
 * Check if running on a mobile device (phone or tablet)
 */
export function isMobileDevice(): boolean {
  if (isMobileAppMode()) return true;

  const userAgent = navigator.userAgent.toLowerCase();
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
}

/**
 * Get device info for debugging and feature detection
 */
export function getDeviceInfo(): {
  isMobile: boolean;
  isTouch: boolean;
  isMobileApp: boolean;
  platform: string;
  screenWidth: number;
  screenHeight: number;
} {
  return {
    isMobile: isMobileDevice(),
    isTouch: isTouchDevice(),
    isMobileApp: isMobileAppMode(),
    platform: navigator.platform,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };
}

/**
 * Handle URL opening with mobile app support
 * In mobile app mode, opens in external browser
 */
export function openUrl(url: string): boolean {
  if (isMobileAppMode()) {
    openExternal(url);
    return true;
  }

  // Regular browser behavior
  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (popup) {
    try {
      popup.opener = null;
    } catch {
      // Ignore cross-origin restrictions
    }
    return true;
  }

  return false;
}

/**
 * Copy text to clipboard with mobile app support
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // In mobile app mode, use bridge
  if (isMobileAppMode()) {
    // The bridge will handle the clipboard
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback for regular browser
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

/**
 * Touch gesture handling for terminal
 */
export function setupTouchGestures(element: HTMLElement, handlers: {
  onLongPress?: (e: TouchEvent, x: number, y: number) => void;
  onDoubleTap?: (e: TouchEvent) => void;
  onSwipe?: (direction: 'left' | 'right' | 'up' | 'down') => void;
}): () => void {
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let lastTapTime = 0;

  const TOUCH_MOVE_THRESHOLD = 10;
  const LONG_PRESS_DURATION = 500;
  const DOUBLE_TAP_DURATION = 300;

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;

    // Long press detection
    if (handlers.onLongPress) {
      longPressTimer = setTimeout(() => {
        handlers.onLongPress?.(e, touchStartX, touchStartY);
      }, LONG_PRESS_DURATION);
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    const deltaX = Math.abs(e.touches[0].clientX - touchStartX);
    const deltaY = Math.abs(e.touches[0].clientY - touchStartY);

    // Cancel long press if moved too much
    if (deltaX > TOUCH_MOVE_THRESHOLD || deltaY > TOUCH_MOVE_THRESHOLD) {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    // Cancel long press timer
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;

    // Swipe detection
    if (handlers.onSwipe) {
      const minSwipeDistance = 50;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (absX > minSwipeDistance || absY > minSwipeDistance) {
        if (absX > absY) {
          handlers.onSwipe(deltaX > 0 ? 'right' : 'left');
        } else {
          handlers.onSwipe(deltaY > 0 ? 'down' : 'up');
        }
        return;
      }
    }

    // Double tap detection
    if (handlers.onDoubleTap) {
      const currentTime = Date.now();
      if (currentTime - lastTapTime < DOUBLE_TAP_DURATION) {
        handlers.onDoubleTap(e);
        lastTapTime = 0;
        return;
      }
      lastTapTime = currentTime;
    }
  };

  element.addEventListener('touchstart', handleTouchStart, { passive: true });
  element.addEventListener('touchmove', handleTouchMove, { passive: true });
  element.addEventListener('touchend', handleTouchEnd, { passive: true });

  // Cleanup function
  return () => {
    element.removeEventListener('touchstart', handleTouchStart);
    element.removeEventListener('touchmove', handleTouchMove);
    element.removeEventListener('touchend', handleTouchEnd);
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  };
}

/**
 * Virtual keyboard handling for mobile
 */
export function handleVirtualKeyboard(): {
  show: () => void;
  hide: () => void;
  isVisible: () => boolean;
} {
  // Create a hidden input for virtual keyboard triggering
  let hiddenInput: HTMLInputElement | null = null;

  const ensureHiddenInput = () => {
    if (!hiddenInput) {
      hiddenInput = document.createElement('input');
      hiddenInput.style.position = 'fixed';
      hiddenInput.style.top = '0';
      hiddenInput.style.left = '0';
      hiddenInput.style.width = '1px';
      hiddenInput.style.height = '1px';
      hiddenInput.style.opacity = '0';
      hiddenInput.style.pointerEvents = 'none';
      document.body.appendChild(hiddenInput);
    }
    return hiddenInput;
  };

  return {
    show: () => {
      const input = ensureHiddenInput();
      input.focus();
    },
    hide: () => {
      if (hiddenInput) {
        hiddenInput.blur();
      }
      // Also blur any active element
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    },
    isVisible: () => {
      // Check if visual viewport is smaller than layout viewport
      if (window.visualViewport) {
        return window.visualViewport.height < window.innerHeight;
      }
      return false;
    },
  };
}

export default {
  isTouchDevice,
  isMobileDevice,
  getDeviceInfo,
  openUrl,
  copyToClipboard,
  setupTouchGestures,
  handleVirtualKeyboard,
};