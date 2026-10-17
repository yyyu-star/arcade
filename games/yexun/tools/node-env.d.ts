declare module 'subset-font' {
  export default function subsetFont(font: Buffer, text: string, opts?: { targetFormat?: 'woff2' | 'woff' | 'truetype' | 'sfnt' }): Promise<Buffer>;
}
