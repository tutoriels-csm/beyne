(function () {
  'use strict';

  const currentScript = document.currentScript;
  const siteRoot = currentScript ? new URL('.', currentScript.src) : new URL('./', window.location.href);
  const loginUrl = new URL('login.html', siteRoot).href;
  const homeUrl = new URL('index.html', siteRoot).href;

  const cfg = window.BEYNE_SUPABASE || {};
  const badConfig = !cfg.url || !cfg.publishableKey || cfg.url.includes('VOTRE-PROJET') || cfg.publishableKey.includes('VOTRE_CLE');

  function reveal() {
    document.documentElement.classList.remove('auth-pending');
  }

  function redirectToLogin() {
    const here = window.location.href;
    const url = new URL(loginUrl);
    url.searchParams.set('redirect', here);
    window.location.replace(url.href);
  }

  if (badConfig) {
    reveal();
    document.addEventListener('DOMContentLoaded', () => {
      const box = document.createElement('div');
      box.className = 'auth-config-warning';
      box.innerHTML = '<strong>Supabase n’est pas encore configuré.</strong><br>Renseignez l’URL du projet et la clé publique dans <code>supabase-config.js</code>.';
      document.body.prepend(box);
    });
    return;
  }

  if (!window.supabase || !window.supabase.createClient) {
    reveal();
    alert('Impossible de charger le module d’authentification Supabase. Vérifiez la connexion Internet.');
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  window.beyneSupabase = client;

  async function addAccountControls(user) {
    const nav = document.querySelector('.nav-actions');
    if (!nav || nav.querySelector('.auth-account')) return;

    const account = document.createElement('div');
    account.className = 'auth-account';
    account.title = user.email || 'Compte connecté';
    account.innerHTML = '<span class="auth-dot" aria-hidden="true"></span><span class="auth-email"></span>';
    account.querySelector('.auth-email').textContent = user.email || 'Connecté';

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'logout-btn';
    logout.textContent = 'Déconnexion';
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      logout.textContent = 'Déconnexion…';
      await client.auth.signOut();
      window.location.replace(loginUrl);
    });

    nav.prepend(logout);
    nav.prepend(account);
  }

  async function protect() {
    try {
      const { data, error } = await client.auth.getSession();
      if (error || !data.session || !data.session.user) {
        redirectToLogin();
        return;
      }
      await addAccountControls(data.session.user);
      reveal();
    } catch (e) {
      redirectToLogin();
    }
  }

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      redirectToLogin();
      return;
    }
    if (session && session.user && document.readyState !== 'loading') {
      addAccountControls(session.user);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', protect, { once: true });
  } else {
    protect();
  }
})();
