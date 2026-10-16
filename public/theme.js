(() => {
  const STORAGE_KEY = 'mt-site-theme';
  const DEFAULT_THEME = 'daylight';
  const THEMES = [
    {
      id: 'daylight',
      group: 'light',
      name: 'Daylight Crisp',
      tagline: 'Pure white, soft sky & deep navy ink',
      badge: 'Light · High Contrast',
      swatches: ['#ffffff', '#e0f2fe', '#1d4ed8', '#0f172a'],
      previewBg: 'linear-gradient(135deg, #ffffff 0%, #eff6ff 52%, #dbeafe 100%)'
    },
    {
      id: 'ivory',
      group: 'light',
      name: 'Warm Ivory Paper',
      tagline: 'Cream paper, warm sand & espresso ink',
      badge: 'Light · Editorial',
      swatches: ['#fffdf9', '#f5efe4', '#b45309', '#1c1917'],
      previewBg: 'linear-gradient(135deg, #fffdf9 0%, #f5efe4 52%, #ede3d2 100%)'
    },
    {
      id: 'mint',
      group: 'light',
      name: 'Mint Sage Light',
      tagline: 'Airy mint, pastel sage & forest ink',
      badge: 'Light · Botanical',
      swatches: ['#f6fef9', '#d1fae5', '#047857', '#062e22'],
      previewBg: 'linear-gradient(135deg, #f6fef9 0%, #e6f9f0 52%, #d1fae5 100%)'
    },
    {
      id: 'blossom',
      group: 'light',
      name: 'Rose Blossom Light',
      tagline: 'Soft blush, petal pink & deep berry ink',
      badge: 'Light · Warm',
      swatches: ['#fffafb', '#ffe4ec', '#be123c', '#3b0a21'],
      previewBg: 'linear-gradient(135deg, #fffafb 0%, #fff0f5 52%, #ffe4ec 100%)'
    },
    {
      id: 'sky',
      group: 'light',
      name: 'Lavender Cloud Light',
      tagline: 'Cloud white, soft periwinkle & indigo ink',
      badge: 'Light · Modern',
      swatches: ['#f8faff', '#e0e7ff', '#4338ca', '#1e1b4b'],
      previewBg: 'linear-gradient(135deg, #f8faff 0%, #eef2ff 52%, #e0e7ff 100%)'
    },
    {
      id: 'kinetic',
      group: 'bold',
      name: 'Vibrant Kinetic',
      tagline: 'Cobalt, violet & hot magenta mesh',
      badge: 'Bold Gradient',
      swatches: ['#2563eb', '#7c3aed', '#db2777', '#f59e0b'],
      previewBg: 'linear-gradient(135deg, #131c47 0%, #2b1968 52%, #4a1259 100%)'
    },
    {
      id: 'emerald',
      group: 'bold',
      name: 'Emerald Botanical',
      tagline: 'Lush emerald, teal & sunlit gold',
      badge: 'Bold Gradient',
      swatches: ['#059669', '#0d9488', '#10b981', '#d97706'],
      previewBg: 'linear-gradient(135deg, #062c22 0%, #0d4a3a 54%, #115e59 100%)'
    },
    {
      id: 'sunset',
      group: 'bold',
      name: 'Sunset Terracotta',
      tagline: 'Warm coral, amber & rose crimson',
      badge: 'Bold Gradient',
      swatches: ['#ea580c', '#e11d48', '#f59e0b', '#fb7185'],
      previewBg: 'linear-gradient(135deg, #3b0d1e 0%, #5c1912 52%, #7c2d12 100%)'
    },
    {
      id: 'midnight',
      group: 'bold',
      name: 'Midnight Cyber Neon',
      tagline: 'Deep obsidian dark mode with cyan glow',
      badge: 'Dark Mode',
      swatches: ['#090d1e', '#06b6d4', '#6366f1', '#a855f7'],
      previewBg: 'linear-gradient(135deg, #050814 0%, #0f172a 52%, #1e1b4b 100%)'
    },
    {
      id: 'royal',
      group: 'bold',
      name: 'Royal Luxe Gold',
      tagline: 'Regal plum, champagne gold & ivory',
      badge: 'Bold Luxury',
      swatches: ['#311b63', '#d97706', '#7c3aed', '#f59e0b'],
      previewBg: 'linear-gradient(135deg, #1a103c 0%, #2e1559 54%, #4c1d95 100%)'
    }
  ];

  const VALID_IDS = new Set(THEMES.map(item => item.id));
  const LIGHT_IDS = new Set(['daylight', 'ivory', 'mint', 'blossom', 'sky']);

  function normalizeTheme(value) {
    const clean = String(value || '').trim().toLowerCase();
    return VALID_IDS.has(clean) ? clean : DEFAULT_THEME;
  }

  function applyMarketTechTheme(themeId, options = {}) {
    const theme = normalizeTheme(themeId);
    const mode = LIGHT_IDS.has(theme) ? 'light' : 'bold';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-theme-mode', mode);
    if (document.body) {
      document.body.setAttribute('data-theme', theme);
      document.body.setAttribute('data-theme-mode', mode);
    }
    if (options.persistLocal !== false) {
      try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage may be restricted */ }
    }
    window.dispatchEvent(new CustomEvent('mt:theme-change', { detail: { theme, mode } }));
    return theme;
  }

  let initialTheme = DEFAULT_THEME;
  try {
    initialTheme = normalizeTheme(localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME);
  } catch {
    initialTheme = DEFAULT_THEME;
  }
  document.documentElement.setAttribute('data-theme', initialTheme);
  document.documentElement.setAttribute('data-theme-mode', LIGHT_IDS.has(initialTheme) ? 'light' : 'bold');

  document.addEventListener('DOMContentLoaded', () => {
    const active = normalizeTheme(document.documentElement.getAttribute('data-theme') || initialTheme);
    if (document.body) {
      document.body.setAttribute('data-theme', active);
      document.body.setAttribute('data-theme-mode', LIGHT_IDS.has(active) ? 'light' : 'bold');
    }
  });

  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY && event.newValue) {
      applyMarketTechTheme(event.newValue, { persistLocal: false });
    }
  });

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
