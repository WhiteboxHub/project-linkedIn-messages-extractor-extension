(async () => {
  // ─── NER Regex Patterns ────────────────────────────────────────────────────
  const NER_EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;
  const NER_PHONE_RE = /(?:\+?[\d]{1,4}[\s\-.]?)?(?:\(?\d{2,5}\)?[\s\-.]?)?\d{3,4}[\s\-.]?\d{3,5}(?:\s?(?:ext|x|ext\.)\s?\d{1,5})?/g;
  const NER_URL_RE = /\b(?:https?:\/\/|www\.|linkedin\.com\/)[^\s"'<>)\]]+\b/gi;
  const NER_SALARY_RE = /\$\s?\d{2,3}(?:[,.]?\d{3})?(?:\s?[kK])?\s*(?:[-–to]+\s*\$?\s?\d{2,3}(?:[,.]?\d{3})?(?:\s?[kK])?)?(?:\s*\/\s*(?:year|yr|annum|month|hr|hour))?/g;
  const NER_TITLE_RE = /\b(?:Senior|Sr\.?|Junior|Jr\.?|Lead|Principal|Staff|Associate|Mid(?:-level)?|Entry[-\s]level)?\s*(?:Software|Frontend|Back[-\s]?end|Full[-\s]?Stack|Mobile|iOS|Android|DevOps|MLOps|Cloud|Data|Platform|Site Reliability|Security|QA|Test|Product|Project|Program|Embedded|Network|AI|ML|Machine Learning|NLP|GenAI|UI\/UX|UX|UI|Graphic|Systems|Infrastructure|Solutions|Technical|Sales|Recruiting|Talent)\s+(?:Engineer|Developer|Architect|Manager|Lead|Director|Analyst|Designer|Consultant|Recruiter|Specialist|Associate|Coordinator|Researcher|Scientist)(?:\s+(?:I{1,3}|IV|V|1|2|3|4))?\b/gi;
  const NER_ORG_RE = /(?:at|@|with|from|joins?|joined?)\s+([A-Z][A-Za-z0-9&'\-\s]{1,30}(?:Inc\.?|LLC\.?|Ltd\.?|Corp\.?|Co\.?|Agency|Group|Solutions|Tech|Labs?|Systems|Services|Consulting|Digital|Global)?)(?=[.,:;!?]|\s|$)/g;
  const NER_SKILL_RE = /\b(?:React(?:\.js)?|Vue(?:\.js)?|Angular(?:\.js)?|Node(?:\.js)?|Next(?:\.js)?|TypeScript|JavaScript|Python|Java|Kotlin|Swift|Golang|Rust|C\+\+|C#|\.NET|PHP|Ruby|Django|FastAPI|Flask|Spring(?:\s+Boot)?|PostgreSQL|MySQL|MongoDB|Redis|Elasticsearch|Kafka|AWS|GCP|Azure|Docker|Kubernetes|Terraform|Ansible|Jenkins|CI\/CD|GraphQL|REST(?:ful)?|gRPC|Microservices?|TensorFlow|PyTorch|Pandas|NumPy|Spark|Hadoop|dbt|Snowflake|BigQuery)\b/gi;

  const GENERIC_EMAIL_PREFIXES = [
    'support', 'info', 'donotreply', 'noreply', 'admin', 'hr', 'no-reply',
    'hello', 'contact', 'office', 'sales', 'billing', 'jobs', 'careers',
    'notifications', 'newsletter', 'team', 'mailer', 'bounce', 'postmaster'
  ];

  // ─── Core Utilities ────────────────────────────────────────────────────────

  // Detect the account holder's name from LinkedIn's nav bar (the logged-in user)
  function getAccountHolderName() {
    // LinkedIn shows the logged-in user's name in these locations
    const navProfile = document.querySelector('.global-nav__me-photo');
    const altText = navProfile?.getAttribute('alt') || '';
    if (altText && altText.length > 2) return altText.trim();

    // Fallback: try the profile link text in the nav
    const navName = document.querySelector('.t-16.t-black.t-bold')?.innerText?.trim();
    if (navName && navName.length > 2) return navName;

    return null;
  }

  function sendUpdate(type, text) {
    chrome.runtime.sendMessage({ from: "content", type, text });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForSelector(selector, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await delay(100);
    }
    return null;
  }

  // Waits until the browser URL changes from `previousUrl`
  async function waitForUrlChange(previousUrl, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.location.href !== previousUrl) return true;
      await delay(150);
    }
    return false;
  }

  // Waits until at least one .msg-s-event-listitem__body is visible in the thread panel
  async function waitForMessagesLoaded(timeoutMs = 7000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const els = document.querySelectorAll('.msg-s-event-listitem__body');
      if (els.length > 0) return true;
      await delay(150);
    }
    return false;
  }

  // ─── Phone & Email Helpers ─────────────────────────────────────────────────

  function cleanPhone(raw) {
    if (!raw) return null;
    let p = String(raw).trim();
    const hasPlus = p.startsWith('+');
    p = p.replace(/[\s\-\.\(\)]/g, '');
    if (hasPlus && !p.startsWith('+')) p = '+' + p;
    p = p.replace(/[^+\d]/g, '');
    const digits = p.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    return p;
  }

  function phoneKey(phone) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (!digits) return null;
    return digits.replace(/^0+/, '');
  }

  function isGenericEmail(email) {
    const prefix = email.split('@')[0].toLowerCase();
    return GENERIC_EMAIL_PREFIXES.some(b => prefix === b || prefix.startsWith(b + '.'));
  }

  // ─── NER Helpers ──────────────────────────────────────────────────────────

  function nerDedupe(arr) {
    return [...new Set(arr.map(s => s.trim()).filter(Boolean))];
  }

  function nerMatches(text, regex) {
    const re = new RegExp(regex.source, regex.flags);
    const results = [];
    let m;
    while ((m = re.exec(text)) !== null) results.push(m[0].trim());
    return results;
  }

  function nerGroup1(text, regex) {
    const re = new RegExp(regex.source, regex.flags);
    const results = [];
    let m;
    while ((m = re.exec(text)) !== null) if (m[1]) results.push(m[1].trim());
    return results;
  }

  function extractEntities(messages, headline = '', location = '') {
    const fullText = [...messages, headline].filter(Boolean).join(' ');

    const allEmails = nerMatches(fullText, NER_EMAIL_RE).map(e => e.toLowerCase());
    const personalEmails = nerDedupe(allEmails.filter(e => !isGenericEmail(e)));
    const genericEmails = nerDedupe(allEmails.filter(isGenericEmail));

    // Strip URLs and LinkedIn Job ID patterns (e.g., /view/1234567890) before running phone extraction
    // This prevents 10-digit Job IDs from being falsely flagged as phone numbers.
    const textWithoutUrls = fullText
      .replace(NER_URL_RE, ' ') 
      .replace(/\/view\/\d{8,15}/g, ' ')
      .replace(/\/jobs\/\d{8,15}/g, ' ');
    
    const phones = nerDedupe(nerMatches(textWithoutUrls, NER_PHONE_RE).map(cleanPhone).filter(Boolean));

    const allUrls = nerDedupe(nerMatches(fullText, NER_URL_RE));
    const applyUrls = allUrls.filter(url =>
      /apply|job|career|position|opening|role|hiring|recruit|lever\.co|greenhouse\.io|ashbyhq|workable|breezy|smartrecruiters|icims|taleo|workday|bamboo/i.test(url)
    );
    const jobTitles = nerDedupe(nerMatches(fullText, NER_TITLE_RE));
    const orgs = nerDedupe(nerGroup1(fullText, NER_ORG_RE));
    const skills = nerDedupe(nerMatches(fullText, NER_SKILL_RE));
    const salaries = nerDedupe(nerMatches(fullText, NER_SALARY_RE));

    return {
      emails: { personal: personalEmails, generic: genericEmails },
      phones,
      urls: { apply: applyUrls, all: allUrls },
      job_titles: jobTitles,
      organizations: orgs,
      skills,
      salaries,
      location: location || null,
      has_personal_email: personalEmails.length > 0,
      has_phone: phones.length > 0,
      has_apply_url: applyUrls.length > 0,
      has_job_title: jobTitles.length > 0
    };
  }

  function extractFirstEmailFromMessages(messages) {
    for (const msg of messages) {
      const matches = nerMatches(msg, NER_EMAIL_RE);
      const personal = matches.filter(e => !isGenericEmail(e.toLowerCase()));
      if (personal.length > 0) return personal[0].toLowerCase();
    }
    return null;
  }

  function extractFirstPhoneFromMessages(messages) {
    for (const msg of messages) {
      const phones = nerMatches(msg, NER_PHONE_RE).map(cleanPhone).filter(Boolean);
      if (phones.length > 0) return phones[0];
    }
    return null;
  }

  // ─── URL / ID Normalizers ──────────────────────────────────────────────────

  function normalizeEmailForKey(email) {
    if (!email) return null;
    return String(email).trim().toLowerCase();
  }

  function normalizeNameForKey(name) {
    if (!name) return null;
    return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function normalizeLinkedInUrl(url) {
    if (!url) return null;
    let u = String(url).trim();
    if (u.startsWith('//')) u = 'https:' + u;
    if (!u.startsWith('http')) {
      u = u.startsWith('/') ? 'https://www.linkedin.com' + u : 'https://www.linkedin.com/' + u;
    }
    try {
      const parsed = new URL(u);
      parsed.search = '';
      parsed.hash = '';
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      return parsed.toString().toLowerCase();
    } catch {
      return u.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
    }
  }

  function extractInternalIdFromHref(href) {
    if (!href) return null;
    try {
      const u = new URL(href, "https://linkedin.com");
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    } catch {}
    const m1 = href.match(/\/in\/([^\/?#]+)/);
    if (m1 && m1[1]) return m1[1];
    const m2 = href.match(/(ACo[A-Za-z0-9_-]+)/);
    if (m2 && m2[1]) return m2[1];
    return null;
  }

  function normalizeInternalIdForKey(id) {
    if (!id) return null;
    return String(id).trim().toLowerCase();
  }

  // ─── Deduplication ────────────────────────────────────────────────────────

  function mergeAndDedupe(rows) {
    const mapByEmail = new Map();
    const mapByInternal = new Map();
    const mapByLinkedIn = new Map();
    const mapByPhone = new Map();
    const mapByNameUrl = new Map();
    const merged = [];

    function registerMaps(item, idx) {
      const e = normalizeEmailForKey(item.email);
      const i = normalizeInternalIdForKey(item.linkedin_internal_id);
      const l = normalizeLinkedInUrl(item.linkedInUrl);
      const p = phoneKey(item.phone);
      const n = normalizeNameForKey(item.contactName);

      if (e) mapByEmail.set(e, idx);
      if (i) mapByInternal.set(i, idx);
      if (l) mapByLinkedIn.set(l, idx);
      if (p) mapByPhone.set(p, idx);
      if (n && l) mapByNameUrl.set(n + '|' + l, idx);
    }

    function findExistingIndex(item) {
      const e = normalizeEmailForKey(item.email);
      const i = normalizeInternalIdForKey(item.linkedin_internal_id);
      const l = normalizeLinkedInUrl(item.linkedInUrl);
      const p = phoneKey(item.phone);
      const n = normalizeNameForKey(item.contactName);

      if (e && mapByEmail.has(e)) return mapByEmail.get(e);
      if (i && i !== '' && mapByInternal.has(i)) return mapByInternal.get(i);
      if (l && l !== '' && mapByLinkedIn.has(l)) return mapByLinkedIn.get(l);
      if (p && mapByPhone.has(p)) return mapByPhone.get(p);
      if (n && l && mapByNameUrl.has(n + '|' + l)) return mapByNameUrl.get(n + '|' + l);
      return -1;
    }

    for (const row of rows) {
      const idx = findExistingIndex(row);
      if (idx === -1) {
        const copy = {
          contactName: row.contactName || '',
          contactHeadline: row.contactHeadline || '',
          contactLocation: row.contactLocation || '',
          linkedInUrl: row.linkedInUrl || '',
          linkedin_internal_id: row.linkedin_internal_id || '',
          phone: row.phone || null,
          email: row.email || null,
          messages: Array.isArray(row.messages) ? [...row.messages] : []
        };
        const newIdx = merged.push(copy) - 1;
        registerMaps(copy, newIdx);
      } else {
        const existing = merged[idx];
        const incomingHasEmail = row.email && String(row.email).trim() !== '';

        existing.contactName = existing.contactName || row.contactName || '';
        existing.contactHeadline = existing.contactHeadline || row.contactHeadline || '';
        existing.contactLocation = existing.contactLocation || row.contactLocation || '';
        existing.linkedInUrl = existing.linkedInUrl || row.linkedInUrl || '';
        existing.linkedin_internal_id = existing.linkedin_internal_id || row.linkedin_internal_id || '';
        existing.phone = existing.phone || row.phone || null;
        if (incomingHasEmail) existing.email = row.email;

        const set = new Set(existing.messages || []);
        for (const m of (row.messages || [])) set.add(m);
        existing.messages = Array.from(set);
        registerMaps(existing, idx);
      }
    }
    return merged;
  }

  // ─── Scraper ──────────────────────────────────────────────────────────────

  async function loadAllContacts(limit) {
    const scrollContainer = await waitForSelector('.msg-conversations-container__conversations-list', 10000);
    if (!scrollContainer) {
      sendUpdate("error", "Conversation list not found. Make sure you are on linkedin.com/messaging.");
      return [];
    }

    const firstChat = await waitForSelector('.msg-conversation-listitem__link', 10000);
    if (!firstChat) {
      sendUpdate("error", "Chat items failed to load. Please refresh LinkedIn Messaging and try again.");
      return [];
    }

    let prevHeight = 0;
    for (let i = 0; i < 50; i++) {
      const currentCount = document.querySelectorAll('.msg-conversation-listitem__link').length;
      if (currentCount >= limit) break;

      scrollContainer.scrollTo(0, scrollContainer.scrollHeight);
      await delay(1200);
      const newHeight = scrollContainer.scrollHeight;

      if (newHeight === prevHeight) {
        await delay(1000);
        if (scrollContainer.scrollHeight === prevHeight) break;
      }
      prevHeight = newHeight;
    }

    const allChats = Array.from(document.querySelectorAll('.msg-conversation-listitem__link'));
    const chats = allChats.slice(0, limit);
    sendUpdate("progress", `Found ${chats.length} conversations (limit: ${limit})`);
    return chats;
  }

  // Extracts the conversation key from the current LinkedIn messaging URL.
  // URL format: /messaging/thread/2-CONV_UUID_BASE64/
  // Message data-event-urn format: urn:li:msg_message:(profile,2-MSGID_ENDING_WITH_CONV_UUID)
  // All messages in the same conversation SHARE the same CONV_UUID suffix.
  // Stripping the '2-' prefix gives the raw base64 UUID to match against URN suffixes.
  function getConversationKey() {
    const match = window.location.pathname.match(/\/messaging\/thread\/([^/]+)/);
    if (!match) return null;
    const threadId = decodeURIComponent(match[1]);
    // Strip leading version prefix (e.g. "2-") to get pure conversation UUID in base64
    return threadId.replace(/^\d+-/, '');
  }

  // Gets the logged-in user's LinkedIn internal ID from the nav bar profile link
  function getAccountHolderProfileId() {
    // Method 1: Nav bar profile link (most reliable)
    const navLink = document.querySelector('a[href*="linkedin.com/in/"].global-nav__primary-link--me-menu') ||
                    document.querySelector('.global-nav__me a[href*="linkedin.com/in/"]') ||
                    document.querySelector('a.ember-view.global-nav__primary-link[href*="/in/"]');
    if (navLink) {
      const id = extractInternalIdFromHref(navLink.getAttribute('href'));
      if (id) return id.toLowerCase();
    }

    // Method 2: Profile photo alt text contains profile URL
    const feedIdentity = document.querySelector('.feed-identity-module__actor-meta a[href*="/in/"]');
    if (feedIdentity) {
      const id = extractInternalIdFromHref(feedIdentity.getAttribute('href'));
      if (id) return id.toLowerCase();
    }

    // Method 3: Any nav link with the user's profile  
    const anyMeLink = document.querySelector('.global-nav__me-content a[href*="/in/"]');
    if (anyMeLink) {
      const id = extractInternalIdFromHref(anyMeLink.getAttribute('href'));
      if (id) return id.toLowerCase();
    }

    return null;
  }

  // Reads ONLY the OTHER person's messages from the currently active thread.
  //
  // SELF-MESSAGE DETECTION (2024+ LinkedIn DOM):
  // LinkedIn no longer uses a --sent CSS indicator. Instead, each message group
  // has a .msg-s-message-group__meta section with the sender's profile link.
  // We compare the sender's profile ID against the account holder's profile ID
  // to determine if a message group belongs to the logged-in user (skip) or
  // the other person (collect).
  async function readCurrentThreadMessages() {
    await waitForMessagesLoaded(7000);

    // Scope to the ONE active thread panel (not the entire document)
    const threadContainer =
      document.querySelector('.msg-s-message-list.scrollable') ||
      document.querySelector('.msg-s-message-list-content') ||
      document;

    const convKey = getConversationKey();
    const senderMessages = [];

    // Get account holder's profile ID for self-detection
    const accountHolderId = getAccountHolderProfileId();
    const accountHolderName = getAccountHolderName();
    console.log('[Extractor] Account holder ID:', accountHolderId, 'Name:', accountHolderName);

    // Iterate through message GROUPS (each li = one sender's burst of messages)
    const messageGroups = Array.from(
      threadContainer.querySelectorAll('li.msg-s-message-list__event')
    );

    for (const group of messageGroups) {
      // ── Filter 1: Conversation key (wrong thread check) ────────────────────
      if (convKey) {
        const firstEvent = group.querySelector('.msg-s-event-listitem[data-event-urn]');
        if (firstEvent) {
          const urn = firstEvent.getAttribute('data-event-urn') || '';
          const urnMatch = urn.match(/,([^)]+)\)$/);
          if (urnMatch && !urnMatch[1].endsWith(convKey)) {
            continue; // This group belongs to a different conversation — skip
          }
        }
        const hasMessages = group.querySelector('.msg-s-event-listitem__body');
        if (!hasMessages) continue;
      }

      // ── Filter 2: Self-message detection (Profile URL + Name matching) ─────
      let isSelfGroup = false;

      // Method A: Check sender profile link in msg-s-message-group__meta
      const senderLink = group.querySelector('.msg-s-message-group__meta a[href*="linkedin.com/in/"]');
      if (senderLink && accountHolderId) {
        const senderId = extractInternalIdFromHref(senderLink.getAttribute('href'));
        if (senderId && senderId.toLowerCase() === accountHolderId) {
          isSelfGroup = true;
        }
      }

      // Method B: Check sender name text against account holder name
      if (!isSelfGroup && accountHolderName) {
        const senderNameEl = group.querySelector('.msg-s-message-group__name');
        if (senderNameEl) {
          const senderName = senderNameEl.innerText?.trim() || '';
          if (senderName && senderName.toLowerCase() === accountHolderName.toLowerCase()) {
            isSelfGroup = true;
          }
        }
      }

      // Method C: Legacy --sent indicator (keep as fallback for older LinkedIn versions)
      if (!isSelfGroup) {
        isSelfGroup =
          group.querySelector('.msg-s-event-with-indicator__sending-indicator--sent') !== null ||
          group.querySelector('[data-test-msg-cross-pillar-message-sending-indicator-presenter__sending-indicator--sent]') !== null;
      }

      if (isSelfGroup) {
        console.log('[Extractor] Skipping self-message group');
        continue;
      }

      // ── Collect other person's messages from this group ─────────────────────
      const bodyEls = group.querySelectorAll('.msg-s-event-listitem__body');
      for (const el of bodyEls) {
        const txt = (el.innerText || '').trim();
        if (txt && txt.length > 2) {
          senderMessages.push(
            txt.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
          );
        }
      }
    }

    return senderMessages;
  }

  // ─── LLM Integration ──────────────────────────────────────────────────────

  async function extractViaLLM(jsonData) {
    const MAX_BATCH_SIZE = 150000;
    const jsonString = JSON.stringify(jsonData, null, 2);

    if (jsonString.length > MAX_BATCH_SIZE) {
      sendUpdate("progress", `JSON too large (${Math.round(jsonString.length / 1024)}KB). Batching...`);
      return await extractInBatches(jsonData, MAX_BATCH_SIZE);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("LLM API call timed out after 60 seconds")), 60000);
      try {
        chrome.runtime.sendMessage({ action: "call_llm", jsonData }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          if (response && response.success && response.data) resolve(response.data);
          else reject(new Error(response?.error || "LLM failed to extract data"));
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(new Error(`Failed to send LLM request: ${err.message}`));
      }
    });
  }

  async function extractInBatches(jsonData, maxSize) {
    const batches = [];
    let currentBatch = [];
    let currentSize = 0;

    for (const item of jsonData) {
      const itemSize = JSON.stringify(item).length;
      if (currentSize + itemSize > maxSize && currentBatch.length > 0) {
        batches.push([...currentBatch]);
        currentBatch = [item];
        currentSize = itemSize;
      } else {
        currentBatch.push(item);
        currentSize += itemSize;
      }
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    sendUpdate("progress", `Processing ${batches.length} batches...`);
    const allContacts = [];
    const allPositions = [];

    for (let i = 0; i < batches.length; i++) {
      sendUpdate("progress", `Extracting batch ${i + 1}/${batches.length}...`);
      try {
        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: "call_llm", jsonData: batches[i] }, (response) => {
            if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
            if (response && response.success && response.data) resolve(response.data);
            else reject(new Error(response?.error || "Unknown error"));
          });
        });
        if (result.contacts) allContacts.push(...result.contacts);
        if (result.positions) allPositions.push(...result.positions);
        await delay(1000);
      } catch (err) {
        sendUpdate("progress", `Batch ${i + 1} failed: ${err.message}. Continuing...`);
      }
    }

    if (allContacts.length === 0 && allPositions.length === 0) throw new Error("All batches failed");
    return { contacts: allContacts, positions: allPositions };
  }

  function generateFallbackJSON(rows) {
    const filtered = rows.filter(r => r.linkedInUrl && r.email);
    const contacts = filtered.map(r => {
      // Parse city/state/country from contactLocation like "Austin, TX" or "New York, NY, US"
      let city = null, state = null, country = null;
      if (r.contactLocation) {
        const parts = r.contactLocation.split(',').map(s => s.trim());
        if (parts.length >= 3) {
          city = parts[0] || null;
          state = parts[1] || null;
          country = parts[2] || null;
        } else if (parts.length === 2) {
          city = parts[0] || null;
          state = parts[1] || null;
          country = 'US';
        } else {
          city = parts[0] || null;
        }
      }

      return {
        full_name: r.contactName || null,
        email: r.email ? r.email.toLowerCase() : null,
        phone: r.phone ? r.phone.replace(/\D/g, '') : null,
        company_name: null,
        job_title: null,
        city,
        state,
        country,
        postal_code: null,
        zip: null,
        linkedin_id: r.linkedInUrl || null,
        linkedin_internal_id: r.linkedin_internal_id || null,
        source_type: "bot_linkedin_message_extraction",
        extractor_version: chrome.runtime.getManifest().version,
        source_reference: r.linkedInUrl || null,
        raw_payload: {
          contactHeadline: r.contactHeadline || null,
          messages: r.messages || [],
          ner_entities: r.ner_entities || null
        }
      };
    });
    return { contacts, positions: [] };
  }

  // ─── WBL Sync ─────────────────────────────────────────────────────────────

  async function syncDataToWBL(extractedData) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WBL sync timed out after 30 seconds")), 30000);
      try {
        chrome.runtime.sendMessage({ action: "sync_to_wbl", data: extractedData }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          if (response && response.success) resolve(response.results);
          else reject(new Error(response?.error || "WBL sync failed"));
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(new Error(`Failed to sync: ${err.message}`));
      }
    });
  }

  // ─── Main Entry Point ─────────────────────────────────────────────────────

  try {
    sendUpdate("progress", "Loading conversations...");

    const storageData = await chrome.storage.local.get("extractLimit");
    const limit = storageData.extractLimit || 20;

    const chatItems = await loadAllContacts(limit);
    if (!chatItems.length) {
      sendUpdate("error", "No conversations found. Please open linkedin.com/messaging and try again.");
      return;
    }

    const results = [];
    const accountHolderName = getAccountHolderName();
    console.log('[Extractor] Account holder detected:', accountHolderName);

    for (let i = 0; i < chatItems.length; i++) {
      const chat = chatItems[i];
      sendUpdate("progress", `Processing chat ${i + 1} of ${chatItems.length}...`);

      // Capture URL before clicking so we can detect the thread change
      const urlBefore = window.location.href;

      chat.scrollIntoView({ behavior: "smooth", block: "center" });
      chat.click();

      // Wait for URL to change (LinkedIn SPA navigates to /messaging/thread/...)
      // Fallback: wait up to 4s regardless
      await Promise.race([
        waitForUrlChange(urlBefore, 4000),
        delay(4000)
      ]);

      // Extra buffer for message DOM to fully render
      await delay(1500);

      // Read contact metadata from the thread header
      // Primary source: profile card at top of message list
      // (<div class="msg-s-profile-card">) — loads reliably with messages
      const profileCard = document.querySelector('.msg-s-profile-card');

      const contactName =
        profileCard?.querySelector('.profile-card-one-to-one__profile-link span.truncate')?.innerText?.trim() ||
        document.querySelector('.msg-entity-lockup__entity-title')?.innerText?.trim() ||
        chat.querySelector('.msg-conversation-listitem__participant-names')?.innerText?.trim() ||
        '';

      // Headline: <div class="artdeco-entity-lockup__subtitle"> inside profile card
      const contactHeadline =
        profileCard?.querySelector('.artdeco-entity-lockup__subtitle')?.innerText?.trim() ||
        document.querySelector('.msg-entity-lockup__entity-info')?.innerText?.trim() ||
        '';

      // Location not available in thread header — NER will extract it from messages
      const contactLocation = '';

      // Profile URL: from profile card link OR thread header link
      const profileCardHref =
        profileCard?.querySelector('a.profile-card-one-to-one__profile-link')?.getAttribute('href') ||
        profileCard?.querySelector('a[href*="linkedin.com/in/"]')?.getAttribute('href') ||
        null;

      let headerHref = profileCardHref;
      if (!headerHref) {
        const headerLinkEl = await waitForSelector(
          '.msg-thread__link-to-profile, .msg-overlay-bubble-header__recipient-link, .msg-entity-lockup__entity-link',
          4000
        );
        if (headerLinkEl) {
          headerHref = headerLinkEl.getAttribute('href') || headerLinkEl.getAttribute('data-href') || null;
        }
      }


      // Read ONLY this thread's messages (isolated, correct)
      const senderMessages = await readCurrentThreadMessages();

      let phone = extractFirstPhoneFromMessages(senderMessages);
      let email = extractFirstEmailFromMessages(senderMessages);

      // ── Name-based self-email/phone filter ──────────────────────────────────
      // If account holder name is "Jawahar Reddy" and email is "jawahar@gmail.com",
      // the email prefix contains the account holder's first name → filter it out.
      if (email && accountHolderName) {
        const nameParts = accountHolderName.toLowerCase().split(/\s+/).filter(p => p.length > 2);
        const emailPrefix = email.split('@')[0].toLowerCase();
        const nameMatchesEmail = nameParts.some(part => emailPrefix.includes(part));
        if (nameMatchesEmail) {
          console.log(`[Extractor] Filtered self-email: "${email}" matches account holder name "${accountHolderName}"`);
          email = null;
        }
      }

      let linkedInUrl = null;
      if (headerHref) {
        let tmp;
        if (headerHref.startsWith('//')) tmp = 'https:' + headerHref;
        else if (!headerHref.startsWith('http'))
          tmp = headerHref.startsWith('/') ? 'https://www.linkedin.com' + headerHref : 'https://www.linkedin.com/' + headerHref;
        else tmp = headerHref;
        linkedInUrl = normalizeLinkedInUrl(tmp);
      }

      const linkedin_internal_id = extractInternalIdFromHref(headerHref || linkedInUrl) || '';
      const nerEntities = extractEntities(senderMessages, contactHeadline, contactLocation);

      results.push({
        contactName: contactName || '',
        contactHeadline: contactHeadline || '',
        contactLocation: contactLocation || '',
        linkedInUrl: linkedInUrl || '',
        linkedin_internal_id: linkedin_internal_id || '',
        phone: phone || nerEntities.phones[0] || null,
        email: email || nerEntities.emails.personal[0] || null,
        messages: senderMessages,
        ner_entities: nerEntities,
        accountHolderName: accountHolderName || ''
      });

      // Small pause before moving to next conversation
      await delay(500);
    }

    sendUpdate("progress", "Merging duplicate contacts...");
    const unique = mergeAndDedupe(results);
    sendUpdate("progress", `${unique.length} unique records from ${results.length} conversations`);

    // Download JSON backup
    const jsonBlob = new Blob([JSON.stringify(unique, null, 2)], { type: "application/json" });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const ajson = document.createElement("a");
    ajson.href = jsonUrl;
    ajson.download = "linkedin_messages_backup.json";
    ajson.click();
    URL.revokeObjectURL(jsonUrl);
    sendUpdate("progress", "JSON backup downloaded.");

    // LLM extraction
    let extractedData = null;
    sendUpdate("progress", "Extracting structured data via LLM...");
    try {
      extractedData = await extractViaLLM(unique);
      sendUpdate("progress", `LLM extracted: ${extractedData.contacts?.length || 0} contacts, ${extractedData.positions?.length || 0} positions`);
    } catch (err) {
      sendUpdate("progress", `LLM failed (${err.message}). Using local fallback...`);
      await delay(500);
      extractedData = generateFallbackJSON(unique);
      sendUpdate("progress", `Fallback extracted: ${extractedData.contacts?.length || 0} contacts`);
    }

    // WBL Sync
    if (extractedData && (extractedData.contacts?.length > 0 || extractedData.positions?.length > 0)) {
      sendUpdate("progress", "Syncing to WBL API...");
      try {
        const syncResults = await syncDataToWBL(extractedData);
        let summary = "✅ Sync complete! ";
        if (syncResults.contacts) {
          summary += `Contacts: ${syncResults.contacts.inserted || 0} inserted, ${syncResults.contacts.duplicates || 0} duplicates. `;
        }
        if (syncResults.positions) {
          summary += `Positions: ${syncResults.positions.inserted || 0} inserted, ${syncResults.positions.skipped || 0} skipped.`;
        }
        sendUpdate("done", summary);
      } catch (err) {
        sendUpdate("error", `WBL sync failed: ${err.message}. JSON backup was saved.`);
      }
    } else {
      sendUpdate("done", "Extraction complete. No contacts or positions found to sync.");
    }

  } catch (err) {
    sendUpdate("error", err.message || String(err));
  }
})();
