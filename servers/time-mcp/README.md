# CU TiME MCP

Локальный MCP-сервер для учебного мессенджера CU: <https://time.cu.ru/>.
Он читает каналы и сообщения, ищет пользователей, отвечает в тредах и
отправляет сообщения через TiME API v4.

## Как устроена авторизация

PAT и отдельный OAuth-клиент не нужны. При первом запуске сервер:

1. открывает отдельное окно Google Chrome;
2. показывает обычную страницу TiME;
3. пользователь нажимает «Я из ЦУ» и проходит SSO с кодом из SMS;
4. сервер получает сессионный токен из браузерного контекста;
5. проверяет его запросом к TiME API;
6. сохраняет токен в macOS Keychain.

При следующих запусках окно не открывается, пока сохранённая сессия работает.
Когда она истечёт, авторизация откроется снова. Пароль и SMS-код MCP не видит и
не сохраняет: они вводятся только на страницах ЦУ.

Для браузера используется отдельный профиль `~/.time-mcp/browser-profile`.
Обычный профиль Chrome не изменяется.

## Требования

- macOS;
- Google Chrome;
- Node.js 20.19 или новее.

## Установка

```bash
cd /Users/vladimirkucin/CU/time-mcp
./.venv/node/bin/npm ci
./.venv/node/bin/npm run build
```

Файл `.env` исключён из Git. Базовой конфигурации достаточно:

```dotenv
TIME_URL=https://time.cu.ru
TIME_BROWSER_CHANNEL=chrome
TIME_AUTH_TIMEOUT_MS=300000
TIME_REQUEST_TIMEOUT_MS=30000
```

Если Chrome установлен нестандартно, укажите исполняемый файл:

```dotenv
TIME_BROWSER_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

## Запуск

```bash
./run.sh
```

При первом запуске заверши вход в открывшемся Chrome. После сообщения
`TiME session saved for future launches` сервер готов к работе.

Для проверки MCP-протокола:

```bash
./.venv/node/bin/npx @modelcontextprotocol/inspector ./run.sh
```

## Инструменты авторизации

- `time_login` — принудительно открыть браузер и пройти вход заново;
- `time_auth_status` — проверить текущую сессию без открытия браузера;
- `time_logout` — удалить API-токен из хранилища MCP.

`time_logout` не завершает SSO-сессию ЦУ в отдельном браузерном профиле. Поэтому
следующий вход может пройти автоматически. Для полного выхода закрой сервер и
удали каталог `~/.time-mcp/browser-profile` вручную.

## Подключение к MCP-клиенту

После сборки добавь сервер в конфигурацию клиента:

```json
{
  "mcpServers": {
    "cu-time": {
      "command": "/Users/vladimirkucin/CU/time-mcp/run.sh",
      "args": [],
      "env": {
        "TIME_URL": "https://time.cu.ru",
        "TIME_BROWSER_CHANNEL": "chrome"
      }
    }
  }
}
```

Токен бота или ранее полученный session token всё ещё можно передать через
`TIME_TOKEN`; тогда браузер не откроется.

## Команды разработки

```bash
./.venv/node/bin/npm run typecheck
./.venv/node/bin/npm test
./.venv/node/bin/npm run build
```

## Реализованные возможности

- пользователи: текущий пользователь, получение и поиск;
- команды: список и информация о непрочитанном;
- каналы: список, поиск и информация о непрочитанном;
- сообщения: чтение, поиск, отправка и ответы в тредах;
- треды: список, чтение, подписка и отметка прочитанного.

## Основа проекта

Проект основан на MIT-проекте
[`BarredEwe/time-messenger-mcp-server`](https://github.com/BarredEwe/time-messenger-mcp-server).
Исходная лицензия сохранена в `LICENSE`.

Документация TiME: <https://docs.time-messenger.ru/api/cookbook/intro-integration/>.
