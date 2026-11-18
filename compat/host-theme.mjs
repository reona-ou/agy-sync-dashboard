import { readFile } from 'node:fs/promises';
import { resolvePaths } from './platform.mjs';

const VALID_COLOR = /^(#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\([^;{}]{1,120}\))$/;
const VALID_FONT = /^[^;{}<>\\]{1,160}$/;

function pickColor(val) {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  return VALID_COLOR.test(trimmed) ? trimmed : '';
}

function pickFont(val) {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  return VALID_FONT.test(trimmed) ? trimmed : '';
}

/**
 * Read whitelisted theme mode, accent seeds, and fonts from Antigravity config.json.
 */
export async function readHostTheme(file = resolvePaths().pluginConfig) {
  try {
    const raw = await readFile(file, 'utf8');
    if (raw.length > 1048576) return { mode: 'system' };
    const settings = JSON.parse(raw.replace(/^\uFEFF/, ''))?.userSettings;
    if (!settings || typeof settings !== 'object') return { mode: 'system' };

    const modeMap = {
      THEME_MODE_DARK: 'dark',
      THEME_MODE_LIGHT: 'light',
      THEME_MODE_SYSTEM: 'system',
      dark: 'dark',
      light: 'light',
      system: 'system',
    };
    const mode = modeMap[settings.themeMode] || 'system';
    const seedDark = settings.customThemeSeedsDark || {};
    const seedLight = settings.customThemeSeedsLight || {};

    return {
      mode,
      dark: {
        primary: pickColor(seedDark.primary),
        background: pickColor(seedDark.background),
        foreground: pickColor(seedDark.foregroundOverride),
      },
      light: {
        primary: pickColor(seedLight.primary),
        background: pickColor(seedLight.background),
        foreground: pickColor(seedLight.foregroundOverride),
      },
      fontFamily: pickFont(settings.fontFamily || settings.uiFontFamily || settings.appearance?.fontFamily),
      monoFontFamily: pickFont(settings.monoFontFamily || settings.editorFontFamily || settings.appearance?.monoFontFamily),
    };
  } catch {
    return { mode: 'system' };
  }
}
