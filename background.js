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
1. **Conditional Contact Extraction**: Extract a contact ONLY if a PERSONAL business email address is found in the conversation. Do NOT extract a contact if only a phone number or URL is present. No Email = No Contact Record.
2. **Exclude Generic/Automated Emails**: DO NOT extract emails starting with "support@", "info@", "donotreply@", "noreply@", "admin@", "hr@", or generic "hello@".
3. **Conditional Job Extraction**: ALWAYS generate a job position entry if a job description, job URL, or salary is found in the conversation, EVEN IF there is no email. However, always include whatever contact info is available (like a phone number) in the contact_info string.
4. **Multiple Jobs**: If the contact mentions multiple distinct job opportunities, create a SEPARATE position entry for EACH one.
5. **No Data = Empty Arrays**: If NO valid personal email, phone, or job info is found, return empty arrays. No extraction for purely social "chit-chat".
6. **Data Formatting**:
   - Emails: ALWAYS lowercase.
   - Phones: REMOVE "+" and formatting. Digits only. **CRITICAL**: Ignore 10-digit numbers that appear to be LinkedIn Job IDs (found in URLs like /jobs/view/...). If a 10-digit number is the same as a number in a URL, it is NOT a phone number.
   - city: Extract city from contactLocation or message text (e.g. "Austin" from "Austin, TX").
   - state: Extract state/province from contactLocation or message text (e.g. "TX" from "Austin, TX").
   - country: Default to "US" if the context indicates USA, otherwise extract from message text. Use null if unknown.
7. **Leveraging NER Entities**: The input JSON includes pre-extracted \`ner_entities\` (emails, phones, job titles, skills, salaries). Prioritize these entities when filling out fields, but verify against the message context to resolve ambiguities.
8. **raw_payload**: MUST include contactHeadline, all messages, and ner_entities as shown in the schema below. Do NOT return an empty object.
9. **CRITICAL - Account Holder Exclusion**: The input includes an \`accountHolderName\` field — this is the name of the LinkedIn ACCOUNT OWNER whose inbox is being scraped. NEVER extract the account holder's own phone number or email as the contact's phone/email. Only extract contact info belonging to the MESSAGE SENDER (the recruiter/other person). If a message contains the account holder replying with their own phone/email, IGNORE those values entirely.

INPUT JSON FIELDS:
- contactName: Full name of the sender
- contactHeadline: Professional headline (use to extract company_name and job_title of the SENDER)
- contactLocation: Location (City/State/Country)
- linkedInUrl: LinkedIn profile URL
- linkedin_internal_id: Internal ID
- phone: Pre-extracted phone (may be null)
- email: Pre-extracted email (may be null)
- messages: Array of message strings from this contact
- ner_entities: Pre-extracted entities (emails, phones, urls, job_titles, organizations, skills, salaries, location)
- accountHolderName: Name of the LinkedIn account owner (NEVER extract this person's phone/email as the contact's info)


REQUIRED OUTPUT FORMAT (Return ONLY valid JSON, no markdown, no code blocks):
{
  "contacts": [
    {
      "full_name": "string",
      "email": "string (lowercase) or null",
      "phone": "string (digits only) or null",
      "company_name": "string or null",
      "job_title": "string or null",
      "city": "string or null",
      "state": "string or null",
      "country": "string or null (default 'US' if USA-context)",
      "postal_code": "string or null (extract from address or message)",
      "linkedin_id": "string (linkedInUrl)",
      "linkedin_internal_id": "string",
      "source_type": "bot_linkedin_message_extraction",
      "source_reference": "string (linkedInUrl — same as linkedin_id)",
      "raw_payload": {
        "contactHeadline": "string (from input contactHeadline)",
        "messages": ["array of original message strings from input"],
        "ner_entities": {"copy ner_entities object from input as-is"}
      }
    }
  ],
  "positions": [
    {
      "source": "bot_linkedin_message_extraction",
      "source_uid": "string (extract actual Job ID from URL if available, otherwise null. DO NOT use recruiter ID)",
      "title": "string (job title mentioned in message, max 500 chars)",
      "company": "string (hiring company name, max 255 chars)",
      "location": "string (job location, e.g. 'Austin, TX', max 255 chars)",
      "zip": "string or null (numeric zip code only, max 20 chars)",
      "description": "string (full job description extracted from message text)",
      "contact_info": "string - MUST be formatted EXACTLY as: 'Email: <recruiter email or empty>, Phone: <recruiter phone or empty>, apply_url: <url or empty>'",
      "notes": "string (salary/rate, tech stack, visa requirements, contract type, benefits, etc.)",
      "payload": {
        "recruiter_name": "string (contactName of the sender)",
        "recruiter_email": "string (recruiter's email)",
        "recruiter_company": "string (recruiter's company from contactHeadline)",
        "recruiter_linkedin": "string (linkedInUrl)",
        "messages": ["array of original message strings"],
        "skills": ["array of extracted skills from ner_entities"],
        "salaries": ["array of extracted salary figures"]
      }
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
  
  const params = new URLSearchParams();
  params.append('username', email);
  params.append('password', password);

  const response = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  if (!response.ok) {
    let errorMsg = `Login failed: ${response.status}`;
    try {
      const errData = await response.json();
      errorMsg = errData.message || errData.detail || errorMsg;
      if (typeof errorMsg === 'object') {
        errorMsg = JSON.stringify(errorMsg);
      }
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
    const version = chrome.runtime.getManifest().version;
    // Attach raw_payload, source_type and version to each contact
    const contacts = extractedData.contacts.map(c => ({
      ...c,
      source_type: c.source_type || "bot_linkedin_message_extraction",
      extractor_version: version,
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
    const parsedCandidate = parseInt(wblConfig.wblCandidateId);
    const candidateId = !isNaN(parsedCandidate) ? parsedCandidate : null;
    const version = chrome.runtime.getManifest().version;
    
    // Attach source, candidate_id and version to each position
    const positions = extractedData.positions.map(p => ({
      ...p,
      candidate_id: candidateId,
      extractor_version: version,
      source: p.source || "bot_linkedin_message_extraction",
      payload: p.payload || null
    }));

    console.log(`Syncing ${positions.length} positions to WBL (Candidate ID: ${candidateId})...`);
    const posRes = await authenticatedFetch(
      `${baseUrl}/email-positions/bulk`,
      {
        method: "POST",
        body: JSON.stringify({ 
          positions: positions
        })
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

  // Step 3: Log activity to job_activity_log
  try {
    const contactsInserted = results.contacts?.inserted || 0;
    const positionsInserted = results.positions?.inserted || 0;
    const totalInserted = contactsInserted + positionsInserted;
    const contactsSkipped = results.contacts?.skipped || 0;
    const positionsSkipped = results.positions?.skipped || 0;

    const parsedCandidate = parseInt(wblConfig.wblCandidateId);
    const candidateId = !isNaN(parsedCandidate) ? parsedCandidate : null;
    const parsedEmployee = parseInt(wblConfig.wblEmployeeId);
    const employeeId = !isNaN(parsedEmployee) ? parsedEmployee : null;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const activityLog = {
      job_id: 120,
      candidate_id: candidateId,
      employee_id: employeeId,
      activity_date: today,
      activity_count: totalInserted,
      notes: `LinkedIn Extraction: ${contactsInserted} contacts inserted (${contactsSkipped} skipped), ${positionsInserted} positions inserted (${positionsSkipped} skipped)`
    };

    console.log("Logging activity:", activityLog);
    const logRes = await authenticatedFetch(
      `${baseUrl}/job_activity_logs`,
      {
        method: "POST",
        body: JSON.stringify(activityLog)
      },
      wblConfig
    );

    if (logRes.ok) {
      results.activityLog = await logRes.json();
      console.log("Activity log result:", results.activityLog);
    } else {
      const errText = await logRes.text();
      console.warn(`Activity log failed (${logRes.status}): ${errText}`);
    }
  } catch (logErr) {
    // Don't fail the whole sync if activity logging fails
    console.warn("Activity logging error (non-fatal):", logErr.message);
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
        // If on a specific thread URL, navigate to main inbox first so the sidebar loads fully
        const isThreadUrl = tab.url.includes("/messaging/thread/") || tab.url.includes("/messaging/overlay/");
        if (isThreadUrl) {
          // Navigate to main inbox
          await chrome.tabs.update(tab.id, { url: "https://www.linkedin.com/messaging/" });
          // Wait for page to fully load (conversation list + chat items)
          await new Promise(resolve => setTimeout(resolve, 4000));
        }

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
        sendResponse({ status: "started" });
      } else {
        // Not on LinkedIn messaging at all — open it in a new tab
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
          "wblApiUrl", "wblEmail", "wblPassword", "wblEmployeeId", "wblCandidateId"
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
