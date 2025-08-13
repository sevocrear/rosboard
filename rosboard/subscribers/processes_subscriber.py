#!/usr/bin/env python3

import re
import select
import subprocess
import time
import threading
import traceback

class ProcessesSubscriber(object):
    def __init__(self, callback):
        self.callback = callback
        self.stop_signal = None
        threading.Thread(target = self.start, daemon = True).start()

    def __del__(self):
        self.stop_signal = True

    def unregister(self):
        self.stop_signal = True

    def _collect_via_top(self):
        """Collect process list using `top -bn 1` and parse columns."""
        # Support both variants: with USER and without USER in header.
        re_field = re.compile("(^ *PID|USER +| *%CPU| *%MEM|COMMAND.*)")
        lines = subprocess.check_output(['top', '-bn', '1']).decode('utf-8', errors='ignore').split("\n")
        fields = None
        output = []
        for line in lines:
            if len(line.strip()) == 0:
                continue
            # header row can be either with or without USER column
            if "PID" in line and "%CPU" in line and "%MEM" in line and "COMMAND" in line:
                fields = {}
                # First, try with USER
                for m in re_field.finditer(line):
                    fields[m.group().strip()] = (m.start(), m.end())
                # If USER was not captured, fake USER span as zero-width to the left of PID
                if "USER" not in fields:
                    # create spans for PID/CPU/MEM/COMMAND by searching their plain positions
                    def span(tok):
                        i = line.find(tok)
                        return (i, i+len(tok)) if i>=0 else None
                    spans = {
                        "PID": span("PID"),
                        "%CPU": span("%CPU"),
                        "%MEM": span("%MEM"),
                        "COMMAND": span("COMMAND"),
                    }
                    for k,v in spans.items():
                        if v and k not in fields:
                            fields[k] = v
                    # NOTE: USER missing; we will fill it later via ps lookup
                continue
            if fields is None:
                continue
            try:
                pid_str = line[fields["PID"][0] : fields["PID"][1]].strip()
                if not pid_str or not pid_str[0].isdigit():
                    continue
                pid = int(pid_str)
                user = None
                if "USER" in fields:
                    user = line[fields["USER"][0] : fields["USER"][1]].strip()
                cpu = float(line[fields["%CPU"][0] : fields["%CPU"][1]].replace(',','.')) if "%CPU" in fields else 0.0
                mem = float(line[fields["%MEM"][0] : fields["%MEM"][1]].replace(',','.')) if "%MEM" in fields else 0.0
                command = line[fields["COMMAND"][0] : ].strip() if "COMMAND" in fields else ''
                if user is None:
                    # resolve USER via ps per-pid (best-effort)
                    try:
                        user = subprocess.check_output(['ps','-o','user=','-p',str(pid)]).decode('utf-8', errors='ignore').strip()
                    except Exception:
                        user = ''
                output.append({
                    "pid": pid,
                    "user": user,
                    "cpu": cpu,
                    "mem": mem,
                    "command": command,
                })
            except Exception:
                # skip unparsable rows
                continue
        return output

    def _collect_via_ps(self):
        """Collect process list using `ps` as a fallback (portable)."""
        # Try GNU ps format; fallback to a basic one if needed
        cmds = [
            ['ps', '-eo', 'pid,user,pcpu,pmem,comm', '--no-headers', '--sort=-pcpu'],
            ['ps', '-eo', 'pid,user,pcpu,pmem,comm'],
        ]
        for cmd in cmds:
            try:
                out = subprocess.check_output(cmd).decode('utf-8', errors='ignore').strip().split('\n')
                result = []
                for line in out:
                    if not line.strip():
                        continue
                    parts = line.split(None, 4)
                    if len(parts) < 5:
                        continue
                    pid_s, user, pcpu_s, pmem_s, comm = parts
                    try:
                        pid = int(pid_s)
                        pcpu = float(pcpu_s.replace(',','.'))
                        pmem = float(pmem_s.replace(',','.'))
                    except Exception:
                        continue
                    result.append({
                        "pid": pid,
                        "user": user,
                        "cpu": pcpu,
                        "mem": pmem,
                        "command": comm,
                    })
                return result
            except Exception:
                continue
        return []

    def start(self):
        self.stop_signal = None
        while not self.stop_signal:
            try:
                processes = []
                try:
                    processes = self._collect_via_top()
                except Exception:
                    # fall back to ps if top is unavailable or parsing fails
                    processes = self._collect_via_ps()
                # if top returned no rows (e.g., header variant not matched), also fall back to ps
                if not processes:
                    processes = self._collect_via_ps()
                # deliver even if empty, to trigger UI update
                try:
                    self.callback(processes)
                except Exception:
                    traceback.print_exc()
                time.sleep(2)
            except Exception:
                # keep the loop alive
                traceback.print_exc()
                time.sleep(2)

if __name__ == "__main__":
    # Run test
    ProcessesSubscriber(lambda msg: print("Received msg: %s" % msg))
    time.sleep(100)
