// Disable right-click
document.addEventListener('contextmenu', e => e.preventDefault());
// Disable F12, Ctrl+Shift+I/J/U/C
document.addEventListener('keydown', e => {
  if (e.key === 'F12' || 
      (e.ctrlKey && e.shiftKey && ['I','J','C','K'].includes(e.key.toUpperCase())) ||
      (e.ctrlKey && e.key.toUpperCase() === 'U')) {
    e.preventDefault(); e.stopPropagation(); return false;
  }
});
// Detect devtools open via size difference
(function devToolsDetect() {
  const threshold = 160;
  setInterval(() => {
    if (window.outerWidth - window.innerWidth > threshold || window.outerHeight - window.innerHeight > threshold) {
      console.warn("DevTools inspection detected. Please browse the boutique natively for the best experience ✿");
    }
  }, 1000);
})();
// Profile and Modal Logic
function toggleProfile() {
  document.getElementById('profilePanel').classList.toggle('open');
  document.getElementById('profileVeil').classList.toggle('open');
}

async function showPurchases() {
  toggleProfile();
  if (!currentUser || !currentUser.email) { toast("Sign in to view your purchases ✿"); return; }
  const purchases = await getUserPurchases(currentUser.email);
  if (purchases.length === 0) {
    toast("No purchases recorded yet ✿");
    return;
  }
  showProfileModal(
    "🛍 Your Purchases",
    purchases.map(p => `<div style="padding:12px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);">✿ ${p}</div>`).join('')
  );
}

async function showMyReviews() {
  toggleProfile();
  if (!currentUser || !currentUser.email) { toast("Sign in to view your reviews ✿"); return; }
  const q = query(collection(db, 'reviews'), where('email', '==', currentUser.email));
  const snap = await getDocs(q);
  if (snap.empty) {
    toast("You haven't left any reviews yet ✿");
    return;
  }
  const rows = [];
  snap.forEach(d => {
    const r = d.data();
    rows.push(`<div style="padding:14px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:12px;color:var(--gold);margin-bottom:4px;">${r.product}</div>
      <div style="color:#F4A261;font-size:14px;margin-bottom:4px;">${starsToDisplay(r.rating)}</div>
      <div style="font-size:13px;color:var(--text);line-height:1.6;">"${r.review}"</div>
    </div>`);
  });
  showProfileModal("✿ My Reviews", rows.join(''));
}

function showProfileModal(title, bodyHtml) {
  let modal = document.getElementById('profileInfoModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'profileInfoModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(74,55,40,0.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';
    modal.innerHTML = `<div style="background:var(--ivory);width:100%;max-width:480px;border-radius:24px 24px 0 0;padding:28px 24px 40px;max-height:70vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 id="profileModalTitle" style="font-family:'Playfair Display',serif;font-size:20px;color:var(--text);"></h3>
        <button onclick="document.getElementById('profileInfoModal').remove()" style="background:none;border:none;font-size:22px;color:var(--text-light);cursor:pointer;">×</button>
      </div>
      <div id="profileModalBody"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }
  document.getElementById('profileModalTitle').textContent = title;
  document.getElementById('profileModalBody').innerHTML = bodyHtml;
}

function confirmLogout() {
  toggleProfile();
  document.getElementById('logoutConfirm').classList.add('open');
}

// doLogout handled by Firebase Auth (async) above

function closeLoginWall() {
  document.getElementById('loginWall').classList.remove('open');
}
