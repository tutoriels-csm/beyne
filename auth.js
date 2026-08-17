(function () {
  'use strict';

  const currentScript = document.currentScript;
  const siteRoot = currentScript ? new URL('.', currentScript.src) : new URL('./', window.location.href);
  const loginUrl = new URL('login.html', siteRoot).href;
  const cfg = window.BEYNE_SUPABASE || {};
  const badConfig = !cfg.url || !cfg.publishableKey || cfg.url.includes('VOTRE-PROJET') || cfg.publishableKey.includes('VOTRE_CLE');
  const ACTIVE_SESSION_TABLE = 'active_sessions';
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
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.sessionStorage }
  });
  window.beyneSupabase = client;

  function recordActivity(force){
    const now = Date.now();
    if (!force && now - lastActivityWrite < ACTIVITY_WRITE_THROTTLE_MS) return;
    lastActivityWrite = now;
    try { sessionStorage.setItem(LAST_ACTIVITY_KEY, String(now)); } catch(e){}
  }

  function readLastActivity(){
    try {
      const value = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY));
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch(e){ return 0; }
  }

  async function clearOwnActiveSession(user) {
    if (!user || !user.id) return;
    let token = '';
    try { token = sessionStorage.getItem(storageKey(user.id)) || ''; } catch(e){}
    if (!token) return;
    try {
      await client.from(ACTIVE_SESSION_TABLE)
        .delete()
        .eq('user_id', user.id)
        .eq('session_token', token);
    } catch(e){}
  }

  async function logoutForInactivity(){
    if (idleLogoutRunning) return;
    idleLogoutRunning = true;
    if (checkTimer) clearInterval(checkTimer);
    if (idleTimer) clearInterval(idleTimer);
    try {
      const { data } = await client.auth.getSession();
      const user = data && data.session && data.session.user;
      if (user) await clearOwnActiveSession(user);
      if (user) sessionStorage.removeItem(storageKey(user.id));
      sessionStorage.removeItem(LAST_ACTIVITY_KEY);
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

  function ensurePasswordModal(user) {
    let modal = document.getElementById('passwordChangeModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'passwordChangeModal';
    modal.className = 'password-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="password-modal-backdrop" data-password-close="true"></div>
      <section class="password-modal-card" role="dialog" aria-modal="true" aria-labelledby="passwordModalTitle">
        <button class="password-modal-close" type="button" aria-label="Fermer" data-password-close="true">×</button>
        <div class="password-modal-icon" aria-hidden="true">🔒</div>
        <h2 id="passwordModalTitle">Changer le mot de passe</h2>
        <p class="password-modal-account">Compte : <strong>${(user.email || 'Utilisateur connecté').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</strong></p>
        <form id="passwordChangeForm" novalidate>
          <label for="newPassword">Nouveau mot de passe</label>
          <div class="password-field-wrap">
            <input id="newPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="8 caractères minimum">
            <button class="password-toggle" type="button" data-toggle-password="newPassword" aria-label="Afficher le mot de passe">Afficher</button>
          </div>

          <label for="confirmPassword">Confirmer le nouveau mot de passe</label>
          <div class="password-field-wrap">
            <input id="confirmPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="Saisissez-le une seconde fois">
            <button class="password-toggle" type="button" data-toggle-password="confirmPassword" aria-label="Afficher le mot de passe">Afficher</button>
          </div>

          <div id="passwordChangeMessage" class="password-change-message" role="status" aria-live="polite"></div>

          <div class="password-modal-actions">
            <button class="password-cancel-btn" type="button" data-password-close="true">Annuler</button>
            <button class="password-save-btn" id="passwordSaveBtn" type="submit">Enregistrer le nouveau mot de passe</button>
          </div>
        </form>
      </section>`;
    document.body.appendChild(modal);

    const form = modal.querySelector('#passwordChangeForm');
    const newPwd = modal.querySelector('#newPassword');
    const confirmPwd = modal.querySelector('#confirmPassword');
    const msg = modal.querySelector('#passwordChangeMessage');
    const saveBtn = modal.querySelector('#passwordSaveBtn');

    function closePasswordModal() {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('password-modal-open');
      form.reset();
      msg.textContent = '';
      msg.className = 'password-change-message';
    }

    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-password-close="true"]')) {
        closePasswordModal();
        return;
      }
      const toggle = event.target.closest('[data-toggle-password]');
      if (toggle) {
        const field = modal.querySelector('#' + toggle.dataset.togglePassword);
        if (!field) return;
        const visible = field.type === 'text';
        field.type = visible ? 'password' : 'text';
        toggle.textContent = visible ? 'Afficher' : 'Masquer';
        toggle.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('is-open')) closePasswordModal();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      msg.textContent = '';
      msg.className = 'password-change-message';

      const password = newPwd.value;
      const confirmation = confirmPwd.value;

      if (password.length < 8) {
        msg.textContent = 'Le nouveau mot de passe doit contenir au moins 8 caractères.';
        msg.classList.add('is-error');
        newPwd.focus();
        return;
      }
      if (password !== confirmation) {
        msg.textContent = 'Les deux mots de passe ne correspondent pas.';
        msg.classList.add('is-error');
        confirmPwd.focus();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Enregistrement…';

      try {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;

        msg.textContent = '✓ Mot de passe modifié avec succès.';
        msg.classList.add('is-success');
        form.querySelectorAll('input').forEach(input => input.disabled = true);

        setTimeout(() => {
          closePasswordModal();
          form.querySelectorAll('input').forEach(input => input.disabled = false);
        }, 1600);
      } catch (error) {
        const raw = String((error && error.message) || '');
        let friendly = 'Impossible de modifier le mot de passe. Réessayez.';
        if (/same password/i.test(raw)) friendly = 'Le nouveau mot de passe doit être différent de l’ancien.';
        else if (/reauth|recent|session/i.test(raw)) friendly = 'Pour des raisons de sécurité, reconnectez-vous puis réessayez.';
        else if (/weak|password/i.test(raw) && /character|length|short/i.test(raw)) friendly = 'Le mot de passe choisi ne respecte pas les exigences de sécurité.';
        msg.textContent = friendly;
        msg.classList.add('is-error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Enregistrer le nouveau mot de passe';
      }
    });

    modal.openPasswordChange = () => {
      form.reset();
      form.querySelectorAll('input').forEach(input => input.disabled = false);
      msg.textContent = '';
      msg.className = 'password-change-message';
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('password-modal-open');
      setTimeout(() => newPwd.focus(), 50);
    };

    return modal;
  }

  async function addAccountControls(user) {
    const nav = document.querySelector('.nav-actions');
    if (!nav || nav.querySelector('.auth-account')) return;

    const account = document.createElement('button');
    account.type = 'button';
    account.className = 'auth-account auth-account-button';
    account.title = 'Changer le mot de passe de ' + (user.email || 'ce compte');
    account.setAttribute('aria-label', 'Compte ' + (user.email || 'connecté') + ' – changer le mot de passe');
    account.innerHTML = '<span class="auth-dot" aria-hidden="true"></span><span class="auth-email"></span>';
    account.querySelector('.auth-email').textContent = user.email || 'Connecté';
    account.addEventListener('click', () => {
      const modal = ensurePasswordModal(user);
      if (modal && typeof modal.openPasswordChange === 'function') modal.openPasswordChange();
    });

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'logout-btn';
    logout.textContent = 'Déconnexion';
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      logout.textContent = 'Déconnexion…';
      try { await clearOwnActiveSession(user); } catch(e){}
      try { sessionStorage.removeItem(storageKey(user.id)); sessionStorage.removeItem(LAST_ACTIVITY_KEY); } catch(e){}
      await client.auth.signOut({ scope: 'local' });
      window.location.replace(loginUrl);
    });
    nav.prepend(logout);
    nav.prepend(account);
  }

  async function verifyUniqueSession(options){
    if (checking) return true;
    checking = true;
    const initialCheck = !!(options && options.initial);
    try {
      const { data:sessionData, error:sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData.session || !sessionData.session.user) {
        redirectToLogin();
        return false;
      }

      const user = sessionData.session.user;
      let localToken = '';
      try { localToken = sessionStorage.getItem(storageKey(user.id)) || ''; } catch(e){}

      if (!localToken) {
        try { await client.auth.signOut({ scope: 'local' }); } catch(e){}
        redirectToLogin('session-replaced');
        return false;
      }

      const { data:activeSession, error:activeError } = await client
        .from(ACTIVE_SESSION_TABLE)
        .select('session_token, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (activeError) {
        console.error('Contrôle de session unique indisponible :', activeError);
        // Au chargement initial, on ne révèle jamais une page protégée si le contrôle serveur échoue.
        // En cours d'utilisation, une panne réseau ponctuelle ne déconnecte pas immédiatement le client.
        if (initialCheck) {
          try { await client.auth.signOut({ scope: 'local' }); } catch(e){}
          redirectToLogin('session-check-error');
          return false;
        }
        return true;
      }

      if (!activeSession || !activeSession.session_token || activeSession.session_token !== localToken) {
        try { sessionStorage.removeItem(storageKey(user.id)); } catch(e){}
        // scope local uniquement : on ferme seulement l'ancienne connexion détectée.
        try { await client.auth.signOut({ scope: 'local' }); } catch(e){}
        redirectToLogin('session-replaced');
        return false;
      }

      await addAccountControls(user);
      return true;
    } catch(e) {
      console.error(e);
      if (initialCheck) {
        try { await client.auth.signOut({ scope: 'local' }); } catch(_){}
        redirectToLogin('session-check-error');
        return false;
      }
      return true;
    } finally {
      checking = false;
    }
  }

  async function protect(){
    const ok = await verifyUniqueSession({ initial: true });
    if (!ok) return;
    reveal();
    startInactivityTracking();
    checkTimer = window.setInterval(() => verifyUniqueSession({ initial: false }), CHECK_INTERVAL_MS);
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
    if (!document.hidden) verifyUniqueSession({ initial: false });
  });
  window.addEventListener('focus', () => verifyUniqueSession({ initial: false }));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', protect, { once: true });
  } else {
    protect();
  }
})();
