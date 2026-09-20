/* The light/dark switch for docs, showcase and terms.
 *
 * main.js owns this on the home page, but it is written around that page's
 * markup - the spotlight, the canvas, the marquee - and loading it here
 * would throw on the first element that does not exist. This is the same
 * behaviour and, deliberately, the same storage key and the same class on
 * <html>, so a choice made on any page is the choice on all of them.
 *
 * Applied in <head>, before the body paints, so a light reader does not get
 * a black flash on every navigation.
 */
(function () {
  var KEY = 'smaran-theme';
  var media = window.matchMedia('(prefers-color-scheme: light)');

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function apply(theme) {
    document.documentElement.classList.toggle('light', theme === 'light');
    var label = theme === 'light' ? 'Switch to dark' : 'Switch to light';
    var buttons = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-label', label);
      buttons[i].setAttribute('title', label);
    }
  }

  var theme = stored() || (media.matches ? 'light' : 'dark');
  apply(theme);

  function wire() {
    var buttons = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        theme = theme === 'light' ? 'dark' : 'light';
        try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode */ }
        apply(theme);
      });
    }
    // Re-apply now the buttons exist, so their labels are right.
    apply(theme);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  // Follow the system only while nobody has chosen for themselves.
  media.addEventListener('change', function (e) {
    if (stored()) return;
    theme = e.matches ? 'light' : 'dark';
    apply(theme);
  });
})();
