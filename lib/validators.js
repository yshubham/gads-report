function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateUserPass(payload) {
  if (!payload || typeof payload !== 'object') return 'Invalid JSON body';
  const { username, password } = payload;
  if (!nonEmptyString(username) || !nonEmptyString(password)) {
    return 'Username and password are required';
  }
  if (password.trim().length < 8) return 'Password must be at least 8 characters';
  return null;
}

function validatePasswordChange(payload) {
  if (!payload || typeof payload !== 'object') return 'Invalid JSON body';
  const { currentPassword, newPassword } = payload;
  if (!nonEmptyString(currentPassword) || !nonEmptyString(newPassword)) {
    return 'currentPassword and newPassword are required';
  }
  if (newPassword.length < 8) return 'Password must be at least 8 characters';
  return null;
}

function validateDataUpdate(payload) {
  if (!payload || typeof payload !== 'object') return 'Invalid JSON body';
  const { clicks, impressions, ctr, cpc, cost } = payload;
  if (
    !Number.isFinite(clicks) || clicks < 0 ||
    !Number.isFinite(impressions) || impressions < 0 ||
    !Number.isFinite(ctr) || ctr < 0 ||
    !Number.isFinite(cpc) || cpc < 0 ||
    !Number.isFinite(cost) || cost < 0
  ) {
    return 'Missing or invalid fields: clicks, impressions, ctr, cpc, cost (all non-negative finite numbers)';
  }
  return null;
}

module.exports = {
  validateUserPass,
  validatePasswordChange,
  validateDataUpdate,
  nonEmptyString,
};
