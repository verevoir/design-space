/**
 * Minimal adapter shape that gate accepts. Mirrors the shape in render so gate
 * can accept any adapter without importing the render package.
 */
export interface AdapterLike {
  readonly name: string;
  readonly components: Readonly<Record<string, (props: unknown) => string>>;
}

/** A gap record as returned by the render package. */
export interface GapRecord {
  readonly screenId: string;
  readonly component: string;
}
