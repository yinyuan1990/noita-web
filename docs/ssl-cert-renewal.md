# cocoaihj.com 证书过期 / 续签记录

## 现状(2026-09-04)

- `*.cocoaihj.com` 泛域名 DV 证书(DigiCert Encryption Everywhere,2026-03-05 签,半年期)**2026-09-04 07:59:59 到期**。
- 到期后浏览器打 `https://update.cocoaihj.com/...` 全部 `ERR_CERT_DATE_INVALID`,玩家打不开。
- **域名** `cocoaihj.com` 本身 2028-02-28 才到期,和证书无关,不用动。
- 部署本身没问题:2026-09-04 上午的 noita 包已在源站,用源站 IP 直连冒烟通过(见下)。

## 架构(决定了在哪修)

```
浏览器 ──HTTPS──▶ 阿里云 CDN(update.cocoaihj.com CNAME → *.w.cdngslb.com,TLS 在这终结)
                     └──HTTP:80──▶ 源站 8.162.5.160(docker nginx,按 Host 分发,无 :443)
```

- 证书挂在 **CDN** 上,服务器上没有证书文件,SSH 上去改不了。
- 6 个域名都是 `xxx.cocoaihj.com` 子域名,都走同一套 CDN。

## 方案(已选:免费证书,0 元)

付费泛域名 DV 约 2000+/年,放弃。走阿里云"个人测试证书(免费版)":单域名、90 天、每账号每年 20 张额度、RSA 2048。

### 每个域名的操作

1. 数字证书管理服务 <https://yundun.console.aliyun.com/?p=cas> → SSL 证书 → **免费证书**
   - 首次:购买 → 个人测试证书(免费版)→ 数量 6 → 不要专家服务 → 0 元下单。
2. 列表里点一条 **证书申请**:域名填 `update.cocoaihj.com`,算法 **RSA 2048**,CSR 系统生成,验证方式 **自动 DNS 验证**,填联系人,提交。
   - 手机验证码收不到时改邮箱验证,或稍后再试(2026-09-04 12:30 卡在这一步)。
3. 等状态 **已签发**(1~10 分钟)。
4. CDN 控制台 <https://cdn.console.aliyun.com> → 域名管理 → 该域名 → 管理 → **HTTPS 配置** → 修改配置:
   - HTTPS 安全加速 **开启**
   - 证书来源 **数字证书管理服务** → 选刚签的那张 → 确定,等几分钟全网下发。
   - CDN 里的"免费证书"入口已被阿里云收掉,只能在数字证书管理服务里申请再选。
5. 打开 **到期自动申请 / 证书自动更新**(证书列表操作栏或 CDN HTTPS 配置里),以后不用手动。

### 域名清单

| 域名 | 用途 | 证书申请 | 挂到 CDN | 验证 |
|---|---|---|---|---|
| update.cocoaihj.com | 软件更新 / noita 页面 | ☐ | ☐ | ☐ |
| (其余 5 个补上) | | ☐ | ☐ | ☐ |

### 额度提醒

6 个域名 × 每年 4 张 = 24 张 > 20 张免费额度。明年撞额度时的兜底:服务器上 `acme.sh` 用 Let's Encrypt 签 `*.cocoaihj.com` 泛域名(免费、90 天、自动续),通过阿里云 DNS API 验证,再用阿里云 CLI 推到 CDN(证书来源"自定义上传")。需要一个只有 DNS 读写 + CDN 证书管理权限的 RAM AccessKey。

## 证书没好之前怎么冒烟

用源站 IP 直连,绕开 CDN 和证书(探针 `_noita-misc-shot.mjs` / `_noita-biome-play-shot.mjs` 支持):

```powershell
$env:ORIGIN_IP='8.162.5.160'
$u = "http://update.cocoaihj.com/updatesoft/noita/noita-play.html?log=0&v=$(Get-Date -UFormat %s)"
node scripts/_noita-misc-shot.mjs $u
node scripts/_noita-biome-play-shot.mjs 13500,8400 rb2-ip $u
```

原理:`--host-resolver-rules=MAP update.cocoaihj.com 8.162.5.160` 让浏览器把域名解析到源站,走 http:80,nginx 按 Host 头正常分发。直接打 `http://8.162.5.160/...`(无 Host)是 404,别用。

2026-09-04 12:40 结果:189 只实体、`skipped {}`、60 fps,零碎实体(激光门 / 云陷阱 / 雕像陷阱 / 工具箱)全部正常。

## 证书好了之后

不带任何环境变量跑一次,验证证书链:

```powershell
node scripts/_noita-misc-shot.mjs "https://update.cocoaihj.com/updatesoft/noita/noita-play.html?log=0&v=$(Get-Date -UFormat %s)"
```

不报 `ERR_CERT_*` 即通过;顺手把上面表格打勾。
