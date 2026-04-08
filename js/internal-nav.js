(function () {
  var role = sessionStorage.getItem('role');
  var dash = role === 'admin' ? '/AdminDashboard.html' : '/Dashboard.html';
  document.querySelectorAll('[data-internal-home]').forEach(function (el) {
    el.setAttribute('href', dash);
  });
  if (role !== 'admin') {
    document.querySelectorAll('[data-nav-admin-only]').forEach(function (el) {
      el.style.display = 'none';
    });
  }
})();
