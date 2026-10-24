// Keep public-page account links in sync with the server-side login session.
(() => {
  const links = [...document.querySelectorAll('a[href="/?account=login"]')];
  if (!links.length) return;
  const loginURL = '/?account=login&returnTo=' + encodeURIComponent(location.pathname + location.search + location.hash);
  async function refreshAccount() {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Account service unavailable');
      const { customer } = await response.json();
      for (const link of links) {
        link.textContent = customer ? 'My account' : 'Sign in / Register';
        link.href = customer ? '/?account=login' : loginURL;
        link.setAttribute('aria-label', customer ? 'Open your signed-in account' : 'Sign in or create an account');
      }
    } catch {
      // Navigation must still work when the account service cannot be reached.
      for (const link of links) link.href = loginURL;
    }
  }
  refreshAccount();
  window.addEventListener('pageshow', refreshAccount);
  window.addEventListener('focus', refreshAccount);
})();
