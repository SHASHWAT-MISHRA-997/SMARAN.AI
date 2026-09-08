"""Set the default Windows output endpoint, without synthesizing key presses.

SendKeys([char]175) types a character; it does not set volume. Core Audio also
lets an explicit 'unmute' set a state instead of toggling an already audible
speaker into silence. No extra package is needed in the frozen application.
"""

import ctypes
import sys
import uuid
from contextlib import contextmanager


class GUID(ctypes.Structure):
    _fields_ = [("bytes", ctypes.c_ubyte * 16)]

    def __init__(self, value):
        super().__init__()
        self.bytes[:] = uuid.UUID(value).bytes_le


def _checked(result):
    if result < 0:
        raise OSError(f"Windows audio returned HRESULT 0x{result & 0xffffffff:08x}")


def _call(pointer, index, *argtypes):
    table = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    return ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, *argtypes)(table[index])


@contextmanager
def _endpoint():
    if sys.platform != "win32":
        raise OSError("System audio control is only supported on Windows.")
    ole = ctypes.WinDLL("ole32")
    ole.CoInitializeEx.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    result = ole.CoInitializeEx(None, 2)
    initialized = result >= 0
    # A host thread may already use the other COM apartment model.
    if result < 0 and (result & 0xffffffff) != 0x80010106:
        _checked(result)
    pointers = []
    try:
        enumerator = ctypes.c_void_p()
        ole.CoCreateInstance.argtypes = [ctypes.POINTER(GUID), ctypes.c_void_p,
                                        ctypes.c_ulong, ctypes.POINTER(GUID),
                                        ctypes.POINTER(ctypes.c_void_p)]
        _checked(ole.CoCreateInstance(
            ctypes.byref(GUID("BCDE0395-E52F-467C-8E3D-C4579291692E")), None, 23,
            ctypes.byref(GUID("A95664D2-9614-4F35-A746-DE8DB63617E6")), ctypes.byref(enumerator)))
        pointers.append(enumerator)
        device = ctypes.c_void_p()
        _checked(_call(enumerator, 4, ctypes.c_int, ctypes.c_int,
                       ctypes.POINTER(ctypes.c_void_p))(enumerator, 0, 1, ctypes.byref(device)))
        pointers.append(device)
        endpoint = ctypes.c_void_p()
        _checked(_call(device, 3, ctypes.POINTER(GUID), ctypes.c_ulong, ctypes.c_void_p,
                       ctypes.POINTER(ctypes.c_void_p))(
            device, ctypes.byref(GUID("5CDF2C82-841E-4546-9722-0CF74078229A")), 23, None,
            ctypes.byref(endpoint)))
        pointers.append(endpoint)
        yield endpoint
    finally:
        for pointer in reversed(pointers):
            _call(pointer, 2)(pointer)
        if initialized:
            ole.CoUninitialize()


def set_volume(level):
    level = max(0, min(100, int(level)))
    with _endpoint() as endpoint:
        _checked(_call(endpoint, 7, ctypes.c_float, ctypes.c_void_p)(endpoint, level / 100, None))
        actual = ctypes.c_float()
        _checked(_call(endpoint, 9, ctypes.POINTER(ctypes.c_float))(endpoint, ctypes.byref(actual)))
    return round(actual.value * 100)


def set_mute(muted=None):
    with _endpoint() as endpoint:
        actual = ctypes.c_int()
        _checked(_call(endpoint, 15, ctypes.POINTER(ctypes.c_int))(endpoint, ctypes.byref(actual)))
        desired = not bool(actual.value) if muted is None else bool(muted)
        _checked(_call(endpoint, 14, ctypes.c_int, ctypes.c_void_p)(endpoint, desired, None))
        _checked(_call(endpoint, 15, ctypes.POINTER(ctypes.c_int))(endpoint, ctypes.byref(actual)))
    return bool(actual.value)
