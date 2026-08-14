(function () {
  'use strict';

  const currentScript = document.currentScript;
  const siteRoot = currentScript ? new URL('.', currentScript.src) : new URL('./', window.location.href);
  const loginUrl = new URL('login.html', siteRoot).href;
  const cfg = window.BEYNE_SUPABASE || {};
  const badConfig = !cfg.url || !cfg.publishableKey || cfg.url.includes('VOTRE-PROJET') || cfg.publishableKey.includes('VOTRE_CLE');
  const SESSION_META_KEY = 'beyne_active_session';
  const SESSION_TIME_KEY = 'beyne_active_session_at';
  const CHECK_INTERVAL_MS = 5000;
  const INACTIVITY_LIMIT_MS = 10 * 60 * 1000; // 10 minutes
  const ACTIVITY_WRITE_THROTTLE_MS = 5000;
  const IDLE_CHECK_INTERVAL_MS = 15000;
  const LAST_ACTIVITY_KEY = 'beyne_last_activity_at';
  let checkTimer = null;
  let idleTimer = null;
  let checking = false;
  let lastActivityWrite = 0;
  let idleLogoutRunning = false;

  function storageKey(userId){ return 'beyne_device_session_' + userId; }
  function newSessionToken(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
  }
  function reveal(){ document.documentElement.classList.remove('auth-pending'); }
  function redirectToLogin(reason){
    const here = window.location.href;
    const url = new URL(loginUrl);
    url.searchParams.set('redirect', here);
    if (reason) url.searchParams.set('reason', reason);
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
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.beyneSupabase = client;

  function recordActivity(force){
    const now = Date.now();
    if (!force && now - lastActivityWrite < ACTIVITY_WRITE_THROTTLE_MS) return;
    lastActivityWrite = now;
    try { localStorage.setItem(LAST_ACTIVITY_KEY, String(now)); } catch(e){}
  }

  function readLastActivity(){
    try {
      const value = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch(e){ return 0; }
  }

  async function logoutForInactivity(){
    if (idleLogoutRunning) return;
    idleLogoutRunning = true;
    if (checkTimer) clearInterval(checkTimer);
    if (idleTimer) clearInterval(idleTimer);
    try {
      const { data } = await client.auth.getSession();
      const user = data && data.session && data.session.user;
      if (user) localStorage.removeItem(storageKey(user.id));
      localStorage.removeItem(LAST_ACTIVITY_KEY);
    } catch(e){}
    try { await client.auth.signOut({ scope: 'local' }); } catch(e){}
    const url = new URL(loginUrl);
    url.searchParams.set('reason', 'inactivity');
    window.location.replace(url.href);
  }

  function checkInactivity(){
    const last = readLastActivity();
    if (!last) { recordActivity(true); return; }
    if (Date.now() - last >= INACTIVITY_LIMIT_MS) logoutForInactivity();
  }

  function startInactivityTracking(){
    recordActivity(true);
    const activityEvents = ['pointerdown','keydown','scroll','touchstart'];
    activityEvents.forEach(evt => window.addEventListener(evt, () => recordActivity(false), { passive:true }));
    window.addEventListener('mousemove', () => recordActivity(false), { passive:true });
    window.addEventListener('focus', () => { checkInactivity(); if (!idleLogoutRunning) recordActivity(true); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        checkInactivity();
        if (!idleLogoutRunning) recordActivity(true);
      }
    });
    idleTimer = window.setInterval(checkInactivity, IDLE_CHECK_INTERVAL_MS);
  }

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
      try { localStorage.removeItem(storageKey(user.id)); localStorage.removeItem(LAST_ACTIVITY_KEY); } catch(e){}
      await client.auth.signOut({ scope: 'local' });
      window.location.replace(loginUrl);
    });
    nav.prepend(logout);
    nav.prepend(account);
  }

  async function bootstrapLegacySession(user){
    // Migration douce : si aucun jeton actif n'existe encore pour ce compte,
    // le navigateur déjà connecté devient la première session enregistrée.
    const token = newSessionToken();
    const { data, error } = await client.auth.updateUser({
      data: {
        [SESSION_META_KEY]: token,
        [SESSION_TIME_KEY]: new Date().toISOString()
      }
    });
    if (error) throw error;
    const id = (data && data.user && data.user.id) || user.id;
    localStorage.setItem(storageKey(id), token);
    return token;
  }

  async function verifyUniqueSession(options){
    if (checking) return true;
    checking = true;
    try {
      const { data:sessionData, error:sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData.session || !sessionData.session.user) {
        redirectToLogin();
        return false;
      }

      // getUser() interroge le serveur Auth : on ne se contente pas du JWT local.
      const { data:userData, error:userError } = await client.auth.getUser();
      if (userError || !userData.user) {
        redirectToLogin();
        return false;
      }
      const user = userData.user;
      let serverToken = user.user_metadata && user.user_metadata[SESSION_META_KEY];
      let localToken = localStorage.getItem(storageKey(user.id));

      if (!serverToken && options && options.allowBootstrap) {
        serverToken = await bootstrapLegacySession(user);
        localToken = serverToken;
      }

      if (!serverToken || !localToken || serverToken !== localToken) {
        try { localStorage.removeItem(storageKey(user.id)); } catch(e){}
        // IMPORTANT : scope local uniquement, sinon l'ancienne session pourrait
        // déconnecter la nouvelle session active sur un autre appareil.
        await client.auth.signOut({ scope: 'local' });
        redirectToLogin('session-replaced');
        return false;
      }

      await addAccountControls(user);
      return true;
    } catch(e) {
      redirectToLogin();
      return false;
    } finally {
      checking = false;
    }
  }

  async function protect(){
    const ok = await verifyUniqueSession({ allowBootstrap: true });
    if (!ok) return;
    reveal();
    startInactivityTracking();
    checkTimer = window.setInterval(() => verifyUniqueSession({ allowBootstrap: false }), CHECK_INTERVAL_MS);
  }

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      if (checkTimer) clearInterval(checkTimer);
      if (idleTimer) clearInterval(idleTimer);
      return;
    }
    if (session && session.user && document.readyState !== 'loading') addAccountControls(session.user);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) verifyUniqueSession({ allowBootstrap: false });
  });
  window.addEventListener('focus', () => verifyUniqueSession({ allowBootstrap: false }));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', protect, { once: true });
  } else {
    protect();
  }
})();
