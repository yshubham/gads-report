function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateUserPass(payload) {
  if (!payload || typeof payload !== 'object') return 'Invalid JSON body';
  const { username, password } = payload;
  if (!nonEmptyString(username) || !nonEmptyString(password)) {
    return 'Username and password are required';
  }
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
    typeof clicks !== 'number' ||
    typeof impressions !== 'number' ||
    typeof ctr !== 'number' ||
    typeof cpc !== 'number' ||
    typeof cost !== 'number'
  ) {
    return 'Missing or invalid fields: clicks, impressions, ctr, cpc, cost (all numbers)';
  }
  return null;
}

module.exports = {
  validateUserPass,
  validatePasswordChange,
  validateDataUpdate,
  nonEmptyString,
};
