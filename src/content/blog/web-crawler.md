---
title: 从零搭建一个网页爬虫系统
description: 用 Flask + Playwright + MySQL 搭建动态网页爬虫系统，输入 URL 即可获取 HTML 源码、页面截图和标题信息，部署到阿里云服务器通过浏览器使用。
pubDate: 2026-04-24
tags: ['Python', 'Flask', 'Playwright', '爬虫', 'MySQL']
---

## 从零搭建一个网页爬虫系统

平时分析网页总要把源码、截图扒下来看，干脆自己写了一个爬虫系统，浏览器打开输入 URL，HTML 源码、截图、标题全给你。

功能：
- **动态页面抓取** — 基于 Playwright，SPA 也能爬
- **全页截图** — 1920×1080 视口，完整长截图
- **HTML 源码 + 标题** — 一键复制
- **历史记录** — MySQL 存储，随时回看
- **部署到服务器** — 浏览器随时随地访问

## 项目结构

```
crawler/
├── app.py              # Flask 后端，API 路由
├── config.py           # 数据库和应用配置
├── crawler.py          # Playwright 爬虫核心
├── models.py           # SQLAlchemy 数据模型
├── requirements.txt    # Python 依赖
├── .env                # 环境变量（服务器上）
├── templates/
│   └── index.html      # 前端页面
└── screenshots/        # 截图存储目录
```

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.12 + Flask |
| 爬虫 | Playwright（Chromium 无头浏览器） |
| 数据库 | MySQL 8.0 + SQLAlchemy ORM |
| 前端 | HTML + CSS + 原生 JS |
| 部署 | Gunicorn + Nginx + systemd |

## 核心实现

### 1. 爬虫模块（crawler.py）

爬虫用 Playwright 启动 Chromium 无头浏览器，抓取动态渲染后的页面。关键设计：

- **浏览器复用** — 单例模式，多个请求共享同一个浏览器实例，每次请求新建 context
- **SSRF 防护** — 过滤内网 IP（localhost、127.0.0.1、私有网段），防止被用来攻击内部服务
- **优雅降级** — 先用 `domcontentloaded` 等页面加载，再尝试 `networkidle`；超时也不丢数据，能拿到多少返回多少
- **资源释放** — context 放在 `finally` 块里关闭，防止浏览器进程泄漏

```python
class PlaywrightCrawler:
    _instance = None
    _lock = threading.Lock()

    def __init__(self):
        self._playwright = None
        self._browser = None

    def _ensure_browser(self):
        """懒加载，第一次请求时才启动浏览器"""
        if self._browser is None or not self._browser.is_connected():
            if self._playwright is None:
                self._playwright = sync_playwright().start()
            self._browser = self._playwright.chromium.launch(headless=True)

    @staticmethod
    def _is_private_url(url: str) -> bool:
        """SSRF 防护：禁止访问内网地址"""
        parsed = urlparse(url)
        hostname = parsed.hostname
        if hostname in ['localhost', '127.0.0.1', '0.0.0.0', '::1']:
            return True
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback:
                return True
        except ValueError:
            pass
        return False

    def crawl(self, url: str, screenshot_filename: str = None) -> dict:
        if self._is_private_url(url):
            return {'error': '不允许访问内网或本地地址'}

        with self._lock:
            self._ensure_browser()

        context = None
        try:
            context = self._browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 ...'
            )
            page = context.new_page()
            page.goto(url, wait_until='domcontentloaded')
            page.wait_for_load_state('networkidle', timeout=5000)

            title = page.title()
            html = page.content()
            page.screenshot(path=screenshot_path, full_page=True)

            return {'title': title, 'html': html, 'screenshot_path': screenshot_path}
        except PlaywrightTimeoutError:
            # 超时也尽量返回已有数据
            ...
        finally:
            if context:
                context.close()
```

### 2. 数据模型（models.py）

一张表存所有爬取记录，用 SQLAlchemy 2.0 的写法：

```python
from sqlalchemy.dialects.mysql import LONGTEXT

class CrawlResult(db.Model):
    __tablename__ = 'crawl_results'

    id = db.Column(db.Integer, primary_key=True)
    url = db.Column(db.Text, nullable=False)
    title = db.Column(db.String(500))
    html_content = db.Column(LONGTEXT)        # HTML 可能很大，用 LONGTEXT
    screenshot_path = db.Column(db.String(500))
    status = db.Column(db.String(20), default='pending')
    error_message = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)
```

`html_content` 用 `LONGTEXT` 而不是 `Text`，因为一个完整 HTML 页面轻松超过 64KB。

### 3. 后端 API（app.py）

五个接口，覆盖完整 CRUD：

| 接口 | 方法 | 功能 |
|------|------|------|
| `/api/crawl` | POST | 爬取指定 URL |
| `/api/history` | GET | 分页获取历史记录 |
| `/api/crawl/<id>` | GET | 获取单条详情 |
| `/api/crawl/<id>` | DELETE | 删除记录 + 截图文件 |
| `/screenshots/<id>` | GET | 获取截图图片 |

关键点：
- URL 自动补全：用户输入 `baidu.com` 自动加 `https://`
- 数据库先写 `pending` 记录，爬完再更新状态，保证异常时也有记录
- `atexit` 注册浏览器关闭钩子，服务停止时清理资源

### 4. 前端页面（index.html）

纯 HTML/CSS/JS，没有用任何框架。三个 Tab 切换展示信息：

- **基本信息** — URL、标题、状态、时间
- **HTML 源码** — 深色主题代码展示，一键复制
- **页面截图** — 全页截图预览

安全方面注意了 XSS 防护：历史记录用 `document.createElement` + `textContent` 渲染，不拼接 `innerHTML`：

```javascript
// 安全：用 textContent 防止 XSS
function renderHistory(items) {
    items.forEach(item => {
        const row = document.createElement('div');
        const urlDiv = document.createElement('div');
        urlDiv.textContent = item.url;       // 不用 innerHTML
        const titleDiv = document.createElement('div');
        titleDiv.textContent = item.title;
        row.appendChild(urlDiv);
        row.appendChild(titleDiv);
        list.appendChild(row);
    });
}
```

### 5. 配置管理（config.py）

所有敏感配置走环境变量，不硬编码：

```python
class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or os.urandom(32).hex()
    MYSQL_HOST = os.environ.get('MYSQL_HOST', 'localhost')
    MYSQL_PASSWORD = os.environ.get('MYSQL_PASSWORD', '')
```

## 部署到服务器

### 环境准备

```bash
# 系统依赖
apt update && apt install -y python3 python3-pip python3-venv mysql-server nginx

# MySQL 建库建用户
mysql -u root <<EOF
CREATE DATABASE crawler_db CHARACTER SET utf8mb4;
CREATE USER 'crawler'@'localhost' IDENTIFIED BY '你的密码';
GRANT ALL ON crawler_db.* TO 'crawler'@'localhost';
FLUSH PRIVILEGES;
EOF
```

### 安装应用

```bash
cd /opt/crawler
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
playwright install-deps
```

### 环境变量

```bash
cat > /opt/crawler/.env << 'EOF'
FLASK_ENV=production
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=crawler
MYSQL_PASSWORD=你的密码
MYSQL_DB=crawler_db
EOF
```

### systemd 服务

注册为系统服务，开机自启、崩溃自动重启：

```ini
[Unit]
Description=Crawler Web App
After=network.target mysql.service

[Service]
User=root
WorkingDirectory=/opt/crawler
EnvironmentFile=/opt/crawler/.env
ExecStart=/opt/crawler/venv/bin/gunicorn -w 1 --timeout 120 -b 127.0.0 app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Nginx 反向代理

```nginx
server {
    listen 9090;
    server_name _;
    location / {
        proxy_pass http://***;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;
    }
}
```

部署完浏览器访问即可。

## 踩坑记录

1. **`db.LongText` 不存在** — Flask-SQLAlchemy 没有这个类型，要用 `from sqlalchemy.dialects.mysql import LONGTEXT`
2. **密码里的 `@` 符号** — MySQL 密码包含 `@` 会破坏 SQLAlchemy 的 URI 解析，`mysql://user:Crawler@2024@host/db` 直接炸。密码里别用 `@`
3. **Playwright 依赖装不上** — Ubuntu 24.04 的包名改了后缀（`libasound2` → `libasound2t64`），`playwright install-deps` 会报错，需要手动 `apt install` 对应的包
4. **`networkidle` 策略** — 对有 WebSocket 或长轮询的页面会一直卡住，改成 `domcontentloaded` + 短超时 `networkidle` 更稳

## 总结

这个项目的核心思路：

1. **Playwright 做动态渲染** — 比 requests + BeautifulSoup 强在能抓 SPA 页面
2. **浏览器复用 + context 隔离** — 节省资源，每个请求干净隔离
3. **SSRF 防护** — 爬虫系统对外暴露就得防被当跳板
4. **systemd + Nginx** — 标准生产部署，稳定可靠

