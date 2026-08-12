import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shape regression tests for the antagonistic-review workflow: the verdict-surface
// step, the PR-head materialize step, and the panel's memory of how it judged this
// diff. Their behaviour lives inline in the YAML (not an extractable script like
// resolve-merge-base.sh / aggregate.sh), so these pin the text shape that must hold —
// zero-dependency, same approach as guardrails' antagonistic-review-gate tests.
// Regexes match whitespace-collapsed text so the YAML's line-wrapping never matters.

const yml = readFileSync(
  fileURLToPath(new URL('../.github/workflows/antagonistic-review.yml', import.meta.url)),
  'utf8'
);
const flat = yml.replace(/\s+/g, ' ');

describe('antagonistic-review.yml — the lens-verdict surface step', () => {
  it('exists, always runs, and is budgeted', () => {
    // if: always() is load-bearing: the review action may exit non-zero on a REJECT,
    // and the skip-on-failure default would suppress the step in exactly the case it
    // exists to show.
    expect(flat).toMatch(
      /name: Surface this lens's verdict as the job conclusion if: always\(\) timeout-minutes: 2/
    );
  });

  it('extracts the verdict via jq with a fail-closed fallback (empty, never APPROVE)', () => {
    // On jq failure `v` becomes EMPTY (≠ APPROVE → reject). "Fixing" it to
    // `|| echo 'APPROVE'` would turn a parse failure into a silent approve.
    expect(flat).toMatch(
      /v="\$\(timeout 10 jq -r '\.verdict \/\/ empty' "\$f" 2>\/dev\/null \|\| echo ''\)"/
    );
  });

  it('fails the job legibly when the panelist wrote no verdict file', () => {
    expect(flat).toMatch(/if \[ ! -f "\$f" \]; then[^]{0,250}produced no verdict[^]{0,250}exit 1/);
  });

  it('bounds the summary jq parse too (not just the verdict parse)', () => {
    // A pathological .summary payload must not hang the step; the summary parse carries
    // the same timeout 10 as the verdict parse. A suffix-only pin (from `head -1`) would
    // pass even if this timeout were reverted, so assert the bound explicitly.
    expect(flat).toMatch(/summary="\$\(timeout 10 jq -r '\.summary \/\/ ""'/);
  });

  it('sanitises the summary: strip CR, %25-encode, then neutralise a line-starting ::', () => {
    // Order is load-bearing and mirrors aggregate.sh's safe(): a literal \r is a runner
    // line terminator (so '\r::set-env' would open a command the ^:: sed never sees) —
    // strip it FIRST; then %-encode before embedding (a %0A/%0D escape would decode
    // inside the `::` value into a newline + fresh command); then neutralise line-start
    // ::. First line only, capped at 300 chars.
    expect(flat).toMatch(
      /head -1 \| cut -c1-300 \| tr -d '\\r' \| sed -e 's\/%\/%25\/g' -e 's\/\^::\/ ::\/'/
    );
  });

  it('surfaces the sanitised summary in the reject ::error', () => {
    // The finding COUNT is part of the title (#175): a reader who fixed "the"
    // finding could not otherwise tell whether more were waiting. Asserted as one
    // span with `${summary}` so the count cannot drift out of the title that
    // carries it.
    expect(flat).toMatch(/rejected \(\$\{n\} findings\)::\$\{summary\}/);
  });

  it('keeps the APPROVE echo as the terminal statement (after the last exit 1)', () => {
    // An accidental exit after the APPROVE echo would start blocking every merge.
    const stepAt = yml.indexOf("name: Surface this lens's verdict as the job conclusion");
    expect(stepAt).toBeGreaterThanOrEqual(0);
    const stepBody = yml.slice(stepAt, yml.indexOf('antagonistic-review:', stepAt));
    const approveAt = stepBody.indexOf('echo "${{ matrix.lens }} — APPROVE"');
    expect(approveAt).toBeGreaterThanOrEqual(0);
    expect(approveAt).toBeGreaterThan(stepBody.lastIndexOf('exit 1'));
  });

  it('guards the review job to same-repo heads (fork PRs never reach the panel)', () => {
    // The load-bearing fork control: panelists + org secrets only run for a head in
    // this repo. Dropping this if: would expose the secrets to fork-authored diffs.
    expect(flat).toMatch(
      /review: name: review[^]{0,400}if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository/
    );
  });
});

describe('antagonistic-review.yml — the PR-head materialize step (the $HEAD_SHA read fix)', () => {
	it('materialises the head as a read-only git-archive extract, not a checkout', () => {
		// A checkout would make the head the working tree, defeating the base-config
		// gate; an archive extract is inert data the lens reads, never executed.
		expect(flat).toMatch(/git archive "\$HEAD_SHA" \| tar -x -C "\$HEAD_ROOT"/);
		expect(flat).toMatch(/chmod -R a-w "\$HEAD_ROOT"/);
	});

	it('fails closed on a broken extract — pipefail plus a non-empty check', () => {
		// bash -e alone does not catch a failing `git archive`: tar exits 0 on empty
		// input, so the step would pass having extracted nothing and the lens would
		// review an empty tree.
		expect(flat).toMatch(/set -o pipefail/);
		expect(flat).toMatch(/PR head extract is empty/);
	});

	it('strips symlinks from the extract, before the chmod that would block the cleanup', () => {
		// git archive reproduces the author's symlinks, so a committed
		// `notes.md -> /proc/self/environ` would let a lens reading $HEAD_ROOT/<path>
		// read the RUNNER filesystem — this job's secrets included — while believing
		// it was reading a PR file. The strip is the control; the ORDER matters
		// because chmod -R a-w would make the tree unwritable first.
		expect(flat).toMatch(/find "\$HEAD_ROOT" -type l -delete/);
		const stripAt = yml.indexOf('-type l -delete');
		const chmodAt = yml.indexOf('chmod -R a-w "$HEAD_ROOT"');
		expect(stripAt).toBeGreaterThanOrEqual(0);
		expect(chmodAt).toBeGreaterThan(stripAt);
	});

	it('exports HEAD_ROOT and passes it into the review step env — both halves of the wiring', () => {
		expect(flat).toMatch(/echo "HEAD_ROOT=\$HEAD_ROOT" >> "\$GITHUB_ENV"/);
		// Without the consumption side the export still passes, but the lens never
		// receives it and silently reverts to reading BASE.
		expect(flat).toMatch(/HEAD_ROOT: \$\{\{ env\.HEAD_ROOT \}\}/);
	});

	it('budgets the materialize step (timeout-minutes: 2)', () => {
		expect(flat).toMatch(/name: Materialize the PR head read-only[^]{0,140}timeout-minutes: 2/);
	});

	it('runs AFTER the head fetch and BEFORE the review — reorder either way and the lens reads BASE', () => {
		// The ordering is the whole mechanism: extract from a sha not yet fetched fails,
		// and extracting after the review runs leaves the lens with no $HEAD_ROOT at all.
		const fetchAt = yml.indexOf('name: Fetch the PR head for review');
		const materializeAt = yml.indexOf('name: Materialize the PR head read-only');
		const reviewAt = yml.indexOf('name: Adversarial review against the provisioned practices');
		expect(fetchAt).toBeGreaterThanOrEqual(0);
		expect(materializeAt).toBeGreaterThan(fetchAt);
		expect(reviewAt).toBeGreaterThan(materializeAt);
	});

	it('tells the lens to read $HEAD_ROOT and never `git show HEAD:` — the false-finding source', () => {
		expect(flat).toMatch(/\$HEAD_ROOT\/<path>/);
		expect(flat).not.toMatch(/git show "\$HEAD_SHA":<path>/);
	});
});

describe('antagonistic-review.yml — the panel remembers how it judged this diff', () => {
  it('stamps the diff hash AFTER the model step, so a lens cannot pick its own memory key', () => {
    // The load-bearing ordering. Stamped before the model, a panelist holding
    // Write could overwrite diff-hash.txt and have its verdict remembered
    // against a diff nobody reviewed — evading the determinism check entirely.
    const modelAt = yml.indexOf('name: Adversarial review against the provisioned practices');
    const stampAt = yml.indexOf("name: Stamp the reviewed diff's hash beside the verdict");
    const publishAt = yml.indexOf("name: Publish this lens's verdict");
    expect(modelAt).toBeGreaterThanOrEqual(0);
    expect(stampAt).toBeGreaterThan(modelAt);
    expect(publishAt).toBeGreaterThan(stampAt);
  });

  it('stamps the hash even when the lens rejected (if: always())', () => {
    // The review action exits non-zero on a REJECT. Without always() the stamp
    // is skipped there, and the memory would only ever hold approvals — blind to
    // the flip in the direction that actually costs a round.
    expect(flat).toMatch(
      /name: Stamp the reviewed diff's hash beside the verdict \(the memory key\) if: always\(\) timeout-minutes: 2/
    );
  });

  it('delegates the stamp to the extracted script rather than inlining its guards', () => {
    // The guards do not live in this `run:` block, and must not come back to it.
    // Most of it is degradation paths (no merge base, a bad range bound, an
    // unusable timeout, a failed diff, a failed hash) that nothing a YAML shape
    // test can see would reach, so
    // inline they would be pinned by ordering and a literal and nothing else. They
    // live in stamp-diff-hash.sh, unit-tested in
    // stamp-diff-hash.test.ts — the same move as resolve-merge-base.sh.
    //
    // The negative half is the load-bearing one: inlining it AGAIN would restore
    // the untestable arrangement while every other assertion here still passed.
    const stampAt = yml.indexOf("name: Stamp the reviewed diff's hash");
    const nextAt = yml.indexOf("- name:", stampAt + 10);
    const step = yml.slice(stampAt, nextAt);
    // Matched through the existence guard the step wraps the call in: the workflow
    // is read from the base BRANCH while the tree is checked out at the base SHA, so
    // an unguarded call exits 127 on any PR opened before the script landed.
    expect(step).toMatch(
      /bash "\$s" \.antagonistic-review "\$RUNNER_TEMP\/reviewed\.diff"/
    );
    expect(step).toMatch(/s=\.github\/antagonistic-review\/stamp-diff-hash\.sh/);
    expect(step).toMatch(/if \[ -f "\$s" \]; then/);
    // The negative half reads the COMMANDS only. Over the whole step it also read
    // the comments, so a comment that merely NAMED `git diff` as one of the
    // degradation paths turned it red — a check that fails on prose describing the
    // thing rather than on the thing, which is the opposite of what it is for.
    const commands = step
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(commands).not.toMatch(/git diff/);
    expect(commands).not.toMatch(/sha256sum/);
  });

  it('publishes the hash alongside the verdict, and nothing else the lens wrote', () => {
    // Naming both files (rather than the directory) keeps any other file a
    // panelist dropped in .antagonistic-review out of the artifact.
    expect(flat).toMatch(
      /name: verdict-\$\{\{ matrix\.lens \}\} path: \| \.antagonistic-review\/verdict\.json \.antagonistic-review\/diff-hash\.txt/
    );
  });

  it('keys the memory on the PR at BOTH ends, because pull_request_target caches into the BASE scope', () => {
    // Every PR's cache lands in the base branch's scope, so a key without the PR
    // number would have concurrent PRs overwriting each other's memory and
    // reporting flips that are really two different changes. Counted rather than
    // merely matched: restore and save must carry the SAME key, and a single
    // match would pass with one of the pair silently un-scoped.
    const scoped =
      flat.match(
        /key: antagonist-memory-v1-pr-\$\{\{ github\.event\.pull_request\.number \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/g
      ) ?? [];
    expect(scoped, 'both the restore and the save step must use the PR-scoped key').toHaveLength(2);
    // The rolling key means no run ever writes a key it could read back, so the
    // prefix restore is what actually finds the previous run's entry.
    expect(flat).toMatch(
      /restore-keys: \| antagonist-memory-v1-pr-\$\{\{ github\.event\.pull_request\.number \}\}-/
    );
  });

  it('saves the memory even when the gate is about to fail (if: always())', () => {
    // The run that finds a flip is a rejecting run. A memory saved only on green
    // would forget exactly the rounds worth remembering.
    expect(flat).toMatch(
      /name: Persist the panel's memory for the next run if: always\(\) && github\.event\.pull_request\.number/
    );
  });

  it('lets the memory fail without blocking a merge (continue-on-error on all three steps)', () => {
    // The cache service being down, or a bug in panel-memory.sh, must cost the
    // memory and nothing else. Read with the script's own always-exit-0: two
    // independent layers, because this sits inside the REQUIRED check.
    for (const step of [
      "name: Restore the panel's memory of this PR",
      'name: Report any lens that changed its mind about an unchanged diff',
      "name: Persist the panel's memory for the next run",
    ]) {
      const at = yml.indexOf(step);
      expect(at, `${step} must exist`).toBeGreaterThanOrEqual(0);
      expect(yml.slice(at, at + 400)).toContain('continue-on-error: true');
    }
  });

  it('wires the lens name into the stamp step, since the memory key line names it', () => {
    // The script defaults LENS to the literal "lens" when unset, so a missing env
    // key costs no exit code and no hash — it silently makes every lens's memory
    // line identical, and the one thing the line exists to tell you (which lens
    // produced this key) is gone. Nothing else in this suite would notice.
    //
    // The boundary is the NEXT STEP, not a marker inside this one. It was
    // `indexOf('run: bash', stampAt)` until the existence guard rewrote the body to
    // `run: |` — after which that marker no longer occurred in this step at all, the
    // slice ran on ~230 lines across into the next job, and the assertion passed on
    // a span that had nothing to do with the stamp step. It never went red, which is
    // what made it worth nothing.
    const stampAt = yml.indexOf("name: Stamp the reviewed diff's hash");
    expect(stampAt).toBeGreaterThanOrEqual(0);
    const stampStep = yml.slice(stampAt, yml.indexOf('- name:', stampAt + 10));
    expect(stampStep).toMatch(/LENS: \$\{\{ matrix\.lens \}\}/);

    // The degradation branch the guard introduces, which lives in the `run:` block
    // and so can be pinned by nothing but a text assertion — the same reason the
    // rest of this logic was extracted to a script in the first place.
    expect(stampStep).toMatch(/no stamp script at this base/);
  });

  it('scopes all three memory steps to a real PR, at both the read and the write end', () => {
    // `pull_request_target` files every PR's cache under the BASE branch, so the
    // key carries the PR number. On a workflow_dispatch run there is no number:
    // without this guard the steps run anyway and read or write a key ending in
    // an empty segment — one shared bucket that every dispatch run overwrites,
    // reporting flips between unrelated changes.
    //
    // Matched on the `if:` LINE, not anywhere in the step. A window search passes
    // on the cache KEY, which also interpolates the PR number — so the guard could
    // be deleted outright and the assertion would stay green off the key alone.
    // Confirmed by deleting it: the window form missed, this one catches.
    for (const step of [
      "name: Restore the panel's memory of this PR",
      'name: Report any lens that changed its mind about an unchanged diff',
      "name: Persist the panel's memory for the next run",
    ]) {
      const at = yml.indexOf(step);
      expect(at, `${step} must exist`).toBeGreaterThanOrEqual(0);
      const guard = yml
        .slice(at, at + 400)
        .split('\n')
        .find((l) => /^\s*if:/.test(l));
      expect(guard, `${step} has no if: guard at all`).toBeDefined();
      expect(guard, `${step}'s guard does not scope to a real PR`).toMatch(
        /github\.event\.pull_request\.number/
      );
    }
  });

  it('cannot fail a job by the memory scripts being absent from the base checkout', () => {
    // The failure this closes, which has broken this gate once already. The workflow
    // is read from the base BRANCH, but the tree is checked out at the base SHA as
    // frozen on the PR event — so for any PR opened before a gate script landed, the
    // step exists and the file does not. An unguarded `bash <script>` exits 127 and
    // fails a job whose lens had already written a good verdict.
    //
    // The rule is NOT "guard every script call": aggregate.sh must fail loudly if it
    // is missing, because it IS the gate. It applies to the memory, which is declared
    // to report and never gate — so each of its calls must either guard for existence
    // or be continue-on-error, and this asserts one or the other per step.
    const stampAt = yml.indexOf("name: Stamp the reviewed diff's hash");
    expect(stampAt).toBeGreaterThanOrEqual(0);
    const stampStep = yml.slice(stampAt, yml.indexOf('- name:', stampAt + 10));
    expect(stampStep, 'the stamp step must not exit 127 on a base without the script').toMatch(
      /if \[ -f "\$s" \]; then/
    );

    const reportAt = yml.indexOf('name: Report any lens that changed its mind');
    expect(reportAt).toBeGreaterThanOrEqual(0);
    expect(
      yml.slice(reportAt, reportAt + 400),
      'the memory-report step must not fail the job when panel-memory.sh is absent'
    ).toContain('continue-on-error: true');

    // The other half of the rule, so this test cannot be "satisfied" by guarding
    // everything: the gate's own decision must still fail closed on a missing script.
    const unionAt = yml.indexOf('name: Union the findings and gate on unanimous approval');
    expect(unionAt).toBeGreaterThanOrEqual(0);
    const unionStep = yml.slice(unionAt);
    expect(unionStep).not.toMatch(/if \[ -f /);
    expect(unionStep).not.toContain('continue-on-error');
  });

  it('hands panel-memory.sh the verdicts dir and the ledger path it expects', () => {
    // The one piece of new wiring the suite did not police. Both arguments are
    // positional and neither is validated by the script — pointed at the wrong
    // verdicts dir it finds no lenses and reports nothing, and pointed at the wrong
    // ledger it silently starts a fresh memory every run. Either failure looks
    // exactly like a panel that remembered and found no flips, which is the one
    // outcome this whole feature exists to distinguish from.
    const reportAt = yml.indexOf('name: Report any lens that changed its mind');
    expect(reportAt).toBeGreaterThanOrEqual(0);
    const step = yml.slice(reportAt, yml.indexOf('- name:', reportAt + 10));
    expect(step).toMatch(
      /bash \.github\/antagonistic-review\/panel-memory\.sh verdicts \.antagonist-memory\/ledger\.json/
    );
    // The same directory the download step writes the artifacts into, so the two
    // cannot drift apart into a memory that never sees a verdict.
    const downloadAt = yml.indexOf("name: Collect the panel's verdicts");
    expect(yml.slice(downloadAt, yml.indexOf('- name:', downloadAt + 10))).toMatch(
      /path: verdicts/
    );
  });

  it('keeps the union step last, so the gate still has the final word', () => {
    // The memory reports before the gate decides. Moving it after aggregate.sh's
    // `exit 1` would silently skip it on every rejecting run — the runs it
    // exists for.
    const memoryAt = yml.indexOf('name: Report any lens that changed its mind');
    const unionAt = yml.indexOf('name: Union the findings and gate on unanimous approval');
    expect(memoryAt).toBeGreaterThanOrEqual(0);
    expect(unionAt).toBeGreaterThan(memoryAt);
    expect(yml.slice(unionAt)).not.toContain('- name:');
  });
});
