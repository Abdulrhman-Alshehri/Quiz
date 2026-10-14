import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Brand-blue modules on white, like the QR codes on the deck's quiz slides.
// With fluid, CSS sets the size (the big-screen lobby scales it to the screen).
export function QrCode({ value, size = 240, label, fluid = false }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, {
      margin: 1,
      width: Math.round(size * 2),
      errorCorrectionLevel: 'M',
      color: { dark: '#134A9C', light: '#FFFFFF' },
    })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return (
    <div className="qr" style={fluid ? undefined : { width: size, height: size }}>
      {src ? <img src={src} width={size} height={size} alt={label || `QR code linking to ${value}`} /> : null}
    </div>
  );
}
