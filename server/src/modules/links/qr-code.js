import QRCode from 'qrcode';

/** Renders `text` as a QR code. Medium error correction survives print and screen wear well. */
export async function renderQr(text, { format, size }) {
  if (format === 'svg') {
    const body = await QRCode.toString(text, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
    return { body, contentType: 'image/svg+xml' };
  }
  const body = await QRCode.toBuffer(text, {
    type: 'png',
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
  return { body, contentType: 'image/png' };
}
