# SMARAN.AI Codex

A coding agent inside VS Code. You give it a task; it reads your project,
changes files, runs commands, reads what they printed, and keeps going until
the work is done — with every step on screen.

## What changed in 2.0.0

Version 1.5.0 was not an agent, and this is worth being plain about. It sent
your question, took the one reply, scanned it with two regular expressions for
a `create_file` or a `run_command`, did whatever matched, and stopped. The
model never found out whether the file was written, whether the command
failed, or whether the test it had just written passes. One guess, and nothing
to correct it if the guess was wrong.

2.0.0 is the other shape:

    ask the model
      -> it asks for a tool
      -> run the tool
      -> give it the result
      -> ask again

Because the result goes back, it can read a file, notice the function is not
where it assumed, search for it, edit the right place, run the tests, see one
fail, and fix it.

## What it can do

`list_files` · `read_file` · `write_file` · `edit_file` · `search` ·
`run_command` · `git`

Everything is confined to the folder you have open in VS Code. Paths are
resolved and checked to still be inside it, so `../` and a symlink pointing
out of the tree both fail as a message rather than as a file somewhere else on
your disk.

## Before it changes anything

By default it tells you what it intends to do and waits. Approve, and it
works; every step appears as it happens and **Stop** ends the run where it is.

Turn off `smaran.planFirst` if you would rather it started straight away.

## What it needs

**The SMARAN.AI app has to be running.** The agent lives in the app — that is
where the tools, the workspace boundary and the model routing are, and it is
the same agent the desktop app and the command line use. The extension finds
the app on its own, by reading the port it published.

**A model.** Either one installed locally through Ollama, or a provider key in
`smaran.apiKeys` with `smaran.provider` set.

## About the model

This matters more than any setting here. A small local model will follow the
loop and still lose track of what it has done — a three-billion-parameter
model, given a two-file task, wrote one file and reported that it had written
two. The loop cannot make up the difference.

Which is why the panel lists, at the end of every run, the tools that
**actually ran**. If the agent says it wrote three files and one write is
listed, you can see that without opening anything.

## Settings

| Setting | What it does |
| --- | --- |
| `smaran.backendUrl` | Where the app is. Empty finds it automatically. |
| `smaran.provider` | Which provider runs the agent. Empty means local Ollama. |
| `smaran.model` | Model name. Empty lets the app pick from what is installed. |
| `smaran.apiKeys` | Your keys. They go to your own machine's app, and from there to the provider you chose. |
| `smaran.planFirst` | Ask before acting. On by default. |

MIT licensed. Part of [SMARAN.AI](https://smaran-ai.netlify.app/).
