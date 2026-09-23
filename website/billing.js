/* SMARAN.AI Pro checkout (Razorpay).
 *
 * Asks the billing function whether payments are open. While they are not -
 * the launch period - the Pro card stays exactly as the page renders it: free,
 * with a download button. When they are, the card shows ₹700 / month and the
 * button opens Razorpay's own checkout (UPI, cards, netbanking, wallets).
 * The card details never touch this site; Razorpay's window collects them,
 * and the server checks Razorpay's signature before issuing a licence key.
 */
(function () {
  var card = document.querySelector('[data-pro-plan]');
  if (!card || !window.fetch) return;
  var price = card.querySelector('[data-pro-price]');
  var note = card.querySelector('[data-pro-note]');
  var later = card.querySelector('[data-pro-later]');
  var cta = card.querySelector('[data-pro-cta]');
  var keyId = null;

  fetch('/api/billing/config', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !cfg.enabled || !cfg.keyId) return;   // launch period: leave it free
      keyId = cfg.keyId;
      price.textContent = '₹' + Math.round(cfg.amount / 100);
      note.textContent = 'BILLED MONTHLY · CANCEL ANYTIME';
      later.textContent = 'Outside India? Pay by card; your bank converts from INR (about US$8).';
      cta.textContent = 'Subscribe — ₹' + Math.round(cfg.amount / 100) + ' / month';
      cta.setAttribute('href', '#pricing');
      cta.addEventListener('click', function (e) { e.preventDefault(); openDialog(); });
    })
    .catch(function () { /* billing unreachable: the free card stays */ });

  var dialog, form, email, agree, msg, submit;

  function openDialog() {
    if (!dialog) build();
    msg.textContent = '';
    dialog.showModal();
    email.focus();
  }

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'pay-dialog';
    dialog.setAttribute('aria-labelledby', 'payTitle');
    dialog.innerHTML =
      '<form method="dialog" class="pay-form" novalidate>' +
      '<button type="button" class="pay-x" aria-label="Close">&times;</button>' +
      '<span class="pay-eyebrow">SMARAN.AI PRO</span>' +
      '<h3 id="payTitle">₹700 / month</h3>' +
      '<p class="pay-sub">Pay with UPI, cards, netbanking or wallets through Razorpay. Cancel any time.</p>' +
      '<label class="pay-label" for="payEmail">Email for your receipt and licence</label>' +
      '<input id="payEmail" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" />' +
      '<label class="pay-agree"><input type="checkbox" id="payAgree" /> <span>I agree to the <a href="terms.html" target="_blank" rel="noopener">Terms</a> and the <a href="refund.html" target="_blank" rel="noopener">Cancellation &amp; Refund Policy</a>.</span></label>' +
      '<p class="pay-msg" role="status" aria-live="polite"></p>' +
      '<button type="submit" class="btn btn-primary lg no-lift pay-go">Continue to secure payment</button>' +
      '<p class="pay-fine">Payments are processed by Razorpay. SMARAN.AI never sees your card or UPI details.</p>' +
      '</form>';
    document.body.appendChild(dialog);
    form = dialog.querySelector('form');
    email = dialog.querySelector('#payEmail');
    agree = dialog.querySelector('#payAgree');
    msg = dialog.querySelector('.pay-msg');
    submit = dialog.querySelector('.pay-go');
    dialog.querySelector('.pay-x').addEventListener('click', function () { dialog.close(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); start(); });
  }

  function say(text, bad) {
    msg.textContent = text;
    msg.classList.toggle('bad', !!bad);
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
        return data;
      });
    });
  }

  function loadCheckout() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load the payment window. Check your connection.')); };
      document.head.appendChild(s);
    });
  }

  function start() {
    var address = email.value.trim();
    if (!email.checkValidity() || !address) return say('Enter a valid email address.', true);
    if (!agree.checked) return say('Please accept the Terms and the Refund Policy.', true);
    submit.disabled = true;
    say('Opening secure payment…');
    Promise.all([post('/api/billing/subscribe', { email: address }), loadCheckout()])
      .then(function (res) {
        var sub = res[0];
        var rzp = new window.Razorpay({
          key: sub.keyId || keyId,
          subscription_id: sub.subscriptionId,
          name: 'SMARAN.AI',
          description: 'Pro — monthly',
          image: location.origin + '/assets/logo.png',
          prefill: { email: address },
          theme: { color: '#ef4444' },
          handler: function (payment) { finish(payment); },
          modal: { ondismiss: function () { submit.disabled = false; say('Payment cancelled. Nothing was charged.'); } },
        });
        rzp.on('payment.failed', function (r) {
          submit.disabled = false;
          say((r && r.error && r.error.description) || 'The payment failed. Nothing was charged.', true);
        });
        dialog.close();
        rzp.open();
      })
      .catch(function (err) { submit.disabled = false; say(err.message, true); });
  }

  function finish(payment) {
    openDialog();
    say('Confirming your payment…');
    submit.disabled = true;
    post('/api/billing/verify', payment)
      .then(function (res) { showLicense(res.license); })
      .catch(function (err) {
        say(err.message + ' If money was taken, email us with this payment id: ' + (payment.razorpay_payment_id || ''), true);
      });
  }

  function showLicense(license) {
    form.innerHTML =
      '<button type="button" class="pay-x" aria-label="Close">&times;</button>' +
      '<span class="pay-eyebrow">WELCOME TO PRO</span>' +
      '<h3>Payment confirmed</h3>' +
      '<p class="pay-sub">This is your Pro licence key. Keep it safe: you use it to activate Pro in SMARAN.AI. Razorpay emails your receipt.</p>' +
      '<textarea class="pay-key" readonly rows="4"></textarea>' +
      '<button type="button" class="btn btn-primary lg no-lift pay-copy">Copy licence key</button>';
    var box = form.querySelector('.pay-key');
    box.value = license;
    form.querySelector('.pay-x').addEventListener('click', function () { dialog.close(); });
    form.querySelector('.pay-copy').addEventListener('click', function (e) {
      box.select();
      (navigator.clipboard ? navigator.clipboard.writeText(license) : Promise.reject())
        .then(function () { e.target.textContent = 'Copied'; })
        .catch(function () { document.execCommand('copy'); e.target.textContent = 'Copied'; });
    });
  }
})();
