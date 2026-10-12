import './theme.css';
import { loadKenneyFonts } from './fonts';

/**
 * Common page setup for every game: theme, fonts and a link back to the launcher.
 * Resolves once fonts are ready so canvas text renders in the right face.
 */
export async function setupGamePage(): Promise<void> {
  const back = document.createElement('a');
  back.href = import.meta.env.BASE_URL;
  back.className = 'btn';
  back.textContent = '← All toys';
  back.style.cssText = 'position:fixed;top:12px;left:12px;z-index:10;font-size:14px';
  document.body.append(back);
  await loadKenneyFonts();
}
