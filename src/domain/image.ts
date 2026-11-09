import { readBarcodes } from "zxing-wasm/reader";
export const MAX_QR_IMAGE_PIXELS = 16_000_000;
export const QR_IMAGE_TOO_LARGE_ERROR =
  "Selected image is too large to scan as a QR code.";
export function assertQrImageBounds(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_QR_IMAGE_PIXELS
  )
    throw new Error(QR_IMAGE_TOO_LARGE_ERROR);
}
interface Point {
  x: number;
  y: number;
}
function distance(point: Point, corners: Point[]): number {
  let positive = false,
    negative = false,
    nearest = Infinity;
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const cross = dx * (point.y - a.y) - dy * (point.x - a.x);
    positive ||= cross > 0;
    negative ||= cross < 0;
    const along = Math.max(
      0,
      Math.min(
        1,
        ((point.x - a.x) * dx + (point.y - a.y) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    nearest = Math.min(
      nearest,
      Math.hypot(point.x - a.x - along * dx, point.y - a.y - along * dy),
    );
  });
  return positive && negative ? nearest : 0;
}
export async function decodeQrImageData(
  data: ImageData,
  focus?: Point,
): Promise<string> {
  assertQrImageBounds(data.width, data.height);
  const rows = await readBarcodes(data, {
    formats: ["QRCode"],
    tryHarder: true,
    maxNumberOfSymbols: 20,
  });
  if (focus)
    rows.sort((a, b) => {
      const corners = (row: typeof a) => [
        row.position.topLeft,
        row.position.topRight,
        row.position.bottomRight,
        row.position.bottomLeft,
      ];
      return distance(focus, corners(a)) - distance(focus, corners(b));
    });
  return rows.find((row) => row.text)?.text ?? "";
}
