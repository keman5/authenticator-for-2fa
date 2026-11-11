const cacheKey = "site-icons-v1";
type SiteIcon = [hostname: string, image: string];

export function isSiteIcon(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 10_000 &&
    /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value)
  );
}

export function readSiteIcons(): SiteIcon[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(cacheKey) ?? "[]");
    if (!Array.isArray(entries)) return [];
    return entries
      .slice(0, 64)
      .filter(
        (entry): entry is SiteIcon =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          isSiteIcon(entry[1]),
      );
  } catch {
    return [];
  }
}

export function rememberSiteIcon(hostname: string, image: string): SiteIcon[] {
  const icons: SiteIcon[] = [
    [hostname, image],
    ...readSiteIcons().filter(([host]) => host !== hostname),
  ];
  icons.length = Math.min(icons.length, 64);
  try {
    localStorage.setItem(cacheKey, JSON.stringify(icons));
  } catch {
    // The icon can still be shown when local storage is unavailable.
  }
  return icons;
}

export function clearSiteIcons() {
  try {
    localStorage.removeItem(cacheKey);
  } catch {
    // Local storage is unavailable.
  }
}

// Runs in the selected page; all inputs and helpers must be serializable.
export async function readPageIcon(
  origin: string,
  faviconUrl?: string,
): Promise<string | null> {
  if (location.origin !== origin) return null;
  try {
    const candidate =
      faviconUrl ||
      document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href;
    if (!candidate || candidate.length > 128 * 1024) return null;
    const url = new URL(candidate);
    if (!(
      url.protocol === "https:" ||
      url.protocol === "data:" ||
      (url.protocol === "http:" && url.origin === origin)
    ))
      return null;
    const response = await fetch(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      cache: "force-cache",
      signal: AbortSignal.timeout(2500),
    });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !response.body || !type.startsWith("image/"))
      return null;
    const reader = response.body.getReader();
    const bytes = new Uint8Array(128 * 1024);
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > bytes.length) {
        await reader.cancel();
        return null;
      }
      bytes.set(value, length);
      length += value.length;
    }
    const blob = URL.createObjectURL(
      new Blob([bytes.subarray(0, length)], { type }),
    );
    try {
      const image = new Image();
      image.src = blob;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const scale = 32 / Math.max(image.naturalWidth, image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      canvas
        .getContext("2d")
        ?.drawImage(image, (32 - width) / 2, (32 - height) / 2, width, height);
      return canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(blob);
    }
  } catch {
    return null;
  }
}
