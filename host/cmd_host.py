"""
Native messaging host that bridges an Edge extension to cmd.exe.

Protocol (each message is UTF-8 JSON preceded by a 4-byte little-endian length):
  extension -> host   {"type": "input", "data": "dir\r\n"}   text written to cmd's stdin
                      {"type": "kill"}                       end the cmd session
  host -> extension   {"type": "output", "data": "..."}      text from cmd's stdout/stderr
                      {"type": "error",  "data": "..."}      problem inside the host
                      {"type": "exit",   "code": 0}          cmd.exe has exited
"""

import codecs
import json
import os
import struct
import subprocess
import sys
import threading

SHELL_CMD = ["cmd.exe", "/Q", "/K", "chcp 65001 >nul"]  # /Q: no echo; chcp 65001: UTF-8 output
MAX_OUT = 512 * 1024  # Edge accepts at most 1 MB per message from the host; stay well below it

_stdin = sys.stdin.buffer
_stdout = sys.stdout.buffer
_write_lock = threading.Lock()

if os.name == "nt":
    import msvcrt
    msvcrt.setmode(_stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(_stdout.fileno(), os.O_BINARY)


def send(msg):
    data = json.dumps(msg).encode("utf-8")
    with _write_lock:
        _stdout.write(struct.pack("<I", len(data)))
        _stdout.write(data)
        _stdout.flush()


def read_message():
    raw_len = _stdin.read(4)
    if len(raw_len) < 4:
        return None  # Edge closed the pipe: the tab or port went away
    (length,) = struct.unpack("<I", raw_len)
    return json.loads(_stdin.read(length).decode("utf-8"))


def pump(stream):
    """Forward everything cmd writes, in chunks, so prompts without a newline still appear."""
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    while True:
        chunk = stream.read1(4096)
        if not chunk:
            break
        text = decoder.decode(chunk)
        for i in range(0, len(text), MAX_OUT):
            send({"type": "output", "data": text[i:i + MAX_OUT]})


def kill_tree(proc):
    if proc.poll() is not None:
        return
    if os.name == "nt":
        # Also ends anything cmd started (ping -t, a running script, ...)
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        proc.kill()


def main():
    sys.stderr.write(f"python {sys.version.split()[0]} at {sys.executable}\n")
    sys.stderr.flush()
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        proc = subprocess.Popen(
            SHELL_CMD,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=flags,
        )
    except OSError as e:
        send({"type": "error", "data": f"Could not start cmd.exe: {e}\n"})
        return

    reader = threading.Thread(target=pump, args=(proc.stdout,), daemon=True)
    reader.start()

    def wait_exit():
        code = proc.wait()
        reader.join(timeout=2)
        send({"type": "exit", "code": code})
        os._exit(0)

    threading.Thread(target=wait_exit, daemon=True).start()

    try:
        while True:
            msg = read_message()
            if msg is None or msg.get("type") == "kill":
                break
            if msg.get("type") == "input":
                proc.stdin.write(msg.get("data", "").encode("utf-8"))
                proc.stdin.flush()
    except (BrokenPipeError, OSError):
        pass
    finally:
        kill_tree(proc)


if __name__ == "__main__":
    main()
