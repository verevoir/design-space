/**
 * Type declaration for upsert-preview-comment.mjs — TS7016, hand-maintained against the script's
 * own JSDoc. Same reasoning as every sibling declaration in this directory (why this pattern
 * exists, what "kept in sync by hand" means and risks): see scripts/service-urls.d.mts's file
 * header, stated once there rather than repeated here.
 */

export declare const MARKER: string;

export interface PreviewCommentBodyOptions {
  tagUrl: string;
  prNumber: number;
  sha: string;
}

export declare function previewCommentBody(opts: PreviewCommentBodyOptions): string;

export interface GithubComment {
  id: number;
  body?: string | null;
}

/**
 * Deliberately loose on `paginate`'s and `listComments`'s own signatures: this script only ever
 * passes `github.rest.issues.listComments` to `github.paginate` as an opaque reference and reads
 * the resolved array, never calls either directly with typed arguments — the real Octokit type
 * is far larger than this script uses, and pinning the parts it does not touch would be a false
 * claim about what this file actually depends on.
 */
export interface GithubClient {
  paginate: (endpoint: unknown, params: Record<string, unknown>) => Promise<GithubComment[]>;
  rest: {
    issues: {
      listComments: unknown;
      updateComment: (params: {
        owner: string;
        repo: string;
        comment_id: number;
        body: string;
      }) => Promise<unknown>;
      createComment: (params: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
      }) => Promise<{ data?: { id?: number } }>;
    };
  };
}

export interface UpsertPreviewCommentOptions {
  github: GithubClient;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
}

export interface UpsertPreviewCommentResult {
  action: 'updated' | 'created';
  commentId?: number;
}

export declare function upsertPreviewComment(
  opts: UpsertPreviewCommentOptions,
): Promise<UpsertPreviewCommentResult>;
