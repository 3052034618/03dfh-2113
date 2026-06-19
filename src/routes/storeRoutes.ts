import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody, handleAsync } from '../middleware/validation';
import {
  getAllStores,
  getStoreById,
  createStore,
  updateStore,
  deleteStore
} from '../models/storeModel';

const router = Router();

const createStoreSchema = z.object({
  name: z.string().min(1).max(100),
  city: z.string().max(50).optional(),
  address: z.string().max(200).optional()
});

const updateStoreSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  city: z.string().max(50).optional(),
  address: z.string().max(200).optional()
});

router.get('/', handleAsync(async (req: Request, res: Response) => {
  const stores = getAllStores();
  res.json({
    success: true,
    data: stores
  });
}));

router.get('/:id', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的门店ID' });
    return;
  }

  const store = getStoreById(id);
  if (!store) {
    res.status(404).json({ success: false, error: '门店不存在' });
    return;
  }

  res.json({ success: true, data: store });
}));

router.post('/', validateBody(createStoreSchema), handleAsync(async (req: Request, res: Response) => {
  const { name, city, address } = req.body;
  const id = createStore(name, city, address);
  const store = getStoreById(id)!;
  res.status(201).json({ success: true, data: store });
}));

router.put('/:id', validateBody(updateStoreSchema), handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的门店ID' });
    return;
  }

  const existing = getStoreById(id);
  if (!existing) {
    res.status(404).json({ success: false, error: '门店不存在' });
    return;
  }

  const name = req.body.name ?? existing.name;
  const city = req.body.city ?? existing.city;
  const address = req.body.address ?? existing.address;

  const success = updateStore(id, name, city, address);
  if (!success) {
    res.status(500).json({ success: false, error: '更新失败' });
    return;
  }

  const updated = getStoreById(id)!;
  res.json({ success: true, data: updated });
}));

router.delete('/:id', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的门店ID' });
    return;
  }

  const success = deleteStore(id);
  if (!success) {
    res.status(404).json({ success: false, error: '门店不存在' });
    return;
  }

  res.json({ success: true, message: '门店已删除' });
}));

export default router;
