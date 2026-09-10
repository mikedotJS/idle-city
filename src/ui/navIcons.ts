/**
 * One small icon per dock tab (Ville, Menu, Social) — see shell.ts. Vite
 * resolves each import to the built asset's URL.
 */
import menu from '../assets/nav/menu.png'
import social from '../assets/nav/social.png'
import ville from '../assets/nav/ville.png'

export const NAV_ICONS: Record<string, string> = {
  ville,
  menu,
  social,
}
