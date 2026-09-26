/* Pictures a generated page names but nobody has.

   Models write <img src="wedding1.jpg"> for files that do not exist, and the
   page arrived with a row of broken-image icons and alt text where its gallery
   should be. Each picture that fails to load is replaced with a soft
   placeholder of a sensible shape, labelled with its alt text, so the layout
   reads as intended until real photos are dropped in. Nothing is fetched from
   anywhere: the placeholder is drawn in the page itself. */

const FALLBACK = `<script data-smaran-images>(function () {
  function placeholder(img) {
    img.onerror = null;
    var label = String(img.alt || 'Image').replace(/[<>&"]/g, '').slice(0, 40);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="#e2e8f0"/><stop offset="1" stop-color="#cbd5e1"/></linearGradient></defs>'
      + '<rect width="600" height="400" fill="url(#g)"/>'
      + '<text x="300" y="200" text-anchor="middle" dominant-baseline="middle" '
      + 'font-family="system-ui,sans-serif" font-size="22" fill="#475569">' + label + '</text></svg>';
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    img.style.objectFit = 'cover';
    if (!img.getAttribute('height') && !img.style.height) img.style.aspectRatio = '3 / 2';
    if (!img.getAttribute('width') && !img.style.width) img.style.width = '100%';
  }
  function watch(img) {
    if (img.complete && img.naturalWidth === 0) placeholder(img);
    else img.addEventListener('error', function () { placeholder(img); });
  }
  function run() { Array.prototype.forEach.call(document.images, watch); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();</script>`;

/* Two layout mistakes generated pages make again and again:
   - `body { height: 100vh; justify-content: center }` centres a page that is
     taller than the window, pushing its top above the screen where no scroll
     reaches - the heading and gallery of a portfolio simply vanished;
   - `width: 100%` plus padding without border-box sizing, which pushes the
     page wider than the window and adds a sideways scrollbar.
   Box sizing goes first so the page's own rules can still change it; the
   height fix has to win over them. */
const SAFETY = '<style data-smaran-safety>*,*::before,*::after{box-sizing:border-box}'
  + 'body{height:auto!important;min-height:100vh}</style>';

function insertSafety(page) {
  const head = page.search(/<head[^>]*>/i);
  if (head >= 0) {
    const at = page.indexOf('>', head) + 1;
    return page.slice(0, at) + SAFETY + page.slice(at);
  }
  return SAFETY + page;
}

export function withImageFallback(html) {
  let page = String(html || '');
  if (!page) return page;
  if (/<(html|body|head)\b/i.test(page) && !page.includes('data-smaran-safety')) page = insertSafety(page);
  if (page.includes('data-smaran-images') || !/<img\b/i.test(page)) return page;
  const end = page.search(/<\/body>/i);
  return end >= 0 ? page.slice(0, end) + FALLBACK + page.slice(end) : page + FALLBACK;
}
