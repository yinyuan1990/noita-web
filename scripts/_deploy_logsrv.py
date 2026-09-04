# 部署日志接收器:python scripts/_deploy_logsrv.py(密码走 DEPLOY_PW)
#  1. 上传 noita-log-server.py → /opt/yql/noita-log/server.py,systemd 常驻(端口 8787)
#  2. 在 ai-device-nginx 的 update.cocoaihj.com / 10004 两个 server 块里加 location /updatesoft/noita-log/ 反代到宿主机 172.18.0.1:8787
#  3. nginx -t 通过才 reload;配置先备份
import os
import sys
import paramiko

HOST, USER, PW = "8.162.5.160", "root", os.environ.get("DEPLOY_PW", "")
CONF = "/opt/yql/docker/nginx/conf.d/default.conf"
LOC = """    location /updatesoft/noita-log/ {
        proxy_pass http://172.18.0.1:8787/;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 30s;
        client_max_body_size 4M;
    }
"""
UNIT = """[Unit]
Description=Noita prototype op-log receiver
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/yql/noita-log/server.py
Environment=PORT=8787
Environment=NOITA_LOG_DIR=/opt/yql/noita-log/logs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
"""

PATCH = r'''
import re,sys
p="%s"; s=open(p,encoding="utf8",errors="ignore").read()
if "noita-log" in s:
    print("nginx: location already present"); sys.exit(0)
loc=%r
parts=s.split("\nserver {")
out=[parts[0]];n=0
for blk in parts[1:]:
    blk="\nserver {"+blk
    if ("server_name update.cocoaihj.com" in blk or "listen 10004" in blk) and "/updatesoft/" in blk:
        i=blk.rstrip().rfind("}")
        blk=blk[:i]+loc+blk[i:]; n+=1
    out.append(blk)
open(p,"w",encoding="utf8").write("".join(out)); print("nginx: patched %%d server blocks"%%n)
''' % (CONF, LOC)


def run(ssh, cmd):
    _, o, e = ssh.exec_command(cmd)
    out, err = o.read().decode("utf8", "ignore"), e.read().decode("utf8", "ignore")
    code = o.channel.recv_exit_status()
    print(f"$ {cmd}\n  exit={code}")
    if out.strip(): print("  " + out.strip().replace("\n", "\n  "))
    if err.strip(): print("  err: " + err.strip().replace("\n", "\n  "))
    return code, out


ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PW, timeout=25, look_for_keys=False, allow_agent=False)
sftp = ssh.open_sftp()
run(ssh, "mkdir -p /opt/yql/noita-log/logs")
sftp.put(os.path.join(os.path.dirname(__file__), "noita-log-server.py"), "/opt/yql/noita-log/server.py")
with sftp.open("/etc/systemd/system/noita-log.service", "w") as f: f.write(UNIT)
with sftp.open("/opt/yql/noita-log/patch_nginx.py", "w") as f: f.write(PATCH)
sftp.close()
run(ssh, "systemctl daemon-reload && systemctl enable --now noita-log && sleep 1 && systemctl is-active noita-log && curl -s http://127.0.0.1:8787/health")
run(ssh, f"cp -n {CONF} {CONF}.bak-noita-log; python3 /opt/yql/noita-log/patch_nginx.py")
code, _ = run(ssh, "docker exec ai-device-nginx nginx -t")
if code == 0:
    run(ssh, "docker exec ai-device-nginx nginx -s reload && sleep 1 && curl -s -H 'Host: update.cocoaihj.com' http://127.0.0.1/updatesoft/noita-log/health")
else:
    run(ssh, f"cp {CONF}.bak-noita-log {CONF}; echo RESTORED")
    sys.exit(1)
ssh.close()
print("LOGSRV OK")
