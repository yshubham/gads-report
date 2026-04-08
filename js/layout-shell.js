(function () {
  var targets = document.querySelectorAll('[data-shared-footer]');
  if (!targets.length) return;
  targets.forEach(function (el) {
    if (el.dataset.ready === '1') return;
    el.dataset.ready = '1';
    el.className = 'site-footer';
    el.textContent = 'Kelvera Reporting Suite';
  });
})();
