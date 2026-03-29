function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': localStorage.getItem('bankvi_token') || ''
  };
}

let toutesLesDettes = [];

document.addEventListener('DOMContentLoaded', () => {
  const s = document.getElementById('search-dettes');
  if (s) {
    s.addEventListener('input', function() {
      const val = this.value.toLowerCase();
      const filtrees = toutesLesDettes.filter(d =>
        d.client.toLowerCase().includes(val) ||
        d.produit.toLowerCase().includes(val)
      );
      afficherDettes(filtrees);
    });
  }
});

function filtrerDettes(filtre, el) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const filtrees = filtre === 'toutes' ? toutesLesDettes : toutesLesDettes.filter(d => d.statut === filtre);
  afficherDettes(filtrees);
}

function afficherDettes(dettes) {
  const liste = document.getElementById('liste-dettes');
  if (!liste) return;
  if (dettes.length === 0) {
    liste.innerHTML = '<p style="padding:1.5rem;text-align:center;color:#a0a0a0;">Aucune dette</p>';
    return;
  }
  liste.innerHTML = dettes.map(d => `
    <div class="list-card ${d.statut === 'en_cours' ? 'urgent' : ''}" id="dette-${d.id}">
      <div class="lc-left">
        <div class="lc-avatar ${d.statut === 'payee' ? 'green' : 'red'}">${d.client.substring(0,2).toUpperCase()}</div>
        <div>
          <p class="lc-name">${d.client}</p>
          <p class="lc-sub">${d.produit}</p>
        </div>
      </div>
      <div class="lc-right">
        <p class="lc-amount ${d.statut === 'payee' ? 'green' : 'red'}">${fmt(d.montant)}</p>
        <p class="lc-days">${new Date(d.date_creation).toLocaleDateString('fr-FR')}</p>
      </div>
    </div>
    <div class="list-card-actions">
      ${d.statut === 'en_cours' ? `<button class="btn-success-sm" onclick="marquerPaye(${d.id})">Marquer payé</button>` : ''}
      <button class="btn-neutral-sm" onclick="ouvrirModifierDette(${d.id}, '${d.client.replace(/'/g,"\\'")}', '${d.produit.replace(/'/g,"\\'")}', ${d.montant}, '${d.date_remboursement || ''}')">Modifier</button>
      <button class="btn-neutral-sm" style="background:#FAECE7;color:#993C1D;" onclick="supprimerDette(${d.id})">Supprimer</button>
    </div>`).join('');
}

function fmt(m) { return Number(m).toLocaleString('fr-FR') + ' F'; }

async function chargerDettes() {
  try {
    const res = await fetch(`${API}/dettes`, { headers: getHeaders() });
    toutesLesDettes = await res.json();
    const enCours = toutesLesDettes.filter(d => d.statut === 'en_cours');
    const total   = enCours.reduce((s,d) => s + Number(d.montant), 0);
    const hero    = document.getElementById('hero-amount');
    const sub     = document.getElementById('hero-sub');
    if (hero) hero.textContent = fmt(total);
    if (sub)  sub.textContent  = enCours.length + ' clients concernés';
    afficherDettes(toutesLesDettes);
  } catch(e) { console.log('Erreur dettes', e); }
}

async function enregistrerDette() {
  const client  = document.getElementById('dette-client').value.trim();
  const produit = document.getElementById('dette-produit').value.trim();
  const montant = document.getElementById('dette-montant').value;
  const date    = document.getElementById('dette-date').value;
  if (!client || !produit || !montant) { alert('Remplis les champs obligatoires'); return; }
  try {
    const res = await fetch(`${API}/dettes`, {
      method: 'POST', headers: getHeaders(),
      body: JSON.stringify({ client, produit, montant: Number(montant), date_remboursement: date })
    });
    if (!res.ok) { const e = await res.json(); alert(e.message); return; }
    document.getElementById('dette-client').value  = '';
    document.getElementById('dette-produit').value = '';
    document.getElementById('dette-montant').value = '';
    document.getElementById('dette-date').value    = '';
    document.getElementById('modal-dette').classList.remove('open');
    chargerDettes();
  } catch(e) { alert('Erreur serveur — réessaie'); }
}

async function marquerPaye(id) {
  try {
    await fetch(`${API}/dettes/${id}/payer`, { method: 'PUT', headers: getHeaders() });
    chargerDettes();
  } catch(e) { alert('Erreur serveur — réessaie'); }
}

function ouvrirModifierDette(id, client, produit, montant, date) {
  document.getElementById('modifier-dette-id').value      = id;
  document.getElementById('modifier-dette-client').value  = client;
  document.getElementById('modifier-dette-produit').value = produit;
  document.getElementById('modifier-dette-montant').value = montant;
  document.getElementById('modifier-dette-date').value    = date;
  document.getElementById('modal-modifier-dette').classList.add('open');
}

async function modifierDette() {
  const id      = document.getElementById('modifier-dette-id').value;
  const client  = document.getElementById('modifier-dette-client').value.trim();
  const produit = document.getElementById('modifier-dette-produit').value.trim();
  const montant = document.getElementById('modifier-dette-montant').value;
  const date    = document.getElementById('modifier-dette-date').value;
  if (!client || !produit || !montant) { alert('Remplis les champs obligatoires'); return; }
  try {
    const res = await fetch(`${API}/dettes/${id}`, {
      method: 'PUT', headers: getHeaders(),
      body: JSON.stringify({ client, produit, montant: Number(montant), date_remboursement: date })
    });
    if (!res.ok) { const e = await res.json(); alert(e.message); return; }
    document.getElementById('modal-modifier-dette').classList.remove('open');
    chargerDettes();
  } catch(e) { alert('Erreur serveur — réessaie'); }
}

async function supprimerDette(id) {
  if (!confirm('Supprimer cette dette définitivement ?')) return;
  try {
    await fetch(`${API}/dettes/${id}`, { method: 'DELETE', headers: getHeaders() });
    chargerDettes();
  } catch(e) { alert('Erreur serveur — réessaie'); }
}

document.getElementById('btn-save-dette').addEventListener('click', enregistrerDette);
document.getElementById('btn-save-modifier-dette').addEventListener('click', modifierDette);

chargerDettes();