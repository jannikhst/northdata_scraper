# NorthData Scraper API

REST API for scraping northdata.de content, optimized for agentic workflows.

## Quick Start

1. Copy `.env.example` to `.env` and add your northdata.de credentials
2. Run with Docker: `docker-compose up --build`
3. API available at `http://localhost:3000`

## API Endpoints

### GET /page
Get cleaned HTML content from a northdata.de page.
```
GET /page?url=https://www.northdata.de/example
GET /page?url=https://www.northdata.de/example&removeElements=false
```
- `url`: northdata.de URL (required)
- `removeElements`: Remove "history ui" and "network ui" elements (default: true)

### POST /search
Search for companies or people.
```
POST /search
Content-Type: application/json
{"query": "Company Name or Person Name"}
```

### GET /suggest
Get search suggestions.
```
GET /suggest?query=Company
```

### GET /health
Service health check.

## Features

- **Agentic Workflow Ready**: Clean, minimal HTML output optimized for AI processing
- **Token Efficient**: Removes unnecessary elements to reduce token count
- **Element Filtering**: Optional removal of specific UI elements
- **Request Blocking**: Blocks api.rupt.dev requests
- **Queue System**: Sequential processing to avoid rate limits
- **Stealth Mode**: Human-like behavior to avoid detection
- **Docker Ready**: Easy deployment with memory limits

## Development

```bash
npm install
npm run dev
```

Set `BROWSER_HEADLESS=false` in `.env` for debug mode.
