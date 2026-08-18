---
title: "APP攻防：Frida HOOK、证书提取、SSL双向校验绕过"
pubDate: 2026-08-11
tags:
  - 安全
  - APP攻防
---

上一讲 XP 框架解决单向证书校验，这讲对付双向校验——客户端校验服务端证书之外，APP 内还放了一张证书供服务端校验，XP 绕了单向还是网络错误。核心工具换成 Frida（动态 HOOK，比 XP 重打包灵活），三条绕过路

## 综合分析工具

- MobSF（https://github.com/MobSF/Mobile-Security-Framework-MobSF）
- AppInfoScanner（https://github.com/kelvinBen/AppInfoScanner）

## Frida 是什么

HOOK：APP 代码执行到关键位置时，调试器改内存指令触发 CPU 异常，操作系统把异常交给调试器，插入自己的代码执行完后恢复原流程。Frida 就是跨平台 HOOK 工具，通过 ptrace/zygote 注入把 JS 引擎塞进目标进程执行自己的代码

三个组件：frida-server（推到安卓端注入）、frida-tools（PC 端 CLI：frida-ps/frida-trace）、JS API（Java.use/Interceptor.attach/Memory）

## Frida 安装

PC 端：

```
pip install frida
pip install frida-tools
```

安卓端：GitHub 下对应版本的 frida-server（版本必须和 PC 端一致），先看模拟器位数：

```
getprop ro.product.cpu.abi    # 夜神是 x86
```

推送并启动：

```
adb push frida-server-16.1.7-android-x86 /data/local/frida-x86
adb shell 里：su root → cd /data/local → ./frida-x86
```

PC 端连接验证：

```
adb forward tcp:27042 tcp:27042
frida-ps -U    # 能列出包名就 OK
```

## 双向证书绕过

判断：WIFI 代理、软件代理都网络错误，XP 框架绕过后能抓到包但 APP 仍不能正常用 → 双向校验

**1. frida + r0capture + WireShark**

https://github.com/r0ysue/r0capture 。启动 frida-server + 端口转发后：

```
python r0capture.py -U -f com.p1.mobile.putong -p tencent.pcap
```

包名用 amaze 文件管理器或 APK 资源提取器查（探探是 com.p1.mobile.putong）。注意必须关掉代理！流量存进 .pcap 用 WireShark 看。缺点是只能看不能改包

**2. frida + HOOK-JS + BurpSuite**

HOOK 脚本：https://github.com/apkunpacker/FridaScripts 。注意先把代理打开：

```
frida -U -f <APP包名> -l <SSLUnpinning.js>
```

能导进 BP 方便渗透，但不是通杀——检测强或走其他协议的 APP 仍可能失败。报错的话改 SSLUnpinning.js 前 41 行（替换成兼容高版本安卓的 DexClassLoader 只读 + libflutter HOOK 那段代码，原文有完整贴出）

**3. BP 导入证书**

适用于能反编译且找得到证书文件的 APP。APK 传到 https://www.decompiler.com/ 在线反编译（或 MobSF），在 assert/res 目录找 p12/cer/crt/der/pem 后缀文件，下载后导入 BP（需要密码的是真证书）。密码要逆向反编译代码里找——现代 APP 基本加壳，拿到源码概率小，所以这招利用难度大

## 单向证书

上讲 XP 框架那套，这讲的 Frida 方法同样能绕，不用 XP 也行

## 要点

绕 SSL 校验的优先级：Frida+HOOK-JS 进 BP 最顺手（可测可改），不行再上 r0capture 通杀（只能看），反编译提证书是最后手段（密码难搞）。Frida 版本两端必须一致，位数看 ro.product.cpu.abi。坑集中在环境：模拟器位数不对、版本不匹配、frida-server 没起来、代理开关状态（r0capture 关代理、HOOK-JS 开代理）——抓不到先查这些再怀疑目标
