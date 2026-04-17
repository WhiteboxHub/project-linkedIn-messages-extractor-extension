// Calls LLM API with JSON data and returns structured extraction result
async function callLLMAPI(jsonData, config, customPrompt = null) {
  const { llmApiProvider, llmApiKey, llmApiEndpoint, llmModelName } = config;

  if (!llmApiKey || !llmApiEndpoint || !llmModelName) {
    throw new Error("LLM configuration is incomplete. Please configure in popup.");
  }

  let prompt;
  if (customPrompt) {
    prompt = customPrompt;
  } else if (jsonData && jsonData._prompt) {
    prompt = jsonData._prompt;
  } else if (jsonData) {
    prompt = `You are a data extraction specialist. Extract structured contact and job position data from the following LinkedIn conversation data.

RULES OF ENGAGEMENT (CRITICAL):
1. **Conditional Contact Extraction**: Extract a contact ONLY if a PERSONAL business email address or phone number is found.
2. **Exclude Generic/Automated Emails**: DO NOT extract emails starting with "support@", "info@", "donotreply@", "noreply@", "admin@", "hr@", or generic "hello@".
3. **Conditional Job Extraction**: Generate a job position entry ONLY if the message mentions a specific job role AND contains a **personal email address**. Phone-only or URL-only records do NOT qualify. If no email is found, DO NOT extract the job into positions.
4. **Multiple Jobs**: If the contact mentions multiple distinct job opportunities, create a SEPARATE position entry for EACH one.
5. **No Data = Empty Arrays**: If NO valid personal email, phone, or job info is found, return empty arrays. No extraction for purely social "chit-chat".
6. **Data Formatting**:
   - Emails: ALWAYS lowercase.
   - Phones: REMOVE "+" and formatting. Digits only.
   - city: Use "contactLocation" from JSON as the city.
7. **Leveraging NER Entities**: The input JSON includes pre-extracted \`ner_entities\` (emails, phones, job titles, skills, salaries). Prioritize these entities when filling out fields, but verify against the message context to resolve ambiguities.

INPUT JSON FIELDS:
- contactName: Full name
- contactHeadline: Professional headline (use to extract company_name and job_title)
- contactLocation: Location (City/Country)
- linkedInUrl: LinkedIn profile URL
- linkedin_internal_id: Internal ID
- phone: May be null
- email: May be null
- messages: Array of message strings from this contact.
- ner_entities: Pre-extracted entities (emails, phones, urls, job_titles, organizations, skills, salaries, location)


REQUIRED OUTPUT FORMAT (Return ONLY valid JSON, no markdown, no code blocks):
{
  "contacts": [
    {
      "full_name": "string",
      "email": "string or null",
      "phone": "string (digits only) or null",
      "company_name": "string or null",
      "job_title": "string or null",
      "city": "string or null",
      "linkedin_id": "string (linkedInUrl)",
      "linkedin_internal_id": "string",
      "source_type": "bot_linkedin_message_extraction",
      "raw_payload": {}
    }
  ],
  "positions": [
    {
      "source": "bot_linkedin_message_extraction",
      "source_uid": "string (linkedin_internal_id)",
      "title": "string (job title)",
      "company": "string (company name)",
      "location": "string (job location)",
      "description": "string (full job description from message)",
      "contact_info": "string - MUST be formatted EXACTLY as: 'Email: <email or empty>, Phone: <phone or empty>, apply_url: <url or empty>'",
      "notes": "string (any extra info such as salary, stack, etc.)",
      "payload": {}
    }
  ]
}

JSON Data:
${JSON.stringify(jsonData, null, 2)}`;
  } else {
    throw new Error("No data or prompt provided");
  }

  try {
    let response;

    if (llmApiProvider === "gemini") {
      const url = llmApiEndpoint.replace("{model}", llmModelName);
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": llmApiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        return data.candidates[0].content.parts[0].text.trim();
      }
      throw new Error("Invalid Gemini response format");

    } else {
      const url = llmApiProvider === "azure"
        ? llmApiEndpoint.replace("{model}", llmModelName)
        : llmApiEndpoint;

      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${llmApiKey}`
      };

      if (llmApiProvider === "azure") {
        headers["api-key"] = llmApiKey;
      }

      response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          model: llmModelName,
          messages: [{
            role: "user",
            content: prompt
          }],
          temperature: 0.1,
          max_tokens: 8000
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content.trim();
      }
      throw new Error("Invalid API response format");
    }
  } catch (error) {
    throw new Error(`LLM API call failed: ${error.message}`);
  }
}

// Validates and parses LLM output as JSON with contacts and positions arrays
function validateAndParseJSON(rawText) {
  if (!rawText || typeof rawText !== "string") {
    console.log("JSON validation failed: not a string or empty");
    return null;
  }

  let cleaned = rawText.trim();

  // Strip markdown code blocks if present
  if (cleaned.includes("```")) {
    const matches = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (matches && matches[1]) {
      cleaned = matches[1].trim();
    } else {
      cleaned = cleaned.replace(/```/g, '').trim();
    }
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      // Ensure both arrays exist
      if (!Array.isArray(parsed.contacts)) parsed.contacts = [];
      if (!Array.isArray(parsed.positions)) parsed.positions = [];
      return parsed;
    }
    console.log("JSON validation failed: not an object");
    return null;
  } catch (err) {
    console.log("JSON parse error:", err.message, "preview:", cleaned.substring(0, 200));
    return null;
  }
}

// Checks if API key timestamp has exceeded 30 minute expiration
function isApiKeyExpired(savedTimestamp) {
  if (!savedTimestamp) return true;
  const now = Date.now();
  const thirtyMinutes = 30 * 60 * 1000;
  return (now - savedTimestamp) > thirtyMinutes;
}

// Checks if a JWT token is expired by decoding its payload
function isTokenExpired(token) {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return true;
    // Add 30 second buffer to prevent edge cases
    return (payload.exp * 1000) < (Date.now() + 30000);
  } catch {
    return true;
  }
}

// Authenticates with WBL API and returns access token
async function wblLogin(apiUrl, email, password) {
  const loginUrl = `${apiUrl.replace(/\/$/, '')}/login`;
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    let errorMsg = `Login failed: ${response.status}`;
    try {
      const errData = await response.json();
      errorMsg = errData.message || errData.detail || errorMsg;
    } catch {}
    throw new Error(errorMsg);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("Login response missing access_token");
  }
  return data.access_token;
}

// Gets a valid WBL token, auto-refreshing if expired
async function getValidToken(wblConfig) {
  const { wblApiUrl, wblEmail, wblPassword } = wblConfig;

  // Check if we have a cached token that's still valid
  const stored = await chrome.storage.local.get(["wblToken"]);
  if (stored.wblToken && !isTokenExpired(stored.wblToken)) {
    console.log("Using cached WBL token");
    return stored.wblToken;
  }

  // Token expired or missing, login again
  console.log("WBL token expired or missing, logging in...");
  const newToken = await wblLogin(wblApiUrl, wblEmail, wblPassword);
  await chrome.storage.local.set({ wblToken: newToken });
  return newToken;
}

// Makes an authenticated API call with auto token refresh on 401
async function authenticatedFetch(url, options, wblConfig) {
  let token = await getValidToken(wblConfig);

  options.headers = {
    ...options.headers,
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };

  let response = await fetch(url, options);

  // If 401, refresh token and retry once
  if (response.status === 401) {
    console.log("Got 401, refreshing token...");
    await chrome.storage.local.remove(["wblToken"]);
    token = await getValidToken(wblConfig);
    options.headers["Authorization"] = `Bearer ${token}`;
    response = await fetch(url, options);
  }

  return response;
}

// Syncs extracted data to WBL API (contacts + positions)
async function syncToWBL(extractedData, wblConfig) {
  const baseUrl = wblConfig.wblApiUrl.replace(/\/$/, '');
  const results = { contacts: null, positions: null };

  // Step 1: Sync contacts
  if (extractedData.contacts && extractedData.contacts.length > 0) {
    // Attach raw_payload and source_type to each contact
    const contacts = extractedData.contacts.map(c => ({
      ...c,
      source_type: c.source_type || "bot_linkedin_message_extraction",
      raw_payload: c.raw_payload || null
    }));

    console.log(`Syncing ${contacts.length} contacts to WBL...`);
    const contactRes = await authenticatedFetch(
      `${baseUrl}/automation-extracts/bulk`,
      {
        method: "POST",
        body: JSON.stringify({ extracts: contacts })
      },
      wblConfig
    );

    if (!contactRes.ok) {
      const errText = await contactRes.text();
      throw new Error(`Contact sync failed (${contactRes.status}): ${errText}`);
    }
    results.contacts = await contactRes.json();
    console.log("Contact sync result:", results.contacts);
  }

  // Step 2: Sync positions
  if (extractedData.positions && extractedData.positions.length > 0) {
    // Attach source to each position
    const positions = extractedData.positions.map(p => ({
      ...p,
      source: p.source || "bot_linkedin_message_extraction",
      payload: p.payload || null
    }));

    console.log(`Syncing ${positions.length} positions to WBL...`);
    const posRes = await authenticatedFetch(
      `${baseUrl}/email-positions/bulk`,
      {
        method: "POST",
        body: JSON.stringify({ positions: positions })
      },
      wblConfig
    );

    if (!posRes.ok) {
      const errText = await posRes.text();
      throw new Error(`Position sync failed (${posRes.status}): ${errText}`);
    }
    results.positions = await posRes.json();
    console.log("Position sync result:", results.positions);
  }

  return results;
}

// Main message listener for extension communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Injects content script into LinkedIn messaging tab
  if (message.action === "run_extractor") {
    (async () => {
      // Save the limit to local storage so the content script can read it
      await chrome.storage.local.set({ extractLimit: message.limit || 20 });
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url.includes("linkedin.com/messaging")) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
        sendResponse({ status: "started" });
      } else {
        chrome.tabs.create({ url: "https://www.linkedin.com/messaging/" });
        sendResponse({ status: "started" });
      }
    })();
    return true;
  }

  // Handles LLM API call request with retry logic and JSON validation
  if (message.action === "call_llm") {
    (async () => {
      try {
        const config = await chrome.storage.sync.get([
          "llmApiProvider",
          "llmApiKey",
          "llmApiEndpoint",
          "llmModelName",
          "llmApiKeyTimestamp"
        ]);

        if (config.llmApiKeyTimestamp && isApiKeyExpired(config.llmApiKeyTimestamp)) {
          await chrome.storage.sync.remove(["llmApiKey", "llmApiKeyTimestamp"]);
          sendResponse({ success: false, error: "API key has expired (30 minute limit). Please reconfigure in the extension popup." });
          return;
        }

        let jsonResult = null;
        let retryCount = 0;
        const maxRetries = 2;

        while (retryCount <= maxRetries && !jsonResult) {
          try {
            const rawOutput = await callLLMAPI(message.jsonData, config);
            console.log("LLM returned output, length:", rawOutput?.length);

            const parsed = validateAndParseJSON(rawOutput);
            if (parsed) {
              jsonResult = parsed;
              console.log("JSON validation passed. Contacts:", parsed.contacts.length, "Positions:", parsed.positions.length);
            } else {
              console.log("JSON validation failed, attempting fix...");
              if (retryCount < maxRetries) {
                const fixPrompt = `The following output is not valid JSON. Please fix it and return ONLY a valid JSON object with "contacts" and "positions" arrays. No explanations, just JSON.\n\nInvalid output:\n${rawOutput}`;
                const fixedOutput = await callLLMAPI(null, config, fixPrompt);
                const fixedParsed = validateAndParseJSON(fixedOutput);
                if (fixedParsed) {
                  jsonResult = fixedParsed;
                  console.log("Fixed JSON validation passed");
                } else {
                  retryCount++;
                  if (retryCount <= maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                  }
                }
              } else {
                retryCount++;
              }
            }

            if (!jsonResult && retryCount <= maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          } catch (error) {
            console.error("LLM API call error:", error.message);
            retryCount++;
            if (retryCount > maxRetries) {
              sendResponse({ success: false, error: `LLM API failed after ${maxRetries + 1} attempts: ${error.message}` });
              return;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        if (!jsonResult) {
          sendResponse({ success: false, error: "LLM output was not valid JSON after all retries." });
          return;
        }

        sendResponse({ success: true, data: jsonResult });
      } catch (error) {
        console.error("Error in LLM handler:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handles syncing extracted data to WBL API
  if (message.action === "sync_to_wbl") {
    (async () => {
      try {
        const wblConfig = await chrome.storage.sync.get([
          "wblApiUrl", "wblEmail", "wblPassword", "wblEmployeeId", "wblJobId"
        ]);

        if (!wblConfig.wblApiUrl || !wblConfig.wblEmail || !wblConfig.wblPassword) {
          sendResponse({ success: false, error: "WBL configuration is incomplete. Please configure in popup." });
          return;
        }

        const results = await syncToWBL(message.data, wblConfig);
        sendResponse({ success: true, results: results });
      } catch (error) {
        console.error("WBL sync error:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Handles WBL login test verification
  if (message.action === "test_wbl_login") {
    (async () => {
      try {
        const { wblApiUrl, wblEmail, wblPassword } = message.config;
        const token = await wblLogin(wblApiUrl, wblEmail, wblPassword);
        // Cache the token for future use
        await chrome.storage.local.set({ wblToken: token });
        sendResponse({ success: true, data: { message: "Login successful" } });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Forwards status messages from content script to popup
  if (message.from === "content") {
    chrome.runtime.sendMessage({
      from: "background",
      type: message.type,
      text: message.text
    });
    return true;
  }

  return true;
});
