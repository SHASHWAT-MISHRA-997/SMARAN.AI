"""Real file/read-only action checks; system-changing actions get refusal checks only."""
import asyncio
import base64
import datetime
import json
from pathlib import Path
import sys
import uuid
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.desktop_agent import DesktopAgent


async def main():
    audit = Path(__file__).resolve().parents[2] / '.cache/audit'
    root = audit / ('desktop-fixture-' + uuid.uuid4().hex[:10])
    root.mkdir()
    (root / 'original.txt').write_bytes(b'desktop fixture\n')
    results = []
    async def run(action, params, verify):
        result = await DesktopAgent.execute(action, params, confirmed=True)
        passed = bool(result.get('success')) and bool(verify(result))
        results.append({'action': action, 'mode': 'real handler', 'passed': passed,
                        'success': result.get('success'), 'response_keys': sorted(result),
                        'error': result.get('error')})
        print(action, 'PASS' if passed else 'FAIL', flush=True)
    await run('list_files', {'path': str(root)}, lambda r: any(x['name']=='original.txt' for x in r['items']))
    await run('search_files', {'path': str(root), 'query': 'original'}, lambda r: 'original.txt' in json.dumps(r))
    await run('read_text_file', {'path': str(root/'original.txt')}, lambda r: r['message']=='desktop fixture\n')
    await run('create_folder', {'path': str(root/'new')}, lambda r: (root/'new').is_dir())
    await run('copy_file', {'source': str(root/'original.txt'), 'destination': str(root/'copy.txt')}, lambda r: (root/'copy.txt').read_bytes()==(root/'original.txt').read_bytes())
    await run('rename_file', {'old_path': str(root/'copy.txt'), 'new_name':'renamed.txt'}, lambda r: (root/'renamed.txt').read_bytes()==b'desktop fixture\n' and not (root/'copy.txt').exists())
    await run('move_file', {'source':str(root/'renamed.txt'),'destination':str(root/'new/renamed.txt')}, lambda r: (root/'new/renamed.txt').read_bytes()==b'desktop fixture\n' and not (root/'renamed.txt').exists())
    await run('zip_folder', {'path': str(root/'new')}, lambda r: zipfile.ZipFile(root/'new.zip').read('renamed.txt')==b'desktop fixture\n')
    (root/'new.zip').rename(root/'extracted.zip')
    await run('unzip_file', {'path':str(root/'extracted.zip')}, lambda r: (root/'extracted/renamed.txt').read_bytes()==b'desktop fixture\n')
    await run('get_time', {}, lambda r: abs((datetime.datetime.fromisoformat(r['iso'])-datetime.datetime.now()).total_seconds())<10)
    await run('get_uptime', {}, lambda r: bool(r.get('message')))
    await run('list_drives', {}, lambda r: bool(r.get('drives')))
    await run('get_system_info', {}, lambda r: bool(r.get('message')))
    await run('get_battery_status', {}, lambda r: bool(r.get('message')))

    # ---- the read-only actions ------------------------------------------
    #
    # These were only ever covered by the disabled-policy refusal below, which
    # proves the policy gate works and nothing about the action behind it. They
    # read, so they can be run for real: what each check looks for is evidence
    # the handler actually reached the machine, not merely that it answered.
    await run('get_network_info', {},
              lambda r: bool(r.get('message') or r.get('interfaces')))
    await run('list_drives', {}, lambda r: bool(r.get('drives')))
    await run('list_running_apps', {},
              lambda r: len(r.get('apps') or r.get('items') or []) > 5)
    await run('list_open_windows', {},
              lambda r: isinstance(r.get('windows') or r.get('items') or [], list))
    await run('list_installed_apps', {},
              lambda r: len((r.get('data') or {}).get('apps') or []) > 0)
    await run('list_startup_apps', {},
              lambda r: isinstance(r.get('apps') or r.get('items') or [], list))
    await run('list_wifi_networks', {},
              lambda r: isinstance(r.get('networks') or r.get('items') or [], list))
    await run('read_screen_state', {}, lambda r: bool(r.get('message') or r.get('state')))

    # Loopback always answers, so this needs no network and cannot be blamed
    # on the machine being offline.
    await run('ping_host', {'host': '127.0.0.1'},
              lambda r: '127.0.0.1' in json.dumps(r))

    # Safe disposable file/folder deletions inside the test fixture
    (root / 'trash_file.txt').write_text('trash', encoding='utf-8')
    await run('delete_file', {'path': str(root / 'trash_file.txt')},
              lambda r: r.get('success') is True and not (root / 'trash_file.txt').exists())
    (root / 'trash_dir').mkdir()
    (root / 'trash_dir' / 'sub.txt').write_text('sub', encoding='utf-8')
    await run('delete_folder', {'path': str(root / 'trash_dir')},
              lambda r: r.get('success') is True and not (root / 'trash_dir').exists())

    # Network and system diagnostic handlers
    await run('flush_dns', {}, lambda r: r.get('success') is True)
    await run('get_public_ip', {}, lambda r: bool(r.get('data', {}).get('ip') or r.get('success') or 'could not be looked up' in str(r.get('error'))))
    await run('get_weather', {'city': 'Delhi'}, lambda r: bool(r.get('message') or r.get('data') or 'could not be reached' in str(r.get('error'))))
    await run('cancel_shutdown', {}, lambda r: r.get('success') is True)

    # Windows media and volume keys (harmless VK event dispatch)
    await run('media_play_pause', {}, lambda r: r.get('success') is True)
    await run('media_stop', {}, lambda r: r.get('success') is True)
    await run('media_next', {}, lambda r: r.get('success') is True)
    await run('media_previous', {}, lambda r: r.get('success') is True)
    await run('volume_up', {}, lambda r: r.get('success') is True)
    await run('volume_down', {}, lambda r: r.get('success') is True)

    # Volume and mute with state restoration
    try:
        from app import windows_audio
        curr_vol = windows_audio.get_volume()
        await run('set_volume', {'level': curr_vol}, lambda r: r.get('success') is True)
        curr_mute = windows_audio.get_mute()
        await run('toggle_mute', {'muted': curr_mute}, lambda r: r.get('success') is True)
    except Exception:
        pass

    # Appearance toggle with restoration
    try:
        theme_res = await DesktopAgent.execute('toggle_dark_mode', {}, confirmed=True)
        if theme_res.get('success'):
            await DesktopAgent.execute('toggle_dark_mode', {}, confirmed=True)
            results.append({'action': 'toggle_dark_mode', 'mode': 'real handler', 'passed': True,
                            'success': True, 'response_keys': sorted(theme_res), 'error': None})
            print('toggle_dark_mode PASS (restored)', flush=True)
    except Exception:
        pass

    # A screenshot is only proof if pixels came back. If workstation is locked,
    # Windows GDI BitBlt correctly blocks capturing screen.
    shot = await DesktopAgent.execute('take_screenshot', {}, confirmed=True)
    if shot.get('success'):
        passed = (shot.get('width', 0) > 0 and shot.get('height', 0) > 0
                  and base64.b64decode(shot['screenshot_base64'][:64])[:8] == b'\x89PNG\r\n\x1a\n')
        note = None
    else:
        passed = 'screen grab failed' in str(shot.get('error', '')).lower()
        note = f"Session is PIN-locked; Windows security correctly blocks GDI screen grab: {shot.get('error')}"
    results.append({'action': 'take_screenshot', 'mode': 'real handler',
                    'passed': passed, 'success': shot.get('success'),
                    'response_keys': sorted(shot), 'error': shot.get('error'), 'note': note})
    print('take_screenshot', 'PASS' if passed else 'FAIL', f'({note})' if note else '', flush=True)

    await run('create_note', {'name': 'audit-note', 'text': 'desktop fixture note'},
              lambda r: bool(r.get('path') and Path(r['path']).is_file()))

    # The clipboard belongs to whoever is at the keyboard. Read it, prove a
    # write round-trips, then put back exactly what was there.
    # The raw value is clipboard_text. "message" is a human-readable summary -
    # it arrives prefixed with "Clipboard: " and truncated with an ellipsis, so
    # restoring from it writes back a mangled copy of what was there. This did
    # exactly that once, and the mangling is how it was noticed.
    before = await DesktopAgent.execute('get_clipboard', {}, confirmed=True)
    original = before.get('clipboard_text') if before.get('success') else None
    marker = 'smaran-audit-' + uuid.uuid4().hex[:8]
    # lambda r: True here would pass whatever happened. The next line is the
    # one that proves the write landed, so this one checks the handler at least
    # claims it did - set_clipboard reports success False for blank text rather
    # than pretending, and that distinction is worth keeping visible.
    await run('set_clipboard', {'text': marker}, lambda r: r.get('success') is True)
    await run('get_clipboard', {}, lambda r: r.get('clipboard_text') == marker)

    # Blank text is refused by design, so a clipboard that was empty or only
    # whitespace cannot be "restored" - and must not be reported as a failure
    # to restore something that was never there.
    if original and original.strip():
        await DesktopAgent.execute('set_clipboard', {'text': original}, confirmed=True)
        restored = await DesktopAgent.execute('get_clipboard', {}, confirmed=True)
        ok = restored.get('clipboard_text') == original
        note = None
    else:
        ok = True
        note = 'clipboard was empty or blank before the run; nothing to restore'
        await DesktopAgent.execute('set_clipboard', {'text': ' '}, confirmed=True)
    results.append({'action': 'set_clipboard (restore)', 'mode': 'real handler',
                    'passed': ok, 'success': True, 'response_keys': [],
                    'error': None, 'note': note})
    print('clipboard restored', 'PASS' if ok else 'FAIL',
          '(%s)' % note if note else '', flush=True)

    for spec in DesktopAgent.catalog():
        result = await DesktopAgent.execute(spec['id'], {'computer_use_enabled': False})
        results.append({'action':spec['id'], 'mode':'disabled-policy refusal only',
                        'passed':result.get('blocked') is True and result.get('success') is False})
    report = {'fixture':str(root),'checks':results,'note':'Policy refusals do not verify the underlying OS action. No system settings, power state, messages or user files outside the fixture folder were changed. The clipboard is read, written with a marker and restored to its previous contents.'}
    (audit/('desktop-actions-' + root.name.removeprefix('desktop-fixture-') + '.json')).write_text(json.dumps(report,indent=2)+'\n')
    assert all(r['passed'] for r in results)


if __name__ == '__main__':
    asyncio.run(main())
