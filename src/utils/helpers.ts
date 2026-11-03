export const getInitials = (title: string): string => {
  if (!title) return "?";
  const cleaned = title.replace(/^@/, "").trim();
  const parts = cleaned.split(/[\s_\-]+/).filter(Boolean);
  if (parts.length > 1) {
    const first = Array.from(parts[0])[0] || "";
    const second = Array.from(parts[1])[0] || "";
    return (first + second).toUpperCase();
  }
  const chars = Array.from(cleaned);
  return chars.slice(0, 2).join("").toUpperCase();
};

export const truncateString = (str: string, maxLen: number): string => {
  if (!str) return "";
  const chars = Array.from(str);
  if (chars.length > maxLen) {
    return chars.slice(0, maxLen - 2).join("") + "...";
  }
  return str;
};

export const getSha1HexDigest = async (fdata: string): Promise<string> => {
  // 1. Encode string into an array of bytes (Uint8Array)
  const encoder = new TextEncoder();
  const data = encoder.encode(fdata);
  
  // 2. Calculate the SHA-1 hash array buffer
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  
  // 3. Convert the binary buffer into a hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexdigest = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hexdigest;
};

/**
 * Safely extracts a clean, normalized user identifier (username or user id) from
 * a field value (which could be a string, object, number, or JSON string).
 */
export const extractUserIdFromField = (val: any): string => {
  if (val === null || val === undefined) return "";

  // 1. If number (e.g. numeric Telegram ID 12345678)
  if (typeof val === "number") {
    return isNaN(val) ? "" : String(val);
  }

  // 2. If array, extract from first valid item
  if (Array.isArray(val)) {
    for (const item of val) {
      const extracted = extractUserIdFromField(item);
      if (extracted) return extracted;
    }
    return "";
  }

  // 3. If object (e.g. Telegram User object, PeerUser, or { id, username, name, author })
  if (typeof val === "object") {
    const candidate =
      val.username ??
      val.user ??
      val.user_id ??
      val.id ??
      val.author_id ??
      val.handle ??
      val.name ??
      val.first_name ??
      val.title ??
      val.author;

    if (candidate !== null && candidate !== undefined && candidate !== "" && candidate !== val) {
      const extracted = extractUserIdFromField(candidate);
      if (extracted) return extracted;
    }
    return "";
  }

  // 4. If string
  if (typeof val === "string") {
    let s = val.trim();
    if (!s) return "";

    const lower = s.toLowerCase();
    // Ignore null-like placeholder strings
    if (
      lower === "null" ||
      lower === "undefined" ||
      lower === "none" ||
      lower === "{}" ||
      lower === "[]" ||
      lower === "[object object]" ||
      lower === "nan"
    ) {
      return "";
    }

    // Try JSON parsing in case object was serialized as a JSON string
    if (s.startsWith("{") && s.endsWith("}")) {
      try {
        const parsed = JSON.parse(s);
        const extracted = extractUserIdFromField(parsed);
        if (extracted) return extracted;
      } catch {
        // Continue with normal string processing
      }
    }

    // Strip trailing slashes
    s = s.replace(/\/+$/, "");

    // Strip URL protocols and telegram domains (e.g. https://t.me/username or tg://resolve?domain=username)
    s = s.replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i, "");
    s = s.replace(/^tg:\/\/resolve\?domain=/i, "");

    // If path contains slashes, take the last non-empty segment (e.g. "path/to/username")
    if (s.includes("/")) {
      const segments = s.split("/").filter(Boolean);
      s = segments[segments.length - 1] || s;
    }

    // Strip URL query parameters and hashes
    s = s.split("?")[0].split("#")[0].trim();

    // Strip leading @ symbols
    s = s.replace(/^@+/, "").trim();

    // Strip common prefixes like "id:", "user:", "uid:", "user_id:", "author:"
    s = s.replace(/^(?:id|user|uid|user_id|author)\s*[:=]\s*/i, "").trim();

    // Check if ends with parenthesized identifier, e.g. "Name (123456)" or "Name (@username)"
    const parenMatch = s.match(/\(([^)]+)\)$/);
    if (parenMatch && parenMatch[1]) {
      const inside = parenMatch[1].trim().replace(/^@+/, "");
      // If parenthesized part contains digits or a handle, prioritize it
      if (inside && (/\d{4,}/.test(inside) || /^[a-zA-Z0-9_]{3,}$/.test(inside))) {
        return inside;
      }
    }

    return s;
  }

  return "";
};

/**
 * Extracts the user identifier for a post:
 * 1. Primary: parsed username from .user field
 * 2. Fallback: if .user is null / empty, treat post.data.author as the second user identifier to compare as a new user id
 * 3. Additional fallbacks: post_author, author_id, from_id, from, uid, sender_id
 */
export const getPostSenderIdentifier = (post: any, rawPostData?: any): string => {
  const pData = rawPostData || post?.data || {};

  // 1. Primary: .user field
  const userVal = pData.user ?? post?.user;
  const fromUser = extractUserIdFromField(userVal);
  if (fromUser) {
    return fromUser;
  }

  // 2. Second user identifier fallback: .author field
  const authorVal = pData.author ?? post?.author;
  const fromAuthor = extractUserIdFromField(authorVal);
  if (fromAuthor) {
    return fromAuthor;
  }

  // 3. Fallback to post_author (e.g. channel message admin signature)
  const postAuthorVal = pData.post_author ?? post?.post_author;
  const fromPostAuthor = extractUserIdFromField(postAuthorVal);
  if (fromPostAuthor) {
    return fromPostAuthor;
  }

  // 4. Other sender identity fields: author_id, from_id, from, uid, sender_id
  const otherFields = [
    pData.author_id,
    post?.author_id,
    pData.from,
    post?.from,
    pData.from_id,
    post?.from_id,
    pData.uid,
    post?.uid,
    pData.sender,
    post?.sender,
    pData.sender_id,
    post?.sender_id
  ];

  for (const field of otherFields) {
    const extracted = extractUserIdFromField(field);
    if (extracted) {
      return extracted;
    }
  }

  return "";
};

export * from './systemone';
