# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = [('C:\\Users\\shash\\Desktop\\SMARAN.AI\\backend\\frontend_dist', 'frontend_dist')]
binaries = [('C:\\Users\\shash\\AppData\\Local\\Programs\\Python\\Python314\\Lib\\site-packages\\onnxruntime\\capi\\onnxruntime_pybind11_state.pyd', 'onnxruntime\\capi')]
hiddenimports = ['app.main', 'app.companion', 'app.app_lock', 'app.web_intents', 'app.analytics_config', 'app.password_policy', 'app.updates', 'app.desktop_agent', 'app.plugin_routes', 'app.sites_routes', 'app.local_engine', 'app.mcp', 'app.mcp.client', 'app.mcp.manager', 'app.mcp.routes', 'app.video', 'app.video.hardware', 'app.video.registry', 'app.video.planner', 'app.video.routes', 'app.video.install', 'app.capability', 'app.tts', 'app.tts.kokoro', 'app.imaging', 'app.imaging.registry', 'app.imaging.engine', 'app.imaging.routes', 'app.media', 'app.media.extract', 'app.media.routes', 'segno', 'uvicorn.logging', 'uvicorn.loops.auto', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespan.on', 'webview', 'webview.platforms.winforms', 'edge_tts', 'passlib.handlers.bcrypt', 'sqlalchemy.dialects.sqlite', 'email_validator']
tmp_ret = collect_all('chromadb')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('faster_whisper')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('deep_translator')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('tokenizers')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('tiktoken_ext')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('onnxruntime')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('g2p_en')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['C:\\Users\\shash\\Desktop\\SMARAN.AI\\desktop_app.py'],
    pathex=['C:\\Users\\shash\\Desktop\\SMARAN.AI\\backend'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['boto3', 'botocore', 's3transfer', 'torch', 'torchvision', 'torchaudio', 'transformers', 'polars', 'faiss', 'sklearn', 'scikit-learn', 'onnxruntime', 'tensorflow', 'matplotlib', 'IPython', 'notebook', 'pytest', 'PyInstaller'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='SMARAN.AI',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['C:\\Users\\shash\\Desktop\\SMARAN.AI\\smaran.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='SMARAN.AI',
)
