export type ScriptType = 'emotional' | 'horror' | 'hardcore' | '欢乐' | '阵营' | 'other';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'extreme';
export type Gender = 'male' | 'female' | 'other';
export type RuleStatus = 'draft' | 'published' | 'gray' | 'archived';

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

export interface RuleScope {
  scriptTypes: ScriptType[];
  storeIds: number[];
  allStores: boolean;
}

export interface Rule {
  id: number;
  name: string;
  code: string;
  version: number;
  status: RuleStatus;
  parent_version_id?: number;
  description?: string;
  priority: number;
  enabled: number;
  config_json: string;
  scope_json: string;
  gray_store_ids_json: string;
  created_at: string;
  updated_at: string;
}

export interface RuleVersionSummary {
  id: number;
  code: string;
  version: number;
  name: string;
  status: RuleStatus;
  priority: number;
}

export interface RuleConfig {
  [key: string]: any;
}

export interface FilterMeta {
  scriptId?: number;
  scriptName?: string;
  storeId?: number;
  storeName?: string;
  days?: number;
  startDate?: string;
  endDate?: string;
  filterDescription: string;
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

export interface LeadRecommendation {
  characterId: number;
  characterName: string;
  playerName: string;
  score: number;
  reasons: string[];
  isRegular: boolean;
}

export interface CrossGenderCandidate {
  playerId: string;
  playerName: string;
  originalGender: Gender;
  targetCharacterId: number;
  targetCharacterName: string;
  targetGender: Gender;
  score: number;
  willing: boolean | undefined;
  reasons: string[];
}

export interface DmCommunicationPoint {
  type: 'cross_gender' | 'relationship' | 'lead_newbie' | 'low_match' | 'minor_warning';
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  involvedPlayers: string[];
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
  leadRecommendations: LeadRecommendation[];
  crossGenderCandidates: CrossGenderCandidate[];
  dmCommunicationPoints: DmCommunicationPoint[];
  appliedRules: {
    id: number;
    name: string;
    code: string;
    version: number;
    priority: number;
  }[];
}

export interface AllocationRecord {
  id: number;
  store_id: number;
  script_id: number;
  players_json: string;
  suggestion_json: string;
  rule_versions_json: string;
  cross_gender_count: number;
  cross_gender_refused: number;
  on_site_changes: number;
  status: string;
  started_at: string;
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

export interface TrendDataPoint {
  date: string;
  value: number;
}

export interface GenderTroubleScript {
  scriptId: number;
  scriptName: string;
  scriptType: string;
  allocations: number;
  crossGenderCount: number;
  crossGenderRefused: number;
  onSiteChanges: number;
  genderTroubleScore: number;
}

export type RuleAuditAction = 'create_version' | 'publish_gray' | 'publish_full' | 'rollback' | 'archive' | 'update' | 'submit_review' | 'approve_release' | 'reject_release' | 'schedule_release' | 'cancel_release' | 'pause_release' | 'resume_release';

export type ReleasePlanStatus = 'draft' | 'submitted' | 'approved' | 'scheduled' | 'published' | 'paused' | 'cancelled' | 'rejected';

export type ReleaseType = 'full' | 'gray';

export interface ReleasePlan {
  id: number;
  ruleCode: string;
  ruleId: number;
  ruleVersion: number;
  status: ReleasePlanStatus;
  releaseType: ReleaseType;
  grayStoreIds: number[];
  scheduledAt?: string;
  submittedBy?: string;
  submittedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  publishedBy?: string;
  publishedAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  pausedBy?: string;
  pausedAt?: string;
  reviewComment?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrayEffectBoard {
  meta: {
    ruleCode: string;
    ruleVersion: number;
    ruleName: string;
    grayStoreCount: number;
    controlStoreCount: number;
    days: number;
    filterDescription: string;
  };
  grayGroup: {
    storeIds: number[];
    storeNames: string[];
    totalAllocations: number;
    crossGenderRefusalRate: number;
    averageOnSiteChanges: number;
    troubledScripts: GenderTroubleScript[];
  };
  controlGroup: {
    storeIds: number[];
    storeNames: string[];
    totalAllocations: number;
    crossGenderRefusalRate: number;
    averageOnSiteChanges: number;
    troubledScripts: GenderTroubleScript[];
  };
  diff: {
    crossGenderRefusalRate: MetricChange;
    averageOnSiteChanges: MetricChange;
    totalAllocations: MetricChange;
  };
  hitRuleVersions: {
    gray: { code: string; version: number; name: string }[];
    control: { code: string; version: number; name: string }[];
  };
  insights: string[];
}

export interface BatchSimGroup {
  groupId: string;
  groupName: string;
  storeId?: number;
  scriptId: number;
  players: Player[];
}

export interface BatchSimResultItem {
  groupId: string;
  groupName: string;
  storeId?: number;
  scriptId: number;
  scriptName: string;
  totalScore: number;
  crossGenderCount: number;
  scoreDiffVsBaseline: number;
  crossGenderDiffVsBaseline: number;
  hitRuleVersions: { code: string; version: number; name: string }[];
  riskTips: string[];
  roleChangesCount: number;
  playerScoreDiffs: PlayerScoreDiff[];
}

export interface BatchSimResult {
  baselineStoreId: number;
  compareMode: 'draft' | 'specified' | 'gray';
  groups: BatchSimResultItem[];
  overallSummary: {
    totalGroups: number;
    improvedCount: number;
    declinedCount: number;
    avgScoreDiff: number;
    avgCrossGenderDiff: number;
    highRiskCount: number;
  };
  overallInsights: string[];
}

export interface RuleAuditLog {
  id: number;
  ruleCode: string;
  ruleId?: number;
  ruleVersion?: number;
  action: RuleAuditAction;
  operator: string;
  oldStatus?: RuleStatus;
  newStatus?: RuleStatus;
  affectedStoreIds: number[];
  detail: Record<string, any>;
  createdAt: string;
}

export interface PlayerScoreDiff {
  playerName: string;
  fromCharacter: string;
  toCharacter: string;
  scoreDiff: number;
  biggestScoreReason: string;
}

export interface SimulationDiff {
  roleChanges: {
    playerName: string;
    fromCharacter: string;
    toCharacter: string;
  }[];
  crossGenderCountDiff: number;
  totalScoreDiff: number;
  ruleVersionDiff: {
    added: { code: string; version: number }[];
    removed: { code: string; version: number }[];
    changed: { code: string; fromVersion: number; toVersion: number }[];
  };
  playerScoreDiffs: PlayerScoreDiff[];
  hitRuleVersions: {
    current: { code: string; version: number; name: string }[];
    compare: { code: string; version: number; name: string }[];
  };
}

export interface SimulationResult {
  current: AllocationSuggestion;
  draft?: AllocationSuggestion;
  specified?: AllocationSuggestion;
  diffCurrentVsDraft?: SimulationDiff;
  diffCurrentVsSpecified?: SimulationDiff;
}

export interface MetricChange {
  from: number;
  to: number;
  diff: number;
  diffPct: number;
}

export interface ScriptTroubleChange {
  scriptId: number;
  scriptName: string;
  metric: string;
  from: number;
  to: number;
  diff: number;
  diffPct: number;
}

export interface ComparisonResult {
  meta: {
    periodA: FilterMeta;
    periodB: FilterMeta;
    comparisonDescription: string;
  };
  crossGenderRefusalRate: MetricChange;
  averageOnSiteChanges: MetricChange;
  totalAllocations: MetricChange;
  crossGenderCount: MetricChange;
  genderTroubleScripts: {
    periodA: GenderTroubleScript[];
    periodB: GenderTroubleScript[];
    changed: ScriptTroubleChange[];
  };
  changeReasons: string[];
}
