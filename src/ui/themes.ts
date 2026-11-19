// Swatches for Settings → Look (colors match theme.css)
export const PALETTES = [
  { id: 'limestone', name: 'Limestone', light: '#f3efe6', dark: '#1b1a17' },
  { id: 'sandstone', name: 'Sandstone', light: '#f1e8da', dark: '#1e1914' },
  { id: 'slate', name: 'Slate', light: '#eceff1', dark: '#171a1d' },
  { id: 'redrock', name: 'Red Rock', light: '#f4e9e3', dark: '#1f1614' },
  { id: 'forest', name: 'Forest', light: '#ebefe6', dark: '#161a15' },
] as const;

export const ACCENTS = [
  { id: 'moss', name: 'Moss', color: '#56704f' },
  { id: 'jade', name: 'Jade', color: '#2e8a66' },
  { id: 'sapphire', name: 'Sapphire', color: '#2f6bb0' },
  { id: 'amethyst', name: 'Amethyst', color: '#7a5aa6' },
  { id: 'garnet', name: 'Garnet', color: '#a3453a' },
  { id: 'citrine', name: 'Citrine', color: '#94661a' },
  { id: 'copper', name: 'Copper', color: '#a85a2b' },
] as const;

export type PaletteId = (typeof PALETTES)[number]['id'];
export type AccentId = (typeof ACCENTS)[number]['id'];
