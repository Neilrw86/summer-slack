# Slack Weather Status Updater

This project is a Cloudflare Worker that automatically checks the weather for a configured location. If the temperature is over 85°F and it's not raining, it updates a pre-defined Slack user's status to "in a meeting".

It can also optionally be configured to respond to a Slack slash command (`/weatherstatus <location>`) to perform the same check and status update for the user invoking the command.

## Architecture Overview

The system primarily relies on a Cloudflare Worker triggered by a cron schedule. It fetches weather data from OpenWeatherMap and then interacts with the Slack API to update a user's status.

### Core Automated Flow:

```
+---------------------+      (Cron Trigger)     +--------------------------+
| Cloudflare          | -----------------------> |   Cloudflare Worker      |
| Scheduler           |                          |   (slack-weather-app)    |
| (e.g., every hour)  |                          |   - scheduled handler    |
+---------------------+                          |   - Uses env secrets:    |
                                                 |     DEFAULT_LOCATION     |
                                                 |     SLACK_USER_ID        |
                                                 +------------+-------------+
                                                              |
                                                              | 1. Fetch weather data for
                                                              |    DEFAULT_LOCATION
                                                              v
                                                 +--------------------------+
                                                 |   OpenWeatherMap API     |
                                                 |   (using WEATHER_API_KEY)|
                                                 +--------------------------+
                                                              ^
                                                              | 2. Weather data (temp, conditions)
                                                              |
                                                 +------------+-------------+
                                                 |   Cloudflare Worker      |
                                                 |   (processes weather)    |
                                                 +------------+-------------+
                                                              |
                                                              | 3. If Temp > 85°F AND Not Raining
                                                              |    (for SLACK_USER_ID_TO_UPDATE)
                                                              v
                                                 +--------------------------+
                                                 |   Slack API              |
                                                 |   (users.profile.set)    |
                                                 |   (using SLACK_BOT_TOKEN)|
                                                 +--------------------------+
                                                              ^
                                                              | 4. Status Updated
                                                              |
                                                 +------------+-------------+
                                                 |   Target Slack User's    |
                                                 |   Profile Status         |
                                                 +--------------------------+
```

### Optional Slash Command Flow:

```
+-----------------+   /weatherstatus <location>   +--------------------------+
| Slack User      | -----------------------------> |   Cloudflare Worker      |
| (in Slack)      |                                |   (slack-weather-app)    |
+-----------------+                                |   - fetch handler        |
                                                 +------------+-------------+
                                                              |
                                                              | 1. Fetch weather data for
                                                              |    <location> from command
                                                              v
                                                 +--------------------------+
                                                 |   OpenWeatherMap API     |
                                                 |   (using WEATHER_API_KEY)|
                                                 +--------------------------+
                                                              ^
                                                              | 2. Weather data
                                                              |
                                                 +------------+-------------+
                                                 |   Cloudflare Worker      |
                                                 |   (processes weather)    |
                                                 +------------+-------------+
                                                              |
                                                              | 3. If Temp > 85°F AND Not Raining
                                                              |    (for invoking user)
                                                              v
                                                 +--------------------------+
                                                 |   Slack API              |
                                                 |   (users.profile.set)    |
                                                 |   (using SLACK_BOT_TOKEN)|
                                                 +--------------------------+
                                                              ^
                                                              | 4. Status Updated &
                                                              |    Ephemeral msg to user
                                                              |
                                                 +------------+-------------+
                                                 |   Invoking Slack User    |
                                                 +--------------------------+
```

## Key Components

1.  **Cloudflare Worker (`slack-weather-app`):**
    *   The core logic resides here (`src/index.js`).
    *   **`scheduled` handler:** Triggered by a cron job (defined in `wrangler.toml`) to perform automatic checks.
    *   **`fetch` handler:** (Optional) Responds to HTTP POST requests, typically from Slack slash commands.
    *   Securely accesses API keys and configuration stored as Cloudflare secrets.
2.  **Slack App:**
    *   Required to obtain a **Bot User OAuth Token** with `users.profile:write` scope. This token allows the Worker to change user statuses.
    *   If using the slash command, it's configured here with the Worker's URL as the Request URL.
    *   Provides a **Signing Secret** to verify requests from Slack (important for the `fetch` handler).
3.  **OpenWeatherMap API:**
    *   Used to fetch current weather conditions (temperature, rain status) for a given location. Requires an API key.
4.  **Cloudflare Scheduler:**
    *   Defined by the `crons` entry in `wrangler.toml`, this service triggers the Worker's `scheduled` handler at regular intervals.

## Setup and Configuration

1.  **Create a Slack App:**
    *   Go to api.slack.com/apps and create a new app.
    *   Add the `users.profile:write` scope under "OAuth & Permissions" for Bot Tokens.
    *   Install the app to your workspace.
    *   Note down the **Bot User OAuth Token** (starts with `xoxb-`).
    *   Note down the **Signing Secret** from "Basic Information" (if using slash commands).
    *   (Optional) Create a Slash Command (e.g., `/weatherstatus`) and point its Request URL to your deployed Worker URL.

2.  **Get OpenWeatherMap API Key:**
    *   Sign up at OpenWeatherMap and get an API key.

3.  **Cloudflare Worker Setup:**
    *   Clone this repository.
    *   Install Wrangler CLI: `npm install -g wrangler`
    *   Login to Cloudflare: `wrangler login`
    *   Configure secrets (these are essential for the Worker to function):
        ```bash
        wrangler secret put SLACK_BOT_TOKEN
        # Paste your Bot User OAuth Token

        wrangler secret put WEATHER_API_KEY
        # Paste your OpenWeatherMap API key

        wrangler secret put SLACK_SIGNING_SECRET
        # Paste your Slack App's Signing Secret (if using slash command)

        # For the scheduled task:
        wrangler secret put DEFAULT_LOCATION
        # e.g., "New York" or "London,UK"

        wrangler secret put SLACK_USER_ID_TO_UPDATE
        # The Slack Member ID of the user whose status should be auto-updated
        ```

4.  **Configure `wrangler.toml`:**
    *   Ensure the `name` field matches your desired worker name.
    *   Adjust the `crons` schedule in the `[triggers]` section as needed. The default is `["0 * * * *"]` (every hour at minute 0).

## Deployment

Deploy the worker to Cloudflare:
```bash
wrangler deploy
```

## How it Works

*   **Scheduled Update:**
    1.  The Cloudflare cron scheduler triggers the `scheduled` function in `src/index.js`.
    2.  The function reads `DEFAULT_LOCATION` and `SLACK_USER_ID_TO_UPDATE` from environment secrets.
    3.  It calls `fetchWeather()` to get data from OpenWeatherMap for the `DEFAULT_LOCATION`.
    4.  It checks if the temperature is > 85°F and it's not raining.
    5.  If conditions are met, it calls `setSlackUserStatus()` to update the Slack status of `SLACK_USER_ID_TO_UPDATE` to "in a meeting" :calendar: using the `SLACK_BOT_TOKEN`.

*   **Slash Command (Optional):**
    1.  A user types `/weatherstatus <location>` in Slack.
    2.  Slack sends a POST request to the Worker's URL (configured in the Slack App).
    3.  The `fetch` handler in `src/index.js` is invoked.
    4.  (Crucial) It should first verify the request signature using `SLACK_SIGNING_SECRET`.
    5.  It extracts the `location` and `user_id` (of the invoking user) from the request.
    6.  It calls `fetchWeather()` for the provided `location`.
    7.  If conditions are met, it calls `setSlackUserStatus()` for the `user_id` who invoked the command.
    8.  An ephemeral message is sent back to the user in Slack.

## Important Notes
*   **Slack Request Verification:** For the `fetch` handler (slash commands), implementing Slack request signature verification is critical for security. The current code has a placeholder for this.
*   **Error Handling:** Basic error handling is in place, logging to the Worker console and sending error messages to Slack for slash commands.

