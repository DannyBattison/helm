import { SessionManager } from '../src/core/sessions';

/** `create` returns before the worktree exists; tests that look at the worktree wait for it here. */
const original = SessionManager.prototype.create;
/** The real `create`, which returns before the worktree is made. */
export const createNow = (sm: SessionManager, ...a: Parameters<typeof original>) => original.apply(sm, a);

export function settleCreates() {
  const create = original;
  SessionManager.prototype.create = async function (this: SessionManager, ...a: Parameters<typeof create>) {
    const id = await create.apply(this, a);
    await this.ready(id);
    return id;
  };
}
