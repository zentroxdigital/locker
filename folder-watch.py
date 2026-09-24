#!/usr/bin/env python3
"""Open Ms Minute when a registered locked directory itself is opened on Linux."""

import ctypes
import json
import os
from pathlib import Path
import select
import signal
import struct
import subprocess
import sys
import time

IN_OPEN = 0x00000020
IN_DELETE_SELF = 0x00000400
IN_MOVE_SELF = 0x00000800
IN_IGNORED = 0x00008000
WATCH_MASK = IN_OPEN | IN_DELETE_SELF | IN_MOVE_SELF
EVENT_HEADER = struct.Struct("iIII")

REGISTRY = Path.home() / ".config" / "locker-kit" / "watched-folders.json"
LAUNCHER = Path(__file__).resolve().with_name("locker-app.sh")

libc = ctypes.CDLL("libc.so.6", use_errno=True)
libc.inotify_init1.argtypes = [ctypes.c_int]
libc.inotify_init1.restype = ctypes.c_int
libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
libc.inotify_add_watch.restype = ctypes.c_int
libc.inotify_rm_watch.argtypes = [ctypes.c_int, ctypes.c_int]
libc.inotify_rm_watch.restype = ctypes.c_int


def registered_folders():
    try:
        values = json.loads(REGISTRY.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    result = set()
    for value in values if isinstance(values, list) else []:
        try:
            folder = Path(value).expanduser().resolve()
            if folder.is_dir():
                result.add(folder)
        except (OSError, TypeError):
            pass
    return result


def is_locked(folder):
    try:
        manifest = json.loads((folder / ".locker" / "manifest.json").read_text(encoding="utf-8"))
        return bool(manifest.get("files"))
    except (OSError, ValueError, AttributeError):
        return False


def main():
    fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
    if fd < 0:
        raise OSError(ctypes.get_errno(), "inotify_init1 failed")

    path_by_watch = {}
    watch_by_path = {}
    running_apps = {}
    last_launch = {}
    keep_running = True

    def stop(_signum, _frame):
        nonlocal keep_running
        keep_running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def sync_watches():
        desired = registered_folders()
        for folder in set(watch_by_path) - desired:
            watch = watch_by_path.pop(folder)
            path_by_watch.pop(watch, None)
            libc.inotify_rm_watch(fd, watch)
        for folder in desired - set(watch_by_path):
            watch = libc.inotify_add_watch(fd, os.fsencode(folder), WATCH_MASK)
            if watch >= 0:
                watch_by_path[folder] = watch
                path_by_watch[watch] = folder

    def open_locker(folder):
        process = running_apps.get(folder)
        if process and process.poll() is None:
            return
        now = time.monotonic()
        if now - last_launch.get(folder, 0) < 3:
            return
        if not is_locked(folder):
            return
        last_launch[folder] = now
        running_apps[folder] = subprocess.Popen(
            [str(LAUNCHER), str(folder)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

    try:
        last_sync = 0.0
        while keep_running:
            now = time.monotonic()
            if now - last_sync >= 2:
                sync_watches()
                last_sync = now
            readable, _, _ = select.select([fd], [], [], 1.0)
            if not readable:
                continue
            try:
                data = os.read(fd, 65536)
            except BlockingIOError:
                continue
            offset = 0
            while offset + EVENT_HEADER.size <= len(data):
                watch, mask, _cookie, name_length = EVENT_HEADER.unpack_from(data, offset)
                offset += EVENT_HEADER.size
                name = data[offset : offset + name_length].rstrip(b"\0")
                offset += name_length
                folder = path_by_watch.get(watch)
                if not folder:
                    continue
                if mask & (IN_DELETE_SELF | IN_MOVE_SELF | IN_IGNORED):
                    watch_by_path.pop(folder, None)
                    path_by_watch.pop(watch, None)
                elif mask & IN_OPEN and not name:
                    open_locker(folder)
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"locker folder watcher: {error}", file=sys.stderr)
        sys.exit(1)
