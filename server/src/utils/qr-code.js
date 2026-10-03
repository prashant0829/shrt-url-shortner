import QRCode from 'qrcode';
import { ContentType, QrFormat } from '../constants.js';

const QUIET_ZONE_MODULES = 2;

// Medium error correction survives print and screen wear well.
const ERROR_CORRECTION_LEVEL = 'M';

export async function renderQr(text, { format, size }) {
  const options = { margin: QUIET_ZONE_MODULES, errorCorrectionLevel: ERROR_CORRECTION_LEVEL };

  if (format === QrFormat.SVG) {
    const body = await QRCode.toString(text, { ...options, type: 'svg' });
    return { body, contentType: ContentType.SVG };
  }

  const body = await QRCode.toBuffer(text, { ...options, type: 'png', width: size });
  return { body, contentType: ContentType.PNG };
}
