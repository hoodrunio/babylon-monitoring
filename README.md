# Babylon Monitoring 

A monitoring tool for the Babylon chain that tracks validators and finality providers and sends notifications for signature issues.

## Features

- Monitoring of validator block signatures, BLS signatures, and Finality Provider signatures
- Load balancing and redundancy with support for multiple RPC/LCD/WS URLs
- Ability to track specific validators or finality providers
- Notification system (Telegram, PagerDuty)
- Data storage with MongoDB
- Support for both Testnet and Mainnet

## Installation

### Requirements
- Node.js 16+ and npm
- MongoDB database
- Telegram bot and chat ID (optional)
- PagerDuty integration key (optional)

```bash
# Clone the repository
git clone https://github.com/kullaniciadi/babylon-monitoring.git
cd babylon-monitoring

# Install dependencies
npm install

# configure .env
cp .env.example .env

# build and start the app
npm run build
npm start
```

## Configuration

You can configure the following settings in the .env file:

- **MongoDB Connection**: `MONGODB_URI` parameter
- **RPC/LCD URLs**: Multiple node URLs supported (comma separated)
  - `MAINNET_RPC_URLS`, `MAINNET_REST_URLS`
  - `TESTNET_RPC_URLS`, `TESTNET_REST_URLS`
- **Monitoring Parameters**: Which monitoring modules to enable
  - `MONITORING_ENABLED`
  - `FINALITY_PROVIDER_MONITORING_ENABLED`
  - `VALIDATOR_SIGNATURE_MONITORING_ENABLED`
  - `BLS_SIGNATURE_MONITORING_ENABLED`
- **Notification Settings**: Keys/tokens for Telegram and PagerDuty
  - `TELEGRAM_ENABLED`, `MAINNET_TELEGRAM_BOT_TOKEN`, `MAINNET_TELEGRAM_CHAT_ID`
  - `PAGERDUTY_ENABLED`, `MAINNET_PAGERDUTY_INTEGRATION_KEY`
- **Tracked Validators/Finality Providers**: For monitoring specific validators (monitors all if empty)
  - `TRACKED_VALIDATORS`
  - `TRACKED_FINALITY_PROVIDERS`
- **Notification Thresholds**: Minimum signature rate thresholds for alerts
  - `VALIDATOR_SIGNATURE_THRESHOLD`
  - `FINALITY_PROVIDER_SIGNATURE_THRESHOLD`
  - `BLS_SIGNATURE_THRESHOLD`

## Usage

```bash
# Run in development mode
npm run dev

# Build
npm run build

# Run compiled version
npm start

# Run tests
npm test
```

## Architecture

This project is designed according to SOLID principles

### Project Structure

```
src/
├── clients/               # Clients for communication with Babylon chain
├── config/               # Application configuration
├── database/             # MongoDB connection and repository classes
├── models/               # Data models
├── notifiers/            # Notification services (Telegram, PagerDuty)
├── services/             # Monitoring & indexing services
└── utils/                # Helper functions
```

## LICENSE

MIT 