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
  targetTopics?: string[];
  topicConfidences?: Record<string, number>;
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
  secondary_topic: {
    type: "choice",
    instructions: "Is there a second topic mentioned in conjunction (e.g. 'political with social movements', 'technology and spam', 'social justice with blogs')?",
    criteria: {
      social_movements: "social justice, civil rights, LGBTQ+, queer rights, transgender issues, pride, feminism, MeToo, gender equality, racial equality, labor strikes, protests, human rights advocacy, environmental activism, grassroots organizing",
      spam: "unsolicited advertisements, promotional links, scams, phishing, automated bulk marketing, gambling promotions, bot ad blasts, fraudulent schemes, adult service solicitations, crypto pump schemes",
      political: "politics, government, elections, diplomacy, state affairs, international relations, policy, geopolitics",
      military: "warfare, weapons, army, armed forces, defense, invasion, conflict, frontline, soldier, combat",
      financial: "finance, economy, markets, stocks, crypto, banking, currency, trading, business, trade",
      technology: "tech, software, AI, artificial intelligence, programming, hardware, computing",
      blog: "personal blogs, diary entries, personal opinion, essays, casual journaling",
      general_news: "general news, breaking news, media reports, journalism, current affairs, events",
      university: "education, academia, universities, students, scientific research papers",
      game: "gaming, video games, esports, Steam, console",
      none: "no second topic mentioned in this query"
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
    targetTopics: [],
    topicConfidences: {},
    targetRegions: [],
    regionConfidences: {},
    isAiParsed: false
  };

  if (!q) return criteria;

  // 1. Topic Detection (Supports single & multi-topic detection like 'political with social movements')
  const topicsFound: string[] = [];

  if (/\b(social movement|social movements|social justice|civil rights|lgbt|lgbtq|transgender|queer|pride|feminism|metoo|gender equality|racial equality|labor strike|strikes|protest|protests|human rights|grassroots|activism|activist)\b/i.test(q)) {
    topicsFound.push("social_movements");
    criteria.topicConfidences!["social_movements"] = 0.88;
  }
  if (/\b(spam|ad|ads|advertisement|advertisements|promo|promos|promotional|scam|scams|phishing|bulk marketing|gambling|ad blast|crypto pump)\b/i.test(q)) {
    topicsFound.push("spam");
    criteria.topicConfidences!["spam"] = 0.88;
  }
  if (/\b(polit|political|politics|government|diploma|election|geopolitic|state affairs)\b/i.test(q)) {
    topicsFound.push("political");
    criteria.topicConfidences!["political"] = 0.85;
  }
  if (/\b(militar|military|war|warfare|army|weapon|combat|defense|invasion|frontline|soldier)\b/i.test(q)) {
    topicsFound.push("military");
    criteria.topicConfidences!["military"] = 0.85;
  }
  if (/\b(financ|financial|econom|economy|stock|stocks|crypto|bank|market|trade|trading|currenc|invest)\b/i.test(q)) {
    topicsFound.push("financial");
    criteria.topicConfidences!["financial"] = 0.85;
  }
  if (/\b(tech|technology|software|ai|artificial intelligence|hardware|cyber|comput|programming|coding)\b/i.test(q)) {
    topicsFound.push("technology");
    criteria.topicConfidences!["technology"] = 0.85;
  }
  if (/\b(blog|diary|personal essay|opinion|opinions|commentary)\b/i.test(q)) {
    topicsFound.push("blog");
    criteria.topicConfidences!["blog"] = 0.85;
  }
  if (/\b(news|general news|media|journalis|reporting|press)\b/i.test(q)) {
    topicsFound.push("general_news");
    criteria.topicConfidences!["general_news"] = 0.85;
  }
  if (/\b(university|universities|academic|college|research paper|campus|student)\b/i.test(q)) {
    topicsFound.push("university");
    criteria.topicConfidences!["university"] = 0.85;
  }
  if (/\b(game|gaming|games|esport|esports|steam|playstation)\b/i.test(q)) {
    topicsFound.push("game");
    criteria.topicConfidences!["game"] = 0.85;
  }

  criteria.targetTopics = topicsFound;
  criteria.topic = topicsFound[0] || null;
  criteria.topicConfidence = criteria.topic ? criteria.topicConfidences![criteria.topic] : undefined;

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
      targetTopics: [...(baseline.targetTopics || [])],
      topicConfidences: { ...(baseline.topicConfidences || {}) },
      targetRegions: [...baseline.targetRegions],
      regionConfidences: { ...(baseline.regionConfidences || {}) },
      isAiParsed: true
    };

    // 1. Topic answer (primary)
    const topicAns = answers.topic;
    if (topicAns && topicAns.choice && topicAns.choice !== "any") {
      const conf = Number(topicAns.confidence ?? 0);
      if (conf >= 0.25) {
        if (!aiCriteria.targetTopics!.includes(topicAns.choice)) {
          aiCriteria.targetTopics!.unshift(topicAns.choice);
        }
        aiCriteria.topic = topicAns.choice;
        aiCriteria.topicConfidence = conf;
        aiCriteria.topicConfidences![topicAns.choice] = conf;
      }
    } else if (baseline.topic) {
      aiCriteria.topic = baseline.topic;
      aiCriteria.topicConfidence = baseline.topicConfidence;
    }

    // 1b. Secondary Topic answer (for conjunctions like 'political with social movements', 'tech with spam')
    const secTopicAns = answers.secondary_topic;
    if (secTopicAns && secTopicAns.choice && secTopicAns.choice !== "none" && secTopicAns.choice !== "any") {
      const conf = Number(secTopicAns.confidence ?? 0);
      if (conf >= 0.20) {
        if (!aiCriteria.targetTopics!.includes(secTopicAns.choice)) {
          aiCriteria.targetTopics!.push(secTopicAns.choice);
        }
        aiCriteria.topicConfidences![secTopicAns.choice] = conf;
      }
    }

    // Also inspect topic probability distributions for strong secondary presence (>= 0.20)
    if (topicAns?.probabilities && typeof topicAns.probabilities === "object") {
      for (const [topKey, prob] of Object.entries(topicAns.probabilities)) {
        if (topKey !== "any" && topKey !== topicAns.choice && Number(prob) >= 0.20) {
          if (!aiCriteria.targetTopics!.includes(topKey)) {
            aiCriteria.targetTopics!.push(topKey);
            aiCriteria.topicConfidences![topKey] = Number(prob);
          }
        }
      }
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
 * Computes the effective probability of a topic for a given item,
 * combining both primary classification confidence and secondary probability vector.
 */
export function getEffectiveTopicProb(item: ClassifiedChannel, topic: string): number {
  if (item.topicProbs && typeof item.topicProbs[topic] === "number") {
    return item.topicProbs[topic];
  }
  return item.topic === topic ? Math.max(item.topicConf || 0, 0.45) : 0;
}

/**
 * Computes the effective probability of a target geopolitical region for a given item,
 * combining both primary classification confidence and secondary probability vector.
 */
export function getEffectiveRegionProb(item: ClassifiedChannel, region: string): number {
  if (item.countryProbs && typeof item.countryProbs[region] === "number") {
    return item.countryProbs[region];
  }
  return item.country === region ? Math.max(item.countryConf || 0, 0.45) : 0;
}

/**
 * Enhanced distribution-aware matching predicate over a channel's classification record.
 * Evaluates full probability distribution vectors (topicProbs, countryProbs, readValueProbs)
 * rather than only primary single choices, with rigorous multi-aspect conjunction precision.
 */
export function matchesDistributionAwareFilter(
  item: ClassifiedChannel,
  filter: ParsedFilterCriteria
): boolean {
  // =========================================================================
  // 1. TOPIC FILTERING (Distribution-Aware Single & Multi-Topic Matching)
  // =========================================================================
  const activeTopics = (filter.targetTopics && filter.targetTopics.length > 0)
    ? filter.targetTopics
    : (filter.topic ? [filter.topic] : []);

  if (activeTopics.length === 1) {
    const target = activeTopics[0];
    const p = getEffectiveTopicProb(item, target);
    const primaryMatch = item.topic === target;
    // Distribution-aware threshold: 0.12 allows strong secondary topic representation
    const probMatch = p >= 0.12;
    if (!primaryMatch && !probMatch) {
      return false;
    }
  } else if (activeTopics.length === 2) {
    const t1 = activeTopics[0];
    const t2 = activeTopics[1];
    const p1 = getEffectiveTopicProb(item, t1);
    const p2 = getEffectiveTopicProb(item, t2);

    // Distribution-aware joint criteria for dual topics:
    // a) Geometric mean joint relevance score >= 0.035, with minimal noise floor (>= 0.02 each)
    const jointScore = Math.sqrt(p1 * p2);
    const hasSolidJointDensity = jointScore >= 0.035 && p1 >= 0.02 && p2 >= 0.02;

    // b) Both topics have noticeable non-trivial presence in topic distribution
    const hasBothPresence = (p1 >= 0.04 && p2 >= 0.03) || (p2 >= 0.04 && p1 >= 0.03);

    // c) Primary is one topic, and the secondary topic has genuine presence (>= 3.5%)
    // Precision fix: prevents false-positive match when item is 100% t1 but has 0% t2
    const primaryWithSecondaryProb =
      (item.topic === t1 && p2 >= 0.035) ||
      (item.topic === t2 && p1 >= 0.035);

    if (!hasSolidJointDensity && !hasBothPresence && !primaryWithSecondaryProb) {
      return false;
    }
  } else if (activeTopics.length >= 3) {
    // For 3+ topics: check that all target topics have at least a minimal trace (>= 1.5%)
    // and that the average coverage across all target topics is substantive (>= 3.5%)
    let sumP = 0;
    for (const t of activeTopics) {
      const p = getEffectiveTopicProb(item, t);
      if (p < 0.015 && item.topic !== t) {
        return false;
      }
      sumP += p;
    }
    if ((sumP / activeTopics.length) < 0.035) {
      return false;
    }
  }

  // =========================================================================
  // 2. TARGET REGIONS (Distribution-Aware Single & Multi-Region Matching)
  // =========================================================================
  if (filter.targetRegions && filter.targetRegions.length > 0) {
    if (filter.targetRegions.length === 1) {
      const target = filter.targetRegions[0];
      const p = getEffectiveRegionProb(item, target);
      const primaryMatch = item.country === target;
      // Distribution-aware threshold: 0.08 allows strong secondary regional focus
      const probMatch = p >= 0.08;
      if (!primaryMatch && !probMatch) {
        return false;
      }
    } else if (filter.targetRegions.length === 2) {
      // e.g. 'China with Japan' -> ['china', 'us_allies_asia']
      const r1 = filter.targetRegions[0];
      const r2 = filter.targetRegions[1];
      const p1 = getEffectiveRegionProb(item, r1);
      const p2 = getEffectiveRegionProb(item, r2);

      // Distribution-aware criteria for dual regions:
      // a) Geometric mean joint relevance score >= 0.035 with non-zero noise floor (>= 0.02 each)
      const jointScore = Math.sqrt(p1 * p2);
      const hasSolidJointDensity = jointScore >= 0.035 && p1 >= 0.02 && p2 >= 0.02;

      // b) Both have noticeable coverage across the 12 regions (>= 4% and >= 3%)
      const hasBothPresence = (p1 >= 0.04 && p2 >= 0.03) || (p2 >= 0.04 && p1 >= 0.03);

      // c) Primary country is one, AND the other region has true secondary presence (>= 3.5%)
      // Precision fix: prevents false-positive match when item is 100% r1 but has 0% r2
      const primaryWithSecondaryProb =
        (item.country === r1 && p2 >= 0.035) ||
        (item.country === r2 && p1 >= 0.035);

      if (!hasSolidJointDensity && !hasBothPresence && !primaryWithSecondaryProb) {
        return false;
      }
    } else {
      // 3 or more target regions (e.g. 'US, EU and China'):
      // Require each region to have non-trivial presence (>= 1.5%) and average coverage >= 3.0%
      let sumP = 0;
      for (const r of filter.targetRegions) {
        const p = getEffectiveRegionProb(item, r);
        if (p < 0.015 && item.country !== r) {
          return false;
        }
        sumP += p;
      }
      if ((sumP / filter.targetRegions.length) < 0.03) {
        return false;
      }
    }
  }

  // =========================================================================
  // 3. DOMESTIC AFFAIRS ORIENTATION MATCHING
  // =========================================================================
  if (filter.domesticOrientation === "domestic") {
    // Requires clear internal/domestic policy orientation (>= 0.52)
    if (item.domestic < 0.52) return false;
  } else if (filter.domesticOrientation === "external") {
    // Requires clear foreign/international policy orientation (<= 0.38)
    if (item.domestic > 0.38) return false;
  } else if (filter.domesticOrientation === "balanced") {
    // Balanced or neutral coverage between domestic and external (0.28 to 0.68)
    if (item.domestic < 0.28 || item.domestic > 0.68) return false;
  }

  // =========================================================================
  // 4. READ VALUE QUALITY FILTERING (With Probabilistic Soft-Margin)
  // =========================================================================
  if (filter.minReadValue !== null && filter.minReadValue !== undefined && filter.minReadValue > 0) {
    // If the filter specifically requested quality/read-value (e.g. Critical L3 or Substantive L2),
    // items with NO read value score at all must be excluded
    if (!item.hasReadValue || item.readValueScore === null) {
      return false;
    }

    // Direct threshold check
    if (item.readValueScore >= filter.minReadValue) {
      return true;
    }

    // Probabilistic soft-margin:
    // If the continuous score is slightly below the threshold, but the probability
    // distribution across levels indicates decisive high-level density:
    if (filter.minReadValue >= 2.0) {
      // Critical Facts (L3): if score >= 1.80 and P(Level 3) >= 25%
      const p3 = item.readValueProbs?.["3"] ?? 0;
      if (item.readValueScore >= 1.80 && p3 >= 0.25) {
        return true;
      }
    } else if (filter.minReadValue >= 1.4) {
      // Substantive (L2+): if score >= 1.25 and (P(L2) + P(L3)) >= 40%
      const pSubstantive = (item.readValueProbs?.["2"] ?? 0) + (item.readValueProbs?.["3"] ?? 0);
      if (item.readValueScore >= 1.25 && pSubstantive >= 0.40) {
        return true;
      }
    } else if (filter.minReadValue >= 0.8) {
      // Background (L1+): if score >= 0.65 and (P(L1) + P(L2) + P(L3)) >= 60%
      const pInformative = (item.readValueProbs?.["1"] ?? 0) + (item.readValueProbs?.["2"] ?? 0) + (item.readValueProbs?.["3"] ?? 0);
      if (item.readValueScore >= 0.65 && pInformative >= 0.60) {
        return true;
      }
    }

    return false;
  }

  return true;
}

/**
 * Calculates a continuous multi-dimensional AI relevance score (0.00 to 1.00)
 * for a matching channel based on topic density, region density, domestic alignment,
 * and read-value informativeness.
 */
export function calculateDistributionAwareScore(
  item: ClassifiedChannel,
  filter: ParsedFilterCriteria
): number {
  let score = 0.5; // baseline

  // 1. Topic Affinity Component (weight: 0.35)
  const activeTopics = (filter.targetTopics && filter.targetTopics.length > 0)
    ? filter.targetTopics
    : (filter.topic ? [filter.topic] : []);

  if (activeTopics.length > 0) {
    let topicProd = 1;
    for (const t of activeTopics) {
      const p = getEffectiveTopicProb(item, t);
      topicProd *= Math.max(p, 0.05);
    }
    const topicScore = Math.pow(topicProd, 1 / activeTopics.length);
    score += (topicScore - 0.2) * 0.35;
  }

  // 2. Regional Affinity Component (weight: 0.35)
  if (filter.targetRegions && filter.targetRegions.length > 0) {
    let regionProd = 1;
    for (const r of filter.targetRegions) {
      const p = getEffectiveRegionProb(item, r);
      regionProd *= Math.max(p, 0.04);
    }
    const regionScore = Math.pow(regionProd, 1 / filter.targetRegions.length);
    score += (regionScore - 0.15) * 0.35;
  }

  // 3. Domestic Orientation Alignment (weight: 0.15)
  if (filter.domesticOrientation === "domestic") {
    score += (item.domestic - 0.5) * 0.15;
  } else if (filter.domesticOrientation === "external") {
    score += (0.5 - item.domestic) * 0.15;
  }

  // 4. Read Value Informativeness (weight: 0.15)
  if (item.hasReadValue && item.readValueScore !== null) {
    score += (item.readValueScore / 3.0 - 0.3) * 0.15;
  }

  return Math.max(0.01, Math.min(1.0, score));
}
