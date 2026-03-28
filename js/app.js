const API = window.location.origin + '/api';

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': localStorage.getItem('bankvi_token') || ''
  };
}

// Protection
const token = localStorage.getItem('bankvi_token');
const page  = window.location.pathname.split('/').pop();
if (!token && page !== 'login.html' && page !== '') {
  window.location.href = 'login.html';
}

// Date
function afficherDate() {
  const el = document.getElementById('nav-date');
  if (el) el.textContent = new Date().toLocaleDateString('fr-FR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}
afficherDate();

// Avatar
const user = JSON.parse(localStorage.getItem('bankvi_user') || '{}');
const avatarEl = document.getElementById('nav-avatar');
if (avatarEl && user.nom) avatarEl.textContent = user.nom.substring(0,2).toUpperCase();

// Sidebar desktop
function creerSidebar() {
  if (window.innerWidth < 768) return;
  const existing = document.querySelector('.sidebar');
  if (existing) existing.remove();
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  const items = [
    { icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="2" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="10" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="10" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>', label: 'Accueil', href: 'index.html' },
    { icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M9 6v3l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Dettes', href: 'dettes.html' },
    { icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 12l3-3 3 3 3-4 3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>', label: 'Ventes', href: 'ventes.html' },
    { icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="3" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M6 9h6M9 6v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Stocks', href: 'stocks.html' },
    { icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="6" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M3 15c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Profil', href: 'profil.html' },
  ];
  const pageCourante = window.location.pathname.split('/').pop() || 'index.html';
  items.forEach(item => {
    const a = document.createElement('a');
    a.href = item.href;
    a.className = 'sidebar-item' + (pageCourante === item.href ? ' active' : '');
    a.innerHTML = item.icon + `<span>${item.label}</span>`;
    sidebar.appendChild(a);
  });
  const navbar = document.querySelector('.navbar');
  if (navbar) navbar.insertAdjacentElement('afterend', sidebar);
}
creerSidebar();

// Utilitaires
function fmt(montant) { return Number(montant).toLocaleString('fr-FR') + ' F'; }
function joursDepuis(dateStr) {
  const diff = Math.floor((new Date() - new Date(dateStr)) / 86400000);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return 'hier';
  return `il y a ${diff} jours`;
}

// Dashboard
async function chargerDashboard() {
  if (!document.getElementById('hero-amount')) return;
  try {
    const res  = await fetch(`${API}/dashboard`, { headers: getHeaders() });
    const data = await res.json();
    document.getElementById('hero-amount').textContent  = fmt(data.ventes_jour);
    document.getElementById('hero-sub').textContent     = data.ventes_count + ' ventes enregistrées';
    document.getElementById('m-dettes').textContent     = fmt(data.dettes_total);
    document.getElementById('m-dettes-count').textContent = data.dettes_count + ' clients';
    document.getElementById('m-stocks').textContent     = data.stocks_critique;
    document.getElementById('m-ventes').textContent     = data.ventes_count;
    if (user.boutique) document.getElementById('m-boutique').textContent = user.boutique.substring(0,8);

    const resD   = await fetch(`${API}/dettes`, { headers: getHeaders() });
    const dettes = await resD.json();
    const liste  = document.getElementById('liste-dettes');
    const enCours = dettes.filter(d => d.statut === 'en_cours').slice(0,3);
    if (!liste) return;
    if (enCours.length === 0) {
      liste.innerHTML = `<div style="padding:1.5rem;text-align:center;"><p style="color:#a0a0a0;font-size:14px;">Aucune dette en cours</p><a href="dettes.html" style="color:#185FA5;font-size:13px;display:block;margin-top:6px;">Ajouter une dette →</a></div>`;
    } else {
      liste.innerHTML = enCours.map(d => `
        <div class="list-card">
          <div class="lc-left">
            <div class="lc-avatar red">${d.client.substring(0,2).toUpperCase()}</div>
            <div><p class="lc-name">${d.client}</p><p class="lc-sub">${d.produit}</p></div>
          </div>
          <div class="lc-right">
            <p class="lc-amount red">${fmt(d.montant)}</p>
            <p class="lc-days">${joursDepuis(d.date_creation)}</p>
          </div>
        </div>`).join('');
    }
  } catch(e) { console.log('Erreur dashboard', e); }
}
chargerDashboard();