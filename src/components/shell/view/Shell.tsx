import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '@xterm/xterm/css/xterm.css';
import type { Project, ProjectSession } from '../../../types/app';
import {
  PROMPT_BUFFER_SCAN_LINES,
  PROMPT_DEBOUNCE_MS,
  PROMPT_MAX_OPTIONS,
  PROMPT_MIN_OPTIONS,
  PROMPT_OPTION_SCAN_LINES,
  SHELL_RESTART_DELAY_MS,
} from '../constants/constants';
import { useShellRuntime } from '../hooks/useShellRuntime';
import { sendSocketMessage } from '../utils/socket';
import { getSessionDisplayName } from '../utils/auth';
import ShellConnectionOverlay from './subcomponents/ShellConnectionOverlay';
import ShellEmptyState from './subcomponents/ShellEmptyState';
import ShellHeader from './subcomponents/ShellHeader';
import ShellMinimalView from './subcomponents/ShellMinimalView';
import TerminalShortcutsPanel from './subcomponents/TerminalShortcutsPanel';

// Detect iOS Safari — xterm.js canvas cannot receive soft keyboard input on iOS
const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

type CliPromptOption = { number: string; label: string };

type ShellProps = {
  selectedProject?: Project | null;
  selectedSession?: ProjectSession | null;
  initialCommand?: string | null;
  isPlainShell?: boolean;
  onProcessComplete?: ((exitCode: number) => void) | null;
  minimal?: boolean;
  autoConnect?: boolean;
  isActive?: boolean;
};

export default function Shell({
  selectedProject = null,
  selectedSession = null,
  initialCommand = null,
  isPlainShell = false,
  onProcessComplete = null,
  minimal = false,
  autoConnect = false,
  isActive = true,
}: ShellProps) {
  const { t } = useTranslation('chat');
  const [isRestarting, setIsRestarting] = useState(false);
  const [cliPromptOptions, setCliPromptOptions] = useState<CliPromptOption[] | null>(null);
  const promptCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onOutputRef = useRef<(() => void) | null>(null);
  const iosInputRef = useRef<HTMLTextAreaElement | null>(null);
  const iosDevice = useRef(isIOS()).current;

  const {
    terminalContainerRef,
    terminalRef,
    wsRef,
    isConnected,
    isInitialized,
    isConnecting,
    authUrl,
    authUrlVersion,
    connectToShell,
    disconnectFromShell,
    openAuthUrlInBrowser,
    copyAuthUrlToClipboard,
  } = useShellRuntime({
    selectedProject,
    selectedSession,
    initialCommand,
    isPlainShell,
    minimal,
    autoConnect,
    isRestarting,
    onProcessComplete,
    onOutputRef,
  });

  // Check xterm.js buffer for CLI prompt patterns (❯ N. label)
  const checkBufferForPrompt = useCallback(() => {
    const term = terminalRef.current;
    if (!term) return;
    const buf = term.buffer.active;
    const lastContentRow = buf.baseY + buf.cursorY;
    const scanEnd = Math.min(buf.baseY + buf.length - 1, lastContentRow + 10);
    const scanStart = Math.max(0, lastContentRow - PROMPT_BUFFER_SCAN_LINES);
    const lines: string[] = [];
    for (let i = scanStart; i <= scanEnd; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString().trimEnd());
    }

    let footerIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/esc to cancel/i.test(lines[i]) || /enter to select/i.test(lines[i])) {
        footerIdx = i;
        break;
      }
    }

    if (footerIdx === -1) {
      setCliPromptOptions(null);
      return;
    }

    // Scan upward from footer collecting numbered options.
    // Non-matching lines are allowed (multi-line labels, blank separators)
    // because CLI prompts may wrap options across multiple terminal rows.
    const optMap = new Map<string, string>();
    const optScanStart = Math.max(0, footerIdx - PROMPT_OPTION_SCAN_LINES);
    for (let i = footerIdx - 1; i >= optScanStart; i--) {
      const match = lines[i].match(/^\s*[❯›>]?\s*(\d+)\.\s+(.+)/);
      if (match) {
        const num = match[1];
        const label = match[2].trim();
        if (parseInt(num, 10) <= PROMPT_MAX_OPTIONS && label.length > 0 && !optMap.has(num)) {
          optMap.set(num, label);
        }
      }
    }

    const valid: CliPromptOption[] = [];
    for (let i = 1; i <= optMap.size; i++) {
      if (optMap.has(String(i))) valid.push({ number: String(i), label: optMap.get(String(i))! });
      else break;
    }

    setCliPromptOptions(valid.length >= PROMPT_MIN_OPTIONS ? valid : null);
  }, [terminalRef]);

  // Schedule prompt check after terminal output (debounced)
  const schedulePromptCheck = useCallback(() => {
    if (promptCheckTimer.current) clearTimeout(promptCheckTimer.current);
    promptCheckTimer.current = setTimeout(checkBufferForPrompt, PROMPT_DEBOUNCE_MS);
  }, [checkBufferForPrompt]);

  // Wire up the onOutput callback
  useEffect(() => {
    onOutputRef.current = schedulePromptCheck;
  }, [schedulePromptCheck]);

  // Cleanup prompt check timer on unmount
  useEffect(() => {
    return () => {
      if (promptCheckTimer.current) clearTimeout(promptCheckTimer.current);
    };
  }, []);

  // Clear stale prompt options and cancel pending timer on disconnect
  useEffect(() => {
    if (!isConnected) {
      if (promptCheckTimer.current) {
        clearTimeout(promptCheckTimer.current);
        promptCheckTimer.current = null;
      }
      setCliPromptOptions(null);
    }
  }, [isConnected]);

  useEffect(() => {
    if (!isActive || !isInitialized || !isConnected) {
      return;
    }

    const focusTerminal = () => {
      if (iosDevice && iosInputRef.current) {
        // On iOS, focus the overlay textarea so the soft keyboard can appear on tap
        iosInputRef.current.focus({ preventScroll: true });
      } else {
        terminalRef.current?.focus();
      }
    };

    const animationFrameId = window.requestAnimationFrame(focusTerminal);
    const timeoutId = window.setTimeout(focusTerminal, 0);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [isActive, isConnected, isInitialized, terminalRef, iosDevice]);

  const sendInput = useCallback(
    (data: string) => {
      sendSocketMessage(wsRef.current, { type: 'input', data });
    },
    [wsRef],
  );

  // iOS: handle textarea input and forward to terminal
  const handleIOSInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const value = ta.value;
      if (value) {
        sendSocketMessage(wsRef.current, { type: 'input', data: value });
        ta.value = '';
      }
    },
    [wsRef],
  );

  // iOS: intercept Enter key to send \r instead of newline
  const handleIOSKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendSocketMessage(wsRef.current, { type: 'input', data: '\r' });
        e.currentTarget.value = '';
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        sendSocketMessage(wsRef.current, { type: 'input', data: '\x7f' });
        e.currentTarget.value = '';
      }
    },
    [wsRef],
  );

  const sessionDisplayName = useMemo(() => getSessionDisplayName(selectedSession), [selectedSession]);
  const sessionDisplayNameShort = useMemo(
    () => (sessionDisplayName ? sessionDisplayName.slice(0, 30) : null),
    [sessionDisplayName],
  );
  const sessionDisplayNameLong = useMemo(
    () => (sessionDisplayName ? sessionDisplayName.slice(0, 50) : null),
    [sessionDisplayName],
  );

  const handleRestartShell = useCallback(() => {
    setIsRestarting(true);
    window.setTimeout(() => {
      setIsRestarting(false);
    }, SHELL_RESTART_DELAY_MS);
  }, []);

  if (!selectedProject) {
    return (
      <ShellEmptyState
        title={t('shell.selectProject.title')}
        description={t('shell.selectProject.description')}
      />
    );
  }

  if (minimal) {
    return (
      <ShellMinimalView
        terminalContainerRef={terminalContainerRef}
        authUrl={authUrl}
        authUrlVersion={authUrlVersion}
        initialCommand={initialCommand}
        isConnected={isConnected}
        openAuthUrlInBrowser={openAuthUrlInBrowser}
        copyAuthUrlToClipboard={copyAuthUrlToClipboard}
      />
    );
  }

  const readyDescription = isPlainShell
    ? t('shell.runCommand', {
        command: initialCommand || t('shell.defaultCommand'),
        projectName: selectedProject.displayName,
      })
    : selectedSession
      ? t('shell.resumeSession', { displayName: sessionDisplayNameLong })
      : t('shell.startSession');

  const connectingDescription = isPlainShell
    ? t('shell.runCommand', {
        command: initialCommand || t('shell.defaultCommand'),
        projectName: selectedProject.displayName,
      })
    : t('shell.startCli', { projectName: selectedProject.displayName });

  const overlayMode = !isInitialized ? 'loading' : isConnecting ? 'connecting' : !isConnected ? 'connect' : null;
  const overlayDescription = overlayMode === 'connecting' ? connectingDescription : readyDescription;

  return (
    <div className="flex h-full w-full flex-col bg-gray-900">
      <ShellHeader
        isConnected={isConnected}
        isInitialized={isInitialized}
        isRestarting={isRestarting}
        hasSession={Boolean(selectedSession)}
        sessionDisplayNameShort={sessionDisplayNameShort}
        onDisconnect={disconnectFromShell}
        onRestart={handleRestartShell}
        statusNewSessionText={t('shell.status.newSession')}
        statusInitializingText={t('shell.status.initializing')}
        statusRestartingText={t('shell.status.restarting')}
        disconnectLabel={t('shell.actions.disconnect')}
        disconnectTitle={t('shell.actions.disconnectTitle')}
        restartLabel={t('shell.actions.restart')}
        restartTitle={t('shell.actions.restartTitle')}
        disableRestart={isRestarting || isConnected}
      />

      <div className="relative flex-1 overflow-hidden p-2">
        <div
          ref={terminalContainerRef}
          className="h-full w-full focus:outline-none"
          style={{ outline: 'none' }}
        />

        {/* iOS soft keyboard input overlay — xterm canvas cannot receive IME/touch input on iOS */}
        {iosDevice && isConnected && (
          <textarea
            ref={iosInputRef}
            aria-label="terminal input"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onInput={handleIOSInput}
            onKeyDown={handleIOSKeyDown}
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              zIndex: 10,
              resize: 'none',
              background: 'transparent',
              color: 'transparent',
              caretColor: 'transparent',
              border: 'none',
              outline: 'none',
              padding: 0,
              fontSize: '16px', // prevent iOS auto-zoom
            }}
          />
        )}

        {overlayMode && (
          <ShellConnectionOverlay
            mode={overlayMode}
            description={overlayDescription}
            loadingLabel={t('shell.loading')}
            connectLabel={t('shell.actions.connect')}
            connectTitle={t('shell.actions.connectTitle')}
            connectingLabel={t('shell.connecting')}
            onConnect={connectToShell}
          />
        )}

        {cliPromptOptions && isConnected && (
          <div
            className="absolute inset-x-0 bottom-0 z-10 border-t border-gray-700/80 bg-gray-800/95 px-3 py-2 backdrop-blur-sm"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="flex flex-wrap items-center gap-2">
              {cliPromptOptions.map((opt) => (
                <button
                  type="button"
                  key={opt.number}
                  onClick={() => {
                    sendInput(opt.number);
                    setCliPromptOptions(null);
                  }}
                  className="max-w-36 truncate rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                  title={`${opt.number}. ${opt.label}`}
                >
                  {opt.number}. {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  sendInput('\x1b');
                  setCliPromptOptions(null);
                }}
                className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600"
              >
                Esc
              </button>
            </div>
          </div>
        )}
      </div>

      <TerminalShortcutsPanel
        wsRef={wsRef}
        terminalRef={terminalRef}
        isConnected={isConnected}
      />

    </div>
  );
}
