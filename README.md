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

## Status

Phase 1, in progress. See [`backlog.md`](./backlog.md) for the stories,
[`docs/architecture.md`](./docs/architecture.md) for how it fits together, and
[`docs/adr/`](./docs/adr/) for why.

Phase 2 adds conversation-addressed storage and in-page chat. Phase 3 adds real external design
systems — and with them the most useful output of the whole thing, which is the list of places a
journey *cannot* be expressed in a client's own design system. Those gaps are the deliverable,
not a bug: they locate a hole in that system precisely, as a by-product of a conversation the
client already wanted to have.
