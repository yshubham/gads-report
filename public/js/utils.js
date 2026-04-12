// Shared utility functions used across multiple pages.

function normalizeLogoSrc(logoPath) {
  if (!logoPath) return '';
  var s = String(logoPath).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) return s;
  return '/' + s.replace(/^\/+/, '');
}

function randomInRange(min, max, decimals) {
  decimals = (decimals === undefined || decimals === null) ? 2 : decimals;
  var value = Math.random() * (max - min) + min;
  return parseFloat(value.toFixed(decimals));
}

function getIstDateKey(date) {
  var d = date != null ? date : new Date();
  var dt = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  var y = dt.getFullYear();
  var m = String(dt.getMonth() + 1).padStart(2, '0');
  var day = String(dt.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}


function formatIstDate(date) {
  var d = date != null ? date : new Date();
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function formatIstLongFromKey(dateKey) {
  var d = new Date(dateKey + 'T12:00:00+05:30');
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function showStatus(message, isError) {
  var el = document.getElementById('formStatus');
  if (!el) return;
  el.textContent = message;
  el.className = 'form-status show ' + (isError ? 'error' : 'success');
}
