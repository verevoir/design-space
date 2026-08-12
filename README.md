# design-space

An AI-assisted design workflow with two axes.

Most design tools fuse the journey and the design system at the point of creation: you draw a
flow already wearing a visual language, and the drawing is the artefact. design-space keeps them
orthogonal — a journey is a semantic document that names no design system, a design system is an
adapter that knows nothing about any particular journey, and what you look at is the product of
the two.

That separation buys one thing, and it is the whole point:

> **You can hold one axis still and have a conversation about the other.**

Fix the design system — deliberately provisional, hand-drawn — and vary the journey: *should we
ask for the postcode first?* Nobody derails it by objecting to a button colour, because there are
no button colours to object to. Then fix the journey and vary the design system: *this feels
crowded, can we try something lighter?* Same flow, several expressions, and now the topic is
expression rather than order.

## What you get

- **A journey**, edited as a hand-drawn walkthrough — screen order, controls, what happens when
  you click one, annotations in the margin.
- **Variations of it**, branched off a starting design with a sentence of rationale each, and
  culled when they lose.
- **A matrix** of those variations against your design systems, each cell a real clickable site
  rather than a picture of one.

## Running it

### Development (Node.js)

Requires **Node.js ≥ 20**. From a clean clone:

```sh
npm install
npm run verify
```

`npm run verify` builds every package with `tsc -b`, runs all tests with Vitest, and lints with ESLint. It must be green before any change merges.

### Container (Docker)

The studio server is packaged as a multi-stage Docker image. The build stage compiles every package and prerenders the broadband-switch journey into a static HTML document; the runtime stage serves it from that document with no git dependency.

**Build:**

```sh
docker build -t design-space-studio .
```

**Run:**

```sh
docker run --rm -p 8080:8080 design-space-studio
```

Then open <http://localhost:8080> to see the rendered journey, or curl the health endpoint:

```sh
curl -s http://localhost:8080/health
```

The `PORT` environment variable is read by the server (default `8080`). Cloud Run sets it automatically; override it locally with `-e PORT=9000`.

**Why the health endpoint is `/health` and not `/healthz`.** A review raised that `/healthz`
might be a path the platform reserves and swallows. That was checked against Google's
documentation ([container health checks][chc], [container runtime contract][crc]), which describes
no reserved paths, and the finding was pushed back on as unfounded.

**The deployment disproved that.** Against the live service, `/healthz` returns a Google frontend
404 — an HTML error page from Google's infrastructure, which never reaches the container. Every
other path tested (`/health`, `/readyz`, `/-/health`, and a deliberately meaningless one) reaches
the container and gets its own 404. `/` serves normally throughout.

So `/healthz` is intercepted on Cloud Run whatever the documentation implies, the endpoint moved
to `/health`, and the lesson is recorded rather than the mistake quietly corrected: documentation
plus confident reasoning lost to one curl against the real thing.

[chc]: https://docs.cloud.google.com/run/docs/configuring/healthchecks
[crc]: https://docs.cloud.google.com/run/docs/container-contract

## Status

Phase 1, in progress. See [`backlog.md`](./backlog.md) for the stories,
[`docs/architecture.md`](./docs/architecture.md) for how it fits together, and
[`docs/adr/`](./docs/adr/) for why.

Phase 2 adds conversation-addressed storage and in-page chat. Phase 3 adds real external design
systems — and with them the most useful output of the whole thing, which is the list of places a
journey *cannot* be expressed in a client's own design system. Those gaps are the deliverable,
not a bug: they locate a hole in that system precisely, as a by-product of a conversation the
client already wanted to have.
