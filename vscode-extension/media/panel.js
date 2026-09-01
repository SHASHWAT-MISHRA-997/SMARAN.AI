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
        addEntry({ kind: 'you', title: 'You', body: text });
        task.value = '';
        show('chat');
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

    function drawSetup() {
        if (!setupState) return;
        const { providers, configured, provider, model } = setupState;
        setup.replaceChildren();

        setup.appendChild(el('h3', null, 'Where the model runs'));
        providers.forEach((p) => {
            const row = el('div', 'provider' + (p.id === provider ? ' on' : ''));

            const pick = button('', 'provider-pick', () =>
                vscode.postMessage({ type: 'chooseProvider', provider: p.id }));
            const line = el('div', 'menu-line');
            line.appendChild(el('strong', null, p.label));
            if (p.free) line.appendChild(el('span', 'badge', 'free tier'));
            if (configured[p.id]) line.appendChild(el('span', 'badge ok', 'key saved'));
            if (p.id === provider) line.appendChild(el('span', 'tick', '✓'));
            pick.appendChild(line);
            pick.appendChild(el('div', 'menu-note', p.hint));
            row.appendChild(pick);

            if (p.id) {
                const keyRow = el('div', 'key-row');
                const input = el('input');
                input.type = 'password';
                input.placeholder = configured[p.id] ? 'A key is saved. Type to replace it.' : 'Paste your API key';
                keyRow.appendChild(input);
                keyRow.appendChild(button('Save', 'tiny', () => {
                    vscode.postMessage({ type: 'saveKey', provider: p.id, key: input.value });
                    input.value = '';
                }));
                if (configured[p.id]) {
                    keyRow.appendChild(button('Remove', 'tiny', () =>
                        vscode.postMessage({ type: 'saveKey', provider: p.id, key: '' })));
                }
                if (p.keyUrl) {
                    keyRow.appendChild(button('Get key', 'tiny link', () =>
                        vscode.postMessage({ type: 'openLink', url: p.keyUrl })));
                }
                row.appendChild(keyRow);
            } else {
                const note = el('div', 'key-row');
                note.appendChild(button('Get Ollama', 'tiny link', () =>
                    vscode.postMessage({ type: 'openLink', url: 'https://ollama.com' })));
                row.appendChild(note);
            }

            setup.appendChild(row);
        });

        setup.appendChild(el('h3', null, 'Model'));
        const models = el('div', 'models');
        models.id = 'models';
        setup.appendChild(models);
        drawModels();

        setup.appendChild(el('p', 'foot',
            'Keys are kept in your operating system’s keychain, not in settings.json, '
            + 'and are sent only to the provider you picked.'));
        setup.appendChild(el('p', 'foot', 'Chosen: ' + (model || 'nothing yet')));
    }

    let modelState = { loading: false, models: [], error: null };

    function drawModels() {
        const holder = document.getElementById('models');
        if (!holder) return;
        holder.replaceChildren();

        holder.appendChild(button('Refresh', 'tiny', () =>
            vscode.postMessage({ type: 'refreshModels', provider: setupState.provider })));

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
                    const row = button('', 'model' + (m.id === setupState.model ? ' on' : ''), () =>
                        vscode.postMessage({ type: 'chooseModel', model: m.id }));
                    row.appendChild(el('span', null, m.id));
                    if (m.free) row.appendChild(el('span', 'badge', 'free'));
                    if (m.id === setupState.model) row.appendChild(el('span', 'tick', '✓'));
                    list.appendChild(row);
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
                $('modelChip').textContent = message.model
                    ? (message.provider ? message.provider + ' · ' + message.model : message.model)
                    : 'choose a model';
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
