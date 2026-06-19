import { getOne, getAll, runQuery } from '../db/database';
import { Script, Character, CharacterRelationship } from '../types';

export function getScriptById(id: number): Script | undefined {
  return getOne<Script>('SELECT * FROM scripts WHERE id = ?', [id]);
}

export function getAllScripts(): Script[] {
  return getAll<Script>('SELECT * FROM scripts ORDER BY id');
}

export function createScript(
  name: string,
  type: string,
  difficulty: string = 'medium',
  durationMinutes: number = 240,
  description?: string
): number {
  const result = runQuery(
    'INSERT INTO scripts (name, type, difficulty, duration_minutes, description) VALUES (?, ?, ?, ?, ?)',
    [name, type, difficulty, durationMinutes, description || null]
  );
  return result.lastInsertRowid;
}

export function updateScript(
  id: number,
  name: string,
  type: string,
  difficulty: string,
  durationMinutes: number,
  description?: string
): boolean {
  const result = runQuery(
    'UPDATE scripts SET name = ?, type = ?, difficulty = ?, duration_minutes = ?, description = ? WHERE id = ?',
    [name, type, difficulty, durationMinutes, description || null, id]
  );
  return result.changes > 0;
}

export function deleteScript(id: number): boolean {
  const result = runQuery('DELETE FROM scripts WHERE id = ?', [id]);
  return result.changes > 0;
}

export function getCharactersByScriptId(scriptId: number): Character[] {
  return getAll<Character>('SELECT * FROM characters WHERE script_id = ? ORDER BY id', [scriptId]);
}

export function getCharacterById(id: number): Character | undefined {
  return getOne<Character>('SELECT * FROM characters WHERE id = ?', [id]);
}

export function createCharacter(
  scriptId: number,
  name: string,
  gender: string,
  options: {
    age?: number;
    is_lead?: number;
    courage_required?: number;
    reasoning_required?: number;
    emotional_depth?: number;
    description?: string;
  } = {}
): number {
  const result = runQuery(`
    INSERT INTO characters (script_id, name, gender, age, is_lead, courage_required, reasoning_required, emotional_depth, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    scriptId,
    name,
    gender,
    options.age || null,
    options.is_lead || 0,
    options.courage_required || 3,
    options.reasoning_required || 3,
    options.emotional_depth || 3,
    options.description || null
  ]);
  return result.lastInsertRowid;
}

export function getRelationshipsByScriptId(scriptId: number): CharacterRelationship[] {
  return getAll<CharacterRelationship>(
    'SELECT * FROM character_relationships WHERE script_id = ? ORDER BY importance DESC',
    [scriptId]
  );
}

export function createRelationship(
  scriptId: number,
  characterAId: number,
  characterBId: number,
  relationshipType: string,
  importance: number = 3
): number {
  const result = runQuery(`
    INSERT INTO character_relationships (script_id, character_a_id, character_b_id, relationship_type, importance)
    VALUES (?, ?, ?, ?, ?)
  `, [scriptId, characterAId, characterBId, relationshipType, importance]);
  return result.lastInsertRowid;
}
