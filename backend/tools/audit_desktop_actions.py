"""Real file/read-only action checks; system-changing actions get refusal checks only."""
import asyncio
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
    for spec in DesktopAgent.catalog():
        result = await DesktopAgent.execute(spec['id'], {'computer_use_enabled': False})
        results.append({'action':spec['id'], 'mode':'disabled-policy refusal only',
                        'passed':result.get('blocked') is True and result.get('success') is False})
    report = {'fixture':str(root),'checks':results,'note':'Policy refusals do not verify the underlying OS action. No system settings, power state, clipboard, messages or user files were changed.'}
    (audit/('desktop-actions-' + root.name.removeprefix('desktop-fixture-') + '.json')).write_text(json.dumps(report,indent=2)+'\n')
    assert all(r['passed'] for r in results)


if __name__ == '__main__':
    asyncio.run(main())
