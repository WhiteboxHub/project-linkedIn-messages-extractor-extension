(async () => {
  // ─── NER Engine ───────────────────────────────────────────────────────────────
  const NER_EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;
  const NER_PHONE_RE = /(?:\+?\d{1,4}[-.\s]?)?(?:\(?\d{2,5}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,5}(?:\s?(?:ext|x|ext\.)\s?\d{1,5})?/g;
  const NER_URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
  const NER_SALARY_RE = /\$\s?\d{2,3}(?:[,.]?\d{3})?(?:\s?[kK])?\s*(?:[-–to]+\s*\$?\s?\d{2,3}(?:[,.]?\d{3})?(?:\s?[kK])?)?(?:\s*\/\s*(?:year|yr|annum|month|hr|hour))?/g;
  const NER_TITLE_RE = /\b(?:Senior|Sr\.?|Junior|Jr\.?|Lead|Principal|Staff|Associate|Mid(?:-level)?|Entry[-\s]level)?\s*(?:Software|Frontend|Back[-\s]?end|Full[-\s]?Stack|Mobile|iOS|Android|DevOps|MLOps|Cloud|Data|Platform|Site Reliability|Security|QA|Test|Product|Project|Program|Embedded|Network|AI|ML|Machine Learning|NLP|GenAI|UI\/UX|UX|UI|Graphic|Systems|Infrastructure|Solutions|Technical|Sales|Recruiting|Talent)\s+(?:Engineer|Developer|Architect|Manager|Lead|Director|Analyst|Designer|Consultant|Recruiter|Specialist|Associate|Coordinator|Researcher|Scientist)(?:\s+(?:I{1,3}|IV|V|1|2|3|4))?\b/gi;
  const NER_ORG_RE = /(?:at|@|with|from|joins?|joined?)\s+([A-Z][A-Za-z0-9&'\-\s]{1,30}(?:Inc\.?|LLC\.?|Ltd\.?|Corp\.?|Co\.?|Agency|Group|Solutions|Tech|Labs?|Systems|Services|Consulting|Digital|Global)?)(?=[.,:;!?]|\s|$)/g;
  const NER_SKILL_RE = /\b(?:React(?:\.js)?|Vue(?:\.js)?|Angular(?:\.js)?|Node(?:\.js)?|Next(?:\.js)?|TypeScript|JavaScript|Python|Java|Kotlin|Swift|Golang|Rust|C\+\+|C#|\.NET|PHP|Ruby|Django|FastAPI|Flask|Spring(?:\s+Boot)?|PostgreSQL|MySQL|MongoDB|Redis|Elasticsearch|Kafka|AWS|GCP|Azure|Docker|Kubernetes|Terraform|Ansible|Jenkins|CI\/CD|GraphQL|REST(?:ful)?|gRPC|Microservices?|TensorFlow|PyTorch|Pandas|NumPy|Spark|Hadoop|dbt|Snowflake|BigQuery)\b/gi;

  const GENERIC_EMAIL_PREFIXES = [
    'support', 'info', 'donotreply', 'noreply', 'admin', 'hr', 'no-reply',
    'hello', 'contact', 'office', 'sales', 'billing', 'jobs', 'careers',
    'notifications', 'newsletter', 'team', 'mailer', 'bounce', 'postmaster'
  ];

  function isGenericEmail(email) {
    const prefix = email.split('@')[0].toLowerCase();
    return GENERIC_EMAIL_PREFIXES.some(b => prefix === b || prefix.startsWith(b + '.'));
  }

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

  function cleanPhone(raw) {
    const d = raw.replace(/\D/g, '');
    return (d.length >= 10 && d.length <= 15) ? d : null;
  }

  /**
   * Extracts named entities from messages + headline.
   * Returns rich entity object for LLM hint injection.
   */
  function extractEntities(messages, headline = '', location = '') {
    const fullText = [...messages, headline].filter(Boolean).join(' ');

    const allEmails = nerMatches(fullText, NER_EMAIL_RE).map(e => e.toLowerCase());
    const personalEmails = nerDedupe(allEmails.filter(e => !isGenericEmail(e)));
    const genericEmails = nerDedupe(allEmails.filter(isGenericEmail));

    const phones = nerDedupe(nerMatches(fullText, NER_PHONE_RE).map(cleanPhone).filter(Boolean));
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

  // Legacy single-match helpers (used elsewhere in this file)
  function extractFirstEmailFromMessages(messages) {
    for (const msg of messages) {
      const m = nerMatches(msg, NER_EMAIL_RE);
      const personal = m.filter(e => !isGenericEmail(e.toLowerCase()));
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

  // Sends status update message to popup via background script
  function sendUpdate(type, text) {
    chrome.runtime.sendMessage({ from: "content", type, text });
  }

  // Creates a delay promise for specified milliseconds
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Waits for a DOM selector to appear with timeout
  async function waitForSelector(selector, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await delay(100);
    }
    return null;
  }

  // Cleans and normalizes a raw phone number string
  function cleanPhone(raw) {
    if (!raw) return null;
    let p = String(raw).trim();
    const hasPlus = p.startsWith('+');
    p = p.replace(/[\s\-\.\(\)]/g, '');
    if (hasPlus && !p.startsWith('+')) p = '+' + p;
    p = p.replace(/[^+\d]/g, '');
    const digits = p.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) return null;
    return p;
  }

  // Generates a normalized phone key for deduplication
  function phoneKey(phone) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (!digits) return null;
    return digits.replace(/^0+/, '');
  }

  // Extracts the first valid phone number from message array
  function extractFirstPhoneFromMessages(messages) {
    if (!messages || !messages.length) return null;
    for (const msg of messages) {
      const match = msg.match(PHONE_RE);
      if (match && match.length) {
        for (const raw of match) {
          const cp = cleanPhone(raw);
          if (cp) return cp;
        }
      }
    }
    return null;
  }

  // Extracts the first valid email address from message array, filtering out generic ones
  function extractFirstEmailFromMessages(messages) {
    if (!messages || !messages.length) return null;
    for (const msg of messages) {
      const m = msg.match(EMAIL_RE);
      if (m && m.length) {
        for (const email of m) {
          const lower = email.trim().toLowerCase();
          const prefix = lower.split('@')[0];
          if (!GENERIC_EMAIL_PREFIXES.some(p => prefix === p || prefix.startsWith(p + '-'))) {
            return lower;
          }
        }
      }
    }
    return null;
  }

  // Normalizes email address to lowercase for key generation
  function normalizeEmailForKey(email) {
    if (!email) return null;
    return String(email).trim().toLowerCase();
  }

  // Normalizes contact name for key generation
  function normalizeNameForKey(name) {
    if (!name) return null;
    return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Normalizes LinkedIn URL to canonical format
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

  // Extracts LinkedIn internal ID from href URL
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

  // Normalizes LinkedIn internal ID for key generation
  function normalizeInternalIdForKey(id) {
    if (!id) return null;
    return String(id).trim().toLowerCase();
  }

  // Merges and deduplicates contact records using a robust identifier-priority algorithm
  function mergeAndDedupe(rows) {
    const mapByEmail = new Map();
    const mapByInternal = new Map();
    const mapByLinkedIn = new Map();
    const mapByPhone = new Map();
    const mapByNameUrl = new Map(); // Combined Name + URL for safer common name handling
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

        // Merge fields, preferring non-empty values
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


  // Scrolls through conversation list and returns all chat elements up to the requested limit
  async function loadAllContacts(limit) {
    const scrollContainer = document.querySelector('.msg-conversations-container__conversations-list');
    if (!scrollContainer) {
      sendUpdate("error", "Conversation list not found. Open LinkedIn Messaging.");
      return [];
    }
    let prevHeight = 0;
    for (let i = 0; i < 40; i++) {
      const currentChats = document.querySelectorAll('.msg-conversation-listitem__link');
      if (currentChats.length >= limit) break;

      scrollContainer.scrollTo(0, scrollContainer.scrollHeight);
      await delay(1100);
      const newHeight = scrollContainer.scrollHeight;
      if (newHeight === prevHeight) break;
      prevHeight = newHeight;
    }
    const allChats = Array.from(document.querySelectorAll('.msg-conversation-listitem__link'));
    const chats = allChats.slice(0, limit);
    sendUpdate("progress", `Found ${chats.length} chats (Limited to top ${limit})`);
    return chats;
  }

  // Downloads a file with given filename and content
  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Extracts structured JSON via LLM API with automatic batching
  async function extractViaLLM(jsonData) {
    const MAX_BATCH_SIZE = 150000;
    const jsonString = JSON.stringify(jsonData, null, 2);

    if (jsonString.length > MAX_BATCH_SIZE) {
      sendUpdate("progress", `JSON too large (${Math.round(jsonString.length / 1024)}KB). Batching...`);
      return await extractInBatches(jsonData, MAX_BATCH_SIZE);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("LLM API call timed out after 60 seconds"));
      }, 60000);

      try {
        chrome.runtime.sendMessage({
          action: "call_llm",
          jsonData: jsonData
        }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.success && response.data) {
            resolve(response.data);
          } else {
            reject(new Error(response?.error || "LLM failed to extract data"));
          }
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(new Error(`Failed to send LLM request: ${err.message}`));
      }
    });
  }

  // Processes large datasets in batches and merges results
  async function extractInBatches(jsonData, maxSize) {
    const batches = [];
    let currentBatch = [];
    let currentSize = 0;
    const baseSize = 100;

    for (const item of jsonData) {
      const itemSize = JSON.stringify(item).length;
      if (currentSize + itemSize + baseSize > maxSize && currentBatch.length > 0) {
        batches.push([...currentBatch]);
        currentBatch = [item];
        currentSize = itemSize;
      } else {
        currentBatch.push(item);
        currentSize += itemSize;
      }
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    sendUpdate("progress", `Processing ${batches.length} batches...`);
    const allContacts = [];
    const allPositions = [];

    for (let i = 0; i < batches.length; i++) {
      sendUpdate("progress", `Extracting batch ${i + 1}/${batches.length}...`);
      try {
        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: "call_llm",
            jsonData: batches[i]
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (response && response.success && response.data) {
              resolve(response.data);
            } else {
              reject(new Error(response?.error || "Unknown error"));
            }
          });
        });
        if (result.contacts) allContacts.push(...result.contacts);
        if (result.positions) allPositions.push(...result.positions);
        await delay(1000);
      } catch (err) {
        sendUpdate("progress", `Batch ${i + 1} failed: ${err.message}. Continuing...`);
      }
    }

    if (allContacts.length === 0 && allPositions.length === 0) {
      throw new Error("All batches failed");
    }

    return { contacts: allContacts, positions: allPositions };
  }

  // Generates fallback JSON when LLM extraction fails (contacts only)
  function generateFallbackJSON(rows) {
    const filtered = rows.filter(r => r.linkedInUrl && (r.phone || r.email));
    const contacts = filtered.map(r => ({
      full_name: r.contactName || null,
      email: r.email || null,
      phone: r.phone || null,
      company_name: null,
      job_title: null,
      city: r.contactLocation || null,
      linkedin_id: r.linkedInUrl || null,
      linkedin_internal_id: r.linkedin_internal_id || null,
      source_type: "bot_linkedin_message_extraction",
      raw_payload: {
        contactHeadline: r.contactHeadline || null,
        messages: r.messages || []
      }
    }));
    return { contacts: contacts, positions: [] };
  }

  // Syncs extracted data to WBL API via background script
  async function syncDataToWBL(extractedData) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("WBL sync timed out after 30 seconds"));
      }, 30000);

      try {
        chrome.runtime.sendMessage({
          action: "sync_to_wbl",
          data: extractedData
        }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.success) {
            resolve(response.results);
          } else {
            reject(new Error(response?.error || "WBL sync failed"));
          }
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(new Error(`Failed to sync: ${err.message}`));
      }
    });
  }

  try {
    sendUpdate("progress", "Loading conversations...");
    
    // Read the limit configured by the popup
    const storageData = await chrome.storage.local.get("extractLimit");
    const limit = storageData.extractLimit || 20;

    const chatItems = await loadAllContacts(limit);
    if (!chatItems.length) {
      sendUpdate("error", "No chat items found.");
      return;
    }

    const results = [];

    for (let i = 0; i < chatItems.length; i++) {
      const chat = chatItems[i];
      chat.scrollIntoView({ behavior: "smooth", block: "center" });
      chat.click();
      sendUpdate("progress", `Processing chat ${i + 1}/${chatItems.length}`);
      await delay(2800);

      const contactName =
        document.querySelector('.msg-entity-lockup__entity-title')?.innerText?.trim() ||
        chat.querySelector('.msg-conversation-listitem__participant-names')?.innerText?.trim() ||
        '';

      const contactHeadline = 
        document.querySelector('.msg-entity-lockup__entity-subtitle')?.innerText?.trim() || 
        '';

      const contactLocation = 
        document.querySelector('.msg-entity-lockup__entity-info')?.innerText?.trim() || 
        '';

      let headerHref = null;
      const headerLinkEl = await waitForSelector('.msg-thread__link-to-profile, .msg-overlay-bubble-header__recipient-link, .msg-entity-lockup__entity-link', 5000);
      if (headerLinkEl) headerHref = headerLinkEl.getAttribute('href') || headerLinkEl.getAttribute('data-href') || null;

      await waitForSelector('.msg-s-event-listitem__body', 5000);
      const messageElements = Array.from(document.querySelectorAll('.msg-s-event-listitem__body'));
      const senderMessages = [];
      for (const el of messageElements) {
        const parent = el.closest('.msg-s-message-group, .msg-s-event-listitem');
        const isSelf = parent && parent.classList.contains('msg-s-message-group--self');
        if (!isSelf) {
          const txt = (el.innerText || '').trim();
          if (txt) senderMessages.push(txt.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim());
        }
      }

      const phoneRaw = extractFirstPhoneFromMessages(senderMessages);
      const phone = phoneRaw ? phoneRaw : null;
      const emailRaw = extractFirstEmailFromMessages(senderMessages);
      const email = emailRaw ? emailRaw : null;

      let linkedInUrl = null;
      if (headerHref) {
        let tmp;
        if (headerHref.startsWith('//')) tmp = 'https:' + headerHref;
        else if (!headerHref.startsWith('http')) tmp = headerHref.startsWith('/') ? 'https://www.linkedin.com' + headerHref : 'https://www.linkedin.com/' + headerHref;
        else tmp = headerHref;
        linkedInUrl = normalizeLinkedInUrl(tmp);
      }

      const linkedin_internal_id = extractInternalIdFromHref(headerHref || linkedInUrl) || '';

      // Run NER on this contact's messages
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
        ner_entities: nerEntities
      });

      await delay(700);
    }

    sendUpdate("progress", "Merging duplicate contacts...");
    const unique = mergeAndDedupe(results);
    sendUpdate("progress", `Unique records after merge: ${unique.length}/${results.length}`);

    // Download JSON backup file
    const jsonBlob = new Blob([JSON.stringify(unique, null, 2)], { type: "application/json" });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const ajson = document.createElement("a");
    ajson.href = jsonUrl;
    ajson.download = "linkedin_user_messages_structured.json";
    ajson.click();
    sendUpdate("progress", "JSON backup file downloaded");

    // Extract structured data via LLM
    let extractedData = null;
    sendUpdate("progress", "Extracting structured data via LLM...");
    try {
      extractedData = await extractViaLLM(unique);
      sendUpdate("progress", `LLM extracted: ${extractedData.contacts?.length || 0} contacts, ${extractedData.positions?.length || 0} positions`);
    } catch (err) {
      sendUpdate("error", `LLM failed: ${err.message}`);
      sendUpdate("progress", "Using fallback extraction...");
      await delay(1000);
      extractedData = generateFallbackJSON(unique);
      sendUpdate("progress", `Fallback extracted: ${extractedData.contacts?.length || 0} contacts`);
    }

    // Sync to WBL API
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
        sendUpdate("error", `WBL sync failed: ${err.message}. JSON backup was downloaded.`);
      }
    } else {
      sendUpdate("done", "Extraction complete. No contacts or positions to sync.");
    }
  } catch (err) {
    sendUpdate("error", err.message || String(err));
  }
})();
