// /weather-slack-updater/src/index.js

const CONFIG_KEY_PREFIX = "user_config::";

// --- Cryptography Helpers for Slack Tokens ---
// Requires an ENCRYPTION_KEY_SECRET to be set in your Worker's secrets.
// This should be a securely generated, base64-encoded 32-byte key for AES-256-GCM.
// Generate one with: `openssl rand -base64 32` then set with `wrangler secret put ENCRYPTION_KEY_SECRET`

async function getEncryptionKey(env) {
  if (!env.ENCRYPTION_KEY_SECRET) {
    console.error("FATAL: ENCRYPTION_KEY_SECRET is not configured. Cannot encrypt/decrypt tokens.");
    throw new Error("Server configuration error: Encryption key missing.");
  }
  try {
    // Decode the base64 secret to get the raw key bytes
    const rawKey = Uint8Array.from(atob(env.ENCRYPTION_KEY_SECRET), c => c.charCodeAt(0));
    return crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      false, // non-extractable
      ["encrypt", "decrypt"]
    );
  } catch (e) {
    console.error("Failed to import encryption key:", e.message);
    throw new Error("Server configuration error: Invalid encryption key.");
  }
}

// Helper to convert Uint8Array to a Base64 string
function uint8ArrayToBase64(arrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function encryptData(data, env) {
  const key = await getEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // Initialization Vector for AES-GCM
  const encodedData = new TextEncoder().encode(data);

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encodedData
  );

  // Combine IV and ciphertext, then base64 encode for storage
  const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encryptedBuffer), iv.length);
  return uint8ArrayToBase64(combined.buffer); // Store as base64 string
}

async function decryptData(encryptedDataB64, env) {
  const key = await getEncryptionKey(env);
  const combined = Uint8Array.from(atob(encryptedDataB64), c => c.charCodeAt(0));

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decryptedBuffer);
}

// --- KV Store Interaction ---

async function saveUserConfig(env, userId, configData) {
  if (!userId || !configData.slackToken || !configData.slackChannel || !configData.location) {
    throw new Error("Missing required configuration fields for saving.");
  }
  const encryptedSlackToken = await encryptData(configData.slackToken, env);
  const storableConfig = {
    ...configData,
    slackToken: encryptedSlackToken, // Store the encrypted token
  };
  await env.USER_CONFIGS.put(`${CONFIG_KEY_PREFIX}${userId}`, JSON.stringify(storableConfig));
  console.log(`Configuration saved for user: ${userId}`);
}

async function getUserConfig(env, userId) {
  const configStr = await env.USER_CONFIGS.get(`${CONFIG_KEY_PREFIX}${userId}`);
  if (!configStr) {
    return null;
  }
  const storedConfig = JSON.parse(configStr);
  // Decrypt the Slack token before returning the config
  const decryptedSlackToken = await decryptData(storedConfig.slackToken, env);
  return {
    ...storedConfig,
    slackToken: decryptedSlackToken,
  };
}

async function getAllUserConfigs(env) {
  const listResult = await env.USER_CONFIGS.list({ prefix: CONFIG_KEY_PREFIX });
  const configs = {};
  for (const key of listResult.keys) {
    const userId = key.name.replace(CONFIG_KEY_PREFIX, "");
    try {
      const config = await getUserConfig(env, userId); // Re-uses single get logic with decryption
      if (config) {
        configs[userId] = config;
      }
    } catch (error) {
      console.error(`Failed to load or decrypt config for user ${userId}: ${error.message}`);
      // Decide if you want to skip this user or halt (halting might be too drastic for a scheduled job)
    }
  }
  return configs;
}

// --- External API Interactions ---

async function getWeatherData(location, apiKey) {
  if (!apiKey) {
    console.error("Weather API key is not configured in Worker secrets.");
    throw new Error("Server configuration error: Weather API key missing.");
  }
  // Example using WeatherAPI.com - adapt to your chosen provider
  const weatherApiUrl = `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${encodeURIComponent(location)}&aqi=no`;

  console.log(`Fetching weather for: ${location}`);
  const response = await fetch(weatherApiUrl, { headers: { "User-Agent": "WeatherSlackUpdater/1.0" } });
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Weather API error for ${location}: ${response.status} - ${errorText}`);
    throw new Error(`Failed to fetch weather for ${location}. Status: ${response.status}`);
  }
  const data = await response.json();
  return {
    temperature: data.current.temp_c,
    condition: data.current.condition.text,
    // Ensure icon URL is HTTPS, WeatherAPI often provides protocol-relative URLs like //cdn.weatherapi.com/...
    iconUrl: data.current.condition.icon
      ? (data.current.condition.icon.startsWith('//') ? `https:${data.current.condition.icon}` : data.current.condition.icon)
      : undefined,
  };
}

async function postToSlack(userSlackToken, channel, messageText, blocks) {
  console.log(`Posting to Slack channel ${channel} (token starts with ${userSlackToken.substring(0,10)}...)`);
  const payload = {
    channel: channel,
    text: messageText, // Fallback text for notifications
  };
  if (blocks) {
    payload.blocks = blocks; // For richer formatting
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${userSlackToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  const responseData = await response.json();
  if (!response.ok || !responseData.ok) {
    console.error(`Slack API error: ${response.status}`, responseData.error || await response.text());
    throw new Error(`Slack API error: ${responseData.error || 'Unknown error during Slack post'}`);
  }
  console.log("Message posted to Slack successfully.");
  return responseData;
}

// --- Cloudflare Worker Event Handlers ---

export default {
  async scheduled(event, env, ctx) {
    console.log(`Cron job triggered: ${event.cron} at ${new Date(event.scheduledTime).toISOString()}`);
    const weatherApiKey = env.WEATHER_API_KEY;

    if (!weatherApiKey) {
      console.error("FATAL: WEATHER_API_KEY secret is not set. Scheduled task cannot run.");
      return;
    }
    if (!env.ENCRYPTION_KEY_SECRET) {
      console.error("FATAL: ENCRYPTION_KEY_SECRET secret is not set. Cannot process user data. Scheduled task cannot run.");
      return;
    }

    const allConfigs = await getAllUserConfigs(env);
    let successCount = 0;
    let failureCount = 0;

    for (const [userId, config] of Object.entries(allConfigs)) {
      if (!config || !config.slackToken || !config.slackChannel || !config.location) {
        console.warn(`Skipping user ${userId} due to incomplete or invalid configuration after load.`);
        failureCount++;
        continue;
      }
      try {
        console.log(`Processing user: ${userId} for location: ${config.location}`);
        const weather = await getWeatherData(config.location, weatherApiKey);

        const fallbackText = `Weather in ${config.location}: ${weather.temperature}°C, ${weather.condition}.`;
        const blocks = [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": `Hi ${userId}! Here's your weather update for *${config.location}*:`
            }
          },
          {
            "type": "section",
            "fields": [
              { "type": "mrkdwn", "text": `*Temperature:*\n${weather.temperature}°C` },
              { "type": "mrkdwn", "text": `*Condition:*\n${weather.condition}` }
            ],
            "accessory": weather.iconUrl ? {
              "type": "image",
              "image_url": weather.iconUrl, // Already ensured it's HTTPS or absolute
              "alt_text": weather.condition
            } : undefined
          }
        ];

        await postToSlack(config.slackToken, config.slackChannel, fallbackText, blocks);
        successCount++;
      } catch (error) {
        console.error(`Error processing scheduled update for user ${userId}: ${error.message}`, error.stack ? error.stack : '');
        failureCount++;
      }
    }
    console.log(`Scheduled task finished. Successes: ${successCount}, Failures: ${failureCount}`);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/configure") {
      // IMPORTANT: This endpoint MUST be secured in a production environment!
      // Options: Cloudflare Access, API Key authentication, mTLS, etc.
      // For simplicity, this example does not include authentication.
      if (!env.ENCRYPTION_KEY_SECRET) {
         return new Response(JSON.stringify({ error: "Server configuration error: Cannot save configuration securely." }), {
            status: 503, headers: { "Content-Type": "application/json" },
         });
      }
      try {
        const body = await request.json();
        const { userId, slackToken, slackChannel, location } = body;

        if (!userId || !slackToken || !slackChannel || !location) {
          return new Response(JSON.stringify({ error: "Missing required fields: userId, slackToken, slackChannel, location" }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }
        // Add more validation here (e.g., token format, channel format)

        await saveUserConfig(env, userId, { slackToken, slackChannel, location });
        return new Response(JSON.stringify({ message: `Configuration for user ${userId} saved successfully.` }), {
          status: 201, headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error("Configuration endpoint error:", error.message, error.stack ? error.stack : '');
        const userFacingError = error.message.startsWith("Server configuration error") ? error.message : "Failed to save configuration.";
        return new Response(JSON.stringify({ error: userFacingError }), {
          status: error.message.startsWith("Server configuration error") ? 503 : 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    return new Response("Not Found. Available endpoints: POST /configure, GET /health", { status: 404 });
  },
};
