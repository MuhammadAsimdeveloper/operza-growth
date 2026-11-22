declare module 'qrcode' {
  export interface QRCodeToStringOptions {
    type?: 'svg' | 'utf8';
    width?: number;
    margin?: number;
    color?: {
      dark?: string;
      light?: string;
    };
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  }

  export function toString(text: string, options?: QRCodeToStringOptions): Promise<string>;
  export function toString(text: string, options: QRCodeToStringOptions, callback: (err: Error | null, string: string) => void): void;
  export function toDataURL(text: string, options?: any): Promise<string>;
  const QRCode: {
    toString: typeof toString;
    toDataURL: typeof toDataURL;
  };
  export default QRCode;
}
