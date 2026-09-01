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

    function addEntry(entry) {
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
            if (entry.kind === 'result' || entry.kind === 'tool') {
                item.appendChild(el('pre', null, entry.body));
            } else {
                renderBody(item, entry.body);
            }
        }

        log.appendChild(item);
        scroll();
        return item;
    }

    function busy(on) {
        $('send').disabled = on;
        $('stop').hidden = !on;
        $('attach').disabled = on;
        $('beam').hidden = !on;
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
    $('modelChip').addEventListener('click', () => show('setup'));

    document.addEventListener('click', (event) => {
        if (!modeMenu.hidden && !modeMenu.contains(event.target) && event.target !== $('modeChip')) {
            modeMenu.hidden = true;
        }
    });

    // ── history screen ────────────────────────────────────────────────────

    function drawSessions(sessions) {
        history.replaceChildren();
        const head = el('div', 'screen-head');
        head.appendChild(el('h3', null, 'Past conversations'));
        if (sessions.length) {
            head.appendChild(button('Clear all', 'tiny', () => {
                if (confirm('Delete every saved conversation for this project?')) {
                    vscode.postMessage({ type: 'clearSessions' });
                }
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

    function drawSetup() {
        if (!setupState) return;
        const { providers, configured, provider, model } = setupState;
        setup.replaceChildren();

        /* Model first. It was underneath eight provider cards, so choosing one
           - the thing people come here to do most often - meant scrolling past
           everything else to find it. */
        setup.appendChild(el('h3', null, 'Model'));
        const models = el('div', 'models');
        models.id = 'models';
        setup.appendChild(models);
        drawModels();

        setup.appendChild(el('h3', null, 'Where the model runs'));
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
            if (configured[p.id]) line.appendChild(el('span', 'badge ok', 'key saved'));
            // Said once, right after saving, because a badge that was already
            // there does not tell you the press worked.
            if (savedJust === p.id) line.appendChild(el('span', 'badge ok', 'saved'));
            if (p.id === provider) line.appendChild(el('span', 'tick', '✓'));
            pick.appendChild(line);
            pick.appendChild(el('div', 'menu-note', p.hint));
            row.appendChild(pick);

            if (p.needsKey) {
                const keyRow = el('div', 'key-row');
                const input = el('input');
                input.type = 'password';
                input.value = drafts[p.id] || '';
                input.placeholder = configured[p.id] ? 'A key is saved. Type to replace it.' : 'Paste your API key';
                input.addEventListener('input', () => { drafts[p.id] = input.value; });
                keyRow.appendChild(input);

                // A password field hides what was pasted, so a key that went in
                // wrong looks the same as one that went in right.
                const reveal = button('Show', 'tiny', () => {
                    const hidden = input.type === 'password';
                    input.type = hidden ? 'text' : 'password';
                    reveal.textContent = hidden ? 'Hide' : 'Show';
                });
                keyRow.appendChild(reveal);

                const save = button('Save', 'tiny', () => {
                    if (!input.value.trim()) {
                        save.textContent = 'Empty';
                        setTimeout(() => { save.textContent = 'Save'; }, 1200);
                        return;
                    }
                    vscode.postMessage({ type: 'saveKey', provider: p.id, key: input.value });
                    delete drafts[p.id];
                    savedJust = p.id;
                });
                keyRow.appendChild(save);

                if (configured[p.id]) {
                    keyRow.appendChild(button('Remove', 'tiny', () => {
                        delete drafts[p.id];
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

            setup.appendChild(row);
        });

        setup.appendChild(el('p', 'foot',
            'Keys are kept in your operating system’s keychain, not in settings.json, '
            + 'and are sent only to the provider you picked.'));
        setup.appendChild(el('p', 'foot', 'Chosen: ' + (model || 'nothing yet')));
    }

    let modelState = { loading: false, models: [], error: null };
    let pullState = { model: '', percent: -1, status: '', busy: false, failed: false };

    function drawModels() {
        const holder = document.getElementById('models');
        if (!holder) return;
        holder.replaceChildren();

        holder.appendChild(button('Refresh', 'tiny', () =>
            vscode.postMessage({ type: 'refreshModels', provider: setupState.provider })));

        /* Installing a model, for Ollama only.
           LM Studio's local server has no endpoint for fetching or deleting
           one - it speaks the chat API and nothing else - so the buttons are
           not offered where they cannot work. */
        if (setupState.provider === '') {
            const pull = el('div', 'pull-row');
            const name = el('input');
            name.type = 'text';
            name.placeholder = 'Install a model, e.g. qwen2.5-coder:7b';
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
                const line = el('p', pullState.failed ? 'empty pull-failed' : 'empty',
                    pullState.percent >= 0
                        ? `${pullState.model}: ${pullState.percent}% — ${pullState.status}`
                        : `${pullState.model}: ${pullState.status}`);
                holder.appendChild(line);
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

        const filter = el('input');
        filter.type = 'text';
        filter.placeholder = 'Filter ' + modelState.models.length + ' models…';
        holder.appendChild(filter);

        const list = el('div', 'model-list');
        holder.appendChild(list);

        const draw = () => {
            const needle = filter.value.toLowerCase();
            list.replaceChildren();
            modelState.models
                .filter((m) => !needle || m.id.toLowerCase().includes(needle))
                .slice(0, 200)
                .forEach((m) => {
                    const line = el('div', 'model-line');
                    const row = button('', 'model' + (m.id === setupState.model ? ' on' : ''), () =>
                        vscode.postMessage({ type: 'chooseModel', model: m.id }));
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

            case 'attachments':
                attachments.replaceChildren();
                (message.files || []).forEach((file) => {
                    const chip = el('span', 'chip');
                    chip.appendChild(el('span', null, file));
                    chip.appendChild(button('×', 'tiny', () =>
                        vscode.postMessage({ type: 'unattach', path: file })));
                    attachments.appendChild(chip);
                });
                break;

            case 'sessions':
                drawSessions(message.sessions || []);
                break;

            case 'setup':
                setupState = message;
                drawSetup();
                break;

            case 'pull':
                pullState = {
                    model: message.model, percent: message.percent,
                    status: message.status, busy: message.busy, failed: Boolean(message.failed),
                };
                drawModels();
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
