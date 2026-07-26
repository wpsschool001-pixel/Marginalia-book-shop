(() => {
  let mode = 'login'; // or 'register'

  const els = {
    title: document.getElementById('formTitle'),
    sub: document.getElementById('formSub'),
    form: document.getElementById('authForm'),
    submitBtn: document.getElementById('submitBtn'),
    switchPrompt: document.getElementById('switchPrompt'),
    switchBtn: document.getElementById('switchBtn'),
    error: document.getElementById('authError'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
  };

  function setMode(next) {
    mode = next;
    els.error.hidden = true;
    if (mode === 'login') {
      els.title.textContent = 'Welcome back';
      els.sub.textContent = 'Sign in to browse the shelves.';
      els.submitBtn.textContent = 'Sign in';
      els.switchPrompt.textContent = 'New here?';
      els.switchBtn.textContent = 'Create an account';
      els.password.setAttribute('autocomplete', 'current-password');
    } else {
      els.title.textContent = 'Create your account';
      els.sub.textContent = 'Pick a username and password — at least 6 characters.';
      els.submitBtn.textContent = 'Create account';
      els.switchPrompt.textContent = 'Already have an account?';
      els.switchBtn.textContent = 'Sign in instead';
      els.password.setAttribute('autocomplete', 'new-password');
    }
  }

  els.switchBtn.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.error.hidden = true;
    els.submitBtn.disabled = true;

    const username = els.username.value.trim();
    const password = els.password.value;
    const endpoint = mode === 'login' ? '/api/login' : '/api/register';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        els.error.textContent = data.error || 'Something went wrong.';
        els.error.hidden = false;
        els.submitBtn.disabled = false;
        return;
      }

      window.location.href = '/';
    } catch {
      els.error.textContent = 'Could not reach the server. Check your connection and try again.';
      els.error.hidden = false;
      els.submitBtn.disabled = false;
    }
  });

  setMode('login');
})();
