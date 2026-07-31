export type DictionaryMatchType = "exact" | "normalized" | "lemma" | "none";

export type EcdictErrorCode =
  | "ECDICT_DISABLED"
  | "ECDICT_DATABASE_UNAVAILABLE"
  | "ECDICT_DATABASE_INVALID"
  | "ECDICT_QUERY_FAILED";

export interface DictionaryEntry {
  word: string;
  phonetic: string | null;
  definition: string | null;
  translation: string | null;
  pos: string | null;
  collins: number | null;
  oxford: boolean;
  tags: string[];
  bncRank: number | null;
  frequencyRank: number | null;
  exchange: string | null;
}

export interface DictionaryCandidate {
  lemma?: string;
  entry: DictionaryEntry;
}

export interface DictionaryLookupResult {
  available: boolean;
  errorCode: EcdictErrorCode | null;
  query: string;
  normalizedQuery: string;
  matchedBy: DictionaryMatchType;
  directMatch: DictionaryEntry | null;
  normalizedCandidates: DictionaryEntry[];
  lemmaCandidates: DictionaryCandidate[];
}

export interface LocalDictionaryService {
  lookup(query: string): Promise<DictionaryLookupResult>;
  close(): void;
}
