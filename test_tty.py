import pty
import os
import time

def master_read(fd):
    try:
        return os.read(fd, 1024)
    except OSError:
        return b""

os.environ["COLUMNS"] = "50"
pty.spawn(["node", "dist/bin/cmdr.js", "--dangerously-skip-permissions"])
