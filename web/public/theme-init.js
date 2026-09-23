// Applies the saved theme before first paint to avoid a light/dark flash.
// Lives in its own file (not inline) so it works under `script-src 'self'`.
(function () {
  try {
    var pref = localStorage.getItem('arkive.theme');
    var dark =
      pref === 'dark' ||
      (pref !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var theme = dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.getElementById('theme-color');
    if (meta) meta.setAttribute('content', dark ? '#111317' : '#f5f5f3');
  } catch (e) {
    /* defaults to light */
  }
})();
