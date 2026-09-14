(function () {
  var overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;

  var activeRequest = false;

  function showLoader() {
    if (activeRequest) return;
    activeRequest = true;
    overlay.style.display = 'flex';
  }

  function hideLoader() {
    activeRequest = false;
    overlay.style.display = 'none';
    document.querySelectorAll('button[data-loader-disabled]').forEach(function (btn) {
      btn.disabled = false;
      btn.removeAttribute('data-loader-disabled');
    });
  }

  function disableButton(btn) {
    btn.disabled = true;
    btn.setAttribute('data-loader-disabled', 'true');
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.classList.contains('no-loading')) return;
    if (e.defaultPrevented) return;

    var btns = form.querySelectorAll('button[type="submit"], input[type="submit"]');
    btns.forEach(disableButton);
    showLoader();
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-crud="true"]');
    if (!btn) return;
    if (btn.disabled) {
      e.preventDefault();
      return;
    }
    disableButton(btn);
    showLoader();
  });

  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      hideLoader();
    }
  });

  window.hideLoader = hideLoader;
  window.showLoader = showLoader;
})();
