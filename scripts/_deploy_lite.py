# 增量部署：只上传 HTML 和 assets 下的新 JS（res/ 未变时免传 38MB 整包）
import glob
import os
import paramiko

HOST = "8.162.5.160"
USER = "root"
PW = os.environ.get("DEPLOY_PW", "")
REMOTE_DIR = "/opt/yql/www/soft/fj"
BASE = os.path.join(os.path.dirname(__file__), "..", "dist")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print(f"connecting {USER}@{HOST} ...")
ssh.connect(HOST, username=USER, password=PW, timeout=25, look_for_keys=False, allow_agent=False)
sftp = ssh.open_sftp()
files = ["air-combat.html", "index.html", "res/shmup/water_pod.png"] + [
    "assets/" + os.path.basename(p) for p in glob.glob(os.path.join(BASE, "assets", "*.js"))
]
for name in files:
    sftp.put(os.path.join(BASE, name), f"{REMOTE_DIR}/{name}")
    print("uploaded", name)
sftp.close()
ssh.close()
print("DEPLOY OK")
