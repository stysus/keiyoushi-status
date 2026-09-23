# Keiyoushi Extension Status

Automated health monitoring and issue tracking dashboard for the [Keiyoushi](https://github.com/keiyoushi/extensions) extensions ecosystem.

[![Status Workflow](https://github.com/stysus/keiyoushi-status/actions/workflows/status.yaml/badge.svg)](https://github.com/stysus/keiyoushi-status/actions/workflows/status.yaml)
[![Live Dashboard](https://img.shields.io/badge/Live-Web%20Dashboard-10b981?style=flat&logo=githubpages&logoColor=white)](https://stysus.github.io/keiyoushi-status/)

---

## 🌐 Live Web Dashboard

Explore real-time extension health, issue status, and bug mappings directly through the interactive web dashboard:

👉 **[https://stysus.github.io/keiyoushi-status/](https://stysus.github.io/keiyoushi-status/)**

Features:
- **Instant Search & Filtering**: Filter by operational status, category, HTTP response codes, and keywords.
- **Extensions Health**: Latency timing, redirect tracking, Cloudflare IUAM/challenge detection, WAF classification, and DNS resolution statuses.
- **Issue Tracking**: Cross-checks URLs submitted in `keiyoushi/extensions-source` issues (Source request, Domain changed).
- **Bug Issue Mapping**: Automated AST & fuzzy matching mapping open bug reports to specific extensions and domains.

---

## 📊 Structured Data Endpoints (JSON)

Status data is generated automatically and published as structured JSON files for programmatic consumption:

| Endpoint | Description |
| :--- | :--- |
| [`web/data/extensions.json`](web/data/extensions.json) | Comprehensive status check results for all extension sources |
| [`web/data/issues.json`](web/data/issues.json) | Health check results for URLs extracted from GitHub issues |
| [`web/data/issue_map.json`](web/data/issue_map.json) | Mapped relationships between open bug issues and extension sources |

### Example Schema (`extensions.json`)

```json
{
  "count": 1522,
  "timestamp": "2026-09-24T00:00:00+00:00",
  "user_agent": "Mozilla/5.0 ...",
  "results": [
    {
      "status": "✅",
      "name": "MangaDex",
      "url": "https://mangadex.org",
      "duration": 0.345,
      "time": "0.345s",
      "info": "",
      "subcategory": ""
    }
  ]
}
```

---

## ⚙️ Architecture & Automation

- **Engine**: Powered by Python 3.11+ using `aiohttp`, `dnspython` (with DoH TLD-aware smart routing), `publicsuffixlist`, and `beautifulsoup4`.
- **Workflow**: Scheduled GitHub Actions pipeline (`.github/workflows/status.yaml`) executes scraping, validates network health, correlates GitHub issues, and deploys the updated dashboard to GitHub Pages.
- **Dashboard-First**: Single source of truth centered on structured JSON payloads, keeping Git repository history clean and lightweight without markdown report churn.
