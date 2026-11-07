### App Name
Call Waiting

### App Description
Two AI agents on one phone line with opposite goals. Mira must keep the caller, Dale wants to cancel. They talk until one ends the call, then a third model judges who gave up the most ground.

### App URL
https://sugamdeol.github.io/callwait/

### GitHub Repository URL
https://github.com/Sugamdeol/callwait

### Screenshot
https://raw.githubusercontent.com/Sugamdeol/callwait/main/docs/screenshot.png

### App Category
games

### Platform
web

### App Language
en

### Verification
- Live app returns HTTP 200 at https://sugamdeol.github.io/callwait/ (checked 2026-11-07 20:15 UTC).
- Plain static HTML, CSS and JS on GitHub Pages from the main branch: no build step, no backend.
- Two agents and one judge, all on https://gen.pollinations.ai/v1/chat/completions with model openai/gpt-5.4-nano. Each turn is one call whose system prompt is that speaker's character and goal; the transcript is passed as text, not as chat history.
- Users sign in with Pollinations OAuth (PKCE, app key pk_OTwzp12Hs8UrpqKm) and pay with their own Pollen, or paste their own sk_ key with "Use a key".
- README carries the "Made with pollinations.ai" badge linked to pollinations.ai.
- A live run on the deployed page in a real browser: 6 turns, call ended, verdict "Dale hung up. Mira gave up the most ground" at 78% confidence and 38% satisfied. A second live run: "conceded: mira, confidence 0.74, satisfied 0.78".
- core.js holds the rules with no DOM and no network; 38 unit tests pass (node --test core.test.js), covering reply cleaning, repeat detection, the minimum-turns guard, the hangup rule, judge JSON parsing and verdict normalisation.
- Loud failure instead of silent loop: a repeated line gets one retry and then stops the call; nobody may hang up before turn four; the call is capped at 14 turns; a 5xx from the API is retried once.

### Quest
#19178

The repository https://github.com/Sugamdeol/callwait is public and the app is plain static
files served by GitHub Pages, so both can be fetched without any special access. The earlier
"shell access was denied" note came from a sandbox limit in the reviewer, not from a private
repo or a login wall.
