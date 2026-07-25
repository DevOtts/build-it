# CDP core — shared mechanics for all build-it browser work

Single source of truth for Chrome DevTools Protocol mechanics. `/chrome-cdp-control`
(manual, authenticated) and `/full-qa` (autonomous, test environments) both read this
file at session start and never carry their own copies — copies drift.

## 1. Endpoint resolution — never hardcode

Resolve, in this order, and use the result in every command:
1. `CDP_URL` environment variable
2. a CDP endpoint recorded in `.taskstate/grounding.md` or the test plan
3. the default: `http://localhost:9222` — this line is the default declaration, the only place the port is written

App-under-test URLs resolve the same way: env (`APP_URL`/`APP_PORT`) → `grounding.md`
/ test plan → default app port 3000. Parallel runs each carry their own values;
a hardcoded endpoint is how two runs collide on one browser.

## 2. Preflight

```bash
curl -s "${CDP_URL:-http://localhost:9222}/json/version"   # ${...:-} carries the default
```

If it fails, stop and tell the user to relaunch Chrome themselves (they control which
profile is exposed; never start Chrome for them):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-automation" --no-first-run &   # 9222 = the default port; use your CDP_URL's port if overridden
```

Confirm Playwright: `python3 -c "import playwright" 2>&1 || pip3 install playwright`

## 3. Statelessness

Each bash command is a fresh CDP connection. No Python variables, page objects, or
browser state persist between commands. Every action re-imports, re-connects,
re-resolves the tab, re-finds the element. There is no continuity.

## 4. Canonical action template

Use this exact wrapper for every Python action; fill the `=== ACTION ===` block with
exactly ONE action (navigate, click, type, evaluate, or read).

```bash
python3 << 'PYEOF'
import asyncio, os
from playwright.async_api import async_playwright

CDP_URL = os.environ.get("CDP_URL", "http://localhost:9222")  # default declaration — override via env, never edit call sites

async def go():
    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(CDP_URL)
    ctx = browser.contexts[0]

    # Find target tab by URL substring (NEVER pages[0] blindly)
    page = next((p for p in ctx.pages if "TARGET_URL_FRAGMENT" in p.url), None)
    if page is None:
        page = await ctx.new_page()
        await page.goto("https://TARGET_URL", wait_until="domcontentloaded", timeout=30000)

    # === ACTION ===
    await page.get_by_role("button", name="Post").click()
    # ==============

    await page.wait_for_load_state("networkidle", timeout=10000)  # verify with a wait, not a sleep
    await page.screenshot(path="/tmp/cdp_action.png")
    print("OK:", page.url)
    await pw.stop()

asyncio.run(go())
PYEOF
```

JS inside `page.evaluate()`: use double quotes for JS strings (the outer wrapper is a
heredoc): `await page.evaluate('document.querySelector("[contenteditable]").focus()')`

## 5. Tab selection — never trust `pages[0]`

List tabs first and match by URL substring:

```python
for i, p in enumerate(ctx.pages):
    print(i, p.url, "|", await p.title())
```

Never close a tab the user (or test plan) didn't authorize — closing tabs is a write.

## 6. Selector ladder — in priority order

1. ARIA role — `page.get_by_role("button", name="Post")`
2. Label / placeholder — `page.get_by_label("Search")`, `page.get_by_placeholder("What's happening?")`
3. Visible text — `page.get_by_text("Sign in", exact=True)`
4. Stable `data-*` attributes — `page.locator('[data-testid="tweetButton"]')`
5. Last resort: screenshot + coordinate click — when the DOM is unreachable

Forbidden: auto-generated class names like `.css-1k2n3j4` — they break between deploys.
When in doubt, inspect first: `print((await page.locator('main').aria_snapshot())[:3000])`

## 7. Wait strategy — earn the wait, don't sleep blindly

1. `await page.wait_for_load_state("networkidle")` — after navigation
2. `await page.wait_for_selector("...", state="visible")` — before interaction
3. `await page.locator("...").wait_for()` — before reading
4. `await asyncio.sleep(...)` — only for sub-second animations, only when nothing else works

## 8. Failure protocol

If the post-action screenshot does not show the expected state:
1. Take one more screenshot — the page may be mid-render.
2. Try ONE alternative selector (e.g. role instead of text).
3. Still failing → STOP. Never loop click→fail→click→fail more than twice. Report what
   was attempted, what is on screen, what was expected, and 2–3 options to proceed.

Check before retrying: CAPTCHA/bot challenge (STOP — never solve), login wall/expired
session (STOP — user logs in), modal/cookie banner blocking (handle first), element
re-rendered (re-snapshot), wrong tab (re-list tabs).

## 9. Route guard (the manual/autonomous boundary)

Work on the user's **authenticated real-Chrome session** (their logged-in accounts —
posting, sending, buying, tokens) belongs to `/chrome-cdp-control` with its per-write
confirmation gate. `/full-qa`'s autonomous mode is for **test environments only** and
must refuse authenticated-session cases and re-route them. No autonomous write path
on an authenticated session, ever.

---
_Part of the build-it plugin · authored by [DevOtts](https://github.com/DevOtts)._
