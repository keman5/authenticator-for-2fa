import { decodeQrFiles } from "./qr";
import { readPortableBackup } from "./portable";
import { getErrorMessage } from "./feedback";
export const MAX_IMPORT_FILES = 20;
export async function readImportFiles(files: File[]) {
  if (files.length > MAX_IMPORT_FILES)
    throw new Error("Select 20 or fewer files at a time.");
  const result: {
    texts: string[];
    encrypted: { name: string; text: string }[];
    errors: string[];
  } = { texts: [], encrypted: [], errors: [] };
  const images = files.filter(
    (f) =>
      f.type.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif|bmp|avif|heic)$/i.test(f.name),
  );
  for (const file of files.filter((f) => !images.includes(f))) {
    try {
      if (file.size > 2_000_000)
        throw new Error("File is too large to import.");
      const text = await file.text();
      if (readPortableBackup(text))
        result.encrypted.push({ name: file.name, text });
      else if (text.trim()) result.texts.push(text);
    } catch (error) {
      result.errors.push(`${file.name}: ${getErrorMessage(error)}`);
    }
  }
  if (images.length)
    try {
      result.texts.push(...(await decodeQrFiles(images)));
    } catch (error) {
      result.errors.push(getErrorMessage(error));
    }
  return result;
}
