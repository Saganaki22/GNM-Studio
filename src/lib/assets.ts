/** Resolve bundled assets under Vite's configured base path.
 *
 * Desktop builds use `/`; the GitHub Pages build uses `/GNM-Studio/`.
 */
export function assetUrl(path: string) {
  const relativePath = path.replace(/^\/+/, "");
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${relativePath}`;
}
