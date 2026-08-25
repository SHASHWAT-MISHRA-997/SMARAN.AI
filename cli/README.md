# SMARAN.AI on the command line

Ask the assistant from a terminal, without opening the window.

```
smaran status            Is the app running, and as whom
smaran models            What the model hub holds, and what is downloaded
smaran ask "..."         One question, answer streamed back
smaran chat              Keep asking, in one conversation
```

## Installing it

```
pip install -e cli
```

That puts a `smaran` command on your PATH. There are no dependencies — it
speaks HTTP to the local app using the standard library, so it cannot drag
anything else into your environment or need a compiler.

## It needs the app running

This is a client, not a second copy of SMARAN.AI. The model routing, the
provider keys and the conversation history live in the desktop app; duplicating
them here would mean two places to configure and two places to get wrong.

The app publishes the port it actually bound to in `runtime.json`, which is
read first — it does not always get 3003, and guessing would break on the day
something else took that port. A `runtime.json` left behind by a crash names a
port nobody is listening on, so the recorded process id is checked before the
file is believed.

To point it somewhere else:

```
SMARAN_URL=http://127.0.0.1:8080 smaran status
```

## Why it does not ask you to log in

Requests go to 127.0.0.1. The backend treats a caller on the loopback interface
as the local user, so there is no password to enter and no token to store. The
same property is the reason this cannot reach anyone else's machine: there is
no remote mode, and adding one would mean exposing the app to the network.

## Known limits

- **The answer is not Markdown-rendered.** Fenced code arrives as the model
  wrote it, backticks and all.
- **`--model` is passed straight through.** A name the app does not know is
  refused by the app, not caught here.
- **No file or image input yet.** The app takes both; this does not.
- **Colour is dropped when piped.** Escape codes only appear when stderr is a
  terminal, so `smaran ask ... > out.txt` gives clean text.
