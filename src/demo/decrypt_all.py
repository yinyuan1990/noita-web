"""
GaMe(TEA) 资源批量解密器
用法:
  python decrypt_all.py                 # 解密整个 assets 到 assets_dec
  python decrypt_all.py membericon      # 只解密某个子目录
算法(反汇编 libcocos2dcpp.so 得到):
  头5字节 = "GaMe" + 1字节flag; 其后按 8字节分组 TEA 解密
  TEA: 16轮, delta=0x9E3779B9, 块小端; key = 下面hex解码的16字节(小端4个uint32)
"""
import os
import sys
import struct

ASSETS = r'E:/soft/xiaoshuodongtai/ziyuan/main/assets'
OUTROOT = r'E:/soft/xiaoshuodongtai/ziyuan/main/assets_dec'
KEY_HEX = '46E330EAFAF5C3E09D4A95835704AD7C'
M = 0xFFFFFFFF
DELTA = 0x9E3779B9
K = list(struct.unpack('<4I', bytes.fromhex(KEY_HEX)))

def tea_decrypt_body(body):
    n = len(body) - (len(body) % 8)
    out = bytearray(body)
    k0, k1, k2, k3 = K
    for i in range(0, n, 8):
        v0, v1 = struct.unpack_from('<2I', body, i)
        s = (DELTA * 16) & M
        for _ in range(16):
            v1 = (v1 - (((((v0 << 4) & M) + k2) & M) ^ ((v0 + s) & M) ^ (((v0 >> 5) + k3) & M))) & M
            v0 = (v0 - (((((v1 << 4) & M) + k0) & M) ^ ((v1 + s) & M) ^ (((v1 >> 5) + k1) & M))) & M
            s = (s - DELTA) & M
        struct.pack_into('<2I', out, i, v0, v1)
    return bytes(out)

def is_encrypted(head):
    return head[:4] == b'GaMe'

def main():
    sub = sys.argv[1] if len(sys.argv) > 1 else ''
    root = os.path.join(ASSETS, sub) if sub else ASSETS
    n_dec = n_copy = 0
    for dirpath, _, files in os.walk(root):
        for f in files:
            src = os.path.join(dirpath, f)
            rel = os.path.relpath(src, ASSETS)
            dst = os.path.join(OUTROOT, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(src, 'rb') as fh:
                data = fh.read()
            if is_encrypted(data):
                out = tea_decrypt_body(data[5:])
                n_dec += 1
            else:
                out = data
                n_copy += 1
            with open(dst, 'wb') as fh:
                fh.write(out)
    print('decrypted:', n_dec, 'copied:', n_copy, '-> ', OUTROOT)

if __name__ == '__main__':
    main()
