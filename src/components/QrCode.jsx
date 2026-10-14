import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QrCode({ value, size = 240, label }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, {
      margin: 1,
      width: Math.round(size * 2),
      errorCorrectionLevel: 'M',
      color: { dark: '#1D2128', light: '#FFFFFF' },
    })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return (
    <div className="qr" style={{ width: size, height: size }}>
      {src ? <img src={src} width={size} height={size} alt={label || `QR code linking to ${value}`} /> : null}
    </div>
  );
}
