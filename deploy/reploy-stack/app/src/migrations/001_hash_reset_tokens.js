/**
 * Migration 001: Hash Reset Tokens
 * 
 * Adds a token_hash column to confirmation_requests table for hashed token storage.
 * Existing plaintext tokens are hashed on first app startup.
 */

const migration = {
  id: '001_hash_reset_tokens',
  
  up(db) {
    // Add token_hash column to store bcrypt-hashed tokens
    try {
      db.exec(`
        ALTER TABLE confirmation_requests 
        ADD COLUMN token_hash TEXT
      `);
      console.log('[MIGRATION] Added token_hash column to confirmation_requests');
    } catch (err) {
      if (err.message.includes('duplicate column name')) {
        console.log('[MIGRATION] token_hash column already exists, skipping');
      } else {
        throw err;
      }
    }
  },

  down(db) {
    // Remove token_hash column (rollback)
    try {
      db.exec(`
        ALTER TABLE confirmation_requests 
        DROP COLUMN token_hash
      `);
      console.log('[MIGRATION] Removed token_hash column from confirmation_requests');
    } catch (err) {
      if (err.message.includes('no such column')) {
        console.log('[MIGRATION] token_hash column does not exist, skipping removal');
      } else {
        throw err;
      }
    }
  }
};

module.exports = migration;
