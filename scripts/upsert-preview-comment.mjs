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

/** @param {{tagUrl: string, prNumber: number, sha: string, smokePassed?: boolean}} opts */
export function previewCommentBody({ tagUrl, prNumber, sha, smokePassed = true }) {
  const shortSha = sha.slice(0, 7);
  return `${MARKER}
## Preview deployment

| | |
|---|---|
| **URL** | ${tagUrl} |
| **Commit** | \`${shortSha}\` |
| **Tag** | \`pr-${prNumber}\` |
| **Traffic** | none — this revision carries no production traffic |

${smokePassed ? 'Smoke tests passed against this revision.' : 'Smoke tests did NOT pass against this revision.'}
`;
}

/**
 * @param {{github: any, owner: string, repo: string, prNumber: number, body: string}} opts
 * @returns {Promise<{action: 'updated'|'created', commentId?: number}>}
 */
export async function upsertPreviewComment({ github, owner, repo, prNumber, body }) {
  const { data: comments } = await github.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
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
