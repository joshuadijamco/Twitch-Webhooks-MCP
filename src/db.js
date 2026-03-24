import Database from 'better-sqlite3';

export function createDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      twitch_user_id TEXT NOT NULL,
      online_subscription_id TEXT,
      offline_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      last_online_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS webhook_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      condition TEXT NOT NULL,
      action TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      webhook_token TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return {
    addUser({ username, twitchUserId, onlineSubscriptionId, offlineSubscriptionId }) {
      db.prepare(`
        INSERT INTO watched_users (username, twitch_user_id, online_subscription_id, offline_subscription_id)
        VALUES (?, ?, ?, ?)
      `).run(username.toLowerCase(), twitchUserId, onlineSubscriptionId, offlineSubscriptionId);
    },

    removeUser(username) {
      db.prepare('DELETE FROM watched_users WHERE username = ?').run(username.toLowerCase());
    },

    getUser(username) {
      return db.prepare('SELECT * FROM watched_users WHERE username = ?').get(username.toLowerCase()) || null;
    },

    getUsers() {
      return db.prepare('SELECT * FROM watched_users ORDER BY username').all();
    },

    setUserOnline(username) {
      db.prepare(`
        UPDATE watched_users SET status = 'online', last_online_at = datetime('now')
        WHERE username = ?
      `).run(username.toLowerCase());
    },

    setUserOffline(username) {
      db.prepare("UPDATE watched_users SET status = 'offline' WHERE username = ?")
        .run(username.toLowerCase());
    },

    updateSubscriptionIds(username, onlineSubId, offlineSubId) {
      db.prepare(`
        UPDATE watched_users SET online_subscription_id = ?, offline_subscription_id = ?
        WHERE username = ?
      `).run(onlineSubId, offlineSubId, username.toLowerCase());
    },

    saveWebhookConfig({ condition, action, webhookUrl, webhookToken }) {
      db.prepare(`
        INSERT INTO webhook_config (id, condition, action, webhook_url, webhook_token)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          condition = excluded.condition,
          action = excluded.action,
          webhook_url = excluded.webhook_url,
          webhook_token = excluded.webhook_token,
          created_at = datetime('now')
      `).run(condition, action, webhookUrl, webhookToken);
    },

    getWebhookConfig() {
      return db.prepare('SELECT * FROM webhook_config WHERE id = 1').get() || null;
    },

    clearAll() {
      db.prepare('DELETE FROM watched_users').run();
      db.prepare('DELETE FROM webhook_config').run();
    },

    close() {
      db.close();
    },
  };
}
