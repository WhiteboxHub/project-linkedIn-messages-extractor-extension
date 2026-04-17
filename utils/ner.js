/**
 * NER (Named Entity Recognition) utility for LinkedIn recruiter messages.
 * Domain-tuned regex-based extractor covering all entity types needed for
 * automation_contact_extracts and email_positions.
 *
 * Usage:
 *   const entities = extractEntities(messagesArray, contactHeadline, contactLocation);
 */

(function (global) {
  "use strict";

  // ─── Regex Patterns ──────────────────────────────────────────────────────────

  const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;

  const PHONE_RE = /(?:\+?\d{1,4}[-.\s]?)?(?:\(?\d{2,5}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,5}(?:\s?(?:ext|x|ext\.)\s?\d{1,5})?/g;

  const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

  const APPLY_URL_RE = /(?:apply|job|career|position|role|opening)[^\s]*https?:\/\/[^\s]+|https?:\/\/[^\s]*(?:job|apply|career|position|opening|role|hiring)[^\s]*/gi;

  const SALARY_RE = /\$\s?\d{2,3}(?:[,.]?\d{3})?(?:\s?[kK])?\s*(?:[-–to]+\s*\$?\s?\d{2,3}(?:[,.]?\d{3})?(?:\s?[kK])?)?\s*(?:\/\s*(?:year|yr|annum|pa|month|hr|hour))?/g;

  const JOB_TITLE_RE = /\b(?:Senior|Sr\.?|Junior|Jr\.?|Lead|Principal|Staff|Associate|Mid(?:-level)?|Entry[-\s]level)?\s*(?:Software|Frontend|Back[-\s]?end|Full[-\s]?Stack|Mobile|iOS|Android|DevOps|MLOps|Cloud|Data|Platform|Site Reliability|Security|QA|Test|Product|Project|Program|Embedded|Network|AI|ML|Machine Learning|Deep Learning|NLP|GenAI|UI\/UX|UX|UI|Graphic|Systems|Infrastructure|Database|Solutions|Technical|Sales|Recruiting|Talent|HR|Finance|Marketing|Growth|Business Development|BD)\s+(?:Engineer|Developer|Architect|Manager|Lead|Director|Analyst|Designer|Consultant|Recruiter|Specialist|Associate|Coordinator|Intern|Contractor|Researcher|Scientist|Writer|Owner|Strategist|Advisor|Ninja|Guru|Expert|Professional)(?:\s+(?:I{1,3}|IV|V|VI|1|2|3|4|5))?\b/gi;

  const ORG_RE = /(?:at|@|with|from|joins?|joined?)\s+([A-Z][A-Za-z0-9&'\-\s]{1,30}(?:Inc\.?|LLC\.?|Ltd\.?|Corp\.?|Co\.?|Agency|Group|Solutions|Tech|Labs?|Systems|Services|Consulting|Digital|Global)?)(?=[.,:;!?]|\s|$)/g;

  const LOCATION_RE = /\b(?:in|at|based in|located in|location[:\s]+|remote|onsite|hybrid|work from home|WFH)?\s*([A-Z][a-z]+(?:[\s,]+[A-Z]{2})?(?:[\s,]+[A-Z][a-z]+)*(?:,\s*[A-Z]{2})?)\b/g;

  const SKILL_RE = /\b(?:React(?:\.js)?|Vue(?:\.js)?|Angular(?:\.js)?|Node(?:\.js)?|Express(?:\.js)?|Next(?:\.js)?|Nuxt(?:\.js)?|TypeScript|JavaScript|Python|Java|Kotlin|Swift|Go(?:lang)?|Rust|C\+\+|C#|\.NET|PHP|Ruby(?:\s+on\s+Rails)?|Django|FastAPI|Flask|Spring(?:\s+Boot)?|Hibernate|PostgreSQL|MySQL|MongoDB|Redis|Elasticsearch|Kafka|RabbitMQ|AWS|GCP|Azure|Docker|Kubernetes|Terraform|Ansible|Jenkins|CI\/CD|GraphQL|REST(?:ful)?|gRPC|Microservices?|Serverless|Machine Learning|Deep Learning|NLP|TensorFlow|PyTorch|Pandas|NumPy|Spark|Hadoop|Airflow|dbt|Snowflake|BigQuery)\b/gi;

  // Generic email blacklist prefixes
  const GENERIC_EMAIL_PREFIXES = [
    "support", "info", "donotreply", "noreply", "admin", "hr", "hello",
    "sales", "marketing", "contact", "team", "help", "no-reply",
    "notifications", "newsletter", "postmaster", "mailer", "bounce",
    "office", "billing", "jobs", "careers"
  ];

  // ─── Helper Functions ─────────────────────────────────────────────────────────

  function isGenericEmail(email) {
    const prefix = email.split("@")[0].toLowerCase();
    return GENERIC_EMAIL_PREFIXES.some(b => prefix === b || prefix.startsWith(b + "."));
  }

  function cleanPhone(phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return null;
    return digits;
  }

  function dedupe(arr) {
    return [...new Set(arr.map(s => s.trim()).filter(Boolean))];
  }

  function extractAllMatches(text, regex) {
    const results = [];
    let match;
    const re = new RegExp(regex.source, regex.flags);
    while ((match = re.exec(text)) !== null) {
      results.push(match[0].trim());
    }
    return results;
  }

  function extractGroup1Matches(text, regex) {
    const results = [];
    let match;
    const re = new RegExp(regex.source, regex.flags);
    while ((match = re.exec(text)) !== null) {
      if (match[1]) results.push(match[1].trim());
    }
    return results;
  }

  // ─── Main Extraction Function ─────────────────────────────────────────────────

  /**
   * Extracts named entities from an array of message strings.
   * @param {string[]} messages - Array of message strings from a contact thread.
   * @param {string} [headline] - Contact's LinkedIn headline.
   * @param {string} [location] - Contact's LinkedIn location.
   * @returns {Object} Entity object with typed arrays.
   */
  function extractEntities(messages, headline = "", location = "") {
    const fullText = [...messages, headline].filter(Boolean).join(" ");

    // Emails
    const allEmails = extractAllMatches(fullText, EMAIL_RE).map(e => e.toLowerCase());
    const personalEmails = allEmails.filter(e => !isGenericEmail(e));
    const genericEmails = allEmails.filter(isGenericEmail);

    // Phones
    const rawPhones = extractAllMatches(fullText, PHONE_RE);
    const phones = dedupe(rawPhones.map(cleanPhone).filter(Boolean));

    // URLs
    const allUrls = dedupe(extractAllMatches(fullText, URL_RE));

    // Apply URLs (URLs that likely point to a job application)
    const applyUrls = allUrls.filter(url =>
      /apply|job|career|position|opening|role|hiring|recruit|lever\.co|greenhouse\.io|ashbyhq|workable|breezy|smartrecruiters|icims|taleo|workday|bamboo/i.test(url)
    );

    // Job Titles
    const jobTitles = dedupe(extractAllMatches(fullText, JOB_TITLE_RE));

    // Organizations
    const orgs = dedupe(extractGroup1Matches(fullText, ORG_RE));

    // Skills
    const skills = dedupe(extractAllMatches(fullText, SKILL_RE));

    // Salary
    const salaries = dedupe(extractAllMatches(fullText, SALARY_RE));

    // Location — prioritize LinkedIn profile location, then message text
    const msgLocations = dedupe(extractGroup1Matches(fullText, LOCATION_RE))
      .filter(l => /[A-Z]/.test(l[0]) && l.length > 2);

    const detectedLocation = location || msgLocations[0] || null;

    // Build the final entity object
    return {
      emails: {
        personal: dedupe(personalEmails),
        generic: dedupe(genericEmails),
        all: dedupe(allEmails)
      },
      phones: phones,
      urls: {
        apply: applyUrls,
        all: allUrls
      },
      job_titles: jobTitles,
      organizations: orgs,
      skills: skills,
      salaries: salaries,
      location: detectedLocation,
      // Convenience flags for LLM hint
      has_personal_email: personalEmails.length > 0,
      has_phone: phones.length > 0,
      has_apply_url: applyUrls.length > 0,
      has_job_title: jobTitles.length > 0
    };
  }

  // ─── Exports ─────────────────────────────────────────────────────────────────

  // Support both browser (content script) and module environments
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { extractEntities };
  } else {
    global.NER = { extractEntities };
  }

})(typeof globalThis !== "undefined" ? globalThis : this);
