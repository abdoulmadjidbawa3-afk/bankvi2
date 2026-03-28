async function chargerStocks() {
  try {
    const res    = await fetch(`${API}/stocks`, { headers: getHeaders() });
    const stocks = await res.json();
    afficherStocks(stocks);
    document.getElementById('m-total').textContent   = stocks.length;
    document.getElementById('m-bas').textContent     = stocks.filter(s => s.quantite > 0 && s.quantite <= s.seuil_alerte).length;
    document.getElementById('m-rupture').textContent = stocks.filter(s => s.quantite === 0).length;
  } catch(e) { console.log('Erreur stocks', e); }
}

function afficherStocks(stocks) {
  const liste = document.getElementById('liste-stocks');
  if (!liste) return;
  if (stocks.length === 0) {
    liste.innerHTML = '<p style="padding:1.5rem;text-align:center;color:#a0a0a0;">Aucun produit — Ajoute ton premier produit</p>';
    return;
  }
  liste.innerHTML = stocks.map(s => {
    const rupture = s.quantite === 0;
    const bas     = s.quantite > 0 && s.quantite <= s.seuil_alerte;
    const statut  = rupture ? {label:'Rupture',classe:'out'} : bas ? {label:'Stock bas',classe:'low'} : {label:'OK',classe:'ok'};
    const pct     = Math.min(100, Math.round((s.quantite / (s.seuil_alerte * 5)) * 100));
    return `
      <div class="stock-card ${rupture ? 'danger' : bas ? 'warn' : ''}">
        <div class="sc-top">
          <div class="lc-left">
            <div class="lc-avatar ${statut.classe === 'ok' ? 'green' : statut.classe === 'low' ? 'blue' : 'red'}">${s.nom.substring(0,2).toUpperCase()}</div>
            <div><p class="lc-name">${s.nom}</p><p class="lc-sub">${s.categorie}</p></div>
          </div>
          <span class="badge-stock ${statut.classe}">${statut.label}</span>
        </div>
        <div class="stock-bar-wrap">
          <div class="stock-bar-labels"><span>${s.quantite} unités</span><span>Seuil: ${s.seuil_alerte}</span></div>
          <div class="stock-bar"><div class="stock-bar-fill ${statut.classe}" style="width:${pct}%"></div></div>
        </div>
        <p class="stock-price">Prix : <strong>${fmt(s.prix_unitaire)}</strong></p>
        <div class="list-card-actions">
          <button class="btn-success-sm" onclick="ouvrirModifierStock(${s.id}, '${s.nom}', '${s.categorie}', ${s.quantite}, ${s.seuil_alerte}, ${s.prix_unitaire})">Modifier</button>
          <button class="btn-neutral-sm" style="background:#FAECE7;color:#993C1D;" onclick="supprimerStock(${s.id})">Supprimer</button>
        </div>
      </div>`;
  }).join('');
}

async function enregistrerStock() {
  const nom       = document.getElementById('stock-nom').value.trim();
  const categorie = document.getElementById('stock-categorie').value;
  const quantite  = document.getElementById('stock-quantite').value;
  const seuil     = document.getElementById('stock-seuil').value;
  const prix      = document.getElementById('stock-prix').value;

  if (!nom || !quantite || !prix) { alert('Remplis les champs obligatoires'); return; }

  try {
    const res = await fetch(`${API}/stocks`, {
      method: 'POST', headers: getHeaders(),
      body: JSON.stringify({ nom, categorie, quantite: Number(quantite), seuil_alerte: Number(seuil) || 5, prix_unitaire: Number(prix) })
    });
    if (!res.ok) { const e = await res.json(); alert(e.message); return; }
    document.getElementById('stock-nom').value      = '';
    document.getElementById('stock-quantite').value = '';
    document.getElementById('stock-seuil').value    = '';
    document.getElementById('stock-prix').value     = '';
    document.getElementById('modal-stock').classList.remove('open');
    chargerStocks();
  } catch(e) { alert('Erreur serveur — réessaie'); }
}

document.getElementById('search-input').addEventListener('input', function() {
  const val = this.value.toLowerCase();
  document.querySelectorAll('.stock-card').forEach(card => {
    const nom = card.querySelector('.lc-name')?.textContent.toLowerCase();
    card.style.display = nom?.includes(val) ? '' : 'none';
  });
});

function ouvrirModifierStock(id, nom, categorie, quantite, seuil, prix) {
  document.getElementById('modifier-stock-id').value        = id;
  document.getElementById('modifier-stock-nom').value       = nom;
  document.getElementById('modifier-stock-categorie').value = categorie;
  document.getElementById('modifier-stock-quantite').value  = quantite;
  document.getElementById('modifier-stock-seuil').value     = seuil;
  document.getElementById('modifier-stock-prix').value      = prix;
  document.getElementById('modal-modifier-stock').classList.add('open');
}

async function modifierStock() {
  const id        = document.getElementById('modifier-stock-id').value;
  const nom       = document.getElementById('modifier-stock-nom').value.trim();
  const categorie = document.getElementById('modifier-stock-categorie').value;
  const quantite  = document.getElementById('modifier-stock-quantite').value;
  const seuil     = document.getElementById('modifier-stock-seuil').value;
  const prix      = document.getElementById('modifier-stock-prix').value;
  if (!nom || !quantite || !prix) { alert('Remplis les champs obligatoires'); return; }
  try {
    const res = await fetch(`${API}/stocks/${id}`, {
      method: 'PUT', headers: getHeaders(),
      body: JSON.stringify({ nom, categorie, quantite: Number(quantite), seuil_alerte: Number(seuil) || 5, prix_unitaire: Number(prix) })
    });
    if (!res.ok) { const e = await res.json(); alert(e.message); return; }
    document.getElementById('modal-modifier-stock').classList.remove('open');
    chargerStocks();
  } catch(e) { alert('Erreur serveur — réessaie'); }
}

async function supprimerStock(id) {
  if (!confirm('Supprimer ce produit définitivement ?')) return;
  try {
    await fetch(`${API}/stocks/${id}`, { method: 'DELETE', headers: getHeaders() });
    chargerStocks();
  } catch(e) { alert('Erreur serveur — réessaie'); }
}

document.getElementById('btn-save-modifier-stock').addEventListener('click', modifierStock);

document.getElementById('btn-save-stock').addEventListener('click', enregistrerStock);
chargerStocks();