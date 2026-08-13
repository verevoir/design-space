/**
 * Post the preview URL on a pull request, updating the workflow's own previous comment rather
 * than adding a new one on every push.
 *
 * Extracted from the workflow so the update-vs-create branch can be tested. A PR that gathered
 * one comment per push would be noise, and the branch that prevents it had no coverage while it
 * lived inline in YAML.
 *
 * The marker is an HTML comment: invisible when rendered, and the only reliable way to recognise
 * a comment this workflow wrote rather than one a human happened to word similarly.
 */

export const MARKER = '<!-- design-space-preview -->';

/**
 * The comment is only ever written after smoke has passed — a failing smoke run fails the job
 * before this step is reached — so there is no "smoke failed" variant. Adding one would be a
 * branch nothing can execute.
 *
 * @param {{tagUrl: string, prNumber: number, sha: string}} opts
 */
export function previewCommentBody({ tagUrl, prNumber, sha }) {
  const shortSha = sha.slice(0, 7);
  return `${MARKER}
## Preview deployment

| | |
|---|---|
| **URL** | ${tagUrl} |
| **Commit** | \`${shortSha}\` |
| **Tag** | \`pr-${prNumber}\` |
| **Traffic** | none — this revision carries no production traffic |

Smoke tests passed against this revision.
`;
}

/**
 * @param {{github: any, owner: string, repo: string, prNumber: number, body: string}} opts
 * @returns {Promise<{action: 'updated'|'created', commentId?: number}>}
 */
export async function upsertPreviewComment({ github, owner, repo, prNumber, body }) {
  // Paginate. listComments returns 30 per page, oldest first, so on a PR with more than 30
  // comments this workflow's own comment — always among the newest — falls on a later page. An
  // unpaginated search would never find it and would post a fresh comment on every push, which
  // is exactly what this function exists to prevent.
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const existing = comments.find((c) => c && typeof c.body === 'string' && c.body.includes(MARKER));

  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    return { action: 'updated', commentId: existing.id };
  }

  const created = await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  return { action: 'created', commentId: created?.data?.id };
}
