/**
 * The preview comment must be updated in place, not re-posted. A PR that collected one comment
 * per push would bury its own review conversation, and the branch that prevents that had no test
 * while it lived inline in the workflow.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  MARKER,
  previewCommentBody,
  upsertPreviewComment,
} from '../scripts/upsert-preview-comment.mjs';

/** A github client stub that records what it was asked to do. */
function stubGithub(existingComments: { id: number; body: string }[]) {
  const listComments = vi.fn().mockResolvedValue({ data: existingComments });
  return {
    // paginate walks every page; the stub returns the full set, which is what a correct
    // implementation asks for. A stub that only ever returned one page would have hidden the
    // unpaginated bug this replaced.
    paginate: vi.fn().mockResolvedValue(existingComments),
    rest: {
      issues: {
        listComments,
        updateComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
        createComment: vi.fn().mockResolvedValue({ data: { id: 99 } }),
      },
    },
  };
}

const base = { owner: 'verevoir', repo: 'design-space', prNumber: 6, body: 'new body' };

describe('upsertPreviewComment', () => {
  it('creates a comment when the PR has none from this workflow', async () => {
    const github = stubGithub([{ id: 5, body: 'a human said something' }]);

    const result = await upsertPreviewComment({ github, ...base });

    expect(result.action).toBe('created');
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it('updates in place when its own marker is already present', async () => {
    const github = stubGithub([
      { id: 5, body: 'a human said something' },
      { id: 7, body: `${MARKER}\n## Preview deployment (older)` },
    ]);

    const result = await upsertPreviewComment({ github, ...base });

    expect(result).toEqual({ action: 'updated', commentId: 7 });
    // The point of the branch: no second comment.
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(github.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 7, body: 'new body' }),
    );
  });

  it('does not mistake a human comment quoting the URL for its own', async () => {
    // Recognition is by the hidden marker, not by content that someone might paste.
    const github = stubGithub([
      { id: 5, body: 'the preview at https://pr-6---design-space-studio.run.app looks wrong' },
    ]);

    const result = await upsertPreviewComment({ github, ...base });

    expect(result.action).toBe('created');
  });

  it('survives a comment with a null body', async () => {
    // The API returns comments whose body can be absent; a bare .includes would throw.
    const github = stubGithub([{ id: 5, body: null as unknown as string }]);

    await expect(upsertPreviewComment({ github, ...base })).resolves.toMatchObject({
      action: 'created',
    });
  });
});

describe('previewCommentBody', () => {
  it('carries the marker so the next run can find it', () => {
    const body = previewCommentBody({ tagUrl: 'https://x.run.app', prNumber: 6, sha: 'abcdef1234' });

    expect(body).toContain(MARKER);
  });

  it('shortens the commit sha and states that the revision takes no traffic', () => {
    const body = previewCommentBody({ tagUrl: 'https://x.run.app', prNumber: 6, sha: 'abcdef1234567' });

    expect(body).toContain('`abcdef1`');
    expect(body).toContain('no production traffic');
  });
});

describe('upsertPreviewComment — pagination', () => {
  it('asks for every page, not just the first', async () => {
    const github = stubGithub([]);

    await upsertPreviewComment({ github, ...base });

    // listComments returns 30 per page oldest-first, so this workflow's own comment sits on a
    // later page of any busy PR. Calling the endpoint directly would silently miss it.
    expect(github.paginate).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.listComments).not.toHaveBeenCalled();
    expect(github.paginate).toHaveBeenCalledWith(
      github.rest.issues.listComments,
      expect.objectContaining({ per_page: 100 }),
    );
  });

  it('finds its own comment when it is buried behind many others', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, body: `chatter ${i}` }));
    many.push({ id: 999, body: `${MARKER}\n## Preview deployment (older)` });
    const github = stubGithub(many);

    const result = await upsertPreviewComment({ github, ...base });

    expect(result).toEqual({ action: 'updated', commentId: 999 });
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
  });
});
