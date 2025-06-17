/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
  async fetch(request, env, ctx) {
    // This 'fetch' handler is for responding to HTTP requests, like Slack slash commands.
    // If you ONLY want the scheduled automatic update for a pre-configured user,
    // you might not need this handler, or you could simplify it.

    if (request.method !== 'POST') {
      return new Response('Expected POST request for Slack command', { status: 405 });
    }

    // IMPORTANT: Verify Slack requests for security!
    // This is a simplified example. In a production app, you MUST verify requests.
    // See: https://api.slack.com/authentication/verifying-requests-from-slack
    // You would use env.SLACK_SIGNING_SECRET, request headers, and the request body.
    // For brevity, full verification logic is omitted here but is crucial.
    // const isVerified = await verifySlackRequest(request, env.SLACK_SIGNING_SECRET);
    // if (!isVerified) {
    //   return new Response('Slack request verification failed', { status: 403 });
    // }

    try {
      const formData = await request.formData();
      const command = formData.get('command');
      const location = formData.get('text')?.trim(); // Location from slash command
      const userId = formData.get('user_id');
      // const responseUrl = formData.get('response_url'); // For deferred responses

      if (!location) {
        return new Response('Please provide a location. Usage: /weatherstatus <location>', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 1. Fetch weather data
      const weather = await fetchWeather(location, env.WEATHER_API_KEY);

      // 2. Process weather data
      const tempF = convertKelvinToFahrenheit(weather.main.temp);
      const isRaining = checkIfRaining(weather.weather);

      let responseText = `Weather in ${location}: ${tempF.toFixed(1)}°F. `;
      responseText += isRaining ? "It's raining." : "It's not raining.";

      // 3. Check conditions and set Slack status
      if (tempF > 85 && !isRaining) {
        const statusText = "in a meeting";
        const statusEmoji = ":calendar:"; // You can customize this
        await setSlackUserStatus(userId, env.SLACK_BOT_TOKEN, statusText, statusEmoji);
        responseText += ` Your Slack status has been updated to "${statusText} ${statusEmoji}".`;
      } else {
        responseText += " Conditions not met to change status (requires >85°F and no rain).";
      }

      // Respond to Slack. Slack expects a 200 OK.
      // For slash commands, you can return a JSON payload for richer messages.
      // Here, we send a simple text response.
      return new Response(JSON.stringify({ response_type: 'ephemeral', text: responseText }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('Error processing Slack command:', error);
      return new Response(JSON.stringify({ response_type: 'ephemeral', text: `Sorry, an error occurred: ${error.message}` }), {
        status: 200, // Slack expects 200 even for errors displayed to user
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },

  // This 'scheduled' handler is triggered by the cron schedule in wrangler.toml
  async scheduled(event, env, ctx) {
    console.log(`Scheduled event triggered at: ${new Date(event.scheduledTime).toISOString()}`);

    const location = env.DEFAULT_LOCATION;
    const userId = env.SLACK_USER_ID_TO_UPDATE;
    const weatherApiKey = env.WEATHER_API_KEY;
    const slackBotToken = env.SLACK_BOT_TOKEN;

    if (!location || !userId) {
      console.error("Error: DEFAULT_LOCATION or SLACK_USER_ID_TO_UPDATE secret is not set for the scheduled task.");
      return;
    }
    if (!weatherApiKey) {
      console.error("Error: WEATHER_API_KEY secret is not set.");
      return;
    }
    if (!slackBotToken) {
      console.error("Error: SLACK_BOT_TOKEN secret is not set.");
      return;
    }

    try {
      console.log(`Fetching weather for scheduled task: Location - ${location}, UserID - ${userId}`);
      const weather = await fetchWeather(location, weatherApiKey);
      const tempF = convertKelvinToFahrenheit(weather.main.temp);
      const isRaining = checkIfRaining(weather.weather);

      if (tempF > 85 && !isRaining) {
        const statusText = "in a meeting";
        const statusEmoji = ":calendar:";
        await setSlackUserStatus(userId, slackBotToken, statusText, statusEmoji);
        console.log(`Scheduled: Slack status updated for user ${userId} to "${statusText}" due to weather in ${location} (${tempF.toFixed(1)}°F, Not Raining).`);
      } else {
        console.log(`Scheduled: Conditions not met in ${location} for user ${userId}. Temp: ${tempF.toFixed(1)}°F, Raining: ${isRaining}. Status not changed.`);
      }
    } catch (error) {
      console.error('Error during scheduled task:', error.message, error.stack ? error.stack : '');
    }
  }
};

async function fetchWeather(location, apiKey) {
  const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}`;
  const response = await fetch(apiUrl);
  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Weather API error (${response.status}): ${errorData}`);
  }
  return response.json();
}

function convertKelvinToFahrenheit(kelvin) {
  return (kelvin - 273.15) * 9/5 + 32;
}

function checkIfRaining(weatherConditions) {
  // OpenWeatherMap 'weather' is an array of condition objects.
  // See: https://openweathermap.org/weather-conditions
  if (!weatherConditions || weatherConditions.length === 0) {
    return false;
  }
  // Check for codes in the 2xx (Thunderstorm), 3xx (Drizzle), 5xx (Rain) ranges.
  return weatherConditions.some(condition => {
    const mainCategory = Math.floor(condition.id / 100);
    return mainCategory === 2 || mainCategory === 3 || mainCategory === 5;
  });
}

async function setSlackUserStatus(userId, botToken, statusText, statusEmoji) {
  const apiUrl = 'https://slack.com/api/users.profile.set';
  const payload = {
    profile: {
      status_text: statusText,
      status_emoji: statusEmoji,
      status_expiration: 0, // 0 means status does not automatically clear
    },
    user: userId, // Specify the user ID for whom to set the status
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!data.ok) {
    console.error('Slack API Error (users.profile.set):', data.error, data);
    throw new Error(`Slack API error setting status: ${data.error}`);
  }
  console.log(`Slack status updated successfully for user ${userId}:`, data.ok);
  return data;
}

// Note on Slack Request Verification:
// For a production app, you MUST implement Slack request verification.
// This involves using the `X-Slack-Request-Timestamp` and `X-Slack-Signature` headers,
// the raw request body, and your `SLACK_SIGNING_SECRET`.
// Cloudflare Workers provide the `crypto.subtle` API for HMAC SHA256 hashing.
// See: https://api.slack.com/authentication/verifying-requests-from-slack