/**
 * 互动的编号表（DESIGN.md 第 6 节）：短语、表情包、道具共用 kit 的 emote id。
 * 0–13 四川味短语（view/text.ts 的 PHRASES），14–25 表情包（kit `STICKERS` 的顺序），26–33 道具（kit `PROPS` 的顺序）。
 * 只往后加，不改不删（新旧页面要对得上）；张数和 kit 对得上由 test/banter.test.ts（`funIdCount`）检查。
 * 不 import kit 的 fun（那是浏览器的画面代码，房间用不到）。
 */
export const PHRASE_COUNT = 14;
export const STICKER_BASE = PHRASE_COUNT;
export const STICKER_COUNT = 12;
export const PROP_BASE = STICKER_BASE + STICKER_COUNT;
export const PROP_COUNT = 8;
export const EMOTES = PROP_BASE + PROP_COUNT;
