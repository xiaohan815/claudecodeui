import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { IS_PLATFORM } from '../constants/config';

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const shouldReconnectRef = useRef(true);
  const pendingMessagesRef = useRef<string[]>([]);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { token } = useAuth();

  const connect = useCallback(() => {
    if (unmountedRef.current || !shouldReconnectRef.current) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const existingSocket = wsRef.current;
    if (existingSocket && (existingSocket.readyState === WebSocket.OPEN || existingSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const wsUrl = buildWebSocketUrl(token);

      if (!wsUrl) {
        setIsConnected(false);
        wsRef.current = null;
        return;
      }

      const websocket = new WebSocket(wsUrl);
      wsRef.current = websocket;

      websocket.onopen = () => {
        if (wsRef.current !== websocket) {
          websocket.close();
          return;
        }
        setIsConnected(true);

        if (pendingMessagesRef.current.length > 0) {
          const queuedMessages = [...pendingMessagesRef.current];
          pendingMessagesRef.current = [];
          queuedMessages.forEach((payload) => {
            websocket.send(payload);
          });
        }
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLatestMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        if (wsRef.current === websocket) {
          wsRef.current = null;
        }
        setIsConnected(false);

        if (!shouldReconnectRef.current || unmountedRef.current) {
          return;
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          if (!shouldReconnectRef.current || unmountedRef.current) {
            return;
          }
          connect();
        }, 3000);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token]);

  useEffect(() => {
    unmountedRef.current = false;
    shouldReconnectRef.current = true;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    connect();

    return () => {
      shouldReconnectRef.current = false;
      unmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
    };
  }, [connect]);

  const sendMessage = useCallback((message: any) => {
    const payload = JSON.stringify(message);
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    } else {
      pendingMessagesRef.current.push(payload);
      if (pendingMessagesRef.current.length > 100) {
        pendingMessagesRef.current.shift();
      }
      connect();
    }
  }, [connect]);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected
  }), [sendMessage, latestMessage, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();
  
  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
