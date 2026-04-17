# LinkedIn Message Extractor

A Chrome extension that extracts LinkedIn messages, cleans data, removes duplicates, and syncs contacts/jobs to the WBL API using AI (Groq, OpenAI, Gemini, or Azure OpenAI).

## Features

- ✅ Automatically extracts all LinkedIn conversations
- ✅ Cleans and deduplicates contact data
- ✅ AI-powered structured data extraction via LLM APIs
- ✅ Direct API sync to WBL backend (contacts + job positions)
- ✅ Automatic fallback to local extraction if LLM fails
- ✅ JWT token auto-refresh for seamless sync
- ✅ Supports multiple LLM providers

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `project-linkedIn-extension` folder
5. Pin the extension icon to your toolbar

## Configuration

1. Get an API key from your preferred LLM provider:
   - **Groq** (default): [console.groq.com](https://console.groq.com/)
   - **OpenAI**: [platform.openai.com](https://platform.openai.com/)
   - **Gemini**: [makersuite.google.com](https://makersuite.google.com/)
   - **Azure OpenAI**: Your Azure portal

2. Open the extension popup and click **⚙️ LLM Configuration**

3. Fill in:
   - **LLM Provider**: Select your provider
   - **API Key**: Paste your API key
   - **API Endpoint**: Auto-filled (or enter custom)
   - **Model Name**: Select from dropdown

4. Click **Save Configuration**

> **Note**: API keys expire after 30 minutes for security. Re-enter if needed.

## WBL Integration

1.  Open the extension popup and click **🌐 WBL Configuration**.
2.  Fill in:
    - **WBL API URL**: The base API endpoint (default: production).
    - **WBL Email/Password**: Your Whitebox Learning login credentials.
    - **Employee ID**: Your unique ID (e.g., 351).
    - **Extraction Job ID**: The target job ID (e.g., 120).
3.  Click **Save WBL Settings**.
4.  Click **Test WBL Connection** to verify your login credentials instantly.

## Usage

1. Go to [LinkedIn Messaging](https://www.linkedin.com/messaging/)
2. Click the extension icon
3. Click **Extract Messages** or **🔄 Sync to WBL**
4. Wait for completion (progress shown in popup)
5. Data is synced to WBL API. A JSON backup file is also downloaded.

**Important**: Don't close the LinkedIn tab during extraction.

## Output

### JSON Backup File

A `linkedin_user_messages_structured.json` file is downloaded as backup, containing:

- Contact name, LinkedIn URL, internal ID
- Email and phone (extracted from messages)
- All messages from each contact

### API Sync

Extracted data is pushed directly to the WBL backend:

- **`/automation-extracts/bulk`**: Contact records (full_name, email, phone, etc.)
- **`/email-positions/bulk`**: Job positions with apply links
- Source tag: `bot_linkedin_message_extraction`

## Troubleshooting

**"LLM configuration is incomplete"**

- Make sure all fields are filled and saved

**"SQL generation failed"**

- Check your API key is valid
- Verify API rate limits
- Extension will retry automatically (up to 2 times)
- **Fallback**: If LLM fails completely, the extension automatically uses a local fallback function to generate SQL
- The SQL file will still be created with a comment indicating it was generated using the fallback function

**No files downloaded**

- Check Chrome download settings
- Look in Downloads folder
- Ensure downloads aren't blocked

**Extension not working**

- Make sure you're on `linkedin.com/messaging/`
- Refresh the page and try again
- Check browser console (F12) for errors

## Supported LLM Providers

| Provider     | Default Model           |
| ------------ | ----------------------- |
| Groq         | llama-3.3-70b-versatile |
| OpenAI       | gpt-4o-mini             |
| Gemini       | gemini-1.5-flash        |
| Azure OpenAI | gpt-4o                  |

## Technical Details

- **Manifest V3** Chrome Extension
- Data processing done locally in browser
- API keys stored securely in Chrome storage
- Automatic batching for large datasets
- Retry logic with SQL validation
- **Fallback mechanism**: If LLM API fails after retries, local SQL generation function creates the SQL file automatically

## File Structure

```
project-linkedIn-extension/
├── manifest.json
├── background.js      # LLM API calls
├── content.js        # Extraction logic
├── popup.html        # UI
├── popup.js          # Configuration
└── icons/            # Extension icons
```

---

**Made for efficient LinkedIn data management**
