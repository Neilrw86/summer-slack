import os
import requests
from slack_sdk import WebClient
from dotenv import load_dotenv

load_dotenv()

SLACK_TOKEN = os.environ.get("SLACK_TOKEN")
USER_LOCATION = os.environ.get("USER_LOCATION")

import logging

logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

client = WebClient(token=SLACK_TOKEN)

def get_weather(location):
    """Fetches weather data from OpenWeatherMap API."""
    WEATHER_API_KEY = os.environ.get("WEATHER_API_KEY")
    url = f"http://api.openweathermap.org/data/2.5/weather?q={location}&appid={WEATHER_API_KEY}&units=imperial"
    logging.debug(f"Fetching weather data from: {url}")
    try:
        response = requests.get(url)
        response.raise_for_status()  # Raise HTTPError for bad responses (4xx or 5xx)
        weather_data = response.json()
        logging.debug(f"Weather data: {weather_data}")
        return weather_data
    except requests.exceptions.RequestException as e:
        logging.error(f"Error fetching weather data: {e}")
        return None

def update_slack_status(status_text):
    """Updates the user's Slack status."""
    try:
        result = client.users_profile_set(profile={"status_text": status_text, "status_emoji": ":meeting:"})
        logging.info(f"Slack status updated: {result}")
    except Exception as e:
        logging.error(f"Error updating Slack status: {e}")

def main():
    """Main function to orchestrate the bot."""
    logging.info("Starting Slackbot...")
    USER_LOCATION = os.environ.get("USER_LOCATION")
    if not USER_LOCATION:
        logging.error("USER_LOCATION not set in environment variables.")
        return

    weather_data = get_weather(USER_LOCATION)
    if not weather_data:
        logging.error("Could not retrieve weather data.")
        return

    temperature = weather_data['main']['temp']
    logging.info(f"Current temperature in {USER_LOCATION}: {temperature}°F")

    if temperature > 82:
        update_slack_status("In a meeting")
    else:
        update_slack_status("") # Clear status if temperature is not above 82

if __name__ == "__main__":
    main()