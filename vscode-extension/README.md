<div align="center">

# ⬢ SMARAN.AI CODEX

### `ask → run the tool → read the result → ask again`

**A coding agent in your sidebar.** You give it a task; it reads your project,
changes files, runs commands, reads what they printed, and keeps going until
the work is done — every step on screen, under a mode you choose.

Nothing else has to be installed and nothing has to be left running.
Bring an API key, or a model in Ollama, and that is the whole setup.

[![Agent](https://img.shields.io/badge/RUNS_A_REAL_LOOP-00E5FF?style=for-the-badge&labelColor=04060f)](#the-four-modes)
[![Local or cloud](https://img.shields.io/badge/OLLAMA_OR_YOUR_KEY-FF2D95?style=for-the-badge&labelColor=04060f)](#where-the-model-comes-from)
[![License](https://img.shields.io/badge/MIT-8B5CF6?style=for-the-badge&label=LICENSE&labelColor=04060f)](https://github.com/SHASHWAT-MISHRA-997/SMARAN.AI/blob/main/LICENSE)

<br>

**Built by Shashwat Mishra**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white&labelColor=0A66C2)](https://www.linkedin.com/in/sm980/)
[![YouTube](https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white&labelColor=FF0000)](https://www.youtube.com/@ShashwatMishra-997)

</div>

---

## The four modes

The mode decides how much it may do without asking. It is enforced where the
tool would run, not asked of the model — in Plan mode the tools that change
things refuse, whatever the model tries.

| Mode | What happens |
| --- | --- |
| **Plan** | Explores the real code and tells you what it would do. Changes nothing at all. |
| **Manual** | Asks before every change and every command. |
| **Edit automatically** | Changes files on its own. Still asks before running a command. |
| **Auto** | Works on its own, and pauses for anything that looks risky. |

Reading is never gated — listing, reading and searching change nothing, and a
confirmation on each one only teaches people to click through confirmations.

"Risky" is a short list of things that are hard to undo: deleting recursively,
force-pushing over published history, piping a download into a shell,
overwriting a disk, publishing a package. It is not a sandbox, and this does
not pretend it is one. A shell is a shell.

## What it can do

`list_files` · `read_file` · `write_file` · `edit_file` · `search` ·
`run_command` · `git`

Everything is confined to the folder you have open. Paths are resolved and
then checked to still be inside it, so `../` and a symlink pointing out of the
tree both fail as a message rather than as a file somewhere else on your disk.

## In the panel

* **Setup** — pick a provider, paste a key, and choose from the models that
  provider actually has. The list is fetched from the provider, never
  hardcoded: two models this was tested against were retired within a day of
  each other, and a typed-in list would still be offering them.
* **Ollama models, installed and removed from here.** Type a name, watch it
  download, delete one you are done with. Ollama only — LM Studio's local
  server has no endpoint for either, so the buttons are not offered there.
  Both runners are listed with what each one currently has, so if you have
  both you can see which is running without picking one to find out.
* **History** — every conversation, saved per project, on your machine.
  Reopen one and carry on where it stopped.
* **Attach** — pull in a file. One inside the project is named for the agent
  to read; one from outside is included, because no tool can reach it.
* **Every step, with its result.** Not a summary — the command that ran and
  what it printed. If it goes wrong, you can see the step it went wrong on.
* **The tools that actually ran**, listed at the end beside the agent's own
  account of what it did. A small model will write one file and report three.

## Where the model comes from

**Ollama, on your machine.** `ollama pull qwen2.5-coder:7b`, leave the
provider empty. Nothing leaves the computer.

**Or a provider key.** Groq, Google Gemini, OpenRouter and NVIDIA all have
free tiers; Anthropic, OpenAI and DeepSeek are paid. Paste it into Setup — it
goes into your operating system's keychain, not settings.json, and is sent to
that provider and nowhere else. There is no server of ours in between.

If you happen to have the SMARAN.AI desktop app installed, keys you entered
there are picked up so you do not type them twice. It never has to be running.

## About the model

This matters more than any setting here. A small local model will follow the
loop and still lose track of what it has done — a three-billion-parameter
model, given a two-file task, wrote one file and reported that it had written
two. The loop cannot make up that difference, and this extension will not
pretend otherwise. A 7B coding model is a reasonable floor; the free tiers
above are better.

## Commands

`SMARAN.AI: Open Console` · `Give the agent a task` · `Switch mode`

And in the editor's right-click menu: explain, refactor, write tests, fix the
problems in this file. Each writes a sentence and hands it to the same agent —
"write tests for this file" writes them, runs them, and fixes what fails.

## Settings

| Setting | What it does |
| --- | --- |
| `smaran.mode` | How much it may do without asking. Also in the panel. |
| `smaran.provider` | Which provider runs the agent. Empty means local Ollama. |
| `smaran.model` | Model name. Chosen from the Setup tab. |
| `smaran.ollamaUrl` | Where Ollama is. Only used when no provider is set. |

---

<div align="center">

### Made by Shashwat Mishra

[![LinkedIn](https://img.shields.io/badge/Connect_on_LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white&labelColor=0A66C2)](https://www.linkedin.com/in/sm980/)
[![YouTube](https://img.shields.io/badge/Watch_on_YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white&labelColor=FF0000)](https://www.youtube.com/@ShashwatMishra-997)

**MIT licensed.** Part of [SMARAN.AI](https://smaran-ai.netlify.app/).

</div>
