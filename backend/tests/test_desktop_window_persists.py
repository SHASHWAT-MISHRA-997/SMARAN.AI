"""The desktop window keeps its sign-in and settings between launches.

pywebview defaults to private_mode=True, which discards the WebView's cookies
and storage when the window closes: every launch signed the person out and
reset every setting kept in the page. desktop_app.py must start it persistent.
"""
import ast
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2] / "desktop_app.py"


def _start_calls():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    return [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "start"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "webview"
    ]


def test_every_webview_start_is_persistent():
    calls = _start_calls()
    assert calls, "desktop_app.py no longer starts pywebview"
    for call in calls:
        kwargs = {kw.arg: kw.value for kw in call.keywords}
        assert "private_mode" in kwargs, "webview.start() without private_mode=False forgets the session"
        assert isinstance(kwargs["private_mode"], ast.Constant) and kwargs["private_mode"].value is False
        assert "storage_path" in kwargs, "persistent storage needs a storage_path"
