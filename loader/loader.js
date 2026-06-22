// ─── TRANSITION ───────────────────────────────────────────────
window.addEventListener('load', () => {
  // Keeps the loader visible for a brief moment for dynamic effect
  setTimeout(() => {
    const loader = document.getElementById('loader');
    if (loader) {
      loader.classList.add('out');
    }
  }, 1500); // 1.5 seconds reveals the brand beautifully before exit
});