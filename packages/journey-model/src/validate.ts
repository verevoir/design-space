import { type ZodError } from 'zod';
import { JourneyDocumentSchema, type JourneyDocument } from './schema.js';

/** A located validation error names the offending path so the caller can act on it. */
export interface ValidationError {
  /** Human-readable description of what is wrong. */
  message: string;
  /** JSON-path-style location of the offending value (e.g. `screens[2].actions[0].target`). */
  path: string;
}

/** Result type: either the parsed document or a non-empty list of errors. */
export type ValidationResult =
  | { ok: true; document: JourneyDocument }
  | { ok: false; errors: ValidationError[] };

/** Collect all Zod issues into located errors. */
function zodErrorsToValidationErrors(err: ZodError): ValidationError[] {
  return err.issues.map((issue) => ({
    message: issue.message,
    path: issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)).join('').replace(/^\./, ''),
  }));
}

/**
 * Structural check: every non-null action target must name a screen in this
 * journey document. Reports the offending path if any target is dangling.
 */
function checkDanglingTargets(doc: JourneyDocument): ValidationError[] {
  const screenIds = new Set(doc.screens.map((s) => s.id));
  const errors: ValidationError[] = [];

  doc.screens.forEach((screen, si) => {
    screen.actions.forEach((action, ai) => {
      if (action.target !== null && !screenIds.has(action.target)) {
        errors.push({
          message: `Action target "${action.target}" does not name any screen in this journey.`,
          path: `screens[${si}].actions[${ai}].target`,
        });
      }
    });
  });

  return errors;
}

/**
 * Structural check: every screen must be reachable. A screen is reachable if
 * it is named by `entry` or is the target of at least one action in the
 * journey. Reports the offending path if any screen is unreachable.
 */
function checkReachability(doc: JourneyDocument): ValidationError[] {
  const reachable = new Set<string>();
  reachable.add(doc.entry);

  for (const screen of doc.screens) {
    for (const action of screen.actions) {
      if (action.target !== null) {
        reachable.add(action.target);
      }
    }
  }

  const errors: ValidationError[] = [];
  doc.screens.forEach((screen, si) => {
    if (!reachable.has(screen.id)) {
      errors.push({
        message: `Screen "${screen.id}" is unreachable: it is not the entry point and no action targets it.`,
        path: `screens[${si}]`,
      });
    }
  });

  return errors;
}

/**
 * Validate a raw unknown value as a journey document.
 *
 * Shape validation is performed by Zod (missing required fields, unknown
 * action weights, wrong types). Structural validation (dangling action
 * targets, unreachable screens) is performed separately because Zod cannot
 * express cross-document constraints.
 *
 * Every error names the offending path so the caller can locate the problem
 * without reading the whole document.
 */
export function validateJourney(raw: unknown): ValidationResult {
  const parsed = JourneyDocumentSchema.safeParse(raw);

  if (!parsed.success) {
    return { ok: false, errors: zodErrorsToValidationErrors(parsed.error) };
  }

  const doc = parsed.data;

  // Run structural checks after shape is confirmed valid.
  const structuralErrors = [
    ...checkDanglingTargets(doc),
    ...checkReachability(doc),
  ];

  if (structuralErrors.length > 0) {
    return { ok: false, errors: structuralErrors };
  }

  return { ok: true, document: doc };
}
