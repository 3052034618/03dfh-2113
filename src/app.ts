import express from 'express';
import { initDb } from './db/database';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';

import ruleRoutes from './routes/ruleRoutes';
import storeRoutes from './routes/storeRoutes';
import scriptRoutes from './routes/scriptRoutes';
import allocationRoutes from './routes/allocationRoutes';
import statsRoutes from './routes/statsRoutes';

const app = express();

let dbInitialized = false;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      service: 'script-kill-ranking-service',
      status: dbInitialized ? 'running' : 'initializing',
      timestamp: new Date().toISOString()
    }
  });
});

app.use((req, res, next) => {
  if (!dbInitialized) {
    res.status(503).json({
      success: false,
      error: '服务正在初始化中，请稍后再试'
    });
    return;
  }
  next();
});

app.use('/api/rules', ruleRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/scripts', scriptRoutes);
app.use('/api/allocations', allocationRoutes);
app.use('/api/stats', statsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export async function initializeApp(): Promise<void> {
  await initDb();
  dbInitialized = true;
}

export default app;
