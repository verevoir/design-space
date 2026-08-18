/**
 * Type declaration for check-exit-contracts.mjs, which has no declarations of its own (TS7016)
 * — the script stays plain JS/JSDoc; this file exists only so tests/tsconfig.json's strict
 * settings can type-check its imports. Kept in sync with the JSDoc in the script by hand: the
 * two are not generated from a shared source, so a signature change to the script that doesn't
 * update this file would go undetected until the next edit here — same failure mode as any
 * hand-written declaration, not specific to this one.
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
