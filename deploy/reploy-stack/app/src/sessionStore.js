const session = require("express-session");

/**
 * A simple SQLite-backed session store for express-session,
 * using better-sqlite3 (the DB driver already in use).
 */
class SqliteSessionStore extends session.Store {
  /**
   * @param {import("better-sqlite3").Database} db
   */
  constructor(db) {
    super();
    this.db = db;
  }

  get(sid, callback) {
    try {
      const row = this.db
        .prepare("SELECT sess FROM sessions WHERE sid = ? AND expired > datetime('now')")
        .get(sid);
      if (!row) return callback(null, null);
      callback(null, JSON.parse(row.sess));
    } catch (err) {
      console.error(`[SESSION] get failed: sid=${sid.substring(0, 8)}… – ${err.message}`);
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || 86400000; // default 1 day
      this.db
        .prepare(
          "INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, datetime('now', '+' || ? || ' seconds'))"
        )
        .run(sid, JSON.stringify(sess), Math.ceil(maxAge / 1000));
      callback(null);
    } catch (err) {
      console.error(`[SESSION] set failed: sid=${sid.substring(0, 8)}… – ${err.message}`);
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback(null);
    } catch (err) {
      console.error(`[SESSION] destroy failed: sid=${sid.substring(0, 8)}… – ${err.message}`);
      callback(err);
    }
  }

  touch(sid, sess, callback) {
    // Update the expiry time
    this.set(sid, sess, callback);
  }
}

module.exports = { SqliteSessionStore };
