# 更新日志

## 0.20.3（2026-10-20）

- **首次提示"点头像扔道具"不再盖任何座位的名牌**（所有者 10-20）：0.20.1 起名牌和标签（`FunSeat.plate`、`marks`）只是代价 ×3，头像四边都压到时提示还是会挑一边盖上。
  现在提示一点都不许压名牌、标签、"互动"按钮和聊天框：四边都会压就在可见区里找最近的空处（新的 `placeClear`）；整句放不下换短句"点头像扔道具"；还放不下就过 2 秒再试，没冒出来不记"已提示"。普通聊天、表情气泡照旧贴着说话人。
- **弹幕里自己那条"我：…"换成卡通第二版的配色**：原来深红底金边，现在奶油渐变底、深棕描边、深棕字（"我："红棕），和别人那种半透明深色底一眼分得开。

## 0.20.2（2026-10-18）

- **电脑版聊天框照常展开**：0.20.1 把快捷短语换行排开后，框变高了；1920 宽的掼蛋被判"放不下"、默认收成"聊天"小按钮，和"电脑上聊天要显眼"冲突。
  现在聊天框里的快捷短语最多两行（按钮矮一点，32 像素），多出的在框内上下滚；空记录区最少一行（原来两行，空时那句提示一行放得下）。框的总高度和 0.20.0 一样，掼蛋 1920 实测 216 像素、照常展开，8 个短语全看得见。
  手机输入条上的照旧横着滑。

## 0.20.1（2026-10-18）

牌桌互动的遮挡和两个公开参数（只修布局，不加功能）：
- **气泡不盖名牌**：头像旁的气泡（含首次提示"点头像扔道具"）把各家的名牌（名字、筹码数）当硬禁区（代价 ×3，和按钮、聊天框一样）。0.18.2 当软的，别处也挤时提示还是会盖住对家的名字和筹码。接线抽成纯函数 `bubbleZones`，测试带反证。
- **头像旁的标签**（麻将体检：首次提示"点头像扔道具"压住右上家的缺门签）：`FunSeat` 加 `marks`（缺门签、庄家这类小标签的屏幕矩形），和名牌一样当硬禁区。
- **电脑版聊天框的快捷短语**（麻将体检：最后一个只露半截）：聊天框里那排换行排开、全部看得见；手机输入条上的照旧横着滑。
- **竖屏自己的气泡和"互动"按钮**：核对过 0.19.1 已经修好（按钮是硬禁区），补了接线的测试。
- **"互动"按钮的大小**：`buttonStyle` 加 `fontSize`、`icon`（像素，给了就不按 `scale` 算；字不小于 12、图标不小于 16）。德州、麻将可以不再覆盖 `.atf-btn`，颜色、圆角走主题变量。
- **默认收起聊天框**：`TableFunOptions.chatFolded()`。玩家没点过收起、展开时听它，给了 `chatDock` 也生效；玩家点过就以玩家为准。德州可以不再自己往 `texas.chat` 写 `folded`。

## 0.20.0（2026-10-18）

快速匹配（设计 docs/match.md，#290 审过，主线定了四个待定）：同一个游戏、同一个档位排队，凑满一桌立刻开，最多等 15 秒，到点 ≥ 2 个真人开桌、只剩自己转本机单机。不新建 Worker。
- **排队** `arcade-kit/match` 的 `MatchQueue`（新入口，DO）：每个档位一个实例；0 行存储（排着的人就是休眠的 WebSocket）、一个闹钟（最早那个人到点）；同一个人再排旧连接 4001 让位；
  每人每小时 30 次（4029）、队长 200（1013）；排队连接只收不发（发了 1008）。凑桌前问平台 `ARCADE.blockedAmong`，屏蔽过的两个人不同桌；单独部署没有平台时跳过。
- **入口** `acceptMatch(request, env, tier, { tiers })`：认人、查 Origin 和进房一样；入队前问一次计量（新的只读 `kitPeek`）：有开着的房间回 `has_room`，今天的次数用完、联机忙、计量连不上回 `solo`。
- **房间** `kitCreateMatch`：一次占齐所有人的名额（新的 `kitReserveMany`，占不齐一个都不占），排进来的人建房时坐好（`matchSeats(n, count)` 可覆盖，默认随机）；
  都连上就和最后一个人进房同一步开打，等满 `RoomLimits.matchJoinMs`（20 秒）没来的电脑代打、来了交还；外人进房 4004，`start` 回 `not_host`，等人时不能换座；
  打完、关房还每个人的名额（`kitReleaseMany`）。`RoomInfo.match` 告诉页面这是匹配桌。好友房行为不变。
- **页面** `MatchClient`（`onWaiting`、`onMatched`、`onHasRoom`、`onSolo`，断线不重连）和转单机的默认文案 `MATCH_TEXT`（"今天联机局数用完了，先和电脑打"等）。
- **安全审阅改的几处**：凑桌找平台、找房间各等最多 3 秒（`MATCH_CALL_MS`，用 `scheduler.wait`，不占闹钟），屏蔽名单超时按空的、建房超时这一桌转单机；
  入队先回 101 再凑桌；`MatchClient` 到点再过 10 秒（`MATCH_GRACE_MS`）没结果自己转单机；开打时没来的人退名额和当天次数；
  队长上限只数还排着的连接；每小时的入队记录清掉一小时前的；新纯函数 `matchConfigErrors`（`arcade-kit/game`）让游戏在测试里查档位配置；
  `kitReserveMany` 的注释写明一次写 1 + 人数 行（计量里，不算房间的一步）。
- **聊天框放不下就先收着**（掼蛋 0.24.0 线上问题）：电脑版聊天框四个角都会压到头像、名牌、出牌区时（新纯函数 `dockFits`，按排出来的真实高度判断），玩家又没自己展开或收起过，默认收成"聊天"小按钮。
  掼蛋 1280×720 上它原来压在左上角，盖住左家的头像和剩余张数、点不到他；1920 放得下照常展开（截图核对过）。
- 额度：匹配桌也占每天的开房名额（`dailyRoomsPerUser`，默认 6，游戏 `vars.KIT_QUOTA` 里改）；全站开房数一张桌只记 1。
- 文档：docs/match.md 改成实现版（陌生人打字聊天默认开、设置里能关，开放公开注册时重新评估；屏蔽名单直接用平台 0.25.0 的 RPC）；README 加"快速匹配"一节。
- 测试：`match.test.ts` 18 条、`client.test.ts` 加 4 条（MatchClient、兜底）、`game.test.ts` 加 1 条（matchConfigErrors）、`fun-logic` 加 1 条（dockFits）；`FlakyMeter` 改拦 `kitReserveMany` / `kitReleaseMany` / `kitPeek`。
  反证七处（外人能进、不自动开打、不按 joinBy 开、没来的不托管、只还第一个人的名额、建房不设超时、没来的不退名额）各有测试失败。

## 0.19.1（2026-10-18）

0.19.0 接进掼蛋后截图看出的两处（主线定）：
- 气泡压到叠在它上面、能点的东西（"互动""聊天"按钮、聊天框）代价按 3 倍算（`placeBubble` 的新参数 `hard`，倍数 `HARD_COST`）：按钮在气泡上面，压了字就看不见；
  原来只按面积挑，掼蛋手机横屏的好友房里"右边压按钮"和"上边擦左家名牌"面积差不多，自己的气泡钻到了"互动"按钮底下。
- 弹幕层裁在弹幕区（`danmakuArea` 或默认区）里：从区的右沿出现、左沿消失，不再飘出区外擦过两边的座位。
- 测试：`fun-logic` 加 1 条（面积差不多时按钮当 hard 就换到另一侧）；反证：倍数改成 1 时失败。

## 0.19.0（2026-10-18）

聊天打磨（所有者：聊天太简陋、不显眼，电脑上气泡太小；设计见 docs/chat.md 第 5 节），并进了原定 0.18.2 的三处界面小修。游戏升级后不用改代码就能用，要摆得准再传几个可选项。
- **聊天入口**：电脑上牌桌一角常驻聊天框（最近几条记录、一排快捷短语、输入框，回车发送，可收起、可展开记录）；手机上"互动"旁边一个"聊天"按钮（未读红点），
  点开是贴在手牌和操作按钮上面的输入条（快捷词、输入框、发送、记录、✕），键盘弹起时站到键盘上面。快捷短语点了按短语发，走互动的通道和冷却。
- **弹幕**：所有人说的话（含自己、含短语）从右往左飘，自己的高亮；按轨道排，避开手牌、按钮、头像、名牌、中间信息区（新选项 `center()`）、聊天框和气泡；
  弹幕垫在效果层最底下，气泡永远在上面。同屏最多 12 条（手机 6 条），只动 transform。"弹幕：开 / 关"默认开，减少动态效果或省内存（新选项 `lite()`，默认看 deviceMemory ≤ 2）时默认关；
  `fun.danmaku()` / `fun.setDanmaku(on)` 给游戏设置用。
- **气泡**：字号按屏幕（电脑 18–22px、手机 ≥ 15px），最多两行折行，不再一行截断；聊天的停 5 秒（`CHAT_UI.bubbleMs`）；新气泡也避开正在显示的气泡。
  位置由纯函数 `placeBubble` 挑：朝牌桌中间、另一侧、上、下，避开"互动"按钮、聊天框、名牌、别家头像（原 0.18.2：竖屏自己的气泡被按钮压住、道具气泡盖住对家名字和筹码）。
  `FunSeat` 加可选的 `plate`（名字和筹码那块）。
- **记录**：最近 30 条，名字按座位配色；电脑在聊天框里，手机在互动面板的聊天页。
- **设置存储**：新选项 `prefsKey`（默认 `<storageKey>.chat`，必须是 `<游戏id>.<名字>`，不合格构造时抛错），存弹幕开关、聊天框收起和记录展开。
- **互动按钮的尺寸参数**（原 0.18.2）：`buttonStyle?() → { scale?, row? }`，替掉游戏对 `.atf-btn` 的覆盖；不传就不写行内样式，旧覆盖照样生效。图标尺寸走 `--atf-icon`。
- 新选项 `chatDock()`、`chatButton()`、`danmakuArea()` 让游戏指定聊天框、手机聊天按钮的位置和弹幕区；纯函数 `chatMode`、`chatFont`、`danmakuLanes`、`danmakuSpeed`、`pickLane`、`placeDock`、`barBottom`、`placeBeside`、`seatColor` 在 `fun-logic`。
- `controls()` 改成报 `.atf-ui` 里所有带 `data-key` 的东西（聊天框、聊天按钮、输入条都能点到）。
- 测试：`fun-logic` 加 14 条（气泡 4 条；版式、轨道、停靠、输入条、按钮、配色 10 条），`table-fun` 加 2 条（prefsKey），主题守卫扫 `table-chat.ts`。
  反证两处：不看 avoid 时气泡测试失败；轨道不看 blocked 时 2 条失败。

## 0.18.1（2026-10-18）

- 单机也能聊（所有者要求聊天通用）：`arcade-kit/chat` 加 `localChat(say, opts?)`，返回和 `RoomClient.chat` 一样用法的发送函数：过同一套 `checkChat`、本地限速（默认同房间 3 秒一条、一分钟 10 条，`opts.now` 给测试注入），
  行就调 `say(text, masked)`。只在本机显示自己说的，不发、不存，不碰 DOM；电脑不读。
- `ChatSendResult` 类型挪到 `chat.ts`（`client.ts` 照旧导出，旧代码不用改），`chat.ts` 不依赖 `client.ts`。
- 测试：`test/chat.test.ts` 加 3 条（过滤同房间、限速两道和拒发不占条数、`ms`/`perMin` 为 0 不限）；反证：让被拒的也占条数，测试失败。docs/chat.md、README 写明单机怎么接。

## 0.18.0

好友房打字聊天（设计 `docs/chat.md`，主线审过；`docs/social.md` 3.1 改成要做）。游戏要显式打开，不开的游戏行为完全不变。
- **房间**：`RoomGame.chat = true` 后入座的人能发 `{ t: 'chat', text }`；房间过 `checkChat`、按座位限速（3 秒一条、一分钟 10 条，`RoomLimits.chatMs` / `chatPerMin`，`KIT_QUOTA` 可改），
  只转发给连接时带了 `chat=1` 的连接（`{ t: 'chat', seat, text, masked? }`）。0 行存储、不改 seq、不进快照和 welcome；被拒回 `CHAT_ERRORS` 里的 code、不占条数。`welcome.chat` 带节奏和字数。
- **过滤**（新入口 `arcade-kit/chat`，纯函数）：NFKC 规整、去零宽和方向控制符；≤ 30 个字；链接、连续 7 位以上的数字（空格、横线、中文数字拆开的也认）、微信 QQ 号样式整条拒发；
  **标准千分位的金额放行**（1,000,000，≤ 10 位，主线审时加的），拒发提示"不能发号码，金额请写成 1,000,000"；脏话按 `chat-words.ts` 打码照发，游戏能用 `chatWords` 加词。
- **页面**：`RoomClient` 的 `onChat`、`onChatError`、`chat(text)`（本地先挡）、`chatWait()`；`acceptJoin` 把 `chat=1` 转给房间。
  `TableFun` 的 `chat` / `chatEnabled` 选项、`chat(seat, text)` 收、`chatError(code)`：聊天页、4 秒气泡、小红点、键盘避让。`bubble()` 多一个 `cls` 参数并返回气泡元素。
- 平台屏蔽名单：按主线定的 B 方案，这一版只有 kit 本地屏蔽，平台 RPC 出了再接。
- 测试：`test/chat.test.ts` 20 条（过滤的绕法和误伤、金额、打码；房间转发、旧页面收不到、限速两道、被拒不占数、chat_off、不进快照和存储、聊天代码不碰存储和钩子；`RoomClient` 本地挡和分流）。
  反证：去掉房间的限速、不看 `chat=1` 都转发，对应测试失败。演示页截了 1280×720 和手机横屏 844×390，控制台零报错。

## 0.17.0

- 牌桌互动加可选的 `hintSeat()`：首次提示"点头像扔道具，长按连扔"冒在哪个座位由游戏定，返回 null 表示现在会挡住东西（比如那家刚出的牌），组件过 2 秒再问。
  掼蛋手机横屏上提示一直冒在右家头像左边，正好盖住右家刚出的牌（主线验收时发现）。不给就和以前一样挑第一个电脑。
- 挑座位的逻辑抽成纯函数 `hintSeatFor`，`test/table-fun.test.ts` 加两条（反证：忽略游戏给的座位，测试失败）。

## 0.16.0

DOM 组件的主题参数（主线要的：kit 的菜单、面板和各游戏的风格不一致）。
- **`--ak-*` 变量**：`share.ts` 的预览层、`social.ts` 的邀请横条和"叫朋友来"面板、`table-fun.ts` 的菜单和面板，颜色、圆角、字体改成 `var(--ak-xxx, <原来的值>)`，
  共 11 个：`bg`、`fg`、`accent`、`accent-fg`、`border`、`radius`、`radius-btn`、`font`、`overlay`、`soft`、`title`（每个用在哪见 README"主题"一节）。**默认值就是原来写死的值，不传主题外观不变。**
- **`theme?: KitTheme`**：`ShareOptions`（`shareCard`、`prepareShare`）、`SocialOptions`（`mountSocial`；`handle.openInvite` 的面板默认用它）、`InvitePanelOptions`（`openInvite`）、`TableFunOptions` 都多一个可选的 `theme`，
  传了就把变量写到组件根节点的 style 上，没传就不写（游戏也可以只在自己的 CSS 里把 `--ak-*` 写在 `:root` 上，靠继承生效）。
- **新入口 `arcade-kit/theme`**：`KitTheme` 类型、纯函数 `themeVars(theme)`（主题 → `[变量名, 值][]`）、`applyTheme(el, theme)`、`safeThemeValue`。
  值含 `;` `{` `}` `<` `>` `\`、`/*`、`url(`、`expression`、`@import`、`javascript:` 或超过 200 字的字段忽略（防 CSS 注入）。import 时不碰 DOM，无运行时依赖。
- 不动的：分享卡 canvas 的配色（由游戏给的 `card.accent` 定）、`fun.ts` 的素材、状态色（灰、开、选中）、气泡米色底、名场面横幅红渐变。
- 测试：`test/theme.test.ts` 11 条：`themeVars` 的映射、空对象、拒绝注入；源码守卫扫 `share.ts`、`social.ts`、`table-fun.ts`、`fun.ts`，每个 `var(--ak-` 都带默认值、变量名都在 `theme.ts` 的表里，`applyTheme` 写在根节点 `cssText` 之后（自审时发现横条写反了，主题会被清掉）。
  反证：让 `themeVars` 接受带 `;` 的值、去掉 `share.ts` 一处默认值，对应测试都失败。演示页（`demo/*.html?theme`）换深色木纹 + 金色强调，默认和换主题各截了图对比。

## 0.15.1

急修：桌面上点"分享"每次失败（所有者在 Windows Chrome 上点德州"分享这一场"）。
- **系统分享只给手机、平板**：新纯函数 `useSystemShare(ua, maxTouchPoints)`。Windows Chrome 的 `canShare` 对文件回 true，以前会弹出 Windows 系统共享，选微信后微信 PC 版窗口空白、报"共享失败"；
  现在 Windows、Mac、Linux 桌面（含触屏笔记本）一律直接出预览。iPadOS（桌面版 UA）靠多点触控认成平板；微信内置浏览器照旧不调。
- **桌面预览加"复制图片"**（`navigator.clipboard.write` + `ClipboardItem`，不支持就不摆），成功提示"已复制，去微信里粘贴"；按钮顺序：复制图片、保存图片、复制链接、关闭。`data-key` 是 `share:copy-image`。
- 测试：`share.test` 加 `useSystemShare` 的表驱动（Windows Chrome / Edge、触屏 Windows、Mac Chrome / Safari、Linux、iPadOS、老 iPad、iPhone、安卓手机和平板、鸿蒙、iOS 和 Windows 的微信）和桌面预览的按钮；反证过。
  浏览器实测（Windows UA，`canShare` 假装回 true）：不调系统分享、直接出预览，"复制图片"后剪贴板里是 `image/png`。

## 0.15.0

分享卡加强（主线派，所有者要"晒战绩、一键分享、发朋友圈"）。
- **右下角二维码**：朋友圈里的图不能点，扫码是唯一入口。内容是运行时的 `location.origin` 加上 `opts.url` 的路径、查询和 `#`（`shareLink`），代码里不写域名。
  纯白框、近黑的格、每格整数像素、留白 ≥ 4 格，下面写"扫码来玩"；名场面和日期往左让。链接太长（> 213 字节）不画码。
- **二维码编码器 `src/qr.ts`**：自己写的最小子集（字节模式、纠错 M、版本 1–10），不引运行时依赖（kit 至今零运行时依赖，引一个就进每个游戏的 lockfile 和审阅范围）。
- **微信内置浏览器**：检测到 `MicroMessenger` 不试系统分享，直接出预览：图用 `data:` URL，提示"长按图片 → 发送给朋友，或保存后发朋友圈"，不给"保存图片"。
- **系统分享的 `text` 末尾带上链接**（有的 App 只取 text）；系统分享的 `url`、"复制链接"也换成 `shareLink` 算出的那一个。
- `drawShareCard(card, canvas?, link?)`、`shareCardBlob(card, link?)` 多一个可选参数，不给就和以前一样不画码。
- 测试：`qr.test`（新）：版本 1–10 的边界长度都用 jsQR（Apache-2.0，devDependency）解回原文，格式信息、版本信息对规范表的已知向量；`share.test` 加链接、文字、码的留白、微信 UA 几条。
  反证：格式信息错 1 位、纠错码生成元错、版本信息 BCH 错、链接用游戏给的域名、微信里给保存、文字不带链接，都让测试失败（格式信息错 1 位解码器会纠正，所以另加了已知向量）。
  浏览器里实画三张演示卡，JPEG 质量 0.6、缩到 360 宽后都解得出链接。

## 0.14.0

第三轮安全审计 kit 的三条（主线派）。
- **进房猜码限次**（中）：`acceptJoin` 按人、按 IP 数每小时"码不存在"的次数（`KIT_QUOTA` 新字段 `joinMissesPerUser` 20、`joinMissesPerIp` 60）。超了以后进任何房间都回 1013，
  房间在不在都一样；只有这个房间的自己人（房主、坐着的、开打后绑过座位的）照常进，断线重连不受牵连。计数放在计量类按人、按 IP 取的小实例里（不挤全站那一个），每次各 1 行并记进当天的数。
  房间回"码不存在"时在 101 上带内部头 `x-kit-miss`，转给浏览器前去掉。
- **令牌桶按人记**（低）：以前每条连接一个桶，断开重连就拿到一个满的；现在按 userId。
- **旁观名额**（低）：按账号数；房主和开打后绑过座位（离座去看）的人不占名额、也不受限，几个陌生账号占满名额也挡不住他们。
- 评估（只评估，没做）："房主踢人"和"只许好友坐下"见 PR 说明；结论是暂不做，猜码限次加上开打后座位绑人已经够用，出现滥用再加。
- `worker.ts` 只按类型引用 `meter.ts`（门槛由计量的小实例自己按 `KIT_QUOTA` 算）：游戏会在普通 Node 的测试里加载 `worker.ts`，`meter.ts` 依赖 `cloudflare:workers`；加了一条架构测试守住。
- 测试：`room.test` 第三轮审计 4 条；反证（不去内部头、不记数、超限不放自己人、不带超限头、令牌桶按连接、绑过座位的也占名额）都会让测试失败。

## 0.13.1

稳定性小修（主线派，含第三轮审计 kit 的 setAlarm 一条）。
- **闹钟设不上不再让房间停住**：
  - 房间：`setAlarm` 出错当场再试一次；两次都失败、又不是闹钟触发的那一步时，按 `getAlarm()` 核对，存储里没有闹钟就补一个 60 秒后的（醒来按状态重新算），不再只等下一个入口。
  - 浏览器：`RoomClient` 加看门狗。状态和进房快照多带一个 `now`（房间发消息时的时间，协议只加字段）；房间说的出手时限或停顿结束过了 `STALL_GRACE_MS`（20 秒）加最多 10 秒抖动还没有新状态，
    就重连一次把房间叫醒（存储一直坏着、补设也失败时的最后一道）。同一个 seq 只踢一次，抖动让一桌人里先到的去踢。旧房间不带 `now` 的不看。
- **`table-fun` 的 `storageKey` 校验**：只认游戏 id 的写法（小写字母、数字、连字符，最多 32 位，不能是 `arcade`），拼出来的 key 一定是 `<游戏id>.` 开头；不合格构造时直接抛错（`checkStorageKey`）。
- **`test/quota.test.ts`"分批报"偶发失败的根因**：打完一局、断开连接后，测试用 `lastStepWrites > 0` 等"房间处理完断开"，可打完那一步就已经 > 0，等于没等；
  机器一忙，断开晚于"拨时间 + 叫醒闹钟"，房间不按"没人了"关，少了关房那一次报数，最后的等式差几行。现在等房间存下 `noHumanSince` 再拨时间（和 `ledger.test` 一样），
  最后的账用等条件成立的方式核对，不按固定时间等。反证：老写法下让断开晚于闹钟处理，必挂（差 4 行）。
- 测试：`client.test`（看门狗 4 条）、`room.test`（重试一次就设上、`now`、补设 60 秒后的、两次都失败照旧）、`table-fun.test`（新）；改坏代码的反证都做过。

## 0.13.0

搭子战绩（平台 0.19.0，`docs/platform-backend.md` 15.19，主线派）。
- **`reportTogether(env, op, players)`**（`arcade-kit/room`）：好友房打完一场，把同桌真人（`{ userId, team?, win }`）经钱包服务绑定的 `together()` 报给平台。
  没有 `WALLET`（单独部署）或它没有 `together` 时跳过；去重后少于 2 人、多于 8 人、op 不合格时跳过；回话原样返回，抛错吞掉只记错误类型，不重试。
- **`GameRoom.reportMatch(players, match)`**：按座位给，按开打后绑的人认 userId（电脑座位不报），op 用 `togetherOp(房间码, 开房时刻, match)`，交给 `ctx.waitUntil`，在同步的 `onStep` 里调就行。
- **假钱包**（`arcade-kit/testing`）加 `together`：形状照平台的 parseTogether 查，记到每个人的 `FakeBank.together`，同一个 op 重报不加。
- 测试：`test/together.test.ts` 8 条（跳过的几种情况、正常调用、异常吞掉、op 拼法、假钱包的形状和去重、房间按座位认人，反证过）。

## 0.12.5

社交第二期的好友动态（平台 0.17.0，`docs/platform-backend.md` 15.17，主线派）。
- **`postMoment(game, moment, n?, n2?, n3?)`**（`arcade-kit/social`）：报一条娱乐名场面到 `POST /api/feed`，只带游戏 id、编号和最多 3 个整数；文字由游戏的 `public/moments.json` 按编号给模板（`{name}`、`{n}`、`{n2}`、`{n3}`）。
  返回 HTTP 状态（0 = 没连上）。平台超了每天 10 条、关了开关都静默回 204，所以游戏不用管条数；编号、数字本地就不合格的不发、回 400。
- 测试：`test/social.test.ts` 加 2 条（请求形状、本地拦下不合格的）。

## 0.12.4

线上补验发现（主线派）：掼蛋房间弹窗 `#online` 的 z-index 是 8500，盖住了"叫朋友来"面板（1600）：面板在 DOM 里，但看不见、点不到。
- **默认层级提到 10000 以上**（`SOCIAL_Z`）：邀请横条 10500、"叫朋友来"面板 10600、分享预览 11000，顺序照旧是横条 < 面板 < 预览。三处都能用 `zIndex` 选项再往上提（`mountSocial({ zIndex })`、`openInvite({ zIndex })`、`shareCard` / `prepareShare` 的 `zIndex`）。
- **好友"在哪"用平台给的游戏名**：`Presence` 加可选的 `gameName`（平台在好友列表的 `where` 里给）。`whereText` 先用它，没有再用 `gameName` 回调，都没有才说"在玩游戏"。kit 和游戏不用认识别的游戏。
- 测试：`test/social.test.ts` 的"在哪"加 3 条（平台名优先、好友房、空串退回回调）。

## 0.12.3

开盘、麻将接分享卡时报上来的两处（主线派）。
- **iOS 上调不起系统分享**：iOS 只许在点击的那一下（用户激活）里调 `navigator.share`，`shareCard` 是点了才画卡（解码图标、`toBlob` 要几百毫秒），激活过期了，只能退到预览。
  加 `prepareShare(card, opts)` → `{ ready, share() }`：结算页一出现就调它先画好，点"分享"时在点击的处理函数里直接调 `share()`（前面别 await）——卡已经画好就同步调 `navigator.share`；
  没画好就等画完再试，调不起来退回预览。`ready` 画失败也是 resolve（到 `share()` 时再报错）。`shareCard` 保留，内部走 `prepareShare`。
- **名场面的结尾引号单独掉到下一行**：折行时收尾的引号、右括号、逗号句号这些标点不放行首，把上一行最后一个字一起带下来（`wrapLines`）。
- 测试：`test/share.test.ts` 加 5 条（结尾引号、中间标点、带下来正好是最后一行要截断、一个字时不硬拆，`prepareShare` 画不了时 `ready` 不抛）。
  浏览器里用演示页 `demo/share.html` 的"分享第一张（先画好）"核对：假的 `navigator.share` 记下被调时还在点击的处理函数里（带 1 个 PNG 文件）；对照的 `shareCard` 是画完才调（已经出了点击）。

## 0.12.2

- **"叫朋友来"面板** `openInvite({ game, room })`（`arcade-kit/social`；mountSocial 返回的 handle 上也有 `openInvite`，自动带上游戏名）：0.12.0 只有 `sendInvite` 接口，游戏里没有叫人的界面。
  - 列好友，在线的在前，写在哪（"在<游戏名>的好友房 · 3/4""在大厅""3 天前来过"）；每人一个"叫他来"，发出后变"已叫"、1 分钟内灰着（这一页里记着，关了再开也灰着）。
  - 叫不了的换成大白话：429 等两分钟以内是"刚叫过他，过一会儿再叫"，更久是"今天叫人的次数用完了，明天再叫"；403 `not_friend` 是"叫不了他（可能已经不是好友了）"。
  - 底下"复制邀请链接"：能系统分享就分享，不能就复制，复制不了把链接写出来。`friends: false` 只有这个按钮（单独部署、没登录）。
  - DOM，样式和 table-fun 一样（同一套颜色、圆角、44px 按钮）；点空白处、✕、Esc 关掉；只在调用时碰 DOM。
- 新的纯函数 `whereText`、`inviteErrorText`，常数 `INVITE_GAP_MS`。
- 测试：`test/social.test.ts` 加两条（在哪的话、叫不了的话）。浏览器里用 `demo/social.html` 的"叫朋友来"按 390×844 和 1200×800 核对过：列表顺序和"在哪"、叫成功变"已叫"、被拒的、次数用完的、复制链接、Esc 关掉、再开还灰着，控制台零报错。

## 0.12.1

- **social 的好友列表一直是空的**：`fetchFriends` 只认每项的 `id`、`name`，平台 `GET /api/friends` 每项一直是公开资料 `{ userId, displayName, avatar }`（`docs/platform-backend.md` 15.4），
  所以全被当成形状不对丢掉了，游戏里"叫他来"出不来。改成认 `userId` / `displayName`（也兼容 `id` / `name`），统一成 `Friend.id`、`Friend.name`，平台原样的字段（`avatar` 等）留着。新导出 `parseFriend`。
- 测试：按平台的真实形状加一条（`test/social.test.ts`）。邀请（`from: { id, name }`、`until` 毫秒）平台照这个形状做，不用改。

## 0.12.0

社交第一期的两个部件（仓库根 `docs/social.md` 1.1–1.3；接口形状主线定、平台实现）。都只在调用时碰 DOM，import 时不碰；已有入口没改。
- **分享卡** `arcade-kit/share`：`drawShareCard` 用 Canvas 画 1080×1350 的战绩图（游戏给 `{ game, title, big, stats≤3, line, accent, art?, player?, date? }`），
  `shareCard` 能带文件就调 `navigator.share`，不能就出预览（保存图片、复制链接、关闭）。不上传、0 行写入。
  `art` 接受一个 `CanvasImageSource`，或者 `{ image, crop?, fit?: 'contain' | 'cover' }` 从图集切一块；是 img 时先 `decode()`，失败就不画 art、照常出卡。
- **报位置、收邀请** `arcade-kit/social`：`mountSocial` 只在有平台、已登录时挂；页面在前台时每 2 分钟 `POST /api/presence`、每 30 秒 `GET /api/invites`，
  顶上弹"老王叫你来<游戏> [去] [不了]"，过期不弹、已经在那个房间的不弹，"去""不了"都 `POST /api/invites/<id>/dismiss`；401 自己停。
  接口小函数 `postPresence`、`fetchInvites`、`dismissInvite`、`sendInvite`（429 → `limit`）、`fetchFriends`、`setShowWhere`，写的请求带 `x-arcade: 1`、同源 cookie。
- 测试：`test/share.test.ts`（截短、颜色、日期、折行、图集切片和 contain/cover 的位置）、`test/social.test.ts`（假 fetch 查每个接口的方法、地址、头、请求体和各种状态码，挑哪条邀请弹）。
  浏览器里用演示页 `demo/share.html`、`demo/social.html` 核对过：三种卡（图标、图集切片、坏图）都出 1080×1350，切片取到对的那格；无头 Chromium 没有带文件的分享，走预览，保存和复制都通；
  横条按到期先后弹、过期收起、"去""不了"各发一次 dismiss、和自己同房间的那条不弹，控制台零报错。

## 0.11.2

- **table-fun 窄屏**：互动面板（440 宽）、点头像的菜单（432 宽）在 390 竖屏上伸出屏幕（麻将接入时发现，先用 CSS 收窄了）。盒子宽度改成 `min(<宽度>px, calc(100vw - 16px))`，
  两边各留 8px；收窄后一排 8 个道具会折成两排，菜单的高度跟着内容走，量完按真实高度重新避开禁区。宽屏不变。接口不变。
- `fun-logic` 加 `fitMenuWidth(宽度, 屏幕宽, 留边 = 8)`，`placeMenu` 按它收窄后的宽度摆（和页面上的 CSS 一致）。
- 测试：`fitMenuWidth` 的取值，390 竖屏上头像在左、中、右、上、下时面板和菜单都夹在 [8, 382] 里。另在本机用演示页（`demo/table-fun.html`）按 390×844 实测：
  菜单 8–382、面板 8–382，都在屏幕里、内容没被截；改回固定宽度时两个都伸到 440 以外（反证）。

## 0.11.1

联机稳定性（平台代理只读审阅 kit 0.10.2 后列的清单，主线 2026-10-16 派）。协议不变：没有新消息、新字段，旧页面和新房间、新页面和旧房间都照常。
- **静默死掉的连接**（`client.ts`）：心跳和切回前台时发 `ping`，`PONG_WAIT_MS`（8 秒）内什么都没收到就判死、不等 close 直接重连；建连卡在 CONNECTING 超过 `CONNECT_MS`（10 秒）也重连。
  iOS 锁屏、切 App 以后 socket 常常还是 OPEN、不触发 close，以前会一直停在"已连接"、画面冻住。只看"这段时间收到过没有"，不比时钟，后台被节流的计时器晚跑不会误判。
- **切回前台、网络恢复**：`pageshow`、`online` 改听 `window`（以前 `pageshow` 挂在 `document` 上，永远收不到）；`online` 时等着重连的马上连；
  `pageshow` 带 `persisted`（从往返缓存回来）旧连接一律作废重连；切回前台时旧连接已经 CLOSING/CLOSED 却没等到 close 的，也扔掉马上连。新选项 `windowEvents`（测试注入）。
- **闹钟不丢**（`room.ts`）：`setAlarm` 出错不再往外抛；内存里的闹钟时间改回"不知道"，下一个入口按 `getAlarm()` 重新读、照常重排。以前内存里记着新时间，之后 `planAlarm` 一直以为"已经设了更早的"，房间的超时、托管、关房都不触发。
  闹钟里那一次出错的，按存储里实际的闹钟判断要不要 60 秒后再醒。
- **moveId 去重窗口**：每个座位记最近 8 个做成的 moveId（`recentMoves`，旧房间的状态里没有就当空的），不再只认最后一个：A 的 ack 丢了、之后 B 也做成了，补发 A 仍然只回 ack。
- 测试：客户端 8 条（判死和不误判、建连超时、online、pageshow persisted、CLOSED 没等到 close、摘掉事件），房间 3 条（补发不是最后一个的 moveId、setAlarm 出错后重排、闹钟里重设失败）；每条都做了反证（把对应的那行改坏，测试失败）。

## 0.11.0

- **牌桌互动组件** `arcade-kit/table-fun`（仓库根 `docs/table-fun.md` 第 0 节"互动第二版"）：几个牌桌游戏共用一套，游戏只给头像的屏幕矩形、禁区、发送通道、名场面映射和短语表。
  - `TableFun`（DOM）：头像上的透明热区（点别人出菜单、点自己出表情菜单；长按 0.4 秒连扔上次的道具 / 发上次的表情）、"互动"按钮和面板（短语 / 表情 / 道具、选对象、全部屏蔽）、
    菜单第一格是上次扔的道具、"屏蔽他"（sessionStorage `<id>.fun.blocked`，按 `scope` 分房间）、首次提示"点头像扔道具，长按连扔"（localStorage `<id>.hint.fun`，只一次）、
    冷却转圈、护盾、连击 ×N、回敬、名场面横幅 `banner`；菜单避开游戏给的禁区矩形，点按区 ≥ 44px。
  - 单机（`localBots`）电脑由组件按 `botReact` 反应：一定是表情加一句话的气泡，回扔时道具飞回去；好友房电脑发来的东西晚 0.9 秒播、表情自动配一句话。
  - `controls()` 给冒烟每个能点的东西的中心和大小，`log` 给一行行流水；演示页 `demo/table-fun.html`。
- **`arcade-kit/fun-logic`**（纯函数，房间、测试、页面都能用）：`FUN_TIMING`（冷却 1.5 / 1 秒、护盾 10 秒 6 次、连击 3 秒、长按 0.4 秒、污渍 3 秒）、`FunCooldown`、`FunTally`、
  `botReact(事件, 电脑, 状态, 现在, 随机数, 参数?)`（`BOT_REACT`：被扔 60% 回应、其中四分之一回扔、20 秒最多回扔 2 次，名场面输 40% / 赢 30%，每手 2 次，两次至少隔 1 秒；性格 ×1.5 / ×1 / ×0.3）、
  `placeMenu`、编号换算 `funIdCount`/`funItem`/`stickerId`/`propId`，房间用的 `hitEvent`、`botEmoteIds`、`stickerMood`。
- `fun.ts`：污渍从约 1.7 秒改成 3 秒（`FUN_TIMING.stainMs`）。
- 测试 `test/fun-logic.test.ts`：botReact 的概率区间（按性格）、冷却、护盾、连击（换人断开）、回敬、回扔上限和窗口、每手上限、最小间隔、菜单避开禁区、编号和房间换算。

## 0.10.2

- `standaloneRoot` 独立模式下也接 `/api/me`：回 200 `{ standalone: true }`（没有 `user`，页面的 `detectPlatform` 认作没有平台）。
  原来要靠它落到静态资源回 404，浏览器控制台每次打开页面都有一条红的资源加载错误（德州 0.7.0 先在游戏里这么做了，收进 kit）。
  游戏要把 `"/api/me"` 加进 wrangler.jsonc 的 `assets.run_worker_first`；本站部署时 `/api/*` 由平台的路由接，到不了游戏 Worker，有平台绑定时这里也回 null。
- 测试：独立模式回 200 且 `detectPlatform` 得到 `platform: false`；平台模式（有 `ARCADE` 或 `GATE: "login"`）、别的路径回 null。

## 0.10.1

- **npm 上的包名是 `@yyyu-star/arcade-kit`**（发布令牌只对 `@yyyu-star` 作用域有权限；0.10.0 没有发布到 npm）。游戏按别名装：
  `"arcade-kit": "npm:@yyyu-star/arcade-kit@^0.10.1"`，代码里的 `arcade-kit/...` 不用改；仓库内的 `file:` 引用照旧。
- **电脑回应真人的短语**：`GameRoom` 加 `protected onEmote(from, id, to?)`：真人短语校验通过、广播完之后调一次（被拒的不调），
  只给座位和编号、不给牌局状态，同步、不写存储，抛错只记日志；注释写明只许用来调 `botEmote`，电脑的出牌决策绝不能读到真人短语，游戏不许把它记进状态。
  电脑的 `botEmote` 不触发它。
- 测试（`test/emote.test.ts`）：真人发短语后钩子被调、里面 `botEmote` 的回应所有连接收到；电脑短语、被拒的短语不触发；不写库。
  反证：让 `botEmote` 也调 `onEmote`，这条失败。

## 0.10.0

- **能发到 npm**：去掉 `private`，补 `repository`、`homepage`、`bugs`、`keywords`、`files`、`engines`（Node ≥ 22）、`sideEffects: false`、`publishConfig.access: public`、`LICENSE`；
  `@cloudflare/workers-types` 是可选的 peer 依赖（只用到类型）。
  - 发布内容是 `dist/`（tsc 按 `tsconfig.build.json` 编的 JS + `.d.ts` + map）和对照用的 `src/`；`build` 脚本，`prepack` 先构建。
  - 仓库里的 `exports` 仍指向 `src/*.ts`，仓库内游戏的 `file:` 引用 `npm ci` 后照旧能用（npm 不会替软链的依赖构建）；
    `prepack` 把 `exports` 换成 `{ types, default }` 指向 dist，`postpack` 换回来（`scripts/manifest.mjs`）。
  - `src/` 里相互引用改写 `.js` 扩展名，编出来的 JS Node 原生 ESM 也能解析（vite、esbuild、tsc 对源码照旧映射回 `.ts`）。行为不变。
  - `npm test` 末尾加 `check:dist`：构建 dist，检查每个入口的 JS 和 `.d.ts` 都在，浏览器能用的入口 Node 能直接 import。
- **独立模式**（游戏不带平台单独部署）：新入口 `arcade-kit/guest`。没有 `ARCADE` 绑定、`GATE` 也不是 `"login"` 时：
  - `loginGate` 不跳登录，回页面，补发游客 cookie（https 下 `__Host-kit-guest`，HttpOnly、Secure、SameSite=Lax、Path=/，值 32 字节随机）；
  - `acceptCreate` 认游客 cookie，没有就现发；`acceptJoin` 认游客 cookie，没有 4401；
  - 游客 `userId` 是 `g:` 加 cookie 值 SHA-256 的前 128 位，默认昵称"游客"加 4 位数字；开房、进房地址可带 `?name=`，`cleanNickname` 严格清洗（保留词由游戏传 `guest.reserved`）；
  - 新增 `identify`（auth）：按部署方式认人；`standaloneRoot(request, env, gameId)`：独立模式下 `/` 302 到 `/games/<id>/`；
    浏览器 `detectPlatform()`（同域 `/api/me`：有平台 / 没有 / 不知道）、`withNickname(url, name)`。
  - **有 `ARCADE` 绑定时行为完全不变**，游客 cookie 一律不认；`GATE: "login"` 却没绑 `ARCADE` 时 fail-closed（以前 GATE 不写也是这样，现在不写 GATE 又没绑 ARCADE 算独立模式）。
  - 测试 `test/guest.test.ts`：发 cookie、认人、重连还是同一个人、换 cookie 是另一个人、昵称清洗、本站带游客 cookie 不认、GATE=login 不退成游客、同源检查照旧；
    反证：让 `isStandalone` 忽略 `ARCADE`，平台模式那几条全部失败。
- **电脑也会互动**：`GameRoom` 加 `protected onStep(state)`（每步广播完调一次）和 `protected botEmote(seat, id, to?): boolean`：只有电脑座位（`ai`、托管 `auto`）能发，
  校验和限速同真人（同一个座位令牌桶），不写存储；广播的 `EmotedMsg` 多带 `bot: true`（协议只加字段），`onEmote` 多一个参数 `bot`。
  测试（`test/emote.test.ts` 的 `ChattyRoom`）：所有连接收到、真人座位发不出、限速生效、不写库；反证：去掉"必须是电脑座位"的判断，两条都失败。

## 0.9.1

- 只改测试：修 `quota.test.ts`"计量连不上"那条偶发的失败（CI 上 expected 201 to be 409）。房间代码不改。
  打完那一步还名额（`kitRelease`）是广播之后才 await 的，测试收到"打完了"马上恢复计量，这一下有时赶在恢复之后才到、直接还成功，
  接下来"还占着名额（409）"就不成立。现在 `FlakyMeter` 记下断线时拒掉了几次 `kitRelease`，测试等它真的被拒了再恢复。
  反证：让 `kitRelease` 等到恢复之后才进来，不改测试时稳定复现 201，改了以后通过。

## 0.9.0

- **kit 里不再写死站点地址**（开源整改）：
  - 删掉导出的 `SITE_ORIGIN`、`ME_URL` 两个常量。没有游戏用到它们，游戏原来的写法不用改。
  - 同站校验 `sameOrigin(request, siteOrigin?)` 的第二个参数变成可选：不给就认请求自己的 origin。
    `acceptCreate` / `acceptJoin` 的 `siteOrigin` 不给时也一样；给了（比如部署时注入的 `SITE_ORIGIN` 变量）就只认给的。
  - `whoIs`、`loginGate`、`acceptCreate`、`acceptJoin` 问 `/api/me` 时，地址按请求的 origin 拼（新导出 `ME_PATH`、`meUrlOf`），照旧经 `ARCADE` 服务绑定；`meUrl` 仍可覆盖。
  - 默认文案 `ROOM_TEXT.forbidden` 改成"请从游戏大厅打开"，不写域名；注释里的域名也去掉了。
- 测试里的站点换成保留的示例域名 `game.example.com`。`test/worker.ts` 不再传 `siteOrigin`、`meUrl`，直接测默认值；另加两条测试：`sameOrigin` 不给站点时的行为、`meUrl` 覆盖。
- 旧仓库的 PR 编号改成不带 # 的"旧仓库 PR N"，免得在新仓库里链到同号的无关 PR。
- README 按统一结构整理：简介、功能、本地开发、部署（游戏要准备的绑定和变量）、目录结构、许可证（MIT）。
  `package.json` 加了 `"license": "MIT"`。去掉了只对维护者自己环境成立的说法。

## 0.8.0

- **几个游戏各抄一份的通用部分收进 kit**（代码审阅：两个游戏的假钱包 97% 相同，开房、登录闸门大段重复）。只加不改，已有接口行为不变：
  - `arcade-kit/testing`（新入口）：假平台钱包 `WalletService`、`FakeBank`、`walletHttp`，只给测试和本地试用。
    - 只复刻接口形状和关键规则：带入、结回、放弃、只结一次、余额够这次、op 去重、按 ref 分份、到期退回、client 每天净赢上限、stats 上限、补给（docs/platform-backend.md 5.9、5.10、15.9）。
    - 规则数用平台现行默认值（净赢 10 份、补给看余额加桌上的）。
    - 不维护游戏名单，只核对 `props.game` 和参数一致，以后加游戏不用改它。
  - `arcade-kit/worker`：`loginGate`（首页登录闸门，和游戏原来的写法一致：放行带 Set-Cookie、没登录 302 带 next、平台不可用 503 页、`GATE=off` 不拦），默认 503 页不带游戏名，可以换；
    `json`、`readJson`、`withCookies` 三个小工具。
  - `arcade-kit/client`：`createRoom`（POST `{ opts }`，401 当 login、不是 JSON 当 unavailable、网断了 offline）；`createText`、`closeText` 和 `ROOM_TEXT`：开房失败、断开时的默认说法，游戏按 key 覆盖。
  - 包里不出现任何游戏 id 和游戏专属文案。README 加了"登录闸门、开房、假钱包"一节和各游戏的迁移步骤。
- `auth.ts`、`client.ts` 注释里只拿一个游戏举例的过时说法改成通用的；README 的额度总账指向 `docs/platform-backend.md` 4.7。

## 0.7.2

- **查清"`RoomInfo.pause.until` 比 `getAlarm()` 早 1–2 帧"：kit 没错，是对照的值取错了**（德州的测试注释，旧仓库 PR 97）。房间代码不改。
  在德州 workerd 测试里逐次对比同一条广播的 `room.pause.until` 和房间存的闹钟：300 多次停顿全部相等（seq 也相同）。对不上的都是同一个形状：
  停够了闹钟醒来，`resume` 发下一手，电脑（含托管）一口气打完这一手又进入停顿（resume 那一帧 + 1–2 帧电脑）。这时拿**上一次停顿**的 `until`
  （或"醒来时刻 + 停顿"）去比，新的截止时间多出的正是这一批电脑的播放时间（德州 `aiDelayMs` 1.6 秒 × 1–2 帧）——这是设计如此：
  停顿从这一批播放完算起，`land` 收到的计时起点是 `now + 第几帧 × aiDelayMs`（`runAuto`），`pausedUntil()` 和闹钟都走 `deadline()`，两者一定相等。
- 加测试锁住这一点（`test/pause.test.ts`"停够了接着来，电脑（含托管）一口气出完下一圈、最后一帧又进入停顿……"）：u1 掉线托管，闹钟 resume 后
  四帧电脑出完一圈又停，断言同一条广播 `pause.until` = `getAlarm()` = 醒来时刻 + 4 × `aiDelayMs` + 停顿、存的 seq 和广播一致、进房快照同一个时间、
  早 1 毫秒不推进、到点接着来。反证：把 `runAuto` 的计时起点改成 `now`（不算播放时间），这条和原有两条停顿测试失败；把闹钟单独往后推一帧，8 条停顿测试失败。
- README：删掉"多个游戏怎么分额度"里各游戏写入门槛的分配表和"加起来不能超过 10 万"那段，改成一句指向各游戏 `wrangler.jsonc` 的 `KIT_QUOTA`
  和仓库根 `docs/platform-backend.md` 的总账（共用包不管别的模块的配置）；开头"第一版只做掼蛋好友房间要用的部分"、`breakPoint` 只拿掼蛋举例、
  "上第二个联机游戏时"、`cpu_ms` 等掼蛋这些过时说法改成通用的（德州、掼蛋、麻将都在用）。

## 0.7.1

- **别人看不出来的不轮流操作不广播**（麻将旧仓库 PR 139 的审阅）：`free` 的操作做完、电脑也没接着出，如果除出手人以外每个座位和没入座的人的视图、房间信息都没变，
  房间照常存（≤ 2 行），只回给出手的连接，seq 不加。协议加可选字段 `StateMsg.quiet: true`（只和 ack 一起）；`RoomClient` 收到 seq 没变、带自己 ack 和 quiet 的消息交给页面一次。
  原来这类操作会广播一条新 seq 的状态，别人能看出"有人做了点什么"（麻将声明窗口里真人答碰杠胡就等于点名）。
  向后兼容：别人看得出来的 free 操作（德州的暂离、补码，掼蛋的买入）照旧广播；旧的 RoomClient 收到 quiet 消息当重复丢掉，只是出手人自己的画面晚一步更新。

## 0.7.0

- **限速用户感觉不到、后台可调**：快捷短语改成每个座位一个令牌桶，默认每 1 秒补 1 个、最多攒 3 个（`RoomLimits.emoteMs` 3000 → 1000，加 `emoteBurst`）。
  两个值可以在游戏 `wrangler.jsonc` 的 `vars.KIT_QUOTA` 里写 `emoteMs`、`emoteBurst` 覆盖，不用发版（计量认得这两个字段、不再记"不认识"）。
  进房快照加可选字段 `welcome.emote: { ms, burst }`；`RoomClient.emote` 在本地按这个节奏排队（太快的排到下一个令牌，只留最后 2 个），房间回的 `emote_too_fast` 静默丢掉，不交给页面。
- **短语可以指定对象**：`EmoteMsg`、`EmotedMsg` 加可选的 `to`（座位号），房间检查是有人的别的座位，不然回 `bad_target`（加进 `EMOTE_ERRORS`，不占令牌）；
  `RoomClient.emote(id, to?)`、`onEmote(seat, id, to?)`。不带 `to` 的和 0.6.0 一样，不写存储。
- **新模块 `arcade-kit/fun`**（浏览器用，纯 DOM + SVG + Web Animations）：`createFunLayer`（class `arcade-fun`，`hide`/`show`/`destroy`）、
  12 个表情 `STICKERS` + `showSticker`、8 种互动道具 `PROPS` + `throwAt`（抛物线飞行带残影、分道具的命中效果、污渍最多叠 3 层、同时最多 4 个）、
  道具音效配方 `playFunSound`（WebAudio 合成，游戏用自己的音频放、跟着自己的静音）。素材全部自己画（`src/fun-art.ts`），不用 emoji 字体。
  kit 不写死任何游戏：编号到内容的表由游戏定。演示页 `demo/`。
- 协议只加字段，`PROTOCOL_VERSION` 不变。加测试：令牌桶（连发 3 句、第 4 句被拒、过 1 秒补一句）、`KIT_QUOTA` 覆盖、快照带节奏、`to` 的校验、客户端排队；
  `test/fun.test.ts`（素材是自己画的 SVG、抛物线、同时最多 4 个、污渍最多 3 层）。

## 0.6.0

- **快捷短语**：`RoomGame` 加可选的 `emotes`（短语表有几句），入座的人发 `{ t: 'emote', id }`（`EmoteMsg`，`RoomClient.emote(id)`），
  房间校验编号（0 到 `emotes - 1` 的整数）、按座位限频（`RoomLimits.emoteMs`，默认 3 秒一句），然后把 `{ t: 'emote', seat, id }`（`EmotedMsg`）发给房间里所有人（含发的人）。
  **只认编号、不收自由文本**，短语内容由游戏自己定。**0 行写入、不改 seq、不进状态**；入站照常计数（令牌桶、个人份额、`maxInbound`）。
  被拒回 `error`：`no_emotes`、`bad_emote`、`not_seated`（旁观的不能发）、`room_over`、`emote_too_fast`（`EMOTE_ERRORS`）。
- 浏览器：`RoomClientOptions` 加可选的 `onEmote(seat, id)`。`EmotedMsg` **不在 `DownMsg` 里、不进 `onMessage`**：
  放进 `DownMsg` 会让按"不是 error 就是 welcome / state"写的游戏代码类型检查失败（掼蛋、德州都是这么写的），所以单独走一个回调。
- **协议只加消息、不改含义**，`PROTOCOL_VERSION` 不变；`RoomLimits` 多一个 `emoteMs`（从 `DEFAULT_LIMITS` 展开的游戏不用改）。
  不写 `emotes` 的游戏行为完全不变。加测试（`test/emote.test.ts`，客户端一条）。

## 0.5.0

- **停一会儿再接着来**：`RoomGame` 加两个可选的纯函数 `pause(state)`、`resume(state)`。没人能出手时房间先问 `pause`（优先于 `waiting`），
  给了正的毫秒数就停这么久：从进入停顿那一刻算（电脑连着出完进来的从播放完算），停顿期间不轮流的操作、座位换人、对外的事办完不重新计时；
  到点用唯一的闹钟调 `resume` 做一步（≤ 2 行），电脑接着出、照常广播。`resume` 抛错或返回的还在停：记日志、截止时间推后 60 秒再试。
  写了 `pause` 没写 `resume` 的当作没有停顿（记一次日志）。用在一手打完固定停几秒给大家看结果、再自动发下一手。
- 协议：`RoomInfo` 加可选字段 `pause: { until }`（停顿的截止时间戳），只在停时有，这时 `turn` 是 null；`PROTOCOL_VERSION` 不变。
  `RoomClient` 原样把 `room` 交给页面，不用改。`snapshotBytes` 对写了 `pause` 的游戏把这个字段算上。
- **只加可选接口和字段，不写 `pause` 的游戏（掼蛋）行为完全不变**，原有测试原样全过。加测试（`test/pause.test.ts`，含反证）。

## 0.4.0

- **开房就定选项**：`acceptCreate` 的第三个参数多一个可选的 `options`（`CreateOptions`），房间开房时用 `RoomGame.options` 校验，
  不合格回 400 `bad_options`（`CreateError` 加了这一项）、不占名额、不建房间；校验过的存进房间状态（和状态同一行，开房写入不变），
  经 `RoomInfo.opts`（新字段）发给每个进房的人。定下以后不能改：开打时以开房的为准，`start` 带的 `opts` 不看；
  等人时坐到 `seatCount` 以外的座位回 `seat_closed`。德州好友房用：输房间码进来的人开打前就知道档位、要带多少、哪些座位用得到。
- 只加字段、不改含义：不带 `options` 的房间（掼蛋）行为完全不变，掼蛋测试照样全过。加测试（含反证）。

## 0.3.2

- `RoomGame.waiting(state)`（可选）：牌局没打完、这一刻谁也不用出手、在等外面的事（有人坐下、补码、从暂离回来、买入到账）时返回 true，
  `actors`（`turn`）就可以是空的：房间不当作出错（原来记日志、按打完处理），不计时、不驱动电脑、不写；等不轮流的操作、座位换人、对外的事办完让牌局变了再看。
  德州的牌桌能打的人不够两个时就停在这里。不写就和以前一样。加测试（含反证）。

## 0.3.1

- `arcade-kit/auth` 导出 `whoIs`，结果多带 `setCookie`（平台续期、清失效会话时回的 Set-Cookie），游戏的登录闸门和自己的接口照转给浏览器；开房进房的行为不变。
- 游戏的 `settled` 写错了、办完的事还留在 `effects()` 里时：记一条错误日志、当失败交给退避，不在这一轮里接着重办（原来每步之后同一笔要重办 4 轮、每轮写 1 行）。加测试。

## 0.3.0（2026-10-15）

德州好友房要的几样通用接口（德州 DESIGN.md 6.2 第 2–6 条）：全部可选，不写就和 0.2.0 一样，kit 里不写死任何一个游戏；掼蛋不用改代码，测试照样全过。

- **开局选项**：`StartMsg` 多一个可选的 `opts`（`RoomClient.start(opts)`）。`RoomGame.options(raw)` 校验（不合格回 `bad_options`），
  `seatCount(opts)` 定这一局用几个座位：只给前面这些座位补电脑，后面的座位一直空着、开打后谁也坐不进去，有真人坐在后面时回 `seat_closed`。
  `begin` 多一个参数 `setup`：`{ opts, seats }`（每个座位坐的是谁）。
- **座位换人** `RoomGame.seated(state, seat, kind)`：开打后有人坐下（接管电脑或回到自己的座位）、离座交给电脑时调，和那一步一起写，不多写行。
- **对外的事**：游戏在状态里记着要去外面办的事（`RoomGame.effects`，每笔 `{ id, seat, ... }`），房间类实现 `GameRoom.perform(effect, userId)` 去办
  （比如经 DO 调用从玩家的钱包扣买入），办完用 `RoomGame.settled` 写回（1 行）。在 entry 之外 await；失败按 15 秒起、翻倍、最多 10 分钟的退避重试（还是那一个闹钟）；
  同一笔可能办两次，办事的一方按 id 去重。关房前先调 `RoomGame.closing` 记下收场要办的，有没办完的就断开所有人、留着存储办完再删，最多等 `RoomLimits.closingMs`（新字段，默认 1 小时）；
  正在关的房间进不来（4000）。`Persist` 只加字段（`effectsAt`、`effectTries`、`ending`）。
- **不轮流的操作** `RoomGame.free(action)`：入座的人什么时候都能发，不看轮没轮到、不判 stale，该谁出手没变就不改期限和 `turnSeq`。
  为此 `act` 先 `parse` 再判 stale 和轮次：既过时、格式又不对的消息，以前回 `stale`，现在回 `bad_action`（都是"不做"，页面按最新状态重来）。
- **房间以外的 DO 用计量**：`arcade-kit/meter` 新导出 `meterReport(env, writes)`、`meterLevel(env)`，给游戏自己的钱包之类记写入、问门槛；每报一次计量多写 1 行。

**兼容性**：协议版本不变（仍是 1），只加字段。`RoomLimits` 多了必填字段 `closingMs`：照 README 写成 `{ ...DEFAULT_LIMITS, ... }` 的不用改。
`RoomGame`、`GameRoom` 多了两个带默认值的类型参数，原来的写法照常编译。0.2.0 存下的房间读出来没有新字段，按"没有要办的事"处理。

## 0.2.0（2026-10-14）

好友房要正式放出来，先把额度管住（维护者："好友房需要放出来，让大家可以玩，但是需要控制额度"）。免费版 DO 每天整个账户 10 万行写入（docs 4.7），
4 真人一局约 1,133 行，不管的话一天九十来局就会把所有游戏的联机一起打停。

- **安全（阻塞修复）：开局随机从 32 位种子换成 256 位熵**。0.1.x 的房间用 `crypto.getRandomValues(new Uint32Array(1))` 生成种子，只有约 43 亿种，
  玩家拿自己的手牌逐个试种子几分钟就能反推出全桌的牌。现在：
  - 新入口 `arcade-kit/rng`：ChaCha20（RFC 8439，只用 32 位整数运算，用 RFC 的测试向量锁住，另和 OpenSSL 对拍过 2000 组），
    按"用途 + 序号"分流（`stream(key, 'deal', 3)`）、拒绝采样的均匀整数（`below`，没有取模偏差）、Fisher–Yates 洗牌（`shuffle`）。纯函数，浏览器和 DO 都能用；
  - `RoomGame` 新加 `begin(entropy, rulesVersion)`：房间用 `crypto.getRandomValues` 生成 8 个 u32 交给它，只用这一次、房间不存；游戏把它当密钥放进自己的状态，后面每一副也从这条流里取；
  - `start(seed)` 标成废弃：只为 0.1.x 的游戏升级 kit 时照常能开局，房间会记警告。已经开打的房间不会再开局，按开局时的规则版本打完。
    **掼蛋线上的好友房在掼蛋 0.3.0 换成 `begin` 之前仍有这个问题。**
- **计量 `RoomMeter`**（新入口 `arcade-kit/meter`）：每个游戏 Worker 一个全局实例，绑成 `METER`。里面放三样东西，一次 RPC 办完：
  当天（UTC）全站写入行数、当天全站开房数、每个人开着的房间和当天开了几个。比"每人一个小 DO + 一个计量"少一次请求，也不用每个人建一次表。
- **按人的开房名额**：默认每人同时 1 个自己开的房间（`has_room`，带那个房间的码，页面给"回到房间"）、每天 6 个（`daily_limit`）。
  整场打完或者房间关掉时还；还不上的到"开房时间 + 房间寿命 + 1 分钟"自动作废。房间打完了还开着时没还上的，60 秒后下次有事件接着还。
- **每日写入计量**：房间自己数写了几行（含 `setAlarm`、关房），攒够 `RoomLimits.meterBatch`（新字段，默认 200）行报一次，打完、关房时随还名额报最后一批；
  计量每报一次写 1 行（摊下来 0.5%），自己写的行也记进当天的数。没报的数随房间那一行存（`Persist.unmetered`，只加字段），被驱逐后接着数。
  - 到 `busyWrites`（默认 6 万）：不开新房（503 `busy`）、不进新人（新关闭码 **4503**，不重连）；在打的照常打完，房主、坐过的、已经连着的人照常进；
  - 到 `stopWrites`（默认 8.5 万）：在打的房间走到 `RoomGame.breakPoint`（新的可选函数，掼蛋是一副打完）时停下电脑、把这一步发给大家，再以 4000 加原因 `quota`（`CLOSE_REASON.quota`）关房；
    等人的、已经打完的、游戏没写 `breakPoint` 的马上关；
  - 计量连不上：不开新房（503 `unavailable`）、不进新人（1013，客户端过会儿重试），在打的照常，报不上的攒着 60 秒后再试。
- **全站每天开房上限**：默认 300（`dailyRooms`），最后一道闸，到了回 503 `busy`。
- **门槛可调**：游戏在 `wrangler.jsonc` 的 `vars.KIT_QUOTA` 里只写要改的字段（对象或 JSON 字符串），不用改代码；配错的字段记日志、用默认值。
  10 万行是全账户共用的，多个游戏怎么分写在 README（掼蛋 5 万 / 6 万，德州以后 1.5 万 / 2 万，留 2 万余量）。
- **开房的错误改成 JSON** `{ error, code? }`（`protocol.ts` 的 `CreateError`）：401 `login`、403 `forbidden`、409 `has_room`、429 `daily_limit`、503 `busy`、503 `unavailable`。
  状态码和 0.1.x 一样的那几种（401、403、503）照旧，只看状态码的页面不受影响。
- **客户端**：`onStatus` 多一个参数 `reason`（关闭原因），页面靠它认出"额度满了收场"的 4000。

**兼容性**：协议版本不变（仍是 1），都是加字段、加码。**没绑 `METER` 时不限额、不计数**，和 0.1.1 一样——只为了 0.1.x 的游戏升级 kit 时不至于开不了房，
正式环境一定要绑。已经上线过 v1 迁移的游戏，计量要另加一条迁移（`v2`，`new_sqlite_classes: ["RoomMeter"]`）。0.1.x 存下的房间读出来时 `unmetered` 从 0 算，
关房时去还名额（计量里没有就只记写入）。

## 0.1.1（2026-10-14）

堵住开打后换座位看牌的漏洞，按人拆入站额度，加"一组人同时出手"（掼蛋结算页大家点继续、20 秒后自动发下一副）。

- **座位绑人**（阻塞修复）：0.1.0 里开打后任何没入座的人都能坐进电脑座位，于是一个人可以离座、接管对手的电脑座位看牌、再回到自己的座位。
  现在开局时记下每个座位绑定的 userId：坐过某个座位的人只能回这个座位（别的回 `not_your_seat`）；没坐过的人只能接管没绑人的电脑座位，
  接管后绑给他；绑给别人的座位（主人离座了也算）谁也接管不了（`seat_reserved`），电脑一直替主人打。
  比"坐过的只能回原座"更严一点：不然同伙可以先占掉 A 的原座位，A 就成了"没绑座位"的人，又能去接管别的座位。一个 userId 一局只对应一个座位。
  大厅分得清座位：`SeatInfo.reserved`（开打后绑了人，主人离座也算）；绑了人的座位由电脑代打时 `name` 是原主人的昵称（"电脑代某某打"）；
  `welcome`、`state` 的 `you.bound` 是这个人绑定的座位（离座了也还是它，给"回到我的座位"用）。只下发"绑没绑"，不下发 userId。
- **按人拆入站额度**：新加 `RoomLimits.maxInboundShare`（默认 0.4）：一个人最多用掉房间一生入站额度的四成，超了只断开他（新关闭码 **4030**，不重连），
  以后也进不来，房间和别人照常。一个人刷不完整个房间。
- **一组人同时出手**：`RoomGame` 新加两个可选函数 `actors(state)`（这一刻能出手的座位）、`turnMs(state)`（这一手/这一组的时限）；
  `RoomInfo.turn` 新加可选的 `seats`（写了 `actors` 才有）。组里的电脑、托管马上代出，真人谁先发都收；组的时限从进入这组时起算，组里有人出手不重新计时，
  到点对还没出的真人逐个 `timeout`。stale 按"这一手（组）开始时的 seq"判：同一组里别人先出了，后出的人不算过时，组开始之前的决定才是 stale。
  `actors` 可以返回 `{ seats, group }` 明确告诉房间是不是同一组（推荐；group 一样还要出手的人离开名单、没有新座位加入才算）；只返回数组时按"出手的人离开名单、其他人不变"推断（有歧义，见 README）。
  有人接管组里还没出的电脑座位、或者收回托管时，整组的期限不变。
- **超时代出被规则拒绝**：`timeout` 给的操作不合法时改用 `ai` 再试；还不行就记日志、把这一手（组）的期限推后 60 秒。
  0.1.0 里这种情况闹钟会在当前时刻反复响、每次写一行，没有上限（分组以后组里任何一个人这样都会触发）。现在最多每分钟一次。
- **牌局没打完却没人能出**（`actors` 空了、`turn` 是 null 但 `over` 是 false）：记日志、按打完处理，不再一直卡着。
  两个函数都不写时和 0.1.0 完全一样（原有测试原样保留）。仍然一个闹钟、每步 ≤ 2 行。
- **认人**：请求里没有平台的会话 cookie（`__Host-sid`）就直接算没登录（4401），不再问平台；cookie 名只在 `src/internal.ts` 定义一处。
- **客户端**：`onStatus('reconnecting', code)` 带上这次断开的关闭码（1006、1013……），页面可以区分"网断了"和"平台忙"。
- 修：桌上真人都离座后电脑会停着，之后有人接管了一个**不是正轮到的**电脑座位时，轮到的电脑不会接着出，牌局卡住到房间寿命结束。现在坐下后电脑接着出到真人。
- 两处过时注释（`CLOSE.full`、客户端失败计数）。

**兼容性**：协议版本不变（仍是 1），都是加字段、加码，0.1.0 的页面能照常连 0.1.1 的房间；0.1.0 存下的房间读出来时补上座位绑定和 `turnSeq`，
正在打的房间换新代码后接着打。要注意的有三处：

1. 开打后换座位的规则变严了（上面第一条），页面要处理 `not_your_seat`、`seat_reserved` 两个新错误码（按"座位被占"提示即可）；
   电脑座位的 `name` 不再一定是 null（绑了人的是原主人昵称），按 `kind` 判断是不是电脑，不要按 `name` 判断；
   0.1.0 存下的已开打房间里，电脑座位一律算已绑（谁都不能接管，包括升级前离过座的人：旧格式看不出座位原来是谁的）；
2. 认人短路后，游戏测试里假平台的 cookie 名必须是 `__Host-sid`（掼蛋旧仓库 PR 50 的测试用的是 `gdsid`，要改，否则所有进房都会变成 4401）；
3. `RoomLimits` 多了必填字段 `maxInboundShare`：覆盖 `limits` 时照 README 写成 `{ ...DEFAULT_LIMITS, ... }` 就不用改，自己逐项写全的要补上。

还没做、要平台配合的：每人同时开几个房间、开房配额要平台的房间登记（docs/platform-backend.md 5.3），**开放注册前要先做**（见 README）。

## 0.1.0（2026-10-14）

第一版，给掼蛋好友联机（P1）打底。

- `room`：Durable Object 房间基类。WebSocket 休眠、一个闹钟、每步写入 ≤ 2 行（开房含建表 4 行）、状态没变不写；按座位过滤下发；
  房间码、开房、入座离座、房主开局、电脑补满；断线保留座位、30 秒超时代出（重连不重置）、掉线 60 秒电脑托管、回来交还；
  电脑一次算到下一个真人回合、每步带播放延迟；游戏错误码不合格式换成 illegal_move；
  单条消息 4 KB、每连接每秒 5 条、一生 3,000 条入站消息、每人 300 次掉线后回来（按 userId 记，离座再坐下不清零，同时算进入站额度）、没入座的连接最多 4 条、寿命 3 小时、
  没有入座的人连着 10 分钟等硬限制；
  同一账号只留一条连接；被驱逐后从存储重建；探不存在的房间码不留任何东西；不记回放。
- `worker`：游戏 Worker 的开房（RPC）、进房入口，查 Origin、经服务绑定问平台 `/api/me` 认人、找房间打包在一起。
  进房被拒时用关闭码关掉、不回 HTTP 错误：没登录 4401、别的网站 4403 等不重连，平台暂时不可用 1013 稍后重连。第一版不做入场票。
  游戏只用 `room`、`worker`、`game`、`client`、`protocol` 这几个入口，认人和内部地址不导出。
- `game`：规则接口，`snapshotBytes` 给游戏测快照体积。
- `client`：浏览器连接器，退避加抖动重连、切回前台马上连、按 seq 去重、没确认的操作按原 moveId 和 baseSeq 重发，1008/1009/4000 段不重连，
  连着 20 次没进得了房间就停下等用户点重试。
- `protocol`：消息类型、协议版本 1、关闭码。**上行 `act` 的 `baseSeq` 是必填字段**（做决定时看到的最新 seq，`RoomClient` 自动带上）：
  牌局在那之后变过的回 `stale`，没带的回 `bad_message`。
