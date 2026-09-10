import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeProps {
  value: string;
  size?: number;
}

export function QrCode({ value, size = 420 }: QrCodeProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b0d12', light: '#ffffff' },
    })
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('QR-Code konnte nicht erzeugt werden.');
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div className="qr">
      <canvas ref={canvasRef} className="qr__canvas" width={size} height={size} aria-label="QR-Code zur Umfrage" />
      {error ? <p className="qr__error">{error}</p> : null}
    </div>
  );
}
