// Shared by every room. Restore before styles paint, including direct links.
(() => {
  const root = document.documentElement;
  function apply(theme) {
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
  }
  function restore() {
    try { apply(localStorage.getItem('theme')); } catch { /* Keep the current page usable without storage. */ }
  }
  restore();

  document.addEventListener('click', event => {
    if (!event.target.closest?.('#themeBtn')) return;
    const current = root.dataset.theme
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('theme', next); } catch { /* Still applies to this page. */ }
  });
  window.addEventListener('storage', event => {
    if (event.key === 'theme' || event.key === null) restore();
  });
  // A browser back gesture can restore a page without rerunning its scripts.
  window.addEventListener('pageshow', restore);
})();
