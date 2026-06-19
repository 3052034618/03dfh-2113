export type ScriptType = 'emotional' | 'horror' | 'hardcore' | '欢乐' | '阵营' | 'other';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'extreme';
export type Gender = 'male' | 'female' | 'other';

export interface Store {
  id: number;
  name: string;
  city?: string;
  address?: string;
  created_at: string;
}

export interface Script {
  id: number;
  name: string;
  type: ScriptType;
  difficulty: Difficulty;
  duration_minutes: number;
  description?: string;
  created_at: string;
}

export interface Character {
  id: number;
  script_id: number;
  name: string;
  gender: Gender;
  age?: number;
  is_lead: number;
  courage_required: number;
  reasoning_required: number;
  emotional_depth: number;
  description?: string;
}

export interface CharacterRelationship {
  id: number;
  script_id: number;
  character_a_id: number;
  character_b_id: number;
  relationship_type: string;
  importance: number;
}

export interface Player {
  name: string;
  gender: Gender;
  age?: number;
  is_regular?: boolean;
  courage_level?: number;
  reasoning_level?: number;
  emotional_tolerance?: number;
  tags?: string[];
  cross_gender_willing?: boolean;
}

export interface Rule {
  id: number;
  name: string;
  code: string;
  description?: string;
  priority: number;
  enabled: number;
  config_json: string;
  created_at: string;
  updated_at: string;
}

export interface RuleConfig {
  [key: string]: any;
}

export interface PlayerScore {
  playerName: string;
  characterId: number;
  characterName: string;
  score: number;
  reasons: string[];
  isCrossGender: boolean;
  isLead: boolean;
}

export interface AllocationSuggestion {
  assignments: {
    player: Player;
    character: Character;
    score: number;
    reasons: string[];
    isCrossGender: boolean;
  }[];
  totalScore: number;
  crossGenderCount: number;
  dmTips: string[];
  relationshipHighlights: {
    characterA: string;
    characterB: string;
    relationship: string;
    tip: string;
  }[];
}

export interface AllocationRecord {
  id: number;
  store_id: number;
  script_id: number;
  players_json: string;
  suggestion_json: string;
  cross_gender_count: number;
  cross_gender_refused: number;
  on_site_changes: number;
  status: string;
  created_at: string;
}

export interface StoreStats {
  storeId: number;
  storeName: string;
  totalAllocations: number;
  crossGenderRefusalRate: number;
  averageOnSiteChanges: number;
  topTroubledScripts: {
    scriptId: number;
    scriptName: string;
    troubleCount: number;
  }[];
}
