/**
 * 动态页 /feed：好友动态的全部（最近 7 天、最多 50 条），一次先显示 10 条，"加载更多"往下加；每条的说明默认两行，长的能展开。
 * 顶栏"动态"浮层的"看全部"、好友页的入口都进这里。电脑上内容区限宽居中（styles.css 的 .feedpage）。
 */
import { FeedList } from '../feed.tsx';
import { Link } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Panel, Skeleton } from '../ui.tsx';

export function FeedPage() {
  const { loading, user, service } = useSession();
  return (
    <div className="feedpage">
      <Panel icon="people" title="好友动态">
        {loading ? (
          <Skeleton rows={3} />
        ) : service === 'off' || service === 'unreachable' ? (
          <p className="note">现在连不上账号服务，过一会儿再来看。</p>
        ) : !user ? (
          <>
            <p>登录后才能看好友动态。</p>
            <Link className="btn btn--primary" href="/login?next=%2Ffeed">
              去登录
            </Link>
          </>
        ) : (
          <FeedList me={user.id} />
        )}
      </Panel>
    </div>
  );
}
