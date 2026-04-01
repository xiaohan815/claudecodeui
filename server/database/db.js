import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

const c = {
  info: (text) => `${colors.cyan}${text}${colors.reset}`,
  bright: (text) => `${colors.bright}${text}${colors.reset}`,
  dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

// Use DATABASE_PATH environment variable if set, otherwise use default location
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "auth.db");
const INIT_SQL_PATH = path.join(__dirname, "init.sql");

// Ensure database directory exists if custom path is provided
if (process.env.DATABASE_PATH) {
  const dbDir = path.dirname(DB_PATH);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`Created database directory: ${dbDir}`);
    }
  } catch (error) {
    console.error(
      `Failed to create database directory ${dbDir}:`,
      error.message,
    );
    throw error;
  }
}

// As part of 1.19.2 we are introducing a new location for auth.db. The below handles exisitng moving legacy database from install directory to new location
const LEGACY_DB_PATH = path.join(__dirname, "auth.db");
if (
  DB_PATH !== LEGACY_DB_PATH &&
  !fs.existsSync(DB_PATH) &&
  fs.existsSync(LEGACY_DB_PATH)
) {
  try {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    console.log(
      `[MIGRATION] Copied database from ${LEGACY_DB_PATH} to ${DB_PATH}`,
    );
    for (const suffix of ["-wal", "-shm"]) {
      if (fs.existsSync(LEGACY_DB_PATH + suffix)) {
        fs.copyFileSync(LEGACY_DB_PATH + suffix, DB_PATH + suffix);
      }
    }
  } catch (err) {
    console.warn(`[MIGRATION] Could not copy legacy database: ${err.message}`);
  }
}

// Create database connection
const db = new Database(DB_PATH);

// app_config must exist before any other module imports (auth.js reads the JWT secret at load time).
// runMigrations() also creates this table, but it runs too late for existing installations
// where auth.js is imported before initializeDatabase() is called.
db.exec(`CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Show app installation path prominently
const appInstallPath = path.join(__dirname, "../..");
console.log("");
console.log(c.dim("═".repeat(60)));
console.log(
  `${c.info("[INFO]")} App Installation: ${c.bright(appInstallPath)}`,
);
console.log(
  `${c.info("[INFO]")} Database: ${c.dim(path.relative(appInstallPath, DB_PATH))}`,
);
if (process.env.DATABASE_PATH) {
  console.log(
    `       ${c.dim("(Using custom DATABASE_PATH from environment)")}`,
  );
}
console.log(c.dim("═".repeat(60)));
console.log("");

const runMigrations = () => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const columnNames = tableInfo.map((col) => col.name);

    if (!columnNames.includes("git_name")) {
      console.log("Running migration: Adding git_name column");
      db.exec("ALTER TABLE users ADD COLUMN git_name TEXT");
    }

    if (!columnNames.includes("git_email")) {
      console.log("Running migration: Adding git_email column");
      db.exec("ALTER TABLE users ADD COLUMN git_email TEXT");
    }

    if (!columnNames.includes("has_completed_onboarding")) {
      console.log("Running migration: Adding has_completed_onboarding column");
      db.exec(
        "ALTER TABLE users ADD COLUMN has_completed_onboarding BOOLEAN DEFAULT 0",
      );
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS user_notification_preferences (
        user_id INTEGER PRIMARY KEY,
        preferences_json TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS vapid_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        keys_p256dh TEXT NOT NULL,
        keys_auth TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    // Create app_config table if it doesn't exist (for existing installations)
    db.exec(`CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create session_names table if it doesn't exist (for existing installations)
    db.exec(`CREATE TABLE IF NOT EXISTS session_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'claude',
      custom_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, provider)
    )`);
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_session_names_lookup ON session_names(session_id, provider)",
    );

    // Channel feature migrations
    // Create channel_service_tokens table for service token management
    db.exec(`CREATE TABLE IF NOT EXISTS channel_service_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id TEXT NOT NULL UNIQUE,
      channel_name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      is_revoked BOOLEAN DEFAULT 0
    )`);
    // Migration: add token column if not exists (for existing databases)
    try {
      db.exec("ALTER TABLE channel_service_tokens ADD COLUMN token TEXT");
    } catch (e) {
      // Column already exists, ignore error
    }
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_channel_tokens_lookup ON channel_service_tokens(token_id, channel_name)",
    );

    // Create channel_access table for access control
    db.exec(`CREATE TABLE IF NOT EXISTS channel_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_name TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_type TEXT DEFAULT 'user',
      policy TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_name, sender_id)
    )`);
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_channel_access_lookup ON channel_access(channel_name, sender_id)",
    );

    // Create channel_sessions table for session tracking
    db.exec(`CREATE TABLE IF NOT EXISTS channel_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_name TEXT NOT NULL,
      external_chat_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_name, external_chat_id)
    )`);
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_channel_sessions_lookup ON channel_sessions(channel_name, external_chat_id)",
    );

    // Create channel_config table for per-channel working directory and provider settings
    db.exec(`CREATE TABLE IF NOT EXISTS channel_config (
      channel_name TEXT PRIMARY KEY,
      cwd          TEXT,
      provider     TEXT NOT NULL DEFAULT 'claude',
      model        TEXT,
      app_id       TEXT,
      app_secret   TEXT,
      domain       TEXT,
      bot_name     TEXT,
      allowed_chat_types TEXT,
      use_persistent_pty INTEGER NOT NULL DEFAULT 0,
      pty_idle_timeout_minutes INTEGER NOT NULL DEFAULT 30,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    for (const migration of [
      "ALTER TABLE channel_config ADD COLUMN app_id TEXT",
      "ALTER TABLE channel_config ADD COLUMN app_secret TEXT",
      "ALTER TABLE channel_config ADD COLUMN domain TEXT",
      "ALTER TABLE channel_config ADD COLUMN bot_name TEXT",
      "ALTER TABLE channel_config ADD COLUMN allowed_chat_types TEXT",
      "ALTER TABLE channel_config ADD COLUMN use_persistent_pty INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE channel_config ADD COLUMN pty_idle_timeout_minutes INTEGER NOT NULL DEFAULT 30",
    ]) {
      try {
        db.exec(migration);
      } catch (e) {
      }
    }

    console.log("Database migrations completed successfully");
  } catch (error) {
    console.error("Error running migrations:", error.message);
    throw error;
  }
};

// Initialize database with schema
const initializeDatabase = async () => {
  try {
    const initSQL = fs.readFileSync(INIT_SQL_PATH, "utf8");
    db.exec(initSQL);
    console.log("Database initialized successfully");
    runMigrations();
  } catch (error) {
    console.error("Error initializing database:", error.message);
    throw error;
  }
};

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    try {
      const row = db.prepare("SELECT COUNT(*) as count FROM users").get();
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user
  createUser: (username, passwordHash) => {
    try {
      const stmt = db.prepare(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      );
      const result = stmt.run(username, passwordHash);
      return { id: result.lastInsertRowid, username };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username) => {
    try {
      const row = db
        .prepare("SELECT * FROM users WHERE username = ? AND is_active = 1")
        .get(username);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Update last login time (non-fatal — logged but not thrown)
  updateLastLogin: (userId) => {
    try {
      db.prepare(
        "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(userId);
    } catch (err) {
      console.warn("Failed to update last login:", err.message);
    }
  },

  // Get user by ID
  getUserById: (userId) => {
    try {
      const row = db
        .prepare(
          "SELECT id, username, created_at, last_login FROM users WHERE id = ? AND is_active = 1",
        )
        .get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Create system user for channel service (id=0, no password)
  createSystemUser: (userId, username) => {
    try {
      const stmt = db.prepare(
        "INSERT OR IGNORE INTO users (id, username, password_hash, is_active) VALUES (?, ?, '', 1)",
      );
      const result = stmt.run(userId, username);
      return { id: userId, username };
    } catch (err) {
      throw err;
    }
  },

  getFirstUser: () => {
    try {
      const row = db
        .prepare(
          "SELECT id, username, created_at, last_login FROM users WHERE is_active = 1 LIMIT 1",
        )
        .get();
      return row;
    } catch (err) {
      throw err;
    }
  },

  updateGitConfig: (userId, gitName, gitEmail) => {
    try {
      const stmt = db.prepare(
        "UPDATE users SET git_name = ?, git_email = ? WHERE id = ?",
      );
      stmt.run(gitName, gitEmail, userId);
    } catch (err) {
      throw err;
    }
  },

  getGitConfig: (userId) => {
    try {
      const row = db
        .prepare("SELECT git_name, git_email FROM users WHERE id = ?")
        .get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  completeOnboarding: (userId) => {
    try {
      const stmt = db.prepare(
        "UPDATE users SET has_completed_onboarding = 1 WHERE id = ?",
      );
      stmt.run(userId);
    } catch (err) {
      throw err;
    }
  },

  hasCompletedOnboarding: (userId) => {
    try {
      const row = db
        .prepare("SELECT has_completed_onboarding FROM users WHERE id = ?")
        .get(userId);
      return row?.has_completed_onboarding === 1;
    } catch (err) {
      throw err;
    }
  },
};

// API Keys database operations
const apiKeysDb = {
  // Generate a new API key
  generateApiKey: () => {
    return "ck_" + crypto.randomBytes(32).toString("hex");
  },

  // Create a new API key
  createApiKey: (userId, keyName) => {
    try {
      const apiKey = apiKeysDb.generateApiKey();
      const stmt = db.prepare(
        "INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)",
      );
      const result = stmt.run(userId, keyName, apiKey);
      return { id: result.lastInsertRowid, keyName, apiKey };
    } catch (err) {
      throw err;
    }
  },

  // Get all API keys for a user
  getApiKeys: (userId) => {
    try {
      const rows = db
        .prepare(
          "SELECT id, key_name, api_key, created_at, last_used, is_active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
        )
        .all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Validate API key and get user
  validateApiKey: (apiKey) => {
    try {
      const row = db
        .prepare(
          `
        SELECT u.id, u.username, ak.id as api_key_id
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.api_key = ? AND ak.is_active = 1 AND u.is_active = 1
      `,
        )
        .get(apiKey);

      if (row) {
        // Update last_used timestamp
        db.prepare(
          "UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?",
        ).run(row.api_key_id);
      }

      return row;
    } catch (err) {
      throw err;
    }
  },

  // Delete an API key
  deleteApiKey: (userId, apiKeyId) => {
    try {
      const stmt = db.prepare(
        "DELETE FROM api_keys WHERE id = ? AND user_id = ?",
      );
      const result = stmt.run(apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle API key active status
  toggleApiKey: (userId, apiKeyId, isActive) => {
    try {
      const stmt = db.prepare(
        "UPDATE api_keys SET is_active = ? WHERE id = ? AND user_id = ?",
      );
      const result = stmt.run(isActive ? 1 : 0, apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },
};

// User credentials database operations (for GitHub tokens, GitLab tokens, etc.)
const credentialsDb = {
  // Create a new credential
  createCredential: (
    userId,
    credentialName,
    credentialType,
    credentialValue,
    description = null,
  ) => {
    try {
      const stmt = db.prepare(
        "INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description) VALUES (?, ?, ?, ?, ?)",
      );
      const result = stmt.run(
        userId,
        credentialName,
        credentialType,
        credentialValue,
        description,
      );
      return { id: result.lastInsertRowid, credentialName, credentialType };
    } catch (err) {
      throw err;
    }
  },

  // Get all credentials for a user, optionally filtered by type
  getCredentials: (userId, credentialType = null) => {
    try {
      let query =
        "SELECT id, credential_name, credential_type, description, created_at, is_active FROM user_credentials WHERE user_id = ?";
      const params = [userId];

      if (credentialType) {
        query += " AND credential_type = ?";
        params.push(credentialType);
      }

      query += " ORDER BY created_at DESC";

      const rows = db.prepare(query).all(...params);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Get active credential value for a user by type (returns most recent active)
  getActiveCredential: (userId, credentialType) => {
    try {
      const row = db
        .prepare(
          "SELECT credential_value FROM user_credentials WHERE user_id = ? AND credential_type = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1",
        )
        .get(userId, credentialType);
      return row?.credential_value || null;
    } catch (err) {
      throw err;
    }
  },

  // Delete a credential
  deleteCredential: (userId, credentialId) => {
    try {
      const stmt = db.prepare(
        "DELETE FROM user_credentials WHERE id = ? AND user_id = ?",
      );
      const result = stmt.run(credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle credential active status
  toggleCredential: (userId, credentialId, isActive) => {
    try {
      const stmt = db.prepare(
        "UPDATE user_credentials SET is_active = ? WHERE id = ? AND user_id = ?",
      );
      const result = stmt.run(isActive ? 1 : 0, credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },
};

const DEFAULT_NOTIFICATION_PREFERENCES = {
  channels: {
    inApp: false,
    webPush: false
  },
  events: {
    actionRequired: true,
    stop: true,
    error: true
  }
};

const normalizeNotificationPreferences = (value) => {
  const source = value && typeof value === 'object' ? value : {};

  return {
    channels: {
      inApp: source.channels?.inApp === true,
      webPush: source.channels?.webPush === true
    },
    events: {
      actionRequired: source.events?.actionRequired !== false,
      stop: source.events?.stop !== false,
      error: source.events?.error !== false
    }
  };
};

const notificationPreferencesDb = {
  getPreferences: (userId) => {
    try {
      const row = db.prepare('SELECT preferences_json FROM user_notification_preferences WHERE user_id = ?').get(userId);
      if (!row) {
        const defaults = normalizeNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
        db.prepare(
          'INSERT INTO user_notification_preferences (user_id, preferences_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
        ).run(userId, JSON.stringify(defaults));
        return defaults;
      }

      let parsed;
      try {
        parsed = JSON.parse(row.preferences_json);
      } catch {
        parsed = DEFAULT_NOTIFICATION_PREFERENCES;
      }
      return normalizeNotificationPreferences(parsed);
    } catch (err) {
      throw err;
    }
  },

  updatePreferences: (userId, preferences) => {
    try {
      const normalized = normalizeNotificationPreferences(preferences);
      db.prepare(
        `INSERT INTO user_notification_preferences (user_id, preferences_json, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           preferences_json = excluded.preferences_json,
           updated_at = CURRENT_TIMESTAMP`
      ).run(userId, JSON.stringify(normalized));
      return normalized;
    } catch (err) {
      throw err;
    }
  }
};

const pushSubscriptionsDb = {
  saveSubscription: (userId, endpoint, keysP256dh, keysAuth) => {
    try {
      db.prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           keys_p256dh = excluded.keys_p256dh,
           keys_auth = excluded.keys_auth`
      ).run(userId, endpoint, keysP256dh, keysAuth);
    } catch (err) {
      throw err;
    }
  },

  getSubscriptions: (userId) => {
    try {
      return db.prepare('SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?').all(userId);
    } catch (err) {
      throw err;
    }
  },

  removeSubscription: (endpoint) => {
    try {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    } catch (err) {
      throw err;
    }
  },

  removeAllForUser: (userId) => {
    try {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
    } catch (err) {
      throw err;
    }
  }
};

// Session custom names database operations
const sessionNamesDb = {
  // Set (insert or update) a custom session name
  setName: (sessionId, provider, customName) => {
    db.prepare(
      `
      INSERT INTO session_names (session_id, provider, custom_name)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id, provider)
      DO UPDATE SET custom_name = excluded.custom_name, updated_at = CURRENT_TIMESTAMP
    `,
    ).run(sessionId, provider, customName);
  },

  // Get a single custom session name
  getName: (sessionId, provider) => {
    const row = db
      .prepare(
        "SELECT custom_name FROM session_names WHERE session_id = ? AND provider = ?",
      )
      .get(sessionId, provider);
    return row?.custom_name || null;
  },

  // Batch lookup — returns Map<sessionId, customName>
  getNames: (sessionIds, provider) => {
    if (!sessionIds.length) return new Map();
    const placeholders = sessionIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT session_id, custom_name FROM session_names
       WHERE session_id IN (${placeholders}) AND provider = ?`,
      )
      .all(...sessionIds, provider);
    return new Map(rows.map((r) => [r.session_id, r.custom_name]));
  },

  // Delete a custom session name
  deleteName: (sessionId, provider) => {
    return (
      db
        .prepare(
          "DELETE FROM session_names WHERE session_id = ? AND provider = ?",
        )
        .run(sessionId, provider).changes > 0
    );
  },
};

// Apply custom session names from the database (overrides CLI-generated summaries)
function applyCustomSessionNames(sessions, provider) {
  if (!sessions?.length) return;
  try {
    const ids = sessions.map((s) => s.id);
    const customNames = sessionNamesDb.getNames(ids, provider);
    for (const session of sessions) {
      const custom = customNames.get(session.id);
      if (custom) session.summary = custom;
    }
  } catch (error) {
    console.warn(
      `[DB] Failed to apply custom session names for ${provider}:`,
      error.message,
    );
  }
}

// App config database operations
const appConfigDb = {
  get: (key) => {
    try {
      const row = db
        .prepare("SELECT value FROM app_config WHERE key = ?")
        .get(key);
      return row?.value || null;
    } catch (err) {
      return null;
    }
  },

  set: (key, value) => {
    db.prepare(
      "INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  },

  getOrCreateJwtSecret: () => {
    let secret = appConfigDb.get("jwt_secret");
    if (!secret) {
      secret = crypto.randomBytes(64).toString("hex");
      appConfigDb.set("jwt_secret", secret);
    }
    return secret;
  },
};

// Backward compatibility - keep old names pointing to new system
const githubTokensDb = {
  createGithubToken: (userId, tokenName, githubToken, description = null) => {
    return credentialsDb.createCredential(
      userId,
      tokenName,
      "github_token",
      githubToken,
      description,
    );
  },
  getGithubTokens: (userId) => {
    return credentialsDb.getCredentials(userId, "github_token");
  },
  getActiveGithubToken: (userId) => {
    return credentialsDb.getActiveCredential(userId, "github_token");
  },
  deleteGithubToken: (userId, tokenId) => {
    return credentialsDb.deleteCredential(userId, tokenId);
  },
  toggleGithubToken: (userId, tokenId, isActive) => {
    return credentialsDb.toggleCredential(userId, tokenId, isActive);
  },
};

// Channel service tokens database operations
const channelTokenDb = {
  // Create a new service token record
  createToken: ({
    tokenId,
    channelName,
    token,
    createdAt,
    expiresAt,
    isRevoked = false,
  }) => {
    try {
      // Store both hash and full token (for local reuse)
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const stmt = db.prepare(
        "INSERT INTO channel_service_tokens (token_id, channel_name, token_hash, token, created_at, expires_at, is_revoked) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      stmt.run(
        tokenId,
        channelName,
        tokenHash,
        token,
        createdAt,
        expiresAt,
        isRevoked ? 1 : 0,
      );
      return { tokenId, channelName };
    } catch (err) {
      throw err;
    }
  },

  // Check if a token is revoked
  isTokenRevoked: (tokenId) => {
    try {
      const row = db
        .prepare(
          "SELECT is_revoked FROM channel_service_tokens WHERE token_id = ?",
        )
        .get(tokenId);
      return row?.is_revoked === 1;
    } catch (err) {
      console.error("[DB] Error checking token revocation:", err);
      return false;
    }
  },

  // Revoke a token
  revokeToken: (tokenId) => {
    try {
      const stmt = db.prepare(
        "UPDATE channel_service_tokens SET is_revoked = 1 WHERE token_id = ?",
      );
      stmt.run(tokenId);
      return true;
    } catch (err) {
      throw err;
    }
  },

  // Revoke all tokens for a channel
  revokeAllChannelTokens: (channelName) => {
    try {
      const stmt = db.prepare(
        "UPDATE channel_service_tokens SET is_revoked = 1 WHERE channel_name = ?",
      );
      const result = stmt.run(channelName);
      return result.changes;
    } catch (err) {
      throw err;
    }
  },

  // Delete expired tokens
  deleteExpiredTokens: () => {
    try {
      const stmt = db.prepare(
        "DELETE FROM channel_service_tokens WHERE expires_at < datetime('now') OR is_revoked = 1",
      );
      const result = stmt.run();
      return result.changes;
    } catch (err) {
      throw err;
    }
  },

  // Get a valid (non-expired, non-revoked) token for a channel
  getValidTokenForChannel: (channelName) => {
    try {
      const row = db
        .prepare(
          "SELECT * FROM channel_service_tokens WHERE channel_name = ? AND expires_at > datetime('now') AND is_revoked = 0 ORDER BY created_at DESC LIMIT 1",
        )
        .get(channelName);
      return row || null;
    } catch (err) {
      console.error("[DB] Error getting valid token:", err);
      return null;
    }
  },

  // Get all tokens for a channel
  getChannelTokens: (channelName) => {
    try {
      const rows = db
        .prepare(
          "SELECT token_id, channel_name, created_at, expires_at, is_revoked FROM channel_service_tokens WHERE channel_name = ? ORDER BY created_at DESC",
        )
        .all(channelName);
      return rows;
    } catch (err) {
      throw err;
    }
  },
};

// Channel access control database operations
const channelAccessDb = {
  // Add or update access entry
  setAccess: (
    channelName,
    senderId,
    senderType = "user",
    policy = "pending",
  ) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO channel_access (channel_name, sender_id, sender_type, policy)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(channel_name, sender_id)
        DO UPDATE SET policy = excluded.policy, updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(channelName, senderId, senderType, policy);
      return true;
    } catch (err) {
      throw err;
    }
  },

  // Get access entry for a sender
  getAccess: (channelName, senderId) => {
    try {
      const row = db
        .prepare(
          "SELECT * FROM channel_access WHERE channel_name = ? AND sender_id = ?",
        )
        .get(channelName, senderId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Get all access entries for a channel
  getAllAccess: (channelName) => {
    try {
      const rows = db
        .prepare(
          "SELECT * FROM channel_access WHERE channel_name = ? ORDER BY created_at DESC",
        )
        .all(channelName);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Delete access entry
  deleteAccess: (channelName, senderId) => {
    try {
      const stmt = db.prepare(
        "DELETE FROM channel_access WHERE channel_name = ? AND sender_id = ?",
      );
      const result = stmt.run(channelName, senderId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Get all allowed senders for a channel
  getAllowedSenders: (channelName) => {
    try {
      const rows = db
        .prepare(
          "SELECT sender_id FROM channel_access WHERE channel_name = ? AND policy = ?",
        )
        .all(channelName, "allow");
      return rows.map((r) => r.sender_id);
    } catch (err) {
      throw err;
    }
  },
};

// Channel sessions database operations
const channelSessionsDb = {
  // Create or update session mapping
  setSession: (channelName, externalChatId, sessionId) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO channel_sessions (channel_name, external_chat_id, session_id)
        VALUES (?, ?, ?)
        ON CONFLICT(channel_name, external_chat_id)
        DO UPDATE SET session_id = excluded.session_id, updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(channelName, externalChatId, sessionId);
      return true;
    } catch (err) {
      throw err;
    }
  },

  // Get session for external chat
  getSession: (channelName, externalChatId) => {
    try {
      const row = db
        .prepare(
          "SELECT session_id FROM channel_sessions WHERE channel_name = ? AND external_chat_id = ?",
        )
        .get(channelName, externalChatId);
      return row?.session_id || null;
    } catch (err) {
      throw err;
    }
  },

  // Get all sessions for a channel
  getAllSessions: (channelName) => {
    try {
      const rows = db
        .prepare(
          "SELECT external_chat_id, session_id, created_at FROM channel_sessions WHERE channel_name = ?",
        )
        .all(channelName);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Delete session mapping
  deleteSession: (channelName, externalChatId) => {
    try {
      const stmt = db.prepare(
        "DELETE FROM channel_sessions WHERE channel_name = ? AND external_chat_id = ?",
      );
      const result = stmt.run(channelName, externalChatId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Delete ALL session mappings for a channel (e.g. when cwd/provider changes)
  clearAllSessions: (channelName) => {
    try {
      const stmt = db.prepare(
        "DELETE FROM channel_sessions WHERE channel_name = ?",
      );
      const result = stmt.run(channelName);
      return result.changes;
    } catch (err) {
      throw err;
    }
  },
};

const channelConfigDb = {
  // Get config for a channel (returns defaults if not set)
  getConfig: (channelName, options = {}) => {
    try {
      const row = db
        .prepare(
          "SELECT cwd, provider, model, app_id, app_secret, domain, bot_name, allowed_chat_types, use_persistent_pty, pty_idle_timeout_minutes FROM channel_config WHERE channel_name = ?",
        )
        .get(channelName);
      const allowedChatTypes = (() => {
        try {
          const parsed = JSON.parse(row?.allowed_chat_types || '["p2p"]');
          if (!Array.isArray(parsed)) return ["p2p"];
          const normalized = parsed.filter(
            (value) => value === "p2p" || value === "group",
          );
          return normalized.length > 0 ? normalized : ["p2p"];
        } catch {
          return ["p2p"];
        }
      })();
      return {
        cwd: row?.cwd || null,
        provider: row?.provider || "claude",
        model: row?.model || null,
        appId: row?.app_id || "",
        domain: row?.domain || "feishu",
        botName: row?.bot_name || "",
        allowedChatTypes,
        usePersistentPty: Boolean(row?.use_persistent_pty),
        ptyIdleTimeoutMinutes: row?.pty_idle_timeout_minutes || 30,
        ...(options.includeSecrets
          ? { appSecret: row?.app_secret || "" }
          : { hasAppSecret: Boolean(row?.app_secret) }),
      };
    } catch (err) {
      throw err;
    }
  },

  // Upsert config for a channel
  setConfig: (
    channelName,
    { cwd, provider, model, appId, appSecret, domain, botName, allowedChatTypes, usePersistentPty, ptyIdleTimeoutMinutes },
  ) => {
    try {
      const existing = db
        .prepare(
          "SELECT app_id, app_secret, domain, bot_name, allowed_chat_types, use_persistent_pty, pty_idle_timeout_minutes FROM channel_config WHERE channel_name = ?",
        )
        .get(channelName);
      const normalizedAllowedChatTypes = Array.isArray(allowedChatTypes)
        ? allowedChatTypes.filter(
            (value) => value === "p2p" || value === "group",
          )
        : [];
      const finalAllowedChatTypes = JSON.stringify(
        normalizedAllowedChatTypes.length > 0 ? normalizedAllowedChatTypes : ["p2p"],
      );
      const finalAppSecret =
        appSecret === undefined ? existing?.app_secret || null : appSecret || null;
      db.prepare(
        `
        INSERT INTO channel_config (
          channel_name,
          cwd,
          provider,
          model,
          app_id,
          app_secret,
          domain,
          bot_name,
          allowed_chat_types,
          use_persistent_pty,
          pty_idle_timeout_minutes,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(channel_name)
        DO UPDATE SET
          cwd                = excluded.cwd,
          provider           = excluded.provider,
          model              = excluded.model,
          app_id             = excluded.app_id,
          app_secret         = excluded.app_secret,
          domain             = excluded.domain,
          bot_name           = excluded.bot_name,
          allowed_chat_types = excluded.allowed_chat_types,
          use_persistent_pty = excluded.use_persistent_pty,
          pty_idle_timeout_minutes = excluded.pty_idle_timeout_minutes,
          updated_at         = CURRENT_TIMESTAMP
      `,
      ).run(
        channelName,
        cwd || null,
        provider || "claude",
        model || null,
        appId === undefined ? existing?.app_id || null : appId || null,
        finalAppSecret,
        domain === undefined ? existing?.domain || "feishu" : domain || "feishu",
        botName === undefined ? existing?.bot_name || null : botName || null,
        allowedChatTypes === undefined
          ? existing?.allowed_chat_types || '["p2p"]'
          : finalAllowedChatTypes,
        usePersistentPty === undefined ? existing?.use_persistent_pty || 0 : usePersistentPty ? 1 : 0,
        ptyIdleTimeoutMinutes === undefined ? existing?.pty_idle_timeout_minutes || 30 : ptyIdleTimeoutMinutes,
      );
      return true;
    } catch (err) {
      throw err;
    }
  },
};

export {
  db,
  initializeDatabase,
  userDb,
  apiKeysDb,
  credentialsDb,
  notificationPreferencesDb,
  pushSubscriptionsDb,
  sessionNamesDb,
  applyCustomSessionNames,
  appConfigDb,
  githubTokensDb, // Backward compatibility
  channelTokenDb, // Channel service tokens
  channelAccessDb, // Channel access control
  channelSessionsDb, // Channel session mappings
  channelConfigDb, // Channel working directory & provider config
};
