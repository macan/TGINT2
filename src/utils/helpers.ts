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
