---
name: mana-port
description: Port a content source from another reader app — Paperback (0.8 or 0.9), Aidoku, Tachiyomi/Mihon, or Suwatte — into a Mana source in this repo. Use when the user points at an existing source for another app and asks for it here, or asks what a reference source does that ours does not.
---

# Porting a source to Mana

A reference implementation has already found the endpoints, the token dance and the site's
quirks. It has not found what this app can show, and it is often older than the site. Take
its knowledge, not its shape.

Read [docs/CONVERSION.md](../../../docs/CONVERSION.md) for the method and type map, then work
through these steps in order. Building happens under the `mana-extension` skill — load it at
step 4.

## 1. Inventory the reference

List everything it does, before deciding anything:

- every home or discover section, with its request and the style it used
- every search filter and sort, with the values it sends
- every setting, with its default and what it changes
- the request headers, cookies, tokens and rate limit, and why each exists
- the chapter list's source (inline, JSON in a script, an API), its numbering and grouping
- how pages are reached: plain URLs, a second request, a WebView, decryption, descrambling
- deep-link patterns, tracker ids, and anything shown on the title page beyond the summary

Write it down. A capability dropped here is one the reader loses without anyone noticing.

## 2. Check it against the live site

The reference tells you the endpoints; the site tells you the sections.

- Home rows keep the site's own names and order. Rename nothing the site already titled.
- A row the reference collapsed into chips becomes a row again.
- A filter or sort the site no longer offers is dropped and the drop is said in the report;
  one the site gained is added.
- An endpoint that answers differently now is the site's truth, not the reference's.

Without network access, say which of these were checked against a capture the user
provided and which were taken on trust from the reference.

## 3. Map it

For each line of the inventory, name the Mana method or field that carries it (the tables
in `docs/CONVERSION.md`). Three things never map:

- **Sign-in other than OAuth**, library sync, progress sync and library links — the app does
  not call them yet. Leave them out and say so.
- **A per-request image hook that returns a request.** It becomes a long-lived client
  returned from `getPageTransport`, with the per-image difference in the URL fragment.
- **A WebView hook installed before the page's scripts run.** There is none; read the value
  with `evaluate` after `goto`, or find the endpoint the page calls and call it directly.

## 4. Build it

Load `mana-extension` and follow its phases from Scaffold. Port in this order, so each step
is testable before the next depends on it: client and one search → title and chapters →
pages → home rows → filters and sorts → settings → deep links.

The reference's numbers carry over as data, not as code: rate limits, page sizes, timeouts,
retry counts, header values. Its helpers do not — `src/common/` has the house version of
nearly all of them.

## 5. Report the gaps

Finish with what the port could not keep and why, and what it gained over the reference:
info rows, `additionalInfo`, tracker links, native decryption. Name the reference only in
the conversation, never in code, commits or documentation.
