/**
 * LOG SANITIZATION UTILITY (SEC-006)
 *
 * Removes sensitive data from logs to prevent accidental exposure of:
 * - Authentication tokens (password reset, email confirmation)
 * - API keys (Anthropic, OpenAI, Stripe, etc.)
 * - Session tokens and JWTs
 * - Credit card numbers and sensitive PII
 *
 * Usage:
 *   const safeMessage = sanitizeLog("User confirmed token: abc123def456");
 *   const safeObj = sanitizeSensitiveFields({ token: "secret", email: "ok@example.com" });
 */

/**
 * Sanitize a log message by removing/masking sensitive patterns
 * @param {string|any} message
 * @returns {string} Sanitized message
 */
function sanitizeLog(message) {
  if (typeof message !== 'string') {
    return String(message);
  }

  let sanitized = message;

  // Pattern 1: 32-character hex tokens (password reset, confirmation)
  sanitized = sanitized.replace(/\b[a-f0-9]{32,}\b/gi, '[REDACTED_TOKEN]');

  // Pattern 2: sk-ant-* Anthropic API keys
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9_-]{40,}/g, '[REDACTED_ANTHROPIC_KEY]');

  // Pattern 3: sk-proj-* OpenAI API keys
  sanitized = sanitized.replace(/sk-proj-[a-zA-Z0-9_-]{40,}/g, '[REDACTED_OPENAI_KEY]');

  // Pattern 4: sk_live_* or sk_test_* Stripe API keys
  sanitized = sanitized.replace(/sk_(live|test)_[a-zA-Z0-9_-]{40,}/g, '[REDACTED_STRIPE_KEY]');

  // Pattern 5: Bearer tokens in Authorization headers
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED_TOKEN]');

  // Pattern 6: Full email addresses (replace after @ with ****)
  sanitized = sanitized.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, (match) => {
    const [local] = match.split('@');
    return `${local.slice(0, 2)}****@****`;
  });

  // Pattern 7: Credit card numbers (4-digit blocks)
  sanitized = sanitized.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '****-****-****-****');

  // Pattern 8: Passwords in connection strings or URIs
  sanitized = sanitized.replace(/password[=:]\s*[^\s&;]*/gi, 'password=[REDACTED]');
  sanitized = sanitized.replace(/passwd[=:]\s*[^\s&;]*/gi, 'passwd=[REDACTED]');
  sanitized = sanitized.replace(/pwd[=:]\s*[^\s&;]*/gi, 'pwd=[REDACTED]');

  // Pattern 9: JWT tokens (eyJ....)
  sanitized = sanitized.replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]');

  return sanitized;
}

/**
 * Remove sensitive fields from an object before logging
 * Safe for passing to JSON.stringify()
 *
 * @param {object} obj
 * @param {string[]} fieldsToRemove - Field names to completely redact
 * @param {string[]} fieldsTruncate - Field names to show first 4 chars
 * @returns {object} Sanitized copy
 */
function sanitizeSensitiveFields(obj, fieldsToRemove = [], fieldsTruncate = []) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  // Default sensitive fields
  const toRemove = new Set([
    'password', 'password_hash', 'token', 'token_hash', 'secret', 
    'api_key', 'apiKey', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
    'Authorization', 'authorization', 'X-API-Key', 'x-api-key',
    'creditCard', 'credit_card', 'ssn', 'stripeToken',
    ...fieldsToRemove
  ]);

  const toTruncate = new Set([
    'email', 'phone', 'ipAddress', 'ip_address',
    ...fieldsTruncate
  ]);

  const sanitized = Array.isArray(obj) ? [] : {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (toRemove.has(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (toTruncate.has(key) && typeof value === 'string') {
      sanitized[key] = `${value.slice(0, 4)}****`;
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeSensitiveFields(value, fieldsToRemove, fieldsTruncate);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * React to token-related operations safely
 * Returns a sanitized version fit for logs
 *
 * @param {string} token - Raw token (32+ hex chars)
 * @returns {string} First 4 chars + "****" for identification without exposure
 */
function maskToken(token) {
  if (!token || typeof token !== 'string') return '[INVALID]';
  if (token.length < 4) return '[TOO_SHORT]';
  return `${token.slice(0, 4)}****`;
}

module.exports = {
  sanitizeLog,
  sanitizeSensitiveFields,
  maskToken,
};
