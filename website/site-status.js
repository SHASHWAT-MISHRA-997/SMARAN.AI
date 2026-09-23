/* The footer's System Status card, filled from the real release.
 *
 * "Downloads" is only called operational when the latest public release is
 * there and carries files; the version shown is that release's tag. If GitHub
 * cannot be reached (offline, rate-limited, blocked) the card says it could
 * not check, rather than claiming everything is fine.
 */
(function () {
  var rows = document.querySelectorAll('[data-status="downloads"]');
  var versions = document.querySelectorAll('[data-live-version]');
  if ((!rows.length && !versions.length) || !window.fetch) return;

  var set = function (text, cls) {
    Array.prototype.forEach.call(rows, function (row) {
      row.textContent = text;
      row.className = cls;
    });
  };

  fetch('https://api.github.com/repos/SHASHWAT-MISHRA-997/SMARAN.AI-downloads/releases/latest',
        { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (response) {
      if (!response.ok) throw new Error(response.status);
      return response.json();
    })
    .then(function (release) {
      var hasFiles = (release.assets || []).length > 0;
      set(hasFiles ? 'OPERATIONAL' : 'NO FILES', hasFiles ? 'status-ok' : 'status-wait');
      var tag = String(release.tag_name || release.name || '').trim();
      if (!tag) return;
      if (/^\d/.test(tag)) tag = 'v' + tag;
      Array.prototype.forEach.call(versions, function (node) { node.textContent = tag; });
    })
    .catch(function () { set('COULD NOT CHECK', 'status-wait'); });
})();
