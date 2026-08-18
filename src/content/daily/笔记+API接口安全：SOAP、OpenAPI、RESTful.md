---
title: "API接口安全：SOAP、OpenAPI、RESTful"
pubDate: 2026-08-13
tags:
  - 安全
  - API
---

API 攻防第一讲。API 接口就是前后端数据交互的通道，测试时关注四件事：请求方法（GET/POST/PUT/DELETE 触发不同效果）、请求路径（能不能找到非常规接口）、请求参数（类型/个数/是否加密）、状态码和响应内容。API 常见漏洞：逻辑漏洞、未授权、信息泄露、XSS、SQL 注入

## 三大 API 技术与指纹

**SOAP**（描述文件 WSDL=XML 格式）：
- 后缀 `.asmx` `.svc` `.wsdl` `.xsd`
- 路径含 `/services/*` `axis2/*` `/ws/*` `/soap/*` `/webservice/*`
- 参数 `?wsdl` `?singleWsdl` `?xsd=1` 返回 XML
- 看到老年代感页面，直接跟 `?wsdl` 试

**OpenAPI**（看 Swagger 和 Actuator）：
- 固定文件名 `openapi.json` `openapi.yaml` `/v3/api-docs` `swagger.json`
- 返回内容含 `"openapi:"` `"swagger:"` 关键字
- UI 是 Swagger-UI 或 Actuator 界面

**RESTful**（无强制描述文件，JSON/YAML/XML 都行）：
- URL 风格名词复数+资源ID：`/users/123?state=paid`，动词只在 HTTP Method
- 目录 `/api/v1/*` `/rest/*` `/api/rest/*`
- 找不到描述文档就自己慢慢找接口

## 检测工具

- **ReadyAPI**：导入 WSDL 自动发包测漏，检测周期长，Windows，需破解
- **Postman + BP + Xray 联动**（推荐）：Postman 导入描述文档 → 代理指向 BP → BP 上游代理指向 Xray 监听 7777 → `xray webscan --listen 127.0.0.1:7777 --html-output example.html`，跑接口全自动扫
- **APIKit**（BP 插件）：被动+主动扫描。主动测试要勾 API 技术类型（所以要先会分类识别）、填站点 URL 和描述文档 URL

## 思路（https://github.com/roottusk/vapi ）

docker 搭建，访问 `/vapi/`，描述文档 postman 目录下的 vAPI.postman_collection.json，导入后设变量 host。核心测法：

- **API1 越权**：Create User 拿 id → Get User 带 Token（用户名:密码 的 base64，test:test → dGVzdDp0ZXN0）查自己 → 改 id=1 查别人，没校验就遍历拿所有账号密码
- **API4 验证枚举**：验证码接口如果提交时不刷新验证码，BP 暴力破解验证码
- **API5 接口枚举**：改 id 有身份校验查不了别人 → 改接口本身，user 查单个、users 查所有，一个字母的差别
- **API8 SQL注入**：登录接口正常测注入，丢 Sqlmap
- **API9 多版本**：v2 接口爆破没回显 → 改成 v1 再爆破

- **SOAP-WSDL SQL注入**：收集到 WSDL 文档 → ReadyAPI 导入扫描 → 扫出注入接口 → 手动发包丢 Sqlmap 拿数据库权限
- **SOAP-WSDL 密码泄露**：后台 /admin/externalLogin → 发现 loadUserByUsername 接口能按用户名读密码哈希 → 发包拿到后登进后台
- **Swagger 越权泄露**：发现 Swagger-UI 能访问描述文档 → /user 接口直接给用户名 → Xray 批量跑出大量信息泄露

## 要点

先识别 API 技术类型（看后缀/路径/固定文件名/UI），拿到描述文档就赢了一半——Postman 导入联动 BP+Xray 自动化跑。手工测的五个抓手：改 id 越权、爆破验证码、单复数接口枚举、常规注入、换 v1/v2 版本绕防护
