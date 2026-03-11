import { useTranslation } from 'react-i18next';
import { useWebSocket } from '../../../../contexts/WebSocketContext';

export default function WebSocketStatus() {
  const { t } = useTranslation('chat');
  const { isConnected } = useWebSocket();

  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-all duration-200 ${
        isConnected
          ? 'border-green-300/60 bg-green-50 text-green-700 dark:border-green-600/40 dark:bg-green-900/15 dark:text-green-300'
          : 'border-red-300/60 bg-red-50 text-red-700 dark:border-red-600/40 dark:bg-red-900/15 dark:text-red-300'
      }`}
      title={isConnected ? t('ws.connected', { defaultValue: 'WebSocket connected' }) : t('ws.disconnected', { defaultValue: 'WebSocket disconnected - reconnecting...' })}
    >
      <div
        className={`h-2 w-2 rounded-full ${
          isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
        }`}
      />
      <span className="hidden sm:inline">
        {isConnected ? 'WS' : t('ws.reconnecting', { defaultValue: 'Reconnecting...' })}
      </span>
    </div>
  );
}
