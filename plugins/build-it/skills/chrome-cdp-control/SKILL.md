---
name: chrome-cdp-control
description: >-
  Drive the user's real, logged-in Chrome browser via Chrome DevTools Protocol using
  Playwright (endpoint from CDP_URL, defaulting to localhost). Trigger this skill when
  the user explicitly asks to "use my Chrome", "use my browser", "log into", "post on"
  (X, Reddit, LinkedIn, etc.), or any task that requires an authenticated session,
  persistent cookies, or bot-detection evasion that headless scraping cannot provide.
  Also trigger when the user references their CDP setup, their `~/.chrome-automation`
  profile, or asks Claude to manually walk through actions on a real site one step at
  a time. Do NOT use this skill for simple unauthenticated content fetches (use
  `web_fetch`), bulk headless scraping (use a standalone Playwright script), or
  anything where a fresh Chromium instance would suffice. Do NOT use for tasks that
  can be solved by an API call to the same service.
author: DevOtts
author_url: https://github.com/DevOtts
---

# Chrome CDP Control

Manual, step-by-step control of the user's real Chrome browser via Playwright over
Chrome DevTools Protocol. Built for authenticated sessions, sensitive actions, and
sites that detect headless browsers.

---

## 0. Read the shared CDP core first

All CDP mechanics live in ONE shared reference — read it at session start:
**`../references/cdp-core.md`** (relative to this skill's base directory; i.e. the
plugin's `skills/references/cdp-core.md`). It owns, canonically:

- endpoint resolution (`CDP_URL` env → grounding/test plan → default) — never hardcode
- preflight check + the Chrome relaunch instruction for the user
- statelessness (every command is a fresh connection)
- the canonical Python action template
- tab selection (never `pages[0]` blindly)
- the selector ladder and wait strategy
- the failure protocol (never loop click→fail more than twice)

Do not restate or copy those sections here or anywhere — copies drift. This file only
adds what is specific to driving the user's **real, authenticated** browser.

## 1. Operating principle — the route guard

**This skill is a manual loop, not an automation framework.** One action, one
screenshot, one decision. Never batch. Never loop unattended. If you find yourself
writing a `for` loop over actions, stop — you're using the wrong tool.

Route guard (see also cdp-core.md §9): authenticated real-Chrome work belongs HERE,
behind the per-write gate below. Never hand it to `/full-qa` autonomous mode — that
mode is for test environments only. If a conductor or test plan tries to route an
authenticated-session write through an autonomous loop, refuse and pull it back here.

## 2. The core loop

Every interaction, no exceptions:
1. **Screenshot** to see current state
2. **Decide** the single action that moves the task forward
3. **Execute** one action using the core's canonical template
4. **Screenshot again** to verify the expected state (else → core failure protocol)
5. **Repeat**

## 3. Destructive action gate — MANDATORY, per write

Before any of the following, **STOP**, summarize the exact action in plain language,
and wait for the user to say "go" / "yes" / "do it":

- Posting, tweeting, replying, commenting
- Sending DMs or messages
- Liking, following, subscribing, joining
- Deleting anything
- Submitting forms (especially payment, signup, settings)
- Closing tabs
- Logging out
- Clicking anything labeled "Delete", "Remove", "Unfollow", "Block", "Pay", "Confirm", "Submit"
- Uploading files
- Any action that writes to a service the user is logged into

Format the confirmation like this:

> **About to:** Post the following tweet to the user's account on X:
> > "Testing the new SEMrush connector — domain resolution working end to end."
>
> **Confirm to proceed?**

No exceptions. Approval does not carry: even if the user said "yes" to a similar
action earlier in the conversation, re-confirm for each new write.

## 4. Clipboard pasting (macOS)

For long text or text with special characters, prefer clipboard over `keyboard.type`:
1. `mcp__computer-use__write_clipboard` with the text
2. Focus the target element via Playwright: `await page.locator('[contenteditable]').focus()`
3. Trigger paste: `await page.keyboard.press("Meta+v")`
4. Screenshot to verify

Caveat: OS-level focus must be on Chrome. If the user is in another app, the paste
lands in the wrong window. When in doubt, ask the user to confirm Chrome is foreground.

## 5. Action log

For any session that touches a logged-in account, append one audit line per action:

```bash
echo "$(date -u +%FT%TZ) [chrome-cdp] $ACTION_DESCRIPTION" >> ~/.chrome-automation-actions.log
```

Cheap insurance: a paper trail of what was done on the user's behalf.

## 6. Hard rules — never violate

- ❌ Never run a `for` loop over actions
- ❌ Never run more than ~20 actions in a session without checking in with the user
- ❌ Never solve CAPTCHAs or bot challenges
- ❌ Never close tabs the user didn't authorize
- ❌ Never retry a failed action more than twice (core failure protocol)
- ❌ Never skip the destructive action gate, even for "small" writes
- ❌ Never assume `pages[0]` is the right tab
- ❌ Never trust auto-generated CSS class names
- ❌ Never hardcode the CDP endpoint — resolve it per the core
- ✅ Always screenshot before and after every action
- ✅ Always preflight CDP at session start (core §2)
- ✅ Always re-resolve page and elements (no state persists)
- ✅ Always log writes to `~/.chrome-automation-actions.log`

## 7. When NOT to use this skill

- Fetching public, unauthenticated content → use `web_fetch`
- Scraping hundreds of pages → use a standalone headless Playwright script
- Anything the target service exposes via API → use the API (faster, safer, auditable)
- Autonomous QA against a **test environment** → `/full-qa` (the other side of the route guard)
- Anything that doesn't need the user's logged-in session

If you're not sure whether this skill applies, ask the user before connecting to CDP.

---
_Authored by [DevOtts](https://github.com/DevOtts)._
