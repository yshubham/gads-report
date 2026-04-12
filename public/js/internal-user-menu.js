(function () {
  var menu = document.getElementById('navUserMenu');
  var trigger = document.getElementById('navUserTrigger');
  var dropdown = document.getElementById('navUserDropdown');
  if (!menu || !trigger || !dropdown) return;
  var THEME_KEY = 'site_theme_mode';

  var stored = localStorage.getItem(THEME_KEY);
  var isDark = stored === 'dark' || (stored === null && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (isDark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');

  dropdown.innerHTML = [
    '<div class="nav-dropdown-section">',
    '  <button type="button" class="nav-dropdown-action" id="openPwdModalBtn">Change password</button>',
    '</div>',
    '<div class="nav-dropdown-section nav-theme-row">',
    '  <span class="nav-theme-label">Night mode</span>',
    '  <label class="theme-switch" for="navThemeToggle">',
    '    <input type="checkbox" id="navThemeToggle" aria-label="Toggle dark mode">',
    '    <span class="theme-switch-slider"></span>',
    '  </label>',
    '</div>',
    '<div class="nav-dropdown-divider"></div>',
    '<button type="button" class="nav-dropdown-logout" id="logoutBtn">Log out</button>',
  ].join('');

  var modal = document.createElement('div');
  modal.className = 'pwd-modal';
  modal.id = 'pwdModal';
  modal.hidden = true;
  modal.innerHTML = [
    '<div class="pwd-modal-backdrop" data-close-pwd-modal></div>',
    '<div class="pwd-modal-card" role="dialog" aria-modal="true" aria-labelledby="pwdModalTitle">',
    '  <div class="pwd-modal-header">',
    '    <h3 id="pwdModalTitle">Change Password</h3>',
    '    <button type="button" class="pwd-modal-close" data-close-pwd-modal aria-label="Close">&times;</button>',
    '  </div>',
    '  <form id="pwdModalForm" class="pwd-modal-form">',
    '    <div class="input-group">',
    '      <label for="pwdOldInput">Old Password</label>',
    '      <input type="password" id="pwdOldInput" required autocomplete="current-password" class="nav-pwd-input">',
    '    </div>',
    '    <div class="input-group">',
    '      <label for="pwdNewInput">New Password</label>',
    '      <input type="password" id="pwdNewInput" required minlength="8" autocomplete="new-password" class="nav-pwd-input">',
    '    </div>',
    '    <div class="input-group">',
    '      <label for="pwdConfirmInput">Confirm Password</label>',
    '      <input type="password" id="pwdConfirmInput" required minlength="8" autocomplete="new-password" class="nav-pwd-input">',
    '    </div>',
    '    <button type="submit" class="btn btn-nav-pwd" id="pwdModalSubmit">Update password</button>',
    '  </form>',
    '  <div id="pwdModalStatus" class="form-status nav-pwd-status"></div>',
    '</div>',
  ].join('');
  document.body.appendChild(modal);

  function closeMenu() {
    dropdown.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    dropdown.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }

  trigger.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (dropdown.hidden) openMenu();
    else closeMenu();
  });

  document.addEventListener('click', function () {
    closeMenu();
  });

  dropdown.addEventListener('click', function (e) {
    e.stopPropagation();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeMenu();
      closePwdModal();
    }
  });

  function openPwdModal() {
    modal.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(function () {
      var oldInput = document.getElementById('pwdOldInput');
      if (oldInput) oldInput.focus();
    }, 20);
  }

  function closePwdModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  modal.querySelectorAll('[data-close-pwd-modal]').forEach(function (el) {
    el.addEventListener('click', closePwdModal);
  });

  var openPwdModalBtn = document.getElementById('openPwdModalBtn');
  if (openPwdModalBtn) {
    openPwdModalBtn.addEventListener('click', function () {
      closeMenu();
      openPwdModal();
    });
  }

  var themeToggle = document.getElementById('navThemeToggle');
  if (themeToggle) {
    themeToggle.checked = isDark;
    themeToggle.addEventListener('change', function () {
      if (themeToggle.checked) {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem(THEME_KEY, 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem(THEME_KEY, 'light');
      }
    });
  }

  var form = document.getElementById('pwdModalForm');
  var statusEl = document.getElementById('pwdModalStatus');
  var submitBtn = document.getElementById('pwdModalSubmit');

  function showPwdStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className =
      'form-status nav-pwd-status' + (msg ? ' show ' + (isError ? 'error' : 'success') : '');
  }

  if (form && submitBtn) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var cur = document.getElementById('pwdOldInput');
      var neu = document.getElementById('pwdNewInput');
      var con = document.getElementById('pwdConfirmInput');
      if (!cur || !neu || !con) return;
      if (neu.value !== con.value) {
        showPwdStatus('New password and confirm password do not match.', true);
        return;
      }
      submitBtn.disabled = true;
      showPwdStatus('', false);
      fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword: cur.value, newPassword: neu.value }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (r) {
          submitBtn.disabled = false;
          if (r.ok && r.data.success) {
            form.reset();
            showPwdStatus('Password updated.', false);
            setTimeout(closePwdModal, 700);
          } else {
            showPwdStatus((r.data && r.data.error) || 'Could not update password', true);
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          showPwdStatus('Request failed.', true);
        });
    });
  }

  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function (e) {
      e.preventDefault();
      closeMenu();
      fetch('/api/logout', { method: 'POST', credentials: 'include' }).finally(function () {
        sessionStorage.removeItem('username');
        sessionStorage.removeItem('role');
        window.location.href = '/Login.html';
      });
    });
  }
})();
