---
title: "云服务安全：对象存储 OSS、Bucket、域名接管、AccessKey"
pubDate: 2026-08-12
tags:
  - 安全
  - 云安全
---

云安全第一讲，对象存储（OSS）。云服务名词：阿里云 OSS、腾讯云 COS、华为云 OBS、AWS S3、谷歌 GCS、Azure Blob——统称 OSS。S3=存储、EC2=云虚拟机、RDS=云数据库、IAM=身份权限管理

Bucket 桶：存储文件的容器，名称全局唯一，可设访问权限/生命周期/跨区域复制。识别指纹：访问 OSS 域名返回 XML 错误页（如 AccessDenied）

## 权限配置不当

**公共读 → 文件读取**：桶设为公共读后，知道文件名就能直接下载读取内容；不知道文件名只能爆破。注意新版阿里云默认开"阻止公共访问"，要关掉才能设公共读

**ListObject 策略 → 文件名泄露**：Bucket 授权策略给所有用户开了 ListObject，访问桶域名根目录直接列出桶名+全部文件名，配合公共读就是全部文件裸奔

**公共读写 → 任意上传**：BP 抓包改 PUT 方法就能传文件。但危害有限——OSS 只存储不解析，传马子访问也是下载不是执行

## 域名接管

**绑定自定义域名的解析链**：

```
oss.xxxx.cn --> test010010.oss....com --> 59.110.190.36
```

实战 ping 目标子域名出现这种 CNAME 链就是 OSS。关键差异：直接访问 `test010010.oss....com/1.html` 是下载；访问绑定域名 `oss.xxxx.cn/1.html` 会解析执行。所以公共读写 + 自定义域名 = 上传恶意 html 在正式域名下解析

**接管条件**：开发者用子域名绑定了桶，之后桶删了但 DNS 的 CNAME 没删。访问显示 `NoSuchBucket`（或 ping 得通但桶不存在）→ 攻击者去同厂商创建一个同名桶 → 上传文件 → 子域名解析到攻击者的内容，域名接管完成

## AccessKey 泄露

可能泄露的位置：小程序源码、JS 源码、APP 反编译、源码配置文件/API 接口、代码托管平台（GitHub/Gitee）、`/actuator/heapdump` 堆文件（提取 SecretID/SecretKey）

各家 AccessKey 特征：https://wiki.teamssix.com/cloudservice/more/ 。拿到 AK+SK 用 OSSBrowser 或狐狸工具箱连接，直接接管存储

- 站点直接列出桶内所有文件（公共读写）：ping 拿 OSS 地址 → PUT 传文件 200 → 风险存在但无解析危害
- 访问域名显示 NoSuchBucket：去阿里云建同名桶 → 上传文件 → 该域名解析任意内容，劫持完成
- AK 泄露四渠道：JS 文件里、GitHub 托管平台、heapdump、APP/小程序反编译

## 要点

OSS 三个攻击面按危害排序：AK 泄露（直接接管云资源）> 域名接管（NoSuchBucket 时抢注同名桶）> 权限配置（读/列/传）。识别是第一步——XML 错误页、CNAME 解析链、NoSuchBucket 三种指纹要认得。文件上传本身危害低（不解析），但配合自定义域名绑定就能让恶意文件在正式域名下执行。AK 搜寻位置和前面讲的 小程序/APP/JS 挖洞是同一套思路
