import QRCode from "qrcode";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasm from "zxing-wasm/reader/zxing_reader.wasm?url";
import {
  assertQrImageBounds,
  QR_IMAGE_TOO_LARGE_ERROR,
  decodeQrImageData,
} from "./image";
import { InputError } from "./records";
prepareZXingModule({
  overrides: {
    locateFile(filename: string, directory: string) {
      if (filename.endsWith(".wasm")) return wasm;
      return directory.concat(filename);
    },
  },
});
export async function qrImage(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 288,
    margin: 3,
    errorCorrectionLevel: "M",
  });
}
export async function scanImage(
  blob: Blob,
  focus?: { x: number; y: number },
): Promise<string[]> {
  if (blob.size > 10 * 1024 * 1024) throw new Error(QR_IMAGE_TOO_LARGE_ERROR);
  const image = await createImageBitmap(blob);
  try {
    assertQrImageBounds(image.width, image.height);
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(image.width, image.height)
        : Object.assign(document.createElement("canvas"), {
            width: image.width,
            height: image.height,
          });
    const ctx = canvas.getContext("2d") as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new InputError("unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, image.width, image.height);
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height);
    if (focus) {
      const text = await decodeQrImageData(pixels, focus);
      if (!text) throw new Error(QR_DECODE_ERROR);
      return [text];
    }
    const found = await readBarcodes(pixels, {
      formats: ["QRCode"],
      tryHarder: true,
      maxNumberOfSymbols: 20,
    });
    const values = found.map((item) => item.text).filter(Boolean);
    if (!values.length) throw new Error(QR_DECODE_ERROR);
    return values;
  } finally {
    image.close();
  }
}

export const QR_DECODE_ERROR =
  "No QR code could be decoded from the selected image. Use a clear image with the whole QR code visible.";
export const renderQrDataUrl = qrImage;
export async function decodeQrFiles(
  files: File[] | FileList,
): Promise<string[]> {
  if (files.length > 20)
    throw new Error("Select 20 or fewer QR images at a time.");
  const texts: string[] = [];
  for (const file of Array.from(files)) {
    if (file.size > 10 * 1024 * 1024)
      throw new Error("Selected image is too large to scan as a QR code.");
    const decoded = await scanImage(file).catch((failure: unknown) => {
      if (
        failure instanceof Error &&
        failure.message === QR_IMAGE_TOO_LARGE_ERROR
      )
        throw failure;
      return []; // A batch may contain unrelated images.
    });
    texts.push(...decoded);
  }
  if (files.length && !texts.length) throw new Error(QR_DECODE_ERROR);
  return texts;
}
