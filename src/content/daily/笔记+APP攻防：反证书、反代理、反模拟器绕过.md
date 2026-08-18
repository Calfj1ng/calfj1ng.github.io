---
title: "APP攻防：反证书、反代理、反模拟器绕过"
pubDate: 2026-08-09
tags:
  - 安全
  - APP攻防
---

进入 APP 安全第一讲，核心问题是"抓不到包怎么办"。配置好 BurpSuite 后仍然抓不到，分两类：无限制过滤的（工具证书没配好、流量不是 HTTP/HTTPS）和有限制过滤的（反模拟器、反代理 VPN、反 SSL 证书验证）。重点讲有限制的怎么绕

参考 demo：https://github.com/AndroidAppSec/vuls （反抓包）、https://github.com/lamster2018/EasyProtector （反调试）

## 防护手段与绕过对照

- 非 HTTP/HTTPS 流量 → 封包工具、科来/Wireshark 抓
- 反模拟器（检测硬盘/运营商/IMEI）→ 用真机、模拟器改设置伪装真机、逆向删检测代码重打包
- 反证书检验（SSL Pinning 单向/双向）→ 单向用 XP 框架、双向逆向提证书、或重打包
- 反代理&VPN（检测到代理就断）→ APP 内代理工具 Postern/SocksDroid、PC 端 Proxifier 抓模拟器进程、或重打包

## 非 HTTP/HTTPS 抓包

游戏类 APP（如微乐斗地主）内部走私有协议，BP 抓不到，用封包工具或科来直接抓网卡流量

## 反模拟器绕过

检测逻辑：看有无硬盘、运营商、手机号、IMEI 等。逍遥模拟器改设置（磁盘、运营商信息）可绕过简单检测；检测深的改设置没用，只能逆向删检测逻辑重打包，都不行就老实上真机

## 反证书检验（SSL Pinning）绕过

单向校验：客户端校验服务端证书（APP 内置 sha256 指纹，BP 代理证书指纹对不上就请求失败——关代理就成功、开代理就失败是典型特征）

绕过用 Xposed 框架（XP 只支持到安卓 8，新逍遥是安卓 9，要用多开器开安卓 7）。安装时 /system 不可写的话：

```
adb root
adb remount
adb shell 里执行：
mount -o rw,remount -t auto /system
chmod 777 /system
然后在模拟器终端：
su root
cd system/xposed
sh memu-script.sh
```

装完在 XP Install 载入模块重启，SSL Pinning->okhttp 就能抓到包了

代码层面（vuls 的 SSLPinningActivity.java）：客户端内置目标站证书的 sha256 值，请求时校验，BP 证书值不同就失败。单向能这么绕，双向校验这招没用

## 反代理&VPN 绕过

某社交 APP 开 WIFI 代理就提示无法使用。两条路：

1. APP 内代理：关 WIFI 代理，用 Postern（或 SocksDroid）新建代理指向本机 BP 的 8888，配置规则后开 VPN，APP 不再提示、BP 能抓到
2. PC 端抓进程：跳过模拟器，用 Proxifier 设规则抓模拟器进程的流量转发给 BP，APP 无提示，也能抓到

检测逻辑完善的话就逆向删检测代码

## 重打包与签名检测

重打包 = 逆向拿到源码 → 改掉限制代码 → 打包回 APK。对抗手段是签名校验：每个 APK 发布时有签名值，重打包后签名变化就验证失败。绕过签名检测后面课程讲

## 要点

抓不到包先分类：证书没配好 / 非 HTTP 流量 / 反模拟器 / 反代理 / 反证书。单向校验 XP 框架通杀，双向要提证书；反代理优先试 Postern 走 APP 内 VPN，不行就 Proxifier 从 PC 端抓进程，最后才是逆向重打包（成本最高还要过签名校验）。绕过顺序记住：工具绕过 > 环境伪装 > 逆向重打包
