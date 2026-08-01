(() => {
  const params = new URLSearchParams(window.location.search);
  const bookId = Number(params.get('book'));
  const contentEl = document.getElementById('payContent');

  function shade(hex, percent) {
    const n = parseInt(hex.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
    const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
    return `rgb(${r},${g},${b})`;
  }
  function formatPrice(price) {
    if (price === 0) return 'Free';
    return `₦${Math.round(price).toLocaleString('en-NG')}`;
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  async function init() {
    if (!bookId) {
      contentEl.innerHTML = '<p>No book was specified.</p>';
      return;
    }

    const [meRes, configRes, bookRes] = await Promise.all([
      fetch('/api/me'),
      fetch('/api/config'),
      fetch(`/api/books/${bookId}`),
    ]);

    if (meRes.status === 401) {
      window.location.href = '/';
      return;
    }
    if (!bookRes.ok) {
      contentEl.innerHTML = '<p>Could not find that book.</p>';
      return;
    }

    const me = await meRes.json();
    const config = await configRes.json();
    const book = await bookRes.json();

    if (book.unlocked) {
      contentEl.innerHTML = `
        <h2 class="pay-title">You already have this book</h2>
        <p class="pay-author">${escapeHtml(book.title)}</p>
        <a class="pay-submit" style="display:block; text-align:center; text-decoration:none; box-sizing:border-box;" href="/api/books/${book.id}/file" target="_blank" rel="noopener">Download book file</a>
      `;
      return;
    }

    const cat = book.category;
    contentEl.innerHTML = `
      <div class="pay-cover" style="background:linear-gradient(160deg, ${cat.color}, ${shade(cat.color, -30)});">
        <span class="initial">${escapeHtml(book.title[0])}</span>
      </div>
      <h2 class="pay-title">${escapeHtml(book.title)}</h2>
      <p class="pay-author">by ${escapeHtml(book.author)}</p>
      <div class="pay-price-row">
        <span>Price</span>
        <span class="pay-price">${formatPrice(book.price)}</span>
      </div>
      <button class="pay-submit" id="payBtn" type="button">Pay ${formatPrice(book.price)} with Paystack</button>
      <p class="pay-status" id="payStatus"></p>
    `;

    document.getElementById('payBtn').addEventListener('click', () => {
      const statusEl = document.getElementById('payStatus');
      if (!window.PaystackPop) {
        statusEl.textContent = 'Payment library failed to load. Check your internet connection.';
        statusEl.className = 'pay-status error';
        return;
      }
      if (!config.paystackPublicKey) {
        statusEl.textContent = 'Payments are not set up yet — the site owner needs to add a Paystack public key.';
        statusEl.className = 'pay-status error';
        return;
      }
      if (!me.email) {
        statusEl.textContent = 'Your account is missing an email address, which Paystack requires.';
        statusEl.className = 'pay-status error';
        return;
      }

      const reference = `smtf_${book.id}_${Date.now()}`;
      const handler = window.PaystackPop.setup({
        key: config.paystackPublicKey,
        email: me.email,
        amount: Math.round(book.price * 100), // kobo
        currency: 'NGN',
        ref: reference,
        callback: (response) => verify(response.reference),
        onClose: () => {
          statusEl.textContent = 'Payment window closed.';
          statusEl.className = 'pay-status';
        },
      });
      handler.openIframe();
    });

    async function verify(reference) {
      const statusEl = document.getElementById('payStatus');
      statusEl.textContent = 'Confirming payment…';
      statusEl.className = 'pay-status';
      try {
        const res = await fetch('/api/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference, bookId: book.id }),
        });
        const data = await res.json();
        if (!res.ok) {
          statusEl.textContent = data.error || 'Payment could not be confirmed.';
          statusEl.className = 'pay-status error';
          return;
        }
        statusEl.textContent = 'Payment confirmed! Redirecting…';
        statusEl.className = 'pay-status success';
        setTimeout(() => { window.location.href = '/'; }, 1200);
      } catch {
        statusEl.textContent = 'Could not reach the server to confirm payment.';
        statusEl.className = 'pay-status error';
      }
    }
  }

  init();
})();
