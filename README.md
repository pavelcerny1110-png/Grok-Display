# Grok Display

Kuchyňský / výdejní displej ovládaný Grokem. Vzhled a gesta jako Display App v16.5, stav drží Cloudflare Durable Object — **stará ChatGPT appka a její Sheet se nemění**.

## Telefon A (displej)

Otevřete URL Workeru (`https://grok-display.<účet>.workers.dev`). Celá obrazovka, tap / long-press / swipe jako dřív.

## Grok (telefon B)

`POST /api/command`

```json
{
  "command_id": "cmd-unique-id",
  "action": "upsert_item",
  "payload": {
    "item": {
      "id": "order-20260905-rizek-001",
      "type": "order",
      "title": "Kuřecí řízek",
      "body": "Kuřecí řízek\nHranolky",
      "status": "waiting",
      "channel": "main"
    }
  }
}
```

Další akce: `upsert_items`, `complete_order`, `cancel_order`, `clear_display`, `attach_card`, připomínky `type: reminder` s `data.remind_at`.

## API

| Metoda | Cesta | Kdo |
|---|---|---|
| GET | `/api/display` | displej (poll) |
| POST | `/api/action` | gesta na displeji |
| POST | `/api/command` | Grok |
| GET | `/api/log` | archiv dnešní služby |

Nasazení: push do `main` → Cloudflare Workers Builds (`npx wrangler deploy`).
