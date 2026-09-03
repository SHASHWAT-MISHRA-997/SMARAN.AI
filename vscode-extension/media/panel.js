/* The panel's own script.
 *
 * It draws what the extension sends and nothing else - it has no idea where
 * any of it came from, which is why it is allowed to run at all under the
 * content security policy above it.
 *
 * Nothing is ever assigned through innerHTML. Everything below is text from a
 * model, a shell or a file, and all three are happy to contain a script tag.
 */

(function () {
    const vscode = acquireVsCodeApi();

    const $ = (id) => document.getElementById(id);
    const log = $('log');
    const history = $('history');
    const setup = $('setup');
    const composer = $('composer');
    const task = $('task');
    const attachments = $('attachments');
    const modeMenu = $('modeMenu');

    let modes = [];
    let currentMode = 'manual';

    // ── small builders ────────────────────────────────────────────────────

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(label, className, onClick) {
        const b = el('button', className, label);
        b.addEventListener('click', onClick);
        return b;
    }

    function scroll() {
        log.scrollTop = log.scrollHeight;
    }

    /** How long ago, in the shape a person reads at a glance. */
    function ago(ms) {
        const seconds = Math.max(1, Math.round((Date.now() - ms) / 1000));
        if (seconds < 60) return 'now';
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return minutes + 'm';
        const hours = Math.round(minutes / 60);
        if (hours < 24) return hours + 'h';
        return Math.round(hours / 24) + 'd';
    }

    // ── the conversation ──────────────────────────────────────────────────

    /** Code fences become blocks with a copy button; the rest stays text. */
    function renderBody(container, text) {
        const parts = String(text).split(/```/);
        parts.forEach((part, index) => {
            if (!part) return;
            if (index % 2 === 1) {
                const firstBreak = part.indexOf('\n');
                const code = firstBreak >= 0 ? part.slice(firstBreak + 1) : part;
                const block = el('div', 'code');
                const pre = el('pre', null, code.replace(/\n$/, ''));
                const copy = button('Copy', 'tiny', () => {
                    navigator.clipboard.writeText(code).then(() => {
                        copy.textContent = 'Copied';
                        setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
                    });
                });
                block.appendChild(copy);
                block.appendChild(pre);
                container.appendChild(block);
            } else {
                container.appendChild(el('pre', 'prose', part.replace(/^\n|\n$/g, '')));
            }
        });
    }

    /** The transient "thinking" row, so the next entry can replace it. */
    let thinkingRow = null;

    function addEntry(entry) {
        // Whatever arrives next is the answer to the wait, so the wait goes.
        if (thinkingRow && entry.kind !== 'thinking') {
            thinkingRow.remove();
            thinkingRow = null;
        }

        const item = el('div', 'item ' + entry.kind);

        if (entry.title) {
            const head = el('div', 'title');
            head.appendChild(el('span', null, entry.title));

            // A step that touched a file gets a way straight to that file.
            const match = /^Step \d+ · (write_file|edit_file|read_file)$/.exec(entry.title);
            if (match && entry.body) {
                const named = /(?:^|\n)path: (.+)/.exec(entry.body);
                if (named) {
                    head.appendChild(button('open', 'tiny', () =>
                        vscode.postMessage({ type: 'openFile', path: named[1].trim() })));
                }
            }
            item.appendChild(head);
        }

        if (entry.body) {
            if (entry.kind === 'result') {
                /* A result is folded to one line by default.
                 *
                 * "list_files" on a real project is two hundred paths, and
                 * printing all of it pushed the answer off the screen and made
                 * a run look like a wall of output rather than a sequence of
                 * steps. The whole thing is still here, one click away - it is
                 * hidden, not thrown away. */
                const lines = String(entry.body).split(String.fromCharCode(10));
                const size = entry.body.length < 1024
                    ? entry.body.length + ' characters'
                    : Math.round(entry.body.length / 1024) + ' KB';
                const summary = lines.length > 1
                    ? lines.length + ' lines · ' + size
                    : size;

                const fold = el('div', 'fold');
                const pre = el('pre', null, entry.body);
                pre.hidden = true;
                const toggle = button('▸ ' + summary, 'tiny', () => {
                    pre.hidden = !pre.hidden;
                    toggle.textContent = (pre.hidden ? '▸ ' : '▾ ') + summary;
                    if (!pre.hidden) scroll();
                });
                fold.appendChild(toggle);
                fold.appendChild(pre);
                item.appendChild(fold);
            } else if (entry.kind === 'tool') {
                item.appendChild(el('pre', null, entry.body));
            } else {
                renderBody(item, entry.body);
            }
        }

        const said = statusFor(entry);
        if (said) setStatus(said);

        log.appendChild(item);
        if (entry.kind === 'thinking') {
            thinkingRow = item;
            /* Counted, so it is visibly alive.
             *
             * A line that says "thinking" and then does not change for forty
             * seconds is indistinguishable from one that has stopped. The
             * seconds are the difference between waiting and wondering. */
            const started = Date.now();
            const label = item.querySelector('.title span');
            const base = label ? label.textContent : '';
            const tick = setInterval(() => {
                if (!item.isConnected) { clearInterval(tick); return; }
                const seconds = Math.round((Date.now() - started) / 1000);
                if (label) label.textContent = `${base}  ${seconds}s`;
            }, 1000);
        }
        scroll();
        return item;
    }

    /* The pinned strip: one line saying what is happening now. */
    const statusBar = $('status');
    const statusText = $('statusText');
    const statusTime = $('statusTime');
    let statusSince = 0;
    let statusTicker = null;

    function setStatus(text) {
        if (!text) {
            statusBar.hidden = true;
            if (statusTicker) { clearInterval(statusTicker); statusTicker = null; }
            return;
        }
        statusText.textContent = text;
        statusBar.hidden = false;
        statusSince = Date.now();
        statusTime.textContent = '0s';
        if (statusTicker) clearInterval(statusTicker);
        statusTicker = setInterval(() => {
            statusTime.textContent = Math.round((Date.now() - statusSince) / 1000) + 's';
        }, 1000);
    }

    /** What an entry means, in the words the strip should show. */
    function statusFor(entry) {
        if (entry.kind === 'thinking') return entry.title || 'Thinking…';
        if (entry.kind === 'tool') return 'Running ' + (entry.title || 'a tool');
        if (entry.kind === 'result') return 'Reading the result';
        if (entry.kind === 'says') return 'Writing an answer';
        return null;
    }

    function busy(on) {
        $('send').disabled = on;
        $('stop').hidden = !on;
        $('attach').disabled = on;
        $('beam').hidden = !on;
        // The strip belongs to a run, and goes when the run does.
        if (!on) setStatus('');
    }

    // ── screens ───────────────────────────────────────────────────────────

    function show(which) {
        log.hidden = which !== 'chat';
        history.hidden = which !== 'history';
        setup.hidden = which !== 'setup';
        composer.hidden = which !== 'chat';
        if (which === 'history') vscode.postMessage({ type: 'listSessions' });
        if (which === 'setup') vscode.postMessage({ type: 'setup' });
    }

    $('tabHistory').addEventListener('click', () =>
        show(history.hidden ? 'history' : 'chat'));
    $('tabSetup').addEventListener('click', () =>
        show(setup.hidden ? 'setup' : 'chat'));
    $('newSession').addEventListener('click', () => {
        vscode.postMessage({ type: 'newSession' });
        show('chat');
    });

    // ── sending ───────────────────────────────────────────────────────────

    function send() {
        const text = task.value.trim();
        if (!text) return;
        task.value = '';
        show('chat');
        // Drawn by the extension, not here. Drawing it locally left the
        // question out of the saved transcript, so reopening a past
        // conversation showed the answers with nothing they were answering.
        vscode.postMessage({ type: 'task', text });
    }

    $('send').addEventListener('click', send);
    $('stop').addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
    $('attach').addEventListener('click', () => vscode.postMessage({ type: 'attach' }));

    /* An image on the clipboard.
     *
     * Pasting a screenshot did nothing at all, silently. It still cannot be
     * sent - every route out of here is a chat completion carrying text, and
     * the attachments are file paths the agent reads from disk - so the
     * honest thing is to say that rather than to swallow the paste and let it
     * look broken. Text pastes are untouched. */
    /* A screenshot on the clipboard becomes an attachment.
     *
     * It used to do nothing at all, and then it explained why it could do
     * nothing. Now it is sent: the four provider shapes for an image are all
     * handled, so whether it can be read depends on the model rather than on
     * this panel. A model without eyes will say so in its own words, which is
     * a better answer than a refusal written here. */
    task.addEventListener('paste', (event) => {
        const items = [...(event.clipboardData?.items || [])];
        const image = items.find((item) => item.type.startsWith('image/'));
        if (!image) return;
        event.preventDefault();
        const file = image.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const url = String(reader.result || '');
            const comma = url.indexOf(',');
            if (comma < 0) return;
            vscode.postMessage({
                type: 'attachImage',
                name: file.name || `pasted-${Date.now()}.png`,
                mime: file.type || 'image/png',
                data: url.slice(comma + 1),
            });
        };
        reader.readAsDataURL(file);
    });

    task.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            send();
        }
    });

    // ── the mode menu ─────────────────────────────────────────────────────

    function drawModeMenu() {
        modeMenu.replaceChildren();
        modeMenu.appendChild(el('div', 'menu-title', 'How much it may do without asking'));
        modes.forEach((mode) => {
            const row = el('button', 'menu-item' + (mode.id === currentMode ? ' on' : ''));
            const line = el('div', 'menu-line');
            line.appendChild(el('strong', null, mode.label));
            if (mode.id === currentMode) line.appendChild(el('span', 'tick', '✓'));
            row.appendChild(line);
            row.appendChild(el('div', 'menu-note', mode.description));
            row.addEventListener('click', () => {
                currentMode = mode.id;
                $('modeChip').textContent = mode.label;
                modeMenu.hidden = true;
                vscode.postMessage({ type: 'setMode', mode: mode.id });
            });
            modeMenu.appendChild(row);
        });
    }

    $('modeChip').addEventListener('click', () => {
        drawModeMenu();
        modeMenu.hidden = !modeMenu.hidden;
    });
    /* The chip is the whole choice: provider and model, without leaving.
     *
     * It used to jump to Setup, which is where the key already is - so after
     * entering a key, clicking the model went back to the screen you had just
     * finished with, and looked like a loop. Then it opened a model list, but
     * only for whichever provider Setup was on, so changing provider still
     * meant the round trip. */
    $('modelChip').addEventListener('click', () => {
        if (!modeMenu.hidden) { modeMenu.hidden = true; return; }
        // The provider list and which keys are saved come with the setup
        // message. Without asking, the menu is empty until Setup is opened
        // once - which is the trip this exists to avoid.
        vscode.postMessage({ type: 'setup' });
        drawModelMenu();
        modeMenu.hidden = false;
    });

    /* The whole choice, from the chip.
     *
     * This listed models for whichever provider Setup happened to be on, so
     * moving from Groq to OpenRouter meant leaving the conversation, finding
     * Setup, choosing there and coming back. Both halves of the decision live
     * here now: which provider, and which of its models. Setup is for keys. */
    function drawModelMenu() {
        modeMenu.replaceChildren();

        const providers = (setupState?.providers || []);
        const configured = setupState?.configured || {};
        // Only ones you can actually use right now: the two local runners, and
        // any provider whose key is saved. Listing the rest would be a menu of
        // things that fail when picked.
        const usable = providers.filter((p) => p.local || !p.needsKey || configured[p.id]);

        if (usable.length > 1) {
            modeMenu.appendChild(el('div', 'menu-title', 'Where it runs'));
            usable.forEach((p) => {
                const row = el('button', 'menu-item' + (p.id === setupState?.provider ? ' on' : ''));
                const line = el('div', 'menu-line');
                line.appendChild(el('strong', null, p.label));
                if (p.free) line.appendChild(el('span', 'badge', 'free tier'));
                if (p.id === setupState?.provider) line.appendChild(el('span', 'tick', '✓'));
                row.appendChild(line);
                row.addEventListener('click', () => {
                    modeMenu.hidden = true;
                    // Picks a model for the new provider and lands on the chat.
                    vscode.postMessage({ type: 'chooseProvider', provider: p.id });
                });
                modeMenu.appendChild(row);
            });
        }

        const provider = providerOf(setupState?.provider);
        const mixed = provider && provider.free_models === 'some';

        const head = el('div', 'menu-title', 'Model');
        modeMenu.appendChild(head);

        if (mixed) {
            const seg = el('div', 'seg');
            const free = button('Free', 'tiny' + (freeOnly !== false ? ' seg-on' : ''), () => {
                freeOnly = true; drawModelMenu();
            });
            const all = button('All', 'tiny' + (freeOnly === false ? ' seg-on' : ''), () => {
                freeOnly = false; drawModelMenu();
            });
            seg.appendChild(free);
            seg.appendChild(all);
            modeMenu.appendChild(seg);
        }

        const shown = modelState.models
            .filter((m) => (!mixed || freeOnly === false) ? true : m.free)
            .slice(0, 60);

        if (!shown.length) {
            modeMenu.appendChild(el('div', 'menu-note',
                modelState.loading ? 'Loading…' : (modelState.error || 'No models to show.')));
        }

        shown.forEach((m) => {
            const row = el('button', 'menu-item' + (m.id === setupState?.model ? ' on' : ''));
            const line = el('div', 'menu-line');
            line.appendChild(el('strong', null, m.id));
            if (m.free) line.appendChild(el('span', 'badge', 'free'));
            if (m.id === setupState?.model) line.appendChild(el('span', 'tick', '✓'));
            row.appendChild(line);
            row.addEventListener('click', () => {
                modeMenu.hidden = true;
                vscode.postMessage({ type: 'chooseModel', model: m.id });
            });
            modeMenu.appendChild(row);
        });

        modeMenu.appendChild(button('Keys and more in Setup…', 'tiny', () => {
            modeMenu.hidden = true;
            show('setup');
        }));
    }

    /* Clicking away closes the menu - but not the chip that opens it.
     *
     * This named only the mode chip. The model chip's own handler opened the
     * menu, the same click then bubbled to here, the target was not the mode
     * chip, and the menu was hidden again in the same tick. So the model list
     * never appeared from the chip: you clicked it, saw a tooltip, and
     * nothing else. closest() rather than an identity check, because the
     * click usually lands on the text inside the button, not the button. */
    document.addEventListener('click', (event) => {
        const onAChip = event.target instanceof Element
            && event.target.closest('#modeChip, #modelChip');
        if (!modeMenu.hidden && !modeMenu.contains(event.target) && !onAChip) {
            modeMenu.hidden = true;
        }
    });

    // ── history screen ────────────────────────────────────────────────────

    function drawSessions(sessions) {
        history.replaceChildren();
        const head = el('div', 'screen-head');
        head.appendChild(el('h3', null, 'Past conversations'));
        if (sessions.length) {
            /* Asked by the editor, not by confirm().
             *
             * window.confirm does not exist in a webview - it is blocked, and
             * the call simply returns - so the branch below it never ran and
             * Clear all did nothing at all. The extension asks with a real
             * dialog, where an answer actually comes back. */
            head.appendChild(button('Clear all', 'tiny', () => {
                vscode.postMessage({ type: 'clearSessions' });
            }));
        }
        history.appendChild(head);

        if (!sessions.length) {
            history.appendChild(el('p', 'empty',
                'Nothing yet. Conversations are saved per project, on this machine only.'));
            return;
        }

        sessions.forEach((session) => {
            const row = el('div', 'session');
            const open = button(session.title, 'session-open', () => {
                vscode.postMessage({ type: 'openSession', id: session.id });
                show('chat');
            });
            const meta = el('span', 'session-meta', ago(session.updatedAt));
            const remove = button('×', 'tiny', () =>
                vscode.postMessage({ type: 'deleteSession', id: session.id }));
            row.appendChild(open);
            row.appendChild(meta);
            row.appendChild(remove);
            history.appendChild(row);
        });
    }

    // ── setup screen ──────────────────────────────────────────────────────

    let setupState = null;

    /* What has been typed into each key field but not saved yet.
     *
     * The whole Setup screen is rebuilt whenever anything changes - picking a
     * provider, choosing a model, saving a key - and a rebuild replaces every
     * input, taking its contents with it. So a key pasted before selecting the
     * provider simply vanished, and pressing Save on the emptied field stored
     * nothing. Held out here, the text survives the redraw. */
    const drafts = {};

    /** The provider whose key was just saved, so the panel can say so once. */
    let savedJust = null;

    /** Rows where the key box has been asked for, to replace one. */
    const replacingKey = {};

    function drawSetup() {
        if (!setupState) return;
        const { providers, configured, provider } = setupState;
        setup.replaceChildren();

        /* A way back. Setup was a dead end - the only route to the
           conversation was the New button, which throws the conversation
           away to get there. */
        const top = el('div', 'screen-head');
        top.appendChild(el('h3', null, 'Where the model runs'));
        top.appendChild(button('Done', 'tiny', () => show('chat')));
        setup.appendChild(top);
        providers.forEach((p) => {
            const row = el('div', 'provider' + (p.id === provider ? ' on' : ''));

            const pick = button('', 'provider-pick', () =>
                vscode.postMessage({ type: 'chooseProvider', provider: p.id }));
            const line = el('div', 'menu-line');
            line.appendChild(el('strong', null, p.label));
            if (p.free) line.appendChild(el('span', 'badge', 'free tier'));
            if (p.local) {
                // What is in it, now, so somebody with both runners installed
                // can see which is running without selecting each in turn.
                const status = (setupState.localStatus || {})[p.id];
                const running = status && status !== 'not running';
                line.appendChild(el('span', running ? 'badge ok' : 'badge', status || 'on this machine'));
            }
            /* One badge, and it only ever means a key entered here. The
               extension used to fall back to the desktop app's key file, so
               a provider nobody had touched showed this. It does not any
               more: what this panel shows is what this panel has. */
            if (configured[p.id]) {
                line.appendChild(el('span', 'badge ok', savedJust === p.id ? 'key saved ✓' : 'key saved'));
            }
            if (p.free_models === 'none') line.appendChild(el('span', 'badge paid', 'paid only'));
            if (p.id === provider) line.appendChild(el('span', 'tick', '✓'));
            pick.appendChild(line);
            pick.appendChild(el('div', 'menu-note', p.hint));
            row.appendChild(pick);

            if (p.needsKey) {
                const keyRow = el('div', 'key-row');

                /* The box only exists when there is a key to enter.
                 *
                 * Once one is saved there is nothing to type: an empty field
                 * sitting under a KEY SAVED badge reads as the save not
                 * having taken, and it was the second thing reported about
                 * this row. Replacing a key is rare, so it asks first. */
                const replacing = replacingKey[p.id];
                const showBox = !configured[p.id] || replacing;

                if (showBox) {
                    const input = el('input');
                    input.type = 'password';
                    input.value = drafts[p.id] || '';
                    input.placeholder = 'Paste your API key';
                    input.addEventListener('input', () => { drafts[p.id] = input.value; });
                    keyRow.appendChild(input);

                    const save = button('Save', 'tiny', () => {
                        if (!input.value.trim()) {
                            save.textContent = 'Empty';
                            setTimeout(() => { save.textContent = 'Save'; }, 1200);
                            return;
                        }
                        vscode.postMessage({ type: 'saveKey', provider: p.id, key: input.value });
                        delete drafts[p.id];
                        delete replacingKey[p.id];
                        savedJust = p.id;
                    });
                    keyRow.appendChild(save);

                    if (replacing) {
                        keyRow.appendChild(button('Cancel', 'tiny', () => {
                            delete replacingKey[p.id];
                            delete drafts[p.id];
                            drawSetup();
                        }));
                    }
                } else {
                    keyRow.appendChild(button('Replace key', 'tiny', () => {
                        replacingKey[p.id] = true;
                        drawSetup();
                    }));
                }

                // Remove only where there is something here to remove. On a
                // borrowed key it deleted a keychain entry that does not
                // exist, the app's key was still found, and the badge came
                // straight back - a button that appeared to do nothing.
                if (configured[p.id] === 'own') {
                    keyRow.appendChild(button('Remove', 'tiny', () => {
                        delete drafts[p.id];
                        delete replacingKey[p.id];
                        vscode.postMessage({ type: 'saveKey', provider: p.id, key: '' });
                    }));
                }
                if (p.keyUrl) {
                    keyRow.appendChild(button('Get key', 'tiny link', () =>
                        vscode.postMessage({ type: 'openLink', url: p.keyUrl })));
                }
                row.appendChild(keyRow);
            } else if (p.setupUrl) {
                const note = el('div', 'key-row');
                note.appendChild(button(p.setupLabel || 'Get it', 'tiny link', () =>
                    vscode.postMessage({ type: 'openLink', url: p.setupUrl })));
                row.appendChild(note);
            }

            /* Each provider's own models, inside its own card.
               One shared list underneath meant that with both Ollama and LM
               Studio installed there was nothing to say which models belonged
               to which - you had to remember what you had selected. */
            if (p.id === provider) {
                const models = el('div', 'models');
                models.id = 'models';
                row.appendChild(models);
            }

            setup.appendChild(row);
        });

        drawModels();
        drawMcp();

    }

    /* MCP servers, and whether they actually started.
     *
     * A tool the agent cannot reach is worse than one it does not have, so a
     * server that failed is shown with the reason it gave rather than left
     * out of the list. Configuring them is a settings file, not a form here:
     * the record has to match what the desktop app stores, and a half-built
     * editor for it would be the thing that drifts. */
    function drawMcp() {
        const servers = setupState?.mcp || [];
        setup.appendChild(el('h3', null, 'MCP servers'));

        if (!servers.length) {
            setup.appendChild(el('p', 'foot',
                'None configured. Add them in Settings under smaran.mcpServers - '
                + 'each is a name and either a command to run or an https address. '
                + 'Their tools are always shown and waited on before they run.'));
            setup.appendChild(button('Open settings', 'tiny', () =>
                vscode.postMessage({ type: 'openMcpSettings' })));
            return;
        }

        servers.forEach((server) => {
            const row = el('div', 'provider' + (server.connected ? ' on' : ''));
            const line = el('div', 'menu-line');
            line.appendChild(el('strong', null, server.name));
            line.appendChild(el('span', server.connected ? 'badge ok' : 'badge paid',
                server.connected
                    ? server.tools.length + (server.tools.length === 1 ? ' tool' : ' tools')
                    : 'not started'));
            row.appendChild(line);
            row.appendChild(el('div', 'menu-note', server.target));
            if (server.problem) row.appendChild(el('div', 'pull-failed', server.problem));
            if (server.tools.length) {
                row.appendChild(el('div', 'menu-note', server.tools.join(', ')));
            }
            setup.appendChild(row);
        });

        setup.appendChild(button('Reconnect', 'tiny', () =>
            vscode.postMessage({ type: 'setup' })));
    }

    let modelState = { loading: false, models: [], error: null };
    let pullState = { model: '', percent: -1, status: '', busy: false, failed: false };
    /** null until a provider with mixed pricing is first shown. */
    let freeOnly = null;

    const providerOf = (id) => (setupState?.providers || []).find((p) => p.id === id);

    /** Whether the model list is open. Closed until you go looking for it. */
    let modelsOpen = false;

    function drawModels() {
        const holder = document.getElementById('models');
        if (!holder) return;
        holder.replaceChildren();

        /* The list was always open, under whichever provider was selected,
           and there was no way to put it away. It is a drawer now: shut until
           you want to change the model, which is not most of the time. */
        const head = el('div', 'models-head');
        head.appendChild(button(
            modelsOpen ? 'Hide models' : `Choose model${setupState.model ? ' · ' + setupState.model : ''}`,
            'tiny',
            () => { modelsOpen = !modelsOpen; drawModels(); },
        ));
        if (modelsOpen) {
            head.appendChild(button('Refresh', 'tiny', () =>
                vscode.postMessage({ type: 'refreshModels', provider: setupState.provider })));
        }
        holder.appendChild(head);
        if (!modelsOpen) {
            return;
        }

        /* Installing a model, for Ollama only.
           LM Studio's local server has no endpoint for fetching or deleting
           one - it speaks the chat API and nothing else - so the buttons are
           not offered where they cannot work. */
        if (setupState.provider === '') {
            const pull = el('div', 'pull-row');
            const name = el('input');
            name.type = 'text';
            // The exact tag, because that is what Ollama's API takes. It
            // publishes no search endpoint, so this cannot offer to look one
            // up - Browse opens the library where the tags are.
            name.placeholder = 'Exact tag from the library, e.g. qwen2.5-coder:7b';
            name.value = pullState.model && pullState.busy ? pullState.model : '';
            name.disabled = pullState.busy;
            pull.appendChild(name);
            const go = button(pullState.busy ? 'Installing…' : 'Install', 'tiny', () => {
                if (!name.value.trim() || pullState.busy) return;
                vscode.postMessage({ type: 'pullModel', model: name.value.trim() });
            });
            go.disabled = pullState.busy;
            pull.appendChild(go);
            pull.appendChild(button('Browse', 'tiny link', () =>
                vscode.postMessage({ type: 'openLink', url: 'https://ollama.com/library' })));
            holder.appendChild(pull);

            if (pullState.status) {
                // Ollama's own words are exact but not helpful on their own:
                // "pull model manifest: file does not exist" means the tag was
                // not found, which is worth saying in those words.
                const notFound = /manifest|not found|does not exist/i.test(pullState.status);
                const text = pullState.failed && notFound
                    ? `Ollama has no model tagged "${pullState.model}". Tags look like `
                      + 'qwen2.5-coder:7b or llama3.2:3b — open Browse and copy one.'
                    : pullState.percent >= 0
                        ? `${pullState.model}: ${pullState.percent}% — ${pullState.status}`
                        : `${pullState.model}: ${pullState.status}`;
                holder.appendChild(el('p', pullState.failed ? 'empty pull-failed' : 'empty', text));
            }
        }

        if (modelState.loading) {
            holder.appendChild(el('p', 'empty', 'Asking the provider what it has…'));
            return;
        }
        if (modelState.error) {
            holder.appendChild(el('p', 'empty', modelState.error));
            return;
        }
        if (!modelState.models.length) {
            holder.appendChild(el('p', 'empty', 'No models came back.'));
            return;
        }

        /* Free-only, and on by default where it means anything.
         *
         * OpenRouter returns 419 models and most of them are billed. Picking
         * one by name and finding out it costs money when the answer fails is
         * not a discovery anyone should have to make. Its API is the only one
         * that publishes per-model pricing, so this is the only place the
         * filter can be honest - the others are said in words instead. */
        const provider = providerOf(setupState.provider);
        const mixed = provider && provider.free_models === 'some';
        if (mixed && freeOnly === null) freeOnly = true;

        const note = el('p', 'empty');
        note.textContent =
            provider?.free_models === 'all'
                ? (provider.local
                    ? 'Runs on this machine. Nothing here costs anything.'
                    : 'This provider’s free tier covers everything listed, up to its quota.')
                : provider?.free_models === 'none'
                    ? 'Every model here is billed to your account. There is no free tier.'
                    : 'Mixed. Only the ones marked free cost nothing.';
        holder.appendChild(note);

        if (mixed) {
            /* Two buttons, one of them lit. A single button labelled with the
               current state reads as an action - press "Showing free only"
               and you get everything, which is the opposite of what it says. */
            const choice = el('div', 'seg');
            const pick = (label, wanted) => {
                const b = button(label, 'tiny' + (freeOnly === wanted ? ' seg-on' : ''), () => {
                    freeOnly = wanted;
                    drawModels();
                });
                choice.appendChild(b);
            };
            pick('Free', true);
            pick('All', false);
            holder.appendChild(choice);
        }

        const filter = el('input');
        filter.type = 'text';
        const shown = mixed && freeOnly
            ? modelState.models.filter((m) => m.free).length
            : modelState.models.length;
        filter.placeholder = 'Filter ' + shown + ' models…';
        holder.appendChild(filter);

        const list = el('div', 'model-list');
        holder.appendChild(list);

        const draw = () => {
            const needle = filter.value.toLowerCase();
            list.replaceChildren();
            modelState.models
                .filter((m) => (!mixed || !freeOnly) ? true : m.free)
                .filter((m) => !needle || m.id.toLowerCase().includes(needle))
                .slice(0, 200)
                .forEach((m) => {
                    const line = el('div', 'model-line');
                    /* Choosing is the last thing anyone came to Setup to do,
                       so it ends here rather than leaving you on the screen
                       you have finished with. */
                    const row = button('', 'model' + (m.id === setupState.model ? ' on' : ''), () => {
                        vscode.postMessage({ type: 'chooseModel', model: m.id });
                        show('chat');
                    });
                    row.appendChild(el('span', null, m.id));
                    if (m.free) row.appendChild(el('span', 'badge', 'free'));
                    if (m.id === setupState.model) row.appendChild(el('span', 'tick', '✓'));
                    line.appendChild(row);
                    if (setupState.provider === '') {
                        line.appendChild(button('Delete', 'tiny', (event) => {
                            event.stopPropagation();
                            vscode.postMessage({ type: 'deleteModel', model: m.id });
                        }));
                    }
                    list.appendChild(line);
                });
        };
        filter.addEventListener('input', draw);
        draw();
    }

    // ── from the extension ────────────────────────────────────────────────

    window.addEventListener('message', (event) => {
        const message = event.data;

        switch (message.type) {
            /* Setup finished by itself, having chosen something. Staying on
               Setup after that meant hunting for a way out through History or
               a new conversation. */
            case 'goChat':
                show('chat');
                break;

            case 'ready':
                $('folder').textContent = message.folderName || message.folder || 'No folder open';
                $('folder').title = message.folder || '';
                // "Ollama (on this machine) · qwen2.5-coder:3b" did not fit in
                // the composer and was cut mid-word. The model is the part
                // that changes; the full pair is on the tooltip.
                $('modelChip').textContent = message.model || 'choose a model';
                $('modelChip').title = message.model
                    ? `${message.provider || 'Local'} · ${message.model}`
                    : 'Pick where the model runs, and which one';
                modes = message.modes || [];
                currentMode = message.mode;
                const active = modes.find((m) => m.id === currentMode);
                $('modeChip').textContent = active ? active.label : 'Manual';
                if (message.problem) show('setup');
                break;

            case 'entry':
                addEntry(message.entry);
                break;

            case 'restore':
                log.replaceChildren();
                (message.entries || []).forEach(addEntry);
                break;

            case 'cleared':
                log.replaceChildren();
                break;

            case 'thinking':
                addEntry({ kind: 'note', title: 'Working out what to do…' });
                break;

            case 'started':
                busy(true);
                break;

            case 'finished':
                busy(false);
                break;

            case 'needsSetup':
                addEntry({
                    kind: 'error',
                    title: message.reason === 'no-key' ? 'That provider has no key yet'
                        : message.reason === 'no-model' ? 'No model to run on'
                        : 'No model chosen',
                    body: 'Open Setup and pick where the model runs.',
                });
                show('setup');
                break;

            case 'confirm': {
                // The run is paused until one of these is clicked. Nothing has
                // been written and no command has run.
                const item = addEntry({
                    kind: 'confirm',
                    title: 'Allow ' + message.name + '?',
                    body: [message.what, message.detail].filter(Boolean).join('\n'),
                });
                if (message.because) {
                    item.appendChild(el('div', 'risk', 'This ' + message.because + '.'));
                }
                const row = el('div', 'row');
                row.appendChild(button('Allow', null, () => {
                    row.replaceChildren(el('span', 'answered', 'Allowed'));
                    vscode.postMessage({ type: 'answer', allowed: true });
                }));
                row.appendChild(button('No', 'ghost', () => {
                    row.replaceChildren(el('span', 'answered', 'Declined'));
                    vscode.postMessage({ type: 'answer', allowed: false });
                }));
                item.appendChild(row);
                scroll();
                break;
            }

            case 'attachments': {
                /* A name was all a chip said, so an attached screenshot and an
                   attached file looked identical and neither showed whether it
                   had actually been read. */
                attachments.replaceChildren();
                const items = message.items
                    || (message.files || []).map((path) => ({ path, kind: 'text' }));
                items.forEach((item) => {
                    const chip = el('span', 'chip');
                    if (item.preview) {
                        const thumb = el('img', 'chip-thumb');
                        thumb.src = item.preview;
                        thumb.alt = '';
                        chip.appendChild(thumb);
                    }
                    chip.appendChild(el('span', null, item.path.split('/').pop() || item.path));
                    if (item.bytes) {
                        chip.appendChild(el('span', 'chip-size',
                            item.kind === 'image'
                                ? `${Math.max(1, Math.round(item.bytes / 1024))} KB image`
                                : `${item.bytes} chars${item.truncated ? ', trimmed' : ''}`));
                    }
                    chip.appendChild(button('×', 'tiny', () =>
                        vscode.postMessage({ type: 'unattach', path: item.path })));
                    attachments.appendChild(chip);
                });
                break;
            }

            case 'sessions':
                drawSessions(message.sessions || []);
                break;

            case 'setup':
                setupState = message;
                drawSetup();
                // The chip's menu may be open and waiting for exactly this.
                if (!modeMenu.hidden) drawModelMenu();
                break;

            case 'pull':
                pullState = {
                    model: message.model, percent: message.percent,
                    status: message.status, busy: message.busy, failed: Boolean(message.failed),
                };
                drawModels();
                if (!modeMenu.hidden) drawModelMenu();
                break;

            case 'models':
                modelState = {
                    loading: message.loading,
                    models: message.models || [],
                    error: message.error || null,
                };
                drawModels();
                break;
        }
    });

    vscode.postMessage({ type: 'hello' });
})();
