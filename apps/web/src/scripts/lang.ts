const sel = document.getElementById('lang-select') as HTMLSelectElement | null;
if (sel) {
  let saved: string | null = null;
  try { saved = localStorage.getItem('av_lang'); } catch { /* storage may be blocked */ }
  if (saved && [...sel.options].some((o) => o.value === saved)) sel.value = saved;
  sel.addEventListener('change', () => {
    try { localStorage.setItem('av_lang', sel.value); } catch { /* ignore */ }
    location.reload();
  });
}
