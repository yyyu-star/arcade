import type Phaser from 'phaser';
import { APP_VERSION, BUILD_TIME } from '../../platform/version.ts';
import { isTouch } from '../input.ts';
import { ABOUT_CONTROLS, ABOUT_TOUCH_CONTROLS, aboutRules } from '../labels.ts';
import { COLOR } from '../theme.ts';
import { Button } from './button.ts';
import { Dialog, phonePanel } from './dialog.ts';
import { addText } from './text.ts';
import { phoneLayout } from '../viewport.ts';

const W = 700;

/** 关于：版本、原创声明、0.3 的玩法简介、操作与快捷键（触屏设备只列点击操作）。 */
export class AboutPanel extends Dialog {
  constructor(scene: Phaser.Scene) {
    // 手机横屏放不下 580 高：改成两栏，左边版本和玩法，右边操作；面板取 phonePanel（SE 上 702×392），左栏宽按面板宽算
    const phone = phoneLayout(scene);
    const pp = phone ? phonePanel(scene) : null;
    const w = pp ? pp.w : W;
    super(scene, w, pp ? pp.h : 580, '关于《开盘》');
    const touch = isTouch();
    const built = BUILD_TIME ? BUILD_TIME.replace('T', ' ').slice(0, 16) : '开发版';
    const leftW = phone ? Math.round((w - 64 - 28) * 0.62) : W - 64;
    const note = addText(scene, 32, phone ? 90 : 94, '画面和声音都是程序生成的原创内容；股票、群友、公司全是虚构的。', { size: 13, color: COLOR.muted, wrap: leftW });
    this.inner.add([addText(scene, 32, phone ? 66 : 72, `版本 ${APP_VERSION} · 构建于 ${built}`, { size: 14 }), note]);
    // 手机：说明可能折成两行，玩法从它下面接着排，行距收一点好让四段放进 392
    let y = phone ? note.y + note.height + 10 : 126;
    for (const line of aboutRules()) {
      const t = addText(scene, 32, y, line, { size: 14, color: COLOR.ink, wrap: leftW, lineSpacing: phone ? 2 : 4 });
      this.inner.add(t);
      y += t.height + (phone ? 5 : 6);
    }
    y += 8;
    // 手机：操作列在右栏，从玩法同一高度开始
    const cx = phone ? 32 + leftW + 36 : 32;
    if (phone) y = 66;
    const keyW = phone ? (touch ? 80 : 110) : 188;
    const descW = w - (cx + keyW) - 32;
    this.inner.add(addText(scene, cx, y, touch ? '操作' : '操作与快捷键', { size: 16, bold: true, color: COLOR.accentDark }));
    y += 28;
    for (const [key, desc] of touch ? ABOUT_TOUCH_CONTROLS : ABOUT_CONTROLS) {
      const k = addText(scene, cx, y, key, { size: 14, bold: true, wrap: keyW - 8 });
      const d = addText(scene, cx + keyW, y, desc, { size: 14, color: COLOR.muted, wrap: descW, lineSpacing: 2 });
      this.inner.add([k, d]);
      y += Math.max(k.height, d.height) + 6;
    }
    const ok = new Button(scene, w - 32 - 130, this.dh - (phone ? 56 : 64), { width: 130, height: 44, label: '知道了', variant: 'primary', fontSize: 16 });
    ok.setHandler(() => this.close());
    this.inner.add(ok);
    this.named['about:ok'] = ok;
  }
}
