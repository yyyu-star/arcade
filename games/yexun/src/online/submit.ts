/**
 * 一局结束时交分：算出该交哪几个榜（score.ts），问一次账号，逐个交。
 * 同一局（runId）只交一次，结算页重复出现、点了"重试"都不会多占额度；失败的榜可以单独重试（retry）。
 */
import { askUser, submitScoreAs, type BoardDeps, type SubmitResult } from './api.ts';
import { beijingDate } from './daily.ts';
import { submissionsFor, type Submission } from './score.ts';
import type { RunSummary } from './types.ts';

export interface SubmitOutcome {
  submission: Submission;
  result: SubmitResult;
}

export interface Submitter {
  /** 交这一局；已经交过的（runId 相同）返回上次的结果；不该交的返回空数组 */
  submit(run: RunSummary): Promise<SubmitOutcome[]>;
  /** 把上次没交上（offline）的榜再交一次 */
  retry(run: RunSummary): Promise<SubmitOutcome[]>;
}

export function createSubmitter(deps: BoardDeps, now: () => number = () => Date.now()): Submitter {
  const done = new Map<string, SubmitOutcome[]>();
  const inflight = new Map<string, Promise<SubmitOutcome[]>>();

  const send = async (run: RunSummary, only?: ReadonlySet<string>): Promise<SubmitOutcome[]> => {
    const subs = submissionsFor(run, beijingDate(now())).filter((s) => !only || only.has(s.boardId));
    if (subs.length === 0) return [];
    const user = await askUser(deps);
    const out: SubmitOutcome[] = [];
    for (const submission of subs) out.push({ submission, result: await submitScoreAs(deps, user, submission.boardId, submission.score) });
    return out;
  };

  return {
    submit(run) {
      const old = done.get(run.runId);
      if (old) return Promise.resolve(old);
      const running = inflight.get(run.runId);
      if (running) return running;
      const p = send(run).then((o) => {
        done.set(run.runId, o);
        inflight.delete(run.runId);
        return o;
      });
      inflight.set(run.runId, p);
      return p;
    },
    async retry(run) {
      const old = done.get(run.runId) ?? [];
      const redo = new Set(old.filter((o) => o.result.kind === 'offline').map((o) => o.submission.boardId));
      if (redo.size === 0) return old;
      const fresh = await send(run, redo);
      const merged = old.map((o) => fresh.find((f) => f.submission.boardId === o.submission.boardId) ?? o);
      done.set(run.runId, merged);
      return merged;
    },
  };
}

/** 交分结果的一句话（结算页小字） */
export function outcomeText(o: SubmitOutcome): string {
  const r = o.result;
  switch (r.kind) {
    case 'ok':
      return r.improved ? '新纪录，已上榜' : '已交榜（没超过你的最好成绩）';
    case 'limit':
      return '今天交得太多了，明天再来';
    case 'busy':
      return '榜单忙，这一局没交上';
    case 'wrong_user':
      return '账号变了，请刷新页面再打';
    case 'offline':
      return '没连上，点一下重试';
    case 'odd':
      return '已交榜';
    case 'out':
      return '登录后才能上榜';
    case 'bug':
      return '榜单出错了，这一局没交上';
  }
}
