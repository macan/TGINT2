import { callSystemOne } from "./systemone";
export interface ClassifiedChannel {
  channel: string;
  topic: string;
  topicConf: number;
  topicProbs: Record<string, number>;
  country: string;
  countryConf: number;
  countryProbs: Record<string, number>;
  domestic: number;
  hasReadValue: boolean;
  readValueScore: number | null;
  readValueProbs: Record<string, number>;
  readValueLegend?: Record<string, string> | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
}

export interface ParsedFilterCriteria {
  rawQuery: string;
  topic?: string | null;
  topicConfidence?: number;
  targetRegions: string[];
  regionConfidences?: Record<string, number>;
  domesticOrientation?: "domestic" | "external" | "balanced" | null;
  domesticConfidence?: number;
  minReadValue?: number | null;
  readValueTier?: string | null;
  readValueConfidence?: number;
  keywords?: string[];
  isAiParsed?: boolean;
}

/**
 * Structured SystemOne choice questions to extract classification dimensions
 * from a free-form natural language search query.
 */
export const SYSTEM_ONE_FILTER_QUESTIONS = {
  topic: {
    type: "choice",
    instructions: "Identify the primary topic or theme requested in this query, or choose 'any' if unspecified.",
    criteria: {
      political: "politics, government, elections, diplomacy, state affairs, international relations, policy, geopolitics",
      military: "warfare, weapons, army, armed forces, defense, invasion, conflict, frontline, soldier, artillery, combat",
      financial: "finance, economy, markets, stocks, crypto, banking, currency, trading, inflation, revenue, business, trade",
      technology: "tech, software, AI, artificial intelligence, programming, hardware, cyber, science, computing, IT",
      blog: "personal blogs, diary entries, personal opinion, essays, subjective lifestyle, casual journaling",
      general_news: "general news, breaking news, media reports, journalism, current affairs, events, society",
      university: "education, academia, universities, students, college, scientific research papers",
      game: "gaming, video games, esports, Steam, console, walkthrough",
      spam: "unsolicited advertisements, promotional links, scams, phishing, automated bulk marketing, gambling promotions, bot ad blasts, fraudulent schemes, adult service solicitations, crypto pump schemes",
      social_movements: "social justice, civil rights, LGBTQ+, queer rights, transgender issues, pride, feminism, MeToo, gender equality, racial equality, labor strikes, protests, human rights advocacy, environmental activism, grassroots organizing",
      any: "no specific topic specified in the query or covers all topics"
    }
  },
  primary_region: {
    type: "choice",
    instructions: "Which primary geopolitical target country or region is specified in this query, or is it unspecified?",
    criteria: {
      china: "China, PRC, Beijing, Chinese affairs, Chinese government",
      us_allies_asia: "Japan, Tokyo, South Korea, Seoul, Philippines, Singapore, Asian allies of the United States",
      united_states: "United States, US, America, Washington, American affairs, USA",
      european_union: "European Union, EU, Germany, France, Brussels, Europe, Italy, Spain",
      russia: "Russia, Moscow, Russian Federation, Kremlin",
      ukraine: "Ukraine, Kyiv, Ukrainian affairs",
      taiwan: "Taiwan, Taipei, ROC, Cross-Strait",
      israel_palestine: "Israel, Palestine, Gaza, Middle East conflict, Jerusalem, IDF, Hamas",
      iran: "Iran, Tehran, Persian affairs, Iranian government",
      africa: "Africa, African continent, African nations, Sub-Saharan",
      international: "international, global, worldwide, United Nations, multinational",
      other: "other specific foreign country not listed above",
      any: "no specific country or region mentioned in the query"
    }
  },
  secondary_region: {
    type: "choice",
    instructions: "Is there a second target country or region mentioned in conjunction (e.g. 'China with Japan', 'Russia and Ukraine', 'US and EU')?",
    criteria: {
      us_allies_asia: "Japan, Tokyo, South Korea, Seoul, Philippines, Asian allies of the US",
      china: "China, PRC, Beijing, Chinese affairs",
      united_states: "United States, US, America, Washington",
      european_union: "European Union, EU, Germany, France, Europe",
      russia: "Russia, Moscow, Russian Federation",
      ukraine: "Ukraine, Kyiv, Ukrainian affairs",
      taiwan: "Taiwan, Taipei",
      israel_palestine: "Israel, Palestine, Gaza, Middle East",
      iran: "Iran, Tehran",
      africa: "Africa, African nations",
      international: "international, global",
      other: "other specific country",
      none: "no second country or region mentioned in this query"
    }
  },
  domestic_orientation: {
    type: "choice",
    instructions: "Does this query indicate a focus on internal domestic affairs vs foreign external affairs?",
    criteria: {
      domestic: "internal domestic affairs, internal policy, domestic politics, domestic focus, local affairs",
      external: "foreign affairs, foreign policy, external focus, international relations, foreign diplomacy",
      balanced: "balanced or neutral internal and external affairs",
      any: "no domestic or external orientation specified"
    }
  },
  read_value_importance: {
    type: "choice",
    instructions: "Does this query ask for high quality, critical, or substantive reporting vs low value chatter?",
    criteria: {
      critical: "critical facts, verified metrics, decisive operational changes, high impact disclosures, breaking events (Score Level 3)",
      substantive: "substantive context, relevant circumstantial claims, secondary commentary, high value (Score Level 2+)",
      background: "background context, sentiment, opinions, analysis (Score Level 1+)",
      any: "no quality or read value threshold specified"
    }
  }
};

/**
 * Fast client-side keyword and token pattern recognition.
 * Returns an immediate parse result in < 5ms before the SystemOne AI request completes.
 */
export function parseQueryFastRules(query: string): ParsedFilterCriteria {
  const q = query.trim().toLowerCase();
  const criteria: ParsedFilterCriteria = {
    rawQuery: query,
    targetRegions: [],
    regionConfidences: {},
    isAiParsed: false
  };

  if (!q) return criteria;

  // 1. Topic Detection
  if (/\b(polit|political|politics|government|diploma|election|geopolitic|state affairs)\b/i.test(q)) {
    criteria.topic = "political";
    criteria.topicConfidence = 0.85;
  } else if (/\b(militar|military|war|warfare|army|weapon|combat|defense|invasion|frontline|soldier)\b/i.test(q)) {
    criteria.topic = "military";
    criteria.topicConfidence = 0.85;
  } else if (/\b(financ|financial|econom|economy|stock|stocks|crypto|bank|market|trade|trading|currenc|invest)\b/i.test(q)) {
    criteria.topic = "financial";
    criteria.topicConfidence = 0.85;
  } else if (/\b(tech|technology|software|ai|artificial intelligence|hardware|cyber|comput|programming|coding)\b/i.test(q)) {
    criteria.topic = "technology";
    criteria.topicConfidence = 0.85;
  } else if (/\b(blog|diary|personal essay|opinion|opinions|commentary)\b/i.test(q)) {
    criteria.topic = "blog";
    criteria.topicConfidence = 0.85;
  } else if (/\b(news|general news|media|journalis|reporting|press)\b/i.test(q)) {
    criteria.topic = "general_news";
    criteria.topicConfidence = 0.85;
  } else if (/\b(university|universities|academic|college|research paper|campus|student)\b/i.test(q)) {
    criteria.topic = "university";
    criteria.topicConfidence = 0.85;
  } else if (/\b(game|gaming|games|esport|esports|steam|playstation)\b/i.test(q)) {
    criteria.topic = "game";
    criteria.topicConfidence = 0.85;
  } else if (/\b(social movement|social movements|social justice|civil rights|lgbt|lgbtq|transgender|queer|pride|feminism|metoo|gender equality|racial equality|labor strike|strikes|protest|protests|human rights|grassroots|activism|activist)\b/i.test(q)) {
    criteria.topic = "social_movements";
    criteria.topicConfidence = 0.85;
  } else if (/\b(spam|ad|ads|advertisement|advertisements|promo|promos|promotional|scam|scams|phishing|bulk marketing|gambling|ad blast|crypto pump)\b/i.test(q)) {
    criteria.topic = "spam";
    criteria.topicConfidence = 0.85;
  }

  // 2. Region & Countries Detection (Can detect multiple regions)
  const regionsFound: string[] = [];

  if (/\b(china|chinese|beijing|prc)\b/i.test(q)) {
    regionsFound.push("china");
    criteria.regionConfidences!["china"] = 0.9;
  }
  if (/\b(japan|japanese|tokyo|korea|korean|seoul|philippines|singapore|us all(y|ies)|asian all(y|ies))\b/i.test(q)) {
    regionsFound.push("us_allies_asia");
    criteria.regionConfidences!["us_allies_asia"] = 0.88;
  }
  if (/\b(usa?|united states|america|american|washington)\b/i.test(q)) {
    regionsFound.push("united_states");
    criteria.regionConfidences!["united_states"] = 0.88;
  }
  if (/\b(eu|europe|european|european union|germany|france|brussels|italy)\b/i.test(q)) {
    regionsFound.push("european_union");
    criteria.regionConfidences!["european_union"] = 0.88;
  }
  if (/\b(russia|russian|moscow|kremlin)\b/i.test(q)) {
    regionsFound.push("russia");
    criteria.regionConfidences!["russia"] = 0.9;
  }
  if (/\b(ukraine|ukrainian|kyiv)\b/i.test(q)) {
    regionsFound.push("ukraine");
    criteria.regionConfidences!["ukraine"] = 0.9;
  }
  if (/\b(taiwan|taiwanese|taipei|roc)\b/i.test(q)) {
    regionsFound.push("taiwan");
    criteria.regionConfidences!["taiwan"] = 0.9;
  }
  if (/\b(israel|israeli|palestine|palestinian|gaza|hamas|jerusalem)\b/i.test(q)) {
    regionsFound.push("israel_palestine");
    criteria.regionConfidences!["israel_palestine"] = 0.88;
  }
  if (/\b(iran|iranian|tehran|persian)\b/i.test(q)) {
    regionsFound.push("iran");
    criteria.regionConfidences!["iran"] = 0.88;
  }
  if (/\b(africa|african)\b/i.test(q)) {
    regionsFound.push("africa");
    criteria.regionConfidences!["africa"] = 0.85;
  }
  if (/\b(international|global|worldwide|un|united nations)\b/i.test(q)) {
    regionsFound.push("international");
    criteria.regionConfidences!["international"] = 0.8;
  }

  criteria.targetRegions = regionsFound;

  // 3. Domestic Orientation
  if (/\b(domestic|internal|home affairs|local affairs|internal stability)\b/i.test(q)) {
    criteria.domesticOrientation = "domestic";
    criteria.domesticConfidence = 0.85;
  } else if (/\b(external|foreign|foreign policy|overseas|international affairs)\b/i.test(q)) {
    criteria.domesticOrientation = "external";
    criteria.domesticConfidence = 0.85;
  }

  // 4. Read Value / Quality Threshold
  if (/\b(critical|decisive|verified|highest impact|breaking|l3)\b/i.test(q)) {
    criteria.minReadValue = 2.0;
    criteria.readValueTier = "Critical (L3)";
    criteria.readValueConfidence = 0.85;
  } else if (/\b(substantive|high quality|high read value|valuable|quality|l2)\b/i.test(q)) {
    criteria.minReadValue = 1.4;
    criteria.readValueTier = "Substantive (L2+)";
    criteria.readValueConfidence = 0.85;
  } else if (/\b(background|informative|l1)\b/i.test(q)) {
    criteria.minReadValue = 0.8;
    criteria.readValueTier = "Background (L1+)";
    criteria.readValueConfidence = 0.8;
  }

  return criteria;
}

/**
 * Converts a natural language query into specific structured classification filters
 * using the Kev SystemOne AI endpoint. Picks high-confidence results (>0.25).
 */
export async function parseNaturalLanguageQueryWithSystemOne(
  query: string
): Promise<ParsedFilterCriteria> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return parseQueryFastRules("");
  }

  // Start with instant rule-based parsing as fallback baseline
  const baseline = parseQueryFastRules(cleanQuery);

  try {
    const response = await callSystemOne<any>(cleanQuery, SYSTEM_ONE_FILTER_QUESTIONS, {
      timeoutMs: 15000
    });

    const answers = response?.answers || response?.res?.answers || response;
    if (!answers || typeof answers !== "object") {
      return { ...baseline, isAiParsed: false };
    }

    const aiCriteria: ParsedFilterCriteria = {
      rawQuery: cleanQuery,
      targetRegions: [...baseline.targetRegions],
      regionConfidences: { ...(baseline.regionConfidences || {}) },
      isAiParsed: true
    };

    // 1. Topic answer
    const topicAns = answers.topic;
    if (topicAns && topicAns.choice && topicAns.choice !== "any") {
      const conf = Number(topicAns.confidence ?? 0);
      if (conf >= 0.25) {
        aiCriteria.topic = topicAns.choice;
        aiCriteria.topicConfidence = conf;
      }
    } else if (baseline.topic) {
      aiCriteria.topic = baseline.topic;
      aiCriteria.topicConfidence = baseline.topicConfidence;
    }

    // 2. Primary Region answer
    const r1Ans = answers.primary_region;
    if (r1Ans && r1Ans.choice && r1Ans.choice !== "any") {
      const conf = Number(r1Ans.confidence ?? 0);
      if (conf >= 0.25) {
        if (!aiCriteria.targetRegions.includes(r1Ans.choice)) {
          aiCriteria.targetRegions.unshift(r1Ans.choice);
        }
        aiCriteria.regionConfidences![r1Ans.choice] = conf;
      }
    }

    // 3. Secondary Region answer (for conjunctions like 'China with Japan')
    const r2Ans = answers.secondary_region;
    if (r2Ans && r2Ans.choice && r2Ans.choice !== "none") {
      const conf = Number(r2Ans.confidence ?? 0);
      if (conf >= 0.20) {
        if (!aiCriteria.targetRegions.includes(r2Ans.choice)) {
          aiCriteria.targetRegions.push(r2Ans.choice);
        }
        aiCriteria.regionConfidences![r2Ans.choice] = conf;
      }
    }

    // Also inspect probability distributions for high secondary presence (> 0.25)
    if (r1Ans?.probabilities && typeof r1Ans.probabilities === "object") {
      for (const [regKey, prob] of Object.entries(r1Ans.probabilities)) {
        if (regKey !== "any" && regKey !== r1Ans.choice && Number(prob) >= 0.25) {
          if (!aiCriteria.targetRegions.includes(regKey)) {
            aiCriteria.targetRegions.push(regKey);
            aiCriteria.regionConfidences![regKey] = Number(prob);
          }
        }
      }
    }

    // 4. Domestic Orientation answer
    const domAns = answers.domestic_orientation;
    if (domAns && domAns.choice && domAns.choice !== "any") {
      const conf = Number(domAns.confidence ?? 0);
      if (conf >= 0.25) {
        aiCriteria.domesticOrientation = domAns.choice;
        aiCriteria.domesticConfidence = conf;
      }
    } else if (baseline.domesticOrientation) {
      aiCriteria.domesticOrientation = baseline.domesticOrientation;
      aiCriteria.domesticConfidence = baseline.domesticConfidence;
    }

    // 5. Read Value Threshold answer
    const rvAns = answers.read_value_importance;
    if (rvAns && rvAns.choice && rvAns.choice !== "any") {
      const conf = Number(rvAns.confidence ?? 0);
      if (conf >= 0.25) {
        if (rvAns.choice === "critical") {
          aiCriteria.minReadValue = 2.0;
          aiCriteria.readValueTier = "Critical (L3)";
        } else if (rvAns.choice === "substantive") {
          aiCriteria.minReadValue = 1.4;
          aiCriteria.readValueTier = "Substantive (L2+)";
        } else if (rvAns.choice === "background") {
          aiCriteria.minReadValue = 0.8;
          aiCriteria.readValueTier = "Background (L1+)";
        }
        aiCriteria.readValueConfidence = conf;
      }
    } else if (baseline.minReadValue !== undefined) {
      aiCriteria.minReadValue = baseline.minReadValue;
      aiCriteria.readValueTier = baseline.readValueTier;
      aiCriteria.readValueConfidence = baseline.readValueConfidence;
    }

    return aiCriteria;
  } catch (err) {
    console.warn("SystemOne filter query parsing fallback to fast rules:", err);
    return { ...baseline, isAiParsed: false };
  }
}

/**
 * Distribution-aware matching predicate over a channel's classification record.
 * Evaluates full probability distribution vectors (e.g. topicProbs, countryProbs)
 * rather than only primary single choices.
 */
export function matchesDistributionAwareFilter(
  item: ClassifiedChannel,
  filter: ParsedFilterCriteria
): boolean {
  // 1. Topic Match
  if (filter.topic) {
    const primaryMatch = item.topic === filter.topic;
    const probMatch = (item.topicProbs?.[filter.topic] ?? 0) >= 0.14;
    if (!primaryMatch && !probMatch) {
      return false;
    }
  }

  // 2. Target Region Match (Distribution-Aware Multi-Aspect Matching)
  if (filter.targetRegions && filter.targetRegions.length > 0) {
    if (filter.targetRegions.length === 1) {
      const target = filter.targetRegions[0];
      const primaryMatch = item.country === target;
      const probMatch = (item.countryProbs?.[target] ?? 0) >= 0.08;
      if (!primaryMatch && !probMatch) {
        return false;
      }
    } else {
      // Multiple countries (e.g. 'China with Japan' -> ['china', 'us_allies_asia'])
      const r1 = filter.targetRegions[0];
      const r2 = filter.targetRegions[1];
      const p1 = item.countryProbs?.[r1] ?? 0;
      const p2 = item.countryProbs?.[r2] ?? 0;
      const isPrimaryEither = item.country === r1 || item.country === r2;

      // Distribution-aware criteria:
      // a) Geometric mean joint relevance score >= 0.035
      const jointScore = Math.sqrt(p1 * p2);
      // b) Both have noticeable coverage (>= 4% and >= 3%)
      const hasBothPresence = (p1 >= 0.04 && p2 >= 0.03) || (p2 >= 0.04 && p1 >= 0.03);
      // c) Primary country is one, and secondary country has >= 3% coverage
      const primaryWithSecondaryProb = isPrimaryEither && (p1 >= 0.03 || p2 >= 0.03);

      if (jointScore < 0.035 && !hasBothPresence && !primaryWithSecondaryProb) {
        return false;
      }
    }
  }

  // 3. Domestic Orientation Match
  if (filter.domesticOrientation === "domestic") {
    if (item.domestic < 0.55) return false;
  } else if (filter.domesticOrientation === "external") {
    if (item.domestic > 0.35) return false;
  } else if (filter.domesticOrientation === "balanced") {
    if (item.domestic < 0.30 || item.domestic > 0.65) return false;
  }

  // 4. Read Value Match
  if (filter.minReadValue !== null && filter.minReadValue !== undefined) {
    if (item.hasReadValue && item.readValueScore !== null) {
      if (item.readValueScore < filter.minReadValue) {
        return false;
      }
    }
  }

  return true;
}
