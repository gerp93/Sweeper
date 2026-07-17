export const AVAILABLE_THEMES = [
  'blue-oval-theme',
  'bubblegum-theme',
  'commander-keen-theme',
  'electric-lime-theme',
  'flambeau-theme',
  'flambeau-inverse-theme',
  'green-acres-theme',
  'hacker-theme',
  'hawkeye-theme',
  'lava-theme',
  'merica-theme',
  'neon-theme',
  'red-barn-theme',
  'retrowave-theme',
] as const;

export type Theme = typeof AVAILABLE_THEMES[number];

export const THEME_LABELS: Record<Theme, string> = {
  'blue-oval-theme': 'Blue Oval',
  'bubblegum-theme': 'Bubblegum',
  'commander-keen-theme': 'Commander Keen',
  'electric-lime-theme': 'Electric Lime',
  'flambeau-theme': 'Flambeau',
  'flambeau-inverse-theme': 'Flambeau Inverse',
  'green-acres-theme': 'Green Acres',
  'hacker-theme': 'Hacker',
  'hawkeye-theme': 'Hawkeye',
  'lava-theme': 'Lava',
  'merica-theme': 'Merica',
  'neon-theme': 'Neon',
  'red-barn-theme': 'Red Barn',
  'retrowave-theme': 'Retrowave',
};

export function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem('sweeper-theme');
    if (stored && AVAILABLE_THEMES.includes(stored as Theme)) {
      return stored as Theme;
    }
  } catch {
    // localStorage not available
  }
  return null;
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem('sweeper-theme', theme);
  } catch {
    // localStorage not available
  }
}

export function applyTheme(theme: Theme | null): void {
  const body = document.body;
  // Remove all theme classes
  AVAILABLE_THEMES.forEach((t) => body.classList.remove(t));
  // Apply the selected theme
  if (theme) {
    body.classList.add(theme);
  }
}
