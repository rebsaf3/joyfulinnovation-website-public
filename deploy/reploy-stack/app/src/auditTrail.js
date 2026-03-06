const { reqMeta } = require("./systemLogger");

function diffKeys(before, after) {
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  const changed = [];
  for (const k of keys) {
    if ((before || {})[k] !== (after || {})[k]) changed.push(k);
  }
  return changed.sort();
}

/**
 * Convenience helper for privileged mutations.
 * Writes a single structured entry into `system_log` via `syslog.raw`.
 */
function logMutation(syslog, req, {
  category,
  action,
  actorId,
  actorEmail,
  actorType = "user",
  companyId,
  companyName,
  resourceType,
  resourceId,
  before,
  after,
  details,
  meta,
  severity,
} = {}) {
  const changedKeys = diffKeys(before, after);
  return syslog.raw({
    category,
    action,
    severity: severity || (changedKeys.length ? "warning" : "info"),
    actorId,
    actorEmail,
    actorType,
    companyId,
    companyName,
    resourceType,
    resourceId,
    details: details || `${action} (${changedKeys.join(", ") || "no changes"})`,
    meta: {
      ...(meta || {}),
      changedKeys,
      before: before || null,
      after: after || null,
    },
    ...reqMeta(req),
  });
}

module.exports = { logMutation, diffKeys };

