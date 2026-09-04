# 远端执行:python scripts/_ssh.py "cmd1" "cmd2" ...  或  python scripts/_ssh.py -f cmds.txt(每行一条;密码走 DEPLOY_PW)
import os
import sys
import paramiko

cmds = sys.argv[1:]
if len(cmds) >= 2 and cmds[0] == "-f":
    with open(cmds[1], encoding="utf8") as fh:
        cmds = [l.rstrip("\n") for l in fh if l.strip() and not l.startswith("#")]
s = paramiko.SSHClient()
s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect("8.162.5.160", username="root", password=os.environ.get("DEPLOY_PW", ""), timeout=25, look_for_keys=False, allow_agent=False)
for cmd in cmds:
    i, o, e = s.exec_command(cmd)
    out = o.read().decode("utf8", "ignore")
    err = e.read().decode("utf8", "ignore")
    print("$", cmd)
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print("[stderr]", err.rstrip())
s.close()
