const SIGNATURE_MAX_WIDTH = 420;
const SIGNATURE_JPEG_QUALITY = 0.72;

export function canvasToSignatureDataUrl(canvas: HTMLCanvasElement) {
  const scale = Math.min(1, SIGNATURE_MAX_WIDTH / canvas.width);
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d");
  if (!context) return canvas.toDataURL("image/jpeg", SIGNATURE_JPEG_QUALITY);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(canvas, 0, 0, width, height);
  return output.toDataURL("image/jpeg", SIGNATURE_JPEG_QUALITY);
}
