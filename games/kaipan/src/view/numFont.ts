/**
 * 0.16.0 数字字体（Kaipan Num，由 OFL 的 Fredoka 改出，见 public/assets/fonts/README.md）。
 * Phaser 的文字画在画布上，字体没到就按回退字体画、到了也不会重画：所以启动时先等它，最多等 2 秒。
 */
const NUM_FONT = 'Kaipan Num';
const URL_ = 'assets/fonts/kaipan-num.woff2';
const WAIT_MS = 2000;

export async function loadNumFont(): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
  try {
    const face = new FontFace(NUM_FONT, `url(${URL_}) format("woff2")`);
    document.fonts.add(face);
    await Promise.race([face.load(), new Promise((r) => setTimeout(r, WAIT_MS))]);
  } catch {
    // 加载失败就用回退字体，数字照样能看
  }
}
