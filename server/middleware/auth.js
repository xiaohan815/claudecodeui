import jwt from 'jsonwebtoken';
import { userDb, appConfigDb } from '../database/db.js';
import { IS_PLATFORM } from '../constants/config.js';
import { isServiceToken, validateServiceToken, getSystemUser } from '../channels/token-manager.js';

// Use env var if set, otherwise auto-generate a unique secret per installation
const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();

// Debug: log which JWT secret source is being used
console.log('[AUTH] JWT_SECRET source:', process.env.JWT_SECRET ? 'environment variable' : 'database');
console.log('[AUTH] JWT_SECRET (first 10 chars):', JWT_SECRET.substring(0, 10) + '...');

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  // Platform mode:  use single database user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Platform mode: No user found in database' });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Platform mode error:', error);
      return res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // Also check query param for SSE endpoints (EventSource can't set headers)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  // Check if this is a service token (for channels)
  if (isServiceToken(token)) {
    const decoded = validateServiceToken(token);
    if (!decoded) {
      return res.status(403).json({ error: 'Invalid or expired service token' });
    }

    // Attach system user and channel info
    req.user = getSystemUser();
    req.channelSource = decoded.channel;
    req.isServiceRequest = true;

    console.log(`[AUTH] Service request from channel: ${decoded.channel}`);
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    // Auto-refresh: if token is past halfway through its lifetime, issue a new one
    if (decoded.exp && decoded.iat) {
      const now = Math.floor(Date.now() / 1000);
      const halfLife = (decoded.exp - decoded.iat) / 2;
      if (now > decoded.iat + halfLife) {
        const newToken = generateToken(user);
        res.setHeader('X-Refreshed-Token', newToken);
      }
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// WebSocket authentication function
const authenticateWebSocket = (token) => {
  // Platform mode: bypass token validation, return first user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { id: user.id, userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  if (!token) {
    return null;
  }

  // Check if this is a service token (for channels)
  if (isServiceToken(token)) {
    const decoded = validateServiceToken(token);
    if (decoded) {
      // Return system user info with channel source
      return {
        userId: SYSTEM_USER_ID,
        username: SYSTEM_USERNAME,
        isSystem: true,
        channelSource: decoded.channel
      };
    }
    return null;
  }

  // Normal OSS JWT validation
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Verify user actually exists in database (matches REST authenticateToken behavior)
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return null;
    }
    return { userId: user.id, username: user.username };
  } catch (error) {
    console.error('WebSocket token verification error:', error);
    return null;
  }
};

// System user constants
export const SYSTEM_USER_ID = 0;
const SYSTEM_USERNAME = '__system__';

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  JWT_SECRET
};
