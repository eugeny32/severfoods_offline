# SeverFoods Offline

Electron-приложение для Windows — автономная работа со сканером QR-пропусков с синхронизацией с [severfoods.ru](https://severfoods.ru).

## Возможности

- Сканирование QR-кодов сотрудников через веб-камеру
- Полная офлайн-работа: сотрудники и журнал хранятся локально (SQLite)
- Автосинхронизация каждый час
- Немедленная синхронизация при восстановлении сети
- Журнал питания с отметкой статуса синхронизации
- Иконка в системном трее

## Установка и запуск (разработка)

```bash
# 1. Скопировать .env.example → .env и вставить токен
cp .env.example .env

# 2. Установить зависимости
npm install

# 3. Запустить
npm start
```

## Сборка установщика Windows

```bash
npm run build
# → dist/SeverFoods Offline Setup 1.0.0.exe
```

## Конфигурация

В файле `.env`:

```
OFFLINE_SYNC_TOKEN=<значение OFFLINE_SYNC_TOKEN из .env сервера>
```

## Синхронизация

Приложение обращается к `https://severfoods.ru/api/offline_sync.php` с заголовком `X-Sync-Token`.

Эндпоинт реализован в `/api/offline_sync.php` онлайн-репозитория.
