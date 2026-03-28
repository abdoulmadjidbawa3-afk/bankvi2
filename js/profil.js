async function chargerProfil() {
  const user = JSON.parse(localStorage.getItem('bankvi_user') || '{}');
  if (user.nom) {
    document.getElementById('profil-avatar').textContent  = user.nom.substring(0,2).toUpperCase();
    document.getElementById('profil-nom').textContent     = user.nom;
    document.getElementById('profil-boutique').textContent = user.boutique || 'Ma boutique';
  }
  try {
    const res  = await fetch(`${API}/dashboard`, { headers: getHeaders() });
    const data = await res.json();
    document.getElementById('p-ventes').textContent = fmt(data.ventes_jour);
    document.getElementById('p-dettes').textContent = data.dettes_count;
    const resS  = await fetch(`${API}/stocks`, { headers: getHeaders() });
    const stocks = await resS.json();
    document.getElementById('p-stocks').textContent = stocks.length;
  } catch(e) { console.log('Erreur profil', e); }
}

document.getElementById('btn-logout').addEventListener('click', () => {
  if (confirm('Tu veux vraiment te déconnecter ?')) {
    localStorage.removeItem('bankvi_token');
    localStorage.removeItem('bankvi_user');
    window.location.href = 'login.html';
  }
});

chargerProfil();