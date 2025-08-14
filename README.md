# Telegram File Uploader

A Node.js application that lets users upload files via a Telegram bot, stores them in a private channel, and provides proxy download URLs.

## Features

- Upload files via Telegram bot
- Files are stored in a private Telegram channel
- Generates public download links that proxy through your server
- Tracks file downloads and user statistics
- Admin dashboard for monitoring usage

## Prerequisites

- Node.js 18+ and npm/yarn
- PostgreSQL database
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- A Telegram channel to store uploaded files

## Setup

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd telegram-file-uploader
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file based on `env.example`:

   ```bash
   cp env.example .env
   ```

4. Update the `.env` file with your credentials:

   - Add your Telegram Bot Token from BotFather
   - Create a private channel and add your bot as an admin
   - Get the channel ID (use a tool like @username_to_id_bot)
   - Set your PostgreSQL database URL
   - Configure your public URL and admin API key

5. Set up the database:

   ```bash
   npm run migrate
   ```

6. Build and start the application:

   ```bash
   npm run build
   npm start
   ```

   For development:

   ```bash
   npm run dev
   ```

## Production Deployment

### Docker Deployment (Recommended)

The easiest way to deploy in production is using Docker:

```bash
# Build and start containers
docker-compose up -d

# View logs
docker-compose logs -f

# Stop containers
docker-compose down
```

### Manual Deployment

For manual deployment:

1. Set NODE_ENV to production:

```bash
export NODE_ENV=production
```

2. Build and start the application:

```bash
npm run build
npm run prod:start
```

### Production Features

This application includes several production-ready features:

- **Clustering**: Automatically utilizes all CPU cores in production
- **Rate Limiting**: Prevents abuse of the API
- **Security Headers**: Helmet middleware provides security headers
- **Structured Logging**: Winston logger with different formats for dev/prod
- **Performance Monitoring**: Tracks and logs slow responses
- **Graceful Shutdown**: Properly closes connections on shutdown
- **Health Checks**: Built-in health endpoint for monitoring
- **Error Handling**: Comprehensive error handling and reporting
- **Singleton Database Connection**: Efficient database connection management

## Usage

### Telegram Bot

1. Start a chat with your bot on Telegram
2. Send the `/start` command to register
3. Send any file as an attachment
4. The bot will upload it and reply with a download link

### Download API

- Public endpoint: `GET /download/:id`
  This proxies the file from Telegram through your server

### Admin API

- Stats endpoint: `GET /admin/stats`
  Requires the `x-api-key` header with your configured API key

## Configuration

All environment variables are centralized in the `src/config/index.ts` file, which provides a single source of truth for all application configuration. This makes the codebase more maintainable and easier to update.

### Environment Variables

- `DATABASE_URL`: PostgreSQL connection string
- `BOT_TOKEN`: Telegram Bot API token
- `UPLOAD_CHANNEL_ID`: Telegram channel ID for storing files (include the -100 prefix)
- `PORT`: Server port (default: 3000)
- `PUBLIC_URL`: Public URL where your service is hosted
- `ADMIN_API_KEY`: Secret key for admin API access
- `NODE_ENV`: Environment setting (development, production)

## License

MIT
