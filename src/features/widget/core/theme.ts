export type WidgetScheme = 'light' | 'dark';

type Hex = `#${string}`;

export interface WidgetPalette {
  background: Hex;
  surface: Hex;
  text: Hex;
  textSecondary: Hex;
  textTertiary: Hex;
  primary: Hex;
  onPrimary: Hex;
}

const light: WidgetPalette = {
  background: '#ffffff',
  surface: '#f5f5f5',
  text: '#1a1a1a',
  textSecondary: '#555555',
  textTertiary: '#888888',
  primary: '#109be6',
  onPrimary: '#ffffff',
};

const dark: WidgetPalette = {
  background: '#121212',
  surface: '#1e1e1e',
  text: '#f1f1f1',
  textSecondary: '#aaaaaa',
  textTertiary: '#666666',
  primary: '#29aef7',
  onPrimary: '#ffffff',
};

export function widgetPalette(scheme: WidgetScheme): WidgetPalette {
  return scheme === 'dark' ? dark : light;
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function onEventColor(color: string): Hex {
  const [r, g, b] = parseHex(color);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff';
}

export const widgetRadius = { sm: 8, md: 12, lg: 16 } as const;
export const widgetSpacing = { xs: 4, sm: 8, md: 12, lg: 16 } as const;
export const widgetType = { time: 12, caption: 13, body: 15, title: 17, heading: 22 } as const;
