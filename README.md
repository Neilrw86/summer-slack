# Weather-Sensitive Slack Status Updater

This Python bot automatically updates your Slack status based on the current weather conditions. It fetches weather data from the OpenWeather API and sets your Slack status to "In a meeting" (or a custom status) if the temperature exceeds a predefined threshold (e.g., 82°F / 28°C).

## Features

*   Fetches current temperature from OpenWeather API for a specified location.
*   Updates Slack status (text and emoji) when the temperature is above a configurable threshold.
*   Optionally sets a different status when the temperature is below the threshold.
*   Configurable check interval.

## Prerequisites

*   Python 3.7+
*   An [OpenWeather API Key](https://openweathermap.org/appid)
*   A [Slack User Token](https://api.slack.com/authentication/token-types#user). The token needs the `users.profile:write` scope to change your status.

## Setup

1.  **Clone the repository (if you haven't already):**
    ```bash
    git clone https://github.com/neilrw86/summer-slack
    cd summer-slack
    ```

2.  **Install dependencies:**
    The required libraries are listed in `requirements.txt`. Install them using pip:
    ```bash
    pip install -r requirements.txt
    ```
    This will install `slack_sdk`, `requests`, and `python-dotenv`.

3.  **Configure Environment Variables:**
    Create a `.env` file in the root directory of the project (and add `.env` to your `.gitignore` file!). Populate it with your API keys and preferences:

    ```env
    # .env file
    OPENWEATHER_API_KEY="your_openweather_api_key"
    SLACK_USER_TOKEN="xoxp-your-slack-user-token"

    # Weather Configuration
    OPENWEATHER_LOCATION="New York,US"  # e.g., "City,CountryCode", "ZipCode", or "lat=XX&lon=YY"
    OPENWEATHER_UNITS="imperial"      # "imperial" for Fahrenheit, "metric" for Celsius, "standard" for Kelvin
    TEMPERATURE_THRESHOLD="82"        # Temperature threshold (in units specified above)

    # Slack Status for when it's HOT
    SLACK_STATUS_TEXT_HOT="In a meeting"
    SLACK_STATUS_EMOJI_HOT=":calendar:" # e.g., :calendar:, :no_entry:, :fire:

    # Optional: Slack Status for when it's NOT hot (leave blank to clear status)
    SLACK_STATUS_TEXT_NORMAL=""
    SLACK_STATUS_EMOJI_NORMAL=""

    # How often to check the weather, in seconds
    CHECK_INTERVAL_SECONDS="600" # e.g., 600 for 10 minutes, 3600 for 1 hour
    ```

    Your Python script should load these variables using `os.getenv()` after calling `load_dotenv()` from the `python-dotenv` library.

## Usage

Once configured, you can run the bot from your terminal:

```bash
python your_main_script_name.py
```

Replace `your_main_script_name.py` with the actual name of your Python script (e.g., `main.py`, `bot.py`). The bot will then run in the background, periodically checking the weather and updating your Slack status accordingly.

## How It Works (Example Flow)

1.  The script starts and loads the configuration from environment variables using `python-dotenv`.
2.  It enters a loop that runs every `CHECK_INTERVAL_SECONDS`.
3.  Inside the loop:
    *   It calls the OpenWeather API (using `requests`) to get the current weather for `OPENWEATHER_LOCATION` using `OPENWEATHER_API_KEY` and `OPENWEATHER_UNITS`.
    *   It extracts the current temperature.
    *   If the temperature is greater than `TEMPERATURE_THRESHOLD`:
        *   It calls the Slack API (`users.profile.set`) using `SLACK_USER_TOKEN` (via `slack_sdk`) to update the profile status with `SLACK_STATUS_TEXT_HOT` and `SLACK_STATUS_EMOJI_HOT`.
    *   Else (if the temperature is not above the threshold):
        *   It can either clear the Slack status or set it to `SLACK_STATUS_TEXT_NORMAL` and `SLACK_STATUS_EMOJI_NORMAL` if these are defined.

## Customization

*   **Location:** Change `OPENWEATHER_LOCATION` to your city, zip code, or coordinates.
*   **Temperature Threshold:** Adjust `TEMPERATURE_THRESHOLD` and `OPENWEATHER_UNITS` (Fahrenheit/Celsius).
*   **Slack Status:** Customize `SLACK_STATUS_TEXT_HOT`, `SLACK_STATUS_EMOJI_HOT`, and the optional `_NORMAL` status variables.
*   **Check Frequency:** Modify `CHECK_INTERVAL_SECONDS` to change how often the weather is checked.

## Example Python Snippets (Conceptual)

Your Python code might include functions similar to these:

```python
# conceptual example - not runnable as-is
import os
import requests
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
import time
from dotenv import load_dotenv # Import load_dotenv

load_dotenv() # Load variables from .env file

# ... (functions to get weather and update Slack status) ...
```

## Contributing

Contributions, issues, and feature requests are welcome!

## License

This project can be licensed under the MIT License if you choose. (If so, add a `LICENSE` file).
