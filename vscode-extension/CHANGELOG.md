# Changelog

## 2.18.0

**`<tool_calls>` no longer appears in the transcript.** Several models wrap
their call in a container and put the real call inside it. The parser found
the inner one, and everything before it was treated as something the model had
said - so the opening tag was printed at you, in the middle of a run that was
working perfectly. A line that is nothing but a tag is dropped now; a sentence
that mentions one is kept.

**An action is a line.** Every step was a bordered, blurred card headed
"Step 1 - LIST_FILES" with its arguments underneath: four lines of panel for
one word, and a run of twenty steps was twenty of them stacked down the
sidebar. Now it is the tool's own name and what it was given, on one line, in
the editor's code font. The step number is gone - it counted requests to the
model, which nobody was following.

**The mode menu says a third as much.** Seven options each carried a full
sentence, under two headings, under a three-sentence warning. Seventy-three
words of explanation for a control you touch rarely, now twenty-six, and the
warning is the one line it was actually about: a command can reach outside the
folder whatever the setting is.
## 2.17.0

**It can hand a question to a second agent.** The reason is the context
window, not cleverness. "Find where the login redirect is decided" means
reading twenty files to quote three lines - and done in the main conversation,
all twenty stay in it: every later step re-reads them, the actual task drifts,
and on a small model the window fills and the task falls out of it. What looks
like a model getting worse as a run goes on is usually it being asked to hold
a filing cabinet.

`delegate` runs a second agent in a conversation nobody keeps, with the same
tools and the same permissions, and hands back the answer with a note of which
files it looked at - not their contents, which would undo the point.

A delegate cannot delegate. The first attempt at that limit did not work:
"only the outermost run registers a handler" left the handler registered while
the sub-agent ran, so a sub-agent asked to delegate nested five levels deep
and was still going when its step budget stopped it. The handler is now
removed for the duration of a delegated run and put back afterwards, so the
nesting is one level and the main run can still delegate more than once.
## 2.16.0

**It can press things and fill them in.** Reading a page tells you it loaded;
half of what a page does only happens after somebody presses something. The
agent can now click and type, so it can submit the form, open the menu, and
read back what the page did about it.

Things are found by the words a person would read on them - `browser_click`
with "Save", not a CSS selector a model is guessing at. When nothing matches
it says so and lists what is actually on the page; when several match it
presses none of them and names them. An exact label wins over a partial one,
so "Sign in" does not become ambiguous just because "Sign in again" exists.

`browser_type` selects what is already in the field before typing, so it
replaces rather than appends, and can press Enter afterwards.

The click is a real mouse event at the element's position rather than
`element.click()`, so hover, focus and anything listening for a genuine press
behave as they would for a person.

Exercised against a real form: pressing Sign in with the field empty produced
"Name is required", typing a name and pressing it produced "Welcome,
Shashwat", and asking for a button that does not exist refused and listed the
ones that do.
## 2.15.0

**You can see what it changed.** An edit used to be reported as
`Wrote src/panel.ts (412 lines).` - which says a file was touched and nothing
about what happened to it. A one-character fix and a rewrite read identically,
and the only way to tell them apart was to open the file and compare it
against a version you no longer had.

Every write and every edit now comes back as a diff: the changed lines with a
few either side, `+3 -1` at the top, and the untouched middle collapsed to
`… 40 unchanged lines`. Added and removed rows are tinted in the editor's own
diff colours, so it matches a diff anywhere else in the window.

**And you can put it back.** Every change is kept with what was there before,
so *SMARAN.AI Codex: Undo the last file change* restores it - or deletes the
file, if the agent was the one that created it. It refuses when the file has
changed since the agent wrote it, because restoring an older version over your
own edit is worse than the change staying.

The diff is computed here rather than pulled in: the common start and end are
cut away first, so a one-line change in a long file stays cheap, and a rewrite
too large to line up honestly is summarised instead of freezing the panel.
## 2.14.0

**The agent can open a browser and read what the page says.** It could build
a web page and never once find out whether it worked: it wrote the code, said
it was done, and you opened the page and found it broken. What was missing was
not cleverness, it was eyes.

Three tools: `open_browser` opens a real Chrome or Edge window you can watch,
`browser_check` reports what the page says about itself, and `browser_reload`
does it again after a fix. What comes back is uncaught errors with the file and
line, console errors and warnings, requests that failed with their status, and
the text the page actually rendered.

Proven on a page built to be broken in three ways at once. It reported the
ReferenceError and where it was thrown, both console lines, and the 404 for a
missing image; after the fixes, the reload said there was nothing left.

It uses the Chrome DevTools Protocol, which is how Puppeteer and Playwright
work, so nothing is downloaded - the browser is already on the machine. It
opens its own empty profile rather than attaching to yours: your tabs, cookies
and logins are not in reach of a model.

It reads and does not click. Reading is what closes the loop between making a
change and knowing whether it worked, and reading cannot break anything.
## 2.6.0

**Install and remove Ollama models without leaving the panel.** Type a name,
watch it download, delete one you no longer want. Only Ollama: LM Studio's
local server speaks the chat API and nothing else — it has no endpoint for
fetching or deleting a model, so the buttons are not offered where they cannot
work.

**The model list is at the top of Setup**, not underneath eight provider
cards. Choosing a model is the thing people come here to do most often, and it
was the furthest thing to reach.

The model chip in the composer showed "Ollama (on this machine) · qwen2.5-…"
and was cut mid-word. It shows the model; the pair is on the tooltip.

## 2.5.0

**Your own message was missing from every saved conversation.** The panel drew
it and posted the task; nothing wrote it down. Reopening from History showed
the answers with no sign of what they were answering.

**Ollama and LM Studio are both listed, with what each one currently has** —
"3 models", "not running". Plenty of people have both installed, and until now
the list said the same thing about both either way.

## 2.4.0

**LM Studio.** No key; start its local server and whatever you have loaded
appears in the model list. `smaran.lmStudioUrl` if it is not on the default
port.

**Keys were being wiped as you typed them.** The Setup screen is rebuilt
whenever anything changes, and a rebuild replaced every input — so a key
pasted before selecting the provider vanished, and Save then stored nothing.
What you have typed now survives the redraw, there is a Show button because a
password field hides a bad paste, and saving says so.

Nothing suggests a particular model to install any more. Whatever you have in
Ollama is what the list offers.

## 2.3.0

**A look of its own.**

The panel used the editor's own colours, which made it correct and forgettable
— a grey box among grey boxes. It has its own now: neon on deep blue, glass
panels over a drifting wash of colour, a perspective grid, a slow scanline, and
a glow on whatever you are touching.

Every state has a colour that means something. Your message is violet, a tool
call is magenta, its output is dimmed because it is the longest thing on screen
and the least often read in full, a finished run is green, and anything waiting
for your approval is amber. A run in flight draws a light along the top, so
"is it doing anything" is never answered by watching for text to appear.

It is all CSS. There is no canvas and no timer — a panel that sits open all day
should not spend a core on its own wallpaper — and every animation stops when
your operating system says you do not want motion.

## 2.2.0

**A panel you can actually use, and four modes that are real.**

2.1.0 had one text box. Everything else — which provider, which key, which
model — was in `settings.json`, which is a fine place for a preference and a
poor place for the first five minutes of using something.

* **Modes: Plan, Manual, Edit automatically, Auto.** How much it may do
  without asking. Enforced where the tool would run, not asked of the model:
  in Plan mode the tools that change things refuse, whatever the model tries.
  Auto pauses for the handful of things that are hard to undo — deleting
  recursively, force-pushing, piping a download into a shell.
* **Setup, in the panel.** Eight providers, a field for each key, and a model
  list fetched from the provider you picked — 420 from OpenRouter with the
  free ones marked, 38 from Google, 82 from NVIDIA. Coding models sort first.
* **Keys moved to the OS keychain.** `smaran.apiKeys` put them in a plain text
  file that Settings Sync copies to every machine you sign in on. Anything
  already there is moved across once and the setting is emptied.
* **History.** Every conversation, saved per project, reopenable.
* **Attach a file.** One inside the project is named for the agent to read;
  one from outside is included, because no tool can reach it.
* **Approval is a real pause.** The run stops on the question. Nothing is
  written and no command runs until you answer.
* Code blocks with a copy button, a link straight to any file a step touched,
  and the folder always in view.

`smaran.planFirst` is replaced by `smaran.mode`.

## 2.1.0

**It no longer needs anything else installed or open.**

2.0.0 put the agent in the SMARAN.AI desktop app and had the extension call
it. That made a 266 MB install, left running, the price of using this in the
editor — the wrong trade for something most people will try before they have
ever heard of the app. If the app was not running, the panel said so and
stopped, which was the feature working exactly as designed and still being the
wrong answer.

The agent runs in the extension now. All you need is a model:

* one in [Ollama](https://ollama.com) on your machine — nothing leaves it; or
* a provider key. Groq, Google Gemini, OpenRouter and NVIDIA all have free
  tiers.

Your key goes straight to the provider. There is no server of ours in between.

Keys already entered in the SMARAN.AI app are picked up if it happens to be
installed, so you do not type them twice — but it never has to be running.

`smaran.backendUrl` is gone; `smaran.ollamaUrl` replaces it.

## 2.0.0

**A rewrite, because 1.5.0 was not an agent.**

It sent your question, took the one reply, scanned it with two regular
expressions for a `create_file` or a `run_command`, did whatever matched, and
stopped. The model never found out whether the file was written, whether the
command failed, or whether the test it had just written passes. One guess, and
nothing to correct it if the guess was wrong. No API key or prompt could fix
that — the shape was wrong, not the model.

2.0.0 runs the loop: ask, run the tool, feed the result back, ask again. So it
can read a file, notice the function is not where it assumed, search for it,
edit the right place, run the tests, see one fail, and fix it.

* Seven tools instead of two: `list_files`, `read_file`, `write_file`,
  `edit_file`, `search`, `run_command`, `git`.
* Everything is confined to the folder you have open. Paths are resolved and
  then checked to still be inside it, so `../` and a symlink pointing out of
  the tree both fail as a message.
* It says what it intends to do and waits, unless you turn `smaran.planFirst`
  off. Every step appears as it happens, and **Stop** ends a run where it is.
* Each run ends with the tools that **actually ran**. A small model will write
  one file and report that it wrote three; you should not have to take its
  word.
