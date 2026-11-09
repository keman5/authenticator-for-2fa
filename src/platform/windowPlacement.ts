export interface WorkArea {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface SourceWindow {
  left?: number;
  top?: number;
  width?: number;
}
export function cameraWindowBounds(
  source: SourceWindow | undefined,
  area: WorkArea,
  preferredWidth = 370,
  topOffset = 85,
  preferredHeight = 800,
): WorkArea {
  const width = Math.min(area.width, preferredWidth),
    height = Math.min(area.height, preferredHeight);
  const limit = (n: number, start: number, size: number, extent: number) =>
    Math.round(Math.min(Math.max(n, start), start + extent - size));
  return {
    width,
    height,
    left: limit(
      (source?.left ?? area.left) + (source?.width ?? area.width) - width,
      area.left,
      width,
      area.width,
    ),
    top: limit(
      (source?.top ?? area.top) + topOffset,
      area.top,
      height,
      area.height,
    ),
  };
}
