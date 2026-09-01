# Changelog

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
