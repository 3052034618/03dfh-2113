import { getOne, getAll, runQuery } from '../db/database';
import { Store } from '../types';

export function getStoreById(id: number): Store | undefined {
  return getOne<Store>('SELECT * FROM stores WHERE id = ?', [id]);
}

export function getAllStores(): Store[] {
  return getAll<Store>('SELECT * FROM stores ORDER BY id');
}

export function createStore(name: string, city?: string, address?: string): number {
  const result = runQuery('INSERT INTO stores (name, city, address) VALUES (?, ?, ?)', [name, city || null, address || null]);
  return result.lastInsertRowid;
}

export function updateStore(id: number, name: string, city?: string, address?: string): boolean {
  const result = runQuery('UPDATE stores SET name = ?, city = ?, address = ? WHERE id = ?', [name, city || null, address || null, id]);
  return result.changes > 0;
}

export function deleteStore(id: number): boolean {
  const result = runQuery('DELETE FROM stores WHERE id = ?', [id]);
  return result.changes > 0;
}
