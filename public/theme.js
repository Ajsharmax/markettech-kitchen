(() => {
  const STORAGE_KEY = 'mt-site-theme';
  const DEFAULT_THEME = 'kinetic';
  const THEMES = [
    {
      id: 'kinetic',
      name: 'Vibrant Kinetic',
      tagline: 'Cobalt, violet & hot magenta mesh',
      badge: 'Default',
      swatches: ['#2563eb', '#7c3aed', '#db2777', '#f59e0b'],
      previewBg: 'linear-gradient(135deg, #131c47 0%, #2b1968 52%, #4a1259 100%)'
    },
    {
      id: 'emerald',
      name: 'Emerald Botanical',
      tagline: 'Lush emerald, teal & sunlit gold',
      badge: 'Fresh',
      swatches: ['#059669', '#0d9488', '#10b981', '#d97706'],
      previewBg: 'linear-gradient(135deg, #062c22 0%, #0d4a3a 54%, #115e59 100%)'
    },
    {
      id: 'sunset',
      name: 'Sunset Terracotta',
      tagline: 'Warm coral, amber & rose crimson',
      badge: 'Warm',
      swatches: ['#ea580c', '#e11d48', '#f59e0b', '#fb7185'],
      previewBg: 'linear-gradient(135deg, #3b0d1e 0%, #5c1912 52%, #7c2d12 100%)'
    },
    {
      id: 'midnight',
      name: 'Midnight Cyber Neon',
      tagline: 'Deep obsidian dark mode with cyan glow',
      badge: 'Dark Mode',
      swatches: ['#090d1e', '#06b6d4', '#6366f1', '#a855f7'],
      previewBg: 'linear-gradient(135deg, #050814 0%, #0f172a 52%, #1e1b4b 100%)'
    },
    {
      id: 'royal',
      name: 'Royal Luxe Gold',
      tagline: 'Regal plum, champagne gold & ivory',
      badge: 'Luxury',
      swatches: ['#311b63', '#d97706', '#7c3aed', '#f59e0b'],
      previewBg: 'linear-gradient(135deg, #1a103c 0%, #2e1559 54%, #4c1d95 100%)'
    }
  ];

  const VALID_IDS = new Set(THEMES.map(item => item.id));

  function normalizeTheme(value) {
    const clean = String(value || '').trim().toLowerCase();
    return VALID_IDS.has(clean) ? clean : DEFAULT_THEME;
  }

  function applyMarketTechTheme(themeId, options = {}) {
    const theme = normalizeTheme(themeId);
    document.documentElement.setAttribute('data-theme', theme);
    if (document.body) document.body.setAttribute('data-theme', theme);
    if (options.persistLocal !== false) {
      try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage may be restricted */ }
    }
    window.dispatchEvent(new CustomEvent('mt:theme-change', { detail: { theme } }));
    return theme;
  }

  let initialTheme = DEFAULT_THEME;
  try {
    initialTheme = normalizeTheme(localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME);
  } catch {
    initialTheme = DEFAULT_THEME;
  }
  document.documentElement.setAttribute('data-theme', initialTheme);

  document.addEventListener('DOMContentLoaded', () => {
    const active = normalizeTheme(document.documentElement.getAttribute('data-theme') || initialTheme);
    if (document.body) document.body.setAttribute('data-theme', active);
  });

  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY && event.newValue) {
      applyMarketTechTheme(event.newValue, { persistLocal: false });
    }
  });

  // Sync with server config on public pages that don't already call /api/config
  if (!window.__mtSkipAutoThemeFetch) {
    fetch('/api/config', { credentials: 'same-origin' })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (data && data.theme && VALID_IDS.has(String(data.theme).toLowerCase())) {
          applyMarketTechTheme(data.theme);
        }
      })
      .catch(() => { /* offline or static preview fallback uses localStorage */ });
  }

  window.MARKETTECH_THEMES = THEMES;
  window.applyMarketTechTheme = applyMarketTechTheme;
  window.getMarketTechTheme = () => normalizeTheme(document.documentElement.getAttribute('data-theme') || initialTheme);
})();
