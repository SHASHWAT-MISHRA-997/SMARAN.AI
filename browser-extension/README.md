# SMARAN.AI for Chrome

Ask the assistant about the page you are on, and let it act on that page
where you allow it.

```
manifest.json    Manifest V3, with a fixed key so the extension id is stable
background.js    Service worker: finds the app, relays questions, holds permissions
sidepanel.*      The panel UI
icons/           16, 48 and 128px marks
```

## Installing it

It is not on the Chrome Web Store yet, so load it unpacked:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → choose this folder

The desktop app must be running: everything goes through the SMARAN.AI
backend on this machine, which is where the model routing and the provider
keys already live. Duplicating that here would mean two places to configure
and two places to get wrong.

## What it can do

**Reading a page** happens only when you ask a question with *Include the
page* ticked, and only for the tab you are looking at. The panel prints what
it took — the title, how many characters, how many links and fields — before
sending it, so nothing goes out that you cannot see.

**Acting on a page** — clicking, typing, scrolling — needs that site set to
**Allow**. The default is *Ask*, which reads but never acts. *Never* does
neither.

The extension asks for `activeTab` and `scripting` rather than `<all_urls>`.
That means Chrome grants access to a tab only when you invoke the extension
there, instead of it sitting on every page you visit.

## Why the id is pinned

`manifest.json` carries a `key`, which fixes the extension id to:

```
chhffklihgllkmhnjbpcljppdpgihpfm
```

The backend allows exactly that origin. The alternative — permitting every
`chrome-extension://` origin — would let any extension you have installed
call the API with your session attached, which is the hole that was closed
in the CORS work. A stable id is what makes a single-origin allowance
possible.

`extension-key.pem` is the private half. It is git-ignored and must not be
published: whoever holds it can build an extension Chrome treats as this one.

## Known limits

- **Chrome and Chromium only.** Firefox uses a different side-panel API and
  a different manifest dialect; neither is handled here.
- **No streaming.** The panel waits for the whole answer rather than showing
  it arrive. The backend streams, so this is worth changing.
- **Actions are deliberately few.** Click, type and scroll. Anything that
  navigates or submits on your behalf should be a decision taken with more
  care than a first version deserves.
