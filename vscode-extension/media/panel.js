/* The panel's own script. Draws what the extension sends and nothing else -
   it has no idea where any of it came from, which is why it is allowed to run
   at all under the content security policy above it. */

(function () {
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');
    const task = document.getElementById('task');
    const send = document.getElementById('send');
    const stop = document.getElementById('stop');
    const reset = document.getElementById('reset');
    const folder = document.getElementById('folder');
    const model = document.getElementById('model');

    /** Appending, never innerHTML: everything below is text from a model or a
        shell, and one of those is happy to emit a script tag. */
    function add(kind, title, body) {
        const item = document.createElement('div');
        item.className = 'item ' + kind;
        if (title) {
            const head = document.createElement('div');
            head.className = 'title';
            head.textContent = title;
            item.appendChild(head);
        }
        if (body) {
            const pre = document.createElement('pre');
            pre.textContent = body;
            item.appendChild(pre);
        }
        log.appendChild(item);
        log.scrollTop = log.scrollHeight;
        return item;
    }

    function busy(on) {
        send.disabled = on;
        stop.hidden = !on;
    }

    send.addEventListener('click', () => {
        const text = task.value.trim();
        if (!text) return;
        add('you', 'You', text);
        task.value = '';
        vscode.postMessage({ type: 'task', text });
    });

    task.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            send.click();
        }
    });

    stop.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
    reset.addEventListener('click', () => vscode.postMessage({ type: 'reset' }));

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'ready':
                folder.textContent = message.folder || 'No folder open';
                model.textContent = message.model || '';
                if (message.problem) {
                    add('error', 'No model to run on yet', message.problem);
                }
                break;

            case 'echo':
                add('you', 'You', message.text);
                break;

            case 'thinking':
                add('note', message.text, '');
                break;

            case 'plan': {
                const item = add('plan', 'It intends to', message.text);
                const row = document.createElement('div');
                row.className = 'row';
                const go = document.createElement('button');
                go.textContent = 'Do it';
                go.addEventListener('click', () => {
                    row.remove();
                    vscode.postMessage({ type: 'approve', text: message.task });
                });
                const no = document.createElement('button');
                no.className = 'ghost';
                no.textContent = 'No';
                no.addEventListener('click', () => {
                    row.remove();
                    add('note', 'Left alone. Nothing was changed.', '');
                });
                row.appendChild(go);
                row.appendChild(no);
                item.appendChild(row);
                log.scrollTop = log.scrollHeight;
                break;
            }

            case 'started':
                busy(true);
                break;

            case 'workspace':
                add('note', 'Working in ' + message.root, '');
                break;

            case 'message':
                add('says', '', message.text);
                break;

            case 'tool_call': {
                const args = (message.args || [])
                    .map((pair) => pair[0] + ': ' + pair[1])
                    .join('\n');
                add('tool', 'Step ' + message.step + ' · ' + message.name, args);
                break;
            }

            case 'tool_result':
                add('result', '', message.result);
                break;

            case 'done': {
                const ran = (message.tools_used || []);
                add('done', 'Finished in ' + message.steps + ' steps',
                    ran.length
                        ? 'Tools that actually ran: ' + ran.join(', ')
                        : 'No tools ran — nothing on disk was changed.');
                break;
            }

            case 'stopped':
                add('note', 'Stopped. What it had already done is done.', '');
                break;

            case 'error':
                add('error', 'Stopped', message.text);
                break;

            case 'finished':
                busy(false);
                break;

            case 'cleared':
                log.replaceChildren();
                break;
        }
    });
})();
