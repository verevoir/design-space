/**
 * Type declaration for check-exit-contracts.mjs — TS7016, hand-maintained against the script's
 * own JSDoc. Same reasoning as every sibling declaration in this directory (why this pattern
 * exists, what "kept in sync by hand" means and risks): see scripts/service-urls.d.mts's file
 * header, stated once there rather than repeated here.
 */

export declare function stripCommentMarker(line: string): string | null;

export interface ExitCodeEntry {
  code: number;
  description: string;
}

export interface ExtractedExitCodes {
  codes: ExitCodeEntry[];
  sawGeneric: boolean;
}

export declare function extractDocumentedExitCodes(source: string): ExtractedExitCodes;

export declare function trackedFiles(dir: string, extensions: string[], root?: string): string[];

export interface ScriptWithMultiCodeContract {
  relPath: string;
  codes: ExitCodeEntry[];
}

export declare function scriptsWithMultiCodeContracts(root?: string): ScriptWithMultiCodeContract[];

export interface UnassertedCodeFinding {
  script: string;
  code: number | null;
  description?: string;
  testFiles?: string[];
}

export declare function findUnassertedCodes(root?: string): UnassertedCodeFinding[];
