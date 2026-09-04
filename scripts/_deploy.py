import os
import sys
import time
import paramiko

HOST = "8.162.5.160"
USER = "root"
PW = os.environ.get("DEPLOY_PW", "")
# 部署目标:python _deploy.py            → 空战 dist.tar.gz → /opt/yql/www/soft/fj   (线上 /updatesoft/fj/)
#          python _deploy.py noita      → 地图 dist-noita.tar.gz → /opt/yql/www/soft/noita (线上 /updatesoft/noita/)
TARGET = sys.argv[1] if len(sys.argv) > 1 else "fj"
TARGETS = {
    "fj": ("dist.tar.gz", "/opt/yql/www/soft/fj"),
    "noita": ("dist-noita.tar.gz", "/opt/yql/www/soft/noita"),
}
TAR_NAME, REMOTE_DIR = TARGETS[TARGET]
LOCAL_TAR = os.path.join(os.path.dirname(__file__), "..", TAR_NAME)
REMOTE_TAR = REMOTE_DIR + "/" + TAR_NAME


def run(ssh, cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode("utf-8", "ignore")
    err = stderr.read().decode("utf-8", "ignore")
    code = stdout.channel.recv_exit_status()
    print(f"$ {cmd}\n  exit={code}")
    if out.strip():
        print("  out:", out.strip())
    if err.strip():
        print("  err:", err.strip())
    return code, out, err


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"connecting {USER}@{HOST} ...")
    ssh.connect(HOST, username=USER, password=PW, timeout=25, look_for_keys=False, allow_agent=False)
    print("connected.")

    run(ssh, f"mkdir -p {REMOTE_DIR}")

    size = os.path.getsize(LOCAL_TAR)
    print(f"uploading {TAR_NAME} ({size/1024/1024:.1f} MB) ...")
    sftp = ssh.open_sftp()
    t0 = time.time()
    last = [0]

    def cb(done, total):
        pct = int(done * 100 / total)
        if pct >= last[0] + 10:
            last[0] = pct
            print(f"  {pct}%")

    sftp.put(LOCAL_TAR, REMOTE_TAR, callback=cb)
    sftp.close()
    print(f"upload done in {time.time()-t0:.1f}s")

    # 先清掉旧 assets（避免堆积旧 hash 包），再解包覆盖并清理压缩包
    run(ssh, f"rm -rf {REMOTE_DIR}/assets && cd {REMOTE_DIR} && tar -xzf {TAR_NAME} && rm -f {TAR_NAME}")
    # 验证关键文件
    run(ssh, f"ls -1 {REMOTE_DIR} && echo '---' && ls {REMOTE_DIR}/assets/*.js && du -sh {REMOTE_DIR}")
    ssh.close()
    print("DEPLOY OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("DEPLOY FAILED:", repr(e))
        sys.exit(1)
